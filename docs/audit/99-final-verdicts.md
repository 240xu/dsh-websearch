# 全库口径裁决索引（2026-11-06，Lead）

> **读者必读**：本目录报告族跨度 11-04 → 11-10，份数随并发提交持续递增（以 `ls *.md | wc -l` 为准，2026-11-10 已 68+ 份），多个子代理续研后**旧正文保留为过程记录、未逐行改写**。同一事实在不同报告里可能有两种口径。本文件是全库**唯一权威的最终口径**，[REPORT.md](REPORT.md) 已按其执行。凡专题报告正文与本文件冲突，**一律以本文件为准**。

## 裁决 1 · 403 根因（覆盖所有「JA3 / TLS 指纹 / 未抓包定位 E」表述）

- **最终口径【A/D】**：本机 `@240xu/dsh-websearch` 2.8.4 的 `lib/util/egress-fetch.js:276` `normalizeHeaders()` 有 `delete headers["host"]`，而 `httpsViaConnect` 直接把该 headers 传进 CONNECT 隧道（**不像** `httpViaProxy:202` 补 `host: headers.host ?? target.host`）→ 发往 Cloudflare 的 HTTPS 请求缺少**显式、端口限定的 Host 头**，被边缘以 151B 403 HTML（`server: cloudflare`、`cf-ray`）拒绝。
- **2026-11-06 离线 A/B 精确化（Lead 执行修复时实测）**：Node 的 `https.request({socket})` 在 `options.host` 缺省时会**自动合成一个不含端口的 Host**（如 `localhost`），并非完全无 Host。本地 CONNECT 代理 + TLS 服务器对照：修改前 `Host: localhost`（Node 自动合成）、修改后 `Host: localhost:45277`（显式 `target.host`）。⇒ 因果应表述为「**Host 值非权威形式（缺端口）**引发 Cloudflare 403」，而非「完全缺 Host 头」；修复动作（补 `host: headers.host ?? target.host`）不变，两解与 A/B 结论均成立。离线脚本只用于证明代码行为，不依赖外网出口。
- **决定性证据**：Lead 最小 A/B，同一 CONNECT 通道 `172.30.66.1:1091`、同一 `node:https`/OpenSSL 3.5.2 栈、同一 UA、同一 body，**唯一变量 Host 头** → `WITHOUT Host: 403` / `WITH Host: 200`。[08 附录 A.2](08-own-repo.md) 的 12 组实验（显式改 ALPN 仍 403 → 排除指纹；仅补 Host 即 200；同步复现 ddg 301 与 `searx.be` 200 `text/html` 反爬页）独立互证。
- ⇒ **02 号「Node/OpenSSL TLS ClientHello 指纹被拒」、09/09b/09c/12/00/01 初版的「JA3/TLS 指纹链路」归因均已证伪**。2.8.5 CHANGELOG 的「JA3 指纹」是作者当时的**假设**，不是可复现机制，仅作历史归因保留。
- **版本含义**：2.8.8 的 `normalizeHeaders` **仍删 Host**，无 forwarder 时同样 403；当前进程（PID 2085）已设 `DSH_EGRESS_FORWARDER` / `_PROXY`，但 2.8.4 代码里 forwarder 关键字计数 0（env 被静默忽略）。
- **仍 E**：CF 具体 WAF 规则编号、`forwarderFor` spec 与 sidecar 逐字段一致性、升级后是否恢复。

## 裁决 2 · P0 清单（覆盖所有「三条 / 升级很可能直接修复 / 不改 cordis.patch.yml」表述）

**最终为四条**，且「升级即修复」必须标 E：

| # | 动作 | 必备条件 |
| --- | --- | --- |
| ① | **优先：`DSH_WEB_FETCH_PROVIDER=http` 环境变量 pin（零文件编辑）**；或备选：profile patch **新增** `- id: web` 并 restate 完整 config（`searchProvider: unified` + `fetchProvider: http`） | 用户批准并重启 `dsh web`；**`web_fetch` 的 `WEB_PROVIDER_AMBIGUOUS` 根因是插件自带 `node_modules/@240xu/dsh-websearch/cordis.patch.yml` 的 `- id: web` 整体替换抹掉 base 的 `fetchProvider: http`**（profile patch 本身无 web 条目）；2.8.8 的 bundle patch 逐字相同 → **升级修不了**。精确证据与两解见 **[24 号裁决](24-p0-landing-correction.md)**（A 级，`dsh-web/lib/index.js:60,115`） |
| ② | 升 `2.8.4 → 2.8.8`（至少 2.8.6） | **且** sidecar 可达 + `DSH_EGRESS_FORWARDER_PROXY` 已配（2.8.8 仍删 Host）**且**先处理 open 的 [PR #7](https://github.com/240xu/dsh-websearch/pull/7)（settings inert on DSH 0.2.x）/ [Issue #8](https://github.com/240xu/dsh-websearch/issues/8)（存不了 API Key）。**单升版本不够** |
| ③ | 新增 `firecrawl` backend | 官方 keyless hosted tier（B 级），但额度具体数字 E、建议默认关 |
| ④ | 新增 `tinyfish` backend | keyless header 降级；30 req/min + 50 searches/day（D 级） |

**2026-11-06 12:10 动态复核（C 级，Lead 用认证 GitHub API）**：PR #7 与 Issue #8 **仍为 open**（`closed_at: None`）；#7 无评论、已提交 3 文件改动（`lib/index.js` +18/−1、`lib/provider.js` +1/−1、新增 `tests/v28x-settings-bridge.test.js` +57），#8 有 1 条作者本人评论「稍等稍等，马上解决!」（2026-11-05T13:23:29Z）。仓库 open issues 共 6 条（#3/#4/#5/#6/#7/#8）。⇒ **P0② 的前置条件尚未解除**：作者已在修但截至本次采样未合并，升级前须复查这两个编号的状态；npm latest 仍 `2.8.8`、本机仍装 `2.8.4`、GUI 仍 401。

零部署依赖的 **E 级备选**：照 `httpViaProxy:330` 在 `httpsViaConnect` 补 `headers.host ?? target.host` 即可无需 forwarder 也 200（未实施、未提 PR）。**「升级很可能直接修复」「P0 三条」「不改 cordis.patch.yml」全部作废。**

## 裁决 3 · `web_fetch`（覆盖所有「可能触发 AMBIGUOUS / 标 E 未实测」表述）

**【D】02 §B 已实跑确认**：返回 `Error: multiple usable web providers are registered (deepseek-fetch-api, http); configure one explicitly`（`WEB_PROVIDER_AMBIGUOUS`）。根因是社区 `- id: web` patch 整体替换丢 `fetchProvider: http`，而运行时（发布版 0.2.1-rc.2 额外挂载 `dsh-web-deepseek-api`）fetch 侧有 2 个可用 provider，`dsh-web/lib/index.js:112,134` 要求「无显式配置时恰好 1 个可用」。`dsh web --dump-config` 组合树（1729 行）里 `id: web` 只剩 `searchProvider: unified`，全文 `fetchProvider` 0 处。⇒ **web_fetch 同样 100% 不可用，但原因与 web_search 不同**（provider 歧义 vs 后端全挂）。01/09c/10 标 E「未端到端实跑」的旧表述作废。

## 裁决 4 · arXiv:2404.01037（覆盖所有「盲目多查询劣化 / 应剔除该归因」表述）

- 真实标题 **「ARAGOG: Advanced RAG Output Grading」**（`arxiv.org/abs` 的 `citation_title`，HTTP 200）；插件 `lib/multiquery.js:3,29` / `README.md:130,249` 把它简写成一句主张属**转述不精确**。
- 但 [arXiv API 摘要原文](https://export.arxiv.org/api/query?id_list=2404.01037) 逐字含 "**Multi-query approaches underperformed**"，另含 "MMR and Cohere rerank did not exhibit notable advantages over a baseline Naive RAG system"、`HyDE and LLM reranking significantly enhance retrieval precision`。
- ⇒ **不剔除依据**（10 §4 R6 / 11 §7.2 的「应剔除」已被推翻），改写为：「**ARAGOG(arXiv:2404.01037) 在该实验设置下报告 Multi-query 低于 Naive RAG 基线、MMR/Cohere rerank 无显著优势**」，限定为**单篇探索性实验、非普适定律**；`multiQueryEnabled` 默认关是插件作者据此做的工程取舍，不是论文规范。同一论文同时是 HyDE/LLM rerank 的正面证据。HyDE 2212.10496 / Step-Back 2310.06117 / Cormack SIGIR 2009 标题出处均正确。

## 裁决 5 · OpenAI/Anthropic 官方字段（覆盖所有「字段无法复核 → 降 E」表述）

- 默认网关 `172.30.66.1:1091` 对 `platform.openai.com` / `developers.openai.com` 全 403；但**美国 egress `172.30.0.1:24070` 可取到官方 `.md` 200**（Lead 独立复核 `developers.openai.com/api/docs/guides/tools-web-search.md` 46085 字节，逐字命中 `show inline citations as prominent, clickable links`(:170) 与 `up to 100 allowed_domains or up to 100 blocked_domains`(:580)）。
- ⇒ 三家硬性引用呈现义务为 **B 级**：OpenAI「must show inline citations as prominent, clickable links」、Anthropic「citations must be included to the original source」（[`platform.claude.com/llms-full.txt`](https://platform.claude.com/llms-full.txt) 独立补证）、Google「inline and in aggregate」。**「出口 403 ⇒ 资料缺失 ⇒ 降 E」的推理作废**，但任何单次 curl 结果须注明所用出口。
- **仍 E**：Anthropic「结果块置于问题之前提升引用召回」（03 对官方全量文档检索 0 命中，最相近表述讲的是长文档置顶/响应质量，非引用召回）、Brave `result_filter`/`summary` 等字段名（官方 SPA HTML 0 命中）。

## 裁决 6 · Firecrawl keyless（覆盖 09 附录 A/C 的「仅 D 级实测 / 服务端隐式 / 待核实」表述）

[官方 `mcp-server/keyless.md`](https://docs.firecrawl.dev/mcp-server/keyless.md)（HTTP 200）逐字确认「Keyless server URL (Streamable HTTP, **no credential**): `https://mcp.firecrawl.dev/v2/mcp`」「Keyless MCP is rate limited and exposes Search, Scrape, and Parse」；`rate-limits.md#keyless-no-api-key` 确认按 IP 每日双上限 + 429、免费 key 送 1,000 credits。⇒ hosted keyless tier 为 **B 级官方事实**。两点仍成立：v2.2.5 客户端源码 `firecrawl.ts:67` **无**显式 keyless 头（对比 tavily.ts:57 / tinyfish.ts:76）；**具体日上限数字官方未公布 → E**。05 续研 A.2 已升级，09 附录 A 的「仅 D 级」定性作废。

## 裁决 7 · 版本与 OpenCode v2 基准（覆盖 04:10 等旧表述）

- **版本三值**：本机 **2.8.4** / CHANGELOG 到 **2.8.6** / npm latest + 远端 main **2.8.8**；2.8.8 的 `lib/` 与 2.8.6 逐字节相同；2.8.7 是孤儿发布（`gitHead=608e474f…` API 422）；npm 2.8.6 `gitHead=72cbba8e` 而非 `592237f`；仓库无 2.8.x git tag、0 releases。
- **OpenCode**：`sst/opencode` → **`anomalyco/opencode`**（301）；v2 主线最新 tag **`v2.2.5`** = commit `9bbb8ce18c80f099e0e448775f59d965ead40a21`；全量 tag **v1=242 / v2=44**，且 **v1 仍并行发版**（`v1.19.5` 2026-10-28 晚于 `v2.0.0` 2026-09-11）——「v1 停在 v1.19.5」「v1 tag 42」「v1 已停更」全部作废。`opencode.ai/docs/tools/`（不带 `/v2`）返回的是 **v1 内容**，引用一律显式带 `/v2` 或 `v2.2.5` tag。客户端内置 5 provider + 运行时 Console 托管第 6 个；v2.2.5 的 `websearch/` 7 文件无 `provider.ts`。
- **版本陷阱**：独立包 `@deepseek-ai/dsh-web` 的 dist-tags 是 `latest=0.0.1-rc.1` / `alpha=0.2.2-alpha.3` / `next=0.2.2-rc.1` → **禁止**用它当 web 包发布版本；monorepo 是 `dsh-v0.2.1-alpha.2`、GUI 发布版 `0.2.1-rc.2`。

## 裁决 8 · 链接纪律与各报告状态

- 全队约 93 条浮动 `blob/main|dev|master` 链接**不批量改写**（各报告已有 ref + commit sha + CHANGELOG 行号 + 本地路径:行号多重锚点，且 main 内容经 npm 2.8.8 tarball 逐字节比对确认）；[12 §0.3](12-change-lineage.md) 的固定 ref 纪律是范本，**REPORT.md 权威链接一律固定 ref**。
- 已在文件内**就地**加裁决注记的：00（§4/§7/文首）、02（附录 C 结论行 + 文末附记）、08（文首「读者必读」框 + §9 两行）、09c（文首「读者必读」框 + §4.3 归因行 + P0-1 + 风险表）、10（R6 行 + §6 规则 + 文末裁决附记）、11（§7.2 P0 行 + §9 + 文末裁决附录）、04（§0 v1 tag 行）、REPORT（全文）。
- 其余专题报告（01/03/05/06/07/09/09b/12/_SKELETON）**旧正文保留为 11-04/05 调研快照**，未逐行改写；凡与上述 8 条裁决冲突，一律以本文件与 [REPORT.md](REPORT.md) 为准。
- **⚠️ 规则级例外（评估代理指出，需维护者知晓）**：`_SKELETON:20`、[11 §1](11-traceability-audit.md)、[12 §0.3](12-change-lineage.md) 把「一律固定 ref」写成无例外的硬规则，而本裁决 8 允许约 93 条浮动链接作为**过程记录**保留 ⇒ **追溯 gate 不能写死「零浮动链接」**，应校验「权威载体（99/24/REPORT）的引用是否固定 ref」而非全库。此项属长期维护约定，不影响本轮结论。

---

## 待用户裁定事项（评估 [20 §6/§10](20-content-assessment.md) 提出）

> **⚠️ 2026-11-06 16:21 状态更新**：用户已授权 Lead 全权接手，M1 已执行完毕并有实跑验收（`web_fetch` 200、`web_search` 8 条 Sources、2 后端成功）。完整执行记录、注释、备份与回滚见 **[25-execution-log.md](25-execution-log.md)**。下列 1–3 项状态已变，4 项维持。

1. **产品决策动机**：为何用社区 `unified` 替换官方 `deepseek-official` provider——全库无作者/issue/PR 记录（四问①唯一实质空白）。**仍需您确认或明确标 E 存档**（此项无法由执行补齐）。
2. **「等作者修 PR #7 / Issue #8」的时间窗**：**已由用户授权「由我全权接手」而解除**——不再等待上游；但**未升级到 2.8.8**（升级会覆盖本次本地改动），见 [25 §5](25-execution-log.md)。两编号仍 open 的事实保留在 [23](23-decision-inputs.md)。**2026-11-06 20:12 追加**：用户提醒后核查发现 **Issue #8 的缺陷在本地 2.8.4 同样存在**（`inject` 缺 `remote.credentials` → 保存必失败 + 假成功），已在 `lib/client.js` 三处修复并验证 11/11 单测 + 行为级模拟，详见 [25 §10](25-execution-log.md)。⇒ Issue #8 对**本机**不再是阻塞项。**2026-11-07 14:17 再追加（用户追问「你确定修完了吗？」）**：核查发现**保存的值当时并未驱动执行** —— `apply()` 的 `current()` 在 0.2.x 恒返回初始 schema-default config，settings service 的 effective value 从不参与。这正是 **PR #7「settings are inert」**，本机 2.8.4 同样中招。已采用作者自己的 PR 补丁修 `lib/index.js`（`current()` 每次读 `settings.describe()`）+ `lib/provider.js` RFC1918 正则。决定性实证：修复前 `health enabled=4`（user 里 `enableFirecrawl/enableTinyfish=true` 却执行为 false），修复后 **`enabled=6` 含两者**、真实 `web_search` 遥测 **`tinyfish ✓3941ms/8`**。详见 [25 §11](25-execution-log.md)。⇒ PR #7 对**本机**亦不再是阻塞项（上游仍未合并，升级会覆盖本地改动）。
3. **P0 执行授权**：**已授权并执行**：`DSH_WEB_FETCH_PROVIDER=http` + `HTTP(S)_PROXY` 经 systemd drop-in 落地、服务已重启；`egress-fetch.js` 补 Host、`mcp-client.js` 加 `skipInitialize`、两个新 backend、client UI 两轮打磨、Issue #8 三处修复、PR #7 两处修复、**11-07 六专家审查后补修（P0 可选 Key 不可达 + 3 个 P1）**；**18/18 单测通过**、**10 个文件逐字节一致**、服务 20:08 重启后 `web_fetch` 200 / `web_search` 8 条 Sources（`tinyfish ✓`）。详见 [25 §12](25-execution-log.md) 与 [37 号六专家裁决汇总](37-review-synthesis-SKELETON.md)。**注意**：`enableFirecrawl`/`enableTinyfish` 的 schema 默认值仍是 `false`，但用户已在设置面板手动打开（`settings.user` 为 true），PR #7 修复后该值现已真正生效。**仍未执行**：升级 2.8.8、提上游 PR、在浏览器里手工填测试 key 点保存（唯一剩余端到端确认）。

> **⚠️ 2026-11-09 13:20 全量 bug 审计补注（目标模式）**：6 组专家 × 双轨派发（[51–57 号](56-full-audit-SKELETON.md)）把 **4 条 P0 + 6 条 P1 + 8 条 P2** 全部审计并执行：SSE 多帧解析、错误契约（11 处 `webErrorFromResponse` + 分类器 route on code）、**429 两件遗留（Retry-After 透传 + 全配额快速失败，均有行为级实证）**、`numResults` 死设置、`unified search aborted` 误分类 + ddg 8s、`readErrors` UI、`*ApiKeyEnv` 校验、`save()` 假绿、35 文件回滚链重写、README 13 后端、自指假绿测试消除。**56/56 单测、33/33 语法、35/35 文件一致、26 备份、服务 13:03 重启（PID 2512598）、`web_fetch` 200 / `web_search` 8 Sources（exa/parallel/ddg/tinyfish 四后端全 ✓）**。原 8 条裁决**未被推翻**；上一补注中「429 3b / readErrors UI 未执行」**现已完成**。仍需用户决定（非 bug）：patch-package、对外 PR（须补 G5 35 文件 diff）、升级 0.2.2-rc.1、`ws.register` disposer 契约确认。执行真相见 [56 号裁决](56-full-audit-SKELETON.md) / [58 号执行](58-full-audit-executed.md) / [25 §6](25-execution-log.md)。

> **⚠️ 2026-11-08 19:20 专家组决断补注**（用户「开展专家组决断继续执行」）：3 组决断（[46/47/48 号](50-decisions-executed.md)）对 9 项做 go/no-go/条件-go，Lead 执行 6 项：M-3 `forceFreshSession`、M-1 `skipInitialize`（前置验收：exa 8285→3137ms / parallel 11309→4858ms、四后端仍全 ✓）、settings-api fixture（12/12）、readErrors 只读诊断兼容版、429 3a（1 次 429 立即冷却）、中文 description 全量英文化 **NO-GO**（2.8.8 上游 39+11 处中文是上游风格，登记 Known Limitation）。**43/43 单测、23/23 文件一致、16 备份、服务 18:34 重启（PID 587384）、`web_fetch` 200 / `web_search` 8 Sources 全绿**。原 8 条裁决**未被推翻**。仍未执行（需用户决定）：429 3b、readErrors UI 文案、patch-package、对外 PR（48 号发现 44 号 G1–G4 只覆盖 10/23 文件，须补 G5）、升级 0.2.2-rc.1。执行真相见 [25 §15](25-execution-log.md) 与 [50 号](50-decisions-executed.md)。

> **⚠️ 2026-11-08 小组改制补注**（用户「将智能体改制为 bug 与官方化行为规范小组对插件改进」）：5 份提案（40–44）+ 35 号主版齐备，[45 号裁决表](45-reform-verdicts-SKELETON.md) 逐条裁决后执行 12 组采纳项（共享 `findPluginRow` 消除跨 ns 误写、`cacheKeyFor` 纳入结果决定项、4 个保存交互缺陷、health keyless、firecrawl `limit=8`、i18n 中性英文、删 `resultHeader` 恒真判据与 `isTrustedApiRequest` 死代码、注释审查叙事清零、README env 失真）。**25/25 单测、17/17 文件逐字节一致、13 备份**。服务重启一度受阻，**已于 11-08 12:40:47 解除（PID 2334）**，运行态实证见 [49 号](49-restart-evidence.md)；原 8 条裁决**未被推翻**。执行真相见 [25 §13/§14](25-execution-log.md)。

> **⚠️ 2026-11-07 20:55 六专家审查后的权威链补注**（用户「分配三位对抗型审查专家，两位官方行为对齐专家和挖掘专家」）：
> - **新增裁决 A**：`34-b` 的 D-9「工作副本≠安装版」、`32/32-b` 的「第 10 处 websearch 改动 = profile `cordis.patch.yml`」、`33-b` 的「`findNamespace` 必须改成 `ns === "unified-search"`」**三条均被 Lead 驳回**（逐字节 md5 / 逐行 diff 证明分别是时点滞后、模型配置差异、真实 ns=`dsh-websearch`）。原始专家报告按本文件约定**保留为过程记录**，驳回理由见 [37 §3](37-review-synthesis-SKELETON.md)。
> - **新增裁决 B**：Issue #8 作者 2026-11-07T05:10:52Z 回「ok了，感谢」但 issue **仍 open**、main 最近 commit 仍 10-21、npm latest 仍 **2.8.8**（无 2.8.9+）、PR #7 仍 open ⇒ **口头、未发布**。⇒ **升级 2.8.8 会覆盖本地自修并重新引入缺陷**，本地补丁仍是唯一实际生效的修复（[35 号](35-deep-dig-b.md) 列为状态类 P0）。
> - **新增裁决 C**：官方 `@deepseek-ai/dsh` latest=**0.2.2-rc.1** 要求 Node ≥24.9.0（本机 v22.20.0），且 0.2.2-alpha.2 有 web search breaking change ⇒ **不建议升级**；但 33 号 npm pack 六包比对证明 rc.2=rc.5=0.2.2-rc.1 的**凭证/settings 契约逐字相同**，无需兼容分支。
> - **口径不变项**：403 归因（Host 非端口限定权威形式）、arXiv:2404.01037 归因、P0 条数、web_fetch 字段等级、Firecrawl keyless B 级、OpenCode v1/v2 版本口径 —— 六专家审查**未推翻** 99 号原 8 条裁决。
4. **闭源/E 级缺口**：Cursor/Windsurf 真实工具 schema、模型侧 query 提示词全文与停止条件、DSH 官方 8 条约定的引入 commit、`vitest` 实跑绿、6 处 404 链接实际替换——维持 E 或另行立项。

**因果精确化（[25 §3 V3](25-execution-log.md) 离线 A/B）**：原表述「完全缺 Host 头」不精确——Node 在 `{socket}` 下会自动合成**不含端口**的 Host（如 `localhost`）；修复版显式给 `target.host`（如 `localhost:45277`）。⇒ 应表述为「**Host 非端口限定的权威形式**引发 Cloudflare 403」，修复动作与结论不变。

---

**本文件无凭证值、无浮动 ref 作为依据。** 调研阶段全程只读；执行阶段的全部改动、注释、验收与回滚见 [25-execution-log.md](25-execution-log.md)。
