# 45 · Bug 与官方化行为规范小组 · Lead 裁决表（骨架）

> 2026-11-07 21:16 改制后，5 个任务（task-19~23）分派；本表在提案回收期间边等边填。
> 改制详见 [25 §13](25-execution-log.md)；基线 `.baseline-20261107-2116/`；当前 18/18 单测、10 文件逐字节一致、服务 active PID=347337。

## 待回收提案

| 任务 | 成员 | 产出 | 状态 |
| --- | --- | --- | --- |
| task-19 | runtime-state | `40-bug-interaction.md` | **已落盘 289 行**（22:55） |
| task-20 | search-backends | `41-bug-codehealth.md` | **已落盘 589 行** |
| task-22 | dsh-docs | `43-officialize-norms.md` | **已落盘 465 行** |
| task-23 | own-repo | `44-officialize-upstream.md` | **已落盘 678 行** |
| （补） | 挖掘 fork | `35-deep-dig.md` 主版 | **已落盘 234 行**（索引 + 全文，原 `-b` 保留） |

## 裁决原则（先提案、后执行）

1. 每条提案先判「成立 / 不成立 / 需用户决定」，给 A/B/C/D/E + 可复现命令。
2. 与 30–35 号已裁决「确认无误」冲突的，以 99/24 + 更强一手实证为准，并说明。
3. **采纳项**由 Lead 亲自改 `src-work` → 补测试 → 全量单测 → 逐字节同步 → 重启 → 真实 `web_fetch`/`web_search` 复跑。
4. 属**产品行为**（删死导出、改 UI 文案语义、改启动语义）或**上游策略**（提 PR、升级）的，不擅自执行，列入需用户决定。
5. 所有改动必须兼容现有 18 个测试 + 10 文件一致性；新增测试与源码同批同步。

## 已预判的 4 条（local-impl 只读核对，归并去向）

| 条目 | 归并 | 预判 |
| --- | --- | --- |
| `DSH_UNIFIED_SEARCH_BACKENDS` 被 4 个 `.default(true)` toggle 遮蔽 | task-22（README 失真）/ 37 F-7 | 真实偏差但非当前故障；改 env 优先级属行为改动 → **需用户决定** |
| `config.fetchProvider.get() ?? env` 的 config 遮蔽陷阱 | task-23（升级门禁）/ 37 F-6 | 当前不影响；只出「未来改动前必读」验收条款 → **文档级采纳** |
| `QUERY_GUIDANCE_*` / `isTrustedApiRequest` / `resultHeader` 死代码 | task-22 | 删除属产品行为；且 `isTrustedApiRequest` 是遗留 fence（实际用 `rejectionFor`）→ **需用户决定** |
| 升级 2.8.8 反覆盖本地自修 | task-23 | 已确认（35/37 F-11）→ **不升级**；采纳「不升级也持久化补丁」方案需用户决定是否落地 |

## 已回收的补充证据（待命成员零写作用域简报）

| 来源 | 结论 | Lead 核对 | 归并 |
| --- | --- | --- | --- |
| `protocol-standards`（撤回 33-b §4 第 1 条） | 「`findNamespace` 兜底改成 `ns === "unified-search"`」是**错误建议**：真实 ns = `entry.options.id` = `dsh-websearch`（`dsh-settings/lib/index.js:432,443` + `cordis.patch.yml` insert id）；改成 unified-search 正是 PR#7 的死代码毛病。结构性结论「形状优先 → 应改 ns 精确优先」仍成立，`index.js` 已修、`settings-api.js` 仍形状优先 | ✅ 逐行核实；与 37 号 C-6 / 33 主版一致 | task-20（两套发现规则收敛） |
| `protocol-standards`（补强） | 官方同类插件 `dsh-client-ui-settings-web-search/lib/client.js:482-488` inject = **5 项** `["slots","locale","remote","remote.credentials","configForms"]`；`:348-350` `describe([ref])` + `response.value[ref]` **一层解包**；`:507` 只订阅 `credentials/reference-updated` | ✅ 逐行核实 | task-21 / task-22：我们 `connection` 多余、`configForms` 未用可接受；三层解包冗余但无害，可简化为官方一层（**代码改动，待裁决**） |
| `protocol-standards` | rc.2 = rc.5 = 0.2.2-rc.1 凭证/settings Remote 契约逐字相同（npm pack 六包×三版）；`MAX_DESCRIBE_REFS=64` | 与 33/37 一致 | task-23 升级门禁 |
| `local-impl` | 本轮无独立任务、零写操作；4 条只读观察已收编 | ✅ 已明确回复选 (B) | 见上表 |

**即时的官方化候选（无需等提案即可预判）**：
1. `client.js` 的 `readCredential` 三层解包 → 官方一层 `response.value[ref]`（但会失去对旧 host `{credentials:...}` 形状的兼容，属行为改动 → **需用户决定**）；
2. `inject` 去掉多余的 `connection`（33 号 node 实证不声明仍可用）—— 但 `connection` 被 `selectBridge` 的 legacy 路径使用，去掉前需确认 → **待 task-21/22 提案**；
3. 事件订阅：去掉无效 `credentials/updated`、补 `connection/reset` / `record-updated`（33 号 S4）→ **待 task-22**。

## 已回收提案的预判裁决（待 5 份齐后最终确认）

### 40-bug-interaction.md（289 行，task-19）

| # | 缺陷 | 优先级 | 裁决 | 处置 |
| --- | --- | --- | --- | --- |
| D1 | 空白 stagedKey 永不消费（Save 常亮、零反馈） | P1 | **成立**（D 级行为复现，三次 save 后 stagedCount 恒 1） | 采纳：`editKey` 空串即 `delete` + `save()` 兜底 `doneKeys` |
| D2 | 并发 setToggle 同读 revision=0 → 第 2 个自造 409、写入丢失 | P1 | **成立**（D 级） | 采纳：bridge 加 `writeQueue` 串行化，revision 在队列轮到时才读 |
| D3 | setToggle 失败不重读真值 → UI 与 host 分叉（rev 0 vs 1） | P1 | **成立**（D 级） | 采纳：失败后 `await scope.load()` 重读（比本地回滚诚实） |
| D4 | `failure.reason` 原样渲染（含 `/home/dsh/.dsh/.credentials.yaml` 与引用名） | P2 | **成立**（D 级） | 采纳：`safeFailureReason` 只保留合规 code |
| §5 | `setToggle` 的 `catch {}` 静默吞异常 | P2 | **成立**（Lead 点名） | 并入 D3 的 catch：只 `console.warn` 布尔 conflict，不输出 message |

**Lead 复核**：4 条全部针对 `lib/client.js` 一个文件、不改状态模型、不需重启（客户端 bundle 走既有刷新）；报告给 14 条新断言（期望 32/32），并已核对现有 18 条测试的源码级正则锚点不在 diff 改动范围内（A 级）。⇒ **倾向全采纳**，等其余 4 份齐后统一执行。

### 42-officialize-contract.md（332 行，task-21）

| # | 提案 | 档 | 裁决 |
| --- | --- | --- | --- |
| 路径订正 | v2.2.6 websearch 在 `packages/core/src/plugin/websearch/`（8 文件，新增 `provider.ts`），**不是** `packages/opencode/src/tool/websearch/`（404） | A | **采纳**，修正 09b/35 号旧口径 |
| 真正新特性 | CHANGELOG:23 的 `websearch.use` **policy action**（resource=provider ID、allow/deny），与 `permission action=websearch`（resource=query、有 ask）是两套 | A | 采纳为「保持差异」依据：DSH 宿主层权限归宿主 |
| M-1 | exa/parallel/firecrawl 传 `skipInitialize:true`（官方只发 tools/call；我们三步串行 ~16s 拖尾） | 必须对齐 | **倾向采纳**：`skipInitialize` 已在 tinyfish 验证可用、不动 body/解析/重试；但**改变网络行为**，需真实 `web_search` 复跑确认 exa/parallel 仍成功 |
| M-2 | firecrawl `limit` 改硬编码 8（官方 `firecrawl.ts:52`），避免放大 keyless 配额 | 必须对齐 | 倾向采纳（本地 `maxResults` 截断保留） |
| M-3 | keyed tinyfish 每次重新 initialize 取新 Session-Id（现在 10min URL 缓存换 key 会复用旧 Id） | 必须对齐 | **需用户决定**：涉及 `mcp-client.js` 新增 `forceFreshSession` 参数，属协议层改动 |
| 保持差异 | 扇出+RRF、择一模型产物、breaker fail-open、`websearch:false`、app dock、权限归宿主 | — | 采纳「不硬搬」 |
| 顺手发现 | `parallel.js:60-85` 重复 isError 死代码、新 backend 注释仍指 v2.2.5 | P3 | 并入 task-22 死代码清理 |

**Lead 复核**：本机 3 个调用点确为 0 处 `skipInitialize`、`tinyfish.js` 有 2 处（keyless skip / keyed 握手），与 42 号论证一致（A 级）。35 号「v2.2.6 仍 5 provider、schema 未变、Brave/Nimble 未合并」被独立复核 ⇒ **不并入新 provider**。

## 全量裁决表（2026-11-07 23:2x，5 份提案 + 35 号补齐）

### A. Bug 组（40 / 41）

| 来源 | 缺陷 | 严重度 | 裁决 | 处置 |
| --- | --- | --- | --- | --- |
| 40 D1 | 空白 stagedKey 永不消费 | P1 | **成立**（D 级复现） | ✅ **执行**：`editKey` 空串 delete + `save()` 兜底 |
| 40 D2 | 并发 toggle 自造 409、写入丢失 | P1 | **成立**（D 级） | ✅ **执行**：bridge 写队列串行化 |
| 40 D3 | setToggle 失败不重读 → UI/host 分叉 | P1 | **成立**（D 级） | ✅ **执行**：失败后 `scope.load()` 重读 |
| 40 D4 | `failure.reason` 原样含内部路径 | P2 | **成立**（D 级） | ✅ **执行**：`safeFailureReason` 脱敏 |
| 40 §5 | `setToggle` catch 静默吞异常 | P2 | **成立** | ✅ **执行**：并入 D3，只 warn 布尔 |
| 41 点1 | settings-api `validateOp`/`MAX_OPS`/`expectedRevision` 零单测 | P1(测试债) | **成立**（A 级） | ✅ **执行**：补 6 组 fixture |
| 41 点2 | `findNamespace` shape-first 用通用名 → **跨 ns 误写**；与 `current()` 两套规则 | **P0** | **成立**（Lead 独立复现 `OTHER-PLUGIN` 被选中） | ✅ **执行**：抽 `util/namespace.js` 单一 `findPluginRow`（ns 精确 → ≥2 专属字段兜底），两处共用 |
| 41 点3 | `readCredential` 空 catch + `readFailed` 全静默 | P1 | **成立**（A 级） | ⚠️ **需用户决定**：新增 `readErrors` Map + 新 i18n key + UI 提示行属产品可见行为 |
| 41 点4 | 熔断 fail-open 对 429 无效、持续烧配额 | P1 | **成立**（A/D 级） | ⚠️ **需用户决定**：改 429 冷却/快速失败属执行语义变更，且 42 号 M-1 也会动 initialize，建议同批 |
| 41 点5 | `health.keyless` 把免 Key 计量后端报成需 Key | P2 | **成立**（A 级） | ✅ **执行**：`OPTIONAL_KEY_IDS` 排除 + 增列 |
| 35 新P1 | `cacheKeyFor()` 不含 `safeSearch`/`rerank`/`dedupStrategy`/`*BaseURL` → 改设置 900s 内吃旧结果 | P1 | **成立**（Lead 独立复现 `SAME? true`） | ✅ **执行**：结果决定项纳入 canonical key |

### B. 官方化组（42 / 43 / 44）

| 来源 | 提案 | 档 | 裁决 |
| --- | --- | --- | --- |
| 42 路径 | v2.2.6 在 `packages/core/src/plugin/websearch/`；新特性是 `websearch.use` policy | A | ✅ **采纳**：订正 09b/35 旧口径 |
| 42 M-1 | exa/parallel/firecrawl 加 `skipInitialize:true` | 必须对齐 | ⚠️ **需用户决定**：改变网络行为，需真实复跑 |
| 42 M-2 | firecrawl `limit` 硬编码 8 | 必须对齐 | ✅ **执行**（低风险，本地截断保留） |
| 42 M-3 | keyed tinyfish `forceFreshSession` | 必须对齐 | ⚠️ **需用户决定**：协议层新参数 |
| 42 保持差异 | 扇出+RRF / 择一 / fail-open / 权限归宿主 | — | ✅ **采纳「不硬搬」** |
| 43 i18n | 6 个 `Config.description` 中文混排；gate 是**假阴性**（只扫仓库内 .tsx） | 必须改 | ✅ **执行**：改中性英文（只改字符串，零风险） |
| 43 死代码 | `resultHeader` 恒真判据删但函数留（删函数触发 snapshot）；`isTrustedApiRequest` 0 调用；`QUERY_GUIDANCE_*`/6 死键是上游既有 | 必须/建议 | ✅ **部分执行**：删 `resultHeader` 恒真判据 + 删 `isTrustedApiRequest`；**保留** `QUERY_GUIDANCE_*` 与死键（上游既有、公开 export，删除属产品行为） |
| 43 注释 | 约 24 处含 review/P0/P1/issue/PR/WBS 叙事违反 AGENTS.md「不叙述审查过程」 | 必须改 | ✅ **执行**：按 21 行对照表改写，保留契约与失败模式、去审查编号与日期 |
| 43 README | `:116`「强制指定」失真（4 个 `.default(true)` 遮蔽 env） | 建议改 | ✅ **执行**：只改文档 + 补 `index.js:319` 注释；改优先级留 E |
| 44 PR diff | 10 补丁对 2.8.8 `patch --dry-run -p1` **5/5 CLEAN-APPLY**；冲突只在 PR#7 head | A/D | ✅ **采纳为交付物**：四组 diff + 提交信息已给全 |
| 44 升级 | 先升 Node≥24.9.0 + 读 0.2.2-alpha.2 guides；2.8.8 仍缺 3 修复 → 升级重现缺陷；profile pin 2.8.4 不升级是零动作稳态 | A/C | ✅ **采纳「不升级」** |
| 44 持久化 | patch-package 方案（完整命令 + `md5sum -c` 验 10/10） | A | ⚠️ **需用户决定**：会新增依赖与 postinstall |
| 44 PR 策略 | G1/G3/G4 可新开 PR；**G2 应作 PR#7 comment 不另开重复 PR** | A | ⚠️ **需用户决定**：对外提交需授权 |

### C. 驳回 / 收敛

| 项 | 裁决 |
| --- | --- |
| 35 主版「`lead-20261107.test.js:71` 把修复后正则硬编码进测试 = 恒真」 | **部分成立**：该测试确有源码级正则硬编码、未 import `provider.js`，但 31/41 号已给「REAL-composition 冒烟」建议。本轮**补一条真行为级测试**（import 真实 provider 的正则路径）而非删原测试 |
| 35 主版「安装目录裸 `node --test` 1/3 失败 ⇒ 14/14 假绿」 | **驳回其推论**：失败是 `ERR_MODULE_NOT_FOUND: @deepseek-ai/dsh-web`（host 注入包），25 号早有记录；`src-work` 的 test-only symlink 是约定环境。保留但改文档措辞 |
| 35 主版「firecrawl 建议改回默认关」 | **不采纳**：`enableFirecrawl` 是**用户在 settings 手动打开**的（`settings.user`），schema 默认仍 `.default(false)`；是否关属用户决定，不由代码改 |
| 33-b 的 `findNamespace` 字面量建议 | 已被 `protocol-standards` 主动撤回、37 号 C-6 驳回；本轮 41 号点2 收敛为「ns 精确优先 + 专属字段兜底」，**不写死 unified-search** |

## 执行顺序（Lead 亲自，避开写作用域冲突）

1. `util/namespace.js`（新增）→ 改 `settings-api.js` + `index.js` 共用 → 补测试；
2. `cache.js` key 扩展 → 补测试；
3. `client.js`：D1–D4 + §5 + 6 个 description 改英文 + 注释改写；
4. `health.js` keyless 修正；`provider.js` 删 `resultHeader` 恒真判据；`history.js` 删 `isTrustedApiRequest`；
5. `firecrawl.js` `limit=8`；注释改写；README env 措辞；
6. 全量单测 → 逐字节同步 → 重启 → 真实 `web_fetch`/`web_search`。

**不在本轮执行**（需用户决定）：M-1/M-3、429 熔断语义、`readErrors` UI 提示、patch-package、对外 PR。

## 执行结果（2026-11-08 07:45）

### 已完成（采纳项 12 组，详见 [25 §14](25-execution-log.md)）

| 项 | 结果 |
| --- | --- |
| 共享命名空间解析器 `util/namespace.js` | ✅ 新增，`settings-api.js` + `index.js` 共用，跨 ns 误写消除（Lead 独立复现 `OTHER-PLUGIN` 不再被选中） |
| `cacheKeyFor` 纳入结果决定项 | ✅ 改 cache.js + provider.js，两组不同配置不再同键 |
| 40 号 4 个交互 bug + §5 | ✅ 空白草稿排空 / 写队列 / 失败重读 / reason 脱敏 / catch 诊断，全在 `client.js` |
| health keyless | ✅ `OPTIONAL_KEY_IDS`/`METERED_IDS`，增列两标志 |
| firecrawl `limit=8` | ✅ |
| i18n 中性英文 | ✅ 本轮新增 2 label + 4 description（上游既有中文另案） |
| 死代码 | ✅ 删 `resultHeader` 恒真判据（留函数）、删 `isTrustedApiRequest` |
| 注释规范化 | ✅ 18 处精确改写 + 正则清前缀 + 4 处头/草稿引用；审查叙事、P0/P1 编号、WBS、内部报告路径 **全部 0 残留**（`trust.js` 2 处上游 `issue #89` 保留） |
| README env 失真 | ✅ 改「Known Limitation」+ `index.js` 补注释 |
| 新测试 | ✅ `tests/lead-20261108-interaction.test.js`（6 条）+ 更新 2 条源码级断言；**修掉 35 号指出的硬编码正则恒真测试** |

### 验证

| 项 | 结果 |
| --- | --- |
| 语法 | **31/31 JS `node --check` OK** |
| 单测 | **25/25 通过** |
| 逐字节一致 | **17/17 文件** `src-work` ↔ 安装目录 |
| 备份 | **13 个 `*.orig`** |
| §6 回滚链 | 已重写为 17 文件（10 cp + 7 rm） |
| GUI / settings API | 200 / 200（旧进程） |
| 密钥扫描 | 0 命中 |

### ✅ 服务重启已解除（2026-11-08 17:08 更新）

上一轮 `systemctl restart` 受阻是 **DSH_EGRESS 出站策略临时挡住 ssh/ova 通道**。11-08 12:40:47 服务已重启为 **PID 2334**，三个 env 保持；17:08 复核 SSH 通道 `SSH_OK`。
运行态实证（见 [49 号](49-restart-evidence.md)）：`web_fetch` 200、`web_search` 8 Sources（`tinyfish ✓/8 · ddg ✓/8 · exa ✓/8 · parallel ✓/8`）、`health keyless:6` 且 firecrawl/tinyfish 为 `keyless:true, optionalKey:true, metered:true`、`settings namespace: dsh-websearch`、GUI 200 ⇒ **17 文件改进已在运行时生效**。

### 需用户决定清单 → 专家组决断映射（9 项 → 3 组）

| # | 事项 | 决断组 | 产出 |
| --- | --- | --- | --- |
| 1 | exa/parallel/firecrawl `skipInitialize:true` | **A** | `46-decision-behavior.md` |
| 2 | keyed tinyfish `forceFreshSession` | **A** | 同上 |
| 3 | 429 熔断语义 | **A** | 同上 |
| 4 | `readErrors` UI 提示 | **A** | 同上 |
| 5 | patch-package 落地 | **C** | `48-decision-upstream.md` |
| 6 | 对外提交 PR（G1/G3/G4 + G2 comment + 2.8.9） | **C** | 同上 |
| 7 | settings-api 6 组 fixture | **B** | `47-decision-norms.md` |
| 8 | 上游既有中文 description 全量英文化 | **B** | 同上 |
| 9 | 升级 `@deepseek-ai/dsh` 0.2.2-rc.1 | **B** | 同上 |

Lead 独立取证已下发各组：官方 v2.2.6 `mcp.ts` 的 `call()` 只发单个 `tools/call`（`id:1`、无 initialize），exa/parallel 都用它 ⇒ M-1 论断成立，但需同步改写 `mcp-client.js` 的 skipInitialize JSDoc + 对齐 `callBody.id`，且改动后必须证明 4 个后端仍成功（否则条件-go）。

### 任务板 / 组织

task-19~23 全部 `completed`（Lead 代收口）；9 位 teammate 全部 inactive、无后台作业；5 份提案 + 35 号主版 + 45 号裁决表齐备。

## 追加：专家组决断已执行（2026-11-08 19:20，见 [50 号](50-decisions-executed.md)）

用户「开展专家组决断继续执行」→ 3 组对 9 项做 go/no-go/条件-go（全文 `46`/`47`/`48` 号）。**已执行 6 项**：

| 项 | 决断 | 执行结果 |
| --- | --- | --- |
| M-3 `forceFreshSession` | GO | ✅ 已改 `mcp-client.js`/`tinyfish.js`，keyless 零回归 |
| M-1 `skipInitialize` | 条件-go | ✅ 前置验收通过（17:28 重启后 `exa ✓3137ms/8`、`parallel ✓4858ms/8`、`tinyfish ✓4832ms/8` 全成功、`web_fetch` 200） |
| settings-api 6 组 fixture | GO | ✅ 落盘 `tests/settings-api.test.js`，12/12 |
| readErrors | 条件-go | ✅ 只读诊断版（固定码脱敏，保留 `readFailed` 锚点）；UI 文案留给用户 |
| 429 3a | 条件-go | ✅ `failure-label.js` + `foldBreaker` 1 次 429 冷却 + health entry 存 `rateLimited`；3b 留给用户 |
| 中文 description 全量英文化 | NO-GO | ✅ 登记 Known Limitation（2.8.8 上游 39+11 处中文是上游风格） |

**终局**：43/43 单测、32/32 语法、**23/23 文件**逐字节一致、**16 备份**、服务 18:34 重启（PID 587384）、`web_fetch` 200 / `web_search` 8 Sources（exa/tinyfish/parallel ✓）、50 份 md / 18028 行、0 密钥命中。

**仍未执行（需用户最终决定）**：429 3b、readErrors UI 文案、patch-package、对外 PR（须先补 G5 完整 23 文件 diff）、升级 0.2.2-rc.1。详见 [50 号 §5](50-decisions-executed.md)。

---
终版，无凭证值写入本文件。
