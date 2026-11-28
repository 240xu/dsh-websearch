# 125 · 搜索介入程度分级与官方行为对齐（2026-11-28）

> 分支 `merge/upstream-288-plus-fixes`。4 个只读专家（官方行为 / 分级设计 / 优化 / 对抗）独立取证，Lead 复核后落地。
> 权威基线：本机 DSH **0.2.2-rc.5** 源码；外部官方文档/源码按 tag 或 commit 固定。

## 1. 官方基线（为什么默认介入要更低）

| 事实 | 证据 |
| --- | --- |
| `web_search` 只有 `queries: string[]`（1–10），模型自己写查询；provider 不拥有查询构造 | `dsh-tool-web/src/search.ts:367-375` |
| 多个 query 由 **tool 层**并发调用 `ctx.web.search`，再按 rank 轮转合并、URL 去重、截断 | `search.ts:265-329` |
| provider 契约：一次请求 **一个 query**，返回 `{content?, sources[], truncated}`；`content` 是 provider 生成的答案/摘要，不是指令 | `dsh-web/src/types.ts:26-47,56-63` |
| `maxResults` 是 tool 层边界，seam 回程强制截断；默认 **10** | `types.ts:30-42`；`dsh-web/src/index.ts:207-210,331-335`；`search.ts:20` |
| tool 自己会加“外部内容不可信”声明与“引用 URL”指令 | `dsh-tool-web/src/trust.ts:7`；`search.ts:86,105` |
| 官方 DeepSeek provider **不整形、不派生子查询、不 fan-out、不重排、不写 content** | `dsh-web-search-deepseek/src/provider.ts:243-252` |
| provider 可以在一次调用内做多次原生搜索（成本由 provider 承担） | `dsh-tool-web/README.md:275,277` |
| 外部：OpenAI/Anthropic 的 web 工具由模型决定搜索；Exa/OpenCode 原样转发 query；Parallel 要求调用方写 objective + 2–3 条 search_queries | OpenAI `openai-openapi@4f17927`；Anthropic `anthropic-sdk-python@v2.14.0`；Exa `exa-mcp-server@81d687e7`；OpenCode `v2.2.5`=`9bbb8ce1`；Parallel `docs.parallel.ai/integrations/mcp/quickstart.md`（2026-11-28） |

结论：**查询构造、多查询、结果呈现属于宿主/模型层**；provider 层的合法介入是“扇出、聚合、去重、按后端能力映射过滤”，而不是替模型改查询或往 `content` 塞指令。

## 2. 原有介入的问题（已修）

| 问题 | 证据 | 修复 |
| --- | --- | --- |
| 查询整形把内容词当前缀：`findability`→`ability`、`searching`→`ing`、`google search api`→`api`，并剥掉成对引号的一侧 | `shapeQuery` 实测 | 只剥明确的口语/请求短语；引号/`site:`/版本/专名不动；纯请求词仍早拒 |
| 单次搜索内按“变体”折叠熔断：1 次多查询可把 `failCount` 推到 3、自己触发冷却 | 124 §4.1；实测 1 搜索 3 变体 → `failCount=3` | 健康/熔断在**每次搜索**按 backend 聚合一次；成功优先，失败保留最严重分类 |
| RRF 让“出现在多个窄变体里”的首页压过原查询 rank-0 的答案 | 对抗实验：0.03125 vs 0.01667 | 原查询权重 2，派生变体 1；单变体不再进入 multi 模式 |
| `url+title` 去重/rerank 丢弃个位数字：GPT-4 与 GPT-5 被合并 | 实测 2 条 → 1 条 | tokenizer 保留数字 token；版本不同不再合并 |
| 缓存键不含档位/查询语言：不同档位或中英同一整形结果可互相命中（含量头语言错误） | 实测同一 key | `intervention`/`queryShaping`/`queryLanguage` 进入缓存键 |
| `resultHeader` 不可配置（Config 无字段） | `resolveOptions` 无此键 | 进入 `resolveOptions`；official 档关闭 |
| TinyFish keyed 每次搜索都重新 initialize（3 次往返） | 优化审计 mock 计数 | 复用按 URL+X-API-Key 分键的 session；轮换 Key 仍重新初始化，401/403/404 仍重试 |
| SearXNG 多实例拿不到 `backendTimeoutMs`，预算恒为 `NaN` | 优化审计 | provider 把 effective timeout 传入 backend options |
| 缓存写入每次 `stat` 全部条目（cap 200 时 2.2ms/次） | 优化审计 | 先只数文件名；超 cap 才 stat 并降到低水位（约 10%） |
| 默认条数 8 低于官方 tool 的 10，模型无感知地少拿来源 | `search.ts:20` | 默认 `numResults=10`；official 档完全沿用宿主上限 |

## 3. 分级（`intervention`）

| 档位 | 查询 | 多查询 | 深覆盖 | 重排 | 结果头 | 遥测 | 条数 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `official` | **原样** | 关 | 关 | 关 | 关 | 关 | 宿主 `maxResults` |
| `balanced`（默认） | 安全去噪 | 沿用独立开关（默认关） | 沿用 | 沿用（默认关） | 开 | 开 | `min(宿主, numResults)` |
| `thorough` | 安全去噪 | 沿用独立开关（默认关） | **开** | **开** | 开 | 开 | `min(宿主, numResults)` |

- `official` 对应官方 provider 的最小介入：不替模型改查询、不往 `content` 写指令/诊断、不降低宿主条数。
- `thorough` **不强制**内部多查询：官方 tool 已允许模型一次发 1–10 条 query 并轮转合并；provider 内部再派生会不可见地放大调用。多查询保持独立开关（`multiQueryEnabled`），默认关。
- `balanced` 与 2.8.9 的默认行为一致；`official`/`thorough` 是显式选择。
- 跨档不变量：tool 名/schema、provider id、`{sources,content,truncated}` 契约、URL http(s) 白名单、`numResults` 边界、遥测 tag。

## 4. 实现与验证

- `lib/index.js`：`intervention` Config（默认 `balanced`）+ `resolveOptions` 派生 `queryShaping/resultHeader/resultTelemetry/rerank/deepCoverage/numResults`。
- `lib/provider.js`：`queryShaping` 分支、官方条数、`useMulti`、查询语言进缓存键、每次搜索折叠健康、RRF 权重、effective timeout。
- `lib/prompting.js`：安全整形；`lib/util/rank.js`：数字 token；`lib/rrf.js`：可选列表权重。
- `lib/client.js`：设置卡“搜索介入程度”下拉（中英）+ 提示；6 个枚举下拉仍全部走 `SELECT_FIELDS` 校验。
- 测试：`tests/lead-20261128-tiers.test.js`（10）、`tests/lead-20261128-optimizations.test.js`（2），全套 **211**。
- 证据复跑：`node --test tests/*.test.js`；`bash g5/refresh.sh` 应在提交后重跑并保持 32/32 + 33/33。

## 5. 仍未做（记录）

- provider 的 `content` 头/遥测在 `balanced`/`thorough` 仍是“官方 tool 之外”的附加文本；`official` 档已完全关闭。若要与官方 100% 一致，可把默认档改为 `official`（产品取舍，未擅自改默认）。
- 多查询的 RRF 仍是插件自有融合；官方 tool 的轮转合并在 tool 层。两者同时开启时，模型可能看到 provider 内部重排；已用原查询权重缓解，未改成轮转。
- 路由感知（`llmProvider`）未接入：官方在 DeepSeek 路由偏好不同 provider，本插件只有一个 `unified`。
- 缓存命中仍写 `1/1` 历史计数（UI 统计口径）；缓存记录格式改动留待下一轮。
