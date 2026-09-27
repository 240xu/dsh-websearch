// tests/v27.test.js — v2.7.0 integration: provider-level cache hit and breaker skip.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createUnifiedSearchProvider, getLatestBackendHealth } from "../lib/provider.js";
import { createSearchCache } from "../lib/cache.js";

function makeSyntheticBackend(id, behavior) {
  let calls = 0;
  return {
    id,
    callCount: () => calls,
    available: () => true,
    search: async () => {
      calls++;
      return behavior();
    },
  };
}

test("v2.7.0 cache: second identical search hits cache, backend not re-called, note appended", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dsh-ws-v27-cache-"));
  const cache = createSearchCache({ dir, ttlMs: 60_000, maxEntries: 10 });
  const be = makeSyntheticBackend("fake1", () => ({
    sources: [{ title: "T", url: "https://example.com/a" }],
    content: "core content",
  }));
  const provider = createUnifiedSearchProvider({
    ctx: {},
    resolveOptions: () => ({
      enabledBackends: ["fake1"],
      numResults: 8,
      cacheEnabled: true,
      backends: { fake1: {} },
      ctx: {},
    }),
    backends: { fake1: be },
    cache,
  });
  const r1 = await provider.search({ query: "cache probe", maxResults: 8 }, undefined);
  assert.equal(be.callCount(), 1);
  const r2 = await provider.search({ query: "cache probe", maxResults: 8 }, undefined);
  assert.equal(be.callCount(), 1, "backend NOT re-called on cache hit");
  assert.deepEqual(r2.sources, r1.sources, "sources identical to first search");
  assert.match(r2.content, /cache hit, age \d+s/, "cache note appended");
  // different maxResults -> different key -> backend called again
  await provider.search({ query: "cache probe", maxResults: 5 }, undefined);
  assert.equal(be.callCount(), 2, "different maxResults bypasses cache");
});

test("v2.7.0 breaker: 3 consecutive failures open cooldown; cooled backend skipped with ⏸cooled telemetry", async () => {
  const be = makeSyntheticBackend("flaky", () => {
    throw new Error("boom 503");
  });
  const okBe = makeSyntheticBackend("steady", () => ({
    sources: [{ title: "S", url: "https://example.com/s" }],
  }));
  const provider = createUnifiedSearchProvider({
    ctx: {},
    resolveOptions: () => ({
      enabledBackends: ["flaky", "steady"],
      numResults: 8,
      breakerEnabled: true,
      breakerThreshold: 3,
      breakerCooldownMs: 60_000,
      backends: { flaky: {}, steady: {} },
      ctx: {},
    }),
    backends: { flaky: be, steady: okBe },
  });
  for (let i = 0; i < 3; i++) {
    const r = await provider.search({ query: "breaker probe " + i, maxResults: 8 }, undefined);
    assert.ok(r.sources.length > 0, "steady still serves");
  }
  assert.equal(be.callCount(), 3, "flaky called exactly 3 times before opening");
  const health = getLatestBackendHealth().get("flaky");
  assert.equal(health.failCount, 3, "failCount folded into health entry");
  assert.ok(health.cooledUntil > Date.now(), "cooledUntil in the future");

  // 4th search: flaky is cooled and must be skipped entirely.
  const r4 = await provider.search({ query: "breaker probe 4", maxResults: 8 }, undefined);
  assert.equal(be.callCount(), 3, "cooled backend not called");
  assert.match(r4.content, /flaky ⏸cooled/, "telemetry annotates the cooled skip");
  assert.match(r4.content, /steady ✓/, "healthy backend still reported");
  // breaker state readable
  const b = (await import("../lib/provider.js")).getBackendBreaker("flaky");
  assert.ok(b.cooledUntil > Date.now());
});
