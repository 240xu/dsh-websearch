# 103 · 调试端口（2026-11-23）

> 用户「另开端口协助调试」。已在 **127.0.0.1:3090** 开第二条入口，转发到正在运行的 3080。

## 1. 已落地

| 项 | 值 |
| --- | --- |
| 监听 | **127.0.0.1:3090**（仅回环，不对外） |
| 转发 | → 127.0.0.1:3080（同一个 dsh web 进程，PID 1387026） |
| 工具 | `socat TCP-LISTEN:3090,reuseaddr,fork,bind=127.0.0.1` |
| 脚本 | `.artifacts/websearch-research/debug-port.sh`（start / stop / status，幂等） |
| 日志 | `/tmp/dsh-debug-port-3090.log` |
| PID 文件 | `/tmp/dsh-debug-port-3090.pid` |

## 2. 端到端验证（真实输出）

```
3090 裸访          -> HTTP 401   （fence 正常拒绝未授权）
3090 ?token=…      -> HTTP 303 + set-cookie: dsh-auth-…（脱敏）
3090 带 cookie     -> HTTP 200
3090 /api/unified-search/health -> HTTP 200（enabled=6, requestedMaxResults=8）
```

## 3. 为什么用转发而不是「再起一个实例」

| 方案 | 可行性 | 问题 |
| --- | --- | --- |
| **A. socat 转发（已采用）** | ✅ | 无。走同一进程，共享 settings/health/history，看到的就是真实状态 |
| B. 另起 `dsh web --port 3090` | ⚠️ | 同一 profile 会被两个进程同时打开：`$DSH_HOME/cache/websearch` 的磁盘缓存、history.json、settings 会互踩；且要重启才生效，达不到「协助调试」目的 |
| C. 换 `DSH_HOME` 起独立实例 | ❌ | profile 路径由 `DSH_HOME` 推导 ⇒ 换 home 就找不到 `profiles/web/node_modules`，插件加载不了 |

## 4. 浏览器的 fence 注意

`--trusted-host` 只有 `192.168.1.7` 与 `dsh.sepic.space`。但 **fence 检查的是 Host 头，不看端口**：

- 浏览器访问 `http://127.0.0.1:3090/` ⇒ Host 是 `127.0.0.1:3090` ⇒ 401/403（与 3080 行为一致，**这是预期**）
- 带 `?token=` 后与 3080 完全一致（303 → cookie → 200）

⇒ **用 3090 的唯一门槛和 3080 一样：需要 token。**

## 5. 用法

```bash
bash .artifacts/websearch-research/debug-port.sh start 3090 3080   # 幂等
bash .artifacts/websearch-research/debug-port.sh status 3090
bash .artifacts/websearch-research/debug-port.sh stop   3090
```

换端口直接改第一个参数即可（例如 `start 3091 3080`）。

## 6. 边界（诚实说明）

- 这是**同一进程的第二条入口**，不是第二套实例：不会因为「在 3090 上」看到不同行为。
- 只能帮助 **UI 侧调试**（换个浏览器窗口/换端口避免 cookie 冲突、同时开两个视图对比）。
- 如果目的是「改插件代码后不重启就看新行为」，这条做不到 —— 见 [96 号](96-hot-reload-findings.md)：`cordis-plugin-loader` 的 `Tree.import()` 无 cache-busting，改 `lib/*.js` 必须重启。
- 服务重启后 socat 仍存活（它是独立进程），但若 3080 短暂不可用，访问 3090 会得到连接错误。

---
无凭证值写入本文件。
