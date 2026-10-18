/**
 * SearXNG backend for dsh-websearch.
 * REST API: {baseURL}/search?q={query}&format=json&categories=general&language=en&safesearch=1
 * Auth: None (public instances) or API key for private instances
 * Free tier: Unlimited (public instances)
 * Default instance: https://searx.be
 *
 * Health is SEMANTIC (route3/route6): HTTP 200 alone means nothing — public
 * instances answer non-browser clients with anti-bot interstitials (searx.be
 * served an 11 KB "Verifying your browser…" page with status 200). A response
 * only counts as healthy when it parses as JSON AND carries a results[]
 * array (validation); an empty results[] is a legitimate empty search.
 */

import { WebError } from "@deepseek-ai/dsh-web";
import { throwIfSearchAborted, searchAborted, isAbortError } from "../util/abort.js";
import { applySearxngFilters, normalizeFilters, safeSearchParams } from "../util/filters.js";
import { egressFetch } from "../util/egress-fetch.js";
import { describeError } from "../util/describe-error.js";

const DEFAULT_SEARXNG_URL = "https://searx.be";

// Markers of anti-bot / interstitial pages seen across public instances
// (route3 matrix: Anubis "Making sure you're not a bot!", Substation
// "Security check", cookie challenges, searx.be's own "Verifying your
// browser…"). Used only to CLASSIFY a non-JSON 200 for telemetry/health —
// there is deliberately no evasion logic here (no JS, no cookie forging).
const ANTI_BOT_RE = /(verifying your browser|making sure you.?re not a bot|checking you are not a bot|anubis|antibot|security check|just a moment|enable javascript|captcha|browser verification)/i;

// Multi-instance failover (opt-in via searxngBaseURLs; route3 §5.4 draft).
// Public-instance 429/anti-bot windows run 5-8+ minutes, so a failed instance
// is rotated out (not retried every search); a success clears its cooldown.
// Fail-open: when every candidate is cooling down we still try them all —
// rotation must never make search worse than the single-instance status quo.
const INSTANCE_COOLDOWN_MS = 10 * 60_000;
const INSTANCE_ATTEMPT_TIMEOUT_MS = 4500;
const instanceCooldowns = new Map(); // baseURL -> cooledUntil (epoch ms)

/** Test hook: clear per-instance cooldowns between cases. */
export function resetInstanceCooldowns() {
  instanceCooldowns.clear();
}

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

    const candidates = [];
    for (const candidate of [baseURL, ...(Array.isArray(backendOpts.baseURLs) ? backendOpts.baseURLs : [])]) {
      const trimmed = typeof candidate === "string" ? candidate.trim() : "";
      if (trimmed !== "" && !candidates.includes(trimmed)) candidates.push(trimmed);
    }

    // Single instance (the default): legacy path, unchanged semantics.
    if (candidates.length === 1) {
      const sources = await queryInstance(candidates[0], request, signal, backendOpts, apiKey, hooks);
      return { sources };
    }

    // Multi-instance: sequential attempts (etiquette: never fan out against
    // volunteer instances), per-instance soft timeout, cooldown on failure.
    const now = Date.now();
    const fresh = candidates.filter((u) => (instanceCooldowns.get(u) ?? 0) <= now);
    const order = fresh.length > 0 ? fresh : candidates; // all cooled -> fail-open
    let lastErr = null;
    for (const candidate of order) {
      throwIfSearchAborted(signal);
      const attemptController = new AbortController();
      const attemptSignal = signal ? AbortSignal.any([signal, attemptController.signal]) : attemptController.signal;
      const timer = setTimeout(() => attemptController.abort(), INSTANCE_ATTEMPT_TIMEOUT_MS);
      try {
        const sources = await queryInstance(candidate, request, attemptSignal, backendOpts, apiKey, hooks);
        instanceCooldowns.delete(candidate);
        return { sources };
      } catch (error) {
        if (signal?.aborted === true) throw searchAborted(signal, error);
        instanceCooldowns.set(candidate, Date.now() + INSTANCE_COOLDOWN_MS);
        if (attemptController.signal.aborted && !(signal && signal.aborted)) {
          lastErr = new WebError(
            `SearXNG instance attempt timed out after ${INSTANCE_ATTEMPT_TIMEOUT_MS}ms (${candidate})`,
            "WEB_PROVIDER_ERROR",
            { cause: error instanceof Error ? error : undefined },
          );
        } else if (error instanceof WebError && error.code !== "WEB_ABORTED") {
          lastErr = error;
        } else {
          lastErr = new WebError(
            "SearXNG instance failed (" + candidate + "): " + describeError(error),
            "WEB_PROVIDER_ERROR",
            { cause: error instanceof Error ? error : undefined },
          );
        }
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr ?? new WebError("SearXNG: no instance available (all cooling down)", "WEB_PROVIDER_ERROR");
  },
};

/**
 * One request against one instance. Throws WebError on any failure; abort
 * semantics are the caller's contract (signal passed through verbatim).
 * @returns {Promise<Array>} sources
 */
async function queryInstance(baseURL, request, signal, backendOpts, apiKey, hooks) {
  const url = new URL(baseURL);
  url.pathname = url.pathname.replace(/\/+$/,"") + "/search";
  url.searchParams.set("q", request.query);
  url.searchParams.set("format", "json");
  // deepCoverage widens the category sweep (docs.searxng.org Search API:
  // categories is a comma-separated list) — breadth over one category.
  url.searchParams.set("categories", request.deepCoverage === true ? "general,news,it" : "general");
  // Language: settings/request filter wins, else historical "en" default.
  const filters = normalizeFilters(request.filters);
  url.searchParams.set("language", filters.lang ?? "en");
  applySearxngFilters(url, filters); // time_range (+ language override)
  // Safe-search defaults ON (preserves the previous hardcoded behavior).
  url.searchParams.set("safesearch", safeSearchParams("searxng", backendOpts.safeSearch ?? true) ?? "1");
  url.searchParams.set("pageno", "1");

  const headers = {
    "Accept": "application/json",
    "User-Agent": "dsh-websearch/2.3",
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
    response = await egressFetch(url, {
      method: "GET",
      headers,
      redirect: "error",
      signal,
    });
  } catch (error) {
    if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
    throw new WebError("SearXNG request failed: " + describeError(error) +
      " (instance unreachable? point searxngBaseURL at another public instance)", "WEB_PROVIDER_ERROR", { cause: error });
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "").then((tx) => tx.slice(0, 300));
    hooks?.recordOutcome?.({ status: "error", message: "HTTP " + response.status + ": " + text });
    if (response.status === 429 || response.status >= 500) {
      throw new WebError("SearXNG API error (HTTP " + response.status + "): " + text + " (instance struggling? point searxngBaseURL at another public instance)", "WEB_PROVIDER_ERROR");
    }
    throw new WebError("SearXNG API error (HTTP " + response.status + "): " + text, "WEB_PROVIDER_ERROR");
  }

  // 200 does not mean JSON (route3: searx.be 200 + HTML anti-bot page). Read
  // the body once and classify the parse failure so the failure reads as
  // "instance degraded", not like a plugin bug.
  const bodyText = await response.text();
  // Optional chain: fetch shims/mocks may omit headers; a real Response never does.
  const contentType = String(response.headers?.get?.("content-type") ?? "");
  let data;
  try {
    data = JSON.parse(bodyText);
  } catch (error) {
    const antiBot = /text\/html/i.test(contentType) || ANTI_BOT_RE.test(bodyText.slice(0, 4096));
    const message = antiBot
      ? "SearXNG instance degraded: returned an anti-bot challenge page (HTTP 200, non-JSON)"
      : "SearXNG: invalid JSON response (content-type: " + (contentType || "unknown") + ")";
    hooks?.recordOutcome?.({ status: "error", message });
    throw new WebError(message, "WEB_PROVIDER_ERROR", { cause: error });
  }

  // Semantic health gate: a SearXNG API response always carries a results[]
  // array; JSON without one (walls/proxies wrapping errors in 200s) is a
  // protocol violation, not an empty search.
  if (!Array.isArray(data?.results)) {
    const message = "SearXNG: JSON response lacks a results[] array (not a SearXNG API response?)";
    hooks?.recordOutcome?.({ status: "error", message });
    throw new WebError(message, "WEB_PROVIDER_ERROR");
  }

  const sources = parseSearxngResult(data, request.maxResults ?? 8);
  hooks?.recordOutcome?.({ status: "success", count: sources.length });
  return sources;
}

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
