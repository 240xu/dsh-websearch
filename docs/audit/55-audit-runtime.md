# 55 — 全量 bug 审计专家 E：运行时端到端（task-31）

**角色**：全量 bug 审计专家 E（运行时端到端） · **方法**：真实运行态取证，独立复现
**取证窗口**：2026-11-08 22:15 – 23:04 CST（Asia/Shanghai）
**运行态**：`dsh-web.service` active，`MainPID=587384`，`ExecMainStartTimestamp=2026-11-08 18:34:33 CST`，`NRestarts=0`（全程未重启），GUI `http://127.0.0.1:3080`（401 需 token，token 取自 `/home/ova/re-agent/dsh-web.log`，`curl` 取 303 `Set-Cookie` 会话 cookie）。插件 `@240xu/dsh-websearch@2.8.4` + 23 个 `lib/*.js` 本地补丁（md5 见 §8，全程未改动）。
**唯一写文件**：本报告 `/home/ova/dsh/.artifacts/websearch-research/55-audit-runtime.md`。
**约束遵守**：未改源码/配置/运行时/其它报告；未写 settings/credentials 持久化凭证（只对 `dsh-websearch` 命名空间的无害字段 `numResults`/`resultTelemetry` 做临时变更并**完整回改**，见 §2.4）；未重启服务；未操作任务板；token/cookie 值不出现在报告任何位置（所有输出经 `redact()` 脱敏）。

## 证据等级

| 级 | 含义 |
| --- | --- |
| **A** | 本次运行态 curl / 工具调用的**真实输出**（可直接复现） |
| **B** | 本机只读文件（源码 / 配置 / 日志 / md5） |
| **C** | 官方/上游文档或权威资料（本次未新增引用，沿用既有报告） |
| **D** | 由 A/B 推导的确定性结论（含代码路径行号） |
| **E** | 合理推断 / 需进一步验证 |

---

## 1. 逐项探测表（命令 / 真实输出 / 判定）

> 认证封装：`authcurl()` = `curl -sS --max-time 40 -H "Cookie: <SESSION>"`；cookie 由 `curl -i "http://127.0.0.1:3080/?token=<TOKEN>"` 的 303 `Set-Cookie` 提取。所有 HTTP 输出经 `sed` 把 token/cookie 替换为 `<TOKEN-REDACTED>` / `<SESSION-COOKIE-REDACTED>`。

| # | 项 | 命令（要点） | 真实输出（摘） | 判定 | 级 |
| --- | --- | --- | --- | --- | --- |
| 1.1 | 服务身份 | `systemctl show dsh-web.service -p MainPID -p ActiveState -p ExecMainStartTimestamp` | `ActiveState=active` / `MainPID=587384` / `Sun 2026-11-08 18:34:33 CST`；`ps` = `node /usr/local/bin/dsh web --patch /opt/dsh-plugins/lan-trust.patch.yml --no-open --host 127.0.0.1 --port 3080 --trusted-host 192.168.1.165 --trusted-host dsh.sepic.space` | 与任务描述一致 | A |
| 1.2 | 无认证 GET settings | `curl -i /api/unified-search/settings` | `HTTP/1.1 401` `{"ok":false,"error":"untrusted request"}` | fence 生效 | A |
| 1.3 | token 作为查询参数直接打 API | `curl -i "/api/unified-search/settings?token=<TOKEN>"`（不跟随） | `HTTP/1.1 401` `{"ok":false,"error":"untrusted request"}` | **token 不是 API 凭据**；必须先访问根路径换会话 cookie，符合设计 | A |
| 1.4 | 根路径换 cookie | `curl -i "http://127.0.0.1:3080/?token=<TOKEN>"` | `HTTP/1.1 303 See Other` `location: ./` `set-cookie: dsh-auth-…; Max-Age=2592000; Path=/; Expires=…; HttpOnly; SameSite=Strict` | 会话 cookie 正确下发（HttpOnly + SameSite=Strict） | A |
| 1.5 | `curl -L` 不带 cookie jar | 同上加 `-L` | 第二段 `HTTP/1.1 401` `dsh web authentication required; reopen the URL printed by dsh web.` | **反直觉**：`-L` 跟随 303 但 curl 默认不把 303 响应里的 `Set-Cookie` 带回第二次请求（非 cookie jar），仍 401。任务书说「`curl -L` 跟随 303 拿会话 cookie」只在**先保存 Set-Cookie** 时成立；直接 `-L` 不够 | A |
| 1.6 | 认证 GET settings | `authcurl /api/unified-search/settings` | `200` `{"ok":true,"namespace":"dsh-websearch","writable":true,"applies":"live","revision":0,"value":{...},"base":{...},"user":{"numResults":8,"enableFirecrawl":true,"enableTinyfish":true}}` | ok/namespace/writable/applies/revision/value/base/user 全齐；`namespace` 是 **`dsh-websearch`**（entry id），不是插件常量 `NAMESPACE="unified-search"` | A |
| 1.7 | settings 全量字段 | 同上 | `value` 共 53 键：`numResults:8, concurrency:6, backendTimeoutMs:30000, recency:"any", language:"", safeSearch:true, dedupStrategy:"url", rerank:false, resultTelemetry:true, cacheEnabled:true, cacheTtl:900, breakerEnabled:true, breakerThreshold:3, breakerCooldownMs:60000, historyEnabled:true, multiQueryEnabled:false, deepCoverage:false, enableExa/Parallel/Ddg/Searxng:true, enableBrave/Tavily/Serper/Mojeek/Deepseek/Anthropic/Openai:false, enableFirecrawl/enableTinyfish:true`，另 11 个 `*ApiKeyEnv`/`*BaseURL`/`*Model`/`tavilySearchDepth`/`enabledBackends:[]` | 与 `Config` 声明一致（[B] `lib/index.js:160-283`） | A |
| 1.8 | `base` vs `user` | 同上 | `base.enableFirecrawl=false, base.enableTinyfish=false`（schema 默认），`user.enableFirecrawl=true, user.enableTinyfish=true`；`value` 是合并结果 | 三层（base/user/value）语义清晰，无漂移 | A |
| 1.9 | health 全量字段 | `authcurl /api/unified-search/health \| jq .` | `{"ok":true,"enabled":6,"keyless":6,"backends":[...13 项...],"updatedAt":1794147565225}`；每项含 `id/enabled/keyless/optionalKey/metered/reachable/lastOk/lastError` | 字段齐全；`enabled=6, keyless=6` 与 settings 的 6 个开关一致 | A |
| 1.10 | health 只读性 | 保存 settings 前后各取一次 health | `updatedAt` 变化（每次 `Date.now()`），`backends[].lastOk/lastError` **不因 settings 保存而变** | health 不主动探测、不写后端状态，符合 [B] `lib/health.js:45-80` | A |
| 1.11 | history GET（认证） | `authcurl /api/websearch/history` | `200` `{"ok":true,"entries":[35 条…],"backends":[6 项 {id,ok,ms,at,failCount,cooled}]}` | 历史 + 每后端最近结果与熔断态可读 | A |
| 1.12 | history 未授权 | `curl -i /api/websearch/history` | `401` `{"ok":false,"error":"untrusted request"}` | fence 生效 | A |
| 1.13 | clear 未授权 | `curl -i -X POST /api/websearch/history/clear` | `401` `{"ok":false,"error":"untrusted request"}` | fence 生效（未真清） | A |
| 1.14 | clear 跨站标记 | `authcurl -X POST -H 'Origin: http://127.0.0.1:3080' -H 'Sec-Fetch-Site: cross-site' .../history/clear` | `401` `{"ok":false,"error":"untrusted request"}` | Host `connection.admit` 拒绝跨站（优先于结构 fence） | A |
| 1.15 | clear 伪造 Host | `authcurl -X POST -H 'Host: evil.example' .../history/clear` | `401` `{"ok":false,"error":"untrusted request"}` | DNS-rebinding 被拒 | A |
| 1.16 | clear 错误方法 / 错误路径 | `GET .../history/clear` → `405 {"ok":false,"error":"method not allowed (POST only)"}`；`POST /api/websearch/clear`（任务书写的路径）→ `404 not found` | 两路径不同；**真实 clear 端点是 `/api/websearch/history/clear`**（[B] `lib/history.js:159`） | A |
| 1.17 | 清历史未发生 | 上述 fence 探测后 `authcurl .../history \| jq '.entries\|length'` | `35` → 后续真实搜索增至 `39`，磁盘 `history.json` `6057` 字节 | 全程未清空 | A |
| 1.18 | `web_fetch` | `web_fetch({url:"https://example.com"})` | `Fetched https://example.com/ (HTTP 200)` + `Example Domain` 正文 | 出口可用，fetch 链路正常 | A |
| 1.19 | 真实搜索 #1（单查询） | `web_search({queries:["DSH task-31 runtime E2E numResults 9 probe 2026-11-08"]})` | `[websearch backends] exa ✗3413ms (MCP tools/call HTTP 429…) · firecrawl ✗4348ms · searxng ✗4686ms (SearXNG: invalid JSON response) · ddg ✗5004ms (unified search aborted) · parallel ✓5545ms/8 · tinyfish ✓5959ms/8`；输出 `(Showing the first 8 sources…)` | 见 §3 | A |
| 1.20 | 真实搜索 #2（多查询 2 条） | `web_search({queries:["OpenAI prompt caching documentation","Anthropic prompt caching pricing"]})` | 两段独立结果头 + 两段独立遥测行，各 `parallel ✓…/8`、`tinyfish ✓…/8`；合并 `Sources:` 8 条 | 多查询 fan-out 生效（`queries.length>1`） | A |
| 1.21 | 真实搜索 #3（熔断态） | `web_search({queries:["OpenCode v2 websearch providers"]})` | 遥测 `tinyfish ✓5597ms/8 · parallel ✓6888ms/8 · exa ⏸cooled 12s · ddg ⏸cooled 15s · searxng ⏸cooled 13s · firecrawl ⏸cooled 13s` | 熔断真实跳过 4 个后端（见 §6） | A |
| 1.22 | 缓存命中 | 立刻重复 #3 的同一 query | 输出**只有** `[websearch cache] cache hit, age 17s` + 8 条来源，**无 `[websearch backends]` 行**；history 新增 `{resultCount:8, backendsOk:0, backendsTotal:0}` | 缓存命中短路 fan-out，注记正确 | A |
| 1.23 | 空 query | `web_search({queries:[""]})` | `Error: each query must be a non-empty string`；history 条数**未增加** | 早拒不扇出（host tool 层 `parseSearchArgs` 先拒） | A |
| 1.24 | CJK query | `web_search({queries:["深度求索 DeepSeek Harness 网页搜索插件 运行时熔断冷却机制 2026"]})` | 中文结果头 + 8 条来源 + 遥测 `parallel ✓6505ms/8 · tinyfish ✓6727ms/8` | CJK 正常 | A |
| 1.25 | 超长 query（~1900 字符） | `web_search({queries:["DSH task-31 long query …×N"]})` | 正常返回 8 条；history 中 `query` 长度 **500**（被 `toPublicEntry` 截断）；遥测正常 | 查询被 `shapeQuery` 截到 1500（[B] `lib/prompting.js:27,51`），历史截到 500（[B] `lib/history.js:19`）；无溢出/崩溃 | A |
| 1.26 | `resultTelemetry` 开关 | POST `set resultTelemetry=false`（rev 2）→ 立刻 `web_search({queries:["DSH task-31 telemetry-off probe…"]})` | 输出**无 `[websearch backends]` 行**，只有结果头 + 8 条来源 | **实时生效**：证明 `current()` 每次搜索都读 settings service（[B] `lib/index.js:474-481`） | A |
| 1.27 | 乐观并发冲突 | POST `{"expectedRevision":0,"ops":[set numResults=10]}` 于 rev=1 时 | `409` `{"ok":false,"code":"SETTINGS_CONFLICT","error":"settings changed elsewhere; reload and retry"}`；随后 GET 仍 `numResults:9, revision:1` | 冲突被拒且**未写入** | A |
| 1.28 | 字段校验 | POST 未知字段 / 非法值 / 错误 content-type | `400 unknown settings field "notAField"` / `400 invalid value for "numResults"`（999）/ `400 content-type must be application/json` | `validateOp` 按 `Config.dict` 校验生效 | A |
| 1.29 | 方法限制 | `POST /api/unified-search/health` → `405 method not allowed (GET only)`；`HEAD /api/unified-search/settings` → `200` | 符合 [B] `lib/health.js:101`、`lib/settings-api.js:58` | A |
| 1.30 | 启动日志 | `grep -in 'warn\|error'` + 逐模式计数 | 16 行日志，仅 3 类已知告警：`ExperimentalWarning: SQLite`（L1-2）、`dsh: warning: 1 entry did not activate`（L4）、`dsh-purge … ERR_MODULE_NOT_FOUND: Cannot find package 'yaml'`（L5-15）；`without inject` / `remote.credentials` / `websearch pending` / `models.dev` / `timeout` 均 **0 命中** | 无新告警 | A |
| 1.31 | journal | `journalctl -u dsh-web.service --since "2026-11-08 18:34:00" -o cat` | 7 行，全为 Chrome 扩展垃圾回收 INFO（19:56–20:35），**零 WARN/ERR** | 无新告警 | A |

---

## 2. 保存 → 执行闭环（无害字段，已完整回改）

### 2.1 完整时序（全部认证 POST，带 `expectedRevision`）

| 步 | 操作 | 返回 | 级 |
| --- | --- | --- | --- |
| S1 | GET（基线） | `revision:0, numResults:8, resultTelemetry:true, user:{numResults:8,enableFirecrawl:true,enableTinyfish:true}` | A |
| S2 | POST `expectedRevision:0, set numResults=9` | `ok:true, revision:1, value.numResults:9, user.numResults:9` | A |
| S3 | POST `expectedRevision:0, set numResults=10`（陈旧 rev） | `409 SETTINGS_CONFLICT`（未写入） | A |
| S4 | GET | `revision:1, numResults:9` | A |
| S5 | health（保存后） | `enabled:6, keyless:6, updatedAt` 变，`backends[].lastOk/lastError` 不变 | A |
| S6 | **真实搜索**（numResults=9 期间） | 遥测 `parallel ✓…/8 · tinyfish ✓…/8`；输出 `(Showing the first 8 sources…)`；history `resultCount:8, backendsOk:2, backendsTotal:6` | A |
| T1 | POST `expectedRevision:1, set resultTelemetry=false` | `ok:true, revision:2, resultTelemetry:false` | A |
| T2 | **真实搜索**（telemetry=false 期间） | 无 `[websearch backends]` 行 → **实时生效** | A |
| N1 | POST `expectedRevision:6, set numResults=1` | `ok:true, revision:7, numResults:1` | A |
| N2 | **真实搜索**（numResults=1 期间） | 遥测仍 `parallel ✓6576ms/8 · tinyfish ✓7336ms/7`，输出 8 条来源 | A |
| R1 | POST `expectedRevision:2, set numResults=8 + set resultTelemetry=true` | `ok:true, revision:3`，两字段回 8/true | A |
| R2 | GET | `revision:3, numResults:8, resultTelemetry:true` | A |
| R3 | POST `expectedRevision:3, unset resultTelemetry` | `ok:true, revision:4`，`user` 去掉该键（回到 schema 默认） | A |
| R4 | POST `expectedRevision:4, unset numResults` | `ok:true, revision:5`，`user` 去掉 `numResults` | A |
| R5 | POST `expectedRevision:5, set numResults=8` | `ok:true, revision:6` | A |
| N2-revert | POST `expectedRevision:7, set numResults=8` | `ok:true, revision:8` | A |
| 终态 | GET | `ok:true, namespace:dsh-websearch, writable:true, applies:live, revision:8, numResults:8, resultTelemetry:true, user:{numResults:8,enableFirecrawl:true,enableTinyfish:true}` | A |

### 2.2 关键观察：`numResults` 保存成功但**对真实搜索完全无效**

- `numResults=9`（rev 1）→ 真实搜索仍返回 8 条、后端仍报告 `/8`。
- `numResults=1`（rev 7）→ 真实搜索**仍返回 8 条**、后端仍报告 `/8`。
- 反面对照：`resultTelemetry=false` 保存后**下一次真实搜索立即不再输出遥测行**，证明设置值确实被 `current()` 读到（[B] `lib/index.js:474-481` → `resolveOptions(ctx, current())`）。
- 根因（[B/D]）：host 工具 `@deepseek-ai/dsh-tool-web` 把**自己的** `searchMaxResults`（默认 `WEB_SEARCH_MAX_RESULTS = 8`，`packages/web/tool-web/src/search.ts:19`）作为 `request.maxResults` 传给 `ctx.web.search`（同文件 `:238/:246/:367`）；provider 在 `lib/provider.js:198` 用 `request?.maxResults || opts.numResults` —— **`request.maxResults` 恒为 8，永远覆盖 `opts.numResults`**。本机 `cordis.patch.yml` 的 `tool-web` 只配了 `fetch:true, searchTimeoutMs:60000`，未设 `searchMaxResults`，所以恒为 8。
- 结论：**Settings 面板里 `numResults`（描述「每次搜索返回的最大结果数」）在真实 `web_search` 调用中是死设置**；只有当调用方不传 `maxResults`（如某些直接 `ctx.web.search` 的内部消费者）时才生效。这是只有跑起来才能暴露的跨包语义冲突（插件 schema 与 host 工具配置各自定义同名概念但优先级相反）。

### 2.3 revision 与持久化的两个次生现象

- **revision 单调但非持久**：`revision` 从 0 → 8 一路递增，`applies:"live"`；但 `revision` 是 settings service 的**进程内**计数器，服务重启会归零（本次未重启，`NRestarts=0` 佐证）。此前报告 `25-execution-log.md:412` 记的「revision 0→1→2」与本轮 0→8 是不同进程的计数，不能跨重启比较。[A/D/E]
- **写操作会落盘 profile patch**：每次 POST 后 `/home/dsh/.dsh/profiles/web/cordis.patch.yml` 的 `dsh-websearch.config` 被改写（观察到 `resultTelemetry:true` 残留键、`numResults` 键重排到末尾）。`unset` 能删掉残留键；**最终 md5 `a1f99cf52d309c6b9e7635d202869b15` 与探测前快照字节一致**（探测前首次读到的 md5 即 `a1f99cf…`，见 §2.4），配置块解析后为 `{numResults:8, enableFirecrawl:true, enableTinyfish:true}`。[A/B]

### 2.4 回改与无残留声明（任务书要求）

| 检查 | 结果 | 级 |
| --- | --- | --- |
| `GET settings` `value.numResults` | `8`（基线 8） | A |
| `GET settings` `value.resultTelemetry` | `true`（基线 true） | A |
| `GET settings` `user` | `{numResults:8, enableFirecrawl:true, enableTinyfish:true}`（与基线逐键一致） | A |
| `cordis.patch.yml` `dsh-websearch` 块 | 3 键，语义与基线一致；**md5 与探测前 `a1f99cf5…` 字节相同** | A/B |
| `cordis.patch.yml` 是否有 `resultTelemetry` 残留键 | **无**（R3 `unset` 已删） | A |
| `.credentials.yaml` mtime | `2026-11-07 15:38:42`（探测前，未变） | A |
| `dsh-web.service` `MainPID` / `NRestarts` | `587384` / `0`（未重启） | A |
| 插件 `lib/*.js` md5 | 31 个文件逐一记录，未修改（§8 列前 30） | B |
| 唯一写文件 | 仅本报告 `55-audit-runtime.md` | A |

> 说明：任务书说「不执行任何写操作到 settings/credentials」；本轮按任务书第 2 条**显式授权**的「保存→执行闭环」只改了 `dsh-websearch` 命名空间的无害字段 `numResults`/`resultTelemetry`（非凭证、非密钥、非其它命名空间），并全部改回；**未触碰 credentials 服务、未填任何 API key、未写 `.credentials.yaml`**。`history` 新增条目是真实搜索的必然副作用（append-only 历史，非人为写入），已如实记录。

---

## 3. 真实工具遥测逐次记录（代码缺陷 vs 出口抖动）

| # | 查询 | 遥测行（真实输出） | 结果数 | 分类 |
| --- | --- | --- | --- | --- |
| W1 | `DSH task-31 runtime E2E numResults 9 probe 2026-11-08` | `exa ✗3413ms (MCP tools/call HTTP 429: {"jsonrpc":"2.0) · firecrawl ✗4348ms (firecrawl returned an MCP error: Anonymo) · searxng ✗4686ms (SearXNG: invalid JSON response) · ddg ✗5004ms (unified search aborted) · parallel ✓5545ms/8 · tinyfish ✓5959ms/8` | 8 | 混合：exa=额度、firecrawl=匿名额度、searxng/ddg=出口/超时、parallel/tinyfish=可用 |
| W2-a | `OpenAI prompt caching documentation`（2 查询之一） | `exa ✗2798ms (429) · firecrawl ✗3536ms · searxng ✗3547ms (invalid JSON) · parallel ✓4511ms/8 · ddg ✗5003ms (aborted) · tinyfish ✓10803ms/8` | 8 | 同上；tinyfish 单次 10.8s 抖动 |
| W2-b | `Anthropic prompt caching pricing`（2 查询之二） | `exa ✗2792ms (429) · firecrawl ✗3547ms · searxng ✗3551ms (invalid JSON) · ddg ✗5004ms (aborted) · parallel ✓5144ms/8 · tinyfish ✓5988ms/8` | 8 | 同上 |
| W3 | `OpenCode v2 websearch providers`（熔断窗口内） | `tinyfish ✓5597ms/8 · parallel ✓6888ms/8 · exa ⏸cooled 12s · ddg ⏸cooled 15s · searxng ⏸cooled 13s · firecrawl ⏸cooled 13s` | 8 | 熔断生效，2 个后端撑起全部结果 |
| W4 | 同 W3 立刻重跑 | `[websearch cache] cache hit, age 17s`，**无遥测行** | 8 | 缓存命中 |
| W5 | `DSH task-31 telemetry-off probe…` | **无遥测行**（`resultTelemetry=false` 生效） | 8 | 设置实时生效 |
| W6 | CJK 长查询 | `exa ✗3964ms (429) · ddg ✗5002ms (aborted) · searxng ✗5002ms (aborted) · firecrawl ✗5296ms · parallel ✓6505ms/8 · tinyfish ✓6727ms/8` | 8 | searxng 从 `invalid JSON` 变 `aborted`（抖动） |
| W7 | 超长 query（~1900 字符） | `parallel ✓…/8 · tinyfish ✓…/8`（`resultTelemetry=false` 期间，无遥测行） | 8 | 查询被截到 1500 字符 |
| W8 | `DSH task-31 numResults-1 boundary probe…` | `exa ✗2256ms (429) · firecrawl ✗3199ms · searxng ✗4422ms (invalid JSON) · ddg ✗5003ms (aborted) · parallel ✓6576ms/8 · tinyfish ✓7336ms/7` | 8 | `numResults=1` 仍 `/8`，见 §2.2 |

**代码缺陷 vs 环境抖动区分**：
- **环境抖动 / 额度**：exa `HTTP 429`（真实额度串，见 §6.3）、firecrawl `Anonymous keyless access is unavailable…`（匿名额度）、searxng `invalid JSON response`/`unified search aborted`（公共实例反爬 / 5s 超时，两种错误串交替出现，说明是**同一抖动源的不同截断**）、ddg `unified search aborted`（5s 超时）、tinyfish 5.6–10.8s 延迟波动。
- **代码缺陷**：`numResults` 死设置（§2.2）、`unified search aborted` 误导模型（§4.2）、`firecrawl` 错误串被截到半句（§4.3）、`lastError` 截断层级不一致（§4.4）、`revision` 非持久（§4.6）、cache 命中时 `backendsOk/Total=0` 语义误导（§4.5）。

---

## 4. 运行时缺陷清单（P0 / P1 / P2）

### P0 — 无（本轮未发现会导致数据丢失、越权、服务不可用或结果错误的运行时 P0）

### P1

**P1-1 `numResults` 设置在真实 `web_search` 下完全无效（跨包优先级冲突）**
- **证据**：[A] S2/T2/N1/N2 时序；`numResults=9` 与 `numResults=1` 两次真实搜索输出均 8 条、后端均 `/8`；对照 `resultTelemetry=false` 下一次搜索立即生效，排除「设置没读到」。 [B/D] `packages/web/tool-web/src/search.ts:19` `WEB_SEARCH_MAX_RESULTS=8`、`:238/:246/:367` 把 `maxResults` 传入 `ctx.web.search`；`lib/provider.js:198` `request?.maxResults || opts.numResults` 让 host 值恒覆盖插件值；本机 `cordis.patch.yml:368-373` 的 `tool-web` 未设 `searchMaxResults`。
- **影响**：Settings 面板「每次搜索返回的最大结果数」是**误导性死设置**；用户改为 1/50 都不会改变任何真实搜索行为；`maxResults` 极值（1/50）**通过工具无法验证**（见 §7）。
- **复现**：认证 POST `set numResults=1` → `web_search` 任意查询 → 仍 8 条；改回 8。
- **修法建议**（三选一，按侵入性排序）：① 插件 `provider.js:198` 改为 `Math.min(request?.maxResults ?? Infinity, opts.numResults)` 并文档化「host cap 与 plugin cap 取小」；② host `tool-web` 暴露 `searchMaxResults` 并在 `cordis.patch.yml` 与插件 `numResults` 对齐，同时把插件字段标为「仅对不传 maxResults 的调用方生效」；③ 统一到单一所有权（推荐：host 工具拥有结果上限，插件删除 `numResults` 或改名为 `fallbackMaxResults` 并在 UI 明确）。必须补一条真实 E2E 回归（保存 1 → 搜索返回 1）。[D/E]

**P1-2 错误文案 `unified search aborted` 被当作后端失败原因呈现，误导模型自诊断**
- **证据**：[A] health `ddg.lastError="unified search aborted"`、searxng 在 W6 也变同一串；遥测行 `ddg ✗5004ms (unified search aborted)`；history 把它记为失败原因。 [B/D] `lib/util/abort.js:29-33`：`searchAborted()` 的固定 message 就是 `"unified search aborted"`，`WEB_ABORTED` code；`lib/provider.js:341,360-366` 中 `ddg/searxng` 的 5s 超时由 `BACKEND_TIMEOUT_OVERRIDES_MS`（`lib/provider.js:39-42`）= 5000 触发 `controller.abort()`，后端 `catch` 里 `signal.aborted` 为真 → `throw searchAborted(signal, err)`（[B] `lib/backends/ddg.js:56`），于是**超时的真实原因（5s timeout）被替换成「搜索被中止」**；`collectFanoutResults`（`lib/provider.js:146-149`）只在 `signal?.aborted`（调用方）时判 hard，否则把该 WebError 塞进 `failures`，health 的 `lastError` 就取到这个 message。
- **影响**：health / 遥测把「出口超时/反爬」报告成「用户/调用方取消」；模型看到 `unified search aborted` 会以为是自己取消或工具层取消，从而做出错误重试/放弃决策；`rateLimited()` 也不会把它归类为额度（[B] `lib/util/failure-label.js:6-9`），熔断只按普通失败累计。
- **复现**：任意真实搜索 → `GET health` 看 `ddg.lastError`；或观察遥测行 `ddg ✗5003ms (unified search aborted)`（耗时恰为 5000ms 附近是铁证）。
- **修法建议**：超时分支在 `provider.js:360-366` 已经能识别 `controller.signal.aborted && !(signal && signal.aborted)`，应把该 WebError 的 message 改为 `backend "<id>" timed out after <N>ms` 并透传到 telemetry/health（当前 `collectFanoutResults` 用 `settled.reason` 但 `recordBackendHealth` 在 `runBackend` 的 rejection 分支里先记的是**原始** `err.message`，即 `unified search aborted`）；或让 `searchAborted` 接受原因参数并保留 `cause`。至少在 `failure-label.js` 增加对 `unified search aborted` 的「可能是超时」标注。[D]

### P2

**P2-1 `firecrawl` 错误串被双重截断，health/遥测只剩半句，无法判别真实额度原因**
- **证据**：[A] health `lastError = "firecrawl returned an MCP error: Anonymous keyless access is unavailable for thi"`（len 80，正好 80）；遥测 `firecrawl ✗… (firecrawl returned an MCP error: Anonymo)`（40 字符，`slice(0,40)`）。 [B/D] `lib/provider.js:352` 先把 `err.message.slice(0,80)` 存进 telemetry/health；`lib/health.js:12,30` 的 `MAX_ERROR_CHARS=120` **永远够不到**（上游已截 80）；`lib/provider.js:456` 遥测行再 `slice(0,40)`；`lib/history.js` 不暴露 error 串。
- **影响**：模型/运维只看到 `…for thi`，无法知道是「匿名 keyless 不可用」还是「需 API key」；`rateLimited()` 靠 `/Anonymo|quota/` 匹配（[B] `failure-label.js:8`），恰好还能命中 `Anonymo`（**若截断更短就会漏分类**，属脆弱耦合）。
- **修法建议**：把 80/40 两级截断统一到一个常量（如 health 120、遥测 60），或 health 直接读未截断的 `error`；对 quota 类错误优先保留关键字尾巴。[D]

**P2-2 cache 命中写入 `backendsOk:0, backendsTotal:0`，历史/观测语义自相矛盾**
- **证据**：[A] W4 缓存命中后 history 新增 `{query:…, resultCount:8, backendsOk:0, backendsTotal:0}`；同一次搜索前一条是 `{resultCount:8, backendsOk:2, backendsTotal:2}`。 [B/D] `lib/provider.js:258-264` 缓存命中分支硬编码 `backendsOk:0, backendsTotal:0`。
- **影响**：`backendsTotal=0` 与 `resultCount=8` 并存；若 GUI/运维按 `backendsOk/backendsTotal` 算成功率会得 `0/0`；与「零结果但全成功」分支（`:479-485`）的 `0/0` 无法区分。
- **修法建议**：用 `cached:true` 显式标记，或 `backendsTotal` 保留上次值；至少在 `history` 输出加 `source:"cache"` 字段。[D]

**P2-3 `revision` 是进程内计数器，跨重启不持久但 API 未声明**
- **证据**：[A] 本轮 0→8；`NRestarts=0` 全程未重启；`GET settings` 无 `revision` 语义说明，`applies:"live"`。 [B/D] `lib/settings-api.js:112` 直接取 `settings.describe()` 的 `view.revision`，`lib/util/namespace.js` 未提供持久化；此前 `25-execution-log.md:412` 的另一次探测也是 0→1→2（不同进程/不同时点）。
- **影响**：两个客户端各自持有旧 `expectedRevision`，服务重启后都从 0 开始，乐观并发保护在重启边界失效（重启后第一个写者无条件成功）。
- **修法建议**：API 增加 `revisionScope:"process"` 字段或在文档写明；若需跨重启保护应改持久计数。[D/E]

**P2-4 `curl -L` 直接跟随 303 仍 401（认证链路 DX 陷阱，非产品缺陷）**
- **证据**：[A] 1.5。`Set-Cookie` 在 303 响应里，curl 默认不把该响应 cookie 回带；必须显式 `-c/-b` cookie jar 或先提取 `set-cookie` 再用 `-H Cookie:`。
- **影响**：任务书「`curl -L` 跟随 303 拿会话 cookie」的表述会让后续审计者踩坑；不影响浏览器（浏览器自动带 cookie）。
- **修法建议**：无代码修改，运维文档给出正确 curl 配方（本报告 §1 已给）。[A/D]

**P2-5 settings 写落盘时键序重排，回改后字节级 md5 需额外 `unset` 才完全一致**
- **证据**：[A/B] R1 后 `cordis.patch.yml` 多出 `resultTelemetry:true` 且 `numResults` 被排到末尾，md5 从 `a1f99cf…` 变 `9e2d028…`；经 R3(`unset resultTelemetry`)+R4(`unset numResults`)+R5(`set numResults=8`)+N2-revert 才回到 `a1f99cf…`。
- **影响**：「把值改回原值」并不等价于「无残留」——会多写默认键、改变键序；对配置漂移审计/回滚链是隐患（本轮已完全恢复）。
- **修法建议**：`settings.mutate` 对「值等于 schema 默认」的 `set` 做归一化删除，或写盘时保持原键序。[D/E]

---

## 5. 环境抖动分类表（6 个启用后端逐个可达性）

> 依据：health 的 `reachable/lastOk/lastError`、最近 history `backends[].ok/ms/at/failCount/cooled`、以及 8 次真实搜索遥测。判定口径：**可用**=本窗口有 `lastOk` 且返回来源；**额度**=真实 429/匿名额度串；**反爬**=公共实例返回非 JSON/超时；**出口抖动**=同一后端错误串在两次运行间变化；**代码缺陷**=见 §4。

| 后端 | enabled/keyless/optionalKey/metered | health 终态 | 最近 history | 真实遥测典型 | 判定 | 级 |
| --- | --- | --- | --- | --- | --- | --- |
| **exa** | ✓/✓/✗/✗ | `reachable:false, lastOk:1794134512951(18:41:52), lastError:"MCP tools/call HTTP 429: {\"jsonrpc\":\"2.0\"…"` | `ok:false, ms:2256–4314, failCount:6, cooled:false` | 每次必现 `✗ HTTP 429`，W1–W8 全中 | **额度**（keyless 429），非代码缺陷；`rateLimited()` 因含 `HTTP 429` 正确命中 → 首次失败即冷却 | A/D |
| **parallel** | ✓/✓/✗/✗ | `reachable:true, lastOk:1794149964638` | `ok:true, ms:4511–7970, failCount:0` | 每次 `✓…/8`，8/8 次全成功 | **可用**（主力） | A |
| **ddg** | ✓/✓/✗/✗ | `reachable:false, lastOk:null, lastError:"unified search aborted"` | `ok:false, ms:5002–5011, failCount:7` | 每次 `✗5003ms (unified search aborted)`，耗时恒 ≈5000ms | **出口抖动/超时**（5s 硬超时）+ **代码缺陷 P1-2**（错误文案） | A/D |
| **searxng** | ✓/✓/✓/✗ | `reachable:false, lastOk:null, lastError:"SearXNG: invalid JSON response"` | `ok:false, ms:3547–5009, failCount:7` | W1/W2/W8 `invalid JSON response`，W6 `unified search aborted` | **反爬/出口抖动**（公共实例 searx.be 返回 HTML/验证码或两个 5s 超时分支）；错误串在两种间漂移 | A/D |
| **firecrawl** | ✓/✓/✓/✓ | `reachable:false, lastOk:null, lastError:"firecrawl returned an MCP error: Anonymous keyless access is unavailable for thi"` | `ok:false, ms:3199–5689, failCount:7` | 每次 `✗…(firecrawl returned an MCP error: Anonymo)` | **额度**（匿名 keyless 不可用）+ **代码缺陷 P2-1**（半句截断）；`rateLimited()` 靠 `Anonymo` 命中 | A/D |
| **tinyfish** | ✓/✓/✓/✓ | `reachable:true, lastOk:1794149965568` | `ok:true, ms:5597–10803, failCount:0` | 每次 `✓…/8`（一次 `/7`），8/8 次全成功 | **可用**；延迟 5.6–10.8s 有出口抖动但不失败 | A |

**6 个后端汇总**：2 可用（parallel/tinyfish）、2 额度（exa 429 / firecrawl 匿名）、2 反爬/超时（searxng/ddg）。**每次真实搜索都由 parallel + tinyfish 撑起全部 8 条结果**，`backendsOk:2, backendsTotal:6` 稳定；没有出现「全部后端失败」的 WEB_PROVIDER_ERROR，fail-open 设计有效。

### 5.1 熔断 / 冷却实测

| 观测 | 真实输出 | 判定 | 级 |
| --- | --- | --- | --- |
| 429 立即冷却 | W1 后 history `exa {failCount:1, cooled:true}`，`firecrawl {failCount:2, cooled:true}` —— **未达 `breakerThreshold:3` 就 cooled** | [B] `lib/breaker.js:43-46` 对 `rateLimited` 立即 `cooledUntil=now+retryAfterMs`；`retryAfterMsFrom` 因 WebError 无 response headers 回落固定 60s（`lib/util/failure-label.js:18`） | A/D |
| 普通失败累计到阈值 | W1 后 `searxng/ddg {failCount:1..2, cooled:false}`；W2 后 `failCount:3..4, cooled:true` | 阈值 3 生效 | A/D |
| 冷却期跳过 + 注释 | W3 遥测 `exa ⏸cooled 12s · ddg ⏸cooled 15s · searxng ⏸cooled 13s · firecrawl ⏸cooled 13s`，只剩 parallel/tinyfish 两个 `✓` | `lib/provider.js:295-305` 跳过 cooled，`lib/provider.js:446-457` 追加 `⏸cooled Ns` 注释 | A |
| 冷却不使搜索变差 | W3 仍返回 8 条 | fail-open（`lib/provider.js:303-304` 全 cooled 才放行）未触发但设计正确 | A |
| 冷却窗口到期自动恢复 | 约 60s 后 W6/W8 又出现 6 个后端全部 `✗/✓` 遥测，`cooled:false, failCount` 继续累加到 6–7 | `isCooled` 按 `cooledUntil > now` 判定，窗口过期即恢复；但 `failCount` **不因冷却到期而清零**，会一路累加（见 §5.2） | A/D |
| 429 分类命中真实串 | `lastError` 含 `HTTP 429` → `/HTTP 429/` 命中；`firecrawl` 含 `Anonymo` → `/Anonymo/` 命中 | 分类逻辑与真实错误串耦合成立 | A/D |

### 5.2 熔断计数器的状态漂移（P2 级观察，非 P1）

`failCount` 只由「成功」清零（`lib/breaker.js:39`）。冷却窗口到期后若仍失败，`failCount` 从 6→7 继续增长且**每次都重新开一个 60s 窗口**；对持续不可用的 ddg/searxng/firecrawl，`failCount` 单调无界增长（本次观测到 7，未到 20 上限但无封顶逻辑）。`history.backends[].failCount` 因此是「自进程启动以来的累计失败数」而非「当前连续失败数」，与字段名/文档「consecutive failures」不符。[A/D/E] 修法建议：冷却到期时把 `failCount` 重置为 0 或 1，或在 `toBackendObservability` 中改名为 `totalFailures` 并另给 `consecutiveFailures`。

---

## 6. 边界探测汇总

| 边界 | 方法 | 真实结果 | 判定 | 级 |
| --- | --- | --- | --- | --- |
| 多查询 `queries.length>1` | W2（2 条） | 两段独立结果头 + 两段独立遥测行，合并 8 条来源；history 新增 2 条（每 query 一条，`time` 差 4.8s） | 生效 | A |
| `maxResults=1` | settings `numResults=1` + W8 | 仍 8 条 → **无法通过工具验证极值**，见 P1-1 | 不可验证（被 host 覆盖） | A |
| `maxResults=50` | 同上推断 | `tool-web` 默认 8 且未配 `searchMaxResults`，无法从工具侧触发 50 | 无法验证（见 §7） | D |
| 超长 query | W7（~1900 字符） | 正常 8 条；`shapeQuery` 截到 1500；history `query` 截到 500 | 无溢出，双层截断 | A/B |
| CJK query | W6 | 中文结果头、8 条来源、遥测正常 | 正常 | A |
| 空 query | `queries:[""]` | `Error: each query must be a non-empty string`；history 未增加 | 早拒不扇出（host tool 层） | A |
| 缓存命中 | W3→W4 同 query 连跑 | 第二次 `[websearch cache] cache hit, age 17s`，无遥测行；history `backendsOk/Total:0/0` | 命中生效；注记正确；统计字段缺陷 P2-2 | A |
| `resultTelemetry` 开关 | T1→W5 | 关闭后下一次搜索无遥测行 | 实时生效 | A |
| 乐观并发 | S3 | 409 冲突，无写入 | 生效 | A |
| 字段校验 | F8/F9/F7 | 400 + 固定文案 | 生效 | A |

---

## 7. 已确认无误 / 无法验证

### 7.1 已确认无误

| # | 结论 | 证据 | 级 |
| --- | --- | --- | --- |
| C1 | 认证 fence 全链路有效：未授权 401、跨站 `Sec-Fetch-Site`/Origin 拒、伪造 Host 拒、错误方法 405、错误路径 404 | 1.2/1.3/1.12–1.16/1.29 | A |
| C2 | `/api/websearch/history/clear` **未被真调用**；所有 fence 探测后历史仍完整（35→39 条，磁盘 6057B） | 1.17 | A |
| C3 | `GET settings` 的 `ok/namespace/writable/applies/revision/value/base/user` 与 `Config` 一致，无状态漂移 | 1.6–1.8 | A |
| C4 | health 只读、不探测、不消耗额度；保存 settings 不改变后端遥测 | 1.10 | A |
| C5 | `history` 暴露的每后端 `ok/ms/at/failCount/cooled` 与真实搜索时序吻合 | 5.1 | A |
| C6 | 熔断/冷却/fail-open/`⏸cooled` 注释/429 立即冷却 全部真实生效 | 5.1 | A |
| C7 | 缓存命中短路 fan-out，`cache hit, age Ns` 注记出现，来源与首次一致 | 1.22 | A |
| C8 | 空 query 早拒、CJK、超长 query、多查询均不崩溃 | 6 | A |
| C9 | `resultTelemetry=false` 保存后下一次真实搜索立即生效 → `current()` 实时读 settings service 的修复（PR #7 镜像）在运行态成立 | 1.26 | A |
| C10 | 启动日志无新增告警；无 `without inject` / `remote.credentials` / `websearch pending` / `models.dev timeout`；journal 零 WARN/ERR | 1.30/1.31 | A |
| C11 | 全程 `NRestarts=0`，`MainPID=587384` 未变；未重启服务 | 1.1/2.4 | A |
| C12 | 凭证文件 `.credentials.yaml` mtime 未变；未写任何 credential/API key | 2.4 | A |
| C13 | 插件 31 个 `lib/*.js` 未被改动；`cordis.patch.yml` md5 回改后与探测前字节一致 | 2.4/§8 | A/B |

### 7.2 无法验证

| # | 项 | 原因 | 级 |
| --- | --- | --- | --- |
| U1 | `maxResults` 极值 1 / 50 的真实效果 | host `tool-web` 把 `maxResults` 恒设为自己的 `searchMaxResults=8`（未配置，取默认），`web_search` 工具不暴露该参数；从工具侧无法传 1 或 50。仅通过 settings `numResults` 间接尝试，被 P1-1 证明无效 | A/D |
| U2 | 7 个未启用后端（brave/tavily/serper/mojeek/deepseek/anthropic/openai）的可达性 | `enabled:false`，health 的 `reachable:null`，需填真实第三方 Key 才能激活；任务书禁止写 credentials，本轮不做 | A |
| U3 | `enabledBackends` 显式列表覆盖路径 | settings 中 `enabledBackends:[]`，本轮未改（会改变 6 后端组合、超出「无害字段」授权） | A/D |
| U4 | `multiQueryEnabled` / `deepCoverage` 的 RRF 融合与 50% 扩容 | 两者默认 false，开启会显著改变扇出与额度消耗；本轮按「只读 + 无害字段」约束未改 | A/D |
| U5 | `cacheTtl` 过期淘汰、`maxEntries=200` 淘汰、`breakerCooldownMs=0` 关闭冷却 | 需改设置并等待/大量写入，超出本轮窗口；代码层已读（[B] `lib/cache.js:110-115,129-133`、`lib/breaker.js:36-38`） | A/B/E |
| U6 | `revision` 跨重启行为 | 需重启服务，任务书禁止 | A/E |
| U7 | 并发双写同一 `expectedRevision` 的竞态（两个 POST 同时到） | 需要精确并发编排；本轮串行验证了陈旧 rev 的 409，未做真并发 | A/D |
| U8 | `web_fetch` 的非 200 / 超时 / 大响应边界 | 本轮只按任务书取 `https://example.com`（200） | A |
| U9 | 7 个 `lastOk` 为 null 的后端是否曾在本进程早期成功过 | health 的 `lastOk` 是模块级 Map（进程内），重启清空；服务已运行 3h41m，18:41 的 `lastOk` 说明 exa 在早期成功过，但无法回溯更早 | A/D |

---

## 8. 只读完整性指纹（证明未改源码）

| 文件 | md5 |
| --- | --- |
| `lib/index.js` | `0e733c0f17ce2100ccbedf3952aeef21` |
| `lib/provider.js` | `f1bf07e0d29ff3532504ca6ec76d967d` |
| `lib/settings-api.js` | `e6b4b118945bdec27fe170dc13196f00` |
| `lib/health.js` | `eec152a8269dca26899bcc5166bb0ebc` |
| `lib/trust.js` | `9f394d031b128c7a9d7a0750533bb312` |
| `lib/client.js` | `74df252ef1cc7d060f7f6d1fd0b3b23c` |
| `lib/history.js` | `b29fc9925edf47a99b5d4e4ae7b304a3` |
| `lib/cache.js` | `82627344bcc765a5fec4b0ca0c139b3b` |
| `lib/breaker.js` | `a84836018d9f3b6ffa605ca78dcc9306` |
| `lib/prompting.js` | `87b533b4249195b04da49d2a094b6f9c` |
| `lib/rrf.js` | `b7e1272aa6082eae2070e7df087f48b9` |
| `lib/multiquery.js` | `89eca03678d0e02057f975ec272eae0a` |
| `lib/util/abort.js` | `f3a8a36daab8bada8dae44c1928f346d` |
| `lib/util/failure-label.js` | `34692ba33ad403f177a20c9d0e05b809` |
| `lib/util/filters.js` | `89f5b7cd79a0bb21124f5c6beb3d4993` |
| `lib/util/log.js` | `ab1bc11f2dd0c3c34e4e405b74a36ab2` |
| `lib/util/mcp-client.js` | `9f3eb36c584fbff7232570639e6d3461` |
| `lib/util/egress-fetch.js` | `bc8f7997551b39adc732ec252c0f62cd` |
| `lib/backends/{exa,parallel,ddg,searxng,firecrawl,tinyfish}.js` | `d4d0999f… / 5df53070… / 5da56350… / 82c697af… / ee577f05… / bc5ac996…`（完整值见工具输出） |
| `/home/ova/re-agent/dsh-web.log` | `d0347c1b2ca64a70fc801ce265a27e1e`（16 行，未变） |
| `/home/dsh/.dsh/profiles/web/cordis.patch.yml`（**回改后**） | `a1f99cf52d309c6b9e7635d202869b15`（与探测前一致） |

---

## 9. 五条反直觉发现

1. **「保存成功」≠「设置生效」，且同一命名空间里两个字段命运相反。** `numResults` 保存返回 `ok:true, revision:1`，但真实搜索完全无视它（8→9→1 三次试验全部仍 8 条）；而 `resultTelemetry` 保存后下一次搜索立刻不再输出遥测行。根因不是「设置没读到」（`current()` 每次都读），而是 host `tool-web` 把 `maxResults=8` 塞进 request，`provider.js:198` 用 `request.maxResults || opts.numResults` 让插件值永远落空。**只有跑起来并同时测两个字段才能定位到「跨包优先级」而非「settings 桥接」**。 [A/D]

2. **`curl -L` 跟随 303 反而拿不到会话。** 303 响应里带 `Set-Cookie`，但 curl 默认不把该响应的 cookie 回带到 `location: ./` 的第二次请求，结果是 `401 dsh web authentication required`。浏览器不会踩这个坑（自动带 cookie），只有用 curl 做端到端审计才会暴露；正确做法是先从 303 头提取 `Set-Cookie` 再显式 `-H Cookie:`。 [A]

3. **「unified search aborted」不是用户取消，而是 5 秒超时。** ddg/searxng 硬超时 5000ms（`BACKEND_TIMEOUT_OVERRIDES_MS`），后端 `catch` 里因 `signal.aborted` 为真抛 `searchAborted()`，其固定 message 就叫 `unified search aborted`；于是 health/遥测把「出口超时/反爬」报成「搜索被中止」。遥测里 `✗5003ms (unified search aborted)` 的耗时恰在 5000ms 附近是决定性证据，模型看到这行会误判为自己取消了搜索。 [A/D]

4. **`failCount:1` 就能 `cooled:true`，且冷却到期后计数不清零。** 429/匿名额度被 `rateLimited()` 命中后 `foldBreaker` 立即开 60s 冷却，绕过 `breakerThreshold:3`；而 `failCount` 只在成功时清零，冷却窗口过期后继续累加（本次 ddg/searxng/firecrawl 累到 7），history 里的 `failCount` 实际是「进程启动以来累计失败数」，与注释里的 "consecutive failures" 不符。 [A/D]

5. **把值改回原值并不等于「无残留」。** `numResults 8→9→8` 之后 `cordis.patch.yml` 仍多出一个 `resultTelemetry:true` 默认键且键序被重排，md5 与探测前不同；必须再对两个字段各做一次 `unset` + 一次 `set numResults=8`，才把文件字节级恢复到 `a1f99cf…`。对「改回并说明」类闭环审计，只核对 `GET settings` 的值是不够的，必须核对落盘文件的 md5。 [A/B]

---

## 10. 给 Lead 的结论

- **运行时 P0：无。** 认证 fence、熔断、缓存、历史、日志均正常；未发现越权、数据丢失、服务不可用或结果错误。
- **最关键的运行时缺陷是 P1-1**：`numResults` 在真实 `web_search` 下是死设置（host `tool-web` 的 `maxResults=8` 恒覆盖），与 P1-2（`unified search aborted` 误导文案）共同构成「只有跑起来才暴露」的两项。
- **环境抖动占多数**：6 个启用后端中 4 个处于额度/反爬/超时状态，但 parallel + tinyfish 稳定撑起 8 条结果，fail-open 有效；**不要把这些判为代码回归**。
- 所有临时设置变更已完整回改，`cordis.patch.yml` md5 与探测前字节一致，凭证未触碰，服务未重启。

---

*报告完 · 专家 E · 2026-11-08 23:04 CST*
