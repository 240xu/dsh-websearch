// tinyfish.js — TinyFish search backend (streamable-http MCP).
//
// Aligned with the OpenCode v2 websearch provider:
//   https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/tinyfish.ts
// The hosted keyless tier needs no credential; an optional API key activates
// the session handshake and raises limits.
// Endpoint: https://agent.tinyfish.ai/mcp
//   - keyless: header `X-TinyFish-Access-Mode: keyless`, NO initialize /
//     Mcp-Session-Id handshake. TinyFish v2.2.5 source comment:
//       "Keyed requests are rejected without the Mcp-Session-Id returned by
//        initialize; keyless ones are not."
//   - keyed: header `X-API-Key: <key>` plus the normal 3-step handshake
//     (mcpCall default). Our mcpCall() gained `options.skipInitialize` to
//     express exactly this split without regressing exa/parallel.
//
// Keyless limits observed via tools/list: 30 requests/min, 50 searches/UTC
// day (search only: web + news). The REST pricing page uses different numbers
// (TinySearch 30 req/min, 500/hour) — that is a different ingress, do not
// conflate the two. See 05-search-backends.md appendix A.3.
//
// Response envelope: content[0].text is a JSON string of
//   { results: [{ url, title, snippet }] }.
//
// Registration is opt-in (DEFAULT_ENABLED does not contain this id).

import { mcpCall } from "../util/mcp-client.js";
import { WebError } from "@deepseek-ai/dsh-web";

const TINYFISH_ENDPOINT = "https://agent.tinyfish.ai/mcp";
const TINYFISH_TOOL = "search";

export const tinyfishBackend = {
  id: "tinyfish",
  requiresCredential: false,

  available() {
    // Keyless mode needs no credential.
    return true;
  },

  async search(request, signal, options, hooks = {}) {
    const args = { query: request.query };
    // resolveOptions() supplies an async resolveApiKey() closure. A literal
    // apiKey is accepted for stubs; a failed resolution degrades to keyless.
    let apiKey = typeof options?.apiKey === "string" ? options.apiKey : "";
    if (!apiKey && typeof options?.resolveApiKey === "function") {
      try { apiKey = (await options.resolveApiKey()) ?? ""; } catch { apiKey = ""; }
    }
    const keyed = apiKey.length > 0;

    const extraHeaders = keyed
      ? { "X-API-Key": apiKey }
      : { "X-TinyFish-Access-Mode": "keyless" };
    // Use the configured baseURL so the provider trust gate and sidecar path apply.
    const endpoint = typeof options?.baseURL === "string" && options.baseURL.length > 0
      ? options.baseURL : TINYFISH_ENDPOINT;

    // Never record the key itself.
    hooks.recordRequest?.({
      endpoint,
      toolName: TINYFISH_TOOL,
      body: args,
      headers: {},
    });

    let result;
    try {
      result = await mcpCall(
        endpoint,
        TINYFISH_TOOL,
        args,
        extraHeaders,
        signal,
        // Keyless is stateless: skip initialize. Keyed uses the full
        // handshake and a fresh session so a rotated key cannot reuse the
        // Mcp-Session-Id cached for the previous credential.
        { skipInitialize: !keyed, forceFreshSession: keyed },
      );
    } catch (err) {
      if (err instanceof WebError) throw err;
      throw new WebError(
        `tinyfish search failed: ${String(err?.message ?? err)}`,
        "WEB_PROVIDER_ERROR",
        { cause: err },
      );
    }

    if (result?.isError === true) {
      const message = String(result.content?.[0]?.text ?? "unknown");
      hooks.recordOutcome?.({ status: "error", message });
      throw new WebError(`tinyfish returned an MCP error: ${message}`, "WEB_PROVIDER_ERROR");
    }

    const sources = parseTinyfishResult(result, request.maxResults ?? 8);
    hooks.recordOutcome?.({ status: "ok", count: sources.length });
    return { sources, content: undefined, truncated: false };
  },
};

/** Parse the JSON string embedded in content[0].text into DSH sources. */
export function parseTinyfishResult(result, maxResults) {
  const text = result?.content?.[0]?.text;
  if (typeof text !== "string" || text.length === 0) return [];
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed?.results)) return [];
  const sources = [];
  for (const item of parsed.results) {
    if (typeof item?.url !== "string" || item.url.length === 0) continue;
    const source = { url: item.url };
    if (typeof item.title === "string" && item.title.length > 0) source.title = item.title;
    if (typeof item.snippet === "string" && item.snippet.length > 0) source.snippet = item.snippet;
    sources.push(source);
    if (sources.length >= maxResults) break;
  }
  return sources;
}

export default tinyfishBackend;
