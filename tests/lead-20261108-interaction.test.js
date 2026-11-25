// tests/lead-20261108-interaction.test.js — behaviour regressions for the
// Bug 与官方化行为规范小组 (40-bug-interaction.md, task-19), applied by Lead.
// Run: node --test tests/lead-20261108-interaction.test.js
//
// The bundled client.js is a window.__ModuleLoader__ factory. Load it in a
// sandbox with stubbed react to reach the real controllers, then drive them
// with fake hosts. No live network, no credentials, no DSH runtime.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const HERE = new URL(".", import.meta.url);
const read = (p) => readFileSync(new URL(p, HERE), "utf8");

// The bundled client.js is a window.__ModuleLoader__ factory; these tests
// assert the applied fixes at source level. Behaviour-level reproductions
// (fake host, real controller instances) live in 40-bug-interaction.md §6.

// The blank-draft half of this regression now lives in client-behavior.test.js
// ("a blank key draft never stages"), which drives the real controller. What
// remains here is the save-time identity guard: it needs an in-flight edit to
// exercise, so it stays pinned at source level until that race is reproduced.
test("a saved key draft is dropped only when it was not re-edited", () => {
  const src = readFileSync(new URL("../lib/client.js", HERE), "utf8");
  assert.match(src, /if \(this\.stagedKeys\.get\(k\) === savedKeyRefs\.get\(k\)\) this\.stagedKeys\.delete\(k\)/);
});

test("save() keeps edits that arrive during in-flight writes", () => {
  const src = readFileSync(new URL("../lib/client.js", HERE), "utf8");
  assert.match(src, /const savedFieldRefs = new Map\(\)/);
  assert.match(src, /if \(this\.staged\.get\(f\) === savedFieldRefs\.get\(f\)\) this\.staged\.delete\(f\)/);
  assert.match(src, /if \(this\.stagedKeys\.get\(k\) === savedKeyRefs\.get\(k\)\) this\.stagedKeys\.delete\(k\)/);
  assert.match(src, /&& this\.staged\.size === 0 && this\.stagedKeys\.size === 0\) this\.savedAt = Date\.now\(\)/);
});

test("credential failure reasons are redacted to a stable code", () => {
  const src = readFileSync(new URL("../lib/client.js", HERE), "utf8");
  assert.match(src, /function safeFailureReason\(err\)/);
  assert.match(src, /return \/\^\[a-z\]\[a-z0-9\/_-\]\{0,60\}\$\/i\.test\(code\) \? code : "write rejected";/);
  assert.match(src, /this\.failedKeys\.set\(ref, safeFailureReason\(keyErr\)\)/);
  // The old verbatim rendering must be gone.
  assert.doesNotMatch(src, /String\(keyErr && keyErr\.message \? keyErr\.message : keyErr\)\.slice\(0, 140\)/);
});

// Covered behaviourally by client-behavior.test.js ("queued writes each read
// the revision at their own turn"): it fires two toggles together and asserts
// the two writes carry different revisions, which fails if the queue is
// bypassed. No source pin needed.

test("a failed toggle resyncs with the host and does not log raw errors", () => {
  const src = readFileSync(new URL("../lib/client.js", HERE), "utf8");
  assert.match(src, /if \(typeof this\.scope\.load === "function"\)/);
  assert.match(src, /try \{ await this\.scope\.load\(\); \} catch/);
  assert.match(src, /console\.warn\("websearch: toggle write failed", \{ conflict: this\.conflict \}\)/);
  assert.doesNotMatch(src, /console\.warn\([^)]*err\.message/);
});

test("settings bridge and provider share one namespace resolver", () => {
  const src = readFileSync(new URL("../lib/index.js", HERE), "utf8");
  const api = readFileSync(new URL("../lib/settings-api.js", HERE), "utf8");
  assert.match(src, /findPluginRow\(settings\.describe\(\)\)/);
  assert.match(api, /return findPluginRow\(descriptors\)/);
});

test("cache key includes result-affecting options", () => {
  const src = readFileSync(new URL("../lib/cache.js", HERE), "utf8");
  assert.match(src, /resultOptions/);
  assert.match(src, /o: shaped/);
  const prov = readFileSync(new URL("../lib/provider.js", HERE), "utf8");
  assert.match(prov, /cacheKeyFor\(\{[^}]*resultOptions/);
});

// M-3: a keyed TinyFish call must force a fresh MCP session; a keyless call
// must remain byte-identical to the stateless path.
test("M-3: keyed tinyfish forces a fresh session, keyless is unchanged", async () => {
  const { readFileSync } = await import("node:fs");
  const tf = readFileSync(new URL("../lib/backends/tinyfish.js", HERE), "utf8");
  assert.match(tf, /\{ skipInitialize: !keyed, forceFreshSession: keyed \}/);
  const mc = readFileSync(new URL("../lib/util/mcp-client.js", HERE), "utf8");
  assert.match(mc, /async function ensureSession\(url, signal, options = \{\}, extraHeaders = \{\}\)/);
  assert.match(mc, /!options\.forceFreshSession && cached/);
  assert.match(mc, /forceFreshSession: options\.forceFreshSession === true/);
  // 65 号 N4: the cache key must include the auth header, and handshake
  // requests must carry the same credential as tools/call.
  assert.match(mc, /sessionCacheKey\(url, extraHeaders\)/);
  assert.match(mc, /\.\.\.extraHeaders,/);
  // The sessionId line prefix is a hard assertion anchor in lead-20261106.
  assert.match(mc, /const sessionId = options\.skipInitialize \? undefined : await ensureSession\(/);
});

// M-1: stateless MCP endpoints take the single tools/call path. The
// sessionful (tinyfish keyed) path keeps id 2 so initialize cannot share an id.
test("M-1: exa/parallel/firecrawl skip initialize; call ids avoid initialize's", async () => {
  const { readFileSync } = await import("node:fs");
  for (const f of ["exa.js", "parallel.js", "firecrawl.js"]) {
    const src = readFileSync(new URL(`../lib/backends/${f}`, HERE), "utf8");
    assert.match(src, /skipInitialize: true/, `${f} must skip initialize`);
  }
  const mc = readFileSync(new URL("../lib/util/mcp-client.js", HERE), "utf8");
  // ids must avoid initialize's id=1 (see 65 号 N3 / sse.test.js).
  assert.match(mc, /id: options\.skipInitialize \? 2 : 3/);
  // tinyfish keyless still skips; keyed still uses the handshake + fresh session.
  const tf = readFileSync(new URL("../lib/backends/tinyfish.js", HERE), "utf8");
  assert.match(tf, /\{ skipInitialize: !keyed, forceFreshSession: keyed \}/);
});

// readErrors: READ failures are tracked separately from SAVE failures, with
// only a fixed code (no raw host message). The readFailed anchors stay intact.
test("readErrors: fixed-code read failures, distinct from failedKeys", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../lib/client.js", HERE), "utf8");
  assert.match(src, /this\.readErrors = new Map\(\)/);
  assert.match(src, /readErrors: \[\.\.\.this\.readErrors\]/);
  assert.match(src, /reason = "credential\/read-failed"/);
  assert.match(src, /this\.readErrors\.set\(ref, safeFailureReason\(\{ code: reason \}\)\)/);
  assert.match(src, /this\.readErrors\.delete\(ref\)/);
  // No raw error text is stored.
  assert.doesNotMatch(src, /readErrors\.set\(ref, String\(err/);
  // The four readFailed anchors required by lead-20261106 remain.
  for (const re of [/let readFailed = false;/, /readFailed = true;/, /if \(!readFailed && view === undefined && this\.connection/, /if \(!readFailed && view !== undefined\)/]) {
    assert.match(src, re);
  }
});

// R3: the ApiKeyEnv pattern must accept exactly what the official
// credentialRef() accepts; an over-strict pattern silently rejects valid
// user configuration (lowercase / underscore-leading refs are legal).
test("ApiKeyEnv pattern matches the official credentialRef grammar", async () => {
  const { credentialRef } = await import("@deepseek-ai/dsh-credentials");
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../lib/index.js", HERE), "utf8");
  assert.match(src, /pattern\(\/\^\[A-Za-z_\]\[A-Za-z0-9_\]\*\$\/\)/);
  for (const valid of ["TAVILY_API_KEY", "lower", "_private", "A"]) {
    assert.doesNotThrow(() => credentialRef(valid), `${valid} must be a legal ref`);
  }
  for (const invalid of ["my.key", "a:b", "OPENAI-KEY", ""]) {
    assert.throws(() => credentialRef(invalid), undefined, `${invalid} must be rejected`);
  }
});

// R3 D2: the staged-entry snapshot must be taken BEFORE the awaited host
// write. Taking it after would capture a concurrently typed edit and delete
// it as if saved (silent data loss + false "Saved").
test("save() snapshots staged entries before awaiting host writes", () => {
  const src = readFileSync(new URL("../lib/client.js", HERE), "utf8");
  // Exactly one snapshot write per loop, and it uses the loop variable `staged`.
  assert.equal((src.match(/savedFieldRefs\.set\(field, staged\)/g) ?? []).length, 1);
  assert.equal((src.match(/savedKeyRefs\.set\(ref, staged\)/g) ?? []).length, 1);
  // No snapshot may be recorded via a fresh map lookup after an await.
  assert.doesNotMatch(src, /savedFieldRefs\.set\(field, this\.staged\.get/);
  assert.doesNotMatch(src, /savedKeyRefs\.set\(ref, this\.stagedKeys\.get/);
  // The field-loop snapshot must appear before the first scope.set/unset.
  const snapshotAt = src.indexOf("savedFieldRefs.set(field, staged)");
  const firstAwait = src.indexOf("await this.scope.", snapshotAt);
  assert.ok(firstAwait > snapshotAt, "snapshot must precede the first awaited write");
});

// V3 D8: observability fields are additive and never expose credentials.
test("health and history expose cooldown classification without dropping old keys", async () => {
  const { buildHealthReport } = await import("../lib/health.js");
  const { toBackendObservability } = await import("../lib/history.js");
  const now = Date.now();
  const hm = new Map([["exa", {
    ok: false, at: now, ms: 5, error: "429", failCount: 1,
    cooledUntil: now + 30_000, rateLimited: true, keylessRejected: false,
  }]]);
  const report = buildHealthReport({
    resolveOptions: () => ({ enabledBackends: ["exa"], backends: { exa: { requiresKey: false } }, numResults: 3 }),
    backends: { exa: {} },
    getBackendHealth: () => hm,
  });
  const b = report.backends.find((x) => x.id === "exa");
  assert.equal(report.requestedMaxResults, 3);
  assert.equal(b.rateLimited, true);
  assert.equal(b.keylessRejected, false);
  assert.equal(typeof b.cooledUntilMs, "number");
  // Existing consumers keep their keys.
  for (const key of ["id", "enabled", "keyless", "optionalKey", "metered", "reachable", "lastOk", "lastError"]) {
    assert.ok(Object.hasOwn(b, key), key);
  }
  const obs = toBackendObservability(hm, now)[0];
  assert.equal(obs.rateLimited, true);
  assert.equal(typeof obs.cooledUntilMs, "number");
  assert.equal(obs.cooled, true);
  assert.ok(!JSON.stringify(obs).includes("apiKey"));
});

// 65 号 N4 (behavioural): a rotated credential must not reuse a session
// bound to the old key, and the initialize handshake must carry the same
// credential header as tools/call.
test("N4: session cache is keyed by credential; handshake carries the key", async () => {
  const http = await import("node:http");
  const { mcpCall } = await import("../lib/util/mcp-client.js");
  const seen = [];
  let sessionSeq = 0;
  const srv = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => body += c);
    req.on("end", () => {
      const parsed = (() => { try { return JSON.parse(body); } catch { return {}; } })();
      seen.push({ method: parsed.method, apiKey: req.headers["x-api-key"] ?? null, session: req.headers["mcp-session-id"] ?? null });
      if (parsed.method === "initialize") {
        sessionSeq += 1;
        res.writeHead(200, { "content-type": "application/json", "mcp-session-id": `s${sessionSeq}` });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18", serverInfo: { name: "x" } } }));
      } else if (parsed.method === "notifications/initialized") {
        res.writeHead(202); res.end();
      } else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: parsed.id ?? 3, result: { content: [{ type: "text", text: "ok" }] } }));
      }
    });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${srv.address().port}/mcp`;
  const call = (key) => mcpCall(url, "search", { q: "x" }, { "X-API-Key": key }, new AbortController().signal, { forceFreshSession: false });
  await call("KEY_A");
  await call("KEY_B");
  const inits = seen.filter((s) => s.method === "initialize");
  assert.equal(inits.length, 2, "a rotated key must force a fresh initialize");
  assert.equal(inits[0].apiKey, "KEY_A");
  assert.equal(inits[1].apiKey, "KEY_B");
  assert.equal(seen.find((s) => s.method === "notifications/initialized").apiKey, "KEY_A");
  srv.close();
});
