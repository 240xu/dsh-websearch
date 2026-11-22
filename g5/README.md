# G5 · 完整补丁（权威源）

## 唯一权威源（**每次代码提交后必须跑 `bash g5/refresh.sh`**）

**`G5-authoritative.patch`** = 发布仓库 `publish-work/repo` 中
`git diff d2602823 HEAD -- . ':!docs/audit'`。

- 基线提交 `d2602823`：npm `@240xu/dsh-websearch@2.8.4` tarball（33 文件）
- HEAD：当前分支 `local-audit-35files-20261115`，含 35 文件补丁 + README 测试章节 + `tests/relink-test-deps.sh` + `.gitignore`
- 范围：`git diff d2602823 HEAD -- lib tests README.md package.json .gitignore`（**不含 `g5/archive/` 等归档**，否则会把 3 份旧补丁塞进来）
- 当前 **36 段 / 4017 行**（2026-11-22 剔除 `.gitignore` 后的口径）

**验收（2026-11-22 21:20，`bash g5/refresh.sh` 输出）**：`36 segments, 35/35 byte-identical`。脚本会重新生成补丁、对洁净 2.8.4 树 `git apply --check` + 真实 apply、再逐文件 `cmp` 到 `src-work`，不满足 35/35 就 exit 1。

> **⚠️ A1 事故（2026-11-15）**：E1 那轮修完 N1–N4 后提交了 `52e26ae`，但**没有重新生成补丁**，`G5-authoritative.patch` 仍是 `230c1cf` 时代的 39 段旧快照（含 `req.destroy()`、`id: skipInitialize?1:2`、无 `sessionCacheKey`/后端级缓存键）。用它 apply 到 2.8.4 只有 **25/35** 与 src-work 相同，会把 4 条 P1 全部重新引入。现由 `refresh.sh` 把「重新生成 + 35/35 验收」固化成一步，杜绝再次脱节。

## 生成与复验

```bash
bash /home/ova/dsh/.artifacts/websearch-research/g5/refresh.sh
# 输出应为: ... 35/35 byte-identical
```

## 对 2.8.8 不兼容（精确口径）

`git apply --check` / `patch --dry-run` 对 npm 2.8.8 树均失败：
R2（93 号）用严格 `git apply --check` 复核出**两种口径都对不上**：

- `git apply --check`：**7 文件**（6 真冲突 + `util/failure-label.js` 同名已存在）
- `patch -F0`（不允许 fuzz）：**6 文件 11 hunk**（`ddg` 2、`searxng` 1、`index` 1、`provider` 5、`mcp-client` 1、`package.json` 1）

**fuzz=2 会假成功**：只留 5 个 `.rej`，但产出树 **11/27 文件偏离**。历轮写的「4 文件 6 hunk」是 E2 的 PR 级补丁（不是本 G5），已订正为上述两种口径。
⇒ 不能直接套到 2.8.8；对外 PR 若以 2.8.8 为 base，须先 rebase 并逐段裁决。

## 归档（仅参考，非权威）

| 文件 | 来源 | 为何不作权威 |
| --- | --- | --- |
| `archive/G5-lead-legacy.patch` | Lead 首版 | 段头含 `|---` 分隔行，`patch -p1` 真实 apply 时交互等待、22 个修改文件未生效；`--dry-run` 曾误报 exit 0 |
| `archive/G5-e2-284.patch` | E2 的 PR 级补丁 | 段头 `base2.8.4/...` ↔ `pr284/...`，`patch -p1` 到 2.8.4 根目录找不到文件；需特定 -p/目录层级 |
| `archive/G5-e2-35files.patch` | E2 的 35 文件补丁 | 同上格式约束 |

`archive/G5-lead-legacy-duplicate.patch` 是仓库副本里残留的同一份废弃补丁（A1 发现逐字节相同，已归入 archive）。

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
