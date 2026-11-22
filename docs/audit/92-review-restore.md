# R1 复审报告：2.8.4 + 补丁恢复完整性

> 复审专家 R1（独立证伪「2026-11-22 恢复完整/正确/无遗漏」）
> 时间：2026-11-22T20:30+08:00 · 只读核查，未改源码/配置/运行时/其它报告，未重启服务
> 结论：**恢复本身 A 级完整（48/48 文件、35/35 逐字节、81/81 测试）**；
> 但**存在 P0 隐患**：当前 lockfile 与 package.json 矛盾，任何 `pnpm install --no-frozen-lockfile` 或 `pnpm add` 会**把补丁树整体洗回干净 2.8.4**（已实测复现）。

---

## 0. 核查基线（三条独立路径交叉验证）

| 路径 | 命令 | 输出 |
| --- | --- | --- |
| 安装副本 | `grep -o '"version": "[^"]*"' …/dsh-websearch/package.json` | `"version": "2.8.4"` |
| 安装副本文件数 | `find … -path '*/.git' -prune -o -type f -print \| wc -l` | `48` |
| base 树 = 真 npm tarball？ | `npm pack @240xu/dsh-websearch@2.8.4` → `diff -rq package publish-work/base/package` | **无输出**（逐字节一致，33 文件，shasum `acde6d443a…`） |
| base 树 hash | `git -C publish-work/repo rev-parse d2602823^{tree}` vs 本地 base commit | 两侧均 `99d756cb0b93b3d3dedbf4753133e5dec8339d1f` |

⇒ **base 不是「某人以为的 2.8.4」，是真 registry tarball**。这是整个恢复链的地基。

---

## 1. 逐条裁决表

### 1.1 必做①：版本 / 35 文件一致性 / 4 个独有文件

| # | 命题 | 裁决 | 命令 | 输出（摘要） |
| --- | --- | --- | --- | --- |
| 1.1 | 安装副本版本是 2.8.4 | **成立** | `grep version package.json` | `"version": "2.8.4"` |
| 1.2 | 与 `src-work/plugin` 35 文件逐字节一致 | **成立** | 循环 `cmp -s` 35 项 | `SRC: 35/35 byte-identical, bad=0` |
| 1.3 | 与 `src-work/plugin` **全树**一致（不止 35） | **成立** | `diff -rq --exclude=.git INST SRC` | 仅 `examples/.gitignore/LICENSE` 只在 INST（src-work 未收），`test-node_modules` 只在 SRC。**共享 45 文件 md5 全同，diff=0** |
| 1.4 | 4 个本地独有文件真的在 | **成立** | `ls`+`md5sum` | `web-error.js`(49行) `namespace.js`(28) `firecrawl.js`(127) `tinyfish.js`(123)，另 `failure-label.js`(60) 也在；5 者在 base 树**均不存在** |
| 1.5 | 独立重建 g5 能还原同一棵树 | **成立（最强）** | 在真 tarball 上 `git apply --check` → `git apply` → 全树 `diff -rq` | `APPLY-CHECK: OK / APPLY: OK`；重建树 vs INST：**48 文件 diff -rq 完全空输出，exit=0** |
| 1.6 | g5 两副本一致且已提交 | **成立** | `md5sum` ×2 + `git diff d2602823 HEAD \| md5sum` | 三方均 `0491d5af7d671e7cfbcb3efd0a202bc3`；`37 segments` |
| 1.7 | g5/README 声称「37 段」准确 | **成立（段数）** | `grep -c '^diff --git'` | `37`；但 README 写「3983 行」实际 `4024 行`（**行数过期，见 1.8**） |

### 1.2 必做②：缺陷标志位逐条核对（**10/10 全在，无一条缺失**）

| 缺陷 | 标志 | 裁决 | 位置 | 反例检查 |
| --- | --- | --- | --- | --- |
| N1 413→`req.destroy` | `req.resume()` | **在** | `settings-api.js:271` | `grep 'req.destroy()' lib/` → **0 命中**；base 2.8.4 此段**无 resume、无 removeAllListeners("end")** |
| N4 sessionCache 纯 URL 键 | `sessionCacheKey` | **在** | `mcp-client.js:19,35,167` | base 是 `sessionCache.get(url)` / `.set(url,…)` 纯 URL |
| N3 MCP id 撞号 | `skipInitialize ? 2 : 3` | **在** | `mcp-client.js:195` | `grep 'skipInitialize ? 1 : 2'` → **0** |
| N2 缓存键漏后端级设置 | `resultOptions[\`${id}.${k}\`]` | **在** | `provider.js:264` | base `grep -c resultOptions` → **0** |
| A.6 effect 泄漏 | `webCtx.effect` | **在** | `index.js:533` | 且含 `for (const dispose of disposers.reverse())` 逆序回滚重抛 |
| A.7 `createLimiter(0)` 挂起 | `maxRunning` | **在** | `provider.js:97,107` | base 是 `while (running < concurrency …)`（0 时永久排队） |
| D8 可观测字段 | `requestedMaxResults` | **在** | `health.js:86` | — |
| D8 | `keylessRejected` | **在** | `health.js:69`, `history.js:118`, `provider.js:76,421`, `failure-label.js:10-14` | — |
| D8 | `cooledUntilMs` | **在** | `health.js:70`, `history.js:116` | — |
| 结构化错误契约 | `webErrorFromResponse` **11 处 throw** | **在，精确 11** | 10 文件：mcp-client×2、searxng×2、openai、tavily、serper、ddg、brave、mojeek、anthropic-like 各 1 | `grep -rn 'throw webErrorFromResponse' \| wc -l` → **11**；与 57 号审计口径「11 处/10 文件」完全吻合 |
| A.8 冷却窗口误报 | `(expired during search)` | **在** | `provider.js:523` | — |
| save() 快照 | 快照在 `await` 前 | **在** | `client.js:466-475`（`savedFieldRefs.set` 先于任何 `await`）、`508-510`（`savedKeyRefs` 同理）+ 身份比较 `this.staged.get(f) === savedFieldRefs.get(f)` | 已读 `save()` 全文，注释与实现一致 |

> 附加：`host: headers.host ?? target.host` 在两处 transport（`egress-fetch.js:187` CONNECT / `:213` proxy）均在，`delete headers["host"]` 仍在但被两处还原 —— **这正是 2.8.8 HTTP 403 的差异点**（2.8.8 同段 `delete` 后**无任何还原**，已逐行对比）。

### 1.3 必做③：测试裁决

| 命题 | 裁决 | 命令 | 输出 |
| --- | --- | --- | --- |
| `src-work/plugin` 应 81/81 | **成立** | `node --test tests/*.test.js` | `tests 81 / pass 81 / fail 0`（1732ms） |
| 安装目录跑测试会失败 | **成立** | `node --test tests/*.test.js`（在 INST） | `tests 55 / pass 45 / fail 10`；3 个文件整挂 + interaction 2 条挂 |
| 失败原因是缺 `@deepseek-ai/dsh-web` symlink | **成立（精确）** | 报错原文 | `ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/dsh-web' imported from …/lib/util/mcp-client.js`；`ls INST/node_modules` → **不存在** |
| 补齐 symlink 后应 81/81 | **成立** | 在 `/tmp` 副本 `ln -sfn /opt/dsh-0222/node_modules/@deepseek-ai/{6 包}` 后跑 | `tests 81 / pass 81 / fail 0` |
| 只影响测试、不影响运行时 | **成立** | loader 用 `createRequire`+`resolve.mjs`；且本会话 `web_search` 真实返回 8 Sources | 见 1.4 |

⇒ **「已知限制、不算缺陷」的判断正确**。补充一条 Lead 没说的：`src-work/plugin/test-node_modules/` 里 6 个 symlink **全部 DANGLING**（指向已不存在的 `/usr/local/lib/node_modules/@deepseek-ai/dsh/…`），`node_modules/` 里 6 个指向 `/opt/dsh-0222` **全部有效** —— 跑测试走的是后者，所以 81/81 能过。`relink-test-deps.sh` 的推导逻辑我干跑验证过（MainPID 249906 → `BIN=/opt/dsh-0222/…/bin.js` → 6 包全 `OK`），脚本本身可用。

### 1.4 活体证据（证明跑的就是补丁树，非 2.8.8、非 clean 2.8.4）

本会话 `web_search` 实际输出（两次查询）：

```
[websearch backends] searxng ✗5064ms (SearXNG: invalid JSON response) · parallel ✓5241ms/8
· firecrawl ✗5236ms (firecrawl returned an MCP error: Anonymo) · ddg ✓5684ms/8
· tinyfish ✓5763ms/8 · exa ⏸cooled 43151s
```

| 字符串 | clean 2.8.4 命中 | 安装副本命中 | 2.8.8 是否有 |
| --- | --- | --- | --- |
| `firecrawl` | **0** | 32 | 有（但 2.8.8 backends 目录**只有 10 个文件，无 firecrawl.js**） |
| `tinyfish` | **0** | 28 | 同上，无 tinyfish.js |
| `Anonymo` | **0** | 2 | — |
| `webErrorFromResponse` | **0** | 25 | — |

⇒ 这行遥测**只能由 2.8.4+补丁树**产出（clean 2.8.4 无 firecrawl/tinyfish 后端，2.8.8 无这两个 backend 文件）。**这是比日志更硬的运行时证据**——`/home/ova/re-agent/dsh-web.log` 只有 3 行、无插件加载日志。

另：`ps -p 249906 -o lstart` → `Sun Nov 22 19:31:41 2026`；`stat lib/index.js` → `19:29:40` ⇒ **重启晚于文件落盘 2 分钟，顺序正确**；`systemctl show MainPID` → `249906` 匹配。`GET /` → `401`（鉴权正常）。

---

## 2. 遗漏清单（我们写过但**没被 g5 patch 覆盖**的东西）

| # | 项 | 在哪 | 在 g5 patch 里？ | 在 git 里？ | 影响 | 级 |
| --- | --- | --- | --- | --- | --- | --- |
| M1 | `.gitignore`（`node_modules/`） | 安装副本已有 | **在**（patch 第 1 段） | 在 repo | 无 | — |
| M2 | `tests/relink-test-deps.sh` | 安装副本已有 | **在**（patch 第 36 段） | 在 repo | 无 | — |
| M3 | **`g5/refresh.sh` 的 MOD 门禁只列 35 项，不含 M1/M2** | `g5/refresh.sh` | — | 在 repo | **这两项丢失时 refresh 仍打印 "35/35 byte-identical" 绿灯 → 假绿** | **P1（自验证失效）** |
| M4 | `g5/refresh.sh`、`g5/README.md`、`g5/archive/*.patch`（4 份） | artifacts + repo | **不在**（设计如此） | 在 repo | 无（脚手架，不该进 npm 包） | — |
| M5 | **`src-work/backups/`（63 文件 / 660K，含 `*.orig` 真 2.8.4 原件 + `profile-package.json.orig`、`profile-cordis.patch.yml.orig`）** | artifacts 工作区 | **不在** | **不在**（`publish-work/repo` `git ls-files src-work` = 0；DSH 仓库 `.gitignore:40` ignore `.artifacts/`） | **单点：artifacts 树一丢，回滚基线永久消失** | **P1** |
| M6 | `docs/audit/`（95 份审计谱系） | `publish-work/repo/docs/audit` | **不在**（`git diff d2602823 HEAD -- lib tests README.md package.json .gitignore` 不含 docs） | 在 repo（95/95 tracked） | 安装副本无 `docs/`（**与上游 tarball 一致**，非缺陷） | — |
| M7 | profile 级 `cordis.patch.yml`（`numResults:8` + `enableFirecrawl/Tinyfish:true`） | `/home/dsh/.dsh/profiles/web/` | **不在**（不在 `node_modules`，rsync 不覆盖） | 不在 | 本次**活着**，但**没有任何清单把它列为「必须重建的一层」** | P2 |
| M8 | `/etc/systemd/system/dsh-web.service.d/10-websearch-lead-fix.conf`（`DSH_WEB_FETCH_PROVIDER=http` + HTTP(S)_PROXY） | systemd | **不在** | 不在 | 同上；**这是 P0①（WEB_PROVIDER_AMBIGUOUS）的唯一载体**，仅 root 可重建 | **P1** |
| M9 | README 新增章节（`Adding a backend`）与 description 13 后端 | 安装副本已有 | **在** | 在 repo | 无 | — |
| M10 | `CHANGELOG.md`（package.json description 引用它） | **任何树都没有** | — | — | 真 npm tarball 也无 | **非恢复遗漏** |

**结论**：源码/测试/文档**零遗漏**；遗漏全在**包外脚手架与宿主层**（M5/M7/M8），且它们都不在任何 git。

---

## 3. 隐患清单（含 P0）

### 3.1 **P0：当前 lockfile 与 package.json 矛盾，下一次 pnpm 操作会洗掉整棵补丁树**

四方不一致（`stat` 全部核过）：

| 位置 | websearch 解析 |
| --- | --- |
| `profile/package.json` | `"@240xu/dsh-websearch": "2.8.4"`（精确 pin） |
| `profile/pnpm-lock.yaml`（19:41） | `specifier: 2.8.4` → **`version: 2.8.8(@deepseek-ai/schemastery@3.19.0)`**；`packages:` 段只有 `@240xu/dsh-websearch@2.8.8`，**2.8.4 条目 grep 计数 0** |
| `profile/node_modules/.pnpm/lock.yaml` | `specifier: 2.8.8` / `version: 2.8.8` |
| `profile/node_modules/.modules.yaml` | `"@240xu/dsh-websearch@2.8.8(@deepseek-ai/schemastery@3.19.0)"` |
| **实际安装** | **2.8.4 + 补丁（48 文件）** |

**实测证据（4 个隔离 fixture，未碰 profile）**：

| 实验 | 命令 | 结果 |
| --- | --- | --- |
| A. `--frozen-lockfile` 在真实 lock 上 | `pnpm install --frozen-lockfile`（profile 副本） | **`ERR_PNPM_OUTDATED_LOCKFILE` + `version "2.8.8" doesn't satisfy range "2.8.4"`，退出码 1** ⇒ **不覆盖，反而挡住** |
| B. `--no-frozen-lockfile` | `pnpm install --no-frozen-lockfile`（真实 package.json+lock+已补丁目录） | `WEB-ERROR WIPED` / `req.resume GONE` / `tests` 消失 / `.git` 消失 / 文件数 48→**33** |
| C. `pnpm add <别的包>`（= `plugin_manager install_bundle` 正常路径） | 同上前置 + `pnpm add file:/tmp/r1-dummy2 --save-exact` | `WEB-ERROR WIPED` / `req.resume GONE`（**连带重装，不是只装新包**） |
| D. `.modules.yaml` 漂移（声称 2.8.8 / lock 2.8.4） | `pnpm install --frozen-lockfile` | `Already up to date`，sentinel **SURVIVED**（不触发重装） |
| E. spec 改 `^2.8.4` | `--frozen-lockfile` | 报 specifier mismatch，**但 sentinel 存活**（不写盘） |
| F. 修好 lock（`--lockfile-only`）后 | `pnpm install --frozen-lockfile` | `Already up to date`，sentinel **SURVIVED** ⇒ **lock 自愈后 install 是安全的** |

**谁会踩**：
1. `plugin_manager` 正常安装路径 `runPnpm(["add", installSpec, …])`（`dsh-plugin-manager/lib/index.js:2986`）**不带 frozen** ⇒ **任何人在 GUI 装/升任何插件都会连带洗掉 websearch 补丁**（实测 C）。
2. 人手工 `pnpm install`（不带 `--frozen-lockfile`）⇒ 洗掉（实测 B）。
3. `dsh plugin --profile web install`（默认 frozen）⇒ **当前会直接失败退出**，不会洗 —— **纯属运气**。
4. 服务重启 / `dsh` 启动**不触发 pnpm**（`dsh-app-boot` 无 install 调用，`dsh-web-run-native.sh` 无 pnpm）⇒ 重启安全。

**净损失**：48 → 33 文件；`tests/`(9) + `.gitignore` + 5 个补丁独有 lib 文件全消失；22 个 M 文件内容回退；`exa/firecrawl/tinyfish` 后端消失（`firecrawl`/`tinyfish` 关键字在 clean 2.8.4 计数 0）；profile 的 `enableFirecrawl/enableTinyfish` 变**静默无效**（实测 schemastery 对未知键是**透传不报错**：`clean unknown-keys: {"numResults":8,"enableFirecrawl":true,"enableTinyfish":true}`）⇒ **不是 fail-loud，是静默降级**（更危险，因为没人会发现）。

**最小修复路径（未执行，交 Lead）**：任选其一
- (a) `cd profile && pnpm install --lockfile-only --no-frozen-lockfile`（实测把 lock 自愈为 `2.8.4`，**不写 node_modules、不碰补丁目录**）→ 之后 `--frozen-lockfile` 变成 no-op（实测 F）；
- (b) 手工把 `pnpm-lock.yaml` importer 的 `version:` 改成 `2.8.4` 并补 `packages: '@240xu/dsh-websearch@2.8.4'` 条目（integrity 用 npm tarball 的 `sha512-sGb8/kyqsuNjT…nleOzPqeL5zIg==`）；
- (c) 把 websearch 从 profile 依赖里去掉，改走「预置目录 + rsync」不归 pnpm 管（治本，但破坏 bundle 语义）。

⚠️ **双刃**：修好 lock 后**普通 install 就变成真安全**，但也**失去了现在那个「frozen 直接报错挡住」的意外保护**。修 lock **必须同时**把「重打补丁」写成一键脚本，否则等于拆掉护栏。

### 3.2 P1：`DSH_EGRESS_FORWARDER` 硬编码在启动脚本，指向无监听端口

- `/usr/local/sbin/dsh-web-run-native.sh:12` → `export DSH_EGRESS_FORWARDER=http://172.30.0.1:13070/fwd`
- `ss -ltnp | grep 13070` → **`NO-LISTENER-13070`**
- 进程 environ 确认该变量**仍在**（`tr '\0' '\n' < /proc/249906/environ`）
- **当前无害**：补丁树里 `grep -rn 'DSH_EGRESS_FORWARDER\|13070\|/fwd' lib/` → **0 命中**（2.8.4 完全不读）
- **定时炸弹**：任何人把版本升到 ≥2.8.8（或未来版本读该变量）⇒ 立刻回到 `all enabled backends failed (4)` / `forwarder unreachable ECONNREFUSED`。**注释里没有任何「本机无 sidecar，勿升级」的护栏**。

### 3.3 P1：`refresh.sh` 门禁假绿

`MOD="…"` 精确 35 项；`has .gitignore: False` / `has relink: False`。patch 有 37 段。
⇒ 若 `.gitignore` 或 `relink-test-deps.sh` 丢失，`refresh.sh` **仍打印 `35/35 byte-identical` 并 exit 0**。自验证脚本对它自己声称覆盖的两项无覆盖。

### 3.4 P1：单点存储

- `g5/G5-authoritative.patch` + `src-work/backups/*.orig` 都在 `/home/ova/dsh/.artifacts/`，被 DSH 仓库 `.gitignore:40`（`.artifacts/`）排除，`git ls-files .artifacts` = **0**
- `publish-work/repo` 是独立 git，`g5/*` 与 `docs/audit/*` 已提交（`HEAD:g5/G5-authoritative.patch` blob `a5bc5599…` == 工作区 `git hash-object`，**可从 git 恢复**）
- 但 **`src-work/backups/` 63 文件不在任何 git**，且 `.orig` 是「干净 2.8.4 原件」的**唯一**独立基线（我逐个 `cmp` 验证：18/23 与真 tarball **逐字节相同**，另 5 个是 profile/cordis/README/package 的旁支备份）

### 3.5 P2：README 过度承诺（内容缺陷，非恢复缺陷）

`README.md:36-44` 声称 `webErrorFromResponse()` 会挂 `… rateLimited, quota and keylessRejected`。
实测 `web-error.js` 只挂 4 个：`status` / `retryAfter` / `rateLimited` / `quota`（`sed` 全文核过，**无 `keylessRejected`**）。
真正的 keyless 分类靠 `failure-label.js:13` 的 `/Anonymous keyless access is unavailable|keyless access is unavailable/i` 正则（legacy 路径）。
⇒ 恢复**忠实于 src-work**（src-work 同样如此），但恢复出来的是「带文档缺陷的完整树」。

### 3.6 P2：README 测试数过期

`README.md:251,264` 写 `73/73`；实测 **81/81**。`src-work/plugin/README.md` 同样 73/73 ⇒ **历轮遗留，非本次恢复引入**（`diff` 确认该段在 patch 内、内容与 src-work 逐字节一致）。同段落已自注「〔历史快照；当前口径见上〕」，但「上」也是 73。

### 3.7 已排除的伪隐患

| 疑点 | 裁决 | 证据 |
| --- | --- | --- |
| 「安装副本 `.git` 是污染」 | **反而是保险** | `.git` HEAD tree `99d756c` == clean 2.8.4 tree；`git status` = 22 M + 7 ??；`git diff HEAD --binary` = **109890 bytes** ⇒ 可自恢复。**但 pnpm install 会把 `.git` 一起删掉（实测）** ⇒ 破坏场景下保险失效 |
| 08:54 破坏是 cron 干的 | **本机 cron 无嫌疑** | `grep 'profiles\|dsh\|websearch\|pnpm\|npm' /etc/cron.d/*` → **0 命中**；`crontab -l`（dsh）仅 3 行 header、**无 nightly marker**；nightly 插件已于 **11-22 16:56 封存**（`ARCHIVE-TAG.txt`）且无 systemd unit/timer |
| `pnpm-lock` 19:41 被谁改 | **未定**（`package.json` 19:40、lock 19:41，晚于恢复 19:29/19:31） | 见「无法验证」 |
| `exa ⏸cooled 43151s` 是 bug | **不是**，是真实 Retry-After | `MAX_RETRY_AFTER_MS = 86400_000ms(24h)`，43151s≈12h 在上限内且非默认 60s ⇒ 来自上游 header |
| `test-node_modules` 6 个 symlink DANGLING | **不影响** | 跑测试走 `node_modules/`（指向 `/opt/dsh-0222`，6 个全 OK） |

---

## 4. 已确认无误（无需再动）

1. 地基：base = 真 npm 2.8.4 tarball（33 文件，`diff -rq` 空），tree hash 与 repo 基线 commit 一致。
2. 重建：`git apply --check` + `git apply` 均 OK，重建树 vs 安装副本 **48/48 全树 diff -rq 空**、35/35 逐字节；g5 三方副本 md5 一致且与 `git diff d2602823 HEAD` 自洽。
3. 代码：10 条缺陷标志位 **全在**，反例标志位（`req.destroy()`、`skipInitialize ? 1 : 2`）**全 0**；`webErrorFromResponse` **精确 11 处/10 文件**。
4. 测试：src-work **81/81**；安装目录失败**仅因缺 1 个 symlink**，补齐后 **81/81** ⇒ 「已知限制」判断正确。
5. 运行时：live 遥测含 `firecrawl`/`tinyfish`/`Anonymo`，三者 clean 2.8.4 计数**全 0**，2.8.8 又无这 2 个 backend 文件 ⇒ **唯一指向补丁树**；进程重启（19:31:41）晚于落盘（19:29:40）。
6. 保护层：`DSH_WEB_FETCH_PROVIDER=http`（drop-in）+ `HTTP(S)_PROXY` 均仍在 environ；`numResults:8`/`enableFirecrawl`/`enableTinyfish` 在 profile patch 里且补丁树**有对应 Config 键**（13 个 enable*）。
7. 该恢复**没有**引入任何「2.8.8 残留」（`FORWARDER`/`normalizeHeaders` 无还原/缺 firecrawl 等 2.8.8 特征一个都不在）。

---

## 5. 无法验证（如实列出）

| # | 项 | 为什么 | 需要什么 |
| --- | --- | --- | --- |
| V1 | 08:54 前的 profile pin 原值 | `package.json.bak-rmnightly-20261122T122854` 是 `-rw------- root:root`，dsh 无免密 sudo（`sudo -n` 被拒：`Sorry dsh`）。且**文件名 `T122854` 与 mtime `09:31:45` 不同源** | root 读该文件 |
| V2 | 08:54 破坏的**执行者** | cron/crontab/timer 全无命中；nightly 已封存；`plugin_manager` 日志（`operation-*/pnpm.log`）最早只到 12:29 之前几条且无 websearch | root audit / shell history / journal |
| V3 | `pnpm-lock.yaml` 19:41 与 `package.json` 19:40 是谁写的 | 无 shell history、无 `plugin_manager` 对应 operation 记录 | root audit |
| V4 | `web_fetch` 真 200 / `web_search` 8 Sources 的**独立复现** | 我未调用 LLM 侧工具（`web_fetch` 走模型侧）；`/api/websearch/history`、`/api/unified-search/health` 均 **401** `{"ok":false,"error":"untrusted request"}`（admission fence 拒了我的 token，正确行为） | 会话工具调用 |
| V5 | 插件加载日志 | `/home/ova/re-agent/dsh-web.log` 只有 3 行（purge 警告 / inspector / URL），**无插件行**；`.prev` 无 websearch 行 | 加日志或 `--dump-config` |
| V6 | `g5/README` 声称「3983 行」 | 实际 4024 行；无法确认哪个是当时口径 | 报告作者 |

> 另需披露：核查中我执行过 `git status`（只读），它刷新了 `INST/.git/index` 的 stat cache（mtime → 19:38）。**未改任何被跟踪或工作区文件内容**（`git hash-object` 与 HEAD blob 仍一致）。

---

## 6. 五条反直觉

1. **当前 lockfile 的矛盾反而是唯一护栏**：`--frozen-lockfile` 因「2.8.8 不满足 2.8.4」**硬退出 1**，挡住了覆盖。而「修好 lock」会让普通 install 变安全 —— 但同时也**拆掉这道意外护栏**。所以**修 lock 必须与「一键重打补丁」同一个动作落地**，分开做等于把刹车换成油门。

2. **`pnpm install` 是主凶，`pnpm add` 只是帮凶**：实测两者都洗掉补丁（48→33）；但 `plugin_manager` 的**正常**路径（`:2986 pnpm add`）**不带 frozen**，而**失败恢复**路径（`:895`，lockfile 存在时）才带 `--frozen-lockfile`。⇒ **「装插件」比「修插件」更危险**，与直觉相反。

3. **安装副本自带 `.git` 是保险，且保险恰好在最需要它时消失**：`pnpm install` 会把 `.git` 和 `tests/` 一起删（实测 `GONE .git`）。所以「坏了就 `git checkout`」在 pnpm 破坏场景下**不可用** —— 真正需要它的那一刻它已经被删了。

4. **`refresh.sh` 打印「35/35 byte-identical」时，`.gitignore` 和 `relink-test-deps.sh` 可以同时不在**：MOD 列表 35 项 / patch 37 段。**绿灯的语义比字面窄**，而这两个恰恰是最容易被「复制 lib 目录」式恢复忘掉的。

5. **README 把 `keylessRejected` 列为 `webErrorFromResponse` 的字段，代码里根本没有**：恢复是「忠实」的 —— 忠实复现了 src-work 的文档缺陷。**「与 src-work 逐字节一致」证明的是「没漏」，不是「对」**。

---

## 7. A/B/C/D/E 分级裁决

### A — 已核实成立（有命令+输出，可复现）

- 版本 2.8.4、48 文件、base=真 tarball、35/35 逐字节、48/48 全树、g5 `apply --check` OK
- 5 个本地独有文件全在（含 Lead 未列的 `failure-label.js`）
- 10 条缺陷标志位全在 + 3 条反例标志位全 0 + `webErrorFromResponse` 精确 11 处
- `src-work` 81/81；安装目录失败=缺 symlink，补齐 81/81
- live 遥测三字符串在 clean 2.8.4 计数 0 ⇒ 运行时确在跑补丁树
- `DSH_WEB_FETCH_PROVIDER=http` + proxy 仍在；profile patch 与补丁 Config 键对齐

### B — 成立但口径偏差（内容层面，非恢复遗漏）

- README `73/73` 实为 `81/81`（历轮遗留）
- README 声称 `webErrorFromResponse` 挂 `keylessRejected`，实际不挂（`web-error.js` 仅 4 字段）
- `g5/README` 声称「3983 行」，实 4024 行
- `g5/refresh.sh` MOD 门禁 35 项 vs patch 37 段（自验证覆盖窄于其声称）

### C — 遗漏（均**在包外**，不影响运行，影响可维护/可回滚）

- `src-work/backups/` 63 文件（含唯一 `.orig` 基线）**不在任何 git**
- profile `cordis.patch.yml` 与 systemd drop-in **未被任何清单列为「必重建层」**
- `docs/audit/` 95 份不在安装副本（**设计如此，非缺陷**）
- `CHANGELOG.md` 缺失（**上游 tarball 也无，非恢复遗漏**）

### D — 隐患（按严重度）

| 级 | 隐患 | 触发概率 | 后果 |
| --- | --- | --- | --- |
| **P0** | lock(2.8.8) vs package.json(2.8.4) 矛盾 → 任何 `pnpm install --no-frozen-lockfile` / `pnpm add` 洗回 33 文件 | **高**（GUI 装任何插件即触发，实测复现） | 35 文件补丁 + tests + `.git` 全丢；exa/firecrawl/tinyfish 消失；`enableFirecrawl/Tinyfish` **静默失效**（schemastery 透传未知键，不 fail-loud） |
| **P1** | `DSH_EGRESS_FORWARDER=…13070/fwd` 硬编码且端口无监听 | 中（一旦升版） | 立刻 `all enabled backends failed (4)`；无任何「勿升级」护栏注释 |
| **P1** | `refresh.sh` 门禁 35 项，漏 `.gitignore`/`relink` | 中 | 丢失这两项时自验证假绿 |
| **P1** | `backups/` 与 `g5/` 在 `.artifacts/`（被 gitignore），`backups` 无任何 git | 低-中 | 回滚基线永久丢失，无法重建「干净 2.8.4 原件」对照 |
| **P1** | systemd drop-in（P0① 唯一载体）仅 root 可建，不在任何清单 | 低 | 机器重装/迁移后 `web_fetch` 直接 `WEB_PROVIDER_AMBIGUOUS` |
| P2 | README 测试数/keylessRejected 口径 | — | 误导后人 |

### E — 无法验证

- bak 文件内容（root 600，无 sudo）
- 08:54 破坏执行者 / lock 19:41 写入者
- `web_fetch` 200 与 8 Sources 的独立复现（health/history API 均正确 401）
- 插件加载日志（日志无插件行）

---

## 8. 一句话裁决

**「2026-11-22 的恢复是完整、正确、无遗漏的」——就「装进 node_modules 的那棵树」而言，成立且强于 Lead 的自述（48/48 全树、活体遥测三重独立证据）。**
**但「恢复后的系统是安全的」不成立**：P0 隐患已实测复现——**lockfile 里留着 2.8.8 的解析，下一次任何非 frozen 的 pnpm 操作（含 GUI 装任何插件）会把 35 文件补丁整体洗回干净 2.8.4，而 profile 里的 `enableFirecrawl/enableTinyfish` 会静默失效、无人察觉。**
