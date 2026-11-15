// firecrawl.js — Firecrawl search backend (streamable-http MCP, v2).
//
// Requests the official Firecrawl MCP endpoint through the shared MCP client.
// The hosted keyless tier is rate limited; an optional API key raises its
// limits. Results are normalised to { url, title?, snippet? }.

//   https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/firecrawl.ts
//   https://docs.firecrawl.dev/mcp-server/keyless.md
//
// Endpoint: https://mcp.firecrawl.dev/v2/mcp
//   - keyless hosted tier: no credential, exposes firecrawl_search /
//     firecrawl_scrape / firecrawl_parse only, rate limited per IP (official
//     docs, HTTP 200). The exact daily numbers are not published.
//   - with FIRECRAWL_API_KEY: Authorization: Bearer <key>, higher limits.
// The v2.2.5 OpenCode client does NOT send an explicit keyless header; the
// server implicitly provides the tier when no Authorization header is set.
//
// Response envelope: content[0].text is a JSON string of
//   { success: boolean, data: { web: [{ url, title?, description? }] } }
// which we normalise to the DSH source shape { url, title?, snippet? }.
//
// Registration is intentionally opt-in (DEFAULT_ENABLED does not contain this
// id) because the keyless tier is metered and its exact ceiling is unknown.

import { mcpCall } from "../util/mcp-client.js";
import { WebError } from "@deepseek-ai/dsh-web";

const FIRECRAWL_ENDPOINT = "https://mcp.firecrawl.dev/v2/mcp";
const FIRECRAWL_TOOL = "firecrawl_search";

export const firecrawlBackend = {
  id: "firecrawl",
  requiresCredential: false,

  available() {
    // Hosted keyless tier works without a key; a key only raises limits.
    return true;
  },

  async search(request, signal, options, hooks = {}) {
    // The official provider requests a fixed page of 8; a larger maxResults
    // is applied locally by parseFirecrawlResult, not sent upstream where it
    // would consume more of the hosted keyless quota.
    const args = {
      query: request.query,
      limit: 8,
    };
    // resolveOptions() supplies an async resolveApiKey(); a literal apiKey is
    // accepted for stubs (same split as anthropic-like.js). Resolution failure
    // degrades to the keyless tier.
    let apiKey = typeof options?.apiKey === "string" ? options.apiKey : "";
    if (!apiKey && typeof options?.resolveApiKey === "function") {
      try { apiKey = (await options.resolveApiKey()) ?? ""; } catch { apiKey = ""; }
    }
    const extraHeaders = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
    // Use the configured baseURL so the sidecar/proxy path and the provider
    // trust gate apply; fall back to the official endpoint when unset.
    const endpoint = typeof options?.baseURL === "string" && options.baseURL.length > 0
      ? options.baseURL : FIRECRAWL_ENDPOINT;

    // Keys must never appear in recorded request metadata.
    hooks.recordRequest?.({
      endpoint,
      toolName: FIRECRAWL_TOOL,
      body: args,
      headers: {},
    });

    let result;
    try {
      result = await mcpCall(
        endpoint,
        FIRECRAWL_TOOL,
        args,
        extraHeaders,
        signal,
        // The hosted Firecrawl MCP endpoint is stateless; the official
        // provider sends a single tools/call.
        { skipInitialize: true },
      );
    } catch (err) {
      if (err instanceof WebError) throw err;
      throw new WebError(
        `firecrawl search failed: ${String(err?.message ?? err)}`,
        "WEB_PROVIDER_ERROR",
        { cause: err },
      );
    }

    if (result?.isError === true) {
      const message = String(result.content?.[0]?.text ?? "unknown");
      hooks.recordOutcome?.({ status: "error", message });
      throw new WebError(`firecrawl returned an MCP error: ${message}`, "WEB_PROVIDER_ERROR");
    }

    const sources = parseFirecrawlResult(result, request.maxResults ?? 8);
    hooks.recordOutcome?.({ status: "ok", count: sources.length });
    return { sources, content: undefined, truncated: false };
  },
};

/** Parse the JSON string embedded in content[0].text into DSH sources. */
export function parseFirecrawlResult(result, maxResults) {
  const text = result?.content?.[0]?.text;
  if (typeof text !== "string" || text.length === 0) return [];
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (parsed?.success === false || !Array.isArray(parsed?.data?.web)) return [];
  const sources = [];
  for (const item of parsed.data.web) {
    if (typeof item?.url !== "string" || item.url.length === 0) continue;
    const source = { url: item.url };
    if (typeof item.title === "string" && item.title.length > 0) source.title = item.title;
    if (typeof item.description === "string" && item.description.length > 0) {
      source.snippet = item.description;
    }
    sources.push(source);
    if (sources.length >= maxResults) break;
  }
  return sources;
}

export default firecrawlBackend;
