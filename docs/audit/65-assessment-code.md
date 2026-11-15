# 65 · 独立评估验证 V1：代码层全貌

> 本文件由 V1 独立重取证据后重写。任务：**证伪 Lead「全量审计已干净、无未修 P0/P1」**。
> 取证基线：`src-work/plugin/` 44 文件（任务书称 35，实测插件树含 `examples/`、LICENSE 共 44；`lib/`+根+tests 共 41，其中 35 有对应改动基线）、`src-work/backups/*.orig` 26 份（其中 23 份对应插件树内文件、2 份 profile 级、1 份 `.orig` 对应已删除导出）。
> 一致性：`cmp -s` 对 `src-work/plugin` 全部 44 文件 vs `/home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/` → **IDENTICAL=44 / MISMATCH=0**。
> 方法：`diff -u` 全量逐文件（/tmp/65-all-diffs.txt，1675 行）+ `node` 真函数行为级复现（/tmp/65-shim/work，WebError 忠实 shim 复刻 `dsh-llm/lib/types/error.js` 的 `HarnessError` 构造语义 + `dsh-web` 的 `WebError extends HarnessError`；运行完删除）。只读，不改源码/配置/运行时。
> 56/58/64/59–63 仅作线索，不作权威。**结论：证伪成立，存在未修 P0/P1。**

## 评级图例（每条 A/B/C/D/E）
- **A**：`node` 行为级复现已确证（可观察输出 / 断言）。
- **B**：多文件 / 多调用点静态互证，因果闭合。
- **C**：单点静态推断，需特定运行时触发条件。
- **D**：线索 / 存疑，证据不足，需更多取证。
- **E**：复核后判定不成立，或已确认无误。

## 0. 取证前先推翻三个「前提」
1. **[B] 35 vs 44**：`find src-work/plugin -type f | wc -l` = 44；安装副本亦 44，逐字节一致 44/44。任务书「35 文件」指有改动基线的文件集合，不含 `examples/cordis.patch.yml`、`LICENSE`、以及 6 个无 `.orig` 的新增 lib 文件与 8 个新测试之外其余文件。本报告按**实际 44 文件**复核。
2. **[B] 26 `.orig` 里只有 23 份能一对一映射**：`profile-cordis.patch.yml.orig`、`profile-package.json.orig` 是 profile 级；`README.md.orig` 等另有 `history.js.orig` 含已删除的 `isTrustedApiRequest` 导出。逐文件 `diff -u` 共 23 处非空 diff，`cordis.patch.yml` 为空 diff。
3. **[A] 先前落在本文件的「骨架 → Lead 补完」版（第 1 版 85 行）是另一会话并发写入的**：其中「§5 无新 P0/P1」结论与本次独立复现直接冲突，已整体作废，不作权威引用。

---

## 1. 逐文件 diff 复核表

记法：**类别** = bug 修 / 契约改 / 注释 / 测试 / 文档 / 新增；**真解决** = 行为级复现支持其声称解决的问题。

| # | 文件 | diff 类别 | 本轮实际改动 | 是否真解决 | 评级 |
| --- | --- | --- | --- | --- | --- |
| 1 | `cordis.patch.yml` | — | 空 diff | 无需解决（`id: dsh-websearch` 与 profile patch 一致） | E |
| 2 | `lib/backends/anthropic-like.js` | bug 修 | `new WebError(message,…)` → `webErrorFromResponse(response,message,id)`；`message` 是**第二实参**（正文），第一实参恒为 `response` | ✅ 11 处实参核对无误，结构化字段透传 | A |
| 3 | `lib/backends/brave.js` | bug 修 | 同上 | ✅ | A |
| 4 | `lib/backends/ddg.js` | bug 修 + 注释 | helper 替换 + `if (err instanceof WebError) throw err;` 阻止二次包装 | ✅ 429/402 的 `code/status/rateLimited` 不再被抹 | A |
| 5 | `lib/backends/exa.js` | 契约改 + 注释 | `mcpCall(..., {skipInitialize:true})` | ⚠ **部分**：去掉握手但把 `callBody.id` 改成 1，与 `initialize` 的 id=1 撞车；见 §5 N3 | A |
| 6 | `lib/backends/mojeek.js` | bug 修 | helper 替换 | ✅ | A |
| 7 | `lib/backends/openai.js` | bug 修 | helper 替换 | ✅ 但 `message` 自嵌套形成 `"OpenAI API error (HTTP 429): openai API error (HTTP 429)"`（文案瑕疵，P3） | A |
| 8 | `lib/backends/parallel.js` | 契约改 + 注释 | `{skipInitialize:true}` | ⚠ 同 #5；文件内 `isError` 重复检查 2 次（原有死分支，未修，P3） | A |
| 9 | `lib/backends/searxng.js` | bug 修 | helper 替换，但 `429||>=500` 与 else **两分支抛同一个错误**，死条件仍在 | ✅ 分类生效；死分支 P3 | A |
| 10 | `lib/backends/serper.js` | bug 修 | helper 替换 | ✅ | A |
| 11 | `lib/backends/tavily.js` | bug 修 | helper 替换 | ✅ | A |
| 12 | `lib/backends/firecrawl.js` | 新增（无 `.orig`） | 新后端 / keyless / limit=8 / parse | ✅ 可用；错误串半句截断见 §4 D4 | A |
| 13 | `lib/backends/tinyfish.js` | 新增（无 `.orig`） | 新后端 / keyless↔keyed 分流 | ⚠ keyed 握手缺鉴权头，见 §5 N5 | A |
| 14 | `lib/breaker.js` | bug 修 + 契约改 + 注释 | 新增 `opts`（rateLimited 立即冷却）、过期窗口重置 failCount | ✅ 过期窗口重置实测成立；但 `retryAfterMs` 未在 fold 内限幅（上游已限） | A |
| 15 | `lib/cache.js` | 契约改 + 注释 | `cacheKeyFor` 增加 `resultOptions` 哈希 | ❌ **声称含 safeSearch / per-backend baseURL / models，实测这些键根本不在 `opts` 顶层**，改了但没生效；见 §5 N2 | A |
| 16 | `lib/client.js` | bug 修 ×6 + 契约改 + 注释 + UI | `writeQueue` 串行化、`save()` 快照前置、`editKey` 空草稿、`readCredential` ok:false、writeCredential ok:false、safeFailureReason、METERED 分区、KeyedBackendCard、inject 加 `remote.credentials` | ✅ save/queue/read/write 行为级 13/13 通过；⚠ `safeFailureReason` 把 4 种失败全塌成 `"write rejected"`（D3）、`discard()` 不清 readErrors（D4）、窗口监听 disposer 移除错函数（原有） | A |
| 17 | `lib/health.js` | 契约改 | 加 `optionalKey` / `metered` 字段 | ✅ 但 `sanitizeError` 仍只做正则脱敏+120 截断（无结构化的 code 白名单），见 §4 | B |
| 18 | `lib/history.js` | bug 修 + 契约改 | `clear()` 纳入 `writeChain`；**删除** `isTrustedApiRequest` 导出 | ✅ clear 串行化实测；⚠ 删除导出是契约改（已无消费者，安全）；⚠ `registerHistoryRoutes` 仍不 dispose，见 §4 | A |
| 19 | `lib/index.js` | 契约改 + bug 修 + 注释 | 13 后端登记、10 处 ApiKeyEnv grammar、`findPluginRow` 共享、`current()` 改读 `settings.describe()`、`resolveOptions` 的 `requiresKey/optionalKey/metered` | ✅ grammar 10/10 与官方 `credentialRef` 一致（A）；⚠ 配置**描述**仍说「留空」但 schema 拒 `""`（D8，P2） | A |
| 20 | `lib/multiquery.js` | 新增（无 `.orig`） | `isComplexQuery` / `deriveSubQueries` | ⚠ 分隔符正则的基本子式 `\s+(?:比较|对比|和)` 与 `(?:比较|对比|和)\s+` 在 `A 和 B` 上**整词吞掉**，返回单变体 → multiQuery 实际空转；见 §4 | A |
| 21 | `lib/prompting.js` | 新增（无 `.orig`） | shapeQuery / resultHeader | ✅ | B |
| 22 | `lib/provider.js` | bug 修 + 契约改 + 注释 | numResults min、3b `.every(rateLimited)`、超时分类、cache resultOptions、**删除 `opts.resultHeader !== false` 门控**、私网正则、8s 超时 | ✅ min 与 3b 主路径成立；❌ 混合故障 fail-open 重打限流端点（N6）；❌ resultHeader 契约静默删除；❌ cache 键漏项 | A |
| 23 | `lib/rrf.js` | 新增（无 `.orig`） | RRF 融合 | ✅ 单列表 fuse 不改变顺序 | B |
| 24 | `lib/settings-api.js` | bug 修 + 契约改 + 注释 | `findPluginRow` 共享、`readBody` 超限移除监听 + `req.destroy()` | ❌ **`req.destroy()` 让 413 永远发不出去**，实测基线返 413、现状 `ECONNRESET`；见 §5 N1（本轮**引入的新 P1 回归**） | A |
| 25 | `lib/trust.js` | 新增（无 `.orig`） | 请求围栏 | ✅ `rejectionFor` 有结构性兜底 | B |
| 26 | `lib/util/abort.js` | 新增（无 `.orig`） | abort helpers | ✅ | B |
| 27 | `lib/util/egress-fetch.js` | bug 修 + 契约改 + 注释 | CONNECT 路径 Host 补正、`collect()` try/catch、normalizeHeaders 删 Host 注释 | ✅ collect 实测 3 类抛错均转为 reject 不崩；❌ `redirect:"follow"` 递归 depth 重置仍存在 | A |
| 28 | `lib/util/failure-label.js` | bug 修 + 注释 | 结构化 code 优先、24h 上限、过去 http-date 兜底 | ✅ 12 类边界全过 | A |
| 29 | `lib/util/filters.js` | 新增（无 `.orig`） | 过滤/参数映射 | ✅ | B |
| 30 | `lib/util/log.js` | 新增（无 `.orig`） | 后端请求/结果事件 | ✅ | B |
| 31 | `lib/util/mcp-client.js` | bug 修 + 契约改 + 注释 | BOM、SSE 多帧按 id、plain-JSON 容错、`skipInitialize`、`forceFreshSession` | ⚠ 多帧/BOM 成立；❌ plain-JSON 不校验 id 造成跨请求串包；❌ SSE 拒 string-id/无 id；❌ sessionCache 纯 URL 键控；❌ initialize 不带 extraHeaders | A |
| 32 | `lib/util/namespace.js` | 新增（无 `.orig`） | `findPluginRow` | ✅ id 优先 / shape 需 ≥2 字段 | A |
| 33 | `lib/util/rank.js` | 新增（无 `.orig`） | dedupe / rerank | ✅ | B |
| 34 | `lib/util/web-error.js` | 新增（无 `.orig`） | 统一 HTTP 错误构造 | ✅ 11 调用点全核实；⚠ `opts.cause` 11 处全未传（死参数，P3）；⚠ 新 code 从不上抛到 seam | A |
| 35 | `package.json` | 文档 | 11→13 后端描述 | ✅ | B |
| 36 | `README.md` | 文档 | 11→13、DSH_UNIFIED_SEARCH_BACKENDS 优先级说明 | ✅ 数字口径一致；⚠ 「留空」文案 3 处与 schema 矛盾 | B |
| 37–44 | `tests/*.test.js` ×8 | 测试（全部新增，无 `.orig`） | 1082 行 | ⚠ 8 个文件中 6 个以 `readFileSync`+正则**源码级断言**为主；`sse.test.js` 用 `new Function` 提取真函数、`quota.test.js` 与 `3b-runtime.test.js` 直接 import 真函数。`parseEnvelope` 的 plain-JSON 串包、SSE string-id、redirect、sessionCache、extraHeaders、413 回归**均无行为级断言** | A |

**「改了但没生效」**：`cache.js` 的 `resultOptions` / `provider.js:247` 的正则声称覆盖 `safeSearch|recency|language|resultHeader|*BaseURL|*Model|*ApiKeyEnv`，实测这些键**全部不在 `opts` 顶层**（`safeSearch` 在 `opts.backends[id]`，`recency/lang` 是 `filters` 的字段名且 filters 已单独入键，`resultHeader` 无 Config 字段，`*BaseURL` 等也在 `opts.backends[id]` 里）。**「修法与注释不符」**：`settings-api.js` 注释称「释放 stream / keep-alive 不等 end」，实测把 socket 销毁导致 413 丢失；`cache.js` 注释同上。**「引入新分支却无测试」**：`skipInitialize` / `forceFreshSession` / `readBody` 的 `req.destroy()` / 3b 的 `.every()` 混合分支，均无覆盖其失败面的行为级断言。

---

## 2. 每个修复的成立 / 不成立 + 证据

| 修复声称 | 实测（node 行为级） | 裁决 | 评级 |
| --- | --- | --- | --- |
| `webErrorFromResponse` 11 处调用实参正确、字段透传 | 11 处第一实参均为非 2xx `Response`；`response.text()` 已消费后 `headers.get("retry-after")` 仍可读；429→`RATE_LIMIT/rateLimited=true`、402→`QUOTA/quota=true`、403→`WEB_PROVIDER_ERROR/quota=false`；`instanceof WebError` 真；`opts.cause` 链保留 | **成立** | A |
| `rateLimited` 结构化优先、消除文本假阳性 | `HTTP 200 anonymous`→false、`quota exceeded`→false、`Anonymous keyless access is unavailable`→true、`providerCode=insufficient_quota`→true | **成立** | A |
| `retryAfterMsFrom` 24h 上限 + 过去 http-date | `"60"→60000`、`"86400"→86400000`、`"86401"/"999999999"→60000`、负数/垃圾→60000、过去 GMT→60000、未来 120s→~119148ms、>24h http-date→60000 | **成立** | A |
| `foldBreaker` 过期窗口重置 | 第 3 次失败 `{3,63000}`；过期后再失败 `{1,0}`（不再单调累加）；`cooledUntil=0` 仍累加；`opts.rateLimited` 立即冷却 | **成立**（我最初断言「过期后仍应开窗」是错的，实现按阈值重新计数符合注释） | A |
| `collect()` try/catch 防止事件回调内未捕获异常 | 真实本地 HTTP 代理 + 合法原始 HTTP/1.1：`status 999` → `rejected: init["status"] must be in the range...`；204+body / 非法头名 → 解析错误或 reject；正常 200 → 正常 resolve。**基线（无 try/catch）会崩，现状不崩** | **成立** | A |
| `mcp-client.parseEnvelope` BOM / SSE 多帧 / plain-JSON 容错 / id 只用于 SSE | BOM+SSE、BOM+plain、多帧跳通知、CRLF、batch array、多行 `data:` 均通过；**但** plain-JSON `id=7` 被当作 `expectedId=1` 的结果返回、SSE `id:"1"` / 无 id 帧被丢弃、SSE 里 id=1 的 initialize 形状帧被当成搜索结果 | **部分成立**：主路径通过，协议边界有 P1 缺陷（N3/N4） | A |
| `client.save()` 快照在 await 之前 | vm 加载真 `client.js` 工厂 + 注入 mock scope：`edit("numResults","3")` → save() 中再 `edit(...,"9")` → 新编辑保留、`savedAt===0`、二次 save 写 9；空 key 草稿不入 staged；`setToggle` 失败 resync；`readCredential ok:false` 记 readErrors；`writeCredential ok:false` 抛错 | **成立** | A |
| `provider` 3b `.every(rateLimited)` | 真 provider：双 429 冷却 → 快速失败且 0 次后端调用；**混合**（a=429 冷却 + b=3×500 普通冷却）→ `.every` 为 false → fail-open，**重新调用已限流的 a** | **部分成立**：全配额场景成立；混合场景维持缺陷（N6） | A |
| `numResults min(hostCap,userMax)` | 7 组输入（8/8、5/8、8/3、50/50、undefined/8、0/8、8/0）全部符合 `Math.max(1,Math.min(...))` | **成立** | A |
| `breaker` 过期窗口 + `failure-label` 上限联合 | 上游 `retryAfterMsFrom` 已封顶 24h，`foldBreaker` 不再二次限幅但不会失控 | **成立** | A |
| `index.js` 10 处 ApiKeyEnv grammar | 10/10 均为 `/^[A-Za-z_][A-Za-z0-9_]*$/`，与 `dsh-credentials/lib/index.js` 的 `REF_PATTERN` 逐字一致；`lower`/`_private` 通过，`""`/`1KEY`/`A-B` 拒绝 | **成立** | A |
| `history.clear()` 串行化 | `record` 排队后 `clear()` → `list()` 为空；反向 `clear→record` 保留新条目 | **成立** | A |
| `readBody` 超限修复 | 现状 70KB body → `ECONNRESET`（无 413）；`.orig` 基线 → `413 {"ok":false,"error":"request body too large"}`；删掉 `req.destroy()` 后 → 413 恢复 | **不成立，且是回归**（N1） | A |
| `cacheKeyFor` 纳入「所有影响结果的选项」 | 同 query 下改 `safeSearch` / `baseURL` / `model` / `apiKeyEnv` → cache key 不变 → 0 次后端调用、返回旧实例 URL | **不成立**（N2） | A |
| `egressFetch` redirect 有界 | 20 跳链发出 42 次请求走到 200；无限链 2s 超时仍存活 | **不成立**（N7，潜伏） | A |
| `resultHeader` 恒开（契约改） | `opts.resultHeader=false` 仍被加头；且 Config 无 `resultHeader` 字段 → 基线里可关闭的能力静默删除 | **修法与注释不符**（P2/P3） | A |

---

## 3. 重点行为级复核（逐项，不 grep）

1. **[A] `web-error.js` 11 调用实参**：11 处 `throw webErrorFromResponse` 与 9 个后端 + 2 个 MCP 位置一一对应；`openai.js`/`anthropic-like.js` 的 `message` 是正文**第二**实参无误传；8 处先 `await response.text()` 再取 `headers.get`，实测 `Response` 消费 body 后 header 仍可达。`opts.cause` 11 处全未传 → 死参数（P3）；新 `RATE_LIMIT`/`QUOTA` code 只在 provider 内部被 `rateLimited()` 消费，全失败/3b 快速失败的外层恒为 `WEB_PROVIDER_ERROR`，`harnessErrorCode()` 只看最外层 → seam 级重试策略看不到限流码（P2 观测/语义缺口）。
2. **[A] `mcp-client.parseEnvelope`**：BOM 剥离、SSE 按空行分事件、`data:` 多行 join、按 id 挑帧均实测通过；plain-JSON 按注释**故意**放弃 id 校验；SSE 与 plain 的 id 比较不对称（SSE `===` 严格、plain batch 用 `String()`）；SSE 帧无 id 或 string id 被丢弃后 `JSON.parse(body)` 失败 → 抛 `MCP: failed to parse response envelope`。`mcpCall` 真调用复现 3 类 SSE 响应：numeric-id 成功、string-id/no-id 失败。
3. **[A] `egress-fetch.collect()`**：try/catch 确实把 `new Response(...)` 的同步抛错转成 `reject`，本地真实 socket 上验证 3 类异常不崩进程；`host: headers.host ?? target.host` 在 CONNECT 与 httpViaProxy 两条路径都存在。
4. **[A] `client.save()` 快照前置**：真 `client.js` 工厂在 vm 中加载、mock scope 注入；保存中再编辑的新对象不被删、不假报「已保存」；另测 `editKey` 空草稿、`setToggle` 失败 resync、`readCredential ok:false`、`writeCredential ok:false` 全通过。
5. **[A] `provider` 3b + numResults**：见 §2。混合故障 fail-open 用真 provider + 模块级 `latestBackendHealth` 复现。
6. **[A] `breaker` 过期窗口**：见 §2。
7. **[A] `failure-label` 24h + 过去 http-date**：见 §2。
8. **[A] `index.js` 10 处 ApiKeyEnv grammar**：见 §2；`resolveOptions` 对 13 个后端无条件 `credentialRef(keyEnvName)`，与 `.min(1)` 一起使「留空」路径 fail-loud，与 3 处 description 文案矛盾（D8）。

---

## 4. 被略过的 E / 条件-go / 需批准项重裁决

| 项 | 原裁决 | **重裁决** | 可复现证据 | 评级 |
| --- | --- | --- | --- | --- |
| 3b 混合故障细策略 | 59 B-2 判 P2 / 需用户批准 | **成立且应修：P1** | 真 provider：a=429（rateLimited 冷却）、b=3×500（普通冷却），`cooled={a,b}` 但 `.every(rateLimited)` 为 false → `cooled.clear()` + fail-open → **重新请求 a**（`deltaA=1`）。注释「Re-issuing the fan-out would hit the same limited endpoints and burn more quota」正是要防的场景，实现没防住。不是「仅烧配额」：在共享配额/计费端点上重复打 429 会放大限流窗口、拖垮可用后端 | A |
| R2 `redirect:"follow"` 递归 depth 重置 | 60 P1-4，64 标 E「当前 11 调用点全 redirect:"error"，不可达」 | **潜伏成立，维持 P2（非 P1）** | 本地真代理 20 跳链 `redirect:"follow"` 发 42 次请求并到 200；无限链 2s 超时仍存活。11 个 `egressFetch` 调用点确为 `redirect:"error"`，线上不可达；但模块注释明确承诺「bounded redirect:follow」，属契约谎言。**未达 P1**（需新调用方改 redirect 模式） | A |
| R2 `sessionCache` 纯 URL 键控 | 60 P1-3，64 判「实际不可达」 | **不成立：确实可达，P1** | `mcpCall` 真调用：同 URL 先 KEY-A 再 KEY-B（都**不传** `forceFreshSession`）→ 只 1 次 initialize，KEY-B 的 tools/call 头带 `Mcp-Session-Id: SESSION-FOR-KEY-A`。`forceFreshSession` 只是调用方约定（当前仅 TinyFish keyed 传），缓存层本身无保证；任一 sessionful 调用漏传即串会话 | A |
| R2 `initialize` 不带 extraHeaders | 60 P1-5，64 标 E「需真 key 验证」 | **成立且应修：P1** | `mcpCall` 真调用：initialize / notifications/initialized 头里**无** `X-API-Key`，只有 tools/call 有；401 重试路径的第二次 initialize 同样无 key。按 MCP Streamable-HTTP，鉴权头应覆盖整条会话链；keyed TinyFish 在真实服务端上 initialize 可能 401，且该失败不被 tools/call 的 401 重试覆盖 → keyed 模式整体不可用。不需要真 key 即可由请求头观测确证 | A |
| `ws.register` disposer | 53 主版 / 64「契约未定位，维持 E」 | **成立，P2**（契约已定位） | 官方 `dsh-host-webserver/lib/types/index.d.ts:193`：`register(route): () => void`，实现 `return () => table.delete(path)`；官方调用方一律 `ctx.effect(() => webCtx.webServer.register(route), …)`。本插件 3 处 `registerSettingsRoutes/registerHistoryRoutes/registerHealthRoute` 均**丢弃返回的 disposer**、也不包 `ctx.effect`。实测同一 `ws` 二次注册 → `webserver: duplicate exact route "/api/unified-search/settings"` 抛错，插件重载/热更新无法清理 | A/B |
| `isComplexQuery` 语义 | 52-b P3 登记 / 64 需用户决定 | **成立且比 P3 重：P2** | `isComplexQuery("柔和光线")=true`（裸「和」在词内）、`deriveSubQueries` 返回单变体；`A 和 B`、`what is X vs Y and Z` 同样返回 `[原查询]`（分隔符正则把整词吞掉），`multiQueryEnabled=true` 时 backend 只被调 1 次、RRF 单列表无变化 → 功能**静默空转**。同时 `foo; bar` 被 `deriveSubQueries` 切成 3 变体却 `isComplexQuery=false`，门控与切分不对称 | A |
| `sanitizeError` 加固 | 52-b / 64 P3 登记 | **部分成立，P2** | `health.js:sanitizeError` 只做 `SECRET_PATTERNS` 正则替换 + 120 字截断，无稳定 code 白名单；`settings-api.js:sanitize()` 实测把 host 抛出的 `Error("INTERNAL /home/dsh/secret/path SECRET_REF_NAME")` **原样回显**到 400 JSON。注释「Fixed-shape diagnostics only: never echo header text or raw error details」与实现不符；同一文件 `safeFailureReason` 又把 4 种 key 写失败塌成 `"write rejected"`，诊断归零（61 D3） | A |
| D3 cache 命中 0/0 | 63 P2 仍在 | **维持 P2**（非 P1） | 真 provider：缓存命中 `history.record({resultCount:1,backendsOk:0,backendsTotal:0})`，与全失败 0/0 不可区分，仅污染观测 | A |
| D4 firecrawl 半句截断 | 63 P2 仍在 | **维持 P2** | `msg.slice(0,80)` = `"…unavailable for thi"`，`slice(0,40)` = `"…(Anonymo)"`；health 里的 80 字恰好仍含 `rateLimited()` 的精确子串，分类暂不失效但耦合脆弱 | A |
| D5 陈旧 rev + 非法字段返 400 | 63 P2 | **维持 P2**（且实测复现） | 本地真 HTTP 路由：`{ops:[{set numResults:99}],expectedRevision:0}` → 400 `invalid value`；合法 `7` 同 rev → 409 `SETTINGS_CONFLICT`。校验先于 revision 检查 | A |
| D6 revision 进程内 | 63 P3 | **维持 P3 / 非缺陷** | 计数器语义，配置无残留 | B |

**⇒ 3 项被不当略过、达到 P1 应修而未修**：3b 混合故障、sessionCache 键控、initialize 不带 extraHeaders。另有 `ws.register` disposer / `isComplexQuery` / `sanitizeError` 达到 P2 应修。Lead「未发现本应 P1 却不当略过」的裁决**不成立**。

---

## 5. 新发现的 P0/P1 清单

### N1 · [P1 / A] `readBody` 超限修复把 `413` 变成 `ECONNRESET`（本轮引入的回归）
- **现状**：`lib/settings-api.js:244-256` 在 `size > MAX_BODY_BYTES` 时 `rejectBody(413)` 后 `req.removeListener("end",onEnd)` / `removeListener("error",onError)` / **`req.destroy()`**，直接销毁 socket，`guarded()` 的 `sendJson(res,413,…)` 写不出去。
- **影响**：超过 64KB 的 settings POST 客户端拿到连接重置而非可行动的 413；`.orig` 基线原本正确返回 413。注释「Stop consuming and release the stream so a keep-alive connection is not left waiting」与实际结果相反。
- **证据**：真实 `http.createServer` 挂 `registerSettingsRoutes`：现状 `{"error":"ECONNRESET"}`；`.orig` 基线 `{"status":413,"body":"{\"ok\":false,\"error\":\"request body too large\"}"}`；把 `req.destroy()` 一行删掉即恢复 413。
- **最小修法 diff**：
```diff
         req.removeListener("end", onEnd);
         req.removeListener("error", onError);
-        req.destroy();
+        // Drain the remaining body so the 413 response can be written and
+        // keep-alive stays usable; readBody is already rejected.
+        req.resume();
         return;
```
- **回归断言**：`POST` 70KB body → `status===413` 且 `body` 含 `request body too large`；后续同连接 GET 仍 200；`settings.mutate` 调用数为 0。

### N2 · [P1 / A] `cacheKeyFor` 的「结果影响选项」实际漏掉全部后端级设置 → 改配置后 15 分钟内仍返回旧结果
- **现状**：`provider.js:244-249` 从 `opts` **顶层**挑 `resultOptions`；`safeSearch`/`*BaseURL`/`*Model`/`*ApiKeyEnv` 全部在 `opts.backends[id]` 内，`resultHeader` 无任何 Config 字段，`recency/lang` 是 `filters` 的字段（`filters` 已单独入键）。于是 `resultOptions` 只含 8 个全局项。`cache.js:34` 注释却明写「per-backend base URLs and models」。
- **影响**：用户把 `searxngBaseURL` 指向另一个实例、切换 `safeSearch`、换 `deepseekModel`、改 `firecrawlApiKeyEnv`，同一 query 在 TTL（默认 900s）内**全部命中旧缓存**，0 次后端调用，返回上一个实例的 URL。配置保存「看起来生效」，实际被缓存掩盖。
- **证据**：`buildResultOptions(realisticOpts)` 输出 `{"numResults":8,"concurrency":6,"backendTimeoutMs":30000,"resultTelemetry":false,"rerank":false,"dedupStrategy":"url","multiQueryEnabled":false,"deepCoverage":false}`；改 3 项后端级设置后真 provider 第 2 次 search `calls 1->1`、`sources[0].url` 仍是旧值。
- **最小修法 diff**：
```diff
         const resultOptions = {};
         for (const [k, v] of Object.entries(opts)) { /* 现有全局项 */ }
+        // Backend-level options live under opts.backends[id], not at the top level.
+        for (const id of opts.enabledBackends ?? []) {
+          const be = opts.backends?.[id] ?? {};
+          for (const k of ["baseURL", "model", "apiKeyEnv", "safeSearch", "searchDepth"]) {
+            if (be[k] !== undefined && typeof be[k] !== "function") resultOptions[`${id}.${k}`] = be[k];
+          }
+        }
         cacheKey = cacheKeyFor({ ... , resultOptions });
```
- **回归断言**：同 query、改 `opts.backends.a.baseURL` 后 `cacheKeyFor` 不同；真 provider 第二次 search `calls` 增加 1；`sources[0].url` 随实例变化。

### N3 · [P1 / A] MCP `id` 契约：plain-JSON 不校验 id + `skipInitialize` 把 id 退化成 1 → 跨请求结果/错误串包
- **现状**：`mcp-client.js:178` `id: options.skipInitialize ? 1 : 2`；`:36` `initBody.id=1`；`:139-141` plain-JSON 直接 `return parsed`（注释称 stateless 可回显别的 id）；SSE 挑帧用 `r.id === expectedId`。
- **影响**：① 单流 SSE 里若同时出现 id=1 的 initialize 形状帧与 id=2 的真实 tools/call 帧，`parseEnvelope(sse,1)` 返回 `serverInfo` 帧，后端把它当搜索结果（`envelope.result` 真值检查抓不到）→ 静默错误结果。② plain-JSON 收到 `id=7` 的**别人的** result/error 会原样当本调用结果/抛错。③ SSE 与 plain-batch 的 id 比较不对称（严格 `===` vs `String()`）。
- **证据**：真 `mcpCall(url,…,{skipInitialize:true})` 喂混合 SSE → 返回 `{"protocolVersion":"2025-06-18","serverInfo":{"name":"x"}}`，`callBody.id===1` 与 initialize 的 id=1 相同；另喂 `{"id":7,"result":{"content":[{"text":"ANOTHER REQUEST"}]}}` → 原样返回。64 号「不采纳，标 E：真实 HTTP 一请求一响应不会收到别人的 id=7 / skipInitialize 不发 initialize 故流里无 serverInfo 帧」在共享 SSE 流/代理合并响应/服务端推送通知场景下不成立。
- **最小修法 diff**：
```diff
-    id: options.skipInitialize ? 1 : 2,
+    // Never reuse initialize's id; stateless calls still need a distinct id.
+    id: options.skipInitialize ? 3 : 2,
@@
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
@@
-      const match = candidates.find((r) => r && r.id === expectedId
+      const match = candidates.find((r) => r && String(r.id) === String(expectedId)
```
- **回归断言**：混合 SSE（id=1 serverInfo + id=3 real）`parseEnvelope(...,3)` 返回 real；plain-JSON `id=7` 抛错；`id:"3"` 的 SSE 帧被接受；现有 `sse.test.js` 的「permissive plain JSON」用例需同步改为期望抛错。

### N4 · [P1 / A] `sessionCache` 纯 URL 键控 + keyed 握手缺鉴权头（合并呈现，分别可复现）
- **现状**：`sessionCache = new Map()` 键只有 `url`；`ensureSession(url, signal, {forceFreshSession})` 不接收 `extraHeaders`；initialize / notifications/initialized 的 headers 硬编码，无 `...extraHeaders`；401 重试调 `ensureSession(url, signal)` 也无 key。
- **影响**：① 同一 MCP URL 换 API key（未显式 `forceFreshSession`）复用旧 `Mcp-Session-Id`，凭证轮换后仍用旧会话（`KEY-B` 带 `SESSION-FOR-KEY-A`）。② keyed TinyFish 的 `X-API-Key` 只出现在 tools/call，initialize/notification/重试 initialize 全无 → 按 MCP 鉴权规范整条链失效，且该 401 不被 tools/call 重试覆盖。
- **证据**：真 `mcpCall` 复现 2 凭证 1 次 initialize、KEY-B 携带 KEY-A 会话 id；initialize/notification 头无 `x-api-key`；401 重试 2 次 initialize 均无 key。64 号「sessionCache 实际不可达 / initialize 需真 key 才能验证」被请求头观测直接推翻。
- **最小修法 diff**：
```diff
-const sessionCache = new Map();
+const sessionCache = new Map(); // key: url + "\0" + stable auth-header digest
+function cacheKey(url, extraHeaders) {
+  const auth = Object.entries(extraHeaders ?? {})
+    .filter(([k]) => /^(authorization|x-api-key|x-tinyfish-access-mode)$/i.test(k))
+    .sort(([a], [b]) => a.localeCompare(b))
+    .map(([k, v]) => `${k.toLowerCase()}:${v}`).join("|");
+  return `${url}\0${auth}`;
+}
-async function ensureSession(url, signal, options = {}) {
+async function ensureSession(url, signal, options = {}, extraHeaders = {}) {
+  const key = cacheKey(url, extraHeaders);
-  const cached = sessionCache.get(url);
+  const cached = sessionCache.get(key);
@@
       headers: {
         "Content-Type": "application/json",
         "Accept": "application/json, text/event-stream",
         "User-Agent": UA,
+        ...extraHeaders,
       },
@@
         "Content-Type": "application/json",
         ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
         "User-Agent": UA,
+        ...extraHeaders,
       },
@@
-  sessionCache.set(url, { sessionId, initializedAt: now });
+  sessionCache.set(key, { sessionId, initializedAt: now });
@@
-export function invalidateSession(url) {
-  sessionCache.delete(url);
+export function invalidateSession(url, extraHeaders = {}) {
+  sessionCache.delete(cacheKey(url, extraHeaders));
 }
@@
-  const sessionId = options.skipInitialize ? undefined : await ensureSession(url, signal, { forceFreshSession: options.forceFreshSession === true });
+  const sessionId = options.skipInitialize ? undefined
+    : await ensureSession(url, signal, { forceFreshSession: options.forceFreshSession === true }, extraHeaders);
@@
-    invalidateSession(url);
-    const newSessionId = await ensureSession(url, signal);
+    invalidateSession(url, extraHeaders);
+    const newSessionId = await ensureSession(url, signal, {}, extraHeaders);
```
- **回归断言**：同 URL + 不同 `X-API-Key` 的两次 sessionful `mcpCall` 触发 **2 次 initialize**、tools/call 带不同 session id；keyed 调用的每个 initialize/notification/重试 initialize 都带 `X-API-Key`；`invalidateSession(url,hdrs)` 只删对应键。

### N5 · [P1 / A] 3b 混合故障 fail-open 重打已限流端点
- **现状**：`provider.js:311` `else if (cooled.size > 0 && [...cooled.values()].every(e => e?.rateLimited === true))`；只要有一个「普通故障冷却」混进 `cooled`，整个快速失败分支被跳过，走 `cooled.clear()` 全量重跑。
- **影响**：与紧邻注释「Re-issuing the fan-out would hit the same limited endpoints and burn more quota」直接矛盾；共享配额端点被重复 429 打，放大限流窗口，拖累尚可用后端。
- **证据**：真 provider 播种 a=429（rateLimited, cooled）、b=3×500（非 rateLimited, cooled），第 4 次 search 的 `deltaA=1`（重打 a）、`deltaB=1`；错误为 `all enabled backends failed (2)` 而非快速失败。
- **最小修法 diff**：
```diff
-      else if (cooled.size > 0 && [...cooled.values()].every((e) => e?.rateLimited === true)) {
-        const until = Math.max(...[...cooled.values()].map((e) => e?.cooledUntil ?? 0));
+      else {
+        const limited = [...cooled.entries()].filter(([, e]) => e?.rateLimited === true);
+        if (limited.length === 0) { cooled.clear(); }
+        else {
+        // Keep rate-limited backends cooled; fail-open only the others.
+        for (const [id] of limited) {
+          const c = candidates.find((x) => x.id === id);
+          if (c) cooled.delete(id);
+        }
+        const until = Math.max(...limited.map(([, e]) => e?.cooledUntil ?? 0));
         const waitS = Math.max(0, Math.ceil((until - nowMs) / 1000));
-        throw new WebError(
-          `unified search: all backends are rate-limited; retry after ~${waitS}s`,
-          "WEB_PROVIDER_ERROR",
-        );
-      } else {
-        // Non-quota outages keep the existing fail-open behaviour so a
-        // breaker can never make search worse than no breaker.
-        cooled.clear();
+        // Retry only non-limited backends; if none remain, fail fast.
+        if (eligible.length === 0) throw new WebError(
+          `unified search: all backends are rate-limited; retry after ~${waitS}s`, "WEB_PROVIDER_ERROR");
+        }
       }
```
（更简洁的等价实现：`eligible = candidates.filter(c => !isCooled(...) || !latestBackendHealth.get(c.id)?.rateLimited)`，再对 `eligible.length===0` 抛快速失败。）
- **回归断言**：混合冷却（a=429、b=500×3）第 4 次 search 只调用 b，`deltaA=0`；全 429 仍 0 调用快速失败；全普通故障仍全量 fail-open。

### N6 · [P2 / A] `redirect:"follow"` 的 `MAX_REDIRECTS` 永不生效
- **现状**：`egress-fetch.js:106` `return egressFetch(next.href, nextInit)` 调顶层入口，`depth` 重置为 0；`depth < MAX_REDIRECTS` 恒真。
- **影响**：注释承诺「bounded redirect:follow」；20 跳链发 42 次请求、无限链不终止。当前 11 个调用点全 `redirect:"error"` → 线上不可达，故列 P2。
- **修法**：`return tunneledFetch(next.href, nextInit, proxy, depth + 1)`（并保留 `proxyFor` 的重算或显式传 proxy）。
- **回归断言**：12 跳链 `redirect:"follow"` → ≤6 次请求后抛「too many redirects」；无限链有限时间内终止。**[A]**

### N7 · [P2 / A] `ws.register` disposer 全部丢弃
- **现状/证据/修法**：见 §4 表格。官方契约已定位；3 处 `ctx.effect(() => webCtx.webServer.register(route), …)` 即可。实测二次注册抛 `duplicate` 确证清理缺失。**[A/B]**

### N8 · [P2 / A] `multiQuery` 在多数「复杂查询」上静默空转
- **证据/修法/断言**：见 §4 `isComplexQuery` 行。`deriveSubQueries` 的分隔符正则与 `COMPLEX_MARK_RE` 不对称；`isComplexQuery("柔和光线")=true` 但 `deriveSubQueries` 单变体。修法：让切分正则不吞掉分隔符两侧实体，并让 gate 与切分共用同一判定；回归断言 `deriveSubQueries("A 和 B").length > 1`、`deriveSubQueries("柔和光线").length===1` 且 `isComplexQuery` 为 false。**[A]**

### N9 · [P2 / A] `settings-api.sanitize()` 回显 host 内部路径 / `safeFailureReason` 诊断归零
- **证据**：`mutate` 抛 `Error("INTERNAL /home/dsh/secret/path SECRET_REF_NAME")` → 400 body 原样含该串；`safeFailureReason` 对 4 种 key 写失败全返 `"write rejected"`；`discard()` 不清 `readErrors`；`describe` 返回 `{ok:true,value:{}}` 时静默显示「未配置」无告警（61 D4/D5）。
- **修法**：`sanitize()` 改为固定码白名单 + `t()` 文案；`writeCredential` 抛带稳定 `code` 的错误；`discard()` 清 `readErrors/failedFields`；`view===undefined && !readFailed` 记 `credential/absent`。
- **回归断言**：host 错误串不出现在任何响应体；4 种失败映射到 4 个固定码；`discard()` 后 `readErrors.size===0`。**[A]**

### N10 · [P2 / A] `resultHeader:false` 契约静默删除 + `opts.cause` 死参数 + 新 code 不上抛 seam
- `provider.js:457/503` 去掉 `opts.resultHeader !== false` 门控，注释改成「always prepended」；Config 无 `resultHeader` 字段、README 未记载 → 旧配置静默失效（P3）。`web-error.js` 的 `opts.cause` 11 处全未传（P3）。`RATE_LIMIT`/`QUOTA` 只在内部 breaker 消费，全失败/3b 外层恒 `WEB_PROVIDER_ERROR`，`harnessErrorCode()` 只读最外层 → seam 级重试策略零影响（P2 语义缺口）。**[A/B]**

---

## 6. 已确认无误

1. **[A]** 44/44 `src-work/plugin` ↔ 安装副本逐字节一致；23 个非空 diff 全部可追溯到 `.orig`。
2. **[A]** `webErrorFromResponse` 11 处调用实参、`instanceof WebError`、cause 链、`response.text()` 后 header 可达、`403` 不再误判 QUOTA。
3. **[A]** `rateLimited` 结构化分类、`retryAfterMsFrom` 12 类边界、`foldBreaker` 过期窗口重置。
4. **[A]** `collect()` try/catch 在本地真 socket 上把 3 类 `Response` 构造异常转为 reject。
5. **[A]** `client.save()` 快照前置、`editKey` 空草稿、`writeQueue` 串行、`setToggle` 失败 resync、`readCredential/writeCredential` 的 `ok:false` 处理；vm 中 13/13 断言通过。
6. **[A]** `numResults = min(hostCap,userMax)` 7 组边界；3b 全 429 快速失败 0 调用。
7. **[A]** 10 处 `*ApiKeyEnv` grammar 与官方 `credentialRef` 完全一致；`findPluginRow` id 优先 + shape≥2。
8. **[A]** `history.clear()` 与 `record()` 串行化；`parseEnvelope` 的 BOM/SSE 多帧/CRLF/batch/多行 data 主路径。
9. **[A]** `parseEnvelope` 的 SSE「挑 id 匹配且带 result/error 的帧」确实修好了「通知帧 + 响应帧」的旧拼接 bug。
10. **[B]** `trust.js` 的 `rejectionFor` 有结构性兜底，`connectionAdmissionView` 未被删除导出影响。

## 7. 无法验证（诚实边界）

1. **[D]** 真实第三方 MCP 服务端是否真的在 SSE 单流里混入 initialize 形状帧 / 回显别人的 id；本地用行为级 fake 端点复现了代码路径，未对公网发请求。
2. **[D]** 真 API key 下 TinyFish keyed 握手是否 401；请求头缺失已确证，服务端反应未观测。
3. **[D]** 真实上游 `Retry-After` 是否发 hex/指数/超长 http-date；单元边界已覆盖。
4. **[D]** 生产限流窗口内「全部后端同时 429」；真 provider 用注入的 health Map 复现。
5. **[D]** 浏览器 DOM 里 METERED 分区 / `readErrors` 提示的像素级渲染；仅代码链路 + vm 状态机验证。
6. **[D]** 跨进程 history/cache 并发写（模块内 `writeChain` 只保证进程内）。
7. **[D]** 本文件第 1 版（被并发覆盖的 85 行「Lead 补完」稿）来源与写入时序；仅观察到其内容与复现冲突。

## 8. 5 条反直觉

1. **[A]** **「修 stream 释放」反而把 413 删了**：`.orig` 的超限路径只是 `removeAllListeners("data")` 就能返 413；本轮为「不等 end」补的 `req.destroy()` 让 socket 直接消失，客户端从 413 变成 `ECONNRESET`。删一行即恢复，加一行即回归。
2. **[A]** **注释里列进 cache key 的选项，恰恰一个都不在 `opts` 顶层**：`cache.js` 明写含 `safeSearch` / per-backend baseURL / models，`provider.js` 遍历的是 `Object.entries(opts)`，而这些值全在 `opts.backends[id]` 内 → 「纳入了」在代码文本上成立、在运行时恒为空。唯一真正起作用的新增维度是 8 个全局项。
3. **[A]** **`.every(rateLimited)` 越保守越会重打限流端点**：只要混进 1 个普通故障冷却，整条快速失败分支被跳过，`cooled.clear()` 把刚 429 的后端重新放进 fan-out；实现与紧邻注释要防的场景正好相反。
4. **[A]** **给 plain-JSON「去掉 id 校验」的容错，把 SSE 的 id 校验也变成了不对称**：SSE 用严格 `===`（拒 `id:"1"`、拒无 id 帧），plain 却连 `id=7` 都收；`skipInitialize` 又把 tools/call 的 id 改成 1，与 initialize 的 id=1 撞车——「对齐官方裸 tools/call」的注释恰好说反了哪一方共享 id。
5. **[A]** **`multiQueryEnabled=true` 且 `isComplexQuery=true` 时，扇出次数可能仍是 1**：`A 和 B` / `what is X vs Y and Z` 被分隔符正则整词吞掉，`deriveSubQueries` 返回 `[原查询]`，RRF 单列表不改变顺序；而 `foo; bar` 能切出 3 变体却被 gate 判为不复杂。门控与切分用的是两套不一致的判定。

## 9. 结论

**证伪成立：35/44 文件里仍存在未修 P0/P1。** Lead「全量审计已干净、无未修 P0/P1」在代码层**不成立**。

- **P1（5 条）**：N1 `readBody` 413 回归、N2 cache 键漏后端级设置、N3 MCP id 串包、N4 sessionCache 键控 + keyed 握手缺鉴权、N5 3b 混合故障 fail-open。
- **P2（5 条）**：N6 redirect 递归、N7 ws.register disposer、N8 multiQuery 空转、N9 sanitize/safeFailureReason 诊断、N10 resultHeader 契约删除 + 新 code 不上抛 seam（另含 §4 的 D3/D4/D5/D8）。
- 其中 **N1 是本轮补丁新引入的回归**（基线正确、现状错误），**N2/N3/N4/N5 是 64 号明确「标 E / 需用户批准 / 不采纳」而实际已达 P1 的项**。
- 每条均附现状、影响、最小修法 diff 片段与回归断言；全部 `node` 复现脚本在 `/tmp/65-shim/work`，运行后删除，不触碰运行时。
