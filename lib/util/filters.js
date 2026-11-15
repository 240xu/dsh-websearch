/**
 * @module dsh-websearch/util/filters
 *
 * Normalized cross-backend search filters.
 *
 * The provider resolves ONE canonical filter shape from settings + request:
 *   { recency?: "day"|"week"|"month"|"year", lang?: string, region?: string }
 *
 * Each REST backend maps only the dimensions it supports (via the apply*
 * helpers below); unsupported dimensions are silently ignored so a single
 * settings panel can drive every backend without lying about reach.
 * All functions are pure and unit-tested in tests/filters.test.js.
 */

/** Canonical recency values accepted from settings/request. */
export const RECENCY_VALUES = ["day", "week", "month", "year"];

/**
 * Backend-specific recency vocabularies:
 *   brave: freshness=pd|pw|pm|py ; tavily: time_range=day|week|month|year;
 *   serper: tbs=qdr:d|w|m|y (Google date syntax); searxng: time_range=*;
 *   ddg: df=d|w|m|y (html endpoint date filter).
 */
const RECENCY_MAP = {
  brave: { day: "pd", week: "pw", month: "pm", year: "py" },
  tavily: { day: "day", week: "week", month: "month", year: "year" },
  serper: { day: "qdr:d", week: "qdr:w", month: "qdr:m", year: "qdr:y" },
  searxng: { day: "day", week: "week", month: "month", year: "year" },
  ddg: { day: "d", week: "w", month: "m", year: "y" },
};

/**
 * Validate + normalize a raw filter bag. Unknown keys and out-of-vocabulary
 * values are dropped: a typo must degrade to "no filter", never break search.
 */
export function normalizeFilters(raw) {
  if (!raw || typeof raw !== "object") return {};
  const out = {};
  if (typeof raw.recency === "string" && RECENCY_VALUES.includes(raw.recency)) {
    out.recency = raw.recency;
  }
  if (typeof raw.lang === "string" && raw.lang.trim().length > 0) out.lang = raw.lang.trim();
  if (typeof raw.region === "string" && raw.region.trim().length > 0) out.region = raw.region.trim();
  return out;
}

/** Backend-specific recency token, or undefined when unsupported/unset. */
export function recencyToken(backendId, filters) {
  const v = filters && filters.recency;
  if (!v) return undefined;
  const row = RECENCY_MAP[backendId];
  return row ? row[v] : undefined;
}

/** Brave: freshness + optional country/search_lang (ISO-ish codes passed through). */
export function applyBraveFilters(url, filters) {
  const fresh = recencyToken("brave", filters);
  if (fresh) url.searchParams.set("freshness", fresh);
  if (filters && filters.region) url.searchParams.set("country", filters.region);
  if (filters && filters.lang) url.searchParams.set("search_lang", filters.lang);
  return url;
}

/** Tavily: time_range body field. */
export function applyTavilyFilters(body, filters) {
  const tr = recencyToken("tavily", filters);
  if (tr) body.time_range = tr;
  return body;
}

/** Serper: Google tbs date syntax + hl (interface lang) / gl (country). */
export function applySerperFilters(body, filters) {
  const tbs = recencyToken("serper", filters);
  if (tbs) body.tbs = tbs;
  if (filters && filters.lang) body.hl = filters.lang;
  if (filters && filters.region) body.gl = filters.region;
  return body;
}

/** SearXNG: native time_range + language query params. */
export function applySearxngFilters(url, filters) {
  const tr = recencyToken("searxng", filters);
  if (tr) url.searchParams.set("time_range", tr);
  if (filters && filters.lang) url.searchParams.set("language", filters.lang);
  return url;
}

/** DuckDuckGo html endpoint: df (date filter) form field, best-effort. */
export function applyDdgFilters(formParams, filters) {
  const df = recencyToken("ddg", filters);
  if (df) formParams.set("df", df);
  return formParams;
}

/**
 * Safe-search parameter per backend (null = omit / unsupported):
 *   searxng -> "1"|"0" ; brave -> "strict"|"off".
 */
export function safeSearchParams(backendId, enabled) {
  if (enabled === undefined || enabled === null) return null;
  if (backendId === "searxng") return enabled ? "1" : "0";
  if (backendId === "brave") return enabled ? "strict" : "off";
  return null;
}
