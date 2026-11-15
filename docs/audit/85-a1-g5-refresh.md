# 85 · A1 证伪后的 G5 权威源修复（2026-11-15 22:00）

> 用户「分配专家自代理评估 + 找一个搜同类项目评估亮点选择性抄」。A1/A2/S1 三位并行派发（81/82/83 号）。本文件记录 **A1 早期预警已坐实的一条 P1** 的处置；A2/S1 结论待回收后另补。

## 1. A1 指控（独立复核成立，且比它说的更严重）

`g5/G5-authoritative.patch` 在 E1 那轮修复提交 `52e26ae` 后**没有重新生成**，仍是 `230c1cf` 时代的 39 段旧快照：

| 检查 | 结果 |
| --- | --- |
| 补丁内 `req.destroy()` | 2 处（N1 未修） |
| 补丁内 `id: skipInitialize ? 1 : 2` | 2 处（N3 未修） |
| 补丁内 `sessionCacheKey` | **0**（N4 未修） |
| 补丁内 `resultOptions[\`${id}.…\`]` | **0**（N2 未修） |
| 补丁段数 vs `git diff d2602823 HEAD` | 39 vs **43** |
| 补丁 md5 vs HEAD diff | 不同 |
| **旧补丁真实 apply 到洁净 2.8.4 后与 src-work 逐字节相同** | **25/35**（10 个 DIFF 恰是 E1 修的 4 lib + 6 tests） |

⇒ 用旧补丁 apply 到 2.8.4 / 2.8.8 会**把 N1–N4 四条 P1 全部重新引入**。`g5/README.md` 声称的「35/35 逐字节相同」已失效；「G5 权威源正确 / 已推送分支内容正确」不成立。

**根因**：每次代码提交后没有重新生成补丁的强制机制，79/80 号只手工生成了一次。

## 2. 处置（已执行）

1. **重新生成**：`git diff d2602823 HEAD -- lib tests README.md package.json .gitignore` → **37 段 / 3983 行**（收窄范围，排除 `g5/archive/` 三份旧补丁，否则会膨胀到 25494 行 / 43 段）。
2. **验收**：洁净 2.8.4 树 `git apply --check` exit 0 → 真实 `git apply` → 与 `src-work` **35/35 逐字节相同**；对 2.8.8 `git apply --check` exit 1（仍不兼容，符合预期）。
3. **防陈旧机制**：新增 `g5/refresh.sh`，把「重新生成 + 37 段下限检查 + 洁净树 apply + 35/35 `cmp`」固化成一步；不满足就 exit 1。**双位置可跑**（产物树 `g5/` 与发布仓库分支里的副本），两处实测均 `35/35 byte-identical`。
4. **README 订正**：把静态「35/35」改为「每次代码提交后必须 `bash g5/refresh.sh`」，并完整记录这次事故（A1）。
5. **提交推送**：`83cfae8` → `local-audit-35files-20261115`，8 commits；提交前 80/80 单测、暂存区 0 密钥命中、两处 patch md5 一致。

## 3. 待回收

- **A1 完整报告**（81 号）：仍在复核 E1 修复是否引入回归、分支内容一致性、全历史密钥扫描；早期预警只覆盖了 G5 一条。
- **A2**（82 号）：D5 per-session `healthStore` 最小修法对比 + 落地 go/no-go。
- **S1**（83 号）：同类项目亮点与**选择性抄取清单**。

## 4. Lead 侧已先行取证的同类项目线索（[84 号](84-lead-peer-leads.md)）

- **PR #47334 已合并**（2026-09-06，18 文件）：核心是 `cooldowns = Map<ID,{until,error}>`（**全局共享**）+ `preferred = Map<Session.ID|undefined,{provider?}>`（**按 session 隔离**）+ 订阅 `SessionEvent.Deleted/Moved` 清理。⇒ 给 A2 的 D5 修法提示：分离「全局冷却事实」与「会话偏好/失败判定」，而不是把整个 health 按 session 隔离。
- **Issue #58327 / #60176 均 open**（未修）：前者指自定义 provider 无法上报 rate limit、任何失败都硬失败；后者指 retry loop 只在 429 轮换，Tavily 432 / 其它 402 的 quota 失败被忽略。⇒ 可抄的是**设计意图**（结构化错误分类、把 quota 纳入轮换），不是实现；我们已有 `webErrorFromResponse` 的 402=QUOTA / 429=RATE_LIMIT / 403 不算的分类基础。

---
无凭证值写入本文件。
