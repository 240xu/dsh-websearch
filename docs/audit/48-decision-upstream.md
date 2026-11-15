# 48 · 专家组决断 · 组 C（上游策略）：patch-package 与对外 PR

> task-26 · 唯一产出本文件 · **2026-11-08 17:11–17:2x**（Asia/Shanghai）· 全程**只读**：未改源码/配置/其它报告/运行时，未执行 `npm install`/`pnpm install`/升级/重启/提交 PR，未操作任务板，token 值未出现在任何输出（Basic auth `U=x-access-token; P=${TOK#*:}` 仅 shell 变量内）。
>
> **证据等级**（全队 11 号口径）：**A**=源码实证（带 `ref=<tag|sha>` 永久链接或本地 `路径:行号`，本次实读）；**B**=官方文档/issue/PR 原文（URL + 访问日 2026-11-08 + HTTP 状态 + 逐字）；**C**=版本记录（CHANGELOG/commit/npm/issue 编号）；**D**=本机实测（命令 + stdout + exit code + 时间/主机 `wuming`）；**E**=推断/待核实（显式标注，不得当结论）。**四联标注**：结论 → 依据 → 代码落点 → 验证方式。
>
> **决断原则（49 号 §3 原文）**：「结论先行 go / no-go / 条件-go；低风险、可独立验证、可回滚优先 go；改变当前已验证成功路径的证据不足则条件-go 或 no-go；每项给可 apply 的 diff（不实际 apply）+ 回归断言 + 回滚 + A/B/C/D/E」。对外动作必须标明「需用户最终授权」还是「可由 Lead 直接执行」。

---

## 0. 结论先行（两句话）

| # | 决断对象 | **决断** | 一句话理由 | 授权归属 |
| --- | --- | --- | --- | --- |
| **1** | patch-package 落地持久化（17 文件） | **条件-go**（默认不执行，前置条件满足后可 go） | profile 已精确 pin `2.8.4`（无 `^`）+ 服务已重启全绿 ⇒ **当前是零动作稳态**；patch-package 会新增 1 个 devDependency + postinstall + 改 lockfile，**改变已验证成功路径**，收益只在「换机重装/手工升级」时才兑现。满足 §1.3 三条件后可由 Lead 执行，否则维持 no-go 等价态 | **需用户最终授权**（新增依赖/postinstall 属状态变更，45 号 §裁决表已列「需用户决定」） |
| **2** | 对外提交 PR（G1–G4 + G2 comment + 2.8.9 询问） | **条件-go**（**本轮不提交**；仅授权后可 go，且必须先修订 44 号草案） | 44 号四组 diff 只覆盖 **10/17** 文件，11-08 新增的 7 个文件（`namespace.js`/cache/health/history/settings-api/README/interaction test）**不在草案内**；且 Issue #8 作者「ok了」但未发布、PR #7 仍 open 0 review，此时提 PR 会与作者本机修复重叠。技术侧已证 **当前 17 文件全部 10/10 CLEAN-APPLY 对 2.8.8**，证据充分，但**对外动作属需用户授权**（49 号 §3 / 45 号 §裁决表） | **需用户最终授权**（对外提交 PR / comment / issue 回复均不可由 Lead 擅自执行） |

> **两项都不是纯 go**：因为任务硬约束明确「不执行 npm install / 不提交 PR / 不升级」，本轮只能产出**可 apply 的草案 + 决断**，不能落地；且 45 号裁决表已把这两项归入「需用户决定清单」。判「条件-go」= 给出精确前置条件与完整命令，用户一旦授权即可由 Lead 直接执行，无需再调研。

---

## 1. 决断 1 · patch-package 落地持久化

### 1.1 当前事实基线（[A/D]，2026-11-08 17:1x 实测）

| 项 | 值 | 证据 |
| --- | --- | --- |
| 运行态 | `dsh web` **PID 2334**，11-08 12:40:47 重启；`web_fetch` 200 / `web_search` 8 Sources / health `enabled:6,keyless:6` / GUI 200 | [49 号 §1–2](49-restart-evidence.md) [B/D]；本机 `pgrep -af 'dsh web'` [D] |
| 单测 | **25/25 通过**；31 个 JS `node --check` OK；17/17 文件 `src-work` ↔ 安装目录 md5 MATCH | [25 §14.3](25-execution-log.md) [B/D]；本机 `grep -c '^test('` = 25 [D] |
| 基线 | `.baseline-20261108-0922/PLUGIN_CHECKSUMS.txt`（35 行） | 本机 `python3` 逐行比对 **TOTAL 17/17 MATCH** [D] |
| **改动文件数 = 17** | **10 改**（README.md、cache.js、client.js、health.js、history.js、index.js、provider.js、settings-api.js、util/egress-fetch.js、util/mcp-client.js）+ **7 增**（backends/{firecrawl,tinyfish}.js、util/namespace.js、tests/lead-2026110{6,7,7-p0,8-interaction}.test.js），**0 删** | 本机 `npm 2.8.4 tarball` 解包 → `os.walk` + md5 全量比对：npm 2.8.4 共 33 文件、当前 40 文件 [A/D] |
| profile pin | `package.json` → `"@240xu/dsh-websearch": "2.8.4"`（**精确、无 `^`**）；`pnpm-lock.yaml` → `specifier: 2.8.4` / `version: 2.8.4(...)` | 本机 `python3 -c json.load` [A]；lockfile `:11-13,29-31` [A] |
| 工具链 | `pnpm 11.28.5`（`/opt/node22/bin/pnpm`）；`nodeLinker: hoisted`；`registry=https://registry.npmmirror.com`；**无 `ignore-scripts` / `onlyBuiltDependencies`** | `pnpm --version`、`pnpm-workspace.yaml`、`~/.npmrc` [A/D] |
| patch-package 现状 | **profile 内未安装**（`node_modules/patch-package` 不存在）；npmmirror 元数据 `patch-package@8.0.1` HTTP 200，`engines.node>=14`、12 个传递依赖 | `ls` [D]；`curl registry.npmmirror.com/patch-package/latest` 200 [B/C] |
| 上游版本 | npm `latest=2.8.8`、**23 版本、无 2.8.9**；repo `pushed_at=2026-10-21T14:08:30Z` | 认证 API + registry（17:14 复核）[C/D] |

**⚠️ 与 44 号的口径差异（重要）**：44 号 §4.2 写「10 个文件 / `md5sum -c` 验 10/10」。本次实测为 **17 个文件**——25 §14.2 的 12 组采纳项在 11-08 又改了 `cache.js`/`health.js`/`history.js`/`settings-api.js`/`README.md`，新增 `util/namespace.js` 与 `tests/lead-20261108-interaction.test.js`。**任何沿用「10 文件」的命令都会漏 7 个文件**，这是本决断必须纠正的第一点 [A/D]。

### 1.2 决断：**条件-go**

**四联标注**：
- **结论**：不新增依赖也能持久化 ⇒ 默认维持现状（等价于 no-go）；若用户明确要求「换机/重装后补丁自动恢复」，则 go，但必须按 §1.3 前置条件 + §1.4 修订后的 17 文件命令执行。
- **依据 [A/C/D]**：`package.json` 精确 pin 2.8.4 + lockfile 一致 + 无 `^` ⇒ 普通 `pnpm install` 不会把 2.8.4 换成 2.8.8；**「升级 2.8.8 会覆盖」只在「手工改版本号 / 换机重装 / `pnpm store prune` 后重解包」时才发生** [D/E]。45 号 §裁决表把本项定性为「⚠️ 需用户决定：会新增依赖与 postinstall」[B]。
- **代码落点 [A]**：`~/.dsh/profiles/web/package.json`（dependencies/scripts）、`pnpm-lock.yaml`、`patches/@240xu+dsh-websearch+2.8.4.patch`（新文件）；被保护的是 `node_modules/@240xu/dsh-websearch/` 下 17 个文件。
- **验证方式 [D]**：§1.4 第 4 步的 `md5sum -c` 17/17 + 25/25 单测 + 真实 `web_search`（49 号 §2 基线）。

**为什么不是纯 go**：① 新增 devDependency + postinstall + 改 lockfile，**改变当前已验证成功的运行态路径**（49 号决断原则：「改变当前已验证成功路径的证据不足则条件-go 或 no-go」）；② `patch-package` 生成补丁时以 npm tarball 为基准，**能否完整捕获 7 个「新增文件」+ README 变更，未在本机实跑**（本轮禁止 `pnpm add`），属 **E**；③ `postinstall` 在 `nodeLinker: hoisted` 的 pnpm workspace 根包是否触发，未实测，属 **E**。

**为什么不是纯 no-go**：需求真实存在（17 文件在 `node_modules` 内），且已有零依赖备选可完全规避上述风险（§1.5），因此给「条件-go」而非「no-go」——保留可执行路径，不把问题推给用户重新调研。

### 1.3 go 的前置条件（三条，缺一不可）

| # | 条件 | 验收命令（只读/需授权执行） | 不满足则 |
| --- | --- | --- | --- |
| P1 | **用户明确授权**新增 devDependency + postinstall + 改 lockfile | 用户书面确认（本轮未获得） | 维持 no-go 等价态，走 §1.5 零依赖备选 |
| P2 | 确认 `postinstall` 会被 pnpm 执行 | `pnpm config get ignore-scripts`（期望 `false`/空）；`pnpm config get onlyBuiltDependencies` 不含阻断 | 若被跳过，改在 `dsh-web.service` 的 `ExecStartPre` 显式 `patch-package`（需 sudo，另案 [E]） |
| P3 | 生成后**确认补丁恰含 17 个文件段**、且重放后 md5 17/17 | §1.4 第 3/4 步 | 补丁不全 → 删除补丁、回退 package.json、走 §1.5 |

### 1.4 完整可执行命令（**17 文件修订版**，本轮未执行）

```bash
# 0) 常量
PROF=/home/dsh/.dsh/profiles/web
PKG="$PROF/node_modules/@240xu/dsh-websearch"
BASE=/home/ova/dsh/.artifacts/websearch-research/.baseline-20261108-0922/PLUGIN_CHECKSUMS.txt

# 1) 存档当前 17 文件（升级/重装前的权威基线）——只读，可先做
cd "$PKG" && md5sum -c <(grep -E 'README\.md|lib/(cache|client|health|history|index|provider|settings-api)\.js|lib/util/(egress-fetch|mcp-client|namespace)\.js|lib/backends/(firecrawl|tinyfish)\.js|tests/lead-2026110' "$BASE")
#    期望：17 行全部 OK（本次实测 TOTAL 17/17 MATCH [D]）

# 2) ★需用户授权★ 装 patch-package 并挂 postinstall（会写 package.json + pnpm-lock.yaml）
cd "$PROF"
pnpm add -D patch-package
node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync("package.json","utf8"));
  p.scripts={...(p.scripts||{}),postinstall:"patch-package"};
  fs.writeFileSync("package.json",JSON.stringify(p,null,2)+"\n")'

# 3) ★需用户授权★ 生成补丁（patch-package 以 npm 2.8.4 tarball 为基准对比当前 node_modules）
npx patch-package @240xu/dsh-websearch
#    → patches/@240xu+dsh-websearch+2.8.4.patch
#    ★关键复核（E 项，必须做）★：
grep -c '^diff --git' patches/@240xu+dsh-websearch+2.8.4.patch   # 期望 >= 17（10 改 + 7 增）
grep '^diff --git' patches/@240xu+dsh-websearch+2.8.4.patch | grep -E 'namespace\.js|lead-20261108-interaction|README\.md|cache\.js|health\.js|history\.js|settings-api\.js'
#    期望 7 个 11-08 新增改动全部出现；若缺 → 补丁不全，走 §1.5 或手工补 diff

# 4) ★需用户授权★ 模拟重装后自动重放 + 验收
pnpm install                      # postinstall 应自动执行 patch-package
cd "$PKG" && md5sum -c <(grep -E 'README\.md|lib/(cache|client|health|history|index|provider|settings-api)\.js|lib/util/(egress-fetch|mcp-client|namespace)\.js|lib/backends/(firecrawl|tinyfish)\.js|tests/lead-2026110' "$BASE")
#    期望 17/17 OK；若 patch 应用失败，patch-package 以非 0 退出（fail loud）
node --test tests/lead-20261106.test.js tests/lead-20261107.test.js \
            tests/lead-20261107-p0.test.js tests/lead-20261108-interaction.test.js
#    期望 25/25 pass
#    真实复跑：web_fetch(https://example.com) → 200；web_search(...) → 8 Sources；
#              GET /api/unified-search/health → enabled:6,keyless:6（49 号 §2 基线）
```

**风险表（每项给缓解）**

| 风险 | 等级 | 缓解 |
| --- | --- | --- |
| 新增 12 个传递依赖 + 改 lockfile | [C/D] | 只在 P1 授权后执行；回滚见 §1.6 |
| `postinstall` 被 `ignore-scripts` 跳过 | [E] | P2 先验；备选 `ExecStartPre` [E] |
| 补丁绑定 `2.8.4` 版本号 → 改版本即**明确失败** | [E，patch-package 设计] | 这正是所需「升级必须重放」提醒；升级时同步重生成补丁 |
| 7 个新增文件/ README 未被补丁捕获 | [E] | §1.4 第 3 步 `grep -c` + 逐项核对；不全则走 §1.5 |
| npmmirror 源与 npmjs 的 tarball 一致性 | [E] | 44 号 §4.2 已用 `registry.npmjs.org` 取 2.8.4 tarball 校验；本机 lockfile 有 `integrity: sha512-sGb8…` 可比对 [A] |
| 与 11-08 已验证运行态冲突 | [D] | 补丁只改 `node_modules` 内容，不改源码语义；重放后 md5 与基线一致即等价 |

### 1.5 若判 no-go：「不新增依赖也能持久化」的备选结论（44 号已标 E，本轮给出可执行化）

**结论**：**profile 级 overlay（零新依赖、零 postinstall）** 可以完全替代 patch-package，且更贴合当前「精确 pin 2.8.4 的零动作稳态」：

```bash
# 方案 B（推荐 no-go 时用）：把整个已修补包复制出 node_modules，改成 file: 依赖
PROF=/home/dsh/.dsh/profiles/web
SRC="$PROF/node_modules/@240xu/dsh-websearch"
DST="$PROF/vendor/dsh-websearch-2.8.4-patched"
mkdir -p "$PROF/vendor"
cp -a "$SRC/." "$DST/"                       # 保留 17 文件 + 原始未改文件
cp /home/ova/dsh/.artifacts/websearch-research/.baseline-20261108-0922/PLUGIN_CHECKSUMS.txt "$DST/PLUGIN_CHECKSUMS.txt"
# ★需用户授权★：把 package.json 依赖改为本地路径（不再是 npm 版本，升级路径变显式）
#   "@240xu/dsh-websearch": "file:./vendor/dsh-websearch-2.8.4-patched"
# pnpm install 后校验：
cd "$DST" && md5sum -c PLUGIN_CHECKSUMS.txt   # 期望 17/17 + 其余 18 个原始文件 OK
```

- **优点**：零新依赖、零 postinstall、diff 用 `diff -ru` 直接可审、换机只需复制 `vendor/` 目录 [D/E]。
- **缺点**：失去「`pnpm install` 自动重放」；`package.json` 依赖值改变（属状态变更，仍需授权）；DSH bundle 解析 `dsh.bundle` 元数据需复验 `file:` 依赖是否被 profile 识别 [E]。
- **方案 C（纯脚本 overlay，最小）**：不复制整包，只保存 `17 文件 tar + md5sum -c` 到 `~/.dsh/profiles/web/.websearch-overlay/`，在 `dsh-web.service` 的 `ExecStartPre` 加一条 `tar -x` 恢复脚本（需 sudo [E]）。**判定**：C 最轻但触发点在 systemd，跨平台/换机最弱，不推荐。

**对比裁定**：需求若只是「本机别丢」→ **维持现状 + 基线文件即足够**（零动作）；需求是「换机自动恢复」→ 方案 B 优先（无新依赖），patch-package 次之（需授权）。

### 1.6 回滚（patch-package 落地后）

```bash
cd /home/dsh/.dsh/profiles/web
pnpm remove patch-package                    # 移除 devDependency
node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync("package.json","utf8"));
  delete p.scripts.postinstall; if(!Object.keys(p.scripts||{}).length) delete p.scripts;
  fs.writeFileSync("package.json",JSON.stringify(p,null,2)+"\n")'
rm -f patches/@240xu+dsh-websearch+2.8.4.patch
pnpm install                                 # lockfile 回到落地前
# 校验：md5sum -c 仍 17/17 OK（node_modules 内的 17 文件未被移除，补丁只是"重放机制"）
```
> 注：`pnpm remove` / `pnpm install` 均属状态变更，**需用户授权**；本轮未执行。回滚**不触碰** 17 文件本身，只移除自动重放机制 [D/E]。

---

## 2. 决断 2 · 对外提交 PR

### 2.1 上游状态复核（认证 API，2026-11-08 17:14，全部 200）

| 项 | 当前值 | 与 11-07 对比 | 证据 |
| --- | --- | --- | --- |
| [Issue #8](https://github.com/240xu/dsh-websearch/issues/8) | `state=open`、`closed_at=None`、2 评论（240xu 11-05「稍等」/ 11-07 05:10「ok了，感谢」）、`updated_at=2026-11-07T05:10:52Z`、无 label | **无变化** | `GET /issues/8` + `/comments` [B/D] |
| [PR #7](https://github.com/240xu/dsh-websearch/pulls/7) | `state=open`、`merged=None`、`mergeable=True`、1 commit `bcb24b1efbb4`、`updated_at=2026-11-04T10:22:28Z`、**reviews=0、comments=0** | **无变化**（作者 4 天未动） | `GET /pulls/7` + `/reviews` + `/issues/7/comments` [B/D] |
| npm `@240xu/dsh-websearch` | `dist-tags.latest=2.8.8`、**23 版本**、末 5 = 2.8.4–2.8.8、**`has_2.8.9 = False`** | **无 2.8.9** | registry 200 [C/D] |
| repo | `pushed_at=2026-10-21T14:08:30Z`（代码 18 天未动）、`open_issues_count=6` | 无新 push | `GET /repos/...` [C/D] |

### 2.2 技术侧复核（比 44 号更强的证据）

**结论**：44 号的「5/5 CLEAN-APPLY」结论**仍成立且已升级为 10/10**（针对当前 17 文件树的 10 个被改文件），但 **44 号四组 diff 草案本身已不完整** [A/D]。

1. **10/10 CLEAN-APPLY**：以 npm 2.8.4 tarball 为基准生成当前 10 个改动文件的 `diff -u`，对 **2.8.8 main** 做 `patch --dry-run -p1` → `index.js / client.js / provider.js / egress-fetch.js / mcp-client.js / cache.js / health.js / history.js / settings-api.js / README.md` **全部 CLEAN-APPLY**。2.8.8 只改了其中 5 个文件（`index/provider/egress-fetch/mcp-client` 4 个 + `index.js` 的 `searxngBaseURLs`），且都未碰我们 hunk 的上下文 [A/D]。
2. **7 个新文件零冲突**：`backends/{firecrawl,tinyfish}.js`、`util/namespace.js`、4 个 `tests/lead-2026110*.test.js` 在 2.8.8 raw 全部 **HTTP 404** ⇒ 无同名冲突 [A/D]。
3. **PR #7 head 冲突仍在且精确定位**：`index.js` Hunk#13 FAILED at 456、`provider.js` Hunk#2 FAILED at 321（PR#7 已含 `current()` 与 RFC1918 正则）；`client.js / egress-fetch.js / mcp-client.js` 对 PR#7 head 仍 CLEAN [A/D]。⇒ **G2 依旧应作 comment，不另开重复 PR**。
4. **⚠️ 44 号草案的覆盖缺口（本轮新发现，决定「不能直接提交」）**：44 号 G1–G4 基于 11-07 的 **10 文件树**；当前是 **17 文件树**。11-08 新增的 7 个改动**不在 44 号任何一组里**：

| 未被 44 号覆盖的文件 | 来源（25 §14.2） | 若提交 PR 应如何归类 |
| --- | --- | --- |
| `lib/util/namespace.js`（新） | 采纳项 1：`findPluginRow` 消除跨 ns 误写 | **新增 G5**（或并入 G2，因属 settings 链路） |
| `lib/settings-api.js`（改） | 采纳项 1/3/4/5/6：共用 `findPluginRow`、`writeQueue` 串行化、`safeFailureReason` | G5 |
| `lib/index.js`（改，11-08 部分） | 采纳项 1/2/7/9/10/12：`findPluginRow` 共用、`resultOptions` 入缓存键、`OPTIONAL_KEY_IDS`、i18n、删死判据 | G5（**与 44 号 G2/G3 的 index.js hunk 合并，需重新生成完整 diff**） |
| `lib/cache.js`（改） | 采纳项 2：`cacheKeyFor` 纳入 `resultOptions` | G5 |
| `lib/provider.js`（改，11-08 部分） | 采纳项 2/10：传 `resultOptions`、删 `resultHeader` 恒真判据 | G5 |
| `lib/health.js`（改） | 采纳项 7：`optionalKey`/`metered` 列 | G5 |
| `lib/history.js`（改） | 采纳项 10：删 `isTrustedApiRequest` 死 fence | G5 |
| `lib/client.js`（改，11-08 部分） | 采纳项 3/4/5/6/10：`editKey` 空串删、`writeQueue`、`setToggle` 重读、`safeFailureReason`、删死判据 | G5 |
| `README.md`（改） | 采纳项 12：Known Limitation 措辞 | G5 |
| `tests/lead-20261108-interaction.test.js`（新） | 11-08 交互断言 | G5 |
| 注释规范化（7 文件） | 采纳项 11：18 处去审查叙事 | G5（纯注释，可单列一 commit） |

> 换言之：**把 44 号四组 diff 原样提交 = 只交付了 10/17 文件**，会漏掉 11-08 六专家审查的全部采纳项。必须先按 §2.3 重新生成「17 文件完整 diff」，才能对外提交 [A/D]。

5. **Lead 新增 A 级证据（本轮独立复核确认）**：[`mcp.ts@v2.2.6`](https://github.com/anomalyco/opencode/blob/v2.2.6/packages/core/src/plugin/websearch/mcp.ts) 的 `call()` **只发单个 `tools/call`**（`id: Schema.Literal(1)`、`:43-50`，全文**无 `initialize`**），`exa.ts`/`parallel.ts`/`firecrawl.ts`/`tinyfish.ts` 四处都调 `WebSearchMcp.call`（各 2 命中）[A]。⇒ 45 号列出的 **M-1（skipInitialize 对齐）若将来要做，必须作为独立第 5 组 diff（G6）**，不能混进 44 号 G3/G4；**当前 G1–G4 的 CLEAN-APPLY 结论不受影响**（M-1 尚未执行，属 task-24/46 号决断对象）[A/B]。本轮不改此结论，仅登记为「未来 PR 的分组约束」。

### 2.3 决断：**条件-go**（本轮不提交）

**四联标注**：
- **结论**：技术证据充分（10/10 CLEAN-APPLY、7 新文件零冲突、PR#7 冲突已定位），**但对外提交属需用户最终授权**，且须先补齐 17 文件 diff 草案 ⇒ **条件-go**。
- **依据 [B/C/D]**：Issue #8 作者「ok了」但 `state=open`、npm 无 2.8.9、repo 无 push ⇒ 作者修复**未发布**；PR #7 `open` + 0 review + 0 comment ⇒ 上游无合并迹象；49 号 §3 与 45 号 §裁决表均把「对外提交 PR」列为**需用户决定** [B]。
- **代码落点 [A]**：`44-officialize-upstream.md` §2 四组草案（需按 §2.2 第 4 点扩充），`/tmp/dec48/diffs/*.patch`（本轮只读生成，**非交付物、不写入仓库**）。
- **验证方式 [D]**：`patch --dry-run -p1 -d base288` 10/10 CLEAN、`-d base7` 仅 index/provider 冲突；25/25 单测；49 号 §2 真实工具复跑。

### 2.4 若 go：逐组动作（授权后由 Lead 执行，本轮未执行）

| 组 | 动作 | 目标 | 前置 |
| --- | --- | --- | --- |
| **G1**（Issue #8：inject + RemoteResult） | **新开 PR**（或先回复 Issue #8） | `main`=2.8.8 | 与作者「ok了」重叠 → **必须先在 Issue #8 回复询问是否已有本地修复将发 2.8.9**，避免重复 |
| **G2**（PR #7：settings inert + RFC1918） | **PR #7 comment 补充**，不另开 PR | PR #7 head | 44 号 §5.2 文本可直接粘贴；附「我们已验证 + 3 条测试 + ns 精确匹配建议」 |
| **G3**（新 backend firecrawl/tinyfish） | **新开 PR**（可与 G1 合并为一个 PR，或独立） | `main` | 附官方 `keyless.md`/v2.2.5 源码依据；**明确不含** M-1 skipInitialize 对齐（见 G6） |
| **G4**（Host 修复 + UX + 六专家补修） | **新开 PR**（建议拆 3 commit） | `main` | 44 号 §2 G4 草案仍适用（egress-fetch/client/backends 对 2.8.8 均 CLEAN） |
| **G5（新增，本轮识别）**（11-08 六专家采纳项 12 组，7 文件） | **新开 PR 或并入 G1–G4 的对应文件 diff** | `main` | **必须重新生成 17 文件完整 diff**；`namespace.js`/`cache.js`/`health.js`/`history.js`/`settings-api.js`/README/interaction test 全部纳入 |
| **G6（未来，非本轮）**（M-1 skipInitialize 对齐 v2.2.6 `mcp.ts`） | 独立 PR，且证明 4 后端仍成功 | `main` | 依赖 task-24/46 号决断；**不得混入 G3/G4**（Lead 11-08 指示 [A/B]） |
| **2.8.9 询问** | 在 Issue #8 回复中一并问 | Issue #8 | 44 号 §5.3 已含「是否计划发 2.8.9」 |

**≤10 行可粘贴中文文本（Issue #8 回复；合并了「验证结果 + 2.8.9 询问」，44 号 §5.3 修订版）**

```
已在 2.8.4 + DSH 0.2.1-rc.2 复现并验证你给的两处修法，逐字一致：
inject 补 "remote.credentials" 后 set() 返回 object，保存成功；
writeCredential 判 {ok:false} 包络后，服务端拒绝不再显示「已保存」。
另补：readCredential() 也需先判 res.ok===false（否则回落 legacy 拿陈旧值）；
属性访问建议 try/catch 兜底以兼容旧 host。
本机已 25/25 单测 + 真实 web_search 8 Sources（11-08 重启后复跑）。
另在 PR #7 留言补了 ns 精确匹配与 3 条回归测试，未另开重复 PR。
想确认：这个修复是否计划发 2.8.9？当前 npm latest 仍是 2.8.8、repo 最后 push 10-21（11-08 复核）。
我们另有 17 文件本地改进（含 2 个 keyless backend），如你愿意可整理成独立 PR 提交，等你确认后再发。
```

**≤10 行可粘贴中文文本（PR #7 comment；44 号 §5.2 原版，仍适用）**

```
感谢这个修复！我们在 DSH 0.2.1-rc.2 上本地应用了本 PR，确认 settings 保存从「无效果」变为生效（health enabled 4→6）。
补充一处：0.2.x 的 describe() 用 entry.options.id 作 ns（实测为 "dsh-websearch"），
本 PR 主匹配 ns==="unified-search" 在 0.2.x 不命中，全靠 shape fallback 兜底；
建议改成先匹配 "dsh-websearch" 再 NAMESPACE 再 shape（我们已抽 util/namespace.js 共用并验证）。
另附 3 条行为级回归测试（apply() 读 live value / RFC1918 http baseURL / current() 读 describe()），
provider.js 同一正则 {3}→{2} 已在本 PR 内，无需重复提交。
上游 2.8.8 上我们全套补丁 patch --dry-run 10/10 干净应用，本 PR 合并后可直接对齐。
```

### 2.5 若 no-go 的理由（供用户选择「暂不对外」时记录）

1. **授权缺失**：49 号 §3 / 45 号 §裁决表明确「对外提交需用户决定」，本轮无授权 [B]。
2. **上游状态**：Issue #8 `open`、作者「ok了」但未发布、npm 无 2.8.9；PR #7 `open` 0 review 4 天未动 ⇒ 此时提 PR 很可能与作者本机修复重叠或长期无人响应 [B/D]。
3. **草案不完整**：44 号四组 diff 仅 10/17 文件，直接提交会漏 11-08 全部采纳项 [A/D]。
4. **风险可控**：本机 25/25 单测、17/17 一致、真实工具全绿 ⇒ **不提交的代价为零**（补丁在本机已生效），而提交的收益是长期可升级性，可等用户择机决定 [D]。

### 2.6 回滚（对外动作）

- **PR/comment 尚未发出** ⇒ 回滚 = 不执行，零成本 [D]。
- **若已发出**：GitHub PR 可 `close`（不删除 fork 分支）；issue comment 可删除（作者/有权限者）；仓库 `main` **不受影响**（我们未 push 任何 commit）[E]。
- **本地 diff 草案**：`/tmp/dec48/diffs/*.patch` 为临时只读产物，删除即可 [D]。

---

## 3. 按优先级总建议（结论 → 依据 → 代码落点 → 验证）

| 优先级 | 建议 | 依据 | 代码落点 | 验证 |
| --- | --- | --- | --- | --- |
| **P0（本轮唯一可立即做、零风险）** | 用 §1.4 第 1 步的 `md5sum -c` 把 17/17 基线固化到 45/49 号裁决表，并在 REPORT/99 把「10 文件」口径全部改成「17 文件」 | [A/D] 本轮实测 17/17 MATCH；44/45 号仍写 10 文件，属文档债 | 45/49/REPORT/99（**本轮未改，仅建议**） | `md5sum -c` 17/17 OK |
| **P1（需用户授权）** | 若要求「换机自动恢复」→ 按 §1.4 落地 patch-package（17 文件版）；若只要求「本机别丢」→ **维持现状 + 基线文件**即可，无需任何动作 | [A/C/D] pin 2.8.4 无 `^` = 零动作稳态 | `profile/package.json`、`patches/` | §1.4 第 3/4 步 |
| **P1（需用户授权）** | 对外提交：先补齐 17 文件 diff（G5），再按 §2.4 逐组动作；G2 走 PR#7 comment；在 Issue #8 回复验证结果并问 2.8.9 | [A/B/D] 10/10 CLEAN、7 新文件 404、PR#7 冲突定位 | 44 号 §2 草案需扩充 | dry-run + 25/25 + 真实工具 |
| **P2** | 把「M-1 skipInitialize 对齐 v2.2.6 `mcp.ts`」登记为未来独立 G6，禁止混入 G3/G4 | [A/B] Lead 11-08 A 级证据 + 本轮独立复核 | 46 号（task-24）决断对象 | v2.2.6 `mcp.ts:43-50` raw 200 |
| **P2** | 升级门槛维持 44 号 §4.1「不升级」结论（Node v22.20.0 < 0.2.2-rc.1 要求的 ≥24.9.0） | [C/D] registry engines + `node -v` | — | 45 号 §裁决表已「采纳不升级」 |

---

## 4. A/B/C/D/E 与永久链接索引

| 用途 | 链接 / 路径 | 等级 |
| --- | --- | --- |
| Issue #8 状态与作者回复 | [`issues/8`](https://github.com/240xu/dsh-websearch/issues/8)（2026-11-08 17:14，open、2 评论） | B/D |
| PR #7 状态与冲突源码 | [`pulls/7`](https://github.com/240xu/dsh-websearch/pulls/7)、[`blob/bcb24b1efbb4/lib/index.js#L422-L438`](https://github.com/240xu/dsh-websearch/blob/bcb24b1efbb4/lib/index.js#L422-L438)、[`blob/bcb24b1efbb4/lib/provider.js#L327`](https://github.com/240xu/dsh-websearch/blob/bcb24b1efbb4/lib/provider.js#L327) | A/B/D |
| 2.8.8 仍缺 inject / 仍删 Host | [`blob/main/lib/client.js#L649`](https://github.com/240xu/dsh-websearch/blob/main/lib/client.js#L649)、[`blob/main/lib/util/egress-fetch.js#L404`](https://github.com/240xu/dsh-websearch/blob/main/lib/util/egress-fetch.js#L404) | A |
| 官方 v2.2.6 `mcp.ts`（仅 tools/call） | [`blob/v2.2.6/packages/core/src/plugin/websearch/mcp.ts#L43-L50`](https://github.com/anomalyco/opencode/blob/v2.2.6/packages/core/src/plugin/websearch/mcp.ts#L43-L50) | A |
| 官方 DSH 升级门槛 | [`v0.2.2-alpha.2/web-search-default-provider/guide.md`](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/upgrade-guide/v0.2.2-alpha.2/web-search-default-provider/guide.md)、[`…/web-search-credential-modes/guide.md`](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/upgrade-guide/v0.2.2-alpha.2/web-search-credential-modes/guide.md) | B |
| 17 文件基线 | `.baseline-20261108-0922/PLUGIN_CHECKSUMS.txt`（35 行，17/17 MATCH 实测） | D |
| 本机权威源码 | `~/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/`（40 文件）、`src-work/plugin/` | A |
| 前序交付/裁决 | [44 号 §4.2](44-officialize-upstream.md)、[45 号 §裁决表](45-reform-verdicts-SKELETON.md) `:106-110,166-180`、[49 号 §1–3](49-restart-evidence.md)、[25 §14](25-execution-log.md) | A/B/D |
| 本轮临时取证（非交付） | `/tmp/dec48/`：`284.tgz`(npm 2.8.4 原文)、`package/`(解包)、`up288/`、`base288/`、`base7/`、`diffs/*.patch`、`mcp226.ts`、`{exa,parallel,firecrawl,tinyfish}.ts` | D |

**仍 E（不得当结论）**：① patch-package 能否完整捕获 7 个新增文件 + README（未执行 `pnpm add`，需 §1.4 第 3 步 `grep -c` 实证）；② pnpm `postinstall` 在 `nodeLinker: hoisted` 根包是否触发（P2）；③ `file:` 依赖方案 B 的 `dsh.bundle` 元数据是否被 profile 识别；④ 作者「ok了」对应的本地提交内容（未推公开 ref）；⑤ 2.8.9 是否会发（Issue #8 回复后才知道）；⑥ npmmirror 与 npmjs 的 2.8.4 tarball 逐字节一致性（lockfile `integrity` 可比对，未实跑）；⑦ 对外 PR 提交后作者的响应与合并时点。

---

## 5. 时效复核

2026-11-08 17:14 认证 API + registry 复核（§2.1）：Issue #8 `open`/2 评论、PR #7 `open`/`mergeable`/0 review、npm `latest=2.8.8`/23 版本/**无 2.8.9**、repo `pushed_at=2026-10-21`。与 11-07 21:59 采样**完全一致** ⇒ 两项决断的前提未漂移 [C/D]。

---

*报告完。唯一写文件为本报告；全程只读，未改源码/配置/其它报告/运行时，未执行 install/升级/重启/提交 PR，未操作任务板，token 值未出现在任何输出。两项决断均为「条件-go + 需用户最终授权」，并各给完整命令、风险、回滚与零依赖备选。*
