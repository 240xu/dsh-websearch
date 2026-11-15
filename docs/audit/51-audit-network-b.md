# 51-b · 备份版审计 A：网络 / MCP 层（独立报告）

> 2026-11-08 22:39–23:03 (+08:00)，子代理 `runtime-state`。
> **唯一写文件**：本文件。`51-audit-network.md` 不存在（已核实）→ 本报告为**独立完整报告**，非交叉复核补遗。
> 未改源码/配置/运行时/其它报告；未操作任务板。全程只读（read/grep/glob + 只读 curl + `/tmp` 内存副本 + `node` 最小复现）。
> 基线 `.baseline-20261108-2205/`；服务 PID 587384（STARTED `Sun Nov 8 18:34:32 2026`）；`src-work` ↔ 安装目录 util 各文件 md5 两两一致；现有测试 36 个 `test()`（11+4+4+9+3+5），50 号称 43/43（含 fixture 内断言）。
> 等级：**A**=源码实证（路径:行号）、**B**=官方文档、**C**=版本记录、**D**=本机实测、**E**=推断/待核实。四联=`结论 → 依据 → 代码落点 → 验证`。
> 取证对象：`src-work/plugin/lib/util/{egress-fetch,mcp-client,namespace,failure-label}.js`、`lib/{trust,settings-api}.js`、`lib/backends/{exa,parallel,firecrawl,tinyfish}.js`、发布版 `dsh-llm/lib/types/error.js`、`57-audit-error-contract.md`。

---

## 0. 三条核心结论（Lead 已独立复现，本备份版独立复现一致）

### 结论 1 [A+D] — `parseEnvelope` 的 SSE 缺陷成立（P0 候选）
- **现状**：`mcp-client.js:108-136`。SSE 分支 `:110-123` 把**整个响应**按 `\n` 切行、过滤所有 `data:` 行、`.map(trim).join("")` 拼成**一个字符串**再 `JSON.parse`。多帧 SSE（`event: message … \n\n event: message …`）会拼成 `{...}{...}` → 解析失败 → 落入 `:135` `throw new WebError("MCP: failed to parse response envelope", "WEB_PROVIDER_ERROR")`，**整次搜索失败**。
- **第二个缺陷**：SSE 分支 `return JSON.parse(joined)`（`:120`）**完全不校验 `id === expectedId`**，也不要求含 `result`/`error`；而 plain JSON 分支（`:128-130`）对 batch 会 `find(r => r.id === expectedId)`。⇒ SSE 路径下错 id 帧、心跳帧、非 JSON-RPC 帧都会被当成合法 envelope 返回。
- **D 级复现**（`/tmp/a51/sse.cjs`，从真实 `mcp-client.js` 内存导出 `parseEnvelope`）：
```
single SSE frame                                 -> OK id=1 text="A"
two SSE frames (concatenated events)             -> THROW: MCP: failed to parse response envelope
two data: lines in ONE event (spec-valid)        -> OK id=1 text="A"
SSE frame with WRONG id first                    -> OK id=99 text="WRONG"   ← id 未校验
plain JSON (batch)                               -> OK id=1
```
- **影响面**：`exa` 走 SSE（`Accept: text/event-stream`，实测 `event: message` 响应），`firecrawl` 也走 SSE；`parallel` 走纯 JSON 不受影响。Exa 是当前真实 `web_search` 的成功后端（`exa ✓/8`），若上游偶尔发多帧（流式/心跳 + 结果帧）即触发。
- **最小修法**：按空行切分 SSE 事件、逐事件把 `data:` 行用 `\n` 连接（SSE 多行 payload 是换行连接，不是拼接）、逐帧 `JSON.parse`、只保留含 `result`/`error` 的帧、`frames.find(f => f.id === expectedId)` 优先、单帧时容许 id 不匹配（stateless 端点可能回显别 id）、多帧全不匹配才抛错；plain JSON / batch 分支保留。
- **D 级验证**（`/tmp/a51/ssefix2.mjs`，10 例）：单帧 ✓、两帧 ✓（返回 id=1 的 A）、错 id+对 id ✓（跳过 WRONG）、仅错 id（单帧兜底）✓、`data:` 多行同事件 ✓、plain JSON ✓、batch ✓（挑 id=1）、SSE error 帧 ✓（err=true）、两帧全错 id → 明确抛 `no envelope with id 1`、垃圾 → 抛 `failed to parse`。
- **验收断言**：① 两帧 SSE 返回 `expectedId` 帧而非抛错；② `id=99` 帧在前时不返回它；③ 含 `result`/`error` 之外的 `data:` 帧被忽略；④ plain JSON batch 仍挑 `expectedId`；⑤ 单帧 SSE 且 id 不匹配仍返回（兼容 stateless）；⑥ 全不匹配/全垃圾仍抛 `WEB_PROVIDER_ERROR`。

### 结论 2 [A+B+D] — 官方要求 route on `code`，我们靠 message 正则（57号 F-1/F-2 可行）
- **官方契约** [B/A]：发布版 `dsh-llm/lib/types/error.js:13` JSDoc 逐字 `Stable machine-routable failure class (e.g. RATE_LIMIT); route on this, never by parsing message.`；`dsh-web/lib/index.js:19` `var WebError = class extends HarnessError {};`（无字段扩展、无自定义构造器，只继承 `code`+`cause`）。
- **现状** [A]：`failure-label.js:6-9` `rateLimited(err)` = `String(err?.message ?? err)` 上跑 `/HTTP 429|rate.?limit|429\b/i` 或 `/Anonymo|quota|额度/i`；`:16-22` `retryAfterMsFrom(err)` 从 `err?.cause?.response?.headers` 读，实际取不到 → 恒 60s。
- **57号 F-1 核对** [A+D]：**可行且必要**。11 处非 2xx 抛错点（`mcp-client.js:64,222` 等）都是 `new WebError(\`… HTTP ${response.status}: ${text}\`, "WEB_PROVIDER_ERROR")`，**不挂 status / retryAfter / rateLimited / 稳定 code**。57号建议 `lib/util/web-error.js` 的 `webErrorFromResponse(response, text, label)` 构造后 `Object.assign(err, {status, retryAfter, rateLimited, code})` —— **不改发布版包、不发明 WebError 子类**（会破坏 6 处 `instanceof WebError`），是最小且安全的做法。
- **关键前置（本备份版独立核对）**：Lead 指出 `egress-fetch.js:245-267 collect()` **已保留完整响应头**——实读确认 `:253-256` 用 `headersFromRaw(res)`（`:262-267` 遍历 `res.rawHeaders` 成对构造 `new Headers(pairs)`）构造 `Response`，因此 `response.headers.get("retry-after")` 在**所有**经 `egressFetch` 的路径上都可得。**传输层无需改动**，F-1 只需在抛错点把 `response` 传进去即可。57号 §2.2 的「11 处」清单与 `mcp-client.js:62-65`、`:220-223` 一致。
- **57号 F-2 核对** [D]：分类器改「先 `err.code==="RATE_LIMIT"/"QUOTA"` → 再 `Number(err.status)===429` → 再 `err.rateLimited===true` → 正则收紧为 `HTTP 429|429\b|rate.?limit` 兜底」**可行**。57号列 4 例误判（`HTTP 402: quota exceeded`、`HTTP 200: anonymous user`、`HTTP 503: anonymous gateway`、`Perplexity quota is 0E-16`）与 1 例漏判（`openai.js` / `anthropic-like.js` 把 `HTTP ${status}` 覆盖成 provider detail，连文本都丢）。本备份版确认 `failure-label.js:8` 的 `/Anonymo|quota|额度/i` 正是误判源；且 `firecrawl.js:90-92` 的 `firecrawl returned an MCP error: Anonymous keyless access is unavailable` 是 `isError:true` 的**结果级**错误（非 HTTP 429），当前会被误判为 rate-limited → **1 次就冷却**（`breaker.js` 的 `opts.rateLimited`）。
- **验收断言**：假 `Response(429, {"retry-after":"7"})` → `err.status===429`、`err.retryAfter===7000(ms)`、`err.code==="RATE_LIMIT"`、`retryAfterMsFrom(err)===7000`；无 header → 60000；4 条负例（402/200/503/无关 quota 文本）`rateLimited()===false`；`instanceof WebError` 与 `{cause}` 链保留；`lead-20261108-quota.test.js` 的既有正/负例零回归。

### 结论 3 [A+D] — `settings-api.js readBody` 超限未移除 `end` 监听 / 未 drain（P2）
- **现状** [A]：`settings-api.js:238-256`。`:242-250` 的 `data` 回调在 `size > MAX_BODY_BYTES`（`:37` = `64*1024`）时：`rejectBody(oversize)` + `req.removeAllListeners("data")` + `return`。**但**：`:253` 的 `req.on("end", …)` **没有被移除**，`:254` 的 `error` 监听也没有；请求流**没有 `req.resume()` / `req.destroy()` / drain**。
- **后果** [D/E]：Promise 已 reject，但 socket 上剩余字节继续到达 → `end` 仍会触发 `resolveBody(...)`（对已 reject 的 Promise 是 no-op，但**解析与 `Buffer.concat` 仍执行**），`chunks` 数组在 `data` 监听移除后不再增长、内存不再涨，但**连接不会主动关闭**，`sendJson(res, 413, …)` 之后若有后续 keep-alive 请求复用同一 socket，残留 body 会被当作下一个请求的起始字节 → **请求走私 / 粘包风险**（E，未做真实 socket 复现）。
- **Lead 原话核对**：「超限时未移除 `end` 监听、未 drain/destroy 请求流」**成立**。
- **最小修法**：超限分支同时 `req.removeAllListeners("end")`、`req.removeAllListeners("error")`（或改用 `once` + 显式 cleanup），并 `req.resume()` 排空后 `req.destroy()`；或更稳地在 `readBody` 外层用 `AbortController` + `req.on("aborted")`。同时 `write()` 里 `catch` 的 `err.status===413` 已被 `guarded()` 映射到 413（`settings-api.js:93`）。
- **验收断言**：发送 >64KiB body → 返回 413、Promise 只 settle 一次、`end` 监听计数为 0、socket 被 drain/destroy；`MAX_OPS`（`:38` = 64）与 `validateOp`（`:205-226`，`Object.hasOwn(fields, field)` + `schema(raw.value)` 类型校验）单独断言非法字段/非法值/超 64 ops 均 400。

---

## 1. 逐条裁决表（8 项）

| # | 命题 | 裁决 | 等级 | 证据（文件:行号 / 命令） |
| --- | --- | --- | --- | --- |
| 1 | `parseEnvelope` SSE 多帧 join 失败 + 不校验 id | **成立（缺陷）** | A+D | `mcp-client.js:110-123,120`；`/tmp/a51/sse.cjs` 5 例 |
| 2 | 官方 route on code、F-1/F-2 可行、collect() 已保留 headers | **成立** | A+B+D | `dsh-llm/lib/types/error.js:13`；`dsh-web/lib/index.js:19`；`egress-fetch.js:245-267`；`failure-label.js:6-9`；57号 F-1/F-2 |
| 3 | `readBody` 超限未移除 end / 未 drain | **成立** | A+D(静态) | `settings-api.js:242-254` |
| 4 | `egressFetch` Host 三条出口路径是否都补 Host | **基本成立，1 处待确认** | A | `egress-fetch.js:23`（无代理直连 → 原生 `fetch`，Node 自动加 Host）、`:213`（httpViaProxy 显式 `host: headers.host ?? target.host`）、`:187`（httpsViaConnect 同）；`normalizeHeaders():293` 删 host 后由两 transport 补回 |
| 5 | `skipInitialize` + `id = skip ? 1 : 2` 是否串包 | **不串包（已确认无误）** | A+D | `mcp-client.js:35`（initialize `id:1`）、`:169`（`skipInitialize?1:2`）、`:226` `parseEnvelope(text, callBody.id)`；50号执行记录：sessionful 路径保留 id:2 正是为避开与 initialize 同 id |
| 6 | `forceFreshSession` 防换 key 复用旧 SID | **成立（已修）** | A+D | `mcp-client.js:23,28,100,163`；`tinyfish.js:77`；46号/50号 fake MCP 复现（2 次 initialize、SID-1/SID-2） |
| 7 | 4 个 MCP backend 的 parse/hooks/headers | **基本无误，2 处小缺口** | A | 见 §3 |
| 8 | `sessionCache` 仅 URL 键控的其它泄漏 | **成立（残留风险）** | A+E | `mcp-client.js:16,25,100,141`；见 §4 |

---

## 2. 缺陷清单（P0 / P1 / P2）

| 级别 | 缺陷 | 四联 | 回滚 |
| --- | --- | --- | --- |
| **P0** | D1 `parseEnvelope` SSE 多帧整次失败 + id 不校验 | 结论：Exa/Firecrawl 走 SSE，多帧即整次搜索失败 → 依据 [A] `mcp-client.js:110-123` → 落点 [A] 同处 + `:226` → 验证 [D] `/tmp/a51/sse.cjs` + `/tmp/a51/ssefix2.mjs` 10 例 | 单函数替换，秒级 |
| **P1** | D2 非 2xx 无 `status`/`retryAfter`/稳定 code，`rateLimited` 靠文本正则（4 例误判 + 1 例漏判） | 结论：违反官方 `route on code`、429 无法按 Retry-After 冷却 → 依据 [B] `error.js:13` + [A] `failure-label.js:8` → 落点 [A] 11 处抛错点 + 1 helper + 1 分类器 → 验证 [D] 假 429 Response 断言 | 删 helper、恢复原 11 处文本抛错 |
| **P1** | D8 `sessionCache` 仅 URL 键控：`baseURL` 相同但 `extraHeaders` 不同（如 firecrawl 带/不带 Authorization、tinyfish keyed/keyless）会串会话 | 结论：多凭据/同 URL 不同 header 复用旧 SID → 依据 [A] `mcp-client.js:16,25,100` → 落点 [A] `ensureSession` 的 cache key → 验证 [E] 未做真实多账号复现 | 恢复 URL 单键 |
| **P2** | D3 `readBody` 超限未移除 `end`/`error` 监听、未 drain/destroy | 结论：keep-alive 残留 body 粘包风险 → 依据 [A] `settings-api.js:242-254` → 落点 [A] 同处 → 验证 [E] 静态确认，未做 socket 复现 | 恢复原 4 行 |
| **P2** | D7a `parallel.js` 有**两处** `if (result?.isError === true)`（`:61` 与 `:81`），第二处是死代码（第一处已 throw） | 结论：冗余、易漂移 → 依据 [A] `parallel.js:61,81` → 落点 [A] 删 `:81-83` → 验证 [D] `grep -c` = 2 | 恢复 |
| **P2** | D7b `firecrawl.js` / `tinyfish.js` 的 `hooks.recordRequest` 传 `headers: {}`（**不漏 key，正确**），但 `recordOutcome({status:"error", message})` 直接回显上游 `isError` 文本 | 结论：上游错误体可能含 query 回显 → 依据 [A] `firecrawl.js:90-92`、`tinyfish.js:88-90` → 落点 [A] 复用 `sanitizeError` → 验证 [E] 未实证泄漏 | 恢复 |

---

## 3. 已确认无误（证伪失败）

1. **[A] `collect()` 保留完整 headers**：`egress-fetch.js:245-267` 用 `res.rawHeaders` 构造 `new Headers(pairs)`，`Response.headers.get("retry-after")` 可得 → **F-1 不必改传输层**（Lead 判断正确）。
2. **[A] Host 三条出口路径**：无代理直连 `egressFetch():23` 交给原生 `fetch`（Node 自动 Host）；`httpViaProxy():213` 与 `httpsViaConnect():187` 都 `host: headers.host ?? target.host`；`normalizeHeaders():293` 删 host 是**刻意**的（防调用方覆盖隧道目标），两 transport 已补回。`:170-180` 的长注释记录了 Cloudflare 403 事故与修复。
3. **[A+D] `id` 不串包**：`callBody.id = skipInitialize ? 1 : 2`（`:169`）；sessionful 路径用 2，避开 initialize 的 `id:1`（`:35`）；`parseEnvelope` 按 `callBody.id` 匹配（`:226`）。50 号称「比 46 号更保守」正确。
4. **[A] `forceFreshSession` 生效**：`mcp-client.js:28` `if (!options.forceFreshSession && cached && …)`；`tinyfish.js:77` `{skipInitialize: !keyed, forceFreshSession: keyed}`；keyless 时 `skipInitialize=true` 短路、`ensureSession` 根本不调用 → 零回归。
5. **[A] 4 个 backend 的 hooks 齐全**：exa `:53,80`、parallel `:41,79`、firecrawl `:62,97`、tinyfish `:59,95` 均 `recordRequest`/`recordOutcome`，且 `recordRequest` 的 `headers: {}` **不携带 key**（key 只进 `extraHeaders` 给 `mcpCall`）。
6. **[A] `validateOp` / `MAX_OPS` 基本健壮**：`settings-api.js:205-226` 校验 op∈{set,unset}、path 一元、字段白名单 `Object.hasOwn(fields, field)`、`schema(raw.value)` 类型；`:38` `MAX_OPS=64`、`:156` 拒绝空/超 64。
7. **[A] `namespace.js` 已修 shape 碰撞**：`:22-27` 先按 `PROFILE_ID="dsh-websearch"` / `LEGACY_ID="unified-search"` 精确匹配，shape fallback 要求 ≥2 个插件专有字段（对比 30-b §1 裁决 4 的旧版单字段 fallback，已改进）。
8. **[A] `trust.js` fence 完整**：`rejectionFor()` 走 `connection.admit()` + 结构性 loopback/Origin/Referer 校验；`health.js:94`、`history.js:157`、`settings-api.js:88` 三处均调用。

---

## 4. 仍无法验证（E）

1. **Exa 真实上游是否会发多帧 SSE**：本轮只读 curl 取到的是单帧 `event: message`；多帧是**理论上可触发**（流式/心跳），未抓到真实多帧响应。D1 的 P0 定级基于「一旦发生即整次失败」的严重度，非「已观测到生产故障」。
2. **`readBody` 超限的 keep-alive 粘包**：静态确认监听未移除，未做真实 socket 复现（需要构造 >64KiB 请求 + 复用连接），标 E。
3. **D8 `sessionCache` 同 URL 不同 header 串会话**：只在 fake server 上验证过「换 key 复用 SID」（46号已修 keyed 路径）；**firecrawl 带/不带 `Authorization` 共用同一 URL 且都 `skipInitialize:true`**（不进 `ensureSession`）→ 实际不串；但 `ensureSession` 若被别的新 backend 复用仍有风险，标 E。
4. **IPv6 / 端口 / SNI**：`httpsViaConnect():119` `port = target.port !== "" ? Number(target.port) : 443`、`:184` `servername: target.hostname`；`splitHostPort():63-73` 处理 `[IPv6]` 但 `inNoProxy()` 的 `host.endsWith("."+bare)` 对 IPv6 字面量不适用 → **E，未做 IPv6 代理实测**。
5. **大 body / 重定向**：`MAX_REDIRECTS=5`（`:18`）、`redirect:"error"` 由 `ddg.js:38-40` 触发（预期安全行为）；`collect()` 无字节上限（`:245-259` 全量 `Buffer.concat`）→ 恶意大响应撑内存，**E**（与 42号 S-3 的 256KiB 建议相关，本轮未复现）。
6. **F-1 的 11 处抛错点逐一核对**：57号 §2.2 已列全表，本备份版只核对了 `mcp-client.js` 两处与 `egress-fetch.js` 的 headers 可得性，其余 9 处未逐一 read，标 E（引用 57号 A 级结论）。

---

## 5. 五条反直觉发现

1. **[A+D] SSE 的「多行 data」修法不是 `join("")` 而是 `join("\n")`**：当前实现把**所有帧的所有 data 行**拼一起，恰好对「单事件多行 payload」**也错**（只是我第一次构造的 split 不合法 JSON 才看似 OK）。正确做法是先按空行切事件、再在事件内用 `\n` 连 data 行——两个维度不能混为一谈。
2. **[A] `parseEnvelope` 的 plain JSON 分支反而比 SSE 分支更严谨**：`:128-130` 对 batch 会 `find(id===expectedId)`，而 SSE 分支 `:120` 直接 `return JSON.parse(joined)`，连 id 都不看。修复应让 SSE 分支**至少达到** plain 分支的严谨度。
3. **[A] `normalizeHeaders()` 删 `host` 不是 bug，是安全设计**：单看 `:293` 会以为丢 Host；但 `:287-292` 注释 + `:187`/`:213` 两处补回表明这是「防调用方 Host 覆盖 CONNECT 隧道目标」的刻意行为，且曾修复过真实 Cloudflare 403。**不要「修」它**。
4. **[A] `sessionCache` 的 URL 单键问题被 `skipInitialize` 大幅缩小**：M-1 让 exa/parallel/firecrawl 全走 stateless（不进 `ensureSession`），M-3 让 keyed tinyfish 强制新会话 → 目前**唯一**还会命中共享缓存的只剩「未来新增的 sessionful backend」。风险从 P1 降到 P1-待观察。
5. **[A+D] 官方 `WebError extends HarnessError` 无自定义构造器，反而是 F-1 的最小解**：57号指出不能造 `WebError` 子类（会破 6 处 `instanceof`），只能「构造后 `Object.assign` 附加字段」——因为 `HarnessError` 的 `code` 就是设计给机器路由的，不需要新类。这比「引入自定义 Error 体系」更小、更贴合官方契约。

---

## 6. 取证命令（全部只读，无需密钥）

```bash
# D1 SSE 行为级复现（内存导出 parseEnvelope）
rm -rf /tmp/a51 && mkdir -p /tmp/a51 && cp -r .../src-work/plugin/lib/util/. /tmp/a51/
# 写 dsh-web-stub.js；sed 把 import 指向 stub；把 function parseEnvelope 改成 export
node /tmp/a51/sse.cjs        # 5 例：两帧 THROW / 错 id 被接受
node /tmp/a51/ssefix2.mjs    # 修法 10 例

# D2 官方契约 + headers 可得性
grep -n 'route on this' /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-llm/lib/types/error.js
grep -n 'WebError = class' /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web/lib/index.js
sed -n '245,267p' .../src-work/plugin/lib/util/egress-fetch.js   # collect() + headersFromRaw
sed -n '1,23p'   .../src-work/plugin/lib/util/failure-label.js

# D3 readBody
sed -n '238,256p' .../src-work/plugin/lib/settings-api.js

# 一致性 / 测试
for f in egress-fetch.js mcp-client.js namespace.js failure-label.js; do md5sum .../src-work/.../util/$f .../installed/.../util/$f; done
cd .../src-work/plugin && node --test tests/*.test.js
grep -c '^test(' .../src-work/plugin/tests/*.test.js
```

---

## 7. 交付边界

- **是否需改运行时**：D1/D2/D3 三条修法都需改插件 `lib/`（1 个函数 / 1 helper+11 抛错点 / 1 个 `readBody`），按 Lead 既有规则**不需要重启服务**（host 侧 bundle 需重建，客户端走刷新）；本子代理**未 apply 任何 diff**。
- **优先级建议**：D1（P0，SSE 整次失败）→ D2（P1，官方契约 + 429 误判）→ D8（P1 待观察）→ D3/D7a/D7b（P2）。
- **与 57号关系**：本报告是**网络/MCP 层备份版**，D2 与 57号 F-1/F-2 结论一致且独立核对了「`collect()` 已保留 headers → 传输层无需改」这一关键前置；不重复 57号的 11 处全表与 diff。
- **磁盘完整性**：本报告结束时 util 各文件 md5 与任务开始一致（未改源码）；`/tmp/a51` 等临时脚本**待清理**（按 Lead「先落盘」指令，本条留待补遗时执行）。

*骨架 + 三条核心结论已落盘。后续补遗可追加 §8（逐 backend parse 畸形输入矩阵）、§9（egress-fetch 三路径 Host/IPv6 实测）、§10（D1 修法的可 apply diff 全文）。*
