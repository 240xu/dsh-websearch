// util/time.js — normalize publisher dates to the ISO-8601 the web seam declares.

/**
 * Convert a date-shaped value to an ISO-8601 timestamp. Relative ages ("2 days
 * ago") and invalid dates are dropped rather than passed through as if they
 * were ISO; the seam's `publishedAt` is defined as ISO-8601.
 * @param {unknown} raw
 * @returns {string | undefined}
 */
export function isoPublishedAt(raw) {
  if (typeof raw !== "string") return undefined;
  const text = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(text)) return undefined;
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) return undefined;
  try {
    return new Date(ms).toISOString();
  } catch {
    return undefined;
  }
}
