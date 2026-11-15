# 35-deep-dig-b · 备份版深挖：未发现缺口与上游动态

> 调研日期 **2026-11-07**（Asia/Shanghai，收尾 15:xx）· 角色：Team Lead 所指「fork 子代理写文件前失败」的**备份版**。「35-deep-dig.md」经 `ls` 确认**不存在**，故本文件为**独立新写**而非交叉复核补遗（若之后出现 35-deep-dig.md，本文件仍为备份版，两者并列，互不覆盖）。
>
> **边界**：只写本文件；全程**只读**（read/grep/glob + 认证 GitHub API + npm registry + `curl` 只读端点 + `zstd -dc` + `node` 内联分析）；未改源码/配置/其它报告、未升级、未重启、未动任务板（task-18 由 Lead 处理）、未泄露 token 值。
>
> **证据等级**（沿用全队 11 号审计口径）：**A**=源码实证（带 `ref=<tag|sha>` 永久链接或本地 `路径:行号`，本次实读到该行）；**B**=官方文档（URL + 访问日 2026-11-07 + HTTP 状态 + 逐字）；**C**=版本记录（CHANGELOG → commit/tag/npm 版本/issue 编号）；**D**=本机实测（命令 stdout + exit code + 时间/主机 `wuming`）；**E**=推断/待核实（显式标注，绝不当结论）。
>
> **取证基线**：`240xu/dsh-websearch` 认证 API（Basic auth `U=x-access-token; P=${TOK#*:}`，token 仅在 shell 变量内）；`anomalyco/opencode` dev 与 tags；`registry.npmjs.org`；本机 `/home/dsh/.dsh/`、`/home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/`（已被 Lead 就地修补的 13 后端版本）、`/home/ova/dsh/.artifacts/websearch-research/src-work/plugin/`（团队工作副本，同源）、27 份既有报告。

---

## 0. 一句话结论（先看这里）

1. **没有任何新 P0** 由上游动态产生；但**有一条新的「状态漂移」风险**：Issue #8 作者 2026-11-07 05:10 回「ok了」，然而 `main`、`npm latest`、全部 7 个 fork、PR #7 **都没有 `inject` 修复的影子** —— 作者的「修好」只在其本机 `node_modules`，**不是一个可安装的版本**。任何写「等 2.8.9 修 inject」或「Issue #8 已闭环」的表述都是错的 [A/C/D]。
2. **官方 DSH 已发到 `0.2.2-rc.1`**（2026-11-04），但 **`engines.node >=24.9.0`**，本机 Node **v22.20.0** → 升级会直接破坏运行时；且 v0.2.2-alpha.2 的两份 upgrade guide 会**移除官方 `exa`/`perplexity` provider 并把默认 `searchProvider` 改成 `deepseek-search-api`** → 与 `- id: web searchProvider: unified` 组合存在潜在冲突面 [B/C/D]。
3. **OpenCode v2 已发 `v2.2.6`**（dev 有新 `provider.ts` 重构，但**仍是 5 个 provider**）；Brave re-land PR #58334 **open 未合并**、Nimble #62220 只是 issue、SearchBase #54339 已 closed → 我们并入的 firecrawl/tinyfish **未落后**。但**官方文档路径已从 `services/www/` 迁到 `services/site/`**，旧永久链接在 dev 下 404 [A/B/C]。
4. **本机实际状态已与多数旧报告不同**：本机插件已被 Lead 就地修补成 **13 后端 + Host 修复 + inject 修复 + PR#7 settings 修复**，`history.json` 显示近期搜索 **backendsOk 3/6、4/6 成功**（不再 `all enabled backends failed (4)`），`enabled=6`；进程 PID 已从 2085 → **262230**，systemd drop-in 已落地 [A/D]。旧报告里「仍 2.8.4 原样 / 全失败 / PID 2085 / 需用户打开新后端」均为**文档债**。
5. 新增 **≥6 条代码角落盲点**，其中可操作的有：`resultHeader` 是 Config 里不存在的死开关、QUERY_GUIDANCE_* 死导出、`isTrustedApiRequest` 死代码、`DISCOVERY_FIELDS` 形状发现在多命名空间下可误选、`settings-api.js` 无并发/校验单测、`prompt-inject.md` 是越狱提示词文件但**没有被任何配置引用**（反直觉）[A/D/E]。

---

## 1. 上游全量动态表（`240xu/dsh-websearch`，认证 API，2026-11-07）

| 项 | 结果 | 与旧报告/我们修法对比 | 证据（等级） |
| --- | --- | --- | --- |
| repo 元数据 | `default_branch=main`，`pushed_at=2026-10-21T14:08:30Z`（**代码 17 天未动**），`updated_at=2026-11-07T04:49:21Z`（仅 issue 活动），`open_issues_count=6` | 与 08/11 报告一致；`updated_at` 变化只由 watch/comment 引起 | `GET /repos/240xu/dsh-websearch` 200 [C/D] |
| 全量 issues（state=all，9 条含 PR） | #8 open(11-07 更新)、#6 open、#7 PR open、#2 PR closed、#5 PR open、#4 open、#1 closed、#3 open | **#8 是 11-05 新报、11-07 有新评论**；#6（保存按钮没了）仍 open 无修复迹象 | `GET /issues?state=all&sort=updated` 200 [C/D] |
| **Issue #8 新动态** | 作者 240xu 两条评论：11-05 13:23「稍等稍等，马上解决!」→ **11-07 05:10「ok了，感谢」**；issue 仍 `state=open`（**未关闭**），无 label、无 commit 关联、timeline 只有 2 个 comment 事件 | 旧报告（99 §裁决 2 的 11-06 20:12 复核）只记到第一条评论 → **需补记第二条** | `GET /issues/8`、`/issues/8/comments`、`/issues/8/timeline` 200 [C/D] |
| **Issue #8 建议的修法** | 作者/报告人给出：① `inject` 从 `["slots","locale","connection","remote"]` 改为 **补 `"remote.credentials"`**；② `writeCredential` 处理 `set()` 的 `{ok:false}` 包络（否则「假成功」）；③ 用 `try{ this.remote.credentials }catch{}` 兜底。报告人自述「2.8.8 直接改的 `node_modules`，需重启」 | **与本机 Lead 修法一致**（`src-work/plugin/lib/client.js:758` 已是 `["slots","locale","connection","remote","remote.credentials"]`；`:351,381` 有 try/catch；`writeCredential` 检查 `res.ok===false`）——**不是不同修法，是完全相同的两条** | `GET /issues/8` body [B/D] + `src-work/plugin/lib/client.js:351,381,758` [A] |
| **该修复发布了吗？** | **没有**。`main`/`npm 2.8.8`/PR#7 head/7 个 fork 的 `lib/client.js:649` 逐字仍是 `const inject = ["slots","locale","connection","remote"];`；`npm dist-tags.latest=2.8.8`、全量 versions **无 2.8.9+**；releases = **0**；tags 仅 `v1.0.0`/`v2.0.0` | ⇒ 作者的「ok了」= **本地热修**，未推任何公开 ref/包。**「等上游修好」策略无效**；本机自修是唯一路径 | raw `main`/`bcb24b1efbb4`/fork `bestnite` 三处 client.js [A]；`GET /git/refs`、`/branches`、`/tags`、`/releases`、npm registry [C/D] |
| branches / refs | 仅 `main` + `refs/pull/{2,5,7}/head|merge` + 2 tag；`git/refs?per_page=100` 穷举无 `fix/inject` 类分支 | 无隐藏分支 | [A/D] |
| PR #7 现状 | **open**、1 commit `bcb24b1efbb4`（11-04 10:20）、`mergeable=true`、reviews=0、comments=0、`updated_at=2026-11-04T10:22`（**此后无活动**）。3 文件：`lib/index.js` +18/−1（`current()` 改读 `settings.describe()`）、`lib/provider.js` +1/−1（**RFC1918 正则 `{3}`→`{2}`**）、新增 `tests/v28x-settings-bridge.test.js` +57 | **PR #7 修的是 settings inert，不是 inject**（与 Issue #8 是两件事）。Lead 已把这两处移植到本机（99 §待裁定 3 的 11-07 14:17 注）。**正则修法与本机一致** | `GET /pulls/7`、`/pulls/7/commits`、`/pulls/7/reviews`、`/pulls/7/files` 200，patch 全文逐字读 [A/C/D] |
| PR #7 的测试 | `tests/v28x-settings-bridge.test.js` 用 `http://192.168.0.105:8385` 断言 `safesearch=0` 与不回落 `searx.be` | 该测试**恒真风险**：`globalThis.fetch` 被打桩，只断言 URL 含 `safesearch=0`；若 `resolveOptions` 不读 `settings.describe()` 而 config 恰好也带 `safeSearch:false`，断言仍过 → **不能区分 PR 修复前后的行为**（详见 §7 盲点 6）[E] | patch 逐字 [A/D/E] |
| PR #5 | open，`feat/ark-backend`（火山方舟后端，2 commits，+`lib/backends/ark.js`）| **第三个潜在后端**，25 份报告无人提及；若合并将成为 12th（本机已是 13）| `GET /pulls/5/files` [A/C] |
| 近 30 commits | 最新仍是 `da42e44a`（10-21 文档/版本号）；CHANGELOG 停在 2.8.6（294 行）；2.8.5–2.8.8 **无我们不知道的修复/破坏性变更** | 与 08 附录 A.1 / 11 §3.2 一致，无新增 | `GET /commits?per_page=30` 200 [C] |
| forks | 7 个（bestnite 11-04、agassiyzh、gjy1992、serapred、mybna134、misutime、ParticleLight）；bestnite fork 最新 commit 仍是 `da42e44a`（无 inject 提交）| 无外部贡献者给出替代修法 | `GET /forks`、`GET /repos/bestnite/dsh-websearch/commits` 200 [A/D] |
| events | 11-07 只有 `IssueCommentEvent`(240xu) + `WatchEvent`(youke2580c)；**无 PushEvent**（最后 push 10-21）| 佐证「ok了」不是代码推送 | `GET /events?per_page=100` 200 [C/D] |

**发现/证据/影响/建议（四联）**：
- **结论**：上游 inject 缺陷**未发布修复**，作者「ok了」是本地热修 → **依据** [C/D] `GET /issues/8` 两评论 + `state=open` + `git/refs`+npm versions+三处 `client.js:649` 逐字 [A] → **代码落点** [A] 远端 [`lib/client.js@main:649`](https://github.com/240xu/dsh-websearch/blob/main/lib/client.js#L649)（仍缺 `remote.credentials`）vs 本机 [`src-work/plugin/lib/client.js:758`](file:///home/ova/dsh/.artifacts/websearch-research/src-work/plugin/lib/client.js)（已修）→ **验证** [D] 2026-11-07 API + raw 三处 grep。**影响**：任何建议「升级到 2.8.9 拿 inject 修复」会落空；升级到 2.8.8 会**覆盖**本机自修并重新引入 Issue #8 缺陷。**建议**：继续保留本机自修；若必须升级，把 3 处 client.js + 1 处 index.js + 2 处 provider.js + egress-fetch Host 修复做成可重放补丁随升级重新应用（或提上游 PR，仍未执行 [E]）。

---

## 2. 官方版本表（DSH / dsh-web，npm registry + upgrade-guide）

| 项 | 结果 | 影响 | 证据 |
| --- | --- | --- | --- |
| `@deepseek-ai/dsh` dist-tags | `latest=0.2.2-rc.1`、`next=0.2.2-rc.1`、`alpha=0.2.2-alpha.3`；42 个版本；`0.2.2-rc.1` 发布 **2026-11-04T09:20:32Z** | 本机 `0.2.1-rc.2`（2026-10-17）**落后 1 个 rc + 3 个 alpha** | `GET registry.npmjs.org/@deepseek-ai%2fdsh` 200 [C/D] |
| **本机版本** | `0.2.1-rc.2`（`/usr/local/lib/node_modules/@deepseek-ai/dsh/package.json`），其内嵌 `dsh-web` 也是 `0.2.1-rc.2` | — | 本地 `node -p`/`find` [D] |
| **版本陷阱（关键）** | `@deepseek-ai/dsh-web` 的 `dist-tags.latest=0.0.1-rc.1`，但 `next=0.2.2-rc.1`、`alpha=0.2.2-alpha.3`，共 43 版本 | **不能用 `npm view @deepseek-ai/dsh-web version` 判断 web seam 版本**；`latest` 是 2026 年的残留 dist-tag。任何「dsh-web 停在 0.0.1」的表述应订正 | registry 200 [C/D] |
| **`engines` 硬门槛** | `0.2.2-rc.1` 声明 `engines.node >=24.9.0`；`0.2.1-rc.2` 无 engines | 本机 `node -v` = **v22.20.0** → 升级 DSH 会**装不上/启动失败**。这是比 websearch 插件升级更上位的阻塞 | registry `/0.2.2-rc.1` 200 [C] + `node -v` [D] |
| **v0.2.2-alpha.2 breaking: `web-search-default-provider`** | 官方 base 把 `web.searchProvider` 默认从 `deepseek-official` 改为 **`deepseek-search-api`**（直连 Search API，不再走 Messages）；**删除** `@deepseek-ai/dsh-web-search-exa`(provider `exa`) 与 `…-perplexity`(provider `perplexity`)，「A row naming either package no longer loads」 | 我们组合里 `- id: web searchProvider: unified` **显式指定** → guide 原文「Compositions that set `web.searchProvider` themselves see no change」。但**若部署里残留 `searchProvider: exa` 或 exa/perplexity 行，升级会加载失败**；本机 `--dump-config` 需复查 | [`v0.2.2-alpha.2/web-search-default-provider/guide.md`](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/upgrade-guide/v0.2.2-alpha.2/web-search-default-provider/guide.md) raw 200，逐字 [B] |
| **v0.2.2-alpha.2 breaking: `web-search-credential-modes`** | `web-deepseek-api` 的 `baseURL`/`apiKeyEnv`/`apiKey` **字段被移除**（旧值 load 不报错但被忽略），改随 DeepSeek model route；新增 YAML-only 的 `searchBaseURL`/`searchApiKeyEnv`/`fetchBaseURL`/`fetchApiKeyEnv` | 对本插件 `deepseek` 后端（Anthropic Messages + `web_search_20250305`，端点 `api.deepseek.com/anthropic/v1/messages`）**不是同一个组件**，但**共享 `DEEPSEEK_API_KEY` 与 `DEEPSEEK_BASE_URL`**：若用户按新 guide 设 `DEEPSEEK_BASE_URL` 指向自建网关，插件 deepseek 后端的 `resolveApiKey` 仍读同名 env → **端点/凭证可能串台** [E，需实跑] | 同上 `web-search-credential-modes/guide.md` raw 200 [B/E] |
| v0.2.1-rc.3 `web-search-defaults` | `dsh-tool-web` 的 `searchMaxQueries` 4→**10**、`searchMaxResults` 8→**10**；`web_search` schema 广告「1–10 queries」；`dsh-web-deepseek-api` 加 `searchRequestsPerSecond=5` | **本机 profile patch 里 `tool-web` 配的是 `fetch:true, searchTimeoutMs:60000`，未设 `searchMaxQueries/Results`** → 若升级到 ≥0.2.1-rc.3，单次 `web_search` 可能启动最多 10 次 provider 搜索，插件 `concurrency=6` 与 `numResults=8` 的压力面变化，遥测行 `slice(0,12)` 也可能被截断 [E] | [`v0.2.1-rc.3/web-search-defaults/guide.md`](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/upgrade-guide/v0.2.1-rc.3/web-search-defaults/guide.md) raw 200 [B] + 本机 `cordis.patch.yml` `tool-web` 行 [A] |
| upgrade-guide 目录 | v0.1.7-rc.2 … **v0.2.2-alpha.3**（12 个版本目录），**无 v0.2.2-rc.1 目录** | `0.2.2-rc.1` 的 breaking 尚未有独立 guide（其改动应散布在 alpha.2/alpha.3）[E] | `GET /contents/docs/upgrade-guide?ref=master` 200 [C] |
| 近期 web 相关 commit | `f1b3487a` merge「fix/web-prompt-retry」(11-04)、`679f3fbb`「test(desktop): expect archive settings failure before runner validation」(11-04) | 11-04 之后 web seam 仍有维护活动 | `GET /commits?since=2026-10-15` 200 [C] |

---

## 3. OpenCode 新端点表（dev / 最新 tag，`anomalyco/opencode`）

| 项 | v2.2.5（旧基准） | **v2.2.6**（新 tag `dc2ffcf8bf26`） | **dev**（`pushed_at 2026-11-07T07:08:30Z`） | 结论 |
| --- | --- | --- | --- | --- |
| `websearch/` 文件数 | **7**（exa/firecrawl/index/mcp/parallel/tavily/tinyfish，**无 provider.ts**） | **8** | **8** | 08/09b/11 报告写「7 文件、无 provider.ts」**已过时**（Lead 首轮广播即此口径）[A/C] |
| 新增文件 | — | `provider.ts`(1540B) | `provider.ts`(1540B) | 是**共享注册重构**（`WebSearchProvider.register(ctx,{id,name,env,execute})` 统一 integration + websearch editor），**不是新 provider**。[`provider.ts@dev`](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/plugin/websearch/provider.ts) raw 200 [A] |
| provider 列表 | 5：exa/firecrawl/parallel/tavily/tinyfish | 5（同） | 5（同，`index.ts` 逐字一致） | **我们并入的 firecrawl/tinyfish 未落后** [A] |
| 5 provider 端点 | exa `mcp.exa.ai/mcp`、parallel `search.parallel.ai/mcp`、firecrawl `mcp.firecrawl.dev/v2/mcp`、tavily `api.tavily.com/search`、tinyfish `agent.tinyfish.ai/mcp` | 同左（文件 size 缩小是重构，非端点变化） | 同左 | 无新端点 [A] |
| **`web_search` schema** | `Input{query, providerID?}`、`Result{url,title?,content?,time{published?}}` | — | [`schema/src/websearch.ts@dev`](https://github.com/anomalyco/opencode/blob/dev/packages/schema/src/websearch.ts) raw 200，**逐字未变**（仍 `query` + 可选 `providerID`） | 无 schema 破坏 [A] |
| **Brave re-land #58334** | — | — | **PR open**（created 2026-10-23，updated 10-23 04:24，`merged_at=None`，head `f870161d`），body 逐字：「Adds Brave Search as a built-in web search provider. This re-lands #48222 … `X-Subscription-Token` … `GET https://api.search.brave.com/res/v1/web/search` … registers only once a key exists（`BRAVE_API_KEY`/`BRAVE_SEARCH_API_KEY`）」 | **未合并**，DSH 已有 `brave` REST 后端（端点完全一致），无缺口 [A/C/D] |
| **Nimble #62220** | — | — | **是 issue 不是 PR**：`[FEATURE]: Add Nimble as a built-in web search provider` open，2026-11-06 00:43 创建，正文「alongside Exa, Firecrawl, Parallel, Tavily and TinyFish」 | 尚无代码；**侧面印证 dev 仍 5 provider** [C/D] |
| **SearchBase #54339** | — | — | **closed**（`[FEATURE]: Add SearchBase as a websearch provider`） | 未落地 [C/D] |
| v2.2.5→v2.2.6 commits | — | 515 commits | 2 条 websearch 相关：`12c371e0`「fix(app): drive the web search consent dock through one state machine (#61962)」、`7e42be42`「fix(core): follow Console redirects for skills and web search (#62015)」 | 是 UI/redirect 修复，非新 provider [C] |
| **文档路径迁移（反直觉）** | `services/www/src/docs/content/websearch.mdx` | — | **旧路径在 dev 下 HTTP 404**；新路径 `services/site/src/docs/content/websearch.mdx`（200）与 `services/site/src/docs/content/console/websearch.mdx`（200） | 00/09b/REPORT 引用的 `services/www/...` 永久链接**在 dev 下失效**；应在 `ref=v2.2.5` 下保留旧链接或改 `services/site`。Console 文档逐字仍 `$0.01/次`、最多 8 条、零留存、失败/限流不计费（**与 00 报告一致，未变**）[B/D] |

**四联**：结论=dev 只加 `provider.ts` 重构、5 provider 未变、Brave/Nimble/SearchBase 均未落地 → 依据 [A/C] 三处 tree/API + PR/issue 状态 → 代码落点 [A] `index.ts@dev`、`provider.ts@dev`、`schema/src/websearch.ts@dev` → 验证 [D] 2026-11-07 raw/API 全 200。**建议**：把 09b/11 报告的「7 文件、无 provider.ts」就地加时间戳注记；文档链接改 `ref=v2.2.5` 固定或换 `services/site`；**不需要**为 Brave/Nimble 改 DSH 代码（brave 已有，nimble 尚未实现）。

---

## 4. 代码角落发现表（9 个文件逐个，`src-work/plugin` = 本机已安装版，逐字实读）

> 本机 `src-work/plugin` 与 `/home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/lib` 同源（13 后端 + 3 组 Lead 修复）；下表行号以 `src-work` 为准，均本次 grep/read 实读 [A]。

| # | 文件:行 | 发现 | 影响 | 建议 | 等级 |
| --- | --- | --- | --- | --- | --- |
| C1 | `index.js:213-214,340-341` + `provider.js:231` | **缓存键含新后端开关？含，但间接**：`cacheKeyFor({backends: opts.enabledBackends})`，而 `enabledBackends` 由 `toggleMap`（含 `enableFirecrawl/enableTinyfish`）解析 → 打开新后端会改变 `backendSet` → 不吃旧缓存。**结论：25 §1「新开关不吃旧缓存」正确**，但**仅当开关通过 toggle 生效**；若用户用 `enabledBackends` 显式列表（优先级最高），切换列表同样进 key | 无 bug；但 `25 §1` 未说清「显式列表也进 key」 | 补一句说明；**无需改码** | A |
| C2 | `index.js`（全 55 字段，grep 0 命中）vs `provider.js:419,465` | **`resultHeader` 是死开关**：`Config` 无 `resultHeader` 字段，`resolveOptions()` 也不产出它，于是 `opts.resultHeader !== false` 恒真 → 结果呈现头**永远开**，`opts.resultHeader === false 关闭`（provider.js:417 注释）是**不可达文档** | 若用户/宿主想关闭 header（例如减少 token），无处可关；注释误导 | 要么加 `resultHeader: z.boolean().default(true)` 到 Config 与 resolveOptions，要么删注释。**产品行为改动，需用户裁定** [E] | A/D |
| C3 | `prompting.js:78,87` 全库 grep | **`QUERY_GUIDANCE_EN/ZH` 是死导出**：只定义、无任何 import/注册（`36-lead-prefindings.md §1` 已发现，本备份独立复核确认）。同理 `RESULT_HEADER_EN/ZH` 只被同文件 `resultHeader()` 用（非死） | HyDE/Step-Back 指引从未进系统提示；README/prompting 注释声称「导出给宿主注入」但宿主无注入点 | 注册 `ctx.systemPrompt.section` + 补 snapshot，或删死导出并在 README 标注。**需用户决定** [E] | A/D |
| C4 | `history.js:104` 全库 grep | **`isTrustedApiRequest` 是死导出**：无任何调用（唯一命中是 trust.js:123 注释里提到同名概念）。实际围栏是 `rejectionFor()`（health/history/settings-api 三处都调） | 两套 fence 代码并存，读者易误以为它生效；若将来有人误用旧函数会**弱化**准入（旧函数只查 loopback Host + Origin，不含 host `admit()`） | 删除或标注 deprecated；保留 `rejectionFor` 单一入口 | A/D/E |
| C5 | `settings-api.js:45,130-136` | **`DISCOVERY_FIELDS` 形状发现在 13 后端下仍可能非唯一**：`findNamespace` 用 `["numResults","backendTimeoutMs","enabledBackends","enableExa"]` 做 shape-first `rows.find(...)`。`numResults`/`backendTimeoutMs` 是**通用名**，任何第三方插件的 settings row 若同名会**先被选中** → `mutate(view.ns,…)` 写到别人的 namespace。回退 `rows.find(ns==="dsh-websearch")` 只在 shape 全不匹配时生效 | 本机实测：模拟 `describe()` 返回 `[{ns:"other-plugin",value:{numResults:8}}, {ns:"unified-search",value:{enableExa:true}}]` → shape-first **选中 other-plugin** [D]。13 后端新增的 `enableFirecrawl` 等**没有加入** DISCOVERY_FIELDS，形状发现能力未随后端增长而增强 | 把 shape 判定改为「必须同时命中 ≥2 个本插件专属字段」或直接优先 `ns==="unified-search"` / `ns==="dsh-websearch"`；**加单测**（见 C6） | A/D/E |
| C6 | `settings-api.js:138-196,205-226` + `tests/` | **`validateOp`/`MAX_OPS`/`expectedRevision` 无单测覆盖**：`src-work/plugin/tests/` 只有 `lead-20261106.test.js` + `lead-20261107.test.js`，grep `findNamespace|DISCOVERY_FIELDS|expectedRevision|validateOp` **0 命中**。`expectedRevision` 由 client `write()`（`:250,256`）从 `store.getSnapshot().revision` 带过来，靠 host `mutate` 抛 `SETTINGS_CONFLICT` → 409；但**插件侧没有并发写回归测试**，也没有「`ops` 超 64 / 非 1 元素 path / 未知字段」的负例 | 并发保存冲突、越权字段写入、body 63KB 边界都靠宿主兜底，插件自身无证据 | 补 4 组负例 + 1 组并发（两个 write 同 expectedRevision）单测 [E，未实施] | A/D |
| C7 | `settings-api.js:37,56` + health/history `path:` | **路由前缀不一致但围栏齐全**：4 条路由分两个前缀 —— `/api/unified-search/{health,settings}`、`/api/websearch/{history,history/clear}`，**全部**经 `rejectionFor(req, getConnection())`（health.js:94、history.js:157、settings-api.js:84）→ **trust.js fence 覆盖全部 4 条**，`36-lead-prefindings.md §3` 的「低优先级不一致」成立但**不构成安全缺口** | 仅维护可读性 | 统一前缀需改 client 硬编码 URL，属 breaking，**不建议** | A/D |
| C8 | `history.js:17-25`、`health.js:14-32` | **history 不记 URL/凭证？确认安全**：`toPublicEntry` 只 `{query,time,resultCount,backendsOk,backendsTotal}`，query 截 500 字；health 的 `sanitizeError` 脱敏 `sk-…`/`Bearer …`/`api_key=` 并截 120 字。**但 query 本身可能含 PII**（README §11#18 WP148 已自述），且 health `lastError` 截 120 字前的原始 backend error 可能含 URL（`ddg HTTP 301: <a href=…>`） | 隐私面与 README 自述一致；无新泄漏 | 维持；若未来 history 跨设备同步需脱敏（README 已标 E） | A/D |
| C9 | `breaker.js:29-45` + `provider.js:292` | **fail-open 正确**：`foldBreaker` 成功即 `{failCount:0,cooledUntil:0}`；失败累计到 threshold=3 才开窗；`isCooled` 只在 `cooledUntil>now` 跳过；**全部冷却 → `cooled.clear()` 全放行**（provider.js:292）。无 Half-Open（README §3.1 已论证） | 无 bug；但 `cooldownMs=0` 时 `cooledUntil=now`，`isCooled` 用 `>now` → 不跳过，符合「显式关闭冷却」 | 维持 | A |
| C10 | `rrf.js:17-21,32-56` + `multiquery.js:19,31-37` | **RRF `itemKey` 用大小写敏感的原始 URL**（`item.url` 不 lowercase），而 `provider.js` 的 `dedupeSources`（`rank.js:59`）用 `s.url.toLowerCase()` → 同一 URL 大小写不同在 RRF 融合里**算两条**并各自累计分数（multi 模式才触发）。另 `isComplexQuery` 的 `COMPLEX_MARK_RE` 含裸 `和`/`对比`，`q.length>60` 一律触发；`deriveSubQueries` 的 `SEPARATOR_SPLIT_RE` 任一侧空白即切 | 低概率结果重复/排序偏差；门控偏宽（但默认关 `multiQueryEnabled`，实际不触发） | RRF `itemKey` 统一 lowercase；**加负例单测**。因默认关，风险低 | A/E |
| C11 | `prompting.js:60-70,105` + `provider.js:435-448` | **遥测行模型误读防护在**：`TELEMETRY_TAG=" (diagnostic only, not a source)"` 拼在 `[websearch backends]` 后；但**遥测行被写进 `result.content`（模型可见）且进 session log** —— 本机 `zstd -dc` 抽查最近 3 个 session 命中 `websearch backends` **41/3/3 次** [D]。`failureLabel` 会把 403/超时转成「network unreachable / proxy/forwarder path failed」等**解释性文字**，模型可能把它当事实 | 防护有（`diagnostic only, not a source`），但解释性标签是新增的模型可见文本，无 snapshot 覆盖 | 若要关：`resultTelemetry:false`（Config 有）；**建议补一条 snapshot 断言标签不被当 source** [E] | A/D/E |
| C12 | `trust.js:82-120` | `rejectionFor` 在 `connection` 服务存在但 `admit()`/`requestRejection()` 都抛异常时 → **503 `admission-error`（fail-closed）**；无 connection 服务时走 `structuralReason`（loopback Host + same-site + Origin/Referer 一致 + `dsh-app://app` 窄例外） | 无绕过；`36-lead-prefindings.md §2` 的「两套 fence」其实是**一个入口 + 一个备用复刻** | 维持 | A |

---

## 5. 配置 / 凭证 / 权限 / 会话日志 / snapshot 只读排查表

| 项 | 结果 | 影响 | 证据 |
| --- | --- | --- | --- |
| `~/.dsh/.credentials.yaml` | 385B，结构 `version:/records:/  kind:/payload:{version,secret}/refs:{ZEN_API_KEY,WBGL_API_KEY,WBCN_API_KEY}`。**无 `TAVILY_API_KEY` 等 websearch 引用** | 所有 key-gated 后端当前靠环境变量兜底；设置面板存 key 会新增 ref（Issue #8 报告人已验证写入成功）| 本地 read（只输出 key 名，未输出 secret）[D] |
| `~/.dsh/web-auth.env` | 30B，仅 `DSH_WEB_STATIC_TOKEN=<redacted>` | 与 web search 无关；但 health/history API 被 `rejectionFor` 拒（本机 curl 返回 `{"ok":false,"error":"untrusted request"}`）**正是因为缺该 token 对应的 browser-auth cookie**，不是路由没注册 | 本地 read + curl [D] |
| **`~/.dsh/prompt-inject.md`（反直觉）** | 25KB，文件头是 `<\|im_start\|>system:<project_instructions>` + **「UNRESTRICTED SANDBOX / PRIME DIRECTIVE: YG / Little Code Sauce」越狱提示词**，内容是 22 条 scoped rules（外挂/钓鱼/撞库/OSINT…）。**grep 全 profile *.yml 与 dsh 安装目录均无 `prompt-inject` 引用** | 它是**遗留/未挂载**的提示词文件，不影响 web search；但 25 份报告无人提及它的存在与「是否被加载」的判定 → 属真盲点。若某启动脚本显式 `--prompt-inject` 会改变模型行为（本会话 runtime 未观察到）[E] | 本地 head + grep [D/E] |
| `profile cordis.patch.yml` 的 `dsh-websearch` row | 末尾有 `- id: dsh-websearch name: @240xu/dsh-websearch config: {numResults:8, enableFirecrawl:true, enableTinyfish:true}` | **用户已在设置里打开两个新后端**；而 `25 §5.1` 仍写「需在设置面板打开」→ **文档债**。`99 §待裁定 3`（11-07 14:17）已记 `enabled=6` | 本地 read [A/D] |
| `id: web` 冲突 | profile patch **无** `- id: web`；唯一 `- id: web searchProvider: unified` 来自插件自带 `cordis.patch.yml:10-13`（bundle）。base `cordis.yml` grep `id: web`/`searchProvider`/`fetchProvider` **0 命中** | `dsh web --dump-config` 组合树只有一处 web config；`DSH_WEB_FETCH_PROVIDER=http`（systemd drop-in）是唯一 fetch 解，与 24 号裁决一致 | 本地 cat/grep [A/D] |
| `searchTimeoutMs: 60000` | profile patch 的 `tool-web` 行配 `fetch:true, searchTimeoutMs:60000`，而插件 `backendTimeoutMs=30000`（ddg 8s / searxng 5s ceiling） | **双层超时**：宿主 60s > 插件 30s，插件先超时；不冲突但遥测里「60s 等待」的直觉是错的 [E] | 本地 read [A/E] |
| systemd drop-in | `/etc/systemd/system/dsh-web.service.d/10-websearch-lead-fix.conf`（11-06 14:17）含 3 行 `Environment=`：`DSH_WEB_FETCH_PROVIDER=http`、`HTTP_PROXY`、`HTTPS_PROXY`。**未设 `DSH_EGRESS_FORWARDER_PROXY`** | 进程 env 有 `DSH_EGRESS_FORWARDER`（来自全局/启动脚本）但 2.8.4-based 代码 `grep -c forwarder` = **0** → env 被忽略；**因为 Host 修复已生效，不依赖 forwarder**（sidecar 仍 200 可用，属冗余）| `/proc/262230/environ` + drop-in read + sidecar probe 200 [D] |
| **sessions 搜索事件** | 最近 3 个 `session.v4.jsonl.zstd` 中 `web_search` 出现 303/38/122 次，`websearch backends`（遥测行）41/3/3 次，`WEB_SEARCH` 2 次 | **遥测行确实同时「模型可见 + 进 session log」**，符合 DSH「Model-visible ⟺ logged」；但也意味着 `failureLabel` 的解释性文字进了持久会话 | `zstd -dc \| grep` [D] |
| **snapshots web-search 用例** | `/home/ova/dsh/snapshots/` 有 `acp/sdk/session/web`；grep `web_search|websearch` 命中的是 `snapshots/sdk/*/tool-schemas.expected.json` 与 `system-prompt.expected.md`（**工具 schema 广告**），**无 `snapshots/web/` 下以 web_search 为场景的录制** | 按 `docs/testing.md:53`「Every non-trivial model-visible change adds/updates a keyless recorded-session scenario」：新增 13 后端、遥测标签、结果呈现头、QUERY_GUIDANCE 若注册 → **都应有 snapshot**，当前未见 [E，未逐目录穷尽] | glob/grep + [`docs/testing.md:53`](file:///home/ova/dsh/docs/testing.md) [A/B/E] |
| `docs/testing.md` REAL-composition | `:39` 明文「Product-visible plugins require a non-unit REAL-composition test. Hand-built `ctx.plugin(...)` suites are insufficient: boot test-only `cordis.yml` through Loader」；`:40` 要求证明 guard 会 red | 本插件现只有 `tests/lead-20261106/07.test.js`（内联 ctx 模拟），**不满足** REAL-composition；13 后端改动按官方政策应补 Loader 级冒烟 [E] | [`docs/testing.md:39-40`](file:///home/ova/dsh/docs/testing.md) [B] |

---

## 6. 运行时健康分类表（2026-11-07 15:xx，只读）

| 观测 | 值 | 分类 | 可操作建议 |
| --- | --- | --- | --- |
| 当前 `dsh web` PID | **262230**（旧报告 2200/2085 均已不存在） | 环境状态漂移 | 所有旧报告的 PID 断言就地注记失效 [D] |
| `web_search` 现状 | `history.json` 最近 8 条：`resultCount:8`、`backendsOk` 多为 **3/6**、一条 **4/6**；最近一条 query 为「DSH websearch save-to-execution verification probe 2026-11-07」 | **已恢复**（不再是 `all enabled backends failed (4)`）。原因是 Lead 的 Host 修复 + 两新后端，非升级 | 无需 P0；旧报告「当前故障」表述需加时间戳 [D] |
| `health` / `history` HTTP API | 直接 curl 均 `{"ok":false,"error":"untrusted request"}` | **预期**（`trust.js` admission fence 要求 browser-auth cookie），不是故障 | 若要读，带 GUI 会话 cookie；或读落盘 `history.json` [D] |
| 缓存 | `/home/dsh/.dsh/cache/websearch/results/` **8 条** JSON；`history.json` 50 条环形 | 正常 | 维持 [D] |
| `DSH_EGRESS_FORWARDER` sidecar | `http://172.30.0.1:13070/fwd`，带 `proxy` 字段 spec 实测 **HTTP 200 / 1077B**（Exa initialize SSE）；不带 `proxy` → 502 `{"error":"fetch failed"}` | **sidecar 存活且可用**，但**本机代码不用它**（forwarder 关键字计数 0） | `DSH_EGRESS_FORWARDER_PROXY` 未设；若将来升级到 2.8.8 且想走 forwarder，必须在 drop-in 补该变量，否则 2.8.5/2.8.6 路径会 502 [D/E] |
| `HTTP(S)_PROXY` | `http://172.30.66.1:1091`（drop-in 内），`NO_PROXY=127.0.0.1,localhost,::1` | 正常 | 维持 [D] |
| `DSH_WEB_FETCH_PROVIDER=http` | drop-in 已落地，进程 env 确认 | `web_fetch` 歧义已解 | 维持 [D] |
| `exa 429` / `searxng 反爬` / `firecrawl 匿名额度` / `ddg aborted` | **本次未触发**：无实时 `lastError`（health API 被 fence），`history.json` 只存计数不存错误串；旧 4 类症状来自 11-04/05 快照 | **环境抖动 vs 代码缺陷 vs 额度**无法从当前落盘数据区分；旧归因（缺 Host=代码缺陷、ddg 301=预期安全行为、searxng 反爬页=公共实例限制、firecrawl 额度未公布=E）仍成立 [E] | ① 429 冷却：插件 `failureLabel` 有 `rate-limited (HTTP 429)` 类但**无 Retry-After 冷却**（对比 v2 `random` + Retry-After/60s）→ 建议 P2 移植；② `searxngBaseURLs` 多实例 failover 在 2.8.6 已有，本机 2.8.4-based **无**（`grep` 未见）→ 若 searx.be 反爬可配 `searxngBaseURL` 换私有实例；③ ddg GET form 属 2.8.5 改动，本机 2.8.4-based 仍是 **POST**（`grep method`），但 Host 修复后 301 仍在（`redirect:error` 预期），可操作建议是保持 `redirect:"error"` 不要为了「修」而跟随重定向 [A/D/E] |

---

## 7. 文档债清单（已失效但仍写旧状态，逐条核对当前真实状态）

| # | 报告:位置 | 旧表述 | 2026-11-07 真实状态 | 处置建议 |
| --- | --- | --- | --- | --- |
| D1 | `01-local-impl.md:645`、`:727`、`02-runtime-state.md:436,440,550` | 「PID 2085」「PID 2200 已不存在，现为 2085」「仍是 2.8.4 原样、未升级、未改」 | 现 PID **262230**；插件 `package.json` 仍写 2.8.4 但 **`lib/` 已被 Lead 就地大改**（13 后端 + Host/inject/PR#7 修复），不再是原样 2.8.4 | 加「快照时间」注记，勿删；指向 25/99 |
| D2 | `02-runtime-state.md:398,404,430`、`:511`、`:312` | 「本会话实跑 `all enabled backends failed (4)`」「12 个 session 含该串」「只读边界未改任何配置」 | 11-06 起已执行（25 号执行日志：systemd drop-in、代码改动、服务重启、UI 打磨）；`history.json` 近期 3/6、4/6 成功 | 标「**历史故障快照（11-04/05）**」；当前状态以 25 §8/§11 + 99 §待裁定 3 为准 |
| D3 | `08-own-repo.md:328,335,358,376,401,408,496` + 附录 A.4:609 | 「当前故障归因」「升级到 2.8.8 应列 P0」「本机只读未升级」；附录 A.4 E③ 仍写「当前进程这两个 env 已设，只差插件代码版本」 | Host 修复已在本机落地，故障**已恢复**；`DSH_EGRESS_FORWARDER_PROXY` 实际**未设**（附录 A.4 说的「两个 env 已设」有误，进程只有 `DSH_EGRESS_FORWARDER`）；「只差版本」不成立——**不需要升级** | 就地注记；08 文首「读者必读」框已部分订正，但 §8/§9/§12 正文保留历史，需统一加时间戳 |
| D4 | `09b-opencode-v2.md:310,313` | 「11 后端」「当前故障 = all enabled backends failed (4)」「本机装 2.8.4」 | 本机已 13 后端；故障已恢复 | 加注记 |
| D5 | `99-final-verdicts.md:25`（11-06 12:10 复核） | 「#8 有 1 条作者评论『稍等稍等』；PR#7/Issue#8 仍 open」 | #8 **有 2 条评论**，11-07 05:10「ok了」；但 issue **仍 open**、代码仍未发布 | 补记第 2 条评论 + 「上游未发布」结论 |
| D6 | `25-execution-log.md:77`（§5.1） | 「开启新后端：仍默认 false，需在设置面板打开」 | `profile cordis.patch.yml` 已有 `enableFirecrawl/enableTinyfish: true`，`99 §待裁定 3` 记 `enabled=6`、遥测 `tinyfish ✓3941ms/8` | 改为「已由用户打开并生效」 |
| D7 | `00-lead-live-probe.md:110`（P0②） | 「先处理 open 的 PR #7 / Issue #8」 | 两者对**本机**已不再是阻塞项（99 §待裁定 3 明确「本机自修完成」）；上游仍 open | 区分「上游 open」与「本机已修」 |
| D8 | 09b/11/REPORT 的 OpenCode 口径 | 「`websearch/` 7 个文件、无 `provider.ts`」 | v2.2.6/dev 为 **8 文件、有 `provider.ts`**；`services/www/` 文档路径在 dev 下 404 | 加 `ref=v2.2.5` 固定或改 `services/site` |
| D9 | `08-own-repo.md:510` 及附录 A.4 | 「E① 2.8.7 来源分支未取到」「E② 403 确切环节未抓包」 | E① 已收窄为「纯 config.js 重构 + 未推送本地提交」（08 附录 A.1）；E② 已定位为缺 Host（08 附录 A.2 + 99 裁决 1） | 保留 E 原文但标注「已于附录消解/收窄」 |
| D10 | `REPORT.md:284` | 「本次调研全程只读，未修改任何源码/配置、未重启服务」 | 25 号执行日志明确**已改源码、已改 systemd、已重启** | 改为「调研阶段只读；随后经用户授权执行（见 25）」 |

---

## 8. 反直觉盲点（≥5 条，均给证据）

1. **「作者说 ok了」≠「有可安装修复」**：Issue #8 11-07 05:10「ok了」是本地 `node_modules` 热修；`main`/`npm 2.8.8`/7 forks/PR#7 **全部**仍是 `inject = ["slots","locale","connection","remote"]`（缺 `remote.credentials`），`dist-tags.latest=2.8.8`、无 2.8.9、releases=0、无 push event。**最反直觉**：升级到「最新版」反而会**重新引入**本机已修好的缺陷。[A/C/D]
2. **`npm view @deepseek-ai/dsh-web version` 会骗人**：该包 `dist-tags.latest=0.0.1-rc.1`（残留），但真实在用的是 `next=0.2.2-rc.1`、`alpha=0.2.2-alpha.3`，本机内嵌 `0.2.1-rc.2`。按 `latest` 判断 web seam 版本会得出「差了 0.2 个大版本」的错结论。[C/D]
3. **升级官方 DSH 会被 Node 版本卡死**：`0.2.2-rc.1` 要求 `node >=24.9.0`，本机 `v22.20.0`。任何「升 DSH 顺带修 web」的建议先看 engines。[C/D]
4. **`prompt-inject.md` 是 25KB 越狱提示词却没被挂载**：文件头 `<|im_start|>system:<project_instructions>` +「UNRESTRICTED SANDBOX / YG / Little Code Sauce」，但全 profile yml 与 dsh 安装目录 grep `prompt-inject` **0 命中**。25 份报告无人提它的存在/加载状态；它不影响 web search，但「以为它生效」会误判模型行为。[D/E]
5. **`resultHeader` 是 Config 里不存在的开关**：`provider.js:419,465` 判断 `opts.resultHeader !== false`，但 `Config`（55 字段）与 `resolveOptions()` 都**没有**该字段 → 恒真，注释「可用 opts.resultHeader === false 关闭」是不可达文档。同类死代码还有 `QUERY_GUIDANCE_*`（死导出）、`isTrustedApiRequest`（死函数）。[A/D]
6. **PR #7 的回归测试可能恒真**：`tests/v28x-settings-bridge.test.js` 打桩 `globalThis.fetch`，只断言 URL 含 `safesearch=0` 且不回落 `searx.be`；若 `resolveOptions` 不读 `settings.describe()` 而入口 config 恰好带 `safeSearch:false`，断言同样通过 → 该测试**不能区分修复前后**。[A/E]
7. **`DISCOVERY_FIELDS` 用通用字段名做形状发现**：`["numResults","backendTimeoutMs","enabledBackends","enableExa"]` 中前两个是通用名，模拟 `describe()` 含第三方 row `{ns:"other-plugin", value:{numResults:8}}` 会被 `rows.find` **先选中**，导致设置写入错 namespace；13 后端新增字段也没补进该数组。[A/D/E]
8. **遥测行既模型可见又进 session log，但无任何 snapshot**：`zstd -dc` 最近 3 个 session 命中 `websearch backends` 41/3/3 次；`failureLabel` 把 403/超时转成解释性文字（「proxy/forwarder path failed」）也进持久日志。按 `docs/testing.md:53`，这类 model-visible 变更应配 keyless recorded-session scenario，当前 `snapshots/` 只有 tool-schema 广告命中。[A/B/D/E]
9. **`DSH_EGRESS_FORWARDER` 设了但代码不认识**：进程 env 有 `http://172.30.0.1:13070/fwd`（sidecar 实测 200 可用），但本机 2.8.4-based `egress-fetch.js` 的 forwarder 关键字计数 **0**；`DSH_EGRESS_FORWARDER_PROXY` 反而**没设**。「env 在 drop-in 里」与「代码会用它」是两件事。[D]
10. **报告引用的行号已漂移**：08 文首「读者必读」框自己承认「行号因后续插入已漂移，按章节名定位」；本备份复核发现 `08 §9.4` 仍写「当前进程这两个 env 已设」，而 `/proc/262230/environ` 只有 `DSH_EGRESS_FORWARDER`、无 `_PROXY`。[A/D]

---

## 9. 按优先级总建议清单（每条四联标注，均**只读判断、未执行**）

| 优先级 | 建议 | 依据 | 代码落点 | 验证方式 |
| --- | --- | --- | --- | --- |
| **P0（新，状态类）** | 给 `REPORT.md` / 08 / 09b / 02 / 00 加**统一「快照时间 + 当前状态」注记**：本机故障已恢复、插件已被就地修补为 13 后端、PID 262230、Issue #8 作者「ok了」但上游未发布。**不要升级到 2.8.8**（会覆盖自修并重新引入 inject 缺陷）| [C/D] 认证 API + npm + `/proc/262230/environ` + `history.json` 3/6 成功 | [A] `src-work/plugin/lib/{client,index,provider,util/egress-fetch}.js` | [D] 升级前先用 `diff -rq` 记录本机 9 个改动文件，升级后逐字节比对 |
| **P1** | 若将来必须升官方 DSH：先升 Node 到 ≥24.9.0，再读 v0.2.2-alpha.2 两份 upgrade guide，确认 `--dump-config` 组合树里无残留 `searchProvider: exa/perplexity` 行；`DEEPSEEK_BASE_URL` 与插件 deepseek 后端共享凭证的风险实测 | [B/C] `0.2.2-rc.1` engines + 两份 guide raw 200 | [A] `dsh web --dump-config` 组合树 `id: web` 行 | [E] 需用户批准 + 重启，本轮未执行 |
| **P1** | 把 OpenCode 口径从「7 文件、无 provider.ts」更新为「**v2.2.5=7 文件；v2.2.6/dev=8 文件含 provider.ts 重构，5 provider 未变**」；文档永久链接改 `ref=v2.2.5` 或 `services/site/...` | [A/C] tree/compare/raw + PR #58334 open、#62220 issue、#54339 closed | [A] `index.ts@dev`、`provider.ts@dev` | [D] 2026-11-07 API/raw 全 200 |
| **P2** | 给 `settings-api.js` 补单测：① `DISCOVERY_FIELDS` 多命名空间错选负例；② `expectedRevision` 两并发写 → 409；③ `ops>64`/非 1 元素 path/未知字段负例；④ `validateOp` 类型错配负例 | [A/D] `tests/` 现仅 2 个 lead 测试，grep 0 命中 | [A] `settings-api.js:45,130-136,138-196,205-226` | [E] 未实施；按 `docs/testing.md:39` 还应补 REAL-composition Loader 冒烟 |
| **P2** | 修 3 处低风险代码角落：`resultHeader` 补 Config 字段（或删注释）、RRF `itemKey` 统一 lowercase、删除 `QUERY_GUIDANCE_*`/`isTrustedApiRequest` 死代码或明确注册 | [A/D] 逐行实读 + 全库 grep | [A] `prompting.js:78,87`、`history.js:104`、`rrf.js:17-21`、`index.js` Config | [E] 产品行为改动需用户裁定；删死代码无行为影响可先做 |
| **P2** | 移植 v2 的 **429 Retry-After 冷却**（`random` provider + 60s 默认）到插件 `failureLabel`/breaker；`searxngBaseURLs` 多实例 failover 属 2.8.6 功能，本机无 → 若要抗反爬需自托管实例 | [B] `websearch.mdx@dev` §Limits；[A] `CHANGELOG.md:11` | [A] `breaker.js`、`util/failure-label.js` | [E] 未实跑；额度类仍 E |
| **P3** | 补 snapshot：`snapshots/web/` 下增加含 `[websearch backends]` 遥测行与 `resultHeader` 的 keyless 录制场景，断言 `failureLabel` 解释性文字不被当 source | [B] `docs/testing.md:53`；[D] session log 41 次命中 | [A] `provider.js:435-448`、`prompting.js:105` | [E] 未逐目录穷尽 `snapshots/web/`，标 E |
| **P3** | 统一 4 条路由前缀（`/api/unified-search/*`）属 breaking，不建议；但可把「两套 fence」注释清掉（实际只有一个 `rejectionFor` 入口）| [A] 4 路径全经 `rejectionFor` | [A] `health.js:94`、`history.js:157`、`settings-api.js:84` | [D] 本机 curl 4 路径均 `untrusted request`（fence 生效） |

---

## 10. 取证索引与未完成项（E）

- **认证 API 原始响应**落 `/tmp/dig35/`（meta/issues/pulls/refs/tags/releases/events/commits/hc/ocdev/octree/npm/dsh/dshweb 等 `.json`），2026-11-07 全部 HTTP 200；token 值未写入任何文件/输出。
- **本机只读观测**：`/home/dsh/.dsh/.credentials.yaml`（仅 key 名）、`web-auth.env`（值已 redacted）、`prompt-inject.md`（head）、`profiles/web/cordis.patch.yml`、`/etc/systemd/system/dsh-web.service.d/10-websearch-lead-fix.conf`、`/proc/262230/environ`、`history.json`、8 个缓存文件、`zstd -dc` 3 个 session、`src-work/plugin/lib/*` 逐行 grep。
- **仍 E**：① 作者「ok了」对应的本地提交内容（未推公开 ref，无法取）；② `prompt-inject.md` 是否被某个未审启动脚本加载；③ 官方 DSH 升级后与 `unified` provider 的组合树实测（需批准+重启）；④ `resultHeader`/死导出处置需用户裁定；⑤ PR #7 测试恒真的严格证明（未跑该测试）；⑥ `snapshots/web/` 是否存在未 grep 到的 web_search 场景（未穷尽）；⑦ firecrawl keyless 每日上限数字（99 裁决 6 已标 E，官方未公布）；⑧ 403 上游 Cloudflare 具体 WAF 规则编号（08 附录 A.4 已标 E）。
- **未做**：未写 35-deep-dig.md（不存在，按广播规则写本备份版）、未改任何其它文件、未操作任务板、未升级、未重启、未泄露 token。

### 10.1 收尾时效复核（2026-11-07 19:40，[C/D]）

距正文取证（15:xx）约 4 小时后，对最易漂移的 4 个事实做只读复核，**全部无变化**，本报告结论仍为当前事实：Issue #8 仍 `state=open`、`updated_at=2026-11-07T05:10:52Z`、2 条评论（无第 3 条、无关闭、无关联 commit）；`@240xu/dsh-websearch` npm `latest=2.8.8`、共 23 个版本（**仍无 2.8.9+**）；PR #7 仍 open、`updated_at=2026-11-04T10:22:28Z`（无新 commit/review/评论）；`@deepseek-ai/dsh` `latest=0.2.2-rc.1`。`35-deep-dig.md` 截至此刻仍不存在，本文件保持备份版定位。[C/D]

*报告完。全部结论带 A/B/C/D/E，永久链接带 `ref=main`/`ref=v2.2.5`/`ref=dev`/commit sha；本机实测注明 2026-11-07 + wuming。*
