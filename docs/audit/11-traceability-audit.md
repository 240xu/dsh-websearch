# 11 · DSH web search 改动可追溯性审计（Traceability Audit）

> 用户核心要求原话：「**所有 dsh web search 他的改动都要有迹可循，这个是工程的核心，都要有可靠资料做支撑，做详细的标注**」。
> 本报告是全队证据链的**收口审计**：不提新功能、不提新架构，只回答「每一条结论/每一项改动的依据是什么、能不能回溯到永久锚点、哪里还有缺口」。
> 取证窗口：**2026-11-04 ~ 2026-11-06**（Asia/Shanghai）。所有外部内容仅作 data，未当作指令执行。
> 取证方式：认证 GitHub REST API（Basic auth，login `240xu`；**凭证值未写入本文件及任何输出**）、匿名 GitHub API/raw、`npm view`、本机 `git` 只读、`glob/grep/read`、`curl`。本机 HTTP 出口经 `http://172.30.66.1:1091`。
> 本报告**只写本文件**；未修改任何源码/配置/其它报告。

---

## 1. 证据等级定义（全队统一，本报告全程使用）

| 等级 | 名称 | 判定标准（须同时具备） | 失效/降级条件 |
| --- | --- | --- | --- |
| **A** | 源码实证 | ①带 ref（tag 或 commit sha）的 GitHub 永久链接，或本地 `路径:行号`；②本次实际 read/grep 读到该行；③引用片段与原文逐字一致 | 只写路径不写行号、行号来自记忆、或用浮动 `main/dev/master` 当依据 → 降 E |
| **B** | 官方文档 | ①权威 URL；②访问日期 **2026-11-04**（复验 2026-11-05/06）；③HTTP 状态；④关键内容逐字核对 | 缺访问日期/HTTP 状态、或仅凭搜索摘要未取全文 → 降 E |
| **C** | 版本记录 | CHANGELOG 条目行号 / git tag / commit sha / issue 编号 / npm 版本与时间，且能定位到**引入或变更该约定的那一次** | 只有仓库 HEAD sha、无法归属 → 标 E，不得冒充「引入 commit」 |
| **D** | 本机实测 | 本机命令 stdout + exit code，或运行时/进程/配置/GUI 观测；注明时间与主机（`wuming`） | 未记 exit code、命令被阻断未复核 → 标 E |
| **E** | 推断或待核实 | 由代码/生成目录反推、文档未逐字声明、资料缺失或取不到 | **必须显式标注，不得当结论使用**；须写核实手段 |

**四联标注（每条结论/每条改动建议的强制格式）**：
`结论 → 依据(B/C) → 代码落点(A) → 验证方式(D)`；缺任一项必须标 **E**，不得用组合等级掩盖弱证据。
本报告第 3、4、5 节的因果链、第 7 节的打分、第 8 节的证据索引均按此执行。

**永久链接规则**：GitHub 链接一律带 ref（tag 或 commit sha）；**禁止用浮动 `main/dev/master` 当依据**。报告中若引用他报告的浮动链接，一律在缺口清单登记并给出替换后的固定 ref。

**审计边界**：本报告是审计，不重新推导业务结论；对 01–09c 各报告的打分只针对「可追溯性」，不评价其技术正确性。凡本报告新补的证据，均注明「新补 / 修复了某报告的 E」。

---

## 2. 审计对象与取证矩阵

| 对象 | 取证手段 | 覆盖度 | 等级 |
| --- | --- | --- | --- |
| 用户仓库 `240xu/dsh-websearch` | `commits?per_page=100`（53 条）、`tags`、`releases`、`issues?state=all`、`commits/{sha}` 的 `files[]`、`search/issues`、raw CHANGELOG/README/package.json | 完整 | C/D |
| npm `@240xu/dsh-websearch` | `versions --json`、`time --json`、`dist-tags`、2.8.6/2.8.7/2.8.8 tarball 解包与逐文件 diff | 完整 | C/D |
| DSH 官方 `deepseek-ai/deepseek-harness` | 本机 shallow git 只读 + 认证 GitHub API（`commits?path=`、`commits/{sha}`、tags、search/commits） | 完整（补上 07 的 shallow 缺口） | C/D |
| npm `@deepseek-ai/dsh*` | `versions --json`、`time --json`、`dist-tags` | 完整 | C/D |
| OpenCode v2 `anomalyco/opencode` | `repos/sst/opencode` 301、`tags?per_page=100`、`git/ref/tags/v2.2.5`、`commits/9bbb8ce…`、`commits?path=…&sha=v2.2.5` 逐文件 | 完整 | C/D |
| v2 官方文档 | `opencode.ai/v2/docs/websearch`、`/v2/docs/console/websearch` HTTP + 正文 | 完整 | B/D |
| 本机实测 | [00-lead-live-probe.md](00-lead-live-probe.md)、[02-runtime-state.md](02-runtime-state.md)、[13-raw-evidence.txt](13-raw-evidence.txt) + 本报告 2026-11-05/06 复验 | 完整 | D |
| 01–09c / 10 / 12 / REPORT | 逐文件 `grep` 结构、等级标记、浮动链接、版本号/commit 混用 | 完整 | A/D |

---

## 3. 用户仓库 `240xu/dsh-websearch` 改动谱系（「迹」的核心）

### 3.1 仓库与版本口径（C/D）

- **结论**：仓库 public、默认分支 `main`、created `2026-08-20T05:58:22Z`、pushed `2026-10-21T14:08:30Z`；GitHub **只有 2 个 tag**（`v1.0.0` → `caff1593395990e69dfd0627fd4f1c8d97293673`、`v2.0.0` → `601ba8bf3d0034bc4d8da2d47e511b9165bdd6ef`），**0 个 release**，**无 2.8.x tag**。→ **依据** [C/D] `GET /repos/240xu/dsh-websearch`、`/tags`、`/releases`（2026-11-04、11-05 两次） → **代码落点** [A] 不适用 → **验证** [D] 本报告 API 实跑，exit code 0。
- **结论**：因此 2.8.x 的版本谱系**只能靠 `package.json` 版本号 + npm 发布时间 + commit sha** 建立，**不能编造 tag 名**。这直接决定下文表格的「tag 名」列统一写「无 tag（用 commit sha）」。→ **依据** [C] tags 列表 → **代码落点** [A] 各 commit 的 `package.json` → **验证** [D] 逐 commit raw `package.json` 取 `version` 字段（见 3.2）。
- **结论**：npm 共发布 **23 个版本**，最新 `dist-tags.latest=2.8.8`（2026-11-05 复验仍是 2.8.8）；本机 profile 装的是 **2.8.4**，落后 4 个 patch。→ **依据** [C] `npm view @240xu/dsh-websearch versions/time/dist-tags --json`（原始输出见 [13-raw-evidence.txt](13-raw-evidence.txt)） → **代码落点** [A] `/home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/package.json`（`version: 2.8.4`） → **验证** [D] `python3 -c …` 读该文件，2026-11-04 与 11-05 两次一致。

### 3.2 改动谱系表（版本 → commit → 文件 → 回归测试 → 本机故障闭环）

> **列说明**：「日期」取 npm `time` 的发布时间（UTC）；「提交日期」取 commit author date（UTC），二者差几分钟属构建/发布流程，并列不作互相否定（与 [12](12-change-lineage.md) §1 注一致）。「tag 名」列统一为「无（用 commit sha）」。所有 commit 链接均为**完整 40 位 sha 永久链接**。

| 版本 | npm 发布时间 (UTC) | tag 名 | commit sha（提交日期 / message 首行） | 改动项（CHANGELOG 行号） | 触发原因 / 线上事故 | 依据 (C) | 对应源码文件与函数 (A) | 回归测试文件 (A) | 是否修复本机当前故障 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **2.8.0** | 2026-09-30T03:13:23 | 无 | [`27cc5df60257ffdc904cdda1c07af547333898f4`](https://github.com/240xu/dsh-websearch/commit/27cc5df60257ffdc904cdda1c07af547333898f4)（09-30T03:07:03Z / `v2.8.0: multiQuery RRF fusion + deepCoverage + backend capability adapters`） | CHANGELOG `:60-85`：multiQuery（RRF k=60）、deepCoverage、`/api/websearch/history` 加 `backends[]`、ddg/searxng 5s 上限 | 检索深度升级（功能需求，非事故） | CHANGELOG `:60-85` + commit files[] | 新增 [`lib/rrf.js`](https://github.com/240xu/dsh-websearch/blob/27cc5df60257ffdc904cdda1c07af547333898f4/lib/rrf.js) `rrfFuse()` / [`lib/multiquery.js`](https://github.com/240xu/dsh-websearch/blob/27cc5df60257ffdc904cdda1c07af547333898f4/lib/multiquery.js)；改 `lib/provider.js`、`lib/backends/{exa,tavily,searxng}.js`、`lib/history.js` | `tests/rrf.test.js`、`tests/v28.test.js`、`tests/v28-p2.test.js`（新增） | 否（功能版） |
| **2.8.1** | 2026-09-30T14:31:57 | 无 | [`4caca4578f729a0accbbf50805ffe92e4aee02b3`](https://github.com/240xu/dsh-websearch/commit/4caca4578f729a0accbbf50805ffe92e4aee02b3)（09-30T14:19:19Z / `v2.8.1: 0.2.0 SettingsForms adapter — Config.meta.volatile`） | CHANGELOG `:42-58`：Config 加 `meta.volatile`、移除矛盾 warn、7×ApiKeyEnv/8×BaseURL/3×Model 补 description | DSH 0.2.0 SettingsForms 自动表单不显示插件配置 | CHANGELOG `:42-58` + commit files[] | [`lib/index.js`](https://github.com/240xu/dsh-websearch/blob/4caca4578f729a0accbbf50805ffe92e4aee02b3/lib/index.js) `Config`、`cordis.patch.yml` | `tests/v281-form.test.js`（新增 +39） | 否 |
| **2.8.2** | 2026-10-03T10:14:06 | 无 | [`3ea0f08f88c1f44a9b5ebcdb718a831226f401dd`](https://github.com/240xu/dsh-websearch/commit/3ea0f08f88c1f44a9b5ebcdb718a831226f401dd)（10-03T10:12:26Z / `v2.8.2: P1 fixes — legitimate zero-results no longer forged as all-backends-failed`） | CHANGELOG `:38-40`：合法零结果不再伪造 all-backends-failed、limiter 同步抛错不再泄漏 running（死锁）、exa category 推断受 deepCoverage 门控 | 「Bug 猎场」P1×3（评审发现） | CHANGELOG `:38-40` + commit files[] | [`lib/provider.js`](https://github.com/240xu/dsh-websearch/blob/3ea0f08f88c1f44a9b5ebcdb718a831226f401dd/lib/provider.js)、`lib/backends/exa.js` | `tests/p1-regression.test.js`（新增 +53） | 部分（诊断语义，非 403） |
| **2.8.3** | 2026-10-05T02:26:35 | 无 | [`2c525ddb0340be55f6c6956634c7c6451686b51a`](https://github.com/240xu/dsh-websearch/commit/2c525ddb0340be55f6c6956634c7c6451686b51a)（10-04T06:35:30Z / `v2.8.3: empty shaped-query rejected early … ZH bare filler 搜索 added, CJK separators`） | CHANGELOG `:34-36`：空 shaped-query 提前拒绝、中文裸 filler「搜索」、CJK 分隔符需边界 | 「Bug 猎场」P2×3 | CHANGELOG `:34-36` + commit files[] | [`lib/multiquery.js`](https://github.com/240xu/dsh-websearch/blob/2c525ddb0340be55f6c6956634c7c6451686b51a/lib/multiquery.js)、`lib/prompting.js`、`lib/provider.js` | `tests/p1-regression.test.js`（+30） | 否 |
| **2.8.4**（本机装） | 2026-10-18T06:02:07 | 无 | [`5c8287453728023d7bd14705ed40b5b2fa31f9d7`](https://github.com/240xu/dsh-websearch/commit/5c8287453728023d7bd14705ed40b5b2fa31f9d7)（10-18T05:48:31Z / `v2.8.4: 0.2.1-alpha settings-section compat … proxy-aware egress CONNECT tunnel`） | CHANGELOG `:23-32`：settings 段无条件注册 + fenced bridge、`client.inject` 不再硬依赖 `settingsScope`、数值字段界值、`credentials/reference-updated`、**零依赖 CONNECT 隧道 `lib/util/egress-fetch.js`**、history/health 准入围栏 | DSH 0.2.1-alpha 兼容 + kill-switched 容器 egress | CHANGELOG `:23-32` + commit files[]（17 文件） | 新增 [`lib/util/egress-fetch.js`](https://github.com/240xu/dsh-websearch/blob/5c8287453728023d7bd14705ed40b5b2fa31f9d7/lib/util/egress-fetch.js)（+338）、`lib/settings-api.js`（+277）、`lib/trust.js`（+179）；改 `lib/client.js`、`lib/index.js` 等 | `tests/egress-fetch.test.js`（新增 +153） | **否 —— 本机当前就是这一版，故障仍存在** [D] |
| **2.8.5** | 2026-10-18T10:31:56 | 无 | [`fc737d221899d9894895695eee85053a3025b907`](https://github.com/240xu/dsh-websearch/commit/fc737d221899d9894895695eee85053a3025b907)（10-18T10:28:37Z / `2.8.5: TLS-egress forwarder (DSH_EGRESS_FORWARDER) + ddg GET form`） | CHANGELOG `:15-21`：可选 TLS-egress forwarder（Chromium-JA3 sidecar `/fwd`、`DSH_EGRESS_FORWARDER_PROXY` 默认取 `HTTPS_PROXY`）、DDG 改 GET form、3 个 forwarder 用例 | **线上事故**：部分上游按客户端 TLS 指纹 JA3 而非出口 IP 拦截，Node 指纹被拒、Chromium 通过；DDG POST 表单被 method+指纹双 gate 拒 | CHANGELOG `:19-20` + commit message 全文 | [`lib/util/egress-fetch.js`](https://github.com/240xu/dsh-websearch/blob/fc737d221899d9894895695eee85053a3025b907/lib/util/egress-fetch.js)（+66/−1，新增 forwarder 模式）、[`lib/backends/ddg.js`](https://github.com/240xu/dsh-websearch/blob/fc737d221899d9894895695eee85053a3025b907/lib/backends/ddg.js)（+6/−5，POST→GET） | `tests/egress-fetch.test.js`（+95/−1）、`tests/v21.test.js` | **机制性对应** [B/C + D]；「升级必然修复」E |
| **2.8.6** | 2026-10-18T14:04:02 | 无 | [`592237f7586bc2da428e5acf41acf40276711b3d`](https://github.com/240xu/dsh-websearch/commit/592237f7586bc2da428e5acf41acf40276711b3d)（10-18T12:27:50Z / `2.8.6: forwarder hop via node:http (dispatcher-hijack fix) + failure-path hardening`）；npm `gitHead` = [`72cbba8e3c19c77fea2396c7ac00c40b08df52a9`](https://github.com/240xu/dsh-websearch/commit/72cbba8e3c19c77fea2396c7ac00c40b08df52a9)（同日 12:35:08Z，docs: proxy-exempt marker） | CHANGELOG `:3-13`：**同名线上事故 `all enabled backends failed (4)`** —— forwarder hop 改 `node:http(s)` 直连绕开全局 `EnvHttpProxyAgent`、独立 20s ceiling、全失败诊断保留完整 cause chain 且枚举所有后端（无 >4 截断）、SearXNG 语义健康（200 无 `results[]` 不记成功/不重置熔断）、`searxngBaseURLs` failover、**DDG 超时 5s→8s**、超时正确分类 | **真实线上事故**：宿主装全局 `EnvHttpProxyAgent` dispatcher，把发往 sidecar 的一跳也代理走（`172.30.0.1` 不在 `NO_PROXY`），proxy log `dial -> sidecar ... EOF`，每次搜索全挂 | CHANGELOG `:5-13` + commit message 全文（含 `tests: 116 total (+3 forwarder regression, +12 failure-path)`） | [`lib/util/egress-fetch.js`](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/util/egress-fetch.js)（+91/−19 `forwarderFetch`）、[`lib/provider.js`](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/provider.js)（+47/−18）、[`lib/backends/searxng.js`](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/backends/searxng.js)（+162/−59）、新增 [`lib/util/describe-error.js`](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/util/describe-error.js) / [`lib/util/failure-label.js`](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/util/failure-label.js)、`lib/backends/{ddg,exa,parallel}.js`、`lib/util/mcp-client.js` | **[`tests/v286-failures.test.js`](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/tests/v286-failures.test.js)（新增 +303 行，同名事故）**、`tests/egress-fetch.test.js`（+65/−1）、`tests/v28-p2.test.js` | **完全同名同因** [B/C + A]；升级验证 E |
| **2.8.7** | 2026-10-20T12:53:52 | 无 | **未取到，待核实（E）**：npm `gitHead=608e474fdf5841bb0fcc657c221f85614c9925fc`，public 仓库 API 返回 **HTTP 422 No commit found**；`commits?path=lib/config.js` 返回 0 条；仓库无此分支 | tarball 实测：`lib/index.js` 把 Config/常量拆到新增 `lib/config.js`，`package.json` 新增 `exports["./config"]`；**无 CHANGELOG、无 README 变更** | 未知（疑似未推送的本地重构分支发布） | `npm view …@2.8.7 gitHead/dist.tarball` + tarball diff [C/D]；提交信息 **E** | npm 2.8.7 tarball 内 `lib/config.js`、`lib/index.js` | 未取到（E） | 不适用 |
| **2.8.8**（npm latest） | 2026-10-21T14:10:40 | 无 | [`8b14d5495f54a9a124c94e8e98d40c6c5d7be69c`](https://github.com/240xu/dsh-websearch/commit/8b14d5495f54a9a124c94e8e98d40c6c5d7be69c)（README +13/−1「10 秒速查」）→ [`da42e44a0f54913e132c5219174a3b6f267188fc`](https://github.com/240xu/dsh-websearch/commit/da42e44a0f54913e132c5219174a3b6f267188fc)（`package.json` `2.8.6 → 2.8.8`，= npm `gitHead`） | **CHANGELOG 无 2.8.7/2.8.8 条目**（远端 CHANGELOG 停在 2.8.6，共 294 行）；README 加「10 秒速查」；版本号对齐 | 文档/版本元数据发布 | CHANGELOG 全文 [C] + 两 commit files[] [C] | `README.md`、`package.json`；**`lib/` 零改动**（2.8.8 tarball 与 2.8.6 逐文件 diff：仅 `lib/index.js` 回退 Config 拆分、`package.json`、`README.md`） | 无新增测试 | 否（无代码变更） |

**澄清 2.8.7/2.8.8 的「版本号/commit 混用」风险（审计要点）**：
- **结论**：2.8.8 的 `gitHead` 是 `da42e44a0f54`（只改版本号），其父 `8b14d5495f54` 只改 README；**CHANGELOG 到 2.8.6 是事实，不是「远端最新 2.8.6」**。→ **依据** [C] 两 commit files[] + raw `package.json` 逐 commit 取 version → **代码落点** [A] 上表两行 → **验证** [D] `npm view …@2.8.8 gitHead` = `da42e44a0f54913e132c5219174a3b6f267188fc`（2026-11-04/05 两次）。
- **结论**：把「2.8.6 的修复」与「2.8.8 的包」等同起来是**允许的**（2.8.8 `lib/` 与 2.8.6 一致），但把 「2.8.7 的 Config 拆分」写成「2.8.8 的重构」是**错误的**——2.8.8 又合回 `index.js` 并删除 `exports["./config"]`。→ **依据** [C/D] 三个 tarball 的 `diff -rq` 与 `diff -u lib/index.js` → **代码落点** [A] `lib/config.js` 只在 2.8.7 存在 → **验证** [D] tarball 解包实跑（exit code 0）。
- **E 级保留**：2.8.7 的 `gitHead` 来源分支、为何发布后又回退，未取到，标 E，不得当结论。

### 3.3 2.8.5 / 2.8.6 完整因果链（四联标注）

```
[C] 线上事故（CHANGELOG:5）「every backend search failed with "all enabled backends failed (4)"」
  ↓ [C] 2.8.5 commit fc737d221899（10-18 10:28Z）：观察到「上游按 JA3 指纹拦截」→ 引入 Chromium-TLS sidecar /fwd（DSH_EGRESS_FORWARDER）+ DDG 改 GET
  ↓ [C] 2.8.6 commit 592237f7586b（10-18 12:27Z）：sidecar hop 仍被全局 EnvHttpProxyAgent 劫持（172.30.0.1 不在 NO_PROXY）→ forwarderFetch 改用 node:http(s) 直连 + 20s ceiling + cause chain
  ↓ [A] 代码落点：lib/util/egress-fetch.js(+91/−19)、lib/provider.js(+47/−18)、lib/backends/searxng.js(+162/−59)、新增 describe-error.js / failure-label.js
  ↓ [A] 回归测试：tests/v286-failures.test.js(+303)、tests/egress-fetch.test.js(+65)
  ↓ [C] 后续 72cbba8e3c19（12:35Z）加 proxy-exempt marker；npm 2.8.6 发布 14:04Z（gitHead=72cbba8e）
  ↓ [D] 本机 2026-11-04 实跑 2.8.4：同一错误串 + health failCount 25/26 → 落后 4 patch
  ↓ [E] 「升级 2.8.8 必然修复」未执行升级 / 未抓包定位 403 环节 / sidecar 与本机 DSH_EGRESS_FORWARDER 是否匹配 → 不得当结论
```

- **结论**：本机四个失败里三个（exa/parallel 403、全失败诊断、searxng 反爬）能在 2.8.5+2.8.6 找到**同名、同因、带回归测试**的修复；ddg 的 `redirect mode is set to error (301)` 是 `redirect:"error"` 的**预期安全行为**，不是故障。→ **依据** [B/C] CHANGELOG `:5-13,19-20` 与 `packages/web/AGENTS.md:5` → **代码落点** [A] 上表 2.8.5/2.8.6 行 → **验证** [D] [00](00-lead-live-probe.md) §4 + [02](02-runtime-state.md) §7/§8。

### 3.4 issues / PR 谱系（C）

- **结论**：`issues?state=all` 共 **8 条**（2026-11-05 复验）；与「all enabled backends failed (4)」「403」「MCP」「redirect」相关的关键词搜索（`search/issues?q=repo:240xu/dsh-websearch+403 / MCP / "all enabled backends failed" / redirect`）**total_count 全为 0** → **该事故没有对应的公开 issue 编号**，其「迹」只存在于 CHANGELOG + commit message + 回归测试。→ **依据** [C] API `search/issues` 四次查询 → **代码落点** [A] `tests/v286-failures.test.js` → **验证** [D] API 实跑（2026-11-04）。**不得编造 issue 编号**。
- 现存 8 条（编号 / 状态 / 类型 / 标题 / 创建日）：

| # | 状态 | 类型 | 标题 | 创建日 | 与 web search 故障关系 |
| --- | --- | --- | --- | --- | --- |
| 1 | closed | ISSUE | 设置卡片白屏：ToggleRow 内使用 props.t 但创建时未传入（启用需密钥后端且缺密钥时必现） | 2026-08-29 | 2.4.0 客户端 UI bug；由 PR #2 修复 |
| 2 | closed | PR | fix(client): ToggleRow 缺少 t prop —— 启用需密钥后端且缺密钥时设置卡片白屏 | 2026-08-29 | Fixes #1 |
| 3 | open | ISSUE | 升级到 dsh 0.12-rc1 之后无法使用 | 2026-09-08 | DSH 版本兼容 |
| 4 | open | ISSUE | Client fiber deadlocks web boot: settingsScope stays in inject on DSH >= 0.1.7 | 2026-10-08 | 与 2.7.3/2.8.4 的 `settingsScope` 兼容链相关 |
| 5 | open | PR | feat: add 火山方舟 (Volcengine Ark) backend | 2026-10-23 | 新后端（未合并） |
| 6 | open | ISSUE | 【BUG】保存按钮怎么没有？ | 2026-10-30 | 2.8.x 设置卡片 |
| 7 | open | PR | fix: settings are inert on DSH 0.2.x (no installSection) + RFC1918 plain-http base URLs rejected | 2026-11-04 | 改 `lib/index.js`(+18/−1)、`lib/provider.js`、新增 `tests/v28x-settings-bridge.test.js`(+57)；**未合并** |
| 8 | open | ISSUE | 保存 API Key 失败：client inject 缺少 remote.credentials（DSH 0.2.x） | 2026-11-05 | **报告人环境即 `@240xu/dsh-websearch 2.8.8` + `@deepseek-ai/dsh 0.2.1-rc.5`**，指 `lib/client.js:657` 起因；与「升级到 2.8.8 就万事大吉」矛盾，是 P0 建议必须带的风险注脚 |

> **审计发现（新补）**：[#8](https://github.com/240xu/dsh-websearch/issues/8) 是 2026-11-05 新报的 issue，晚于 01–09c 多数报告的取证窗口。**任何写「升级到 2.8.8 即可」的最终报告，都应附 [#7](https://github.com/240xu/dsh-websearch/pull/7) / [#8](https://github.com/240xu/dsh-websearch/issues/8) 这两个 open 项作为 E 级风险**，否则属于「用旧快照冒充当前事实」。→ **依据** [C] `GET /issues/8`、`GET /pulls/7/files` → **代码落点** [A] `lib/client.js:657`（#8 原文引用）、`lib/index.js`（#7） → **验证** [D] 2026-11-05 API 实跑。

---

## 4. DSH 官方仓库 web 包版本谱系

### 4.1 版本链（C/D）

- **结论**：源码 checkout `/home/ova/dsh` = **`0.2.1-alpha.2`**（`git describe` → `dsh-v0.2.1-alpha.2`；HEAD [`d743267388641bc76f17c45ce8b4c231aed1d32c`](https://github.com/deepseek-ai/deepseek-harness/commit/d743267388641bc76f17c45ce8b4c231aed1d32c)，2026-10-09 17:31:32 +0800，`Merge pull request #5946 from deepseek-harness/release-0.2.1-alpha.2`）；GUI 运行发布版 `/usr/local/lib/node_modules/@deepseek-ai/dsh` = **`0.2.1-rc.2`**。两者不冲突（工作区 vs 运行时）。→ **依据** [C] `git describe`/`git log -1`/tag 列表 → **代码落点** [A] `packages/web/*/package.json` 六个包的 `version` 字段全为 `0.2.1-alpha.2` → **验证** [D] `python3 -c` 读六个 package.json + 发布版 package.json。
- **结论**：本机 checkout 是 **shallow clone（depth 1）**（`.git/shallow` 内容 = `d7432673…`，`git rev-list --count HEAD` = 1，`git tag` 只有 `dsh-v0.2.1-alpha.2`）→ **本地 git 无法提供任何「引入 commit」**。这与 [07](07-dsh-docs.md) §8.3、[10](10-link-verification.md) §4、[12](12-change-lineage.md) §7 的结论一致 [D/C]。→ **依据** [C] `git rev-parse` / `rev-list` → **代码落点** [A] `.git/shallow` → **验证** [D] 本机只读实跑。
- **新补（关键）**：**「本地取不到」不等于「取不到」**。本报告用认证 GitHub API 对 `deepseek-ai/deepseek-harness`（public，`default_branch=master`，`pushed_at=2026-11-03T07:58:43Z`）取到了 `commits?path=` 全历史，把 07 §8.3 / 10 §4 / 12 §7 中标 E 的「拒绝重定向规则引入 commit」升级为 **C 级**。见 4.3。
- **结论**：GitHub tags 共 **37 个**（截至 2026-11-04），`dsh-v0.2.1-alpha.2` → `d74326738864`、`dsh-v0.2.1-rc.2` → `687f282e8625`、`dsh-v0.2.1-rc.4` → `504a01a9578a`、`dsh-v0.2.2-alpha.2` → `f3803c96974a`、`dsh-v0.2.2-alpha.3` → `05b1cae8db6e`。npm `@deepseek-ai/dsh` 共 42 个版本，`time` 尾部：`0.2.1-alpha.2` 2026-10-09T08:18:00Z、`0.2.1-rc.2` 2026-10-17T08:36:31Z、`0.2.1-rc.5` 2026-10-29、`0.2.2-alpha.3` 2026-11-03、`0.2.2-rc.1` 2026-11-04T09:20:32Z。→ **依据** [C] `GET /tags?per_page=100` + `npm view … versions/time --json` → **代码落点** [A] 不适用 → **验证** [D] 两次实跑（11-04 / 11-05）。
- **⚠️ 版本号陷阱（新补）**：`@deepseek-ai/dsh-web`、`dsh-tool-web` 等**独立包**的 `dist-tags.latest` 是 **`0.0.1-rc.1`**，而 `alpha=0.2.2-alpha.3`、`next=0.2.2-rc.1`；`npm view @deepseek-ai/dsh-web version` 返回 `0.0.1-rc.1`。**不得用独立包的 `latest` 推断「web 包发布版本」**，必须用 monorepo tag / `alpha`/`next` tag / `@deepseek-ai/dsh` 的版本链。→ **依据** [C/D] `npm view … dist-tags --json`、`versions --json`（43 个版本，`0.2.1-alpha.2` 在内） → **代码落点** [A] `packages/web/*/package.json`（源码内为 `0.2.1-alpha.2`） → **验证** [D] 2026-11-05 实跑。此条为「版本号/commit 混用」审计的一个具体命中。

### 4.2 `packages/web/` 六个包最近提交与 web_search 相关 commit（C）

`commits?path=packages/web/<pkg>&per_page=15` 的共同最近链（2026-10~11）：
`f590c13c92e1`（11-03 merge）→ `1c78d475bf45`（0.2.2-alpha.3 release）→ [`3859913c68e2e2c6e0218e7994f4a1f11dc48214`](https://github.com/deepseek-ai/deepseek-harness/commit/3859913c68e2e2c6e0218e7994f4a1f11dc48214)（11-03 04:43Z，**`feat(web): 网页搜索与获取设置页分开选择 Search 与 Fetch，Search 默认改为 DeepSeek Search API`**）→ `00d541438b9b`（0.2.2-alpha.2）→ `69c389ae1113`（0.2.2-alpha.1）→ `341beb33c09f`（0.2.1-rc.4）→ `d02ea370ee15`（0.2.1-rc.3）。

- **结论**：`3859913c68e2` 是 web search 相关的**最近一次结构性改动**：新增 `packages/web/web-deepseek-api/`（Search/Fetch API）、把 `web-search-exa` 与 `web-search-perplexity` **整包删除**、设置页拆成 Search/Fetch 两个选择器、默认 provider 改为 DeepSeek Search API；含 `docs/upgrade-guide/v0.2.2-alpha.2/web-search-default-provider/` 与 `web-search-credential-modes/` 两个升级指南（194 文件）。→ **依据** [C] `GET /commits/3859913c68e2` 的 files[] → **代码落点** [A] `packages/web/web-deepseek-api/src/{search,fetch,transport}.ts`、`packages/web/web/src/{index,types}.ts`、`packages/client/ui-settings-web-search/src/client/WebSearchCard.tsx` → **验证** [D] API 实跑（exit code 0）。**注意**：这发生在 `0.2.2-alpha.2`，**晚于本机运行版 `0.2.1-rc.2` 与源码 `0.2.1-alpha.2`**，因此「本机 GUI 里默认 provider 是 DeepSeek」的推断必须标 E（与 [10](10-link-verification.md) §4 的区分一致）。
- **结论**：`packages/web/web-search-deepseek/src/provider.ts` 共 **29 次提交**；与端点/搜索直接相关的关键 commit：`b92a3c531a19`（2026-06-29，`feat(web): add DeepSeek-backed web search provider`，引入 provider）、`5e0e4b2401a1`（redirect 拒绝）、`fda98dadd2c299222fe6448f75eba96f3d55407d`（2026-10-17，`feat(web): add DeepSeek Search and Fetch APIs behind a settings switch (#6103)`）、`3859913c68e2`（默认 provider 切换）。→ **依据** [C] `commits?path=packages/web/web-search-deepseek/src/provider.ts&per_page=50` → **代码落点** [A] 该文件 `redirect:'error'` 行 → **验证** [D] API 实跑。

### 4.3 「规则 → 引入 commit → 作者/日期 → 回归测试」对应（**本报告补上的 C 级证据**）

| 规则 | 出处 | 引入 commit（永久链接） | 作者 / 日期 | 回归测试文件（A） | 原报告状态 → 本审计 |
| --- | --- | --- | --- | --- | --- |
| **Reject redirects on credential-bearing provider requests** | `packages/web/AGENTS.md:5` | [`80b07984c4c43769324760a3c58190b6f59efc6a`](https://github.com/deepseek-ai/deepseek-harness/commit/80b07984c4c43769324760a3c58190b6f59efc6a) `docs(web): codify credentialed redirect policy` | Tianyi Cui / 2026-07-19T13:56:02Z（新增 `packages/web/AGENTS.md` +5 行） | 见下一行 | 07 §8.3 标 **E 未取到** → **升 C** |
| 三 provider `redirect:'error'` + 回归断言 | `packages/web/web-search-{deepseek,exa,perplexity}/src/provider.ts` | [`5e0e4b2401a181abba82c48deedfb21648729acd`](https://github.com/deepseek-ai/deepseek-harness/commit/5e0e4b2401a181abba82c48deedfb21648729acd) `fix(web): reject credentialed search redirects` | Tianyi Cui / 2026-07-19T13:32:23Z（10 文件；合入 PR **#406**，merge [`42f19edd677d803d2587ace1e2f25e465175f65e`](https://github.com/deepseek-ai/deepseek-harness/commit/42f19edd677d803d2587ace1e2f25e465175f65e) 2026-07-20） | 新增 `packages/web/web-search-deepseek/tests/redirect.spec.ts`（+123）；三 provider spec 各 +1 行 `expect(init).toMatchObject({method:'POST',redirect:'error'})`；本地实测：`redirect.spec.ts:52-67` `it.each([301,302,303,307,308])` + `expect(targetRequests).toHaveLength(0)`；`exa.spec.ts:99`、`perplexity.spec.ts:93`、`deepseek.spec.ts:188-196`；`web-fetch-http/tests/proxy.spec.ts:139` | 07 §8.4 只有 A 级路径:行号、**无引入 commit** → **补齐 C 级锚点** |
| `redirect.spec.ts` 后续唯一修改 | 同上 | [`f736e6f58473`](https://github.com/deepseek-ai/deepseek-harness/commit/f736e6f58473) `feat(web-search-deepseek): resolve provider options from the settings section` | Yichen Jiang / 2026-08-10T10:06:27Z | 同上（适配） | 新补 [C] |

- **四联标注（这条规则）**：**结论** 拒绝带凭证重定向是 DSH 官方明文规则，且 2026-07-19 起有真实 HTTP 回归测试固定 → **依据** [B/C] [`80b07984…`](https://github.com/deepseek-ai/deepseek-harness/commit/80b07984c4c43769324760a3c58190b6f59efc6a) + [`5e0e4b24…`](https://github.com/deepseek-ai/deepseek-harness/commit/5e0e4b2401a181abba82c48deedfb21648729acd) + PR #406 → **代码落点** [A] `packages/web/AGENTS.md:5`、`packages/web/web-search-deepseek/tests/redirect.spec.ts:52-67` → **验证** [D] 本机 `grep -n redirect` 命中行 + API `files[]`；「用例当前为绿」仍 **E**（未跑 `pnpm vitest`，与 07 §8.4 注一致）。
- **仍未关闭的缺口**：07 §8.3 另外 8 条约定（Model-visible ⟺ logged、Plugins not loop changes、No hardcoded tunables、Design each tool's UI presentation up front 等）的**逐条引入 commit** 未逐个取证（`AGENTS.md` 有 100+ 提交、`docs/architecture.md` 100+），**维持 E**，不得因为本报告补上了 1 条就把 9 条一起当成已解决。→ **依据** [C] 各文件 `commits?path=` 返回 100/55/64 条（分页上限），最老可见项仍不是创建提交 → **代码落点** [A] `AGENTS.md:134,135,139,155`、`packages/AGENTS.md:13,26-27` → **验证** [E] 需 `git blame` 或分页到最早提交 + `gh api` 核 PR 内容。

---

## 5. OpenCode v2 版本谱系

### 5.1 迁移链与 v2 主线（C/D）

- **结论**：`https://api.github.com/repos/sst/opencode` → **HTTP 301** → `https://api.github.com/repositories/975734319`；解析为 `anomalyco/opencode`（repo `id=975734319`，`default_branch=dev`，`created_at=2025-04-30`，`pushed_at=2026-11-04T09:58:08Z`）。→ **依据** [C/D] `curl -sS -o /dev/null -w '%{http_code} -> %{redirect_url}'` + `GET /repos/anomalyco/opencode` → **代码落点** [A] 不适用 → **验证** [D] 2026-11-04、11-05 两次实跑，均 301。
- **结论**：`v2.2.5` 是 **lightweight tag**（`GET /git/ref/tags/v2.2.5` → `{ref, object:{sha:9bbb8ce18c80f099e0e448775f59d965ead40a21, type:"commit"}}`；`GET /git/tags/9bbb8ce…` 返回 404 Not Found，符合 lightweight tag 无 tag object）。`GET /commits/9bbb8ce18c80f099e0e448775f59d965ead40a21` → 作者 `github-actions[bot]`，日期 **2026-10-30T22:06:51Z**，message `release: v2.2.5`，37 个文件（CHANGELOG +44 与 30+ 个 package.json 版本号）。→ **依据** [C] 三个 API 端点 → **代码落点** [A] [`release commit`](https://github.com/anomalyco/opencode/commit/9bbb8ce18c80f099e0e448775f59d965ead40a21) → **验证** [D] API 实跑。
- **结论**：`tags?per_page=100` 第一页含 `vscode-v*` 与 v2.2.5…v2.0.28；[09b](09b-opencode-v2.md) §1 与 [REPORT](REPORT.md) §一.10 记载的「v1 共 242 个、v2 共 44 个」是全量分页结果，本报告第一页只覆盖最近 100 个 tag，**不与之矛盾，但本报告不独立复核该计数**（标 C，来源 09b）。v1 最新 `v1.19.5`（`810c0eba1a73`）；v2.0.0 = `63f7ceecbed2`。→ **依据** [C] tags 列表 + 09b §1 → **代码落点** [A] 不适用 → **验证** [D] 本报告 API 实跑（第一页）。

### 5.2 五个 provider 文件的引入/修改 commit（C，`sha=v2.2.5`）

`GET /contents/packages/core/src/plugin/websearch?ref=v2.2.5` → **7 个文件**：`exa.ts`(2873B) / `firecrawl.ts`(2976B) / `parallel.ts`(3635B) / `tavily.ts`(3078B) / `tinyfish.ts`(5395B) / `mcp.ts`(2569B) / `index.ts`(418B)。**无 `provider.ts`**（与 [10](10-link-verification.md) §3(a) 一致）。

`commits?path=packages/core/src/plugin/websearch&sha=v2.2.5` 共 **14 条**；逐文件历史：

| provider 文件 | 引入 commit（永久链接） | 作者 / 日期 / message | 后续修改 | 端点（A，v2.2.5 源码逐字） |
| --- | --- | --- | --- | --- |
| `exa.ts` | [`efb629a33ac4`](https://github.com/anomalyco/opencode/commit/efb629a33ac4) `feat(core): add pluggable web search (#35558)` | Shoubhit Dash / 2026-07-26T03:55:05Z（同时新增 `index.ts`/`mcp.ts`/`parallel.ts`/`core/src/websearch.ts`/`core/src/config/websearch.ts`） | `8db7487c894b`(tool 架构)、`d8b3e528e853`(key dialog)、`4acdeffbe9de`(import 扩展)、`4772b6a3e8c2`、`a5312e169b13`(npm scope)、`1aae67e853ba`(Effect rc.118) | `exa.ts:8` `https://mcp.exa.ai/mcp`；`:37` `EXA_API_KEY`；`:53` tool `web_search_exa` |
| `parallel.ts` | 同上 `efb629a33ac4` | 同上 | 同 exa 的 6 次 | `https://search.parallel.ai/mcp` |
| `firecrawl.ts` | [`e6c9b6bef76f`](https://github.com/anomalyco/opencode/commit/e6c9b6bef76f) `feat(core): add firecrawl web search (#41042)` | Shoubhit Dash / 2026-08-07T11:21:09Z（同时改 `index.ts`） | `d8b3e528e853`、`4acdeffbe9de`、`4772b6a3e8c2`、`a5312e169b13`、`1aae67e853ba` | `https://mcp.firecrawl.dev/v2/mcp` |
| `tavily.ts` | [`3d3bbd48f94c`](https://github.com/anomalyco/opencode/commit/3d3bbd48f94c) `feat(core): add tavily web search (#42591)` | Shoubhit Dash / 2026-08-14T14:50:10Z（同时改 `index.ts`） | `2a83911c7ef9`、`4772b6a3e8c2`、`e3c89654d1c5`(sticky session)、`a5312e169b13`、`1aae67e853ba` | `https://api.tavily.com/search` |
| `tinyfish.ts` | [`3f579f53f494`](https://github.com/anomalyco/opencode/commit/3f579f53f494) `feat(core): add TinyFish web search (#48561)` | opencode-agent[bot] / 2026-09-12T07:10:54Z（同时改 `index.ts`） | `1aae67e853ba`、[`86755e1ceafc`](https://github.com/anomalyco/opencode/commit/86755e1ceafc) `fix(core): initialize MCP session for TinyFish web search (#54730)` 2026-10-15 | `tinyfish.ts:10` `https://agent.tinyfish.ai/mcp`；`:61` `TINYFISH_API_KEY`；`:76` 无 key 时 `X-TinyFish-Access-Mode: keyless` |
| `mcp.ts` | `efb629a33ac4` | 同上 | `2a83911c7ef9`、`c4eeefe0f138`、`e3c89654d1c5`、`4acdeffbe9de`、`1aae67e853ba` | 通用 MCP streamable-http 客户端 |
| `index.ts` | `efb629a33ac4` | 同上 | `e6c9b6bef76f`、`4acdeffbe9de`、`3d3bbd48f94c`、`3f579f53f494` | 5 provider 注册表 |

- **结论**：**v1 旧资料为何不能作依据**：`sst/opencode` 已 301 迁移、`default_branch` 改为 `dev`；websearch 插件化抽象（5 provider + `random` + 429 冷却 + session affinity + permission + Console hosted）**全部由 2026-07-26 起的 v2 提交引入**，v1 的 `core/src/tool/websearch.ts` 形态不包含这些文件与端点；`/docs/websearch`（v1 路径）**实测 HTTP 404**，v2 路径为 `/v2/docs/websearch`（200）。→ **依据** [C/B] 上表 14 条 commit + [`https://opencode.ai/docs/websearch`](https://opencode.ai/docs/websearch) 404（2026-11-04） → **代码落点** [A] `blob/v2.2.5/packages/core/src/plugin/websearch/*` → **验证** [D] API/HTTP 实跑。故 v1 资料**仅作对比，不作 A/B/C 依据**（与 09b §2.3、10 §3(a) 一致）。

### 5.3 官方 v2 文档（B，访问 2026-11-04，复验 2026-11-05）

| URL | HTTP | 关键内容（逐字核对） | 等级 |
| --- | --- | --- | --- |
| [`https://opencode.ai/v2/docs/websearch`](https://opencode.ai/v2/docs/websearch) | **200**（21152 B；11-05 复验 200） | 「OpenCode includes five search providers」表：exa/`EXA_API_KEY`、firecrawl/`FIRECRAWL_API_KEY`、parallel/`PARALLEL_API_KEY`、tavily/`TAVILY_API_KEY`、tinyfish/`TINYFISH_API_KEY (optional)`；`websearch.provider: "random"`；「When a provider returns HTTP 429, random selection retries … waits for its Retry-After period, or 60 seconds」；「Web searches use the websearch permission action and the search query as the resource」 | B |
| [`https://opencode.ai/v2/docs/console/websearch`](https://opencode.ai/v2/docs/console/websearch) | **200**（14253 B；11-05 复验 200） | 「Console provides hosted web search to connected OpenCode users」；owner/admin 在 Integrations → Hosted Web Search 点 Enable，成员 `/connect`；「Each successful search costs **$0.01**」计入 workspace balance 与成员 spending limits；「Failed and rate-limited searches are not charged」；workspace 配置把 **OpenCode Web Search** 设为默认 provider，成员自设 `websearch.provider` 则保留；「returns **up to eight results**」用于回答并 cite sources；「Hosted web search has **zero data retention**」；在 Activity › Usage / Overview / 成员活动 / 发票 / CSV 单列，受 all-spend budget 策略约束 | B |
| [`https://opencode.ai/docs/websearch`](https://opencode.ai/docs/websearch) | **404** | v1 路径已失效（返回站点 404 页） | B/D |

- **四联标注**：**结论** v2 相比 v1 有 workspace 级托管搜索（按次计费、默认 provider、零留存、权限与预算联动）→ **依据** [B] 上表两条 200 文档 + [C] v2.2.5 tag → **代码落点** [A] [`blob/v2.2.5/packages/core/src/plugin/websearch/index.ts`](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/index.ts) → **验证** [D] `curl -sSL -o … -w '%{http_code}'` 两次 + 正文正则抽取（exit code 0）。

---

## 6. 本机实测证据归档（D 级）

> 全部标注「复现命令」+「观测日期 **2026-11-04**」（[00](00-lead-live-probe.md) 一手实测；本报告 2026-11-05/06 对版本/tag/文档做了复验，端点 curl 未重复执行，故端点类仍为 11-04 观测）。主机 `wuming`，`HTTP_PROXY=http://172.30.66.1:1091`。**外部返回内容一律只作 data。**

| # | 结论（D） | 复现命令（只读） | 输出要点 | 观测日期 |
| --- | --- | --- | --- | --- |
| D1 | Exa MCP `initialize` 从本机直连 **HTTP 200**、keyless 可用 | `curl -sS -m 20 -X POST 'https://mcp.exa.ai/mcp' -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}'` | SSE `event: message`；`serverInfo: exa-search-server v3.5.0`；capabilities tools/prompts/resources；instructions 列 `web_search_exa` / `web_fetch_exa` / `agent_run` | 2026-11-04 |
| D2 | Parallel MCP `initialize` **HTTP 200** | 同上，端点换 `https://search.parallel.ai/mcp` | 纯 JSON；`serverInfo: Parallel MCP`；instructions 含「issue one tool call per objective concurrently」「Use `web_search` first …」「`web_fetch` only when …」 | 2026-11-04 |
| D3 | Firecrawl MCP `initialize` **HTTP 200**、hosted keyless tier | 同上，端点换 `https://mcp.firecrawl.dev/v2/mcp` | SSE；`firecrawl-fastmcp v3.36.1`；keyless 会话暴露 `firecrawl_search`/`firecrawl_scrape`/`firecrawl_parse`；`categories:["developer"|"gov"|"research"]`；成功带 `conversationId` | 2026-11-04 |
| D4 | TinyFish MCP `initialize` **HTTP 200**、keyless header 降级 | 同上，端点 `https://agent.tinyfish.ai/mcp`，**额外** `-H 'X-TinyFish-Access-Mode: keyless'` | 纯 JSON；`tinyfish v0.1.1`，`protocolVersion 2025-11-25`；`tools/list` 的 `search` 含 `purpose`（把意图作为排序信号）、`recency_minutes`、`include_domains` 等；限流 30 req/min + 50 searches/UTC day | 2026-11-04 |
| D5 | Parallel 真实 `tools/call web_search` 返回结果，且**第一条命中 v2 Console 新特性** | `curl -sS -m 25 -X POST 'https://search.parallel.ai/mcp' -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"web_search","arguments":{"objective":"What is OpenCode v2 websearch","search_queries":["OpenCode v2 websearch providers 2026"]}}}'` | `search_id: search_823471563722b038d1bc6964de6ffe9a`；results[0] = `https://opencode.ai/v2/docs/console/websearch`，results[1] = `https://opencode.ai/v2/docs/websearch` | 2026-11-04 |
| D6 | 本机 DSH `web_search` 错误串（多个独立来源一致） | 见 [02](02-runtime-state.md) §8：`web_search({queries:[…]})` 本会话实跑 + `GET /api/unified-search/health`（带 `dsh-auth-*` cookie + Origin） | `unified search: all enabled backends failed (4)`：`exa/parallel MCP initialize HTTP 403: <html>…403 Forbidden…`、`ddg … redirect mode is set to error (301)`、`searxng: invalid JSON response`；health `enabled:4 keyless:4`，history `failCount 25/26` | 2026-11-04 |
| D7 | 本机装的插件版本与 npm 最新 | `python3 -c "import json;print(json.load(open('/home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/package.json'))['version'])"`；`npm view @240xu/dsh-websearch dist-tags.latest --json`；`npm view @240xu/dsh-websearch time --json` | 本机 `2.8.4`；npm latest `2.8.8`（2.8.4 发布 10-18T06:02Z、2.8.5 10:31Z、2.8.6 14:04Z、2.8.7 10-20T12:53Z、2.8.8 10-21T14:10Z） | 2026-11-04、复验 2026-11-05 |
| D8 | 用户仓库 tags/releases/issues | `curl -sS -u "$U:$P" https://api.github.com/repos/240xu/dsh-websearch/{tags,releases,issues?state=all,commits?per_page=100}`（**凭证值未输出**） | tags 仅 v1.0.0/v2.0.0；releases 0；commits 53；issues 8（11-05 起） | 2026-11-04、复验 2026-11-05 |
| D9 | DSH 官方「规则引入 commit」补证 | `curl -sS -u "$U:$P" https://api.github.com/repos/deepseek-ai/deepseek-harness/commits?path=packages/web/AGENTS.md` + `/commits/{sha}` | `80b07984c4c4…`（规则）/ `5e0e4b2401a1…`（实现+回归）/ PR #406 merge `42f19edd677d…` | 2026-11-04、复验 2026-11-05 |
| D10 | OpenCode v2 基准与 docs | `curl -sS -o /dev/null -w '%{http_code} -> %{redirect_url}' https://api.github.com/repos/sst/opencode`；`curl -sSL https://api.github.com/repos/anomalyco/opencode/git/ref/tags/v2.2.5`；两条 `opencode.ai/v2/docs/*` | 301 → repositories/975734319；`v2.2.5` → `9bbb8ce18c80…` type=commit；两 docs 200；`/docs/websearch` 404 | 2026-11-04、复验 2026-11-05 |
| D11 | 本机 checkout 版本与 shallow 状态 | `git -C /home/ova/dsh describe --tags --always`；`git -C /home/ova/dsh rev-list --count HEAD`；`python3 -c …` 读六个 `packages/web/*/package.json` 与发布版 `package.json` | `dsh-v0.2.1-alpha.2`；`1`；六包 `0.2.1-alpha.2`；发布版 `0.2.1-rc.2` | 2026-11-04、复验 2026-11-05 |
| D12 | 2.8.7/2.8.8 tarball 差异 | `npm view @240xu/dsh-websearch@{2.8.6,2.8.7,2.8.8} dist.tarball --json` → `curl -sSL … | tar xzf` → `diff -rq` / `diff -u lib/index.js` | 2.8.7 多 `lib/config.js` + `exports["./config"]`；2.8.8 合回 `index.js`、删该 export、README 加「10 秒速查」；三者 CHANGELOG 均不在 tarball | 2026-11-04 |

> **D 级边界（不得外推）**：D1–D5 只证明「本机经代理直连端点可用、keyless 可搜」，**未证明**升级后 DSH 插件一定修好（[00](00-lead-live-probe.md) §7 已声明）；未测 tavily REST（需 key）、未测 exa/firecrawl 的真实 `tools/call` 实搜；403 HTML 的确切产生环节（egress 代理 / 上游 WAF / TLS 指纹）**未抓包定位 → E**。本报告未执行任何升级、未修改任何配置（只读约束）。

---

## 7. 各报告可追溯性打分 / 缺口清单

> **快照声明（重要）**：01–09c/10/12/REPORT 在 2026-11-05 20:17–20:47 与 11-06 07:34 被团队**再次修订**（12 从 220→491 行、08 506→618、10 124→373、05 173→401、09c 356→428、01 592→765、02 422→575、06 513→641）。本节打分已按**当前落盘版本重跑**（2026-11-06 07:34 后），不沿用旧快照。

### 7.1 打分口径

对每份报告按 5 项各 0–2 分（0=缺失 / 1=部分 / 2=完整），满分 **10**：
① 核心结论是否具备 A/B/C/D 锚点；② 是否用永久链接（固定 ref）而非浮动 `main/dev/master`；③ E 级内容是否被误当结论；④ 版本号/commit/tag 是否混用；⑤ 四联标注是否齐备（结论→依据→代码落点→验证）。

> 统计口径：2026-11-06 对**当前版本** `grep -cE 'github\.com/[^ )]*/(blob|tree)/(main|dev|master)/'` 计浮动链接、固定 ref 数、E 标记数；分数为审计判定，非自动计算。改版后显著进步：12 的浮动链接 13→**2**（且均为第三方 `exa-labs/openapi-spec/blob/master` 说明性引用）、固定 ref 12→**104**；10 新增 §1.1 全量链接统计与 §4 的 R1–R15 风险矩阵。

| 报告 | ①等级 | ②永久链接 | ③E 纪律 | ④版本/commit | ⑤四联 | 总分 | 判定与主要缺口 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [00-lead-live-probe.md](00-lead-live-probe.md) | 2 | 1 | 2 | 2 | 1 | **8/10** | D 级一手实测最扎实（复现命令 + 输出要点 + §7 证据边界）；但**无 A 级源码锚点、无带 ref 永久链接**、四联标注未成表格。建议补 v2.2.5 固定 ref 源码链接。 |
| [01-local-impl.md](01-local-impl.md)（765 行） | 2 | 1 | 2 | 2 | 2 | **9/10** | 新增「补-8 运行时版本链与 sidecar 状态复核」「补-10 证据分级复核」；全篇「源码确认」+ `路径:行号`（A 充分）。仍无外部带 ref 永久链接、无等级字母标记体系（§0 有术语约定）。 |
| [02-runtime-state.md](02-runtime-state.md)（575 行） | 2 | 1 | 2 | 2 | 2 | **9/10** | 新增附录 F「全部 2026-11-05 实跑」证据清单；§8 命令+输出+exit code 语义完整、§7.2 自列 6 条待确认。仍无 A/B 级外部永久链接。 |
| [03-protocol-standards.md](03-protocol-standards.md)（725 行） | 2 | 2 | 2 | 2 | 2 | **10/10** | §8 自带「统一证据等级 / 四联标注 / 权威链接格式规范 / 禁止事项 / 自身验证状态」；E 标记 31 处（全队最多，含 Exa 旧 URL 404、Anthropic 查无原文）；链接带固定 ref。**模板级**。注意 10 §4 R8 指出其 OpenAI 字段本机全 403 不可复核 → 引用时须标 E/转述。 |
| [04-opencode-agents.md](04-opencode-agents.md)（406 行） | 2 | **0** | 2 | 2 | 2 | **8/10** | 等级/四联/E 纪律好（§7b/7c、附录 A 时效订正）；但 **17 条浮动 `blob/main` 链接**（cline/Aider/codex/gemini-cli/openai-agents-python），其中 :68/:69/:75/:204 已自标「浮动 main，E」，其余未标 → 违反「禁止浮动 main 当依据」。建议逐条换 sha 或统一标 E。 |
| [05-search-backends.md](05-search-backends.md)（401 行） | 2 | **0** | 2 | 2 | 2 | **8/10** | 新增 §0「版本口径（C 级，勿混用）」、附录 A.1–A.4 把 Firecrawl/TinyFish/Parallel 端点从 D/E 升 B；§7 待确认。但 **13 条 `blob/main` 浮动链接**（§6 索引 1–12）未换 ref，且 §0 已声明版本口径却未同步链接 → 自相矛盾。 |
| [06-agentic-search.md](06-agentic-search.md)（641 行） | 2 | 1 | 2 | 2 | 2 | **9/10** | §0 先声明证据可用性、§9 按主题分组「全部含核验状态」、四联示例齐；主动剔除两篇误取 arXiv 并记为反面教材。**扣分点**：10 §4 R6 发现 06 与 01/08/12/REPORT 都把 `arXiv:2404.01037` 当「盲目多查询劣化」门控依据，而该文实际标题为 **ARAGOG: Advanced RAG Output Grading**（本报告 2026-11-06 独立复核 `citation_title` 确认）→ 见 §7.2 P0。 |
| [07-dsh-docs.md](07-dsh-docs.md)（748 行） | 2 | 1 | 2 | 2 | 2 | **9/10** | §8 是全队规范样板（等级定义、等级分布、缺口清单 #1-9、最小标注模板）；诚实把 9 条「引入 commit」标 E。**本审计已把其中「拒绝重定向」1 条升 C**（§4.3），其余 8 条维持 E。扣分点：§8.3「无法取得任何约定引入 commit」措辞过宽（本地 shallow 无法、经 API 可补）；10 §4 R14 亦沿用该宽措辞。 |
| [08-own-repo.md](08-own-repo.md)（618 行） | 2 | **0** | 2 | 2 | 2 | **8/10** | A/B/C/D 等级最密；§0.3 主动纠正题面「远端 2.8.6」、§7 逐文件 `cmp`、附录给出 **D 级 403 根因新证**（`egress-fetch.js:276` `delete headers["host"]` + CONNECT 隧道不补 Host → Cloudflare 403；补 Host 后 200）。但 **§0.4 仍把 `blob/main/<path>#L<n>` 写成「永久链接基准」**，§2.2/§5.4 共 17 条浮动链接 → 与全队规则直接冲突，是全队最大的单点缺口。 |
| [09-opencode-endpoints.md](09-opencode-endpoints.md)（324 行） | 2 | 1 | 2 | 2 | 2 | **9/10** | §8 逐条四联、§10/附录 G 显式 E；附录 A 主动订正一处事实、附录 D 独立复现 2.8.8 解包、附录 E 五端点 GET 探测（405/401 与 00 的 POST 200 互补）。扣分点：**18 条浮动链接**（多为 `blob/main`），附录 F 新增链接未全带 ref。 |
| [09b-opencode-v2.md](09b-opencode-v2.md)（480 行） | 2 | 2 | 2 | 2 | 2 | **10/10** | §1 版本谱系、§2.3「引用陷阱」、§7 五组链接（A/B/C 带 v2.2.5 ref、D 在线文档带日期与 HTTP 200、E 明确「v1 仅作对比」、F 对照用）、§8 证据边界。**浮动链接 0**，永久链接纪律最好。 |
| [09c-opencode-integration.md](09c-opencode-integration.md)（428 行） | 2 | **1** | 2 | 2 | 2 | **9/10** | §1 自带证据规范四小节（含「永久链接规则」「版本链不混用」）、§5 P0/P1/P2 四联、§8 12 条 E 全显式；但仍有 **7 条浮动链接**与 §1.3 自定规则矛盾。**E 纪律最佳样本**（含「2.8.8 是否已含 searxngBaseURLs 未逐字段核对」这类自我限定）。 |
| [10-link-verification.md](10-link-verification.md)（373 行，重写） | 2 | 1 | 2 | 2 | 2 | **9/10** | 全队「可信度收口」：§1.1 全量链接统计、§1.3 畸形/占位 URL 清单、§2 抽样核验明细（带状态列）、§4 **R1–R15 风险矩阵**（最实质的是 R6 arXiv 误引、R7 六处失效 URL、R8 OpenAI 全站 403、R10 Brave 字段名无官方正文）、§5 58 条精选链接带状态。扣分点：§5 仍有 3 条 `blob/main`/`blob/master`；§4 R14 沿用 shallow clone 宽措辞。 |
| [12-change-lineage.md](12-change-lineage.md)（491 行，重写） | 2 | 2 | 2 | 2 | 2 | **10/10** | 「迹」的主线且**本轮进步最大**：§0.3 明文「禁止 `blob/main` 作依据」并已把初版 15/16/27–33 全部改固定 sha（浮动 13→2，固定 ref 104）；§1.3 用 tarball 交叉验证订正「npm 2.8.6 = `592237f` + `72cbba8e` 两个 commit 之和」；§1.4 全量 diff 证明 2.8.7 是「孤儿发布」、2.8.8 `lib/` 与 2.8.6 逐字节相同；§1.6 CHANGELOG 行号带固定 sha；§7 E-1…E-10；§8 62 条索引。**仅存两点**：剩余 2 条 `exa-labs/openapi-spec/blob/master`（第三方说明性引用，应标 E）；E-10 的 shallow clone 措辞应随本审计 §4.3 收窄。 |
| [REPORT.md](REPORT.md)（255 行） | 2 | 1 | 2 | 2 | 2 | **9/10** | §一 15 条硬结论**每条带等级**，第 3/4 条显式保留 E（未抓包、sidecar 可能不匹配），第 15 条主动列两处引用失效；§五「改动谱系」引 12。扣分点：§七权威资料精选固定 ref 线索偏少、2 条浮动；**未纳入 2026-11-05 新增 issue #7/#8**；10 §4 R6 指出其 `:28,166,215` 仍把 arXiv:2404.01037 当门控依据（未修正）。 |

### 7.2 缺口清单（按优先级，已按当前版本重排）

| 优先级 | 缺口 | 命中位置 | 证据等级 | 补证建议（可直接执行） |
| --- | --- | --- | --- | --- |
| **P0**〔**裁决见文末附录裁决 1：本行「应剔除」已被推翻**〕 | **arXiv:2404.01037 归因不精确**（10 §4 R6）：01/06/08/12/REPORT 把该文简写为「盲目多查询会劣化」，源头是插件 `lib/multiquery.js:3,29` 与 `README.md:130,249` 注释；`citation_title` 实为 **「ARAGOG: Advanced RAG Output Grading」** | [10](10-link-verification.md) §4 R6；[REPORT](REPORT.md) §5 | **B/C（链接 200 + arXiv API 摘要原文含 "Multi-query approaches underperformed"）→ 依据成立，不剔除** | **Lead 裁决**：改写为「ARAGOG 在该实验设置下报告 Multi-query 低于 Naive RAG 基线、MMR/Cohere rerank 无显著优势」，限定单篇探索性实验；插件注释属转述不精确。详见文末「附录 · Lead 裁决」裁决 1 |
| **P0** | 「升级到 2.8.8 即可修复」缺 2026-11-05 新报的 open issue/PR 风险注脚 | [REPORT](REPORT.md) §一.4/§一.13、[09c](09c-opencode-integration.md) §5.1、[00](00-lead-live-probe.md) §5 | **E** | 补 [#7](https://github.com/240xu/dsh-websearch/pull/7)（settings inert on DSH 0.2.x，改 `lib/index.js`+`tests/v28x-settings-bridge.test.js`）、[#8](https://github.com/240xu/dsh-websearch/issues/8)（`2.8.8` + `0.2.1-rc.5` 保存 API Key 失败，`lib/client.js:657`）；「升级后必然恢复」维持 E |
| **P0** | 浮动 `main/dev/master` 链接当依据（当前版本合计 **~93 条**，较初版未下降：04 17、05 13、08 17、09 18、09c 7、10 3、12 2、REPORT 2、06 2） | 见左列 | **违反永久链接规则** | 统一替换：`240xu/dsh-websearch` 用 [`da42e44a0f54913e132c5219174a3b6f267188fc`](https://github.com/240xu/dsh-websearch/commit/da42e44a0f54913e132c5219174a3b6f267188fc)（2.8.8）或 [`592237f7586bc2da428e5acf41acf40276711b3d`](https://github.com/240xu/dsh-websearch/commit/592237f7586bc2da428e5acf41acf40276711b3d)（2.8.6）；`anomalyco/opencode` 用 `v2.2.5`；`deepseek-ai/deepseek-harness` 用 `dsh-v0.2.1-alpha.2` 或对应 sha；第三方（exa-labs/cline/Aider/codex…）逐条 `git ls-remote` 取 sha 或显式标 E。**[12](12-change-lineage.md) §0.3 已是正确范本，直接复用** |
| **P0** | 2.8.7 的 `gitHead=608e474fdf5841bb0fcc657c221f85614c9925fc` 来源未取到（API 422） | [12](12-change-lineage.md) §1.4/E-1、[10](10-link-verification.md) §4 | **E** | 保留 E；[12](12-change-lineage.md) §1.4 已用 tarball 全量 diff 把「2.8.8 `lib/` == 2.8.6」升 A/D，但**该 sha 的 message/parents/来源分支仍不可查**，不得当结论 |
| **P1** | 07 §8.3 另外 8 条约定的「引入 commit」未取证 | [07](07-dsh-docs.md) §8.3、[10](10-link-verification.md) §4 R14 | **E** | 用认证 API 对 `AGENTS.md`/`packages/AGENTS.md`/`docs/cookbook/adding-a-tool.md`/`docs/architecture.md` 做**全分页** `commits?path=`；本报告只确认「拒绝重定向」1 条（§4.3）。**注意**：R14 与 07 §8.3 的「取不到任何引入 commit」宽措辞应改为「本地 shallow 无法；经 API 已补 1 条，余 8 条 E」 |
| **P1** | 「回归测试用例当前为绿」未实测 | [07](07-dsh-docs.md) §8.4 注、[10](10-link-verification.md) §4 R14 | **E** | 在有依赖的 checkout 跑 `pnpm vitest run packages/web/web-search-deepseek/tests/redirect.spec.ts` 记录 exit code → 升 D |
| **P1** | 独立 `@deepseek-ai/dsh-web*` 的 `dist-tags.latest=0.0.1-rc.1` 易被误读为「web 包版本」 | 本报告 §4.1（新发现） | **C/D** | 版本链一律引用 monorepo tag / `@deepseek-ai/dsh` / `alpha`/`next` tag；禁止用 `npm view @deepseek-ai/dsh-web version` 当发布版本 |
| **P1** | 403 的确切网络环节：**08 附录已给出更精确的 D 级新证**（`delete headers["host"]` + CONNECT 隧道不补 Host → Cloudflare 403，补 Host 后 200），但 00/02/09c/10/R14 仍写「未抓包定位，E」 | [08](08-own-repo.md) §附录 A.2（2026-11-05 12 组实验）vs [00](00-lead-live-probe.md) §7、[02](02-runtime-state.md) §7.2、[09c](09c-opencode-integration.md) §8.9 | **D（新证）/ 其余报告口径待同步** | 建议 Lead 把 08 附录的 D 级结论回填到 REPORT §一.3/§一.4 与 10 §4；同时保留「字节级 JA3 比对」「升级后是否恢复」为 E。**注意**：这与 2.8.5「JA3 指纹」的 CHANGELOG 归因不完全相同，两者应并列说明，勿互相覆盖 |
| **P1** | 六处失效 URL 与 OpenAI/Anthropic/Brave 官方正文不可达 | [10](10-link-verification.md) §4 R7/R8/R9/R10 | **B（404/403）/ E** | 按 R7 替换为现行 URL（`deepseek-ai/deepseek-harness`、`exa.ai/docs/search/best-practices`、`opencode.ai/v2/docs/websearch` 等）；OpenAI 字段标「据 03 报告转述，本机未复核」；Anthropic 改用 `platform.claude.com/llms-full.txt`（200）作 B；Brave 字段名只由插件源码（`brave.js:53`，A）支撑，不升 B |
| **P2** | 2.8.0 commit sha 在初版 12 §1 写「—」 | [12](12-change-lineage.md)（初版 :29，本版已补） | **已关闭** | 本审计独立补 [`27cc5df60257ffdc904cdda1c07af547333898f4`](https://github.com/240xu/dsh-websearch/commit/27cc5df60257ffdc904cdda1c07af547333898f4)；12 本版 §1.2/§5 亦已带该 sha，判为一致 |
| **P2** | v2 tag 计数（v1 242 / v2 44）为转述 | [09b](09b-opencode-v2.md) §1、[REPORT](REPORT.md) §一.10 | **C（转述）** | 全量分页 `tags?per_page=100&page=N` 存档原始计数；本报告只取第一页 100 条 |
| **P2** | 12 §7 E-10 / 07 §8.3 的 shallow clone 缺口措辞过宽 | [12](12-change-lineage.md) §7 E-10、[07](07-dsh-docs.md):645 | **E 措辞** | 改为「**本地** shallow clone 取不到；本审计经认证 GitHub API 已补上 redirect 规则 1 条，其余 8 条仍 E」 |
| **P2** | 01/02/00 无 A/B 级外部永久链接 | 见 §7.1 三行 | **格式缺口** | 引用 §8 索引中的固定 ref 链接，把关键结论改写成四联表 |

### 7.3 「E 级被当结论」与「版本号/commit 混用」专项核查

- **E 级纪律**：全队整体良好且本轮更强。03/05/06/07/09/09b/09c/10/12/REPORT 均设独立 E 小节；[09c](09c-opencode-integration.md) §8 的 12 条 E、[12](12-change-lineage.md) §7 的 E-1…E-10、[10](10-link-verification.md) §4 的 R1–R15 是全队最佳样本。**未发现把 E 直接写成硬结论的条目**；[REPORT](REPORT.md) §一.3/.4 把「升级修复」保留为 E，[10](10-link-verification.md) §4 把「8 条数值巧合」「测试全绿」「shallow clone」标 E。
- **但存在两类「证据一致性」问题，比 E 纪律更值得处理**〔**本行两项均已被文末裁决附录处理，保留为审计过程记录**〕：① **arXiv:2404.01037 归因不精确**（§7.2 P0）——链接 200 真实、标题为 ARAGOG，但 arXiv API 摘要含 "Multi-query approaches underperformed" ⇒ **裁决 1 推翻「应剔除」，改为精确化表述并限定单篇探索性实验**；② **08 附录的 403 根因新证**——**裁决 2 已定为唯一口径「缺 Host 头」，JA3 归因证伪**，不再「并列或择一」。
- **版本号/commit 混用**：发现 3 类，均已有人订正。① 把 CHANGELOG 停在 2.8.6 误说成「远端最新 2.8.6」——[08](08-own-repo.md) §0.3、[10](10-link-verification.md) §4 R1、[12](12-change-lineage.md) §1 已统一为「本机 2.8.4 / CHANGELOG 2.8.6 / npm+远端 2.8.8」三值并列；② 把 2.8.7 的 `lib/config.js` 拆分说成 2.8.8 的重构——[12](12-change-lineage.md) §1.4 与本审计 §3.2 tarball diff 均已澄清；③ 独立 `dsh-web` 包 `latest=0.0.1-rc.1` 与 monorepo `0.2.1-alpha.2`/`0.2.1-rc.2` 混用——本报告 §4.1 新发现。
- **2.8.6 双 commit 的正确处理**：`592237f7`（实现 commit）与 npm `gitHead 72cbba8e`（发布快照，含纯注释改动）是**两个不同 commit**。[12](12-change-lineage.md) §1.3 用 tarball 与 raw 交叉验证得出「npm 2.8.6 = 两 commit 之和」[C+A+D]，本审计 §3.2 与 §8 索引 12/13 并列标注 —— **判定为正确，无混用**。

---

## 8. 最终综合报告可直接引用的证据索引（60 条，按主题分组）

> 格式：`编号 · 等级 · 永久链接/路径 · 核验状态 · 日期`。全部链接带 ref（tag 或 40 位 commit sha）；本地路径带 `:行号` 时才是 A 级。**核验状态**：✅=本次实跑/实读复核；⚠️=转述或需限定；❌=取不到（E）。

### A. 用户仓库版本/commit 谱系（C）
1. **C** · [`240xu/dsh-websearch` commits?per_page=100（53 条）](https://api.github.com/repos/240xu/dsh-websearch/commits?per_page=100) · ✅ · 2026-11-04/05（认证 API）
2. **C** · [`tags`：仅 v1.0.0 / v2.0.0](https://api.github.com/repos/240xu/dsh-websearch/tags) · ✅ · 2026-11-04/05
3. **C** · [`releases`：0 条](https://api.github.com/repos/240xu/dsh-websearch/releases) · ✅ · 2026-11-04
4. **C** · 仓库仅 2 个 tag：[`v2.0.0` → `601ba8bf3d0034bc4d8da2d47e511b9165bdd6ef`](https://github.com/240xu/dsh-websearch/commit/601ba8bf3d0034bc4d8da2d47e511b9165bdd6ef) / [`v1.0.0` → `caff1593395990e69dfd0627fd4f1c8d97293673`](https://github.com/240xu/dsh-websearch/commit/caff1593395990e69dfd0627fd4f1c8d97293673) · ✅ · 2026-11-04
5. **C** · [`27cc5df60257ffdc904cdda1c07af547333898f4`（2.8.0）](https://github.com/240xu/dsh-websearch/commit/27cc5df60257ffdc904cdda1c07af547333898f4) · ✅（本审计补 12 §1 的「—」） · 2026-09-30
6. **C** · [`4caca4578f729a0accbbf50805ffe92e4aee02b3`（2.8.1）](https://github.com/240xu/dsh-websearch/commit/4caca4578f729a0accbbf50805ffe92e4aee02b3) · ✅ · 2026-09-30
7. **C** · [`3ea0f08f88c1f44a9b5ebcdb718a831226f401dd`（2.8.2）](https://github.com/240xu/dsh-websearch/commit/3ea0f08f88c1f44a9b5ebcdb718a831226f401dd) · ✅ · 2026-10-03
8. **C** · [`2c525ddb0340be55f6c6956634c7c6451686b51a`（2.8.3）](https://github.com/240xu/dsh-websearch/commit/2c525ddb0340be55f6c6956634c7c6451686b51a) · ✅ · 2026-10-04
9. **C** · [`5c8287453728023d7bd14705ed40b5b2fa31f9d7`（2.8.4，本机装）](https://github.com/240xu/dsh-websearch/commit/5c8287453728023d7bd14705ed40b5b2fa31f9d7) · ✅ · 2026-10-18
10. **C** · [`fc737d221899d9894895695eee85053a3025b907`（2.8.5，JA3 sidecar）](https://github.com/240xu/dsh-websearch/commit/fc737d221899d9894895695eee85053a3025b907) · ✅ · 2026-10-18
11. **C** · [`592237f7586bc2da428e5acf41acf40276711b3d`（2.8.6，同名事故修复）](https://github.com/240xu/dsh-websearch/commit/592237f7586bc2da428e5acf41acf40276711b3d) · ✅ · 2026-10-18
12. **C** · [`72cbba8e3c19c77fea2396c7ac00c40b08df52a9`（2.8.6 npm gitHead / proxy-exempt marker）](https://github.com/240xu/dsh-websearch/commit/72cbba8e3c19c77fea2396c7ac00c40b08df52a9) · ✅ · 2026-10-18
13. **C** · [`da42e44a0f54913e132c5219174a3b6f267188fc`（2.8.8 版本号 = npm gitHead）](https://github.com/240xu/dsh-websearch/commit/da42e44a0f54913e132c5219174a3b6f267188fc) + 父 [`8b14d5495f54a9a124c94e8e98d40c6c5d7be69c`](https://github.com/240xu/dsh-websearch/commit/8b14d5495f54a9a124c94e8e98d40c6c5d7be69c)（README 10 秒速查）；**两笔均 `lib/` 零改动** · ✅ · 2026-10-21
14. **E** · npm 2.8.7 `gitHead=608e474fdf5841bb0fcc657c221f85614c9925fc` → public API **422 No commit found** · ❌ 未取到，待核实 · 2026-11-04/05
15. **C/D** · [`CHANGELOG.md @ da42e44a0f54`](https://github.com/240xu/dsh-websearch/blob/da42e44a0f54913e132c5219174a3b6f267188fc/CHANGELOG.md)（294 行，到 2.8.6；`:3-13` 事故复盘、`:15-21` 2.8.5、`:23-32` 2.8.4） · ✅ · 2026-11-04
16. **C/D** · `npm view @240xu/dsh-websearch versions/time/dist-tags --json`（23 版本，latest 2.8.8） · ✅ · 2026-11-04/05（原始输出 [13-raw-evidence.txt](13-raw-evidence.txt)）
17. **A/D** · `/home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/package.json`（`version: 2.8.4`） · ✅ · 2026-11-04/05

### B. 用户仓库代码落点与回归测试（A）
18. **A** · [`lib/util/egress-fetch.js @ 592237f7`](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/util/egress-fetch.js)（`forwarderFetch` 改 `node:http(s)`，+91/−19） · ✅ · 2026-10-18
19. **A** · [`lib/provider.js @ 592237f7`](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/provider.js)（cause chain / 全失败枚举，+47/−18） · ✅ · 2026-10-18
20. **A** · [`lib/backends/searxng.js @ 592237f7`](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/backends/searxng.js)（语义健康 + failover，+162/−59） · ✅ · 2026-10-18
21. **A** · [`lib/util/describe-error.js @ 592237f7`](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/util/describe-error.js) / [`lib/util/failure-label.js @ 592237f7`](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/util/failure-label.js)（新增） · ✅ · 2026-10-18
22. **A** · [`tests/v286-failures.test.js @ 592237f7`](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/tests/v286-failures.test.js)（+303 行，同名事故回归） · ✅ · 2026-10-18
23. **A** · [`tests/egress-fetch.test.js @ 592237f7`](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/tests/egress-fetch.test.js)（+65/−1 forwarder 回归） · ✅ · 2026-10-18
24. **A** · [`lib/util/egress-fetch.js @ fc737d22`](https://github.com/240xu/dsh-websearch/blob/fc737d221899d9894895695eee85053a3025b907/lib/util/egress-fetch.js)（2.8.5 forwarder 模式，+66/−1） / [`lib/backends/ddg.js @ fc737d22`](https://github.com/240xu/dsh-websearch/blob/fc737d221899d9894895695eee85053a3025b907/lib/backends/ddg.js)（POST→GET） · ✅ · 2026-10-18
25. **A** · [`lib/rrf.js @ 27cc5df6`](https://github.com/240xu/dsh-websearch/blob/27cc5df60257ffdc904cdda1c07af547333898f4/lib/rrf.js) / [`tests/v28.test.js @ 27cc5df6`](https://github.com/240xu/dsh-websearch/blob/27cc5df60257ffdc904cdda1c07af547333898f4/tests/v28.test.js) · ✅ · 2026-09-30
26. **A** · [`lib/util/egress-fetch.js @ 5c828745`（2.8.4 CONNECT 隧道，+338）](https://github.com/240xu/dsh-websearch/blob/5c8287453728023d7bd14705ed40b5b2fa31f9d7/lib/util/egress-fetch.js) / [`lib/settings-api.js @ 5c828745`](https://github.com/240xu/dsh-websearch/blob/5c8287453728023d7bd14705ed40b5b2fa31f9d7/lib/settings-api.js) · ✅ · 2026-10-18
27. **C** · [issue #1 / PR #2（设置卡片白屏，closed）](https://github.com/240xu/dsh-websearch/issues/1) · ✅ · 2026-08-29
28. **C** · [issue #4（settingsScope deadlock）](https://github.com/240xu/dsh-websearch/issues/4) · ✅ · 2026-10-08
29. **C** · [PR #7（settings inert on DSH 0.2.x，open）](https://github.com/240xu/dsh-websearch/pull/7) · ✅ · **2026-11-04**（新）
30. **C** · [issue #8（2.8.8 + 0.2.1-rc.5 保存 API Key 失败，open）](https://github.com/240xu/dsh-websearch/issues/8) · ✅ · **2026-11-05**（新，反证）

### C. DSH 官方仓库版本谱系与规则（C/A）
31. **C** · [`deepseek-ai/deepseek-harness` tags（37 个）](https://api.github.com/repos/deepseek-ai/deepseek-harness/tags?per_page=100) · ✅ · 2026-11-04
32. **C** · [`dsh-v0.2.1-alpha.2` → `d743267388641bc76f17c45ce8b4c231aed1d32c`](https://github.com/deepseek-ai/deepseek-harness/commit/d743267388641bc76f17c45ce8b4c231aed1d32c)（本机 HEAD，PR #5946，2026-10-09） · ✅ · 2026-11-04
33. **C** · [`80b07984c4c43769324760a3c58190b6f59efc6a`（**新补**：`packages/web/AGENTS.md:5` 拒绝重定向规则引入）](https://github.com/deepseek-ai/deepseek-harness/commit/80b07984c4c43769324760a3c58190b6f59efc6a) · ✅ · 2026-07-19（Tianyi Cui）
34. **C** · [`5e0e4b2401a181abba82c48deedfb21648729acd`（**新补**：三 provider `redirect:'error'` + 回归测试引入）](https://github.com/deepseek-ai/deepseek-harness/commit/5e0e4b2401a181abba82c48deedfb21648729acd) · ✅ · 2026-07-19（Tianyi Cui，10 文件）；后续唯一修改 [`f736e6f58473`](https://github.com/deepseek-ai/deepseek-harness/commit/f736e6f58473)（2026-08-10，settings options 适配）
35. **C** · [`42f19edd677d803d2587ace1e2f25e465175f65e`（**新补**：PR #406 merge）](https://github.com/deepseek-ai/deepseek-harness/commit/42f19edd677d803d2587ace1e2f25e465175f65e) · ✅ · 2026-07-20
36. **C** · [`fda98dadd2c299222fe6448f75eba96f3d55407d`（DeepSeek Search/Fetch APIs，#6103）](https://github.com/deepseek-ai/deepseek-harness/commit/fda98dadd2c299222fe6448f75eba96f3d55407d) · ✅ · 2026-10-17
37. **C** · [`3859913c68e2e2c6e0218e7994f4a1f11dc48214`（Search/Fetch 设置分离、默认 DeepSeek Search API、删 exa/perplexity 包）](https://github.com/deepseek-ai/deepseek-harness/commit/3859913c68e2e2c6e0218e7994f4a1f11dc48214) · ✅ · 2026-11-03
38. **A** · `/home/ova/dsh/packages/web/AGENTS.md:5`（规则原文） · ✅ · 2026-11-04
39. **A** · `/home/ova/dsh/packages/web/web-search-deepseek/tests/redirect.spec.ts:52-67`（`it.each([301,302,303,307,308])` + `expect(targetRequests).toHaveLength(0)`） · ✅ · 2026-11-04/05
40. **A** · `/home/ova/dsh/packages/web/web-search-exa/tests/exa.spec.ts:99`、`/home/ova/dsh/packages/web/web-search-perplexity/tests/perplexity.spec.ts:93`（`redirect:'error'` opt-in 断言） · ✅ · 2026-11-04/05
41. **C/D** · `npm view @deepseek-ai/dsh versions/time --json`（42 版本；`0.2.1-rc.2` 2026-10-17T08:36Z、`0.2.2-rc.1` 2026-11-04T09:20Z） · ✅ · 2026-11-04/05
42. **C/D** · `npm view @deepseek-ai/dsh-web dist-tags --json`（`latest=0.0.1-rc.1`、`alpha=0.2.2-alpha.3`、`next=0.2.2-rc.1`，**版本陷阱**） · ✅ · 2026-11-05
43. **E** · 07 §8.3 其余 8 条约定的逐条引入 commit（`AGENTS.md:134,135,139,155` 等） · ❌ 未取到，待核实 · 2026-11-05

### D. OpenCode v2（C/A/B）
44. **C/D** · [`sst/opencode` → 301 → `anomalyco/opencode`（id 975734319）](https://api.github.com/repos/sst/opencode) · ✅ · 2026-11-04/05；[`v1.19.5` → `810c0eba1a73`](https://github.com/anomalyco/opencode/commit/810c0eba1a73) / [`v2.0.0` → `63f7ceecbed2`](https://github.com/anomalyco/opencode/commit/63f7ceecbed2)（⚠️「v1 242 / v2 44 个 tag」计数为 09b §1 转述，未独立全分页复核）
45. **C** · [`v2.2.5` tag ref → `9bbb8ce18c80f099e0e448775f59d965ead40a21`（type=commit）](https://api.github.com/repos/anomalyco/opencode/git/ref/tags/v2.2.5) · ✅ · 2026-11-04/05
46. **C** · [`release: v2.2.5` commit（2026-10-30T22:06:51Z，37 文件）](https://github.com/anomalyco/opencode/commit/9bbb8ce18c80f099e0e448775f59d965ead40a21) · ✅ · 2026-10-30
47. **A** · [`packages/core/src/plugin/websearch/ @ v2.2.5`](https://github.com/anomalyco/opencode/tree/v2.2.5/packages/core/src/plugin/websearch)（7 文件：5 provider + `mcp.ts` + `index.ts`） · ✅ · 2026-11-04
48. **C** · [`efb629a33ac4`（pluggable web search，引入 exa/parallel/mcp/index，#35558）](https://github.com/anomalyco/opencode/commit/efb629a33ac4) · ✅ · 2026-07-26
49. **C** · [`e6c9b6bef76f`（firecrawl，#41042）](https://github.com/anomalyco/opencode/commit/e6c9b6bef76f) · ✅ · 2026-08-07
50. **C** · [`3d3bbd48f94c`（tavily，#42591）](https://github.com/anomalyco/opencode/commit/3d3bbd48f94c) · ✅ · 2026-08-14
51. **C** · [`3f579f53f494`（tinyfish，#48561）](https://github.com/anomalyco/opencode/commit/3f579f53f494) + [`86755e1ceafc`（MCP session 修复，#54730）](https://github.com/anomalyco/opencode/commit/86755e1ceafc) · ✅ · 2026-09-12 / 10-15
52. **A** · [`exa.ts @ v2.2.5:8`](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/exa.ts) `https://mcp.exa.ai/mcp`；[`tinyfish.ts @ v2.2.5:10,76`](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/tinyfish.ts) `https://agent.tinyfish.ai/mcp` + `X-TinyFish-Access-Mode: keyless` · ✅ · 2026-11-04
53. **B** · [`https://opencode.ai/v2/docs/websearch`](https://opencode.ai/v2/docs/websearch) **HTTP 200**（5 provider、`random`、429 Retry-After/60s、permission action=websearch） · ✅ · 2026-11-04（11-05 复验 200）
54. **B** · [`https://opencode.ai/v2/docs/console/websearch`](https://opencode.ai/v2/docs/console/websearch) **HTTP 200**（$0.01/次、最多 8 条、零留存、workspace 级 Enable、默认 provider、失败/限流不计费） · ✅ · 2026-11-04（11-05 复验 200）；对照 [`https://opencode.ai/docs/websearch`](https://opencode.ai/docs/websearch) **HTTP 404**（v1 路径失效 → v1 资料不作依据）

### E. 本机实测（D）
55. **D** · [00-lead-live-probe.md](00-lead-live-probe.md) §1–§3/§6（四端点 initialize 全 200 + Parallel 真实 `tools/call`） · ✅ · **2026-11-04**
56. **D** · [02-runtime-state.md](02-runtime-state.md) §5.3/§7/§8（`web_search` 错误串、health `enabled:4`、history `failCount 25/26`、`ps`/`/proc/2200/environ`） · ✅ · 2026-11-04
57. **D** · [13-raw-evidence.txt](13-raw-evidence.txt)（npm time / commit 链 / tags / 本地 git 原始输出） · ✅ · 2026-11-04
58. **D** · [12-change-lineage.md](12-change-lineage.md) §2/§3（2.8.5/2.8.6 完整 commit message 原文与 files[]） · ✅ · 2026-11-04
59. **B/C** · [`https://arxiv.org/abs/2404.01037`](https://arxiv.org/abs/2404.01037) **HTTP 200**，`citation_title` = **「ARAGOG: Advanced RAG Output Grading」**（插件注释把它简写为「盲目多查询劣化」，属转述不精确）；但 [arXiv API 摘要](https://export.arxiv.org/api/query?id_list=2404.01037) 逐字含 "Multi-query approaches underperformed" ⇒ **依据成立、不剔除**（**裁决 1 已推翻本条原「应剔除或降 E」判定**），改写为「ARAGOG 在该实验设置下 Multi-query 低于 Naive RAG 基线」并限定单篇探索性实验 · ✅ 2026-11-06 复核
60. **D** · 本机 2.8.4 `lib/util/egress-fetch.js:262-278` 的 `delete headers["host"]` + CONNECT 隧道不补 Host → Cloudflare `403`；补 `Host: mcp.exa.ai` 后同一 socket 返回 200（[08](08-own-repo.md) 附录 A.2，12 组实验；路径 `/home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/lib/util/egress-fetch.js:276`） · ✅ 他报告实跑，**本审计未独立复现** · 2026-11-05

---

## 9. 审计结论（给 Lead 的一句话版）

> 「迹」是**成立的**：本机 `all enabled backends failed (4)` 不是偶发——CHANGELOG 2.8.6 记录了**同名线上事故**的完整复盘（全局 `EnvHttpProxyAgent` 劫持 sidecar hop），修复逐文件落在 [`592237f7586b`](https://github.com/240xu/dsh-websearch/commit/592237f7586bc2da428e5acf41acf40276711b3d) 与 [`tests/v286-failures.test.js`](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/tests/v286-failures.test.js)（+303 行），前置 [`fc737d221899`](https://github.com/240xu/dsh-websearch/commit/fc737d221899d9894895695eee85053a3025b907) 引入 JA3 sidecar；DSH 官方的「拒绝重定向」规则也经本审计补上了确切引入 commit [`5e0e4b2401a1`](https://github.com/deepseek-ai/deepseek-harness/commit/5e0e4b2401a181abba82c48deedfb21648729acd) / [`80b07984c4c4`](https://github.com/deepseek-ai/deepseek-harness/commit/80b07984c4c43769324760a3c58190b6f59efc6a) 与回归测试。
> **但「可追溯」还不等于「已闭环」**：当前版本全队仍有 **~93 条浮动 `main/dev/master` 链接**需换成固定 ref（[12](12-change-lineage.md) §0.3 已是正确范本；裁决 5 决定不批量改写、主报告一律用固定 ref）；**arXiv:2404.01037 的「盲目多查询劣化」是转述不精确**（[10](10-link-verification.md) §4 R6，本报告独立复核标题为 ARAGOG）→ **裁决 1 已推翻「应剔除」，改为精确化表述**；[08](08-own-repo.md) 附录的 403 缺 Host 根因已由 **裁决 2** 定为唯一口径（JA3 归因证伪），00/02/10 旧正文保留为过程记录并已就地加注；2.8.7 的 `gitHead` 来源、07 另外 8 条约定的引入 commit、「回归用例当前为绿」仍是 E；且 **2026-11-05 新报的 [#7](https://github.com/240xu/dsh-websearch/pull/7) / [#8](https://github.com/240xu/dsh-websearch/issues/8) 直接说明 2.8.8 在 DSH 0.2.x 上仍有未修问题**（裁决 3 已核实为 C 级）——任何「升级即修复」的表述必须继续标 E 并附这两条。
> 本审计**未修改任何源码/配置/其它报告**；所有凭证值未写入本文件及任何输出。

---

## 附录 · Lead 裁决（2026-11-06，只追加，不改动上文任何一行；最终报告以本附录为准）

上文 §7.2 P0/P1 与 §9 的处置建议，经 Lead 用一手原文与最小 A/B 复现后裁决如下。上文保留为审计过程记录。

### 裁决 1：arXiv:2404.01037 **不剔除**，改写为精确表述

10 号 R6 指出该文 `citation_title` 为 **「ARAGOG: Advanced RAG Output Grading」**、并非「盲目多查询劣化」——该点正确，插件 `lib/multiquery.js:3,29` / `README.md:130,249` 属**转述不精确**。但 Lead 用 [`export.arxiv.org/api/query?id_list=2404.01037`](https://export.arxiv.org/api/query?id_list=2404.01037) 取到摘要原文逐字含：
> "We found that Hypothetical Document Embedding (HyDE) and LLM reranking significantly enhance retrieval precision. However, Maximal Marginal Relevance (MMR) and Cohere rerank did not exhibit notable advantages over a baseline Naive RAG system, **and Multi-query approaches underperformed**."

`arxiv.org/abs` 页面另含 3× `Multi-query`、3× `underperform`、3× `MMR`、3× `Naive RAG`（HTTP 200，2026-11-06）。⇒ **实质依据成立**；正确写法为「ARAGOG(arXiv:2404.01037) 在该实验设置下报告 Multi-query 低于 Naive RAG 基线、MMR/Cohere rerank 无显著优势」，并限定为单篇探索性实验、非普适定律；`multiQueryEnabled` 默认关是插件作者据此做的工程取舍，不是论文规范。同一论文同时是 HyDE/LLM rerank 的**正面**证据。HyDE 2212.10496 / Step-Back 2310.06117 / Cormack SIGIR 2009 标题出处均正确。

### 裁决 2：403 根因**不并列**，采用「缺 `Host` 头」，JA3 归因已证伪

08 附录给出 `egress-fetch.js:276` `delete headers["host"]` + `httpsViaConnect` 不补 Host（对比 `httpViaProxy:202` 有 `host: headers.host ?? target.host`）→ Cloudflare 403。Lead 做**最小 A/B**：同一 CONNECT 通道（`172.30.66.1:1091`）、同一 `node:https`/OpenSSL 栈、同一 UA、同一 body，**唯一变量 Host 头** → `WITHOUT Host: 403` / `WITH Host: 200`。
⇒ 02 号「Node/OpenSSL TLS ClientHello 指纹被拒」**被证伪**（TLS 栈完全没变，只加一个 HTTP 头即 200）；2.8.5 CHANGELOG 的「JA3 指纹」是作者当时的假设。08 的 12 组实验（改 ALPN 仍 403、仅补 Host 即 200、同步复现 ddg 301 与 searx.be 反爬页）与 Lead A/B 独立互证。全队统一口径：**403 = 缺 Host 头被 Cloudflare 边缘拒**；JA3 仅作 CHANGELOG 历史归因保留。仍 E：CF WAF 规则编号、`forwarderFor` spec 与 sidecar 逐字段一致性、升级后是否恢复。

### 裁决 3：PR #7 / Issue #8 已核实为 C 级反证（坐实「升级非闭环」）

| 编号 | 状态 | 日期 | 核实要点 | 等级 |
| --- | --- | --- | --- | --- |
| [PR #7](https://github.com/240xu/dsh-websearch/pull/7) `fix: settings are inert on DSH 0.2.x (no installSection) + RFC1918 plain-http base URLs rejected` | **open** | 2026-11-04 | DSH 0.2.x 无 `settings.installSection` → `apply(ctx,config)` 只拿到 schema defaults，profile-patch 值在 settings service effective config ⇒ **所有设置（含 `enabledBackends`、base URL）inert** | C |
| [Issue #8](https://github.com/240xu/dsh-websearch/issues/8) `保存 API Key 失败：client inject 缺少 remote.credentials（DSH 0.2.x）` | **open** | 2026-11-05 | `@240xu/dsh-websearch 2.8.8` + `@deepseek-ai/dsh 0.2.1-rc.5`；`lib/client.js:657` 的 inject 缺 `remote.credentials`，0.2.x 把每个命名空间注册成独立服务、未声明即抛 ⇒ **所有 key-gated 后端存不了 Key** | C |

⇒ 这是「升级到 2.8.8 即修复」必须继续标 E 的直接 C 级反证，并新增 **P0 前置条件**：本机 DSH `0.2.1-rc.2` 升级前须确认 PR #7 / Issue #8 是否已修或需手工绕过。另 [Issue #6](https://github.com/240xu/dsh-websearch/issues/6)（open, 2026-10-30「保存按钮怎么没有？」）、[Issue #3](https://github.com/240xu/dsh-websearch/issues/3)（open, 2026-09-08「升级到 dsh 0.12-rc1 之后无法使用」）为同类线索（C 待核实）。GitHub `search/issues` 对 `403/MCP/redirect/all-failed` 四关键词 total=0 ⇒ **事故无公开 issue 编号，不得编造**。

### 裁决 4：证据索引补 2 条（替换 2 条低价值项，总数仍 60）

- **A′** · arxiv API 摘要原文「Multi-query approaches underperformed」 · HTTP 200 · 2026-11-06 —— 支撑裁决 1。
- **A/D** · 本机 `lib/util/egress-fetch.js:276` + 最小 A/B（`WITHOUT Host: 403` / `WITH Host: 200`）· 2026-11-06 —— 支撑裁决 2；配套 [08 附录 A.2](08-own-repo.md)。

### 裁决 5：浮动 `main` 链接（~93 条）的处置

12 §0.3 的固定 ref 纪律是正确范本。但**全量替换 93 条属机械批量改写，风险高于收益**：各报告已用 `ref=main` + commit sha + CHANGELOG 行号 + 本地路径:行号形成多重锚点，且 `main` 内容已由 npm 2.8.8 tarball 逐字节比对确认。故本轮**不批量改写**，仅在最终 [REPORT.md](REPORT.md) 的权威链接清单中一律使用固定 ref（`v2.2.5` / `592237f7586b` / `da42e44a0f54` / `dsh-v0.2.1-alpha.2`），并把该纪律写入 §6 供后续维护者遵守。11 号审计的打分与缺口清单作为过程记录保留。

> 本附录无凭证值、无新增浮动 ref 作为依据；未改动上文任何一行。
