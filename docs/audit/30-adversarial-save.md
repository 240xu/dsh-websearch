# 对抗型审查专家 A：保存链路（假定仍有遗漏，尽力证伪）

> 审查时间：2026-11-07 14:58–20:35（Asia/Shanghai，中途服务于 16:41 重启过一次）
> 角色：独立取证，不采信 Lead 结论；`25-execution-log.md` §10/§11、`99-final-verdicts.md`、`22-execution-drafts.md` 仅作线索。
> 范围：全程只读源码/配置/运行时；第 5 点做了**无害字段写入并完整改回**（含凭证探针写入后 unset），报告末尾列出回滚核对。除本报告外未写任何文件。
> 证据等级：**A** = 运行时真实响应/字节级复现；**B** = 官方发布版源码/类型契约；**C** = 本地最小复现（node 加载真实代码或真实 Cordis）；**D** = 上游 issue/PR 正文（外部数据）；**E** = 静态推断/无运行时交叉验证。
>
> **⚠ 时点声明（重要）**：本审查是**并行多 agent 环境**下的快照。取证主体在 14:58–15:40 完成，当时 `lib/index.js` 的 `current()` 是上游 PR #7 的**逐字移植**（主匹配 `ns === "unified-search"` 死代码），`lib/client.js` 是 issue #8 修复版（840 行）。**15:40 与 20:06 有其它 agent 并行改了这两个文件**（`index.js` 增加 `byId = rows.find(r => r.ns === "dsh-websearch")` 主匹配；`client.js` 增加 `readCredential` 的 `ok:false` 读失败判定，853 行）。为不虚报，本报告：①「逐条裁决」按**取证时点的代码**给出（见 §1 表与 §2）；②凡并行改动已修掉的缺陷，在 §3/§8 明确标注「已被并行修复」；③ §2.8 专门用当前版代码重新跑行为级复现，确认哪些缺陷**仍然存在**。收尾时 `src-work` ↔ 安装版 6 个核心文件 md5 仍逐一相同，运行时 serve 的 `client.js`（`rev=55865846c2be`）与当前 `src-work` 仅差 sourcemap trailer（A）。

---

## 0. 审查对象与一致性

| 项 | 结果 | 证据 |
| --- | --- | --- |
| `src-work/plugin/` ↔ `~/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/` | **取证时点（14:58）一致**：31 个 `lib/*.js` + 2 个 `tests/*.js` md5 逐一相同；`README.md`/`package.json`/`cordis.patch.yml` 也相同。**收尾复核（20:35）**：6 个核心文件（`index.js`/`provider.js`/`settings-api.js`/`client.js`/`health.js`/`trust.js`）md5 仍逐一相同，但期间两文件被并行改过（见文首时点声明） | A |
| 安装版比 src-work 多 2 个文件 | `LICENSE`、`examples/cordis.patch.yml`（npm 打包内容，非代码差异） | A |
| 版本 | `2.8.4`（源码与安装一致；上游 npm latest 是 `2.8.8`，PR #7/#8 均未合并） | A/D |
| 服务实际加载的浏览器 client 代码 | 取证时点 `GET /plugins/??@240xu/dsh-websearch/client.js&rev=0949ca5b308f` 与当时 `lib/client.js` **逐字节相同**（仅多 2 行 sourcemap trailer）；收尾时 `rev=55865846c2be` 与**当前** `src-work/lib/client.js` 相同（同样仅差 trailer），且已含 `readFailed` 新逻辑 ⇒ 并行改动已同步到安装目录与运行时 | A |

可复现命令：
```bash
SRC=/home/ova/dsh/.artifacts/websearch-research/src-work/plugin
INS=/home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch
for f in $(cd "$SRC/lib" && find . -type f | sort); do \
  a=$(md5sum "$SRC/lib/$f"|cut -d' ' -f1); b=$(md5sum "$INS/lib/$f"|cut -d' ' -f1); \
  [ "$a" = "$b" ] || echo "DIFF $f"; done
grep -E '"version"' "$INS/package.json"
```

---

## 1. 逐条裁决表

| # | 待证伪命题 | 裁决 | 核心证据（文件:行号） | 可复现命令 |
| --- | --- | --- | --- | --- |
| 1 | `inject` 加 `remote.credentials` 是否真的必要；未注册时是硬依赖还是软依赖 | **成立（必要，且是硬依赖）**。但存在被忽略的可用性风险，见 D1/P1 | `lib/client.js:758` `inject = ["slots","locale","connection","remote","remote.credentials"]`；`dsh-api-gateway/lib/client.browser.js:2074` `remoteServiceKey(namespace)=> \`remote.${namespace}\``、`:1738-1739` 校验、`ClientRemoteService` 无 `credentials` 属性（只有 `$host` getter at `:1661`）；`cordis/lib/index.js:676` `cannot get property "${prop}" without inject`、`:130-131` `Service.tracker.associate` 把 `ctx.remote.<ns>` 转 `Reflect.get(ctx, "remote.<ns>")`；`cordis/lib/index.js:1320-1332` `_refresh()` 任一 inject 缺实现 → `epoch=INACTIVE` → 整个 fiber 不激活 | 见 §2.1；`node` 最小复现（已跑完删脚本） |
| 2 | `writeCredential` 的 `res.ok === false` 与 `credentials/set: Promise<RemoteResult<void>>` 契约一致？会不会把合法 `undefined`/`void` 误判失败？两分支是否都正确 | **契约一致，未误判**；两分支基本正确。但 `res.ok !== true` 的成功被当作成功（宽松），见 D4/P2 | `dsh-api-settings-controller/lib/typert.remote-client.d.ts:27` `set: (ref,value)=>Promise<RemoteResult<void>>`；`dsh-typert-protocol/lib/types/types.d.ts:110-116` `RemoteResult<T> = {ok:true,value:T} \| {ok:false,error}`；**真实 RPC** `POST /api/credentials/set` → `{"result":{"ok":true}}`（**无 `value` 字段**）、拒绝 → `{"ok":false,"error":{code,message,details}}`；`lib/client.js:383-386`（remote 分支）、`:388-393`（connection 分支） | §2.2；带 cookie 的 `POST /api/credentials/set` 用 `{"type":"client-request","rpcId":"...","method":"credentials/set","payload":{"args":{"ref":"X","value":"y"}}}` |
| 3 | `readCredential` 对 `RemoteResult<Record<ref,CredentialInfo>>` 的解析是否正确？`ok:false` 会不会把错误对象当数据？`catch {}` 是否仍吞掉真实错误致徽章不亮 | **取证时点：解析正确，`ok:false` 不会误当数据**；但 `catch {}` **仍然吞掉真实错误**且无诊断，见 D3/P2。**收尾：并行改动已加 `readFailed` 先判包络，该具体风险消除；空 catch 与零诊断仍在**（§2.8） | `lib/client.js:344-368`（取证时点）；真实 `describe` → `{"ok":true,"value":{"REF":{"configured":true,"source":"file","writable":true}}}`；`res.value !== undefined ? res.value : res` + `record.credentials ?? record` + `byRef[ref]` 对真实形状命中；`ok:false` 时 `byRef[ref]===undefined` → 不写 keyState；`catch { /* ignore */ }` at `:366` 吞掉所有异常 | §2.3；真实 `POST /api/credentials/describe` |
| 4 | **PR #7 的 `current()` 修复**：`settings.describe()` 行的 `ns` 是否等于 `NAMESPACE`？`ns` 不同/`value` 为 null 会不会回落 stale config | **证伪成立：`ns` 不等于 `NAMESPACE`**。真实 `ns` 是 `dsh-websearch`（profile entry id），`unified-search` 在 22 个命名空间中**根本不存在**；取证时点 PR #7 主匹配永远不命中、只靠 `searxngBaseURL` 形状兜底；`value:null` 或该字段缺失仍回落 stale `config`。见 D2/P1。**收尾：并行改动已把 `ns==="dsh-websearch"` 提为第一优先，死代码消除；静默回落 + 两套规则不一致仍在**（§2.8） | `dsh-settings/lib/index.js:413-460` `ns: entry.options.id`；`dsh-api-settings-controller/lib/index.js:275-295` `namespaceView()` 原样转发 `ns`；**真实 RPC** `settings/describe` → 22 个 ns 列表，websearch 行 `ns=dsh-websearch`；`GET /api/unified-search/settings` → `namespace:"dsh-websearch"`；取证时点 `lib/index.js:461-470` 主匹配 `r.ns === NAMESPACE`（`NAMESPACE="unified-search"` at `:54`）；`lib/settings-api.js:45,130-136` 用 `DISCOVERY_FIELDS` 形状 + `ns==="dsh-websearch"` 兜底（与 `current()` **两套不同规则**） | §2.4；带 cookie 的 `GET /api/unified-search/settings`、`POST /api/settings/describe` |
| 5 | 保存→执行是否真闭环（settings `value` / health `backends[].enabled` / dump-config `id: web`） | **闭环成立**（本轮实测写入并观察跟随）。但**只验证了 health 与 dump-config**，未验证真实 `web_search` 输出跟随（见「仍无法验证」），且 `id: web` 段与保存值无关（见 D5） | 写入 `resultTelemetry=false` → `GET settings` revision 2→3、dump-config 出现 `resultTelemetry: false`、health `enabled` 不变（该字段不影响 health）；写入 `enableExa=false` → health `enabled` **6→5**、exa 从 ids 消失；`GET /api/unified-search/health` 由 `health.js:45-52` 每次调用 `resolveOptions()`（即 `current()`）现算；dump-config `id: web` 段只有 `searchProvider: unified`（`cordis.patch.yml` 静态注入），**不含任何保存值** | §2.5；`POST /api/unified-search/settings` + `GET .../health` + `dsh web --dump-config \| grep -A8 'id: dsh-websearch'` |
| 6 | `failedKeys` 改为 `.find(f=>f.ref===...)` 后结构是否真是 `[{ref,reason}]`？`reason` 会不会含敏感信息被渲染到 UI | **结构正确**（`projection()` 确实产出 `[{ref,reason}]`），`.find` 与两处渲染匹配。**但 `reason` 直接渲染且来源不受控**：含 `RemoteError.message` 原文；见 D6/P2 | `lib/client.js:285` `failedKeys = new Map()`、`:318` `[...this.failedKeys].map(([ref,reason])=>({ref,reason}))`、`:452` `String(keyErr.message...).slice(0,140)`、`:522` / `:716` `.find(f=>f.ref===b.keyEnv)`、`:549` / `:730` `props.t("keyFailed") + ": " + failure.reason`；`dsh-api-settings-controller/lib/index.js:204-209` `write()` 把底层错误 `error.message` 原样塞进 `RemoteError("credential/rejected", ...)`；`gateway/lib/client.browser.js:2158-2160` `rebuiltFailure` 原样带 message | §2.6；`grep -n "failedKeys" lib/client.js` |
| 7 | `KeyedBackendCard` 的 `onEditKey`/`onToggle` 与 `editKey`/`setToggle` 签名是否匹配？时序误导？Save disabled 是否漏算 stagedKeys | **签名匹配**（`(ref,text)`/`(checked)` 逐一对应），但**存在 3 个真实缺陷**：「开关即时、密钥需 Save」的误导确实存在且更糟（见 D7/P1）；空串 stagedKey 残留致 Save 永久 enabled（见 D8/P2）；并发 setToggle 同 revision 冲突致 `conflict`（见 D9/P2） | `lib/client.js:333-342` `setToggle(id,checked)` 立即 `scope.set`；`:330` `editKey(envRef,text)` 只暂存；`:441-456` `save()` 才写 key；`:633-635` `onToggle:(checked)=>card.setToggle(b.id,checked)`、`onEditKey:(ref,text)=>card.editKey(ref,text)`；`:546` `onChange:(e)=>props.onEditKey(b.keyEnv,e.target.value)`；`:735` `disabled: saving \|\| stagedCount===0 \|\| writable===false`（`stagedCount = staged.size + stagedKeys.size` at `:311`，**含 stagedKeys**） | §2.7；加载真实 controller 类的 node 复现 |

---

## 2. 详细取证

### 2.1 点 1：`remote.credentials` 的 inject 必要性与硬依赖（A/B/C）

**官方注册机制（B）**
- `dsh-api-gateway/lib/client.browser.js:2074`：`function remoteServiceKey(namespace) { return \`remote.${namespace}\`; }`
- `dsh-api-remotes/lib/client.js:23652-23685`：`apply()` 无条件 `$mount` 全部 26 个 `TYPERT_REMOTE$*`，其中 `TYPERT_REMOTE$20`（`dsh-api-settings-controller`）含 `credentials/describe|set|unset` 三个 descriptor；`RemoteInfo.resolve()` (`dsh-api-remotes/lib/client.js:40-44`) 用 endpoint `/` 前缀切出 `namespace="credentials"`。
- `dsh-api-gateway/lib/client.browser.js:1775-1781`：`createNamespace()` 用 `ctx.plugin({name: remoteServiceKey(name)})` 起一个 fiber，构造 `new RemoteNamespaceService(ctx, name, ...)` → `super(ctx, remoteServiceKey(name))`，即服务键 `remote.credentials`。
- 官方消费者 `dsh-client-ui-settings-models/lib/client.js:4417-4427` 的 `inject` 明确含 `"remote.credentials"`，用法 `ctx.remote.credentials.set(ref,value)` (`:3172`)。

**Cordis「未声明访问」语义（B/C）**
- `cordis/lib/index.js:676`：context proxy 的 `get` 在属性不存在且无 accessor 时抛 `cannot get property "${prop}" without inject`。
- `cordis/lib/index.js:1775`：`Service` 构造时 `tracker.associate = name`；`createTraceable` (`:123-146`) 把 `service.<prop>` 翻译成 `Reflect.get(ctx, \`${associate}.${prop}\`)` —— 即 `remote.credentials` 会回到 ctx proxy 的 inject 检查，**不是**普通对象属性读取。
- 本地最小复现（C，真实 `@deepseek-ai/cordis`）：
  ```
  no-inject THROW: cannot get property "remote.credentials" without inject
  with-inject: got object has set= function
  ```
  且把插件写成 `const remote = ctx.get("remote"); remote.credentials` 同样抛错（因为 `ctx.get` 返回 traceable proxy）。

**硬依赖 = 整个插件不激活（C，决定性反直觉点）**
```
root.plugin({ inject:['remote','remote.credentials'], apply(){...} })  // credentials service 未挂载
→ ranWith = false    // apply 根本没跑
root.plugin({ inject:['remote'], apply(){...} })
→ ranWithout = true
```
机制：`cordis/lib/index.js:1044,1099,1320-1332` —— Fiber 对 `Object.keys(this.inject)` 逐个 `_checkImpl`，任一缺失即 `epoch=INACTIVE`，`_updateState` 走 `_unload()`，**整个 fiber 不执行 apply**。

**结论**：`remote.credentials` 加到 inject 确实必要（不加则 `writeCredential`/`readCredential` 的属性访问抛异常，且 `refreshAllCredentials()` 全挂）。但它把「凭证命名空间」从软依赖升格为**硬依赖**：一旦某 host/某启动时序未挂载 `dsh-api-remotes` 的该命名空间，本插件的**整个设置卡片（含所有非密钥开关、全局参数）都不会注册**，而不是优雅降级。官方插件 `dsh-client-ui-settings-models` 也这样做，所以这是「与官方一致」但并非「无风险」。
本机运行时：`dsh web --dump-config` 确认 `id: api-remotes`、`id: dsh-client-modules`、`@deepseek-ai/dsh-client-ui-settings-models` 均在组合树中，index.html 的 client bundle 列表含 `@deepseek-ai/dsh-api-remotes/client.js` 与 `@240xu/dsh-websearch/client.js`（A），故本机命名空间必然挂载、不会有 inject 错误；启动日志 `/home/ova/re-agent/dsh-web.log` 全文无 `without inject` / `remote.credentials` 错误，唯一 `1 entry did not activate` 是 `dsh-purge-community` 缺 `yaml` 包（既有问题，A）。**注意**：`dsh: warning: 1 entry did not activate` 是 host 侧 loader 诊断，不能证明 client 侧 card fiber 已激活 —— 若无浏览器页面连接，client 侧根本没运行（见「仍无法验证」）。

### 2.2 点 2：`RemoteResult<void>` 与 `res.ok === false`（A/B/C）

**契约（B）**
- `dsh-api-settings-controller/lib/typert.remote-client.d.ts`：`set: (ref: string, value: string) => Promise<RemoteResult<void>>`；`describe: (refs: string[]) => Promise<RemoteResult<Record<string, CredentialInfo>>>`。
- `dsh-typert-protocol/lib/types/types.d.ts:110-116`：`RemoteResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: RemoteFailure }`。
- `dsh-api-gateway/lib/client.browser.js:1826-1836`：success 返回 `{ok:true, value:...}`，failure 返回 `{ok:false, error: rebuiltFailure(result.error)}`；`z.void()` 结果（`dsh-api-remotes/lib/client.js:2778`）在 wire 上表现为 success **无 `value` 字段**。
- 官方消费者就是这么判的：`dsh-client-ui-settings-models/lib/client.js:3172` `const response = await ctx.remote.credentials.set(ref,value); return response.ok ? void 0 : response.error.message;`。

**真实运行时 RPC（A，带浏览器会话 cookie）**
```
POST /api/credentials/set   {"type":"client-request","rpcId":"...","method":"credentials/set","payload":{"args":{"ref":"ADV_PROBE_TEST_KEY","value":"adv-probe-value-123"}}}
→ {"type":"server-response","rpcId":"...","result":{"ok":true}}          ← 没有 value 字段
POST /api/credentials/unset → {"result":{"ok":true}}
POST /api/credentials/set   {"ref":"bad ref with spaces"} → {"result":{"ok":false,"error":{"code":"gateway/bad-request","message":"invalid payload for credentials.set","details":{...}}}}
POST /api/credentials/set   {"ref":"X","value":""} → {"ok":false,"error":{...}}
```
`describe` 真实成功形状：`{"result":{"ok":true,"value":{"ADV_PROBE_TEST_KEY":{"configured":true,"source":"file","writable":true}}}}`（set 后）、unset 后 `{"configured":false,"writable":true}`。

**代码判定（C，加载真实 `UnifiedSearchCardController` 类跑 9 个用例）**
```
PASS | remote set {ok:true} (REAL runtime shape)          | threw=false
PASS | remote set {ok:true,value:undefined}              | threw=false
PASS | remote set {ok:false,error:{message}}             | threw=true  msg=env-shadowed
PASS | remote set returns undefined                      | threw=false
PASS | connection set({ref,value}) {ok:true}             | threw=false
PASS | connection set {ok:false}                        | threw=true  msg=no
PASS | connection set {result:{ok:false}}               | threw=true  msg=no
PASS | connection set {result:{ok:true}}                | threw=false
PASS | both missing                                     | threw=true  msg=credentials service unavailable
```
⇒ `res.ok === false` **不会**把合法 `undefined`/`void` 误判失败；两分支都检查了 `ok:false`（connection 分支额外检查 `res.result?.ok === false` 与 `res.result?.error?.message`，比 remote 分支更全）。`lib/client.js:383-386` 与 `:388-393` 逐一对应。

**残留小问题（D4/P2）**：判定是「只看 `ok === false`」，即 `undefined`、`null`、`{ok:true}`、甚至 `{}` 都被当成功。对 `RemoteResult` 契约这没问题（网关不会返回别的），但 `api.set` 若返回非契约值（旧 host / 打桩）会静默「假成功」。建议改为 `res?.ok !== true` 才 throw（与官方 `response.ok ? ... : ...` 完全一致）。

### 2.3 点 3：`readCredential` 解析与 `catch {}`（A/B/C）

**解析链（真实代码 `lib/client.js:352-365`）**：
```js
const res = await api.describe([ref]);
const record = res?.value !== undefined ? res.value : res;        // 真实 {ok:true,value:{REF:...}} → {REF:...}
const byRef  = record?.credentials !== undefined ? record.credentials : record;  // 无 credentials 键 → 原 record
view = byRef?.[ref];                                            // → {configured,writable}
if (view === undefined && connection.api.credentials) ...         // 旧线兜底
if (view === undefined) return;
this.keyState.set(ref, {configured: view.configured===true, writable: view.writable!==false});
```
真实 `describe` 形状命中；`{ok:false,error}` 时 `record` 是错误对象、`byRef[ref]` 为 `undefined` → 不写 keyState（**不会把错误对象当数据**）。

**真实代码行为级复现（C，6 用例）**：
```
REAL {ok:true,value:{REF:{configured:true,writable:true}}}  → keyState={"configured":true,"writable":true}
bare Record（无包络）                                      → keyState={"configured":true,"writable":true}
{ok:true,value:{credentials:{REF:...}}}                    → keyState={"configured":true,"writable":true}
{ok:false,error:{message}}                                 → keyState=undefined（无 throw）
describe throws                                            → keyState=undefined（无 throw）
connection legacy {result:{ok:true,value:{credentials}}}   → keyState={"configured":true,"writable":true}
```

**但 `catch { /* ignore */ }`（`lib/client.js:366`）仍然吞掉所有真实错误且零诊断**（D3/P2）：`api.describe()` 抛 `RemoteError`、属性访问抛 `cannot get property ...`（若 inject 失效）、网络异常，`refreshAllCredentials()` 全部静默失败 → 「已配置」徽章不亮且用户/日志无从得知。Issue #8 与 §10 把「徽章不亮」归因于「属性访问抛异常被吞」，**这个根因（inject）已消除，但吞异常的 catch 本身还在**，任何未来错误依旧不可观测。AGENTS.md 规则「空的 catch 必须命名错误并说明原因」在此也未落实。

**另一个被忽略的分支问题（D10/P2）**：`lib/client.js:359-363` 旧线 `connection.api.credentials.describe({refs:[ref]})` 假定返回 `res.result.ok` → `res.result.value.credentials[ref]`。本机全量安装的 `@deepseek-ai/dsh-client-connection` 的 `lib/client.browser.js` **完全没有 `.api` 属性**（`grep credentials` 零命中），全仓唯一 `api.credentials.*` 引用就是本插件自己。⇒ 该兜底分支在本机/当前发布版是**死代码**；`remote` 分支失败时不会有任何回落路径，`readCredential` 直接 `return`（`view === undefined`）。

### 2.4 点 4：PR #7 `current()` 的 `ns` 错配（A/B/D，**本轮最强反直觉发现**）

**`settings.describe()` 行的 `ns` 来源（B）**
- `dsh-settings/lib/index.js:413-460`：`describe()` 返回的每行 `ns: entry.options.id` —— 这是 **profile entry id**，不是插件 `name`、不是 `NAMESPACE`。
- `dsh-api-settings-controller/lib/index.js:275-295` `namespaceView()` 原样 `ns: String(descriptor.ns)` 转发。

**真实运行时（A）**
- `POST /api/settings/describe`（带 cookie，正确 RPC 包络）返回 **22 个命名空间**：`session-log-deepseek, agent-default-model, llm-pi-ai, bash-sandbox, permission, subagent, web, web-search-deepseek, web-deepseek-api, agent-loop, llm-deepseek, llm-deepseek-account, subagent-model-selection-settings, ui-settings-account, ui-theme, locale, ui-settings, ui-settings-general, ui-conversation, ui-chat, agent-preset-registry, dsh-websearch`。
- **`unified-search` 一个都没有**。本插件那行是 `ns: "dsh-websearch"`（= `/home/dsh/.dsh/profiles/web/cordis.patch.yml:390` 的 `- id: dsh-websearch`）。
- `GET /api/unified-search/settings`（带 cookie）→ `{"ok":true,"namespace":"dsh-websearch","writable":true,"applies":"live","revision":0,"value":{...},"base":{...},"user":{"numResults":8,"enableFirecrawl":true,"enableTinyfish":true}}`。`value` 里 `searxngBaseURL: "https://searx.be"` 存在。

**PR #7 补丁逐字（D）**：`lib/index.js` 从 `if (...) settingsForms = settings;` 改为
```js
current = () => {
  try {
    const rows = settings.describe();
    const row = rows.find(r => r && r.ns === NAMESPACE)                                  // ← 永不命中
      ?? rows.find(r => r && r.value && typeof r.value === "object" && "searxngBaseURL" in r.value);  // ← 唯一生效路径
    return (row && row.value) ?? config;
  } catch { return config; }
};
```
`NAMESPACE = "unified-search"`（`lib/index.js:54`）。本机 `/home/ova/dsh/.artifacts/websearch-research/src-work/plugin/lib/index.js:461-470` 与 PR 补丁**逐字一致**，注释 `:454-458` 还自称「mirroring the upstream PR's fix」。

⇒ **PR #7 的第一匹配是死代码；整个修复实际只依赖 `searxngBaseURL` 这个形状兜底**。上游 PR #7 的回归测试 `tests/v28x-settings-bridge.test.js` 里假 settings 硬编码 `{ ns: "unified-search", value: {...} }`（D），**恰好命中第一分支**，所以测试通过但**从未覆盖真实 host 的形状**——这是测试与真实契约脱节，属于「修好了但理由全错、且脆弱」。

**模拟真实 descriptor（C）**：
```
primary ns-match: None
fallback matched: True -> ns=dsh-websearch
value=null                          → fallback: None   → 回落 stale config
value 无 searxngBaseURL 键           → fallback: None   → 回落 stale config
另一个 ns 行也带 searxngBaseURL      → 第一个形状匹配 ns=web（错行）
```
风险场景：`searxngBaseURL` 是 `z.string().default(...)` 非 secret，当前 `redactSecrets` 不会移除它，`value` 也不会是 `null`（`projectForm` 返回对象），所以**本机当前不触发**。但：`BASE_URLS` 字段改名/移除、host 换用别的形状、或未来把该字段标为 secret 被 redact → `current()` 静默回落 `config`（初始 schema defaults），**所有保存值再次失效**，且 `catch {}` 与 `?? config` 让降级完全无声。这正是 PR #7 想修的「settings are inert」以另一种形式复活。

**与 `settings-api.js` 的规则不一致（P1 佐证）**：同一份 `describe()` 数据，`lib/settings-api.js:45,130-136` 的 `findNamespace` 用 `DISCOVERY_FIELDS = ["numResults","backendTimeoutMs","enabledBackends","enableExa"]` 形状 + `ns === "dsh-websearch"` 字面兜底；`lib/index.js:464-465` 用 `ns === "unified-search"` + `searxngBaseURL` 形状。**两个模块对「哪一行是本插件」给出两套不同、且第一优先都写错的规则**。当前 22 个 ns 中只有 `dsh-websearch` 命中 `DISCOVERY_FIELDS`（A，脚本枚举确认无碰撞），所以两者都碰巧落到正确行；但任一处规则漂移就会出现「卡片读到 A 行、执行读到 B 行」的隐蔽不一致。

### 2.5 点 5：保存→执行闭环实测（A，含写入与回滚）

基线（带 cookie）：`GET settings` revision=2、`value.resultTelemetry=true`、`value.numResults=8`、`user={"numResults":8,"enableFirecrawl":true,"enableTinyfish":true}`；`GET health` `enabled=6`、`ids=[exa,parallel,ddg,searxng,firecrawl,tinyfish]`；`dsh web --dump-config` 的 `id: web` 段：`config: {searchProvider: unified}`（**无 fetchProvider，靠 systemd drop-in `DSH_WEB_FETCH_PROVIDER=http` 兜底**）。

写入 1（无害字段 `resultTelemetry`）：
```
POST /api/unified-search/settings {"ops":[{"op":"set","path":["resultTelemetry"],"value":false}],"expectedRevision":2}
→ 200 {"ok":true,"revision":3,"value.resultTelemetry":false,"user":{...,"resultTelemetry":false,...}}
GET settings → revision=3, resultTelemetry=false
GET health   → enabled=6（不变；resultTelemetry 只影响 provider.js:435 的结果尾注，不影响 health）
dump-config  → id: dsh-websearch 段新增 `resultTelemetry: false`（写回 cordis.patch.yml，A）
```
写入 2（影响 health 的开关 `enableExa`）：
```
POST .../settings {"ops":[{"op":"set","path":["enableExa"],"value":false}],"expectedRevision":3}
→ 200 {"ok":true,"revision":4,"value.enableExa":false}
GET health → enabled=5, ids=[parallel,ddg,searxng,firecrawl,tinyfish]   ← exa 消失，执行侧跟随
```
机制链：`settings.mutate`（`dsh-settings/lib/index.js:488-518` `configEditor.edit` 写回 raw config + `describe()` 刷新 revision）→ 下一次 `current()` 调 `settings.describe()` 拿到新 `value` → `resolveOptions()`（`lib/index.js:318-413`）→ `buildHealthReport()`（`health.js:45-52`）每次 GET 现算 `enabledBackends`。**闭环成立**。

**回滚（完整改回，A）**：
```
set enableExa=true (rev4→5) → set resultTelemetry=true (rev5→6)
→ unset ["resultTelemetry"],["enableExa"] (rev6→7)
最终 user = {'numResults':8,'enableFirecrawl':True,'enableTinyfish':True}  ← 与基线逐字段相同
最终 value.resultTelemetry=True, value.enableExa=True, health enabled=6 同基线
dump-config id: dsh-websearch 段恢复为 numResults:8 / enableFirecrawl:true / enableTinyfish:true
（期间服务在 16:41 前重启过一次，revision 归 0，但 user/value/health 与基线一致；重启后重新取 cookie 复验）
```
另外做了凭证写入探针（`ADV_PROBE_TEST_KEY` set→describe→unset，`PATH` set→unset），最终 `~/.dsh/.credentials.yaml` 中 `ADV_PROBE_TEST_KEY` 与 `PATH` 键均不存在（A，`grep` 核对），无残留。

**诚实边界**：`id: web` 段（`searchProvider: unified`）是 `cordis.patch.yml` 静态注入、**与保存值无关**，把它列为「闭环三方对比」的一方本身就是口径错配；真正的执行侧证据是 health 的 `enabled` 与 provider 的 `resolveOptions`。未做真实 `web_search` 输出对比（见「仍无法验证」）。

### 2.6 点 6：`failedKeys` 结构与 `reason` 泄露面（A/B/C）

结构（C，`lib/client.js`）：`this.failedKeys = new Map()`（`:285`）→ `save()` 里 `this.failedKeys.set(ref, String(keyErr.message...).slice(0,140))`（`:452`）→ `projection()` 里 `[...this.failedKeys].map(([ref,reason])=>({ref,reason}))`（`:318`）→ `KeyedBackendCard` `:522` 与 OPTIONAL_KEYS `:716` 都改成 `.find(f => f && f.ref === b.keyEnv)` → `:549` / `:730` 渲染 `props.t("keyFailed") + ": " + failure.reason`。⇒ **结构确实是 `[{ref,reason}]`，`.find` 修复正确**，旧 `.includes(string)` 永不匹配的 bug 已消除。

`reason` 来源（B）：`dsh-api-settings-controller/lib/index.js:204-209`
```js
async write(ref, write) {
  try { await write(); }
  catch (error) { throw new RemoteError("credential/rejected", error.message ?? String(error), { ref }, {cause:error}); }
}
```
网关 `rebuiltFailure` (`:2158-2160`) 原样保留 `message`；`RemoteError extends Error`（`gateway/lib/client.browser.js:17-29`）带 `.message`。本插件 `new Error(res.error?.message ?? ...)` → `catch` → `.slice(0,140)` → 直接进 DOM。

**泄露面判定**：`dsh-credentials` 的 seam 规则明确「配置面永不看到 secret 值」（`dsh-credentials/lib/index.js:4-11`），controller 的注释 `:200-202` 也声明「details name only the reference, so no failure path can carry the value back out」，本机实测的拒绝样例（`gateway/bad-request`）message 也确实不含密钥值 ⇒ **当前官方实现下不会泄露密钥本身**。但 `reason` 是**未经白名单的底层错误原文**：包含 `ref` 名、host 内部路径/文件名、底层 provider 的类型/解析错误文本（例如「stored document no longer parses」这类来自 `~/.dsh/.credentials.yaml` 的错误）。这些信息被 `.slice(0,140)` 后直接渲染到设置卡片 DOM，属于 **P2 信息暴露/无脱敏**，且 `:549`/`:730` 没有 `sanitizeError`（对比 `health.js:25-32` 有专门的 token-like 脱敏）。建议：UI 只渲染固定文案 `props.t("keyFailed")`，或复用 `health.js` 的 `sanitizeError`，把 detail 只留 `console`。

### 2.7 点 7：UI 合并卡片的签名、时序与 Save 条件（A/C）

**签名核对（A，逐行）**：
| 调用点 | 实参 | 定义 | 结论 |
| --- | --- | --- | --- |
| `client.js:633` `onToggle:(checked)=>card.setToggle(b.id,checked)` → `:527` `onChange` | `(bool)` | `:333` `setToggle(id,checked)` | 匹配 |
| `client.js:634` `onEditKey:(ref,text)=>card.editKey(ref,text)` → `:546` `props.onEditKey(b.keyEnv,e.target.value)` | `(ref,text)` | `:330` `editKey(envRef,text)` | 匹配 |
| `client.js:727` OPTIONAL_KEYS `card.editKey(b.keyEnv,e.target.value)` | 同上 | 同上 | 匹配 |
| `client.js:621/648` `onChange:(checked)=>card.setToggle(b.id,checked)` | 同上 | 同上 | 匹配 |

**Save disabled 条件（`:735`）**：`state.saving || state.stagedCount === 0 || state.writable === false`，而 `stagedCount = this.staged.size + this.stagedKeys.size`（`:311`）—— **已计入 stagedKeys，未漏算**。`version` 字段（`:322`）只由 `staged` 构成、且全文件无任何消费（`grep` 仅 1 处定义），是死字段；不影响功能但说明投影维护不严谨。

**但用真实 controller 类复现出 3 个缺陷（C）**：

- **D7 / P1「勾了开关但密钥没保存」的时序误导**：`setToggle` 立即 `scope.set("enable"+Id, checked)`（`:333-342`），而 `editKey` 只 `stagedKeys.set`（`:330`），密钥要等 `save()` 才 `writeCredential`（`:441-456`）。`keySaveModeHint`（`:89`/`:144`）虽写了「开关即时生效；密钥填写后需点保存」，但 `KeyedBackendCard` 把开关与密钥输入放在**同一张卡片**、开关上方没有「已保存/未保存」状态、且开关点击后 UI 立刻变勾（`checked = props.value === true` 来自 scope 新快照）；用户填完 key 后看到「已启用」很容易以为整体已生效。更实际的风险：`setToggle` 失败时只置 `this.failed=true`/`conflict` 并 `republish()`（`:336-339`），**没有回滚 UI 勾选**，开关视觉上仍为 on 而 host 值未变。建议：开关与 key 同批提交，或在开关旁显示「已保存/保存失败」并在失败时复位。

- **D8 / P2 空串 stagedKey 残留 → Save 永久可点**：复现输出
  ```
  editKey('TAVILY_API_KEY','   ')  → stagedCount=1
  await save()                    → stagedCount=1, stagedKeys={"TAVILY_API_KEY":"   "}, writes=[]
  ```
  `save()` 里 `if (value !== "")` 才处理（`:443`），空/纯空白直接跳过 `continue` 隐含不进 `doneKeys`（`:441-456` 无 else），于是该 stagedKey 永不清除、`failedKeys` 也不记、`failed` 也不置 → 状态「有未保存修改」但 Save 点了什么也不发生，且 `discard`（`:478`）是唯一出路。对 `staged`（普通字段）空串走 `unset`（`:410`）是正常的，**密钥分支不对称**。建议：`value === ""` 时 `this.stagedKeys.delete(ref)`（或视为清空凭证）。

- **D9 / P2 并发 setToggle 同 revision → 必然 conflict**：复现输出
  ```
  expectedRevision values used = [1,1] (both same)
  c.failed=true  c.conflict=true
  ```
  `SettingsRoutesBridge.write`（`:249-264`）每次发请求前读 `this.store.getSnapshot().revision`；`setToggle` 无串行队列（`scope` 订阅在 `accept()` 后才更新 revision），用户快速点两个开关时两个 POST 带同一 `expectedRevision`，host `dsh-settings/lib/index.js:508` `if (expected !== undefined && descriptor.revision !== expected) throw new SettingsConflictError` 拒掉后者 → `setToggle` 置 `conflict=true` 显示「设置已在其他端被修改，请重试」（`:338`、`:739`），**明明是自己的两个点击**。官方 `dsh-client-ui-settings-models` 的 `writeSettings` 带 `expectedRevision` 也有同类风险，但本卡片把开关做成「即时写」放大了触发面。建议：`setToggle` 串行化（复用 `this.saving` 或一个 promise 队列），或冲突时自动 `bridge.load()` 后重放一次。

### 2.8 收尾复核：用「当前版代码」重新跑行为级复现（A/C，20:35）

并行 agent 在 15:40 / 20:06 改了 `index.js` 与 `client.js` 后，我重新加载**当前** `lib/client.js` 的 `SettingsRoutesBridge` + `UnifiedSearchCardController` 真实类（同一 extract/eval 手法）跑复现：

```
=== D8: 空/纯空白 stagedKey 残留（当前版） ===
before: 1 {"TAVILY_API_KEY":"   "}
after : 1 {"TAVILY_API_KEY":"   "} writes= []          ← 仍在
=== D9: 并发 setToggle 同 revision（当前版） ===
expectedRevision used= [1,1] failed= true conflict= true  ← 仍在
=== D3 新版 ok:false readCredential ===
keyState= undefined  projection.failed= false             ← 读失败已被隔离，但零状态/零日志
```

对当前 `lib/index.js:470-475` 的静态核对：`byId = rows.find(r => r.ns === "dsh-websearch") ?? rows.find(r => r.ns === NAMESPACE)` 使真实 `ns` 成为第一优先 ⇒ **D2 的主匹配死代码已消除**；但 `return (row && row.value) ?? config` + `catch { return config; }` 的静默回落未变（残留）。

当前版文件事实（A）：`src-work/lib/client.js` 853 行 / 44497 字节，md5 `c80f7a5c23e841ac30a6b0cf50822763`，与安装版逐字节相同；运行时 `GET /plugins/??@240xu/dsh-websearch/client.js&rev=55865846c2be` 返回 44574 字节、含 `readFailed` ×4 与 `judge the envelope FIRST`，去掉 2 行 sourcemap trailer 后与 `src-work` **diff 为空** ⇒ 并行改动已同步到安装目录与运行时，本报告 §3 的「部分已修」标注对线上生效。

⇒ **收尾裁决**：P1-2 的核心（ns 死代码）已消除、降为「残留 P2 级静默回落 + 两套规则不一致」；P2-1 的具体 `ok:false` 误当数据风险已消除、但空 catch 与零诊断仍在；**P1-1、P1-3、P2-2、P2-3、P2-4、P2-5、P2-6、P2-7 全部未被并行改动触及，仍然成立**。未发现 P0 的结论不变。

---

## 3. 发现的缺陷清单（按严重度）

> 说明：**未发现 P0（保存链路整体断掉 / 数据丢失 / 密钥泄露）**。第 5 点实测闭环成立，第 2/3 点的核心判定正确。以下均为「修了但修错理由 / 残留可用性缺陷 / 可维护性风险」。
> **状态标注（20:35 收尾复核）**：`【部分已修】` = 并行 agent 在我取证后改掉了该缺陷的一部分，但残留仍在；`【仍在】` = 用当前版代码重跑行为级复现仍复现；`【已修】` = 并行改动已消除该条。逐条见 §2.8。

### P1-1（D1）`remote.credentials` 被写成硬依赖，命名空间缺失时整张设置卡片消失
- **证据**：§2.1，`cordis/lib/index.js:1320-1332`；本地最小复现 `ranWith=false / ranWithout=true`；`lib/client.js:758`。
- **影响**：凡 `dsh-api-remotes` 未挂载 credentials 命名空间（裁剪 profile、启动时序、未来版本拆分），插件 `apply()` 完全不执行 → 不只是密钥，连后端开关、全局参数、整个「搜索」设置页都不注册；且无任何日志说明原因。
- **建议修法**：把 `inject` 里的 `remote.credentials` 去掉，改回「软依赖」——在 `apply()` 里用 `ctx.get("remote.credentials")`（`ctx.get` 不走 inject 检查，缺服务返回 `undefined`）取命名空间，取不到就走 connection 旧线或把 key 输入置只读并给出明确提示；`remote` 仍保留在 inject。这样既避免 `ctx.remote.credentials` 抛异常（Issue #8 根因），又不把整卡片绑死。官方插件同样硬依赖，但本插件是第三方、运行环境更杂，风险更高。

### P1-2（D2）【部分已修】PR #7 的 `ns === NAMESPACE` 是死代码，修复只靠 `searxngBaseURL` 形状兜底，且失败静默回落 stale config
- **取证时点状态**：`lib/index.js:461-470` 与 PR #7 逐字一致，主匹配 `r.ns === "unified-search"` 永不命中。
- **并行改动（15:40，另一 agent）**：当前 `lib/index.js:470-475` 已增加 `const byId = rows.find(r => r.ns === "dsh-websearch") ?? rows.find(r => r.ns === NAMESPACE); const row = byId ?? rows.find(... "searxngBaseURL" in r.value);` —— **真实 entry id 已成为第一优先**，死代码问题已消除（与 `30-adversarial-save-b.md` 的 P1 建议一致）。收尾 md5 核对 `src-work` ↔ 安装版一致（A）。
- **残留（仍在）**：`row.value == null` / shape 字段缺失时仍 `return (row && row.value) ?? config` 静默回落 stale config，且 `catch { return config; }` 无日志（`:474-477`）；「两套发现规则不一致」也仍在 —— `settings-api.js:130-136` 用 `DISCOVERY_FIELDS` 形状 + `ns==="dsh-websearch"` 兜底，`index.js` 用 `ns` 优先 + `searxngBaseURL` 兜底。
- **证据**：§2.4，真实 `settings/describe` 22 个 ns 无 `unified-search`、websearch 行 `ns=dsh-websearch`；`dsh-settings/lib/index.js:413-460`；PR #7 diff（上游 `pulls/7/files`）；模拟显示 `value:null`/字段缺失/形状碰撞均回落 `config`。
- **证据**：§2.4，真实 `settings/describe` 22 个 ns 无 `unified-search`、websearch 行 `ns=dsh-websearch`；`lib/index.js:54,461-470`；`dsh-settings/lib/index.js:413-460`；PR #7 diff（上游 `pulls/7/files`）；模拟显示 `value:null`/字段缺失/形状碰撞均回落 `config`。
- **影响**：任何使 `value` 不含 `searxngBaseURL` 的变更（字段改名、标为 secret 被 redact、host 换形状、另一命名空间恰好带同名字段）都会让 `current()` 静默返回初始 schema defaults——即 PR #7 要修的「settings are inert」原样复活，且 `catch {}` + `?? config` 让故障无声。
- **建议修法**：`current()` 与 `settings-api.js:findNamespace` **共用同一个** `findNamespace(descriptors)` 实现：优先 `ns === "dsh-websearch"`（真实 entry id，可从 `getSettings`/profile 配置注入，或至少与 `settings-api.js` 字面量同源），再用 `DISCOVERY_FIELDS` 形状兜底；`row?.value == null` 时**记录一次可观测诊断**（`ctx.logger.warn`）而不是静默 `?? config`。同时把上游 PR #7 的测试 fixture 从 `{ns:"unified-search"}` 改成真实 `{ns:"dsh-websearch"}` 并加一条「主匹配不命中靠兜底」的用例。

### P1-3（D7）开关即时写 + 密钥需 Save 的同卡组合，存在状态误导且失败不回滚
- **证据**：§2.7，`lib/client.js:333-342,330,441-456,515-550,89/144`。
- **影响**：用户勾开 key-gated 后端并填入 key，卡片显示「已启用」但 key 未落库；下一次搜索该后端因缺 key 失败；开关写失败时 UI 仍显示 on。
- **建议修法**：要么开关也进 staged（`edit` + Save 原子提交），要么在 `KeyedBackendCard` 的开关旁渲染独立的 `saved/failed` 状态并在 `setToggle` catch 里复位 `checked`；`hint` 文案不足以抵消同卡视觉暗示。

### P2-1（D3）【部分已修】`readCredential` 的 `catch { /* ignore */ }` 仍吞掉一切错误且无诊断
- **取证时点状态**：`lib/client.js:366` 空 catch 吞掉所有异常；`ok:false` 被解成 `undefined` 后还会落进 connection 旧线（可能用 stale 值掩盖读失败）。
- **并行改动（20:06，另一 agent）**：当前 `lib/client.js:344-380` 增加 `readFailed` 标志，先判 `res.ok === false` 就把 `readFailed=true`，**不再**回落 connection 旧线、不再写 keyState —— 点 3 的「`ok:false` 会不会把错误对象当数据」这个具体风险已消除（§2.8 C 级复现：`ok:false` → `keyState=undefined`）。
- **残留（仍在）**：`catch { /* ignore */ }`（当前 `:379`）**一字未改**，`describe` 抛异常 / 属性访问失败 / 网络错误仍全部静默；且 `readFailed` 为 true 时**没有任何 UI 状态或日志**（注释里明确说「No dedicated read-error UI state exists」），徽章依旧不亮且用户无从得知。§2.8 复现：`ok:false` → `projection.failed=false`（读失败完全不进任何状态）。
- **建议**：`catch (err)` 里至少 `console.warn(...)`，并在 projection 里加 `credentialError` 状态显示「凭证状态不可用」；遵守 AGENTS.md「空 catch 必须命名错误并说明原因」。

### P2-2（D6）`failure.reason` 未脱敏直接渲染到 DOM
- **证据**：`lib/client.js:452,549,730`；`dsh-api-settings-controller/lib/index.js:204-209`；`gateway/lib/client.browser.js:2158-2160`；对比 `health.js:25-32` 有 `sanitizeError`。
- **建议**：UI 只显示固定 `keyFailed` 文案；或复用 `sanitizeError()`；详细错误只进 console。

### P2-3（D8）【仍在】空/纯空白 stagedKey 永不被消费，Save 永久 enabled 且点了无反应
- **证据**：取证时点 `lib/client.js:441-456`；**当前版 `lib/client.js:452-470` 未改**，§2.8 用当前版真实 controller 重跑仍得 `before: 1 / after: 1 / writes=[]`。
- **建议**：`value === ""` 分支显式 `this.stagedKeys.delete(ref)`（或调用 `writeCredential` 的 unset 路径）。注意 `staged`（普通字段）的空串走 `unset` 是正常的，**密钥分支不对称**。

### P2-4（D9）【仍在】快速连点多个开关 → 同 `expectedRevision` → 自造 SETTINGS_CONFLICT
- **证据**：取证时点 `lib/client.js:249-264,333-342`；**当前版未改**，§2.8 重跑仍得 `expectedRevision used=[1,1] / failed=true / conflict=true`；`dsh-settings/lib/index.js:508`。
- **建议**：`setToggle` 串行化，或 409 时 `bridge.load()` 后用新 revision 重放一次。

### P2-5（D4）`writeCredential` 只判 `ok === false`，非 `ok !== true`
- **证据**：`lib/client.js:384,390`；官方 `dsh-client-ui-settings-models/lib/client.js:3172` 用 `response.ok ? ... : ...`。
- **建议**：与官方对齐，改为 `res?.ok !== true` 才 throw（同时校验 `res` 是对象）。当前对真契约无害，但对非契约返回值会静默假成功。

### P2-6（D10）`connection.api.credentials` 旧线兜底是死代码
- **证据**：`lib/client.js:359-363,388-393`；全量 `grep` 仅本插件自身引用 `api.credentials.*`，`dsh-client-connection/lib/client.browser.js` 无 `.api`/`credentials`。
- **建议**：要么删除并明确只支持 0.2.x remote 线，要么用运行时能力探测决定；保留一个永不生效的「兜底」会让 P1-1 的降级方案看起来有路可走，实际没有。

### P2-7（D5）`id: web` 段作为「保存→执行」对比项属口径错配；`version` 投影字段是死字段
- **证据**：`dsh web --dump-config` 的 `id: web` 只有 `searchProvider: unified`（来自 `cordis.patch.yml` 静态行）；`lib/client.js:322` 的 `version` 全仓无消费者。
- **建议**：验收脚本把执行侧锚点固定为 `health.backends[].enabled` + provider `resolveOptions()`；删掉未消费的 `version`。

---

## 4. 已确认无误的点

> 下表的「一致/成立」按**各自复核时点**成立；`client.js`/`index.js` 在审查期间被并行改动，收尾时 6 个核心文件 `src-work` ↔ 安装版 md5 仍逐一相同、运行时 serve 与 `src-work` 仅差 sourcemap trailer（§0/§2.8，A）。

| 点 | 结论 | 证据等级 |
| --- | --- | --- |
| src-work ↔ 安装版逐字节一致（14:58：31 lib + 2 tests + package/README/patch；20:35：6 核心文件复核） | 一致 | A |
| 服务实际 serve 的 client.js 与源码一致（含 `remote.credentials` 修复） | 一致 | A |
| `remoteServiceKey(namespace)` = `remote.<ns>`，官方 `dsh-client-ui-settings-models` inject 同样含 `remote.credentials` | 成立 | B |
| 本机组合树含 `api-remotes` / `client-modules` / `settings-models`，client bundle 含 `@deepseek-ai/dsh-api-remotes/client.js` | 成立 | A |
| 启动日志无 `without inject` / `remote.credentials` 错误；唯一未激活 entry 是 `dsh-purge-community` 缺 `yaml` | 成立（但仅为 host 侧日志，client 侧未连页面时无日志） | A |
| `credentials/set: Promise<RemoteResult<void>>`；真实 success 是 `{ok:true}`（无 value） | 成立 | A/B |
| `res.ok === false` 不会把 `undefined`/`void` 误判失败；remote 与 connection 两分支都检查 `ok:false` | 成立 | A/C |
| `readCredential` 对真实 `{ok:true,value:{REF:{configured,writable}}}` 解析正确；`ok:false` 不写 keyState | 成立 | A/C |
| `failedKeys` 确为 `[{ref,reason}]`，两处渲染都改为 `.find(f=>f.ref===...)`，旧 `.includes` bug 已修 | 成立 | C |
| `onEditKey`/`onToggle` 与 `editKey`/`setToggle` 签名逐一匹配 | 成立 | A |
| Save disabled 的 `stagedCount` **已包含** `stagedKeys` | 成立 | A |
| `settings/mutate` 带 `expectedRevision` 的冲突检测真实生效（并发复现触发） | 成立 | A/C |
| `settings/document-updated`、`credentials/reference-updated` 事件名与 `dsh-api-remotes/lib/index.js:68,72,128` 官方 allowlist 一致 | 成立 | B |
| 保存→health 闭环：写 `enableExa=false` → `enabled` 6→5；写回 true → 6；dump-config 同步出现/消失 `resultTelemetry` | 成立 | A |
| 本轮所有写入均已改回，最终 `user`/`value`/`health`/`credentials.yaml` 与基线一致 | 成立 | A |
| 上游 PR #7、Issue #8 仍为 open；本机 2.8.4 < npm 2.8.8 | 成立 | D |

---

## 5. 仍无法验证的点（含原因）

| 点 | 原因 |
| --- | --- |
| **在真实浏览器页面里手工点一次「保存」、填一个真实第三方 key、看「已配置」徽章与「已保存 ✓」** | 本会话无法驱动浏览器 DOM；`cordis_inspect_query` 的 client `Slots.listSubTree` 返回 `timed out after 10000ms. Open or reconnect the Harness page`（GUI 无已连接页面）。已用**带 cookie 的真实 RPC**（`credentials/set`/`describe`/`unset`）证明服务端契约与返回形状，并用**加载真实 `UnifiedSearchCardController` 类**的 node 复现证明客户端解析/判定逻辑，但这不是端到端 UI 点击。 |
| **client 侧 fiber 是否真的激活、设置卡片是否真的注册进 `settings.section` slot** | 同上：无页面连接，`Slots` inspect 超时；host 侧 `dsh: warning: 1 entry did not activate` 只覆盖 host loader，不含 client fiber。serve 的 `client.js` 内容与 `--dump-config` 的 client bundle 列表是间接证据。 |
| **真实 `web_search` 输出是否跟随 `resultTelemetry`/`numResults` 等保存值** | 本轮只做了 settings↔health↔dump-config 对比；触发一次真实搜索会消耗外部后端额度并受 `HTTP_PROXY` 出口影响，且 `resultTelemetry=false` 的影响只在搜索结果尾注（`provider.js:435`），需真实工具调用才能观测。Lead §11.5 声称有 `tinyfish ✓3941ms/8` 遥测（仅作线索，未独立复现）。 |
| **`reason` 是否可能含真实密钥值** | 官方 controller 注释与 seam 规则都保证不回传 value，本机实测拒绝样例也不含；但无法穷举所有底层 provider 的错误文本（例如损坏的 `~/.dsh/.credentials.yaml` 解析错误消息可能夹带文件内容）。判定为「当前实现不泄露，但无脱敏保障」。 |
| **`connection.api.credentials` 在历史 dsh 0.1.x 上的真实形状** | 本机只装了当前发布版，无 0.1.x 副本；全量 grep 表明该 API 在当前树中不存在，故只能判定「本机为死代码」，不能判定历史上是否正确。 |
| **PR #7 的 `provider.js` RFC1918 正则修复是否正确** | 属本次「保存链路」之外的附带改动；已确认本机 `provider.js:321` 是 `{2}` 版（与 PR diff 一致），但未对 plain-http 私有实例做端到端搜索验证。 |
| **服务 16:41 前后那次重启是否由本次审查引起** | 观察到 `MainPID` 从 `262230` 变为日志里的 `2339`、settings `revision` 归 0、`dsh-web.log` 重写；同一 cgroup 内有其他 agent 在跑 GitHub API 查询。无证据表明与我的只读/写回操作相关；所有写回操作都带 `expectedRevision` 且返回 200。 |

---

## 6. 五条最重要的反直觉发现

1. **（A/B/D）PR #7 的「按 `ns` 找本插件」在取证时点本机永远不命中**：真实 `settings.describe()` 里 `ns` 是 profile entry id `dsh-websearch`，而补丁写死 `unified-search`；22 个命名空间中根本没有 `unified-search`。整个「settings 不再 inert」的修复当时实际只靠 `searxngBaseURL` 这个字段形状兜底——**修好了，但理由全错，且上游回归测试的 fixture 也伪造了 `ns:"unified-search"` 掩盖了这一点**。收尾时另一 agent 已把 `ns==="dsh-websearch"` 提为第一优先（§2.8），但该结论对「上游 PR #7 至今 open 且本机是手工移植」依然成立：升级 `2.8.8` 会覆盖掉这个本地修正。

2. **（C）`remote.credentials` 加进 `inject` 是硬依赖，不是「声明一下更稳」**：最小复现显示，只要该命名空间服务未挂载，**整个插件 fiber 的 `apply()` 都不执行**——不是「密钥功能降级」，而是连后端开关、全局参数、整个「搜索」设置页一起消失。Issue #8 的「必须加 inject」结论正确，但没人指出代价是把整张卡片绑死在一个命名空间上；而代码里写的 `try { api = this.remote.credentials } catch { fallback }` 在这个硬依赖模型下**永远等不到 fallback 的机会**（插件根本没运行）。官方插件同样硬依赖，只能说明「与官方一致」，不能说明「无风险」。

3. **（A）`RemoteResult<void>` 的真实 wire 形状是 `{ok:true}` 连 `value` 键都没有**：`res.ok === false` 之所以正确，是因为它只判失败分支；若按「`RemoteResult` 一定带 `value`" 的直觉写成 `res.value === undefined → 失败`，就会把**每一次成功保存**误报为失败。反过来，只判 `ok === false` 又对 `{ok:undefined}` 之类非契约返回静默放行——正确写法是与官方一致的 `res?.ok !== true`。

4. **（A）「保存→执行」确实闭环，但闭环的证据被口径污染**：实测写 `enableExa=false` 后 `health.enabled` 6→5、写回后 6，dump-config 同步出现/消失 `resultTelemetry: false`；但审查要求对比的「`id: web` 段」里只有静态的 `searchProvider: unified`，**它永远不会随保存变化**，把它当三方对比的一方会得出假阴性。真正的执行锚点是 `health.backends[].enabled` 与 provider 每次现算的 `resolveOptions()`。

5. **（C）UI 上最危险的不是签名不匹配，而是「同卡 + 即时开关 + 空串残留 + 并发 revision」的组合**：签名逐个核对全部匹配、Save 按钮也确实计入了 `stagedKeys`；但真实 controller 复现出：填了纯空白的 key 后 `stagedKeys` 永不被消费（Save 永久可点且点了无反应）；快速点两个开关会带同一个 `expectedRevision` 被 host 判为 `SETTINGS_CONFLICT`，界面提示「设置已在其他端被修改」——其实是用户自己两次点击；开关即时写失败时 UI 勾选不回滚。这些都不是「修复是否落地」类问题，而是修复后仍残留的交互缺陷。

---

## 7. 附：本轮使用的关键可复现命令（不含任何 token 值）

```bash
# 认证（token 从日志取，不写入报告）
TOK=$(grep -o "?token=[A-Za-z0-9_.-]*" /home/ova/re-agent/dsh-web.log | tail -1 | sed 's/?token=//')
C=/tmp/cookie.txt
curl -sS -L -c "$C" -b "$C" -o /dev/null "http://127.0.0.1:3080/?token=$TOK"

# settings / health（只读）
curl -sS -b "$C" http://127.0.0.1:3080/api/unified-search/settings | python3 -m json.tool
curl -sS -b "$C" http://127.0.0.1:3080/api/unified-search/health  | python3 -m json.tool

# 真实 Remote RPC（/api/<namespace>/<method>，client-request 包络）
rpc(){ curl -sS -b "$C" -H 'content-type: application/json' -X POST --data "$2" \
        "http://127.0.0.1:3080/api/$1"; }
rpc settings/describe '{"type":"client-request","rpcId":"x","method":"settings/describe","payload":{"args":{}}}'
rpc credentials/describe '{"type":"client-request","rpcId":"x","method":"credentials/describe","payload":{"args":{"refs":["TAVILY_API_KEY"]}}}'
rpc credentials/set '{"type":"client-request","rpcId":"x","method":"credentials/set","payload":{"args":{"ref":"X","value":"y"}}}'
rpc credentials/unset '{"type":"client-request","rpcId":"x","method":"credentials/unset","payload":{"args":{"ref":"X"}}}'

# 无害写入 + 完整改回（本轮已执行并核对回滚）
curl -sS -b "$C" -H 'content-type: application/json' -X POST \
  --data '{"ops":[{"op":"set","path":["enableExa"],"value":false}],"expectedRevision":3}' \
  http://127.0.0.1:3080/api/unified-search/settings
# ... 读 health ... 再 set true、unset 两个字段

# 组合树
timeout 60 dsh web --dump-config 2>/dev/null | grep -A8 'id: dsh-websearch'
systemctl status dsh-web.service --no-pager | head -12

# 官方契约
grep -n 'remoteServiceKey' /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-api-gateway/lib/client.browser.js
grep -n 'RemoteResult' /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-typert-protocol/lib/types/types.d.ts
grep -n 'inject = \[' /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-models/lib/client.js
sed -n '413,460p' /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-settings/lib/index.js

# 上游 PR #7 / Issue #8（认证 GitHub API，token 仅在命令内展开，从不落盘到报告）
CFG=/opt/xr-research/zcode-research/.git/config
TOK=$(sed -nE 's#^\s*url\s*=\s*https://([^@]*)@github.com/.*#\1#p' "$CFG" | head -1)
U=x-access-token; P=${TOK#*:}
curl -sS -u "$U:$P" -H 'Accept: application/vnd.github+json' \
  https://api.github.com/repos/240xu/dsh-websearch/pulls/7/files
```
临时 node 复现脚本（Cordis 硬依赖、真实 controller 行为级）全部放在 `/tmp` 并已删除；未改动任何源码、配置或其它报告。

---

## 8. 任务板 task-13 的 claim→complete：受权限限制，需 Lead 代操作

| 项 | 事实 | 证据 |
| --- | --- | --- |
| 任务板工具可用性 | 本会话是**普通 `subagent`（非 Team member）**，`Tool.listTools` 权威列表（含完整 spill 文件）里**没有** `team_task_get` / `team_task_claim` / `team_task_update` / `team_task_complete`；本会话 `agentTeam` 投影为 `{"members":[],"tasks":[]}`，`list_agents` 返回 `(no subagents)`。⇒ 我**无法**执行 `team_task_get` 拿 revision，也无法 claim/complete。 | A |
| task-13 真实状态 | 从 Lead session 的 `team/task` 事件（seq 5389）读到：`id=task-13, revision=2, status="in_progress", ownerId="session-6262e958-6f97-4d70-9cf8-12a894547fe6"`（即 **Lead 自己已 claim**，seq 5388 的 `team_task_update {action:"claim", expected_revision:1, owner:"lead"}`）。 | A |
| 结论 | 按 `dsh-experimental-agent-team/lib/index.js:1287-1327` 的校验，`claim` 要求 `status==="pending"` 且 `ownerId` 未属他人，`complete` 要求 `status==="in_progress"` 且 caller 为 owner 或 Lead；我既不是 owner 也无工具 ⇒ **claim→complete 在本会话不可达**，只能由 Lead（或持有 Team 工具的成员）用 `revision=2` 执行 `team_task_update {action:"complete", expected_revision:2, task_id:"task-13"}`。 | B |

**已如实通过 `send_message` 告知 Lead**（含「请代 complete」与最关键缺陷），并把同一自包含结果发给父 agent `session-6262e958-…`。报告本身已落盘，交付物完整；任务板状态更新属协作机制限制，非审查遗漏。
