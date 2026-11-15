# 80 · E1 证伪后的 P1/P2 全量修复与运行时验收（2026-11-15 15:50）

> 用户「ok」后继续办；E1 评估专家（[73 号](73-nextstep-gaps.md)，340 行终版）**证伪了「无未修 P0/P1」**：65 号（41KB V1 代码层终版）本就标了 5 条 P1，而 68 号汇总误写成「V1 证伪失败、无未修 P0/P1」，69–72 号一条没覆盖。本轮逐条独立复核、修复、同步、重启、验收。

## 1. 裁决：68 号错误口径的来源

- `65-assessment-code.md` 在 11-11 由 V1 专家补成 **41093 字节终版**，含 N1–N5 五条 P1（A 级行为级证据）+ N6–N10 五条 P2。
- 11-11 我写 68 号汇总时读的是**32 行骨架**，故误判「V1 证伪失败」。⇒ 历轮「无未修 P0/P1」结论**不成立**；本号 + 73 号为当前权威。
- E1 用真 HTTP / 真 cordis / 真 provider 独立复现，不引用历轮，确认 N1/N2/N3/N4 仍在（N5 混合故障已由 V3 那轮修掉）。

## 2. 4 条 P1 修复（全部有行为级或真 HTTP 测试）

| # | 缺陷 | 修法 | 测试 |
| --- | --- | --- | --- |
| **N1** | `settings-api.js` 的 `readBody` 超限后 `req.destroy()` → 70KB POST 客户端拿到 `ECONNRESET` 而非 413（本轮之前引入的回归） | `req.destroy()` → `req.resume()`（排空剩余 body，让 413 能写出、keep-alive 可用） | 真 `http.createServer` 断言 413 + body 含 `request body too large`；**运行态实测 HTTP 413**、后续 GET 200 |
| **N2** | `provider.js` 的 `resultOptions` 只扫 `opts` 顶层，但 `baseURL/model/searchDepth/safeSearch/apiKeyEnv` 在 `opts.backends[id]` 嵌套里 ⇒ 改配置 900s 内被缓存掩盖、返回旧实例 URL | 把每个启用后端的 5 个键以 `${id}.${k}` 摊进 `resultOptions` | 真 provider + 真磁盘缓存：改 `baseURL` 后第二次 `calls` 1→2（不命中旧键） |
| **N3** | `skipInitialize` 的 `callBody.id=1` 与 `initialize` 撞号；plain-JSON 错 id 原样返回；SSE 严格 `===` 与 batch `String()` 不对称 | ① skip=2 / sessionful=3（避开 initialize 的 1）；② SSE 挑帧改 `String()`；③ **plain-JSON 显式不同 id 抛 `WEB_PROVIDER_ERROR`**，无 id 仍容错；④ 把解析异常移出 `catch {}` 避免吞掉 WebError | 混合 SSE（id=1 serverInfo + id=3 real）挑中 real、字符串 id 接受、`id=7` 抛错；P0 fake 改为**回显请求 id**（真实 JSON-RPC 语义）后 2 条 P0 测试不误杀 |
| **N4** | `sessionCache` 纯 URL 键控（换 key 复用旧会话）；initialize / notification / 401 重试握手都不带 `X-API-Key` | `sessionCacheKey(url, extraHeaders)` 纳入 `authorization`/`x-api-key`/`x-tinyfish-access-mode` 摘要；`ensureSession` 收 `extraHeaders` 并透传到 3 处握手；`invalidateSession` 同步带摘要 | 真 HTTP server 捕获：`KEY_A`→`KEY_B` 触发 **2 次 initialize**、两次各带对应 key、notification 带 key |

**N3 的关键裁决**：我在本会话早前曾因给 plain-JSON 加严格 id 校验而误杀 stateless 端点（当时 skip id=1、fake 回 id=2），被迫撤回。本轮**先把 id 改成 2/3、让 fake 回显请求 id**，条件变化后严格校验才安全 —— 不是简单「重新加回」，而是补齐了前置条件。

## 3. E1 的 4 条 P2（3 条已修，1 条重裁）

| 项 | 处置 |
| --- | --- |
| **A.6 `webCtx.effect` 中途注册抛错泄漏路由** | ✅ 改为渐进收集 disposer + `catch` 内逆序回滚后重抛；真行为级断言（第 3 次 register 抛错 → 前 2 条被删除、只剩外部预占路由） |
| **A.7 `createLimiter(0)` 永久挂起** | ✅ `maxRunning = Math.max(1, Math.floor(Number(concurrency) \|\| 1))`；**注意首版把常量命名为 `limit` 与返回函数名冲突导致全挂起，已改名 `maxRunning`**；0/-1/NaN 各 200ms 内 resolve |
| **A.8 D3 修法产生「过期正向注记」** | ✅ 渲染时 `isCooled(centry, Date.now())` 为 false 则追加 `(expired during search)` |
| **D5 跨会话功能性干扰** | ⚠️ **重裁为 P1 待决**：真 provider 复现「会话 A 全 429 → 全健康的会话 B 直接被 3b 快速失败、零调用」。历轮「只登记 Known Limitation 不修」低估了影响。修它需把 `latestBackendHealth` 改为按 session 隔离的 `healthStore` 并注入 provider/health/history 三处契约，属架构/执行语义改动 ⇒ **本轮不改，需用户点头**（下方 §6） |

## 4. 阻断解除：同步 + 重启 + 运行时验收

E1 的 T2 简报指出「工作副本已修但安装副本 DIFF、服务未重启 ⇒ 运行时仍跑旧代码、4 条 P1 全在」。本轮已解除：

| 项 | 结果 |
| --- | --- |
| 同步 | 10 个 DIFF 文件（4 lib + 6 tests）逐字节同步到 `$P` |
| 35 文件一致 | **35/35** |
| 全量单测 | **80/80**（本轮 +7 条断言） |
| 安装副本语法 | 33/33 OK；26 备份齐 |
| 服务 | **15:25:15 重启，PID 566981**，三 env 保持 |
| `web_fetch` | HTTP 200 |
| `web_search` | 8 条 Sources，`exa/parallel/ddg/tinyfish` 四后端全 ✓（N3/N4 的 MCP 改动未破坏真实后端） |
| 认证三 API | settings / health / history 全 200；`health enabled=6 requestedMaxResults=8` |
| **N1 决定性验收** | 70KB POST → **HTTP 413** `{"ok":false,"error":"request body too large"}`（此前 ECONNRESET）；同连接后续 GET 200 |

## 5. 文档订正

- **68 号**：V1 结论应为「证伪成立、存在未修 P0/P1」，不是「证伪失败」；已加更正注。
- **73 号**：E1 的 340 行终版保留；本报告为其 T2 之后的执行结果。
- **70/72 号**：D5 从「产品语义、登记不修」重裁为「P1 待用户决定」。
- **74/76/79/REPORT**：E2 三条订正（4 文件 6 hunk FAILED、`pushed_at` 三时间戳、PR#7 精确状态）+ patch-package 硬阻塞 + G5 权威源（发布仓库 `git diff d2602823..HEAD`，`git apply` 到洁净 2.8.4 后 35/35 逐字节相同）。
- **G5 格式陷阱**：手工 `diff` 带 `|---` 分隔行或 `base2.8.4/…↔pr284/…` 段头的补丁，`patch -p1` 真实 apply 会交互等待/找不到文件，`--dry-run` 却误报 CLEAN。已归档到 `g5/archive/`，`g5/README.md` 声明唯一权威源与验收方式。

## 6. 当前状态与待决

**无未修 P0/P1 —— 除 D5 一条（重裁为 P1 待用户决定）**。所有改动有注释、有备份、有行为级测试、已同步并重启验收。

需用户点头：
1. **D5**：是否把 `latestBackendHealth` 改为 per-session `healthStore`（会动 provider/health/history 三处契约）；
2. 从 `local-audit-35files-20261115` 开 PR 到 main（PR base 选 2.8.4 还是 2.8.8；后者要解决 4 文件 6 hunk 冲突）；
3. bump 2.8.9 + `npm publish`（`ENEEDAUTH`）、patch-package 落地、是否上 `0.2.2-rc.3`。

---
无凭证值写入本文件。
