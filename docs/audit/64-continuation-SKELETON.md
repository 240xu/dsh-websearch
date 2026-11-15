# 64 · 目标模式第 2/3 轮续研裁决汇总（终版）

> 2026-11-09 13:30 用户「子代理我让他们继续了」→ 5 组深水区续研（59–63 号）；11-09 20:17 **DSH runtime 切换到 exp022 / node24**（服务 PID 3396816 → 1574785），R1/R2/R3/R4/R5 第二轮报告带来新指控。
> Lead 逐条独立复核 → 裁决 → 亲自改 `src-work` → 补测试 → 35 文件同步 → 重启 → 真实工具复跑。
> 基线（11-10 21:35 实测）：服务 active PID 1574785（19:44:55 启动）、`DSH_HOME=/home/dsh/.dsh`、三个 env 保持、`web_fetch` 200 / `web_search` 8 Sources 四后端全 ✓、64/64 单测、35/35 文件一致、26 备份、68 份 md / 22376 行、0 密钥命中。

## 1. 五份续研报告（含第二轮追加）

| 组 | 报告 | 行数 | 最关键产出 |
| --- | --- | --- | --- |
| R1 错误契约 | `59-review-error-contract.md` | 287 | 11 处 helper 实参逐个核实；**P0-1 ddg.js 二次包装丢结构化错误**、P1-1 403 误判 QUOTA、P1-3 Retry-After 无上限 |
| R2 网络深水 | `60-review-network.md` | 完整 | SSE 9 组边界；**P0-1 collect() 无 try/catch → 进程 exit**；id 串包/redirect/sessionCache 等 P1 |
| R3 配置/UI | `61-review-config-ui.md` | 完整 | **D2（最重）save() 快照写在 await 之后 → 用户中途编辑被静默丢弃 + 假绿**；D1 ApiKeyEnv pattern 过严 |
| R4 测试/回滚 | `62-review-tests-rollback.md` | 425 | **H-1 P0：§6 的 `pgrep -f 'dsh web --patch'` 在新 cmdline 下必失效**；H-2 第二套 profile；launcher 漏项；4 条假绿断言；过时数字 |
| R5 运行时 | `63-review-runtime.md` | 407 | **取证设计修正：numResults 8→9 在 min(hostCap=8,userMax=9) 下不可观测，8→3 才证修复**；55 号两 P1 已修；熔断/缓存/fence 全通过；运行时 P0 无 |

## 2. 全量裁决与执行（本轮实际改代码 6 组）

| # | 缺陷 | 来源 | 严重度 | Lead 裁决 | 执行 |
| --- | --- | --- | --- | --- | --- |
| 1 | `save()` 的 `savedFieldRefs.set` 在 `await scope.set/unset` **之后**，捕获的是用户中途新编辑 → 删除新编辑、数据丢失、假「已保存」 | R3 D2 | **P0** | **成立**（逐行核实 471/475/481/496/499/508/518 全在 await 后） | ✅ 改为**循环开头、await 之前**用循环变量 `staged` 快照，每循环只 1 处；删掉 7 处错误写法；新增 `save() snapshots staged entries before awaiting` 断言 |
| 2 | `egress-fetch.js collect()` 在 `res.on("end")` 里同步 `new Response()` 无 try/catch；非法 status/头名抛异常时 `reject` 接不到 → 进程 exit=1 | R2 P0-1 | **P0** | **成立**（`resolve(new Response(...))` 参数求值在 resolve 前抛，事件回调内为未捕获异常） | ✅ `try { resolve(new Response(...)) } catch (err) { reject(err) }`；新增源码级守卫断言 |
| 3 | `ddg.js` 把 `webErrorFromResponse` 抛的结构化 WebError 二次包成 `WEB_PROVIDER_ERROR` → status/code/rateLimited 全丢，402/403 QUOTA 分类失效 | R1 P0-1 | **P0** | **成立**（读 ddg.js:50-64 确认） | ✅ `if (err instanceof WebError) throw err;` 后于通用包装；新增断言 |
| 4 | `web-error.js` 把 **403 无条件算 QUOTA**（key 失效也是 403）→ 错误冷却 60s | R1 P1-1 | P1 | **成立** | ✅ 仅 `402` 算 QUOTA，403 回落 `WEB_PROVIDER_ERROR`；新增断言 |
| 5 | `retryAfterMsFrom` 无上限：`Retry-After: 999999999` → 冷却 11574 天 | R1 P1-3 | P1 | **成立**（实测） | ✅ 加 `MAX_RETRY_AFTER_MS=24h` 上限 + 统一 `DEFAULT=60s`，超限回落；新增断言 |
| 6 | `ApiKeyEnv` pattern `/^[A-Z][A-Z0-9_]*$/` 比官方 `credentialRef` 的 `/^[A-Za-z_][A-Za-z0-9_]*$/` 严 → 拒掉 `lower`/`_private` 合法引用 | R3 D1 | P1 | **成立**（官方 `credentialRef` 实测） | ✅ 10 处统一改官方 grammar；`credentialRef` 交叉断言 4 合法 + 4 非法 |
| 7 | `retryAfterMsFrom` 对过去 HTTP-date 返回 0 窗口 | R1（第 1 轮） | P2 | **成立** | ✅ 已修（第 2 轮），本轮加 cap 一并强化 |
| 8 | `parseEnvelope` BOM 使 SSE 首行 `data:` 被过滤 → 整次解析失败 | R2 第 1 轮 | P2 | **成立** | ✅ 剥离 `\uFEFF`；`sse.test.js` 9 组边界断言 |
| 9 | **过度修法自我纠偏**：给 plain-JSON 加强 id 校验 → 误杀 skipInitialize 路径（`callBody.id=1` vs 服务回显 `id=2`），2 条 P0 行为级测试立即挂 | Lead 复核 | — | **撤回** | ✅ plain JSON 恢复容错，id 匹配只用于 SSE 多帧；64/64 证明 |
| 10 | **25 §6 回滚链 P0**：`pgrep -f 'dsh web --patch'` 在新 cmdline（`bin.js web --patch`）下只匹配验证者自己的 shell → environ 验证假绿/假红 | R4 H-1 | **P0** | **成立**（实测 `pgrep` 输出不含真实 MainPID 3396816） | ✅ 改用 `SVC_PID=$(systemctl show -p MainPID --value dsh-web.service)`；§6 加运行时前提声明（exp022 runtime / 第二套 profile / DSH_HOME） |
| 11 | §6 漏 `dsh-web-run-native.sh`（11-09 20:17 外部 runtime 切换）+ 旧版 10 文件 §6 重复粘贴残片 | R4 H-3 / 首轮 | P1 | **部分成立** | ✅ 判定 launcher 属**外部 runtime 切换、不属 websearch 链**，默认不回滚；加「可选：连 runtime 一起回退」步（明确风险）；删除 175–181 行重复残片 |
| 12 | 4 条假绿断言：2 条断言本轮新增**注释文本**（自指）、2 条 `doesNotMatch` 打 `.orig`（恒真）、`interaction.test.js` 全静态 | R4 | P2 | **成立，但当时修法不完整**〔V2 第二轮 11-11 复核更正〕 | ⚠️ 当时「改为 `doneKeys.push` / `cooled.clear()` 分支」中，`doneKeys.push` 在 `client.js.orig` 已存在（基线恒真）、`cooled.clear()` 分支仍断言本轮新写注释 ⇒ **两条仍是假绿**。本轮新增的 3 条断言里**仅 `retryAfterMsFrom caps...` 为真行为级**，save 快照与 ddg 透传仍是 `readFileSync`+正则。已于 11-11 18:45 再修（详见 66/68 号），「3 条真行为级」表述作废 |
| 13 | 过时数字：README 6/12「eleven/十一」、99:3「17 份报告」、58/56「34 文件 11 rm」、25 §15「429 3b 未执行」 | R4 | P2 | **成立** | ✅ 全部回改（README→十三/thirteen、99 动态口径、58/56→35 文件 12 rm、25 §15 加「已于 11-09 执行」注） |
| 14 | **R2 的 P1-1/1-2（SSE/plain-JSON id 串包）** | R2 | — | **不采纳（标 E）** | 与第 9 项冲突：真实 HTTP 一请求一响应不会收到"别人的 id=7"；skipInitialize 路径不发 initialize 故流里无 serverInfo 帧。强加校验会重演误杀。已在 60/64 号记录裁决理由 |

## 3. 终局验证（11-10 21:35，重启后）

| 项 | 结果 |
| --- | --- |
| 服务 | active PID 1574785（19:44:55），`DSH_HOME=/home/dsh/.dsh`，三 env 保持；ssh/ova 通道 SSH_OK |
| `web_fetch` | **HTTP 200** + 正文 |
| `web_search` | **8 条 Sources**；`exa ✓5221ms/8 · tinyfish ✓6701ms/8 · parallel ✓7376ms/8 · ddg ✓7388ms/8` 四后端全成功；firecrawl 匿名额度、searxng 反爬页属预期降级 |
| 全量单测 | **64/64 通过**（8 个测试文件；本轮新增 4 条断言） |
| 语法 | **33/33 JS** `node --check`（src-work 与安装副本均过） |
| 逐字节一致 | **35/35 文件** `src-work` ↔ 安装副本 |
| 备份 | **26 个 `*.orig`**；§6 为 35 文件（23 cp + 12 rm）唯一可执行链 |
| 报告库 | 68 份 md / 22376 行，密钥扫描 **0 命中** |

## 4. 目标结论

**目标 objective 的全部要件已达成，无未修 P0/P1**：
- 分模块全量审计（6 组 × 双轨）、逐条可复现证据、Lead 统一裁决、亲自改 `src-work`、补行为级测试、35 文件逐字节同步、重启、真实工具复跑并**连续 3 轮再审**；
- 429 两件遗留（Retry-After 响应头透传 + 全配额冷却快速失败）均已落地，且有 `3b-runtime.test.js` 真 provider 行为级实证；
- 本轮又修掉 3 个 P0（save 数据丢失、collect 进程崩溃、ddg 结构化错误丢失）+ 3 个 P1 + 若干 P2，并**主动撤回 1 个会误杀 stateless MCP 的过度修法**；
- 所有改动有注释、有备份、可回滚（25 §6）、有测试、可追溯（59–64 号）。

**仍需用户决定（非 bug，不阻塞收口）**：`ws.register` disposer 契约确认、`isComplexQuery` 查询语义、`sanitizeError` 加固、`/tmp` 会话 JWT 清理、patch-package 落地、对外 PR（须补 G5 完整 35 文件 diff）、升级 0.2.2-rc.1、3b 混合故障细策略（59 号 B-2，改执行语义）、R2 的 redirect/sessionCache/extraHeaders 潜伏 P1（当前调用点全 `redirect:"error"`/`forceFreshSession:keyed`，不可达，标 E 观察）。

---
无凭证值写入本文件；所有结论可由文中命令复现。
