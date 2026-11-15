# 79 · G5 完整 diff + 测试脚手架加固执行记录（2026-11-15 14:25）

> 用户「ok」后按 76 号计划的「本轮可立即执行清单」继续办：全部**零外部副作用**（不推 PR、不 publish、不改 runtime/profile pin、不重启）。

## 1. G5 完整 35 文件 diff（76 号 P0）

| 项 | 结果 |
| --- | --- |
| 产物 | `g5/G5-full-35files.patch`（3521 行 / 176K）、`g5/README.md`（46 行） |
| 基线 | npm `@240xu/dsh-websearch@2.8.4` tarball（33 文件；上游无 v2.8.4 tag） |
| 分类 | **22 修改 + 13 新增**（按文件在 2.8.4 中是否存在自动判定） |
| `patch --dry-run` 对 2.8.4 | **exit 0**，35/35 段全部可 apply |
| `patch --dry-run` 对 2.8.8 | **exit 1 / 11 段冲突**（基线不同）⇒ 不能直接套到 2.8.8，对外 PR 须先 rebase 或分版本提交 |

**关键发现**：`lib/util/failure-label.js` 是**上游 2.8.8 才引入**的文件，2.8.4 里没有 ⇒ 我们本地在 2.8.4 上补它，相对 2.8.4 属**新增**。历轮「23 修改 + 12 新增」是相对某个中间基线的口径；以 2.8.4 tarball 为准应为 **22 + 13**。第一版 patch 用 `--label a/...` 掩盖了新增文件的 `/dev/null` 段头（会让 `patch` 把创建当修改），已改为按真实存在性生成、13 个 `/dev/null` 段齐备。

**缺口链坐实**：PR #7 实测只改 **3 文件**（`lib/index.js +18-1`、`lib/provider.js +1-1`、`tests/v28x-settings-bridge.test.js +57`）⊂ 44 号草案 10 文件 ⊂ 本地 35 文件 ⇒ 48 号「对外 PR 前必须补 G5」成立。

## 2. 测试脚手架加固（E3 的 P1）

- 新增 `tests/relink-test-deps.sh`：从 `systemctl show -p MainPID --value dsh-web.service` 取 PID → 从 `/proc/$PID/cmdline` 找 `bin.js` → 上溯 3 层得到 `<root>/node_modules/@deepseek-ai` → `ln -sfn` 幂等重建 6 个 test-only symlink。
- `README.md` 的 Test 章节加「Test-only dependencies」小节：声明 symlink 不随包发布、gitignored，并给出 4 条验收命令。
- **演练实证**：故意把 2 个链接指到 `/nonexistent-old` → 悬空 2 → 跑一次脚本 → 悬空 0 → `node --test` 从 71/73 回到 **73/73**。
- 4 条验收：`find -xtype l` = 0、`require.resolve` 6/6、`node --test` 73/73、切换演练自愈。

⇒ 第四次 runtime 切换不再必然重演 11-12 的 41/49。

## 3. E3 报告带来的文档处置

75 号（242 行）独立复核运行态全绿（PID 3207503、`web_fetch` 200、2 组 `web_search`、三 API 200、fence 401/403、D8 字段有值、73/73、35/35），并给出 7 条新发现。已执行：

| 项 | 处置 |
| --- | --- |
| 25 §6 前提 2「全系统只剩一套」 | 改为「运行时唯一 active 副本 = `$P`；另有 install-recovery 下的 46 文件**非 active** 备份，`/proc` 实测 0 引用，不参与加载、不在回滚链内」 |
| 25:88「11-09 21:25」vs 25:90「20:17」 | 加注说明是**服务重启**与**launcher 改写**两个不同事件，非时间笔误 |
| §6 4b「期望无输出」 | 补隐式前提：该判据假设 3 个 env 只由 drop-in 注入；已实测 llm.env/web-auth.env/主单元 0 命中，将来若补同名 export 会假红，须先确认来源 |
| E3 的 history 饱和 / `cooledUntilMs` 化石戳 | 登记为产品语义（D5 同类），不改代码 |
| 其余旧 PID / 旧单测数 / 旧文件数 | 按 99:3 保留为过程快照，由 68 号「时点读法」覆盖 |

## 4. 73/74 号补完

E1/E2 的 fork 又是「骨架后结束」且未落盘；由 Lead 用本会话一手实测补完：
- [73 号](73-nextstep-gaps.md)：证伪「无未修 P0/P1」→ 未发现；6 个 E 项逐条给可做/不可做；优先级表；G5 与 symlink 两处新发现。
- [74 号](74-nextstep-landing.md)：patch-package NO-GO（需 `install_bundle` 重装验证）、G5 统计与冲突、上游状态、三类结论、风险登记；**事实修订**：`node -v = v24.22.2` ≥ 24.9.0 ⇒ 旧「Node 22 阻塞升级」过时，升级 NO-GO 理由改为「切 runtime 重演悬空 + 补丁未验证」。

## 5. 同步与验证

| 项 | 结果 |
| --- | --- |
| `src-work` ↔ 安装副本 | **35/35**（README 已同步；新脚本也同步并 chmod） |
| 全量单测 | **73/73** |
| 26 备份 | 齐 |
| 服务 | active PID 3207503，未重启、未改 env/profile pin |
| 报告库 | 73/74/75/79 落盘；76 号 235 行、77/78 号上一轮已推 |
| 密钥 | 全历史 + 工作树 0 命中 |

## 6. 未做（需用户点头）

从 `local-audit-35files-20261115` 开 PR 到 main、在 PR #7 评论、bump 2.8.9 + `npm publish`（`ENEEDAUTH`）、patch-package 落地、升级 0.2.2-rc.1、D5 按 session 隔离。**main 仍 `da42e44a`、PR #7 仍 open、npm latest 仍 2.8.8。**

---
无凭证值写入本文件。
