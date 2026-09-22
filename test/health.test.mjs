// health.test.mjs — plain node assert tests for the /api/unified-search/health
// mapping (no vitest infra in this repo; run: node test/health.test.mjs).
import assert from "node:assert/strict";
import { buildHealthReport, sanitizeError } from "../lib/health.js";

const fakeBackends = { ddg: {}, exa: {}, brave: {} };
// resolveOptions snapshot mirroring lib/index.js resolveOptions output shape.
const opts = (enabledBackends) => ({
  enabledBackends,
  backends: {
    ddg: { requiresKey: false },
    exa: { requiresKey: false },
    brave: { requiresKey: true },
  },
});

// 1. keyless detection: ddg/exa keyless, brave key-gated; counts only enabled.
{
  const r = buildHealthReport({
    resolveOptions: () => opts(["ddg", "brave"]),
    backends: fakeBackends,
    getBackendHealth: new Map(),
  });
  assert.equal(r.ok, true);
  assert.equal(r.enabled, 2);
  assert.equal(r.keyless, 1, "only ddg among enabled is keyless");
  const ddg = r.backends.find((b) => b.id === "ddg");
  const brave = r.backends.find((b) => b.id === "brave");
  const exa = r.backends.find((b) => b.id === "exa");
  assert.equal(ddg.keyless, true);
  assert.equal(brave.keyless, false);
  assert.equal(exa.enabled, false, "exa disabled but still listed");
  assert.equal(exa.reachable, null, "never probed -> null");
  assert.equal(exa.lastError, null);
  assert.equal(typeof r.updatedAt, "number");
}

// 2. unknown vs error vs ok from telemetry.
{
  const tel = new Map([
    ["ddg", { ok: false, at: 1000, ms: 30000, error: 'backend "ddg" timed out after 30000ms', lastOkAt: null }],
    ["exa", { ok: true, at: 2000, ms: 500, count: 3, lastOkAt: 2000 }],
    ["brave", { ok: false, at: 3000, ms: 120, error: "401 unauthorized: missing API key", lastOkAt: 900 }],
  ]);
  const r = buildHealthReport({
    resolveOptions: () => opts(["ddg", "exa", "brave"]),
    backends: fakeBackends,
    getBackendHealth: tel,
  });
  const ddg = r.backends.find((b) => b.id === "ddg");
  const exa = r.backends.find((b) => b.id === "exa");
  const brave = r.backends.find((b) => b.id === "brave");
  assert.equal(ddg.reachable, false);
  assert.equal(ddg.lastOk, null);
  assert.ok(ddg.lastError.includes("timed out"), "error surfaced");
  assert.equal(exa.reachable, true);
  assert.equal(exa.lastOk, 2000);
  assert.equal(exa.lastError, null);
  assert.equal(brave.reachable, false);
  assert.equal(brave.lastOk, 900, "lastOk preserved across a later failure");
  assert.equal(r.enabled, 3);
  assert.equal(r.keyless, 2);
}

// 3. no credentials ever echoed: token-like fragments redacted, length bound.
{
  assert.ok(!sanitizeError("Bearer abcdefghijklmnop").includes("abcdefghijklmnop"), "bearer token redacted");
  assert.ok(sanitizeError("sk-abcdefghijklmnop123456 failed").includes("[redacted]"));
  assert.ok(!sanitizeError("api_key=supersecretvalue123 error").includes("supersecretvalue123"));
  const long = "x".repeat(300);
  assert.ok(sanitizeError(long).length <= 120);
  const tel = new Map([
    ["ddg", { ok: false, at: 1, ms: 1, error: "boom sk-abcdefghijklmnop123456", lastOkAt: null }],
  ]);
  const r = buildHealthReport({
    resolveOptions: () => opts(["ddg"]),
    backends: fakeBackends,
    getBackendHealth: tel,
  });
  const payload = JSON.stringify(r);
  assert.ok(!payload.includes("sk-abcdefghijklmnop123456"), "no token in payload");
  const ddg = r.backends.find((b) => b.id === "ddg");
  assert.ok(ddg.lastError.length <= 120);
}

// 4. accepts a getter function as well as a Map.
{
  const r = buildHealthReport({
    resolveOptions: () => opts([]),
    backends: fakeBackends,
    getBackendHealth: () => new Map(),
  });
  assert.equal(r.enabled, 0);
  assert.equal(r.keyless, 0);
}

console.log("health.test.mjs: all 4 test groups passed");
