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
import { dedupeSources, rerankSources } from "./util/rank.js";
import { normalizeFilters } from "./util/filters.js";

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

      // Settings-level default filters, overridden by per-request filters
      // (normalizeFilters drops unknown/invalid values so typos degrade to
      // "no filter" instead of breaking the search).
      const filters = normalizeFilters({
        ...(opts.filters ?? {}),
        ...(request?.filters ?? {}),
      });
      const effectiveRequest =
        Object.keys(filters).length > 0 ? { ...request, filters } : request;

      // Concurrency limiter
      const limit = createLimiter(opts.concurrency ?? 6);

      // Run one backend under the per-backend timeout. The internal timer's
      // controller is merged into the caller's signal; when the INTERNAL timer
      // fired (caller did not abort), a backend abort-shaped failure is
      // reclassified as WEB_PROVIDER_ERROR so timeouts surface as real
      // failures instead of being silently demoted like user cancellations.
      const runBackend = ({ id, backend, beOpts, hooks }) => {
        const controller = new AbortController();
        const mergedSignal = signal
          ? AbortSignal.any([signal, controller.signal])
          : controller.signal;
        const timeoutId = setTimeout(() => controller.abort(), backendTimeoutMs);
        return backend
          .search(effectiveRequest, mergedSignal, beOpts, hooks)
          .catch((err) => {
            if (controller.signal.aborted && !(signal && signal.aborted)) {
              throw new WebError(
                `backend "${id}" timed out after ${backendTimeoutMs}ms`,
                "WEB_PROVIDER_ERROR",
                { cause: err instanceof Error ? err : undefined },
              );
            }
            throw err;
          })
          .finally(() => clearTimeout(timeoutId));
      };

      const results = await Promise.allSettled(
        eligible.map(({ id, backend, beOpts }) => {
          const hooks = {
            recordRequest: (req) => recordBackendRequest(ctx, id, req),
            recordOutcome: (out) => recordBackendOutcome(ctx, id, out),
          };
          return limit(() => runBackend({ id, backend, beOpts, hooks }));
        }),
      );

      throwIfSearchAborted(signal);

      // Collect every fulfilled backend's sources in fan-out priority order,
      // then dedupe/rank ONCE over the full set. (The previous loop stopped at
      // maxResults mid-merge, which silently dropped later backends' entries
      // before cross-backend fill-in and ranking could see them.)
      const collected = [];
      let mergedContent;
      let hardAborted = false;
      let hardError = null;
      const failures = [];

      for (const settled of results) {
        if (settled.status === "fulfilled") {
          if (mergedContent === undefined && typeof settled.value?.content === "string" && settled.value.content.length > 0) {
            mergedContent = settled.value.content;
          }
          for (const s of settled.value?.sources ?? []) collected.push(s);
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

      // Dedup: "url" preserves the historical URL-key behavior; "url+title"
      // additionally collapses same-story syndicated copies across backends.
      const strategy = opts.dedupStrategy === "url+title" ? "url+title" : "url";
      const deduped = dedupeSources(collected, strategy);
      // Optional deterministic relevance rerank (stable ties keep fan-out order).
      const ordered =
        opts.rerank === true
          ? rerankSources(deduped, typeof request?.query === "string" ? request.query : "")
          : deduped;

      // If we got ANY sources, return them even if some backends failed.
      if (ordered.length > 0) {
        const sources = ordered.slice(0, maxResults);
        return {
          sources,
          ...(mergedContent !== undefined ? { content: mergedContent } : {}),
          truncated: ordered.length > maxResults,
        };
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
