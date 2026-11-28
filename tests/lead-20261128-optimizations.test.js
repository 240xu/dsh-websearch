// tests/lead-20261128-optimizations.test.js — cache eviction bound, effective
// backend timeout plumbing, and the P3 dead-branch cleanup.
// Run: node --test tests/lead-20261128-optimizations.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSearchCache } from "../lib/cache.js";
import { createUnifiedSearchProvider } from "../lib/provider.js";

test("cache keeps a hard entry bound while trimming only when over the cap", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "dsh-cache-cap-"));
  try {
    const cache = createSearchCache({ dir, ttlMs: 900_000, maxEntries: 3 });
    for (let i = 0; i < 12; i += 1) cache.set("k" + i, { sources: [{ url: "https://e/" + i }] });
    const entries = readdirSync(dir).filter((n) => n.endsWith(".json") && !n.includes(".tmp"));
    assert.ok(entries.length <= 3, `directory must stay within cap, saw ${entries.length}`);
    assert.ok(cache.get("k11") !== null, "the newest entry survives");
    assert.equal(cache.get("k0"), null, "the oldest entry is evicted");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the effective per-backend timeout is passed to backends that split it", async () => {
  const seen = [];
  const provider = createUnifiedSearchProvider({
    ctx: {}, cache: undefined, history: undefined,
    backends: {
      searxng: {
        id: "searxng", available: () => true,
        async search(_request, _signal, options) {
          seen.push(options.backendTimeoutMs);
          return { sources: [] };
        },
      },
    },
    resolveOptions: () => ({
      enabledBackends: ["searxng"], backends: { searxng: { baseURL: "https://searx.be" } },
      numResults: 8, filters: {}, safeSearch: true, rerank: false, dedupStrategy: "url",
      cacheEnabled: false, resultTelemetry: false, breakerEnabled: false,
      multiQueryEnabled: false, deepCoverage: false, backendTimeoutMs: 30_000,
      language: "", recency: "any", resultHeader: false, historyEnabled: false,
    }),
  });
  await provider.search({ query: "q", maxResults: 8 }, new AbortController().signal);
  assert.equal(seen[0], 8_000, "searxng's 8s ceiling must reach the backend budget splitter");
});
