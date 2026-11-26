// 2.8.2 P1 回归：零结果不伪造失败 / limiter 同步抛出不死锁 / exa category 门控
import { test } from "node:test";
import assert from "node:assert/strict";

test("零结果：全部后端成功但 0 命中 → 正常返回空 sources，不抛 all-backends-failed", async () => {
  const { createUnifiedSearchProvider } = await import("../lib/provider.js");
  const okEmpty = {
    available: () => true,
    search: async () => ({ sources: [], content: undefined, truncated: false }),
  };
  const provider = createUnifiedSearchProvider({
    ctx: {},
    resolveOptions: () => ({ enabledBackends: ["ddg"], numResults: 4, backends: {}, ctx: {}, backendTimeoutMs: 5000 }),
    backends: { ddg: okEmpty },
  });
  const res = await provider.search({ query: "zzqq nonexistent rare phrase", maxResults: 4 }, undefined);
  assert.ok(res, "returns a result");
  assert.deepEqual(res.sources, []);
  // 关键：不是 "all enabled backends failed (0)" 的自相矛盾错误
  assert.doesNotMatch(String(res.content || ""), /all enabled backends failed/);
});

test("limiter：fn 同步抛出时 running 计数不泄漏，后续任务仍可执行（不死锁）", async () => {
  const { createLimiter } = await import("../lib/provider.js");
  const limit = createLimiter(1);
  // 第一个任务同步抛出（baseURL 校验类场景）
  const p1 = limit(() => { throw new Error("sync boom"); });
  await assert.rejects(p1, /sync boom/);
  // 第二个任务必须仍能被调度——原 bug：running 泄漏后永久排队（实测 exit=13）
  const raced = await Promise.race([
    limit(() => Promise.resolve("second ok")),
    new Promise((_r, rej) => setTimeout(() => rej(new Error("HUNG: queue never drained")), 2000)),
  ]);
  assert.equal(raced, "second ok");
});

test("exa：deepCoverage=false 时不得注入 category（默认查询词也一样）", async () => {
  const { exaBackend } = await import("../lib/backends/exa.js");
  let captured;
  const hooks = { recordRequest: (r) => { captured = r.body; } };
  const ac = new AbortController();
  ac.abort(); // 让 mcpCall 立即拒绝，不打真实网络
  await assert.rejects(() => exaBackend.search({ query: "awesome github repos", maxResults: 5, deepCoverage: false }, ac.signal, {}, hooks));
  assert.ok(captured, "recordRequest captured");
  assert.equal(captured.category, undefined, "deepCoverage=false 不得带 category");
  // deepCoverage=true 时允许注入
  let captured2;
  const ac2 = new AbortController();
  ac2.abort();
  await assert.rejects(() => exaBackend.search({ query: "awesome github repos", maxResults: 5, deepCoverage: true }, ac2.signal, {}, { recordRequest: (r) => { captured2 = r.body; } }));
  assert.ok(captured2, "recordRequest captured (deep)");
  assert.equal(typeof captured2.category, "string", "deepCoverage=true 可注入 category");
});

test("multiquery：CJK 分隔符无空格不切实体（和/比较 词内保护）", async () => {
  const { deriveSubQueries } = await import("../lib/multiquery.js");
  // 裸 "和" 在词内：不得切
  assert.deepEqual(deriveSubQueries("柔和光线和自然光"), ["柔和光线和自然光"]);
  assert.deepEqual(deriveSubQueries("和平精英攻略"), ["和平精英攻略"]);
  // 显式空格分隔：可切
  const spaced = deriveSubQueries("苹果 和 香蕉");
  assert.ok(spaced.length >= 2, "spaced 和 splits: " + JSON.stringify(spaced));
  // 顿号分隔不受影响
  const enumed = deriveSubQueries("苹果、香蕉");
  assert.ok(enumed.length >= 2, "顿号 splits: " + JSON.stringify(enumed));
});

test("shapeQuery：寒暄独词整形为空 → provider 早拒（不入扇出/缓存）", async () => {
  const { shapeQuery } = await import("../lib/prompting.js");
  assert.equal(shapeQuery("搜索"), "");
  assert.equal(shapeQuery("search"), "");
  const { createUnifiedSearchProvider } = await import("../lib/provider.js");
  let fanout = 0;
  const spy = { available: () => true, search: async () => { fanout++; return { sources: [] }; } };
  const provider = createUnifiedSearchProvider({
    ctx: {},
    resolveOptions: () => ({ enabledBackends: ["ddg"], numResults: 4, backends: {}, ctx: {}, backendTimeoutMs: 5000 }),
    backends: { ddg: spy },
  });
  await assert.rejects(() => provider.search({ query: "搜索", maxResults: 4 }, undefined),
    (err) => err.code === "WEB_PROVIDER_ERROR" && /empty query/.test(err.message));
  assert.equal(fanout, 0, "空查询不得扇出任何后端");
});
