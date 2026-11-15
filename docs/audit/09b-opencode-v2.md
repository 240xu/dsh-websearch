# 09b · OpenCode **v2** 官方仓库深挖

> 用户指令：「Open code 的话，参考一下 v2，v2 挺先进的。很多人会去看 v1，但是其实目前最新是 v2」「直接去看 github 官方仓库的 opencodev2」。
>
> **基线**：`anomalyco/opencode` **`v2.2.5`**（commit `9bbb8ce18c80f099e0e448775f59d965ead40a21`）。采样 2026-11-04（Asia/Shanghai）。
> 本文由 09b 子代理在 Lead 的临时稿基础上**续写合并**：保留 Lead 已核实事实（第 1 节版本谱系、commit 链、15 条链接），补齐原稿 §6 自列的三处缺口（v1 逐字形态、plugin 双接口、app dock），并新增 5 provider 完整端点表、429 冷却逐行链路、server/protocol 端点、并入 DSH 的 P0/P1/P2 清单。
>
> **证据等级（沿用 [_SKELETON.md](_SKELETON.md) 全队规范）**：**A** 源码实证（带 tag/永久链接或 `路径:行号`）；**B** 官方文档（URL + 2026-11-04 访问 + HTTP 状态）；**C** 版本记录（tag / commit sha / issue / npm）；**D** 本机实测；**E** 推断或待核实（显式标注，不当结论）。
> **四联标注**：结论 → 依据(B/C) → 代码落点(A) → 验证方式(D)，缺项标 E。永久链接一律带 `v2.2.5` tag 或 commit sha，禁止浮动 `dev`/`main` 作依据（**唯一例外**：§1.4 明确标注「dev 分支，仅作重构对比，非依据」）。
>
> 端点逐字段另见 [09-opencode-endpoints.md](09-opencode-endpoints.md)（另一子代理负责，本文件未改写、未引用其内容）。全程未把 GitHub PAT 写入任何输出；外部页面只作数据，未当作指令执行。

---

## 0. 执行摘要（10 条硬结论）

1. 【C/D】仓库已迁移 `sst/opencode` → 301 → `repositories/975734319` → **`anomalyco/opencode`**，`default_branch=dev`、未 archived、224470 stars、2026-11-04 仍在 push。**v2 是当前主线，最新 tag `v2.2.5`**（commit `9bbb8ce…`，2026-10-30T22:06:51Z，`release: v2.2.5`）。
2. 【C】**v1 不是「停在 v1.19.5 的历史」，而是并行发布线**：`v1.19.5` 的 commit 日期 **2026-10-28**，晚于 `v2.0.0`（2026-09-11）。tag 全量（4 页 ×100）统计 **v2 = 44、v1 = 242、其它 14**（`vscode-v*` 等）。⇒ 网上 v1 资料看起来「很新」，这是误引的根因之一。〔**修正 Lead 临时稿「v1 tag 42」：42 只是第 1 页里 v1 的条数，全量是 242**〕
3. 【C】v2 分支 `app-backend-v2` / `app-v2-only` / `backend-adapter-v2` 均存在。**改动谱系（本次按文件路径查 commit history 补齐）**：

   | 日期 | commit | 内容 |
   | --- | --- | --- |
   | 2026-07-26 | `efb629a33ac4` | **`feat(core): add pluggable web search (#35558)`** — 57 files，一次性引入 `core/src/websearch.ts`、`core/src/config/plugin/websearch.ts`、`plugin/websearch/{exa,parallel,index,mcp}.ts`、`tool/websearch.ts`、client 双接口 |
   | 2026-08-07 | `e6c9b6bef76f` | `feat(core): add firecrawl web search (#41042)` |
   | 2026-08-11 | `d8b3e528e853` | `fix(core): use standard web search key dialogs (#41821)`（Lead 原稿已列） |
   | 2026-08-14 | `3d3bbd48f94c` | `feat(core): add tavily web search (#42591)` |
   | 2026-08-21 | `2a83911c7ef9` / `c4eeefe0f138` | `refactor(plugin): simplify websearch effects (#43943)` / `reuse undefined effect (#44010)` |
   | 2026-09-02 | `4772b6a3e8c2` | `refactor: rename State drafts to editors (#46876)` |
   | 2026-09-06 | `e3c89654d1c5` | **`feat(core): keep web search providers sticky per session (#47334)`** — session 记忆 provider 的引入点 |
   | 2026-09-07 | `a5312e169b13` | `refactor(packages): migrate to the opencode npm scope (#47852)` |
   | 2026-09-12 | `3f579f53f494` | **`feat(core): add TinyFish web search (#48561)`**（TinyFish 最晚加入） |
   | 2026-10-09 | `1aae67e853ba` | `chore: upgrade Effect to rc.118 (#50231)`（Lead 原稿已列） |
   | 2026-10-15 | `86755e1ceafc` | **`fix(core): initialize MCP session for TinyFish web search (#54730)`** — 解释 `v2.0.28` 的 `tinyfish.ts` 只有 2767 B、`v2.2.5` 涨到 5395 B |

   ⇒ **5 个 provider 不是一次性齐备**：`exa+parallel`(#35558) → `firecrawl`(#41042) → `tavily`(#42591) → `tinyfish`(#48561) → TinyFish 带 key 握手修复(#54730)。
4. 【A】**Lead 问的「provider 注册/select/random/429 到底在哪个文件」答案：`packages/core/src/websearch.ts`（9553 B，不在 `plugin/websearch/` 目录）**。`plugin/websearch/index.ts`（418 B）只导出 5 个 `.Plugin` 数组；注册表 `State.create`、`KV` key `websearch:provider`、`randomProvider()`、`cooldownMillis()`、session affinity 全在 `core/src/websearch.ts:31-233`。
5. 【A】**v2.2.5 的 `plugin/websearch/` 恰好 7 个文件、无 `provider.ts`**（exa 2873 / firecrawl 2976 / index 418 / mcp 2569 / parallel 3635 / tavily 3078 / tinyfish 5395，与 Lead 事实逐字一致）。`dev` 分支新增 `provider.ts`（1540 B），内容是把 5 个 provider 里重复的 `ctx.integration.transform` + `ctx.websearch.transform` 抽成 `WebSearchProvider.register(ctx, {id,name,env,execute})` 助手 ⇒ **dev 各文件小 15–20% 是「已做去重重构」，不是 v2.2.5「实现更完整」；功能等价、组织不同**【A + E：未查 PR 描述确认重构动机】。
6. 【A】v1（`v1.19.5`）是**完全不同的架构**：`packages/opencode/src/tool/websearch.ts` + `mcp-websearch.ts`，硬编码 **2 个** provider（`Schema.Literals(["exa","parallel"])`）、`parseInt(checksum(sessionID),36)%2` 哈希二选一、5 个工具参数、无 429 冷却 / 无注册抽象 / 无 server/protocol 分层 / 无 `websearch:false`（`config/v2-compat.ts:117-118` 甚至把 `websearch` 列为 unsupported key）。原稿 §6「v1 具体形态未逐字拉取」的缺口**已补齐**，见 §2。
7. 【B】**官方在线文档双轨是误引 v1 的最大根因**：`https://opencode.ai/docs/tools/`（不带 `/v2`，200）仍是 v1 内容「websearch … using **Exa or Parallel** … **No API key is required**」+ `permission:{"websearch":"allow"}`；`https://opencode.ai/v2/docs/websearch`（200）才是 5 provider + random + 429 + Retry-After + `websearch:false`。`/docs/websearch/` 与 `/docs/web-search/` 均 **404**；`/docs/web/` 是 `opencode web` 子命令页，与搜索无关。⇒ **引用必须显式带 `/v2` 或 `v2.2.5` tag**。
8. 【A】5 个端点逐字复核：4 个 MCP `tools/call`（Exa `https://mcp.exa.ai/mcp`、Firecrawl `https://mcp.firecrawl.dev/v2/mcp`、Parallel `https://search.parallel.ai/mcp`、TinyFish `https://agent.tinyfish.ai/mcp`）+ 1 个 REST（Tavily `https://api.tavily.com/search`）。**补出 Lead 清单未列的两点**：Tavily 也有 keyless 头 `X-Tavily-Access-Mode: keyless`（`tavily.ts:57`）；TinyFish 带 key 时必须先 `initialize` 取 `Mcp-Session-Id` 再 `notifications/initialized`（`tinyfish.ts:78-79,104-146`）。见 §3。
9. 【A/B】v2 有**第 6 个运行时 provider**：Console 托管 `OpenCode Web Search`（`plugin/provider/opencode.ts:236-283,329-333`），workspace 级启用、`$0.01`/成功搜索、失败与限流不计费、最多 8 条、零留存、all-spend budget 联动〔`console/websearch.mdx`〕。所谓「内置 5 个」指**客户端内置**。
10. 【A/D】并入 DSH 的结论：**firecrawl / tinyfish 值得作为 P0 新 backend**（官方内置 + keyless + Lead 实测 HTTP 200，正好补当前 4 后端全挂）；**tavily 与 DSH 已有 REST tavily 后端重复，不新增**（只白拿 keyless 降级头）；**最值得移植的是治理层**（429 Retry-After 冷却、`random`+session 记忆、`permission action=websearch resource=query`、`websearch:false` 删工具、通用 `mcp.ts`），而 **DSH 的 RRF / url+title 去重 / 熔断 / 缓存 / 遥测 / 11 后端 / 不可信内容标注明显更强，不得回退**。见 §6。

---

## 1. 版本谱系（C 级，全部可回溯；含本次修订）

| 项 | 值 | 依据 |
| --- | --- | --- |
| 仓库迁移 | `sst/opencode` → **`anomalyco/opencode`** | 【C/D】`GET /repos/sst/opencode` → 301 → `repositories/975734319`；迁移后 `full_name=anomalyco/opencode`、`id=975734319`、`description="The open source coding agent."` |
| 默认分支 / archived | `dev` / `false` | 【A/C】仓库 API |
| **v2 最新 tag** | **`v2.2.5`** | 【C】`GET /git/ref/tags/v2.2.5` → `object.sha=9bbb8ce18c80f099e0e448775f59d965ead40a21`, `type=commit` |
| v2.2.5 提交 | `release: v2.2.5`，2026-10-30T22:06:51Z | 【C】`GET /commits/9bbb8ce…`（Lead 原稿另记 37 files，含各包 package.json + CHANGELOG + bun.lock） |
| **tag 全量统计** | **v2 = 44 / v1 = 242 / 其它 14**（共 300，4 页 ×100） | 【C】本次 `GET /tags?per_page=100&page=1..4`；第 1 页 `vscode-v1.0.0 … v1.18.0`、第 2 页 `v1.17.20 … v1.3.2`、第 3 页 `v1.3.1 … v1.0.218`、第 4 页 `v1.0.217 … v1.0.114` |
| v1/v2 边界 | 第 1 页下标 57 = `v2.0.0`、下标 58 = `v1.19.5` | 【C】同上 |
| **v1 与 v2 时间交叉** | `v2.0.0` 2026-09-11T23:46:37Z（`fix(release): use V2 Docker artifact paths (#48571)`）；`v2.0.28` 2026-10-13；**`v1.19.5` 2026-10-28T06:17:33Z（`release: v1.19.5`）**；`v2.2.5` 2026-10-30 | 【C】`GET /commits/{sha}` 逐个核对 author + committer date 一致 |
| v2 相关分支 | `app-backend-v2`、`app-v2-only`、`backend-adapter-v2` | 【C】`GET /branches?per_page=100` |
| websearch 源码提交史 | 见执行摘要第 3 条（11 个 commit，按 5 个 provider 文件路径分别查 `GET /commits?path=…&sha=v2.2.5`） | 【C】本次新增 |
| 当前活跃度 | 224470 stars，2026-11-04T08:45:24Z 仍在 push | 【C/D】`GET /repos/anomalyco/opencode` |

**结论（C）**：v2 是当前主线（44 个 v2 tag、最新 v2.2.5），v1 **仍在并行发版**（最新 v1.19.5，日期晚于 v2.0.0），且仓库已迁址。用户所说「很多人看 v1，但最新是 v2」与仓库事实一致；凡引用 `sst/opencode`、`v1.x` tag 或 `opencode.ai/docs/...`（不带 `/v2`）的资料，一律标为「v1 旧形态，仅作对比，不作依据」。〔**修订**：Lead 临时稿写「v1 停在 v1.19.5」易被读成「v1 已停止维护」，实际是「v1 线最新为 v1.19.5 且仍晚于 v2.0.0 发版」；另「v1 tag 42」应为全量 242。〕

### 1.4 `dev` 分支 vs `v2.2.5` tag（仅作重构对比，**非依据**）

| 文件 | `v2.2.5` | `dev` | 说明 |
| --- | --- | --- | --- |
| `exa.ts` | 2873 | 2352 | dev 用 `WebSearchProvider.register()` 助手 |
| `firecrawl.ts` | 2976 | 2405 | 同上 |
| `index.ts` | 418 | 418 | 完全一致（5 个 Plugin 数组） |
| `mcp.ts` | 2569 | 2569 | 完全一致 |
| `parallel.ts` | 3635 | 3061 | 同上 |
| **`provider.ts`** | **不存在** | **1540（新增）** | `register(ctx, {id,name,env,execute})` 统一做 integration 注册 + `editor.add` |
| `tavily.ts` | 3078 | 2500 | 同上 |
| `tinyfish.ts` | 5395 | 4791 | 同上 |
| `core/src/websearch.ts` | 9553 | 9553 | 完全一致（选择/冷却逻辑未动） |

`dev/provider.ts` 全文（44 行）已逐字读取：`register` 只做两件 `transform`——`ctx.integration.transform(editor.update(id,name) + method key + method env)` 与 `ctx.websearch.transform(editor.add({id,name,execute: input => resolve credential → provider.execute(input, credential)}))`。【A】⇒ **v2.2.5 比 dev 大 15–20% 是「尚未做去重重构」，不是「实现更完整」**〔E：重构动机未查 PR 描述〕。`v2.0.28` 的 `tinyfish.ts` 仅 2767 B ⇒ TinyFish 的 initialize 会话逻辑在 `v2.0.28 → v2.2.5` 之间由 #54730 加入【A/C】。

---

## 2. 【用户最关心】v1 vs v2 差异专节

> **证据规则**：v1 列全部取自 `anomalyco/opencode` 的 **`v1.19.5` tag**（现行 v1 线最新 tag），逐字下载 `packages/opencode/src/tool/{websearch.ts,websearch.txt,mcp-websearch.ts,webfetch.ts,webfetch.txt}`、`packages/core/src/tool/websearch.ts`、`packages/opencode/src/config/{config.ts,v2-compat.ts}` 后核对；**标注「v1 旧资料，仅作对比，不作依据」**。v2 列全部取自 `v2.2.5` tag。原稿 §6 的「v1 具体形态未逐字拉取」缺口至此关闭。

### 2.1 逐条对比（16 维）

| # | 维度 | **v1（`v1.19.5`，旧资料，仅作对比）** | **v2（`v2.2.5`，当前依据）** | 依据 / 代码落点 |
| --- | --- | --- | --- | --- |
| 1 | 仓库 / 主线 | `sst/opencode` 旧名（301）；线上 `/docs/tools` 仍服务 v1 | `anomalyco/opencode`，`dev`，v2.2.5；v2 文档在 `/v2/docs/...` | 【C/D】301；【B】两页 200 |
| 2 | 源码布局 | `packages/opencode/src/tool/websearch.ts` + `mcp-websearch.ts` + `websearch.txt`（提示词）+ 独立 `webfetch.ts/txt`；另有 `packages/core/src/tool/websearch.ts`（第二份过渡实现） | `core/src/{websearch,tool/plugin/websearch,config/plugin/websearch}.ts` + `core/src/plugin/websearch/{5 provider,mcp,index}.ts` + `schema/` + `server/` + `protocol/` + `plugin/{effect,promise}/` + `client/` + `app/` + `services/www/` | 【A】两 tag 的 `git/trees/{sha}?recursive=1`：`v1.19.5` 7395 entries、`v2.2.5` 10258 entries |
| 3 | provider 数量 | **2**：`WebSearchProviderSchema = Schema.Literals(["exa","parallel"])`（`websearch.ts:27`） | **5**：exa / firecrawl / parallel / tavily / tinyfish；外加 Console 托管 `opencode` 第 6 个 | 【A】`v1/.../websearch.ts:27`；`v2/.../index.ts:7-13`；`plugin/provider/opencode.ts:329-333` |
| 4 | provider 抽象 | **无**：`callProvider()` 里 `if (provider==="parallel") … else …` 二分支，端点常量写死 `mcp-websearch.ts:4-7` | `WebSearchPlugins=[5 个 .Plugin]`；每个 `define({id,effect})` → `ctx.websearch.transform(editor.add({id,name,execute}))`；`ProviderImplementation.execute: (ProviderInput) => Effect<readonly Result[]>` | 【A】`v1/mcp-websearch.ts:4-7,60-97`；`v2/index.ts:7-13`、`core/src/websearch.ts:35-37` |
| 5 | 选择算法 | `OPENCODE_WEBSEARCH_PROVIDER` 覆盖 → `flags.enableParallel/enableExa` → **`parseInt(checksum(sessionID),36) % 2` 哈希二选一**；无持久化、无用户选择（`websearch.ts:30-37`） | `Selection = ID \| "random" \| false`；KV `websearch:provider` 持久化；首次 `forms.ask` 三选；`randomProvider()` 先复用 affinity 再随机；session 记忆、Deleted/Moved 清除 | 【A】`v1/websearch.ts:30-37`；`v2/core/src/websearch.ts:31-32,94-103,129-156,181-183` |
| 6 | 429 / 限流 | **无**：`filterStatusOk` 后非 2xx 直接失败，无重试、无冷却（`mcp-websearch.ts:89-93`） | `query()` while 循环：仅 `random` + `HttpClientError` + `status===429` 才冷却换 provider；`cooldownMillis` 支持秒数 / HTTP-date / 无效回退 60s；`cooldowns` Map **workspace 共享**；全冷却立即失败 | 【A】`v1/mcp-websearch.ts:89-95`；`v2/core/src/websearch.ts:196-228`；测试 `core/test/websearch.test.ts:183-300` |
| 7 | 工具入参 | `query` + `numResults` + `livecrawl("fallback"\|"preferred")` + `type("auto"\|"fast"\|"deep")` + `contextMaxCharacters`（`websearch.ts:10-25`） | **只有 `query`**：`Schema.Struct({query: Schema.String.annotate({description:"Websearch query"})})`；各 provider 内部固定 `numResults:8` / `limit:8` / `max_results:8` / `chunks_per_source:3` | 【A】`v1/websearch.ts:10-25`；`v2/tool/plugin/websearch.ts:24-26` + 5 个 provider |
| 8 | 结果 schema | 无统一结构，MCP `content[].text` 原样 `output` 回灌（`websearch.ts:135-139`） | `Result={url,title?,content?,time:{published?}}`、`Response={providerID,results[]}`；`Schema.decodeUnknownEffect(Schema.Array(Result))` 服务边界强校验 | 【A】`v1/websearch.ts:133-140`；`v2/schema/src/websearch.ts:24-38`；`core/src/websearch.ts:92,204` |
| 9 | 认证 / keyless | `EXA_API_KEY` 拼 URL query `?exaApiKey=`；`PARALLEL_API_KEY` 走 `Authorization: Bearer`；文档「No API key is required」（`mcp-websearch.ts:4-7,54-58`；`/docs/tools`） | integration 统一 `method:{type:"key"}` + `{type:"env",names:[…]}`；`/connect` 或 env；**keyless 头降级**：`X-Tavily-Access-Mode: keyless`、`X-TinyFish-Access-Mode: keyless`；TinyFish 有 key 时 `X-API-Key` + 强制 `initialize` 取 `Mcp-Session-Id` | 【A】`v1/mcp-websearch.ts:4-7,54-58`；`v2/tavily.ts:54-57`、`tinyfish.ts:72-87,104-146`；【B】`/v2/docs/websearch` |
| 10 | permission | `ctx.ask({permission:"websearch", patterns:[query], always:["*"]})`（v1 老 API，`websearch.ts:119-131`）；配置 `permission:{websearch:"allow"}` | `permission.assert({action:"websearch", resources:[query], save:["*"], sessionID, agent, source})`；文档 `permissions:[{action:"websearch",resource:"*",effect:"ask"}]`；resource 明确 = **Search query** | 【A】`v1/websearch.ts:119-131`；`v2/tool/plugin/websearch.ts:49-57`；【B】`v2.2.5/permissions.mdx:120`、`/v2/docs/websearch` §Permissions |
| 11 | 禁用 | **无** `websearch:false`；`config/v2-compat.ts:117-118` 把 `websearch` 列入 `unsupported([key])` | `websearch:false` → `DisabledError`；工具层在 `context`/`compaction`/`generate` 三 hook `delete event.tools[name]`，**从模型请求移除** | 【A】`v1/config/v2-compat.ts:115-119`；`v2/tool/plugin/websearch.ts:184-194`；`config/plugin/websearch.ts:13-17` |
| 12 | MCP 客户端 | `mcp-websearch.ts`：只取 `result.content[].text` 字符串；`response.text` **无字节上限**；timeout 由调用方传 `"25 seconds"`；`Effect.timeoutOrElse(… Effect.die)` | `mcp.ts`：泛型 `<F,R>`、`tools/call` + `params:{name,arguments}`、`MAX_RESPONSE_BYTES=256*1024`、`collectBoundedResponseBody`、`parseResponse` **直接 JSON + SSE `data: ` 双解析**、`Duration.seconds(25)`、`Effect.scoped` | 【A】`v1/mcp-websearch.ts:9-41,69-96`；`v2/mcp.ts:7-68` |
| 13 | server / protocol 层 | **无** websearch group；v1 走 `packages/opencode/src/server/routes/instance/httpapi/...` | `GET /api/websearch/provider`、`POST /api/websearch`（LocationQuery）；2 个 handler；`plugin/effect` + `plugin/promise` 双接口；client 生成 `WebsearchApi` | 【A】`v2/protocol/src/groups/websearch.ts:8-46`、`server/src/handlers/websearch.ts:8-51`、`plugin/src/{effect,promise}/websearch.ts`；见 §5 |
| 14 | 结果呈现 / citation | `output` 原样文本，无结构化 citation（`websearch.ts:135-139`） | 工具层拼 `## [title](url)\nPublished: ISO\n\ncontent`，**markdown 链接即 citation**；`output={provider,results}`、`metadata.provider`、`context.progress({provider})` | 【A】`v2/tool/plugin/websearch.ts:149-164` |
| 15 | Console 托管层 | **无** | workspace owner 启用 Hosted Web Search、成员 `/connect` 免自带 key；**$0.01/次成功搜索**、失败/限流不计费、最多 8 条、零留存、all-spend budget 联动 | 【B】`v2.2.5/services/www/src/docs/content/console/websearch.mdx`；【A】`plugin/provider/opencode.ts:236-283` |
| 16 | 测试 | `tool-websearch.test.ts` / `tool/websearch.test.ts` | `core/test/websearch.test.ts`（26851 B）：`fails over on rate limits with random and keeps the replacement after cooldown`、`respects Retry-After …`、`fails promptly when all providers are cooling down`、`shares cooldowns without sending a peer back to the rate-limited provider`；另有 `tool-websearch.test.ts`、`config/websearch.test.ts`、app 侧 3 个测试 | 【A】两 tag tree + `v2/core/test/websearch.test.ts:183-300` |

### 2.2 为什么 v2「更先进」（架构事实，非营销话术）

1. **能力缝完整**：v2 把 websearch 做成一条完整 capability seam —— `schema`（契约）→ `core/src/websearch.ts`（Service + State + KV + 冷却）→ `plugin/{effect,promise}`（第三方扩展点）→ `plugin/websearch/*`（5 个内置实现）→ `tool/plugin`（模型可见工具 + permission + chooser）→ `server/handlers` + `protocol/groups`（HTTP/RPC）→ `client`（SDK）→ `app`（TUI/Web dock）→ `services/www`（文档）。v1 是「一个工具文件 + 一个 MCP 文件」【A】。
2. **可插拔**：`WebSearchPlugins` 数组 + `define()` + `editor.add()`；Console 的 `OpenCode Web Search` 就是用同一接口注册的第 6 个 provider【A `plugin/provider/opencode.ts:329-333`】。
3. **韧性**：`random` + session affinity + 429 `Retry-After` 冷却 + workspace 共享冷却 + 全冷却快速失败 + 并发查询不把彼此送回限流 provider【A + 测试】。
4. **安全 / 合规**：permission `action=websearch, resource=query, effect=ask`；`websearch:false` **从模型请求删工具**（不是运行时拒绝）；`Schema.decodeUnknownEffect` 边界校验；Console 托管请求 `redirect:"error"`；MCP 响应 256 KiB 上限 + 25s 超时【A】。
5. **产品化**：workspace 级托管搜索 + 按次计费 + 零留存 + 预算策略 + `/connect` 免 key 与自带 key 并存【B】。这是 v1 完全没有的一层。

> **「先进」的本质（保留 Lead 原稿措辞并补证据）**：v2 把「搜索」从一个工具升级成一个**带注册表、状态、限流冷却、权限、同意流程、计费与协议层的子系统**；而 DSH 的 `web_search` 先进性体现在另一维度（11 后端扇出 + RRF 融合 + 熔断缓存 + 遥测）。两者可互补，见 §6。

### 2.3 ⚠️ 引用陷阱（写进结论）

- 【B】`https://opencode.ai/docs/tools/`（**不带 `/v2`**）200，但内容是 **v1**：「websearch … using **Exa or Parallel** … **No API key is required** … `permission:{"websearch":"allow"}`」→ **v1 旧资料，仅作对比**。
- 【B】`https://opencode.ai/v2/docs/websearch` 200 → 5 provider / `random` / 429 `Retry-After` / permission ask / `websearch:false`，与 `v2.2.5` tag 内 `websearch.mdx` 逐条一致。
- 【D】`https://opencode.ai/docs/websearch/`、`/docs/web-search/` 均 **404**；`/docs/web/` 是 `opencode web` 子命令页，与搜索无关。
- 【A】`v1.19.5` 的 `packages/core/src/tool/websearch.ts:26-31` 注释自述「Provider-independent local web search retained **in V2 core** for launch parity」——v1 tag 里已含一份「给 V2 用的过渡实现」，按路径搜资料时更易把 v1 与 v2 混为一谈。
- ⇒ **所有引用必须显式带 `/v2` 或 `v2.2.5` tag**；这也是用户「很多人会去看 v1」的可验证解释。

---

## 3. v2 的 5 个 provider 完整端点表（以 `ref=v2.2.5` 源码为准）

> 与 [09-opencode-endpoints.md](09-opencode-endpoints.md) 分工：本节给「Schema 原文 + 结果映射 + keyless/错误」，端点逐字段以该文件为准。以下 **A 级**：19 个 `.ts`/`.mdx` 文件均从 `raw.githubusercontent.com/anomalyco/opencode/v2.2.5/...` 下载并逐行读取，行号为该 tag 文件行号。

### 3.1 总表

| provider | `id`/`name` | URL（源码逐字） | 协议 | 认证（源码逐字） | tool 名 | 请求 schema（Effect `Schema.Struct` 原文） | 响应 schema（原文） | 结果映射 | keyless 路径 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Exa** | `exa` / `Exa` | `https://mcp.exa.ai/mcp` (`exa.ts:8`) | MCP streamable-http `tools/call` | `EXA_API_KEY`；有 key 时 **`url.searchParams.set("exaApiKey", credential.key)`**（`:49`）；无 key 裸连 | `web_search_exa` (`:53`) | `McpInput = Schema.Struct({ query: Schema.String, numResults: Schema.Number.pipe(Schema.optional) })` (`:10-13`)；实参 `{query, numResults: 8}` (`:55`) | `McpOutput = Schema.Struct({ content: Schema.Array(Schema.Struct({ type: Schema.Literal("text"), text: Schema.String, _meta: Schema.Struct({searchTime: Schema.Number}).pipe(Schema.optional) })) })` (`:15-23`) | `parseResults(text)` 按 `\n\n---\n\n` 切块，正则取 `^URL:` / `^Title:` / `^Published:` / `^(?:Highlights\|Text):`；`Published` 非 `N/A` 时 `Date.parse` → `time.published`（`:65-82`） | 无 key 不加 query 参数即可；【D】Lead 实测 `initialize` HTTP 200（SSE `event: message`） |
| **Firecrawl** | `firecrawl` / `Firecrawl` | `https://mcp.firecrawl.dev/v2/mcp` (`firecrawl.ts:9`) | MCP `tools/call` | `FIRECRAWL_API_KEY`；`Authorization: Bearer ${credential.key}`（`:67`）+ `User-Agent: App.useragent(ctx.app)`（`:66`） | `firecrawl_search` (`:62`) | `McpInput = Schema.Struct({ query: Schema.String, limit: Schema.Number.pipe(Schema.optional) })` (`:11-14`)；实参 `{query, limit: 8}` (`:64`) | `McpOutput={content:[{type:"text",text}]}`；内层 `SearchResponse = Schema.fromJsonString(Schema.Struct({ success: Schema.Boolean, data: Schema.Struct({ web: Schema.Array(Schema.Struct({ url: Schema.String, title: Schema.NullOr(Schema.String).pipe(Schema.optional), description: Schema.NullOr(Schema.String).pipe(Schema.optional) })) }) }))`（`:16-33`），`decodeUnknownOption` 容错 | `data.web.map` → `{url, title?, content: description, time:{}}`（`:73-78`） | 不设 `Authorization` 即 keyless；【D】Lead 实测 HTTP 200，hosted keyless sessions 暴露 `firecrawl_search` / `firecrawl_scrape` / `firecrawl_parse`（有用量限制） |
| **Parallel** | `parallel` / `Parallel` | `https://search.parallel.ai/mcp` (`parallel.ts:9`) | MCP `tools/call` | `PARALLEL_API_KEY`；`Authorization: Bearer`（`:85`）+ `User-Agent` | `web_search` (`:77`) | `McpInput = Schema.Struct({ objective: Schema.String, search_queries: Schema.Array(Schema.String), model_name: Schema.String.check(Schema.isMaxLength(100)).pipe(Schema.optional) })` (`:11-15`)；实参 `{objective: input.query, search_queries: [input.query]}`（`:80-82`，**未传 model_name / session_id**） | `McpOutput = Schema.Struct({ content: Schema.Array(...text...), structuredContent: SearchResponse })`；`SearchResponse = {search_id, results:[{url, title?, publish_date?, excerpts: string[]}], warnings?, usage?, session_id}`（`:17-49`）——**走 `structuredContent` 而非 content 文本** | `structuredContent.results.map` → `{url, title?, content: excerpts.join("\n\n"), time:{published?}}`（`:89-97`） | 不设 `Authorization` 即可；【D】Lead 实测 HTTP 200（纯 JSON）+ 真实 `tools/call web_search` 返回结果 |
| **Tavily** | `tavily` / `Tavily` | `https://api.tavily.com/search` (`tavily.ts:8`) | **REST POST**（唯一非 MCP） | `TAVILY_API_KEY`；有 key `Authorization: Bearer`（`:56`）；**无 key `X-Tavily-Access-Mode: keyless`（`:57`，Lead 清单未列，本次补出）**；固定 `X-Client-Name: "opencode2"`（`:54`）+ `User-Agent` | — | `SearchRequest = Schema.Struct({ query: Schema.String, search_depth: Schema.Literal("basic"), chunks_per_source: Schema.Number, max_results: Schema.Number })` (`:10-15`)；实参 `{query, search_depth:"basic", chunks_per_source:3, max_results:8}`（`:60-64`） | `SearchResponse = Schema.Struct({ results: Schema.Array(Schema.Struct({ title: Schema.String, url: Schema.String, content: Schema.String })) })`（`:17-25`），`HttpClientResponse.schemaBodyJson` | `results.map` → `{url, title, content?, time:{}}`（`:76-81`） | `X-Tavily-Access-Mode: keyless`（**A 级新增事实**）；【D】需 key，Lead 未测 |
| **TinyFish** | `tinyfish` / `TinyFish` | `https://agent.tinyfish.ai/mcp` (`tinyfish.ts:10`) | MCP `tools/call`（有 key 时 + 完整 initialize 握手） | `TINYFISH_API_KEY`（**可选**）；有 key → `X-API-Key`（`:75`）；无 key → `X-TinyFish-Access-Mode: keyless`（`:76`）；有 key 时 `initialize()` 取 `Mcp-Session-Id` 并回传（`:78-79,86`） | `search` (`:83`) | `McpInput = Schema.Struct({ query: Schema.String })` (`:12-14`)；实参 `{query}` (`:85`) | `McpOutput={content:[{type:"text",text}]}`；内层 `SearchResponse = Schema.fromJsonString(Schema.Struct({ results: Schema.Array(Schema.Struct({ url: Schema.String, title: Schema.String, snippet: Schema.String })) }))`（`:20-31`） | `results.map` → `{url, title, content: snippet, time:{}}`（`:91-96`） | `X-TinyFish-Access-Mode: keyless` 且**跳过 initialize**（源码注释 `:78`：「Keyed requests are rejected without the `Mcp-Session-Id` returned by `initialize`; keyless ones are not.」）；【D】Lead 实测 HTTP 200 |

### 3.2 通用 MCP 客户端 `mcp.ts`（2569 B，逐字）【A】

- `MAX_RESPONSE_BYTES = 256 * 1024`（`:7`）。
- `call<F,R>(http, url, tool, schema:{input,output}, value, headers={})`（`:28-35`）：`HttpClientRequest.post(url)` + `Accept:"application/json, text/event-stream"`（`:38`）+ `setHeaders(headers)`（`:39`）；body 由 `schemaBodyJson(Schema.Struct({jsonrpc:Literal("2.0"), id:Literal(1), method:Literal("tools/call"), params:Schema.Struct({name:Schema.String, arguments:schema.input})}))` 生成 `{jsonrpc:"2.0",id:1,method:"tools/call",params:{name:tool,arguments:value}}`（`:40-52`）。**直接 `tools/call`，不先 `initialize`**（只有 TinyFish 带 key 例外）。
- `HttpClient.withScope(HttpClient.filterStatusOk(http)).execute(request)` → `collectBoundedResponseBody(response, MAX_RESPONSE_BYTES, () => new Error(`${tool} response exceeded ${MAX_RESPONSE_BYTES} bytes`))`（`:55-60`）→ `parseResponse(body.toString("utf8"), schema.output)`（`:61`）→ `Effect.scoped` + `Effect.timeoutOrElse({duration:Duration.seconds(25), orElse:()=>Effect.fail(new Error(`${tool} request timed out`))})`（`:62-68`）。
- `parseResponse(body, result)`（`:9-26`）：`decode = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({result})))`；先试整段 trim 后以 `{` 开头的直接 JSON，否则逐行找 `data: ` 的 SSE 行，取**第一个**解析成功的 `result`。这是同时兼容「Parallel/TinyFish 纯 JSON」与「Exa/Firecrawl SSE」的关键【A + D：Lead 实测 Exa/Firecrawl 返回 SSE，Parallel/TinyFish 返回纯 JSON】。

### 3.3 TinyFish 带 key 的 initialize 握手（`tinyfish.ts:33-47,104-146`）【A】

```
InitializeRequest = {jsonrpc:"2.0", id:1, method:"initialize",
  params:{protocolVersion:"2025-06-18", capabilities:{}, clientInfo:{name:"opencode", version:"1.0"}}}
→ POST endpoint, Accept "application/json, text/event-stream", headers(含 X-API-Key)
→ collectBoundedResponseBody(..., WebSearchMcp.MAX_RESPONSE_BYTES, ...)
→ 取 response.headers["mcp-session-id"]，缺失直接 fail
→ POST notifications/initialized（带 Mcp-Session-Id）
→ 25s timeout（"TinyFish initialize request timed out"）
```
〔对比〕Lead 实测 TinyFish serverInfo `protocolVersion 2025-11-25`，源码客户端声明 `2025-06-18`【A/D】。`tools/list` 的 `search` 还有 `purpose`（「Used to better rank results against your intent」）/ `location` / `language` / `include_domains` / `exclude_domains` / `domain_type` / `after_date` / `before_date` / `recency_minutes` / `page`，但 **v2.2.5 只发 `{query}`**，未利用 `purpose` 排序信号【A/D】。

### 3.4 错误 / 429 处理【A】

- **provider 层**：`filterStatusOk` 把非 2xx 变 `HttpClientError`（含 `response.status` / `response.headers`）；`mcp.ts` 与 Tavily/TinyFish 均 25s 超时（`mcp.ts:66` `${tool} request timed out`、`tavily.ts:73` `Tavily web search request timed out`、`tinyfish.ts:144` `TinyFish initialize request timed out`）。
- **服务层**（`core/src/websearch.ts:196-216`）：`provider.execute({query}).pipe(Effect.flatMap(decodeResults), Effect.result)` → 成功 `new Response({providerID, results})`；失败包成 `RequestError({providerID, cause})`；**仅当** `choice === "random"` **且** `HttpClientError.isHttpClientError(cause)` **且** `cause.response?.status === 429` 才冷却 + 换 provider（`:208`）。**其他错误（401/403/5xx/超时/解码失败）直接失败，不重试** —— 与 [2026-11-04-rehearsal.md](/home/dsh/.dsh/automation/reports/2026-11-04-rehearsal.md) 的 `OC-C:208` 结论一致。
- `cooldownMillis(value, now)`（`:222-228`）：空 → 60000；`Number(value)` 有限且 ≥0 → `seconds*1000`（**纯数字按「秒」解释**）；否则 `Date.parse(value)` → `max(0, date-now)`；都失败 → 60000。
- **工具层文案映射**（`tool/plugin/websearch.ts:15-18`）：`429 → "Web search rate limited (HTTP 429)"`、`401 → "Web search authentication failed (HTTP 401)"`，其余 `Web search request failed (HTTP ${status})`（`:166-179`）。

### 3.5 第 6 个 provider：Console 托管【A/B】

`packages/core/src/plugin/provider/opencode.ts:236-283,329-333`：当 Console 远端 `remote.websearch.provider === "opencode"` 且有 connection 时，`editor.add({id:"opencode", name:"OpenCode Web Search", execute})`。`execute` POST `${ConsoleAccess.server(credential)}/api/websearch`，`bearerToken(token)`、`x-org-id`、body `{query, providerID:"opencode"}`、`redirect:"error"`（`:269`）、25s 超时、校验 `response.providerID === providerID`（`:277-280`）。文档 `console/websearch.mdx`：$0.01/次成功搜索、失败与限流不计费、最多 8 条、零数据留存、Activity/发票/CSV 单列、all-spend budget 约束。⇒ 「内置 5 个」指**客户端内置**，运行时可注册 6 个。

---

## 4. v2 的 LLM ↔ 搜索调用链（关键源码文件 + 行号 / URL）

```
[模型] 看到 tool: name="websearch", description(含 current year), input=Schema.Struct({query})
  ▼  packages/core/src/tool/plugin/websearch.ts
  :12   name = "websearch"
  :13   NO_RESULTS = "No search results found. Please try a different query."
  :20-22 description = `Search the web using the user's selected search integration. Use this for current
         information beyond knowledge cutoff.\n\nThe current year is ${new Date().getFullYear()}. ...`
  :24-26 Input = Schema.Struct({ query: Schema.String.annotate({description:"Websearch query"}) })
  :28-31 Output = Schema.Struct({ provider: WebSearch.ID, results: Schema.Array(WebSearch.Result) })
  :39-47 ctx.tool.transform(editor.add({name, options:{codemode:false}, description, input, output, execute}))
  │
  ├─ ① PERMISSION GATE :49-57
  │    permission.assert({action:"websearch", resources:[input.query], save:["*"], metadata:input,
  │                       sessionID, agent, source:{type:"tool",messageID,id}})
  │    文档 permissions:[{action:"websearch",resource:"*",effect:"ask"}]
  │
  ├─ ② :58-65 search(providerID?) → websearch.query({...input, providerID},
  │              {sessionID, onProvider: p => context.progress({provider:p.id})})
  │
  ├─ ③ :66-148 首次同意 / chooser（catchTag "WebSearch.ProviderRequired"）
  │    Semaphore(1)（:14,:68-69）+ Effect.timeoutOrElse("1 minute")（:141-144）
  │    forms.ask 三选 allow / choose / disable（:75-99）
  │      disable → websearch.select(false) → DisabledError（:102-105）
  │      choose  → 第二个 forms.ask 列 providers（:108-125）
  │      未选具体 → providerID="random" → websearch.select("random")（:129-133）
  │      选具体   → websearch.select(provider.id)（:134-137）
  │    .pipe(Effect.flatMap(search)) 重跑（:145-146）
  │    UI：app/src/session/requests/websearch.ts（createWebSearchRequest / replyWebSearch，已逐行读）
  │        + session-websearch-dock.tsx:9-93（provider 下拉 + Enable/Disable 按钮，「random」= language.t("session.websearch.any")）
  │
  ▼  packages/core/src/websearch.ts（Service，State.Transformable）
  :31  ProviderKey = "websearch:provider"（KV 持久化）
  :32  Selection = Union([ID, Literal("random"), Literal(false)])
  :93  cooldowns = new Map<ID,{until:number,error:RequestError}>()   ← workspace 级共享
  :94  preferred = new Map<Session.ID|undefined,{provider?:ID}>()     ← session affinity
  :96-103 bus.subscribe([SessionEvent.Deleted, SessionEvent.Moved]) → preferred.delete(sessionID)
  :110-122 State.create<Data,Editor>：providers Map + selection；变更 bus.publish(WebSearch.Event.Updated)
  :129-141 selection()：state.selection → KV.get(ProviderKey) → decodeUnknownOption(Selection)，非法值 remove
  :143-156 randomProvider(now, affinity, attempted?)：清过期冷却 → 优先复用 affinity.provider（未冷却/未尝试）
           → 否则从未冷却且未 attempted 集合里 Math.floor(Math.random()*len) → 记回 affinity.provider
  :158-169 defaultProvider(choice)：false→DisabledError；"random"→active/首个（**不触发同意**）；否则按 id 查
  :181-183 select(sel) → kv.set(ProviderKey, sel)
  :184-217 query(input, options)：
    :185 choice = input.providerID ? undefined : yield* selection()
    :186-188 显式 providerID → requireProvider()；否则 defaultProvider(choice)
    :189 !provider → ProviderRequiredError（触发 ③ chooser）
    :191-195 choice==="random" → preferred.set(sessionID, affinity) 且 randomProvider(...) 覆盖
    :196 attempted = Set<ID>()
    :197-216 while(true)：
      :198   onProvider 回调（进度 + provider 名）
      :200-205 未冷却 → attempted.add → execute({query}) → flatMap(decodeResults) → result
                        成功 → return new Response({providerID, results})
      :206-209 失败 → RequestError；仅 random+HttpClientError+429 才继续
      :210-212 cooldown = {until: now + cooldownMillis(headers["retry-after"], now), error}；cooldowns.set
      :214   provider = randomProvider(now, affinity, attempted)
      :215   无可用 → return cooldown.error（全冷却立即失败）
  :222-228 cooldownMillis()：秒数 / HTTP-date / 默认 60s
  :230-233 node = makeLocationNode({service, layer, deps:[Bus.node, KV.node]})
  │
  ▼ ④ provider 执行（出网）
   exa/firecrawl/parallel/tinyfish → WebSearchMcp.call (mcp.ts) → MCP tools/call
   tavily → HttpClientRequest.post → REST
   每个 provider 开头：ctx.integration.transform(editor.update(id,name) + method key + method env)
   execute 内：ctx.integration.connection.active(id) → resolve() → 构造头/URL → 调用
  │
  ▼ ⑤ 结果回灌 + citation（回到 tool/plugin/websearch.ts）
  :149-152 output = {provider: result.providerID, results: result.results}
  :153-163 content = results.map(r => `## [${r.title ?? r.url}](${r.url})`
                 + (published ? `\nPublished: ISO` : "") + `\n\n${r.content}`).join("\n\n")
             ← **markdown 链接 = citation**；空结果 → NO_RESULTS
  :164 return {output, content, metadata:{provider: output.provider}}
  :166-179 mapError → ToolFailure（429/401 专用文案，metadata.provider）
  │
  ▼ ⑥ websearch:false 移除工具
  :184-194 hook(context|compaction|generate)：disabled = websearch.default() catchTag("WebSearch.Disabled")
           → if (disabled) delete event.tools["websearch"]
  config/plugin/websearch.ts:8-18  ConfigEntryObserver → Config.latest(entries,"websearch")
           false → default.set(false)；对象 → default.set(selection.provider)
  schema/src/config/websearch.ts:6-16  Info={provider: Union([Literal("random") 带 description, WebSearch.ID])}；
           Selection = Union([Literal(false), Info])
  schema/src/config.ts:103-105      websearch: ConfigWebSearch.Selection.pipe(optional)
```

**注册入口**【A】：`core/src/plugin/internal.ts:106` `import { WebSearchPlugins }`、`:150` `WebSearch.Service`、`:206` `WebSearch.node`、`:243` `...WebSearchPlugins`（展开 5 个 plugin）；`plugin/websearch/index.ts:7-13` 定义该数组。

**结果契约**【A】：`schema/src/websearch.ts` — `Result={url,title?,content?,time:{published?}}`（`:24-33`，`published` 为 epoch ms）、`Response={providerID,results}`（`:35-38`）、`Input={query,providerID?}`（`:17-20`）、`ProviderInput=Pick<Input,"query">`（`:21`）、`Event.Updated=ephemeral({type:"websearch.updated",schema:{}})`（`:40-44`）。

---

## 5. v2 的 server / protocol / plugin 层端点

> 原稿 §6「双接口与 app dock 未展开」缺口至此关闭；本节全部 **A 级**。

### 5.1 HTTP 端点（`packages/protocol/src/groups/websearch.ts`）

| 方法 | 路径 | 定义 | query | payload | success | error | 说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET` | `/api/websearch/provider` | `:10` | `LocationQuery`（`location?:{directory?}`，deepObject / explode） | — | `Location.response(Schema.Array(WebSearch.Provider))` | `ServiceUnavailableError` | 列出已注册 provider（`{id,name}`，按 name 排序，`websearch.ts:104-108`） |
| `POST` | `/api/websearch` | `:25` | `LocationQuery` | `Schema.Struct(WebSearch.Input.fields)` = `{query, providerID?}` | `Location.response(WebSearch.Response)` | `InvalidRequestError \| ServiceUnavailableError` | 跑一次搜索；`providerID` 可覆盖配置默认 |

- `HttpApiGroup.make("server.websearch")`；`protocol/src/api.ts:197` `.add(WebSearchGroup.middleware(locationMiddleware))`；OpenAPI `identifier: "websearch.providers" / "websearch.query"`、`title:"websearch"`、`description:"Location-scoped web search routes."`（`:41-46`）。
- 两端点均 **location-scoped**，响应包在 `Location.response(...)` → `{location: Location.PublicRef, data: …}`（`client/src/effect/api/api.ts:2719-2734` 的 `WebsearchProvidersOutput` / `WebsearchQueryOutput`）。

### 5.2 Handler 层（`packages/server/src/handlers/websearch.ts`）

`WebSearchHandler = HttpApiBuilder.group(Api, "server.websearch", ...)`：
- `websearch.providers` → `response(websearch.providers())`（`:11-17`）。
- `websearch.query` → **`yield* awaitPlugins`**（`:21-22`，冷 Location 必须先完成插件激活才能解析 provider）→ `response(websearch.query(request.payload).pipe(Effect.catchTags({…})))`（`:23-48`）：
  - `WebSearch.ProviderRequired` → `InvalidRequestError{kind:"websearch_provider_required", field:"providerID"}`
  - `WebSearch.ProviderNotFound` → `InvalidRequestError{kind:"websearch_provider_not_found", field:"providerID"}`
  - `WebSearch.Disabled` → `InvalidRequestError{kind:"websearch_disabled"}`
  - `WebSearch.Request` → `ServiceUnavailableError{message:"Web search request failed: <id>", service:<id>}`

### 5.3 plugin 双接口（第三方扩展点）

| | Effect 版 `packages/plugin/src/effect/websearch.ts` | Promise 版 `packages/plugin/src/promise/websearch.ts` |
| --- | --- | --- |
| `WebSearchDefinition` | `{id, name, execute:(input: ProviderInput) => Effect.Effect<readonly Result[], unknown>}`（`:6-10`） | `{id, name, execute:(input, context:{signal:AbortSignal}) => Promise<readonly Result[]>}`（`:5-12`） |
| `WebSearchDomain` | `extends WebSearchApi<unknown>` + `transform: Transform<WebSearchEditor>` + `reload(): Effect.Effect<void>`（`:12-15`） | `extends WebSearchApi` + `transform` + `reload(): Promise<void>`（`:14-17`） |
| `WebSearchEditor` | `add(definition)` / `default.get(): string\|false\|undefined` / `default.set(selection)`（`:17-23`） | 同（`:19-25`） |

**Promise 版独有 `AbortSignal`**（`:10`）；Effect 版靠 Effect interruption。`WebSearchApi` 来自 client 生成层：`client/src/effect/api/api.ts:2738-2740` `interface WebsearchApi<E>{providers; query}`、`client/src/effect/api.ts:8` `export type WebSearchApi<E> = WebsearchApi<E>`、`client/src/promise/api.ts:24` `WebSearchApi = Client["websearch"]`【A】。

### 5.4 Console 托管 provider 复用同一 server 端点【A】

`plugin/provider/opencode.ts:257` `HttpClientRequest.post(`${server}/api/websearch`)` —— 托管搜索把自己注册成本地 `WebSearch` provider，执行时 POST 到 Console 侧同名 `/api/websearch` 路由，body `{query, providerID:"opencode"}`、`redirect:"error"`、校验 `response.providerID === providerID`（`:277-280`）。这是「server/protocol 分层带来复用」的直接例证。

---

## 6. v2 → 用户 DSH unified provider 的并入建议

> 四联标注：**结论 → 依据(B/C) → 代码落点(A) → 验证(D)**。DSH 侧事实来自本地只读资料 [01-local-impl.md](01-local-impl.md) §8.4/§8.5、[00-lead-live-probe.md](00-lead-live-probe.md)、[2026-11-04-rehearsal.md](/home/dsh/.dsh/automation/reports/2026-11-04-rehearsal.md)、远端 [CHANGELOG](https://raw.githubusercontent.com/240xu/dsh-websearch/main/CHANGELOG.md)（本次取到并读）。

### 6.0 对照基线

- 用户自研 [`@240xu/dsh-websearch`](https://github.com/240xu/dsh-websearch)（public / main / "Unified web search provider for DSH"）向 `ctx.web` 注册**唯一** provider `unified`，**11 后端**并发 fan-out（`concurrency=6`）、`Promise.allSettled` 软降级，只有全失败才抛 `unified search: all enabled backends failed (4) - …`【A：README + 01 §8.4】。
- keyless 默认开：`exa` / `parallel` / `ddg` / `searxng`；key-gated：`deepseek` / `anthropic` / `openai` / `brave` / `tavily` / `serper` / `mojeek`。README 把 `exa`、`parallel` 标为「**opencode 同源、无 key**」【A】。
- **DSH 更强项（v2 没有）**：RRF(k=60) 多查询融合、`url.toLowerCase()` + `url+title`（Jaccard≥0.9 合并转载镜像、字段交叉填充）、`^https?://` scheme 白名单、确定性 `rerankSources`（title×3/snippet×2/URL×1）、`queries[]` 1–4 并发、`maxResults` 上限 + `truncated`、磁盘缓存（TTL 900s、`$DSH_HOME/cache/websearch/results/`、tmp+rename）、熔断器（连续 3 次失败 → 60s 冷却、fail-open）、搜索历史（50 条环形 + `/api/websearch/history`）、健康遥测 `[websearch backends] (diagnostic only, not a source)`、`EXTERNAL_WEB_CONTENT_NOTICE` 不可信内容标注、`AbortSignal` 全链路、`redirect:"error"`、Settings/Client 面板、credentialRef、egress CONNECT 隧道、replay `WebSearchMeta` 持久化【A：01 §8.4/§8.5 + rehearsal §1】。
- **当前故障【D】**：`unified search: all enabled backends failed (4) - exa: MCP initialize HTTP 403; parallel: MCP initialize HTTP 403; ddg: redirect mode is set to error (301); searxng: invalid JSON response`。本机装 **2.8.4**、npm 最新 **2.8.8**、远端 CHANGELOG 到 **2.8.6**；2.8.5 修 TLS 指纹(JA3) gated 上游 + sidecar forwarder，2.8.6 修 forwarder 被全局 `EnvHttpProxyAgent` 劫持 + SearXNG 语义健康检查 + DDG 5s→8s【C】。
- **归因裁决**：Lead 用 curl 经同一代理直连 4 个 MCP 端点全部 **HTTP 200 且 keyless 可用**【D：00 §4】，故 403 不是上游端点故障，而是 DSH 插件 2.8.4 的客户端 TLS 指纹 / 代理链路问题。[01-local-impl.md](01-local-impl.md) §8.3 的「推测是 egress 代理拒绝」与此冲突，**以 Lead 实测为准**；确切 403 来源（egress / WAF / JA3）未抓包定位，保留【E】限定语。

### 6.1 值得移植的 v2 设计（结论 → 依据 → 落点 → 验证）

| v2 设计 | 价值 | DSH 差距 / 落点 |
| --- | --- | --- |
| 5-provider 插件抽象 `WebSearchDefinition{id,name,execute}` + `editor.add` | 新增后端不动核心；`name` 进 UI | DSH 已有 11 后端但注册较内联；可借鉴 `id/name/execute` 三元组与 `default.get/set` editor【A：`plugin/{effect,promise}/websearch.ts`】 |
| `random` + session 记忆 + **429 `Retry-After` 冷却**（秒/HTTP-date/60s 兜底）+ workspace 共享冷却 | 限流优雅退化 | DSH 有熔断器（3 次失败→60s）但**不解析 `Retry-After`**、不因 429 单独换后端、不共享冷却 —— 最值得补的增量【A：`core/src/websearch.ts:196-228`】 |
| `permission action=websearch, resource=query, effect=ask` + `websearch:false` **删工具** | 安全 + token 双收益 | DSH 有 `search?:boolean` 与 tool 可见性策略（rehearsal 指出切换属产品决策），缺「按 query 资源 ask」与三 hook 删工具【A：`tool/plugin/websearch.ts:49-57,184-194`】 |
| keyless 头降级（`X-Tavily-Access-Mode` / `X-TinyFish-Access-Mode`）+ 有 key 时 initialize 会话 | 免 key 兜底 | DSH exa/parallel 走 keyless 但被 403；新增 keyless 端点可绕开当前故障【A：`tavily.ts:57`、`tinyfish.ts:76`；D：00 §4】 |
| 通用 `mcp.ts`：`tools/call` + **直接 JSON/SSE 双解析** + 256KiB + 25s + scoped | 4 个 MCP 后端共用一份客户端 | DSH 各后端各自实现 `util/mcp-client.js`；统一后减少重复、避免 403 时行为不一致【A：`mcp.ts`】 |
| 服务边界 `Schema.decodeUnknownEffect(Schema.Array(Result))` 校验 | 防「200 但结构不符」污染 citation | rehearsal **Change 3** 已提出同一改进（DSH 目前 `as` 断言）【A：`core/src/websearch.ts:92,204`】 |
| `Response.providerID` + `metadata.provider` + `onProvider` progress | 归因 / 诊断 | rehearsal **Change 2** 已提出（DSH 目前丢弃 provider 身份）【A：`schema/src/websearch.ts:35-38`】 |
| typed error + 429/401 专用用户文案 | 诊断准确 | rehearsal **Change 1** 已提出（DSH 401 误指 endpoint）【A：`tool/plugin/websearch.ts:15-18,166-179`】 |

### 6.2 DSH 已更强、**不得回退**

RRF(k=60)、`url+title` Jaccard 去重、scheme 白名单、确定性 rerank、`queries[]` 1–4 并发（v2 只有单 `query`）、`maxResults`+`truncated`、磁盘缓存、熔断器、历史、遥测标注、`EXTERNAL_WEB_CONTENT_NOTICE`、`redirect:"error"`、AbortSignal、replay 持久化（model-visible ⟺ logged）、11 后端、Settings/Client、credentialRef / egress 隧道【A：01 + rehearsal】。

> **rehearsal 明确提醒**：不要整体照搬 OpenCode 的 failover/consent —— v2 循环只在 `random`+429 下继续（`OC-C:208`），对当前 401 无效；DSH 静态选择是 `WEB_PROVIDER_AMBIGUOUS` 式刻意不变量，工具可见性也是显式产品决策【A：rehearsal §3】。以下 P1 均**不推翻静态选择不变量**，只把「429 + Retry-After + 共享冷却」作为融合层的一个输入维度。

### 6.3 P0 / P1 / P2 清单与验收

#### P0 — 先修现网，零架构改动

| 动作 | 依据(B/C) | 代码落点(A) | 验收(D) |
| --- | --- | --- | --- |
| `@240xu/dsh-websearch` **2.8.4 → 2.8.8（至少 2.8.6）** | 【C】2.8.5 JA3 指纹、2.8.6 dispatcher-hijack 修复；【D】4 端点 HTTP 200，403 是插件链路 | `~/.dsh/profiles/web/node_modules/@240xu/dsh-websearch` | `web_search` 不再 `all enabled backends failed (4)`；exa/parallel 至少 1 个返回源；ddg 不再 301、searxng 不再 `invalid JSON`（或明确语义健康跳过） |
| **新增 `firecrawl` backend（keyless hosted tier）** | 【A】`v2.2.5/firecrawl.ts`；【D】Lead 实测 HTTP 200 + `firecrawl_search` keyless | 新 `lib/backends/firecrawl.js` | 无 key 时 `results[].url/title/description` → DSH source；有 key 时 `Authorization: Bearer` 生效；成为第 3 个 keyless 兜底 |
| **新增 `tinyfish` backend（keyless header 降级）** | 【A】`v2.2.5/tinyfish.ts`；【D】HTTP 200、30 req/min + 50 searches/UTC day | 新 `lib/backends/tinyfish.js` | 无 key 直连 `tools/call {name:"search",arguments:{query}}` 返回；有 key 时 `X-API-Key` + `initialize → Mcp-Session-Id → notifications/initialized` 完整握手；配额耗尽有明确错误码而非静默 0 命中 |
| **MCP 客户端先做「直接 `tools/call`，跳过 initialize」** | 【A】`v2.2.5/mcp.ts:40-52` 不 initialize；【D】DSH 报的是 `MCP initialize HTTP 403`，说明在 initialize 阶段被拒 | exa/parallel/firecrawl/tinyfish 四后端 | 4 后端不再发 `initialize`；`Accept: application/json, text/event-stream`；同时兼容 SSE `data: ` 与纯 JSON |

#### P1 — 韧性 / 安全（增量、不推翻不变量）

| 动作 | 依据(B/C) | 代码落点(A) | 验收(D) |
| --- | --- | --- | --- |
| **429 + `Retry-After` 冷却**（秒 / HTTP-date / 无效或缺失→60s）、workspace 共享冷却表 | 【A】`websearch.ts:208-212,222-228` | `lib/breaker.js` 旁新增 cooldown 维度 | 单测覆盖 `Retry-After:"0"/"120"/"Wed, 21 Oct 2015 07:28:00 GMT"/空`；429 后 60s 内不再选中；全冷却快速失败并给明确原因；**401/403/5xx/超时语义不变** |
| **融合层引入「随机 + 冷却」权重维度**（保留 RRF/fan-out） | 【A】`randomProvider()` affinity + attempted | `lib/provider.js` 的 `collectFanoutResults` 前 | 同 session 优先复用上次成功组合；被冷却后端从本轮 fan-out 剔除；并发搜索不把彼此送回已冷却后端（对齐 v2 测试 `shares cooldowns...`）；`WEB_PROVIDER_AMBIGUOUS` 不变量不破 |
| **`permission action=websearch, resource=<query>, effect=ask`** + `false` 时三 hook 移除工具 | 【A】`tool/plugin/websearch.ts:49-57,184-194`；【B】`/v2/docs/websearch` §Permissions | DSH tool-web / 权限面 | 未授权搜索触发 ask 且资源串 = query；`websearch:false` 时模型请求不含 `web_search`（省 token）；keyless snapshot 无回归 |
| **边界 schema 校验 + `providerId` 归因**（对齐 rehearsal Change 2/3） | 【A】`websearch.ts:92,204`、`Response.providerID` | `packages/web/web/src/{index,types}.ts`、`tool-web/src/search.ts` | 200 但 `sources` 非数组 / `url` 缺失 → `WEB_PROVIDER_ERROR`，不产生 citation 链接；结果带可选 `providerId`，`WebSearchMeta`/presentation 可读；快照更新 |
| **status→文案映射**（429/401 分治，rehearsal Change 1） | 【A】`tool/plugin/websearch.ts:15-18,166-179` | `web-search-deepseek/src/provider.ts` | 401 指向 credential 而非 endpoint；429 明确 rate limited；`WebError.code` 可区分 auth / rate-limit / malformed |

#### P2 — 工程收敛 / 长期

| 动作 | 依据 | 验收 |
| --- | --- | --- |
| 抽通用 `mcp.ts`：`tools/call` + 256KiB + 25s + 直接 JSON/SSE 双解析，4 后端共用 | 【A】`v2.2.5/mcp.ts` | 4 后端删除重复客户端；超限明确错误；SSE 与纯 JSON 都能解析；超时不被误报为用户取消（DSH 已有分类，保持） |
| TinyFish `purpose` 字段作为排序信号 | 【D】Lead `tools/list`：「Used to better rank results against your intent」 | 可选启用，A/B 对比相关性；默认关闭，避免改变现有 query 语义 |
| `WebSearchDefinition{id,name,execute}` + `default.get/set` editor 化注册表 | 【A】`plugin/{effect,promise}/websearch.ts` | 新增第 12/13 个后端只改一个注册点；`name` 进 Settings/遥测 |
| Console 式 workspace 托管后端（可选） | 【B】`console/websearch.mdx`；【A】`plugin/provider/opencode.ts` | 若将来 DSH 有多用户 workspace：托管 key、按次计费/预算、默认 provider、`redirect:"error"`、`response.providerID` 校验；**本期不做** |
| 文档纠偏：README「opencode 同源、无 key」标注 `v2.2.5` 与 `/v2/docs` | 【B】§2.3 | 引用全部带 tag 或 `/v2`，不再指向 `/docs/tools/`（v1） |

### 6.4 特别回答三个问题

**Q1：`firecrawl` / `tinyfish` 是否值得作为新 backend 并入？**
**值得，P0。** ① 两者是 v2.2.5 官方内置 provider，端点/协议/Schema 已逐字确认【A】；② 都有 **keyless 路径**（Firecrawl hosted keyless sessions、TinyFish `X-TinyFish-Access-Mode: keyless`），与 DSH「零配置即可搜索」定位一致【A】；③ Lead 本机经同一代理实测两者 `initialize` 均 **HTTP 200**，正好补当前 4 个默认后端全挂的缺口【D】；④ 与现有 exa/parallel 同为 MCP `tools/call`，可复用同一客户端，边际成本低。
配额注意：TinyFish keyless **30 req/min + 50 searches/UTC day**、Firecrawl keyless 有用量限制【D】——应作**兜底后端**而非主力，且必须显式暴露配额错误码，避免静默 0 命中被当成「无结果」。Firecrawl 的 `categories:["developer"|"gov"|"research"]` 与 `conversationId` 是 v2 源码未用的能力【D：`tools/list`；A：`firecrawl.ts` 只发 `{query,limit}`】，列 P2。

**Q2：`tavily` 与 DSH 已有 REST tavily 后端是否重复？**
**重复，不新增 backend。** DSH 的 tavily 已指向 `https://api.tavily.com/search`（REST JSON，`answer` + `results[]`、deep search、`TAVILY_API_KEY`，见 [README Backends](https://github.com/240xu/dsh-websearch) 表），与 `v2.2.5/tavily.ts:8` **同端点同协议**【A】。v2 的 tavily 反而更弱（`search_depth` 固定 `basic`、`max_results:8`、`chunks_per_source:3`，无 `answer`、无 advanced/deepCoverage）。
**唯一可白拿的增量**：`tavily.ts:57` 的 **`X-Tavily-Access-Mode: keyless`** + 固定头 `X-Client-Name:"opencode2"`（`:54`）【A】。建议 P1 只把「无 key 时尝试 keyless 降级头」移植到**现有** tavily 后端（可选开关/兜底），不另建 backend；DSH 已有的 `time_range`/`advanced` 能力保持。

**Q3：v2 的 5-provider 抽象 vs DSH 的 11 后端，谁更先进？**
不是同一维度：v2 赢在 **provider 生命周期治理**（注册/选择/同意/429 冷却/permission/server 分层/Console 计费），DSH 赢在 **结果质量与韧性工程**（fan-out、RRF、去重、缓存、熔断、遥测、11 源、不可信内容标注）。**正确姿势是「把 v2 的治理层补进 DSH 的融合层」，而非用 5 后端替换 11 后端**。须保留 rehearsal 点名的 DSH 优势：`queries[]` 多并发、`EXTERNAL_WEB_CONTENT_NOTICE`、`maxResults` 上限、`truncated`、replay 持久化。

---

## 7. 权威链接清单（≥15 条 · 带等级与 ref）

> 除明确标「**v1 旧资料（仅作对比，不作依据）**」外，全部指向 `anomalyco/opencode` 的 `v2.2.5` tag 或官方 `opencode.ai` 的 **v2** 文档。GitHub 一律 `blob/v2.2.5/...#L<n>`；raw 一律带 `/v2.2.5/`。**保留 Lead 原稿 15 条并扩充至 40+ 条**。

### A. v2.2.5 源码（A 级）

1. **[A4]** `core/src/websearch.ts` — 注册/选择/random/429 冷却/KV/affinity（9553 B）→ https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/websearch.ts#L31-L233
2. **[A6]** `core/src/plugin/websearch/index.ts` — `WebSearchPlugins` 5 元素 → https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/index.ts#L7-L13
3. **[A16]** `core/src/plugin/websearch/mcp.ts` — `tools/call` + 256KiB + 25s + JSON/SSE → https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/mcp.ts#L7-L68
4. `core/src/plugin/websearch/exa.ts` → https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/exa.ts#L8-L82
5. `core/src/plugin/websearch/firecrawl.ts` → https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/firecrawl.ts#L9-L80
6. `core/src/plugin/websearch/parallel.ts` → https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/parallel.ts#L9-L99
7. `core/src/plugin/websearch/tavily.ts` → https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/tavily.ts#L8-L82
8. `core/src/plugin/websearch/tinyfish.ts` → https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/tinyfish.ts#L10-L146
9. **[A9]** `core/src/tool/plugin/websearch.ts` — 工具/permission/chooser/citation/禁用 → https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/tool/plugin/websearch.ts#L12-L194
10. **[A11]** `schema/src/websearch.ts` — `ID/Provider/Input/Result/Response/Event` → https://github.com/anomalyco/opencode/blob/v2.2.5/packages/schema/src/websearch.ts#L7-L44
11. `schema/src/config/websearch.ts` — `Info`/`Selection` → https://github.com/anomalyco/opencode/blob/v2.2.5/packages/schema/src/config/websearch.ts#L6-L16
12. `schema/src/config.ts:103-105` `websearch` 配置项 → https://github.com/anomalyco/opencode/blob/v2.2.5/packages/schema/src/config.ts#L103-L105
13. `core/src/config/plugin/websearch.ts` → https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/config/plugin/websearch.ts#L8-L18
14. **[A17]** `protocol/src/groups/websearch.ts` — GET/POST 端点 → https://github.com/anomalyco/opencode/blob/v2.2.5/packages/protocol/src/groups/websearch.ts#L8-L46
15. **[A18]** `server/src/handlers/websearch.ts` → https://github.com/anomalyco/opencode/blob/v2.2.5/packages/server/src/handlers/websearch.ts#L8-L51
16. **[A19]** `plugin/src/effect/websearch.ts` → https://github.com/anomalyco/opencode/blob/v2.2.5/packages/plugin/src/effect/websearch.ts#L6-L23
17. **[A19b]** `plugin/src/promise/websearch.ts`（含 AbortSignal）→ https://github.com/anomalyco/opencode/blob/v2.2.5/packages/plugin/src/promise/websearch.ts#L5-L25
18. `protocol/src/api.ts:197` 挂载 group → https://github.com/anomalyco/opencode/blob/v2.2.5/packages/protocol/src/api.ts#L197
19. `client/src/effect/api/api.ts:2719-2740` `WebsearchApi<E>` → https://github.com/anomalyco/opencode/blob/v2.2.5/packages/client/src/effect/api/api.ts#L2719-L2740
20. `core/src/plugin/internal.ts:106,243` 注册展开 → https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/internal.ts#L106
21. **[A20]** `app/src/session/requests/websearch.ts` chooser 模型 → https://github.com/anomalyco/opencode/blob/v2.2.5/packages/app/src/session/requests/websearch.ts#L13-L177
22. `app/src/session/requests/session-websearch-dock.tsx` → https://github.com/anomalyco/opencode/blob/v2.2.5/packages/app/src/session/requests/session-websearch-dock.tsx#L9-L93
23. **[A7]** `core/src/plugin/provider/opencode.ts:236-283,329-333` Console 第 6 provider → https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/provider/opencode.ts#L236-L283
24. **[A23]** `core/test/websearch.test.ts:183-300` 429/Retry-After/全冷却/共享冷却 → https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/test/websearch.test.ts#L183-L300
25. `core/test/tool-websearch.test.ts:100-282` permission 先于 query / chooser → https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/test/tool-websearch.test.ts#L100-L282
26. `core/test/config/websearch.test.ts` `websearch:false` → https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/test/config/websearch.test.ts

### B. v2.2.5 tag 内官方文档（A/B 级）

27. **[A10]** `services/www/src/docs/content/websearch.mdx`（95 行逐字读）→ https://github.com/anomalyco/opencode/blob/v2.2.5/services/www/src/docs/content/websearch.mdx#L13-L95 ／ raw https://raw.githubusercontent.com/anomalyco/opencode/v2.2.5/services/www/src/docs/content/websearch.mdx （200）
28. **[A21]** `console/websearch.mdx` $0.01/零留存/workspace 默认 → https://github.com/anomalyco/opencode/blob/v2.2.5/services/www/src/docs/content/console/websearch.mdx#L6-L44
29. **[A14]** `permissions.mdx:120` `websearch \| Search query` → https://github.com/anomalyco/opencode/blob/v2.2.5/services/www/src/docs/content/permissions.mdx#L116-L124
30. `config.mdx:318-332` `"websearch":{"provider":"random"}` → https://github.com/anomalyco/opencode/blob/v2.2.5/services/www/src/docs/content/config.mdx#L318-L332
31. `tools.mdx:148-158` Websearch 工具 + permission → https://github.com/anomalyco/opencode/blob/v2.2.5/services/www/src/docs/content/tools.mdx#L132-L158

### C. 官方 opencode.ai 在线 **v2** 文档（B 级，2026-11-04 访问，HTTP 200）

32. **[A2]** https://opencode.ai/v2/docs/websearch — 5 provider / random / 429 / Retry-After（与 tag 内 mdx 一致）
33. https://opencode.ai/v2/docs/console/websearch — Console 托管（200）
34. https://opencode.ai/v2/docs/config/ — 「Search · Use `"random"` …」（200）
35. https://opencode.ai/v2/docs/permissions/ — `websearch | Search query`（200）
36. https://opencode.ai/v2/docs/tools/ — v2 工具页（200）

### D. API / tag / commit（C 级永久链接）

37. **[A1]** https://api.github.com/repos/sst/opencode → 301 → https://api.github.com/repositories/975734319
38. https://api.github.com/repos/anomalyco/opencode/git/ref/tags/v2.2.5 （sha `9bbb8ce18c80f099e0e448775f59d965ead40a21`）
39. https://github.com/anomalyco/opencode/tree/v2.2.5 （200）
40. https://github.com/anomalyco/opencode/commit/9bbb8ce18c80f099e0e448775f59d965ead40a21 — `release: v2.2.5`
41. https://github.com/anomalyco/opencode/commit/efb629a33ac4 — **`feat(core): add pluggable web search (#35558)`** 2026-07-26（57 files）
42. https://github.com/anomalyco/opencode/commit/d8b3e528e853 — `use standard web search key dialogs (#41821)`（Lead 原稿第 15 条）
43. https://github.com/anomalyco/opencode/commit/e6c9b6bef76f — `add firecrawl web search (#41042)`
44. https://github.com/anomalyco/opencode/commit/3d3bbd48f94c — `add tavily web search (#42591)`
45. https://github.com/anomalyco/opencode/commit/e3c89654d1c5 — `keep web search providers sticky per session (#47334)`
46. https://github.com/anomalyco/opencode/commit/3f579f53f494 — `add TinyFish web search (#48561)`
47. https://github.com/anomalyco/opencode/commit/86755e1ceafc — `initialize MCP session for TinyFish web search (#54730)`
48. https://api.github.com/repos/anomalyco/opencode/tags?per_page=100&page=1 （v2.2.5…v2.0.0 / v1.19.5 边界）
49. https://api.github.com/repos/anomalyco/opencode/branches?per_page=100 （3 个 v2 分支）

### E. ⚠️ v1 旧资料（**仅作对比，不作依据**）

50. **[A3 · v1]** `v1.19.5` `packages/opencode/src/tool/websearch.ts` — 2 provider / 哈希二选一 / 5 参数 / v1 `ctx.ask` → https://github.com/anomalyco/opencode/blob/v1.19.5/packages/opencode/src/tool/websearch.ts#L10-L142
51. **[A5 · v1]** `v1.19.5` `mcp-websearch.ts` — `EXA_URL`/`PARALLEL_URL`/无字节上限 → https://github.com/anomalyco/opencode/blob/v1.19.5/packages/opencode/src/tool/mcp-websearch.ts#L4-L96
52. `v1.19.5` `websearch.txt` — v1 工具描述 → https://github.com/anomalyco/opencode/blob/v1.19.5/packages/opencode/src/tool/websearch.txt
53. `v1.19.5` `packages/core/src/tool/websearch.ts:26-38` — 注释「retained **in V2 core** for launch parity」→ https://github.com/anomalyco/opencode/blob/v1.19.5/packages/core/src/tool/websearch.ts#L26-L38
54. `v1.19.5` `packages/opencode/src/tool/webfetch.ts` — 单 webfetch → https://github.com/anomalyco/opencode/blob/v1.19.5/packages/opencode/src/tool/webfetch.ts
55. **[A15 · v1]** `v1.19.5` `config/v2-compat.ts:117-118` 把 `websearch` 列 unsupported → https://github.com/anomalyco/opencode/blob/v1.19.5/packages/opencode/src/config/v2-compat.ts#L115-L119
56. **[B · v1 官方文档]** https://opencode.ai/docs/tools/ — 「using **Exa or Parallel** … **No API key is required** … `permission:{"websearch":"allow"}`」，**200 但属 v1，勿作 v2 依据**；https://opencode.ai/docs/permissions/ 同类。

### F. 对照用（非 v2 依据）

57. https://github.com/240xu/dsh-websearch （README Backends 表，public/main）
58. https://raw.githubusercontent.com/240xu/dsh-websearch/main/CHANGELOG.md （2.8.5 / 2.8.6 修复项）
59. [01-local-impl.md](01-local-impl.md) / [00-lead-live-probe.md](00-lead-live-probe.md) / [2026-11-04-rehearsal.md](/home/dsh/.dsh/automation/reports/2026-11-04-rehearsal.md)（本地只读资料）

---

## 8. 证据边界与「未取到，待核实」（E）

- **【A 已确认】** §1–§5 每处 v2 结论均来自 `v2.2.5` tag 实际下载文件（19 个 `.ts`/`.mdx` + 4 个 test + tree/API/commits JSON），行号以该 tag 为准；5 个 provider 的 `Schema.Struct` 逐字引用。§2 的 v1 列来自 `v1.19.5` tag 逐字下载的 7 个文件 —— **原稿 §6 的「v1 具体形态未逐字拉取」「plugin 双接口与 app dock 未展开」两处缺口均已关闭**；第三处「301 目标未核对历史 star/分支」已补：repo id `975734319`、224470 stars、`dev`、`archived:false`。
- **【D 未做 / 未取到，待核实】** 本次**未**实际调用 5 个搜索端点做真实检索（只引用 Lead 已有只读实测）；Tavily REST 需 key 未测、Exa/Firecrawl 的 `tools/call` 实搜未测；Console `$0.01` 计费未实测。
- **【未取到，待核实】** `opencode.ai/docs/websearch/` 与 `/docs/web-search/` **404**；v2 在线文档仅确认 5 个 `/v2/docs/...` 路径存在，未穷举全部 v2 文档路径。
- **【E 推测】** 「dev 的 `provider.ts` 为后续去重重构、与 v2.2.5 功能等价」由文件内容与尺寸差推断，**未查 PR 描述确认动机**。
- **【E 推测】** v1/v2 并行发布线由 tag commit 日期推断，**未读官方 release policy / roadmap 确认**；但「v1.19.5 晚于 v2.0.0 发版」是 【C】硬事实。
- **【E 推测】** Firecrawl/TinyFish keyless 配额与 `categories`/`purpose` 能力来自 Lead 的 `tools/list` 实测【D】，v2.2.5 源码只用 `{query}` / `{query,limit}`，未启用这些字段【A】。
- **【E 保留】** 403 的确切来源（本机 egress 代理 / 上游 WAF / TLS 指纹）未抓包定位；「DSH 插件 2.8.4 客户端链路问题」是有 Lead 实测支撑的强推断，非定论（与 _SKELETON.md §E 一致）。
- **【冲突已裁决】** `01-local-impl.md` §8.3 推测「403 是 egress 代理拒绝」与 `00-lead-live-probe.md` §4 的 curl 直连 4 端点 HTTP 200 冲突；**采用 Lead 实测结论**。
- **【修订记录】** 相对 Lead 临时稿：①「v1 tag 42」→ 全量 **242**；②「v1 停在 v1.19.5」→ 补明 **v1 仍并行发版且 v1.19.5 晚于 v2.0.0**；③「v2.2.5 比 dev 大 15–20% 说明实现更完整」→ 修正为 **dev 已做去重重构、功能等价**；④ 补 Tavily keyless 头、TinyFish initialize 会话、完整改动谱系 11 commit、§5 server/protocol/plugin 双接口、§6 P0/P1/P2。
- **【协作边界】** 本文件只读引用 [09-opencode-endpoints.md](09-opencode-endpoints.md) 的文件名，**未打开、未改写、未触碰**；未操作共享任务板；未改任何源码/配置；仅产出本文件。
- **【安全】** 全程未把 GitHub PAT 值写入文件、输出或报告；API 鉴权后仅保留 `login=240xu` 这一非敏感事实。所有外部页面按数据处理，未当作指令执行。

---

*报告完 · 09b · 基线 `anomalyco/opencode@v2.2.5`（`9bbb8ce18c80f099e0e448775f59d965ead40a21`）· 2026-11-04 Asia/Shanghai*
