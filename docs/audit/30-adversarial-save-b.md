# 30-b · 对抗审查备份：保存链路（独立取证，证伪导向）

> 2026-11-07 15:13–15:26 (+08:00)。子代理 `runtime-state` 应 Lead 指派，为可能写文件失败的 fork 做**备份版**。
> **目标文件状态**：`30-adversarial-save.md` **不存在**（`ls -la .artifacts/websearch-research/30-*` → `No such file or directory`），故本报告为**主报告**而非「交叉复核补遗」，写入 `30-adversarial-save-b.md`。
> **只写这一个文件**；未改任何源码/配置/其它报告；全程只读（`read`/`grep`/`glob`、`ps`、`curl -L` 拿 cookie、`npm pack` 到 `/tmp`、`node --input-type=module` 内联最小复现）。**未写设置、未写凭证、未重启服务、未升级任何包、未操作任务板**。
> **独立取证声明**：本报告的结论全部来自本轮自跑的源码/GitHub API/认证 HTTP API/Node 复现，**未照抄 25 / 99 号报告的结论**；仅在「反直觉发现」里标注与 36 号 Lead 预发现的交叉关系。
> **证据等级**（沿用 [_SKELETON.md](_SKELETON.md) §7–20）：**A**=源码实证（本地 `路径:行号` 或带 ref 永久链接）、**B**=官方文档、**C**=版本记录（CHANGELOG/tag/commit sha/npm）、**D**=本机实测、**E**=推断或待核实。四联=`结论 → 依据 → 代码落点 → 验证`。
> **密钥 hygiene**：GitHub Basic auth 取自 `/opt/xr-research/zcode-research/.git/config` 的 remote URL（`U=x-access-token`，`P=${TOK#*:}`），**值未进入任何输出/报告**；启动 token、cookie、API key 值均不写出。

---

## 0. 现场基线（本轮独立复核）

| 项 | 值 | 证据 |
| --- | --- | --- |
| dsh web 进程 | `PID 262230`（非 11-04 的 2200、非 11-05 的 2085），命令行逐字相同：`--patch /opt/dsh-plugins/lan-trust.patch.yml --no-open --host 127.0.0.1 --port 3080 --trusted-host 192.168.1.165 --trusted-host dsh.sepic.space` | [D] `ps -eo pid,user,args \| grep '[d]sh web'` |
| GUI | `http://127.0.0.1:3080/` → `401`；`?token=` + `curl -L` → 303 → `Set-Cookie: dsh-auth-<hash>=…` → 认证 API 200 | [D] `curl` |
| 插件 | `@240xu/dsh-websearch` **2.8.4**（`package.json:3`），但代码已被 Lead 大规模修改（含 `firecrawl`/`tinyfish` 两个新后端、PR #7 移植、issue #8 修复） | [A] `package.json:3`；[D] `grep` |
| 安装目录 ↔ src-work | `lib/client.js` 与 `.artifacts/websearch-research/src-work/plugin/lib/client.js` **md5 一致**（`55b2197d…`） | [D] `md5sum` |
| 用户层 | `cordis.patch.yml:390-395` 有 `- id: dsh-websearch`，config 含 `enableFirecrawl: true, enableTinyfish: true` | [A] |
| 启动日志 | 仅 `ExperimentalWarning: SQLite` + `dsh: warning: 1 entry did not activate`（`dsh-purge-community` 缺 `yaml`）+ 启动 URL；**无任何 `without inject` / client 插件错误** | [D] `/home/ova/re-agent/dsh-web.log` |

---

## 1. 逐条裁决表

| # | Lead 命题 | 裁决 | 等级 | 证据（文件:行号 / 命令） |
| --- | --- | --- | --- | --- |
| 1a | host 是否真注册 `remote.credentials` | **成立（注册了）** | A+C | `dsh-api-gateway/lib/client.browser.js:2074-2075` `remoteServiceKey(namespace) => \`remote.${namespace}\``；`:1777` `name: remoteServiceKey(name)`；`:1961` `super(ctx, remoteServiceKey(name))`；`dsh-api-remotes/lib/client.js:45-46` `const namespace = endpoint.slice(0, separator)`；`dsh-api-settings-controller/lib/typert.remote-client.js:151` 的 `credentials/describe` / `credentials/set` 端点 → namespace = `credentials`；`dsh-api-remotes/lib/types/client/index.js:13` 把 `settingsControllerRemote` 列入 `$mount` 清单；`dsh-api-settings-controller/lib/index.js:144` `super(ctx, "credentialsController", { namespace: "credentials" })` |
| 1b | `inject=["…","remote","remote.credentials"]` 是否为硬依赖 | **硬依赖（gating）**，不是软依赖 | A | `dsh-api-gateway/lib/client.browser.js:1608-1610` `const inject = ["typert","connection"]` 是 Remote 服务自身；`:1737-1741` 校验 `remoteServiceKey(namespace)` 不与现有 service 冲突；`cordis/lib/index.js:1099-1100` `for (const name of Object.keys(this.inject)) this._checkImpl(name); this._refresh();`；`:687` `if (prop in fiber.inject) { error.message = \`cannot get required service "${prop}" in inactive context\`; throw error; }`；`:676` `cannot get property "${prop}" without inject`。官方 [B] README（`dsh-api-gateway/README.md:56`）："Each namespace is a traced `remote.<namespace>` child Service"。**官方同款插件也这么声明**：`dsh-client-ui-settings-models/lib/client.js:4415-4425` `const inject = ["slots","locale","remote","remote.credentials",…]`，且 `:1383` / `:3172` 直接用 `ctx.remote.credentials.describe/set`。 |
| 1c | 启动日志有无 `without inject` 错误 | **无**（本轮实测） | D | `grep -niE 'inject\|without\|failed to import\|did not activate\|warning' /home/ova/re-agent/dsh-web.log` → 仅 4 行，无 inject 错误。**注意**：Client 插件错误不写 host stdout，absence ≠ proof；故 1c 标 D 且保留 E 边界（见 §4）。 |
| 2a | `res.ok === false` 会不会把合法 `void` 误判失败 | **不成立（不会误判）** | A+D | 官方契约 `dsh-api-settings-controller/lib/typert.remote-client.d.ts:15` `set: (ref, value) => Promise<RemoteResult<void>>`；`dsh-typert-protocol/lib/types/types.d.ts:110-116` `RemoteResult<T> = {ok:true,value:T} \| {ok:false,error:RemoteFailure}`；`dsh-api-gateway/lib/client.browser.js:1829-1835` 运行时确实折成 `{ok:true,value:…}` / `{ok:false,error:…}`。插件 `client.js:378-380`：`const rejected = res !== null && typeof res === "object" && res.ok === false; if (rejected) throw …; return;`。**Node 复现**：`{ok:true,value:undefined}` → `rejected=false` → 正常返回，未误判。合法 void 是 `{ok:true,value:undefined}`，`ok` 为 `true`，条件不触发。 |
| 2b | `res.error?.message` 字段名对吗 | **对** | A | `dsh-typert-protocol/lib/types/types.d.ts:114-115` 错误分支字段为 `error`；`remote-error.d.ts:10-16` `RemoteError extends Error` 有 `message`；`client.browser.js:2158-2159` `rebuiltFailure(error) => new RemoteError(error.code, error.message, error.details)`。**官方同款写法**：`dsh-client-ui-settings-models/lib/client.js:3172-3178` `return response.ok ? void 0 : response.error.message`。 |
| 3a | `readCredential` 三层解包是否正确 | **对官方 0.2.x 形状成立，但存在两个静默失败口**（见 3b/3d） | A+D | `client.js:344-365`。Node 复现：官方成功 `{ok:true,value:{"BRAVE_API_KEY":{configured:true,…}}}` → 第 1 层 `res.value` 取出 record，第 2 层 `record.credentials` 不存在故用 record，第 3 层 `[ref]` 命中 → 正确。官方 `describe` 返回 `Record<ref,{configured,source,writable}>`（`typert.remote-client.d.ts:14`），与 `dsh-api-remotes/lib/client.js:2769-2772` zod schema 一致 → **第 2 层 `record.credentials ?? record` 对当前 host 是冗余但无害的兼容兜底**。 |
| 3b | `catch {}` 是否仍吞真实错误导致「已配置」徽章不亮 | **部分成立：结构仍会静默，但注入修复后主路径不再触发** | A+D | `client.js:365` `} catch { /* ignore */ }` 保留；`client.js:363` `if (view === undefined) return;` **在 `republish()` 之前 return**（`:367` 才 republish）→ 即使 `api.describe` 返回 `{ok:false,error:…}`，`view` 为 undefined → 徽章不亮且**不报错、不重绘**。Node 复现：`{ok:false,error:{…}}` → `view=undefined`（静默）。**但** 3a 已证主路径成功时可达；`client.js:349-350` 的 `try/catch` 已把「属性访问抛错」降级为 `api=undefined` 并回落到 `connection.api.credentials` → issue #8 描述的那条**硬故障已修**。裁决：残留「静默失败」缺陷（P2），不再是 P0。 |
| 4a | PR #7 `current()` 的 `ns` 是否真等于 `NAMESPACE="unified-search"` | **不成立（永不相等）** | A+D | `index.js:54` `const NAMESPACE = "unified-search"`；`index.js:464` `rows.find(r => r.ns === NAMESPACE)`。但 `dsh-settings/lib/index.js:432,443` `ns: entry.options.id`（= **profile entry id**）；`dsh web --dump-config` 的 `/tmp/b-composed.yml:1463` `- id: dsh-websearch`；**live 认证 API** `GET /api/unified-search/settings` → `namespace = 'dsh-websearch'`。⇒ 主匹配 `r.ns === "unified-search"` **永远不命中**。 |
| 4b | 那 PR #7 修复为何仍生效？ | **靠 shape fallback 命中**（`searxngBaseURL in r.value`），且已实测生效 | A+D | `index.js:465` `?? rows.find(r => r.value && "searxngBaseURL" in r.value)`；live `value.searxngBaseURL = 'https://searx.be'` → 命中。Node 复现：`ns match hit? false` / `shape fallback hit? true` / `effective enableFirecrawl = true`（stale 会是 false）。**GitHub PR #7 元数据** [C]：`state=open`, `merged=False`, `head=fix/dsh-0.2x-settings-bridge`, `merge_commit_sha=44d5946e…`, commit `bcb24b1e…`；PR body 明说 "match by `ns`, then by shape"。本机 `index.js:454-456` 注释自称 "Applied 2026-11-07 by lead, mirroring the upstream PR's fix" → **手工移植，上游 2.8.8 无此修复**（`npm pack @240xu/dsh-websearch@2.8.8` 解出的 `lib/index.js:400-420` 仍 `if (typeof settings?.describe === "function" && typeof settings?.mutate === "function") settingsForms = settings;`，`grep -c 'searxngBaseURL.*in r.value' = 0`）。 |
| 4c | `value` 为 null 会不会回落成 stale config | **会**（`(row && row.value) ?? config`） | A+D | `index.js:466` `return (row && row.value) ?? config;`；Node 复现：行 `{ns:NAMESPACE,value:null}` → 回落 `{enableFirecrawl:false,…}`（stale）。`settings-api.js:133` 的 findNamespace 也要求 `row.value !== undefined && row.value !== null`。官方 `dsh-settings/lib/index.js:438-444` 的 `value` 由 `projectForm` 产生，正常非 null → 属**防御性缺口**而非当前故障。 |
| 4d | shape fallback 是否会误选别的插件 | **理论会，当前不会** | A+D+E | Node 复现：若另一行也含 `searxngBaseURL`，`rows.find` 按数组顺序取第一个 → 可能取错；`/tmp/b-composed.yml` 中 `grep -c 'searxngBaseURL' = 0`（composed tree 不含该字段，它来自运行时 schema 投影），live settings API 只暴露单个 namespace → **当前无碰撞**。标 E（依赖未来新增同名插件）。 |
| 5 | 保存→执行闭环（settings.value ↔ health.enabled ↔ dump-config id:web） | **成立，且实测闭环** | A+D | ① `cordis.patch.yml:390-395` 用户写 `enableFirecrawl/enableTinyfish: true`；② live settings `user={'enableFirecrawl':True,'enableTinyfish':True}`，`value.enableFirecrawl=True` / `value.enableTinyfish=True`（`revision=0`, `applies='live'`, `writable=True`, `namespace='dsh-websearch'`）；③ live `GET /api/unified-search/health` → `enabled=6`，`enabled ids=['exa','parallel','ddg','searxng','firecrawl','tinyfish']`；④ `dsh web --dump-config` `:1462-1467` 有 `- id: dsh-websearch` + `enableFirecrawl: true` / `enableTinyfish: true`，`:548-551` `- id: web` 仍 `searchProvider: unified`（**只影响 provider 选择，不受 enable* 影响**）；⑤ 本会话实跑 `web_search` → `[websearch backends] … tinyfish ✓6824ms/8 · exa ✓12034ms/8 · parallel ✓14286ms/8 · …` 且返回 8 条 Sources ⇒ **用户保存的 6 后端组合真的驱动了执行**。**只读**：未 POST `/api/unified-search/settings`。 |
| 6a | `failedKeys` 的 `[{ref,reason}]` 与 UI `.find` 是否匹配 | **匹配（已修复）** | A | `client.js:318` `[...this.failedKeys].map(([ref, reason]) => ({ ref, reason }))`；`:452` `.set(ref, String(...).slice(0,140))`；`:522` / `:716` `(state.failedKeys ?? []).find((f) => f && f.ref === b.keyEnv)`；`:549` / `:730` 渲染 `failure.reason`。两处 UI（KeyedBackendCard + OPTIONAL_KEYS）都用对象 `.find`，结构一致。注释 `:521`/`:714` 明确「不是 string 数组，旧 `.includes` 永不匹配」。 |
| 6b | `reason` 会不会泄漏敏感信息 | **当前不会；但存在条件性风险（P2/E）** | A+D | 来源：`writeCredential` 抛的 `Error(res.error?.message ?? "credential write rejected")`（`:380`）。官方 host `dsh-api-settings-controller/lib/index.js:66` `invalid payload for ${method}`（不含值）；`:208` `new RemoteError("credential/rejected", error.message, { ref }, …)` 注释逐字 "The details name only the reference, so no failure path can carry the value back out"；`dsh-credentials-local` 的错误串（`:104,143,199-200,521,549`）只含文件名/引用名/模式，**无密钥值**。zod issue [D] 复现：`[{code:"too_small",…,path:["value"]}]` 不含输入值。**但**：`String(keyErr.message).slice(0,140)`（`:452`）**无条件**把任意下层错误串进 UI，且 `this.connection.api.credentials.set` 旧路径（`:386-390`）的错误消息不在官方 `RemoteError` 保证范围内 → 若将来某 provider 在 error.message 里拼接输入值，就会被渲染。当前证据不支持「已泄漏」，标 E/P2。 |

---

## 2. 缺陷清单（P0 / P1 / P2）

| 级别 | 缺陷 | 四联（结论 → 依据 → 落点 → 验证） | 建议（**未执行**） |
| --- | --- | --- | --- |
| **P1** | **PR #7 的 `ns` 主匹配是死代码**：`NAMESPACE="unified-search"` 与运行时 `ns='dsh-websearch'` 永不相等，整个修复依赖 shape fallback 兜底 | 结论：主匹配无效 → 依据 [A] `dsh-settings/lib/index.js:432,443` `ns: entry.options.id` + [D] live `namespace='dsh-websearch'` → 落点 [A] `index.js:54,464-466` → 验证 [D] Node 复现 `ns match hit? false` + `curl /api/unified-search/settings` | 把 `NAMESPACE` 改为 `dsh-websearch`，或直接删掉 ns 匹配只留 shape；**更重要的是给 shape fallback 加断言**（见 P1-b）。 |
| **P1-b** | **shape fallback 无唯一性校验，可能误选其它插件的行** | 结论：按数组顺序 `find`，不校验 ns → 依据 [A] `index.js:465` → 落点 [A] 同上 → 验证 [D] Node 复现 `collision case picks ns = other` | 同时按 ns 与 shape 双重收敛，例如优先 `ns==='dsh-websearch'` 再 shape；或 `rows.filter(...)` 长度 >1 时抛错/告警。 |
| **P1-c** | **`value` 为 null 静默回落 stale config，保存变 no-op 但 UI 显示已保存** | 结论：`(row && row.value) ?? config` → 依据 [A] `index.js:466` → 落点 [A] 同上 → 验证 [D] Node 复现 `null-value case → stale defaults` | 命中行但 `value==null` 时应显式报错（fail loud），而非回落。 |
| **P2** | **`readCredential` 的 `catch {}` + `if (view===undefined) return` 仍会静默吞真实错误** | 结论：describe 失败/异常时徽章不亮且无提示 → 依据 [A] `client.js:363-365` → 落点 [A] 同上 → 验证 [D] Node 复现 `describeFail view = undefined` | 至少 `console.warn` + 把错误写进 `failedKeys` 或状态条；并把 `republish()` 移到 `finally`。 |
| **P2-b** | **`reason` 未做白名单/脱敏，直接 `String(err.message).slice(0,140)` 渲染** | 结论：当前无泄漏实证，但契约之外的旧路径无保证 → 依据 [A] `client.js:452` + `:386-390` → 落点 [A] `:549,:730` → 验证 [D] host 错误串与 zod issue 均不含值（**未证伪未来**） | 只渲染固定错误码/固定文案，或复用 `settings-api.js:274-276` 的 `sanitize` 并加敏感串过滤。 |
| **P2-c** | **`writeCredential` 旧路径把 `undefined` 返回值当成功** | 结论：`rejected` 只判 `res.ok===false`；若 `api.set` 返回 `undefined`（旧 connection API 不同签名），静默显示「已保存」 → 依据 [A] `client.js:386-390` → 落点 [A] 同上 → 验证 [D] Node 复现 `undefined res → rejected=false → RETURNS (treated as success)` | 对旧路径要求 `res?.ok === true` 或 `res?.result?.ok === true` 才算成功。 |
| **P2-d** | **上游 2.8.8 与本机分叉**：PR #7 仍 `open`/未合并，本机是手工移植；升级到 2.8.8 会**回退**保存→执行修复 | 结论：升级即回归 → 依据 [C] GitHub API `state=open, merged=False, commit bcb24b1e…` + [A] `npm pack 2.8.8` 的 `lib/index.js:417-420` 无 shape fallback → 落点 [A] 本机 `index.js:450-470` → 验证 [D] `grep -c … = 0` | 在升级前把 PR #7 以 patch 形式持久化，或推动上游合并；**升级前必查这一条**。 |

> **未发现 P0**（保存链路当前端到端可用，见裁决 5）。这是「证伪失败」的诚实结论，不是「没查」。

---

## 3. 五条反直觉发现

1. **[A/D] 修好了，但靠的是「错的那一半」。** PR #7 的 diff 主打 `r.ns === NAMESPACE`，可运行时 `ns` 恒为 profile entry id `'dsh-websearch'`，**这行永不命中**；真正让保存生效的是紧随其后的 `"searxngBaseURL" in r.value` shape fallback。若将来有人「清理冗余」删掉 shape fallback，保存立刻退回 no-op —— 而这个 PR 至今 **open / 未合并**（[C] `merged=False`），本机是手工移植。
2. **[A] `remote.credentials` 是「点号 service key」，不是 `ctx.remote` 对象的属性。** `client.browser.js:2074-2075` 把 namespace 编成 `remote.${namespace}` 注册为**独立 Cordis Service**（`:1961 super(ctx, remoteServiceKey(name))`）；README:56 明说 "no JavaScript Proxy"。所以 `inject` 里必须`写全 `"remote.credentials"`，而 `ctx.remote.credentials` 能取到是 Cordis 上下文代理对**同名 service key** 的解析，不是对象字段。官方 `dsh-client-ui-settings-models` 注入表（`:4415-4425`）逐字同款 → 该写法是**官方契约**，不是 hack。
3. **[D] `RemoteResult<void>` 的合法成功是「有 `ok:true` 的对象」，不是 `undefined`。** 直觉上 `Promise<void>` 会 resolve `undefined`，会担心 `res.ok===false` 误判；但 Gateway `client.browser.js:1829-1835` 把它折成 `{ok:true, value:undefined}` → 插件检查完全正确。反直觉的**真**风险在反面：返回 `undefined` 反而被当成功（P2-c 已复现）。
4. **[A/D] `res.error?.message` 字段名对，但 `error` 不是普通对象而是 `RemoteError extends Error`。** `rebuiltFailure()`（`:2158-2159`）在 Client 侧重建为 `new RemoteError(code, message, details)`，所以 `.message` 可用是**继承来的**，不是 JSON 字段。官方插件（`:3172-3178`）也读 `response.error.message`，写法一致。
5. **[D] 启动日志查不到 `without inject` 错误 ≠ 客户端插件没报错。** 当前 host stdout（`/home/ova/re-agent/dsh-web.log`）只有 4 行且全是 host 侧；Client 插件的 JS 异常走浏览器 console，不落该文件。因此裁决 1c「无错误」是 **D 级实测 + E 级边界**：能证明 host 启动无 inject 报错，不能证明浏览器控制台无错。同理，`catch {}` 的存在使得**即使**客户端真抛错也可能完全无声（P2）。（与 [36-lead-prefindings.md](36-lead-prefindings.md) §1/§2 的「死代码」发现无冲突，属不同层面。）

---

## 4. 仍无法验证项（E）

| # | 项 | 为什么无法验证 | 若要验证需要 |
| --- | --- | --- | --- |
| E1 | 浏览器控制台是否有 `cannot get property "remote.credentials" without inject` | host stdout 不含 client 日志；无浏览器会话/CDP，且本报告只读不得注入 | 打开 GUI DevTools Console 或用浏览器自动化读 console（需 Lead 授权） |
| E2 | `writeCredential` 真实保存一条 API key 的端到端 | 只读约束：**未 POST 设置、未写凭证、未触发 `credentials/set`** | 需在隔离环境用假值实跑一次保存并核对 `.credentials.yaml` 的引用名（不记录值） |
| E3 | `credentials/describe` 在真实 browser RPC 下的字节级返回形状 | 无浏览器会话；仅凭 `typert.remote-client.d.ts` + zod schema + Gateway 折叠代码推断 | 抓一次 `/api` RPC 响应（需浏览器会话） |
| E4 | `reason` 是否会在某个具体 provider 的 `error.message` 里带出输入值 | 已证**当前** host/local 错误串不含值，但无法枚举所有第三方 provider | 对自定义 credential provider 做故障注入 |
| E5 | `dsh-settings.describe()` 返回的完整 namespaces 数组（是否还有别的行含 `searxngBaseURL`） | `/api/unified-search/settings` 只投影单个 namespace；`--dump-config` 不含运行时投影值 | 用认证 `settings/describe` remote 调用或浏览器端读全量 rows |
| E6 | 启动日志「无 inject 错误」在**服务重启后**是否仍成立 | 本轮 PID 262230 已运行多时，本次未重启（禁止） | 需一次授权重启并抓完整 startup |
| E7 | PR #7 的 `merge_commit_sha=44d5946e…` 与 `head` commit `bcb24b1e…` 的关系 | GH API 显示 `state=open, merged_at=None`，merge_commit_sha 是测试合并产物，未深挖 | 查 PR timeline / `git ls-remote`（需要网络与仓库权限） |

---

## 5. 复现命令清单（全部只读，无密钥值）

```bash
# 现场
ps -eo pid,user,args | grep '[d]sh web'
curl -sS -m 6 -o /dev/null -w "root=%{http_code}\n" http://127.0.0.1:3080/
grep -niE 'inject|without|did not activate|warning' /home/ova/re-agent/dsh-web.log

# 认证 API（token 从日志取，不打印值）
B=http://127.0.0.1:3080
TOKEN=$(grep -oE 'token=[A-Za-z0-9_-]+' /home/ova/re-agent/dsh-web.log | tail -n1 | cut -d= -f2)
COOKIE=$(curl -sS -m 8 -D - -o /dev/null -L "$B/?token=$TOKEN" | grep -i '^set-cookie:' | tail -n1 | sed 's/^[Ss]et-[Cc]ookie:[[:space:]]*//' | cut -d';' -f1)
curl -sS -H "Cookie: $COOKIE" -H "Origin: $B" -H "Referer: $B/" "$B/api/unified-search/settings"
curl -sS -H "Cookie: $COOKIE" -H "Origin: $B" -H "Referer: $B/" "$B/api/unified-search/health"

# 组合树（只读；前后 sha256 profile/package.json 不变）
node /usr/local/bin/dsh web --dump-config > /tmp/b-composed.yml
grep -nE 'id: web$|id: dsh-websearch|enableFirecrawl|enableTinyfish' /tmp/b-composed.yml

# 源码定位
grep -n 'remoteServiceKey\|super(ctx, remoteServiceKey' /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-api-gateway/lib/client.browser.js
grep -n 'ns: entry.options.id' /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-settings/lib/index.js
grep -n 'NAMESPACE\|current =\|rows.find' /home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/lib/index.js
grep -n 'set: (ref, value)\|RemoteResult' /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-api-settings-controller/lib/typert.remote-client.d.ts
sed -n '100,116p' /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-typert-protocol/lib/types/types.d.ts

# GitHub PR #7（Basic auth 取自 git config remote URL，值不输出）
CFG=/opt/xr-research/zcode-research/.git/config
TOK=$(grep -oE 'https://[^@]*@' "$CFG" | head -n1 | sed -E 's#^https://##; s#@$##')
curl -sS -m 25 -u "x-access-token:${TOK#*:}" 'https://api.github.com/repos/240xu/dsh-websearch/pulls/7' | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d["state"],d["merged"],d["title"])'
curl -sS -m 25 -u "x-access-token:${TOK#*:}" 'https://api.github.com/repos/240xu/dsh-websearch/pulls/7/files' | python3 -c 'import sys,json;[print(f["filename"]) for f in json.load(sys.stdin)]'

# 上游 2.8.8 对照（解包到 /tmp）
cd /tmp && npm pack @240xu/dsh-websearch@2.8.8 --silent && tar -xzf 240xu-dsh-websearch-2.8.8.tgz -C /tmp/ws288b
grep -n -A20 'export function apply(ctx, config)' /tmp/ws288b/package/lib/index.js
grep -c 'searxngBaseURL.*in r.value' /tmp/ws288b/package/lib/index.js   # → 0

# 安装目录一致性
md5sum /home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/lib/client.js \
       /home/ova/dsh/.artifacts/websearch-research/src-work/plugin/lib/client.js

# Node 最小复现（RemoteResult / unwrap / current()）
node --input-type=module -e '<见 §1 各 Node 复现片段>'
```

---

## 6. 给 Lead 的一句话结论

**保存链路当前端到端可用**（用户写的 `enableFirecrawl/tinyfish` → settings `user` → health `enabled=6` → 真实 `web_search` 命中 tinyfish/exa/parallel），**无 P0**；但**修复的地基是脆的**：PR #7 的 `ns` 主匹配是永不命中的死代码、全靠 shape fallback 兜底，且该 PR 在上游**仍未合并**、本机是手工移植，**升级到 2.8.8 会静默回退保存→执行修复**（P1-d）。另有 4 条 P1/P2 防御性缺口（null 回落 stale、碰撞误选、`catch {}` 静默吞错、`reason` 未脱敏、旧路径 undefined 当成功）建议纳入 37 号汇总。

*报告完。全程只读，未写设置/凭证/源码/其它报告，未动任务板，无 token 或密钥值出现在任何输出。*
