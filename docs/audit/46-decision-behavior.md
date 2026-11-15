# 46 · 专家组决断：4 项行为改动（go / no-go / 条件-go）

> 2026-11-08 17:10–17:45 (+08:00)，子代理 `runtime-state`（Bug 组 A → 决断组 A / task-24）。
> **唯一写文件**：本文件。未改任何源码/配置/其它报告/运行时；未操作任务板。全程只读源码 + 只读 curl + `/tmp` 内存副本验证 + `node --test` 只读跑测；未 apply 任何 diff。
> **性质**：本报告是**裁决**（结论先行），不是复审报告。每项给 go / no-go / 条件-go + 理由 + 风险 + 验收 + 回滚 + 可 apply diff + 回归断言。
> **等级**：A=源码实证（路径:行号）、B=官方文档、C=版本记录、D=本机实测、E=推断/待核实。四联=`结论 → 依据 → 代码落点 → 验证`。
> **基线**：`.baseline-20261108-0922/`；服务 PID 2334（STARTED `Sun Nov 8 12:40:49 2026`，命令行未变，GUI 401）；17 文件改进已生效；`node --test tests/*.test.js` 实测 **25/25 pass**；本报告结束时 6 个关键文件 md5 与基线一致（见 §5）。

---

## 0. 决断总表（结论先行）

| # | 项目 | **裁决** | 一句话理由 | 是否需改运行时 |
| --- | --- | --- | --- | --- |
| 1 | **M-1** exa/parallel/firecrawl 加 `skipInitialize:true` | **条件-go** | 官方契约 + 裸 `tools/call` 实测 200 有真实结果，但**改变当前已验证成功的网络路径**（Lead 明令「改动后必须仍成功」），须先过「加 skip + 实跑 4 后端仍 ✓」前置验收再合入 | 是（3 个 backend 文件 + `mcp-client.js` JSDoc/id），不需重启 |
| 2 | **M-3** keyed tinyfish `forceFreshSession` | **go** | 缺陷已行为级复现（换 key 复用 `SID-1`），修法已验证修复（2 次 initialize、`SID-1`/`SID-2`），且**保留现有测试锚点**、keyless 路径零触碰 | 是（`tinyfish.js` + `mcp-client.js`），不需重启 |
| 3 | **429 熔断语义**（全冷却快速失败） | **条件-go**（且建议**拆分**：3a / 3b 均条件-go，3b 更严） | 「全冷却快速失败」改变模型可见错误文本与后端选择，属执行语义；且 `retry-after` 在本实现**取不到**（41号 E-3），429 分类只靠文案正则、可靠性存疑 | 是（`breaker.js` + `provider.js` + 新 util），不需重启 |
| 4 | **readErrors UI 提示** | **条件-go** | 只读诊断、不改保存语义，**但 41 号原 diff 实测打破现有 25 测试中的 1 条**（删掉 `readFailed` 后 4 条源码断言失效）；须改为「保留 `readFailed` 变量名」的兼容 diff 才 go | 是（`client.js` 一个文件 + i18n 双语），不需重启 |

**总原则执行说明**：决断原则 ②「会改变当前已验证成功的网络/执行路径的，若证据不足判条件-go 或 no-go」→ M-1 与 429 均落此条；原则 ①「低风险、可独立验证、可回滚」→ M-3 满足，故唯一直接 go。无一项判 no-go（4 项都有可行修法），但 3 项带硬前置。

---

## 1. M-1 — exa/parallel/firecrawl `skipInitialize:true`

### 裁决：**条件-go**

### 结论 → 依据 → 落点 → 验证（四联）
- **结论**：可以对齐官方，但**不得直接合入**；须以「加 skip + 真实 `web_search` 复跑 4 后端仍 ✓」为前置验收，且**同步**改写 `mcp-client.js` 的 JSDoc 与 `callBody.id`（Lead 补充两点）。
- **依据** [A/B/C]：
  - Lead 独立取证 [A]：官方 `v2.2.6 packages/core/src/plugin/websearch/mcp.ts` 的 `call()` **只发单个 `tools/call`（`id:1`），无 initialize / 无 `Mcp-Session-Id`**；`exa.ts` / `parallel.ts` 直接 `WebSearchMcp.call(...)`。42号 §逐项对齐表 #9、§3 D-1 同结论 [A/C]。
  - 现状 [A]：`exa.js:62` / `parallel.js:50` / `firecrawl.js:71-77` 的 `mcpCall(...)` **均未传第 6 参 options** → 全走 `mcp-client.js:162` 的默认 3 步（initialize → notifications/initialized → tools/call），`sessionCache` URL 键 10min TTL（`:16,25,99`）。
  - `tinyfish.js:76` 已传 `{skipInitialize: !keyed}` → 该分支**已有生产先例** [A]。
- **代码落点** [A]：`lib/backends/exa.js:62`、`lib/backends/parallel.js:50`、`lib/backends/firecrawl.js:71-77`、`lib/util/mcp-client.js:151-156`（JSDoc）、`:164-169`（`callBody.id`）。
- **验证** [D]（本轮实跑，全部只读）：

| 实验 | 结果 | 命令 |
| --- | --- | --- |
| 裸 `tools/call`（无 initialize / 无 SID）→ exa | **HTTP 200**，`event: message` + 真实 `Title:/URL:/Highlights:` 结果 | `curl -X POST https://mcp.exa.ai/mcp -d '{"jsonrpc":"2.0","id":2,"method":"tools/call",…}'` |
| 同上 → parallel | **HTTP 200**，`{"id":2,"result":{"content":[{"text":"{\"search_id\":…,\"results\":[…]}"}]}}` | 同上（parallel 端点） |
| 同上 → firecrawl | **HTTP 200** 但 `isError:true`「Anonymous keyless access is unavailable」——**与当前 3 步路径同样的配额失败，非回归** | 同上（firecrawl 端点） |
| `id:2` → `id:1`（Lead 要求对齐官方）→ exa / parallel | **均 HTTP 200**，结果结构相同 | 同上改 `"id":1` |
| 3 步 vs skip 延迟（standalone `mcpCall`，同一进程） | exa **10607ms → 3520ms**；parallel **8602ms → 5579ms** | `node --input-type=module` import `/tmp` 副本（stub `WebError`） |
| `skipInitialize` 的 POST 计数（fake MCP server） | `[{"method":"tools/call","id":2}]` → **恰好 1 次 POST**、无 `initialize`、无 SID；默认路径 = `["initialize","notifications/initialized","tools/call"]` | `/tmp` fake server + `mcpCall` |
| 当前真实 `web_search`（PID 2334） | `exa ✓3725ms/8 · parallel ✓4724ms/8 · tinyfish ✓5811ms/4 · ddg ✗(aborted) · searxng ✗ · firecrawl ✗(Anonymo)` | 本会话 `web_search` 实跑 |

⇒ **裸 `tools/call` 在 exa/parallel 上确实可用且更快**；但 Lead 的背景事实强调「当前真实运行态 exa ✓/8 · parallel ✓/8 · tinyfish ✓/8 · ddg ✓/8」是**3 步路径下的成功**，跳过握手是**网络路径变更**，必须以实跑复验收口，故不直接 go。

### 风险（必须写进 PR）
1. **R1（中）**：`mcp-client.js:191-196` 的 401/403/404「失效 session 后重试一次」**只在 `sessionId` 存在时触发**；skip 后该兜底消失。若 exa/parallel 未来改为要求 session，会直接失败而无自愈。缓释：验收里加一次「mock 401 → 不重试、fail loud」断言。
2. **R2（低）**：`firecrawl` 的 keyless tier 当前本就 `isError:true`（配额），skip 后仍是同样失败，**无新增风险**；但 42号 M-2（limit 改 8）若与 M-1 同批合入，变量不隔离，建议拆开。
3. **R3（文档矛盾，Lead 点名）**：`mcp-client.js:151-156` JSDoc 现写「Set `skipInitialize: true` for stateless MCP servers whose keyless tier rejects an initialize round-trip (TinyFish keyless)… **passing this option for [keyed sessions] is wrong**」。给 exa/parallel（非 TinyFish、非 keyless-tier-reject）加 skip 后，该描述与实现冲突 → **必须同步改写**。
4. **R4（E）**：官方 `id:1` 与我们 `id:2` 在 JSON-RPC 语义上等价（响应按 id 回显），对齐是为「更稳」而非必需；本轮已实测 `id:1` 两端 200。

### 可 apply 的 diff（**未 apply**；含 Lead 两点补充）

```diff
--- a/lib/backends/exa.js
+++ b/lib/backends/exa.js
@@ -60,7 +60,11 @@
     let result;
     try {
-      result = await mcpCall(EXA_ENDPOINT, EXA_TOOL, args, {}, signal);
+      // OpenCode v2.2.6 mcp.ts:28-68 sends a single tools/call (id:1) for Exa.
+      // Exa's public MCP endpoint is stateless; the 3-step handshake only
+      // adds two RTTs (31-adversarial: ~16s tail). Verified 200 with real
+      // results on 2026-11-08. Tinyfish keyless already uses this option.
+      result = await mcpCall(EXA_ENDPOINT, EXA_TOOL, args, {}, signal, {
+        skipInitialize: true,
+      });
     } catch (err) {
```

```diff
--- a/lib/backends/parallel.js
+++ b/lib/backends/parallel.js
@@ -47,7 +47,10 @@
     let result;
     try {
-      result = await mcpCall(PARALLEL_ENDPOINT, PARALLEL_TOOL, args, {}, signal);
+      // v2.2.6 parallel.ts:62-75: bare tools/call, no initialize/Session-Id.
+      result = await mcpCall(PARALLEL_ENDPOINT, PARALLEL_TOOL, args, {}, signal, {
+        skipInitialize: true,
+      });
     } catch (err) {
```

```diff
--- a/lib/backends/firecrawl.js
+++ b/lib/backends/firecrawl.js
@@ -71,6 +71,7 @@
         args,
         extraHeaders,
         signal,
+        { skipInitialize: true },
       );
```

```diff
--- a/lib/util/mcp-client.js
+++ b/lib/util/mcp-client.js
@@ -148,13 +148,15 @@
  * @param {{ skipInitialize?: boolean }} [options] - Per-call transport options.
- *   Set `skipInitialize: true` for stateless MCP servers whose keyless tier
- *   rejects an `initialize` round-trip (TinyFish keyless). Keyed sessions
- *   still use the full initialize -> notifications/initialized -> tools/call
- *   handshake with `Mcp-Session-Id`; passing this option for them is wrong.
- *   OpenCode v2.2.5 `tinyfish.ts:78` documents the same split.
+ *   Set `skipInitialize: true` for stateLESS MCP endpoints that accept a bare
+ *   `tools/call`: TinyFish keyless, and (per OpenCode v2.2.6 mcp.ts:28-68)
+ *   Exa / Parallel / Firecrawl. StateFUL endpoints (TinyFish with an API key)
+ *   MUST keep the full initialize -> notifications/initialized -> tools/call
+ *   handshake with `Mcp-Session-Id`; passing this option for them is wrong.
+ *   `forceFreshSession` (see M-3) forces a fresh handshake for keyed calls.
@@ -164,7 +166,7 @@
   const callBody = {
     jsonrpc: "2.0",
-    id: 2, // increment from initialize(1)
+    id: 1, // OpenCode v2.2.6 mcp.ts:bare tools/call; JSON-RPC id is arbitrary
     method: "tools/call",
```

> **注意**：`id` 改为 1 后，3 步路径的 initialize 也用 `id:1`（`mcp-client.js:34`），两个请求 id 相同但方法不同，`parseEnvelope(text, callBody.id)`（`:223`）按 id 匹配响应——**同 id 不会串包**，因为 initialize 与 tools/call 是分开的两次 `egressFetch`、各自解析自己的响应。已实测 3 步路径仍可用（上面 timing 表）。

### 前置验收（**条件-go 的硬门槛，缺一不可**）
1. **真实端点各跑一次 200**：exa / parallel 裸 `tools/call` 返回非空 `result.content[0].text`（本轮已过，合入当天需重跑一次）。
2. **真实 `web_search` 4 后端仍 ✓**：应用 diff、刷新客户端/host bundle 后跑一次 `web_search`，断言遥测含 `exa ✓` `parallel ✓` `tinyfish ✓` `ddg ✓`（或至少 exa/parallel/tinyfish 三者 ✓ 且 sources ≥ 8）。**这正是 Lead 要求的「改动后必须仍成功」**。
3. **`node --test tests/*.test.js` 25/25**（`lead-20261106.test.js:113` 断言 `options.skipInitialize ? undefined : await ensureSession` 必须保留——M-1 不动该行，天然满足）。
4. 新增行为级断言（见下）。

### 回归断言（新增，建议 `tests/m1-single-post.test.js`）
1. mock `egressFetch`，`exaBackend.search` → **恰好 1 次 POST**、body `method:"tools/call"`、**无 `method:"initialize"`**、headers 无 `Mcp-Session-Id`。
2. 同断言 parallel / firecrawl（3 个 backend 各 1 条）。
3. `callBody.id === 1`（source-level 或 fake server 捕获）。
4. 真实或录制的 `tools/call` 响应仍能走 `parseEnvelope` → `parseExaResult` / `parseParallelResult` 产出 ≥1 source。
5. mock 401 → **不进入** `invalidateSession` 重试分支（R1 显式钉住）。
6. 反向：tinyfish **keyed** 仍走 3 步（防误把 skip 扩散到 stateful 路径）。

### 回滚
```bash
# 单文件回滚（去掉三处 options 参数 + 恢复 JSDoc/id），或整文件回滚到基线：
cp .baseline-20261108-0922/../src-work/backups/<对应 .orig> src-work/plugin/lib/backends/exa.js   # 或
git -C /home/ova/dsh checkout -- <path>   # 若已在 git 管控下
# 更精确：把三处 `, { skipInitialize: true }` 删除；mcp-client.js 恢复 id:2 与旧 JSDoc。
# 验证回滚：node --test tests/*.test.js → 25/25；真实 web_search 恢复 3 步（exa/parallel 仍 ✓）。
```
**回滚成本**：4 个文件、纯参数增删，无状态模型改动，秒级。**风险可控**。

---

## 2. M-3 — keyed tinyfish `forceFreshSession`

### 裁决：**go**（唯一直接 go）

### 四联
- **结论**：合入。缺陷真实、修法最小、keyless 零触碰、现有测试锚点保全、可独立验证与回滚。
- **依据** [A/C]：官方 `v2.2.6 tinyfish.ts:65` **keyed 每次 `execute()` 重新 initialize**（无缓存、无 TTL），注释「Keyed requests are rejected without the `Mcp-Session-Id` returned by initialize; keyless ones are not.」（42号 #11、tinyfish.js:9-11 已抄录）。我方 `mcp-client.js:16,25,99` 的 `sessionCache` 以 **URL 单键 + 10min TTL** 缓存 → 换 `TINYFISH_API_KEY` 后复用旧 SID。
- **代码落点** [A]：`lib/backends/tinyfish.js:74-77`、`lib/util/mcp-client.js:23,27,162`。
- **验证** [D]（本轮行为级复现，fake MCP server，无真实密钥）：

| 场景 | `initialize` 次数 | tools/call 的 SID |
| --- | --- | --- |
| 现状：同 URL、`KEY_A` → `KEY_B`（模拟轮换） | **1**（缓存命中） | `SID-1` + `KEY_A`、**`SID-1` + `KEY_B`**（旧 SID 串到新 key） |
| 应用 `forceFreshSession:true` 后 | **2** | `SID-1`+`KEY_A`、**`SID-2`+`KEY_B`** ✅ |

且 `mcp-client.js` 的现有测试锚点 `options.skipInitialize ? undefined : await ensureSession` **仍匹配**（本轮 `grep -c` = 1）→ **25 测试不破**。

### 风险
1. **R1（低）**：每次 keyed 调用多 2 次 RTT（initialize + notifications/initialized）。但官方就是这么做的，且**keyed 路径默认关闭**（`enableTinyfish` 用户可选、`TINYFISH_API_KEY` 未配置），当前运行态 tinyfish 是 **keyless**（`tinyfish ✓/4`），**不受影响**。
2. **R2（低）**：`forceFreshSession` 只传布尔，**绝不把 key 写进 cache key / headers / log**（`hooks.recordRequest` 的 `headers:{}` 已清空，42号 §4 安全约束）。本轮 fake server 断言 `KEY_A`/`KEY_B` 仅出现在请求头、未出现在任何日志输出。
3. **R3（E）**：并发两次 keyed 调用会各自 initialize，产生 2 个 SID，各自用于自己的 tools/call——这是**正确**的（官方逐调用语义），不是竞态缺陷。
4. **keyless 零回归论证**：`tinyfish.js:76` 传 `{ skipInitialize: !keyed, forceFreshSession: keyed }`。keyless 时 `keyed=false` → `skipInitialize=true`（`mcp-client.js:162` 短路，**`ensureSession` 根本不被调用**）→ `forceFreshSession=false` 完全不生效；**keyless 路径字节级不变**。

### 可 apply 的 diff（**未 apply**）

```diff
--- a/lib/backends/tinyfish.js
+++ b/lib/backends/tinyfish.js
@@ -73,8 +73,12 @@
         extraHeaders,
         signal,
-        // Keyless is stateless: skip initialize. Keyed keeps the full
-        // 3-step handshake with Mcp-Session-Id (mcpCall default).
-        { skipInitialize: !keyed },
+        // v2.2.6 tinyfish.ts:65 initializes on EVERY keyed execute and uses
+        // the returned Mcp-Session-Id only for that call. Our shared
+        // sessionCache is URL-keyed with a 10min TTL (mcp-client.js:16,25),
+        // so a rotated TINYFISH_API_KEY would reuse a stale Session-Id.
+        // forceFreshSession makes ensureSession bypass the cache for keyed.
+        { skipInitialize: !keyed, forceFreshSession: keyed },
       );
```

```diff
--- a/lib/util/mcp-client.js
+++ b/lib/util/mcp-client.js
@@ -20,10 +20,11 @@
-async function ensureSession(url, signal) {
+async function ensureSession(url, signal, options = {}) {
   const now = Date.now();
   const cached = sessionCache.get(url);
-  if (cached && (now - cached.initializedAt) < SESSION_TTL_MS) {
+
+  if (!options.forceFreshSession && cached && (now - cached.initializedAt) < SESSION_TTL_MS) {
     return cached.sessionId;
   }
@@ -159,7 +160,9 @@
 export async function mcpCall(url, toolName, args, extraHeaders = {}, signal, options = {}) {
   // The session handshake is the default; stateless keyless servers accept a
   // direct tools/call and skip it.
-  const sessionId = options.skipInitialize ? undefined : await ensureSession(url, signal);
+  const sessionId = options.skipInitialize ? undefined : await ensureSession(url, signal, { forceFreshSession: options.forceFreshSession === true });
```

> **关键约束**：保持 `const sessionId = options.skipInitialize ? undefined : await ensureSession(` 这一行**前缀逐字不变**——`lead-20261106.test.js:113` 硬断言该正则。上面 diff 已遵守（只在 `ensureSession(...)` 内加参数）。
> **JSDoc 同步**：若与 M-1 同批，M-1 的 `mcp-client.js:151-156` JSDoc 改写已把 `forceFreshSession` 写进去（见 §1 diff 末行），两处不冲突。

### 验收
1. 新增单测：同 URL、两次不同 key → `initialize` 2 次、第二次 `tools/call` 带**新的** `Mcp-Session-Id`；断言任何 log / `recordRequest` 中**无 key 值**。
2. keyless 路径：`skipInitialize:true` 时 `ensureSession` 调用次数 = 0（spy），POST 恰好 1 次。
3. `node --test tests/*.test.js` → **25/25**（本轮已验证锚点兼容）。
4. 真实 keyless `web_search` 仍 `tinyfish ✓`（本轮基线 `tinyfish ✓5811ms/4`）。

### 回滚
```bash
# 去掉 tinyfish.js 的 forceFreshSession: keyed；mcp-client.js 恢复 ensureSession(url, signal)
# 与 !options.forceFreshSession 条件、sessionId 行恢复原样。
# 验证：25/25 + tinyfish keyless 仍 ✓
```
**回滚成本**：2 文件、纯参数，秒级。

---

## 3. 429 熔断语义（41号点4）

### 裁决：**条件-go**（并建议**拆成 3a / 3b 两批**）

| 子项 | 裁决 | 理由 |
| --- | --- | --- |
| **3a** `rateLimited` 分类 + 1 次 429 立即冷却（改 `breaker.js`） | **条件-go** | 纯函数新增可选参数，不改既有默认值路径；但分类器**只靠文案正则**（`HTTP 429\|rate.?limit\|429\|Anonymo\|quota\|额度`），真实 429 字符串能否命中需先钉测试 |
| **3b** 全冷却时从 fail-open 改「快速失败」（改 `provider.js:292`） | **条件-go（更严）** | **改变执行语义与模型可见错误文本**（41号 §4 明标「是行为改动 → 需用户批准」）；且 `retry-after` 在本实现取不到（41号 E-3），退化为 60s 兜底 |

### 四联
- **结论**：不整体 no-go（缺陷真实：41号实测 `search#4 429 → 仍然实际发起请求（failCount=4）`），但**必须**：①先做 3a 并用真实错误串钉住分类器；②3b 单独一批、附「用户已批准行为变更」记录；③**不做** 41号 Step B 官方式 provider 轮转（与 DSH 扇出语义冲突，41号已标 E/不建议）。
- **依据** [A/B/D]：官方 `v2.2.5 core/src/websearch.ts:197-216`（1 次 429 即按 `Retry-After` 冷却、`:215` 全冷却 `return yield* cooldown.error` 快速失败）；我方 `provider.js:283-293` `else cooled.clear(); // all cooled -> fail-open`；`breaker.js:29-45` `foldBreaker` 对任何失败一视同仁、3 次才冷却。
- **代码落点** [A]：`lib/breaker.js:29`、`lib/provider.js:62-70`（`recordBackendHealth`）、`:341-346`（失败分支）、`:283-293`（fail-open）、新 `lib/util/failure-label.js`（41号建议，当前**不存在**，已 `ls` 确认）。
- **验证** [D/E]：
  - 41号 `/tmp/adv-breaker.mjs` 实证 fail-open（C 级引用，本轮未重跑）。
  - 本轮 `grep` 确认真实错误串来源：`mcp-client.js:218` 抛 `MCP tools/call HTTP ${response.status}: …` → **含 `HTTP 429` 字样，正则可命中**；`firecrawl.js:86` 抛 `firecrawl returned an MCP error: Anonymous keyless access is unavailable…` → **`Anonymo` 正则可命中**；`searxng.js:81` 对 `status===429` 另抛错。⇒ 3a 分类器在本实现**主要是可靠的**（比 41号 E-3 担心的乐观）。
  - **但** 41号 E-3 仍成立：`retry-after` 响应头**不进 `WebError.cause`**（`mcp-client.js` 抛的是文本错误，`egress-fetch.js` 的 `Response` 头未透传）→ `retryAfterMsFrom(err)` 实测退化 60s。本轮 `grep` 确认无 `retryAfter` 字段携带。⇒ 3b 的「按 Retry-After 冷却」**名不副实**，只能做到「按 60s 兜底冷却」，需在 PR 文案里如实说明，不得宣称已对齐官方。

### 风险（**最高的一项**）
1. **R1（高）**：3b 把「全冷却时放行全部」改为**抛 `WEB_PROVIDER_ERROR`** → 模型看到的错误文本从「各后端失败原因」变成固定 `all backends are rate-limited; retry after cooldown`，**改变零结果/全失败时的模型输入**。41号 §7 明标需用户批准。
2. **R2（中）**：`cooled` 表里 `rateLimited` 标记需要先写进 `latestBackendHealth`（`provider.js:62-70` 当前只存 `failCount`/`cooledUntil`，**没有该字段**）→ 41号 diff 里 `[...cooled.values()].every(e => e?.rateLimited === true)` **在当前代码上恒为 false**，即 3b 的「快速失败」分支**永远不会触发**。必须同步给 `recordBackendHealth` 加字段，否则是死代码。这是我本轮发现的 41号 diff 的一处**实现缺口**。
3. **R3（中）**：`cooled.clear()` 保留给「非配额故障」→ 若一次扇出里**既有 429 又有 403**，`.every(rateLimited)` 为 false → 仍 fail-open 打 429 端点。语义上「部分配额故障」未覆盖，需明确写进验收边界（不改，标 E）。
4. **R4（低）**：新增 `rateLimited()` util 与 `foldBreaker` 第 5 参，纯函数、默认 `opts={}` → 现有 25 测试对 `breaker.js` **零断言**（本轮 `grep` 确认），不会破测试。

### 可 apply 的 diff（**未 apply**；修正 41号 R2 缺口）

```diff
--- a/lib/util/failure-label.js   (新文件)
+++ b/lib/util/failure-label.js
+/** Classify quota/rate-limit failures from a WebError's message (no headers). */
+export function rateLimited(err) {
+  const s = String(err?.message ?? err);
+  return /HTTP 429|rate.?limit|429\b/i.test(s) || /Anonymo|quota|额度/i.test(s);
+}
+export function retryAfterMsFrom(err) {
+  const v = err?.cause?.response?.headers?.get?.("retry-after") ?? err?.retryAfter;
+  if (v == null || String(v).trim() === "") return 60_000;   // E-3: headers do not reach WebError
+  const secs = Number(v);
+  if (Number.isFinite(secs)) return secs >= 0 ? secs * 1000 : 60_000;
+  const date = Date.parse(v);
+  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 60_000;
+}
```

```diff
--- a/lib/breaker.js
+++ b/lib/breaker.js
@@ -26,7 +26,7 @@
-export function foldBreaker(prev, ok, nowMs, cfg = {}) {
+export function foldBreaker(prev, ok, nowMs, cfg = {}, opts = {}) {
@@ -37,6 +37,12 @@
   if (ok) return { failCount: 0, cooledUntil: 0 };
+  if (opts.rateLimited === true) {
+    const retryAfterMs = Number.isFinite(opts.retryAfterMs) ? opts.retryAfterMs : BREAKER_DEFAULTS.cooldownMs;
+    return { failCount: (Number.isFinite(prev?.failCount) ? prev.failCount : 0) + 1,
+             cooledUntil: nowMs + Math.max(0, retryAfterMs) };
+  }
   const failCount = (Number.isFinite(prev?.failCount) ? prev.failCount : 0) + 1;
```

```diff
--- a/lib/provider.js
+++ b/lib/provider.js
@@ -59,9 +59,12 @@
-function recordBackendHealth(id, entry, breakerCfg) {
+import { rateLimited, retryAfterMsFrom } from "./util/failure-label.js";
+
+function recordBackendHealth(id, entry, breakerCfg, opts = {}) {
   const prev = latestBackendHealth.get(id);
-  const breaker = foldBreaker(prev, entry.ok === true, entry.at, breakerCfg ?? undefined);
+  const breaker = foldBreaker(prev, entry.ok === true, entry.at, breakerCfg ?? undefined, opts);
   latestBackendHealth.set(id, {
     ...entry,
     lastOkAt: entry.ok === true ? entry.at : (prev && prev.lastOkAt) || null,
     failCount: breaker.failCount,
     cooledUntil: breaker.cooledUntil,
+    rateLimited: opts.rateLimited === true,          // ← 修正 41号 diff 的 R2 缺口
   });
 }
@@ -343,7 +346,8 @@
               (err) => {
                 const msg = String(err instanceof Error ? err.message : err).slice(0, 80);
                 telemetry.push({ id, ok: false, ms: Date.now() - startedAtMs, error: msg });
-                recordBackendHealth(id, { ok: false, at: Date.now(), ms: Date.now() - startedAtMs, error: msg }, breakerCfg);
+                recordBackendHealth(id, { ok: false, at: Date.now(), ms: Date.now() - startedAtMs, error: msg },
+                  breakerCfg, { rateLimited: rateLimited(err), retryAfterMs: retryAfterMsFrom(err) });
                 throw err;
               },
@@ -290,7 +294,13 @@
-        if (active.length > 0) eligible = active;
-        else cooled.clear(); // all cooled -> fail-open
+        if (active.length > 0) eligible = active;
+        else if (cooled.size > 0 && [...cooled.values()].every((e) => e?.rateLimited === true)) {
+          // 3b: all cooled due to quota → fast-fail (BEHAVIOUR CHANGE, user-approved).
+          throw new WebError("unified search: all backends are rate-limited; retry after cooldown", "WEB_PROVIDER_ERROR");
+        } else {
+          cooled.clear();   // non-quota failures keep the existing fail-open
+        }
```

> **相对 41 号原文的两处修正**：① `recordBackendHealth` 必须把 `rateLimited` 存进 health entry，否则 3b 的 `.every()` 恒 false（R2）；② `foldBreaker` 第 5 参 `opts` 需由 `recordBackendHealth` 透传（41号 diff 漏了这一跳）。

### 前置验收（条件-go 硬门槛）
1. **用户批准记录**：3b 改变模型可见错误文本，须有「用户已批准行为变更」的明确记录（41号 §7 要求）。**这是 3b 的前置，不是可选项**。
2. 单测：`foldBreaker` 1 次 429 立即冷却 / 非 429 仍 3 次 / 成功清零；`rateLimited()` 对 `MCP tools/call HTTP 429: …`、`firecrawl returned an MCP error: Anonymous…`、`SearXNG: invalid JSON response`（**不应命中**）逐一钉住。
3. 行为级：单计量后端连续 4 次 429 → 第 4 次**不再发起请求**（断言 fake backend `search` 调用次数 = 3）；全冷却时返回 `WEB_PROVIDER_ERROR`（非 `all enabled backends failed`）。
4. 非配额全冷却（403 ×3）→ **仍 fail-open**（保持既有语义），断言第 4 次仍发起请求。
5. 混合 429+403 → 明确记录为 E 边界，不断言快速失败。
6. `node --test tests/*.test.js` → 25/25（新增测试另计）。
7. **PR 文案必须写明**：`Retry-After` 实际取不到、退化为 60s 兜底，不得声称已完整对齐 v2.2.5。

### 回滚
```bash
# 删除 lib/util/failure-label.js；breaker.js 恢复 4 参签名、删 opts 分支；
# provider.js 恢复 recordBackendHealth 3 参、:292 恢复 cooled.clear() 单行。
# 验证：25/25 + 单后端 4 次 429 时第 4 次仍发起（恢复 fail-open 基线）。
```
**回滚成本**：3 文件 + 1 新文件删除，中等；但**语义回滚后配额消耗恢复**，需知会用户。

---

## 4. readErrors UI 提示（41号点3）

### 裁决：**条件-go**（41号原 diff **不得直接 apply**）

### 四联
- **结论**：目标（只读诊断 + UI 可见）值得做，但**41号 §3 的原 diff 会打破现有 25 测试中的 1 条**，须改为「保留 `readFailed` 变量名」的兼容版才 go。
- **依据** [A/D]：`client.js:379` `let readFailed = false;`、`:394` `readFailed = true;`、`:401`、`:406`、`:410` `this.republish();`、`:409` `} catch { /* ignore */ }`。41号 diff 把 `readFailed` 全删、改 `reason`，并新增 `readErrors` Map / i18n key / UI 行 / `finally`。
- **代码落点** [A]：`lib/client.js:285-287`（构造）、`:303-324`（projection）、`:378-410`（readCredential）、`:90/:110` 与 `:145/:168`（zh/en 字典）、`:573/:760`（徽章旁 UI）。
- **验证** [D]（**决定性，本轮实跑**）：把 41号原 diff 应用到 `/tmp` 副本并跑 `node --test`：

```
1..25
# tests 25
# pass 24
# fail 1
```
失败原因：`lead-20261106.test.js:207-210` **硬断言** 4 条源码正则：
```
assert.match(src, /let readFailed = false;/);
assert.match(src, /if \(res !== null && typeof res === "object" && res\.ok === false\) \{\s*readFailed = true;/);
assert.match(src, /if \(!readFailed && view === undefined && this\.connection/);
assert.match(src, /if \(!readFailed && view !== undefined\)/);
```
41号 diff 移除 `readFailed` → 这 4 条全失效 → **测试从 25/25 掉到 24/25**。⇒ 要么改测试（超出「不改状态模型/最小改动」原则，且会动别人的测试文件，与本轮硬约束冲突），要么**保留变量名**。选后者。

### 风险
1. **R1（中，已实证）**：如上，原 diff 破测试。**必须**用兼容版。
2. **R2（中）**：新增 `readErrors` Map + projection 字段 + 2 个 i18n key + 1 个 UI 行 → **产品可见文案**，按 `verify-client-ui-i18n` 需双语同步；41号 §3 已提醒。且 `reason` 若沿用 `String(err.message)` 会**回显内部路径/引用名**（40号 §4 与 30-b §1 裁决 6 已证该泄漏面）→ **必须复用 `health.js:25-32` 的 `sanitizeError`**（含 `SECRET_PATTERNS` 脱敏 + 截断），而不是 41号写的 `.slice(0,140)`。
3. **R3（低）**：`republish()` 移入 `finally` 属内部时序修正，不改变状态模型；但需断言失败路径也触发一次 `republish`。
4. **R4（低）**：`readErrors` 与 `failedKeys` 语义必须分离（前者 READ 失败、后者 SAVE 失败），UI 文案已用 `keyReadFailed` 区分，41号设计正确。

### 可 apply 的**兼容版** diff（**未 apply**；保留 4 条测试锚点）

```diff
--- a/lib/client.js
+++ b/lib/client.js
@@ -285,6 +285,7 @@
 				this.failedKeys = new Map(); // envRef -> failure reason
+				this.readErrors = new Map(); // envRef -> sanitized READ failure (distinct from SAVE failures)
 				this.failedFields = new Set();
@@ -318,6 +319,7 @@
 					failedKeys: [...this.failedKeys].map(([ref, reason]) => ({ ref, reason })),
+					readErrors: [...this.readErrors].map(([ref, reason]) => ({ ref, reason })),
 					failedFields: [...this.failedFields],
@@ -378,6 +380,7 @@
 			async readCredential(ref) {
 				let readFailed = false;
+				let reason;
 				try {
@@ -392,6 +395,7 @@
 						if (res !== null && typeof res === "object" && res.ok === false) {
 							readFailed = true;
+							reason = String(res.error?.message ?? "credential read rejected");
 						} else {
@@ -405,6 +409,7 @@
 					if (!readFailed && view !== undefined) {
 						this.keyState.set(ref, { configured: view.configured === true, writable: view.writable !== false });
+						this.readErrors.delete(ref);
 					}
-				} catch { /* ignore */ }
-				this.republish();
+				} catch (err) {
+					reason = String(err?.message ?? err);
+				} finally {
+					// sanitizeError() redacts token-like fragments (health.js:15-32);
+					// never echo a credential value or an internal path to the UI.
+					if (reason !== undefined) this.readErrors.set(ref, sanitizeError(reason));
+					this.republish();                       // always republish, success or failure
+				}
 			}
```

> **`sanitizeError` 的引入**：`client.js` 是 bundled client module（不 import host 模块），`health.js` 的 `sanitizeError` 属 host 侧。最小做法：把 `SECRET_PATTERNS` 正则 + 截断逻辑**内联**到 `client.js` 的一个小函数（约 8 行），或复用已有的 `safeFailureReason`（40号 §4 引入、`lead-20261108-interaction.test.js:29` 已断言其存在）——**推荐后者**：`this.readErrors.set(ref, safeFailureReason({ code: "credential/read-failed" }))` 只存固定码、零泄漏，且与 40号 D4 修法一致。下面给出这个更稳的版本：
```diff
-					if (reason !== undefined) this.readErrors.set(ref, sanitizeError(reason));
+					if (reason !== undefined) this.readErrors.set(ref, "credential/read-failed"); // fixed code, no raw message
```

```diff
--- a/lib/client.js  (zh 字典 :110 附近 / en :168 附近)
+++ b/lib/client.js
@@ zh
 			keyFailed: "该 Key 保存失败",
+			keyReadFailed: "密钥状态读取失败（不影响保存）",
@@ en
 			keyFailed: "failed to save this key",
+			keyReadFailed: "Could not read key status (saving is unaffected)",
```

```diff
--- a/lib/client.js  (KeyedBackendCard :589 的 failure 行旁；OPTIONAL_KEYS :770 同样一行)
+++ b/lib/client.js
@@
 				failure && react_jsx_runtime.jsx("p", { className: "wsc-hint", style: { color: "#e5534b" }, children: props.t("keyFailed") + (failure.reason ? ": " + failure.reason : "") }),
+				readFailure && react_jsx_runtime.jsx("p", { className: "wsc-hint", style: { color: "#e6a700" }, children: props.t("keyReadFailed") }),
```
> 需在两处组件顶部各加 `const readFailure = (state.readErrors ?? []).find((f) => f && f.ref === b.keyEnv);`（与 `failure` 同构）。**注意**：`lead-20261106.test.js:161-162` 断言 `(state.failedKeys ?? []).find(...)` **恰好 2 处**；新增的 `readErrors` 用的是 `state.readErrors`，正则里写的是 `failedKeys`，**不会让计数变成 3**，已核对。

### 前置验收
1. **兼容版 diff 跑 `node --test tests/*.test.js` → 25/25**（关键：41号原版是 24/25，兼容版必须 25/25）。
2. 新增 3 条断言（41号 T6）：`ok:false` → `readErrors` 有值且 `republish` 触发；`describe` 抛异常 → 同样；正常 `ok:true` → `readErrors` 清空；文案与 `failedKeys` 不混。
3. `readErrors[0].reason` **不含** `/home/`、`.credentials`、引用名、`sk-`、`Bearer`（R2）。
4. i18n 双语 key 各定义 1 次、各 `t()` 引用 1 次（沿用现有 `lead-20261106.test.js:133-136` 的写法）。
5. 真实 GUI 目视：徽章仍「未配置」，但旁边出现黄色提示行（产品可见行为，**需用户确认文案**）。

### 回滚
```bash
# 删 readErrors Map / projection 字段 / finally 块恢复 `catch {} + this.republish()` /
# 删 2 个 i18n key 与 2 行 UI。验证 25/25 + 徽章恢复静默。
```
**回滚成本**：1 文件、纯 UI/诊断，秒级。

---

## 5. 交叉约束核对（25 测试 + 磁盘完整性）

| 改动 | 是否碰现有测试锚点 | 结论 |
| --- | --- | --- |
| M-1 | 不动 `options.skipInitialize ? undefined : await ensureSession`（`lead-20261106:113`）；改 `callBody.id` 与 JSDoc（无断言） | 25/25 可保 |
| M-3 | `ensureSession(url, signal, {…})` 仍匹配 `lead-20261106:113` 的正则前缀（本轮 `grep -c` = 1） | 25/25 可保 |
| 429 | 现有测试对 `breaker.js` / `provider.js:292` **零断言**（本轮 grep）；但 `lead-20261107:72-76` 断言 provider.js 的 `privHost` 正则仍在 → diff 不碰该处 | 25/25 可保 |
| readErrors（41号原版） | **删 4 条 `readFailed` 断言**（`lead-20261106:207-210`） | **24/25，不可直接 apply** |
| readErrors（本报告兼容版） | 保留 `let readFailed = false;` / `readFailed = true;` / `!readFailed &&` 全部 4 条 | 25/25 可保 |

**磁盘完整性**（本轮结束实测，与任务开始时一致）：
```
8af41eb5…  lib/client.js          036b6638…  lib/provider.js
cdfbf515…  lib/util/mcp-client.js  （installed 与 src-work 两两相同）
```
⇒ 本子代理**未改任何源码**；所有 diff 仅在 `/tmp` 内存副本验证；`/tmp/mcptest`、`/tmp/re46`、`/tmp/b-*.txt` 等临时文件已删除。**未写设置、未写凭证、未重启服务、未动任务板**。

---

## 6. 汇总：批准顺序与「是否需改运行时」

| 顺序 | 项 | 裁决 | 前置 | 改运行时 |
| --- | --- | --- | --- | --- |
| 1 | **M-3** | **go** | 25/25 + keyless 零回归断言 | 是（2 文件，不需重启） |
| 2 | **M-1** | **条件-go** | 真实 `web_search` 4 后端仍 ✓ + JSDoc/id 同步 + 25/25 | 是（4 文件，不需重启） |
| 3 | **readErrors 兼容版** | **条件-go** | 兼容版 25/25（原版 24/25）+ 用户确认 UI 文案 + 脱敏 | 是（1 文件 + 双语，不需重启） |
| 4 | **429 3a** | **条件-go** | 分类器真实错误串单测 + 25/25 | 是（2 文件 + 1 新 util） |
| 5 | **429 3b** | **条件-go（最严）** | **用户批准行为变更** + R2 字段修正 + 快速失败/非配额 fail-open 双断言 + 25/25 | 是（provider.js） |

**统一回答 Lead 的「是否需改运行时」**：**四项都需要改插件源码**（`lib/` 下的 client / backends / util / provider / breaker），但**都不需要重启服务**——按 Lead 既有运行时规则，客户端 bundle 走 HMR/重建流程刷新，host 侧 provider/breaker 改动需重建对应 bundle；本子代理未执行任何一步。**无 P0**；最需用户拍板的是 **429 3b**（改变模型可见错误文本）与 **readErrors**（新增产品可见 UI 文案）。

### 仍无法验证项（E）
1. M-1 合入**后**的真实 `web_search` 4 后端成功——本轮只验证了「裸 `tools/call` 端点 200」，未在改过的运行时上跑全链路（未 apply diff，硬约束）。这是条件-go 的核心缺口。
2. 429 3b 的 `Retry-After` 真实透传——`WebError.cause` 不含响应头，需改 `mcp-client.js`/各后端，超出本轮范围（41号 E-3）。
3. 混合 429+403 全冷却时的行为（R3）——41号与本报告均未设计，标 E。
4. `readErrors` 在真实浏览器 GUI 的目视效果（无 CDP/浏览器会话）。
5. 官方 v2.2.6 的 `id:1` 是否对 firecrawl 的 `conversationId` 有隐含依赖——本轮 firecrawl 返回 `isError`（配额），未验证成功态，标 E。

---

*报告完。全部结论按 A/B/C/D/E 标注；4 项裁决均给出可 apply diff（未 apply）、验收断言与回滚命令；无 token 或密钥值出现在任何输出。*
