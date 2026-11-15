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
