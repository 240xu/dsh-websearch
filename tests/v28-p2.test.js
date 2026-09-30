// tests/v28-p2.test.js — v2.8.0 P2s: per-backend timeout ceilings + observability payload.
import { test } from "node:test";
import assert from "node:assert/strict";
import { effectiveBackendTimeoutMs } from "../lib/provider.js";
import { toBackendObservability, registerHistoryRoutes } from "../lib/history.js";

// 1. timeout ceilings: ddg/searxng capped at 5s, others untouched, operator's
//    shorter global timeout always wins.
{
  assert.equal(effectiveBackendTimeoutMs("ddg", 30000), 5000);
  assert.equal(effectiveBackendTimeoutMs("searxng", 30000), 5000);
  assert.equal(effectiveBackendTimeoutMs("exa", 30000), 30000, "no override -> global");
  assert.equal(effectiveBackendTimeoutMs("ddg", 3000), 3000, "shorter global wins");
  assert.equal(effectiveBackendTimeoutMs("brave", 8000), 8000);
}

// 2. hanging ddg: effective 5s timeout fires (real-clock, one slow test).
test("hanging ddg backend times out at 5s with the effective timeout in the message", async () => {
  const { createUnifiedSearchProvider } = await import("../lib/provider.js");
  // Honors abort like a real backend (the timeout aborts the merged signal).
  const hang = {
    available: () => true,
    search: (_req, sig) => new Promise((_resolve, reject) => {
      sig?.addEventListener("abort", () => reject(new Error("aborted")));
    }),
  };
  const provider = createUnifiedSearchProvider({
    ctx: {},
    resolveOptions: () => ({ enabledBackends: ["ddg"], numResults: 4, backends: {}, ctx: {}, backendTimeoutMs: 30000 }),
    backends: { ddg: hang },
  });
  const started = Date.now();
  await assert.rejects(
    provider.search({ query: "hang probe", maxResults: 4 }, undefined),
    (err) => err.code === "WEB_PROVIDER_ERROR" && /timed out after 5000ms/.test(err.message),
  );
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 4900 && elapsed < 7000, "fired at ~5s, got " + elapsed);
});

// 3. observability payload: shape + cooled projection, no error strings.
{
  const map = new Map([
    ["exa", { ok: true, at: 1000, ms: 350, count: 3, lastOkAt: 1000, failCount: 0, cooledUntil: 0 }],
    ["ddg", { ok: false, at: 2000, ms: 5000, error: "secret sk-abc", failCount: 3, cooledUntil: 9999999999999 }],
  ]);
  const obs = toBackendObservability(map, 3000);
  assert.equal(obs.length, 2);
  const exa = obs.find((o) => o.id === "exa");
  assert.deepEqual(exa, { id: "exa", ok: true, ms: 350, at: 1000, failCount: 0, cooled: false });
  const ddg = obs.find((o) => o.id === "ddg");
  assert.equal(ddg.ok, false);
  assert.equal(ddg.cooled, true);
  assert.equal(ddg.failCount, 3);
  assert.equal(JSON.stringify(obs).includes("sk-abc"), false, "no error strings in payload");
  assert.deepEqual(toBackendObservability(null), []);
}

// 4. history GET response carries the backends field (fence-safe request).
test("history route exposes backend observability", async () => {
  const registered = [];
  registerHistoryRoutes(
    { register: (r) => registered.push(r) },
    { getStore: () => null, getBackendHealth: () => new Map([["exa", { ok: true, at: 1, ms: 10 }]]) },
  );
  const route = registered.find((r) => r.path === "/api/websearch/history");
  let code = 0, body = "";
  route.handler(
    { method: "GET", headers: { host: "127.0.0.1:3080", "sec-fetch-site": "same-origin" } },
    { writeHead: (c) => { code = c; }, end: (b) => { body = b ?? ""; } },
  );
  const parsed = JSON.parse(body);
  assert.equal(code, 200);
  assert.equal(parsed.backends.length, 1);
  assert.equal(parsed.backends[0].id, "exa");
  assert.equal(parsed.backends[0].ok, true);
});
