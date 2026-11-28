// tests/lead-20261128-searxng-pages.test.js — pagination under deepCoverage.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { searxngBackend } from "../lib/backends/searxng.js";

test("SearXNG paginates only for breadth and dedupes across pages", async () => {
  const pages = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const pageno = Number(url.searchParams.get("pageno"));
    pages.push(pageno);
    const results = Array.from({ length: 10 }, (_, i) => ({
      url: `https://example.com/${pageno}/${i}`,
      title: `p${pageno}-${i}`,
      content: "snippet",
    }));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ results }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const saved = { HTTP_PROXY: process.env.HTTP_PROXY, HTTPS_PROXY: process.env.HTTPS_PROXY, NO_PROXY: process.env.NO_PROXY };
  delete process.env.HTTP_PROXY;
  delete process.env.HTTPS_PROXY;
  process.env.NO_PROXY = "*";
  try {
    const { port } = server.address();
    const { sources } = await searxngBackend.search(
      { query: "paged", maxResults: 15, deepCoverage: true, pageLimit: 2 },
      new AbortController().signal,
      { baseURL: `http://127.0.0.1:${port}`, backendTimeoutMs: 5000, safeSearch: true },
      {},
    );
    assert.equal(sources.length, 15);
    assert.deepEqual(pages, [1, 2], "stops once 15 sources are collected");
    assert.equal(new Set(sources.map((s) => s.url)).size, 15);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    await new Promise((resolve) => server.close(resolve));
  }
});
