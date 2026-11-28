// tests/lead-20261108-quota.test.js — 429 3a: classify quota failures and
// cool them immediately (internal behaviour only; no model-visible text).
// Run: node --test tests/lead-20261108-quota.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { foldBreaker } from "../lib/breaker.js";
import { rateLimited, retryAfterMsFrom } from "../lib/util/failure-label.js";
import { webErrorFromResponse, RATE_LIMIT_CODE, QUOTA_CODE } from "../lib/util/web-error.js";

test("rateLimited() routes on structured fields, with a narrow legacy fallback", () => {
  assert.equal(rateLimited(new Error("MCP tools/call HTTP 429: too many requests")), true);
  assert.equal(rateLimited({ message: "firecrawl returned an MCP error: Anonymous keyless access is unavailable" }), true);
  assert.equal(rateLimited(new Error("额度不足")), true);
  // Bare "quota" text is no longer trusted: HTTP 402/200/503 bodies used to
  // produce false positives (57-audit-error-contract.md F-2).
  assert.equal(rateLimited(new Error("quota exceeded")), false);
  assert.equal(rateLimited({ message: "HTTP 200: anonymous user" }), false);
  // Ordinary failures must NOT be classified as quota.
  assert.equal(rateLimited(new Error("SearXNG: invalid JSON response")), false);
  assert.equal(rateLimited(new Error("unified search aborted")), false);
  assert.equal(rateLimited(new Error("fetch failed")), false);
});

test("retryAfterMsFrom() reports no explicit window when the header is absent", () => {
  // The breaker owns the fallback: it uses the configured cooldown, so
  // `breakerCooldownMs: 0` can mean "count only" even for a bare 429.
  assert.equal(retryAfterMsFrom(new Error("HTTP 429")), undefined);
  assert.equal(retryAfterMsFrom({ retryAfter: 12 }), 12_000);
  assert.equal(retryAfterMsFrom({ cause: { response: { headers: { get: () => "5" } } } }), 5_000);
});

test("foldBreaker cools a quota failure immediately, non-quota still needs 3", () => {
  const now = 1_000_000;
  const cfg = { threshold: 3, cooldownMs: 60_000 };
  // First 429: cooled right away (not after 3 failures).
  const q1 = foldBreaker(undefined, false, now, cfg, { rateLimited: true, retryAfterMs: 30_000 });
  assert.equal(q1.failCount, 1);
  assert.equal(q1.cooledUntil, now + 30_000);
  // Non-quota: first two failures do not open the breaker.
  const n1 = foldBreaker(undefined, false, now, cfg);
  const n2 = foldBreaker(n1, false, now + 1, cfg);
  assert.equal(n1.cooledUntil, 0);
  assert.equal(n2.cooledUntil, 0);
  assert.equal(foldBreaker(n2, false, now + 2, cfg).cooledUntil, now + 2 + 60_000);
  // Success clears state.
  assert.deepEqual(foldBreaker(q1, true, now, cfg), { failCount: 0, cooledUntil: 0 });
  // Default opts keep the old behaviour (zero regression for existing callers).
  assert.equal(foldBreaker(undefined, false, now, cfg).cooledUntil, 0);
});

test("webErrorFromResponse preserves status, Retry-After and code", () => {
  const response = new Response("rate limited", {
    status: 429,
    headers: { "retry-after": "7" },
  });
  const err = webErrorFromResponse(response, "rate limited", "Exa");
  assert.equal(err.status, 429);
  assert.equal(err.code, RATE_LIMIT_CODE);
  assert.equal(err.rateLimited, true);
  assert.equal(err.retryAfter, "7");
  assert.equal(rateLimited(err), true);
  assert.equal(retryAfterMsFrom(err), 7_000);
  assert.equal(err instanceof Error, true);
  assert.match(err.message, /HTTP 429/); // N-1: status is not lost to provider detail
});

test("webErrorFromResponse marks 402/403 as quota without a bare-text false positive", () => {
  const err = webErrorFromResponse(new Response("quota", { status: 402 }), "quota", "Brave");
  assert.equal(err.code, QUOTA_CODE);
  assert.equal(err.quota, true);
  assert.equal(rateLimited(err), true);
});

// 3b: the all-cooled branch must fail fast only when every cooled backend is
// rate-limited; a mixed/non-quota cooldown keeps fail-open. Driven at source
// level here (the fan-out needs a full provider harness); the branch shape is
// pinned so it cannot silently regress to unconditional fail-open.
test("3b: cooled rate-limited backends are excluded; keyless refusal is distinct", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../lib/provider.js", import.meta.url), "utf8");
  // V3 runtime assessment D9/D2: the mixed-outage fix classifies cooled
  // entries instead of requiring every cooldown to be rate-limited.
  assert.match(src, /rateLimitedCooled\.set\(c\.id, entry\)/);
  assert.match(src, /all backends are rate-limited; retry after/);
  assert.match(src, /all backends need an API key \(keyless access is unavailable\)/);
  // Behavioural coverage lives in lead-20261109-3b-runtime.test.js
  // (real provider + fake backends), not in these source-shape assertions.
  assert.match(src, /failOpen\.length > 0/);
});

test("breaker: an expired cooldown resets the failure streak", () => {
  const cfg = { threshold: 3, cooldownMs: 60_000 };
  const now = 1_000_000;
  const opened = foldBreaker(undefined, false, now, cfg, { rateLimited: true, retryAfterMs: 1000 });
  assert.equal(opened.failCount, 1);
  // Same backend fails again AFTER the window expired: streak restarts at 1.
  const later = now + 2000;
  const after = foldBreaker(opened, false, later, cfg);
  assert.equal(after.failCount, 1);
  assert.equal(after.cooledUntil, 0);
});

test("numResults: host cap and user setting are both honoured by min()", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../lib/provider.js", import.meta.url), "utf8");
  assert.match(src, /Math\.min\(hostCap, userMax\)/);
  assert.match(src, /ddg: 8000/);
  assert.match(src, /timed out after \$\{effectiveTimeoutMs\}ms/);
});

test("retryAfterMsFrom: an http-date in the past falls back, not to a zero window", () => {
  // R1 复核 B-1: Date.parse succeeds on a past date but Math.max(0, ...) used
  // to produce a 0ms cooldown, effectively disabling the breaker.
  assert.equal(retryAfterMsFrom({ retryAfter: "Wed, 21 Oct 2015 07:28:00 GMT" }), undefined);
  // A genuinely future http-date still yields a positive window.
  assert.ok(retryAfterMsFrom({ retryAfter: new Date(Date.now() + 30_000).toUTCString() }) > 0);
});

// R1: guard against a hostile/bogus Retry-After disabling a backend for years,
// and ensure 403 (often an invalid key) is not classified as quota.
test("retryAfterMsFrom caps oversized cooldowns; 403 is not quota", () => {
  assert.equal(retryAfterMsFrom({ retryAfter: "999999999" }), undefined);
  assert.equal(retryAfterMsFrom({ retryAfter: "86400" }), 86_400_000); // exactly 1 day is allowed
  const err403 = webErrorFromResponse(new Response("forbidden", { status: 403 }), "forbidden", "Brave");
  assert.equal(err403.code, "WEB_PROVIDER_ERROR");
  assert.equal(err403.quota, false);
  assert.equal(rateLimited(err403), false);
});

test("ddg rethrows structured WebError from webErrorFromResponse", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../lib/backends/ddg.js", import.meta.url), "utf8");
  assert.match(src, /if \(err instanceof WebError\) throw err;/);
});

// V3 D3: the cooldown annotation must be computed at the same instant as the
// fan-out decision, otherwise a window that expires during a slow search is
// rendered as a bare "⏸cooled" for an already-retryable backend.
test("cooledAnnotation is evaluated at fan-out time, not render time", async () => {
  const { cooledAnnotation } = await import("../lib/breaker.js");
  const nowMs = 1_000_000;
  const entry = { cooledUntil: nowMs + 24_000, failCount: 1 };
  assert.equal(cooledAnnotation(entry, nowMs), "⏸cooled 24s");
  // At render time (8s later) the window may be gone; the caller must not
  // fall back to a bare annotation. Assert the render-time value is empty.
  assert.equal(cooledAnnotation(entry, nowMs + 30_000), "");
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../lib/provider.js", import.meta.url), "utf8");
  assert.match(src, /cooledAnnotation\(centry, nowMs\)/);
  assert.doesNotMatch(src, /cooledAnnotation\(centry, Date\.now\(\)\) \|\| "⏸cooled"/);
});

// 65 号 A.7: a zero/negative concurrency must not hang every queued backend.
test("createLimiter clamps a non-positive limit to 1", async () => {
  const { createLimiter } = await import("../lib/provider.js");
  for (const bad of [0, -1, NaN]) {
    const limit = createLimiter(bad);
    let done = false;
    await Promise.race([
      limit(async () => { done = true; return 1; }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("hang")), 200)),
    ]);
    assert.equal(done, true, "limit(" + String(bad) + ") must resolve");
  }
  const six = createLimiter(6);
  assert.ok(await six(async () => 1) === 1);
});

// 65 号 A.8: a cooldown that expires during a slow search must be marked as
// expired, not reported as still cooling.
test("cooled note marks a window that expired during the search", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../lib/provider.js", import.meta.url), "utf8");
  assert.match(src, /isCooled\(centry, Date\.now\(\)\) \? "" : " \(expired during search\)"/);
});
