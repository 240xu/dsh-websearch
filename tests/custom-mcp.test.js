// tests/custom-mcp.test.js — config-declared MCP backends.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { normalizeCustomBackends, customSourcesFromResult, createCustomMcpBackend } from "../lib/custom/mcp.js";
import { resolveOptions } from "../lib/index.js";

const CTX = { get: () => undefined };
let original;
afterEach(() => { if (original) globalThis.fetch = original; });

test("custom MCP declarations reject unsafe or malformed endpoints", () => {
  const { defs, errors } = normalizeCustomBackends([
    { id: "team", label: "Team", endpoint: "http://mcp.example/x", tool: "search" },
    { id: "p1", label: "Private", endpoint: "https://127.0.0.1/mcp", tool: "search" },
    { id: "dup", label: "Dup", endpoint: "https://mcp.example/x", tool: "search" },
    { id: "dup", label: "Dup", endpoint: "https://mcp.example/y", tool: "search" },
    { id: "ok", label: "OK", endpoint: "https://mcp.example/x", tool: "search", enabled: true },
  ]);
  assert.equal(defs.length, 2);
  assert.deepEqual(defs.map((d) => d.id), ["dup", "ok"]);
  assert.ok(errors.some((e) => /HTTPS/.test(e)));
  assert.ok(errors.some((e) => /DNS hostname|private host/.test(e)));
  assert.ok(errors.some((e) => /duplicated/.test(e)));
});

test("custom result mapping handles structuredContent and dotted paths", () => {
  const sources = customSourcesFromResult({
    structuredContent: { data: { items: [
      { link: "https://a.example/1", name: "A", text: "s", date: "2024-01-02" },
      { link: "javascript:alert(1)", name: "bad" },
    ] } },
  }, {
    resultsPath: "data.items", urlField: "link", titleField: "name",
    snippetField: "text", dateField: "date",
  }, 5);
  assert.deepEqual(sources, [{ url: "https://a.example/1", title: "A", snippet: "s", publishedAt: "2024-01-02" }]);
});

test("custom backend calls the named MCP tool with a key and maps results", async () => {
  original = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url: String(url), init, body: JSON.parse(init.body) };
    return {
      ok: true, status: 200, body: null,
      text: async () => JSON.stringify({ jsonrpc: "2.0", id: 2, result: {
        structuredContent: { results: [{ url: "https://a.example/1", title: "A", snippet: "s" }] },
      } }),
    };
  };
  const backend = createCustomMcpBackend({
    id: "team", label: "Team", endpoint: "https://mcp.example/x", tool: "search",
    authRef: "TEAM_KEY", stateless: true, queryArg: "q", limitArg: "limit",
    resultsPath: "results", urlField: "url", titleField: "title",
    snippetField: "snippet", dateField: "date", timeoutMs: 5000,
  }, { resolveApiKey: async () => "secret" });
  assert.equal(backend.available(), true);
  const out = await backend.search({ query: "hello", maxResults: 3 }, new AbortController().signal, {}, {});
  assert.equal(captured.url, "https://mcp.example/x");
  assert.equal(captured.init.headers.Authorization, "Bearer secret");
  assert.deepEqual(captured.body.params.arguments, { q: "hello", limit: 3 });
  assert.equal(out.sources.length, 1);
});

test("resolveOptions enables and keys a custom backend", () => {
  const opts = resolveOptions(CTX, { customBackends: [{
    id: "team", label: "Team", endpoint: "https://mcp.example/x", tool: "search",
    enabled: true, authRef: "TEAM_KEY",
  }] });
  const id = "custom:team";
  assert.ok(opts.enabledBackends.includes(id));
  assert.ok(opts.backends[id]);
  assert.equal(opts.backendCacheKeyFields[id].endpoint, "https://mcp.example/x");
  assert.equal(opts.backendCacheKeyFields[id].tool, "search");
});
