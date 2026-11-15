# 76 · 下一步执行计划（工程规划专家 P1）

> 作者：P1（工程规划专家）。取证时间：2026-11-15 13:45–13:55 +08:00。面向 Lead 本轮与后续轮次。
> 边界：**唯一写文件＝本文件**；不改源码/配置/运行时/其它报告/任务板；不 git commit/push、不 npm publish、不改 profile。全程只读取证 + 写本计划。
> 取证：只读 GitHub REST API（`-u` Basic，token 从 `/opt/xr-research/zcode-research/.git/config` remote URL 提取、仅存 shell 变量、**值未出现在本文件与任何输出**）+ 只读 npm registry + `node -v` + read/grep/glob + 本机只读 `node --test` / `md5sum` / `systemctl show`。**未执行** install / 升级 / 重启 / push / publish / 改状态。
> 常量（本文件所有命令共用；路径以 2026-11-15 实测为准）：
> `R=/home/ova/dsh/.artifacts/websearch-research`；`S=$R/src-work/plugin`（工作副本，44 文件，**无 .git**）；`B=$R/src-work/backups`（26 个 `*.orig`）；
> `P=/home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch`（安装副本，46 文件，运行时唯一加载者）；`PROF=/home/dsh/.dsh/profiles/web`；`RT=/opt/dsh-0222`（当前 DSH runtime）。

---

## A. 已确认无误（独立取证，与 Lead 上游事实逐项对齐）

| # | 事实 | 本轮独立复现命令 / 输出 | 判定 |
|---|---|---|---|
| A1 | npm `@240xu/dsh-websearch` `latest=2.8.8`，发布 `2026-10-21T14:10:40.457Z`，23 个版本止于 2.8.8，**无 2.8.9** | `curl -sS registry.npmjs.org/@240xu%2fdsh-websearch` → HTTP 200；`dist-tags.latest=2.8.8`；`versions` 末 8 = 2.8.1…2.8.8；`time.2.8.9=ABSENT`；`modified=2026-10-21T14:10:40.788Z` | ✅ |
| A2 | 本地 35 文件补丁基于 2.8.4，**从未发布 npm** | A1 无 2.8.9 + `P/package.json.version=2.8.4`（`node -p require(...)`）；77 号核实 package.json 只改 description 未 bump | ✅ |
| A3 | GitHub `240xu/dsh-websearch` `default_branch=main`，`pushed_at=2026-10-21T14:08:30Z`，`branch/main.sha=da42e44a0f54`（`docs: add 10-second quick start; align version metadata`），之后无新提交 | `GET /repos/240xu/dsh-websearch` + `/commits?sha=main&per_page=5` + `/branches/main`，均 HTTP 200 | ✅ |
| A4 | 本地 35 文件改动**从未推送 GitHub**：main 止于 10-21；`S/.git` 不存在（`ls -ld` → NO .git） | A3 + `ls -ld "$S/.git"` | ✅ |
| A5 | PR **#7** `state=open` / `merged=false` / `mergeable=true` / `created=updated=2026-11-04T10:22:28Z` / `review_comments=0` / `comments=0` / reviews 数组为空 / `changed_files=3` `+76/-2` / `base=main` `head=fix/dsh-0.2x-settings-bridge`；PR #5 open、#2 closed；`releases=[]`；`tags=['v2.0.0','v1.0.0']` | `GET /pulls?state=all&per_page=30`、`/pulls/7`、`/pulls/7/reviews`、`/pulls/7/files`、`/releases`、`/tags`，全 200 | ✅ |
| A6 | **PR #7 只覆盖 3 文件**：`lib/index.js`、`lib/provider.js`、`tests/v28x-settings-bridge.test.js` ⇒「PR#7(3) ⊂ 44 号 G1–G4 草案(10/17) ⊂ 本地 35 文件」缺口链成立，对外 PR 前必须补 G5 完整 35 文件 diff | `/pulls/7/files` + 48 号 §2.2/§2.4 + 77 号 §「为什么没推」 | ✅（比题给「10/23」更窄） |
| A7 | 当前 profile **精确 pin `2.8.4`（无 `^`）**；lock 与 `.modules.yaml` 均为 2.8.4；服务 active，`MainPID=3207503`，`ExecMainStartTimestamp=2026-11-14 22:28:58 CST` | `python3 -c json.load("$PROF/package.json")['dependencies'][…]` → `2.8.4`；`grep` lock/.modules.yaml；`systemctl show dsh-web … --value` | ✅ |
| A8 | `S` ↔ `P` **44/44 公共文件 md5 全一致，DIFF=0**；`P` 另有 `LICENSE`、`examples/cordis.patch.yml` 2 个非改动文件；26 个 `*.orig` 备份在位 | 只读 python `hashlib.md5` 逐文件比对 + `find "$B" -name '*.orig' | wc -l` → 26 | ✅（77 号「35/35」口径＝有改动的 35 个文件，物理文件 44/46） |
| A9 | **新事实（推翻旧裁决前提）**：本机 `node -v` = **`v24.22.2`**，满足 `@deepseek-ai/dsh@0.2.2-rc.1` 的 `engines.node >=24.9.0` | `node -v` → v24.22.2；`GET registry.npmjs.org/@deepseek-ai%2fdsh/0.2.2-rc.1` → 200，`engines={'node':'>=24.9.0'}` | ⚠️ 25:553 / 45 / 48:255 的「Node 22.20.0 < 24.9.0 硬阻塞」**已过时**，见 D4/风险 R7 |
| A10 | `@deepseek-ai/dsh@0.2.2-rc.1` 存在且 latest 相关元数据可读；npm 2.8.4 tarball 可用（`integrity sha512-sGb8…`），可作 G5 diff 的洁净基准 | `GET /@240xu%2fdsh-websearch/2.8.4` → 200，tarball URL 有效 | ✅ |
| A11 | 6 个 test-only symlink 现状：`S/node_modules/@deepseek-ai/*` 6 个全部指向 `/opt/dsh-0222/...` 且 **OK**；`S/test-node_modules/@deepseek-ai/*` 6 个仍指向旧 `/usr/local/lib/node_modules/@deepseek-ai/dsh/...`，**全部 DANGLING**（死脚手架，54 号已证全库 0 引用） | `readlink -e` / `find "$S" -xtype l`；当前 `cd "$S" && node --test tests/*.test.js` → **73 tests / 73 pass / 0 fail / EXIT=0** | ✅（悬空隐患确证，当前未影响测试） |
| A12 | 本轮取证期间 `73/73`、`35/35 一致`、`26 备份`、服务 active 基线未漂移（无并发写者改 `S`/`P`） | A7/A8/A11 采样时刻一致 | ✅ |
| A13 | 兄弟报告状态：`75-nextstep-runtime.md` 已落盘（28 行骨架，A–E 待补）、`77-upstream-publish-status.md` 已落盘（80 行）；`73-nextstep-gaps.md` / `74-nextstep-landing.md` **未落盘**（按指示不等） | `glob` + `wc -l` | ✅ |

## 无法验证（登记为 E，不得当结论）

| # | 无法验证项 | 原因 / 解锁条件 |
|---|---|---|
| E1 | 作者 `240xu` 本地是否已写 2.8.9 补丁、是否会接受我们的 PR | 私有工作区不可见；需在 Issue #8 回复询问（**需用户点头**） |
| E2 | PR #7 提交后作者响应与合并时点 | 外部异步事件 |
| E3 | `patch-package` 的 pnpm 根包 `postinstall` 是否触发、生成的补丁能否完整捕获「新增文件 + README」 | 需 `pnpm add` / `pnpm install`（**状态变更，需授权**）；48 号 §1.4 已标 E |
| E4 | `file:` overlay 方案 B 的 `dsh.bundle` 元数据是否被 profile 识别；`plugin_manager install_bundle` 是否会覆盖 `P` | 需实际改 `package.json` 并跑 install（需授权） |
| E5 | 升级 0.2.2-rc.1 后与 `unified` provider 的组合树实测、`DEEPSEEK_BASE_URL` 串台、新 runtime 下 35 文件补丁行为 | 需切换 runtime 并重启（有外部副作用，需决定） |
| E6 | 真实 HMR / 插件卸载触发 `ws.register` disposer | 无浏览器控制入口；72 号已从源码定案 |
| E7 | 完整 35 文件 diff 对 2.8.8 / PR#7 head 的 `patch --dry-run` 结果（44 号只实跑 10 文件 10/10 CLEAN） | 需生成 G5 diff 后对临时副本 dry-run（**本轮可立即做，见 D2**） |
| E8 | 73/74 号尚未落盘的 E1 技术缺口 / E2 工程落地结论 | 兄弟专家在写，按指示不等；本计划以 A1–A13 + 48/50/77 既有结论为准 |

---

## B. 三类结论表

### B1 · 立即可执行（Lead 本轮就能做，**零外部副作用**：只读、或只写 `$R` 研究产物、或只做 `--dry-run` 临时副本）

| ID | 项 | 具体命令 / 步骤 | 验收标准 | 风险 |
|---|---|---|---|---|
| L1 | 复核并固化当前基线（防漂移） | `cd "$S" && node --test tests/*.test.js`；只读 md5 比对（A8 的 python 片段）；`systemctl show dsh-web --property=MainPID,ActiveState --value` | 73/73 pass、DIFF=0、26 `*.orig` 存在、service active、MainPID=3207503 | 低：纯只读；若发现漂移则先收口再谈其它 |
| L2 | **生成 G5 完整 35 文件 diff**（44 号草案缺口） | 见 D2 与 E-阶段1：`npm pack @240xu/dsh-websearch@2.8.4` 解到 `$R/g5/base284/`（或等价 `curl tarball | tar`），`cp -a "$P/." "$R/g5/patched/"`，`diff -ruN --label a/... --label b/... "$R/g5/base284" "$R/g5/patched" > "$R/g5/G5-35files.patch"` | `grep -c '^diff ' ≥ 35`；`md5sum -c` 仍 35/35；`patch --dry-run -p1 -d "$R/g5/base288" < G5-35files.patch` 逐 hunk rc=0 记录 | 低：只写 `$R/g5/`；需先确认 2.8.8 基准副本存在（用 npm 2.8.8 tarball 解到 `base288`） |
| L3 | **test-only symlink 悬空加固 + 验收**（A11 / 见 E-环境韧性） | 只读体检：`find "$S" -xtype l` → 应仅 `test-node_modules` 下 6 个；把 `S/node_modules/@deepseek-ai/*` 6 个目标抽成变量 `RT`（从 `systemctl show` 的 cmdline 或 `readlink` 现存活链接取），写一段可重跑的 `relink.sh` 草案文本存入本文件（§E），**不在本轮执行 `ln -sfn`**（执行属改 `$S` 脚手架，见下注） | 体检输出可解释；`node --test` 73/73；模拟 `RT` 变更后重跑草案能恢复 73/73 | 低：加固脚本若写死 `/opt/dsh-0222` 会重演 11-12 悬空 ⇒ 必须动态取 runtime 路径 |
| L4 | 登记 A9 过时结论修订 | 在 76 号本文件写入「25:553 / 48:255 的 Node 门槛硬阻塞已过时」，**不改其它报告**（唯一写文件约束） | 本文件 A9 + 风险 R7 有明确条目；告知 Lead 由其在后续轮次同步 25/48 | 低：纯文档 |
| L5 | PR 策略文本准备（不发送） | 复用 48 号 §2.4 两段 ≤10 行文本（Issue #8 回复 / PR#7 comment），扩写为「G5 35 文件 + PR#7 仅 3 文件」的覆盖说明，存于 `$R/g5/` 草案 | 文本 ≤10 行/段、无 token/cookie 值、注明「须用户点头才发」 | 低：不发送＝零外部副作用 |

> 注：B1 全部满足「不操作任务板 / 不 commit / 不 push / 不 publish / 不改 profile / 不重启」。L3 的 `ln -sfn` 若实际执行会改 `$S` 脚手架（非源码非配置），本轮**只给草案与验收命令**，由 Lead 决定是否落为下一轮 P2 动作；若要求「本轮即加固」，可执行且仍属无外部副作用（见 E-环境韧性最小步骤）。

### B2 · 需用户决定（**有外部副作用**或**改动产品/执行语义**）

| ID | 项 | 具体步骤（获授权后） | 验收标准 | 风险 |
|---|---|---|---|---|
| U1 | 对外提交 PR / Issue #8 回复 / PR#7 comment / 新开 PR / `npm publish` 2.8.9 | D3 最小步骤；G2 走 PR#7 comment 不另开重复 PR；G1+G3+G4+G5 基于 `main`=2.8.8 新开或补进 PR#7；发布前 bump 版本 | 48 号 §2.4 分组动作逐项完成；`patch --dry-run` 10/10→35/35 CLEAN；发送文本经用户确认 | **不可逆外部动作**：公开仓库/registry 状态被改；作者 0 review 可能长期无响应；与作者本机 2.8.9 修复重叠 |
| U2 | patch-package 落地 | D1；`cd "$PROF" && pnpm add -D patch-package` + 加 `postinstall` + `npx patch-package @240xu/dsh-websearch` + `pnpm install` 重放 | `grep -c '^diff --git' patches/*.patch ≥ 35`；重放后 35/35 md5 OK；73/73 单测；真实 `web_fetch`/`web_search` 全绿 | 新增 12 传递依赖 + 改 lockfile + 改已验证成功路径；补丁绑定 2.8.4，改版本即 fail loud；E3 |
| U2b | 零依赖 `file:` overlay（方案 B，U2 的备选） | `cp -a "$P/." "$PROF/vendor/dsh-websearch-2.8.4-patched/"`，改 `package.json` 依赖为 `file:./vendor/...`，`pnpm install` | `cd DST && md5sum -c PLUGIN_CHECKSUMS.txt` 35/35；`plugin_manager list_plugins` 仍加载 | 改依赖值＝状态变更；E4 未验证 |
| U3 | 升级 `@deepseek-ai/dsh` 至 0.2.2-rc.1（或插件升 2.8.8） | D4；先 L1+L2 存档，再切 runtime / 改 pin，最后重放补丁 | 升级后 35/35 重放、73/73、真实工具复跑、认证 API 三条 200 | 覆盖本地修复重现已修 P0/P1；重演 11-12 symlink 悬空；E5 |
| U4 | 产品语义取舍（不阻塞，登记即可） | `isComplexQuery` 查询语义、`sanitizeError` 加固、`/tmp` 会话 JWT 清理、3b 混合故障细策略、D5 按 session 隔离持久化 | 每条给 go/no-go 与回归测试 | 改变已验证行为；68/72 号均列为「需用户决定，非 bug」 |

### B3 · 明确不该做（会破坏当前可用状态）

| ID | 项 | 为什么不该做 | 触发条件（何时可重评） |
|---|---|---|---|
| N1 | **手工把 pin 改成 2.8.8 并 `pnpm install`** | 立即覆盖 35 文件补丁，重新引入 Issue #8 保存失败、`normalizeHeaders` 删 Host 403、settings inert、`collect()` 崩溃、`save()` 快照丢失等已修 P0/P1（44 §3 / 77 §4） | 先完成 L2 生成 35 文件补丁 + 用户点头 + 升级后重放验收全绿 |
| N2 | **不补 G5 就对外提 PR** | 44 号 G1–G4 只覆盖 10/17–23 文件，PR#7 仅 3 文件 ⇒ 漏掉全部 11-08 之后修复；提交的是残缺补丁 | L2 完成且 `patch --dry-run` 35/35 CLEAN |
| N3 | **另开与 PR #7 重复的 PR / 合并 PR #7** | PR#7 open/mergeable/0 review，其 `index.js`+`provider.js` 与 G2 重复；44 号 dry-run 已证 FAILED；合并会与作者本机修复重叠 | 作者在 Issue #8 / PR#7 明确回复后 |
| N4 | **`npm publish` / `git push` / `git commit`** | House Rules 无用户明确要求；本地改动从未进入 git 历史（`S` 无 .git），push 无对象可推；publish 会改 public registry | 用户明确要求且完成 U1/U2 验收 |
| N5 | **改 `/usr/local/sbin/dsh-web-run-native.sh` 或回退 runtime** | 25 §6 前提 3 明确：那是外部 runtime 切换产物，回滚它会把 node24 服务退回 node22、破坏当前 DSH runtime | 用户明确要求「连 runtime 一起回退」 |
| N6 | **重启 `dsh-web.service` / 清 `pnpm store` / 动 profile cordis.patch.yml** | 当前 73/73 + 35/35 + 服务全绿＝零动作稳态；重启触发重新解包可能丢 `node_modules` 内补丁 | 升级/重装且补丁已固化后 |
| N7 | **删除 `S/test-node_modules/` 或把悬空链接当故障修** | 54 号证其全库 0 引用、是死脚手架；删除属无收益改动，且会掩盖「真正在起作用的是 `S/node_modules/`」这一口径 | 先按 L3 把动态 relink 落地并复验 73/73 |

---

## C. 优先级排序 P0–P3 + 依赖图（文本）

| 优先级 | 项 | 类别 | 依赖 | 理由 |
|---|---|---|---|---|
| **P0** | L1 基线固化（73/73 + 35/35 + 26 备份 + service active） | 阻塞/数据风险 | 无 | 历轮多次出现「并发写者改 `S` 未同步 `P`」导致基线漂移（62 号 A′.4）；任何对外动作前必须先钉死基线 |
| **P0** | L2 生成 **G5 完整 35 文件 diff** + `patch --dry-run` 对 2.8.8 / PR#7 head | 阻塞 | L1 | 48 号发现的法律级前置：G5 diff 是**对外 PR 的前置**；无它则 U1 全部 NO-GO |
| **P0** | A9/R7 登记 Node 门槛过时结论 | 阻塞（裁决正确性） | 无 | 若沿用「Node 不足」旧理由做升级裁决，会掩盖真实风险（runtime 切换 + 补丁重放） |
| **P1** | L3 symlink 动态 relink 加固 + 验收 | 高价值 | L1 | 11-12 第三次 runtime 切换已致 6 链接悬空、`node --test` 41/49；下次切换必复发 |
| **P1** | U1 对外 PR（**需用户点头**） | 高价值 | **L2(G5 diff)** → 用户授权 → 48 号分组文本 → dry-run | 长期可升级性收益；不提交的代价为零（本机补丁已生效） |
| **P1** | U2 / U2b 持久化（**需用户点头**） | 高价值 | L1 + 用户授权 + E3/E4 实测 | 「换机自动恢复」才需要；本机别丢＝维持现状即足够（48 §1.5） |
| **P2** | L4/L5 文档与 PR 文本准备、U3 升级预研（不执行）、U4 语义取舍登记 | 打磨 | L1 | 不阻塞当前可用状态 |
| **P3** | 清理死脚手架 `test-node_modules`、报告库旧数字（旧 PID / 旧单测数）统一为动态口径 | 可选 | L3 落地后 | 75 号 D 段同题；按 99:3 保留历史快照 |

### 依赖图（文本）

```
[A9 Node 复核] ──┐
[L1 基线固化] ───┼──> [L2 G5 35文件 diff] ──> [U1 对外 PR / Issue#8 / PR#7 comment]  (需用户点头)
                 │            │
                 │            └──> [N2 禁止未补G5就提PR] 解除
                 │
                 ├──> [L3 symlink 动态 relink] ──> [U3 升级 runtime 预演]  (需用户点头)
                 │            └──> [E5 新runtime下35文件补丁验证]
                 │
                 ├──> [U2 patch-package] ──或──> [U2b file: overlay]  (需用户点头, 二选一)
                 │            └──> 共同前置: E3/E4 实测
                 │
                 └──> [U4 产品语义取舍]  (独立, 不阻塞)

禁止边:  [N1 改pin升2.8.8] --X--> 在 L2+用户点头+重放验收 之前
         [N3 重复PR]        --X--> 在作者回复之前
         [N4 push/publish]  --X--> 在用户明确要求之前
         [N6 重启/清store]  --X--> 在补丁固化之前
```

---

## D. 四条路径裁决：patch-package / G5 diff / 对外 PR / 升级

### D1 · patch-package → **不做（本轮 NO-GO；维持「需用户决定」）**

- **理由**：① `PROF/package.json` 精确 pin `2.8.4` 无 `^`，当前 73/73 + 35/35 + 服务全绿＝**零动作稳态**（48 §1.2）；② 落地会新增 1 devDep + 12 传递依赖 + `postinstall` + 改 lockfile，**改变已验证成功路径**；③ E3（pnpm 根包 `postinstall` 是否触发、补丁能否完整捕获 35 文件中的 12 个新增文件 + README）未实测；④ 48 号原命令按 **17 文件**写，与现行 **35 文件**已脱节，直接照抄会生成残缺补丁；⑤ 收益只在「换机重装/手工升级」兑现，本机别丢＝`B/*.orig` + 35 文件 md5 基线已足够。
- **若做（最小步骤，需用户点头）**：以 48 §1.4 为模板但把 17→**35**：`cd "$PROF" && pnpm add -D patch-package` → 写 `postinstall:"patch-package"` → `npx patch-package @240xu/dsh-websearch` → `grep -c '^diff --git' patches/@240xu+dsh-websearch+2.8.4.patch` **期望 ≥35**（23 改 + 12 增）→ `pnpm install` 重放 → `md5sum -c` 35/35 OK + `cd "$S" && node --test tests/*.test.js` 73/73 + 真实 `web_fetch`/`web_search` 复跑。回滚见 48 §1.6（`pnpm remove` + 删 `postinstall` + 删 patch + `pnpm install`，**不触碰 35 文件本身**）。
- **更优零依赖备选**：方案 B（`file:` overlay，48 §1.5），但同样需用户点头且 E4 未验证。

### D2 · G5 完整 35 文件 diff → **做（本轮立即可执行，P0）**

- **理由**：纯本地、零外部副作用，且是 U1 的**唯一前置**；缺口链已由 A6 独立坐实（PR#7 = 3 文件，44 草案 = 10/17，本地 = 35）。不做则所有对外动作永远卡死。
- **最小步骤**（全部写入 `$R/g5/`，不动 `S`/`P`/profile）：
  1. 洁净基准：`mkdir -p "$R/g5/base284" "$R/g5/base288" "$R/g5/patched" "$R/g5/dryrun288" "$R/g5/dryrun7"`，用 `curl -sS "$(npm view @240xu/dsh-websearch@2.8.4 dist.tarball --json)" | tar -xz -C "$R/g5/base284" --strip-components=1` 与同法 `2.8.8` 解到 `base288`（只读取证，值不落报告）。
  2. 快照当前已修补树：`cp -a "$P/." "$R/g5/patched/"`（或等价 `cp -a "$S/."`，A8 已证两树一致）。
  3. 生成 unified diff：`(cd "$R/g5" && diff -ruN --label a/package --label b/package base284 patched > G5-35files.patch) || true`（`diff` 返回 1 属有差异，非失败）。
  4. 覆盖核对：`grep -c '^diff ' "$R/g5/G5-35files.patch"` ≥ 35；把 44 号 G1–G4 的 10 文件与 PR#7 的 3 文件逐项 `grep '^diff --git'` 命中；对 12 个新增文件确认 `--- /dev/null`。
  5. 冲突 dry-run：`cp -a "$R/g5/base288/." "$R/g5/dryrun288/"`；`patch --dry-run -p1 -d "$R/g5/dryrun288" < "$R/g5/G5-35files.patch"` 逐 hunk 记录 rc；PR#7 head（可用 `GET /repos/240xu/dsh-websearch/pulls/7/files` 的 `raw_url` 或 `bcb24b1efbb4` 的 raw 取 3 文件）另做 `dryrun7`。**只打临时副本，不碰 `S`/`P`。**
  6. 零密钥核对：`grep -nEi 'ghp_|github_pat_|cfut_|Bearer |[A-Za-z0-9_-]{32,}' "$R/g5/G5-35files.patch" | head`（应仅命中正常代码/URL，无凭证值）。
- **验收**：≥35 段、12 个 `/dev/null` 新文件段、对 2.8.8 逐 hunk CLEAN/偏移量记录、35/35 md5 仍一致、73/73 单测仍绿、`S`/`P` 未被修改（`find "$S" "$P" -newer "$R/g5/G5-35files.patch"` 为空）。

### D3 · 对外 PR / publish → **不做（本轮 NO-GO；需用户点头）**

- **理由**：① 外部副作用不可逆（公开仓库/registry）；② House Rules 与 45/49/50 号均列「需用户决定」，本会话至今无明确授权；③ PR#7 0 review / 11-04 后无活动，Issue #8 作者「ok了」但未发布、E1 未知 ⇒ 很可能与作者本机 2.8.9 重叠；④ **G5 未补**（N2）；⑤ 不提交的代价为零（77 §4：本机补丁已生效）。
- **若做（最小步骤，需用户点头）**：`L2 完成` → 按 48 §2.4 分组：G2 作 **PR#7 comment**（不另开重复 PR，用 48 §2.4 第二段文本 + 补「本 PR 仅 3 文件、我们另有 35 文件完整 diff」）→ G1 先在 **Issue #8 回复**询问 2.8.9（用 48 §2.4 第一段文本）→ G3/G4/G5 基于 `main`=2.8.8 新开 PR（或并入 G1），附 dry-run 结果 → `npm publish` 仅在用户另行明确要求且版本 bump + 35 文件重放验收后。回滚：未发出＝零成本；已发出 PR 可 `close`、comment 可删、`main` 不受影响（48 §2.6）。

### D4 · 升级 → **不做（本轮 NO-GO；理由须按 A9 修订）**

- **理由（修订版）**：① 插件升 2.8.8 会覆盖 35 文件补丁、重现已修 P0/P1（N1）；② DSH 升 0.2.2-rc.1 = 又一次 runtime 切换，11-12 已证会让 6 个 test-only symlink 悬空、`node --test` 掉到 41/49 ⇒ **必须先完成 L3 动态 relink**；③ 新 runtime 下 35 文件补丁行为 = E5 未验证；④ **旧理由「Node 22.20.0 < 24.9.0 硬阻塞」已失效**（A9：本机 v24.22.2 已满足），不得再作为不升级依据，否则会掩盖真实风险；⑤ 改 runtime/重启属外部副作用，需用户决定。
- **若做（最小步骤，需用户点头）**：`L1` 存档 35 文件 md5 + `L2` G5 diff + `L3` relink → 在**隔离副本**上先切 `RT` 并重放 `G5-35files.patch` → `cd "$S" && node --test tests/*.test.js` 73/73 → 真实 `web_fetch(https://example.com)` 200 / `web_search` 8 Sources / 认证 API 三条 200 / `web_fetch` 与 `web_search` 遥测新字段有值 → 才允许改 pin 或切 runtime → 复跑同一套验收 → 保留回滚链（25 §6 的 23 cp + 12 rm + `systemctl show -p MainPID --value` 步）。

---

## E. 执行计划（阶段/步骤/命令/验收）+ 本轮立即清单 + 风险登记 + 环境韧性

### E1 · 阶段化执行计划

| 阶段 | 步骤 | 命令（要点） | 验收 |
|---|---|---|---|
| **阶段 0 · 钉基线（P0，本轮）** | S0.1 复跑单测 / S0.2 md5 比对 / S0.3 服务与 pin / S0.4 记录 A9 修订 | `cd "$S" && node --test tests/*.test.js`；A8 python 片段；`systemctl show dsh-web … --value`；`python3 -c …package.json` | 73/73、DIFF=0、26 `*.orig`、active/3207503、pin=2.8.4；本文件 A9 条目成形 |
| **阶段 1 · G5 diff（P0，本轮）** | S1.1 解 2.8.4/2.8.8 基准 / S1.2 快照 patched / S1.3 `diff -ruN` / S1.4 覆盖核对 / S1.5 dry-run / S1.6 零密钥核对 | D2 六步（全写 `$R/g5/`） | ≥35 段、12 `/dev/null`、dry-run rc 记录、`S`/`P` 未改、无凭证值 |
| **阶段 2 · 环境韧性（P1，本轮给草案/可执行）** | S2.1 symlink 体检 / S2.2 动态 relink / S2.3 模拟切换复验 | 见下「环境韧性」 | 73/73、0 dangling（或仅死脚手架 6 个且已显式登记） |
| **阶段 3 · 用户决策门（P1，等待）** | S3.1 呈报 U1/U2/U2b/U3/U4 与「一个必须点头的决定」 | Lead 简报（本文件末尾 12 行版另发） | 用户明确 yes/no；未点头则 U* 全维持 NO-GO |
| **阶段 4 · 授权后动作** | S4.1 按 D1/D3/D4 最小步骤执行；S4.2 每步复跑 L1 验收；S4.3 回滚链常备 | 各自 D 段命令 | 35/35 + 73/73 + 真实工具/API 全绿；失败即按 48 §1.6 / 25 §6 回滚 |

### E2 · 依赖图 / 本轮可立即执行清单（≤5 项，**全部零外部副作用**）

> 供 Lead 直接照做；顺序即依赖顺序。

1. **基线四连**：`cd "$S" && node --test tests/*.test.js`（73/73）+ 只读 md5 比对（DIFF=0）+ `find "$B" -name '*.orig' | wc -l`（26）+ `systemctl show dsh-web --property=MainPID,ActiveState --value`（active）。
2. **生成 G5 完整 35 文件 diff**：按 D2 六步，产物只落 `$R/g5/`；跑 `patch --dry-run` 对 2.8.8 与 PR#7 head 临时副本，记录逐 hunk rc。
3. **symlink 悬空体检 + 动态 relink 落地**：`find "$S" -xtype l`（应只 `test-node_modules` 6 个）；把 `S/node_modules/@deepseek-ai/*` 6 个改由运行时 `RT` 变量生成，复跑 73/73（详见环境韧性）。
4. **登记 A9/R7 过时结论**：本文件写入「Node 门槛硬阻塞已过时，升级裁决改用 runtime 切换 + 补丁重放风险」；不改 25/48（唯一写文件约束），交 Lead 后续同步。
5. **准备但不发送 PR 文本**：复用 48 §2.4 两段，补一句「PR#7 仅 3 文件、我们 35 文件完整 diff 已就绪待授权」；存 `$R/g5/`，标注「须用户点头才发」。

### E3 · 风险登记

| ID | 风险 | 等级 | 缓解 / 验收 |
|---|---|---|---|
| R1 | 并发写者改 `S` 未同步 `P` ⇒ 基线漂移（62 号 A′.4 曾 6 DIFF） | P0 | 阶段 0 四连钉死；对外动作前重跑 L1 |
| R2 | G5 diff 漏文件（44 草案 10/17、PR#7 3） | P0 | `grep -c '^diff ' ≥35` + 12 个 `/dev/null` 段 + dry-run 逐 hunk |
| R3 | 升级/重装覆盖 35 文件补丁、重现已修 P0/P1 | P0 | N1 禁止；`file:`/patch-package 固化后才允许；重放后 35/35 md5 |
| R4 | runtime 切换 → 6 symlink 悬空，`node --test` 41/49 | P1 | L3 动态 relink + 每次切换后 73/73 验收 |
| R5 | 未授权就 push/publish/comment（不可逆外部动作） | P0 | U1 门控；House Rules；N4 |
| R6 | 补丁/报告混入凭证值 | P1 | D2 S1.6 零密钥核对；token 仅 shell 变量、不落盘/不入输出 |
| R7 | **沿用「Node 22.20.0 < 24.9.0 硬阻塞」旧裁决** ⇒ 掩盖真实升级风险 | P1 | A9 修订 + 本文件 L4 + Lead 简报；升级理由改为 R3/R4/E5 |
| R8 | `patch-package` 的 `postinstall` 被 `ignore-scripts` 跳过 / 补丁不全 | P2 | 48 §1.4 P2 先验 `pnpm config get ignore-scripts` + `grep -c ≥35` + 重放 md5 |
| R9 | `test-node_modules` 死脚手架被误当故障「修」，掩盖真口径 | P3 | 54 号结论登记；N7 |
| R10 | 73/74 号 E1/E2 结论未落盘，计划未吸收其潜在新缺口 | P2 | 按指示不等；待落盘后由 Lead 触发一次 L1 复核增量 |

### E4 · 环境韧性：runtime 切换导致 test-only symlink 悬空（加固 + 验收）

**现状（A11 独立实测）**：`S/node_modules/@deepseek-ai/` 下 6 个链接均指向 `/opt/dsh-0222/node_modules/@deepseek-ai/*` 且 **OK**；`S/test-node_modules/@deepseek-ai/` 下 6 个仍指向旧 `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/*`，**6/6 DANGLING**。当前 73/73 全绿，说明生效的是 `node_modules/`，`test-node_modules/` 是 54 号已证的死脚手架（全库 0 引用）。11-12 第三次 runtime 切换曾使 `node_modules/` 6 个全悬空 → `41/49`，重建到 `/opt/dsh-0222/...` 后恢复 73/73（75 号背景）。

**加固原则**：链接目标**不得写死** runtime 路径；从当前运行进程的 cmdline 或已存活链接动态解析 `RT`，并提供一键重放脚本。

```bash
# 0) 常量
S=/home/ova/dsh/.artifacts/websearch-research/src-work/plugin
# 1) 动态解析当前 runtime 根（优先用服务 cmdline，回退到现存活链接）
RT=$(tr '\0' ' ' < /proc/$(systemctl show -p MainPID --value dsh-web.service)/cmdline \
     | grep -oE '/[^ ]*/node_modules/@deepseek-ai/dsh/lib/bin\.js' \
     | sed -E 's#(.*)/node_modules/@deepseek-ai/dsh/lib/bin\.js#\1#')
[ -z "$RT" ] && RT=$(readlink -f "$S/node_modules/@deepseek-ai/dsh-web" \
     | sed -E 's#(.*)/node_modules/@deepseek-ai/dsh-web#\1#')
echo "runtime root = $RT"          # 期望 /opt/dsh-0222（或切换后的新根）

# 2) 一键重放 6 个 test-only 链接（只改 $S 脚手架，非源码/配置/运行时）
for pkg in cordis dsh-credentials dsh-launch-environment dsh-settings dsh-web schemastery; do
  ln -sfn "$RT/node_modules/@deepseek-ai/$pkg" "$S/node_modules/@deepseek-ai/$pkg"
done

# 3) 验收（三条全过才算加固成功）
find "$S/node_modules/@deepseek-ai" -xtype l | wc -l                 # 期望 0
for l in "$S"/node_modules/@deepseek-ai/*; do [ -e "$l" ] || echo "BROKEN $l"; done
cd "$S" && node --test tests/*.test.js                                # 期望 73 tests / 73 pass / 0 fail / EXIT=0

# 4) 模拟下一次 runtime 切换（不真切服务）：临时把 RT 指向另一份存在的 dsh runtime 副本再重放，
#    重复第 3 步三条验收；随后重放回真实 RT 并再跑一次 73/73。
#    注：若本机只有一份 runtime 副本，则以「把链接 target 临时改名再 ln -sfn 还原」等价演练。
```

**验收标准**：`find -xtype l` 在 `node_modules/` 下为 0；`node --test` 73/73；`S` ↔ `P` 仍 44/44 md5 一致（DIFF=0）；`test-node_modules/` 的 6 个悬空链接**显式登记为已知死脚手架**（N7 不删不改），避免下次体检误报。**依赖**：此加固是 U3（升级/切 runtime）的 P1 前置；未加固前 N6「不重启/不切 runtime」保持。

---

## 已确认无误 · 无法验证（汇总索引）

- 已确认无误 = A1–A13（npm/GitHub/本机/pin/symlink/单测/兄弟报告状态），逐项含只读复现命令。
- 无法验证 = E1–E8（作者私有工作区、PR 响应、patch-package 实测、file: overlay、新 runtime 行为、HMR、35 文件 dry-run、73/74 号未落盘结论）。
- 本文件未写入任何 token / cookie / 凭证值；Basic auth 凭据仅在 shell 变量与 curl `-u` 参数内存在，未落盘、未出现在任何输出。

---

## 结论（A/B/C/D/E 一句话）

**A**：外部事实（npm 2.8.8 无 2.8.9、main 停 10-21、PR#7 open/0 review/3 文件、无 release）与本机事实（pin 2.8.4、35/35 一致、73/73、26 备份、node v24.22.2）全部只读复核一致；**B**：本轮 5 项零副作用立即做、U* 需用户点头、N* 明确禁止；**C**：P0 = 钉基线 + 补 G5 + 修订 Node 旧裁决，G5 是对外 PR 的唯一前置；**D**：patch-package 不做、G5 diff 做、对外 PR 不做、升级不做（理由按 A9 改写）；**E**：阶段 0→4 可执行、立即清单 5 项、10 条风险登记、symlink 动态 relink 加固为下次 runtime 切换的必做前置。**一个必须用户点头的决定**：是否在 G5 diff 就绪后对外提交 PR / 回复 Issue #8（含是否发布 2.8.9）。
