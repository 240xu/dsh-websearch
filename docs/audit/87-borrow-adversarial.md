# 87 · 抄同类项目会引入的风险（对抗型技术顾问 B2）

> **⚠️ 22:40 再订正（[91 号](91-s1-corrections.md)）**：① 版本归属 2.8.8→**2.8.6**；② 本号把 `f0909172434/...` 当 SSRF/allowlist 项目是**误分类**（301 → Chih-Kai-Wang，主题 bounded evidence workflow / 显式 gaps / 三轨发布），相关风险论证以 90/91 号为准；③ chendefine 源码已读（A 级）。NO-GO 结论不变。
> **⚠️ 22:35 订正索引（[90 号](90-b1-decisive-corrections.md)）**：本文两处被 B1 一手源码证据推翻——①「432 不是标准 HTTP 状态、加它等于塞魔数」：432/433 是 **Tavily 官方** Plan/Pay-As-You-Go 限额状态（Help Center + docs.tavily.com），modsearch `cooldown.ts` 的 `classifyQuota` 明确「429 每秒限流排除、只冷却 432/433 月度预算」，可抄的是**按 code 分级冷却**；②「三个 DSH 同类仓库只读到 README、全 E」：B1 已核实 7 仓库**全 MIT** 并读到 modsearch/aggregation/ssrf-guard/verified-search 源码。另「modsearch 替换整行抹掉 fetchProvider」归因写反：**缺该字段的是我们基于的 2.8.4 自带 `cordis.patch.yml`（计数 0），modsearch 反而 restate `fetchProvider:http`**。本文 NO-GO 结论与「不抄」清单仍成立。
> 立场：**默认不抄**，除非证据证明收益大于代价。只评估，不写源码、不改运行时、不改配置、不操作任务板。
> 唯一写文件：本文件。全文无凭证值（`.git/config` 内联 token 只读后返回 `401 Bad credentials`，未输出、未落盘；所有取证走未认证 API / web_fetch / 本地源码）。
> 对象：`@240xu/dsh-websearch@2.8.4` + 35 文件本地补丁（13 后端全并发 + RRF、磁盘缓存 TTL 900s、per-backend 熔断、3b、history/health/settings、MCP streamable-http、错误契约 route on code）。
> 现状：80/80 单测、35/35 文件一致、已重启验收通过；唯一残留 P1 = D5 跨会话干扰（模块级 `latestBackendHealth`），80 号 §6 明确「需用户点头」。

## 0. 证据分级（全文标注）

| 级 | 含义 |
| --- | --- |
| **A** | 本地源码逐行读 / 只读 API 实测 / 运行时可复现 |
| **B** | 官方文档原文 + URL / 多来源交叉印证 |
| **C** | 单一来源或合理推断，未二次源码核验 |
| **D** | 任务背景给定的既成事实，本轮未独立复核 |
| **E** | 搜不到 / 仅见 README 未见实现 / 无法验证 → 标 E，不臆断 |

**方法边界**：本地补丁源码（publish repo HEAD `b17f834`）**全文读过**；OpenCode v2 本地 clone 的 `packages/core/src/websearch.ts` / `tool/plugin/websearch.ts` / `package.json` / `LICENSE` **读过源码**；三个 DSH 同类仓库**只读到 README + repo meta**（`web_fetch` / 未认证 GitHub API），**未 clone / 未读其完整源码树与依赖清单** ⇒ 其实现细节一律标 E，不臆断。

---

## 1. 逐条「抄了会怎样」风险表

> 风险等级：**高**=会破坏 80/80 或 35/35 或违反工程约束；**中**=需同步多链路 / 重依赖 / 语义漂移；**低**=可维护但收益存疑。

### 1.1 OpenCode PR #47334 `sticky provider per session`（A 级依据为主）

源码实测（本地 clone，`packages/core/src/websearch.ts`）：`cooldowns = new Map<ID,{until,error}>()`（**全局共享**）+ `preferred = new Map<Session.ID|undefined,{provider?}>`（**按 session 隔离**）+ `Effect.addFinalizer(() => preferred.clear())` + `bus.subscribe([SessionEvent.Deleted,SessionEvent.Moved]).pipe(Stream.runForEach(...))`；`query(input, options?: {sessionID?, onProvider?})`；`packages/core/package.json` 依赖 `effect:4.0.6` / `@effect/platform-node` / `@effect/sql-sqlite-bun`；LICENSE=MIT（2025 opencode）。PR 已合并 2026-09-06（API 实测 `merged_at`）。

| # | 风险 | 等级 | 可复现 / 可推理依据 |
| --- | --- | --- | --- |
| R1 | **`Session.ID` / `SessionEvent` / `Effect` / `Stream` 在插件里没有对应物**：`lib/index.js` 全文 0 处 `ctx.on`/`ctx.session`/事件订阅；`provider.search(request, signal)` 签名无 sessionID（只读到 `request.maxResults` / `request.query`）；`provider.js` 仅 import `@deepseek-ai/dsh-web` 的 WebError + 零依赖 util。落地须先给 seam 传 sessionID ⇒ 触碰 `agent-loop` / 官方 `packages/web`，**被工程约束明令禁止** | **高** | A：`grep ctx.on\|ctx.session\|SessionEvent` on `lib/` = 0 命中；`grep "async search("` = `(request, signal)`；本地 clone `websearch.ts:5-6,93-102,184-198` |
| R2 | **Effect/Stream/KV 是重依赖**：把 `effect@4.0.6` + `@effect/*` 灌进一个 `package.json` 只有 peerDeps、零 runtime deps 的 ESM JS 插件，等于换运行时范式；且 profile 精确 pin 2.8.4、pnpm-only 无 npm/yarn lock ⇒ patch-package 生成器不可用（74 号 X.1），新增依赖无法被 G5 权威补丁捕获 | **高** | A：`packages/core/package.json:80,81,120`；D + 74 号 X.1/X.5 |
| R3 | **与全并发 RRF 语义正面冲突**：sticky = 「一会话一 provider、失败才 fallback、单胜者」；本地 = `Promise.allSettled` 全扇出 + `rrfFuse` 融合 + `dedupeSources`（`provider.js:29,438-449`）。抄它会删掉多源召回，**打破 3b / RRF / 缓存键三类测试**：`lead-20261109-3b-runtime.test.js`(5)、`lead-20261108-quota.test.js`(14)、`cacheKeyFor` 的 `b:` backendSet 维度（sticky=1 后端即失效）、multiQuery 变体逐变体扇出 | **高** | A：`provider.js:29-30,236-239,438-449`；`cache.js:40,47-54`；测试清单实测 8 文件 77 个 `test()` |
| R4 | **D5 是唯一残留 P1 且被 gate**：即使只抄「分离全局冷却 / 会话偏好」这一设计意图，也是改 `provider/health/history` 三处契约的架构/执行语义改动，80 号 §6 明确「本轮不改，需用户点头」。本轮为纯评估角色，越权 | **中** | A：`health.js:45-90` 消费 `getBackendHealth()`；`history.js:118`；80 号 §3/§6 |
| R5 | **54 条上游测试无可移植 harness**：覆盖 late successes / in-flight cleanup on deletion/movement，依赖 Effect finalizer + session event bus；本地 80 条是 `node:test` + 真 HTTP/cordis/provider，无会话事件总线，抄测试=重写测试基建 | **中** | B/C：84 号 §47-55、PR diff 摘要；A：本地 tests 目录 |

### 1.2 Issue #60176（把 Tavily 432 / 402 quota 纳入轮换）

API 实测 `state=open`（未修）；84 号正文：OpenCode `provider:"random"` 的 retry loop **只在 HTTP 429 轮换**，Tavily 免费档耗尽返 **432**、其它 provider 返 **402** 时直接终止。

| # | 风险 | 等级 | 依据 |
| --- | --- | --- | --- |
| R1 | **432 不是标准 HTTP 状态**（IANA/RFC 9110 无此码），`webErrorFromResponse` 按 `status === 402` / `429` 精确分类，432 会落进默认 `WEB_PROVIDER_ERROR`。加 432 = 往通用分类器塞厂商魔数；而本地 `rateLimited()` 已有 `providerCode` 正则 `rate_limit_error|quota_exceeded|insufficient_quota` 兜住 body 级 quota 信号，无需魔数 | **中** | A：`web-error.js:29-36`；`failure-label.js:21-22`；`grep -rn 432 lib tests README.md` = **0 命中** |
| R2 | **「把 402 纳入轮换」对本地是 no-op**：402 已算 QUOTA → 折叠进 `rateLimitedCooled` → 3b 快速失败 + retry hint（`provider.js:332-357`）。真正缺的是「轮换到下一个 provider」，但我们**同一 search 已并发打全部后端**，没有「下一个」可轮换；要实现轮换就得退回有序 fallback ⇒ 与 1.1 R3 同一破坏面 | **高** | A：`web-error.js:33-35`、`provider.js:319-364,438-446` |
| R3 | **抄的是 open 问题，不是已验证实现**：无合并修复、无回归 oracle；84 号已裁决「可抄的是设计意图，不是实现」 | **中** | A：GitHub API `state=open`；B：84 号 §62-66 |

### 1.3 Issue #58327（自定义 provider 上报 rate limit）

API 实测 `state=open`。正文：`ctx.websearch.transform` 自定义 provider 任何 `execute()` 失败都变 `ServiceUnavailableError` 硬失败，拿不到 429→Retry-After→切换链路。

| # | 风险 | 等级 | 依据 |
| --- | --- | --- | --- |
| R1 | **本地已等价且更好**：11 个后端逐个 `throw webErrorFromResponse(...)`（A），产出 `code/status/retryAfter/rateLimited/quota` 结构化字段；`failure-label.js` 头注释即写「route on the stable `code`/`status`/`rateLimited`, never by parsing message」。不存在「任何失败都硬失败」的缺口 | **中** | A：`web-error.js:1-5,38-48`；`failure-label.js:1-4`；`grep -rln webErrorFromResponse lib/backends` = 11 文件 |
| R2 | **再开一条上报通道会造出两个互相竞争的分类器**，直接威胁 E1 刚守住的「route on code」不变量；且 `rateLimited()` 的 message 兜底是**刻意收窄**的（排除裸 `quota` / 泛化 `anonymous`，因为它们在 HTTP 200/402/503 body 上产生过误报），加通道易把误报放回来 | **中** | A：`failure-label.js:23-30`；80 号 N2/N3 |

### 1.4 `chendefine/dsh-web-search-aggregation`（优先队列 ordered fallback + Key Rotation）

README 全文读过（B）；repo meta：MIT / TypeScript / 3 stars / pushed 2026-09-27（A，API）。机制：9 adapters 优先队列、top-down「first success wins」、`','` 拼接多 key 池 + rotation cursor、per-attempt 10s deadline、`providers`/`attemptTimeoutMs` 两个 Config 字段、103 vitest 单测。

| # | 风险 | 等级 | 依据 |
| --- | --- | --- | --- |
| R1 | **有序 fallback 与全并发 RRF 互斥**：README 原文「the first one that returns wins」= 单源；本地 = 13 后端多源融合。抄它 ⇒ 删 RRF、废 `cacheKeyFor` backendSet、废 multiQuery 逐变体扇出，破坏 80/80 主体 | **高** | B：aggregation README「How it works」；A：`provider.js:29,236-239,438-449` |
| R2 | **Key Rotation 要新增 Config 字段，触发全链路同步**：`providers` 队列 + 多 key 池 + rotation cursor 状态 ⇒ 要动 `index.js` schema、`client.js` GUI 卡 + i18n 字典（`verify-client-ui-i18n` 门禁）、`cacheKeyFor` 的 `resultOptions`（N2 扁平化；且 key 是密文不得入缓存键）、README；**更致命**：任何代码提交都会让 85 号刚重生成的 G5 权威补丁陈旧（A1 事故：旧补丁 apply 会重新引入 N1–N4），必须再跑 `g5/refresh.sh` 重生成 37→N 段 + 35/35 `cmp`；26 份 `.orig` 回滚链也要同步 | **高** | A：85 号 §1-2；`index.js:187-244`；`cache.js:32-56`；`client.js` i18n `NS`；25 号 §逐文件审计表 |
| R3 | **重现 `WEB_PROVIDER_AMBIGUOUS`**：README 明写「A bundle patch replaces the web seam row's whole config」。本地 `cordis.patch.yml` 只有 `config: searchProvider: unified`、**无 `fetchProvider`**；歧义是靠 systemd drop-in `DSH_WEB_FETCH_PROVIDER=http` 从外部解的（25 号 §2/V6）。整行替换会丢 `searchProvider: unified` ⇒ 歧义/找不到 provider 回归 | **高** | A：`cordis.patch.yml:10-13`；25 号 §40,54,173；B：aggregation README「Combining with other provider plugins」 |
| R4 | 单维护者、3 stars、pushed 早于本轮工作；vitest+tsdown 工具链与本地 `node:test` 不同 regime | **低** | A：API meta；B：README Development 段 |

### 1.5 `f0909172434/dsh-plugin-verified-search`（SSRF/allowlist/URL 校验）

`f0909172434/...` 经 API `301 Moved Permanently` → 实际仓库 `Chih-Kai-Wang/dsh-plugin-verified-search`（A）。repo meta：MIT / TypeScript / 2 stars / pushed 2026-11-08。README 全文读过（B）：invalid hostname allowlists、credential-bearing URLs、unsafe redirects、non-public resolved addresses、malformed charset、invalid UTF-8 显式失败；250 测试 + 42 冻结语料。

| # | 风险 | 等级 | 依据 |
| --- | --- | --- | --- |
| R1 | **它是 `web_search` 工具替换，不是 provider 扩展**：README「replaces the `web_search` tool an agent inherits with bounded workflows」。抄它 ⇒ 两个 `web_search` 注册（歧义）或改 `agent-loop`/`packages/web` 工具注册（禁止）。还附加 `DEEPSEEK_API_KEY` + Cordis 4.0.1 + 需已能搜索的 preset | **高** | B：README Prerequisites；A：`index.js:514` 只 `registerSearchProvider`；24/25 号歧义因果 |
| R2 | **与本地既有 SSRF/URL 姿态重复且可能互相打架**：`trust.js`（loopback-only Host/Origin/Referer、Host 头 DNS-rebinding、跨站 fetch 拒绝）+ `provider.js:382-395`（baseURL 强制 http(s)、plain-http 仅限 RFC1918、拒 URL 内嵌凭证）+ `egress-fetch.js`（`redirect:"error"` / 有界 follow）+ `cache.js:270-274`（缓存源 http(s) 白名单）+ `health.js:15-19`（SECRET_PATTERNS 脱敏）已在岗。再加一套独立 allowlist/DNS 校验器 = 一个放行、另一个拒绝 ⇒ 静默丢 source | **中/高** | A：`trust.js:124-160`、`provider.js:382-395`、`egress-fetch.js:94-98`、`cache.js:270-274` |
| R3 | **「亮点」比听上去窄，且是实验代码**：README 自述「does NOT prove DNS rebinding」「allowlist is a condition on hostnames of structured sources, not a network-egress or privacy boundary」「No external party has independently validated」；稳定版 v0.1.1 只有 `verified_search`，全页 reader 的 SSRF 全套属 **pinned experimental 快照** | **中** | B：README Trust / Release status 段 |
| R4 | 替换工具行为 = model-visible 变更，AGENTS.md 要求同步 keyless recorded-session 快照；其 250 测试 + 离线 digest + 复现性检查是另一整套 eval 基建，与 80/80 + 35/35 不兼容 | **中** | B：README Verification snapshot；D：AGENTS.md |

### 1.6 `liustack/modsearch`（keyless tier + 两个 patch op 替换整行 web config）

`docs/dsh.md` 全文读过（B）；repo meta：MIT / TypeScript / 989 stars / pushed 2026-11-15（A）。机制：Firecrawl keyless 1000 credits/月 + Keenable 1000 req/h/IP + You.com 100/天；bundle 两个 patch op：(1) 设 `searchProvider: modsearch` 且**保留 `fetchProvider: http`**「since the row replaces the host's whole web config」(2) 挂包根。

| # | 风险 | 等级 | 依据 |
| --- | --- | --- | --- |
| R1 | **「替换整行 web config」是头号直接危害**：docs 原文「dsh patch rows replace the target row's whole `config`, so include every value you need on that row」。本地行只有 `searchProvider: unified`、无 `fetchProvider`，歧义靠外部 env 解 ⇒ 整行替换重演历史 P0 `WEB_PROVIDER_AMBIGUOUS`（与 1.4 R3 同源，但这是**对方文档亲自点名**的坑） | **高** | B：modsearch docs「What the bundle changes」/「Configure the dsh plugin」；A：`cordis.patch.yml:10-13`；25 号 §40,54 |
| R2 | **keyless tier 本地已有等价，抄来的是 subprocess + 外部配置**：本地已有 `firecrawl.js` / `tinyfish.js` keyless 后端 + `keylessRejected()`；modsearch 方案要 spawn `modsearch doctor` CLI + 读写 `~/.modsearch/config.json`（跨 profile 共享、不在 profile 内）⇒ 违反「只走插件扩展点」；且其 `/modsearch/config` 路由文档明写「does not automatically inherit dsh Connection authentication」⇒ 相对本地 `trust.js` admission 检查是**鉴权倒退** | **中/高** | A：`lib/backends/firecrawl.js`、`failure-label.js:10-14`、`trust.js`；B：docs「Configure from the web UI」 |
| R3 | 版本耦合维护成本高：docs pin `5.10.13`（任务背景写 `5.10.12` ⇒ 精确版本 E），并罗列 `minimumReleaseAge`、`scope.settings.register` 在 dsh 0.1.7 断裂、切换插件残留重复路由、`ELECTRON_RUN_AS_NODE` 等一串版本坑 | **中** | B：docs Install/Troubleshooting；E：精确版本 |

### 1.7 横切风险（所有「新增 Config / 换语义」候选共有）

| 风险 | 等级 | 依据（A） |
| --- | --- | --- |
| 任何代码变更都会让 35/35 字节一致契约失效，直到 `g5/refresh.sh` 重生成；旧补丁 apply 到洁净 2.8.4 会**重新引入 N1–N4 四条 P1**（A1 事故已坐实） | 高 | 85 号 §1-2 |
| 升级/重装会覆盖：2.8.8 覆盖我们 23 个改动文件里的 **11 个**、逐字节相同 **0 个**、`patch --dry-run` exit 1 / **4 文件 6 hunk FAILED**；`install_bundle` 重装 websearch 必覆盖 35 文件 | 高 | 74 号 §12,88,123；`g5/dry288.log` |
| pnpm-only profile 无 npm/yarn lock ⇒ `patch-package` 生成器 `No package-lock.json...` 不可用；借用改动无法用常规补丁链固化 | 中 | 74 号 §82（E2 X.1/X.5） |
| 新增 Config 字段 = `index.js` schema + `client.js` GUI + i18n + `cacheKeyFor` + README + G5 补丁 + 26 份 `.orig` 回滚链**七处同步**，任一处漏即回归 | 高 | `index.js:187-244`、`cache.js:250-267`、25 号逐文件审计表 |

---

## 2. 反证：哪些「亮点」本地补丁已等价或更好

> 逐条对比，重点回应题给的 6 项。**结论：5 项本地已等价/更好或不需要，1 项（forwarder hop）本地其实没有，但抄它有害无益。**

| 亮点 | 本地状态 | 判级 | 证据 |
| --- | --- | --- | --- |
| **ddg 8s ceiling** | **等价且更完整**：`BACKEND_TIMEOUT_OVERRIDES_MS = {ddg:8000, searxng:8000}`，`effectiveBackendTimeoutMs = min(override, global)`，运营商更短的全局超时仍胜出；注释明写「8s matches the upstream 2.8.8 ceiling」。2.8.4 基线为 0，2.8.8 才补上 ddg | **A** | `provider.js:34-49`；实测 `base/package/provider.js` ddg8000=0、本地/2.8.8=1 |
| **forwarder hop** | **本地没有，但不是缺口**：`DSH_EGRESS_FORWARDER` sidecar hop 仅上游 2.8.8 有（2.8.8=8/12 命中，本地 `egress-fetch.js`=**0**、installed profile=**0**）；本地用 `egressFetch` 的 `node:http(s)` CONNECT 隧道 + NO_PROXY + Host 头恢复（25 号 V3 行为级验收）解决同类 egress 问题，本部署走 `HTTP_PROXY=172.30.66.1:1091`，不需要 TLS-egress sidecar。**抄它 = 加一条用不到的路径，且与本地 `egressFetch` 抢 transport 所有权** | **A**（事实）/ **C**（"不需要"为推理） | `egress-fetch.js:1-25`；`g5/verify288/lib/util/egress-fetch.js:14,28-31,148-173`；74 号 §125「DSH_EGRESS_FORWARDER 2.8.4=0 / 2.8.8=8 / 本地补丁=0」；25 号 §51 |
| **结构化错误分类** | **更好**：`webErrorFromResponse` 产出 `code/status/retryAfter/rateLimited/quota`；429→RATE_LIMIT、402→QUOTA、**403 明确不算 quota**（避免坏 key 冷却后端）；`rateLimited()` 先 route on `code/status/rateLimited/providerCode`，message 兜底刻意收窄。OpenCode #58327/#60176 正是在补它们缺的这一层 | **A** | `web-error.js:9-48`；`failure-label.js:1-31` |
| **3b 全配额快速失败** | **本地独有且更好**：`rateLimitedCooled` → 排除被限流后端、fail-fast + `retry after ~Ns`；`keylessRejected` 独立成「加 key」提示；纯非配额 outage 保持 fail-open「breaker 不能让搜索更差」。OpenCode 只在 `random` 模式按 429 单线轮换 | **A** | `provider.js:319-364`；`lead-20261109-3b-runtime.test.js`(5) + `lead-20261108-quota.test.js`(14) |
| **D8 可观测字段** | **本地已有**：`buildHealthReport` 暴露 `rateLimited / keylessRejected / cooledUntilMs / reachable / lastOk / lastError`，且 additive（旧键含义不变）；`sanitizeError` 带 SECRET_PATTERNS 脱敏 | **A** | `health.js:45-90,15-32`；test「health and history expose cooldown classification without dropping old keys」 |
| **N4 认证头摘要** | **本地独有**：`sessionCacheKey(url, extraHeaders)` 把 `authorization/x-api-key/x-tinyfish-access-mode` 纳入摘要；换 key 触发 2 次 initialize、notification/401-retry 握手都带 key。同类项目无 MCP streamable-http 会话层，无对应物 | **A** | `mcp-client.js:16-26,33-114,166-167,220-234`；test「N4: session cache is keyed by credential」 |
| **RRF 融合 / 13 后端全并发** | **本地独有**：全部候选（sticky、ordered fallback、engine chain）都是「单胜者/顺序试」，无一具备 `Promise.allSettled` + `rrfFuse` + `dedupeSources` 的多源召回 | **A** | `provider.js:23,29,438-449`；对照各 README |
| **keyless tier** | **本地已有**：`firecrawl.js`/`tinyfish.js` keyless + `client.js` metered 标签 + `keylessRejected()`；modsearch 的 Firecrawl/Keenable/You.com 链是另一套实现，非缺口 | **A** | `lib/backends/firecrawl.js`、`client.js:175`、`failure-label.js:10-14` |

**净结论**：候选机制里没有一条能补上本地的真实短板；本地唯一真实短板是 **D5（模块级健康 Map 跨会话干扰）**，而修它属「需用户点头」的架构改动，不是「抄同类项目」能绕过的。

---

## 3. 许可证 / 依赖 / 维护成本（读到才写，读不到标 E）

| 仓库 | 许可证 | 语言 / 依赖 | 维护信号 | 判级 |
| --- | --- | --- | --- | --- |
| 本地 `@240xu/dsh-websearch@2.8.4` | **MIT**（LICENSE 全文读，© 2026 Xu198440） | ESM JS，runtime 零依赖（仅 6 个 peerDeps） | profile 精确 pin 2.8.4；35/35 + G5 | **A** |
| OpenCode v2（`anomalyco/opencode`） | **MIT**（本地 LICENSE 全文读，© 2025 opencode） | TS + `effect@4.0.6` + `@effect/platform-node` + `@effect/sql-sqlite-bun` + Bun/SQLite | PR #47334 已合并；#58327/#60176 仍 open | **A** |
| `chendefine/dsh-web-search-aggregation` | **MIT**（API `spdx_id=MIT` + README「© 2026 chendefine」） | TS + vitest(103) + tsdown；`','` key 池 | 3 stars，pushed 2026-09-27，单维护者 | **A**（证/元信息）/ **E**（完整依赖清单、源码未读） |
| `f0909172434` → `Chih-Kai-Wang/dsh-plugin-verified-search` | **MIT**（API + README） | TS + `DEEPSEEK_API_KEY` + Cordis 4.0.1 + 250 测试/42 语料 + 离线 digest | 2 stars，pushed 2026-11-08；**自述无第三方验证**；稳定版仅 1 工具 | **A/B** / **E**（源码未读） |
| `liustack/modsearch` | **MIT**（API `spdx_id=MIT`） | TS + spawn CLI + `~/.modsearch/config.json` + 精确版本 pin | 989 stars，pushed 2026-11-15，活跃 | **A**（证/元信息）/ **E**（精确版本：任务 5.10.12 vs docs 5.10.13；完整依赖未读） |

- **许可证结论**：五方全 MIT，本地亦 MIT ⇒ 「抄代码」在**许可证层面零障碍**（保留版权声明即可）。**真正的成本不在法律，在工程链路**（见 §1.7）。
- **依赖结论**：OpenCode 的 Effect 生态、verified-search 的 eval 基建、modsearch 的 CLI 子进程，三者都会破坏「零 runtime 依赖 / 只走插件扩展点 / pnpm-only profile」稳态；且 patch-package 生成器不可用，借来的依赖改动无法被常规补丁链固化。
- **标 E 的项**：三个 DSH 同类仓库的**完整源码树、`package.json` 依赖清单、 vendored 代码许可证**未读（只读 README + repo meta）；Tavily 432 的厂商原始定义未读；PR #47334 的 54 条测试未在本地跑过；OpenCode 两 issue 正文只取 84 号转述 + API state，未读原始全文。
- **token**：`.git/config` 内联 token 只读探测返回 `401 Bad credentials`（已失效），值全程脱敏、未输出、未落盘；所有外部取证为未认证 API / `web_fetch`。

### 明确「需要用户点头才能动」的动作（80 号 §6 + 工程约束）

1. **D5 修复**：`latestBackendHealth` → per-session/per-invocation 判定，动 `provider/health/history` 三处契约。
2. **对外开 PR**：PR base 选 2.8.4 还是 2.8.8（后者要先解决 4 文件 6 hunk 冲突）。
3. **版本/发布**：bump 2.8.9 + `npm publish`（`ENEEDAUTH`）、patch-package 落地、是否上 `0.2.2-rc.3`。
4. **新增任何 Config 字段**：schema / GUI / i18n / 缓存键 / README / G5 补丁 / 回滚链七处同步。
5. **改 profile pin 2.8.4、升级 2.8.8、`install_bundle` 重装**（会覆盖 35 文件）。
6. **引入新依赖**（Effect 生态 / CLI 子进程）或改 `agent-loop` / 官方 `packages/web`（约束禁止）。

---

## 4. 最小安全抄法（若一定要抄，只抄一个设计意图，非实现）

**选定唯一设计意图**（来自 PR #47334，**不抄它的任何一行代码 / 任何依赖**）：
> **「全局共享的冷却事实」与「按调用隔离的失败判定」分离。**
> 映射到本地 = 让 3b 快速失败只依据**本次 search 自己观测到的冷却集**，不复用模块级 `latestBackendHealth` 里由其它会话写下的旧结论 —— 即 A2（82 号）候选 ②「3b 快速失败限定本次 search」。
> **为什么是它**：唯一能对准残留 P1（D5）的意图；**不需要** `Session.ID`、Effect/Stream、SessionEvent、新 Config 字段、GUI/i18n、缓存键改动、history/health API 契约改动、新依赖、2.8.8 升级。

**文件级落地步骤（全部在用户点头后的后续轮次执行，本轮不执行）**

| 步 | 文件 | 动作 |
| --- | --- | --- |
| 1 | `lib/provider.js` | 在 fan-out 起始处把本次候选集的冷却判定收敛到**本调用捕获的快照**：`eligible` / `rateLimitedCooled` 只由本次 `candidates` 对应的 `latestBackendHealth` 条目在**本次**参与决策；跨会话写入不再让另一个 `search()` 直接 fail-fast。不动 `rrfFuse` / `Promise.allSettled` / `createLimiter` / `recordBackendHealth` 的 Map 写入语义（保持 health 遥测仍全局可读） |
| 2 | `tests/`（新增 1 个文件） | 加 1 条 D5 回归：模拟会话 A 全 429 后，会话 B（全新 `search()`）不得被 3b 零调用快速失败，仍至少打到健康后端并拿到 sources。**只加新用例，不修改现有 80 条** |
| 3 | `g5/` | 跑 `bash g5/refresh.sh`（85 号固化的「重生成 + 段数下限 + 洁净 2.8.4 apply + 35/35 `cmp` + 双副本 md5」一步）；提交后两处 patch 副本一致 |
| 4 | 不动 | `cordis.patch.yml`、profile pin、2.8.8、`agent-loop`、`packages/web`、runtime、`npm publish`、git commit/push（除非用户明确要求） |

**不破坏 80/80 与 35/35 的验收方式**

- **80/80 → 81/81**：`node --test tests/*.test.js`（relink 后）全绿，且明确「既有 80 条零改动、零重录」；新用例单独可跑。3b 三个既有 runtime 用例（`all rate-limited fail-fast` / `non-quota fail-open` / `mixed cooldown`）必须仍原样通过 —— 它们是「不改 fan-out 语义」的护栏。
- **35/35**：`bash g5/refresh.sh` 输出 `35/35 byte-identical` + `git apply --check` exit 0；对 2.8.8 仍 exit 1（不兼容，符合预期，不修）；两处 patch md5 相同。
- **回归护栏**：`grep -rn 432` 仍 0（不引入魔数）、`grep Session` 仍 0（不引入 Effect/seam）、`cordis.patch.yml` 仍只有 `searchProvider: unified`、`cacheKeyFor` 维度不变、`health.js`/`history.js` 零改动。
- **回滚**：改动仅 1 lib + 1 test + G5 重生成，26 份 `.orig` 备份链不受影响；`git revert` 单提交即可回到零动作稳态。

---

## 5. 最终裁决

> **NO-GO —— 本轮不改任何代码。**
> 一句话理由：唯一残留 P1（D5）被明确 gate 在「需用户点头」之后，而六个候选的亮点要么本地已等价/更好（402/3b/D8/N4/ddg 8s/keyless/RRF）、要么与全并发 RRF 语义正面冲突、要么需改 `agent-loop`/灌 Effect 重依赖/新增 Config 字段从而破坏 80/80 与 35/35 稳态 —— **零净收益、高回归代价**，抄的唯一安全形态是「抄一个设计意图、留到点头后的下一轮」。
> 本轮唯一交付：本报告（评估）。零动作稳态（精确 pin 2.8.4 + 35/35 + 80/80 + 已重启验收）保持不变。

---

## 6. 已确认无误（A/B）

1. `webErrorFromResponse`：429→RATE_LIMIT、402→QUOTA、**403 明确不算 quota**（注释逐字），产出 `status/retryAfter/rateLimited/quota`，`failure-label.js` route on code（**A**）。
2. `latestBackendHealth` 是单张模块级 `Map`（`provider.js:57`），D5 属实；`search(request, signal)` 无 sessionID、`lib/index.js` 无任何会话事件订阅（**A**）。
3. ddg/searxng 8s 超时上限在本地，`min(override, global)`；2.8.4 基线无、2.8.8 才补 ddg（**A**）。
4. `DSH_EGRESS_FORWARDER` forwarder hop：本地 0、installed 0、2.8.8 有；本地 `egressFetch` 用 `node:http(s)` CONNECT + Host 恢复（**A**）。
5. N4 `sessionCacheKey` 认证头摘要、401/403/404 失效重握、initialize/notification 带 key（**A**）。
6. D8 健康字段 `rateLimited/keylessRejected/cooledUntilMs/...` + `sanitizeError` 脱敏（**A**）。
7. `cordis.patch.yml` 只有 `searchProvider: unified`、无 `fetchProvider`；歧义由 `DSH_WEB_FETCH_PROVIDER=http` drop-in 外部解（**A**，25 号）。
8. 2.8.8 覆盖 11/23 改动文件、4 文件 6 hunk FAILED、0 逐字节相同；patch-package 生成器在 pnpm-only 下失败（**A/B**，74 号 + `dry288.log`）。
9. 五方许可证全 MIT（本地 LICENSE + 4 个 repo API/README）（**A/B**）。
10. PR #47334 merged(2026-09-06)、#58327/#60176 open（**A**，GitHub API）。
11. 本地 tests 实测 8 文件、`test()` 计数 77（题给 80/80 为含断言/子用例口径，未独立重跑 ⇒ 数字口径 **D**）；`grep -rn 432` = 0（**A**）。

## 7. 无法验证（E，不臆断）

1. 三个 DSH 同类仓库的**完整源码树、依赖清单、vendored 代码许可证**（仅 README + repo meta）。
2. `f0909172434/...` 与 `Chih-Kai-Wang/...` 的准确归属关系（API `301 Moved Permanently` 解析到后者，未核 owner 改名历史）。
3. modsearch 精确版本（任务 5.10.12 vs docs 5.10.13）。
4. Tavily **432** 的厂商原始定义/是否真为 quota（未读厂商文档；本地 0 命中）。
5. PR #47334 的 54 条测试未在本地执行；两 issue 正文原始全文未读（只取 84 号转述 + API state）。
6. `DSH_EGRESS_FORWARDER` 在**本部署**是否将来需要（当前走 HTTP_PROXY CONNECT，推理为「不需要」，未做运行时反证）。
7. 80/80 本轮未重跑（评估角色不改运行时，沿用题给/80 号结论 ⇒ **D**）。

## 8. 五条反直觉（A/B/C/D/E 编号）

- **A（A 级）**：「本地补丁已等价或更好」对 **forwarder hop 不成立** —— 上游 2.8.8 有 `DSH_EGRESS_FORWARDER` sidecar（8 处），本地 0 处；本地是靠 `egressFetch` 的 `node:http(s)` CONNECT + Host 头恢复解决**同类** egress 问题，目的等价、**实现并不等价**。抄 forwarder hop 反而会与本地 transport 所有权冲突 —— 所以「已等价」清单里唯一该老实标「没有」的恰恰是题点点名的这一项。
- **B（A 级）**：402 本地已算 QUOTA、**403 明确不算**（`web-error.js:30-33`），但测试名却叫「marks 402/403 as quota」—— 标题与实现不符（body 只断言了 402）。于是 #60176「把 402 纳入轮换」对我们是 **no-op**，真正缺的 432 是非标准状态且全仓 0 命中；抄一个 open issue 的诉求，得到的是一个厂商魔数。
- **C（A 级）**：把 sticky provider 抄来修 D5，直觉是「把 health Map 按 session 隔离」，但 PR #47334 **恰恰相反** —— `cooldowns` 是**全局共享**的（限流是服务端事实），只有 `preferred`（会话偏好）按 session 隔离。我们单张模块级 Map 混了「遥测 + 熔断 + 分类」三种职责，真正该拆的是**职责**，不是**按 session 复制 Map**；而拆职责甚至不需要 `Session.ID`。
- **D（B 级）**：两个 bundle 类候选（aggregation / modsearch）的**文档都主动警告**「patch row replaces the whole web config」—— 这正是我们历史 P0 `WEB_PROVIDER_AMBIGUOUS` 的根因；而本地 `cordis.patch.yml` 只有 `searchProvider: unified`、没有 `fetchProvider`，歧义是**用 systemd drop-in 从进程环境外**解的，根本不在文件里。照抄它们的 patch 写法 = 把已修的 P0 请回来。
- **E（A/B 级）**：五方许可证全是 MIT、本地也是 MIT ⇒ 抄代码**法律上零障碍**；但真正的硬约束是 **35/35 字节一致契约**：任何代码变更（哪怕只加一个 Config 字段）都会让 85 号刚修复的 G5 权威补丁再次陈旧，必须重跑 `g5/refresh.sh`，而 pnpm-only profile 无 lock ⇒ patch-package 生成器不可用。卡住「抄」的是工程链路，不是许可证 —— 与直觉相反。

---

## 9. 证据索引

| 来源 | 类型 | 关键页 |
| --- | --- | --- |
| 本地补丁 `publish-work/repo/`（HEAD `b17f834`） | A | `lib/util/web-error.js`、`failure-label.js`、`provider.js`、`cache.js`、`health.js`、`index.js`、`util/mcp-client.js`、`util/egress-fetch.js`、`cordis.patch.yml`、`LICENSE`、`tests/*` |
| `g5/verify288/`（2.8.8 解包）、`g5/dry288.log` | A | forwarder hop、`4 文件 6 hunk FAILED` |
| 本地报告 25 / 74 / 79 / 80 / 84 / 85 号 | A/B | 歧义因果、2.8.8 覆盖、patch-package、E1 修复、G5 陈旧事故、PR/Issue 源码级证据 |
| `.artifacts/refs/opencode-v2/`（本地 clone） | A | `packages/core/src/websearch.ts`、`tool/plugin/websearch.ts`、`package.json`、`LICENSE` |
| GitHub API（未认证）/ `web_fetch` | A/B | 4 个 repo 的 license/stars/pushed_at/language；PR#47334、#58327、#60176 state；4 份 README/docs 原文 |
| URL | B | [PR #47334](https://github.com/anomalyco/opencode/pull/47334) · [Issue #58327](https://github.com/anomalyco/opencode/issues/58327) · [Issue #60176](https://github.com/anomalyco/opencode/issues/60176) · [aggregation README](https://github.com/chendefine/dsh-web-search-aggregation) · [modsearch docs/dsh.md](https://github.com/liustack/modsearch/blob/main/docs/dsh.md) · [verified-search README](https://github.com/Chih-Kai-Wang/dsh-plugin-verified-search) |

---
无凭证值写入本文件。唯一写入文件：`87-borrow-adversarial.md`。
