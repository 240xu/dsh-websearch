# 88 · 本轮专家评估与「选择性抄」总裁决（2026-11-15 22:25）

> **⚠️ 22:30 再修订（[89 号](89-b1-source-findings.md)）**：§4「D5 复议为产品语义取舍、无法最小落地」被 B1 源码级证据推翻——PR#47334 的 `attempted` 是 per-query 局部，3b 可绑定本次 search 局部失败集合，无需 sessionID；仍是需用户点头的核心语义改动。§3 抄取清单新增「modsearch `classifyQuota` 区分 429 每秒限流与 432/433 月度预算」「`reorderByCooldown` 移到队尾而非排除」两项。其余结论不变。
> 用户「分配专家自代理评估，再分配一个去搜同类型项目，评估亮点，选择性抄」。
> 共派 **5 位专家 + 1 次外部圆桌（4 家全失败，未重试）**：A1 当前成果复核（81）、A2 D5 与落地（82）、S1 同类项目（83）、B1 选择性借鉴（86）、B2 对抗型反方（87）。Lead 侧另有 [84 号](84-lead-peer-leads.md) 线索底稿、[85 号](85-a1-g5-refresh.md) A1 事故处置。

## 1. 评估结论汇总

| 专家 | 结论 |
| --- | --- |
| **A1（81）** | **证伪成立**：`g5/G5-authoritative.patch` 是 `230c1cf` 旧快照，含 N1 `req.destroy()` / N3 旧 id、无 N4/N2；真实 apply 到 2.8.4 仅 **25/35** 与 src-work 相同 ⇒ 会把 E1 刚修的 4 条 P1 全部重新引入。已修（见 §2） |
| **A2（82，458 行终版）** | D5 决定性新事实：**provider 是单例**（`index.js:498` 只创建一次、`:514` 注册一次），`WebSearchRequest` 无 session 标识 ⇒ 注入式 healthStore 只隔离多实例、**单进程跨会话仍在**；429 是账号级配额，「全健康的 B」是 fake 假设 ⇒ **建议 D5 从 P1 复议为产品语义取舍**。另发现 `history.js:87-96` `clear()` 直接 `unlinkSync` 删整文件 ⇒ 任一会话清空历史、全进程一起丢 |
| **S1（83）** | 11 个同类项目/资料；核心事实 API 实测：PR#47334 **已合并**（2026-09-06，18 文件）、#58327 / #60176 **均 open** |
| **B1（86）** | Top5 抄取清单；核心是「**分离全局冷却事实与会话失败判定**」（PR#47334 的数据结构决定） |
| **B2（87）** | **默认不抄**：8 项亮点里 **7 项本地已等价或更好**；最大风险是升级/替换覆盖 35 文件补丁；最终 **NO-GO 本轮不改代码** |

## 2. 已执行（零风险、无需用户点头）

1. **G5 权威源修复**（A1）：重新生成 `G5-authoritative.patch`（37 段 / 4024 行，范围收窄到 `lib tests README.md package.json .gitignore`），新增 **`g5/refresh.sh`** 把「重新生成 + 洁净 2.8.4 apply + 35/35 逐字节 cmp」固化成一步，双位置可跑；README 记录事故。提交 `83cfae8`。
2. **P0 选择性抄取**：把 #58327 的教训固化成契约 —— README 新增「Adding a backend：非 2xx 必须走 `webErrorFromResponse`、禁止手写丢 status 的 WebError」，并加静态断言钉住 **11 处调用点**。单测 **80→81/81**、35/35 一致。
3. **Lead 侧源码级取证**（84 号）：PR#47334 的 `cooldowns=Map<ID,{until,error}>` 全局 + `preferred=Map<Session.ID|undefined>` 按会话 + SessionEvent 清理；两个 open Issue 的正文。
4. 5 份报告补完并同步分支；远端 `local-audit-35files-20261115` = **`37d7200`**，9 commits，全历史 0 密钥命中。

## 3. 「选择性抄」最终裁决

| 抄什么 | 裁决 |
| --- | --- |
| **状态分离的设计意图**（PR#47334） | ✅ 值得抄为**前置设计**；但单进程单例 + 无 sessionID ⇒ 本轮**无法最小落地**，待用户决定是否跨包动 seam |
| **新增后端必须走结构化 helper**（#58327 教训） | ✅ **已抄并落地**（P0） |
| **quota/plan-limit 纳入轮换**（#60176 设计意图） | ⚠️ 我们已有 402=QUOTA / 429=RATE_LIMIT / 403 不算 / keyless 独立标记，**比 open Issue 更完整**；432 需先确认上游真发（E） |
| **late successes / in-flight cleanup 测试**（#47334 测试项） | ⚠️ P0 可加测试，本轮未做（留下一轮） |
| **SSRF/allowlist 清单** | ❌ 照搬会误伤我们为自托管 SearXNG 开的 RFC1918 plain-http trust gate |
| **有序 fallback 替换全并发 RRF** | ❌ 产品取舍冲突（13 后端融合→首个成功即胜），只能做可选模式且要全链同步 |
| **升级 2.8.8 / modsearch 替换整行 web config / 照搬 Effect+Session.ID** | ❌ 覆盖 11/23 已修文件、重现 `WEB_PROVIDER_AMBIGUOUS`、无对应物 |

**一句话（只做一件零风险立刻可做）**：把「新增后端必须走 `webErrorFromResponse`」写进 README + 静态断言 —— 已做完。

## 4. D5 与 `history/clear` 的复议（需用户点头）

- **D5**：B1 原推荐「分离全局冷却与会话判定」，A2 终版证明单进程单例下无会话 ID 可注入，且 429 是账号级配额 ⇒ **重裁为产品语义取舍**，不再是「本轮可修的 P1」。
- **`history/clear`**：`clear()` 删整个 `history.json`，任一会话调用即全进程丢历史，比 D5 更直观。是否改为按会话分段 / 加确认 / 只清内存，需用户定产品语义。
- 两者都**不改本轮代码**，登记为待决。

## 5. 落地四类（A2 复核）

| 路径 | 裁决 |
| --- | --- |
| PR base **2.8.4** | **GO**（分支基即 2.8.4，`git apply --check` 35/35）；**2.8.8 NO-GO**（4 文件 6 hunk FAILED，且 main 已 2.8.8、分支基 2.8.4 有回退分叉） |
| `npm publish` | **NO-GO**（`ENEEDAUTH`，latest 仍 2.8.8） |
| patch-package | **NO-GO**（pnpm-only profile 无 npm/yarn lock） |
| `0.2.2-rc.3` | **NO-GO**（运行时本就 0.2.2-rc.1，切 runtime 重演 symlink 悬空） |

## 6. 终态

服务 active PID 566981、三 env 保持、**81/81 单测、35/35 文件一致、26 备份**、`g5/refresh.sh` 35/35、分支 `37d7200` 与远端全 SHA 一致、全库 0 密钥命中。**main 未合、PR#7 未更新、npm 未 publish。**

---
无凭证值写入本文件。
