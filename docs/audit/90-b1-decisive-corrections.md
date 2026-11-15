# 90 · B1 决定性更正：归因对象、432/433、D5 落地形态（2026-11-15 22:30）

> B1 顾问 22:23 发来决定性更正，Lead 逐条用官方类型文件 / 2.8.4 tarball / web 独立复核，全部成立。**只评估，未改代码/运行时。**

## 1. 归因对象写反了（A 级）

| 旧说法（87/88 号） | 实测 |
| --- | --- |
| 「modsearch 的 bundle 替换整行 web config 会抹掉 `fetchProvider`」 | **2.8.4 自带的 `cordis.patch.yml` 里 `fetchProvider` 计数 = 0**（逐字只有 `searchProvider: unified`）；**modsearch 的 `cordis.patch.yml` 反而明确 restate `fetchProvider: http`**，是正面范例。我们历轮的 `WEB_PROVIDER_AMBIGUOUS` 是靠 systemd drop-in `DSH_WEB_FETCH_PROVIDER=http` 从外部解的，根因在**我们基于的上游 2.8.4 补丁**，不在 modsearch |

⇒ 87 号「整行替换重现 P0」的**结论仍对**（替换整行确实危险），但**归因对象必须改**：危险来自「目标行本身缺字段 + 替换整行」，不来自 modsearch 的实现；modsearch 恰恰示范了正确做法（把需要的字段全部 restate）。

## 2. 官方 seam 契约（A 级，B1 给的路径已核）

`/opt/dsh-0222/node_modules/@deepseek-ai/dsh-web/lib/types/types.d.ts`：
- `WebSearchRequest { readonly query: string; readonly maxResults?: number }` —— **只有两项**；
- `WebSearchProvider.search(request, signal?)` —— **不传 sessionID**；
- 本地 `provider.js:198` 签名一致、`index.js:498` 单例注册。

⇒ `Map<Session.ID|undefined,{provider?}>` 落地即退化为单键 `preferred.get(undefined)`，等于把全局 Map 改名成「会话 Map」，**D5 不修**。这坐实了 89 号「不必注入 Session.ID」的方向。

## 3. D5 的最终可落地形态（与 89 号一致，B1 选 ③）

PR #47334 diff 里 `attempted = new Set<ID>()` 是 **per-query 局部**、`cooldowns` 全局 ⇒：

- **全局冷却**：只用于「跳过单后端 + health/history 可观测」；
- **3b 全配额快速失败**：判决绑定**本次 `search()` 的局部失败集合**（我们已有局部 `allFailures`，`provider.js:456`），不再读模块级 `latestBackendHealth` 作为判决依据。

不动 health/history/settings API、不动磁盘格式、不动 Config、无需 `Session.ID`/Effect/Stream。仍是**需用户点头**的核心语义改动。

## 4. 432/433 不是「非标准魔数」（订正 87/89 号的 E 标注）

- [Tavily Help Center Errors Code](https://help.tavily.com/articles/8645538886-understanding-http-errors) 与 [docs.tavily.com Rate Limits](https://docs.tavily.com/documentation/rate-limits)：**429 是每秒限流且带 `Retry-After`**；**432 Plan Limit Exceeded / 433 Pay-As-You-Go Limit Exceeded 是 Tavily 官方月度/预算状态**（另有第三方汇总明确列出 433）。
- `new Response(..., {status: 432})` 在 Node 可承载（非标准但可用）。
- modsearch `cooldown.ts` 的 `classifyQuota` **把 429 每秒限流排除在冷却外，只冷却 432/433 月度预算**（B1 读到源码，有 commit `7aef58c` 把 24h 冷却写进去）。

⇒ **可抄的是「按 code 分级冷却」**：短期限流（429 + Retry-After，秒级）与预算耗尽（432/433，小时级）不该用同一个窗口。我们当前 `webErrorFromResponse` 把 429 与 402 都归 `rateLimited=true`、统一 60s/24h 上限，**没有区分这两类**。这是继 D5 之后第二个有价值的可抄点，且**零架构改动**（`web-error.js` + `failure-label.js` 各一处），但仍需用户点头才动分类语义。

## 5. 抄取清单净变化（相对 88 号）

| 项 | 变化 |
| --- | --- |
| modsearch `classifyQuota` 的「429 ≠ 432/433」分级 | **升级为值得抄**（P1 需点头），不再是 E |
| modsearch bundle restate `fetchProvider:http` | **升级为正面范例**：我们 2.8.4 自带 patch 缺它，应登记为「上游缺陷 + 我们用 drop-in 兜」，不是「别抄 modsearch」 |
| verified-search allowlist | 是**结果侧来源过滤**，不是出网边界（87 号理由修正，结论不变） |
| 7 个同类仓库 | 全 MIT、B1 已读源码 ⇒ 从 E 升 A/B；法律零障碍，卡点是工程链路 |
| D5 | ③ 形态可落地（89/90 号），非「产品语义取舍、无法落地」 |

## 6. 不变的结论

- **本轮 NO-GO 不改代码**（B2 224 行终版）：唯一残留 P1（D5）gate 在用户点头之后，零净收益、高回归代价。
- 已落地的 P0：新后端必须走 `webErrorFromResponse`（README + 11 处静态断言，81/81）。
- 明确不抄：升级 2.8.8（覆盖 11/23）、照搬 Effect/Session.ID、有序 fallback 替换全并发 RRF、把 open Issue 当已验证实现。

## 7. 对既有文档的订正索引

87 号（B2 终版 224 行，已覆盖 Lead 补注）、89 号 §1/§3、88 号 §3/§4 中：
- 「432 非标准 / E」→ 改为「Tavily 官方状态、按 code 分级冷却可抄」；
- 「modsearch 抹掉 fetchProvider」→ 改为「2.8.4 自带 patch 缺该字段，modsearch restate 是正面范例」；
- 「D5 无法最小落地 / 产品语义取舍」→ 以 89 号 §2 为准（③ 形态可落地、需点头）。

---
无凭证值写入本文件；官方类型与 2.8.4 tarball 证据可本地复现。
