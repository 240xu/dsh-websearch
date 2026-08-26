/**
 * SearXNG backend for dsh-websearch.
 * REST API: {baseURL}/search?q={query}&format=json&categories=general&language=en&safesearch=1
 * Auth: None (public instances) or API key for private instances
 * Free tier: Unlimited (public instances)
 * Default instance: https://searx.be
 */

import { WebError } from "@deepseek-ai/dsh-web";
import { throwIfSearchAborted, searchAborted, isAbortError } from "../util/abort.js";
import { applySearxngFilters, normalizeFilters, safeSearchParams } from "../util/filters.js";

const DEFAULT_SEARXNG_URL = "https://searx.be";

/** @type {import("../provider.js").Backend} */
export const searxngBackend = {
  id: "searxng",
  requiresCredential: false,

  available(options) {
    // Keyless by default, but can use API key for private instances
    return true;
  },

  async search(request, signal, options, hooks) {
    throwIfSearchAborted(signal);
    const backendOpts = options ?? {};

    const baseURL = backendOpts.baseURL ?? DEFAULT_SEARXNG_URL;
    const apiKey = await backendOpts.resolveApiKey?.(); // Optional for private instances
    
    const url = new URL(baseURL);
    url.pathname = url.pathname.replace(/\/+$/,"") + "/search";
    url.searchParams.set("q", request.query);
    url.searchParams.set("format", "json");
    url.searchParams.set("categories", "general");
    // Language: settings/request filter wins, else historical "en" default.
    const filters = normalizeFilters(request.filters);
    url.searchParams.set("language", filters.lang ?? "en");
    applySearxngFilters(url, filters); // time_range (+ language override)
    // Safe-search defaults ON (preserves the previous hardcoded behavior).
    url.searchParams.set("safesearch", safeSearchParams("searxng", backendOpts.safeSearch ?? true) ?? "1");
    url.searchParams.set("pageno", "1");

    const headers = {
      "Accept": "application/json",
      "User-Agent": "dsh-websearch/2.1",
    };
    
    if (apiKey) {
      headers["Authorization"] = "Bearer " + apiKey;
    }

    hooks?.recordRequest?.({
      endpoint: baseURL,
      toolName: "searxng_search",
      body: { q: request.query },
    });

    let response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers,
        signal,
      });
    } catch (error) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
      throw new WebError("SearXNG request failed: " + error +
        " (instance unreachable? point searxngBaseURL at another public instance)", "WEB_PROVIDER_ERROR", { cause: error });
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      hooks?.recordOutcome?.({ status: "error", message: "HTTP " + response.status + ": " + text });
      throw new WebError("SearXNG API error (HTTP " + response.status + "): " + text, "WEB_PROVIDER_ERROR");
    }

    let data;
    try {
      data = await response.json();
    } catch (error) {
      throw new WebError("SearXNG: invalid JSON response", "WEB_PROVIDER_ERROR", { cause: error });
    }

    const sources = parseSearxngResult(data, request.maxResults ?? 8);
    hooks?.recordOutcome?.({ status: "success", count: sources.length });
    return { sources };
  },
};

/**
 * Parse SearXNG API response.
 * @param {object} data
 * @param {number} maxResults
 */
export function parseSearxngResult(data, maxResults) {
  const sources = [];
  const results = data?.results ?? [];
  
  for (const item of results) {
    if (sources.length >= maxResults) break;
    if (!item?.url) continue;
    sources.push({
      url: item.url,
      ...(item.title ? { title: item.title } : {}),
      ...(item.content ? { snippet: item.content.slice(0, 500) } : {}),
      ...(item.engine ? { sourceEngine: item.engine } : {}),
    });
  }
  
  return sources;
}
