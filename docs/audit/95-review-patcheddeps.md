# 95 · patchedDependencies 误伤风险复审（R3 骨架 → Lead 实跑补完，2026-11-22 21:45）

> R3 顾问落盘 29 行骨架后未补完；Lead 在隔离 toy profile `/tmp/toy-r3` 用**真 pnpm + 真 argv** 实跑实验补完。
> **未动真 profile 的破坏性操作**；真 profile 的验证另见 [94 号](94-upstream-breach-recovery.md)。
> 真 pnpm 入口：`/opt/node24/bin/node /opt/node22/lib/node_modules/pnpm/bin/pnpm.cjs`（`/usr/local/bin/pnpm` 包装脚本用 node24 跑 node22 的 cjs 会 SyntaxError）。

## 0. 结论（一句话）

**安全，但有一个必须先知道的前提**：patch 键与实装版本**不匹配**时，pnpm 会以 `ERR_PNPM_UNUSED_PATCH` **中止**该次 install/add。
用户看到的是「装插件失败」，而不是补丁被静默洗掉——**这是 fail-loud，比静默覆盖好**，但要在文档里写清楚「改 pin 忘了改 patch 键 = 装不了任何插件」。

## 1. toy profile 真 argv 复刻实验

`/tmp/toy-r3`：`package.json`（pin 2.8.4）+ `pnpm-workspace.yaml`（`patchedDependencies`）+ `patches/`（36 段 G5）。

| # | 实验 | 命令 | 逐字结果 |
| --- | --- | --- | --- |
| 1 | 首次 install | `pnpm install` | `+ @240xu/dsh-websearch 2.8.4`，补丁生效 |
| 2 | **复刻 plugin_manager 真实 argv** | `pnpm add @ayanehana/dsh-reasoning-effort@1.0.0 --save-exact` | exit 0，`resolved 5 / added 5`，**补丁存活**（`req.resume`=1 / `sessionCacheKey`=3 / `webCtx.effect`=1 / `web-error.js`=YES / `tests`=YES） |
| 3 | 已装同版本包再 add | `pnpm add @ayanehana/...@1.0.0 --save-exact` | `Already up to date`，补丁存活 |
| 4 | **patch 键故意改成 2.8.99** + add 新包 | `pnpm add is-number@7.0.0 --save-exact` | **`ERR_PNPM_UNUSED_PATCH`：`The following patches were not used: @240xu/dsh-websearch@2.8.99` / `Either remove them from "patchedDependencies" or update them to match packages in your dependencies.`** |
| 5 | 误伤时落库状态 | `md5sum package.json pnpm-workspace.yaml pnpm-lock.yaml` | 三文件**未被写坏**；`is-number` **未装上**（安装确实被中止） |
| 6 | 恢复正确键后重试 | `pnpm add is-number@7.0.0 --save-exact` | exit 0，`+ is-number 7.0.0`，**补丁存活** |
| 7 | **`pnpm add @240xu/dsh-websearch@2.8.8`** | — | **`ERR_PNPM_UNUSED_PATCH` 拒绝**；三文件 md5 **前后完全一致**（未写坏）；实装仍 **2.8.4**；补丁存活 |

⇒ **核心保证成立**：
- 装/升**特定版本**（2.8.8）会被拒，且**不污染落库**；
- 装**别的**包补丁存活；
- 唯一的副作用是「键不匹配时任何 install 都失败」——fail-loud，可恢复。

## 2. `dsh-plugin-manager` 的 pnpm 调用点（错误路径判定）

R3 骨架未填此项；按 [93 号](93-review-pin-decision.md) 与 R1（92 号）已核：
- 安装路径 `runPnpm(['add', spec, ...])`（**不带 `--frozen-lockfile`**）—— 本轮 toy 实测该 argv 下补丁存活；
- 恢复路径**带** frozen；
- 因此 `plugin_manager` 装别的插件**不会**洗掉补丁，但会在 patch 键不匹配时报 `ERR_PNPM_UNUSED_PATCH`。

## 3. 半坏场景与恢复能力

中途失败（网络/registry 报错）会留下 `patches/` 已更新但 `node_modules` 未重打的状态。**`restore-plugin.sh` 能恢复**：它先重算 lock 再 frozen install，最后 36 段逐字节 + 三条标志位自检；已端到端实跑输出 `patched tree restored: 36 segments byte-identical`。

## 4. 与 `minimumReleaseAge` 的交互

真 profile `pnpm-workspace.yaml` 里有 `minimumReleaseAgeExclude`（`@ayanehana/dsh-reasoning-effort@0.9.0`、`dsh-connect-workbuddy@5.30.0`），与 `patchedDependencies` **不冲突**（前者按发布时间过滤，后者按 `pkg@version` 匹配补丁）。本轮未见任何警告交叉。

## 5. 新机制引入的新风险（诚实登记）

1. **改 pin 忘改 patch 键 ⇒ 任何 install 都失败**（`ERR_PNPM_UNUSED_PATCH`）。缓解：`restore-plugin.sh` 同时写 pin 与 patch 键，二者不会分家；文档已写进 [25 §6](25-execution-log.md)。
2. **改 patch 文件必须重算 lock**：`patch_hash` 会变（本轮实测 `7e6245b3…` → `986340c8…`），否则 frozen install 报 lock 不匹配。已在 §6 写入正确顺序。
3. **`.gitignore` 曾混进 G5** 导致 patch 对安装树多打一个文件（已剔除，现 36 段）。
4. **`Packages: -12`** 是 lock 里登记的跨平台 optional 二进制（darwin/win32/arm64/musl）每次被「删」，**无害**：8 个声明依赖全在位、`claude-agent-sdk-linux-x64` 与 `codex-linux-x64` 在位、`did not activate` 计数 0。

## 6. 逐条裁决

| 项 | 裁决 | 等级 |
| --- | --- | --- |
| 装别的插件会洗掉补丁吗 | **不会**（真 argv 实测补丁存活） | A |
| 装/升 2.8.8 会被拒吗 | **会**，且不污染落库 | A |
| 误伤用户吗 | **会**（键不匹配时 install 全失败），但 fail-loud 且可一键恢复 | A |
| 落库会写坏吗 | **不会**（三次实验 md5 前后一致） | A |
| 与 `minimumReleaseAge` 冲突吗 | **不冲突** | B |
| 半坏状态能恢复吗 | **能**（`restore-plugin.sh` 已实跑） | A |

## 7. 无法验证（E）

- sidecar `172.30.0.1:13070` 活着时 2.8.8 的成功路径（该端口本机无监听）；
- `plugin_manager` 在 GUI 里真实点击触发的端到端（本轮只复刻 argv）；
- 网络/registry 中途失败的真实半坏状态（本轮用 toy 模拟，未真断网）。

## 8. 5 条反直觉

1. **fail-loud 比静默更安全**：`ERR_PNPM_UNUSED_PATCH` 让用户装不了插件，但也保证补丁永远不会被无声洗掉——这正是 11-22 事故的根因。
2. 装 2.8.8 被拒时，`package.json` / `workspace.yaml` / `lock` **一个字节都没变**，pnpm 在解析阶段就退出了。
3. `pnpm add` 装**同版本**已装包时是 `Already up to date`，**不会重解包**——所以那次事故不可能是「add 同版本」造成的，只能是换了 spec。
4. `Packages: -12` 看起来像删了 12 个包，实际是 12 个跨平台 optional 占位每次被跳过。
5. 修 lock 与修 patch 是**两件事**：改 patch 内容必须重算 `patch_hash`，改 pin 必须同时改 patch 键——`restore-plugin.sh` 把两件事绑成一个动作。

---
无凭证值写入本文件。
