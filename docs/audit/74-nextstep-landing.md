# 74 · 工程落地与上游对接评估（独立评估专家 E2 · 独立取证）

> 状态：骨架已落盘，取证中逐项补全。**唯一写文件**；不改源码/配置/运行时/其它报告；不操作任务板；不 git commit/push、不 npm publish、不改 profile。
> 评估对象：`/home/ova/dsh/.artifacts/websearch-research/src-work/plugin/`（版本 2.8.4 + 35 文件本地补丁）
> 备份：`src-work/backups/*.orig`（26 个）；基线：`.baseline-20261111-2230/`；profile pin 精确 2.8.4
> 方法：read/grep/glob + `diff -u` + curl（只读 GitHub API，token 值脱敏，绝不落盘/输出）+ `npm view`；全程只读，不改状态。

## A. patch-package 落地评估
- [ ] 待补：profile `/home/dsh/.dsh/profiles/web/package.json` 是否有 `postinstall` / `patch-package`
- [ ] 待补：node_modules 里有没有 patch-package
- [ ] 待补：35 文件 diff → patch → 接 postinstall 的完整步骤（命令 + 目录 + 回滚）
- [ ] 待补：DSH profile 的 `plugin_manager install_bundle` 流程下是否会被覆盖

## B. G5 完整 35 文件 diff
- [ ] 待补：逐文件 `diff -u` 清单（写到 /tmp，不落报告）
- [ ] 待补：统计总行数 / 新增 / 修改 / 删除 / 二进制 / 权限位差异
- [ ] 待补：对外 PR 前必须补齐什么（44 号 G1–G4 只覆盖 10/23 文件）

## C. 上游状态实测
- [ ] 待补：`240xu/dsh-websearch` PR #7 状态（open/mergeable/review 数）
- [ ] 待补：main 分支最新 commit / pushed_at
- [ ] 待补：npm `@240xu/dsh-websearch` latest 版本 / 有无 2.8.9、2.8.8
- [ ] 待补：与本地 2.8.4+补丁 对比：升级 2.8.8 会不会覆盖本地修复

## D. 升级 0.2.2-rc.1
- [ ] 待补：`/opt/dsh-0222` 的 `@deepseek-ai/dsh` 版本与 Node 要求
- [ ] 待补：本地 `node -v`；判断当前是否可升级

## E. 三类结论
- [ ] 立即可执行 / 需用户决定 / 明确不该做（每类含具体命令）

## 风险
- [ ] 待补

## 已确认无误
- [ ] 待补

## 无法验证
- [ ] 待补
