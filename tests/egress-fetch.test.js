// tests/egress-fetch.test.js — proxy tunnel semantics of the zero-dep shim.
// The native-fetch passthrough keeps every non-proxied deployment identical;
// these tests pin the proxy paths (absolute-form http, CONNECT https, NO_PROXY,
// abort, redirect:"error").
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { egressFetch } from "../lib/util/egress-fetch.js";

const SAVED = ["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "NO_PROXY", "no_proxy"].reduce((acc, key) => {
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
