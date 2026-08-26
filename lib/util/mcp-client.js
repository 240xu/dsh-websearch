/**
 * MCP (Model Context Protocol) Streamable-HTTP Client Utility.
 * Handles the 3-step handshake: initialize -> notifications/initialized -> tools/call
 * with Mcp-Session-Id header caching (10 min TTL).
 * Supports both SSE (Exa) and plain JSON (Parallel) response formats.
 */

import { WebError } from "@deepseek-ai/dsh-web";

const UA = "dsh-websearch/2.3";
const PROTOCOL_VERSION = "2025-06-18";
const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** Per-URL session cache: { sessionId, initializedAt } */
const sessionCache = new Map();

/**
 * Ensure MCP session is initialized for the given URL.
 * Performs the 3-step handshake if needed.
 * @returns {Promise<string>} sessionId
 */
async function ensureSession(url, signal) {
  const now = Date.now();
  const cached = sessionCache.get(url);
  
  if (cached && (now - cached.initializedAt) < SESSION_TTL_MS) {
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
    initResponse = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "User-Agent": UA,
      },
      body: JSON.stringify(initBody),
      signal,
      redirect: "error",
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new WebError(`MCP initialize failed: ${error}`, "WEB_PROVIDER_ERROR", { cause: error });
  }

  if (!initResponse.ok) {
    const text = await initResponse.text().catch(() => "").then((tx) => tx.slice(0, 300));
    throw new WebError(`MCP initialize HTTP ${initResponse.status}: ${text}`, "WEB_PROVIDER_ERROR");
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
    const notifyResponse = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
        "User-Agent": UA,
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

  // Cache the session
  sessionCache.set(url, { sessionId, initializedAt: now });
  return sessionId;
}

/**
 * Parse MCP response envelope - handles both SSE and plain JSON.
 * @returns {object} { id, result?, error? }
 */
function parseEnvelope(text, expectedId) {
  // Try SSE format first: "event: message\ndata: {...}\n\n"
  if (text.includes("data:")) {
    // SSE spec: one JSON payload may span multiple data: lines - join them.
    const joined = text
      .trim()
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .join("");
    if (joined) {
      try {
        return JSON.parse(joined);
      } catch {}
    }
  }
  
  // Try plain JSON (single line or JSON-RPC batch)
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      // Batch response - find matching id
      return parsed.find((r) => r.id === expectedId) ?? parsed[0];
    }
    return parsed;
  } catch {}
  
  throw new WebError("MCP: failed to parse response envelope", "WEB_PROVIDER_ERROR");
}

/**
 * Invalidate cached session for a URL (call on 401/403/404).
 */
export function invalidateSession(url) {
  sessionCache.delete(url);
}

/**
 * Make a tools/call RPC to an MCP server with session management.
 * @param {string} url - MCP endpoint URL
 * @param {string} toolName - Tool name to call
 * @param {object} args - Tool arguments
 * @param {object} extraHeaders - Additional headers
 * @param {AbortSignal} signal - Abort signal
 * @returns {Promise<object>} Parsed result envelope
 */
export async function mcpCall(url, toolName, args, extraHeaders = {}, signal) {
  const sessionId = await ensureSession(url, signal);
  
  const callBody = {
    jsonrpc: "2.0",
    id: 2, // increment from initialize(1)
    method: "tools/call",
    params: { name: toolName, arguments: args },
  };

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
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
    throw new WebError(`MCP tools/call failed: ${error}`, "WEB_PROVIDER_ERROR", { cause: error });
  }

  // On 401/403/404 with a sessionful server, invalidate and retry once.
  // Stateless servers (no session id) have no session to invalidate — fail loud.
  if (sessionId && (response.status === 401 || response.status === 403 || response.status === 404)) {
    invalidateSession(url);
    // Retry with fresh session
    const newSessionId = await ensureSession(url, signal);
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json, text/event-stream",
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
      throw new WebError(`MCP tools/call retry failed: ${error}`, "WEB_PROVIDER_ERROR", { cause: error });
    }
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "").then((tx) => tx.slice(0, 300));
    throw new WebError(`MCP tools/call HTTP ${response.status}: ${text}`, "WEB_PROVIDER_ERROR");
  }

  const text = await response.text();
  const envelope = parseEnvelope(text, callBody.id);

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

