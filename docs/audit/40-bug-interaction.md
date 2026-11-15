# 40 · Bug 组 A（保存交互缺陷）— 4 条真实缺陷取证与最小修法

> 2026-11-07 21:29–22:55 (+08:00)，子代理 `runtime-state`（Bug 组 A / task-19）。
> **唯一写文件**：本文件。未改任何源码/配置/其它报告，未改运行时，未操作任务板。全程只读源码 + `/tmp` 内存变换 + `node --test` 只读跑测。
> **取证对象**：`/home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/lib/client.js`（**853 行**，mtime `Nov 7 20:08`，md5 `c80f7a5c23e841ac30a6b0cf50822763`），与 `.artifacts/websearch-research/src-work/plugin/lib/client.js` **md5 逐字节一致** → 报告行号对两份均有效。
> **基线**：`.baseline-20261107-2116/`。现有测试 `src-work/plugin/tests/*.test.js`（`lead-20261106` 11 条 + `lead-20261107-p0` 4 条 + `lead-20261107` 3 条 = **18 条**），`node --test tests/*.test.js` 实测 **18/18 pass**（见 §6）。
> **等级**（全队规范）：A=源码实证（路径:行号）、B=官方文档、C=版本记录、D=本机实测（可复现命令/输出）、E=推断或待核实。四联=`结论 → 依据 → 代码落点 → 验证`。
> **重要**：所有 diff 片段均为**可直接 apply 的建议**，本子代理**未 apply**；已在 `/tmp` 内存副本上做过锚点存在性与行为验证（§6、§补遗）。**不改状态模型**（不新增 store、不改 Map/Set 语义、不改 snapshot 结构）。

---

## 0. 结论速览

| # | 缺陷 | 优先级 | 裁决 | 一句话影响 |
| --- | --- | --- | --- | --- |
| 1 | 空白 stagedKey 永不消费 | **P1** | 成立（D 级行为复现） | 输入空格/清空后 Save 按钮永久可点、点了无任何反应、无提示 |
| 2 | 并发 setToggle 同 expectedRevision 自造冲突 | **P1** | 成立（D 级行为复现） | 连点两个开关，第 2 个被 409 吞掉，UI 报「设置已在其他端被修改」 |
| 3 | setToggle 失败不回滚 / 不重读，勾选与 host 不一致 | **P1** | 成立（D 级行为复现） | host 已落地但响应失败时，UI 显示未勾选（stale），且无任何自动纠正 |
| 4 | `failure.reason` 未脱敏直接渲染 | **P2** | 成立（D 级行为复现） | host/zod 错误串含内部路径与引用名，原样显示给用户 |

**外加一条 Lead 点名线索**：`setToggle` 的 `catch` 未记录异常（详见 §5），与缺陷 2/3 同源，建议合并修。

---

## 1. 缺陷 1：空白 stagedKey 永不消费

### 现状（A）
- `client.js:330` — `editKey(envRef, text) { this.savedAt = 0; this.stagedKeys.set(envRef, { text }); this.republish(); }`：**无条件**写入 map，即使 `text` 为 `""` 或全空格。
- `client.js:311` — `stagedCount: this.staged.size + this.stagedKeys.size`：把空白条目计入「未保存修改数」。
- `client.js:748` — Save 按钮 `disabled: state.saving || state.stagedCount === 0 || state.writable === false`：空白条目使按钮**保持可点**。
- `client.js:454-469` — `save()` 的 key 循环：`const value = staged.text.trim(); if (value !== "") { …writeCredential… doneKeys.push(ref) }`；空白时**既不写、也不 push 到 doneKeys、也不 delete**。
- `client.js:470-471` — 只删 `doneFields` / `doneKeys`；`client.js:472` — `if (!this.failed && (doneFields.length > 0 || doneKeys.length > 0)) this.savedAt = Date.now();`，空白场景两者皆空 → 不显示「已保存」。
- `client.js:491` — 唯一清空途径是 `discard()`（用户手动点「放弃修改」）。

### 影响
用户输入一个 key 后全选删除（或只敲空格），`stagedKeys` 残留一条 `{text:"   "}` → `stagedCount=1` → Save 常亮；点 Save 走完整流程但**零写入、零反馈、零清理**；重复点 N 次依旧。用户会认为「保存坏了」。空格不是合法的 key 值（`save()` 自己 `.trim()` 判空），所以这条 stage 从产生起就是死状态。

### 复现命令（D，已实跑）
```bash
node /tmp/repro-40b.cjs     # 内存 harness，见 §6；不碰磁盘源码
```
实跑输出（逐字）：
```
D1 before save: stagedCount = 1 stagedKeys = {"BRAVE_API_KEY":"   "}
D1 after  save: stagedCount = 1 stagedKeys = {"BRAVE_API_KEY":"   "} savedAt = 0
D1 Save button still enabled? true | empty entry retained? true
D1 after 3 saves: stagedCount = 1 (never drains)
```
Harness 做法（A+D）：用 `new Function` 加载 bundled `client.js`，把 `return module.exports;` 替换为 `exports.__Test = { SettingsRoutesBridge, UnifiedSearchCardController, createStore, BACKENDS }; return module.exports;`，stub `react`/`react/jsx-runtime`/`window.__ModuleLoader__`，即可实例化真实的 `UnifiedSearchCardController` 并用 fake `globalThis.fetch` 模拟 host（见 `/tmp/repro-40.cjs`）。

### 最小修法（可直接 apply，**未 apply**）
两处，双保险：入口不产生空 stage，`save()` 兜底清理历史残留。

```diff
--- a/lib/client.js
+++ b/lib/client.js
@@ -330,1 +330,1 @@
-			editKey(envRef, text) { this.savedAt = 0; this.stagedKeys.set(envRef, { text }); this.republish(); }
+			editKey(envRef, text) { this.savedAt = 0; if (String(text).trim() === "") this.stagedKeys.delete(envRef); else this.stagedKeys.set(envRef, { text }); this.republish(); }
@@ -468,1 +468,4 @@
 						}
+						else {
+							// A blank draft is not a save: consume it so the button drains.
+							doneKeys.push(ref);
+						}
 					}
```
> 锚点说明：第 2 处 `}` 是 `client.js:468` 的 `if (value !== "")` 收尾括号，紧邻其后的 `:469` 是 key 循环收尾 `}`。apply 时以 `:454-469` 整块为准，避免括号错位。
> **不改状态模型**：仍是同一 `Map<envRef, {text}>`，`doneKeys` 仍是 `string[]`，无新增 store 字段。`editKey("")` 现在等价于「撤销该 key 的草稿」，与 `save()` 里 `staged.clear` 对字段的语义对称（`:423`）。

### 回归断言（新增测试）
1. `editKey(ref, "")` / `editKey(ref, "   ")` 后 `controller.projection().stagedCount === 0`，且 `controller.stagedKeys.has(ref) === false`。
2. 预置 `controller.stagedKeys.set(ref, {text:"  "})`（模拟旧版本残留）→ `await save()` → `stagedKeys.has(ref) === false`、`stagedCount === 0`、`failed === false`、`savedAt > 0`。
3. Save 按钮条件：`stagedCount === 0` → `disabled === true`（source-level 或 harness projection）。
4. 反向：`editKey(ref, "abc")` 后 `stagedCount === 1`，`stagedKeys[ref] === "abc"`（确保没有误删合法输入）。

---

## 2. 缺陷 2：并发 setToggle 同 expectedRevision 自造 SETTINGS_CONFLICT

### 现状（A）
- `client.js:333-342` — `setToggle()` **即时写**（无 stage、无串行化），`await this.scope.set("enable"+…, checked)`。
- `client.js:266` — `set(field, value) { return this.write([...]); }`。
- `client.js:249-250` — `SettingsRoutesBridge.write(ops)` 在**发起请求时**读 `const expectedRevision = this.store.getSnapshot().revision;`。
- `client.js:256` — 把 `expectedRevision` 放进 POST body。
- `client.js:263` — 成功后 `this.accept(payload)` 才更新本地 `revision`。
- host 侧 `settings-api.js:183-190`：`await settings.mutate(view.ns, ops, expected)` → 冲突返回 `409 {code:"SETTINGS_CONFLICT"}`；`dsh-settings/lib/index.js:508-510` `if (expected !== void 0 && descriptor.revision !== expected) throw new SettingsConflictError(...)`。
- `client.js:259` — bridge 见 409 抛 `new Error("SETTINGS_CONFLICT")`；`client.js:338` — `setToggle` 置 `this.conflict = true`，UI `:752` 显示「设置已在其他端被修改，请重试」。

⇒ 两个开关几乎同时点击时，两个 `write()` 都读到 `revision=0`；第一个落地后 host `revision=1`；第二个带着 `expectedRevision=0` 到达 → **必然 409**。冲突是客户端自己造成的，不是「其他端」。

### 复现命令（D，已实跑）
```bash
node /tmp/repro-40b.cjs
```
实跑输出（逐字）：
```
D2 initial revision = 0
D2 concurrent requests in flight = 2
D2 host value = {"exa":true,"ddg":false} rev = 1
D2 UI value  = {"exa":true,"ddg":false}
D2 conflict flag = true failed = true => self-inflicted SETTINGS_CONFLICT? true
```
（fake host 模拟：两个 POST 同时挂起，各自读 `expectedRevision=0`；第一个落地 `rev=1`，第二个收到 409。`ddg` 的写入**丢失**，UI 却提示「其他端修改」。）

### 最小修法（可直接 apply，**未 apply**）
在 `SettingsRoutesBridge` 内把写操作**串行化**，让后一个 `write()` 在前一个 `accept(payload)` 之后才读 revision。注意 **不能用 Promise 队列把 `expectedRevision` 提前快照**——必须在队列轮到时才读。

```diff
--- a/lib/client.js
+++ b/lib/client.js
@@ -215,1 +215,2 @@
 				mode: "routes",
 			});
+			this.writeQueue = Promise.resolve();
 		}
@@ -249,2 +250,9 @@
-		async write(ops) {
-			const expectedRevision = this.store.getSnapshot().revision;
+		write(ops) {
+			const run = () => this.writeNow(ops);
+			const result = this.writeQueue.then(run, run);
+			this.writeQueue = result.then(() => undefined, () => undefined);
+			return result;
+		}
+
+		async writeNow(ops) {
+			const expectedRevision = this.store.getSnapshot().revision;
```
> **不改状态模型**：`store` 仍只由 `accept()` 写入；`writeQueue` 是纯调度字段（Promise），不进 snapshot、不参与 `projection()`。`write()` 仍返回 Promise，`set`/`unset`（`:266-267`）与 `save()` 的 `await this.scope.set(...)` 全部无需改动。`setToggle`、字段保存、密钥保存共用同一条队列，顺带消除 `save()` 内多字段并发写（`:421-453` 是 `for…of await`，本身已串行）。
> 副作用（正向）：并发 toggle 从「第 2 个 409 丢失」变成「两个依次落地」，UI 不再误报冲突。若产品希望保留「最后写入者胜」而非串行，可改为「失败后重读 revision 并重试一次」，但那要改 `write()` 的返回语义，**不推荐**（超出最小修法）。

### 回归断言（新增测试）
1. 并发 `Promise.all([setToggle('exa',true), setToggle('ddg',true)])`（fake fetch 同时挂起再一起放行）→ host 两个值均为 `true`，`controller.projection().conflict === false`、`failed === false`。
2. 断言第 2 个 POST 的 `body.expectedRevision === 1`（或 `=== host.rev` 于其发出时刻），第 1 个 `=== 0` → 证明 revision 在队列轮到时才读。
3. 串行场景不回归：单独 `setToggle` 仍使 `scope.getSnapshot().revision` 递增 1。
4. 真冲突不回归：fake host 强制外部改 rev 后返回 409 → `setToggle` 仍置 `conflict === true`（未把真冲突吞掉）。

---

## 3. 缺陷 3：setToggle 失败不回滚 / 不重读，勾选与 host 不一致

### 现状（A）
- `client.js:303-309` — `projection()` 的 `value: snap.value ?? {}` **完全来自 `scope.getSnapshot()`**。
- `client.js:631/644/658` — 三个 toggle 的 `checked = props.value === true`，即 `state.value[toggleField(id)]`。
- `client.js:333-342` — `setToggle` 的 `catch` 只置 `failed` / `conflict`，**不回滚、不重读**；`client.js:341` `this.republish()` 仍用旧的 `scope` snapshot。
- `SettingsRoutesBridge.write()`（`:260-264`）：**只在 `response.ok && payload.ok===true` 时** `accept(payload)`；任何失败（409、400、503、JSON 解析失败、网络异常）都不更新 snapshot。
- host 已落地但响应失败是**真实可达**的：`settings-api.js:184-195` 先 `await settings.mutate(...)`（写已提交），再 `describe(deps)` 生成响应；若 `describe` 抛错、`sendJson` 失败、或响应在网路上丢失，客户端就停在旧 revision/旧 value。

⇒ 勾选框在**写失败时保持旧值**（不是「显示已勾选」而是「显示未勾选」），但 host 可能已经落地 → **UI 与服务端分叉且永远不自动纠正**（无 polling，只有 `settings/document-updated` 事件在 `load()` 成功时才会刷新）。无论方向如何，根因都是「失败后 snapshot 未重同步」。

### 复现命令（D，已实跑）
```bash
node /tmp/repro-40c.cjs
```
实跑输出（逐字）：
```
=== mode ok ===
  host.enableExa = true | UI.enableExa = true | host rev = 1 | UI rev = 1
  MISMATCH (host true, UI not true)? false
=== mode throw-after-land ===
  host.enableExa = true | UI.enableExa = false | host rev = 1 | UI rev = 0
  failed = true conflict = false
  MISMATCH (host true, UI not true)? true
```
（fake host：`mutate` 成功落地 `enableExa=true` 且 `rev=1`，但返回 `{ok:false}` 模拟 post-commit 响应失败。`SettingsRoutesBridge.accept()` 因 `payload.ok !== true` 走 `:222-226` 的只读分支，snapshot 停在 `rev=0`。）

### 最小修法（可直接 apply，**未 apply**）
失败后**重新读取 host 真值**（`scope.load()` 已存在，`client.js:239-247`，且失败时 `accept(undefined)` 会保守地把卡片设为只读而不会误报成功）。这比「本地回滚 checked」更正确：我们无法知道 host 到底有没有落地，重读是唯一诚实的做法。

```diff
--- a/lib/client.js
+++ b/lib/client.js
@@ -336,3 +336,8 @@
 			} catch (err) {
 				this.failed = true;
 				this.conflict = String(err).includes("SETTINGS_CONFLICT");
+				// The snapshot still holds the pre-write value; resync with the host
+				// so a landed-but-failed-response write is not shown as stale.
+				if (typeof this.scope.load === "function") {
+					try { await this.scope.load(); } catch { /* keep last known value */ }
+				}
 			}
-			
 			this.republish();
```
> **不改状态模型**：不新增 `pending`/`optimistic` store，不本地改 `snap.value`；复用既有 `load()`（GET `/api/unified-search/settings`）。`projection()` 结构不变。
> **与缺陷 2 的关系**：串行化后并发自造冲突消失，但**真实**冲突（别的客户端/标签页写入）仍会走这个 catch → 重读后 UI 显示对方的真值，比现在「停在旧值 + 报冲突」更准确。
> **注意**：若 `load()` 也失败，`accept(undefined)` 会把卡片置为只读（`:222-226`），这是保守且可见的状态，不会静默显示错误的勾选。

### 回归断言（新增测试）
1. host 落地但响应失败 → `setToggle` 后 `controller.projection().value.enableExa === true`（与 host 一致），`failed === true`。
2. host 未落地且响应失败 → 重读后 `value.enableExa === false`，无假阳性。
3. 成功路径不回归：`ok` 响应后 `value.enableExa === true` 且 `failed === false`（现有 harness 已覆盖）。
4. 断言失败路径**调用过** `scope.load`（spy），成功路径不调用（避免多余 GET）。
5. 状态模型不变：`projection()` 的 key 集合与修改前一致（无新增字段）。

---

## 4. 缺陷 4：`failure.reason` 未脱敏直接渲染

### 现状（A）
- `client.js:465` — `this.failedKeys.set(ref, String(keyErr && keyErr.message ? keyErr.message : keyErr).slice(0, 140));`：**原样**取 `error.message`，仅截 140 字符。
- `client.js:318` — `failedKeys: [...this.failedKeys].map(([ref, reason]) => ({ ref, reason }))`。
- `client.js:562` 与 `client.js:743` — 两处 UI：`props.t("keyFailed") + (failure.reason ? ": " + failure.reason : "")`，**直接字符串拼接渲染**。
- 错误来源 `client.js:398/404` 的 `res.error?.message`：官方 host `dsh-api-settings-controller/lib/index.js:208` 是 `new RemoteError("credential/rejected", error.message, {ref}, …)`，其中 `error.message` 来自下层 credential provider；`dsh-credentials-local/lib/index.js:104,143,199-200,521` 的错误串**含文件名**（如 `<…>/.credentials.yaml: invalid document at <path>`）与引用名。截断到 140 字符**不构成脱敏**。

### 影响与边界
- **当前无证据表明真实密钥值会进入 message**（`dsh-api-settings-controller/lib/index.js:66` 的 `invalid payload for credentials.set` 不含值；zod issue 实测只有 `path`/`code`；`credentials-local` 错误串不含值）→ 这是 **P2 信息泄露（内部路径 / 引用名 / 部署布局）**，不是 P0 密钥泄露。
- 但 UI 无白名单，任何未来 provider 把输入拼进 `error.message` 都会原样显示。属于「防御性缺口」，标 **E** 于「未来风险」部分。

### 复现命令（D，已实跑）
```bash
node /tmp/repro-40c.cjs
```
实跑输出（逐字）：
```
=== D4 reason ===
  failedKeys = [{"ref":"BRAVE_API_KEY","reason":"/home/dsh/.dsh/.credentials.yaml: invalid document at line 9 (ref BRAVE_API_KEY)"}]
  reason contains internal path? true
```
（构造 `writeCredential` 抛带路径的 Error，走真实 `save()` 的 catch，读 `projection().failedKeys[0].reason`。）

### 最小修法（可直接 apply，**未 apply**）
只保留**稳定的错误码**，码不存在或形状不合则用固定文案；UI 不动（仍是 `failure.reason`）。

```diff
--- a/lib/client.js
+++ b/lib/client.js
@@ -274,1 +274,7 @@
-		class UnifiedSearchCardController {
+		/** Failures originate outside the card; never surface their message verbatim. */
+		function safeFailureReason(err) {
+			const code = err && typeof err === "object" && typeof err.code === "string" ? err.code : "";
+			return /^[a-z][a-z0-9/_-]{0,60}$/i.test(code) ? code : "write rejected";
+		}
+
+		class UnifiedSearchCardController {
@@ -465,1 +471,1 @@
-							this.failedKeys.set(ref, String(keyErr && keyErr.message ? keyErr.message : keyErr).slice(0, 140));
+							this.failedKeys.set(ref, safeFailureReason(keyErr));
```
> **不改状态模型**：`failedKeys` 仍是 `Map<ref, string>`，`projection()` 仍输出 `[{ref, reason}]`，两处 `.find((f) => f && f.ref === b.keyEnv)`（`:535`/`:729`）与 `:562`/`:743` 渲染**完全不用改** → 现有测试 `lead-20261106.test.js:161-162` 的 `finds === 2` 断言不受影响。
> **白名单理由**：`RemoteError` 官方契约有稳定 `code`（`dsh-typert-protocol/lib/types/remote-error.d.ts:10-16`：`readonly code: Code`），如 `credential/rejected`、`gateway/bad-request`。正则把码限制为「字母开头 + 字母数字/`/`/`_`/`-`，≤61 字符」，挡掉路径、空格、括号、URL、换行。无 code 时用固定 `write rejected`，用户仍看到 `keyFailed: write rejected` 的可诊断提示。
> **可选增强（非最小）**：把 `writeCredential` 抛出的 `Error` 改成带 `code` 的对象（`{code: res.error?.code ?? "credential/rejected"}`），可让 UI 显示具体码而非固定文案；但这会动 `writeCredential` 的抛错形状，**超出本次最小修法范围**，列为 P2 建议。

### 回归断言（新增测试）
1. `writeCredential` 抛 `Error("/home/.../.credentials.yaml: … BRAVE_API_KEY")` → `failedKeys[0].reason` **不含** `/home/`、`.credentials.yaml`、`BRAVE_API_KEY`，且等于 `"write rejected"`。
2. 抛带合法 `code="credential/rejected"` 的 Error → `reason === "credential/rejected"`。
3. 抛带恶意 `code="../etc/passwd"`（含 `.`/`/` 但开头非字母）→ 回落 `"write rejected"`。
4. source-level：两处 `failure.reason` 渲染仍在，`failedKeys` 结构仍为 `[{ref,reason}]`（保 `lead-20261106.test.js:161-162`）。

---

## 5. Lead 点名线索：`setToggle` 的 catch 吞异常（**务必纳入**）

`client.js:336-339` 的 catch：
```js
} catch (err) {
    this.failed = true;
    this.conflict = String(err).includes("SETTINGS_CONFLICT");
}
```
**没有任何日志记录、没有 `console.warn`、没有把 err 写入任何可见状态**。后果：
- 缺陷 2 的自造冲突只表现为一个黄色「设置已在其他端被修改」文案，**排障时无从区分**「真并发」vs「客户端 revision 竞争」vs「host 400」vs「网络异常」；`String(err)` 只对含 `SETTINGS_CONFLICT` 的字符串敏感，`settings request failed (400)` 之类会静默变成 `failed=true, conflict=false` 且无细节。
- 与缺陷 3 叠加：失败后既不重读也不记录，UI 与 host 分叉**完全静默**。
- 与 `readCredential` 的 `catch { /* ignore */ }`（`:379`）同属「静默吞错」家族，但 `readCredential` 至少在 `:380` 有 `republish()`；`setToggle` 的 `:341` republish 用的是旧 snapshot。

**最小修法**（合并进缺陷 3 的同一个 catch，不新增状态字段）：
```diff
 			} catch (err) {
 				this.failed = true;
 				this.conflict = String(err).includes("SETTINGS_CONFLICT");
+				// Fixed diagnostic only: never log the raw error (may carry secrets).
+				console.warn("[dsh-websearch] toggle write failed", { conflict: this.conflict });
 				if (typeof this.scope.load === "function") {
```
> 只输出布尔 `conflict`，不输出 `err.message`（避免与缺陷 4 冲突）。**不改状态模型**。

**回归断言**：失败路径 spy `console.warn` 被调用且参数不含 `err.message` / 不含引用名。

---

## 6. 验证：现有 18 测试基线 + 内存副本验证

```bash
cd /home/ova/dsh/.artifacts/websearch-research/src-work/plugin
node --test tests/*.test.js
```
实跑（逐字尾部）：
```
1..18
# tests 18
# suites 0
# pass 18
# fail 0
# duration_ms 426.448472
EXIT=0
```

**现有测试对 `client.js` 是「源码级正则断言」**（`lead-20261106.test.js:119-211`），因此任何 diff **必须保留以下锚点**（已在内存副本上逐条检查通过）：
- `const inject = ["slots", "locale", "connection", "remote", "remote.credentials"];`（`:185`）
- 两处 `try { api = this.remote === undefined ? undefined : this.remote.credentials; } catch { api = undefined; }`（`:190-191`，guards 计数 = 2）
- `res.ok === false` 与 `throw new Error(res.error?.message ?? "credential write rejected")`（`:195-196`）
- `let readFailed = false;` / `if (res !== null && typeof res === "object" && res.ok === false) { readFailed = true;` / `if (!readFailed && view …`（`:207-210`）
- `onEditKey: (ref, text) => card.editKey(ref, text)`（`:154`）
- `(state.failedKeys ?? []).find((f) => f && f.ref === b.keyEnv)` **恰好 2 处**（`:161-162`）；不含 `state.failedKeys.includes(b.keyEnv)`（`:159`）
- `metered: true, label: "Firecrawl"` / `"TinyFish"`（`:123-124`）、`keySaveModeHint` 双语 + 2 次 `t()`（`:165-167`）

**本报告 4 条 diff 全部落在上述锚点之外**（`editKey` 行、`:468` 循环尾、`SettingsRoutesBridge` 构造器与 `write` 签名、`setToggle` catch、`:465` 的 `failedKeys.set`、新增 `safeFailureReason` 函数），因此 **18 条现有测试不受影响**。内存验证脚本 `/tmp/verify-40.cjs` 已对 4 条 diff 执行锚点替换成功并逐条断言上述正则仍匹配（详见 §补遗，落盘后追加）。

---

## 7. 回归测试建议汇总（应加的断言，共 14 条）

新建 `src-work/plugin/tests/bug-interaction-20261107.test.js`（**建议，未创建**），沿用现有 harness 风格（`node:test` + `assert/strict` + 源码级正则 + 内存 factory 行为测试）：

| # | 断言 | 对应缺陷 |
| --- | --- | --- |
| 1 | `editKey(ref,"")`/`"   "` → `stagedCount===0` 且 map 无该 ref | 1 |
| 2 | 预置空白 stage → `save()` 后清空、`savedAt>0`、`failed===false` | 1 |
| 3 | `editKey(ref,"abc")` → `stagedCount===1`（合法输入不误删） | 1 |
| 4 | 并发两次 `setToggle` → 两个值均落地、`conflict===false` | 2 |
| 5 | 第 2 个 POST 的 `expectedRevision` 等于前一次成功后的 rev | 2 |
| 6 | 真 409（外部改 rev）仍使 `conflict===true`（不吞真冲突） | 2 |
| 7 | 串行单 toggle 仍使 `scope.revision` +1（不回归） | 2 |
| 8 | host 落地但响应失败 → `value.enableX === true` 与 host 一致 | 3 |
| 9 | host 未落地且失败 → `value.enableX === false`（无假阳性） | 3 |
| 10 | 失败路径调用 `scope.load`；成功路径不调用 | 3 |
| 11 | `projection()` key 集合不变（状态模型未改） | 3/全部 |
| 12 | 带路径的 `err.message` → `reason==="write rejected"`，无路径/引用名 | 4 |
| 13 | 合法 `code` → 原码显示；非法 code → 回落固定文案 | 4 |
| 14 | 失败路径 `console.warn` 被调用且不含 `err.message` | 5 |

**验收命令**：`node --test tests/*.test.js` → 期望 **18（现有）+ 14（新增）= 32/32 pass**。

---

## 8. 优先级与交付边界

| 优先级 | 条目 | 理由 |
| --- | --- | --- |
| **P0** | 无 | 4 条均为交互/健壮性缺陷，不导致数据丢失或密钥泄露；当前保存链路端到端可用（30-b §1 裁决 5） |
| **P1** | 缺陷 1、2、3 | 用户可感知的功能失灵（按钮死、开关丢失、勾选与 host 分叉） |
| **P2** | 缺陷 4、§5 静默吞错 | 信息泄露边界 / 可观测性，非当前实证危害 |
| **E** | 未来 provider 把输入拼进 `error.message` 的风险；`settings/document-updated` 事件在重读失败时的最终一致性 | 未实证，保留限定语 |

**是否需要改运行时**：**需要**，但仅限 `lib/client.js` 一个文件（4+1 处 diff），**不需要**改 `settings-api.js`、profile、`cordis.patch.yml`、任何 host 源码，也**不需要重启服务**（客户端 bundle 需由既有 HMR/重建流程刷新，按 Lead 的运行时规则处理）。本子代理**未执行任何改动**，报告只给可 apply 的 diff。

**未验证项（E）**：
1. 未在有浏览器的真实 GUI 里点过这 4 条路径（无 CDP/浏览器会话）；所有行为证据来自内存 harness + fake fetch，与真实 `dsh-settings` revision 语义一致但未做浏览器端 E2E。
2. 缺陷 2 的串行化修法会让并发 toggle 变成「两次串行 POST」，若产品要求「最后一个点击胜出且合并为一次写」，需另设批量 `ops`（超出最小修法）。
3. `scope.load()` 在真实 409 后是否总能拿到最新 host 值，依赖 `settings/document-updated` / `describe()` 时序，本轮未做真实浏览器验证。
4. §补遗中的内存 diff 验证脚本尚未完整跑完（锚点缩进问题，见补遗）；落盘后追加最终验证结果。

---

*阶段性交付：4 条缺陷结论 + 最小修法 diff + 回归断言已落盘。§补遗将追加内存验证最终结果。*

---

## §补遗 · 内存 diff 验证最终结果（2026-11-07 23:20，追加，不改上文）

> 上文 §8「未验证项 4」及交付简报中提到的 `/tmp/verify-40.cjs` 缩进锚点问题**已解决并完成验证**。本节只追加，上文结论、diff、断言全部不变。

### B.1 验证方法（A+D）

把报告 §1–§5 的 **8 处 diff（D1 两处、D2 两处、D3/§5 一处、D4 两处）** 以**精确字符串锚点**应用到 `lib/client.js` 的**内存副本**（`fs.readFileSync` → `String.replace`），再用 `new Function` 加载该副本（stub `react` / `react/jsx-runtime` / `window.__ModuleLoader__`，导出内部 `SettingsRoutesBridge` / `UnifiedSearchCardController`），配 fake `globalThis.fetch` 模拟 host 的 revision 语义与「落地后响应失败」场景。**磁盘源码全程未写**。

首轮脚本因 `client.js` 的类方法实际缩进是 **3 个 tab**（不是我按 `cat -A` 目测的 2 个）导致 D2/D3 三处锚点未命中；校正为 `\t\t\t` 后 **8/8 锚点全部命中**（`changed bytes = 823`）。另修正了 fake host 的 mode 变量（改为动态 getter）与「串行化后第 2 个 POST 才创建」的队列排空循环（改为 detached drain，不与 `await Promise.all` 互锁）。

### B.2 最终输出（逐字关键行）

```
ANCHOR OK  : D1 editKey
ANCHOR OK  : D1 save else
ANCHOR OK  : D1 save else block
ANCHOR OK  : D2 writeQueue field
ANCHOR OK  : D2 serialize write
ANCHOR OK  : D3 + sec5 catch
ANCHOR OK  : D4 helper
ANCHOR OK  : D4 safe reason
changed bytes = 823
...
DEBUG seen = [0,1] state = {"rev":2,"value":{"enableExa":true,"enableDdg":true,"searxngBaseURL":"https://searx.be"}}
PASS — D2 revision read at queue time (0 then 1)
PASS — D2 local revision advanced twice
DEBUG D3 failed= true conflict= false bridgeRev= 1 hostRev= 1
...
RESULT: ALL PASS
```

**28 条断言全 PASS，0 FAIL**，分四组：
- **D1（4 条）**：空白草稿不 stage、预置空白被 `save()` 排空且显示 saved、合法输入仍 stage、无假失败。
- **D2（5 条）**：并发两 toggle 均落地、无自造冲突、`expectedRevision` 依次为 `[0,1]`（证明 revision 在队列轮到时才读）、本地 revision 递增 2 次。
- **D3（4 条）**：host 落地（前置条件）、UI 重同步到 host 真值、`failed === true` 仍保留（`console.warn` 不吞状态）、snapshot revision 刷新为 1。
- **D4（4 条）**：带路径的裸 Error → `"write rejected"` 且无 `/home/`、`.credentials`、`BRAVE` 残留；合法 `code="credential/rejected"` 保留；非法 `code="../etc/passwd"` 回落固定文案。
- **现有 18 测试的源码级锚点（10 条）**：`metered` 两条、`inject`、`res.ok === false`、`writeCredential` throw、`readFailed`、`onEditKey`、guards 计数 = 2、`failedKeys.find` 计数 = 2、无 `.includes` —— **全部仍匹配**。

### B.3 口径澄清（与上文 §6/§7 数字对齐）

- 现有测试基线：`node --test tests/*.test.js` → **18/18 pass**（上文 §6 实测，未变）。
- 内存验证脚本：**28 条断言**（18 条针对 4 条 diff 的行为/源码断言 + 10 条现有测试锚点保全断言），全 PASS。
- 上文 §7 建议的**新测试文件**：14 条断言；若落地，`node --test tests/*.test.js` 期望 **18 + 14 = 32/32**。三个数字口径不同、互不矛盾。

### B.4 磁盘完整性（D）

```
c80f7a5c23e841ac30a6b0cf50822763  /home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/lib/client.js
c80f7a5c23e841ac30a6b0cf50822763  /home/ova/dsh/.artifacts/websearch-research/src-work/plugin/lib/client.js
```
与任务开始时 md5 **完全一致** → 本子代理未改动任何源码；8 处 diff 仅在内存副本验证过。`/tmp/repro-40*.cjs`、`/tmp/verify-40*.cjs`、`/tmp/verify40.cjs` 等临时脚本**已全部删除**。

### B.5 一处需要 Lead 注意的诚实边界（E）

内存验证用的 fake host 把「POST 成功 → `revision += 1`」与「GET 重读返回当前 host 值」做成理想模型；真实 `dsh-settings` 的 `revision` 由 `dsh-settings/lib/index.js:427-429` 按 `raw`（`uid + schema.toJSON() + entry.options.config`）变化递增，**并非每次 mutate 都 +1**。因此：
- D2 的「两个 toggle 依次落地、无自造冲突」结论成立（串行化不依赖 revision 具体递增规则，只依赖「队列轮到时读当前值」）；
- 但回归断言「`expectedRevision === 1`」在真实 host 上应改写为「第 2 个 POST 的 `expectedRevision === 第 1 个成功响应的 revision`」，而不是硬编码 1。上文 §7 断言 5 已按后者表述（"等于前一次成功后的 rev"），**无需改**；此处仅是 fake host 与真实实现的差异说明。
- 同理 D3 的 `scope.load()` 在真实 409 后能否拿到最新值，仍依赖 `settings/document-updated` / `describe()` 时序，上文 §8「未验证项 3」保留 E。**本补遗不推翻、不收窄该限定语。**

*补遗完。上文 §0–§8 未被改动；仅本文件被写；无源码/配置/运行时改动；无 token 或密钥值出现在任何输出。*

