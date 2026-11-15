# 74 · 工程落地与上游对接评估（E2 骨架 + Lead 取证补完 + E2 第二轮实测修订）

> 评估专家 E2 落盘 39 行骨架（14:40 左右）后继续取证，并发出两条推翻旧口径的实测；由 Lead 逐条独立复核、合并成终版（2026-11-15 14:45）。
> **唯一写文件**；不改源码/配置/运行时/其它报告；不 git commit/push、不 npm publish、不改 profile。token 值未入任何文件/输出。

## A. patch-package 落地评估

| 项 | 实测 |
| --- | --- |
| profile `package.json` 的 postinstall / patch-package 钩子 | 未见 |
| node_modules 里 patch-package | 未安装 |
| 裁决 | **NO-GO（维持需用户决定）**：当前「精确 pin 2.8.4 + 逐字节同步 + 26 备份 + 25 §6 回滚链」是零动作稳态；patch-package 需额外依赖与 postinstall，且 `plugin_manager install_bundle` 重装会覆盖补丁目录 |

若做，最小步骤：把 [g5/G5-full-35files.patch](../g5/G5-full-35files.patch) 放进 `patches/`，profile `package.json` 加 `"postinstall": "patch-package"`，安装 `patch-package`，**再用 `plugin_manager install_bundle` 重装一次验证补丁是否存活**（这一步才是验收，没做之前不能宣称可用）。

## B. G5 完整 35 文件 diff（本轮已完成）

| 项 | 值 |
| --- | --- |
| 基线 | npm `@240xu/dsh-websearch@2.8.4` tarball（33 文件；上游无 v2.8.4 tag） |
| 分类 | **22 修改 + 13 新增**（按 2.8.4 存在性自动判定；`failure-label.js` 是 2.8.8 才引入，相对 2.8.4 属新增） |
| patch | `g5/G5-full-35files.patch`，3521 行 / 176K，35 段，13 个 `/dev/null` 段 |
| 二进制 / 权限位差异 | 无（全部文本；脚本 has executable bit，但不在补丁的 35 文件内） |
| `patch --dry-run` 对 2.8.4 | **exit 0**，35/35 段可 apply |
| `patch --dry-run` 对 2.8.8 | **exit 1 / 11 段冲突**（基线不同）⇒ 不能直接套到 2.8.8 |
| 缺口链 | **PR #7 只改 3 文件**（`lib/index.js +18-1`、`lib/provider.js +1-1`、`tests/v28x-settings-bridge.test.js +57`）⊂ 44 号草案 10 文件 ⊂ 本地 35 文件 ⇒ 48 号「须补 G5」坐实 |

## C. 上游状态实测

| 项 | 值 |
| --- | --- |
| npm `@240xu/dsh-websearch` | latest **2.8.8**（`2026-10-21T14:10:40Z`），无 2.8.9 |
| main | `da42e44a0f54`，`pushed_at=2026-10-21T14:08:30Z`，之后无提交 |
| PR #7 | open / mergeable / merged=false / **0 review**；head 在 `bestnite/dsh-websearch` fork（当前 token 对该 fork `push:false`） |
| releases | 空 |
| 本机 git | `src-work/plugin/` 无 `.git`；`/home/ova/dsh` 的 20 个未提交改动与 websearch 无关 |

**升级 2.8.8 会覆盖本地修复（E2 实锤，Lead 复核）**：2.8.4→2.8.8 上游改动了我们 23 个修改文件中的 **11 个**（`egress-fetch.js`、`mcp-client.js`、`failure-label.js`、`index.js`、`provider.js`、`exa.js`、`parallel.js`、`ddg.js`、`searxng.js`、`README.md`、`package.json`），且**补丁与 2.8.8 逐字节相同的文件数为 0** ⇒ 升级必然重引入已修的 P0/P1。

**14:00 更新（用户授权「先提交一下吧，更新」）**：已推新分支 `local-audit-35files-20261115`（最终 `cfcde9f`，5 commits），内含 35 文件补丁、G5 patch、79+ 份报告。**main 未合入、PR #7 未更新、npm 未 publish**。E2 第二轮独立观测到该分支已公开，与 78/79 号一致。

## D. 升级 0.2.2-rc.1 —— **伪命题，口径修订**（E2 第二轮，Lead 复核）

| 项 | 实测 |
| --- | --- |
| 服务 cmdline | `/opt/node24/bin/node /opt/dsh-0222/node_modules/@deepseek-ai/dsh/lib/bin.js web ...` |
| `/opt/dsh-0222/node_modules/@deepseek-ai/dsh/package.json` | **version = `0.2.2-rc.1`**，engines `{"node":">=24.9.0"}` |
| 运行 Node | `v24.22.2` ≥ 24.9.0 ✅ |
| npm dist-tags | `latest=0.2.2-rc.1`、`next=0.2.2-rc.3`、`alpha=0.2.2-alpha.3` |

⇒ **运行时本来就是 0.2.2-rc.1 且 Node 满足，根本不存在「升级到 0.2.2-rc.1」这回事**。历轮 25:553 / 45 / 48:255 / 56 / 64 / 68 / 72 / 76 / 77 / 78 / 79 / 99 / REPORT 里「Node 22.20.0 < 24.9.0 硬阻塞升级」是**双重过时**（既不是 Node 22，也不需要升）。76 号已把理由换成「切 runtime 重演 symlink 悬空 + 补丁未验证」，本号进一步订正为「**无升级动作可做**；真正的相邻决定是要不要上 `next=0.2.2-rc.3`」。

所有历史块按 99:3 保留为过程快照，本文 + 76 号为当前口径。

## E. 三类结论

| 类 | 项 | 处置 |
| --- | --- | --- |
| **立即可执行（零外部副作用）** | G5 diff + dry-run ✅、symlink 动态再生 ✅、文档时点回改 ✅、77/78/79 号记录 ✅ | 本轮已完成 |
| **需用户决定** | 从 `local-audit-35files-20261115` 开 PR 到 main、在 PR #7 评论、bump 2.8.9 + `npm publish`（`ENEEDAUTH`）、patch-package 落地、是否上 `0.2.2-rc.3`、D5 按 session 隔离 | 未执行，等点头 |
| **明确不该做** | 未补 G5 就提 PR、改 pin 升 2.8.8（11 文件覆盖）、重复开 PR #7、push 到 `bestnite` fork（无权限）、回退 runtime、清 pnpm store / 重启服务做实验 | 保持现状 |

## 风险

1. `npm publish` 会让 profile 精确 pin 2.8.4 与新版本语义冲突；发布前先决定 profile 策略。
2. PR base 若选 2.8.8，11 段冲突里可能含**已修缺陷被上游不同实现覆盖**，需逐段人工裁决。
3. install-recovery 里 46 文件副本非 active，若 `DSH_HOME` 或恢复流程改变可能变成第二套 active 副本（见 75 号 / 25 §6 前提 2）。
4. 「升级 0.2.2-rc.1」在 20+ 份旧报告里被当成待决项；若不加订正，未来决策会基于不存在的动作。

## 已确认无误 / 无法验证

已确认：token 身份 `240xu`、对 `240xu/dsh-websearch` 有 push 权限、远端分支与本地 HEAD 全 SHA 一致、全历史 0 密钥值命中、`main`/PR#7/npm 未被推送改变。
无法验证：patch-package 在 `install_bundle` 重装后是否存活、PR CI 行为（未开 PR）、`npm publish` 流程（未登录）、`0.2.2-rc.3` 的行为差异（未升级）。

---
无凭证值写入本文件；所有结论可由文中只读命令复现。

---

# 附录 X · E2 独立取证补遗（2026-11-15 14:41 CST 采样，Lead 合并后追加）

> 上文 A–E 是 Lead 合并版；本附录保留 E2 **独立实测**中未被合并版收纳、或对合并版数字构成订正的一手证据。全部命令只读，中间产物只在 `/tmp/g5-e2-74/`。token 仅经 shell 变量传递，值未打印/未落盘。

## X.1 对上文数字的订正（重要）

| 上文 | E2 独立实测 | 说明 |
| --- | --- | --- |
| B「patch 对 2.8.8 = exit 1 / 11 段冲突」 | E2 的 **PR 级** `G5-pr284.patch`（洁净 npm 2.8.4 基准）对 2.8.8 逐文件 dry-run：**30/35 CLEAN，4 文件 6 hunk FAILED** —— `provider.js` 3、`lib/backends/ddg.js` 1、`lib/backends/searxng.js` 1、`package.json` 1 | 「11 段」与「4 文件 6 hunk」是不同补丁/不同计数口径，结论一致（**不可直接 apply**）。E2 的逐文件表见 `/tmp/g5-e2-74/perfile288.txt` |
| C「main `pushed_at=2026-10-21T14:08:30Z`」 | 该值是 **main HEAD commit 的 author/committer date**；`GET /repos/240xu/dsh-websearch` 的 **repo `pushed_at` = `2026-11-15T06:26:24Z`**（今天，由新分支推送造成）。`updated_at=2026-11-07T04:49:21Z` | 三个时间戳含义不同，勿混用 |
| C「PR #7 head 在 bestnite fork / token push:false」 | E2 只取到 head.sha `bcb24b1e…`、head.ref `fix/dsh-0.2x-settings-bridge`、3 files(+76/−2)、`mergeable_state=clean`、review 数 **0**、comments **0**；fork 归属与 push 权限是 Lead 侧结论，E2 未复核 | 登记为「Lead 已验证 / E2 未验证」 |
| A「patch-package 落地 NO-GO，需用户决定」 | 补一条**技术硬阻塞**：`patch-package@8.0.1` 在 pnpm-only profile 里**无法生成**补丁 —— `npx patch-package <pkg>` 实报 `No package-lock.json, npm-shrinkwrap.json, or yarn.lock file`（只认 npm/yarn lock，不认 `pnpm-lock.yaml`） | 即使点头落地，也必须手工构造 `a/node_modules/<pkg>/… b/node_modules/<pkg>/…` 头的 patch，或改用 `postinstall: patch -p1 -d . < patches/…` |

## X.2 `install_bundle` 覆盖判定 —— E2 源码 + 实测（上文 A 的依据展开）

- 源码：`packages/boot/plugin-manager/src/index.ts:542` `runPnpm(['add', spec, …('--save-exact'), …registryFlags])`；`operations.ts:315` env = `scrubbedParentEnv()`；`operations.ts:303/317` 失败只原子还原 `package.json` + `pnpm-lock.yaml`，**不还原 `node_modules`**。`installBundle` 体内**无 `inspect(` 调用** ⇒ 不查 already-installed；成功分支 `if (Object.hasOwn(before, name)) return 'restart-required'`（覆盖已装包是允许语义）。README:100「Overwriting an installed package publishes nothing and reports restart-required」、:161「the next package operation prunes packages no manifest references」。
- 实测（`/tmp/g5-e2-74/toy3`，`nodeLinker: hoisted` + `packageImportMethod: copy`，真实 registry 包）：

| 场景 | root `postinstall` | 已改 dep 文件 |
| --- | --- | --- |
| `pnpm add` 同 spec 同版本（≈ 重装 2.8.4） | **触发** | **保持修改**（pnpm 复用目录，不重解包） |
| `pnpm install`（lock 满足） | **触发** | 保持修改 |
| `rm -rf node_modules/<dep>` 后 `pnpm install` | 触发 | **修改丢失**（从 store 重解包） |
| `pnpm install --force` | 触发 | **修改丢失** |
| `pnpm add <pkg>@新版本` | 触发 | **修改丢失** |

  4/4 触发 postinstall。真实安装副本 `lib/*.js` 全是 `links=1`（独立 inode，非 store 硬链）⇒ 与 copy 模式一致。
  ⇒ **装/升 websearch 本身 = 覆盖 35 文件**；装**别的** bundle 通常不覆盖，但每次 `pnpm add` 都跑 postinstall，对已打补丁目录会重复 apply（**非幂等**，R1）。
- pnpm 11 `allowBuilds` 拦的是**第三方依赖**脚本；**root 自身 `postinstall` 不受该审批**（toy 4/4 触发，无 `pendingBuilds`）。`plugin_manager` 的 `approvedBuilds` 是给依赖脚本的。

## X.3 E2 生成的 G5 补丁与统计（清单只在 /tmp，未落报告）

| 产物 | 基准 | 分类 | 行/字节 | 段/hunk | +/− | dry-run |
| --- | --- | --- | --- | --- | --- | --- |
| `/tmp/g5-e2-74/G5-35files.patch` | 本地 26 个 `*.orig` | 23 改 + 12 新 | 3557 / 179410 | 35 / 117 | +2309 / −256 | 对洁净 2.8.4 rc=1（`failure-label.js` 找不到文件）；对 2.8.8 5 文件 12 hunk FAILED |
| `/tmp/g5-e2-74/G5-pr284.patch` | **洁净 npm 2.8.4 tarball**（81000 B / 33 文件） | **22 改 + 13 新** | 3581 / 184069 | 35 / 117 | +2321 / −245 | 对洁净 2.8.4 **rc=0 / 35/35 CLEAN**；对 2.8.8 **rc=1 / 4 文件 6 hunk FAILED** |

- 逐文件 `diff -u` 清单：`/tmp/g5-e2-74/per-file/`（**35 个 `.diff`**）；日志 `combined284.log`/`combined288.log`/`verify284.log`/`verify288.log`/`perfile288.txt`/`upstream-delta.txt`；解包树 `base2.8.4/`、`base2.8.8/`、`pr284/`、`verify284/`、`verify288/`；两个 `.tgz`；`toy/`、`toy2/`、`toy3/`、`pp/`、`pp2/`；API 缓存 `/tmp/e2-*.json`（无 token 值）。
- **二进制 0**（`file --mime-type` 全 text/*，patch 内无 `Binary files`/`GIT binary patch`/`\ No newline`）。
- **权限位：本地真实链 0 差异** —— 23 个修改文件 `.orig`↔patched↔安装副本三方 bit 全一致（22×644、1×600）；12 个新增中 11×600、`tests/settings-api.test.js` 本地 664 / 安装副本 644（umask，非补丁语义）。**npm tarball 内部全 600**，`tar` 解包后变 644 ⇒ 用 tarball 做 `diff -ruN` 会报 22 处**假 mode 差**，不是真实差异。
- `src-work/plugin` ↔ 安装副本 **35/35 md5 MATCH**（本轮复测）。
- **22 个 `.orig` 与洁净 npm 2.8.4 tarball 逐字节相同**；唯一例外 `failure-label.js.orig`(1021 B) 在 2.8.4 **不存在**（2.8.8 才有 2135 B）⇒ 它是中间态备份，对外 PR 必须按「新增」处理。这解释了上文 B 的 22+13 与 25 §6 回滚链 23+12 两个口径并存。

## X.4 升级 2.8.8 覆盖修复的逐文件实锤

`diff -rq base2.8.4 base2.8.8` ⇒ 上游 2.8.4→2.8.8 改了 **11/23** 个我们改过的文件（egress-fetch / mcp-client / failure-label / index / provider / exa / parallel / ddg / searxng / README / package.json），另**新增** `lib/util/describe-error.js`；我们 12 个新增文件在 2.8.8 **一个都没有**；**patched 树与 2.8.8 逐字节相同的文件数 = 0**。2.8.8 仍 `delete headers["host"]`(`lib/util/egress-fetch.js:404`)、仍无 `fetchProvider: http`（2.8.4/2.8.8/本地插件的 `cordis.patch.yml` 三份都只有 `searchProvider: unified`）、仍 11 后端；本地补丁的 Host 头(`:187/:213`)、13 后端、settings ns、429 冷却都不在 2.8.8。`DSH_EGRESS_FORWARDER` 计数 2.8.4=0 / 2.8.8=8 / 本地补丁=0。

## X.5 patch-package 落地：E2 版完整可执行步骤（命令 + 目录 + 回滚）

上文 A 只给了最小步骤；这里给可直接执行的全链（**本轮未执行**，只读约束）。关键是**绕开生成器**、并处理非幂等：

```bash
PROF=/home/dsh/.dsh/profiles/web
PKG=$PROF/node_modules/@240xu/dsh-websearch
SRC=/home/ova/dsh/.artifacts/websearch-research/src-work/plugin
G5=/tmp/g5-e2-74

# 0) 归档权威补丁（只写 patches/，不动源码）
mkdir -p "$PROF/patches"
sed -E \
  -e 's#^(--- )base2\.8\.4/#\1a/node_modules/@240xu/dsh-websearch/#' \
  -e 's#^(\+\+\+ )pr284/#\1b/node_modules/@240xu/dsh-websearch/#' \
  -e 's#^diff -ruN base2\.8\.4/([^ ]+) pr284/#diff -ruN a/node_modules/@240xu/dsh-websearch/\1 b/node_modules/@240xu/dsh-websearch/#' \
  "$G5/G5-pr284.patch" > "$PROF/patches/@240xu+dsh-websearch+2.8.4.patch"

# 1) 装 patch-package（第一次加 --config.ignore-scripts=true，避免半成品 postinstall 抢跑）
cd "$PROF" && pnpm add -D patch-package@8.0.1 --registry=https://registry.npmmirror.com --config.ignore-scripts=true

# 2) 加 postinstall（甲=patch-package apply；乙=更稳，不需要该依赖）
node -e 'const fs=require("fs"),p=process.argv[1],j=JSON.parse(fs.readFileSync(p,"utf8"));j.scripts={...(j.scripts||{}),postinstall:"patch-package"};fs.writeFileSync(p,JSON.stringify(j,null,2)+"\n")' package.json
#   乙：postinstall = "patch --forward -p1 -d . < patches/@240xu+dsh-websearch+2.8.4.patch"
#      （--forward 让已应用的 hunk 跳过 ⇒ 缓解 R1 非幂等）

# 3) dry-run（不写 node_modules）
patch -p1 -d "$PROF" --dry-run --batch < "$PROF/patches/@240xu+dsh-websearch+2.8.4.patch"

# 4) 洁净重放验证（模拟升级/重装）
cp -a "$PKG" /tmp/g5-e2-74/prepatch-backup
rm -rf "$PKG" && pnpm install --registry=https://registry.npmmirror.com   # 重解包 + 自动 postinstall
for f in $(cd "$SRC" && find . -type f -not -path './node_modules/*' -not -path './test-node_modules/*' | sed 's#^./##'); do
  cmp -s "$SRC/$f" "$PKG/$f" || echo "MISMATCH $f"
done                                                     # 期望 0 行 MISMATCH

# 5) 升级 2.8.8 的正确顺序：先 rebase 补丁（解 provider/ddg/searxng/package.json 6 冲突）
#    → 改 pin → postinstall 指向 +2.8.8.patch → 再跑 4) 核对

# 6) 回滚（三处独立可逆）
node -e 'const fs=require("fs"),p=process.argv[1],j=JSON.parse(fs.readFileSync(p,"utf8"));delete j.scripts.postinstall;fs.writeFileSync(p,JSON.stringify(j,null,2)+"\n")' "$PROF/package.json"
rm -f "$PROF/patches/@240xu+dsh-websearch+2.8.4.patch"
cd "$PROF" && pnpm remove patch-package
#   文件级回滚用 25 §6 权威链：B=src-work/backups（23 cp + 12 rm）
```

**X.5 已实证**：上述 `sed` 重写的头（`--- a/node_modules/@240xu/dsh-websearch/…` / `+++ b/node_modules/@240xu/dsh-websearch/…`）在模拟 profile 布局（洁净 2.8.4 放在 `node_modules/@240xu/dsh-websearch/`）下 `patch -p1 --dry-run` **rc=0 / 35 段 CLEAN / 0 FAILED**（`/tmp/g5-e2-74/pp-format-test.patch` + `pplayout.log`）。即补丁格式转换这一步本身已验证；未验证的只是「在本机 profile 上真正改 `package.json` 并重装」那一步（只读约束）。

**另需补进 PR 描述**：`fetchProvider: http` 在 profile 的 `cordis.patch.yml`（drop-in/env），**不在插件包内**；只发代码别人合了仍 `WEB_PROVIDER_AMBIGUOUS`。

## X.6 上游 API 实测补充（认证 Basic auth，值脱敏）

`GET /pulls/7` → `state=open, draft=false, merged=false, mergeable=true, mergeable_state=clean, review_comments=0, comments=0, commits=1, changed_files=3, additions=76, deletions=2`；`/pulls/7/reviews` → **空数组（0 review）**；`/pulls/7/files` → `lib/index.js`(+18/−1)、`lib/provider.js`(+1/−1)、`tests/v28x-settings-bridge.test.js`(+57/0)。`/branches/main` → `da42e44a…` commit date `2026-10-21T14:08:30Z`、`protected=false`；raw `main/package.json` → `version=2.8.8`；raw `main/CHANGELOG.md` 最新 `## 2.8.6`。`/tags` 仅 v1.0.0/v2.0.0；`/releases` 空；`/branches` 仅 `main` + `local-audit-35files-20261115`(`cfcde9fe`)；`/events` 见 `2026-11-15T06:03:57Z CreateEvent local-audit-35files-20261115`。`npm view @240xu/dsh-websearch@2.8.9` → **E404**。

新分支 `local-audit-35files-20261115` 5 commits：`d260282`(baseline 2.8.4) → `91f5dac`(audit 35 files) → `ba3d977`(first upstream push) → `a5d404d`(**G5 full diff**，含 `g5/G5-full-35files.patch` 3521 行、`docs/audit/74-nextstep-landing.md` 即本文件骨架拷贝、`79-g5-and-hardening.md`) → `cfcde9fe`(secret-scan cleanup)。`GET /compare/main...local-audit-35files-20261115` → **404**（该 compare 不可用，见 X.7）。

## X.7 E2 无法验证（诚实边界，与上文互补）

1. `GET /issues/8` 本轮未单独查（旧报告记 open / 作者「ok了」/ 未发 2.8.9）。
2. `compare/main...local-audit-35files-20261115` 返回 404 ⇒ 新分支相对 main 的 `ahead_by/behind_by` 与完整差异表未取到。
3. 分支推送归属未取证（只有 CreateEvent 时间戳，未定位到具体账号/会话）。
4. **patch-package 的 apply 闭环未在本机 profile 实跑**：pp2 实验中 `pnpm install --config.ignore-scripts=true` 后 pnpm 未重解包该 dep，crafted patch 未被 apply；只实证了「postinstall 每次触发」+「生成器不兼容」+「`patch -p1` 格式语义」。X.5 是**可执行方案，非已验收方案**。
5. `0.2.2-rc.3` 只查到 engines 同为 `>=24.9.0`，未安装/重启/回归；「可升级」仅指 Node 门槛。
6. `.baseline-20261111-2230/` 是**报告快照**（68 md + `CHECKSUMS.txt` + `PLUGIN_CHECKSUMS.txt` 43 行），**不是**洁净 2.8.4 源码树；E2 的洁净基准来自 `npm pack @240xu/dsh-websearch@2.8.4`。
7. 25 §6 的 4b `environ` 验证未跑（只核了 cmdline/exe/PATH/`DSH_HOME`）。
8. token 只用于读公开 API；**未验证 push/PR 写权限**，任何写 API 本轮禁止。

## X.8 E2 三类结论（独立口径，与上文 E 互为交叉验证）

- **立即可执行（零外部副作用，本轮已完成）**：生成两份 35 文件 diff 到 /tmp、对 2.8.4/2.8.8 dry-run、`npm pack` 双版本解包、22 `.orig` 逐字节溯源、35/35 md5 复核、认证 API 只读、pnpm toy 覆盖/脚本实验。**最该落地的一件事**：把 `/tmp/g5-e2-74/G5-pr284.patch`（35/35 CLEAN）从 /tmp 归档为唯一权威补丁源并据此接 postinstall —— 这是让补丁跨升级存续的唯一工程动作。
- **需用户决定**：patch-package 落地（改 profile + 装依赖）、对外 PR/PR#7 comment/Issue#8 回复/`npm publish` 2.8.9、pin 升 2.8.8、runtime 升 `next=rc.3`、改成 `file:`/`link:` 本地依赖、用不用今天已公开的分支做载体。
- **明确不该做**：直接升 2.8.8 后 `patch -p1` 旧补丁（4 文件 6 hunk FAILED）、`npx patch-package <pkg>` 生成（pnpm 下必失败）、`plugin_manager install_bundle` 重装 websearch（重复 apply）、另开与 PR#7 重复的 PR、git commit/push / npm publish / 改 profile、把 /tmp diff 正文粘进报告、回滚 runtime launcher。

---
> 附录 X 由 E2 独立取证，未改动上文 Lead 合并版任何一行。无凭证值写入本文件。
