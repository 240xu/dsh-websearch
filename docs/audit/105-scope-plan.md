# 105 · 第二轮重构：范围边界与分批执行计划

> 专家 S1（agent-8）。**只读筹划，未改任何源码/配置/运行时**；唯一写入文件是本文件。
> 方法：read / grep / glob / `node` 统计脚本 + 在 **/tmp 副本**里做「批次预演」（真跑 81 用例，不碰工作树）。

---

## 0. 基线与取证环境（先钉住事实，否则计划无意义）

### 0.1 快照（2026-11-23 15:57，本机实测）

| 项 | 值 |
| --- | --- |
| `lib/` | **33 文件 / 6104 行** |
| `tests/` | 8 文件 / **1459 行** |
| 单测 | `node --test tests/*.test.js` → **81/81 pass, 0 fail**（约 0.7–1.6s） |
| 补丁 | `g5/G5-authoritative.patch` **37 段 / 4165 行 / md5 `954c28d6547d…`**，两副本逐字节相同 |
| 已装副本 | `…/profiles/web/node_modules/@240xu/dsh-websearch`：**33/33 与 src-work 逐字节一致**，version 2.8.4 |
| 主实例 | 3080 = PID 1414284（**不得重启**：本会话 cgroup = `system.slice/dsh-web.service`） |
| dev 实例 | 3081 = PID 1510770（running，`DSH_HOME=/home/dsh/.dsh-dev`） |

关键哈希（批前/批后对拍用）：

```
provider.js 877b1943538cf3b9d9a0bf3a84e4ebfc   client.js 205277a0b1d4b82a6eaaf532abb30ea7
index.js    37cb6a67224ffff2f19d3de39c24ae6e   cache.js  e266d07408ee72bc40116b6f98ed66fc
anthropic-like.js cbece365d05b2efd9cec08759511aa27
```

### 0.2 ⚠️ 实测到「树正在被并发改动」（计划必须串行化）

本轮取证期间（15:50）`src-work/plugin/lib/provider.js` 出现过一个**我没做的** `renderTelemetryLine()` 提取（582 → 594 行），15:52 又被回滚成 582 行。取证时还一度观察到 `src-work` 与 `publish-work/repo`、与**已装副本**各漂移 1 个文件（provider.js：594 vs 582）。
⇒ 本计划所有行数/哈希以 **15:57 快照**为准；**每批开工前必须重记 md5 并确认无人同时写同一文件**，否则「逐字节」门禁会假红。

### 0.3 六个目标函数（当前实测精确边界，与 Lead 表的差异已标注）

| 行数 | 位置 | 名字 | 代码/注释 | 源码 pin 命中数 |
| --- | --- | --- | --- | --- |
| **400** | `provider.js:181-580` | `createUnifiedSearchProvider` | 297 代码 / 103 注释+空行（26%） | **9**（+文件级 11） |
| 176 | `client.js:647-822` | `UnifiedSearchSection` | 159 / 17（10%） | **2** |
| 139 | `anthropic-like.js:37-175` | `createAnthropicLikeBackend` | 124 / 15（11%） | **0** |
| 132 | `index.js:442-573` | `apply` | 89 / 43（33%） | **6** |
| 100 | `index.js:323-422` | `resolveOptions` | 84 / 16（16%） | 0（仅模块级 1 条 `pattern(...)`） |
| **101** | `cache.js:72-172` | `createSearchCache` | 80 / 21（21%） | 0（文件级 2 条落在 `cacheKeyFor`） |

> **与 Lead 表的唯一差异**：`createSearchCache` 是 **101 行**（不是 91）。差额 = 本轮 cache 写路径优化（`knownCount` 内存计数 + 首扫一次，+10 行）。

---

## 1. 可动边界表（不可动项每条都指到已修 bug 或安全属性）

### 1.1 绝不能动（红线，10 条）

| # | 位置 | 不可动的东西 | 理由（已修 bug / 安全属性） | 证据 |
| --- | --- | --- | --- | --- |
| R1 | `egress-fetch.js:300` + `:187` + `:213` | `delete headers["host"]` 与**两处** `host: headers.host ?? target.host` 恢复 | 少了恢复 = 代理 CONNECT 后 Host 变裸主机名（无端口），上游代理拒 → **Cloudflare 403**（已 A/B 实测过） | `20261106:102` pin 的是 delete；两处恢复在 187/213 |
| R2 | `mcp-client.js:195` | `id: options.skipInitialize ? 2 : 3`（initialize 用 id=1） | 65 号 **N3**：共享 SSE 流把 initialize 帧当搜索结果；M-1 修的就是 id 撞号 | 6 条 pin（`20261106:113/114`、`interaction:85/91/104`、`sse:103`） |
| R3 | `mcp-client.js:33-120` | 三步握手顺序 + `sessionCacheKey(url, extraHeaders)` + `extraHeaders` 逐层透传 + `forceFreshSession` | keyed TinyFish 必须换新会话（M-3），keyless 必须与无状态路径字节一致 | `interaction:83/84/88/89` |
| R4 | `web-error.js` 全文件 | `webErrorFromResponse()` 的 4 字段（`status`/`retryAfter`/`rateLimited`/`quota`）+ `RATE_LIMIT`/`QUOTA` 码 + **402 是 quota、403 不是** | 熔断靠这四个字段区分「配额耗尽」与「认证失败」；误判 403 会把好 key 冷却 | **11 处** `throw webErrorFromResponse(`，分布在 **9 个文件**（anthropic-like/brave/ddg/mojeek/openai/serper/tavily 各 1，searxng 2，mcp-client 2；exa/parallel/firecrawl/tinyfish 为 0）。`20261107:174` 把总数硬断言成 `calls === 11` |
| R5 | `settings-api.js:282-283` | `if (res.writableEnded === true) return;` + `cache-control: no-store` + `charset=utf-8` | 去掉 `no-store` = 浏览器缓存含凭据状态的敏感响应（安全退化）；去掉 `writableEnded` = 双写头崩 | 上一轮 §3.3 有逐字段对照表 |
| R6 | `index.js:560-570` | `for (const register of registers) disposers.push(...register())` + `catch` 里**逆序回滚再 `throw err`** | 65 号 **A.6**：半注册泄漏 route，下次 reload 撞 duplicate (kind,path) 永久失败 | 3 条 pin（`settings-api:252/253/254`） |
| R7 | `provider.js:263-271` | `${id}.${k}` 把 `baseURL/model/searchDepth/safeSearch/apiKeyEnv` 摊平进 `resultOptions` | 65 号 **N2**：少一个键 = 改设置被 900s TTL 缓存命中掩盖 | `interaction:73` pin `cacheKeyFor({…resultOptions…)`；`cache.js:53` pin `o: shaped` |
| R8 | `trust.js:31-140` | `rejectionFor` / `rejectionBody` / 503-vs-403 / 结构拒绝（Host 回环 + Origin/Referer authority） | 「挂载的 Host 服务抛错时**绝不**绕过浏览器认证」；三路由共用同一拒绝体（上一轮 O-4 刚统一） | health/history/settings-api 三处 import |
| R9 | `cache.js` `evict()` | `knownCount === null` 时**仍扫描一次** | 上个进程可能留下超 cap 目录；不首扫就永不淘汰（本轮性能修复的功能保底） | 本轮 109 号文档 §2「必须保留的细节」 |
| R10 | `client.js` 模块外壳 | `window.__ModuleLoader__.load({ id, factory: (require) => … })` + 唯一 `exports.apply/inject` | host 每个 package id **只接受一次 factory 注册**，重复即 `duplicate factory registration` 硬错（我在 `dsh-client-modules/src/client/system.ts:168-180` 读过实现） | 单文件 917 行、`exports.apply` 在 913 行 |

**推论（很重要）**：R1–R10 涉及的文件里，`egress-fetch.js`、`mcp-client.js`、`web-error.js`、`trust.js`、`settings-api.js` 的**函数级搬家和重命名都要禁止**——它们占掉 12+2+1+1 条 pin，且每条 pin 都是安全/协议不变量。这些文件本轮只允许「同文件内注释与死代码级微调」，实际上就是**不动**。

### 1.2 可动（白名单，按「断言风险」排序）

| 级别 | 范围 | 可动幅度 | 依据 |
| --- | --- | --- | --- |
| **绿** | `index.js` 的 `resolveOptions` 内部（`toggleMap` 块、`cache:{get,set}` 包装） | 已实测可删 **−16 行**，81/81 | §3 批 1 预演 |
| **绿** | `provider.js` 结果头两处重复 | 已实测 **−1 行**，81/81 | §3 批 2 预演 |
| **黄** | `provider.js` 巨型函数**同文件**分段提取 | 函数 −57 行但**文件 +16**（新函数体+JSDoc 抵掉缩进节省），81/81 | 预演 S5 同文件（4 条 S5 pin + 9 条 provider pin 全存活，因为 pin 是子串不认行号） |
| **红** | `client.js` 任何**跨文件**拆分；`provider.js` 任何**跨文件**拆分 | 已实测跨文件搬 S5（44 行 → 新 `lib/breaker-pick.js` 69 行）：provider **582→524**，但 lib 总数 **6104→6115（+11）**、文件数 **33→34**，且 **1 个用例挂**（`quota:81` —— 它要在**整份 provider.js** 里找 `rateLimitedCooled.set(c.id, entry)`） | 预演 XF |
| **禁** | `anthropic-like.js` 大改、`cache.js` 结构重组 | 无 pin 收益，但会把 2.8.4 分叉面扩大（该文件补丁仅 +2/−1） | 补丁逐文件增删统计 |

---

## 2. 断言耦合：量化（决定重构能走多远）

### 2.1 总量（权威计数，不是估）

| 断言种类 | 语句数 | 说明 |
| --- | --- | --- |
| `assert.match` | **88** | |
| `assert.doesNotMatch` | **14** | 与 match 同性质，一起统计 |
| **合计** | **102** | 分布在 7 个文件（第 8 个 `3b-runtime` 为 **0**，纯行为测试）。逐文件对账：26+5+3+43+12+6+0+7 = **102** ✅ |
| 其中「读整个 lib 源码文件」 | **94** | `readFileSync(../lib/…)` + 正则 |
| 其中「读源码切片」 | **3** | `sse:91-93` 先 `indexOf("function collect(res)")` 再切 `body` |
| 其中「断言运行时值」 | **5** | 与源码无关（`err.message` / 路由响应体） |
| 模式级应用数 | **105** | `interaction:124` 一条语句套 4 个正则循环 |

### 2.2 按测试文件 × 读哪个 lib 源（语句数）

| 测试文件 | 读的 lib 源文件（语句数） | 合计 |
| --- | --- | --- |
| `lead-20261106.test.js` | `client.js` 23（含 5 条 `doesNotMatch`）、`mcp-client.js` 2、`egress-fetch.js` 1 | **26** |
| `lead-20261107-p0.test.js` | `backends/${f}` 3（循环 firecrawl/tinyfish）、`index.js` 1、`namespace.js` 1 | **5** |
| `lead-20261107.test.js` | `index.js` 1、`settings-api.js` 1、`provider.js` 1（`src.match` 提取 privHost 正则，**不是** assert.match 但同样脆） | **3** |
| `lead-20261108-interaction.test.js` | `client.js` 27（含 5 条 `doesNotMatch` + `:124` 的 4 正则循环）、`mcp-client.js` 7、`cache.js` 2、`index.js` 2、`tinyfish.js` 2、`provider.js` 1、`settings-api.js` 1、`backends/${f}` 1 | **43** |
| `lead-20261108-quota.test.js` | `provider.js` 10、`ddg.js` 1 | **12**（11 源码 + 1 运行时 `err.message`） |
| `lead-20261108-sse.test.js` | `mcp-client.js` 3、`egress-fetch.js` 切片 3 | **6** |
| `lead-20261109-3b-runtime.test.js` | — | **0** |
| `settings-api.test.js` | `index.js` 3 | **7**（+4 运行时） |

### 2.3 按 lib 文件（模式应用数，105 条语句展开循环后的归属）

`client.js` **53** ｜ `mcp-client.js` **12** ｜ `provider.js` **11** ｜ `index.js` **8** ｜ 运行时值 **8** ｜ `backends/*`（循环）**4** ｜ `settings-api.js` **2** ｜ `cache.js` **2** ｜ `tinyfish.js` **2** ｜ `egress-fetch.js` **1**(+3 切片) ｜ `namespace.js` **1** ｜ `ddg.js` **1**

### 2.4 三条失效模式（决定「能走多远」的核心）

| 动作 | 断言是否失效 | 实测依据 |
| --- | --- | --- |
| **同文件内** 搬家 / 重排 / 缩进变化 / 行号变化 | **不失效** | 全部是子串/正则匹配，不读行号；我做的 S5 同文件提取把 44 行搬到模块作用域，**81/81 全绿** |
| **改名 / 改签名 / 改字面量** | **失效** | 例：`quota:81` 直接匹配 `rateLimitedCooled.set(c.id, entry)`；改名即挂 |
| **搬到别的文件** | **失效**（且是「整文件」级别连坐） | 我把 S5 64 行提到 `lib/breaker-pick.js`，provider.js 从 582→524，但 `quota:81` 立刻挂（它在**整份** provider 源码里找子串）。80/81 |
| **结构性依赖**（`indexOf` + `slice`） | **搬家即挂** | `sse:13-16` 用 `indexOf("function parseEnvelope(text, expectedId) {")` 精确切片并 `new Function` 执行；`sse:88-90` 用 `"function collect(res)"` → `"\nfunction headersFromRaw"` 两个锚点切区间 |

### 2.5 函数级热点（哪条函数最「钉死」）

| 函数（当前） | pin 数 | 结论 |
| --- | --- | --- |
| `client.js:294 UnifiedSearchCardController`（266 行） | **23** | 最大单点；任何移动都是 23 条断言的连坐——**本轮不动** |
| `provider.js:181 createUnifiedSearchProvider`（400 行） | **9**（全在函数内，另有模块级 1 条 `ddg: 8000`） | 同文件 hoist 可保；跨文件必挂 1+ 条 |
| `index.js:442 apply`（132 行） | **6** | 我把路由注册提成同文件函数（apply 132→97）后 81/81 仍绿（`findPluginRow` 与 disposer 三行都留在原地） |
| `mcp-client.js:185 mcpCall` | 6 | 红线 R2/R3 |
| `client.js:207 SettingsRoutesBridge` | 4 | 客户端，无 node 测试 |
| `mcp-client.js:33 ensureSession` | 3 | 红线 R3 |
| `client.js:647 UnifiedSearchSection` | **2** | 176 行里只有 2 条 pin（`704-705`、`711`）——**pin 成本最低的大函数**，但见 §4 为何仍不做 |
| `cache.js:39 cacheKeyFor` | 2 | 红线 R7 的配套 |
| `anthropic-like.js` 全体 | **0** | 完全无 pin 耦合 |

**一句话结论**：**同文件内拆分对断言零成本；跨文件拆分对断言是断崖。** 所以「拆文件」必须先用行为断言替换源码 pin（这是一批独立工作，不是顺手能做的）。

---

## 3. 分批计划（1 个加固批 + **2 个已预演可执行批** + 3 个条件批）

> 每批的「预计行数变化」都是我在 **/tmp 副本**上真跑出来的（`node --check` + `node --test tests/*.test.js`），不是估算。

### 批 0 · 验证基础设施加固（0 行代码，但它是后面所有批的前提）

| 项 | 内容 |
| --- | --- |
| 改哪些文件 | `g5/refresh.sh`（MOD 清单）、`105-scope-plan.md`（本文件）、可选新增 `assertions-inventory.md`。**不动 lib/tests** |
| 具体动作 | ① `MOD` 清单 35 → **37**（补 `lib/trust.js`、`tests/relink-test-deps.sh`）——现状：补丁有 37 段但只校验 35 个文件，这 2 段**从未被逐字节核对**；② 把 §2 的 102/105 断言清单固化进仓库，作为「改源码前先查」的索引 |
| 预计行数变化 | lib 0；`refresh.sh` 改 **3 处**：MOD 串加 2 个文件名、`:37` 的 `$n/35` → `$n/37`、`:38` 的 `[[ $n -eq 35 ]]` → `-eq 37` |
| 断言影响 | 0 |
| 验收 | `bash g5/refresh.sh` → `37 segments, **37/37** byte-identical`；两副本 `cmp` 通过 |
| 回滚 | `cp g5/refresh.sh /tmp/refresh.sh.bak` 前置；回滚 `cp /tmp/refresh.sh.bak g5/refresh.sh` |

### 批 1 · `index.js` 两处真去重（**已预演，−16 行，81/81**）

| 项 | 内容 |
| --- | --- |
| 改哪些文件 | `lib/index.js` **唯一一个**（573 → **557**，lib 6104 → **6088**） |
| 动作 1 | `resolveOptions` 里 16 行 `toggleMap = { exa: config?.enableExa, … }` → 1 行 `ALL_BACKENDS.filter((id) => config?.[toggleKey(id)] === true)` + 2 行 `const toggleKey = (id) => "enable" + id[0].toUpperCase() + id.slice(1)`。**等价性已证**：13 个 id→键名与原文逐字相同（脚本对拍 `identical: true`）；**5 个语义场景**（只开 ddg / 开 searxng+exa / 显式 `enabledBackends` 优先 / 全关→默认 4 个 / **13 开关全开→13 后端**）输出与改前逐字一致（13 开关全开这一条两边都跑过） |
| 动作 2 | `cache: { get: (k) => searchCache.get(k), set: (k, v) => searchCache.set(k, v) }` → `cache: searchCache`。**前提已证**：provider 只调用 `cache.get`(1 处) 与 `cache.set`(2 处)，无其它成员访问 |
| 预计行数变化 | `index.js` −16，`lib/` −16 |
| 断言影响 | **0**（预演 81/81）。三条相关 pin 全部存活：`findPluginRow(settings.describe())`（`20261107-p0:112` / `07:89` / `interaction:64`）、`pattern(/^[A-Za-z_]/)`（`interaction:135`）、`cacheKeyFor` 组（`interaction:70/71/73`） |
| 验收命令 | `node --check lib/index.js` → `node --test tests/*.test.js` 81/81 → `bash g5/refresh.sh`（37/37）→ 重装后 `cmp` 33/33 → dev 3081 health 200（见 §5 的三步 cookie 流程） |
| 回滚 | `mkdir -p src-work/backups/opt-r2-b1-$(date +%Y%m%dT%H%M%S) && cp lib/index.js src-work/backups/opt-r2-b1-*/index.js.orig`；回滚 `cp <那支>.orig lib/index.js && bash g5/refresh.sh` |
| 备注 | 提交前必须 `cp lib/index.js publish-work/repo/lib/index.js`（两棵树当前无漂移，别只改一边） |

### 批 2 · `provider.js` 结果头双写去重（**已预演，−1 行，81/81**）

| 项 | 内容 |
| --- | --- |
| 改哪些文件 | `lib/provider.js`（582 → **581**） |
| 动作 | 两处**逐字重复**的 `const header = resultHeader(typeof request?.query === "string" && /[\u4e00-\u9fff]/.test(request.query) ? "zh" : "en")`（`:503`、`:546`）→ 模块级 3 行 `withResultHeader(request, content)`，两处改成一行调用。**保留**外层条件：成功路径 `sources.length > 0 \|\| outContent !== undefined`、空成功路径 `emptyContent !== undefined`（两处语义**不同**，不能合并条件） |
| 预计行数变化 | −1（如果给 helper 加 6 行 JSDoc，则变成 **+2**，与「精简」目标冲突 ⇒ 用单行注释） |
| 断言影响 | **0**（预演 81/81；`quota`/`3b-runtime` 的 `resultHeader` 相关用例全绿）。注意：**不要**同时改 `provider.js` 的其它地方（跨文件禁令、并发写风险） |
| 验收命令 | 同批 1（换文件） |
| 回滚 | 同批 1 的备份模式（`provider.js.orig`） |

### 批 3 ·（条件批，需 Lead 决定）`createUnifiedSearchProvider` 同文件分段

| 项 | 内容 |
| --- | --- |
| 改哪些文件 | `lib/provider.js`（582 → **598**，**+16**）；函数本身 400 → **343**（−57） |
| 动作 | 把「后端挑选 + 熔断冷却 + fail-open」**64 行**提成模块级 `pickEligibleBackends(opts, backends, breakerCfg, nowMs)`；**`breakerCfg` 与 `nowMs` 必须留在调用方**（`recordBackendHealth()` 还要读它们，我试过一起搬：`breakerCfg is not defined` → 2 个用例挂） |
| 预计行数变化 | 文件 **+16**（函数 −57，新函数 + JSDoc + 调用方 4 行配置重述），实测 582 → **598**。**与「减行」目标相反**——Lead 上一轮的 `planSearch` 也是同结论（函数 −38 / 文件 +16，已回滚）。**只有把目标从「减行」改成「职责分离」才值得做** |
| 断言影响 | **0**（预演 81/81）。9 条 provider pin 全部仍在（它们是子串，不认行号），4 条 S5 pin（`rateLimitedCooled.set(c.id, entry)`、`all backends are rate-limited; retry after`、`all backends need an API key…`、`failOpen.length > 0`）搬到模块作用域后照样命中 |
| 验收命令 | 同批 1/2 + **对拍** `pickEligibleBackends` 的 3 个冷却场景（`3b-runtime:68/91/121`、`quota:81-86`） |
| 回滚 | 同批 1 模式（provider.js.orig） |
| **推荐** | **默认不做**（见 §4 判 1）；若 Lead 要「函数可读性」而不计较行数，则这是**唯一**已被实测证明不会伤断言的拆法 |

### 批 4 ·（条件批，需先补测试）`client.js` 跨文件拆 `UnifiedSearchSection`

| 项 | 内容 |
| --- | --- |
| 改哪些文件 | `lib/client.js`（917 → ~741）+ 新文件 `lib/client.section.js`（~176 行，需 `window.__ModuleLoader__.load({ id, chunk: "client.section.js", factory })` 注册 + `require.async("./client.section.js")`） |
| 前置条件 | ① host 侧 chunk 路由确实存在（我在 `dsh-client-modules/src/index.ts:200/241/1161-1195` 读到 `CLIENT_CHUNK=/^client\.…\.js$/`、`chunkRequest`、`chunkResponse`；`dsh-client-ui-sidebar-terminal` 真实使用 `chunk:\`client.terminal.js\``）；② 但本插件是**手写** 917 行 `client.js`（非 tsdown 产物），chunk 从没被这个包用过 ⇒ **未验证**（见 §7 B/E）；③ `UnifiedSearchSection` 依赖同闭包的 `BACKENDS/KEYED/METERED/ToggleRow/KeyedBackendCard/SelectField/card/css`，要么一起搬（变成第二个 500 行文件），要么导出六个符号（`client.js` 已 53 条 pin） |
| 预计行数变化 | `client.js` −176，新文件 +176 ⇒ **净 0**（只换文件边界，不减行） |
| 断言影响 | 2 条 `UnifiedSearchSection` pin（`20261106:153` 的 `KEYED.map(...jsx(KeyedBackendCard`、`:154` 的 `onEditKey`）**必须留在 client.js 或改写**；另有 client.js 模块级 9 条、`UnifiedSearchCardController` 23 条只要不搬就不动 |
| 验收命令 | 除 §5 外必须加**浏览器实跑**：Settings → Web Search 卡片可见、13 个后端开关可点、保存后 revision 变化（当前无自动化覆盖，只能手测） |
| 回滚 | `cp -a lib/client.js <backup>` + 删除新文件 + `bash g5/refresh.sh`（补丁段数会 37→38） |
| **推荐** | **本轮不做**（见 §4 判 3） |

---

## 4. 「不做」清单（每条都有反证，不是没想法）

| # | 不做的项 | 反证 / 理由 |
| --- | --- | --- |
| 1 | **`createUnifiedSearchProvider` 400 行「为了减行」而拆** | 实测两次（我 S5 +16、Lead `planSearch` +16）：同文件提取**必然净增文件行**（新函数签名 + JSDoc > 被删的缩进）。拆分只对「职责可读性」有收益。**批 3 默认不执行** |
| 2 | **`resolveOptions` 100 行整体拆** | 84 行真代码里最值钱的部分是 `${id}.${k}` 摊平（R7/N2，13 键，少一个就串味）；能安全删的只有 `toggleMap` 那 16 行，已归入批 1。函数本身线性、无嵌套、16% 注释 ⇒ 拆只会多一个 1 调用的私有函数 |
| 3 | **`client.js` 176 行跨文件拆（UnifiedSearchSection）** | ① 净 0 行；② 需引入 chunk 协议（手写包未验证，§7-B/E）；③ 依赖同闭包 6 个符号，搬=再造一个 500 行文件；④ **无 node 测试覆盖**（`client.js` 是 `__ModuleLoader__` 工厂，`node --test` 从不执行它）；⑤ R10 每 id 只能注册一次 factory，chunk 名/rev 出错 = 卡整块白屏 |
| 4 | **`client.js:294 UnifiedSearchCardController`（266 行）任何移动** | **23 条 pin** 全钉在这个类（`res.ok === false`、`readFailed` 四锚点、`writeQueue`、`stagedKeys` 等）。移动 = 23 条同时失效；这是本轮 pin 集中的最高点。要先做「源码 pin → 行为断言」的转换批，那不是本轮范围 |
| 5 | **`anthropic-like.js` 139 行拆** | 0 pin 本来很香，但：① `mapAnthropicResponse`/`citationSnippets` 已经提到模块级（177–254），剩下的 139 行是单条线性请求/响应路径；② 该文件补丁只有 **+2/−1**，是**最接近上游 2.8.4**的文件之一——大改会把分叉面从 1 行扩到几十行，下次升级 rebase 成本暴涨 |
| 6 | **`cache.js` `createSearchCache` 结构重组** | 101 行；`knownCount===null` 首扫是 R9 的功能保底，`atomicWrite`/`listEntries`/`evict` 已经是模块内闭包；拆出去要么传 `knownCount` 状态、要么再抽一层。**零 pin** 不等于零风险——它没有行为测试覆盖淘汰逻辑（只有 `cacheKeyFor` 有 pin） |
| 7 | **把 `sendJson`（settings-api）/ `rejectionBody`（trust）合并到 health/history** | 上一轮已判死：合并会让 settings 丢 `no-store`（R5），或让三路由共用可变的拒绝体。**保持三份独立签名** |
| 8 | **删注释 / 删空行「凑行数」** | lib 全树注释 680 行（11%）、空行 469 行（7.7%）。删它们零工程收益，却拆掉 R1/R2/R7/R9 这些「防止后人改回去」的现场说明 |
| 9 | **13 个 backend 文件合并/抽公共 `authHeaders`** | 上一轮实测净收益 ≈ **−2 行**（5 种 auth 头形态 + 每后端不同的 parse）；且 4 条 `backends/${f}` 循环 pin（`p0:106/107`、`interaction:100`）要求「每个文件里都能找到 `await options.resolveApiKey()` / `skipInitialize: true`」= 合并即挂 |
| 10 | **`web-error.js` / `trust.js` / `mcp-client.js` / `egress-fetch.js` 的任何函数级改动** | R1/R2/R3/R4/R8 红线；合计 12+2+1+1 条 pin，且每条都对应一个已修 bug 或安全属性 |

---

## 5. 验收标准（每批结束的硬门禁，缺一条即未完成）

| # | 门禁 | 命令（工作目录 `src-work/plugin`，除注明） | 通过判据 |
| --- | --- | --- | --- |
| G1 | 语法 | `for f in $(find lib -name '*.js'); do node --check $f \|\| echo FAIL $f; done` | 33/33 无 FAIL |
| G2 | 单测 | `node --test tests/*.test.js` | `tests 81 / pass 81 / fail 0`，退出码 0 |
| G3 | 补丁可重建 + 逐字节 | `bash g5/refresh.sh`（在 `src-work/../g5/` 或仓库 `g5/`） | 现场实测输出：`4165 lines, 37 segments, **35/35 byte-identical**` + `both copies identical: 954c28d6547d`。批 0 改 MOD 后应变成 **37/37**（`refresh.sh:37-38` 的 `$n/35` 与 `[[ $n -eq 35 ]]` 必须同步改） |
| G4 | 双树一致 | `for f in $(cd src-work/plugin && find lib tests -type f); do cmp -s …; done` | 0 drift（src-work 与 `publish-work/repo`） |
| G5 | 已装副本 | `bash restore-plugin.sh`（重装）→ 再 `cmp` 33 个 lib 文件 | **33/33** 逐字节，`package.json.version === 2.8.4` |
| G6 | dev 实例存活 | `bash dev-instance.sh status 3081` | `running: 127.0.0.1:3081` |
| G7 | dev health 200 | 三步（**直接带 cookie 会 403**，R8 的 trust 层要 Referer）：<br>`TOK=$(grep -oE 'token=[A-Za-z0-9_-]+' /tmp/dsh-dev-3081.log \| tail -1 \| cut -d= -f2)`<br>`curl -s -c /tmp/cj -o /dev/null "http://127.0.0.1:3081/?token=$TOK"`（303）<br>`curl -s -b /tmp/cj -H 'Referer: http://127.0.0.1:3081/' http://127.0.0.1:3081/api/unified-search/health` | HTTP **200** 且 JSON `ok:true`、`enabled:6`、`requestedMaxResults:8`（15:57 实测原样） |
| G8 | 主实例未受扰 | `systemctl show -p MainPID --value dsh-web.service` | 仍 **1414284**，`active`。**禁止**重启 3080 / `dsh-web.service` |
| G9 | （可选）实跑 | 在 3081 里发一次 `web_search` | 返回 sources；`searxng/firecrawl` 已知降级不算失败 |
| G10 | 回滚可用 | 批前备份存在且 `cmp` 与实际改动前一致 | 备份目录 `src-work/backups/opt-r2-b<N>-<ts>/` 存在 |

---

## 6. 风险登记（每批最可能的失败模式 + 第一时间怎么发现）

| 批 | 最可能的失败模式 | 第一时间发现（命令/现象） | 兜底 |
| --- | --- | --- | --- |
| 批 0 | MOD 清单写错文件名 → refresh 报 `DIFF` 或 `missing` | `bash g5/refresh.sh` 输出 `DIFF lib/trust.js` / 非 37/37 | 从 `grep '^diff --git'` 直接生成清单再粘贴 |
| 批 1 | ① `toggleKey` 与 `Config` 字段名漂移（将来新增 backend 忘记同步）→ `resolveOptions` 返回空数组、**静默零后端**；② `cache` 直传后 provider 误用别的成员（`cache.ttl` 之类）→ `TypeError: cache.get is not a function` | ① 一行对拍：`node -e` 把 `BACKENDS` 的 13 个 id 走 `toggleKey` 与 `Config` 的 `enable*` 字段比对；或跑 p0:112；② `grep -n 'cache\.[a-zA-Z]*' lib/provider.js` 只允许 `cache.get`/`cache.set`；否则 G2 立刻红 | 备份 `.orig` + `bash g5/refresh.sh` |
| 批 2 | 把两处**不同语义**的条件合并成无条件调用 → 空结果（0 sources）时多出一个头，`3b-runtime` 的 content 断言/快照红 | G2 红；再手比 `content` 前缀（有/无 sources 两种查询） | 同上；只改 header 表达式，不动 `if` |
| 批 3 | ① 把 `breakerCfg`/`nowMs` 一起搬走 → `breakerCfg is not defined`（我预演时真撞到，2 用例挂）；② 忘了 `latestBackendHealth` 是模块私有（跨文件搬才会暴露） | ① G1 直接 `SyntaxError`/`ReferenceError`；② 跨文件后 `quota:81` 的 `did not match` | 只做同文件；跨文件一律回滚 |
| 批 4 | ① chunk 未被 host 服务（404）→ 卡片白屏；② `chunk` 名不合 `^client\.…\.js$` 或 rev 不匹配 → factory 注册失败；③ 两次注册同 id → `duplicate factory registration` | ① 浏览器 F12 看 `/plugins/@240xu/dsh-websearch/client.section.js?rev=…` 是否 404；② 控制台错误原文；③ 同上 | 保留 `client.js` 原件，删 chunk，`client.js` 回滚 |
| 全批 | **并发写者**（15:50 实测有人改 provider.js，15:52 回滚）→ 我的「逐字节」门禁假红或改动被覆盖 | 每批开工前 `date; md5sum lib/<目标文件>` 并与 §0.1 比对；G3 出现 `DIFF` 但 `git log` 无对应提交 = 有人并行 | 串行化：一批只碰 1 个 lib 文件，改完立即 `refresh.sh` + 提交 |
| 全批 | 已装副本漂移（15:48 实测 installed 582 vs src 594） | G5 `cmp` 报 drift；或 3081 行为与单测不符（3081 读的是 installed 树，不是 src-work！） | `bash restore-plugin.sh`（`rm -rf` + `pnpm install --frozen-lockfile`）后重跑 G5/G7 |

> **最容易忽略的一条**：3081 跑的是 **`profiles/web/node_modules` 里的已装副本**，不是 `src-work`。只改 src-work 而不重装，G7 永远测的是旧代码——「health 200 但改动没生效」是历轮踩过的假绿。

---

## 7. 无法验证（A / B / C / D / E）

| 等级 | 条目 | 说明 |
| --- | --- | --- |
| **A**（本机实测可复现） | ① 33 文件/6104 行、1459 行、81/81；② 六个函数精确边界（含 cache 101 而非 91）；③ **102 语句 / 105 应用** 的断言计数与逐文件/逐 lib 归属；④ 函数级 pin 热点（CardController 23 / provider 9 / apply 6 / mcpCall 6 / Section 2 / anthropic 0）；⑤ **5 个**预演的真实行数与测试结果：**批1 −16（81/81）、批2 −1（81/81）、S5 同文件 provider +16/函数 −57（81/81）、S5 跨文件 provider −58 / lib 总 +11（33→34 文件）且 1 用例挂（80/81）、apply 路由提取 index +2/函数 −35（81/81）**；⑥ 已装副本 33/33 一致；⑦ 3081 health 200（三步 cookie 流程） |
| **B**（有实现依据，未在本插件上验证） | host 的 client chunk 机制（`dsh-client-modules` 的 `CLIENT_CHUNK`/`chunkRequest`/`chunkResponse`/`require.async`）+ 真实包 `client.terminal.js` 用 `chunk:` 字段 | 说明「拆 client 到 chunk」在**框架层可行**，但**本插件是手写 bundle**，从未走过 chunk 路由，且 `package.json` 的 `files`/`exports` 没有 chunk 声明 |
| **C**（推断） | 把 23 条 CardController pin 换成行为断言后的维护收益；`resolveOptions` 拆分后长期收益 | 无对照实验 |
| **D**（本机跑过但非本轮产物） | 单测基线、`node --check`、`cmp`、`git apply` 补丁重建、`curl` health | 全是只读/临时目录验证，**没在 src-work 上落地任何改动** |
| **E**（证据缺口，必须承认） | ① 跨文件搬 S5 我只跑了**一次**全套（80/81），其它跨文件位置（`collectFanoutResults`/`createLimiter`/`recordHistory`）未逐个试；② `client.js` 任何改动**无 node 测试覆盖**，只能浏览器手测（本会话无法做浏览器验证）；③ `web_search` 实跑依赖一个 agent 会话，我未发起；④ 批 3 的「函数可读性」收益无法量化；⑤ 15:50–15:52 的并发改动来源未知（不是我的操作） |

---

## 8. 一句话给 Lead

**能做而且已经证过的只有两件小事：`index.js` −16 行（toggleMap 去重 + cache 直传，81/81）、`provider.js` −1 行（结果头去重，81/81）。** 剩下 5 个巨型函数要么净增行（同文件拆 +16）、要么撞 23 条源码 pin（CardController）、要么撞红线（mcp-client/egress/web-error/trust）。**续做的前提是先把「源码级 pin」换成行为断言 —— 那是单独一批工作，不是拆函数的副产品。**
