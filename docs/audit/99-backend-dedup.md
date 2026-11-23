# 99 · 13 个 backend 的重复模式审计（P3 骨架 → Lead 结构化对比补完，2026-11-23）

> P3 专家落盘 48 行骨架后未补完；Lead 用**阶段矩阵 + 归一化行比对**补完。
> 结论：13 个 backend **确实分两类且各自高度同构**（A 类骨架占比 68%），但**合并收益被风险抵消**——建议只做「提取 headers/auth 两个小 helper」，不做大合并。

## 1. 13 个文件的阶段矩阵

| file | fetch | webErrorFromResponse | redirect:error | resolveApiKey | hooks | parseFn |
| --- | --- | --- | --- | --- | --- | --- |
| anthropic-like.js (254) | 2 | 2 | 1 | 2 | 6 | 0 |
| brave.js (106) | 2 | 2 | 1 | 2 | 0 | 1 |
| ddg.js (145) | 2 | 3 | 1 | 0 | 2 | 1 |
| **exa.js (122)** | **0** | 0 | 0 | 0 | 2 | 1 |
| **firecrawl.js (127)** | **0** | 0 | 0 | 3 | 2 | 1 |
| mojeek.js (109) | 2 | 2 | 1 | 2 | 0 | 1 |
| openai.js (173) | 2 | 2 | 1 | 2 | 6 | 1 |
| **parallel.js (120)** | **0** | 0 | 0 | 0 | 2 | 1 |
| searxng.js (122) | 2 | 3 | 1 | 1 | 0 | 1 |
| serper.js (121) | 2 | 2 | 1 | 2 | 0 | 1 |
| tavily.js (123) | 2 | 2 | 1 | 2 | 0 | 1 |
| **tinyfish.js (123)** | **0** | 0 | 0 | 3 | 2 | 1 |

⇒ **清晰的两类**：

- **A 类 = JSON-REST 直连（8 个）**：`brave / mojeek / serper / tavily / searxng / ddg / openai / anthropic-like` —— 全部走 `egressFetch` + `webErrorFromResponse` + `redirect:"error"` + `resolveApiKey`。
- **B 类 = MCP over streamable-http（4 个）**：`exa / parallel / firecrawl / tinyfish` —— 全部走 `mcpCall`（无 fetch / 无 helper / 无 redirect）。
- `ddg` 特殊：不用 key（`resolveApiKey` 0 次），但要 HTML 解析。
- `searxng` 特殊：用 `searxngBaseURLs` failover（`resolveApiKey` 1 次但非持有人 key）。

## 2. 重复量化（归一化行比对）

以最小的 `brave.js`（107 行）为模板，把标识符 → `ID`、字面量 → `STR` 归一化后，检查每行是否在至少 2 个其它 A 类 backend 中也出现：

```
brave.js 107 行中：模板骨架 73 行 / 独特 34 行
⇒ 骨架占比 68%
```

`brave.js` ↔ `mojeek.js` 直接 `diff`：66 行差异，但**差异内容全是** endpoint / 常量名 / 错误串 / auth 头 / parse 函数体（见 §6 样例）。

## 3. 共享 helper 的接口设计（最小集，只提 2 个）

**不做 `runJsonBackend` 那种大合并**（会把每个 backend 的响应解析塞进一个巨型 switch，可读性反而下降）。只提两个真正零风险的：

```js
// lib/util/backend-common.js

/** Build the auth header for a keyed REST backend.
 * Different providers differ only in header name and value shape. */
export function authHeaders(kind, apiKey) → Record<string,string>
//   kind: 'bearer' | 'x-subscription-token' | 'x-api-key' | 'query-param'

/** Normalize a thrown network/auth error into the structured contract.
 * Wraps webErrorFromResponse for already-formed Responses and maps raw
 * fetch errors to WEB_PROVIDER_ERROR with a stable message. */
export function toBackendError(label, err) → WebError
```

预计收益：`authHeaders` 合并 6 个 backend 的头构造（每处 3–5 行）→ **约 −18 行**；`toBackendError` 合并 4 处 catch 包装 → **约 −8 行**。**合计约 −26 行。**

## 4. 风险清单（为什么不做大合并）

| 风险 | 具体 | 等级 |
| --- | --- | --- |
| **响应解析必须留原地** | 每个 backend 的 JSON 形态完全不同（Brave `web.results[]` / Tavily `results[]` / Serper `organic[]` / Mojeek `results[]` / OpenAI `annotations` / Anthropic `content blocks`）—— 塞进一个 helper 会变成巨型 switch，比现在更难维护 | 高 |
| **`ddg` 的 `webErrorFromResponse` 在 try 内** | ddg 是 HTML 抓取且 3 次 helper 调用（含 2 处内层），合并会改错误路径 | 中 |
| **`searxng` 有多 baseURL failover** | 它的 fetch 是循环多个实例，不是单次 | 中 |
| **`tinyfish` keyless/keyed 分流** | `skipInitialize: !keyed` + `forceFreshSession: keyed` —— 与其它 B 类不同 | 中 |
| **`firecrawl` limit=8 + `isError` 结果级错误** | 非 HTTP 层错误，helper 覆盖不到 | 中 |
| **81 条测试里 80 条 `assert.match(src,...)`** | 任何行位移/重命名都会让断言失效 | **高** |

## 5. 明确的「不要再合并」边界

1. **每个 backend 的 parse 函数**（`parseBraveResult` / `parseTavilyResult` / …）**必须留在自己文件** —— 格式各异，合并无收益。
2. **`mcpCall` 的 4 个 B 类**（exa/parallel/firecrawl/tinyfish）已共享同一个 `mcp-client.js`，**不需要再抽**。
3. **`anthropic-like.js` 的 254 行**是 content-block 解析，**不要为了"统一"而简化** —— 它的复杂度来自上游协议。
4. **`openai.js` 的 annotations 解析**同理。

## 6. 三批落地方案

| 批 | 内容 | 预计删行 | 风险 | 建议 |
| --- | --- | --- | --- | --- |
| **B2-1** | 抽 `authHeaders(kind, apiKey)`，合并 6 个 A 类 backend 的头构造 | ~−18 | **零**（字符串不变） | ✅ 可做 |
| B2-2 | 抽 `toBackendError(label, err)`，合并 4 处 catch 包装 | ~−8 | 低（错误串要保持逐字一致） | ⚠️ 需核对 4 条源码级断言 |
| B2-3 | 合并 A 类的 fetch/parse 骨架 | ~−60 | **高**（断言大面积失效 + 可读性下降） | ❌ 不建议 |

## 7. 结论（A–E）

- **A**：阶段矩阵是 grep 实测；骨架占比 68% 是归一化行比对。
- **A**：两类分法（8 REST / 4 MCP）与代码事实一致。
- **B**：`authHeaders` 可省 ~18 行且零风险；`toBackendError` 低风险。
- **C**：`B2-3` 大合并能省 ~60 行但会破坏 80 条源码级断言的可定位性。
- **E**：真实维护成本（合并后新加 backend 是否更快）无法量化。

## 8. **追加反证：B2-1 也不做（我上一版估错了）**

我上一版估「`authHeaders` 可省 ~18 行」，实测**这个估算错了**。逐行核对 6 个 A 类 backend 的 auth 构造：

| backend | 现状 | 抽成 helper 后 | 净变化 |
| --- | --- | --- | --- |
| `brave` | `"X-Subscription-Token": apiKey,` | `authHeaders("brave", apiKey)` | 同长度 |
| `serper` | `"X-API-KEY": apiKey,` | `authHeaders("serper", apiKey)` | −1 字符级 |
| `tavily` | `"Authorization": \`Bearer ${apiKey}\`, ` | `authHeaders("bearer", apiKey)` | 同长度 |
| `openai` | `"Authorization": \`Bearer ${apiKey}\`,` | 同上 | 同长度 |
| `mojeek` | `"Authorization": "Bearer " + apiKey,` | 同上 | 同长度 |
| `anthropic-like` | `"x-api-key"` **和** `"authorization"` **双写** | helper 要支持双写 | 更复杂 |

而 `Accept` / `Content-Type` / `User-Agent` 每个 backend 各不相同（Brave 只 `Accept`、Serper 只 `Content-Type`、Tavily 两个都要），**不能一起抽**。

⇒ 所谓「18 行」是把「auth + Accept + Content-Type」整块算了，实际上这些行**各自不同**。真实净收益 **≈ −2 行**（
6 个文件各加一个 `import` 反而更长）。**净收益为负 ⇒ B2-1 也不做。**

## 9. 最终建议：**backend 层不做任何合并**

| 批 | 裁决 |
| --- | --- |
| B2-1 `authHeaders` | ❌ 净收益 −2 行（加 import 抵消） |
| B2-2 `toBackendError` | ❌ 错误串必须逐字一致，4 条断言受影响，收益 ~8 行 |
| B2-3 大合并 | ❌ 破坏 80 条源码级断言的可定位性，收益 ~60 行但风险高 |

**13 个 backend 保持现状**：它们的重复是「协议差异造成的必要重复」，不是设计缺陷。

---
无凭证值写入本文件。
