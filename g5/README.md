# G5 · 完整补丁（权威源）

## 唯一权威源

**`G5-authoritative.patch`** = 发布仓库 `publish-work/repo` 中
`git diff d2602823 HEAD -- . ':!docs/audit'`。

- 基线提交 `d2602823`：npm `@240xu/dsh-websearch@2.8.4` tarball（33 文件）
- HEAD：当前分支 `local-audit-35files-20261115`，含 35 文件补丁 + README 测试章节 + `tests/relink-test-deps.sh` + `.gitignore`
- 共 39 段（35 补丁文件 + 后续新增的脚手架/忽略文件），3610 行级

**验收（2026-11-15 实测）**：在洁净 2.8.4 树里 `git init` + `git apply --check` → exit 0；
真实 `git apply` 后与 `src-work/plugin/` **35/35 逐字节相同**。
⇒ 这是唯一经真实 apply 闭环验证的补丁源。

## 生成与复验

```bash
cd /home/ova/dsh/.artifacts/websearch-research/publish-work/repo
git diff d2602823 HEAD -- . ':!docs/audit' > /path/to/G5-authoritative.patch

V=$(mktemp -d); cp -a <clean-2.8.4-tree>/. "$V"/
(cd "$V" && git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -qm base \
  && git apply --check /path/to/G5-authoritative.patch && git apply /path/to/G5-authoritative.patch)
# 再逐文件 cmp 到 src-work/plugin/ 的 35 文件
```

## 对 2.8.8 不兼容（精确口径）

`git apply --check` / `patch --dry-run` 对 npm 2.8.8 树均失败：
**4 文件 6 hunk FAILED**（`provider.js` 3、`ddg.js` 1、`searxng.js` 1、`package.json` 1，按 E2 的逐文件表）。
历轮写的「11 段冲突」是 `patch` 日志里含 `1 out of N hunks FAILED` 汇总行的行数，**不是失败 hunk 数**，已订正。
⇒ 不能直接套到 2.8.8；对外 PR 若以 2.8.8 为 base，须先 rebase 并逐段裁决。

## 归档（仅参考，非权威）

| 文件 | 来源 | 为何不作权威 |
| --- | --- | --- |
| `archive/G5-lead-legacy.patch` | Lead 首版 | 段头含 `|---` 分隔行，`patch -p1` 真实 apply 时交互等待、22 个修改文件未生效；`--dry-run` 曾误报 exit 0 |
| `archive/G5-e2-284.patch` | E2 的 PR 级补丁 | 段头 `base2.8.4/...` ↔ `pr284/...`，`patch -p1` 到 2.8.4 根目录找不到文件；需特定 -p/目录层级 |
| `archive/G5-e2-35files.patch` | E2 的 35 文件补丁 | 同上格式约束 |

三者对 2.8.4 的 `--dry-run` 都可能报 CLEAN，但**只有 `git apply` 到洁净树后 35/35 逐字节比对才算数**。

## 与上游现状

- PR #7 只改 3 文件（`lib/index.js`、`lib/provider.js`、`tests/v28x-settings-bridge.test.js`）⊂ 本地 35 文件 ⇒ 48 号「须补 G5」成立
- main HEAD `da42e44a`（commit date 2026-10-21）；repo `pushed_at` 已因本分支变为 2026-11-15
- npm latest 仍 2.8.8，无 2.8.9；升级 2.8.8 会覆盖 11/23 个被改文件

## patch-package 硬阻塞（E2 X.1/X.5）

pnpm-only profile 里 `npx patch-package <pkg>` 报
`No package-lock.json, npm-shrinkwrap.json, or yarn.lock file` ⇒ 生成器不可用。
若将来落地，须手工构造 `a/node_modules/<pkg>/…` 头或改用 `postinstall: patch --forward -p1`；
且 `install_bundle`（`pnpm add`）装/升 websearch 本身会覆盖 35 文件、装别的 bundle 会重复触发 root postinstall（非幂等）。
**X.5 是可执行方案，非已验收方案。**
