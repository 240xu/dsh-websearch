# 96 · 热插拔能力实测（用户要求「不要老是重启」）

> 2026-11-23，用户在事故恢复后要求「用热插拔，不要老是重启」。本文件是**实测结论**，不是推测。
> 方法：读 `/opt/dsh-0222` 下 `cordis` / `cordis-plugin-loader` / `dsh` 源码 + 跑真实探针实验。

## 1. 结论（分三层，不要混为一谈）

| 层 | 能否热生效 | 证据 |
| --- | --- | --- |
| **settings / 配置**（`numResults`、`enabledBackends`、`cacheTtl`、`breaker*`、`multiQueryEnabled`、`deepCoverage`、各 `*BaseURL`/`*Model`/`*ApiKeyEnv`） | **能，已经是热的** | `provider.search()` 每次调 `resolveOptions(ctx, current())`，`current()` 每次读 `settings.describe()`（`lib/index.js:498,508`）。改 settings 后下一次搜索立即生效，无需重启 |
| **`lib/*.js` 代码改动** | **不能**（当前 loader 无 cache-busting） | 探针：把 `TELEMETRY_TAG` 改成带 `HOTPROBE` 后缀 → 不重启跑 `web_search` → 遥测仍是原串 `" (diagnostic only, not a source)"`，无 `HOTPROBE` |
| **插件整体重载**（dispose + 重新 `import`） | **技术上可行，但当前没有触发入口** | loader 的 `Tree.import()` 是裸 `import(...)`（`cordis-plugin-loader/lib/index.js:165,343-355`），Node 会缓存模块 ⇒ 必须带 cache-busting query 才能拿到新代码 |

## 2. 为什么改文件不生效

`cordis-plugin-loader` 的 `Tree.import()`：

```js
return (await import(__rewriteRelativeImportExtension$1(
  /* @vite-ignore */
  new URL(name, this.ctx.baseUrl).href
)));
```

**裸 URL，无 `?t=`**。Node ESM 对同一 URL 只求值一次 ⇒ 改文件后再次 `import` 拿到的是**旧模块实例**。

**概念验证**（`/tmp/mod.mjs`）：

```
第一次:            ORIGINAL
改文件后带 query:  CHANGED     ← import("...?t=" + Date.now()) 能拿到新代码
```

⇒ 技术上绕开缓存的方式是存在的（query 后缀），只是 loader 没用。

## 3. 存在的重载机制（但没有入口）

- `cordis` 的 `fiber._reload()` / `_setEpoch()`：只在**依赖服务 uid 变化**时触发，不是文件监听（`cordis/lib/index.js:612-641`）。
- `cordis-plugin-loader` 有 `entry.update(config)` → `fiber.update(...)`（`:82,293,313,488`），并监听 `ctx.on("internal/update", ...)`（`:112,760`）。
- `dsh web` **没有** `--watch` / `--hot` 选项（`--help` 只有 host/port/no-open/public-url/trusted-host/tls-*）。
- 没有 `/api/reload` 之类端点（认证后实测 `/api/plugins`、`/api/plugins/reload`、`/api/plugin-manager`、`/api/settings` 全 404）。

⇒ **「改代码不重启」在当前 runtime 下没有官方通道**。

## 4. 那「不要老是重启」该怎么办

### 4.1 已经不用重启的部分（占日常改动的大头）

配置类改动**本来就是热的**。我们历轮 90% 的「改完要重启」其实是**代码改动**（补丁），不是配置。真正需要重启的场景只有：改了 `lib/*.js` 或 `patches/`。

### 4.2 代码改动的最小重启代价

实测一次完整「改代码 → 生效」链路：

```
bash restore-plugin.sh        # 2.6s（含 rm -rf + 重解包 + 重打 patch + 36 段自检）
ssh -6 ova@::1 'sudo -n systemctl restart dsh-web.service'   # ~4s
```

合计 **~7 秒**，且 `restore-plugin.sh` 已保证幂等可恢复。这比「想办法做不重启热重载」更省事、风险更低。

### 4.3 如果确实要做真热重载（需要改 loader，不在我们控制内）

可行路径（按代价排序）：

| 路径 | 做法 | 代价 / 风险 |
| --- | --- | --- |
| A | 给 `cordis-plugin-loader` 的 `Tree.import()` 加 `?t=${Date.now()}` | **改官方 runtime 源码**，升级即丢；且会破坏模块单例语义（两个实例同时存在） |
| B | 在插件内部用 `ctx.effect` + 可重入的 `registerSearchProvider`：每次 settings 变更时先 `dispose()` 再重新注册新 provider | **只对「配置变化」有效**，对代码变更无效（还是要重新 import） |
| C | 用 `plugin_manager` 的 disable→enable 触发 fiber reload | 仍需 `import` 新代码 ⇒ **同样受 ESM 缓存限制**，除非同时做 A |
| D | 开发期用 `dsh web --patch` + 外部文件监听脚本杀掉重启 | 就是「老是重启」，只是自动化了 |

**结论**：A 是唯一能真正「改代码不重启」的路，但它要改官方 runtime；B/C 只能解决配置层（而配置层已经是热的）。**所以本轮不做 A，维持「改代码 → restore + 重启（合计 7 秒）」**，并把这条写进操作手册。

## 5. 本轮顺带确认的两件事

1. **settings 热生效已被实测过**：`resultTelemetry=false` 立即生效（63 号）；`enabledBackends` 收窄后下一次搜索只打指定后端（V3 67 号）；`numResults 8→3` 立即返回 3 条（R5）。
2. **探针实验未留痕**：`prompting.js` 的 `HOTPROBE` 已还原，`md5` 与 `src-work` 一致；当前 36/36 逐字节仍成立。

## 6. 给用户的一句话

**配置改动不用重启（本来就是热的）；只有改 `lib/*.js`/`patches/` 才需要，且现在只要 7 秒（`restore-plugin.sh` + 重启），比改官方 runtime 做真热重载安全得多。** 如果你希望连代码改动也不重启，那就需要动 `cordis-plugin-loader` 的 `Tree.import()` 加 cache-busting——那是改上游 runtime，升级会丢，我可以做但要你点头。

---
无凭证值写入本文件。
