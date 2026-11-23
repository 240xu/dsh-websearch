# 101 · 代码优化与重构：Lead 独立取证底稿（2026-11-23）

> 用户「开目标模式和多个专家组，优化代码，优化性能，裁剪代码冗余，优化调用逻辑」。
> 四组专家在跑（P1 性能 97 / P2 冗余 98 / P3 backend 99 / P4 client 100）。本文件是 **Lead 自己先跑的实测**，供交叉核对，不是最终裁决。

## 0. 结论先行：性能几乎无可优化空间，冗余只有 2 条真值得动

| 维度 | 实测 | 判定 |
| --- | --- | --- |
| `dedupeSources`（104 条 sources） | **0.042 ms** | 可忽略 |
| `rrfFuse`（13 后端 × 8，k=60） | **0.101 ms** | 可忽略 |
| `cacheKeyFor`（13 后端 + 全 options） | **0.046 ms** | 可忽略；JSON 体积 503 bytes |
| `resolveOptions`（单次 / 13 后端） | **0.036 / 0.039 ms** | 可忽略 |
| `createLimiter(6)` 调度 13 任务 | **151 ms**（理论最优 150 ms） | **调度无浪费**，峰值并发精确 6 |

⇒ 相对**每次搜索 2–8 秒**的网络等待，上面全部加起来不到 **0.25 ms（约 0.005%）**。**性能优化不该动 RRF/dedupe/cacheKey/limiter**——动了只会引入风险、量不出收益。

## 1. 真正的耗时在哪（不在我们控制内）

| 段 | 量级 | 能否优化 |
| --- | --- | --- |
| 后端网络往返（exa/parallel/ddg/tinyfish） | 1.2–7 秒 | 只能靠缓存命中（已实现，TTL 900s）与熔断跳过（已实现） |
| MCP 握手 | **已是 skipInitialize:true**（exa/parallel/firecrawl 全跳过；tinyfish keyless 跳过、keyed 才握手） | 已优化过，无重复空间 |
| telemetry 拼装 | 仅在 `resultTelemetry !== false` 时执行（`provider.js:512`） | 已短路，无浪费 |

## 2. 真正的冗余（我独立确认的，按可做性排序）

### O-1 ✅ 4 处 `history.record` 形状完全相同 → 可提取

`lib/provider.js` 的 `:282`（cache 命中）、`:505`（有结果）、`:552`（成功但 0 结果）、`:581`（全失败）四处结构一致：

```js
history?.record({ query: request?.query, time: Date.now(), resultCount: X, backendsOk: Y, backendsTotal: Z })
```

差异仅 `resultCount` 与 `backendsOk/Total` 的算法。**可提取 `recordHistory(history, query, resultCount, telemetry)`**，预计删 **约 12 行**，零行为变化。

### O-2 ✅ `allTelemetry.filter(t => t.ok).length` 重复 3 次 → 可算一次

`provider.js:509 / 556 / 585`。提到分支外算一次 `okCount`，预计删 **2 行**、省 3 次数组扫描（微不足道，但顺手）。

### O-3 ❌ **不能**合并 `sendJson`（我原本以为可以，实测反证）

| 文件 | 签名 | 响应头 | 守卫 |
| --- | --- | --- | --- |
| `health.js:102` | `send(code, body)` | `application/json` | 无 |
| `history.js:136` | `send(res, code, body)` | `application/json` | 无 |
| `settings-api.js:281` | `sendJson(res, status, payload)` | `application/json; charset=utf-8` + **`cache-control: no-store`** | **`writableEnded` 守卫** |

⇒ 参数签名、响应头、守卫**三者都不同**。合并会让 health/history 获得 `no-store`（改变缓存语义），或让 settings 丢掉 `no-store`（**缓存敏感响应会被浏览器缓存**——这是安全问题，不是风格问题）。**放弃这条。**

### O-4 ✅ 但有一小块**真同构**：`rejectionFor` 的错误体

三个文件都写：

```js
{ ok: false, error: rejection === 503 ? "admission unavailable" : "untrusted request" }
```

`health.js:108`、`history.js:143`、`settings-api.js:83` —— **完全逐字相同**。可提取 `rejectionBody(code)` 到 `trust.js`，预计删 **约 4 行**，零行为变化（字符串不变）。

## 3. 死代码：0 条可安全删（我原本以为有 34 个，实测全部不能删）

扫出 34 个「零外部引用」导出，但逐条对照上游 npm 2.8.4 tarball 后：

| 类别 | 数量 | 判定 |
| --- | --- | --- |
| 上游原有、我们只是新增 export 关键字 | **27** | **不能删**（删了与上游分叉更大，且升级 rebase 时更难） |
| 文件内部仍在用（只是没别处引用） | **7** 中的 6（`parseBraveResult`/`parseDdgHtml`/`parseExaResult`/`RRF_K`/`tokenize`/`sanitizeError`…） | 只需去 `export` 关键字（**但这会让 G5 补丁多 6 段噪声**，收益 < 成本） |
| 完全未定义处以外无引用 | `QUERY_GUIDANCE_EN/ZH`、`isLoopbackHost`、`connectionAdmissionView`、`structuralRejection`、`abortable`、`getBackendBreaker` | **全部是上游 2.8.4 原有**（对照 tarball 各 1 次命中）⇒ 不能删 |

⇒ **死代码裁剪在本项目的净收益为负**：这些「未用」是上游遗留（可能是给宿主/未来扩展留的），删它们会让我们的补丁与上游差异扩大、升级时冲突更多。**建议 0 删除**。

## 4. 巨型函数（真正的结构问题，但不是性能问题）

| 行数 | 位置 | 名字 |
| --- | --- | --- |
| **422** | `provider.js:174` | `createUnifiedSearchProvider` |
| 177 | `client.js:647` | `UnifiedSearchSection` |
| 139 | `backends/anthropic-like.js:37` | `createAnthropicLikeBackend` |
| 132 | `index.js:442` | `apply` |
| 100 | `index.js:323` | `resolveOptions` |
| 91 | `cache.js:72` | `createSearchCache` |

`createUnifiedSearchProvider` 422 行是**唯一值得拆的**（扇出/熔断/缓存/合并/telemetry/错误合成六段可以各自成函数）。但这是**大重构**，81 条测试里有大量 `assert.match(src, ...)` 源码级断言会失效 ⇒ 属 P2，且要用户点头。

## 5. 建议的零风险批次（等专家交叉核对后执行）

| 批次 | 内容 | 预计删行 | 风险 |
| --- | --- | --- | --- |
| **B1** | O-1 `recordHistory` + O-2 `okCount` + O-4 `rejectionBody` | ~18 行 | **零**（字符串/结构都不变） |
| B2 | 拆 `createUnifiedProvider` 的 telemetry 合成段（`provider.js:512-540`）成独立函数 | ~30 行 | 低（要改 1–2 条源码级断言） |
| B3 | 拆 `createUnifiedSearchProvider` 六段 | ~100 行（但总行数可能不变，只是分段） | **高**（大量 `assert.match(src,...)` 失效） |

**B1 我可以现在就做**；B2/B3 等专家回来 + 您点头。

---
无凭证值写入本文件。
