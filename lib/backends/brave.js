/**
 * Brave Search backend for dsh-unified-search.
 * REST API: https://api.search.brave.com/res/v1/web/search
 * Auth: X-Subscription-Token header
 * Free tier: 2,000 requests/month
 */

import { WebError } from "@deepseek-ai/dsh-web";
import { throwIfSearchAborted, searchAborted, isAbortError } from "../util/abort.js";

const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";

/** @type {import("../provider.js").Backend} */
export const braveBackend = {
  id: "brave",
  requiresCredential: true,

  available(options) {
    return typeof options?.resolveApiKey === "function";
  },

  async search(request, signal, options, hooks) {
    throwIfSearchAborted(signal);
    const backendOpts = options ?? {};

    const apiKey = await backendOpts.resolveApiKey?.();
    if (!apiKey) {
      throw new WebError("Brave Search: API key not configured", "WEB_PROVIDER_UNAVAILABLE");
    }

    const baseURL = backendOpts.baseURL ?? BRAVE_ENDPOINT;
    const count = Math.min(request.maxResults ?? 8, 20);
    const url = new URL(baseURL);
    url.searchParams.set("q", request.query);
    url.searchParams.set("count", String(count));

    hooks?.recordRequest?.({
      endpoint: baseURL,
      toolName: "brave_search",
      body: { q: request.query, count },
    });

    let response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: {
          "X-Subscription-Token": apiKey,
          "Accept": "application/json",
          "User-Agent": "dsh-unified-search/2.0",
        },
        signal,
      });
    } catch (error) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
      throw new WebError(`Brave Search request failed: ${error}`, "WEB_PROVIDER_ERROR", { cause: error });
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      hooks?.recordOutcome?.({ status: "error", message: `HTTP ${response.status}: ${text}` });
      throw new WebError(`Brave Search API error (HTTP ${response.status}): ${text}`, "WEB_PROVIDER_ERROR");
    }

    let data;
    try {
      data = await response.json();
    } catch (error) {
      throw new WebError("Brave Search: invalid JSON response", "WEB_PROVIDER_ERROR", { cause: error });
    }

    const sources = parseBraveResult(data, request.maxResults ?? 8);
    hooks?.recordOutcome?.({ status: "success", count: sources.length });
    return { sources };
  },
};

/**
 * Parse Brave Search API response.
 * @param {object} data - Response JSON
 * @param {number} maxResults - Maximum results to return
 * @returns {Array<{url:string,title?:string,snippet?:string,publishedAt?:string}>}
 */
export function parseBraveResult(data, maxResults) {
  const results = data?.web?.results ?? [];
  const sources = [];
  for (const item of results) {
    if (sources.length >= maxResults) break;
    if (!item?.url) continue;
    sources.push({
      url: item.url,
      ...(item.title ? { title: item.title } : {}),
      ...(item.description ? { snippet: item.description } : {}),
      ...(item.age ? { publishedAt: item.age } : {}),
    });
  }
  return sources;
}
