# 44 · 官方化组 C：上游 PR 与可升级性

> 新编制「Bug 与官方化行为规范小组」· task-23 · 唯一产出本文件 · 调研 **2026-11-07 21:41–23:0x**（Asia/Shanghai，收尾时效复核见 §9）
>
> **边界（严格遵守）**：全程**只读**。未改任何源码/配置/其它报告，未执行 `npm install`/`pnpm install`/升级/重启，未操作任务板，未泄露 token 值。所有 diff 均为 `diff -u` 只读生成并**写进本报告的 Markdown 代码块**，未写进任何仓库；`patch --dry-run` 只对 `/tmp/off44/` 下的临时副本生效。
>
> **证据等级**：**A**=源码实证（`路径:行号` 或带 `ref=<tag|sha>` 永久链接，本次实读该行）；**B**=官方文档/issue/PR 原文（URL + 访问日 + HTTP 状态 + 逐字）；**C**=版本记录（CHANGELOG/commit/npm/issue 编号）；**D**=本机实测（命令 + stdout + exit code + 时间/主机 `wuming`）；**E**=推断/待核实（显式标注，不得当结论）。**四联标注**：结论 → 依据 → 代码落点 → 验证方式。
>
> **取证基线**：① `src-work/backups/*.orig`（本机 2.8.4 改前原文 7 个）；② 当前已修补树 `src-work/plugin/` 与安装目录 `~/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/`（**md5 10/10 MATCH**，见 §1）；③ `.baseline-20261107-2116/PLUGIN_CHECKSUMS.txt`（32 行全量 md5）；④ 认证 GitHub API（Basic auth `U=x-access-token; P=${TOK#*:}`，token 仅 shell 变量内）取 `240xu/dsh-websearch` **main = 2.8.8** 与 **PR #7 head `bcb24b1efbb4`** 的 5 个源文件；⑤ npm registry；⑥ 25 §6/§10/§11/§12、99 裁决、35-deep-dig-b。

---

## 0. 一句话结论

1. **好消息（决定性）**：本机 10 个补丁**全部能干净地打到上游 2.8.8 上**——`patch --dry-run -p1` 对 `index.js / provider.js / egress-fetch.js / mcp-client.js / client.js` 五个 diff **5/5 CLEAN-APPLY**（仅带行偏移）。这否定了「2.8.8 改了 4 个文件所以我们的补丁会冲突」的直觉 [A/D]。
2. **唯一的真冲突在 PR #7 分支**：`index.js` 第 10 个 hunk 与 `provider.js` 第 1 个 hunk **FAILED**——因为 PR #7 自己已经包含了 `current()` 修复与 RFC1918 正则，我们的补丁是「同一改动的增强版」。⇒ **应对 PR #7 用 comment 补充，不要新开重复 PR** [A/D]。
3. **不能升级到 2.8.8**：`package.json` 已精确 pin `2.8.4`（无 `^`），普通 `pnpm install` 不会自动升；但一旦手工升，**会覆盖 10 个补丁并重新引入 Issue #8 / 缺 Host 403 / settings inert 三个缺陷**（2.8.8 的 `client.js:649` 仍缺 `remote.credentials`，`normalizeHeaders` 仍删 Host）[A/C/D]。
4. **官方 DSH 升级另有硬门槛**：`@deepseek-ai/dsh@0.2.2-rc.1` 的 `engines.node >= 24.9.0`，本机 `v22.20.0` → **装不上/启不动**；且 v0.2.2-alpha.2 删官方 exa/perplexity provider、默认改 `deepseek-search-api` [B/C/D]。
5. **持久化方案选 `patch-package`**（§4 给完整可执行命令），生成单一可审查 `.patch`；本地 fork / profile overlay 作为无新依赖备选 [D/E]。
6. **验收基线**：10 文件 md5 **10/10 MATCH**、18 个单测（11+3+4）全绿、真实 `web_search` 返回 8 Sources（25 §12.5 已实跑）[D]。本轮只读，未重跑升级/重启。

---

## 1. 改动清单与基线核对（A/D）

**结论**：本机在 `node_modules/@240xu/dsh-websearch` 内的改动 = **10 个文件**（5 改 + 5 增），与 25 §6「7 个需还原 + 3 个新增」的早期表述不同——25 §6 正文已自行订正为「实际新增共 5 个：2 backend + 3 tests」[A]。

| # | 文件 | 类型 | 改前/新增大小 | 归属分组（本报告 §2） | 本机 md5（= baseline） |
| --- | --- | --- | --- | --- | --- |
| 1 | `lib/util/egress-fetch.js` | 改 | 12292 → 13872 B | G4（Host 修复，99 裁决 1 / 22 §3） | `317dfdd0…` |
| 2 | `lib/util/mcp-client.js` | 改 | 7206 → 7936 B | G3（skipInitialize，22 draft D） | `49ec0c27…` |
| 3 | `lib/index.js` | 改 | 22730 → 26865 B | G2（PR#7 current()）+ G3（13 后端登记）+ G4（P1-a ns 修复） | `88168646…` |
| 4 | `lib/client.js` | 改 | 36339 → 44497 B | G1（Issue #8）+ G4（UX §8/§9、P1-c readFailed） | `c80f7a5c…` |
| 5 | `lib/provider.js` | 改 | 23461 → 23834 B | G2（PR#7 RFC1918 正则） | `bf5e3d04…` |
| 6 | `lib/backends/firecrawl.js` | **增** | 4975 B | G3（新 backend）+ G4（P0 resolveApiKey / P1 baseURL） | `0898cc3e…` |
| 7 | `lib/backends/tinyfish.js` | **增** | 4883 B | G3（新 backend）+ G4（同上） | `26f67848…` |
| 8 | `tests/lead-20261106.test.js` | **增** | 11460 B / 222 行 / 11 tests | G4 | `17b86ff6…` |
| 9 | `tests/lead-20261107.test.js` | **增** | 4161 B / 86 行 / 3 tests | G2（PR#7 回归） | `a67c7a3a…` |
| 10 | `tests/lead-20261107-p0.test.js` | **增** | 5273 B / 110 行 / 4 tests | G4（31-b P0 行为级） | `e921b888…` |

**验证 [D]**（2026-11-07 21:5x，`cd ~/.dsh/profiles/web/node_modules/@240xu/dsh-websearch`）：`md5sum` 10 文件与 `.baseline-20261107-2116/PLUGIN_CHECKSUMS.txt` 逐行比对 **TOTAL 10/10 MATCH**；`src-work/plugin` ↔ 安装目录亦 10/10 MATCH（25 §12.5 已记录）。`grep -c '^test('` 三文件 = **11 / 3 / 4 = 18**。`node -v` = **v22.20.0**。

---

## 2. 可提交的 PR diff 草案（`git diff` 风格，四组 + 提交信息建议）

> **格式说明**：下列代码块均为 `diff -u --label a/<path> --label b/<path>` 输出，等价于 `git diff` 的 unified 格式（可直接 `git apply` / `patch -p1`）。基准是 **本机 2.8.4 原文**（`src-work/backups/*.orig`），不是 2.8.8——冲突分析见 §3。**提交顺序建议 G1 → G2 → G3 → G4**（依赖：G3 的 `mcp-client.js` 改 `mcpCall` 签名被新 backend 调用；G4 的 backend P0 修复依赖 G3 的新文件）。
>
> **分组归属与题面「四组」的对应**：题面给的是 Issue #8 / PR #7 / 新 backend / 六专家补修。实际 10 文件的出处更细（25 §1/§8/§9/§10/§11/§12、99 裁决 1、22 draft C/D），下表逐组标注**真实出处**，避免把 99 裁决/UX 打磨误记到「六专家」名下——这也是「有迹可循」的要求 [A/B]。

### G1 · Issue #8 修复：`client.js` 的 inject 与凭证读写

**提交信息建议**
```
fix(client): declare remote.credentials in inject; honour RemoteResult envelopes (fixes #8)

DSH 0.2.x registers each remote namespace as its own service key
(`remote.<namespace>`). Reading `ctx.remote.credentials` without declaring
it throws "cannot get property ... without inject" instead of returning
undefined, so every key save failed and the "configured" badge stayed dark.
Also treat `set()` / `describe()` `{ok:false}` envelopes as failures instead
of silently reporting success / masking with a stale legacy value.

Refs: #8, .artifacts/websearch-research/25-execution-log.md §10
```

**`lib/client.js`（G1 部分，3 个 hunk 逐字；其余 11 个 UX hunk 见 G4 摘要）** [A：`src-work/plugin/lib/client.js:342-410,761-768`]

```diff
--- a/lib/client.js
+++ b/lib/client.js
@@ -646,7 +761,14 @@
 		 * the 0.2.x line; the card binds whichever data source the build offers
 		 * (see selectBridge) and registers the section unconditionally.
 		 */
-		const inject = ["slots", "locale", "connection", "remote"];
+		// lead-fix (2026-11-06, github.com/240xu/dsh-websearch/issues/8):
+		// DSH 0.2.x registers each remote namespace as its OWN service key
+		// (`remote.<namespace>`). Accessing `ctx.remote.credentials` without
+		// declaring it in `inject` THROWS (`cannot get property
+		// "remote.credentials" without inject`) instead of returning undefined,
+		// which made every key save fail and left the "configured" badge dark.
+		// The official dsh-client-ui-settings-models plugin declares the same key.
+		const inject = ["slots", "locale", "connection", "remote", "remote.credentials"];
 		/**
 		 * Resolve the settings data source for this build, in order:
@@ -318,33 +342,66 @@
 			}
 
 			async readCredential(ref) {
+				let readFailed = false;
 				try {
 					let view;
-					if (this.remote !== undefined && this.remote.credentials !== undefined && typeof this.remote.credentials.describe === "function") {
-						// 0.2.x remote face: Record<ref, {configured, writable, source}> behind {ok, value}.
-						const res = await this.remote.credentials.describe([ref]);
-						const record = res !== null && typeof res === "object" && res.value !== undefined ? res.value : res;
-						const byRef = record !== null && typeof record === "object" && record.credentials !== undefined ? record.credentials : record;
-						view = byRef !== null && typeof byRef === "object" ? byRef[ref] : undefined;
+					// lead-fix (2026-11-06, issue #8): guard the property access.
+					// Before the inject fix this threw and the empty catch below
+					// swallowed it, so the "configured" badge never lit up.
+					let api;
+					try { api = this.remote === undefined ? undefined : this.remote.credentials; } catch { api = undefined; }
+					if (api !== undefined && typeof api.describe === "function") {
+						// 0.2.x remote face: RemoteResult<Record<ref, CredentialInfo>>.
+						const res = await api.describe([ref]);
+						// lead-fix (2026-11-07, review 33): judge the envelope FIRST.
+						// An `ok:false` response is a read failure, not "unconfigured".
+						// (No dedicated read-error UI state exists, so do NOT reuse
+						// failedKeys — its copy says "save failed".)
+						if (res !== null && typeof res === "object" && res.ok === false) {
+							readFailed = true;
+						} else {
+							const record = res !== null && typeof res === "object" && res.value !== undefined ? res.value : res;
+							const byRef = record !== null && typeof record === "object" && record.credentials !== undefined ? record.credentials : record;
+							view = byRef !== null && typeof byRef === "object" ? byRef[ref] : undefined;
+						}
 					}
-					if (view === undefined && this.connection !== undefined && this.connection.api !== undefined && this.connection.api.credentials !== undefined) {
+					if (!readFailed && view === undefined && this.connection !== undefined && this.connection.api !== undefined && this.connection.api.credentials !== undefined) {
 						// Older line: the connection controller's credentials API.
 						const res = await this.connection.api.credentials.describe({ refs: [ref] });
 						if (res?.result?.ok) view = res.result.value.credentials[ref];
 					}
-					if (view === undefined) return;
-					this.keyState.set(ref, { configured: view.configured === true, writable: view.writable !== false });
+					if (!readFailed && view !== undefined) {
+						this.keyState.set(ref, { configured: view.configured === true, writable: view.writable !== false });
+					}
 				} catch { /* ignore */ }
 				this.republish();
 			}
 
 			async writeCredential(ref, value) {
-				if (this.remote !== undefined && this.remote.credentials !== undefined && typeof this.remote.credentials.set === "function") {
-					await this.remote.credentials.set(ref, value);
+				// lead-fix (2026-11-06, issue #8): (a) guard the property access
+				// so a missing namespace falls back to the legacy connection API;
+				// (b) `set()` resolves a `{ok,value}|{ok:false,error}` envelope —
+				// ignoring it displayed "Saved" even when the host refused.
+				let api;
+				try { api = this.remote === undefined ? undefined : this.remote.credentials; } catch { api = undefined; }
+				if (api !== undefined && typeof api.set === "function") {
+					const res = await api.set(ref, value);
+					const rejected = res !== null && typeof res === "object" && res.ok === false;
+					if (rejected) throw new Error(res.error?.message ?? "credential write rejected");
 					return;
 				}
 				if (this.connection !== undefined && this.connection.api !== undefined && this.connection.api.credentials !== undefined && typeof this.connection.api.credentials.set === "function") {
-					await this.connection.api.credentials.set({ ref, value });
+					const res = await this.connection.api.credentials.set({ ref, value });
+					const rejected = res !== null && typeof res === "object" && (res.ok === false || res.result?.ok === false);
+					if (rejected) throw new Error(res.error?.message ?? res.result?.error?.message ?? "credential write rejected");
 					return;
 				}
 				throw new Error("credentials service unavailable");
```

**与上游 2.8.8 冲突？**：**不冲突**（`client.js` 在 2.8.4 → 2.8.8 是**逐字节相同**，`cmp` 验证 [A/D]），`patch --dry-run` CLEAN-APPLY。**与 Issue #8 作者建议逐字一致**（issue body 给的 diff 就是 `inject` 补 `remote.credentials` + `set()` 判 `ok:false`），我们额外多了 `readCredential` 的 `ok:false` 判定（review 33）与 `try/catch` 属性守卫 [B/A]。

### G2 · PR #7 移植：settings 生效 + RFC1918 私有主机

**提交信息建议**
```
fix(index,provider): read live settings-service values; accept RFC1918 http baseURLs

On DSH 0.2.x the entry-level `config` given to apply() carries only schema
defaults; live user values live in the settings service. `current = () => config`
made every Settings-card save a no-op. The RFC1918 regex used `{3}` after
`192.168` / `172.16-31`, requiring 5 octets and rejecting every real private
host. Transplanted from upstream PR #7 (bcb24b1e) with one extra fix: DSH 0.2.x
keys namespaces by `entry.options.id` = "dsh-websearch", not "unified-search".

Refs: #7, .artifacts/websearch-research/25-execution-log.md §11
```

**`lib/index.js`（G2 部分，第 10 hunk）** [A：`src-work/plugin/lib/index.js:447-480`]

```diff
--- a/lib/index.js
+++ b/lib/index.js
@@ -407,11 +447,37 @@
       });
       return;
     }
-    // 0.2.x SettingsForms line: no installSection. Keep the service so the
-    // browser settings card can read/write this profile entry through the
-    // fenced bridge in ./settings-api.js; values keep resolving via cordis
-    // config (the same volatile entry), so there is no second settings store.
-    if (typeof settings?.describe === "function" && typeof settings?.mutate === "function") settingsForms = settings;
+    // 0.2.x SettingsForms line: no installSection. The entry-level `config`
+    // passed to apply() carries only schema defaults on DSH 0.2.x; the live
+    // profile-patch / user values live in the settings service's effective
+    // config. Reading them per search is what makes the Settings card actually
+    // drive execution (github.com/240xu/dsh-websearch/pull/7 — "settings are
+    // inert on DSH 0.2.x"). Applied 2026-11-07 by lead, mirroring the
+    // upstream PR's fix so a future npm upgrade reconciles cleanly. Without
+    // this, saving a toggle writes to the settings service but `current()`
+    // keeps returning the stale initial config, so the save is a no-op.
+    if (typeof settings?.describe === "function" && typeof settings?.mutate === "function") {
+      settingsForms = settings;
+      current = () => {
+        try {
+          const rows = settings.describe();
+          // lead-fix (2026-11-07, review 30-b P1): on DSH 0.2.x the settings
+          // service keys namespaces by `entry.options.id`, which for this
+          // plugin is the bundle insert id "dsh-websearch" — NOT the settings
+          // NAMESPACE "unified-search". The upstream PR #7 matched only the
+          // latter, so its primary lookup was dead code and everything relied
+          // on the shape fallback. Match the live id first (keeping NAMESPACE
+          // for older hosts), then shape, then fall back to initial config.
+          const byId = rows.find((r) => r && r.ns === "dsh-websearch")
+            ?? rows.find((r) => r && r.ns === NAMESPACE);
+          const row = byId
+            ?? rows.find((r) => r && r.value && typeof r.value === "object" && "searxngBaseURL" in r.value);
+          return (row && row.value) ?? config;
+        } catch {
+          return config;
+        }
+      };
+    }
   });
```

**`lib/provider.js`（全量，唯一 hunk）** [A：`src-work/plugin/lib/provider.js:313-322`]

```diff
--- a/lib/provider.js
+++ b/lib/provider.js
@@ -313,7 +313,12 @@
           if (beOpts.baseURL !== undefined) {
             let bu = null;
             try { bu = new URL(beOpts.baseURL); } catch { bu = null; }
-            const privHost = bu ? /^(localhost|127(\.\d{1,3}){3}|10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){3}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){3})$/.test(bu.hostname) : false;
+            // lead-fix (2026-11-07, upstream PR #7): 192.168/16 and 172.16/12
+            // already match the first two octets, so only TWO more octets may
+            // follow. The old `{3}` made every RFC1918 plain-http baseURL
+            // (e.g. http://192.168.1.100:8385) fail the trust gate even though
+            // the docs promise private hosts may use http.
+            const privHost = bu ? /^(localhost|127(\.\d{1,3}){3}|10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2})$/.test(bu.hostname) : false;
             const schemeOk = bu && (bu.protocol === "https:" || (bu.protocol === "http:" && privHost));
             if (!schemeOk || bu.username || bu.password) {
               throw new WebError(`backend "${id}" has an invalid baseURL: https required (plain http only for private hosts), credentials-in-URL rejected`, "WEB_PROVIDER_ERROR");
```

**`tests/lead-20261107.test.js`**（新增 86 行 / 3 tests：`apply() resolves live settings-service values` / `RFC1918 plain-http baseURL passes the trust gate` / `source-level: current() reads settings.describe()`）— 全文见 `src-work/plugin/tests/lead-20261107.test.js` [A]。**注意 PR #7 自己也新增了 `tests/v28x-settings-bridge.test.js`(+57)**，两者用例不同（我们的是行为级 + ns 顺序），**可以并存**，但提交 PR 时应说明「我们基于你的补丁补了 ns 顺序修复 + 3 条测试」[A/B]。

**冲突**：与 **2.8.8** CLEAN-APPLY（`current()` 在 2.8.8 仍是单行 `settingsForms = settings;`；`privHost` 仍是 `{3}`）。与 **PR #7 head** **CONFLICT**：`index.js` hunk#10 FAILED at 447、`provider.js` hunk#1 FAILED at 313——因为 PR#7 已含同两处改动 [A/D，见 §3]。

### G3 · 新 backend：Firecrawl / TinyFish（OpenCode v2 keyless MCP）

**提交信息建议**
```
feat(backends): add Firecrawl and TinyFish keyless MCP search (opt-in)

Mirrors OpenCode v2.2.5's websearch providers. Both are opt-in (not in
DEFAULT_ENABLED) because their keyless tiers are metered and Firecrawl's daily
ceiling is not published. TinyFish keyless is stateless, so mcpCall() gains a
`skipInitialize` option; exa/parallel keep the full 3-step handshake.

Refs: anomalyco/opencode@v2.2.5 packages/core/src/plugin/websearch/{firecrawl,tinyfish}.ts
      .artifacts/websearch-research/21-engineering-plan.md T-08/T-09
```

**`lib/util/mcp-client.js`（全量，支持 TinyFish keyless 无 initialize）** [A：`src-work/plugin/lib/util/mcp-client.js:148-166`]

```diff
--- a/lib/util/mcp-client.js
+++ b/lib/util/mcp-client.js
@@ -148,10 +148,19 @@
  * @param {object} args - Tool arguments
  * @param {object} extraHeaders - Additional headers
  * @param {AbortSignal} signal - Abort signal
+ * @param {{ skipInitialize?: boolean }} [options] - Per-call transport options.
+ *   Set `skipInitialize: true` for stateless MCP servers whose keyless tier
+ *   rejects an `initialize` round-trip (TinyFish keyless). Keyed sessions
+ *   still use the full initialize -> notifications/initialized -> tools/call
+ *   handshake with `Mcp-Session-Id`; passing this option for them is wrong.
+ *   OpenCode v2.2.5 `tinyfish.ts:78` documents the same split.
  * @returns {Promise<object>} Parsed result envelope
  */
-export async function mcpCall(url, toolName, args, extraHeaders = {}, signal) {
-  const sessionId = await ensureSession(url, signal);
+export async function mcpCall(url, toolName, args, extraHeaders = {}, signal, options = {}) {
+  // dsh-websearch / lead-fix (2026-11-06): keep the 3-step handshake as the
+  // default (zero regression for exa/parallel) but allow a direct tools/call
+  // for keyless stateless servers. See 22-execution-drafts.md draft D.
+  const sessionId = options.skipInitialize ? undefined : await ensureSession(url, signal);
```

**`lib/index.js`（G3 部分：9 处登记，全量）** [A：`src-work/plugin/lib/index.js:33-36,66-73,79-82,90-95,108-114,139-144,209-214,230-239,255-262,336-341`]

```diff
--- a/lib/index.js
+++ b/lib/index.js
@@ -33,6 +33,9 @@
 import { serperBackend } from "./backends/serper.js";
 import { searxngBackend } from "./backends/searxng.js";
 import { mojeekBackend } from "./backends/mojeek.js";
+// lead (2026-11-06): OpenCode v2 keyless MCP backends, see 21-engineering-plan.md T-08/T-09.
+import { firecrawlBackend } from "./backends/firecrawl.js";
+import { tinyfishBackend } from "./backends/tinyfish.js";
 import { createUnifiedSearchProvider, getLatestBackendHealth } from "./provider.js";
@@ -63,12 +66,19 @@
   deepseek: deepseekBackend,
   anthropic: anthropicBackend,
   openai: openaiBackend,
+  // lead (2026-11-06): appended last so default fan-out order is unchanged.
+  // Both are opt-in (not in DEFAULT_ENABLED): their keyless tiers are metered
+  // and Firecrawl's exact daily ceiling is not published by the vendor.
+  firecrawl: firecrawlBackend,
+  tinyfish: tinyfishBackend,
 };
@@ -80,6 +90,9 @@
   tavily: "TAVILY_API_KEY",
   serper: "SERPER_API_KEY",
   mojeek: "MOJEEK_API_KEY",
+  // lead (2026-11-06): optional keys; keyless works without them.
+  firecrawl: "FIRECRAWL_API_KEY",
+  tinyfish: "TINYFISH_API_KEY",
 };
@@ -95,6 +108,10 @@
   deepseek: "https://api.deepseek.com/anthropic/v1",
   anthropic: "https://api.anthropic.com/v1",
   openai: "https://api.openai.com/v1",
+  // lead (2026-11-06): OpenCode v2.2.5 source endpoints; overridable via the
+  // matching *BaseURL settings so a TLS-fingerprint sidecar can be pointed at.
+  firecrawl: "https://mcp.firecrawl.dev/v2/mcp",
+  tinyfish: "https://agent.tinyfish.ai/mcp",
 };
@@ -122,6 +139,10 @@
   deepseek: "DeepSeek (原生 web_search, 需 Key)",
   anthropic: "Anthropic (Claude 原生 web_search, 需 Key)",
   openai: "OpenAI (Responses API web_search, 需 Key)",
+  // lead (2026-11-06): labels surfaced in the Settings panel; note the keyless
+  // tier is rate limited, which is why both toggles default to off.
+  firecrawl: "Firecrawl (MCP, 免 Key 但有额度, 默认关)",
+  tinyfish: "TinyFish (MCP, 免 Key 30/min·50/day, 默认关)",
 };
@@ -188,6 +209,9 @@
   enableDeepseek: z.boolean().default(false).description(DEFAULT_LABELS.deepseek),
   enableAnthropic: z.boolean().default(false).description(DEFAULT_LABELS.anthropic),
   enableOpenai: z.boolean().default(false).description(DEFAULT_LABELS.openai),
+  // lead (2026-11-06): opt-in by default; see DEFAULT_ENABLED comment.
+  enableFirecrawl: z.boolean().default(false).description(DEFAULT_LABELS.firecrawl),
+  enableTinyfish: z.boolean().default(false).description(DEFAULT_LABELS.tinyfish),
@@ -206,6 +230,13 @@
     .description("Openai API Key 的凭证引用（填环境变量名，实际密钥存凭证库）"),
   searxngApiKeyEnv: z.string().role("credential-ref").default("SEARXNG_API_KEY")
     .description("SearXNG 私有实例的 API Key 凭证引用（公共实例留空）"),
+  // lead (2026-11-06): optional — both backends work keyless. Supplying a key
+  // only raises the hosted tier's limits (and for TinyFish activates the
+  // initialize/Mcp-Session-Id handshake).
+  firecrawlApiKeyEnv: z.string().role("credential-ref").default(DEFAULT_KEY_ENV.firecrawl)
+    .description("Firecrawl API Key 凭证引用（可选；留空用免 Key hosted tier）"),
+  tinyfishApiKeyEnv: z.string().role("credential-ref").default(DEFAULT_KEY_ENV.tinyfish)
+    .description("TinyFish API Key 凭证引用（可选；留空用免 Key 模式）"),
@@ -224,6 +255,12 @@
     .description("Anthropic API 端点（默认官方；自托管/代理实例改此项）"),
   openaiBaseURL: z.string().default(DEFAULT_BASE_URLS.openai)
     .description("OpenAI API 端点（默认官方；自托管/代理实例改此项）"),
+  // lead (2026-11-06): resolveOptions() already derives `${id}BaseURL` for
+  // every id, so these two fields are required for the sidecar/proxy path.
+  firecrawlBaseURL: z.string().default(DEFAULT_BASE_URLS.firecrawl)
+    .description("Firecrawl MCP 端点（默认官方 v2；可指向 TLS sidecar）"),
+  tinyfishBaseURL: z.string().default(DEFAULT_BASE_URLS.tinyfish)
+    .description("TinyFish MCP 端点（默认官方；可指向 TLS sidecar）"),
@@ -299,6 +336,9 @@
       deepseek: config?.enableDeepseek,
       anthropic: config?.enableAnthropic,
       openai: config?.enableOpenai,
+      // lead (2026-11-06): keep in sync with BACKENDS / Config toggles.
+      firecrawl: config?.enableFirecrawl,
+      tinyfish: config?.enableTinyfish,
     };
```

> ✅ **已按 `src-work/plugin/lib/index.js:236-239` 逐字复核**：上面 `firecrawlApiKeyEnv` / `tinyfishApiKeyEnv` 两行与源码完全一致（`.default(DEFAULT_KEY_ENV.firecrawl)` / `.default(DEFAULT_KEY_ENV.tinyfish)`）。其余各 hunk 亦与 `/tmp/off44/diff-index.js.txt` 逐行一致 [A]。**提交 PR 的完整权威源仍是 `src-work/plugin/lib/index.js` 原文与 `/tmp/off44/diff-index.js.txt`**（本报告为分组展示，行号带分组裁剪偏移）[A]。

**`lib/backends/firecrawl.js` / `tinyfish.js`**（两个新文件，各约 110 行）— 全文见 `src-work/plugin/lib/backends/{firecrawl,tinyfish}.js` [A]。核心契约（均为 `git diff` 中 `new file mode 100644` + `--- /dev/null`）：
- `FIRECRAWL_ENDPOINT = "https://mcp.firecrawl.dev/v2/mcp"`，tool `firecrawl_search {query, limit}`，解析 `content[0].text` 的 `{success,data.web[{url,title?,description?}]}` → `{url,title?,snippet?}`；`requiresCredential:false`、`available()=>true`、keyless 无 `Authorization`、有 key 用 `Bearer`。
- `TINYFISH_ENDPOINT = "https://agent.tinyfish.ai/mcp"`，tool `search {query}`，解析 `{results:[{url,title,snippet}]}`；keyless 头 `X-TinyFish-Access-Mode: keyless` + `mcpCall(..., {skipInitialize:true})`，keyed 头 `X-API-Key` + 完整三步握手。
- 两者都经 G4 的 P0/P1 修复消费 `resolveApiKey()` 与 `options.baseURL`（见 §2 G4）。
- **提交 PR 时这两个文件应作为完整新增文件附上**（本报告不复制 220 行全文，避免与源码漂移；路径即权威 [A]）。

**冲突**：与 **2.8.8** CLEAN-APPLY（`mcpCall` 签名在 2.8.8 未变；`index.js` 2.8.8 只多了 `searxngBaseURLs`，我们的 9 个 hunk 全部带偏移命中）。与 **PR #7 head** 也 CLEAN-APPLY（PR#7 未动这两处）[A/D]。**2.8.8 无 firecrawl/tinyfish 文件，不会覆盖，但升级后 `index.js` 的登记会丢 → 新 backend 变成孤儿**（除非重放补丁）[A]。

### G4 · 六专家审查补修 + Host 修复 + UX 打磨

**提交信息建议（建议拆 3 个 commit，便于评审）**
```
fix(egress): restore Host header for CONNECT-tunnelled HTTPS requests

normalizeHeaders() strips Host; Node's https.request({socket}) then synthesises
a bare hostname (no port) which Cloudflare-fronted MCP endpoints reject with
403 before any handshake. Mirror httpViaProxy's `host: headers.host ?? target.host`.

fix(backends): resolve optional API keys via async resolveApiKey(); honour BaseURL

Two new backends read only options.apiKey (a literal) while resolveOptions()
supplies resolveApiKey(); the keyed branches were unreachable dead code. Both
also hardcoded endpoints, bypassing the provider trust gate and sidecar path.

fix(client): readCredential ok:false handling; UI copy for metered backends

Refs: .artifacts/websearch-research/25-execution-log.md §8/§9/§12, 99-final-verdicts.md 裁决 1
```

**`lib/util/egress-fetch.js`（全量，2 hunk）** [A：`src-work/plugin/lib/util/egress-fetch.js:170-190,288-297`]

```diff
--- a/lib/util/egress-fetch.js
+++ b/lib/util/egress-fetch.js
@@ -167,13 +167,28 @@
         fail(new TypeError(`fetch failed: proxy CONNECT rejected with ${connectRes.statusCode}`));
         return;
       }
+      // dsh-websearch / lead-fix (2026-11-06): normalizeHeaders() strips Host
+      // (see below). For a request tunnelled through CONNECT, Node's
+      // https.request() then synthesises a Host from options.host — which is
+      // absent here (we pass an already-connected `socket`), so the value is
+      // the bare hostname without the port, not the request-target authority.
+      // Cloudflare-fronted MCP endpoints (mcp.exa.ai, search.parallel.ai)
+      // reject that with HTTP 403 before any MCP handshake. httpViaProxy()
+      // already restores the header with the same expression; mirror it here
+      // so both proxy paths send an explicit, port-qualified Host.
+      // Offline proof (local CONNECT proxy + TLS server, 2026-11-06):
+      //   patched  -> Host "localhost:45277" (target.host)
+      //   original -> Host "localhost"       (Node auto-synthesis)
+      // Live A/B on the real 1091 CONNECT (22-execution-drafts.md §1.2):
+      //   WITHOUT explicit Host: 403 / WITH explicit Host: 200.
+      // Fix origin: .artifacts/websearch-research/99-final-verdicts.md 裁决 1.
       const request = https.request({
         socket,
         agent: false,
         servername: target.hostname,
         method,
         path: pathWithQuery(target),
-        headers,
+        headers: { ...headers, host: headers.host ?? target.host },
       });
       open.push(request);
       request.on("error", (error) => fail(new TypeError(`fetch failed: ${sanitize(error)}`, { cause: error })));
@@ -273,6 +288,12 @@
       if (value !== undefined) headers[String(key).toLowerCase()] = String(value);
     }
   }
+  // Host is deliberately removed: a caller-supplied Host must not override
+  // the tunnel target. Each transport is therefore responsible for adding it
+  // back before the request is sent — httpViaProxy() and httpsViaConnect()
+  // both do so via `host: headers.host ?? target.host`. Do not delete those
+  // two restorations; doing so reintroduces the Cloudflare 403 described in
+  // the comment at httpsViaConnect().
   delete headers["host"];
   return headers;
 }
```

**两个新 backend 的 P0/P1 修复（G4 部分，逐字）** [A：`firecrawl.js:41-58`、`tinyfish.js:41-62`]

```diff
--- a/lib/backends/firecrawl.js	(new file, G4 portion)
+++ b/lib/backends/firecrawl.js
@@
-    const apiKey = options?.apiKey ?? "";                 // 初版：只认字面量 → key 永远到不了
+    // lead-fix (2026-11-07, review 31-b P0): resolveOptions() supplies an
+    // async `resolveApiKey()`, NOT a literal `apiKey`. Match
+    // anthropic-like.js:71 so both a literal (tests/stubs) and the live
+    // credential resolver work; a failure to resolve degrades to keyless.
+    let apiKey = typeof options?.apiKey === "string" ? options.apiKey : "";
+    if (!apiKey && typeof options?.resolveApiKey === "function") {
+      try { apiKey = (await options.resolveApiKey()) ?? ""; } catch { apiKey = ""; }
+    }
     const extraHeaders = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
-    const endpoint = FIRECRAWL_ENDPOINT;                 // 初版：硬编码，绕过 trust gate
+    const endpoint = typeof options?.baseURL === "string" && options.baseURL.length > 0
+      ? options.baseURL : FIRECRAWL_ENDPOINT;
```
（tinyfish.js 同构，额外区别是 `keyed = apiKey.length > 0` 决定 `X-API-Key` vs `X-TinyFish-Access-Mode: keyless` 以及 `{skipInitialize: !keyed}`；全文见源码 [A]。）

**`lib/client.js` 的 G4 部分（11 个 UX hunk + P1-c）**：25 §8/§9 的 UI 打磨（metered 后端独立分区、`description` 不再硬编码「11 个后端」、状态栏 `statusMetered`、开关与 Key 输入合并成一张卡）与 §12.3 P1-c（`readCredential` 的 `readFailed` 标记，已含在 G1 的 readCredential hunk 里）。共 `+180/−58`，14 个 hunk 全量在 `/tmp/off44/diff-client.js.txt`，本报告不逐行复制（属文案/布局，非协议性改动）[A]。**提交 PR 时建议单独一个 commit，便于作者按需取舍** [E]。

**`tests/lead-20261106.test.js`（11 tests）/ `lead-20261107-p0.test.js`（4 tests）**：见 §1 路径；`p0` 文件用假 `globalThis.fetch` 断言 `Authorization: Bearer FC-TEST-KEY` / `X-API-Key: TF-TEST-KEY` / keyless 头消失 / URL 走配置的 baseURL，是 P0 的行为级证据 [A/D，25 §12.5]。

**冲突**：`egress-fetch.js` 对 **2.8.8** CLEAN-APPLY（Hunk#1 偏移 +128 行命中 `httpsViaConnect`，2.8.8 在该函数内**没有**改 Host 相关代码，仍 `headers,` 单参数 [A]）；对 PR#7 同样 CLEAN-APPLY。client.js UX 对两基线均 CLEAN-APPLY。新文件无冲突但**升级会丢失登记**（§3）[A/D]。

### 2.1 分组 → 文件 → 冲突 汇总表

| 组 | 提交信息（首行） | 涉及文件 | 对 2.8.8 | 对 PR#7 head |
| --- | --- | --- | --- | --- |
| G1 | `fix(client): declare remote.credentials in inject; honour RemoteResult envelopes (fixes #8)` | `client.js`（3 hunk） | ✅ CLEAN | ✅ CLEAN |
| G2 | `fix(index,provider): read live settings-service values; accept RFC1918 http baseURLs` | `index.js`(h10)、`provider.js`(h1)、`tests/lead-20261107.test.js` | ✅ CLEAN | ❌ **h10/h1 FAILED** |
| G3 | `feat(backends): add Firecrawl and TinyFish keyless MCP search (opt-in)` | `index.js`(9 hunk)、`mcp-client.js`、2 新 backend | ✅ CLEAN | ✅ CLEAN |
| G4 | `fix(egress): restore Host…` / `fix(backends): resolveApiKey…` / `fix(client): UX…` | `egress-fetch.js`、`client.js`(11 hunk)、2 backend 内 P0/P1、`tests/lead-20261106.test.js`、`lead-20261107-p0.test.js` | ✅ CLEAN | ✅ CLEAN |

---

## 3. 冲突矩阵（认证 API 取 2.8.8 / PR#7 源码，`patch --dry-run` 实测）

**结论**：我们的补丁**基于 2.8.4 原文**生成，而 2.8.8 改了其中 4 个文件——但 `patch --dry-run` 证明 **5/5 全部干净应用**（只是行偏移），因为 2.8.5/2.8.6 的改动**没有碰到我们的 hunk 上下文**。真正冲突只在 PR #7 分支，且是「同一改动的重复」而非「不兼容」[A/D]。

| 文件 | 2.8.4→2.8.8 上游改了什么（[A] 逐字 diff） | 我们的 hunk 上下文 | `--dry-run` vs 2.8.8 | `--dry-run` vs PR#7 |
| --- | --- | --- | --- | --- |
| `client.js` | **逐字节相同**（`cmp` 0 差异，36339B） | inject / readCredential / writeCredential / UX | **CLEAN**（0 偏移） | CLEAN |
| `index.js` | 仅 +`searxngBaseURLs` Config 字段(`:221`) 与 `resolveOptions` 投影(`:333`)，共 +7 行 | 9 登记 hunk + 1 `current()` hunk (`apply()` 内 `:405+`) | **CLEAN**（h10 偏移 +7） | **hunk#10 FAILED at 447** — PR#7 自己已有 `current = () => {...}`(base7 `:422-438`) |
| `provider.js` | +`failureLabel` import、ddg 5000→8000、`MAX_FAILURE_DETAILS`、超时分类前置（`:348-365`） | `privHost` 正则（`:313`，在 `runBackend` 内，上游改动区**之前**） | **CLEAN**（偏移） | **hunk#1 FAILED at 313** — PR#7 已把 `{3}` 改成 `{2}`(base7 `:327`) |
| `util/egress-fetch.js` | +`DSH_EGRESS_FORWARDER` forwarder 路径（文件头 +`forwarderFetch`/`forwarderExchange` +91 行） | `httpsViaConnect` 的 `https.request({headers})` + `normalizeHeaders` 的 `delete headers["host"]` | **CLEAN**（Hunk#1 at 295 offset +128、Hunk#2 at 416 offset +128） | CLEAN |
| `util/mcp-client.js` | +`describeError` import、3 处 `describeError(error)` 包裹错误串 | `mcpCall` 签名与首行 `ensureSession` | **CLEAN** | CLEAN |
| 2 新 backend + 3 新 tests | 2.8.8 / PR#7 **均无这些文件** | `new file` | 无冲突，但**升级后 `index.js` 登记丢失 → 变孤儿** [A] | 无冲突 |

**四联**：结论=对 2.8.8 可干净重放、对 PR#7 有 2 处重复冲突 → 依据 [A] raw `main`/`bcb24b1efbb4` 五文件（HTTP 200）+ `/tmp/off44/diff-*.txt` → 代码落点 [A] 上表行号 → 验证 [D] `patch --dry-run -p1 -d base288|base7` 逐文件 rc=0/1 输出（2026-11-07 21:5x）。

**这直接决定 PR 策略（§5）**：G1/G3/G4 可作为**独立新 PR** 打在 `main` 上；G2 应作为 **PR #7 的 comment/补充 commit**，不要另开 PR 重复提交 `current()` 与正则。

---

## 4. 升级门槛清单 + 不升级也能持久化补丁

### 4.1 「若必须升级，先做什么」清单（按顺序，全部需用户批准；本轮**未执行**）

| # | 前置动作 | 为什么 | 证据 |
| --- | --- | --- | --- |
| 1 | **先升级 Node 到 ≥ 24.9.0**（本机 `v22.20.0`） | `@deepseek-ai/dsh@0.2.2-rc.1` 的 `engines.node >= 24.9.0`；不改 Node 直接升 DSH 会装不上/启不动 | npm registry `/0.2.2-rc.1` 200 [C] + `node -v` [D] |
| 2 | 读 [`v0.2.2-alpha.2/web-search-default-provider/guide.md`](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/upgrade-guide/v0.2.2-alpha.2/web-search-default-provider/guide.md)：官方**删除** `dsh-web-search-exa`(provider `exa`) / `…-perplexity`(provider `perplexity`) 行，默认 `searchProvider` 从 `deepseek-official` 改 `deepseek-search-api` | 我们显式 `- id: web searchProvider: unified`，guide 原文「Compositions that set `web.searchProvider` themselves see no change」→ 无碍；但**组合树里若残留 exa/perplexity 行会加载失败** | raw 200 逐字 [B] |
| 3 | 读 [`v0.2.2-alpha.2/web-search-credential-modes/guide.md`](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/upgrade-guide/v0.2.2-alpha.2/web-search-credential-modes/guide.md)：`baseURL`/`apiKeyEnv`/`apiKey` 字段移除 | 插件 `deepseek` 后端与官方 `web-deepseek-api` **共享 `DEEPSEEK_API_KEY`/`DEEPSEEK_BASE_URL`**，改 base URL 可能串台 [E，需实跑] | raw 200 [B/E] |
| 4 | 读 `v0.2.1-rc.3/web-search-defaults/guide.md`：`searchMaxQueries` 4→10、`searchMaxResults` 8→10 | 本机 `tool-web` 只配 `fetch:true, searchTimeoutMs:60000`，升级后单次 `web_search` 可能起 10 次 provider 搜索，`concurrency=6`/遥测 `slice(0,12)` 压力面变化 [E] | raw 200 + 本机 `cordis.patch.yml` [B/A/E] |
| 5 | 升级**前**先跑 §6 的 md5 清单存档，并**生成 patch-package 补丁**（§4.2） | 升级会覆盖 `node_modules` 全部 10 个文件，且 2.8.8 仍缺 `remote.credentials`、仍删 Host → 不重放补丁会**同时**重现 Issue #8 保存失败、403、settings inert | [A/D] 见 §3 + 35-deep-dig-b §1 |
| 6 | 升级**后**按 §3 的 dry-run 顺序重放 G1→G4（或直接 `patch -p1 < patch-package 生成的 .patch`），再跑 §6 全部验收 | 已证 5/5 CLEAN-APPLY | [D] |
| 7 | 复核 systemd drop-in 的 `DSH_WEB_FETCH_PROVIDER=http` / `HTTP(S)_PROXY` 仍在，且 `DSH_EGRESS_FORWARDER_PROXY` 若走 2.8.8 forwarder 必须补（当前**未设**） | 2.8.8 的 forwarder spec 无 `proxy` 字段时 sidecar 返 502（35-deep-dig-b §6 实测） | [D/E] |

> **重要现状（降低紧急度）**：`~/.dsh/profiles/web/package.json` 已精确 pin `"@240xu/dsh-websearch": "2.8.4"`（**无 `^`**）[A]，普通 `pnpm install` **不会**自动升到 2.8.8。所以「不升级」是零动作的稳态；风险只在**手工改版本号 / 换机重装 / `pnpm store prune` 后重解包** [D/E]。

### 4.2 不升级也能持久化补丁：选 **`patch-package`**（给可执行命令）

**为什么选它**（对比三案）[D/E]：

| 方案 | 优点 | 缺点 | 判定 |
| --- | --- | --- | --- |
| **patch-package** | 单一可审查 `.patch`、随 `pnpm install` 自动重放、上游 PR 合并后可一键删除、失败**响亮报错**而非静默 | 需装 1 个 devDependency + 加 `postinstall`（**需用户批准**，本轮未执行）；pnpm 对根包 postinstall 的运行策略需验证 [E] | ✅ **推荐** |
| 本地 fork（`file:` 依赖） | 无新依赖、完全自控 | 要把整包复制出 `node_modules` 并改 `package.json` 依赖值，升级路径更绕；diff 不直观 | 备选 [E] |
| profile 级 overlay（脚本 + `cp`） | 零依赖 | 不是 npm 生态惯例，换机易漏；无自动触发点 | 备选 [E] |

**可执行命令（需用户批准后执行；本报告只给命令，未运行）**：

```bash
# 0) 常量 —— profile 是 pnpm workspace 根，插件已精确 pin 2.8.4
PROF=/home/dsh/.dsh/profiles/web
PKG="$PROF/node_modules/@240xu/dsh-websearch"
BACKUP=/home/ova/dsh/.artifacts/websearch-research/.baseline-20261107-2116

# 1) 存档当前 10 文件（升级/重装前的权威基线）
cd "$PKG" && md5sum -c <(grep -E 'lib/(util/(egress-fetch|mcp-client)|index|client|provider|backends/(firecrawl|tinyfish))\.js|tests/lead-2026110' "$BACKUP/PLUGIN_CHECKSUMS.txt")
#    期望 10/10 OK（本次实测 10/10 MATCH [D]）

# 2) 装 patch-package 并挂 postinstall（★需用户批准：会写 package.json + 装依赖★）
cd "$PROF"
pnpm add -D patch-package
node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync("package.json","utf8"));
  p.scripts={...(p.scripts||{}),postinstall:"patch-package"};
  fs.writeFileSync("package.json",JSON.stringify(p,null,2)+"\n")'

# 3) 生成补丁（patch-package 会从 npm tarball 取原始 2.8.4 与当前 node_modules 对比，
#    自动包含 5 改 + 5 增共 10 个文件）
npx patch-package @240xu/dsh-websearch
#    → patches/@240xu+dsh-websearch+2.8.4.patch   （提交进版本控制/备份）

# 4) 验证：模拟一次重装后补丁自动重放（★需用户批准：会重解包 node_modules★）
pnpm install
cd "$PKG" && md5sum -c <(grep -E 'lib/(util/(egress-fetch|mcp-client)|index|client|provider|backends/(firecrawl|tinyfish))\.js|tests/lead-2026110' "$BACKUP/PLUGIN_CHECKSUMS.txt")
#    期望仍 10/10 OK；若 patch 应用失败，patch-package 会以非 0 退出（fail loud）

# 5) 若将来上游合并 PR / 发布含这些修复的新版本：删补丁 + 去掉 postinstall + 升级
#    rm patches/@240xu+dsh-websearch+2.8.4.patch
```

**关键注意（E，需实测）**：① `patch-package` 生成的 diff 绑定 **2.8.4** 版本号，一旦把 `package.json` 改成 `2.8.8`，补丁会**明确失败**（这正是我们要的「升级必须重放」提醒）[E]；② pnpm 对**根包** `postinstall` 默认会执行，但某些 pnpm 配置（`ignore-scripts=true` / `onlyBuiltDependencies`）会跳过 → 第 4 步的 `md5sum -c` 就是这一点的验收 [E]；③ 当前 `pnpm-lock.yaml` 已存在，装 devDependency 会改 lockfile，属**状态变更需批准** [D/E]。

**无新依赖的备选（一行，E）**：把 10 个文件整体复制到 `~/.dsh/profiles/web/vendor/dsh-websearch-2.8.4-patched/`，`package.json` 依赖改 `"@240xu/dsh-websearch": "file:./vendor/dsh-websearch-2.8.4-patched"`，并把 `.baseline-20261107-2116/PLUGIN_CHECKSUMS.txt` 一起纳入；**不改 npm 版本、不装新包**，但失去「自动重放」与「diff 可审查」两个好处。

---

## 5. PR 策略（可直接粘贴的建议文本）

### 5.1 结论：PR #7 → **comment 补充**；G1/G3/G4 → **新开 PR**；Issue #8 → **回复验证结果**

**判据 [A/C/D]**：PR #7 仍 `state=open`、`mergeable=true`、最后活动 2026-11-04T10:22、**0 review / 0 comment**（认证 API 21:59 复核）；它已包含 `current()` 与 RFC1918 正则两处，与我们 G2 **重复**（dry-run FAILED 证明）。Issue #8 仍 `state=open`、2 条评论（作者 11-07 05:10「ok了」）、`closed_at=None`、npm 仍 `2.8.8` 无 2.8.9 → **代码未发布**（35-deep-dig-b §1）。⇒ 对已存在的 PR 另开重复 PR 会制造维护负担；对未发布修复的 issue 回复我们的独立验证，能帮助作者确认并关单。

### 5.2 给 PR #7 的 comment 文本（中文，≤10 行，可直接粘贴）

```
感谢这个修复！我们在 DSH 0.2.1-rc.2 上本地应用了本 PR，确认 settings 保存从「无效果」变为生效（health enabled 4→6）。
补充一处：0.2.x 的 describe() 用 entry.options.id 作 ns（实测为 "dsh-websearch"），
本 PR 主匹配 ns==="unified-search" 在 0.2.x 不命中，全靠 shape fallback 兜底；
建议改成先匹配 "dsh-websearch" 再 NAMESPACE 再 shape（我们已验证）。
另附 3 条行为级回归测试（apply() 读 live value / RFC1918 http baseURL / current() 读 describe()），
以及 provider.js 同一正则的 {3}→{2} 已在本 PR 内，无需重复提交。
上游 2.8.8 上我们全套补丁 patch --dry-run 5/5 干净应用，本 PR 合并后可直接对齐。
```

### 5.3 给 Issue #8 的回复文本（中文，≤10 行，可直接粘贴）

```
已在 2.8.4 + DSH 0.2.1-rc.2 复现并验证你给的两处修法，逐字一致：
inject 补 "remote.credentials" 后 remote.credentials.set() 返回 object，保存成功；
writeCredential 判 {ok:false} 包络后，服务端拒绝不再显示「已保存」。
另补两点：readCredential() 也应先判 res.ok===false（否则 ok:false 会回落到
legacy connection 分支拿陈旧值）；属性访问建议 try/catch 包住以兼容旧 host。
本机已跑 18/18 单测 + 真实 web_search 8 Sources。见 PR #7 comment 与本地验证记录。
想确认：这个修复是否计划发 2.8.9？当前 npm latest 仍是 2.8.8（2026-11-07 复核）。
```

### 5.4 新开 PR 的标题/范围建议（G1+G3+G4，基于 `main`=2.8.8）

- 标题：`fix: 0.2.x credential inject & Host header; feat: Firecrawl/TinyFish keyless MCP backends (fixes #8)`
- 范围：`client.js`(G1+G4)、`egress-fetch.js`、`mcp-client.js`、`index.js`(仅 G3 的 9 个登记 hunk)、`provider.js`(**不含** G2 正则，避免与 PR#7 冲突)、2 新 backend、3 新 test。
- **明确不含**：`current()` 与 RFC1918 正则（留给 PR #7）；并在 PR body 写明「依赖/配合 PR #7」。
- **风险注脚**：新 backend keyless 额度未公布（99 裁决 6 标 E）、`skipInitialize` 只用于 TinyFish keyless、exa/parallel 握手零回归。

---

## 6. 回滚与验收命令表（只读给出，未执行升级/回滚）

### 6.1 验收：升级或 PR 合并后，如何确认 10 个补丁仍在

| # | 命令 | 期望 | 等级 |
| --- | --- | --- | --- |
| V1 | `cd ~/.dsh/profiles/web/node_modules/@240xu/dsh-websearch && md5sum -c <(grep -E 'lib/(util/(egress-fetch\|mcp-client)\|index\|client\|provider\|backends/(firecrawl\|tinyfish))\.js\|tests/lead-2026110' /home/ova/dsh/.artifacts/websearch-research/.baseline-20261107-2116/PLUGIN_CHECKSUMS.txt)` | **10/10 OK**（本次实测 10/10 MATCH） | D |
| V2 | `node --test tests/lead-20261106.test.js tests/lead-20261107.test.js tests/lead-20261107-p0.test.js` （在 `src-work/plugin/` 下，其 `node_modules/@deepseek-ai/*` 为测试用软链） | **18/18 pass**（11+3+4） | D |
| V3 | `for f in lib/util/egress-fetch.js lib/util/mcp-client.js lib/index.js lib/client.js lib/provider.js lib/backends/firecrawl.js lib/backends/tinyfish.js; do node --check "$f" \|\| echo FAIL "$f"; done` | 7/7 无 FAIL | D |
| V4 | `grep -n 'remote.credentials' lib/client.js` / `grep -n 'host: headers.host' lib/util/egress-fetch.js` / `grep -n 'settings.describe' lib/index.js` / `grep -n 'skipInitialize' lib/util/mcp-client.js` / `grep -n 'resolveApiKey' lib/backends/{firecrawl,tinyfish}.js` | 各 ≥1 命中（5 个关键不变量） | A/D |
| V5 | 真实 `web_search`（GUI 或 `web_search({queries:[...]})`），看 `result.content` 的遥测行 | 至少 1 个 `✓` + Sources；25 §12.5 实跑为 `exa ✓12897ms/8 · tinyfish ✓13596ms/3 · parallel ✓13604ms/8` | D |
| V6 | `curl -sS -H 'Host: 127.0.0.1:3080' http://127.0.0.1:3080/api/unified-search/health` （带 GUI 会话 cookie 才过 fence；否则 `untrusted request` 属预期） | `health enabled=6`（含 firecrawl/tinyfish） | D |
| V7 | `node -p "require('…/@240xu/dsh-websearch/package.json').version"` + `node -v` | `2.8.4`（或升级后的目标版本）+ Node ≥ 目标 engines | D |
| V8 | 若走 patch-package：`ls patches/@240xu+dsh-websearch+2.8.4.patch` + `grep -c '^diff --git' patches/*.patch` | 1 个文件、≥10 个 `diff --git` 段（5 改 + 5 增） | E（未执行） |

### 6.2 回滚（25 §6 原链，补 §12 的 provider.js/测试；**需用户批准**）

```bash
P=/home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch
B=/home/ova/dsh/.artifacts/websearch-research/src-work/backups
for f in egress-fetch.js mcp-client.js index.js client.js provider.js; do
  case $f in egress-fetch.js|mcp-client.js) cp "$B/$f.orig" "$P/lib/util/$f";; *) cp "$B/$f.orig" "$P/lib/$f";; esac
done
rm -f "$P/lib/backends/firecrawl.js" "$P/lib/backends/tinyfish.js" \
      "$P/tests/lead-20261106.test.js" "$P/tests/lead-20261107.test.js" "$P/tests/lead-20261107-p0.test.js"
# 逐文件 md5 校验（期望每对相同）+ 5 个新文件 test ! -e
```
> **注意**：25 §12.4 明确**驳回**「回滚包含 profile `cordis.patch.yml`」——那里的差异是模型配置演进，误还原会删用户模型配置 [A/B]。systemd drop-in 的移除需经 `sshpass -e ssh ova@127.0.0.1 'sudo -n …'` 免密通道（25 §6 第 3 步），本轮未执行。

---

## 7. A/B/C/D/E 与永久链接索引

| 用途 | 永久链接 / 路径 | 等级 |
| --- | --- | --- |
| 2.8.8 `client.js`（仍缺 inject） | [`blob/main/lib/client.js#L649`](https://github.com/240xu/dsh-websearch/blob/main/lib/client.js#L649)（= npm 2.8.8，`gitHead=da42e44a0f54`） | A/C |
| 2.8.8 `egress-fetch.js`（仍删 Host） | [`blob/main/lib/util/egress-fetch.js#L404`](https://github.com/240xu/dsh-websearch/blob/main/lib/util/egress-fetch.js#L404) | A |
| PR #7 head（`current()` + 正则已存在） | [`blob/bcb24b1efbb4/lib/index.js#L422-L438`](https://github.com/240xu/dsh-websearch/blob/bcb24b1efbb4/lib/index.js#L422-L438)、[`blob/bcb24b1efbb4/lib/provider.js#L327`](https://github.com/240xu/dsh-websearch/blob/bcb24b1efbb4/lib/provider.js#L327) | A |
| Issue #8（建议修法原文） | [`issues/8`](https://github.com/240xu/dsh-websearch/issues/8)（2026-11-07 访问，2 评论，state=open） | B/D |
| 官方 DSH breaking guides | [`v0.2.2-alpha.2/web-search-default-provider/guide.md`](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/upgrade-guide/v0.2.2-alpha.2/web-search-default-provider/guide.md)、[`…/web-search-credential-modes/guide.md`](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/upgrade-guide/v0.2.2-alpha.2/web-search-credential-modes/guide.md)、[`v0.2.1-rc.3/web-search-defaults/guide.md`](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/upgrade-guide/v0.2.1-rc.3/web-search-defaults/guide.md)（raw 200，逐字） | B |
| OpenCode v2 新 backend 依据 | [`blob/v2.2.5/packages/core/src/plugin/websearch/firecrawl.ts`](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/firecrawl.ts)、[`…/tinyfish.ts`](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/tinyfish.ts) | A/B |
| 本机 10 文件权威原文 | `src-work/plugin/lib/**`、`src-work/plugin/tests/lead-2026110*.test.js`；改前原文 `src-work/backups/*.orig` | A |
| md5 基线 | `.baseline-20261107-2116/PLUGIN_CHECKSUMS.txt`（32 行，10/10 MATCH 实测） | D |
| diff 与 dry-run 产物（**临时，非交付**） | `/tmp/off44/diff-{egress-fetch,mcp-client,index,client,provider}.js.txt`、`/tmp/off44/{base288,base7}/`、`/tmp/off44/p*.out` | D |
| 上游动态/版本事实 | `registry.npmjs.org/@240xu%2fdsh-websearch`（latest 2.8.8，23 版本，无 2.8.9）、`@deepseek-ai%2fdsh`（latest 0.2.2-rc.1）、认证 `GET /issues/8`、`/pulls/7`（2026-11-07 21:59 复核） | C/D |

**仍 E（不得当结论）**：① patch-package 的 `pnpm` 根包 postinstall 是否执行、生成补丁是否恰好 10 段，均**未执行**（需用户批准）；② 官方 DSH 升级后与 `unified` provider 的组合树实测、`DEEPSEEK_BASE_URL` 串台风险；③ Firecrawl keyless 每日上限（99 裁决 6 已标 E）；④ 作者 11-07「ok了」对应的本地提交内容（未推公开 ref）；⑤ PR 提交后作者是否接受新 backend（产品取舍）。

---

## 8. 时效复核（2026-11-07 22:5x，收尾）

对最易漂移的 4 个事实做只读复核（与 21:59 采样一致）：Issue #8 `open`/2 评论/`updated 2026-11-07T05:10:52Z`；PR #7 `open`/`mergeable=true`/`updated 2026-11-04T10:22:28Z`；npm `@240xu/dsh-websearch` `latest=2.8.8`、**23 版本无 2.8.9+**；`@deepseek-ai/dsh` `latest=0.2.2-rc.1`。⇒ §5 的 PR 策略与 §4 的「不升级」结论仍为当前事实 [C/D]。

---

*报告完。唯一写文件为本报告；全程只读，未改源码/配置/其它报告，未执行 install/升级/重启，未操作任务板，token 值未出现在任何输出。全部 diff 为 `diff -u` 只读生成并嵌入 Markdown，未写入仓库。*
