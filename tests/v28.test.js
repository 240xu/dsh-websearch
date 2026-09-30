// tests/v28.test.js — v2.8.0 provider integration: deepCoverage widening,
// multiQuery gating + RRF fusion, cache-mode separation.
import { test } from "node:test";
import assert from "node:assert/strict";

import { createUnifiedSearchProvider } from "../lib/provider.js";

function makeBackend(id, search) {
  const calls = [];
  return {
    id,
    calls,
    available: () => true,
    search: async (req) => {
      calls.push({ query: req.query, maxResults: req.maxResults, deepCoverage: req.deepCoverage });
      return search(req);
    },
  };
}

function makeProvider(backends, extraOpts = {}) {
  return createUnifiedSearchProvider({
    ctx: {},
    resolveOptions: () => ({
      enabledBackends: Object.keys(backends),
      numResults: 4,
      backends: {},
      ctx: {},
      ...extraOpts,
    }),
    backends,
  });
}

test("deepCoverage: per-backend maxResults widened 1.5x, final slice stays maxResults", async () => {
  const wide = makeBackend("wide", () => ({
    sources: Array.from({ length: 9 }, (_, i) => ({ url: `https://e/${i}` })),
  }));
  const provider = makeProvider({ wide }, { deepCoverage: true });
  const r = await provider.search({ query: "coverage probe", maxResults: 6 }, undefined);
  assert.equal(wide.calls[0].maxResults, 9, "ceil(6*1.5)=9 sent to backend");
  assert.equal(wide.calls[0].deepCoverage, true, "coverage flag on request");
  assert.equal(r.sources.length, 6, "final slice still maxResults");
  assert.equal(r.truncated, true);
});

test("deepCoverage off: request.maxResults unchanged and flag absent", async () => {
  const plain = makeBackend("plain", () => ({ sources: [{ url: "https://e/1" }] }));
  const provider = makeProvider({ plain });
  await provider.search({ query: "plain probe", maxResults: 6 }, undefined);
  assert.equal(plain.calls[0].maxResults, 6);
  assert.equal(plain.calls[0].deepCoverage, undefined);
});

test("multiQuery: complex query derives variants, backend sees variant queries, RRF promotes cross-list items", async () => {
  const be = makeBackend("m", (req) => ({
    sources: req.query === "react vs vue"
      ? [{ url: "https://e/common" }, { url: "https://e/a" }]
      : [{ url: "https://e/common" }, { url: "https://e/b" }],
  }));
  const provider = makeProvider({ be }, { multiQueryEnabled: true });
  const r = await provider.search({ query: "react vs vue", maxResults: 4 }, undefined);
  const queries = be.calls.map((c) => c.query);
  assert.ok(queries.includes("react vs vue"), "original variant searched");
  assert.ok(queries.includes("react") && queries.includes("vue"), "derived variants searched");
  // "common" appears in both variant lists -> RRF rank 1; promoted to top.
  assert.equal(r.sources[0].url, "https://e/common");
  assert.equal(r.sources.length, 3, "union of both variant lists (common deduped)");
});

test("multiQuery gate: simple query stays single-fanout even when enabled", async () => {
  const be = makeBackend("m", () => ({ sources: [{ url: "https://e/1" }] }));
  const provider = makeProvider({ be }, { multiQueryEnabled: true });
  await provider.search({ query: "short query", maxResults: 4 }, undefined);
  assert.equal(be.calls.length, 1, "one variant only");
  assert.equal(be.calls[0].query, "short query");
});

test("cache mode separation: multiQuery result never served to single mode", async () => {
  const dir = (await import("node:fs")).mkdtempSync((await import("node:path")).join((await import("node:os")).tmpdir(), "dsh-ws-v28-"));
  const { createSearchCache } = await import("../lib/cache.js");
  const cache = createSearchCache({ dir, ttlMs: 60_000, maxEntries: 10 });
  const be = makeBackend("m", (req) => ({
    sources: req.query === "a vs b"
      ? [{ url: "https://e/fused" }]
      : [{ url: "https://e/single" }],
  }));
  const provider = createUnifiedSearchProvider({
    ctx: {},
    resolveOptions: () => ({
      enabledBackends: ["m"], numResults: 4, backends: {}, ctx: {},
      cacheEnabled: true, multiQueryEnabled: true,
    }),
    backends: { m: be },
    cache,
  });
  await provider.search({ query: "react vs vue", maxResults: 4 }, undefined); // multi fan-out
  assert.equal(be.calls.length, 3);
  // same query, multiQuery now OFF (different mode) -> must NOT hit the multi cache
  const providerSingle = createUnifiedSearchProvider({
    ctx: {},
    resolveOptions: () => ({
      enabledBackends: ["m"], numResults: 4, backends: {}, ctx: {},
      cacheEnabled: true, multiQueryEnabled: false,
    }),
    backends: { m: be },
    cache,
  });
  const r2 = await providerSingle.search({ query: "react vs vue", maxResults: 4 }, undefined);
  assert.equal(be.calls.length, 4, "mode change forces a fresh fan-out");
  assert.equal(r2.sources[0].url, "https://e/single");
});

test("tavily backend: deepCoverage upgrades search_depth to advanced", async () => {
  const { tavilyBackend } = await import("../lib/backends/tavily.js");
  const bodies = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    const payload = JSON.stringify({ results: [{ title: "t", url: "https://t/1" }] });
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => payload, json: async () => JSON.parse(payload) };
  };
  try {
    await tavilyBackend.search(
      { query: "q", maxResults: 5, deepCoverage: true },
      undefined,
      { searchDepth: "basic", resolveApiKey: async () => "k" },
      {},
    );
  } finally {
    globalThis.fetch = origFetch;
  }
  assert.equal(bodies[0].search_depth, "advanced");
});
