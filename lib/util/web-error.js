// web-error.js — shared HTTP-failure constructor for the unified search
// provider. WebError (published dsh-web) extends HarnessError, whose
// constructor consumes only `cause`; extra fields must be assigned after
// construction. Keeping that in one place preserves `instanceof WebError`
// and the cause chain while giving the breaker machine-routable fields.

import { WebError } from "@deepseek-ai/dsh-web";

/** Canonical codes from dsh-llm/lib/types/error.js (RATE_LIMIT example, QUOTA_EXCEEDED_CODE). */
export const RATE_LIMIT_CODE = "RATE_LIMIT";
export const QUOTA_CODE = "QUOTA";

function headerValue(response, name) {
  try { return response?.headers?.get?.(name) ?? undefined; } catch { return undefined; }
}

/**
 * Build a WebError from a non-2xx Response. egressFetch already constructs a
 * Response with status + full headers, so Retry-After is reachable here.
 * @param {Response} response - the non-2xx response.
 * @param {string} text - already-bounded upstream body.
 * @param {string} label - backend name for the human-readable message.
 * @param {{cause?: unknown}} [opts] - optional underlying error.
 * @returns {WebError} error carrying status, retryAfter, rateLimited and code.
 */
export function webErrorFromResponse(response, text, label, opts = {}) {
  const status = Number(response?.status) || 0;
  const retryAfter = headerValue(response, "retry-after");
  const rateLimited = status === 429;
  // 402 is an explicit payment/quota signal. 403 is ambiguous (invalid key,
  // forbidden, or quota) so it must NOT be classified as quota here; treating
  // every 403 as quota would cool a backend for a bad credential.
  const quota = status === 402;
  const code = rateLimited ? RATE_LIMIT_CODE
    : quota ? QUOTA_CODE
      : "WEB_PROVIDER_ERROR";
  const message = `${label} API error (HTTP ${status}): ${String(text ?? "").slice(0, 140)}`;
  const err = new WebError(
    message,
    code,
    opts.cause === undefined ? undefined : { cause: opts.cause },
  );
  // HarnessError `super(message, options)` only accepts cause; attach the rest.
  err.status = status;
  err.retryAfter = retryAfter;
  err.rateLimited = rateLimited;
  err.quota = quota;
  return err;
}
