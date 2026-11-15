# 86 · 选择性借鉴评估（独立技术顾问 B1：只评估与规划）

> **⚠️ 22:40 版本订正（[91 号](91-s1-corrections.md)）**：本号凡写「上游 2.8.8 的 forwarder/ddg 8s」应改为 **2.8.6**；「升级 2.8.8 覆盖 11/23 文件」结论不变（那是 2.8.4→2.8.8 累计差异）。
> 交付时间 2026-11-15 22:18 +08:00。本轮**唯一写文件**即本文件；未写任何源码、未改运行时、未改配置、未操作任务板、未改其它报告。
> 取证：本地 `read/grep/glob` + 认证 GitHub REST API（只读，token 从 `/opt/xr-research/zcode-research/.git/config` 内联读取，**值未输出、未落盘**）+ `web_fetch` / `web_search` + 本地只读 `node -e` 实验。
> 独立性：本文件是 B1 的独立结论。落盘骨架后被并行写入过一版正文，本次按 B1 一手证据重写并**显式标出需要更正的既有口径**；与 [83](83-peer-projects.md) / [84](84-lead-peer-leads.md) / [87](87-borrow-adversarial.md) 冲突处以本文件的一手证据为准。
> 对象：`@240xu/dsh-websearch@2.8.4` + 35 文件补丁，13 后端并发 fan-out → RRF → 去重 → maxResults；磁盘缓存 TTL 900s；per-backend 熔断；3b 全配额冷却快速失败；history/health/settings API；MCP streamable-http；错误契约 route on code。唯一残留 P1 = D5 跨会话干扰。

## 0. 证据分级与本案方法

| 级 | 含义 | 本案典型 |
| --- | --- | --- |
| **A** | 本地源码/类型定义/只读 API/运行时实验直接可复现 | `provider.js:57` 模块级 Map；`WebSearchRequest` 无 sessionID；`new Response(status:432)` 可承载 |
| **B** | 官方合并状态 + 一手材料交叉印证 | PR #47334 merged、Issue #60176/#58327 open、Tavily 官方 432/433 文档 |
| **C** | 单来源或合理推断，未二次核验 | 「优先队列可选模式」的 GUI/缓存键代价推算 |
| **D** | 任务背景给定的既成事实，本次未独立复核每项 | 80/80 单测、35/35 一致、服务 PID 566981 |
| **E** | 搜不到 / 只读到 README 未见源码，不臆断 | 本轮**没有**把任何同类项目留在 E（见 §6/§7 的例外说明） |

置信度标在每条结论尾部。方法上先读本地实现与官方 seam 类型，读 PR diff 与仓库源码树，再判断「适不适合我们」，避免把搜索摘要当实现证据。

---

## 1. 选择性抄取清单 Top 5

| # | 机制（一手证据） | 来源 URL / PR#（等级） | 为什么适合我们（必须结合 D5 / 3b 混合故障 / 可观测性 / MCP 鉴权 / 缓存键 / 错误契约） | 最小落地步骤（文件级，不写完整代码） | 回归断言思路 | 风险与代价 |
| --- | --- | --- | --- | --- | --- | --- |
| **1** | **状态职责拆分 + per-query `attempted` 局部集合**：PR diff 原文 `const cooldowns = new Map<ID,{until,error}>()`（全局）、`const preferred = new Map<Session.ID\|undefined,{provider?}>`（按会话）、`Effect.addFinalizer(() => preferred.clear())`、订阅 `SessionEvent.Deleted/Moved` 清理；**更关键**的是 `query()` 内 `const attempted = new Set<ID>()` 是每次调用的局部变量，`while(true)` 只用 `cooldowns` 全局 + `attempted` 局部。签名 `query(input,{sessionID?,onProvider?})`。 | [anomalyco/opencode PR #47334](https://github.com/anomalyco/opencode/pull/47334)（**A/B**：API 实测 `merged=true`、`merged_at=2026-09-06T21:39:48Z`、18 文件/5 commits/1360 增/175 删；diff 原文见 `packages/core/src/websearch.ts`、`packages/core/src/tool/plugin/websearch.ts`；PR body 自述 54 core tests 覆盖 shared cooldowns / concurrent initial+fallback / late successes / in-flight cleanup） | **直击 D5 与 3b 混合故障**：本地 `lib/provider.js:57` 的模块级 `latestBackendHealth` 一张 Map 同时承担「服务端限流事实（全局，应共享）」与「本次 search 的失败判定（应局部）」；`:319-357` 的 3b 在开始扇出**之前**读这张全局表，所以会话 A 全 429 → 全健康的会话 B 被 `all backends are rate-limited` 零调用拒绝。PR 的结构给出正确分层：**全局只放冷却事实，判决只用本次调用的局部集合**。同时保住 D8 可观测性（`health.js:68-70` 的 `rateLimited/keylessRejected/cooledUntilMs` 继续读全局）与 3b 原有保护（同一次调用内连续两次全配额失败仍快速失败）。**不抄** `Session.ID`：官方 seam [types.d.ts:14/114](/opt/dsh-0222/node_modules/@deepseek-ai/dsh-web/lib/types/types.d.ts) 的 `WebSearchRequest` 只有 `query/maxResults`，`search(request, signal)` 不传 sessionID；`lib/index.js:498` 是单例 `createUnifiedSearchProvider` + `:514 ctx.web.registerSearchProvider(provider)`（**A**）。 | ① `lib/provider.js`：保留 `latestBackendHealth` 为**唯一全局冷却/遥测事实**；在 `search()` 内构造本调用的 `attemptedQuota = new Map()`（局部，函数结束即回收，无需 sessionID、无需清理事件、无内存泄漏）。② 3b 的 `rateLimitedCooled` 判定改为只读本调用内 `recordBackendHealth` 刚产生的 `rateLimited/keylessRejected` 分类；预热的全局冷却只用于**跳过单个已冷却后端**（`isCooled` 分支）与 health/history 展示，不再触发整站快速失败。③ 不改 `lib/health.js` / `lib/history.js` / `lib/settings-api.js`、不改磁盘格式、不动 3 个 API 契约、不动 Config schema、不动缓存键。 | 真 provider 行为级：A 连续两次全 429 → 第二次仍 `all backends are rate-limited` 且**零新调用**（保住 3b）；**另起一个 provider.search**（模拟会话 B，全健康 backend）→ 必须真扇出、返回 sources、不被快速失败（修掉 D5）；混合故障：已限流后端零重打、非配额冷却仍 fail-open；`tests/lead-20261109-3b-runtime.test.js` 现有 4 条全绿；全量 `node --test tests/*.test.js` 80→82/82；`g5/refresh.sh` 35/35 逐字节一致；重启后三 API 200。 | **中**：动 `provider.js` 一处核心判决逻辑，需 35 文件同步 + 重启；但**零新依赖、零新状态、零新 API、零磁盘格式变更**。属 P1（需用户点头），是三选一里改动面最小的语义正确解。 |
| **2** | **按错误类别分级冷却，而非只看 429**：modsearch `src/cooldown.ts` 的 `classifyQuota()` 明确把每秒限流（`rate.?limit|too many requests|\b429\b`）**排除**在持久冷却外（返回 null），把 `432/433` 月度预算与 quota/credits/Resets-in 归为 `MONTHLY_COOLDOWN_MS = 24h`，一般配额为 `DEFAULT_COOLDOWN_MS = 45min`；`coolingEntry()`、`coolingEngineEntry()`、`buildCooldownController()`、`updateStateOnDisk()` 用 temp+rename 原子合并并发写入；`src/router.ts` 的 `reorderByCooldown()` **只把冷却引擎移到队尾、不删除**（"A cooling engine is never removed, only reordered"）。 | [liustack/modsearch `src/cooldown.ts`](https://github.com/liustack/modsearch/blob/main/src/cooldown.ts)、[`src/router.ts`](https://github.com/liustack/modsearch/blob/main/src/router.ts)、[docs/troubleshooting.md](https://github.com/liustack/modsearch/blob/main/docs/troubleshooting.md)、[commit `7aef58c`](https://github.com/liustack/modsearch/commit/7aef58c3f0e3e61251407e78fda2263c8b8b7c72)（**A/B**：认证 API 读源码树 + raw 文档；commit message 逐字 `fix(cooldown): put Tavily 432/433 monthly caps on a 24h cooldown`，改 6 文件含 `cooldown.test.ts`/`tavily.test.ts`）。状态语义另见 [OpenCode Issue #60176](https://github.com/anomalyco/opencode/issues/60176)（**A**：open，2026-10-29，Tavily 432 / 其它 402 触发终止）、[Issue #63487](https://github.com/anomalyco/opencode/issues/63487)（**A**：open，2026-11-12，402 零余额）。 | **错误契约 + 3b 混合故障 + 可观测性**：本地 `lib/util/web-error.js:29-36` 只有 `429→RATE_LIMIT`、`402→QUOTA`、`403` 明确不归类；`failure-label.js:17-31` route on code。432/433 会落到 `WEB_PROVIDER_ERROR`，既不会冷却也不会被 3b 当作配额，正是 #60176 的故障。Tavily 官方 [Errors Code](https://help.tavily.com/articles/8645538886-understanding-http-errors) 逐字定义 432 Plan Limit Exceeded / 433 Pay-As-You-Go Limit Exceeded，与 429 Too Many Requests 分列（**B**）；`node -e 'new Response("x",{status:432})'` 实测可承载（**A**），87 号「432 非标准会拒收」的顾虑不成立。可抄的是**分级决策 + 显式保留**：把 432/433 纳入 `QUOTA` 但不扩大 403，冷却时长按类别而非一律 60s，且绝不因冷却把后端从 eligible 永久删除。 | ① `lib/util/web-error.js`：`quota = [402,432,433].includes(status)`，新增 `err.planLimited`（432/433）供分级；② `lib/util/failure-label.js`：`rateLimited()` 补 `432/433` 的 `status` 分支（code 优先不变）；`retryAfterMsFrom()` 保持现有 24h 上限（`MAX_RETRY_AFTER_MS`，`:35`），对 planLimited 无 Retry-After 时给一个独立长默认而非 60s（具体值进 Config，遵守「插件内不硬编码可调项」）；③ `lib/breaker.js` / `provider.js` 的 3b 分支无需改结构；④ `tests/` 加表驱动：402/429/432/433/403 五类 × 冷却/不冷却/文案三列；⑤ README 错误码表补两行。 | `webErrorFromResponse(432) → code==="QUOTA" && planLimited===true`、`403` 仍非 QUOTA、`429` 仍 RATE_LIMIT；`rateLimited()` 对 432/433 true、对 403 false；`retryAfterMsFrom()` 对超限/负值/过去 http-date 仍回退默认（现有 `quota.test.js` 不破坏）；3b 的 keyless 文案不说「retry after」；`node --test` 全绿。 | **低-中**：新增 2 个状态码 + 1 个可调项，需 Config/GUI 文案与 `cacheKeyFor` 的 `resultOptions` 同步（**缓存键**：`provider.js:250-267` 已把结果决定项摊入，新可调项须进白名单，否则 900s 内改设置被缓存掩盖，正是刚修过的 N2 同类问题）。不引依赖。 |
| **3** | **结构化错误契约 + 全失败逐尝试摘要**：OpenCode Issue #58327 指出自定义 provider 的 `execute()` 任何失败都被包成 `ServiceUnavailableError`，`status=429` 丢失，拿不到内置 429→Retry-After→切换链路；诉求是 typed `WebSearch.RateLimited{retryAfter?}`。**正面范例**在 [chendefine/dsh-web-search-aggregation `src/provider.ts`](https://github.com/chendefine/dsh-web-search-aggregation/blob/main/src/provider.ts)（**A**）：`AttemptFailure[]` 记录每次 `position/kind/keyRef/reason`，全失败时 `throw new WebError(\`aggregated search: all N attempts failed — <逐条摘要>\`, "WEB_PROVIDER_ERROR")`，且 `ResolvedKey.value` 注释与 `keys.ts` 的 `maskApiKey()` 保证密钥字面量不进日志/失败记录。 | [Issue #58327](https://github.com/anomalyco/opencode/issues/58327)（**A**：open，2026-10-23，正文含可复现 `e.status=429` 被吞的 fixture）；[aggregation `src/provider.ts` / `src/keys.ts` / `src/config.ts`](https://github.com/chendefine/dsh-web-search-aggregation)（**A**：认证 API 读源码树与文件内容）；[jwilson411/dsh-ssrf-guard `src/ssrf.js`](https://github.com/jwilson411/dsh-ssrf-guard/blob/main/src/ssrf.js)（**A**：`SSRF_DENIED` 稳定 code + `REASONS` 7 个稳定 token，反例是「按 message 分支」）。 | **错误契约 + 可观测性 + MCP 鉴权**：本地已有 11 处 `throw webErrorFromResponse(...)`（`util/mcp-client.js` 2 + 9 个 backend，`grep -c` 实测 11，**A**）、`failure-label.js` 已 route on code，`mcp-client.js:19-26` 的 `sessionCacheKey` 已把认证头摘要入键。缺的是**契约固化与失败可见性**：新 backend 若手写 `new WebError(msg, "WEB_PROVIDER_ERROR")` 就会丢 status，退回 #58327 的困境；`provider.js:159` 的 `failures[]` 已收集硬错但全失败分支（`allFailures`）只给一条聚合文本，审计时看不出哪个后端因何失败。可抄「稳定 code + 逐尝试摘要 + 密钥绝不入摘要」，不抄它的优先队列（见 §2）。 | ① `README.md` 增「新增后端」契约：必须走 `webErrorFromResponse`，禁止手写丢 status 的 WebError；② `tests/` 加一条**静态源码断言**：扫 `lib/backends/` + `lib/util/mcp-client.js` 的 `throw new WebError` 与 `throw webErrorFromResponse` 计数（当前 11），新增裸抛即失败；③ `lib/provider.js` 全失败分支把 `allFailures` 的 `{id, code, status}` 逐条拼进 `WebError.message`（截断 + `sanitizeError()` 风格的脱敏，复用 `health.js:25` 的 `SECRET_PATTERNS`）；④ `lib/health.js` 无需改。 | 11/11 调用点不变；故意新增一个裸 `new WebError` 的 fixture 应使静态断言失败；全 13 后端失败时 message 含每个 id 与 code、不含任何 `sk-`/`Bearer`/`api_key=` 片段（脱敏断言）；`node --test` 全绿。 | **极低**（文档+断言）到**低**（摘要拼接）。纯增量，不动运行时状态机、不动 API 契约、不动缓存键。**这是本轮唯一零风险立刻可做项**（见 §5）。 |
| **4** | **late successes / in-flight cleanup 的测试形态**：PR #47334 body 逐字列 54 core tests，含 `concurrent initial/fallback routing, late successes, and in-flight cleanup on deletion/movement`，测试文件 `packages/core/test/websearch.test.ts` +444 行；diff 里 `const affinity = preferred.get(options?.sessionID) ?? { provider: undefined }` 并注释 "Keep the cell for this query so deletion/movement cannot reinsert an in-flight session's entry"。 | [PR #47334](https://github.com/anomalyco/opencode/pull/47334)（**A/B**：API `files?per_page=100` 实测 `websearch.test.ts +444/-6`、`tool-websearch.test.ts +86/-12`、`retry-provider.test.tsx +280`；PR body 自述测试名）。 | **3b 混合故障 + D5 + 可观测性**：本地 `runBackend`（`provider.js:379-435`）用 `createLimiter` + `AbortController` + `effectiveBackendTimeoutMs`，`:438 Promise.allSettled` 收集；`createLimiter` 的 `.then(fn)` 注释（`:110-114`）记录过同步抛出导致 `running` 泄漏的实修（A.7）。但**没有**「超时后迟到的成功」的显式断言：一个在 `controller.abort()` 之后才 resolve 的 backend，其 `recordBackendHealth(...ok:true)` 是否污染 health/history/缓存，没有测试钉住。这正是 D5 类「共享状态被错误写入」的近亲，且 `health.js` 是只读全局表面，写错会污染下一次 3b 判决。 | ① `tests/lead-20261107.test.js`（或新建 `tests/lead-20261115-late-success.test.js`）加一条：fake backend 在 `setTimeout` 后 resolve 且忽略 signal，用极小 `backendTimeoutMs`，断言 sources 不进 merged、`getLatestBackendHealth()` 无 `ok:true`、`history` 不记成功、limiter 无 pending；② 若暴露真问题，只在 `provider.js` 的 `.then(value => ...)` 加 `if (controller.signal.aborted) return` 早退（一行级）。 | 迟到成功不写 health 成功、不进 `collected`、不进 history、不留 `running` 计数；现有 80 条不破坏；断言本身不是「读源码字符串」的自指假绿（历轮 65/68 号反复修过此类）。 | **低**：只加测试；若暴露真问题再修一行。**依赖**：与 #1 同一份 `provider.js`，建议合并同一次改动窗口，避免 35 文件同步做两遍。 |
| **5** | **来源 URL 的显式拒绝条件清单（后过滤，而非出网边界）**：verified-search `src/domains.ts`（**A**）`SearchFilterError.code = "VERIFIED_SEARCH_INVALID_FILTER"`，`normalizeAllowedDomains()` 拒绝空/空白/非 ASCII/含 `://`/含 `\/?#@:*`/IP 字面量/标签非法/超过 20 个域；`sourceMatchesDomain()` 拒绝非 http(s)、拒绝 `url.username/password`、按精确或 `.domain` 后缀匹配；`filterAllowedSources()` 返回 `{sources, filteredOut}` 供可观测。README:102 逐字 **"It is not a network-egress or privacy boundary"**，:148 列 invalid hostname allowlists / credential-bearing URLs / unsafe redirects / non-public resolved addresses / malformed charset 等显式失败。ssrf-guard `src/ssrf.js` 自述 **"The hostname is checked as written, not as resolved... this is an allowlist rather than DNS-rebinding protection"**，用 `SSRF_DENIED` + 7 个稳定 reason token。 | [f0909172434/dsh-plugin-verified-search](https://github.com/f0909172434/dsh-plugin-verified-search) → **301 重定向**到 [Chih-Kai-Wang/dsh-plugin-verified-search](https://github.com/Chih-Kai-Wang/dsh-plugin-verified-search)（**A**：认证 API `location: https://api.github.com/repositories/1333467274`，`full_name=Chih-Kai-Wang/dsh-plugin-verified-search`，`license=MIT`，pushed 2026-11-08，源码树含 `src/domains.ts` + `lib/index.js`）；[jwilson411/dsh-ssrf-guard](https://github.com/jwilson411/dsh-ssrf-guard)（**A**：MIT，`src/ssrf.js`）。 | **错误契约 + 缓存键 + MCP 鉴权**：本地 `provider.js:149` 的 `collectFanoutResults` 只做 `/^https?:\/\//i` 白名单，`:272-274` 缓存命中也复用了同一白名单（防篡改缓存），`:390-394` 的 baseURL trust gate 拒绝 credentials-in-URL 且只允许 RFC1918 plain-http。缺的是**返回来源**这一层的系统化拒绝条件与计数：credential-bearing source URL、IP 字面量、非 ASCII host 都应显式失败并可观测，而不是静默丢弃。可抄的是**清单与稳定 code**（对齐 §1#3 的错误契约），不是它的 DNS/IP 解析与 pinned transport（那需要改网络层）。**注意缓存键**：`filteredOut` 若影响返回条数，必须成为 `cacheKeyFor` 的结果决定项，否则 900s 内改 allowlist 被旧缓存掩盖。 | ① `lib/provider.js` 在 `collectFanoutResults` 旁新增纯函数 `isSafeSourceUrl(url)`（只做字符串/URL 解析层：scheme、credentials、host 形态），逐项列拒绝条件 + 稳定 code；② 过滤计数进 telemetry/`history` 的 additive 字段（不动 3 个 API 契约形状）；③ 若 allowlist 成为 Config 项，同步 `provider.js:250-267` 的 `resultOptions` + GUI + 回滚链；④ `tests/` 表驱动正反例。 | 每条拒绝条件有正反例；`javascript:`/`data:` 仍不进模型/GUI；带 `user:pass@` 的来源被拒；合法内网 SearXNG 的 **baseURL** 不被误伤（现有 `lead-20261106.test.js` trust gate 断言保持绿）；改 allowlist 后缓存键变化时不被 900s 旧缓存掩盖。 | **中**：① 扩大拒绝面可能误伤自托管结果（我们 trust gate 专为它开）；② 需要 Config/GUI/缓存键/回滚链同步则代价跳到 P2；③ **只读「清单+稳定 code」** 才是 P1 内的安全子集。 |

---

## 2. 明确不该抄（≥3，逐条理由）

| # | 项 | 理由（含等级） |
| --- | --- | --- |
| **N1** | **升级到上游 `240xu/dsh-websearch` 2.8.8 拿 forwarder hop / ddg 5s→8s** | 本地补丁已含等价/更完整修复：`provider.js:40-43` `BACKEND_TIMEOUT_OVERRIDES_MS = {ddg:8000, searxng:8000}` + `effectiveBackendTimeoutMs()` 取 min（**A**）；`egress-fetch.js` 三条出口路径 + Host 补正，见 [99 号裁决 1](99-final-verdicts.md)（**A/D**）。升级覆盖 **11/23** 个被改文件、逐字节相同 0 个（**D**：任务背景 + E2/74 号），会重新引入 N1–N4、3b、D8、disposer。**覆盖本地修复**。 |
| **N2** | **`chendefine/dsh-web-search-aggregation` 的优先队列 ordered fallback 直接替换全并发 RRF** | 源码实证（**A**）：`src/provider.ts` 的 `search()` 是 `for (const entry of entries) ... if (outcome.ok) return outcome.result` —— **首个成功即胜**；`src/config.ts` 的 `resolveConfig()` 还用 `seen` 保证每个 kind 最多入队一次。我们是 `provider.js:438 Promise.allSettled` 13 后端并发 + `:484 rrfFuse`，单后端失败不影响整体。替换会破坏 `rrfFuse`/`dedupeSources`/`backendsOk/Total` 语义与 80 条测试（**与全并发 RRF 取舍冲突**）；要做只能是新增可选模式，且需 Config 新字段 → GUI 双字典 → `cacheKeyFor` 的 `resultOptions`（顺序变化必须入键）→ 35 文件回滚链，代价远超收益（**C**）。 |
| **N3** | **PR #47334 的 Effect / Stream / KV / `Session.ID` 实现照搬** | 它是 TypeScript + `effect` 的 `Layer.effect`/`Bus.subscribe`/`Stream.runForEach`/`KV`（**A**，diff 原文），我们是零依赖 ESM 插件（package.json 无 dependencies 段、`type: module`，**A**）。照搬**引入重依赖**并改 `ctx.effect` 生命周期语义；且官方 seam `WebSearchRequest` 只有 `query/maxResults`（**A**，`/opt/dsh-0222/.../types.d.ts:14`），`search(request, signal)` 不传 sessionID，`Map<Session.ID\|undefined,...>` 会全落到 `undefined` 单键 ⇒ **D5 不修反增复杂度**。只抄「状态职责拆分」的设计意图（§1#1），不抄 API 签名。 |
| **N4** | **`liustack/modsearch` 的 bundle 两个 patch op 替换整行 `id: web` config** | 需改为「可抄的反例/正面范例」精确表述：modsearch 的 `cordis.patch.yml` **逐字 restate 了 `fetchProvider: http`**（**A**，认证 raw 全文），并在注释里写明「patch row replaces the targeted row's whole config... dropping the fetch pin makes web_fetch ambiguous (#43)」——它**正是我们该抄的防御写法**。真正缺 `fetchProvider` 的是本机 `@240xu/dsh-websearch@2.8.4` 自带的 13 行 patch（`grep -c fetchProvider` = **0**，只有 `searchProvider: unified`，**A**），这才是 [24/99 号](24-p0-landing-correction.md) `WEB_PROVIDER_AMBIGUOUS` 的根因。⇒ 87 号「替换整行会抹掉 fetchProvider」把**归因对象写反了**；结论仍是不抄：把 `searchProvider` 指向 `modsearch` 会绕开我们 `id:"unified"` 的单一注册（避免 `WEB_PROVIDER_AMBIGUOUS` 的设计前提）。 |
| **N5** | **把 Issue #60176 / #58327 / #63487 当「已验证实现」抄** | 三者 GitHub API 实测均 `state: open`、`closed_at: null`（**A**：#60176 2026-10-29、#58327 2026-10-23、#63487 2026-11-12）。它们是**别人还没修的抱怨**，可抄的是「按 code 轮换 / 结构化上报 / 402  actionable 文案」的设计意图，不是实现。谁写成「上游已实现」就是臆断。 |
| **N6** | **verified-search 的 DNS/IP 解析、pinned transport、unsafe redirects 全套** | 其 README:156 明写实验性 full-page reader 才做 DNS/IP validation、pinned transport、redirect checks；我们 `egress-fetch.js` 走代理/CONNECT 三条出口，做真校验要**改网络层**（**A**）。更关键：README:102 明写 allowlist **"is not a network-egress or privacy boundary"**，87 号把它当 SSRF 出网边界是误读（**A**）。而「non-public resolved addresses 一律拒」会打死我们为自托管 SearXNG 专门开的 RFC1918 plain-http trust gate（`provider.js:390`，**A**）。只抄返回来源的字符串层清单（§1#5）。 |
| **N7** | **`modsearch` 的持久化 `~/.modsearch/state.json` 冷却 store** | 源码（**A**）：`currentStatePath()` + `0600` + temp/rename + 并发合并 + per-key `::key:N` 很扎实，但我们是**插件运行在 DSH_HOME 下、单进程单例**，已有内存 Map + 磁盘结果缓存（`cache.js`）+ history ring（`history.js`）。再引入第二份持久状态会新增磁盘格式、清理 API、跨进程一致性、回滚链 4 项维护面，且 `state.json` 里 `reason` 存的是上游错误文本（虽经 `redactSecrets()`）⇒ 与「错误契约 route on code、不按 message 分支」相冲突。抄**分类语义**（§1#2），不抄存储。 |

**许可证说明（纠正 87 号「全部 E」）**：认证 GitHub API 实测 7 个仓库元数据（**A**）——`anomalyco/opencode`(MIT, 226981 star)、`liustack/modsearch`(MIT, 989, pushed 2026-11-15)、`chendefine/dsh-web-search-aggregation`(MIT, 3)、`Chih-Kai-Wang/dsh-plugin-verified-search`(MIT, 301 后的真实 owner)、`jwilson411/dsh-ssrf-guard`(MIT, 0)、`CharlotteN7/dsh-netguard`(MIT, 0)、`unera/dsh-websearch`(MIT, 2)、`240xu/dsh-websearch`(MIT, 9)。**均读到 LICENSE 字段，不再是 E**；但本轮全部只抄设计意图/清单，不复制任何代码，规避跨库许可证兼容性问题（**C**）。

---

## 3. D5 修法三选一裁决

### 3.1 决定性前提（A 级，先于选择）

| 事实 | 证据 |
| --- | --- |
| `latestBackendHealth` 是**模块级单 Map**，被 health 路由、3b 判决、breaker 三处共用 | `lib/provider.js:57`、`:60-62 getLatestBackendHealth()`、`:64-77 recordBackendHealth()`、`:319-357` 3b 判决；`lib/health.js:47-48` 读它；`lib/breaker.js:31` 状态就存在同一 entry 上 |
| 3b 在**扇出之前**读全局表并 `throw`，所以零后端调用 | `provider.js:341-357`，`tests/lead-20261109-3b-runtime.test.js:64-70` 行为级实证（第二次 search `calls.length===0`） |
| **官方 seam 不提供 sessionID** | `/opt/dsh-0222/node_modules/@deepseek-ai/dsh-web/lib/types/types.d.ts:14` `WebSearchRequest {query,maxResults}`；`:114 search(request, signal)`；本地 `provider.js:198 async search(request, signal)`；`index.js:498` 单例 + `:514 ctx.web.registerSearchProvider(provider)` |
| PR #47334 的 `cooldowns` 全局 / `attempted` **per-query** | PR diff `const attempted = new Set<ID>()` 在 `query()` 体内；`cooldowns` 在 layer 顶层 |

⇒ **② 的字面形态（`Map<Session.ID|undefined,...>`）在本插件里会退化成单键 `preferred.get(undefined)`：把全局 Map 改个名字，D5 一点没修。** 86 号文首「22:20 更正（A2 终版）」指出「单进程单例下缺少可注入的会话 ID」是**对的**；但它进一步推到「② 只能作为前置设计、D5 复议为产品语义取舍」则**不必要**——PR 自己给了不依赖 sessionID 的那半：`attempted` 是 per-query 局部。

### 3.2 裁决：**选 ③，并用 ② 的语义来定义 ③ 的边界**

> **裁决**：③「3b 只用本次 search 内产生的失败」为落地形态；②「分离全局冷却事实与会话/调用级失败判定」为它必须满足的语义约束。① 明确否决。

| 方案 | 裁决 | 理由 |
| --- | --- | --- |
| **① 整个 health 按 session 隔离** | **否决** | 限流是服务端事实，A 被 429 时 B 也该在 health 里看到 `rateLimited/cooledUntilMs`（D8 可观测性）；且 `health.js`/`history.js` 是全局只读 API，隔离会破坏契约与 80 条测试。 |
| **② 分离全局冷却与会话偏好（照 PR #47334）** | **语义采纳 / 字面形态否决** | 「全局冷却事实 vs 调用级失败判定」这一分层**正是 D5 的根因解**，必须采纳；但 `Session.ID` 无处注入（§3.1），照抄会退化单键。 |
| **③ 3b 只用本次 search 内产生的失败** | **选为落地形态** | 无需 sessionID、无需新增持久状态、无需清理事件、无内存泄漏；`attempted` 局部集合天然随 `search()` 返回回收。 |

### 3.3 对 ③ 的两条既有反驳的逐条回应

- **「会让上一次搜索刚把全部后端打进冷却、本次还没发请求时失去快速失败保护，退回 V3 前全冷却 fail-open 重打限流端点」**（86 号 §3 原文）：**不成立**。现有 `provider.js:323-330` 的 `isCooled(entry, nowMs)` 分支**仍然全局生效**——被 429 冷却的后端在 `cooled` 集合里，`rateLimitedCooled` 也照记；`:336-340` 的 `failOpen` 明确把 `rateLimited === true` 的冷却后端**排除**，`:128-129` 的「混合故障零重打」行为级测试就是这条分支。③ 只改**整站 `throw` 的触发源**，不改「跳过单后端」。⇒ A 连续两次全 429 仍然零新调用；B（新 search，全健康）不再被 A 的全局表连坐。
- **「没有 sessionID 就没法做隔离」**：不需要。隔离的对象是**「本次 search 的失败判定」**，不是「会话」；PR 的 `attempted = new Set<ID>()` 就是同一答案。D5 的症状（A 的 429 让 B 零调用）来自跨调用读取，切断读取即可。

### 3.4 最小改动文件（文件级，不含完整代码）

| 文件 | 改动 |
| --- | --- |
| `lib/provider.js` | **唯一运行时改动**：`search()` 内新增本次调用的局部 `attemptedQuota = new Map()`；`recordBackendHealth` 的 `{rateLimited, keylessRejected, retryAfterMs}` 同时写入这个局部集合；`:341-357` 的 3b `throw` 判定改读局部集合（全局 `latestBackendHealth` 继续供 `isCooled` 跳过、health/history 展示、breaker fold）。**不新增模块级 Map、不改缓存键、不动 Config、不动 3 个 API、不动磁盘格式。** |
| `tests/lead-20261109-3b-runtime.test.js` | 加 2 条：① 双 search 互不干扰（A 全 429 → 新 provider.search 全健康仍真扇出）；② 同一 search 内二次全配额仍快速失败（保住 3b）。现 4 条全绿。 |
| `tests/lead-20261107.test.js` | §1#4 的 late-success 断言（可与同一改动窗口合并）。 |
| `g5/` + 发布仓库分支副本 | `bash g5/refresh.sh` 重新生成 37 段补丁并验收 35/35 逐字节一致（**不新增文件、不改回滚链结构**）。 |

**明确不动**：`lib/health.js`、`lib/history.js`、`lib/settings-api.js`、`lib/cache.js`、`lib/breaker.js`、`lib/util/*`、`cordis.patch.yml`、任何 GUI/字典、任务板。

### 3.5 验收命令（真实路径，均为只读或测试；不执行运行时变更）

```sh
P=/home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch
cd "$P" && node --test tests/*.test.js                      # 80/80 → 82/82
cd "$P" && node --test tests/lead-20261109-3b-runtime.test.js   # 3b 现存 4 条 + 新增 2 条
bash /home/ova/dsh/.artifacts/websearch-research/g5/refresh.sh  # 37 段 + 35/35 byte-identical
# 重启服务后（用户批准才做，本轮不执行）：
curl -fsS http://127.0.0.1:3080/api/unified-search/health        | jq '.ok, .backends[0].rateLimited'
curl -fsS http://127.0.0.1:3080/api/unified-search/settings      | jq '.ok'
curl -fsS http://127.0.0.1:3080/api/websearch/history            | jq '.ok'
```

**D5 行为级验收判据**（写进新测试，非人工）：A 全 429 后**另一个 `provider.search()`**（全健康 fake backend）返回 sources 且 `calls.length > 0`；A 自身第二次仍 `all backends are rate-limited; retry after` 且 `calls.length === 0`。

---

## 4. 优先级与依赖

| 级 | 项 | 依赖 / 门槛 |
| --- | --- | --- |
| **P0（零风险立刻可做）** | **§1#3 的文档契约 + 一条静态断言**：README 写明「新增后端必须走 `webErrorFromResponse`、禁止手写丢 status 的 WebError」，加一条断言钉住 11 处调用点（把 #58327 的教训固化成契约）。**纯文档 + 测试，零运行时改动、不破坏 80/80、不需重启、不需用户点头。** | 无。`g5/refresh.sh` 已落地（**A**，21:52 可读），README/测试改动需随下次 35 文件同步一并刷新，但不阻塞。 |
| **P0（并列，零风险）** | **§1#4 的 late-success 测试**（只加测试，不改实现）；若暴露真问题再升 P1。 | 与 §3 的 `provider.js` 同一文件，建议合并窗口以省一次 35/35 同步。 |
| **P1（需用户点头）** | **§3 的 D5 修法（选 ③ + ② 语义）**：动 `provider.js` 核心判决 + 2 条行为级测试 + 35/35 同步 + 重启。**理由**：核心状态语义变更，历轮约定需用户决定（[REPORT.md](REPORT.md) §「D5 跨会话功能性干扰重裁为 P1 待用户决定」）。 | 依赖用户授权 → `g5/refresh.sh` → 重启 → 三 API + `web_search` 复跑。 |
| **P1（需用户点头）** | **§1#2 的 402/432/433 分级冷却**：若新增可调冷却时长，必须同步 Config schema、GUI 双字典、`cacheKeyFor` 的 `resultOptions`（**缓存键**：N2 刚修过同类），代价从「低」升到「中」。 | 依赖用户点头 + 上游 432/433 在**我们实际 Tavily 响应**中确认（官方定义已 B 级，本地是否真收到仍 E）。 |
| **P1（需用户点头）** | **§1#5 的字符串层来源 URL 清单**：只抄清单 + 稳定 code、不动 DNS/网络层；若扩大到 Config allowlist 则升 P2。 | 依赖确认「不误伤内网 SearXNG」（现有 trust gate 断言）。 |
| **P2（打磨 / 产品决策）** | 优先队列做成**可选模式**（`fallbackOrder` Config + GUI + 缓存键含顺序 + 回滚链 + 快照）；全失败逐尝试摘要（§1#3 的第③步）；modsearch 式持久化冷却 store（N7 已否决，列此仅作对照）。 | 用户产品决策；`fallbackOrder` 入缓存键是硬前置。 |

**依赖图**：`P0 静态断言`（独立）→ `P1 D5`（独立但共享 `provider.js` 文件窗口）→ 两者合并后**一次** `g5/refresh.sh` → 一次重启验收。`P1 分级冷却` 与 `P1 URL 清单` 各自独立，但都触碰 `cacheKeyFor` 的 `resultOptions`，若同轮做需合并设计。

---

## 5. 一句话建议（只做一件零风险立刻可做）

**在 `README.md` 写明「新增后端必须走 `webErrorFromResponse`、禁止手写丢 status 的 `WebError`」，并加一条静态断言钉住现有 11 处调用点** —— 把 OpenCode Issue #58327 的教训固化成本地错误契约，零运行时改动、不需重启、不破坏 80/80。

---

## 6. 已确认无误（A/B 级逐条）

1. **PR #47334 已合并**：`merged=true`、`merged_at=2026-09-06T21:39:48Z`、18 文件 / 5 commits / +1360−175；核心 diff 逐字含 `cooldowns`/`preferred`/`attempted = new Set<ID>()`/`SessionEvent.Deleted|Moved`/`query(input,{sessionID,onProvider})`；PR body 自述 54 core tests（**A/B**）。
2. **Issue #58327 / #60176 / #63487 / #54311 均 open**：认证 API `state:open`、`closed_at:null`，创建日分别 2026-10-23 / 10-29 / 11-12 / 10-10；#60176 正文逐字含 Tavily 432 / 其它 402（**A**）。
3. **Tavily 432/433 是官方状态**：[Errors Code](https://help.tavily.com/articles/8645538886-understanding-http-errors) 逐字定义 432 Plan Limit Exceeded、433 Pay-As-You-Go Limit Exceeded，与 429 分列；modsearch commit `7aef58c`（2026-08-06）专门把两者纳入 `MONTHLY_COOLDOWN_MS=24h`；`new Response("x",{status:432})` / `433` 本地实测可承载（**A/B**）。⇒ 87 号「432 非标准、Response 可能拒收、标 E」**作废**。
4. **7 个同类仓库源码与许可证已读，不再是 E**：全部 MIT；`f0909172434/...` 301 → `Chih-Kai-Wang/...`；读到 `modsearch/src/cooldown.ts|router.ts|docs/troubleshooting.md|docs/dsh.md|cordis.patch.yml`、`aggregation/src/provider.ts|config.ts|keys.ts`、`ssrf-guard/src/ssrf.js`、`verified-search/src/domains.ts|lib/index.js|README.md`（**A**）。
5. **modsearch 的 patch 是正面范例**：`cordis.patch.yml` 逐字 restate `fetchProvider: http` 并注释说明「替换整行会抹掉 base 的 fetch pin」；本机的 `@240xu/dsh-websearch@2.8.4` 自带 patch 13 行、`fetchProvider` 计数 **0**（**A**）。⇒ 87 号归因对象写反。
6. **官方 seam 无 sessionID**：`types.d.ts:14/114` + 本地 `provider.js:198` + `index.js:498/514` 单例（**A**）⇒ ② 字面形态退化单键。
7. **3b 全局表连坐是 D5 唯一机制**：`provider.js:319-357` + `3b-runtime.test.js:64-70` 行为级（**A**）；`isCooled` 单后端跳过与 3b 整站 throw 是**两个独立分支**（`:323-330` vs `:341-357`），所以 ③ 不会退回 fail-open（**A**）。
8. **本地已有等价/更完整实现**：11 处 `webErrorFromResponse`、`web-error.js` 402=QUOTA/403 排除/429=RATE_LIMIT、`failure-label.js` route on code + 24h Retry-After 上限、`mcp-client.js:19-26` 认证头摘要入 `sessionCacheKey`、`cache.js` TTL 900s + `provider.js:250-267` 后端级设置摊入缓存键、`health.js:68-70` D8 additive 字段、`BACKEND_TIMEOUT_OVERRIDES_MS {ddg,searxng}=8000`（**A**）。
9. **状态类事实**：80/80 单测、35/35 文件一致、服务 PID 566981（`ps -p 566981` 实测存活，cmdline `dsh web --no-open --host 127.0.0.1 --port 3080`）、`g5/refresh.sh` 存在且可执行（**D/A 混合**：数字来自 [80 号](80-e1-p1p2-fixes.md) 与 [REPORT.md](REPORT.md)，PID 与脚本本次实测）。

## 7. 无法验证（E / 明确边界，不臆断）

1. **PR #47334 的 54 项测试逐条内容**：读到文件清单（`websearch.test.ts +444/-6` 等）与 PR body 的测试名，**未逐条读 444 行断言正文** ⇒ 测试名与覆盖意图为 B，逐条行为断言为 **E**。
2. **432/433 是否出现在本机 Tavily 真实响应**：官方定义与 modsearch 实测为 B/A，但本机 13 后端当前遥测里未观测到 432/433（`grep -rn '432|433' lib/` 0 命中）⇒ 本机触发为 **E**。
3. **PR #47334 的 `cooldownMillis()` 与本地 `retryAfterMsFrom()` 对 Retry-After 上限的差异是否会导致真实误判**：两者都有上限（PR 无 24h 上限、本地 `MAX_RETRY_AFTER_MS=24h`），但未经真实 429 响应 A/B ⇒ **E**。
4. **`CharlotteN7/dsh-netguard` / `unera/dsh-websearch` 的实现细节**：读到元数据与源码树（MIT），**未逐文件读实现** ⇒ 机制细节 **E**，本轮未纳入任何抄取结论。
5. **`f0909172434` 原 owner 的 301 是否永久**：本次 API 实测 301 到 repository id `1333467274` / `Chih-Kai-Wang`（**A**），但未来是否再迁 **E**；引用一律写重定向后的 `full_name`。
6. **跨库许可证兼容性**：7 仓库 LICENSE 字段均为 MIT（**A**），但「把 TS 源码改写进本 ESM 插件」的合规判断未做法律层面核验 ⇒ **E**；本轮结论全部限定为「抄设计意图/清单，不复制代码」。
7. **`history/clear` 删整文件是否构成独立 P1**：`history.js:87-90` 实测 `unlinkSync(file())`（**A**），但它与 D5 无因果关系，本轮未评估其语义取舍 ⇒ 结论 **E**（仅登记，不并入裁决）。

## 8. 五条反直觉（A/B/C/D/E 编号）

| # | 反直觉 | 等级 |
| --- | --- | --- |
| **1** | **最值得抄的 PR #47334，其 `Session.ID` 那一半恰恰是不能抄的**；真正能修 D5 的是它顺手写下的 `attempted = new Set<ID>()`（per-query 局部），而 PR 标题/54 项测试/TUI 动画全在讲「sticky per session」。同一个 PR 里，数据结构决定是安全的，API 签名是有害的。 | **A** |
| **2** | **「3b 只用本次 search 内失败」不会退回 fail-open 重打限流端点**：86 号 §3 把它当否决理由，但 `isCooled` 跳过单后端与 3b 整站 `throw` 是两个独立分支（`:323-330` vs `:341-357`），`failOpen` 明确排除 `rateLimited===true`。删掉的是「连坐」，不是「保护」。 | **A** |
| **3** | **两个最相关的 OpenCode Issue 是别人还没修的抱怨，而 modsearch 早把同一问题修了**：#60176（2026-10-29 open）要求 402/432 轮换，modsearch 的 commit `7aef58c`（2026-08-06）已把 432/433 纳入 24h 冷却，且把每秒 429 **排除**在持久冷却外（与我们 60s 即时冷却相反）——「按类别分级」比「一律冷却」更细。 | **A/B** |
| **4** | **「替换整行 web config 抹掉 fetchProvider」的正面范例和反面案例是同一个仓库家族**：modsearch 的 patch 逐字补了 `fetchProvider: http` 并写注释防坑；本机 2.8.4 的 patch 反而没补。⇒ 87 号把 modsearch 当反例是归因写反；我们该抄的恰是它那两行。 | **A** |
| **5** | **「SSRF allowlist」在 verified-search 里被作者自己否认是出网边界**（README:102 逐字 "It is not a network-egress or privacy boundary"），ssrf-guard 也自认不做 DNS-rebinding；把它当安全增强抄进我们代理/CONNECT 网络层，反而会打死专为自托管 SearXNG 开的 RFC1918 trust gate。**它是结果后过滤清单，不是网络防护。** | **A** |

---

## 9. 证据索引（URL / PR# / 本地文件，含等级）

| 来源 | 定位 | 等级 |
| --- | --- | --- |
| [anomalyco/opencode PR #47334](https://github.com/anomalyco/opencode/pull/47334) | `GET /repos/anomalyco/opencode/pulls/47334` + `/files?per_page=100`；`packages/core/src/websearch.ts`（`cooldowns`/`preferred`/`attempted`/`cooldownMillis`）、`packages/core/src/tool/plugin/websearch.ts`（`query(input,{sessionID,onProvider})`）、`packages/core/test/websearch.test.ts` +444 | A/B |
| [Issue #58327](https://github.com/anomalyco/opencode/issues/58327) / [#60176](https://github.com/anomalyco/opencode/issues/60176) / [#63487](https://github.com/anomalyco/opencode/issues/63487) / [#54311](https://github.com/anomalyco/opencode/issues/54311) | 认证 API `state:open` + 正文 | A |
| [Tavily Errors Code](https://help.tavily.com/articles/8645538886-understanding-http-errors) | 432/433/429 官方定义 | B |
| [liustack/modsearch](https://github.com/liustack/modsearch) | `src/cooldown.ts`（`classifyQuota`/`MONTHLY_COOLDOWN_MS`/`updateStateOnDisk`/per-key）、`src/router.ts`（`reorderByCooldown`）、`src/cooldown.test.ts`、`docs/troubleshooting.md`、`docs/dsh.md`、`cordis.patch.yml`、[commit `7aef58c`](https://github.com/liustack/modsearch/commit/7aef58c3f0e3e61251407e78fda2263c8b8b7c72) | A/B |
| [chendefine/dsh-web-search-aggregation](https://github.com/chendefine/dsh-web-search-aggregation) | `src/provider.ts`（优先队列 + `AttemptFailure[]`）、`src/config.ts`（`.volatile()` + 每 kind 一次）、`src/keys.ts`（key 池 + `maskApiKey`）、`LICENSE`(MIT) | A |
| [f0909172434 → Chih-Kai-Wang/dsh-plugin-verified-search](https://github.com/Chih-Kai-Wang/dsh-plugin-verified-search) | 301 → repo id `1333467274`；`src/domains.ts`（`VERIFIED_SEARCH_INVALID_FILTER`）、`lib/index.js`、`README.md:96-102,144-166` | A |
| [jwilson411/dsh-ssrf-guard](https://github.com/jwilson411/dsh-ssrf-guard) | `src/ssrf.js`（`SSRF_DENIED` + `REASONS` + "not DNS-rebinding protection"） | A |
| [240xu/dsh-websearch](https://github.com/240xu/dsh-websearch) | 上游 2.8.8 / 本地 2.8.4 patch 对比 | A/D |
| 本地 `lib/provider.js` | `:40-43` 超时覆盖、`:57` 全局 Map、`:198` search 签名、`:250-267` 缓存键、`:319-357` 3b、`:379-435` runBackend、`:438` allSettled、`:484` RRF、`:390` trust gate | A |
| 本地 `lib/util/web-error.js` / `failure-label.js` / `mcp-client.js` / `cache.js` / `health.js` / `history.js` / `breaker.js` / `settings-api.js` | 错误契约、鉴权摘要、TTL 900s、D8 字段、ring buffer、三 API 路径 | A |
| 本地 `lib/index.js` | `:498` 单例、`:514 ctx.web.registerSearchProvider` | A |
| `/opt/dsh-0222/node_modules/@deepseek-ai/dsh-web/lib/types/types.d.ts` | `:14 WebSearchRequest`、`:101-115 WebSearchProvider` | A |
| 本地 `tests/lead-20261109-3b-runtime.test.js` | 4 条 3b/mixed/keyless 行为级断言 | A |
| [84](84-lead-peer-leads.md) / [85](85-a1-g5-refresh.md) / [87](87-borrow-adversarial.md) / [99](99-final-verdicts.md) / [REPORT.md](REPORT.md) / [80](80-e1-p1p2-fixes.md) | 历轮口径；凡与本文件 §2 N4 / §3 / §6.3 / §6.4 / §6.5 冲突，以本文件一手证据为准 | A/D |

---

**本文件无凭证值、无 token 片段、无未脱敏凭据。全程只读源码/配置/API；唯一写文件为本报告。**
