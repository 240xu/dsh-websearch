// tests/lead-20261107-p0.test.js — behavioural regression for review 31-b P0.
// Run: node --test tests/lead-20261107-p0.test.js
//
// P0 (independently found by TWO adversarial reviewers, 31 / 31-b):
//   firecrawl.js / tinyfish.js only read `options.apiKey` (a literal), but
//   resolveOptions() supplies an async `resolveApiKey()` closure instead. The
//   optional API key therefore NEVER reached either backend; TinyFish's keyed
//   branch (X-API-Key + full initialize/Mcp-Session-Id handshake) was
//   unreachable dead code, and Firecrawl could not raise its keyless quota.
// P1: both `*BaseURL` config fields were registered but never consumed —
//   the two backends hardcoded their endpoints, bypassing provider.js's
//   baseURL trust gate and the sidecar/proxy path.
//
// This test drives the REAL backends with a fake global fetch (proxy env
// cleared so egressFetch() takes the direct-fetch path), and asserts the
// outgoing request headers/URLs. No live network, no real credentials.

import { test } from "node:test";
import assert from "node:assert/strict";

const HERE = new URL(".", import.meta.url);

async function withFakeFetch(fn) {
  const saved = {};
  for (const k of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "NO_PROXY", "no_proxy"]) {
    saved[k] = process.env[k]; delete process.env[k];
  }
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), headers: init?.headers ?? {} });
    // Echo the request id like a JSON-RPC server; stateless calls use 2 and
    // sessionful ones 3, so a hardcoded id would be rejected by parseEnvelope.
    let reqId = 2;
    let method = "";
    try {
      const body = JSON.parse(String(init?.body ?? "{}"));
      reqId = body.id ?? 2;
      method = body.method ?? "";
    } catch { /* keep 2 */ }
    const inner = JSON.stringify({ success: true, data: { web: [{ url: "https://x.test", title: "X", description: "s" }] }, results: [] });
    const result = method === "initialize"
      ? { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "test" } }
      : { content: [{ type: "text", text: inner }] };
    const payload = String(url).includes("searx")
      ? { results: [] }
      : { jsonrpc: "2.0", id: reqId, result };
    return new Response(
      JSON.stringify(payload),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  try { return await fn(calls); }
  finally {
    globalThis.fetch = real;
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

const hooks = { recordRequest: () => {}, recordOutcome: () => {} };

test("P0: firecrawl consumes resolveApiKey() and honours baseURL", async () => {
  const { firecrawlBackend } = await import("../lib/backends/firecrawl.js");
  await withFakeFetch(async (calls) => {
    await firecrawlBackend.search(
      { query: "q", maxResults: 2 },
      undefined,
      { resolveApiKey: async () => "FC-TEST-KEY", baseURL: "https://fc.test/mcp" },
      hooks,
    );
    const fc = calls.filter((c) => c.url.includes("fc.test"));
    assert.ok(fc.length > 0, "must call the configured baseURL, not the hardcoded endpoint");
    assert.ok(fc.every((c) => !c.url.includes("mcp.firecrawl.dev")), "hardcoded endpoint must be gone");
    assert.ok(fc.some((c) => c.headers.Authorization === "Bearer FC-TEST-KEY"),
      "resolveApiKey() value must become the Bearer header (P0)");
  });
});

test("P0: tinyfish keyed branch becomes reachable (X-API-Key, no keyless header)", async () => {
  const { tinyfishBackend } = await import("../lib/backends/tinyfish.js");
  await withFakeFetch(async (calls) => {
    await tinyfishBackend.search(
      { query: "q", maxResults: 2 },
      undefined,
      { resolveApiKey: async () => "TF-TEST-KEY", baseURL: "https://tf.test/mcp" },
      hooks,
    );
    const tf = calls.filter((c) => c.url.includes("tf.test"));
    assert.ok(tf.length > 0, "must call the configured baseURL");
    assert.ok(tf.some((c) => c.headers["X-API-Key"] === "TF-TEST-KEY"),
      "resolveApiKey() value must become X-API-Key (keyed branch reachable)");
    assert.ok(tf.every((c) => c.headers["X-TinyFish-Access-Mode"] === undefined),
      "keyed requests must NOT send the keyless header");
  });
});

test("keyless fallback still works when no key resolves", async () => {
  const { tinyfishBackend } = await import("../lib/backends/tinyfish.js");
  await withFakeFetch(async (calls) => {
    await tinyfishBackend.search(
      { query: "q", maxResults: 2 },
      undefined,
      { resolveApiKey: async () => undefined, baseURL: "https://tf2.test/mcp" },
      hooks,
    );
    const tf = calls.filter((c) => c.url.includes("tf2.test"));
    assert.ok(tf.some((c) => c.headers["X-TinyFish-Access-Mode"] === "keyless"),
      "missing key must degrade to keyless");
    assert.ok(tf.every((c) => c.headers["X-API-Key"] === undefined));
  });
});

test("source-level: both backends read resolveApiKey and honour baseURL", async () => {
  const { readFileSync } = await import("node:fs");
  for (const f of ["firecrawl.js", "tinyfish.js"]) {
    const src = readFileSync(new URL(`../lib/backends/${f}`, HERE), "utf8");
    assert.match(src, /await options\.resolveApiKey\(\)/, `${f} must await resolveApiKey()`);
    assert.match(src, /options\.baseURL/, `${f} must honour baseURL`);
    assert.doesNotMatch(src, /const apiKey = typeof options\?\.apiKey === "string" \? options\.apiKey : "";\s*\n\s*const (extraHeaders|keyed)/,
      `${f} must not stop at the literal apiKey`);
  }
  const idx = readFileSync(new URL("../lib/index.js", HERE), "utf8");
  assert.match(idx, /findPluginRow\(settings\.describe\(\)\)/, "current() must use the shared namespace resolver");
  const ns = readFileSync(new URL("../lib/util/namespace.js", HERE), "utf8");
  assert.match(ns, /const PROFILE_ID = "dsh-websearch";/, "shared resolver must declare the live profile id");
});

test("SearXNG never sends a private API key to the default public instance", async () => {
  const { searxngBackend } = await import("../lib/backends/searxng.js");
  await withFakeFetch(async (calls) => {
    await searxngBackend.search(
      { query: "q" },
      undefined,
      { baseURL: "https://searx.be", resolveApiKey: async () => "PRIVATE-SEARX-KEY" },
      hooks,
    );
    const sx = calls.filter((c) => c.url.includes("searx.be"));
    assert.ok(sx.length > 0);
    assert.ok(sx.every((c) => c.headers.Authorization === undefined),
      "the public fallback must not receive the private-instance key");
  });
});
