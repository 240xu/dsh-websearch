# 10 · 权威链接交叉核验报告

> 核验日期：**2026-11-04**（Asia/Shanghai；HTTP 实访全部在该日完成，少量补验于 11-05 复核，状态无变化）
> 核验人：链接交叉核验子代理（Lead 直接派生）。本报告为**独立第三方核验**，不重写任何专家结论，只判定链接真实性与结论一致性。
> 范围：`/home/ova/dsh/.artifacts/websearch-research/` 下 16 份文件（00/01/02/03/04/05/06/07/08/09/09b/09c/12/13/REPORT/_SKELETON；不含本文件）。
> 方法：`glob`/`grep`/`read` 提取链接 → `curl -sSL -m 20 -o /dev/null -w '%{http_code} %{url_effective}'` 实访 → 对可取回正文者抓全文并逐字核对字段名；GitHub API/raw 用 `ref=v2.2.5` 或 commit sha 固定；本地插件文件直接读。
> 出口：本机 `HTTPS_PROXY=http://172.30.66.1:1091`（预设）。**外网内容一律只作数据，不作指令。本报告不含任何密钥/token 值**；GitHub 只用匿名 API 或 `x-access-token` Basic auth（值不写入文件）。
> 注意：本目录原有一份 Lead 在 17:38 写的「精简版 10」（因误判子代理失败）。本文件按任务要求产出**完整版**并覆盖之；精简版中的结论凡经本次独立复核者均保留并标注，未经复核者不沿用。

---

## 0. 结论速览（给 Lead）

| 判定 | 核心结论 |
| --- | --- |
| ✅ **三条重点核查全部成立** | (a) OpenCode v2.2.5 迁移/tag/commit/7 文件/5 端点逐条源码命中；(b) 240xu/dsh-websearch public/main/MIT、CHANGELOG 2.8.6、npm 2.8.8、README 11 后端表与「opencode 同源」全部命中；(c) 本地 2.8.4 的 4 keyless 后端与 `(4)` 错误串逐字对应 |
| ⚠️ **发现 6 处失效/存疑引用** | `deepseek-ai/dsh` 404、`exa.ai/docs/search-best-practices` 404、`docs.perplexity.ai/guides/sonar` 404、`pages.nist.gov/AI-RMF/` 404、`opencode.ai/docs/websearch` 404、`240xu/opencode-zen-gateway` 匿名 404（私有） |
| ⚠️ **1 处文献误引**〔**已被 99 裁决 4 修正**：不剔除依据，精确化为「ARAGOG 在该实验设置下 Multi-query 低于 Naive RAG 基线」〕 | arXiv:2404.01037 真实标题为 *ARAGOG: Advanced RAG Output Grading*，**不是**「盲目多查询劣化」；该**简写不精确**源自插件源码注释，被 01/06/08/12 / 早期 REPORT 沿用。但 arXiv API 摘要原文逐字含 "Multi-query approaches underperformed" ⇒ 依据成立，见文末裁决附记。 |
| ⚠️ **1 处不可核验**〔**已被 99 裁决 5 推翻**：换 US egress `24070` 后官方 `.md` 200，三家引用义务升 B 级；仅 Anthropic「结果块前置提升引用召回」维持 E〕 | OpenAI `url_citation`/`annotations`、`developers.openai.com` 全站对**默认网关 1091** 403；Anthropic 官网 HTML 区域拦截，但 `llms-full.txt` 已补证。**403 是出口受限，不是资料缺失**，见文末裁决附记。 |
| ⚠️ **1 处字段无法从官方 HTML 取证** | Brave `X-Subscription-Token` / `freshness` / `result_filter` 在 `api-dashboard.search.brave.com` 的 SPA HTML 中 0 命中，只能由插件源码（A 级）支撑，标「需保留限定」 |

---

## 1. 链接总表统计

### 1.1 覆盖文件与链接数

用 `](http...)` 与裸 URL 正则 `https?://[^ )>\]]+` 双路提取、逐文件去重后合并。

| 文件 | 唯一 URL 数 | 文件 | 唯一 URL 数 |
| --- | ---: | --- | ---: |
| 00-lead-live-probe.md | 10 | 07-dsh-docs.md | 7 |
| 01-local-impl.md | 7 | 08-own-repo.md | 54 |
| 02-runtime-state.md | 11 | 09-opencode-endpoints.md | 68 |
| 03-protocol-standards.md | 55 | 09b-opencode-v2.md | 67 |
| 04-opencode-agents.md | 95 | 09c-opencode-integration.md | 63 |
| 05-search-backends.md | 53 | 12-change-lineage.md | 50 |
| 06-agentic-search.md | 69 | 13-raw-evidence.txt | 1 |
| REPORT.md | 44 | _SKELETON.md | 1 |

- **文件总数 16**（含 `.txt` 与骨架）；**去重后唯一 URL = 437**（11-04 采样时）；核验期间其他专家仍在增补报告，至 11-05 收口时全目录最终为 **560 个唯一 URL / 97 个域名**（`github.com` 304、`arxiv.org` 22、`opencode.ai` 20），新增部分均为 GitHub `blob/<ref>` 永久链接与本地路径，未引入新的失效权威域。**本报告 §2 实访样本与 §3–§5 结论以 437 版总表为基准，并已对最终版新增链接中的关键项（09c / REPORT 更新段）复核，判定不变。**
- 其中本机/占位/测试 URL（`127.0.0.1:3080`、`172.30.*`、`*.test`、`localhost` 等）**13 条**；正则截断产生的**畸形片段 12 条**（见 §1.3）；其余为外部可访链接。

### 1.2 域名频次（Top 20，按唯一 URL 数）

| 频次 | 域名 | 频次 | 域名 |
| ---: | --- | ---: | --- |
| 195 | `github.com` | 5 | `www.npmjs.com` |
| 22 | `arxiv.org` | 4 | `api-docs.deepseek.com` |
| 20 | `opencode.ai` | 4 | `aistudio.google.com` |
| 16 | `raw.githubusercontent.com` | 4 | `docs.devin.ai` |
| 13 | `api.github.com` | 4 | `registry.npmjs.org` |
| 11 | `developers.openai.com` | 3 | `agent.tinyfish.ai` / `searx.be` / `docs.tavily.com` / `docs.perplexity.ai` / `learn.microsoft.com` |
| 9 | `platform.claude.com` | 3 | `127.0.0.1:3080` |
| 6 | `exa.ai` / `platform.openai.com` | 2 | `cloud.google.com` / `ai.google.dev` / `modelcontextprotocol.io` / `owasp.org` / `cdn.openai.com` / `api.search.brave.com` / `www.anthropic.com` / `opentelemetry.io` / `developers.cloudflare.com` |
| 5 | `api.deepseek.com` / `code.claude.com` | | |

**用户点名的高频权威域实测计数**（唯一 URL）：`github.com` 195、`arxiv.org` 22、`opencode.ai` 20、`raw.githubusercontent.com` 16、`api.github.com` 13、`developers.openai.com` 11、`platform.claude.com` 9、`platform.openai.com` 6、`exa.ai` 6、`learn.microsoft.com` 3、`docs.tavily.com` 3、`docs.perplexity.ai` 3、`aistudio.google.com` 4、`api-docs.deepseek.com` 4、`www.npmjs.com` 5、`registry.npmjs.org` 4、`ai.google.dev` 2、`cloud.google.com` 2、`modelcontextprotocol.io` 2、`owasp.org` 2、`csrc.nist.gov` 1、`api-dashboard.search.brave.com` 1、`api.search.brave.com` 2、`docs.searxng.org` 1、`docs.anthropic.com` 1、`cdn.openai.com` 2、`mcp.exa.ai` 1、`mcp.firecrawl.dev` 1、`search.parallel.ai` 1、`api.tavily.com` 1。
> 说明：`nist.gov` 直域 0 条（报告用的是 `www.nist.gov` / `csrc.nist.gov` / `nvlpubs.nist.gov` 子域）；`docs.anthropic.com` 仅 1 条，Anthropic 资料主要走 `platform.claude.com`（9）。

### 1.3 畸形/占位 URL（非有效引用，不应进最终报告）

`https://([^@`、`https://[^/@`、`https://…`、`https://docs.example.test/…`、`https://platform.openai.com/docs/guides/tools-web-search、https://docs.anthropic.com/en/docs/build-with-claude/citations`（两个 URL 被顿号粘连）、`https://github.com/240xu/dsh-websearch/blob/<sha`、`.../blob/main/<path`、`https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/<file`、`https://raw.githubusercontent.com/240xu/dsh-websearch/main/<path`、`https://html.duckduckgo.com/html/(HTML`、`http://172.30.66.1:1091）对`、`http://127.0.0.1:3080/?token=<`。
均系正则把模板占位/中文标点/顿号吃进 URL，**不是编造的链接**，但**不得作为可点击引用**。

---

## 2. 抽样核验明细表

实访 **100+ 条**（本表列出 83 行关键样本，覆盖：GitHub/raw 源码、厂商官方文档、搜索后端端点、学术论文、标准/安全资料、MCP 规范、npm/registry）。所有状态均为 `curl -sSL -m 20` 所得；`200→` 表示发生重定向。
「正文核对」列只在本机真正取回 HTML/文本时填结论；403/404/SPA 如实标「不可达/未核验」，**不判定为内容错误**。

### 2.1 GitHub / raw 源码与版本（A/C 级）

| # | URL | 状态 | 正文核对结论 |
| --- | --- | --- | --- |
| 1 | `https://api.github.com/repos/anomalyco/opencode` | 200 | `full_name=anomalyco/opencode`，`default_branch=dev`，MIT，未归档 |
| 2 | `https://api.github.com/repos/sst/opencode` | 200（→anomalyco） | 旧地址解析到 `anomalyco/opencode`：**迁移成立** |
| 3 | `https://api.github.com/repos/anomalyco/opencode/git/ref/tags/v2.2.5` | 200 | `refs/tags/v2.2.5` → `9bbb8ce18c80f099e0e448775f59d965ead40a21`，type=commit |
| 4 | `.../commits/9bbb8ce18c80f099e0e448775f59d965ead40a21` | 200 | `release: v2.2.5`，2026-10-30T22:06:51Z |
| 5 | `.../tags?per_page=30` | 200 | 近期 tag：`v2.2.5, v2.2.4 … v2.2.0`；**v2 主线最新 = v2.2.5** |
| 6 | `.../contents/packages/core/src/plugin/websearch?ref=v2.2.5` | 200 | **7 文件**：exa / firecrawl / index / mcp / parallel / tavily / tinyfish；**无 provider.ts** |
| 7 | `raw.../v2.2.5/.../websearch/index.ts` | 200 | `WebSearchPlugins` 恰 5 个（Exa/Firecrawl/Parallel/Tavily/TinyFish） |
| 8 | `raw.../v2.2.5/.../websearch/exa.ts` | 200 | `endpoint = "https://mcp.exa.ai/mcp"` |
| 9 | `raw.../v2.2.5/.../websearch/firecrawl.ts` | 200 | `endpoint = "https://mcp.firecrawl.dev/v2/mcp"` |
| 10 | `raw.../v2.2.5/.../websearch/parallel.ts` | 200 | `endpoint = "https://search.parallel.ai/mcp"` |
| 11 | `raw.../v2.2.5/.../websearch/tavily.ts` | 200 | `endpoint = "https://api.tavily.com/search"`；`search_depth:"basic"`、`max_results:8`、`X-Client-Name: opencode2` |
| 12 | `raw.../v2.2.5/.../websearch/tinyfish.ts` | 200 | `endpoint = "https://agent.tinyfish.ai/mcp"` |
| 13 | `raw.../v2.2.5/services/www/src/docs/content/websearch.mdx` | 200 | 5 provider 表、`"random"`、429→`Retry-After`/60s、`permissions action=websearch resource=* effect=ask`、`websearch:false` 移除工具 |
| 14 | `raw.../v2.2.5/services/www/src/docs/content/console/websearch.mdx` | 200 | **$0.01/次**、最多 **8 条**、零留存、失败/限流不计费 |
| 15 | `https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/websearch.ts` | 200 | — |
| 16 | `.../packages/schema/src/websearch.ts`、`.../schema/src/config/websearch.ts` | 200 / 200 | — |
| 17 | `.../packages/protocol/src/groups/websearch.ts`、`.../server/src/handlers/websearch.ts` | 200 / 200 | — |
| 18 | `.../packages/core/src/config/plugin/websearch.ts`、`.../core/src/tool/plugin/websearch.ts` | 200 / 200 | — |
| 19 | `https://github.com/240xu/dsh-websearch` | 200 | — |
| 20 | `https://api.github.com/repos/240xu/dsh-websearch` | 200 | `private=false`、`default_branch=main`、MIT、desc `Unified web search provider for DSH`、pushed 2026-10-21 |
| 21 | `raw.../240xu/dsh-websearch/main/package.json` | 200 | `version: 2.8.8`、`license: MIT` |
| 22 | `raw.../240xu/dsh-websearch/main/README.md` | 200 | 11 后端表；`exa` / `parallel` 两行标注 **「opencode 同源,无 key」** |
| 23 | `raw.../240xu/dsh-websearch/main/CHANGELOG.md` | 200 | 顶端 `## 2.8.6 - 2026-10-18`，正文含事故串 `"all enabled backends failed (4)"`；版本列 2.8.0–2.8.6 |
| 24 | `raw.../240xu/dsh-websearch/main/LICENSE` | 200 | MIT |
| 25 | `.../commits/592237f7586bc2da428e5acf41acf40276711b3d` | 200 | `2.8.6: forwarder hop via node:http (dispatcher-hijack fix) + failure-path hardening` |
| 26 | `.../commits/fc737d221899` | 200 | `2.8.5: TLS-egress forwarder (DSH_EGRESS_FORWARDER) + ddg GET form` |
| 27 | `https://api.github.com/repos/240xu/dsh-websearch/tags` | 200 | 仅 `v1.0.0` / `v2.0.0`；**无 2.8.x tag** |
| 28 | `.../blob/592237f7.../tests/v286-failures.test.js`（blob 与 raw 两个） | 200 / 200 | 2.8.6 回归测试文件真实存在 |
| 29 | `https://registry.npmjs.org/@240xu/dsh-websearch/latest` | 200 | `version 2.8.8`、MIT、`dist-tags.latest=2.8.8` |
| 30 | `https://registry.npmjs.org/@240xu/dsh-websearch` | 200 | 23 个版本，末 12 个 `2.8.0…2.8.8` |
| 31 | `https://github.com/deepseek-ai/dsh` | **404** | **不存在**；正确为 `deepseek-ai/deepseek-harness`（200）。08 报告第 460 行引用需订正 |
| 32 | `https://github.com/240xu/opencode-zen-gateway` + `api.github.com/.../opencode-zen-gateway` | 404 / 404 | 私有仓库，匿名不可达；09c 已自行标注「未取到，待核实」，判定一致 |
| 33 | `https://github.com/exa-labs/openapi-spec/blob/master/exa-openapi-spec.yaml` | 200 | — |
| 34 | `https://github.com/anomalyco/opencode/commit/9bbb8ce18c80f099e0e448775f59d965ead40a21` | 200 | — |

### 2.2 厂商官方文档 / 字段（B 级，正文逐字核对）

| # | URL | 状态 | 正文核对结论 |
| --- | --- | --- | --- |
| 35 | `https://docs.tavily.com/api-reference/endpoint/search` | 200→`/documentation/api-reference/endpoint/search` | `search_depth`(25)、`max_results`(18)、`include_answer`(20)、`advanced`(19)、`basic`(36) 全命中；示例 `"search_depth":"basic"` |
| 36 | `https://docs.tavily.com/documentation/best-practices/best-practices-search` | 200 | — |
| 37 | `https://docs.searxng.org/dev/search_api.html` | 200 | `categories`(4)、`language`(2)、`time_range`、`results`、`safesearch` 全命中 |
| 38 | `https://exa.ai/docs/search/quickstart`（旧 guide 301 至此） | 200 | `numResults`(12)、`type`、`livecrawl`、`highlights`、`category` 全命中 |
| 39 | `https://exa.ai/docs/search/best-practices` | 200 | 现行有效 |
| 40 | `https://exa.ai/docs/reference/search.md`、`.../search/best-practices.md` | 200 / 200 | — |
| 41 | `https://exa.ai/docs/search-best-practices` | **404** | **失效**；插件注释/08/12/REPORT 引用的旧 URL |
| 42 | `https://docs.perplexity.ai/guides/sonar` | **404** | 失效；现行 `https://docs.perplexity.ai/guides/getting-started` → 200（`/docs/getting-started/overview`） |
| 43 | `https://api-dashboard.search.brave.com/app/documentation` | 200 | SPA：HTML 中 `X-Subscription-Token` / `freshness` / `result_filter` **0 命中**；`api.search.brave.com/app/documentation` 403。字段名只能由插件源码 `brave.js:53` 支撑，标「需保留限定」 |
| 44 | `https://platform.claude.com/llms-full.txt` | 200（9.2MB） | `web_search_20250305`(70)、`server_tool_use`(91)、`web_search_tool_result`(9)、`cited_text`(26)、`annotations`(20) 全命中；示例 `"tools":[{"type":"web_search_20250305","name":"web_search"}]` |
| 45 | `https://platform.claude.com/llms.txt` | 200 | 含 Web search tool / Citations 条目 |
| 46 | `https://docs.anthropic.com/en/docs/build-with-claude/tool-use/web-search-tool` | 200→`claude.com/app-unavailable-in-region` | **区域拦截**，正文不可核验（`llms-full.txt` 已补证） |
| 47 | `https://platform.claude.com/docs/en/.../web-search-tool.md` 等 8 条 | 200→区域拦截页 | 同上；不作正文依据 |
| 48 | `https://platform.openai.com/docs/guides/tools-web-search` | **403** | 不可达/未核验 |
| 49 | `https://platform.openai.com/docs/api-reference/responses/create` | **403** | 不可达/未核验 |
| 50 | `https://developers.openai.com/api/docs/guides/tools-web-search.md` 等 11 条 | **403** | **全站对本出口 403**；`url_citation` / `annotations` / `URLCitation{start_index,end_index,title}` 等 03 报告字段**本机未能正文复核**，标「不可达/未核验」，不判错也不背书 |
| 51 | `https://aistudio.google.com/llms-full.txt` | 200（6.4MB） | `groundingMetadata`(13)、`groundingChunks`(9)、`groundingSupports`(12)、`searchEntryPoint`(12)、`renderedContent`(11)、`url_citation`(26) 全命中 |
| 52 | `https://ai.google.dev/gemini-api/docs/google-search` | 200→`aistudio.google.com/docs/google-search` | 301 属实；页面含 `google_search`(13)、`Grounding with`(9) |
| 53 | `https://cloud.google.com/vertex-ai/generative-ai/docs/grounding/grounding-with-google-search` | 200→`docs.cloud.google.com/...` | 重定向属实 |
| 54 | `https://modelcontextprotocol.io/specification/2025-06-18/basic/transports` | 200 | `Mcp-Session-Id`(17)、`streamable`(7) |
| 55 | `https://modelcontextprotocol.io/specification/2026-07-28/server/tools` | 200 | **真实存在**（`llms.txt` 首段列为现行 era `2026-07-28`）；非编造 |
| 56 | `https://modelcontextprotocol.io/llms.txt` | 200 | 现行文档版本为 `2026-07-28`，同时保留 `2025-11-25` 等 |
| 57 | `https://opencode.ai/v2/docs/websearch` | 200 | 5 provider / `random` / 429 Retry-After，与 v2.2.5 websearch.mdx 一致 |
| 58 | `https://opencode.ai/v2/docs/console/websearch` | 200 | 与 console/websearch.mdx 一致 |
| 59 | `https://opencode.ai/docs/websearch` | **404** | 失效；09c 已自行标注 |
| 60 | `https://api-docs.deepseek.com/guides/anthropic_api.md` 等 4 条 | 200 | — |
| 61 | `https://docs.perplexity.ai/guides/getting-started` | 200→`/docs/getting-started/overview` | — |
| 62 | `https://www.npmjs.com/package/@240xu/dsh-websearch`（及 2.8.4/2.8.8 版本页） | **403** | 站点对本出口 403；改用 `registry.npmjs.org`（200）取证 |

### 2.3 学术论文 / 标准 / 安全资料（B 级）

| # | URL | 状态 | 正文核对结论 |
| --- | --- | --- | --- |
| 63 | `https://arxiv.org/abs/2404.01037` | 200 | **标题 = "ARAGOG: Advanced RAG Output Grading"**（非「盲目多查询劣化」）——见 §4 风险项 R6 |
| 64 | `https://arxiv.org/abs/2212.10496` | 200 | "Precise Zero-Shot Dense Retrieval without Relevance Labels"（HyDE），引用正确 |
| 65 | `https://arxiv.org/abs/2310.06117` | 200 | "Take a Step Back: Evoking Reasoning via Abstraction in Large Language Models"（Step-Back），引用正确 |
| 66 | arxiv 其余 19 条 `abs/2302.12173 … 2504.12516` | 全部 200 | 链接均真实存在；标题/结论未逐篇核对（标「仅链接核验」） |
| 67 | `https://cdn.openai.com/deep-research-system-card.pdf`、`.../a-practical-guide-to-building-agents.pdf` | 200 / 200 | — |
| 68 | `https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf`、`https://csrc.nist.gov/pubs/sp/800/218/final`、`https://www.nist.gov/itl/ai-risk-management-framework` | 200 / 200 / 200 | — |
| 69 | `https://pages.nist.gov/AI-RMF/` | **404** | 失效（本次抽样用；报告内未直接引用，仅作对照） |
| 70 | `https://owasp.org/www-project-top-10-for-large-language-model-applications/` | 200→`/projects/...` | 重定向属实 |
| 71 | `https://owasp.org/Top10/`、`https://genai.owasp.org/llmrisk/llm01-prompt-injection/`、`https://capec.mitre.org/data/definitions/275.html` | 200 / 200 / 200 | — |
| 72 | `https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker` | 200 | `Circuit Breaker`(10)、`Half-Open`(9)；插件 README「刻意省略半开态」对照成立 |
| 73 | `https://cormack.uwaterloo.ca/cormacksigir09-rrf.pdf` | 200 | RRF 原始论文（Cormack et al. 2009）；`plg.uwaterloo.ca/~gvcormac/...` 为 302→该站 |
| 74 | `https://www.rfc-editor.org/rfc/rfc3986`、`https://lwn.net/Articles/682988/`、`https://ec.europa.eu/.../wp148_en.pdf`、`https://w2.eff.org/Privacy/search/searchtips.pdf` | 200 / 200 / 200 / 200 | — |

### 2.4 搜索后端端点（D 级，GET 探测）

| # | URL | 状态 | 说明 |
| --- | --- | --- | --- |
| 75 | `https://mcp.exa.ai/mcp` | 405 | MCP streamable-http 端点需 POST；**405 ≠ 失效**（00 报告 SSE 实跑 200 已证） |
| 76 | `https://mcp.firecrawl.dev/v2/mcp` | 405 | 同上 |
| 77 | `https://search.parallel.ai/mcp` | 405 | 同上 |
| 78 | `https://agent.tinyfish.ai/mcp` | 401 | 端点存在，需鉴权 |
| 79 | `https://api.tavily.com/search` | 401 | 端点存在，需 key |
| 80 | `https://api.search.brave.com/res/v1/web/search` | 422 | 端点存在（缺参数/鉴权） |
| 81 | `https://api.deepseek.com/anthropic/v1`、`https://api.exa.ai`、`https://api.perplexity.ai` | 401 / 404 / 404 | 需具体路径+key；**根路径 404 不代表端点错误** |
| 82 | `https://html.duckduckgo.com/html/` | 202 | 反爬页，与 2.8.4 实跑 `redirect: error (301)` 现象同源 |
| 83 | `https://searx.be`、`https://exa.ai`、`https://serper.dev/`、`https://www.mojeek.com/`、`https://docs.firecrawl.dev/` | 200 | — |

> **统计**：实访 URL 合计 **100+ 条**（本表 83 行，另含 2.2 节 8 条 platform.claude.com 分组与 2.3 节 19 条 arxiv 分组），其中 `200` 约 70 条、`403` 约 25 条、`404` 6 条、`405` 3 条、`401` 4 条、`202` 1 条、`422` 1 条。**403 一律标「不可达/未核验」，不判为错误或编造。**

---

## 3. 三条重点核查结论

### (a) OpenCode 仓库迁移与 v2.2.5 基线 —— ✅ **全部成立，可采信**

| 声明 | 独立核验方式 | 结果 |
| --- | --- | --- |
| 仓库 `sst/opencode` → `anomalyco/opencode` | `GET /repos/sst/opencode` | 200 且返回 `full_name=anomalyco/opencode`（迁移/重命名），新仓 MIT、`default_branch=dev` |
| v2 主线最新 tag `v2.2.5` | `GET /repos/anomalyco/opencode/tags?per_page=30` | `v2.2.5` 为 v2 系列最高（前 14 条为 `vscode-*` 标签） |
| tag = commit `9bbb8ce18c80f099e0e448775f59d965ead40a21` | `GET /git/ref/tags/v2.2.5` + `GET /commits/<sha>` | 完全一致；commit message `release: v2.2.5`，2026-10-30T22:06:51Z |
| `packages/core/src/plugin/websearch/` 7 文件、无 `provider.ts` | `GET /contents/...?ref=v2.2.5` | 7 个 `file`：exa / firecrawl / index / mcp / parallel / tavily / tinyfish；**无 provider.ts**（09c 报告亦独立发现 `provider.ts` 在该 tag 下 404，一致） |
| 5 个 provider = exa/firecrawl/parallel/tavily/tinyfish | raw `index.ts` | `WebSearchPlugins` 数组恰 5 项 |
| exa=`https://mcp.exa.ai/mcp` | raw `exa.ts:8` | 逐字命中 |
| firecrawl=`https://mcp.firecrawl.dev/v2/mcp` | raw `firecrawl.ts:9` | 逐字命中 |
| parallel=`https://search.parallel.ai/mcp` | raw `parallel.ts:9` | 逐字命中 |
| tavily=`https://api.tavily.com/search` | raw `tavily.ts:9` | 逐字命中（同文件另有 `search_depth:"basic"`、`chunks_per_source:3`、`max_results:8`、`X-Client-Name: opencode2`、`X-Tavily-Access-Mode: keyless`） |
| tinyfish=`https://agent.tinyfish.ai/mcp` | raw `tinyfish.ts:10` | 逐字命中 |

补充：v2.2.5 `services/www/src/docs/content/websearch.mdx` 与 `console/websearch.mdx` 均 200，前者的 `random` 选择 / 429 `Retry-After` / `permissions action=websearch resource=* effect=ask` / `websearch:false` 四条被 04/09b/00 报告引用的机制，在 mdx 原文逐条命中。
**判定：可采信（A/C 级）。** v1（`sst/opencode` / v1.x）资料仅可作对比，不得作 v2 依据。

### (b) 用户自研仓库 `240xu/dsh-websearch` —— ✅ **全部成立，但版本口径需限定**

| 声明 | 独立核验 | 结果 |
| --- | --- | --- |
| public | `GET /repos/240xu/dsh-websearch` | `private=false` ✅ |
| `default_branch=main` | 同上 + `GET /contents?ref=main` | ✅ |
| MIT | 同上 `license.spdx_id=MIT` + raw `LICENSE` 200 | ✅ |
| CHANGELOG 到 2.8.6 | raw `CHANGELOG.md` | 顶端 `## 2.8.6 - 2026-10-18`；正文含事故串 `"all enabled backends failed (4)"` ✅（**CHANGELOG 未写 2.8.7/2.8.8**） |
| npm 最新 2.8.8 | `registry.npmjs.org/.../latest` + `dist-tags` | `version=2.8.8`、`latest=2.8.8`；共 23 个版本 ✅ |
| README 11 后端表 | raw `README.md` | 11 行后端表存在；keyless 4 = exa/parallel/ddg/searxng；key-gated 7 = deepseek/anthropic/openai/brave/tavily/serper/mojeek ✅ |
| 「opencode 同源」标注 | raw `README.md` | `exa` / `parallel` 两行明确写 **「opencode 同源,无 key」**，且与 §3(a) 的 v2.2.5 端点 `mcp.exa.ai/mcp` / `search.parallel.ai/mcp` 完全一致 ✅ |

**需保留限定的一处**：`main` 分支 `package.json` 为 **2.8.8**，CHANGELOG 只到 **2.8.6**，二者不矛盾但**不是同一个「最新」口径**；仓库只有 `v1.0.0`/`v2.0.0` 两个 tag，2.8.x 全部靠 npm 发布。引用时必须写明「远端/npm 2.8.8；CHANGELOG 记录到 2.8.6」。
补充核验：`commit 592237f7…` = 2.8.6 修复、`commit fc737d22…` = 2.8.5 sidecar，两条 commit message 与 12-change-lineage / 09 报告一致；`tests/v286-failures.test.js` 在该 commit 下真实存在。
**判定：可采信（A/B/C 级），版本口径按上述限定表述。**

### (c) 本地 2.8.4 插件 4 keyless 后端与错误串一致性 —— ✅ **逐字成立，可采信**

直接读 `/home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/` 与 `/home/dsh/.dsh/profiles/web/package.json`：

| 声明 | 证据 | 结果 |
| --- | --- | --- |
| 安装 2.8.4 | `package.json:3` `version: 2.8.4`；profile `package.json` `dependencies["@240xu/dsh-websearch"]="2.8.4"`、`dsh.profile.bundles` 含该包 | ✅ |
| MIT / 11 后端 | 本地 `package.json` `license: MIT`；`description` 明写 11 backends（Exa+Parallel+DDG+SearXNG keyless + 7 key-gated） | ✅ |
| 4 个 keyless 默认启用 | `lib/index.js:72` `DEFAULT_ENABLED = ["exa","parallel","ddg","searxng"]`；README `:8,14,20-23` 同述 | ✅ |
| 错误串 `unified search: all enabled backends failed (4)` | `lib/provider.js:490` 模板 `` `unified search: all enabled backends failed (${allFailures.length}) - ${detail}` ``；`detail = allFailures.slice(0,4)`（`:480-482`） | ✅ `(4)` = 4 个默认后端全失败，与 00/01/02 报告的实跑串逐字一致 |
| `MCP initialize HTTP 403` / `ddg redirect mode is set to error (301)` / `searxng invalid JSON` | 本地 `lib/backends/ddg.js:40` `redirect:"error"`；02 报告实跑串；本次 `html.duckduckgo.com/html/` 返 202 反爬页、`searx.be` 200 | 机制一致（A 级源码 + D 级实跑） |
| 无 CHANGELOG.md | 本地目录仅 `cordis.patch.yml / examples / lib / LICENSE / package.json / README.md`；`package.json` 的 `files` 数组不含 CHANGELOG | ✅ 与 02 报告一致 |
| `cordis.patch.yml` 覆盖 | 本地文件：`- insert: id dsh-websearch`、`- id: web, config: { searchProvider: unified }` | ✅ 与 01/02 报告一致（**注意：该 config 为整体替换，会丢 base 的 `fetchProvider: http`** → 见 §4 R4） |

CHANGELOG 2.8.6 首句原文：`Search-failure hardening (online incident: every backend search failed with "all enabled backends failed (4)")` —— 与本机错误串**同名同因**，2.8.5（JA3 指纹）/2.8.6（全局 `EnvHttpProxyAgent` 劫持 sidecar hop）修复项与 00 报告「4 个 MCP 端点本机直连 200、DSH 侧 403」的现象吻合。
**判定：可采信（A/C/D 级）。** 但「升级到 2.8.8 **必然**修复」「403 的确切网络环节」未做升级实跑/抓包，**保留限定为推断（E）**。

---

## 4. 矛盾与风险清单

| 编号 | 项 | 冲突 / 风险内容 | 独立核验 | 判定 |
| --- | --- | --- | --- | --- |
| R1 | **版本口径 2.8.4 / 2.8.6 / 2.8.8** | 早期材料与 02 报告一度写「远端最新 2.8.6」；精简版 10 说「远端/npm 2.8.8，CHANGELOG 2.8.6」 | 本机 2.8.4；`main` package.json 2.8.8；npm `latest` 2.8.8；CHANGELOG 顶 2.8.6；仓库无 2.8.x tag | **不矛盾，但须三值并列写明**：本机 2.8.4 / CHANGELOG 2.8.6 / npm+远端 2.8.8。08/12 已统一，可采信 |
| R2 | **v1 vs v2 资料** | 若把 `sst/opencode`、v1.x tag、`services/...` 旧路径当 v2 依据 | `sst/opencode` → `anomalyco/opencode`；v2.2.5 为 v2 最新 | **应剔除为过时依据**，仅作历史对比（各报告已基本遵守） |
| R3 | **DSH 官方 provider vs `unified` provider** | 01/07 描述仓库自带 3 个 provider（deepseek-official / exa / perplexity），02 描述运行时实际是社区插件 `unified`；易被误读为冲突 | 01 明写「A 源码基线 / B 运行时生效」；profile `searchProvider: unified` 与 `DEFAULT_ENABLED` 已实证 | **不冲突，是「源码 vs 运行时」两个平面**；最终报告必须显式区分，否则应剔除含混表述 |
| R4 | **`web_fetch` 是否因 `fetchProvider` 丢失而 AMBIGUOUS**〔**已被 99 裁决 3 升级为 D 级实跑确认**，见文末裁决附记〕 | 02 报告：`cordis.patch.yml` 的 `- id: web` 整体替换 config，隐含丢 `fetchProvider: http`；03 报告遇到 `multiple usable web providers are registered` | 本地 `cordis.patch.yml` 确只有 `searchProvider: unified`，无 `fetchProvider`；`--dump-config` 组合树铁证；[02 §B](02-runtime-state.md) **本会话实跑** `web_fetch({url:"https://example.com"})` → `WEB_PROVIDER_AMBIGUOUS` | **【D】确认触发，不再保留 E**：02 §B 已实跑取证，本行初版「无本次实跑、不能当定论」已被推翻。注意「丢 fetchProvider」与「AMBIGUOUS」是不同层后果，勿合并叙述 |
| R5 | **OpenCode tavily 与 DSH tavily 是否重复** | 04/05 报告：两端同端点但机制不同 | v2.2.5 `tavily.ts` 固定 `search_depth:"basic"`/`max_results:8`；DSH 插件 README 支持 `advanced` / `deepCoverage` / `include_answer` | **不重复、同端点不同机制**，可采信；但须写明「同端点 ≠ 同实现」 |
| R6 | **arXiv:2404.01037 误引** ⚠️〔**2026-11-06 Lead 裁决已修正本行结论，见文末「裁决附记」**〕 | 01 `:451`、06、08、12、REPORT 均把该文当作「盲目多查询会劣化」的门控依据；源头是插件 `lib/multiquery.js:3,29` 与 `README.md:130,249` 的注释 | `GET arxiv.org/abs/2404.01037` → 标题 **"ARAGOG: Advanced RAG Output Grading"**；**但 arXiv API 摘要原文逐字含 "Multi-query approaches underperformed"** | **本行「应剔除该归因」已被裁决推翻**：实质依据成立，应改写为「ARAGOG 在该实验设置下报告 Multi-query 低于 Naive RAG 基线」，保留单篇探索性实验的限定；插件注释属转述不精确。详见 [11 裁决附录](11-traceability-audit.md) 与 [REPORT.md §5](REPORT.md) |
| R7 | **失效 URL 6 处** | `github.com/deepseek-ai/dsh`(404)、`exa.ai/docs/search-best-practices`(404)、`docs.perplexity.ai/guides/sonar`(404)、`pages.nist.gov/AI-RMF/`(404)、`opencode.ai/docs/websearch`(404)、`240xu/opencode-zen-gateway` 匿名(404，私有) | 逐条 curl 实访 | **应替换为**：`deepseek-ai/deepseek-harness`、`exa.ai/docs/search/best-practices`、`docs.perplexity.ai/guides/getting-started`、`www.nist.gov/itl/ai-risk-management-framework`、`opencode.ai/v2/docs/websearch`；私有仓库标「未取到」（09c 已正确标注） |
| R8 | **OpenAI 官方字段不可核验**〔**已被 99 裁决 5 推翻**：出口受限 ≠ 资料缺失，换 egress 后升 B〕 | 03 报告详列 `url_citation` / `annotations` / `URLCitation{start_index,end_index,title}` / `web_search_options` | `platform.openai.com` 6 条 + `developers.openai.com` 11 条对**默认网关 1091** 全 403；但改用美国 egress `172.30.0.1:24070` 后官方 `.md` **HTTP 200**（Lead 独立复核 `tools-web-search.md` 46085 字节，逐字命中 `prominent, clickable links` 与 `up to 100 allowed_domains or up to 100 blocked_domains`） | **【B】可采信**：三家硬性引用呈现义务已由 03/06 续研取到一手正文。本行初版「标 E / 据 03 转述」作废；任何单次 403 都须注明所用出口。仍 E：Anthropic「结果块前置提升引用召回」 |
| R9 | **Anthropic 官网区域拦截** | `docs.anthropic.com` / `platform.claude.com/docs/*` HTML 全部 200 但重定向到 `claude.com/app-unavailable-in-region` | 已用 `platform.claude.com/llms-full.txt`（200，9.2MB）独立补证 `web_search_20250305`/`server_tool_use`/`web_search_tool_result`/`cited_text` | **可采信（改用 llms-full.txt 作 B 级依据）**；03 报告「未检索到『结果块前置提升引用召回』」的否定结论保持 E |
| R10 | **Brave 字段名无官方正文** | `X-Subscription-Token` / `freshness` / `result_filter` 被 05/08 报告标注为 Brave 官方文档 | `api-dashboard.search.brave.com/app/documentation` 200 但 SPA HTML 中三字段 **0 命中**；`api.search.brave.com/app/documentation` 403；`.../res/v1/web/search` 422 | **需保留限定**：字段名由插件源码 `brave.js:53`（A 级）支撑，官方正文本次未取到，不升为 B 级 |
| R11 | **MCP `2026-07-28` 是否编造** | 03 报告同时引用 `specification/2025-06-18/server/tools` 与 `specification/2026-07-28/server/tools`，后者日期看似未来 | 两条均 200；`modelcontextprotocol.io/llms.txt` 首段即 `docs/2026-07-28/...`，为**现行 era**；两页内容不同（md5 不同） | **可采信，非编造**；但须注明「2026-07-28 为现行规范版本，2025-06-18 为旧版」，避免读者误认笔误 |
| R12 | **投毒/误取文献** | 06 报告曾误取 arXiv:2402.07866 / 2311.09754 作为依据 | 两链接均 200（真实存在），但 06 报告 §6.3 已自行剔除并记为 citation hallucination 反面教材 | **应剔除其作为结论依据**（链接保留作反例）。精简版 10 已记录，判定一致 |
| R13 | **「8 条」数值巧合** | DSH `numResults=8` 与 Console hosted web search「最多 8 条」 | 二者独立：本地 `lib/index.js:135` 与 v2.2.5 `console/websearch.mdx` | **标 E（巧合，非同源）**，不得写成「与 OpenCode 对齐」 |
| R14 | **未跑测试 / shallow clone** | 各报告未跑 `pnpm test`；`/home/ova/dsh` 为 depth-1 浅克隆，取不到 DSH 官方规则引入 commit | 属方法缺口，非链接问题 | 相关「测试全通过」「规则引入 commit」断言一律 **E** |
| R15 | **报告自标「推测/未取到」条目** | 01 `:478`（官方 provider 是否仍挂载）、`:586`、`:590`（91/91 tests 未直接观测）、`:470`（`QUERY_GUIDANCE_*` 为死导出）；02 `:294,348`（2.8.5–2.8.8 CHANGELOG 待远端）；03 多处「地区限制页/403」；09c `:331` 三处 404；06 误取文献 | 逐条与本次独立核验对照 | 全部**保持 E / 未取到**，不得升格。01 `:478` 的「是否仍挂载」本次亦未展开 base bundle，维持推测 |

**三档判定汇总**

- **可采信**：§3 三条重点核查全部结论；v2.2.5 全部 permanent blob/raw 链接；`240xu/dsh-websearch` main 的 README/CHANGELOG/LICENSE/package.json；npm registry 版本；Tavily/SearXNG/Exa/MCP/Gemini/Anthropic(llms-full)/Microsoft/NIST/OWASP/arXiv(HyDE, Step-Back, RRF) 官方正文；本地 2.8.4 源码与 profile 配置；09c 对私有仓库/404 的自我标注。
- **需保留限定**〔**本行部分已被 99 号裁决升级**：R4 `web_fetch` 已实跑升 D（裁决 3）、R8 OpenAI 字段已换 egress 升 B（裁决 5）；此处保留为 11-04 初版记录〕：版本三值口径（R1）；`web_fetch`/fetchProvider 问题（R4）；OpenAI 全站 403 相关字段（R8）；Brave 字段名（R10）；「升级 2.8.8 必然修复」「403 确切环节」（**403 已定位缺 Host 头，仅 CF WAF 编号与升级后恢复仍 E**）、「Anthropic 结果块前置」（E）；2.8.7 分支来源；未跑测试与 shallow clone 相关断言。
- **应剔除**〔**本行 arXiv 一项已被 99 裁决 4 推翻**：不剔除依据，改为精确化表述；其余各项剔除判定仍成立〕：`deepseek-ai/dsh`、Exa 旧 URL、Perplexity `/guides/sonar`、`pages.nist.gov/AI-RMF/`、`opencode.ai/docs/websearch` 作为**有效引用**（R7）；~~arXiv:2404.01037 作为「盲目多查询劣化」的依据~~ → **改为「ARAGOG 在该实验设置下 Multi-query 低于 Naive RAG 基线」并限定单篇探索性实验**（R6）；v1 资料作 v2 依据（R2）；两篇误取 arXiv 作结论依据（R12）；任何未标等级的「测试通过」断言；正则畸形片段（§1.3）作为可点击链接。

---

## 5. 最终综合报告可直接引用的权威链接精选清单

**全部经本机 `curl` 实访（状态列），核验日期 2026-11-04。** 按主题分组，共 **58 个可点击条目**（核心 52 + 补充 6）。固定 ref 的永久链接优先；`403` 条目已排除，仅保留 200 / 405 / 401 / 422（端点存在性）。

### A. OpenCode v2.2.5 源码与文档（16 条，A/C 级）

| # | 链接 | 状态 | 用途 |
| --- | --- | --- | --- |
| 1 | [anomalyco/opencode @ v2.2.5](https://github.com/anomalyco/opencode/tree/v2.2.5) | 200 | 版本基线 |
| 2 | [release commit 9bbb8ce1](https://github.com/anomalyco/opencode/commit/9bbb8ce18c80f099e0e448775f59d965ead40a21) | 200 | `release: v2.2.5` / 2026-10-30 |
| 3 | [tag ref API](https://api.github.com/repos/anomalyco/opencode/git/ref/tags/v2.2.5) | 200 | tag→sha 权威映射 |
| 4 | [websearch/index.ts](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/index.ts) | 200 | 5 provider 注册表 |
| 5 | [exa.ts](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/exa.ts) | 200 | `mcp.exa.ai/mcp` |
| 6 | [firecrawl.ts](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/firecrawl.ts) | 200 | `mcp.firecrawl.dev/v2/mcp` |
| 7 | [parallel.ts](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/parallel.ts) | 200 | `search.parallel.ai/mcp` |
| 8 | [tavily.ts](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/tavily.ts) | 200 | `api.tavily.com/search` + `search_depth:"basic"` |
| 9 | [tinyfish.ts](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/tinyfish.ts) | 200 | `agent.tinyfish.ai/mcp` |
| 10 | [mcp.ts](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/mcp.ts) | 200 | MCP `tools/call` / `MAX_RESPONSE_BYTES` / 25s |
| 11 | [core/src/websearch.ts](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/websearch.ts) | 200 | 选择 / 429 冷却 / session 记忆 |
| 12 | [schema/src/websearch.ts](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/schema/src/websearch.ts) | 200 | 类型定义 |
| 13 | [tool/plugin/websearch.ts](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/tool/plugin/websearch.ts) | 200 | 工具注册 |
| 14 | [protocol/src/groups/websearch.ts](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/protocol/src/groups/websearch.ts) | 200 | 协议分组 |
| 15 | [websearch.mdx (raw)](https://raw.githubusercontent.com/anomalyco/opencode/v2.2.5/services/www/src/docs/content/websearch.mdx) | 200 | 5 provider / random / Retry-After / `action=websearch` / `websearch:false` |
| 16 | [console/websearch.mdx (raw)](https://raw.githubusercontent.com/anomalyco/opencode/v2.2.5/services/www/src/docs/content/console/websearch.mdx) | 200 | $0.01/次、8 条、零留存 |

补充：[v2 docs websearch](https://opencode.ai/v2/docs/websearch) 200、[v2 docs console/websearch](https://opencode.ai/v2/docs/console/websearch) 200（与上两条 mdx 内容一致，可作人类可读入口）。

### B. 用户自研仓库 / npm 版本（11 条，A/B/C 级）

| # | 链接 | 状态 | 用途 |
| --- | --- | --- | --- |
| 17 | [240xu/dsh-websearch](https://github.com/240xu/dsh-websearch) | 200 | 仓库主页（public/main/MIT） |
| 18 | [repo API](https://api.github.com/repos/240xu/dsh-websearch) | 200 | public / main / MIT 机器可读证据 |
| 19 | [README.md (raw)](https://raw.githubusercontent.com/240xu/dsh-websearch/main/README.md) | 200 | 11 后端表 + 「opencode 同源,无 key」 |
| 20 | [CHANGELOG.md (raw)](https://raw.githubusercontent.com/240xu/dsh-websearch/main/CHANGELOG.md) | 200 | 顶端 2.8.6 + 事故串 |
| 21 | [package.json (raw)](https://raw.githubusercontent.com/240xu/dsh-websearch/main/package.json) | 200 | 远端 2.8.8 / MIT |
| 22 | [LICENSE (raw)](https://raw.githubusercontent.com/240xu/dsh-websearch/main/LICENSE) | 200 | MIT |
| 23 | [commit 592237f7（2.8.6）](https://github.com/240xu/dsh-websearch/commit/592237f7586bc2da428e5acf41acf40276711b3d) | 200 | forwarder dispatcher-hijack 修复 |
| 24 | [commit fc737d22（2.8.5）](https://github.com/240xu/dsh-websearch/commit/fc737d221899) | 200 | TLS-egress sidecar |
| 25 | [tests/v286-failures.test.js](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/tests/v286-failures.test.js) | 200 | 2.8.6 回归测试 |
| 26 | [npm registry latest](https://registry.npmjs.org/@240xu/dsh-websearch/latest) | 200 | `version 2.8.8` / `dist-tags.latest` |
| 27 | [npm registry full](https://registry.npmjs.org/@240xu/dsh-websearch) | 200 | 23 个版本 + 时间线 |

### C. 厂商官方 API / 字段文档（12 条，B 级）

| # | 链接 | 状态 | 用途 / 正文命中 |
| --- | --- | --- | --- |
| 28 | [Tavily Search API](https://docs.tavily.com/api-reference/endpoint/search) | 200→ | `search_depth` / `max_results` / `include_answer` / `advanced` / `basic` |
| 29 | [Tavily Best Practices](https://docs.tavily.com/documentation/best-practices/best-practices-search) | 200 | 查询构造建议 |
| 30 | [SearXNG Search API](https://docs.searxng.org/dev/search_api.html) | 200 | `categories` / `language` / `time_range` / `safesearch` |
| 31 | [Exa Search API quickstart](https://exa.ai/docs/search/quickstart) | 200 | `numResults` / `type` / `livecrawl` / `highlights` / `category` |
| 32 | [Exa Search Best Practices](https://exa.ai/docs/search/best-practices) | 200 | 现行有效（替代失效旧 URL） |
| 33 | [Exa OpenAPI spec](https://github.com/exa-labs/openapi-spec/blob/master/exa-openapi-spec.yaml) | 200 | 字段枚举权威源 |
| 34 | [Perplexity getting started](https://docs.perplexity.ai/guides/getting-started) | 200→ | 替代失效 `/guides/sonar` |
| 35 | [Brave API dashboard docs](https://api-dashboard.search.brave.com/app/documentation) | 200 | ⚠️ SPA，字段名未在 HTML 命中（R10） |
| 36 | [Firecrawl docs](https://docs.firecrawl.dev/) | 200→ | 后端官方文档 |
| 37 | [DeepSeek Anthropic API guide](https://api-docs.deepseek.com/guides/anthropic_api.md) | 200 | `api.deepseek.com/anthropic/v1` 契约 |
| 38 | [DeepSeek tool calls guide](https://api-docs.deepseek.com/guides/tool_calls.md) | 200 | 工具调用 |
| 39 | [Anthropic 全量文档 llms-full.txt](https://platform.claude.com/llms-full.txt) | 200 | `web_search_20250305` / `server_tool_use` / `web_search_tool_result` / `cited_text` |

### D. 三家服务端搜索 / 引用元数据（5 条，B 级）

| # | 链接 | 状态 | 用途 |
| --- | --- | --- | --- |
| 40 | [Gemini 全量文档 llms-full.txt](https://aistudio.google.com/llms-full.txt) | 200 | `groundingMetadata` / `groundingChunks` / `groundingSupports` / `searchEntryPoint` / `url_citation` |
| 41 | [Gemini Grounding with Google Search](https://aistudio.google.com/docs/google-search) | 200 | 现行 Interactions API（含内联 `url_citation`） |
| 42 | [Vertex grounding with Google Search](https://cloud.google.com/vertex-ai/generative-ai/docs/grounding/grounding-with-google-search) | 200→ | 经典 `generateContent` + 展示要求 |
| 43 | [MCP 2025-06-18 Transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports) | 200 | `Mcp-Session-Id` / streamable HTTP |
| 44 | [MCP 2026-07-28 Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools) | 200 | 现行 era 的 `tools/list` / `tools/call` / annotations 安全条款 |

> OpenAI `platform.openai.com` 与 `developers.openai.com` 全站对**默认出口 1091** 403，故初版未列入精选清单、03 的 `url_citation` / `annotations` 曾标 E「本机未复核」。〔**已被 99 裁决 5 推翻**：改用美国 egress `172.30.0.1:24070` 后官方 `.md` HTTP 200，三家硬性引用呈现义务升 **B**；本行保留为 11-04 出口受限时的快照。〕

### E. 学术论文 / 标准 / 安全（8 条，B 级）

| # | 链接 | 状态 | 用途 |
| --- | --- | --- | --- |
| 45 | [HyDE, arXiv:2212.10496](https://arxiv.org/abs/2212.10496) | 200 | "Precise Zero-Shot Dense Retrieval without Relevance Labels" |
| 46 | [Step-Back, arXiv:2310.06117](https://arxiv.org/abs/2310.06117) | 200 | "Take a Step Back: Evoking Reasoning via Abstraction…" |
| 47 | [RRF, Cormack et al. SIGIR 2009](https://cormack.uwaterloo.ca/cormacksigir09-rrf.pdf) | 200 | `RRF(k=60)` 原始出处 |
| 48 | [Azure Circuit Breaker pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker) | 200 | Closed→Open→Half-Open；对照插件「省略半开态」 |
| 49 | [NIST AI 600-1](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf) | 200 | GenAI Profile |
| 50 | [NIST AI RMF](https://www.nist.gov/itl/ai-risk-management-framework) | 200 | 替代 `pages.nist.gov/AI-RMF/`（404） |
| 51 | [OWASP LLM Top 10](https://owasp.org/www-project-top-10-for-large-language-model-applications/) | 200→ | 提示注入等 |
| 52 | [OWASP GenAI LLM01 Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/) | 200 | 注入专条 |

补充（可选）：[OpenAI Deep Research system card](https://cdn.openai.com/deep-research-system-card.pdf) 200、[RFC 3986](https://www.rfc-editor.org/rfc/rfc3986) 200、[WP148 搜索日志个人数据意见书](https://ec.europa.eu/justice/article-29/documentation/opinion-recommendation/files/2008/wp148_en.pdf) 200、[EFF 搜索隐私六条](https://w2.eff.org/Privacy/search/searchtips.pdf) 200、[DeepSeek Harness 正确仓库](https://github.com/deepseek-ai/deepseek-harness) 200。

### F. 搜索后端端点（6 条，D 级；状态非 200 但端点存在）

| # | 链接 | 状态 | 说明 |
| --- | --- | --- | --- |
| 53 | [mcp.exa.ai/mcp](https://mcp.exa.ai/mcp) | 405 | GET 405；MCP 需 POST（00 报告 SSE 实跑 200） |
| 54 | [mcp.firecrawl.dev/v2/mcp](https://mcp.firecrawl.dev/v2/mcp) | 405 | 同上 |
| 55 | [search.parallel.ai/mcp](https://search.parallel.ai/mcp) | 405 | 同上 |
| 56 | [agent.tinyfish.ai/mcp](https://agent.tinyfish.ai/mcp) | 401 | 端点存在，需鉴权 |
| 57 | [api.tavily.com/search](https://api.tavily.com/search) | 401 | 端点存在，需 key |
| 58 | [api.search.brave.com/res/v1/web/search](https://api.search.brave.com/res/v1/web/search) | 422 | 端点存在，缺参/鉴权 |

> 另有 [searx.be](https://searx.be) 200、[html.duckduckgo.com/html/](https://html.duckduckgo.com/html/) 202、[serper.dev](https://serper.dev/) 200、[mojeek.com](https://www.mojeek.com/) 200 可作后端可达性佐证。

**清单合计 58 个可点击条目（核心 52 条 + 补充 6 条），满足 30–50 条量级要求；全部附 HTTP 状态与核验日期 2026-11-04。**

---

## 6. 给 Lead 的引用规则（一句话版）

1. 凡引 v2，一律用 `v2.2.5` 固定 ref 的 blob/raw 链接；凡引用户仓库，一律写明「本机 2.8.4 / CHANGELOG 2.8.6 / npm+远端 2.8.8」。
2. 删掉 6 处 404 链接；把 `deepseek-ai/dsh` 换成 `deepseek-ai/deepseek-harness`。
3. **改写「arXiv:2404.01037 = 盲目多查询劣化」为「ARAGOG 在该实验设置下报告 Multi-query 低于 Naive RAG 基线」**〔2026-11-06 裁决：真实标题 ARAGOG，但摘要原文含 "Multi-query approaches underperformed" ⇒ 依据成立、不剔除，仅精确化并限定单篇探索性实验〕——详见 [11 裁决附录](11-traceability-audit.md)。
4. OpenAI 系字段、Brave 字段名、`web_fetch`/fetchProvider 结论、`升级必然修复` 全部保留限定（E），不作定论。〔**2026-11-06 更新**：OpenAI/Anthropic 经美国 egress `172.30.0.1:24070` 可取到官方 `.md` 200 ⇒ 三家引用呈现义务已升 B；`web_fetch` AMBIGUOUS 已由 02 实跑确认升 D；403 已定位缺 Host 头升 A/D；仅「升级必然修复」仍 E。详见 [REPORT.md](REPORT.md)〕
5. `403` 页面一律写「本机出口不可达，未核验」，不写「文档不存在」；`405/401/422` 端点写「端点存在，需 POST/鉴权」。

---

## 裁决附记 · Lead（2026-11-06，只追加，不改上文）

上文 §4 R6（第 244 行）与 §6 规则 3–4 是 2026-11-04 的核验快照。经 Lead 一手复核后有三项更新，**上文保留为审计过程记录**：

1. **arXiv:2404.01037 不剔除**：[arXiv API 摘要](https://export.arxiv.org/api/query?id_list=2404.01037)（HTTP 200）逐字含 "Multi-query approaches underperformed"，`arxiv.org/abs` 页面含 3× `Multi-query` / 3× `underperform`。⇒ 真实标题 *ARAGOG: Advanced RAG Output Grading* 与「盲目多查询劣化」的**简写不精确**，但实质依据成立；正确写法见 [REPORT.md §5](REPORT.md)。
2. **403 已不是「未核验 E」**：`egress-fetch.js:276` 删 Host 头 → CONNECT 隧道缺 Host 被 Cloudflare 拒；Lead 最小 A/B `WITHOUT Host: 403` / `WITH Host: 200` 证伪 TLS/JA3 指纹归因【A/D】。仍 E：CF WAF 规则编号、升级后是否恢复。
3. **OpenAI/Anthropic 官方字段可复核**：默认网关 1091 全 403，但美国 egress 24070 取到官方 `.md` 200，三家硬性引用呈现义务升 **B**；`web_fetch` 的 AMBIGUOUS 已由 02 实跑确认升 **D**。

全队最终口径以 [REPORT.md](REPORT.md) 与 [11 裁决附录](11-traceability-audit.md) 为准。本附记无凭证值。
