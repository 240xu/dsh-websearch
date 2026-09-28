// tests/store-dir.test.js — compat-audit P2-7: store dir must use os.homedir()
// (NOT process.env.HOME) as the fallback, so Windows (HOME unset) does not get
// a relative ".dsh/cache/websearch" that silently disables cache/history.
import assert from "node:assert/strict";
import { resolveStoreDir } from "../lib/index.js";

// 1. DSH_HOME always wins, verbatim.
{
  assert.equal(
    resolveStoreDir({ DSH_HOME: "/data/dsh", HOME: "/home/u" }, "/fallback"),
    "/data/dsh/cache/websearch",
  );
  assert.equal(resolveStoreDir({ DSH_HOME: "/data/dsh" }, "/fallback"), "/data/dsh/cache/websearch");
}

// 2. no DSH_HOME: <home>/.dsh — the injected fallbackHome (os.homedir()), NOT env.HOME.
{
  assert.equal(resolveStoreDir({ HOME: "/home/u" }, "/fallback"), "/fallback/.dsh/cache/websearch");
  assert.equal(resolveStoreDir({}, "/fallback"), "/fallback/.dsh/cache/websearch");
  assert.equal(
    resolveStoreDir({ HOME: "/home/u" }, "/fallback"),
    "/fallback/.dsh/cache/websearch",
    "env.HOME must be ignored in favor of homedir",
  );
}

// 3. no injection at all: uses real os.homedir(), never throws.
{
  const real = resolveStoreDir({});
  assert.ok(typeof real === "string" && real.length > 0);
  assert.ok(!real.startsWith(".dsh"), "never a relative path");
}

console.log("store-dir.test.js: all 3 test groups passed");
