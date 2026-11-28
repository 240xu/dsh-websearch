/**
 * Brave Search backend for dsh-websearch.
 * REST API: https://api.search.brave.com/res/v1/web/search
 * Auth: X-Subscription-Token header
 * Free tier: 2,000 requests/month
 */

import { WebError } from "@deepseek-ai/dsh-web";
import { webErrorFromResponse } from "../util/web-error.js";
import { throwIfSearchAborted, searchAborted, isAbortError } from "../util/abort.js";
import { applyBraveFilters, normalizeFilters, safeSearchParams } from "../util/filters.js";
import { egressFetch } from "../util/egress-fetch.js";
import { describeError } from "../util/describe-error.js";

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
      throw new WebError("Brave Search: API key not configured", "WEB_PROVIDER_CREDENTIAL_MISSING");
    }

    const baseURL = backendOpts.baseURL ?? BRAVE_ENDPOINT;
    const count = Math.min(request.maxResults ?? 8, 20);
    const url = new URL(baseURL);
    url.searchParams.set("q", request.query);
    url.searchParams.set("count", String(count));
    applyBraveFilters(url, normalizeFilters(request.filters));
    const safe = safeSearchParams("brave", backendOpts.safeSearch);
    if (safe) url.searchParams.set("safesearch", safe);

    hooks?.recordRequest?.({
      endpoint: baseURL,
      toolName: "brave_search",
      body: { q: request.query, count },
    });

    let response;
    try {
      response = await egressFetch(url, {
        method: "GET",
        headers: {
          "X-Subscription-Token": apiKey,
          "Accept": "application/json",
          "User-Agent": "dsh-websearch/2.3",
        },
        redirect: "error",

        signal,
      });
    } catch (error) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
      throw new WebError(`Brave Search request failed: ${describeError(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "").then((tx) => tx.slice(0, 300));
      hooks?.recordOutcome?.({ status: "error", message: `HTTP ${response.status}: ${text}` });
      throw webErrorFromResponse(response, text, "Brave");
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
      // Brave's `age` is human text ("3 days ago") unless it is an ISO date; the
      // seam declares publishedAt ISO-8601, so only pass a date-shaped value.
      ...(typeof item.age === "string" && /^\d{4}-\d{2}-\d{2}/.test(item.age) ? { publishedAt: item.age } : {}),
    });
  }
  return sources;
}
