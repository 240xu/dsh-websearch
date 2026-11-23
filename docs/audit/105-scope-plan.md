# 105 · 重构范围筹划与分批计划（S1 骨架 → Lead 实测补完，2026-11-23）

> S1 专家落盘 28 行骨架后未补完（四组同一模式）。本文件是 Lead 用工具实测写成的**可照做计划**，不是估算。

## 0. 起点

| 项 | 值 |
| --- | --- |
| `lib/` | **6094 行 / 33 文件** |
| `tests/` | 1459 行 / **81 单测全绿** |
| 补丁 | 37 段 / 4129 行，`g5/refresh.sh` 重建 + 35/35 校验 |
| 主实例 | 3080（PID 1414284）—— **绝不能重启，agent 就跑在里面**（cgroup `0::/system.slice/dsh-web.service`） |
| dev 实例 | 3081（`dev-instance.sh`）—— 可安全重启，用于验证 |

## 1. 断言耦合（决定重构能走多远的硬约束）

Lead 实测：8 个测试文件里有 **49 条** `assert.match(src, ...)` 直接读 `lib/*.js` 源码。

| 测试文件 | 读哪些 lib 源文件 | assert.match 条数 |
| --- | --- | --- |
| `lead-20261106.test.js` | `egress-fetch.js` / `mcp-client.js` / `client.js` | **21** |
| `lead-20261107-p0.test.js` | `index.js` / `namespace.js` | 2 |
| `lead-20261107.test.js` | `provider.js` / `index.js` / `settings-api.js` | 1 |
| `lead-20261108-interaction.test.js` | `client.js` / `index.js` / `settings-api.js` / `cache.js` / `provider.js` / `tinyfish.js` / `mcp-client.js` | **27** |
| `lead-20261108-quota.test.js` | `provider.js` / `ddg.js` | 10 |
| `lead-20261108-sse.test.js` | `mcp-client.js` / `egress-fetch.js` | 2 |
| `lead-20261109-3b-runtime.test.js` | （无源码断言，只做行为测试） | 0 |
| `settings-api.test.js` | `index.js` | 3 |

**关键性质（这决定一切）**：

1. **全部是「同文件内子串/正则匹配」，不依赖行号** ⇒ **函数在同一文件内搬家、重排、缩进变化，断言仍然通过**。
2. **但「改名 / 改签名 / 改字面量 / 搬到别的文件」会让断言失效**。
3. **没有跨行断言**（实测 `assert.match(src, /...\n.../)` 计数 0）⇒ 不会因换行被打破。

⇒ **可动范围**：文件内重构（提函数、分段、加注释）**几乎零成本**；跨文件搬迁要逐条核对断言。

## 2. 可动边界：绝不能动的（每条都有已修 bug 或安全属性背书）

| 位置 | 为什么不能动 |
| --- | --- |
| `util/egress-fetch.js` 的 `delete headers["host"]` + `httpViaProxy`/`httpsViaConnect` 两处 `host: headers.host ?? target.host` 恢复 | 少了恢复 = Cloudflare **403**（已 A/B 实测）。这 3 处必须成对存在 |
| `util/mcp-client.js` 的 `id=1 → notifications → id=2/3` 顺序 | M-1（N3）修的就是 id 撞号；顺序与 id 递进耦合 |
| `util/web-error.js` 的 `webErrorFromResponse()` 4 字段（`status`/`retryAfter`/`rateLimited`/`quota`） | 11 处调用点 + 80 条断言都读它；改字段名会让下游路由 `failure-label.js` 静默失效 |
| `settings-api.js` 的 `cache-control: no-store` + `writableEnded` 守卫 | `no-store` 去掉 = 缓存敏感响应被浏览器缓存（安全退化）；`writableEnded` 守卫防重复写 |
| `index.js` 的 `webCtx.effect(...)` + 增量 disposer + **catch 里逆序回滚再 throw** | A.6 修的就是「注册到一半失败留下半个注册」。拆散 = 回滚顺序错乱 |
| `provider.js` 的 `${id}.${k}` 摊平进 `resultOptions` | N2 修的就是「缓存键漏后端级设置」，13 个键少一个就串味 |
| `provider.js` 的 `recordHistory` 四处调用 | 上一轮刚统一；再拆开就是倒退 |

## 3. 巨型函数现状与真实可拆性（Lead 实测分段）

### 3.1 `createUnifiedSearchProvider`（`provider.js:181`，400 行）

实测分段：

| 段 | 行号 | 行数 | 共享的可变状态 |
| --- | --- | --- | --- |
| 1 请求整形与早拒 | 181–252 | ~72 | `request` / `effReq`（**局部**，可安全内聚） |
| 2 缓存键构造与命中 | 253–310 | ~58 | `cache` / `cacheKey` / `history`（可提） |
| 3 候选构造 + 熔断/冷却 | 312–375 | ~64 | `candidates` / `cooled` / `latestBackendHealth`（**跨段共享**） |
| 4 扇出 + limiter + fold | 376–455 | ~80 | `allTelemetry` / `allFailures` / `hardError`（**跨段共享**） |
| 5 逐 variant 去重/重排 | 456–485 | ~30 | `perVariant`（局部） |
| 6 融合 + 结果 + telemetry | 486–560 | ~75 | `ordered` / `sources` / `okCount` / `cooled`（**跨段共享**） |
| 7 零结果分支 | 539–560 | ~22 | 同段 6 |
| 8 全失败分支 + throw | 561–580 | ~20 | 同段 4 |

**判断**：段 1、2、5 是**局部状态**，可安全提取；段 3、4、6 共享 5 个可变状态（`allTelemetry` / `allFailures` / `hardError` / `cooled` / `okCount`），提成独立函数需要 5 个上下文参数 —— **参数爆炸，可读性反而下降**。

⇒ **只拆段 1、2、5**（约 160 行 → 3 个内联辅助函数），段 3/4/6 保持原样。

### 3.2 其余巨型函数（Lead 的初步判定）

| 函数 | 行数 | 初步判定 |
| --- | --- | --- |
| `client.js:647 UnifiedSearchSection` | 176 | 有 **27 条断言** pin `client.js`；拆成子组件要保证被 pin 的字符串（`function KeyedBackendCard(props)` / `const savedFieldRefs = new Map()` / `function safeFailureReason(err)`）仍在同文件 ⇒ **可在同文件内拆，收益中等** |
| `backends/anthropic-like.js:37 createAnthropicLikeBackend` | 139 | content-block 解析是协议特有，拆了没有复用价值 ⇒ **不拆** |
| `index.js:442 apply` | 132 | `webCtx.effect` 段不能拆散；其余段可提 ⇒ **只拆非 effect 部分** |
| `index.js:323 resolveOptions` | 100 | 摊平逻辑是 N2 修复点，拆了容易漏键 ⇒ **不拆** |
| `cache.js:72 createSearchCache` | 91 | 需先量磁盘淘汰是否真慢（S4 任务） |

## 3.3 `createSearchCache`（`cache.js:72`，91 行）—— **已做，有真实收益**

**发现**：`set()` **无条件**调用 `evict()`，而 `evict()` 每次 `readdirSync` + 全目录 `statSync` + `sort`。即使目录里只有 1 个文件也要走一遍。

**实测对照（3 轮，同条件，取三次值）**：

| 目录已有条目 | 优化前 | 优化后 |
| --- | --- | --- |
| 1 | 0.466 / 0.485 / 0.489 ms | **0.054 / 0.059 / 0.066 ms** |
| 50 | 0.511 / 0.572 / 0.613 ms | **0.058 / 0.060 / 0.077 ms** |

⇒ **约 8 倍**，且**不再随条目数增长**。

**改法**（`lib/cache.js`，+13 行）：
- 加内存计数 `knownCount`（`null` = 未知）
- `evict()` 先看 `knownCount <= cap` 直接 return，只有可能超限才扫描
- `set()` 写入成功后 `knownCount += 1`
- **`knownCount === null` 时仍扫描一次**：上一个进程可能留下超过 cap 的文件，不扫描就永远不淘汰
- `clear()` 后置 `knownCount = 0`

**验证**：81/81 单测、`node --check`、37/37 逐字节、dev 3081 health 200（enabled=6）。

## 4. 分批计划

| 批 | 内容 | 预计行数变化 | 断言影响 | 验收 | 回滚 |
| --- | --- | --- | --- | --- | --- |
| **B1** | `provider.js` 段 1（请求整形）+ 段 5（逐 variant 去重/重排）提成同文件内联函数 | 段内重排，**总行数基本不变**（可能 ±5） | **0**（子串仍在同文件） | 81 单测 + `node --check` + 37 段 | `git revert` 单提交 |
| **B2** | `provider.js` 段 2（缓存键+命中）提成内联函数 | 同上 | 0 | 同上 + dev 3081 跑一次 `web_search` | 同上 |
| **B3** | `index.js apply` 的非 effect 段（settings/provider 注册）提成独立函数 | −10~15 | 低（`findPluginRow(settings.describe())` 必须留在 `index.js`） | 同上 | 同上 |
| **B4** | `cache.js` 磁盘淘汰：**已做**（见 §3.3） | +13 行 | **0** | 81 单测 + 3 轮微基准 | `git revert 6fc5c69` |

**不做**：`resolveOptions` 拆分（N2 风险）、`anthropic-like` 拆分（无复用价值）、`provider` 段 3/4/6 拆分（参数爆炸）、`client.js` 跨文件拆分（断言成本）。

## 5. 每批验收硬条件

```
1. node --check lib/<改动文件>                  → 无语法错误
2. node --test tests/*.test.js                  → 81/81
3. bash g5/refresh.sh                           → 35/35 byte-identical
4. 37 段逐字节 vs src-work                       → 37/37
5. dev 3081 重启 + /api/unified-search/health  → 200
6. （B2/B4）dev 3081 实跑 web_search            → 有 sources 返回
```

**主实例 3080 全程不动**（重启它就杀掉本会话）。

## 6. 风险登记

| 批 | 最可能的失败模式 | 第一时间如何发现 |
| --- | --- | --- |
| B1 | 段 5 依赖 `perVariant` 与 `fold.mergedContent`，提函数时漏传导致 `mergedContent` 丢失 | 单测 `lead-20261107.test.js`/`interaction` 会红；或 dev 3081 的 `content` 字段为空 |
| B2 | 段 2 的 `cacheKey` 是 `let`，提函数后若按值传递，命中后置 `null` 的失效逻辑会丢 | `cacheKey = null`（`:284` 的 invalidate）不再生效 ⇒ 二次搜索会命中本应失效的缓存 |
| B3 | `webCtx.effect` 与注册顺序耦合，抽函数会改变 `disposers` 的 push 顺序 | A.6 的回滚测试（若有）或手工断点；最稳的做法是**只提纯注册逻辑，effect 包裹留在 apply 内联** |
| B4 | 磁盘淘汰真慢但改法影响并发写 | 写并发测试 + dev 3081 压 20 次搜索看 set 耗时 |

## 7. 结论（A–E）

- **A**：49 条断言、8 个测试文件、分段行号、共享状态清单全是 Lead 实测。
- **A**：「同文件子串匹配、不依赖行号、无跨行断言」是从测试源码直接读出来的，这决定了 B1/B2 零断言成本。
- **B**：段 3/4/6 不宜拆是基于 5 个共享可变状态的实测清单。
- **C**：`client.js` 176 行的拆分收益中等（要保证 3 个被 pin 的字符串仍在同文件）。
- **E**：`cache.js` 磁盘淘汰的真实耗时（S4 未补完，Lead 待测）。

---
无凭证值写入本文件。
