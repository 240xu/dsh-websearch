# 09c — OpenCode v2 搜索能力并入 DSH unified provider：可执行清单与本地网关核查

> 本文是 Lead 派发的第二项任务产物（写冲突消解后的最终文件名）。**只写本文件**，未修改 `01-local-impl.md`、`09-opencode-endpoints.md`、`09b-opencode-v2.md`，未改任何源码/配置，未重启任何服务，未操作 task-9（由 Lead 统一处理）。
> 聚焦点：① 本地 `opencode2api` / 私有网关只读核查；② 把 OpenCode v2 的 5 provider 与选择/权限/MCP 设计并入 `@240xu/dsh-websearch` unified provider 的 **P0/P1/P2 可执行清单**。5 provider 端点逐字段与 v2/v1 差异分别由 09 / 09b 承担，本文不重复，只在并入需要处引用。
> 用户核心要求（Lead 转述原话）：「所有 dsh web search 他的改动都要有迹可循，这个是工程的核心，都要有可靠资料做支撑，做详细的标注」。本文第 1 节把这条落成强制规范。

> ### ⚠️ 读者必读：403 归因与 P0-1 的 2026-11-06 裁决（本文正文为 11-05 快照）
> 本文 §4.3 归因段、§5.1 P0-1、§6 风险表、§8 E 级清单及续研附录「续-2」等处（**行号因后续插入已漂移，以下按章节名定位，不再逐行列号**）把 403 归因于「DSH 2.8.4 的代理/**TLS 指纹**链路」、称「确切产生点未抓包 [E]」、并把 P0-1 表述为「升 2.8.8 以取得 2.8.5 TLS 指纹 sidecar」——这是 **2026-11-05 的推断快照**，保留为过程记录，**最终口径以下列裁决为准**（[REPORT.md](REPORT.md) 执行摘要 3 / §5、[08 附录 A.2](08-own-repo.md)、[11 裁决附录](11-traceability-audit.md) 裁决 2）：
> - **403 的可复现真因** = 本机 2.8.4 `lib/util/egress-fetch.js:276` `delete headers["host"]`，`httpsViaConnect` 不补 Host → CONNECT 隧道里 HTTPS 请求缺 Host 头被 Cloudflare 拒。Lead 最小 A/B：同一通道/同一 `node:https`/OpenSSL 栈/同一 UA，**唯一变量 Host 头** → `WITHOUT Host: 403` / `WITH Host: 200`；08 的 12 组实验（改 ALPN 仍 403、仅补 Host 即 200）独立互证 ⇒ **TLS/JA3 指纹归因已证伪**，2.8.5 CHANGELOG 的 JA3 只是作者当时的假设。
> - **2.8.8 仍删 Host**，无 forwarder 时同样 403；当前进程已设 `DSH_EGRESS_FORWARDER`/`_PROXY` 但 2.8.4 代码不认识它（关键字计数 0）。
> - ⇒ **P0-1 修正为**：「升 2.8.4 → 2.8.8（至少 2.8.6）**且** sidecar 可达 + `DSH_EGRESS_FORWARDER_PROXY` 已配」，**单升版本不够**；另需先处理 open 的 [PR #7](https://github.com/240xu/dsh-websearch/pull/7)（settings inert on DSH 0.2.x）/ [Issue #8](https://github.com/240xu/dsh-websearch/issues/8)（存不了 API Key）⇒「升级即修复」继续标 E。零部署依赖的 E 级备选：补 `headers.host ?? target.host`。
> - **仍 E**：CF 具体 WAF 规则编号、`forwarderFor` spec 与 sidecar 逐字段一致性、升级后是否恢复。**本文其余结论（网关非搜索后端、tavily 不重复、P1/P2 清单、12 条并入项）不受影响，全部有效**。

---

## 1. 证据规范（强制，本文每条结论都遵循）

### 1.1 统一证据等级

| 等级 | 定义 | 标注形式 |
|---|---|---|
| **A** | 源码实证：远端 GitHub **永久链接（带 ref/tag/sha）** 或本地 `路径:行号` | `[A] <URL#行号>` 或 `[A] /path/file:line` |
| **B** | 官方文档（websearch.mdx / console/websearch.mdx / 网关 README） | `[B] <URL>`（带 ref） |
| **C** | 版本记录：CHANGELOG / npm version / tag / commit sha / issue | `[C] <出处 + 版本号/sha>` |
| **D** | 本机实测：`curl` / `npm view` / `ps` / `ss` / 文件读取的原始输出 | `[D] <命令与结果摘要 + 时间>` |
| **E** | 推断或待核实，**必须显式标注，不得当结论** | `[E] <缺口说明>` |

### 1.2 并入清单强制格式

第 5 节 P0/P1/P2 每一条「改动」都写成表格行，五列缺一不可：**改动 → 依据(B/C，含 URL 或 commit) → 代码落点(A：新增/修改哪个 backend 文件、Config 字段、测试文件) → 验证方式(D：keyless 实跑命令 / 429 轮转测试 / 回归 spec) → 风险与回滚**。缺任一项标 `[E]` 并写明缺口。

### 1.3 永久链接规则

- anomalyco/opencode 一律用 **tag `v2.2.5`**（sha `9bbb8ce18c80f099e0e448775f59d965ead40a21`，已核实为 commit 类型）或 **dev 固定 sha `ffe6fed58334d921f64a86a8d86128bff5a4b566`**；不用浮动 `dev`/`main` 当依据。
- 用户仓库 `240xu/dsh-websearch` 用 `main` 或 commit sha；本机安装包视为「本地副本」单独标注路径。
- 私有仓库 `240xu/opencode-zen-gateway` 用 `master`。
- **禁止**凭记忆写端点/字段/版本；未 fetch 到原文的标「未取到，待核实」。

### 1.4 版本链（不混用，逐项标证据）

| 版本 | 是什么 | 证据 |
|---|---|---|
| **2.8.4** | **本机 profile 实际安装** | `[D] /home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/package.json` → `"version": "2.8.4"`；本机 `lib/` 无 `describe-error.js` / `failure-label.js`，`ddg.js` 是 POST 且无 forwarder（`[A] diff -rq` 结果见 §4.4） |
| **2.8.8** | **npm registry 最新**（`dist-tags.latest`） | `[D] npm view @240xu/dsh-websearch version` → `2.8.8`；`npm view ... versions` 末尾 12 项含 `2.8.5…2.8.8`；`dist.integrity sha512-sgDi0AMMAT0QCQodqZsbbstzTegDm6KfUSlsCNPORpPM773eUm+SNaSD02G1LJJK0OOg7WeOJJ2DKRp6e7nfSw==`；tarball 已下载解包到 `/tmp/npm288/` 并逐文件 diff |
| **2.8.6** | **远端 CHANGELOG 最后一条** | `[C] https://raw.githubusercontent.com/240xu/dsh-websearch/main/CHANGELOG.md` 首段 `## 2.8.6 - 2026-10-18`；`grep '## 2.8.[78]' CHANGELOG.md` 无命中 → **2.8.7/2.8.8 无 CHANGELOG 条目** `[C]` |
| **2.8.5** | TLS 指纹 sidecar 引入版 | `[C] 同上 CHANGELOG.md` `## 2.8.5 - 2026-10-18` |
| **v2.2.5** | OpenCode 参考 tag | `[C] https://api.github.com/repos/anomalyco/opencode/git/ref/tags/v2.2.5` → sha `9bbb8ce18c80f099e0e448775f59d965ead40a21`；本地 checkout `/home/ova/dsh/.artifacts/refs/opencode-v2` HEAD 同为 `9bbb8ce` `[D] git log -1` |
| **dev HEAD** | 官方仓库当前 | `[C] https://api.github.com/repos/anomalyco/opencode/commits/dev` → `ffe6fed58334d921f64a86a8d86128bff5a4b566`，2026-11-04T07:20:08Z |

**重要版本结论**：`2.8.4 → 2.8.8` 之间并非只有 CHANGELOG 记录的改动。2.8.8 tarball 相对本机 2.8.4 的差异文件为 `ddg.js / exa.js / parallel.js / searxng.js / index.js / provider.js / egress-fetch.js / mcp-client.js`，且**新增** `util/describe-error.js`、`util/failure-label.js`（`[D] diff -rq`，见 §4.4）。因此「升级到 2.8.8 一定包含 2.8.5/2.8.6 修复」是可验证的：2.8.8 的 `egress-fetch.js` 含 `DSH_EGRESS_FORWARDER` 与 sidecar `POST /fwd` 实现（`[A] /tmp/npm288/lib/util/egress-fetch.js:14-31,142-155`），`ddg.js` 已改 GET 且注释说明 POST 被 bot wall 拒（`[A] /tmp/npm288/lib/backends/ddg.js:34-43`）。`[E]` 2.8.7/2.8.8 的具体改动**未取到 CHANGELOG 原文**，只能以 tarball diff 为证，不能声称知道其全部语义。

---

## 2. 本地 opencode2api / 私有网关只读核查

### 2.1 进程与配置（D 级实测，未改配置、未重启）

- `[D] ps aux | grep '[o]pencode2api'` → `root 1870 ... /opt/oc2api/opencode2api_v1.4.4_linux_amd64/opencode2api -config /opt/oc2api/config.json`；`/proc/1870/cmdline` 逐字确认 `-config /opt/oc2api/config.json`。
- `[D] ss -tln | grep 18090` → `LISTEN 127.0.0.1:18090`；另有 `127.0.0.1:18081`（WebUI）。
- `[D] /opt/oc2api/config.json`（读取时已对 `server_keys` 等做脱敏展示）：`listen: "127.0.0.1:18090"`、`anonymous: true`、`zen_keys: []`、`go_keys: []`、`prefer: "go"`、`models.free_only: true`、`upstream: {zen: https://opencode.ai/zen, go: https://opencode.ai/zen/go, anonymous: https://opencode.ai/inference}`、`retry.max_attempts: 6 / timeout_seconds: 120`、`performance.free_tier_block_seconds: 900`、`proxyfile: /opt/oc2api/proxies.txt`、`webui.listen: 127.0.0.1:8081`。
- `[E]` `opencode2api_v1.4.4_linux_amd64/` 目录权限 `drwx------ UNKNOWN`，当前 dsh 用户**不可读**（`ls` 报 Permission denied）；因此 v1.4.4 二进制的 `strings` **未取到**。以下端点表取自同目录可读的 **v1.4.3** 二进制与 README，并已用本机 HTTP 探测交叉验证。v1.4.4 是否与 v1.4.3 端点完全一致 → **未取到，待核实**。

### 2.2 暴露端点（A/D 级）

`[A] /opt/oc2api/opencode2api_v1.4.3_linux_amd64/README.md:112-120`「API usage」表逐字：

| Method | Path | 说明 |
|---|---|---|
| GET | `/v1/models` | 当前配置可路由的模型 |
| POST | `/v1/chat/completions` | Chat Completions（OpenAI 兼容） |
| POST | `/v1/responses` | Responses（OpenAI） |
| POST | `/v1/messages` | Anthropic Messages |
| POST | `/v1/systemone` | System One 结构化决策 |
| GET | `/healthz` | 就绪与资源摘要 |

鉴权：`Authorization: Bearer <server_key>` 或 `x-api-key: <server_key>`；`server_keys` 仅用于客户端→网关，**不上游透传**（`[A] README.md:110`）。`anonymous: true` 时上游用 OpenCode `public` 凭据（`[B] 私有网关 README.md` 架构段）。

`[D]` 本机只读 GET 探测（2026-11-04）：`/v1/models → 401`（探测 key 无效）、`/v1/chat/completions → 405`、`/v1/messages → 405`、`/healthz` 在 v1.4.3 README 有但本机 `/health → 404`；405 说明 POST 路由存在且拒绝 GET。**结论：网关进程活着、OpenAI/Anthropic 兼容路由已注册**。`[E]` 未用有效 key 做真实推理，未验证响应体转换细节。

`[A] README.md:12` 能力清单：「Text, images, reasoning, **function tools, tool calls, and tool results**; file content where the target protocol can represent it」→ 工具调用/结果在三种协议间做转换。

### 2.3 与 web_search 相关的二进制字符串（D 级，来自可读的 v1.4.3）

`[D] strings /opt/oc2api/opencode2api_v1.4.3_linux_amd64/opencode2api`：
- `web_search_20260209`（Anthropic-style server tool 名）
- `web_fetch_20250910`、`web_fetch_20260209`、`web-fetch-2025-09-10`
- `web_fetch_20250305` 的对应字符串未单独命中；`text_editor_20241022/20250124/20250429`、`computer_20241022/20250124/20251124`、`code-execution-2025-05-22/2025-08-25` 等 tool 名
- 路由字符串 `POST /v1/chat/completions`、`POST /v1/messages`、`POST /v1/responses`、`POST /v1/systemone`、`GET /v1/models`、`GET /healthz`、`GET /api/logs`、`POST /api/auth/login`、`GET /api/rotation`、`PUT /api/rotation`、`GET|DELETE /api/api-keys`、`POST /api/debug/inference`
- 正则 `/v1/(chat/completions|responses|messages|systemone)` 与 `utls`/`uTLS`/`ClientHello` 相关字符串（TLS 指纹伪装，与私有仓库 README 的 gate 结论一致）

`[E]` 这些字符串只证明二进制**识别/转换**这些 tool 名，**不能证明**网关自己执行 web_search 或提供搜索端点；`/opt/oc2api/oc2.log` 中 `web_search|websearch` 命中数为 0，日志里出现的路由只有 `"/v1/chat/completions"`。`[E]` 网关是否把 `web_search_20260209` 透传到上游 OpenCode Zen 模型并回传 server-tool 结果 → 未取到源码，待核实（二进制无源码）。

### 2.4 私有仓库 240xu/opencode-zen-gateway（B/C 级）

`[C] https://api.github.com/repos/240xu/opencode-zen-gateway` → `private: true`、`default_branch: master`、desc `Self-hosted OpenCode free-tier gateway: opencode2api (Go) + Mihomo 802-bucket egress pool. Documents the 2026-10-24 gate finding (Go 1.24 TLS fingerprint vs 403 FreeTierError)`、`pushed_at 2026-10-25T01:09:25Z`。仓库树仅 `.gitignore / LICENSE / README.md(6100) / config.example.json(1417) / scripts/doctor.sh / scripts/sync-proxies.py / systemd/oc2api.service`，**无网关源码**。

`[B] https://raw.githubusercontent.com/240xu/opencode-zen-gateway/master/README.md` 与搜索/并入相关的要点：
- gate 结论（2026-10-24 交替 3 轮实测）：同一出口桶、同一模型、同一时刻，`opencode2api(Go 1.24.13)` 得 **429 `FreeUsageLimitError`（通过 gate）**，而 `curl / Bun / Go 1.15` 及浏览器 TLS 伪装全部 **403 `FreeTierError`（被 gate 拦）**；门禁「不看请求头/路径/请求体，而是看 **TLS + HTTP 层形态**」。→ 与 Lead 实测的 `MCP initialize HTTP 403`（HTML 403）**同源不同层**：这里指模型推理上游，DSH 侧是搜索上游，但都指向 TLS 指纹。
- 版本要求：v1.4.1 无指纹伪装；v1.4.2 新增 TLS/HTTP 指纹伪装；**v1.4.3 推荐**（匿名通道优先 `/inference`，失败回退 `/zen`），且 `/inference` 形态对齐 OpenCode 2.0.32。systemd 单元 `ExecStart=/opt/oc2api/opencode2api_v1.4.3_linux_amd64/opencode2api -config /opt/oc2api/config.json`（`[A] systemd/oc2api.service`）——与当前实跑的 **v1.4.4** 路径不同，说明本机已手工升级过 `[D]`，仓库文档滞后 `[E]`。
- 架构：`客户端 → /v1/chat/completions → opencode2api(127.0.0.1:18090, Go) → Mihomo 802 桶(127.0.0.1:17895-18743) → https://opencode.ai/inference/v1/chat/completions`；匿名 lane `Authorization: Bearer public`，每个代理试 1 次、共享 timeout。
- 配额：**per-IP + 分钟窗口**；802 桶全打满都是 429；`429` 无 `Retry-After` = 分钟级，有 `Retry-After: 7xxxx` = 小时级耗尽；status `429=过了 gate / 403=被 gate 拦(TLS 指纹不对) / 000=代理不可用`。
- 公网入口 `oc2.sepic.space → http://127.0.0.1:18090`（Cloudflare Tunnel，HK `d2bf3896`）；接入 OpenCode 用 `baseURL: https://oc2.sepic.space/v1` + `apiKey: <server_key>`，`@ai-sdk/openai-compatible` provider。
- 已验证免费模型 8 个（beam-free、big-pickle、deepseek-v4.1-flash-free、flint-40b-free、glm-5.3-flash-free、mimo-v2.6-flash-free、nemotron-3.5-lightning-free、nemotron-3.5-super-vl-free）。

`[A] config.example.json` 与本机 `config.json` 结构一致（rotation/listen/server_keys/upstream/retry/models/performance/logging/webui），本机 `prefer:"go"`、`warp:{enabled:false}`、`reasoning.effort:"high"` 是私有仓库 example 里没有的字段 `[E]`（可能是 v1.4.4 新增，未取到 v1.4.4 文档，待核实）。

### 2.5 与 DSH 搜索并入的关系（边界澄清）

- 网关是**模型推理协议转换器**（OpenAI/Anthropic/Responses/SystemOne ↔ OpenCode Zen），**不是搜索后端**：仓库与二进制中都没有 `/api/websearch`、`/v1/websearch` 之类的搜索路由 `[D]`（端点表 + strings 路由清单）。
- 它能做的与搜索相关的事：把客户端携带的 `web_search_20260209` / `web_fetch_*` server tool 定义与 tool_result 在三种协议间转换（`[A] README.md:12` + `[D] strings`）。`[E]` 是否真能驱动上游原生搜索，未验证。
- `[B] /home/dsh/.dsh/automation/prompts/websearch-polish.md` 明确给出**硬约束**：「Never call `web_search` yourself expecting it to work — it is broken tonight；The used endpoint/model combination on that gateway also does not actually perform server-side search: sending `tools: [{type: "web_search_20250305", ...}]` to `https://ai.furry.vg/v1/messages` with `selfdeploy/deepseek-v4-flash` returns a normal completion that says it cannot search. **So pointing `web-search-deepseek.baseURL` at the gateway would silently produce non-searching "answers" — do not take that path.**」→ 并入清单里**禁止**把 DSH 搜索指向网关替代真实 provider（与 §5 风险列一致）。
-  rehearsal 报告 `[A] /home/dsh/.dsh/automation/reports/2026-11-04-rehearsal.md:1-24` 的 citation legend（`OC-C/OC-T/OC-S/OC-PE/OC-PP`）与本文 v2.2.5 永久链接可一一对应；其「Three highest-value changes」建议的是 DSH 官方 provider 的诊断文案改进，**不是**网关替代，本文并入清单遵循同一约束。

---

## 3. 交叉参考：rehearsal 报告的 DSH↔OpenCode 差距（A 级，指向 v2.2.5 永久链接）

`[A] /home/dsh/.dsh/automation/reports/2026-11-04-rehearsal.md` 逐条对比表（节选与并入相关的行，代号换成永久链接）：

| 维度 | DSH 现状（rehearsal 结论） | OpenCode v2.2.5 | 并入价值 |
|---|---|---|---|
| Provider 选择 | 静态一个 configured id 或恰好一个可用；多可用抛 `WEB_PROVIDER_AMBIGUOUS` | `Selection = ID \| "random" \| false`，KV `websearch:provider` 持久化（`[A] v2.2.5/packages/core/src/websearch.ts:31-32,137-140`） | P1：random + 429 轮转 |
| 429 降级 | 单次尝试、无重试/冷却 | `query()` 循环：仅 `random` 且 `HttpClientError.status===429` 才换 provider，`retry-after`/60s 冷却（`[A] 同文件:196-216,222-228`） | P1 |
| 首次同意/选择器 | 无 | `forms.ask` chooser + semaphore + 1min timeout（`[A] v2.2.5/packages/core/src/tool/plugin/websearch.ts:64-146`） | P1（DSH 需映射到自身权限/设置面） |
| 权限 | 无 per-call | `permission.assert({action:"websearch", resources:[input.query], ...})`（`[A] 同文件:49-55`） | P1 |
| 工具移除 | `search?: boolean` 配置开关 | session hook 里 `delete event.tools[name]`（`[A] 同文件:184-193`） | P1 |
| provenance | `WebSearchResult` 无 provider 身份 | `Response={providerID,results}` + `metadata.provider`（`[A] v2.2.5/packages/schema/src/websearch.ts:35-38`） | P2：DSH 遥测行已有雏形 |
| wire 结果校验 | `as` 断言 | `Schema.decodeUnknownEffect(Schema.Array(Result))`（`[A] v2.2.5/packages/core/src/websearch.ts:92,204`） | P2 |
| 多 query | **DSH 更强**：`queries[]` 1–4 并发 + round-robin 合并 | 单 `query` | **保留，不并入** |
| untrusted 标注 | **DSH 更强**：每条结果 `EXTERNAL_WEB_CONTENT_NOTICE` | 无 | **保留，不并入** |

`[B] /home/dsh/.dsh/automation/prompts/websearch-polish.md` 的「What to produce tonight」要求：在 worktree 里实现「provider-registry-shaped seam」或渲染改进之一、加一个 keyless provider（DDG/SearXNG，**默认禁用**、fixed fixture 测试、无 live network）、Config 可从 cordis.yml 改、narrow checks、≤3 commits、报告落 `/home/dsh/.dsh/automation/reports/`。本文的 P0/P1/P2 清单把这套「可评审、有证据、keyless 默认关」的工程纪律搬到用户自研插件上。

---

## 4. DSH 侧现状（并入的代码落点基线）

### 4.1 本机安装版 2.8.4 的结构（A 级）

`/home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/`（下称 `DSH/`）：
- `[A] DSH/lib/index.js:54-98` `BACKENDS` 11 项、`DEFAULT_ENABLED=["exa","parallel","ddg","searxng"]`、`DEFAULT_BASE_URLS`；`:133-241` `Config`（`numResults/concurrency/backendTimeoutMs/recency/language/safeSearch/dedupStrategy/rerank/resultTelemetry/cache*/breaker*/historyEnabled/multiQueryEnabled/deepCoverage/enableXxx 11 个/×ApiKeyEnv/×BaseURL/×Model/tavilySearchDepth/enabledBackends`）；`:281-373` `resolveOptions`；`:432-448` `createUnifiedSearchProvider` + `ctx.web.registerSearchProvider`。
- `[A] DSH/lib/provider.js:187-494` 扇出、`shapeQuery`、缓存、`createLimiter(concurrency=6)`、`Promise.allSettled`、软失败、`dedupeSources`/`rerankSources`、RRF、`resultHeader`、遥测行、all-fail 抛错；`:38-47` `BACKEND_TIMEOUT_OVERRIDES_MS={ddg:5000,searxng:5000}`。
- `[A] DSH/lib/breaker.js`（连续 3 次失败→60s 冷却、fail-open）、`cache.js`（TTL 900s）、`history.js`（环形 50 条）、`health.js`（只读路由）、`prompting.js`（shapeQuery/resultHeader/QUERY_GUIDANCE/TELEMETRY_TAG）、`rrf.js`（RRF_K=60）、`multiquery.js`、`trust.js`（HTTP 路由信任围栏）、`util/rank.js`（URL/url+title 去重 + 确定性 rerank）、`util/egress-fetch.js`（HTTP_PROXY CONNECT 隧道，2.8.4 版**无 forwarder**）、`util/mcp-client.js`（3-step handshake + `Mcp-Session-Id` 10min 缓存）。
- `[A] DSH/lib/backends/`：10 个文件（exa/parallel/ddg/searxng/brave/tavily/serper/mojeek/anthropic-like/openai），11 个后端中的 deepseek/anthropic 共用 `anthropic-like.js`。
- `[A] DSH/cordis.patch.yml`：`insert id=dsh-websearch` + `- id: web, config: {searchProvider: unified}`。

### 4.2 「opencode 同源」到底同源在哪（A/D 级，09/09b 已展开，此处只给并入结论）

`[A] DSH/lib/backends/exa.js:14,40-63` 与 `[A] https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/exa.ts#L9`：端点同为 `https://mcp.exa.ai/mcp`，tool 同为 `web_search_exa`，参数同为 `{query,numResults}`，返回同为文本块 `Title:/URL:/Published:/Highlights:`（OpenCode v2.2.5 用 `/\n\n---\n\n/` 切块解析；DSH 2.8.4 用同类正则）。
`[A] DSH/lib/backends/parallel.js:21,30-51` 与 `[A] v2.2.5/packages/core/src/plugin/websearch/parallel.ts#L10`：端点同为 `https://search.parallel.ai/mcp`，tool 同为 `web_search`，参数 `objective/search_queries[/session_id/model_name]`，返回 `{search_id,results:[{url,title,publish_date,excerpts[]}]}`。
→ **同源 = 同一 MCP 服务端点 + 同一 tool 名 + 同一参数/响应形状**；差异只在客户端：DSH 自建 `mcp-client.js`（initialize→initialized→tools/call + session 缓存 + `egress-fetch` 代理），OpenCode v2.2.5 用 `mcp.ts` 的 `WebSearchMcp.call`（**只发 `tools/call`、无 initialize**，`MAX_RESPONSE_BYTES=256*1024`、25s timeout，`[A] v2.2.5/packages/core/src/plugin/websearch/mcp.ts:7-68`）。`[A] https://github.com/240xu/dsh-websearch/blob/main/README.md#L20-L21` 用户 README 自己标注「opencode 同源、无 key」，即指此。

### 4.3 关键实测：端点可用，403 是 DSH 链路问题（D 级，来自 Lead 一手实测）

`[D] /home/ova/dsh/.artifacts/websearch-research/00-lead-live-probe.md`（2026-11-04，只读 MCP initialize/tools/list/一次真实 tools/call，未用密钥）：
- 本机经 `HTTP_PROXY=http://172.30.66.1:1091` **直连 4 个 MCP 端点全部 HTTP 200**：`mcp.exa.ai/mcp`（SSE）、`search.parallel.ai/mcp`（纯 JSON）、`mcp.firecrawl.dev/v2/mcp`（SSE）、`agent.tinyfish.ai/mcp`（纯 JSON）。TinyFish keyless 需 `X-TinyFish-Access-Mode: keyless`。
- **Parallel 真实 `tools/call` 返回有效结果**（`search_id` + 2 条 `url/title/excerpts`，其中一条命中 `opencode.ai/v2/docs/console/websearch`）。
- Firecrawl hosted keyless sessions 暴露 `firecrawl_search`/`firecrawl_scrape`/`firecrawl_parse`（有用量限制），`firecrawl_search` 支持 `categories:["developer"|"gov"|"research"]`，成功结果带 `conversationId` 需回传。
- TinyFish 限流：**30 requests/min + 50 searches per UTC day**（serverInfo instructions 原文），tool `search` 的 inputSchema 含 `purpose`（「Used to better rank results against your intent」）、`location/language/include_domains/exclude_domains/domain_type/after_date/before_date/recency_minutes/page`。
- 对照 DSH 实跑错误：「`unified search: all enabled backends failed (4)` — exa/parallel: `MCP initialize HTTP 403 <html>403 Forbidden</html>`；ddg: `redirect mode is set to error (301)`；searxng: `invalid JSON response`」。

`[D]` 归因（⚠️ 本段为 11-05 推断快照，TLS/JA3 部分已被文首裁决证伪，保留为过程记录）：① curl 直连同端点 200 而 DSH 客户端 403 → 不是端点故障（**此条仍成立**）；② CHANGELOG 2.8.5 的 JA3 归因（**仅为作者当时的假设**）；③ CHANGELOG 2.8.6 的 dispatcher/hijack 复盘（**版本事实仍成立**）。本机 2.8.4 早于两者 → 初版写作「403 归因于 DSH 2.8.4 的代理/TLS 指纹链路」。**最终口径**：可复现真因是 `egress-fetch.js:276` 删 `Host` 头 → CONNECT 隧道缺 Host 被 Cloudflare 拒（`WITHOUT Host: 403` / `WITH Host: 200`），与 TLS 指纹无关；见文首「读者必读」框与 [REPORT.md](REPORT.md) 执行摘要 3。
`[E]`（⚠️ 已由 A/D 级定位取代，见文首裁决框）：403 初版写作「确切产生点未抓包定位，属推断」；最终已定位为缺 Host 头，仍 E 的只剩 CF WAF 规则编号与升级后是否恢复。「升级后一定修好」仍未证明（未做升级，且 2.8.8 仍删 Host、PR #7 / Issue #8 未修）。

### 4.4 2.8.4 → 2.8.8 差异实测（D 级）

`[D] diff -rq DSH/lib /tmp/npm288/lib`（2.8.8 tarball 解包自 `[C] npm dist.tarball https://registry.npmmirror.com/@240xu/dsh-websearch/-/dsh-websearch-2.8.8.tgz`）：
```
Files .../backends/ddg.js and .../ddg.js differ
Files .../backends/exa.js and .../exa.js differ
Files .../backends/parallel.js and .../parallel.js differ
Files .../backends/searxng.js and .../searxng.js differ
Files .../index.js and .../index.js differ
Files .../provider.js and .../provider.js differ
Files .../util/egress-fetch.js and .../egress-fetch.js differ
Files .../util/mcp-client.js and .../mcp-client.js differ
Only in /tmp/npm288/lib/util: describe-error.js
Only in /tmp/npm288/lib/util: failure-label.js
```
`[A] /tmp/npm288/lib/util/egress-fetch.js:14-31,142-155` 含 `DSH_EGRESS_FORWARDER` / `DSH_EGRESS_FORWARDER_PROXY` / `POST /fwd` sidecar 与「不走全局 dispatcher」注释；`[A] /tmp/npm288/lib/backends/ddg.js:34-43` 已是 GET + bot-wall 注释；`[A] /tmp/npm288/lib/util/mcp-client.js:3-14` 仍为 3-step handshake + 10min TTL。**2.8.8 的 `lib/backends/` 仍是 10 个文件、无 firecrawl/tinyfish** `[D]` → 升级不能带来新后端，新增必须自行写。

### 4.5 端点总表（并入视角：URL × provider × 协议 × 鉴权 × 谁调用 × 证据）

> 与 09 的「逐字段」表互补：本表只回答「并入时谁已经调、谁要新增、谁不能当搜索后端」。证据列全部带 ref。

| URL | provider / 服务 | 协议 | 鉴权 | 谁调用 | 并入动作 | 证据 |
|---|---|---|---|---|---|---|
| `https://mcp.exa.ai/mcp` | exa | MCP streamable-http（SSE） | `EXA_API_KEY`（可选；keyless 可用，key 走 `?exaApiKey=`） | OpenCode v2 原生 + **DSH unified 已有** | 复用；P2-1 统一 MCP 客户端 | `[A] v2.2.5/plugin/websearch/exa.ts:9,37`；`[A] DSH/lib/backends/exa.js:14`；`[D] probe` 200 |
| `https://search.parallel.ai/mcp` | parallel | MCP streamable-http（JSON） | `PARALLEL_API_KEY`（可选；keyless 可用，Bearer） | OpenCode v2 原生 + **DSH unified 已有** | 复用；P2-1 统一 MCP 客户端 | `[A] v2.2.5/plugin/websearch/parallel.ts:10,73`；`[A] DSH/lib/backends/parallel.js:21`；`[D] probe` 200 + 真实 tools/call |
| `https://mcp.firecrawl.dev/v2/mcp` | firecrawl | MCP streamable-http（SSE） | `FIRECRAWL_API_KEY`（Bearer）/ **hosted keyless tier** | **仅 OpenCode v2 原生**；DSH 无 | **P0-2 新增 backend** | `[A] v2.2.5/plugin/websearch/firecrawl.ts:10,55`；`[D] probe` 200 + `firecrawl_search` |
| `https://api.tavily.com/search` | tavily | REST POST | `TAVILY_API_KEY` Bearer / `X-Tavily-Access-Mode: keyless` | OpenCode v2 原生 + **DSH unified 已有 REST 版** | **不新增**（§5.4）；keyless 头 `[E]` P2 候选 | `[A] v2.2.5/plugin/websearch/tavily.ts:9,43-46`；`[A] /tmp/dsh-tavily.js:13,25-30` |
| `https://agent.tinyfish.ai/mcp` | tinyfish | MCP streamable-http（JSON） | `X-API-Key` / 无 key 时 `X-TinyFish-Access-Mode: keyless` | **仅 OpenCode v2 原生**；DSH 无 | **P0-3 新增 backend** | `[A] v2.2.5/plugin/websearch/tinyfish.ts:11,62,64-72`；`[D] probe` 200 + 30/min、50/day |
| `https://html.duckduckgo.com/html/` | ddg | HTML scrape | 无 | DSH unified 独有（v2 无） | P0-1 升级自带 GET 修复 | `[C] CHANGELOG 2.8.5/2.8.6`；`[A] /tmp/npm288/lib/backends/ddg.js:34-43` |
| `https://searx.be/search`（可配） | searxng | REST JSON | 无/可选 | DSH unified 独有 | P0-1 升级自带语义健康 + `searxngBaseURLs` `[E]` | `[A] DSH/lib/index.js:90`；`[C] CHANGELOG 2.8.6` |
| `https://api.search.brave.com/res/v1/web/search` 等 6 个 REST | brave/serper/mojeek/deepseek/anthropic/openai | REST / Messages / Responses | 各 `*_API_KEY` | DSH unified 独有 | 保留 | `[A] DSH/lib/index.js:86-98` |
| `http://127.0.0.1:18090/v1/{chat/completions,responses,messages,systemone,models}` | opencode2api 网关 | HTTP（OpenAI/Anthropic/Responses 兼容） | `server_keys` Bearer / `x-api-key` | 本机模型推理客户端 | **不可当搜索后端**（§2.5） | `[A] v1.4.3/README.md:110-120`；`[D] ps/ss/GET 探测` |
| `https://opencode.ai/inference/v1/chat/completions` | OpenCode Zen 匿名上游 | HTTPS | `Authorization: Bearer public` | opencode2api 网关 | 与搜索并入无关 | `[B] 私有网关 README.md` 架构段 |
| `GET /api/websearch/provider` · `POST /api/websearch` | OpenCode v2 server 自身 | HTTP API（location-scoped） | 宿主 connection | OpenCode v2 客户端 | 不移植（DSH 已有 `/api/websearch/history`、`/api/unified-search/health`） | `[A] v2.2.5/protocol/src/groups/websearch.ts:10-40` |

---

## 5. 核心交付：P0 / P1 / P2 并入清单

> 每条都是「表格行」五列齐全；依据列给 B/C 级 URL（带 ref），代码落点给 A 级路径，验证给 D 级命令，风险与回滚一并给出。凡未取到原文处标 `[E]`。
> 通用前置：`[A] DSH/cordis.patch.yml` 已把 `searchProvider: unified`，所有新增后端都注册进同一个 `unified` provider，不新增 `ctx.web` provider（避免 `WEB_PROVIDER_AMBIGUOUS`）。
> 通用验证环境（D）：`HTTP_PROXY/HTTPS_PROXY=http://172.30.66.1:1091`，`NO_PROXY=127.0.0.1,localhost,::1,[::1]` `[D] env`；复现命令见 `[D] 00-lead-live-probe.md:6`。

### 5.1 P0 — 先让搜索可用（升级 + 两个 keyless 新后端）

| # | 改动 | 依据（B/C，含 URL 或 commit） | 代码落点（A：文件/Config 字段/测试） | 验证方式（D） | 风险与回滚 |
|---|---|---|---|---|---|
| **P0-1**〔⚠️ 动作列口径已由文首裁决框修正：单升版本不够，须同时配 sidecar + `_PROXY`，且先处理 PR #7 / Issue #8〕 | 把 `@240xu/dsh-websearch` 从 **2.8.4 升到 2.8.8**（至少 2.8.6），取得 2.8.6 forwarder 修复；**最终动作**：升级 **且** sidecar 可达 + `DSH_EGRESS_FORWARDER_PROXY` 已配（2.8.8 仍删 Host，无 forwarder 时同样 403） | `[C] https://raw.githubusercontent.com/240xu/dsh-websearch/main/CHANGELOG.md` `## 2.8.5 - 2026-10-18`「optional TLS-egress forwarder…some upstreams gate on the client TLS fingerprint (JA3)」与 `## 2.8.6 - 2026-10-18`「sidecar forwarder hop now speaks `node:http(s)` directly…killing every search」；`[C] npm view @240xu/dsh-websearch version` → `2.8.8`，`dist-tags.latest=2.8.8`；`[D] 00-lead-live-probe.md:4` 403 归因 | `[A] /home/dsh/.dsh/profiles/web/package.json` 的 `dependencies."@240xu/dsh-websearch": "2.8.4"` → `"2.8.8"`，`pnpm install`；不改 `cordis.patch.yml`；可选新增 env `DSH_EGRESS_FORWARDER`/`DSH_EGRESS_FORWARDER_PROXY`（`[A] /tmp/npm288/lib/util/egress-fetch.js:47-50`，仅当 sidecar 已部署时才设） | ① `npm view @240xu/dsh-websearch@2.8.8 dist.integrity`（本次已得 `sha512-sgDi0…`）；② 升级后 `node -e "console.log(require('…/package.json').version)"` = 2.8.8；③ 重跑 `web_search({queries:["…"]})` 观察 exa/parallel 是否仍 `403`；④ `curl -sS -m 20 -X POST https://mcp.exa.ai/mcp -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}'` 应 200（probe §6） | 风险：`[C] CHANGELOG` 只到 2.8.6，2.8.7/2.8.8 **无 CHANGELOG 条目** `[E]`，语义只能靠 tarball diff 核对；`[E]` 升级后 403 是否消失未实测（probe §7 明确未证明）；v1.4.4 私有目录不可读，与 profile 的兼容未核。回滚：`package.json` 改回 `2.8.4` + `pnpm install`；`DSH_EGRESS_FORWARDER` 不设时 2.8.8 行为「byte-identical」（`[C] 2.8.5` 原文） |
| **P0-2** | 新增 **`firecrawl` backend**（MCP `firecrawl_search`，hosted keyless tier） | `[B] https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/firecrawl.ts#L10`（`endpoint="https://mcp.firecrawl.dev/v2/mcp"`、`tool="firecrawl_search"`、`{query,limit}`、响应 `data.web[{url,title,description}]`）；`[D] 00-lead-live-probe.md:1,2` 本机 initialize HTTP 200 + hosted keyless sessions 暴露 `firecrawl_search`；`[B] https://github.com/anomalyco/opencode/blob/v2.2.5/services/www/src/docs/content/websearch.mdx` 五 provider 表列 `firecrawl` / `FIRECRAWL_API_KEY` | 新增 `[A] DSH/lib/backends/firecrawl.js`（复制 `exa.js` 骨架，改 `endpoint/tool/args/parse`）；`[A] DSH/lib/index.js:54-98` `BACKENDS` 加 `firecrawl: firecrawlBackend` + `DEFAULT_BASE_URLS.firecrawl`；`[A] DSH/lib/index.js:133-241` Config 加 `enableFirecrawl: z.boolean().default(false)`、`firecrawlBaseURL`、`firecrawlApiKeyEnv: z.string().role("credential-ref").default("FIRECRAWL_API_KEY")`；`DEFAULT_ENABLED` **不加**（默认关，符合 `[B] websearch-polish.md` 第 3 条）；`[A] DSH/lib/index.js:281-341` `resolveOptions` 透传；新增 `[A] DSH/tests/firecrawl.test.js`（固定 MCP 响应 fixture，无 live network） | ① `curl -sS -m 20 -X POST https://mcp.firecrawl.dev/v2/mcp -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"initialize",…}'` → 200（probe 已验）；② `tools/list` 确认 `firecrawl_search` 在 keyless session；③ `curl … tools/call` 用 probe §6 模板改 `name:"firecrawl_search",arguments:{"query":"…","limit":8}`；④ 单元 `node --test tests/firecrawl.test.js`；⑤ 在 Settings 打开 `enableFirecrawl` 后跑一次 `web_search` 看遥测行 `firecrawl ✓` | 风险：**Firecrawl 计费/用量限制**（`[D] probe §2`「Hosted keyless sessions…有用量限制」；`[E]` 具体额度未取到官方文档，待核实）；`conversationId` 必须回传（probe §2）——DSH 现有 `mcp-client.js` 的 session 缓存只存 `Mcp-Session-Id`，**不存 conversationId** → 需在 backend 内做 per-search 上下文，或首版只发单次调用并标注 `[E]`；`redirect:'error'` 需保留（`[A] DSH/lib/backends/exa.js` 既有风格 + `[B] packages/web/AGENTS.md`）。回滚：`enableFirecrawl=false` 或从 `BACKENDS` 移除 |
| **P0-3** | 新增 **`tinyfish` backend**（keyless header 降级，`X-TinyFish-Access-Mode: keyless`） | `[B] https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/tinyfish.ts#L11-L62`（`endpoint="https://agent.tinyfish.ai/mcp"`、`tool="search"`、无 key 时 `X-TinyFish-Access-Mode: keyless`、有 key 时 `X-API-Key` 且必须先 `initialize` 取 `Mcp-Session-Id`）；`[D] 00-lead-live-probe.md:1,2` HTTP 200 + `30 req/min / 50 searches per UTC day` + tool `search` inputSchema（`purpose` 可作排序信号） | 新增 `[A] DSH/lib/backends/tinyfish.js`（keyless 分支**跳过 initialize**，直接 `tools/call`；有 key 分支复用 `[A] DSH/lib/util/mcp-client.js` 的 `ensureSession`）；`[A] DSH/lib/index.js` 同 P0-2 加 `BACKENDS.tinyfish` / `DEFAULT_BASE_URLS.tinyfish` / `enableTinyfish(default false)` / `tinyfishBaseURL` / `tinyfishApiKeyEnv(default "TINYFISH_API_KEY")`；新增 `[A] DSH/tests/tinyfish.test.js`（keyless header 断言、50/day 计数不硬编码、fixture 解析） | ① `curl -sS -m 20 -X POST https://agent.tinyfish.ai/mcp -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -H 'X-TinyFish-Access-Mode: keyless' -d '{"jsonrpc":"2.0","id":1,"method":"initialize",…}'` → 200（probe 已验）；② `tools/call` `name:"search",arguments:{"query":"…"}`；③ `node --test tests/tinyfish.test.js`；④ 打开 `enableTinyfish` 跑 `web_search` 看遥测 `tinyfish ✓` | 风险：**50 searches/UTC day + 30 req/min 硬上限**，必须默认关 + 熔断计数；`[A] DSH/lib/breaker.js` 是「连续失败 3 次→60s」，与「每日配额」不同语义，需在遥测/health 里单列 `quota` 标签（P1-3）；`[E]` TinyFish 是否接受 DSH 的 `egress-fetch` CONNECT 隧道头透传未实测（probe 用裸 curl）。回滚：同上开关 |
| **P0-4** | **`ddg`/`searxng` 归因标注与兜底顺序**：`ddg` 301 是安全策略预期（拒绝重定向），`searxng` 非 JSON 是公共实例反爬，不作为「端点故障」计入并入评估 | `[B] /home/ova/dsh/packages/web/AGENTS.md:5`「Reject redirects on credential-bearing provider requests」；`[C] CHANGELOG 2.8.6`「SearXNG semantic health — HTTP 200 without results[] (anti-bot interstitial) no longer records as success」「opt-in SearXNG multi-instance failover (`searxngBaseURLs`)」「DDG timeout ceiling 5s→8s」；`[D] 00-lead-live-probe.md:4` | 不新增文件：升级后由 2.8.8 的 `[A] /tmp/npm288/lib/backends/ddg.js`（GET）、`/tmp/npm288/lib/backends/searxng.js` 自带；如需多实例，在 `[A] DSH/lib/index.js` Config 加 `searxngBaseURLs: z.array(z.string())` 并在 `resolveOptions` 透传（2.8.8 是否已含该字段 → `[E]` 未逐字段核对 tarball，待核实） | 升级后重跑 `web_search`，确认 `ddg` 不再 301、`searxng` 不再「记成功但无结果」；`[D] 00-lead-live-probe.md:4` 对照 | 风险低；回滚 = P0-1 回滚。`[E]` 2.8.8 是否完整含 2.8.6 的 `searxngBaseURLs` 未逐字段确认 |

### 5.2 P1 — 移植 v2 的选择/权限设计

| # | 改动 | 依据（B/C） | 代码落点（A） | 验证方式（D） | 风险与回滚 |
|---|---|---|---|---|---|
| **P1-1** | `random` 选择 + **429 `Retry-After`/60s 冷却轮转** + 失败换 provider（v2 `query()` 循环） | `[B] https://github.com/anomalyco/opencode/blob/v2.2.5/services/www/src/docs/content/websearch.mdx#Limits`（「429 → retries with another available provider…`Retry-After`, or 60 seconds」「every provider cooling down → fails immediately」「cooldowns are shared by sessions in the same workspace」）；`[A] https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/websearch.ts#L196-L228`（循环条件：`choice==="random" && HttpClientError && status===429`；`cooldownMillis()` 解析 retry-after 秒/HTTP-date，非法回退 60000）；`[A] /home/dsh/.dsh/automation/reports/2026-11-04-rehearsal.md` 对比表「Failure handling / failover」行 | `[A] DSH/lib/provider.js`（在 `fanoutVariant` 之前加 provider 级选择层；现有「后端扇出」是**后端级**并发，与 v2「provider 级轮转」不同层：建议把 `unified` 内部 11 后端当作 v2 的「providers」，复用 `cooldowns: Map<id,{until,error}>`、`attempted: Set<id>`、`randomProvider()`）；`[A] DSH/lib/index.js` Config 加 `providerSelection: z.union(["all","random"]).default("all")`（`"all"` 保持现有全扇出行为）、`cooldownMs: z.number().default(60000)`；`[A] DSH/lib/breaker.js` 扩展为「冷却 + 429 专属」；新增 `[A] DSH/tests/rate-limit-rotation.test.js`（假后端 A 返回 429 + `Retry-After: 2`，断言换到 B、A 在冷却期不被选、全冷却抛 `all enabled backends failed`） | ① `node --test tests/rate-limit-rotation.test.js`（无网络）；② 用本地假 HTTP server 返回 429 + `Retry-After: 1` 观察遥测行出现 `⏸cooled`/换后端；③ `[D] 00-lead-live-probe.md` 的 Parallel 实搜可当「成功路径」基线 | 风险：v2 只在 **429** 轮转，401/403 **不轮转**（`[A] v2.2.5/websearch.ts:208`，rehearsal 亦指出「verified rehearsal failure is 401, failover alone would not rescue」）→ 不要把 403 也当 429 处理，否则掩盖 P0-1 的 TLS 指纹根因；DSH 已有 `breaker.js`（连续 3 次→60s）语义不同，避免双冷却互相打架；`[E]` DSH 无 workspace 概念，`cooldowns shared by sessions in same workspace` 只能退化为「进程内共享」，差异需注明。回滚：`providerSelection:"all"` |
| **P1-2** | **session 记忆 provider**（`websearch:provider` KV 持久化） | `[A] https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/websearch.ts#L31`（`ProviderKey="websearch:provider"`）、`#L137-L140`（`kv.get` + 非法值 `kv.remove`）、`#L181-L183`（`select` 写 KV）、`#L191-L195`（`preferred` map 按 sessionID）；`[B] v2.2.5 websearch.mdx`「OpenCode remembers your choice for later sessions」「Each session keeps using its selected provider until that provider is rate limited」 | `[A] DSH/lib/settings-api.js` 或新增 `[A] DSH/lib/selection.js`（用 `[A] DSH/lib/cache.js` 已有的 `tmp+rename` 原子写模式落 `$DSH_HOME/cache/websearch/selection.json`，字段 `{selection, updatedAt}`）；`[A] DSH/lib/index.js` Config 加 `providerSelectionStore: z.boolean().default(false)`；`[A] DSH/lib/provider.js` 在 `search()` 入口读 selection、成功/429 后写回 | `node --test tests/selection.test.js`（写入 → 重读一致；非法值删除；并发写串行化——DSH `[A] history.js` 已有 promise 链模式可复用） | 风险：DSH 插件**刻意不扩展 SessionEventMap**（`[A] DSH/README.md:205`「session event vocabulary is a closed set third-party plugins must not extend」）→ 只能用文件/settings，不能加会话事件；`[E]` 多 session 并发写一致性未实测。回滚：开关关掉即读默认 |
| **P1-3** | **权限 `action=websearch, resource=query, effect=ask`** 与 **`websearch:false` 从模型请求移除工具** | `[B] https://github.com/anomalyco/opencode/blob/v2.2.5/services/www/src/docs/content/websearch.mdx#Permissions`（`{"action":"websearch","resource":"*","effect":"ask"}`）与 `#Disable`（`"websearch": false` 移除工具）；`[A] https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/tool/plugin/websearch.ts#L49-L55`（`permission.assert({action:name, resources:[input.query], save:["*"], metadata:input})`）、`#L184-L193`（`context/compaction/generate` hook 里 `delete event.tools[name]`）；`[A] v2.2.5/packages/core/src/config/plugin/websearch.ts:13-17`（`selection===false → default.set(false)`） | `[E]` **代码落点缺口**：DSH 的模型可见工具是官方 `dsh-tool-web` 的 `web_search`（`[A] /home/ova/dsh/packages/web/tool-web/src/search.ts:325-376`），第三方插件**不能改它**；可行落点是在 `[A] DSH/lib/settings-api.js` 加 `websearchEnabled` 开关，通过 cordis patch 把 `tool-web.config.search` 设为 false（需用户改 `~/.dsh/profiles/web/cordis.patch.yml`，非插件内自动）；per-call `ask` 需 DSH 的 `tools/pre-execute` policy（`[B] /home/ova/dsh/packages/web/tool-web/README.md:253`「Deployments that need per-call confirmation must add a `tools/pre-execute` policy or disable fetch」）——**未取到该 policy 的具体 API 原文，标 [E]** | `[E]` 未取到 DSH `tools/pre-execute` policy 的注册代码 → 无法给实跑命令；可验证的只有「把 `tool-web.config.search:false` 后 `web_search` 不在模型工具表」：用 `[D] cordis_inspect_list` / `cordis_inspect_query` 读当前 profile 的 Tool schema 前后对比 | 风险：**这是跨包改动，不是插件内改动**，必须显式告知用户并让其改 patch；`[E]` 若 DSH 无等价 per-call ask 机制，此条只能降级为「文档建议」而非代码并入。回滚：patch 改回 |
| **P1-4** | 遥测 / health / history 对齐 v2 的 `providerID` provenance 与「不记凭证」 | `[A] https://github.com/anomalyco/opencode/blob/v2.2.5/packages/schema/src/websearch.ts#L35-L38`（`Response={providerID,results}`）、`[A] v2.2.5/packages/core/src/tool/plugin/websearch.ts#L147-L176`（`metadata:{provider}` + 429/401 文案映射）；`[A] /home/dsh/.dsh/automation/reports/2026-11-04-rehearsal.md`「Which provider answered (provenance)」行；`[C] CHANGELOG 2.8.6`「all-fail diagnostics keep the full cause chain and enumerate every backend reason (no >4 truncation; cooled skips counted)」「backend timeouts classified as timeouts in telemetry/health」 | `[A] DSH/lib/provider.js:430-445` 遥测行（已有 `[websearch backends]` + `TELEMETRY_TAG`）扩展为「成功后端 + 冷却跳过 + 429/超时标签」；`[A] DSH/lib/health.js` 路由加 `provider`/`lastStatus`；`[A] DSH/lib/history.js` 环形 50 条保持「无 URL/无凭证」（`[A] DSH/README.md:190-191` 既有约束） | `GET /api/websearch/history`（DSH 已有路由）断言新增字段存在且 `entries[].query` 不含结果 URL；`GET /api/unified-search/health` 断言 `backends[]` 含 `failCount/cooled` | 风险：遥测行是**模型可见文本**（`[A] DSH/lib/provider.js:444` 把它拼进 `content`），加字段会增加 token 且可能误导模型 → 必须保留 `[A] DSH/lib/prompting.js:105` 的 `TELEMETRY_TAG=" (diagnostic only, not a source)"`；`[E]` DSH 2.8.4 的 all-fail 只列前 4 条（`:480`），2.8.8 是否已改为全量需核对 |

### 5.3 P2 — 工程质量与远期增强

| # | 改动 | 依据（B/C） | 代码落点（A） | 验证方式（D） | 风险与回滚 |
|---|---|---|---|---|---|
| **P2-1** | 统一 4 个 MCP 后端（exa/parallel/firecrawl/tinyfish）到「通用 `tools/call` + 响应上限 + 超时」客户端 | `[A] https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/mcp.ts#L7`（`MAX_RESPONSE_BYTES=256*1024`）、`#L9-L26`（`parseResponse` 兼容直接 JSON 与 SSE `data:` 行）、`#L37-L68`（只发 `tools/call`、`filterStatusOk`、`timeoutOrElse(25s)`）；`[A] DSH/lib/util/mcp-client.js:3-14`（现有 3-step handshake + 10min session 缓存） | `[A] DSH/lib/util/mcp-client.js` 加 `MAX_RESPONSE_BYTES` 与 `collectBoundedResponseBody` 等价实现（DSH 2.8.8 已有 `[A] /tmp/npm288/lib/util/mcp-client.js` 的 `describeError` 版可作基线）；`[A] DSH/lib/backends/{exa,parallel,firecrawl,tinyfish}.js` 共用 `mcpCall(url,tool,args,headers,signal)` 签名；`[A] DSH/lib/index.js` `backendTimeoutMs` 对 MCP 后端生效（`[A] DSH/lib/provider.js:326` `effectiveBackendTimeoutMs`） | `node --test tests/mcp-client.test.js`（SSE 分块、超 256KB 拒、25s 超时、无 `Mcp-Session-Id` 的 stateless server 容错）；`curl` 用 probe §6 模板分别打 4 端点 | 风险：Exa/Parallel 的 DSH 2.8.4 客户端**先 initialize 再 tools/call**，OpenCode v2.2.5 **只发 tools/call**——两者服务端兼容但归因不同（Lead 403 发生在 `MCP initialize`，恰说明差异点）；改成「只 tools/call」可能反而绕过 403，**但属于行为变更需单独 A/B 验证** `[E]`；`[E]` 256KB 上限会截断 Firecrawl 大结果，未实测。回滚：保留旧 `ensureSession` 分支开关 |
| **P2-2** | 借鉴 TinyFish `purpose` 字段把任务意图作为排序信号 | `[D] 00-lead-live-probe.md:2`（TinyFish `tools/list` inputSchema 原文：「Why this search is being run — the underlying goal or task the results will be used for. **Used to better rank results against your intent.**」）；`[A] DSH/lib/backends/tinyfish.js`（P0-3 新增） | `[A] DSH/lib/backends/tinyfish.js` 的 `args` 加 `purpose`，值来自 `[A] DSH/lib/provider.js` 的 `effReq.query` 或新增 `opts.searchPurpose`；`[A] DSH/lib/index.js` Config 加 `tinyfishPurpose: z.string().default("")` | `tools/call` 带/不带 `purpose` 各跑一次，对比 `results[]` 排序；`node --test tests/tinyfish.test.js` 断言 header/args | 风险：`[E]` `purpose` 是 TinyFish 私有字段，**无常驻权威 API 文档**（仅 probe 的 tools/list 观测），上游可变更；把用户 query 原样塞进去可能泄露意图到第三方（`[B] v2.2.5 console/websearch.mdx` 的 hosted 版才承诺 zero data retention，keyless 版未承诺）→ 默认空、需显式开启。回滚：字段留空 |
| **P2-3** | wire 结果结构化校验（替代 `as`/裸 JSON 断言） | `[A] https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/websearch.ts#L92`（`decodeResults = Schema.decodeUnknownEffect(Schema.Array(Result))`）、`#L204`（每个 provider 结果都过 `decodeResults`）；`[A] /home/dsh/.dsh/automation/reports/2026-11-04-rehearsal.md`「Validation of provider wire results」行（DSH 用 `as` 断言，200 但 shape 不符会变成 citation 链接） | `[A] DSH/lib/provider.js:138`（`collectFanoutResults` 已有 `^https?://` 白名单）扩展为 `{url:string, title?/snippet?/publishedAt?}` 的运行时校验；新增 `[A] DSH/tests/wire-validation.test.js`（恶意/畸形 MCP 响应 fixture：`javascript:` URL、缺 url、非字符串 title） | `node --test tests/wire-validation.test.js`；`[D] 00-lead-live-probe.md:3` 的 Parallel 真实响应当正例 | 风险：DSH 是 JS 无 effect Schema，需手写校验（或引入零依赖校验函数），**不要**为此新增依赖（`[B] DSH/README.md`「零依赖」定位）；过严校验可能丢掉合法但字段宽松的结果。回滚：白名单保留 |
| **P2-4** | keyless 后端「默认关 + 固定 fixture 测试 + 无 live network」工程纪律 | `[B] /home/dsh/.dsh/automation/prompts/websearch-polish.md` 第 3 条（keyless provider「disabled by default in compositions」「covered by tests with a recorded/fixed fixture — no live network in unit tests」）、第 5 条（keyless recorded-session snapshot）；`[B] https://github.com/240xu/dsh-websearch/blob/main/README.md#Test`（`node --test tests/`，README 称 91/91） | `[A] DSH/tests/{firecrawl,tinyfish,rate-limit-rotation,selection,wire-validation}.test.js`；`[A] DSH/lib/index.js` `enableFirecrawl/enableTinyfish` 均 `.default(false)`；`[E]` DSH 插件是否接 DSH `snapshots/` 录制回放 → 未取到相关代码，待核实 | `node --test "tests/*.test.js"`（无网络，全部用 fixture）；CI 无 key 时全绿 | 风险：`[E]` 用户 README 的 91/91 是 v2.8.3 声明，2.8.8 未重新核对；新增测试必须与现有 11 后端的 `parse.test.js`/`provider.test.js` 不重名冲突。回滚：删测试文件 |

### 5.4 「tavily 是否重复」明确回答（用户点名）

**结论：不新增 OpenCode 版 tavily，DSH 已有 REST tavily 后端且能力更强。**

| 对比项 | OpenCode v2.2.5 tavily | DSH 2.8.4 / 2.8.8 tavily | 证据 |
|---|---|---|---|
| 端点 | `https://api.tavily.com/search` REST POST | **同一端点** `https://api.tavily.com/search` | `[A] https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/tavily.ts#L9`；`[A] /tmp/dsh-tavily.js:13` |
| 鉴权 | 有 key：`Authorization: Bearer`；**无 key：`X-Tavily-Access-Mode: keyless`** | **必须 key**：`available()` 检查 `resolveApiKey`，无 key 抛 `WEB_PROVIDER_UNAVAILABLE: "Tavily: API key not configured"` | `[A] v2.2.5/tavily.ts:43-46`；`[A] /tmp/dsh-tavily.js:20-30` |
| 请求体 | 固定 `{query, search_depth:"basic", chunks_per_source:3, max_results:8}` | `{query, max_results:min(maxResults,20), search_depth, include_answer:true, include_raw_content:false}` + `applyTavilyFilters` | `[A] v2.2.5/tavily.ts:11-16,47-52`；`[A] /tmp/dsh-tavily.js:31-45` |
| 深度 | **仅 `basic`**（`Schema.Literal("basic")` 写死） | `basic`/`advanced`，`deepCoverage` 时自动升 `advanced`（2 API credits、多 snippet） | `[A] v2.2.5/tavily.ts:13`；`[A] /tmp/dsh-tavily.js:36-40`；`[B] https://github.com/240xu/dsh-websearch/blob/main/README.md` v2.8.0 段 |
| 答案 | 无 answer 字段 | `include_answer:true` → 映射为 `content` | `[A] v2.2.5/tavily.ts:18-26`；`[A] /tmp/dsh-tavily.js:41` |
| 时间/语言过滤 | 无 | `applyTavilyFilters(request.filters)` | `[A] /tmp/dsh-tavily.js:45` |
| 超时/重定向 | `Effect.timeoutOrElse(25s)`；无显式 redirect 策略 | `redirect:'error'` + `egress-fetch` 代理 | `[A] v2.2.5/tavily.ts:59-63`；`[A] /tmp/dsh-tavily.js:57-65` |

→ **唯一值得借鉴的是 `X-Tavily-Access-Mode: keyless` 降级**（`[A] v2.2.5/tavily.ts:45`）：可给 DSH `tavily.js` 加「无 key 时发 keyless 头」分支，但这属于 **P2 可选增强**，且 `[E]` 该 keyless tier 的额度/可用性未取到官方文档、Lead probe 也未测 tavily（「未测（需 key）」），故**不列入 P0/P1**，标 `[E] 待核实`。

### 5.5 DSH 11 后端 × OpenCode v2.2.5 五 provider 对照矩阵

| DSH 后端 | OpenCode v2.2.5 provider | 端点是否相同 | 协议 | 并入动作 |
|---|---|---|---|---|
| `exa` (MCP) | `exa` | ✅ `mcp.exa.ai/mcp` | MCP streamable-http | 复用，P2-1 统一客户端 |
| `parallel` (MCP) | `parallel` | ✅ `search.parallel.ai/mcp` | MCP streamable-http | 复用，P2-1 统一客户端 |
| — | `firecrawl` | **DSH 无** | MCP streamable-http | **P0-2 新增** |
| `tavily` (REST) | `tavily` | ✅ `api.tavily.com/search` | REST POST | **不新增**（§5.4）；keyless 头为 `[E]` P2 候选 |
| — | `tinyfish` | **DSH 无** | MCP streamable-http | **P0-3 新增** |
| `ddg` | —（v2 无） | — | HTML scrape | P0-1 升级自带 GET 修复 |
| `searxng` | — | — | REST JSON | P0-1 升级自带语义健康/多实例 |
| `brave` | — | — | REST JSON | 保留，DSH 独有 |
| `serper` | — | — | REST JSON | 保留，DSH 独有 |
| `mojeek` | — | — | REST JSON | 保留，DSH 独有 |
| `deepseek` (anthropic-like) | — | — | Anthropic Messages + `web_search_20250305` | 保留；`[B] websearch-polish.md` 警告不得指向网关 |
| `anthropic` (anthropic-like) | — | — | Anthropic Messages + `web_search_20250305` | 保留 |
| `openai` | — | — | OpenAI `/responses` + 原生 `web_search` | 保留 |

---

## 6. 风险与验收总表

| 风险 | 等级 | 依据 | 缓解 / 回滚 |
|---|---|---|---|
| **2.8.7/2.8.8 无 CHANGELOG 条目**，升级语义不全可知 | 中 | `[C] CHANGELOG.md` 只到 2.8.6；`[D] diff -rq` 列出 8 改 2 增 | 升级前备份 `package.json` + 整个 `node_modules/@240xu/dsh-websearch/`；按 tarball diff 逐文件 review；回滚 = 改回 2.8.4 + `pnpm install` |
| **403 根因**〔⚠️ 已由文首裁决框定位为「缺 `Host` 头被 Cloudflare 拒」A/D 级，不再是「未抓包定位」；本行保留为 11-05 风险登记〕，「升级即修好」**仍 E 未证明**（PR #7 / Issue #8 未修） | 高 | `[A/D] 08 附录 A.2 + Lead 最小 A/B`；`[C]` PR #7 / Issue #8 | P0-1 验收必须包含「升级后重跑 `web_search` 看 403 是否消失」；须同时保证 sidecar 可达 + `DSH_EGRESS_FORWARDER_PROXY` 已配（2.8.8 仍删 Host）；或零部署依赖的 E 级备选「补 `headers.host ?? target.host`」 |
| **Firecrawl 计费 / 用量限制** | 中 | `[D] probe §2`「Hosted keyless sessions…有用量限制」；`[E]` 具体额度未取到 | 默认关；`enableFirecrawl` 打开前查官方定价；遥测行标注 backend；熔断计数 |
| **TinyFish 50 searches/UTC day + 30 req/min** | 中 | `[D] probe §2` serverInfo 原文 | 默认关；`[A] DSH/lib/breaker.js` 扩配额语义（P1-3）；不要放进 `DEFAULT_ENABLED` |
| **SNI/GFW 与 TLS 指纹** | 高 | `[C] CHANGELOG 2.8.5/2.8.6`；`[B] 私有网关 README` 的 403 gate 结论；`[A] /home/ova/dsh/AGENTS.md` 全局记忆 §10 的 SNI 阻断矩阵 | 所有出网走 `HTTP_PROXY=172.30.66.1:1091` `[D] env`；若 SNI 层被掐，走 `DSH_EGRESS_FORWARDER` sidecar 或 `oc2.sepic.space` 类 CF Tunnel；**不要**把搜索指向 `ai.furry.vg` 网关（`[B] websearch-polish.md` 硬约束） |
| **DSH 2.8.8 forwarder 与 profile 兼容** | 中 | `[D]` 本机 v1.4.4 私有目录不可读；`[E]` 未核 | 不设 `DSH_EGRESS_FORWARDER` 时 2.8.8 与 2.8.4 出网行为「byte-identical」（`[C] 2.8.5` 原文） |
| **跨包改动（权限/工具移除）不是插件内改动** | 中 | `[A] /home/ova/dsh/packages/web/tool-web/src/search.ts:325`（工具属官方包）；`[E]` DSH `tools/pre-execute` policy API 未取到 | P1-3 标 `[E]` 并降级为「文档建议 + 用户改 cordis.patch.yml」；不擅自改 `packages/web/` 源码 |
| **模型可见遥测行增加 token / 误导** | 低 | `[A] DSH/lib/provider.js:444` 拼进 `content` | 保留 `TELEMETRY_TAG`（`[A] prompting.js:105`）；新增字段先过 `resultHeader` 之后 |

### 验收清单（按优先级）

1. `[D] npm view @240xu/dsh-websearch version` = `2.8.8`；本机 `package.json` 与 `node_modules` 版本一致。
2. `[D]` 重跑 `web_search({queries:["…"]})`：`all enabled backends failed (4)` 不再出现，或至少 exa/parallel 不再 `MCP initialize HTTP 403`。
3. `[D]` P0-2/P0-3 的 4 个 MCP 端点 `initialize` 全 200；`firecrawl_search` / `search` 的 `tools/call` 返回可解析结果（probe §6 命令）。
4. `[D] node --test "tests/*.test.js"`（含新增 5 个 spec）全绿，**无 live network**（可断网验证）。
5. `[D]` 429 轮转单测：假后端 A 返回 429 + `Retry-After: 2` → 换 B；A 冷却期内不再被选；全冷却抛错文案含所有后端原因（对齐 `[C] 2.8.6`）。
6. `[D]` 与现有 11 后端去重：同一 URL 在 firecrawl/tinyfish/exa 同时命中时 `sources[]` 只出现一次（`[A] DSH/lib/util/rank.js` URL lowercase 去重）。
7. `[D]` 遥测行含新后端 `✓/✗/⏸cooled` 标签且带 `TELEMETRY_TAG`；`/api/websearch/history` 无结果 URL、无凭证。
8. `[E]` `permission ask` / `websearch:false` 若无法在插件内实现，需在报告中明确「未落地 + 原因」，不得声称完成。

---

## 7. 权威链接清单（≥15 条，全部带 ref）

| # | 链接 | 等级 | 用途 |
|---|---|---|---|
| 1 | https://github.com/anomalyco/opencode/blob/v2.2.5/services/www/src/docs/content/websearch.mdx | B | 5 provider、`random`、429/60s、permission、disable |
| 2 | https://github.com/anomalyco/opencode/blob/v2.2.5/services/www/src/docs/content/console/websearch.mdx | B | hosted web search $0.01/次、最多 8 条、零留存 |
| 3 | https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/exa.ts | A | exa 端点/tool/解析 |
| 4 | https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/firecrawl.ts | A | firecrawl 端点/`firecrawl_search`/响应 |
| 5 | https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/parallel.ts | A | parallel 端点/structuredContent |
| 6 | https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/tavily.ts | A | tavily REST、`basic`、keyless 头 |
| 7 | https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/tinyfish.ts | A | tinyfish 端点/keyless header/initialize |
| 8 | https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/mcp.ts | A | `MAX_RESPONSE_BYTES`、tools/call、25s |
| 9 | https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/index.ts | A | `WebSearchPlugins` 5 项 |
| 10 | https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/websearch.ts | A | `ProviderKey`、random、429 冷却、`cooldownMillis` |
| 11 | https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/tool/plugin/websearch.ts | A | 工具 description、permission.assert、chooser、hook 删除工具 |
| 12 | https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/config/plugin/websearch.ts | A | `selection===false → default.set(false)` |
| 13 | https://github.com/anomalyco/opencode/blob/v2.2.5/packages/schema/src/websearch.ts | A | `Result`/`Response{providerID,results}` |
| 14 | https://github.com/anomalyco/opencode/blob/v2.2.5/packages/protocol/src/groups/websearch.ts | A | `GET /api/websearch/provider`、`POST /api/websearch` |
| 15 | https://github.com/anomalyco/opencode/blob/v2.2.5/packages/server/src/handlers/websearch.ts | A | handler 的错误映射 |
| 16 | https://github.com/anomalyco/opencode/blob/v2.2.5/packages/plugin/src/effect/websearch.ts | A | Effect 版 `WebSearchDefinition` |
| 17 | https://github.com/anomalyco/opencode/blob/v2.2.5/packages/plugin/src/promise/websearch.ts | A | Promise 版（含 `AbortSignal`） |
| 18 | https://api.github.com/repos/anomalyco/opencode/git/ref/tags/v2.2.5 | C | tag sha `9bbb8ce18c80f099e0e448775f59d965ead40a21` |
| 19 | https://api.github.com/repos/anomalyco/opencode/commits/dev | C | dev HEAD `ffe6fed58334d921f64a86a8d86128bff5a4b566` |
| 20 | https://api.github.com/repos/sst/opencode（302→`repositories/975734319`） | C | 仓库迁移 sst→anomalyco，`default_branch=dev`，224459 stars，pushed 2026-11-04T08:45:24Z |
| 21 | https://raw.githubusercontent.com/240xu/dsh-websearch/main/CHANGELOG.md | C | 2.8.5 / 2.8.6 修复项；2.8.7/2.8.8 无条目 |
| 22 | https://github.com/240xu/dsh-websearch/blob/main/README.md | B | 11 后端表、「opencode 同源」标注、测试说明 |
| 23 | https://github.com/240xu/dsh-websearch/blob/main/lib/index.js | A | `BACKENDS`/`DEFAULT_ENABLED`/`Config`/`resolveOptions` |
| 24 | https://github.com/240xu/dsh-websearch/blob/main/lib/provider.js | A | 扇出/RRF/遥测/all-fail |
| 25 | https://github.com/240xu/dsh-websearch/blob/main/lib/util/mcp-client.js | A | 3-step handshake + session 缓存 |
| 26 | https://registry.npmmirror.com/@240xu/dsh-websearch/-/dsh-websearch-2.8.8.tgz | C | npm 2.8.8 tarball（本地 `/tmp/npm288/` 已解包 diff） |
| 27 | https://raw.githubusercontent.com/240xu/opencode-zen-gateway/master/README.md | B | gate/TLS 指纹、802 桶、/v1 端点、配额 |
| 28 | https://raw.githubusercontent.com/240xu/opencode-zen-gateway/master/config.example.json | A | 网关配置结构 |
| 29 | https://raw.githubusercontent.com/240xu/opencode-zen-gateway/master/systemd/oc2api.service | A | v1.4.3 ExecStart |
| 30 | `/opt/oc2api/opencode2api_v1.4.3_linux_amd64/README.md:110-120` | A | 端点表 + 鉴权 + tools 透传 |
| 31 | `/home/ova/dsh/packages/web/AGENTS.md:5` | B | 拒绝重定向约定 |
| 32 | `/home/ova/dsh/packages/web/tool-web/README.md:253` | B | per-call confirmation 需 `tools/pre-execute` policy |
| 33 | `/home/dsh/.dsh/automation/reports/2026-11-04-rehearsal.md` | A | DSH↔OpenCode 逐条对比（OC-* legend） |
| 34 | `/home/dsh/.dsh/automation/prompts/websearch-polish.md` | B | nightly 工程纪律、网关不得替代搜索的硬约束 |
| 35 | `/home/ova/dsh/.artifacts/websearch-research/00-lead-live-probe.md` | D | 4 端点 HTTP 200、Parallel 实搜、403 归因 |
| 36 | `/home/ova/dsh/.artifacts/websearch-research/01-local-impl.md` | A | DSH 官方 seam / 工具契约基线 |

> 补充：`https://opencode.ai/docs/websearch` 实测 **404**（`[D] curl`）；`https://github.com/240xu/opencode-zen-gateway` 匿名 **404**（私有仓库，需 Basic auth，`[D]`）；`v2.2.5/packages/core/src/plugin/websearch/provider.ts` **404**（`provider.ts` 是 dev 之后才拆出的，v2.2.5 里各 provider 自带 integration 注册，`[D] diff` 已证）→ 这三处均按「未取到，待核实」处理，未作为依据。

---

## 8. 未取到 / 待核实汇总（E 级，全部显式标注）

1. `[E]` `opencode2api_v1.4.4_linux_amd64/` 目录 `drwx------ UNKNOWN` 不可读 → v1.4.4 二进制 strings / README 未取到；端点表来自 v1.4.3 + 本机 HTTP 探测，`[E]` 两版端点是否完全一致待核实。
2. `[E]` 网关是否把 `web_search_20260209` 真正透传上游并回传 server-tool 结果，无源码可证（二进制只有字符串）。
3. `[E]` 2.8.7 / 2.8.8 的 CHANGELOG 原文缺失，改动语义只有 tarball diff。
4. `[E]` 2.8.8 是否已含 2.8.6 的 `searxngBaseURLs` 字段，未逐字段核对。
5. `[E]` Firecrawl keyless tier 的具体额度、`conversationId` 回传在 DSH `mcp-client.js` 里的实现路径。
6. `[E]` TinyFish 是否接受 `egress-fetch` CONNECT 隧道的 header 透传（probe 用裸 curl）。
7. `[E]` DSH `tools/pre-execute` policy 的注册 API 原文未取到 → P1-3 的 per-call `ask` 无法给实跑命令。
8. `[E]` DSH 插件是否接 `snapshots/` keyless 录制回放，未取到代码。
9. `[E]` 403 HTML 的确切产生点（egress 代理 / 上游 WAF / TLS 指纹）未抓包定位。
10. `[E]` 「升级 2.8.8 后 403 消失」未做升级操作，未证明。
11. `[E]` Tavily `X-Tavily-Access-Mode: keyless` 的额度/可用性未取到官方文档，Lead probe 也未测 tavily。
12. `[E]` `v2.2.5` 与 `dev` 的 provider 注册差异（`provider.ts` 只在 dev 存在）已用 diff 证实方向，但 dev 完整变更集未逐文件比对（由 09b 承担）。

---

## 9. 与 09 / 09b 的分工声明

- **09-opencode-endpoints.md**：5 provider 端点逐字段（URL/协议/鉴权/请求体/响应映射/429），本文只在 §4.2、§5.4、§5.5 引用结论，不重复展开。
- **09b-opencode-v2.md**：v2 vs v1 差异、v2.2.5 源码逐文件，本文只用 v2.2.5 永久链接作**并入依据**，不做版本史叙述。
- **本文 09c**：只读网关核查 + 版本链 + 证据规范 + P0/P1/P2 并入清单 + 风险验收。按 Lead 指示**未操作 task-9**，未改 01/09/09b，未改任何源码或配置，未重启服务。

---

## 附录 · 续研补充（2026-11-05）

> **不改动上文任何结论。** 仅在文件末尾追加，与基线快照 `/home/ova/dsh/.artifacts/websearch-research/.baseline-20261105-2006/09c-opencode-integration.md` 的 MD5 `a58ec3927c0950de96e1e33a035c7c5b` 一致。全程只读，未改源码/配置、未重启、未把 token 值写入任何输出。沿用第 1 节 A/B/C/D/E 证据等级与「四联标注」。本附录只补 09c 自身第 8 节的 E 级项与 P0-1 的现场证据；01 的第 11 节补证见 `01-local-impl.md` 的同名附录。

### 续-1（P0-1 现场证据升级）：环境已设 forwarder，但本机 2.8.4 不认识它

**结论（D/A）**：09c §4.3 / P0-1 的「403 归因于 DSH 2.8.4 代理/TLS 指纹链路」在本轮拿到**进程环境变量级直接证据**；同时确认 09c §4.4 的版本链判断（本机 2.8.4、npm 2.8.8）在续研时点**仍未改变**。

| 项 | 证据 | 值 |
|---|---|---|
| 运行进程 | `[D] /proc/2085/cmdline` | `node /usr/local/bin/dsh web --patch /opt/dsh-plugins/lan-trust.patch.yml --no-open --host 127.0.0.1 --port 3080 --trusted-host 192.168.1.165 --trusted-host dsh.sepic.space` |
| forwarder 变量 | `[D] /proc/2085/environ`（脱敏） | `DSH_EGRESS_FORWARDER=http://172.30.0.1:13070/fwd`、`DSH_EGRESS_FORWARDER_PROXY=http://172.30.66.1:1091` |
| 无 provider env | `[D] 同上` | **无** `DSH_WEB_SEARCH_PROVIDER` / `DSH_WEB_FETCH_PROVIDER` |
| 本机安装版 | `[D] /home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/package.json` | `"version": "2.8.4"`（mtime `2026-10-21 20:17:29`） |
| 2.8.4 的 forwarder 支持 | `[D] grep -c DSH_EGRESS_FORWARDER <2.8.4 lib/util/egress-fetch.js>` | **0**（该版本不读取此变量） |
| 2.8.8 的 forwarder 支持 | `[D] grep -c DSH_EGRESS_FORWARDER /tmp/npm288b/lib/util/egress-fetch.js` | **8**（本轮重新下载 tarball，HTTP 200 / 88559 bytes） |
| 差异文件 | `[D] diff -rq <2.8.4 lib> /tmp/npm288b/lib` | 8 改 + 2 新增（`describe-error.js`、`failure-label.js`），与 §4.4 一致 |

**四联标注**：改动（无，仅证据）→ 依据 `[C] https://raw.githubusercontent.com/240xu/dsh-websearch/main/CHANGELOG.md`（2.8.5 引入 forwarder / 2.8.6 修 sidecar 被 dispatcher 劫持）+ `[D] 00-lead-live-probe.md:4` → 代码落点 `[A] /tmp/npm288b/lib/util/egress-fetch.js:14-31,142-155` → 验证 `[D]` 上述 env/grep/diff → 风险与回滚 `[E]` 升级后 403 是否消失未实跑（遵守只读，未升级/未重启）。
> 注：09c §4.4 提到的临时目录 `/tmp/npm288/` 已被系统清理；本轮用 `/tmp/npm288b/` 重新下载复核，结论相同。此为**路径更新**，不改动 §4.4 任何结论。

### 续-2（09c §8 第 9/10 条 E 级项）：TLS 指纹归因与「升级即修好」

- **403 确切产生点**：仍 `[E]`。新增 `[B]` 级旁证 —— 私有网关 README（`[B] https://raw.githubusercontent.com/240xu/opencode-zen-gateway/master/README.md`）记录 2026-10-24 同机实测「Go 1.24 得 429 过 gate，curl/Bun/Go 1.15 及浏览器 TLS 伪装全部 403」，结论「门禁看 TLS + HTTP 层形态」。这与 CHANGELOG 2.8.5 的 JA3 归因**同机同因**，但未抓包定位 DSH 搜索链路的具体 403 产生点，**不升级为结论**。
- **「升级 2.8.8 后 403 消失」**：仍 `[E]`，本轮未做升级操作。续-1 只能证明「环境变量已就绪、2.8.4 不消费它、2.8.8 消费它」，不能证明升级后端到端成功。

### 续-3（09c §2.1 的 v1.4.4 目录不可读 → 补充只读旁证）

`[D] stat -c '%A %U %n' /opt/oc2api/opencode2api_v1.4.4_linux_amd64` → `drwx------ UNKNOWN`，当前 dsh 用户仍**不可读**（与 §2.1 一致）。新增 `[D]` 只读交叉验证：`/opt/oc2api/oc2.log` 中 `web_search|websearch` 命中数 **0**，日志里出现的路由只有 `"/v1/chat/completions"`；`strings` 的路由清单（§2.3）无 `/api/websearch`。**结论**：网关不作为搜索后端（§2.5）进一步坐实；`[E]` v1.4.4 与 v1.4.3 端点是否完全一致仍待核实。

### 续-4（09c §8 第 3 条 E 级项）：2.8.7/2.8.8 无 CHANGELOG

`[A] https://raw.githubusercontent.com/240xu/dsh-websearch/main/CHANGELOG.md` 本轮复核：`[D] grep -n '## 2\.8\.[78]\|## 2\.9'` → **0 命中**，最新条目仍 `## 2.8.6 - 2026-10-18`。`[D] npm view @240xu/dsh-websearch versions --json` 末尾 12 项含 `2.8.5…2.8.8`，`dist-tags.latest=2.8.8`。版本链（§1.4）**无需修订**。`[E]` 2.8.7/2.8.8 具体改动仍只有 tarball diff，无官方 changelog。

### 续-5（09c §8 第 12 条 E 级项）：v2.2.5 `provider.ts` 404 复核

`[D] curl -sSL -o /dev/null -w '%{http_code}' https://raw.githubusercontent.com/anomalyco/opencode/v2.2.5/packages/core/src/plugin/websearch/provider.ts` → **404**；同目录 `index.ts`/`mcp.ts`/`exa.ts` 等均 200。`[C] https://api.github.com/repos/anomalyco/opencode/git/ref/tags/v2.2.5` → sha `9bbb8ce18c80f099e0e448775f59d965ead40a21`；`[C] https://api.github.com/repos/anomalyco/opencode/commits/dev` → `ffe6fed58334d921f64a86a8d86128bff5a4b566`（2026-11-04T07:20:08Z）。§1.3 的永久链接规则（用 v2.2.5 tag / dev 固定 sha）**继续有效**。`[E]` dev 完整变更集仍未逐文件比对（由 09b 承担）。

### 续-6（新增边界发现，供 Lead 决定是否并入 REPORT.md）

`[A] /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-base/cordis.patch.yml:467-489`（运行时 0.2.1-rc.2）显示官方 base bundle 除 01 覆盖的六包外，**还挂载 `@deepseek-ai/dsh-web-deepseek-api`**，注册 `deepseek-search-api` / `deepseek-fetch-api` 两个 provider；配合 `[B] /home/ova/dsh/docs/upgrade-guide/v0.2.1-alpha.1/web-listener-trust-config/guide.md:20`「A patch replaces the matched row's whole `config`」，社区 bundle 的 `- id: web config:{searchProvider: unified}` **会把 `fetchProvider: http` 一并抹掉**，导致 fetch 侧出现 `http` + `deepseek-fetch-api` 两个可用 provider → `WEB_PROVIDER_AMBIGUOUS`（源码分支 `[A] /home/ova/dsh/packages/web/web/src/index.ts:184-192`）。
**对 09c 并入清单的影响**：P1-3「权限/工具可见性」之外，应新增一条 **P0 级配置修复建议**（写入 §5.1 的补充，不改动原 12 行表格）：在社区 `cordis.patch.yml` 的 `- id: web` 里**同时 restate `fetchProvider: http`**（或设 `DSH_WEB_FETCH_PROVIDER=http`），否则 `web_fetch` 在运行时不可用。此项为 A+B 级确定性推导，`[E]` 未做 GUI 端到端实跑（GUI 401、Inspect 带参调用本会话全部报 `"input" must be an object`）。详细证据链见 `01-local-impl.md` 附录补-2。

### 续-7 附录证据等级汇总

| 结论 | 等级 | 依据 |
|---|---|---|
| 环境已设 forwarder、2.8.4 不消费、2.8.8 消费 | D + A | `/proc/2085/environ`、grep 计数、tarball diff |
| 2.8.7/2.8.8 无 CHANGELOG | C + D | 远端 CHANGELOG grep 0 命中、npm versions |
| v2.2.5 `provider.ts` 404 / tag sha | C + D | GitHub API + raw permalink HTTP 码 |
| 网关非搜索后端 | A + D | 端点表 + oc2.log 计数 + strings |
| patch 替换整个 config → fetch AMBIGUOUS | A + B + D（推导，`[E]` 未实跑） | upgrade-guide:20 + base bundle + `resolveProvider` |
| 403 确切产生点 / 升级即修好 / v1.4.4 端点一致性 / 2.8.7-8 语义 / dev 全量变更 | **E** | 未抓包、未升级、目录不可读、无 changelog、未逐文件比对 |

### 续-8 本附录新增链接（带 ref）

| # | 链接 / 路径 | 等级 | 用途 |
|---|---|---|---|
| B1 | `https://raw.githubusercontent.com/240xu/opencode-zen-gateway/master/README.md` | B | TLS 指纹 gate 实测（403 vs 429） |
| B2 | `https://raw.githubusercontent.com/240xu/dsh-websearch/main/CHANGELOG.md` | C | 2.8.5/2.8.6，2.8.7/8 无条目 |
| B3 | `https://api.github.com/repos/anomalyco/opencode/git/ref/tags/v2.2.5` | C | tag sha `9bbb8ce…` |
| B4 | `https://api.github.com/repos/anomalyco/opencode/commits/dev` | C | dev sha `ffe6fed…` |
| B5 | `https://registry.npmmirror.com/@240xu/dsh-websearch/-/dsh-websearch-2.8.8.tgz` | C | 2.8.8 tarball（本轮 `/tmp/npm288b/`） |
| B6 | `/home/ova/dsh/docs/upgrade-guide/v0.2.1-alpha.1/web-listener-trust-config/guide.md:20` | B | patch 替换整个 config |
| B7 | `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-base/cordis.patch.yml:467-489` | A | 运行时 base bundle（含 `web-deepseek-api`） |
| B8 | `/home/ova/dsh/.artifacts/websearch-research/00-lead-live-probe.md:4` | D | 4 端点 200 + 403 归因 |
| B9 | `/home/ova/dsh/.artifacts/websearch-research/01-local-impl.md`（本轮追加附录） | A | 第 11 节 7 条不确定项收敛 |

> 本附录未改 09/09b/REPORT.md，未操作共享任务板，未把 GitHub token 值写入任何文件/输出。
