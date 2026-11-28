// tests/settings-api.test.js — fenced settings bridge: op validation, batch bounds,
// and optimistic-revision conflicts. Fixtures only: no live host, network, or credentials.
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerSettingsRoutes } from "../lib/settings-api.js";

const DICT = {
  numResults: (v) => { if (!Number.isInteger(v)) throw new Error("int"); return v; },
  enableExa: (v) => Boolean(v),
};
const ROW = [{
  ns: "dsh-websearch",
  value: { numResults: 8, enableExa: true },
  base: {}, user: {}, revision: 7, applies: "live",
}];

function harness({ mutate = async () => ({}), configDict = DICT } = {}) {
  let handler;
  const calls = [];
  registerSettingsRoutes({ register: (r) => { handler = r.handler; } }, {
    // trust.js:91-96 — an admit() returning no rejection lets the request through.
    getConnection: () => ({ admit: () => ({}) }),
    getSettings: () => ({
      describe: () => ROW,
      mutate: async (...args) => { calls.push(args); return mutate(...args); },
    }),
    getConfig: () => ({ dict: configDict }),
  });

  const req = (body, { contentType = "application/json" } = {}) => {
    const listeners = {};
    return {
      method: "POST", url: "/api/unified-search/settings",
      headers: { host: "127.0.0.1:3080", "content-type": contentType },
      on(event, fn) { (listeners[event] ??= []).push(fn); return this; },
      removeAllListeners(event) {
        if (event) delete listeners[event];
        else for (const key of Object.keys(listeners)) delete listeners[key];
        return this;
      },
      emit() {
        const chunk = Buffer.from(JSON.stringify(body));
        for (const fn of listeners.data ?? []) fn(chunk);
        for (const fn of listeners.end ?? []) fn();
      },
    };
  };
  const res = () => ({
    writableEnded: false, code: 0, payload: null,
    writeHead(code) { this.code = code; return this; },
    setHeader() { return this; },
    end(text) {
      try { this.payload = JSON.parse(text); } catch { this.payload = text; }
      this.writableEnded = true;
      return this;
    },
  });
  return { handler, calls, req, res };
}

async function call(h, body, opts) {
  const rq = h.req(body, opts);
  const rs = h.res();
  h.handler(rq, rs);
  // guarded() defers the handler by a microtask; readBody() attaches listeners there.
  await new Promise(setImmediate);
  rq.emit();
  for (let i = 0; i < 50 && !rs.writableEnded; i++) await new Promise(setImmediate);
  return rs;
}

// ① validateOp rejects: illegal op / path length / __proto__ bypass / missing value / type
for (const [name, ops, expected] of [
  ["bad op",           [{ op: "delete", path: ["enableExa"] }],          /unsupported op/],
  ["path length 2",    [{ op: "set", path: ["a", "b"], value: 1 }],      /one-element/],
  ["path non-string",  [{ op: "set", path: [1], value: 1 }],             /one-element/],
  ["unknown field",    [{ op: "set", path: ["evil"], value: 1 }],        /unknown settings field/],
  ["proto field",      [{ op: "set", path: ["__proto__"], value: 1 }],   /unknown settings field/],
  ["missing value",    [{ op: "set", path: ["numResults"] }],            /requires a value/],
  ["type mismatch",    [{ op: "set", path: ["numResults"], value: "x" }],/invalid value/],
]) {
  test(`validateOp rejects: ${name}`, async () => {
    const h = harness();
    const r = await call(h, { ops, expectedRevision: 7 });
    assert.equal(r.code, 400);
    assert.match(String(r.payload.error), expected);
    assert.equal(h.calls.length, 0, "invalid ops must not reach mutate");
  });
}

// ② MAX_OPS boundaries: 64 accepted, 65 and 0 rejected
test("MAX_OPS: 64 ok, 65 rejected, 0 rejected", async () => {
  const ok = Array.from({ length: 64 }, () => ({ op: "unset", path: ["enableExa"] }));
  const h1 = harness();
  const r1 = await call(h1, { ops: ok, expectedRevision: 7 });
  assert.equal(r1.code, 200);
  for (const n of [65, 0]) {
    const h = harness();
    const r = await call(h, {
      ops: Array.from({ length: n }, () => ({ op: "unset", path: ["enableExa"] })),
      expectedRevision: 7,
    });
    assert.equal(r.code, 400);
    assert.match(r.payload.error, /at most 64|non-empty/);
  }
});

// ③ concurrent writes with the same expectedRevision -> second gets 409
test("expectedRevision conflict -> 409 SETTINGS_CONFLICT", async () => {
  let n = 0;
  const h = harness({
    mutate: async () => {
      if (++n > 1) throw Object.assign(new Error("changed"), { code: "SETTINGS_CONFLICT" });
    },
  });
  const body = { ops: [{ op: "set", path: ["numResults"], value: 9 }], expectedRevision: 7 };
  const r1 = await call(h, body);
  const r2 = await call(h, body);
  assert.equal(r1.code, 200);
  assert.equal(r2.code, 409);
  assert.equal(r2.payload.code, "SETTINGS_CONFLICT");
});

// ④ non-integer expectedRevision is rejected instead of silently disabling CAS
test("non-integer expectedRevision -> 400 and mutate is not called", async () => {
  const h = harness();
  const r = await call(h, { ops: [{ op: "unset", path: ["enableExa"] }], expectedRevision: "7" });
  assert.equal(r.code, 400);
  assert.equal(h.calls.length, 0);
});

// ⑤ non-conflict mutate failure -> 400 (not swallowed as success)
test("non-conflict mutate error -> 400", async () => {
  const h = harness({ mutate: async () => { throw new Error("disk full"); } });
  const r = await call(h, { ops: [{ op: "unset", path: ["enableExa"] }], expectedRevision: 7 });
  assert.equal(r.code, 400);
  assert.match(r.payload.error, /disk full/);
});

// ⑥ a legal op reaches mutate with the schema-checked value and integer revision
test("legal set reaches mutate with checked value", async () => {
  const h = harness();
  const r = await call(h, { ops: [{ op: "set", path: ["numResults"], value: 9 }], expectedRevision: 7 });
  assert.equal(r.code, 200);
  assert.deepEqual(h.calls[0][1], [{ op: "set", path: ["numResults"], value: 9 }]);
  assert.equal(h.calls[0][2], 7);
});

// A registry's register() returns the disposer. Route registration must
// hand those disposers back so the plugin's effect can unregister on reload.
test("route registration returns disposers that remove every route", async () => {
  const { registerSettingsRoutes } = await import("../lib/settings-api.js");
  const { registerHealthRoute } = await import("../lib/health.js");
  const { registerHistoryRoutes } = await import("../lib/history.js");
  const routes = new Map();
  const ws = { register(route) { routes.set(route.path, route); return () => routes.delete(route.path); } };
  const noop = () => undefined;
  const ds = [
    ...registerSettingsRoutes(ws, { getSettings: () => null, getConfig: () => ({}), getConnection: noop }),
    ...registerHealthRoute(ws, { resolveOptions: () => ({}), backends: {}, getBackendHealth: () => new Map(), getConnection: noop }),
    ...registerHistoryRoutes(ws, { getStore: () => null, getBackendHealth: () => new Map(), getConnection: noop }),
  ];
  assert.equal(ds.length, 4, "one disposer per registered route");
  assert.ok(routes.size === 4);
  ds.forEach((d) => d());
  assert.equal(routes.size, 0, "all routes must be removable");
});

// V3 D6: a stale revision must not be disguised as a field-validation error.
// When the op is invalid AND the caller's revision is stale, report the
// actionable concurrency conflict first.
test("stale revision + invalid op reports SETTINGS_CONFLICT, not a field error", async () => {
  const h = harness();
  const rs = await call(h, {
    ops: [{ op: "set", path: ["numResults"], value: 1.5 }],
    expectedRevision: 0,
  });
  assert.equal(rs.code, 409);
  assert.equal(rs.payload.code, "SETTINGS_CONFLICT");
  assert.equal(h.calls.length, 0, "mutate must not run on a conflict");
});

test("current revision + invalid op still reports the field error", async () => {
  const h = harness();
  const rs = await call(h, {
    ops: [{ op: "set", path: ["numResults"], value: 1.5 }],
    expectedRevision: 7,
  });
  assert.equal(rs.code, 400);
  assert.notEqual(rs.payload.code, "SETTINGS_CONFLICT");
});

// V3 D6 (complete): a stale revision is reported even when the op is valid.
test("stale revision + valid op still reports SETTINGS_CONFLICT", async () => {
  const h = harness();
  const rs = await call(h, {
    ops: [{ op: "set", path: ["numResults"], value: 7 }],
    expectedRevision: 0,
  });
  assert.equal(rs.code, 409);
  assert.equal(rs.payload.code, "SETTINGS_CONFLICT");
  assert.equal(h.calls.length, 0);
});

// G2 P1: write() must stay in the guarded promise chain so a thrown error
// produces a 500 response rather than an unhandled rejection with no reply.
test("a write() failure is caught by guarded and returns a response", async () => {
  const h = harness({ mutate: async () => { throw new Error("host broke"); } });
  const rs = await call(h, {
    ops: [{ op: "set", path: ["numResults"], value: 7 }],
    expectedRevision: 7,
  });
  assert.ok(rs.writableEnded, "the client must receive a response");
  assert.ok(rs.code >= 400);
});

// 65 号 N1: an oversized body must produce an actionable 413, not
// ECONNRESET. Destroying the request socket prevented the 413 from being
// written; draining with req.resume() keeps the response reachable.
test("oversized settings POST returns 413, not ECONNRESET", async () => {
  const http = await import("node:http");
  const { registerSettingsRoutes } = await import("../lib/settings-api.js");
  let handler;
  registerSettingsRoutes({ register: (r) => { handler = r.handler; } }, {
    getConnection: () => ({ admit: () => ({}) }),
    getSettings: () => ({ describe: () => [{ ns: "dsh-websearch", value: {}, base: {}, user: {}, revision: 1, applies: "live" }], mutate: async () => ({}) }),
    getConfig: () => ({ dict: {} }),
  });
  const srv = http.createServer(handler);
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const port = srv.address().port;
  const body = JSON.stringify({ ops: [], pad: "x".repeat(70_000) });
  const res = await new Promise((resolve) => {
    const req = http.request({
      host: "127.0.0.1", port, method: "POST", path: "/api/unified-search/settings",
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body), host: "127.0.0.1" },
    }, (r) => { let d = ""; r.on("data", (c) => d += c); r.on("end", () => resolve({ status: r.statusCode, body: d })); });
    req.on("error", (e) => resolve({ status: "ERR", body: e.code || e.message }));
    req.end(body);
  });
  assert.equal(res.status, 413, "expected an actionable 413, got " + String(res.body).slice(0, 60));
  assert.match(String(res.body), /request body too large/);
  srv.close();
});

// 65 号 A.6 / E1: a duplicate route mid-registration must not leak the
// routes already acquired. Roll them back before rethrowing so a later
// reload can register the full set again.
test("partial route registration rolls back on a duplicate route", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../lib/index.js", import.meta.url), "utf8");
  assert.match(src, /for \(const register of registers\) disposers\.push\(\.\.\.register\(\)\)/);
  assert.match(src, /for \(const dispose of disposers\.reverse\(\)\)/);
  assert.match(src, /throw err;/);
  // Behavioural: simulate the third register failing after two succeeded.
  const table = new Map();
  const ws = {
    register(route) {
      if (table.has(route.path)) throw new Error("duplicate route " + route.path);
      table.set(route.path, route);
      return () => table.delete(route.path);
    },
  };
  const { registerHealthRoute } = await import("../lib/health.js");
  const { registerHistoryRoutes } = await import("../lib/history.js");
  const { registerSettingsRoutes } = await import("../lib/settings-api.js");
  const noop = () => undefined;
  const disposers = [];
  const registers = [
    () => registerHealthRoute(ws, { resolveOptions: () => ({}), backends: {}, getBackendHealth: () => new Map(), getConnection: noop }),
    () => registerHistoryRoutes(ws, { getStore: () => null, getBackendHealth: () => new Map(), getConnection: noop }),
    () => { table.set("/api/unified-search/settings", {}); throw new Error("duplicate route /api/unified-search/settings"); },
    () => registerSettingsRoutes(ws, { getSettings: () => null, getConfig: () => ({}), getConnection: noop }),
  ];
  try {
    for (const register of registers) disposers.push(...register());
    assert.fail("expected a duplicate-route error");
  } catch (err) {
    for (const dispose of disposers.reverse()) dispose();
  }
  assert.equal(table.size, 1, "only the foreign pre-occupied route may remain");
  assert.ok(table.has("/api/unified-search/settings"));
});
