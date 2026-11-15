# 38 · 端到端「保存」实测（2026-11-07 15:20，Lead 独立复跑）

> 此前所有轮次都只做「只读对比 settings↔health」，**从没真正 POST 过 settings**。
> 本轮用 GUI token + 会话 cookie 做了一次无害写入闭环，直接回答用户「那个保存什么的没问题吧」。
> 只改 `numResults`（8→9→8），已改回；未写入任何第三方 API key、未改其它设置。

## 方法

```bash
T=$(grep -oE 'token=[A-Za-z0-9_-]+' /home/ova/re-agent/dsh-web.log | tail -1 | cut -d= -f2)
C=/tmp/save-test.cookies
curl -sS -L -c "$C" -b "$C" -o /dev/null "http://127.0.0.1:3080/?token=$T"   # 303 -> 200, 拿会话 cookie
```

## 实测输出（逐字）

| 步 | 请求 | 结果 |
| --- | --- | --- |
| 0 基线 | `GET /api/unified-search/settings` | `revision:0`、`numResults:8`、`resultTelemetry:true`、`enableDdg:true` |
| 1 写入 | `POST /api/unified-search/settings` + `{"ops":[{"op":"set","path":["numResults"],"value":9}]}` | **HTTP 200**、`{"ok":true,"writable":true,"applies":"live","revision":1,"value":{"numResults":9,...}}` |
| 2 读回 | `GET .../settings` | `revision:1`、`numResults:9`、`user: {'numResults':9, 'enableFirecrawl':True, 'enableTinyfish':True}` —— **值确实落进 user 层** |
| 3 执行侧 | `GET .../health` | `enabled:6`，ids `['exa','parallel','ddg','searxng','firecrawl','tinyfish']`（PR #7 修复后 settings 的 enable 开关驱动执行） |
| 4 改回 | `POST .../settings` + `{"ops":[{"op":"set","path":["numResults"],"value":8}],"expectedRevision":1}` | **HTTP 200**、`ok:true`、`revision:2`、`numResults:8` |
| 5 终验 | `GET .../settings` | `revision:2`、`numResults:8` —— 回到基线（仅 revision 递增） |

## 结论

1. **保存链路本身可用**：`validateOp` 接受了 `set / numResults / 9`，`settings.mutate` 成功，`revision` 按预期递增，`user` 层落盘，GET 读回一致，`expectedRevision` 乐观并发控制生效。等级 **D**（真实实跑）。
2. **PR #7 修复的效果仍在**：`health enabled=6` 与 `settings.user` 的 `enableFirecrawl/enableTinyfish=true` 一致 —— 不再是「面板显示开、执行为关」。等级 **D**。
3. **`numResults` 这类全局参数**：settings 写入成功且 `current()` 会在每次搜索时读取（PR #7 的 `current = () => settings.describe()...`），理论上应生效；但 health API 不暴露 `numResults`，**本次未通过一次真实搜索观察条数变化来硬证**（见下方边界）。等级 **A/D**。
4. **无状态残留**：已改回 8，`revision` 从 0→2 属正常追加历史；`user` 里除 `numResults:8` 外保持原样（firecrawl/tinyfish 仍 true，是用户自己开的）。

## 诚实边界

- **未写真实第三方 API key**：`credentials/set` 走 `/api/remote.mux` WebSocket 多路复用，纯 curl 无法完整模拟 client RPC；本轮验证的是 **settings 保存链路**（`settings.mutate`），不是 **凭证写入链路**（`remote.credentials.set`）。两者是不同的服务对象（见 33 号官方对齐专家的任务）。
- 未通过真实搜索断言「numResults=9 时最多 9 条」——需在写入 9 后立刻调用 `web_search` 观察，本轮为避免干扰只做到读回 + 改回。
- `firecrawl` keyless 匿名额度被拒、`searxng` 反爬页、`exa` 429 属后端额度/环境降级，与保存链路无关。

## 追加核查：`inject` 加 `remote.credentials` 有没有引入 Issue #4 式的 deadlock？

读上游 issue 发现 **[Issue #4](https://github.com/240xu/dsh-websearch/issues/4)**（open）：插件 client 的 `inject` 曾含已移除的 `settingsScope`，在 DSH ≥0.1.7 上 `pending (waiting for service: settingsScope)` → **整个 web boot deadlock**、client half 不激活。我们加 `remote.credentials` 属**同一类风险**，必须排除：

| 核查 | 结果 |
| --- | --- |
| `dsh-api-remotes` 是否在组合树 | `dsh web --dump-config` 命中 `id: api-remotes` ✅ |
| host 是否按 `remote.<ns>` 注册 | `dsh-api-gateway/lib/client.browser.js:2074 remoteServiceKey()` + `RemoteNamespaceService` 构造函数 `super(ctx, remoteServiceKey(name))` ✅ |
| 官方插件是否也声明该 key | `dsh-client-ui-settings-models/lib/client.js:4417` 的 inject 含 `remote.credentials`（还有 llm/settings/session）✅ |
| 启动日志 | **无** `pending` / `waiting for service: remote.credentials` / `without inject` 错误；唯一 `1 entry did not activate` 明确归属 `dsh-purge-community`（缺 `yaml` 包），与本改动无关 |
| client fiber 是否激活 | GUI 认证后 200、settings API 200、保存 POST 成功（revision 0→2，本文 §1–§5）⇒ 激活 ✅ |
| 另注 | `revision` 后续涨到 7（专家取证期间另有只读/写入探测），`user: {'numResults':8, 'enableFirecrawl':True, 'enableTinyfish':True}`，numResults 已回到 8 ✅ |

⇒ **结论**：`remote.credentials` 是 host 真实注册的命名空间（不同于已移除的 `settingsScope`），加进 inject 不会 deadlock。等级 A/D。

**另发现两个此前未展开的相关 issue**（供挖掘/对抗专家核对）：
- **[Issue #6](https://github.com/240xu/dsh-websearch/issues/6)**「【BUG】保存按钮怎么没有？」（open, 2026-10-30，仅截图无文字）——可能与保存按钮的 disabled 条件（`state.stagedCount === 0 || state.writable === false`）或 client fiber 未激活相关；本轮 settings API 写入成功，但**未在浏览器里目视确认按钮是否存在**，标 E。
- **[Issue #3](https://github.com/240xu/dsh-websearch/issues/3)**「升级到 dsh 0.12-rc1 之后无法使用」——`installSettingsSection` 导出不存在（0.12 时代 API 面变化），本机 0.2.1-rc.2 不受影响。

---

## 与既有报告的关系

- 补上了 [25 §10](25-execution-log.md) 的「未在浏览器里手工点保存」边界的一部分（改为用认证 API 真实 POST）。
- 补上了 [25 §11](25-execution-log.md) 的「settings↔health 一致性」从只读对比升级为读写闭环。
- 供 30（对抗·保存）/ 32（对抗·运维）/ 33（官方对齐·客户端）三位专家交叉核对；若其结论与本文相左，以可复现命令重跑裁决。

---

无凭证值写入本文件；仅改无害字段且已改回。
