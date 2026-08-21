/**
 * Tavily Search backend for dsh-unified-search.
 * REST API: https://api.tavily.com/search
 * Auth: Bearer token or api_key in body
 * Free tier: 1,000 requests/month
 */

import { WebError } from "@deepseek-ai/dsh-web";
import { throwIfSearchAborted, searchAborted, isAbortError } from "../util/abort.js";

const TAVILY_ENDPOINT = "https://api.tavily.com/search";

/** @type {import("../provider.js").Backend} */
export const tavilyBackend = {
  id: "tavily",
  requiresCredential: true,

  available(options) {
    return typeof options?.resolveApiKey === "function";
  },

  async search(request, signal, options, hooks) {
    throwIfSearchAborted(signal);
    const backendOpts = options ?? {};

    const apiKey = await backendOpts.resolveApiKey?.();
    if (!apiKey) {
      throw new WebError("Tavily: API key not configured", "WEB_PROVIDER_UNAVAILABLE");
    }

    const baseURL = backendOpts.baseURL ?? TAVILY_ENDPOINT;
    const maxResults = Math.min(request.maxResults ?? 8, 20);
    const searchDepth = backendOpts.searchDepth ?? "basic";

    const body = {
      query: request.query,
      max_results: maxResults,
      search_depth: searchDepth,
      include_answer: true,
      include_raw_content: false,
    };

    hooks?.recordRequest?.({
      endpoint: baseURL,
      toolName: "tavily_search",
      body,
    });

    let response;
    try {
      response = await fetch(baseURL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Accept": "application/json",
          "User-Agent": "dsh-unified-search/2.0",
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
      throw new WebError(`Tavily request failed: ${error}`, "WEB_PROVIDER_ERROR", { cause: error });
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      hooks?.recordOutcome?.({ status: "error", message: `HTTP ${response.status}: ${text}` });
      throw new WebError(`Tavily API error (HTTP ${response.status}): ${text}`, "WEB_PROVIDER_ERROR");
    }

    let data;
    try {
      data = await response.json();
    } catch (error) {
      throw new WebError("Tavily: invalid JSON response", "WEB_PROVIDER_ERROR", { cause: error });
    }

    const parsed = parseTavilyResult(data, request.maxResults ?? 8);
    const sources = parsed.sources;
    hooks?.recordOutcome?.({ status: "success", count: sources.length });
    return { sources, ...(parsed.content ? { content: parsed.content } : {}) };
  },
};

/**
 * Parse Tavily API response.
 * @param {object} data
 * @param {number} maxResults
 */
export function parseTavilyResult(data, maxResults) {
  // Per the seam contract, a provider-generated answer belongs in result.content,
  // NOT as a fake source entry (sources must be citeable URLs).
  const answer = data?.answer && typeof data.answer === "string" && data.answer.length > 0
    ? data.answer.slice(0, 2000)
    : undefined;
  const sources = [];

  const results = data?.results ?? [];
  for (const item of results) {
    if (sources.length >= maxResults) break;
    if (!item?.url) continue;
    sources.push({
      url: item.url,
      ...(item.title ? { title: item.title } : {}),
      ...(item.content ? { snippet: item.content.slice(0, 500) } : {}),
      ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}),
    });
  }
  return { sources, ...(answer ? { content: answer } : {}) };
}
