# 73 · E1 独立评估：下一步技术缺口（终版 · 双时点）

> 任务：证伪「当前无未修 P0/P1」，找出下一步最该做的事。独立取证，**不共享 Lead 结论**；56/58/64/68/72 等历轮裁决只当线索，全部重跑。
> 唯一写文件：本文件。未改源码/配置/运行时/其它报告；未操作任务板；未重启服务；token/cookie/凭证值不落盘；所有复现脚本写在 `/tmp/e1-*.mjs` 并跑完删除。
> 采样窗口：2026-11-15 14:20–15:20 Asia/Shanghai。

## ⚠ 0. 双时点声明（本报告最重要的前提）

**取证窗口内，另一个会话并发修改了 `src-work/plugin/` 的源码与测试。** 本报告因此分两个时点，两者结论不同，不可混用：

| 时点 | src-work 状态 | 单测 | 与安装副本一致 | 「无未修 P0/P1」 |
| --- | --- | --- | --- | --- |
| **T1 = 14:20–14:55** | 题给基线（35 文件、73 测试） | **73/73** | **36/36 逐字节一致** | **证伪成立：4 条未修 P1** |
| **T2 = 15:17（本文件定稿）** | 并发修复中：`index.js`/`provider.js`/`settings-api.js`/`util/mcp-client.js` + 4 个测试文件被改写 | **78/78** | **破坏：4 个 lib 文件 + 4 个测试文件 DIFF，安装副本仍是 11-11/11-12 的旧版** | **修复尚未上线；当前 runtime 仍跑旧代码，故运行时层面依旧是 4 条未修 P1** |

证据：T1 的 `diff -u` 全量零差异；T2 再跑同一命令得 `diffcount=4`（`lib/index.js` / `lib/provider.js` / `lib/settings-api.js` / `lib/util/mcp-client.js`），安装副本这 4 个文件 mtime 仍是 `2026-11-11 16:35`–`11-12 05:16`，而工作副本是 `15:01`–`15:15`。测试侧 `lead-20261107.test.js` / `lead-20261108-interaction.test.js` / `lead-20261108-sse.test.js` / `settings-api.test.js` 同样 DIFF，安装副本 mtime 停在 `11-11 23:06`。服务 PID 3207503 自 11-14 22:28 启动、**未重启**，`/proc/3207503/maps` 解析的是安装副本 ⇒ **T2 的代码修复对当前 runtime 零生效**。

**这个并发改写本身反而是「证伪」最强的证据**：对方在收到我的 E1 预警后，把我报的 N1/N2/N4/N3-id/G2 逐条落地（新增断言名逐字对应：`oversized settings POST returns 413`、`N2: changing a backend's baseURL invalidates the cache`、`N4: session cache is keyed by credential; handshake carries the key`、`tools/call ids avoid initialize`、`partial route registration rolls back on a duplicate route`），说明「无未修 P0/P1」在 T1 确实不成立。

---

## 1. 取证基线与方法（A/D）

| 项 | T1 实跑 | T2 复核 |
| --- | --- | --- |
| 35 改动文件 | `src-work/plugin` ↔ `/home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/` 逐文件 `diff -u` 零差异、反向无多余（实为 36 个含 `cordis.patch.yml`） | **DIFF 4 个 lib + 4 个 tests**，见 §0 |
| 单测 | `node --test tests/*.test.js` → 73/73 pass | 78/78 pass（新增 5 条断言） |
| runtime | `/opt/dsh-0222`（node24）、cmdline 无 `--patch`。**题给 PID 2731223 已退出**；真实服务 **PID 3207503** `/opt/node24/bin/node /opt/dsh-0222/.../bin.js web --no-open --host 127.0.0.1 --port 3080 --trusted-host 192.168.1.7 --trusted-host dsh.sepic.space`，已运行约 16h | 未重启 |
| 认证 | 无凭据三 API + `/` 全 401 `{"ok":false,"error":"untrusted request"}`；从 `/home/ova/re-agent/dsh-web.log` 取 launch token → 303 + HttpOnly `dsh-auth-*` cookie → 带 cookie + loopback Origin 三 API **全 200** | 同 |
| D8 字段 | `health.requestedMaxResults=8`、13 后端含 `rateLimited/keylessRejected/cooledUntilMs`；firecrawl 三字段有值 | 同 |
| 真 cordis 语义 | 用 `/opt/dsh-0222/node_modules/@deepseek-ai/cordis` 真 `Context`/`Service` 复现 `effect` 生命周期 | 同 |

**独立性**：65 号（`65-assessment-code.md`）正文结论是「证伪成立，存在未修 P0/P1，5 条 P1：N1/N2/N3/N4/N5」；68 号汇总却写成「V1 证伪失败、无未修 P0/P1」。我未采信任一方，直接以当时源码 + node 行为级复现裁决：**T1 时 N1/N2/N3/N4 仍在、N5 已修**。

---

## A. 仍存缺陷清单（P0/P1/P2）

> 每条给出：现状 / 影响 / 最小修法 diff 片段 / 回归断言 / **T2 状态**。T2 已修的条目保留完整记录，因为**修复未同步到安装副本、未重启，当前 runtime 仍受影响**；且这些 diff 正是下一步验收的对照物。

### A.1 [P1 / A+D] N2 · 缓存键漏掉全部后端级设置 → 改配置 900s 内仍返回旧实例结果

- **现状（T1）**：`lib/provider.js:246-252` 构造 `resultOptions` 时只遍历 `opts` **顶层**键；但 `lib/index.js:368-390` 的 `resolveOptions()` 把 `baseURL`/`model`/`apiKeyEnv`/`safeSearch`/`searchDepth` 全放在嵌套 `opts.backends[id]`。`resultOptions` 实际只含 8 个全局项。`lib/cache.js:34` 注释却明写「per-backend base URLs and models」。
- **影响**：改 `searxngBaseURL` 指向另一实例、切 `safeSearch`、换 `deepseekModel`、改 `tavilySearchDepth`、轮换 `firecrawlApiKeyEnv` 后，同一 query 在默认 `cacheTtl=900s` 内**全部命中旧缓存、0 次后端调用**，返回上一个实例/上一档参数的 URL。设置保存「看起来生效」但被缓存掩盖。
- **T1 独立复现**：真 `createUnifiedSearchProvider` + 真 `createSearchCache`：
  ```
  search1: calls=1 | url=https://A.example/result
  baseURL='https://B.example'          // 模拟 Settings 保存
  search2: calls=1 | url=https://A.example/result
  VERDICT: BUG CONFIRMED: baseURL change served STALE cached result, backend never re-hit
  ```
  直接算键：`baseURL/searchDepth/safeSearch/model` 四种变化后 `cacheKeyFor(...) === 'aa6b2c6517f7a15a991058e6b66c1042'` 全部相同。
- **最小修法 diff 片段**（与 T2 实际落地一致）：
  ```diff
         for (const [k, v] of Object.entries(opts)) { /* 现有全局项 */ }
  +      // resolveOptions() keeps per-backend settings under opts.backends[id].
  +      for (const id of opts.enabledBackends ?? []) {
  +        const be = opts.backends?.[id];
  +        if (!be || typeof be !== "object") continue;
  +        for (const k of ["baseURL", "model", "searchDepth", "safeSearch", "apiKeyEnv"]) {
  +          if (be[k] !== undefined) resultOptions[`${id}.${k}`] = be[k];
  +        }
  +      }
  ```
  `apiKeyEnv` 只是环境变量名、非密钥值，入键不泄密；轮换凭证值而名字不变仍靠 TTL，属可接受取舍。
- **回归断言**：① 改 `opts.backends.brave.baseURL` → `cacheKeyFor` 不同；② 真 provider 第二次 `search` 的 `calls` 1→2、`sources[0].url` 随实例变化；③ `safeSearch`/`tavilySearchDepth`/`deepseekModel` 各一条键差异断言；④ 旧 8 全局项不变。
- **T2 状态**：**工作副本已修**（`provider.js` 摊平循环），T2 复跑 `N2 key(A)===key(B)? false`、`N2 e2e: calls=2, r2.url=https://B.example/r FIXED`；新增测试 `N2: changing a backend's baseURL invalidates the cache`。**但 `lib/provider.js` 与安装副本 DIFF，runtime 仍跑旧版 ⇒ 当前仍受影响。**

### A.2 [P1 / A+D] N4 · MCP `sessionCache` 纯 URL 键控 + keyed 握手缺鉴权头

- **现状（T1）**：`lib/util/mcp-client.js:17,26,101,150-151,172,206,208` —— `sessionCache` 键只有 `url`；`ensureSession(url, signal, options)` 不接收 `extraHeaders`；`initialize`（:49-53）与 `notifications/initialized`（:83-87）头硬编码、无 `...extraHeaders`；401/403/404 重试的 `ensureSession(url, signal)` 同样无 key。`extraHeaders` 只在 `tools/call` 出现。`forceFreshSession` 只是**调用方约定**（当前仅 `tinyfish.js:77` keyed 分支传）。
- **影响**：① 同一 MCP URL 换 API key（任何未显式传 `forceFreshSession` 的 sessionful 调用）复用旧 `Mcp-Session-Id`；② keyed TinyFish 的 `X-API-Key` 不覆盖整条会话链，`initialize` 在真服务端可能直接 401，且该失败**不被 tools/call 的 401 重试覆盖**。
- **T1 独立复现**（本地真 HTTP 捕获请求头，两把假 key、均不传 `forceFreshSession`）：
  ```
  initialize count: 1 (expect 2; 1 = session leak)
  initialize requests carrying X-API-Key: 0 / 1
  tools/call(id=2, X-API-Key=KEY_A, Mcp-Session-Id=SESSION-B)
  tools/call(id=2, X-API-Key=KEY_B, Mcp-Session-Id=SESSION-B)
  ```
  即 KEY_A 的 tools/call 拿到 KEY_B 会话、握手全程无 key。**不需要真 key**即可证伪「需真 key 才能验证」。
- **最小修法 diff 片段**（与 T2 实际落地一致）：
  ```diff
   const sessionCache = new Map();
  +function sessionCacheKey(url, extraHeaders) {
  +  const auth = Object.entries(extraHeaders ?? {})
  +    .filter(([k]) => /^(authorization|x-api-key|x-tinyfish-access-mode)$/i.test(k))
  +    .sort(([a],[b]) => a.localeCompare(b))
  +    .map(([k,v]) => `${k.toLowerCase()}:${String(v)}`).join("|");
  +  return `${url}\0${auth}`;
  +}
  -async function ensureSession(url, signal, options = {}) {
  +async function ensureSession(url, signal, options = {}, extraHeaders = {}) {
  +  const key = sessionCacheKey(url, extraHeaders);
  -  const cached = sessionCache.get(url);                    +  const cached = sessionCache.get(key);
  @@ initialize / notifications headers 各加  +      ...extraHeaders,
  -  sessionCache.set(url, …);                                +  sessionCache.set(key, …);
  -export function invalidateSession(url) { sessionCache.delete(url); }
  +export function invalidateSession(url, extraHeaders) { sessionCache.delete(sessionCacheKey(url, extraHeaders)); }
  -  await ensureSession(url, signal, { forceFreshSession: … });
  +  await ensureSession(url, signal, { forceFreshSession: … }, extraHeaders);
  -    invalidateSession(url); const newSessionId = await ensureSession(url, signal);
  +    invalidateSession(url, extraHeaders); const newSessionId = await ensureSession(url, signal, {}, extraHeaders);
  ```
  ⚠️ T2 的 `invalidateSession(url, extraHeaders)` 把第二参数改成**必传**；应保留 `= {}` 默认值，否则任何外部按旧签名 `invalidateSession(url)` 调用会算出 `undefined` 的键（本模块当前只有 mcpCall 内部调用，但它是导出 API）。
- **回归断言**：同 URL + 不同 `X-API-Key` 的两次 sessionful `mcpCall` 触发 2 次 initialize 且 tools/call 带不同 session id；每个 initialize/notification/重试 initialize 都带 `X-API-Key`；`invalidateSession(url, hdrs)` 只删对应键；keyless `X-TinyFish-Access-Mode` 同样参与键控。
- **T2 状态**：**工作副本已修**。T2 复跑 keyed 真实产品路径（`{skipInitialize:false,forceFreshSession:true}`）：`initialize count=2 | with X-API-Key=2/2 | 2 distinct sids=2`；且不传 `forceFreshSession` 的两把 key `initialize count=0`（键控生效、会话复用但按 key 隔离）。新增测试 `N4: session cache is keyed by credential; handshake carries the key`。**`lib/util/mcp-client.js` 与安装副本 DIFF ⇒ runtime 仍跑旧版。**

### A.3 [P1 / A+D] N3 · MCP `id` 契约：plain-JSON 不校验 id + `skipInitialize` id 撞 initialize

- **现状（T1）**：`mcp-client.js:178` `id: options.skipInitialize ? 1 : 2` 与 `initBody.id=1` 撞号；SSE 挑帧用严格 `r.id === expectedId`（:128），plain-JSON 分支（:138-141）直接 `return parsed`（注释以「stateless 可回显别的 id」为由放弃校验）；batch 分支却用 `String(r.id) === String(expectedId)`。三种口径不一致。
- **影响**：① 单流 SSE 中先出现 id=1 的 initialize 形状帧 → `parseEnvelope(sse,1)` 把 `serverInfo` 当搜索结果返回（`mcpCall:241` 的 `!envelope.result` 真值检查抓不到）→ 静默错误结果进模型上下文；② plain-JSON 收到 `id=7`（同连接复用、代理合并响应、服务端推送）原样当本调用结果；③ `id:"1"` 字符串帧被丢弃。
- **T1 独立复现**：
  ```
  N3 skipInitialize plain-JSON id=7 result: {"content":[{"text":"WRONG-ID-RESULT"}]}
  N3 SSE decoy result: {"protocolVersion":"2025-06-18","serverInfo":{"name":"DECOY"},"capabilities":{}}
  VERDICT: BUG: decoy initialize frame returned as search result
  ```
- **最小修法 diff 片段**（T2 只落地了前两处）：
  ```diff
  -    id: options.skipInitialize ? 1 : 2,
  +    id: options.skipInitialize ? 2 : 3,   // never reuse initialize's id=1
  @@ SSE
  -      const match = candidates.find((r) => r && r.id === expectedId
  +      const match = candidates.find((r) => r && String(r.id) === String(expectedId)
  @@ plain JSON —— T2 未做，且现有测试明确把它固定为「permissive」
     try {
       const parsed = JSON.parse(body);
       if (Array.isArray(parsed)) return parsed.find((r) => String(r.id) === String(expectedId)) ?? parsed[0];
  -    return parsed;
  +    if (parsed && typeof parsed === "object" && parsed.id !== undefined
  +        && String(parsed.id) !== String(expectedId)) {
  +      throw new WebError("MCP: response id does not match the request", "WEB_PROVIDER_ERROR");
  +    }
  +    return parsed;
     } catch {}
  ```
  ⚠️ `catch {}` 包住整个 plain-JSON 分支，新抛的 `WebError` 会被吞掉并退化成 `failed to parse response envelope`；必须把 id 校验移出 `try` 或在 `catch` 里重抛。同时 `sse.test.js` 的 `plain JSON keeps permissive id handling for stateless MCP endpoints` 要改成期望抛错。
- **回归断言**：混合 SSE（id=1 decoy + id=2 real）返回 real；plain-JSON `id=7` 抛 `MCP: response id does not match the request`；`id:"2"` 的 SSE 帧被接受；现有 BOM/CRLF/多 data 行/batch 用例仍过。
- **T2 状态（分裂）**：
  - ✅ **已修**：`id: skipInitialize ? 2 : 3`、SSE 改 `String()` 比较。T2 复跑 `N3b SSE decoy -> {"content":[{"text":"REAL"}]} FIXED`、`N3c SSE id="2" -> STRING-ID FIXED`；新增测试 `tools/call ids avoid initialize; SSE id matching is string-tolerant`。
  - ❌ **仍未修（且被测试固化）**：`N3a plain-JSON id=7 -> {"content":[{"text":"WRONG-ID"}]} <-- STILL ACCEPTED`。当前 `sse.test.js` 仍有 `✔ plain JSON keeps permissive id handling for stateless MCP endpoints`，`mcp-client.js:145-147` 注释也仍写「Response ids are not enforced here」。⇒ **这是 T2 唯一仍在工作副本里存在的 P1 级协议缺陷**（需产品决策：stateless 端点是否允许错 id；若允许，至少应与 SSE 口径一致或记录可观测告警）。

### A.4 [P1 / A+D] N1 · `readBody` 超限把 413 变成 `ECONNRESET`

- **现状（T1）**：`lib/settings-api.js:259-269` 在 `size > 64KB` 时 `rejectBody(413)` → 移除 data/end/error 监听 → **`req.destroy()`** 销毁 socket，`guarded()` 的 `sendJson(res,413,…)` 写不出去。注释「Stop consuming and release the stream」与实际相反。
- **影响**：>64KB 的 settings POST 客户端只拿到连接重置；GUI `writeNow`（`client.js:264-275`）显示笼统 `write rejected`，无法提示「body 太大」；keep-alive 报废。
- **T1 独立复现**：真 `http.createServer` + `registerSettingsRoutes`，POST 70KB → `{"error":"ECONNRESET"}`。
- **最小修法**：`req.destroy()` → `req.resume()`（一行）。
- **回归断言**：POST 70KB → 413 且 body 含 `request body too large`；同连接后续 GET 200；`mutate` 调用数 0。
- **T2 状态**：**工作副本已修**（`req.resume()`），T2 复跑 `{"status":413,"body":"{\"ok\":false,\"error\":\"request body too large\"}"}`；新增测试 `oversized settings POST returns 413, not ECONNRESET`。**`lib/settings-api.js` 与安装副本 DIFF ⇒ runtime 仍跑旧版。**

### A.5 [P2 / A+D] G1 · D5 不是「仅运行态遥测污染」，而是跨会话功能性干扰 —— **T2 仍未修（最该排期的下一件事）**

- **现状**：`lib/provider.js:57` `latestBackendHealth` 是**模块级单例 Map**，health/history 的 `getLatestBackendHealth` 与 3b 的 `cooled` 判定全读它。70/72 号裁决「产品语义，登记 Known Limitation，不修代码」。T2 复核 `grep -c healthStore lib/provider.js` → **0**，未动。
- **本轮新证据**（默认 4 后端配置，真 provider）：
  ```
  A: sources=3 | exa cooled/rateLimited=true true
  B: sources=3 | backends called=parallel,ddg,searxng
     -> exa skipped for B? YES (A's quota state suppressed B's healthy exa)
  B after A2 all-429: err="unified search: all backends are rate-limited; retry after ~60s"
  ```
  即：会话 A 的一个 429 让**同进程会话 B** 少一个健康后端；A 全后端 429 让全健康的 B **直接快速失败**。这不是统计口径，是 3b（`provider.js:326-341`）把全局熔断态当 per-request 决策输入。历轮「不修」裁决低估影响面。
- **影响**：多会话/多 agent 并发时，一个会话的配额冷却静默降低其它会话召回率，极端情形整站搜索不可用 60s。
- **最小修法（渐进，不动磁盘格式）**：把 `cooled` 判定输入从全局 Map 改为注入的 per-instance store；health/history 路由继续读全局只读视图。
  ```diff
  - const latestBackendHealth = new Map();
  - export function getLatestBackendHealth() { return latestBackendHealth; }
  + export function createHealthStore() { return new Map(); }
  + // createUnifiedSearchProvider({ ..., healthStore = new Map() }) uses it for
  + // isCooled()/recordBackendHealth(); index.js injects one per plugin instance.
  ```
- **回归断言**：两个 `createUnifiedSearchProvider` 实例用不同 healthStore，A 全 429 后 B 仍返回 4 后端结果；现有 3b/混合冷却测试改用注入 store 后仍全绿。

### A.6 [P2 / A+D] G2 · `webCtx.effect` 注册中途抛错泄漏路由且不可自愈

- **现状（T1）**：`lib/index.js:533-558` 在一个 `webCtx.effect` 里用**数组字面量**连续调用 3 个 `registerXxxRoutes`；任一 `ws.register` 抛 `duplicate exact route`（host `dsh-host-webserver/lib/index.js:375-383` 确实抛），effect 的 `execute` 抛错 → **不返回 disposer**，前面已成功的路由永久留在表里。`registerXxxRoutes` 的 `return typeof disposer === "function" ? [disposer] : []` 只在「无返回值」时兜底，管不了「调用中途抛」。
- **T1 独立复现**（真 cordis `Context`，按 index.js 真实形态，预占第 3 条 `/api/websearch/history`）：
  ```
  after load : routes=2  → /api/websearch/history(foreign), /api/unified-search/health(LEAKED)
  after restart (外部冲突已解除) : routes=1, loads=2, disposeCalls=0
                                   names= /api/unified-search/health
  after 2 restarts (冲突持续)   : loads=3, routes=2, disposeCalls=0
  ```
  **关键**：解除外部冲突后再 reload，泄漏的 health 自己成了新的 duplicate 源，第一个 register 又抛 → `disposeCalls=0`、4 条业务路由仍全部缺失，即「冲突源消失也恢复不了」。另一边缘（预占第 1 条 health）：连续 3 次 restart 仍 `routes=1`、`errs=[]` —— 插件一条路由都没注册上，cordis 只把错误记进 logger，外部无可见失败。对照组（注册循环包进 try/catch 并保留已得 disposer）：`after restart → routes=4, disposed=1`，可完整恢复。
  正常路径无冲突时 `restart`/`dispose` **通过**（`loads=2, routes=2, providers=1`；dispose 后 `routes=0, providers=0`），真 `Service` 复现也确认 `ctx.web.registerSearchProvider` 用 `Service` 的 `this.ctx.effect`，disposer 归 web service fiber，插件卸载后 provider 归 0 —— 「`ws.register` 之外」无同类遗留。
- **影响**：需另一插件/重复加载先占任一 `/api/unified-search/*` 或 `/api/websearch/*` 路径才触发；一旦触发，HMR/重载无法恢复，需重启进程。低概率高僵死，P2（当前 runtime 无冲突、三 API 200）。
- **最小修法**：把 3 个 register 改成增量 `for` + `try/catch` 内 `disposers.reverse()` 回滚后重抛（与 T2 落地一致）。
- **回归断言**：mock 第 3 次 register 抛错 → 前 2 条路由立即删除（`table.size===1`，仅剩外部预占那条）；冲突解除后 reload 能完整注册 4 条；正常路径 4 disposer 全删路由的现有断言仍过。
- **T2 状态**：**工作副本已修**（`index.js:533-570` 增量注册 + `best-effort rollback`），新增测试 `partial route registration rolls back on a duplicate route`。**`lib/index.js` 与安装副本 DIFF ⇒ runtime 仍跑旧版。**

### A.7 [P2 / A+D] G3 · `createLimiter(0)` 永久挂起（无响应、无超时）

- **现状（T1）**：`lib/provider.js:93-119` `while (running < concurrency && queue.length > 0)` 对 `concurrency<=0` 永不进入；`runBackend` 的 `setTimeout` 在 `limit()` 之后才创建，**连 30s 超时都救不了**。`provider.js:223` 用 `opts.concurrency ?? 6`（`??` 不拦 0）。
- **T1 独立复现**：
  ```
  createLimiter(0) settled after 120ms: false <-- HANGS FOREVER
  provider concurrency=0 done after 200ms: false | backend calls: 0 <-- NO RESPONSE
  ```
- **边界判定（为何 P2 不是 P1）**：`index.js:164` `Config.concurrency` 是 `z.number().step(1).min(1).max(10)`，实测 `0/-1/1.5/"x"` 全部 THROW；GUI `client.js:489-499` 镜像 `[1,10]`；settings bridge `validateOp` 用 `config.dict[field]` 校验。正常产品路径写不进 0，但手写 profile / embedder 仍可达。
- **最小修法**：`const limit = Math.max(1, Math.floor(Number(concurrency) || 1));` 并把 while 条件改用 `limit`。
- **回归断言**：`createLimiter(0)/(-1)/(NaN)` 各 50ms 内 resolve；`concurrency=0` 的 provider 仍返回结果不挂起；`createLimiter(6)` 并发上限不变。
- **T2 状态**：**工作副本已修**（`provider.js:93` 出现 `Math.max(1, Math.floor(Number(concurrency) || 1))`，注释明写「Config and the GUI validate [1,10], but the limiter also receives values from hand-written profiles and embedders」）。属 §0 的 4 个 DIFF 文件之一。

### A.8 [P2 / A+D] D3 修法引入「过期正向注记」—— **T2 仍未修**

- **现状**：`lib/provider.js:294` `nowMs = Date.now()`（扇出时刻），`:515` `cooledAnnotation(centry, nowMs)`，非空就 push。修法消除了原「无秒数裸串」，但把注记**钉死在扇出时刻**：若窗口在搜索期间（实测最长 8.1s）到期，遥测仍输出 `⏸cooled Ns`，而后端此刻已可重试。T2 `grep -c "expired during search"` → 0。
- **独立复现**：`nowMs=1_000_000, centry.cooledUntil=nowMs+3_000, renderMs=nowMs+8_000` → 注记 `"⏸cooled 3s"`，而 `isCooled(centry, renderMs) === false`。
- **影响**：模型/运维看到「正在冷却」时其实已可重试；方向保守（不会重打限流端点），P2。
- **最小修法**：
  ```diff
  -  if (ann) cooledParts.push(cid + " " + ann);
  +  if (ann) cooledParts.push(cid + " " + ann
  +    + (!isCooled(centry, Date.now()) ? " (expired during search)" : ""));
  ```
- **回归断言**：窗口跨过扇出→渲染边界时注记含 `expired`；未过期的现有 `⏸cooled 24s` 断言不变；无裸串兜底。

### A.9 [P1 / A+D] **NEW · T2 · 工作副本与安装副本失同步，修复未上线** —— 下一步最急

- **现状**：T2 时 `src-work/plugin` 有 4 个 lib + 4 个 tests 与 `/home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/` 逐字节不同；安装副本 mtime 停在 11-11/11-12，服务 PID 3207503 自 11-14 22:28 起未重启。新增的 5 条断言也只在工作副本里。
- **影响**：① 当前 runtime 实际仍跑 N1/N2/N4/N3-id 全部旧代码，任何「已修」的运行态结论都是假的；② 35/35（36/36）一致性这一历轮收口基线已破坏，若此时做对外 PR / publish / 打包，会把**旧代码**当成新版发布；③ 安装副本 `tests/` 少 5 条断言，任何人从安装副本跑 `node --test` 得 73/73 而非 78/78。
- **最小修法/验收命令**（本轮只读，不执行）：
  ```bash
  SRC=/home/ova/dsh/.artifacts/websearch-research/src-work/plugin
  DST=/home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch
  for f in lib/index.js lib/provider.js lib/settings-api.js lib/util/mcp-client.js \
           tests/lead-20261107.test.js tests/lead-20261108-interaction.test.js \
           tests/lead-20261108-sse.test.js tests/settings-api.test.js; do
    cp -p "$SRC/$f" "$DST/$f"
  done
  for f in $(cd "$SRC" && find . -type f \( -path './lib/*' -o -name '*.json' -o -name '*.md' -o -name '*.yml' \) \
       ! -path './node_modules/*' ! -path './test-node_modules/*' ! -path './tests/*' | sed 's|^\./||'); do
    diff -u "$SRC/$f" "$DST/$f" || exit 1
  done
  cd "$DST" && node --test tests/*.test.js   # 期望 78/78
  # 然后按 25 §6 的回滚链重启服务，再跑认证三 API + web_search 遥测 + health D8 字段
  ```
- **回归断言**：36/36 逐字节一致（含 `cordis.patch.yml`）；`cd DST && node --test` → 78/78；重启后 `GET /api/unified-search/health` 200、`requestedMaxResults`/三字段有值；真 `web_search` 遥测出现、`POST 70KB` → 413 而非 ECONNRESET。

### A.10 [P3 / A] 已确认「已修」的项（不重复计入缺陷）

| 项 | 复核结论 | 证据 |
| --- | --- | --- |
| N5 3b 混合故障 fail-open 重打限流端点 | **已修**：`provider.js:321-348` 用 `rateLimitedCooled` + `failOpen = active + 非配额 cooled`，仅当 `failOpen.length===0 && rateLimitedCooled.size>0` 才快速失败 | A + `lead-20261109-3b-runtime.test.js` |
| D6 校验前比 revision 绕过 mutate CAS | **已修且 CAS 有效**：`settings-api.js:170-178` 校验前统一比 revision；host `mutate` 权威 CAS。真并发双写复现 `200 + 409, final revision=8` | A/D |
| `return write(...)` 边缘 | **已处理**：`settings-api.js:66` 返回 promise，`guarded` 的 `.catch` 接住；`readBody` 的 `error` 事件返回 400、`end` 正常返回、`writableEnded=true`，无 unhandledRejection | A/D |
| `webCtx.effect` 正常路径 disposer | **有效**：真 cordis `restart` → `loads=2, routes=2, providers=1` 无 duplicate；`dispose` → `routes=0, providers=0` | A/D |
| `ctx.web.registerSearchProvider` 生命周期 | **无遗留**：真实 `Service` 的 `registerProvider` 内部 `this.ctx.effect(...)` 把 disposer 挂 web service fiber；插件 dispose 后 provider 归 0 | A/D |
| D8 追加字段 | **全在且运行态有值**：health 顶层 + 13 后端、history 6 后端三字段；旧键保留、无凭证泄漏 | A/D |
| 429 `Retry-After` 透传链 | **通**：`webErrorFromResponse` → `err.retryAfter` → `retryAfterMsFrom` → `foldBreaker` → `cooledAnnotation`，6 种输入（17s/http-date/超大/过去日期/垃圾/缺失）全按预期；403 不误判配额 | A/D（合成 Response） |
| Config schema 边界 | `concurrency/numResults/backendTimeoutMs/cacheTtl` 的 `0/-1/1.5/"x"` 全 THROW；GUI 镜像 `[1,10]` | A/D |
| D8 `cooledUntilMs` 化石戳 | 设计取舍：health 从不主动探测；建议加 `cooledActive` 派生布尔，非 bug | A/D（75 号 N7 同源） |

---

## B. E 项可达性逐条（当前 runtime `/opt/dsh-0222` / PID 3207503 / node24）

> **可做** = 本轮已实跑或有明确只读/无状态变更命令可立即执行；**不可做** = 需重启、写用户数据、真凭证、真浏览器会话，或会改运行时/其它报告（超出本评估约束）。

| # | 历轮标 E 的验证项 | 可做？ | 具体命令 / 阻塞原因 |
| --- | --- | --- | --- |
| E1 | 真 HMR / 插件卸载触发 disposer | **部分可做（等价验证已完成）** | 真 GUI HMR 需 `pnpm run dev:web` watcher（当前 `ps` 无 vite/tsdown watch，服务是构建产物）。等价：`node /tmp/e1-cordis-effect3.mjs` 用真 `Context`+`Service`，`await fiber.restart()` / `await fiber.dispose()`，断言 `routes 2→2→0`、`providers 1→1→0`、无 duplicate。真卸载：`plugin_manager({action:"set_plugin",target:"dsh-websearch",enabled:false})` → `curl -b <cookie> …/health` 应 404 → `enabled:true` 恢复；**会改运行时状态**，本轮不做，需 Lead 批准。 |
| E2 | 真 429 的 `Retry-After` 原始响应头 | **可做（合成层已做）/ 真上游头不可做** | 合成：`new Response('slow',{status:429,headers:{'Retry-After':'17'}})` → `webErrorFromResponse` → `retryAfterMsFrom`，本轮 6 种输入全通过。真头：需受控 429 服务 + 改 `searxngBaseURL` 指向本地 stub（**写 settings 用户数据**）；私网白名单 `provider.js:375` 只放行 RFC1918。命令模板：`POST /api/unified-search/settings {"ops":[{"op":"set","path":["searxngBaseURL"],"value":"http://127.0.0.1:PORT"}],"expectedRevision":N}`，stub 返 `429 + Retry-After: 17`，再 `web_search` 查 `cooledUntilMs`。本轮约束未做。 |
| E3 | 真并发双写 TOCTOU | **可做（已完成等价验证）** | `node /tmp/e1-d6-toctou3.mjs`：两个 `registerSettingsRoutes` 的 POST 同 `expectedRevision=7` 并发，mock host `mutate` 做权威 CAS → `200 + 409, final revision=8`。真 GUI 双标签并发写会改用户设置，本轮未做；命令：两路 `curl -b <cookie> -X POST …/settings` 同时发。 |
| E4 | GUI 目视新字段 | **不可做（结构性）** | `grep -c "unified-search/health\|websearch/history" lib/client.js` → **0**；D8 四字段在 client.js 出现 **0 次**。设置卡片只 fetch `/api/unified-search/settings`，没有渲染 `rateLimited/keylessRejected/cooledUntilMs/requestedMaxResults` 的任何元素 ⇒ 目视「新字段」无对象可看。可做的只有带 cookie GET 三 API 看 JSON（本轮已做，200 + 字段有值），或 Playwright 目视**旧**设置卡片。要真目视需先在 client.js 加健康面板，属功能开发。 |
| E5 | keyed TinyFish 握手带 `extraHeaders` | **可做（已完成，且证伪「需真 key」）** | 不需真 key：本地 `http.createServer` 捕获请求头 + `mcpCall(url,'search',…,{'X-API-Key':'KEY_A'},…,{skipInitialize:false,forceFreshSession:true})` 即可观测。T1 实跑 `initialize count:1 / 带 key 的 initialize 0/1`；T2 修复后 `2/2`。真 `agent.tinyfish.ai` keyed 链路：`/proc/3207503/environ` 里 `TINYFISH_API_KEY` **unset**、`.credentials.yaml` refs 只有 `ZEN/WBGL/WBCN`，无真 key ⇒ 真链路不可做（且需写凭证）。 |
| E6 | 3b 在真实「全部后端同时 429」下触发 | **不可做（条件不满足）** | 认证只读 `health`：启用 6 后端 `exa,parallel,ddg,searxng,firecrawl,tinyfish`；仅 firecrawl `rateLimited=true,keylessRejected=true` 且 `cooledActive=false`（冷却戳已过期）；`allEnabledQuotaCooled=false`。要真触发须让 6 后端同窗口 429（真限流或 stub 劫持全部 baseURL），需改配置 + 外部条件。行为级等价由 `lead-20261109-3b-runtime.test.js` 覆盖；本轮另用真 provider 复现了跨会话 3b 误触发（§A.5）。 |
| E7 | D5 按 session 隔离后的产品行为 | **可做（干扰侧已做；隔离侧需实现）** | 干扰侧 `node /tmp/e1-d5-real.mjs` 已复现。隔离侧（注入 healthStore）T2 仍未实现（`grep healthStore → 0`），属 §A.5 修法，需改 `lib/` → 78 单测 → 36 文件同步 → 重启，超出本轮只读约束。 |
| E8 | `ws.register` 之外的产品语义遗留 | **可做，本轮已复核** | ① `ctx.web.registerSearchProvider` 生命周期（真 Service 复现，无遗留）；② `isComplexQuery` 查询语义（65 号 N8 P2）；③ `sanitizeError` 加固（65 号 N9 P2）；④ `resultHeader:false` 契约静默删除（65 号 N10 P2）；⑤ `/tmp` 会话 JWT 清理；⑥ 3b 混合故障细策略（N5 已修）；⑦ D7 缓存键含原始 `numResults` 碎片（61 号 P3）。**结论**：真正值得动的只有 §A.3 的 plain-JSON id 与 §A.5 的 D5；其余属打磨，需用户决定。 |

---

## C. 优先级排序（P0 → P3，含理由）

| 序 | 事项 | 级别 | 理由 | 推翻「无未修 P0/P1」？ |
| --- | --- | --- | --- | --- |
| 1 | **§A.9 同步 8 个文件到安装副本 + 重启 + 复跑 78/78 与运行态** | **P0（T2 最急）** | 4 条 P1 的修复**只在工作副本**，当前 runtime 仍跑 11-11 旧代码；35/35 收口基线已破坏。不同步就发布/PR 会把旧代码当新版 | 是（运行时层面 4 条 P1 仍全在） |
| 2 | **§A.3 剩余半条：plain-JSON 错 id 仍被接受** | **P1** | T2 唯一在工作副本里仍存在的协议缺陷，且被 `sse.test.js` 断言固化为「permissive」；与 SSE 分支口径自相矛盾。修法小但要同步改测试与注释、避开 `catch {}` 吞异常 | **是** |
| 3 | **§A.5 G1 D5 跨会话功能性干扰** | **P2（建议提级）** | 真 provider 复现：A 全 429 → 全健康的 B 直接 3b 快速失败 60s。历轮「登记不修」低估影响面。注入 healthStore 不动磁盘格式 | 间接（历轮裁决失真） |
| 4 | §A.8 D3 过期正向注记 | P2 | `⏸cooled 3s` 在窗口已到期时仍输出，误导但方向保守；1 行改措辞 | 否 |
| 5 | §A.2 落地细节：`invalidateSession(url, extraHeaders)` 第二参数应给 `= {}` 默认值 | P2 | 导出 API 被改成必传第二参，外部按旧签名调用会算出错误缓存键 | 否 |
| 6 | §A.1–A.4 / A.6 / A.7 的修复验收 | P2 | 工作副本已改，但需按 §A.9 同步后跑真实运行态（413 / 改 baseURL 后重新扇出 / keyed 握手 / 部分注册冲突）确认无回归 | 否 |
| 7 | E4 GUI 补健康面板 / `cooledActive` 派生布尔 / D7 缓存碎片 / `isComplexQuery` / `sanitizeError` / `resultHeader` 契约 | P3 | 打磨与产品语义取舍，不阻塞当前可用性；需用户决定 | 否 |
| 8 | 对外 PR / patch-package / 升级 0.2.2-rc.1 / `npm publish` | P3 | 不可逆外部动作，需用户点头；且必须等 §A.9 同步完成，否则发布旧代码 | 否 |

**最该先做的 2 件事**：
1. **同步 + 重启 + 验收**（§A.9）：把 4 个 lib + 4 个 tests 拷到安装副本，36/36 逐字节一致，`cd DST && node --test` 得 78/78，按 25 §6 回滚链重启服务，再跑认证三 API / `web_search` 遥测 / 70KB POST→413。不做这步，任何「已修」结论都不成立。
2. **补完 N3 的 plain-JSON id 校验**并重裁 68/70/72 的「D5 不修」：前者是 T2 唯一残留 P1；后者已实测造成跨会话整站快速失败。否则下一轮仍会用错误的收口结论跳过同一批缺陷。

---

## D. 已确认无误 / 无法验证 / 5 条反直觉

### D.1 已确认无误（A/D）
1. T1 `node --test tests/*.test.js` → **73/73**；T2 → **78/78**（均本轮实跑）。
2. T1 36 文件 `diff -u` 与安装副本逐字节一致、反向无多余；T2 精确列出 8 个不同步文件。
3. 真 cordis 正常路径：`restart` 后 `loads=2, routes=2, providers=1` 无 duplicate；`dispose` 后 `routes=0, providers=0`。
4. `ctx.web.registerSearchProvider` 用 `Service` 的 `this.ctx.effect`，disposer 归 web service fiber，插件卸载后 provider 归 0 ——「`ws.register` 之外」无同类遗留。
5. D6：校验前统一比 revision，host `mutate` 权威 CAS；真并发双写 `200+409, final revision=8`。
6. `return write(...)`：`guarded` 的 `.catch` 接住，`writableEnded=true`，无 unhandledRejection；`readBody` 的 `error` 事件返回 400。
7. N5 3b 混合故障已修；`lead-20261109-3b-runtime.test.js` 三条断言覆盖。
8. D8 字段：health 顶层 + 13 后端、history 6 后端全有值，旧键保留、无凭证泄漏；认证 GET 三 API 200。
9. `Retry-After` 链路 6 种输入全按预期；403 不误判配额。
10. Config schema 与 GUI 双层数值边界对 `0/-1/1.5/"x"` 全 THROW。
11. T2 修复后：N1 413、N2 键差异与重新扇出、N4 握手带 key 与键控、N3 的 SSE decoy/字符串 id、G2 部分注册回滚、G3 limiter 下限，均已按当前源码行为级复现通过。

### D.2 无法验证（诚实边界，A/E）
1. 真 GUI HMR / `plugin_manager` 卸载触发 disposer：需改运行时状态或启动 dev watcher；已用真 cordis `fiber.restart()/dispose()` 等价验证（E1）。
2. 真上游 429 的**原始** `Retry-After` 响应头：当前无受控 429 服务；合成 `Response` 链路已全通（E2）。
3. 真 `agent.tinyfish.ai` keyed 握手：`TINYFISH_API_KEY` unset、credentials 无该 ref；本地 stub 已证缺头/已修（E5）。
4. 真「全部 6 后端同时 429」的 3b：当前 health 仅 firecrawl 被标且冷却已过期；行为级等价由单测覆盖（E6）。
5. GUI 目视新字段：client.js 根本不消费 health/history，无对象可目视（E4，**结构性不可做**）。
6. `settings` POST 授权后的 fence 与 `POST /history/clear` 真行为：会写用户数据，本轮只读约束未做。
7. 重启后 symlink / 3 env / D8 字段 / history 持久性：需重启服务，本轮未重启。
8. D5 按 session 隔离后的产品行为：T2 仍未实现。
9. 题给 PID 2731223 的 cmdline 无法读取（进程已退出）；本轮以 PID 3207503 的 `/proc` 实测为准。
10. **T2 修复的运行态效果**：因安装副本未同步、服务未重启，无法验证；只能验证工作副本的源码与单测。

### D.3 5 条反直觉（每条带等级）
1. **[A/B] 65 号正文与 68 号汇总结论完全相反**：65 号白纸黑字「证伪成立，存在未修 P0/P1，5 条 P1」，68 号却写成「V1 证伪失败、无未修 P0/P1」；69–72 目标模式只修 6 项（disposer/D3/D8/D6/D5/void write），**没有一条覆盖 N1–N4**。收口结论建立在一次汇总转写错误上，而 65 号给的 4 个最小 diff 在 T1 逐字适用、T2 被逐条落地。
2. **[D] 「73/73 全绿 + 36/36 一致」与「4 条 P1 仍在」可以同时为真**：单测覆盖的是「修过的路径」，N1/N2/N3/N4 全落在**没有断言的分支**（超限 body 的 socket 行为、缓存键的嵌套配置、错 id 的 plain-JSON、initialize 请求头）。全绿证明不了这些分支；逐文件一致只证明安装副本 = 工作副本，不证明副本本身无 bug。**反过来 T2 也成立**：78/78 全绿，但 36/36 已破坏、runtime 仍跑旧代码 —— 单测数上升反而掩盖了「修复没上线」。
3. **[D] 65 号标 E 说「initialize 缺 extraHeaders 需真 key 才能验证」，其实一个本地 HTTP server 就能证伪**：请求头观测不需要任何真凭证 —— `initialize` 头里有没有 `X-API-Key` 是客户端行为，与服务端是否接受无关。「需真 key」把**客户端可观测缺陷**误归类为**外部依赖不可达**。同理 N4 串会话也只需两个假 key。
4. **[D] D5 一直被当「运行态遥测污染」登记不修，实测是跨会话功能性阻断**：会话 A 的一个 429 让会话 B 少一个健康后端；A 全后端 429 让全健康的 B 直接拿 `all backends are rate-limited; retry after ~60s`。共享 Map 不只是「读数窗口快照」，它是 3b 决策的输入。
5. **[A/D] 修 D3 时只统一时钟、不区分「决策时刻」与「呈现时刻」，会把「未知状态」变成「确定性错误状态」**：`cooledAnnotation(centry, nowMs)` 消除了无秒数裸串，但 8s 后窗口已到期时模型仍读到 `⏸cooled 3s`。方向上更保守（不会重打限流端点），语义却更错。

### D.4 复核方法与证据索引
- **§1 文件一致性**：`find src-work/plugin -type f … | sort` + `for f …; do diff -q "$SRC/$f" "$DST/$f"; done` + 反向 `find "$DST/lib"`。T1 36 行零 DIFF；T2 `diffcount=4`（lib）+ 4 个 tests DIFF。
- **真 cordis 复现**：`import { Context, Service } from 'file:///opt/dsh-0222/node_modules/@deepseek-ai/cordis/lib/index.js'`，`root.provide('webServer', ws)`，插件 `inject(['webServer'])` + `webCtx.effect(...)`，`fiber.restart()` / `fiber.dispose()`。
- **行为级脚本清单**（`/tmp/e1-*.mjs`，全部跑完删除）：`e1-cache-probe` / `e1-cache-e2e` / `e1-hotkey` / `e1-cordis-effect{,2,3}` / `e1-partial{,2,3,4}` / `e1-real-effect{,2,3,4}` / `e1-limiter` / `e1-schema` / `e1-write-edge` / `e1-retryafter` / `e1-cooled3` / `e1-d5` / `e1-d5-real` / `e1-n1n3n4` / `e1-n3sse` / `e1-n4-keyed` / `e1-n3-final` / `e1-recheck-all` / `e1-d6-toctou{,2,3}`。
- **认证只读**：`grep -oE 'token=[A-Za-z0-9_-]{20,}' /home/ova/re-agent/dsh-web.log | tail -1` → `curl -c /tmp/… "http://127.0.0.1:3080/?token=…"` 取 cookie → `curl -b … -H 'Origin: http://127.0.0.1:3080'` GET 三 API；临时文件用完即删，值未写入本报告。
- **源码行号**：T1 指向 14:20 时 `src-work/plugin/lib/…`；T2 段落另注 `stat`/`grep` 复核结果。runtime 语义引用 `/opt/dsh-0222/node_modules/@deepseek-ai/{cordis,dsh-web,dsh-host-webserver,dsh-client-connection,dsh-settings}/lib/index.js` 实测片段。

---

## E. 交付给 Lead 的结论摘要（≤12 行简报已另发两次，本段为完整版）

**T1（题给基线）证伪成立：4 条未修 P1（N2 缓存键 / N4 会话键控+握手缺头 / N3 MCP id / N1 413→ECONNRESET）+ 4 条 P2（D5 跨会话、effect 泄漏、limiter(0)、D3 注记）。** 根因是 68 号把 65 号「证伪成立」误写成「证伪失败」。

**T2（15:17 定稿时点）：另一会话已把 N1/N2/N4/N3 的 id+SSE/G2/G3 修进工作副本，单测 73→78；但 4 个 lib + 4 个 tests 未同步到安装副本、服务未重启 ⇒ 当前 runtime 仍跑旧代码，运行时层面 4 条 P1 全在。** 工作副本里唯一残留的 P1 是 **N3a plain-JSON 错 id 仍被接受**（且被测试固化为 permissive）；D5 与 D3 注记仍未修。

**最该先做的 2 件事**：① 同步 8 个文件到安装副本 → 36/36 一致 → `cd DST && node --test` 78/78 → 按 25 §6 重启 → 认证三 API + `web_search` + 70KB POST→413 验收；② 补完 N3 plain-JSON id 校验（含测试/注释/`catch {}` 处理）并重裁 D5 的「不修」裁决。E1/E2/E3/E5 已做等价或合成验证；E4 结构性不可做（client 不消费 health/history）；E6 条件不满足。
