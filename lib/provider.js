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
      const filters = normalizeFilters({
      ...(opts.filters ?? {}),
      ...(request?.filters ?? {}),
      });
        let effReq = { ...request, maxResults: Math.max(1, Number(request?.maxResults) || opts.numResults || 8) };
      if (Object.keys(filters).length > 0) effReq = { ...effReq, filters };
      const maxResults = effReq.maxResults;
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

      const telemetry = [];
      // Concurrency limiter
      const limit = createLimiter(opts.concurrency ?? 6);

      // Run one backend under the per-backend timeout. The internal timer's
      // controller is merged into the caller's signal; when the INTERNAL timer
      // fired (caller did not abort), a backend abort-shaped failure is
      // reclassified as WEB_PROVIDER_ERROR so timeouts surface as real
      // failures instead of being silently demoted like user cancellations.
      const runBackend = ({ id, backend, beOpts, hooks }) => {
        const startedAtMs = Date.now();
        // Trust boundary: baseURL is operator-configurable and API keys are sent to it.
        // Enforce http(s); plain http only for private hosts (self-hosted SearXNG).
        // Reject embedded credentials. Failure is a per-backend soft error.
        if (beOpts.baseURL !== undefined) {
          let bu = null;
          try { bu = new URL(beOpts.baseURL); } catch { bu = null; }
          const privHost = bu ? /^(localhost|127(\.\d{1,3}){3}|10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){3}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){3})$/.test(bu.hostname) : false;
          const schemeOk = bu && (bu.protocol === "https:" || (bu.protocol === "http:" && privHost));
          if (!schemeOk || bu.username || bu.password) {
            throw new WebError(`backend "${id}" has an invalid baseURL: https required (plain http only for private hosts), credentials-in-URL rejected`, "WEB_PROVIDER_ERROR");
          }
        }
        const controller = new AbortController();
        const mergedSignal = signal
          ? AbortSignal.any([signal, controller.signal])
          : controller.signal;
        const timeoutId = setTimeout(() => controller.abort(), backendTimeoutMs);
        return backend
          .search(effReq, mergedSignal, beOpts, hooks)
          .then(
            (value) => {
              telemetry.push({ id, ok: true, ms: Date.now() - startedAtMs, count: value?.sources?.length ?? 0 });
              return value;
            },
            (err) => {
              telemetry.push({ id, ok: false, ms: Date.now() - startedAtMs, error: String(err instanceof Error ? err.message : err).slice(0, 80) });
              throw err;
            },
          )
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

      let backendIndex = 0;
      for (const settled of results) {
        const failedId = eligible[backendIndex] ? eligible[backendIndex].id : "unknown";
        backendIndex++;
        if (settled.status === "fulfilled") {
          if (mergedContent === undefined && typeof settled.value?.content === "string" && settled.value.content.length > 0) {
            mergedContent = settled.value.content;
          }
          for (const src of settled.value?.sources ?? []) {
            // Scheme whitelist: parsed URLs reach model/GUI consumers; drop
            // javascript:/data: payloads from compromised or poisoned backends.
            if (src && typeof src.url === "string" && !/^https?:\/\//i.test(src.url)) continue;
            collected.push(src);
          }
        } else {
          // settled.status === "rejected"
          const err = settled.reason;
          if (err instanceof WebError && err.code === "WEB_ABORTED") {
            // Per-backend abort → soft unless caller signal fired.
            if (signal?.aborted === true) hardAborted = true;
            else failures.push({ id: failedId, err });
          } else {
            failures.push({ id: failedId, err });
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
        let outContent = mergedContent;
        if (opts.resultTelemetry !== false && telemetry.length > 0) {
          const line = "[websearch backends] " + telemetry
            .map((t) => t.id + (t.ok ? " ✓" : " ✗") + t.ms + "ms" + (t.ok ? "/" + t.count : (t.error ? " (" + String(t.error).slice(0, 40) + ")" : "")))
            .join(" · ");
          outContent = outContent === undefined ? line : outContent + "\n\n" + line;
        }
        return {
          sources,
          ...(outContent !== undefined ? { content: outContent } : {}),
          truncated: ordered.length > maxResults,
        };
      }

      // All enabled backends failed - synthesize one meaningful error that
      // names each backend's own reason so the caller (model or user) can act.
      const detail = failures.slice(0, 4)
        .map((f) => f.id + ": " + String(f.err instanceof Error ? f.err.message : f.err).slice(0, 120))
        .join("; ");
      const allKeyMissing =
        failures.length > 0 &&
        failures.every((f) => f.err instanceof WebError && (f.err.code === "WEB_PROVIDER_UNAVAILABLE" || f.err.code === "WEB_PROVIDER_CREDENTIAL_MISSING"));
      const hint = allKeyMissing
        ? " (every enabled backend is missing its API key - add keys in Settings > Web Search, or enable a keyless backend)"
        : "";
      throw new WebError(
        `unified search: all enabled backends failed (${failures.length}) - ${detail}` + hint,
        "WEB_PROVIDER_ERROR",
        { cause: hardError ?? undefined },
      );
    },
  };
}

export default { createUnifiedSearchProvider, PROVIDER_ID };
