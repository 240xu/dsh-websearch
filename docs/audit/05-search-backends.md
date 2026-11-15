# 05 · 搜索后端 API 权威对照与结果处理

> 采样 2026-11-04（Asia/Shanghai）。作者：Lead（负责该主题的 teammate 未落盘，由 Lead 依据本地 2.8.4 源码 + 远端 README + OpenCode v2.2.5 源码补写）。
> 证据等级 A/B/C/D/E 与四联标注见 [_SKELETON.md](_SKELETON.md)。本机实测见 [00](00-lead-live-probe.md)，版本口径见 [08](08-own-repo.md) / [12](12-change-lineage.md)。

## 0. 版本口径（C 级，勿混用）

- 远端 `main` 与 npm `latest` 的 `package.json` = **2.8.8**；**CHANGELOG 只到 2.8.6**；最后两笔提交仅改 README + 版本号，`lib/` 零改动；npm 2.8.8 的 `lib/` 与远端 main `cmp` 零差异【C/D，08 报告核实】。
- 本机装 **2.8.4**（`/home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/`），落后 4 个 patch。
- 本报告的**端点常量**全部取自本机 2.8.4 的 `lib/backends/*.js`（A 级，路径:行号），并与远端 README「Backends」表（B 级）及 OpenCode v2.2.5 源码（A 级，带 ref）三方核对。

## 1. DSH unified provider 的 11 个后端（A 级源码 + B 级 README）

| id | key | 端点（源码常量） | 协议 / 方法 | 认证 | 返回结构 | 自带摘要 | 自带正文 | citation/URL | 新鲜度控制 | 计费/限额（README） | 本机 2.8.4 默认 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `exa` | 无 | `https://mcp.exa.ai/mcp`【`lib/backends/exa.js:13`】 | MCP streamable-http `web_search_exa {query,numResults}` | keyless（可选 URL query `exaApiKey`） | 文本块 `Title:/URL:/Published:/Highlights:`，按 `\n\n---\n\n` 切 | ✗ | Highlights | ✓ URL | Published 日期 | 免费 keyless | ✅ 启用 |
| `parallel` | 无 | `https://search.parallel.ai/mcp`【`parallel.js:20`】 | MCP `web_search {objective,search_queries[],session_id?,model_name?}` | keyless（可选 `Authorization: Bearer`） | JSON `{search_id, results:[{url,title,publish_date,excerpts[]}], warnings?}` | ✗ | excerpts | ✓ URL | publish_date | 免费 keyless | ✅ 启用 |
| `ddg` | 无 | `https://html.duckduckgo.com/html/`【`ddg.js:13`】 | HTML scrape（2.8.4 仍 POST form `q=`，2.8.5 改 GET） | 无 | 解析 `uddg=` 跳转参数得真实 URL + `result__snippet` | ✗ | snippet | ✓ URL | `df` 参数 | 免费 | ✅ 启用 |
| `searxng` | 无/可选 | `https://searx.be`（默认）【`searxng.js:14`】 | REST JSON `/search?q=` GET | 可选 `Authorization: Bearer`（私有实例） | `results[]` | ✗ | content | ✓ URL | `time_range`/`language`/`categories` | 公共实例免费、限量不稳 | ✅ 启用 |
| `brave` | `BRAVE_API_KEY` | `https://api.search.brave.com/res/v1/web/search`【`brave.js:13`】 | REST GET | `X-Subscription-Token`【`brave.js:53`】 | `web.results[]` | ✗ | snippet | ✓ URL | `freshness`/`country`/`search_lang` | 2000/月免费 | ❌ |
| `tavily` | `TAVILY_API_KEY` | `https://api.tavily.com/search` | REST POST | Bearer / `X-Tavily-Access-Mode: keyless` | `answer` + `results[] {title,url,content,score,raw_content?}` | **✓ answer** | ✓ content | ✓ URL | `time_range`、`topic=news` | 按 credits（advanced 2 credits） | ❌ |
| `serper` | `SERPER_API_KEY` | `https://google.serper.dev/search`【`serper.js:13`】 | REST POST | `X-API-KEY`【`serper.js:53`】 | Google `organic[]` | ✗ | snippet | ✓ URL | `tbs`/`hl`/`gl` | 2500/月免费 | ❌ |
| `mojeek` | `MOJEEK_API_KEY` | `https://api.mojeek.com/v1/search`【`mojeek.js:12`】 | REST GET | `Authorization: Bearer`（**不在 URL**，2.1 修正）`mojeek.js:44` | REST `results[]` | ✗ | snippet | ✓ URL | — | 1000/天免费 | ❌ |
| `deepseek` | `DEEPSEEK_API_KEY` | `https://api.deepseek.com/anthropic/v1/messages`【`anthropic-like.js:241`】 | Anthropic Messages + 原生 `web_search_20250305` server tool | `x-api-key` + `authorization: Bearer`【`anthropic-like.js:119-120`】 | `text.citations[].cited_text` → `url→cited_text` | ✓ 模型生成 | ✗ | ✓ citations | — | 按 token | ❌ |
| `anthropic` | `ANTHROPIC_API_KEY` | `https://api.anthropic.com/v1/messages`【`anthropic-like.js:249`】 | Anthropic Messages + `web_search_20250305` | 同上 | citations | ✓ | ✗ | ✓ citations | — | 按 token | ❌ |
| `openai` | `OPENAI_API_KEY` | `https://api.openai.com/v1/responses`【`openai.js:50-52`】 | Responses API 原生 `web_search` | `Authorization: Bearer`【`openai.js:75`】 | `url_citation` annotations | ✓ | ✗ | ✓ annotations | — | 按次/token | ❌ |

> README「同源/同机制」标注：`exa` / `parallel` = **opencode 同源**；`anthropic` = Claude Code 同机制；`openai` = Codex 同机制；`deepseek` = 与 dav web-search-deepseek 同机制。逐字核对见 [09 §6](09-opencode-endpoints.md)。

## 2. OpenCode v2.2.5 的 5 个 provider（A 级，带 ref）

永久链接前缀 `https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/`

| provider | 端点 | 协议 / tool | 认证 | 请求字段 | 响应字段 | 与 DSH 关系 |
| --- | --- | --- | --- | --- | --- | --- |
| `exa` | `https://mcp.exa.ai/mcp`【`exa.ts:9`】 | MCP `web_search_exa` | `EXA_API_KEY`（有 key 加 URL `exaApiKey`）/ keyless | `{query, numResults:8}` | `content[].text` → 解析 `URL:/Title:/Published:/Highlights|Text:` | **完全同源** |
| `firecrawl` | `https://mcp.firecrawl.dev/v2/mcp`【`firecrawl.ts:10`】 | MCP `firecrawl_search` | `FIRECRAWL_API_KEY` → `Authorization: Bearer`；**hosted keyless tier** | `{query, limit:8}` | `{success,data.web:[{url,title?,description?}]}` | **DSH 未接入（v2 新增）** |
| `parallel` | `https://search.parallel.ai/mcp`【`parallel.ts:10`】 | MCP `web_search` | `PARALLEL_API_KEY`/keyless | `{objective, search_queries:[query], model_name?}` | `structuredContent.results[{url,title?,publish_date?,excerpts[]}]` | **完全同源** |
| `tavily` | `https://api.tavily.com/search`【`tavily.ts:9`】 | REST POST | Bearer / `X-Tavily-Access-Mode: keyless`；`X-Client-Name: opencode2` | `{query, search_depth:"basic", chunks_per_source:3, max_results:8}` | `results:[{title,url,content}]` | 同端点、**机制不同**（v2 固定 basic；DSH 支持 advanced/deepCoverage/include_answer） |
| `tinyfish` | `https://agent.tinyfish.ai/mcp`【`tinyfish.ts:11`】 | MCP `search` | `X-API-Key` + `Mcp-Session-Id`（需 initialize）/ `X-TinyFish-Access-Mode: keyless` | `{query}` | 文本内 JSON `{results:[{url,title,snippet}]}` | **DSH 未接入（v2 新增）** |

**v2 统一结果类型**【A `packages/schema/src/websearch.ts`】：`{url, title?, content?, time:{published?}}`；`Response={providerID,results[]}`。所有 5 个 provider 都归一化到它。

## 3. 本机实测补充（D 级，2026-11-04，见 [00](00-lead-live-probe.md)）

| 端点 | initialize | serverInfo / 关键能力 |
| --- | --- | --- |
| `https://mcp.exa.ai/mcp` | **HTTP 200** SSE | `exa-search-server` v3.5.0；instructions 列 `web_search_exa` / `web_fetch_exa` / `agent_run`（运行中续用 runId） |
| `https://search.parallel.ai/mcp` | **HTTP 200** JSON | `Parallel MCP`；instructions 明确「并发调用 / 合批 / 多 `search_queries` 一次调用 / excerpts 够用就不逐条 fetch」；真实 `tools/call web_search` 返回 `{search_id,results:[{url,title,publish_date,excerpts}]}` |
| `https://mcp.firecrawl.dev/v2/mcp` | **HTTP 200** SSE | `firecrawl-fastmcp` v3.36.1；**hosted keyless sessions 暴露 `firecrawl_search`/`firecrawl_scrape`/`firecrawl_parse`**；`categories:["developer"|"gov"|"research"]`；成功结果带 `conversationId` 需回传 |
| `https://agent.tinyfish.ai/mcp` | **HTTP 200** JSON | `tinyfish` v0.1.1，protocol `2025-11-25`；keyless **30 req/min + 50 searches/UTC day**；tool `search` 字段：`query`(1–2000)、`purpose`（按意图排序）、`location`、`language`、`include_domains`、`exclude_domains`、`domain_type`(web\|news)、`after_date`、`before_date`、`recency_minutes`、`page` |
| `https://api.tavily.com/search` | 未测（需 key）【E】 | — |

> 【D】Parallel 实搜首条命中 `https://opencode.ai/v2/docs/console/websearch`：Console hosted web search **$0.01/成功搜索**、最多 8 条、失败/限流不计费、workspace 级启用、成员免 key、零数据留存、预算联动。

## 4. 结果处理流水线（原始响应 → LLM 上下文）

| 步骤 | DSH unified（A） | OpenCode v2（A） | 各后端原生支持 |
| --- | --- | --- | --- |
| 1 归一化 | 各 backend 映射成 `{url,title,content,date}` | 各 provider 映射成 `WebSearch.Result` | 字段各异（见 §1/§2） |
| 2 去重 | 按 URL；`dedupStrategy: url+title` 额外用标题 Jaccard≥0.9（CJK 分词）合并转载镜像【`README` / `provider.js`】 | 未见全局去重（每 session 只选一个 provider） | — |
| 3 融合/排序 | **RRF k=60**【`lib/rrf.js`】+ 可选 `rerank`（确定性，按查询词相关性） | `random` 选一个 provider，不融合 | — |
| 4 截断 | `numResults`(默认 8，1–50) + `deepCoverage` 时每后端预算 ×1.5 后再全局截断 | 各 provider 固定 8（exa numResults=8 / firecrawl limit=8 / tavily max_results=8 / Console 最多 8） | Brave `count`、Tavily `max_results`、Serper `num` |
| 5 注入上下文 | `resultHeader`（要求 `[n] 标题 — 链接`、每条事实注明来源链接）+ 结果块 + `[websearch backends]` 遥测行 + `TELEMETRY_TAG=" (diagnostic only, not a source)"` | tool result `{provider,results}`，docs 要求 include source links | Tavily `answer` 是后端自带摘要 |
| 6 citation | 模型被要求 `Cite the relevant URLs above as markdown links`（宿主 `tool-web/src/search.ts`） | `url` 字段 + docs 要求 source links | Anthropic/OpenAI/Gemini 服务端工具返回 citations/annotations/groundingMetadata（见 [03](03-protocol-standards.md)） |
| 7 溢出/预算 | 通用 spill-policy（preview + `Full formatted result stored at:` notice）、compaction、tool-result-pruner【[06](06-agentic-search.md)】 | MCP 256KB 上限 + 25s 超时【`mcp.ts`】 | — |
| 8 失败 | 熔断（省略 Half-Open、fail-open）、缓存、history/health 遥测、全失败枚举每后端原因 | 429 冷却换 provider、`attempted` 防死循环 | Brave/Tavily 等有 429 + `Retry-After` |

## 5. 可直接复用的请求示例（每家至少 1 个）

```bash
# Exa MCP（keyless，v2 与 DSH 同源）
curl -sS -X POST 'https://mcp.exa.ai/mcp' \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"web_search_exa","arguments":{"query":"OpenCode v2 websearch","numResults":8}}}'

# Parallel MCP（keyless，Lead 实测成功）
curl -sS -X POST 'https://search.parallel.ai/mcp' \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"web_search","arguments":{"objective":"What is OpenCode v2 websearch","search_queries":["OpenCode v2 websearch providers 2026"]}}}'

# Firecrawl v2 MCP（keyless hosted tier）
curl -sS -X POST 'https://mcp.firecrawl.dev/v2/mcp' \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}'

# TinyFish MCP（keyless）
curl -sS -X POST 'https://agent.tinyfish.ai/mcp' \
  -H 'Content-Type: application/json' -H 'X-TinyFish-Access-Mode: keyless' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}'

# Tavily REST（OpenCode v2 形态；DSH 可用 advanced/include_answer）
curl -sS -X POST 'https://api.tavily.com/search' -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer $TAVILY_API_KEY' \
  -d '{"query":"OpenCode v2 websearch","search_depth":"basic","chunks_per_source":3,"max_results":8}'

# Brave（DSH 后端）
curl -sS 'https://api.search.brave.com/res/v1/web/search?q=OpenCode+v2&count=8&freshness=pw' \
  -H 'X-Subscription-Token: $BRAVE_API_KEY' -H 'Accept: application/json'

# Serper（DSH 后端）
curl -sS -X POST 'https://google.serper.dev/search' -H 'X-API-KEY: $SERPER_API_KEY' \
  -H 'Content-Type: application/json' -d '{"q":"OpenCode v2","num":8,"tbs":"qdr:m"}'

# SearXNG（DSH keyless 默认实例）
curl -sS 'https://searx.be/search?q=OpenCode+v2&format=json&language=en'

# OpenAI Responses 服务端搜索（DSH openai 后端）
curl -sS -X POST 'https://api.openai.com/v1/responses' -H 'Authorization: Bearer $OPENAI_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"model":"gpt-4.1","input":"Latest OpenCode v2 release?","tools":[{"type":"web_search"}]}'

# Anthropic Messages 服务端搜索（DSH anthropic/deepseek 后端）
curl -sS -X POST 'https://api.anthropic.com/v1/messages' \
  -H 'x-api-key: $ANTHROPIC_API_KEY' -H 'anthropic-version: 2023-06-01' -H 'Content-Type: application/json' \
  -d '{"model":"claude-sonnet-4-6","max_tokens":1024,"messages":[{"role":"user","content":"Latest OpenCode v2 release?"}],"tools":[{"type":"web_search_20250305","name":"web_search","max_uses":3}]}'
```

## 6. 权威链接清单（按主题，2026-11-04 核验）

**用户插件（A/B/C）**
1. [240xu/dsh-websearch README「Backends」表](https://github.com/240xu/dsh-websearch/blob/main/README.md)
2. [CHANGELOG.md](https://github.com/240xu/dsh-websearch/blob/main/CHANGELOG.md)
3. [lib/backends/exa.js](https://github.com/240xu/dsh-websearch/blob/main/lib/backends/exa.js)
4. [lib/backends/parallel.js](https://github.com/240xu/dsh-websearch/blob/main/lib/backends/parallel.js)
5. [lib/backends/ddg.js](https://github.com/240xu/dsh-websearch/blob/main/lib/backends/ddg.js)
6. [lib/backends/searxng.js](https://github.com/240xu/dsh-websearch/blob/main/lib/backends/searxng.js)
7. [lib/backends/brave.js](https://github.com/240xu/dsh-websearch/blob/main/lib/backends/brave.js)
8. [lib/backends/tavily.js](https://github.com/240xu/dsh-websearch/blob/main/lib/backends/tavily.js)
9. [lib/backends/serper.js](https://github.com/240xu/dsh-websearch/blob/main/lib/backends/serper.js)
10. [lib/backends/mojeek.js](https://github.com/240xu/dsh-websearch/blob/main/lib/backends/mojeek.js)
11. [lib/backends/anthropic-like.js](https://github.com/240xu/dsh-websearch/blob/main/lib/backends/anthropic-like.js)
12. [lib/backends/openai.js](https://github.com/240xu/dsh-websearch/blob/main/lib/backends/openai.js)
13. [npm @240xu/dsh-websearch](https://www.npmjs.com/package/@240xu/dsh-websearch)

**厂商官方文档（B）**
14. [Tavily Search API](https://docs.tavily.com/api-reference/endpoint/search)
15. [Tavily Best Practices](https://docs.tavily.com/documentation/best-practices/best-practices-search)
16. [Exa OpenAPI spec](https://github.com/exa-labs/openapi-spec/blob/master/exa-openapi-spec.yaml)
17. [Exa Search Best Practices（现行页）](https://exa.ai/docs/search/best-practices) — 旧 `/docs/search-best-practices` 已 404（03 报告审计）
18. [Brave Search API](https://api-dashboard.search.brave.com/app/documentation)
19. [SearXNG Search API](https://docs.searxng.org/dev/search_api.html)
20. [Perplexity Sonar / chat completions](https://docs.perplexity.ai/)
21. [Serper](https://serper.dev/)
22. [Mojeek](https://www.mojeek.com/)
23. [Firecrawl docs](https://docs.firecrawl.dev/)
24. [TinyFish](https://agent.tinyfish.ai/)
25. [OpenAI Responses web_search](https://developers.openai.com/api/docs/guides/tools-web-search.md)
26. [Anthropic Web search tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool.md)
27. [Google grounding with Google Search](https://cloud.google.com/vertex-ai/generative-ai/docs/grounding/grounding-with-google-search)
28. [DeepSeek Tool Calls](https://api-docs.deepseek.com/guides/tool_calls.md)

**OpenCode v2（A，带 v2.2.5 ref）**
29. [exa.ts](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/exa.ts)
30. [firecrawl.ts](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/firecrawl.ts)
31. [parallel.ts](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/parallel.ts)
32. [tavily.ts](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/tavily.ts)
33. [tinyfish.ts](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/tinyfish.ts)
34. [mcp.ts](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/mcp.ts)
35. [schema/src/websearch.ts](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/schema/src/websearch.ts)
36. [websearch.mdx](https://raw.githubusercontent.com/anomalyco/opencode/v2.2.5/services/www/src/docs/content/websearch.mdx)
37. [Console hosted web search](https://opencode.ai/v2/docs/console/websearch)

**本机证据（D）**
38. [00-lead-live-probe.md](00-lead-live-probe.md)
39. [13-raw-evidence.txt](13-raw-evidence.txt)

## 7. 待确认（E）

- Tavily REST、Brave、Serper、Mojeek、SearXNG 的**本机实搜**未执行（部分需 key）；字段依据来自本地 2.8.4 源码与厂商文档，未逐条 fetch 官方正文的标 E。
- Perplexity Sonar、Google Custom Search / Vertex grounding、Bing、Serper 官方文档本次未逐字核实正文（03/06 报告部分覆盖），相关计费/限额数字以 README 为准标 B/E。
- 2.8.7 的 `lib/config.js` 分支来源未核实（见 12 §7）。
- 引用失效两处（Exa 旧 URL 404、Anthropic「结果块前置」未检索到）见 03 §8 与 12 §5，需更新/降级。

---

## 附录 · 续研补充（2026-11-05）

> **不改动上文任何结论。** 本附录只做「E 级待核实项升级」与「新增官方证据」，上文 §0–§7 的 173 行一字未改。
> 续研方法（D）：全程只读，经 `http://172.30.66.1:1091` 用 `curl -x` 抓取厂商官方 `.md` 页面；未改源码/配置、未重启服务、未写入任何 GitHub token 值。凡本附录新增结论均按 A/B/C/D/E 分级并给四联标注（结论 → 依据 → 代码落点 → 验证方式；缺项标 E）。
> 版本口径继续沿用上文 §0：远端/npm **2.8.8**、CHANGELOG 到 **2.8.6**、本机 **2.8.4**；版本依据 = npm view time/dist-tags + GitHub commit sha（C）。OpenCode 一律 v2（`anomalyco/opencode` **v2.2.5**），v1 只作对比。
> 本附录对应的原文缺口来自上文 §7「待确认（E）」四条。

### A.1 官方端点与字段的 B 级升级（逐字核实）

**A.1.1 Perplexity Sonar `/chat/completions`：结论与边界（升级上文 §7 第 2 条）**

| 项 | 结论 | 证据 |
|---|---|---|
| 端点与认证 | `POST https://api.perplexity.ai/chat/completions`，`Authorization: Bearer $PERPLEXITY_API_KEY`，OpenAI 兼容 `messages[]`/`choices[]` | B：`https://docs.perplexity.ai/api-reference/chat-completions.md`（HTTP 200，2026-11-05 复核；`.md` 与 HTML 版同内容） |
| 生命周期 | **「Sonar Chat Completions support ended on September 27, 2026」**；同步/流式仍在但被逐步 reformulate 为 Agent API 请求；异步不再支持 | B：同上逐字，2026-11-04 与 11-05 两次抓取一致 |
| 顶层参数 | `search_recency_filter`（`month` 等）、`search_domain_filter`（数组）逐字出现在官方迁移文档 Sonar 示例中；迁移到 Agent API 后二者移入 `web_search` 工具的 `filters` | B：`https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar/how-to.md:437-479,434`（HTTP 200） |
| 响应字段 | `citations: string[]`（URL 数组）、`search_results[].{title,url,date,last_updated,snippet,source:"web",place_metadata}`、`choices[].message.content`、`object:"chat.completion"` | B：`chat-completions.md:138-162` 官方 Sonar response 示例逐字 |
| **仍为 E** | `return_citations` / `return_images` / `return_related_questions` / `web_search_options` / `top_k` / `search_mode` 的逐字段约束：当前官方 `api-reference/chat-completions` URL 已重定向到迁移页，旧参数参考正文未取到，**不得当确定结论**。上表只写有逐字出处的两个参数 | B（停服事实）+ E（旧开关细节） |

四联标注示例：**结论**＝Sonar 现在只能作为「存量兼容」而非新接入选型，新接入应走 Agent API（`POST /v1/agent`，`effort`+`input`，响应 `output[].{type:"search_results"|"message"}`，见 `chat-completions.md:164-194`）或 Search API（`POST /search`）。**依据**＝B（上述两个 URL + `https://docs.perplexity.ai/docs/getting-started/pricing.md`，HTTP 200：Search API **$5.00/1K 成功请求**、Fast Search $1.00/1K，按成功请求计费、一次最多 5 个 query 仍算 1 单位；Agent API `web_search` 工具 **$0.0025/次**、Fast **$0.001/次**、`fetch_url` $0.0005/次）。**代码落点**＝A：本机 unified 插件 `lib/backends/` 下**无** perplexity 后端（10 个文件逐个读过，`README.md:18-30` 后端表亦无），故无改动落点。**验证**＝D：`curl -x http://172.30.66.1:1091` 对 3 个官方 `.md` 页均 HTTP 200；**真实带 key 调用 `/chat/completions` 未执行 → E**。

> 附带升级：`https://docs.perplexity.ai/api-reference/search.md`（HTTP 200）是现行 **Search API** 参考（只返回排序 JSON、无生成答案），与 Sonar/Agent API 是三件不同的事；上文 §1 的 Perplexity 行不应把三者混为一谈。

**A.1.2 Brave `/res/v1/web/search`（升级上文 §7 第 1 条 + 表 `extra_snippets`/`freshness`）**

| 字段 | 官方逐字结论 | 证据 |
|---|---|---|
| 端点 / 认证 | `GET https://api.search.brave.com/res/v1/web/search`，`X-Subscription-Token: <YOUR_API_KEY>`（所有 curl 示例逐字） | B：`https://api-dashboard.search.brave.com/app/documentation/web-search/query`（HTTP 200，109616 B）与 `/web-search`（HTTP 200，同内容） |
| `freshness` | `pd`(24h) / `pw`(7d) / `pm`(31d) / `py`(1 年) / 自定义 `2022-04-01to2022-07-30` | B：同上「Freshness Filtering」段 |
| `extra_snippets` | `extra_snippets=true` → `web.results[]` 每条多出 `extra_snippets: string[]`（最多 5 个额外摘录）；官方给了含 `title`/`url`/`description`/`extra_snippets[]` 的 JSON 示例 | B：同上「Extra Snippets」段逐字 |
| `goggles` | 支持 URL 或内联定义、可组合多个，用于 boost/demote 站点与自定义重排 | B：同上「Goggles Support」段 |
| 分页 | `count` max 20 / 默认 20；`offset` 0-based / max 9；**建议按 `query.more_results_available` 决定是否翻页**（官方给了 `query.original` + `more_results_available` JSON 示例） | B：同上「Pagination / Best Practice」段 |
| 其它 | `country`(2 字符)、`search_lang`、`ui_lang`、`safesearch`(off/moderate 默认/strict)、`enable_rich_callback`；q 内嵌 `"短语"`/`-term`/`site:`/`filetype:`；响应另有 `rich` 字段（Calculator/Definitions/Weather/Stock… 各带 `subtype`，部分需署名） | B：同上 |
| **仍为 E** | `result_filter` 与 `summary`：本轮两个 Brave 文档页正文均**未逐字出现**这两个参数（`summary` 属 Brave **Answers / AI Search / LLM Context** 产品线，不是 Web Search 端点参数）；`infobox` / `mixed` 顶层对象的 JSON 示例本轮亦未取到 | E，待核实，勿写成确定字段 |
| 计费 | `https://brave.com/search/api/`（HTTP 200）：「Up to **$20 in free calls every month** · Prepaid credits, no subscription」；同页公告「Microsoft retired the Bing Search APIs. Google closed Custom Search API to new customers.」 | B；`api-dashboard.../documentation/pricing` 与 `brave.com/search/api/pricing/` 均 404 → **未取到，待核实** |
| 上文 README 数字 | 「2000/月免费」出自插件 `brave.js:5` 作者注释（D 级），本轮官方正文未逐字取到该数字 → 保留 D/E，不升级为 B | D/E |

四联标注：**结论**＝Brave Web Search 的 `X-Subscription-Token`/`freshness(pd|pw|pm|py)`/`extra_snippets`/`goggles`/`count,offset`/`query.original,more_results_available` 全部可从官方 B 级文档逐字确认，`result_filter`/`summary`/`infobox`/`mixed` 仍为 E。**依据**＝B（上表两个 URL，2026-11-05 HTTP 200）。**代码落点**＝A：`~/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/lib/backends/brave.js:13,35-40,53,91-104`（`q`+`count`+`X-Subscription-Token`，解析 `data.web.results[]` 的 `url/title/description→snippet/age→publishedAt`），`lib/util/filters.js:55-61`（`freshness`/`country`/`search_lang` 映射 + `RECENCY_MAP.brave = {day:pd,week:pw,month:pm,year:py}`，`:25`）。**验证**＝D：官方页 curl HTTP 200；**带 key 实搜 Brave 未执行 → E**。

**A.1.3 Google Custom Search JSON API / Vertex grounding / Bing / Serper（升级上文 §7 第 2 条）**

| 项 | B 级逐字结论 | 证据 |
|---|---|---|
| CSE 端点 | `GET https://www.googleapis.com/customsearch/v1?key=<API_KEY>&cx=<PSE_ID>&q=<query>`，三必填 `key`/`cx`/`q`，请求长度 ≤2048 字符 | B：`https://developers.google.com/custom-search/v1/using_rest`（HTTP 200，行 75-91） |
| CSE 响应 | `items[]`（URL/title/snippet/`htmlTitle`/rich `pagemap`）、`queries.{request,nextPage,previousPage}`（**最多前 100 条结果**）、`context`、`promotions`、`searchInformation` | B：同上 行 113-153 |
| CSE 限额/合规 | **100 次/天免费，超出付费**；**「closed to new customers」**，现有客户 **2027-01-01** 前迁移；官方建议 Vertex AI Search（≤50 域） | B：`https://developers.google.com/custom-search/v1/overview`（HTTP 200，行 53-58） |
| CSE 全部参数 | `num,start,dateRestrict,siteSearch,siteSearchFilter,fileType,filter,gl,lr,cr,exactTerms,excludeTerms,orTerms,linkSite,hq,safe,searchType,c2coff,lowRange,highRange,imgColorType,googlehost` | B：`.../reference/rest/v1/cse/list`（HTTP 200） |
| Gemini grounding | `tools:[{"type":"google_search"}]`（旧模型 `google_search_retrieval`）；响应 `google_search_call.queries[]`、`google_search_result.search_suggestions`、`model_output.text.annotations[].{type:"url_citation",url,title,start_index,end_index}` | B：`https://ai.google.dev/gemini-api/docs/google-search`（HTTP 200，行 140-198、378-379） |
| Gemini grounding 计费 | Gemini 3+ 按模型执行的**每个搜索 query** 计费：每月 **5,000 次免费**共享额度，之后 **$14/1,000 次搜索**；默认 **1,500 RPD**（Paid Tier，AI Studio 申请提高 `generate_content_search_request_paid`）；2.5 及更早按 prompt 计费 | B：同上 行 338-359 |
| Vertex grounding | `https://cloud.google.com/vertex-ai/generative-ai/docs/grounding/grounding-with-google-search` HTTP 200（498373 B）；经典 `groundingMetadata.groundingChunks[].web.{uri,title}` / `groundingSupports[]` / `searchEntryPoint.renderedContent` 在 Vertex 文档体系中，**本轮未逐字抽取 → 部分 E** | B（页面可达）+ E（字段逐字） |
| Bing v7 参数 | `q`(必填)、`count`(默认 10/max 50)、`offset`、`freshness`(Day/Week/Month 或 `YYYY-MM-DD..YYYY-MM-DD`)、`mkt`/`cc`/`setLang`、`safeSearch`、`answerCount`/`promote`/`responseFilter`（`Webpages,Images,News,Videos,Entities,RelatedSearches,SpellSuggestions,TimeZone,Translations,Computation,Places`，可 `-images`）、`textDecorations`/`textFormat` | B：`https://learn.microsoft.com/en-us/bing/search-apis/bing-web-search/reference/query-parameters`（HTTP 200，行 27-81） |
| Bing 端点/认证/状态 | 端点与 `Ocp-Apim-Subscription-Key` 本轮 Learn 正文**未逐字取到 → E**；退役事实由 `https://brave.com/search/api/` 公告佐证（B），Learn overview 页最后更新 `2025-05-07` | E + B |
| Serper 响应 | `organic[].{title,link,snippet,position,date,publicationInfo,citedBy}`、`news[].{title,link,snippet,date,source}`、`answerBox`、`knowledgeGraph`、`peopleAlsoAsk`、`relatedSearches`、`places[]`、`videos[]`、`shopping[]`、`images[]`、`suggestions[]`、`credits` | B：`https://serper.dev/`（HTTP 200，官网内嵌真实 SERP 示例） |
| Serper 计费 | **2,500 queries 免费**；top-up 无月订阅：$50/50k credits($1.00/1k)、$375/500k($0.75/1k)、$1250/2.5M($0.50/1k)、$3750/12.5M($0.30/1k)；credits 有效 6 个月；默认 50 QPS（Ultimate 300 QPS）；实时查 Google 不缓存；仅成功响应扣费 | B：`https://serper.dev/` 定价区逐字 |

四联标注：**结论**＝上文 §7 第 2 条「Google CSE / Vertex grounding / Bing / Serper 官方文档未逐字核实」现已解除：CSE、Gemini grounding、Bing 参数表、Serper 响应+定价均有 B 级逐字出处；仅 Bing 端点/认证头、Vertex `groundingMetadata` 字段细节保留 E。**依据**＝B（上表 6 个 URL，2026-11-04/05 HTTP 200）。**代码落点**＝A：CSE 与 Gemini grounding 在 unified 插件中**无后端**（`lib/backends/` 10 文件 + `README.md:18-30` 无此项）；Serper 落点 `lib/backends/serper.js:13,36-40,92-119`（`q`+`num`+`X-API-KEY`，解析 `organic[]` 与 `news[]` 的 `link→url`/`title`/`snippet`/`date→publishedAt`），`lib/util/filters.js:71-77`（`tbs=qdr:d|w|m|y`、`hl`、`gl`）。**验证**＝D：官方页 curl HTTP 200；**带 key 实搜 CSE/Gemini/Bing/Serper 均未执行 → E**。

**A.1.4 DeepSeek 官方 Tool Calls 文档（升级上文权威链接清单第 28 条）**

| 项 | B 级逐字结论 | 证据 |
|---|---|---|
| 定位 | 「Tool Calls allows the model to call external tools… **the functionality of the `get_weather` function needs to be provided by the user. The model itself does not execute specific functions.**」；流程 = 模型返回 `tool_calls` → 用户执行 → 结果回灌 | B：`https://api-docs.deepseek.com/guides/tool_calls.md`（HTTP 200，行 2、52-55） |
| 格式 | `tools:[{type:"function",function:{name,description,parameters,strict?}}]`；完整格式以 `api/create-chat-completion` 为准；`base_url="https://api.deepseek.com"` | B：同上 行 7、12-25 |
| `strict` Beta | 需 `base_url="https://api.deepseek.com/beta"`，所有 function 设 `strict:true`，服务端校验 JSON Schema | B：同上 行 65-70 |
| 思考模式 | DeepSeek-V3.2 起支持 thinking mode 下 tool use；Anthropic API(`/messages`) 与 Responses API 支持对话中途插入 tool call / system 消息 | B：同上 行 58-62 |
| 与 §1 对照 | 对话侧 `tools[]` 仍「only functions are supported」（B：`api/create-chat-completion`）；专用检索走 `POST /v1/tools/search`（B：`guides/search`，**$0.75/1,000 成功请求**、Search 100 QPS / Fetch 25 QPS、仅非空中标计费）；DSH 两处实现却走 Messages + `web_search_20250305` | B + A |

四联标注：**结论**＝DeepSeek 官方检索的正确接法是「客户端 function call 循环 → 调 `/v1/tools/search`」，而不是把搜索塞进 Messages server tool；DSH 仓库实现是一搜索一模型回合的适配器。**依据**＝B（3 个 `api-docs.deepseek.com` 页，HTTP 200）+ A（下）。**代码落点**＝A：`/home/ova/dsh/packages/web/web-search-deepseek/src/provider.ts:34,218,221-229`（`https://api.deepseek.com/anthropic/v1` + `/messages` + `tools:[{type:"web_search_20250305",name:"web_search",max_uses:5}]`）、`src/index.ts:83,123-125`（`$DEEPSEEK_SEARCH_BASE_URL` 覆盖）、`src/types.ts:8-43`、`src/provider.ts:117-179`（`citationSnippets` 按 url join + URL 去重 + `page_age→publishedAt`）；社区插件 `lib/backends/anthropic-like.js:239-245,85-101,185-236`（`deepseekBackend` 同端点同模型，但只发 `x-api-key`+`Bearer`，无 `x-dsh-auth-token` 账号分支、无 `web/deepseek-search-llm-request` 会话日志）。**验证**＝D：官方页 curl HTTP 200；**真实带 key 打 `/v1/tools/search` 与 `/anthropic/v1/messages` 对比延迟/字段未执行 → E**。

> **P1 建议（E 级推断，四联）**：新接 DeepSeek 后端优先用 `/v1/tools/search`（原生 `snippet` 100-200 字符给 UI、`summary` 600-800 字符给模型、`rerank_score` 0-3、`authority` 0-4，天然适合 §4 归一化/重排），避免一次搜索一模型回合。依据 B（guides/search + tool_calls.md）；落点 A（上述 provider.ts，需新增 REST provider）；验证 E（未实测与 `WebSearchResult` 契约兼容性）。

**A.1.5 Exa / Tavily 计费与 legacy 字段（B 级补强，与上文表互补）**

- Exa（B：`https://exa.ai/docs/reference/search.md`，HTTP 200，内嵌 `exa-spec.yaml` v2.0.0）：`numResults` 1–100 默认 10；`includeDomains`/`excludeDomains` 各 ≤1200 条，官方明确「用参数而不是 `site:`」；`startPublishedDate`/`endPublishedDate` ISO 8601；`contents` 含 `text`/`highlights`/`summary`/`maxAgeHours`(-1..720，`0`=实时抓)/`snapshotAsOf`；响应 `results[].{title,url,publishedDate,author,id,image,favicon,text,highlights[],highlightScores[],summary,subpages}` + `requestId/costDollars/searchTime/warnings/notices`。**关键升级**：`useAutoprompt` / `autoprompt` / `searchAndContents` / `type:"neural"|"keyword"` / 响应 `score` 在当前 v2 spec **均不作为请求/响应字段**；`neural`/`keyword` 仅作 `costDollars.search.{neural,keyword}` 计费标签（行 1753-1767）；`category` 枚举为 `company|publication|news|personal site|financial report|people`（其它字符串作 hint），与插件 `inferExaCategory()` 注释里的 `github/research paper/pdf` 不一致 → **E 待核实**。`/contents` 响应含 `statuses[].{id,status,source}` 与 `costDollars.total`，官方建议 agent 场景直接在 `/search` 用 `contents:{highlights:true}`（每次搜索前 10 条内容免费，超出 $1/1000 页）。HTTP `402` = 额度/预算耗尽或 x402 支付质询。
- Tavily（B：`https://docs.tavily.com/documentation/api-reference/endpoint/search.md`，HTTP 200，OpenAPI 3.0.3）：`search_depth` 现有 `advanced|basic|fast|ultra-fast`（默认 `basic`）；**`basic/fast/ultra-fast` = 1 API Credit，`advanced` = 2 API Credits**（行 76-80）——这把上文表里的「advanced 2 credits」从 D/作者记录**升级为 B 级官方**；`auto_parameters:true` 可能自动把 depth 升到 advanced 多花 1 credit，显式设 `basic` 可避免（行 494-507）。`max_results` 0-20 默认 10；`chunks_per_source` 1-3 默认 3；`include_answer`(bool|basic|advanced)、`include_raw_content`(bool|markdown|text)、`time_range`/`start_date`/`end_date`/`include_published_date`(beta)/`filter_by_published_date`/`max_age_hours`(-1..720)、`include_domains`(≤300)/`exclude_domains`(≤150)/`include_domains_mode`(restrict|prefer)、`topic`(general|news|finance)、`country`/`language`/`filter_by_language`、`exact_match`、`include_usage`、`safe_search`。响应 `results[].{title,url,content,score,raw_content,published_date,favicon,images,id}` + `answer`/`images`/`auto_parameters`/`response_time`/`usage{credits}`/`request_id`；`required:[query,results,images,response_time,answer]`。`/extract`（B：`endpoint/extract.md`）：`urls` 单串或 1–20 数组、`query`(chunk 重排)、响应 `results[]` + `failed_results[]`，**HTTP 200 也须检查两个数组**。
- 四联标注（Exa/Tavily 计费升级）：**结论**＝Tavily `advanced=2 credits` 与 Exa `numResults`/日期/域过滤/402 语义均为官方 B 级；Exa 经典 `useAutoprompt`/`score`/`neural|keyword` 请求类型已不在 v2。**依据**＝B（上述 4 个官方 `.md`，HTTP 200）。**代码落点**＝A：`lib/backends/tavily.js:38-40,42-49,102-121`（`deepCoverage` 才把 `basic` 升 `advanced`，`include_answer:true`、`include_raw_content:false`；`answer` 放 `result.content` 不伪造 source）、`lib/backends/exa.js:19-29,41-52,85-103`（`inferExaCategory` 且只在 `deepCoverage` 时注入 `category`，避免悄悄收窄结果）、`lib/util/filters.js:24-30,64-68`（`tavily.time_range` 映射）。**验证**＝D：官方页 curl HTTP 200；**带 key 实搜未执行 → E**。

### A.2 Firecrawl 官方端点与计费（把 D/E 升级为 B —— Lead 指定重点）

**结论**：Firecrawl 有 v2 REST 三件套，且 **hosted keyless MCP 是官方 B 级事实**（不再是仅有 D 级实测）。

| 端点 | 官方入参（逐字） | 官方响应（逐字） | 计费（B） |
|---|---|---|---|
| `POST https://api.firecrawl.dev/v2/search` | `query`(≤500)、`limit`(1-100，默认 10，按 source 分别计)、`sources[]`(`web`/`images`/`news`/`alexandria`；`web` 可带 `tbs`(`qdr:h\|d\|w\|m\|y`、`cdr:1,cd_min:MM/DD/YYYY,cd_max:MM/DD/YYYY`、`sbd:1`)、`location`)、`categories`(`developer`/`gov`/`research`/`pdf` 对象或名称)、`tbs`、`location`、`country`(ISO，默认 US)、`timeout`(ms)、`scrapeOptions`、`ignoreInvalidURLs`、`integration`、`flags["zdr"\|"anon"]` | `{success, data:{ web:[{ title, description, url, markdown?, html?, rawHtml?, links?, screenshot?, audio?, video?, metadata:{title,description,sourceURL,url,statusCode,numPages,totalPages,…} }], images?, news?, tools? }, creditsUsed? }` | **2 credits / 10 results**，向上取整（11 条 = 4 credits）；额外结果 **$1/1,000**（官方表写「$1 / 1,000」在 Parallel 页，Firecrawl 侧为 credits 制）；`alexandria` 源免费且不计入 `creditsUsed`；ZDR `["zdr"]` 10 credits/10 results、`["anon"]` 2 credits/10 results |
| `POST https://api.firecrawl.dev/v2/scrape` | `url`、`formats[]`(`markdown`/`html`/`rawHtml`/`links`/`screenshot`/`json`/`summary`/`highlights`/`audio`/`video`…)、`onlyMainContent`、`waitFor`、`timeout`(≥1000ms)、`actions[]`、`proxy`、`maxAge`、`parsers`(`pdf`)、`checkPromptInjection` | `{success,data:{markdown,html,rawHtml,links,metadata,…}}` | **1 credit / page**；PDF +1/页；JSON 抽取/提示注入检查/`question`/`highlights`/`audio`/`video`/PII 各 +4 credits/page；ZDR +1/page；`proxy:"enhanced"` 不加价 |
| `POST https://api.firecrawl.dev/v2/crawl` | `url`、`limit`、`maxDepth`/`allowExternalLinks`/`regexOnFullURL`/`includePaths`/`excludePaths`、`scrapeOptions`、`webhook` | `{success,id,url}` + `GET /v2/crawl/{id}` 查状态 | **1 credit / page**（每页按 scrape 选项加价）；Google Web Risk 扫描 +2 credits/URL |

**keyless 官方 B 级证据（关键）**：
- `https://docs.firecrawl.dev/mcp-server.md`（HTTP 200）逐字：「**Set up Firecrawl MCP with keyless access, account sign-in, or an API key**」；「**Keyless server URL (Streamable HTTP, no credential): `https://mcp.firecrawl.dev/v2/mcp`**」（`mcp-server/keyless.md:11`，HTTP 200）；「No account or key. Search, Scrape, and Parse within daily limits.」
- `https://docs.firecrawl.dev/mcp-server/keyless.md:21,52`：「Keyless MCP is rate limited and exposes **Search, Scrape, and Parse**」；「A keyless connection shows `firecrawl_search`, `firecrawl_scrape`, and `firecrawl_parse`」；当前 keyless 额度指向 rate-limits 页。
- `https://docs.firecrawl.dev/rate-limits.md:69-80`（HTTP 200）逐字：「The hosted Firecrawl MCP keyless endpoint exposes exactly **Search, Scrape, and Parse** without an API key」；「Keyless usage is **free and capped per IP address per day by two limits**, and exceeding either returns a `429`: A maximum number of **requests** per day; A maximum number of **credits** per day」；「Sign up for a free API key to get **1,000 credits** and higher rate limits at no cost」。官方**未公布这两个上限的具体数字** → 具体数字仍 **E 待核实**；Lead 实测的「hosted keyless tier」升级为 B 级定性事实，其 `categories` / `conversationId` 仍是 D 级（00-lead-live-probe.md:45-50）。
- 计费总表 `https://docs.firecrawl.dev/billing.md`（HTTP 200）：credit-based，各 plan 月度 allotment + PAYG；「What decides the charge is whether Firecrawl returned a document, not whether the target site returned a successful HTTP status code」；403/404 只要返回 document 仍计费，彻底失败 0 credit。限流 `https://docs.firecrawl.dev/rate-limits.md`：按 team 计 RPM + 并发浏览器（Free 2 / Hobby 5 / Standard 25 / Growth 50 / Scale+ 100+），超限 429。

四联标注：**结论**＝Firecrawl REST 三端点字段/计费与 hosted keyless MCP 均有官方 B 级出处；keyless 每日具体请求数/credits 数官方未公布（E）。**依据**＝B（7 个 `docs.firecrawl.dev` 页，2026-11-05 HTTP 200，逐个列于 A.5）+ D（00-lead-live-probe.md:12,45-50 实测 `serverInfo firecrawl-fastmcp v3.36.1`、hosted keyless 三工具、`categories`/`conversationId`）+ C（`anomalyco/opencode` v2.2.5 `firecrawl.ts:10` 端点）。**代码落点**＝A：unified 插件 `lib/backends/` 下**无** `firecrawl.js`（10 文件逐个读过）→ 上文 §7/00-lead-live-probe.md 的「P0 新增 firecrawl backend」仍为建议；可复用 `lib/util/mcp-client.js`（`README.md:204,215` 的 `initialize → notifications/initialized → tools/call` + `Mcp-Session-Id` 缓存）。**验证**＝D：Lead 已实测 4 端点 initialize HTTP 200；**`firecrawl_search` 实搜与 keyless 日上限实测未做 → E**。

```bash
# Firecrawl v2 REST（B，官方 OpenAPI）
curl -X POST https://api.firecrawl.dev/v2/search \
  -H "Authorization: Bearer $FIRECRAWL_API_KEY" -H "Content-Type: application/json" \
  -d '{"query":"LLM agent web search APIs","limit":8,"sources":[{"type":"web","tbs":"qdr:m"}],"country":"US","scrapeOptions":{"formats":[{"type":"markdown"}]}}'
curl -X POST https://api.firecrawl.dev/v2/scrape \
  -H "Authorization: Bearer $FIRECRAWL_API_KEY" -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/article","formats":["markdown"],"onlyMainContent":true}'
curl -X POST https://api.firecrawl.dev/v2/crawl \
  -H "Authorization: Bearer $FIRECRAWL_API_KEY" -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/docs","limit":20,"scrapeOptions":{"formats":["markdown"]}}'
```

### A.3 TinyFish 官方端点与计费（B 级）

**结论**：TinyFish 是「Web Infrastructure for AI Agents」四产品线（TinySearch / TinyFetch / TinyBrowser / TinyAgent）+ TinyMonitor，共用一个 API key / Wallet；**TinySearch 与 TinyFetch 免费**。

| 项 | B 级逐字结论 | 证据 |
|---|---|---|
| 定价 | **TinySearch Free**：`30 requests / min · 500 requests / hour`，`$0.00 per request`；**TinyFetch Free**：`150 urls / min · 1,000 urls / day`，`$0.00 per url`；**TinyAgent $0.016/step**（2 并发）；**TinyBrowser $0.002/minute**（5 并发）；**TinyMonitor $0.005/check**；无订阅无最低消费，新账号 `$8` Wallet，充值最低 $10 | `https://www.tinyfish.io/pricing`（HTTP 200）+ `https://tinyfish.io/`（HTTP 200，定价区与「Cost per task」段逐字） |
| 定位 | 「Fresh results from the live web. Never cached. Real browser-rendered search that returns structured JSON」；「search hits Google's actual live index through a real browser… You get typed JSON objects back, not markdown blobs」 | `https://tinyfish.io/`（B） |
| keyless MCP | `https://agent.tinyfish.ai/mcp`；`X-TinyFish-Access-Mode: keyless`；**keyless 限额 30 req/min + 50 searches/UTC day**、tool `search` 的 `purpose`「按意图排序」、`after_date`/`before_date`/`recency_minutes`/`domain_type` 等字段 | **D**（00-lead-live-probe.md:14,52-58 的 `tools/list` 逐字 + instructions）+ **C**（OpenCode v2.2.5 `tinyfish.ts:11`）；厂商官网未逐字给出 MCP keyless 限额 → 该数字保留 D 级，**不与官网 TinySearch 的 30 req/min · 500 req/hour 混为一谈**（两者是不同接入面，口径差异标 E 待核实） |
| 端点 | `https://docs.tinyfish.ai/` HTTP 200（182679 B）为官方文档入口；`https://docs.tinyfish.io/` 本机 DNS/TLS 失败（`000`）→ **未取到，待核实** | B + E |
| 横向 | 官网 Artificial Analysis Search Index（2026-10-19）对比：TinyFish Search(web) 搜索费 $0、总任务 $0.0093；Octen $0.024、Firecrawl $0.043、Exa lite $0.044、OpenAI Web Search $0.050、Perplexity Search $0.067 | B（官网，属厂商自引第三方基准，**仅作数据不作结论**） |

四联标注：**结论**＝TinyFish 官方 REST/产品定价为 B 级（TinySearch/TinyFetch 免费 + 明确 RPM/日限），MCP keyless 的 30 req/min + 50 searches/day 与 `purpose`/日期字段仍为 D 级（Lead 实测），两者口径不同需分开写。**依据**＝B（tinyfish.io + tinyfish.io/pricing + docs.tinyfish.ai，HTTP 200）+ D（00-lead-live-probe.md:14,52-58）+ C（v2.2.5 `tinyfish.ts`）。**代码落点**＝A：unified 插件无 `tinyfish.js`（10 文件逐个读过）→ 00-lead-live-probe.md 的 P0 新增仍为建议；参照 `lib/backends/parallel.js:91-116` 的 `parseParallelResult` 结构。**验证**＝D：Lead 已实测 MCP initialize HTTP 200；**`search` 实搜与官网 30/500 限额实测未做 → E**。

### A.4 Parallel 官方 REST 端点与计费（B 级，补上文缺口）

**结论**：Parallel 不只有 MCP，还有官方 REST `POST https://api.parallel.ai/v1/search`（新接入一律用 `/v1/search`、`/v1/extract`；`/v1beta/*` 仅供存量）。

| 项 | B 级逐字结论 | 证据 |
|---|---|---|
| 端点/认证 | `POST https://api.parallel.ai/v1/search`，`x-api-key: <api-key>` + `Content-Type: application/json` | `https://docs.parallel.ai/api-reference/search/search.md`（HTTP 200，内嵌 `public-openapi.json`，curl 示例 `:208-215`） |
| 入参 | `objective`（自然语言研究目标）、`search_queries`（2-3 个 3-6 词关键词查询，**与 objective 二者皆必填且角色不同**）、`mode`(`turbo`/`fast`/`basic`/`advanced`)、`max_results`（默认 10）、`source_policy` 等 | B：同上 `:19-21,48-64,220-248` + `https://docs.parallel.ai/`（HTTP 200） |
| 响应 | `search.results[].{url,title,publish_date,excerpts[]}`（OpenAPI 示例 `:165-170` 逐字），字段保持 snake_case（`:71`） | B：同上 |
| 迁移注意 | `/v1/extract` 把 `full_content`/`fetch_policy`/`excerpt_settings` 移入 `advanced_settings`；把 v1beta 顶层字段发给 `/v1/extract` 会 422；「Do not substitute `/v1` for the documented FindAll or Ingest endpoint paths」 | B：`https://docs.parallel.ai/getting-started/pricing.md:9`、`https://docs.parallel.ai/` 概览段 |
| 计费 | **Search $1–$5 / 1,000 请求**（含 10 结果；额外结果 $1/1,000）：`turbo`/`fast` = **$1/1K**、`basic`/`advanced` = **$5/1K**；**Extract $1/1,000 URLs**；Image Search $1–$5/1K；Decisions $1/1K；Task $5–$2,400/1K successful runs（`core`25/`pro`100/`ultra`300/`ultra8x`2400）；Responses $10–$250/1K；FindAll $0.25/run + $0.03/match；Entity Search $5/1K | B：`https://docs.parallel.ai/getting-started/pricing.md`（HTTP 200，行 15-35,49-62,76-106,131-144） |
| MCP | `https://search.parallel.ai/mcp`（keyless 可用）、`web_search{objective,search_queries[],session_id?,model_name?}` → `{search_id,results:[{url,title,publish_date,excerpts[]}],warnings}`；instructions 显式「并发调用 / 合批 / 多 query 一次调用 / excerpts 够用就不逐条 fetch」 | C（OpenCode v2.2.5 `parallel.ts:10`）+ A（`lib/backends/parallel.js:20-40,91-116`）+ D（00-lead-live-probe.md:11,34-43,60-76 真实 `tools/call` 实搜命中 `opencode.ai/v2/docs/console/websearch`） |
| Console hosted | OpenCode v2 Console hosted web search **$0.01/成功搜索**、workspace 级启用、成员免 key、最多 8 条、失败/限流不计费、零留存 | **D**（由 Parallel 实搜命中的页面，00-lead-live-probe.md:78-85），非厂商 API 文档 → 上文已标 D，此处不升级 |

四联标注：**结论**＝Parallel 官方 REST 端点、字段、分模式定价已从「E 待核实」升级为 B；MCP 形态与 Console 定价仍分别是 A/C 与 D。**依据**＝B（4 个 `docs.parallel.ai` 页，HTTP 200）+ C/D（上表）。**代码落点**＝A：`~/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/lib/backends/parallel.js:20-21,35-40,91-116`（MCP `web_search`，`parseParallelResult` 把 `excerpts[0]`→`snippet`、`publish_date`→`publishedAt`），`lib/util/mcp-client.js`。**验证**＝D：Lead 实测 MCP HTTP 200 且真实搜索返回；**REST `/v1/search` 带 key 实搜未执行 → E**。

```bash
# Parallel REST（B，官方 curl 示例改写）
curl --request POST --url https://api.parallel.ai/v1/search \
  --header "x-api-key: $PARALLEL_API_KEY" --header 'Content-Type: application/json' \
  --data '{"objective":"Find recent benchmarks of web search APIs for LLM agents",
           "search_queries":["web search API benchmark 2026","Exa Tavily Brave comparison"],
           "mode":"fast","max_results":10}'
```

### A.5 上文 §7「待确认（E）」逐条结算

| 原 E 项 | 结算 |
|---|---|
| ① Tavily REST / Brave / Serper / Mojeek / SearXNG 字段未逐字 fetch 官方正文 | **Tavily / Brave / Serper 已升级 B**（A.1.2、A.1.3、A.1.5）；**Mojeek 仍为 E**：`https://www.mojeek.com/services/api/` 与 `/services/api/web-search` 两个 URL 均 **404**（2026-11-04/05），厂商 API 正文未取到，「1000/天免费」仍只出自插件 `mojeek.js:5`（D）；**SearXNG**：`https://docs.searxng.org/dev/search_api.html` HTTP 200（B，页面存在且含 `format=json`/`categories`/`language`/`time_range`/`safesearch`/`pageno` 的 API 说明），但**带 `results[]` 的完整响应 schema 本轮未逐字抽取 → 部分 E**。带 key 实搜五家均未执行 → E |
| ② Perplexity Sonar / Google CSE / Vertex grounding / Bing / Serper 官方文档未逐字核实 | **大部分升级 B**（A.1.1、A.1.3）；仍 E：Sonar 旧开关 `return_citations`/`return_images`/`web_search_options` 逐字段约束（官方页已重定向到迁移页）、Bing 端点与 `Ocp-Apim-Subscription-Key` 逐字、Vertex `groundingMetadata` 字段逐字、Brave `result_filter`/`summary`/`infobox`/`mixed` 逐字示例 |
| ③ 2.8.7 `lib/config.js` 分支来源 | **维持 E**：`gitHead=608e474fdf58…` public 仓库 422、tarball 多出 `lib/config.js`（2.8.8 又合回 index.js），见上文 §0 / 08 / 12 报告；本附录不改动该结论 |
| ④ 引用失效两处 | **一处可升级**：Exa 现行 `search.md` 官方页明确 `type` 的 `instant`/`fast`/`deep-reasoning` 为 **Legacy**，且 coding-agent 指南提示勿臆造 `category` 值（B：`https://exa.ai/docs/reference/search.md:316-328`）；另一处（Anthropic「结果块前置」）本轮未检索到官方原文 → **维持 E** |

**仍未升级为 B 的 E 项汇总（勿当结论）**：Mojeek 官方 API 文档（404）；SearXNG 完整响应 schema；Brave `result_filter`/`summary`/`infobox`/`mixed`；Sonar 旧开关键集合与逐字段约束；Bing 端点/认证头逐字；Vertex `groundingMetadata` 字段逐字；Firecrawl keyless 每日请求数/credits 具体数字；TinyFish MCP keyless 与官网 REST 限额口径差异；Exa `useAutoprompt`/`score`/`neural|keyword` 旧字段（v2 spec 已无，属历史而非当前）；2.8.7 分支来源；各后端带 key 实搜（Tavily/Brave/Serper/Mojeek/SearXNG/CSE/Gemini/Bing/Parallel REST/DeepSeek `/v1/tools/search`）。

### A.6 追加权威链接清单（B 级，按 provider 分组，均为 2026-11-04/05 经 `http://172.30.66.1:1091` 抓取；上文 §6 的 39 条不重复、不覆盖）

**Exa / Tavily**
40. https://exa.ai/docs/reference/search.md — Exa v2 `/search` 全量 OpenAPI（含 Legacy `type`、category 枚举、costDollars）（B）
41. https://exa.ai/docs/contents/quickstart.md — `/contents` 请求/响应/`statuses`/`costDollars`（B）
42. https://exa.ai/docs/llms.txt — 官方索引 + Agent Instructions（`Authorization: Bearer`/`x-api-key`/MCP/OpenAPI 真源）（B）
43. https://docs.tavily.com/documentation/api-reference/endpoint/search.md — `/search` 全量入参与响应 + credits（B）
44. https://docs.tavily.com/documentation/api-reference/endpoint/extract.md — `/extract` + `failed_results[]`（B）

**Perplexity**
45. https://docs.perplexity.ai/api-reference/chat-completions.md — Sonar 停服公告 + `citations[]`/`search_results[]` 响应示例（B）
46. https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar/how-to.md — `search_recency_filter`/`search_domain_filter` 逐字示例与迁移映射（B）
47. https://docs.perplexity.ai/docs/getting-started/pricing.md — Search API $5/1K、web_search 工具 $0.0025/次（B）
48. https://docs.perplexity.ai/api-reference/search.md — 现行 Search API 参考（B）

**Google / Bing / Serper**
49. https://developers.google.com/custom-search/v1/using_rest — `key/cx/q`、`items[]`、`queries`、100 条上限（B）
50. https://developers.google.com/custom-search/v1/overview — 100/天免费、对新客户关闭、2027-01-01 迁移（B）
51. https://developers.google.com/custom-search/v1/reference/rest/v1/cse/list — 全部 query 参数（B）
52. https://ai.google.dev/gemini-api/docs/google-search — `google_search`、`url_citation`、$14/1K、5,000/月、1,500 RPD（B）
53. https://cloud.google.com/vertex-ai/generative-ai/docs/grounding/grounding-with-google-search — Vertex 侧 grounding（B 可达，字段部分 E）
54. https://learn.microsoft.com/en-us/bing/search-apis/bing-web-search/reference/query-parameters — Bing v7 参数逐字（B）
55. https://serper.dev/ — 真实 Google SERP 示例 + 2,500 免费 + $0.30–1.00/1k 定价（B）

**Brave**
56. https://api-dashboard.search.brave.com/app/documentation/web-search/query — `X-Subscription-Token`/`freshness`/`extra_snippets`/`goggles`/`count,offset`/`query.original`（B）
57. https://brave.com/search/api/ — $20/月免费额度、独立索引、Bing/Google 退役公告（B）
    - `https://api-docs.search.brave.com/`（本机 TLS `SSL_ERROR_SYSCALL`）、`.../documentation/pricing`（404）、`brave.com/search/api/pricing/`（404）→ **未取到，待核实**

**DeepSeek**
58. https://api-docs.deepseek.com/guides/search — `/v1/tools/search` + `/v1/tools/fetch` 全字段、运算符、错误、$0.75/1K、100/25 QPS（B）
59. https://api-docs.deepseek.com/api/search、https://api-docs.deepseek.com/api/fetch — 两端点 OpenAPI（B）
60. https://api-docs.deepseek.com/guides/tool_calls.md — 客户端 function call 循环、`strict` Beta、thinking mode（B）
61. https://api-docs.deepseek.com/api/create-chat-completion — `tools[]` 仅 function（B）

**Firecrawl（本次新增 B 级重点）**
62. https://docs.firecrawl.dev/api-reference/endpoint/search.md — v2 `/search` OpenAPI（`query,limit,sources,categories,tbs,country,scrapeOptions` → `data.web[]`）（B）
63. https://docs.firecrawl.dev/api-reference/endpoint/scrape.md — v2 `/scrape` OpenAPI（B）
64. https://docs.firecrawl.dev/api-reference/endpoint/crawl.md — v2 `/crawl` OpenAPI（B）
65. https://docs.firecrawl.dev/billing.md — credit 制、Search 2 credits/10 results、Scrape/Crawl 1 credit/page、加价项（B）
66. https://docs.firecrawl.dev/rate-limits.md — **Keyless (no API key)** 段：hosted MCP 仅 Search/Scrape/Parse、按 IP 每日双上限、免费 key 1,000 credits（B；具体数字 E）
67. https://docs.firecrawl.dev/mcp-server.md 与 https://docs.firecrawl.dev/mcp-server/keyless.md — **Keyless server URL `https://mcp.firecrawl.dev/v2/mcp`（no credential）** 逐字（B）
68. https://docs.firecrawl.dev/llms.txt — 官方索引（B）

**Parallel / TinyFish（本次新增）**
69. https://docs.parallel.ai/api-reference/search/search.md — `POST https://api.parallel.ai/v1/search`、`x-api-key`、`objective`+`search_queries`、`search.results[].{url,title,publish_date,excerpts[]}`（B）
70. https://docs.parallel.ai/getting-started/pricing.md — Search $1–$5/1K、Extract $1/1K URLs、Task/Responses/FindAll 分档（B）
71. https://docs.parallel.ai/getting-started/rate-limits.md、https://docs.parallel.ai/ — 概览与 `/v1` vs `/v1beta` 迁移约束（B）
72. https://www.tinyfish.io/pricing — TinySearch/TinyFetch 免费 + 30 req/min·500/hour、150 urls/min·1,000/day、TinyAgent $0.016/step 等（B）
73. https://tinyfish.io/ — 产品定位、结构化 JSON、Artificial Analysis 对比（B）；https://docs.tinyfish.ai/（HTTP 200，官方文档入口，B）
    - `https://docs.tinyfish.io/`（本机 `000`）→ **未取到，待核实**

**本机/实测（D，非厂商文档）**
74. `/home/ova/dsh/.artifacts/websearch-research/00-lead-live-probe.md` — 4 个 MCP 端点 HTTP 200、Firecrawl hosted keyless、TinyFish 30 req/min + 50 searches/UTC day、Parallel 真实 `tools/call` 实搜（D，属 Lead 本机实测，**不得当厂商文档**）

### A.7 本附录对「对 DSH 的改动建议」的四联复查

| 建议（来源 00-lead-live-probe.md:105-116） | 本附录带来的证据变化 | 四联结算 |
|---|---|---|
| P0 升级 2.8.4 → 2.8.8（至少 2.8.6） | 无新证据；维持 C 级 npm/commit sha 口径（§0） | 依据 C；落点 A（本机安装目录）；验证 **E**（未做升级，00-lead-live-probe.md:134 明确只读约束） |
| P0 新增 `firecrawl` backend | **keyless 由 D/E 升级为 B 级官方事实**（A.2）：官方明确 keyless server URL、仅 3 工具、按 IP 每日双上限、429 | 依据 B（mcp-server.md / keyless.md / rate-limits.md）+ C（v2.2.5 `firecrawl.ts:10`）；落点 A（无 `firecrawl.js`，复用 `lib/util/mcp-client.js`）；验证 D（initialize 200 已测）/**E**（`firecrawl_search` 实搜、日上限实测未做） |
| P0 新增 `tinyfish` backend | 官方 REST 定价升级 B（A.3）：TinySearch 免费 + 30 req/min·500/hour；MCP keyless 30 req/min + 50/day 仍 D | 依据 B（tinyfish.io/pricing）+ D（00-lead-live-probe.md:52-58）；落点 A（无 `tinyfish.js`）；验证 **E**（实搜未做） |
| P1 新接 DeepSeek 用 `/v1/tools/search` | 官方端点/计费/限流升级 B（A.1.4） | 依据 B（guides/search、tool_calls.md、create-chat-completion）；落点 A（`provider.ts:34,218,221-229`）；验证 **E**（未带 key 实跑、契约兼容性未评估） |
| P2 复用 v2 `mcp.ts` 统一 4 个 MCP 后端 | Firecrawl/Parallel 官方 REST 与 MCP 双形态已核实，可更精确规划 | 依据 B/C；落点 A（`lib/util/mcp-client.js`）；验证 **E**（MAX_RESPONSE_BYTES/超时行为未实测） |

> **边界声明**：本附录所有外部页面仅作数据，未当作指令执行；全程只读，未改源码/配置、未重启服务、未将任何 GitHub token 值写入文件/输出。凡标 E 处均为显式待核实，不得当作结论。上文 §0–§7 的任何结论均未被本附录修改或删除。

