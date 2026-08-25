// tests/v21.test.js — v2.1 behaviors: timeout classification, dedup strategies,
// deterministic rerank, settings-level filter injection, per-backend wiring.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import { createUnifiedSearchProvider } from "../lib/provider.js";
import { searxngBackend } from "../lib/backends/searxng.js";
import { mojeekBackend } from "../lib/backends/mojeek.js";
import { tavilyBackend } from "../lib/backends/tavily.js";
import { serperBackend } from "../lib/backends/serper.js";
import { braveBackend } from "../lib/backends/brave.js";
import { WebError } from "@deepseek-ai/dsh-web";

let _origFetch;
let calls = [];
function mockFetch(handler) {
  _origFetch = globalThis.fetch;
  calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(url, init);
  };
}
afterEach(() => { if (_origFetch) globalThis.fetch = _origFetch; });

function jsonRes(obj, status = 200) {
  const body = typeof obj === "string" ? obj : JSON.stringify(obj);
  return { ok: status >= 200 && status < 300, status, text: async () => body,
           json: async () => JSON.parse(body) };
}

function staticBackend(id, sources) {
  return {
    id,
    requiresCredential: false,
    available() { return true; },
    async search() { return { sources }; },
  };
}

function makeProvider(backendMap, extraOpts = {}) {
  let opts = {
    enabledBackends: Object.keys(backendMap),
    numResults: 8,
    concurrency: 6,
    backendTimeoutMs: 30000,
    backends: {},
    ctx: {},
    ...extraOpts,
  };
  const provider = createUnifiedSearchProvider({
    ctx: {},
    resolveOptions: () => opts,
    backends: backendMap,
  });
  return { provider, setOpts: (o) => { opts = { ...opts, ...o }; } };
}

// ---------- timeout classification ----------

test("internal backend timeout -> WEB_PROVIDER_ERROR naming the backend, not WEB_ABORTED", async () => {
  const hang = {
    id: "hang",
    requiresCredential: false,
    available() { return true; },
    search(req, signal) {
      return new Promise((_, reject) => {
        signal.addEventListener("abort", () =>
          reject(new WebError("unified search aborted", "WEB_ABORTED")));
      });
    },
  };
  const { provider } = makeProvider({ hang }, { backendTimeoutMs: 40 });
  await assert.rejects(
    provider.search({ query: "q", maxResults: 5 }),
    (err) => err instanceof WebError
      && err.code === "WEB_PROVIDER_ERROR"
      && /timed out after 40ms/.test(err.message)
      && /hang/.test(err.message),
  );
});

test("mixed timeout: healthy backend still serves results", async () => {
  const hang = {
    id: "hang",
    requiresCredential: false,
    available() { return true; },
    search(req, signal) {
      return new Promise((_, reject) => {
        signal.addEventListener("abort", () =>
          reject(new WebError("aborted", "WEB_ABORTED")));
      });
    },
  };
  const okBe = staticBackend("okbe", [{ url: "https://fine.example", title: "Fine" }]);
  const { provider } = makeProvider({ hang, okBe }, { backendTimeoutMs: 40 });
  const res = await provider.search({ query: "q", maxResults: 5 });
  assert.equal(res.sources.length, 1);
  assert.equal(res.sources[0].url, "https://fine.example");
});

// ---------- dedup strategies ----------

const STORY_A = { url: "https://a.example/news/x", title: "Node.js 24 发布 性能大幅提升" };
const MIRROR_A = { url: "https://b.example/mirror/x", title: "Node.js 24 发布：性能大幅提升", snippet: "mirror copy" };
const OTHER = { url: "https://c.example/other", title: "另一个话题" };

test("dedupStrategy default 'url' keeps same-story different-URL entries", async () => {
  const { provider } = makeProvider({
    one: staticBackend("one", [STORY_A]),
    two: staticBackend("two", [MIRROR_A, OTHER]),
  });
  const res = await provider.search({ query: "node", maxResults: 10 });
  assert.equal(res.sources.length, 3);
});

test("dedupStrategy 'url+title' collapses syndicated mirrors", async () => {
  const { provider } = makeProvider({
    one: staticBackend("one", [STORY_A]),
    two: staticBackend("two", [MIRROR_A, OTHER]),
  }, { dedupStrategy: "url+title" });
  const res = await provider.search({ query: "node", maxResults: 10 });
  assert.equal(res.sources.length, 2);
  assert.equal(res.sources[0].url, STORY_A.url); // higher-priority backend wins
  // fill-in: mirror's snippet enriches the kept entry
  assert.equal(res.sources[0].snippet, "mirror copy");
});

// ---------- rerank ----------

test("rerank=true orders by query relevance; ties keep fan-out priority", async () => {
  const weak = { url: "https://weak.example", title: "Random news today" };
  const strong = { url: "https://strong.example/rust-tokio", title: "Rust tokio guide", snippet: "async rust runtime" };
  const mid = { url: "https://mid.example", title: "Rust mentions only here" };
  const { provider } = makeProvider({
    one: staticBackend("one", [weak]),
    two: staticBackend("two", [strong]),
    three: staticBackend("three", [mid]),
  }, { rerank: true });
  const res = await provider.search({ query: "rust tokio async", maxResults: 10 });
  assert.deepEqual(res.sources.map((s) => s.url),
    [strong.url, mid.url, weak.url]);
});

// ---------- filters injection from settings defaults ----------

test("provider injects settings-level recency/lang into backend requests", async () => {
  mockFetch(() => jsonRes({ results: [{ url: "https://x.example", title: "X", content: "c" }] }));
  const { provider } = makeProvider(
    { searxng: searxngBackend },
    { filters: { recency: "week", lang: "zh-CN" },
      backends: { searxng: { baseURL: "https://searx.example", safeSearch: false } } },
  );
  await provider.search({ query: "q", maxResults: 5 });
  assert.equal(calls.length, 1);
  const u = new URL(calls[0].url);
  assert.equal(u.searchParams.get("time_range"), "week");
  assert.equal(u.searchParams.get("language"), "zh-CN");
  assert.equal(u.searchParams.get("safesearch"), "0"); // safeSearch:false honored
});

test("request-level filters override settings defaults", async () => {
  mockFetch(() => jsonRes({ results: [{ url: "https://y.example", title: "Y", content: "c" }] }));
  const { provider } = makeProvider(
    { searxng: searxngBackend },
    { filters: { recency: "week", lang: "en" },
      backends: { searxng: { baseURL: "https://searx.example" } } },
  );
  await provider.search({ query: "q", maxResults: 5, filters: { recency: "day", lang: "fr" } });
  const u = new URL(calls[0].url);
  assert.equal(u.searchParams.get("time_range"), "day");
  assert.equal(u.searchParams.get("language"), "fr");
});

// ---------- per-backend wiring ----------

const keyOpts = (base) => ({ baseURL: base, resolveApiKey: async () => "TESTKEY" });

test("mojeek: Authorization bearer header, no api_key in URL", async () => {
  mockFetch(() => jsonRes({ response: { results: [{ url: "https://m.example", title: "M" }] } }));
  await mojeekBackend.search({ query: "q", maxResults: 5 }, undefined, keyOpts("https://mojeek.example/v1/search"), {});
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers.Authorization, "Bearer TESTKEY");
  assert.ok(!calls[0].url.includes("api_key"));
});

test("tavily: filters.time_range lands in body next to search_depth", async () => {
  mockFetch(() => jsonRes({ results: [], answer: "ans" }));
  await tavilyBackend.search(
    { query: "q", maxResults: 5, filters: { recency: "month" } },
    undefined,
    { ...keyOpts("https://tavily.example/search"), searchDepth: "advanced" },
    {});
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.time_range, "month");
  assert.equal(body.search_depth, "advanced");
});

test("serper: Google tbs date syntax from filters.recency", async () => {
  mockFetch(() => jsonRes({ organic: [] }));
  await serperBackend.search({ query: "q", maxResults: 5, filters: { recency: "year" } },
    undefined, keyOpts("https://serper.example/search"), {});
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.tbs, "qdr:y");
});

test("brave: freshness param + safesearch off when configured", async () => {
  mockFetch(() => jsonRes({ web: { results: [] } }));
  await braveBackend.search(
    { query: "q", maxResults: 5, filters: { recency: "day" } },
    undefined,
    { ...keyOpts("https://brave.example/res/v1/web/search"), safeSearch: false },
    {});
  const u = new URL(calls[0].url);
  assert.equal(u.searchParams.get("freshness"), "pd");
  assert.equal(u.searchParams.get("safesearch"), "off");
});
