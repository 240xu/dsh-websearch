# 78 · 首次上游提交与推送记录（2026-11-15 14:00）

> 用户明确授权：「当前，这套先提交一下吧，更新」。本文件记录**实际执行**的提交与推送，作为后续追溯依据。
> 全程 token 值未写入任何文件/输出；推送前按 `dsh-pre-push-checks` 原则跑相关检查并验证远端 ref。

## 1. 提交载体

`src-work/plugin/` 本身**不是 git 仓库**（无 `.git`），`/home/ova/dsh/.artifacts/` 又被根仓库 `.gitignore:40` 忽略，且 `/home/ova/dsh` 有 20 个与本任务无关的未提交改动 ⇒ 不能借用根仓库。

因此新建**自包含的发布工作仓库**：
`/home/ova/dsh/.artifacts/websearch-research/publish-work/repo/`

- 以 **npm tarball `@240xu/dsh-websearch@2.8.4`** 解包作基线（上游没有 v2.8.4 tag，tags 只有 v2.0.0 / v1.0.0）
- 基线提交 `d2602823` `baseline: @240xu/dsh-websearch@2.8.4 (npm tarball)`（33 文件）
- 应用 `src-work/plugin/` 的 **35 文件补丁**（逐文件 md5 一致），复制 **79 份 md 报告**到 `docs/audit/`，加 `.gitignore` 忽略 test-only symlink（不提交本机绝对路径）
- 补丁提交 `91f5dac0` `audit: full bug-fix patch (35 files) + evidence reports`

## 2. 提交前验证

| 项 | 结果 |
| --- | --- |
| `node --test tests/*.test.js` | **73/73 pass / 0 fail** |
| `node --check` lib/*.js + util + backends | 33/33 OK |
| `package.json` JSON.parse | OK |
| 35 文件 `src-work` ↔ 安装副本 ↔ 发布仓库 | 三方一致 |
| 26 个 `*.orig` 备份 | 齐 |
| 服务 | active（PID 3207503），三 env 保持 |
| git 状态 | 干净（提交后 `[ ]`） |

**密钥扫描（值，非变量名）**：首次扫描在 `docs/audit/67-assessment-runtime.md:23` 抓到 1 处**真实 `Set-Cookie` 值**（67 号自称"token/cookie 零泄漏"但脱敏不彻底）。已把 cookie 名与值全部替换为 `<REDACTED>`、`git commit --amend` 重写提交；**全历史 `git log --all -p` + 当前工作树复扫均为 0 命中**后才推送。原产物库的 67 号也已同步脱敏。

## 3. 推送

```
git remote add origin https://<token>@github.com/240xu/dsh-websearch.git   # 值未落盘
git push -u origin HEAD:refs/heads/local-audit-35files-20261115
```

- 远端分支：**`240xu/dsh-websearch@local-audit-35files-20261115`**
- 远端 ref `91f5dac05fa2` = 本地 `HEAD 91f5dac` ✅
- 远端 2 个提交：`d2602823` baseline + `91f5dac0` patch
- 远端树 133 条目：`docs/audit/` 79 份 md、`tests/` 8 个测试文件、`lib/util/web-error.js` / `namespace.js` / `backends/firecrawl.js` / `tinyfish.js` / `package.json` / `README.md` / `77-upstream-publish-status.md` / `25-execution-log.md` 全部 OK

## 4. 明确**没有**做的事（避免误读）

| 项 | 状态 | 理由 |
| --- | --- | --- |
| 合入 `main` | ❌ 未做 | `main` 仍是 `da42e44a0f54`（10-21），未触碰 |
| 开新 PR | ❌ 未做 | 用户说「提交一下，更新」，未明确要求 PR；GitHub 已给 PR 创建链接备用 |
| 更新 PR #7 | ❌ 未做 | 其 head 在 `bestnite/dsh-websearch` fork，当前 token 对该 fork `push:false`；且只含 3 文件 |
| `npm publish` | ❌ 未做 | `npm whoami` = `ENEEDAUTH`（未登录）；publish 会改版本/profile pin，属外部不可逆动作 |
| 改版本 / 改 profile pin | ❌ 未做 | 仍是 2.8.4 + 35 文件补丁，profile 精确 pin 2.8.4 |
| 升级 2.8.8 / 0.2.2-rc.1 | ❌ 未做 | 会覆盖本地修复；P1 报告把 NO-GO 理由从「Node 22 阻塞」修订为「切 runtime 重演 symlink 悬空 + 补丁未在新 runtime 验证」 |

⇒ **npm latest 仍为 2.8.8，PR #7 仍 open（`bcb24b1efbb4`），releases 仍为空**。这次只是把工作成果**存成上游仓库里一条可追溯的分支**。

## 5. 下一步可选（需用户点头）

1. 从该分支**开 PR** 到 main（GitHub 已给链接 `https://github.com/240xu/dsh-websearch/pull/new/local-audit-35files-20261115`）——注意 48 号要求先补 **G5 完整 35 文件 diff** 并 `patch --dry-run` 对 2.8.8 验证；
2. 在 PR #7 里**评论**指向该分支（不改 fork，无 push 权限问题）；
3. 解决 npm 认证后 **bump 2.8.9 并 publish**；
4. 用 patch-package 把补丁固化到 profile（74 号评估待落盘，预计会被 `plugin_manager install_bundle` 覆盖）。

---
无凭证值写入本文件。
