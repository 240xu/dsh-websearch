/**
 * @module @deepseek-ai/dsh-websearch/util/abort
 *
 * Abort/cancellation plumbing for the unified search provider. The provider
 * fan-outs to multiple backends concurrently; every backend's fetch must
 * observe the caller's signal so a cancelled search releases network quota.
 *
 * Two WebError codes the seam recognizes:
 *   - "WEB_ABORTED": user/tool cancelled; no further retries attempted.
 *   - "WEB_PROVIDER_ERROR": a backend failed (network/http/parse/key-missing).
 *
 * A single backend aborting is demoted to a soft null by the provider so other
 * backends still contribute. Only when the caller-cancellable AbortSignal fires
 * does the provider throw the hard WEB_ABORTED up to the seam.
 */
import { WebError } from "@deepseek-ai/dsh-web";

/** DOMException#AbortError covers both signal.abort() and AbortSignal.timeout(ms). */
export function isAbortError(error) {
  return error instanceof DOMException && error.name === "AbortError";
}

/** True for any WebError carrying the WEB_ABORTED code. */
export function isAbortedWebError(error) {
  return error instanceof WebError && error.code === "WEB_ABORTED";
}

/** Build the provider's stable cancellation error, retaining the caller's reason. */
export function searchAborted(signal, fallback) {
  return new WebError("unified search aborted", "WEB_ABORTED", {
    cause: signal?.aborted === true ? signal.reason : fallback,
  });
}

/** Convenience: throw WEB_ABORTED if the caller already cancelled. */
export function throwIfSearchAborted(signal) {
  if (signal?.aborted === true) throw searchAborted(signal);
}

/**
 * Race an async operation against caller cancellation. The underlying operation
 * keeps running after abort (we cannot cancel an in-flight credential resolve);
 * we just reject the wrapper promise. Backend fetch paths forward signal directly.
 */
export function abortable(operation, signal) {
  if (signal === undefined) return operation;
  if (signal.aborted) return Promise.reject(searchAborted(signal));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(searchAborted(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error instanceof WebError ? error : new Error(String(error?.message ?? error), { cause: error }));
      },
    );
  });
}

/**
 * True when a thrown error reflects caller cancellation (not a backend failure).
 * Used by backends to decide: demote-to-null vs rethrow. Checks signal.aborted,
 * DOMException AbortError, and WebError WEB_ABORTED in that order.
 */
export function wasAborted(error, signal) {
  return (
    signal?.aborted === true ||
    isAbortError(error) ||
    isAbortedWebError(error)
  );
}

/**
 * Alias for wasAborted — the backend-facing helper used to decide whether a
 * caught error should be converted to a soft null (caller cancelled) or
 * rethrown as WEB_PROVIDER_ERROR (backend failed).
 */
export const maybeAbortError = wasAborted;
