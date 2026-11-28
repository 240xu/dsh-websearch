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
import { searchAborted, throwIfSearchAborted } from "./util/abort.js";
import {
  recordBackendRequest,
  recordBackendOutcome,
} from "./util/log.js";
import { dedupeSources, rerankSources } from "./util/rank.js";
import { normalizeFilters } from "./util/filters.js";
import { shapeQuery, resultHeader, TELEMETRY_TAG } from "./prompting.js";
import { cacheKeyFor } from "./cache.js";
import { foldBreaker, isCooled, cooledAnnotation } from "./breaker.js";
import { rateLimited, retryAfterMsFrom, keylessRejected } from "./util/failure-label.js";
import { rrfFuse } from "./rrf.js";
import { isComplexQuery, deriveSubQueries } from "./multiquery.js";
import { failureLabel } from "./util/failure-label.js";
import { invalidBaseURL } from "./util/base-url.js";
import { sanitizeError } from "./util/redact.js";

const PROVIDER_ID = "unified";

// Per-backend timeout ceilings (v2.8.0, P2): ddg/scrapes and self-hosted
// SearXNG instances are the slowest to fail when unreachable — a 30s global
// default lets one dead backend stall the whole fan-out tail. The effective
// timeout is min(override, backendTimeoutMs), so an operator's shorter global
// timeout always wins.
// ddg raised 5s -> 8s in v2.8.6 (route6): a live DDG fetch through the TLS
// forwarder measured 7.7s, so a 5s ceiling killed slow-but-working scrapes.
// searxng also gets 8s here: the public instances we use are slower than
// searx.be, and a hard 5s cap killed them mid-fetch in our probes.
const BACKEND_TIMEOUT_OVERRIDES_MS = {
  ddg: 8000,
  searxng: 8000,
};

/** Effective per-backend timeout = min(override ?? ∞, global). Exported for tests. */
export function effectiveBackendTimeoutMs(id, backendTimeoutMs) {
  const override = BACKEND_TIMEOUT_OVERRIDES_MS[id];
  return Number.isFinite(override) ? Math.min(override, backendTimeoutMs) : backendTimeoutMs;
}

// All-fail error composition: how many per-backend reasons to inline before
// collapsing the rest into a "+N more" marker (route6: the old code silently
// dropped reasons 5+ and never mentioned cooled-skipped backends).
const MAX_FAILURE_DETAILS = 4;

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

/** Append one entry to the search history with the shape every caller needs.
 * Four call sites (cache hit, results, empty-but-successful, total failure)
 * differ only in `resultCount` and the per-backend counters. */
function recordHistory(history, query, resultCount, backendsOk, backendsTotal) {
  history?.record({ query, time: Date.now(), resultCount, backendsOk, backendsTotal });
}

function recordBackendHealth(id, entry, breakerCfg, opts = {}) {
  const prev = latestBackendHealth.get(id);
  // `null` means the operator disabled the breaker. Still count consecutive
  // failures for diagnostics, but never publish a cooldown the provider does
  // not honour (health/history used to show `cooled: true` while the backend
  // kept being called).
  const breaker = breakerCfg === null
    ? { failCount: entry.ok === true ? 0 : (Number(prev?.failCount) || 0) + 1, cooledUntil: 0 }
    : foldBreaker(prev, entry.ok === true, entry.at, breakerCfg, opts);
  latestBackendHealth.set(id, {
    ...entry,
    lastOkAt: entry.ok === true ? entry.at : (prev && prev.lastOkAt) || null,
    failCount: breaker.failCount,
    cooledUntil: breaker.cooledUntil,
    // Persist the classification so a later full-cooldown decision can
    // distinguish quota failures from ordinary outages and from a keyless
    // permission refusal (which cannot be fixed by retrying after a wait).
    rateLimited: opts.rateLimited === true,
    keylessRejected: opts.keylessRejected === true,
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
// 2.8.2: exported for P1 regression tests (limiter sync-throw deadlock)
export function createLimiter(concurrency) {
  // A zero/negative limit would leave every queued backend unresolved with
  // no timeout to rescue it. Config and the GUI validate [1,10], but the
  // limiter also receives values from hand-written profiles and embedders.
  const maxRunning = Math.max(1, Math.floor(Number(concurrency) || 1));
  const queue = [];
  let running = 0;
  
  return function limit(fn) {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      process();
      
      function process() {
        while (running < maxRunning && queue.length > 0) {
          const { fn, resolve, reject } = queue.shift();
          running++;
          // 2.8.2（P1）：必须 .then(fn) 而非 Promise.resolve(fn())——后者先执行
          // fn()，同步抛出（如 runBackend 的 baseURL 校验在创建 timeout 之前 throw）
          // 会逃出本函数：running 已 ++ 却永不 --（finally 没挂上），leaked 计数
          // ≥ concurrency 后所有后续任务永久排队，且 timeoutId 未创建 → 超时也救不了
          // （实测全挂起 exit=13）。.then(fn) 把同步抛出转为 rejection 落进 finally。
          Promise.resolve().then(fn).then(resolve).catch(reject).finally(() => {
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
  const perBackend = [];
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
      const list = Array.isArray(settled.value?.sources) ? settled.value.sources : [];
      const safe = [];
      for (const src of list) {
        if (src && typeof src.url === "string" && /^https?:\/\//i.test(src.url)) safe.push(src);
      }
      perBackend.push(safe);
    } else {
      const err = settled.reason;
      perBackend.push([]);
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
  // Rank-major round-robin: every backend's #1 precedes any backend's #2.
  // Concatenating whole lists let the first two backends fill the cap and
  // starve the rest; this mirrors dsh-tool-web's mergeSearchResults.
  const collected = [];
  const longest = perBackend.reduce((n, list) => Math.max(n, list.length), 0);
  for (let rank = 0; rank < longest; rank += 1) {
    for (const list of perBackend) {
      if (list[rank] !== undefined) collected.push(list[rank]);
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
        // The host sends its deployment cap as request.maxResults; the card's
        // numResults is the user's requested count. Neither alone is right:
        // cap wins when smaller (never exceed the deployment limit), the user
        // value wins when smaller (settings must actually take effect).
        const hostCap = Number(request?.maxResults);
        const userMax = opts.numResults === undefined || opts.numResults === null
          ? Number.POSITIVE_INFINITY
          : Number(opts.numResults);
        // `official` leaves the count to the consumer (the tool always sends
        // maxResults); every other tier keeps the user's explicit count as an
        // upper bound, but never exceeds the host cap.
        const finiteCaps = [hostCap, userMax].filter((n) => Number.isFinite(n) && n > 0);
        const boundedMax = finiteCaps.length > 0 ? Math.max(1, Math.min(...finiteCaps)) : 10;
        let effReq = { ...request, maxResults: boundedMax };
      // `official` passes the model's exact query: the official consumer owns
      // query construction, and provider-level rewriting can change a quoted
      // phrase or a product name. `balanced`/`thorough` strip only
      // conversational prefixes (see prompting.js).
      if (opts.queryShaping !== false) {
        effReq.query = shapeQuery(effReq.query);
        // 2.8.2（P2）：整形后为空（"搜索"/"search" 等寒暄独词被剥光）→ 早拒。
        // 不拒会：①空串扇出全部后端 ②不同原始查询共享 "" 缓存键（别名污染）
        // ③落入 all-backends-failed(0) 的误导错误。
        if (!effReq.query) {
          throw new WebError(
            "unified search: empty query after shaping (the request contained only fillers like \"search\")",
            "WEB_PROVIDER_ERROR",
          );
        }
      } else if (typeof effReq.query !== "string" || effReq.query.trim() === "") {
        throw new WebError("unified search: empty query", "WEB_PROVIDER_ERROR");
      }
      if (Object.keys(filters).length > 0) effReq = { ...effReq, filters };
      const maxResults = effReq.maxResults;
      // `truncated` means the SEAM dropped sources to honour request.maxResults
      // (dsh-web/src/types.ts); a provider-side cut to the user's numResults is
      // a preference, not seam truncation.
      const seamBound = Number.isFinite(hostCap) && hostCap > 0 ? hostCap : Number.POSITIVE_INFINITY;
      const concurrency = opts.concurrency ?? 6;
      const backendTimeoutMs = opts.backendTimeoutMs ?? 24000;

      // v2.8.0 coverage / multiQuery gates (both default OFF; arXiv:2404.01037
      // warns blind multi-query degrades, so the gate is deliberately strict).
      const coverage = opts.deepCoverage === true;
      // Per-backend widening: fetch more per backend, dedupe down afterwards.
      const backendMaxResults = coverage ? Math.ceil(maxResults * 1.5) : maxResults;
      const multiGate = opts.multiQueryEnabled === true && isComplexQuery(effReq.query);
      const derived = multiGate ? deriveSubQueries(effReq.query) : [effReq.query];
      // A gate-true query can still derive zero useful variants ("C vs Rust"
      // drops the one-character "C"). Treat that as single-query instead of
      // flipping cacheMode and paying for a duplicate cache entry.
      const useMulti = derived.length > 1;
      const variants = useMulti ? derived : [effReq.query];
      // Result-presentation language also keys the cache: two raw queries can
      // shape to the same string ("请搜索 cats" / "cats") while the header
      // language follows the raw request.
      const queryLanguage = /[\u4e00-\u9fff]/.test(String(request?.query ?? "")) ? "zh" : "en";
      // Cache-key mode marker: different coverage/multiQuery settings must not
      // serve each other's cached results.
      const cacheMode = (useMulti ? "multi" : "single") + (coverage ? "+coverage" : "");

      // v2.7.0 disk cache: keyed on (shaped query + filters + maxResults +
      // backends + mode). A hit short-circuits the fan-out entirely; sources
      // are byte-identical to the first search and content carries a
      // "cache hit, age Ns" note. Cache failures never break the search.
      const cacheEnabled = opts.cacheEnabled === true && cache;
      let cacheKey = null;
      if (cacheEnabled) {
        // Result-affecting options belong in the key; otherwise a settings
        // change is masked by a hit within the cache TTL.
        const resultOptions = {};
        for (const [k, v] of Object.entries(opts)) {
          if (typeof v === "function") continue;
          if (/^(safeSearch|rerank|dedupStrategy|language|recency|numResults|resultHeader|resultTelemetry|backendTimeoutMs|concurrency|multiQueryEnabled|deepCoverage|intervention|queryShaping)$/.test(k)
              || /BaseURL$|^.*Model$|^.*ApiKeyEnv$|^enable[A-Z]/.test(k)) resultOptions[k] = v;
        }
        // resolveOptions() keeps per-backend settings under opts.backends[id],
        // not as top-level opts keys. Flatten the result-affecting ones with
        // an id prefix so editing a backend's baseURL/model/searchDepth does
        // not get masked by a cache hit within the TTL (65 号 N2).
        for (const id of opts.enabledBackends ?? []) {
          const be = opts.backends?.[id];
          if (!be || typeof be !== "object") continue;
          // Every per-backend option that changes results must appear here, or
          // a cache hit inside the TTL masks the edit. baseURLs (plural) is the
          // SearXNG failover list; leaving it out made instance changes inert.
          for (const k of ["baseURL", "baseURLs", "model", "searchDepth", "safeSearch", "apiKeyEnv"]) {
            if (be[k] !== undefined) resultOptions[`${id}.${k}`] = be[k];
          }
        }
        resultOptions.queryLanguage = queryLanguage;
        // The same min(host,user) can come from different host bounds; the
        // truncated flag is relative to the host bound, so key it too.
        resultOptions.hostMaxResults = Number.isFinite(hostCap) && hostCap > 0 ? hostCap : null;
        cacheKey = cacheKeyFor({ query: effReq.query, filters, maxResults, backends: opts.enabledBackends, mode: cacheMode, resultOptions });
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
          // `official` promises no provider-added text (the consumer owns
          // presentation), so the diagnostic cache note is gated with the
          // header rather than appended unconditionally.
          if (opts.resultTelemetry !== false) {
            const cacheNote = `[websearch cache] cache hit, age ${hit.age}s`;
            hitContent = hitContent === undefined ? cacheNote : hitContent + "\n\n" + cacheNote;
          }
          // Replay the fan-out's own counters instead of fabricating 1/1: a
          // cache hit for a four-backend search used to report one backend.
          const hitOk = Number.isInteger(hit.value.backendsOk) ? hit.value.backendsOk : 1;
          const hitTotal = Number.isInteger(hit.value.backendsTotal) ? hit.value.backendsTotal : 1;
          recordHistory(history, request?.query, hit.value.sources.length, hitOk, hitTotal);
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
      // no breaker. The pick is shared by every query variant.
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
      const rateLimitedCooled = new Map();
      let eligible = candidates;
      if (breakerCfg) {
        const active = candidates.filter((c) => {
          const entry = latestBackendHealth.get(c.id);
          if (isCooled(entry, nowMs)) {
            cooled.set(c.id, entry);
            if (entry?.rateLimited === true) rateLimitedCooled.set(c.id, entry);
            return false;
          }
          return true;
        });
        // A rate-limited/quota backend must never be re-hit while its cooldown
        // is open, even in a mixed outage. Only the non-quota cooled backends
        // keep the historical fail-open behaviour; when nothing usable remains
        // and at least one cooldown is quota-driven, fail fast with a retry hint.
        // A backend in a non-quota cooldown stays out of the fan-out while any
        // healthy backend remains: retrying it every search made the breaker
        // inert (three failures in a row never actually stopped the calls).
        // Only when EVERYTHING is cooling do we fail open — refusing to search
        // at all is worse than re-hitting a backend that might have recovered.
        const cooledReusable = [...cooled.entries()]
          .filter(([, e]) => e?.rateLimited !== true)
          .map(([id]) => candidates.find((c) => c.id === id))
          .filter(Boolean);
        const failOpen = active.length > 0 ? active : cooledReusable;
        if (failOpen.length > 0) eligible = failOpen;
        else if (rateLimitedCooled.size > 0) {
          const until = Math.max(...[...rateLimitedCooled.values()].map((e) => e?.cooledUntil ?? 0));
          const waitS = Math.max(0, Math.ceil((until - nowMs) / 1000));
          // Distinguish a real quota/rate-limit cooldown from a keyless
          // permission refusal: retrying the latter after N seconds cannot
          // succeed without configuring a key.
          const keyless = [...rateLimitedCooled.values()].some((e) => e?.keylessRejected === true);
          recordHistory(history, request?.query, 0, 0, candidates.length);
          if (keyless) {
            throw new WebError(
              "unified search: all backends need an API key (keyless access is unavailable); add a key or enable another backend",
              "WEB_PROVIDER_ERROR",
            );
          }
          throw new WebError(
            `unified search: all backends are rate-limited; retry after ~${waitS}s`,
            "WEB_PROVIDER_ERROR",
          );
        } else {
          // Pure non-quota outage: keep fail-open so a breaker can never make
          // search worse than no breaker.
          eligible = candidates;
          cooled.clear();
        }
      }

      if (eligible.length === 0) {
        recordHistory(history, request?.query, 0, 0, candidates.length);
        throw new WebError(
          "unified search: none of the enabled backend ids is registered",
          "WEB_PROVIDER_UNAVAILABLE",
        );
      }

      // Run ONE query variant through the full fan-out: breaker-aware backend
      // execution under the per-variant limiter, then PHASE 1 collect. The
      // internal abort/timeout semantics are unchanged from v2.7.
      const fanoutVariant = async (variantReq, variantBudgetMs = Number.POSITIVE_INFINITY, deadline = Number.POSITIVE_INFINITY) => {
        const telemetry = [];
        // Health is folded once per backend per SEARCH, after every variant
        // finished: recording per variant let one multi-query search trip the
        // 3-failure breaker (and inflate history counters) by itself.
        const health = [];
        const limit = createLimiter(concurrency);
        const runBackend = ({ id, backend, beOpts, hooks }) => {
          const startedAtMs = Date.now();
          // Trust boundary: baseURL is operator-configurable and API keys are sent to it.
          // Enforce http(s); plain http only for private hosts (self-hosted SearXNG).
          // Reject embedded credentials. Failure is a per-backend soft error.
          if (beOpts.baseURL !== undefined) {
            const invalid = invalidBaseURL(beOpts.baseURL);
            if (invalid !== undefined) {
              throw new WebError(`backend "${id}" has an invalid baseURL: ${invalid}`, "WEB_PROVIDER_ERROR");
            }
          }
          const controller = new AbortController();
          const mergedSignal = signal
            ? AbortSignal.any([signal, controller.signal])
            : controller.signal;
          const remainingNow = Number.isFinite(deadline) ? deadline - Date.now() : Number.POSITIVE_INFINITY;
          if (remainingNow <= 0) {
            return Promise.reject(new WebError(`backend "${id}" not started: search budget exhausted`, "WEB_PROVIDER_ERROR"));
          }
          const effectiveTimeoutMs = Math.max(1, Math.min(effectiveBackendTimeoutMs(id, backendTimeoutMs), variantBudgetMs, remainingNow));
          const timeoutId = setTimeout(() => controller.abort(), effectiveTimeoutMs);
          // A backend that ignores its signal (blackholed TCP, stuck proxy)
          // must not hold the whole fan-out past its budget. Race the call
          // against a guard that rejects on caller abort or timer abort; the
          // loser keeps running in the background, as before.
          let guardCleanup = () => {};
          const guard = new Promise((_, reject) => {
            if (signal?.aborted === true) {
              reject(searchAborted(signal));
              return;
            }
            const onCaller = () => reject(searchAborted(signal));
            const onTimeout = () => reject(new DOMException("backend timed out", "AbortError"));
            signal?.addEventListener("abort", onCaller, { once: true });
            controller.signal.addEventListener("abort", onTimeout, { once: true });
            guardCleanup = () => {
              signal?.removeEventListener("abort", onCaller);
              controller.signal.removeEventListener("abort", onTimeout);
            };
          });
          return Promise.race([
            // SearXNG's multi-instance split needs the effective budget to
            // divide it across candidates; without it the backend saw an
            // undefined budget and every instance got its own 4.5s.
            Promise.resolve().then(() =>
              backend.search(variantReq, mergedSignal, { ...beOpts, backendTimeoutMs: effectiveTimeoutMs }, hooks),
            ),
            guard,
          ])
            .then(
              (value) => {
                // A backend that resolves without a sources[] array is a
                // contract violation, not a successful zero-hit search; route
                // it through the failure path so telemetry/health agree.
                if (value === null || typeof value !== "object" || !Array.isArray(value.sources)) {
                  // A throw from the fulfilment handler bypasses the sibling
                  // rejection handler, so record the failure here as well.
                  const reason = `backend "${id}" returned no sources[]`;
                  telemetry.push({ id, ok: false, ms: Date.now() - startedAtMs, error: reason });
                  health.push({ id, ok: false, at: Date.now(), ms: Date.now() - startedAtMs, error: reason });
                  throw new WebError(reason, "WEB_PROVIDER_ERROR");
                }
                telemetry.push({ id, ok: true, ms: Date.now() - startedAtMs, count: value.sources.length });
                health.push({ id, ok: true, at: Date.now(), ms: Date.now() - startedAtMs, count: value?.sources?.length ?? 0 });
                return value;
              },
              (err) => {
                // A caller cancellation is not a backend outage: recording it
                // as a failure would let the stop button trip the breaker and
                // paint /health red. The outer throwIfSearchAborted(signal)
                // still propagates the cancellation to the caller.
                if (signal?.aborted === true) throw err;
                // Timeout classification happens BEFORE telemetry/health are
                // recorded (route6 P6): backends surface an internal timeout
                // as their own abort-flavored error ("unified search aborted",
                // raw AbortError, …), so the old code recorded that text in
                // the telemetry line and health payload even though the final
                // thrown error said "timed out after Nms" — the two disagreed
                // and "(unified search aborted)" read as if the USER cancelled.
                const timedOut = controller.signal.aborted && !(signal && signal.aborted);
                const reason = timedOut
                  ? `backend "${id}" timed out after ${effectiveTimeoutMs}ms`
                  : String(err instanceof Error ? err.message : err);
                const msg = sanitizeError(reason, 80);
                telemetry.push({ id, ok: false, ms: Date.now() - startedAtMs, error: msg });
                // A missing API key is a configuration state, not an outage:
                // folding it would cool the breaker and paint /health red for
                // a backend the operator can fix in Settings.
                if (!(err instanceof WebError && err.code === "WEB_PROVIDER_CREDENTIAL_MISSING")) {
                  health.push({
                    id, ok: false, at: Date.now(), ms: Date.now() - startedAtMs, error: msg,
                    rateLimited: rateLimited(err), keylessRejected: keylessRejected(err), retryAfterMs: retryAfterMsFrom(err),
                  });
                }
                throw timedOut
                  ? new WebError(reason, "WEB_PROVIDER_ERROR", { cause: err instanceof Error ? err : undefined })
                  : err;
              },
            )
            .finally(() => { clearTimeout(timeoutId); guardCleanup(); });
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
        const fold = collectFanoutResults(results, eligible, signal);
        return { ...fold, telemetry, health };
      };

      // Fan out per variant (sequential — the limiter already parallelizes
      // backends within a variant), dedupe/rank each list, then fuse.
      const perVariant = [];
      const allTelemetry = [];
      const allFailures = [];
      // One search-wide budget: sequential variants must not multiply the
      // per-backend timeout into N × 30s (which also exceeds the host's 30s
      // tool deadline). Later variants get only the time still left.
      const searchBudgetMs = Math.max(1, Number(opts.backendTimeoutMs) || 24000);
      const searchDeadline = Date.now() + searchBudgetMs;
      let hardError = null;
      // Final outcome per backend across every variant. Success wins; otherwise
      // keep the latest failure and the most severe quota classification.
      const searchHealth = new Map();
      for (let variantIndex = 0; variantIndex < variants.length; variantIndex += 1) {
        const variantQuery = variants[variantIndex];
        const remaining = searchDeadline - Date.now();
        // Do not start a variant that cannot get a meaningful slice: its
        // "timeout" would be budget exhaustion, not a backend outage, and
        // would contradict a success from the same backend in variant 1.
        const minVariantBudgetMs = Math.min(Number(opts.backendTimeoutMs) || 24000, 2000);
        if (remaining < minVariantBudgetMs) break;
        // Split the remaining budget across the variants still owed, so one
        // slow variant cannot starve the rest (the old code gave each variant
        // the full budget, and each backend inside it).
        const share = Math.max(1, Math.floor(remaining / Math.max(1, variants.length - variantIndex)));
        const variantReq = {
          ...effReq,
          query: variantQuery,
          maxResults: backendMaxResults,
          ...(coverage ? { deepCoverage: true } : {}),
        };
        const fold = await fanoutVariant(variantReq, share, searchDeadline);
        for (const outcome of fold.health) {
          const prev = searchHealth.get(outcome.id);
          if (prev === undefined || outcome.ok === true) {
            searchHealth.set(outcome.id, { ...outcome });
          } else if (prev.ok !== true) {
            searchHealth.set(outcome.id, {
              ...outcome,
              rateLimited: prev.rateLimited === true || outcome.rateLimited === true,
              keylessRejected: prev.keylessRejected === true || outcome.keylessRejected === true,
              retryAfterMs: Math.max(prev.retryAfterMs ?? 0, outcome.retryAfterMs ?? 0) || undefined,
            });
          }
        }
        allTelemetry.push(...fold.telemetry);
        allFailures.push(...fold.failures);
        if (fold.hardError !== null && hardError === null) hardError = fold.hardError;
        // Caller-cancellation check (hard abort fires before we yield results).
        if (signal?.aborted === true || fold.hardAborted) {
          throw searchAborted(signal);
        }
        // PHASE 2 dedupe / PHASE 3 rerank (per variant list, pre-fusion).
        const strategy = opts.dedupStrategy === "url+title" ? "url+title" : "url";
        const deduped = dedupeSources(fold.collected, strategy);
        const ordered = opts.rerank === true ? rerankSources(deduped, variantQuery) : deduped;
        perVariant.push({ query: variantQuery, ordered, mergedContent: fold.mergedContent });
      }

      // Fold the breaker once per backend per search. `null` (breaker off) is
      // honoured by recordBackendHealth and never publishes a cooldown.
      for (const [id, outcome] of searchHealth) {
        recordBackendHealth(
          id,
          { ok: outcome.ok, at: outcome.at, ms: outcome.ms, count: outcome.count, error: outcome.error },
          breakerCfg,
          {
            rateLimited: outcome.rateLimited === true,
            keylessRejected: outcome.keylessRejected === true,
            retryAfterMs: outcome.retryAfterMs,
          },
        );
      }

      // Counted once: every history record below needs it, and the fan-out is
      // finished by this point so the array no longer grows. History counts
      // unique backends, not attempts: multi-query fans one backend out once
      // per variant, which used to report `backendsTotal` as variants × backends.
      // One display segment per backend, not per variant: a multi-query
      // search otherwise repeats the same backend N times and can hide a
      // backend beyond the 12-slot cap while health/history show it once.
      const foldedTelemetry = [];
      const telemetryById = new Map();
      for (const t of allTelemetry) {
        const prev = telemetryById.get(t.id);
        if (prev === undefined) {
          const copy = { ...t };
          telemetryById.set(t.id, copy);
          foldedTelemetry.push(copy);
          continue;
        }
        if (t.ok === true) {
          prev.ok = true;
          prev.count = Math.max(prev.count ?? 0, t.count ?? 0);
          prev.error = undefined;
        } else if (prev.ok !== true) {
          prev.error = t.error;
        }
        prev.ms = Math.max(prev.ms ?? 0, t.ms ?? 0);
      }
      const okCount = foldedTelemetry.filter((t) => t.ok).length;
      const historyOk = new Set(allTelemetry.filter((t) => t.ok).map((t) => t.id)).size;
      const historyTotal = new Set(allTelemetry.map((t) => t.id)).size;

      // PHASE 4 fuse: multi-query mode fuses the per-variant ranked lists with
      // RRF (k=60); single-query mode keeps the historical behavior (the one
      // list, unchanged ordering).
      // The original query keeps full weight and derived variants contribute
      // at half weight: presence in several narrow variants must not outrank a
      // page that answers the user's actual query (RRF is rank-only, so a
      // homepage repeated across sub-queries otherwise wins).
      const orderedVariants = perVariant.filter((v) => v.ordered.length > 0);
      const ordered = useMulti
        ? rrfFuse(orderedVariants.map((v) => v.ordered), {
            weights: orderedVariants.map((v) => (v.query === effReq.query ? 2 : 1)),
          }).fused
        : (orderedVariants[0]?.ordered ?? []);

      // If we got ANY sources, return them even if some backends failed.
      if (ordered.length > 0) {
        const sources = ordered.slice(0, maxResults);
        // 结果呈现头（Anthropic web-search / OpenAI grounding 官方指引）：
        // 置于结果块最前，要求逐条引用来源 URL、优先官方/一手与较新来源；
        // The result header is always prepended; the language follows the
        // query text (CJK selects the Chinese header).
        let outContent = perVariant.find((v) => v.mergedContent !== undefined)?.mergedContent;
        if (opts.resultHeader !== false && (sources.length > 0 || outContent !== undefined)) {
          const header = resultHeader(queryLanguage);
          outContent = outContent === undefined ? header : header + "\n\n" + outContent;
        }
        // Store the pre-telemetry core (sources + headered content) so a cache
        // hit reproduces the exact sources and the model-facing header.
        if (cacheKey && cache) {
          cache.set(cacheKey, {
            sources, content: outContent,
            truncated: maxResults === seamBound && ordered.length > maxResults,
            backendsOk: historyOk, backendsTotal: historyTotal,
          });
        }
        recordHistory(history, request?.query, sources.length, historyOk, historyTotal);
        if (opts.resultTelemetry !== false && (allTelemetry.length > 0 || cooled.size > 0)) {
          // Only backends that actually never ran get a cooldown note here.
          // fail-open puts non-quota cooled backends back into the fan-out, so
          // their failures already appear above; annotating them again would
          // print the same backend twice on one line.
          const ranIds = new Set(allTelemetry.map((t) => t.id));
          const cooledParts = [];
          for (const [cid, centry] of cooled) {
            if (ranIds.has(cid)) continue;
            // The note is anchored to fan-out time (the instant the cooldown
            // decision was made). If the window expires while a slow search is
            // still running, say so instead of claiming the backend is cooling.
            const ann = cooledAnnotation(centry, nowMs);
            if (ann) cooledParts.push(cid + " " + ann
              + (isCooled(centry, Date.now()) ? "" : " (expired during search)"));
          }
          // Multi-query fans every variant through every backend; cap the line
          // so the telemetry note cannot dwarf the results themselves.
          // Failure notes translate known classes into short user-facing
          // labels (route6 P2); the raw text remains the fallback, and a
          // backend that just crossed the breaker threshold is annotated as
          // cooled on this same line.
          const parts = foldedTelemetry
            .slice(0, 12)
            .map((t) => {
              if (t.ok) return t.id + " ✓" + t.ms + "ms/" + t.count;
              const label = failureLabel(t.id, t.error) ?? (t.error ? String(t.error).slice(0, 40) : "");
              const cooledNow = cooledAnnotation(latestBackendHealth.get(t.id), Date.now());
              return t.id + " ✗" + t.ms + "ms" + (label ? " (" + label + ")" : "") + (cooledNow ? " " + cooledNow : "");
            })
            .concat(cooledParts);
          if (foldedTelemetry.length > 12) parts.push(`… +${foldedTelemetry.length - 12}`);
          const line = "[websearch backends]" + TELEMETRY_TAG + " " + parts.join(" · ");
          outContent = outContent === undefined ? line : outContent + "\n\n" + line;
        }
        return {
          sources,
          ...(outContent !== undefined ? { content: outContent } : {}),
          truncated: maxResults === seamBound && ordered.length > maxResults,
        };
      }

      // 2.8.2（P1）：零结果 ≠ 全部失败。所有后端成功但确实 0 条命中（冷僻查询/
      // 过滤后为空）时，原实现无条件落入下面的 throw，模型端拿到
      // `all enabled backends failed (0) - `（detail 空、计数自相矛盾），且丢弃已
      // 拿到的 mergedContent（如 Tavily 直答）。成功即空 → 正常返回空结果。
      // `allFailures.length === 0` is not the only success shape: with three
      // enabled backends, one may fail while two succeed and return zero hits
      // (filtered-out/obscure query). The old guard then threw "all enabled
      // backends failed (1)" although two thirds of the fan-out succeeded.
      // A success is a success even when the merged list is empty.
      if (allFailures.length === 0 || okCount > 0) {
        let emptyContent = perVariant.find((v) => v.mergedContent !== undefined)?.mergedContent;
        if (opts.resultHeader !== false && emptyContent !== undefined) {
          const header = resultHeader(typeof request?.query === "string" && /[\u4e00-\u9fff]/.test(request.query) ? "zh" : "en");
          emptyContent = header + "\n\n" + emptyContent;
        }
        if (opts.resultTelemetry !== false && allFailures.length > 0) {
          const parts = foldedTelemetry.slice(0, 12).map((t) => {
            if (t.ok) return t.id + " ✓" + t.ms + "ms/" + t.count;
            const label = failureLabel(t.id, t.error) ?? (t.error ? String(t.error).slice(0, 40) : "");
            return t.id + " ✗" + t.ms + "ms" + (label ? " (" + label + ")" : "");
          });
          if (foldedTelemetry.length > 12) parts.push(`… +${foldedTelemetry.length - 12}`);
          const line = "[websearch backends]" + TELEMETRY_TAG + " " + parts.join(" · ");
          emptyContent = emptyContent === undefined ? line : emptyContent + "\n\n" + line;
        }
        recordHistory(history, request?.query, 0, historyOk, historyTotal);
        // An empty result is never served from the cache (the read path
        // requires a non-empty sources array), so writing it only pays for a
        // full eviction scan and can push real entries out.
        return {
          sources: [],
          ...(emptyContent !== undefined ? { content: emptyContent } : {}),
          truncated: false,
        };
      }

      // All attempted backends failed - synthesize one meaningful error that
      // names each backend's own reason so the caller (model or user) can act.
      // A total outage must be visible in history: otherwise the newest entry
      // still shows the last success while health already records failures,
      // making failure-rate/availability statistics silently omit outages.
      // Reasons beyond MAX_FAILURE_DETAILS collapse into "+N more"; backends
      // that never ran (breaker cooldown) are named explicitly — without the
      // note "(N)" reads as "N enabled" when it means "N attempted".
      // allFailures holds one entry per attempt (multi-query fans out once per
      // variant); fold to one entry per backend before counting/reporting.
      const uniqueFailures = [...new Map(allFailures.map((f) => [f.id, f])).values()];
      const detail = uniqueFailures.slice(0, MAX_FAILURE_DETAILS)
        .map((f) => f.id + ": " + sanitizeError(f.err instanceof Error ? f.err.message : f.err, 120))
        .join("; ") + (uniqueFailures.length > MAX_FAILURE_DETAILS ? `; +${uniqueFailures.length - MAX_FAILURE_DETAILS} more` : "");
      const allKeyMissing =
        uniqueFailures.length > 0 &&
        uniqueFailures.every((f) => f.err instanceof WebError && f.err.code === "WEB_PROVIDER_CREDENTIAL_MISSING");
      const hint = allKeyMissing
        ? " (every enabled backend is missing its API key - add keys in Settings > Web Search, or enable a keyless backend)"
        : "";
      // A total outage must be visible in history: otherwise the newest entry
      // still shows the last success while health already records failures,
      // making failure-rate/availability statistics silently omit outages.
      recordHistory(history, request?.query, 0, historyOk, historyTotal);
      // Anchor the note to the fan-out instant: recomputing at render time would
      // claim "expired" for a backend that was genuinely cooling when skipped.
      // fail-open re-runs non-quota cooled backends, so only those that were
      // genuinely skipped belong in this note; naming a backend that just ran
      // reads as "skipped" and "failed" in the same sentence.
      const skippedOnly = [...cooled].filter(([cid]) => !allTelemetry.some((t) => t.id === cid));
      const cooledNote = skippedOnly.length > 0
        ? " (cooled-skipped: " + skippedOnly.map(([cid, centry]) => cid + " " + (cooledAnnotation(centry, nowMs) || "⏸cooled")).join(", ") + ")"
        : "";
      throw new WebError(
        `unified search: all attempted backends failed (${uniqueFailures.length} of ${candidates.length} enabled) - ${detail}` + cooledNote + hint,
        "WEB_PROVIDER_ERROR",
        {
          // The cause message can embed an upstream body that echoes a key;
          // redact it just like the top-level detail.
          cause: hardError instanceof Error ? new Error(sanitizeError(hardError.message, 160)) : undefined,
        },
      );
    },
  };
}

export default { createUnifiedSearchProvider, PROVIDER_ID };
