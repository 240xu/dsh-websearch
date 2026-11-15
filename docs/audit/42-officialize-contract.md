# 42 · 官方化行为规范：与 OpenCode v2.2.6 的 provider 契约对齐

> 执行者：官方化组 A（provider 契约对齐），team task-21。日期 2026-11-07（Asia/Shanghai）。
> **唯一写文件**：本报告。不改任何源码 / 配置 / 其它报告，不操作任务板。全程只读取证。
> 取证：GitHub API 认证（`U=x-access-token`，口令取自 `/opt/xr-research/zcode-research/.git/config` 的 remote URL 中 `:` 后部分，**值不写入本报告、不回显**）+ `raw.githubusercontent.com/anomalyco/opencode/v2.2.6/...` + 本机 `src-work/plugin/lib/` 逐字对比 + `node` 最小复现（/tmp 脚本已删）。
> 版本基准：**`anomalyco/opencode` tag `v2.2.6`**，commit `dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06`，`release: v2.2.6`，2026-11-06T22:49:49Z，该 release commit 改 36 个文件（**全部是 package.json / bun.lock / CHANGELOG.md，零源码变更**）【C/D】。
> 证据等级：**A**=源码实证（带 ref 永久链接 / 本地路径:行号）；**B**=官方文档；**C**=版本记录（tag/commit/CHANGELOG/PR/issue）；**D**=本机实测；**E**=推断或未取到、待核实（显式标注，不得当结论）。四联标注：`结论 → 依据(B/C) → 代码落点(A) → 验证(D)`。

---

## 0. 路径与版本订正（先于一切对比，C 级）

**结论 1（重要）**：任务单给出的路径 `packages/opencode/src/tool/websearch/` 在 `v2.2.6` **不存在**；`packages/opencode/` 整个目录都不存在（`/contents/packages?ref=v2.2.6` 列出的 33 个包里没有 `opencode`）【A/D】。
→ 依据 [C] `v2.2.6` / `dc2ffcf…`；→ 代码落点 [A] `https://github.com/anomalyco/opencode/tree/v2.2.6/packages/core/src/plugin/websearch`；→ 验证 [D] 认证 `GET /repos/anomalyco/opencode/contents/packages/opencode/src/tool/websearch?ref=v2.2.6` → **404**，同 `/contents/packages?ref=v2.2.6` → 目录清单。

**结论 2**：`v2.2.6` 的搜索 provider 源码在 **`packages/core/src/plugin/websearch/`**，共 **8 个文件**：`exa.ts` / `firecrawl.ts` / `index.ts` / `mcp.ts` / `parallel.ts` / **`provider.ts`** / `tavily.ts` / `tinyfish.ts`【A/D】。
→ 依据 [C] 同上；→ 代码落点 [A] `contents/packages/core/src/plugin/websearch?ref=v2.2.6`；→ 验证 [D] 目录 API 返回 8 项，逐文件 `curl` 全 200。

**结论 3（`provider.ts` 是 v2.2.6 相对 v2.2.5 的关键差异）**：`v2.2.5` 该目录是 **7 文件、无 `provider.ts`**（每个 provider 各自内联 `ctx.integration.transform` / `ctx.websearch.transform`）；`v2.2.6` **新增 `provider.ts`** 把这段抽成公共 `WebSearchProvider.register(ctx, {id,name,env,execute})`，5 个 provider 全部改为调用它【A/C】。
→ 依据 [C] 两版 tree 对比；→ 代码落点 [A] `v2.2.6/.../provider.ts:9-44` 与 `v2.2.6/.../exa.ts:30`、`parallel.ts:56`、`firecrawl.ts:41`、`tavily.ts:32`、`tinyfish.ts:54`；→ 验证 [D] 逐文件读；`v2.2.5` 的 `exa.ts` 内联版见 `https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/exa.ts`（对比样本）。

**结论 4（v2.2.6 相对 v2.2.5 的工具层 diff，仅 2 处）**【A/D `diff`】：
1. `tool/plugin/websearch.ts` 把 v2.2.5 手写的 `sessionID/agent/source` 三行换回 `...Permission.invocation(context)`（重构，语义等价）【A `:54`】；
2. `context` hook 的工具移除条件从 `if (disabled)` 扩为 `if (disabled || (yield* websearch.providers()).length === 0)`，并加注释「Policy can remove every provider, and the model shouldn't be offered a tool that can't search.」【A `v2.2.6 tool/plugin/websearch.ts:188-189`】。
→ 依据 [C] 两版同路径文件；→ 代码落点 [A] 上述；→ 验证 [D] `diff /tmp/v225tool.ts /tmp/v226/.../websearch.ts` 输出仅这两个 hunk。

**结论 5（schema 未变）**：`packages/schema/src/websearch.ts`（`ID` / `Provider` / `Input{query,providerID?}` / `Result{url,title?,content?,time:{published?}}` / `Response{providerID,results}`）与 `packages/schema/src/config/websearch.ts`（`Selection = false | Info{provider: ID|"random"}`）在 `v2.2.5` 与 `v2.2.6` **逐字相同**【A/D】。
→ 依据 [C] 两版；→ 代码落点 [A] `v2.2.6/.../schema/src/websearch.ts:1-44`；→ 验证 [D] `diff` 无输出。

**结论 6（v2.2.6 真正的新特性是策略层，不是 provider 层）**：`CHANGELOG.md` v2.2.6「Core / Improvements」明确「Added the **`websearch.use` policy action** … ([#61557])」【C `v2.2.6/CHANGELOG.md:23`】。`policies.mdx:250-268` 定义：`websearch.use` 的 resource 是 **provider ID**（`opencode` / `exa` / `firecrawl` / `parallel` / `tavily` / `tinyfish` / 插件 ID），effect 为 `allow|deny`（**没有 `ask`**）；「Denied providers are removed even when they work without an API key, such as Exa and TinyFish. When every provider is denied, the `websearch` tool is no longer offered.」「Clients older than 2.2.6 ignore `websearch.use`」【B】。`config/plugin/policy.ts:75-85` 在 `websearch.transform` 里对 `ManagedPolicy.decision(statements,"websearch.use",provider.id)==="deny"`（或 `integration.use` 被 deny）的 provider 执行 `editor.remove(provider.id)`【A】。
→ 依据 [B/C] 上述；→ 代码落点 [A] `v2.2.6/packages/schema/src/config/policy.ts:18-27`（`Action` 闭集含 `websearch.use`）、`:16`（注释「resource is a web search provider ID」）、`v2.2.6/packages/core/src/config/plugin/policy.ts:75-85`；→ 验证 [D] 认证代码搜索 `repo:anomalyco/opencode "websearch.use"` → 7 命中；PR #61557 files 列 10 个改动文件。

> **注意概念区分（避免混淆）**：`websearch.use`（**策略/policy**，effect=`allow|deny`，按 provider ID 过滤，2.2.6 新增）与 `permission action=websearch`（**权限/permission**，effect=`allow|ask|deny`，resource=query，v2.2.5 已有）是**两套独立机制**。§2 对比表分别列。

---

## 1. 逐项对齐表（官方 v2.2.6 / 我们 / 一致? / 风险 / 建议）

> 「我们」= `/home/ova/dsh/.artifacts/websearch-research/src-work/plugin/`（`@240xu/dsh-websearch` 工作副本，本机 `lib/`）。所有本地行号均指该副本。

| # | 契约项 | 官方 v2.2.6（A/B/C） | 我们（A，本地路径:行号） | 一致? | 风险 | 建议 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **provider 注册表** | `WebSearch.Service` 持 `Map<ID, ProviderImplementation>`；`provider.ts:9-44` 的 `register()` 统一做「integration 注册（key + env 两种方式）+ `ctx.websearch.transform(editor.add)`」；5 个 provider 由 `index.ts:7-13` 的 `WebSearchPlugins` 数组集中声明【A `v2.2.6/.../plugin/websearch/provider.ts`、`index.ts`】 | `lib/index.js:57-75` 的 `BACKENDS` 对象注册 **13 个 backend**（exa/parallel/ddg/searxng/brave/tavily/serper/mojeek/deepseek/anthropic/openai/**firecrawl**/**tinyfish**），`ALL_BACKENDS=Object.keys(BACKENDS)`【A `:78`】；只向 `ctx.web.registerSearchProvider()` 注册 **1 个 `unified` provider**（`lib/provider.js:31` `PROVIDER_ID="unified"`、`lib/index.js:514`） | **形似神不同**：注册表概念一致（ID→实现），但我们是「多 backend 扇出 + 单 provider」，官方是「多 provider 择一」 | 官方 `random`/429 冷却/session affinity 都建立在「一次只用一个 provider」前提上；我们的扇出模型语义不同，硬搬会破坏既有 11 后端融合 | **保持差异**（B 范式 vs 我们 B+扇出），但可借 `provider.ts` 的 `register()` 收口重复的 integration/凭据解析样板 → 见「建议对齐」档 |
| 2 | **`random` 选择** | `Selection = ID \| "random" \| false`（`core/src/websearch.ts:32`）；`randomProvider()` 从「未冷却且未尝试」里 `Math.random` 挑一个（`:143-156`）；配置项 `websearch.provider:"random"`【A/B `services/site/.../websearch` 系列文档】 | 无 `random`：默认 `DEFAULT_ENABLED=["exa","parallel","ddg","searxng"]`（`lib/index.js:82`），`enabledBackends` 由 config/toggle/env 三级决定（`lib/index.js:320-357`），**全部并发执行**，由 `lib/rrf.js` 融合 | **不一致（架构性）** | 无风险（我们不需要择一） | **保持差异 + 理由**：扇出+RRF 是我们的产品优势；只把官方「session 记忆 provider」的**稳定性思想**借到 backend 选择上即可（可选） |
| 3 | **429 `Retry-After` 冷却** | 仅 `choice==="random"` 且 HTTP 429 时：`cooldownMillis(retry-after, now)`，无有效值 `60_000ms`，写入 `cooldowns`，换下一个 provider 重试；全冷却立即失败（`core/src/websearch.ts:197-215,222-228`）【A】 | `lib/breaker.js:29-45` 的 `foldBreaker()`：**连续失败 3 次**才开闸，`cooldownMs` 默认 60s（`BREAKER_DEFAULTS`），**不读 `Retry-After`、不区分 429**；`provider.js:262-287` 在扇出前跳过 `isCooled` 的 backend；全冷却时 **fail-open**（`breaker.js:8-11` 注释）【A】 | **部分一致**（都有 60s 量级冷却） | ①不读 `Retry-After`：服务端要求长冷却时我们会过早重试，可能触发更严限流/封 IP；②官方「全冷却立即失败」vs 我们 fail-open，语义相反（我们更保守于可用性） | **建议对齐**：在 `WebError`/backend 失败路径保留 HTTP status，429 时读 `retry-after` 覆盖 `cooldownMs`；**保持差异**：fail-open 与「3 次才开闸」不改为官方的「单次 429 即冷却」（我们 13 后端扇出，单次抖动代价高） |
| 4 | **session affinity** | `preferred = new Map<Session.ID,{provider?}>`（`core/src/websearch.ts:94`），`query()` 里 `preferred.set(options?.sessionID, affinity)`（`:191-194`），`randomProvider` 优先复用 affinity（`:148-149`）；`SessionEvent.Deleted/Moved` 时清理（`:96-103`）；KV key `websearch:provider` 持久化选择（`:31,137-139,181-183`）【A】 | 无 session 级 affinity：只有 `lib/backends/parallel.js:23-24` 的 **`SESSION_ID` 进程级常量**（`dsh-websearch-` + uuid8）用于 Parallel free-tier 关联；`lib/cache.js` 按 query 缓存结果，非 provider 选择 | **不一致** | 低（我们不择一，affinity 无意义）；但 Parallel 的 session_id 语义与官方不同（官方根本不传 `session_id`） | **保持差异**，理由：扇出模型无「当前 provider」概念。可在报告里记一句「官方 `preferred` 是择一模型的产物」 |
| 5 | **`permission action=websearch`** | 工具内 `permission.assert({action:name /* "websearch" */, resources:[input.query], save:["*"], metadata:input, ...Permission.invocation(context)})`（`tool/plugin/websearch.ts:49-54`）；官方 docs：`permissions:[{action:"websearch",resource:"*",effect:"ask"}]`【A/B】 | 插件**无此层**：DSH 的权限由宿主 `dsh-web` 的 `web_search` 工具 / guard 负责；`lib/index.js:10` 注释「NAMESPACE was always the plain string `unified-search`. No import needed anymore.」；`lib/provider.js` 只接收 `ctx`，不做 `permission.assert` | **不一致（分层不同，非缺陷）** | 若未来把搜索下沉到插件内，会缺「query 作为 resource」的可审计权限点 | **必须对齐（概念层）**：在文档/契约里明确「权限归宿主、provider 只做执行」；可给 `hooks.recordRequest` 补 `query` 的审计字段（已含 `body`，等价可用） |
| 6 | **`websearch:false` 移除工具** | `config/plugin/websearch.ts:14-16`：`selection===false` → `websearch.default.set(false)` → `DisabledError`；`tool/plugin/websearch.ts:184-189` 的 `context/compaction/generate` hook 里 `delete event.tools["websearch"]`；**v2.2.6 新增**：provider 全被 policy 移除时也删工具（`:189`）【A】 | 无「从模型请求删工具」能力：关闭路径是 `enabledBackends` 为空 → `provider.js` 返回 `WEB_PROVIDER_UNAVAILABLE`（`lib/provider.js:295-298`）；`cordis.patch.yml:13` 用 `config: { searchProvider: unified }` 绑定，移除该行或禁用插件即关闭 | **部分一致**（都能关，但机制不同） | 官方「工具消失」比我们「工具仍在、调用报错」对模型更友好（不会白调用一次） | **建议对齐**：在宿主侧提供等价开关（**不属本插件可改范围**，需在报告里标为「需 DSH 宿主配合，E/跨组」） |
| 7 | **`websearch.use` policy（2.2.6 新增）** | `policies:[{action:"websearch.use",resource:"exa",effect:"deny"}]` 可按 provider ID 禁用，**连 keyless 的 Exa/TinyFish 也能禁**；全禁则工具消失【B `services/site/src/docs/content/policies.mdx:250-268`；A `config/plugin/policy.ts:75-85`】 | 无 policy 概念；近似物是 `enabledBackends` 白名单 / `DEFAULT_ENABLED` / Settings 开关（`lib/index.js:320-357`、`settings-api.js`） | **不一致（新增能力缺口）** | 企业/托管场景缺「按 backend 粒度强制 deny」的中央策略入口；`enabledBackends` 可被用户覆盖，policy 不可 | **建议对齐**（不是本轮必须）：把 `enabledBackends` 提升为「可被宿主 policy 覆盖的 allowlist」，语义对齐 `websearch.use` |
| 8 | **app dock / 首次同意表单** | `app/src/session/requests/websearch.ts` + `session-websearch-dock.tsx`：首表单 `Allow/Choose another provider/Disable`，第二表单选具体 provider，默认 `selected:"random"`；工具侧 `forms.ask` 对应（`tool/plugin/websearch.ts:65-145`）【A/B】 | 无 dock；配置走 `lib/settings-api.js` 的 `/api/unified-search/settings` + Settings 面板（`lib/index.js:429-453` 的 `installSection`/`describe/mutate` 双版本兼容） | **不一致（GUI 层）** | 无（产品形态不同） | **保持差异** |
| 9 | **`mcp.ts` initialize 语义** | **exa / parallel / firecrawl 根本不 initialize**：`WebSearchMcp.call()` 直接发单个 `tools/call`（`mcp.ts:28-68`）；**只有 tinyfish 且 `credential?.type==="key"` 才**走 `initialize → notifications/initialized → 拿 Mcp-Session-Id`（`tinyfish.ts:64-65,89-131`），注释「Keyed requests are rejected without the `Mcp-Session-Id` returned by `initialize`; keyless ones are not.」；**keyless tinyfish 也不 initialize**【A】 | `lib/util/mcp-client.js:23-101` 的 `ensureSession()` 默认对**所有** MCP 后端做 3 步串行（initialize → notifications/initialized → tools/call），`sessionCache` 按 URL 缓存 10min（`:13-16`）；`mcpCall()` 第 6 参 `options.skipInitialize` 可跳过（`:159,163`）。调用方：**exa.js:62 / parallel.js:50 / firecrawl.js:72 都没传 options**（→ 全走 3 步）；**tinyfish.js:81 传 `{skipInitialize: !keyed}`**（keyless 跳过、keyed 走 3 步）【A】 | **部分一致**：tinyfish 的 keyed/keyless 分叉与官方**完全一致**；exa/parallel/firecrawl 与官方**不一致** | 31 号实测 ~16s 拖尾；多两次 RTT；`ensureSession` 缓存 key 仅 URL（见 #12） | **必须对齐**：给 exa/parallel/firecrawl 传 `skipInitialize:true`（见 §3 最小改动 + 行为级验证） |
| 10 | **`firecrawl_search` 的 `limit`** | **硬编码 8**：`firecrawl.ts:52` `{ query: input.query, limit: 8 }`；`McpInput.limit` 是 optional（`:14`）但调用点写死【A】 | `lib/backends/firecrawl.js:43` `limit: request.maxResults ?? 8`；`parseFirecrawlResult(result, request.maxResults ?? 8)`（`:94,120`）【A】 | **不一致** | 若调用方传 `maxResults>8`，我们向 Firecrawl 多要结果，可能触发 keyless tier 更严配额/计费；结果与官方默认行为不可比 | **必须对齐**：`limit: 8` + 本地按 `maxResults` 截断（保留本地截断能力，见 §4） |
| 11 | **TinyFish keyless 每次 initialize 语义 / Session-Id 缓存** | 官方 `tinyfish.ts:65` **keyed 每次 `execute()` 都重新 `initialize()`**（无缓存、无 TTL），拿到的 `Mcp-Session-Id` 只用于本次 `tools/call`（`:72`）；keyless 完全不 initialize【A】 | `tinyfish.js:81` keyless 跳过 ✓；**keyed 走 `mcpCall` 默认 → `ensureSession()` 的 `sessionCache`（URL 为 key，TTL 10min）**，换 key 后仍复用旧 `Mcp-Session-Id`（`mcp-client.js:25-29,99`）【A】 | **keyed 路径不一致** | 换 `TINYFISH_API_KEY`（凭据轮换/多账号）后，旧 Session-Id 与旧 key 绑定，可能 401/403；`mcp-client.js:194-196` 有 401/403/404 时 `invalidateSession` 重试一次的兜底，但仍多一次失败往返 | **必须对齐**：keyed tinyfish 不走共享 sessionCache（或把 cache key 扩成 `url + key 指纹`，**绝不把 key 明文入 key/log**）；见 §4 |
| 12 | **`sessionCache` 的 key 粒度** | 官方无跨调用 session 缓存（每次 keyed initialize 取新 id）【A `tinyfish.ts:65,89-124`】 | `mcp-client.js:16` `const sessionCache = new Map()`，`ensureSession(url, signal)` 以 **URL 单键**缓存 `{sessionId, initializedAt}`（`:25,99`）；`invalidateSession(url)` 同键（`:140-142`）【A】 | **不一致** | 多凭据 / baseURL 相同但 header 不同时串会话 | **建议对齐**：cache key 加入「非敏感的凭据存在性/指纹」，或至少把 keyed tinyfish 排除出共享缓存 |
| 13 | **响应体上限 / 超时** | `MAX_RESPONSE_BYTES = 256*1024`（`mcp.ts:7,56-60`），`tools/call` 25s 超时（`mcp.ts:64-67`）；tavily REST 同样 25s（`tavily.ts:59-62`）；`parseResponse` 支持 direct JSON + SSE `data:` 双解析（`mcp.ts:9-26`）【A】 | `mcp-client.js` 用 `egressFetch` + `parseEnvelope`（`:107-135`，SSE 多行 join + 纯 JSON + batch）；**无显式字节上限**（靠 `response.text()` 全读）；超时靠外部 `signal`（`lib/util/abort.js` / `backendTimeoutMs`）【A】 | **部分一致** | 恶意/异常大响应可能撑内存；官方 256KiB 是明确的 token/内存预算 | **建议对齐**：在 `mcpCall` 读 `text` 前做 `Content-Length` 早拒 + 流式累加封顶（256KiB），与 `dsh-web` 的 `WebError` 风格一致 |
| 14 | **provider 数量** | `index.ts:7-13` 仍 **5 个**（exa/firecrawl/parallel/tavily/tinyfish），schema 未变【A/C】 | 13 个 backend（含官方 5 个中的 4 个 MCP + tavily；**无 `opencode` Console hosted**）【A `lib/index.js:57-75`】 | **超集**（我们更多） | 无 | 保持差异；新 provider 并入结论见 §5 |

---

## 2. 三档建议

### 档 1 · 必须对齐（本轮应落地，均为「不破坏 exa/parallel 现有成功路径」的最小改动）

| 项 | 理由 | 验收 |
| --- | --- | --- |
| **M-1** exa / parallel / firecrawl 传 `skipInitialize: true` | 官方 `mcp.ts` 对这三个端点**只发 `tools/call`**【A `v2.2.6/.../mcp.ts:28-68` + 三 provider 的调用点】；31 号实测 3 步串行 ~16s 拖尾；`tinyfish.js` 已验证该选项可用【A】 | 行为级回归：mock `egressFetch` 断言这三个 backend **恰好 1 次 POST**、body `method:"tools/call"`、无 `initialize`；真实端点各跑一次 200 |
| **M-2** `firecrawl.js` 的 `limit` 改 8 | 官方硬编码 `limit: 8`【A `v2.2.6/.../firecrawl.ts:52`】；我们 `maxResults ?? 8` 会放大 keyless 配额消耗 | 单测断言 `args.limit === 8`（即使 `request.maxResults=20`），且 `parseFirecrawlResult` 仍按 `maxResults` 截断 |
| **M-3** keyed tinyfish 不走共享 `sessionCache` | 官方 keyed 每次重新 `initialize` 取新 `Mcp-Session-Id`【A `tinyfish.ts:65`】；我们 10min URL 缓存换 key 会复用旧 Session-Id | 单测：同一 URL、两次不同 key → `initialize` 被调用 2 次、第二次 `tools/call` 带**新的** `Mcp-Session-Id`；断言任何 log/recordRequest 中无 key 值 |

### 档 2 · 建议对齐（下一迭代，需设计）

- **S-1** 借 `provider.ts` 的 `register()` 形状收口 `lib/index.js` 里 13 个 backend 的「凭据解析 + 可用性 + 注册」样板（当前 `firecrawl.js:51-54` / `tinyfish.js:49-52` 各写一遍 `apiKey ?? await resolveApiKey()`，31-b P0 修过一次，易再漂移）。**只收口形状，不引入择一语义**。
- **S-2** 429 时读 `retry-after` 覆盖 `breakerCooldownMs`（保留「3 次才开闸」与 fail-open）。
- **S-3** `mcpCall` 加 256KiB 响应上限（对齐 `mcp.ts:7`）。
- **S-4** `enabledBackends` 升级为可被宿主 policy 覆盖的 allowlist，语义对齐 `websearch.use`（`policies.mdx:250-268`）。
- **S-5** `sessionCache` key 加入非敏感凭据指纹（或 keyed tinyfish 单独禁缓存）。

### 档 3 · 保持差异 + 理由（不要为了「官方化」硬搬）

| 项 | 理由 |
| --- | --- |
| **多后端扇出 + RRF 融合 / 13 backend** | 官方是「一次择一 provider」（`random` + 429 换下一个），我们是「并发扇出 + `rrf.js` 融合」，是产品优势；`random`/`preferred` affinity 是择一模型的产物，搬过来会破坏融合语义 |
| **`websearch:false` 从模型请求删工具** | 属 DSH 宿主 `web_search` 工具层职责，插件无法也不应改动；记录为跨组事项（E） |
| **app dock / 首次同意表单** | GUI 形态不同，我们用 Settings 面板（`settings-api.js`），无 dock 需求 |
| **breaker 的「3 次才开闸」与 fail-open** | 官方单次 429 即冷却、全冷却立即失败；我们 13 后端扇出，单次抖动代价高，fail-open 保证可用性 |
| **`permission action=websearch` 归宿主** | 分层不同：官方权限在工具叶子，DSH 在宿主 guard；插件只做 `hooks.recordRequest` 审计（已含 query/body，等价） |
| **`request.maxResults` 的本地截断** | 官方 `limit:8` 但 `Result[]` 不再本地截断；我们保留 `maxResults` 截断以控制上下文注入（与 DSH `dsh-web` 的 token 预算一致） |

---

## 3. 可直接 apply 的 diff 片段（**不实际 apply**，仅提案）

> 全部为 `src-work/plugin/lib/` 相对路径；行号基于本机副本。未执行任何写操作。

### D-1 · M-1：exa / parallel / firecrawl 跳过 initialize

```diff
--- a/src-work/plugin/lib/backends/exa.js
+++ b/src-work/plugin/lib/backends/exa.js
@@ -60,7 +60,11 @@
     let result;
     try {
-      result = await mcpCall(EXA_ENDPOINT, EXA_TOOL, args, {}, signal);
+      // OpenCode v2.2.6 mcp.ts:28-68 sends a single tools/call for Exa.
+      // Exa's public MCP endpoint is stateless; the 3-step handshake only
+      // adds two RTTs (31-adversarial: ~16s tail). Tinyfish keyless already
+      // uses this option (tinyfish.js:81).
+      result = await mcpCall(EXA_ENDPOINT, EXA_TOOL, args, {}, signal, {
+        skipInitialize: true,
+      });
     } catch (err) {
```

```diff
--- a/src-work/plugin/lib/backends/parallel.js
+++ b/src-work/plugin/lib/backends/parallel.js
@@ -47,7 +47,10 @@
     let result;
     try {
-      result = await mcpCall(PARALLEL_ENDPOINT, PARALLEL_TOOL, args, {}, signal);
+      // OpenCode v2.2.6 mcp.ts:28-68: Parallel receives a bare tools/call,
+      // no initialize / Mcp-Session-Id. Keep the single POST.
+      result = await mcpCall(PARALLEL_ENDPOINT, PARALLEL_TOOL, args, {}, signal, {
+        skipInitialize: true,
+      });
     } catch (err) {
```

```diff
--- a/src-work/plugin/lib/backends/firecrawl.js
+++ b/src-work/plugin/lib/backends/firecrawl.js
@@ -69,7 +69,11 @@
     let result;
     try {
       result = await mcpCall(
         endpoint,
         FIRECRAWL_TOOL,
         args,
         extraHeaders,
         signal,
+        // v2.2.6 firecrawl.ts:47-57 calls WebSearchMcp.call directly;
+        // the hosted keyless tier is stateless for tools/call.
+        { skipInitialize: true },
       );
     } catch (err) {
```

**为什么不会破坏 exa/parallel 现有成功路径（行为级论证，A/D）**：
1. `mcpCall` 的 `skipInitialize:true` 分支只做一件事——`sessionId = undefined`（`mcp-client.js:163`），后续 `tools/call` 的 headers 里不带 `Mcp-Session-Id`（`:179`），**body 与请求方法完全不变**（`:165-186`）；
2. `mcp-client.js:151-156` 的 JSDoc 明确该选项就是为「stateless MCP servers whose keyless tier rejects an initialize round-trip」而加，且 `tinyfish.js:81` 已在生产路径使用同一分支（A 级先例）；
3. 官方 v2.2.6 对这三个端点**从不 initialize**（`exa.ts:38-44` / `parallel.ts:62-75` / `firecrawl.ts:47-57` 都只调 `WebSearchMcp.call`），即「不带 Session-Id 的裸 `tools/call`」是上游已验证的契约；
4. `mcp-client.js:194-196` 的 401/403/404 失效重试只在 `sessionId` 存在时触发——skip 后该分支不进入，不会引入新的重试路径；`parseEnvelope` 未变（SSE/JSON 双解析保留）；
5. **风险控制**：不删 `ensureSession`（tinyfish keyed 仍需），仅为三个调用点加参数；回滚 = 去掉该参数。

### D-2 · M-2：firecrawl limit 对齐 8

```diff
--- a/src-work/plugin/lib/backends/firecrawl.js
+++ b/src-work/plugin/lib/backends/firecrawl.js
@@ -39,9 +39,12 @@
   async search(request, signal, options, hooks = {}) {
     const args = {
       query: request.query,
-      limit: request.maxResults ?? 8,
+      // OpenCode v2.2.6 firecrawl.ts:52 hardcodes limit: 8 for the hosted
+      // keyless tier. Keep the wire contract identical; local result
+      // truncation (parseFirecrawlResult maxResults) stays our own policy.
+      limit: 8,
     };
```

### D-3 · M-3：keyed tinyfish 不走共享 sessionCache

```diff
--- a/src-work/plugin/lib/backends/tinyfish.js
+++ b/src-work/plugin/lib/backends/tinyfish.js
@@ -76,9 +76,13 @@
         args,
         extraHeaders,
         signal,
-        // Keyless is stateless: skip initialize. Keyed keeps the full
-        // 3-step handshake with Mcp-Session-Id (mcpCall default).
-        { skipInitialize: !keyed },
+        // v2.2.6 tinyfish.ts:65 initializes on EVERY keyed execute and uses
+        // the returned Mcp-Session-Id only for that call. Our shared
+        // sessionCache is URL-keyed with a 10min TTL (mcp-client.js:16,25),
+        // so a rotated TINYFISH_API_KEY would reuse a stale Session-Id.
+        // forceFreshSession makes ensureSession bypass the cache for keyed.
+        { skipInitialize: !keyed, forceFreshSession: keyed },
       );
```

```diff
--- a/src-work/plugin/lib/util/mcp-client.js
+++ b/src-work/plugin/lib/util/mcp-client.js
@@ -20,9 +20,10 @@
-async function ensureSession(url, signal) {
+async function ensureSession(url, signal, options = {}) {
   const now = Date.now();
   const cached = sessionCache.get(url);
-  
-  if (cached && (now - cached.initializedAt) < SESSION_TTL_MS) {
+
+  if (!options.forceFreshSession && cached && (now - cached.initializedAt) < SESSION_TTL_MS) {
     return cached.sessionId;
   }
@@ -159,8 +160,12 @@
 export async function mcpCall(url, toolName, args, extraHeaders = {}, signal, options = {}) {
   // dsh-websearch / lead-fix (2026-11-06): keep the 3-step handshake as the
   // default (zero regression for exa/parallel) but allow a direct tools/call
   // for keyless stateless servers. See 22-execution-drafts.md draft D.
-  const sessionId = options.skipInitialize ? undefined : await ensureSession(url, signal);
+  const sessionId = options.skipInitialize
+    ? undefined
+    : await ensureSession(url, signal, { forceFreshSession: options.forceFreshSession === true });
```

> 备选（更小改动、不动 `mcp-client.js`）：keyed 分支改为在调用前 `invalidateSession(endpoint)`（`mcp-client.js:140` 已导出）。但这是「每次都失效」而非「绕过缓存」，并发的另一次 keyed 调用仍可能竞态；**推荐上面的 `forceFreshSession` 显式参数**。
> **安全约束**：`forceFreshSession` 只传布尔值，绝不把 key/凭据写进 cache key、headers 记录或日志（`hooks.recordRequest` 的 `headers:{}` 已清空，`tinyfish.js:63-69` / `firecrawl.js:62-68` 现有实现已遵守）。

---

## 4. firecrawl `limit` 与 TinyFish Session-Id：逐条「对齐 / 保持差异+理由」

| 子项 | 官方 v2.2.6 | 我们 | 判定 | 理由 |
| --- | --- | --- | --- | --- |
| `firecrawl_search` wire `limit` | 硬编码 `8`（`firecrawl.ts:52`） | `request.maxResults ?? 8`（`firecrawl.js:43`） | **对齐 → 改 8** | keyless tier 按 IP 计费且上限未公开（`firecrawl.js:12-14` 注释）；多要结果放大配额风险。上游契约就是 8 |
| 本地 `maxResults` 截断 | 无（`Result[]` 全量返回） | `parseFirecrawlResult(result, maxResults)`（`firecrawl.js:94,120`） | **保持差异** | DSH `dsh-web` 的上下文/token 预算需要本地可控截断；`maxResults` 是宿主给的工具参数，不能因为对齐上游而丢掉 |
| TinyFish **keyless** | 不 initialize、不带 Session-Id（`tinyfish.ts:65` 条件 `credential?.type==="key"` 为假） | `skipInitialize: !keyed` → keyless 跳过（`tinyfish.js:81`） | **已一致 ✓** | 无需改动 |
| TinyFish **keyed** | 每次 `execute()` 重新 `initialize()`，Session-Id 仅本次用（`tinyfish.ts:65,89-124`） | `mcpCall` 默认 → `ensureSession` 10min URL 缓存（`mcp-client.js:16,25,99`） | **对齐 → forceFreshSession** | 换 key 复用旧 Session-Id 会 401/403；官方无缓存即无此问题 |
| TinyFish keyed 的 `X-API-Key` | `tinyfish.ts:62` | `tinyfish.js:55-57` | **已一致 ✓** | 两端一致 |
| TinyFish keyless 的 `X-TinyFish-Access-Mode: keyless` | `tinyfish.ts:62` | `tinyfish.js:57` | **已一致 ✓** | 两端一致 |
| Exa/Parallel/Firecrawl 的 initialize | 无 | 有（3 步） | **对齐 → skipInitialize** | 见 §3 D-1 |

---

## 5. 新 provider 是否并入（复核 35 号结论，C 级）

**结论**：`v2.2.6` **仍 5 个 provider、schema 未变**；Brave / Nimble 仍是 **open 的 PR/issue，未合并**；`searchbase` 在官方 tree / issue 搜索中**未取到（E）**。→ **不建议本轮并入任何新 provider**。

| 候选 | 官方状态（C/D，认证 API 实测 2026-11-07） | 结论 |
| --- | --- | --- |
| `index.ts:7-13` 5 provider | exa / firecrawl / parallel / tavily / tinyfish；`schema/src/websearch.ts` 与 v2.2.5 逐字相同【A/D】 | 基线不变 |
| **Brave** | `https://github.com/anomalyco/opencode/pull/58334`「feat(core): add brave web search」**state=open**，created 2026-10-23T04:02:14Z，`closed_at=None`【C/D `GET /issues/58334`】 | **不并入**；我们已有 `lib/backends/brave.js`（`BRAVE_API_KEY`），属自研超集，无需等官方 |
| **Nimble** | `https://github.com/anomalyco/opencode/issues/62220`「[FEATURE]: Add Nimble as a built-in web search provider」**state=open**，created 2026-11-06T00:43:17Z，`closed_at=None`【C/D `GET /issues/62220`】 | **不并入**（需求刚提出、无实现） |
| **Searchbase / 其它** | 认证代码搜索与 tree 中未命中可靠条目【E **未取到，待核实**】 | **不并入** |
| **`opencode`（Console hosted）** | `policies.mdx:253` 把 `opencode` 列为 `websearch.use` 的合法 resource ID；`console/websearch.mdx` 描述 workspace 级托管搜索（按次计费、零留存）【B】 | **不并入**：这是 OpenCode 自有 Console 商业后端，需要账号/计费，非公开可复用端点（E：无公开 API 契约） |

**补充（v2.2.6 真正值得关注的不是新 provider，而是新策略）**：`websearch.use` policy（#61557）与 `pool:true` 的 Shared MCP Connections（CHANGELOG:9,19）是本版亮点；对我们的启示是「按 backend 粒度可强制 deny」（见档 2 S-4），而非加第 14 个 backend。

---

## 6. 回归测试建议（不实际执行，给可落地用例）

> 现有测试样本：`src-work/plugin/tests/lead-20261106.test.js`、`lead-20261107-p0.test.js`、`lead-20261107.test.js`（A，本机目录清单）。建议新增 `tests/officialize-v226.test.js`。

| # | 用例 | 断言（行为级） | 覆盖 |
| --- | --- | --- | --- |
| T-1 | `exaBackend.search` mock `egressFetch` | 恰好 **1 次** POST；`JSON.parse(body).method === "tools/call"`；**无** `initialize` 调用；headers **无** `Mcp-Session-Id` | M-1 / D-1 |
| T-2 | `parallelBackend.search` 同上 | 同 T-1；且 `body.params.arguments.session_id` 仍为进程级 `SESSION_ID`（不因 skip 丢失） | M-1 / D-1 |
| T-3 | `firecrawlBackend.search` 同上 + `maxResults=20` | **1 次** POST；`arguments.limit === 8`；`parseFirecrawlResult` 最多返回 20 条（本地截断保留） | M-1 + M-2 / D-1 + D-2 |
| T-4 | `tinyfishBackend.search` **keyless** | 0 次 initialize、1 次 tools/call、带 `X-TinyFish-Access-Mode: keyless`、无 `Mcp-Session-Id` | 已一致，防回归 |
| T-5 | `tinyfishBackend.search` **keyed**，连续两次不同 key | `initialize` 各 1 次（共 2 次）；第二次 `tools/call` 的 `Mcp-Session-Id` ≠ 第一次；`hooks.recordRequest` 与任何 log 中**不含 key 值** | M-3 / D-3 |
| T-6 | `mcpCall` 直接单测 `forceFreshSession:true` | 即使 `sessionCache` 有未过期条目，仍重新 initialize 并覆盖缓存 | M-3 |
| T-7 | SSE / 纯 JSON 双解析回归 | `parseEnvelope` 对 `data: {...}` 与单行 JSON 都返回 `result`（沿用现有 `mcp-client.js:107-135`） | 防 D-1 破坏响应解析 |
| T-8 | `skipInitialize` 下 401/403 | 不进入 `mcp-client.js:194-196` 的 invalidate+retry 分支，直接抛 `WEB_PROVIDER_ERROR`（与官方「无 session 可失效」一致） | 防新重试路径 |
| T-9 | 真实端点 smoke（**只读、keyless、不写服务端状态**） | exa / parallel / firecrawl 各 1 次 `tools/call` → HTTP 200 且能解析出 ≥1 source；记录耗时与 31 号 ~16s 基线对比 | 端到端验证「不破坏成功路径」 |
| T-10 | 429 保留现状（**不引入官方单次冷却**） | `foldBreaker` 连续 3 次失败才 `cooledUntil>now`；全冷却时 fan-out 仍执行（fail-open） | 档 3 保持差异 |

> T-9 需经 `HTTP_PROXY=http://172.30.66.1:1091`；`00-lead-live-probe.md` 已记录 4 个 MCP 端点直连 200【D，非官方文档】。若某端点返回 403，按 `31-adversarial-search.md` 结论判定为插件链路问题而非上游。

---

## 7. 附：本地实现的两个「顺手发现」（不属本任务范围，仅记录，不改）

- **`parallel.js:60-85` 有重复的 `isError` 块**：第一个 `if (result?.isError === true)`（`:60-72`）已 throw，第二个同条件块（`:80-85`）是死代码，且中间夹了大段空行。属可读性/死代码问题，**建议另开清理项**，不在本轮 diff 内（避免与本任务的契约改动混在一起）。【A `src-work/plugin/lib/backends/parallel.js:60-85`】
- **`firecrawl.js` / `tinyfish.js` 的文件头注释仍引用 `v2.2.5` 永久链接**（`:7` 两处）。若采纳本报告结论，注释应同步更新为 `v2.2.6`（属注释维护，不属源码行为）。【A】

---

## 8. 权威链接清单（带 ref 永久链接 / 官方页）

### OpenCode v2.2.6 源码（A/C，全部 `blob/v2.2.6`）
1. https://github.com/anomalyco/opencode/tree/v2.2.6
2. https://github.com/anomalyco/opencode/commit/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06
3. https://github.com/anomalyco/opencode/blob/v2.2.6/CHANGELOG.md
4. https://github.com/anomalyco/opencode/blob/v2.2.6/packages/core/src/plugin/websearch/index.ts
5. https://github.com/anomalyco/opencode/blob/v2.2.6/packages/core/src/plugin/websearch/provider.ts
6. https://github.com/anomalyco/opencode/blob/v2.2.6/packages/core/src/plugin/websearch/mcp.ts
7. https://github.com/anomalyco/opencode/blob/v2.2.6/packages/core/src/plugin/websearch/exa.ts
8. https://github.com/anomalyco/opencode/blob/v2.2.6/packages/core/src/plugin/websearch/parallel.ts
9. https://github.com/anomalyco/opencode/blob/v2.2.6/packages/core/src/plugin/websearch/firecrawl.ts
10. https://github.com/anomalyco/opencode/blob/v2.2.6/packages/core/src/plugin/websearch/tavily.ts
11. https://github.com/anomalyco/opencode/blob/v2.2.6/packages/core/src/plugin/websearch/tinyfish.ts
12. https://github.com/anomalyco/opencode/blob/v2.2.6/packages/core/src/tool/plugin/websearch.ts
13. https://github.com/anomalyco/opencode/blob/v2.2.6/packages/core/src/websearch.ts
14. https://github.com/anomalyco/opencode/blob/v2.2.6/packages/core/src/config/plugin/websearch.ts
15. https://github.com/anomalyco/opencode/blob/v2.2.6/packages/core/src/config/plugin/policy.ts
16. https://github.com/anomalyco/opencode/blob/v2.2.6/packages/schema/src/websearch.ts
17. https://github.com/anomalyco/opencode/blob/v2.2.6/packages/schema/src/config/websearch.ts
18. https://github.com/anomalyco/opencode/blob/v2.2.6/packages/schema/src/config/policy.ts
19. https://github.com/anomalyco/opencode/blob/v2.2.6/services/site/src/docs/content/policies.mdx
20. https://github.com/anomalyco/opencode/blob/v2.2.6/specs/v2/provider-policy.md
21. https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/exa.ts （v2.2.5 内联注册对比样本）

### 版本/PR/issue（C）
22. https://api.github.com/repos/anomalyco/opencode/git/ref/tags/v2.2.6
23. https://api.github.com/repos/anomalyco/opencode/commits/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06
24. https://github.com/anomalyco/opencode/pull/61557 （`websearch.use` policy action）
25. https://github.com/anomalyco/opencode/pull/58334 （Brave，**open**）
26. https://github.com/anomalyco/opencode/issues/62220 （Nimble，**open**）
27. https://github.com/anomalyco/opencode/pull/61185 （Shared MCP Connections / `pool: true`）

### 本机 / 团队证据（A/D，本地相对路径）
28. `src-work/plugin/lib/util/mcp-client.js`
29. `src-work/plugin/lib/backends/{exa,parallel,firecrawl,tinyfish,tavily,brave}.js`
30. `src-work/plugin/lib/{index,provider,breaker,rrf,settings-api}.js`
31. `src-work/plugin/cordis.patch.yml`
32. `src-work/plugin/tests/lead-2026110{6,7}*.test.js`
33. `.artifacts/websearch-research/00-lead-live-probe.md` （4 端点直连 200，D 级）
34. `.artifacts/websearch-research/31-adversarial-search.md` （3 步串行 ~16s 拖尾，D 级）
35. `.artifacts/websearch-research/35-deep-dig.md` （35 号 v2.2.6 仍 5 provider 结论，本轮复核一致）
36. `.artifacts/websearch-research/04-opencode-agents.md` （v2.2.5 基线，背景）
37. `.artifacts/websearch-research/09-opencode-endpoints.md` / `09b-opencode-v2.md` / `09c-opencode-integration.md`

### 未取到 / 待核实（E）
- `services/www/src/docs/content/websearch.mdx` 在 `v2.2.6` **404**（docs 已迁至 `services/site/`）；本报告的 websearch 文档依据改用 `services/site/.../policies.mdx` 与 v2.2.5 的 `websearch.mdx`（后者仅作历史对照）【E：v2.2.6 版 websearch 指南正文未在本次认证取证中逐字核对】。
- `packages/opencode/src/tool/websearch/` 路径在 v2.2.6 不存在（见 §0 结论 1）【E：任务单路径疑为笔误，已按实际路径对齐】。
- `searchbase` provider 未在官方 tree / issue 搜索中命中可靠条目【E】。
- `websearch:false` 移除工具属 DSH 宿主层，插件侧无落点【E/跨组】。
- 官方 Console hosted `opencode` provider 的公开 API 契约未取到【E】。
- 本机 `node` 最小复现仅用于 `diff` 与 JSON 解析辅助，/tmp 脚本已删，未产出可引用数值【D/E：不引为结论】。
