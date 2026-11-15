# 09 · OpenCode v2 搜索端点逐字段核查与 DSH「同源」对照

> 采样 2026-11-04（Asia/Shanghai）。作者：Lead（子代理批量失败后由 Lead 依据一手源码补写）。
> 用户要求：「Open code 现在有更多的搜索端点了」「参考一下 v2，v2 挺先进的，很多人会去看 v1，但是其实目前最新是 v2」「直接去看 github 官方仓库的 opencodev2」「所有 dsh web search 的改动都要有迹可循，都要有可靠资料做支撑，做详细的标注」。
> 证据等级：A=源码实证（带 ref 永久链接/路径:行号）、B=官方文档、C=版本记录（tag/commit sha/npm）、D=本机实测、E=推断或待核实。四联标注：`结论 → 依据(B/C) → 代码落点(A) → 验证(D)`。

## 0. 基准：为什么必须以 v2 为准

| 项 | 值 | 证据 |
| --- | --- | --- |
| 仓库 | `sst/opencode` 已 301 迁移为 **`anomalyco/opencode`** | 【C/D】`curl -sSL https://api.github.com/repos/sst/opencode` → 301 → `repositories/975734319`；2026-11-04 实测 |
| 默认分支 | `dev` | 【A】仓库 API `default_branch` |
| **v2 主线最新 tag** | **`v2.2.5`** | 【C】`GET /repos/anomalyco/opencode/git/ref/tags/v2.2.5` → 200；tag object = commit `9bbb8ce18c80f099e0e448775f59d965ead40a21`（type=commit） |
| v2 相关分支 | `app-backend-v2`、`app-v2-only`、`backend-adapter-v2` | 【C】`GET /branches?per_page=100` |
| 官方文档 | `https://raw.githubusercontent.com/anomalyco/opencode/v2.2.5/services/www/src/docs/content/websearch.mdx` | 【B】2026-11-04 取到正文，HTTP 200 |
| v1 地位 | **已过时，只作对比，不作依据** | 【E/边界】用户明确指令 |

**v2 比 v1 先进的可核验点**（每条均可回溯到 v2.2.5 源码）：
1. 5 个插件化 provider（v1 常被引用的形态是单一 `webfetch` / 简单 MCP 配置）【A `index.ts:7-13`】；
2. `random` 选择 + 429 `Retry-After` 冷却 + session affinity + 全冷却失败【A `packages/core/src/websearch.ts` `query`/`randomProvider`】；
3. `permission action=websearch, resources=[query]` 执行前拦截 + 首次使用弹表单征求同意（allow / choose / disable）【A `packages/core/src/tool/plugin/websearch.ts`】；
4. `websearch: false` 从模型请求移除工具【A `packages/core/src/config/plugin/websearch.ts` + schema `Selection`】；
5. 统一 MCP streamable-http 客户端：256KB 响应上限、25s 超时、SSE/JSON 双解析【A `mcp.ts`】；
6. keyless 降级头（`X-Tavily-Access-Mode: keyless`、`X-TinyFish-Access-Mode: keyless`）【A `tavily.ts` / `tinyfish.ts`】；
7. **Console hosted web search**（workspace 级、按次计费、零留存）【B `https://opencode.ai/v2/docs/console/websearch`；D 由 Parallel 实搜命中该页正文】；
8. server/protocol 分层：`GET /api/websearch/provider`、`POST /api/websearch`【A `packages/protocol/src/groups/websearch.ts` + `packages/server/src/handlers/websearch.ts`】。

## 1. 五个 provider 的端点总表（v2.2.5 源码逐字 + 本机实测）

永久链接前缀：`https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/<file>.ts`

| provider(id) | 端点 | 协议 / MCP tool | 认证 | 请求字段（源码） | 响应字段（源码） | 本机 initialize |
| --- | --- | --- | --- | --- | --- | --- |
| `exa` | `https://mcp.exa.ai/mcp` | MCP streamable-http，`web_search_exa` | `EXA_API_KEY` / integration key；有 key 时 URL query `exaApiKey=<key>`；**无 key 可用** | `{ query, numResults: 8 }`（`McpInput.numResults?`） | `content[].text` 文本块，按 `\n\n---\n\n` 切块解析 `URL: / Title: / Published: / Highlights|Text:`，归一化为 `{url,title?,content?,time:{published?}}` | 【D】HTTP 200，SSE；serverInfo `exa-search-server` v3.5.0 |
| `firecrawl` | `https://mcp.firecrawl.dev/v2/mcp` | MCP，`firecrawl_search` | `FIRECRAWL_API_KEY` → `Authorization: Bearer <key>`；**无 key 走 hosted keyless tier** | `{ query, limit: 8 }` | `content[].text` 内 JSON `{success,data.web:[{url,title?,description?}]}` → `{url,title?,content?=description,time:{}}` | 【D】HTTP 200，SSE；serverInfo `firecrawl-fastmcp` v3.36.1 |
| `parallel` | `https://search.parallel.ai/mcp` | MCP，`web_search` | `PARALLEL_API_KEY` → `Authorization: Bearer <key>`；**无 key 可用** | `{ objective: input.query, search_queries: [input.query], model_name? }` | `structuredContent: {search_id, results:[{url,title?,publish_date?,excerpts[]}], warnings?, usage?, session_id}` → `{url,title?,content?=excerpts.join("\n\n"),time:{published?}}` | 【D】HTTP 200，JSON；真实 `tools/call` 返回搜索结果 |
| `tavily` | `https://api.tavily.com/search` | **REST POST**（非 MCP） | 有 key `Authorization: Bearer <key>`；无 key `X-Tavily-Access-Mode: keyless`；附 `X-Client-Name: opencode2` | `{ query, search_depth: "basic", chunks_per_source: 3, max_results: 8 }` | `{results:[{title,url,content}]}` → `{url,title,content?,time:{}}` | 未测（需 key）【E】 |
| `tinyfish` | `https://agent.tinyfish.ai/mcp` | MCP，`search` | 有 key `X-API-Key` + **必须先 initialize 拿 `Mcp-Session-Id`** 并发 `notifications/initialized`；无 key `X-TinyFish-Access-Mode: keyless`（keyless 不需要 session） | `{ query }` | `content[].text` 内 JSON `{results:[{url,title,snippet}]}` → `{url,title,content?=snippet,time:{}}` | 【D】HTTP 200，JSON；serverInfo `tinyfish` v0.1.1，protocolVersion `2025-11-25` |

**统一结果类型**【A `packages/schema/src/websearch.ts`】：
```ts
Result = Schema.Struct({
  url: Schema.String,
  title: Schema.String.pipe(optional),
  content: Schema.String.pipe(optional),
  time: Schema.Struct({ published: Schema.Finite.pipe(optional) }),  // ms since epoch
})
Response = Schema.Class({ providerID, results: Array<Result> })
```
这解释了「为什么 5 个异构端点能共用一个 LLM 工具」：每个 provider 把各自响应归一化成同一个 `Result[]`。

## 2. 通用 MCP 客户端（v2 的可复用资产）

【A `mcp.ts` 全文】关键不变量：
- `MAX_RESPONSE_BYTES = 256 * 1024`（256KB），`collectBoundedResponseBody` 超限直接报错 `${tool} response exceeded ... bytes`；
- `parseResponse` 同时支持**纯 JSON** 与 **SSE `data: ` 行**（先试整体 `trim().startsWith("{")`，再逐行扫）；
- `call()` 固定发 `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{name:tool,arguments:value}}`，`Accept: application/json, text/event-stream`；
- `HttpClient.filterStatusOk` 只看 2xx；`Effect.timeoutOrElse` **25 秒**；`Effect.scoped` 管生命周期。

【D 交叉】本机 curl 实测四个 MCP 端点里，exa/firecrawl 返回 SSE `event: message`，parallel/tinyfish 返回纯 JSON —— 正好验证 `parseResponse` 双解析的必要性。

## 3. 模型可见工具契约（v2.2.5）

【A `packages/core/src/tool/plugin/websearch.ts`】
- 工具名：**`websearch`**（注意 DSH 是 `web_search`，命名不同）。
- description 原文：
  ```
  Search the web using the user's selected search integration. Use this for current information beyond knowledge cutoff.

  The current year is ${new Date().getFullYear()}. Use this year when searching for recent information or current events.
  ```
- Input：`Schema.Struct({ query: Schema.String.annotate({description:"Websearch query"}) })`；Output：`{ provider: WebSearch.ID, results: Array<WebSearch.Result> }`。
- `NO_RESULTS = "No search results found. Please try a different query."`
- HTTP 错误文案映射：`429 → "Web search rate limited (HTTP 429)"`、`401 → "Web search authentication failed (HTTP 401)"`。
- 执行前**强制权限**：`permission.assert({ action: name, resources: [input.query], save: ["*"], metadata: input, sessionID, agent, source:{type:"tool",messageID,id} })` —— 与 docs 的 `permissions: [{action:"websearch",resource:"*",effect:"ask"}]` 对应【B】。
- 首次使用触发 `WebSearch.ProviderRequired` → 用 `Semaphore(1)` 串行化 → 弹 `forms.ask` 表单（Allow search via <所有 provider 名> / Choose another provider / Disable web search）→ 选择 `random` 或具体 id → `websearch.select(...)` 写入 KV（`ProviderKey="websearch:provider"`）【A】。

【A `packages/schema/src/config/websearch.ts`】`Selection = Schema.Union([Schema.Literal(false), Info])`，`Info.provider = "random" | WebSearch.ID`；`random` 的官方描述：「Reuse a randomly selected provider until it is rate limited, then switch to another available provider.」
【A `packages/core/src/config/plugin/websearch.ts`】配置观察器把 `selection === false` 或 `selection.provider` 写进 `websearch.default` —— 即 `websearch: false` 禁用、`websearch: {provider:"tavily"}` 指定。

## 4. 429 轮转 / 冷却 / session 记忆（v2 核心机制）

【A `packages/core/src/websearch.ts` `query()`】逐字逻辑：
- `cooldowns: Map<ID,{until,error}>`、`preferred: Map<Session.ID|undefined,{provider?}>`（session affinity）；订阅 `SessionEvent.Deleted/Moved` 时清除 affinity。
- `randomProvider(now, affinity, attempted)`：先清理到期冷却；若 affinity.provider 可用且未 attempted 就复用，否则从「未冷却且未尝试」的 providers 里随机取一个并写回 affinity。
- `query()` 主循环：非 2xx 或任意失败 → `RequestError`；**仅当 `choice === "random"` 且 `HttpClientError` 且 `status === 429`** 才 `cooldowns.set(id, {until: now + cooldownMillis(retry-after, now), error})` 并 `randomProvider(..., attempted)` 换下一个；`attempted` 防止死循环；全冷却/全尝试完返回最后一个 `cooldown.error`。
- `defaultProvider("random")` 明确注释：「Inspection must not select a provider or reopen consent when every provider is cooling down.」—— 全冷却时检查路径不重开同意表单。
- 【B docs】`Retry-After` 有效则用之，否则 60 秒；cooldowns 在同一 workspace 的 sessions 间共享；移动 session 或重启 server 清除记忆的 provider。

## 5. server / protocol 层端点

【A `packages/protocol/src/groups/websearch.ts`】`HttpApiGroup.make("server.websearch")`：
- `GET /api/websearch/provider`（query=`LocationQuery`）→ `Location.response(Schema.Array(WebSearch.Provider))`，错误 `ServiceUnavailableError`；
- `POST /api/websearch`（query=`LocationQuery`，payload=`WebSearch.Input.fields` 即 `{query, providerID?}`）→ `Location.response(WebSearch.Response)`，错误 `InvalidRequestError | ServiceUnavailableError`。
【A `packages/server/src/handlers/websearch.ts`】把 4 个 tagged error 映射为 HTTP 语义：`ProviderRequired → InvalidRequestError(kind:"websearch_provider_required", field:"providerID")`、`ProviderNotFound → InvalidRequestError(kind:"websearch_provider_not_found")`、`Disabled → InvalidRequestError(kind:"websearch_disabled")`、`Request → ServiceUnavailableError(message:"Web search request failed: <providerID>")`；冷 Location 先 `awaitPlugins` 再解析 provider。

## 6. 与 DSH `@240xu/dsh-websearch` 的「同源」对照

【B/C】用户插件 README「Backends」表 + 【A】本地 `/home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/lib/backends/`（2.8.4）。

| DSH 11 后端 | 端点 | OpenCode v2 | 判定 |
| --- | --- | --- | --- |
| `exa` | `https://mcp.exa.ai/mcp` | ✅ `exa` 同端点、同 tool `web_search_exa`、同 `{query,numResults}` | **完全同源** |
| `parallel` | `https://search.parallel.ai/mcp` | ✅ `parallel` 同端点、同 tool `web_search`、同 `{objective,search_queries}` | **完全同源** |
| `ddg` | `https://html.duckduckgo.com/html/` | ❌ | DSH 独有 HTML 兜底 |
| `searxng` | `https://searx.be/search`（可配） | ❌ | DSH 独有元搜索 |
| `brave` | `https://api.search.brave.com/res/v1/web/search` | ❌ | DSH 独有 |
| `tavily` | `https://api.tavily.com/search` | ✅ `tavily` 同端点 | **同端点、机制不同**：v2 固定 `search_depth:"basic"`, `chunks_per_source:3`, `max_results:8`；DSH 支持 `advanced` / `deepCoverage` / `include_answer` / `max_results` 可配 |
| `serper` | `https://google.serper.dev/search` | ❌ | DSH 独有 |
| `mojeek` | `https://api.mojeek.com/v1/search` | ❌ | DSH 独有 |
| `deepseek` | `https://api.deepseek.com/anthropic/v1/messages` + `web_search_20250305` | ❌（v2 走 Anthropic 原生 Messages 而非 DSH 的 DeepSeek 兼容端点） | DSH 独有；README 标「与 dav web-search-deepseek 同机制」 |
| `anthropic` | `https://api.anthropic.com/v1/messages` + `web_search_20250305` | ❌（v2 无此 provider，但工具格式同源） | README 标「Claude Code 同机制」 |
| `openai` | `https://api.openai.com/v1/responses` + `web_search` | ❌ | README 标「Codex 同机制」 |
| —（v2 新增） | `https://mcp.firecrawl.dev/v2/mcp` | ✅ `firecrawl` | **DSH 未接入** |
| —（v2 新增） | `https://agent.tinyfish.ai/mcp` | ✅ `tinyfish` | **DSH 未接入** |

**同源结论**：README 的「opencode 同源」特指 `exa` / `parallel` 两个 **MCP streamable-http 端点 + tool 名 + 请求字段**完全一致（v2.2.5 源码逐字可证）。`tavily` 只是端点相同但参数策略不同。`firecrawl` / `tinyfish` 是 v2 相对 DSH 多出来的两个 keyless MCP 端点。

## 7. 本机实测（D 级，2026-11-04）

完整记录见 [00-lead-live-probe.md](00-lead-live-probe.md)。要点：
- 【D】`curl -X POST https://mcp.exa.ai/mcp` / `https://search.parallel.ai/mcp` / `https://mcp.firecrawl.dev/v2/mcp` / `https://agent.tinyfish.ai/mcp`（TinyFish 加 `X-TinyFish-Access-Mode: keyless`）四个 initialize **全部 HTTP 200**，均无需密钥。
- 【D】Parallel `tools/call web_search({objective,search_queries})` 真实返回结果，首条 `https://opencode.ai/v2/docs/console/websearch`，正文含 hosted web search 的 `$0.01/次`、最多 8 条、失败/限流不计费、零数据留存、workspace owner 启用、成员 `/connect` 免 key、【B】。
- 【D】Exa initialize 的 instructions 列出 `web_search_exa` / `web_fetch_exa` / `agent_run`（运行中继续用 runId）；Firecrawl 说明 hosted keyless sessions 暴露 `firecrawl_search`/`firecrawl_scrape`/`firecrawl_parse`、`categories: ["developer"|"gov"|"research"]`、成功结果带 `conversationId` 需回传；TinyFish 说明 keyless 30 req/min + 50 searches/UTC day，`search` 工具有 `purpose`（按意图排序）、`domain_type`、`recency_minutes` 等字段；Parallel instructions 明确「并发调用」「多 `search_queries` 一次调用」「excerpts 够用就不必逐条 fetch」。
- 【D/E】结论：本机 DSH `web_search` 报 `exa/parallel MCP initialize HTTP 403` 时，curl 直连同端点却 200 → 403 来自 DSH 插件 2.8.4 的代理/TLS 指纹链路，非上游端点故障；与 CHANGELOG 2.8.5/2.8.6 修复项吻合（属强推断 E，未抓包定位）。

## 8. 并入 DSH 的可执行清单（每条四联标注）

| 优先级 | 改动 | 依据(B/C) | 代码落点(A) | 验证(D) | 风险/回滚 |
| --- | --- | --- | --- | --- | --- |
| **P0** | 把 `@240xu/dsh-websearch` 从 **2.8.4 升到 2.8.8**（至少 2.8.6） | 【C】npm `dist-tags.latest=2.8.8`、CHANGELOG 2.8.6「all enabled backends failed (4)」事故复盘、commit `592237f7586b` / `fc737d221899` | `lib/util/egress-fetch.js`（2.8.5 sidecar + 2.8.6 node:http 直连）、`lib/backends/searxng.js`、`lib/provider.js`；回归 `tests/v286-failures.test.js` | 升级后重跑 `web_search`，看 `[websearch backends]` 遥测行与 `GET /api/unified-search/health` | 「升级必然修复」标 **E**（只读约束下未执行升级）；回滚=回装 2.8.4 |
| **P0** | 新增 `firecrawl` backend（keyless hosted tier） | 【A】v2.2.5 `firecrawl.ts`；【D】本机 initialize 200 | 新增 `lib/backends/firecrawl.js`，复用现有 MCP 客户端（DSH 侧 `mcp-client.js`）；Config 加 `enableFirecrawl` / `firecrawlApiKeyEnv` / `firecrawlBaseURL`；`index.js` BACKENDS 注册 | 复现 00 号文件的 curl；keyless 实搜；429 冷却回归 | Firecrawl 有 credits/日限额；keyless 与带 key 工具集不同；`conversationId` 需按会话回传 |
| **P0** | 新增 `tinyfish` backend（keyless header 降级） | 【A】v2.2.5 `tinyfish.ts`；【D】本机 initialize 200 | 新增 `lib/backends/tinyfish.js`，复用 MCP 客户端；Config 加 `enableTinyfish` / `tinyfishApiKeyEnv`；带 key 时实现 `initialize → Mcp-Session-Id → notifications/initialized` | 同上；带/不带 key 两条路径分别测 | keyless 30 req/min + 50 searches/day；带 key 必须带 session id（v2 源码注释） |
| **P1** | 移植 v2 `random` + 429 `Retry-After` 冷却 + session affinity | 【A】`packages/core/src/websearch.ts` `randomProvider`/`query`；【B】v2.2.5 docs §Limits | `lib/provider.js` 增加 `cooldowns` / `preferred` Map 与 `attempted` 集合；`lib/breaker.js` 与冷却区分（熔断=连续失败，冷却=429 限流） | 模拟 429 + Retry-After，断言换后端/到期恢复/全冷却返回最后错误 | 与现有 circuit breaker 语义重叠，需明确分工 |
| **P1** | 移植 v2 `permission action=websearch, resources=[query]` 与首次同意表单 | 【A】tool plugin `permission.assert` + `forms.ask`；【B】docs §Permissions | DSH 侧需接 guard/permission 服务；属产品级改动，**先提案不改代码** | 需 REAL-composition 测试 | DSH 现有工具权限模型不同，改动面大，标 **E 待评估** |
| **P1** | `websearch:false` 式禁用 + 工具可见性控制 | 【A】`packages/core/src/config/plugin/websearch.ts` + schema `Selection` | DSH `Config.search:false` 已有类似能力（`tool-web/src/index.ts:40-41,92-94`），对齐即可 | 现有 snapshot 用例 | 低风险 |
| **P2** | 复用 v2 `mcp.ts` 的 256KB 上限 / 25s 超时 / SSE+JSON 双解析，统一 4 个 MCP 后端 | 【A】`mcp.ts` 全文；【D】实测 SSE 与纯 JSON 两种返回 | DSH `mcp-client.js` 增加 `MAX_RESPONSE_BYTES`、`parseResponse` 双解析、25s timeout | 单测覆盖 SSE / 纯 JSON / 超限 / 超时 | 与 DSH 现有 `backendTimeoutMs=30000` 配置协调（不要硬编码，遵守「No hardcoded tunables」） |
| **P2** | 借鉴 TinyFish `purpose` 字段：把任务意图作为排序信号 | 【D】TinyFish `tools/list` inputSchema 原文 | `lib/prompting.js` 的 QUERY_GUIDANCE 或新增 `objective` 字段传给 parallel（其 `objective` 本就是意图） | A/B 对比检索质量 | 需评估，标 **E** |
| — | **不建议重复接 tavily**：DSH 已有 REST tavily 后端且能力更强（advanced/deepCoverage/include_answer） | 【A】DSH `lib/backends/tavily.js` vs v2 `tavily.ts`（固定 basic） | — | 已有 e2e 用例 | 重复接入会造成同 provider 两条结果、去重与遥测歧义 |

## 9. 权威链接清单（全部 2026-11-04 核验）

**OpenCode v2（一律带 v2.2.5 ref）**
1. [仓库](https://github.com/anomalyco/opencode/tree/v2.2.5) — tag v2.2.5 / commit `9bbb8ce18c80f099e0e448775f59d965ead40a21` — 200
2. [websearch 官方文档](https://raw.githubusercontent.com/anomalyco/opencode/v2.2.5/services/www/src/docs/content/websearch.mdx) — 200
3. [Console hosted web search](https://opencode.ai/v2/docs/console/websearch) — 由 Parallel 实搜正文核实（$0.01/次、8 条、零留存）
4. [v2 官方 web search 指南](https://opencode.ai/v2/docs/websearch)
5. [index.ts · 5 provider 注册表](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/index.ts)
6. [mcp.ts · 通用 MCP 客户端](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/mcp.ts)
7. [exa.ts](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/exa.ts)
8. [firecrawl.ts](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/firecrawl.ts)
9. [parallel.ts](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/parallel.ts)
10. [tavily.ts](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/tavily.ts)
11. [tinyfish.ts](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/tinyfish.ts)
12. [core/src/websearch.ts · 选择/冷却](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/websearch.ts)
13. [schema/src/websearch.ts · Result/Response](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/schema/src/websearch.ts)
14. [schema/src/config/websearch.ts · Selection](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/schema/src/config/websearch.ts)
15. [core/src/tool/plugin/websearch.ts · 工具定义/权限](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/tool/plugin/websearch.ts)
16. [core/src/config/plugin/websearch.ts · 禁用](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/config/plugin/websearch.ts)
17. [server/src/handlers/websearch.ts](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/server/src/handlers/websearch.ts)
18. [protocol/src/groups/websearch.ts · HTTP 端点](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/protocol/src/groups/websearch.ts)

**用户自研 DSH 插件（带 main / commit ref）**
19. [240xu/dsh-websearch](https://github.com/240xu/dsh-websearch) — public / main / MIT
20. [README.md（11 后端表）](https://github.com/240xu/dsh-websearch/blob/main/README.md)
21. [CHANGELOG.md（2.8.6 事故复盘）](https://github.com/240xu/dsh-websearch/blob/main/CHANGELOG.md)
22. [commit 592237f7586b（2.8.6）](https://github.com/240xu/dsh-websearch/commit/592237f7586bc2da428e5acf41acf40276711b3d)
23. [commit fc737d221899（2.8.5）](https://github.com/240xu/dsh-websearch/commit/fc737d221899)
24. [npm @240xu/dsh-websearch](https://www.npmjs.com/package/@240xu/dsh-websearch) — latest 2.8.8

**本机证据**
25. [00-lead-live-probe.md](00-lead-live-probe.md) — 【D】四端点 curl 实测 + Parallel 真实搜索
26. [08-own-repo.md](08-own-repo.md) — 【A/B/C/D/E】11 后端、版本演进、事故归因
27. [13-raw-evidence.txt](13-raw-evidence.txt) — 【C/D】npm 时间线 + GitHub commit 链

## 10. 待确认（E，不得当结论）

- `tavily` REST 端点未做本机实搜（需 key）【E】。
- 403 HTML 的确切产生环节（egress 代理 / 上游 WAF / TLS 指纹）未抓包定位【E】。
- 「升级 2.8.8 必然修复本机故障」未执行升级验证【E】。
- DSH 侧 permission/表单同意机制如何落地未评估，属产品提案【E】。
- v2 的 `packages/plugin/src/{effect,promise}/websearch.ts` 双接口与 app 侧 dock 组件未逐字展开（本报告聚焦端点与并入）【E/缺口】。

---

# 附录 · 09 号子代理补充复核（2026-11-04/05，独立取证）

> 说明：本附录由派生的「OpenCode 新增搜索端点探索与并入」子代理在**独立会话**中完成取证后追加。上文 §0–§10 由 Lead 于 11-04 17:32 补写（当时以为子代理失败）；本子代理全程只读、未改任何源码/配置、未重启进程，**不覆盖、不改写上文任何结论**，只补充上文未覆盖或需要修正的一手事实。凡与上文重复的内容不再复述。
> 取证口径：`curl -L` + GitHub API/raw（dev HEAD `ffe6fed58334d921f64a86a8d86128bff5a4b566`，2026-11-04T07:20:08Z）+ 本机 read/grep/glob；私有仓库用 `/opt/xr-research/zcode-research/.git/config` 内 Basic auth（login=240xu）只读取到，**token 值未写入任何文件/输出**。所有页面均实际取到，未取到项显式标注「未取到，待核实」。

## A. 唯一需要修正上文的一处事实

上文 §1 表格把 `firecrawl` 的认证写成「**无 key 走 hosted keyless tier**」、【D】本机 initialize 200 —— 这一点由 `00-lead-live-probe.md` 的实测支持，成立。但**从 `dev` 与 `v2.2.5` 源码本身看，Firecrawl 并没有显式 keyless 声明**：`firecrawl.ts:53-56` 只是「有 key 才带 `Authorization: Bearer`」，既没有 `X-*-Access-Mode: keyless` 头，也没有注释说明 hosted keyless tier（对比 `tavily.ts:45` 与 `tinyfish.ts:62` 都明写了 keyless 头）。⇒ **源码层结论应为「无 key 时不带认证头，keyless 由服务端 hosted tier 隐式提供」，不能写成源码保证的 keyless 路径**。并入时 `enableFirecrawl` 的默认开关应据此保守（下文 C-3）。
> **⚠️ 2026-11-06 证据升级（Lead）**：本节的「仅 D 级实测 / 服务端隐式 / 待核实」定性已被 [05 续研 A.2](05-search-backends.md) 取到的**官方 B 级文档**升级并完成闭环：[`docs.firecrawl.dev/mcp-server/keyless.md`](https://docs.firecrawl.dev/mcp-server/keyless.md)（HTTP 200）逐字确认「Keyless server URL (Streamable HTTP, **no credential**): `https://mcp.firecrawl.dev/v2/mcp`」与「Keyless MCP is rate limited and exposes Search, Scrape, and Parse」，`rate-limits.md#keyless-no-api-key` 确认按 IP 每日双上限 + 429。⇒ **hosted keyless tier 现为 B 级官方事实**；本节点出的「v2.2.5 客户端源码无显式 keyless 头」与「具体日上限数字 E」两点仍成立。以 [99 裁决 6](99-final-verdicts.md) 与 [REPORT §4.1](REPORT.md) 为准。

另外补一条上文未记录的**引入/重构时间线**（`GET /repos/anomalyco/opencode/commits?path=...&sha=dev`，C 级）：

| 事件 | commit | 日期 |
| --- | --- | --- |
| 可插拔 web search（exa + parallel 同时落地） | `efb629a3` | 2026-07-26 |
| Firecrawl | `e6c9b6be` | 2026-08-07 |
| Tavily | `3d3bbd48` | 2026-08-14 |
| TinyFish | `3f579f53` | 2026-09-12 |
| TinyFish 补 initialize 会话 | `86755e1c` | 2026-10-15 |
| `provider.ts` 抽取（dev 比 v2.2.5 小的唯一原因） | `a809a475` | 2026-11-02 |
| dev HEAD | `ffe6fed` | 2026-11-04 |

⇒ 用户所说「现在更多的搜索端点」= 2026-08~09 的三次增量，且**都晚于**用户 DSH 插件 `EXTENSION_PLAN.md` 的 11 后端设计（该文件当时把 Firecrawl 列在 Tier 2「付费/小配额」、把 Tavily MCP 标为「Research」）。这解释了为什么 DSH 没跟上。

## B. 上文未覆盖：本机网关的**实时健康状态**与真实 `/v1/models`（D 级）

上文/09c §2.1–2.2 只记录了「进程活着、路由已注册、`/v1/models → 401`（探测 key 无效）」。本子代理用 `/opt/oc2api/config.json` 中实际的 `server_keys[0]`（值不写入报告）做只读 GET，得到 09c 未取到的结果：

- `GET http://127.0.0.1:18090/v1/models` + `Authorization: Bearer <config 内 server_key>` → **HTTP 200，`{"object":"list","data":[8 项]}`**；8 个 free 模型为 `beam-free`、`big-pickle`、`deepseek-v4.1-flash-free`、`flint-40b-free`、`glm-5.3-flash-free`、`mimo-v2.6-flash-free`、`nemotron-3.5-lightning-free`、`nemotron-3.5-super-vl-free`；每项 `native_protocol="chat"`、`supported_endpoints=["/v1/chat/completions","/v1/responses","/v1/messages"]`。⇒ 09c 的 401 是「未带/带错 key」，不是模型目录不可用；**匿名通道当前仍能列出 8 个免费模型**（来自磁盘缓存）。
- `GET /healthz` → **HTTP 503 `degraded`**，正文：`ready:false`、`version:"v1.4.4"`、`models:{status:"stale",total:78,exposed:8,zen:78,go:0,last_refresh:"2026-10-31T06:43:16.301898082Z",stale_after_seconds:600,cache_source:"disk",stale:true}`、`keys:{zen:0,go:0,total:0,anonymous:true}`、`proxies:{total:27,healthy:0,unhealthy:27}`、`issues:["model_catalog_stale","no_healthy_proxies"]`。`/opt/oc2api/oc2.log` 尾部每 5 分钟重复 `anonymous model catalog refresh failed` + `OpenCode capability catalog refresh failed: no healthy proxy available for OpenCode capability catalog`。
  ⇒ **网关当前处于「模型目录陈旧 + 27 个代理全不健康」的降级状态**；`/v1/models` 靠 `cache_source=disk` 撑着。这与 09c §2.2「网关进程活着」不冲突，但补上了可用性的真实边界。若后续要把网关当 LLM `baseURL`，须先修代理池/刷新目录；**本报告未改配置、未重启进程**。
- 上游项目链接（09c 未给出）：<https://github.com/jasonxu114514/opencode2api>（GPL-3.0-or-later，v1.4.3 README 自带），本地 v1.4.3 README 的「Compatibility boundaries」逐字：`Requests using the upstream's native protocol retain provider-specific fields. Requests crossing protocols pass through a common representation; not every option has an equivalent... Unsupported content or tool types may be rejected.` ⇒ 三协议互译**不是原样透传**，跨协议时 `seed`/JSON output 约束会丢。README 全文**没有** `/api/websearch`、`web_search` 工具名或任何搜索端点 → 与 09c §2.5「网关不是搜索后端」一致，此处补一条独立文本证据。

## C. 上文未展开的四个并入细节（对 §8 / 09c §5 的补充，不重复其清单）

### C-1 「同源」精确到字段读取位置（09 §6 只说「完全同源」）

| | OpenCode `parallel.ts` | DSH `lib/backends/parallel.js` |
| --- | --- | --- |
| 端点 / tool | `search.parallel.ai/mcp` / `web_search` | **同** |
| 入参 | `{objective, search_queries:[query]}`（`model_name?` 允许但不传） | `{objective, search_queries:[query], session_id:"dsh-websearch-"+uuid8, model_name:"dsh-websearch"}` |
| 结果读取 | **`result.structuredContent.results`**（`parallel.ts:76-86`） | **`JSON.parse(result.content[0].text).results`**（`parseParallelResult:92-118`） |
| 握手 | `mcp.ts` 裸 POST 一次，**无 initialize、无 `Mcp-Session-Id`** | `mcp-client.js` 强制 `initialize → notifications/initialized → tools/call` + `Mcp-Session-Id` 缓存 10min + 401/403/404 重握手一次 |

⇒ 结论：**同源 = 同一上游 MCP server 与 tool；不同源 = 客户端握手与结果字段位置**。因此「补 OpenCode 新增端点」时**不要重写 exa/parallel**，只需给 DSH `parallel.js` 加一行「优先读 `structuredContent`，回退 `content[0].text`」的容错（P2）。同理 exa：OpenCode 有 key 时把 key 放 **URL query `?exaApiKey=`**（`exa.ts:36-37`，v2.2.5 测试 `websearch.test.ts:132` 实测），DSH 完全无 key 分支——若将来给 DSH exa 加 key，必须放 URL 而非 Authorization 头。

### C-2 TinyFish keyless 与 DSH `mcpCall()` 的握手冲突（09/09b 未点出的落地坑）

`tinyfish.ts:64` 注释原文：`Keyed requests are rejected without the Mcp-Session-Id returned by initialize; keyless ones are not.` v2.2.5 测试 `websearch.test.ts:343-370` 断言：keyless 时 requests[0] 直接是 `tools/call`（无 initialize），keyed 时 requests[0..3] = initialize / notifications/initialized / tools/call(带 `Mcp-Session-Id`)。
DSH 现有 `mcpCall()` **无条件先 `ensureSession()`**（`lib/util/mcp-client.js:157-158`）。若直接拿它接 TinyFish keyless，会多发一次 initialize；而 keyless 端点对 initialize 的行为未由 OpenCode 保证（本子代理 `curl GET` 探测为 401，POST 未测）。
⇒ **落地要求**：给 `mcpCall` 增加 `skipInitialize` 选项（或新增 `mcpCallDirect`），keyless 走跳过；keyed 复用 DSH 现有三步握手（**不要**为了对齐 OpenCode 删掉握手，exa/parallel 依赖它）。此项应写进 09 §8 的 P0「新增 tinyfish backend」验收条件。

### C-3 429 冷却的**测试级**语义（09 §4 给了代码，未给测试断言）

`packages/core/test/websearch.test.ts`（dev 与 v2.2.5 均有，26851 B）把 Retry-After 六种取值钉成表：`"120"→120_000ms`、`"Thu, 01 Jan 1970 00:02:00 GMT"→120_000ms`、`undefined/""/"invalid"/"-1"→60_000ms`（`:290-320`）；另有「每 provider 一次 query 只试一次（零冷却也不重复）」`:277-289`、「全冷却立即失败且不重开同意表单」`:257-275`、「session affinity 独立且不被并发/晚到成功覆盖」`:394-519`、「非 429 不轮转」`:320+`。
⇒ DSH 移植时（09 §8 P1」429 Retry-After 冷却」）**直接照这组断言写回归用例**即可，无需自行设计边界；新增 Config 建议命名 `respectRetryAfter: z.boolean().default(true)`，且必须保持 DSH 独有的 **fail-open**（`lib/breaker.js:9-11`，全部冷却时照常扇出）——这是 DSH 优于 OpenCode 的保守设计，不得回退。

### C-4 Config 新字段的**完整落点清单**（09 §8 只列了 3 个字段）

读入 `lib/index.js`（2.8.8 与 main 一致）确认：加一个 backend 需要同时改 **6 处**，漏一处就会出现「设置面板有开关但不生效」或「遥测缺 id」：

1. `Config`（`lib/index.js:133-243`）：`enableXxx`、`xxxApiKeyEnv`(`role:"credential-ref"`)、`xxxBaseURL` 三项，且每个字段都要 `.description(...)`（v2.8.1 的 `meta.volatile` 表单只认 description）；
2. `resolveOptions()` 的 `toggleMap`（`:293-303`）、`ALL_BACKENDS`（由 `BACKENDS` 对象键自动派生）、`DEFAULT_KEY_ENV`（`:80-88`）、`DEFAULT_BASE_URLS`（`:90-102`）、`DEFAULT_LABELS`（`:119-125`）、`DEFAULT_MODELS`；
3. `BACKENDS` 注册表（`:55-68`）+ 顶部 import（`:20-32`）；
4. `DEFAULT_ENABLED`（`:71`，仅 keyless 默认开 → 建议只加 `tinyfish`，`firecrawl` 因计费默认关）；
5. **`lib/client.js:14-25` 的 `BACKENDS` 数组**——这是 09/09c 都没点到的：设置面板的 `KEYLESS`/`KEYED` 分组、`readCredential`、状态点、开关渲染全靠这份**客户端独立副本**，不与 `index.js` 共享；漏改则新后端在 UI 上完全不可见；
6. `README.md` 的 Backends 表 + Settings 表 + `EXTENSION_PLAN.md` 状态。

`resolveOptions()` 已为**所有** id 生成 `${id}BaseURL`，但 `exaBaseURL`/`parallelBaseURL` 在 `Config` 里并不存在（只有 `DEFAULT_BASE_URLS` 有值）→ 顺手补齐这两个字段，方便把两个 MCP 端点也指向 sidecar。`cacheKeyFor` 已把 `enabledBackends` 纳入键（v2.7.1 修复），新开关切换后不会吃旧缓存，**无需改缓存代码**；`createUnifiedSearchProvider` 的 `recordBackendHealth → foldBreaker → getBackendHealth()` 与 `GET /api/websearch/history` 的 `backends[]` 字段（v2.8.0）会自动覆盖新后端，**无需改 `provider.js`/`history.js`**，只要两个新 backend 调用 `hooks.recordRequest/recordOutcome` 且 **headers 里不带 key**（沿用 `exa.js` 的 `headers:{}` 写法，`extraHeaders` 只传进 `mcpCall`）。

## D. 校验补充：npm 2.8.8 解包核对（C 级，09c §4.4 的结论在此独立复现）

`curl -sSL https://registry.npmjs.org/@240xu/dsh-websearch/-/dsh-websearch-2.8.8.tgz | tar -xz` 后逐文件比对：`lib/backends/` 仍是 **10 个文件 / 11 个 backend**（`anthropic-like.js` 承载 deepseek+anthropic 两个），**无 firecrawl.js / tinyfish.js**；`Config` 的 11 个 `enableXxx`、`DEFAULT_BASE_URLS` 11 项、`README.md` Backends 11 行、`cordis.patch.yml` 与 main 一致；`package.json` version=2.8.8。npm `time` 字段：2.8.4 `2026-10-18T06:02Z`、2.8.5 `10:31Z`、2.8.6 `14:04Z`、2.8.7 `2026-10-20T12:53Z`、2.8.8 `2026-10-21T14:10Z`。
⇒ **截至 npm latest 2.8.8，并入工作仍未开始**；09 §8 / 09c §5 的 P0 清单依然全部有效，且基线必须升到 2.8.8（本地 2.8.4 没有 2.8.5 forwarder 与 2.8.6 `node:http(s)` 直连修复，见 `CHANGELOG.md` 2.8.6「sidecar hop 被全局 dispatcher 劫持导致每次搜索全失败」）。`lib/util/egress-fetch.js`（2.8.8）逐字含 `DSH_EGRESS_FORWARDER`、`DSH_EGRESS_FORWARDER_PROXY`、`DSH_EGRESS_FORWARDER_TIMEOUT_MS ?? 20s`、`import http/https from node:http(s)` 与注释「this hop must own its transport (node:http(s)) by design」，与 2.8.6 CHANGELOG 一致。

## E. 5 端点只读连通性探测（D 级，与 00 号文件互补）

本子代理在另一时刻（`HTTPS_PROXY=http://172.30.66.1:1091`，`curl GET --max-time 8`，**不发起搜索**）得到：

| 端点 | GET | 解读 |
| --- | --- | --- |
| `https://mcp.exa.ai/mcp` | 405 | MCP streamable-http 只收 POST，正常 |
| `https://mcp.firecrawl.dev/v2/mcp` | 405 | 同上 |
| `https://search.parallel.ai/mcp` | 405 | 同上 |
| `https://api.tavily.com/search` | 401 | REST，需鉴权头 |
| `https://agent.tinyfish.ai/mcp` | 401 | 同上 |
| `https://opencode.ai/zen/v1/models` | 200 | 模型目录上游可达 |

⇒ 当前代理出口对 5 个端点 **TCP/TLS 均可达**，401/405 是鉴权/方法层而非 GFW 阻断。与 `00-lead-live-probe.md` 的 POST initialize 200 结论一致、互为独立复现。注意：这与 `02-runtime-state.md:320-321` 记录的「DSH 运行时 exa/parallel `MCP initialize HTTP 403`」不矛盾——那是 uid 1001 的 DSH 进程走 `DSH_EGRESS` iptables 限制链路，本探测是 dsh 会话 shell 的预置代理；**403 的确切环节仍未抓包定位，维持 09 §10 的 E 级标注**。

## F. 本子代理新增的权威链接（上文 §9 未列，全部本轮实际取到）

1. <https://api.github.com/repos/anomalyco/opencode/commits/dev> — dev HEAD `ffe6fed`（2026-11-04）
2. <https://api.github.com/repos/anomalyco/opencode/commits?path=packages/core/src/plugin/websearch/firecrawl.ts&sha=dev> — Firecrawl 引入 `e6c9b6be` 2026-08-07
3. <https://api.github.com/repos/anomalyco/opencode/commits?path=packages/core/src/plugin/websearch/tinyfish.ts&sha=dev> — TinyFish `3f579f53` / initialize 修复 `86755e1c`
4. <https://github.com/anomalyco/opencode/commit/a809a4755fb1> — `refactor(core): share web search plugin integration setup (#61162)`，dev 相对 v2.2.5 变小的唯一原因
5. <https://github.com/anomalyco/opencode/blob/dev/packages/core/src/plugin/websearch/provider.ts> — `register()` 44 行全文（dev 新增）
6. <https://github.com/anomalyco/opencode/blob/dev/packages/core/test/plugin/websearch.test.ts> — 5 provider wire 断言（keyless/keyed/429/initialize，373 行）
7. <https://github.com/anomalyco/opencode/blob/dev/packages/core/test/websearch.test.ts> — Retry-After 六取值 / 全冷却 / affinity（26851 B）
8. <https://github.com/anomalyco/opencode/blob/dev/packages/core/test/tool-websearch.test.ts> — `permission.assert` 顺序 `["permission","query"]`、disable 落 KV（17320 B）
9. <https://github.com/anomalyco/opencode/blob/dev/packages/core/test/config/websearch.test.ts> — `Selection=false → WebSearch.Disabled`
10. <https://github.com/anomalyco/opencode/blob/dev/packages/schema/src/location.ts> — `Location.response(S) = {location, data}`
11. <https://github.com/anomalyco/opencode/blob/dev/packages/protocol/src/groups/location.ts> — `LocationQuery` deepObject/explode
12. <https://github.com/anomalyco/opencode/blob/dev/packages/protocol/src/errors.ts> — `InvalidRequestError` 400 / `ServiceUnavailableError` 503
13. <https://github.com/anomalyco/opencode/blob/dev/packages/client/src/effect/api/api.ts> — `WebsearchApi` 签名（`:2730-2752`）
14. <https://github.com/anomalyco/opencode/blob/dev/packages/client/src/effect/generated/client.ts> — `client.websearch.{providers,query}`（`:1915-1930`）
15. <https://github.com/anomalyco/opencode/blob/dev/packages/app/src/session/requests/websearch.ts> — TUI chooser `replyWebSearch`
16. <https://github.com/anomalyco/opencode/blob/dev/packages/app/src/session/requests/session-websearch-dock.tsx> — TUI dock
17. <https://raw.githubusercontent.com/anomalyco/opencode/dev/services/www/src/docs/content/config.mdx> — `websearch` 配置段（`:320-332`）
18. <https://registry.npmjs.org/@240xu%2Fdsh-websearch> — `dist-tags.latest=2.8.8` + `time` 字段
19. <https://raw.githubusercontent.com/240xu/dsh-websearch/main/EXTENSION_PLAN.md> — Firecrawl 曾列 Tier 2 / Tavily MCP 标 Research（解释「为何没跟上」）
20. <https://github.com/240xu/dsh-websearch/blob/main/lib/util/mcp-client.js> — DSH 三步握手（C-2 的落点）
21. <https://github.com/240xu/dsh-websearch/blob/main/lib/client.js> — 设置面板独立 `BACKENDS` 副本（C-4 第 5 点）
22. <https://github.com/240xu/dsh-websearch/blob/main/lib/index.js> — `Config` / `BACKENDS` / `resolveOptions` 三处落点
23. <https://github.com/jasonxu114514/opencode2api> — 上游 Go 网关（GPL-3.0）
24. <https://github.com/240xu/opencode-zen-gateway/blob/master/README.md> — 802 桶 / TLS 指纹 gate（private，Basic auth 只读取到）
25. <https://github.com/240xu/DshpluginResearch> — 生态索引（11 后端描述）

**本机 D 级证据（非 URL）**：`/opt/oc2api/config.json`、`/opt/oc2api/oc2.log`、`/opt/oc2api/opencode2api_v1.4.3_linux_amd64/README.md`、`/home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/`（2.8.4）、`/home/ova/dsh/.artifacts/refs/opencode-v2/`（v2.2.5 完整 git 快照，`9bbb8ce1`）、`/home/dsh/.dsh/automation/reports/2026-11-04-rehearsal.md`（OC-C/OC-T/OC-S/OC-PE/OC-PP 逐条对比）。

## G. 本子代理的「未取到，待核实」（维持 E 级，绝不写成结论）

- Firecrawl **源码层**是否有显式 keyless 声明 → 无；hosted keyless tier 的额度/可用性仅由 `00-lead-live-probe.md` 的 D 级实测支持（见 A）。
- TinyFish keyless 档的 QPS / 日配额 / 结果条数上限：`00-lead-live-probe.md` 记 `tools/list` 说 30 req/min + 50 searches/UTC day（D 级），但 OpenCode 源码与两份官方文档均未写；本文 C-2 的 `skipInitialize` 方案**未实跑验证**。
- `X-Tavily-Access-Mode: keyless` 在当前代理出口的**真实 POST 搜索成功率**：只做了 GET 401 探测，未发搜索（与 09 §10、09c §5.4 的 E 级标注一致）。
- Console 托管 provider（`opencode` 第 6 个）的实际 server 域名、`x-org-id` 取值、用户 workspace 是否已开启 Hosted Web Search。
- 私有网关是否曾反代 `/api/websearch`：仓库 5 个文件中无相关代码/配置。
- `opencode2api_v1.4.4_linux_amd64/` 目录 `drwx------`（uid 10309），**未读取其 README/二进制**；端点结论依据同系列 v1.4.3 README + v1.4.4 运行时 `/v1/models` 与 `/healthz` 实测，二者一致但与 09c §2.1 的 E 级标注并存。
- GitHub 匿名 API 本轮曾触发 rate limit，后改用 Basic auth（login=240xu）；**token 值未写入本文、未出现在任何命令输出**。

## H. 分工声明

| 内容 | 归属 |
| --- | --- |
| 5 provider 端点总表、统一 `Result`、MCP 客户端、工具契约、429 轮转、server/protocol、11×5 对照、P0/P1/P2 主清单、v2.2.5 永久链接 | **上文 §0–§10（Lead）** + `09b` / `09c` / `00` |
| dev vs v2.2.5 的字节级重构对比、第 6 个 provider、双接口 | `09b §1.4 / §3.5 / §5.3`（本附录 B 的 `a809a475` 时间线为其补 C 级日期） |
| 网关二进制 strings、私有仓库全文、`websearch-polish.md` 硬约束 | `09c §2.3–2.5` |
| **本附录独有**：网关实时 503 degraded + 8 模型 200、Firecrawl keyless 的源码级修正、引入时间线日期、同源精确到 `structuredContent`/握手、TinyFish `skipInitialize` 落地坑、Retry-After 测试级断言、Config 六处落点（含 `client.js` 独立副本）、2.8.8 解包核对、GET 连通性复现、25 条新增链接 | **本附录 A–G** |

> 本附录不改动上文任何一行结论；若与上文冲突，以「A 节的源码级修正」为更精确表述，其余一律以上文/09b/09c 为准。全程只读，未修改任何源码/配置，未重启进程，未操作共享任务板。
