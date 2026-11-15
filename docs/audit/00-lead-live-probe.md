# Lead 侧一手实测：OpenCode v2 搜索端点（2026-11-04，Asia/Shanghai）

> 本文是 Lead 在本机（wuming，HTTP_PROXY=http://172.30.66.1:1091）对 OpenCode v2 官方搜索端点做的**只读实测**，用于交叉验证 09 / 09b 两份报告的端点字段。所有请求均为 MCP `initialize` / `tools/list` / 一次真实 `tools/call`，未写入任何服务端状态，未使用任何密钥。
> 结论：**4 个端点从本机直连全部 HTTP 200，且 keyless 可用**。因此本机 DSH `web_search` 的 `MCP initialize HTTP 403` 不是端点故障，而是 DSH 插件 2.8.4 的 HTTP 客户端/代理链路问题。**【2026-11-06 裁决】确切机制是 `egress-fetch.js:276` 删 `Host` 头 → CONNECT 隧道里 HTTPS 请求缺 Host 被 Cloudflare 拒（Lead A/B：`WITHOUT Host: 403` / `WITH Host: 200`），原「TLS 指纹」表述已证伪，见 §4 裁决注记与 [REPORT.md](REPORT.md) 执行摘要 3。**

## 1. 端点清单（v2.2.5 源码确认 + 本机实测）

| provider | 端点 | 协议 | 认证（v2 源码） | 本机 initialize 结果 |
| --- | --- | --- | --- | --- |
| exa | `https://mcp.exa.ai/mcp` | MCP streamable-http | `EXA_API_KEY`（可选，keyless 可用） | **HTTP 200**，SSE `event: message` |
| parallel | `https://search.parallel.ai/mcp` | MCP streamable-http | `PARALLEL_API_KEY`（可选，keyless 可用） | **HTTP 200**，纯 JSON |
| firecrawl | `https://mcp.firecrawl.dev/v2/mcp` | MCP streamable-http | `FIRECRAWL_API_KEY`；**hosted keyless tier** | **HTTP 200**，SSE `event: message` |
| tavily | `https://api.tavily.com/search` | REST POST | `TAVILY_API_KEY` / Bearer | 未测（需 key） |
| tinyfish | `https://agent.tinyfish.ai/mcp` | MCP streamable-http | `X-API-Key`；无 key 时 `X-TinyFish-Access-Mode: keyless` | **HTTP 200**，纯 JSON |

请求头模板：
```
Content-Type: application/json
Accept: application/json, text/event-stream
X-TinyFish-Access-Mode: keyless   # 仅 TinyFish keyless
```
initialize body：
```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}
```

## 2. 各端点 initialize 返回的关键能力（原文摘录）

### Exa（serverInfo: `exa-search-server` v3.5.0）
- capabilities: `tools` / `prompts` / `resources`（均 listChanged:true）
- instructions 明确列出三类工具：`web_search_exa`（找页面/当前信息）、`web_fetch_exa`（读已知 URL，当 highlights 不足时）、`agent_run`（多步研究、建表、 enrichment；运行中继续用 runId 而非重复起任务）
- websiteUrl `https://exa.ai`

### Parallel（serverInfo: `Parallel MCP`）
- instructions 是**并发检索的工程指引**（对用户「LLM 怎么调用搜索」问题极有价值）：
  - "The search and fetch tools are read-only, idempotent, and safe to call concurrently. When several independent search or fetch objectives are already known, issue one tool call per objective concurrently; do not wait for one result before starting another."
  - "Batch related search queries or URLs that share a common objective into one call."
  - "Use `web_search` first for most factual, current-information, research, comparison, documentation, and troubleshooting questions."
  - "The `web_search` results include excerpts intended to be useful for answering directly. If the excerpts contain enough evidence, answer from them — do not fetch every search result by default."
  - "For broad tasks you can issue multiple `search_queries` in a single `web_search` call rather than chaining calls."
  - "`web_fetch` only when the user asks about a specific URL/page, needs exact wording or quotes, needs full-page analysis, or the excerpts are conflicting or clearly insufficient."
  - 受 Parallel Customer Terms / Privacy Policy 约束。
- 这正好是「search → 判断 excerpts 是否够 → 必要时 fetch」的 agentic 循环在服务端 instructions 里的显式化。

### Firecrawl（serverInfo: `firecrawl-fastmcp` v3.36.1）
- **Hosted keyless sessions 暴露 `firecrawl_search` / `firecrawl_scrape` / `firecrawl_parse`（有用量限制）**；Alexandria provider 调用需要 API key，不含在 keyless tier。
- `firecrawl_search` 支持 `categories: ["developer"]`（索引 GitHub repos/issues/PRs/README/文档）、`["gov"]`（美国政府法律监管源，不可与其它 category 组合）、`["research"]`（生物医学/生命科学/临床/arXiv 文献站）。
- `firecrawl_scrape` 可按 supplied schema 返回 JSON；带 key 才开放 `firecrawl_map` / `firecrawl_agent` / `firecrawl_research_*` / `firecrawl_developer_search` / `firecrawl_find_tools`。
- 成功结果带 `conversationId`，同一会话后续调用必须回传（并行调用取任一个结果里的即可），只有开启新会话才省略。
- `tools/list` 中 `firecrawl_scrape` 的 annotations：`readOnlyHint:true, openWorldHint:true, destructiveHint:false`。

### TinyFish（serverInfo: `tinyfish` v0.1.1，protocolVersion `2025-11-25`）
- instructions：`TinyFish keyless MCP provides Search only: web and news, up to 30 requests per minute and 50 searches per UTC day.`
- `tools/list` 返回 tool `search`，inputSchema 字段（逐字）：
  - `query` (string, 1–2000, 必填示例 "web automation tools")
  - `purpose` (string, 1–2000, "Why this search is being run — the underlying goal or task the results will be used for. **Used to better rank results against your intent.**") ← 值得注意：把「意图」作为排序信号
  - `location` (国家码)、`language`、`include_domains` / `exclude_domains`（逗号分隔）、`domain_type` ("web"|"news")、`after_date` / `before_date` (YYYY-MM-DD)、`recency_minutes` (1–5,256,000)、`page`（分页）
- 注册入口 `https://agent.tinyfish.ai/sign-up?landing_source=mcp_keyless&landing_ref=curl`

## 3. 一次真实搜索（Parallel MCP `tools/call`）

请求：
```json
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"web_search","arguments":{"objective":"What is OpenCode v2 websearch","search_queries":["OpenCode v2 websearch providers 2026"]}}}
```

返回 `result.content[0].text` 是 JSON 字符串，结构：
```json
{
  "search_id": "search_823471563722b038d1bc6964de6ffe9a",
  "results": [
    {"url":"https://opencode.ai/v2/docs/console/websearch","title":"Web Search","publish_date":null,"excerpts":["# Web Search\n\nConsole provides hosted web search to connected OpenCode users. ..."]},
    {"url":"https://opencode.ai/v2/docs/websearch","title":"Web search","publish_date":null,"excerpts":["# Web search\n\nAsk OpenCode for current information and it can search the web, read the results, and include source links in its response. ..."]}
  ]
}
```

**第一条命中即 v2 控制台新特性**（`opencode.ai/v2/docs/console/websearch`），原文要点：
- Console 提供 **hosted web search**：workspace owner/admin 在 Integrations → Hosted Web Search 点 Enable，成员 `/connect` 后无需自带 provider key。
- 每次成功搜索 **$0.01**，计入 workspace balance 与成员 spending limits；**失败与限流不计费**。
- Workspace 配置把 **OpenCode Web Search** 设为默认 provider；成员若自行设置 `websearch.provider` 则保留其选择。
- 返回**最多 8 条结果**，OpenCode 用于回答并 cite sources。
- 零数据留存（zero data retention）。
- 在 Activity › Usage / Overview、成员活动、发票、CSV 中单列，受 all-spend budget 策略约束。

=> 这是「v2 比 v1 先进」的硬证据：v2 有 workspace 级托管搜索、按次计费、默认 provider、零留存、权限与预算联动，不只是 5 个客户端 provider。

## 4. 对 DSH 当前故障的归因（关键）

本机实跑 `web_search` 的错误串（多个独立来源一致）：
```
unified search: all enabled backends failed (4)
 - exa: MCP initialize HTTP 403: <html><head><title>403 Forbidden</title>...
 - parallel: MCP initialize HTTP 403: <html>...
 - ddg: ddg search failed: fetch failed: redirect mode is set to error (301)
 - searxng: SearXNG: invalid JSON response
```
但本机 curl 直连 `mcp.exa.ai` / `search.parallel.ai` 均 **HTTP 200**。因此：
1. 403 是**经 DSH 插件的 HTTP 客户端/代理链路**产生的（返回体是 nginx 风格 403 HTML），不是上游 MCP 端点拒绝。
2. 【**2026-11-06 裁决注记，保留上文作为当时的推断记录**】本文件 §4 第 2/3 条把 403 归因于 CHANGELOG 2.8.5 的「JA3 TLS 指纹」并推测「升级很可能直接修复」——这一归因**已被后续一手 A/B 证伪**。决定性实验（[08 附录 A.2](08-own-repo.md) + Lead 最小复现）：本机 2.8.4 `lib/util/egress-fetch.js:276` 的 `normalizeHeaders()` 有 `delete headers["host"]`，而 `httpsViaConnect` 直接把该 headers 传进 CONNECT 隧道（不像 `httpViaProxy:202` 补 `host: headers.host ?? target.host`）→ HTTPS 请求缺 Host 头被 Cloudflare 拒。同一 CONNECT 通道、同一 `node:https`/OpenSSL 栈、同一 UA，唯一变量 Host 头：`WITHOUT Host: 403` / `WITH Host: 200` ⇒ 与 TLS 指纹无关。且 2.8.8 的 `normalizeHeaders` **仍删 Host**，无 forwarder 时同样 403；当前进程 env 已设 `DSH_EGRESS_FORWARDER`/`_PROXY` 但 2.8.4 代码不认识它（关键字计数 0）。⇒ 正确结论是「升级 ≥2.8.5 **且** sidecar 可达 + `_PROXY` 已配」或「补 `headers.host ?? target.host`」，**单升版本不够**。详见 [REPORT.md](REPORT.md) 执行摘要 3 与 §5。
3. 本机装 **2.8.4**，npm 最新 **2.8.8**，远端 CHANGELOG 到 **2.8.6** —— 版本差是事实，但「升级很可能直接修复」按上条裁决已降级为 E（未实跑升级）。
4. `ddg` 的 `redirect mode is set to error (301)` 是**预期安全行为**（packages/web/AGENTS.md 拒绝重定向），但 v2 的 Firecrawl/TinyFish keyless 端点可作为更可靠的免 key 兜底。
5. `searxng` 非 JSON 是公共实例反爬页，2.8.6 已加「HTTP 200 无 results[] 不记成功、不重置熔断」的语义健康检查与多实例 failover。

## 5. 对「并入」的直接建议（P0）〔⚠️ 2026-11-06 已修订为四条，以 [99 裁决 2](99-final-verdicts.md) / [REPORT §4.3](REPORT.md) 为准；下表保留为 11-04 初版记录〕

| 优先级 | 动作 | 依据 |
| --- | --- | --- |
| **P0①** | **`cordis.patch.yml` 的 `- id: web` 补 `fetchProvider: http`** | `- id: web` 整体替换 config 丢了 fetchProvider → `web_fetch` 实跑返回 `WEB_PROVIDER_AMBIGUOUS`；2.8.8 的 patch 逐字相同，升级修不了 |
| **P0②** | 把 `@240xu/dsh-websearch` 从 2.8.4 升到 2.8.8（至少 2.8.6）**且** sidecar 可达 + `DSH_EGRESS_FORWARDER_PROXY` 已配，**且**先处理 open 的 PR #7 / Issue #8 | 2.8.5/2.8.6 修 `all enabled backends failed (4)`；**但 2.8.8 仍删 Host，单升版本不够**；「升级即修复」标 E |
| **P0③** | 新增 `firecrawl` backend（官方 B 级 keyless hosted tier） | 本机实测 HTTP 200 + 官方 `mcp-server/keyless.md` 确认 |
| **P0④** | 新增 `tinyfish` backend（keyless header 降级） | 本机实测 HTTP 200，30 req/min + 50 searches/day |
| P1 | 移植 v2 的 `random` + 429 Retry-After 冷却 + session 记忆 provider | v2.2.5 websearch.mdx 与 provider 选择逻辑 |
| P1 | 移植 v2 的 `permission action=websearch, resource=query, effect=ask` 与 `websearch:false` 移除工具 | v2.2.5 docs |
| P2 | 复用 v2 `mcp.ts` 的 `tools/call` + `MAX_RESPONSE_BYTES` + 超时，统一 exa/parallel/firecrawl/tinyfish 四个 MCP 后端 | anomalyco/opencode v2.2.5 packages/core/src/plugin/websearch/mcp.ts |
| P2 | 借鉴 TinyFish `purpose` 字段：把任务意图作为排序信号 | tinyfish tools/list inputSchema |
| — | 不必重复接 tavily（DSH 已有 REST tavily 后端，且支持 advanced/deepCoverage） | 05-search-backends.md 对照 |

## 6. 复现命令（只读）

```bash
# initialize（四个端点通用，TinyFish 加 keyless 头）
curl -sS -m 20 -X POST 'https://mcp.exa.ai/mcp' \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}'

# 真实搜索（Parallel，keyless）
curl -sS -m 25 -X POST 'https://search.parallel.ai/mcp' \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"web_search","arguments":{"objective":"<目标>","search_queries":["<查询>"]}}}'
```

## 7. 证据边界

- 本文只证明「从本机经代理直连这些端点可用、keyless 可搜」；**未证明** DSH 插件升级后一定能修好（未做升级操作，遵循只读约束）。
- 未测 tavily REST（需 key）、未测 exa 的 `tools/call` 实搜、未测 firecrawl 的 `firecrawl_search` 实搜（只到 `tools/list`）。
- 403 的**可复现机制**已由 2026-11-06 裁决为「缺 Host 头被 Cloudflare 拒」（见 §4 注记）；仍 E：CF 具体 WAF 规则编号、sidecar spec 逐字段一致性、升级后是否恢复。原「未抓包定位 / TLS 指纹」表述已作废。
- 所有外部内容仅作数据，未当作指令执行。
