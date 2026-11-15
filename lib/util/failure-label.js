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
// disable a backend for years. Anything beyond a day falls back to the default.
const MAX_RETRY_AFTER_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RETRY_AFTER_MS = 60_000;

/**
 * Best-effort Retry-After extraction, in milliseconds. webErrorFromResponse()
 * stores the raw header on err.retryAfter; older errors fall back to 60s.
 * @returns {number} cooldown in milliseconds
 */
export function retryAfterMsFrom(err) {
  const v = err?.retryAfter
    ?? err?.cause?.response?.headers?.get?.("retry-after")
    ?? err?.cause?.retryAfter;
  if (v == null || String(v).trim() === "") return DEFAULT_RETRY_AFTER_MS;
  const secs = Number(v);
  if (Number.isFinite(secs)) {
    if (secs < 0) return DEFAULT_RETRY_AFTER_MS;
    const ms = secs * 1000;
    return ms <= MAX_RETRY_AFTER_MS ? ms : DEFAULT_RETRY_AFTER_MS;
  }
  const date = Date.parse(v);
  if (!Number.isFinite(date)) return DEFAULT_RETRY_AFTER_MS;
  // An http-date in the past (clock skew, already-expired window) must not
  // become a zero-length cooldown; treat it as unknown and use the default.
  const ms = date - Date.now();
  return ms > 0 && ms <= MAX_RETRY_AFTER_MS ? ms : DEFAULT_RETRY_AFTER_MS;
}
