# 31-adversarial-search-b — 对抗审查备份：搜索执行与两个新后端

> 备份版（fork 子代理可能写文件前失败时由本文件兜底）。`31-adversarial-search.md` 在本次取证时**不存在**（`ls 31-*` 报 no such file），故本文件按主版写，不做交叉复核补遗。
> 目标：假定仍有遗漏、尽力**证伪**搜索执行链路与 `firecrawl.js` / `tinyfish.js` 两个新后端，独立取证。
> 口径：全程**只读**（read/grep/glob + 只读 GitHub API + `/tmp` 下 `node` 最小复现，脚本跑完已删除）；未改源码/配置/其它报告；未操作任务板。GitHub token 取自 `/opt/xr-research/zcode-research/.git/config` 的 remote URL，按 `U=x-access-token; P=${TOK#*:}` 派生、**值未写入任何输出或文件**。
> 证据等级：**A**=源码实证（本地路径:行号 / 带 ref 的远端永久链接）；**B**=官方文档/上游官方源码（GitHub API `?ref=v2.2.5`，HTTP 200）；**C**=版本记录（tag/commit/sha）；**D**=本机实测（`node` 复现 / 真实遥测记录 / curl）；**E**=推断或无法验证（显式标注，不得当结论）。
> 取证时间：2026-11-07（Asia/Shanghai）。本机插件版本 **2.8.4**（`package.json`，C）；OpenCode 一律 **v2.2.5**（`anomalyco/opencode`，C）。

---

## 0. 取证清单与结论速览

| # | 审查项 | 裁决 | 等级 |
|---|---|---|---|
| 1 | `egressFetch` 全部出口路径的 Host 处理 | **部分通过**：CONNECT / httpViaProxy 两路径正确；`normalizeHeaders()` 的 `delete host` 有两类隐患 | A+D |
| 2 | `mcpCall` 的 `skipInitialize` 零回归 / session 泄漏 | **通过**（旧调用零回归、无泄漏）；但发现 TinyFish keyed 分支的握手语义与上游有差异 | A+B |
| 3 | 两个新后端与 v2.2.5 上游逐字对齐 | **基本对齐**，但发现 **P0：两个新后端的可选 Key 永远读不到**（只读 `options.apiKey`，而 `resolveOptions` 只给 `resolveApiKey`） | A+B+D |
| 4 | 错误隔离 / hooks / 密钥泄漏 | **通过**：allSettled + 每后端 AbortController + 超时 + 软降级齐全；无密钥入 hooks；但 `firecrawlBaseURL` / `tinyfishBaseURL` 配置项**注册了却不生效**（P1） | A+D |
| 5 | 6 处登记集合对比 | **全部同步**（13 个 id，零 set diff）；差异均为设计使然 | A+D（脚本） |
| 6 | `provider.js:321` RFC1918 正则 | **通过**：26/26 边界用例符合预期，`192.168.1.1.evil.com` 无法绕过；但 `\d{1,3}` 不做 0-255 范围校验（低危，P2） | A+D |
| 7 | 真实遥测 `firecrawl ✗ (MCP error: Anonymo…)` / `tinyfish ✓/8` | **支持「预期 keyless 额度降级」**，与代码 bug 无关；「firecrawl 超时 10s」在本机代码/日志中**查无依据**（E） | C+D+E |

---

## 1. 逐条裁决表

### §1 `egress-fetch.js` 的 Host 补正是否覆盖所有出口路径

**A 级：`egressFetch` 的全部出口路径枚举**（`lib/util/egress-fetch.js:21-25,75-111`）：

| 路径 | 触发条件 | 代码落点 | Host 结果 |
|---|---|---|---|
| ① 无代理直接 `fetch(url, init)` | `proxyFor()` 返回 `undefined`（未设 `HTTP(S)_PROXY`、或目标命中 `NO_PROXY`、或非 http(s)） | `:23` | **不经过 `normalizeHeaders`**，直接把原始 `init.headers` 交给 native fetch |
| ② `httpViaProxy(target,…)` | 有代理 + `target.protocol === "http:"` | `:89` → `:209-243`，`:217` `headers:{...headers, host: headers.host ?? target.host}` | 显式 Host（但 `normalizeHeaders` 已删 caller Host，故恒为 `target.host`） |
| ③ `httpsViaConnect(target,…)` | 有代理 + `https:`（CONNECT 隧道） | `:88` → `:117-207`，`:191` `headers:{...headers, host: headers.host ?? target.host}` | 显式 Host，同上 |
| ④ `forwarder` / sidecar | **本插件 `lib/` 中不存在该路径**（`grep -rniE 'forwarder\|sidecar\|EnvHttpProxyAgent'` 只命中 `index.js:112,259,261,263` 四条**注释**，无实现） | — | 不适用 |
| ⑤ 重定向递归 | `REDIRECT_STATUS` 且 `redirect !== "error"`，`egressFetch(next.href, nextInit)` | `:91-107,:106` | 重新走 ①–③，Host 按新 URL 重算 |

**裁决 1.1（通过，A+D）**：两个代理路径的 Host 补正**确实覆盖所有实际出口**；本机不存在第四种 forwarder 路径，故「所有出口路径」在本机等价于 ①②③⑤。`httpViaProxy` 的 `path: target.href`（`:216`）是 absolute-form 请求行，与显式 Host 一致。

**裁决 1.2（关键实测，D）**：用 `/tmp` 下最小复现（raw TCP socket → `https.request({socket, agent:false, servername})`，与 `:185-192` 生产形态一致）测得服务端实际收到的 Host：
```
A socket + 无显式 Host           → Host = "localhost"          （裸主机名，无端口）
B socket + Host=target.host(带端口) → Host = "localhost:36369"
C socket + Host=裸主机名          → Host = "localhost"
```
这**逐字印证** `egress-fetch.js:170-184` 的注释：预连接 socket 下 Node 自动合成的是裸主机名、不含端口；Cloudflare 前置的 MCP 端点据此返回 403。补丁 `host: headers.host ?? target.host` 在 `:191` 与 `:217` 两处都存在，缺一即回退 403。**结论：修复本身正确、必要，且两路径对称。**

**裁决 1.3（缺陷 P2，A）**：`normalizeHeaders()` 无条件 `delete headers["host"]`（`:291-297`）。
- 对 ②③：caller 显式 Host **永远被丢弃**，`:191/:217` 的 `headers.host ?? target.host` 中的 `headers.host` 恒为 `undefined`，右侧 fallback 恒生效 → **补丁里的 `headers.host ??` 是死分支**（注释 `:293-296` 宣称「a caller-supplied Host must not override the tunnel target」，与保留 `??` 的表达自相矛盾，但行为安全）。
- 对 ①（**直接 fetch 路径，题目点名**）：`normalizeHeaders` 根本不被调用（`:23` 提前 return），所以 **不会丢 Host**；native fetch 会自己按 URL 合成 Host。D 级实测（`http://127.0.0.1:P`）确认收到 `127.0.0.1:P`；即便 caller 传 `Host: evil.example.com`，undici 也忽略并合成正确的 `127.0.0.1:P`。⇒ 「直接 fetch 丢 Host」**证伪**。
- 真正的不对称（P2）：若部署把 `NO_PROXY` 配成命中 MCP 域名，路径 ① 生效，此时 caller 的 `Host` 会被 undici 忽略（安全），但**不再有显式的端口限定 Host 补丁**——对默认 443 目标无影响，对非默认端口的代理-less MCP 端点则可能与 ②③ 行为不同。本机代理常开，实测未覆盖该组合 → **E**。

**裁决 1.4（IPv6/端口，A+D）**：
- `target.host`（WHATWG URL）含端口且 IPv6 带方括号：`https://[2001:db8::1]:8443/p` → `host="[2001:db8::1]:8443"`；`https://example.com/x` → `host="example.com"`（默认端口省略）。两者都**是合法的 HTTP Host 值**。
- 但 `httpsViaConnect` 的 CONNECT 行 `:147,:154` 用 `${target.hostname}:${port}`，其中 `hostname="[2001:db8::1]"`，`port=8443/443` → `CONNECT [2001:db8::1]:8443`，`Host: [2001:db8::1]:8443`，**符合 RFC 7230 的 IPv6 literal 加端口形式**。
- **P2 隐患**：默认端口的 IPv6 目标 `https://[2001:db8::1]/p` 会生成 `Host: [2001:db8::1]`（无 `:443`），而 CONNECT 用 `[2001:db8::1]:443`。对严格校验 Host 与 CONNECT authority 一致性的代理，可能被拒；标准代理一般接受。本机代理目标均为域名+443，未实测 IPv6 → **E**。
- `inNoProxy`/`splitHostPort`（`:45-73`）对 `[::1]:port` 有专门解析，逻辑正确。

**裁决 1.5（P2，A）**：`httpViaProxy` 的 `settled` 变量在 `:225` 声明于 `fail()`（`:220`）之后 —— 由于 `const/let` 的 TDZ，`fail` 是函数体、只在事件回调里执行（此时已过声明行），**不会抛 ReferenceError**；但 `:230-235` 的 `collect().then` 分支重复检查 `settled`，与 `fail` 的检查重叠，属冗余而非缺陷。

---

### §2 `mcp-client.js` 的 `skipInitialize`

**A 级事实**（`lib/util/mcp-client.js`）：
- `:159` 签名 `mcpCall(url, toolName, args, extraHeaders = {}, signal, options = {})`；`:163` `const sessionId = options.skipInitialize ? undefined : await ensureSession(url, signal);`
- 全部 4 个调用点：`exa.js:62`、`parallel.js:50`（不传第 6 参数 → `options={}` → 走完整握手）；`tinyfish.js:62-71`（`{skipInitialize: !keyed}`）；`firecrawl.js:58-64`（**不传** → 恒走完整握手）。

**裁决 2.1（零回归成立，A）**：`options` 默认 `{}`，`skipInitialize` 缺省 `undefined` → falsy → `ensureSession()` 必被调用。exa/parallel/firecrawl 三个旧/既有调用**行为逐字不变**（`initialize` → `notifications/initialized` → `tools/call`，`id:1` / `id:2`，`Mcp-Session-Id` 缓存 10 分钟 TTL `:13,:27-29`）。

**裁决 2.2（session cache 不泄漏，A）**：
- `skipInitialize:true` 时 `:163` 直接给 `undefined`，**完全不进入 `ensureSession`**，因此既不读也不写 `sessionCache`（`Map` 模块级 `:16`）。
- `:179` 的 `...(sessionId ? … : {})` 恒不注入 `Mcp-Session-Id`；`:194` 的 401/403/404 重试分支以 `if (sessionId && …)` 为门槛，**skip 时不会触发** `invalidateSession` + 二次 `ensureSession`。
- ⇒ keyless 路径既不会把上一次 keyed 会话的 `Mcp-Session-Id` 带出去，也不会污染缓存。**无泄漏，证伪「泄漏」假设。**
- 反向小隐患（P2）：若同一 URL 先 keyed（缓存了 session）后 keyless，skip 路径不读缓存 → 正确；但 `invalidateSession` 只在 sessionful 的 401/403/404 才调用，keyless 被 429/配额拒时缓存（若曾存在）**不会失效**。本机 `agent.tinyfish.ai` 只走 keyless（见 §3 的 P0），实际不会写缓存 → 影响为零。

**裁决 2.3（与上游对照，B）**：`anomalyco/opencode` v2.2.5 `tinyfish.ts:78-79` 逐字：`// Keyed requests are rejected without the Mcp-Session-Id returned by initialize; keyless ones are not.` + `const session = credential?.type === "key" ? yield* initialize(...) : undefined;` ⇒ **keyless 跳过 initialize、keyed 必握手**，与 `tinyfish.js:70` 的 `{skipInitialize: !keyed}` 语义完全一致。`initialize()` 上游用 `protocolVersion:"2025-06-18"`（`tinyfish.ts:115`），本机 `mcp-client.js:12` 同为 `2025-06-18` → 逐字对齐。

**裁决 2.4（P1，A+B）**：上游 `tinyfish.ts:104-146` 的 keyed `initialize` 是**每次调用都重新执行**（无缓存、25s 超时、`Mcp-Session-Id` 缺失即 fail），而本机 `ensureSession` 是 **10 分钟 TTL 的 URL 级缓存**。两者在「keyed 会话复用」上不等价：若服务端会话短于 10 分钟，本机可能拿着过期 `Mcp-Session-Id` 打 `tools/call`，靠 `:194` 的 401/403/404 重试一次补救（**只在 sessionful 时才重试**）。这是设计取舍而非逐字对齐，标 P1/待实测（E）。

---

### §3 `firecrawl.js` / `tinyfish.js` 与 v2.2.5 官方源码逐字对齐

取证方式（B）：GitHub API `raw` `?ref=v2.2.5`，三个文件均 **HTTP 200**：`firecrawl.ts`(2976 B)、`tinyfish.ts`(5395 B)、`mcp.ts`(2569 B)。永久链接：
- https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/firecrawl.ts
- https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/tinyfish.ts
- https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/mcp.ts

| 维度 | 上游 v2.2.5（B） | 本机（A） | 裁决 |
|---|---|---|---|
| 端点 | `firecrawl.ts:9` `https://mcp.firecrawl.dev/v2/mcp`；`tinyfish.ts:10` `https://agent.tinyfish.ai/mcp` | `firecrawl.js:28`、`tinyfish.js:31` 同值 | ✅ 逐字一致 |
| tool 名 | `firecrawl.ts:62` `"firecrawl_search"`；`tinyfish.ts:83` `"search"` | `firecrawl.js:29`、`tinyfish.js:32` 同值 | ✅ |
| 请求参数 | `firecrawl.ts:11-14` `McpInput={query: String, limit: Number.optional}`，调用 `:64` `{query: input.query, limit: 8}`；`tinyfish.ts:12-14` `McpInput={query: String}`，调用 `:85` `{query: input.query}` | `firecrawl.js:41-44` `{query, limit: request.maxResults ?? 8}`；`tinyfish.js:44` `{query}` | ✅ **题目问的「`firecrawl_search` 参数真是 `{query,limit}` 吗」= 是**（`limit` 可选，上游硬编码 8、本机用 `maxResults` 默认 8，语义等价） |
| 响应解析 | 两者 `McpOutput={content:[{type:"text",text:String}]}`（`:16-18`）；`SearchResponse = Schema.fromJsonString(...)`（`firecrawl.ts:20-33` → `{success,data:{web:[{url,title?,description?}]}}`；`tinyfish.ts:20-30` → `{results:[{url,title,snippet}]}`）；`content.find(item => item.text)` + `decodeUnknownOption` + `?? []` | `parseFirecrawlResult` / `parseTinyfishResult` 取 `result?.content?.[0]?.text` → `JSON.parse` → 校验 `success !== false && Array.isArray(data.web)` / `Array.isArray(results)` → 映射 `{url,title?,snippet?}` | ✅ **题目问的「`search` 响应真是 `content[0].text` 的 JSON 串吗」= 是**（上游用 `Schema.fromJsonString`，本机用 `JSON.parse`，语义一致） |
| 解析失败 | 上游 `Option.getOrUndefined(decode…)` + `?? []` → **安全返回空** | `firecrawl.js:89-96`、`tinyfish.js:96-103`：`typeof text !== "string"` / `JSON.parse` catch / 结构不符 → `return []` | ✅ **安全返回空**；D 级用 9+5 个畸形输入实测全部返回 `[]`，无一 throw |

**D 级解析鲁棒性实测**（`/tmp` 脚本，已删）：`undefined` / `null` / `{}` / `content:[]` / `text:123` / `'not json'` / `success:false` / `data.web` 非数组 / `item.url` 非字符串 / `results` 非数组 → 全部 `[]`；合法输入正确产出 `{url,title,snippet}`。⇒ 解析失败不会拖垮后端（配合 §4 的软降级更不会拖垮整批）。

**⚠️ 裁决 3.1（P0 缺陷，A+D）**：两个新后端**只读取 `options?.apiKey` 字面量**（`firecrawl.js:45`、`tinyfish.js:45`），而 `resolveOptions()`（`index.js:362-381`）为每个后端生成的 `beOpts` **只含 `resolveApiKey` 异步函数，不含 `apiKey` 字段**。D 级实测（stub 外部依赖后真实调用 `resolveOptions`）：
```
firecrawl beOpts keys: [apiKeyEnv, baseURL, model, safeSearch, label, requiresKey, resolveApiKey]
firecrawl.apiKey literal? false | resolveApiKey type: function
```
`grep -rnE '\.apiKey\s*=|apiKey\s*:' lib/` 确认 `index.js`/`provider.js` **从不注入字面量**。⇒ 即使用户在 Settings 填了 `FIRECRAWL_API_KEY` / `TINYFISH_API_KEY`，两个后端也**永远判定 `keyed=false`**：
- Firecrawl 恒发 keyless 请求（`extraHeaders={}`），额度提升路径完全失效；
- TinyFish 恒走 `skipInitialize:true` + `X-TinyFish-Access-Mode: keyless`，**keyed 分支（含 `X-API-Key` 与三步握手）是不可达死代码**。
- 对照：所有既有 key-gated 后端（`tavily.js:28`、`brave.js:28`、`serper.js:29`、`mojeek.js:28`、`openai.js:42`、`anthropic-like.js:71`）都用 `await resolveApiKey()` 或 `options?.apiKey ?? await resolveApiKey?.()`。**新后端是唯一偏离该契约的两处。**
- 修法（P0）：把两处改为 `const apiKey = (typeof options?.apiKey === "string" && options.apiKey.length > 0) ? options.apiKey : await options?.resolveApiKey?.();`（与 `anthropic-like.js:71` 一致），并保留 `hooks.recordRequest` 的 `headers:{}` 脱敏。

**裁决 3.2（P1，A+D）**：`index.js:368` 为所有 id 派生 `baseURL: config?.[`${id}BaseURL`] ?? DEFAULT_BASE_URLS[id]`，且 Config 里确实注册了 `firecrawlBaseURL` / `tinyfishBaseURL`（`:260-263`）；但 `firecrawl.js:59`、`tinyfish.js:63` 把**硬编码常量** `FIRECRAWL_ENDPOINT` / `TINYFISH_ENDPOINT` 直接传给 `mcpCall`，`grep -n baseURL` 两文件均为 **0 命中**。⇒ 这两个设置项（以及注释 `:112,:259-263` 宣称的「可指向 TLS sidecar」）**是 inert 的**。修法：改用 `options?.baseURL ?? FIRECRAWL_ENDPOINT`（参照 `tavily.js:33` / `brave.js:33`）。注意修后 `provider.js:313-326` 的 trust gate 才会真正检查这两个 URL（目前因硬编码而绕过了配置面校验）。

**裁决 3.3（P2，A+B）**：`firecrawl.js` 与上游一样**不传** skipInitialize（走完整三步握手），但上游 `mcp.ts:28-68` 的 `WebSearchMcp.call` 是**无 initialize 的直接 `tools/call`**（`id:1`，25s 超时，256KB 响应上限）。即上游 Firecrawl **不做三步握手**，本机却做了。Lead 实测 `mcp.firecrawl.dev` 的 initialize 返回 200（D），所以本机多一次握手不致失败，只是**多一次 RTT + 依赖 `Mcp-Session-Id` 语义**；且成功结果需回传 `conversationId`（`00-lead-live-probe.md:49`，D）本机未处理。⇒ 非致命，但属「未逐字对齐」，标 P2/E（未做实搜 A/B 验证）。

**裁决 3.4（P2，A）**：`index.js:373` `requiresKey: DEFAULT_KEY_ENV[id] !== undefined`，而 `DEFAULT_KEY_ENV` 含 `firecrawl`/`tinyfish`（`:94-95`）→ `requiresKey=true`，`health.js:57` 因此把两者标为**非 keyless**；但 `client.js:31-32` 把它们标 `optionalKey:true, metered:true`，`BACKENDS` 的 `available()` 恒 `true`。三处语义不一致（health 说要 key、client 说可选、backend 说不需要）。⇒ 只影响 `/api/…/health` 展示，不影响执行；建议 health 改用 `optionalKey` 概念。

---

### §4 错误隔离 / hooks / 密钥泄漏

**裁决 4.1（通过，A）**：`provider.js` 的隔离链完整：
- `Promise.allSettled`（`:361-369`）→ 任一后端 reject 不会中断其它；`collectFanoutResults`（`:122-153`）把失败折进 `failures[]`，只有 `allFailures.length>0 && ordered.length===0` 才抛（`:483-498`）；「全部成功但 0 条」正常返回空（`:462-480`）。
- 每后端独立 `AbortController` + `AbortSignal.any([caller, controller])`（`:327-330`）+ `setTimeout(abort, effectiveTimeoutMs)`（`:331-332`）+ `.finally(clearTimeout)`（`:358`）；`createLimiter`（`:86-112`）用 `Promise.resolve().then(fn)` 规避同步抛出死锁（`:99-104` 注释有实测）。
- 超时被重分类为 `WEB_PROVIDER_ERROR "backend <id> timed out after Nms"`（`:348-357`），不会被误当调用方取消；`WEB_ABORTED` 仅在 caller signal 真触发时才 hard（`:142-145,:370,:393-395`）。
- 熔断 `foldBreaker` + fail-open（`:283-293`）：全部 cooled 时照跑，不让搜索更差。

**裁决 4.2（通过，A）**：两个新后端都调了 `hooks.recordRequest`（`firecrawl.js:49-54`、`tinyfish.js:53-58`）与 `hooks.recordOutcome`（成功 `:81` / `:88`，MCP error `:76` / `:83`）。`provider.js:363-366` 把 hooks 注入每个后端；`util/log.js` 把两者写到 **host logger 而非 session ledger**（避免污染已知事件类型集合，文件头注释有据）。

**裁决 4.3（通过，密钥不泄漏，A）**：
- `recordRequest` 的 `headers: {}` 恒为空（`firecrawl.js:53`、`tinyfish.js:57`）；`Authorization: Bearer` / `X-API-Key` 只在 `extraHeaders` 里，直接进入 `mcpCall` 的 HTTP 请求头，**从不进 hooks**。
- `recordOutcome` 只带 `status/count/message`，无 headers。
- `provider.js:342` 的遥测错误串 `.slice(0,80)`、`:445` 再 `.slice(0,40)`，不含 headers。
- 但 `util/log.js` 的 `summarize()` 会 `JSON.stringify(request.body)` 前 200 字符 —— 两个新后端 body 只有 `{query,limit}` / `{query}`，**无密钥**。`mcpCall` 的 `extraHeaders` 在 `:181` 被展开进请求头，但**不经过 log.js**。⇒ 无泄漏面。
-  caveat（P2）：`WebError` 的 `cause` 可能携带底层 `TypeError`（`egress-fetch.js` 的 `sanitize()` 已把 message 截到 140 字符且不含 URL 凭据），未见凭据回显。

**裁决 4.4（P1，A）**：`firecrawl.js`/`tinyfish.js` 在 `parseXxxResult` 返回 `[]` 时**仍记录 `{status:"ok", count:0}`**（`:81` / `:88`），而 provider 的 `recordBackendHealth` 也按 `ok:true` 计（`:337-339`）。⇒ 服务端返回「结构合法但零结果」或「畸形 JSON 被安全吞掉」时，健康遥测显示 ✓ 而非 ✗，熔断不会累积。这是**可观测性缺陷**，不是执行缺陷；建议 `sources.length===0 && result 非空` 时记 `status:"error"` 或新增 `empty` 状态。

---

### §5 六处登记集合对比（脚本实测，D 级；A 级源码）

`/tmp` 下 Node 脚本解析 `index.js` 与 `client.js` 的 6+ 处集合（脚本已删）：

| 集合 | 落点 | 数量 | 与 `index.BACKENDS` 的 set diff |
|---|---|---|---|
| `BACKENDS` | `index.js:57-74` | **13** | — |
| `client.js` `BACKENDS` 副本 | `client.js:14-33` | **13** | `onlyIndex=[]`, `onlyClient=[]` ✅ |
| `DEFAULT_KEY_ENV` | `index.js:85-96` | 9 | 缺 `exa,parallel,ddg,searxng`（keyless 无需 key，**设计使然**）✅ |
| `DEFAULT_BASE_URLS` | `index.js:99-115` | **13** | 零差异 ✅ |
| `DEFAULT_LABELS` | `index.js:130-146` | **13** | 零差异 ✅ |
| `Config` toggles | `index.js:201-214` | **13** | 零差异 ✅ |
| `Config` `*ApiKeyEnv` 字段 | `index.js:217-239` | 10 | 缺 `exa,parallel,ddg`（keyless 无此字段）✅ |
| `Config` `*BaseURL` 字段 | `index.js:242-263` | 10 | 缺 `exa,parallel,ddg`（MCP/DDG 端点硬编码，见 §3.2）✅ |
| `toggleMap` | `index.js:327-342` | **13** | 零差异 ✅ |

- `DEFAULT_ENABLED = ["exa","parallel","ddg","searxng"]`（`:82`），**不含 firecrawl/tinyfish** ✅（D 级脚本 `false false`）。
- `resolveOptions` 的 `${id}BaseURL` 派生（`:368`）**覆盖全部 13 个 id**（含两个新 id）✅ —— 但见 §3.2：派生了却没被新后端消费。
- ⇒ **结论：6 处登记集合完全同步，未发现漏登记**；「集合不一致」假设证伪。唯一实质问题是 §3.2 的「字段存在但消费端不用」。

---

### §6 `provider.js:321` RFC1918 正则（`{3}`→`{2}`）

**D 级：26 个 IPv4 边界用例，0 mismatch**（Node 复现，正则逐字取自 `provider.js:321`）：
```
正则 = /^(localhost|127(\.\d{1,3}){3}|10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2})$/
```
| 类别 | 用例 | 期望 | 实测 |
|---|---|---|---|
| 合法私有 | `localhost`, `127.0.0.1`, `10.0.0.1`, `10.255.255.255`, `192.168.1.1`, `192.168.1.100`, `192.168.255.254`, `172.16.0.1`, `172.31.255.255` | true | ✅ 全 true |
| 172 边界 | `172.15.0.1`, `172.32.0.1` | false | ✅ 全 false |
| 段数错误 | `192.168.1`, `192.168.1.2.3`, `10.1.2`, `10.1.2.3.4` | false | ✅ 全 false |
| **题目点名绕过** | `192.168.1.1.evil.com`, `192.168.1.1.evil`, `localhost.evil.com`, `127.0.0.1.evil.com`, `10.0.0.1.example.com` | false | ✅ **全 false，无法绕过** |
| 公网/域名 | `8.8.8.8`, `example.com`, `[::1]`, `::1` | false | ✅ 全 false |

- **裁决（通过，A+D）**：`{3}→{2}` 修复正确 —— `192.168` / `172.16-31` 已占据前两段，只需再两段；旧 `{3}` 会把 `192.168.1.100` 判非法，导致「http 仅私有」承诺失效。锚点 `^...$` + `URL.hostname`（不含端口、不含 userinfo）保证 `192.168.1.1.evil.com` 之类**不能**伪装私有主机；`bu.username || bu.password` 另在 `:323` 拒绝 URL 内嵌凭据。
- **P2 小瑕疵（A+D）**：`\d{1,3}` 只校验位数不校验 0-255 —— 但 `new URL("http://192.168.999.999:8385")` 直接抛 `ERR_INVALID_URL`（D 实测），`192.168.001.001` 被 WHATWG 归一为 `192.168.1.1` 再匹配 → **实际不可利用**。`[::1]` / IPv6 loopback 不匹配（regex 无 IPv6 分支），若运维用 `http://[::1]:8385` 会被 trust gate 拒（要求 https）→ P2 兼容性缺口，标 **E**（未测真实 IPv6 私有实例）。
- 补充（A）：`:322` `schemeOk = https: || (http: && privHost)`；配合 `:323` 的 `bu.username/password`，「http 仅私有」边界闭合。

---

### §7 真实遥测：`firecrawl ✗ (MCP error: Anonymo…)` / `tinyfish ✓/8`

取证：`25-execution-log.md:270,285`、`36-lead-prefindings.md:48`、`99-final-verdicts.md:69`（均为 D/C 级既有记录，非本次复跑）。

| 项 | 裁决 | 依据 |
|---|---|---|
| `tinyfish ✓3941ms/8` | **真实成功**：keyless `tools/call search` 返回 8 条，证明 `skipInitialize:!keyed` 的 keyless 路径、`X-TinyFish-Access-Mode` 头、`parseTinyfishResult` 全链路通 | D：`25-execution-log.md:270` + `parseTinyfishResult` 实测；A：`tinyfish.js:44-89` |
| `firecrawl ✗ (MCP error: Anonymo…)` | **支持「预期 keyless 匿名额度降级」，不是代码 bug**：错误是 MCP `result.isError===true` 时由 `firecrawl.js:74-77` 原样抛出的**服务端文本**（`Anonymo…` 显然是 anonymous quota/额度文案），且 `tinyfish` 同时成功、`ddg/exa/parallel ✓`，说明扇出/解析/Host 补丁均正常；`00-lead-live-probe.md:45-50` 已证实 hosted keyless tier 有用量限制 | D：`25-execution-log.md:270,285` + `00-lead-live-probe.md`；A：`firecrawl.js:74-77` |
| 是否可能是代码 bug？ | **不能完全排除（E）**：`firecrawl.js` 走完整三步握手而上游 `mcp.ts` 是直接 `tools/call`（§3.3），若服务端对 keyless 会话的 `initialize` 返回了带额度提示的 error envelope，也会表现为 `MCP error`。但错误文本以 `Anonymo` 开头 + 官方 keyless 按 IP 日限额（B：`docs.firecrawl.dev/rate-limits.md#keyless-no-api-key`，见 05 报告附录 A.2）→ **主因是额度降级，置信度高**；要 100% 定论需抓一次完整 MCP 响应体（本次只读未做）→ 标 E | B+D+E |
| **「firecrawl 超时 10s 是否拖慢整批」** | **查无 10s 依据**：`grep -rniE '10000\|10\*1000\|10s' lib/` **零命中**；`BACKEND_TIMEOUT_OVERRIDES_MS` 只有 `ddg:5000` / `searxng:5000`（`provider.js:38-41`），firecrawl 用全局 `backendTimeoutMs` 默认 **30000**（`index.js:160-161`）。上游 `mcp.ts:65` 是 **25s** 超时，也不是 10s。**但**：`Promise.allSettled` 必须等最慢的后端（`:361`），若 firecrawl 真挂到 30s，整批延迟 = max(各后端)，不会被 5s 覆盖。⇒ 「10s」是**无法证实的口径（E）**；「firecrawl 无专属超时上限、可能拖到 30s」是**真实现象（A）**，建议 P1 加 `firecrawl: 10000` 之类的 override | A+D+E |

---

## 2. 缺陷清单（P0 / P1 / P2 + 证据 + 修法）

| 级别 | 缺陷 | 证据（等级） | 修法 |
|---|---|---|---|
| **P0-1** | `firecrawl.js:45` / `tinyfish.js:45` 只读 `options.apiKey`，`resolveOptions` 只给 `resolveApiKey` → **可选 Key 永远不生效**；TinyFish keyed 分支（含 `X-API-Key` + 三步握手）是不可达死代码；Firecrawl 无法提额 | A（`index.js:362-381` 无 `apiKey` 字段）+ D（stub 实测 `apiKey literal? false`）+ A（对照 `tavily.js:28` 等 6 个既有后端都用 `await resolveApiKey()`） | 两处改为 `const apiKey = (typeof options?.apiKey === "string" && options.apiKey.length>0) ? options.apiKey : await options?.resolveApiKey?.();`（对齐 `anthropic-like.js:71`）；补单测断言 keyed 时 `extraHeaders` 含 `X-API-Key` 且 `skipInitialize===false` |
| **P1-1** | `firecrawlBaseURL` / `tinyfishBaseURL` 注册但**不被消费**（后端硬编码端点）→ sidecar/代理覆盖失效，且绕过 `provider.js:313-326` 的配置面 trust gate | A（`index.js:260-263,368`；两后端 `grep baseURL` = 0 命中；`firecrawl.js:59`、`tinyfish.js:63` 传常量） | `mcpCall(options?.baseURL ?? FIRECRAWL_ENDPOINT, …)`，并在 `recordRequest.endpoint` 同步用解析后的 URL；补测试改 baseURL 后请求落到新地址 |
| **P1-2** | 两个新后端**无专属超时上限**，用全局 30s；`Promise.allSettled` 使整批延迟 = 最慢后端。Firecrawl keyless 被拒/挂起时拖尾明显 | A（`provider.js:38-41` 只有 ddg/searxng 5s；`:361` allSettled）；E（「10s」说法无出处） | 在 `BACKEND_TIMEOUT_OVERRIDES_MS` 加 `firecrawl: 10000, tinyfish: 10000`（或按实测配额定），并复跑遥测确认尾延迟 |
| **P1-3** | 解析失败/零结果仍记 `{status:"ok",count:0}` → 健康遥测 ✓、熔断不累积，掩盖服务端降级 | A（`firecrawl.js:80-81`、`tinyfish.js:87-88`、`provider.js:337-339`） | 结果为空时记 `status:"error"` 或新增 `empty`，让 `foldBreaker` 可感知 |
| **P1-4** | `ensureSession` 的 10 分钟 URL 级 session 缓存 vs 上游 TinyFish keyed **每次重新 initialize**（25s 超时、缺 `Mcp-Session-Id` 即 fail），语义不等价 | A（`mcp-client.js:13,27-29`）+ B（`tinyfish.ts:104-146`） | keyed 分支考虑禁用缓存或缩短 TTL；依赖 `:194` 的 401/403/404 单次重试兜底 |
| **P2-1** | `normalizeHeaders` 的 `delete host` 使 `:191/:217` 的 `headers.host ??` 成为死分支；注释与代码表达矛盾 | A（`egress-fetch.js:291-297`）+ D（复现） | 直接写 `host: target.host`，删掉误导性注释；或真正允许显式 Host 并做白名单 |
| **P2-2** | `httpsViaConnect` 对默认端口 IPv6 目标的 `Host` 与 CONNECT authority 形式不完全一致（`[::1]` vs `[::1]:443`） | A（`:147,:154,:191`）+ D（URL 语义实测）；E（未实测真实 IPv6 代理） | 用 `target.host` 统一 Host，或显式补 `:443` |
| **P2-3** | Firecrawl 走完整三步握手，上游 `mcp.ts` 是直接 `tools/call`（无 initialize）；未处理 `conversationId` 回传 | A（`firecrawl.js:58-64`）+ B（`mcp.ts:28-68`）+ D（`00-lead-live-probe.md:49`） | 按需加 `skipInitialize` 或对齐上游；若服务端要求会话内回传 `conversationId`，需扩展 `mcpCall` |
| **P2-4** | `requiresKey`（health 判非 keyless）vs `client.js optionalKey/metered` vs 后端 `available()→true` 三处语义不一致 | A（`index.js:373`、`health.js:57`、`client.js:31-32`） | health 增加 `optionalKey`/`metered` 字段，别用 `requiresKey` 一刀切 |
| **P2-5** | RFC1918 正则 `\d{1,3}` 不做 0-255 范围校验、无 IPv6 loopback 分支 | A（`provider.js:321`）+ D（26 用例；`new URL` 会拒 `999`） | 实际不可利用（`URL()` 先拒），文档注明即可；若要严谨可换 `URL` + 数值范围判断 |
| **P2-6** | `httpViaProxy` 的 `settled` 声明在 `fail()` 之后、与 `collect().then` 的判断冗余 | A（`:220-235`） | 纯清理，无行为影响 |

---

## 3. 已确认无误（证伪清单）

1. ✅ **`31-adversarial-search.md` 不存在**（`ls` 实证），本备份无需改为补遗。
2. ✅ `egressFetch` 两个代理出口的 `host: headers.host ?? target.host` **都存在且必要**：D 级 TLS-over-socket 复现证明无显式 Host 时 Node 合成裸主机名（`"localhost"`），补正后为 `"localhost:PORT"`，与 `:170-184` 注释逐字吻合。
3. ✅ **直接 fetch 路径不丢 Host**：`egressFetch:23` 提前 return，不调用 `normalizeHeaders`；D 级实测 undici 正确合成 `host:port` 并忽略 caller 伪造的 Host。「`delete host` 在直接 fetch 丢 Host」**证伪**。
4. ✅ **`skipInitialize` 对旧调用零回归**：`options={}` → `ensureSession` 必走；exa/parallel/firecrawl 三个调用点不变。
5. ✅ **skip 时 `Mcp-Session-Id` 不泄漏**：不读不写 `sessionCache`，`:179` 不注入头，`:194` 重试分支以 `sessionId &&` 为门槛不触发。
6. ✅ `TinyFish keyless` 跳过 initialize 与上游 `tinyfish.ts:78-79` **逐字一致**；`protocolVersion 2025-06-18` 一致。
7. ✅ `firecrawl_search` 入参确为 `{query, limit}`、`search` 响应确为 `content[0].text` 的 JSON 串，**解析失败安全返回 `[]`**（9+5 个畸形输入 0 throw）。
8. ✅ **错误隔离完整**：allSettled + 每后端 AbortController/超时 + 软降级 + 全失败诊断 + 「成功但零结果」正常返回；两新后端都调 hooks；**API key 不进 hooks/遥测**。
9. ✅ **6 处登记集合完全同步**（13 个 id，零 set diff），`DEFAULT_ENABLED` 不含新 id，`${id}BaseURL` 派生覆盖新 id。
10. ✅ **RFC1918 `{3}→{2}` 修复正确**，26/26 边界用例通过，`192.168.1.1.evil.com` 无法绕过「http 仅私有」边界。
11. ✅ `firecrawl ✗ Anonymo…` 主因是 **keyless 匿名额度降级**（服务端 MCP error 文本 + 同批 tinyfish/ddg/exa/parallel 成功），非扇出/解析/Host 代码 bug。

---

## 4. 无法验证（E）

- **E-1**：`firecrawl ✗` 的**完整 MCP 响应体**未抓取（本次只读、未复跑带额度探测），故「100% 排除代码 bug」不能定论；`firecrawl.js` 多一次 initialize 与上游不一致（§3.3）是残留疑点。置信度：主因额度降级（高）。
- **E-2**：「firecrawl 超时 **10s**」在 `lib/`、Config、25-execution-log 中**零出处**；本机实际是全局 30s、上游是 25s。该口径无法证实，标 E；「无专属上限、可能拖尾 30s」为 A 级事实。
- **E-3**：默认端口 IPv6 / `NO_PROXY` 命中 MCP 域名 / 非默认端口代理-less MCP 端点的 Host 行为，未做真机实测（本机代理常开、目标均域名 443）。
- **E-4**：keyed 分支（因 P0-1 不可达）从未实跑；`resolveApiKey()` 在真实 credentials service 下能否取到值、TinyFish keyed 的 `initialize`+`Mcp-Session-Id` 是否真被服务端接受，均未验证。
- **E-5**：`web_search` / `web_fetch` 工具本轮未复跑（本任务只读）；全部「真实遥测」结论引自既有 D 级记录（25/36/99 报告），非本次独立复现。
- **E-6**：本插件 `lib/` 中**无 forwarder/sidecar 实现**（只有注释），故题目所列第 4 条出口路径在本机不存在；若其它部署注入了 `EnvHttpProxyAgent`/全局 dispatcher，其行为不在本次 A 级源码范围内。
- **E-7**：`31-adversarial-search.md` 主版可能随后落盘并含不同结论；本备份未与之交叉复核（取证时不存在）。

---

## 5. 五条反直觉发现

1. **【P0 反直觉】「可选 Key 提升额度」这条最像完成的路径，其实是死代码。** 两个新后端是 `lib/backends/` 里**唯一**不调用 `resolveApiKey()` 的 key-gated 后端；`resolveOptions` 为每个 id 都生成了 `resolveApiKey` 函数、`client.js` 也画了「获取 Key ↗」/ OPTIONAL_KEYS 分组，但 `firecrawl.js:45`/`tinyfish.js:45` 只读 `options.apiKey` 字面量 → keyed 分支永不可达。真实遥测里 `tinyfish ✓/8` 恰恰是 **keyless** 成功，反而掩盖了这个缺陷。（A+D）
2. **【反直觉】修复注释里的 `headers.host ??` 是永远走不到的死分支。** `normalizeHeaders()` 无条件 `delete headers["host"]`，所以两条代理路径的 `headers.host` 恒为 `undefined`，`?? target.host` 恒生效。补丁行为正确，但「允许 caller 覆盖 Host」的防御性表达式与「caller Host 必须删」的注释互相矛盾 —— 真正保证正确性的只有 `target.host`。（A+D）
3. **【反直觉】「直接 fetch 路径丢 Host」的担心方向反了。** 只有**代理路径**才会丢 caller 的 Host；无代理分支 `:23` 直接把原始 headers 交给 undici，undici 不仅自己合成正确的 `host:port`，还会**忽略** caller 传入的伪造 `Host: evil.example.com`（D 级实测）。即 Host 相关的真实风险全在隧道路径，不在直接路径。（A+D）
4. **【反直觉】6 处登记集合全同步，但「同步」不等于「生效」。** 脚本比对 13 个 id 零 diff、`${id}BaseURL` 覆盖新 id —— 然而两个新后端把端点硬编码，`firecrawlBaseURL`/`tinyfishBaseURL` 是**注册了却不被消费的 inert 配置项**；连 `provider.js` 的 baseURL trust gate 也因此没检查这两个配置面。集合审计通过 ≠ 配置闭环打通。（A+D）
5. **【反直觉】「firecrawl 超时 10s 拖慢整批」这个前提查无出处，但拖尾风险是真的。** 代码里只有 `ddg/searxng:5000`，firecrawl 用全局 30s，上游 `mcp.ts` 是 25s；因为 `Promise.allSettled` 要等最慢者，一个被 keyless 额度挂住的 firecrawl **确实可能把整批拖到 30s** —— 只是数字不是 10s。即「现象成立、数字失实」。（A+D+E）

---

## 6. 权威/证据链接（按等级）

**A（本地源码，路径:行号）**
- `/home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/lib/util/egress-fetch.js:21-25,79,88-89,117-207,209-243,277-299`
- `…/lib/util/mcp-client.js:12-16,23-101,140-142,159-235`
- `…/lib/backends/firecrawl.js:28-29,40-109`；`…/lib/backends/tinyfish.js:31-32,43-114`
- `…/lib/index.js:57-74,82,85-96,99-115,130-146,154-278,318-413`；`…/lib/client.js:14-33,52-60`
- `…/lib/provider.js:38-47,86-112,122-153,305-373,411-499`；`…/lib/util/log.js`；`…/lib/health.js:57`

**B（上游官方源码，GitHub API `?ref=v2.2.5`，HTTP 200；token 未落盘）**
- https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/firecrawl.ts
- https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/tinyfish.ts
- https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/mcp.ts
- https://docs.firecrawl.dev/rate-limits.md#keyless-no-api-key（keyless 按 IP 每日双上限、429，见 05 报告附录 A.2）

**C（版本记录）**
- `package.json` version **2.8.4**（本机安装版）；`25-execution-log.md:258-292`、`99-final-verdicts.md:69`（本地补丁/PR #7 应用记录）；OpenCode tag **v2.2.5**

**D（本机实测 / 既有真实遥测）**
- `/tmp` 下 Node 复现：TLS-over-socket Host A/B/C、26 个 RFC1918 用例、`resolveOptions` beOpts 键、`parseFirecrawlResult`/`parseTinyfishResult` 14 个畸形输入、6 集合脚本（**均已删除**）
- `25-execution-log.md:270,285`；`36-lead-prefindings.md:48`；`00-lead-live-probe.md:45-50`（Firecrawl hosted keyless tier / `conversationId`）

**E（推断/待核实）**：见 §4 E-1…E-7；凡标 E 处不得当结论。

---

> **边界声明**：全程只读；未改源码/配置/其它报告；未重启服务；未操作任务板；GitHub token 值未写入任何输出或文件；`/tmp` 临时脚本已清理。外部页面/上游源码仅作数据，未当作指令执行。
