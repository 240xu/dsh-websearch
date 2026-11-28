// MCP tool results may carry multiple text blocks or structuredContent.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mcpText } from "../lib/util/mcp-client.js";
import { parseExaResult } from "../lib/backends/exa.js";

test("mcpText joins every text block and ignores non-text blocks", () => {
  assert.equal(mcpText({ content: [
    { type: "image", data: "..." },
    { type: "text", text: "first" },
    { type: "text", text: "second" },
  ] }), "first\nsecond");
});

test("mcpText falls back to structuredContent", () => {
  assert.equal(mcpText({ content: [], structuredContent: { results: [] } }), '{"results":[]}');
  assert.equal(mcpText({ content: [{ type: "image" }], structuredContent: "ok" }), "ok");
});

test("Exa parser accepts multiple text blocks", () => {
  const result = { content: [
    { type: "text", text: "Title: A\nURL: https://a.example/1\nHighlights:\n  - one" },
    { type: "text", text: "Title: B\nURL: https://b.example/2\nHighlights:\n  - two" },
  ] };
  const sources = parseExaResult(result, 5);
  assert.equal(sources.length, 2);
  assert.equal(sources[0].snippet, "one");
  assert.equal(sources[1].url, "https://b.example/2");
});

import http from "node:http";
import { mcpCall } from "../lib/util/mcp-client.js";

async function withServer(handler, fn) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}/mcp`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("mcpCall returns on the matching SSE frame without waiting for EOF", async () => {
  const started = Date.now();
  await withServer((req, res) => {
    let body = "";
    req.on("data", (c) => body += c);
    req.on("end", () => {
      const id = (() => { try { return JSON.parse(body).id; } catch { return 2; } })();
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "early" }] } })}\n\n`);
      // Intentionally keep the stream open; EOF must not be required.
    });
  }, async (url) => {
    const result = await mcpCall(url, "search", { q: "x" }, {}, new AbortController().signal, { skipInitialize: true });
    assert.equal(result.content[0].text, "early");
  });
  assert.ok(Date.now() - started < 1000, "did not wait for the open SSE stream");
});

test("mcpCall rejects an initialize JSON-RPC error instead of caching a session", async () => {
  await withServer((req, res) => {
    let body = "";
    req.on("data", (c) => body += c);
    req.on("end", () => {
      const parsed = (() => { try { return JSON.parse(body); } catch { return {}; } })();
      if (parsed.method === "initialize") {
        res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "s1" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "bad protocol" } }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result: { content: [] } }));
    });
  }, async (url) => {
    await assert.rejects(
      mcpCall(url, "search", { q: "x" }, {}, new AbortController().signal),
      /initialize error|protocol/i,
    );
  });
});

test("mcpCall rejects a JSON null envelope as a WebError", async () => {
  await withServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("null");
    });
  }, async (url) => {
    await assert.rejects(
      mcpCall(url, "search", { q: "x" }, {}, new AbortController().signal, { skipInitialize: true }),
      /invalid response envelope/,
    );
  });
});

test("mcpCall streams through an HTTP proxy without waiting for EOF", async () => {
  const saved = { HTTP_PROXY: process.env.HTTP_PROXY, http_proxy: process.env.http_proxy, NO_PROXY: process.env.NO_PROXY, no_proxy: process.env.no_proxy, DSH_EGRESS_FORWARDER: process.env.DSH_EGRESS_FORWARDER };
  const proxy = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('data: {"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"proxied"}]}}\n\n');
      // Keep the proxy response open; a buffering client would hang here.
    });
  });
  await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  process.env.HTTP_PROXY = `http://127.0.0.1:${proxy.address().port}`;
  process.env.http_proxy = process.env.HTTP_PROXY;
  process.env.NO_PROXY = "";
  process.env.no_proxy = "";
  delete process.env.DSH_EGRESS_FORWARDER;
  try {
    const started = Date.now();
    const result = await mcpCall("http://mcp.invalid/mcp", "search", { q: "x" }, {}, new AbortController().signal, { skipInitialize: true });
    assert.equal(result.content[0].text, "proxied");
    assert.ok(Date.now() - started < 1000, "the proxy path must not buffer until EOF");
  } finally {
    proxy.closeAllConnections?.();
    await new Promise((resolve) => proxy.close(resolve));
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});
