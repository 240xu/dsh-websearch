# 70 · 目标模式 G2：状态语义与并发（骨架 → Lead 补完）

> **⚠️ 2026-11-15 重裁**：D5「共享状态污染」原判「产品语义、登记 Known Limitation 不修」**低估了影响**——E1 用真 provider 复现「会话 A 全 429 → 全健康的会话 B 直接被 3b 快速失败、零调用」，属跨会话功能性干扰，重裁为 **P1 待用户决定**（需改 per-session healthStore 契约）。见 [80 号](80-e1-p1p2-fixes.md) §3。
> 目标模式第 1 轮。专家 G2 落盘骨架 + 早期预警（指出 Lead 在飞版本 D6 修得不完整、并报新 P1）；由 Lead 逐条复核、修正并执行。唯一写文件为本报告。

## 逐条裁决表

| # | 项 | 裁决 | 证据 / 执行 |
| --- | --- | --- | --- |
| 1 | **D6 陈旧 rev + 非法值返 400 误导** | **成立（P3，已完整修）** | 根因：`validateOp` 在 `findNamespace`/`expectedRevision` 之前，陈旧 rev + 非法值先返 `400 invalid value`，把并发冲突伪装成字段填错。Lead 初版只在 validateOp 失败分支映射 409（G2 正确指出「陈旧 rev + 合法值」仍靠 mutate CAS 且逻辑不统一）⇒ **改为校验前统一比 revision**：`expected !== undefined && expected !== view.revision` 一律 409 `SETTINGS_CONFLICT`，host `mutate()` 仍做权威 CAS 兜 TOCTOU。断言：陈旧+bad→409、陈旧+good→409、当前 rev+非法→400、mutate 不被调用 |
| 2 | **新 P1：`void write(req, res, deps)`** | **成立（已修）** | `guarded()` 用 `Promise.resolve().then(() => handler(req,res)).catch(...)` 捕获，但 handler 里 `void write(...)` 把 Promise 丢掉 → `write()` 内部异常变成未处理 rejection，`.catch` 接不到，客户端**永远无响应**。修法 `return write(req, res, deps)` 让 Promise 链串上，`catch` 返 500。断言：`mutate` 抛错时 `rs.writableEnded === true` 且状态码 ≥400 |
| 3 | **D7 等值写不递增 revision** | **设计如此，仅文档化** | G2 判定：revision 是「值变更计数（document-content 版本）」而非「写请求计数」；`client.js` 的 `writeQueue` + expectedRevision 用于并发冲突检测，等值写不改变文档内容 ⇒ 不递增是正确语义，按 revision 轮询变更的客户端**本就不需要**看到它。处置：在 `settings-api.js` 的 `describe` JSDoc / README 明确语义，不改 mutate 行为（避免破坏 CAS 契约） |
| 4 | **D5 共享 history/health 跨会话污染** | **产品语义，登记 Known Limitation（不修）** | `history` 跨进程持久（50 条环形）、`latestBackendHealth` 进程内 Map，另一会话插入查询会改写 `lastOk`/`failCount` 并挤掉旧记录。按 session 隔离需要改持久化键与所有消费者、代价大且会影响「全局最近搜索」的既有产品语义。裁决：不改代码；在 68/72 号注明「所有运行态遥测结论必须绑定时间窗 + 会话，不能当单会话隔离证据」 |
| 5 | G2 观察的「在飞版本 13/15 测试」 | **中间态，已消除** | G2 取证期间 Lead 正并发改 `settings-api.test.js`（12→13→15 条、D6 断言一度 `200 !== 409`）；输入 `99` 在 fixture DICT 里是合法整数，改为 `1.5` 后 **72/72 → 73/73 全绿**，安装副本已同步并重启 |

## 已确认无误

1. `isConflict(err)` 与 `mutate(view.ns, ops, expected)` 的 CAS 兜底未被绕过（合法 op 仍走 mutate）。
2. `validateOp` 的错误码/文案（400）对「当前 rev + 非法值」保持不变。
3. `settings-api.test.js` 原有 12 条 fixture 测试全部仍通过。
4. 认证 API 运行态 `settings rev:0 / numResults:8`，未被本轮改动污染。

## 无法验证（E）

1. 真实并发双写下 TOCTOU 窗口（需多会话同时 POST，本轮只读）。
2. `void write` 修复前的真实 unhandledRejection 日志（G2 用 /tmp 复刻证明，未在生产触发）。
3. D5 按 session 隔离后的产品行为（未实现）。

## 5 条反直觉

1. 「修 D6」的第一版比不修更危险：只在校验失败分支映射 409，会让「陈旧 rev + 合法值」和「当前 rev + 非法值」走两条不一致的路径。
2. `void` 一个 async 调用看起来只是「不关心返回值」，实际是**把异常从 Promise 链上摘下来**——这是 P1 级无响应。
3. 测试 fixture 的 `Number.isInteger(99)` 为 true，让「非法值」断言变成 200；用 `1.5` 才真正触发 schema 拒绝。
4. `revision` 不递增反而是正确的乐观锁语义：等值写不改变文档，冲突检测不该被「空写」推进。
5. 共享状态污染不能只靠加锁解决：`history` 跨进程持久、`health` 进程内易失，两者天然没有统一的隔离边界，按 session 隔离要重做持久化契约。

---
无凭证值写入本文件；所有结论可由文中命令与单测复现。
