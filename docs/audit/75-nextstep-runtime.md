# E3 独立评估：运行时与环境韧性 — 下一步该做的

- 角色：独立评估专家 E3（运行时 / 环境韧性）；独立取证，不看他人结论
- 取证时间：2026-11-15 13:45 +08:00
- 运行态基线（题给）：service active，PID 3207503（11-14 22:28:58 启动），runtime `/opt/dsh-0222`（node24），cmdline 含 `web --no-open --host 127.0.0.1 --port 3080 --trusted-host 192.168.1.7`（无 `--patch`）；`DSH_HOME=/home/dsh/.dsh`；GUI 401→认证 200；35/35 文件一致、73/73 单测
- 关键背景：11-12 第三次 runtime 切换致 `src-work/plugin/node_modules/@deepseek-ai/` 下 6 个 test-only symlink 全悬空，`node --test` 掉到 41/49（8 fail，`ERR_MODULE_NOT_FOUND @deepseek-ai/dsh-web`），重建到 `/opt/dsh-0222/...` 后恢复 73/73
- 约束：唯一写文件＝本文件；不改源码/配置/运行时/其它报告；不操作任务板；不重启服务、不写 credentials；token/cookie 值严禁入报告

## A. 逐项探测表（命令 / 真实输出 / 判定）
（探测中，待补：web_fetch + 2×web_search 遥测、认证三 API、fence、D8 新字段）

## B. 测试脚手架韧性 + symlink 加固方案
（探测中，待补：6 symlink 健康度、动态生成方案、最小步骤 + 验收命令）

## C. 回滚链在新 runtime 下核对（25 §6）
（探测中，待补：23 cp + 12 rm + MainPID 步 + 三前提 与当前 cmdline 一致性、过时表述文件:行号）

## D. 报告库口径一致性
（待补：76 份 md 旧 PID / 旧单测数 / 旧文件数，列「需改 / 按 99:3 保留快照」两类）

## E. 新缺陷 / 已确认无误 / 无法验证 / 5 条反直觉
（待补）

## 结论与优先级（A/B/C/D/E）
（待补）

## 取证方法说明
skill catalog 中无与本「运行时取证 + 环境加固评估」直接匹配的技能，按规则采用 shell / web 工具 / 文件只读直接取证。
