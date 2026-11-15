# 36 · Lead 侧预提交发现（供 6 位审查专家交叉核对）

> 2026-11-07 15:05，Lead 在等待 30–35 号专家报告期间独立只读扫出的几个盲点。
> **仅供交叉核对，不代替专家结论**；若专家报告已覆盖或证伪，以其为准。
> 全程只读，未改任何源码/配置。

## 1. `prompting.js` 的 `QUERY_GUIDANCE_EN/ZH` 是死导出

- 定义：`lib/prompting.js:78,87`，内容是「教模型一次发一条 agent 风格查询、HyDE 重写、持续检索直到每个维度有答案」。
- 全库引用：`lib/provider.js:25` 只 import `shapeQuery / resultHeader / TELEMETRY_TAG`，**没有任何地方 import `QUERY_GUIDANCE_*`**；`lib/client.js`（731 行）也无 `ctx.systemPrompt.section`。
- 影响：用户四问里的「LLM 决定何时搜/生成什么 query」——**运行时插件侧这段提示词从未注入模型**。DSH 官方 `tool-web/src/search.ts:315-323` 的 systemPrompt.section 仍在，所以模型仍有基础指引，但插件自称的「查询构造指引」是死代码。
- 等级 A（源码级）。建议：要么注册 `ctx.systemPrompt.section` 并补 snapshot，要么删掉死导出并在 README 标注；**属产品行为改动，需用户决定**，本轮未动。

## 2. `history.js` 的 `isTrustedApiRequest` 是死代码（两套 fence）

- 定义：`lib/history.js:104`，一套独立的 loopback + sec-fetch-site 判定；**零调用**（`grep -c isTrustedApiRequest` = 1，即只有定义）。
- 实际用的是 `import { rejectionFor } from "./trust.js"`，且 `settings-api.js:84`、`health.js:94`、`history.js:157` **三处都调用** `rejectionFor` ⇒ fence 覆盖是完整的，不存在绕过。
- 影响：仅代码冗余/维护风险（两套 fence 逻辑可能漂移），**不是安全漏洞**。等级 A。

## 3. 路由前缀不一致（低优先级）

| 路由 | 前缀 | fence |
| --- | --- | --- |
| `/api/unified-search/settings` | `unified-search` | `rejectionFor` |
| `/api/unified-search/health` | `unified-search` | `rejectionFor` |
| `/api/websearch/history` | `websearch` | `rejectionFor` |
| `/api/websearch/history/clear` | `websearch` | `rejectionFor` |

- 两组前缀不同，但 `trust.js` 的 `rejectionFor` 是**按 req 逐次判定**（不依赖前缀），且 webServer 最长前缀派发已在 `trust.js` 文件头说明。当前无功能问题，仅命名不一致。等级 A。
- 若将来接入按前缀匹配的网关策略，需注意两组前缀都要覆盖。

## 4. history 隐私（已确认安全）

- `toPublicEntry`（`lib/history.js:17-25`）只存 `query`（截断 500）、`time`、`resultCount`、`backendsOk`、`backendsTotal` —— **不存结果 URL、不存凭证、不存 API key**。等级 A。

## 5. 供对抗专家核对的基线（Lead 侧实测，2026-11-07 15:00）

| 项 | 值 |
| --- | --- |
| 服务 | `dsh-web.service` active，`MainPID=262230`，启动 13:51:12 |
| GUI | `?token=` + `curl -L` → HTTP 200 |
| 插件版本 | 2.8.4（未升级） |
| 改动文件 | 9 个：`src-work` ↔ 安装目录 md5 逐字节一致 |
| 备份 | 8 个 `*.orig`（含 `provider.js.orig`），3 个新增文件需 `rm` |
| drop-in | 3 行 `Environment=`，`[Service]` 段 |
| 单测 | `lead-20261106.test.js` 11/11 + `lead-20261107.test.js` 3/3 = **14/14** |
| settings↔执行 | `enableFirecrawl/tinyfish=true`（user），health `enabled=6` 含两者 |
| 真实搜索 | `tinyfish ✓/8`、`ddg/exa/parallel ✓`；`firecrawl ✗ MCP error: Anonymo...`、`searxng ✗` 反爬 |
| 基线快照 | `.baseline-20261107-1455/`（26 个 md + CHECKSUMS） |

---

本文件无凭证值；仅为交叉核对材料，不构成最终结论。
