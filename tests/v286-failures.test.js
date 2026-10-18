// tests/v286-failures.test.js — route6 failure-path audit patches.
// P1: cause-chain error diagnostics + all-fail message completeness.
// P2: friendly failure labels for the telemetry line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { describeError } from "../lib/util/describe-error.js";
import { failureLabel } from "../lib/util/failure-label.js";
import {
  createUnifiedSearchProvider,
  getLatestBackendHealth,
} from "../lib/provider.js";
import { WebError } from "@deepseek-ai/dsh-web";

// ---------- P1: describeError ----------

test("describeError surfaces error.cause (undici 'fetch failed' keeps its reason)", () => {
  const cause = Object.assign(new Error("getaddrinfo ENOTFOUND mcp.exa.ai"), { code: "ENOTFOUND" });
  const err = new TypeError("fetch failed", { cause });
  assert.equal(
    describeError(err),
    "TypeError: fetch failed (cause: getaddrinfo ENOTFOUND mcp.exa.ai)",
  );
});

test("describeError: plain errors, string causes, depth cap", () => {
  assert.equal(describeError(new WebError("boom exploded", "WEB_PROVIDER_ERROR")), "WebError: boom exploded");
  assert.equal(describeError(new Error("plain")), "plain");
  // code is prefixed only when the message does not already carry it
  const coded = Object.assign(new Error("fetch failed"), { code: "ECONNREFUSED" });
  assert.equal(describeError(coded), "ECONNREFUSED fetch failed");
  // deep chains are bounded to maxDepth (no infinite walk on cycles)
  const a = new Error("a"); const b = new Error("b"); const c = new Error("c");
  a.cause = b; b.cause = c; c.cause = a;
  const out = describeError(a);
  assert.ok(out.length < 120, "bounded output, got: " + out);
});

// ---------- P1: all-fail message names cooled-skipped backends + '+N more' ----------

test("all-fail error: cooled-skipped backends are named and >4 reasons collapse to '+N more'", async () => {
  // Seed a cooled backend (as if 3 prior failures tripped the breaker).
  const health = getLatestBackendHealth();
  health.set("cooledA", { ok: false, at: Date.now(), ms: 100, error: "prior failure", failCount: 3, cooledUntil: Date.now() + 60_000 });

  const failing = (id) => ({
    id,
    requiresCredential: false,
    available: () => true,
    async search() { throw new WebError("reason for " + id, "WEB_PROVIDER_ERROR"); },
  });
  const backends = {
    cooledA: failing("cooledA"),
    boom1: failing("boom1"),
    boom2: failing("boom2"),
    boom3: failing("boom3"),
    boom4: failing("boom4"),
    boom5: failing("boom5"),
  };
  const provider = createUnifiedSearchProvider({
    ctx: {},
    resolveOptions: () => ({
      enabledBackends: Object.keys(backends),
      numResults: 4,
      backends: {},
      ctx: {},
      breakerEnabled: true,
    }),
    backends,
  });
  try {
    await assert.rejects(
      provider.search({ query: "route6 cooled probe", maxResults: 4 }, undefined),
      (err) => {
        assert.equal(err.code, "WEB_PROVIDER_ERROR");
        assert.match(err.message, /all enabled backends failed \(5\)/, "5 attempted failures counted");
        assert.match(err.message, /cooled-skipped: cooledA ⏸cooled/, "cooled backend named");
        assert.match(err.message, /\+1 more/, "5th failure collapsed into a marker");
        assert.match(err.message, /boom1: reason for boom1/, "first reasons still enumerated");
        return true;
      },
    );
  } finally {
    health.delete("cooledA");
  }
});

// ---------- P2: failureLabel classification ----------

test("failureLabel classifies the observed failure families; unknown stays raw", () => {
  assert.equal(
    failureLabel("searxng", "SearXNG instance degraded: returned an anti-bot challenge page (HTTP 200, non-JSON)"),
    "instance degraded (anti-bot/non-JSON page)",
  );
  assert.equal(failureLabel("searxng", "SearXNG: invalid JSON response"), "instance degraded (anti-bot/non-JSON page)");
  assert.equal(failureLabel("ddg", 'backend "ddg" timed out after 8000ms'), "timeout (network slow/blocked)");
  assert.equal(failureLabel("exa", "TypeError: fetch failed (cause: getaddrinfo ENOTFOUND mcp.exa.ai)"), "network unreachable (DNS/TCP/TLS)");
  assert.equal(failureLabel("searxng", "SearXNG API error (HTTP 429): Too Many Requests"), "rate-limited (HTTP 429)");
  assert.equal(failureLabel("brave", "HTTP 502: bad gateway"), "server error (HTTP 502)");
  assert.equal(failureLabel("ddg", "ddg HTTP 403: blocked"), "blocked (HTTP 403)");
  assert.equal(failureLabel("flaky", "boom 503"), undefined, "unclassified -> raw text kept by caller");
  assert.equal(failureLabel("searxng", ""), undefined);
});

test("telemetry line shows the friendly label for a degraded searxng next to success", async () => {
  const okBe = {
    id: "okbe",
    requiresCredential: false,
    available: () => true,
    async search() { return { sources: [{ url: "https://ok.example", title: "OK" }] }; },
  };
  const searx = {
    id: "searxng",
    requiresCredential: false,
    available: () => true,
    async search() { throw new WebError("SearXNG instance degraded: returned an anti-bot challenge page (HTTP 200, non-JSON)", "WEB_PROVIDER_ERROR"); },
  };
  const provider = createUnifiedSearchProvider({
    ctx: {},
    resolveOptions: () => ({
      enabledBackends: ["okbe", "searxng"],
      numResults: 4,
      backends: {},
      ctx: {},
      resultTelemetry: true,
    }),
    backends: { okbe: okBe, searxng: searx },
  });
  const res = await provider.search({ query: "route6 telemetry probe", maxResults: 4 }, undefined);
  assert.equal(res.sources.length, 1, "healthy backend still serves");
  assert.match(res.content, /searxng ✗\d+ms \(instance degraded \(anti-bot\/non-JSON page\)\)/);
  assert.doesNotMatch(res.content, /unified search aborted/);
});

// ---------- P3a: SearXNG semantic health + anti-bot classification ----------

const ENV_KEYS = ["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "NO_PROXY", "no_proxy", "DSH_EGRESS_FORWARDER", "DSH_EGRESS_FORWARDER_PROXY"];
function withMockFetch(handler, fn) {
  const savedFetch = globalThis.fetch;
  const savedEnv = {};
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
  globalThis.fetch = async (url, init) => handler(String(url), init);
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      globalThis.fetch = savedFetch;
      for (const k of ENV_KEYS) { if (savedEnv[k] !== undefined) process.env[k] = savedEnv[k]; }
    });
}

test("searxng: 200 + anti-bot HTML page -> 'instance degraded' (not raw parse error)", async () => {
  const { searxngBackend } = await import("../lib/backends/searxng.js");
  await withMockFetch(
    () => new Response("<!doctype html><html><title>Verifying your browser…</title></html>", {
      status: 200, headers: { "content-type": "text/html" },
    }),
    async () => {
      await assert.rejects(
        searxngBackend.search({ query: "q", maxResults: 4 }, undefined, { baseURL: "https://searx.example" }),
        (err) => err instanceof WebError
          && /anti-bot challenge page/.test(err.message)
          && /instance degraded/.test(err.message),
      );
    },
  );
});

test("searxng: 200 + JSON without results[] -> protocol violation", async () => {
  const { searxngBackend } = await import("../lib/backends/searxng.js");
  await withMockFetch(
    () => new Response(JSON.stringify({ error: "wrapped by a wall" }), {
      status: 200, headers: { "content-type": "application/json" },
    }),
    async () => {
      await assert.rejects(
        searxngBackend.search({ query: "q", maxResults: 4 }, undefined, { baseURL: "https://searx.example" }),
        (err) => err instanceof WebError && /lacks a results\[\] array/.test(err.message),
      );
    },
  );
});

test("searxng: 200 + JSON results[] parses; empty results[] is a legit empty search", async () => {
  const { searxngBackend } = await import("../lib/backends/searxng.js");
  await withMockFetch(
    () => new Response(JSON.stringify({ results: [
      { url: "https://a.example", title: "A", content: "snippet", engine: "google" },
      { title: "no url - dropped" },
    ] }), { status: 200, headers: { "content-type": "application/json" } }),
    async () => {
      const r = await searxngBackend.search({ query: "q", maxResults: 4 }, undefined, { baseURL: "https://searx.example" });
      assert.equal(r.sources.length, 1);
      assert.equal(r.sources[0].url, "https://a.example");
    },
  );
  await withMockFetch(
    () => new Response(JSON.stringify({ results: [] }), { status: 200, headers: { "content-type": "application/json" } }),
    async () => {
      const r = await searxngBackend.search({ query: "rare zzqq", maxResults: 4 }, undefined, { baseURL: "https://searx.example" });
      assert.deepEqual(r.sources, [], "empty results[] passes the semantic gate");
    },
  );
});

// ---------- P3b: SearXNG multi-instance failover (opt-in) ----------

test("searxng failover: 429 on primary rotates to the backup; next search skips the cooled primary", async () => {
  const { searxngBackend, resetInstanceCooldowns } = await import("../lib/backends/searxng.js");
  resetInstanceCooldowns();
  const hosts = [];
  await withMockFetch(
    (url) => {
      hosts.push(new URL(url).host);
      if (url.includes("a.test")) return new Response("Too Many Requests", { status: 429 });
      return new Response(JSON.stringify({ results: [{ url: "https://b.example", title: "B" }] }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    },
    async () => {
      const opts = { baseURL: "https://a.test", baseURLs: ["https://b.test"] };
      const r1 = await searxngBackend.search({ query: "q1", maxResults: 4 }, undefined, opts);
      assert.equal(r1.sources.length, 1);
      assert.equal(r1.sources[0].url, "https://b.example");
      assert.deepEqual(hosts, ["a.test", "b.test"], "primary tried first, then backup");

      hosts.length = 0;
      const r2 = await searxngBackend.search({ query: "q2", maxResults: 4 }, undefined, opts);
      assert.equal(r2.sources.length, 1);
      assert.deepEqual(hosts, ["b.test"], "cooled primary skipped entirely");
    },
  );
  resetInstanceCooldowns();
});

test("searxng failover: caller abort propagates as WEB_ABORTED, not a timeout/mixed error", async () => {
  const { searxngBackend, resetInstanceCooldowns } = await import("../lib/backends/searxng.js");
  resetInstanceCooldowns();
  await withMockFetch(
    (url, init) => {
      if (url.includes("a.test")) {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("This operation was aborted", "AbortError")));
        });
      }
      return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { "content-type": "application/json" } });
    },
    async () => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 30);
      await assert.rejects(
        searxngBackend.search({ query: "q", maxResults: 4 }, controller.signal, { baseURL: "https://a.test", baseURLs: ["https://b.test"] }),
        (err) => err instanceof WebError && err.code === "WEB_ABORTED",
      );
    },
  );
  resetInstanceCooldowns();
});

// ---------- P6: timeout classification consistency on the failure path ----------

test("backend timeout: telemetry says 'timed out after Nms' (not the abort-flavored internal error)", async () => {
  const hangbe = {
    id: "hangbe",
    requiresCredential: false,
    available: () => true,
    search(_req, sig) {
      // Mirrors ddg/searxng: an internal timeout surfaces as WEB_ABORTED.
      return new Promise((_resolve, reject) => {
        sig.addEventListener("abort", () => reject(new WebError("unified search aborted", "WEB_ABORTED")));
      });
    },
  };
  const okbe = {
    id: "okbe",
    requiresCredential: false,
    available: () => true,
    async search() { return { sources: [{ url: "https://ok.example" }] }; },
  };
  const provider = createUnifiedSearchProvider({
    ctx: {},
    resolveOptions: () => ({
      enabledBackends: ["hangbe", "okbe"],
      numResults: 4,
      backends: {},
      ctx: {},
      backendTimeoutMs: 60,
      resultTelemetry: true,
    }),
    backends: { hangbe, okbe },
  });
  const res = await provider.search({ query: "route6 timeout probe", maxResults: 4 }, undefined);
  assert.equal(res.sources.length, 1, "healthy backend still serves");
  assert.match(res.content, /hangbe ✗\d+ms \(timeout \(network slow\/blocked\)\)/);
  assert.doesNotMatch(res.content, /unified search aborted/, "abort-flavored internal text must not leak");
});

// p2b: proxy/forwarder failures are their own class (route5 incident shape).
test("failureLabel: proxy/forwarder path failures are classified separately", () => {
  assert.equal(
    failureLabel("exa", "TypeError: fetch failed (cause: Proxy response (502) !== 200 when HTTP Tunneling)"),
    "proxy/forwarder path failed",
  );
  assert.equal(failureLabel("ddg", "fetch failed: proxy CONNECT rejected with 403"), "proxy/forwarder path failed");
});
