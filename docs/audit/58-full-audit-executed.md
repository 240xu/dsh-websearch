# 58 · 全量 bug 审计与迭代执行结果（目标模式 · 2026-11-09）

> 用户「分配专家子代理开启目标模式，持续完成迭代和推进，并且把 bug 仔仔细细的全量审计干净」。
> 持久化目标 `goal-fa4f0f07-…`；基线 `.baseline-20261108-2205/`（53 份 md + 40 插件文件、43/43 单测、服务 PID 587384）。
> 裁决总表 [56 号](56-full-audit-SKELETON.md)；审计报告 [51–55 / 57 号](56-full-audit-SKELETON.md)（主版 + `-b` 备份版）。

## 1. 审计编制与交付

6 组 × 双重派发（fork 主版 + durable 备份版），防「取证完但写文件前进程失败」。5 个 fork 主版多数失败，**备份版策略生效**；另有 54/55 两个主版成功落盘。

| 组 | 模块 | 产出 |
| --- | --- | --- |
| A | 网络/MCP 层 | `51-audit-network-b.md`(142) |
| B | 核心执行层 | `52-audit-core-b.md`(269) |
| C | 配置契约层 | `53-audit-config.md`(主版) + `53-audit-config-b.md`(181) |
| D | 测试/文档/回滚 | `54-audit-tests-docs.md`(348) + `-b`(204) |
| E | 运行时端到端 | `55-audit-runtime.md`(319) + `-b`(264) |
| F | 错误契约公共模式（交叉） | `57-audit-error-contract.md`(423) |

## 2. 发现的真 bug（按严重度）

### P0（4 条，全部已修）
1. **`parseEnvelope` SSE 多帧解析失败**（51-b + Lead 独立复现 + 57）：`join("")` 把多个 `data:` 帧拼成 `{...}{...}` → 整体 JSON.parse 失败 → 整次搜索失败；且 SSE 分支不校验 `id===expectedId`。
2. **错误契约违背官方约定**（57 F-1/F-2）：`HarnessError` 要求 **route on `code`, never by parsing message**；`rateLimited()` 靠文本正则，`[D]` 实证 8 例中 **4 例假阳性**（含 HTTP 200 anonymous 被误冷却）+ N-1 漏判（openai/anthropic 把 `HTTP 429` 覆盖成 provider detail）。
3. **Retry-After 恒 60s 兜底**（57 + 52-b）：`egress-fetch.js collect()` **已保留完整 headers**（修正了 Lead 的初始前提），缺的是 11 处非 2xx 抛错点没把 Response 带走。
4. **全冷却 fail-open 烧配额**（52-b）：`provider.js else cooled.clear()` 在所有后端 429 冷却时清空冷却表、照常全量扇出；`rateLimited` 零读取消费者 ⇒ 3b **尚未实现**。

### P1（已修 6 条）
- **`numResults` 死设置**（55 主版）：`provider.js request?.maxResults || opts.numResults` 让 host 的 `searchMaxResults=8` 永远压过插件值；`resultTelemetry=false` 立即生效证明桥接正常。
- **`unified search aborted` 误导**（55/55-b）：其实是 ddg/searxng 5s 硬超时，且本地补丁**未移植 2.8.6 的「分类前置」修复**；ddg ceiling 仍是 5000ms（2.8.8 已 8000ms）。
- **`readErrors` 无 UI 渲染**（53-b）：链路完整但 JSX 0 处引用 → `describe()` 失败时 UI 仍显示「未配置」。
- **`*ApiKeyEnv` 无格式校验**（53 主版）：settings bridge 可写 `""`/非法名 → `credentialRef` 抛 TypeError 全崩。
- **`save()` 假绿**（53 主版）：`for...of await` 期间晚到编辑被删、且 `savedAt` 置位 → 同屏「有未保存修改」+「已保存 ✓」。
- **回滚链 P0 不可执行**（54 + 54-b 双重）：25 §6 仍是 17 文件版，缺 3 cp + 3 rm，「5 行 REMOVED」与 7 行 rm 矛盾，50 §4 交叉引用是空指针。

### P2 / 已确认无误
- 已修：`readBody` 超限未 drain、`cacheKeyFor` 漏 `backendTimeoutMs` 等 4 项、`history.clear()` 不在 writeChain、`failCount` 冷却到期不清零、firecrawl 错误串双重截断（helper 统一 140 字符）、自指假绿测试 1 条、README/package.json 11→13 后端、2 处本轮新写注释残留。
- **确认无误**（客观脚本）：13 个 id 六处登记 **ALL 13 × 6**；Config 55/55 字段有 `.description()`；zh/en 55/55 对称（新增 `keyReadFailed` 双语）；`writeQueue` 真串行、空白 stagedKey 真排空；`findPluginRow` 12 用例全过；认证 fence 未授权 401 / 跨站 403；保存→执行闭环 POST 8→9→8 无残留。
- **登记 Known Limitation 未改**：`ws.register` disposer（发布版契约未确认，不凭猜测改）、`sanitizeError` 正则加固（真正边界是 `safeFailureReason` 固定码）、`isComplexQuery` 裸「和」误标 multi、`/tmp/dec.cookies` 有效 JWT（只报告不删）、中文 description 全量英文化（47 号 NO-GO）、patch-package / 对外 PR / 升级 0.2.2-rc.1（需用户授权）。

## 3. 已执行改动（Lead 亲自，依赖驱动顺序）

| 序 | 改动 | 文件 |
| --- | --- | --- |
| 1 | 新增 `webErrorFromResponse()` helper（构造后赋值、保 `instanceof WebError` + cause），11 处非 2xx 抛错点统一挂 `status`/`retryAfter`/`rateLimited`/`code` | 新增 `util/web-error.js` + 改 9 个 backend + `mcp-client.js` |
| 2 | `rateLimited()` 优先读 code/status/rateLimited，正则降 legacy 兜底（去裸 `quota`、收窄 `Anonymo` 为 Firecrawl 完整串）；`retryAfterMsFrom()` 读 `err.retryAfter` | `util/failure-label.js` |
| 3 | 3b：全 `rateLimited` 冷却 → 快速失败 + 明确 retry 文案；非配额仍 fail-open | `provider.js` |
| 4 | SSE 按空行切事件、逐帧解析、挑 id 匹配且含 result/error 的帧 | `util/mcp-client.js` |
| 5 | `numResults` 取 `min(hostCap, userMax)`；ddg/searxng ceiling 5000→8000；内部超时 telemetry 前置分类 | `provider.js` |
| 6 | `foldBreaker` 过期窗口重置 failCount + 清 cooledUntil | `breaker.js` |
| 7 | `readErrors` UI 双语提示（`keyReadFailed` zh/en）两处卡片渲染 | `client.js` |
| 8 | 10 个 `*ApiKeyEnv` 加 `.pattern(/^[A-Z][A-Z0-9_]*$/).min(1)` | `index.js` |
| 9 | `save()` 快照 staged 条目引用，只删未变的；`savedAt` 仅在无残留时置位 | `client.js` |
| 10 | `readBody` 超限清监听 + `req.destroy()`；`cacheKeyFor` 补 4 个结果决定项；`history.clear()` 入 writeChain | `settings-api.js` / `provider.js` / `history.js` |
| 11 | 25 §6 重写为 **35 文件（23 cp + 12 rm）+ 26 备份** 的可执行链；README/package.json 11→13；注释去叙事 | 文档 |

## 4. 复审（重启后真实运行态）

服务 **11-09 00:16:31 重启**（PID 1186109），三个 env 保持。

| 项 | 结果 |
| --- | --- |
| `web_fetch` | **HTTP 200** + 正文 |
| `web_search` | **8 条 Sources**；`exa ✓3213ms/8 · parallel ✓3695ms/8 · ddg ✓3803ms/8 · tinyfish ✓4115ms/8` —— **四个后端全成功**（改动前 ddg 常因 5s 超时失败，`ddg:8000` 修复生效）；firecrawl 匿名额度、searxng 反爬页属预期降级 |
| `settings` API | `ok:true`、`namespace:dsh-websearch`、`numResults:8`、两计量开关 true |
| `health` API | `enabled:6`、`keyless:6`，计量后端 `optionalKey/metered:true`，exa/ddg/tinyfish `lastError:None` |
| 启动日志 | 唯一 `1 entry did not activate` = `dsh-purge-community` 缺 `yaml`（既有无关） |
| 全量单测 | **54/54 通过**（7 个测试文件） |
| 语法 | **33/33 JS `node --check` OK** |
| 逐字节一致 | **35/35 文件** `src-work` ↔ 安装目录〔第 2 轮新增 `3b-runtime.test.js`〕 |
| 备份 | **26 个 `*.orig`** |
| 报告库 | 61 份 md / 20679 行，密钥扫描 **0 命中** |

## 5. 目标模式第 1 轮复审（2026-11-09 13:10）

服务 13:03:40 重启（PID 2512598）后再次核验，并补上 3b 的**行为级**证据：

| 项 | 结果 |
| --- | --- |
| 服务 / 通道 | active PID 2512598，三个 env 保持，SSH_OK |
| **35 文件一致** | 35/35（新增 `tests/lead-20261109-3b-runtime.test.js`） |
| 429 两件遗留 | `webErrorFromResponse` **11/11 调用**精确齐备（mcp-client 2 + searxng 2 + 7 backend）；`retryAfterMsFrom` 读 `err.retryAfter`；3b `.every(rateLimited)` 分支在位 |
| **新增行为级测试** | `lead-20261109-3b-runtime.test.js`：真 `createUnifiedSearchProvider` + 假 backend 实证「全 429 冷却 → 快速失败且零新调用」「非配额冷却 → 仍 fail-open」，2/2 通过 |
| 全量单测 | **56/56 通过**（8 个测试文件） |
| 语法 | 33/33 JS |
| `web_fetch` | HTTP 200 |
| `web_search` | 8 条 Sources；`exa ✓2119ms/8 · tinyfish ✓2867ms/8 · ddg ✓3758ms/8 · parallel ✓4067ms/8` 四后端全成功；另有 `[websearch cache] cache hit, age 836s` 证明缓存路径正常 |
| 回滚链 | 25 §6 同步为 **35 文件（23 cp + 12 rm）+ 26 备份** |
| 报告库 | 62 份 md / 20777 行，0 密钥命中 |

## 6. 目标模式结论

**本轮把 4 条 P0 + 6 条 P1 + 8 条 P2 全部审计并执行完毕，重启后复审通过，无未修 P0/P1。** 所有改动带注释、有备份、可回滚（25 §6 为唯一可执行的 **35 文件链**）、有行为级测试（新增 `sse.test.js` 从真实源码提取函数、`3b-runtime.test.js` 驱动真 provider，消除 1 条自指假绿）。**429 两件遗留（Retry-After 响应头透传 + 全配额冷却快速失败）均已落地并有行为级实证。**

目标 objective 的全部要件已达成：分模块全量审计、逐条可复现证据、Lead 统一裁决执行、补测试、35 文件逐字节同步、重启、真实工具复跑并再审一轮、无未修 P0/P1。

**仍未执行（需用户决定，非 bug）**：`ws.register` disposer（契约待确认）、`isComplexQuery` 查询语义、`sanitizeError` 加固、`/tmp` 会话 JWT 清理、patch-package 落地、对外 PR（48 号：须先补 G5 完整 35 文件 diff）、升级 0.2.2-rc.1。

---
无凭证值写入本文件。
