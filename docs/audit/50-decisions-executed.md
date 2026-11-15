# 50 · 专家组决断与执行结果（2026-11-08）

> 用户「开展专家组决断继续执行」。3 个决断组（task-24~26）对上一轮 9 条「需用户决定」项做 go/no-go/条件-go 裁决，Lead 按决断执行采纳项。
> 基线 `.baseline-20261108-0922/`；决断全文：`46-decision-behavior.md`(509) / `47-decision-norms.md`(541) / `48-decision-upstream.md`(283)；重启实证 `49-restart-evidence.md`。

## 1. 前提：服务重启已解除

11-08 12:40:47 服务重启为 PID 2334（ssh/ova 通道恢复），17:08 运行态实证 `web_fetch` 200、`web_search` 8 Sources、`health keyless:6`、`settings namespace: dsh-websearch`、GUI 200 ⇒ 上一轮 17 文件改进**真正生效**。见 [49 号](49-restart-evidence.md)。

## 2. 九项决断汇总

| # | 事项 | 组 | 结论 | 依据摘要 |
| --- | --- | --- | --- | --- |
| 1 | M-1 exa/parallel/firecrawl `skipInitialize` | A | **条件-go**（前置验收后已 go） | 官方 v2.2.6 `mcp.ts` 只发单个 `tools/call`（id:1、无 initialize）；实测裸调用 exa/parallel 200、延迟 10.6→3.5s / 8.6→5.6s |
| 2 | M-3 keyed tinyfish `forceFreshSession` | A | **GO** | fake MCP 复现换 key 复用 SID-1；修后 2 次 initialize + SID-1/SID-2，keyless 字节级不变 |
| 3 | 429 熔断语义 | A | **条件-go 拆 3a/3b** | 3a 分类器命中真实串（`HTTP 429`/`Anonymo`）；发现 41 号 diff 缺口（cooled 表未存 rateLimited 致快速失败死代码）；3b 改模型可见文本需用户批准 |
| 4 | readErrors UI 提示 | A | **条件-go** | 41 号原 diff 会把 25/25 打成 24/25（删 readFailed 破 4 条断言）；给保留变量名的兼容版 |
| 5 | patch-package 落地 | C | **条件-go，需用户授权** | 当前 profile 精确 pin 2.8.4 + 重启后全绿 = 零动作稳态；新增依赖改已验证路径 |
| 6 | 对外提交 PR | C | **条件-go，本轮不提交，需用户授权** | 上游复核与 11-07 一致（Issue#8 open、PR#7 open/0 review、npm 2.8.8 无 2.8.9）；**44 号四组 diff 只覆盖 10/23 文件**，须补 G5 完整 diff |
| 7 | settings-api 6 组 fixture | B | **GO** | 真实 `registerSettingsRoutes` + fake Host inline 实跑 12 断言全绿 |
| 8 | 上游既有中文 description 全量英文化 | B | **NO-GO** → 登记 Known Limitation | 2.8.8 上游仍有 **39 条中文 description + 11 个中文 label**，中文是上游风格；改 49 处毁掉补丁重放能力、gate 零覆盖无收益 |
| 9 | 升级 `@deepseek-ai/dsh` 0.2.2-rc.1 | B | **NO-GO 当前 / 条件-go 未来** | Node v22.20.0 < engines ≥24.9.0；0.2.2-alpha.2 三个 breaking guide；2.8.8 仍缺 3 修复 |

## 3. 已执行（Lead 亲自改 `src-work` → 验证 → 同步 → 重启 → 实跑）

| 项 | 改动 | 验收 |
| --- | --- | --- |
| **M-3 GO** | `mcp-client.js`：`ensureSession(url, signal, options)` 加 `forceFreshSession` 绕过缓存；`mcpCall` 透传；JSDoc 同步。`tinyfish.js`：`{ skipInitialize: !keyed, forceFreshSession: keyed }` | 43/43 单测、测试锚点保住、keyless 零回归 |
| **M-1 条件-go** | `exa.js`/`parallel.js`/`firecrawl.js` 加 `skipInitialize:true`；`mcp-client.js` 的 `callBody.id` 改为 `options.skipInitialize ? 1 : 2`（**比 46 号更保守**：sessionful 路径保留 id:2，避免与 initialize 同 id）；JSDoc 补 stateless 端点列表 | **前置验收通过**：17:28 重启后真实 `web_search` 中 `exa ✓3137ms/8`（原 8285ms）、`parallel ✓4858ms/8`（原 11309ms）、`tinyfish ✓4832ms/8` 仍全成功；`web_fetch` 200 |
| **settings-api fixture GO** | 落盘 `tests/settings-api.test.js`（47 号给的 12 条断言） | 独立实跑 **12/12** |
| **readErrors 兼容版（只读诊断）** | `client.js` 加 `readErrors` Map + projection 字段 + 固定码 `credential/read-failed`（复用 `safeFailureReason` 脱敏）+ 成功时清除；**保留 `readFailed` 变量名**保住 4 条锚点；`catch` 不再全静默、`finally` 保证 republish。**未加 UI 文案/i18n key**（产品可见变更留给用户） | 40/40 → 43/43，4 条 `readFailed` 锚点全在 |
| **429 3a（纯内部）** | 新增 `lib/util/failure-label.js`（`rateLimited`/`retryAfterMsFrom`，后者 60s 兜底）；`breaker.js` 的 `foldBreaker` 加可选 `opts`，1 次 429 立即冷却；`provider.js` 的 `recordBackendHealth` 透传并**把 `rateLimited` 存进 health entry**（修 41 号 R2 死代码缺口）。**未碰 fail-open 分支 / 模型可见文本**（3b 留给用户） | 新增 `tests/lead-20261108-quota.test.js`：分类器真实串、60s 兜底、1 次 429 冷却、非 429 仍 3 次、默认 opts 零回归；**43/43** |
| **NO-GO 项处置** | 中文 description 全量英文化 → 登记 Known Limitation（见 §5）；升级 0.2.2-rc.1 → 标记硬阻塞；patch-package / 对外 PR → 不执行 | 决断全文记录理由 |

## 4. 终局验证（真实输出）

| 项 | 结果 |
| --- | --- |
| 全量单测 | **43/43 通过**（`node --test tests/*.test.js`） |
| 全部 JS 语法 | **32/32 `node --check` OK** |
| 逐字节一致 | **23/23 文件** `src-work` ↔ 安装目录 md5 MATCH（13 修改 + 10 新增） |
| 备份 | **16 个 `*.orig`**（本轮新增 `breaker.js.orig`） |
| 服务重启 | 18:34:33，PID 587384，`ActiveState=active`，3 个 env 保持 |
| 真实工具 | `web_fetch` **HTTP 200**；`web_search` **8 条 Sources**（`exa ✓/8 · tinyfish ✓/8 · parallel ✓/8`；firecrawl 额度、ddg/searxng 出口抖动属预期降级） |
| GUI / API | 认证后 200 / 200 |
| 报告库 | **50 份 md / 18028 行**，密钥扫描 **0 命中** |

## 5. 未执行 / 需用户最终决定（决断为条件-go 或 no-go）

| # | 事项 | 决断 | 说明 |
| --- | --- | --- | --- |
| 1 | **429 3b**（全配额冷却快速失败） | 条件-go，需批准 | 改执行语义 + 模型可见错误文本；且 `Retry-After` 实际取不到、只能 60s 兜底，不得宣称对齐官方 |
| 2 | **readErrors UI 文案** | 条件-go，需批准 | 本轮只做了内部只读诊断状态，未加 `keyReadFailed` 双语 key 与 UI 提示行 |
| 3 | **patch-package 落地** | 条件-go，需授权 | 会新增依赖 + postinstall + 改 lockfile；48 号给 23 文件修订版命令 + 零依赖备选（`file:` overlay） |
| 4 | **对外提交 PR** | 条件-go，需授权 | 48 号关键发现：**44 号 G1–G4 只覆盖 10/23 文件**，须先补 **G5 完整 23 文件 diff** 再提交；G2 仍只作 PR#7 comment；两段 ≤10 行可粘贴文本已给 |
| 5 | **升级 0.2.2-rc.1** | NO-GO 当前 | 先升 Node≥24.9.0 + 读 breaking guides + 重放 23 文件补丁；G1–G7 门禁在 47 号 |
| 6 | **中文 description 全量英文化** | NO-GO | 登记 Known Limitation：中文是 2.8.8 上游风格（39+11 处），全改会毁补丁重放且 gate 零覆盖；本轮新增的 2 label + 4 description 已为英文 |

## 6. 组织收口

- task-24/25/26 由 Lead 代 claim→complete；3 位决断专家 + 其余 6 位 teammate 全部 inactive、无后台作业。
- 46/47/48 三份决断报告 + 49 号重启实证 + 本文件齐备；45 号裁决表已更新「重启已解除」与 9 项→3 组映射。
- 文档数字统一：**23 文件 / 16 备份 / 43 单测 / 50 份 md**（修正 48 号指出的「10 文件」文档债）。

---
无凭证值写入本文件。
