// tests/filters.test.js — normalized filter mapping per backend.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  normalizeFilters,
  recencyToken,
  applyBraveFilters,
  applyTavilyFilters,
  applySerperFilters,
  applySearxngFilters,
  applyDdgFilters,
  safeSearchParams,
} from "../lib/util/filters.js";

test("normalizeFilters: drops unknown keys and invalid values", () => {
  assert.deepEqual(normalizeFilters(null), {});
  assert.deepEqual(normalizeFilters("nope"), {});
  assert.deepEqual(normalizeFilters({ recency: "hour", lang: "en", junk: 1 }), { lang: "en" });
  assert.deepEqual(normalizeFilters({ recency: "week", lang: "  ", region: "US" }), { recency: "week", region: "US" });
});

test("normalizeFilters: trims lang/region, keeps valid recency set", () => {
  assert.deepEqual(
    normalizeFilters({ recency: "day", lang: " zh-CN ", region: " cn " }),
    { recency: "day", lang: "zh-CN", region: "cn" },
  );
});

test("recencyToken: per-backend vocabularies", () => {
  assert.equal(recencyToken("brave", { recency: "day" }), "pd");
  assert.equal(recencyToken("tavily", { recency: "week" }), "week");
  assert.equal(recencyToken("serper", { recency: "month" }), "qdr:m");
  assert.equal(recencyToken("searxng", { recency: "year" }), "year");
  assert.equal(recencyToken("ddg", { recency: "day" }), "d");
  // unsupported backend / unset / bad value
  assert.equal(recencyToken("exa", { recency: "day" }), undefined);
  assert.equal(recencyToken("brave", {}), undefined);
  assert.equal(recencyToken("brave", { recency: "hour" }), undefined);
});

test("applyBraveFilters: freshness/country/search_lang on URL", () => {
  const url = new URL("https://api.search.brave.com/res/v1/web/search?q=test&count=8");
  applyBraveFilters(url, normalizeFilters({ recency: "week", lang: "en", region: "US" }));
  assert.equal(url.searchParams.get("freshness"), "pw");
  assert.equal(url.searchParams.get("country"), "US");
  assert.equal(url.searchParams.get("search_lang"), "en");
});

test("applyBraveFilters: no filters -> URL untouched", () => {
  const url = new URL("https://api.search.brave.com/res/v1/web/search?q=t");
  const before = String(url);
  applyBraveFilters(url, normalizeFilters({}));
  assert.equal(String(url), before);
});

test("applyTavilyFilters: time_range body field", () => {
  const body = { query: "x", max_results: 8 };
  applyTavilyFilters(body, normalizeFilters({ recency: "month" }));
  assert.equal(body.time_range, "month");
});

test("applySerperFilters: tbs + hl + gl", () => {
  const body = { q: "x", num: 8 };
  applySerperFilters(body, normalizeFilters({ recency: "year", lang: "zh-CN", region: "CN" }));
  assert.equal(body.tbs, "qdr:y");
  assert.equal(body.hl, "zh-CN");
  assert.equal(body.gl, "CN");
});

test("applySearxngFilters: time_range + language params", () => {
  const url = new URL("https://searx.be/search?q=x&format=json");
  applySearxngFilters(url, normalizeFilters({ recency: "day", lang: "zh-CN" }));
  assert.equal(url.searchParams.get("time_range"), "day");
  assert.equal(url.searchParams.get("language"), "zh-CN");
});

test("applyDdgFilters: df form param", () => {
  const p = new URLSearchParams("q=x");
  applyDdgFilters(p, normalizeFilters({ recency: "week" }));
  assert.equal(p.get("df"), "w");
});

test("safeSearchParams: per-backend vocabulary, null when unsupported/undefined", () => {
  assert.equal(safeSearchParams("searxng", true), "1");
  assert.equal(safeSearchParams("searxng", false), "0");
  assert.equal(safeSearchParams("brave", true), "strict");
  assert.equal(safeSearchParams("brave", false), "off");
  assert.equal(safeSearchParams("serper", true), null);
  assert.equal(safeSearchParams("brave", undefined), null);
});
