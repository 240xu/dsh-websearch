// tests/egress-fetch.test.js — proxy tunnel semantics of the zero-dep shim.
// The native-fetch passthrough keeps every non-proxied deployment identical;
// these tests pin the proxy paths (absolute-form http, CONNECT https, NO_PROXY,
// abort, redirect:"error").
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { egressFetch } from "../lib/util/egress-fetch.js";

const SAVED = [
  "HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "NO_PROXY", "no_proxy",
  "DSH_EGRESS_FORWARDER", "DSH_EGRESS_FORWARDER_PROXY", "DSH_EGRESS_FORWARDER_TIMEOUT_MS",
].reduce((acc, key) => {
  acc[key] = process.env[key];
  return acc;
}, {});

function setEnv(values) {
  for (const key of Object.keys(SAVED)) delete process.env[key];
  Object.assign(process.env, values);
}
function restoreEnv() {
  for (const key of Object.keys(SAVED)) delete process.env[key];
  for (const [key, value] of Object.entries(SAVED)) if (value !== undefined) process.env[key] = value;
}
function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

test("no proxy env -> native fetch passthrough", async () => {
  const server = http.createServer((req, res) => res.end("direct"));
  const port = await listen(server);
  setEnv({});
  try {
    const res = await egressFetch(`http://127.0.0.1:${port}/x`);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "direct");
  } finally {
    server.close();
    restoreEnv();
  }
});

test("HTTP_PROXY routes an http target through the proxy (absolute-form)", async () => {
  const seen = [];
  const proxy = http.createServer((req, res) => {
    seen.push(req.url);
    res.end("via-proxy");
  });
  const proxyPort = await listen(proxy);
  setEnv({ HTTP_PROXY: `http://127.0.0.1:${proxyPort}`, NO_PROXY: "" });
  try {
    const res = await egressFetch("http://example.test/hello?q=1");
    assert.equal(await res.text(), "via-proxy");
    assert.deepEqual(seen, ["http://example.test/hello?q=1"]);
  } finally {
    proxy.close();
    restoreEnv();
  }
});

test("POST body and content-length reach the proxy", async () => {
  let captured = "";
  const proxy = http.createServer((req, res) => {
    req.on("data", (chunk) => { captured += chunk; });
    req.on("end", () => res.end("ok:" + String(req.headers["content-length"] ?? "?")));
  });
  const proxyPort = await listen(proxy);
  setEnv({ HTTP_PROXY: `http://127.0.0.1:${proxyPort}`, NO_PROXY: "" });
  try {
    const res = await egressFetch("http://example.test/post", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ a: 1 }),
    });
    assert.equal(captured, '{"a":1}');
    assert.equal(await res.text(), "ok:7");
  } finally {
    proxy.close();
    restoreEnv();
  }
});

test("NO_PROXY host bypasses the proxy entirely", async () => {
  const hits = [];
  const proxy = http.createServer((req, res) => {
    hits.push(req.url);
    res.end("proxy");
  });
  const proxyPort = await listen(proxy);
  const server = http.createServer((req, res) => res.end("direct"));
  const port = await listen(server);
  setEnv({ HTTP_PROXY: `http://127.0.0.1:${proxyPort}`, NO_PROXY: "127.0.0.1" });
  try {
    const res = await egressFetch(`http://127.0.0.1:${port}/y`);
    assert.equal(await res.text(), "direct");
    assert.equal(hits.length, 0);
  } finally {
    proxy.close();
    server.close();
    restoreEnv();
  }
});

test("https target tunnels via CONNECT; proxy rejection surfaces as TypeError", async () => {
  const proxy = http.createServer((req, res) => {
    res.writeHead(403);
    res.end();
  });
  proxy.on("connect", (req, socket) => {
    socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
  });
  const proxyPort = await listen(proxy);
  setEnv({ HTTPS_PROXY: `http://127.0.0.1:${proxyPort}`, NO_PROXY: "" });
  try {
    await assert.rejects(
      egressFetch("https://blocked.test/x"),
      (err) => err instanceof TypeError && /proxy CONNECT rejected with 403/.test(err.message),
    );
  } finally {
    proxy.close();
    restoreEnv();
  }
});

test("already-aborted signal rejects with AbortError before any dial", async () => {
  setEnv({ HTTP_PROXY: "http://127.0.0.1:9", NO_PROXY: "" });
  try {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      egressFetch("http://example.test/", { signal: controller.signal }),
      (err) => err?.name === "AbortError",
    );
  } finally {
    restoreEnv();
  }
});

test("forwarder: relays through sidecar, spec carries method/headers/body/proxy", async () => {
  const received = [];
  const sidecar = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      received.push({
        url: req.url,
        specHeader: req.headers["x-sidecar-spec"],
        body: Buffer.concat(chunks).toString(),
      });
      res.writeHead(200, { "content-type": "text/plain", "x-upstream": "yes" });
      res.end("hello-from-sidecar");
    });
  });
  const port = await listen(sidecar);
  setEnv({
    DSH_EGRESS_FORWARDER: `http://127.0.0.1:${port}/fwd`,
    DSH_EGRESS_FORWARDER_PROXY: "http://172.30.66.1:1091",
    NO_PROXY: "",
  });
  try {
    const res = await egressFetch("https://mcp.exa.ai/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"jsonrpc":"2.0"}',
      redirect: "error",
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-upstream"), "yes");
    assert.equal(await res.text(), "hello-from-sidecar");
    assert.equal(received.length, 1);
    assert.equal(received[0].url, "/fwd");
    const spec = JSON.parse(Buffer.from(received[0].specHeader, "base64").toString());
    assert.equal(spec.url, "https://mcp.exa.ai/mcp");
    assert.equal(spec.method, "POST");
    assert.equal(spec.proxy, "http://172.30.66.1:1091");
    assert.equal(spec.redirect, "error");
    assert.equal(spec.headers["content-type"], "application/json");
    assert.equal(received[0].body, '{"jsonrpc":"2.0"}');
  } finally {
    sidecar.close();
    restoreEnv();
  }
});

test("forwarder: 502 + x-sidecar-error becomes a fetch-style TypeError", async () => {
  const sidecar = http.createServer((req, res) => {
    req.resume();
    res.writeHead(502, { "content-type": "application/json", "x-sidecar-error": "dial" });
    res.end(JSON.stringify({ error: "fetch failed" }));
  });
  const port = await listen(sidecar);
  setEnv({ DSH_EGRESS_FORWARDER: `http://127.0.0.1:${port}/fwd`, NO_PROXY: "" });
  try {
    await assert.rejects(
      egressFetch("https://mcp.exa.ai/mcp", { method: "POST", body: "{}" }),
      (err) => err instanceof TypeError && /forwarder dial/.test(err.message),
    );
  } finally {
    sidecar.close();
    restoreEnv();
  }
});

test("forwarder: NO_PROXY target bypasses the sidecar entirely", async () => {
  let sidecarHits = 0;
  const sidecar = http.createServer((req, res) => {
    sidecarHits += 1;
    req.resume();
    res.writeHead(200);
    res.end("sidecar");
  });
  const sidecarPort = await listen(sidecar);
  const direct = http.createServer((req, res) => res.end("direct"));
  const directPort = await listen(direct);
  setEnv({
    DSH_EGRESS_FORWARDER: `http://127.0.0.1:${sidecarPort}/fwd`,
    NO_PROXY: "127.0.0.1",
  });
  try {
    const res = await egressFetch(`http://127.0.0.1:${directPort}/x`);
    assert.equal(await res.text(), "direct");
    assert.equal(sidecarHits, 0);
  } finally {
    sidecar.close();
    direct.close();
    restoreEnv();
  }
});

test("forwarder: bypasses a hijacked global fetch (dispatcher regression)", async () => {
  const sidecar = http.createServer((req, res) => {
    req.resume();
    res.writeHead(200);
    res.end("direct-ok");
  });
  const port = await listen(sidecar);
  setEnv({ DSH_EGRESS_FORWARDER: `http://127.0.0.1:${port}/fwd`, NO_PROXY: "" });
  const hijacked = globalThis.fetch;
  globalThis.fetch = () => { throw new TypeError("fetch was hijacked by a global dispatcher"); };
  try {
    const res = await egressFetch("https://mcp.exa.ai/mcp", { method: "POST", body: "{}" });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "direct-ok");
  } finally {
    globalThis.fetch = hijacked;
    sidecar.close();
    restoreEnv();
  }
});

test("forwarder: stalled sidecar yields a clear timeout, not a backend-budget hang", async () => {
  const sidecar = http.createServer(() => { /* accepts, never responds */ });
  const port = await listen(sidecar);
  setEnv({
    DSH_EGRESS_FORWARDER: `http://127.0.0.1:${port}/fwd`,
    DSH_EGRESS_FORWARDER_TIMEOUT_MS: "300",
    NO_PROXY: "",
  });
  const started = Date.now();
  try {
    await assert.rejects(
      egressFetch("https://mcp.exa.ai/mcp", { method: "POST", body: "{}" }),
      (err) => err instanceof TypeError && /forwarder did not respond within 300ms/.test(err.message),
    );
    assert.ok(Date.now() - started < 2000, "must not wait for any outer 30s budget");
  } finally {
    sidecar.close();
    restoreEnv();
  }
});

test("forwarder: caller abort still wins over the forwarder timeout", async () => {
  const sidecar = http.createServer(() => { /* accepts, never responds */ });
  const port = await listen(sidecar);
  setEnv({
    DSH_EGRESS_FORWARDER: `http://127.0.0.1:${port}/fwd`,
    DSH_EGRESS_FORWARDER_TIMEOUT_MS: "5000",
    NO_PROXY: "",
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 50);
  try {
    await assert.rejects(
      egressFetch("https://mcp.exa.ai/mcp", { method: "POST", body: "{}", signal: controller.signal }),
      (err) => err?.name === "AbortError",
    );
  } finally {
    clearTimeout(timer);
    sidecar.close();
    restoreEnv();
  }
});

test("redirect:error rejects on 3xx with location", async () => {
  const proxy = http.createServer((req, res) => {
    res.writeHead(301, { location: "http://example.test/moved" });
    res.end();
  });
  const proxyPort = await listen(proxy);
  setEnv({ HTTP_PROXY: `http://127.0.0.1:${proxyPort}`, NO_PROXY: "" });
  try {
    await assert.rejects(
      egressFetch("http://example.test/old", { redirect: "error" }),
      (err) => err instanceof TypeError && /redirect mode is set to error/.test(err.message),
    );
  } finally {
    proxy.close();
    restoreEnv();
  }
});
