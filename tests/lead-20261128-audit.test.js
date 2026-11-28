// tests/lead-20261128-audit.test.js — regressions from the 2026-11-28 re-audit.
// Covers: partial failures are not total outages, caller cancellation is not a
// backend outage, breaker-disabled health lies, header-less 429 cooldown
// fallback, empty results are not cached, SearXNG plural-instance validation,
// and credential redaction.
// Run: node --test tests/lead-20261128-audit.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createUnifiedSearchProvider, getLatestBackendHealth, getBackendBreaker } from "../lib/provider.js";
import { foldBreaker, isCooled } from "../lib/breaker.js";
import { retryAfterMsFrom } from "../lib/util/failure-label.js";
import { invalidBaseURL } from "../lib/util/base-url.js";
import { redact } from "../lib/util/redact.js";
import { sanitizeError } from "../lib/health.js";
import { searxngBackend } from "../lib/backends/searxng.js";
import { parseDdgHtml } from "../lib/backends/ddg.js";
import { failureLabel } from "../lib/util/failure-label.js";
import { parseEnvelope } from "../lib/util/mcp-client.js";

const HEALTH = getLatestBackendHealth();

function baseOptions(ids, overrides = {}) {
  return {
    enabledBackends: ids,
    backends: Object.fromEntries(ids.map((id) => [id, { requiresKey: false }])),
    numResults: 8,
    filters: {},
    safeSearch: true,
    rerank: false,
    dedupStrategy: "url",
    cacheEnabled: false,
    resultTelemetry: true,
    breakerEnabled: true,
    breakerThreshold: 3,
    breakerCooldownMs: 60_000,
    multiQueryEnabled: false,
    deepCoverage: false,
    backendTimeoutMs: 30_000,
    language: "",
    recency: "any",
    resultHeader: true,
    historyEnabled: false,
    ...overrides,
  };
}

function providerFor(backends, overrides = {}) {
  const ids = Object.keys(backends);
  return createUnifiedSearchProvider({
    ctx: {},
    resolveOptions: () => baseOptions(ids, overrides),
    backends,
    cache: undefined,
    history: undefined,
  });
}

test("partial failure with zero-hit successes is an empty success, not a total outage", async () => {
  HEALTH.clear();
  const backends = {
    bad: { id: "bad", available: () => true, async search() { throw new Error("upstream 503"); } },
    goodA: { id: "goodA", available: () => true, async search() { return { sources: [] }; } },
    goodB: { id: "goodB", available: () => true, async search() { return { sources: [] }; } },
  };
  const provider = providerFor(backends);
  const result = await provider.search({ query: "obscure query", maxResults: 8 }, new AbortController().signal);
  assert.deepEqual(result.sources, []);
  assert.match(String(result.content ?? ""), /bad ✗/, "the degraded backend is still visible in the telemetry line");
  HEALTH.clear();
});

test("caller cancellation is not recorded as a backend failure", async () => {
  HEALTH.clear();
  const controller = new AbortController();
  const hang = (id) => ({
    id,
    available: () => true,
    search(_request, signal) {
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          const err = new Error("This operation was aborted");
          err.name = "AbortError";
          reject(err);
        }, { once: true });
      });
    },
  });
  const provider = providerFor({ exa: hang("exa"), parallel: hang("parallel") });
  const pending = provider.search({ query: "cancel me", maxResults: 8 }, controller.signal);
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(pending);
  assert.equal(getBackendBreaker("exa").failCount, 0, "cancellation must not grow the failure streak");
  assert.equal(getBackendBreaker("parallel").failCount, 0);
  assert.equal(isCooled(HEALTH.get("exa")), false);
  HEALTH.clear();
});

test("breakerEnabled:false publishes no cooldown window", async () => {
  HEALTH.clear();
  const calls = [];
  const failing = {
    id: "exa",
    available: () => true,
    async search() { calls.push("exa"); throw new Error("connection refused"); },
  };
  const provider = providerFor({ exa: failing }, { breakerEnabled: false });
  for (let i = 0; i < 4; i += 1) {
    await provider.search({ query: "q" + i, maxResults: 8 }, new AbortController().signal).catch(() => {});
  }
  assert.equal(calls.length, 4, "a disabled breaker must not skip the backend");
  const entry = HEALTH.get("exa");
  assert.equal(entry.cooledUntil, 0, "health must not claim a cooldown the provider ignores");
  assert.equal(isCooled(entry), false);
  HEALTH.clear();
});

test("header-less 429 falls back to the configured cooldown, including 0", () => {
  assert.equal(retryAfterMsFrom(new Error("HTTP 429")), undefined);
  const now = 1_000_000;
  const configured = foldBreaker(undefined, false, now, { threshold: 3, cooldownMs: 5_000 },
    { rateLimited: true, retryAfterMs: retryAfterMsFrom(new Error("HTTP 429")) });
  assert.equal(configured.cooledUntil, now + 5_000);
  const disabled = foldBreaker(undefined, false, now, { threshold: 3, cooldownMs: 0 },
    { rateLimited: true, retryAfterMs: retryAfterMsFrom(new Error("HTTP 429")) });
  assert.equal(disabled.cooledUntil, 0, "cooldownMs 0 means count only");
});

test("an empty result is not written to the cache", async () => {
  HEALTH.clear();
  let writes = 0;
  const cache = {
    get: () => undefined,
    set: () => { writes += 1; },
  };
  const options = baseOptions(["good"], { cacheEnabled: true });
  const provider = createUnifiedSearchProvider({
    ctx: {},
    resolveOptions: () => options,
    backends: { good: { id: "good", available: () => true, async search() { return { sources: [] }; } } },
    cache,
    history: undefined,
  });
  const result = await provider.search({ query: "empty", maxResults: 8 }, new AbortController().signal);
  assert.deepEqual(result.sources, []);
  assert.equal(writes, 0, "empty results are unreachable on read, so they must not evict real entries");
});

test("SearXNG rejects an invalid instance in baseURLs before any fetch", async () => {
  await assert.rejects(
    searxngBackend.search(
      { query: "q" },
      new AbortController().signal,
      { baseURL: "http://127.0.0.1:9", baseURLs: ["http://169.254.169.254/latest/meta-data/"] },
      {},
    ),
    (err) => /invalid instance URL/.test(String(err?.message)) && /link-local|https required/.test(String(err?.message)),
  );
});

test("invalidBaseURL allows https and private http only", () => {
  assert.equal(invalidBaseURL("https://search.example.com"), undefined);
  assert.equal(invalidBaseURL("http://127.0.0.1:8080"), undefined);
  assert.equal(invalidBaseURL("http://192.168.1.4:8080"), undefined);
  assert.match(String(invalidBaseURL("http://search.example.com")), /https required/);
  assert.match(String(invalidBaseURL("https://user:pass@search.example.com")), /credentials/);
  assert.match(String(invalidBaseURL("http://169.254.169.254/latest/meta-data/")), /link-local|https required/);
  assert.match(String(invalidBaseURL("ftp://search.example.com")), /https required/);
  assert.match(String(invalidBaseURL("https://metadata.google.internal./")), /link-local/);
  assert.match(String(invalidBaseURL("https://instance-data./")), /link-local/);
  assert.match(String(invalidBaseURL("https://[::]/")), /link-local/);
  assert.match(String(invalidBaseURL("https://metadata.google.internal../")), /link-local/);
  assert.match(String(invalidBaseURL("https://[::ffff:0:0]/")), /link-local/);
});

test("credentials in upstream failures are redacted before log/health/telemetry", () => {
  const raw = "Incorrect API key provided: sk-live-SECRET123456 and tvly-SECRET789";
  assert.equal(/SECRET123456|SECRET789/.test(redact(raw)), false);
  assert.equal(/SECRET123456|SECRET789/.test(sanitizeError(raw)), false);
  assert.match(sanitizeError(raw), /\[redacted\]/);
  assert.match(sanitizeError("Bearer abcdefghijklmnop"), /\[redacted\]/);
  const opaque = "key rejected: 0123456789abcdef0123456789abcdef";
  assert.equal(/0123456789abcdef/.test(sanitizeError(opaque)), false, "prefixless high-entropy keys are redacted");
  const mixed = "bad key A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0";
  assert.equal(/A1b2C3d4E5f6/.test(sanitizeError(mixed)), false, "40-char mixed-case keys are redacted");
});

test("DDG parser accepts class-after-href and never borrows the next result's snippet", () => {
  const hrefFirst = '<a href="https://example.com/x" class="result__a">Title X</a>';
  assert.equal(parseDdgHtml(hrefFirst, 8).length, 1, "attribute order must not matter");

  const bleed = [
    '<div class="result"><a class="result__a" href="https://a.example/1">A</a></div>',
    '<div class="result"><a class="result__a" href="https://b.example/2">B</a>',
    '<a class="result__snippet">snippet for B</a></div>',
  ].join("");
  const parsed = parseDdgHtml(bleed, 8);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].snippet, undefined, "A must not inherit B's snippet");
  assert.equal(parsed[1].snippet, "snippet for B");
});

test("failureLabel: a bare connection refusal is a network failure, not a proxy one", () => {
  assert.equal(failureLabel("exa", "Error: connection refused"), "network unreachable (DNS/TCP/TLS)");
  assert.equal(failureLabel("exa", "connect ECONNREFUSED 1.2.3.4:443"), "network unreachable (DNS/TCP/TLS)");
  assert.equal(
    failureLabel("exa", "TypeError: fetch failed (cause: Proxy response (502) !== 200 when HTTP Tunneling)"),
    "proxy/forwarder path failed",
  );
  assert.equal(failureLabel("ddg", "fetch failed: proxy CONNECT rejected with 403"), "proxy/forwarder path failed");
});

test("MCP batch frames for another request are rejected instead of returning frame[0]", () => {
  assert.throws(
    () => parseEnvelope('[{"jsonrpc":"2.0","id":1,"result":{"foreign":true}}]', 2),
    /response id does not match/,
  );
  const own = parseEnvelope('[{"jsonrpc":"2.0","id":9,"result":{"other":true}},{"jsonrpc":"2.0","id":2,"result":{"mine":true}}]', 2);
  assert.deepEqual(own.result, { mine: true });
});
