# 33 · 官方行为对齐 · 客户端凭证契约（专家 A）

> **本文件是唯一交付物**；全程只读，未改源码/配置/其它报告。撰写于 2026-11-07（跨会话续写，已重新核对 `src-work` 当前内容：`lib/index.js` 于 15:40 被 lead 更新，本报告的对齐基于**当前**版本）。
>
> **与 33-b 的关系**：同目录下已存在另一个子代理的 `33-official-alignment-client-b.md`（19:41）。本报告不复制其结论；凡与它重合的条目只写「一致」并给出**独立证据路径**，重点放在 B 未覆盖或未深挖的三处：`readCredential` 对 `{ok:false}` 的静默吞掉、`dsh.client.inject`（包名级）与 `exports.inject`（服务键级）的**两级机制实证**、以及 `connection` 为**多余依赖**的可执行验证。
>
> **证据等级**（沿用团队约定）：**A** = 源码实证（本机绝对路径:行号）；**B** = 官方一手文档/发布版源码（本机 `package.json` 版本 + 路径）；**C** = 版本/PR/Issue 记录；**D** = 本机只读实跑（`ls`/`grep`/`node`/`npm view`/`npm pack`/GitHub API/`dsh --dump-config`）；**E** = 推断或待核实（显式列缺口）。
>
> **基准版本**：本机发布版 `@deepseek-ai/dsh` **0.2.1-rc.2**（D：`node -p require(.../package.json).version`），全部官方子包同版本。Issue #8 报告环境为 **0.2.1-rc.5**；npm `dist-tags.latest = 0.2.2-rc.1`（D：`npm view @deepseek-ai/dsh dist-tags --json`）。

---

## 0. 一句话结论

**发现的「必须修」项：1 项（且是 B 报告未列出的新项）—— `readCredential()` 在 `describe` 返回 `{ok:false, error}` 时把失败包络当成「未配置」静默吞掉，且把 `error` 对象误当记录解包。** 其余与官方不一致处均可归入「建议修 / 可接受」；Issue #8 的两处修复（`inject` 补 `remote.credentials`、检查 `set` 的 `res.ok === false`）**当前代码已正确落地**，与官方逐字一致，无回归。

---

## 1. 逐项对齐表（官方做法 / 我们做法 / 一致? / 风险 / 建议）

| # | 对齐项 | 官方做法（A/B） | 我们做法（A） | 一致? | 风险 | 建议 |
|---|---|---|---|---|---|---|
| ①-1 | `inject` 数组 service key | `dsh-client-ui-settings-models/lib/client.js:4417-4427` = 9 项 `["slots","locale","remote","remote.credentials","remote.llm","remote.settings","remote.session","configForms","settingsSchema"]`；**更贴近我们场景的官方同类插件** `dsh-client-ui-settings-web-search/lib/client.js:482-488` = **5 项** `["slots","locale","remote","remote.credentials","configForms"]` | `src-work/plugin/lib/client.js:758` = `["slots","locale","connection","remote","remote.credentials"]`（5 项） | **按最小集一致** | 见 ①-2 | 保持最小集；对照官方 web-search 插件，我们**多** `connection`、**少** `configForms`，但两者都不是必需（①-3） |
| ①-2 | 缺 `remote.llm/settings/session`、`configForms`、`settingsSchema` 会不会不激活 | 官方 models 插件用这 9 项是因为它真的读 `remote.llm.listProviders()`（`:1341-1342`）、`remote.session.modelCatalog()`（`:1376`）、`ctx.remote.settings.mutate(...)`（`:3180`）、`ctx.settingsSchema`（`:4441`）、`ctx.configForms.describe()`（`:4443`）——**每一键都有对应属性访问**。官方 web-search 插件只注入 `remote.credentials` + `configForms`，因为它只用到这两个 | 我们只用 `ctx.remote.credentials`（读写）+ `ctx.remote.$on(...)`（事件）+ `ctx.slots/locale`；**不读** `remote.llm/settings/session`、`configForms`、`settingsSchema` | **一致（最小集正确）** | 多声明任一键=多一个「必须被 host 提供」的硬依赖；缺了不会不激活，因为没访问 | **不要**为「逐字对齐」盲目补 9 项；官方自身按功能裁剪，最小集是官方做法 |
| ①-3 | 「声明但 host 未注册」的后果（网关注入规则） | `dsh-api-gateway/lib/client.browser.js:2074-2076` `remoteServiceKey(namespace) => \`remote.${namespace}\``；`:1773-1781` `createNamespace` 用 `ctx.plugin({name: remoteServiceKey(name)})` 注册**独立 Service**；`:1734-1741` 校验 `ownerCtx.get(serviceKey)` 冲突。`cordis/lib/index.js:676` 未声明访问抛 `cannot get property "<prop>" without inject`；`:687-689` 声明但未就绪抛 `cannot get required service "<prop>" in inactive context`；`Fiber._refresh()` `:1320-1326` 任一 inject 名取不到实现即 `epoch=INACTIVE` → **整个 fiber 不激活（apply 根本不跑）** | 声明 `remote.credentials`；`package.json` 的 `dsh.client.inject` 是 **5 个包名**（含 `@deepseek-ai/dsh-api-remotes`，D：`python3 -c` 读出），由它保证 `remote.credentials` 服务被挂载；`tests/lead-20261106.test.js:198-202` 断言不把服务键加进包名级列表 | **一致** | **反向风险**：若某 profile 未挂 `@deepseek-ai/dsh-api-remotes` 的 settings-controller 贡献 → `remote.credentials` 服务不存在 → 声明它使整卡消失（比 Issue #8 更严重） | 保留 `client.js:351,381` 的 `try/catch` 属性访问；但须写明「**声明即依赖**，不是可选探测」。D：本机 `dsh --profile web --dump-config` 只读导出确认 `id: dsh-websearch` 条目存在；38-e2e-save-probe.md:52 亦实测 `remote.credentials` 是 host 真实注册的命名空间 |
| ①-4 | 两级 `inject` 机制（**B 未深挖**） | `dsh-client-modules/lib/client.js:61-75` 解析 manifest 的 `dsh.client.inject`（**包名列表**）；`:789-792` `for (const packageName of row.inject)` 逐个 `arriveDependency` —— 这是**模块加载依赖**，不是 cordis service 依赖。模块 `exports.inject`（`client.js:837`）才是 cordis fiber 的 service 依赖，由 `dsh-cordis-client-runner` 消费（`:183`「Declare inject: ['slots'] on the returned plugin」、`:590` `waitingFor: Object.keys(fiber.inject)...`） | `package.json` 的 `dsh.client.inject` = 5 包名；`client.js:758` 的 `exports.inject` = 5 服务键 | **一致（概念分离正确）** | 把 `remote.credentials` 写进包名级列表会被当成**包名**去解析模块，必然失败 | 维持现状；测试 `:202` 已固化该约束（A） |
| ①-5 | `connection` 是否必需（**B 未覆盖**） | 官方 web-search 插件 `inject` **不含** `connection`，但通过 `configForms` 拿设置、通过 `remote.credentials` 拿凭证；官方 models 插件也**不含** `connection`（D：`grep -n '"connection"'` 两文件均 0 命中）。`connection/reset` 事件通过 `ctx.on(...)` 订阅（models `:4478`），**不需要** `ctx.connection` 属性 | 我们声明 `connection` 且 `apply` 用 `ctx.get("connection")`（`:781`）传给 controller，仅用于 `connection.api.credentials` 旧线回退（`:359-362,388-393`） | **不一致（多余依赖）** | D（`/tmp/inject_check5.mjs`）：不声明 `connection` 时 `ctx.get("connection")` **仍返回对象**（`ctx.get` 绕过 inject），但 `ctx.connection` 会抛。即我们其实**可以不声明**它；声明它等于增加一个硬依赖（若某 host 无 `connection` 服务 → 整卡不激活）。且 `connection.api.credentials` 在发布版 0.2.1-rc.2 全库 `grep` **0 命中**（E：旧线兼容猜测） | **建议修**：要么删 `connection` 改用 `ctx.get`（已可行），要么明确它是旧线回退的硬依赖并保留；见 §2.2 S1 |
| ②-1 | `credentials.describe` 调用形式 | `dsh-api-settings-controller/lib/typert.remote-client.d.ts:14` `describe: (refs: string[]) => Promise<RemoteResult<Record<string, CredentialInfo>>>`；`:26` `'credentials/describe': (refs: string[]) => ...`。官方调用：`dsh-client-ui-settings-models/lib/client.js:1383` `describe(refs.slice(index, index + 64))`（**位置参数数组**，按 64 分批）；`dsh-client-ui-settings-web-search/lib/client.js:348` `describe([ref])` | `client.js:354` `api.describe([ref])`（位置参数数组） | **一致** | 官方 `MAX_DESCRIBE_REFS=64`（D：`dsh-api-settings-controller/lib/index.js:55`）；我们 11 个 keyed/optional ref 逐个单发 = 11 次往返（性能非正确性） | 建议修（可选）：合并为一次 `describe(refs[])`，与官方 `:1383` 同构 |
| ②-2 | 两个 `describe` 是不同对象 | ① **远程命名空间** `ctx.remote.settings.describe()`：`typert.remote-client.d.ts:19` `describe: () => Promise<RemoteResult<SettingsDescribeValue>>`（无参、异步、`{ok,value}` 包络、`value.namespaces[]`）；官方 `dsh-client-ui-settings/lib/client.js:1447` `await ...; response.ok ? {view: response.value} : ...`。② **Host 服务** `ctx.settings.describe(options?)`：`dsh-settings/lib/types/index.d.ts:96` `describe(options?): SettingsDescriptor[]`（**同步、返回数组**）；实现 `dsh-settings/lib/types/index.js:270-310` 返回 `descriptors`，`:296` `ns: entry.options.id` | `settings-api.js:106` `descriptors = settings.describe()`（无参、同步、当数组用）；`:130-136` `findNamespace(descriptors)` 做 `Array.isArray` + `row.ns` 形状发现；`:185` `settings.mutate(view.ns, ops, expected)`（Host 侧签名 `dsh-settings/lib/types/index.d.ts:114`） | **一致（且必须厘清：不同对象，各自签名都正确）** | 我们注入的是 Host 侧 `settingsForms`（`index.js:438,537-540`），**不是** `ctx.remote.settings`。若误换成远程命名空间，`Array.isArray`/无包络的写法会全错 | 无需改动；在注释中标注这两个 `describe` 的不同签名（B 报告 §1 ②-3 同结论，此处独立复核 `index.js:270-310` 与 `:1447` 确认） |
| ③-1 | `credentials.set` 参数形式 | `typert.remote-client.d.ts:15` `set: (ref: string, value: string) => Promise<RemoteResult<void>>`；`:27` `'credentials/set': (ref: string, value: string) => ...`；`dsh-api-remotes/lib/client.js:2951-2998` wire spec 两个独立命名参数 `ref`/`value`（均 `type: "string"`，`source: "json"`）。官方 `dsh-client-ui-settings-models/lib/client.js:3172` `set(ref, value)`；web-search `:444` `set(this.ref(), value)` | `client.js:383` `api.set(ref, value)`（位置参数） | **一致** | 无 | 无 |
| ③-2 | `RemoteResult` 的 `ok` 拼写 / 错误字段 / 分支数 | `dsh-typert-protocol/lib/types/types.d.ts:110-116` `RemoteResult<T> = {readonly ok:true; readonly value:T} \| {readonly ok:false; readonly error: RemoteFailure}`；`remote-error.d.ts:10-14` `RemoteError extends Error` 带 `readonly code / details / isDSHRemoteError`；`:7-8` 「Client face 重建实例放进 error 分支」。错误码见 `types.d.ts:84-93`（`gateway/bad-request|cancelled|internal`）+ `dsh-api-gateway/lib/types/remote-error-codes.d.ts:14-36`（`gateway/*`）+ `dsh-api-settings-controller/lib/index.js:208`（`credential/rejected`）、`:192`（`gateway/internal` 未挂 provider） | `client.js:384-385` `res.ok === false` + `res.error?.message ?? "credential write rejected"` | **一致（主路径逐字精确）** | 我们只取 `.message`，**丢弃 `code`/`details`**：无法区分「ref 名非法（bad-request）」「服务端拒绝（credential/rejected）」「服务未挂（internal）」 | 建议修（可选）：把 `res.error?.code` 拼进 `failedKeys.reason` |
| ③-3 | `{ok:false,error:{code,message,details}}` 之外有无第三分支 | `types.d.ts:104-107` 明确「Remote face 把 carrier 失败折进 error 分支，**只有 assembly faults（arity / unmounted method / missing Context adapter）仍会 reject**」；网关 `client.browser.js:1829-1839` 只有 `{ok:false,...}` 与 `{ok:true,value}` 两条折返路径 | `writeCredential` 只判 `res.ok === false`，其余（含 `undefined`/`{ok:true}`）视为成功；`await api.set()` 若 reject，由 `save()` 的 per-key `try/catch`（`client.js:444-454`）捕获记 `failedKeys` | **一致** | `resolve` 只有两分支；`reject` 已被 `save()` 兜住，不会误报成功 | 无 |
| ④-1 | `describe` 结果解包层数 | `typert.remote-client.d.ts:14` 返回 `Record<string, CredentialInfo>`；Host 实现 `dsh-api-settings-controller/lib/index.js:156-160`：`<REDACTED_SECRET>` `Object.fromEntries(entries)`，**`value` 直接是按 ref 键控的扁平 record**。官方只一层：models `:1384` `Object.assign(credentials, response.value)`；web-search `:349-350` `if (!response.ok \|\| ref !== this.ref()) return; const view = response.value[ref];` | `client.js:355-357` **三层**：`res.value ?? res` → `record.credentials ?? record` → `byRef[ref]` | **不一致（多余 2 层）** | `record.credentials` 这层**不在官方契约里**（我们所有 ref 都是 `*_API_KEY`，不会恰好叫 `credentials`，故当前恒不触发）；它是为旧线 `res.result.value.credentials[ref]`（`:362`）混入的兼容层，掩盖了主路径契约 | 建议修：主路径改 `res.ok ? res.value[ref] : undefined`；多层/旧线兼容收敛到 fallback 分支 |
| ④-2 | `readCredential` 对 `{ok:false}` 的处理（**B 报告未列出，本报告新增必须修项**） | 官方两处都显式判 `ok`：models `:1384-1388` `if (response.ok) ... else { credentialError = response.error.message; break; }`；web-search `:349` `if (!response.ok \|\| ref !== this.ref()) return;`。即**失败要上报/中止，不能当「未配置」** | `client.js:354-357` **完全不读 `res.ok`**：`{ok:false, error:{code,message,...}}` 先被 `res.value ?? res`（`value` 不存在 → 取整个 error 包络），再被 `record.credentials ?? record`（无 `credentials` → 仍取包络），最后 `byRef["TAVILY_API_KEY"]` → `undefined`；`:364` `if (view === undefined) return;` 静默返回；外层 `:366` `catch { /* ignore */ }` 吞异常 | **不一致（功能缺陷）** | `describe` 失败（provider 未挂、ref 非法、carrier 断线）时：① 「已配置」徽标不亮且**无任何错误提示**；② 用户看到的是「未配置」而非「读取失败」；③ 因为 `view===undefined` 才走旧线 fallback，可能再打一次不存在的 `connection.api.credentials`；④ 与 `writeCredential`（已正确判 `ok===false`）**不对称** | **必须修**：判 `res.ok`，失败时置错误态并 `republish()`（至少不要让 UI 伪装成「未配置」）。见 §2.1 M1 |
| ④-3 | `configured`/`writable`/`source` 字段名 | `dsh-credentials/lib/types/types.d.ts:60-67` `CredentialInfo {configured: boolean; source?: string; writable: boolean}`；Host `dsh-api-settings-controller/lib/index.js:76-82` `projectCredentialInfo` 逐字投影三字段；官方 web-search `:353-354` 读 `view?.configured` / `view?.writable`；models `:1442,2298,2549` 同 | `client.js:365` `keyState.set(ref, { configured: view.configured === true, writable: view.writable !== false })`；`:519-520,724` 用 `configured` + `writable===false` 驱动 `envProvided`/`readOnly`；**完全不读 `view.source`** | **字段名一致；`source` 未用** | `source` 官方定义即「当前供给层」，是「环境变量提供」的**权威判据**；我们用 `writable===false` 推断 env-shadowed（E，无官方依据）。Issue #8「临时绕过：导出同名变量…但卡片仍显示未配置」正是 `source` 语义未对齐的表征 | 建议修：用 `view.source`（如 `'env'`/`'file'`）驱动 `envProvided`；`writable` 只用于禁用输入 |
| ⑤ | settings 定位：官方 vs 我们 `findNamespace` vs PR #7 | 官方一律 **`ns` 精确匹配**：`dsh-client-ui-settings/lib/client.js:1214` `namespaces.find(c => c.ns === this.spec.namespace)`；models `:1364` `new Map(views.map(v => [v.ns, v]))`；Host `dsh-settings/lib/types/index.js:359` `this.describe().find(row => row.ns === ns)`。PR #7 patch（D：GitHub API 取 `pulls/7/files`）：`rows.find(r => r && r.ns === NAMESPACE) ?? rows.find(r => r.value && "searxngBaseURL" in r.value)` —— **ns 优先 + 形状兜底** | `settings-api.js:130-136` `findNamespace` = **形状优先**（`DISCOVERY_FIELDS=["numResults","backendTimeoutMs","enabledBackends","enableExa"]`，`:45`）→ `?? rows.find(row => row.ns === "dsh-websearch")`；`index.js:463-475`（**当前版本**）= `ns === "dsh-websearch"` 优先 → `?? ns === NAMESPACE` → `?? "searxngBaseURL" in r.value` | **不一致（三处口径）** | ① 官方/PR #7 **ns 优先**，我们形状优先；② 字面量混用：`settings-api.js:135` 用 `"dsh-websearch"`，`index.js:54` `NAMESPACE="unified-search"`，`client.js:11` `PLUGIN_NS="unified-search"`，而 `cordis.patch.yml:8` entry id = `dsh-websearch`。D：`dsh --profile web --dump-config` 第 1463 行确认组合后条目 `- id: dsh-websearch`，且 `dsh-settings/lib/types/index.js:296` `ns: entry.options.id` ⇒ **真实 ns 是 `dsh-websearch`**，`"unified-search"` 只是旧线 `installSection` 的名字；③ `index.js`（15:40 已修）现在正确，`settings-api.js` 仍形状优先但兜底字面量 `"dsh-websearch"` **恰好与真实 ns 一致** → 当前可工作 | **建议修**：把 `settings-api.js` 的 `findNamespace` 改成 `ns` 优先（与 `index.js:471` 对齐），形状兜底保留但改用它真正需要的字段；把三个常量统一/注释清楚。注意：B 报告 §2.1 M1 判为「必须修」并要求改成 `"unified-search"`，**本报告不认同该具体改法**——`--dump-config` + `:296` 证明真实 ns 是 `dsh-websearch`，改成 `unified-search` 会让主查找变成死代码（正是 PR #7 的毛病），故降为「建议修」并给出相反的具体建议 |
| ⑥ | `save()` 失败呈现与 UI `.find` 同构性 | 官方 models `:3171-3174` `storeCredential` 返回 `response.ok ? void 0 : response.error.message`（**message 字符串**）；`:1616-1617` `if (stored !== void 0) return stored;` → `:1625-1628` `setFailure(outcome)` → 以 `<p className="...error">` 渲染（`:1758-1760`）。`writeSettings` `:3180-3190` 把 `settings/conflict` 折成 `{kind:"conflict"}`、其余 `{kind:"refused",message}`；UI `:1611` conflict 用专属文案 | `client.js:449-454` `failedKeys.set(ref, String(keyErr.message).slice(0,140))`；`:318` `failedKeys: [...map].map(([ref,reason])=>({ref,reason}))`；`KeyedBackendCard` `:522` `(state.failedKeys??[]).find(f => f && f.ref === b.keyEnv)` → `:549` 渲染 `t("keyFailed") + ": " + failure.reason`；可选 Key 区 `:716,730` 同构 | **同构（语义等价）** | 官方是「每 editor 一个 failure 字符串」，我们是「按 ref 的 Map→数组→find」；差异：官方原样 `message`，我们截断 140 字符 + 加 `keyFailed` 前缀；官方对 conflict 用专属 `t("conflict")`，我们对 credential 失败统一 `keyFailed` | 可接受；建议修（可选）保留 `error.code`。**注意**：`client.js:521,714` 两处注释「failedKeys 是 `[{ref,reason}]` 不是字符串数组，旧 `.includes()` 永不匹配」说明此缺陷已被修过，无回归（A） |
| ⑦ | 版本差异 / rc.5 兼容 | D：`npm view @deepseek-ai/dsh versions --json` 含 `0.2.1-rc.1..rc.5`、`0.2.2-alpha.2/3`、`0.2.2-rc.1`；`dist-tags.latest=0.2.2-rc.1`。D：`npm pack` 解包 rc.5 的 `dsh-api-settings-controller` / `dsh-client-ui-settings-models` / `dsh-api-gateway` / `dsh-typert-protocol` / `dsh-credentials`，`diff` 结果：`typert.remote-client.d.ts` **IDENTICAL**、`RemoteResult`/`CredentialInfo` **IDENTICAL**、`client.browser.js` **0 行差异**、`credentials.d.ts` **IDENTICAL**、`dsh-api-remotes/lib/client.js` 有 124 行差异但均不在 credentials/settings 契约区（D：diff hunk 检查）。0.2.2-rc.1 的 `typert.remote-client.d.ts` 与 `RemoteResult` 亦 **IDENTICAL**（D：diff）；web-search 插件该版本仅新增 ja/es 字典，`inject` 仍 5 项、`:550` `describe([ref])`、`:648` `set(ref,value)`（D：grep） | 我们对齐的是本机 **0.2.1-rc.2** 的 API 面 | **一致** | **rc.5 / 0.2.2-rc.1 都没有引入 credential 契约破坏性变更**，无需预留兼容分支；Issue #8（rc.5）与本机（rc.2）同 API 面，其修复可直接适用 | 无需改动；把「对齐 rc.2 API 面、rc.5/0.2.2 已验证同签名」写进注释 |
| ⑧ | 事件订阅 | 官方 models `:4467-4479` 订阅 `settings/document-updated`、`credentials/record-updated`、`credentials/reference-updated`、`llm/adapters-updated`、`connection/reset`（`ctx.on`）；web-search `:507-509` 只订阅 `credentials/reference-updated` 并**按 ref 过滤**（`card.refreshCredential(ref)`）；`dsh-api-remotes/lib/types/remote-events.d.ts:63-67,108-109` 三个事件均 `mode:"emit"` | `client.js:787` 循环订阅 `["credentials/reference-updated","credentials/updated"]`（无 ref 过滤，全量 `refreshAllCredentials()`）；`:795` `settings/document-updated`；**无** `record-updated`、**无** `connection/reset` | **部分不一致** | `"credentials/updated"` 在官方 `remote-events.d.ts` 中**不存在**（D：全库 grep 0 命中）：`$on` 的 `subscribe`（`gateway/client.browser.js:796-800`）不校验事件名，订阅永不触发但不报错 → 无害死代码。漏 `credentials/record-updated`：凭证**记录**（`modifyRecord`/grant 刷新）变化不刷新徽标（我们只管 ref 空间，影响有限）。漏 `connection/reset`：**重连后不重读**，这是更实质的缺口——官方所有 settings 类插件都订阅它 | 建议修：移除 `"credentials/updated"`；补 `ctx.on("connection/reset", ...)` 重读；`record-updated` 可选。见 §2.2 S2 |

---

## 2. 偏差清单（三档）

### 2.1 必须修（1 项）

| ID | 偏差 | 依据（A/B/D） | 风险 | 最小改动 |
|---|---|---|---|---|
| **M1** | `readCredential()` 不判 `res.ok`，把 `{ok:false, error}` 静默当「未配置」，且把 error 包络误当 record 解包 | `client.js:354-366` vs 官方 `dsh-client-ui-settings-web-search/lib/client.js:349` `if (!response.ok ...) return;`、models `:1384-1388` `if (response.ok) ... else {credentialError = response.error.message; break;}`；`typert.remote-client.d.ts:14` + `types.d.ts:110-116` 保证失败分支必带 `error` | describe 侧故障（provider 未挂 `gateway/internal`、ref 非法 `gateway/bad-request`、断线 `gateway/cancelled`）时 UI **伪装成「未配置」**，用户无法区分「没填」与「读不到」；还会误触发不存在的旧线 `connection.api.credentials` 回退。与已正确判 `ok` 的 `writeCredential`（`:384`）**不对称** | 在 `:354` 之后先判包络：`if (res && typeof res === "object" && res.ok === false) { /* 置 credentialError 状态 + republish，跳过旧线 fallback */ return; }`；成功路径改一层 `const view = res.ok === true ? res.value?.[ref] : undefined`。见 §4 |

> **说明**：B 报告 §2.1 列了 2 项「必须修」（M1 = `findNamespace` 形状优先/字面量；M2 = `remote.credentials` 依赖固化）。本报告**不把这两项判为必须修**：
> - B-M1 的具体建议「改成 `ns === NAMESPACE("unified-search")` 优先」与 `dsh --profile web --dump-config:1463`（`- id: dsh-websearch`）+ `dsh-settings/lib/types/index.js:296`（`ns: entry.options.id`）的运行时实证**相反**；当前 `settings-api.js:135` 的兜底字面量 `"dsh-websearch"` 恰好正确，`index.js`（15:40 已修）也把 `ns === "dsh-websearch"` 放首位 → 当前可工作，只是口径不优雅。降为「建议修」。
> - B-M2 自己也注明「当前 package 已含 `@deepseek-ai/dsh-api-remotes`…是潜在组合风险而非当前故障」（`:44`），且 `tests/lead-20261106.test.js:198-202` 已固化 → 归「可接受/注释」。
> 反之，B 报告**未列**的 ④-2 是真实现存缺陷，故本报告只保留 1 项必须修。

### 2.2 建议修（6 项）

| ID | 偏差 | 依据 | 建议 |
|---|---|---|---|
| **S1** | `connection` 是多余 service 依赖（①-5） | 官方两个同类插件 inject 均无 `connection`（`grep` 0 命中）；D `/tmp/inject_check5.mjs`：不声明时 `ctx.get("connection")` 仍返回对象；`connection.api.credentials` 在发布版全库 0 命中（E） | 二选一：① 保留旧线回退则保留声明并加注释说明「这是硬依赖」；② 删除旧线回退 → 从 `inject` 去掉 `connection`、改用 `ctx.get("connection")`（已验证可行），减少一个整卡不激活的风险面 |
| **S2** | 事件订阅含无效名 `"credentials/updated"`、漏 `connection/reset`（⑧） | `dsh-api-remotes/lib/types/remote-events.d.ts:63-67,108-109`；`gateway/client.browser.js:796-800` 不校验事件名；官方 `:4478` / `dsh-client-ui-settings/lib/client.js:1491` 都订阅 reset | 移除 `"credentials/updated"`；补 `ctx.on("connection/reset", () => { controller.refreshAllCredentials(); if (bridge.load) bridge.load(); })`；可选补 `credentials/record-updated` 并按 ref 过滤（官方 web-search `:507-509` 做法） |
| **S3** | 主路径三层解包多余（④-1） | `typert.remote-client.d.ts:14` + Host `dsh-api-settings-controller/lib/index.js:156-160`（`value` 已是按 ref 扁平 record） | 主路径收敛为官方一层；`record.credentials` / `res.result.value.credentials` 兼容只留在旧线 fallback 分支（`:359-362`） |
| **S4** | `source` 字段未用，`envProvided` 用 `writable===false` 推断（④-3） | `dsh-credentials/lib/types/types.d.ts:63-64`；Host `:76-82` 投影 `source`；Issue #8「导出同名变量…卡片仍显示未配置」 | 用 `view.source`（`'env'`/`'project-env'`/`'file'`/`'user-env'`）驱动 `envProvided`；`writable` 仅用于禁用输入 |
| **S5** | `set` 失败丢弃 `error.code`/`details`、message 截断 140（③-2、⑥） | `remote-error.d.ts:10-14`；`dsh-api-settings-controller/lib/index.js:192,208` 区分 `gateway/internal` 与 `credential/rejected` | `failedKeys.reason` 保留 `code`；conflict/内部错误给不同文案（官方 `:3186-3192` 范式） |
| **S6** | `findNamespace` 形状优先 + 三个 id 常量混用（⑤） | 官方 `dsh-client-ui-settings/lib/client.js:1214`、models `:1364`、Host `:359` 都是 `ns` 优先；`--dump-config:1463` 真实 ns=`dsh-websearch`；`client.js:11` `PLUGIN_NS`/`index.js:54` `NAMESPACE`=`unified-search` | 改 `findNamespace` 为 `row.ns === "dsh-websearch"` 优先（**不是** `unified-search`），形状兜底保留；注释说明 `unified-search` 是旧线 `installSection` 名、`dsh-websearch` 是 0.2.x `entry.options.id`；与 `index.js:471` 对齐 |
| **S7** | 11 个 ref 逐个单发 `describe`（②-1） | 官方 `:1382-1389` 按 `MAX_DESCRIBE_REFS=64` 批量（D：`settings-controller/lib/index.js:55`）；我们 11 个远小于 64 | 合并为一次 `describe(BACKENDS.filter(b=>b.keyEnv).map(b=>b.keyEnv))`，与官方同构、减少往返 |

### 2.3 可接受（4 项）

| ID | 偏差 | 理由 |
|---|---|---|
| A1 | `inject` 未列 `remote.llm/settings/session`、`configForms`、`settingsSchema`（①-1/①-2） | 官方 web-search 插件的最小集就是 5 项；我们没访问这些 service，缺了不会不激活；盲目补齐反而增加「声明但 host 未注册 → 整卡 park」的依赖面（①-3） |
| A2 | `settings-api.js` 用 Host 侧同步 `settings.describe()` 而非远程 `ctx.remote.settings.describe()`（②-2） | 两个 `describe` 是不同对象；我们的注入源是 `settingsForms`（`index.js:537`），对该对象的无参/同步/数组写法**正确**；换成远程包络版反而全错 |
| A3 | `failedKeys` 用 `[{ref,reason}]` + `.find` 而非官方「每 editor 一个 failure 字符串」（⑥） | 语义等价；`client.js:521,714` 注释证明旧的 `.includes()` bug 已修；截断/前缀只是文案差异 |
| A4 | `try/catch` 包裹 `this.remote.credentials` 属性访问（`:351,381`） | 官方直接 `ctx.remote.credentials`，但在「某些 host 不注册该命名空间」时我们的写法能退到旧线；`inject` 已声明该键，正常路径不会触发 catch。属防御性冗余，无害 |

---

## 3. 官方契约摘录（路径:行号原文片段）

> 全部为本机发布版 `0.2.1-rc.2` 的绝对路径，前缀 `R = /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai`。

**C-1 · 远程方法精确签名（A/B）** — `R/dsh-api-settings-controller/lib/typert.remote-client.d.ts:12-24`
```
12	declare module '@deepseek-ai/dsh-typert-protocol' {
13	  interface TypertRemoteNamespace$63726564656e7469616c73 {
14	    describe: (refs: string[]) => Promise<RemoteResult<Record<string, CredentialInfo>>>
15	    set: (ref: string, value: string) => Promise<RemoteResult<void>>
16	    unset: (ref: string) => Promise<RemoteResult<void>>
17	  }
18	  interface TypertRemoteNamespace$73657474696e6773 {
19	    describe: () => Promise<RemoteResult<SettingsDescribeValue>>
20	    mutate: (ns: string, ops: SettingsPathOpView[], expectedRevision: number | undefined) => Promise<RemoteResult<SettingsNamespaceView>>
```
`TYPERT_REMOTE` 同文件 `:41-50` 把 `credentials/set` 声明为 `TypertRemoteMethod<{readonly 'ref': string; readonly 'value': string}, void>`（`:43`）——**两个位置参数**，`void` 结果。

**C-2 · RemoteResult 包络（A）** — `R/dsh-typert-protocol/lib/types/types.d.ts:103-116`
```
110	export type RemoteResult<T> = {
111	    readonly ok: true;
112	    readonly value: T;
113	} | {
114	    readonly ok: false;
115	    readonly error: RemoteFailure;
116	};
```
`:104-107`：「the Remote face itself folds carrier failures into the error branch, so no consumer wraps a call to recover one; only assembly faults (arity, an unmounted method, a missing Context adapter) still reject.」

**C-3 · 错误对象是 Error 实例（A）** — `R/dsh-typert-protocol/lib/types/remote-error.d.ts:1-21`
```
 7	 * `RemoteResult` error branch, so `throw result.error` keeps throw semantics.
 8	 * Discrimination is always by `code`, never by instanceof.
10	export declare class RemoteError<Code extends RemoteErrorCode = RemoteErrorCode> extends Error {
11	    readonly code: Code;
12	    readonly details: RemoteErrorDetailsMap[Code];
14	    readonly isDSHRemoteError: true;
21	    constructor(code: Code, message: string, details: RemoteErrorDetailsMap[Code], options?: ErrorOptions);
```
即 `error.message` **必有**，`error.code`/`error.details` 额外可用；**不存在**第三种 resolve 分支。

**C-4 · CredentialInfo 三字段（A）** — `R/dsh-credentials/lib/types/types.d.ts:60-67`
```
60	export interface CredentialInfo {
62	    configured: boolean;
64	    source?: string;
66	    writable: boolean;
67	}
```
Host 投影原文 `R/dsh-api-settings-controller/lib/index.js:76-82`：
```
76	function projectCredentialInfo(info) {
77		return {
78			configured: info.configured,
79			...info.source === void 0 ? {} : { source: info.source },
80			writable: info.writable
81		};
82	}
```

**C-5 · describe 的 value 是扁平 ref→info record（A）** — `R/dsh-api-settings-controller/lib/index.js:156-160`
```
156			async describe(refs) {
157				const branded = parseRequest("credentials.describe", describeRequestSchema, { refs }).refs.map((ref) => [ref, credentialRef(ref)]);
158				const credentials = this.provider();
159				const entries = await Promise.all(branded.map(async ([ref, key]) => [ref, projectCredentialInfo(await credentials.describe(key))]));
160				return Object.fromEntries(entries);
```
⇒ 官方 `response.value[ref]` 就是 `CredentialInfo`；**没有 `value.credentials` 层**。

**C-6 · 官方调用形式：位置数组 + 判 ok（A/B）**
- `R/dsh-client-ui-settings-models/lib/client.js:1383-1388`
```
1383					const response = await this.ctx.remote.credentials.describe(refs.slice(index, index + 64));
1384					if (response.ok) Object.assign(credentials, response.value);
1385					else {
1386						credentialError = response.error.message;
1387						break;
1388					}
```
- `R/dsh-client-ui-settings-web-search/lib/client.js:348-350`
```
348				const response = await this.ctx.remote.credentials.describe([ref]);
349				if (!response.ok || ref !== this.ref()) return;
350				const view = response.value[ref];
```
- `R/dsh-client-ui-settings-models/lib/client.js:3171-3174`
```
3171				storeCredential: async (ref, value) => {
3172					const response = await ctx.remote.credentials.set(ref, value);
3173					return response.ok ? void 0 : response.error.message;
3174				},
```
- `R/dsh-client-ui-settings-web-search/lib/client.js:443-447`
```
443			async writeKey(value) {
444				await this.ctx.remote.credentials.set(this.ref(), value);
445				await this.readCredential();
446				return this.credential.configured;
447			}
```

**C-7 · 官方 inject（两个同类插件，A/B）**
- `R/dsh-client-ui-settings-models/lib/client.js:4417-4427`（9 项，因为用到 llm/session/settings/schema）
```
4417			const inject = [
4418				"slots",
4419				"locale",
4420				"remote",
4421				"remote.credentials",
4422				"remote.llm",
4423				"remote.settings",
4424				"remote.session",
4425				"configForms",
4426				"settingsSchema"
4427			];
```
- `R/dsh-client-ui-settings-web-search/lib/client.js:482-488`（**5 项，与我们最接近**）
```
482			const inject = [
483				"slots",
484				"locale",
485				"remote",
486				"remote.credentials",
487				"configForms"
488			];
```

**C-8 · 网关注入规则与 cordis 抛错（A）**
- `R/dsh-api-gateway/lib/client.browser.js:2074-2076`
```
2074			function remoteServiceKey(namespace) {
2075				return `remote.${namespace}`;
2076			}
```
- `:1773-1781`：`createNamespace` 用 `this.ownerCtx.plugin({ name: remoteServiceKey(name), apply: (ctx) => { service = new RemoteNamespaceService(ctx, name, ...) } })` —— **每个 namespace 是独立 Service**。
- `:1734-1741`：`validateContribution` 检查 `ownerCtx.get(serviceKey) !== void 0` 才判冲突。
- `R/cordis/lib/index.js:673-695`（属性代理）
```
676				const error = /* @__PURE__ */ new Error(`cannot get property "${prop}" without inject`);
...
687							if (prop in fiber.inject) {
688								error.message = `cannot get required service "${prop}" in inactive context`;
689								throw error;
```
- `R/cordis/lib/index.js:1320-1326`（`Fiber._refresh`）：任一 inject 名取不到实现 → `epoch = INACTIVE` → 整个 fiber park。
- D 复现实跑（`/tmp/inject_check.mjs`、`/tmp/inject_check2.mjs`、`/tmp/inject_check4.mjs`、`/tmp/inject_check5.mjs`）：`inject:['remote']` 时 `ctx.remote.credentials` **THROW**；加 `'remote.credentials'` 后返回 OBJECT；`ctx.get("remote")` 返回的是 **traceable proxy**，其 `.credentials` 仍受 inject 约束（THROW）；声明未提供的 service 时 `apply` **不执行**；不声明 `connection` 时 `ctx.get("connection")` 仍返回对象。

**C-9 · 两级 inject（A）** — `R/dsh-client-modules/lib/client.js:61-75,789-792`
```
66				const inject = optionalStringArray(pkgName, "dsh.client.inject", decl.inject);
...
789					for (const packageName of row.inject) {
790						const dependency = this.graphRows.get(packageName);
791						if (dependency !== void 0) await this.arriveDependency(row.id, dependency, [], visited);
792					}
```
⇒ `dsh.client.inject` 是**包名 → 模块加载依赖**；`exports.inject` 才是 cordis service 依赖（`R/dsh-cordis-client-runner/lib/client.js:183`：「Declare inject: ['slots'] on the returned plugin」、`:590` `waitingFor: Object.keys(fiber.inject)...`）。

**C-10 · 两个 `describe` 不同对象（A）**
- Host：`R/dsh-settings/lib/types/index.d.ts:96` `describe(options?: SettingsDescribeOptions): SettingsDescriptor[]`；实现 `R/dsh-settings/lib/types/index.js:270-310`（`:296` `ns: entry.options.id`）。
- 远程：`R/dsh-client-ui-settings/lib/client.js:1447-1448`
```
1447						const response = await this.ctx.remote.settings.describe();
1448						outcome = response.ok ? { view: response.value } : { failure: response.error.message };
```
- `ns` 精确定位：`R/dsh-client-ui-settings/lib/client.js:1214` `...namespaces.find(candidate => candidate.ns === this.spec.namespace)`；`:1432-1433` `namespace(ns) { return this.store.getSnapshot().view?.namespaces.find((row) => row.ns === ns); }`；Host `R/dsh-settings/lib/types/index.js:359` `this.describe().find(row => row.ns === ns)`。

**C-11 · 事件名单（A）** — `R/dsh-api-remotes/lib/types/remote-events.d.ts:63-67,108-109`
```
63	    readonly event: "credentials/record-updated";
64	    readonly mode: "emit";
65	}, {
66	    readonly event: "credentials/reference-updated";
67	    readonly mode: "emit";
...
108	    readonly event: "settings/document-updated";
109	    readonly mode: "emit";
```
`R/dsh-client-ui-settings-models/lib/client.js:4467-4479` 订阅这五个（含 `:4478` `ctx.on("connection/reset", refreshModels)`）；`R/dsh-client-ui-settings-web-search/lib/client.js:507-509` 只订阅 `credentials/reference-updated` 并 `card.refreshCredential(ref)`。D：全库 `grep` 无 `"credentials/updated"`。

**C-12 · 版本面（C/D）**
- `npm view @deepseek-ai/dsh dist-tags --json` → `latest: 0.2.2-rc.1`, `next: 0.2.2-rc.1`, `alpha: 0.2.2-alpha.3`；`versions` 含 `0.2.1-rc.1..rc.5`。
- 本机 `package.json` → `0.2.1-rc.2`；全部官方子包同版本（D：`grep '"version"'`）。
- `npm pack` rc.5 五个子包 `diff`：`typert.remote-client.d.ts` / `RemoteResult` / `CredentialInfo` / `credentials.d.ts` / `client.browser.js` **全部 IDENTICAL（0 差异）**；`dsh-api-remotes/lib/client.js` 124 行差异不含 credentials/settings 契约。0.2.2-rc.1 的 `typert.remote-client.d.ts` 与 `RemoteResult` 亦 IDENTICAL；web-search 插件该版仅增 ja/es 字典，`inject` 仍 5 项、`:550` `describe([ref])`、`:648` `set(ref,value)`。

**C-13 · 上游 PR #7 / Issue #8 全文（C/D，认证 GitHub API；token 未写入任何输出）**
- 仓库 `240xu/dsh-websearch`（`zcode-research` 是私有资料库，PR/Issue 不在此）；`GET /repos/240xu/dsh-websearch/pulls/7` → **open**，标题 `fix: settings are inert on DSH 0.2.x (no installSection) + RFC1918 plain-http base URLs rejected`，报告环境 `@deepseek-ai/dsh@0.2.2-alpha.2`。
- PR #7 `lib/index.js` patch 原文（`/pulls/7/files`）：
```
+      current = () => {
+        try {
+          const rows = settings.describe();
+          const row = rows.find((r) => r && r.ns === NAMESPACE)
+            ?? rows.find((r) => r && r.value && typeof r.value === "object" && "searxngBaseURL" in r.value);
+          return (row && row.value) ?? config;
+        } catch {
+          return config;
+        }
+      };
```
（`:459-479` 的当前 `index.js` 已在此基础上补 `ns === "dsh-websearch"` 优先，注释 `:464-470` 明说「upstream PR #7 matched only the latter, so its primary lookup was dead code」——与本报告 §1⑤ 的 `--dump-config` 实证一致。）
- `GET /issues/8` → **open**，标题 `保存 API Key 失败：client inject 缺少 remote.credentials（DSH 0.2.x）`，环境 `@deepseek-ai/dsh@0.2.1-rc.5` + 插件 2.8.8；根因原文引用 `dsh-api-gateway/lib/client.browser.js:2074` 与 `cannot get property "remote.credentials" without inject`；建议修复 diff 原文：
```
-const inject = ["slots", "locale", "connection", "remote"];
+const inject = ["slots", "locale", "connection", "remote", "remote.credentials"];
```
以及 `set()` 判 `res.ok === false` 抛 `res.error?.message`。→ **我们 `client.js:758,384-385` 已逐字落地**。
- Issue #8 评论：`240xu` 2026-11-05「稍等稍等，马上解决!」、2026-11-07「ok了，感谢」（Issue 仍 open）。
- Issue #8 §「已排除」原文给出直连 RPC 响应：`POST /api/credentials/describe` → `{"ok":true,"value":{"TAVILY_API_KEY":{"configured":false,"writable":true}}}`；`POST /api/credentials/set` → `{"ok":true}`；再 describe → `{"PROBE_TEST_KEY":{"configured":true,"source":"file","writable":true}}`。→ 与 C-4/C-5 逐字吻合，**实证 `source` 字段确实出现**。

---

## 4. 我们应补的最小改动（**仅建议，未实施**）

> 只列「必须修 M1」的可直接套用 diff 与「建议修」的一行级调整；**不改源码/配置**。

**M1（必须修）** — `src-work/plugin/lib/client.js:344-368` `readCredential()`：
```diff
  					if (api !== undefined && typeof api.describe === "function") {
-						// 0.2.x remote face: Record<ref, {configured, writable, source}> behind {ok, value}.
-						const res = await api.describe([ref]);
-						const record = res !== null && typeof res === "object" && res.value !== undefined ? res.value : res;
-						const byRef = record !== null && typeof record === "object" && record.credentials !== undefined ? record.credentials : record;
-						view = byRef !== null && typeof byRef === "object" ? byRef[ref] : undefined;
+						// Official face: RemoteResult<Record<ref, CredentialInfo>>. One layer only.
+						const res = await api.describe([ref]);
+						if (res !== null && typeof res === "object" && res.ok === false) {
+							// Surface the failure instead of rendering "not configured".
+							this.credentialError = res.error?.message ?? "credential describe failed";
+							this.republish();
+							return;
+						}
+						view = res !== null && typeof res === "object" && res.ok === true
+							? (res.value !== null && typeof res.value === "object" ? res.value[ref] : undefined)
+							: undefined;
  					}
-					if (view === undefined && this.connection !== undefined && ... ) { /* 旧线 */ }
+					if (view === undefined && /* 仅当本次不是 describe 拒绝时 */ ... ) { /* 旧线 fallback 保留，多层解包收敛到这里 */ }
  					if (view === undefined) return;
-					this.keyState.set(ref, { configured: view.configured === true, writable: view.writable !== false });
+					this.keyState.set(ref, { configured: view.configured === true, writable: view.writable !== false, source: view.source });
```
配套：`projection()` 增加 `credentialError` 字段，UI 在 `KeyedBackendCard`/状态栏显示（避免「假未配置」）；`KeyedBackendCard` 用 `source` 驱动 `envProvided`（S4）。

**一行级建议修**：
1. S1：`inject` 去掉 `"connection"`，`apply` 保留 `ctx.get("connection")`（D 已验证可行）；或保留但注释硬依赖。
2. S2：`client.js:787` 改为 `["credentials/reference-updated"]`（去掉无效的 `credentials/updated`），并新增 `ctx.effect(() => ctx.on("connection/reset", () => { controller.refreshAllCredentials(); if (typeof bridge.load === "function") void bridge.load(); }), ...)`。
3. S3：主路径解包收敛为一层（见 M1 diff）；`res.result.value.credentials` 只留旧线分支。
4. S5：`client.js:452` 改为 `String(keyErr.code ? keyErr.code + ": " + keyErr.message : keyErr.message)`；`writeCredential` 抛错时把 `res.error.code` 带上（如 `new Error(\`${res.error?.code ?? "remote"}: ${res.error?.message ?? ...}\`)`）。
5. S6：`settings-api.js:130-136` 改为 `rows.find(r => r.ns === "dsh-websearch") ?? 形状兜底`（**不是** `unified-search`），并在 `:45` 注释 `DISCOVERY_FIELDS` 与 `Config.dict` 的关系；`index.js`（当前已修）无需再动。
6. S7：`refreshAllCredentials()` 合并为一次批量 `describe(refs)`（11 < 64）。

---

## 5. 无法确认项（E，显式缺口）

| ID | 缺口 | 现状 / 影响 |
|---|---|---|
| **E1** | `connection.api.credentials` 旧线对象（`client.js:359-362,388-393` 的 `{refs:[ref]}` / `{ref,value}` / `res.result.ok` / `res.result.value.credentials[ref]`）在发布版 0.2.1-rc.2 全库 `grep` **0 命中** | 属兼容猜测，不能当官方契约；若该对象确实不存在，这两段是死代码，且 `readCredential` 在 describe 失败时会白跑一次（M1 的附带风险）。建议以「是否存在旧 host 线」为前提决定去留 |
| **E2** | `credentialError` 应如何在我们的卡片里呈现 | 官方 models 把它放进 `s.credentialError`（`:1394`）并由 onboarding/卡片读取；我们没有对应 UI 槽位。M1 若只「不伪装未配置」而不给文案，仍不够友好 —— 具体文案落点需 lead 定 |
| **E3** | `view.source` 的取值域与 `envProvided` 判据 | `dsh-credentials/lib/types/index.d.ts:74-75` 注明 local provider 用 `env`/`file`/`project-env`/`user-env`；但「哪些 source 应显示 envProvided、哪些应禁用输入」未在官方 UI 找到逐字映射（web-search 插件只读 `configured`/`writable`）。S4 需实测确认 |
| **E4** | `configForms` / `settingsSchema` 是否存在更稳健的「官方写法」可替代我们的 `findNamespace` | 官方 `dsh-client-ui-settings/lib/client.js:1214,1432-1433` 用 `ns` 精确匹配 + `whileServed`（`:1315-1334`）判断「host 是否服务某 namespace」。我们走自有 HTTP 路由、不用 `configForms`，故不能直接照搬；是否值得迁移到 `configForms.whileServed` 需 lead 评估（涉及大改） |
| **E5** | 本机 GUI 的实时 client Service 目录 | `cordis_inspect_query(client, Service, listService)` 返回 `no connected Harness page`（无浏览器页连接）；带 `input` 的查询被 Inspect 通道判 `"input" must be an object`（与 02-runtime-state.md:345 记录的同缺陷）。故 `remote.credentials` **在本机 profile 运行时**已挂载的证据来自 `dsh --dump-config`（含 `dsh-api-remotes`）、`38-e2e-save-probe.md:52` 与 Host `settings-controller/lib/index.js:144` 的 `super(ctx, "credentialsController", {namespace:"credentials"})`，非 client 实时反射 |
| **E6** | PR #7 / Issue #8 是否有后续 commit 改变契约 | 两者 GitHub 状态均 **open**（Issue #8 作者 11-07 回「ok了，感谢」但未关闭）；`/pulls/7/commits` 返回空、`/pulls/7/comments` 空。本次只取到 PR 描述 + 3 个文件 patch + Issue 全文 + 2 条评论，未逐 commit 追后续 |

---

## 6. 附：本机只读实跑记录（D）

| 命令 / 操作 | 结果 |
|---|---|
| `node -p require('/usr/local/lib/node_modules/@deepseek-ai/dsh/package.json').version` | `0.2.1-rc.2` |
| `npm view @deepseek-ai/dsh dist-tags --json` / `versions --json` | `latest/next = 0.2.2-rc.1`；含 `0.2.1-rc.5`、`0.2.2-alpha.2` 等 |
| `npm pack @deepseek-ai/dsh{,-api-settings-controller,-client-ui-settings-models,-client-ui-settings-web-search,-api-gateway,-typert-protocol,-credentials,-api-remotes}@0.2.1-rc.5` + `diff` | 契约文件全 IDENTICAL；`client.browser.js` 0 差异；`dsh-api-remotes/lib/client.js` 124 行差异不含 credentials/settings |
| 同法 `0.2.2-rc.1` | `typert.remote-client.d.ts`、`RemoteResult` IDENTICAL；web-search 仅增 ja/es 字典 |
| `node /tmp/inject_check*.mjs`（cordis 最小复现） | 未声明 `remote.credentials` → THROW `cannot get property "remote.credentials" without inject`；声明后 OBJECT；`ctx.get("remote")` 返回 traceable proxy，`.credentials` 仍 THROW；声明未提供的 service → `apply` 不执行；不声明 `connection` → `ctx.get("connection")` 仍 OBJECT |
| `node /tmp/unwrap_check.mjs` | 官方 `{ok:true,value:{ref:info}}` → 我们的三层解包得 info（正确）；`{ok:false,error}` → `view=undefined`（**静默**，M1）；`{ok:true,value:undefined}` → `undefined` |
| `node /tmp/i18n4.mjs` | zh 54 键 / en 54 键，完全平衡，无重复；`t(key, params)` 由 `dsh-client-ui-renderer/lib/client.js:542-557` `localeSeat` 提供，`dsh-client-locale/lib/client.js:1423-1427` 支持 `{name}` 插值 ⇒ `props.t("keyLabel",{id})`（`client.js:719`）签名正确 |
| `dsh --profile web --dump-config`（只读） | 第 1463 行 `- id: dsh-websearch` / `name: '@240xu/dsh-websearch'`，第 1462 行注释 `patched by /home/dsh/.dsh/profiles/web/cordis.patch.yml` |
| `curl -sS http://127.0.0.1:3080/api/unified-search/settings` | `{"ok":false,"error":"untrusted request"}` HTTP 401 —— 路由受 admission fence 保护，符合 `settings-api.js` 注释；未带凭证故未越权读取 |
| 认证 GitHub API（Basic `U=x-access-token`；`P=${TOK#*:}`，token 未写入任何输出文件/报告） | `/user` → `240xu`；`/repos/240xu/dsh-websearch` 200（public）；`/pulls/7`、`/issues/8`、`/pulls/7/files`、`/issues/8/comments` 全文取回 |
| `cordis_inspect_list` + `cordis_inspect_query(host, Tool, listTools)` | 46 个工具中**无** `team_task_get` / `team_task_update` / `team_task_list`；`20-content-assessment.md:151,188` 亦记录子代理会话 `team_task_*` 返回 `unknown tool` → **task-16 无法在本会话 claim/complete**，须由 lead 代为收口（见 §7） |

---

## 7. 任务板与交付说明

- **task-16 claim→complete 未能执行**：本子代理会话的工具清单（含 host Inspect 回传的 46 个工具）**不含** `team_task_get` / `team_task_update`（D，§6 末行）；与 `20-content-assessment.md:188` 的历史记录一致。按用户「先 team_task_get 拿 revision」的要求，第一步即被阻断。已通过 `send_message` 向 lead 汇报，请 lead 代为把 task-16 标 complete。
- **只写了一个文件**：本文件 `33-official-alignment-client.md`。未改源码、配置、其它报告；`/tmp` 下的临时脚本与 `npm pack` tarball 均在会话外，不属交付物。
- **与 33-b 的重合处理**：①-1/②-1/②-2/③-1/③-2/④-1/⑥ 的结论与 B 一致，本报告给出**独立证据路径**（尤其 `dsh-api-remotes/lib/client.js:2951-2998` wire spec、Host `projectCredentialInfo`、`--dump-config`）；**新增/修正**的是 ④-2（M1，必须修）、①-4（两级 inject）、①-5（`connection` 多余）、⑤（对 B-M1 具体改法的反证）、⑧ 的 `connection/reset` 实证。
