// tests/provider.test.js — UnifiedSearchProvider fan-out behavior.
// Mocks globalThis.fetch to return canned multi-backend responses and verifies
// the provider's merge / abort-demotion / all-fail semantics.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { createUnifiedSearchProvider } from "../lib/provider.js";
import { exaBackend } from "../lib/backends/exa.js";
import { parallelBackend } from "../lib/backends/parallel.js";
import { ddgBackend } from "../lib/backends/ddg.js";

// Minimal WebError stub so we don't need the real @deepseek-ai/dsh-web dep.
// The provider import chain pulls in WebError — but since our backends use the
// real one, we DON'T stub it. We rely on the installed @deepseek-ai/dsh-node_modules
// resolution. If @deepseek-ai/dsh-web is resolvable from this test dir, it uses it.

let _origFetch;
let fetchCalls = [];

function mockFetch(handler) {
  _origFetch = globalThis.fetch;
  fetchCalls = [];
  globalThis.fetch = async (url, init) => {
    fetchCalls.push({ url, init });
    return handler(url, init);
  };
}

function restoreFetch() {
  if (_origFetch) globalThis.fetch = _origFetch;
}

function jres(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) { return name === "Mcp-Session-Id" ? "test-sess-id-1" : null; },
    },
    text: async () => body,
    json: async () => {
      try { return JSON.parse(body); } catch { throw new Error("not json"); }
    },
  };
}

const backends = { exa: exaBackend, parallel: parallelBackend, ddg: ddgBackend };

function makeProvider(enabled, ctxStub = {}) {
  let opts = {
    enabledBackends: enabled,
    numResults: 8,
    backends: {},
    ctx: ctxStub,
  };
  const resolveOptions = () => opts;
  const provider = createUnifiedSearchProvider({
    ctx: ctxStub,
    resolveOptions,
    backends,
  });
  return { provider, setOpts: (o) => { opts = { ...opts, ...o }; } };
}

afterEach(restoreFetch);

test("provider.available() = true when a keyless backend is enabled", () => {
  const { provider } = makeProvider(["exa", "parallel"]);
  assert.ok(provider.available(), "keyless exa+parallel should make the provider available");
});

test("provider: merges exa + parallel results, dedupes by url", async () => {
  // exa returns a text-form payload; parallel returns JSON-string text.
  const exaText = [
    "Title: Common",
    "URL: https://shared.com",
    "Highlights:",
    "  - exa snippet",
  ].join("\n");
  // JSON inner for parallel including a duplicate URL + one unique one.
  const parallelInner = JSON.stringify({
    results: [
      { url: "https://shared.com", title: "Shared", excerpts: [] }, // dup
      { url: "https://unique-p.com", title: "P-Uniq", excerpts: ["ps"] },
    ],
  });
  mockFetch((url) => {
    if (url.includes("mcp.exa.ai")) {
      // Exa RPC returns SSE/plain JSON wrapping {result:{content:[{text}]}}
      return jres(JSON.stringify({ result: { content: [{ text: exaText }] } }));
    }
    if (url.includes("search.parallel.ai")) {
      return jres(JSON.stringify({ result: { content: [{ text: parallelInner }] } }));
    }
    return jres("", 404);
  });

  const { provider } = makeProvider(["exa", "parallel"]);
  const result = await provider.search({ query: "q", maxResults: 8 });
  assert.equal(result.sources.length, 2); // shared + unique-p
  assert.ok(result.sources.some((s) => s.url === "https://shared.com"));
  assert.ok(result.sources.some((s) => s.url === "https://unique-p.com"));
});

test("provider: single backend abort → soft null, other succeeds", async () => {
  // Make exa abort and parallel succeed. We don't actually fire AbortSignal —
  // we make exa throw an AbortError-like DOMException via fetch failure.
  // Simpler: stub exaBackend.search to reject with a WebError WEB_ABORTED.
  const abortErr = new (class extends Error {})();
  abortErr.code = "WEB_ABORTED";
  abortErr.name = "WebError";
  const exaStub = { id: "exa", requiresCredential: false, available: () => true, search: async () => { throw abortErr; } };
  const parallelInner = JSON.stringify({ results: [{ url: "https://p.com", title: "P", excerpts: ["s"] }] });

  mockFetch((url) => {
    if (url.includes("search.parallel.ai")) {
      return jres(JSON.stringify({ result: { content: [{ text: parallelInner }] } }));
    }
    return jres("", 404);
  });

  const { provider } = makeProvider(["exa", "parallel"]);
  // patch backends map
  const providerStub = createUnifiedSearchProvider({
    ctx: {},
    resolveOptions: () => ({ enabledBackends: ["exa", "parallel"], numResults: 8, backends: {}, ctx: {} }),
    backends: { exa: exaStub, parallel: parallelBackend },
  });
  const result = await providerStub.search({ query: "q", maxResults: 8 });
  assert.equal(result.sources.length, 1); // exa null, parallel 1 source
});

test("provider: all backends fail → WEB_PROVIDER_ERROR", async () => {
  // Both HTTP 500 → both throw WEB_PROVIDER_ERROR → provider rethrows.
  mockFetch(() => jres("server error", 500));

  const { provider } = makeProvider(["exa", "parallel"]);
  await assert.rejects(
    provider.search({ query: "q", maxResults: 8 }),
    (err) => /all enabled backends failed/.test(err.message) && err.code === "WEB_PROVIDER_ERROR",
  );
});

test("provider: respects maxResults cap on merged output", async () => {
  const exaText = Array.from({ length: 5 }, (_, i) =>
    ["Title: T" + i, "URL: https://exa-" + i + ".com", "Highlights:", "  - s" + i].join("\n")
  ).join("\n\n---\n\n");
  const parallelInner = JSON.stringify({
    results: Array.from({ length: 5 }, (_, i) => ({
      url: "https://p-" + i + ".com",
      title: "P" + i,
      excerpts: [],
    })),
  });
  mockFetch((url) => {
    if (url.includes("mcp.exa.ai")) return jres(JSON.stringify({ result: { content: [{ text: exaText }] } }));
    if (url.includes("search.parallel.ai")) return jres(JSON.stringify({ result: { content: [{ text: parallelInner }] } }));
    return jres("", 404);
  });

  const { provider } = makeProvider(["exa", "parallel"]);
  const result = await provider.search({ query: "q", maxResults: 5 });
  assert.ok(result.sources.length <= 5, "should cap at maxResults=5");
});

test("provider: propagates backend content (e.g. Tavily answer) into result.content", async () => {
  const contentBackend = {
    id: "answery",
    requiresCredential: false,
    available: () => true,
    async search() {
      return { sources: [{ url: "https://a.com", title: "A" }], content: "AI summary of the query" };
    },
  };
  const plainBackend = {
    id: "plain",
    requiresCredential: false,
    available: () => true,
    async search() {
      return { sources: [{ url: "https://b.com", title: "B" }] };
    },
  };

  const provider = createUnifiedSearchProvider({
    ctx: {},
    resolveOptions: () => ({ enabledBackends: ["answery", "plain"], numResults: 5, backends: {} }),
    backends: { answery: contentBackend, plain: plainBackend },
  });
  const r = await provider.search({ query: "q" });
  // telemetry line (default on) appends after the propagated answer
  assert.ok(r.content.startsWith("AI summary of the query\n\n[websearch backends] "));
  assert.equal(r.sources.length, 2);
});
