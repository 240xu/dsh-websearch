/**
 * Perplexity Search API backend.
 * REST API: POST https://api.perplexity.ai/search
 * Auth: Bearer API key. Returns ranked pages, not a generated answer.
 */

import { WebError } from "@deepseek-ai/dsh-web";
import { webErrorFromResponse } from "../util/web-error.js";
import { throwIfSearchAborted, searchAborted, isAbortError } from "../util/abort.js";
import { normalizeFilters } from "../util/filters.js";
import { egressFetch } from "../util/egress-fetch.js";
import { describeError } from "../util/describe-error.js";

const PERPLEXITY_ENDPOINT = "https://api.perplexity.ai/search";
const RECENCY = new Set(["hour", "day", "week", "month", "year"]);

/** @type {import("../provider.js").Backend} */
export const perplexityBackend = {
  id: "perplexity",
  requiresCredential: true,

  available(options) {
    return typeof options?.resolveApiKey === "function";
  },

  async search(request, signal, options, hooks) {
    throwIfSearchAborted(signal);
    const backendOpts = options ?? {};
    const apiKey = await backendOpts.resolveApiKey?.();
    if (!apiKey) {
      throw new WebError("Perplexity Search: API key not configured", "WEB_PROVIDER_CREDENTIAL_MISSING");
    }

    const body = {
      query: request.query,
      max_results: Math.min(Math.max(request.maxResults ?? 8, 1), 20),
      search_type: "web",
    };
    const filters = normalizeFilters(request.filters);
    if (RECENCY.has(filters.recency)) body.search_recency_filter = filters.recency;
    const lang = typeof filters.lang === "string" ? filters.lang.trim().toLowerCase().slice(0, 2) : "";
    if (/^[a-z]{2}$/.test(lang)) body.search_language_filter = [lang];
    const domains = [
      ...(Array.isArray(backendOpts.includeDomains) ? backendOpts.includeDomains : []),
      ...(Array.isArray(backendOpts.excludeDomains) ? backendOpts.excludeDomains : []).map((d) => "-" + d),
    ].slice(0, 200);
    if (domains.length > 0) body.search_domain_filter = domains;

    const endpoint = backendOpts.baseURL ?? PERPLEXITY_ENDPOINT;
    hooks?.recordRequest?.({
      endpoint,
      toolName: "perplexity_search",
      body: { query: request.query, max_results: body.max_results },
    });

    let response;
    try {
      response = await egressFetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + apiKey,
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "dsh-websearch/2.14",
        },
        body: JSON.stringify(body),
        redirect: "error",
        signal,
      });
    } catch (error) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
      throw new WebError("Perplexity Search request failed: " + describeError(error), "WEB_PROVIDER_ERROR", { cause: error });
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "").then((tx) => tx.slice(0, 300));
      hooks?.recordOutcome?.({ status: "error", message: "HTTP " + response.status + ": " + text });
      throw webErrorFromResponse(response, text, "Perplexity");
    }

    let data;
    try {
      data = await response.json();
    } catch (error) {
      throw new WebError("Perplexity Search: invalid JSON response", "WEB_PROVIDER_ERROR", { cause: error });
    }

    const sources = parsePerplexityResult(data, request.maxResults ?? 8);
    hooks?.recordOutcome?.({ status: "success", count: sources.length });
    return { sources };
  },
};

/**
 * Parse Perplexity Search API results. `date` is YYYY-MM-DD; the provider's
 * finalizeSources() normalizes it to ISO and drops relative/invalid values.
 * @param {object} data
 * @param {number} maxResults
 * @returns {Array<{url:string,title?:string,snippet?:string,publishedAt?:string}>}
 */
export function parsePerplexityResult(data, maxResults) {
  const results = Array.isArray(data?.results) ? data.results : [];
  const sources = [];
  for (const item of results) {
    if (sources.length >= maxResults) break;
    if (typeof item?.url !== "string" || !/^https?:\/\//i.test(item.url)) continue;
    sources.push({
      url: item.url,
      ...(item.title ? { title: String(item.title).slice(0, 300) } : {}),
      ...(item.snippet ? { snippet: String(item.snippet).slice(0, 800) } : {}),
      ...(typeof item.date === "string" ? { publishedAt: item.date } : {}),
    });
  }
  return sources;
}
