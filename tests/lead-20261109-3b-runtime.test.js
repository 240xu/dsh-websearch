// tests/lead-20261109-3b-runtime.test.js — behaviour-level regression for the
// 3b all-rate-limited fast-fail branch. Drives the REAL provider with fake
// backends: after every backend is cooled by a 429, a second search must fail
// immediately with the rate-limit hint and must NOT call any backend again.
// Run: node --test tests/lead-20261109-3b-runtime.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createUnifiedSearchProvider, getLatestBackendHealth } from "../lib/provider.js";
import { BREAKER_DEFAULTS } from "../lib/breaker.js";

function fakeBackend(id, calls) {
  return {
    id,
    available: () => true,
    async search() {
      calls.push(id);
      throw new Error("MCP tools/call HTTP 429: too many requests");
    },
  };
}

test("3b: a fully rate-limited fan-out fails fast without re-hitting backends", async () => {
  const health = getLatestBackendHealth();
  health.clear();
  const calls = [];
  const ids = ["exa", "parallel"];
  const backends = Object.fromEntries(ids.map((id) => [id, fakeBackend(id, calls)]));
  const resolveOptions = () => ({
    enabledBackends: ids,
    backends: Object.fromEntries(ids.map((id) => [id, { requiresKey: false }])),
    numResults: 8,
    filters: {},
    safeSearch: true,
    rerank: false,
    dedupStrategy: "url",
    cacheEnabled: false,
    resultTelemetry: true,
    breakerEnabled: true,
    breakerThreshold: BREAKER_DEFAULTS.threshold,
    breakerCooldownMs: BREAKER_DEFAULTS.cooldownMs,
    multiQueryEnabled: false,
    deepCoverage: false,
    backendTimeoutMs: 30000,
    language: "",
    recency: "any",
    resultHeader: true,
    historyEnabled: false,
  });
  const provider = createUnifiedSearchProvider({
    ctx: {}, resolveOptions, backends, cache: undefined, history: undefined,
  });

  // First call: both backends fail with 429 -> each is cooled immediately (3a).
  await assert.rejects(
    provider.search({ query: "first", maxResults: 8 }, new AbortController().signal),
  );
  assert.equal(calls.length, 2, "first search should fan out to both backends");
  const allCooled = ids.every((id) => {
    const e = health.get(id);
    return e && e.rateLimited === true && e.cooledUntil > Date.now();
  });
  assert.equal(allCooled, true, "both backends must be recorded as rate-limited & cooled");

  // Second call: all backends are cooled -> fast fail, zero new backend calls.
  calls.length = 0;
  await assert.rejects(
    provider.search({ query: "second", maxResults: 8 }, new AbortController().signal),
    (err) => /all backends are rate-limited; retry after/.test(String(err?.message)),
  );
  assert.equal(calls.length, 0, "fast-fail must not re-hit limited endpoints");
  health.clear();
});

test("3b: a non-quota cooldown keeps the existing fail-open behaviour", async () => {
  const health = getLatestBackendHealth();
  health.clear();
  const calls = [];
  const id = "exa";
  const now = Date.now();
  // Pre-seed a cooled backend that is NOT rate-limited.
  health.set(id, {
    ok: false, at: now, ms: 1, error: "connection refused",
    failCount: 3, cooledUntil: now + 60_000, rateLimited: false,
  });
  const resolveOptions = () => ({
    enabledBackends: [id], backends: { [id]: { requiresKey: false } },
    numResults: 8, filters: {}, safeSearch: true, rerank: false, dedupStrategy: "url",
    cacheEnabled: false, resultTelemetry: true, breakerEnabled: true,
    breakerThreshold: 3, breakerCooldownMs: 60_000,
    multiQueryEnabled: false, deepCoverage: false, backendTimeoutMs: 30000,
    language: "", recency: "any", resultHeader: true, historyEnabled: false,
  });
  const provider = createUnifiedSearchProvider({
    ctx: {}, resolveOptions, backends: { [id]: fakeBackend(id, calls) },
    cache: undefined, history: undefined,
  });
  // Non-quota cooldown must fail open (backend is called again), not fast-fail.
  await provider.search({ query: "third", maxResults: 8 }, new AbortController().signal)
    .catch(() => {});
  assert.equal(calls.length, 1, "non-quota cooling must still fail open");
  health.clear();
});

// V3 runtime assessment: mixed-outage fail-open must NOT re-hit a cooled
// rate-limited endpoint. Drive the real provider with a fake backend set.
test("mixed cooldown: rate-limited backend is excluded, non-quota one is retried", async () => {
  const health = getLatestBackendHealth();
  health.clear();
  const calls = [];
  const now = Date.now();
  const mk = (id, msg) => ({ id, available: () => true, async search() { calls.push(id); throw new Error(msg); } });
  const ids = ["limited", "ordinary"];
  const backends = Object.fromEntries(ids.map((id) => [id, mk(id, "boom")]));
  const resolveOptions = () => ({
    enabledBackends: ids,
    backends: Object.fromEntries(ids.map((id) => [id, { requiresKey: false }])),
    numResults: 8, filters: {}, safeSearch: true, rerank: false, dedupStrategy: "url",
    cacheEnabled: false, resultTelemetry: true, breakerEnabled: true,
    breakerThreshold: 3, breakerCooldownMs: 60_000, multiQueryEnabled: false,
    deepCoverage: false, backendTimeoutMs: 30000, language: "", recency: "any",
    resultHeader: true, historyEnabled: false,
  });
  const provider = createUnifiedSearchProvider({ ctx: {}, resolveOptions, backends, cache: undefined, history: undefined });
  // Pre-seed both as cooled; only `limited` is rate-limited.
  health.set("limited", { ok: false, at: now, ms: 1, error: "429", failCount: 1, cooledUntil: now + 60_000, rateLimited: true });
  health.set("ordinary", { ok: false, at: now, ms: 1, error: "refused", failCount: 3, cooledUntil: now + 60_000, rateLimited: false });
  calls.length = 0;
  await provider.search({ query: "mixed", maxResults: 8 }, new AbortController().signal).catch(() => {});
  assert.equal(calls.includes("limited"), false, "cooled rate-limited backend must not be re-hit");
  assert.equal(calls.includes("ordinary"), true, "non-quota outage keeps fail-open");
  health.clear();
});

// A keyless permission refusal is not a retryable rate limit.
test("keylessRejected distinguishes a missing key from a 429", async () => {
  const { keylessRejected } = await import("../lib/util/failure-label.js");
  assert.equal(keylessRejected(new Error("Anonymous keyless access is unavailable. Fix: Create an API key")), true);
  assert.equal(keylessRejected(new Error("HTTP 429 too many requests")), false);
  assert.equal(keylessRejected(new Error("connection refused")), false);
});
