// tests/lead-20261128-tiers.test.js — search intervention tiers, query-shaping
// safety, version-aware ranking, and cache separation between tiers.
// Run: node --test tests/lead-20261128-tiers.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveOptions } from "../lib/index.js";
import { shapeQuery } from "../lib/prompting.js";
import { tokenize, tokenSimilarity, dedupeSources } from "../lib/util/rank.js";
import { rrfFuse } from "../lib/rrf.js";
import { createUnifiedSearchProvider, getBackendBreaker, getLatestBackendHealth } from "../lib/provider.js";

const CTX = { get: () => undefined };

test("shapeQuery keeps quotes, operators and content words; strips only explicit requests", () => {
  assert.equal(shapeQuery('"exact phrase" site:example.com'), '"exact phrase" site:example.com');
  assert.equal(shapeQuery("「和平精英」灵敏度设置"), "「和平精英」灵敏度设置");
  assert.equal(shapeQuery("Google Search Console API"), "Google Search Console API");
  assert.equal(shapeQuery("Search Console"), "Search Console");
  assert.equal(shapeQuery("Find My iPhone"), "Find My iPhone");
  assert.equal(shapeQuery("findability testing"), "findability testing");
  assert.equal(shapeQuery("searching algorithms"), "searching algorithms");
  assert.equal(shapeQuery("please find site:github.com 240xu"), "find site:github.com 240xu");
  assert.equal(shapeQuery("请帮我查一下 DSH 0.2.2 的契约"), "DSH 0.2.2 的契约");
  assert.equal(shapeQuery("搜索引擎优化"), "搜索引擎优化");
  assert.equal(shapeQuery("search"), "");
  assert.equal(shapeQuery("搜索"), "");
});

test("tokenize keeps version digits so dedupe/rerank distinguish versions", () => {
  assert.ok(tokenize("GPT-4 pricing").has("4"));
  assert.ok(tokenize("nodejs24").has("nodejs24"));
  assert.ok(tokenSimilarity(tokenize("GPT-4 pricing"), tokenize("GPT-5 pricing")) < 0.9);
  const merged = dedupeSources([
    { url: "https://example.com/4", title: "GPT-4 pricing" },
    { url: "https://example.com/5", title: "GPT-5 pricing" },
  ], "url+title");
  assert.equal(merged.length, 2, "different versions must not merge as the same page");
});

test("RRF weights keep the original query ahead of repeated variant hits", () => {
  const A = { url: "https://a.example/answer" };
  const B = { url: "https://b.example/hub" };
  const lists = [
    [A, { url: "https://x1" }],
    [{ url: "https://x2" }, { url: "https://x3" }, { url: "https://x4" }, { url: "https://x5" }, B],
    [{ url: "https://y2" }, { url: "https://y3" }, { url: "https://y4" }, { url: "https://y5" }, B],
  ];
  const plain = rrfFuse(lists).fused;
  assert.equal(plain[0].url, B.url, "with equal weights, presence in two variants wins");
  const weighted = rrfFuse(lists, { weights: [2, 1, 1] }).fused;
  assert.equal(weighted[0].url, A.url, "the original query's rank-0 answer must win");
});

test("resolveOptions maps balanced (default) to today's effective options", () => {
  const base = resolveOptions(CTX, {});
  assert.equal(base.intervention, "balanced");
  assert.equal(base.queryShaping, true);
  assert.equal(base.resultHeader, true);
  assert.equal(base.resultTelemetry, true);
  assert.equal(base.rerank, false);
  assert.equal(base.multiQueryEnabled, false);
  assert.equal(base.deepCoverage, false);
  assert.equal(base.numResults, 10);
  assert.equal(resolveOptions(CTX, { intervention: "bogus" }).intervention, "balanced");
});

test("resolveOptions official removes provider rewriting/presentation and defers the cap", () => {
  const o = resolveOptions(CTX, { intervention: "official", numResults: 3, rerank: true, multiQueryEnabled: true, deepCoverage: true });
  assert.equal(o.queryShaping, false);
  assert.equal(o.resultHeader, false);
  assert.equal(o.resultTelemetry, false);
  assert.equal(o.rerank, false);
  assert.equal(o.multiQueryEnabled, false);
  assert.equal(o.deepCoverage, false);
  assert.equal(o.numResults, undefined);
});

test("resolveOptions thorough forces rerank+coverage but not internal multi-query", () => {
  const o = resolveOptions(CTX, { intervention: "thorough" });
  assert.equal(o.rerank, true);
  assert.equal(o.deepCoverage, true);
  assert.equal(o.multiQueryEnabled, false, "the official tool owns multi-query; thorough must not multiply calls");
  assert.equal(o.queryShaping, true);
  assert.equal(o.resultHeader, true);
});

function tierProvider(tier, overrides = {}) {
  const calls = [];
  const cache = new Map();
  const options = resolveOptions(CTX, {
    intervention: tier,
    numResults: 3,
    resultTelemetry: true,
    ...overrides,
  });
  const provider = createUnifiedSearchProvider({
    ctx: {},
    history: undefined,
    cache: {
      get: (key) => cache.get(key),
      set: (key, value) => cache.set(key, { value, age: 0 }),
    },
    backends: {
      fake: {
        id: "fake",
        available: () => true,
        async search(request) {
          calls.push({ query: request.query, maxResults: request.maxResults });
          return { sources: [{ url: "https://example.com/" + calls.length, title: "t" }] };
        },
      },
    },
    resolveOptions: () => ({
      ...options,
      enabledBackends: ["fake"], backends: { fake: {} }, filters: {},
      safeSearch: true, dedupStrategy: "url", concurrency: 6,
      backendTimeoutMs: 30_000, language: "", recency: "any",
      cacheEnabled: true, breakerEnabled: false, historyEnabled: false,
    }),
  });
  return { provider, calls, cache, options };
}

test("official sends the raw query and the host cap; balanced shapes and presents", async () => {
  const raw = "please find Google Search Console API";
  const official = tierProvider("official");
  const officialResult = await official.provider.search({ query: raw, maxResults: 10 }, new AbortController().signal);
  assert.equal(official.calls[0].query, raw, "official must not rewrite the model's query");
  assert.equal(official.calls[0].maxResults, 10, "official follows the consumer's bound, not numResults=3");
  assert.equal(officialResult.content, undefined, "no provider-added header/telemetry");

  const balanced = tierProvider("balanced");
  const balancedResult = await balanced.provider.search({ query: raw, maxResults: 10 }, new AbortController().signal);
  assert.equal(balanced.calls[0].query, "find Google Search Console API");
  assert.equal(balanced.calls[0].maxResults, 3);
  assert.match(String(balancedResult.content), /^Web search results/);
  assert.match(String(balancedResult.content), /\[websearch backends\]/);
});

test("thorough widens per-backend requests by 1.5x but still respects the host cap", async () => {
  const thorough = tierProvider("thorough");
  await thorough.provider.search({ query: "vite build performance", maxResults: 10 }, new AbortController().signal);
  assert.equal(thorough.calls[0].maxResults, 5, "ceil(min(10, 3) * 1.5)");
});

test("tier and shaping options participate in the cache key", async () => {
  const first = tierProvider("official");
  await first.provider.search({ query: "please find X", maxResults: 10 }, new AbortController().signal);
  assert.equal(first.cache.size, 1);
  const [firstKey] = [...first.cache.keys()];
  // Reuse the same cache instance for a balanced search of the same raw query.
  const calls = [];
  const provider = createUnifiedSearchProvider({
    ctx: {}, history: undefined, cache: { get: (k) => first.cache.get(k), set: (k, v) => first.cache.set(k, { value: v, age: 0 }) },
    backends: { fake: { id: "fake", available: () => true, async search() { calls.push(1); return { sources: [{ url: "https://example.com/b" }] }; } } },
    resolveOptions: () => ({
      ...resolveOptions(CTX, { intervention: "balanced", numResults: 3, resultTelemetry: true }),
      enabledBackends: ["fake"], backends: { fake: {} }, filters: {}, safeSearch: true,
      dedupStrategy: "url", concurrency: 6, backendTimeoutMs: 30_000, language: "",
      recency: "any", cacheEnabled: true, breakerEnabled: false, historyEnabled: false,
    }),
  });
  await provider.search({ query: "please find X", maxResults: 10 }, new AbortController().signal);
  assert.equal(calls.length, 1, "a different tier must not be served the other tier's cache entry");
  assert.equal([...first.cache.keys()].length, 2);
  assert.notEqual([...first.cache.keys()][1], firstKey);
});

test("one multi-query search folds the breaker once per backend, not once per variant", async () => {
  getLatestBackendHealth().clear();
  const calls = [];
  const entries = [];
  const id = "multiq";
  const provider = createUnifiedSearchProvider({
    ctx: {}, cache: undefined, history: { record: (entry) => entries.push(entry) },
    backends: {
      [id]: {
        id, available: () => true,
        async search() { calls.push(1); throw new Error("upstream 503"); },
      },
    },
    resolveOptions: () => ({
      enabledBackends: [id], backends: { [id]: {} }, numResults: 8, filters: {},
      safeSearch: true, rerank: false, dedupStrategy: "url", cacheEnabled: false,
      resultTelemetry: true, breakerEnabled: true, breakerThreshold: 3,
      breakerCooldownMs: 60_000, multiQueryEnabled: true, deepCoverage: false,
      backendTimeoutMs: 30_000, language: "", recency: "any", resultHeader: true,
      historyEnabled: false,
    }),
  });
  await assert.rejects(provider.search(
    { query: "vite vs webpack build speed and config", maxResults: 8 },
    new AbortController().signal,
  ));
  assert.ok(calls.length >= 2, "the gate derives multiple variants");
  assert.equal(getBackendBreaker(id).failCount, 1, "one search counts once, not once per variant");
  assert.equal(getBackendBreaker(id).cooledUntil, 0, "one search must not trip the threshold");
  assert.equal(entries.at(-1)?.backendsTotal, 1, "history counts the backend once, not once per variant");
  getLatestBackendHealth().clear();
});

test("a backend that ignores its abort signal still obeys the per-backend timeout", async () => {
  const provider = createUnifiedSearchProvider({
    ctx: {}, cache: undefined, history: undefined,
    backends: {
      hung: {
        id: "hung", available: () => true,
        search() { return new Promise(() => {}); },
      },
    },
    resolveOptions: () => ({
      ...resolveOptions(CTX, {}),
      enabledBackends: ["hung"], backends: { hung: {} }, filters: {},
      safeSearch: true, dedupStrategy: "url", concurrency: 2,
      backendTimeoutMs: 120, language: "", recency: "any",
      cacheEnabled: false, breakerEnabled: false, historyEnabled: false,
    }),
  });
  const started = Date.now();
  await assert.rejects(
    provider.search({ query: "hang", maxResults: 5 }, new AbortController().signal),
    /timed out after 120ms/,
  );
  assert.ok(Date.now() - started < 1000, "the race must not wait for the hung promise");
});
