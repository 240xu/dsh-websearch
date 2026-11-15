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

> 可用性说明：available() 只做本地配置检查（不联网探测可达性）；密钥在每次搜索时按操作解析，缺失时该后端以明确错误码软失败（不阻塞其他后端）。全部缺 Key 时错误会指向设置页。

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

## v2.8.1 SettingsForms 适配 | What's new in v2.8.1

- **0.2.0 设置面板表单**：Config 标记 `meta.volatile`——0.2.0 SettingsForms 从插件 Config 自动生成表单，但 volatileForm 只保留 volatile 字段（此前 websearch 表单为空）；现整棵 Config 成为 0.2.0 表单。裁决与考证见 dsh-plugin-hub/docs/reviews/cross-settings-forms.md。
- 删除 0.2.0 线上与可见 UI 自相矛盾的 "no installSection" console.warn（0.1.5 路径不变）。
- 补齐全部裸字段（×ApiKeyEnv/×BaseURL/×Model）的 description——0.2.0 表单渲染唯一用户可见文案来自 meta.description。

## v2.8.0 查全查多 | What's new in v2.8.0

面向「查的多一点、查的全一点」的检索深度升级，全部 feature-gated、默认关：

### 1. multiQuery 多查询 RRF 融合（`multiQueryEnabled`，默认关）

- 门控启发式（刻意从严）：查询长度 > 60 字符，或含 `vs / and / 比较 / 对比 / 和` 分隔词，才触发；简单查询单扇出，行为与旧版完全一致（arXiv:2404.01037：盲目多查询会劣化）。
- 触发后派生 ≤3 个子查询（原查询永远参与融合且保持全权重），各自走完整 11 后端扇出，再用 RRF（k=60）融合：出现在多个子查询结果里的条目被提升，单列表独占条目按位次衰减；URL 去重、首见元数据保留。
- 遥测行合并各变体并截断至 12 条，避免淹没结果。

### 2. deepCoverage 深度覆盖（`deepCoverage`，默认关）

- 每后端请求条数上调至 `ceil(maxResults × 1.5)`，全局去重后仍按 maxResults 截断——牺牲带宽换覆盖面。
- 后端能力适配（feature-detect，不破坏旧参数）：Tavily 自动切 `search_depth: advanced`（2 credits，多 snippet/URL）；SearXNG 类目扩为 `general,news,it`（Search API `categories` 逗号列表）。
- Exa：`inferExaCategory` 从查询推断 data category（github / research paper / news，仅高置信注入）。

### 3. 运维可观测（P2）

- `GET /api/websearch/history` 响应新增 `backends` 字段：每后端最近真实成败/延迟/熔断状态（`{id, ok, ms, at, failCount, cooled}`，无错误串无凭证），兜底冗余度可观测。

### 4. per-backend 超时上限（P2）

- `ddg` / `searxng` 专属超时上限 5s（`min(5s, backendTimeoutMs)`，全局默认仍 30s、配置更短则以配置为准）——不可达后端不再拖住整个扇出尾。实测见 docs/real-call-2.8.0.md。

## v2.7.3 兼容修复 | What's new in v2.7.3

- **DSH 0.1.7 客户端兼容（P0）**：settingsScope 客户端服务在 0.1.7 被移除；现改为 feature-detect——0.1.5（或装 dsh-settings-scope-shim）行为不变，0.1.7 无 shim 时设置卡片优雅停用（console.warn 指引），客户端不再静默全死。
- **DSH 0.1.7 服务端（P1）**：SettingsForms 无 installSection，原 typeof 守卫静默跳过；现输出一次性 console.warn（搜索功能经 cordis config 不受影响），SettingsForms 迁移已立牌。
- **engines**：声明 `node >= 20.3`（AbortSignal.any 实测需求，Node 18/20.0-20.2 首次搜索即 TypeError）。
- description 瘦身（版本历史移回本文件/CHANGELOG.md）。
- **Windows 双端（P2）**：缓存/历史目录回退改用 `os.homedir()`（此前 `process.env.HOME` 在 Windows 通常未设 → 相对路径 → 缓存静默失效）。

## v2.7.2 补丁 | What's new in v2.7.2

- 设置项 label：6 个新设置项在 schema 层挂用户语言 label（含单位尾注，如「缓存有效期（秒）」），宿主渲染不再回退 camelCase 键名；description 同步以人话名称开头（真机渲染行为归视觉待办 V5）。

## v2.7.1 评审修复 | What's new in v2.7.1

- **缓存 key 加入 enabledBackends 选择集**（arch-review P1-1）：切换后端组合后立即拿到与新配置一致的结果，不再吃旧组合缓存。
- **缓存命中路径复用 URL scheme 白名单**（纵深防御）：被篡改的缓存文件里的 javascript:/data: 条目在命中时同样被过滤。
- **history 并发写串行化**：record() 经进程内 promise 链串行，杜绝并发搜索完成时的丢失更新；单条写入仍为 tmp+rename 原子替换。
- **history 路由信任围栏**：两条 /api/websearch/* 路由要求回环 Host（防 DNS rebinding）+ same-site 浏览器上下文（防跨站 text/plain CSRF）；无头客户端（curl）放行只读 GET。
- **熔断冷却时长支持 0**：`breakerCooldownMs=0` 显式关闭冷却（此前静默回退 60s）。
- **设置文案**：6 个新设置项改用户语言并按【缓存】/【熔断】/【历史】分组，单位（秒/毫秒）写入说明。
- **互操作**：新增 window 事件 `dsh-websearch:open-settings`（devkit 命令联动）；收到时经 devkit toast 提示设置路径（宿主无分区跳转 API）。

## v2.7.0 新增 | What's new in v2.7.0

三大增量功能，全部经设置开关控制、默认为保守值，且不改变既有结果语义（v2.6.0 提示词原样保留）：

### 1. 搜索结果磁盘缓存（默认开）

- 相同 **(整形后查询 + filters + maxResults + 启用后端集合)** 在 TTL 内直接命中缓存，不打任何后端；`sources` 与首次搜索完全一致。
- 命中时 `content` 追加一行 `[websearch cache] cache hit, age Ns`。
- 存储位置：`$DSH_HOME/cache/websearch/results/`，单条目一个 JSON 文件，tmp+rename 原子写，超出上限按最旧淘汰；任何 fs 错误都被吞掉，缓存坏了绝不影响搜索。
- 设置：`cacheEnabled`（默认 true）、`cacheTtl`（秒，默认 900）。

### 2. 后端熔断器（默认开，保守阈值）

- 同一后端**连续失败 3 次**进入 **60s 冷却**；冷却期内 eligible 选择直接跳过该后端，遥测行标注 `id ⏸cooled Ns`。
- 状态与 `recordBackendHealth` 共用（健康条目新增 `failCount` / `cooledUntil` 字段），任意一次成功立即复位。
- **Fail-open 兜底**：若所有候选后端都处于冷却期，则全部放行照常扇出——熔断器永远只会让搜索更快，不会让它更差。
- 设置：`breakerEnabled`（默认 true）、`breakerThreshold`（默认 3）、`breakerCooldownMs`（默认 60000）。

### 3. 搜索历史 API（默认开，只追加 / 只读暴露）

- 每次搜索（含缓存命中）追加一条记录，环形上限 50 条，新在前；文件 `$DSH_HOME/cache/websearch/history.json`，写前原子替换。
- `GET /api/websearch/history` → `{ ok, entries: [{ query, time, resultCount, backendsOk, backendsTotal }] }`（只读，无凭证、无 URL）。
- `POST /api/websearch/history/clear` → `{ ok, cleared: true }` 显式清空。
- 设置：`historyEnabled`（默认 true）。

## Design | 设计

- **One provider, no ambiguity**: a single `registeredSearchProvider({id:"unified"})` — the `dsh-web` seam's selection rule picks it unambiguously, and `search()` caps `maxResults` itself.
- **`Promise.allSettled` fan-out**: every enabled + available backend fires concurrently; a single backend failure is demoted to a soft `null` so the rest still contribute — only when ALL fail does the provider throw `WEB_PROVIDER_ERROR`.
- **Per-backend abort demotion**: a single backend aborting becomes soft-null; the provider only rethrows `WEB_ABORTED` when the caller's own `AbortSignal` fires.
- **Dedup strategies**: `url` keeps the historical URL-key merge with cross-backend field fill-in; `url+title` additionally collapses same-story syndicated mirrors (title Jaccard >= 0.9, CJK-aware tokenizer) while still enriching the kept entry.
- **Deterministic rerank (optional)**: query-term overlap scoring (title x3 / snippet x2 / URL x1); stable ties preserve fan-out priority — same input always yields the same order.
- **Honest timeouts**: each backend runs under an internal abort controller merged into the caller signal; when only the internal timer fires, the failure is reclassified as WEB_PROVIDER_ERROR ("backend <id> timed out") instead of being masked as a user cancellation.
- **Concurrency & Timeout Control**: `concurrency` (default 6) limits simultaneous calls; `backendTimeoutMs` (default 30s) caps each backend.
- **Streamable-http MCP, custom handshake**: `lib/util/mcp-client.js` implements `initialize → notifications/initialized → tools/call` with `Mcp-Session-Id` header caching against Exa and Parallel — no dependency on the full MCP SDK.
- **Host-logger diagnostics**: each backend routes request/outcome through lib/util/log.js to the host logger (ctx.logger), best-effort and never thrown - deliberately NOT session events: the session event vocabulary is a closed set third-party plugins must not extend (an unknown envelope type makes the whole session log unreadable).

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
node --test tests/
```

v2.7.0 起共 76+ tests pass（`node --test "tests/*.test.js" "test/*.test.mjs"`）。

## 权威依据与取舍 | Authoritative sources & design trade-offs

v2.7.0 缓存/熔断/历史三项的依据与刻意取舍（含查证过的反例）：

1. **熔断器（Circuit Breaker）**：出处 Michael T. Nygard《Release It!》(Pragmatic Bookshelf, 2007) 与 Microsoft Azure Architecture Center「Circuit Breaker pattern」https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker 。经典状态机是 Closed → Open → Half-Open（半开态放行少量探测请求）。**本插件刻意省略半开态**：冷却到期即视为 Closed（下一次真实搜索就是探测），失败则立即重新开窗——因为这里的"请求"是一次多后端扇出中的单个后端调用，探测请求必然真实发生且失败成本只是一次软降级，无需额外探测计数器；同时保留 fail-open 兜底（全部冷却时放行），比经典模式更保守。
2. **缓存失效（TTL-only vs 事件驱动）**：Cloudflare「Retention vs Freshness (TTL)」https://developers.cloudflare.com/cache/concepts/retention-vs-freshness/ 与「Revalidation」https://developers.cloudflare.com/cache/concepts/revalidation/ 。搜索结果没有可靠的原站变更信号可订阅（网页索引持续变化），事件驱动失效无锚点；TTL-only + 把 TTL 做成设置项（默认 900s）+ key 纳入后端组合，是"可接受的最终一致性"。取舍：900s 内索引更新不可见——对搜索场景可接受，且用户可调低。
3. **原子写（tmp + renameSync）**：POSIX 上 rename(2) 原子替换（Node 文档：newPath 已存在时覆盖）；Windows 上 libuv 将 fs.rename 映射为 MoveFileExW(MOVEFILE_REPLACE_EXISTING)（libuv#283 https://github.com/joyent/libuv/issues/283 ，LWN 讨论 https://lwn.net/Articles/682988/ 指出 MS 文档不承诺该调用的原子性）。**结论：POSIX 双端原子；Windows 实践上等价但官方文档不背书**——因此本插件在写入端额外做了兜底：读端永远校验 JSON 完整性、坏条目按 miss 处理并删除，即使 Windows 上出现半写状态也不会返回坏数据。
4b. **查全查多（v2.8.0）**：Tavily Search API（`search_depth: advanced` 2 credits、`max_results` 0-20、`include_answer`、topic=news 时间加权）https://docs.tavily.com/api-reference/endpoint/search ；Exa Search API（type 分类检索、category 枚举、livecrawl；注意 2026 版 coding-agent 指南声明 neural 为 legacy 术语、且告诫勿臆造 category 值——本插件只注入 OpenAPI 枚举内的高置信值）https://exa.ai/docs/reference/search-api-guide-for-coding-agents 与 https://github.com/exa-labs/openapi-spec/blob/master/exa-openapi-spec.yaml ；SearXNG Search API（`categories` 逗号多类目、`language`）https://docs.searxng.org/dev/search_api.html ；Brave Search API（`freshness`、`result_filter`，本轮仅调研未接线）https://api-dashboard.search.brave.com/app/documentation 。多查询融合：RRF 出自 Cormack et al. 2009，RAG-Fusion 实现 https://github.com/Raudaschl/rag-fusion ；HyDE https://arxiv.org/abs/2212.10496 ；**门控依据** arXiv:2404.01037（盲目多查询劣化）——因此 multiQuery 默认关、启发式从严、原查询全权重参与。
4c. **per-backend 超时**：不可达主机的 TCP 连接失败不受应用层超时保护，只能靠 abort 计时器兜底；ddg（HTML 抓取）与 SearXNG（公共实例无 SLA）是拖尾主力，5s 上限取「P50 成功延迟的一个数量级」。
4d. **搜索历史隐私**：Article 29 Working Party 意见书 WP148 https://ec.europa.eu/justice/article-29/documentation/opinion-recommendation/files/2008/wp148_en.pdf 认定查询日志（query + 时间 + 来源标识）属个人数据；EFF 六条自保建议 https://w2.eff.org/Privacy/search/searchtips.pdf 的第一条是"别在搜索词里放 PII"——说明 query 天然可能携带 PII（人名、账号、地址）。本插件的取舍：历史只存 {query, time, resultCount, backendsOk/Total}（无 IP、无 cookie、无结果 URL）、环形 50 条自动滚动即短保留、本机存储不出网、提供 historyEnabled 开关与 POST clear 端点。**未做 query 脱敏**：脱敏会破坏"查看最近搜了什么"的核心用途，且本机单用户场景下该数据本就在 DSH 会话日志里存在；若未来历史跨设备同步，脱敏/加密是上线前置条件。

## License | 许可

MIT © 2026 240xu

## 2.8.2 · Bug 猎场修复（P1×3 + 回归测试）

- **[P1] 零结果伪造失败**：所有后端成功但 0 命中时，原实现落进 `all enabled
  backends failed (0) - `（计数自相矛盾、detail 空）并丢弃 mergedContent（Tavily
  直答）。成功即空 → 正常返回 `{sources:[]}` + history 记录。
- **[P1] limiter 死锁**：`Promise.resolve(fn())` 先执行 fn——同步抛出（如 baseURL
  校验在建 timeout 前）逃出后 `running` 永不递减，泄漏 ≥ concurrency 后所有任务
  永久排队且超时机制未武装（实测 HUNG exit=13）。改 `Promise.resolve().then(fn)`。
- **[P1] exa category 漏门控**：tavily/searxng 的 deepCoverage 增强都门控，唯独
  exa 漏了——默认关 deepCoverage 也注入 category 收窄结果，与 README 承诺相反。
- 回归测试 3 条（零结果/limiter 不死锁带 HUNG 超时护栏/exa 双态门控）；
  `createLimiter` 导出供测试。89/89。

## 2.8.3 · Bug 猎场修复第二批（P2×3 + 测试）

- **[P2] 整形空查询早拒**：寒暄独词（"搜索"/"search"/"查询"）被剥空后不再扇出、
  不入缓存（原来空串共享缓存键 + 落入 all-backends-failed(0) 误导错误）；
  ZH 寒暄表补裸「搜索」（原 `搜索一下?` 要求带“一”漏掉裸词）。
- **[P2] CJK 分隔符词内保护**：和/比较/对比 须**任一侧**有空白/标点边界才切——
  词内裸和（柔和光线/和平精英）不再切断实体；单侧空格的真分隔（"sftp 和面板"）照切。
- 回归测试 ×4（零结果/limiter 死锁/exa 门控/CJK 保护/空查询拒），91/91。
