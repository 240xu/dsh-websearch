/**
 * Mojeek backend for dsh-websearch.
 * REST API: https://api.mojeek.com/v1/search
 * Auth: Authorization: Bearer {apiKey} header or api_key query param
 * Free tier: 1,000 requests/day
 */

import { WebError } from "@deepseek-ai/dsh-web";
import { throwIfSearchAborted, searchAborted, isAbortError } from "../util/abort.js";

const MOJEEK_ENDPOINT = "https://api.mojeek.com/v1/search";

/** @type {import("../provider.js").Backend} */
export const mojeekBackend = {
  id: "mojeek",
  requiresCredential: true,

  available(options) {
    return typeof options?.resolveApiKey === "function";
  },

  async search(request, signal, options, hooks) {
    throwIfSearchAborted(signal);
    const backendOpts = options ?? {};

    const apiKey = await backendOpts.resolveApiKey?.();
    if (!apiKey) {
      throw new WebError("Mojeek: API key not configured", "WEB_PROVIDER_UNAVAILABLE");
    }

    const baseURL = backendOpts.baseURL ?? MOJEEK_ENDPOINT;
    const count = Math.min(request.maxResults ?? 8, 20);
    
    const url = new URL(baseURL);
    url.searchParams.set("q", request.query);
    url.searchParams.set("fmt", "json");
    url.searchParams.set("count", String(count));

    // Auth via Authorization header — keeps the API key out of URLs (which
    // leak into logs, history and referer headers).
    const headers = {
      "Accept": "application/json",
      "Authorization": "Bearer " + apiKey,
      "User-Agent": "dsh-websearch/2.1",
    };

    hooks?.recordRequest?.({
      endpoint: baseURL,
      toolName: "mojeek_search",
      body: { q: request.query, count },
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
      throw new WebError("Mojeek request failed: " + error, "WEB_PROVIDER_ERROR", { cause: error });
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      hooks?.recordOutcome?.({ status: "error", message: "HTTP " + response.status + ": " + text });
      throw new WebError("Mojeek API error (HTTP " + response.status + "): " + text, "WEB_PROVIDER_ERROR");
    }

    let data;
    try {
      data = await response.json();
    } catch (error) {
      throw new WebError("Mojeek: invalid JSON response", "WEB_PROVIDER_ERROR", { cause: error });
    }

    const sources = parseMojeekResult(data, request.maxResults ?? 8);
    hooks?.recordOutcome?.({ status: "success", count: sources.length });
    return { sources };
  },
};

/**
 * Parse Mojeek API response.
 * @param {object} data
 * @param {number} maxResults
 */
export function parseMojeekResult(data, maxResults) {
  const sources = [];
  const results = data?.response?.results ?? [];
  
  for (const item of results) {
    if (sources.length >= maxResults) break;
    if (!item?.url) continue;
    sources.push({
      url: item.url,
      ...(item.title ? { title: item.title } : {}),
      ...(item.desc ? { snippet: item.desc.slice(0, 500) } : {}),
      ...(item.last_updated ? { publishedAt: item.last_updated } : {}),
    });
  }
  
  return sources;
}
