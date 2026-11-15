# 56 · 全量 bug 审计裁决汇总（目标模式 · 骨架）

> 2026-11-08 22:05，用户「分配专家子代理开启目标模式，持续完成迭代和推进，并且把 bug 仔仔细细的全量审计干净」。
> 持久化目标 `goal-fa4f0f07-…`（max 20 轮）；基线 `.baseline-20261108-2205/`（53 份 md + 40 插件文件）。
> 5 位专家 fresh context、写作用域不重叠、以「把 bug 找干净」为目标；Lead 统一裁决 → 亲自改 `src-work` → 验证 → 同步 → 重启 → 实跑 → **再审一轮**，循环直到无未修 P0/P1。

## 审计编制（task-27~31）

| 组 | 模块 | 唯一产出 | 任务 |
| --- | --- | --- | --- |
| A | 网络/MCP 层（egress-fetch / mcp-client / 4 backend / trust / settings-api） | `51-audit-network.md` | task-27 |
| B | 核心执行层（provider / breaker / rrf / multiquery / prompting / cache / history / health） | `52-audit-core.md` | task-28 |
| C | 配置契约层（index / client / health 派生 / patch / package） | `53-audit-config.md` | task-29 |
| D | 测试/文档/回滚一致性（6 测试 / 23 文件 / 16 备份 / 5 份主文档） | `54-audit-tests-docs.md` | task-30 |
| E | 运行时端到端（认证 API / 真实工具 / 边界 / 后端可达性） | `55-audit-runtime.md` | task-31 |

## 共同约束（已下发）

- 只写自己那一个报告文件；不改源码/配置/运行时/其它报告；不操作任务板（Lead 代收口）。
- 每条结论 A/B/C/D/E + 文件:行号或可复现命令；外部内容只作数据；token 值严禁入报告。
- 缺陷给「现状 / 影响 / 最小修法 diff 片段（不实际 apply）/ 回归断言建议」；**新发现优先**。
- E 组不得写 settings/credentials（只读；若写无害字段必须改回）、不得重启。

## 待填章节（报告回收后逐轮填充）

1. 五份报告要点（每份 ≤8 行 + 自报最关键 3 个 bug）
2. **缺陷总表**：来源 | 描述 | 严重度 | 是否独立复现 | 证据等级 | Lead 裁决
3. **冲突裁决**：专家结论相反时双方证据 + Lead 采用 + 理由
4. **每轮执行清单**：文件:行号 → diff → 新测试 → 验收命令 → 结果
5. **每轮复审结论**：新改动是否引入回归、是否仍有未修 P0/P1
6. **429 两件遗留**的裁决与执行（Retry-After 透传 / 全配额冷却快速失败）
7. **文档/回滚链修正**（23 文件 / 16 备份 / 43+N 单测 / 份数行数）
8. **终局**：无未修 P0/P1 的判定 + 诚实边界 + 需用户决定项

## Lead 侧独立静态底稿（2026-11-08 22:20，供逐条裁决比对）

**`throw new WebError` 共 53 处，分布 14 文件**（关键：错误字段透传是跨模块公共模式，不是单点）：

| 文件 | 处数 | 文件 | 处数 |
| --- | --- | --- | --- |
| `util/mcp-client.js` | 8 | `provider.js` | 5 |
| `backends/anthropic-like.js` | 5 | `brave.js` | 4 |
| `mojeek.js` | 4 | `openai.js` | 4 |
| `searxng.js` | 4 | `serper.js` | 4 |
| `tavily.js` | 4 | `parallel.js` | 3 |
| `ddg.js` | 2 | `exa.js` | 2 |
| `firecrawl.js` | 2 | `tinyfish.js` | 2 |

**空 catch / 吞异常 8 处**：`mcp-client.js:121`、`mcp-client.js:133`（两处解析链需核对是否吞真实错误）、`cache.js:113/131/155`（`/* raced */` 设计容错）、`client.js:376`（`scope.load()` 失败保留快照）、`ddg.js:51`（读 detail 失败）。

**关键契约发现（A 级）**：发布版 `HarnessError` JSDoc 明确 **「route on `code`, never by parsing `message`」**（`dsh-llm/lib/types/error.js:12-20`），`WebError extends HarnessError` 只带 `code` + `cause`。我们的 `rateLimited()` 靠**文本正则**分类（`HTTP 429|Anonymo|quota|额度`）违背该约定，且所有 53 处抛错都不带 Response headers ⇒ `retryAfterMsFrom()` 恒 60s 兜底。已另派**第 6 份交叉审计 F**（task-32，`57-audit-error-contract.md`）专攻这条公共模式：`stable code` 分类 + 共享 `webErrorFromResponse()` helper + 全量抛错点清单。

`readErrors`/`failedKeys`/`rateLimited` 使用点已列：client.js 15 处、provider.js 3 处、breaker.js 2 处、failure-label.js 1 处。

**Lead 独立复现的新 bug（A/D 级，待专家报告交叉确认）**：`util/mcp-client.js` 的 `parseEnvelope(text, expectedId)` 在 SSE 分支把所有 `data:` 行 `join("")` 后 `JSON.parse` —— 若 SSE 流包含**多个 data 帧**（例如服务端先推一条 `notifications/message` 再推真正的 `tools/call` 响应），拼接结果 `{...}{...}` 无法解析，函数直接抛 `MCP: failed to parse response envelope`，**整次搜索失败**。用真实源码提取函数、注入 `data:{id:99}` + `data:{id:2,result:...}` 两帧复现：逐字输出 `SSE 抛错: MCP: failed to parse response envelope`。此外该分支 `return JSON.parse(joined)` **不校验 `id === expectedId`**（plain-JSON batch 分支才校验），单帧 SSE 若 id 不符也会误返回。exa 走 SSE，这条可能在真实运行中触发。修法方向：按空行切分 SSE 事件、逐帧解析、挑 `id === expectedId` 且含 `result`/`error` 的帧。

**第二条独立发现（P2/P3，待确认）**：`settings-api.js:238-256` 的 `readBody` 超 `MAX_BODY_BYTES` 时只 `rejectBody(413)` + `removeAllListeners("data")`，**未移除 `end` 监听、未 drain/destroy 请求流**；Promise 已 reject 故 resolve 无效，但连接可能挂住。修法：reject 时同时 `removeAllListeners("end")` 并 `req.destroy()`（或 `resume()` 排空）。

## 第 1 份回收：57 号交叉审计 F（423 行，P0 两条）

`local-impl` 交付 `57-audit-error-contract.md`，**修正了 Lead 的两个前提**（已独立复核）：
1. `egress-fetch.js:249-267 collect()` 已用 `headersFromRaw(res)` 构造带完整 headers 的 Response ⇒ **`retry-after` 本来可达**，只是抛 WebError 时没把 response 带走；不必改传输层。
2. `provider.js` **没有** `.every(rateLimited)` 分支，`rateLimited` 只写进 health entry、零读取消费者 ⇒ 3b 是「**尚未实现**」而非「不可靠」。
3. 全库 53 处 `throw new WebError` 中，**真正非 2xx 抛错仅 11 处/10 文件**（8 backend + mcp-client 2 处），改动面小得多。
4. 官方 `error.js:13` JSDoc 举例正是 `RATE_LIMIT`、`:22` 已有 `QUOTA_EXCEEDED_CODE='QUOTA'` ⇒ 不必发明新 code；**不要建 WebError 子类**（6 处 `instanceof` 会破），用「工厂 + 构造后赋值」（`super(message, options)` 只吃 cause，已 node 复现）。

**缺陷**：P0 = F-1（新增 `util/web-error.js` 的 `webErrorFromResponse()` 统一挂 status/retryAfter/rateLimited/code，11 处替换）+ F-2（分类器优先读 code/status/rateLimited，正则降兜底；`[D]` 实证 8 例里 **4 例假阳性**，含 **HTTP 200 anonymous** 被误冷却）。P1 = N-1（`openai.js`/`anthropic-like.js` 把 `HTTP ${status}` 覆盖成 provider detail，连文本 429 都没有，已独立核实）、N-2（`envelope.error.code` 未用）、N-3（`recordOutcome` 的 `ok/success` 与 `count/sources` 跨 13 backend 不一致）。P2 = 错误体 300 字符回显未脱敏、空 catch。

**Lead 对 E 级取舍的裁决**（57 号 §5.2 交 Lead 定案）：选 **(b) 保留 `Anonymo` 兜底但降级为 legacy、去掉裸 `quota`**。理由：Firecrawl keyless 的「Anonymous keyless access is unavailable」是 **MCP `tools/call` 的 `isError` 结果级错误**，不是 HTTP 非 2xx，**不会经过 `webErrorFromResponse`**，结构化方案 (a) 覆盖不到它；而 `tests/lead-20261108-quota.test.js:11` 硬断言该真实串命中。去掉裸 `quota` 可消除 4 例假阳性中的 3 例（HTTP 402 quota / 无关 quota 文本 / HTTP 200 anonymous 仍由 `Anonymo` 之外的正则挡住需再核）。

## 全量裁决表（2026-11-08 23:15，11 份报告齐备后）

**报告回收**：`51-audit-network-b`(142) / `52-audit-core-b`(269) / `53-audit-config-b`(52 骨架+Lead 代跑脚本) / `54-audit-tests-docs`(348) + `-b`(204) / `55-audit-runtime`(319) + `-b`(124) / `57-audit-error-contract`(423)。5 个 fork 主版多数失败（环境已知模式），**备份版策略生效**，另有 54/55 两个主版成功落盘。

| # | 缺陷 | 来源 | 严重度 | 裁决 | 处置 |
| --- | --- | --- | --- | --- | --- |
| A-1 | `parseEnvelope` SSE 多 `data:` 帧 `join("")` → `{...}{...}` 整体解析失败；SSE 分支不校验 `id===expectedId` | 51-b + Lead 独立复现 + 57 | **P0** | **成立**（三重实证，逐字 `MCP: failed to parse response envelope`） | ✅ 执行：按空行切分事件、逐帧解析、挑 id 匹配且含 result/error 的帧 |
| A-2 | 官方 `HarnessError` 要求 route on `code`；`rateLimited()` 靠文本正则，实证 4/8 假阳性（含 **HTTP 200 anonymous**）+ N-1 漏判（openai/anthropic 覆盖掉 `HTTP 429`） | 57 F-2 + 51-b 独立确认 | **P0** | **成立** | ✅ 执行：`webErrorFromResponse()` helper + 11 处抛错点挂 status/retryAfter/rateLimited/code；分类器优先读 code/status、正则降 legacy 兜底 |
| A-3 | `retryAfterMsFrom()` 恒 60s（Response 在 11 处抛错点被丢弃） | 57 + 52-b | **P1** | **成立**（修正前提：`collect()` 已保留 headers，不必改传输层） | ✅ 并入 A-2 helper |
| A-4 | `settings-api.js readBody` 超限时未移除 `end`/`error` 监听、未 drain/destroy | 51-b + Lead | P2 | **成立** | ✅ 执行：reject 时清监听 + `req.destroy()` |
| B-1 | `provider.js:304 else cooled.clear()` 全冷却时清空冷却表、照常全量扇出 429 端点烧配额；`rateLimited` 零读取消费者 ⇒ 3b **尚未实现** | 52-b **P0** + 57 | **P0** | **成立**（用户已授权目标模式持续推进） | ✅ 执行：全 `rateLimited` → 快速失败 + 明确文本；非配额仍 fail-open。**须在 A-2 之后**（否则文本分类误伤可用后端） |
| B-2 | `cacheKeyFor` 漏 `backendTimeoutMs`、实际凭证值 | 52-b | P2/E | 部分成立 | ✅ 补 `backendTimeoutMs`；凭证值入键会泄漏/抖动 → **不做**（标 E） |
| B-3 | `history.clear()` 不在 writeChain；`sanitizeError` 3 正则可绕过；`isComplexQuery` 裸「和」误标 multi | 52-b | P2 | **成立** | ✅ 低风险做前两项；`isComplexQuery` 属查询语义改动 → 登记 Known Limitation |
| C-1 | 13 id 六处登记集合 | 53-b 骨架 + **Lead 代跑脚本** | — | **全部 ALL 13**（6 处全同步），`DEFAULT_KEY_ENV` 9 个、`DEFAULT_MODELS` 3 个属设计 | ✅ 确认无误，无缺陷 |
| D-1 | **回滚链 P0 不可执行**：25 §6 仍是 17 文件版（10cp+7rm），缺 3 cp（breaker/exa/parallel）+ 3 rm（failure-label/quota.test/settings-api.test），验证循环 5+5 与「5 行 REMOVED」矛盾；25:530 引用的 50 §4 无 cp/rm | 54 + 54-b 双重 | **P0** | **成立** | ✅ 执行：§6 重写为 **13 cp + 10 rm** + 全量验证循环 |
| D-2 | 1 条自指假绿 `lead-20261106.test.js:215-222`（把生产判断抄进测试，不 import 生产代码）；`interaction.test.js` 35/35 全源码级 | 54 + 54-b | P1 | **成立** | ✅ 执行：改为 import 真函数断言；interaction 补至少 1 条行为级 |
| D-3 | 过时表述 ≥54 条：README/package.json 仍写 **11 后端**（代码 13）、`32/32 语法` 实为 38/38、份数行数漂移、`25:489` 与 §15 打架、注释残留 20 处（18 上游既有 + **2 处本轮新写**：`index.js:464 Applied 2026-11-07 by lead`、`tinyfish.js:19` 内部报告路径） | 54 | P1/P2 | **成立** | ✅ 执行：README→13、清 2 处本轮新写残留、§6/§7/§15 加快照标记；上游既有 18 处按 99 号约定保留 |
| E-1 | **`numResults` 死设置**：保存 8→9/8→1 后真实 `web_search` 恒 8 条；`resultTelemetry=false` 立即生效（桥接正常）⇒ `provider.js:198 request?.maxResults \|\| opts.numResults` 让 host 传入的 `searchMaxResults=8` 永远压过插件值 | 55 主版 **P1** | **P1** | **成立**（Lead 独立核对官方 tool-web `applyWebSearchTool(ctx, maxResults, ...)` 确把部署上限作为每个 seam request 的 maxResults） | ✅ 执行：取 `Math.min(request.maxResults, opts.numResults)` 或明确所有权；给真实 E2E 回归 |
| E-2 | `unified search aborted` 实为 ddg/searxng 5s 硬超时（≈5003ms），误导模型自诊断 | 55 | P1 | **成立** | ✅ 执行：超时错误与用户取消分类，文案区分 |
| E-3 | `failCount` 冷却到期不清零、单调累加到 7 | 55 | P2 | **成立** | ✅ 执行：冷却到期重置 |
| E-4 | firecrawl 错误串 80→40 双重截断成半句；cache 命中写 `backendsOk/Total=0/0` | 55 | P2 | **成立** | ✅ 执行：单点截断 + 缓存命中保留真实计数 |

**驳回 / 需用户决定**：
- 中文 `Config.description` 全量英文化（47 号已 NO-GO，2.8.8 上游风格）→ 维持。
- `/tmp/dec.cookies` 有效会话 JWT、`dsh-web.log` 的 `?token=` 值 → **只报告不删**（54 号明确；属其它会话/系统日志，需用户决定清理）。
- 429 3b 的 `Anonymo` 兼容取舍 → Lead 裁决：**保留 `Anonymo` 作 legacy 兜底**（Firecrawl keyless 是 MCP `isError` 结果级错误，不经过 HTTP helper，结构化方案覆盖不到；且 `quota.test.js:11` 硬断言该真实串），**去掉裸 `quota`**（消 3 例假阳性）。
- `patch-package` / 对外 PR / 升级 0.2.2-rc.1 → 维持「需用户授权」。

## 执行顺序（依赖驱动）

```
A-2 错误契约 helper（11 处抛错点 + 分类器）  ← 3b 的必要前置
  → B-1 全配额快速失败（3b）
  → A-1 SSE 多帧解析
  → E-1 numResults / E-2 aborted 文案 / E-3 failCount / E-4 截断与缓存计数
  → A-4 readBody / B-2 cache 漏项 / B-3 history+sanitize
  → D-1 回滚链 / D-2 假绿测试 / D-3 文档表述
  → 全量单测 → 23+N 文件同步 → 重启 → 真实工具复跑 → **复审一轮**
```

## 执行结果（2026-11-09 12:56，详见 [58 号](58-full-audit-executed.md)）

**4 条 P0 + 6 条 P1 + 8 条 P2 全部执行完毕**，重启（00:16:31，PID 1186109）后复审通过：

| 项 | 结果 |
| --- | --- |
| 全量单测 | **54/54**（7 个测试文件，含新增 `sse.test.js` 从真实源码提取函数、消除 1 条自指假绿） |
| 语法 | **33/33 JS** |
| 逐字节一致 | **35/35 文件** |
| 备份 | **26 个 `*.orig`** |
| 真实工具 | `web_fetch` 200；`web_search` 8 Sources，**exa/parallel/ddg/tinyfish 四后端全 ✓**（`ddg:8000` 修复生效） |
| API | settings `ok:true / namespace:dsh-websearch`；health `enabled:6 / keyless:6`、计量后端 `optionalKey/metered:true` |
| 回滚链 | 25 §6 重写为 **35 文件（23 cp + 12 rm）+ 26 备份** 的唯一可执行链 |
| 报告库 | 61 份 md / 20679 行，0 密钥命中 |

**未执行（需用户决定）**：`ws.register` disposer（发布版契约未确认）、`isComplexQuery` 查询语义、`sanitizeError` 加固、`/tmp` JWT 清理、patch-package、对外 PR（须补 G5 35 文件 diff）、升级 0.2.2-rc.1。

## 迭代循环（目标模式）

```
回收 5 份报告 → 裁决 → 改 src-work → 补测试 → 全量单测 → 23+N 文件同步
  → 重启 → 真实 web_fetch/web_search 复跑 → 再审一轮（必要时再派专家）
  → 若仍有未修 P0/P1，回到「裁决」；否则收口并 mark goal complete
```

## 基线（2026-11-08 22:05）

| 项 | 值 |
| --- | --- |
| 服务 | active，PID 587384，启动 18:34:33，ssh/ova 通道 SSH_OK |
| 插件 | 2.8.4 + 23 文件本地补丁，23/23 `src-work` ↔ 安装目录一致 |
| 单测 | 43/43；32 个 JS `node --check` OK |
| 备份 | 16 个 `*.orig` |
| 报告 | 51 份 md / 18131 行；密钥扫描 0 命中 |
| 真实工具 | `web_fetch` 200；`web_search` 8 Sources（exa/tinyfish/parallel ✓） |

---
骨架，待 51–55 号回收后逐轮填充。无凭证值写入本文件。
