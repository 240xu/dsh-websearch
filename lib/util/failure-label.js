// failure-label.js — classify quota/rate-limit failures. Route on the stable
// `code` / `status` / `rateLimited` fields first (HarnessError JSDoc:
// "route on this, never by parsing message"). The message regex is a legacy
// fallback for errors built before webErrorFromResponse() landed.

import { RATE_LIMIT_CODE, QUOTA_CODE } from "./web-error.js";

/** True when the error indicates a keyless permission refusal (needs a key,
 *  not a retry). The Firecrawl hosted MCP returns this as an isError result. */
export function keylessRejected(err) {
  if (err?.keylessRejected === true) return true;
  const s = String(err?.message ?? err);
  return /Anonymous keyless access is unavailable|keyless access is unavailable/i.test(s);
}

/** True when the error is a rate limit or exhausted quota. */
export function rateLimited(err) {
  if (err?.code === RATE_LIMIT_CODE || err?.code === QUOTA_CODE) return true;
  if (err?.rateLimited === true || err?.quota === true) return true;
  if (Number(err?.status) === 429) return true;
  if (typeof err?.providerCode === "string"
      && /^(rate_limit_error|quota_exceeded|insufficient_quota)$/.test(err.providerCode)) return true;
  // Legacy fallback for pre-helper errors. Bare "quota" and generic
  // "anonymous" are deliberately excluded: they produced false positives on
  // HTTP 200/402/503 bodies. Only Firecrawl's exact keyless MCP isError text
  // is matched; it never passes through webErrorFromResponse().
  const s = String(err?.message ?? err);
  return /HTTP 429|429\b|rate.?limit/i.test(s)
    || /额度/i.test(s)
    || /Anonymous keyless access is unavailable/i.test(s);
}

// Cap a server-supplied cooldown so a bogus or hostile Retry-After cannot
// disable a backend for years. Anything beyond a day is treated as unknown.
const MAX_RETRY_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Best-effort Retry-After extraction, in milliseconds. webErrorFromResponse()
 * stores the raw header on err.retryAfter.
 *
 * Returns `undefined` when the response carried no usable header — including
 * an unparsable value, a past http-date, or a value beyond the one-day cap.
 * The breaker then falls back to the configured `breakerCooldownMs`, so
 * `0 = count only` keeps working for header-less 429s instead of silently
 * becoming 60 seconds.
 *
 * @returns {number|undefined} explicit cooldown in milliseconds, if any
 */
export function retryAfterMsFrom(err) {
  const v = err?.retryAfter
    ?? err?.cause?.response?.headers?.get?.("retry-after")
    ?? err?.cause?.retryAfter;
  if (v == null || String(v).trim() === "") return undefined;
  const secs = Number(v);
  if (Number.isFinite(secs)) {
    if (secs < 0) return undefined;
    const ms = secs * 1000;
    return ms <= MAX_RETRY_AFTER_MS ? ms : undefined;
  }
  const date = Date.parse(v);
  if (!Number.isFinite(date)) return undefined;
  // An http-date in the past (clock skew, already-expired window) must not
  // become a zero-length cooldown; treat it as unknown.
  const ms = date - Date.now();
  return ms > 0 && ms <= MAX_RETRY_AFTER_MS ? ms : undefined;
}

/**
 * @param {string} id backend id (searxng gets a dedicated phrasing)
 * @param {string} raw failure message (already truncated by the caller)
 * @returns {string|undefined} short label, or undefined to keep the raw text
 */
export function failureLabel(id, raw) {
  const m = String(raw ?? "");
  if (m === "") return undefined;
  if (/(invalid JSON|anti-bot|not a bot|antibot|captcha|challenge page|verifying your browser)/i.test(m)) {
    return id === "searxng"
      ? "instance degraded (anti-bot/non-JSON page)"
      : "non-JSON response (bot wall?)";
  }
  if (/timed out after \d+ms/.test(m)) return "timeout (network slow/blocked)";
  // Proxy/forwarder-path failures get their own class: the route5 incident
  // (harness EnvHttpProxyAgent hijacking the sidecar request) surfaced as a
  // generic "fetch failed", pointing the reader at DNS/TLS when the actual
  // fault was the proxy/egress hop. Match explicit proxy markers first: a bare
  // /CONNECT/i also matched "connect ECONNREFUSED", mislabelling ordinary
  // network failures as proxy failures.
  if (/proxy\s+(response|connect|tunnel)|HTTP Tunneling|CONNECT tunnel|forwarder|sidecar/i.test(m)) {
    return "proxy/forwarder path failed";
  }
  if (/(fetch failed|connection refused|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|ECONNRESET|EPIPE|socket hang up|certificate|TLS)/i.test(m)) {
    return "network unreachable (DNS/TCP/TLS)";
  }
  if (/HTTP 429|Too Many Requests|rate.?limit/i.test(m)) return "rate-limited (HTTP 429)";
  const s5 = /HTTP (5\d\d)/.exec(m);
  if (s5) return "server error (HTTP " + s5[1] + ")";
  const s4 = /HTTP (40[13]|\b403\b)/.exec(m);
  if (s4) return "blocked (HTTP " + s4[1] + ")";
  if (/lacks a results\[\] array|not a SearXNG API/.test(m)) return "unexpected API shape";
  return undefined;
}
