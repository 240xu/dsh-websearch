// tests/parse.test.js — unit tests for the pure parse functions of each backend.
// Run: node --test tests/parse.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseParallelResult } from "../lib/backends/parallel.js";
import { parseExaResult } from "../lib/backends/exa.js";
import { parseDdgHtml } from "../lib/backends/ddg.js";
import { parseOpenAIResponses } from "../lib/backends/openai.js";
import { mapAnthropicResponse } from "../lib/backends/anthropic-like.js";

test("parseParallelResult: JSON-string text → sources", () => {
  const inner = JSON.stringify({
    search_id: "s1",
    results: [
      { url: "https://a.com", title: "A", publish_date: null, excerpts: ["snippet A"] },
      { url: "https://b.com", title: "B", publish_date: "2024-01-01", excerpts: [] },
    ],
  });
  const result = { content: [{ text: inner }] };
  const got = parseParallelResult(result, 8);
  assert.equal(got.length, 2);
  assert.equal(got[0].url, "https://a.com");
  assert.equal(got[0].snippet, "snippet A");
  assert.equal(got[0].title, "A");
  assert.equal(got[1].publishedAt, "2024-01-01");
  assert.equal(got[1].snippet, undefined);
});

test("parseParallelResult: empty/non-JSON → []", () => {
  assert.deepEqual(parseParallelResult({}, 8), []);
  assert.deepEqual(parseParallelResult({ content: [] }, 8), []);
  assert.deepEqual(parseParallelResult({ content: [{ text: "not-json" }] }, 8), []);
});

test("parseParallelResult: caps at maxResults", () => {
  const inner = JSON.stringify({
    results: Array.from({ length: 20 }, (_, i) => ({
      url: `https://x${i}.com`,
      title: "x",
      excerpts: [],
    })),
  });
  const got = parseParallelResult({ content: [{ text: inner }] }, 5);
  assert.equal(got.length, 5);
});

test("parseExaResult: human-readable text blocks → sources", () => {
  const block1 = [
    "Title: Node.js 24",
    "URL: https://nodejs.org",
    "Published: 2025-04-22",
    "Author: Node",
    "Highlights:",
    "  - Faster startup",
    "  - New fetch",
  ].join("\n");
  const block2 = [
    "Title: Deno 2",
    "URL: https://deno.com",
    "Highlights:",
    "  - One thing",
  ].join("\n");
  const text = block1 + "\n\n---\n\n" + block2;
  const got = parseExaResult({ content: [{ text }] }, 8);
  assert.equal(got.length, 2);
  assert.equal(got[0].url, "https://nodejs.org");
  assert.equal(got[0].title, "Node.js 24");
  assert.equal(got[0].publishedAt, "2025-04-22");
  assert.equal(got[0].snippet, "Faster startup … New fetch");
  assert.equal(got[1].url, "https://deno.com");
  assert.equal(got[1].snippet, "One thing");
});

test("parseExaResult: skips blocks without URL", () => {
  const text = "Title: bad\n\n---\n\nURL: https://ok.com\nTitle: OK";
  const got = parseExaResult({ content: [{ text }] }, 8);
  assert.equal(got.length, 1);
  assert.equal(got[0].url, "https://ok.com");
});

test("parseDdgHtml: extracts uddg-decoded urls, titles, snippets", () => {
  const enc = encodeURIComponent("https://example.com/post");
  const html = [
    '<div class="result">',
    `  <a class="result__a" href="//duckduckgo.com/l/?uddg=${enc}&rut=abc">Example <b>Post</b></a>`,
    `  <a class="result__snippet" href="x">This is a snippet about it</a>`,
    "</div>",
  ].join("\n");
  const got = parseDdgHtml(html, 8);
  assert.equal(got.length, 1);
  assert.equal(got[0].url, "https://example.com/post");
  assert.equal(got[0].title, "Example Post");
  assert.equal(got[0].snippet, "This is a snippet about it");
});

test("parseDdgHtml: empty body → []", () => {
  assert.deepEqual(parseDdgHtml("", 8), []);
});

test("mapAnthropicResponse: result blocks + citation snippets", () => {
  const response = {
    content: [
      {
        type: "web_search_tool_result",
        content: [
          { type: "web_search_result", url: "https://a.com", title: "A", page_age: "2024-01-01" },
          { type: "web_search_result", url: "https://b.com", title: "B" },
        ],
      },
      {
        type: "text",
        text: "Some answer",
        citations: [{ url: "https://a.com", cited_text: "quoted A text" }],
      },
    ],
  };
  const got = mapAnthropicResponse(response, "deepseek");
  assert.equal(got.sources.length, 2);
  assert.equal(got.sources[0].snippet, "quoted A text");
  assert.equal(got.sources[0].publishedAt, "2024-01-01");
  assert.equal(got.sources[1].snippet, undefined);
});

test("mapAnthropicResponse: throws when no result block", () => {
  assert.throws(
    () => mapAnthropicResponse({ content: [{ type: "text", text: "x" }] }, "deepseek"),
    /no web_search_tool_result blocks/,
  );
});

test("mapAnthropicResponse: dedupes by url", () => {
  const response = {
    content: [
      {
        type: "web_search_tool_result",
        content: [
          { type: "web_search_result", url: "https://a.com", title: "A1" },
          { type: "web_search_result", url: "https://a.com", title: "A2" },
          { type: "web_search_result", url: "https://b.com", title: "B" },
        ],
      },
    ],
  };
  const got = mapAnthropicResponse(response);
  assert.equal(got.sources.length, 2);
});

test("parseOpenAIResponses: url_citation annotations → sources", () => {
  const json = {
    output: [
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: "Answer with link",
            annotations: [
              { type: "url_citation", url: "https://a.com", title: "A", start_index: 0, end_index: 6 },
              { type: "url_citation", url: "https://b.com", title: "B", start_index: 7, end_index: 9 },
            ],
          },
        ],
      },
    ],
  };
  const got = parseOpenAIResponses(json, 8);
  assert.equal(got.length, 2);
  assert.equal(got[0].snippet, "Answer");
  assert.equal(got[1].snippet, "wi");
  assert.equal(got[0].title, "A");
});

test("parseOpenAIResponses: dedupes by url, caps maxResults", () => {
  const json = {
    output: [
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: "x",
            annotations: Array.from({ length: 10 }, (_, i) => ({
              type: "url_citation",
              url: `https://u${i}.com`,
              title: "t" + i,
            })),
          },
        ],
      },
    ],
  };
  const got = parseOpenAIResponses(json, 3);
  assert.equal(got.length, 3);
});
