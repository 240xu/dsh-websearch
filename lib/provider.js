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
import { shapeQuery, resultHeader, TELEMETRY_TAG } from "./prompting.js";
import { cacheKeyFor } from "./cache.js";
import { foldBreaker, isCooled, cooledAnnotation } from "./breaker.js";

const PROVIDER_ID = "unified";

// Module-level per-backend health telemetry (id -> entry), updated on every
// backend completion during a real search. Purely passive: nothing writes here
// outside search(), so the read-only /api/unified-search/health route can
// report the LAST known reachability without firing probes or burning quota.
// Entry shape: { ok: boolean, at: ms, ms: duration, count?: number,
//                error?: string (already truncated to 80), lastOkAt: ms|null }
const latestBackendHealth = new Map();

/** Read-only access for the health route (never mutate the returned map). */
export function getLatestBackendHealth() {
  return latestBackendHealth;
}

function recordBackendHealth(id, entry, breakerCfg) {
  const prev = latestBackendHealth.get(id);
  const breaker = foldBreaker(prev, entry.ok === true, entry.at, breakerCfg ?? undefined);
  latestBackendHealth.set(id, {
    ...entry,
    lastOkAt: entry.ok === true ? entry.at : (prev && prev.lastOkAt) || null,
    failCount: breaker.failCount,
    cooledUntil: breaker.cooledUntil,
  });
}

/**
 * Read-only access to one backend's breaker state (failCount / cooledUntil).
 */
export function getBackendBreaker(id) {
  const e = latestBackendHealth.get(id);
  return e ? { failCount: e.failCount ?? 0, cooledUntil: e.cooledUntil ?? 0 } : { failCount: 0, cooledUntil: 0 };
}

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
 * PHASE 1 (collect): fold settled fan-out results into the raw merge inputs.
 * Sources keep fan-out priority order; dedupe/rank over the FULL set happens
 * later (a mid-merge maxResults cap would silently drop later backends'
 * entries before cross-backend fill-in and ranking could see them).
 * URL scheme whitelist is enforced here — javascript:/data: payloads from
 * compromised or poisoned backends never reach model/GUI consumers.
 */
function collectFanoutResults(results, eligible, signal) {
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
        if (src && typeof src.url === "string" && /^https?:\/\//i.test(src.url)) collected.push(src);
      }
    } else {
      const err = settled.reason;
      if (err instanceof WebError && err.code === "WEB_ABORTED") {
        // Per-backend abort -> soft unless the caller signal fired.
        if (signal?.aborted === true) hardAborted = true;
        else failures.push({ id: failedId, err });
      } else {
        failures.push({ id: failedId, err });
        if (hardError === null) hardError = err;
      }
    }
  }
  return { collected, mergedContent, hardAborted, hardError, failures };
}

/**
 * Build the UnifiedSearchProvider.
 *
 * @param {object} deps
 * @param {object} deps.ctx          the Cordis plugin context
 * @param {Function} deps.resolveOptions  () => resolved options snapshot
 * @param {object} deps.backends     keyed backend registry
 */
export function createUnifiedSearchProvider({ ctx, resolveOptions, backends, cache, history }) {
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
      // 系统性查询整形（Tavily/Exa best practices）：扇出前对口语化查询做
      // 确定性归一 —— 剥离寒暄前缀、压缩空白、截断到 1500 字符；
      // 专名/版本号/日期原样保留，不改写语义。
      effReq.query = shapeQuery(effReq.query);
      if (Object.keys(filters).length > 0) effReq = { ...effReq, filters };
      const maxResults = effReq.maxResults;
      const concurrency = opts.concurrency ?? 6;
      const backendTimeoutMs = opts.backendTimeoutMs ?? 30000;

      // v2.7.0 disk cache: keyed on (shaped query + filters + maxResults).
      // A hit short-circuits the fan-out entirely; sources are byte-identical
      // to the first search and content carries a "cache hit, age Ns" note.
      // Cache failures never break the search (cache API never throws).
      const cacheEnabled = opts.cacheEnabled === true && cache;
      let cacheKey = null;
      if (cacheEnabled) {
        cacheKey = cacheKeyFor({ query: effReq.query, filters, maxResults, backends: opts.enabledBackends });
        const hit = cache.get(cacheKey);
        if (hit && Array.isArray(hit.value?.sources) && hit.value.sources.length > 0) {
          // Defense in depth: the fresh path drops non-http(s) schemes before
          // merge; a tampered cache file must not bypass that whitelist.
          const safeSources = hit.value.sources.filter(
            (src) => src && typeof src.url === "string" && /^https?:\/\//i.test(src.url),
          );
          if (safeSources.length === 0) {
            // whole entry poisoned or filtered empty -> treat as a miss
            cacheKey = null;
          } else {
          let hitContent = typeof hit.value.content === "string" ? hit.value.content : undefined;
          const cacheNote = `[websearch cache] cache hit, age ${hit.age}s`;
          hitContent = hitContent === undefined ? cacheNote : hitContent + "\n\n" + cacheNote;
          history?.record({
            query: request?.query,
            time: Date.now(),
            resultCount: hit.value.sources.length,
            backendsOk: 0,
            backendsTotal: 0,
          });
          return {
            sources: safeSources,
            ...(hitContent !== undefined ? { content: hitContent } : {}),
            truncated: hit.value.truncated === true,
          };
          }
        }
      }

      // Pick enabled & available backends. With the breaker enabled, a
      // backend inside its 60s cooldown window is skipped (annotated in
      // telemetry as "id ⏸cooled"). Fail-open: if EVERY candidate is cooled,
      // run them all anyway — the breaker must never make search worse than
      // no breaker.
      const breakerCfg = opts.breakerEnabled === false ? null : {
        threshold: opts.breakerThreshold,
        cooldownMs: opts.breakerCooldownMs,
      };
      const nowMs = Date.now();
      const candidates = [];
      for (const id of opts.enabledBackends) {
        const be = backends[id];
        if (!be) continue;
        const beOpts = opts.backends?.[id] ?? {};
        const avail = be.available(beOpts);
        if (!avail) continue;
        candidates.push({ id, backend: be, beOpts });
      }
      const cooled = new Map();
      let eligible = candidates;
      if (breakerCfg) {
        const active = candidates.filter((c) => {
          if (isCooled(latestBackendHealth.get(c.id), nowMs)) {
            cooled.set(c.id, latestBackendHealth.get(c.id));
            return false;
          }
          return true;
        });
        if (active.length > 0) eligible = active;
        else cooled.clear(); // all cooled -> fail-open
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
      const limit = createLimiter(concurrency);

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
              recordBackendHealth(id, { ok: true, at: Date.now(), ms: Date.now() - startedAtMs, count: value?.sources?.length ?? 0 }, breakerCfg);
              return value;
            },
            (err) => {
              const msg = String(err instanceof Error ? err.message : err).slice(0, 80);
              telemetry.push({ id, ok: false, ms: Date.now() - startedAtMs, error: msg });
              recordBackendHealth(id, { ok: false, at: Date.now(), ms: Date.now() - startedAtMs, error: msg }, breakerCfg);
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

      // PHASE 1 collect: fold the settled fan-out into raw sources (fan-out
      // priority order), first backend content, and per-backend failures.
      const { collected, mergedContent, hardAborted, hardError, failures } =
        collectFanoutResults(results, eligible, signal);

      // Caller-cancellation check (hard abort fires before we yield results).
      if (signal?.aborted === true || hardAborted) {
        throw searchAborted(signal);
      }

      // PHASE 2 dedupe / PHASE 3 rerank: "url" preserves the historical
      // URL-key behavior; "url+title"
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
        // 结果呈现头（Anthropic web-search / OpenAI grounding 官方指引）：
        // 置于结果块最前，要求逐条引用来源 URL、优先官方/一手与较新来源；
        // 语言按查询文本自动选择（含 CJK 用中文头）。可用
        // opts.resultHeader === false 关闭。
        let outContent = mergedContent;
        if (opts.resultHeader !== false && (sources.length > 0 || outContent !== undefined)) {
          const header = resultHeader(typeof request?.query === "string" && /[\u4e00-\u9fff]/.test(request.query) ? "zh" : "en");
          outContent = outContent === undefined ? header : header + "\n\n" + outContent;
        }
        // Store the pre-telemetry core (sources + headered content) so a cache
        // hit reproduces the exact sources and the model-facing header.
        if (cacheKey && cache) {
          cache.set(cacheKey, { sources, content: outContent, truncated: ordered.length > maxResults });
        }
        history?.record({
          query: request?.query,
          time: Date.now(),
          resultCount: sources.length,
          backendsOk: telemetry.filter((t) => t.ok).length,
          backendsTotal: telemetry.length,
        });
        if (opts.resultTelemetry !== false && (telemetry.length > 0 || cooled.size > 0)) {
          const cooledParts = [];
          for (const [cid, centry] of cooled) {
            const ann = cooledAnnotation(centry, Date.now()) || "⏸cooled";
            cooledParts.push(cid + " " + ann);
          }
          const parts = telemetry
            .map((t) => t.id + (t.ok ? " ✓" : " ✗") + t.ms + "ms" + (t.ok ? "/" + t.count : (t.error ? " (" + String(t.error).slice(0, 40) + ")" : "")))
            .concat(cooledParts);
          const line = "[websearch backends]" + TELEMETRY_TAG + " " + parts.join(" · ");
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
