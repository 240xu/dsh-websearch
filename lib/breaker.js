// breaker.js — v2.7.0 per-backend circuit breaker (pure functions, zero deps).
//
// State lives ON the backend health entry (the same object recordBackendHealth
// in provider.js maintains), as two extra fields:
//   failCount  — consecutive failures (reset to 0 on any success)
//   openUntil  — epoch ms until which the backend is skipped; 0 = closed
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
 * @returns {{ failCount: number, openUntil: number }}
 */
export function foldBreaker(prev, ok, nowMs, cfg = {}) {
  const threshold = Math.max(1, Math.floor(Number(cfg.threshold) || BREAKER_DEFAULTS.threshold));
  // cooldownMs === 0 explicitly disables the cooldown window (openUntil = now
  // expires instantly). Only null/undefined falls back to the default — an
  // explicit 0 must not silently become 60s (arch-review P2 note).
  const cooldownMs = cfg.cooldownMs != null
    ? Math.max(0, Math.floor(Number(cfg.cooldownMs) || 0))
    : BREAKER_DEFAULTS.cooldownMs;
  if (ok) return { failCount: 0, openUntil: 0 };
  const failCount = (Number.isFinite(prev?.failCount) ? prev.failCount : 0) + 1;
  if (failCount >= threshold) {
    return { failCount, openUntil: nowMs + cooldownMs };
  }
  // Keep an existing open window if the backend was already open (failure
  // while open extends nothing, but must not silently close it).
  return { failCount, openUntil: Number.isFinite(prev?.openUntil) ? prev.openUntil : 0 };
}

/**
 * Is the backend currently in its cooldown window?
 * @param {object|undefined} entry  health entry (failCount/openUntil optional)
 * @param {number} nowMs
 */
export function isCooled(entry, nowMs = Date.now()) {
  const openUntil = entry?.openUntil;
  return Number.isFinite(openUntil) && openUntil > nowMs;
}

/**
 * Human telemetry annotation for a cooled backend, e.g. "⏸cooled 42s".
 * Empty string when not cooled.
 */
export function cooledAnnotation(entry, nowMs = Date.now()) {
  if (!isCooled(entry, nowMs)) return "";
  const restS = Math.max(0, Math.ceil((entry.openUntil - nowMs) / 1000));
  return `⏸cooled ${restS}s`;
}
