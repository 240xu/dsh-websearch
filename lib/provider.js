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
import { rateLimited, retryAfterMsFrom, keylessRejected } from "./util/failure-label.js";
import { rrfFuse } from "./rrf.js";
import { isComplexQuery, deriveSubQueries } from "./multiquery.js";
import { failureLabel } from "./util/failure-label.js";

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
  const breaker = foldBreaker(prev, entry.ok === true, entry.at, breakerCfg ?? undefined, opts);
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
        // The host sends its deployment cap as request.maxResults; the card's
        // numResults is the user's requested count. Neither alone is right:
        // cap wins when smaller (never exceed the deployment limit), the user
        // value wins when smaller (settings must actually take effect).
        const hostCap = Number(request?.maxResults) || Infinity;
        const userMax = Number(opts.numResults) || 8;
        let effReq = { ...request, maxResults: Math.max(1, Math.min(hostCap, userMax)) };
      // 系统性查询整形（Tavily/Exa best practices）：扇出前对口语化查询做
      // 确定性归一 —— 剥离寒暄前缀、压缩空白、截断到 1500 字符；
      // 专名/版本号/日期原样保留，不改写语义。
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
      if (Object.keys(filters).length > 0) effReq = { ...effReq, filters };
      const maxResults = effReq.maxResults;
      const concurrency = opts.concurrency ?? 6;
      const backendTimeoutMs = opts.backendTimeoutMs ?? 30000;

      // v2.8.0 coverage / multiQuery gates (both default OFF; arXiv:2404.01037
      // warns blind multi-query degrades, so the gate is deliberately strict).
      const coverage = opts.deepCoverage === true;
      // Per-backend widening: fetch more per backend, dedupe down afterwards.
      const backendMaxResults = coverage ? Math.ceil(maxResults * 1.5) : maxResults;
      const multi = opts.multiQueryEnabled === true && isComplexQuery(effReq.query);
      const variants = multi ? deriveSubQueries(effReq.query) : [effReq.query];
      // Cache-key mode marker: different coverage/multiQuery settings must not
      // serve each other's cached results.
      const cacheMode = (multi ? "multi" : "single") + (coverage ? "+coverage" : "");

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
          if (/^(safeSearch|rerank|dedupStrategy|language|recency|numResults|resultHeader|resultTelemetry|backendTimeoutMs|concurrency|multiQueryEnabled|deepCoverage)$/.test(k)
              || /BaseURL$|^.*Model$|^.*ApiKeyEnv$|^enable[A-Z]/.test(k)) resultOptions[k] = v;
        }
        // resolveOptions() keeps per-backend settings under opts.backends[id],
        // not as top-level opts keys. Flatten the result-affecting ones with
        // an id prefix so editing a backend's baseURL/model/searchDepth does
        // not get masked by a cache hit within the TTL (65 号 N2).
        for (const id of opts.enabledBackends ?? []) {
          const be = opts.backends?.[id];
          if (!be || typeof be !== "object") continue;
          for (const k of ["baseURL", "model", "searchDepth", "safeSearch", "apiKeyEnv"]) {
            if (be[k] !== undefined) resultOptions[`${id}.${k}`] = be[k];
          }
        }
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
          const cacheNote = `[websearch cache] cache hit, age ${hit.age}s`;
          hitContent = hitContent === undefined ? cacheNote : hitContent + "\n\n" + cacheNote;
          // A cache hit is served from a prior successful fan-out; a zero
          // counter made it indistinguishable from a total outage.
          const hitCount = hit.value.sources.length > 0 ? 1 : 0;
          recordHistory(history, request?.query, hit.value.sources.length, hitCount, hitCount);
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
        const failOpen = active.concat([...cooled.entries()]
          .filter(([, e]) => e?.rateLimited !== true)
          .map(([id]) => candidates.find((c) => c.id === id))
          .filter(Boolean));
        if (failOpen.length > 0) eligible = failOpen;
        else if (rateLimitedCooled.size > 0) {
          const until = Math.max(...[...rateLimitedCooled.values()].map((e) => e?.cooledUntil ?? 0));
          const waitS = Math.max(0, Math.ceil((until - nowMs) / 1000));
          // Distinguish a real quota/rate-limit cooldown from a keyless
          // permission refusal: retrying the latter after N seconds cannot
          // succeed without configuring a key.
          const keyless = [...rateLimitedCooled.values()].some((e) => e?.keylessRejected === true);
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
        throw new WebError(
          "unified search: no enabled backend is available (configure a backend or set an API key)",
          "WEB_PROVIDER_UNAVAILABLE",
        );
      }

      // Run ONE query variant through the full fan-out: breaker-aware backend
      // execution under the per-variant limiter, then PHASE 1 collect. The
      // internal abort/timeout semantics are unchanged from v2.7.
      const fanoutVariant = async (variantReq) => {
        const telemetry = [];
        const limit = createLimiter(concurrency);
        const runBackend = ({ id, backend, beOpts, hooks }) => {
          const startedAtMs = Date.now();
          // Trust boundary: baseURL is operator-configurable and API keys are sent to it.
          // Enforce http(s); plain http only for private hosts (self-hosted SearXNG).
          // Reject embedded credentials. Failure is a per-backend soft error.
          if (beOpts.baseURL !== undefined) {
            let bu = null;
            try { bu = new URL(beOpts.baseURL); } catch { bu = null; }
            // The first two octets of 192.168/16 and 172.16/12 are already matched,
            // so exactly two further octets may follow. Plain-http is allowed
            // only for RFC1918 hosts that pass this gate.
            const privHost = bu ? /^(localhost|127(\.\d{1,3}){3}|10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2})$/.test(bu.hostname) : false;
            const schemeOk = bu && (bu.protocol === "https:" || (bu.protocol === "http:" && privHost));
            if (!schemeOk || bu.username || bu.password) {
              throw new WebError(`backend "${id}" has an invalid baseURL: https required (plain http only for private hosts), credentials-in-URL rejected`, "WEB_PROVIDER_ERROR");
            }
          }
          const controller = new AbortController();
          const mergedSignal = signal
            ? AbortSignal.any([signal, controller.signal])
            : controller.signal;
          const effectiveTimeoutMs = effectiveBackendTimeoutMs(id, backendTimeoutMs);
          const timeoutId = setTimeout(() => controller.abort(), effectiveTimeoutMs);
          return backend
            .search(variantReq, mergedSignal, beOpts, hooks)
            .then(
              (value) => {
                telemetry.push({ id, ok: true, ms: Date.now() - startedAtMs, count: value?.sources?.length ?? 0 });
                recordBackendHealth(id, { ok: true, at: Date.now(), ms: Date.now() - startedAtMs, count: value?.sources?.length ?? 0 }, breakerCfg);
                return value;
              },
              (err) => {
                // Timeout classification happens BEFORE telemetry/health are
                // recorded: backends surface an internal timeout as their own
                // abort-flavored error, so recording that text would make the
                // telemetry line disagree with the thrown error and read as a
                // user cancellation.
                const timedOut = controller.signal.aborted && !(signal && signal.aborted);
                const reason = timedOut
                  ? `backend "${id}" timed out after ${effectiveTimeoutMs}ms`
                  : String(err instanceof Error ? err.message : err);
                const msg = reason.slice(0, 80);
                telemetry.push({ id, ok: false, ms: Date.now() - startedAtMs, error: msg });
                recordBackendHealth(id, { ok: false, at: Date.now(), ms: Date.now() - startedAtMs, error: msg }, breakerCfg,
                  { rateLimited: rateLimited(err), keylessRejected: keylessRejected(err), retryAfterMs: retryAfterMsFrom(err) });
                throw timedOut
                  ? new WebError(reason, "WEB_PROVIDER_ERROR", { cause: err instanceof Error ? err : undefined })
                  : err;
              },
            )
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
        const fold = collectFanoutResults(results, eligible, signal);
        return { ...fold, telemetry };
      };

      // Fan out per variant (sequential — the limiter already parallelizes
      // backends within a variant), dedupe/rank each list, then fuse.
      const perVariant = [];
      const allTelemetry = [];
      const allFailures = [];
      let hardError = null;
      for (const variantQuery of variants) {
        const variantReq = {
          ...effReq,
          query: variantQuery,
          maxResults: backendMaxResults,
          ...(coverage ? { deepCoverage: true } : {}),
        };
        const fold = await fanoutVariant(variantReq);
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

      // Counted once: every history record below needs it, and the fan-out is
      // finished by this point so the array no longer grows.
      const okCount = allTelemetry.filter((t) => t.ok).length;

      // PHASE 4 fuse: multi-query mode fuses the per-variant ranked lists with
      // RRF (k=60); single-query mode keeps the historical behavior (the one
      // list, unchanged ordering).
      const orderedLists = perVariant.filter((v) => v.ordered.length > 0).map((v) => v.ordered);
      const ordered = multi
        ? rrfFuse(orderedLists).fused
        : (orderedLists[0] ?? []);

      // If we got ANY sources, return them even if some backends failed.
      if (ordered.length > 0) {
        const sources = ordered.slice(0, maxResults);
        // 结果呈现头（Anthropic web-search / OpenAI grounding 官方指引）：
        // 置于结果块最前，要求逐条引用来源 URL、优先官方/一手与较新来源；
        // The result header is always prepended; the language follows the
        // query text (CJK selects the Chinese header).
        let outContent = perVariant.find((v) => v.mergedContent !== undefined)?.mergedContent;
        if (sources.length > 0 || outContent !== undefined) {
          const header = resultHeader(typeof request?.query === "string" && /[\u4e00-\u9fff]/.test(request.query) ? "zh" : "en");
          outContent = outContent === undefined ? header : header + "\n\n" + outContent;
        }
        // Store the pre-telemetry core (sources + headered content) so a cache
        // hit reproduces the exact sources and the model-facing header.
        if (cacheKey && cache) {
          cache.set(cacheKey, { sources, content: outContent, truncated: ordered.length > maxResults });
        }
        recordHistory(history, request?.query, sources.length, okCount, allTelemetry.length);
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
          const parts = allTelemetry
            .slice(0, 12)
            .map((t) => {
              if (t.ok) return t.id + " ✓" + t.ms + "ms/" + t.count;
              const label = failureLabel(t.id, t.error) ?? (t.error ? String(t.error).slice(0, 40) : "");
              const cooledNow = cooledAnnotation(latestBackendHealth.get(t.id), Date.now());
              return t.id + " ✗" + t.ms + "ms" + (label ? " (" + label + ")" : "") + (cooledNow ? " " + cooledNow : "");
            })
            .concat(cooledParts);
          if (allTelemetry.length > 12) parts.push(`… +${allTelemetry.length - 12}`);
          const line = "[websearch backends]" + TELEMETRY_TAG + " " + parts.join(" · ");
          outContent = outContent === undefined ? line : outContent + "\n\n" + line;
        }
        return {
          sources,
          ...(outContent !== undefined ? { content: outContent } : {}),
          truncated: ordered.length > maxResults,
        };
      }

      // 2.8.2（P1）：零结果 ≠ 全部失败。所有后端成功但确实 0 条命中（冷僻查询/
      // 过滤后为空）时，原实现无条件落入下面的 throw，模型端拿到
      // `all enabled backends failed (0) - `（detail 空、计数自相矛盾），且丢弃已
      // 拿到的 mergedContent（如 Tavily 直答）。成功即空 → 正常返回空结果。
      if (allFailures.length === 0) {
        let emptyContent = perVariant.find((v) => v.mergedContent !== undefined)?.mergedContent;
        if (emptyContent !== undefined) {
          const header = resultHeader(typeof request?.query === "string" && /[\u4e00-\u9fff]/.test(request.query) ? "zh" : "en");
          emptyContent = header + "\n\n" + emptyContent;
        }
        recordHistory(history, request?.query, 0, okCount, allTelemetry.length);
        if (cacheKey && cache) cache.set(cacheKey, { sources: [], content: emptyContent, truncated: false });
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
      recordHistory(history, request?.query, 0, okCount, allTelemetry.length);
      // Anchor the note to the fan-out instant, not to render time: a slow search
      // can outlive the window, and recomputing here would claim "expired" for
      // a backend that was genuinely cooling when we decided to skip it.
      const cooledNote = cooled.size > 0
        ? " (cooled-skipped: " + [...cooled].map(([cid, centry]) => cid + " " + (cooledAnnotation(centry, nowMs) || "⏸cooled")).join(", ") + ")"
        : "";
      // Reasons beyond MAX_FAILURE_DETAILS collapse into "+N more"; backends
      // that never ran (breaker cooldown) are named explicitly — without the
      // note "(N)" reads as "N enabled" when it means "N attempted".
      const detail = allFailures.slice(0, MAX_FAILURE_DETAILS)
        .map((f) => f.id + ": " + String(f.err instanceof Error ? f.err.message : f.err).slice(0, 120))
        .join("; ") + (allFailures.length > MAX_FAILURE_DETAILS ? `; +${allFailures.length - MAX_FAILURE_DETAILS} more` : "");
      const allKeyMissing =
        allFailures.length > 0 &&
        allFailures.every((f) => f.err instanceof WebError && (f.err.code === "WEB_PROVIDER_UNAVAILABLE" || f.err.code === "WEB_PROVIDER_CREDENTIAL_MISSING"));
      const hint = allKeyMissing
        ? " (every enabled backend is missing its API key - add keys in Settings > Web Search, or enable a keyless backend)"
        : "";
      // A total outage must be visible in history: otherwise the newest entry
      // still shows the last success while health already records failures,
      // making failure-rate/availability statistics silently omit outages.
      recordHistory(history, request?.query, 0, okCount, allTelemetry.length);
      throw new WebError(
        `unified search: all enabled backends failed (${allFailures.length}) - ${detail}` + cooledNote + hint,
        "WEB_PROVIDER_ERROR",
        { cause: hardError ?? undefined },
      );
    },
  };
}

export default { createUnifiedSearchProvider, PROVIDER_ID };
