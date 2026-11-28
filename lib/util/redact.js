/**
 * Credential redaction for text that leaves the plugin.
 *
 * Backends forward upstream error bodies, and providers sometimes echo the
 * presented key back ("Incorrect API key provided: sk-live-…"). That text
 * reaches the host log, the health/history payload, the telemetry line, and
 * the model-visible failure message; none of those may carry a key.
 *
 * @module lib/util/redact
 */

/** Token shapes we can recognise without knowing the issuing vendor. */
const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{8,}/g,
  /tvly-[A-Za-z0-9_-]{8,}/g,
  /BSA[A-Za-z0-9_-]{16,}/g,
  /exa_[A-Za-z0-9_-]{8,}/g,
  /ghp_[A-Za-z0-9]{16,}/g,
  /github_pat_[A-Za-z0-9_]{16,}/g,
  /npm_[A-Za-z0-9]{16,}/g,
  /cfut_[A-Za-z0-9_-]{16,}/g,
  /Bearer\s+[A-Za-z0-9._-]{8,}/gi,
  /(api[_-]?key|token|secret|password)\s*[=:]\s*["']?[^\s"',]{6,}/gi,
  // Vendor-neutral high-entropy fallbacks: upstreams that echo an arbitrary
  // key (Mojeek/Serper/private gateways) do not use a recognisable prefix.
  /\b[0-9a-f]{32,}\b/gi,
  /\b[A-Za-z0-9_-]{32,}\b/g,
];

/**
 * Replace token-like fragments with `[redacted]`.
 *
 * @param {unknown} value - text to sanitize; non-strings stringify first.
 * @returns {string} redacted text.
 */
export function redact(value) {
  let text = value instanceof Error ? value.message : String(value ?? "");
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, "[redacted]");
  return text;
}

/**
 * Redact, collapse whitespace, and bound length for diagnostics/UI.
 *
 * @param {unknown} value - error or text to sanitize.
 * @param {number} [maxChars] - maximum output length.
 * @returns {string} safe, bounded text.
 */
export function sanitizeError(value, maxChars = 120) {
  if (value === null || value === undefined) return "";
  const text = redact(value).replace(/\s+/g, " ").trim();
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}
