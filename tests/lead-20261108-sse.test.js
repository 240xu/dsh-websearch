// tests/lead-20261108-sse.test.js — behaviour regression for parseEnvelope's
// SSE handling. The function is private, so it is extracted from the real
// source (not re-implemented) and driven with real SSE payloads.
// Run: node --test tests/lead-20261108-sse.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const HERE = new URL(".", import.meta.url);

function loadParseEnvelope() {
  const src = readFileSync(new URL("../lib/util/mcp-client.js", HERE), "utf8");
  const start = src.indexOf("function parseEnvelope(text, expectedId) {");
  const end = src.indexOf("\n}", start) + 2;
  assert.ok(start > 0 && end > start, "parseEnvelope must exist in mcp-client.js");
  const fnSrc = src.slice(start, end);
  const WebError = class extends Error { constructor(m, c) { super(m); this.code = c; } };
  return new Function("WebError", `${fnSrc}; return parseEnvelope;`)(WebError);
}

const parseEnvelope = loadParseEnvelope();
const J = (o) => JSON.stringify(o);

test("SSE: a notification frame before the response no longer breaks parsing", () => {
  const sse = "event: message\ndata: " + J({ jsonrpc: "2.0", id: 99, method: "notifications/message", params: {} })
    + "\n\ndata: " + J({ jsonrpc: "2.0", id: 2, result: { content: [] } }) + "\n\n";
  const r = parseEnvelope(sse, 2);
  assert.equal(r.id, 2);
  assert.ok(r.result);
});

test("SSE: a frame with the wrong id is not returned", () => {
  const sse = "data: " + J({ jsonrpc: "2.0", id: 7, result: { wrong: true } }) + "\n\n";
  assert.throws(() => parseEnvelope(sse, 2), /failed to parse response envelope/);
});

test("SSE: multiple data lines of ONE event are still joined", () => {
  const sse = "data: " + J({ jsonrpc: "2.0", id: 2 }).slice(0, -1)
    + "\ndata: ,\"result\":{\"content\":[]}}\n\n";
  const r = parseEnvelope(sse, 2);
  assert.equal(r.id, 2);
  assert.ok(r.result);
});

test("plain JSON and JSON-RPC batch still work", () => {
  assert.equal(parseEnvelope(J({ jsonrpc: "2.0", id: 2, result: { ok: true } }), 2).result.ok, true);
  const batch = J([
    { jsonrpc: "2.0", id: 1, result: { a: 1 } },
    { jsonrpc: "2.0", id: 2, result: { b: 2 } },
  ]);
  assert.equal(parseEnvelope(batch, 2).result.b, 2);
});

test("garbage still throws the typed error", () => {
  assert.throws(() => parseEnvelope("not json", 2), /failed to parse response envelope/);
});

test("SSE: BOM, CRLF, data:[DONE], event lines and string ids", () => {
  const bom = "\uFEFFdata: " + J({ jsonrpc: "2.0", id: 2, result: { ok: 1 } }) + "\n\n";
  assert.equal(parseEnvelope(bom, 2).result.ok, 1);
  const crlf = "data: " + J({ id: 99, method: "notif" }) + "\r\n\r\ndata: " + J({ id: 2, result: { ok: 2 } }) + "\r\n\r\n";
  assert.equal(parseEnvelope(crlf, 2).result.ok, 2);
  const done = "data: [DONE]\n\ndata: " + J({ id: 2, result: { ok: 3 } }) + "\n\n";
  assert.equal(parseEnvelope(done, 2).result.ok, 3);
  const evt = "event: message\ndata: " + J({ id: 2, result: { ok: 4 } }) + "\n\n";
  assert.equal(parseEnvelope(evt, 2).result.ok, 4);
  // A string id equal to the numeric expectedId is still accepted.
  assert.equal(parseEnvelope(J({ id: "2", result: { ok: 5 } }), 2).result.ok, 5);
  // A missing id is tolerated (JSON-RPC notification-style response).
  assert.equal(parseEnvelope(J({ result: { ok: 6 } }), 2).result.ok, 6);
});

test("plain JSON keeps permissive id handling for stateless MCP endpoints", () => {
  // Stateless endpoints may echo a different (or no) id; the plain-JSON path
  // deliberately returns the parsed envelope, while the SSE path still picks
  // the frame matching expectedId.
  assert.equal(parseEnvelope(J({ id: 7, result: { ok: 1 } }), 2).result.ok, 1);
  assert.equal(parseEnvelope(J({ id: "2", result: { ok: 2 } }), 2).result.ok, 2);
  assert.equal(parseEnvelope(J({ result: { ok: 3 } }), 2).result.ok, 3);
});

// R2 P0-1: collect() must reject (not crash the process) when constructing a
// Response throws inside the "end" event callback. Assert the guard exists
// at source level; a full socket repro lives in 60-review-network.md.
test("egress-fetch collect() guards Response construction", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../lib/util/egress-fetch.js", import.meta.url), "utf8");
  const start = src.indexOf("function collect(res)");
  const end = src.indexOf("\nfunction headersFromRaw", start);
  const body = src.slice(start, end);
  assert.match(body, /res\.on\("end", \(\) => \{/);
  assert.match(body, /try \{/);
  assert.match(body, /catch \(err\) \{\s*reject\(err\);/);
});
