// tests/lead-20261107.test.js — regression for the "saving a setting does
// nothing" bug (upstream PR #7) + the RFC1918 baseURL trust gate.
// Run: node --test tests/lead-20261107.test.js
//
// Added 2026-11-07 by lead. Pure fixtures: fake Context, fake settings
// service, fake fetch. No live network, no credentials, no DSH runtime.
//
// Background: on DSH 0.2.x `apply(ctx, config)` receives only schema defaults;
// the live values live in the settings service's effective config. The old
// `current = () => config` never read them, so a toggle saved from the UI was
// a no-op. This pins the fix from PR #7 that we applied locally.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HERE = new URL(".", import.meta.url);

test("apply() resolves live settings-service values, not stale initial config", async () => {
  process.env.DSH_HOME = mkdtempSync(join(tmpdir(), "lead-settings-"));
  // egressFetch() honours proxy env; clear it so the fake fetch is what the
  // provider actually calls (otherwise the request goes to the proxy).
  const savedProxy = {};
  for (const k of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "NO_PROXY", "no_proxy"]) {
    savedProxy[k] = process.env[k]; delete process.env[k];
  }

  const { apply } = await import("../lib/index.js");
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    seen.push(String(url));
    return new Response(JSON.stringify({ results: [] }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  };

  // The settings service holds a private searxng instance + safeSearch=false.
  const settings = {
    describe: () => [{ ns: "unified-search", value: { searxngBaseURL: "http://192.168.1.100:8385", safeSearch: false, enableSearxng: true }, base: {}, user: {} }],
    mutate: async () => {},
  };
  let provider;
  const ctx = {
    get: () => undefined,
    inject: (deps, cb) => { if (deps.includes("settings")) cb({ settings }); },
    logger: { info() {}, warn() {}, debug() {}, error() {} },
    web: { registerSearchProvider: (p) => { provider = p; } },
  };

  try {
    // Empty config mimics what a DSH 0.2.x entry actually hands to apply().
    apply(ctx, {});
    assert.ok(provider, "provider must register");
    await provider.search({ query: "settings bridge", maxResults: 1 }, new AbortController().signal).catch(() => {});
    const hits = seen.filter((u) => u.startsWith("http://192.168.1.100:8385"));
    assert.equal(hits.length, 1, `searxng must use the settings-service baseURL, got ${JSON.stringify(seen)}`);
    assert.ok(!hits[0].includes("searx.be"), "must not fall back to the public instance");
    assert.ok(hits[0].includes("safesearch=0"), "safeSearch=false from the settings service must apply");
  } finally {
    globalThis.fetch = realFetch;
    for (const [k, v] of Object.entries(savedProxy)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

// The regex lives inline in provider.js; extract it from the source instead
// of re-typing it here (a hard-coded copy would make this test tautological).
test("RFC1918 plain-http baseURL trust gate: regex extracted from provider.js", () => {
  const src = readFileSync(new URL("../lib/provider.js", HERE), "utf8");
  const m = src.match(/const privHost = bu \? (\/.*?\/)\.test\(bu\.hostname\)/);
  assert.ok(m, "privHost regex must be present in provider.js");
  const re = new RegExp(m[1].slice(1, -1));
  for (const host of ["localhost", "127.0.0.1", "10.1.2.3", "192.168.1.100", "192.168.0.105", "172.16.5.4", "172.31.255.254"]) {
    assert.equal(re.test(host), true, `${host} must be recognised as private`);
  }
  for (const host of ["8.8.8.8", "192.169.1.1", "172.32.0.1", "example.com", "searx.be", "192.168.1.1.evil.com"]) {
    assert.equal(re.test(host), false, `${host} must NOT be treated as private`);
  }
});

test("current() and the HTTP bridge share findPluginRow; no cross-namespace hijack", async () => {
  const { findPluginRow } = await import("../lib/util/namespace.js");
  const src = readFileSync(new URL("../lib/index.js", HERE), "utf8");
  const api = readFileSync(new URL("../lib/settings-api.js", HERE), "utf8");
  assert.match(src, /findPluginRow\(settings\.describe\(\)\)/);
  assert.match(api, /return findPluginRow\(descriptors\)/);

  const pluginRow = { ns: "dsh-websearch", value: { searxngBaseURL: "X", numResults: 8 } };
  const otherRow = { ns: "OTHER-PLUGIN", value: { numResults: 4, backendTimeoutMs: 1000 } };
  // A third-party row that appears FIRST must not be selected.
  assert.equal(findPluginRow([otherRow, pluginRow]), pluginRow);
  // Exact legacy id still works when the profile id is absent.
  assert.equal(findPluginRow([{ ns: "unified-search", value: {} }]).ns, "unified-search");
  // Shape fallback needs >= 2 plugin-specific fields, so a generic row is rejected.
  assert.equal(findPluginRow([otherRow]), undefined);
  assert.equal(findPluginRow("not-an-array"), undefined);
});

// Result-affecting settings must be part of the cache key; otherwise a
// settings change is masked by a hit within the 900s TTL.
test("cacheKeyFor: result-affecting settings produce distinct keys", async () => {
  const { cacheKeyFor } = await import("../lib/cache.js");
  const base = { query: "q", filters: {}, maxResults: 8, backends: ["exa"], mode: "x" };
  const a = cacheKeyFor({ ...base, resultOptions: { safeSearch: true, rerank: false, dedupStrategy: "url", searxngBaseURL: "https://a" } });
  const b = cacheKeyFor({ ...base, resultOptions: { safeSearch: false, rerank: true, dedupStrategy: "url+title", searxngBaseURL: "https://b" } });
  assert.notEqual(a, b, "different settings must not share a cache key");
  const c = cacheKeyFor({ ...base, resultOptions: { safeSearch: true, rerank: false, dedupStrategy: "url", searxngBaseURL: "https://a" } });
  assert.equal(a, c, "identical settings must be stable");
  // Functions / resolvers are excluded, so passing live opts cannot poison the key.
  const d = cacheKeyFor({ ...base, resultOptions: { safeSearch: true, rerank: false, dedupStrategy: "url", searxngBaseURL: "https://a", resolveApiKey: () => {} } });
  assert.equal(a, d);
});

// 65 号 N2 / E1: per-backend settings live under opts.backends[id], not as
// top-level opts keys. Drive the REAL provider with a real disk cache: two
// identical queries with different backend settings must NOT share a key.
test("N2: changing a backend's baseURL invalidates the cache", async () => {
  const { createUnifiedSearchProvider } = await import("../lib/provider.js");
  const { createSearchCache } = await import("../lib/cache.js");
  const os = await import("node:os");
  const path = await import("node:path");
  const fs = await import("node:fs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-n2-"));
  const cache = createSearchCache({ dir, ttlMs: 900_000, maxEntries: 10 });
  let calls = 0;
  const backend = {
    available: () => true,
    async search() {
      calls++;
      return [{ url: `https://example.com/${calls}`, title: "t", snippet: "s" }];
    },
  };
  const mkOpts = (baseURL) => ({
    enabledBackends: ["brave"],
    backends: { brave: { requiresKey: false, baseURL, model: "m1", searchDepth: "basic", safeSearch: true } },
    numResults: 8, filters: {}, safeSearch: true, rerank: false, dedupStrategy: "url",
    cacheEnabled: true, resultTelemetry: false, breakerEnabled: false,
    multiQueryEnabled: false, deepCoverage: false, backendTimeoutMs: 30000,
    language: "", recency: "any", resultHeader: false, historyEnabled: false,
  });
  let opts = mkOpts("https://a.example");
  const provider = createUnifiedSearchProvider({
    ctx: {}, resolveOptions: () => opts, backends: { brave: backend }, cache, history: undefined,
  });
  const req = { query: "same query", maxResults: 8 };
  await provider.search(req, new AbortController().signal);
  assert.equal(calls, 1);
  opts = mkOpts("https://b.example");
  await provider.search(req, new AbortController().signal);
  assert.equal(calls, 2, "a changed backend setting must not be served from the old cache key");
  fs.rmSync(dir, { recursive: true, force: true });
});

// #58327 lesson, made a local contract: every non-2xx HTTP failure must go
// through webErrorFromResponse so downstream routing sees status/code instead
// of parsing the message. Pin the 11 call sites across backends + mcp-client.
test("all non-2xx throws use webErrorFromResponse (structured error contract)", async () => {
  const { readFileSync } = await import("node:fs");
  const { globSync } = await import("node:fs");
  const path = await import("node:path");
  const HERE = new URL(".", import.meta.url);
  const root = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "lib");
  const files = [
    ...globSync(path.join(root, "backends", "*.js")),
    path.join(root, "util", "mcp-client.js"),
  ];
  let calls = 0;
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    calls += (src.match(/throw webErrorFromResponse\(/g) ?? []).length;
    // No backend may hand-write a generic WebError for an HTTP failure.
    assert.doesNotMatch(src, /throw new WebError\([^)]*WEB_PROVIDER_ERROR[^)]*HTTP/);
  }
  assert.equal(calls, 11, "expected 11 structured non-2xx throw sites");
});
