// tests/perplexity.test.js — Perplexity Search API backend.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { perplexityBackend, parsePerplexityResult } from "../lib/backends/perplexity.js";

let original;
afterEach(() => { if (original) globalThis.fetch = original; });

test("Perplexity sends the documented request shape and maps filters", async () => {
  original = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url: String(url), init, body: JSON.parse(init.body) };
    return { ok: true, status: 200, body: null, json: async () => ({ results: [
      { title: "A", url: "https://a.example/1", snippet: "s", date: "2024-01-02" },
    ] }) };
  };
  const sources = await perplexityBackend.search(
    { query: "q", maxResults: 8, filters: { recency: "week", lang: "zh-CN" } },
    new AbortController().signal,
    { baseURL: "https://api.perplexity.ai/search", includeDomains: ["a.example"], excludeDomains: ["b.example"], resolveApiKey: async () => "secret" },
    {},
  );
  assert.equal(captured.url, "https://api.perplexity.ai/search");
  assert.equal(captured.init.headers.Authorization, "Bearer secret");
  assert.deepEqual(captured.body, {
    query: "q", max_results: 8, search_type: "web",
    search_recency_filter: "week", search_language_filter: ["zh"],
    search_domain_filter: ["a.example", "-b.example"],
  });
  assert.deepEqual(sources.sources, [{ url: "https://a.example/1", title: "A", snippet: "s", publishedAt: "2024-01-02" }]);
});

test("Perplexity parser drops non-http URLs and caps the count", () => {
  const sources = parsePerplexityResult({ results: [
    { url: "javascript:alert(1)", title: "bad" },
    { url: "https://a.example", title: "A", snippet: "x" },
    { url: "https://b.example" },
  ] }, 1);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].url, "https://a.example");
});

test("Perplexity requires a key before issuing a request", async () => {
  await assert.rejects(
    perplexityBackend.search({ query: "q", maxResults: 3 }, new AbortController().signal, { resolveApiKey: async () => undefined }, {}),
    /API key not configured/,
  );
});
