/**
 * Serper.dev (Google Scraper) backend for dsh-websearch.
 * REST API: https://google.serper.dev/search
 * Auth: X-API-KEY header
 * Free tier: 2,500 requests/month
 */

import { WebError } from "@deepseek-ai/dsh-web";
import { throwIfSearchAborted, searchAborted, isAbortError } from "../util/abort.js";
import { applySerperFilters, normalizeFilters } from "../util/filters.js";

const SERPER_ENDPOINT = "https://google.serper.dev/search";

/** @type {import("../provider.js").Backend} */
export const serperBackend = {
  id: "serper",
  requiresCredential: true,

  available(options) {
    return typeof options?.resolveApiKey === "function";
  },

  async search(request, signal, options, hooks) {
    throwIfSearchAborted(signal);
    const backendOpts = options ?? {};

    const apiKey = await backendOpts.resolveApiKey?.();
    if (!apiKey) {
      throw new WebError("Serper: API key not configured", "WEB_PROVIDER_UNAVAILABLE");
    }

    const baseURL = backendOpts.baseURL ?? SERPER_ENDPOINT;
    const count = Math.min(request.maxResults ?? 8, 20);

    const body = {
      q: request.query,
      num: count,
    };
    applySerperFilters(body, normalizeFilters(request.filters));

    hooks?.recordRequest?.({
      endpoint: baseURL,
      toolName: "serper_search",
      body,
    });

    let response;
    try {
      response = await fetch(baseURL, {
        method: "POST",
        headers: {
          "X-API-KEY": apiKey,
          "Content-Type": "application/json",
          "Accept": "application/json",
          "User-Agent": "dsh-websearch/2.1",
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
      throw new WebError("Serper request failed: " + error, "WEB_PROVIDER_ERROR", { cause: error });
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      hooks?.recordOutcome?.({ status: "error", message: "HTTP " + response.status + ": " + text });
      throw new WebError("Serper API error (HTTP " + response.status + "): " + text, "WEB_PROVIDER_ERROR");
    }

    let data;
    try {
      data = await response.json();
    } catch (error) {
      throw new WebError("Serper: invalid JSON response", "WEB_PROVIDER_ERROR", { cause: error });
    }

    const sources = parseSerperResult(data, request.maxResults ?? 8);
    hooks?.recordOutcome?.({ status: "success", count: sources.length });
    return { sources };
  },
};

/**
 * Parse Serper API response.
 * @param {object} data
 * @param {number} maxResults
 */
export function parseSerperResult(data, maxResults) {
  const sources = [];
  const organic = data?.organic ?? [];
  
  for (const item of organic) {
    if (sources.length >= maxResults) break;
    if (!item?.link) continue;
    sources.push({
      url: item.link,
      ...(item.title ? { title: item.title } : {}),
      ...(item.snippet ? { snippet: item.snippet.slice(0, 500) } : {}),
    });
  }
  
  // Also include news results if present
  const news = data?.news ?? [];
  for (const item of news) {
    if (sources.length >= maxResults) break;
    if (!item?.link) continue;
    sources.push({
      url: item.link,
      ...(item.title ? { title: item.title } : {}),
      ...(item.snippet ? { snippet: item.snippet.slice(0, 500) } : {}),
      ...(item.date ? { publishedAt: item.date } : {}),
    });
  }
  
  return sources;
}
