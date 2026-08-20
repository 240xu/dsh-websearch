# dsh-websearch

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

## Install | 安装

Drop into any node_modules dir that the dsh loader can resolve:

```bash
cp -r dsh-websearch /data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/
```

Then add this block to `~/.dsh/profiles/<profile>/cordis.patch.yml` (see [`examples/cordis.patch.yml`](examples/cordis.patch.yml)):

```yaml
- id: unified-search
  name: "@deepseek-ai/dsh-websearch"
- id: web-search-deepseek
  name: "@deepseek-ai/dsh-web-search-deepseek"
  disabled: true
- id: web
  name: "@deepseek-ai/dsh-web"
  config:
    searchProvider: unified
```

Restart `dsh web`. The built-in `web_search` tool now resolves through **unified**.

## Settings | 配置

The plugin installs a `settings:` section keyed `web.unified-search`. Override the enabled-backends list, numResults, base URLs, model names, and credential references per key-gated backend there. Defaults live in [`lib/index.js`](lib/index.js) (`Config` / `resolveOptions`).

### Settings Panel GUI

在 DSH Web GUI 的 Settings 面板中，会自动出现 **"Unified Search"** 板块，包含：

- **后端表格**：启用 ✅ | 名称 | 类型 (keyless/credential/mcp) | API Key (密码框) | Base URL | Model
- **每行可拖拽排序**——决定 fan-out 优先级
- **全局设置**：默认结果数、并发数、超时时间

### Env-var fallbacks (when the settings section is empty or omitted)

| backend | env var | when absent |
|---|---|---|
| deepseek | `DEEPSEEK_API_KEY` | backend stays unavailable (keyless-only set runs) |
| anthropic | `ANTHROPIC_API_KEY` | same |
| openai | `OPENAI_API_KEY` | same |
| brave | `BRAVE_API_KEY` | same |
| tavily | `TAVILY_API_KEY` | same |
| serper | `SERPER_API_KEY` | same |
| mojeek | `MOJEEK_API_KEY` | same |
| global override of backend set | `DSH_UNIFIED_SEARCH_BACKENDS` (comma-separated ids) | falls back to the keyless-only default |

## Design | 设计

- **One provider, no ambiguity**: a single `registeredSearchProvider({id:"unified"})` — the `dsh-web` seam's selection rule picks it unambiguously, and `search()` caps `maxResults` itself.
- **`Promise.allSettled` fan-out**: every enabled + available backend fires concurrently; a single backend failure is demoted to a soft `null` so the rest still contribute — only when ALL fail does the provider throw `WEB_PROVIDER_ERROR`.
- **Per-backend abort demotion**: a single backend aborting becomes soft-null; the provider only rethrows `WEB_ABORTED` when the caller's own `AbortSignal` fires.
- **URL dedup + merge**: results across backends are merged and deduped by case-insensitive URL; missing title/snippet/publishedAt from one backend get filled in from another (e.g. Exa's title + Parallel's excerpt).
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
