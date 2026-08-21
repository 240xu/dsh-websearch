/**
 * @module @deepseek-ai/dsh-websearch/util/rpc
 *
 * Minimal MCP JSON-RPC 2.0 client for the streamable-http transport used by
 * Exa (https://mcp.exa.ai/mcp) and Parallel (https://search.parallel.ai/mcp).
 *
 * Streamable-HTTP MCP servers require a 2-step handshake per session:
 *   1. POST initialize → server replies with its capabilities and (for Exa)
 *      a Mcp-Session-Id header. Parallel also returns this header.
 *   2. POST notifications/initialized → notify the server the client is ready.
 *      (Exa rejects tools/call without this; Parallel tolerates its absence
 *      but sending it is harmless.)
 *   3. POST tools/call with the Mcp-Session-Id header → returns either a plain
 *      JSON body OR a text/event-stream of "data: {…}\n\n" frames.
 *
 * We cache the Mcp-Session-Id per server URL inside the process so subsequent
 * searches skip the handshake (and one cache entry survives across calls).
 * Sessions are NOT shared across processes (each dsh-web worker owns its own).
 *
 * Failures are zh-folded into WebError so the provider fan-out can demote them
 * to soft nulls when only one backend fails.
 */
import { WebError } from "@deepseek-ai/dsh-web";
import { throwIfSearchAborted, searchAborted, isAbortError } from "./abort.js";

/** User-Agent header; bumped with the package version. */
export const UA = "dsh-websearch/2.0";

/** MCP protocol version we negotiate. */
const PROTOCOL_VERSION = "2025-06-18";

/** Per-URL session cache: url → { sessionId, initializedAt }. */
const sessionCache = new Map();
const SESSION_TTL_MS = 10 * 60 * 1000; // Exa sessions live indefinitely; this is a courtesy cap.

/** Monotonic request id so concurrent inits don't collide. */
let nextReqId = 1;

/**
 * Initialize (or reuse) a streamable-http MCP session.
 * Sends initialize + notifications/initialized. Returns the Mcp-Session-Id,
 * caching it so callers don't pay the handshake more than once per TTL.
 *
 * @param {string} url
 * @param {AbortSignal} [signal]
 * @returns {Promise<string|null>} Mcp-Session-Id (or null if the server omits it).
 * @throws {WebError} on transport error or abort.
 */
async function ensureSession(url, signal) {
  throwIfSearchAborted(signal);
  const cached = sessionCache.get(url);
  if (cached && Date.now() - cached.initializedAt < SESSION_TTL_MS && cached.sessionId) {
    return cached.sessionId;
  }

  const initId = nextReqId++;
  const initBody = JSON.stringify({
    jsonrpc: "2.0",
    id: initId,
    method: "initialize",
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "dsh-websearch", version: "1.0" },
    },
  });

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "User-Agent": UA,
      },
      body: initBody,
      ...(signal !== undefined ? { signal } : {}),
    });
  } catch (error) {
    if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
    throw new WebError(
      `mcp initialize fetch failed for ${url}: ${String(error?.message ?? error)}`,
      "WEB_PROVIDER_ERROR",
      { cause: error },
    );
  }
  throwIfSearchAborted(signal);
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.text()).slice(0, 300); } catch {}
    throw new WebError(
      `mcp initialize HTTP ${res.status} for ${url}${detail ? ": " + detail : ""}`,
      "WEB_PROVIDER_ERROR",
    );
  }

  // Drain the initialize response body (we don't need its content).
  await res.text();

  const sessionId = res.headers.get("Mcp-Session-Id") || null;

  // Send notifications/initialized (some servers reject tools/call without it).
  if (sessionId) {
    try {
      await fetch(url, {
        method: "POST",
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json, text/event-stream",
          "User-Agent": UA,
          "Mcp-Session-Id": sessionId,
        },
        body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
        ...(signal !== undefined ? { signal } : {}),
      });
    } catch (error) {
      // notifications/initialized is best-effort; ignore transport errors here.
      // (If the session is gone we'll discover that via tools/call.) Re-raise aborts.
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
    }
  }

  sessionCache.set(url, { sessionId, initializedAt: Date.now() });
  return sessionId;
}

/**
 * Parse a streamable-HTTP MCP response body into the first JSON-RPC envelope.
 *
 * Servers respond with EITHER:
 *   - a single JSON object (Parallel: {"jsonrpc":"2.0","id":N,"result":{…}} or {...,"error":{…}}), OR
 *   - a text/event-stream of "event: <type>\n data: {…}\n\n" frames (Exa).
 *
 * We scan line-by-line; SSE data: frames take precedence, otherwise we fall back
 * to scanning whole-line JSON.
 *
 * @param {string} text
 * @param {number} reqId  the request id we expect to be echoed back
 * @returns {{result?:object, error?:object}}
 * @throws if no parseable envelope is found.
 */
function parseEnvelope(text, reqId) {
  const lines = String(text).split("\n");
  let lastJson = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    let json;
    if (line.startsWith("data: ")) {
      json = line.slice(6).trim();
    } else if (line.startsWith("{")) {
      json = line;
    } else {
      continue;
    }
    if (!json.startsWith("{")) continue;
    let obj;
    try { obj = JSON.parse(json); } catch { continue; }
    // Prefer the envelope matching our request id; otherwise keep the last seen.
    if (typeof obj.id === "number" && obj.id === reqId) return obj;
    lastJson = obj;
  }
  return lastJson;
}

/**
 * JSON-RPC 2.0 tools/call against a streamable-http MCP server (after the
 * initialize + notifications/initialized handshake is established or reused).
 *
 * @param {string} url       the MCP server endpoint
 * @param {string} toolName  the tool to invoke (e.g. "web_search_exa", "web_search")
 * @param {object} args      the tool's arguments (per its input schema)
 * @param {object} [extraHeaders]
 * @param {AbortSignal} [signal]
 * @returns {Promise<object>} the RPC `result` payload (the `content` array etc.)
 * @throws {WebError} on HTTP failure, RPC error, abort, or unparseable response.
 */
export async function rpcCall(url, toolName, args, extraHeaders, signal) {
  const sessionId = await ensureSession(url, signal);
  const reqId = nextReqId++;

  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
    "User-Agent": UA,
    ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
    ...(extraHeaders || {}),
  };
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: reqId,
    method: "tools/call",
    params: { name: toolName, arguments: args },
  });

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      redirect: "error",
      headers,
      body,
      ...(signal !== undefined ? { signal } : {}),
    });
  } catch (error) {
    if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
    throw new WebError(
      `mcp rpc ${toolName} fetch failed: ${String(error?.message ?? error)}`,
      "WEB_PROVIDER_ERROR",
      { cause: error },
    );
  }
  throwIfSearchAborted(signal);

  if (!res.ok) {
    let detail = "";
    try { detail = (await res.text()).slice(0, 300); } catch {}
    // If the server rejected the request id/session, nuke the cached session
    // so the next call re-initializes. 404/401/403 typically mean session death.
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      sessionCache.delete(url);
    }
    throw new WebError(
      `mcp rpc ${toolName} HTTP ${res.status}${detail ? ": " + detail : ""}`,
      "WEB_PROVIDER_ERROR",
    );
  }

  const text = await res.text();
  throwIfSearchAborted(signal);

  const env = parseEnvelope(text, reqId);
  if (!env) {
    throw new WebError(
      `mcp rpc ${toolName} returned an unparseable response`,
      "WEB_PROVIDER_ERROR",
    );
  }
  if (env.error) {
    throw new WebError(
      `mcp rpc ${toolName} error: ${env.error.message || JSON.stringify(env.error)}`,
      "WEB_PROVIDER_ERROR",
    );
  }
  if (!env.result) {
    throw new WebError(
      `mcp rpc ${toolName} returned a response with no result`,
      "WEB_PROVIDER_ERROR",
    );
  }
  return env.result;
}

/** Drop the cached session for a url (used by backends after a fatal error). */
export function invalidateSession(url) {
  sessionCache.delete(url);
}

export { throwIfSearchAborted, searchAborted, isAbortError };
