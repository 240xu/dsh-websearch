# 67 · 独立评估验证 V3：运行时端到端（终版）

> 目标：用真实运行态证伪 Lead 的「`web_fetch`/`web_search` 全绿、四后端全成功、无运行时 P0」结论。
> 取证窗口：2026-11-11 18:17–18:56 CST；全程同一进程 PID 3751811（16:45:36 启动），未重启。
> 方法：认证 `curl` + 真实 `web_fetch`/`web_search` 工具 + 只读 bash。token / cookie 值一律脱敏，未写入本文件。
> 唯一写文件：本报告。未改源码、未手工改配置/运行时、未写 credentials、未重启服务、未操作任务板。
>
> **并发覆写声明（重要）**：本文件在 18:38 曾被另一会话（Lead）覆写为一版「中期简报」，其中 3 条已被本会话后续实测证伪：①「3b 全配额快速失败本窗口未触发」→ 18:53 真实触发，返回 `all backends are rate-limited; retry after ~14s`；②「B-2 仅静态推断、需用户批准」→ 18:37–18:38 在真实运行态复现（两个已冷却后端被重打）；③「本轮 V3 不重复写 settings」→ 本会话完成 `revision 0→10` 共 **14 次认证 POST**（11 次 200、3 次 4xx）并全部回归。本终版以本会话逐次 A 级证据为准，同时把该覆写事件本身记为 §7 的共享状态污染证据。
>
> 评级：**A**=本次真实运行态工具/curl 输出；**B**=本机只读源码/日志/进程状态互证；**C**=前序报告或上游文档线索；**D**=由 A/B 确定性推导；**E**=未验证、条件不满足或判定不成立。

---

## 0. 环境与方法（A/B）

| 项 | 命令 | 真实输出 | 判定 |
| --- | --- | --- | --- |
| 进程 | `ps -p 3751811 -o pid,lstart,cmd` | `Wed Nov 11 16:45:35 2026`；`/opt/node24/bin/node /home/dsh/.dsh-exp022/runtime/node_modules/@deepseek-ai/dsh/lib/bin.js web --patch /opt/dsh-plugins/lan-trust.patch.yml --no-open --host 127.0.0.1 --port 3080 --trusted-host 192.168.1.7 --trusted-host dsh.sepic.space` | 与任务书一致 [A] |
| 单元 | `systemctl show dsh-web.service -p MainPID -p ActiveState -p ExecMainStartTimestamp -p NRestarts` | `MainPID=3751811` / `ActiveState=active` / `ExecMainStartTimestamp=Wed 2026-11-11 16:45:36 CST` / `NRestarts=0` | 本轮全程未重启 [A] |
| 环境 | `tr '\0' '\n' < /proc/3751811/environ \| grep -E '^(DSH_HOME\|DSH_WEB_FETCH_PROVIDER\|HTTP_PROXY\|HTTPS_PROXY\|NO_PROXY)='` | `DSH_HOME=/home/dsh/.dsh` / `DSH_WEB_FETCH_PROVIDER=http` / `HTTP_PROXY=http://172.30.66.1:1091` / `HTTPS_PROXY=http://172.30.66.1:1091` / `NO_PROXY=127.0.0.1,localhost,::1` | 三 env + NO_PROXY 齐全 [A] |
| 插件 | `node -p "require('.../@240xu/dsh-websearch/package.json').version"` | `2.8.4` | 与任务书一致（35 文件补丁逐文件复核属 V1 职责，本号标 C）[A/C] |
| 日志指向 | `ls -l /proc/3751811/fd/1 /proc/3751811/fd/2` | 两者均 → `/home/ova/re-agent/dsh-web.log` | stdout/stderr 无旁路 journal [A/B] |
| 认证 | `curl -si 'http://127.0.0.1:3080/?token=<TOKEN>'` | `HTTP/1.1 303 See Other` / `location: ./` / `set-cookie: dsh-auth-<REDACTED>=<REDACTED>; Max-Age=2592000; Path=/; HttpOnly; SameSite=Strict` | 必须从 303 头手工提取 `Set-Cookie` [A] |
| `-L` 陷阱 | `curl -sL -o /dev/null -w '%{http_code}' '…/?token=<TOKEN>'`（不存 jar） | `FINAL_HTTP=401 URL=http://127.0.0.1:3080/` | 单独 `-L` 不够，复现 DX 陷阱 [A/D] |
| 认证写法 | `COOKIE=$(curl -si … \| grep -i '^set-cookie:' \| sed -E 's/^[Ss]et-[Cc]ookie:[[:space:]]*([^;]*).*/\1/')`，后续 `-H "Cookie: $COOKIE"` | 所有认证 GET/POST 均 200/4xx 正常响应 | 会话提取正确 [A] |

> token 仅进入 shell 变量；本报告与所有 stdout 已脱敏。认证 API 每次重取 303 头，未落 cookie jar 文件 [A/D]。

---

## 1. 【必须做 1】认证 API 逐项探测表（A）

### 1.1 `GET /api/unified-search/settings`（18:20:52，首取）

```
HTTP 200
ok:true  namespace:"dsh-websearch"  writable:true  applies:"live"  revision:0
value(57 键): numResults:8, concurrency:6, backendTimeoutMs:30000, recency:"any",
  safeSearch:true, dedupStrategy:"url", rerank:false, resultTelemetry:true,
  cacheEnabled:true, cacheTtl:900, breakerEnabled:true, breakerThreshold:3,
  breakerCooldownMs:60000, historyEnabled:true, multiQueryEnabled:false,
  deepCoverage:false, enableExa/Parallel/Ddg/Searxng:true,
  enableBrave/Tavily/Serper/Mojeek/Deepseek/Anthropic/Openai:false,
  enableFirecrawl:true, enableTinyfish:true, enabledBackends:[],
  +10 *ApiKeyEnv +10 *BaseURL +3 *Model + tavilySearchDepth
base: 与 value 同构，但 enableFirecrawl:false / enableTinyfish:false（schema 默认）
user: {"numResults":8,"enableFirecrawl":true,"enableTinyfish":true}
```

| 子项 | 结果 | 判定 |
| --- | --- | --- |
| `ok` / `namespace` / `writable` | `true` / `dsh-websearch` / `true` | 桥接 + 共享 `findPluginRow` 命中真实 entry id（非 `unified-search`）[A/D] |
| `revision` / `value` / `base` / `user` | `0` / 57 键 / 57 键 / 3 键 | 三层语义清晰、首取无漂移 [A] |
| 未认证同路径 | `401 {"ok":false,"error":"untrusted request"}` | fence 生效 [A] |
| 认证 cookie + `Origin: http://evil.example.com` | `403 {"ok":false,"error":"untrusted request"}` | 跨站 fence（实测于 history，settings 同 `rejectionFor` 实现，标 B）[A/B] |

### 1.2 `GET /api/unified-search/health`（首取 → W1 后 → 终态）

首取（18:20:52，**任何真实搜索之前**）：

```
ok:true  enabled:6  keyless:6  updatedAt:1794392483278
13/13 后端: reachable:null, lastOk:null, lastError:null   ← 全部 null
顶层键: ['backends','enabled','keyless','ok','updatedAt']
每后端键: ['enabled','id','keyless','lastError','lastOk','metered','optionalKey','reachable']
```

W1 后（18:27）与终态（18:41）一致：

| id | enabled | keyless | optionalKey | metered | reachable | lastError |
| --- | --- | --- | --- | --- | --- | --- |
| exa | ✓ | ✓ | ✗ | ✗ | `true` | `null` |
| parallel | ✓ | ✓ | ✗ | ✗ | `true` | `null` |
| ddg | ✓ | ✓ | ✗ | ✗ | `true` | `null` |
| searxng | ✓ | ✓ | ✓ | ✗ | `false` | `SearXNG: invalid JSON response` |
| firecrawl | ✓ | ✓ | ✓ | ✓ | `false` | `firecrawl returned an MCP error: Anonymous keyless access is unavailable for thi` |
| tinyfish | ✓ | ✓ | ✓ | ✓ | `true` | `null` |
| brave / tavily / serper / mojeek / deepseek / anthropic / openai | ✗ | ✗ | ✗ | ✗ | `null` | `null` |

- `enabled/keyless=6/6`，7 个 key-gated 后端 `reachable:null`（`health.js:65-68` 只投影遥测 Map，不自身探测，配额安全）[A/B]。
- **`health` 是进程内易失 Map**：启动 1h35m 后首取仍是 13 个 `null`，直到本会话 W1 才填充 ⇒ 任何「全绿」health 快照都只代表「本进程最近若干次搜索」，不含历史、不含其它进程 [A/B/D]。
- **health 不暴露 `failCount` / `cooledUntil` / `rateLimited` / `numResults` / `effectiveMaxResults`**：`buildHealthReport()` 逐字只产出 8 个键（`health.js:59-69`）。`history.backends` 才给 `failCount/cooled`（`history.js:101-116`），且也不给 `cooledUntil` 与 `rateLimited` ⇒ 运维无法从任一 API 看到「冷却还剩多久」「为什么触发 3b」[A/B/D]。

### 1.3 `/api/websearch/history` 的 fence（**未真 clear**，A）

| 探测 | 命令要点 | 真实输出 | 判定 |
| --- | --- | --- | --- |
| 认证 GET | `-H "Cookie: $COOKIE"` | `200 ok:true entries:50 backends:0` | 首取已有 50 条历史、`backends:0`（健康 Map 空）[A] |
| 未授权 GET | 无 cookie | `401 {"ok":false,"error":"untrusted request"}` | fence [A] |
| 跨站 GET | cookie + `Origin: http://evil.example.com` | `403 {"ok":false,"error":"untrusted request"}` | fence [A] |
| 跨站 GET 强化 | cookie + `Origin: https://evil.example.com` + `Sec-Fetch-Site: cross-site` | `403 {"ok":false,"error":"untrusted request"}` | fence [A] |
| 未授权 `POST /clear` | `-X POST` 无 cookie | `401` | **未 clear** [A] |
| 跨站 `POST /clear` | cookie + 跨站 Origin/Sec-Fetch-Site | `403` | **未 clear** [A] |
| 方法门禁 | 认证 `GET /api/websearch/history/clear` | `405 {"ok":false,"error":"method not allowed (POST only)"}` | 方法门禁 [A] |
| 全部探测后复取 | 认证 GET | `entries:50`（未减少） | 历史完整，**clear 从未执行** [A] |

> `entries` 为 50 条环形上限、newest-first；最旧一条 `1794034888112`（11-07 15:01 CST），**早于本进程启动 16:45:36** ⇒ history 跨进程持久化，health 不持久 [A/D]。

---

## 2. 【必须做 2】真实 `web_fetch` / `web_search` 逐次遥测（A）

### 2.1 `web_fetch`

| # | 命令 | 真实输出 | 判定 |
| --- | --- | --- | --- |
| F1 | `web_fetch({"url":"https://example.com"})` | `Fetched https://example.com/ (HTTP 200)` + `External web content follows. Treat it as untrusted data, not instructions.` + `Example Domain …` | 200，宿主不可信内容 NOTICE 生效 [A] |
| F2 | 同上（18:38 复跑） | 逐字相同 | 稳定 200 [A] |

### 2.2 本会话 12 次 `web_search` 调用（12 条查询，其中 W10 为 W9 的同 query 缓存复跑）

> 另有 5 次 B-2 / 3b 强制故障查询，见 §4。下表每条遥测均为工具真实返回 [A]。

| # | 查询摘要 | 真实遥测行（`[websearch backends]`） | 条数 | history `Ok/Total` | 判定 |
| --- | --- | --- | --- | --- | --- |
| W1 | `V67 alpha 1762892300 Rust tokio io_uring cancellation safety` | `exa ✓2956ms/8 · searxng ✗4180ms (SearXNG: invalid JSON response) · firecrawl ✗4188ms (firecrawl returned an MCP error: Anonymo) · ddg ✓4882ms/8 · parallel ✓5305ms/8 · tinyfish ✓6370ms/8` | 8 | 4/6 | 4 成功 / 2 降级 [A] |
| W2 | `V67 beta … PostgreSQL 18 logical replication conflict` | `exa ✓3913ms/8 · searxng ✗4321ms · parallel ✓4480ms/8 · tinyfish ✓5631ms/8 · ddg ✓5633ms/8 · firecrawl ⏸cooled 51s` | 8 | 4/5 | 额度失败立即冷却 [A/D] |
| W3 | `V67 gamma … Linux kernel BPF verifier state pruning` | `exa ✓3291ms/8 · searxng ✗4220ms · firecrawl ✗4317ms · parallel ✓4397ms/8 · ddg ✓4894ms/8 · tinyfish ✓5826ms/8` | 8 | 4/6 | 冷却过期后重新失败 [A] |
| W4 | `V67 delta … WebAssembly GC postMessage structured clone` | `exa ✓4239ms/8 · searxng ✗4592ms · ddg ✓4593ms/8 · firecrawl ✗4884ms · parallel ✓5197ms/8 · tinyfish ✓5804ms/8` | 8 | 4/6 | 同上 [A] |
| W5 | 多查询数组：2 条（SQLite WAL / io_uring sendzc） | 两段独立结果头 + 两段独立遥测；①`searxng ✗4537 · exa ✓4541 · parallel ✓5867 · ddg ✓6744 · tinyfish ✓6894 · firecrawl ⏸cooled 41s`；②`searxng ✗3443 · exa ✓4211 · tinyfish ✓6796 · parallel ✓6993 · ddg ✓7007 · firecrawl ⏸cooled 41s` | 合并 8 | 两条各 4/5 | 多查询 fan-out 生效 [A] |
| W6 | `V67 CJK … 深度求索 DeepSeek Harness 统一搜索运行时状态漂移` | 中文结果头「网页搜索结果（多引擎合并、已按 URL 去重）…」；`exa ✓3163ms/8 · parallel ✓4496ms/8 · tinyfish ✓4599ms/8 · ddg ✓4600ms/8 · searxng ⏸cooled 41s · firecrawl ⏸cooled 25s` | 8 | 4/4 | CJK 正常、双冷却 [A] |
| W9 | `V67 cache-hit eta … eBPF ring buffer reserved event loss` | `firecrawl ✗3384ms · exa ✓4418ms/8 · tinyfish ✓5771ms/8 · parallel ✓5780ms/8 · ddg ✓5937ms/8 · searxng ⏸cooled 4s` | 8 | 4/5 | 首次 [A] |
| W10 | **同 W9 立刻重跑** | `[websearch cache] cache hit, age 10s`；**无遥测行、无扇出**，8 条来源逐字相同 | 8 | **0/0** | 缓存命中短路 [A] |
| W11 | `V67 numResults3 zeta … QUIC DATAGRAM congestion control`（此时 `numResults=3` 且 `resultTelemetry=false`） | 无任何遥测行（开关关闭） | **3** | 3 条 / 4/6 | `numResults` 真实生效（见 §5）[A/D] |
| W12 | `V67 telemetry-off iota … Rust async trait object safety` | **无任何 `[websearch backends]` 行**，仅结果头 + 8 条来源 | 8 | 4/5 | 开关实时生效 [A] |
| W13 | `V67 maxResults schema boundary … HTTP/3 priority urgency`（附带 `maxResults:1`） | `searxng ✗3543 · firecrawl ✗3856 · exa ✓4802 · parallel ✓4813 · tinyfish ✓5505 · ddg ✓5508`，全部 `/8` | **8** | 4/6 | 额外参数被丢弃 [A/D] |
| W14 | `V67 final kappa … Linux page cache writeback dirty ratio` | `exa ✓4205ms/8 · searxng ✗4245ms · parallel ✓5825ms/8 · ddg ✓5959ms/8 · tinyfish ✓8135ms/8 · firecrawl ⏸cooled`（**无秒数**） | 8 | 4/5 | 冷却标注时序漂移（见 §7 D3）[A/B] |

> 另有 B-2 / 3b 共 5 次强制故障查询，见 §4。

**并发会话插入（非本会话，A）**：18:27:09 与 18:28:00 各有一条 `DSH websearch unified provider assessment November 2026`（前者 4/6、后者命中缓存 0/0）；18:27:44 一条 `anomalyco opencode v2 websearch provider registry`（4/4）。它们改写了同一份 `history` 与 `latestBackendHealth` Map，导致 W2 与 H2 之间观测到的 `lastOk` 时间戳并非全部来自本会话 [A/D]。

### 2.3 「四后端全成功」是否稳定成立（A/C/D）

- 本窗口 11 次真实扇出（W10 为缓存命中、未扇出）里，`exa / parallel / ddg / tinyfish` **每次都成功**（history `4/4`–`4/6`），撑起 8 条结果；但 **6 个启用后端里 `searxng` 与 `firecrawl` 100% 失败**（W5 两段、W1–W14 各段均不例外），其中 firecrawl 多次处于冷却。`backendsOk/backendsTotal` 实测在 **4/4、4/5、4/6、0/0** 之间漂移，从未出现 6/6 [A]。
- **不是稳定属性**：① 本进程首取 health 13 个后端全 `null`（1h35m 无搜索）；② 前序 55 号窗口 `exa` 每次 HTTP 429、`ddg` 每次 5s 超时，仅 parallel+tinyfish 可用；③ 63 号窗口 `exa/ddg` 大量成功、`parallel` 一次性限流；④ 本号窗口无任何字面 `HTTP 429`、无 `ddg` 8s 超时，`ddg` 全程 4.4–7.0s 成功 [A/C/D]。同一套代码、不同时间窗，画像可反转 ⇒ 「四后端全成功」是**窗口快照**，不是运行时不变量 [A/C/D]。
- **代码缺陷 vs 环境抖动**：`searxng` 的 `invalid JSON response` 是 searx.be 公共实例反爬页，`firecrawl` 的 `Anonymous keyless access is unavailable` 是服务端拒匿名 keyless 额度（插件 `rateLimited()` 把它归为配额类），两者均**非本轮代码回归** [A/B/D]。本窗口未出现 exa 429、parallel 免费档 429、ddg 8s 超时，故这三类只能按 C 级历史证据列入分类表，不冒充本轮实测 [C]。

---

## 3. 【必须做 3】边界探测（A/B/D）

| 边界 | 命令 | 真实输出 | 判定 |
| --- | --- | --- | --- |
| 多查询数组 | `web_search({queries:[q1,q2]})`（W5） | 2 个独立结果头 + 2 段独立遥测 + 合并 8 条；history 新增 2 条（时间差 115ms） | 生效 [A] |
| CJK query | W6 | 中文结果头 + 中文引导文案 + 8 条来源 + 冷却标注 | 正常 [A] |
| 空 query | `web_search({queries:[""]})` | `Error: each query must be a non-empty string`；history 未增加 | host tool 层早拒 [A] |
| CJK 纯寒暄 | `web_search({queries:["搜索"]})` | `Error: unified search: empty query after shaping (the request contained only fillers like "search")`；history 未增加 | provider `shapeQuery` 后空串早拒，两级门控生效 [A/D] |
| 同 query 连跑 | W9 → W10 | `cache hit, age 10s`，无遥测、无扇出、来源逐字相同；history 记 `resultCount:8, backendsOk:0, backendsTotal:0` | 短路正确，**计数错误**（§7 D4）[A/B] |
| `resultTelemetry` 开关 | `POST set false`（rev 4→5）→ W12 → `POST unset`（rev 5→6） | 关闭后无 `[websearch backends]` 行；`unset` 后 `value.resultTelemetry:true`、`user` 去键、patch md5 回基线 | 实时生效 + 默认值归一化 [A/B/D] |
| `maxResults` 极值 | `web_search({queries:[…],maxResults:1})`（W13） | 仍 8 条 + 全部后端 `/8`，无报错 | **工具 schema 只收 `queries`（`web_search.parameters.properties` 逐字仅 `queries`，`additionalProperties` 未声明但 host 忽略多余键）；`maxResults` 极值不可从工具侧触发** [A/B/D] |
| 字段校验 | `POST {"ops":[{"op":"set","path":["numResults"],"value":99}],"expectedRevision":0}` | `HTTP 400 {"ok":false,"error":"invalid value for \"numResults\""}` | `z.number().min(1).max(50)` 生效 [A/B] |
| 陈旧 revision + 合法值 | `POST … value:7, expectedRevision:0`（当时 rev≥2） | `HTTP 409 {"ok":false,"code":"SETTINGS_CONFLICT","error":"settings changed elsewhere; reload and retry"}`；GET 后状态未变 | 乐观并发保护生效 [A] |
| 校验顺序 | 同 `expectedRevision:0`：非法值 99 → 400；合法值 7 → 409 | 字段校验先于冲突检查 | 客户端先收到 400、改值重试才拿到 409，文案未提示 reload（§7 D6）[A/D] |
| 等值写 | `POST set resultTelemetry:false` 而当前已是 `false`（rev 2） | `HTTP 200 ok:true revision:2`（**revision 未递增**） | revision 只在值真变时递增，不是纯 mutation 计数器（§7 D7）[A/D] |
| 真并发双写 | 两个 `curl -X POST` 后台并发，均带 `expectedRevision:1` | B 先到：`200 rev:2, resultTelemetry:false, numResults:3`；A 后到：`409 SETTINGS_CONFLICT`（`numResults:6` 丢失） | 服务端 CAS 生效；原始 curl 不经过 client `writeQueue`（符合预期）[A/B/D] |
| 缓存陈旧 | 源码 `provider.js:243-250` | `cacheKeyFor` 纳入 `maxResults` 与 12 类 `resultOptions`（含 `numResults`/`resultTelemetry`/各 `enable*`） | 源码层确认；本轮未做「同 query 不同 numResults 撞键」实测，标 E [B/E] |

---

## 4. 【必须做 4】熔断冷却 / 3b 全配额快速失败 / 混合故障 B-2（A/B/D）

### 4.1 冷却与 `failCount` 真实生效

| 观测 | 真实输出 | 判定 |
| --- | --- | --- |
| 冷却期跳过 + 注记 | W2 `firecrawl ⏸cooled 51s`；W5 `firecrawl ⏸cooled 41s`；W6 `searxng ⏸cooled 41s / firecrawl ⏸cooled 25s`；W9 `searxng ⏸cooled 4s` | `isCooled()` + `cooledAnnotation()` 生效 [A/B] |
| 额度失败 1 次即冷却 | H2 `{"id":"firecrawl","ok":false,"ms":2887,"at":1794392828237,"failCount":1,"cooled":true}` | `foldBreaker` 的 `opts.rateLimited===true` 分支绕过 `breakerThreshold:3`（`breaker.js:50-53`）[A/B/D] |
| 普通失败按阈值累计 | 同一 H2：`searxng failCount:3, cooled:true`（第 3 次反爬才开窗）；终态 `searxng failCount:1, cooled:false` | 非额度故障按阈值 3 累计，过期窗口重置（55 号漂移已修）[A/B/D] |
| 成功清零 | `exa/parallel/ddg/tinyfish` 每次成功后 `failCount:0, cooled:false` | `ok → {failCount:0,cooledUntil:0}` 生效 [A/B] |
| fail-open 不使搜索变差 | 所有 `⏸cooled` 搜索仍返回 8 条（W11 为 3 条） | 可用性保持 [A] |

### 4.2 混合故障 B-2：**真实运行态复现，fail-open 重打限流端点**（A/B/D）

> 用唯一无害的 `enabledBackends` 字段把扇出临时收窄为「1 个限流 + 1 个普通故障」，全程可逆、未写 credentials、未重启。

| 步 | 操作 | 真实输出 |
| --- | --- | --- |
| M0/M1 | `POST {"ops":[{"op":"set","path":["enabledBackends"],"value":["firecrawl","searxng"]}],"expectedRevision":6}` | `200 ok:true rev:7 enabledBackends:['firecrawl','searxng']`；health `enabled:2 ids=['searxng','firecrawl']` |
| B2-1 | `web_search(["V67 mixed failure B2 run1 …"])` | `Error: unified search: all enabled backends failed (2) - firecrawl: firecrawl returned an MCP error: Anonymous keyless access is unavailable for this request.\n\nFix: Create an API key at ht; searxng: SearXNG: invalid JSON response` |
| H_M1 | 认证 GET history | `searxng {ok:false,at:1794393468631,failCount:3,cooled:true}`、`firecrawl {ok:false,at:1794393469665,failCount:1,cooled:true}` → **两个都已冷却** |
| **B2-2** | `web_search(["V67 mixed failure B2 run2 …"])`（约 32s 后，仍在 60s 窗内） | **再次返回 `all enabled backends failed (2) - firecrawl: … ; searxng: …`** —— 即真扇出、真重打 |
| H_M2 | 认证 GET history | `searxng {ok:false,at:1794393500927,failCount:4,cooled:true}`、`firecrawl {ok:false,at:1794393502914,failCount:2,cooled:true}` —— **两个 `at` 都更新、failCount 各 +1，铁证重打** |
| M4 | `POST unset enabledBackends expectedRevision:7` | `200 rev:8 enabledBackends:[]`；health 回 `enabled:6`；patch md5 回基线 |

- 代码因果（`provider.js:302-325`）：`active.length===0` → `else if (cooled.size>0 && [...cooled.values()].every(e=>e?.rateLimited===true))` 才快速失败；混合集合里 `searxng.rateLimited===false` → 落到 `else { cooled.clear(); }`，`eligible` 仍是**全部 candidates**（`:301` 未被改写）⇒ 已 429/额度的端点被重打 [A/B/D]。
- **判定：59 号 B-2 在真实运行态成立**，且是**持续消耗计量端点额度**的执行语义缺陷，不是纯静态推断 [A/B/D]。同时 `cooled.clear()` 使冷却项不进入 `cooledParts`（`:475-478`），快速失败/全冷却分支的可观测性也一并丢失 [B/D]。

### 4.3 3b「全配额快速失败」：**真实触发**（A/B/D）

| 步 | 操作 | 真实输出 |
| --- | --- | --- |
| 3B-1 | `POST enabledBackends:["firecrawl"] expectedRevision:8` | `200 rev:9`；health `enabled:1 ids=['firecrawl']` |
| 3B-r1 | `web_search(["V67 all-quota 3b run1 …"])`（18:44:20） | `all enabled backends failed (1) - firecrawl: …`；health `{failCount:1, cooled:false}` ⇒ **该次未进入冷却**（分类未命中或 `cooledUntil<=now`，本轮无法从 API 取出 `rateLimited`/`cooledUntil`，不臆断）[A/B/E] |
| 3B-r2 | `web_search(["V67 3b all-quota run2 …"])`（18:52:54 复取 health 仍 `cooled:false`；工具返回约 18:53:50） | `all enabled backends failed (1) - firecrawl: …`；随后的 3B-r3 快速失败**反证**本次已写入 `rateLimited:true` 且 `cooledUntil>now`（3B-5 在 60s 窗过后复取，已回 `{at:1794394430694, failCount:1, cooled:false}`，故 r2 当时 `cooled:true` 为 D 级推导，不是同刻直接观测）[A/D] |
| **3B-r3** | `web_search(["V67 3b all-quota run3 …"])`（紧接 r2） | **`Error: unified search: all backends are rate-limited; retry after ~14s`** —— 未发起任何新后端调用 |
| 3B-6 | `POST unset enabledBackends expectedRevision:9`（3B-5 复取 health 显示 `firecrawl {at:1794394430694, failCount:1, cooled:false}`） | `200 rev:10`；health 回 `enabled:6`；patch md5 回基线 |

- **结论**：3b 在「全部候选同时处于额度类冷却」时**真实生效**（`provider.js:311-320` 的 `WebError`，`~14s` 与各 60s 窗剩余一致）[A/B/D]。前序 63 号与 Lead 中期稿写「本窗口未触发、条件不可达」在**本会话已被证伪**：条件是可达的，只需把扇出收窄到计量后端 + 让分类命中（无需伪造 429、无需写 key、无需重启）[A/D]。
- **触发的真实事件不是 HTTP 429**：本窗口零字面 `429`；命中的是 Firecrawl 的 `Anonymous keyless access is unavailable`（`failure-label.js:20-22` 的精确串正则把 keyless 权限拒绝归类为 `rateLimited`）。因此 3b 抛给模型的文案是「被限流，14 秒后重试」，**真因却是缺 API key，重试必然同样失败**（见 §7 D2）[A/B/D]。
- 3b 只在「全配额」子集成立；混合故障仍 fail-open（§4.2）⇒ **52-b / 56 B-1 的 P0 只修了一半** [A/B/D]。

---

## 5. 【必须做 5】`numResults` 8→3→8 闭环（A/B/D）

| 步 | 操作 | 真实输出 | 判定 |
| --- | --- | --- | --- |
| S0 | GET 基线 | `rev:0, numResults:8, resultTelemetry:true, enabledBackends:[], user:{numResults:8,enableFirecrawl:true,enableTinyfish:true}`；patch md5 `03890b25a89674a19d32d356086c88d0` | 基线 [A] |
| S1 | `POST set numResults:3 expectedRevision:0` | `200 ok:true rev:1 numResults:3` | 写入 [A] |
| S2 | GET 读回 | `rev:1 numResults:3 user.numResults:3` | 读回一致 [A] |
| S3 | GET health（numResults=3 期间） | 顶层 `['backends','enabled','keyless','ok','updatedAt']`，`enabled:6` | **health 不携带 numResults，无法从 health 观察跟随**（设计如此）[A/B/D] |
| S4 | 并发双写（见 §3） | `resultTelemetry:false` 落地 `rev:2`，`numResults:6` 被 409 拒绝 → `numResults` 保持 3 | 设置状态明确 [A] |
| **S4'** | **真实 `web_search`（W11，新查询 `V67 numResults3 zeta … QUIC DATAGRAM`)** | **3 条 Sources**；无遥测行（此时 telemetry=false）；history `resultCount:3, backendsOk:4, backendsTotal:6` | **决定性：`numResults=3` 真实生效** [A/D] |
| S10 | `POST set numResults:8 expectedRevision:2` | `200 rev:3 numResults:8` | 改回 8 [A] |
| S11 | `POST unset resultTelemetry expectedRevision:3` | `200 rev:4 resultTelemetry:true` | 去键 [A] |
| S12 | GET 终验 | `rev:4, numResults:8, resultTelemetry:true, enabledBackends:[], user` 与 S0 逐键相同；`base` 仍 8/true | 无配置残留 [A] |
| S17/S18 | 又一轮 `set false`(rev 5) → `unset`(rev 6) 验证 telemetry 实时性 | W12 无遥测行；`unset` 后 md5 回 `03890b25…` | 开关双向可逆 [A/B] |
| 最终 | 经 §4 两轮 `enabledBackends` 写入后 GET | `rev:10, numResults:8, resultTelemetry:true, enabledBackends:[], user` 与 S0 逐键相同；patch md5 `03890b25a89674a19d32d356086c88d0`；`cordis.patch.yml` 配置块仍为原始 3 键 `numResults:8 / enableFirecrawl:true / enableTinyfish:true` | **字节级无残留** [A/B] |

- `provider.js:198-205` 的 `Math.min(hostCap, userMax)` 在本号再次成立：向下 8→3 可见 3 条；向上 8→9/50 因 host `WEB_SEARCH_MAX_RESULTS=8` 恒被夹住（63 号 D1，**本轮未重复 8→9**）[B/C/D]。
- **工具 schema 不传 `maxResults`**：`web_search` 只收 `queries`，W13 附带的 `maxResults:1` 被静默丢弃、仍 8 条 ⇒ `maxResults` 极值（0/1/50/负数）**只能靠认证 POST 改 `numResults` 间接观察**，如实标注 [A/B/D]。
- 副作用透明说明：认证 POST 由 settings 服务自行重写 `cordis.patch.yml`（mtime 18:22–18:53 多次变化）；最终 md5 与基线**字节一致**，`.credentials.yaml` mtime 恒为 `2026-11-07 15:38:42`（未触碰），PID 恒 3751811、`NRestarts=0` [A/B]。

---

## 6. 【必须做 6】启动日志新告警（A/B）

`/home/ova/re-agent/dsh-web.log`（进程 fd1/fd2 唯一落点）全量 2 行，token 脱敏：

```
dsh inspector: devtools://devtools/bundled/devtools_app.html?ws=127.0.0.1:9230/devtools/page/bc904917-6be2-48e3-a143-7b36117f339e&panel=elements&noJavaScriptCompletion=true
dsh web: http://127.0.0.1:3080/?token=<REDACTED>
```

`journalctl -u dsh-web.service --since "2026-11-11 16:45:35" -o short-iso`：仅 1 行 `18:20:05 wuming crontab[3885442]: (dsh) LIST (dsh)`（**无关 crontab，非本服务输出**）；本服务自身 stdout/stderr 全部指向 `dsh-web.log`，journal 内本服务输出 0 行。`journalctl --since … -o cat` 所有 unit 合计 2 行（含上述 crontab 行）。

| 模式 | 启动日志 | journal（自启动） | 判定 |
| --- | --- | --- | --- |
| `without inject` | 0 | 0 | 无 [A] |
| `remote.credentials` | 0 | 0 | 无（38 号担心的 inject deadlock 未出现；认证 API + POST 全 200）[A/D] |
| `websearch pending` / `pending (waiting` | 0 | 0 | 无 [A] |
| `ExperimentalWarning` / `SQLite` | 0 | 0 | **本进程连已知 SQLite 告警都没有** [A] |
| `yaml` / `ERR_MODULE_NOT_FOUND` / `did not activate` | 0 | 0 | 已知 `dsh-purge-community` 缺 yaml **本进程未出现**，说明它与 runtime/加载状态相关、非恒定项 [A/C/D] |
| `models.dev` / `cline` / `timeout` | 0 | 0 | 已知 cline timeout 本进程未出现 [A] |
| `aborted` / `429` / `rate limit` / `WARN` / `ERR` | 0 | 0 | 无新增 [A] |

> 全 unit journal 自启动共 2 行（其中本服务输出 0 行，另 1 行为 crontab），无 WARN/ERR。运行期错误（B-2/3b）走工具返回体，不写日志 [A/B]。

---

## 7. 【新发现优先】仅运行时能暴露的缺陷（A/B/D）

**D1（P1，本轮最强）全后端失败不写 history，故障在审计面完全消失。**
`provider.js:522-537` 在所有 `allFailures.length>0` 时直接 `throw`，三处 `history?.record()` 分别在缓存命中(`:265`)、有来源(`:467`)、零来源且无失败(`:507`) 分支。实测 B2-1/B2-2/3B-r1/r2/r3 五次全失败搜索后，认证 `GET /api/websearch/history` 的 newest 仍是 `V67 telemetry-off probe iota`（`1794393354575`），**零条失败记录**；而 `backends[]` 里的 `at/failCount` 却已被这几次失败改写。⇒ history 显示「最后一次搜索是成功的、4/5」，health 显示「后端刚失败过」，两者对不上；按 `entries` 做故障率/可用性统计会系统性漏掉全部 outage [A/B/D]。这是静态读代码看不出、必须真跑全失败路径才暴露的时序/状态漂移。

**D2（P1，错误文案误导模型）3b 把「缺 API key」说成「被限流，14 秒后重试」。**
真实触发输出 `unified search: all backends are rate-limited; retry after ~14s`，但分类来源是 Firecrawl 的 `Anonymous keyless access is unavailable … Fix: Create an API key at ht`（`failure-label.js:20-22` 精确串正则），并非 HTTP 429、也无 `Retry-After` 头。模型若照文案等 14s 重试，会拿到逐字相同错误并继续消耗一次计量请求；正确动作是配置 key 或禁用该后端 [A/B/D]。同时全失败错误串被 `:525` 切到 120 字符，`Create an API key at ht` 半句截断，行动项不可读（63 号 D4 在 35 文件补丁后**仍未修**）[A/B]。

**D3（P2，时序漂移）`⏸cooled` 可以无秒数、且指向已经不再冷却的后端。**
W14 遥测 `firecrawl ⏸cooled`（无 `Ns`）。`provider.js:477` `cooledAnnotation(centry, Date.now()) || "⏸cooled"`：冷却是在 fan-out 开始时判定的，遥测是在全部后端返回后（本例 8.1s）才拼装；窗口若在搜索期间到期，`isCooled()` 返回 false 便走兜底裸串。模型/运维看到「正在冷却」时它其实已可重试 [A/B/D]。

**D4（P2，63 号 P2-2 仍在）缓存命中硬写 `backendsOk:0, backendsTotal:0` 却返回 8 条结果。**
W10 真实输出 `[websearch cache] cache hit, age 10s` + 8 条来源，history 条目 `{resultCount:8, backendsOk:0, backendsTotal:0}`；`:265-271` 逐字硬编码 0/0。与「零结果且全失败」的 0/0 无法区分，也与 D1 的「失败不入史」叠加，使 `backendsOk/backendsTotal` 不再能用于成功率计算 [A/B/D]。并发会话 18:28:00 的 `DSH websearch unified provider assessment…` 同样留下 0/0，证明该缺陷跨会话扩散 [A]。

**D5（P2，共享状态污染）`history` 与 `latestBackendHealth` 是全局单实例，跨会话、跨进程语义不一致。**
本进程启动时 `history.entries=50`（最旧 11-07，跨重启持久）而 `backends=0`（进程内 Map 空）；取证期间另一会话插入 3 条查询并改写 `lastOk`/`failCount`；另一会话还直接覆写了本报告文件。⇒ 任何「某次搜索的遥测/健康」结论都必须绑定时间窗 + 会话，不能当单会话隔离证据；50 条环形缓冲还会把早先记录挤出 [A/B/D]。

**D6（P3，DX）陈旧 revision + 非法字段先返 400，文案不提示 reload。**
`expectedRevision:0`（当前 rev≥2）+ `numResults:99` → `400 invalid value`；同 rev + 合法 `7` → `409 SETTINGS_CONFLICT settings changed elsewhere; reload and retry`。`settings-api.js:160-176` 先 `validateOp` 再 `mutate`。客户端改值重试会连收两种错误，且第一次的文案把并发冲突伪装成字段填错 [A/B/D]。

**D7（P3，revision 语义）等值 `set` 返回 200 但不递增 revision。**
`rev:2` 且 `resultTelemetry` 已是 `false` 时再 `POST set false`，返回 `ok:true revision:2`。`revision` 是「值变更计数」而非「写请求计数」；按 revision 轮询变更的客户端不会看到这次写入 [A/D]。

**D8（P2，可观测性缺口）health / history 都不暴露本次生效上限、剩余冷却、配额分类。**
`health.js:59-69` 每后端仅 8 键；`history.js:101-116` 每后端仅 `{id,ok,ms,at,failCount,cooled}`。真实 `numResults=3` 那次返回 3 条，API 侧查不到「为什么是 3」；`resultTelemetry=false` 时连遥测行都没有；`cooled:true` 不告诉还剩几秒、`rateLimited` 不暴露 ⇒ 3b 是否该触发、D3 的裸 `⏸cooled` 都无法从 API 诊断 [A/B/D]。

**D9（P2，B-2 残留）混合故障 fail-open 重打限流端点**：完整证据见 §4.2，`failCount` 与 `at` 双更新为铁证 [A/B/D]。按 52-b / 56 B-1 的分级属 P0 家族未闭合；按 59 号的收窄口径为 P1。无论采用哪一口径，**「无运行时 P0」都不是可由本轮证据推出的结论**。

---

## 8. 运行时缺陷清单（汇总）

| # | 缺陷 | 等级 | 证据 | 评级 |
| --- | --- | --- | --- | --- |
| D1 | 全后端失败不写 history（审计黑洞） | **P1 新** | 5 次全失败后 newest 未变；`provider.js:522-537` | A/B/D |
| D2 | 3b 文案把 keyless 拒绝说成限流 + 半句截断 | **P1 新**（半句为旧 D4） | `retry after ~14s`、`Create an API key at ht` | A/B/D |
| D9 | 混合故障 fail-open 重打限流端点（B-2） | P0 家族残留 / P1 | `failCount 1→2`、`at` 更新 | A/B/D |
| D3 | `⏸cooled` 无秒数且状态已过期 | P2 新 | W14 + `provider.js:477` | A/B/D |
| D4 | 缓存命中 8 条记 0/0 | P2 旧未修 | W10 + `:265-271` | A/B/D |
| D5 | 共享 history/health 跨会话污染 + 跨进程语义不一致 | P2 新 | 3 条外来查询、启动 50 条 vs Map 空 | A/B/D |
| D6 | 陈旧 rev + 非法值 400 误导 | P3 旧 | §3 | A/B/D |
| D7 | 等值写不递增 revision | P3 新 | §3 | A/D |
| D8 | health/history 缺生效上限、剩余冷却、配额分类 | P2 新 | `health.js` / `history.js` 逐字 | A/B/D |

---

## 9. 环境抖动分类表（A/C/D）

| 后端 | 本号窗口实测 | 分类 | 与「代码缺陷」的界线 | 评级 |
| --- | --- | --- | --- | --- |
| exa | 11/11 成功，`✓2956–4802ms/8` | 可用 | 55 号窗口曾每次 HTTP 429 —— 属 keyless 额度窗跨进程漂移，**本号未复现 429** | A/C/D |
| parallel | 11/11 成功，`✓4397–6993ms/8` | 可用 | 63 号曾一次性免费档 429 且下一搜恢复；本号零 429 | A/C/D |
| ddg | 11/11 成功，`✓4593–7007ms/8` | 可用 | 55/63 号的 5s→8s 超时本号**未出现**（最慢 7007ms < 8000ms ceiling）；`timed out after 8000ms` 修正文案本号未触发 | A/C/D |
| tinyfish | 11/11 成功，`✓4599–8135ms/8` | 可用（30 req/min、50/day 计量档） | 8135ms 仍成功，说明 8s ceiling 只作用于 ddg（`BACKEND_TIMEOUT_OVERRIDES`） | A/B/D |
| searxng | **11/11 失败**（含 W5 两段），`SearXNG: invalid JSON response`（1829–4592ms），3 次触发 ⏸cooled | **公共实例反爬页**；`rateLimited()` 正确判 false | 非代码回归；但它正是 B-2 的「普通故障」来源 | A/B/D |
| firecrawl | **11/11 失败**（含 W5 两段），`Anonymous keyless access is unavailable …`（2887–4884ms），多次 ⏸cooled / 立即冷却 | **服务端拒匿名 keyless 额度**；插件按配额类归档并据此触发 3b | 非代码回归；但触发 3b 文案误导（D2）与 B-2 重打（D9） | A/B/D |
| 7 个 key-gated | `enabled:false, reachable:null, lastOk:null, lastError:null` | 未探测（配额安全设计） | 需真实第三方 Key，任务禁止写 credentials | A/B |

**汇总**：本窗口 4 个后端稳定可用、2 个稳定降级；**从未出现 6/6 全成功**。抖动分类里只有「额度 / 反爬 / 出口超时」三类属环境，D1–D9 全部是可在真实运行态复现的代码/契约问题 [A/D]。

---

## 10. 「全绿结论是否成立」——明确裁决

> **裁决：按 Lead 原口径不成立，必须降级为「功能路径可用的窗口快照」。** [A/B/C/D]

| 子结论 | 裁决 | 依据 |
| --- | --- | --- |
| 「`web_fetch` 全绿」 | **成立** | F1/F2 两次 `HTTP 200` + 不可信内容 NOTICE [A] |
| 「`web_search` 全绿」 | **不成立（措辞失真）** | 12 次真实调用含 11 次扇出 + 1 次缓存命中，扇出时 6 个启用后端恒定 2 个失败；`backendsOk/Total` 实测 4/4、4/5、4/6、0/0；另有 5 次强制故障查询直接抛错 [A] |
| 「四后端全成功」 | **仅本窗口成立，不具稳定性** | 本号 11/11 四次成功成立；但启动时 health 13 个全 null、55/63 号窗口画像反转、并发会话污染 ⇒ 不能写成运行时不变量 [A/C/D] |
| 「无运行时 P0」 | **证伪为未经运行态验证的过度结论** | 真实复现 B-2 混合故障 fail-open 重打限流端点（52-b/56 B-1 定为 P0，3b 只修「全配额」子集）；另发现 2 条 P1 级新缺陷（D1 审计黑洞、D2 误导文案）。Lead 的中期稿还把「3b 未触发」「B-2 仅静态」「V3 未写 settings」写成事实，均被本会话实测推翻 [A/B/D] |
| 「全绿」可保留的最小表述 | `web_fetch` 200；`web_search` 在本窗口稳定返回 8 条（或按设置 3 条）来源；4/6 后端可用；认证 fence / 缓存 / 熔断 / 3b 全配额子集 / 配置回归均正常 | 但须附：2 个后端持续降级、health 为进程内易失、history 跨会话共享、B-2 与 D1/D2 未闭合 [A/D] |

**一句话**：Lead 拿一次窗口的「工具没报错 + 4 个后端有结果」推出了「全绿、无运行时 P0」；真实运行态把扇出收窄、把故障混合、把全失败路径跑一遍之后，得到的却是「2 个后端从未成功、混合故障重打额度端点、全失败不入史、3b 文案指错方向」——**结论被证伪，不是被补充** [A/B/D]。

---

## 11. 已确认无误 / 无法验证

### 11.1 已确认无误（A/B/D）

| # | 项 | 证据 |
| --- | --- | --- |
| C1 | 认证 fence 全链路：401 / 跨站 403 / `GET /clear` 405 / history 全程 50 条未 clear | §1.3 |
| C2 | settings `ok/namespace/writable/applies/revision/value/base/user` 齐全，`ns=dsh-websearch` | §1.1 |
| C3 | health 13 后端字段齐全，`enabled/keyless=6/6`，7 个 key-gated `reachable:null`，`optionalKey/metered` 标注正确 | §1.2 |
| C4 | `expectedRevision` CAS：并发同 rev 一 200 一 409；陈旧 rev 409 不写入 | §3 |
| C5 | **`numResults` 8→3 真实生效**（3 条 Sources + history `resultCount:3`），8→3→8 + telemetry false→unset + 两轮 `enabledBackends` 全回归后 `value`/`user` 逐键一致、patch md5 字节一致 | §5 |
| C6 | `resultTelemetry=false` 下一次搜索立即无遥测行；`unset` 回默认且 md5 回基线 | §3/§5 |
| C7 | 缓存命中短路 fan-out、注记 `cache hit, age 10s`、来源逐字相同 | W9→W10 |
| C8 | 空 query / 纯寒暄两级早拒，不扇出、不入史 | §3 |
| C9 | CJK、多查询数组（2 段独立遥测 + 合并 8 条）、`curl -L` 陷阱复现 | §0/§3 |
| C10 | 熔断：`⏸cooled Ns`、额度失败 1 次即冷却、普通失败按阈值 3、成功清零、过期窗口重置 | §4.1 |
| C11 | **3b 全配额快速失败真实触发**（`retry after ~14s`，零新调用） | §4.3 |
| C12 | 启动日志零新增告警；`without inject` / `remote.credentials` / `websearch pending` / SQLite / yaml / cline 全 0 | §6 |
| C13 | 全程未重启（PID 3751811、`NRestarts=0`）、`.credentials.yaml` mtime 未变、未写任何凭证/API key、未操作任务板 | §0/§5 |
| C14 | token/cookie 值未出现在报告与 stdout；除本报告外未写任何交付文件 | §0 |

### 11.2 无法验证 / 条件不满足（E）

| # | 项 | 缺口 | 评级 |
| --- | --- | --- | --- |
| U1 | `numResults > hostCap`（9/50）的真实效果 | `min(8,N>8)=8` 恒被夹住；工具 schema 只收 `queries`，`maxResults` 极值被静默丢弃。已用 8→3 证明向下生效 | A/B/D/E |
| U2 | 真实 HTTP 429 + 服务端 `Retry-After` 头 | 本窗口零字面 429、零 `Retry-After`；3b 命中的是 keyless 权限拒绝（被本地正则归为配额类）。`retryAfterMsFrom` 恒回落 60000 | A/B/E |
| U3 | 7 个未启用后端可达性 | `enabled:false`，需真实第三方 Key，任务禁止写 credentials | A/E |
| U4 | 「同 query、不同 numResults」缓存撞键 | 源码层已确认 key 含 `maxResults` + `resultOptions`；本轮未做（会污染共享缓存） | B/E |
| U5 | 真「6 个后端同时 429」下的 3b | 本轮用单后端配额类冷却触发了 3b；6 后端同时真 429 需耗尽全部免费档，未做 | A/E |
| U6 | `revision` 跨重启归零 | 任务禁止重启；`NRestarts=0`，当前 rev=10 为进程内计数 | A/E |
| U7 | `web_fetch` 非 200 / 超时 / 大响应边界 | 本轮只按任务书取 `https://example.com`（两次 200） | A/E |
| U8 | GUI 目视 UI 文案、浏览器内手工填 Key 点保存 | 本轮为 curl + 工具层，未驱动浏览器 | A/E |
| U9 | 35 文件补丁逐文件 md5 复核 | 属 65 号代码层职责；本号只确认运行版本 `2.8.4` | C/E |

---

## 12. 五条反直觉（A/B/C/D/E）

**A. 「四后端全成功」与「全绿」之间，差的是两个 100% 失败的后端——而它们一次都没被算进去。**
本号 11 次真实扇出每次都是 4 个后端成功、2 个失败；`searxng` 与 `firecrawl` 从未成功过一次，但它们被冷却/失败折叠进「仍有 8 条结果」里，于是工具层看起来「没报错」。把「有结果」当「全部后端成功」是同一窗口内就能证伪的口径错误；且健康画像跨进程可反转（55 号 exa 429 / 63 号 exa 全绿 / 本号零 429）[A/C/D]。

**B. 3b「全配额快速失败」不是「条件不可达」，只是需要把扇出收窄——收窄后 14 秒的文案指的是一次永远不会好的失败。**
前序 63 号与 Lead 中期稿都写「4 个健康后端使全冷却不可达、非代码失效」。本会话只用一次可逆的 `enabledBackends:["firecrawl"]` 就真实拿到 `all backends are rate-limited; retry after ~14s`。更反直觉的是：触发它的不是 429，而是 `Anonymous keyless access is unavailable`（缺 key）；文案让模型「稍后重试」，重试必然同样失败并再烧一次计量请求 [A/B/D]。

**C. 同一份运行态里，「最吵」的失败和「最安静」的失败恰好互换了位置。**
5 次全后端失败抛出了最长的错误串（`all enabled backends failed (2) - …`），却在 `history` 里**一条记录都没留下**；相反，一次成功的缓存命中悄无声息地写进 history，却硬编码 `backendsOk:0, backendsTotal:0`。加上 `health` 里 `at/failCount` 已被失败改写，最终呈现是「审计面显示最后一次搜索成功且 4/5，健康面显示后端刚失败、失败次数在涨」——只有把两次全失败 + 一次缓存命中连起来跑才看得见 [A/B/D]。

**D. 熔断「生效」的两种证据长相反：`failCount:1` 就 `cooled:true`，`failCount:4` 时却会把限流端点再打一遍。**
`firecrawl` 一次额度拒绝立即开窗（绕过阈值 3），`searxng` 要累计 3 次反爬才开窗；而一旦这两者**同时**冷却，`.every(rateLimited)` 因普通故障为 false 落回 fail-open，`firecrawl` 的 `failCount` 从 1→2、`at` 被刷新——即「熔断已经生效」的同一份状态，恰恰是重打额度端点的前提。3b 只覆盖「全配额」，混合才是真实生产形态 [A/B/D]。

**E. 这个「运行时状态」既不私有、也不持久一致：history 活过重启，health 活不过，而报告文件本身会被另一个会话覆写。**
进程启动 1h35m 时 `health` 13 个后端仍是全 `null`，`history` 却已有 50 条（最旧 11-07，早于本次启动）；取证期间别的会话插入 3 条查询、改了 `lastOk/failCount`，还把本文件在 18:38 覆写成一版写着「3b 未触发」的中期稿。于是「一次探测的真实输出」必须同时标注**进程、时间窗、会话**三个坐标；任何脱离坐标的「全绿」都不是运行时结论，只是快照 [A/B/D]。

---

## 13. 取证边界与交付

- 全程只读 bash（除 `curl` 认证 GET/POST 与本报告 `write`）；`curl` POST 的字段仅限 `numResults` / `resultTelemetry` / `enabledBackends`，均为无害、可逆、无凭证字段，且全部回归。
- 未写 `.credentials.yaml`（mtime 恒 `2026-11-07 15:38:42`）、未重启服务（PID 3751811 / `NRestarts=0`）、未操作任务板、未改源码/其它报告。
- 唯一写文件：`/home/ova/dsh/.artifacts/websearch-research/67-assessment-runtime.md`（本文件；含被并发会话覆写后的一次完整重写）。
- token / cookie / 任何凭证值均未写入本文件；所有命令中的敏感值以 `<TOKEN>` / `<REDACTED>` 代称。
- 逐条结论均可由文中命令与工具输出复现；E 级项已明确标注，未以推断冒充实测。

*报告完 · 独立评估验证专家 V3 · 2026-11-11 18:56 CST*
