# 12 — dsh-websearch 改动谱系完整展开（逐 commit 溯源 / 事故复盘 / 依据→代码闭环）

> 报告目标：把 `@240xu/dsh-websearch` 的**每一次改动**都落到可复核的「依据 → 代码 → 验证」链上，做到「所有改动有迹可循、有可靠资料支撑、有详细标注」。本报告是「迹」的逐条展开。
> 本报告为 Lead 初版（2026-11-04 17:36）的**完整展开版**：补齐 2.8.1–2.8.4 逐 commit 详情卡、`files[]` 全清单与 patch 片段、2.8.5/2.8.6 逐行代码对应、外部资料 HTTP 状态实测、「依据→代码」18 条映射、62 条证据索引、以及 2.8.7 孤儿发布 / 2.8.8 ≡ 2.8.6 `lib/` 的关键谱系结论；保留并复核了初版全部结论。
>
> | 项 | 值 |
> | --- | --- |
> | 报告编号 | 12-change-lineage.md |
> | 核验日期 | 2026-11-04 ~ 2026-11-05（Asia/Shanghai） |
> | 上游仓库 | `240xu/dsh-websearch`（public），[commit 列表](https://github.com/240xu/dsh-websearch/commits/da42e44a0f54913e132c5219174a3b6f267188fc)（共 53 条） |
> | npm 包 | [@240xu/dsh-websearch](https://www.npmjs.com/package/@240xu/dsh-websearch)，`latest = 2.8.8` |
> | `repository.url` | `git+https://github.com/240xu/dsh-websearch.git`（[package.json@da42e44a](https://github.com/240xu/dsh-websearch/blob/da42e44a0f54913e132c5219174a3b6f267188fc/package.json)，C/D，[13-raw-evidence.txt](13-raw-evidence.txt)） |
> | 本机安装 | **2.8.4**，`/home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/` |
> | 取证手段 | GitHub REST API（`commits?per_page=100`、`commits/{sha}` 含 `files[]`/`patch`/`stats`/`parents`、`tags`、`releases`、`branches`、`git/trees`、`raw.githubusercontent.com` 固定 sha）、`npm view`、`npm pack` tarball 解包逐文件 diff、本机 `read`/`grep`/`ls`、外部 URL HTTP 状态实测 |
> | 凭证 | 使用 `/opt/xr-research/zcode-research/.git/config` 内 Basic 凭证（仅用于 API 额度，报告内**不含任何 token 值**）；仓库 public，匿名亦可取 |
> | 外部内容 | 一律作为**数据**对待，不作指令；带访问日期与 HTTP 状态 |
> | 关联产物 | [00-lead-live-probe.md](00-lead-live-probe.md)、[02-runtime-state.md](02-runtime-state.md)、[03-protocol-standards.md](03-protocol-standards.md)、[07-dsh-docs.md](07-dsh-docs.md)、[08-own-repo.md](08-own-repo.md)、[10-link-verification.md](10-link-verification.md)、[13-raw-evidence.txt](13-raw-evidence.txt)、[REPORT.md](REPORT.md) |

---

## 0. 证据等级与「四联标注」规范（全队统一）

### 0.1 证据等级定义

| 等级 | 定义 | 最小可核验证据 |
| --- | --- | --- |
| **A** | 源码实证 | 带 **commit sha 永久链接**或本机 `路径:行号`；引用的是该 sha 当时的文件内容，不是浮动 `main` |
| **B** | 官方文档 / 外部权威资料 | URL + 访问日期（2026-11-04）+ 实测 HTTP 状态；状态非 200 必须显式标注 |
| **C** | 版本记录 | CHANGELOG 行号 / tag / commit sha / npm 版本与时间 / registry `gitHead` / issue |
| **D** | 本机实测 | 本机命令输出、实跑 `web_search` 错误串、health / history 端点、session 日志 |
| **E** | 推断或待核实 | **显式标注，不得当结论**；包括「取不到，待核实」「预期收益推断」「因果未抓包」 |

### 0.2 四联标注法

每条结论按 **「结论 → 依据(B/C) → 代码落点(A) → 验证(D)」** 四联标注；任何一联缺失即降级并在该联标 `E`。示例：

> 结论：2.8.6 把 DDG 超时上限从 5s 提到 8s。
> 依据(C)：[CHANGELOG@da42e44a L12](https://github.com/240xu/dsh-websearch/blob/da42e44a0f54913e132c5219174a3b6f267188fc/CHANGELOG.md#L12) + commit message `ddg ceiling 5s->8s`。
> 代码落点(A)：[provider.js@592237f L45](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/provider.js#L45) `ddg: 8000`。
> 验证(A/D)：[v28-p2.test.js@592237f](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/tests/v28-p2.test.js) 断言 `effectiveBackendTimeoutMs("ddg",30000)===8000`；本机 2.8.4 `provider.js:39` 仍为 `ddg: 5000`（D）。

### 0.3 永久链接纪律

- GitHub 一律带 **完整 40 位 sha**（或 tag），格式 `https://github.com/240xu/dsh-websearch/blob/<sha>/<path>#L<n>`；**禁止**用 `blob/main/...` 作依据。（Lead 初版 §6 索引第 15/16/27–33 条用过 `blob/main`，本版已全部改为固定 sha。）
- npm 一律 `https://www.npmjs.com/package/@240xu/dsh-websearch/v/<version>`。
- 行号 `L<n>` 只对**该 sha 当时文件**有效，本报告逐条核对。
- 所有 sha 均来自 API 实测；未取到的标「未取到，待核实」，**绝不编造 sha / 版本号**。

---

## 1. 谱系骨架复核（Lead 骨架逐条核验 + 补全）

### 1.1 npm 版本时间线（C/D，实测 `npm view ... time --json` + `dist-tags` + registry `gitHead`，原始输出见 [13-raw-evidence.txt](13-raw-evidence.txt)）

| npm 版本 | 发布时间(UTC) | registry `gitHead` | 对应 git commit 是否在 main | 等级 |
| --- | --- | --- | --- | --- |
| 2.8.0 | `2026-09-30T03:13:23.889Z` | npm 无 `gitHead`；git commit = [`27cc5df60257`](https://github.com/240xu/dsh-websearch/commit/27cc5df60257ffdc904cdda1c07af547333898f4)（§2.1） | 是 | C |
| 2.8.1 | `2026-09-30T14:31:57.473Z` | npm 无 `gitHead`；git commit = [`4caca4578f72`](https://github.com/240xu/dsh-websearch/commit/4caca4578f72)（§2.1） | 是 | C |
| 2.8.2 | `2026-10-03T10:14:06.214Z` | npm 无 `gitHead`；git commit = [`3ea0f08f88c1`](https://github.com/240xu/dsh-websearch/commit/3ea0f08f88c1)（§2.1） | 是 | C |
| 2.8.3 | `2026-10-05T02:26:35.315Z` | npm 无 `gitHead`；git commit = [`2c525ddb0340`](https://github.com/240xu/dsh-websearch/commit/2c525ddb0340)（§2.1） | 是 | C |
| 2.8.4 | `2026-10-18T06:02:07.055Z` | `5c8287453728023d7bd14705ed40b5b2fa31f9d7` | 是 | C |
| 2.8.5 | `2026-10-18T10:31:56.336Z` | `fc737d221899d9894895695eee85053a3025b907` | 是 | C |
| 2.8.6 | `2026-10-18T14:04:02.831Z` | `72cbba8e3c19c77fea2396c7ac00c40b08df52a9` | 是（注意：**不是** 592237f，见 §1.3） | C |
| 2.8.7 | `2026-10-20T12:53:52.217Z` | `608e474fdf5841bb0fcc657c221f85614c9925fc` | **否，孤儿提交**（API 返回 422，见 §1.4） | C + E |
| **2.8.8** | `2026-10-21T14:10:40.457Z` | `da42e44a0f54913e132c5219174a3b6f267188fc` | 是（main HEAD） | C |

- `dist-tags.latest = 2.8.8`（C/D，实测，[13-raw-evidence.txt](13-raw-evidence.txt)）。
- npm 版本页：[2.8.0](https://www.npmjs.com/package/@240xu/dsh-websearch/v/2.8.0) / [2.8.1](https://www.npmjs.com/package/@240xu/dsh-websearch/v/2.8.1) / [2.8.2](https://www.npmjs.com/package/@240xu/dsh-websearch/v/2.8.2) / [2.8.3](https://www.npmjs.com/package/@240xu/dsh-websearch/v/2.8.3) / [2.8.4](https://www.npmjs.com/package/@240xu/dsh-websearch/v/2.8.4) / [2.8.5](https://www.npmjs.com/package/@240xu/dsh-websearch/v/2.8.5) / [2.8.6](https://www.npmjs.com/package/@240xu/dsh-websearch/v/2.8.6) / [2.8.7](https://www.npmjs.com/package/@240xu/dsh-websearch/v/2.8.7) / [2.8.8](https://www.npmjs.com/package/@240xu/dsh-websearch/v/2.8.8)。
- 注：本机 `npm` 配置的 registry 是 `https://registry.npmmirror.com`（镜像），`dist.tarball` 取自该镜像；`gitHead` 与版本时间来自 registry 元数据，与 GitHub commit sha 交叉验证（2.8.4/2.8.5/2.8.6/2.8.8 全部一一对应）。
- 注（保留 Lead 初版 §1 观察）：2.8.5 的 commit 时间 `10:28:37`、2.8.6 的 `12:27:50`、`72cbba8e` 的 `12:35:08` 与 npm 发布时间 `10:31:56` / `14:04:02` 有分钟级差异（构建/发布流程），两者并列不作互相否定（C）。

### 1.2 GitHub commit 时间线（C，`commits?per_page=100` 共 53 条，以下为 2.8.x 段）

| # | 短 sha | 完整 sha | 日期(UTC) | 作者 | commit message 首行 | parents |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `da42e44a0f54` | `da42e44a0f54913e132c5219174a3b6f267188fc` | 2026-10-21T14:08:30Z | 240xu | docs: add 10-second quick start; align version metadata | `8b14d549…` |
| 2 | `8b14d5495f54` | `8b14d5495f54a9a124c94e8e98d40c6c5d7be69c` | 2026-10-21T14:08:26Z | 240xu | docs: add 10-second quick start; align version metadata | `72cbba8e…` |
| 3 | `72cbba8e3c19` | `72cbba8e3c19c77fea2396c7ac00c40b08df52a9` | 2026-10-18T12:35:08Z | Xu198440 | docs: proxy-exempt marker on the sidecar forwarder hop | `592237f7…` |
| 4 | `592237f7586b` | `592237f7586bc2da428e5acf41acf40276711b3d` | 2026-10-18T12:27:50Z | Xu198440 | **2.8.6: forwarder hop via node:http (dispatcher-hijack fix) + failure-path hardening** | `fc737d22…` |
| 5 | `fc737d221899` | `fc737d221899d9894895695eee85053a3025b907` | 2026-10-18T10:28:37Z | Xu198440 | **2.8.5: TLS-egress forwarder (DSH_EGRESS_FORWARDER) + ddg GET form** | `5c828745…` |
| 6 | `5c8287453728` | `5c8287453728023d7bd14705ed40b5b2fa31f9d7` | 2026-10-18T05:48:31Z | Xu198440 | v2.8.4: 0.2.1-alpha settings-section compat … | `dd05d0ca…` |
| 7 | `dd05d0ca9cc7` | `dd05d0ca9cc7c19c88d2370750ed4d6e90496292` | 2026-10-09T16:08:07Z | Xu198440 | docs: CHANGELOG 条目格式修正（2.8.2 加标题） | `138764a2…` |
| 8 | `138764a23b91` | `138764a23b915a8b2e8b40b2afc230389ad7e707` | 2026-10-09T16:06:18Z | Xu198440 | docs: CHANGELOG 补齐 2.8.2 / 2.8.3 | `2c525ddb…` |
| 9 | `2c525ddb0340` | `2c525ddb0340be55f6c6956634c7c6451686b51a` | 2026-10-04T06:35:30Z | 240xu | v2.8.3: empty shaped-query rejected early … | `3ea0f08f…` |
| 10 | `3ea0f08f88c1` | `3ea0f08f88c1f44a9b5ebcdb718a831226f401dd` | 2026-10-03T10:12:26Z | 240xu | v2.8.2: P1 fixes — legitimate zero-results … | `eab486c4…` |
| 11 | `eab486c41b78` | `eab486c41b786f1fb3373dfca69ee1d9893758f6` | 2026-10-01T17:28:22Z | websearch-innovator | docs: gitignore .scratch | `4caca457…` |
| 12 | `4caca4578f72` | `4caca4578f729a0accbbf50805ffe92e4aee02b3` | 2026-09-30T14:19:19Z | websearch-innovator | v2.8.1: 0.2.0 SettingsForms adapter | `27cc5df6…` |
| 13 | `27cc5df60257` | `27cc5df60257ffdc904cdda1c07af547333898f4` | 2026-09-30T03:07:03Z | websearch-innovator | v2.8.0: multiQuery RRF fusion + deepCoverage … | `6a69eab9…` |

> 作者名分布（C）：2.8.1–2.8.6 的功能 commit 由 `Xu198440 <ova442757@163.com>` / `240xu <2401826246@qq.com>` / `websearch-innovator <2401826246@qq.com>` 交替提交；2.8.7/2.8.8 的文档与版本号由 `240xu` 提交。这是同一维护者的多个身份，**非多人协作证据**（E，仅从邮箱推断，未核实账号归属）。

**更早的关键锚点（C，补全 Lead 骨架）**：

| 短 sha | 完整 sha | 日期 | 说明 |
| --- | --- | --- | --- |
| `e90828d043c9` | `e90828d043c96b3a91c6fe84b582cf8f924b7275` | 2026-09-27T05:19:19Z | v2.7.0：磁盘缓存 / 熔断 / 历史（「权威依据」最初对应的实现） |
| `f92d8c863eeb` | `f92d8c863eebc2de853558e9ebc3f5152aeb1f87` | 2026-09-27T14:35:03Z | 首次写入 README「权威依据与取舍」章节（§5 依据来源） |
| `a65acf0c3507` | `a65acf0c3507e3d5e2728403a30de0a985695717` | 2026-09-27T01:50:19Z | v2.6.0：系统性搜索提示词（Tavily/Exa/Anthropic/OpenAI/论文依据落地） |
| `d12c03ac5080` | `d12c03ac5080bd6f29a8c67ad10f38de953bac76` | 2026-09-22T16:21:03Z | v2.5.0-phase1：health 路由 + 逐后端遥测（本机 `failCount` 的来源） |
| `601ba8bf3d00` | `601ba8bf3d0034bc4d8da2d47e511b9165bdd6ef` | 2026-08-20T05:57:32Z | **tag v2.0.0** |
| `caff15933959` | `caff1593395990e69dfd0627fd4f1c8d97293673` | 2026-08-19T06:44:27Z | **tag v1.0.0** |

### 1.3 【重要修正】npm 2.8.6 对应的是 `72cbba8e`，不是 `592237f`

- `GET /commits/592237f…` 的 message 首行是 `2.8.6: forwarder hop via node:http ...`，`package.json` 在该 commit 内由 `2.8.5` → `2.8.6`（A：[commit 592237f](https://github.com/240xu/dsh-websearch/commit/592237f7586bc2da428e5acf41acf40276711b3d) 内 `package.json` 段）。
- 但 **registry `gitHead` for 2.8.6 = `72cbba8e3c19c77fea2396c7ac00c40b08df52a9`**（C，实测）。即发布时又带上了一个纯文档 commit（`72cbba8e` 把 `egress-fetch.js` 的注释改写为 `proxy-exempt` 约定标记，+8 −6，仅注释）。
- 交叉验证（A/D）：2.8.6 tarball 解包后的 `lib/util/egress-fetch.js:148` 含 `* proxy-exempt: this hop must own its transport ...`，与 `raw.githubusercontent.com/.../72cbba8e.../lib/util/egress-fetch.js` 完全一致，而 `592237f` 版本该处为 `* This hop deliberately speaks node:http(s) directly ...`。**结论：npm 2.8.6 = main 上 `592237f` + `72cbba8e` 两个 commit 之和**（C+A+D 四联齐全）。

### 1.4 【重大谱系缺口】2.8.7 是「孤儿发布」，2.8.8 回退后与 2.8.6 的 `lib/` 字节相同

| 结论 | 依据(C/A/D) | 等级 |
| --- | --- | --- |
| 2.8.7 的 `gitHead` 为 `608e474fdf5841bb0fcc657c221f85614c9925fc` | registry 元数据 `gitHead` | C |
| 该 sha **不在 main、不在任何分支**：`GET /commits/608e474f…` 返回 `HTTP 422 No commit found for SHA`；`branches` 只有 `main = da42e44a`；`git/trees/da42e44a?recursive=1` 无 `lib/config.js` | GitHub API 实测（2026-11-04/05） | C + E（未取到 commit 内容，标「待核实」） |
| 2.8.7 tarball 相对 2.8.6 只多 `lib/config.js`、改 `lib/index.js`（把 `Config` / 常量抽到 `config.js` 并在 `package.json` 加 `"./config"` 导出） | tarball 逐文件 diff（A/D） | A |
| 2.8.8 tarball **删掉** `lib/config.js`、`package.json` 去掉 `"./config"`，`lib/index.js` 还原为内嵌 `Config`（与 2.8.6 的 `lib/index.js` **逐字节相同**），只新增 README「10 秒速查」 | tarball 逐文件 diff；`diff -q` 全部 `lib/*.js` 与 `lib/backends/*.js`、`lib/util/*.js` 无差异（A/D） | A |
| main 上 `da42e44a` 的 `package.json` 直接由 **2.8.6 → 2.8.8**（跳过 2.8.7） | [commit 补丁](https://github.com/240xu/dsh-websearch/commit/da42e44a0f54913e132c5219174a3b6f267188fc)：`-"version": "2.8.6"` / `+"version": "2.8.8"` | A |
| 2.8.7/2.8.8 **没有 CHANGELOG 条目**：git main 的 [CHANGELOG@da42e44a](https://github.com/240xu/dsh-websearch/blob/da42e44a0f54913e132c5219174a3b6f267188fc/CHANGELOG.md) 最新为 `## 2.8.6 - 2026-10-18`（L3）；且 2.8.6/2.8.7/2.8.8 三个 npm tarball 内**均不含 `CHANGELOG.md`**（`files` 白名单未收录） | git raw + tarball 文件清单 | **C（已核实，非 E）** |

> **工程含义（这是「迹」最关键的一条）**：`latest=2.8.8` 的**运行时代码 == 2.8.6 的运行时代码**；升到 2.8.8 拿到的功能修复全部来自 2.8.5 / 2.8.6。2.8.7 是一次「抽 `config.js`」的重构实验，只发到 npm、未推 GitHub、随后在 2.8.8 被完整回退；**若有人按 `gitHead` 追 2.8.7 会扑空**（422）。这一点必须如实记录，不能把 2.8.7 当作一个「有 commit 可查」的版本。（Lead 初版 §0/§7 已标 E，本版补上 tarball 全量 diff 的 A 级证据。）

### 1.5 git tag 现状（C，如实写明）

- `GET /tags?per_page=100` → **仅 2 个 tag**：`v1.0.0 = caff1593395990e69dfd0627fd4f1c8d97293673`、`v2.0.0 = 601ba8bf3d0034bc4d8da2d47e511b9165bdd6ef`（[13-raw-evidence.txt](13-raw-evidence.txt) 亦记录）。
- `GET /releases` → **0 个 release**。
- **没有任何 2.8.x 的 tag** → 2.8.x 的版本身份由 **`package.json` 的 `version` 字段 + npm 发布 + CHANGELOG 条目** 三者共同承载，**不是 git tag**。这是本项目版本谱系的结构性事实，任何「按 tag 找 2.8.6」的做法都会失败；正确锚点是 commit sha（§1.2）+ npm 版本页 + registry `gitHead`。

### 1.6 CHANGELOG 版本条目行号（C，固定 sha）

[CHANGELOG@da42e44a（= main HEAD，内容同 2.8.6 发布时）](https://github.com/240xu/dsh-websearch/blob/da42e44a0f54913e132c5219174a3b6f267188fc/CHANGELOG.md)：

```
L3   ## 2.8.6 - 2026-10-18        ← 最新条目（无 2.8.7 / 2.8.8）
L15  ## 2.8.5 - 2026-10-18
L23  ## 2.8.4 - 2026-10-18
L34  ## 2.8.3 - 2026-10-06
L38  ## 2.8.2 - 2026-09-30
L42  ## 2.8.1 - 2026-09-29
L60  ## 2.8.0 - 2026-09-29
L87  2.7.3 / L103 2.7.2 / L110 2.7.1 / L126 2.7.0 / L146 2.6.0 / L160 2.5.0
L167 2.4.0 / L201 2.3.0 / L213 2.2.0 / L240 2.1.1 / L249 2.1.0 / L282 2.0.6 / L286 2.0.5 / L290 2.0.0
```

> 注意日期不一致（C）：CHANGELOG 里 `2.8.3 - 2026-10-06` 但 commit `2c525ddb` 作者日期 `2026-10-04T06:35:30Z`（npm 发布 `2026-10-05T02:26:35Z`）；`2.8.2 - 2026-09-30` 但 commit `3ea0f08f` 是 `2026-10-03T10:12:26Z`；`2.8.1 - 2026-09-29` 但 commit `4caca457` 是 `2026-09-30T14:19:19Z`。**CHANGELOG 条目日期是补写时填的，与 commit / npm 日期不齐**，以 commit sha / npm 发布时间为准。补写的直接证据：`138764a23b91`（2026-10-09）「CHANGELOG 补齐 2.8.2 / 2.8.3」与 `dd05d0ca9cc7`（2026-10-09）「条目格式修正（2.8.2 加标题）」两个纯文档 commit（A：[138764a2 补丁](https://github.com/240xu/dsh-websearch/commit/138764a23b915a8b2e8b40b2afc230389ad7e707) / [dd05d0ca 补丁](https://github.com/240xu/dsh-websearch/commit/dd05d0ca9cc7c19c88d2370750ed4d6e90496292)）——这是「文档对齐」型改动的典型样本。

---

## 2. 逐 commit 改动谱系表（必须交付项 1/2）

> 「是否修复本机 `all enabled backends failed (4)`」判「是」的，均需 §6 闭环四联支撑。
> 永久链接均为 `https://github.com/240xu/dsh-websearch/commit/<完整sha>`；CHANGELOG 依据列给出固定 sha 的行号链接。

| 版本 / commit | 日期(UTC) | 改动意图 | 触发原因 | 依据（CHANGELOG 行号 + commit 永久链接） | 改动文件与函数 | 新增/修改的测试文件 | 修复本机 `all-backends-failed (4)`？ | 等级 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **2.8.1** `4caca4578f729a0accbbf50805ffe92e4aee02b3` | 2026-09-30T14:19:19Z | 0.2.0 SettingsForms 适配：`Config.meta.volatile`（整 Config 作表单）、去掉矛盾 warn、补齐所有裸字段 description | **兼容性**（DSH 0.2.0 `volatileForm` 只保留带 volatile 标记的字段，否则设置表单为空；依据 `dsh-plugin-hub/docs/reviews/cross-settings-forms.md`） | [CHANGELOG L42–58](https://github.com/240xu/dsh-websearch/blob/da42e44a0f54913e132c5219174a3b6f267188fc/CHANGELOG.md#L42) + [commit](https://github.com/240xu/dsh-websearch/commit/4caca4578f729a0accbbf50805ffe92e4aee02b3) | `lib/index.js`（`Config.meta = {...volatile:true}` L249；`installSettingsSection` 去 warn）、`cordis.patch.yml`、`README.md`、`package.json` 2.8.0→2.8.1；附带空文件 `240xu-dsh-websearch-2.8.0.tgz`（+0 −0） | **新增** `tests/v281-form.test.js`（+39）守 `volatile`/description/RT 复制 | 否（设置 UI 层） | A+C |
| **2.8.2** `3ea0f08f88c1f44a9b5ebcdb718a831226f401dd` | 2026-10-03T10:12:26Z | P1 修复：合法零结果不再被伪造成 all-backends-failed；limiter 同步抛错不再泄漏 `running`（死锁）；exa category 推断受 `deepCoverage` 门控 | **线上逻辑缺陷**（P1 review）：`all enabled backends failed (0) - ` 空 detail + 丢弃 Tavily 直答；`Promise.resolve(fn())` 同步 throw 导致 `running` 永不回减、全挂起（实测 exit=13） | [CHANGELOG L38–40](https://github.com/240xu/dsh-websearch/blob/da42e44a0f54913e132c5219174a3b6f267188fc/CHANGELOG.md#L38) + [commit](https://github.com/240xu/dsh-websearch/commit/3ea0f08f88c1f44a9b5ebcdb718a831226f401dd) | `lib/provider.js`（`createLimiter` 导出 + `.then(fn)` L85/104；`allFailures.length===0` 提前返回 L441 段）、`lib/backends/exa.js`（category 门控）、`README.md`、`package.json` | **新增** `tests/p1-regression.test.js`（+53，3 例：零结果 / limiter 死锁 / exa 门控） | 部分（只修「零结果误报」，不修 403/301/非 JSON） | A+C |
| **2.8.3** `2c525ddb0340be55f6c6956634c7c6451686b51a` | 2026-10-04T06:35:30Z | 整形后空查询早拒（不扇出、不污染缓存）；补裸「搜索」寒暄词；CJK 分隔符须任一侧有边界（保护「柔和光线 / 和平精英」等实体） | **线上逻辑缺陷（P2）**：寒暄独词被剥成 `""` → 空串扇出 + 共享缓存键 + 误导性 `all-backends-failed(0)` | [CHANGELOG L34–36](https://github.com/240xu/dsh-websearch/blob/da42e44a0f54913e132c5219174a3b6f267188fc/CHANGELOG.md#L34) + [commit](https://github.com/240xu/dsh-websearch/commit/2c525ddb0340be55f6c6956634c7c6451686b51a) | `lib/provider.js`（`if(!effReq.query) throw` L202 段）、`lib/multiquery.js`（CJK 边界正则）、`lib/prompting.js`（裸「搜索」）、`README.md`、`package.json` | **修改** `tests/p1-regression.test.js`（+30，2 例：CJK 词内保护 / 空查询早拒） | 部分（同上） | A+C |
| `eab486c41b786f1fb3373dfca69ee1d9893758f6` | 2026-10-01T17:28:22Z | `.gitignore` 忽略 `.scratch`（live-test harness 工作区） | **工程卫生** | [commit](https://github.com/240xu/dsh-websearch/commit/eab486c41b786f1fb3373dfca69ee1d9893758f6)（+1 −0，无 CHANGELOG 条目） | `.gitignore` | 无 | 否 | A |
| `138764a23b915a8b2e8b40b2afc230389ad7e707` | 2026-10-09T16:06:18Z | CHANGELOG 补齐 2.8.2 / 2.8.3 条目 | **文档对齐**（版本发布后补写；2.8.2 当时未加 `##` 标题） | [commit](https://github.com/240xu/dsh-websearch/commit/138764a23b915a8b2e8b40b2afc230389ad7e707) | `CHANGELOG.md`（+6） | 无 | 否 | A+C |
| `dd05d0ca9cc7c19c88d2370750ed4d6e90496292` | 2026-10-09T16:08:07Z | CHANGELOG 条目格式修正（2.8.2 加 `##` 标题） | **文档对齐** | [commit](https://github.com/240xu/dsh-websearch/commit/dd05d0ca9cc7c19c88d2370750ed4d6e90496292) | `CHANGELOG.md`（+3 −1） | 无 | 否 | A+C |
| **2.8.4**（本机安装版）`5c8287453728023d7bd14705ed40b5b2fa31f9d7` | 2026-10-18T05:48:31Z | 0.2.1-alpha 设置区兼容（fenced settings bridge + 无条件注册 section）、**proxy-aware egress CONNECT 隧道**、数值字段边界、凭证事件、history/health admission fence | **兼容性 + 部署环境**（kill-switched 容器 egress 只放行代理；Node 全局 fetch 忽略 `HTTP_PROXY`） | [CHANGELOG L23–32](https://github.com/240xu/dsh-websearch/blob/da42e44a0f54913e132c5219174a3b6f267188fc/CHANGELOG.md#L23) + [commit](https://github.com/240xu/dsh-websearch/commit/5c8287453728023d7bd14705ed40b5b2fa31f9d7)（+1158 −42，19 文件） | **新增** `lib/util/egress-fetch.js`(+338)、`lib/settings-api.js`(+277)、`lib/trust.js`(+179)；`lib/client.js`(+139 −20)、`lib/index.js`(+25 −4)、`lib/health.js`/`lib/history.js`/`lib/util/mcp-client.js`（4 处 `fetch`→`egressFetch`）、8 个 backend 各 +2 −1（统一换 `egressFetch`）、`package.json` 2.8.3→2.8.4 | **新增** `tests/egress-fetch.test.js`（+153） | **否，且是本机故障的引入点**：CONNECT 隧道让请求全部经代理，但无 TLS 指纹伪装 / 无 forwarder / 无语义健康（详见 §6） | A+C+D |
| **2.8.5** `fc737d221899d9894895695eee85053a3025b907` | 2026-10-18T10:28:37Z | TLS-egress forwarder（`DSH_EGRESS_FORWARDER` + `DSH_EGRESS_FORWARDER_PROXY`）+ DDG 改 GET | **线上事故**：上游按 JA3 TLS 指纹拦 Node（Chromium 指纹通过）；DDG html 的 POST 表单被 bot wall 双重门控（method + 指纹） | [CHANGELOG L15–21](https://github.com/240xu/dsh-websearch/blob/da42e44a0f54913e132c5219174a3b6f267188fc/CHANGELOG.md#L15) + [commit](https://github.com/240xu/dsh-websearch/commit/fc737d221899d9894895695eee85053a3025b907)（+177 −9，6 文件） | `lib/util/egress-fetch.js`(+66 −1)：`forwarderFor()` / `forwarderFetch()`；`lib/backends/ddg.js`(+6 −5)：`POST`→`GET`、`target = ENDPOINT?params`；`CHANGELOG.md`、`package.json` | **修改** `tests/egress-fetch.test.js`（+95，3 例：spec 编码透传 / 502→TypeError / NO_PROXY 绕过）、`tests/v21.test.js`（断言从 `init.body` 改 `url`） | **是（exa/parallel/ddg 的链路层）**，条件：需部署 sidecar 并设 `DSH_EGRESS_FORWARDER`；见 §3 | A+C |
| `72cbba8e3c19c77fea2396c7ac00c40b08df52a9` | 2026-10-18T12:35:08Z | 把 sidecar hop 的注释改写成 `proxy-exempt` 约定标记（harness verifier convention） | **文档对齐 / 可审计性**：明确「这一跳必须自己持有 transport，上游代理决策放在 sidecar spec 里」 | [commit](https://github.com/240xu/dsh-websearch/commit/72cbba8e3c19c77fea2396c7ac00c40b08df52a9)（+8 −6，**仅注释**） | `lib/util/egress-fetch.js` L145–158 注释 | 无 | 否（但它是 npm 2.8.6 的 `gitHead`，见 §1.3） | A+C |
| **2.8.6** `592237f7586bc2da428e5acf41acf40276711b3d` | 2026-10-18T12:27:50Z | forwarder hop 改 `node:http(s)` 直连（dispatcher 劫持修复）+ 失败路径加固（8 项） | **线上事故**：全局 `EnvHttpProxyAgent` 把 sidecar hop 也代理走，`172.30.0.1` 不在 NO_PROXY → 每次搜索全死；CHANGELOG 原文 `online incident: every backend search failed with "all enabled backends failed (4)"` | [CHANGELOG L3–13](https://github.com/240xu/dsh-websearch/blob/da42e44a0f54913e132c5219174a3b6f267188fc/CHANGELOG.md#L3) + [commit](https://github.com/240xu/dsh-websearch/commit/592237f7586bc2da428e5acf41acf40276711b3d)（+810 −114，16 文件，message 全文 12 行） | 详见 §4 逐条对应表 | **修改** `tests/egress-fetch.test.js`(+65)、`tests/v28-p2.test.js`(+8 −7)；**新增** `tests/v286-failures.test.js`(+303，12 例) | **是（核心）**：链路劫持 + 诊断 + SearXNG 语义健康 + 超时分类，见 §4/§6 | A+C |
| `8b14d5495f54a9a124c94e8e98d40c6c5d7be69c` | 2026-10-21T14:08:26Z | README 新增「10 秒速查」（`dsh plugin --profile web add ...`、卸载、plugin-hub） | **文档对齐** | [commit](https://github.com/240xu/dsh-websearch/commit/8b14d5495f54a9a124c94e8e98d40c6c5d7be69c)（+13 −1） | `README.md` L16–27 段 | 无 | 否 | A+C |
| `da42e44a0f54913e132c5219174a3b6f267188fc` | 2026-10-21T14:08:30Z | 版本号对齐：`package.json` **2.8.6 → 2.8.8**（跳过 2.8.7） | **版本元数据对齐** | [commit](https://github.com/240xu/dsh-websearch/commit/da42e44a0f54913e132c5219174a3b6f267188fc)（+1 −1） | `package.json` L3 | 无 | 否 | A+C |
| **npm 2.8.7**（孤儿）`608e474fdf5841bb0fcc657c221f85614c9925fc` | 2026-10-20T12:53:52Z | `Config` / 常量抽到 `lib/config.js` 并加 `"./config"` 导出（重构实验） | **重构**（动机未取到，E） | registry `gitHead`（C）+ tarball diff（A）；**GitHub `GET /commits/<sha>` → 422「未取到，待核实」** | `lib/config.js`(新增)、`lib/index.js`、`package.json`（tarball 内） | 无（tarball 不含 tests） | 否（2.8.8 已回退） | C+A+E |
| **npm 2.8.8** `da42e44a…` | 2026-10-21T14:10:40Z | `latest`：回退 2.8.7 重构 + README 速查；**`lib/` 与 2.8.6 逐字节相同** | **发布收尾** | [npm 2.8.8](https://www.npmjs.com/package/@240xu/dsh-websearch/v/2.8.8) + tarball 全量 diff（A） | 删 `lib/config.js`、还原 `lib/index.js`、`package.json`、README | 无 | 是（等价继承 2.8.5/2.8.6 全部修复） | A+C |

### 2.1 逐 commit 详情卡（`files[]` 清单与 patch 片段，必须交付项 1）

以下对 8 个关键 commit 给出 `GET /commits/{sha}` 的完整元数据 + `files[]`。`stats` 为该 commit 的 `+additions / -deletions / total`。

---

**① `4caca4578f729a0accbbf50805ffe92e4aee02b3`（v2.8.1）**
- 作者 `websearch-innovator <2401826246@qq.com>`；日期 `2026-09-30T14:19:19Z`；parent `27cc5df60257ffdc904cdda1c07af547333898f4`；stats `+125 −29 / 7 files`。
- files：`240xu-dsh-websearch-2.8.0.tgz`(added, +0 −0)、`CHANGELOG.md`(+18)、`README.md`(+6)、`cordis.patch.yml`(+10)、`lib/index.js`(+51 −28)、`package.json`(+1 −1)、`tests/v281-form.test.js`(added +39)。
- patch 关键行（`lib/index.js`）：`+Config.meta = { ...Config.meta, volatile: true };`（[永久链接 L249](https://github.com/240xu/dsh-websearch/blob/4caca4578f729a0accbbf50805ffe92e4aee02b3/lib/index.js#L249)）；注释明确「`volatileForm (RT dsh-settings lib/index.js:122-138) keeps ONLY fields with meta.volatile`」。
- message 全文：`v2.8.1: 0.2.0 SettingsForms adapter — Config.meta.volatile (whole-Config form), remove contradicting warn, descriptions for all bare fields, guard tests`。

**② `3ea0f08f88c1f44a9b5ebcdb718a831226f401dd`（v2.8.2）**
- 作者 `240xu <2401826246@qq.com>`；`2026-10-03T10:12:26Z`；parent `eab486c41b786f1fb3373dfca69ee1d9893758f6`；`+108 −7 / 5 files`。
- files：`README.md`(+13)、`lib/backends/exa.js`(+8 −4)、`lib/provider.js`(+33 −2)、`package.json`(+1 −1)、`tests/p1-regression.test.js`(added +53)。
- patch 关键行：`-Promise.resolve(fn()).then(resolve)…` → `+Promise.resolve().then(fn).then(resolve).catch(reject).finally(...)`（[provider.js@3ea0f08 L104](https://github.com/240xu/dsh-websearch/blob/3ea0f08f88c1f44a9b5ebcdb718a831226f401dd/lib/provider.js#L104)）；新增 `if (allFailures.length === 0) { …return { sources: [], … }; }`（同文件 L441 段）。
- message 全文：`v2.8.2: P1 fixes — legitimate zero-results no longer forged as all-backends-failed; limiter sync-throw no longer leaks running (deadlock); exa category inference gated on deepCoverage (parity with tavily/searxng); 3 regression tests`。

**③ `2c525ddb0340be55f6c6956634c7c6451686b51a`（v2.8.3）**
- 作者 `240xu`；`2026-10-04T06:35:30Z`；parent `3ea0f08f88c1f44a9b5ebcdb718a831226f401dd`；`+58 −3 / 6 files`。
- files：`README.md`(+9)、`lib/multiquery.js`(+8 −1)、`lib/prompting.js`(+1 −1)、`lib/provider.js`(+9)、`package.json`(+1 −1)、`tests/p1-regression.test.js`(+30)。
- patch 关键行（`lib/provider.js`）：`+if (!effReq.query) { throw new WebError("unified search: empty query after shaping …") }`（[L202 段](https://github.com/240xu/dsh-websearch/blob/2c525ddb0340be55f6c6956634c7c6451686b51a/lib/provider.js#L202)）。
- message 全文：`v2.8.3: empty shaped-query rejected early (no fan-out/cache aliasing), ZH bare filler 搜索 added, CJK separators require a boundary on either side (entity protection), 4 regression tests`。

**④ `5c8287453728023d7bd14705ed40b5b2fa31f9d7`（v2.8.4 = 本机版）**
- 作者 `Xu198440 <ova442757@163.com>`；`2026-10-18T05:48:31Z`；parent `dd05d0ca9cc7c19c88d2370750ed4d6e90496292`；`+1158 −42 / 19 files`。
- files 全清单：`CHANGELOG.md`(+11)、`lib/backends/{anthropic-like,brave,ddg,mojeek,openai,searxng,serper,tavily}.js`（各 +2 −1）、`lib/client.js`(+139 −20)、`lib/health.js`(+7)、`lib/history.js`(+7 −5)、`lib/index.js`(+25 −4)、**`lib/settings-api.js`(added +277)**、**`lib/trust.js`(added +179)**、**`lib/util/egress-fetch.js`(added +338)**、`lib/util/mcp-client.js`(+5 −4)、`package.json`(+1 −1)、**`tests/egress-fetch.test.js`(added +153)**。
- patch 片段（`lib/util/egress-fetch.js` 头部，[永久链接](https://github.com/240xu/dsh-websearch/blob/5c8287453728023d7bd14705ed40b5b2fa31f9d7/lib/util/egress-fetch.js)）：
  ```
  +// util/egress-fetch.js — proxy-aware fetch for kill-switched egress environments.
  +// Node's global fetch ignores HTTP_PROXY / HTTPS_PROXY. …
  +import http from "node:http"; import https from "node:https";
  +export function egressFetch(url, init = {}) {
  +  const proxy = proxyFor(url);
  +  if (proxy === undefined) return fetch(url, init);
  +  return tunneledFetch(String(url), init, proxy, 0);
  +}
  ```
- `mcp-client.js` 4 处 `fetch(` → `egressFetch(`（initialize / notifications / tools/call / retry）——**这就是本机 403 进入 MCP 链路的入口**（A）。
- message 全文：`v2.8.4: 0.2.1-alpha settings-section compat (fenced settings bridge, unconditional section registration), proxy-aware egress CONNECT tunnel for kill-switched containers, fixes: ToggleRow props.t crash, numeric-field bounds check, credentials/reference-updated event, history/health admission fence; 98 tests`。

**⑤ `fc737d221899d9894895695eee85053a3025b907`（2.8.5）**
- 作者 `Xu198440`；`2026-10-18T10:28:37Z`；parent `5c8287453728023d7bd14705ed40b5b2fa31f9d7`；`+177 −9 / 6 files`。
- files：`CHANGELOG.md`(+8)、`lib/backends/ddg.js`(+6 −5)、`lib/util/egress-fetch.js`(+66 −1)、`package.json`(+1 −1)、`tests/egress-fetch.test.js`(+95 −1)、`tests/v21.test.js`(+1 −1)。
- message 全文（3 行）：
  ```
  2.8.5: TLS-egress forwarder (DSH_EGRESS_FORWARDER) + ddg GET form
  - egress-fetch: optional forwarder mode relaying through a Chromium-JA3 sidecar /fwd API (upstream proxy via DSH_EGRESS_FORWARDER_PROXY); header/body/status passthrough, 502+x-sidecar-error -> TypeError.
  - ddg backend: GET form (POST html endpoint is JA3+method double-gated).
  - tests: +3 forwarder cases (spec encoding, error mapping, NO_PROXY bypass).
  ```
- patch 片段：见 §3（逐行展开）。

**⑥ `592237f7586bc2da428e5acf41acf40276711b3d`（2.8.6）**
- 作者 `Xu198440`；`2026-10-18T12:27:50Z`；parent `fc737d221899d9894895695eee85053a3025b907`；`+810 −114 / 16 files`（本次谱系最大改动）。
- files 全清单：`CHANGELOG.md`(+12)、`README.md`(+2 −2)、`lib/backends/ddg.js`(+3 −2)、`lib/backends/exa.js`(+2 −1)、`lib/backends/parallel.js`(+2 −1)、`lib/backends/searxng.js`(+162 −59)、`lib/index.js`(+7)、`lib/provider.js`(+47 −18)、**`lib/util/describe-error.js`(added +58)**、`lib/util/egress-fetch.js`(+91 −19)、**`lib/util/failure-label.js`(added +40)**、`lib/util/mcp-client.js`(+7 −3)、`package.json`(+1 −1)、`tests/egress-fetch.test.js`(+65 −1)、`tests/v28-p2.test.js`(+8 −7)、**`tests/v286-failures.test.js`(added +303)**。
- message 全文（12 行，逐条对应 §4）：
  ```
  2.8.6: forwarder hop via node:http (dispatcher-hijack fix) + failure-path hardening
  - egress-fetch: forwarderFetch speaks node:http(s) directly (a global EnvHttpProxyAgent dispatcher was proxying the sidecar hop through the HK chain — with 172.30.0.1 absent from NO_PROXY every search died); forwarder ceiling min(caller, DSH_EGRESS_FORWARDER_TIMEOUT_MS ?? 20s) with caller-abort / stalled / unreachable classification.
  - provider/backends: cause-chain error diagnostics, complete all-fail enumeration, timeout classified as timeout (not 'search aborted'), proxy/forwarder failure labels, ddg ceiling 5s->8s.
  - searxng: semantic health (200 without results[] != success, breaker no longer reset by interstitials), anti-bot friendly label, opt-in searxngBaseURLs failover.
  - tests: 116 total (+3 forwarder regression, +12 failure-path).
  ```

**⑦ `72cbba8e3c19c77fea2396c7ac00c40b08df52a9`（proxy-exempt 标记）**
- 作者 `Xu198440`；`2026-10-18T12:35:08Z`；parent `592237f…`；`+8 −6 / 1 file`（`lib/util/egress-fetch.js`）。
- patch 把 `This hop deliberately speaks node:http(s) directly …` 改写为 `proxy-exempt: this hop must own its transport (node:http(s)) by design … The proxy decision for the *upstream* request rides in the sidecar spec (DSH_EGRESS_FORWARDER_PROXY), not in this hop.`（[L148](https://github.com/240xu/dsh-websearch/blob/72cbba8e3c19c77fea2396c7ac00c40b08df52a9/lib/util/egress-fetch.js#L148)）。
- message 全文：`docs: proxy-exempt marker on the sidecar forwarder hop (harness verifier convention)`。

**⑧ `8b14d549…` + `da42e44a…`（2.8.8 双 commit）**
- `8b14d5495f54a9a124c94e8e98d40c6c5d7be69c`：`240xu`，`2026-10-21T14:08:26Z`，parent `72cbba8e…`，`+13 −1 / README.md`。patch 新增 `## 10 秒速查` 代码块（`dsh plugin --profile web add @240xu/dsh-websearch` / 重启后设置里选 unified / plugin-hub 一键 / 卸载命令）。
- `da42e44a0f54913e132c5219174a3b6f267188fc`：`240xu`，`2026-10-21T14:08:30Z`，parent `8b14d549…`，`+1 −1 / package.json`。patch：
  ```
  -  "version": "2.8.6",
  +  "version": "2.8.8",
  ```
  （[永久链接](https://github.com/240xu/dsh-websearch/blob/da42e44a0f54913e132c5219174a3b6f267188fc/package.json#L3)）

---

## 3. 【事故复盘 A】2.8.5 — JA3 指纹门控与 sidecar forwarder

### 3.1 事故陈述（C，CHANGELOG 原文 + commit message）

> **触发原因：线上事故（上游按 TLS 指纹拦截）**。[CHANGELOG@da42e44a L15–21](https://github.com/240xu/dsh-websearch/blob/da42e44a0f54913e132c5219174a3b6f267188fc/CHANGELOG.md#L15) 原文：`Fingerprint-gated upstreams (Exa, DuckDuckGo) behind TLS-censoring exits.` `some upstreams gate on the client TLS fingerprint (JA3) rather than on the exit IP — Node's fingerprint is rejected where a Chromium one is accepted.`

与本机现状的对应（D）：本机 `web_search` 的 `exa: MCP initialize HTTP 403` / `parallel: MCP initialize HTTP 403`，而 Lead 本机 `curl` 直连 `https://mcp.exa.ai/mcp` 与 `https://search.parallel.ai/mcp` 均 **HTTP 200**（[00-lead-live-probe.md §2/§4](00-lead-live-probe.md)，D）。→ 403 出现在「插件 HTTP 客户端链路」，不是端点故障。这是**推断级 E** 的归因（未对 403 HTML 抓包定位，[00-lead-live-probe.md §7](00-lead-live-probe.md) 已声明），但 2.8.5 CHANGELOG 给出了作者声明的同型事故（C）。

### 3.2 CHANGELOG 逐条 → commit diff 具体文件与代码行（A）

| CHANGELOG 条目（L15–21） | 对应 diff 文件 | 具体代码 / 行 | 四联标注 |
| --- | --- | --- | --- |
| 「Add: optional TLS-egress forwarder. `DSH_EGRESS_FORWARDER` = 本地 sidecar `/fwd`，`DSH_EGRESS_FORWARDER_PROXY`（默认 `HTTPS_PROXY`）；未设置 = byte-identical」 | `lib/util/egress-fetch.js` (+66 −1) | 新增 `forwarderFor(url)`：读 `env.DSH_EGRESS_FORWARDER`、非空且 `!inNoProxy(target, NO_PROXY)` 才启用，`proxy = DSH_EGRESS_FORWARDER_PROXY \|\| HTTPS_PROXY \|\| …`；`egressFetch()` 首行 `const forwarder = forwarderFor(url); if (forwarder !== undefined) return forwarderFetch(...)`（[egress-fetch.js@fc737d2 L31](https://github.com/240xu/dsh-websearch/blob/fc737d221899d9894895695eee85053a3025b907/lib/util/egress-fetch.js#L31)） | 结论→依据(C L18)→代码(A L31/47/50)→验证(D：本机 2.8.4 `egress-fetch.js` 无 `DSH_EGRESS_FORWARDER` 字样，`grep` 0 命中) |
| 「header/body/status passthrough」 | 同上 | `forwarderFetch()` 构造 `spec = { url, method, headers, timeout_ms: 90000 }`，`x-sidecar-spec: Buffer.from(JSON.stringify(spec)).toString("base64")`，`POST /fwd` 带 `content-type: application/octet-stream`，原样 `return response`（[L138 段](https://github.com/240xu/dsh-websearch/blob/fc737d221899d9894895695eee85053a3025b907/lib/util/egress-fetch.js#L138)） | 同上 |
| 「`502 + x-sidecar-error` → TypeError」 | 同上 | `if (response.status === 502 && marker !== null) throw new TypeError(\`fetch failed: forwarder ${marker}…\`)`；`catch` 分支 `throw new TypeError(\`fetch failed: forwarder unreachable (${sanitize(error)})\`, { cause: error })` | 同上 |
| 「Fix: DDG 改 GET（POST 表单被 bot wall 方法+指纹双门控）」 | `lib/backends/ddg.js` (+6 −5) | `-method: "POST"` → `+method: "GET"`；`-const body = params.toString()` → `+const target = \`${DDG_ENDPOINT}?${params.toString()}\``；删 `Content-Type: application/x-www-form-urlencoded` 与 `body`（[ddg.js@fc737d2 L30 段](https://github.com/240xu/dsh-websearch/blob/fc737d221899d9894895695eee85053a3025b907/lib/backends/ddg.js#L30)）。代码注释：`GET form: … unlike the POST form it is not rejected by the endpoint's bot wall for non-browser clients (POST is JA3 + method double-gated).` | 结论→依据(C L20)→代码(A)→验证(A：`tests/v21.test.js` 断言从 `calls[0].init.body.includes("df=w")` 改为 `calls[0].url.includes("df=w")`；D：本机 2.8.4 `ddg.js:39` 仍是 `method: "POST"`) |
| 「Tests: 3 new forwarder tests」 | `tests/egress-fetch.test.js` (+95 −1) | 3 个 `test(...)`：`relays through sidecar, spec carries method/headers/body/proxy`（断言 `spec.proxy === "http://172.30.66.1:1091"`）、`502 + x-sidecar-error becomes a fetch-style TypeError`、`NO_PROXY target bypasses the sidecar entirely`（`sidecarHits === 0`）；并把 `DSH_EGRESS_FORWARDER*` 加入 `SAVED` 环境变量快照 | 验证(D/A) |

> 注：测试里硬编码的 `http://172.30.66.1:1091`（[egress-fetch.test.js@fc737d2](https://github.com/240xu/dsh-websearch/blob/fc737d221899d9894895695eee85053a3025b907/tests/egress-fetch.test.js)）与本机 `~/.dsh/AGENTS.md §5.1` 的网关代理一致（D）——说明作者是在**同一台 wuming 环境**上复现并修的，这是「2.8.5 针对本机这类环境」的旁证（C+D，因果仍属 E）。

### 3.3 2.8.5 未覆盖 / 遗留（诚实标注）

- 2.8.5 的 forwarder hop **仍用全局 `fetch(forwarder.endpoint, …)`**（[egress-fetch.js@fc737d2 L150 段](https://github.com/240xu/dsh-websearch/blob/fc737d221899d9894895695eee85053a3025b907/lib/util/egress-fetch.js)），且 `timeout_ms: 90000` 固定、没有 hop 级超时 → 直接埋下 2.8.6 的「dispatcher 劫持 + 半死 sidecar」两个事故。这是**同一修复引入的新缺陷**，2.8.6 明确点名（C）。
- 2.8.5 **不改** SearXNG 语义健康、不改全失败诊断、不改超时分类 → 本机 `searxng: invalid JSON response` 与「`all enabled backends failed (4)` 截断」在 2.8.5 仍存在。

---

## 4. 【事故复盘 B】2.8.6 — dispatcher 劫持 + 失败路径加固（逐条对应文件与行号）

事故原文（C，[CHANGELOG@da42e44a L3–13](https://github.com/240xu/dsh-websearch/blob/da42e44a0f54913e132c5219174a3b6f267188fc/CHANGELOG.md#L3)）：`Search-failure hardening (online incident: every backend search failed with "all enabled backends failed (4)").` —— **与本机当前错误串逐字相同**（D，[02-runtime-state.md L229/L398](02-runtime-state.md)），这是「由哪个后续 commit 修复」的最强版本记录证据。

| # | CHANGELOG 条目 / commit message 条款 | 落点文件 | 具体函数与行号（`@592237f`） | 回归测试 | 四联等级 |
| --- | --- | --- | --- | --- | --- |
| 1 | **「sidecar forwarder hop 改 `node:http(s)` 直连；全局 `EnvHttpProxyAgent` 劫持，sidecar 主机不在 NO_PROXY 被代理走（`dial -> sidecar ... EOF`），每次搜索全死」** | `lib/util/egress-fetch.js` (+91 −19) | `forwarderFetch()` [L159](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/util/egress-fetch.js#L159)：删 `fetch(forwarder.endpoint,…)`，改调 `forwarderExchange()`；新增 [L195 `forwarderExchange()`](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/util/egress-fetch.js#L195) 用 `http.request` / `https.request` 自建 transport（[L148 注释](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/util/egress-fetch.js#L148)）；`72cbba8e` 再把注释定为 `proxy-exempt` 约定（[L148@72cbba8e](https://github.com/240xu/dsh-websearch/blob/72cbba8e3c19c77fea2396c7ac00c40b08df52a9/lib/util/egress-fetch.js#L148)） | `tests/egress-fetch.test.js` 新增 `bypasses a hijacked global fetch (dispatcher regression)`：把 `globalThis.fetch` 换成抛错函数，断言 `egressFetch` 仍返回 `direct-ok` | 结论→依据(C L7)→代码(A L159/195)→验证(A 测试) / **D 缺失：本机未实跑升级，标 E** |
| 2 | **「forwarder 自身超时 `min(caller signal, DSH_EGRESS_FORWARDER_TIMEOUT_MS ?? 20s)`；区分 caller abort / sidecar stalled / unreachable + cause chain」** | 同上 | [L181 `DEFAULT_FORWARDER_TIMEOUT_MS = 20_000`](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/util/egress-fetch.js#L181)、[L184 `forwarderTimeoutMs()`](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/util/egress-fetch.js#L184)、[L165 `AbortSignal.timeout(timeoutMs)` + `AbortSignal.any([callerSignal, timeoutSignal])`](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/util/egress-fetch.js#L165)；`fail()` 三级映射 [L207 段](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/util/egress-fetch.js#L207)：caller abort → `abortReason()`；timeout → `forwarder did not respond within ${timeoutMs}ms (sidecar stalled?)`；否则 `forwarder unreachable (${sanitize(error)})`；[L456 `sanitize()`](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/util/egress-fetch.js#L456) 改为遍历 3 层 `cause` 链并用 ` <- ` 拼接 | 3 例：`stalled sidecar yields a clear timeout`（设 `DSH_EGRESS_FORWARDER_TIMEOUT_MS=300`，断言 <2000ms 不拖 30s 外层预算）、`caller abort still wins over the forwarder timeout`、`bypasses a hijacked global fetch` | 结论→依据(C L8)→代码(A)→验证(A 测试) |
| 3 | **「全失败诊断保留完整 cause chain、枚举每个后端原因（不再 >4 静默截断；cooled skips 计入）」** | `lib/util/describe-error.js`(新增 +58)、`lib/util/mcp-client.js`(+7 −3)、`lib/backends/{ddg,exa,parallel}.js`、`lib/provider.js`(+47 −18) | [describe-error.js@592237f](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/util/describe-error.js)：`describeError(error)` 深度 ≤3 / 长度 ≤220，处理 `AggregateError.errors` 前 2 项，输出 `msg (cause: … <- …)`；`mcp-client.js` 3 处 `MCP initialize failed / MCP tools/call failed / …retry failed` 的 `${error}` → `${describeError(error)}`（[L56 段](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/util/mcp-client.js#L56)）；`ddg.js`/`exa.js`/`parallel.js` 的 `WebError` 消息同样换 `describeError`；[provider.js L58 `MAX_FAILURE_DETAILS = 4`](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/provider.js#L58)、[L506 `detail = allFailures.slice(0,MAX_FAILURE_DETAILS)… + "; +N more"`](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/provider.js#L506)、[L515 `cooledNote`](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/provider.js#L515) 命名被熔断跳过的后端、[L519](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/provider.js#L519) 拼进 `unified search: all enabled backends failed (N) - …` | `tests/v286-failures.test.js`：`describeError surfaces error.cause`、`describeError: plain errors, string causes, depth cap`、`all-fail error: cooled-skipped backends are named and >4 reasons collapse to '+N more'` | 结论→依据(C L9)→代码(A)→验证(A 测试)；D：本机 2.8.4 [provider.js:480](file:///home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/lib/provider.js) 仍是 `allFailures.slice(0, 4)` 且无 `cooledNote`、无 `describe-error.js` / `failure-label.js`（`ls lib/util/` 实证） |
| 4 | **「SearXNG 语义健康：HTTP 200 无 `results[]`（反爬 interstitial）不记成功、不重置熔断；反爬页友好标签」** | `lib/backends/searxng.js` (+162 −59)、`lib/util/failure-label.js`(新增 +40) | [searxng.js L8 注释](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/backends/searxng.js#L8) `Health is SEMANTIC`；[L28 `ANTI_BOT_RE`](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/backends/searxng.js#L28)（Anubis / `Verifying your browser…` / `Just a moment` / captcha 等）；[L181 反爬分类](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/backends/searxng.js#L181) `antiBot = /text\/html/i.test(contentType) || ANTI_BOT_RE.test(bodyText.slice(0,4096))` → `SearXNG instance degraded: returned an anti-bot challenge page (HTTP 200, non-JSON)`；[L193 语义门](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/backends/searxng.js#L193) `if (!Array.isArray(data?.results)) throw … "lacks a results[] array"`；只有成功后才 `recordOutcome({status:"success"})`（[L199 段](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/backends/searxng.js#L199)）→ 熔断 `foldBreaker(prev, ok=true)` 不再被 200 反爬页误复位；[failure-label.js](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/util/failure-label.js) `failureLabel("searxng", …)` → `instance degraded (anti-bot/non-JSON page)`、`proxy/forwarder path failed`、`blocked (HTTP 403)` 等短标签 | `tests/v286-failures.test.js`：`200 + anti-bot HTML page -> 'instance degraded'`、`200 + JSON without results[] -> protocol violation`、`200 + JSON results[] parses; empty results[] is a legit empty search`、`telemetry line shows the friendly label for a degraded searxng`、`failureLabel classifies the observed failure families` | 结论→依据(C L10)→代码(A)→验证(A 测试)；D：本机 2.8.4 [searxng.js:91](file:///home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/lib/backends/searxng.js) 只有 `response.json()` 失败才报 `invalid JSON response`，`:107` 用 `data?.results ?? []` 把缺失 results 当空结果 → **正是本机 `searxng: invalid JSON response` 的语义缺口** |
| 5 | **「opt-in `searxngBaseURLs` 多实例 failover」** | `lib/backends/searxng.js`、`lib/index.js`(+7) | [searxng.js L35 `INSTANCE_COOLDOWN_MS = 10*60_000`](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/backends/searxng.js#L35)、`INSTANCE_ATTEMPT_TIMEOUT_MS = 4500`、[L40 `resetInstanceCooldowns()`](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/backends/searxng.js#L40) 测试钩子、[L61 candidates 去重](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/backends/searxng.js#L61)、[L84 顺序尝试 + `AbortSignal.any`](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/backends/searxng.js#L84)、[L89 失败实例进 10 分钟冷却](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/backends/searxng.js#L89)、全冷却则 fail-open 全试；`queryInstance()` [L118](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/backends/searxng.js#L118) 抽出单实例请求；[index.js L218 段](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/index.js#L218) 新增 `searxngBaseURLs: z.array(z.string()).default([])`、[L330 段](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/index.js#L330) `resolveOptions` 注入 `baseURLs` | `tests/v286-failures.test.js`：`429 on primary rotates to the backup; next search skips the cooled primary`、`caller abort propagates as WEB_ABORTED` | 结论→依据(C L11)→代码(A)→验证(A 测试) |
| 6 | **「DDG 超时上限 5s → 8s（实测慢抓取 7.7s 被误杀）」** | `lib/provider.js`、`lib/backends/ddg.js`(仅 `describeError`)、`README.md`(+2 −2)、`tests/v28-p2.test.js` | [provider.js L44–46](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/provider.js#L44) `BACKEND_TIMEOUT_OVERRIDES_MS = { ddg: 8000, searxng: 5000 }`（原 `ddg: 5000`）；[README L146 段](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/README.md) 与「4c. per-backend 超时」条目同步改为 `ddg 8s、searxng 5s … route6 实测 ~7.7s`；[权威依据 4c@592237f](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/README.md#L262) 更新 | `tests/v28-p2.test.js` 断言 `effectiveBackendTimeoutMs("ddg",30000)===8000`、真实时钟 `hanging ddg … times out at 8s` | 结论→依据(C L12 + README L262)→代码(A L45)→验证(A 测试)；D：本机 2.8.4 [provider.js:39](file:///home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/lib/provider.js) 为 `ddg: 5000` |
| 7 | **「后端超时在 telemetry/health 分类为 timeout（原来误报 `unified search aborted` = 用户取消）；proxy/forwarder 失败单独标签」** | `lib/provider.js`(+47 −18)、`lib/util/failure-label.js` | [provider.js L355 `timedOut = controller.signal.aborted && !(signal && signal.aborted)`](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/provider.js#L355)、[L356 `reason = \`backend "${id}" timed out after ${effectiveTimeoutMs}ms\``](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/provider.js#L356)、[L362 抛出 `WebError(reason, WEB_PROVIDER_ERROR, {cause})`](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/provider.js#L362)（替代旧 `.catch` 二次包装）；[L460 `failureLabel(t.id, t.error)`](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/provider.js#L460) + `cooledAnnotation` 进遥测行；[failure-label.js](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/util/failure-label.js) `if (/(proxy\|tunnel\|forwarder\|CONNECT)/i) return "proxy/forwarder path failed"`、`if (/timed out after \d+ms/) return "timeout (network slow/blocked)"` | `tests/v286-failures.test.js`：`backend timeout: telemetry says 'timed out after Nms' (not the abort-flavored internal error)`、`failureLabel: proxy/forwarder path failures are classified separately` | 结论→依据(C L13)→代码(A)→验证(A 测试) |
| 8 | **测试总量 116（+3 forwarder 回归，+12 failure-path）** | `tests/egress-fetch.test.js`(+65)、`tests/v28-p2.test.js`(+8 −7)、`tests/v286-failures.test.js`(新增 +303) | `v286-failures.test.js` 12 个 `test(...)`，分组 P1（cause chain / all-fail 完整性）、P2（friendly labels）、P3a（SearXNG 语义健康）、P3b（多实例 failover）、P6（超时分类一致性）；`egress-fetch.test.js` 3 个新例 | — | C（commit message）+ A（文件行数） |

> **四联缺口诚实标注**：上表所有「验证」都是 **A 级（commit 自带的回归测试）**，**D 级（在 wuming 本机升级后实跑）一律缺失** —— 因为本次研究遵循只读约束，未做升级操作（[00-lead-live-probe.md §7](00-lead-live-probe.md) 亦声明「未证明升级后一定修好」）。因此 §6 的「升级收益」是 **E（推断）**，而「2.8.5/2.8.6 修了什么」是 **A+C（已证）**。二者不可混同。

---

## 5. 规则 / 设计的「依据 → 代码」对应表（必须交付项 4）

> 来源：README「权威依据与取舍」章节。该章节 **首次写入** 于 `f92d8c863eebc2de853558e9ebc3f5152aeb1f87`（[commit](https://github.com/240xu/dsh-websearch/commit/f92d8c863eebc2de853558e9ebc3f5152aeb1f87)，2026-09-27，+10 −1，标题 `… + authority-sources README section`），**扩展 4b/4c/4d** 于 `27cc5df60257ffdc904cdda1c07af547333898f4`（v2.8.0，[commit](https://github.com/240xu/dsh-websearch/commit/27cc5df60257ffdc904cdda1c07af547333898f4)），**4c 再更新** 于 `592237f7586bc…`（2.8.6）。
> 固定 sha 版本：[README@da42e44a L254–263](https://github.com/240xu/dsh-websearch/blob/da42e44a0f54913e132c5219174a3b6f267188fc/README.md#L254)（本机 2.8.4 安装版为 [README L242–251](file:///home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/README.md)）。
> **B 级状态列**：2026-11-04 实测 `-L` HTTP 状态（代理 `http://172.30.66.1:1091`）；2026-11-05 复测 Exa 相关 URL。

| # | 外部资料（README 条目） | URL + B 状态(2026-11-04/05) | 引入该设计的 commit / 版本 | 实现文件与行号（A，固定 sha） | 回归测试（A） | 四联 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **Tavily Best Practices**（agent 查询 ≤1500 字符、子查询分解） | `https://docs.tavily.com/documentation/best-practices/best-practices-search` **200** | `a65acf0c3507e3d5e2728403a30de0a985695717` **v2.6.0**（2026-09-27） | [prompting.js@a65acf0 L7/L26–27/L51](https://github.com/240xu/dsh-websearch/blob/a65acf0c3507e3d5e2728403a30de0a985695717/lib/prompting.js)：`QUERY_MAX_CHARS=1500`、`shapeQuery()`（剥离寒暄 / 压缩空白 / 截断，不改写实体）；[provider.js@a65acf0 L114 段](https://github.com/240xu/dsh-websearch/blob/a65acf0c3507e3d5e2728403a30de0a985695717/lib/provider.js) `effReq.query = shapeQuery(...)`；[prompting.js L76](https://github.com/240xu/dsh-websearch/blob/a65acf0c3507e3d5e2728403a30de0a985695717/lib/prompting.js#L76) `MULTI_QUERY_GUIDANCE` 含 HyDE / 持续检索指引 | `tests/provider.test.js`(+4 −2)、`tests/v21.test.js`(+3 −2)（a65acf0）；`tests/p1-regression.test.js`（2.8.3 空查询/CJK） | 依据(B 200 + C commit)→代码(A)→验证(A 测试) |
| 2 | **Exa Search Best Practices**（语义丰富、描述性查询） | 代码注释引用 `https://exa.ai/docs/search-best-practices` **404 / 000**（❗死链）；官方现行页 [`https://exa.ai/docs/search/best-practices`](https://exa.ai/docs/search/best-practices) **200**（[03-protocol-standards.md](03-protocol-standards.md) §8、[10-link-verification.md](10-link-verification.md) 亦记录）；另有 [`https://docs.exa.ai/reference/search-best-practices`](https://docs.exa.ai/reference/search-best-practices) **200** | `a65acf0` v2.6.0 | [prompting.js@a65acf0 L9](https://github.com/240xu/dsh-websearch/blob/a65acf0c3507e3d5e2728403a30de0a985695717/lib/prompting.js#L9)（注释引用）；实际查询整形同上 `shapeQuery()` | 同上 | 依据(B **404 → 降级 E**，附 2 个 200 替代)→代码(A)→验证(A) |
| 3 | **Exa OpenAPI spec**（category 枚举、type、livecrawl；勿臆造 category 值）+ coding-agent 指南 | `https://github.com/exa-labs/openapi-spec/blob/master/exa-openapi-spec.yaml` **200**；`https://exa.ai/docs/reference/search-api-guide-for-coding-agents` **200** | `27cc5df60257ffdc904cdda1c07af547333898f4` **v2.8.0**（README 4b 条，[L261@da42e44a](https://github.com/240xu/dsh-websearch/blob/da42e44a0f54913e132c5219174a3b6f267188fc/README.md#L261)）；`3ea0f08` v2.8.2 加 `deepCoverage` 门控 | [exa.js@27cc5df L17–27 `inferExaCategory()`](https://github.com/240xu/dsh-websearch/blob/27cc5df60257ffdc904cdda1c07af547333898f4/lib/backends/exa.js#L17)（只注入 `github` / `research paper` / `news` 高置信值）；[L45–48](https://github.com/240xu/dsh-websearch/blob/27cc5df60257ffdc904cdda1c07af547333898f4/lib/backends/exa.js#L45) `if (category) args.category = category`；[CHANGELOG L82–83](https://github.com/240xu/dsh-websearch/blob/da42e44a0f54913e132c5219174a3b6f267188fc/CHANGELOG.md#L82) 记录实调 `category:"github"` 返回 github.com-only | `tests/p1-regression.test.js`「exa：deepCoverage=false 时不得注入 category」 | 依据(B 200×2)→代码(A)→验证(A 测试 + C 实调记录) |
| 4 | **Tavily Search API**（`search_depth: advanced` 2 credits、`max_results` 0–20、`include_answer`、topic=news） | `https://docs.tavily.com/api-reference/endpoint/search` **200** | `27cc5df` v2.8.0（README 4b） | [tavily.js@27cc5df L34–45](https://github.com/240xu/dsh-websearch/blob/27cc5df60257ffdc904cdda1c07af547333898f4/lib/backends/tavily.js#L34)：`searchDepth = deepCoverage ? "advanced" : …`、`max_results`、`search_depth`、`include_answer: true` | `tests/v28.test.js`(+134)、`tests/v28-p2.test.js`(+77)（27cc5df 新增） | 依据(B 200)→代码(A)→验证(A) |
| 5 | **SearXNG Search API**（`categories` 逗号多类目、`language`） | `https://docs.searxng.org/dev/search_api.html` **200** | `27cc5df` v2.8.0（README 4b/4c）；`592237f` 2.8.6 语义健康加固 | [searxng.js@27cc5df L36–42](https://github.com/240xu/dsh-websearch/blob/27cc5df60257ffdc904cdda1c07af547333898f4/lib/backends/searxng.js#L36) `categories = deepCoverage ? "general,news,it" : "general"`、`language`、`safesearch`、`pageno`；2.8.6 [searxng.js@592237f L189–199](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/backends/searxng.js#L189) `results[]` 语义门 | `tests/v286-failures.test.js`（200 无 results[] / 空 results[] 合法） | 依据(B 200)→代码(A)→验证(A) |
| 6 | **Brave docs**（`freshness`、`result_filter`；「本轮仅调研未接线」） | `https://api-dashboard.search.brave.com/app/documentation` **200** | `27cc5df` v2.8.0（README 4b，**明确标注仅调研**） | 未接线（README 原文）；`lib/backends/brave.js` 存在但 4b 所述 `freshness/result_filter` 的「调研未接线」由 `lib/util/filters.js` 的 `applyBraveFilters` 部分承载 —— **接线范围未逐行核实，标 E** | 无专门回归（E） | 依据(B 200)→代码(部分 A / 部分 E)→验证(**E 缺**) |
| 7 | **Release It! (Nygard 2007) + Microsoft Circuit Breaker pattern**（Closed→Open→Half-Open；本插件刻意省略半开态 + fail-open） | `https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker` **200**；《Release It!》为纸书（B，无 URL，作者注明 Pragmatic Bookshelf 2007） | `e90828d043c96b3a91c6fe84b582cf8f924b7275` **v2.7.0**（实现）；`f92d8c8` 写入 README [1. 熔断器](https://github.com/240xu/dsh-websearch/blob/da42e44a0f54913e132c5219174a3b6f267188fc/README.md#L258) | [breaker.js@e90828d L7–16](https://github.com/240xu/dsh-websearch/blob/e90828d043c96b3a91c6fe84b582cf8f924b7275/lib/breaker.js#L7)（`BREAKER_DEFAULTS={threshold:3,cooldownMs:60_000}`、`fail-open` 注释）、[L29 `foldBreaker()`](https://github.com/240xu/dsh-websearch/blob/e90828d043c96b3a91c6fe84b582cf8f924b7275/lib/breaker.js#L29)、[L47 `isCooled()`](https://github.com/240xu/dsh-websearch/blob/e90828d043c96b3a91c6fe84b582cf8f924b7275/lib/breaker.js#L47)、[L56 `cooledAnnotation()`](https://github.com/240xu/dsh-websearch/blob/e90828d043c96b3a91c6fe84b582cf8f924b7275/lib/breaker.js#L56)；`f92d8c8` 把 `openUntil` 改名 `cooledUntil` | `tests/breaker.test.js`(+70)、`tests/v27.test.js`(+91)（e90828d）；`tests/breaker.test.js`(+12)（c6b28de v2.7.1，cache key 含 enabledBackends） | 依据(B 200 + 纸书 B)→代码(A)→验证(A) |
| 8 | **Cloudflare Retention vs Freshness / Revalidation**（TTL-only vs 事件驱动失效） | `https://developers.cloudflare.com/cache/concepts/retention-vs-freshness/` **200**；`https://developers.cloudflare.com/cache/concepts/revalidation/` **200** | `e90828d` v2.7.0；README [2. 缓存失效](https://github.com/240xu/dsh-websearch/blob/da42e44a0f54913e132c5219174a3b6f267188fc/README.md#L259) | [cache.js@e90828d L26 `ttlMs: 900_000`](https://github.com/240xu/dsh-websearch/blob/e90828d043c96b3a91c6fe84b582cf8f924b7275/lib/cache.js#L26)、[L57 `createSearchCache`](https://github.com/240xu/dsh-websearch/blob/e90828d043c96b3a91c6fe84b582cf8f924b7275/lib/cache.js#L57)、[L110 TTL 判定](https://github.com/240xu/dsh-websearch/blob/e90828d043c96b3a91c6fe84b582cf8f924b7275/lib/cache.js#L110)；`c6b28de` 把 key 纳入 `enabledBackends` 组合 | `tests/cache.test.js`(+83)、`tests/v27.test.js` | 依据(B 200×2)→代码(A)→验证(A) |
| 9 | **libuv rename 原子性**（POSIX rename(2) 原子覆盖 / Windows MoveFileExW 不背书）+ [libuv#283](https://github.com/joyent/libuv/issues/283) **200** + [LWN 682988](https://lwn.net/Articles/682988/) **200** | 两 URL 均 **200** | `e90828d` v2.7.0；README [3. 原子写](https://github.com/240xu/dsh-websearch/blob/da42e44a0f54913e132c5219174a3b6f267188fc/README.md#L260) | [cache.js@e90828d L68–72](https://github.com/240xu/dsh-websearch/blob/e90828d043c96b3a91c6fe84b582cf8f924b7275/lib/cache.js#L68) `tmp = ${file}.${pid}.tmp; writeFileSync(tmp,…); renameSync(tmp,file)`、[L107 `JSON.parse(readFileSync(...))`](https://github.com/240xu/dsh-websearch/blob/e90828d043c96b3a91c6fe84b582cf8f924b7275/lib/cache.js#L107) 坏条目按 miss；[history.js@e90828d L51–53](https://github.com/240xu/dsh-websearch/blob/e90828d043c96b3a91c6fe84b582cf8f924b7275/lib/history.js#L51) 同模式 | `tests/cache.test.js` / `tests/history.test.js`(+101) | 依据(B 200×2)→代码(A)→验证(A) |
| 10 | **RAG-Fusion / RRF（Cormack et al. 2009）** | `https://github.com/Raudaschl/rag-fusion` **200** | `27cc5df` v2.8.0（README 4b） | [rrf.js@27cc5df L5/L14 `RRF_K=60`/L32 `rrfFuse()`](https://github.com/240xu/dsh-websearch/blob/27cc5df60257ffdc904cdda1c07af547333898f4/lib/rrf.js)；[multiquery.js@27cc5df](https://github.com/240xu/dsh-websearch/blob/27cc5df60257ffdc904cdda1c07af547333898f4/lib/multiquery.js) `isComplexQuery()` / `deriveSubQueries()` | `tests/rrf.test.js`(+76)、`tests/v28.test.js`(+134) | 依据(B 200)→代码(A)→验证(A) |
| 11 | **HyDE** `arXiv:2212.10496` | `https://arxiv.org/abs/2212.10496` **200** | `a65acf0` v2.6.0（[prompting.js L22](https://github.com/240xu/dsh-websearch/blob/a65acf0c3507e3d5e2728403a30de0a985695717/lib/prompting.js#L22) 注释 + [L76](https://github.com/240xu/dsh-websearch/blob/a65acf0c3507e3d5e2728403a30de0a985695717/lib/prompting.js#L76) 「关键短语重搜(HyDE)」指引）；`27cc5df` v2.8.0 落地为 RRF 融合 | 同上 `prompting.js` / `rrf.js` / `multiquery.js`；**注意：HyDE 只作为「导出给宿主/代理层的指引常量」，本插件内部不生成假设文档**（C：[a65acf0 message](https://github.com/240xu/dsh-websearch/commit/a65acf0c3507e3d5e2728403a30de0a985695717)） | `tests/provider.test.js` | 依据(B 200)→代码(A)→验证(A) |
| 12 | **Step-Back Prompting** `arXiv:2310.06117` | `https://arxiv.org/abs/2310.06117` **200** | `a65acf0` v2.6.0（[prompting.js L21](https://github.com/240xu/dsh-websearch/blob/a65acf0c3507e3d5e2728403a30de0a985695717/lib/prompting.js#L21) 注释，属「多面查询分解指引」） | 仅注释级引用 + `MULTI_QUERY_GUIDANCE` 导出常量；**无独立实现模块，标 E（引用 ≠ 实现）**（与 [01-local-impl.md §7.2/8.5](01-local-impl.md) 一致） | 无（E） | 依据(B 200)→代码(部分 A 注释 / **实现 E**)→验证(**E 缺**) |
| 13 | **`arXiv:2404.01037`**（盲目多查询会劣化）→ 门控依据 | `https://arxiv.org/abs/2404.01037` **200** | `a65acf0` v2.6.0 首次引用（[prompting.js L19](https://github.com/240xu/dsh-websearch/blob/a65acf0c3507e3d5e2728403a30de0a985695717/lib/prompting.js#L19)）；`27cc5df` v2.8.0 落地为**从严门控**（[README 4b](https://github.com/240xu/dsh-websearch/blob/da42e44a0f54913e132c5219174a3b6f267188fc/README.md#L261)、[README L142](https://github.com/240xu/dsh-websearch/blob/da42e44a0f54913e132c5219174a3b6f267188fc/README.md#L142)） | [multiquery.js@27cc5df L1–30](https://github.com/240xu/dsh-websearch/blob/27cc5df60257ffdc904cdda1c07af547333898f4/lib/multiquery.js#L1)：`isComplexQuery()`（长度 >60 或含 `vs/and/比较/对比/和` 才触发）、`MAX_SUB_QUERIES=3`、原查询全权重；[provider.js@2c525dd L214–219](https://github.com/240xu/dsh-websearch/blob/2c525ddb0340be55f6c6956634c7c6451686b51a/lib/provider.js#L214) `multi = opts.multiQueryEnabled === true && isComplexQuery(...)`；`multiQueryEnabled` 默认 `false`（[index.js@592237f](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/index.js)） | `tests/v28.test.js`、`tests/p1-regression.test.js`（CJK 词内保护） | 依据(B 200)→代码(A)→验证(A) |
| 14 | **Anthropic Web Search Tool**（结果块置于问题之前、逐条引用） | `https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool` **200**（`.md` 变体亦见 [03-protocol-standards.md](03-protocol-standards.md)）；**「结果块置于问题之前提升引用召回」在官方正文未检索到，标 E 待核实**（Lead 初版 §5 审计，保留） | `a65acf0` v2.6.0 | [prompting.js@a65acf0 L14/L56–67](https://github.com/240xu/dsh-websearch/blob/a65acf0c3507e3d5e2728403a30de0a985695717/lib/prompting.js#L56) `RESULT_HEADER_EN` / `RESULT_HEADER_ZH`（要求 `[n]` 标注、优先官方/一手、时效敏感取较新）、[L98 `resultHeader(lang)`](https://github.com/240xu/dsh-websearch/blob/a65acf0c3507e3d5e2728403a30de0a985695717/lib/prompting.js#L98)；[provider.js@a65acf0 L269 段](https://github.com/240xu/dsh-websearch/blob/a65acf0c3507e3d5e2728403a30de0a985695717/lib/provider.js#L269) 把 header 置于 `outContent` 最前、按 CJK 自动选语言、`opts.resultHeader===false` 可关 | `tests/provider.test.js`(+4 −2) | 依据(B 200，具体主张 **E**)→代码(A)→验证(A) |
| 15 | **OpenAI Prompt Engineering / 搜索工具文档**（分解 + 持久性指令） | `https://platform.openai.com/docs/guides/prompt-engineering` **403**（Cloudflare/反爬，非 404；文档存在但本机出口被拒，标 B-403） | `a65acf0` v2.6.0 | [prompting.js@a65acf0 L16](https://github.com/240xu/dsh-websearch/blob/a65acf0c3507e3d5e2728403a30de0a985695717/lib/prompting.js#L16) 注释；`RESULT_HEADER_*` 的持久性指令；`lib/backends/openai.js` 的 `/responses` + `web_search` 工具 + `url_citation` 解析（v2.0.0 起，[601ba8bf](https://github.com/240xu/dsh-websearch/commit/601ba8bf3d0034bc4d8da2d47e511b9165bdd6ef)） | `tests/v21.test.js` | 依据(B **403，降级标注**)→代码(A)→验证(A) |
| 16 | **WP148（Article 29）查询日志属个人数据** + **EFF 六条自保建议** | `https://ec.europa.eu/justice/article-29/documentation/opinion-recommendation/files/2008/wp148_en.pdf` **200**；`https://w2.eff.org/Privacy/search/searchtips.pdf` **200** | `e90828d` v2.7.0 实现；`f92d8c8` 写入 README [4. → 4d. 搜索历史隐私](https://github.com/240xu/dsh-websearch/blob/da42e44a0f54913e132c5219174a3b6f267188fc/README.md#L263) | [history.js@e90828d L12–18](https://github.com/240xu/dsh-websearch/blob/e90828d043c96b3a91c6fe84b582cf8f924b7275/lib/history.js#L12) `HISTORY_MAX_ENTRIES=50`、只存 `{query,time,resultCount,backendsOk/Total}`；[L34 `createHistoryStore`](https://github.com/240xu/dsh-websearch/blob/e90828d043c96b3a91c6fe84b582cf8f924b7275/lib/history.js#L34)；`lib/index.js` 的 `historyEnabled` 开关 + `POST clear` 端点；`c6b28de` 加 promise-chain 串行化 + trust fence | `tests/history.test.js`(+101)、`tests/history.test.js`(+29 −9 @c6b28de) | 依据(B 200×2)→代码(A)→验证(A) |
| 17 | **per-backend 超时（4c）**：不可达主机 TCP 失败只能靠 abort 兜底；上限取「P50 成功延迟一个数量级」 | 无外部 URL（**作者实测结论**，B 级降为 C：CHANGELOG/README + `docs/real-call-2.8.0.md`） | `27cc5df` v2.8.0（5s/5s）→ `592237f` 2.8.6（ddg 8s / searxng 5s，[README 4c@592237f L262](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/README.md#L262)） | [provider.js@27cc5df L38 段](https://github.com/240xu/dsh-websearch/blob/27cc5df60257ffdc904cdda1c07af547333898f4/lib/provider.js) → [provider.js@592237f L44–46](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/provider.js#L44) `ddg:8000, searxng:5000`；`effectiveBackendTimeoutMs()` | `tests/v28-p2.test.js`（真实时钟 5013ms → 8s 断言）、`tests/v286-failures.test.js`（超时分类） | 依据(C CHANGELOG L77–79 + README 4c)→代码(A)→验证(A 真实时钟测试) |
| 18 | **searxngBaseURLs 多实例 failover**（README 未列为外部依据，属 2.8.6 工程决策） | 无（C：CHANGELOG L11 + commit message `route3 §5.4 draft`） | `592237f` 2.8.6 | [searxng.js@592237f L35/L61/L84/L89](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/backends/searxng.js#L35)、[index.js@592237f L218/L330](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/index.js#L218) | `tests/v286-failures.test.js`（429 轮换 / 冷却跳过 / caller abort） | 依据(C)→代码(A)→验证(A) |

### 5.1 B 级状态的诚实降级（「都要有可靠资料做支撑」的反面也要标注）

| URL | 实测状态 | 处理 |
| --- | --- | --- |
| `https://exa.ai/docs/search-best-practices` | **404 / 000**（2026-11-04、11-05 两次复测） | README/prompting.js 引用的**原始链接已失效** → 该条 B 级支撑降级为 **E（链接待核实）**；官方现行页 `https://exa.ai/docs/search/best-practices` **200**（[03-protocol-standards.md](03-protocol-standards.md) §8）、`https://docs.exa.ai/reference/search-best-practices` **200**，但**不能**冒充原引用，仅作旁证 |
| `https://platform.openai.com/docs/guides/prompt-engineering` | **403** | 文档存在但本机出口被拒（反爬），标 **B-403**，不判为「资料不存在」 |
| Anthropic「结果块置于问题之前提升引用召回」 | 正文未检索到（[03-protocol-standards.md](03-protocol-standards.md) §8） | 标 **E 待核实**；文档 URL 本身 200 |
| 其余 18 个 URL | **200** | B 级成立，附访问日期 2026-11-04 |

> **结论（§5 总）**：README「权威依据与取舍」共 4+ 组、约 15 条外部资料，**14 条有 200 状态 + 可定位 commit + 实现文件行号 + 回归测试**；**2 条存在缺口**（Exa Best Practices 死链、OpenAI 403）；**2 条为「引用但无独立实现」**（Step-Back、Brave 仅调研）；另有 1 条具体主张（Anthropic 结果块前置）标 E —— 已逐条标 E，未当作已证结论。这正是「有可靠资料做支撑」的边界，不夸大。

---

## 6. 与本机现状的闭环（必须交付项 5）

### 6.1 本机现状（D，实测汇总）

| 观测 | 证据 |
| --- | --- |
| 安装版本 **2.8.4** | [package.json](file:///home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/package.json) L3 `"version": "2.8.4"`（D） |
| 实跑 `web_search` → `unified search: all enabled backends failed (4) - exa: MCP initialize HTTP 403; parallel: MCP initialize HTTP 403; ddg: redirect mode is set to error (301); searxng: invalid JSON response` | [02-runtime-state.md L229/L398](02-runtime-state.md)、[00-lead-live-probe.md §4](00-lead-live-probe.md)（D） |
| health / history：`reachable:false`、`lastOk:null`、`failCount: 25/26`、12 个 session 文件含同一错误串 | [02-runtime-state.md L206/L229/L325/L404](02-runtime-state.md)（D，源自 2.8.4 的 v2.5.0 health 路由，commit `d12c03ac5080`） |
| Lead 本机 `curl` 直连 `https://mcp.exa.ai/mcp` / `https://search.parallel.ai/mcp` 均 **HTTP 200** | [00-lead-live-probe.md §2/§4/§6](00-lead-live-probe.md)（D） |
| 本机 2.8.4 代码缺口：`ddg.js:39 method:"POST"`、`ddg.js:40 redirect:"error"`、`searxng.js:91 invalid JSON response` / `:107 data?.results ?? []`、`provider.js:39 ddg:5000`、`:480 slice(0,4)`、无 `describe-error.js` / `failure-label.js`、`egress-fetch.js` 无 `DSH_EGRESS_FORWARDER` | 本机 `grep`/`ls` 实证（D，2026-11-05 复核） |

### 6.2 「当前故障 → 由哪个后续 commit 修复」闭环判断

| 本机症状 | 归因 | 由哪个 commit 修 | 修复机制（A，固定 sha） | 四联等级 |
| --- | --- | --- | --- | --- |
| `exa: MCP initialize HTTP 403` / `parallel: MCP initialize HTTP 403`（curl 直连 200） | 插件 HTTP 客户端链路被上游按 JA3 TLS 指纹 / 代理拒绝（**E：403 HTML 的确切来源未抓包**） | **2.8.5** `fc737d22…` + **2.8.6** `592237f…` | 2.8.5 `DSH_EGRESS_FORWARDER` 把请求交给 Chromium-TLS sidecar（[egress-fetch.js@fc737d2 L31/L47](https://github.com/240xu/dsh-websearch/blob/fc737d221899d9894895695eee85053a3025b907/lib/util/egress-fetch.js#L31)）；2.8.6 `node:http(s)` 直连 + `proxy-exempt` 保证 hop 不被全局 dispatcher 劫走（[L159/L195@592237f](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/util/egress-fetch.js#L159)）；`mcp-client.js` 的 `describeError` 让 403 的 cause chain 可见 | 结论→依据(C CHANGELOG L18/L7 + commit message)→代码(A)→验证(A 回归测试)；**D 缺 → 升级收益为 E** |
| `searxng: invalid JSON response` | `searx.be` 返回 200 的 HTML 反爬页，2.8.4 用 `response.json()` 直接 parse；更糟的是 `data?.results ?? []` 会把「无 results[] 的 JSON」当成功 → 误复位熔断 | **2.8.6** `592237f…` | `ANTI_BOT_RE` 分类 + `results[]` 语义门（[searxng.js@592237f L28/L181/L193](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/backends/searxng.js#L193)）+ `searxngBaseURLs` failover（[index.js L218](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/index.js#L218)）+ 友好标签 `instance degraded`（[failure-label.js](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/util/failure-label.js)） | 同上（A+C，D 缺） |
| `ddg: redirect mode is set to error (301)` | **预期安全行为，不是 bug**：[packages/web/AGENTS.md:5](../../packages/web/AGENTS.md#L5) 规定「Reject redirects on credential-bearing provider requests」，2.8.4 `ddg.js:40` 显式 `redirect:"error"`（A+D；[07-dsh-docs.md](07-dsh-docs.md) §2.1 亦载） | **无 commit「修」它**（不应修）；**2.8.5 缓解 bot wall** | 2.8.5 把 `POST` 改 `GET`（[ddg.js@fc737d2 L30 段](https://github.com/240xu/dsh-websearch/blob/fc737d221899d9894895695eee85053a3025b907/lib/backends/ddg.js#L30)），减少被 bot wall 拦截后落到 301 的概率；2.8.6 把 ddg 超时 5s→8s（[provider.js@592237f L45](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/provider.js#L45)）；**`redirect:"error"` 在 2.8.5/2.8.6 均保留**（[ddg.js@592237f](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/backends/ddg.js) 仍含该选项） | 结论→依据(B/C：AGENTS.md 规则 + CHANGELOG L20)→代码(A)→验证(A `tests/v21.test.js` + D 本机错误串) |
| `all enabled backends failed (4)` 的**诊断可读性**（截断 / 无 cause / 超时误报为取消 / 冷却跳过不计数） | 2.8.4 的 `provider.js:480 slice(0,4)` 静默丢弃第 5+ 条原因；`${error}` 只给 `TypeError: fetch failed` | **2.8.2 / 2.8.6** | 2.8.2 修「零结果误报」；2.8.6 `MAX_FAILURE_DETAILS` + `+N more` + `cooledNote` + `describeError` + `failureLabel` + 超时分类（§4 表 #3/#7） | A+C，D 缺 |

### 6.3 升级 2.8.4 → 2.8.8 的依据与预期收益（**严格区分 C/A 与 E**）

**已被 commit 证明（C + A，不是推断）**：

1. 2.8.8 的 `lib/` **逐字节等于 2.8.6 的 `lib/`**（§1.4，tarball 全量 diff，A；Lead 初版 §0 亦以 `cmp` 得出同结论，D），因此升级必然获得 2.8.5 + 2.8.6 的全部代码修复：forwarder 模式、node:http(s) hop、hop 级超时、cause-chain 诊断、SearXNG 语义健康、多实例 failover、ddg 8s、超时分类、friendly labels。
2. 2.8.5/2.8.6 的 commit message 与 CHANGELOG **明确写出**事故现象 `all enabled backends failed (4)` 并给出回归测试（C + A）。
3. 本机 2.8.4 缺失上述每一个文件/行（§6.1 的 `grep`/`ls` 实证，D）。
4. `dist-tags.latest = 2.8.8`，`gitHead = da42e44a…`（main HEAD，C）。

**推断 / 待核实（E，不得当结论）**：

| # | 推断 | 为什么是 E |
| --- | --- | --- |
| E1 | 「升级后本机 `web_search` 一定恢复」 | 未做升级实跑（只读约束）；403 的确切来源（egress 代理 / 上游 WAF / JA3 指纹）**未抓包定位**（[00-lead-live-probe.md §7](00-lead-live-probe.md) 自认）；2.8.5 的 forwarder **需要部署 sidecar 并设 `DSH_EGRESS_FORWARDER`**，未设置时 `byte-identical behavior`（[CHANGELOG L18](https://github.com/240xu/dsh-websearch/blob/da42e44a0f54913e132c5219174a3b6f267188fc/CHANGELOG.md#L18)）→ **只升 npm 包、不配 sidecar，exa/parallel 的 403 可能不变** |
| E2 | 「2.8.7 有对应 commit 可查」 | `608e474f…` 返回 422，未取到，标「未取到，待核实」（§1.4） |
| E3 | 「DDG 的 301 会被修好」 | 301 是 AGENTS.md:5 的**预期安全拒绝**，升级不会改变 `redirect:"error"`；2.8.5 的 GET 只是缓解 bot wall（C），能否让本机 ddg 成功未实测（E） |
| E4 | 「2.8.7 的重构动机」 | 孤儿 commit 内容未取到，只有 tarball diff（A），动机无资料（E） |
| E5 | 「failCount 25/26 会立即归零」 | 熔断状态存于本机磁盘（v2.7.0 `history`/`cache` 目录），升级后是否重置未实测（E） |

**预期收益（E，附已证前提）**：升级到 `2.8.8` 可拿到 2.8.6 的语义健康与诊断加固（A 已证），**若**同时按 2.8.5 配置 `DSH_EGRESS_FORWARDER` sidecar，则 exa/parallel 的 403 链路有作者声明的同型修复（C）；最小充分动作是「升级 + 部署 sidecar + 复跑 `web_search` + 看 health `failCount`」，其中复跑验证属 D，本次未做。

---

## 7. E 级 / 未取到清单（汇总，便于 Lead 派工）

| 编号 | 项 | 状态 | 建议核实方式 |
| --- | --- | --- | --- |
| E-1 | 2.8.7 `gitHead 608e474f…` 的 commit 内容 | 未取到，待核实（GitHub API 422） | 向维护者索取 / 查本地 reflog / `npm pack` 已能还原文件内容，但无 message 与 parents |
| E-2 | `exa.ai/docs/search-best-practices` 失效 | 已核实失效（B-404/000） | 用 `exa.ai/docs/search/best-practices`(200) 替换 README/prompting.js 引用（[03-protocol-standards.md](03-protocol-standards.md) §8 已建议） |
| E-3 | `platform.openai.com/docs/guides/prompt-engineering` 403 | 已核实（B-403） | 换出口 / 换官方镜像复核内容 |
| E-4 | 403 HTML 的确切产生点（代理 / WAF / JA3） | 推断，未抓包 | `curl -v` 经 `HTTP_PROXY` 复现 + 抓包（[02-runtime-state.md L349](02-runtime-state.md) 亦列为缺口） |
| E-5 | 升级后本机是否恢复 | 未实测 | 只读约束解除后：升 2.8.8 + 配 sidecar + 实跑 + health 复核 |
| E-6 | Brave `freshness/result_filter` 接线范围、Step-Back 是否有独立实现 | 引用存在、实现未逐行核实 | grep `lib/util/filters.js` / `lib/prompting.js` 全量 |
| E-7 | CHANGELOG 条目日期与 commit / npm 日期不齐（2.8.1/2.8.2/2.8.3） | 已发现（C），原因属文档补写 | 以 commit sha / npm time 为准（本报告已采用） |
| E-8 | 作者多身份是否同一人 | 邮箱推断 | 未核实，不作结论 |
| E-9 | Anthropic「结果块置于问题之前提升引用召回」 | 官方正文未检索到 | 查文档历史版本 / 原始论文 |
| E-10 | 本机 `/home/ova/dsh` 是 **shallow clone（depth 1）**，本地取不到 DSH 官方仓库的引入 commit 历史；`d7432673`（dsh-v0.2.1-alpha.2，2026-10-09，PR #5946）只是当前 HEAD，不能充当「规则引入 commit」 | **保留 Lead 初版 §7.6 缺口** | 需对 DSH 官方仓库做完整 clone 后按规则文本回溯 |

---

## 8. 证据索引（按版本 / 主题分组，共 62 条）

> 格式：`等级 | 永久链接 / 路径 | 核验状态 | 日期`。核验状态：`✅已核` / `⚠部分` / `❌未取到`。
> GitHub 链接全部带完整 sha；npm 用版本页；本机路径为 D 级实证。

### 8.1 版本身份与时间线（1–12）

1. C/D | [npm 2.8.4](https://www.npmjs.com/package/@240xu/dsh-websearch/v/2.8.4) `gitHead=5c828745…` 时间 `2026-10-18T06:02:07Z` | ✅已核 | 2026-11-04
2. C/D | [npm 2.8.5](https://www.npmjs.com/package/@240xu/dsh-websearch/v/2.8.5) `gitHead=fc737d22…` `2026-10-18T10:31:56Z` | ✅已核 | 2026-11-04
3. C/D | [npm 2.8.6](https://www.npmjs.com/package/@240xu/dsh-websearch/v/2.8.6) `gitHead=72cbba8e…` `2026-10-18T14:04:02Z` | ✅已核 | 2026-11-04
4. C/D | [npm 2.8.7](https://www.npmjs.com/package/@240xu/dsh-websearch/v/2.8.7) `gitHead=608e474f…` `2026-10-20T12:53:52Z` | ⚠孤儿 / commit 内容❌ | 2026-11-04
5. C/D | [npm 2.8.8](https://www.npmjs.com/package/@240xu/dsh-websearch/v/2.8.8) `gitHead=da42e44a…` `2026-10-21T14:10:40Z`，`latest` | ✅已核 | 2026-11-04
6. C/D | [npm 2.8.0–2.8.3 时间](13-raw-evidence.txt) `03:13:23` / `14:31:57` / `10:14:06` / `02:26:35` | ✅已核 | 2026-11-04
7. C | [package.json@da42e44a L3](https://github.com/240xu/dsh-websearch/blob/da42e44a0f54913e132c5219174a3b6f267188fc/package.json#L3) `"version":"2.8.8"` | ✅已核 | 2026-11-04
8. C | [commit da42e44a](https://github.com/240xu/dsh-websearch/commit/da42e44a0f54913e132c5219174a3b6f267188fc) 版本 `2.8.6 → 2.8.8` 跳过 2.8.7 | ✅已核 | 2026-11-04
9. C | `GET /repos/240xu/dsh-websearch/tags` → 仅 `v1.0.0`=`caff1593…`、`v2.0.0`=`601ba8bf…`；**无 2.8.x tag** | ✅已核 | 2026-11-04
10. C | `GET /repos/240xu/dsh-websearch/releases` → 0；`branches` → 仅 `main=da42e44a…` | ✅已核 | 2026-11-04
11. C | [CHANGELOG@da42e44a L3](https://github.com/240xu/dsh-websearch/blob/da42e44a0f54913e132c5219174a3b6f267188fc/CHANGELOG.md#L3) 最新条目 2.8.6；2.8.6/7/8 tarball 无 CHANGELOG.md | ✅已核 | 2026-11-04
12. A/D | npm tarball 全量 diff：2.8.8 `lib/` ≡ 2.8.6 `lib/`（逐字节） | ✅已核 | 2026-11-04

### 8.2 逐 commit 谱系（13–30）

13. A/C | [commit 4caca457… v2.8.1](https://github.com/240xu/dsh-websearch/commit/4caca4578f729a0accbbf50805ffe92e4aee02b3) +125 −29 / 7 files | ✅已核 | 2026-11-04
14. A | [index.js@4caca457 L249](https://github.com/240xu/dsh-websearch/blob/4caca4578f729a0accbbf50805ffe92e4aee02b3/lib/index.js#L249) `Config.meta.volatile` | ✅已核 | 2026-11-04
15. A/C | [commit 3ea0f08f… v2.8.2](https://github.com/240xu/dsh-websearch/commit/3ea0f08f88c1f44a9b5ebcdb718a831226f401dd) +108 −7 / 5 files | ✅已核 | 2026-11-04
16. A | [provider.js@3ea0f08 L104](https://github.com/240xu/dsh-websearch/blob/3ea0f08f88c1f44a9b5ebcdb718a831226f401dd/lib/provider.js#L104) `.then(fn)` 死锁修复 | ✅已核 | 2026-11-04
17. A/C | [commit 2c525ddb… v2.8.3](https://github.com/240xu/dsh-websearch/commit/2c525ddb0340be55f6c6956634c7c6451686b51a) +58 −3 / 6 files | ✅已核 | 2026-11-04
18. A | [provider.js@2c525dd L202](https://github.com/240xu/dsh-websearch/blob/2c525ddb0340be55f6c6956634c7c6451686b51a/lib/provider.js#L202) 空查询早拒 | ✅已核 | 2026-11-04
19. A/C | [commit 5c828745… v2.8.4](https://github.com/240xu/dsh-websearch/commit/5c8287453728023d7bd14705ed40b5b2fa31f9d7) +1158 −42 / 19 files | ✅已核 | 2026-11-04
20. A | [egress-fetch.js@5c828745](https://github.com/240xu/dsh-websearch/blob/5c8287453728023d7bd14705ed40b5b2fa31f9d7/lib/util/egress-fetch.js) 初始 338 行 CONNECT 隧道 | ✅已核 | 2026-11-04
21. A/C | [commit fc737d22… 2.8.5](https://github.com/240xu/dsh-websearch/commit/fc737d221899d9894895695eee85053a3025b907) +177 −9 / 6 files（message 3 行） | ✅已核 | 2026-11-04
22. A | [egress-fetch.js@fc737d22 L31](https://github.com/240xu/dsh-websearch/blob/fc737d221899d9894895695eee85053a3025b907/lib/util/egress-fetch.js#L31) `forwarderFor` 接入 | ✅已核 | 2026-11-04
23. A | [ddg.js@fc737d22 L30](https://github.com/240xu/dsh-websearch/blob/fc737d221899d9894895695eee85053a3025b907/lib/backends/ddg.js#L30) POST→GET | ✅已核 | 2026-11-04
24. A/C | [commit 592237f7… 2.8.6](https://github.com/240xu/dsh-websearch/commit/592237f7586bc2da428e5acf41acf40276711b3d) +810 −114 / 16 files（message 12 行） | ✅已核 | 2026-11-04
25. A | [egress-fetch.js@592237f L159/L195](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/util/egress-fetch.js#L159) `forwarderExchange` node:http(s) | ✅已核 | 2026-11-04
26. A | [describe-error.js@592237f](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/util/describe-error.js) 新增 58 行 | ✅已核 | 2026-11-04
27. A | [failure-label.js@592237f](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/util/failure-label.js) 新增 40 行 | ✅已核 | 2026-11-04
28. A | [searxng.js@592237f L193](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/backends/searxng.js#L193) `results[]` 语义门 | ✅已核 | 2026-11-04
29. A | [provider.js@592237f L45/L506/L519](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/lib/provider.js#L45) ddg 8s / `+N more` / cooledNote | ✅已核 | 2026-11-04
30. A/C | [commit 72cbba8e…](https://github.com/240xu/dsh-websearch/commit/72cbba8e3c19c77fea2396c7ac00c40b08df52a9) `proxy-exempt` 注释标记（= npm 2.8.6 gitHead） | ✅已核 | 2026-11-04

### 8.3 事故复盘与测试（31–40）

31. C | [CHANGELOG@da42e44a L5](https://github.com/240xu/dsh-websearch/blob/da42e44a0f54913e132c5219174a3b6f267188fc/CHANGELOG.md#L5) `online incident: … "all enabled backends failed (4)"` | ✅已核 | 2026-11-04
32. C | [CHANGELOG L7](https://github.com/240xu/dsh-websearch/blob/da42e44a0f54913e132c5219174a3b6f267188fc/CHANGELOG.md#L7) EnvHttpProxyAgent 劫持 / `dial -> sidecar ... EOF` | ✅已核 | 2026-11-04
33. C | [CHANGELOG L8](https://github.com/240xu/dsh-websearch/blob/da42e44a0f54913e132c5219174a3b6f267188fc/CHANGELOG.md#L8) `min(caller, DSH_EGRESS_FORWARDER_TIMEOUT_MS ?? 20s)` | ✅已核 | 2026-11-04
34. C | [CHANGELOG L18](https://github.com/240xu/dsh-websearch/blob/da42e44a0f54913e132c5219174a3b6f267188fc/CHANGELOG.md#L18) JA3 指纹 / `Unset = byte-identical behavior` | ✅已核 | 2026-11-04
35. A | [tests/egress-fetch.test.js@592237f](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/tests/egress-fetch.test.js) `bypasses a hijacked global fetch` 等 3 例 | ✅已核 | 2026-11-04
36. A | [tests/v286-failures.test.js@592237f](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/tests/v286-failures.test.js) 新增 303 行 / 12 例（P1/P2/P3a/P3b/P6） | ✅已核 | 2026-11-04
37. A | [tests/v28-p2.test.js@592237f](https://github.com/240xu/dsh-websearch/blob/592237f7586bc2da428e5acf41acf40276711b3d/tests/v28-p2.test.js) ddg 5s→8s 断言 + 真实时钟 | ✅已核 | 2026-11-04
38. A | [tests/egress-fetch.test.js@fc737d22](https://github.com/240xu/dsh-websearch/blob/fc737d221899d9894895695eee85053a3025b907/tests/egress-fetch.test.js) 3 例 forwarder（含硬编码 `172.30.66.1:1091`） | ✅已核 | 2026-11-04
39. A/C | [commit 138764a2](https://github.com/240xu/dsh-websearch/commit/138764a23b915a8b2e8b40b2afc230389ad7e707) + [dd05d0ca](https://github.com/240xu/dsh-websearch/commit/dd05d0ca9cc7c19c88d2370750ed4d6e90496292) CHANGELOG 补写/格式修正 | ✅已核 | 2026-11-04
40. A/C | [commit eab486c4](https://github.com/240xu/dsh-websearch/commit/eab486c41b786f1fb3373dfca69ee1d9893758f6) `.gitignore .scratch` | ✅已核 | 2026-11-04

### 8.4 依据 → 代码（41–52）

41. B | [Tavily Best Practices](https://docs.tavily.com/documentation/best-practices/best-practices-search) **200** | ✅已核 | 2026-11-04
42. B | [Tavily Search API](https://docs.tavily.com/api-reference/endpoint/search) **200** | ✅已核 | 2026-11-04
43. B | `https://exa.ai/docs/search-best-practices` **404/000** ❌；官方现行 [`https://exa.ai/docs/search/best-practices`](https://exa.ai/docs/search/best-practices) **200**、[`https://docs.exa.ai/reference/search-best-practices`](https://docs.exa.ai/reference/search-best-practices) **200** | ⚠原链失效 | 2026-11-04/05
44. B | [Exa coding-agent 指南](https://exa.ai/docs/reference/search-api-guide-for-coding-agents) **200**；[exa-openapi-spec.yaml](https://github.com/exa-labs/openapi-spec/blob/master/exa-openapi-spec.yaml) **200** | ✅已核 | 2026-11-04
45. B | [SearXNG Search API](https://docs.searxng.org/dev/search_api.html) **200**；[Brave docs](https://api-dashboard.search.brave.com/app/documentation) **200** | ✅已核 | 2026-11-04
46. B | [MS Circuit Breaker](https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker) **200**；[CF retention](https://developers.cloudflare.com/cache/concepts/retention-vs-freshness/) **200**；[CF revalidation](https://developers.cloudflare.com/cache/concepts/revalidation/) **200** | ✅已核 | 2026-11-04
47. B | [libuv#283](https://github.com/joyent/libuv/issues/283) **200**；[LWN 682988](https://lwn.net/Articles/682988/) **200** | ✅已核 | 2026-11-04
48. B | [RAG-Fusion](https://github.com/Raudaschl/rag-fusion) **200**；[HyDE arXiv:2212.10496](https://arxiv.org/abs/2212.10496) **200**；[Step-Back arXiv:2310.06117](https://arxiv.org/abs/2310.06117) **200**；[arXiv:2404.01037](https://arxiv.org/abs/2404.01037) **200** | ✅已核 | 2026-11-04
49. B | [WP148 PDF](https://ec.europa.eu/justice/article-29/documentation/opinion-recommendation/files/2008/wp148_en.pdf) **200**；[EFF searchtips](https://w2.eff.org/Privacy/search/searchtips.pdf) **200**；[Anthropic web search tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool) **200**；[OpenAI prompt-engineering](https://platform.openai.com/docs/guides/prompt-engineering) **403** ⚠ | ⚠一条 403 | 2026-11-04
50. A/C | [commit f92d8c8](https://github.com/240xu/dsh-websearch/commit/f92d8c863eebc2de853558e9ebc3f5152aeb1f87) 首次写入「权威依据与取舍」 | ✅已核 | 2026-11-04
51. A/C | [commit a65acf0 v2.6.0](https://github.com/240xu/dsh-websearch/commit/a65acf0c3507e3d5e2728403a30de0a985695717) + [prompting.js@a65acf0](https://github.com/240xu/dsh-websearch/blob/a65acf0c3507e3d5e2728403a30de0a985695717/lib/prompting.js)（依据注释 L7–22） | ✅已核 | 2026-11-04
52. A/C | [commit e90828d v2.7.0](https://github.com/240xu/dsh-websearch/commit/e90828d043c96b3a91c6fe84b582cf8f924b7275)（breaker/cache/history 实现）+ [breaker.js@e90828d](https://github.com/240xu/dsh-websearch/blob/e90828d043c96b3a91c6fe84b582cf8f924b7275/lib/breaker.js) / [cache.js@e90828d](https://github.com/240xu/dsh-websearch/blob/e90828d043c96b3a91c6fe84b582cf8f924b7275/lib/cache.js) / [history.js@e90828d](https://github.com/240xu/dsh-websearch/blob/e90828d043c96b3a91c6fe84b582cf8f924b7275/lib/history.js) | ✅已核 | 2026-11-04

### 8.5 v2.8.0 与更早锚点（53–57）

53. A/C | [commit 27cc5df v2.8.0](https://github.com/240xu/dsh-websearch/commit/27cc5df60257ffdc904cdda1c07af547333898f4) +698 −110 / 16 files（multiQuery RRF + deepCoverage） | ✅已核 | 2026-11-04
54. A | [rrf.js@27cc5df](https://github.com/240xu/dsh-websearch/blob/27cc5df60257ffdc904cdda1c07af547333898f4/lib/rrf.js) `RRF_K=60` / [multiquery.js@27cc5df](https://github.com/240xu/dsh-websearch/blob/27cc5df60257ffdc904cdda1c07af547333898f4/lib/multiquery.js) 门控 | ✅已核 | 2026-11-04
55. A | [tavily.js@27cc5df L34](https://github.com/240xu/dsh-websearch/blob/27cc5df60257ffdc904cdda1c07af547333898f4/lib/backends/tavily.js#L34) / [exa.js@27cc5df L17](https://github.com/240xu/dsh-websearch/blob/27cc5df60257ffdc904cdda1c07af547333898f4/lib/backends/exa.js#L17) / [searxng.js@27cc5df L36](https://github.com/240xu/dsh-websearch/blob/27cc5df60257ffdc904cdda1c07af547333898f4/lib/backends/searxng.js#L36) 能力适配 | ✅已核 | 2026-11-04
56. C | [tag v2.0.0 = 601ba8bf…](https://github.com/240xu/dsh-websearch/commit/601ba8bf3d0034bc4d8da2d47e511b9165bdd6ef)；[tag v1.0.0 = caff1593…](https://github.com/240xu/dsh-websearch/commit/caff1593395990e69dfd0627fd4f1c8d97293673) | ✅已核 | 2026-11-04
57. C | [commit d12c03ac v2.5.0-phase1](https://github.com/240xu/dsh-websearch/commit/d12c03ac5080bd6f29a8c67ad10f38de953bac76) health 路由（本机 `failCount` 来源） | ✅已核 | 2026-11-04

### 8.6 本机现状与闭环（58–62）

58. D | [本机 package.json](file:///home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/package.json) `"version":"2.8.4"` | ✅已核 | 2026-11-04
59. D | 本机 [provider.js:39/480](file:///home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/lib/provider.js) `ddg:5000` / `slice(0,4)`；[searxng.js:91/107](file:///home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/lib/backends/searxng.js)；[ddg.js:39/40](file:///home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/lib/backends/ddg.js) POST + `redirect:"error"`；`ls lib/util/` 无 describe-error/failure-label | ✅已核 | 2026-11-05
60. D | [00-lead-live-probe.md](00-lead-live-probe.md)：curl 直连 exa/parallel **200**；[02-runtime-state.md](02-runtime-state.md)：`failCount 25/26`、12 session 含 `all enabled backends failed (4)` | ✅已核（引用 Lead 产物） | 2026-11-04
61. A/B/C | [packages/web/AGENTS.md:5](../../packages/web/AGENTS.md#L5) 拒绝重定向规则 → DDG 301 是预期安全行为 | ✅已核 | 2026-11-04
62. E | 升级 2.8.4→2.8.8 后本机是否恢复；403 抓包归因；2.8.7 孤儿 commit 内容 | ❌未取到 / 待核实 | 2026-11-04

---

## 9. 给 Lead 的一句话结论

**2.8.4 → 2.8.8 的全部功能修复都来自 `fc737d22…`(2.8.5) 与 `592237f7…`+`72cbba8e…`(2.8.6)；2.8.7 是只发到 npm、未推 GitHub 的孤儿重构（sha 422 查不到），2.8.8 已回退它且 `lib/` 与 2.8.6 逐字节相同；仓库无 2.8.x tag，版本身份靠 `package.json` + npm + CHANGELOG(止于 2.8.6)。本机 `all enabled backends failed (4)` 的四个症状里，exa/parallel 由 2.8.5/2.8.6 的 forwarder + proxy-exempt hop 修（但需部署 sidecar，E），searxng 由 2.8.6 语义健康 + 多实例 failover 修，DDG 301 是 AGENTS.md:5 的预期安全拒绝（2.8.5 的 GET 仅缓解 bot wall）；「升级后一定恢复」是 E，未被本机实跑证明。**

---

> 外部内容一律作为数据处理；所有 GitHub 链接带固定 commit sha；所有 B 级资料附 2026-11-04（部分 11-05 复测）访问日期与 HTTP 状态（404/403 已显式降级）；所有 E 级推断集中列于 §7，未充当结论。报告不含任何 token / 口令值。
