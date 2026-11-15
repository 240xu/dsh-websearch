# 84 · Lead 侧同类项目线索底稿（供 S1 交叉核对，2026-11-15 21:50）

> **⚠️ 22:40 订正（[91 号](91-s1-corrections.md)）**：「上游 2.8.8 ddg 5s→8s / forwarder hop」应属 **2.8.6**；2.8.8 只有 README/版本号。verified-search 身份 301 → Chih-Kai-Wang，主题为 bounded evidence workflow。
> 用户「分配专家自代理评估，再分配一个去搜同类型项目，看看抄过来一点，要评估亮点，选择性抄」。
> 本文件是 Lead 自己用 `web_search` 摸到的**线索**，不是结论；权威评估见 [83 号](83-peer-projects.md)（S1 专家，独立取证）。两条底稿分开，避免把我的搜索结果当专家的。

## 搜索方法与结果

用 6 组不同查询（DSH 聚合插件 / OpenCode v2 websearch / 优先队列 fallback / sticky session / SSRF allowlist / ModSearch），每次真实扇出 4–6 个后端；本窗口 ddg 出现 `backend "ddg" timed out after 8000ms`、searxng 反爬、firecrawl 匿名额度，均为已知环境降级，不是线索缺失。

## 高度相关的 4 条（**值得优先让 S1 深挖**）

| 来源 | 亮点（搜索结果原文要点） | 与我们哪个已知问题对应 |
| --- | --- | --- |
| [anomalyco/opencode PR #47334](https://github.com/anomalyco/opencode/pull/47334) `feat(core): keep web search providers sticky per session` | 54 tests 覆盖 **independent peers / shared cooldowns / concurrent initial+fallback routing / late successes / in-flight cleanup on deletion/movement** | **D5 跨会话干扰**（我们 `latestBackendHealth` 是模块级 Map，A 的 429 让 B 快速失败）；并发扇出的迟到成功清理 |
| [anomalyco/opencode Issue #58327](https://github.com/anomalyco/opencode/issues/58327) `custom providers cannot signal rate limits` | Cooldown/切换**只在 `websearch.provider="random"` 且失败是 HTTP 429（Retry-After 设 cooldown）时运行**；**pinned provider 任何失败都终止搜索** | 我们 3b 混合故障 fail-open 重打限流端点、keyless 拒绝被当配额；「按失败类型决定是否轮换」的设计取舍 |
| [anomalyco/opencode Issue #60176](https://github.com/anomalyco/opencode/issues/60176) `rotate providers on quota and plan-limit failures, not only HTTP 429` | 明确把「quota / plan-limit」与「429」分开，主张前者也触发轮换 | 我们 `webErrorFromResponse` 已把 402 算 QUOTA、403 不算、`keylessRejected` 独立标记 —— 正好有可对照的分类体系 |
| [chendefine/dsh-web-search-aggregation](https://github.com/chendefine/dsh-web-search-aggregation) | **Prioritized queue / ordered fallback**：自上而下按队列试，第一个成功即胜，失败落到下一个；顺序在设置卡片里实时可改；每种 provider 最多入队一次（另有 dsh-plugin.org 条目提「Key Rotation」） | 我们当前是**全并发 fan-out + RRF 融合**，与「有序 fallback」是两种不同取舍；值得评估是否值得做成可配置模式，而不是替换 |

## 其它线索（待 S1 核实 star/更新/许可证/是否读到源码）

- [240xu/dsh-websearch](https://github.com/240xu/dsh-websearch) 上游 main/CHANGELOG：2.8.6 forwarder hop 直连 `node:http(s)` 修复 `EnvHttpProxyAgent` 劫持；2.8.8 ddg 超时 5s→8s；**我们本地补丁已包含等价/更完整的修复**，升级会覆盖。
- [liustack/modsearch](https://github.com/liustack/modsearch)（`@liustack/modsearch@5.10.12`）：一条命令安装、默认 Firecrawl keyless tier + 多后端 failover；[docs/dsh.md](https://github.com/liustack/modsearch/blob/main/docs/dsh.md) 说明 bundle 用两个 patch op 把 web seam 的 `searchProvider` 指向 modsearch 并保留 `fetchProvider: http`（注意：替换整行 web config，正是我们历轮 `WEB_PROVIDER_AMBIGUOUS` 的坑）。
- [f0909172434/dsh-plugin-verified-search](https://github.com/f0909172434/dsh-plugin-verified-search)：invalid hostname allowlists、credential-bearing URLs、unsafe redirects、non-public resolved addresses、malformed charset 等**显式失败**（SSRF/输入校验方向）。
- [jwilson411/dsh-ssrf-guard](https://github.com/jwilson411/dsh-ssrf-guard)：明确写「不是 DNS-rebinding 保护」，按 hostname 字面匹配。
- [unera/dsh-websearch](https://github.com/unera/dsh-websearch)：多个 provider 自上而下逐个试到成功。
- [CharlotteN7/dsh-netguard](https://github.com/CharlotteN7/dsh-netguard)：网络防护方向，细节未读。
- [dsh-plugin.org 的 aggregation 条目](https://dsh-plugin.org/plugins/chendefine/dsh-web-search-aggregation)：优先队列 + Key Rotation。
- 官方资料：[OpenCode Web search 文档](https://opencode.ai/docs/websearch/)（首搜需授权 + 选 provider、记住选择）、[240xu/dsh-websearch 的「one provider, no ambiguity」说明](https://dshpluginhub.ai/en/plugins/240xu-dsh-websearch)。

## 给 S1 的交叉核对请求

1. **PR #47334 的 "shared cooldowns" 到底怎么实现**？如果是 per-session 隔离 + 共享冷却窗口，可能就是 D5 的最小修法来源，请读源码/测试文件名给证据（不要只看 PR 标题）。
2. **Issue #58327/#60176 是否仍是 open、有没有对应已合并修复**？这决定「抄」的是设计还是已验证实现。
3. **优先队列 fallback vs 全并发 RRF**：请评估是否值得作为**可选模式**加入（我们已有 `BACKENDS`/`enabledBackends`/熔断/缓存键，加一个 `fallbackOrder` 配置位的代价），还是明确不该抄（会破坏 13 后端融合与 80 条测试）。
4. **许可证**：读到才写，读不到标 E；不要臆断。
5. 任何「需要改 `agent-loop` / 官方 `packages/web` / 引入重依赖」的方案，归入「明确不该抄」。

## 我这边的边界

- 只用了 `web_search`，**没有**逐个 `git clone` 或读源码；star/最近更新/许可证全未核实，标 E。
- 搜索结果里的 `github.cnmirror.space` 是镜像，正式 URL 应以 `github.com/anomalyco/opencode` 为准。
- 本文件不代替 [83 号](83-peer-projects.md)；若两者冲突，以 S1 的源码级证据为准。

---
无凭证值写入本文件。

## 21:55 Lead 追加：PR #47334 的源码级证据（GitHub API，非搜索摘要）

| 项 | 实测 |
| --- | --- |
| 状态 | **closed / merged=True / merged_at=2026-09-06T21:39:48Z**，18 文件、5 commits |
| 核心文件 | `packages/core/src/websearch.ts` (+97/−23)、`packages/core/src/tool/plugin/websearch.ts` (+102/−118) |
| 关键实现（PR diff 原文） | `const cooldowns = new Map<ID, { until: number; error: RequestError }>()`；`const preferred = new Map<Session.ID | undefined, { provider?: ID }>()`；`Effect.addFinalizer(() => preferred.clear())`；订阅 `SessionEvent.Deleted / SessionEvent.Moved` 时 `preferred.delete(event.data.sessionID)` |
| `query()` 签名 | 新增 `options?: { sessionID?: Session.ID; onProvider?: (p: Provider) => Effect }` |
| 测试 | `packages/core/test/websearch.test.ts` +444 行，覆盖 independent peers / shared cooldowns / concurrent initial+fallback / late successes / in-flight cleanup |

⇒ **可抄的设计要点（给 A2 的 D5 修法）**：不要简单把整个 `latestBackendHealth` 按 session 隔离；应该**分离两种状态**——
1. **全局共享**：per-provider 冷却窗口（`cooldowns` by `ID`，含 `until` + 触发它的 `error`），因为限流是服务端事实；
2. **按 session 隔离**：本次会话的「偏好/失败判定」（`preferred` by `Session.ID`），并在会话删除/移动时清理。
我们当前只有一张模块级 Map 同时承担两种职责 ⇒ A 的 429 直接让 B 被 3b 快速失败。

**两个 Issue 正文（API 实测，均 open）**：
- #58327（2026-10-23，opencode 2.1.2）：`ctx.websearch.transform` 注册的自定义 provider **无法上报 rate limit**，任何 `execute()` 失败都变 `ServiceUnavailableError` 硬失败，pinned plugin provider 因此拿不到内置 provider 的 429→Retry-After→切换链路。⇒ 印证「错误分类必须结构化、不能靠 message」。
- #60176（2026-10-29）：`provider:"random"` 的 retry loop **只在 HTTP 429 轮换**；Tavily 免费档耗尽返 **432**、其它 provider 返 **402**，这些 quota/plan-limit 失败当前直接终止搜索、忽略其它健康 provider。相关 #54311/#58327。⇒ 与我们 `webErrorFromResponse`（402=QUOTA、429=RATE_LIMIT、403 不算）和 3b 混合故障高度对应。

**给 S1/A2 的裁决提示**：#60176 是 **open 的未修问题**，不是可抄的实现；可抄的是「把 402/432 等 quota 信号纳入轮换」这一**设计意图**，且我们已有 402=QUOTA 的分类基础。#58327 同理，印证我们 `webErrorFromResponse` 结构化 `code/status/rateLimited` 的方向正确。
