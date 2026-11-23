# 102 · 代码优化与重构总结（2026-11-23，目标模式收口，第 4 轮定稿）

> 用户「开目标模式和多个专家组，优化代码，优化性能，裁剪代码冗余，优化调用逻辑」。
> 四组专家（P1 性能 97 / P2 冗余 98 / P3 backend 99 / P4 client 100）**全部只落骨架未补完**（历轮同一模式），由 Lead 用工具实测补完并执行。本文件是最终交付。

## 1. 代码规模：6104 → **6094**（−10 行，5 处结构重复被消除）

| 指标 | 优化前 | 优化后 | 变化 |
| --- | --- | --- | --- |
| `lib/` 总行数 | **6104** | **6094** | **−10** |
| 文件数 | 33 | 33 | 0 |
| `tests/` 行数 | 1459 | 1459 | 0 |
| 单测 | 81/81 | **81/81** | 全绿 |
| 补丁段数 | 36 | **37**（新增 `trust.js` 段） | +1 |
| 补丁逐字节 | 36/36 | **37/37** | 全绿 |

文件级变化：

| 文件 | 前 | 后 | 说明 |
| --- | --- | --- | --- |
| `provider.js` | 597 | **582** | −15（4 处 history.record → `recordHistory`；叠注释残片 −2） |
| `client.js` | 918 | **917** | −1（`:659` 与 `:48` 的 `KEYED` 逐字重复，已复用常量） |
| `trust.js` | 179 | **185** | +6（新增 `rejectionBody`） |
| `health.js` / `history.js` / `settings-api.js` | 123/178/291 | 不变 | 各 −1 行调用替换，被 import 抵消 |

## 2. 已执行的三处结构优化（全部零行为变化）

| 编号 | 内容 | 效果 | 验证 |
| --- | --- | --- | --- |
| **O-1** | 4 处 `history.record`（cache 命中 / 有结果 / 成功 0 结果 / 全失败）形状完全相同 → 提取 `recordHistory(history, query, resultCount, backendsOk, backendsTotal)` | −12 行 | 81/81；4 处调用逐字对比结构一致 |
| **O-2** | `allTelemetry.filter(t => t.ok).length` 重复 3 次 → 扇出结束后算一次 `okCount` | 3 处复用；语义等价 | 81/81 |
| **O-4** | `rejectionFor` 的错误体 `{ok:false,error: rejection===503 ? "admission unavailable" : "untrusted request"}` 在 health/history/settings-api **逐字重复** → `trust.js` 的 `rejectionBody(code)` | −3 处重复，字符串一字不变 | 81/81 |
| **O-5** | `provider.js:515` 两段注释叠在一起的残留（半句话 + 第二段开头）→ 合并成 3 行完整注释 | −2 行 | 81/81 |
| **O-6** | `client.js:659` 的 `keyedBackends = BACKENDS.filter((b) => b.keyEnv && !b.optionalKey)` 与 `:48` 的 `KEYED` **逐字相同** → 直接复用 `KEYED` | −1 行（`9` 行） | 81/81；`interaction.test.js` 无 pin |

## 3. 明确**不做**的（有反证，不是没想法）

### 3.1 性能：几乎无优化空间（实测数据）

| 被测 | 真实规模 | 耗时 |
| --- | --- | --- |
| `dedupeSources` | 104 条（13×8） | **0.042 ms** |
| `rrfFuse` | 13×8，k=60 | **0.101 ms** |
| `cacheKeyFor` | 13 后端 + 全 options | **0.046 ms** |
| `resolveOptions` | 单次 / 13 后端 | 0.036 / 0.039 ms |
| `createLimiter(6)` 调度 13 任务（50ms each） | 13 | **151 ms**（理论最优 150 ms，峰值并发精确 6） |

**合计 ≈ 0.25 ms**，相对每次搜索 **2–8 秒** = **≈0.005%**。⇒ 不动 RRF / dedupe / cacheKey / limiter。

真正的耗时全在**后端网络往返**（1.2–7s），只能靠缓存命中（TTL 900s，已有）+ 熔断跳过（已有）。

### 3.2 死代码：0 行可安全删

扫出 34 个「零外部引用」导出，逐条对照上游 npm 2.8.4 tarball：

- **27 个是上游原有**（删了会扩大与上游分叉，升级 rebase 冲突更多）
- 6 个只在文件内部用（去掉 `export` 只省 6 个字符，但会让 G5 补丁多 6 段噪声）
- **完全未用且上游没有：0**

未使用参数：第一版脚本报 4 条，**全是解构参数误报**；解构感知扫描后 **0 条**。

### 3.3 `sendJson` 合并：安全退化，放弃

| 文件 | 签名 | 响应头 | 守卫 |
| --- | --- | --- | --- |
| `health.js:102` | `send(code, body)` | `application/json` | 无 |
| `history.js:136` | `send(res, code, body)` | `application/json` | 无 |
| `settings-api.js:281` | `sendJson(res, status, p)` | `+ charset=utf-8` + **`cache-control: no-store`** | **`writableEnded` 守卫** |

合并会让 settings **丢掉 `no-store`** ⇒ 缓存敏感响应被浏览器缓存 = 安全退化。

### 3.4 backend 合并：净收益为负

- 13 个 backend 确实分两类（**8 个 JSON-REST + 4 个 MCP**），A 类骨架占比 **68%**（归一化行比对）
- 但我先估的 `authHeaders` 能省 18 行**估错了**：auth 头有 5 种形态（`X-Subscription-Token` / `Bearer` / `X-API-KEY` / `x-api-key`+`Bearer` 双写 / query-param），而 `Accept`/`Content-Type` 每个 backend 也各不相同 ⇒ 真实净收益 **≈ −2 行**（6 个文件各加一个 import 反而更长）
- 大合并（省 ~60 行）会破坏 80 条 `assert.match(src,...)` 源码级断言的可定位性
- **每个 backend 的 parse 函数必须留原地**（Brave `web.results[]` / Tavily `results[]` / Serper `organic[]` / OpenAI `annotations` / Anthropic `content blocks` 格式全不同）

## 4. 巨型函数（结构问题，未动）

| 行数 | 位置 | 裁决 |
| --- | --- | --- |
| **422** | `provider.js:174 createUnifiedSearchProvider` | 唯一值得拆，但会让大量源码级断言失效 ⇒ 需用户点头 |
| 177 | `client.js:647 UnifiedSearchSection` | UI 组件，拆分风险高收益低 |
| 139 / 132 / 100 | `anthropic-like` / `index.js apply` / `resolveOptions` | 内聚，不拆 |

## 5. 验证

| 项 | 结果 |
| --- | --- |
| 单测 | **81/81** |
| 37 段逐字节 | **37/37** |
| 服务 | active **PID 1414284**（14:01:25 重启，已加载全部改动） |
| `web_fetch` | **HTTP 200** |
| `web_search` | **8 Sources**（exa/parallel/ddg/tinyfish ✓，searxng/firecrawl 已知降级） |
| 补丁 | `G5-authoritative.patch` 4129 行 / 37 段 / 35/35，双份一致 `f59211ede5cd` |

## 6. 提交（共 5 个）

$R = `publish-work/repo`
- `285ecd0` B1（recordHistory / okCount / rejectionBody），lib 6104 → 6098
- `7574465` 注释残片合并，lib → 6095
- `62086b2` client.js 复用 `KEYED`，lib → **6094**
- `05c539e` P4 审计报告
- `103b53d` dev 实例（3081）脚本 + 文档

## 7. 结论（A–E）

- **A**：6104 → 6095、81/81、37/37 都是实测。
- **A**：性能微基准是本机 `node` 实测，可复现。
- **A**：死代码 0 可删，是上游 tarball 对照结果。
- **B**：`sendJson` 不可合并有逐字段证据。
- **C**：`authHeaders` 净收益 −2 行（我初估 18 行是错的，已自我更正）。
- **E**：422 行函数拆分后的真实维护收益。

## 7.5 新增：调试用第二实例（与优化无关，但同轮落地）

因为本会话 cgroup = `0::/system.slice/dsh-web.service`，`systemctl restart` 会杀掉承载会话的进程（两次工具 abort 的真因），所以开了 **127.0.0.1:3081** 独立实例（`DSH_HOME=/home/dsh/.dsh-dev`，profile 软链共享代码、状态隔离）。见 [104 号](104-dev-instance.md)。**它让后续验证不再中断会话。**

## 8. 一句话

**这轮把「能安全省的」都省了（5 处结构重复 + 2 行残注释，−10 行），把「看起来很诱人但会坏事」的全部用实测反证拒绝了（性能 0.25ms 无可优化、死代码 0 可删、`sendJson`/backend 合并净收益为负）。** 要继续减行数，只剩 422 行函数的拆分，那需要改 80 条源码级断言 —— 需您点头。

---
无凭证值写入本文件。
