# 104 · 第二实例调试端口（2026-11-23）

> 用户：「另开端口调试，不然会中断当前任务」。
> **根因已确认**：本会话的 cgroup 是 `0::/system.slice/dsh-web.service` —— agent 就跑在
> `dsh-web.service` 里。任何 `systemctl restart dsh-web.service` 都会**杀掉承载本会话的进程**，
> 工具调用被 abort（14:01 与 13:41 两次 abort 都是这个原因）。所以调试**绝不能再重启 3080**。

## 1. 已落地：独立 dev 实例（3081）

| 项 | 值 |
| --- | --- |
| 端口 | **127.0.0.1:3081** |
| `DSH_HOME` | `/home/dsh/.dsh-dev`（**独立**：cache / settings / history / logs 全部私有） |
| profile | `.dsh-dev/profiles/web` → **软链**到 `.dsh/profiles/web`（共用同一份插件代码） |
| 凭据 | `.credentials.yaml`、`llm.env` 软链（只读共用，不复制密钥） |
| 脚本 | `.artifacts/websearch-research/dev-instance.sh`（start/stop/restart/status，幂等） |
| 日志 | `/tmp/dsh-dev-3081.log` |

## 2. 为什么这么做（三条硬约束）

1. **重启 3080 = 杀掉自己**：agent 进程属于 `dsh-web.service`，`systemctl restart` 会让当前 turn 中断。这条是 13:41 和 14:01 两次工具 abort 的**唯一原因**（服务本身一直 active）。
2. **不能在同一 profile 上跑两个实例**：`$DSH_HOME/cache/websearch` 的磁盘缓存、`history.json`、settings 会互踩。⇒ 必须换 `DSH_HOME`。
3. **但换 `DSH_HOME` 会找不到 profile**：`app-boot` 用 `join(home, "profiles")` 解析（`bin.js:1552`）。⇒ 用**软链**把 `profiles/web` 指回主 profile，代码共享、状态隔离。

## 3. 端到端验证（真实输出）

```
3081 裸访              -> 401
3081 ?token=…          -> 303 + set-cookie
3081 带 cookie         -> 200
3081 /api/unified-search/health -> 200（enabled=6, requestedMaxResults=8）
主 3080                -> active, PID 1414284, HTTP 401（未受影响）
本会话 cgroup          -> 0::/system.slice/dsh-web.service（仍活着）
```

**代码共享已验证**：`3081` 看到的 `client.js` 就是 917 行的新版（`keyedBackends` 已删）。

## 4. 用法

```bash
bash .artifacts/websearch-research/dev-instance.sh start 3081
bash .artifacts/websearch-research/dev-instance.sh status 3081
bash .artifacts/websearch-research/dev-instance.sh stop   3081
```

token 在 `/tmp/dsh-dev-3081.log`：`grep -oE 'token=[A-Za-z0-9_-]+' /tmp/dsh-dev-3081.log | tail -1`

## 5. 踩到的坑（都已修）

| 坑 | 现象 | 修法 |
| --- | --- | --- |
| `nohup $!` 不是 node 的 PID | PIDFILE 里是 shell 的 PID，`kill -0` 报 no，但端口仍被占 | `stop` 改为**按端口兜底查 PID**（`ss -ltnp \| grep :PORT`） |
| 旧实例占着端口 | 新实例 `EADDRINUSE` 静默退出，日志里没有 token | 先 `stop` 再 `start`；脚本周转处已加 `status` 前置检查 |
| token 打印时机 | 脚本 `start` 末尾 grep 日志时还没写完 | 单独读日志取 token（脚本只在末尾尝试一次，不保证） |

## 6. 边界（诚实说明）

- dev 实例是**另一套进程**，共享同一份 `node_modules`：**改代码后仍需重启 dev 实例**（不是热生效，见 [96 号](96-hot-reload-findings.md)）。但重启 dev 实例**不会中断本会话**，这才是它存在的意义。
- dev 实例有自己的 `cache/` 与 settings：它会用**默认配置**，不是主实例的调参状态。要复现主实例行为需手工在 3081 的 Settings 面板调一次。
- 不对外：`--host 127.0.0.1`，`--trusted-host 127.0.0.1`。

---
无凭证值写入本文件。
