// parallel.js — Parallel search backend (streamable-http MCP, keyless).
// Parallel's MCP server is at https://search.parallel.ai/mcp. It exposes:
//   - web_search  { objective, search_queries[], session_id?, model_name? }
//   - web_fetch   { urls, objective?, full_content? }
// The search_queries array should be 3-6 keyword-level variants; we map the
// raw query into a single-element query array plus that same query as the
// objective — that's their most atomic usage. session_id is a conversation
// stable identifier; we generate one per process so call correlation is
// consistent across searches. model_name is advisory metadata for their rate
// limiter; we use a stable sentinel.
//
// Response comes back as a JSON envelope whose result.content[0].text is a
// JSON-string with { search_id, results: [{ url, title, publish_date, excerpts:[] }] }.
// Parallel is keyless — its public MCP endpoint requires no API key.

import { mcpCall, invalidateSession } from "../util/mcp-client.js";
import { WebError } from "@deepseek-ai/dsh-web";

const PARALLEL_ENDPOINT = "https://search.parallel.ai/mcp";
const PARALLEL_TOOL = "web_search";

/** Per-process session id — stable across searches so Parallel's free-tier
 * rate limiter correlates calls consistently. */
const SESSION_ID =
  "dsh-unified-search-" +
  process.pid?.toString(36) + "-" +
  Math.random().toString(36).slice(2, 10);

export const parallelBackend = {
  id: "parallel",
  requiresCredential: false,

  available() {
    return true; // keyless endpoint
  },

  async search(request, signal, options, hooks = {}) {
    const args = {
      objective: request.query,
      search_queries: [request.query],
      session_id: SESSION_ID,
      model_name: "dsh-unified-search",
    };
    hooks.recordRequest?.({
      endpoint: PARALLEL_ENDPOINT,
      toolName: PARALLEL_TOOL,
      body: args,
      headers: {},
    });

    let result;
    try {
      result = await mcpCall(PARALLEL_ENDPOINT, PARALLEL_TOOL, args, {}, signal);
    } catch (err) {
      if (err instanceof WebError) throw err;
      throw new WebError(
        `parallel search failed: ${String(err?.message ?? err)}`,
        "WEB_PROVIDER_ERROR",
        { cause: err },
      );
    }

    hooks.recordOutcome?.({ status: "ok" });
    const sources = parseParallelResult(result, request.maxResults ?? 8);

    if (result?.isError === true) {
      throw new WebError(
        `parallel returned an MCP error: ${String(result.content?.[0]?.text ?? "unknown")}`,
        "WEB_PROVIDER_ERROR",
      );
    }

    return { sources, content: undefined, truncated: false };
  },
};

export function parseParallelResult(result, maxResults) {
  const text = result?.content?.[0]?.text;
  if (typeof text !== "string" || text.length === 0) return [];
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const results = Array.isArray(parsed?.results) ? parsed.results : [];
  const sources = [];
  for (const r of results) {
    if (typeof r?.url !== "string" || r.url.length === 0) continue;
    const source = { url: r.url };
    if (r.title && r.title.length > 0) source.title = r.title;
    const excerpt = Array.isArray(r.excerpts) && r.excerpts.length > 0 ? r.excerpts[0] : undefined;
    if (typeof excerpt === "string" && excerpt.length > 0) {
      source.snippet = excerpt.length > 240 ? excerpt.slice(0, 240) + "…" : excerpt;
    }
    if (r.publish_date && r.publish_date !== "null" && r.publish_date.length > 0) {
      source.publishedAt = r.publish_date;
    }
    sources.push(source);
    if (sources.length >= maxResults) break;
  }
  return sources;
}

export default parallelBackend;
