/**
 * MCP (Model Context Protocol) Streamable-HTTP Client Utility.
 * Handles the 3-step handshake: initialize -> notifications/initialized -> tools/call
 * with Mcp-Session-Id header caching (10 min TTL).
 * Supports both SSE (Exa) and plain JSON (Parallel) response formats.
 */

import { WebError } from "@deepseek-ai/dsh-web";
import { webErrorFromResponse } from "./web-error.js";
import { egressFetch } from "./egress-fetch.js";
import { describeError } from "./describe-error.js";

const UA = "dsh-websearch/2.3";
const PROTOCOL_VERSION = "2025-06-18";
const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes
const SESSION_CACHE_MAX = 64;

/** Session cache keyed by URL + stable auth-header digest. A session bound to
 * one credential must never be reused after the key rotates (65 号 N4). */
const sessionCache = new Map();
function sessionCacheKey(url, extraHeaders) {
  const auth = Object.entries(extraHeaders ?? {})
    .filter(([k]) => /^(authorization|x-api-key|x-tinyfish-access-mode)$/i.test(k))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k.toLowerCase()}:${String(v)}`)
    .join("|");
  return `${url}\0${auth}`;
}

/**
 * Ensure MCP session is initialized for the given URL.
 * Performs the 3-step handshake if needed.
 * @returns {Promise<string>} sessionId
 */
async function ensureSession(url, signal, options = {}, extraHeaders = {}) {
  const now = Date.now();
  const key = sessionCacheKey(url, extraHeaders);
  const cached = sessionCache.get(key);

  // A rotated credential must not reuse a session bound to the old key.
  if (!options.forceFreshSession && cached && (now - cached.initializedAt) < SESSION_TTL_MS) {
    // Refresh insertion order so the LRU eviction keeps active endpoints.
    sessionCache.delete(key);
    sessionCache.set(key, cached);
    return cached.sessionId;
  }

  // Step 1: initialize
  const initBody = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: { name: "dsh-websearch", version: "2.0" },
      capabilities: {},
    },
  };

  let initResponse;
  try {
    initResponse = await egressFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "User-Agent": UA,
        ...extraHeaders,
      },
      body: JSON.stringify(initBody),
      signal,
      redirect: "error",
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    // describeError (not `${error}`): undici puts the actionable failure —
    // proxy rejection / ENOTFOUND / TLS / timeout — on error.cause; the bare
    // form would only say "TypeError: fetch failed" (route6 audit).
    throw new WebError(`MCP initialize failed: ${describeError(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
  }

  if (!initResponse.ok) {
    const text = await initResponse.text().catch(() => "").then((tx) => tx.slice(0, 300));
    throw webErrorFromResponse(initResponse, text, "MCP initialize");
  }
  // HTTP 200 is not a successful handshake: the body may carry a JSON-RPC
  // error or omit protocolVersion. Validate before caching a session.
  const initEnvelope = await readEnvelope(initResponse, 1);
  if (initEnvelope === null || typeof initEnvelope !== "object") {
    throw new WebError("MCP initialize returned an invalid envelope", "WEB_PROVIDER_ERROR");
  }
  if (initEnvelope.error !== undefined) {
    throw new WebError("MCP initialize error " + initEnvelope.error.code + ": " + initEnvelope.error.message, "WEB_PROVIDER_ERROR");
  }
  const negotiated = initEnvelope.result?.protocolVersion;
  if (typeof negotiated !== "string" || negotiated.length === 0) {
    throw new WebError("MCP initialize did not negotiate a protocol version", "WEB_PROVIDER_ERROR");
  }

  // Extract Mcp-Session-Id from response headers. Stateless MCP servers may
  // omit it; cache undefined and skip the header on subsequent calls instead
  // of failing — the initialize round-trip still validated reachability.
  const sessionId = initResponse.headers.get("Mcp-Session-Id") ?? undefined;

  // Step 2: notifications/initialized (best-effort, fire and forget)
  const notifyBody = {
    jsonrpc: "2.0",
    method: "notifications/initialized",
    params: {},
  };
  
  try {
    const notifyResponse = await egressFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "MCP-Protocol-Version": PROTOCOL_VERSION,
        ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
        "User-Agent": UA,
        ...extraHeaders,
      },
      body: JSON.stringify(notifyBody),
      signal,
      redirect: "error",
    });
    // Drain the discarded body so undici returns the socket to the pool.
    notifyResponse.body?.cancel?.().catch(() => {});
  } catch (error) {
    // Best-effort: Exa requires this, Parallel tolerates absence
    if (signal?.aborted) throw error;
    // Ignore other errors for notification
  }

  // Cache the session (bounded: a long-lived process may see many endpoints
  // and rotated credentials; an unbounded Map retained every one).
  if (sessionCache.has(key)) sessionCache.delete(key);
  while (sessionCache.size >= SESSION_CACHE_MAX) {
    const oldest = sessionCache.keys().next().value;
    if (oldest === undefined) break;
    sessionCache.delete(oldest);
  }
  sessionCache.set(key, { sessionId, initializedAt: now });
  return sessionId;
}

/**
 * Return the matching SSE frame already present in `body`, or undefined while
 * the frame is still incomplete. Never parses a partial trailing event.
 * @param {string} body
 * @param {string|number} expectedId
 * @returns {object|undefined}
 */
function matchSseFrame(body, expectedId) {
  if (!body.includes("data:")) return undefined;
  const events = body.split(/\r?\n\r?\n/);
  // The final element has no terminating blank line, so it is incomplete.
  events.pop();
  for (const event of events) {
    const joined = event
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("");
    if (!joined) continue;
    let frame;
    try { frame = JSON.parse(joined); } catch { continue; }
    const candidates = Array.isArray(frame) ? frame : [frame];
    const match = candidates.find((r) => r && String(r.id) === String(expectedId)
      && (r.result !== undefined || r.error !== undefined));
    if (match) return match;
  }
  return undefined;
}

/**
 * Read an MCP response, returning as soon as a matching SSE frame arrives.
 * Streamable-HTTP servers may keep the connection open after the response;
 * awaiting EOF made a successful call look like a timeout.
 * @param {Response} response
 * @param {string|number} expectedId
 * @returns {Promise<object>}
 */
async function readEnvelope(response, expectedId) {
  const reader = response.body?.getReader?.();
  if (reader === undefined) return parseEnvelope(await response.text(), expectedId);
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frame = matchSseFrame(buffer, expectedId);
      if (frame !== undefined) {
        await reader.cancel().catch(() => {});
        return frame;
      }
    }
    buffer += decoder.decode();
    return parseEnvelope(buffer, expectedId);
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
}

/**
 * Parse MCP response envelope - handles both SSE and plain JSON.
 * @returns {object} { id, result?, error? }
 */
export function parseEnvelope(text, expectedId) {
  // Strip a UTF-8 BOM: some MCP servers prepend it to the first SSE line,
  // which would otherwise make the leading `data:` invisible to the split.
  const body = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
  // SSE: split into events on blank lines, parse each event's data lines, and
  // pick the frame whose id matches the request and carries result/error.
  // Joining all data lines across events produced "{...}{...}" and failed
  // whenever a server pushed a notification before the actual response.
  if (body.includes("data:")) {
    for (const event of body.split(/\r?\n\r?\n/)) {
      const joined = event
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("");
      if (!joined) continue;
      let frame;
      try { frame = JSON.parse(joined); } catch { continue; }
      const candidates = Array.isArray(frame) ? frame : [frame];
      const match = candidates.find((r) => r && String(r.id) === String(expectedId)
        && (r.result !== undefined || r.error !== undefined));
      if (match) return match;
    }
  }

  // Plain JSON (single line or JSON-RPC batch). An explicit id that differs
  // from the request is a different response and must not be handed to this
  // caller; a missing id is tolerated for JSON-RPC notification-style replies.
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new WebError("MCP: failed to parse response envelope", "WEB_PROVIDER_ERROR");
  }
  if (Array.isArray(parsed)) {
    const match = parsed.find((r) => String(r.id) === String(expectedId));
    if (match) return match;
    // A batch that only carries frames for other requests must not hand its
    // first frame to this caller; the object path already rejects that case.
    if (parsed.some((r) => r && r.id !== undefined && String(r.id) !== String(expectedId))) {
      throw new WebError("MCP: response id does not match the request", "WEB_PROVIDER_ERROR");
    }
    return parsed[0];
  }
  if (parsed && typeof parsed === "object" && parsed.id !== undefined
      && String(parsed.id) !== String(expectedId)) {
    throw new WebError("MCP: response id does not match the request", "WEB_PROVIDER_ERROR");
  }
  return parsed;
}

/**
 * Project an MCP tool result to the model-visible text. MCP permits several
 * text blocks and `structuredContent`; reading only content[0].text turned a
 * spec-compliant multi-block or structured response into a silent empty
 * success. All text blocks are joined with newlines, with structuredContent
 * used only when no text block exists.
 * @param {object} result MCP CallToolResult
 * @param {string} [separator] join between text blocks
 * @returns {string}
 */
export function mcpText(result, separator = "\n") {
  const content = result?.content;
  if (typeof content === "string") return content;
  const texts = Array.isArray(content)
    ? content.filter((block) => block && typeof block.text === "string" && (block.type === undefined || block.type === "text"))
      .map((block) => block.text)
    : [];
  if (texts.length > 0) return texts.join(separator);
  if (result?.structuredContent !== undefined) {
    return typeof result.structuredContent === "string"
      ? result.structuredContent
      : JSON.stringify(result.structuredContent);
  }
  return "";
}

/**
 * Invalidate cached session for a URL (call on 401/403/404).
 */
export function invalidateSession(url, extraHeaders) {
  sessionCache.delete(sessionCacheKey(url, extraHeaders));
}

/**
 * Make a tools/call RPC to an MCP server with session management.
 * @param {string} url - MCP endpoint URL
 * @param {string} toolName - Tool name to call
 * @param {object} args - Tool arguments
 * @param {object} extraHeaders - Additional headers
 * @param {AbortSignal} signal - Abort signal
 * @param {{ skipInitialize?: boolean, forceFreshSession?: boolean }} [options] - Per-call transport options.
 *   `skipInitialize` sends a direct tools/call for stateless endpoints that
 *   do not need a session: TinyFish keyless, Exa, Parallel, Firecrawl (per
 *   the official websearch provider's single tools/call). `forceFreshSession`
 *   bypasses the URL-keyed session cache so a rotated credential cannot reuse
 *   a stale Mcp-Session-Id. Keyed calls use the handshake and a fresh session.
 * @returns {Promise<object>} Parsed result envelope
 */
export async function mcpCall(url, toolName, args, extraHeaders = {}, signal, options = {}) {
  // The session handshake is the default; stateless keyless servers accept a
  // direct tools/call and skip it.
  const sessionId = options.skipInitialize ? undefined : await ensureSession(url, signal, { forceFreshSession: options.forceFreshSession === true }, extraHeaders);
  
  const callBody = {
    jsonrpc: "2.0",
    // initialize uses id 1. Keep every tools/call away from it so a shared
    // SSE stream cannot hand an initialize-shaped frame to a search caller.
    // Sessionful and stateless calls also use distinct ids from each other.
    id: options.skipInitialize ? 2 : 3,
    method: "tools/call",
    params: { name: toolName, arguments: args },
  };

  let response;
  try {
    response = await egressFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "MCP-Protocol-Version": PROTOCOL_VERSION,
        ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
        "User-Agent": UA,
        ...extraHeaders,
      },
      body: JSON.stringify(callBody),
      signal,
      redirect: "error",
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new WebError(`MCP tools/call failed: ${describeError(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
  }

  // On 401/403/404 with a sessionful server, invalidate and retry once.
  // Stateless servers (no session id) have no session to invalidate — fail loud.
  if (sessionId && (response.status === 401 || response.status === 403 || response.status === 404)) {
    invalidateSession(url, extraHeaders);
    // Retry with fresh session, retaining the same credential headers.
    const newSessionId = await ensureSession(url, signal, {}, extraHeaders);
    try {
      response = await egressFetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json, text/event-stream",
          "MCP-Protocol-Version": PROTOCOL_VERSION,
          ...(newSessionId ? { "Mcp-Session-Id": newSessionId } : {}),
          "User-Agent": UA,
          ...extraHeaders,
        },
        body: JSON.stringify(callBody),
        signal,
        redirect: "error",
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new WebError(`MCP tools/call retry failed: ${describeError(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
    }
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "").then((tx) => tx.slice(0, 300));
    throw webErrorFromResponse(response, text, "MCP tools/call");
  }

  const envelope = await readEnvelope(response, callBody.id);

  if (envelope === null || typeof envelope !== "object") {
    throw new WebError("MCP: invalid response envelope", "WEB_PROVIDER_ERROR");
  }
  if (envelope.error) {
    throw new WebError(`MCP error ${envelope.error.code}: ${envelope.error.message}`, "WEB_PROVIDER_ERROR");
  }

  if (!envelope.result) {
    throw new WebError("MCP: missing result in response", "WEB_PROVIDER_ERROR");
  }

  return envelope.result;
}

// Re-export abort helpers for convenience
export { 
  isAbortedWebError,
  searchAborted,
  throwIfSearchAborted,
  maybeAbortError,
} from "./abort.js";

