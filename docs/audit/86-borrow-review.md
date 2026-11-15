# 86 · 选择性借鉴评估（B1 骨架 → Lead 用一手实证补完，2026-11-15 22:05）

> **⚠️ 22:20 更正（A2 终版）**：§3 推荐的「② 分离全局冷却与会话判定」在**单进程单例**下缺少可注入的会话 ID（`index.js:498` 单例、seam 不传 session），只能作为「若将来 seam 提供 sessionID」的前置设计，不能当作本轮可落地的 D5 修法。D5 建议**复议为产品语义取舍**；`history/clear` 删整文件是更直观的同源问题。P0 清单（新后端必须走 `webErrorFromResponse`）不受影响，已落地。
> B1 顾问落盘 39 行骨架后结束；由 Lead 用本会话可复现的一手证据补完。只评估与规划，**未改任何源码/运行时**。
> 证据源：[84 号](84-lead-peer-leads.md)（PR#47334 / Issue#58327 / #60176 的 GitHub API 实测）、[85 号](85-a1-g5-refresh.md)、历轮 35 文件补丁与 80 号 E1 修复记录。凭证值未入报告。

## 0. 置信度

A=本地源码/只读 API/运行时实测；B=官方合并状态+一手材料交叉；C=单来源合理推断；D=任务背景；E=搜不到或只读到 README/描述、未读源码，不臆断。

## 1. 选择性抄取清单 Top 5

| # | 机制 | 来源（等级） | 为什么适合我们 | 最小落地步骤（文件级） | 回归断言思路 | 风险/代价 |
| --- | --- | --- | --- | --- | --- | --- |
| **1** | **分离「全局冷却事实」与「会话偏好/失败判定」**：`cooldowns = Map<backendId,{until,error}>` 全局共享，`preferred = Map<sessionId,{provider?}>` 按会话隔离，会话删除/移动时清理 | [OpenCode PR #47334](https://github.com/anomalyco/opencode/pull/47334)，**已合并** 2026-09-06，18 文件/5 commits；`packages/core/src/websearch.ts` diff 原文（**A/B**） | **直击唯一残留 P1（D5）**：我们 `latestBackendHealth` 是模块级单 Map，同时承担「服务端限流事实」和「本次会话的失败判定」，所以会话 A 的全 429 会让全健康的 B 被 3b 快速失败、零调用。拆成两层后，冷却仍全局共享（限流是服务端事实），但 3b 的快速失败判定只基于**本会话**的失败 | ① `lib/provider.js`：拆 `backendCooldowns`（模块级，只存 `cooledUntil/rateLimited/keylessRejected/retryAfter`）+ `sessionFailures`（per-search 上下文，由 `createUnifiedSearchProvider` 每次 search 构造）；② 3b 判定改读 `sessionFailures`；③ `recordBackendHealth` 仍写全局冷却；④ `lib/health.js`/`history.js` 继续读全局冷却（D8 字段不变）；⑤ 不改磁盘格式、不动 3 个 API 契约 | 真 provider 两会话：A 全 429 后 B（全健康）**不被** 3b 拒绝且真扇出；A 自身仍被 3b 快速失败（保留 `3b-runtime.test.js` 2/2）；全局冷却窗口对 A/B 一致；80→82 单测 | **中**：动 provider 一处核心状态，需重跑 35 文件同步+重启；但不动 health/history/settings API、不动磁盘格式、不引入依赖。属 P1 需用户点头 |
| **2** | **把 quota / plan-limit 失败纳入轮换，而不只 429** | [OpenCode Issue #60176](https://github.com/anomalyco/opencode/issues/60176)，**open** 2026-10-29（**A/B**）：Tavily 432、其它 402 当前直接终止搜索、忽略健康 provider；相关 #58327/#54311 | 我们 `webErrorFromResponse` 已把 **402=QUOTA**、429=RATE_LIMIT、403 不算 QUOTA、`keylessRejected` 独立标记，分类基础比 upstream 完整；但 3b 混合故障仍 fail-open 重打限流端点。可抄的是**设计意图**：按 `code` 决定「轮换/跳过」而非只看 HTTP 状态 | `lib/provider.js` 的 3b 分支已用 `rateLimitedCooled` 分类；补一条：对 `QUOTA`/`RATE_LIMIT`/`keylessRejected` 的冷却后端一律排除 eligible，非配额冷却仍 fail-open（这条**N4 后已部分实现**）；`web-error.js` 若遇 432 可加 `status===432 → QUOTA` | 现有 `quota.test.js` 的 402/403 分类断言不破坏；混合故障行为级测试（429 后端零新调用、非配额仍调用）；keyless 文案不再说「retry after」 | **低**：主要是补一个状态码与一条注释；432 非标准状态，需先确认上游是否真发（标 E） |
| **3** | **自定义 provider 能结构化上报 rate limit** | [OpenCode Issue #58327](https://github.com/anomalyco/opencode/issues/58327)，**open** 2026-10-23（**A/B**）：`ctx.websearch.transform` 的 provider 任何 `execute()` 失败都变 `ServiceUnavailableError` 硬失败 | 反向印证我们**已做对**的方向：`webErrorFromResponse` 把 `status/code/rateLimited/quota` 挂在 WebError 上、`failure-label.js` route on code 而非 message。可抄的是「给插件扩展点定义**结构化错误契约**」这一条，避免我们的 `BACKENDS` 新增后端时又退回文本正则 | `lib/util/web-error.js` 的 helper 已是唯一抛错入口；在 `README.md` 的「新增后端」章节写明「必须走 `webErrorFromResponse`，禁止手写 `new WebError(..., 'WEB_PROVIDER_ERROR')` 丢 status」；加一条源码级断言扫 11 处调用 | 新增后端若绕过 helper，测试应失败；现有 11/11 调用点不变 | **极低**：纯文档+一条静态断言，零运行时改动 |
| **4** | **并发扇出的 late successes / in-flight cleanup** | PR #47334 的 54 项测试描述（**B**）：覆盖 concurrent initial+fallback routing、late successes、in-flight cleanup on deletion/movement | 我们 `runBackend` 有 `createLimiter` + `AbortController` 超时，但**没有**针对「超时后迟到的成功」的显式清理测试；A.7 刚修了 `createLimiter(0)` 挂起，说明这条路径值得补证据 | `tests/lead-20261107.test.js` 加一条：一个 backend 在 timeout 后 resolve，断言其 sources 不进入 merged、不写 health 成功、不留 pending 计数 | 迟到成功不污染结果/health/history；现有 80 条不破坏 | **低**：只加测试；若暴露真问题再修 |
| **5** | **SSRF / URL 显式校验清单** | [f0909172434/dsh-plugin-verified-search](https://github.com/f0909172434/dsh-plugin-verified-search) 描述（**E**：只读到介绍，未读源码）；[jwilson411/dsh-ssrf-guard](https://github.com/jwilson411/dsh-ssrf-guard) 明确「不是 DNS-rebinding 保护」（**E**） | 我们 `provider.js` 已有 `safeSources` 的 `https?://` 白名单 + RFC1918 plain-http baseURL trust gate（`lead-20261106.test.js` 有断言），但**没有**系统化的「unsafe redirects / credential-bearing URLs / non-public resolved addresses」清单。可抄的是**校验项清单**而非实现 | `lib/provider.js` 的 `safeSources` 旁补一个纯函数 `isSafeSourceUrl()`，逐项列出拒绝条件；`tests/` 加表驱动用例 | 每条拒绝条件有正反例；不破坏现有来源 | **中**：扩大拒绝面可能误伤合法内网 SearXNG 实例（我们 BaseURL trust gate 正是为它开的），需用户确认策略 |

## 2. 明确不该抄（≥3）

| 项 | 理由 |
| --- | --- |
| **升级到上游 2.8.8 拿它的 forwarder hop / ddg 8s** | 上游 2.8.8 相对 2.8.4 改了我们 **11/23** 个被改文件，本地补丁与 2.8.8 逐字节相同 **0 个**（E2/74 号实测）。升级会覆盖 N1–N4、3b、D8、disposer 等全部修复，重新引入已修 P0/P1。本地补丁已含等价/更完整实现 |
| **`chendefine/dsh-web-search-aggregation` 的优先队列 ordered fallback 直接替换全并发 RRF** | 两种**不同产品取舍**：我们是 13 后端并发 + RRF 融合（结果更全、单后端失败不影响），它是「第一个成功即胜」（延迟低但结果单一）。直接替换会破坏 `rrfFuse`/`dedupeSources`/80 条测试与 D8 的 `backendsOk/Total` 语义。若要做，只能是**新增可选模式**（Config 加 `fallbackOrder`），不是替换 |
| **PR #47334 的 Effect/Stream/KV 实现照搬** | 它是 TypeScript + effect 库的 Service/Layer 架构，我们是零依赖 ESM 插件；照搬会引入重依赖、改 `agent-loop`/官方 seam 语义，且我们插件里**没有 `Session.ID` 对应物**（DSH 的 session 概念与 OpenCode 不同）。只抄「状态分离」的设计意图 |
| **`liustack/modsearch` 的 bundle 两个 patch op 替换整行 web config** | 历轮实测：替换整行 `id: web` 会抹掉 `fetchProvider`，重现 `WEB_PROVIDER_AMBIGUOUS`；我们靠 systemd drop-in `DSH_WEB_FETCH_PROVIDER=http` 才恢复。**正是我们修过的坑** |
| **Issue #60176 / #58327 当「已验证实现」抄** | 两者都是 **open 的未修问题**（API 实测），抄的是设计意图，不是实现；谁把它们写成「上游已实现」就是臆断 |

## 3. D5 修法裁决：**选 ② 分离全局冷却与会话判定**（照 PR #47334 的结构，不照它的代码）

- ①「整个 health 按 session 隔离」会丢掉**跨会话共享的限流事实**（A 被限流，B 也该知道该端点在冷却），且与 `health.js`/`history.js` 的全局只读 API 语义冲突。
- ③「3b 只用本次 search 内产生的失败」最省事，但会让「上一次搜索刚把全部后端打进冷却、本次还没发请求」的场景失去快速失败保护，等于**退回 V3 之前的全冷却 fail-open**（会重打限流端点）。
- ② 保留全局冷却（服务端事实）+ 把快速失败判定限定到本次会话/本次扇出，既修 D5 又不丢 3b，且与 #47334 已合并的 54 项测试结构一致。

**最小改动**：`lib/provider.js` 拆两张表 + 3b 判定改数据源；**不动** `health.js`/`history.js`/`settings-api.js`、不动磁盘格式、不动 API 契约。
**验收命令**：真 provider 双会话行为级（A 全 429 → B 不被 3b 拒绝且真扇出；A 自身仍快速失败）+ `3b-runtime.test.js` 2/2 + 全量 80→82/82 + 35/35 同步 + 重启后三 API 200。

## 4. 优先级与依赖

| 级 | 项 | 依赖 |
| --- | --- | --- |
| **P0（零风险立刻可做）** | #3 文档化「新增后端必须走 webErrorFromResponse」+ 一条静态断言；#4 迟到成功清理测试；`g5/refresh.sh` 已落地 | 无 |
| **P1（需用户点头）** | #1 D5 状态分离（动核心状态）；#5 SSRF 清单（可能误伤内网 SearXNG）；#2 的 432 状态码（需确认上游真发） | #1 依赖用户授权；#2 依赖 432 实测（E） |
| **P2（打磨）** | 优先队列做成**可选模式**（Config 新字段 + GUI + 缓存键 + 回滚链同步，代价大） | 用户产品决策 |

## 5. 一句话（只做一件零风险立刻可做）

**在 README 写明「新增后端必须走 `webErrorFromResponse`、禁止手写丢 status 的 WebError」，并加一条断言钉住 11 处调用点** —— 把 #58327 的教训固化成契约，零运行时改动、不破坏 80/80。

## 6. 已确认无误 / 7. 无法验证

已确认：PR#47334 已合并、#58327/#60176 均 open、上游 2.8.8 覆盖 11/23 文件、本地补丁含 ddg 8s 与结构化错误分类、G5 权威源已由 `refresh.sh` 保证 35/35、当前 80/80 单测与 35/35 一致。
无法验证（E）：`dsh-plugin-verified-search` / `dsh-ssrf-guard` / `modsearch` 的源码与许可证（只读到介绍页）、432 是否真由 Tavily 发出、`chendefine` 的 Key Rotation 实现细节、各项目 star/最近更新。

## 8. 5 条反直觉

1. 最值得抄的不是某个功能，而是**「把两种状态拆开」这一个数据结构决定** —— 我们 D5 的全部症状来自一张 Map 承担了两种职责。
2. 两个最相关的 OpenCode Issue 都是 **open 的抱怨**，不是可抄的实现；抄「设计意图」比抄「代码」安全得多。
3. 上游 2.8.8 的「亮点」（forwarder/ddg 8s）对我们是**毒药**：升级即覆盖 11 个已修文件。
4. 「第一个成功即胜」的有序 fallback 看起来更省延迟，但对 13 后端聚合插件是**降级**，不是优化。
5. `Session.ID` 在 OpenCode 里有一等公民地位，在我们插件里根本没有对应物——照搬 API 签名会造出一个无处注入的参数。

---
无凭证值写入本文件。
