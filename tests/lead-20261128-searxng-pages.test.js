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

test("page-2 failure pauses pagination and a later success clears it", async () => {
  const { resetInstanceCooldowns } = await import("../lib/backends/searxng.js");
  resetInstanceCooldowns();
  let page2Fails = true;
  const pages = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const pageno = Number(url.searchParams.get("pageno"));
    pages.push(pageno);
    if (pageno === 2 && page2Fails) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("upstream failed");
      return;
    }
    const results = Array.from({ length: 10 }, (_, i) => ({
      url: `https://example.com/p${pageno}/${i}`,
      title: `p${pageno}-${i}`,
      content: "snippet",
    }));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ results }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const saved = { HTTP_PROXY: process.env.HTTP_PROXY, HTTPS_PROXY: process.env.HTTPS_PROXY, NO_PROXY: process.env.NO_PROXY };
  const realNow = Date.now;
  let shift = 0;
  delete process.env.HTTP_PROXY;
  delete process.env.HTTPS_PROXY;
  process.env.NO_PROXY = "*";
  try {
    const { port } = server.address();
    const opts = { baseURL: `http://127.0.0.1:${port}`, backendTimeoutMs: 5000, safeSearch: true };
    const request = { query: "paged", maxResults: 20, pageLimit: 2 };
    const first = await searxngBackend.search(request, new AbortController().signal, opts, {});
    assert.equal(first.sources.length, 10, "page 1 survives a page-2 500");
    assert.deepEqual(pages, [1, 2]);

    pages.length = 0;
    const paused = await searxngBackend.search(request, new AbortController().signal, opts, {});
    assert.equal(paused.sources.length, 10);
    assert.deepEqual(pages, [1], "the next search does not probe page 2 again");

    page2Fails = false;
    shift = 61_000;
    Date.now = () => realNow() + shift;
    pages.length = 0;
    const recovered = await searxngBackend.search(request, new AbortController().signal, opts, {});
    assert.equal(recovered.sources.length, 20);
    assert.deepEqual(pages, [1, 2], "an expired pause allows page 2 again");

    pages.length = 0;
    const immediate = await searxngBackend.search(request, new AbortController().signal, opts, {});
    assert.equal(immediate.sources.length, 20);
    assert.deepEqual(pages, [1, 2], "a page-2 success clears the pause");
  } finally {
    Date.now = realNow;
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    resetInstanceCooldowns();
    await new Promise((resolve) => server.close(resolve));
  }
});
