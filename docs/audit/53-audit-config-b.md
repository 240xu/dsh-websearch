# 53-b · 备份版审计 C（配置契约层）· 独立完整报告

> 任务来源：Lead 2026-11-08「目标模式 · 备份版审计 C（配置契约层）」+ 23:06「立即执行 · 先落盘」。**唯一写文件**：本文件。不改源码/配置/运行时/其它报告，不操作任务板，全程只读调研。
>
> **前置检查（D，2026-11-08）**：`53-audit-config.md` 与 `53-audit-config-b.md` 在本轮开始时均 ABSENT（实测 `ls`），故为完整独立备份版，非交叉复核补遗。
>
> **证据等级**：**A** = 源码实证（`src-work/plugin/...:行号`，或发布版绝对路径:行号）；**B** = 官方一手文档/发布版源码（URL 或本机版本）；**C** = 版本记录（PR/Issue/tag/npm 版本）；**D** = 本机只读实跑（`node` 集合脚本 / `grep` / `read` 输出）；**E** = 推断或无法验证（显式缺口）。
>
> **审计对象（D：`stat` 2026-11-08）**：`src-work/plugin/lib/index.js`（553 行，07:38 改）、`lib/client.js`（45530 B，18:17 改）、`lib/health.js`（07:27）、`lib/util/namespace.js`（11-07 23:23）、`lib/settings-api.js`（11-07 23:26）、`cordis.patch.yml`、`package.json`。**注意**：多位成员在本轮前持续修改这些文件，本报告以 2026-11-08 23:06 快照为准。

---

## 0. 一句话结论（先落盘，后续补证）

**当前配置契约层整体一致，未发现 P0 阻断缺陷；核心风险集中在「13 个 backend id 的六处登记是否同步」与「Config 派生字段覆盖」两点，待下方 node 集合脚本逐项裁决。** 先写骨架，以下三节为 Lead 指定必答项。

### 核心 ① · 13 个 id × 六处登记集合对比（待脚本裁决）

六处登记（**A**，均为 `src-work/plugin/`）：

| 登记处 | 位置 | 期望 |
| --- | --- | --- |
| `BACKENDS` 注册表 | `lib/index.js:58–75` | 13 个 id 全量 |
| `DEFAULT_KEY_ENV` | `lib/index.js:86–97` | 仅 key-gated（9 个），keyless 4 个**不应**登记 |
| `DEFAULT_BASE_URLS` | `lib/index.js:105–121` | 13 个 id 全量 |
| `DEFAULT_LABELS` | `lib/index.js:136–152` | 13 个 id 全量 |
| `Config` toggle + `resolveOptions` `toggleMap` | `lib/index.js:207–220,334–349` | 13 个 `enable<Id>` |
| `client.js` `BACKENDS` 副本 | `lib/client.js`（需定位行号） | 13 个条目 |

**基准 13 id（A：`index.js:58–75` 顺序）**：`exa, parallel, ddg, searxng, brave, tavily, serper, mojeek, deepseek, anthropic, openai, firecrawl, tinyfish`。

> 结论占位：脚本执行后填写「缺登记 / 多登记」清单 → 见 §1。

### 核心 ② · `resolveOptions` 派生字段覆盖与 `resolveApiKey`

**A**：`lib/index.js:369–390` 对 `for (const id of ALL_BACKENDS)`（13 个）统一派生：
- `apiKeyEnv = config?.[`${id}ApiKeyEnv`] ?? DEFAULT_KEY_ENV[id]`（`:370`）
- `baseURL = config?.[`${id}BaseURL`] ?? DEFAULT_BASE_URLS[id]`（`:375`）
- `model = config?.[`${id}Model`] ?? DEFAULT_MODELS[id]`（`:376`）
- `tavily` 额外 `searchDepth`（`:377`）
- `resolveApiKey`（`:383–388`）：`ctx.get("credentials")?.resolve(ref)?.value`，否则 `launchEnvironmentOf(ctx).get(ref)`，空串视为未配置。

**待裁决**：`Config` 中 `${id}BaseURL` / `${id}ApiKeyEnv` / `${id}Model` 三类字段是否覆盖 13 个 id；`DEFAULT_MODELS` 只列 3 个（`:127–131`），其余 10 个 id 的 `model` 为 `undefined`（是否符合各 backend 实际读取）。见 §2。

### 核心 ③ · zh/en 字典对称 + `findPluginRow` 多 ns 误选

- `client.js` 内 `zh` / `en` 两个字典（需定位行号）→ 键集合对比，查死键 / 未定义引用 / `props.t(key, opts)` 用法。
- `lib/util/namespace.js:15–27` `findPluginRow` 已按 `PROFILE_ID="dsh-websearch"` → `LEGACY_ID="unified-search"` → 需 ≥2 个 `SHAPE_FIELDS` 的形状兜底；`lib/index.js:21,474–481` 的 `current()` 与 `lib/settings-api.js:36,125–127` 的 `findNamespace` **共用同一函数**（A）。多 ns 误选风险与 null/抛错回落见 §3。

---

*骨架已落盘（2026-11-08 23:08，52 行）· 以下为 23:30 补完的正式裁决，§0 三处「待裁决/占位」由 §1–§7 的结论取代；未删改骨架任何一行。*

---

## 1. 逐条裁决表（Lead 指定 8 组 + 扩展，全部 A/B/C/D/E）

> 脚本落点：`/tmp/audit53{,b,c,d,e,f,g,h,i,j}.mjs`（D，2026-11-08 实跑，跑完按规范删除，见 §7）。所有结论以 2026-11-08 23:06 文件快照为准。

| # | 审计点 | 官方/契约基准 | 我们做法（A：路径:行号） | 裁决 | 证据 |
| --- | --- | --- | --- | --- | --- |
| ①-1 | **13 id × 六处登记集合对比** | 注册表驱动；每个 id 必须在 6 处同步（`BACKENDS` / `DEFAULT_BASE_URLS` / `DEFAULT_LABELS` / `Config.enableXxx` / `resolveOptions.toggleMap` / `client.js BACKENDS`） | `index.js:58–75,105–121,136–152,207–220,334–349`；`client.js:14–33` | **✅ 无缺登记** | **D**：`node /tmp/audit53.mjs` 逐字输出 `BACKENDS ALL 13 / DEFAULT_BASE_URLS ALL 13 / DEFAULT_LABELS ALL 13 / Config.toggleMap ALL 13 / resolveOptions.toggleMap ALL 13 / client.js BACKENDS ALL 13`，六处 `missing=[] extra=[]`。Lead 独立脚本结果一致（C，Lead 消息 23:06） |
| ①-2 | `DEFAULT_KEY_ENV` 恰 9 个 | 4 个 keyless（exa/parallel/ddg/searxng）不应登记；9 个 key-gated 全登记 | `index.js:86–97` = `deepseek,anthropic,openai,brave,tavily,serper,mojeek,firecrawl,tinyfish` | **✅ 设计一致** | **D**：脚本输出 9 个，逐字与 Lead 结果相同；`OPTIONAL_KEY_IDS`（`:100`）含 searxng/firecrawl/tinyfish 解释「登记了但非必需」 |
| ①-3 | `DEFAULT_MODELS` 只 3 个 | 仅 deepseek/anthropic/openai 三个 LLM 后端读 `model` | `index.js:127–131`；`Config` 仅 `:271–276` 三个 `${id}Model` 字段 | **✅ 一致** | **D**：脚本输出 3 个；**A**：10 个 backend 模块中仅 `anthropic-like.js`/`openai.js` 读 `options.model`（`grep` 实证），其余 8 个不读 |
| ①-4 | `client.js BACKENDS` 元数据一致性 | 与 index 的 keyEnv / optional / metered 同步 | `client.js:14–33` | **✅ 一致（1 处表面差异属设计）** | **D**：`audit53j.mjs` 13 行逐条比对，唯一差异 `searxng` 在 client 有 `keyEnv:"SEARXNG_API_KEY"` 而 `DEFAULT_KEY_ENV` 无 —— 这是**故意**：`index.js:100 OPTIONAL_KEY_IDS` 含 searxng，且 `Config:237 searxngApiKeyEnv` 默认 `"SEARXNG_API_KEY"`。非缺陷 |
| ②-1 | **`resolveOptions` 三类派生覆盖 13 id** | `for (const id of ALL_BACKENDS)` 统一派生即全覆盖 | `index.js:369–390`；`${id}ApiKeyEnv`/`${id}BaseURL`/`${id}Model` 三处模板字面量 | **✅ 全覆盖（循环层）**；**⚠️ Config 字段层只覆盖子集** | **D**：`audit53.mjs` 三个 `resolveOptions uses \`${id}…\`: true`；**D**：`Config.ApiKeyEnv/BaseURL` 各 10 个（缺 exa/parallel/ddg）、`Config.Model` 3 个。缺的 id 由 `?? DEFAULT_*[id]` 兜底（`index.js:370,375,376`），属设计（`README.md:122` 自述「补齐全部裸字段…description」）→ 见 §6 反直觉 #1 |
| ②-2 | **`resolveApiKey` 每 id 正确** | 官方 `CredentialProvider.resolve(ref)` 自身已含 `file→env→dotenv` 回退（`dsh-credentials-local/lib/index.js:480–495`；`describe` 同文件 `:497+` 返回 `source:"file"\|"env"`） | `index.js:383–388`：`ctx.get("credentials")!==undefined` → `return (await credentials.resolve(ref))?.value`；**否则**才 `launchEnvironmentOf(ctx).get(ref)` | **✅ 每 id 正确，但 else 分支在装了 credentials 服务时是死代码** | **A/D**：`audit53i.mjs` 抽出闭包逐字核对；**B/A**：官方 `dsh-credentials-local/lib/index.js:432,441,480–495` 证明 `resolve()` 已含 `inherited()`(process env) + `dotenvFallback()`。⇒ 插件的 `else` 仅在 `ctx.get("credentials")===undefined`（未挂 provider）时生效，不是「凭证服务未配置时回退 env」。README:116 的表述略宽（§6 #2） |
| ②-3 | `requiresKey`/`optionalKey`/`metered` 每 id 派生 | `index.js:380–382` 由 `DEFAULT_KEY_ENV` + 两个 Set 计算，13 个 id 统一 | 同上 | **✅ 一致** | **D**：`audit53i.mjs` 三项均 true；`health.js:57,63–64` 用 `beOpts.requiresKey!==true` 派生 `keyless`，与 `index.js:380` 同源 → **health keyless 派生正确**（A：`health.js:50–70`） |
| ③-1 | **zh/en 字典键完全对称** | locale-owned：`ctx.locale.register(NS,{zh,en})`（`client.js:828`） | `client.js:62–116` zh / `:117–174` en | **✅ 完全对称 54/54** | **D**：`node /tmp/audit53e.mjs`（剥离字符串内容后按行首键提取）→ `zh 54 en 54 / zh-only [] / en-only [] / 无重复 / used-undefined zh [] en []`。**注意**：初版脚本 `audit53b.mjs` 报 `en-only:['validation']` 是**假阳性**——来自 `en:171 invalidFields: "Fields failed validation:"` 串内冒号；`audit53e.mjs` 已消除，结论以 e 为准 |
| ③-2 | 死键 / 未定义引用 | 无 | `props.t(...)` 字面量引用 47 个键；`locale.bind(NS)("nav")` 1 处（`:844`） | **⚠️ 6 个死键（P2）**；**✅ 无未定义引用** | **D**：`audit53e.mjs` → `USED but UNDEFINED in zh/en: []`；`dead keys (excl nav): title, dirty, saved, reset, overridden, togglesTitle` 两字典各 6 个。均为历史遗留 copy，不触发运行时错误，但违反「locale-owned 无死键」规范 → §4 P2-1 |
| ③-3 | UI 文案 locale-owned | 所有用户可见串走 `t()` | `client.js` JSX `children:` 硬编码仅 `numResults`/`concurrency`/`backendTimeoutMs` 三个**字段名**（`:655,659,663` 附近），无中文/英文句子 | **✅ 一致（字段名属数据非文案）** | **D**：`audit53d.mjs` → `hardcoded children strings: ['numResults','concurrency','backendTimeoutMs']`；CJK 硬编码 0 命中。唯一插值 `props.t("keyLabel",{id:b.id})`（`:772`）为 `t(key,opts)` 合法用法，字典值 `"{id} API Key"` 两语言一致 |
| ③-4 | **`current()` 与 settings-api 共用 `findPluginRow`；多 ns 误选** | 官方 `dsh-settings/lib/types/index.js:296` `ns: entry.options.id`；`cordis.patch.yml:8` insert id=`dsh-websearch` | `util/namespace.js:15–27` 三级优先：`PROFILE_ID="dsh-websearch"` → `LEGACY_ID="unified-search"` → ≥2 个专属 `SHAPE_FIELDS` 形状兜底；`index.js:21,474–481` 与 `settings-api.js:36,125–127` 都调它 | **✅ 不会误选；✅ null/抛错安全回落** | **D**：`node /tmp/audit53h.mjs` 12 用例全 OK——含「多 ns 只有通用 `numResults`/`concurrency` → undefined」「形状仅 1 个专属字段 → undefined」「两个 id 同时存在 → profile 优先」「`null`/`undefined`/非数组/含 null 行/`row.ns` 非字符串/`row.value=null`」。`current()` 另有 `try/catch` 回落 `config`（`index.js:475–480`）；`settings-api.js:100–104,226–232` 有 `try/catch` + `safeDescribe`。**A**：`write()` 用 `view.ns`（`:176`）而非硬编码 → 与读同源，不会写错 ns |
| ④-1 | **Config 全部字段 `.description()`** | `README.md:122` 自述 0.2.0 表单唯一文案来自 meta.description | `index.js:160–283` | **✅ 55/55 全覆盖** | **D**：`node /tmp/audit53g.mjs` → `Config fields: 55 / with .description(): 55 / MISSING: [] / .description( 出现 55 次`（含 `enabledBackends:281–282` 的链式换行调用）。初版 `audit53f.mjs` 报「仅 13」是**脚本缺陷**（按「下一字段前的 `\n  `」切段，把链式 `.description()` 切到下一段），已用 g 修正 |
| ④-2 | **4 个 `.default(true)` toggle 让 `DSH_UNIFIED_SEARCH_BACKENDS` 永不可达** | `README.md:116` 已列 Known Limitation | `index.js:207–210` `enableExa/Parallel/Ddg/Searxng` 四个 true；`resolveOptions:329–365` 优先级 `enabledBackends > toggles > env > DEFAULT_ENABLED` | **✅ 属实，且是已文档化的设计取舍（非缺陷）** | **D**：`audit53f.mjs` → `default(true): [enableExa,enableParallel,enableDdg,enableSearxng]`（9 个 false）；**A**：env 读取被 `if (enabledBackends.length === 0)` 包住（`:353`），四个 true 恒产生非空集合 → env 与 `DEFAULT_ENABLED`（`:363–365`）都不可达，除非用户显式把四个开关全关。**C/A**：`README.md:116` 原文已注明。⇒ 判「可接受」，但见 §6 反直觉 #3 |
| ⑤-1 | **`writeQueue` 串行化** | 并发写必须序列化，否则两个 toggle 都带旧 revision | `client.js:216–219,253–258`：`this.writeQueue=Promise.resolve()`，`write()` 用 `.then(run,run)` 链式排队，`.then(noop,noop)` 吞掉失败保证队列不断 | **✅ 正确** | **A**：`writeNow` 在**轮到自己时**才读 `getSnapshot().revision`（`:261`）；**D**：代码级推演，未做并发实跑（E 缺口）。注释（`:216–218`）明确说明动机 |
| ⑤-2 | **失败后 `scope.load()` 重读** | 写失败（含响应丢失）须重同步，避免停留在写前陈旧值 | `client.js:362–380 setToggle` catch 里 `if (typeof this.scope.load === "function") try { await this.scope.load(); } catch {}`（`:375–377`）；且只 `console.warn({conflict})` 不打原始错误文本 | **✅ 覆盖 toggle 路径**；**⚠️ `save()` 路径未重读（P2）** | **A**：`save()` `:515–518` catch 仅置 `failed/conflict`，**无** `scope.load()`；但 save 的写若为 settings 字段，失败后 UI 仍显示 staged 值（未清），下一次成功写会带同一 revision → 可能连续 409。属建议修 → §4 P2-2 |
| ⑤-3 | **空白 stagedKey 排空** | 空白草稿不应让 Save 常亮 | `client.js:352–359 editKey` 空白即 `stagedKeys.delete(envRef)`；`save():507–510` 空白草稿 `doneKeys.push(ref)` 后 `:513` 统一删除 | **✅ 双保险正确** | **A**：两处均有注释（`:354–355,508`）；`projection:332 stagedCount = staged.size + stagedKeys.size` → 空白不计数 |
| ⑤-4 | **`safeFailureReason` 脱敏** | 不把 host 内部路径/凭证 ref 名显示给用户 | `client.js:287–290`：只取 `err.code`，且须匹配 `/^[a-z][a-z0-9/_-]{0,60}$/i`，否则固定 `"write rejected"`；`:504` `failedKeys.set(ref, safeFailureReason(keyErr))` | **✅ 脱敏有效** | **D**：`node -e` 实测 `new Error("credential/rejected: disk full")` → `"write rejected"`；`{code:"credential/rejected"}` → 原样。**注意**：`writeCredential:437` 抛的是 `new Error(res.error?.message ?? ...)` —— `Error` 无 `.code`，故 **服务端真实错误码被丢弃**，UI 只显示 `write rejected`（信息量低但安全）→ §4 P2-3 |
| ⑤-5 | **`readErrors` 固定码 + 保留 `readFailed` 锚点** | 读取失败须与保存失败分开、且必须可见 | `client.js:306` 建 Map、`:340` 投影进 `state.readErrors`、`:398–400,417` 固定 `reason="credential/read-failed"`、`:421` 经 `safeFailureReason` 写入、`:414` 成功时 `delete`；`readFailed` 布尔锚点在 `:383,399,407,412` 阻止回落旧线/阻止误置 keyState | **⚠️ 固定码与锚点正确，但 `readErrors` 从未渲染（P1）** | **A/D**：`grep -n readErrors client.js` 只有 4 处（构造/投影/delete/set），`:622–805` JSX 区 **0 处** `state.readErrors` 引用。⇒ `describe` 返回 `{ok:false}` 时用户仍看到「未配置」徽标 + 无任何错误提示，与 `readCredential` 注释（`:394–397`「a read failure, not an unconfigured credential」）**自相矛盾**。这是本审计**唯一 P1** → §4 |
| ⑥ | zh/en 见 ③ | — | — | — | — |
| ⑦-1 | **inject 5 项最小集 vs 官方同类插件** | 官方 `dsh-client-ui-settings-web-search/lib/client.js:482–488` = `["slots","locale","remote","remote.credentials","configForms"]`（5 项）；官方 models 插件 `:4417–4427` = 9 项（因其真读 llm/session/settings/configForms/settingsSchema） | `client.js:809` = `["slots","locale","connection","remote","remote.credentials"]`（5 项） | **✅ 最小集口径正确（数目一致）**；**⚠️ 内容有 1 进 1 出** | **A/B**：我们多 `connection`、少 `configForms`。官方 web-search 用 `configForms` 读设置，我们用自有 HTTP 桥 → **少 `configForms` 合理**；多 `connection` 只为 `ctx.get("connection")`（`:832`）供旧线 `connection.api.credentials` 回退（`:407–410,440–443`），而该旧线在发布版全库 0 命中（**E**：兼容猜测）。`cordis/lib/index.js:676,687–689,1320–1326`：声明即硬依赖，缺失会让整个 client fiber park → **风险见 ⑦-2** |
| ⑦-2 | **`connection` 是否多余 / hard dependency 风险** | `ctx.get(name)` 绕过 inject 要求（`cordis/lib/index.js:756–765`），但未声明时 `ctx.connection` 属性访问会抛 | `client.js:809` 声明 `connection`；`:832` 用 `ctx.get("connection")` | **⚠️ 可删（P2）**：改用 `ctx.get` 已足够，声明它等于多一个「必须由 host 提供」的硬依赖；当前 profile 有该服务故无故障。`remote.credentials` 同理：由 `package.json dsh.client.inject` 的 `@deepseek-ai/dsh-api-remotes` 挂载，缺了整卡消失 | **A/B**：`cordis/lib/index.js:676,687–689,1320–1326`；**D**：`package.json` 5 个包名含 remotes；**E**：未做卸载 remotes 的破坏性实测（只读约束）。属「无 bug 则与官方规范对齐」的可选提案 |
| ⑧ | **`cordis.patch.yml` 抹掉 `fetchProvider` / env pin 缓解** | `dsh-web/lib/index.js:60` `this.fetchProviderEnv = process.env.DSH_WEB_FETCH_PROVIDER`、`:115` `config.fetchProvider.get() ?? fetchProviderEnv`；config **整体替换不深合并** | `cordis.patch.yml:11–13` 只写 `searchProvider: unified`，无 `fetchProvider` | **⚠️ patch 仍缺 `fetchProvider`（P2，运行时已缓解）** | **A**：`cordis.patch.yml:13`；**D**：`tr '\0' '\n' < /proc/587384/environ | grep DSH_WEB_FETCH_PROVIDER` → `DSH_WEB_FETCH_PROVIDER=http`（**当前进程确实设了 env pin**，故 `web_fetch` 不报 `WEB_PROVIDER_AMBIGUOUS`，与 02 号报告 11-04 观测的「未设」不同 —— 环境已变）。**A**：`dsh-web/lib/index.js:115` 证明 env 可兜底。⇒ drop-in env pin **有效缓解**，但依赖部署环境；若换机/清 env 会复现。最小改动建议：patch restate `fetchProvider: http`（未执行） |

---

## 2. 缺陷清单（P0 / P1 / P2）

### P0（阻断）— **未发现**

13 id 六处登记、派生覆盖、字典对称、findPluginRow、writeQueue、脱敏、Config description 全部通过。Lead 独立脚本与本审计脚本结论一致。

### P1（功能缺陷，1 项）

| ID | 缺陷 | 依据（四联） | 建议最小改动 | 验证方式 |
| --- | --- | --- | --- | --- |
| **P1-1** | `readErrors` 计算并投影进 `state.readErrors`（`client.js:306,340,421`）但**在 JSX 中从未渲染**（`:622–805` 0 引用）。结果：`remote.credentials.describe()` 返回 `{ok:false}` 时，用户看到「未配置」+ 无错误提示，与 `readCredential` 自身注释（`:394–397`）承诺的「a read failure, not an unconfigured credential」矛盾；`readFailed` 锚点虽正确阻止了误回落，但错误态对用户不可见 | **A**：`client.js:306,340,398–400,414,417,421`；**D**：`grep -n readErrors` 仅 4 处 + `sed -n '622,805p' | grep readError` → 无；**B**：官方同类 `dsh-client-ui-settings-web-search/lib/client.js:348–350` 对 `!response.ok` 明确 return 且页面有 error 态 | 在 `KeyedBackendCard`（`:568–607`）与可选 Key 区（`:770–785`）各加一行：`const readError = (state.readErrors ?? []).find(e => e.ref === b.keyEnv)`，渲染 `props.t("keyFailed")` 之外的**新固定文案**（需 zh/en 各补 1 键，保持 §1 ③-1 的对称性）；或复用现有 `keyFailed` 并注明「读取失败」语义 | **D**：改后 `node --test tests/*.test.js` + 浏览器手工把 `describe` 打桩成 `{ok:false}`，确认徽标旁出现固定错误文案；**E 缺口**：本次只读未实施、未跑测试 |

### P2（建议修 / 可接受，6 项）

| ID | 项 | 裁决 | 依据 |
| --- | --- | --- | --- |
| P2-1 | zh/en 各 6 个死键 `title, dirty, saved, reset, overridden, togglesTitle` | 建议清理或补 UI 引用；不影响运行 | **D** `audit53e.mjs` |
| P2-2 | `save()` catch（`:515–518`）未 `scope.load()` 重读，与 `setToggle`（`:375–377`）不对称 | 建议补；失败后 staged 未清 + 旧 revision 可能连续 409 | **A** `client.js:362–380,515–518` |
| P2-3 | `writeCredential:437` 把 `res.error.message` 包成 `new Error(...)`，丢掉 `.code` → `safeFailureReason` 只能给 `"write rejected"` | 建议把 `res.error?.code` 透传（`throw Object.assign(new Error(...),{code})`），既脱敏又保留分类 | **A/D** `client.js:287–290,436–437` + `node -e` 实测 |
| P2-4 | `inject` 的 `connection` 多余（官方同类插件无；`ctx.get` 已够），且 `remote.credentials` 是「声明即硬依赖」 | 建议：删除 `connection` 或注释固化依赖；在 `package.json`/代码注释写明 `remote.credentials` 由 `@deepseek-ai/dsh-api-remotes` 贡献挂载 | **A/B** `cordis/lib/index.js:676,687–689,1320–1326`；**A** 官方 web-search `:482–488` |
| P2-5 | `cordis.patch.yml:11–13` 仍缺 `fetchProvider: http`，仅靠进程 `DSH_WEB_FETCH_PROVIDER=http` env pin 缓解 | **可接受（当前已缓解）**；建议 restate 以去掉部署环境依赖 | **D** `/proc/587384/environ`；**A** `dsh-web/lib/index.js:60,115` |
| P2-6 | `package.json:4` description 仍写「11 backends / 11 后端」，实际 13 | 文档一致性，建议改 13 | **A/D** `package.json:4` vs `index.js:58–75` 13 项 |

---

## 3. 已确认无误（逐条 A/D）

1. **13 id 六处登记全同步**（§1 ①-1，D 脚本 + Lead 独立复现）。
2. **`DEFAULT_KEY_ENV` 9 个 / `DEFAULT_MODELS` 3 个 / `DEFAULT_ENABLED` 4 个** 均为有意子集，与 `OPTIONAL_KEY_IDS`/`METERED_IDS`/backend 模块实际读取一致（D/A）。
3. **`resolveOptions` 循环层对 13 id 统一派生** `${id}ApiKeyEnv` / `${id}BaseURL` / `${id}Model`（`index.js:369–390`），缺字段由 `?? DEFAULT_*[id]` 兜底（D `audit53.mjs`/`audit53i.mjs`）。
4. **`resolveApiKey` 每 id 正确**：`credentialRef(keyEnvName)` 每 id 独立构造，闭包捕获 `ref`；官方 `credentials.resolve()` 自带 file→env→dotenv 回退（A/B）。
5. **health.js keyless 派生正确**：`beOpts.requiresKey !== true`（`health.js:57`）与 `index.js:380` 同源，`optionalKey`/`metered` 直取 `beOpts`（`:63–64`）；`sanitizeError`（`:25–32`）3 条正则 + 120 字符截断（A）。
6. **zh/en 完全对称 54/54、无未定义引用、无 CJK 硬编码**（D `audit53e.mjs`/`audit53d.mjs`）。
7. **`findPluginRow` 多 ns 不误选 + null/抛错安全**：12 用例全过；`current()` 与 `settings-api.js` 共用同一函数，`write()` 用 `view.ns` 写回（D `audit53h.mjs`，A 三处源码）。
8. **Config 55/55 字段均有 `.description()`**（D `audit53g.mjs`），`Config.meta.volatile=true`（`index.js:292`）与 `FIELD_LABELS` 6 项（`:302–316`）齐全。
9. **`writeQueue` 串行化 / 空白 stagedKey 双保险排空 / `safeFailureReason` 脱敏 / `readErrors` 固定码 + `readFailed` 锚点**（逻辑层）均正确（A `client.js:216–290,352–359,382–423,493–513`）——唯一缺口是 P1-1 的**渲染层**。
10. **4 个 `.default(true)` toggle 导致 env 不可达**属实，但 `README.md:116` 已列为 Known Limitation，非隐藏缺陷（A/C）。
11. **当前运行时 `web_fetch` 不报 AMBIGUOUS**：`DSH_WEB_FETCH_PROVIDER=http` env pin 实测存在（D），修正了 02 号报告 11-04「未设」的旧观测。

---

## 4. 无法验证（E，显式缺口）

| # | 项 | 缺口 |
| --- | --- | --- |
| E1 | `writeQueue` 真并发下的 revision 行为 | 仅代码推演（A），未跑两个并发 toggle 的集成测试（只读约束） |
| E2 | `readErrors` 在真实 `describe(){ok:false}` 下的 UI 表现 | P1-1 由「grep 0 渲染引用」推断（A+D），未启动 `dsh web` 打桩实测 |
| E3 | `connection.api.credentials` 旧线回退（`client.js:407–410,440–443`） | 发布版 `0.2.1-rc.2` 全库 `grep` 0 命中 → **E**：兼容猜测，不能当结论 |
| E4 | `credentials.resolve()` 在「服务存在但 `resolve` 返回 undefined」时插件是否该回退 env | 官方 provider 自带回退（A），但不同 provider 实现未逐一核对（E） |
| E5 | `findPluginRow` 形状兜底的 `SHAPE_FIELDS` 是否可能撞上**别的插件**恰好有 ≥2 个同名字段 | 12 用例未构造该场景；概率低但非零（E） |
| E6 | `cordis.patch.yml` 若去掉 env pin 是否 100% 复现 `WEB_PROVIDER_AMBIGUOUS` | 02 号报告 11-04 实测过（C），本轮未重启/未改 env 复验（只读约束） |
| E7 | 18/18 单测与服务 PID=347337 的当前状态 | Lead 广播给出（C），本轮未跑测试、未查进程（只读 + 不重启） |
| E8 | 认证 GitHub API 只读探测 | 本轮**未调用**（PR#7/Issue#8 结论沿用 33-b 报告的 C 级记录）；任务允许但未必要，标记为未执行 |

---

## 5. 五条反直觉（新发现优先）

1. **「`resolveOptions` 三类派生覆盖全部 13 id」在循环层成立、在 Config 字段层不成立** —— `${id}ApiKeyEnv`/`${id}BaseURL` 各只有 10 个字段、`${id}Model` 只有 3 个（D `audit53.mjs`）。exa/parallel/ddg 三个 keyless 后端**没有任何 Config 字段**，全靠 `?? DEFAULT_BASE_URLS[id]` 兜底；`README.md:122` 宣称「补齐全部裸字段」实际只补齐了「需要暴露给用户改的」字段。**含义**：新增 backend 时只改 6 处登记还不够，还要判断是否需要新增 `${id}BaseURL` Config 字段，否则该后端端点不可配置。
2. **插件 `resolveApiKey` 的 `else` env 分支基本是死代码** —— 官方 `dsh-credentials-local/lib/index.js:480–495` 的 `resolve()` 自己就做 `file → inherited(process env) → dotenvFallback` 三级回退；插件 `index.js:384–387` 只要 `ctx.get("credentials")!==undefined` 就直接 return，永远走不到 `launchEnvironmentOf(ctx).get(ref)`。⇒ README:116「未在 credentials 配置时回退读同名环境变量」描述的是**官方 provider 的行为**，不是本插件 else 分支的功劳；删掉 else 也几乎不影响（但保留可覆盖「未挂 credentials 服务」的极端部署）。
3. **4 个 `.default(true)` toggle 不仅让 `DSH_UNIFIED_SEARCH_BACKENDS` 不可达，连 `DEFAULT_ENABLED` 也不可达** —— `resolveOptions:333–365` 四级链里 toggle 恒非空 ⇒ 第 3 级 env 与第 4 级 `DEFAULT_ENABLED`（`["exa","parallel","ddg","searxng"]`）在默认配置下**都是死代码**。README 只提了 env（`:116`），未提 `DEFAULT_ENABLED` 同样永不生效。这是「已文档化」但**文档不完整**的一处。
4. **`readErrors` 是全链路实现最完整却完全不可见的一块** —— 固定码、`safeFailureReason` 脱敏、`readFailed` 锚点阻止回落、成功时 `delete`、投影进 `state.readErrors` 全部到位（A：`client.js:306,340,398–421`），唯独 JSX 里 0 引用（D）。⇒ 「describe 失败 ≠ 未配置」这个 33 号报告提出并修好的语义，**在 UI 上仍然表现为「未配置」**。这是本轮最值得报的新发现（P1-1）。
5. **`safeFailureReason` 的严格脱敏反而抹掉了所有错误分类** —— `writeCredential:437` 抛的是 `new Error(res.error?.message)`，`Error` 没有 `.code`；`safeFailureReason`（`:287–290`）只认 `err.code` ⇒ 无论服务端返回 `credential/rejected` / `gateway/bad-request` / `gateway/internal`，UI 一律显示 `"write rejected"`（D `node -e` 实测）。这与 §1 ⑤-4「脱敏有效」并不矛盾，但说明**安全与可诊断性之间有未取舍的空格**：把 `code` 透传即可两者兼得（P2-3）。

---

## 6. 与官方规范对齐小结（供「无 bug 就对齐」目标）

- **已对齐**：`inject` 最小集（5 项，与官方 `dsh-client-ui-settings-web-search` 同数目同思路）、`describe([ref])` 位置参数、`set(ref,value)` 位置参数、`res.ok===false` 判定、`RemoteResult` 两分支模型、`ns` 精确优先的命名空间定位、`settings.describe()` Host 侧同步数组签名、`.description()` 全字段覆盖、locale-owned 字典。
- **可对齐（非阻塞）**：删多余 `connection`、补 `credentials/record-updated`/`connection/reset` 事件订阅（官方 models `:4472–4478` 有，官方 web-search 只订阅 `reference-updated` 且按 ref 过滤）、移除无效 `credentials/updated`（官方 `remote-events.d.ts:63–67` 只有 `record-updated`/`reference-updated`，D 全库 0 命中）、`describe` 结果改官方一层解包（`client.js:402–404` 仍三层，`record.credentials` 层无官方依据）。
- **升级安全**：`cordis.patch.yml` 与上游 2.8.8 逐字相同（C：02 号报告 `:510`），升级不会修 `fetchProvider` 缺失；当前靠 env pin 缓解，属部署约定而非代码保证。

---

## 7. 本机只读实跑记录（D）与清理

- `node /tmp/audit53.mjs` → 六处登记 ALL 13 OK；`DEFAULT_KEY_ENV` 9；`DEFAULT_MODELS` 3；派生字段计数。
- `node /tmp/audit53b.mjs`（初版假阳性 `validation`）→ `node /tmp/audit53c.mjs` → `node /tmp/audit53d.mjs` → **`node /tmp/audit53e.mjs`（定稿：54/54 对称）**。
- `node /tmp/audit53f.mjs`（初版假阳性「仅 13 个 description」）→ **`node /tmp/audit53g.mjs`（定稿 55/55）**。
- **`node /tmp/audit53h.mjs`** → `findPluginRow` 12 用例 `failures: 0`。
- `node /tmp/audit53i.mjs`（resolveApiKey 闭包抽取）、`audit53j.mjs`（client BACKENDS 元数据 13 行比对）。
- `grep -n readErrors client.js` → 4 处；`sed -n '622,805p' | grep readError` → 无（P1-1 证据）。
- `tr '\0' '\n' < /proc/587384/environ | grep DSH_WEB_FETCH_PROVIDER` → `DSH_WEB_FETCH_PROVIDER=http`（敏感值已按规范不打印，本报告无任何 token 值）。
- 官方源码只读：`/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/{dsh-client-ui-settings-web-search,dsh-credentials-local,dsh-web,dsh-api-remotes,dsh-settings,cordis}/lib/...`（A/B）。
- **清理**：`/tmp/audit53*.mjs` 共 10 个临时脚本，按任务要求跑完删除（见下方命令）；本报告是唯一产物，未改源码/配置/运行时/其它报告，未操作任务板。

```
rm -f /tmp/audit53.mjs /tmp/audit53b.mjs /tmp/audit53c.mjs /tmp/audit53d.mjs \
      /tmp/audit53e.mjs /tmp/audit53f.mjs /tmp/audit53g.mjs /tmp/audit53h.mjs \
      /tmp/audit53i.mjs /tmp/audit53j.mjs
```

---

*报告结束 · 子代理 `protocol-standards` · 2026-11-08 · 唯一产物文件：`.artifacts/websearch-research/53-audit-config-b.md` · 未操作任务板 · 全程只读*
