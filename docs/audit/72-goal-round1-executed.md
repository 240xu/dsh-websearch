# 72 · 目标模式第 1 轮执行记录（2026-11-11 22:30 → 11-12 05:15）

> **⚠️ 2026-11-15 更正**：本文 §3「无未修 P0/P1」在成文时点成立，但 65 号（41KB V1 终版）里的 N1/N2/N3/N4 四条 P1 未被覆盖；68 号汇总误判导致遗漏。已由 [80 号](80-e1-p1p2-fixes.md) 全部修复并重启验收（80/80 单测、35/35 一致）。
> 目标 `goal-b60126fd-…`（15 轮上限，armed）。用户「开目标模式，确立当前目标，继续办」。
> 基线 `.baseline-20261111-2230/`（74 文件、43 插件文件 md5）。三次专家派发（G1/G2/G3，69–71 号），fork 骨架后结束但**中期简报送达**，Lead 逐条复核并亲自执行。

## 1. 本轮实际执行的改动（Lead 亲自，8 个代码/测试文件）

| # | 项 | 来源 | 严重度 | 改动 | 验证 |
| --- | --- | --- | --- | --- | --- |
| 1 | **`ws.register` disposer 契约** | Lead 独立查 `/opt/dsh-0222` + G1 预警 | **P1（E→定案）** | `dsh-host-webserver/lib/index.js:375` 明写 `@returns the disposer`，`dsh-client-connection:871,1058` 用 `ctx.effect`，AGENTS.md「Registrations are effects」。3 个 `registerXxxRoutes` 改为返回 disposer 数组（过滤非函数兼容 fixture），`index.js` 用 `webCtx.effect(..., "unified-search: web routes")` 包一层 | 行为级测试：4 个 disposer 真删路由；重启后 3 条 API 路由 200 |
| 2 | **D3 `⏸cooled` 无秒数且状态过期** | V3 §7 / G1 | P2 | `provider.js` 遥测改用扇出时刻 `nowMs`（不再 `Date.now()` 二次判断），且注记为空时**不输出**该后端 | 断言 24s 注记、过期返空、无裸串兜底 |
| 3 | **D8 health/history 缺字段** | V3 §7 / G1 | P2 | `health` 顶层 `requestedMaxResults`、每后端 `rateLimited`/`keylessRejected`/`cooledUntilMs`；`history.toBackendObservability` 追加同 3 字段；**全追加不改名** | 运行态实证：`requestedMaxResults=8`、firecrawl 三字段有值、history 6 条目新键齐、旧键全保留、无凭证泄漏 |
| 4 | **D6 陈旧 rev + 非法值 400 误导** | V3 §3 / G2 | P3 | 初版只在 validateOp 失败时映射 409（G2 正确指出不完整）⇒ 改为**校验前统一比 revision**，陈旧一律 409，mutate CAS 仍兜 TOCTOU | 4 条断言：陈旧+bad / 陈旧+good → 409、当前+非法 → 400、mutate 不被调用 |
| 5 | **新 P1 `void write(...)`** | G2 早期预警 | **P1** | `guarded()` 的 Promise catch 接不到被 `void` 丢弃的 async 异常 → 无响应 + unhandledRejection。改 `return write(...)` | 断言：mutate 抛错时 `writableEnded===true` 且 ≥400 |
| 6 | **D7 等值写不递增 revision** | G2 裁决 | 设计如此 | 不改 mutate 行为（避破 CAS 契约）；在 `describe()` JSDoc 明确「revision 计值变更、非写请求」 | 文档化，原 12 条 fixture 全绿 |
| 7 | **D5 共享状态污染** | G2 裁决 | 产品语义 | 不修代码（`history` 跨进程持久 + `health` 进程内 Map 天然无统一隔离边界）；登记 Known Limitation：运行态结论必须绑定时间窗 + 会话 | 68/70/72 号注明 |
| 8 | **§6 回滚链前提（第三次 runtime 切换）** | G3 两次中期简报 + Lead 核实 | 文档 P1 | 25 §6 三条前提全部回改：cmdline 双版本（11-09 exp022 `--patch` / 11-11 21:26 `/opt/dsh-0222` 无 `--patch`）、全系统只一套 `$P`、launcher 被重写两次；4b 注释、可选步、证据等级表 11:14 版本同步 | 只读模拟：23 cp 全有 orig、12 rm 全在、drop-in 在位、schemastery 透传 ⇒ §6 仍可执行 |

## 2. 复审（重启后真实运行态）

服务 active **PID 170703**（11-11 23:06:40 重启，runtime `/opt/dsh-0222`），三 env 保持，ssh 通道 SSH_OK、GUI 401→认证 200。

| 项 | 结果 |
| --- | --- |
| `web_fetch` | **HTTP 200** + 正文 |
| `web_search` | **8 条 Sources**；`exa ✓1870ms/8 · parallel ✓2458ms/8 · ddg ✓2855ms/8 · tinyfish ✓4978ms/8` 四后端全成功；searxng 反爬、firecrawl 匿名额度属预期降级 |
| 认证 API | `settings ok:true ns:dsh-websearch rev:0 numResults:8`；`health enabled:6 requestedMaxResults:8`，firecrawl `rateLimited=true / keylessRejected=true / cooledUntilMs=1794431612599`；`history` 6 后端条目带齐 `cooledUntilMs/rateLimited/keylessRejected` |
| 路由注册 | settings / health / history 三条 API 全 200 ⇒ `webCtx.effect` 注册未丢路由 |
| 启动日志 | 唯一 `1 entry did not activate`（dsh-purge-community 缺 yaml，无关）；无 `without inject`/`remote.credentials`/unhandledRejection |
| 全量单测 | **73/73 通过**（8 个测试文件；本轮 +7 条断言） |
| 语法 | 33/33 JS `node --check` |
| 逐字节一致 | **35/35 文件** |
| 备份 | 26 个 `*.orig` |
| 报告库 | 76 份 md，0 密钥值命中 |

## 3. 目标 conclusion（第 1 轮）

**objective 的三项要件本轮全部达成**：① D3/D8/D6 已修、D7 文档化、D5 明确裁决、`ws.register` disposer 从 E 定案并修（P1）；② 第三次 runtime 切换对 §6 前提的影响已核实并全部回改，§6 在新 runtime 下仍可执行；③ 改 src-work → 补 7 条断言 → 73/73 单测 → 35 文件同步 → 重启 → 真实工具/API 复跑并再审一轮，全绿。

**无未修 P0/P1。** 剩余 P2/P3 观察项：V3 的 D3 已修，D4 已修（上轮），D5 登记，D6/D7 已处置，D8 已修；仅剩 `cooledAnnotation` 跨窗口诊断的 GUI 呈现、真 429 的 `Retry-After` 原始响应头、真并发双写 TOCTOU 等 E 级验证。

**需用户决定（非 bug）**：真 HMR/插件卸载触发 disposer 的实测（无浏览器控制）、patch-package 落地、对外 PR（须补 G5 完整 35 文件 diff）、升级 0.2.2-rc.1、`ws.register` 之外的产品语义（D5 按 session 隔离若要做需重做持久化契约）。

## 4. 交付

- [69 号 G1](69-goal-observability.md) / [70 号 G2](70-goal-state-semantics.md) / [71 号 G3](71-goal-runtime-switch.md)
- [25 §6 回滚链](25-execution-log.md) / [68 号评估验证汇总](68-assessment-synthesis-SKELETON.md) / [REPORT.md](REPORT.md)

---
无凭证值写入本文件；所有结论可由文中命令与运行态输出复现。
