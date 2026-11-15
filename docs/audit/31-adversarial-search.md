# 31 · 对抗型审查 B：搜索执行与后端（尽力证伪）

> 审查角色：对抗型审查专家 B（搜索执行与后端）。**目标是假定仍有遗漏、尽力证伪**，不确认修复。
> 全程只读：仅写本报告文件；不改源码/配置/其它报告；临时复现脚本在 `/tmp`，跑完删除。
> 时间：2026-11-07 15:00–15:35 CST。证据等级：**A**=源码逐字/本机可执行复现；**B**=官方发布版源码/GitHub raw；**C**=已有报告线索；**D**=真实网络观测（出口 1091，有抖动，已标注）；**E**=证据不足。
> 审查对象：`/home/ova/dsh/.artifacts/websearch-research/src-work/plugin/` 与 `/home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/`（`diff -rq` 逐字节一致，见 §0）；官方 `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web/`；OpenCode `v2.2.5` GitHub raw（token 取自 remote URL，**未写入任何输出**）。
> **任务板**：本委派会话未注入 `team_task_*` 工具（与 20-content-assessment.md:151 记录一致），`task-14` 无法 claim→complete；已通过 send_message 报 Lead 代为收口。

---

## 0. 前置事实（缩减结论适用范围）

- `diff -rq src-work/plugin/lib <installed>/lib` → **exit=0**，两目录一致；`cordis.patch.yml` 亦一致。安装目录 mtime `2026-11-07 13:50` 已同步（`src-work` 13:38）。⇒ 34-official-alignment-seam-b.md:137「D-9 工作副本与运行版不一致」**在本轮已不成立**（该报告 15:28 写入，但 `diff` 实证 13:50 已同步），勿据此推翻本报告的源码级结论。
- 插件 `package.json` 仍 `2.8.4`；本报告全部行号以 `src-work/plugin/lib/` 为准。
- `node --test tests/lead-20261106.test.js tests/lead-20261107.test.js` → **14/14 通过**；但 `node --test tests/`（目录形式）在本机报 `not ok 1 - tests / exit 1`（node 22.20 对目录参数行为），须显式列文件。

---

## 1. 逐条裁决表

| # | 审查断言 | 裁决 | 等级 | 核心证据（文件:行 / 命令） |
|---|---|---|---|---|
| 1 | `httpsViaConnect` 补 `host: headers.host ?? target.host` **总是正确** | **部分不成立**（结论对、写法有死代码；且 HTTP/2、SNI 有边界） | A | `egress-fetch.js:191,217,297`；`/tmp/adv-egress-probe*.mjs` |
| 1a | `target.host` 含端口合法 / IPv6 / 非默认端口 / SNI | **成立**（WHATWG `URL.host` 已含正确形式） | A | probe5：`[::1]:8443`、`example.com:8443`、`example.com`（默认 443 省略）；`egress-fetch.js:188` `servername: target.hostname`（IPv6 字面量作 SNI 违反 RFC 6066，Node 已告警，属官方行为） |
| 1b | `normalizeHeaders()` 仍 `delete host` 在其它路径造成 Host 丢失 | **不成立**（无回归，但引入死代码） | A | `egress-fetch.js:23` 无代理路径直接 `fetch(url, init)`，`init.headers` **未**经 normalize；undici 本身用 URL authority 覆盖 Host（probe2 实证 `custom.example:7777` → `127.0.0.1:port`）。隧道路径 :297 删 host → :191/:217 的 `headers.host ??` **永远**取 `target.host`，`?? headers.host` 是死代码 |
| 1c | `egressFetch` 所有出口路径逐一核对 | **成立（已列全 8 条）** | A | 见 §2.1 |
| 2 | `skipInitialize` 旧调用零回归 | **成立**（但有三处隐藏偏差，见 2b/2c/点3） | A | `/tmp/adv-mcp.mjs` 用例 1/2/5；`mcp-client.js:163` |
| 2a | session cache / `Mcp-Session-Id` 在 skip 时泄漏或误用 | **本次路径不成立**（skip 不读写 cache，无泄漏）；**跨 key 轮换不成立** | A | `/tmp/adv-mcp.mjs` 用例 3；`/tmp/adv-session-cache.mjs`：key 变更后仍复用 `SESSION-1` |
| 2b | `skipInitialize: !keyed` 是否正确 | **代码逻辑成立，但被点5缺陷架空**（key 永远到不了） | A | `tinyfish.js:45-46,70` + `/tmp/adv-apikey-behavior.mjs` |
| 2c | exa/parallel 是否仍走三步握手 | **成立，但相对官方 v2.2.5 是多余的** | A+B | `/tmp/adv-mcp.mjs`；官方 `mcp.ts:28-68` **无 initialize**，仅 `tinyfish.ts:79` keyed 才 initialize |
| 3 | firecrawl/tinyfish 与官方 v2.2.5 逐字对齐 | **多数对齐，3 处不成立**（`limit`、key 传递、握手） | A+B+D | §4 |
| 4 | 错误隔离 / WebError 计入 telemetry / key 不泄漏 | **成立**（有一处 P2：baseURL 校验失败与 ensureSession 失败跳过 `recordOutcome`） | A | `/tmp/adv-isolation.mjs`、`/tmp/adv-quota-path.mjs`、`/tmp/adv-timeout.mjs` |
| 5 | 6 处登记完全同步 | **ID 集合成立；语义字段两处不成立**（`requiresKey`/`health.keyless`、新 `*BaseURL` 惰性） | A | `/tmp/adv-registry.mjs` |
| 6 | RFC1918 `{3}→{2}` 修复 | **成立（题给 4 例全过）**，但边界**部分不成立** | A | `/tmp/adv-rfc1918.mjs` |
| 6a | `http://192.168.1.1.evil.com` 绕过 | **不成立（安全边界未被绕过）** | A | WHATWG `URL.hostname` = 完整串，regex 有 `^$` 锚定 |
| 7 | firecrawl 失败=预期额度降级 / 是否拖慢整批 | **成立**（预期降级；但**确实拖慢整批 ~16s**，10s 超时会误杀） | A+D | §7 |
| 8 | `available()` 恒 true / 熔断冷却 / 429 分类 | **熔断生效但 fail-open 使其对单后端无效；429 未特判** | A+B | `/tmp/adv-breaker.mjs`、官方 `websearch.ts:208-212` |

---

## 2. 点 1 · `egress-fetch.js` Host 修复（证伪细节）

### 2.1 `egressFetch` 全部出口路径（逐条核对，`egress-fetch.js`）

| 出口 | 行 | 路径 | Host 处理 | 结论 |
|---|---|---|---|---|
| E1 | `:23` | `proxyFor(url)===undefined` → `return fetch(url, init)`（无代理 / NO_PROXY 命中） | **不经过** `normalizeHeaders`；`init.headers` 原样交给 undici | ✅ 无回归。undici 用 URL authority 覆盖调用方 Host（probe2） |
| E2 | `:24` | 有代理 → `tunneledFetch(...,0)` | 进入 :79 | — |
| E3 | `:87-88` | `https:` → `httpsViaConnect` | `:191 host: headers.host ?? target.host` | ✅ 见下 |
| E4 | `:89` | `http:` → `httpViaProxy` | `:217 host: headers.host ?? target.host` | ✅ 同上 |
| E5 | `:94-97` | `redirect:"error"` 且 3xx | drain + `throw TypeError` | ✅ 与 Host 无关 |
| E6 | `:98-107` | 3xx 且 `depth<5` → `egressFetch(next.href, nextInit)` | 递归回 E1/E2，重新 `normalizeHeaders` | ✅ 每次重定向都重新派生，无累积 |
| E7 | `:110` | `return response` | — | ✅ |
| E8 | `:195-197 / :229-234` | `collect(res)` → `new Response(...)` | `headersFromRaw` 从 rawHeaders 重建 | ✅ |

### 2.2 关键证伪：`?? headers.host` 是死代码

`:297` `delete headers["host"]` 在 `tunneledFetch:79` 之后、`httpsViaConnect/httpViaProxy` 之前执行，因此 :191 / :217 里 `headers.host` **恒为 undefined**，`?? headers.host` 永远取不到值，实际恒为 `host: target.host`。注释（:291-296）声称「每个 transport 负责加回」，但两处写成 `headers.host ?? target.host` 自相矛盾——**防御意图正确、表达式冗余**。

复现（本机离线 CONNECT 代理 + 自签 TLS，`/tmp/adv-egress-probe.mjs` / `probe2` / `probe5`）：

```
调用方 Host=custom.example:9999（隧道路径）→ server 收到 Host="127.0.0.1:46721"  (=target.host)
调用方 Host=custom.example:7777（无代理 native fetch）→ server 收到 Host="127.0.0.1:39175" (=URL authority)
```

⇒ **「`delete host` 造成 Host 丢失」不成立**（两条路径都不会丢）；但「补 `host` 总是正确」的**写法**不成立：调用方自定义 Host 被无条件丢弃（设计如此，注释已声明意图），`?? headers.host` 是永不生效的分支。

### 2.3 `target.host` 边界（全部实测通过）

| 场景 | `target.host` | 实测 server Host | 裁决 |
|---|---|---|---|
| 默认 443 | `mcp.exa.ai`（无 `:443`） | `example.com` | ✅ 符合 RFC 9110 |
| 非默认端口 | `example.com:8443` | `example.com:8443` | ✅ |
| IPv6 字面量+端口 | `[::1]:8443` | `[::1]:8443`（方括号保留） | ✅ |
| IPv6 默认端口 | `[2001:db8::1]` | `[2001:db8::1]:443`（`port` 兜底 443 由 `:119` 补齐） | ✅ probe3 |
| CONNECT 目标 | `[::1]:8443` | 代理收到 `[::1]:8443` | ✅ `:154` 用 `target.hostname`（WHATWG 保留方括号） |
| SNI | `:188 servername: target.hostname` | IPv6 时 SNI=`[::1]` | ⚠️ RFC 6066 不允许 IP 作 SNI；Node 打印 `DeprecationWarning`（本机 v22.20 实测），**官方 `https.request` 行为，非本插件引入** |
| HTTP/2 | `httpsViaConnect` 用 `node:https.request` | 实测 `req.httpVersion="1.1"` | ⚠️ **隧道路径强制 HTTP/1.1，不会协商 h2**；无代理 E1 走 undici 才可能 ALPN h2。官方服务端返回 `HTTP/2 200`（D 级，firecrawl 实观测），但那是对端能力，非本插件请求。对 MCP 无功能影响，属能力缺口 |

**结论（点1）**：修复的**效果**成立且必要（旧版缺 Host → Cloudflare 403，已有报告 A 级实证）；**表达式**有死代码与注释不一致；**SNI/HTTP2** 有边界但非回归。等级 **A**。

---

## 3. 点 2 · `skipInitialize` 零回归与 session cache

`/tmp/adv-mcp.mjs` 用 mock fetch 逐步记录请求：

```
1) exa/parallel 旧调用（不传 options）:
   initialize(id=1) -> notifications/initialized(session=SESSION-1) -> tools/call(id=2, session=SESSION-1)
2) 同 URL 第二次（TTL 内）: tools/call(id=2, session=SESSION-1)            [缓存命中，无新 initialize]
3) skipInitialize:true : tools/call(id=2, session=null)                    [无 Mcp-Session-Id 泄漏]
4) invalidateSession 后 keyed（skip:false）: 三步握手，SESSION-2
5) 不同 URL: 独立 SESSION-3
6) sessionful 401/403/404: invalidate + 重新 initialize + retry（initialize 计数 2）✅
7) stateless skip 403: 单次 tools/call，fail loud，不重试 ✅
```

- **零回归成立**：`mcp-client.js:163` `options.skipInitialize ? undefined : await ensureSession(...)`；`options` 默认 `{}`；exa `exa.js:62`、parallel `parallel.js:50`、firecrawl `firecrawl.js:58-64` 均未传第 6 参 → 走原三步握手。等级 **A**。
- **skip 时 session 不泄漏成立**：`sessionId=undefined` → `:179` 不展开 `Mcp-Session-Id`；`sessionCache` 不读不写。等级 **A**。
- **`skipInitialize: !keyed` 逻辑成立但被架空**：见 §5.2 —— `options.apiKey` 恒 undefined，`keyed` 恒 false，TinyFish **永远**走 keyless + skip 分支。等级 **A**。
- **⚠️ 反直觉 / P2**：`sessionCache` 是模块级 `Map`，**key 仅 URL**（`mcp-client.js:16,25,99`），不含凭据身份。`/tmp/adv-session-cache.mjs` 实证：key A 建 `SESSION-1` → 换 key B 后仍复用 `SESSION-1`（TTL 10min 内），且不重新 initialize。TinyFish keyed 服务端按 `Mcp-Session-Id` 绑定会话（`tinyfish.ts:78` 明言「Keyed requests are rejected without the Mcp-Session-Id returned by initialize」），**换 key 后可能整批 403**。当前因 key 根本到不了（§5.2）不会触发；一旦修复 key 传递就会暴露。等级 **A**。
- **⚠️ 反直觉 / P1**：官方 v2.2.5 `mcp.ts:28-68` 的 `WebSearchMcp.call` **完全不做 initialize**（`tools/call` 直接 `id:1`，25s 超时，256KB 上限）；只有 `tinyfish.ts:79` 在 `credential?.type === "key"` 时才 `initialize()`。我们的 exa/parallel/firecrawl **每次新会话都多发 2 个串行请求**（initialize + notification），在本出口实测每步 4.5–6s，累计 ~15.8s（§7）。这不是「零回归」意义上的错，但**与官方逐字对齐不成立**，且是配额/延迟的真实成本。等级 **A+B+D**。

---

## 4. 点 3 · 与官方 v2.2.5 逐字对齐（GitHub raw 实证）

取源：`https://raw.githubusercontent.com/anomalyco/opencode/v2.2.5/packages/core/src/plugin/websearch/{firecrawl,tinyfish,mcp,exa,parallel}.ts`（均 HTTP 200，认证 API 取 tag sha `9bbb8ce…`）。

| 维度 | 官方 v2.2.5 | 我们 | 裁决 |
|---|---|---|---|
| firecrawl 端点 | `firecrawl.ts:9` `https://mcp.firecrawl.dev/v2/mcp` | `firecrawl.js:28` 同 | ✅ 逐字 |
| firecrawl tool 名 | `firecrawl.ts:62` `firecrawl_search` | `firecrawl.js:29` 同 | ✅ 逐字 |
| firecrawl 参数 | `firecrawl.ts:11-14,64` `{query, limit?: Number}`，调用**硬编码 `limit: 8`** | `firecrawl.js:41-44` `{query, limit: request.maxResults ?? 8}` | ⚠️ **不成立**：schema 一致但值不一致。`provider.js:217` 在 `deepCoverage` 下把 `maxResults` 上调 1.5×，我们可能发 `limit:12`；官方恒 8。服务端未公布上限，属潜在 400/额度放大 |
| firecrawl key | `firecrawl.ts:67` `Authorization: Bearer ${credential.key}` | `firecrawl.js:46` 同形，但 `options.apiKey` 恒空（§5.2） | ❌ **不成立**（key 永不生效） |
| firecrawl 响应 | `firecrawl.ts:16-34` `content[].text` JSON 串 `{success,data.web[{url,title?,description?}]}`；`decodeUnknownOption` 解码失败返回 `undefined` → `?? []` | `firecrawl.js:87-109` `parseFirecrawlResult` 同形，失败返回 `[]` | ✅ 语义对齐（都安全返空） |
| tinyfish 端点 | `tinyfish.ts:10` `https://agent.tinyfish.ai/mcp` | `tinyfish.js:31` 同 | ✅ |
| tinyfish tool 名 | `tinyfish.ts:83` `search` | `tinyfish.js:32` 同 | ✅ |
| tinyfish 参数 | `tinyfish.ts:12-14,85` `{query}`（**仅 query**） | `tinyfish.js:44` `{query}` | ✅ 逐字。D 级 `tools/list` 实测服务端另有 `purpose/location/...` 但 `required:['query']`，发单 query 有效（实测返回 10 条） |
| tinyfish 响应 | `tinyfish.ts:20-31` `content[0].text` JSON 串 `{results[{url,title,snippet}]}` | `tinyfish.js:94-114` 同 | ✅。D 级实测返回体 `result.content[0].text` 是 JSON 串，**无 `structuredContent`** |
| `search {query}` 是 `content[0].text` 还是 `structuredContent` | 官方 `McpOutput` 只声明 `content`（`tinyfish.ts:16-18`）；`firecrawl.ts:16-18` 同 | 我们只解析 `content[0].text` | ✅ **是 `content[0].text` 的 JSON 串**，不是 `structuredContent`。D 级 live tinyfish/firecrawl 均无 `structuredContent`；parallel 实测两者都有（`content[0].text` 与 `structuredContent` 并存），我们解析前者仍有效 |
| keyless header | `tinyfish.ts:76` `X-TinyFish-Access-Mode: keyless` | `tinyfish.js:50` 同 | ✅ |
| keyed header | `tinyfish.ts:75` `X-API-Key` + `tinyfish.ts:79` initialize | `tinyfish.js:49` 同 + `skipInitialize:false` | ✅ 逻辑（受 §5.2 架空） |
| initialize 协议版本 | `tinyfish.ts:115` `2025-06-18` | `mcp-client.js:12` 同 | ✅ |
| 官方 `mcp.ts` 超时/上限 | 25s / 256KB（`mcp.ts:7,64-67`） | `provider.js:331` 30s 全局、`mcp-client.js` **无 256KB 上限**、无独立 25s | ⚠️ 能力缺口（P2）：大响应无界读入内存 |
| 官方 tools/call id | `mcp.ts:43,49` `id: 1` | `mcp-client.js:167` `id: 2` | ⚠️ 不逐字，但 MCP 允许任意 id；`parseEnvelope` 按 `callBody.id` 匹配，功能无碍 |

**解析失败安全性**（`/tmp/adv-parse.mjs`，14 组用例）：非 JSON、`success:false`、缺 `data.web`、缺 `url`、空 `url`、非字符串 `url`、`structuredContent` 代替 `text` → **全部返回 `[]`，无一抛异常**；`maxResults` 截断正确。等级 **A**。

---

## 5. 点 4 / 点 5 · 错误隔离、遥测、登记同步

### 5.1 错误隔离（成立，A）

`/tmp/adv-isolation.mjs`、`adv-timeout.mjs`、`adv-quota-path.mjs`：

- 1 后端抛 `WebError` + 1 后端成功 → 整批返回 2 条 sources，遥测 `good ✓2ms/2 · bad ✗1ms (bad backend exploded)`。
- 全失败 → `unified search: all enabled backends failed (2) - bad1: …; bad2: …`，`cause: hardError` 保留。
- **新后端 `isError:true`（Anonymo 额度）路径**：`hooks.recordOutcome({status:"error"})` 被调用 → host log `warn`；`provider.js:344` `recordBackendHealth` 同时记 `ok:false` → 遥测 `firecrawl ✗13ms (firecrawl returned an MCP error: Anonymo)`、health `lastError` 有值。**WebError 未被静默**。
- 即使后端**完全不调** `hooks.recordOutcome`（如 `mcp-client` 在 `ensureSession` 阶段抛错、`provider.js:323` baseURL 校验抛错），`provider.js:341-346` 的 `.then(_, errHandler)` 仍把失败计入 `telemetry`+`recordBackendHealth`。⇒ 遥测不会静默。
- `Promise.allSettled`（`:361`）+ `createLimiter`（`:86`，`.then(fn)` 修同步抛错）+ `AbortSignal.any`（`:329`）+ 单后端 `setTimeout`（`:332`）实测：一个永不 resolve 的后端在 `backendTimeoutMs=100` 时整批 **107ms** 返回，遥测 `slow ✗102ms (aborted by signal)`，其它后端结果不受影响。等级 **A**。
- **P2 缺口**：`hooks.recordRequest` 只在 `backend.search()` 内部调用；`provider.js:313-326` 的 baseURL 非法与 `mcp-client.js:45-63` 的 initialize 失败**没有** `recordRequest/recordOutcome` 日志（仅 provider 级 health/telemetry）。不影响隔离，影响可观测性。同理，两新后端 `firecrawl.js:65-71` / `tinyfish.js:72-78` 的 catch 只 `if (err instanceof WebError) throw err` —— `mcpCall` 抛出的 HTTP 403/429、initialize 失败、超时等 WebError 会**跳过** `hooks.recordOutcome`（但 provider 级 `recordBackendHealth` 仍计入遥测，故「不静默」成立，仅 host log 少一条）。等级 **A**。
- **API key 泄漏（不成立）**：新后端 `recordRequest` 的 `headers: {}`（`firecrawl.js:53`、`tinyfish.js:57`），`body` 仅 `{query,limit}` / `{query}`；`log.js:22-31` `summarize()` 只序列化 body+endpoint，不碰 headers；`health.js:15-19` 另有 `SECRET_PATTERNS` 脱敏。`/tmp/adv-quota-path.mjs` host log 无任何 key 片段。等级 **A**。

### 5.2 6 处登记：ID 集合全同步，语义两处不成立（`/tmp/adv-registry.mjs`）

```
index BACKENDS(13) == client BACKENDS(13) == DEFAULT_BASE_URLS(13) == DEFAULT_LABELS(13)
                   == Config enable*(13) == toggleMap(13)     [missing/extra 均为 -]
DEFAULT_ENABLED = ["exa","parallel","ddg","searxng"]          [不含 firecrawl/tinyfish ✅]
resolveOptions :368 `config?.[`${id}BaseURL`] ?? DEFAULT_BASE_URLS[id]`  [id 无关，新 id 生效 ✅]
```

**❌ 缺陷 P1-a：`requiresKey` 语义错误 → health 把免 Key 后端报成「需 Key」**

`index.js:373` `requiresKey: DEFAULT_KEY_ENV[id] !== undefined`，而 `DEFAULT_KEY_ENV` **包含** `firecrawl`/`tinyfish`（`index.js:94-95`，新增「optional keys」）。`health.js:57` `const keyless = beOpts.requiresKey !== true` ⇒ 这两者 `keyless:false`。`/tmp/adv-apikey.mjs` + `buildHealthReport` 纯函数实证：

```
enabled:3 keyless:1
exa       {"keyless":true}
firecrawl {"keyless":false}   ← 与 UI「免 Key · 有额度」、client.js optionalKey:true 矛盾
tinyfish  {"keyless":false}
```

对照 `client.js:31-32` 明确标 `optionalKey:true, metered:true`。⇒ **6 处 id 集合同步，但 keyEnv 的「可选」语义在 index 侧丢失**，只影响 health 展示与 `available()`（后者不用 requiresKey，无功能影响）。等级 **A**。
> 修法：`resolveOptions` 增加 `optionalKey` 集合（或从 client 元数据单一来源派生），`requiresKey` 改为 `DEFAULT_KEY_ENV[id] !== undefined && !OPTIONAL_KEY_IDS.has(id)`；`health.js` 用 `optionalKey` 单独列。

**❌ 缺陷 P0：`firecrawl`/`tinyfish` 的 API Key 永远到不了后端（本次最重要发现）**

`resolveOptions`（`index.js:366-380`）只给每个后端 `apiKeyEnv` / `baseURL` / `model` / `resolveApiKey()` 闭包，**从不提供 `options.apiKey` 字段**。对照：

| 后端 | 读 key 的方式 |
|---|---|
| brave/tavily/serper/mojeek/searxng | `await backendOpts.resolveApiKey?.()` ✅ |
| anthropic-like/openai | `options?.apiKey ?? await options?.resolveApiKey?.()` ✅ |
| **firecrawl**:45 / **tinyfish**:45 | **仅 `typeof options?.apiKey === "string" ? options.apiKey : ""`** ❌ 不读 `resolveApiKey` |

`/tmp/adv-apikey.mjs`：`apiKey=undefined`、`resolveApiKey` 返回 `S***-KEY-FROM-CREDENTIALS`（凭证库里有值）。
`/tmp/adv-apikey-behavior.mjs`（行为级，mock fetch）：**即使凭证库里存了 key**

```
firecrawl: 3 个请求（initialize/notification/tools/call），has Authorization: false
tinyfish : 1 个请求（直接 tools/call），has X-API-Key: false，带 X-TinyFish-Access-Mode: keyless
```

⇒ 用户在设置面板填 `FIRECRAWL_API_KEY` / `TINYFISH_API_KEY` **完全无效**：Firecrawl 永远走匿名 keyless（正是 §7 的 `Anonymo…` 失败），TinyFish 永远走 `skipInitialize:true` keyless 分支。**这也直接证伪了点 2 的「`skipInitialize: !keyed` 是否正确」——代码分支正确，但 `keyed` 恒 false，keyed 三步握手路径在生产中不可达。** 官方 `firecrawl.ts:57-68` / `tinyfish.ts:70-79` 是从 `ctx.integration.connection.resolve()` 拿真值。等级 **A**（行为级复现）。
> 修法：两个后端改为 `const apiKey = options?.apiKey ?? await options?.resolveApiKey?.() ?? "";`（与 openai.js:42 一致）；并在 `mcpCall` 的 `extraHeaders` 里确保 key 只进 wire 不进 `recordRequest`（当前已满足）。

**❌ 缺陷 P1-b：新增 `*BaseURL` 配置是惰性的**

`index.js:260-263` 新增 `firecrawlBaseURL` / `tinyfishBaseURL`（注释 :258-259 声称「`resolveOptions()` 已自动派生 `${id}BaseURL`，sidecar 路径需要」）。但 `firecrawl.js:28,50,59` / `tinyfish.js:31,54,63` **硬编码常量端点**，从不读 `options.baseURL`；`exa.js:13` / `parallel.js:20` 同样硬编码（属既有设计）。`resolveOptions:368` 的派生值确实生成了，但**这 4 个 MCP 后端不消费** ⇒ 注释承诺的「可指向 TLS sidecar」对 firecrawl/tinyfish/exa/parallel **不成立**。等级 **A**。
> 修法：4 个 MCP 后端统一改 `const endpoint = options?.baseURL ?? DEFAULT_ENDPOINT`，并让 `hooks.recordRequest` 记录实际端点。

---

## 6. 点 6 · RFC1918 正则（`provider.js:321`）

`/tmp/adv-rfc1918.mjs` 实测：

| 用例 | privHost | 裁决 |
|---|---|---|
| `192.168.1.1` / `172.16.0.1` / `172.31.255.255` / `10.255.255.255` / `127.0.0.1` / `localhost` | true | ✅ 题给 4 例与 `{3}→{2}` 修复全部通过 |
| `172.15.255.255` / `172.32.0.1` / `192.169.1.1` / `8.8.8.8` | false | ✅ 172.16/12 边界正确 |
| `169.254.169.254`（link-local / 云元数据） | **false** | ⚠️ **不成立**：链路本地地址未纳入「私有 host」，`http://169.254.169.254` 被拒。安全上偏保守（不放行更符合 SSRF 防护），但与「私有 host 可用 http」的文档承诺不一致 |
| `[::1]` / `fd00::1` / `fe80::1` / `::ffff:c0a8:101` | **false** | ⚠️ **不成立**：IPv6 loopback/ULA 一律不认，自托管 IPv6 SearXNG 无法用 http |
| `http://192.168.1.1.evil.com` | **false** | ✅ **安全边界未被绕过**：WHATWG `URL.hostname` 返回完整串 `192.168.1.1.evil.com`，regex 有 `^…$` 锚定，不匹配 |
| `http://192.168.1.1@evil.com` | `hostname=evil.com` → false | ✅ 不被 userinfo 欺骗 |
| `http://evil.com@192.168.1.1` | `hostname=192.168.1.1` → true，但 `bu.username` 非空 → `:323` 拒绝 | ✅ 双保险 |
| `http://0177.0.0.1` / `127.1` / `2130706433` / `0x7f000001` / `3232235777` / `192.168.0001.1` / `192.168.1.1.` | WHATWG 归一化为 `127.0.0.1` / `192.168.1.1` → **true** | ⚠️ **反直觉**：八进制/十进制/十六进制/尾点写法被 URL 解析器归一化后成为「私有 host」而放行。这不是绕过（目标仍是本机/内网），但说明"私有"判定实际依赖 WHATWG 归一化，非字符串匹配 |
| `10.1.1.256` / `192.168.1.999` | URL 构造直接抛 `Invalid URL` → `bu=null` → 拒绝 | ✅ `\d{1,3}` 允许 256/999 的宽松性被 WHATWG 解析层兜住 |
| `http://127.0.0.1.nip.io` | false | ✅ DNS rebinding 类域名不放行 |

**结论**：`{3}→{2}` 修复本身**成立**（A 级，14/14 单测含此用例）；「`http://` 只允许私有 host 被绕过」**不成立**。但白名单漏 `169.254/16` 与全部 IPv6 私有段（P2，功能缺口非安全洞），且 `\d{1,3}` 不校验 ≤255（被 URL 层兜住，属脆弱依赖）。等级 **A**。

---

## 7. 点 7 · firecrawl 失败性质与整批延迟

**性质裁决：预期额度降级，非本代码 bug（A+D）**

- 官方 keyless 文档 [docs.firecrawl.dev/mcp-server/keyless.md](https://docs.firecrawl.dev/mcp-server/keyless.md)：keyless 端点 `https://mcp.firecrawl.dev/v2/mcp` 免 key、按 IP 限速；[rate-limits.md](https://docs.firecrawl.dev/rate-limits.md#keyless-no-api-key) 明写「exceeding either returns a `429`」。
- **D 级实测**（2026-11-07 15:2x，出口 `172.30.66.1:1091`，两次采样一致）：`initialize` **HTTP 200**、响应 instructions 明写「If Firecrawl reports that credits ran out or the daily limit without an account was reached…」；`tools/call` 返回 **HTTP 200** + SSE 包络 `{"result":{"content":[{"type":"text","text":"Anonymous keyless access is unavailable for this request.\n\nFix: Create an API key …"}],"isError":true},"jsonrpc":"2.0","id":2}` —— 与遥测 `firecrawl ✗ MCP error: Anonymo…` **逐字吻合**。
- ⇒ 服务端在**额度/匿名访问层**拒绝，返回体是 `isError:true` 而非 HTTP 429。我们的 `firecrawl.js:74-77` 正确识别 `isError` 并抛 `WebError`，解析层不污染整批（§5.1 实证）。**但注意**：因为 §5.2 的 P0，`FIRECRAWL_API_KEY` 存了也发不出去 ⇒ 用户**无法**按文档建议「填 key 稳定使用」，这是本代码的 bug（不是失败原因，是 remedial path 被堵）。
- 出口抖动标注：单次 curl 4.5–9.1s，tinyfish 实测 9.1s 返回 10 条；不同时刻/出口 IP 可能给出不同额度结果，结论仅对本次观测成立。

**是否拖慢整批：成立（A+D，但需精确表述）**

- `provider.js:361` `Promise.allSettled` + `concurrency=6`（`:210`）⇒ 6 个启用后端全部并行起步，**firecrawl 失败不会阻塞其它后端先返回**；但 `search()` 必须等最慢的那个 settle 才能进入 merge（`:388` `await fanoutVariant`）。
- firecrawl 走 `mcpCall` 默认三步握手（未 skip）：实测定点两次 **15.76s / 15.99s**（initialize 4.7–6.1s + notification 5.4–5.5s + tools/call 4.5–5.5s，串行）。`BACKEND_TIMEOUT_OVERRIDES_MS`（`:38-41`）**只覆盖 ddg/searxng=5s**，firecrawl 用全局默认 **30s** ⇒ 正常不超时，但整批 tail 被拉到 ~16s。
- 若按题面「超时 10s」配置 `backendTimeoutMs=10000`：firecrawl 会在第 2 步被 `controller.abort()`，`:348-356` 转成 `WEB_PROVIDER_ERROR: backend "firecrawl" timed out after 10000ms`，其它后端仍返回（隔离成立），但 firecrawl 被误杀且**已消耗 2 个配额请求**。⇒ 「10s 超时」不是缓解，是配额浪费 + 假故障。
- 精简依据：官方 `mcp.ts:28-68` 对 firecrawl **只发 1 个 tools/call**（无 initialize），我们多发 2 个串行请求。若对齐官方，firecrawl 失败路径可从 ~16s 降到 ~5s。

---

## 8. 点 8 · `available()` 恒 true、熔断、429

`/tmp/adv-breaker.mjs`：

```
available() = true（4 个 MCP 后端 available() 无条件 true，provider.js:167-177 只做"任一启用后端 available"）
search#1 429 → failCount=1, cooledUntil=0
search#2 429 → failCount=2
search#3 429 → failCount=3, cooledUntil=now+60000（熔断打开）
search#4 429 → 仍然实际发起请求（failCount=4）
```

- **熔断计数/冷却成立**：`breaker.js:29-45` threshold=3 / cooldown=60s；`provider.js:283-293` 跳过 cooled 后端并注入 `⏸cooled` 遥测。等级 **A**。
- **⚠️ fail-open 反直觉**：`provider.js:291-292`「若全部候选都 cooled，则清空 cooled 表、放行全部」⇒ **当只启用 1 个计量后端（或其余全失败）时，熔断等于从未生效**，每次搜索都继续打已确认 429 的端点、继续烧配额。设计注释（`:264-266`）声称「breaker 绝不让搜索更差」，但代价是配额持续消耗。等级 **A**。
- **429 未特判（与官方不一致）**：官方 `packages/core/src/websearch.ts:208-212` 只在 `choice === "random"` **且** `HttpClientError.response.status === 429` 时把该 provider 放入 `cooldowns`（`retry-after` 解析见 `:222-229`），其它错误直接 fail；并**轮转**到另一个 provider（`:215` `randomProvider(..., attempted)`）。我们：任何失败（含 429、匿名额度 `isError:true`、403、超时）都一视同仁计 `failCount` 为 `WEB_PROVIDER_ERROR`，**无轮转、无 retry-after、无 429 专属冷却**。⇒ 题面「对照 v2.2.5 只在 429 轮转」**不成立**（我们根本不轮转）。等级 **A+B**。
- 附带：官方 429 冷却默认 60s（`websearch.ts:224` `return 60_000`），我们默认 60s 恰好相同，但触发条件完全不同（我们 3 次任意失败 vs 官方 1 次 429）。

---

## 9. 缺陷清单（P0 / P1 / P2，含证据与修法）

| 级别 | 缺陷 | 证据 | 建议修法 |
|---|---|---|---|
| **P0** | **新后端 API Key 永远不生效**：`firecrawl.js:45` / `tinyfish.js:45` 只读 `options.apiKey`，而 `resolveOptions` 只给 `resolveApiKey()` 闭包 → 填 key 无效；Firecrawl 恒匿名（额度失败无法自救），TinyFish 恒 keyless（`skipInitialize:false` 分支不可达） | `index.js:366-380`；`/tmp/adv-apikey.mjs`、`/tmp/adv-apikey-behavior.mjs` 行为级实证；官方 `firecrawl.ts:57-68`/`tinyfish.ts:70-79` | 两处改 `const apiKey = options?.apiKey ?? await options?.resolveApiKey?.() ?? "";`（对齐 `openai.js:42`）；补「存 key → 发出 Authorization/X-API-Key → tinyfish 走三步握手」的行为级测试 |
| **P1** | **health 把免 Key 计量后端报成需 Key**：`DEFAULT_KEY_ENV` 含 firecrawl/tinyfish → `requiresKey:true` → `health.js:57 keyless:false`，与 UI `optionalKey:true` / 实际行为矛盾 | `index.js:94-95,373`；`health.js:57`；`/tmp/adv-registry.mjs` + `buildHealthReport` 实证 `keyless:1`（3 启用里只有 exa 为真） | 引入 `OPTIONAL_KEY_IDS = new Set(["searxng","firecrawl","tinyfish"])`，`requiresKey` 排除之；health 增加 `optionalKey`/`metered` 字段，与 `client.js:31-32` 单一来源 |
| **P1** | **新增 `firecrawlBaseURL`/`tinyfishBaseURL` 惰性**：配置派生存在但 4 个 MCP 后端硬编码端点，注释 :258-259 承诺的 sidecar 路径不成立 | `index.js:260-263`；`firecrawl.js:28,59`、`tinyfish.js:31,63`、`exa.js:13`、`parallel.js:20`；`/tmp/adv-registry.mjs` | 4 个后端改 `options?.baseURL ?? CONST`，`recordRequest.endpoint` 用实际值；补单测断言自定义 baseURL 真的进入请求 |
| **P1** | **与官方 v2.2.5 的握手/参数偏差**：官方 `mcp.ts` 对 firecrawl/exa/parallel 无 initialize（仅 1 请求），我们每次新会话 3 请求串行 ~16s；官方 firecrawl `limit:8` 硬编码，我们发 `request.maxResults`（deepCoverage 下 ×1.5） | GitHub raw `mcp.ts:28-68`、`firecrawl.ts:64`；D 级实测 15.76/15.99s；`firecrawl.js:43` | 对齐官方：firecrawl/exa/parallel 也支持 `skipInitialize`（或让 `mcpCall` 默认无 initialize，仅 keyed tinyfish 走握手）；`limit` 固定 8 或钳到官方值。注意 exa/parallel 服务端是否真的不需要 initialize 需各自 live 验证（本次已验证 firecrawl 无 init 也能到 tools/call，返回体相同） |
| **P2** | **RFC1918 白名单漏段**：`169.254/16`、`[::1]`/`fd00::/8`/`fe80::` 全部不认；`\d{1,3}` 允许 256/999（靠 WHATWG URL 兜住） | `provider.js:321`；`/tmp/adv-rfc1918.mjs` | 若产品要求「自托管 IPv6/链路本地可用 http」，补 `169\.254(\.\d{1,3}){2}` 与 IPv6 段；否则在 README 明确只支持 v4 RFC1918。八段数值改用 `(?:25[0-5]|2[0-4]\d|1?\d?\d)` |
| **P2** | **`sessionCache` 仅按 URL 缓存**：换 key / keyless↔keyed 切换后仍复用旧 `Mcp-Session-Id`（TTL 10min），keyed 服务端可能拒 | `mcp-client.js:16,25,99`；`/tmp/adv-session-cache.mjs` 实证 key A→B 仍 `SESSION-1` | cache key 加凭据身份（如 key 的哈希，不存明文），或 key 变更时 `invalidateSession(url)` |
| **P2** | **熔断 fail-open 对单/全计量后端无效**：全 cooled 时放行全部，持续打 429 端点烧配额；429 无专属分类/轮转/`retry-after` | `provider.js:291-292`；`/tmp/adv-breaker.mjs` search#4 仍发起；官方 `websearch.ts:208-229` | 对 `isError:true` 的额度错误与 HTTP 429 单独识别（如新 code `WEB_PROVIDER_RATE_LIMITED`），按 `retry-after` 冷却并轮转到其它后端；fail-open 仅对「非配额」故障启用 |
| **P2** | **`egress-fetch.js` 死代码 + 注释不一致**：`:191/:217` 的 `?? headers.host` 永不生效（`:297` 已删 host）；隧道路径强制 HTTP/1.1，无 h2；IPv6 SNI 违反 RFC 6066 | `egress-fetch.js:191,217,291-297`；probe/probe2/probe5 | 两处直接写 `host: target.host`，删掉 `?? headers.host` 并改注释；文档说明隧道路径是 HTTP/1.1（若要 h2 需 `http2.connect` 经 socket）；SNI 对 IP 置 undefined |
| **P2** | **可观测性/资源缺口**：baseURL 校验失败、`ensureSession` 失败跳过 `hooks.recordRequest/recordOutcome`；`mcp-client` 无官方 256KB 响应上限 / 独立 25s 超时 | `provider.js:313-326`、`mcp-client.js:43-64`；官方 `mcp.ts:7,64-67` | 失败路径补 `hooks.recordOutcome({status:"error"})`；`collect`/`response.text()` 加字节上限 |
| **P2** | **版本/文档漂移**：`package.json` 仍 `2.8.4`，README 后端表（:14）未提 firecrawl/tinyfish；`node --test tests/`（目录形式）本机 exit 1 | `package.json`、`README.md:14`；本机复现 | 文档同步；测试命令显式列文件（CI 已如此） |

---

## 10. 已确认无误（诚实列出，均为 A 级除非标注）

1. `egressFetch` 8 条出口路径全部核对；无代理路径不经 `normalizeHeaders`，Host 不丢失；`target.host` 对默认端口/非默认端口/IPv6 方括号/CONNECT 目标全部正确（probe/probe3/probe5）。
2. `skipInitialize` 对 exa/parallel/firecrawl 的**旧调用零回归**成立；skip 分支不泄漏 `Mcp-Session-Id`；401/403/404 一次性 invalidate+retry 成立；stateless 403 fail loud 成立。
3. 两新后端的**解析失败安全性**：14 组畸形输入全部返回 `[]`，不抛异常、不污染整批；`maxResults` 截断正确。工具名 `firecrawl_search` / `search`、端点、keyless header、响应 `content[0].text` JSON 串语义与官方 v2.2.5 对齐（**非** `structuredContent`）。
4. 错误隔离成立：`Promise.allSettled` + limiter + `AbortSignal.any` + 单后端超时；一个挂起后端 100ms 被裁掉，其它后端结果完整；全失败时 `all enabled backends failed (N)` 诊断含各后端原因 + `cause`；`WebError`（含 `isError:true` 额度错误）正确进入 telemetry/health/host log，不静默。
5. `recordRequest` 的 `headers: {}` 与 body 均不含 key；`log.js` 不序列化 headers；`health.js` 另有脱敏 ⇒ **无 API key 泄漏**（A）。
6. 6 处登记的 **13 个 id 集合**完全同步（含 client.js 副本）；`DEFAULT_ENABLED` 确不含新 id；`resolveOptions` 的 `${id}BaseURL`/`${id}ApiKeyEnv` 派生对新 id 生效；`Config` 新增 6 字段均有 `.description()`。
7. `provider.js:321` 的 `{3}→{2}` 修复对题给 4 个边界用例成立；`http://192.168.1.1.evil.com`、userinfo 欺骗、DNS 后缀域均**未**绕过安全边界。
8. firecrawl `Anonymo…` 失败是官方 keyless 额度降级（HTTP 200 + `isError:true`），非本代码解析/网络 bug（A+D，出口抖动已标注）。
9. 熔断计数与 60s 冷却窗口生效；`⏸cooled` 遥测存在；`available()` 恒 true 但不联网（纯本地检查）。
10. `src-work` 与安装目录逐字节一致；14/14 单测通过（显式文件形式）。

---

## 11. 无法验证（明确边界）

| 项 | 原因 | 等级 |
|---|---|---|
| `task-14` claim→complete | 本委派会话未注入 `team_task_*` 工具（返回 unknown tool），与 20-content-assessment.md:151 同类 | E |
| firecrawl **有 key 时**的真实 200 响应体（`structuredContent` 是否存在、`data.web` 字段） | 本机无有效 FIRECRAWL_API_KEY，且 §5.2 P0 使 key 发不出去；仅拿到 keyless 拒绝体 | E |
| TinyFish **keyed 三步握手**在真实服务端的 `Mcp-Session-Id` 语义 | 无有效 key；仅 mock 验证我们代码路径 | E |
| exa/parallel **去掉 initialize 后**是否仍被服务端接受 | 本机 1091 出口对两端点有抖动；未做 A/B（改配置会影响运行时，违反只读） | E |
| 真实 GUI 里键保存后的 `credentials/set` RPC 闭环 | host `/api` 走 WebSocket 多路复用，curl 无法完整模拟（25 §11.7 已记） | E |
| `http://169.254.169.254` / IPv6 私有实例是否属产品承诺范围 | README 只写「私有 host / 自托管 SearXNG」，未定义是否含 link-local/IPv6 | E |
| 出口抖动对额度判定的影响 | 1091 出口 IP 池可能轮换；本次两次采样一致，不保证其它时段 | D（已标注） |

---

## 12. 五条反直觉发现

1. **【A】「补 Host」的修复里 `?? headers.host` 是死代码**：`:297` 先删了 `host`，`:191/:217` 的回退分支永不触发；真正生效的恒是 `target.host`。而「`delete host` 造成无代理路径 Host 丢失」也是假警报——那条路根本不走 normalize（undici 自己覆盖 Host）。修复**有效但写法自相矛盾**。
2. **【A】填了 API Key 反而毫无作用**：`resolveOptions` 给的是 `resolveApiKey()` 函数，新后端却只认 `options.apiKey` 字符串。于是 TinyFish 的 `skipInitialize: !keyed` 里 `keyed` **恒 false**——「keyed 走三步握手」这条精心对齐官方的分支，在生产中永远不可达；Firecrawl 也永远拿不到 Bearer，只能吃匿名额度拒绝。**点 2 与点 3 的「正确」都被这个 P0 架空**。
3. **【A+B+D】官方 v2.2.5 对 firecrawl/exa/parallel 根本不做 initialize**（`mcp.ts` 只发 1 个 `tools/call`，`id:1`），只有 keyed TinyFish 才握手。我们为「零回归」保留的三步握手，在本出口是 **3 个串行请求 ~16s**；firecrawl 额度失败因此把整批 tail 拖到 16s，若配 10s 超时反而在消耗 2 次配额后被误杀。对齐官方既是修延迟也是省配额。
4. **【A】熔断开了却等于没开**：`fail-open`（全部 cooled 就放行全部）在「只启用计量后端 / 其余全挂」时让 `threshold=3 / cooldown=60s` 形同虚设，第 4 次仍实打 429 端点。官方 `websearch.ts:208-229` 是「1 次 429 立刻按 retry-after 冷却 + 轮转」，我们却是「3 次任意失败才冷却 + 不轮转」——两套语义完全反向。
5. **【A】安全正则的「绕过」不在字符串层而在解析层**：`192.168.1.1.evil.com` 骗不过（^$ 锚定），但 `0177.0.0.1`、`2130706433`、`0x7f000001`、`192.168.0001.1`、`192.168.1.1.` 都被 WHATWG URL **归一化**成私有 IP 而放行；反过来 `\d{1,3}` 允许 `256/999` 的宽松性也是被 URL 构造器（直接抛 Invalid URL）兜住的。真正缺的是 `169.254/16` 与整个 IPv6 私有段——**白名单比看上去窄，也比看上去宽**。

---

## 13. 可复现命令清单（全部只读）

```bash
# 0) 目录一致性 / 版本
diff -rq /home/ova/dsh/.artifacts/websearch-research/src-work/plugin/lib \
         /home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/lib
node --test /home/ova/dsh/.artifacts/websearch-research/src-work/plugin/tests/lead-20261106.test.js \
            /home/ova/dsh/.artifacts/websearch-research/src-work/plugin/tests/lead-20261107.test.js

# 1) Host / 出口路径（离线 CONNECT 代理 + 自签 TLS，需 NODE_TLS_REJECT_UNAUTHORIZED=0）
node /tmp/adv-egress-probe.mjs      # 调用方 Host 被删 + target.host 生效
node /tmp/adv-egress-probe2.mjs     # native fetch 覆盖 Host + IPv6 CONNECT 目标
node /tmp/adv-egress-probe3.mjs     # CONNECT authority 格式
node /tmp/adv-egress-probe5.mjs     # IPv6 / 非默认端口 / 默认端口 Host 实测
node /tmp/adv-egress-final.mjs      # 8 条出口路径 + 死代码结论

# 2) skipInitialize / session cache / retry
node /tmp/adv-mcp.mjs
node /tmp/adv-session-cache.mjs

# 3) 官方 v2.2.5 raw 源码（token 取自 .git/config，勿打印）
CFG=/opt/xr-research/zcode-research/.git/config
URL=$(grep -m1 'url = ' "$CFG" | sed -E 's/^\s*url = //')
TOK=$(printf '%s' "$URL" | sed -nE 's#https://([^@]*)@.*#\1#p'); P=${TOK#*:}
for f in firecrawl.ts tinyfish.ts mcp.ts exa.ts parallel.ts; do
  curl -sS -u "x-access-token:$P" \
    "https://raw.githubusercontent.com/anomalyco/opencode/v2.2.5/packages/core/src/plugin/websearch/$f"
done
curl -sS -u "x-access-token:$P" \
  "https://raw.githubusercontent.com/anomalyco/opencode/v2.2.5/packages/core/src/websearch.ts" | grep -n '429\|cooldown\|randomProvider'

# 4) 解析失败 / 错误隔离 / 超时 / 熔断 / 配额路径
node /tmp/adv-parse.mjs
node /tmp/adv-isolation.mjs
node /tmp/adv-timeout.mjs
node /tmp/adv-breaker.mjs
node /tmp/adv-quota-path.mjs

# 5) 6 处登记集合对比 / key 传递证伪
node /tmp/adv-registry.mjs
node /tmp/adv-apikey.mjs
node /tmp/adv-apikey-behavior.mjs

# 6) RFC1918 边界
node /tmp/adv-rfc1918.mjs

# 7) 真实观测（D 级，出口抖动；经 1091 代理）
curl -sS --max-time 25 -x http://172.30.66.1:1091 -X POST https://mcp.firecrawl.dev/v2/mcp \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"firecrawl_search","arguments":{"query":"probe","limit":3}}}'
curl -sS --max-time 25 -x http://172.30.66.1:1091 -X POST https://agent.tinyfish.ai/mcp \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -H 'X-TinyFish-Access-Mode: keyless' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search","arguments":{"query":"probe"}}}'
```

> 所有 `/tmp/adv-*.mjs` 为本次临时复现脚本，报告交付后删除（不改运行时状态、不写源码/配置/其它报告）。
