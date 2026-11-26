// rrf.test.js — v2.8.0 RRF fusion + multiQuery gate pure-function tests.
import assert from "node:assert/strict";
import { rrfFuse, RRF_K } from "../lib/rrf.js";
import { isComplexQuery, deriveSubQueries, MAX_SUB_QUERIES } from "../lib/multiquery.js";

const u = (url, title) => ({ url, title });

// 1. RRF score semantics: rank r in one list contributes 1/(k+r).
{
  const { fused, scores } = rrfFuse([[u("a"), u("b"), u("c")]]);
  assert.equal(RRF_K, 60);
  assert.equal(fused.map((s) => s.url).join(","), "a,b,c", "single list keeps order");
  assert.ok(Math.abs(scores.get("a") - 1 / 60) < 1e-12);
  assert.ok(Math.abs(scores.get("c") - 1 / 62) < 1e-12);
}

// 2. Cross-list promotion: item in 2 lists beats item in 1 despite worse rank.
{
  const { fused } = rrfFuse([
    [u("a"), u("b"), u("c"), u("d")],
    [u("x"), u("a"), u("y")],
  ]);
  assert.equal(fused[0].url, "a", "2-list item outranks single-list items");
  // a: 1/60 + 1/62 = 0.0328 ; b/c: 1/61 each = 0.0164 ; x: 1/60
}

// 3. Dedupe by URL, first-seen metadata wins.
{
  const { fused } = rrfFuse([
    [u("a", "First Title")],
    [u("a", "Second Title")],
  ]);
  assert.equal(fused.length, 1);
  assert.equal(fused[0].title, "First Title");
}

// 4. Ties keep first-appearance order (stable): p (1/60) and r (1/60, rank 0
//    of list 2) tie; first appearance wins.
{
  const { fused } = rrfFuse([[u("p"), u("q")], [u("r"), u("s")]]);
  assert.equal(fused.map((s) => s.url).join(","), "p,r,q,s");
}

// 5. Degenerate inputs never throw.
{
  assert.deepEqual(rrfFuse([]).fused, []);
  assert.deepEqual(rrfFuse([[], null, undefined, [[{ title: "no-url" }]]]).fused.map((s) => s.url), []);
  assert.equal(rrfFuse([[], []]).fused.length, 0);
}

// 6. Gate: complex true cases.
{
  assert.equal(isComplexQuery("dsh websearch plugin"), false, "short, no separator");
  assert.equal(isComplexQuery(""), false);
  assert.equal(isComplexQuery(undefined), false);
  assert.equal(isComplexQuery("react vs vue which is better"), true, "vs");
  assert.equal(isComplexQuery("webpack and vite difference"), true, "and");
  assert.equal(isComplexQuery("react和vue哪个好"), true, "中文分隔词");
  assert.equal(isComplexQuery("请对比一下这两个框架的优劣"), true, "对比");
  assert.equal(isComplexQuery("x".repeat(61)), true, "length > 60");
}

// 7. Derivation: original always first, mechanical splits, cap 3, dedupe.
{
  assert.deepEqual(deriveSubQueries("react vs vue"), ["react vs vue", "react", "vue"]);
  const d = deriveSubQueries("dsh-websearch 插件如何配置 sftp 和面板联动的细节说明文档很长很长很长很长很长很长很长很长很长很长很长很长");
  assert.equal(d[0].length > 60, true, "original kept verbatim");
  assert.ok(d.length >= 2 && d.length <= MAX_SUB_QUERIES);
  assert.deepEqual(deriveSubQueries("no separator here"), ["no separator here"], "no split -> original only");
  assert.deepEqual(deriveSubQueries(""), []);
  assert.deepEqual(deriveSubQueries(undefined), []);
  // split candidates shorter than 2 chars are dropped
  assert.deepEqual(deriveSubQueries("a and b"), ["a and b"]);
}

console.log("rrf.test.js: all 7 test groups passed");
