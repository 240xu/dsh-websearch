# 33-b · 官方对齐备份 · 客户端凭证契约（逐字逐签名交叉复核）

> 任务来源：Lead 2026-11-07「官方对齐备份 · 客户端凭证契约」。**只写本文件**，不改源码/配置/其它报告，全程只读调研，未泄露任何 token 值。
>
> **前置检查（D，2026-11-07）**：`33-official-alignment-client.md` 在 `.artifacts/websearch-research/` 中**不存在**（`ls` 实测 ABSENT），故本报告为完整备份版而非「交叉复核补遗」。`33-official-alignment-client-b.md` 亦为新建。本报告**不复述** 25/99 号结论，只做「我们的插件客户端 ↔ 发布版官方插件」的签名级对齐。
>
> **证据等级**（沿用 03 号报告 §8）：**A** = 源码实证（本机绝对路径:行号 / GitHub 带 ref 永久链接）；**B** = 官方一手文档/发布版源码（URL + 访问日期 + HTTP 状态或本机 `package.json` 版本）；**C** = 版本记录（git tag / commit / npm 版本 / issue 编号 / PR 编号）；**D** = 本机实测（只读 `ls`/`grep`/`node -p`/`npm pack`/GitHub API 实跑输出）；**E** = 推断或待核实（显式写缺口，不当结论）。
>
> **取证路径（D）**：本机发布版根目录 `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`，实测版本 **`@deepseek-ai/dsh@0.2.1-rc.2`**（`node -p require(...).version`，2026-11-07）。上游 PR #7 / Issue #8 经认证 GitHub REST API 取回全文（`https://api.github.com/repos/240xu/dsh-websearch/...`，2026-11-07，HTTP 200）；token 从 `/opt/xr-research/zcode-research/.git/config` 的 remote URL userinfo 按 Lead 给的 `U=x-access-token; P=${TOK#*:}` 规则在内存中提取，**未写入本报告、未打印、未落任何产物文件**。

---

## 1. 逐项对齐表（官方做法 / 我们做法 / 一致? / 风险 / 建议）

> 「我们」= `/home/ova/dsh/.artifacts/websearch-research/src-work/plugin/lib/client.js`（840 行，bundled 客户端，`@240xu/dsh-websearch@2.8.4`）+ `lib/settings-api.js`（277 行，Host 侧 fenced HTTP 桥）。「官方」= 发布版 `@deepseek-ai/dsh-client-ui-settings-models@0.2.1-rc.2/lib/client.js`（4526 行）及其依赖包。

| # | 契约点 | 官方做法（A/B，路径:行号） | 我们做法（A，路径:行号） | 一致? | 风险 | 建议 |
| --- | --- | --- | --- | --- | --- | --- |
| ①-1 | `inject` 数组 | `dsh-client-ui-settings-models/lib/client.js:4417–4427` = `["slots","locale","remote","remote.credentials","remote.llm","remote.settings","remote.session","configForms","settingsSchema"]`（9 项）；同包 0.2.2-rc.1 发布版 `:5391–5401` 逐字相同（D：`npm pack` 解包比对） | `src-work/plugin/lib/client.js:758` = `["slots","locale","connection","remote","remote.credentials"]`（5 项） | **部分**：`remote.credentials` 一致；**无** `remote.llm/settings/session`、`configForms`、`settingsSchema`；多出 `connection` | 我们只用到 `remote.credentials`（读写密钥）+ `remote`（事件），未用 llm/session/settings/configForms/settingsSchema → 缺失项**当前不构成功能缺口**；多出的 `connection` 是旧线 `connection.api.credentials` 回退所需 | 保持最小集（§6 判定「可接受」）；若未来接入官方 settings 表单，再按官方 9 项扩展 |
| ①-2 | 「声明但 host 未注册」的后果 | Cordis 代理 `cordis/lib/index.js:676` 抛 `cannot get property "<prop>" without inject`；`:687–689` 在 `prop in fiber.inject` 但实现未就绪时改为 `cannot get required service "<prop>" in inactive context`；`Fiber._refresh()` `:1320–1326` 对 `inject` 中任一 name 取不到实现即 `epoch = INACTIVE` → **整个插件 fiber 不激活（park）**，不是「访问时抛错」而是「apply 根本不跑」。gateway 侧 `dsh-api-gateway/lib/client.browser.js:1735–1742` 在 `$mount` 时若无对应贡献会检查 `ownerCtx.get(serviceKey) !== void 0` 才冲突；`:2074–2076` `remoteServiceKey(namespace) => \`remote.${namespace}\``；`:1773–1781` `createNamespace` 用 `ctx.plugin({name: remoteServiceKey(name)})` 注册独立 Service；`:1813` 方法未挂载时抛 `client api: Remote method is no longer mounted` | `client.js:758` 声明 `remote.credentials`；`package.json` 的 `dsh.client.inject`（D：`node -p` 读出）为 5 个**包名** `["@deepseek-ai/dsh-client-runtime","@deepseek-ai/dsh-client-locale","@deepseek-ai/dsh-client-connection","@deepseek-ai/dsh-api-remotes","@deepseek-ai/dsh-client-ui-settings"]`，**不含**服务键 `remote.credentials`；`tests/lead-20261106.test.js:198–202` 显式断言「不要把它加到 package 级 inject」 | **一致（且我们更保守）** | 关键风险是**反向**：若 `dsh-api-remotes` 未挂载 `credentials` 贡献 → `remote.credentials` 服务不存在 → 声明了它会导致**整个 client 插件不激活**（设置卡片消失），比 Issue #8 的「密钥保存失败」更严重。官方 9 项同样有此依赖，靠 profile 组合保证 | 保留 `try/catch` 属性访问（`client.js:351,381`）作兼容；但需明确：**声明即依赖**，不是「可选探测」。见 §6「必须修/建议修」 |
| ②-1 | `credentials.describe` 调用形式 | `typert.remote-client.d.ts:14` `describe: (refs: string[]) => Promise<RemoteResult<Record<string, CredentialInfo>>>`；`:26` `'credentials/describe': (refs: string[]) => ...`；`dsh-api-remotes/lib/client.js:2911–2948` 参数 `refs` 是 `string[]`（`zod` array of string）；官方调用 `dsh-client-ui-settings-models/lib/client.js:1383` `this.ctx.remote.credentials.describe(refs.slice(index, index + 64))` → **位置参数数组**，按 64 分批 | `client.js:354` `const res = await api.describe([ref]);` → **位置参数数组**，单次 1 个 ref | **一致** | 无签名偏差；官方分批上限 `MAX_DESCRIBE_REFS`（`dsh-api-remotes/lib/client.js:2920` 提到），我们每个 ref 单独调用 → 11 个后端 11 次往返（性能，非正确性） | 建议修（可选）：合并为一次 `describe(refs[])`，与官方 `client.js:1383` 同构 |
| ②-2 | `describe` 返回值解包 | `typert.remote-client.d.ts:14` 返回 `RemoteResult<Record<string, CredentialInfo>>`；官方 `client.js:1384–1386` **只一层**：`if (response.ok) Object.assign(credentials, response.value); else credentialError = response.error.message`；`dsh-api-remotes/lib/client.js:2940–2947` result 描述 "one view per requested name, keyed by that name"；`dsh-credentials/lib/types/types.d.ts:60–65` `CredentialInfo { configured: boolean; source?: string; writable: boolean }` | `client.js:354–357` **三层解包**：`record = res.value !== undefined ? res.value : res` → `byRef = record.credentials !== undefined ? record.credentials : record` → `view = byRef[ref]`；即额外处理了 `{value:{credentials:{...}}}` 与裸对象 | **不一致（多余层）** | `record.credentials` 这一层**不在官方契约里**：官方 `res.value` 直接是 `Record<ref, CredentialInfo>`。若某天返回值恰好含名为 `credentials` 的 ref（我们的 ref 都是 `*_API_KEY`，不会），才会误取。当前属于兼容旧线 `connection.api.credentials.describe({refs:[ref]})` 的 `res.result.value.credentials[ref]`（`client.js:361–362`）——**那是另一个对象**（见 ②-3）。三层分支在当前官方返回下**第二层恒不触发**，无害但掩盖了契约 | 建议修：主路径改成官方一层 `res.ok ? res.value[ref] : undefined`，把多层/旧线兼容收敛到 fallback 分支（§6） |
| ②-3 | `settings-api.js` 的 `settings.describe()`（无参）| **不同对象**：官方 `typert.remote-client.d.ts:19` `settings.describe: () => Promise<RemoteResult<SettingsDescribeValue>>`（远程命名空间，返回包络 `{ok,value}`，`value` 含 `namespaces[]`）；而 Host 侧 `dsh-settings/lib/index.js:413–455` `describe(options?)` 是**同步**、返回 `SettingsNamespaceView[]` **数组**（`:509` 官方自己也 `this.describe().find(row => row.ns === ns)`）；`dsh-client-ui-settings/lib/client.js:1447` `await this.ctx.remote.settings.describe()` → `response.ok ? {view: response.value} : ...` | `settings-api.js:106` `descriptors = settings.describe();`（无参、同步、当数组用），`:130–135` `findNamespace(descriptors)` 对 `Array.isArray(descriptors)` 做 `row.ns` 形状发现；`:185` `settings.mutate(view.ns, ops, expected)`（Host 侧签名，`dsh-settings/lib/index.js:488`） | **一致（但对象不同，必须厘清）** | 我们调的是 **Host `settings` 服务**（`index.js:438,546` 把 `settingsForms` 注入 `getSettings`），**不是** `ctx.remote.settings` 命名空间。二者同名 `describe`/`mutate` 但：Host 侧同步返回数组、无 `RemoteResult` 包络；远程侧 Promise 返回 `{ok,value:{namespaces,writable,hasDocument}}`。`settings-api.js` 的写法对 Host 侧**正确**；若误换成远程命名空间会全错 | 无需改动；但报告须标注这两个 `describe` 是**不同签名**（②-3 结论）。见 §4 官方契约摘录 |
| ③-1 | `credentials.set` 参数 | `typert.remote-client.d.ts:15` `set: (ref: string, value: string) => Promise<RemoteResult<void>>`；`:27` `'credentials/set': (ref: string, value: string) => ...`；`dsh-api-remotes/lib/client.js:2951–2997` 两参数 `ref`/`value` 皆 `string`；官方 `dsh-client-ui-settings-models/lib/client.js:3172` `ctx.remote.credentials.set(ref, value)`；`dsh-api-settings-controller/lib/index.js:169–174` `async set(ref, value)` 且 `value` 为「non-empty secret value」 | `client.js:383` `const res = await api.set(ref, value);`（位置参数）；`client.js:442` `const value = staged.text.trim();` 后 `if (value !== "")` 才写（`:443`）；旧线回退 `client.js:389` `this.connection.api.credentials.set({ ref, value })`（对象参数） | **一致（主路径）** | 主路径签名精确匹配；旧线对象参数属兼容性猜测，无官方依据（E） | 保持 |
| ③-2 | `RemoteResult` 的 `ok`/`error` 确切拼写与分支 | `dsh-typert-protocol/lib/types/types.d.ts:110–116` `RemoteResult<T> = { readonly ok: true; readonly value: T } \| { readonly ok: false; readonly error: RemoteFailure }`；`RemoteFailure`（`:100–102`）= 按 `RemoteErrorCode` 判别的 `RemoteError` 联合；`remote-error.d.ts:14–23` `RemoteError extends Error` 带 `readonly code / details / isDSHRemoteError`；`types.d.ts:84–93` 基础码 `gateway/bad-request`、`gateway/cancelled`、`gateway/internal`；`dsh-api-settings-controller/lib/types/types.d.ts:10–37` 增补 `settings/rejected`、`settings/conflict`、`credential/rejected`；`dsh-api-settings-controller/lib/index.js:208` 写入被拒抛 `new RemoteError("credential/rejected", message, { ref })`；gateway `client.browser.js:1829–1835` 把 carrier 失败折成 `{ok:false, error: rebuiltFailure(result.error)}`，`:1836–1839` 成功折成 `{ok:true, value}` | `client.js:384–385` `const rejected = res !== null && typeof res === "object" && res.ok === false; if (rejected) throw new Error(res.error?.message ?? "credential write rejected");`；旧线 `:390–391` 额外兼容 `res.result?.ok === false` 与 `res.result?.error?.message` | **一致（主路径精确匹配）** | 官方 error 分支是 `Error` 实例（`message` 必有，另有 `code`/`details`）；我们只取 `.message` → **丢弃 `code`/`details`**，无法区分 `gateway/bad-request`（我们 ref 名非法）与 `credential/rejected`（服务端拒绝）与 `gateway/internal`（服务未挂载）。`RemoteResult` 只有 `ok:true\|ok:false` 两分支，**不存在** `{ok:false,error:{code,message,details}}` 之外的第三种 resolve 分支；但 `dsh-typert-protocol/lib/types/types.d.ts:105–107` 注明「assembly faults（arity / unmounted method / missing Context adapter）仍会 **reject**」→ 我们的 `await api.set()` 若抛异常，由 `save()` 的 per-key `try/catch`（`client.js:444–454`）捕获并记 `failedKeys`，**不会**误报成功 | 建议修：保留 `res.error?.code` 到 `failedKeys.reason`（§6）。另见 ⑥ |
| ④ | `readCredential` 三层解包 / `configured`/`writable`/`source` 字段名 | 官方 `client.js:1384` `Object.assign(credentials, response.value)` 后 `credentials[row.apiKeyEnv]`（`client.js:1401–1405`）、`row.credential?.configured === true`（`providerUsable`, `:1434`）；`CredentialInfo` 三字段 `configured`/`source?`/`writable`（`dsh-credentials/lib/types/types.d.ts:60–65`）；官方 UI 用 `configured` 点亮 dot、用 `writable` 判断可写（`client.js:1356` `const writable = mirrored.view.writable` 是 settings 层，不是 credential 层） | `client.js:365` `this.keyState.set(ref, { configured: view.configured === true, writable: view.writable !== false });`；**完全不读 `view.source`**；`KeyedBackendCard` `client.js:519–520` 用 `configured` + `writable===false` → `envProvided`/`readOnly` 徽标 | **字段名一致；解包多余；`source` 未用** | `source` 官方定义「Source layer currently supplying the value; absent while unconfigured」，正是「环境变量提供」的权威判据。我们用 `writable===false` **推断** env-shadowed（E，无官方依据）；Issue #8「临时绕过：导出同名变量…但卡片仍显示未配置」也印证 env 来源下 `describe` 未必标 `configured` | 建议修：用 `view.source`（如 `'env'`）驱动 `envProvided`，而非 `writable===false`（§6） |
| ⑤-1 | settings service 与 remote namespace 是否同一行数据 | **不是同一对象**：`dsh-client-ui-settings/lib/client.js:1270` `super(ctx,"configForms")`、`:1481` `inject = ["remote","remote.settings"]`、`:1447` `await this.ctx.remote.settings.describe()` 得到 `{writable,hasDocument,namespaces: SettingsNamespaceView[]}`（`dsh-settings/lib/types/types.d.ts:56–63`）；Host 侧 `dsh-settings/lib/index.js:413–455` `describe(options?)` 直接返回 `SettingsNamespaceView[]` 数组，同一份数据经 `dsh-api-settings-controller` 包装后跨 Remote 边界 | 我们只用 Host 侧 `settingsForms`（`index.js:438,546`），**不碰** `ctx.remote.settings`；`settings-api.js:106,237` 直接 `settings.describe()` | **一致（我们选了 Host 侧）** | 若未来 host 不再注入 Host `settings` 服务（0.2.2 起 `entry.fiber.effectiveConfig` 变化，D：`dsh-settings/lib/index.js` rc2 vs 0.2.2-rc.1 diff），Host 侧路径仍可用但返回值来源变了 | 可接受；文档注释需写明「这是 Host 服务不是 remote 命名空间」 |
| ⑤-2 | 官方如何定位自己的 namespace vs 我们 `findNamespace` 形状发现 vs PR #7 `ns` 匹配 | 官方 `dsh-client-ui-settings/lib/client.js:1214` `mirrored.view.namespaces.find(candidate => candidate.ns === this.spec.namespace)` → **纯 `ns` 精确匹配**；`dsh-client-ui-settings-models/lib/client.js:1361` `const namespaces = new Map(views.map(view => [view.ns, view]))` 同样按 `ns`；`dsh-settings/lib/index.js:509` `this.describe().find(row => row.ns === ns)`；PR #7 `lib/index.js` patch（GitHub API 取回，2026-11-07）`rows.find(r => r && r.ns === NAMESPACE) ?? rows.find(r => r.value && "searxngBaseURL" in r.value)` → **ns 优先 + 形状兜底** | `settings-api.js:130–136` `findNamespace` = **形状优先**（`DISCOVERY_FIELDS = ["numResults","backendTimeoutMs","enabledBackends","enableExa"]`，`:45`）→ `rows.find(row => DISCOVERY_FIELDS.some(key => Object.hasOwn(row.value, key)))` **先执行**，`?? rows.find(row => row.ns === "dsh-websearch")` 兜底；`index.js:454–470`（已合入 PR #7 修复）则是 `ns === NAMESPACE`（`NAMESPACE="unified-search"`, `:54`）优先 + `"searxngBaseURL" in r.value` 兜底 | **三方不一致** | ① 官方与 PR #7 都是 **`ns` 精确匹配优先**，我们是 **形状优先**；② 我们兜底字面量是 `"dsh-websearch"`，而 `index.js:54` 的 `NAMESPACE` / `client.js:11` 的 `PLUGIN_NS` 都是 `"unified-search"`，`cordis.patch.yml:8` 的 entry id 是 `dsh-websearch` → **三个 id 概念混用**（见 §5）；③ 形状发现用的 `enabledBackends`/`enableExa` 与当前 `BACKENDS`（`client.js:14–33` 的 `enable<Id>` 开关）是否仍存在需核对（E） | **必须修**：把 `findNamespace` 改为 `ns === NAMESPACE`（`"unified-search"`）优先，形状兜底保留但改用当前实际字段；与 `index.js:464` 对齐（§6） |
| ⑥ | 官方 `set` 失败时如何呈现 / 我们 `.find(f=>f.ref===...)` 是否同构 | 官方 `dsh-client-ui-settings-models/lib/client.js:3171–3174` `storeCredential: async (ref,value) => { const response = await ctx.remote.credentials.set(ref,value); return response.ok ? void 0 : response.error.message; }` → **返回 message 字符串**；调用方 `:1616–1617` `const stored = await operations.storeCredential(...); if (stored !== void 0) return stored;` → `create()` `:1625–1628` `if (outcome !== void 0) { setFailure(failure); ... }`，最终以 `<p className="...error">` 渲染（`:1655,1697,1737,1759,1970,2072,2185`）；`writeSettings` `:3180–3190` 把 `settings/conflict` 折成 `{kind:"conflict",message}`、其余 `{kind:"refused",message}`，UI `:1611` `written.kind === "conflict" ? t("conflict") : written.message` | `client.js:449–454` `failedKeys.set(ref, String(keyErr.message).slice(0,140))`；`projection()` `:318` `failedKeys: [...this.failedKeys].map(([ref, reason]) => ({ref, reason}))`；`KeyedBackendCard` `:522` `const failure = (state.failedKeys ?? []).find(f => f && f.ref === b.keyEnv)`；`:549` 渲染 `props.t("keyFailed") + ": " + failure.reason`；可选 Key 区 `:716` 同构 | **同构（都是 `[{ref,reason}]` + `.find(f=>f.ref===...)`）** | 官方是「每个 editor 一个 `failure` 字符串」，我们是「按 ref 的 Map → 数组 → find」；**语义等价**，且 `client.js:521,714` 两处注释明确「failedKeys 是 `[{ref,reason}]` 不是字符串数组，旧 `.includes(b.keyEnv)` 永不匹配」——已是修正过的实现。差异：官方 `response.error.message` 原样，我们 `.slice(0,140)` 截断且包裹 `keyFailed` 前缀；官方对 conflict 用专属文案 `t("conflict")`，我们把 credentials 失败统一为 `keyFailed` | 可接受；建议修（可选）：保留 `error.code` 以区分 conflict / bad-request |
| ⑦ | 版本差异 rc.2 / rc.5 / 0.2.2-rc.1 | 本机发布版 **0.2.1-rc.2**（D：`node -p`）；Issue #8 报告环境 **0.2.1-rc.5**（C：Issue #8 正文「环境」段，2026-11-07 API 取回）；`npm view @deepseek-ai/dsh versions --json`（D，2026-11-07）尾部含 `0.2.1-rc.1..rc.5`, `0.2.2-alpha.2/3`, `0.2.2-rc.1`；对 `dsh-api-settings-controller` / `dsh-api-gateway` / `dsh-client-ui-settings-models` / `dsh-api-remotes` / `dsh-credentials` / `dsh-settings` 六包做 `npm pack` 三版本解包比对（D）：`typert.remote-client.d.ts` **rc.2 == rc.5 == 0.2.2-rc.1 逐字相同**；`dsh-credentials/lib/types/types.d.ts` 三版相同；官方 UI `client.js` inject 数组 rc.2 与 0.2.2-rc.1 逐字相同（`:4417–4427` vs `:5391–5401`）；gateway `remoteServiceKey` 三版同（`:2074–2076`）；`dsh-settings/lib/index.js` rc.2→rc.5 相同，rc.2→0.2.2-rc.1 有 3 处小改（`configure()` `owner`→`owner.ctx.fiber`、`describe()` `entry.fiber.config`→`entry.fiber.effectiveConfig`、` presentations.get(entry.fiber.ctx.fiber)`），**不影响 `describe()`/`mutate()` 签名与返回数组形状** | 我们的 client 不感知版本号；`package.json:3` version `2.8.4`；Issue #8 描述的是上游 `2.8.8`（C） | **一致（API 面无变化）** | rc.5 与 rc.2 之间**凭证/settings Remote 契约零差异**（D 已证）；0.2.2 的 `effectiveConfig` 变化影响 `settings.describe()` 的 **value 来源**（PR #7 正是修这个：`config` 只带 defaults），我们 `index.js:454–470` 已合入 PR #7 修复 | **无须预留兼容分支**；但 §6 仍建议把「版本无关」写成注释，避免后人凭 rc.5 加兼容代码 |
| ⑧ | 事件名 | 官方 `dsh-client-ui-settings-models/lib/client.js:4472–4478` 订阅 `settings/document-updated`、`credentials/record-updated`、`credentials/reference-updated`、`llm/adapters-updated`、`connection/reset`；`dsh-credentials/lib/types/types.d.ts:76–90` 声明 `credentials/reference-updated(ref)` 与 `credentials/record-updated(key)` **两个不同 key 空间的事件** | `client.js:787` 循环订阅 `["credentials/reference-updated","credentials/updated"]`；`:795` 订阅 `settings/document-updated`；**无** `credentials/record-updated`、**无** `connection/reset`、**无** `llm/adapters-updated`；`"credentials/updated"` 在官方契约中不存在（E，旧线猜测） | **部分不一致** | 漏 `credentials/record-updated` → 若 host 通过 `modifyRecord` 改凭证，我们的徽标不刷新；`"credentials/updated"` 是无效订阅（不报错但永不触发）；漏 `connection/reset` → 重连后不重读 | 建议修：订阅列表改为官方 3 个（`record-updated`/`reference-updated`/`settings/document-updated`）+ `connection/reset`，移除无效 `credentials/updated`（§6） |

---

## 2. 偏差清单三档

### 2.1 必须修（正确性风险，2 项）

| ID | 偏差 | 依据 | 落点 | 验证方式 |
| --- | --- | --- | --- | --- |
| **M1** | `settings-api.js:133–135` `findNamespace` **形状优先**且兜底 `ns === "dsh-websearch"`，与官方「`ns` 精确匹配优先」及 PR #7 的 `ns === NAMESPACE` 相反；且 `"dsh-websearch"` / `"unified-search"` / `client.js:11 PLUGIN_NS` 三个 id 混用 | **B** `dsh-client-ui-settings/lib/client.js:1214`、`:1447`；**B** `dsh-settings/lib/index.js:509`；**C** PR #7 `lib/index.js` patch（`https://github.com/240xu/dsh-websearch/pull/7`，2026-11-07 API 200）；**A** `src-work/plugin/lib/index.js:54,464`、`settings-api.js:130–136`、`cordis.patch.yml:8` | `settings-api.js:45,130–136` | **D**：`grep` 已核对三处 id；**E 缺口**：未跑 host 实跑验证 `findNamespace` 在真实 `describe()` 输出上命中哪一行 |
| **M2** | `package.json` 的 `dsh.client.inject` 未列 `@deepseek-ai/dsh-api-settings-controller` 对应的 Remote 贡献挂载包，而 `client.js:758` 已声明 `remote.credentials`；「声明即依赖」——若 `dsh-api-remotes` 未挂载 credentials 贡献，**整个 client fiber 不激活**（卡片消失），比 Issue #8 更严重 | **B** `cordis/lib/index.js:676,687–689,1320–1326`；**B** `dsh-api-gateway/lib/client.browser.js:1735–1742,1773–1781,1813,2074–2076`；**C** Issue #8 根因段（官方 `remote.<namespace>` 独立服务）；**A** `src-work/plugin/package.json` `dsh.client.inject`、`client.js:758`；**A** `tests/lead-20261106.test.js:198–202`（已有断言：不要加到 package 级） | `package.json` `dsh.client.inject`（**注意**：现有测试断言的是「不要加 `remote.credentials` 这个服务键到 package 级」，与本条「确认 remotes 贡献包已挂载」是两件事，不冲突） | **D**：`node -p` 读出 package inject 5 项已包含 `@deepseek-ai/dsh-api-remotes`；**E 缺口**：未做「卸载 remotes 贡献」的破坏性实测（只读任务不允许） |

> M2 的净结论（避免误读）：**当前 package 已含 `@deepseek-ai/dsh-api-remotes`**（D 实测），所以 `remote.credentials` 服务在本机 profile 下会被挂载，M2 是**潜在组合风险而非当前故障**；归入「必须修」是因为它一旦发生是整卡消失，需以注释/测试固化这一依赖，而非改代码。

### 2.2 建议修（契约精度 / 可维护性，5 项）

| ID | 偏差 | 依据 | 建议 |
| --- | --- | --- | --- |
| S1 | `readCredential` 三层解包（`client.js:355–357`）多于官方一层（`:1384`），`record.credentials` 层无官方依据 | **B** `typert.remote-client.d.ts:14`；**B** `dsh-client-ui-settings-models/lib/client.js:1383–1386` | 主路径改 `res.ok ? res.value?.[ref] : undefined`；多层/旧线兼容仅留在 `connection.api.credentials` fallback |
| S2 | 不读 `view.source`，用 `writable===false` 推断 env-provided（E） | **B** `dsh-credentials/lib/types/types.d.ts:60–65`（`source?` 定义「Source layer currently supplying the value」）；**C** Issue #8「临时绕过」段 | 用 `view.source` 驱动 `envProvided` 徽标（`client.js:534`） |
| S3 | 丢弃 `res.error.code` / `details`，只取 `.message` | **B** `dsh-typert-protocol/lib/types/remote-error.d.ts:14–23`；**B** `dsh-api-settings-controller/lib/types/types.d.ts:10–37`；**B** `dsh-typert-protocol/lib/types/types.d.ts:84–93` | `failedKeys.reason` 附 `code`，区分 `credential/rejected` / `gateway/bad-request` / `gateway/internal` |
| S4 | 事件订阅含无效 `credentials/updated`、漏 `credentials/record-updated` 与 `connection/reset` | **B** `dsh-client-ui-settings-models/lib/client.js:4472–4478`；**B** `dsh-credentials/lib/types/types.d.ts:76–90` | 改为官方 3 事件 + `connection/reset` |
| S5 | 每个 ref 单独 `describe([ref])`（11 次往返），官方按 64 批量 | **B** `dsh-client-ui-settings-models/lib/client.js:1382–1388`；**B** `dsh-api-remotes/lib/client.js:2920`（`MAX_DESCRIBE_REFS`） | 合并 `refreshAllCredentials()`（`client.js:397–399`）为一次 `describe(refs[])` |

### 2.3 可接受（3 项）

| ID | 偏差 | 理由 |
| --- | --- | --- |
| A1 | `inject` 只 5 项（缺 `remote.llm/settings/session`、`configForms`、`settingsSchema`；多 `connection`） | 我们不使用 llm 目录、session modelCatalog、官方 configForms/settingsSchema 表单；`connection` 是旧线回退所需。官方 9 项对应 Models 页的完整能力，不是「所有 client 插件的强制最小集」。**B** `dsh-client-ui-settings-models/lib/client.js:4417–4427` 与 `:3165–3167` 注释（"the page plugin's context … declares … in its own inject"） |
| A2 | `settings-api.js` 用 Host `settings.describe()` 同步数组而非 `ctx.remote.settings.describe()` 包络 | 二者是**不同对象**（②-3、⑤-1），我们对 Host 侧的调用签名精确匹配 `dsh-settings/lib/index.js:413–455,488`；HTTP 桥在 Host 侧运行，本就不该用 browser Remote |
| A3 | `failedKeys` 用 `[{ref,reason}]` + `.find(f=>f.ref===...)`，官方用单 `failure` 字符串；`reason` 截断 140 字符 + `keyFailed` 前缀 | 语义同构（§1 ⑥），且 `client.js:521,714` 已修正过 `.includes` 缺陷；截断是防 UI 溢出的合理防御。**B** `dsh-client-ui-settings-models/lib/client.js:3171–3174,1616–1617` |

---

## 3. 官方契约摘录（路径:行号原文）

> 全部为 **A**（本机发布版绝对路径，2026-11-07 只读 `read`/`grep`）或 **C**（GitHub API 取回的 PR/Issue 原文）。`R = /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai`。

**C-1 官方 inject 数组** — `R/dsh-client-ui-settings-models/lib/client.js:4417–4427`
```js
const inject = [
    "slots", "locale", "remote", "remote.credentials", "remote.llm",
    "remote.settings", "remote.session", "configForms", "settingsSchema"
];
```

**C-2 官方 `credentials.describe` 调用与一层解包** — `R/dsh-client-ui-settings-models/lib/client.js:1382–1388`
```js
for (let index = 0; index < refs.length; index += 64) {
    const response = await this.ctx.remote.credentials.describe(refs.slice(index, index + 64));
    if (response.ok) Object.assign(credentials, response.value);
    else { credentialError = response.error.message; break; }
}
```

**C-3 官方 `storeCredential` / `writeSettings`** — `R/dsh-client-ui-settings-models/lib/client.js:3170–3193`
```js
storeCredential: async (ref, value) => {
    const response = await ctx.remote.credentials.set(ref, value);
    return response.ok ? void 0 : response.error.message;
},
removeCredential: async (ref) => {
    const response = await ctx.remote.credentials.unset(ref);
    return response.ok ? void 0 : response.error.message;
},
writeSettings: async (ns, ops, expectedRevision) => {
    const response = await ctx.remote.settings.mutate(ns, ops, expectedRevision);
    if (response.ok) return { kind: "written", view: response.value };
    const { code, message } = response.error;
    return code === "settings/conflict" ? { kind: "conflict", message } : { kind: "refused", message };
},
```

**C-4 生成的 Remote 签名** — `R/dsh-api-settings-controller/lib/typert.remote-client.d.ts:13–33`
```ts
interface TypertRemoteNamespace$63726564656e7469616c73 {
  describe: (refs: string[]) => Promise<RemoteResult<Record<string, CredentialInfo>>>
  set: (ref: string, value: string) => Promise<RemoteResult<void>>
  unset: (ref: string) => Promise<RemoteResult<void>>
}
interface TypertRemoteNamespace$73657474696e6773 {
  describe: () => Promise<RemoteResult<SettingsDescribeValue>>
  mutate: (ns: string, ops: SettingsPathOpView[], expectedRevision: number | undefined) => Promise<RemoteResult<SettingsNamespaceView>>
  ...
}
interface TypertRemoteMap {
  'credentials/describe': (refs: string[]) => Promise<RemoteResult<Record<string, CredentialInfo>>>
  'credentials/set': (ref: string, value: string) => Promise<RemoteResult<void>>
  ...
  'settings/describe': () => Promise<RemoteResult<SettingsDescribeValue>>
  'settings/mutate': (...) => Promise<RemoteResult<SettingsNamespaceView>>
}
```
以及 `:41–50` 的 `TYPERT_REMOTE` 声明：`'credentials/describe'` 参数 `{refs: string[]}`、`'credentials/set'` 参数 `{ref: string; value: string}`、`'settings/describe'` 参数 `{ }`、`'settings/mutate'` 参数 `{ns, ops, expectedRevision?: number}`。

**C-5 `RemoteResult` 精确形状** — `R/dsh-typert-protocol/lib/types/types.d.ts:110–116`
```ts
export type RemoteResult<T> = {
    readonly ok: true;
    readonly value: T;
} | {
    readonly ok: false;
    readonly error: RemoteFailure;
};
```
同文件 `:105–107` 注释原文：*"The Remote face itself folds carrier failures into the error branch, so no consumer wraps a call to recover one; only assembly faults (arity, an unmounted method, a missing Context adapter) still reject."*

**C-6 `RemoteError` 字段** — `R/dsh-typert-protocol/lib/types/remote-error.d.ts:14–23`
```ts
export declare class RemoteError<Code extends RemoteErrorCode = RemoteErrorCode> extends Error {
    readonly code: Code;
    readonly details: RemoteErrorDetailsMap[Code];
    readonly isDSHRemoteError: true;
}
```
错误码全集：`types.d.ts:84–93`（`gateway/bad-request` / `gateway/cancelled` / `gateway/internal`）+ `R/dsh-api-settings-controller/lib/types/types.d.ts:10–37`（`settings/rejected` / `settings/conflict` / `credential/rejected`）。写入被拒的构造点：`R/dsh-api-settings-controller/lib/index.js:208`
```js
throw new RemoteError("credential/rejected", error instanceof Error ? error.message : String(error), { ref }, { cause: error });
```

**C-7 `CredentialInfo` 三字段** — `R/dsh-credentials/lib/types/types.d.ts:60–65`
```ts
export interface CredentialInfo {
    configured: boolean;
    source?: string;      // "Source layer currently supplying the value; absent while unconfigured."
    writable: boolean;
}
```

**C-8 gateway 命名空间注册 / 注入规则** — `R/dsh-api-gateway/lib/client.browser.js`
```js
// :2074–2076
function remoteServiceKey(namespace) { return `remote.${namespace}`; }
// :1735–1742（$mount 前的冲突检查）
if (this.ownerCtx.reflect.props[serviceKey]?.type === "accessor" || this.ownerCtx.get(serviceKey) !== void 0)
    throw new Error(`client api: namespace ${JSON.stringify(namespace)} conflicts with an existing Remote namespace`);
// :1773–1781（每个 namespace 是独立 plugin fiber / Service）
const fiber = this.ownerCtx.plugin({
    name: remoteServiceKey(name),
    apply: (ctx) => { service = new RemoteNamespaceService(ctx, name, ...); installed = installMethods(service, descriptors); }
});
// :1813（方法未挂载）
throw new Error("client api: Remote method is no longer mounted");
// :1829–1839（RemoteResult 折叠）
if (!result.ok) return { ok: false, error: rebuiltFailure(result.error) };
return { ok: true, value: ... };
```
`R/dsh-api-remotes/lib/client.js:23639,23645–23672`：`const inject = ["remote"]`，`apply` 里 `for (const contribution of [...]) disposers.push(await ctx.remote.$mount(contribution));`（D：`TYPERT_REMOTE$20` 即 `@deepseek-ai/dsh-api-settings-controller` 的 credentials/settings 贡献，`:2909`）。

**C-9 Cordis inject 强制语义** — `R/cordis/lib/index.js:676,687–689,1320–1326`
```js
const error = new Error(`cannot get property "${prop}" without inject`);
...
if (prop in fiber.inject) {
    error.message = `cannot get required service "${prop}" in inactive context`;
    throw error;
}
...
_refresh() {
    for (const name of Object.keys(this.inject)) {
        const impl = this._store[name];
        if (!impl) { epoch = INACTIVE; break; }   // 任一 inject 缺失 → fiber 不激活
    }
}
```

**C-10 Host `settings` 服务（与 remote namespace 不同对象）** — `R/dsh-settings/lib/index.js:413–455,488`
```js
describe(options) { ... return descriptors; }   // 同步，返回 SettingsNamespaceView[] 数组
async mutate(ns, ops, expectedRevision) { ... } // :488
// :509 官方自己的按 ns 查找
const descriptor = this.describe().find((row) => row.ns === ns);
```
`R/dsh-settings/lib/types/types.d.ts:18–39` `SettingsNamespaceView` 含 `ns / schema / value / base? / user? / applies:'live' / secrets / revision`；`:56–63` `SettingsDescribeValue` 含 `writable / hasDocument / namespaces[]`。

**C-11 官方按 `ns` 定位** — `R/dsh-client-ui-settings/lib/client.js:1214,1447`
```js
const view = mirrored.view.namespaces.find((candidate) => candidate.ns === this.spec.namespace);
...
const response = await this.ctx.remote.settings.describe();
outcome = response.ok ? { view: response.value } : { failure: response.error.message };
```

**C-12 官方事件订阅** — `R/dsh-client-ui-settings-models/lib/client.js:4472–4478`
```js
ctx.remote.$on("settings/document-updated", () => { refreshModels(); }),
ctx.remote.$on("credentials/record-updated", refreshModels),
ctx.remote.$on("credentials/reference-updated", refreshModels),
ctx.remote.$on("llm/adapters-updated", refreshModels),
ctx.on("connection/reset", refreshModels)
```

**C-13 PR #7 `ns` 匹配原文**（GitHub API `pulls/7/files`，2026-11-07 HTTP 200，`lib/index.js` patch）
```js
const rows = settings.describe();
const row = rows.find((r) => r && r.ns === NAMESPACE)
  ?? rows.find((r) => r && r.value && typeof r.value === "object" && "searxngBaseURL" in r.value);
return (row && row.value) ?? config;
```
PR #7 标题：`fix: settings are inert on DSH 0.2.x (no installSection) + RFC1918 plain-http base URLs rejected`，state `open`，created `2026-11-04T10:22:28Z`；files = `lib/index.js`(modified)、`lib/provider.js`(modified)、`tests/v28x-settings-bridge.test.js`(added)。

**C-14 Issue #8 关键原文**（GitHub API `issues/8`，2026-11-07 HTTP 200）
- 环境：`@240xu/dsh-websearch 2.8.8` + `@deepseek-ai/dsh 0.2.1-rc.5`，Node v22.23.4。
- 根因引用 `dsh-api-gateway/lib/client.browser.js:2074` 的 `remoteServiceKey`，并给出最小复现：`inject: ['remote']` 下 `ctx.remote.credentials` → `THROW: cannot get property "remote.credentials" without inject`；改成 `['remote','remote.credentials']` 后返回 object。
- 直连 RPC 实测：`POST /api/credentials/describe` → `{"ok":true,"value":{"TAVILY_API_KEY":{"configured":false,"writable":true}}}`；`POST /api/credentials/set` → `{"ok":true}`；再 describe → `{"PROBE_TEST_KEY":{"configured":true,"source":"file","writable":true}}`（**注意**：此处 `source:"file"` 实证了 `CredentialInfo.source` 的实际取值）。
- 建议修复 diff 即 `inject` 补 `"remote.credentials"` + `set()` 检查 `res.ok === false` 抛 `res.error?.message`。
- 评论（API `issues/8/comments` 200，2 条）：`240xu` 2026-11-05「稍等稍等，马上解决!」、2026-11-07「ok了，感谢」；Issue 仍 `state: open`（updated `2026-11-07T05:10:52Z`）。

---

## 4. 应补最小改动（按优先级，均为「建议」非已实施）

1. **M1**：`src-work/plugin/lib/settings-api.js:130–136` `findNamespace` 改为
   `rows.find(row => row.ns === "unified-search") ?? rows.find(row => 形状发现)`，
   并让 `:45 DISCOVERY_FIELDS` 与 `client.js:14–33` 当前 `enable<Id>` 字段表一致；与 `index.js:464` 的 `NAMESPACE` 常量同源（避免硬编码两份字面量）。依据 C-11/C-13/A。
2. **M2**：在 `package.json` 或 `client.js:751–758` 注释中固化「`remote.credentials` 服务由 `@deepseek-ai/dsh-api-remotes` 的 `TYPERT_REMOTE$20` 贡献挂载；声明即依赖，缺失会让整个 client fiber park」。依据 C-8/C-9/C-14。
3. **S1+S2+S3**：`client.js:344–368` `readCredential` 主路径改一层解包 + 读 `source`；`:370–395` `writeCredential` 把 `res.error?.code` 并入失败原因。依据 C-2/C-5/C-6/C-7。
4. **S4**：`client.js:787` 事件数组改 `["credentials/reference-updated","credentials/record-updated"]`，`:795` 附近补 `connection/reset`（`ctx.on`）。依据 C-12。
5. **S5**：`client.js:397–399` `refreshAllCredentials()` 合并成一次批量 `describe`。依据 C-2。
6. **⑦ 兼容**：**不加**版本分支；在 `client.js:758` 注释写明「0.2.1-rc.2 / rc.5 / 0.2.2-rc.1 的 credentials+settings Remote 契约逐字相同（2026-11-07 npm pack 三版比对）」，防止后人凭 Issue #8 的 rc.5 加多余兼容代码。依据 §1 ⑦ 的 D。

> 四联标注自检：以上每条均给出「改动 → 依据(B/C，含路径或 PR 号) → 代码落点(A，路径:行号) → 验证方式」。**验证方式统一为 E 缺口**：本任务为只读调研，未修改源码、未跑 `node --test`、未启动 `dsh web` 做 UI 实测；建议落地后以 `node tests/*.test.js`（现有 `tests/lead-20261106.test.js`、`lead-20261107.test.js`）+ 真实 `dsh web` 卡片保存/徽标回归验证。

---

## 5. 无法确认项（E，显式列缺口）

| # | 项 | 缺口 |
| --- | --- | --- |
| E1 | `connection.api.credentials` 旧线回退（`client.js:359–362,388–393`）的 `{ref,value}` / `res.result.ok` / `res.result.value.credentials[ref]` 签名 | 发布版 0.2.1-rc.2 中未找到该对象的官方定义（D：`grep` 无果）；**E**，属兼容猜测，不能当结论。官方契约只有 `remote.credentials`（C-4） |
| E2 | `client.js:787` 订阅的 `"credentials/updated"` 是否存在于任何历史线 | 官方 `dsh-credentials/lib/types/types.d.ts:76–90` 只声明 `reference-updated` / `record-updated`；**E**，疑为无效订阅 |
| E3 | `settings-api.js:45 DISCOVERY_FIELDS` 的 `enabledBackends` / `enableExa` 是否仍存在于当前 `Config.dict` | 未读 `src-work/plugin/lib/index.js` 的 `Config` 全文核对（D 只 grep 到注释）；**E** |
| E4 | `CredentialInfo.source` 的完整取值集合 | 官方类型只写 `source?: string`（C-7），Issue #8 实证 `"file"`；env-shadowed 时是否恒为某固定值（如 `"env"`）**未取到**，故 S2 只能建议「用 `source`」而不能指定具体值匹配 |
| E5 | `MAX_DESCRIBE_REFS` 的数值 | `dsh-api-remotes/lib/client.js:2920` 只引用链接 `@link MAX_DESCRIBE_REFS`；官方 UI 硬编码 64（`:1382`）；未读 `credentials.ts` 常量定义 → **E**（不影响结论：我们 11 个 ref < 64） |
| E6 | 「`remote.credentials` 未挂载 → 整卡不激活」的运行时表现 | 依据 C-9 的 `_refresh()` 逻辑**推断**（A 级源码 + E 级推断），未做破坏性卸载实测（只读任务不允许） |
| E7 | PR #7 / Issue #8 的关闭状态与后续 commit | API 取回时两者 `state: open`（C，2026-11-07）；Issue 评论「ok了」但状态未改。是否有后续 fix commit / release tag 未查（E） |
| E8 | 0.2.2-rc.1 `dsh-settings/lib/index.js` 的 `entry.fiber.effectiveConfig` 改动对我们 `settings-api.js` 的实际影响 | 已确认 `describe()` 签名与返回数组形状不变（D：diff 仅 3 处），但**未跑** 0.2.2 宿主实测（E） |

---

## 6. 附：本机实测命令与版本记录（C/D）

- **D** `node -p "require('/usr/local/lib/node_modules/@deepseek-ai/dsh/package.json').version"` → `0.2.1-rc.2`；六个子包同版本。
- **D** `npm view @deepseek-ai/dsh versions --json` → 尾部 `0.2.1-rc.1 … 0.2.1-rc.5, 0.2.2-alpha.2, 0.2.2-alpha.3, 0.2.2-rc.1`。
- **D** `npm pack @deepseek-ai/<pkg>@{0.2.1-rc.2,0.2.1-rc.5,0.2.2-rc.1}` 六包 × 三版本 = 18 个 tarball，解包比对：`typert.remote-client.d.ts` 三版 diff **IDENTICAL**；`dsh-client-ui-settings-models/lib/client.js` 的 inject 数组 rc.2 `:4417–4427` 与 0.2.2-rc.1 `:5391–5401` 逐字相同；`dsh-api-gateway` `remoteServiceKey` 三版同；`dsh-credentials/lib/types/types.d.ts` 三版同；`dsh-settings/lib/index.js` rc.2/rc.5 相同，0.2.2-rc.1 有 3 处 `effectiveConfig` 相关小改。
- **C/D** GitHub API：`GET /repos/240xu/dsh-websearch/pulls/7`（200）、`/pulls/7/files`（200，3 files）、`/pulls/7/comments`（200，0）、`/pulls/7/reviews`（200，0）、`/issues/8`（200）、`/issues/8/comments`（200，2 条）。`240xu/zcode-research` 的 pulls/7 与 issues/8 均 404（D），确认正确仓库是 `240xu/dsh-websearch`。
- **C** 版本记录：本机发布版 `0.2.1-rc.2`；Issue #8 报告环境 `0.2.1-rc.5`；上游插件 `2.8.8`（Issue #8）vs 我们 src-work `2.8.4`（`package.json:3`）；PR #7 针对 `2.8.8 + 0.2.2-alpha.2`。
- **D** 全程只读：未修改任何源码/配置/其它报告；`33-official-alignment-client.md` 不存在，未创建/覆盖；token 仅在内存使用，未写入产物。

---

## 7. 续查补遗（2026-11-07 晚，解除两项 E）

> 声明：本节仅**追加**，不改动 §1–§6 任何结论。以下两项在初次交付时标为 E，现以只读源码实证升为 **A**，原 E 行保留以留痕。

- **E3 解除（A）**：`src-work/plugin/lib/index.js:154` `export const Config = z.object({...})` 中确有 `numResults: z.number().step(1).min(1).max(50).default(8)`（`:156`）、`backendTimeoutMs: z.number().step(1000).min(1000).max(120000).default(30000)`（`:160`）、`enableExa: z.boolean().default(true)`（`:201`）、`enabledBackends: z.array(z.string())`（`:276`）。即 `settings-api.js:45` 的 `DISCOVERY_FIELDS` **四个字段全部仍存在于当前 `Config.dict`**，形状发现本身可用；§2.1 M1 的风险不在「字段失效」而在「**形状优先**且兜底字面量 `"dsh-websearch"` 与 `NAMESPACE="unified-search"` 不一致」——M1 结论不变。
- **E5 解除（A）**：`R/dsh-api-settings-controller/lib/index.js:55` `const MAX_DESCRIBE_REFS = 64;`，`:57` `const describeRequestSchema = z.object({ refs: z.array(credentialRefSchema).max(MAX_DESCRIBE_REFS) });`；`R/dsh-api-settings-controller/lib/types/credentials.js:49,52` 同值。故官方 `client.js:1382` 的 `index += 64` 是精确上限；我们 11 个 `*_API_KEY` ref 远小于 64，S5 的「合并为一次批量 describe」是**可行且安全**的，§1 ②-1 结论不变。
- **附带（D）**：`/tmp/.gh_tok` 临时文件已确认不存在（初次使用即为内存读取，未落盘）；报告中不含任何 token 值。

---

*报告结束 · 子代理 `protocol-standards` · 2026-11-07 · 唯一产物文件：`.artifacts/websearch-research/33-official-alignment-client-b.md` · 未操作任务板（task-16 由 Lead 处理）*
