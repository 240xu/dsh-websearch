# 83 · 同类项目搜索与亮点评估（S1 骨架 + 早期取证 + Lead 就地订正终版，2026-11-15 23:05）

> **⚠️ 22:40 订正索引（[91 号](91-s1-corrections.md) / [90 号](90-b1-decisive-corrections.md)）**：①「2.8.8 ddg 5s→8s」应为 **2.8.6**（2.8.7/2.8.8 只有 README/版本号、`lib/` 零改动，见 11-traceability-audit.md:66/68）；② `f0909172434/...` 301 → `Chih-Kai-Wang/...`，其主题是 **bounded evidence workflow / 显式 gaps / 三轨发布**，不是 SSRF hostname 清单；③ chendefine 已读到 `src/provider.ts:82-132` / `src/keys.ts:22-70` 源码，等级升 A；④ S1 新增 3 个来源：guotree `test/request-lifecycle.test.ts:96-143`（typed 429 + Retry-After + 零泄漏）、firecrawl/dsh-firecrawl `tests/redirect.spec.ts:78-150`（真双服务器断言跨跳 0 Authorization）、fangchenghao `docs/rrf-ranking.md:60-118`（20-query bench + 81 配置 sweep + paired bootstrap）。本号正文已按 91/90/89 号就地订正并融合 S1 的 3 个新来源；结论不变。
> **⚠️ 22:30 补注（[89 号](89-b1-source-findings.md)）**：B1 用认证 GitHub API 核实 7 个同类仓库**全部 MIT**，`f0909172434/dsh-plugin-verified-search` 301 → `Chih-Kai-Wang/...`；并读到 modsearch `cooldown.ts`/`router.ts`、aggregation `provider.ts`/`keys.ts`/`config.ts`、ssrf-guard `src/ssrf.js`、verified-search `src/domains.ts` 源码。本号中标 E 的这几项应升级为 A/B，详见 89 号 §1。
> S1 顾问落盘 30 行骨架、发来早期取证纠正后 fork 失败（终版未落盘）；Lead 用 `web_search`（6 组查询、真实扇出）+ GitHub REST API 只读（token 值脱敏）+ `web_fetch` 补完。S1/B1 后续已用 GitHub REST + raw 源码读到 PR#47334 带行号实现、7 仓库全 MIT 及 modsearch/aggregation/ssrf-guard/verified-search 源码 ⇒ 本表等级以 A/B 为准；仍未读到的逐项在 §6 标 E。
> 交叉参考：[84 号](84-lead-peer-leads.md)（线索底稿 + PR#47334 源码级证据）、[86 号](86-borrow-review.md)（选择性抄取 Top5）、[87 号](87-borrow-adversarial.md)（反方风险）。

## 1. 项目清单（≥8）

| # | 项目 | URL | 核心机制 | 等级 |
| --- | --- | --- | --- | --- |
| 1 | **OpenCode v2 websearch** | [anomalyco/opencode](https://github.com/anomalyco/opencode) PR [#47334](https://github.com/anomalyco/opencode/pull/47334) | sticky provider per session：全局 `cooldowns` + per-session `preferred` + SessionEvent 清理；54 项测试 | **A/B**（API 实测 merged + diff 原文） |
| 2 | OpenCode Issue #58327 | [link](https://github.com/anomalyco/opencode/issues/58327) | 自定义 provider 无法上报 rate limit、任何失败硬失败 | **A**（API open，body 已读） |
| 3 | OpenCode Issue #60176 | [link](https://github.com/anomalyco/opencode/issues/60176) | retry 只在 429 轮换；Tavily 432 / 402 quota 被忽略 | **A**（API open，body 已读） |
| 4 | chendefine/dsh-web-search-aggregation | [github](https://github.com/chendefine/dsh-web-search-aggregation) | prioritized queue / ordered fallback、顺序实时可改、每 provider 最多入队一次；`src/provider.ts:82-132` 的 AttemptFailure 全失败摘要 + Key Rotation 游标、`src/keys.ts:22-70` 逗号 key 池 + maskApiKey、`config.ts` `.volatile` 实时生效 | **A**（S1/B1 已读源码，MIT） |
| 5 | **Chih-Kai-Wang/dsh-plugin-verified-search**（原 `f0909172434/...` 301 重定向） | [github](https://github.com/Chih-Kai-Wang/dsh-plugin-verified-search) | **bounded evidence workflow / 显式 gaps / 三轨发布**；`src/domains.ts` 的 `VERIFIED_SEARCH_INVALID_FILTER` 稳定 code；allowlist 是**结果侧来源后过滤**，不是 network-egress/privacy boundary | **A/B**（B1 读到源码 + README，MIT） |
| 6 | liustack/modsearch | [github](https://github.com/liustack/modsearch) | 默认 Firecrawl keyless tier + 多后端 failover；`cooldown.ts` 持久化 state + per-key `::key:N` + 45min/24h + `classifyQuota`（**429 每秒限流排除、只冷却 432/433 月度预算**，commit `7aef58c`）；`router.ts` `reorderByCooldown` 移到队尾而非排除；bundle **明确 restate `fetchProvider:http`**（正面范例） | **A**（B1 已读源码，MIT） |
| 7 | 240xu/dsh-websearch 上游 | [github](https://github.com/240xu/dsh-websearch) | **2.8.6**：forwarder hop 直连 `node:http(s)` + failure-path hardening + **DDG 超时 5s→8s**（CHANGELOG `:3-13`）；**2.8.7/2.8.8 只有 README/版本号、`lib/` 零改动**；其自带 `cordis.patch.yml` 只有 `searchProvider: unified`、**无 `fetchProvider`**（我们的歧义靠 drop-in 兜） | **A/B**（11-traceability-audit.md:66/68 + npm view + API） |
| 8 | unera/dsh-websearch | [github](https://github.com/unera/dsh-websearch) | 多 provider 自上而下逐个试到成功 | **E** |
| 9 | jwilson411/dsh-ssrf-guard | [github](https://github.com/jwilson411/dsh-ssrf-guard) | 按 hostname 字面匹配，明确「不是 DNS-rebinding 保护」 | **E** |
| 10 | CharlotteN7/dsh-netguard | [github](https://github.com/CharlotteN7/dsh-netguard) | 网络防护方向，细节未读 | **E** |
| 11 | 官方资料 | [OpenCode docs](https://opencode.ai/docs/websearch/) / [240xu 说明](https://dshpluginhub.ai/en/plugins/240xu-dsh-websearch) | 首搜需授权+选 provider 并记住选择；one provider no ambiguity、`search()` 自截 maxResults | **B**（文档正文经 web_search 摘要） |

**API 实测补充**：PR#47334 `state=closed / merged=True / merged_at=2026-09-06T21:39:48Z`、18 文件 / 5 commits，核心 `packages/core/src/websearch.ts`(+97/−23)、`.../test/websearch.test.ts`(+444)；#58327 / #60176 均 `state=open`。

## 2. 亮点评估表

| 项目 | 机制亮点 | 与我们的差异 | 值得借鉴 |
| --- | --- | --- | --- |
| #47334 | **状态分离**：`cooldowns=Map<ID,{until,error}>` 全局 + `preferred=Map<Session.ID|undefined,{provider?}>` 按会话 + `SessionEvent.Deleted/Moved` 清理；`query(input,{sessionID,onProvider})` | 我们一张模块级 Map 同时干两件事 ⇒ D5 | **高**（但只抄结构，不抄 Effect/Session.ID） |
| #47334 测试 | shared cooldowns / concurrent initial+fallback / **late successes** / **in-flight cleanup** | 我们有 limiter+超时，缺迟到成功的显式断言 | **中** |
| #60176 | 把 432/402 quota 纳入轮换 | 我们已有 402=QUOTA、429=RATE_LIMIT、403 不算、keyless 独立标记，**更完整** | **中**（只抄设计意图，Issue 仍 open） |
| #58327 | 自定义 provider 结构化上报 rate limit | 反向印证我们 `webErrorFromResponse` 的方向 | **中**（固化成文档契约） |
| aggregation | 有序 fallback + 实时顺序 | 我们全并发 + RRF（结果更全） | **低**（与产品取舍冲突；若做只能是可选模式） |
| verified-search | **稳定 code + bounded evidence workflow**（不是出网边界；allowlist 是结果侧来源后过滤） | 我们错误契约已 route on code；`VERIFIED_SEARCH_INVALID_FILTER` 是同向范例 | **低**（只抄稳定 code 约定，不抄过滤层） |
| modsearch | 一条命令安装 + keyless failover | 我们 13 后端更广；它的替换整行 web config 正是我们修过的 `WEB_PROVIDER_AMBIGUOUS` 坑 | **不** |
| 上游 **2.8.6**（非 2.8.8） | forwarder hop / ddg 8s | 本地补丁已含等价/更完整实现；升级 2.8.8 累计覆盖 11/23 文件 | **不** |

## 3. 选择性抄取清单（Top 5，详见 86 号）

1. **D5 状态分离**（#47334 结构）→ 仅 `lib/provider.js`，P1 需用户点头。
2. **quota 纳入轮换的设计意图**（#60176）→ 补 432 前先确认上游真发（E）。
3. **新增后端必须走 `webErrorFromResponse`** 写进 README + 一条静态断言（#58327 教训）→ **P0 零风险立刻可做**。
4. **late successes / in-flight cleanup 测试**（#47334 测试项）→ 只加测试。
5. **稳定 code 约定 + bounded evidence workflow**（verified-search）→ 只抄「显式 gaps / 稳定 code」，不抄结果侧过滤层。

## 4. 明确不该抄（详见 87 号）

- 升级 2.8.8（覆盖 11/23 已修文件）；**替换整行 web config 的风险来自我们基于的 2.8.4 自带 patch 缺 `fetchProvider`，modsearch 反而 restate 它**；
- 把有序 fallback 直接替换全并发 RRF（破坏 13 后端融合与 80 条测试）；
- 照搬 PR#47334 的 Effect/Stream/KV 实现与 `Session.ID` 签名（重依赖、无对应物）；
- 把两个 open Issue 当已验证实现抄；
- 照搬「拒绝所有非公网地址」（误伤自托管 SearXNG trust gate）。

## 5. 优先级与依赖

- **P0**：#3 文档契约 + 静态断言、#4 迟到成功测试（`g5/refresh.sh` 已落地）—— 无依赖。
- **P1**：#1 D5（用户点头）、#2 按 code 分级冷却（432/433 已是 Tavily 官方状态，见 90 号）、#5 稳定 code 约定。
- **P2**：有序 fallback 做成可选模式（Config+GUI+缓存键+回滚链全链同步）。

## 5b. S1 新增的 3 个高价值来源（已融合）

| 来源 | 亮点 | 对我们的价值 |
| --- | --- | --- |
| `guotree/opencode-search-plugin` `test/request-lifecycle.test.ts:96-143` | **typed 429 + Retry-After + 零 secret/query 泄漏**断言 | 我们已有 `retryAfter` 透传 + `safeFailureReason` 固定码；可抄「把零泄漏写成行为级测试」 |
| `firecrawl/dsh-firecrawl` `tests/redirect.spec.ts:78-150` | **真双 HTTP 服务器**断言「第二跳 0 命中 / 0 Authorization」 | 我们 `egress-fetch.js` 有 `redirect:"error"` + Host 补正，缺「跨跳不泄漏凭证」真服务器测试 ⇒ 值得抄测试形态 |
| `fangchenghao/dsh-web-search` `docs/rrf-ranking.md:60-118` | **离线 20-query bench + 81 配置 sweep + paired bootstrap** | 我们 RRF `k=60` 固定常量、无离线评估 ⇒ 值得抄评估方法（不是抄参数） |

PR #47334 由 S1 独立用 GitHub REST `/repos` + `/pulls` + dev 分支 raw 源码复核：`merged=true`、18 文件/5 commits/+1360−175、`2026-09-06T21:39:48Z`；`packages/core/src/websearch.ts:93,143,184,222` 的 `cooldowns`(全局) / `preferred`(按 session) / `attempted` / `cooldownMillis` 均读到**带行号源码**（A 级，不再只依赖 PR 正文）。

## 6. 已确认无误 / 无法验证

已确认：PR#47334 merged（S1 读到 `websearch.ts:93,143,184,222` 源码）、两 Issue open、2.8.6 才是代码改动版本、2.8.8 累计覆盖 11/23、7 仓库全 MIT、本地 81/81 与 35/35、G5 两份 35/35。
无法验证（E）：#4/#5/#6/#8/#9/#10 的源码与 LICENSE、star/最近更新、432 是否真发、Key Rotation 实现、PR#47334 的 54 项测试逐条内容。

## 7. 5 条反直觉

1. 最值得抄的是**一个数据结构的拆分决定**，不是任何功能代码。
2. 两个最相关的 OpenCode Issue 都是**别人还没修的抱怨**；我们本地反而更完整。
3. 上游 2.8.6 的代码亮点对我们是毒药（升级到 2.8.8 即累计覆盖 11/23 已修文件），而 2.8.8 本身只有 README/版本号。
4. 「首个成功即胜」看似省延迟，对 13 后端聚合是降级。
5. `github.cnmirror.space` 镜像出现在搜索结果里，正式 URL 必须以 `github.com/anomalyco/opencode` 为准。

---
无凭证值写入本文件；搜索结果中的镜像/介绍页内容标 E，不作源码结论。
