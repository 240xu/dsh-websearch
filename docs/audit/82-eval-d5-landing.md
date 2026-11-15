# 82 · A2 独立评估：D5 跨会话功能性干扰 — 最小修法与工程落地（终版）

> **⚠️ 22:20 A2 终版（458 行）更正，覆盖上文 §2 推荐**：生产里 `index.js:498` 只 `createUnifiedSearchProvider` 一次、`:514` 注册一次 ⇒ **provider 是单例**；`WebSearchRequest` 只有 `query/maxResults/filters`，seam 不传会话标识。因此「注入式 healthStore」只能隔离多实例，**单进程跨会话干扰仍在**；彻底修须跨包改 pre-stable seam（非最小、需用户点头）。且 429 是账号级配额，「全健康的 B」是 fake 假设 ⇒ A2 建议把 **D5 从 P1 复议为产品语义取舍**。另发现 `history.js:87-96` 的 `clear()` 直接 `unlinkSync(file())` 删整文件 ⇒ 任一会话 `POST /history/clear`，全进程所有会话一起丢历史（比 D5 更直观、无需 429）。落地：PR base 2.8.4 GO / 2.8.8 NO-GO（main 已 2.8.8、分支基 2.8.4 有回退分叉）；publish NO-GO（ENEEDAUTH）；rc.3 NO-GO。**仍需用户点头**（修法范围 + 定级）。
> 角色：独立评估专家 A2（D5 与工程落地）。**独立取证**：不采信 73/80 号结论，全部以当前 `src-work/plugin/` 源码 + `node` 行为级复现重跑。
> 约束遵守：**唯一写文件为本报告**；未改源码/配置/运行时/其它报告；未操作任务板；未 commit/push/publish/改 profile；所有复现脚本写在 `/tmp/a2-*`，跑完已删（`ls -d /tmp/a2-*` → 无残留）。
> 采样：2026-11-15 21:44–21:56 +08:00。Node `v24.22.2`，runtime `/opt/dsh-0222`（`0.2.2-rc.1`）。
> 对象：工作副本 `.artifacts/websearch-research/src-work/plugin/`（35 文件、80 单测）；seam 契约取 `/opt/dsh-0222/node_modules/@deepseek-ai/{dsh-web,dsh-tool-web}/`。

---

## 0. 结论速览（先给裁决）

| 项 | 裁决 |
| --- | --- |
| D5 是否复现 | **是**，4 场景逐字输出见 §A；整站快速失败 + 分支级召回降级 + 两处免疫路径 |
| 三种候选最值得做 | **候选①「注入式 `healthStore`（默认回退模块级 Map）」** —— 唯一实测 80/80 全绿、零磁盘格式、零 fence 影响、2 文件、易回滚 |
| **决定性新发现** | 生产里 provider 是**单例**（`index.js` 只 `createUnifiedSearchProvider` 一次、`registerSearchProvider` 一次），且 `WebSearchRequest` **只有 `query` + `maxResults`，无 session/owner 字段**，seam `search(request, signal)` 也不传会话标识 ⇒ 三种「per-session」方案在**产品路径上都先天受限**；候选①只隔离多实例，不彻底消除单进程跨会话干扰 |
| 是否仍需用户点头 | **是**（两点见 §C.3）：① 彻底修须跨包动 pre-stable seam 契约，远超「最小修法」；② D5 是否真为缺陷需产品决策（429 是账号级配额，「全健康的 B」是 fake 假设） |
| 一个硬阻塞 | **patch-package NO-GO**：pnpm-only profile 无 npm/yarn lock，`npx patch-package` 实报 `No package-lock.json, npm-shrinkwrap.json, or yarn.lock file`（§D.1） |
| 落地四类 | patch-package **NO-GO** / PR base **GO 2.8.4、NO-GO 2.8.8** / `npm publish` **NO-GO（ENEEDAUTH）** / `0.2.2-rc.3` **NO-GO（维持 rc.1）** |

---

## A. D5 独立复现证据（真 provider + 两个独立「会话」）

### A.1 复现方法

脚本 `/tmp/a2-d5-repro.mjs`（跑完删），导入**真** `createUnifiedSearchProvider` / `getLatestBackendHealth` / `BREAKER_DEFAULTS`，用两个独立「会话」= 不同 `resolveOptions`（含 `numResults` 差异、`ctx.session` 标记）+ 不同 query 上下文 + 各自独立的 fake backend 实例。`429` 用 `Error("HTTP 429: too many requests")` + `e.status = 429`，走真 `rateLimited()` 分类链路。命令：

```bash
cd /home/ova/dsh/.artifacts/websearch-research/src-work/plugin && node /tmp/a2-d5-repro.mjs
```

### A.2 逐字输出（4 场景）

```
===== 场景 1：同进程两会话、不同 query（A 全 429 → B 全健康却被快速失败）=====
A search threw: unified search: all enabled backends failed (3) - exa: backend exa: HTTP 429: too many req
A backend calls = 3 ids = exa,parallel,ddg
A health entries cooled/rateLimited: exa:true parallel:true ddg:true
B search threw: unified search: all backends are rate-limited; retry after ~60s
B backend calls = 0 ids = (none)
>>> VERDICT S1: D5 CONFIRMED: 全健康会话 B 被 3b 快速失败，零后端调用（整站级）

===== 场景 2：A 只冷却 2 个后端，B 的后端集合含 1 个额外健康后端 =====
A threw: unified search: all enabled backends failed (2) - exa: backend exa: HT
B backend calls = 1 ids = ddg
B sources = 1
>>> VERDICT S2: PARTIAL: 未整站失败，但 A 的冷却让 B 少调用 exa/parallel → 召回降级（分支级）

===== 场景 3：会话 B 关掉 breaker（breakerEnabled=false）=====
B backend calls = 2 sources = 2
>>> VERDICT S3: IMMUNE: breakerEnabled=false 不走 3b，B 正常

===== 场景 4：会话 B 缓存命中（cacheEnabled=true，query 曾成功）=====
(源码顺序：cache 命中 return 在 3b 判定之前 → 命中查询结构上免疫；此处仅记录)
B threw: unified search: all backends are rate-limited; retry after ~60s
B backend calls = 0 (miss 路径仍受 D5 影响)

===== 独立复现结束；health map size = 0 =====
```

### A.3 影响范围界定（是整站还是仅某些分支）

| 路径 | 是否受 D5 影响 | 依据 |
| --- | --- | --- |
| `breakerEnabled !== false`（默认）**且** cache miss 的 `search()` 全后端冷却 | **整站级快速失败、零后端调用** | 场景 1（`provider.js:341-357`） |
| 同上、但后端集合含未冷却成员 | **分支级召回降级**（少调若干健康后端） | 场景 2（`:323-340` `active`/`failOpen`） |
| `breakerEnabled: false` | **免疫** | 场景 3（`:322` 整块跳过） |
| cache **命中** | **结构上免疫**（命中 `return` 在 `:268-297`，早于 3b 判定 `:322`） | 场景 4 + 源码顺序；miss 仍受影响 |
| `available()`（`provider.js:178-188`） | **免疫**（只读 `be.available(beOpts)`，不读 health） | 源码 |
| `GET /api/unified-search/health`、`GET /api/websearch/history` | **只读视图，不产生决策**；但它们读的正是被污染的同一 Map ⇒ 遥测口径跨会话串扰 | `health.js:47`、`history.js:160` |
| `web_fetch` | **免疫**（走独立 `fetchProvider`） | `dsh-web/lib/index.js:129-131` |

⇒ **结论**：不是「整站无条件失败」，而是**限定在 breaker 开启 + cache miss 的 search 路径**；最坏形态是 60s 内该路径零后端调用。D5 的伤害面精确落在 `provider.js:322-364` 的 3b 分支把**跨调用持久化的全局健康**当作**本次请求**的决策输入。

### A.4 根因定位（逐行）

```
provider.js:57   const latestBackendHealth = new Map();            // 模块级单例
provider.js:64-78 recordBackendHealth(): 任何 search 的后端成败都写进这个 Map
provider.js:324  const entry = latestBackendHealth.get(c.id);      // 3b 扇出前读全局历史
provider.js:327  if (entry?.rateLimited === true) rateLimitedCooled.set(...)
provider.js:341-357 failOpen.length===0 && rateLimitedCooled.size>0 → 抛 "all backends are rate-limited; retry after ~Ns"
```
`cooledUntil = nowMs + retryAfterMsFrom(err)`（`breaker.js:50-52`，默认 60s）⇒ A 写一次，B 在同窗口内读到即中招。**没有任何调用方维度参与判定**。

### A.5 ⚠ 决定性结构事实（本轮新取证，改变三种修法的可行性判断）

| 事实 | 证据 |
| --- | --- |
| ① 生产只创建 **1 个** provider 实例 | `index.js:498` `const provider = createUnifiedSearchProvider(...)`（全文仅 1 次）；`index.js:514` `ctx.web.registerSearchProvider(provider)`（仅 1 次） |
| ② seam 按 `id` 存进 `Map`，同 id 重复注册直接抛 `WEB_DUPLICATE_PROVIDER` | `dsh-web/lib/index.js:52` `searchProviders = new Map()`、`:82-89` `registerProvider()`、`:99-100` `selectSearchProvider().search(request, signal)` |
| ③ `WebSearchRequest` 是**封闭接口**，只有 `query: string` + `maxResults?: number` | `dsh-web/lib/types/types.d.ts:14-24`（无 `sessionId` / `owner` / `scope`） |
| ④ 调用方不注入任何会话标识 | `dsh-tool-web/lib/index.js:214-217,224-227` `ctx.web.search({query, maxResults}, signal)`；`:335-336` `execute(args, exec)` 只传 `exec.signal` |
| ⑤ `dsh-agent` 有 `AsyncLocalStorage`（`initiators`），但它是另一个包的内部字段，websearch 无导出可依赖 | `dsh-agent/lib/index.js:443-444` |
| ⑥ 429 配额是**后端 API key / 账号级**共享状态，不是会话级 | 所有会话共享同一组 `BACKENDS`、同一 `apiKeyEnv` 指向的进程环境变量（`index.js:374`） |

⇒ **推论 1**：所谓「会话 A / 会话 B」在产品运行时其实是**同一个 provider 实例的两次 `search()` 调用**。73/80 号用「两个独立 fake backend 集」构造的「全健康 B」，隐含假设了「每个会话有独立后端健康」；产品里后端是进程级共享单例。**这个假设是 D5 被定级 P1 的隐含前提，值得复议**（§C.3）。

⇒ **推论 2**：三种「per-session」候选里，① 若「每次 `createUnifiedSearchProvider` 创建新 store」，因单例 ⇒ 等价于「进程级一个 store」，**对产品 D5 零修复**（仅在多实例/HMR/embedder/测试场景隔离）；③ 要拿 `owner` 必须先有 owner 来源，而 request/seam 都没有 ⇒ 必须跨包改契约。

⇒ **推论 3**：3b 已有行为级测试（`lead-20261109-3b-runtime.test.js:22-72`）用**同一 provider 实例、两个不同 query**（`"first"`/`"second"`）连续搜索，断言第二次「零后端调用、快速失败」。这与 D5「另一会话的下一次搜索」**在产品视角是同一个行为**。任何「收紧到本次 search / 加会话过滤」的改法，若不引入调用方维度，必然同时动到这条测试。

---

## B. 三种最小修法 + 可 apply diff（**均未实际 apply**）

> 以下 diff 均可直接 `git apply` 到 `src-work/plugin/`；本轮**只读评估，未 apply**。行号对应当前 `provider.js`（597 行）/`index.js`（573 行）。

### B.1 候选① · per-session `healthStore`（由 `createUnifiedSearchProvider` 持有 / 调用方注入）

思路：把「决策用的健康」从模块级 Map 换成**实例级 store**；`getLatestBackendHealth()` 保留为全局只读遥测；默认参数回退全局 Map 以保证向后兼容。

```diff
--- a/lib/provider.js
+++ b/lib/provider.js
@@ -56,8 +56,14 @@
 // Entry shape: { ok: boolean, at: ms, ms: duration, count?: number,
 //                error?: string (already truncated to 80), lastOkAt: ms|null }
 const latestBackendHealth = new Map();
 
 /** Read-only access for the health route (never mutate the returned map). */
 export function getLatestBackendHealth() {
   return latestBackendHealth;
 }
 
-function recordBackendHealth(id, entry, breakerCfg, opts = {}) {
-  const prev = latestBackendHealth.get(id);
+/** Create an isolated health store for one provider instance. */
+export function createHealthStore() {
+  return new Map();
+}
+
+function recordBackendHealth(id, entry, breakerCfg, opts = {}, store = latestBackendHealth) {
+  const prev = store.get(id);
   const breaker = foldBreaker(prev, entry.ok === true, entry.at, breakerCfg ?? undefined, opts);
-  latestBackendHealth.set(id, {
+  store.set(id, {
@@ -171,7 +177,8 @@
  * @param {object} deps.backends     keyed backend registry
  */
-export function createUnifiedSearchProvider({ ctx, resolveOptions, backends, cache, history }) {
+export function createUnifiedSearchProvider({ ctx, resolveOptions, backends, cache, history, healthStore = latestBackendHealth }) {
   return {
@@ -321,7 +328,7 @@
       if (breakerCfg) {
         const active = candidates.filter((c) => {
-          const entry = latestBackendHealth.get(c.id);
+          const entry = healthStore.get(c.id);
           if (isCooled(entry, nowMs)) {
@@ -404,7 +411,7 @@
-                recordBackendHealth(id, { ok: true, at: Date.now(), ms: Date.now() - startedAtMs, count: value?.sources?.length ?? 0 }, breakerCfg);
+                recordBackendHealth(id, { ok: true, at: Date.now(), ms: Date.now() - startedAtMs, count: value?.sources?.length ?? 0 }, breakerCfg, {}, healthStore);
                 return value;
@@ -417,7 +424,7 @@
                 recordBackendHealth(id, { ok: false, at: Date.now(), ms: Date.now() - startedAtMs, error: msg }, breakerCfg,
-                  { rateLimited: rateLimited(err), keylessRejected: keylessRejected(err), retryAfterMs: retryAfterMsFrom(err) });
+                  { rateLimited: rateLimited(err), keylessRejected: keylessRejected(err), retryAfterMs: retryAfterMsFrom(err) }, healthStore);
                 throw err;
```

```diff
--- a/lib/index.js
+++ b/lib/index.js
@@ -40,7 +40,7 @@
-import { createUnifiedSearchProvider, getLatestBackendHealth } from "./provider.js";
+import { createUnifiedSearchProvider, getLatestBackendHealth, createHealthStore } from "./provider.js";
@@ -495,8 +495,10 @@
   const historyStore = createHistoryStore({ dir: storeDir, maxEntries: HISTORY_MAX_ENTRIES });
 
+  const healthStore = createHealthStore();
   const provider = createUnifiedSearchProvider({
     ctx,
     resolveOptions: () => resolveOptions(ctx, current()),
     backends: BACKENDS,
+    healthStore,
     cache: {
@@ -540,7 +542,7 @@
         () => registerHealthRoute(webCtx.webServer, {
           resolveOptions: () => resolveOptions(ctx, current()),
           backends: BACKENDS,
-          getBackendHealth: getLatestBackendHealth,
+          getBackendHealth: () => healthStore,
           getConnection,
         }),
@@ -548,7 +550,7 @@
         () => registerHistoryRoutes(webCtx.webServer, {
           getStore: () => historyStore,
-          getBackendHealth: getLatestBackendHealth,
+          getBackendHealth: () => healthStore,
           getConnection,
         }),
```

⚠ **必须同时改 `index.js:543/550` 两行注入源**：provider 现在写 `healthStore`，若路由仍读 `getLatestBackendHealth()`（模块级 Map），D8 的 `rateLimited/keylessRejected/cooledUntilMs` 会**全空**，health/history 遥测静默失效。`getConnection` 保持不变 ⇒ fence 不受影响。

**独立行为验证**（`/tmp/a2-sandbox` 模拟改造副本，跑完删）：

```
[V1 默认 store] firstCalls=2 secondCalls=0 msg="unified search: all backends are rate-limited; retry after ~60s"
  → 3b 快速失败保留: PASS
[V2 全局预置冷却] calls=parallel limited-rehit=false ordinary-failopen=true
  → 混合冷却 fail-open 语义保留: PASS
[V3 双 store] A.calls=2 B.calls=2 B.sources=2 storeA.size=2 storeB.size=2
  → D5 隔离: PASS
```
**80/80 全绿**（把 `tests/` + `package.json` 拷进 sandbox，跑在改造后的 `lib` 上）：
```
ℹ tests 80  ℹ pass 80  ℹ fail 0  ℹ duration_ms 1100.019324
```
（首跑因 sandbox 缺 `package.json` 报 `ENOENT`，补上即 80/80；与改造无关。）

### B.2 候选② · 3b 快速失败限定为「本次 search 内产生的失败」

思路：3b 判定不再读全局历史健康，只依据**本次 `fanoutVariant()` 里实际产生的 429 冷却**决定快速失败。

```diff
--- a/lib/provider.js
+++ b/lib/provider.js
@@ -319,25 +319,11 @@
       const cooled = new Map();
       const rateLimitedCooled = new Map();
       let eligible = candidates;
       if (breakerCfg) {
-        const active = candidates.filter((c) => {
-          const entry = latestBackendHealth.get(c.id);
-          if (isCooled(entry, nowMs)) {
-            cooled.set(c.id, entry);
-            if (entry?.rateLimited === true) rateLimitedCooled.set(c.id, entry);
-            return false;
-          }
-          return true;
-        });
+        // Only cooldowns produced by THIS invocation's own fan-out are
+        // decision inputs; the global map stays read-only telemetry.
+        const active = [...candidates];
+        // rateLimitedCooled stays empty until the fan-out reports 429s.
@@ -336,7 +322,7 @@
-        const failOpen = active.concat([...cooled.entries()]
+        const failOpen = active.concat([...cooled.entries()]
           .filter(([, e]) => e?.rateLimited !== true)
           .map(([id]) => candidates.find((c) => c.id === id))
           .filter(Boolean));
         if (failOpen.length > 0) eligible = failOpen;
-        else if (rateLimitedCooled.size > 0) {
+        else if (false) {   // 快速失败分支在扇出前永不触发
```

⚠ **诚实标注：这个 diff 会删掉 3b 快速失败**。3b 判定位于扇出**之前**（`:322-364`），此刻「本次产生的失败」必然为 0 ⇒ `rateLimitedCooled` 恒空 ⇒ 分支永不触发。后果：① `lead-20261109-3b-runtime.test.js:64-70` 断言「第二次 search 快速失败 + `calls.length===0`」**必失败**；② 重新引入「明知限流仍重打端点」，与 3a 立即冷却 + N5 混合故障 fail-open 的设计意图冲突。要保留测试只能改测试期望（即**主动放弃 3b 已有行为**），与任务「不破坏 3b 全配额快速失败已有行为级测试」直接矛盾。**折中变体**（「冷却一次性消费」「仅同 query 生效」「最近 N 秒」）也全部失败：3b 测试用不同 query、跨调用、60s 窗口，任一收紧都会动到它；且仍是全局无 A/B 维度 ⇒ 修不了 D5。

### B.3 候选③ · health entry 加 `owner/session` 键，3b 判定里过滤

思路：健康条目按调用方分桶，3b 只看本调用方的桶。

```diff
--- a/lib/provider.js
+++ b/lib/provider.js
@@ -64,7 +64,9 @@
-function recordBackendHealth(id, entry, breakerCfg, opts = {}) {
-  const prev = latestBackendHealth.get(id);
+function recordBackendHealth(id, entry, breakerCfg, opts = {}, owner = "global") {
+  const key = `${owner}\0${id}`;
+  const prev = latestBackendHealth.get(key);
   const breaker = foldBreaker(prev, entry.ok === true, entry.at, breakerCfg ?? undefined, opts);
-  latestBackendHealth.set(id, {
+  latestBackendHealth.set(key, {
     ...entry,
+    owner,
@@ -198,6 +200,8 @@
     async search(request, signal) {
+      // ⚠ owner 无来源：WebSearchRequest 只有 query/maxResults，signal 无标识。
+      const owner = request?.sessionId ?? request?.owner ?? "global";
@@ -324,7 +328,7 @@
-          const entry = latestBackendHealth.get(c.id);
+          const entry = latestBackendHealth.get(`${owner}\0${c.id}`);
```

⚠ **硬缺口**：`request.sessionId` / `request.owner` 在产品里**不存在**（§A.5 事实 ③④）。要让它有值，必须至少改：`dsh-web/lib/types/types.d.ts`（`WebSearchRequest` 加字段，属 pre-stable 公共 API）、`dsh-tool-web/lib/index.js:214/224`（从 `exec` 取会话键塞进 request）、两个 SDK 的 request 投影、加一份 upgrade guide（AGENTS.md House Rules）。`dsh-agent` 的 ALS 是别的包内部字段、无导出可依赖。⇒ 这不是「最小修法」，是**跨 4+ 包的能力缝改造**；且现有 3b 测试不传 owner，需同步改测试构造。

### B.4 三种候选对比表（任务要求的 6 个维度）

| 维度 | ① 注入式 `healthStore` | ② 3b 限定本次 search | ③ entry 加 `owner` 键 |
| --- | --- | --- | --- |
| **改动文件数** | **2**（`provider.js` + `index.js` 共 ~7 处；测试 0 处） | 1（`provider.js`，但测试必改 1 处） | **≥5**（`provider.js` + `dsh-web/types` + `dsh-tool-web` + 2 SDK 投影 + upgrade guide） |
| **是否动 health / history API** | 函数签名不变；**`index.js` 两行注入源改**（`getBackendHealth: () => healthStore`）；`health.js`/`history.js` 内部 0 改动 | 否（但 health/history 路由继续读全局 Map，遥测与决策分裂） | 是：`Map` 键结构从 `id` 变 `owner\0id`，`health.js:58` `tel.get(id)`、`history.js:108` 遍历需同步改键（+2 文件） |
| **是否改磁盘格式** | **否**（health 是内存 Map；`history.json` 结构不变） | 否 | **否**（若只内存分桶）；但若要 owner 跨进程持久则必须动格式 |
| **是否影响现有 80 条测试** | **否 —— 实测 80/80 全绿**（默认参数回退全局 Map；3b 4/4、混合冷却、keyless 全过） | **是 —— 必破坏** `lead-20261109-3b-runtime.test.js` 第 1 条（`calls.length===0`） | **是** —— 3b 测试的 `health.set(id, …)` 预置键需改成带 owner；`toBackendObservability` 遍历键变复合键，`lead-20261108-interaction.test.js` 断言同步改 |
| **是否破坏 401/403 fence** | **否**（不碰 `trust.js`、`rejectionFor`、`getConnection`） | 否 | 否（但若跨包改 request 类型，须复核 `rejectionFor` 的 req 结构假设） |
| **是否破坏 3b 全配额快速失败** | **否**（V1/V2 实测 PASS） | **是（功能性删除）** | 是（需改测试构造，行为可保留但契约变） |
| **回滚难度** | **低**：纯增量、`healthStore` 默认回退旧 Map，删掉参数 + 2 行注入即回到现状；无磁盘/线上状态 | 中：需同时回滚代码与测试期望 | **高**：跨包 pre-stable API 改动需同步回滚 + upgrade guide，且 owner 键若已落盘需迁移 |
| **对「产品单例 D5」的实际效力** | **部分**（隔离多实例/HMR/embedder；单例下仍共享） | 名义上消除「零调用快速失败」，但代价是放弃 3b | **彻底**（若 owner 真能注入），但成本最高 |
| **为将来真隔离铺路** | **是**（`healthStore` 就是注入缝） | 否 | 是（但绑死在 seam 契约上） |

---

## C. 明确裁决

### C.1 推荐哪一个

**推荐候选①**，理由按权重排序：

1. **唯一零破坏**：实测 **80/80 全绿**（原版 + 改造版各跑一次）、3b 快速失败 V1 PASS、混合冷却 fail-open V2 PASS、keyless 分支未动、401/403 fence 未动、磁盘格式未动。
2. **代价最小**：2 文件、~7 处、纯增量、默认参数向后兼容、回滚只需删参数 + 恢复 2 行注入。
3. **可逆且渐进**：`createHealthStore()` + `healthStore` 注入缝本身就为「将来按调用方分桶」留好位置，不会把架构焊死。
4. 候选② 与任务硬约束（「不破坏 3b 全配额快速失败已有行为级测试」）**直接冲突**，不可选。候选③ 是跨 4+ 包的 pre-stable seam 改造，不是「最小修法」，且要动 health/history 的 Map 键契约 + 至少 2 个测试文件。

### C.2 是否仍需用户点头

**是，且是两项独立决定**：

1. **候选①本身的范围**：它只隔离「多实例」，产品单例下 D5 依旧存在。若用户要的是「单进程任意两会话互不影响」，候选①**不满足**，需追加 §A.5 的跨包 owner 注入（即候选③的落地版）—— 那是架构/执行语义改动，必须点头。
2. **D5 的定级复议**：429 是**账号级配额**（所有会话共享同一 API key / 出口 IP），「A 打 429 后 B 全健康」只在 fake backend 下成立；真实配额下 B 去打同一后端大概率同样 429，跳过/快速失败反而是**保护配额的正确熔断**。建议把 D5 从「P1 功能缺陷」复议为「产品语义取舍：跨会话熔断是否可接受」，再决定是修代码还是登记 Known Limitation。

### C.3 特别注意项逐条核对

| 约束 | 候选①是否满足 | 依据 |
| --- | --- | --- |
| 不动磁盘格式 | ✅ | health 内存 Map；`history.json` 的 `toPublicEntry` 结构零改动 |
| 不破坏 401/403 fence | ✅ | `trust.js`/`rejectionFor`/`getConnection` 零改动；`settings-api.test.js` 的 413 / untrusted / conflict 用例在 80/80 中全过 |
| 不破坏 3b 全配额快速失败行为级测试 | ✅ | V1（`secondCalls=0` + `all backends are rate-limited; retry after ~60s`）+ 改造版 80/80 |

### C.4 最小验收命令（若做）

```bash
cd /home/ova/dsh/.artifacts/websearch-research/src-work/plugin
node --test tests/*.test.js                              # 期望 80/80
node --test tests/lead-20261109-3b-runtime.test.js      # 期望 4/4（3b 快速失败 + fail-open + 混合 + keyless）
grep -n "healthStore\|createHealthStore" lib/provider.js lib/index.js   # 期望：定义 + 注入链 + 两处 getBackendHealth 齐
```
追加一条「跨实例隔离」行为断言（新增测试模板，写入 `tests/`）：两个 `createUnifiedSearchProvider` 各传 `createHealthStore()`，A 全 429 后 B 仍返回全部后端结果、B 的 `calls.length === enabledBackends.length`（本轮 V3 已验证该断言成立：`B.calls=2 B.sources=2 storeA.size=2 storeB.size=2 → PASS`）。

落地后仍需按 25 §6 的链：**同步到安装副本 → 35/35 逐字节一致 → 重启服务 → 认证 GET 三 API 确认 `health` 的 `rateLimited/keylessRejected/cooledUntilMs` 有值**（这一步专防 §B.1 的「忘改 index.js 两行注入源」静默失效）。

---

## D. 落地路径复核（只读，四项 go/no-go + 一条具体命令）

### D.1 patch-package 落地 —— **NO-GO（硬阻塞）**

| 项 | 本轮实测 |
| --- | --- |
| profile lock 文件 | `find /home/dsh/.dsh/profiles/web -maxdepth 1 -type f` → 只有 **`package.json` + `pnpm-lock.yaml`**，无 `package-lock.json` / `npm-shrinkwrap.json` / `yarn.lock` |
| 生成器 | 74 号 X.1 / 79 号 §9 已实跑：`npx patch-package <pkg>` → `No package-lock.json, npm-shrinkwrap.json, or yarn.lock file` |
| 本轮新增证据 | `g5/README.md` 现声明**唯一权威源**为 `G5-authoritative.patch` = `publish-work/repo` 的 `git diff d2602823 HEAD`（`d2602823` = npm 2.8.4 tarball），`refresh.sh` 固化「重新生成 + `git apply` 到洁净 2.8.4 + 35/35 逐字节 cmp」；当前 **37 段 / 3983 行**。README 还记录了 A1 事故：`52e26ae` 修完 N1–N4 未刷新补丁，旧 39 段快照 apply 后只有 25/35 相同，会重新引入 4 条 P1 |

**理由**：生成器在 pnpm-only profile 结构性不可用；74 号 X.5 的绕开方案（手工 `sed` 重写 `a/node_modules/@240xu/dsh-websearch/…` 段头 + `postinstall: patch --forward -p1`）只验证了**格式语义**（`patch -p1 --dry-run` rc=0 / 35 段 CLEAN），**apply 闭环未在本机 profile 实跑**（74 号 X.7 第 4 条）；且 `install_bundle` 每次 `pnpm add` 都触发 root `postinstall`，对已打补丁目录**非幂等重复 apply**。改 profile 属用户点头项。

```bash
# 只读验收命令（确认无 npm/yarn lock + 权威补丁对洁净树可 apply）
ls /home/dsh/.dsh/profiles/web/package-lock.json /home/dsh/.dsh/profiles/web/yarn.lock 2>&1; \
bash /home/ova/dsh/.artifacts/websearch-research/g5/refresh.sh   # 期望 "37 segments, 35/35 byte-identical"
```

### D.2 从 `local-audit-35files-20261115` 开 PR 的 base 选择 —— **GO 2.8.4 / NO-GO 2.8.8**

| 项 | 值 |
| --- | --- |
| 分支基线 | `d2602823` = npm `@240xu/dsh-websearch@2.8.4` tarball（33 文件）；分支 `publish-work/repo` HEAD = `83cfae8 fix(g5): refresh authoritative patch …`（其后 `52e26ae` E1 P1 修复、`230c1cf` 口径订正） |
| `publish-work/repo/package.json` | `"version": "2.8.4"`（本轮 read 实测） |
| 对 2.8.4 | `refresh.sh` → `35/35 byte-identical`（`g5/README.md` 2026-11-15 21:55 验收）；`g5/verify284/` 在 |
| 对 2.8.8 | `git apply --check` / `patch --dry-run` **4 文件 6 hunk FAILED**：`provider.js` 3、`lib/backends/ddg.js` 1、`lib/backends/searxng.js` 1、`package.json` 1（74 号 X.1 / 79 号 §9 订正口径；「11 段」是 patch 日志汇总行行数，不是失败 hunk 数） |
| 2.8.8 覆盖风险 | 74 号 §C / X.4：上游 2.8.4→2.8.8 改了我们 23 个修改文件里的 **11 个**，patched 树与 2.8.8 逐字节相同 **0 个** ⇒ 升 2.8.8 必然重引入已修 P0/P1 |
| **upstream main 的真实版本** | `da42e44a`，74 号 X.6 实测 `raw main/package.json → version=2.8.8`；npm latest = **2.8.8**（本轮 `npm view` 复核） |

⚠ **本轮补强的关键裁决**：分支从 **2.8.4** 建、main 已是 **2.8.8**，两者分叉 ⇒ 直接开 PR 到 main 的 diff 里会夹带「把 main 从 2.8.8 回退到 2.8.4 + 我们 35 文件补丁」的语义，**不是一次干净 merge**。所以「选 2.8.8 作 base」不只是 6 hunk 冲突，而是要先 rebase 并逐段裁决 11 个被上游改动的文件（其中含已修缺陷被上游不同实现覆盖的风险）。GO 的是「以 2.8.4 为**补丁基线**提交」，但对外 PR 仍需用户点头（House Rules：不主动开 PR）。

```bash
# 只读裁决命令（复核基线 + 冲突计数）
git -C /home/ova/dsh/.artifacts/websearch-research/publish-work/repo diff d2602823 HEAD --stat; \
grep -E "FAILED|hunk" /home/ova/dsh/.artifacts/websearch-research/g5/dry288.log | tail -12
```

### D.3 `npm publish`（`ENEEDAUTH`）—— **NO-GO**

本轮实跑：
```
$ npm whoami 2>&1 | head -5
npm error code ENEEDAUTH
npm error need auth This command requires you to be logged in.
npm error need auth You need to authorize this machine using `npm adduser`
```
`$ npm view @240xu/dsh-websearch version` → **2.8.8**（无 2.8.9；77 号实测止于 `2.8.8 @ 2026-10-21T14:10:40Z`）。

理由：登录态缺失是硬阻塞；publish 是不可逆外部动作；且会让 profile 精确 pin `2.8.4` 与新版本语义冲突（74 号风险 1）；发布前必须先决定 profile 策略。**需用户点头 + `npm adduser`**。

```bash
npm whoami   # 复现 ENEEDAUTH；通过后再 npm version 2.8.9 && npm publish --access public
```

### D.4 `0.2.2-rc.3` —— **NO-GO（维持 `0.2.2-rc.1`）**

| 项 | 本轮实测 |
| --- | --- |
| runtime 版本 | `grep '"version"' /opt/dsh-0222/node_modules/@deepseek-ai/dsh/package.json` → **`0.2.2-rc.1`** |
| npm dist-tags | `npm view @deepseek-ai/dsh dist-tags --json` → `{"alpha":"0.2.2-alpha.3","latest":"0.2.2-rc.1","next":"0.2.2-rc.3"}` |
| Node 门槛 | `node -v = v24.22.2` ≥ `engines >=24.9.0`（74 号 §D 已订正「Node 22 阻塞」为过时） |

理由：runtime 本就是 `latest=rc.1`，「升级 rc.1」是伪命题；上 `next=rc.3` 会 (a) 切 runtime 重演 79 号演练过的 test-only symlink 悬空（历史 41/49 事故），(b) 35 文件补丁未在新 runtime 下验证，(c) 需重启服务 + 用户点头。74 号 X.7 第 5 条同样标注「`0.2.2-rc.3` 未安装/重启/回归」。

```bash
npm view @deepseek-ai/dsh@0.2.2-rc.3 engines --json   # 只读确认门槛；不安装、不重启
```

---

## E. 新发现 / 风险 / 已确认无误 / 无法验证

### E.1 新发现优先：D5 相关的其它跨会话 / 共享状态问题（独立扫描 `lib/*.js`）

| # | 位置 | 现象 | 与 D5 的关系 / 级别 |
| --- | --- | --- | --- |
| **E.1.1** | `lib/history.js:44,66-95` + `lib/index.js:496` | `writeChain` 与**单个 `history.json`** 由单例 `historyStore` 持有；`POST /api/websearch/history/clear` 调 `store.clear()` **删整个文件** ⇒ 任一会话清空历史，**所有会话的历史一起消失** | **同类的功能性跨会话干扰，且比 D5 更直观、无需 429 即可触发**：一个用户点「清空」影响全进程所有会话。历轮报告未见登记。**建议与 D5 一并复议** |
| **E.1.2** | `lib/util/mcp-client.js:18-26,113,167` | 模块级 `sessionCache = new Map()`，按 `url + auth-header digest` 键控，10min TTL；N4 修好后**同 key 下所有会话复用同一 `Mcp-Session-Id`** | 若上游 MCP 是 stateful（会话与某次 initialize 绑定），跨会话复用可能串结果；当前 Exa/Parallel 走 SSE/plain-JSON 未见异常，属**潜在**同类共享状态 |
| **E.1.3** | `lib/index.js:443,464,500,508,541` | `current()` / volatile config 是**进程级单例**；任一会话经 Settings 改 `enabledBackends`/`baseURL`/`numResults` 立即影响所有会话 | 属设计（全局配置），但同为「零隔离共享状态」；与 N2 缓存键修复联动 |
| **E.1.4** | `lib/cache.js:39-55` + `lib/index.js:491` | 磁盘结果缓存按 `(query, filters, maxResults, backends, mode, resultOptions)` 键控，**不含调用方**；跨会话命中同一条目 | 属设计，但「一个会话改 baseURL 后另一会话命中旧实例 URL」是 N2 的同源问题 |
| **E.1.5** | `lib/provider.js:83-86` `getBackendBreaker()` | 导出的 breaker 读取同样读**模块级 Map**（未被 3b 之外的路径使用，但也是全局） | 若将来有人用它做决策会复制 D5；当前无消费者 |
| **E.1.6** | `lib/settings-api.js` revision CAS（74 号 D6） | 进程级 revision；跨会话并发写互相 409 | **正确的并发控制，非缺陷**，但登记为共享状态以免误改 |

⇒ **最值得提级的是 E.1.1**：它与 D5 同源（进程级单例写状态被所有会话共享），且不需要构造 429 就能造成可见的跨会话数据丢失。若 D5 要动「共享状态隔离」，应把 history clear 的作用域一并纳入设计，否则修了 D5 仍留一个更明显的同类问题。

### E.2 风险

1. **候选② 若被误选**：删掉 3b 快速失败 ⇒ 重新引入「明知 429 仍重打限流端点」，与 3a 立即冷却 + N5 混合故障 fail-open 语义冲突，且 80 条里至少 1 条失败。
2. **候选① 漏改 `index.js:543/550`**：provider 写实例 store、路由读全局 Map ⇒ D8 的 `rateLimited/keylessRejected/cooledUntilMs` 全空、health/history 遥测静默失效，而 80 条单测**不会报错**（测试直接调 `getLatestBackendHealth()`，不走 index.js 注入链）⇒ 必须靠 §C.4 的「重启后 GET health 看字段有值」验收兜住。
3. **候选③ 跨包改 `WebSearchRequest`**：pre-stable 公共 API；按 AGENTS.md 需同步两个 SDK 投影 + 升级指南 + 全部消费者，工与回滚成本远超 D5 本身。
4. **PR base 分叉**：2.8.4 分支 → 2.8.8 main 的 PR 夹带回退语义，6 hunk 冲突里可能含「已修缺陷被上游不同实现覆盖」，需逐段人工裁决（74 号风险 2）。
5. **产品语义误判**：若按 fake「全健康 B」把跨会话熔断当 bug 修掉，真实账号级配额下可能变成「多个会话一起猛打已限流端点」，反而加剧 429。

### E.3 已确认无误（本轮独立实跑）

1. D5 四场景逐字复现（§A.2），含整站级 / 分支级 / 两处免疫路径。
2. 原版 `node --test tests/*.test.js` → **80/80**；候选①改造副本 → **80/80**（补 `package.json` 后）。
3. 候选①行为三验证全 PASS：3b 快速失败保留、混合冷却 fail-open 保留、双 store 隔离生效。
4. `WebSearchRequest` 只有 `query` + `maxResults`；seam `search(request, signal)` 不传会话标识；provider 生产单例（`index.js` 各 1 次创建/注册）。
5. `rejectionFor`（`trust.js:82-120`）的 401/403/503 决策链、401/403 不误判配额（`lead-20261108-quota.test.js:65,119`）、settings 的 413 / SETTINGS_CONFLICT / untrusted 用例均在 80/80 中通过 ⇒ 三种候选的 fence 风险为零（候选③跨包改 request 类型时需复核）。
6. 磁盘格式：health 为内存 Map、`history.json` 为 append-only JSON、`cache` 为单键一文件，三种候选都不改结构。
7. `npm whoami` → `ENEEDAUTH`；`npm view @240xu/dsh-websearch version` → 2.8.8；`@deepseek-ai/dsh` dist-tags → `latest=0.2.2-rc.1 / next=0.2.2-rc.3`；runtime 实测 `0.2.2-rc.1`。
8. profile 只有 `pnpm-lock.yaml` + `package.json`，无 npm/yarn lock（patch-package 生成器硬阻塞的结构证据）。
9. G5 权威源现为 `G5-authoritative.patch`（37 段 / 3983 行，`refresh.sh` 自校验 35/35），A1 事故已由 README 记录。

### E.4 无法验证（诚实边界）

1. **真 GUI / 多会话并发下的 D5**：本轮用「两个 provider 实例 + 不同 resolveOptions」构造会话；产品运行时是**单实例**，真多会话并发等价于单实例连续调用，未在真实 Web GUI 多标签下观测（需启动会话，属运行时状态改动）。
2. **真上游 429 的原始 `Retry-After` / 真账号级配额下 B 是否真「全健康」**：无受控 429 服务；改 `searxngBaseURL` 指向 stub 会写 settings 用户数据（只读约束）。73 号 E2/E6 同样标注。
3. **候选①在真实安装副本 + 重启后的运行态**：本轮只在 `/tmp/a2-sandbox` 副本上验证源码与单测，未同步到 `$P`、未重启服务、未跑认证三 API 的 D8 字段（属运行时改动）。
4. **patch-package 在本机 profile 的 apply 闭环**：只读约束；74 号 X.7 第 4 条同样标注「可执行方案，非已验收方案」。
5. **PR CI 行为 / `compare/main...local-audit` 404 / npm publish 写权限 / `0.2.2-rc.3` 行为差异**：均为外部动作或未安装验证，沿用 74 号 X.7 的 E 登记。
6. **候选③若落地的 SDK 投影范围与 upgrade guide 影响面**：未跨包逐个核对消费者。
7. **E.1.1 history clear 跨会话丢失的真运行态**：只读复现需 POST `/api/websearch/history/clear`（写用户数据），本轮以源码 + `index.js` 单例推断，未实跑。

---

## F. 交付给 Lead 的 ≤12 行简报（另经 `send_message` 发出）

推荐**候选①**（注入式 `healthStore`，默认回退全局 Map）：2 文件、**80/80 全绿实测**、3b 快速失败与混合 fail-open 均保留、零磁盘格式、零 fence 影响、易回滚。**仍需用户点头**：生产 provider 是单例、`WebSearchRequest` 无 session 字段 ⇒ 候选①只隔离多实例，彻底修要跨包改 pre-stable seam；且 429 是账号级配额，D5 定级建议复议。一个硬阻塞：**patch-package NO-GO**（pnpm-only profile 无 npm/yarn lock，`npx patch-package` 报 `No package-lock.json…`）。新发现：`history clear` 删全局 `history.json`，比 D5 更直观的跨会话干扰，建议一并复议。落地：PR base GO 2.8.4 / NO-GO 2.8.8（6 hunk 冲突 + main 已是 2.8.8 的分叉回退）、`npm publish` NO-GO（`ENEEDAUTH`）、`0.2.2-rc.3` NO-GO（维持 `0.2.2-rc.1`）。

---
> 无凭证值写入本文件；所有结论可由文中只读命令复现。唯一写文件：本报告。
