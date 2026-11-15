# 69 · 目标模式 G1：可观测性与冷却时序（骨架 → Lead 补完）

> 目标模式第 1 轮（2026-11-11 22:30 → 11-12 05:15）。专家 G1 落盘骨架 + 中途预警（ws.register 契约定案）；由 Lead 用一手实证补完并执行。唯一写文件为本报告。
> 运行时：服务 PID 170703（11-11 23:06:40 重启），runtime `/opt/dsh-0222/`，cmdline 无 `--patch`，DSH_HOME=/home/dsh/.dsh。

## 逐条裁决表

| # | 项 | 裁决 | 证据 / 执行 |
| --- | --- | --- | --- |
| 1 | **ws.register disposer 契约** | **E → 定案（P1，已修）** | 新 runtime `dsh-host-webserver/lib/index.js:375` 的 `register(route)` JSDoc 明写 `@returns the disposer removing the route`，返回 `() => table.delete(route.path)`；`dsh-client-connection/lib/index.js:871,1058` 官方用法 `ctx.effect(() => webServer.register(route), label)`；AGENTS.md「Registrations are effects: a registry's register() returns the disposer」。⇒ 4 处 `ws.register` 丢 disposer 是**真缺陷**（HMR/卸载后路由残留，重载时 `duplicate (kind, path)` 抛错）。已修：`health.js`/`settings-api.js` 各返回 `[disposer]`，`history.js` 返回 `[disposerA, disposerB]`（过滤非函数返回值以兼容 fixture），`index.js` 用 `webCtx.effect(() => {...; return () => disposers.forEach(d => d()); }, "unified-search: web routes")` 包一层。行为级测试 `route registration returns disposers that remove every route` 断言 4 个 disposer 真删路由 |
| 2 | **D3 `⏸cooled` 无秒数且状态过期** | **成立（P2，已修）** | 根因：`cooled` 是扇出开始时的快照，遥测在全部后端返回后（可达 8s）才用 `Date.now()` 重新判断 → 窗口到期时 `cooledAnnotation` 返空串 → 兜底裸串 `⏸cooled`，模型误以为仍在冷却。修法：改用同一 `nowMs`（`provider.js:294` 扇出时刻）计算注记，且 `if (ann) cooledParts.push(...)`（过期就**不输出**，而非误导）。断言：`cooledAnnotation(entry, nowMs) === "⏸cooled 24s"`、渲染时刻过期返 `""`、源码用 `nowMs` 且无裸串兜底 |
| 3 | **D8 health/history 缺生效上限/剩余冷却/配额分类** | **成立（P2，已修）** | `health.js` 顶层追加 `requestedMaxResults`（用户 numResults），每后端追加 `rateLimited` / `keylessRejected` / `cooledUntilMs`；`history.js toBackendObservability` 追加同样 3 个后端字段。**全部追加、不改名**，旧键保留（断言逐个核）。运行态实证：`health.requestedMaxResults=8`、firecrawl `rateLimited=true / keylessRejected=true / cooledUntilMs=1794431612599` 有值；history 6 个后端条目带齐新字段且无 apiKey 泄漏 |
| 4 | 新发现（D3/D8 相关） | **1 条 P1（见 70 号）** | G2 另发现 `void write(...)` 让异常逃出 guarded catch → 无响应 + unhandledRejection，已在 70 号修 |

## 已确认无误

1. `cooledAnnotation` 本身正确（`isCooled` + `Math.max(0, ceil(...))`），缺陷只在**调用时机**。
2. `ctx.effect` 在 `ctx.inject(["webServer"], (webCtx) => ...)` 回调内可用；`webCtx` 与实际注册用的 `webCtx.webServer` 同源。
3. 3 个 `registerXxxRoutes` 对「`register` 不返回函数」的 fixture/旧实现做了防护（`filter(typeof d === "function")`），不会让 `disposers.forEach(d => d())` 崩。
4. 重启后 `GET /api/unified-search/settings`、`/health`、`/api/websearch/history` 三条路由全部 200，证明 effect 注册未丢路由。

## 无法验证（E）

1. 真实 HMR / 插件卸载后 disposer 被 Cordis 调用（无浏览器控制、无 reload 触发手段）。
2. `cooledUntilMs` 在真实 429 上游带 `Retry-After` 头时的值（未抓到原始响应头）。
3. GUI 目视新字段（无已连接页面）。

## 5 条反直觉

1. 一条跨 3 次 runtime 切换一直标 E 的遗留，最后在**新 checkout 的 `dsh-host-webserver` JSDoc** 里一句话定案——之前不是查不到，是查错了包路径。
2. 修「⏸cooled 无秒数」的正确解法不是补秒数，而是**用扇出时刻的时间戳**，因为问题出在遥测与决策用了两个不同的 `now`。
3. 让 `registerXxxRoutes` 返回数组时，必须防「register 不返回函数」的旧实现，否则 effect 回收时会 `undefined()` 崩——fixture 正好暴露了这点。
4. 追加可观测字段时「不改旧键名」比「字段多」更重要：health 的 8 个旧键是 GUI/运维既有消费者。
5. `keylessRejected` 与 `rateLimited` 同时为 true 不是矛盾：keyless 拒绝被归类为配额类冷却，但行动项是配 key 而非等待。

---
无凭证值写入本文件；所有结论可由文中命令与运行态输出复现。
