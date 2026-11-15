# R2 复核：MCP / 网络层深水区（独立取证）

> 复核对象：`/home/ova/dsh/.artifacts/websearch-research/src-work/plugin/lib/util/{mcp-client,egress-fetch,web-error}.js`、`lib/trust.js`、各 backend。
> 方法：read/grep + 从**真实源码**提取函数/模块注入 stub 的 `node` 行为级复现（/tmp，已删或留待清理），以及真实本地 HTTP 代理 + 原始 socket 服务器。
> 取证期间源码被并发改动过（我锁定了两个基线并各自复跑）：
> - `mcp-client.js` 13:59 加入了 BOM 剥离、把 plain-JSON 的 id 校验放宽为「不强制」（`String(r.id)===String(expectedId) ?? parsed[0]`，单对象直接返回）；
> - `web-error.js` 19:25 把 `quota` 从 `402 || 403` 收窄为仅 `402`。
> 当前 `node --test tests/*.test.js` = **60/60 pass**（背景称 56/56，测试已增加）。下表裁决均针对**当前**源码。

---

## 一、逐条裁决表

| # | 复核点 | 裁决 | 证据（行为级） |
| --- | --- | --- | --- |
| 1a | SSE 一个 JSON 拆到多个 `data:` 行 | ✅ 通过（拼接用 `join("")`） | `r2-parse.mjs`：`split-JSON-2-data-lines` 返回 `{"...","x":1}` |
| 1b | 多事件 CRLF 分隔 | ✅ 通过 | `split(/\r?\n\r?\n/)` 实测 CRLF 两个事件正确挑 id=2 |
| 1c | `event:` / `id:` / `retry:` / `:keepalive` 干扰行 | ✅ 通过 | 只 `filter(l=>l.startsWith("data:"))`，全部忽略 |
| 1d | `data:[DONE]` | ⚠️ 部分通过 | **独立事件**时跳过并继续（✅）；**同一事件**与 JSON 并列（`data: [DONE]\ndata: {...}`）时 join 出 `[DONE]{...}` → JSON.parse 失败 → 抛 `failed to parse response envelope`（❌） |
| 1e | BOM | ✅ 通过 | 新加 `charCodeAt(0)===0xFEFF` 剥离；单事件与「BOM+前置 [DONE] 事件」都通过 |
| 1f | 批量（batch）响应 id 匹配 | ✅ SSE 通过 / ⚠️ plain 有回退 | SSE 数组内挑中 id=2；plain 数组 `find(String(id)===String(expectedId)) ?? parsed[0]`，**无匹配时静默返回第一个元素**（见 P2-3） |
| 1g | 空事件 | ✅ 通过 | `data:\n\n` 被 `if(!joined) continue` 跳过 |
| 1h | 纯 JSON id 不匹配 | ⚠️ 设计性放宽 → 串包 | `return parsed` 不再校验 id：`id=7` 的 result 会作为本调用（id=1）的结果返回；`id=7` 的 error 会被当成 `MCP error` 抛出（见 P1-2） |
| 1i | `callBody.id=1` 与 SSE/批量 expectedId 串包 | ❌ **确认串包** | `id1-vs-mixed-stream`：id=1 流中同时有 initialize 形状的 id=1 帧与真实 tools/call 的 id=2 帧 → 返回 `serverInfo` 帧；`id1-plain-json-id2` 返回 id=2 的别人的响应。skipInitialize 让 id 退化成 1，而 initialize 也用 id=1，二者在共享连接/SSE 流里无法区分（见 P1-1） |
| 2a | 无代理直连提前 return（undici 自合成 Host） | ✅ 通过 | `egressFetch` 无 proxy 走 `fetch(url,init)`；实测 undici 忽略调用方 `Host` 头，服务端收到 `127.0.0.1:port` |
| 2b | `httpViaProxy`/`httpsViaConnect` 的 `host: headers.host ?? target.host` | ✅ 通过 | 真实代理实测：伪造 `Host: evil.example:9999` 后，代理收到 `host=127.0.0.1:port`（`normalizeHeaders` 先删 `Host`，再还原为 `target.host`）。HTTPS CONNECT 路径同表达式（本地无法起真实 TLS 隧道，按对称性 + 静态核对） |
| 2c | 204/304 空 body 的 bodiless Response | ✅ 空 body 通过 / ❌ 有 body 时**进程崩溃** | `collect()`：`chunks.length===0 ? null : Buffer.concat`。真实服务器实测 204/304 空 body 正常。**但** `new Response()` 在 `'end'` 回调内同步抛出时**不在 Promise 的 try/catch 里** → 未捕获异常。见 P0-1 |
| 2d | `headersFromRaw` 重复头 / set-cookie | ✅ 通过 | 真实代理实测 `set-cookie=a=1; Path=/, b=2; Path=/`、`x-dup=one, two`（`new Headers(pairs)` 保留 rawHeaders 全部键值对） |
| 2e | 重定向 `location` 与 `redirect:"error"` | ✅ 通过 | 真实代理实测 302 + `redirect:"error"` → 抛 `fetch failed: redirect mode is set to error (302)`；`redirect:"manual"` 返回 302 本身；POST 302/303 丢 body、307 保留 body，均正确 |
| 2f | **新增** `redirect:"follow"` 的 `MAX_REDIRECTS` | ❌ **失效** | 递归调用 `return egressFetch(next.href, nextInit)` 重置 `depth=0`，`depth < MAX_REDIRECTS` 永真。12 跳有限链实测发出 **13** 次代理请求并走到终点；无限链挂死。见 P1-4 |
| 3a | sessionCache 只按 URL 键控 | ❌ **确认缺陷** | `r2-session.mjs`：KEY-A 首次握手得 `SESSION-FOR-INIT-1`，同 URL 换 KEY-B（无 `forceFreshSession`）**0 次 initialize**，直接复用 `SESSION-FOR-INIT-1` 发 `X-API-Key: KEY-B`。见 P1-3 |
| 3b | 不同 API key / keyless↔keyed 切换 / `X-TinyFish-Access-Mode` | ⚠️ 部分缓解 | TinyFish keyed 传 `forceFreshSession:true` → 每次都重新握手（实测 D≠E）。但这是**调用方约定**，不是缓存层保证；keyless 走 `skipInitialize` 不读缓存，所以 keyless↔keyed 不串；一旦某 backend 漏传 `forceFreshSession` 就串（当前仅 TinyFish keyed 传） |
| 3c | `ensureSession` 收不到 extraHeaders | ❌ 结构性缺口 | `ensureSession(url, signal, {forceFreshSession})` 签名无 `extraHeaders`；initialize/notification 请求头实测**没有** `X-API-Key`（只有 tools/call 有）。按 MCP 规范 `initialize` 也需鉴权 → keyed 握手可能 401（见 P1-5） |
| 3d | `invalidateSession` 在 401/403/404 重试路径 | ✅ 通过 | `r2-retry.mjs`：401/403/404 → invalidate → 重新 initialize（S1→S2）→ 重试 200；第二次 401 不再无限重试（抛 HTTP 401）；stateless 401 不重试；429 不重试。缓存最终收敛为 S2 |
| 4a | `rejectionFor` GET/POST 两侧 | ✅ 通过 | 三个路由 `health.js`/`history.js`/`settings-api.js` 都在 handler 最前面调用 `rejectionFor`，GET/HEAD/POST 同一入口，实测 A1/A2/A18 均生效 |
| 4b | 伪造 Host / 跨站 Origin | ✅ 通过 | `evil.example`、`127.0.0.1.evil.com`、`sec-fetch-site: cross-site`、`origin: https://evil.example`、端口不符、scheme 不符、`origin: null`、Referer 跨站 → 全 403 |
| 4c | 无 connection service 的结构复制分支 | ✅ 通过 | `rejectionFor(req, undefined)` 走 `structuralReason`，全部 A1–A18 裁决 0 mismatch；与真实内核 `isTrustedApiRequest` 语义一致（额外多检查 Referer、桌面 relay 例外） |
| 4d | **新增** `connectionAdmissionView` 是否接线 | ⚠️ **死代码** | 全仓 grep：仅 `trust.js` 内定义，**无任何调用**。运行时 `getConnection()` 直接把原始 service 传给 `rejectionFor`，靠 `rejectionFor` 内双拼写兼容。不是漏洞，但旧版包装视图无人验证（见 P2-6） |
| 5 | 新发现优先 | ✅ | P0-1 / P1-4 / P1-5 / P2-1 / P2-2 / P2-3 / P2-4 / P2-5 / P2-6 / P2-7 见下 |

---

## 二、缺陷清单（P0 / P1 / P2）

### P0-1 `collect()` 在 `'end'` 回调内构造 `Response` 抛出未捕获异常 → 进程崩溃
**位置** `lib/util/egress-fetch.js:245-259`（`collect`）。
`new Response(payload, { status: res.statusCode ?? 502, headers: headersFromRaw(res) })` 位于 `res.on("end", ...)` 回调中，**没有 try/catch**，且 `resolve(...)` 的参数在调用前求值——异常从 EventEmitter 回调直接冒泡到 `uncaughtException`，既不会被 `collect()` 的 Promise 捕获，也不会被 `httpsViaConnect`/`httpViaProxy` 的 `collect(res).then(done, fail)` 捕获。

触发条件（任一，均为**上游可控**）：
- 状态码不在 200–599（如 `HTTP/1.1 600`、1xx 被 http parser 放行时）→ `RangeError: init["status"] must be in the range of 200 to 599`；
- 204/205/304 带非空 body → `TypeError: Response constructor: Invalid response status code 204`；
- `rawHeaders` 含非法头名/值（如 `Bad Header`、含 NUL 的值、lone surrogate）→ `Headers.append` 抛 TypeError。

**真实网络取证**：本地 HTTP 代理 + 原始 socket 上游发 `HTTP/1.1 600 Weird\r\nContent-Length: 2\r\n\r\nok`，进程直接退出（exit=1，堆栈 `r2-egress-mod5.mjs:253`），`try/catch` 完全没接住。node v22 与 v24 行为一致。

**影响**：单个恶意/故障 MCP 或搜索上游可打挂整个 DSH 服务进程（稳定性 > 单个后端失败）。这是本轮最严重的新发现。

**diff 片段**
```diff
     res.on("end", () => {
-      // Null-body statuses (204/304) and empty streams must construct a
-      // bodiless Response; an empty Buffer is not null and would throw.
-      const payload = chunks.length === 0 ? null : Buffer.concat(chunks);
-      resolve(new Response(payload, {
-        status: res.statusCode ?? 502,
-        headers: headersFromRaw(res),
-      }));
+      try {
+        // 200-599 clamp; 204/205/304 must be bodiless regardless of payload.
+        const rawStatus = Number(res.statusCode) || 502;
+        const status = Math.min(599, Math.max(200, rawStatus));
+        const bodiless = status === 204 || status === 205 || status === 304;
+        const payload = bodiless || chunks.length === 0 ? null : Buffer.concat(chunks);
+        resolve(new Response(payload, { status, headers: safeHeaders(res) }));
+      } catch (error) {
+        reject(new TypeError(`fetch failed: invalid upstream response: ${sanitize(error)}`, { cause: error }));
+      }
     });
```
（`safeHeaders` 需逐对 try/catch 跳过非法头；不能让一个坏头拖垮整个响应。）

**回归断言**
- `collect(fakeRes(600, [], ["ok"]))` → Promise **reject**（不是进程退出、`unhandledRejection` 或挂起）；
- `collect(fakeRes(204, [], ["oops"]))` → resolve `Response(status=204, body=null)`；
- `collect(fakeRes(200, ["Bad Header","x"], ["ok"]))` → resolve 且 `headers.get("bad header")===null`；
- 真实代理发 `HTTP/1.1 600 …` → `egressFetch` 抛 `TypeError: fetch failed …`，服务进程仍存活。

---

### P1-1 `skipInitialize` 的 `id=1` 与 `initialize` 的 `id=1` 在同一 SSE 流串包
**位置** `mcp-client.js:36`（`initBody.id=1`）、`:178`（`id: options.skipInitialize ? 1 : 2`）、`:128`（SSE `r.id === expectedId`）。

M-1 把无状态调用的 id 从 2 改成 1 以「对齐官方裸 tools/call」，但 `initialize` 请求**也是** id=1。当 MCP 服务器以 SSE 单流返回、且流里同时出现 `id=1` 的帧（初始化响应 / 通知 / 其它并发请求）时，`parseEnvelope(text, 1)` 只按 `id===1 && (result|error)` 挑**第一个**匹配，无法区分 `method`。

**取证**（`r2-mcpcall.mjs` `C1`）：
```
sse = data: {"id":1,"result":{"serverInfo":{"name":"init"},"protocolVersion":...}}
      data: {"id":2,"result":{"content":[{"text":"REAL"}]}}
parseEnvelope(sse, 1) -> {"serverInfo":...}   // 拿错帧，且 !envelope.result===false 所以不报错，静默返回错误结果
```
`id1-plain-json-id2`：plain JSON 里 `id=2` 的响应被当成 id=1 调用的结果直接返回（新放宽逻辑）。

**修复方向**：callBody id 用单调递增/UUID（或至少 skipInitialize 用与 initialize 不同的固定值），并在 SSE 挑帧时附加 `method`/`result` 形状约束；plain JSON 单对象至少在 `id` 存在且不等于 expectedId 时拒绝（或记录告警）。

**回归断言**：`parseEnvelope(上述 sse, 1)` 必须返回 id=2 的 tools/call 帧或抛错，**不得**返回 `serverInfo` 帧；initialize 与 tools/call 的 id 必须互不相同。

---

### P1-2 plain-JSON 路径放弃 id 校验 → 跨请求结果/错误串包
**位置** `mcp-client.js:134-142`。当前：
```js
const parsed = JSON.parse(body);
if (Array.isArray(parsed)) return parsed.find((r) => String(r.id) === String(expectedId)) ?? parsed[0];
return parsed;   // 单对象：完全不校验 id
```
注释称「stateless endpoints may echo a different (or no) id」，但代价是**任何** id 不匹配的单对象都被接受。

**取证**：
- `A1`：`{"id":7,"result":{"content":[{"text":"OTHER REQUEST"}]}}` 作为 id=1 调用的**正常结果**返回；
- `A3`：`{"id":7,"error":{code:-32000,message:"someone else's failure"}}` → 抛 `MCP error -32000: someone else's failure`（把别人的失败算到本次调用头上，进而误触发熔断/quota 分类）；
- `S`：batch 无匹配 id → `?? parsed[0]` 静默返回第一个元素。

JSON-RPC 2.0 规定响应 id 必须等于请求 id；「无 id」只应是通知（不带 result）。建议：单对象 `id === undefined` 且带 result 时容忍，`id !== undefined && String(id)!==String(expectedId)` 时抛 `failed to parse response envelope`；batch `?? parsed[0]` 改为找不到即抛错。

**回归断言**：`parseEnvelope('{"jsonrpc":"2.0","id":7,"result":{...}}', 1)` 抛错；`parseEnvelope('{"jsonrpc":"2.0","result":{...}}', 1)` 通过；batch 无匹配抛错。

---

### P1-3 `sessionCache` 只按 URL 键控，同 URL 不同 `extraHeaders` 复用旧 `Mcp-Session-Id`
**位置** `mcp-client.js:17`（`const sessionCache = new Map()`）、`:26`（`sessionCache.get(url)`）、`:101`（`sessionCache.set(url, ...)`）、`:150`（`invalidateSession(url)`）。

M-3 的 `forceFreshSession` 只是**在调用点**绕开读缓存；缓存键本身仍是纯 URL，未包含凭证/模式。`ensureSession` 甚至不接收 `extraHeaders`，无法参与键控。

**取证**（`r2-session.mjs`）：
```
A: KEY-A, options {}          -> initialize 1 次, tools/call sid=SESSION-FOR-INIT-1
B: KEY-B, options {}（同 URL） -> initialize 0 次, tools/call sid=SESSION-FOR-INIT-1   ← 复用 A 的会话
A session === B session ? true
D/E: forceFreshSession:true   -> 每次都重新握手（KEY-D≠KEY-E）✓
```
影响：换 API key / 同一 URL 多租户 / 未来新增 sessionful backend 时，旧会话被新凭证复用 → 401/数据错配。当前只有 TinyFish keyed 传 `forceFreshSession`，属于「约定式修复」而非结构性保证。

**修复方向**：缓存键加入 `extraHeaders` 中与鉴权/访问模式相关的规范化摘要（如 `URL + "\0" + stableHeaderDigest(extraHeaders)`），并把 `extraHeaders` 透传给 `ensureSession`/`invalidateSession`；或改为「keyed 调用一律不缓存」。

**回归断言**：同 URL、不同 `X-API-Key` 的两次 sessionful `mcpCall` 必须触发 2 次 initialize 且 tools/call 携带不同 `Mcp-Session-Id`；`invalidateSession(url, extraHeaders)` 只删对应键。

---

### P1-4 `redirect:"follow"` 的 `MAX_REDIRECTS` 永不生效（depth 递归重置）
**位置** `egress-fetch.js:24`（`tunneledFetch(..., 0)`）、`:98`（`depth < MAX_REDIRECTS`）、`:106`（`return egressFetch(next.href, nextInit)`）。

跟随重定向时调用的是**顶层** `egressFetch`（重新 `depth=0`），而不是 `tunneledFetch(next.href, nextInit, proxy, depth+1)`，所以 `MAX_REDIRECTS=5` 形同虚设。

**取证**（`r2-redirect.mjs`，本地真实代理 + 12 跳有限链）：
```
MAX_REDIRECTS=5, chain length=12
proxy requests made = 13  (correct behavior would be <= 6)
final response status = 200, body="TERMINAL-200"
VERDICT: BUG — MAX_REDIRECTS never accumulates; depth resets to 0 on every recursion
```
无限重定向链实测挂死（3s 仍存活，需 `kill -9`）。**当前 11 个调用点全部 `redirect:"error"`，故线上不触发**——属潜伏缺陷，但注释明确承诺「bounded redirect:follow」，一旦放开即成 DoS/配额耗尽面。

**diff 片段**
```diff
-        return egressFetch(next.href, nextInit);
+        // Re-evaluate proxyFor for the new URL, but carry depth forward.
+        const nextProxy = proxyFor(next.href);
+        return nextProxy === undefined
+          ? fetch(next.href, nextInit)
+          : tunneledFetch(next.href, nextInit, nextProxy, depth + 1);
```
**回归断言**：12 跳链 `redirect:"follow"` → 抛「too many redirects」（或 ≤6 次请求后返回 5xx），代理请求数 ≤ 6；无限链在有限时间内终止。

---

### P1-5 `initialize`/`notifications/initialized` 不带 `extraHeaders`（keyed 握手可能被 401 且重试路径同样缺）
**位置** `mcp-client.js:47-57`（initialize headers）、`:81-91`（notification headers）、`:204`（retry 调 `ensureSession(url, signal)`）。

TinyFish keyed 的 `X-API-Key` 只在 `tools/call` 请求里（`...extraHeaders` 在 `:188`），握手与重试后的握手都**没有**凭证头。按 MCP Streamable-HTTP 规范，`initialize` 与后续请求一样需要鉴权；注释里「Keyed requests are rejected without the Mcp-Session-Id」也暗示整条链都需 key。

**取证**（`r2-mcpcall.mjs` E / F）：
```
req#0 initialize  headers={"Content-Type","Accept","User-Agent"}          ← X-API-Key ABSENT
req#1 notify      headers={"Content-Type","Mcp-Session-Id","User-Agent"}  ← ABSENT
req#2 tools/call  headers={..., "X-API-Key":"secret"}                     ← 只有这里有
401 重试: req#3 initialize ABSENT, req#4 notify ABSENT, req#5 tools/call 有
```
影响：keyed TinyFish 在真实服务端上 initialize 可能 401 → `webErrorFromResponse` 抛错 → 整个 keyed 模式不可用（且这错误不会被 401 重试路径覆盖，因为重试只包住 tools/call）。属「修复引入的新路径未被验证」。

**修复方向**：`ensureSession(url, signal, { forceFreshSession, extraHeaders })`，把鉴权头合并进 initialize/notification；`mcpCall` 传 `extraHeaders` 下去；重试 `ensureSession` 同样传。注意不能把 `Mcp-Session-Id` 也塞进 initialize。

**回归断言**：keyed `mcpCall` 的每一次 initialize/notification 请求都带 `X-API-Key`；401 重试后的 initialize 也带。

---

### P2-1 SSE `data:` 行 `.trim()` 破坏跨行 JSON 字符串中的有效空格
**位置** `mcp-client.js:122`（`.map(l=>l.slice(5).trim()).join("")`）。
SSE 规范只应剥离**一个**可选前导空格（`strip a single leading U+0020`），且 `join("")` 本就不该无条件连接——跨行拆分发生在 JSON 字符串内部时，续行前导空格是**数据**。

**取证**（`r2-extra.mjs` P）：`data: {"...","text":"part1` + `data:  part2"}]}}` → 解析结果 `text="part1part2"`（空格丢失）。
**修复**：`l.slice(5).replace(/^ /, "")` 并用 `\n` 连接后再尝试（或按 SSE 规范在 data 行间插 `\n`；JSON 里字面换行非法，但可先 trim 掉续行的**单个**空格）。
**回归断言**：跨行拆分且续行带 1 个有效空格时，`text === "part1 part2"`。

### P2-2 SSE 与 plain-batch 的 id 比较不对称（严格 `===` vs `String()`），且无 id 帧在 SSE 下被丢弃
**位置** `mcp-client.js:128`（`r.id === expectedId`）vs `:140`（`String(r.id) === String(expectedId)`）。

**取证**（`r2-extra.mjs` Q）：
- SSE `id:"1"` + expectedId `1` → **THROW**；plain-batch 同帧 → RETURN。
- SSE 帧**无 id**（或 `id:null`）→ THROW，即使它是唯一的 result 帧（无状态服务器常见）；plain JSON 无 id → 放行。
- 纯 `\r\r` 分隔（旧 Mac/畸形 SSE）不被 `/\r?\n\r?\n/` 识别 → THROW。

新增测试 `lead-20261108-sse.test.js` 只覆盖了**plain-JSON** 的 string id / 无 id，未覆盖 SSE 侧的同样情形——容易产生「已修复」错觉。
**修复**：SSE 挑帧统一用 `String(r?.id) === String(expectedId)`，并对「整个流只有一个带 result/error 的帧且无 id」做兜底返回。
**回归断言**：SSE `id:"1"` / 无 id 单帧 → 返回该帧；`\r\r` 分隔 → 正确切分。

### P2-3 `envelope.result` 用真值判断，`result: null` / `result: {}` 边界
**位置** `mcp-client.js:241`（`if (!envelope.result)`）。
`result: null` 被判为「missing result」；`result: 0`/`""` 同理。MCP `tools/call` 的 result 是对象，一般非空，但 `isError:true` 的调用由各 backend 自行检查（`parseEnvelope` 已返回 result）。属低危一致性问题。
**回归断言**：`{"id":1,"result":null}` 应给出明确错误而非笼统「missing result」。

### P2-4 `parallel.js` `isError` 检查重复两次
**位置** `lib/backends/parallel.js:61-73` 与 `:81-86`（同一 `if (result?.isError === true)` 块出现两遍，第二遍在 `recordOutcome` 之后、`return` 之前，永远不可达）。文件还有多处成片空行，疑似合并残留。
**修复**：删除第二块（`:81-86`）与多余空行。
**回归断言**：grep `isError` 在 parallel.js 只出现 1 次。

### P2-5 `searxng.js` 非 2xx 分支两分支抛同一个错误（死条件）
**位置** `lib/backends/searxng.js:82-85`：
```js
if (response.status === 429 || response.status >= 500) {
  throw webErrorFromResponse(response, text, "SearXNG");
}
throw webErrorFromResponse(response, text, "SearXNG");
```
`if` 与 `else` 完全相同，条件无意义（原本大概想区分重试/配额）。功能无害，属维护噪音。
**回归断言**：合并为单次 `throw`。

### P2-6 `connectionAdmissionView` 是未接线的死代码
**位置** `lib/trust.js:56-70`；全仓无任何 import/调用（仅定义）。运行时 `getConnection()` 把原始 `connection` service 直接交给 `rejectionFor`，由后者内部兼容 `admit` / `requestRejection` 双拼写，`view` 的 late-binding thunk 与 `requestRejection→{rejection}` 包装能力没有被任何生产路径使用。当前 `rejectionFor` 行为已验证正确（0 mismatch），但这段「为 issue #89 设计」的代码无人验证，未来若有人改用它，`rejectionFor` 的 `admit.call(connection, req)` 与 view 的 getter 配合需重新测。
**建议**：要么在 `index.js` 的 `getConnection` 处接线并补 REAL-composition 测试，要么删除。

### P2-7 `webErrorFromResponse` 402/403 分类刚收窄，需补 403 回归
19:25 的并发改动把 `quota` 从 `402 || 403` 改为仅 `402`，理由是「403 是无效 key/forbidden/quota 三义，不该一律冷却」。我已实测新行为：`403 → code=WEB_PROVIDER_ERROR, quota=false, rateLimited=false, cooledUntil=0`，正确。但 `tests/lead-20261108-quota.test.js` 也在并发改动（19:30），需确认断言已同步为「403 不算 quota」，否则会出现「代码对、测试旧」的漂移。

---

## 三、已确认无误（逐项）

1. `parseEnvelope` 对「通知帧在前 + 响应帧在后」的 SSE 流：正确按空行切事件、逐帧 `JSON.parse`、挑 `id===expectedId && (result|error)`；这确实修掉了旧版 `join("")` 把 `{...}{...}` 拼坏的问题。
2. CRLF 分隔、`event:`/`id:`/`retry:`/`comment` 行、`data:[DONE]` 独立事件、空事件、BOM（首字符）全部正确处理。
3. `egressFetch` 无代理直连：undici 自合成 Host，忽略调用方伪造的 Host；`NO_PROXY`（含 `*`、前导点、端口、IPv6 括号）逻辑静态核对无误。
4. `httpViaProxy` 的 `host: headers.host ?? target.host` + `normalizeHeaders` 先删 Host：真实代理实测伪造 Host 被还原为 `target.host`，防 Cloudflare 403 的修复有效；`httpsViaConnect` 同表达式（对称性）。
5. `headersFromRaw` 用 `res.rawHeaders` 保留重复头：实测 `set-cookie` 两个值、重复 `x-dup` 都进 `Headers`。
6. 204/304 **空** body → `payload=null` → bodiless `Response`，正常。
7. `redirect:"error"`：302 抛 `fetch failed: redirect mode is set to error (302)`；`redirect:"manual"` 返回 302；POST 302/303 丢 body、307 保留 body；非重定向状态不受影响。全部实测通过。
8. `invalidateSession` 在 401/403/404 重试：invalidate → 重新握手（S1→S2）→ 重试成功；第二次失败不再无限重试；429/stateless 不重试；缓存收敛正确。
9. `trust.js` 结构复制分支：GET/POST 两侧、伪造 Host、跨站 Origin/Referer、端口/scheme 不符、`origin:null`、桌面 relay Referer 例外（含「relay 与 Origin/sec-fetch-site 同时出现 → 403」）、无 Host → 全 403；18 个用例 0 mismatch。
10. `rejectionFor` 对 mounted connection：`admit` 返回 `{rejection:401}` → 401；抛错 → 503；`{peer}` → 放行；legacy `requestRejection` 裸 status → 403；`onRejection` 抛错不影响决策。
11. `webErrorFromResponse` 11 处调用点（grep 计数 = 11）全部覆盖 `!response.ok` 路径，且 `egressFetch` 构造的 Response 带完整 headers → `Retry-After` 可达；当前 `402→QUOTA`、`429→RATE_LIMIT`、`403→普通错误` 分类正确。
12. 现有测试 `node --test tests/*.test.js` = 60/60 pass。

---

## 四、无法验证 / 受限项

1. **真实 HTTPS CONNECT 隧道路径**（`httpsViaConnect`）：本地无法起带有效证书的 TLS 上游 + 代理 CONNECT 组合，Host 还原只做了静态对称性核对与 `httpViaProxy` 的实网等价验证。建议用自签 CA 的本地 https 上游 + mitm 复测。
2. **真实 MCP 服务端行为**：Exa/Parallel/TinyFish/Firecrawl 线上是否真的会返回「id 不匹配 / 无 id / SSE 一帧内混 `[DONE]` / 600 状态 / 204 带 body」未做外网验证（本机无直连外网，需经代理；也不该消耗线上 keyless 配额）。所有复现均为本地 stub + 真实本地服务器。P1-1/P1-2/P0-1 的**触发条件**是协议允许的，但线上频率未知。
3. **keyed TinyFish 真实握手是否 401**（P1-5）：无有效 TinyFish API key，无法实证；仅依据规范与头部缺失的行为级取证推断。
4. **DSH 运行时 `connection` service 的真实形态**：只静态核对了 `packages/client/connection/src/rpc-host.ts` 的 `admit`/`requestRejection`，未在真实 profile 里注入并观察；`connectionAdmissionView` 的接线状态为 grep 结论。
5. **并发改动归属**：取证期间 `mcp-client.js`/`web-error.js`/`tests/*` 被另一进程修改（mtime 13:59 / 19:25 / 19:29 / 19:30）。我未改动任何源码/配置/测试，只在 `/tmp` 写复现脚本；报告中的行号均按最后一次读取的当前源码。若 lead 正在同步修复，部分 P1/P2 可能已被处理——请以本报告的**行为级断言**为准重新跑一遍。

---

## 五、5 条反直觉

**A. 「更宽容」的解析反而制造串包。** 上一轮把 plain-JSON 从「校验 id」放宽成「不校验 id」，理由是 stateless 端点会 echo 不同 id；但同一放宽让 `id=7` 的**别人的 error** 被当成 `MCP error -32000` 抛给本次调用，进而误触发熔断/quota 冷却。放宽单对象 id 校验省下的兼容，代价是把「响应关联」这一 JSON-RPC 基本不变量丢了——`expectedId` 参数在 plain 路径上现在几乎是死参数。

**B. 修 `id=2→1` 对齐官方，却和 `initialize` 撞了 id。** M-1 的注释说「sessionful 保留 2 以免 initialize 响应共享 id」，恰好说反了：`initialize` 用 id=**1**，skipInitialize 也改成 id=**1**。所以**无状态**调用才是与 initialize 共享 id 的那一方。在 SSE 单流里 `parseEnvelope(sse, 1)` 会优先挑到 initialize 形状的 `serverInfo` 帧并静默当成搜索结果返回——`if (!envelope.result)` 还检查不出错，因为它确实有 result。

**C. 一个「不可能」的 HTTP 状态码能打挂整个进程。** 204 带 body、600 状态、坏头名，看似只该让一次请求失败；但 `collect()` 把 `new Response()` 放在 `res.on("end")` 回调里且没有 try/catch，异常从 EventEmitter 冒泡成 `uncaughtException`。`collect(res).then(done, fail)` 的 `fail` 完全接不到它——Promise 的 reject 路径在这里是**假的**。真实代理发 `HTTP/1.1 600` 后 node 直接退出（exit=1）。稳定性问题的根因不是网络，是「同步 throw 发生在异步回调内」这一老陷阱。

**D. `MAX_REDIRECTS` 写了 5，实际是 ∞。** 跟随重定向时递归调用的是顶层 `egressFetch`（重新 `depth=0`），不是 `tunneledFetch(..., depth+1)`，所以 `depth < MAX_REDIRECTS` 恒真。12 跳链发了 13 次请求还一路走到 200。反直觉的是：**当前 11 个调用点全用 `redirect:"error"`，所以这个 bug 线上一次都不会触发**——注释里承诺的「bounded redirect:follow」是给未来读者的空头支票，也是最容易被「测试全绿」掩盖的一类缺陷。

**E. 「结构复制」分支比「真实 connection service」分支更严，而后者是默认路径。** 无 connection service 时 `structuralReason` 会查 Host、sec-fetch-site、Origin **和 Referer**，还拒 `origin:null` 和 https origin；一旦 host 挂了 `connection` service，`rejectionFor` **直接返回 host 的决定，完全跳过结构复制**（真实内核的 `isTrustedApiRequest` 不看 Referer）。也就是说「防御最厚的那层」只在降级时生效，正常运行时插件把信任完全外包给 host。更隐蔽的是：专为旧版 host 设计的 `connectionAdmissionView` 是**死代码**（全仓零调用），兼容性靠 `rejectionFor` 内的双拼写 if/else 兜住——两套机制并存，只有一套被验证。

---

## 附：复现脚本（/tmp，均为只读取证，跑完可删）

| 脚本 | 用途 |
| --- | --- |
| `r2-parse.mjs` | 从真实源码提取 `parseEnvelope`，17 个边界用例 |
| `r2-mcpcall.mjs` | 提取整个 `mcp-client.js` 注入 stub `egressFetch`，drive 完整 `mcpCall` |
| `r2-session.mjs` / `r2-retry.mjs` | sessionCache 键控 / 401-403-404 重试路径 |
| `r2-extra.mjs` | `.trim()` 破坏空格、id 不对称、CR-only 分隔 |
| `r2-egress.mjs` / `r2-redirect.mjs` / `r2-redirect2.mjs` | 真实本地 HTTP 代理：Host/204/304/重复头/重定向/MAX_REDIRECTS |
| `r2-reach2.mjs` | 原始 socket 上游发畸形状态行，证明 `collect()` 进程崩溃 |
| `r2-collect.mjs` | `collect()` / `headersFromRaw` 单元级异常条件 |
| `r2-trust.mjs` | `rejectionFor` 18+ 用例，0 mismatch |
