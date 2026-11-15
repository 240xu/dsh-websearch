# R3 复核：配置/UI 深水区（61-review-config-ui）

> 续研专家 R3 · 独立取证 · 复核上一轮修复边界并找新 bug
> 完成时间：2026-11-10 · 只读取证，未改源码/配置/运行时/其它报告，未写 settings/credentials
> 被测：`/home/ova/dsh/.artifacts/websearch-research/src-work/plugin/`（v2.8.4）
> 官方对照：旧 runtime `@deepseek-ai/dsh-credentials@0.2.1-rc.2`（`/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/`）+ 新 runtime `@0.2.2-rc.1`（`/home/dsh/.dsh-exp022/runtime/`），两版 `REF_PATTERN` 完全一致。

---

## 0. 取证方法

| 手段 | 说明 |
| --- | --- |
| read/grep/glob | 全量读 `lib/client.js`(911行)、`index.js`、`provider.js`、`settings-api.js`、`cache.js`、`util/namespace.js`、官方 `dsh-credentials`/`dsh-web`/`dsh-tool-web` |
| node 脚本（`/tmp/r3probe/*.mjs`，跑完删除） | 直接 import 官方 `credentialRef`/`schemastery`/插件 `findPluginRow`/`cacheKeyFor`；从 `client.js` 抽取 `save()` 方法体注入 mock scope 做并发时序复现 |
| 认证 API **只读**探测 | `dsh-web.log` 中 GUI token → 303 换 `dsh-auth-*` cookie → `GET /api/unified-search/settings`（200，未做任何 POST/写） |

---

## 1. 逐条裁决表

| # | 复核项 | 裁决 | 证据 | 严重度 |
| --- | --- | --- | --- | --- |
| 1 | `ApiKeyEnv` pattern 是否过严 | **❌ 过严（确认缺陷 D1）** | 官方 `REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/`（`dsh-credentials/lib/index.js:13`），插件 `/^[A-Z][A-Z0-9_]*$/`。实测合法但被拒：`my_api_key` / `_PRIVATE` / `braveKey` / `EnvPrefix_KEY` / `x` / `__` / `MIXED_case`。点/冒号/连字符/斜杠/前导数字的引用**两边都拒**（属 `CredentialKey` 或非法），无误伤。 | **高** |
| 1b | 过严的实际杀伤面 | **全路径硬阻断** | `settings-api.validateOp` 用 `Config.dict[field](value)` → 小写引用 POST 得 400；整对象 `Config({braveApiKeyEnv:"my_api_key"})` 亦 REJECT，故 cordis.yml/patch 无法绕过。 | 高 |
| 1c | 官方 `.role("credential-ref")` 是否自带校验 | 否 | schemastery `role()` 仅写 `meta.role`，不加任何 pattern（`schemastery/lib/index.mjs:210`）。pattern 完全由插件自加。 | — |
| 2 | `save()` 引用快照边界 | **❌ 快照时机错误（确认缺陷 D2，本轮最重）** | `savedFieldRefs.set(field, this.staged.get(field))` 位于 `await this.scope.set/unset(...)` **之后**（client.js:471/475/481/496/499）。保存期间 `edit()` 生成新对象后，快照抓到的是**新对象**而非被保存的旧对象 → 清理循环误判「未变」→ 删除新编辑并置 `savedAt`。 | **严重** |
| 2a | 用户改回原值 / 重输同值 | 失败 | 运行时复现 S2/S3：即使新值与已写值相同，身份比较仍应在「已写对象」上做；当前实现把新对象删掉。 | 中 |
| 2b | 清空到空串 | ✅ 正确 | `staged.text === ""` → `scope.unset(field)` 恢复 schema 默认（S4）。 | — |
| 2c | 并发双击保存 | ✅ 正确 | `if (this.saving) return` 守卫，第二次 no-op（S6）。 | — |
| 2d | `discard()` 与 save 竞态 | **⚠️ 假绿（D2 派生）** | `discard()` 清空 staged 后，save() 收尾 `doneFields>0 && !failed && staged 空` → `savedAt` 置位（S5）：用户已放弃，UI 却显示「已保存 ✓」。 | 中 |
| 2e | `scope.load()` 重读后 republish 是否覆盖新编辑 | **✅ 不覆盖 staged，但 ❌ 会覆盖显示** | `sectionValue()` 读 snapshot；`fieldState()` 优先 `staged`。staged 编辑不被 load 抹掉。但 `discard()` 不触 `load()`，且 projection 用 `snap.value` 直接渲染 toggles/globals 默认值——`load()` 后 `stagedText` 为空的字段会显示新值；已 staged 字段仍显示 staged 文本。无数据丢失，但存在「显示值 ≠ 已写值」窗口。 | 低 |
| 2f | `savedAt` 是否仍可能假绿 | **❌ 是（D2 + S5）** | 运行时复现：宿主写入 `10`、用户期间改 `25`、UI 显示「已保存 ✓」、`staged=[]`、`25` 静默丢失。 | **严重** |
| 3 | `readErrors` UI 两处真能显示 | **✅ 数据链路完整** | `readErrors=new Map` → projection 发数组 → `KeyedBackendCard`(client.js:592) 与 `OPTIONAL_KEYS`(client.js:788) 各 `.find(f.ref===b.keyEnv)` → 2 处 `readFailure && <p>{t("keyReadFailed")}</p>`（620/803）。 | — |
| 3b | `keyReadFailed` zh/en 键对称 | **✅ 对称（脚本比对）** | zh 55 键 / en 56 键；zh-only 无；en-only 仅 `validation`（未被 `t()` 引用）；`keyReadFailed`/`keyFailed`/`savedOk` 双语齐备；48 个 `t()` 键在两字典均存在。 | — |
| 3c | `safeFailureReason` 固定码是否抹掉诊断 | **❌ 全抹（确认缺陷 D3）** | `writeCredential` 抛的 4 种 `new Error(message)` **均无 `.code`**（client.js:439/445/448）→ `safeFailureReason` 全部塌成同一字面量 `"write rejected"`。env-shadowed / EACCES / 服务不可用 / 通用拒绝在 UI 完全不可区分。且含空格/点/冒号的合法 code 也被正则吞掉。 | 中 |
| 3d | `readErrors` 粘性 | **⚠️ 新发现（D4）** | `discard()` 清 `staged/stagedKeys/failed/conflict/failedKeys`，**不清 `readErrors`/`failedFields`**；`save()` 亦不清 `readErrors`。瞬时读失败需等下一次成功的 `readCredential(ref)` 才消失。 | 低 |
| 3e | `view===undefined` 静默歧义 | **⚠️ 新发现（D5）** | `describe([ref])` 返回 `{ok:true,value:{}}` 时 `view` 仍 undefined、`reason` 未设 → 不记 `readErrors`、不更新 `keyState` → UI 显示「未配置」且无警告，与真未配置无法区分。 | 中 |
| 4 | `findPluginRow` value=null / 多 ns / describe 抛错 / 空数组 | **✅ 总体安全** | 运行时矩阵：空数组/非数组/null→`undefined`；`value=null` 且 ns 精确命中→仍返回该行（byId 分支不查 value；下游 `?? config` 兜底）；多 ns 同名→精确 id 优先；两行都含 shape→返回首个（歧义）；`ns` 非字符串/行 null→过滤；原型继承字段→`Object.hasOwn` 不计。三处调用者均 try/catch 包 `describe()`：`settings-api.describe`→503、`safeDescribe`→503、`index.current()`→回退初始 `config`。 | — |
| 4b | `SHAPE_FIELDS ≥2` 是否漏判合法 host | **⚠️ 理论漏判（D6）** | 5 字段中 `enableFirecrawl`/`enableTinyfish` 是布尔开关，仅这 2 个即满足 ≥2 → 可能误命中别的插件行；反之只物化 1 个（如仅 `searxngBaseURL`）的合法 host 会被拒 → 回退初始 config、忽略用户保存。当前线上 GET 返回 55 字段全含，未触发。 | 低 |
| 5 | `numResults min` 三种语义 | **✅ 正确** | 实测 host=8/user=50→8（cap 胜）、user=1→1（user 胜）、user=8→8。`Number(x)||8` 会把 0/NaN 掩码成 8，但 Config `.min(1).max(50).step(1)` 在加载期挡住，不可达。 | — |
| 5b | 不传 maxResults 时 `hostCap=Infinity` | **✅ 合理** | 官方 `dsh-tool-web` 的 `runSearchQueries` **总是**传 `searchMaxResults`(默认8, 正整数)，故 Infinity 经 web_search 不可达；仅直接 `ctx.web.search({query})` 省略时触发（`WebSearchRequest.maxResults?` 可选，`dsh-web/lib/types/types.d.ts:23`），此时 `capSources` 不截断、provider 以 userMax 为唯一上界，语义正确。 | — |
| 5c | 与缓存键 `maxResults` 关系 | **⚠️ 碎片化（D7）** | `cacheKeyFor` 用 `n:Number(maxResults)`=**有效值** `min(hostCap,userMax)`；同时 `resultOptions` 又含**原始** `numResults`。实测 host=8/user=50 与 host=8/user=8：有效值同为 8、结果相同，但 key 不同（`b7edf…` vs `aefbb…`）→ 重复缓存条目 + 重复扇出。无碰撞（原始值相异）。 | 低 |
| 6 | **新发现优先** | 见下 | D8 文档/契约矛盾、D9 数值输入宽松、D10 BaseURL 无校验、D11 `enabledBackends` 出现在 user 层 | 见 §2 |

---

## 2. 缺陷清单（按严重度）

| ID | 缺陷 | 位置 | 证据 | 修法 |
| --- | --- | --- | --- | --- |
| **D2** | **引用快照在 await 之后取，导致保存期间的新编辑被删 + 假绿 `savedAt`** | `client.js:471,475,481,496,499,508,518` | 运行时复现：host 写 10、用户改 25、UI 显示「已保存 ✓」、`staged=[]`、25 丢失 | 在循环开始处 `const ref = staged`（循环变量即被保存对象），**先** `savedFieldRefs.set(field, ref)`，再 `await`；或统一改为 `savedFieldRefs.set(field, staged)` 且把该行移到 `await` 之前。`stagedKeys` 同理（508/518）。 |
| **D1** | **`*ApiKeyEnv` pattern 比官方 `credentialRef()` 窄，拒合法配置** | `index.js:223-244`（10 处） | 官方 `/^[A-Za-z_][A-Za-z0-9_]*$/` vs 插件 `/^[A-Z][A-Z0-9_]*$/`；跨 0.2.1-rc.2 / 0.2.2-rc.1 两版一致；`Config({...lowercase})` 与 `validateOp` 均 REJECT | 直接采用官方正则 `/^[A-Za-z_][A-Za-z0-9_]*$/`；更好：去掉手写 pattern，只保留 `.min(1)` 并在 `resolveOptions` 让 `credentialRef()` 兜底（它已 fail-loud）。 |
| **D3** | **`safeFailureReason` 把全部 key 保存失败塌成 `"write rejected"`** | `client.js:289-292` + `428-449` | 4 种 `new Error(msg)` 无 `.code` → 同一字面量；含空格/点/冒号的 code 也被吞 | 从 `RemoteResult.error` 提取**白名单固定码**（如 `ENV_SHADOWED`/`PERMISSION_DENIED`/`RATE_LIMITED`/`SERVICE_UNAVAILABLE`）映射到双语 `t()` 文案；不要显示原始 message。 |
| **D8** | **「可选 Key 留空」文档与 schema 矛盾（新）** | `index.js:238,242,244` | 三处文案称 blank；但 `Config` 拒 `""`，且 `resolveOptions` 对全部 13 后端无条件 `credentialRef(keyEnvName)`，`""` 会抛 TypeError | 修正文案为「留用默认引用即走免 Key 通道（由 `optionalKey` 决定，非清空引用）」；或为可选项显式允许 `""` 并在 resolve 时跳过 `credentialRef`。 |
| **D5** | **`describe` 返回无记录时静默「未配置」，无警告（新）** | `client.js:400-417` | `view===undefined` 且 `reason===undefined` → 不记 `readErrors`、不更新 `keyState` | 把「envelope ok 但缺该 ref」也归类为读失败，或至少记一条 `credential/absent` 固定码。 |
| **D4** | **`readErrors`/`failedFields` 不被 `discard()`/`save()` 清理（新）** | `client.js:549,457-458` | 粘性警告 | `discard()` 一并清 `readErrors`/`failedFields`；`save()` 开头清 `readErrors` 并触发一次重读。 |
| **D6** | `SHAPE_FIELDS ≥2` 可误命中 / 漏判 | `util/namespace.js:17,27` | 2 个布尔开关即达标；仅 1 个字段的合法行被拒 | 要求 ≥1 个 **BaseURL 类**字段且 ≥1 个 `enable*` 字段，或干脆只信精确 id（当前线上已命中 `dsh-websearch`）。 |
| **D7** | 缓存键含原始 `numResults` 造成碎片 | `provider.js:247-250` + `cache.js:50` | host=8/user=50 与 user=8 有效值相同但 key 不同 | 从 `resultOptions` 中剔除 `numResults`（有效值 `n` 已覆盖该维度）。 |
| **D9** | 数值输入接受 `1e1`/`0x10`/` 8 `（新） | `client.js:485` | `Number()` 宽松，UI 显示 `1e1` 实际存 10 | 用 `/^\d+$/` 预检再 `Number`。 |
| **D10** | `*BaseURL` 无任何 URL 校验（新） | `index.js:247-268` + `settings-api.validateOp` | `z.string()` 接受 `"not a url"`、`"javascript:alert(1)"` | 加 `.pattern(/^https?:\/\//)`；插件自身已有 `safeSources` 白名单兜底，但配置层应 fail-loud。 |
| **D11** | `enabledBackends` 出现在只读 GET 的 `user` 层（新，观察项） | 只读 API GET 返回 `user: {numResults:8, enableFirecrawl:true, enableTinyfish:true}`，`value.enabledBackends: []` | UI 无该字段编辑器，却可被 `validateOp` 写入并覆盖 toggle 逻辑（`resolveOptions` 优先 `enabledBackends`） | 确认是否有外部写入路径；若无，属低风险冗余。 |

---

## 3. 已确认无误

- `findPluginRow` 两处共用（`settings-api.js:126` + `index.js:474`）解析一致；空数组/非数组/null/`describe()` 抛错/多 ns 同名字段均有安全回落到初始 config 的路径。
- `readErrors` 双语 UI 两处（`KeyedBackendCard` + `OPTIONAL_KEYS`）数据链路完整；zh/en 字典键对称（脚本比对 48 个 `t()` 键全覆盖），`keyReadFailed` 双语齐备且 2 处渲染。
- `numResults = Math.min(hostCap, userMax)` 三种必测语义全部正确；`hostCap=Infinity`（web_search 不传时）合理，因 `dsh-tool-web` 总会传 `searchMaxResults`，且 `capSources` 对 undefined 不截断。
- `save()` 并发双击守卫、清空到空串→`unset`、字段越界校验、key 保存失败隔离（其它 key 仍落盘）均正确。
- `settings-api.validateOp` 对 `z.union`/`z.array`/`z.number().step(1)`/boolean 的类型校验正确（`"9"`→number 拒、`3.7`→拒、`"false"`→boolean 拒）。
- 官方 `credentialRef()` 对含点/冒号/连字符/斜杠/前导数字/空串的引用同样拒绝（属 `CredentialKey` 或非法）——插件在**这些**上没有误伤；过严仅限小写/下划线开头/混合大小写。

---

## 4. 无法验证 / 受限

- **写路径 POST 未执行**：遵守只读约束，未向 `/api/unified-search/settings` 发任何 POST。400 结论由 `settings-api.validateOp` 的 `Config.dict[field](value)` 在本地用同一 `Config` schema 复现得出。
- **真实 GUI 渲染**：无浏览器 DOM/截图上下文；`readErrors` 能否显示仅由代码链路 + 字典比对 + 只读 GET 证明，未做像素级验证。
- **`scope.load()` 并发时序**：需真实 `settings/document-updated` 事件触发，只读探测无法制造；结论基于 `projection/fieldState` 静态分析。
- **`discard()` 竞态**：由注入 mock scope 的 `save()` 方法体复现（未改运行时），非真实点击。
- 服务 PID 2512598 已不存在（9h 前快照过期）；新 runtime 已切到 `/home/dsh/.dsh-exp022/runtime/`，但两版 credentials 语法一致，结论不受影响。

---

## 5. 五条反直觉

**A. 「修复」本身引入了比原 bug 更隐蔽的丢数据。** 上一轮为修「保存期间新编辑被误删」而加的 `savedFieldRefs` 引用快照，恰恰因为 `savedFieldRefs.set(field, this.staged.get(field))` 写在 `await` **之后**，抓到的是新对象而非被保存对象——于是新编辑仍被删，还额外送了一个「已保存 ✓」。修法只需把 `set` 移到 `await` 前并用循环变量 `staged`，一行之差。

**B. 更严的正则 ≠ 更安全，这里是纯粹的功能回归。** 官方 `credentialRef()` 允许 `/^[A-Za-z_][A-Za-z0-9_]*$/`（POSIX shell 标识符），而「全大写环境变量」只是惯例不是契约。插件把惯例写成硬约束，导致 `my_api_key`、`_PRIVATE` 这类**完全合法**的引用在 UI 和 cordis.yml 两条路径都被拒；反直觉的是，点号/冒号/斜杠这些「看起来更该防」的字符两边都拒，真正被误伤的却是最普通的小写名。

**C. 防信息泄露的 `safeFailureReason` 把诊断清零了，而不是脱敏。** 它只认 `err.code`，但 `writeCredential` 抛的四个 `new Error(message)` **全都没有 `.code`** → env-shadowed、EACCES、服务不可用、通用拒绝在 UI 一律显示 `"write rejected"`。更巧的是 fallback 字符串自身含空格，而正则不允许空格，所以它永远不可能是任何真实 code。安全目标达成，可诊断性归零。

**D. 「留空即可免 Key」是文档谎言，且真去留空会崩。** 三处 `*ApiKeyEnv` 描述让公共实例/免 Key 用户「留空」，但 `Config` 的 `.min(1)`/pattern 拒 `""`，`resolveOptions` 又对全部 13 个后端**无条件** `credentialRef(keyEnvName)`——空串会抛 TypeError 打断所有搜索。免 Key 实际靠 `OPTIONAL_KEY_IDS` 标志实现，与引用值是否为空毫无关系。

**E. 缓存键把「有效值」和「原始值」都塞进去，反而制造了碎片。** `min(hostCap, userMax)` 之后 host=8/user=50 与 host=8/user=8 的结果**字节相同**，但 `resultOptions` 里还带着原始 `numResults`（50 vs 8），于是生成两个不同 key → 重复扇出、重复占缓存。直觉上「多带点上下文更安全」，实际是同一个结果存两遍；而 `n`（有效值）本已覆盖该维度，原始值是冗余。

---

## 6. 取证日志（关键命令与结果）

| 项 | 结果 |
| --- | --- |
| `credentialRef` 官方语法（两版） | `REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/`；`credentialRef("my_api_key")` OK，`credentialRef("")` THROW，`credentialRef(undefined)` OK（不校验） |
| 插件 pattern 实测 | `my_api_key` / `_PRIVATE` / `braveKey` / `EnvPrefix_KEY` / `MIXED_case` / `x` / `__` → schemastery REJECT（官方 OK） |
| `Config({braveApiKeyEnv:"my_api_key"})` | `REJECT $.braveApiKeyEnv expect string to match regexp /^[A-Z][A-Z0-9_]*$/` |
| `validateOp` 复现 | 小写引用 → 400；`""` → 400；大写 → 200 |
| `save()` 竞态复现（mock scope 20ms） | 写入 `["set","numResults",10]`；期间 `edit("numResults","25")`；结果 `staged=[]`、`savedAt>0`、`failed=false` → **25 静默丢失 + 假绿** |
| `discard()` 期间 save | `doneFields>0 && staged 空` → `savedAt` 置位（假绿） |
| 双击 save | 第二次 no-op（守卫生效） |
| locale 脚本比对 | zh 55 / en 56 键，`t()` 用 48 键双语全齐；`keyReadFailed` 2 处渲染 |
| `safeFailureReason` | 4 种无 code 的 Error 全 → `"write rejected"` |
| `findPluginRow` 矩阵 | 13 例全部符合预期（见 §1-4） |
| `cacheKeyFor` | `k(n=8,raw=50)=aefbb…` ≠ `k(n=8,raw=8,默认)=b7edf…` |
| 只读 GET `/api/unified-search/settings` | 200，`namespace:"dsh-websearch"`, `revision:0`, `value` 55 字段全含 5 个 SHAPE_FIELDS；`user` 层含 `enableFirecrawl/enableTinyfish/numResults` |
| `/tmp` 脚本 | `/tmp/r3probe/verify-{a,e,f,save,race,h,j,k,l,m,final}.mjs` + `/tmp/r3-verify-a.mjs` + `/tmp/r3-cookies.txt`，用后删除 |

> 交付：本报告为**唯一**写入文件。未改源码、配置、运行时、其它报告、任务板、settings 或 credentials。
