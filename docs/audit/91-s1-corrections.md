# 91 · S1 取证订正与新增高价值来源（2026-11-15 22:40）

> S1 顾问 22:35 发来早期取证纠正；Lead 用本地 `11-traceability-audit.md` 与既有证据独立复核，全部成立。**只评估，未改代码/运行时。**

## 1. 版本归属订正（A 级，本地既有证据）

| 旧说法（83/84/86/87 号） | 实测 |
| --- | --- |
| 「上游 **2.8.8** ddg 超时 5s→8s」 | **是 2.8.6**（[11-traceability-audit.md:66](11-traceability-audit.md)）：`2.8.6: forwarder hop via node:http + failure-path hardening` 的 CHANGELOG `:3-13` 明列 **DDG 超时 5s→8s**；**2.8.7/2.8.8 只有 README / 版本号，`lib/` 零改动**（:68/:70）。上游 main 的 CHANGELOG 停在 2.8.6 |

⇒ 83/84/86/87 号里「2.8.8 的 forwarder/ddg 亮点」应改为「**2.8.6 的**」；「升级 2.8.8 会覆盖 11/23 个被改文件」的结论**不变**（那是 2.8.4→2.8.8 的累计差异，与具体版本归属无关）。

## 2. 项目身份订正（A 级）

- `f0909172434/dsh-plugin-verified-search` **301 → `Chih-Kai-Wang/dsh-plugin-verified-search`**；其 README 讲的是 **bounded evidence workflow / 显式 gaps / 三轨发布**，**不是 SSRF hostname 清单**。
  ⇒ 83 号把它列在「SSRF/allowlist」下是**误分类**；87 号「照搬会误伤出网 trust gate」的整条论证对象错了。B1 的 90 号已指出「allowlist 是结果侧来源后过滤、不是出网边界」，本号进一步确认它连 allowlist 主线都不是。
- `chendefine/dsh-web-search-aggregation` 的 `src/provider.ts:82-132`（优先队列 + AttemptFailure 摘要 + Key Rotation）、`src/keys.ts:22-70`（逗号 key 池 + maskApiKey）**已读到源码** ⇒ 83 号标 C/E 应升 **A**。

## 3. PR #47334 的 A 级源码证据（S1 独立复核）

S1 用 GitHub REST `/repos` + `/pulls` + dev 分支 raw 源码读到 `packages/core/src/websearch.ts:93,143,184,222` 的 `cooldowns`(全局) / `preferred`(按 session) / `attempted` / `cooldownMillis`，**带行号**，不再只依赖 PR 正文。merged=true、18 文件 / 5 commits / +1360−175 / 2026-09-06T21:39:48Z。与 84/89/90 号一致。

## 4. S1 新增的 3 个高价值来源（待 83 号终版融合）

| 来源 | 亮点 | 与我们的相关性 |
| --- | --- | --- |
| `guotree/opencode-search-plugin` `test/request-lifecycle.test.ts:96-143` | **typed 429 + Retry-After + 零 secret/query 泄漏**断言 | 我们 `webErrorFromResponse` 已有 `retryAfter` 透传 + `safeFailureReason` 固定码；可抄「把零泄漏写成行为级测试」 |
| `firecrawl/dsh-firecrawl` `tests/redirect.spec.ts:78-150` | **真双 HTTP 服务器**断言「第二跳 0 命中 / 0 Authorization」 | 我们 `egress-fetch.js` 有 `redirect:"error"` 与 Host 补正，但没有「跨跳不泄漏凭证」的真服务器测试 ⇒ 值得抄测试形态 |
| `fangchenghao/dsh-web-search` `docs/rrf-ranking.md:60-118` | **离线 20-query bench + 81 配置 sweep + paired bootstrap** | 我们 RRF `k=60` 是固定常量、无离线评估 ⇒ 值得抄「配置扫描 + 成对 bootstrap」的评估方法（不是抄参数） |

## 5. 对既有文档的订正索引

- **83 号**：版本归属、verified-search 身份、chendefine 等级、新增 3 来源 —— S1 终版会直接融合进 83 号。
- **84 号**：「2.8.8 ddg 8s」→「2.8.6」；verified-search 描述改为 bounded evidence workflow。
- **86/87 号**：同版本归属订正；87 号关于 verified-search 的整条论证以 90 号为准。
- **88 号**：§3 的「上游 2.8.8 亮点」措辞订正，结论不变。

## 6. 不变的结论

- 本轮 **NO-GO 不改代码**；已落地的 P0（新后端必须走 `webErrorFromResponse`，81/81）不变。
- D5 以 89/90 号为准：③ 形态（3b 绑定本次 search 局部失败）可落地、需用户点头。
- 第二个可抄点（modsearch 按 code 分级冷却：429 秒级 vs 432/433 24h）以 90 号为准。
- 明确不抄：升级 2.8.8、照搬 Effect/Session.ID、有序 fallback 替换全并发 RRF。

---
无凭证值写入本文件。
