# 21 · DSH Web Search 工程级实施规划

> 编制：工程级实施规划专精子代理 · 2026-11-06（Asia/Shanghai）
> **口径唯一权威**：[99-final-verdicts.md](99-final-verdicts.md)（8 条裁决）；主依据 [REPORT.md](REPORT.md) §2/§4.3/§5、[12-change-lineage.md](12-change-lineage.md)、[08-own-repo.md](08-own-repo.md) 附录 A.2、[09c-opencode-integration.md](09c-opencode-integration.md)、[09-opencode-endpoints.md](09-opencode-endpoints.md) 附录 C、[02-runtime-state.md](02-runtime-state.md) 附录 A/B、[05-search-backends.md](05-search-backends.md) 续研附录 A.2。
> **本文只做规划，不执行任何写操作**：未改源码/配置、未升级、未重启、未提 PR。所有「依据」按 A/B/C/D/E 标注并给出处（99 裁决编号 / 报告:章节 / commit sha / 本地路径:行号）。

---

## 0. 本轮新核验的两条一手事实（会改变落点，优先于既有报告表述）

| # | 结论 | 一手证据 | 等级 |
| --- | --- | --- | --- |
| N1 | **`- id: web` 的 `searchProvider: unified` override 不在 profile patch，而在插件自带 bundle patch** | 【A】`/home/dsh/.dsh/profiles/web/cordis.patch.yml` 全文 grep 只有 `tool-web`（:382-383）、**无 `id: web`**；`node_modules/@240xu/dsh-websearch/cordis.patch.yml` 全文为 `- id: web / name: @deepseek-ai/dsh-web / config: {searchProvider: unified}`；profile `package.json:11-28` 的 `dsh.profile.bundles` 含 `@240xu/dsh-websearch`；`cordis.yml` 注释「applied after every bundle layer」 | A |
| N2 | **P0① 有零文件编辑的等价解：环境变量 `DSH_WEB_FETCH_PROVIDER=http`** | 【A】发布版 `dsh-web/lib/index.js:59-60` `this.fetchProviderEnv = process.env.DSH_WEB_FETCH_PROVIDER`；`:115` `fetch()` 用 `this.config.fetchProvider.get() ?? this.fetchProviderEnv`；`resolveProvider()`（:121-134）在 `configuredId !== undefined` 时直接按 id 取 provider，绕开 `usable.length > 1` 的 AMBIGUOUS 分支 | A |
| N3 | **base bundle 的原始 web config 是完整的** | 【A】`/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-base/cordis.patch.yml:467-471` = `searchProvider: deepseek-official` + `fetchProvider: http`；社区 bundle patch（N1）整体替换 config 后只剩 `searchProvider: unified` → 丢 fetchProvider。与官方 upgrade-guide「A patch replaces the matched row's whole `config`, so restate that config completely」一致（【B】`docs/upgrade-guide/v0.2.1-alpha.1/web-listener-trust-config/guide.md`） | A+B |
| N4 | **插件本体落点已逐个核实** | 【A】`lib/util/egress-fetch.js:276` `delete headers["host"]`、`:117` `httpsViaConnect`、`:194` `httpViaProxy`、`:202` `headers: {...headers, host: headers.host ?? target.host}`；`lib/util/mcp-client.js:153` `mcpCall`、`:154` 无条件 `ensureSession`、`:23` 三步握手；`lib/client.js:14-25` `BACKENDS` 独立副本；`lib/index.js:54` BACKENDS、`:69` ALL_BACKENDS、`:72` DEFAULT_ENABLED、`:75/:86/:104/:113` DEFAULT_KEY_ENV/BASE_URLS/MODELS/LABELS、`:133-243` Config、`:180-190` 11 个 enableXxx、`:293-303` toggleMap | A |

> ⇒ **规划影响**：99 裁决 2 的 P0① 原文写「`~/.dsh/profiles/web/cordis.patch.yml` 的 `- id: web` 补 fetchProvider」，这是**在 profile patch 里新增一条 `- id: web`**（当前文件里并没有这条），或改环境变量；**直接改插件 bundle patch 会在 P0② 升级时被覆盖，禁止**。本文 WBS 的 P0① 以「环境变量优先、profile patch 兜底」两条路径给出。

---

## 1. 目标与范围

**一句话目标**：把当前 DSH Web GUI 从「`web_search` 四后端全挂 + `web_fetch` AMBIGUOUS」恢复到「至少一个搜索后端能返回源、`web_fetch` 能取回 200 内容」，并在此过程中不引入未经批准的运行时状态变更、不破坏现有 11 后端与模型可见文本契约。

**In scope**：
- P0① 修 `web_fetch` 的 `WEB_PROVIDER_AMBIGUOUS`（配置/环境变量，零编译）；
- P0② 升级 `@240xu/dsh-websearch` 2.8.4 → 2.8.8 的前置评估与执行准备（含 sidecar、`DSH_EGRESS_FORWARDER_PROXY`、PR #7 / Issue #8 状态判定）；
- P0③④ 新增 `firecrawl` / `tinyfish` 两个 keyless MCP backend 的**实施设计**（6 处落点、测试、默认关）；
- 零依赖最小修复（补 Host 头）的 A/B 验证与 PR 提案；
- P1/P2 的可选增强排期（不进 M1/M2 关键路径）。

**Out of scope**（明确不做，避免范围蔓延）：
- 不改 DSH 官方 `packages/web/*` 源码（跨包、需改 agent-loop，违反 `AGENTS.md:135`「Plugins, not loop changes」，且权限/工具可见性属产品级决策）【A/B】；
- 不把 `web-search-deepseek.baseURL` 指向 opencode2api 网关（`websearch-polish.md` 硬约束：会静默产生不搜索的「答案」）【B】；
- 不修 opencode2api 代理池降级（503 degraded、27 proxies 全 unhealthy）【D，REPORT §4.4.5】；
- 不批量改写全库约 93 条浮动 `main` 链接（99 裁决 8）；
- 不重复接入 tavily（DSH 已有 REST 版且支持 advanced/deepCoverage/include_answer）【A，09c §5.4】；
- 不移植 v2 的 `permission effect=ask` / `websearch:false`（跨包 + DSH `tools/pre-execute` policy API 未取到，标 E）【09c §5.2 P1-3】。

**成功判据（可量化）**：

| 判据 | 可观测指标 | 验收方式 |
| --- | --- | --- |
| S1 `web_search` 可用 | 结果含 `Sources:` 且至少 1 条 `- [title](url)`；`[websearch backends]` 遥测行至少 1 个 `✓` | §5 验收表 V3/V4 |
| S2 `web_fetch` 可用 | `web_fetch({url:"https://example.com"})` 返回 `Fetched ... (HTTP 200)` 正文，无 `WEB_PROVIDER_AMBIGUOUS` | V2 |
| S3 key 可保存 | Settings 里填任意 key-gated 后端 → 保存成功、「已配置」角标亮、刷新后仍在 | V6（依赖 PR #7/#8） |
| S4 设置生效 | `dsh web --dump-config` 组合树里 `enabledBackends`/`fetchProvider` 与 profile patch 一致（非 schema defaults） | V1/V5 |
| S5 无回归 | 既有 11 后端行为不变；`node --test tests/*.test.js` 全绿；模型可见文本逐字符不变（snapshot） | V7/V8 |
| S6 证据可追溯 | 每条改动有 commit/patch diff + 回归用例 + A/B/C/D 等级标注 | §10 证据等级索引 |

---

## 2. 决策树（第一优先级）

**判定变量**：① 作者是否已合并 [PR #7](https://github.com/240xu/dsh-websearch/pull/7) / 修复 [Issue #8](https://github.com/240xu/dsh-websearch/issues/8)（【C】2026-11-06 12:10 复核仍 open，#8 作者留言「稍等稍等，马上解决!」）；② 本机是否允许改 `node_modules` 之外的文件（profile patch / 进程 env 属于「之外」，允许）；③ 是否允许改 `node_modules` 内插件源码（危险：升级会覆盖，除非 fork）；④ 用户给的时间窗。

```
START
 │
 ├─ Q1: 用户是否允许「等待作者」且时间窗 ≥ 1~2 天？
 │    ├─ 是 → Q2: PR #7 / Issue #8 是否已关闭？
 │    │        ├─ 是 → 【路径 A】等作者修 + 我们只做零依赖修复（默认推荐，见下）
 │    │        └─ 否 → 【路径 A】继续等，但并行推进 M1（P0① + 零依赖 Host 修复的 A/B 验证），不动 node_modules
 │    └─ 否（时间窗紧 / 要求立即恢复）→ Q3: 是否允许 fork 插件源码并承担维护分叉？
 │             ├─ 否 → 【路径 C】只做零依赖最小修复（推荐次选）
 │             └─ 是 → 【路径 B】自行 fork 修（最不推荐）
 │
 └─ 任何路径都先执行：M1 的 P0①（DSH_WEB_FETCH_PROVIDER=http，零文件编辑、可秒回滚）
```

| 路径 | 动作序列 | 前置/判定条件 | 风险 | 结论 |
| --- | --- | --- | --- | --- |
| **A · 等作者修 + 零依赖先行（默认推荐）** | (1) 立即设 `DSH_WEB_FETCH_PROVIDER=http` 修 web_fetch；(2) 用 `/tmp/host-ab.mjs` 复核缺 Host 的 A/B；(3) 把「补 `host: headers.host ?? target.host`」整理成给作者的最小 PR 提案（**不自行改 node_modules**）；(4) 每日复查 PR #7 / Issue #8 状态；(5) 两编号关闭后 → 升 2.8.8 + 配 sidecar/`_PROXY` + 验收；(6) 再加两个新 backend | 用户可接受 1~2 天窗；作者已明确在修（#8 留言）；本机禁止改 node_modules | 作者延迟 → M2 顺延；但 M1 立即见效，无阻塞 | **推荐**：风险最低、无分叉维护、与作者修复方向一致、符合「改动有迹可循」（改动落在 profile/env + 上游 PR，不是本地私有补丁） |
| **B · 自行 fork 修** | fork 仓库 → 本地改 `lib/util/egress-fetch.js`（补 Host）+ `lib/client.js`（PR #7 的 settings bridge / Issue #8 的 `remote.credentials` inject）→ 装 fork 版本 → 全量验收 | 允许维护私有分叉；时间窗极紧；作者无响应 > 时间窗 | **最高**：与作者 PR #7 冲突、升级 2.8.8 时冲突、分叉需自行跟 93 条链接与后续版本、违反「不引入未经批准的运行时状态」 | 不推荐，仅作兜底 |
| **C · 只做零依赖最小修复** | (1) P0① 环境变量；(2) 补 Host 的 PR 提案（不改本地 node_modules）；(3) **不升级、不加 backend、不配 sidecar**，把 web_search 的恢复完全交给作者版本 | 用户只想「最小改动、不碰插件」；或 sidecar 不可达 | 中：web_search 仍全挂直到上游修复；但 web_fetch 恢复、证据链完整、零回滚成本 | 次选，适合纯只读/审计场景 |

**默认推荐理由（A）**：① 作者已在 Issue #8 明确响应且 PR #7 已提交 diff（`lib/index.js` +18/−1、`lib/provider.js` +1/−1、新增 `tests/v28x-settings-bridge.test.js` +57）【C，99 裁决 2 动态复核】；② 自行 fork 会与上游修冲突并制造维护分叉；③ P0① 与 Host A/B 验证是**零状态变更**就能完成的，M1 可立即交付；④ 99 裁决 2 明写「升级即修复标 E」，单升版本不够，等前置条件解除才是工程上正确的顺序。

---

## 3. WBS 工作分解

> 路径前缀：`PROFILE=/home/dsh/.dsh/profiles/web`，`PKG=$PROFILE/node_modules/@240xu/dsh-websearch`，`BASE=/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules`。
> 「影响面」列含是否需重启/重装（`dsh web` 进程 PID 2085 需重启才读新 env/patch；`pnpm install` 需重装；GUI 401 且无 dev:web watcher，任何 Web 工件改动都要重建 + 刷新页面【D，现场】）。

| ID | 任务 | 依赖 | 精确代码落点（已核验） | 改动类型 | 影响面 | 重启/重装 | 依据 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **T-01** | P0① 修 `web_fetch` AMBIGUOUS（**环境变量路径，零文件编辑**） | 无 | 启动 `dsh web` 的进程环境加 `DSH_WEB_FETCH_PROVIDER=http`；生效点 `BASE/@deepseek-ai/dsh-web/lib/index.js:60,115`（`fetchProviderEnv`）→ `resolveProvider():121-134` | 运行时 env | fetch 侧 provider 选择；不动磁盘文件 | **需重启 dsh web**（读新 env） | 【A】N2；【B】99 裁决 3 / REPORT §2；【D】02 附录 B 实跑 |
| **T-02** | P0① 兜底（**profile patch 路径**，仅当 T-01 不可用时） | T-01 失败 | 在 `PROFILE/cordis.patch.yml` **新增**一条 `- id: web / name: @deepseek-ai/dsh-web / config: {searchProvider: unified, fetchProvider: http}`（restate 完整 config；该文件当前无 `id: web`）；**不要改 `$PKG/cordis.patch.yml`**（升级会覆盖，N1） | 配置 yml | 组合树 `- id: web` config；`--dump-config` 可验 | 需重启 | 【A】N1/N3；【B】upgrade-guide whole-config 替换；【A】99 裁决 2① |
| **T-03** | 403 根因 A/B 复核（只读） | 无 | 复现脚本 `/tmp/host-ab.mjs`（同一 CONNECT、同一 UA，唯一变量 Host 头）；对照 `$PKG/lib/util/egress-fetch.js:276` `delete headers["host"]` 与 `:202` `host: headers.host ?? target.host` | 只读验证 | 无状态变更 | 否 | 【A/D】99 裁决 1 / 08 附录 A.2 |
| **T-04** | 零依赖 Host 修复的 **PR 提案**（写给作者，不在本地改 node_modules） | T-03 | 提案内容：在 `$PKG/lib/util/egress-fetch.js` 的 `httpsViaConnect()`（:117）的 `https.request({socket, headers})` 前补 `host: headers.host ?? target.host`（照 :202 写法）；附 T-03 的 A/B 输出 | 文档/PR | 上游插件 | 否（待合并） | 【A/D】99 裁决 1、裁决 2「E 级备选」；【C】commit `592237f7`（2.8.6 dispatcher 修复） |
| **T-05** | P0② 前置门禁复查（只读） | T-01 | `curl` 认证 GitHub API 查 PR #7 / Issue #8 state；`npm view @240xu/dsh-websearch version`；确认 sidecar `POST /fwd` 200（带 `proxy` 字段）与 `DSH_EGRESS_FORWARDER_PROXY` 已配 | 只读门禁 | 无 | 否 | 【C/D】99 裁决 2 动态复核；【D】08 附录 A.2 sidecar 实跑 |
| **T-06** | P0② 升级 2.8.4 → 2.8.8 | T-05 全绿 + 用户批准 | `$PROFILE/package.json:3-10` `dependencies."@240xu/dsh-websearch": "2.8.4"` → `"2.8.8"`，`pnpm install`；**同时**确认 sidecar 可达 + `DSH_EGRESS_FORWARDER_PROXY`（2.8.8 仍删 Host，无 forwarder 时同样 403） | 依赖版本 + env | `lib/` 全量（2.8.8 的 lib/ 与 2.8.6 逐字节相同【C，12 §1.4】） | **需 `pnpm install` + 重启** | 【C】99 裁决 2②/裁决 7；【C/A】12 §1.3/§1.4；【E】「升级必然修复」 |
| **T-07** | P0② 附：MCP 客户端「直接 `tools/call`、可选跳过 initialize」（**非独立第 5 条，附属 T-06**；标 E，需单独 A/B） | T-06 | `$PKG/lib/util/mcp-client.js:153` `mcpCall` 加 `skipInitialize` 选项（或 `mcpCallDirect`）；keyed 路径保留 `:23` `ensureSession` 三步握手 | 插件源码 | 4 个 MCP 后端调用行为 | 重装/重载 | 【A】v2.2.5 `mcp.ts:40-52`；【D】DSH 报 `MCP initialize HTTP 403`；【A】09 附录 C-2 |
| **T-08** | P0③ 新增 `firecrawl` backend | T-06 | **6 处**（见 §3.1）：新增 `$PKG/lib/backends/firecrawl.js`；`lib/index.js:54` BACKENDS + `:20-32` import、`:86` DEFAULT_BASE_URLS、`:113` DEFAULT_LABELS、`:104` DEFAULT_MODELS、`:75` DEFAULT_KEY_ENV、`:133-243` Config 三字段（`enableFirecrawl` 默认 **false**、`firecrawlBaseURL`、`firecrawlApiKeyEnv`）、`:293-303` toggleMap、`lib/client.js:14-25` BACKENDS 副本、`README.md`/`EXTENSION_PLAN.md` | 插件源码 + 测试 + 文档 | Settings UI、遥测、provider 注册表；`DEFAULT_ENABLED:72` **不加**（计费未知） | 重装/重载 | 【A】09 附录 C-4 / REPORT §4.4.2；【B】99 裁决 6 / 05 续研 A.2；【A】v2.2.5 `firecrawl.ts` |
| **T-09** | P0④ 新增 `tinyfish` backend | T-06, T-07（keyless 跳过 initialize 依赖 T-07 的 `skipInitialize`） | 同 T-08 六处 + `$PKG/lib/backends/tinyfish.js`；keyless 分支发 `X-TinyFish-Access-Mode: keyless` 且**跳过 initialize**，keyed 分支 `X-API-Key` + `initialize → Mcp-Session-Id → notifications/initialized` | 插件源码 + 测试 + 文档 | 同上 | 重装/重载 | 【A】09 附录 C-2 / v2.2.5 `tinyfish.ts:64,78`；【D】00 §2 keyless 限额；【A】99 裁决 2④ |
| **T-10** | P1-1 `random` + 429 `Retry-After` 冷却 + session affinity | T-06 | `$PKG/lib/provider.js`（`fanoutVariant` 前加 `cooldowns`/`preferred`/`attempted`）、`lib/breaker.js`（区分「冷却」与「连续失败熔断」，保留 fail-open）、`lib/index.js` Config 加 `providerSelection`/`cooldownMs`；新增 `tests/rate-limit-rotation.test.js` | 插件源码 + 测试 | 扇出选择层 | 重载 | 【A】v2.2.5 `core/src/websearch.ts:196-228`；【A】09 附录 C-3 六取值断言 |
| **T-11** | P1-4 遥测/health/history provenance | T-08/T-09 | `lib/provider.js:430-445` 遥测行加成功后端/冷却/429/超时标签（**必须保留** `lib/prompting.js:105` `TELEMETRY_TAG=" (diagnostic only, not a source)"`）、`lib/health.js`、`lib/history.js` | 插件源码 | 模型可见文本 → 需 snapshot | 重载 | 【A】REPORT §4.4 / 09c §5.2 P1-4；【A】`AGENTS.md:134` Model-visible⟺logged |
| **T-12** | P2-1 统一 MCP 客户端（256KB/25s/SSE+JSON 双解析） | T-07/T-08/T-09 | `lib/util/mcp-client.js` 加 `MAX_RESPONSE_BYTES` 与 SSE/JSON 双解析；四后端共用 `mcpCall` 签名；`backendTimeoutMs` 对 MCP 生效（`lib/provider.js:326` effectiveBackendTimeoutMs） | 插件源码 | 全部 MCP 后端 | 重载 | 【A】v2.2.5 `mcp.ts`；【A】09c §5.3 P2-1 |
| **T-13** | P2-3 wire 结果结构化校验 | T-08/T-09 | `lib/provider.js:138` `collectFanoutResults` 的 `^https?://` 白名单扩展为 `{url,title?,snippet?,publishedAt?}` 运行时校验；新增 `tests/wire-validation.test.js` | 插件源码 + 测试 | 结果归一化 | 重载 | 【A】v2.2.5 `websearch.ts:92,204`；【B】`DSH/README.md` 零依赖定位（不新增依赖） |
| **T-14** | 测试与 snapshot 更新 | 每个 T-0x 尾随 | `snapshots/web/web-search-round`（既有，00/01 已证 tool/result 文本逐字符一致）、新增 keyless recorded-session 用例；`packages/web/tool-web/tests/tool-web.spec.ts` 回归 | 测试 | CI gate | 否 | 【A】`docs/testing.md:14,39,53-55`；【A】`snapshots/AGENTS.md`；【A】`packages/AGENTS.md:7` REAL-composition |

### 3.1 「加一个 backend 要改 6 处」核对表（T-08/T-09 强制）

| # | 落点 | 文件:行号 | 漏改后果 |
| --- | --- | --- | --- |
| 1 | `BACKENDS` 注册表 + 顶部 import | `lib/index.js:54-68`、`:20-32` | provider 未注册 |
| 2 | `DEFAULT_ENABLED` | `lib/index.js:72`（**不加**，默认关） | 默认启用触发计费/限额 |
| 3 | `DEFAULT_KEY_ENV` / `DEFAULT_BASE_URLS` / `DEFAULT_MODELS` / `DEFAULT_LABELS` | `:75/:86/:104/:113` | resolveOptions 缺默认值 |
| 4 | `Config` 三字段（每字段 `.description(...)`，v2.8.1 `meta.volatile` 表单只认 description） | `:133-243` | Settings 表单无字段 |
| 5 | `resolveOptions()` 的 `toggleMap` + `${id}BaseURL` 派生 | `:293-303` | 开关不生效 |
| 6 | **`lib/client.js:14-25` 的 `BACKENDS` 独立副本** | `lib/client.js:14-25` | **UI 完全不可见**（KEYLESS/KEYED 分组、readCredential、状态点、开关渲染全靠它） |
| + | `README.md` Backends/Settings 表 + `EXTENSION_PLAN.md` + `tests/*.test.js` | — | 文档/测试缺口 |

**好消息（无需改）**：`cacheKeyFor` 已把 `enabledBackends` 纳入键（v2.7.1）；`recordBackendHealth → foldBreaker → getBackendHealth()` 与 `history.backends[]` 自动覆盖新后端 → **不要改 `provider.js` / `history.js` / 缓存代码**，只要新 backend 调用 `hooks.recordRequest/recordOutcome` 且 headers 不带 key（沿用 `exa.js` 的 `headers:{}` 写法）【A，09 附录 C-4】。另可顺手补 `exaBaseURL` / `parallelBaseURL`（`resolveOptions` 已派生但 Config 缺字段）。

---

## 4. 顺序、并行与依赖图

```
[M1 · 立即可交付，零状态变更]
  T-03 (Host A/B 复核, 只读) ──→ T-04 (Host 修复 PR 提案, 文档)
  T-01 (DSH_WEB_FETCH_PROVIDER=http, env) ──┐
  T-02 (profile patch 兜底, 仅 T-01 失败时) ─┼──→ V1/V2 验收
  并行：T-03 ∥ T-01 ∥ T-05(门禁复查)
  ✱ T-02 与 T-01 互斥（选一）；T-04 与 T-01/T-02 可并行（纯文档）

[M2 · 需门禁全绿 + 用户批准，串行]
  T-05 全绿 ──→ T-06 (升级 2.8.8 + sidecar/_PROXY) ──→ V3/V4/V5/V6 验收
                │
                ├──→ T-07 (skipInitialize, E 级 A/B)  ← 可与 T-08/T-09 并行设计，但代码落地在 T-06 之后
                ├──→ T-08 (firecrawl) ──┐
                └──→ T-09 (tinyfish) ──┴──→ T-11 (遥测) ──→ T-14 (snapshot)
  ✱ T-08 ∥ T-09 可并行（不同 backend 文件、同 6 处落点需合并冲突协调）
  ✱ T-10/T-12/T-13 (P1/P2) 与 M2 关键路径解耦，排到 M3

[M3 · 增强，非关键路径]
  T-10 → T-11 → T-12 → T-13 → T-14
```

**必须串行**：T-03→T-04（先有 A/B 证据才提 PR）；T-05→T-06（门禁未全绿不升级）；T-06→T-08/T-09（2.8.4 没有 forwarder，且升级会覆盖 node_modules 内改动）；T-08/T-09→T-11（遥测字段依赖新 backend 的 `recordOutcome`）。
**可并行**：T-01 ∥ T-03 ∥ T-04 ∥ T-05；T-08 ∥ T-09（需约定谁来统一改 `lib/index.js` 的 6 处与 `lib/client.js` 副本，避免写冲突）；P1/P2 全部与 M2 解耦。

### 里程碑与 DoD

| 里程碑 | 内容 | DoD（全部满足才算完成） |
| --- | --- | --- |
| **M1 · 零依赖恢复 + 证据闭环** | T-01/T-02、T-03、T-04、T-05 | ① `web_fetch` 返回 200 内容（V2 绿）；② `/tmp/host-ab.mjs` 输出 `WITHOUT Host: 403` / `WITH Host: 200`（V0 绿）；③ `dsh web --dump-config` 出现 `fetchProvider: http`（V1 绿）；④ Host 修复 PR 提案成文并附 A/B 证据；⑤ PR #7/#8 状态快照记录；⑥ 全程未改 node_modules、未升级、未重启（除非 T-01 需重启读 env，该项须用户批准） |
| **M2 · 升级 + 两个 keyless 后端** | T-06、T-07(可选)、T-08、T-09、T-11、T-14 | ① PR #7 已合并且 Issue #8 已修（T-05 门禁）；② 插件版本 2.8.8（V5 绿）；③ sidecar `POST /fwd` 200 + `_PROXY` 已配；④ `GET /api/unified-search/health` 的 `backends[]` 至少 1 个 `reachable:true`（V4 绿）；⑤ `web_search` 结果含 `Sources:` 且 ≥1 条 `- [title](url)`（V3 绿）；⑥ `firecrawl`/`tinyfish` 在 Settings 可见（V6 绿，验 `client.js` 副本未漏）；⑦ key 可保存且设置生效（V5/V6，验 PR#7/#8 真修好）；⑧ 新增 `node --test` 单测全绿、snapshot 用例已更新 |
| **M3 · 韧性/质量增强** | T-10、T-12、T-13、T-14 补强 | ① 429 冷却六取值回归用例照抄 v2.2.5 `core/test/websearch.test.ts:290-320` 全绿；② 保留 DSH `breaker` fail-open 不回退；③ 256KB/25s/SSE+JSON 双解析单测绿；④ wire 校验拒绝 `javascript:` URL / 缺 url / 非字符串 title；⑤ 所有模型可见文本变更有 keyless recorded-session snapshot |

---

## 5. 回归与验收（可自动化命令表）

> **只读**（✅）不需批准；**改状态**（⚠️）必须用户批准后才执行。所有命令经 `HTTP_PROXY/HTTPS_PROXY=http://172.30.66.1:1091`【D，现场 env】。

| ID | 命令 | 预期输出 | 只读/改状态 | 对应判据 |
| --- | --- | --- | --- | --- |
| V0 | `node /tmp/host-ab.mjs`（同 00/08 附录 A.2 的 A/B 脚本） | `WITHOUT Host: 403` 与 `WITH Host: 200` 两行 | ✅ | 99 裁决 1 复核 |
| V1 | `dsh web --dump-config \| grep -n 'fetchProvider'`（离线导出，02 附录 A 已证只读、profile `package.json` sha256 前后一致） | 命中 `fetchProvider: http`，且 `id: web` config 含 `searchProvider: unified` | ✅ | S4 / 99 裁决 3 |
| V2 | 会话内 `web_fetch({url:"https://example.com"})` | 返回 `Fetched https://example.com (HTTP 200)` + 正文，**无** `multiple usable web providers are registered` | ✅（工具调用但不改磁盘） | S2 |
| V3 | 会话内 `web_search({queries:["<探针词>"]})` | 结果含 `Sources:` 且至少 1 条 `- [title](url) — snippet`；`[websearch backends]` 遥测行至少 1 个 `✓` | ✅ | S1 |
| V4 | `curl -sS -m 10 -b '<auth cookie>' http://127.0.0.1:3080/api/unified-search/health \| python3 -c "..."` | JSON 中 `backends[]` 至少 1 项 `reachable:true`、`lastOk` 非空、`failCount` 不再单调增长 | ✅ | S1 |
| V5 | `node -p "require('$PKG/package.json').version"` 与 `curl -sS 'https://registry.npmjs.org/@240xu/dsh-websearch' \| python3 -c ...` | 本地 `2.8.8`；registry `dist-tags.latest=2.8.8` | ✅ | 99 裁决 7 三值口径 |
| V6 | Settings UI：填一个 key-gated 后端的 key → 保存 → 刷新 → 看「已配置」角标；再打开 `enableFirecrawl`/`enableTinyfish` 开关 | 保存成功、角标亮、开关在 UI 可见（`lib/client.js` 副本生效）、`enabledBackends` 随之变化 | ⚠️ 改设置/凭证，**需批准** | S3/S4（依赖 PR#7/#8） |
| V7 | `node --test "$PKG/tests/*.test.js"`（新增 firecrawl/tinyfish/rate-limit-rotation/wire-validation/selection 用例，全 fixture 无 live network） | 全部通过；无 `javascript:` URL 漏过 | ✅（执行测试，不改产品状态） | S5 |
| V8 | `pnpm run test:snapshot`（keyless recorded-session replay，DSH 官方 gate）与 `pnpm run test:web`（Web UI 卡片） | 回放无写入、卡片与 `tool.call.toolview` slot 一致 | ✅ | S5 / 99 裁决 8 |
| V9 | `dsh web --dump-config \| grep -A4 'id: web'`（T-02 后） | 组合树中 config 同时含 `searchProvider: unified` 与 `fetchProvider: http`（restate 完整） | ✅ | N3 / S4 |
| V10 | `grep -c 'DSH_EGRESS_FORWARDER' "$PKG/lib/util/egress-fetch.js"` | 2.8.4 → `0`；2.8.8 → `≥1`（forwarder 关键字存在） | ✅ | 99 裁决 1 版本含义 |
| V11 | 认证 `curl` GitHub API 查 issues/7、issues/8 的 `state` | 两者 `closed`（M2 门禁） | ✅ | 99 裁决 2 动态复核 |
| V12 | `curl -sS -m 12 -X POST 'http://172.30.0.1:13070/fwd' -H 'Content-Type: application/json' -d '{"url":"https://mcp.exa.ai/mcp","method":"POST","headers":{...},"body":"<initialize JSON>","proxy":"http://172.30.66.1:1091"}'` | `HTTP 200`（带 `proxy` 字段；不带则 502【D，08 附录 A.2】） | ✅ | M2 sidecar 前置 |

**⚠️ 会改状态、必须用户批准**：T-01 设 env 后**重启 dsh web**（PID 2085）、T-02 改 `cordis.patch.yml`、T-06 `pnpm install` + 重启、V6 保存凭证/开关、任何 `node --test` 之外的产品进程操作。

---

## 6. 回滚方案

| 改动 | 回滚动作 | 回滚后回到基线的验证 |
| --- | --- | --- |
| T-01 `DSH_WEB_FETCH_PROVIDER=http` | 去掉该 env，按原命令行重启 `dsh web`（`node /usr/local/bin/dsh web --patch /opt/dsh-plugins/lan-trust.patch.yml --no-open --host 127.0.0.1 --port 3080 --trusted-host 192.168.1.165 --trusted-host dsh.sepic.space`【D，现场 cmdline】） | V1 中 `fetchProvider` 消失；V2 重新返回 `WEB_PROVIDER_AMBIGUOUS` → 证明回到基线 |
| T-02 profile patch 新增 `- id: web` | 删除新增条目（profile patch 里原本没有该行，N1） | `dsh web --dump-config` 里 `id: web` config 回到只有 `searchProvider: unified`；V2 复现 AMBIGUOUS |
| T-06 升级 2.8.8 | `$PROFILE/package.json` 版本改回 `2.8.4` → `pnpm install` → 重启；如设了 `DSH_EGRESS_FORWARDER_PROXY` 则取消 | V5 显示 `2.8.4`；V10 关键字计数回 `0`；V4 回到 `reachable:false`/failCount 增长；确认 `lib/` 与 2.8.4 tarball 逐字节一致 |
| T-07 `skipInitialize` | 删该选项/恢复 `mcpCall` 无条件 `ensureSession`（保留旧分支开关做回滚【A，09c §5.3 P2-1】） | 4 端点重新走三步握手的单测断言通过 |
| T-08/T-09 新 backend | `enableFirecrawl` / `enableTinyfish` 设 false（第一道）；彻底回滚=删 `lib/backends/{firecrawl,tinyfish}.js` + 回退 `lib/index.js` 六处 + `lib/client.js` 副本 + 新增测试 + README/EXTENSION_PLAN | V6 中 Settings 不再出现两个开关；V7 删除对应用例后其余全绿；`--dump-config` 的 `enabledBackends` 回到 11 项 |
| T-10 429 冷却 | `providerSelection:"all"`（`lib/index.js` Config 默认值回退） | 遥测行不再出现 `⏸cooled`；`node --test tests/rate-limit-rotation.test.js` 可保留但不生效 |
| T-11 遥测字段 | 回退 `lib/provider.js:430-445` 拼接；**任何情况下不得删 `TELEMETRY_TAG`**（否则模型会把遥测误读为来源【A，09c P1-4】） | snapshot 中 tool/result 文本回到原逐字符模板 |
| 全局兜底 | 恢复 `.baseline-20261105-2006/` 快照（该目录已存 17 份 md 与 CHECKSUMS） | `md5sum -c CHECKSUMS.txt` 全部 OK |

> 回滚原则：**先关开关、再删文件、最后回退版本**；每步都用 §5 的只读命令确认状态，避免「回滚到一半」的未知态（`AGENTS.md` 错误处理要求「visibly report untrusted state」）。

---

## 7. 风险登记（≥10 条）

| ID | 风险 | 触发条件 | 影响 | 概率 | 缓解 | 责任人 |
| --- | --- | --- | --- | --- | --- | --- |
| R1 | **PR #7 未修 → 设置 inert** | 升级到 2.8.8 但 #7 仍 open（当前 open【C】） | `apply(ctx,config)` 只拿 schema defaults，`enabledBackends`/baseURL 等所有设置不生效；新 backend 开关形同虚设 | 高 | T-05 门禁：#7 `state=closed` 才进 M2；未关则停在 M1 | Lead / 用户 |
| R2 | **Issue #8 未修 → key 存不进** | #8 仍 open（当前 open，作者留言「马上解决」【C】） | `lib/client.js:657` inject 缺 `remote.credentials`，0.2.x 未声明命名空间访问抛异常 → 所有 key-gated 后端保存失败 | 高 | 同 T-05 门禁；V6 显式验「已配置」角标 | 作者 / 用户 |
| R3 | **2.8.8 仍删 Host → 单升版本不够** | T-06 只 `pnpm install` 不配 sidecar | `normalizeHeaders` 仍 `delete headers["host"]`，exa/parallel 继续 403；「升级即修复」是 E【99 裁决 1/2】 | 高 | T-06 强制附 sidecar `POST /fwd` 200（V12）+ `DSH_EGRESS_FORWARDER_PROXY`；或 T-04 的补 Host PR 合入 | 执行代理 |
| R4 | **sidecar 不兼容** | `127.0.0.1:9223` 的 `/fwd` 返回 404 / `forwarderFor` spec 与 2.8.8 期望不一致【D/E】 | forwarder 路径不通，403 不变 | 中 | V12 用带 `proxy` 字段的 spec 实测；不带 proxy 会 502【D，08 附录 A.2】；标 E 并保留「补 Host」零依赖备选 | 执行代理 |
| R5 | **Firecrawl keyless 限额/计费** | 默认开 `enableFirecrawl` 或高频调用 | 按 IP 每日双上限、超限 429【B，99 裁决 6】；具体数字官方未公布【E】 | 中 | `DEFAULT_ENABLED:72` **不加**，Config 默认 false；遥测加 `quota`/429 标签（T-11）；先小流量 A/B | 执行代理 |
| R6 | **TinyFish keyless 配额** | 默认开或并发扇出 | 30 req/min + 50 searches/UTC day【D，00 §2】；与 `breaker.js` 的「连续失败 3 次→60s」语义不同 | 中 | 默认关；health 单列 `quota`；不把配额硬编码进单测（fixture 化） | 执行代理 |
| R7 | **`lib/client.js` BACKENDS 副本漏改** | T-08/T-09 只改了 `lib/index.js` 六处 | Settings UI 完全看不到新后端（KEYLESS/KEYED 分组、readCredential、状态点全靠副本）【A，09 附录 C-4】 | 中高 | §3.1 六处核对表作为 code review checklist；V6 显式验「开关在 UI 可见」 | 执行代理 |
| R8 | **MCP initialize 握手与 keyless 冲突** | TinyFish keyless 直接复用 `mcpCall()`（无条件 `ensureSession`） | 多发一次 initialize；keyless 端点对 initialize 行为未由 OpenCode 保证【A，09 附录 C-2】 | 中 | T-07 加 `skipInitialize` / `mcpCallDirect`；keyed 路径保留三步握手（exa/parallel 依赖它） | 执行代理 |
| R9 | **Model-visible ⟺ logged / snapshot 未更新** | T-11 改遥测行、T-08/09 改结果文本 | 违反 `AGENTS.md:134`；`test:snapshot` gate 失败；Web 卡片与 session log 不一致 | 中 | 每个模型可见文本变更随附 keyless recorded-session（T-14）；`pnpm run test:snapshot`/`test:web` 绿 | 执行代理 |
| R10 | **DSH 官方 `dsh-tool-web` 跨包权限不可改** | 试图移植 v2 的 `permission effect=ask` / `websearch:false` | 工具属官方包，第三方插件不能改；`tools/pre-execute` policy API 未取到【E，09c §5.2】 | 中 | Out of scope 明确排除；若要做须先提案改 `packages/web` 并更新 `docs/architecture.md` | Lead |
| R11 | **GUI 401 + 无 dev:web watcher** | 改了 Web 工件后只刷新页面 | 改动不生效；需重建 Web 工件并验证既有 URL【D，现场；client_instructions】 | 中 | T-06/08/09 后按 `pnpm run build`（或对应工件）重建 + 刷新；不启动替代服务器 | 执行代理 |
| R12 | **shallow clone 无法本地 blame** | 想追溯 DSH 官方规则引入 commit | 本地 `git log --follow`/`git blame` 不可用（depth 1，`d7432673` 单 commit）【A，07 §8.3】 | 低 | 用认证 GitHub API（11 号审计已补 `5e0e4b24`/`80b07984`/PR #406 为 C 级） | Lead |
| R13 | **升级覆盖 node_modules 内改动** | 先改 `$PKG/cordis.patch.yml` 或 `$PKG/lib/*` 再 `pnpm install` | 本地补丁全部丢失（N1/N3） | 中高 | **禁止**改 `$PKG` 内文件作为持久方案；持久改动放 profile patch / env / 上游 PR | 执行代理 |
| R14 | **`web_fetch` 的 AMBIGUOUS 回归** | T-01 env 只加到 shell 未加到 `dsh web` 进程环境 | 重启后 env 丢失，AMBIGUOUS 复现 | 中 | V1/V2 在**重启后**复验；把 env 写进启动单元/脚本并文档化 | 执行代理 |
| R15 | **429 冷却掩盖 403 根因** | T-10 把 403 也纳入轮转 | 掩盖缺 Host 头真因（v2 只在 429 轮转，401/403 不轮转【A，v2.2.5 `websearch.ts:208`】） | 低 | 冷却条件严格 `status===429`；保留 `breaker` fail-open | 执行代理 |

---

## 8. 测试策略（DSH 仓库硬约束）

| 层 | 内容 | 命令 | 硬约束 |
| --- | --- | --- | --- |
| **Unit（fixture，无 live network）** | 新增 `tests/{firecrawl,tinyfish,rate-limit-rotation,selection,wire-validation,mcp-client}.test.js`：MCP 响应 fixture（`structuredContent` 与 `content[0].text` 双形态）、keyless header 断言、429 `Retry-After` 六取值、恶意 wire 响应（`javascript:` URL / 缺 url / 非字符串 title）、`skipInitialize` 分支 | `node --test "$PKG/tests/*.test.js"`；DSH 官方包用 `pnpm run test`（vitest） | 【A】`docs/testing.md:9` tests 随代码区域；**每个 registry 需 HMR-safety 测试**（dispose fiber 后断言清理）；`（websearch-polish.md` 第 3 条「keyless provider disabled by default + recorded/fixed fixture — no live network in unit tests」【B】 |
| **e2e（需 key，self-skip）** | 各 key-gated 后端真实 API；无 key 时自跳过 | `pnpm run test:e2e` | 【A】`AGENTS.md` CI e2e skips without `DEEPSEEK_API_KEY`；`packages/web/AGENTS.md:5` **credential-bearing 请求必须拒绝重定向**，回归须证明未联系 Location（既有 `redirect.spec.ts:52-67` 的 `it.each([301,302,303,307,308])` + `expect(targetRequests).toHaveLength(0)`） |
| **Snapshot（keyless recorded-session）** | 每个模型可见文本/工具输出变更随附一个 keyless recorded-session；现有 `snapshots/web/web-search-round` 已证 `tool/result` 文本与 `formatSearchOutput` 逐字符一致【A，01 附录补-4】 | `pnpm run test:snapshot`（replay 无写入）、`pnpm run test:web`（Chromium/WebKit 卡片） | 【A】`docs/testing.md:14,53-55`「Every non-trivial model-, protocol-, or human-visible change adds or updates a keyless recorded-session scenario in the same PR」；【A】`snapshots/AGENTS.md`：committed sessions 是 normalization fixed points、typed tokens 替代 volatile 身份、「replay without writes」；【A】`packages/AGENTS.md:7` **Product-visible plugins require a non-unit REAL-composition test**：boot test-only `cordis.yml` 经 Loader + app/process，只 mock 外部服务，断言 model-visible/durable/user-visible 输出，opt-ins 不进 shipped defaults |
| **REAL-composition** | 用 test-only `cordis.yml` 起 Web profile，断言 `web_search`/`web_fetch` 的模型可见 schema、tool result 文本、Settings 开关与 `--dump-config` 组合树一致 | 手工 boot（需用户批准，会起进程） | 【A】`packages/AGENTS.md:7`；【A】`AGENTS.md:134` Model-visible⟺logged（新模型可见输入需 session event） |
| **覆盖门禁** | `packages/*/*/src` per-file 100% | `pnpm run test:coverage` | 【A】`docs/testing.md:10`；注意本计划主要改的是**已发布 npm 插件**（不在 `packages/` 树），其 `node --test` 自测不进 DSH coverage gate，须单独在插件 CI 跑 |

> **不新增依赖**（`DSH/README.md` 零依赖定位【B，09c P2-3】）；`pnpm run test:snapshot` 回放只读，record/refresh 才写，且每个 diff 必须 review（`snapshots/AGENTS.md`）。

---

## 9. DoD 与交接

### 9.1 完成定义清单（总 DoD）
- [ ] M1/M2/M3 各自 DoD 全绿（§4）；
- [ ] §5 的 V0–V12 全部有记录（只读命令输出留档；⚠️ 改状态命令有用户批准记录）；
- [ ] 每条改动有 diff + 回归用例 + A/B/C/D/E 依据标注（§10）；
- [ ] `git diff --cached --check`（末尾恰好一个换行）、`pnpm run test:snapshot` / `test:web` 绿；
- [ ] 未泄露任何 token/口令值到报告、env 文件或提交；
- [ ] 回滚方案（§6）逐条可复现，且至少演练一次 T-01 的 env 回滚；
- [ ] 99 裁决索引与 REPORT.md 追加「实施结果」增量附录（由 Lead 合并）。

### 9.2 需要用户决策的 5 个点
1. **走哪条决策树路径**（默认推荐 A：等作者修 + 零依赖先行；或 B fork / C 仅最小修复）；
2. **是否允许重启 `dsh web`（PID 2085）**——T-01 的 env 必须重启才生效；
3. **是否允许 `pnpm install` 升级到 2.8.8**（会改 `$PROFILE/package.json` 与 `node_modules`）；
4. **是否允许部署/确认 Chromium-TLS sidecar**（`DSH_EGRESS_FORWARDER` 指向的地址 + `_PROXY`），或改走 T-04「补 Host」零依赖 PR；
5. **新增 backend 默认是否开**（建议 `enableFirecrawl` / `enableTinyfish` 均默认 false，待限额实测后再评估）。

### 9.3 给「执行代理」的精确输入
- **权威输入**：[99-final-verdicts.md](99-final-verdicts.md)（8 裁决）、本文件 §0 新核验 N1–N4、[REPORT.md](REPORT.md) §4.3/§4.4、[09-opencode-endpoints.md](09-opencode-endpoints.md) 附录 C-4（六处落点）、[09c-opencode-integration.md](09c-opencode-integration.md) §5（P0/P1/P2 五列表）；
- **第一步必做**：`V0`（`node /tmp/host-ab.mjs` 复现 A/B）与 `V1`（`dsh web --dump-config | grep fetchProvider`）取基线；然后按 §2 决策树选路径；
- **精确落点**：T-01 env `DSH_WEB_FETCH_PROVIDER=http`；T-02 `PROFILE/cordis.patch.yml` **新增** `- id: web` 且 restate 完整 config（勿改 `$PKG/cordis.patch.yml`）；T-06 `$PROFILE/package.json` 版本；T-08/09 六处 + `lib/client.js:14-25` 副本；
- **预期输出**：见 §5 V0–V12 表；
- **禁止**：改 `$PKG` 内文件作为持久方案、把搜索指向网关、把 403 当 429 轮转、删 `TELEMETRY_TAG`、启动替代服务器。

---

## 10. 证据等级索引

| 结论 / 依据 | 等级 | 出处 |
| --- | --- | --- |
| P0 四条 + 「升级即修复标 E」 | A（裁决） | 99 裁决 2；REPORT 执行摘要 13 / §4.3 |
| 403 = 缺 Host 头，JA3 证伪 | A/D | 99 裁决 1；08 附录 A.2（12 组实验）；Lead 最小 A/B `WITHOUT Host: 403`/`WITH Host: 200`；`$PKG/lib/util/egress-fetch.js:276` / `:202` |
| `web_fetch` AMBIGUOUS 实跑确认 | D | 99 裁决 3；02 附录 B（`multiple usable web providers are registered (deepseek-fetch-api, http)`） |
| `- id: web` override 在插件 bundle patch；base 有 `fetchProvider: http` | A | 本文件 §0 N1/N3：`$PKG/cordis.patch.yml` 全文、`$PROFILE/cordis.patch.yml:382`、`dsh-base/cordis.patch.yml:467-471` |
| `DSH_WEB_FETCH_PROVIDER` env 等价解 | A | 本文件 §0 N2：`dsh-web/lib/index.js:59-60,115,121-134` |
| 六处 backend 落点 / `client.js` 副本 | A | 09 附录 C-4；本文件 §3.1 核对；`$PKG/lib/index.js:54,69,72,75,86,104,113,133-243,293-303`、`lib/client.js:14-25` |
| TinyFish keyless 跳过 initialize | A | v2.2.5 `tinyfish.ts:64,78`；09 附录 C-2；`$PKG/lib/util/mcp-client.js:153-154` |
| Firecrawl keyless = B 级官方事实（数字 E） | B/E | 99 裁决 6；05 续研 A.2；`docs.firecrawl.dev/mcp-server/keyless.md` HTTP 200 |
| PR #7 / Issue #8 仍 open、作者已响应 | C | 99 裁决 2 动态复核（2026-11-06 认证 GitHub API）；本轮复核同 |
| 2.8.8 的 lib/ ≡ 2.8.6；2.8.7 孤儿 | C/A | 99 裁决 7；12 §1.3/§1.4（tarball 全量 diff、commit `592237f7586b`、`fc737d221899`、`72cbba8e3c19`、`608e474f…` API 422） |
| 版本三值 / 无 2.8.x tag / `dsh-web` dist-tags 陷阱 | C | 99 裁决 7；11 §4.1；npm registry |
| 429 冷却六取值测试级语义 / 非 429 不轮转 | A | v2.2.5 `core/test/websearch.test.ts:290-320`；09 附录 C-3；v2.2.5 `websearch.ts:208` |
| Model-visible⟺logged / REAL-composition / snapshot 硬约束 | A | `AGENTS.md:134`、`packages/AGENTS.md:7`、`docs/testing.md:14,39,53-55`、`snapshots/AGENTS.md` |
| 拒绝带凭证重定向（规则 + 回归） | A/C | `packages/web/AGENTS.md:5`；`redirect.spec.ts:52-67`；引入 commit `5e0e4b2401a1` / `80b07984c4c4` / PR #406（11 号审计） |
| GUI 401、无 dev:web watcher、PID 2085 与 env | D | 现场 `ps`/`curl`/`/proc/2085/environ`；02 附录 A.0 |
| shallow clone / 无法本地 blame | A | 07 §8.3；`git rev-parse --is-shallow-repository=true` |

---

**本文无凭证值、无浮动 ref 作为依据；全程只读取证，未改任何源码/配置/其它报告，未重启服务，未执行升级，未提 PR。**
