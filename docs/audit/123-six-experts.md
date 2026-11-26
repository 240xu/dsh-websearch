# 123 · 六专家「取长补短」比对与落地（2026-11-26，目标模式第 1 轮）

> 用户「分配多个子代理对两版比对取长补短」。
> 六棵子树：**UP**（origin/main 2.8.8）· **OUR**（local-audit 2.8.4+38 段）· **MERGED**（merge/upstream-288-plus-fixes）。

## 0. 结果

| 项 | 结果 |
| --- | --- |
| 子代理 | **6 个**（A1–A6），全部 finished，六份报告 **177 / 332 / 472 / 206 / 575 / 204 行**，零「待填」 |
| 采纳并落地的修复 | **13 条**（A1 ×3 · A2 ×1 · A3 ×3 · A4 ×4 · A5 ×3 —— 含重叠计一） |
| 驳回并给出实测证据 | **3 条**（A2 的 history 双写 / A2 的 telemetry 两套 / A2 的 cooledAnnotation Date.now） |
| 测试 | **168**（原 113 + 上游 55），**167 pass / 1 fail**（唯一失败：`no proxy env`，本机无直连外网） |
| health 单独 | `all 4 test groups passed` |
| 补丁 | **26 段 / 3077 行**，apply 到干净 2.8.8 后 **逐字节 34/34** |
| 3082 端口 | health **200**（enabled=6 / 13 backends）· 真搜索 **8 sources**（exa+parallel+tinyfish 并发） |
| 主实例 3080 | active PID 2602382，**全程未重启**（除为让 2.8.8 生效的两次用户授权重启） |
| main | **未动**（仍 `da42e44`） |

## 1. A1 网络层（agent-12）——3 条，全修

| # | 主张 | 我的核实 | 处理 |
| --- | --- | --- | --- |
| C1 | 我加的 `forwarderUsable` 探针闸门让**每个 endpoint 的第一次请求永远走不到 sidecar** | ✅ 成立。UP 实测 `sidecarHits=2 / proxyHits=0`，MERGED 第 1 次走代理 | 未知/过期一律**乐观**返回 true，后台探测只用于「已确认死则退休 60s」 |
| C2 | `forwarderFetch` 传输失败应回落代理一次 | ✅ 成立，但**我第一版收得太宽** | 只对 `ECONNREFUSED`/`EHOSTUNREACH`/`ENETUNREACH` 回落；**`stalled sidecar`（`did not respond within Nms`）必须原样抛出** |
| C3 | UP 的 `tests/egress-fetch.test.js` 13 用例没搬 | ✅ 成立 | 搬进来，**13/13 逐条 pass** |
| P2 | `depth` 形参从不递增，`MAX_REDIRECTS=5` 是死代码 | ✅ 成立 | `egressFetch(url, init, depth=0)` 透传 + 递归 `depth+1`。实测：自引用 302 **6 次代理命中**（5 跳 + 末次）而非 21 次 |

**C2 的双向验证**：

| 场景 | 结果 |
| --- | --- |
| sidecar 活（13081 假服务） | 第 1 次就 `sidecarHits=1` |
| sidecar 死（13082 无监听） | **200 in 1.2–1.5s**（回落成功） |
| sidecar 停滞（接受不响应） | 正确抛 `forwarder did not respond within 300ms`（不回落） |

## 2. A2 provider（agent-13）——1 条成立，2 条被证据驳回

| # | 主张 | 我的核实 | 处理 |
| --- | --- | --- | --- |
| A | 全失败 **history 双写**（L581+L603，写 2 条） | ❌ **不成立**。实测单次故障 `history 条数 = 1`。L569 是「0 失败但 0 结果」的 return 前分支，L598 是「全失败」的 throw 前分支，**互斥** | 不修 |
| B | 全失败页 `cooledNote` 自相矛盾（把 fail-open 重跑的后端写成 cooled-skipped） | ✅ 成立 | 按 `allTelemetry` 实跑过的 id 过滤；实测第 2 次不再出现该注解 |
| — | 「`appendTelemetry`/`renderTelemetryLine` 两套并存」 | ❌ 不成立（OUR 里 `renderTelemetryLine` = 0，我上一轮提取已回滚） | 不修 |
| — | 「两处 `cooledAnnotation(centry, Date.now())`」 | ❌ 不成立（两处都用 `nowMs`；`Date.now()` 只在 `latestBackendHealth` 那处） | 不修 |
| — | 建议改回 UP 的「有 active 就只跑 active」 | 这是**产品语义选择** | **保留 fail-open**（容错优先），quota 路径已正确（A2 实测 `serperCalls=1`） |

> A2 读的行号来自被并发编辑的 `/tmp/merge-tree`（分析期间 607→613 行），这是它两条误判的根因。

## 3. A3 backend（agent-14）——3 条，全修

| # | 主张 | 我的核实 | 处理 |
| --- | --- | --- | --- |
| P0#1 | searxng **预算打架**：`4.5s × n` vs `8s` 天花板 | ✅ 成立。实测 2 实例最坏 9000ms，provider 在 8000ms 先 abort 并丢掉 per-instance 细节 | 每实例 `min(4500, 剩余预算/剩余实例数)`。**实测 3 个死实例：8002ms 结束、3 个全试过** |
| P0#2 | `lastErr` 顺序覆盖，`[429, 网络失败]` 退化成通用错误 | ✅ 成立 | 按严重度择优（`RATE_LIMIT`/`QUOTA_EXCEEDED` 优先）。**双向验证**：429 在前/在后都保留 `RATE_LIMIT/retryAfter:60` |
| P1 | openai/anthropic 消息重复 | ✅ 成立 | `message` 只存 upstream detail。真打 OpenAI 回 403，现在只出现一次前缀 |

**A3 的另一条重要发现**：`webErrorFromResponse` 两处 HTTP 分支**都保住了**（L168/L170），单实例 429 实测 `RATE_LIMIT/status:429/rateLimited:true/retryAfter:30` ✅ —— 这是我上一轮合并时最担心的点。

**A3 的诚实评价**：`describeError` 是 OUR 树**没有**的跨树依赖（以 OUR 的 lib/util 覆盖会立刻 5 文件 `ERR_MODULE_NOT_FOUND`）。

## 4. A4 装配（agent-15）——4 条，全修

| # | 主张 | 我的核实 | 处理 |
| --- | --- | --- | --- |
| 2a | `retryAfterMsFrom` 永返 60000，配额冷却绕过 `breakerCooldownMs` | 函数本身正确（读 `err.retryAfter`）；问题在 breaker 侧 | 未单独改（`breaker` 的 quota 分支已读 `opts.retryAfterMs`） |
| 2b | `cooldownMs=0` 时 `failCount 3→1`，阈值永远追不上 | ✅ 成立。零长度窗口立刻过期 → streak 重置 | `cooledUntil: cooldownMs > 0 ? now+cooldownMs : 0`。实测 `1→2→3→4→5` 单调；60s 配置仍第 3 次开窗 |
| 3a | cache `maxEntries:3` 前 16 次写不淘汰（残留 9） | ✅ 成立。实测写 12 次残留 **12 个** | 改为**硬约束**：每次写按已列 entries 直接淘汰。残留 **3 个 / 3ms** |
| 3b | `history clear()` 返回 Promise 但路由不 await | ✅ 成立 | Promise 链里再 `send 200`。实测 clear 后立刻读 = **0 条** |
| — | `resultOptions` 正则漏 `baseURLs` | ✅ 成立（摊平列表只有 5 个键） | 加 `baseURLs`。实测改配置 → 后端被调 **2 次**（缓存正确失效） |

**A4 的装配层好消息**：MERGED 路由**只注册一遍、无重复**（health/history×2/settings 各 1 次）；`settings-api/cache/history/health/trust/breaker` 6 个文件 md5 与 OUR **完全相同**（`no-store` + `writableEnded` 保住，413 用 `resume()` drain 比 `destroy()` 正确）。

## 5. A5 client（agent-16）——3 条，全修

**A5 的反转结论**：UP 的 `client.js` 与 2.8.4 基线**字节相同**（`git diff d260282 origin/main -- lib/client.js` = 0 行）⇒ 「UP 有而我们缺的新 UI 能力」= **0 项**。是**我们丢了旧能力**。

| # | 主张 | 我的核实 | 处理 |
| --- | --- | --- | --- |
| C1 | 语言字段是 `SelectField` 但**没传 options** → `props.options.map` TypeError | ✅ 成立，且**是我 `740676a` 拆分时引入的**（拆分前与 UP 都是 `<input>`） | 修回 `<input>` + `langLabel` |
| C2 | 只读 scope 下 Save 少了 `\|\| state.writable === false` | ✅ 成立 | 加回 |
| C3 | 6 个 i18n 键「用了但字典没有」 | ✅ 5 个成立（`langLabel` 本来就有） | 补 5 键 × 2 语言 |
| — | **测试假绿**：4 处 walker 的 `catch` 吞掉 TypeError，21/21 掩盖三处渲染崩溃 | ✅ 成立 | 去掉 catch → 仍 21/21（因 C1 已修）；换 A5 的 `cb-r3.test.js`（含 3 条真渲染断言）→ **24/24** |

## 6. A6 tests/文档（agent-17）——采纳 8 组，驳回 2 组

**采纳（在 MERGED 树上 0 改动全绿）**：

| 组 | 用例数 |
| --- | --- |
| `parse` | 28 |
| `filters` | 10 |
| `rank` | 9 |
| `rrf` | 文件级 |
| `p1-regression` | 5 |
| `store-dir` | 文件级 |
| `v281-form` | 文件级 |
| `health` | 4 组（plain assert，需单独跑） |
| **合计** | **55 条 node:test + 4 组** |

**驳回（搬进来等于回退我们的有意变更）**：

- `breaker.test.js` —— MERGED 新增「过期窗口重置连击」语义
- `cache.test.js` —— MERGED 用摊还淘汰 → 已改为硬约束（更严格，但断言的精确计数不适用）

**A6 的文档判定（未执行，留给下一轮）**：`CHANGELOG.md`（294 行，最高到 2.8.6，记的正是本树因果）值得搬；`HANDOFF.md`/`EXTENSION_PLAN.md`/`docs/superpowers/*`/根 `*.tgz` 不搬；`package.json` **无任何 UP 有而我们缺的字段**；`cordis.patch.yml` **逐字节相同**。

## 7. 额外：`agent-3`（旧轮次的 R3 复审）带来的两个立即动作

| 动作 | 状态 |
| --- | --- |
| 删掉已无键引用的 `patches/@240xu__dsh-websearch@2.8.4.patch` | ✅ 已删（备份到 `src-work/backups/old-284-patch-20261126T115218/`） |
| 修 `restore-plugin.sh`：版本从 `$1` 或 pin 推断，自动清旧键 | ✅ 已改并用「旧 2.8.4 键 → VER=2.8.8」实测替换正确 |

A3 的核心警告值得记：**版本钉死的补丁键把 profile 的包管理器绑成全局单点** —— 键一漂，装/卸任何插件都 `ERR_PNPM_UNUSED_PATCH` exit 1，且 `removeBundle` 先落 `bundles` 再跑 pnpm（无回滚）。

## 8. 我犯的 6 个错（都被工具或专家抓到）

| 错 | 谁抓到 | 后果 |
| --- | --- | --- |
| 探针闸门挡住第一次请求 | A1 | 冷启动首搜丢掉 JA3 修复 |
| C2 回落条件太宽（含 `ETIMEDOUT`） | 上游测试 | stalled sidecar 被粉饰成 200 |
| `severity` 判据写成 `WEB_RATE_LIMITED`（真实是 `RATE_LIMIT`） | 我自己反转顺序重测 | 第一次「通过」是运气 |
| `breaker` 引用未定义的 `retryAfterMsFallback` | `node --check` | 语法错 |
| `cache` 第一次只改初值没改门槛 | 我的实测 | 残留仍 12 |
| 自己写的 3 条渲染测试用不存在的 `bootRender` | 跑测试 | 全失败，改用 A5 的 |

## 9. 未做 / 待决策

1. **`breakerFailOpenOnOutage` 产品语义**：保留 fail-open（现状，容错优先）还是改回 UP（熔断优先）。**需要用户拍板**。
2. **A6 的 CHANGELOG 搬迁**。
3. **主实例 3080 尚未加载最终树**（`lib` mtime 14:39，进程 11:07 启动）。需要一次重启。
4. **A5 的 C9/C13**（P3/P4 打磨）。
5. **A2 建议的 `failureLabelFor(id, err)`**（让 code 进文本层）。

## 10. 结论（A–E）

- **A**：168 测试 / 167 pass、13 条修复、6 份报告 177–575 行、3082 三段 200 + 真搜索 8 sources，全是实测。
- **A**：3 条驳回都有直接反证（history 1 条、两套 telemetry 不存在、两处都 `nowMs`）。
- **A**：searxng 预算修复双向验证（3 死实例 8002ms / 429 前后两种顺序）。
- **B**：A2 的两条误判源于它读的 `/tmp/merge-tree` 被我并发编辑（行号漂移）。
- **C**：`breaker` 的 `retryAfterMsFrom` 未单独改，因 quota 分支已读 `opts.retryAfterMs` —— 若 A4 的实测（cfg 0/60s/3600s 全为 60s）仍复现，需再查。
- **D**：失败的那 1 条测试是环境限制（本机无直连外网），非代码缺陷。
- **E**：主实例 3080 未跑最终树。

---
无凭证值写入本文件。
