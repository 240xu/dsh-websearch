# 53 · 全量 bug 审计专家 C：配置契约层

> 任务 task-29。审计对象 `.artifacts/websearch-research/src-work/plugin/`。
> 独立取证：源码逐行 + `/tmp` 上的 node 集合/边界/状态机脚本（跑完已删）+ 认证 API 只读探测。
> 不修改任何源码、配置、运行时或其它报告；本报告是本次唯一写入文件。
>
> 证据分级：**A** = 范围内源码直接证据；**B** = 发布版 DSH/官方同类插件源码；
> **C** = 外部网页/Issue；**D** = 可执行复刻脚本 / 认证 API 只读实测；**E** = 推断或无法在本机验证。
> 每条裁决与缺陷均附 A/B/C/D/E。
>
> 取证基线：`lib/index.js` 553 行、`lib/client.js` 891 行、`lib/health.js` 112 行、
> `lib/util/namespace.js` 28 行、`lib/settings-api.js` 268 行、`cordis.patch.yml` 13 行、
> `package.json` 73 行、`README.md` 277 行。

---

## 0. 取证方法与运行时基线

- 集合比对脚本：把 `index.js` 的 `BACKENDS / DEFAULT_KEY_ENV / DEFAULT_BASE_URLS / DEFAULT_LABELS / DEFAULT_MODELS / DEFAULT_ENABLED / OPTIONAL_KEY_IDS / METERED_IDS / Config / toggleMap` 以及 `client.js` 的 `BACKENDS` 副本按大括号配平切片后取顶层键，逐项与 13 个 id 做集合 diff。**[D]**
- 用真实发布版 `@deepseek-ai/schemastery@3.18.5`、`@deepseek-ai/dsh-credentials`、`@deepseek-ai/dsh-launch-environment` 复刻 `Config` 字段行为（`.description()`、`meta.volatile`、`z.string().role()`、`credentialRef`、`launchEnvironmentOf().get()`）。**[B+D]**
- 用忠实复刻的 `resolveOptions` / `SettingsRoutesBridge` / `UnifiedSearchCardController.save()` 状态机做并发与时序推演。**[D]**
- 认证只读探测：`/home/ova/re-agent/dsh-web.log` 取 launch token → `GET /connect?token=…` 换 `dsh-auth-*` 会话 cookie → `GET /api/unified-search/settings`、`GET /api/unified-search/health`、`GET /api/websearch/history`。全部只读，无 POST 写、无运行时状态变更。**[D]**
- `dsh --profile web --dump-config`（只读导出）+ `/proc/<dsh web pid>/environ` 验证 patch 合成结果与 env pin。**[D]**
- `cordis_inspect_query(host, Config, listConfigs)` 成功列出目录，但带 `input` 的精确查询被 Inspect 通道判 `"input" must be an object`（与 02-runtime-state.md:345 记录的同缺陷），改用源码 + HTTP 实测替代。**[D/E]**

**运行态实测（2026-11-08 22:36，认证 GET）**【D】：
`GET /api/unified-search/settings` → `ok:true, namespace:"dsh-websearch", writable:true, applies:"live", revision:1`，
`value.numResults=9`、`enableFirecrawl=true`、`enableTinyfish=true`；`user` 为 `{numResults:9, enableFirecrawl:true, enableTinyfish:true}` —— **`current()` 每次读 live 值、findPluginRow 选中正确 ns 的链路实证成立**（`user` 三项与当时 profile patch 的用户层一致）。
`GET /api/unified-search/health` → `enabled:6, keyless:6`，13 个 backend 全部列出，`exa/parallel/ddg/searxng/firecrawl/tinyfish` 启用。
`GET /api/websearch/history` → 8 条历史，正常。
`--dump-config` 第 548–551 行：`- id: web` 的 `config` **只有** `searchProvider: unified`；
`dsh-base/cordis.patch.yml:469-471` 的 baseline 是 `searchProvider: deepseek-official` + `fetchProvider: http`。
`/proc/587384/environ` 含 `DSH_WEB_FETCH_PROVIDER=http`、`DSH_WEB_STATIC_TOKEN`，**不含** `DSH_UNIFIED_SEARCH_BACKENDS`。

> **并发告警（须读）**：本次审计期间有其它代理在改同一份 `profile/cordis.patch.yml`。进程启动于 18:34:32，而 patch 文件 mtime 为 **23:30:44**（晚于进程启动）；23:35 复核时该文件已变为 `numResults: 8, enableFirecrawl: true, enableTinyfish: true`（无 `resultTelemetry`），`--dump-config` 亦显示 8，但运行态 settings 仍读出 9 —— 这是**重启前快照与磁盘新值不同步**，不是投影 bug。因此本报告所有「运行态」数字均标注为 22:36 快照，不把它当作当前磁盘状态的证据；P2-14 的 `resultTelemetry` 观察已撤回，见 §4 无法验证第 6 条。**[D]**

---

## 1. 逐条裁决表（任务指定 9 条）

| # | 核对项 | 裁决 | 关键证据 | 级别 |
|---|---|---|---|---|
| 1 | **13 个 id 六处登记集合** | **通过（有 1 处设计性子集 + 1 处需澄清）**。脚本实测 5 处为精确 13：`BACKENDS`、`DEFAULT_BASE_URLS`、`DEFAULT_LABELS`、`Config.toggleMap`、`client.js BACKENDS` 副本，`missing=[] extra=[]`；`Config` 的 13 个 `enableXxx` 亦与 `toggleField(id)` 逐字对齐。第 6 处 `DEFAULT_KEY_ENV` 只有 **9** 个 id，缺 `exa/parallel/ddg/searxng`，这是「仅登记需要 key 的后端」的设计（不是漏登记）：`resolveOptions` 用 `DEFAULT_KEY_ENV[id] !== undefined && !OPTIONAL_KEY_IDS.has(id)` 派生 `requiresKey`，四个 keyless id 必须为 `false`。但 `searxng` 的 env 名另有 `Config.searxngApiKeyEnv` 字面默认 `"SEARXNG_API_KEY"` 与 `client.js` 的 `keyEnv: "SEARXNG_API_KEY"`，**三份副本且 `DEFAULT_KEY_ENV` 里没有它**，属单一真源分裂（P3-8）。`OPTIONAL_KEY_IDS={searxng,firecrawl,tinyfish}`、`METERED_IDS={firecrawl,tinyfish}` 与 client 副本 `optionalKey/metered` 标记逐项一致。 | `index.js:58-75,86-97,100-102,105-121,136-152,207-220,334-350`；`client.js:14-33`；`/tmp` 集合 diff 脚本输出 | **A/D** |
| 2 | **`resolveOptions` 派生覆盖 + `resolveApiKey` 闭包** | **部分通过，发现 P1 边界缺陷**。`index.js:369-390` 的 `for (const id of ALL_BACKENDS)` 确实为 13 个 id 派生 `${id}ApiKeyEnv` / `${id}BaseURL` / `${id}Model` 以及 `tavily.searchDepth`，无遗漏。但 `Config` 只声明 10 个 `*BaseURL`、10 个 `*ApiKeyEnv`、3 个 `*Model`；`exa/parallel/ddg` 的三项派生值只能来自 `DEFAULT_*`，且这三个后端**硬编码端点、根本不读 `options.baseURL`**（P2-12）。`resolveApiKey` 闭包逐 id 正确：`credentialRef(keyEnvName)` → `ctx.get("credentials")` → `credentials.resolve(ref)?.value` → 无 credentials service 时 `launchEnvironmentOf(ctx).get(ref)` 兜底。实测 `credentials-local.resolve()` 自身已含 file→env→dotenv 三级兜底，所以插件的 ambient 分支在本机是死代码（P3-9）。**致命边界**：`Config` 的 `z.string().role("credential-ref")` 不校验文法，`settings-api.validateOp` 也只调 `schema(raw.value)`；空串或含 `-` 的名字会被接受，随后 `credentialRef("")` 抛 `TypeError: credential ref "" must match /^[A-Za-z_][A-Za-z0-9_]*$/`，`resolveOptions` 整体抛出 → 每次搜索全崩。 | `index.js:223-244,247-268,271-276,323-390`；`settings-api.js:205-216`；`dsh-credentials/lib/index.js:21-24`；`dsh-credentials-local/lib/index.js:480-497`；真实库复刻 | **A/B/D** |
| 3 | **`current()` / `findPluginRow` 两处共用** | **主体正确，但引入两个 P2 失败态**。`index.js:474-481` 的 `current()` 每次调用都执行 `settings.describe()`（每次搜索/health/history 都读 live 值，已由运行态 `numResults=9` 实证）；`settings-api.js:125-127` 的 `findNamespace` 委托同一个 `findPluginRow`。`namespace.js:19-28` 顺序为 `ns === "dsh-websearch"` → `ns === "unified-search"` → 形状兜底（5 个专属字段中 ≥2 个），消除了 41 号报告的跨 ns 误写；`row.value` 为 `null/undefined` 时 `(row && row.value) ?? config` 正确回落初始 config；`describe()` 抛错由 `try/catch` 回落。但：① **精确 id 命中即返回**，若该行 `value` 缺失，函数不再考虑后面那个有完整 live 值的 shape 候选行 → 静默回退 schema 默认（复刻已证）；② 多 ns 且两个 id 都不存在、却有 ≥2 个 shape 字段的其它插件行时，形状兜底仍会选中第一个（启发式，非严格零误选）；③ `describe()` 失败时静默回落到「初始 schema 默认 config」，无任何诊断，全部 live 设置在本次搜索中丢失。 | `index.js:447-483`；`namespace.js:15-28`；`settings-api.js:94-127,226-232`；`dsh-settings/lib/index.js:413-451`；findrow/sim 复刻 | **A/B/D** |
| 4 | **Config 全部 `.description()` / 6 处英文 / 4 个 `.default(true)`** | **通过**。`Config` 共 **55** 个顶层字段，`.description(` 出现 **55** 次，脚本逐字段核对 `missing: []`。新增 6 处英文 = **4 条 `.description()`**（`firecrawlApiKeyEnv` / `tinyfishApiKeyEnv` / `firecrawlBaseURL` / `tinyfishBaseURL`）+ **2 条 `DEFAULT_LABELS`**（`firecrawl` / `tinyfish`）；与上游既有 39 条中文 description + 11 个中文 label 风格不一致，但这是 50-decisions-executed.md:21,57 明确 **NO-GO** 并登记 Known Limitation 的既定处置（改 49 处会毁补丁重放、gate 零覆盖），属「一致处理 = 有意保留差异 + 已登记」。D-5（34 号）**成立**：`enableExa/enableParallel/enableDdg/enableSearxng` 四个 `z.boolean().default(true)` 被 schemastery 填进 config，`resolveOptions` 的 toggle 分支永远非空，`DSH_UNIFIED_SEARCH_BACKENDS` 分支不可达；**README.md:116 已改为「仅在所有开关被显式关闭时生效（Known Limitation）」**，不再是 34 号报告时的「强制指定」失真措辞。当前运行态进程 env 无该变量，不受影响。 | `index.js:160-283,292,302-316,323-365`；`README.md:116`；`50-decisions-executed.md:21,57`；`34-official-alignment-seam-b.md:110-133`；`/tmp` 描述覆盖脚本 | **A/C/D** |
| 5 | **`writeQueue` 串行化 / revision / 失败重读 / 空白 stagedKey / 脱敏 / readErrors** | **5 项中 4 项通过，1 项半通过，并发现 3 个新缺陷**。`write()` 用 `this.writeQueue.then(run, run)` + `result.then(()=>undefined,()=>undefined)` 重建链，两个并发 `setToggle` 复刻得 `expectedRevision` 依次为 `0` 与 `1`，**确在队列轮到时才读 revision**，且前一次失败不会卡死队列【D】。`setToggle` 失败后 `await this.scope.load()` 重读并 `republish`，且只 `console.warn({conflict})` 不带原始错误【A】。`editKey` 空白串 `stagedKeys.delete(envRef)` + `save()` 的 `doneKeys.push(ref)` 双保险，Save 按钮能排空【A/D】。`safeFailureReason` 只取 `.code` 且用 `/^[a-z][a-z0-9/_-]{0,60}$/i` 白名单，实测含路径/凭据名的 Error 一律变成 `"write rejected"`，**零泄漏**【A/D】。`readErrors` 的 `reason` 只有字面量 `"credential/read-failed"` 一处赋值，经 `safeFailureReason({code:reason})` 落固定码，四个 `readFailed` 锚点完好【A】。**半通过**：`readErrors` 进了 `projection()`（`client.js:340`）却**全文件无任何 UI 渲染**，读失败对用户完全不可见（P2-9）；`safeFailureReason` 过度脱敏，所有凭证写失败都变成同一个 `"write rejected"`，连 `SETTINGS_CONFLICT` 分类也被吞（P2-10）。**新缺陷**：`save()` 晚到编辑产生假绿（P1-3），`setToggle` 失败标志无法清除（P2-8）。 | `client.js:216-279,287-290,324-359,362-424,449-521`；`settings-api.js:174-186`；`tests/lead-20261108-interaction.test.js`；queue/sim/redact 复刻 | **A/D** |
| 6 | **i18n 对称性 / 定义未用 / 用未定义 / locale-owned** | **字典对称通过，locale-owned 不通过**。用「剥离行注释/块注释 + 字符串内逗号哨兵 + 顶层配平」的 tokenizer 复刻：`zh` **54** 键、`en` **54** 键，`zh-only=[]`、`en-only=[]`，完全对称【A/D】；`props.t()`/`t()`/`.bind(NS)("nav")` 共 48 个使用键，`used-undefined=[]`，`keyLabel` 的 `{id}` 插值与 `dsh-client-locale` 的 `template.replace(/\{(\w+)\}/g)` 一致【A/B】。定义未用 6 键：`title, dirty, saved, reset, overridden, togglesTitle`（P3-1）；另有 `nav` 经 `label: () => ctx.locale.bind(NS)("nav")` 使用，不算未用。**新增 UI 文案并非全部 locale-owned**：`client.js:864` 的 `"统一搜索设置位于：设置 → 左侧栏「搜索 / Web Search」"` 是硬编码中文，经 devkit toast 或 `console.info` 直接展示；`client.js:708,712,716` 的三个可见字段名 `numResults/concurrency/backendTimeoutMs` 也是裸字面量（P2-11）。 | `client.js:62-174,522-796,827,864,871`；`dsh-client-locale/lib/client.js:1387-1430`；i18n tokenizer 复刻 | **A/B/D** |
| 7 | **`inject` 5 项最小集 / `connection` 多余 / 硬依赖风险** | **不予通过：与官方不一致，且 `connection` 是多余的硬依赖**。官方 `dsh-client-ui-settings-web-search/lib/client.js:482-488` 为 `["slots","locale","remote","remote.credentials","configForms"]`；本机为 `client.js:809` `["slots","locale","connection","remote","remote.credentials"]` —— 同是 5 项但**集合不同**：多 `connection`、少 `configForms`。`configForms` 缺失是设计选择（改用自建 HTTP bridge），无害；`connection` 只服务于 `connection.api.credentials` 旧线回退（`client.js:407-410,440-444`），而该属性在发布版 0.2.1-rc.2 全库 0 命中【B/E】。Cordis `Fiber._refresh()` 对 inject 中任一取不到实现的 name 置 `epoch=INACTIVE`，**声明即硬依赖**：某 host 不挂 `connection` 服务时整个设置卡片消失；而 `ctx.get("connection")` 本身不抛（返回 traceable 值，未提供则 `undefined`），完全可以不声明【B/D】。反向硬依赖同样存在：`remote.credentials` 若未被 `@deepseek-ai/dsh-api-remotes` 的 credentials 贡献挂载，整卡 park（比 Issue #8 更严重），当前靠 `package.json` 包名级 inject 含 `@deepseek-ai/dsh-api-remotes` 缓解【A/C】。另：两级 inject 机制（`dsh.client.inject` = 包名加载依赖，`exports.inject` = cordis service 依赖）概念分离正确，测试 `lead-20261106.test.js:198-202` 已固化「不要把服务键写进包名级列表」【A】。 | `client.js:809,819-847`；`dsh-client-ui-settings-web-search/lib/client.js:482-488`；`dsh-client-ui-settings-models/lib/client.js:4417-4427`；`cordis/lib/index.js:676,687-689,1320-1326,763-770`；`33-official-alignment-client.md:23-27,60,326`；`33-official-alignment-client-b.md:20,42-44` | **A/B/C/D** |
| 8 | **`cordis.patch.yml` 丢 `fetchProvider` / patch 顺序** | **确认仍丢，env pin 缓解属实但脆弱，且 README 在复现同一问题**。`cordis.patch.yml:10-13` 的 `- id: web` 是 Cordis patch 的**整表替换**（`dsh-app-boot/lib/index.js:73-110`：`for (const [key,value] of Object.entries(overrides)) target[key] = value`），因此 `config` 被整体换成 `{searchProvider: unified}`；`--dump-config:548-551` 实测只剩这一项，`dsh-base/cordis.patch.yml:469-471` 的 `fetchProvider: http` 被丢弃【A/B/D】。`WebRuntime` 构造读 `process.env.DSH_WEB_FETCH_PROVIDER`，本机 `/proc/587384/environ` 确有 `=http`，故 `fetch()` 的 `configuredId` 仍为 `http`【B/D】。**但缓解是外置于插件的进程 env**：`WebRuntime.fetch()` 在「无 configured id + 恰好一个可用 fetch provider」时也能选中 `web-fetch-http`，所以当前看似无事；一旦再注册第二个 fetch provider，同一份 patch 立刻升级为 `WEB_PROVIDER_AMBIGUOUS`。**patch 顺序正确**：`dsh-app-boot` 注释 `:490-496,1112` 明确 bundle patches 先于 profile patch，本机 profile patch 也没有重复 `- id: web`；但 `README.md:61-69` 的安装示例仍教用户手写 `- id: web`（只带 `searchProvider: unified`，不带 `fetchProvider`），会二次复现同一丢失【A/B/D】。 | `cordis.patch.yml:7-13`；`README.md:59-69`；`dsh-app-boot/lib/index.js:73-110,490-496,1112`；`dsh-base/cordis.patch.yml:467-471`；`dsh-web/lib/index.js:59-60,100,115`；`--dump-config` 实测 | **A/B/D** |
| 9 | **新发现优先** | **发现 3 个 P1、多个 P2/P3**，详见 §2。核心是：`*ApiKeyEnv` 空串/非法名可经 settings bridge 写入并让 `credentialRef` 抛错（P1-1）；三处 `webServer.register()` 丢弃 disposer 且未挂 `ctx.effect`（P1-2）；`save()` 晚到编辑产生「已保存 ✓」假绿且字段未写（P1-3）。另有 disposer 引用不匹配、订阅泄漏、失败标志不可清除、脱敏过度、readErrors 死状态、i18n 硬编码、patch/README 文档漂移、package.json 元数据陈旧等。 | 见 §2 各条 | **A/B/D** |

---

## 2. 缺陷清单（P0 / P1 / P2 / P3）

### P0

**无。** 运行态认证 GET 全部 200，`settings/health/history` 三路由正常，`enabled:6`、13 个 backend 齐全；未发现认证边界越权、凭据泄漏或服务不可用级别的缺陷。**[D]**

### P1（3 项）

**P1-1 · `credential-ref` 字段无文法校验，空串/非法名可写入并让每次搜索崩溃**
`Config` 的 10 个 `*ApiKeyEnv` 都是 `z.string().role("credential-ref").default(...)`，无 `.min(1)`、无正则；`settings-api.validateOp` 的"形状检查"只是 `schema(raw.value)`，`z.string()` 接受 `""` 与 `"MY-KEY"`【A】。真实 `credentialRef("")` 抛 `TypeError: credential ref "" must match /^[A-Za-z_][A-Za-z0-9_]*$/`，`credentialRef("A-B")` 同样抛【B/D】。`resolveOptions` 的 `config?.[\`${id}ApiKeyEnv\`] ?? DEFAULT_KEY_ENV[id]` 对空串用 `??`（非 `||`），空串不会被默认名兜住，于是 `credentialRef("")` 在**每次** `resolveOptions()` 调用（每次搜索、`available()`、health、history.record）抛出 → 整个 provider 失效且无用户可见诊断【A/D】。触发路径：POST `/api/unified-search/settings` body `{"ops":[{"op":"set","path":["braveApiKeyEnv"],"value":""}]}` 会被 200 接受；或 profile patch 直接写 `braveApiKeyEnv: ""`。`scope.unset()` 走 `mutate` 会恢复 schema default，所以 UI 的「清空」不等于空串，但 bridge 与 patch 都能制造它。**建议**：`Config` 对这些字段改用 `z.string().regex(...)` 或在 `resolveOptions` 用 `isCredentialRefName()` 预检后回落到 `DEFAULT_KEY_ENV[id]`。**[A/B/D]**

**P1-2 · 三处 `webServer.register()` 丢弃 disposer，且 `ctx.inject(["webServer"])` 内未挂 `ctx.effect`**
`health.js:88`、`history.js:141,157`、`settings-api.js:49` 都调用 `ws.register(...)` 却完全忽略返回值；`dsh-host-webserver/lib/index.js:326-333` 明确 `@returns the disposer removing the route`，且重复 `(kind,path)` 会抛 `webserver: duplicate exact route`【A/B】。`index.js:523-552` 的 `ctx.inject(["webServer"], (webCtx) => {...})` 里三个 `registerXxxRoutes()` 都是普通函数调用，没有 `webCtx.effect(() => ...)`；官方同类插件（`dsh-client-hmr/lib/index.js:141-164`、`dsh-client-connection/lib/index.js:1063`、deepseek-account-platform:991）一律把 `register` 包进 `ctx.effect` 并在 disposer 里 `disposeRoute()`【B】。后果：插件 fiber 卸载 / HMR 重载 / 动态禁用后，四条 exact 路由仍留在 `webServer.exact` Map 中，闭包继续持有已失效的 `settingsForms`、`historyStore`、`current()`；重新加载时 `register` 直接抛 duplicate，插件再也起不来；陈旧路由仍以 structural fence + 陈旧对象继续应答。**[A/B]** 另注：`ctx.web.registerSearchProvider(provider)` 的 disposer 由 `WebRuntime` 用 `this.ctx.effect(...)` 注册到 **web service 自己的 fiber**（`dsh-web/lib/index.js:84-88`），不是插件 fiber —— 与官方 `web-search-deepseek/lib/index.js:331` 同写法，但对可动态装卸的第三方 bundle 意味着卸载插件不注销 provider（P3-14）【B】。

**P1-3 · `save()` 期间晚到的编辑既不被写入、又触发「已保存 ✓」假绿**
`save()` 在 `this.saving=true` 后顺序 `await` 遍历 `this.staged`（字段循环）与 `this.stagedKeys`（密钥循环），最后 `if (!this.failed && (doneFields.length>0 || doneKeys.length>0)) this.savedAt = Date.now()`【A】。忠实复刻证明：在密钥循环 `await` 期间调用 `edit("concurrency","8")`，该字段**不会**被写（字段循环已结束）、仍留在 `staged`，但 `savedAt` 被置位；`UnifiedSearchSection` 的渲染条件是 `!state.failed && !state.saving && state.savedAt > 0` → 显示 `savedOk`（"已保存 ✓"），同时 `state.stagedCount > 0` 又显示 `unsavedHint`（"有未保存的修改"）并启用 Save 按钮 —— 同一屏自相矛盾，且 `edit()` 里 `this.savedAt = 0` 被循环后的赋值覆盖【A/D】。相关时序：`reset(field)` / `discard()` 在飞行中的 save 期间执行也不会取消已发出的写，用户的「放弃修改」被静默推翻；`for (const [field, staged] of this.staged)` 迭代的是 live Map，字段循环期间新增的条目**会**被意外写入（Map 迭代器非快照）【A/D】。**建议**：`save()` 开始时先快照 `const fields=[...this.staged]`，并在末尾仅当 `this.staged.size===0 && this.stagedKeys.size===0` 时置 `savedAt`。**[A/D]**

### P2（13 项）

**P2-4 · `connection` 是多余的 service 硬依赖**：见 §1 第 7 条。官方两个同类插件 inject 均 0 命中 `"connection"`；`ctx.get("connection")` 不抛；声明它使「host 未挂 connection → 整卡 park」成为真实风险面。**[A/B/C/E]**

**P2-5 · `package.json` 包名级 inject 含不存在的 `@deepseek-ai/dsh-client-runtime`**：`package.json:61` 列了 5 个包名，其中 `@deepseek-ai/dsh-client-runtime` 在本机 `/usr/local/lib/node_modules/@deepseek-ai/dsh/` 全树、profile `node_modules`、所有官方包 `package.json` 中均查无此包【A/B/D】。`dsh-client-modules/lib/client.js:789-792` 对 `row.inject` 里的每个包名做 `graphRows.get(packageName)`，取不到就 `continue` 静默跳过 —— 所以今天不报错、不阻塞，但这是一条永远无效的 manifest 声明（历史遗留或拼写错误），并让「包名级依赖清单」不再可信。**[A/B/E]**

**P2-6 · 三处 disposer 引用不匹配 / 泄漏**：`client.js:877` 注册的是匿名箭头 `(ev) => { onOpenSettings(ev); ...ack... }`，而 `:883` 的 `ctx.effect(() => () => window.removeEventListener("dsh-websearch:open-settings", onOpenSettings))` 移除的是**另一个函数引用** → `removeEventListener` 空操作，监听器在插件卸载后仍常驻并继续派发 ack 事件【A】。`window.__dshWebsearchSettingsReady = true` 从不复位【A】。`client.js:178-184` 在模块求值期注入 `<style data-plugin-css="dsh-websearch/card">`，**无任何 disposer**（`querySelector` 只防重复，不卸载）【A】。三者都违反 AGENTS.md「Registrations are effects」。【A】

**P2-7 · `scope.subscribe` 的 unsubscribe 被丢弃**：`client.js:310` `this.scope.subscribe(() => this.republish())` 忽略 `createStore` 返回的 `() => listeners.delete(l)`；controller 没有 `dispose()`。走 legacy `settingsScope` 时 scope 是宿主共享对象，插件重载后旧 controller 的 listener 永久留在 `listeners` Set 里，持有已废弃的 store 并持续 `republish()`【A/D】。官方 `ui-settings-web-search/lib/client.js:504-506` 用 `ctx.effect(() => () => card.dispose())` 显式清理【B】。

**P2-8 · `setToggle` 失败后 `failed` / `conflict` 永远无法清除**：`client.js:362-380` 失败分支只置 `this.failed=true`、`this.conflict=...`，成功分支不清零；唯一清零点是 `save()` 的 `this.failed=false; this.conflict=false`（`:455`）【A】。而 Save 按钮 `disabled` 条件含 `state.stagedCount === 0`（`:788`），失败 toggle 不产生任何 staged 项 → 用户**没有任何可点按钮**能触发 `save()` 来清掉红色 "保存失败" / 黄色 "设置已在其他端被修改，请重试" 横幅，只能刷新页面【A/D】。复刻 Scenario C 确认 `failed` 保持 `true`【D】。

**P2-9 · `readErrors` 是死状态，凭证读失败对用户不可见**：`projection()` 把 `readErrors` 导出（`:340`），但全文件 `readErrors` 只出现在 306/340/414/421 四处状态维护，**UI 无任何渲染**【A】。`readCredential` 失败时既不写 `keyState`，也不给出错误面，`KeyedBackendCard` 的 `configured = !!state.keyState[b.keyEnv]?.configured` 仍为 `false` → 徽章显示 `keyUnset`（"未配置"），把「读取失败」伪装成「没配钥匙」【A】。33 号报告要求修的「configured badge dark」问题只修了一半（不吞 `{ok:false}` 包络），可观测性目标未达成【C】。零泄漏与四个 `readFailed` 锚点本身是完好的【A/D】。

**P2-10 · `safeFailureReason` 过度脱敏，把自身固定码也一起吞掉**：`writeCredential` 三处失败都 `throw new Error(res.error?.message ?? "credential write rejected")` / `new Error("credentials service unavailable")`，抛出的是普通 `Error`，**没有 `.code` 属性**【A】。`safeFailureReason(err)` 只认 `err.code`，实测 6 组输入中 4 组（含 `new Error("SETTINGS_CONFLICT")`）一律返回 `"write rejected"`，只有显式带 `.code` 的对象才保留码【D】。结果 `failedKeys` 的 `reason` 全部相同，UI 渲染 `keyFailed + ": write rejected"`，用户无法区分冲突/被拒/服务不可用；`save()` 里 `this.conflict = String(err).includes("SETTINGS_CONFLICT")` 也因外层 catch 吞掉而形同虚设。零泄漏达标，可诊断性归零【A/D】。

**P2-11 · 新增 UI 文案并非全部 locale-owned**：`client.js:864` 硬编码中文 `"统一搜索设置位于：设置 → 左侧栏「搜索 / Web Search」"`，经 `window.__dshDevkit.toast()` 或 `console.info` 直接面向用户，未过 `props.t()`/字典【A】。`client.js:708,712,716` 的 `numResults` / `concurrency` / `backendTimeoutMs` 作为 `<span className="wsc-label">` 的可见文本，也是裸 camelCase 字面量，而同页其它 47 处文案都走字典【A/D】。违反 AGENTS.md「Client UI copy is locale-owned」与 `verify-client-ui-i18n` 的规则意图【A】。

**P2-12 · `exa/parallel/ddg` 的 `DEFAULT_BASE_URLS` 与 provider baseURL trust gate 双双落空**：`index.js:106-108` 为这三者登记了默认端点，`resolveOptions:375` 也把它们派生进 `backends[id].baseURL`；但 `exa.js:13,54,64`、`parallel.js:20,42,51`、`ddg.js:14,35,39` 全部硬编码 `EXA_ENDPOINT` / `PARALLEL_ENDPOINT` / `DDG_ENDPOINT`，`search()` 从不读 `options.baseURL`【A】。于是 `provider.js:325-336` 的 baseURL 信任门（https 校验 / RFC1918 私网例外 / 拒绝 URL 内嵌凭据）对这三项**检查的是一个后端根本不消费的值**，门形同虚设；`settings-api.validateOp` 也不允许为它们写 `*BaseURL`（`Config` 无对应字段）。31-b 报告已指出 firecrawl/tinyfish 曾经同类，但这两个后来改成读 `options.baseURL`（`firecrawl.js:58-59`、`tinyfish.js:55-56`），**exa/parallel/ddg 三类仍未被修**【A】。

**P2-13 · `findPluginRow` 精确 id 优先引入新的静默回退态；`current()` 失败无诊断**：见 §1 第 3 条。复刻：`[{ns:'dsh-websearch'},{ns:'other',value:{searxngBaseURL:'x',enableFirecrawl:true,enableTinyfish:true}}]` → 返回空行，`current()` 回落到 schema 默认【A/D】。`describe()` 抛错时 `catch { return config; }` 无日志、无遥测，一次瞬时失败就让用户的所有 live 配置在本次搜索中静默失效【A】。形状兜底 `>=2` 仍是启发式，两个 ns 都含 ≥2 个专属字段时会选中第一个【A/D】。

**P2-14 · `enabledBackends` 无效 id 静默回退，违反 fail-loud**：`Config.enabledBackends` 是 `z.array(z.string())` 无元素校验；`resolveOptions:329-331` 用 `.filter(id => ALL_BACKENDS.includes(id))`，全无效则结果空数组 → 继续落到 toggles → env → `DEFAULT_ENABLED`，用户完全不知道自己写的列表被丢弃【A/D】。AGENTS.md 要求「Misconfiguration fails loud … never silently skip a missing referent」【A】。运行态 `enabledBackends: []` 与 `DEFAULT_ENABLED` 四项的优先级链认证实测一致（`enabled:6` = 4 默认 + 2 用户开启的 metered），这部分无误【A/D】。**[A/D]**

**P2-15 · `settings-api.sanitize` 回显原始 `err.message`，与自身注释冲突**：`settings-api.js:264-267` 注释写 "Fixed-shape diagnostics only: never echo header text or raw error details"，实现却是 `String(err && err.message ? err.message : err).replace(...).slice(0,160)`；`guarded` 的 catch（`:88`）与 `write` 的 mutate 失败（`:182`）都把它放进 HTTP body【A】。`tests/settings-api.test.js` 的 "non-conflict mutate error -> 400" 断言 `r.payload.error` 匹配 `/disk full/`，**测试固化了这一回显**【A】。客户端 `writeNow` 抛 `new Error(String(payload.error))` 后经 `safeFailureReason` 脱敏，所以 UI 零泄漏；但认证同源的 HTTP 响应本身仍可能带出内部路径/文件名，属于 fence 内的信息面扩大【A/D】。

**P2-16 · `README.md` 安装示例复现 `- id: web` 丢 `fetchProvider`，且 package.json/README 元数据仍写 11 后端**：`README.md:59-69` 教用户手写 `- id: web` + `config: {searchProvider: unified}`，与 bundle 自动 patch 重复、并二次丢掉 `fetchProvider`（见 §1 第 8 条）【A/B/D】。`package.json:4` 与 `README.md:6,12,99,131` 共 5 处仍称 "11 backends / eleven / 十一后端 / 11 个后端开关 / 11 后端扇出"，而实际 13 个（25-execution-log:182 只修了设置面板 `description` 的硬编码数字，未同步包元数据与 README 正文）【A】。`README.md:99` 的开关清单也只列 11 个，漏 `enableFirecrawl` / `enableTinyfish`【A】。

### P3（14 项，简明）

| 编号 | 缺陷 | 证据 | 级别 |
|---|---|---|---|
| P3-1 | i18n 6 个定义未用键 `title, dirty, saved, reset, overridden, togglesTitle`（其中 `togglesTitle` 与渲染用的 `groupFree/groupKeyed` 语义重复） | `client.js:62-174`；i18n tokenizer | A/D |
| P3-2 | `credentialRef(undefined)` 对 `exa/parallel/ddg/searxng` 被调用：`isCredentialRefName(undefined)` 因正则把 `undefined` 强转为字符串 `"undefined"` 而返回 `true`，`brandString` 是恒等函数 → `ref === undefined`。`credentials.resolve(undefined)` 在 credentials-local 上不崩但属跨越契约的脏值 | `dsh-credentials/lib/index.js:13-24,34-36`；`dsh-brand/lib/index.js:20-22`；`index.js:370-371`；真实库复刻 | A/B/D |
| P3-3 | `FIELD_LABELS` 只给 6/55 个字段挂 `meta.label` + 顶层 `.label`；而 0.2.0 表单渲染读的是 `meta.description`，`meta.label` 是否生效源码注释自己标为 V5 视觉待办。另 49 个字段无 label，处理不对称 | `index.js:294-316`；`dsh-settings/lib/index.js:413-451`；schemastery 复刻 | A/B |
| P3-4 | `GLOBAL_FIELDS` 客户端只校验 `[lo,hi]` 与 `Number.isFinite`，不校验 `step(1)`；`8.5` 通过 UI 校验后送到 host 被 `z.number().step(1)` 拒绝 → 400 → `save()` 外层 catch 只置 `failed=true`，`failedFields` 为空，用户看不到是哪个字段错了，且 `staged` 全量残留 | `client.js:475-491,515-518`；`index.js:162-167`；`settings-api.js:205-216` | A/D |
| P3-5 | `refreshAllCredentials()` 对 10 个 ref 逐个 `describe([ref])`，10 次往返；官方 `ui-settings-models/lib/client.js:1383` 按 64 分批一次调用 | `client.js:382-411,449-451`；`dsh-client-ui-settings-models/lib/client.js:1383` | A/B |
| P3-6 | `searxng` 的 env 名 `"SEARXNG_API_KEY"` 有 3 份独立字面量（`Config.searxngApiKeyEnv:237`、`client.js:18`、`README.md:112`），`DEFAULT_KEY_ENV` 中反而缺登记 → 单一真源分裂，未来改名字至少漏 3 处 | `index.js:86-97,237`；`client.js:18`；`README.md:112`；集合脚本 | A/D |
| P3-7 | `client.js` 的 13 个 `label` 是第 7 套标签，与 `DEFAULT_LABELS` 措辞不一致（如 `"Exa (MCP, 免费)"` vs `"Exa (MCP, 免费无 Key)"`），属独立副本漂移面 | `index.js:136-152`；`client.js:14-33` | A |
| P3-8 | `health.js` 的 `lastError` 只截断 120 字符 + 3 条密钥正则；实测 exa 的 429 响应原文 `{"jsonrpc":"2.0","error":...}` 被原样带出（截断到 `"You'"`）。`registerHealthRoute` 的 `send()` 也不像 `settings-api` 那样设 `cache-control: no-store` | `health.js:12-32,86-111`；认证 GET 实测 | A/D |
| P3-9 | `resolveApiKey` 的 `launchEnvironmentOf(ctx).get(ref)` ambient 兜底在本机 0.2.x 是死代码：`ctx.get("credentials")` 恒返回服务，而 `credentials-local.resolve()` 自身已含 `file→env→dotenv` 三级兜底。两套兜底重复且注释未说明 | `index.js:383-388`；`dsh-credentials-local/lib/index.js:480-497`；`dsh-launch-environment/lib/index.js:63-68` | A/B |
| P3-10 | `Config` 的 5 个布尔开关 `cacheEnabled/breakerEnabled/historyEnabled/multiQueryEnabled/deepCoverage` 及 4 个 `*KeyEnv`、`*BaseURL`、`*Model`、`cacheTtl/breaker*/*History` 共 30+ 字段在 `UnifiedSearchSection` 完全没有 UI 控件；README:83-114 却称「全部字段扁平化、开箱可编辑」（0.2.0 自动表单另算，但本卡是插件自有 UI） | `client.js:622-796`；`README.md:79` | A |
| P3-11 | `createStore.set()` 不做相等性检查，每次 `republish()`（包括 `readCredential` 的 10 个并发 finally）都无条件触发全部 listener → 无谓重渲染 | `client.js:188-196,348,422` | A/D |
| P3-12 | `SettingsRoutesBridge.load()` 对 `response.status === 404` 特判成只读，但该 exact 路由的服务端只会返回 200/400/403/405/409/503，从不返回 404；404 只可能来自路由冲突/代理错配，此时 `accept(undefined)` 把「路径被别的 handler 占了」误报成「配置被宿主锁定」（`readOnlyScope`） | `client.js:243-250`；`settings-api.js:53-69`；`trust.js:82-120` | A/D |
| P3-13 | `save()` 的外层 `catch` 包围整个字段+密钥双循环：任意一个 `scope.set/unset` 失败会中止后续所有字段与密钥的写入，但 `doneFields/doneKeys` 已被局部填充，末尾的 `this.staged.delete(f)` 在 catch 路径**不执行** → 已成功写入的字段仍留在 staged，下次 Save 会重复写 | `client.js:459-518` | A/D |
| P3-14 | `ctx.web.registerSearchProvider(provider)` 返回的 disposer 被丢弃，且该注册由 `WebRuntime` 用 **web service 自己的 ctx** 挂 effect（`dsh-web/lib/index.js:84-88`），不在插件 fiber 上 → 插件卸载不注销 provider。官方 `web-search-deepseek` 同写法，属上游模式，但对可动态装卸的第三方 bundle 更危险 | `index.js:516`；`dsh-web/lib/index.js:69-89`；`dsh-web-search-deepseek/lib/index.js:330-339` | A/B |

---

## 3. 已确认无误

| # | 结论 | 证据 | 级别 |
|---|---|---|---|
| 1 | 六处登记中 5 处精确 13 个 id，零 set diff；`DEFAULT_KEY_ENV` 的 9 项是设计性子集而非漏登记；13 个 `enableXxx` 与 `toggleField(id)` 逐字对齐 | 集合 diff 脚本；`index.js:58-75,105-121,207-220,334-350`；`client.js:14-33,630` | A/D |
| 2 | `DEFAULT_ENABLED` 恰为 4 个 keyless、不含 firecrawl/tinyfish；`OPTIONAL_KEY_IDS`/`METERED_IDS` 与 client 副本的 `optionalKey`/`metered` 标记完全一致 | `index.js:83,100-102`；`client.js:31-32,46-49` | A/D |
| 3 | `Config` **55/55** 字段都有 `.description()`；`Config.meta.volatile` 直接赋值 idiom 在真实 schemastery 3.18.5 上幂等生效（复刻：`{default:{},volatile:true}`）；`FIELD_LABELS` 的 `sch.meta`/`sch.label` 确实改到 `Config.dict[key]` 同一对象 | `index.js:160-316`；`/tmp` schema/meta 复刻 | A/D |
| 4 | 4 条新增英文 `.description()` + 2 条英文 label = 6 处，其余保持上游中文，NO-GO 与 Known Limitation 已在 50-decisions-executed.md 登记；D-5 的 README 措辞已由「强制指定」改为 Known Limitation | `index.js:150-151,242-244,266-268`；`README.md:116`；`50-decisions-executed.md:21,57`；`34-*.md:110-133` | A/C |
| 5 | `writeQueue` 确实串行：复刻两个并发写得到 `expectedRevision=0` 与 `=1`，revision 在 `writeNow` 内（队列轮到时）才读；前一次写失败不会卡住队列（`.then(run,run)` + `.then(()=>undefined,()=>undefined)`） | `client.js:219,253-275`；queue/qfail 复刻 | A/D |
| 6 | 空白 `stagedKey` 真排空：`editKey` 的 `trim()==="" → delete` 与 `save()` 的 `doneKeys.push(ref)` 双保险；`safeFailureReason` 实测对含路径/凭据名的 Error 一律输出固定串，零泄漏；`readErrors` 只存 `credential/read-failed` 固定码，4 个 `readFailed` 锚点完好 | `client.js:287-290,352-359,493-513,382-424`；redact/readerr 复刻；`tests/lead-20261108-interaction.test.js` | A/D |
| 7 | `setToggle` 失败后确实 `await scope.load()` 重读并 `republish()`，且 `console.warn` 只带 `{conflict}` 不带原始错误 | `client.js:362-380` | A |
| 8 | zh/en 字典 **54/54 完全对称**，`zh-only=[]`、`en-only=[]`；48 个 `t()`/`props.t()`/`.bind(NS)()` 使用键全部有定义，`keyLabel` 的 `{id}` 插值与 `dsh-client-locale` 的 `template.replace(/\{(\w+)\}/g)` 一致 | i18n tokenizer 复刻；`client.js:62-174,772`；`dsh-client-locale/lib/client.js:1414-1430` | A/B/D |
| 9 | `projection()` 的 `stagedKeys` 是 `Object.fromEntries([...])`、`failedKeys`/`readErrors` 都是 `[{ref,reason}]`、`stagedText` 闭包、`version` 字符串；`KeyedBackendCard`/optional 区用 `.find(f => f.ref === b.keyEnv)` 而非 `.includes()` —— 旧缺陷已修 | `client.js:324-346,568-603,766-785` | A |
| 10 | `buildHealthReport` 的 keyless 派生 `beOpts.requiresKey !== true` 与 `resolveOptions` 的 `requiresKey`、client 的 `KEYLESS/KEYED` 分组三者一致；13 个 backend 全部由 `Object.keys(backends)` 输出；`enabledSet` 过滤未知 id | `health.js:45-80`；`index.js:378-382`；认证 GET 实测 `enabled:6` + 13 项 | A/D |
| 11 | `findPluginRow` 两处共用（index.js / settings-api.js），精确 id `dsh-websearch` 优先于 legacy `unified-search` 再优先于形状；运行态实测 `namespace:"dsh-websearch"` 且与 41 号 P0「跨 ns 误写」的裁决一致 | `namespace.js:19-28`；`index.js:476`；`settings-api.js:126`；认证 GET；`49-restart-evidence.md:24` | A/C/D |
| 12 | `current()` 每次调用都真的执行 `settings.describe()`（非缓存），profile patch 的 `numResults=9` 与 `enableFirecrawl/Tinyfish=true` 已进入 live 执行面（health `enabled:6`） | `index.js:474-481`；认证 GET；`--dump-config` | A/D |
| 13 | `cordis.patch.yml` 的 `- id: web` 丢 `fetchProvider` 由 `DSH_WEB_FETCH_PROVIDER=http` env pin 缓解属实；**patch 顺序正确**（bundle patches 先于 profile patch，profile 未重复 `- id: web`） | `--dump-config:548-551`；`/proc/587384/environ`；`dsh-app-boot/lib/index.js:490-496,1112` | A/B/D |
| 14 | 两级 inject 概念分离正确（`dsh.client.inject` = 包名加载依赖，`exports.inject` = cordis service 依赖），`remote.credentials` 未被误加进包名级列表 | `package.json:59-68`；`client.js:809`；`dsh-client-modules/lib/client.js:61-75,789-792`；`tests/lead-20261106.test.js:198-202` | A/B |
| 15 | `settings-api.js` 的 op 校验覆盖非法 op / 路径长度 / `__proto__` / 缺 value / 类型不符，`MAX_OPS=64`、`MAX_BODY_BYTES=64KiB`、`expectedRevision` 非整数不转发、409 映射 `SETTINGS_CONFLICT`；`trust.js` 的 `rejectionFor` 双路径（connection.admit / requestRejection）+ structural fence 与认证实测（无 cookie → `untrusted request`，有 cookie → 200）一致 | `settings-api.js:38-40,129-217,219-224`；`trust.js:82-120,127-154`；`tests/settings-api.test.js`；认证 GET/无 cookie GET | A/D |
| 16 | 认证只读探测全程未改运行时状态：只发 GET（`/connect` 换 cookie、settings、health、history）与 `--dump-config`；未 POST settings/history/clear，未写任何 profile 文件 | 命令记录 | D |

---

## 4. 无法验证

| # | 缺口 | 原因 | 级别 |
|---|---|---|---|
| 1 | `remote.credentials` 服务在本机 **client 实时反射**下的挂载状态 | `cordis_inspect_query(client, Service/Slots)` 无已连接 Harness 页；`host Config.listConfigs` 带 `input` 的精确查询被判 `"input" must be an object`（02-runtime-state.md:345 同缺陷），只能列目录。证据来自 `--dump-config`、`38-e2e-save-probe.md:52`、Host `dsh-api-settings-controller` 源码 | E |
| 2 | `@deepseek-ai/dsh-client-runtime` 是否在**其它 DSH 版本/profile** 下以 graph-row 别名存在 | 本机 0.2.1-rc.2 安装全树 + profile `node_modules` + 全部官方包 `package.json` 均无此包；`dsh-client-modules` 对取不到的包名静默 `continue`，因此无法从「不报错」反推它有效 | A/B/E |
| 3 | 卸载 `@deepseek-ai/dsh-api-remotes` 的 credentials 贡献后「整卡 park」的破坏性实测 | 只读任务不允许改 profile / 运行时；33/33-b 已标为潜在组合风险而非当前故障 | C/E |
| 4 | 插件 HMR 重载后 `webserver: duplicate exact route` 的真实抛错与陈旧路由应答 | 需要触发重载/卸载（会改运行时状态）；结论由 `register` 返回 disposer + 官方 `ctx.effect` 对照 + 本插件三处皆丢弃 disposer 推出 | A/B/E |
| 5 | 把 `braveApiKeyEnv: ""` 真正写入运行态后 `credentialRef` 抛错波及 `web_search` 工具调用的完整堆栈 | 真实发布版 `dsh-credentials` 复刻已证 `TypeError`，settings bridge 的 POST 与 `resolveOptions` 的调用链已逐行确认；但按只读约束未发 POST 写 | A/B/D/E |
| 6 | `resultTelemetry` 是否曾被 profile patch 写入并丢失 | 22:36 快照时磁盘 patch 含 `resultTelemetry: false, numResults: 9` 而 live `value.resultTelemetry===true`；但 23:35 复核发现另一代理已在 23:30:44 改写了该文件（现为 `numResults: 8`，无 `resultTelemetry`），`--dump-config` 与 live 的 9/8 差异属**进程启动 18:34 后 patch 被外部改写、未重启**的不同步。无法在只读约束下重建 22:36 时刻的精确 patch 内容，故撤回该观察，不列为缺陷 | A/D/E |
| 7 | `meta.label` 是否被 0.2.0 SettingsForms 渲染（源码注释自称 V5 视觉待办） | 无浏览器 DOM/截图上下文；本机只能确认 `meta.description` 是渲染器读取的字段 | A/B/E |
| 8 | `DSH_UNIFIED_SEARCH_BACKENDS=firecrawl` 启动后 health 的 `enabled` 实测 | 需重启 `dsh web`（34-b:133 亦标「需重启，须批准，本次未执行」）；D-5 的结论由 node 四组推演与 schema 默认行为支撑 | C/D/E |
| 9 | DSH 0.2.2-rc.1 `describe()` 改用 `entry.fiber.effectiveConfig` 后 `findPluginRow` 的行形状是否仍兼容 | 33-b:30 判定「不影响 describe()/mutate() 签名与返回数组形状」，但本机是 0.2.1-rc.2，未升级验证 | C/E |
| 10 | `connection.api.credentials` 旧线在 DSH ≤0.1.6 是否真的存在 | 33:27 实测发布版 0.2.1-rc.2 全库 0 命中，标为「旧线兼容猜测」；无旧版安装可查 | C/E |

---

## 5. 五条反直觉发现

**① 六处集合零 diff，但「集合同步」与「配置生效」是两件事，而且这次是反过来的一层。**
脚本实测 5 处登记 13 个 id 完全一致，`resolveOptions` 也为全部 13 个 id 派生了 `${id}BaseURL`。可是 `exa/parallel/ddg` 三个后端把端点硬编码在 `EXA_ENDPOINT`/`PARALLEL_ENDPOINT`/`DDG_ENDPOINT`，`search()` 从不读 `options.baseURL`：`DEFAULT_BASE_URLS` 的这三个值、`Config` 里不存在对应的 `*BaseURL` 字段、`provider.js` 那段 baseURL 信任门（拒 http、拒 URL 内嵌凭据、RFC1918 例外）对它们**检查的是一个永不被消费的值**。31-b 报告已发现 firecrawl/tinyfish 曾经同类并修好，但没人回头看这三个「更早、更基础」的 keyless 后端。**集合审计通过 ≠ 配置闭环打通，甚至 ≠ 安全门有效。**【A/D】

**② 并发修复做对了，却在 UI 层造出了「同时显示未保存 + 已保存 ✓」的假绿。**
`writeQueue` 串行化与「轮到才读 revision」都经复刻验证正确（`expectedRevision` 依次 0→1），前次失败也不卡队列。但 `save()` 串行 `await` 的是两个 **live Map 迭代**：字段循环期间新增的条目会被 Map 迭代器意外写入，密钥循环期间新增的条目则**完全不写**；而 `savedAt = Date.now()` 无条件放在双循环之后，把 `edit()` 刚设的 `savedAt=0` 覆盖掉。于是晚到一次编辑，界面同时渲染 `unsavedHint`（stagedCount>0）与 `savedOk`（savedAt>0），且那个字段其实没写进 host。**串行化 HTTP 写，不等于串行化用户意图。**【A/D】

**③ 零泄漏做到了，代价是把插件自己定义的固定码也一起脱敏掉了。**
`safeFailureReason` 的白名单只认 `err.code`，实测含内部路径与凭据名的 Error 全部变成 `"write rejected"`，确实零泄漏。但 `writeCredential` 的三处失败路径抛的都是普通 `new Error(res.error?.message)`——**没有 `.code`**——于是所有凭证写失败（含 `SETTINGS_CONFLICT`、`credentials service unavailable`）在 UI 上都是同一个 `"保存该 Key 失败: write rejected"`。`readErrors` 那侧反而保留了 `credential/read-failed` 固定码，可惜它投影进 state 后**全文件没有任何渲染**：读失败被伪装成「未配置」徽章，写失败被压成一句无信息量的通用串。脱敏与可诊断性在这里直接对冲，而「修好的」那半边恰好是用户看不见的那半边。【A/D】

**④ 抽公共 `findPluginRow` 消除了跨 ns 误写，却在同一条 `??` 上引入一个新的静默回退态。**
`namespace.js:22-24` 的 `byId = candidates.find(ns==='dsh-websearch') ?? candidates.find(ns==='unified-search'); if (byId) return byId;` 让「精确 id 命中」变成短路：复刻 `[{ns:'dsh-websearch'},{ns:'other',value:{…3 个专属字段…}}]` 时，函数返回那个 `value` 缺失的空行，`current()` 的 `(row && row.value) ?? config` 于是回落到**初始 schema 默认 config**，后面那个有完整 live 值的候选连看都不看。41 号 P0 修的是「形状优先误选别人的行」，新代码修好了它，但把「精确行不完整」变成了「全部 live 设置静默失效且无日志」。`try/catch` 对 `describe()` 抛错同样静默回落，一次瞬时失败就让用户配置在本次搜索中蒸发。【A/D】

**⑤ `- id: web` 丢 `fetchProvider` 之所以"现在没事"，不是因为 env pin 兜住了，而是被 selection rule 意外兜住了。**
本机 `--dump-config` 实测该行 `config` 只剩 `searchProvider: unified`（整表替换），`dsh-base` 的 `fetchProvider: http` 确实丢了；缓解被写成「drop-in env pin」，`/proc/587384/environ` 也确有 `DSH_WEB_FETCH_PROVIDER=http`。但读 `WebRuntime.fetch()`（`:115`）会发现：即便 env 也没有，`configuredId` 为 `undefined` 时仍走「未配置 id + 恰好一个已注册可用 provider → 选它」，`web-fetch-http` 是唯一一个 fetch provider，所以配置丢失**根本没被观测到**。这意味着缓解是双重的、且第二重与 env 无关：一旦部署再注册第二个 fetch provider，同一份 patch 立刻从「无感」变成 `WEB_PROVIDER_AMBIGUOUS`。更反直觉的是 `README.md:61-69` 的安装示例还在教用户手写一次 `- id: web`（同样不带 `fetchProvider`），把 bundle 已经自动做的事再复现一遍、再丢一次。**「已缓解」的结论依赖于一个当前恰好成立的 provider 计数，而不是配置本身。**【A/B/D】

---

## 6. 附：集合比对脚本输出摘录（/tmp，已删）

```
=== sizes ===
BACKENDS               13 exa,parallel,ddg,searxng,brave,tavily,serper,mojeek,deepseek,anthropic,openai,firecrawl,tinyfish
DEFAULT_KEY_ENV         9 deepseek,anthropic,openai,brave,tavily,serper,mojeek,firecrawl,tinyfish
DEFAULT_BASE_URLS       13 (同 BACKENDS)
DEFAULT_LABELS          13 (同 BACKENDS)
DEFAULT_MODELS           3 deepseek,anthropic,openai
DEFAULT_ENABLED          4 exa,parallel,ddg,searxng
OPTIONAL_KEY_IDS         3 searxng,firecrawl,tinyfish
METERED_IDS              2 firecrawl,tinyfish
CONFIG                  55 (全部字段)
TOGGLE_MAP              13 (同 BACKENDS)
CLIENT_BACKENDS         13 (同 BACKENDS)
CLIENT_OPTIONAL_KEYS     3 searxng,firecrawl,tinyfish
CONFIG_ENABLE           13 (同 BACKENDS)
CONFIG_APIKEYENV        10 brave,tavily,serper,mojeek,deepseek,anthropic,openai,searxng,firecrawl,tinyfish
CONFIG_BASEURL          10 brave,tavily,serper,mojeek,searxng,deepseek,anthropic,openai,firecrawl,tinyfish
CONFIG_MODEL             3 deepseek,anthropic,openai

=== 6-registry exact diff vs 13 ===
BACKENDS / DEFAULT_BASE_URLS / DEFAULT_LABELS / TOGGLE_MAP / CLIENT_BACKENDS:
  missing: [] extra: []
DEFAULT_KEY_ENV: missing: ["exa","parallel","ddg","searxng"] extra: []   ← 设计性子集

=== Config description coverage ===
fields: 55   with description: 55   missing: []

=== i18n ===
zh: 54  en: 54  zh-only: []  en-only: []
used: 48  used-undefined: []
defined-unused: [title, dirty, saved, reset, overridden, togglesTitle]

=== writeQueue 并发复刻 ===
calls: [{ops:[set enableExa=false], expectedRevision:0},
        {ops:[set enableDdg=false], expectedRevision:1}]   final revision: 2

=== save() 晚到编辑复刻 ===
{"stagedCount":3,"saving":true,...,"savedAt":0}   ← edit() 把 savedAt 清零
{"stagedCount":1,"saving":false,...,"savedAt":1794150581266}  ← save() 末尾重新置位
new field still staged? [ 'concurrency' ]   savedAt>0 (false-green)? true

=== credentialRef 边界（真实发布版库） ===
credentialRef("")           -> THROW credential ref "" must match /^[A-Za-z_][A-Za-z0-9_]*$/
credentialRef("A-B")        -> THROW
credentialRef(undefined)    -> undefined   (isCredentialRefName(undefined) === true)
z.string().role("credential-ref")("") -> ""   ← schema 接受空串
```

---

*报告完。*
