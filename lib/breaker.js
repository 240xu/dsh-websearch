// breaker.js — v2.7.0 per-backend circuit breaker (pure functions, zero deps).
//
// State lives ON the backend health entry (the same object recordBackendHealth
// in provider.js maintains), as two extra fields:
//   failCount  — consecutive failures (reset to 0 on any success)
//   cooledUntil  — epoch ms until which the backend is skipped; 0 = closed
// Breaker opens when failCount reaches threshold and stays open for
// cooldownMs. Failure modes are deliberately conservative: unknown state or
// missing fields never trip; a fully-cooled fan-out falls back to running
// every backend (fail-open) so the breaker can never make search WORSE than
// no breaker.

/** Default breaker tuning (settings can override; cooldownMs 0 = disabled). */
export const BREAKER_DEFAULTS = {
  threshold: 3,
  cooldownMs: 60_000,
};

/**
 * Fold one backend outcome into the breaker fields of a health entry.
 * Pure: returns the new fields; caller merges into the entry.
 *
 * @param {object|undefined} prev  previous entry (may be undefined)
 * @param {boolean} ok             did this call succeed?
 * @param {number} nowMs
 * @param {{threshold?: number, cooldownMs?: number}} cfg
 * @param {{rateLimited?: boolean, retryAfterMs?: number}} [opts] - a quota
 *   failure cools the backend immediately instead of waiting for threshold.
 * @returns {{ failCount: number, cooledUntil: number }}
 */
export function foldBreaker(prev, ok, nowMs, cfg = {}, opts = {}) {
  const threshold = Math.max(1, Math.floor(Number(cfg.threshold) || BREAKER_DEFAULTS.threshold));
  // cooldownMs === 0 explicitly disables the cooldown window (cooledUntil = now
  // expires instantly). Only null/undefined falls back to the default — an
  // explicit 0 must not silently become 60s (arch-review P2 note).
  const cooldownMs = cfg.cooldownMs != null
    ? Math.max(0, Math.floor(Number(cfg.cooldownMs) || 0))
    : BREAKER_DEFAULTS.cooldownMs;
  if (ok) return { failCount: 0, cooledUntil: 0 };
  // A cooldown window that has already expired starts a fresh failure streak;
  // otherwise failCount grows monotonically across unrelated outages.
  // cooledUntil === 0 means "never opened", so the streak still accumulates.
  const hadOpenWindow = Number.isFinite(prev?.cooledUntil) && prev.cooledUntil > 0;
  const expired = hadOpenWindow && prev.cooledUntil <= nowMs;
  const baseCount = Number.isFinite(prev?.failCount) ? prev.failCount : 0;
  const failCount = expired ? 1 : baseCount + 1;
  const prevCooledUntil = expired ? 0 : (Number.isFinite(prev?.cooledUntil) ? prev.cooledUntil : 0);
  // A rate-limit/quota response should not be retried twice more just to
  // reach the failure threshold; cool immediately for the retry window.
  if (opts.rateLimited === true) {
    // A quota answer carries its own Retry-After; without one, fall back to
    // the configured cooldown. A zero here means "count only", matching the
    // threshold path above.
    const retryAfterMs = Number.isFinite(opts.retryAfterMs) ? opts.retryAfterMs : cooldownMs;
    return { failCount, cooledUntil: retryAfterMs > 0 ? nowMs + retryAfterMs : 0 };
  }
  if (failCount >= threshold) {
    // cooldownMs === 0 means "count only, never cool": writing a window of
    // zero length would immediately look expired and reset the streak, so the
    // threshold could never be reached again.
    return { failCount, cooledUntil: cooldownMs > 0 ? nowMs + cooldownMs : 0 };
  }
  // Keep an existing open window if the backend was already open (failure
  // while open extends nothing, but must not silently close it).
  return { failCount, cooledUntil: prevCooledUntil };
}

/**
 * Is the backend currently in its cooldown window?
 * @param {object|undefined} entry  health entry (failCount/cooledUntil optional)
 * @param {number} nowMs
 */
export function isCooled(entry, nowMs = Date.now()) {
  const cooledUntil = entry?.cooledUntil;
  return Number.isFinite(cooledUntil) && cooledUntil > nowMs;
}

/**
 * Human telemetry annotation for a cooled backend, e.g. "⏸cooled 42s".
 * Empty string when not cooled.
 */
export function cooledAnnotation(entry, nowMs = Date.now()) {
  if (!isCooled(entry, nowMs)) return "";
  const restS = Math.max(0, Math.ceil((entry.cooledUntil - nowMs) / 1000));
  return `⏸cooled ${restS}s`;
}
