# 77 · 上游发布状态实证（2026-11-15 13:45）

> 用户提问：「之前过去的那个版本在 github 上面 npm 上面推送了吗？」→ 用只读 API 实测，不猜。
> **token 值未写入本文件**；GitHub Basic auth 从 `/opt/xr-research/zcode-research/.git/config` remote URL 临时提取，用完即弃。

## 结论（一句话）

**没有。本地 35 文件补丁（基于 `@240xu/dsh-websearch@2.8.4`）既没有发布到 npm，也没有推送到 GitHub。** 上游最后一次发布/推送都停在 **2026-10-21**，此后只有我们在本地工作。

## npm 实测

```
npm view @240xu/dsh-websearch versions --json
→ ["2.0.0" … "2.8.4","2.8.5","2.8.6","2.8.7","2.8.8"]   # 止于 2.8.8，无 2.8.9
npm view @240xu/dsh-websearch version
→ 2.8.8
npm view @240xu/dsh-websearch time --json（节选）
  2.8.4: 2026-10-18T06:02:07.055Z
  2.8.5: 2026-10-18T10:31:56.336Z
  2.8.6: 2026-10-18T14:04:02.831Z
  2.8.7: 2026-10-20T12:53:52.217Z
  2.8.8: 2026-10-21T14:10:40.457Z   ← 最后一次发布
```

⇒ **latest = 2.8.8，发布于 10-21**；本地插件版本仍是 2.8.4 + 35 文件补丁（全部审计/修复），`package.json` 只改了 description，未 bump 版本、未 publish。

## GitHub 实测（Basic auth，值脱敏）

```
GET /repos/240xu/dsh-websearch
  default_branch = main
  pushed_at      = 2026-10-21T14:08:30Z      ← 最后一次 push
  updated_at     = 2026-11-07T04:49:21Z      （issue/PR 元数据更新，非代码 push）
  open_issues_count = 6, stargazers_count = 9

GET /repos/240xu/dsh-websearch/commits?per_page=5
  da42e44a 2026-10-21T14:08:30Z docs: add 10-second quick start; align version metadata
  8b14d549 2026-10-21T14:08:26Z docs: add 10-second quick start; align version metadata
  72cbba8e 2026-10-18T12:35:08Z docs: proxy-exempt marker ...
  592237f7 2026-10-18T12:27:50Z 2.8.6: forwarder hop via node:http ...
  fc737d22 2026-10-18T10:28:37Z 2.8.5: TLS-egress forwarder ...

GET /repos/240xu/dsh-websearch/pulls/7
  state=open  merged=False  mergeable=True
  created_at=updated_at=2026-11-04T10:22:28Z   （0 review、无后续活动）
  title: fix: settings are inert on DSH 0.2.x (no installSection) + RFC1918 plain-http base URLs re...
GET /repos/240xu/dsh-websearch/pulls?state=all&per_page=8
  #7 open 2026-11-04  （上述，我们提的）
  #5 open 2026-10-23  feat: add 火山方舟 (Volcengine Ark) backend
  #2 closed 2026-08-29 fix(client): ToggleRow 缺少 t prop ...
GET /repos/240xu/dsh-websearch/releases?per_page=3
  → []   （无 GitHub Release）
```

⇒ **main 自 10-21 无新提交**；我们的 PR #7 仍 open/mergeable/0 review、自 11-04 起无活动；无 release、无 2.8.9。

## 本机状态

- `/home/ova/dsh` 是 DSH 源码 checkout（`git log` 最新 `d7432673 Merge pull request #5946 ...`），有未提交改动但都是 `docs/website/package.json` 等，**与 websearch 插件无关**。
- **`src-work/plugin/` 没有 `.git`，不是独立仓库** ⇒ 本地 35 文件改动**从未进入任何 git 历史**，更谈不上 push。
- 逐字节一致的安装副本在 `/home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/`；profile pin 精确 `2.8.4`（无 `^`）。
- 备份 `src-work/backups/*.orig` 26 个；回滚链见 [25 §6](25-execution-log.md)。

## 为什么没推（历轮裁决，非本次新决策）

1. **House Rules**：不创建 git commit / push，除非用户明确要求。整个会话至今没有这样的明确要求。
2. **48 号发现**：44 号 G1–G4 的 PR diff 只覆盖 **10/23** 文件，直接提 PR 会漏掉全部后续修复 ⇒ 对外 PR 前必须先补 **G5 完整 35 文件 diff**。
3. **PR #7 仍 open/0 review**：历轮口径是「G2 应作为 PR #7 的评论、不重复开 PR」，而 PR #7 只对应早期一小部分修复。
4. **升级 2.8.8 会覆盖本地修复**并重新引入已修的 P0/P1（`save()` 快照、`collect()` 崩溃、3b 混合故障、错误契约等），故保持精确 pin 2.8.4。
5. patch-package 落地、对外 PR、升级 0.2.2-rc.1 均登记为**需用户决定**项（见 [64 号](64-continuation-SKELETON.md) / [68 号](68-assessment-synthesis-SKELETON.md) / [72 号](72-goal-round1-executed.md)）。

## 若您现在想推：需要先点的头

- 要不要补 G5 完整 35 文件 diff（纯本地、无外部副作用，可立即做）；
- 要不要把 PR #7 更新/评论，或另开 PR（**外部副作用**，需明确授权）；
- 要不要 bump 版本并 `npm publish`（**外部副作用**，且会覆盖 profile pin 语义，需明确授权）；
- 要不要用 patch-package 把补丁固化到 profile（会被 `plugin_manager install_bundle` 覆盖，需评估，见 [74 号](74-nextstep-landing.md) 待落盘）。

---
无凭证值写入本文件；所有结论可由文中只读命令复现。
