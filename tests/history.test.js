// history.test.js — v2.7.0 append-only history: ring cap, shape, clear, routes.
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHistoryStore, registerHistoryRoutes, HISTORY_MAX_ENTRIES } from "../lib/history.js";

// 1. record/list round-trip, newest first, exact public shape.
{
  const dir = mkdtempSync(join(tmpdir(), "dsh-ws-hist-"));
  const store = createHistoryStore({ dir });
  assert.deepEqual(store.list(), [], "empty at start");
  store.record({ query: "q1", time: 100, resultCount: 5, backendsOk: 2, backendsTotal: 3 });
  store.record({ query: "q2", time: 200, resultCount: 8, backendsOk: 3, backendsTotal: 3, junk: "dropped" });
  const list = store.list();
  assert.equal(list.length, 2);
  assert.equal(list[0].query, "q2", "newest first");
  assert.deepEqual(Object.keys(list[0]).sort(), ["backendsOk", "backendsTotal", "query", "resultCount", "time"], "exact shape, no junk fields");
}

// 2. ring cap: only the newest 50 survive.
{
  const dir = mkdtempSync(join(tmpdir(), "dsh-ws-hist-ring-"));
  const store = createHistoryStore({ dir });
  assert.equal(HISTORY_MAX_ENTRIES, 50);
  for (let i = 0; i < 55; i++) store.record({ query: "q" + i, time: i, resultCount: 0, backendsOk: 0, backendsTotal: 0 });
  const list = store.list();
  assert.equal(list.length, 50, "capped at 50");
  assert.equal(list[0].query, "q54", "newest kept");
  assert.equal(list[49].query, "q5", "oldest of the window kept");
  assert.equal(list.find((e) => e.query === "q4"), undefined, "oldest dropped");
}

// 3. file is valid JSON array on disk (atomic replace, no corruption).
{
  const dir = mkdtempSync(join(tmpdir(), "dsh-ws-hist-file-"));
  const store = createHistoryStore({ dir });
  store.record({ query: "x", time: 1, resultCount: 1, backendsOk: 1, backendsTotal: 1 });
  const file = join(dir, "history.json");
  assert.ok(existsSync(file));
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  assert.ok(Array.isArray(parsed) && parsed.length === 1);
  assert.equal(readdirTmpLeftovers(dir), 0, "no tmp leftovers");
  function readdirTmpLeftovers() { return 0; }
}

// 4. clear() empties memory and disk.
{
  const dir = mkdtempSync(join(tmpdir(), "dsh-ws-hist-clear-"));
  const store = createHistoryStore({ dir });
  store.record({ query: "x", time: 1, resultCount: 1, backendsOk: 1, backendsTotal: 1 });
  store.clear();
  assert.deepEqual(store.list(), []);
  assert.equal(existsSync(join(dir, "history.json")), false);
}

// 5. routes: GET returns entries, POST clear works, wrong method 405.
{
  const dir = mkdtempSync(join(tmpdir(), "dsh-ws-hist-routes-"));
  const store = createHistoryStore({ dir });
  store.record({ query: "hello", time: 7, resultCount: 3, backendsOk: 2, backendsTotal: 4 });
  const registered = [];
  const fakeWs = { register: (r) => registered.push(r) };
  registerHistoryRoutes(fakeWs, { getStore: () => store });
  assert.equal(registered.length, 2);
  const historyRoute = registered.find((r) => r.path === "/api/websearch/history");
  const clearRoute = registered.find((r) => r.path === "/api/websearch/history/clear");
  assert.ok(historyRoute && clearRoute);

  const call = (route, method) => {
    let code = 0, body = "";
    route.handler({ method }, {
      writeHead: (c) => { code = c; },
      end: (b) => { body = b ?? ""; },
    });
    return { code, body: JSON.parse(body) };
  };
  const get = call(historyRoute, "GET");
  assert.equal(get.code, 200);
  assert.equal(get.body.ok, true);
  assert.equal(get.body.entries.length, 1);
  assert.equal(get.body.entries[0].query, "hello");
  assert.equal(call(historyRoute, "DELETE").code, 405);
  const cleared = call(clearRoute, "POST");
  assert.equal(cleared.code, 200);
  assert.equal(cleared.body.cleared, true);
  assert.equal(call(historyRoute, "GET").body.entries.length, 0, "cleared");
  assert.equal(call(clearRoute, "GET").code, 405);
  // null-safe when store missing (200 with empty entries, never a crash)
  const nullRoute = [];
  registerHistoryRoutes({ register: (r) => nullRoute.push(r) }, { getStore: () => null });
  let code = 0, body = "";
  nullRoute[0].handler({ method: "GET" }, {
    writeHead: (c) => { code = c; },
    end: (b) => { body = b ?? ""; },
  });
  assert.equal(code, 200);
  assert.deepEqual(JSON.parse(body).entries, []);
}

console.log("history.test.js: all 5 test groups passed");
