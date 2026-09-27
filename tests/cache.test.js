// cache.test.js — v2.7.0 disk cache: hit / TTL expiry / cap eviction / atomic shape.
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSearchCache, cacheKeyFor, CACHE_DEFAULTS } from "../lib/cache.js";

const dir = mkdtempSync(join(tmpdir(), "dsh-ws-cache-"));

// 1. miss -> set -> hit; sources identical; age reported.
{
  const cache = createSearchCache({ dir, ttlMs: 60_000, maxEntries: 10 });
  assert.equal(cache.get("k1"), null, "cold miss");
  const value = { sources: [{ url: "https://a.example/x" }], content: "core", truncated: false };
  cache.set("k1", value);
  const hit = cache.get("k1");
  assert.ok(hit, "hit after set");
  assert.deepEqual(hit.value.sources, value.sources, "sources byte-identical");
  assert.equal(hit.value.content, "core");
  assert.ok(hit.age >= 0 && hit.age <= 1);
}

// 2. TTL expiry: expired entry is a miss and the file is cleaned up.
{
  const cache = createSearchCache({ dir, ttlMs: 1000, maxEntries: 10 });
  cache.set("k-exp", { sources: [1], content: "x", truncated: false });
  // backdate the stored record by 2s
  const expired = cache.get("k-exp", Date.now() + 2000);
  assert.equal(expired, null, "expired entry is a miss");
}

// 3. cap eviction: writing maxEntries+3 keeps only the newest maxEntries.
{
  const cdir = mkdtempSync(join(tmpdir(), "dsh-ws-cache-evict-"));
  const cache = createSearchCache({ dir: cdir, ttlMs: 60_000, maxEntries: 3 });
  for (let i = 0; i < 6; i++) {
    cache.set("k" + i, { sources: [i], content: "c", truncated: false });
  }
  const files = readdirSync(cdir).filter((f) => f.endsWith(".json"));
  assert.equal(files.length, 3, "cap enforced, got " + files.length);
  assert.ok(cache.get("k5"), "newest kept");
  assert.ok(cache.get("k4"), "second-newest kept");
  assert.equal(cache.get("k0"), null, "oldest evicted");
}

// 4. atomic write shape: no leftover tmp files after set.
{
  const cache = createSearchCache({ dir, ttlMs: 60_000, maxEntries: 10 });
  cache.set("k-atomic", { sources: [], content: "c", truncated: false });
  const leftovers = readdirSync(dir).filter((f) => f.includes(".tmp"));
  assert.equal(leftovers.length, 0, "tmp file renamed away");
  assert.ok(existsSync(join(dir, "k-atomic.json")));
}

// 5. key canonicalization: same (query, filters, maxResults, backends) ->
//    same key; each differing dimension -> different key. Query is pre-shaped.
{
  const a = cacheKeyFor({ query: "dsh plugin", filters: { recency: "week" }, maxResults: 8, backends: ["exa", "ddg"] });
  const b = cacheKeyFor({ query: "dsh plugin", filters: { recency: "week" }, maxResults: 8, backends: ["exa", "ddg"] });
  assert.equal(a, b, "deterministic key");
  assert.notEqual(a, cacheKeyFor({ query: "dsh plugin", filters: {}, maxResults: 8, backends: ["exa", "ddg"] }), "filters in key");
  assert.notEqual(a, cacheKeyFor({ query: "dsh plugin", filters: { recency: "week" }, maxResults: 5, backends: ["exa", "ddg"] }), "maxResults in key");
  // arch-review P1-1: switching the backend mix must change the key,
  // regardless of order in the list.
  assert.notEqual(a, cacheKeyFor({ query: "dsh plugin", filters: { recency: "week" }, maxResults: 8, backends: ["exa"] }), "enabledBackends in key");
  assert.notEqual(a, cacheKeyFor({ query: "dsh plugin", filters: { recency: "week" }, maxResults: 8, backends: ["exa", "ddg", "brave"] }), "backend mix in key");
  assert.equal(
    cacheKeyFor({ query: "q", backends: ["exa", "ddg"] }),
    cacheKeyFor({ query: "q", backends: ["ddg", "exa"] }),
    "backend order-insensitive",
  );
  assert.equal(a.length, 32, "truncated sha256 hex");
}

// 6. defaults exported and sane.
{
  assert.equal(CACHE_DEFAULTS.ttlMs, 900_000);
  assert.equal(CACHE_DEFAULTS.maxEntries, 200);
}

// 7. clear() empties everything.
{
  const cdir = mkdtempSync(join(tmpdir(), "dsh-ws-cache-clear-"));
  const cache = createSearchCache({ dir: cdir, ttlMs: 60_000, maxEntries: 5 });
  cache.set("a", { sources: [1], content: "c", truncated: false });
  cache.set("b", { sources: [2], content: "c", truncated: false });
  cache.clear();
  assert.equal(cache.get("a"), null);
  assert.equal(cache.get("b"), null);
}

console.log("cache.test.js: all 7 test groups passed");
