# @240xu/dsh-websearch

[![npm version](https://img.shields.io/npm/v/@240xu/dsh-websearch.svg)](https://www.npmjs.com/package/@240xu/dsh-websearch)
[![license](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

> Aggregated web search provider for [DeepSeek Harness](https://github.com/deepseek-ai/dsh) — one plugin id `unified` that fans out to eleven backends concurrently, merges + URL-dedups results, and stays usable even when some backends go down.

A pure-Cordis drop-in: registers ONE provider at `ctx.web` so the `dsh-web` selection rule never fires `WEB_PROVIDER_AMBIGUOUS`. Zero-config search out of the box (Exa + Parallel + DuckDuckGo + SearXNG are keyless); API-key backends (DeepSeek / Anthropic / OpenAI / Brave / Tavily / Serper / Mojeek) auto-activate once their key is supplied via the credentials service or env.

---

DSH（[DeepSeek Harness](https://github.com/deepseek-ai/dsh)）原生插件：向 `ctx.web` 注册**唯一**的聚合搜索 provider `unified`，内置十一后端并发 fan-out，合并 + URL 去重后返回——即使部分后端宕机仍可用。

纯 Cordis 直插：只注册一个 provider，所以 `dsh-web` 的选择规则永远不会触发 `WEB_PROVIDER_AMBIGUOUS`。**零配置即可搜索**——Exa + Parallel + DuckDuckGo + SearXNG 四者皆无 key、开箱即用；DeepSeek / Anthropic / OpenAI / Brave / Tavily / Serper / Mojeek 在提供 API key 后自动激活。

## Backends | 后端

| id | key | endpoint | how it returns | notes |
|---|---|---|---|---|
| `exa` | none | `https://mcp.exa.ai/mcp` | streamable-http MCP, tool `web_search_exa { query, numResults }`, text blocks "Title:/URL:/Published:/Highlights:" | opencode 同源,无 key |
| `parallel` | none | `https://search.parallel.ai/mcp` | streamable-http MCP, tool `web_search { objective, search_queries[], session_id?, model_name? }` returns JSON-string `{ search_id, results: [{ url, title, publish_date, excerpts[] }] }` | opencode 同源,无 key |
| `ddg` | none | `https://html.duckduckgo.com/html/` | HTML scrape, decode `uddg=` redirect param for real URL + `result__snippet` | 兜底,零依赖 |
| `searxng` | none/optional | `https://searx.be/search` (default) | REST JSON `/search?q=`, public instances unlimited | 元搜索,隐私友好 |
| `brave` | `BRAVE_API_KEY` | `https://api.search.brave.com/res/v1/web/search` | REST JSON, independent index, 2000/mo free | 高质量,无 Google 偏见 |
| `tavily` | `TAVILY_API_KEY` | `https://api.tavily.com/search` | REST JSON, AI-focused, `answer` + `results[]`, deep search | AI 专用,含答案摘要 |
| `serper` | `SERPER_API_KEY` | `https://google.serper.dev/search` | REST JSON, scrapes Google `organic[]`, 2500/mo free | 极速,结构化 |
| `mojeek` | `MOJEEK_API_KEY` | `https://api.mojeek.com/v1/search` | REST JSON, independent index, 1000/day free | 无追踪,英文为主 |
| `deepseek` | `DEEPSEEK_API_KEY` | `https://api.deepseek.com/anthropic/v1/messages` | Anthropic Messages API + native `web_search_20250305` server tool, model `deepseek-v4-flash` | 与 dav web-search-deepseek 同机制 |
| `anthropic` | `ANTHROPIC_API_KEY` | `https://api.anthropic.com/v1/messages` | Anthropic Messages + `web_search_20250305`, model `claude-sonnet-4-6` | Claude Code 同机制 |
| `openai` | `OPENAI_API_KEY` | `https://api.openai.com/v1/responses` | Responses API native `web_search` tool, parse `url_citation` annotations | Codex 同机制 |

**Default enabled set**: `["exa", "parallel", "ddg", "searxng"]` — all keyless. The key-gated backends only join when their `available()` returns true (key present + baseURL reachable).

### SearXNG 实例 | Public instances

SearXNG 默认指向 `https://searx.be`；公共实例可用性随网络环境波动，失败时错误信息会提示换源。
在设置面板修改 `searxngBaseURL` 即可切换，常见候选：

| 实例 | 备注 |
|---|---|
| https://searx.be | 官方默认，部分地区不可达 |
| https://searx.tiekoetter.com | 稳定性较好 |
| https://priv.au | 隐私友好 |
| 自托管 | 最可靠，支持 API Key（`searxngApiKeyEnv`） |

## Install | 安装

### 方式一：作为 profile 依赖安装（推荐，规范做法）

```bash
cd ~/.dsh/profiles/web
# 在 package.json 的 dependencies 里加入：
#   "@240xu/dsh-websearch": "file:/path/to/@240xu/dsh-websearch"
pnpm install
```

插件自带 `dsh.bundle` 元数据（package.json 声明 `"dsh": {"bundle": {"patch": "./cordis.patch.yml"}}`），把它加入 profile package.json 的 `dsh.profile.bundles` 列表后即自动注册，**无需**在 cordis.patch.yml 手写条目。

只需在 `~/.dsh/profiles/web/cordis.patch.yml` 里把内置 web_search 工具指到 unified provider：

```yaml
- id: web
  name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: unified
- id: web-search-deepseek
  name: '@deepseek-ai/dsh-web-search-deepseek'
  disabled: true
```

重启 `dsh web` 即生效。

## Settings | 配置

> v2.0.3 起，配置界面位于 **Settings → 左侧栏「搜索 / Web Search」**（顶级分区，与通用/模型/插件同级）。
> 每个 API Key 字段旁有 **「获取 Key ↗」** 直达对应平台控制台；保存即写入凭证库并立即生效。


插件向 DSH 设置面板注册 `unified-search` namespace（Settings → Unified Search），全部字段扁平化、开箱可编辑：

**全局**

| 字段 | 默认 | 说明 |
|---|---|---|
| `numResults` | 8 | 每次搜索返回结果数（1-50） |
| `concurrency` | 6 | 并发后端数（1-10） |
| `backendTimeoutMs` | 30000 | 单后端超时毫秒 |
| `recency` | any | 时间范围过滤：day / week / month / year（映射到各后端原生参数） |
| `language` | 空 | 搜索语言，如 en、zh-CN（SearXNG/Brave/Serper 支持） |
| `safeSearch` | true | 安全搜索开关（SearXNG/Brave 支持） |
| `dedupStrategy` | url | url 仅按链接去重；url+title 额外合并同标题的转载镜像 |
| `rerank` | false | 按查询词相关性重排序（确定性；并列时保持后端优先级） |

**v2.1 结果策略**：设置面板新增「结果策略」分区。时间/语言过滤按各后端能力自动映射——Brave `freshness/country/search_lang`、Tavily `time_range`、Serper `tbs/hl/gl`（Google 日期语法）、SearXNG `time_range/language`、DDG `df`；不支持的后端自动忽略对应维度。内部超时以真实原因失败（backend "<id>" timed out after Nms），不再被静默降级为取消；Mojeek 的 API Key 改走 Authorization 头，不再出现在 URL 中。

**结果健康遥测（默认开）**：每次搜索的 `content` 尾部附一行 `[websearch backends] exa ✓5ms/3 · ddg ✗30000ms`，
模型可据此自诊断并建议用户调整设置；设置面板「结果策略」可关闭（`resultTelemetry`）。

**11 个后端开关**：`enableExa` / `enableParallel` / `enableDdg` / `enableSearxng`（默认开）；`enableBrave` / `enableTavily` / `enableSerper` / `enableMojeek` / `enableDeepseek` / `enableAnthropic` / `enableOpenai`（默认关）

**API Key 授权**（credential-ref，填环境变量名，实际 key 存于 credentials 服务或环境变量）：

| 字段 | 默认引用 |
|---|---|
| `braveApiKeyEnv` | `BRAVE_API_KEY` |
| `tavilyApiKeyEnv` | `TAVILY_API_KEY` |
| `serperApiKeyEnv` | `SERPER_API_KEY` |
| `mojeekApiKeyEnv` | `MOJEEK_API_KEY` |
| `deepseekApiKeyEnv` | `DEEPSEEK_API_KEY` |
| `anthropicApiKeyEnv` | `ANTHROPIC_API_KEY` |
| `openaiApiKeyEnv` | `OPENAI_API_KEY` |
| `searxngApiKeyEnv` | `SEARXNG_API_KEY`（私有实例可选） |

**Base URL / Model**：每个 key-gated 后端都有对应 `${id}BaseURL`；DeepSeek/Anthropic/OpenAI 另有 `${id}Model`；Tavily 有 `tavilySearchDepth`（basic/advanced）。

环境变量兜底：未在 credentials 配置时回退读同名环境变量；`DSH_UNIFIED_SEARCH_BACKENDS` 可逗号分隔强制指定启用集合。

## Design | 设计

- **One provider, no ambiguity**: a single `registeredSearchProvider({id:"unified"})` — the `dsh-web` seam's selection rule picks it unambiguously, and `search()` caps `maxResults` itself.
- **`Promise.allSettled` fan-out**: every enabled + available backend fires concurrently; a single backend failure is demoted to a soft `null` so the rest still contribute — only when ALL fail does the provider throw `WEB_PROVIDER_ERROR`.
- **Per-backend abort demotion**: a single backend aborting becomes soft-null; the provider only rethrows `WEB_ABORTED` when the caller's own `AbortSignal` fires.
- **Dedup strategies**: `url` keeps the historical URL-key merge with cross-backend field fill-in; `url+title` additionally collapses same-story syndicated mirrors (title Jaccard >= 0.9, CJK-aware tokenizer) while still enriching the kept entry.
- **Deterministic rerank (optional)**: query-term overlap scoring (title x3 / snippet x2 / URL x1); stable ties preserve fan-out priority — same input always yields the same order.
- **Honest timeouts**: each backend runs under an internal abort controller merged into the caller signal; when only the internal timer fires, the failure is reclassified as WEB_PROVIDER_ERROR ("backend <id> timed out") instead of being masked as a user cancellation.
- **Concurrency & Timeout Control**: `concurrency` (default 6) limits simultaneous calls; `backendTimeoutMs` (default 30s) caps each backend.
- **Streamable-http MCP, custom handshake**: `lib/util/mcp-client.js` implements `initialize → notifications/initialized → tools/call` with `Mcp-Session-Id` header caching against Exa and Parallel — no dependency on the full MCP SDK.
- **hooks.recordRequest/recordOutcome bridge**: each backend routes its request/outcome to `lib/util/log.js` which records `web/unified-search-backend-request` / `…backend-outcome` events onto the active DSH session via `ctx.get("agents")?.currentInitiator()?.session.append(...)` (mirrors `dsh-web-search-deepseek`).

## Architecture | 架构

```
lib/
  index.js                 # name/inject/Config/apply — registers settings + provider
  provider.js              # UnifiedSearchProvider — fan-out, abort demotion, dedup, truncate, concurrency, timeout
  util/
    abort.js               # isAbortError / searchAborted / throwIfSearchAborted / maybeAbortError
    mcp-client.js          # streamable-http MCP client (initialize + tools/call + session cache)
    log.js                 # recordBackendRequest / recordBackendOutcome → session event log
  backends/
    exa.js                 # Exa (web_search_exa) via mcp-client
    parallel.js            # Parallel (web_search) via mcp-client
    ddg.js                 # DuckDuckGo HTML scrape (uddg redirect decode)
    searxng.js             # SearXNG REST JSON (keyless)
    brave.js               # Brave Search REST (key-gated)
    tavily.js              # Tavily REST (key-gated, AI answer + deep search)
    serper.js              # Serper.dev REST (key-gated, Google scrape)
    mojeek.js              # Mojeek REST (key-gated)
    anthropic-like.js      # shared: DeepSeek + Anthropic (Messages API + web_search_* server tool)
    openai.js              # OpenAI /responses + web_search tool (url_citation parsing)
    index.js               # unified registry + individual exports
tests/
  parse.test.js            # 28 unit tests for each backend's pure parse fn
  provider.test.js         # 5 fan-out tests (merge/dedup, abort demotion, all-fail, maxResults cap, concurrency)
```

## Test | 测试

```bash
node --test tests/parse.test.js tests/provider.test.js
```

33/33 pass.

## License | 许可

MIT © 2026 240xu
