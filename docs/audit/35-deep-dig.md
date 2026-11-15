# 35 · 深挖：未发现缺口与上游动态（2026-11-07，Asia/Shanghai）

> **本文件是 task-18 指定路径 `/home/ova/dsh/.artifacts/websearch-research/35-deep-dig.md` 的完整交付物**。此前 Lead 曾在本路径写过一份 35 行「索引」，声明 [35-deep-dig-b.md](35-deep-dig-b.md)（19:44 落盘，191 行）为权威；本版按用户的直接指派「产出中文报告到 `35-deep-dig.md`」补齐全文，并**保留索引的关键结论指向为 §11 附录**，不删除任何既有信息。两份报告并列互补：备份版偏「全局盘点」，本版偏「未覆盖的新缺陷 + 实证复核」。
>
> 角色：挖掘专家（未发现缺口与上游动态），**不限于已修范围**。
> **边界**：只写本文件；全程**只读**（`read`/`grep`/`glob` + 认证 GitHub API + `npm view` + 只读 `curl` + `node` 内联分析 + `zstd -dc`）；未改源码/配置/其它报告、未升级、未重启、未清缓存、未 POST settings、未动任务板。**全文无 token 值**。
> **取证基线**：`240xu/dsh-websearch` 认证 API（凭据仅在 shell 变量内，未落盘）；`deepseek-ai/deepseek-harness` 官方 tag/releases/upgrade-guide；`anomalyco/opencode` dev/v2.2.5/v2.2.6/PR；npm registry；本机 `dsh-web.service`（PID **262230 → 347337**，服务 20:09:22 重启过）三个经 cookie 认证的只读 HTTP 端点；`/home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/`（Lead 就地修补后的 13 后端版）；`/home/ova/dsh/.artifacts/websearch-research/` 下 25 份原始报告 + 30–38 号专家报告；`docs/testing.md`、`snapshots/`。
>
> **证据等级**（沿用 11 号口径）：**A**=源码实证（本地 `路径:行号` 或固定 ref URL）；**B**=官方文档（逐字 + HTTP 200）；**C**=版本记录（CHANGELOG/commit/tag/npm/issue）；**D**=本机实测（stdout + 时间）；**E**=推断/待核实（显式标注）。每条发现给「发现了什么 / 证据 / 影响 / 建议」四联要素。

---

## 0. 一句话结论（先看这里）

1. **未发现由上游动态产生的新 P0**，但发现 **1 条新的 P1（真实代码缺陷，25 报告与六专家均未覆盖）**：`cache.js:36` 的 `cacheKeyFor()` **不含** `safeSearch`、`rerank`、`dedupStrategy`、各 `*BaseURL`/`*Model`、`resultHeader` 等结果决定项 → 用户改这些设置后 TTL 内（默认 900s）**继续吃旧结果**。已用 `node` 内联实证两组完全不同的配置产生**同一个 sha256 键 `f81ac8a5e2b7fd3a58f335c7f25043c3`** [A/D]。
2. **上游「已修」是幻影**：Issue #8 作者 2026-11-07 05:10Z 回「ok了，感谢」，但 issue 仍 `open`，`main` `pushed_at` 仍是 2026-10-21、npm 仍 `2.8.8`（**无 2.8.9+**）、7 个 fork 与 PR #7 head 的 `client.js:649` 逐字仍缺 `remote.credentials`。⇒ 作者只在自己 `node_modules` 热修，**没有可安装版本**；本机自修仍是唯一路径 [A/C/D]。
3. **官方 DSH 已发到 `0.2.2-rc.1`**（2026-11-04），本机 `0.2.1-rc.2`（10-17）落后 6 个版本；且 `0.2.2-rc.1` `engines.node >=24.9.0`，本机 Node **v22.20.0** → **升级 DSH 会先被 engines 挡住**，这是比插件升级更上位的阻塞 [B/C/D]。`0.2.2-alpha.2` 有两条 web search breaking change [B]。
4. **OpenCode v2 最新 tag `v2.2.6`**（`dc2ffcf8`，11-02 新增 `websearch/provider.ts` 抽象），但 `websearch/` 目录**仍是 5 个 provider 文件**；Brave `feat` PR **#58334 open 未合并**（另有 re-land issue #58328）、Nimble #62220 仅 issue、SearXNG #59138 仅 issue、SearchBase #54339 已 `closed: not_planned`。⇒ 我们并入的 firecrawl/tinyfish **未落后**；新增的是 `websearch.use` policy action（PR #61557 已合并）与 Console 计费/权限文档 [A/B/C]。
5. **本地代码已领先上游 main**：Lead 已把 PR #7 的 `current()` + RFC1918 正则、Issue #8 的 `inject`/包络修复、egress Host 修复、13 后端全部落到本机 2.8.4；但**测试有假绿**：`lead-20261107.test.js` 第 2 个测试把修复后的正则**硬编码在测试文件里**再断言，从不 `import provider.js` → **恒真**；且从安装目录裸跑 `node --test` **1/3 失败**（缺 `@deepseek-ai/dsh-credentials`），所谓「14/14」只在 `src-work/plugin/` 的测试专用 symlink 下成立 [A/D]。
6. **任务板 task-18 无法自行 claim→complete**：本子代理会话未注入 `team_task_get`/`team_task_update`（`host/Tool.listTools` 全表无该工具；与 [20 §10](20-content-assessment.md) 记录 task-10 同因），已两次 `send_message` 报 Lead/parent 代收口；索引文件 §任务板 记「Lead 代为 claim→complete（revision 2→3）」[D]。

---

## 1. 上游动态表（`240xu/dsh-websearch`，认证 GitHub API + npm，2026-11-07 22:xx 复核）

| 项 | 发现了什么 | 证据（等级） | 影响 | 建议 |
| --- | --- | --- | --- | --- |
| repo 元数据 | `default_branch=main`；`pushed_at=2026-10-21T14:08:30Z`（**代码 17 天未动**）；`updated_at=2026-11-07T04:49:21Z`（仅 issue 活动）；`open_issues_count=6`；MIT；9 stars | `GET /repos/240xu/dsh-websearch` 200 [C/D] | `updated_at` 变化不代表代码变化 | 用 `pushed_at` 判断代码，勿用 `updated_at` |
| **全量 issues（state=all）** | 共 **8 个真 issue**：#1 closed(10-13)、#3/#4/#6/#8 open；#2/#5/#7 是 PR（用 `pull_request!=null` 区分）。#5 实为 PR「火山方舟 Ark 后端」，23/99 报告把它算作 issue 数 [C] | `GET /issues?state=all&per_page=100` [C/D] | 旧报告「open issues 共 6 条(#3/#4/#5/#6/#7/#8)」把 PR 计入 | 订正为「open 真 issue 4 条 + open PR 3 条」 |
| **PR #2（新发现）** | `fix(client): ToggleRow 缺少 t prop` 于 **2026-10-31 20:11 closed 且 `merged=false`**（1 文件 +2/−0，`lib/client.js:424,433` 补 `t: props.t`）→ 作者**关掉未合并**；对应 Issue #1 同日 closed `state_reason=completed` | `GET /pulls/2`、`/pulls/2/files`、Issue #1 [A/C] | 该白屏修复**从未进入 npm 2.8.8**；本机 Lead 走了另一条 UX 重写路径 | 勿假设「#1 已闭环 = 已修进发布版」 |
| **PR #5（25 报告无人提）** | open `feat/ark-backend`，2 commits（`b52d974` + `c0a5e4a`），9 文件 +225/−8；新增 `lib/backends/ark.js`，复用 OpenAI Responses 形状，新增 4 个 Config 字段（`enableArk`/`arkApiKeyEnv`/`arkBaseURL`/`arkModel`，默认 `doubao-seed-2.1-pro`）；PR 正文附 0.2.1-rc.2 上 `apply(ctx,config)` 收到 `{}` 的观察（即 PR #7 同一根因，**早一周**）；`mergeable=true/clean`，自 10-24 无活动 | `GET /pulls/5`、`/pulls/5/files`、`/pulls/5/commits` [A/C] | 若合并将成第 14 个后端；其配置观察是 PR #7 的独立互证，全库未引用 | 记录为「第三个潜在后端」 |
| **PR #7 全量动态** | open，`mergeable=clean`，`head=bestnite:fix/dsh-0.2x-settings-bridge`，1 commit `bcb24b1efbb4`（11-04 10:20），`updated_at=2026-11-04T10:22`（**此后无活动**）；**reviews=0、review comments=0、issue comments=0、events=[]**；head 分支无新 commit。3 文件：`lib/index.js` +18/−1（`current()` 改读 `settings.describe()`）、`lib/provider.js` +1/−1（RFC1918 正则 `{3}`→`{2}`）、新增 57 行回归测试 | `GET /pulls/7{,/commits,/reviews,/comments,/files}`、`/issues/7/events`、`bestnite/commits` [A/C/D] | 「作者正在处理 PR #7」不成立：**零 review 零新 commit** | 与 Issue #8 分开表述：PR #7 修 settings inert，**不修 inject** |
| **PR #7 修法 vs 本机** | 本机 `lib/index.js:459-472` 与 PR patch **逐字一致**；本机 `lib/provider.js:321` 正则与 PR 的 `{2}` 版**一致**；上游 `main` `provider.js:327` 仍是错误的 `{3}` | 本地读 + raw `main` + PR patch [A] | 升级 2.8.8 会**退回**这两处修复 | 升级必须重放补丁 |
| **Issue #8 新动态（关键）** | 作者两条评论：11-05 13:23「稍等稍等，马上解决!」→ **11-07 05:10「ok了，感谢」**；但 issue `state=open`、`closed_at=null`、timeline 仅 2 个 `commented` 事件、**无 close/reopen、无交叉引用 commit、无 label**；`updated_at=2026-11-07T05:10:52Z` | `GET /issues/8`、`/issues/8/comments`、`/issues/8/timeline`（含 starfox media）[C/D] | 旧报告（99 裁决 2、23 §1、11 §7.2）只记到第一条评论 → **已失效** | 补记第二条；措辞须为「作者口头称已修，未发布、未关闭」 |
| **作者是否已在某分支修 `inject`？** | **没有**。`git/refs` 穷举仅 `main` + `refs/pull/{2,5,7}`；branches 只有 `main`；7 个 fork（bestnite/agassiyzh/gjy1992/serapred/mybna134/misutime/ParticleLight）中**无一**把 `remote.credentials` 加进 `inject`；`main` `lib/client.js:649` 逐字仍是 `const inject = ["slots","locale","connection","remote"];` | `GET /git/refs`、`/branches`、`/forks` + 逐 fork raw `client.js` [A/C/D] | 「等 2.8.9 拿 inject 修复」会落空 | 保留本机自修 |
| **第三方替代修法（差异点，25 报告无）** | fork `gjy1992/dsh-websearch`（自称 **2.12.2**）走**不同路线**：`inject` 仍不含 `remote.credentials`，改为把 `(name)=>ctx.get(name)` 作为 `resolveService` 传入 Controller，`credentialSeam()` 用 `ctx.get("remote.credentials")` **软探测**；理由写在 `client.js:225-233`——静态声明会让「不发布该命名空间的 host」整个 entry pending（即 Issue #4 的 deadlock）。同时该 fork 有 `backendOrder` 优先级、`configForms`/`plugins.bundle.config` 卡槽、DeepSeek Search API 后端重写（2.11.0）、`ddg.js` 改 GET | raw `gjy1992/.../lib/client.js:220-233,370,849,948`、CHANGELOG 2.11/2.12 [A/C] | **本机修法（静态声明）在「无 remote.credentials 的 host」上理论上有 pending 风险**；不过 [38](38-e2e-save-probe.md) 已在本机排除（GUI 200 + 保存 POST 成功 + 组合树有 `api-remotes` + 官方 `dsh-client-ui-settings-models` 也静态声明）[D] | 若未来要兼容更老 host，可评估 `resolveService` 软探测；但**不要**在 0.2.1-rc.2 上改 |
| **npm / releases / tags** | `dist-tags.latest=2.8.8`；全量 versions 共 23 个，**无 2.8.9+**；`gitHead=da42e44a…`；GitHub **releases=0**，tags 仅 `v1.0.0`/`v2.0.0`（无 2.8.x tag）；`2.8.7` 仍为孤儿发布；`2.8.8 time=2026-10-21T14:10:40Z` | `npm view ... versions/time/dist-tags`、`GET /releases`、`/tags` [C/D] | 无新版本可升 | 维持 2.8.4 + 本地补丁 |
| **CHANGELOG 2.8.5–2.8.8** | main CHANGELOG **最高只到 2.8.6**（`## 2.8.6 - 2026-10-18` 为第一条）；**2.8.7/2.8.8 无任何条目**。2.8.5/2.8.6 的 9 条修复（forwarder、`node:http(s)` hop、20s ceiling、全因链、SearXNG 语义健康、`searxngBaseURLs`、DDG 5s→8s、超时分类、ddg GET form）**12/08 两份报告已全部覆盖**，无我们不知道的修复或破坏性变更 | raw `CHANGELOG.md@main:1-33` [A/C] | 但**本机 2.8.4 缺这 9 条**（见 §4/§6） | 把这 9 条列为「升级收益」而非「新发现」 |
| 近 30 commits | 最新 `da42e44a`（10-21 文档/版本对齐），其后无 PushEvent；`2.8.5/2.8.6` 对应 `fc737d2`/`592237f`；作者 11-07 在**别的仓库**（`dsh-message-ops` 0.19.0）有 commit，说明其活跃但没回本仓库 | `GET /commits?per_page=30`、`/events`、作者 repos [C/D] | 佐证「ok了」不是本仓库代码推送 | 监控 `pushed_at` 而非作者整体活跃度 |
| **Issue #8 之后有没有新保存问题 issue** | **没有新编号**（最大 issue 号仍 8）；但 **#6「【BUG】保存按钮怎么没有？」仍 open**、作者 11-05 13:23 回「马上处理」后**无后续**；#4（client deadlock）仍 open，其唯一评论（luachuan 10-13）指出 0.2.0 上服务**改名为 `configForms`**、并给出 `dsh-settings-scope-shim` `npm view` 404 的证据 | `GET /issues?state=all`、`/issues/6/comments`、`/issues/4/comments` [C/D] | #6 与 #8 是**两个不同的保存缺陷**（按钮消失 vs key 存不了），25 报告几乎只谈 #8 | 把 #6 列为「上游未闭环的第二个保存问题」 |

**四联小结**：发现=上游代码/版本 17 天静止、作者口头「已修」无发布、3 个未审 PR + 1 个未合并关闭 PR；证据=[A/C/D] 上述 API + raw + npm；影响=升级策略不能依赖上游、且升级会覆盖本机 6 处修复；建议=保留本机补丁并做成升级可重放清单（9 文件），或提上游 PR（**仍未执行 [E]**）。

---

## 2. 官方版本表（`@deepseek-ai/dsh` / `dsh-web` / upgrade-guide）

| 项 | 发现了什么 | 证据 | 影响 | 建议 |
| --- | --- | --- | --- | --- |
| `@deepseek-ai/dsh` dist-tags | `latest=0.2.2-rc.1`、`next=0.2.2-rc.1`、`alpha=0.2.2-alpha.3`；共 42 版本；`0.2.2-rc.1` 发布 **2026-11-04T09:20:32Z** | `npm view ... dist-tags/versions/time` [C/D] | 本机 `0.2.1-rc.2`（10-17）**落后 6 个版本**：rc.3/rc.4/rc.5、alpha.2/alpha.3、rc.1 | 旧报告「本机与最新差距小」已失效 |
| 本机发布版 | `/usr/local/lib/node_modules/@deepseek-ai/dsh/package.json` = `0.2.1-rc.2`；内嵌 `dsh-web/package.json` 同值；源码 checkout `/home/ova/dsh` = `0.2.1-alpha.2`（shallow clone） | `node -p` [D] | 发布版比源码 checkout 新 | 区分两者 |
| **`engines` 硬门槛（新发现）** | `0.2.2-rc.1` 声明 `engines.node >=24.9.0`；`0.2.1-rc.2` **无 engines 字段**；本机 `node -v = v22.20.0` | `npm view @deepseek-ai/dsh@0.2.2-rc.1 engines` → `{"node":">=24.9.0"}` [C] + `node -v` [D] | **升级 DSH 会先被 npm engines 拒绝/启动失败**，比 websearch 插件升级更上位 | 任何「升 DSH」建议必须先附 Node 24.9+ 前置条件 |
| **`@deepseek-ai/dsh-web` 版本陷阱** | `npm view @deepseek-ai/dsh-web version` → **`0.0.1-rc.1`**（`dist-tags.latest`），但同包共 **43 版本**且含 `0.2.1-rc.3/4/5`、`0.2.2-alpha.2/3`、`0.2.2-rc.1`；`dist-tags.next=0.2.2-rc.1`、`alpha=0.2.2-alpha.3` | `npm view ... dist-tags/versions` [C/D] | 与 99 裁决 7 一致：**禁止**用 `version`/`latest` 判断 web 包；但「dsh-web 包是否有独立新版本」答案是**有**（0.2.2-rc.1），不是「停在 0.0.1」 | 引用时用 `dist-tags.next` 或固定版本号 |
| **upgrade guide: `web-search-default-provider`** | `v0.2.2-alpha.2` 官方 guide 逐字：base 把 `web.searchProvider` 默认从 `deepseek-official` 改为 **`deepseek-search-api`**（直连 Search API、不再走 Messages 辅助模型请求、可能产生 Search API 费用）；**删除** `@deepseek-ai/dsh-web-search-exa` 与 `…-perplexity` 包，「A row naming either package no longer loads」 | [guide.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/upgrade-guide/v0.2.2-alpha.2/web-search-default-provider/guide.md) raw 200 [B] | 本机显式 `searchProvider: unified` → guide 原文「Compositions that set `web.searchProvider` themselves see no change」；但**若部署残留 exa/perplexity 行则加载失败**；本机 `--dump-config` 实测无两包行、`id: web` 恰 1 处 [D] | 升级前扫 composition 树 |
| **upgrade guide: `web-search-credential-modes`** | 同版本 guide：`web-deepseek-api` 的 `baseURL`/`apiKeyEnv`/`apiKey` **字段被移除**（旧值 load 不报错但被忽略），端点随 DeepSeek model route；新增 YAML-only `searchBaseURL`/`searchApiKeyEnv`/`fetchBaseURL`/`fetchApiKeyEnv`；「A pinned capability never sends the account token」 | [guide.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/upgrade-guide/v0.2.2-alpha.2/web-search-credential-modes/guide.md) raw 200 [B] | 对本插件 `deepseek` 后端**不是同一组件**，但共享 `DEEPSEEK_API_KEY`/`DEEPSEEK_BASE_URL`：`~/.dsh/llm.env` 的 `DEEPSEEK_BASE_URL=https://ai.furry.vg/v1` 会让新官方 Search/Fetch **跟到该网关**，插件 `resolveApiKey` 读同名 ref → 端点/凭证串台风险 [E，需实跑] | 升级前核对网关是否提供 `/v1/tools` |
| **upgrade guide: `web-search-defaults`（0.2.1-rc.3）** | `dsh-tool-web` 的 `searchMaxQueries` 4→**10**、`searchMaxResults` 8→**10**；`web_search` schema 广告「1–10 queries」；`dsh-web-deepseek-api` 加 `searchRequestsPerSecond=5` | [guide.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/upgrade-guide/v0.2.1-rc.3/web-search-defaults/guide.md) raw 200 [B] | 本机 profile patch 的 `tool-web` 行配 `fetch:true, searchTimeoutMs:60000`，**未设** `searchMaxQueries/Results` → 升级到 ≥rc.3 后单次 `web_search` 可启动最多 10 次 provider 搜索，插件 `concurrency=6`、遥测 `slice(0,12)` 会被截断 | 升级后复核 `tool-web` 显式 pin 4/8 |
| 0.2.2-rc.1 release notes（web 相关） | 「Search 优先向模型提供 Search API 长摘要，每来源最多 800 字符」「缺少所需凭据时不向模型提供 Web 搜索工具；新版 Web API 的抓取工具也按凭据就绪状态提供」「Web Fetch 不再拒绝非公网地址」「支持更新第三方插件包并在热更新失败时回滚上一版本」 | `GET /releases/tags/dsh-v0.2.2-rc.1` body 逐字 [B/C] | ①与插件 `RESULT_HEADER`/`TELEMETRY_TAG`/`snippet.slice(0,500)` 的呈现面叠加；②「热更新失败回滚」意味着**插件管理器可能自动覆盖就地补丁** [E]；③「凭据未就绪不提供工具」可能影响工具可见性 | 升级前评估插件管理器覆盖风险 |
| upgrade-guide 目录 | 共 12 个版本目录（v0.1.7-rc.2 … **v0.2.2-alpha.3**），**无 `v0.2.2-rc.1` 目录** | `GET /contents/docs/upgrade-guide?ref=master` [C] | rc.1 的 breaking 尚分散在 alpha.2/alpha.3 guide | 引用 alpha 版 guide 时标版本 |
| releases/tags | 官方 tag `dsh-v0.2.2-rc.1` = `66491b05e3f0`；release 发布 2026-11-04 13:07Z；仓库 `pushed_at=2026-11-04T13:06:39Z` | `GET /tags`、`/releases` [C] | 与 npm 时间互证 | 固定 ref 引用 |

---

## 3. OpenCode 新端点表（`anomalyco/opencode`）

| 项 | 发现了什么 | 证据 | 影响 | 建议 |
| --- | --- | --- | --- | --- |
| repo / 最新 tag | `default_branch=dev`，`pushed_at=2026-11-07T07:08:30Z`；**最新 v2 tag `v2.2.6`**（`dc2ffcf8bf26`）；`v2.2.5`=`9bbb8ce18c80`（99 裁决 7 的基准已过时一档） | `GET /repos`、`/tags` [C/D] | 09/09b/09c 以 v2.2.5 为「最新」→ 已漂移 | 版本基准改 v2.2.6 |
| **`websearch/` 目录文件数** | v2.2.5 = 7 文件（exa/firecrawl/index/mcp/parallel/tavily/tinyfish.ts）；**v2.2.6 = 8 文件**（新增 `provider.ts`）；dev HEAD 同 8 文件。`WebSearchPlugins` 仍是**5 个** provider | `GET /git/trees/{v2.2.5,v2.2.6,dev}?recursive=1` + raw `index.ts` [A/C] | 新增的是**抽象层不是 provider**：`provider.ts` 由 commit `a809a4755fb1`（11-02，`refactor(core): share web search plugin integration setup (#61162)`）引入，统一 `ctx.integration` + `ctx.websearch` 注册 | 订正「websearch 目录 7 文件」；勿写「新增第 6 个 provider」 |
| **`web_search` tool schema** | v2.2.5 / v2.2.6 / dev **三版逐字相同**：`Input = Schema.Struct({ query: Schema.String.annotate({description:"Websearch query"}) })`，`Output={provider, results}`，description 含 `The current year is ${new Date().getFullYear()}`。**没有** `count`/`domains`/`allowed_domains` 字段 | raw `packages/core/src/tool/plugin/websearch.ts@三 ref:20-30` [A] | 99/09 的 schema 结论仍成立；**PR #58636（`Input.count` passthrough）与 #58635（session linkage / `ori_question`）仍 open** → 官方 DSH 的 `ori_question` 在 OpenCode 侧尚无对应 | 并入时不要假设 OpenCode 支持 count/域过滤 |
| **Brave re-land #58334（题面点名）** | **真 PR 号是 #58334**（`feat(core): add brave web search`，open、`merged=false`、2 commits、6 文件 +344/−11、含 `packages/core/src/plugin/websearch/brave.ts`，`head=brave-websearch`，自 10-23 无更新）；另有 **issue #58328**（re-land 请求，open）与 **已 closed 的 #48222**（stale-bot 关掉、从未 review） | `GET /pulls/58334`、`/pulls/58334/files`、`/issues/58328`、`/issues/48222` [A/C] | `brave.ts` **未进任何 tag**（v2.2.6 的 8 文件里没有） | 表述为「Brave 有两个 open 编号，均未合并」 |
| **Nimble #62220 / SearXNG #59138 / SearchBase #54339** | Nimble #62220 = **open issue**（11-06 报，「Add Nimble as a built-in web search provider」，**不是已合并 PR**）；SearXNG #59138 = open issue（10-26）；SearchBase #54339 = **closed `state_reason=not_planned`**（10-21，未实现）；另有 #58635/#58636/#54311/#50217 open | `GET /issues/{n}` [C] | 题面「Nimble #62220」若写成「新端点」属误读；SearchBase 不是「已合并」 | 三个都标「未落地」 |
| **PR #61557（新策略面）** | `feat(core): add a websearch.use policy action` **已合并**（11-04 10:13Z）。Console 现在可发 `websearch.use` 语句，按 provider ID（`opencode`/`exa`/`firecrawl`/`parallel`/`tavily`/`tinyfish`/插件自定义）**移除** provider；当全部移除时 `websearch` 工具从模型可用工具中消失；文档称「clients older than 2.2.6 ignore it」 | `GET /pulls/61557` body 逐字 [B/C] | 这是**权限/计费面的新端点**，25 报告完全未覆盖；我们插件无对应 policy 面 | 若做 DSH guard/permission 对齐，参考「无 provider 即隐藏工具」语义 |
| **Console hosted web search 计费/权限文档** | `services/site/src/docs/content/console/websearch.mdx@v2.2.6` 逐字：**每次成功搜索 $0.01**、计入 workspace balance 与 member spending limits、失败与限流不计费、最多 8 条结果、零数据保留、owner/admin 在 Integrations 里 Enable、成员 `/connect`；`websearch.mdx` 另给 `permissions` 的 `action:"websearch"` + `resource` + `effect:"ask"`，以及 `websearch:false` 禁用工具、429 时 `Retry-After`（无有效值则 60s）冷却 + 换 provider | raw 两份 mdx 200 [B] | ①`Retry-After` 冷却是**官方已有做法**，本机 `breaker.js` 用固定 60s 不读（见 §6）；②「最多 8 条」与本机 `numResults=8` 数值巧合（99 已标 E）；③文档路径 **v2.2.5 `services/www/` → v2.2.6 `services/site/`** 迁移，旧固定 ref 在 dev 下 404 | 引用固定 `v2.2.6` ref；冷却逻辑可参考官方 |
| **firecrawl/tinyfish 是否落后** | 官方 `websearch.mdx@v2.2.6` providers 表仍列 5 个：Exa/Firecrawl/Parallel/Tavily/TinyFish（TinyFish key 标 optional）；无新增 provider | raw [B] | **未落后**；反而 OpenCode 有 #50217 open「Firecrawl provider always returns No search results found」、#54311「keyless 未文档化、random 会卡在失败 provider」 | 保留两后端，但注意官方自身也有 firecrawl 稳定性问题 |
| dev 分支其它动态 | 11-07 dev 最新 commit `21bf6b49`（`load Console instructions and skills from their own endpoints #62507`）；近 30 条 dev commits **无 websearch provider 新增**；`websearch-machine.ts` 等 app 层文件在 v2.2.6 起大幅扩张（21983B） | `GET /commits?sha=dev&per_page=30`、tree [C] | 前进方向是 Console 集成/策略，不是 provider 扩容 | 监控 `websearch.use` 而非新 provider |

---

## 4. 代码角落发现表（9 个 lib 文件 + settings-api 并发/唯一性，逐字实读）

> 基线：`/home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/lib/`（Lead 修补后的 13 后端版）。除特别注明外均为 [A]。

| # | 文件:行 | 发现了什么 | 影响 | 建议 |
| --- | --- | --- | --- | --- |
| **4.1** | [`cache.js:36-46`](file:///home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/lib/cache.js) + 调用点 `provider.js:231` | **缓存键缺陷（新 P1）**：键只含 `{q, f: filters, n: maxResults, b: 排序后的 enabledBackends, m: cacheMode}`，而 `cacheMode` 仅编码 `multiQuery`/`deepCoverage`。**不含** `safeSearch`、`rerank`、`dedupStrategy`、各 `*BaseURL`/`*Model`、`searxngBaseURLs`、`resultHeader`、`resultTelemetry`（`normalizeFilters` 只保留 recency/lang/region，`filters.js:36-45` 明确丢掉其它键）。`node` 内联实证：`safeSearch:true→false`、`rerank:false→true`、`dedupStrategy:url→url+title`、`searxngBaseURL:https://searx.be→http://127.0.0.1:8385` 两组配置产生**同一键 `f81ac8a5e2b7fd3a58f335c7f25043c3`** [D] | 用户改这些开关后，TTL 内（默认 `cacheTtl=900s`）**仍返回旧顺序/旧实例/旧安全过滤的结果**；`safeSearch` 实测进 `brave.js:39`/`searxng.js:45` 请求参数、`openai.js:51` 读 `options.model`，都是真实结果决定项 | 把结果决定子集纳入 `cacheKeyFor` 的 canonical JSON，或设置变更时清缓存；补「改开关→键必变」回归测试 |
| **4.2** | `cache.js:112-128` + `provider.js:232-262,475` | **空结果被主动缓存**（`provider.js:475` 对 `allFailures.length===0` 且 0 条命中也 `cache.set`），但**缓存命中路径只接受 `hit.value.sources.length > 0`**（`provider.js:232`）→ 空结果缓存文件**永远不会被命中**，只是白写盘并占 `maxEntries=200` 配额 | 无害但浪费；`evict()` 按 mtime 淘汰会误删仍有效的非空缓存 | 要么让空结果可命中，要么不写空结果 |
| **4.3** | `health.js:57` + `index.js:373,94-95` | **keyless 误分类**：`health.js` 用 `beOpts.requiresKey !== true` 判 keyless，而 `index.js:373` 用 `DEFAULT_KEY_ENV[id] !== undefined` 设置 `requiresKey`。`firecrawl`/`tinyfish` 在 `DEFAULT_KEY_ENV` 里有 `FIRECRAWL_API_KEY`/`TINYFISH_API_KEY` → 虽是 hosted keyless tier，health 仍报 `keyless:false`。实测 `/health` 返回 `keyless:4`（exa/parallel/ddg/searxng）[D] | 与 `client.js:31-32` 的 `optionalKey:true, metered:true` 口径冲突；GUI/运维会误判「需密钥」 | `requiresKey` 改为「`requiresKey && !optionalKey`」，或给 health 传 `optionalKey` |
| **4.4** | `prompting.js:56-58,78-91` + `provider.js:25` | [36](36-lead-prefindings.md) 已指出 `QUERY_GUIDANCE_EN/ZH` 是死导出；**补充**：`RESULT_HEADER_ZH/EN` 的注释仍写「Anthropic：结果先于问题显著提升引用召回」，而 99 裁决 5 / REPORT §六已把该归因**标 E 并证伪**（官方 0 命中）→ **错误归因留在源码注释里**，且结果头随每次搜索注入模型可见文本 | 模型看到的指令头带未经证实的权威引用；文档债落到代码 | 删掉该归因句，保留可证实的三家引用义务（99 裁决 5 为 B 级） |
| **4.5** | `provider.js:417-420,464-465` + `index.js:154-320` | **`opts.resultHeader === false` 是永不可达的死开关**：`Config`（55 字段）里**没有** `resultHeader` 字段，`resolveOptions()` 也不产出它；注释却写「可用 `opts.resultHeader === false` 关闭」 | 运维以为有关闭手段，实际无法关闭结果呈现头 | 要么加 Config 字段（+ description + volatile + 缓存键），要么删注释与分支 |
| **4.6** | `provider.js:435-450,249` | 遥测行 `TELEMETRY_TAG=" (diagnostic only, not a source)"` 与 `[websearch cache] cache hit, age Ns` **都进入模型可见 `content`**，但插件**不写任何 session event**。抽查本机 `session.v4.jsonl.zstd` 中 `tool/result` 事件确实含该文本（42 个事件含该串）[D] | 严格按 AGENTS.md「Model-visible ⟺ logged」：这些文本**可经 `tool/result` 重建**，不算违规；但两条是**运行时派生、非确定性**文本，重放/快照不可复现 | 若做 snapshot/REAL-composition 覆盖，须把派生文本列入 normalizer 或显式标 E |
| **4.7** | `breaker.js:29-45` + `provider.js:266-285` | 熔断是**固定 `cooldownMs=60_000`**（`BREAKER_DEFAULTS`），**不读 HTTP `Retry-After`**；`foldBreaker()` 在 `failCount>=threshold` 时每次失败都把 `cooledUntil` 重置为 `now+cooldown`，导致被限流后端在持续探测下**冷却窗口不断后移**；另有「全候选都 cooled 就 fail-open 全跑」兜底（`provider.js:263`） | 与 OpenCode v2 官方 `Retry-After`（无有效值 60s）不一致；exa 429 时应按服务端给的冷却 | 后端错误携带 `Retry-After` 时用它设 `cooledUntil`；区分「首次打开」与「已打开续期」 |
| **4.8** | `health.js:66` + `provider.js:340` | `lastError` 取 `t.error`（provider 已截 80 字符）后再 `sanitizeError` 截到 120 → 健康 API 里 firecrawl 错误被截成 `…unavailable for thi`，运维拿不到完整原因 [D 实测] | 分类诊断信息丢失 | health 端点增加未截断 `lastErrorFull`，或把 provider 截断提高到 120 |
| **4.9** | `rrf.js:14,32-55` + `multiquery.js:19-36` | RRF 实现本身正确（k=60、按 URL 去重、并列保持首次出现顺序；`node` 内联验证 3 列表共识项 `0.0497` 高于单列表 rank0 `0.0167`）。**但门控有洞**：`isComplexQuery` 只要 `q.length>60` 或命中 `COMPLEX_MARK_RE` 就开多查询，而 `COMPLEX_MARK_RE` 含裸 `和`——2.8.2 的 CJK 边界修复只在 `SEPARATOR_SPLIT_RE`（切分）里，**门控正则没同步** [E 推断自正则] | 与 arXiv:2404.01037「盲目多查询劣化」的取舍自相矛盾；`cacheMode` 因此变 `multi`，缓存键分裂 | 门控与切分共用同一套「需边界」规则；`RRF_K` 硬编码违反 AGENTS「无硬编码 tunable」 |
| **4.10** | `trust.js:82-120` + 4 个路由文件 | **fence 覆盖完整**：`/api/unified-search/settings`（`settings-api.js:84`）、`/api/unified-search/health`（`health.js:94`）、`/api/websearch/history`（`history.js:157`）、`/api/websearch/history/clear`（同 `guarded`）**四处全部调用 `rejectionFor`**；本机带 cookie 实测四端点 200、不带 cookie 均 401 [D]。`history.js:104` 的 `isTrustedApiRequest` 是零调用死代码（[36](36-lead-prefindings.md) 预发现 2） | 「`/api/unified-search/*` 是否全覆盖」答案=**是**（2 条路由都覆盖），但**两组前缀不一致**（`unified-search` vs `websearch`）；网关按前缀配策略需覆盖两组 | 删除死代码；统一前缀或文档显式列两组 |
| **4.11** | `trust.js:127-153` vs `history.js:104-117` | **两套 fence 判定结果不同**（[36](36-lead-prefindings.md) 只说「冗余」，未指出差异）：replica 只把 `cross-site` 判拒绝，`sec-fetch-site: same-site` **被放行**；旧 fence 只放行 `same-origin`/`none`，其它 `site` 一律拒。`rejectionFor` 在 host `connection` 服务存在时**根本不走 replica**（`:91-104` 直接 return），本机靠 host admission 兜住 | 在无 `connection` 服务的 headless/CI 组合里 replica 比旧 fence 宽松 | 统一为一份实现或补对齐测试 |
| **4.12** | `settings-api.js:39,155-159,183-195,247-265` | `MAX_OPS=64`、`MAX_BODY_BYTES=64KiB`、`validateOp` 逐 op 校验（`op∈{set,unset}`、`path` 必须单元素字符串、字段必须在 `Config.dict`、`set` 必须有 `value`、用 schema 函数转型）；`expectedRevision` 只在 `Number.isInteger` 时透传给 `settings.mutate`，由 host 做 CAS，冲突映射 409。[38](38-e2e-save-probe.md) 已实跑 revision 0→1→2、`expectedRevision=1` 生效 [D] | 并发写**在 host 侧**安全；但**插件侧零单测覆盖** `MAX_OPS` 边界、`expectedRevision` 缺席/非整数、409/413 分支、schema 抛错分支；`readBody` 超 64KiB 时 `rejectBody` 后只 `removeAllListeners("data")` 未 `req.destroy()`，连接可能悬挂 | 补 6 组 fixture 单测；修 `readBody` 清理 |
| **4.13** | `settings-api.js:45,130-136` + `index.js:54` | **`DISCOVERY_FIELDS` 形状发现在 13 后端下不再唯一**：`["numResults","backendTimeoutMs","enabledBackends","enableExa"]` 用 `some()`（**任一命中**即选中），而 `numResults`/`enabledBackends` 是**通用字段名**。若 host 的 `settings.describe()` 里还有别的表单恰好带这两个字段之一，会**误选到别的命名空间** → `current()` 读错值、`mutate` 写错 ns。二级兜底 `row.ns === "dsh-websearch"` 只在形状找不到时生效，救不了误命中 [A/E]。另 `NAMESPACE="unified-search"`（`index.js:54`）与实际 ns `dsh-websearch` **不一致**，PR #7 的 `current()` 靠**第二个** `searxngBaseURL` 兜底才命中 [A/D] | 本机实测 `settings.namespace=dsh-websearch`、`value` 55 字段 [D]，当前未误选；但这是**隐式约定而非保证** | 形状发现改 `every()` 或直接用 entry id 常量；统一两处命名空间 |
| **4.14** | `tests/lead-20261107.test.js:70-78` | **恒真测试**：第 2 个测试把修复后的 RFC1918 正则**逐字硬编码在测试文件第 71 行**，然后 `assert.equal(re.test(host), true)`；全文件**从不 `import provider.js`**（只 `import ../lib/index.js` 第 30 行）。⇒ 即使把 `provider.js:321` 改回错误的 `{3}`，该测试**仍绿** | 「14/14 单测通过」里真正验证 provider 正则的只有上游 PR #7 的 `v28x-settings-bridge.test.js`（本机未安装） | 改成从 `provider.js` 提取/导出正则再断言；或删掉并降级为「源码级静态断言」 |
| **4.15** | 安装目录 `node --test tests/lead-20261107.test.js` | **1/3 失败**：`Cannot find package '@deepseek-ai/dsh-credentials' imported from .../lib/index.js`（`ERR_MODULE_NOT_FOUND`）。`src-work/plugin/`（含测试专用 symlink）下 3/3、`tests/*.test.js` 14/14 通过 [D] | 「14/14」结论**只在特定工作副本成立**，安装目录裸跑不可复现；[25 §2](25-execution-log.md) 已提示需 symlink，但未记录「裸跑会失败」 | 报告里附「运行位置」条件 |
| **4.16** | `history.js:17-25,150-192` | 隐私安全：`toPublicEntry` 只存 `query`(≤500)/`time`/`resultCount`/`backendsOk`/`backendsTotal`；**不存 URL、不存凭证**；`clear` 是 POST 且同样过 fence。`record()` 用 promise chain 串行化写；`atomicWriteAll` 用 `${f}.${pid}.tmp` + rename | 无泄露；但**跨进程写不设锁**（注释明确 out of scope），多 `dsh web` 实例会丢更新 | 保持；多实例部署需外部协调 |
| **4.17** | `index.js:508` | `historyEnabled` 开关**真的生效**（`resolveOptions(...).historyEnabled !== true` 时 return），`cacheEnabled`/`resultTelemetry` 也生效；唯独 `resultHeader` 是死开关（见 4.5） | 排除「所有开关都失效」的误判 | — |

---

## 5. 配置 / 凭证 / 权限 / 会话日志 / snapshot（只读判断，未改）

| 项 | 发现了什么 | 证据 | 影响 / 建议 |
| --- | --- | --- | --- |
| `~/.dsh/.credentials.yaml` | `version:1` + `records["client-connection/browser-session"]`（grant，`secret`）+ `refs` 三个：`ZEN_API_KEY` / `WBGL_API_KEY` / `WBCN_API_KEY`。**插件 13 个 `*ApiKeyEnv` 引用的 ref（TAVILY/BRAVE/EXA/…/FIRECRAWL/TINYFISH）一个都不在** | 本地读（值已脱敏）[A/D] | 所有 key-gated 后端与 firecrawl/tinyfish 的 keyed 路径都走 `launchEnvironmentOf(ctx)` 兜底；本机实际靠 keyless。**不要**把「已配置」角标当凭证存在证据 |
| `web-auth.env` | `DSH_WEB_STATIC_TOKEN=<8 字符>`，由 `dsh-web-run-native.sh:8-10` `.` 导入并 `set -a` 导出；`dsh-web.log` 里的 `?token=` 是**另一个 43 字符**的运行时 URL token（两者都能 303 换 cookie，实测）[D] | [A/D] | 两份 token 语义不同；报告里勿混用；**全文未写值** |
| `prompt-inject.md`（反直觉） | `~/.dsh/prompt-inject.md`（25KB）是一份**越狱/角色覆写提示词**（`[MODE: UNRESTRICTED SANDBOX]`、「PRIME DIRECTIVE: 名字是 YG」等），**并非无人引用**：`dsh-purge-community` 插件 `lib/community.js:448`、`lib/core.js:82,86,1561,2388,2400,5537,5568,5576` 明确读它并「hang full prompt-inject at head」注入 system prompt；组合树里 `id: dsh-purge` 启用且 `inject: [systemPrompt]` | 本地读 + `dump-config` [A/D] | **[35-deep-dig-b.md](35-deep-dig-b.md) §0.5 写「没有被任何配置引用」是错的**（见 §7 D15）。但当前启动日志报 `dsh-purge-community: failed to import: ERR_MODULE_NOT_FOUND yaml`（`dsh-web.log:5`），故**该注入当前未生效** → 运行时事实，不是配置事实 |
| `dump-config` 全树 | `id: web` **恰好 1 处**（第 548 行，`config: searchProvider: unified`）；全树 `fetchProvider` **0 处**；`id: dsh-websearch` 在 1463 行；无其它 provider 冲突；`id: tool-web` 存在但 `disabled: true` | `dsh web --dump-config`（只读）[D] | 与 [24 裁决](24-p0-landing-correction.md) 一致；env `DSH_WEB_FETCH_PROVIDER` 不进 config 树（正常） |
| 启动脚本 vs drop-in（env 覆盖） | `dsh-web-run-native.sh:16` 导出 `DSH_EGRESS_FORWARDER=http://172.30.0.1:13070/fwd`、`:17` `DSH_PERMISSION_MODE=danger-full-access`、`:18-19` `NO_PROXY`；systemd drop-in 另给 `DSH_WEB_FETCH_PROVIDER=http` + `HTTP_PROXY`/`HTTPS_PROXY` 三个 env。**`DSH_EGRESS_FORWARDER_PROXY` 在进程 environ 中计数 = 0** [D] | [A/D] | 2.8.5+ 的 forwarder spec 依赖 `_PROXY` 或回落 `HTTPS_PROXY`（`egress-fetch.js@main:50-51`），本机 2.8.4 **根本不认识** `DSH_EGRESS_FORWARDER`（关键字计数 0）→ 该 env 当前**纯属无效配置**，放任存在会误导「sidecar 已接线」判断 |
| sessions（`.zstd`） | `/home/dsh/.dsh/sessions/` 共 326 文件，含大量 `session.v4.jsonl.zstd`；`zstd -dc` 抽查 `--home-ova-dsh--/a9854926…` 命中 `firecrawl`(1457)、`tinyfish`(1137)、`web_search`(1403)、`unified-search`(108)、`searchProvider`(218) 次；`tool/result` 中确有 `[websearch backends]`/`diagnostic only` 文本（42 个事件含该串）[D] | [D] | 模型可见文本可经 `tool/result` 重建 → 满足 AGENTS 日志不变量；但派生遥测不可重放（见 4.6） |
| snapshots | 与本主题相关的两个场景：`snapshots/session/web-search-endpoint-guidance/`（profile `headless`、composition `web-search-endpoint-guidance`、fixture 打 `web-search-deepseek` 的 401）、`snapshots/web/web-search-round/`（profile `web`、composition `web-default`、两次 `web_search`、`ui.expected.md` 记录「Searched the web」卡片）。另有 `snapshots/sdk/*/tool-schemas.expected.json` 含 `web_search` schema（queries 1–4） | 逐文件读 [A] | **只读判断：本次改动不需要更新 snapshot**——改的是**第三方插件**（`node_modules` 内）、未改 `packages/web/`、未改 `web_search` 工具 schema、未改 `SessionEventMap`；`web-search-round` 用 `web-default` 组合（不含本插件），`web-search-endpoint-guidance` 用 headless 组合 + 自有 fixture。**但**若把 13 后端/遥测头并入 shipped profile，必须按 `docs/testing.md:53` 新增 keyless recorded-session 场景 |
| `docs/testing.md` 要求 | `:39`「Product-visible plugins require a non-unit **REAL-composition** test」；`:53`「Every non-trivial model-, protocol-, or human-visible change adds or updates a keyless recorded-session **snapshot** in the same PR」；`:55` 明确「package, e2e, mock-only, and rationale evidence does not replace the assembled transcript」 | [B] | **我们不满足**：现有 14 个测试全是 fixture/`readFileSync` 源码级断言（`lead-20261106.test.js` 有 22 处 `assert.match(src, …)`），**无一个**通过 Loader 起 shipped composition、无 keyless recorded-session 更新。[25 §3](25-execution-log.md) 的「单测 14/14」不能替代这两条 gate [E，需用户裁定是否立项] |
| `git status` | checkout 有若干**与本任务无关**的既有改动（`docs/user/guide/*`、`website/docs.ts`、若干未跟踪文件），`snapshots/` **无改动** | `git status --short` [D] | 本任务全程只读、未碰这些文件 |

---

## 6. 运行时健康分类表（2026-11-07 15:xx–22:xx，只读，带 GUI cookie）

> 认证方式：`curl -c/-b /tmp/dsh.cookies 'http://127.0.0.1:3080/?token=…'` 拿 `dsh-auth-*` 会话 cookie；三个端点均 HTTP 200。不带 cookie 均 401 `{"ok":false,"error":"untrusted request"}`（fence 生效）。服务在 20:09:22 重启过，PID 262230 → **347337**，重启后 `enabled=6 / keyless=4` 不变。

| 后端 | health `reachable` / `lastError` | history 观测（ms / failCount / cooled） | 分类 | 可操作建议 |
| --- | --- | --- | --- | --- |
| exa | `true` / null（15:xx 一次为 `HTTP 429`） | `ok:true 12034ms failCount:0` | **额度限制**（429，非代码缺陷）。环境抖动成分：单次 12s 已接近 30s 全局超时 | 解析 `Retry-After` 设 `cooledUntil`（见 4.7）；勿因偶发 429 长期关后端 |
| parallel | `true` / null | `ok:true 14286ms failCount:0` | 正常（但延迟高，环境抖动） | 与 exa 同属 MCP 三步握手；保留 |
| ddg | 15:xx `false / "unified search aborted"`，**22:xx 已恢复 `true`** | `ok:false 5002ms failCount:7 cooled:false` | **代码缺陷 + 环境抖动**：本机 2.8.4 `ddg.js:39` 仍是 **POST form**，而 2.8.5 CHANGELOG 已把 POST 判定为「被 bot wall 拒（method + 指纹双 gate）」并改 **GET**（`main/ddg.js:43`）；且本机 `BACKEND_TIMEOUT_OVERRIDES_MS.ddg=5000`（`provider.js:39`），2.8.6 已升到 **8000**（实测抓页达 7.7s）→ `5002ms` 正好是被 5s 超时砍掉，错误文本被误标 `unified search aborted`（2.8.6 才修超时分类） | 移植 2.8.5 的 `ddg GET form` + 2.8.6 的 `8000ms` + 超时分类；**最划算的单点修复** |
| searxng | `false / "SearXNG: invalid JSON response"`（持续） | `ok:false 4201ms failCount:8 cooled:false` | **环境/反爬**：`https://searx.be` 对非浏览器返回 200 HTML 反爬页；本机 2.8.4 `searxng.js` 无 `ANTI_BOT_RE` 也无「JSON 且 `results[]`」语义健康门（2.8.6 才加），所以错误文案不友好且**可能把反爬页当成功重置熔断** | ①启用 2.8.6 语义健康 + `searxngBaseURLs` 多实例 failover；②按 PR #7 把 `searxngBaseURL` 指向本机 `127.0.0.1:8385`（本机正则已修，可走 plain http） |
| firecrawl | `false / "firecrawl returned an MCP error: Anonymous keyless access is unavailable for thi"` | `ok:false 16855ms failCount:8 cooled:false` | **额度/服务端策略**（不是代码缺陷）：直连 `POST https://mcp.firecrawl.dev/v2/mcp` 的 `tools/call` 返回 HTTP 200 但 `isError:true`，正文逐字「Anonymous keyless access is unavailable for this request. Fix: Create an API key …」[D]。⇒ 99 裁决 6「hosted keyless tier 官方 B 级」在本机**当前实际不可用**（官方 keyless 有按 IP 额度，本机出口 IP 已耗尽或该调用类型不开放） | **默认关闭**（现已被用户手动打开）；把 `optionalKey:true` 语义改成「有 key 才真正可用」；勿把它算作可用冗余 |
| tinyfish | `true` / null | `ok:true 6824ms failCount:0` | 正常（keyless 30/min、50/日额度尚未触发） | 保留；注意日额度耗尽后会整日失败 |
| 汇总 | `enabled=6`、`keyless=4`（见 4.3 误分类）、`updatedAt` 实时 | 最近 8 条 history 中 `backendsOk` 为 2–4 / 4–6，最新一条 `3/6` [D] | **部分降级**，不再 `all enabled backends failed (4)`；与 [25 §3 V7](25-execution-log.md) 一致 | 分类：环境抖动=ddg/exa 偶发；代码缺陷=ddg POST+5s、searxng 语义健康、超时分类；额度限制=exa 429、firecrawl 匿名额度、tinyfish 日额度 |
| **sidecar / `DSH_EGRESS_FORWARDER`** | 进程 environ 有 `DSH_EGRESS_FORWARDER=http://172.30.0.1:13070/fwd`，**无 `_PROXY`**；`POST /fwd {}` → HTTP 400 `{"error":"bad url"}`（1.5ms，端口活）；带 `{"url":"https://example.com","method":"GET","proxy":"http://172.30.66.1:1091"}` → **HTTP 200 / 577B / 3.47s** [D] | — | sidecar **可达且按 spec 可用**；但 **2.8.4 `egress-fetch.js` 里 `DSH_EGRESS_FORWARDER`/`forwarderFetch` 关键字计数 = 0** → env 被静默忽略；本机搜索实际走 Lead 补的 `host: headers.host ?? target.host` CONNECT 路径（`egress-fetch.js:191,217`），**不经过 sidecar** | 保持现状（Host 修复已让 keyless 后端可用）；**不要**把「sidecar 200」当成「升级前置已满足」——若真升级到 ≥2.8.5，务必补 `_PROXY` 并把 sidecar 主机加入 `NO_PROXY`（2.8.6 dispatcher-hijack 复盘） |
| GUI / 服务 | `dsh-web.service active`，启动脚本 `--patch /opt/dsh-plugins/lan-trust.patch.yml --trusted-host 192.168.1.165 --trusted-host dsh.sepic.space`；`?token=` → 303 → 200；启动日志有 `1 entry did not activate`（`dsh-purge-community` 缺 `yaml`） | [D] | 与本主题无关，但说明**有一个已启用插件整体未激活**（影响系统提示注入，见 §5） | 单独立项 |

---

## 7. 文档债清单（逐条核对「待用户裁定 / 仍 E / 未执行」当前真实状态）

> 汇总源：99 §待裁定、20 §6/§10、21/22、23、24、REPORT §一/§五/§六/§七、25、00/02/08 裁决注记、35-deep-dig-b。标记：**失效**=仍写旧状态且已被事实推翻；**部分失效**=需补限定；**仍准确**。

| # | 条目（出处） | 报告写的状态 | 2026-11-07 真实状态 | 判定 |
| --- | --- | --- | --- | --- |
| D1 | Issue #8 作者只回「稍等稍等，马上解决!」（99 裁决 2 / 23 §1 / 11 §7.2 / REPORT:176） | 「截至采样未修、仍 open」 | 作者 **11-07 05:10 新增「ok了，感谢」**，但 issue 仍 open、无发布、无 commit | **失效**（缺第二条评论与「口头已修/未发布」区分） |
| D2 | 「PR #7 / Issue #8 仍 open，须在升级前复查」（99/23/REPORT） | 待复查 | 仍 open（PR #7 无 review 无新 commit），且**本机已自行移植两处修复** | **部分失效**：上游状态仍真，但「对升级是阻塞」已由本机自修解除；应改写为「升级会覆盖本机修复」 |
| D3 | 「P0① 需在 `cordis.patch.yml` 补 `fetchProvider: http`（只写进报告，未执行）」（REPORT:60 / 99 裁决 2 旧文） | 未执行 | **已执行**，且走 [24 裁决](24-p0-landing-correction.md) 的零文件编辑解：systemd drop-in `DSH_WEB_FETCH_PROVIDER=http`，服务已重启；`web_fetch` 实跑 200（25 §3 V6） | **失效** |
| D4 | 「零部署依赖 E 级备选（补 `headers.host ?? target.host`）未实施、未提 PR」（99 裁决 2 末 / REPORT:23） | 未实施 | **已实施**：`egress-fetch.js:191,217` 两处都补了 Host；25 §1 第 1/2 项、§3 V3 离线 A/B 验收 | **失效** |
| D5 | 「`web_fetch` 100% 不可用 / `WEB_PROVIDER_AMBIGUOUS`」（02/REPORT:60 正文 / 99 裁决 3） | 当前状态 | **已修复并实跑 200**（25 §3 V6、REPORT 文首 2026-11-06 16:21 注记） | **失效**（正文未改写，仅文首注记覆盖） |
| D6 | 「`web_search` 四后端全失败 `all enabled backends failed (4)`」（00/02/08 正文） | 当前状态 | `enabled=6`、history 最新 `backendsOk 3/6`、tinyfish/exa/parallel 成功（§6） | **失效**（作为历史过程记录可保留，不可当现状） |
| D7 | 「本机仍装 2.8.4、未升级」 | 未执行 | **仍准确**（`package.json` 2.8.4） | 仍准确 |
| D8 | 「当前进程 PID 2085 已设 `DSH_EGRESS_FORWARDER`/`_PROXY`」（REPORT:23 / 23 §3） | 旧 PID + `_PROXY` 已配 | PID **262230 → 347337**（服务 20:09:22 重启）；`_PROXY` **实测不存在**（计数 0）；`DSH_EGRESS_FORWARDER` 仍在但被 2.8.4 忽略 | **失效**（两处事实错误 + PID 二次漂移） |
| D9 | 「`enableFirecrawl`/`enableTinyfish` schema 默认 false，需用户在设置面板打开」（99 待裁定 3 / 25） | 需用户打开 | **用户已打开**（`settings.user` 为 true，`revision` 从 0→7，[38](38-e2e-save-probe.md) 实跑 POST 闭环） | **部分失效**：默认值描述仍真，「需用户打开」已过期 |
| D10 | 「P0 执行授权：仍未执行 升级 2.8.8 / 提上游 PR / 浏览器手工填测试 key 点保存」（99 待裁定 3） | 三项未执行 | 升级/提 PR 仍未执行；**保存链路已被 38 号用真实 POST 端到端实跑**（numResults 8→9→8、CAS 生效），**凭证写入链路**仍未跑（`/api/remote.mux` WebSocket 纯 curl 不可模拟） | **部分失效**：第 3 项需拆为「settings 保存=已验证 / credentials 保存=仍 E」 |
| D11 | 「PR #7 的回归测试能区分修复前后」/「14/14 全绿」（25/35-deep-dig-b §1 已标恒真 E） | 恒真风险 / 全绿 | **本机 `lead-20261107.test.js` 第 2 个测试确认恒真**（§4.14）；安装目录裸跑 1/3 失败（§4.15）；「14/14」只在 `src-work/plugin/` 成立 | **部分失效**：风险已坐实，需在 99/25 补注 |
| D12 | 「OpenCode v2 主线最新 tag `v2.2.5`（99 裁决 7）」 | 最新 | 最新 **v2.2.6**（`websearch/provider.ts` 新增、文档 `services/www→services/site` 迁移） | **失效** |
| D13 | 「OpenAI/Anthropic 官方字段因出口 403 降 E」（03/10 旧文） | E | 99 裁决 5 已用美国 egress 升 B；**仍 E 的只剩** Anthropic「结果块置于问题之前提升引用召回」、Brave `result_filter`/`summary` | 仍准确（99 已就地裁决，专题正文保留为快照） |
| D14 | 「Firecrawl hosted keyless tier 官方 B 级、并入时建议默认关」（99 裁决 6 / REPORT:113） | B + 默认关 | 官方事实仍真，但**本机当前 keyless 调用被服务端拒**（§6 直连 `isError:true`）；且本机已被用户打开 | **部分失效**：需补「本机出口当前匿名额度不可用」实时限定 |
| D15 | 「prompt-inject.md 没有被任何配置引用」（35-deep-dig-b §0.5/§8；本路径旧索引 §被 Lead 采纳 表亦沿用） | 无引用 | **`dsh-purge-community` 明确引用**（`lib/community.js:448`、`lib/core.js` 多处），组合树 `id: dsh-purge` 启用且 `inject:[systemPrompt]`；只是该插件当前因缺 `yaml` 导入失败未激活 | **失效**（备份版新引入的错误，须订正） |
| D16 | 「6 处 404 链接未实际替换」「8 条约定引入 commit 仍 E」「未跑 vitest / `pnpm test`」（20 §10 / REPORT §六） | 未执行/E | **仍准确**（本轮为只读第三方插件研究，未跑 DSH 测试套件、未改仓库文档） | 仍准确 |
| D17 | 「task 板 task-10 无法 claim→complete」（20 §10） | 工具未注入 | **task-18 同样无法**（本会话 `Tool.listTools` 无 `team_task_*`）；索引记「Lead 代为 claim→complete（revision 2→3）」 | 仍准确（且新增同因实例） |
| D18 | 「无 `dev:web` watcher → Web 工件改动需重建」（23 §5 / REPORT:60） | 现状 | 仍准确（未启动 watcher） | 仍准确 |

---

## 8. 反直觉 / 盲点（12 条，均给证据；★=25 报告与六专家均未覆盖）

| # | 发现 | 证据 | 影响 / 建议 |
| --- | --- | --- | --- |
| ★B1 | **缓存键碰撞**（P1，见 4.1）：改 `safeSearch`/`rerank`/`dedupStrategy`/`searxngBaseURL` 后仍吃旧结果，`node` 实证同键 | `cache.js:36-46`、`provider.js:231`、内联 `node` [A/D] | 修 `cacheKeyFor` 输入或设置变更清缓存 |
| ★B2 | **恒真测试**：修复后的正则被硬编码进测试再断言；`node --test` 安装目录 1/3 失败 | `tests/lead-20261107.test.js:71`、两次实跑 [A/D] | 「14/14」需附运行位置与静态断言限定 |
| ★B3 | **`NAMESPACE` 与真实 ns 不一致**：`index.js:54` 是 `unified-search`，live `/settings` 返回 `namespace:"dsh-websearch"`；PR #7 的 `current()` 靠**第二个** `searxngBaseURL` 形状兜底才命中；`settings-api.js:135` 靠 `ns==="dsh-websearch"` 才找到 → **同一插件里两套命名空间口径** | 本地读 + 认证 GET [A/D] | 统一常量；形状发现改 `every()` |
| ★B4 | **`DSH_EGRESS_FORWARDER_PROXY` 根本没设**，但 23/REPORT 写「`_PROXY` 已配」；sidecar 带 `proxy` 字段实测 200，但 2.8.4 代码计数 0 → 整条 sidecar 链路是**摆设** | `/proc/<pid>/environ`、drop-in、`egress-fetch.js` grep、两次 curl [A/D] | 订正文档；升级前补齐并加 `NO_PROXY` |
| ★B5 | **两个 token 语义不同**：`web-auth.env` 的 8 字符 static token 与 `dsh-web.log` 43 字符 URL token 都能换 cookie；38 号用了后者、本轮用前者，结论一致但报告不说明会让人以为只有一个 | 两文件 + 双 303 实测 [D] | 文档统一标注来源 |
| ★B6 | **`prompt-inject.md` 不是「无人引用」**：越狱提示词由 `dsh-purge-community` 注入 system prompt，但该插件因缺 `yaml` 导入失败**当前未激活** → 「有配置、无运行时」的反直觉状态 | `dump-config`、`lib/community.js:448`、`dsh-web.log:5` [A/D] | 订正 35-deep-dig-b；单独评估缺失依赖 |
| ★B7 | **官方 `0.2.2-rc.1` 的 `engines.node>=24.9.0` 与本机 v22.20.0 冲突**：所有「升级 DSH」建议的更上位阻塞，25 报告零覆盖 | `npm view ... engines`、`node -v` [C/D] | 升级建议前置 Node 24.9+ |
| ★B8 | **`resultHeader` 是 Config 里不存在的死开关**、**`resultTelemetry=false` 已在本机生效**（`settings.user` 有该值）→ 模型可见的结果头永远开、遥测行永远关；两者都进 `content` 且无独立 session event | `provider.js:419,435`、`index.js` Config 55 字段、live settings [A/D] | 要么补 Config 字段，要么删死分支；遥测关闭后运维只能靠 `/health` |
| ★B9 | **ddg 的 `5002ms` 失败是 5s 硬超时 + POST form 双缺陷**，而 2.8.5/2.8.6 CHANGELOG 早已给出 GET+8s+超时分类三解；「unified search aborted」文案会让人误以为用户取消 | `ddg.js:39`、`provider.js:39`、raw `main/ddg.js:43` / `main/provider.js:44-46`、history `ms:5002` [A/C/D] | 单点移植三处，收益最高 |
| ★B10 | **PR #2 是 closed 但未合并**（`merged=false`），Issue #1 却标 `completed` → 「issue 已闭环」不等于「修复进发布版」；主仓库 `main` 至今无那两行 `t: props.t` | `GET /pulls/2`、`/issues/1`、raw `main/client.js` [A/C] | 引用 issue 状态时附 PR 合并状态 |
| ★B11 | **官方 upgrade-guide `web-search-defaults`（0.2.1-rc.3）把 `searchMaxQueries` 4→10**，而本机 profile patch 的 `tool-web` 未 pin → 一旦升 DSH，单次 `web_search` 可扇出 10 次 provider 搜索，插件 `concurrency=6` 与遥测 `slice(0,12)` 同时承压 | guide raw、`cordis.patch.yml`、`provider.js:443` [A/B] | 升级前显式 pin 4/8 |
| B12 | **`websearch` 官方目录在 v2.2.5→v2.2.6 从 `services/www/` 迁到 `services/site/`**：09/09b/09c 里所有 `services/www/src/docs/...` 固定 ref 在 dev 下 404，但文档正文（5 provider、429 Retry-After、`$0.01`）几乎逐字未变 | 两 tree + 两 raw mdx [A/B/C] | 链接改固定 `v2.2.6` ref；结论不受影响 |

---

## 9. 按优先级的总建议清单（每条含等级 + 证据；**只读判断，全部未执行**）

| 优先级 | 建议 | 等级 / 证据 | 前置 / 风险 |
| --- | --- | --- | --- |
| **P1-1** | 修 `cacheKeyFor` 输入集合：把 `safeSearch`/`rerank`/`dedupStrategy`/各 `*BaseURL`/`*Model`/`language`/`numResults`/`resultHeader`/`resultTelemetry` 纳入 canonical JSON，或设置变更时 `cache.clear()`；补「改开关→键必变」回归测试 | [A/D] `cache.js:36-46` + `node` 同键实证 | 会改变缓存命中率；需用户批准改源码 |
| **P1-2** | 移植上游 2.8.5/2.8.6 的 ddg 三件套：`ddg.js` POST→GET、override 5000→8000、超时分类为 timeout；可显著减少 `ddg ✗` 与误导性 `unified search aborted` | [A/C/D] `ddg.js:39`、`provider.js:39`、CHANGELOG 2.8.5/2.8.6、history `5002ms` | 单点、低风险；需重放升级补丁时一并纳入 |
| **P1-3** | `settings-api.js:45` 的 `DISCOVERY_FIELDS` 从 `some()` 改 `every()`（或直接按 entry id 常量），并统一 `index.js:54 NAMESPACE` 与真实 `dsh-websearch` 命名空间 | [A/D/E] 4 字段中 2 个通用名 + live ns 不一致 | 改错会找不到表单 → 必须配 fixture 测试 |
| **P2-1** | 把 `lead-20261107.test.js` 第 2 个测试改为从 `provider.js` 提取/导出正则再断言；报告把「14/14」限定为「`src-work/plugin/` 测试专用 symlink 下」，并记录安装目录裸跑 1/3 失败 | [A/D] 两次 `node --test` stdout | 纯测试改动 |
| **P2-2** | `health.js:57` 的 `requiresKey` 与 `client.js` 的 `optionalKey` 对齐，让 firecrawl/tinyfish 正确报 `keyless`（或新增 `metered` 字段） | [A/D] `/health` `keyless:4` | 只影响展示 |
| **P2-3** | `breaker.js` 支持后端返回的 `Retry-After`（官方 OpenCode v2 已有此语义），并区分「首次打开」与「已打开续期」；`health.js` 增加未截断 `lastErrorFull` | [A/B/D] `breaker.js:29-45`、官方 `websearch.mdx@v2.2.6` | 需后端把 header 传到 provider |
| **P2-4** | firecrawl 改回**默认关**（本机匿名 keyless 已被服务端明确拒绝），或改为「有 `FIRECRAWL_API_KEY` 才启用」；health 里把它标成 `degraded/quota` 而非普通失败 | [D] 直连 MCP `isError:true` 正文 + `/health lastError` | 与 99 裁决 6「建议默认关」一致，但需撤销用户当前手动打开（改状态，需批准） |
| **P2-5** | SearXNG：启用 2.8.6 的语义健康（`results[]` 门 + `ANTI_BOT_RE`）+ `searxngBaseURLs` 多实例；或按 PR #7 把 baseURL 指向本机 `127.0.0.1:8385`（本机正则已修可走 plain http） | [A/C/D] raw `main/searxng.js:9-31,171-193`、CHANGELOG 2.8.6 | 需有可用本地实例 |
| **P2-6** | 清理死代码/错误注释：`prompting.js:56` 的 Anthropic 未证实归因、`provider.js:417` 的 `resultHeader` 死开关注释、`history.js:104` 的旧 fence（并统一 `trust.js` replica 与旧 fence 的 `same-site` 判定差异） | [A/B] 99 裁决 5、[36](36-lead-prefindings.md) 预发现 2 | 纯清理 |
| **P3-1** | 升级策略文档改写：①「等上游 2.8.9 修 inject」无效（作者仅本地热修）；②升级 2.8.8 会覆盖本机 6 处修复，须做成**可重放补丁清单**（9 文件）；③升 DSH 前先满足 Node ≥24.9、核对 `DEEPSEEK_BASE_URL` 是否服务 `/v1/tools`、扫残留 exa/perplexity 行、pin `tool-web` 4/8；④本项目**不升级**为当前推荐 | [A/B/C/D] §1/§2 全表 | 需用户裁定 |
| **P3-2** | 补 `docs/testing.md:39,53` 要求的 **REAL-composition + keyless recorded-session snapshot**：现有 14 测试全是 fixture/源码级断言，不满足 gate；但本轮改动都在第三方 `node_modules`、未改 `packages/web/`/`web_search` schema/`SessionEventMap`，故**当前两个既有 snapshot 无需更新** | [A/B/D] `docs/testing.md:39,53,55`、`snapshots/web/web-search-round/`、`snapshots/session/web-search-endpoint-guidance/` | 属产品级立项，需用户裁定 |
| **P3-3** | 订正 18 条文档债（§7 的 D1–D6、D8–D12、D14、D15），特别是：Issue #8 第二条评论、PID 262230→347337、`_PROXY` 未配、web_fetch/web_search 已修复、v2.2.6 基准、`prompt-inject.md` 有引用 | [A/C/D] §7 | 只改报告，不改源码 |
| **P3-4** | 上游协作（仍未执行 [E]）：把本机 6 处修复整理成 PR 提到 `240xu/dsh-websearch`（PR #7 已覆盖其中 2 处，可只提 inject + Host + 13 后端 + ddg/searxng）；同时把 PR #5（Ark）与 `gjy1992` 的 `resolveService` 软探测列为可选参考 | [A/C] §1 | 需用户批准改状态 |
| **P3-5** | 单独立项：`dsh-purge-community` 因缺 `yaml` 包整体未激活（`dsh-web.log:5`），导致 `prompt-inject.md` 注入当前失效；以及 `DSH_EGRESS_FORWARDER` 在 2.8.4 被静默忽略的无效 env | [A/D] §5/§6 | 与本主题正交 |

---

## 10. 取证索引与诚实边界（E）

- **认证 GitHub API**：`GET /repos/{240xu/dsh-websearch, deepseek-ai/deepseek-harness, anomalyco/opencode}`、`/issues?state=all`、`/issues/8/{comments,timeline}`、`/pulls/{2,5,7,58334,61557}`、`/pulls/7/{commits,reviews,comments,files}`、`/branches`、`/tags`、`/releases`、`/commits?per_page=30`、`/forks`、`/events`、`/git/trees/{v2.2.5,v2.2.6,dev}`、`/compare/v2.2.5...v2.2.6`、`/contents/...`（raw media）。全部 HTTP 200；token 仅在 shell 变量内，**未写入本文件**。
- **npm registry**：`npm view @240xu/dsh-websearch versions/time/dist-tags`、`@deepseek-ai/dsh versions/dist-tags/time/engines`、`@deepseek-ai/dsh-web versions/dist-tags`。
- **本机只读端点**：`dsh web --dump-config`、`GET /api/unified-search/{health,settings}`、`GET /api/websearch/history`（经 `?token=` 303 换会话 cookie）、`POST http://172.30.0.1:13070/fwd` 空/带 spec 两次、`POST https://mcp.firecrawl.dev/v2/mcp tools/call`。
- **源码**：`lib/{health,history,cache,settings-api,breaker,rrf,multiquery,prompting,trust,index,provider,client}.js`、`lib/util/{filters,rank,egress-fetch}.js`、`lib/backends/{ddg,searxng,firecrawl,tinyfish,openai,brave}.js`、`tests/lead-2026110{6,7}.test.js`、`/usr/local/sbin/dsh-web-run-native.sh`、`/etc/systemd/system/dsh-web.service.d/10-websearch-lead-fix.conf`、`~/.dsh/.credentials.yaml`、`~/.dsh/web-auth.env`、`~/.dsh/prompt-inject.md`、`docs/testing.md`、`snapshots/`。
- **会话日志**：`zstd -dc /home/dsh/.dsh/sessions/--home-ova-dsh--/a9854926-…/session.v4.jsonl.zstd | python3` 统计。
- **仍 E（未核实/未执行）**：①CF 具体 WAF 规则编号；②`forwarderFor` spec 与 sidecar 逐字段一致性（本机 2.8.4 不走该路径）；③升级后是否必然恢复；④`DEEPSEEK_BASE_URL` 串台是否真实发生（需升级实跑）；⑤「插件管理器热更新会覆盖就地补丁」的推论；⑥`credentials.set` 端到端写入链路（[38](38-e2e-save-probe.md) 已说明纯 curl 不可模拟）；⑦v2 Console `websearch.use` 在 DSH 侧如何落地；⑧`isComplexQuery` 裸「和」门控实证（推断自正则，未跑）；⑨Anthropic「结果块前置」原文、Brave `result_filter`/`summary`、Firecrawl 具体日上限数字；⑩`docs/testing.md` REAL-composition 缺口是否立项（需用户裁定）。
- **任务板**：`team_task_get`/`team_task_update` 在本子代理会话未注入（`host/Tool.listTools` 全表无该工具），**task-18 未能自行 claim→complete**，已通过 `send_message` 两次报 Lead/parent 代收口；与 [20 §10](20-content-assessment.md) 记录的 task-10 同因。
- **未改任何状态**：无源码/配置/其它报告写入（本文件除外），未升级、未重启服务、未清缓存、未 POST settings（38 号另由 Lead 执行并已改回）、未提 PR。

---

## 11. 附录：保留的索引信息（原 35 行索引，逐条不删）

> 原索引声明 [35-deep-dig-b.md](35-deep-dig-b.md)（191 行 / 45KB，19:44 落盘）为备份版权威；两次 fork 失败记录 `a8c17a73…`、`4b5b4949…`（closing message 分别为「I have all evidence. Let me write the report.」/ 无）；Lead 唤醒的备份 teammate `own-repo` 产出该报告；按「一事实一家」约定不复制 191 行。本版按用户直接指派补齐全文，与备份版**并列互补**，不覆盖、不否定其结论（唯一订正见 §7 D15：`prompt-inject.md` 实为被 `dsh-purge-community` 引用）。

| 原索引结论 | 落点 | 本版对应 |
| --- | --- | --- |
| 状态类 P0：Issue #8「ok了」未发布、无 2.8.9 / release / push，升级 2.8.8 反而覆盖本机自修 | [37 §2 F-11](37-review-synthesis-SKELETON.md) / [99 补注](99-final-verdicts.md) / [25 §12](25-execution-log.md) | §0.2、§1、§7 D1/D2 |
| 官方 `dsh` latest=0.2.2-rc.1 需 Node≥24.9.0（本机 v22.20.0）；`dsh-web` `latest=0.0.1-rc.1` 是残留 dist-tag；0.2.2-alpha.2 删官方 exa/perplexity、默认改 `deepseek-search-api` | [37 §2 F-12](37-review-synthesis-SKELETON.md) | §0.3、§2、§8 B7 |
| OpenCode v2.2.6 已发，dev `websearch/` 7→8 文件（新增 `provider.ts`），仍 5 provider、schema 未变 ⇒ firecrawl/tinyfish 未落后；文档路径 `services/www/`→`services/site/` | [37 §6](37-review-synthesis-SKELETON.md) | §0.4、§3、§7 D12、§8 B12 |
| `resultHeader` 死开关、`QUERY_GUIDANCE_*` 死导出、`isTrustedApiRequest` 死代码、`DISCOVERY_FIELDS` 多 ns 误选、settings-api 零单测、`prompt-inject.md` 无引用 | [37 §2 F-10](37-review-synthesis-SKELETON.md) / [36](36-lead-prefindings.md) | §4.4/4.5/4.10/4.12/4.13；**最后一项订正见 §7 D15** |
| 本机状态漂移：PID 262230→347337、13 后端 + 三组自修已落地、history 近期 3/6~4/6 成功（不再 all-failed(4)）；旧报告 10 条文档债 | [25 §12](25-execution-log.md) / REPORT 头部 | §6、§7（本版扩为 18 条） |
| `task-18` 由 Lead 代为 claim→complete（revision 2→3） | `team_task_list` | §0.6、§10 |

---

**本文件无凭证值、无浮动 ref 作为依据**（外部链接均固定 tag/ref 或官方 master 的 upgrade-guide 路径，并附本地 `路径:行号` 双锚点）。全程只读。
