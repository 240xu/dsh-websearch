# 97 · 性能与调用逻辑审计（P1 骨架 → Lead 实测补完，2026-11-23）

> P1 专家落盘 20 行骨架后未补完；Lead 用**真实微基准**补完。全部数字可复现。
> 结论：**性能几乎无优化空间**；真正的"调用逻辑"问题不是速度，是几处结构性冗余。

## 1. 微基准实测（`node --input-type=module` 直接 import 真函数）

| 被测函数 | 真实规模 | 实测耗时 |
| --- | --- | --- |
| `dedupeSources` | 104 条 sources（13 后端 × 8） | **0.042 ms** |
| `rrfFuse` | 13 后端 × 8，k=60 | **0.101 ms** |
| `cacheKeyFor` | 13 后端 + 全 options | **0.046 ms** |
| `resolveOptions` | 单次 / 13 后端全启用 | **0.036 / 0.039 ms** |
| `createLimiter(6)` 调度 13 任务（每个 50ms） | 13 任务 | **151 ms**（理论最优 `50×ceil(13/6)=150` ms，峰值并发精确 6） |

`resultOptions` 的 canonical JSON 体积：**503 bytes**（13 后端 × 5 键 + 8 全局键）。

**合计约 0.25 ms**，相对每次搜索 **2–8 秒**的网络等待 = **约 0.005%**。

⇒ **不该动 RRF / dedupe / cacheKey / limiter**：动了只有风险，量不出收益，且会破坏 81 条测试里大量 `assert.match(src, ...)` 源码级断言。

## 2. 真正的耗时在哪（都不在我们控制内）

| 段 | 量级 | 状态 |
| --- | --- | --- |
| 后端网络往返（exa/parallel/ddg/tinyfish） | 1.2–7 秒 | 只能用缓存命中（TTL 900s，已实现）+ 熔断跳过（已实现）优化 |
| MCP 握手 | **已是 `skipInitialize:true`** | exa / parallel / firecrawl 全跳过；tinyfish keyless 跳过、只有 keyed 才握手（且 `forceFreshSession`）⇒ 稳态无重复握手 |
| telemetry 拼装 | 仅 `resultTelemetry !== false` 时执行 | `provider.js:512` 已短路 |
| `settings.describe()` | 每次 search 一次，0.036 ms | 可忽略；改成缓存反而会引入 stale config 风险（PR #7 的原始 bug） |

## 3. 真正的"调用逻辑"冗余（本节是实际可做的）

### O-1 ✅ 4 处 `history.record` 形状完全相同 → **已提取**（本轮已做）

`provider.js` 的 `:282`（cache 命中）、`:505`（有结果）、`:552`（成功但 0 结果）、`:581`（全失败）。→ `recordHistory(history, query, resultCount, backendsOk, backendsTotal)`。**provider.js 597 → 585 行（−12）**。

### O-2 ✅ `allTelemetry.filter(t => t.ok).length` 重复 3 次 → **已算一次**（本轮已做）

提到扇出结束后算一次 `okCount`，三处复用。**再省 0 行但少 3 次数组扫描**（语义等价）。

### O-4 ✅ `rejectionFor` 的错误体三处逐字相同 → **已提取**（本轮已做）

`health.js:108` / `history.js:143` / `settings-api.js:83` 都写 `{ ok:false, error: rejection === 503 ? "admission unavailable" : "untrusted request" }`。→ `trust.js` 的 `rejectionBody(code)`。**trust.js 179 → 185 行（+6），但三处各 −1 行**。

### O-3 ❌ 合并 `sendJson` **不可做**（我原本以为可以，实测反证）

| 文件 | 签名 | 响应头 | 守卫 |
| --- | --- | --- | --- |
| `health.js:102` | `send(code, body)` | `application/json` | 无 |
| `history.js:136` | `send(res, code, body)` | `application/json` | 无 |
| `settings-api.js:281` | `sendJson(res, status, payload)` | `application/json; charset=utf-8` + **`cache-control: no-store`** | **`writableEnded` 守卫** |

参数签名、响应头、守卫三者全不同。合并会让 health/history 获得 `no-store`（改变缓存语义），或让 settings **丢掉 `no-store`**（缓存敏感响应被浏览器缓存 —— 这是安全退化，不是风格问题）。**放弃。**

## 4. 巨型函数（结构问题，非性能问题）

| 行数 | 位置 | 判定 |
| --- | --- | --- |
| **422** | `provider.js:174 createUnifiedSearchProvider` | 唯一值得拆（扇出/熔断/缓存/合并/telemetry/错误合成六段），但属**大重构**，会让大量源码级断言失效 ⇒ P3，需用户点头 |
| 177 | `client.js:647 UnifiedSearchSection` | UI 组件，拆分风险高收益低 |
| 139 | `backends/anthropic-like.js createAnthropicLikeBackend` | 单文件内聚，不必拆 |
| 132 / 100 | `index.js apply / resolveOptions` | Config 装配，拆分会让 schema↔装配对应关系变难追踪 |

## 5. 已确认**无需优化**（避免后人重复劳动）

1. limiter 调度**已达理论最优**（151ms vs 150ms）。
2. RRF `k=60` 固定常量：改它属于**产品调参**，不是性能优化。
3. `cacheKeyFor` 的 `JSON.stringify` 0.046 ms：不值得做 canonical 序列化优化。
4. `abort` / `timeout` 计时器：成功返回后 `finally` 已清理，无 timer leak（A.7 修完后已测）。
5. `history.record` 的磁盘写：已是 `writeChain` 串行 + 原子 rename。

## 6. 结论（A–E）

- **A**：上述 5 项微基准是本机实测，可复现。
- **A**：O-1/O-2/O-4 已落地，81/81 单测仍全绿，`lib` 6104 → 6098 行。
- **B**：MCP 握手已是 skipInitialize 优化态（代码 + 4 个 backend 实测）。
- **C**：`createUnifiedSearchProvider` 的 422 行是否值得拆，取决于是否愿意改源码级断言。
- **E**：真实生产负载下的 P99（本机无压测环境）。

## 7. 建议

**性能这条线到此为止**：0.25ms vs 2–8s，投入产出比极低。要继续优化，只能往**减少网络往返**方向（缓存命中率、熔断精度），而那两处已经在 2.8.x 里做过。**代码质量**方向的可做项已在 O-1/O-2/O-4 完成，剩下的大头是 422 行函数的拆分，需权衡断言改造成本。

---
无凭证值写入本文件。
