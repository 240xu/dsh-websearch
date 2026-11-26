// tests/rank.test.js — dedupe strategies and deterministic rerank.
import { test } from "node:test";
import assert from "node:assert/strict";

import { tokenize, tokenSimilarity, dedupeSources, rerankSources } from "../lib/util/rank.js";

test("tokenize: ascii words (len>=2) + individual CJK chars", () => {
  const t = tokenize("Hello 世界 nodejs24");
  assert.ok(t.has("hello"));
  assert.ok(t.has("nodejs24"));
  assert.ok(t.has("世"));
  assert.ok(t.has("界"));
  // len-1 ascii tokens excluded
  assert.ok(!t.has("a"));
});

test("tokenSimilarity: identical=1, disjoint=0", () => {
  assert.equal(tokenSimilarity(tokenize("rust tokio"), tokenize("Rust Tokio")), 1);
  assert.equal(tokenSimilarity(tokenize("apple pie"), tokenize("car race")), 0);
});

test("dedupeSources url strategy: fills missing fields from later duplicates", () => {
  const merged = dedupeSources([
    { url: "HTTPS://Shared.com/a", title: "T1" },
    { url: "https://shared.com/a", snippet: "S2", publishedAt: "2025-01-01" },
    { url: "https://other.com", title: "T3" },
  ], "url");
  assert.equal(merged.length, 2);
  assert.equal(merged[0].title, "T1");
  assert.equal(merged[0].snippet, "S2");
  assert.equal(merged[0].publishedAt, "2025-01-01");
  // input not mutated
});

test("dedupeSources url+title: collapses same-story different-URL entries", () => {
  const merged = dedupeSources([
    { url: "https://a.com/news/x", title: "Node.js 24 发布：性能大幅提升" },
    { url: "https://b.com/mirror/x", title: "Node.js 24 发布 性能大幅提升" },
    { url: "https://c.com/other", title: "完全不同的话题报道" },
  ], "url+title");
  assert.equal(merged.length, 2);
  assert.equal(merged[0].url, "https://a.com/news/x");
  assert.equal(merged[1].url, "https://c.com/other");
});

test("dedupeSources url+title: keeps distinct titles even from same domain", () => {
  const merged = dedupeSources([
    { url: "https://a.com/1", title: "Rust async runtime deep dive" },
    { url: "https://a.com/2", title: "Python packaging guide" },
  ], "url+title");
  assert.equal(merged.length, 2);
});

test("dedupeSources: skips entries without usable url", () => {
  const merged = dedupeSources([{ title: "no url" }, null, { url: "", title: "empty" }, { url: "https://ok.com" }], "url");
  assert.equal(merged.length, 1);
  assert.equal(merged[0].url, "https://ok.com");
});

test("rerankSources: query-term overlap orders results deterministically", () => {
  const sources = [
    { url: "https://weak.com", title: "Random news today", snippet: "stuff" },
    { url: "https://strong.com/rust", title: "Rust tokio guide", snippet: "async rust runtime patterns" },
    { url: "https://mid.com", title: "Some Rust mentions", snippet: "misc" },
  ];
  const out = rerankSources(sources, "rust tokio async runtime");
  assert.equal(out[0].url, "https://strong.com/rust");
  // mid.com mentions rust once (title x3) vs weak.com zero
  assert.equal(out[1].url, "https://mid.com");
  // original array untouched
  assert.equal(sources[0].url, "https://weak.com");
});

test("rerankSources: stable tie-break keeps fan-out priority order", () => {
  const sources = [
    { url: "https://first.com", title: "aaa" },
    { url: "https://second.com", title: "bbb" },
    { url: "https://third.com", title: "ccc" },
  ];
  const out = rerankSources(sources, "zzz"); // nobody matches
  assert.deepEqual(out.map((s) => s.url), ["https://first.com", "https://second.com", "https://third.com"]);
});

test("rerankSources: empty query returns copy unchanged", () => {
  const sources = [{ url: "https://a.com" }];
  const out = rerankSources(sources, "");
  assert.deepEqual(out, sources);
  assert.notEqual(out, sources);
});
