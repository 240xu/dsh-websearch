# 94 · 2026-11-22 上游升级事故：修复与可持续重建（目标模式第 1 轮）

> 事故：08:54 有人把 profile 的 `@240xu/dsh-websearch` 从「2.8.4 + 35 文件补丁」换成**干净 npm 2.8.8**，pin 改 `"2.8.8"`。
> 双重后果：① 3 轮审计的 35 文件补丁全丢；② 2.8.8 走 `DSH_EGRESS_FORWARDER` 分支而 `172.30.0.1:13070` 无监听 ⇒ `web_search` 全后端失败。
> 本轮由 Lead 执行，R1（92 号）/ R2（93 号）两位专家独立复审。

## 1. 事故定性与根因

| 项 | 实测 |
| --- | --- |
| 干净 2.8.8 vs 我们的补丁 | 我们的 P0/P1 在 2.8.8 命中 **0**（`webErrorFromResponse` 25/0、`keylessRejected` 12/0、`findPluginRow` 6/0、`sessionCacheKey` 1/0、`webCtx.effect` 1/0） |
| 2.8.8 的 egress 分支 | `forwarderFor()` **不 fail-open**；`DSH_EGRESS_FORWARDER` 唯一注入源是 `/usr/local/sbin/dsh-web-run-native.sh:12`；`172.30.0.1:13070` **无监听** ⇒ 每次外站请求 ~20s 后抛 `forwarder unreachable` |
| 清掉 FORWARDER 后 | 2.8.8 仍 **403**，因为它的 `normalizeHeaders()` 照样 `delete headers["host"]` |
| 真正的 P0 | **不是版本选错，是 pin 与 lock 分家**：`specifier` 与 `version` 不一致时 `pnpm install` 会**静默**把补丁洗成干净包，错误消失、补丁也消失 |
| 附带发现 | `/usr/local/bin/pnpm` 包装脚本本身坏了：用 node24 跑 `/opt/node22/.../pnpm.cjs` → `SyntaxError: Invalid or unexpected token`（真入口必须用 `node24 + pnpm.cjs` 直接调） |

## 2. 已执行的修复（按时间序）

1. **恢复补丁树**（19:30）：用 `g5/G5-authoritative.patch` apply 到真 npm 2.8.4 tarball → 重建完整树 → 与 `src-work` **35/35 逐字节** → rsync 覆盖安装目录 → 被覆盖的干净 2.8.8 整包备份到 `backups/upstream-288-20261122T193016/`。
2. **修 pin**（19:40）：`package.json` 的 `@240xu/dsh-websearch` 改回 `2.8.4`；profile 三文件备份到 `backups/profile-20261122T194025/`。
3. **修 lock**（20:44）：备份 lock 后用真 pnpm 入口重算 `--lockfile-only` → `version: 2.8.4`，2.8.8 条目 0、2.8.4 条目 1；`node_modules` 未动。
4. **剔除 `.gitignore` 污染**（20:52）：G5 patch 里混进了发布仓库自用的 `.gitignore`（只为忽略 node_modules），它不是插件补丁的一部分。修 `g5/refresh.sh` 的 diff 范围 `-- lib tests README.md package.json`，重生成 → **36 段 / 4017 行 / 35/35**，双份 `cmp` 一致。
5. **机制化上锁**，把「锁」从人工约定变成 pnpm 强制（见 §3）。备份到 `backups/profile-workspace-20261122T205841/`。

## 3. 关键成果：`patchedDependencies` 让补丁可自我修复

`/home/dsh/.dsh/profiles/web/pnpm-workspace.yaml` 新增：

```yaml
patchedDependencies:
  '@240xu/dsh-websearch@2.8.4': patches/@240xu__dsh-websearch@2.8.4.patch
```

`patches/@240xu__dsh-websearch@2.8.4.patch` = G5 权威补丁（36 段）。lockfile 里出现 `patch_hash=7e6245b3…`（2 处）。

**在隔离 toy profile 里先验证，再落真 profile**（toy 目录 `/tmp/toy-patchtest`）：

| 场景 | 结果 |
| --- | --- |
| 首次 `pnpm install` | patch 生效：36 段与 `src-work` **逐字节 36/36** |
| **`pnpm add is-odd`（= plugin_manager 真实路径）** | **补丁存活**（`req.resume`/`sessionCacheKey`/`web-error.js`/`tests` 全在） |
| `pnpm install --no-frozen-lockfile` | **补丁存活**（R1 之前在无 patch 机制下会洗掉，现在不会） |
| **`pnpm add @240xu/dsh-websearch@2.8.8`** | **`ERR_PNPM_UNUSED_PATCH` 拒绝**，实际版本仍 2.8.4 |

**真 profile 复验**：`pnpm install --frozen-lockfile` → `-2.8.8 +2.8.4`；随后 `pnpm add is-odd` → 补丁存活；再 `remove is-odd` → 补丁存活；**36/36 逐字节与 `src-work` 相同**，pin/实装/lock 三者一致（2.8.4）。

## 4. 修复后的验收矩阵

| 项 | 结果 |
| --- | --- |
| pin / 实装 / lock | 2.8.4 / 2.8.4 / 2.8.4（2.8.8 条目 0） |
| `patchedDependencies` + `patch_hash` | 在位（lock 2 处） |
| 36 段逐字节 vs `src-work` | **36/36 相同** |
| 关键修复标志 | `req.resume` 1、`sessionCacheKey` 3、`skipInitialize ? 2 : 3` 1、`webCtx.effect` 1、`maxRunning` 2、`requestedMaxResults` 1、`keylessRejected` 8 |
| 危险动作 | add 别的包 ✅ 存活 / no-frozen install ✅ 存活 / add 2.8.8 ✅ 被拒 |
| `web_fetch` | **HTTP 200** |
| `web_search` | **8 Sources**；遥测含 `firecrawl ✗` 与 `tinyfish ✓` —— 这两个 backend **只存在于我们的补丁树**（干净 2.8.4 11 后端无它们，2.8.8 也无这两个文件）⇒ **活体证明运行进程就是补丁树** |
| 备份 | upstream-288 / profile ×3 / profile-workspace（含回滚所需全部三文件） |

## 5. 已完成（21:14 补记）

**服务已重启**（PID 370822，21:14:14）。SSH 通道找到可用路径：**IPv6 回环 + 密码**——
`sshpass -e ssh -6 -o PreferredAuthentications=password ova@::1`。IPv4 `127.0.0.1:22` 与
`20000`/`29922` 全部 `Connection closed`，但 `::1` 能到认证阶段并成功登录；这条路是
本轮唯一可用的管理通道，已记入操作手册。

重启后终局验收（21:17）：

| 项 | 结果 |
| --- | --- |
| 服务 | active：PID 370822，21:14:14 |
| pin / 实装 / lock | 2.8.4 / 2.8.4 / 2.8.4（2.8.8 条目 0） |
| `patchedDependencies` | 在位，lock `patch_hash` 2 处 |
| 36 段逐字节 vs `src-work` | **36/36 相同** |
| 7 个关键修复标志 | 全在（1/3/1/1/2/1/8） |
| `web_fetch` | **HTTP 200** |
| `web_search` | **8 Sources**，`parallel/ddg/tinyfish ✓` + `firecrawl ✗`/`tinyfish ✓` 遥测 |

发布仓库已提交 `6316647` 并推送（36 段 G5、92/93/94 号报告、修正后的 refresh.sh）。

## 6. 原始未完成项（保留）（SSH 通道全断：22 / 20000 / 29922 全部 `Connection closed`）。经证据判定**本轮不需要重启**：进程启动于 19:31:42，当时加载的就是 2.8.4+补丁树；20:58 的 install 只是把 2.8.8 换回**内容相同的** 2.8.4+补丁（36/36 逐字节相同）⇒ 内存 = 磁盘。且 `web_search` 遥测出现 `firecrawl`/`tinyfish`，只有补丁树才有这两个 backend。
   **风险**：将来若真需要重启而 SSH 仍断，则无通道。SSH 断开原因未查明（sshd active、22 端口 OPEN、MaxStartups 100、无 fail2ban 拦截记录、`BatchMode=yes` 与 `sshpass -p` 都 `Connection closed`）。
2. **`tests/` 与 `.gitignore` 的载体差异**：`patchedDependencies` 打补丁时 `tests/` 会进安装树（已验证 9 文件），但 `src-work` 的 `.gitignore` 本就不存在（我已从 G5 剔除）。
3. R1 指出的「包外遗漏」仍未处理：`src-work/backups/` 63 文件不在任何 git；profile `cordis.patch.yml` 与 systemd drop-in 不在「必重建层」清单；`refresh.sh` 的 MOD 列表与 patch 段数需保持同步（本轮已修 `.gitignore` 差异）。

## 6. 下一步（目标模式继续）

1. 查清 SSH 断因并恢复通道（这是「能重启」的前提）。
2. 把 `patchedDependencies` 方案写进「必重建层」清单 + 回滚链（25 §6），让下次升级不再无声覆盖。
3. README / g5 README 的口径订正（73/73→81/81、3983→4017 行、`webErrorFromResponse` 实际只挂 4 字段而 `keylessRejected` 靠正则兜底）。
4. 派第三位专家复审本轮 `patchedDependencies` 方案的持久性（尤其 `plugin_manager` 走 `pnpm add` 时是否真的不会触发 `ERR_PNPM_UNUSED_PATCH` 误伤）。

---
无凭证值写入本文件。

## 7. 可持续性加固（本轮最终交付）

1. **`restore-plugin.sh`**（仓库根 `websearch-research/restore-plugin.sh`，65 行）：把「校验 G5 段数 → pin 2.8.4 → 写 `patchedDependencies` → 重算 lock（不动 node_modules）→ frozen install 打 patch → 三条标志位 + 36 段逐字节自检」固化成一条命令。**已端到端实跑**，输出 `patched tree restored: 36 segments byte-identical`，耗时 1.8s，幂等。
2. **`.gitignore` 从 G5 剔除**：它是发布仓库为忽略 node_modules 自加的，不属于插件面；剔除后 36 段 / 4017 行，双份 `cmp` 一致（`e96dd442b4ce`）。
3. **管理通道**：IPv4 `127.0.0.1:22` / `20000` / `29922` 全断；**IPv6 `::1` + 密码可用**，记入操作手册。
4. **`Packages: -12` 已判定无害**：是 lock 里登记的跨平台 optional 二进制（darwin/win32/arm64/musl），本平台不适用，每次 frozen install 都会「删」这 12 个占位。8 个声明依赖全部在位、`@anthropic-ai/claude-agent-sdk-linux-x64` 与 `@openai/codex-linux-x64` 在位、subagent 插件正常、`did not activate` 计数 0。

## 8. 仍待办（下一轮）

- 把 `restore-plugin.sh` + `patchedDependencies` 写进 25 §6 回滚链与「必重建层」清单。
- README / g5 README 口径订正（73/73→81/81、3983→4017、`webErrorFromResponse` 实际 4 字段 + `keylessRejected` 正则兜底）。
- 第三位专家复审 `patchedDependencies` 在 `plugin_manager install_bundle` 真实路径下的误伤风险。

## 9. 环境抖动记录（2026-11-22 21:24–21:27）

| 时刻 | 现象 | 判定 |
| --- | --- | --- |
| 21:24 | 一次 `web_search`：`all enabled backends failed (5)` — `parallel`/`firecrawl` 30s 超时、`ddg`/`searxng` 8s 超时 | **瞬时出口抖动**，非补丁回归 |
| 21:27 | 同一 query 复跑：6 后端正常（`ddg`/`parallel`/`tinyfish` ✓、`exa` 已冷却、`searxng`/`firecrawl` 已知降级） | 恢复正常 |

同时刻旁证：`36/36` 逐字节、`81/81` 单测全部成立；`curl` 经代理拉 `example.com` 200（6.5s）、`api.tavily.com` 200（4.1s）、`mcp.exa.ai` 405（2.6s）、`search.parallel.ai` 404（2.5s）—— 网络与 DNS 正常，只是那一分钟内后端响应慢到超时。

**判别规则（写进排查清单）**：`all enabled backends failed` 不一定是代码问题；先看「同一 query 复跑是否恢复 + 补丁标志位是否还在」，两条都成立就是出口抖动。
