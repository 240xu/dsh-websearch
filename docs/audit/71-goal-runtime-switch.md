# 71 · 目标模式 G3：第三次 runtime 切换与 §6 回滚链（骨架 → Lead 补完）

> 目标模式第 1 轮。专家 G3 落盘骨架 + 两次中期简报（22:45 / 22:58）；由 Lead 用只读实测补完并执行文档回改。**未重启、未回滚、未写状态**。唯一写文件为本报告。

## 1. 第三次切换实测（2026-11-12 05:15）

| 项 | 值 |
| --- | --- |
| 服务 | active，PID 170703，启动 11-11 23:06:40（重启应用本轮修复后） |
| cmdline | `/opt/node24/bin/node /opt/dsh-0222/node_modules/@deepseek-ai/dsh/lib/bin.js web --no-open --host 127.0.0.1 --port 3080 --trusted-host 192.168.1.7 --trusted-host dsh.sepic.space` —— **无 `--patch`** |
| runtime checkout | `/opt/dsh-0222/`（前两次：`/usr/local/lib/node_modules/@deepseek-ai/dsh/` → `/home/dsh/.dsh-exp022/runtime/`） |
| env | `DSH_HOME=/home/dsh/.dsh`、`DSH_WEB_FETCH_PROVIDER=http`、`HTTP(S)_PROXY=http://172.30.66.1:1091` |
| launcher | `/usr/local/sbin/dsh-web-run-native.sh` mtime **11-11 21:26:22**，663 字节，`export PATH=/opt/node24/bin`、`exec /opt/node24/bin/node /opt/dsh-0222/.../bin.js web`（**无 --patch**），trusted-host .7 |
| systemd 单元 | G3：Environment 仍写 `PATH=/opt/node22/bin`，但 launcher 内部 export node24 且直接 exec 绝对路径 node24；实测 PID environ/exe 均为 node24，单元文件 mtime 仍 10-21，未被本次切换改写 |
| 插件加载 | G3 用 `plugin_manager list_plugins` 实时确认 `include:dsh-websearch @240xu/dsh-websearch enabled=true fiberPhase=active`；`DSH_PROFILE=web`、`DSH_PROFILE_DIR=/home/dsh/.dsh/profiles/web` |
| 插件副本 | 全系统 `find` 只剩**一套**：`/home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch`；`/home/dsh/.dsh-exp022/` 与 `/opt/dsh-0222/` 下均无 profile 副本 |
| dump-config | G3：`--dump-config` 会刷新 `cordis.yml` mtime 但 md5 恒为 `da08f433…`，`id: web` 仍 `searchProvider: unified`，`fetchProvider` 由 drop-in 的 `DSH_WEB_FETCH_PROVIDER=http` env pin 提供（新 runtime `dsh-web/lib/index.js:60,145` 仍读该 env） |

## 2. §6 三条前提逐条裁决

| 前提 | 旧文本 | 裁决 | 已执行 |
| --- | --- | --- | --- |
| H-1 | 「11-09 21:25 起 `exp022/.../bin.js web --patch ...`，不含字面 `dsh web --patch`」 | **需改**（cmdline 已变；但「用 MainPID 而非 pgrep」的结论**仍成立**） | ✅ 改为双版本描述（11-09 exp022 `--patch` / 11-11 21:26 `/opt/dsh-0222` 无 `--patch`），并同步 4b 步注释 |
| H-2 | 「exp022 下只剩 runtime/，第二套 profile 已不存在」 | **需改**（范围太窄） | ✅ 改为「全系统只剩一套 `$P`；exp022 与 /opt/dsh-0222 下均无副本；DSH_HOME/DSH_PROFILE 指旧 profile，G3 取证闭合」 |
| H-3 | 「launcher 于 11-09 20:17 被重写一次」 | **已失效** | ✅ 改为「被外部切换重写**两次**：11-09 20:17 + 11-11 21:26:22（bin 改 /opt/dsh-0222、删 --patch）」；可选回退步同步为「两次改动」 |
| 证据等级表 | 25:197「launcher 11:14 版本」 | **需加时点** | ✅ 加「历史快照；当前为 11-11 21:26 的 /opt/dsh-0222 版本，见 §6 前提 3」 |

## 3. 按 §6 原样回滚能否回到 websearch 插件基线

**能。** G3 只读模拟：23 个 `.orig` 全在且 23/23 与 live 不同、12 个新增全在、drop-in 在位；schemastery 3.18.5 对 `enableFirecrawl/enableTinyfish` 这类 baseline schema 未声明的键是**透传、不抛错**；baseline `package.json.orig` 与 live 只差 description 文案 ⇒ 在 0.2.2-rc.1 / node24 下不会因 profile 配置或依赖解析挂掉。

**诚实边界**：§6 回滚的是 `$P` 内的 35 个插件文件 + drop-in，**不含外部 runtime 切换**（launcher / `/opt/dsh-0222` / node24）；后者属系统级演进，默认不回滚，仅「可选步」在用户明确要求时执行。

## 4. 全库过时表述裁决

`25 / 58 / 59 / 61 / 62 / 64 / 66 / 67 / 68 / 99 / REPORT` 共 11 份报告仍含旧 PID（2512598 / 3396816 / 1574785 / 3973061 / 3751811）或旧 runtime 路径。**按 99:3「旧正文保留为过程记录」不逐份改写**，由 68 号「时点读法」+ 本报告 §1 + REPORT 当前状态块覆盖：凡出现旧 PID/旧单测数/旧文件数的块，均为其成文时点快照；当前状态以 72 号与本表为准。

## 5. 已确认无误 / 无法验证

已确认：`$P` 有效、env pin 生效、`web_fetch` 200 / `web_search` 8 Sources、认证 API 三条路由 200（effect 注册未丢路由）、35/35 文件一致。
无法验证（E）：G3 的一个后台全盘 find（job `bash-924e75939bda4bdb`）是否收尾——其结论已由 Lead 05:15 独立 `find` 复现（全系统只一套副本），不阻塞。

## 6. 5 条反直觉

1. 服务换了 3 次 runtime，**插件加载路径一次都没变**——因为 `DSH_HOME`/`DSH_PROFILE` 始终指同一个 profile。
2. 新 cmdline 连 `--patch` 都没了，但 `searchProvider: unified` 仍在：它来自 profile 的 `cordis.patch.yml`，不是命令行 overlay。
3. systemd 单元里的 `PATH=/opt/node22/bin` 是**死的**：launcher 内部 export + 绝对路径 exec 覆盖了它，实测进程是 node24。
4. `--dump-config` 会改 mtime 但不改内容（md5 恒定），所以「文件被改过」的直觉在 Cordis 里不成立。
5. 回滚链最容易过时的不是代码，是**前提里的一行 cmdline 样例**——三次 runtime 切换改的全是它。

---
无凭证值写入本文件；所有结论可由文中命令复现。
