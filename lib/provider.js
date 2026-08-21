// provider.js — UnifiedSearchProvider: one ctx.web search provider (id "unified")
// that fans out to multiple backends concurrently and merges results. This
// keeps the seam's selection rule happy (only one provider is registered, so
// no WEB_PROVIDER_AMBIGUOUS error) while giving the user richer results than
// any single backend alone.
//
// Per-backend abort demotion: a single backend throwing WEB_ABORTED becomes a
// soft null (so other backends still contribute) — UNLESS the caller's own
// AbortSignal fired (then we rethrow WEB_ABORTED up to the seam). Non-abort
// failures are also soft: the provider stays usable as long as ≥1 backend
// returns sources. Only when every enabled backend fails do we throw
// WEB_PROVIDER_ERROR.
//
// Concurrency control: limits simultaneous backend calls to opts.concurrency (default 6).
// Per-backend timeout: each backend call wrapped with opts.backendTimeoutMs (default 30s).

import { WebError } from "@deepseek-ai/dsh-web";
import { maybeAbortError, searchAborted, throwIfSearchAborted, isAbortedWebError } from "./util/abort.js";
import {
  recordBackendRequest,
  recordBackendOutcome,
} from "./util/log.js";

const PROVIDER_ID = "unified";

/**
 * Simple concurrency limiter using a semaphore pattern.
 * No external dependency needed.
 */
function createLimiter(concurrency) {
  const queue = [];
  let running = 0;
  
  return function limit(fn) {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      process();
      
      function process() {
        while (running < concurrency && queue.length > 0) {
          const { fn, resolve, reject } = queue.shift();
          running++;
          Promise.resolve(fn()).then(resolve).catch(reject).finally(() => {
            running--;
            process();
          });
        }
      }
    });
  };
}

/**
 * Build the UnifiedSearchProvider.
 *
 * @param {object} deps
 * @param {object} deps.ctx          the Cordis plugin context
 * @param {Function} deps.resolveOptions  () => resolved options snapshot
 * @param {object} deps.backends     keyed backend registry
 */
export function createUnifiedSearchProvider({ ctx, resolveOptions, backends }) {
  return {
    id: PROVIDER_ID,

    available() {
      const opts = resolveOptions();
      // Provider is usable iff at least one enabled backend is available.
      for (const id of opts.enabledBackends) {
        const be = backends[id];
        if (!be) continue;
        const beOpts = opts.backends?.[id] ?? {};
        if (be.available(beOpts)) return true;
      }
      return false;
    },

    /**
     * Fan out to all enabled & available backends concurrently, merge results
     * (URL-dedup, keep first-seen snippet/title), enforce maxResults.
     *
     * @param {WebSearchRequest} request
     * @param {AbortSignal} signal
     * @returns {Promise<WebSearchResult>}
     */
    async search(request, signal) {
      throwIfSearchAborted(signal);
      const opts = resolveOptions();
      const maxResults = request.maxResults ?? opts.numResults ?? 8;
      const concurrency = opts.concurrency ?? 6;
      const backendTimeoutMs = opts.backendTimeoutMs ?? 30000;

      // Pick enabled & available backends.
      const eligible = [];
      for (const id of opts.enabledBackends) {
        const be = backends[id];
        if (!be) continue;
        const beOpts = opts.backends?.[id] ?? {};
        const avail = be.available(beOpts);
        if (!avail) continue;
        eligible.push({ id, backend: be, beOpts });
      }

      if (eligible.length === 0) {
        throw new WebError(
          "unified search: no enabled backend is available (configure a backend or set an API key)",
          "WEB_PROVIDER_UNAVAILABLE",
        );
      }

      // Concurrency limiter
      const limit = createLimiter(opts.concurrency ?? 6);

      // Wrap each backend call with timeout
      const runWithTimeout = (backend, req, sig, beOpts, hooks) => {
        const timeoutMs = backendTimeoutMs;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        
        // Merge signals
        const mergedSignal = sig 
          ? AbortSignal.any([sig, controller.signal])
          : controller.signal;

        return Promise.race([
          backend.search(req, mergedSignal, beOpts, hooks),
          new Promise((_, reject) => {
            controller.signal.addEventListener('abort', () => {
              if (controller.signal.reason === 'timeout' || !sig?.aborted) {
                reject(new WebError(`Backend timed out after ${timeoutMs}ms`, "WEB_PROVIDER_ERROR"));
              }
            });
          })
        ]).finally(() => clearTimeout(timeoutId));
      };

      const results = await Promise.allSettled(
        eligible.map(({ id, backend, beOpts }) => {
          const recordRequest = (req) => recordBackendRequest(ctx, id, req);
          const recordOutcome = (out) => recordBackendOutcome(ctx, id, out);
          const hooks = { recordRequest, recordOutcome };
          
          return limit(async () => {
            return runWithTimeout(backend, request, signal, beOpts, hooks);
          });
        }),
      );

      throwIfSearchAborted(signal);

      // Merge: dedup by url (case-insensitive normalized), keep first-seen
      // non-empty title/snippet/publishedAt. Tolerate soft-null settled values.
      const seen = new Set();
      const merged = [];
      let mergedContent;
      let hardAborted = false;
      let hardError = null;
      const failures = [];

      for (const settled of results) {
        if (settled.status === "fulfilled") {
          if (mergedContent === undefined && typeof settled.value?.content === "string" && settled.value.content.length > 0) {
            mergedContent = settled.value.content;
          }
          const srcs = settled.value?.sources ?? [];
          for (const s of srcs) {
            if (!s || typeof s.url !== "string" || s.url.length === 0) continue;
            const key = s.url.toLowerCase();
            if (seen.has(key)) {
              // Merge fields into the existing entry (fill-in missing ones).
              const existing = merged.find((m) => m.url.toLowerCase() === key);
              if (existing) {
                if (!existing.title && s.title) existing.title = s.title;
                if (!existing.snippet && s.snippet) existing.snippet = s.snippet;
                if (!existing.publishedAt && s.publishedAt) existing.publishedAt = s.publishedAt;
              }
              continue;
            }
            seen.add(key);
            merged.push({ ...s });
            if (merged.length >= maxResults) break;
          }
          if (merged.length >= maxResults) break;
        } else {
          // settled.status === "rejected"
          const err = settled.reason;
          if (err instanceof WebError && err.code === "WEB_ABORTED") {
            // Per-backend abort → soft unless caller signal fired.
            if (signal?.aborted === true) hardAborted = true;
            else failures.push({ id: "abort", err });
          } else {
            failures.push({ id: "error", err });
            if (hardError === null) hardError = err;
          }
        }
      }

      // Caller-cancellation check (hard abort fires before we yield results).
      if (signal?.aborted === true || hardAborted) {
        throw searchAborted(signal);
      }

      // If we got ANY sources, return them even if some backends failed.
      if (merged.length > 0) {
        const sources = merged.slice(0, maxResults);
        const wasCapped =
          merged.length > maxResults ||
          results.some((r) => r.status === "fulfilled" && (r.value?.sources?.length ?? 0) > maxResults);
        return { sources, ...(mergedContent !== undefined ? { content: mergedContent } : {}), truncated: sources.length >= maxResults && wasCapped };
      }

      // All enabled backends failed — synthesize a meaningful WEB_PROVIDER_ERROR.
      const firstDetail =
        hardError instanceof Error
          ? hardError.message
          : String(hardError ?? "unknown");
      throw new WebError(
        `unified search: all enabled backends failed (${failures.length}). First: ${firstDetail}`,
        "WEB_PROVIDER_ERROR",
        { cause: hardError ?? undefined },
      );
    },
  };
}

export default { createUnifiedSearchProvider, PROVIDER_ID };
