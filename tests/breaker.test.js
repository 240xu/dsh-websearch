// breaker.test.js — v2.7.0 circuit breaker: open / cooldown / reset / fail-open annotation.
import assert from "node:assert/strict";
import { foldBreaker, isCooled, cooledAnnotation, BREAKER_DEFAULTS } from "../lib/breaker.js";

const CFG = { threshold: 3, cooldownMs: 60_000 };
const T0 = 1_000_000;

// 1. defaults exported and conservative.
{
  assert.equal(BREAKER_DEFAULTS.threshold, 3);
  assert.equal(BREAKER_DEFAULTS.cooldownMs, 60_000);
}

// 2. below threshold: failCount grows, breaker stays closed.
{
  let prev;
  prev = foldBreaker(prev, false, T0, CFG);
  assert.equal(prev.failCount, 1);
  assert.equal(prev.cooledUntil, 0, "not open after 1 failure");
  assert.equal(isCooled(prev, T0), false);
  prev = foldBreaker(prev, false, T0 + 1, CFG);
  assert.equal(prev.failCount, 2);
  assert.equal(prev.cooledUntil, 0);
}

// 3. at threshold: opens for exactly cooldownMs.
{
  let prev;
  for (let i = 0; i < 3; i++) prev = foldBreaker(prev, false, T0 + i, CFG);
  assert.equal(prev.failCount, 3);
  assert.equal(prev.cooledUntil, T0 + 2 + 60_000, "cooledUntil = last failure + cooldown");
  assert.equal(isCooled(prev, T0 + 3), true);
  assert.equal(isCooled(prev, T0 + 2 + 60_000), false, "window closed exactly at expiry");
  assert.equal(isCooled(prev, T0 + 2 + 60_000 - 1), true);
}

// 4. any success resets fully.
{
  let prev;
  for (let i = 0; i < 3; i++) prev = foldBreaker(prev, false, T0 + i, CFG);
  prev = foldBreaker(prev, true, T0 + 10, CFG);
  assert.deepEqual(prev, { failCount: 0, cooledUntil: 0 }, "success resets breaker");
}

// 5. unknown/undefined state never trips.
{
  const r = foldBreaker(undefined, false, T0, {});
  assert.equal(r.failCount, 1);
  assert.equal(r.cooledUntil, 0);
}

// 6. fail-while-open re-trips: the window slides forward (the backend keeps
//    failing, so it stays cooled) and never silently closes.
{
  const open = { failCount: 3, cooledUntil: T0 + 60_000 };
  const r = foldBreaker(open, false, T0 + 1, CFG);
  assert.equal(r.cooledUntil, T0 + 1 + 60_000, "window slides on continued failure");
  assert.equal(r.failCount, 4);
  assert.equal(isCooled(r, T0 + 60_000), true, "still cooled at the OLD expiry");
}

// 6b. cooldownMs=0 is an explicit "disabled" (never cooled), not a 60s fallback.
{
  let prev;
  for (let i = 0; i < 5; i++) prev = foldBreaker(prev, false, T0 + i, { threshold: 3, cooldownMs: 0 });
  assert.equal(prev.failCount, 5);
  assert.equal(isCooled(prev, T0 + 10), false, "zero cooldown never opens a window");
  // null/undefined still falls back to the default
  let d;
  for (let i = 0; i < 3; i++) d = foldBreaker(d, false, T0 + i, { threshold: 3, cooldownMs: undefined });
  assert.equal(d.cooledUntil, T0 + 2 + BREAKER_DEFAULTS.cooldownMs, "missing cooldown uses default");
}

// 7. cooled annotation format.
{
  const entry = { cooledUntil: T0 + 30_000 };
  assert.equal(cooledAnnotation(entry, T0), "⏸cooled 30s");
  assert.equal(cooledAnnotation({ cooledUntil: 0 }, T0), "", "closed -> empty");
  assert.equal(cooledAnnotation(undefined, T0), "", "no state -> empty");
}

console.log("breaker.test.js: all 7 test groups passed");
