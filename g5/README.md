# G5 · 权威补丁（每次改代码后必须刷新）

本目录两份补丁，都是**从 npm 发布包到当前工作树**的 `lib/` 全量差异，二选一使用：

| 文件 | 基线 | 用途 |
| --- | --- | --- |
| `patch-288-from-clean-288.patch` | npm `2.8.8` | **当前 profile 的 pin**；`restore-plugin.sh` 在版本为 2.8.8 时优先使用 |
| `G5-authoritative.patch` | npm `2.8.4` | 旧版 2.8.4 + 本地补丁线（保留作回滚/对照） |

两份都由脚本生成并**逐文件校验**，不接受手工编辑：

```bash
bash g5/refresh.sh
# 2.8.8 patch: NN/NN files byte-identical (...)
# G5 (2.8.4 baseline): NN/NN files byte-identical (...)
```

脚本流程：在干净基线树上覆盖当前 `lib/`、生成 `git diff`、把补丁 apply 到另一份干净基线、逐文件 `cmp` 当前树；任一文件不一致即 `exit 1`，**不会**留下半写补丁。基线树来自 `DSH_WEBSEARCH_BASE288` / `DSH_WEBSEARCH_BASE284`，否则尝试本目录与 artifacts 目录，最后 `npm pack` 拉取。

## 为什么必须刷新

补丁是恢复链的唯一输入。若提交了代码却没刷新补丁，`restore-plugin.sh` 会把旧代码写回安装目录——历轮已发生过一次（2026-11-15，39 段旧补丁会重新引入 4 条 P1）。`restore-plugin.sh` 末尾现在会把恢复结果与 `publish-work/repo/lib` 逐文件比对，不一致即失败，不再只打印一个数字。

## 与运行时的关系

`/home/dsh/.dsh/profiles/web/patches/@240xu__dsh-websearch@2.8.8.patch` 由 `restore-plugin.sh` 从本目录复制；profile 的 `package.json` pin、`pnpm-workspace.yaml` 的 `patchedDependencies` 键和补丁文件名三者版本必须一致，否则 pnpm 报 `ERR_PNPM_UNUSED_PATCH`。

## 归档

`archive/` 只作历史参考：早期补丁的段头格式或基线不同，`--dry-run` 可能报 CLEAN 但实际产出偏离，**不作权威**。
