# 108 — `index.js apply` / `resolveOptions` / `cache.js createSearchCache` 拆解方案

> 专家 S4 交付。只读分析，未改任何源码/配置/运行时。唯一写入文件：本报告。
> 目标：`/home/ova/dsh/.artifacts/websearch-research/src-work/plugin/lib/`
> 方法：read / grep / glob / `node` 实测（`strace` 系统调用计数、变异测试、A/B 基准、A.6 端到端探针）。
> 基线：真树 `node --test tests/*.test.js` = **81/81 通过**（本报告所有变体都在 `/tmp` 的副本上跑，真树未动）。

---

## 0. ⚠️ 盘面在分析期间发生了两处变更（必读）

| 项目 | 任务假设 | **我实测到的** | 说明 |
| --- | --- | --- | --- |
| `index.js` 总行 | 573 | **558**（md5 从 `37cb6a67…` → `da6d3f73…`，16:18 被改） | 布局重建 |
| `apply` | 442-573 = **132** | **428-558 = 131**（`-1` 行：`toggleMap` 13 项 → 单行派生表达式） | 见下 |
| `resolveOptions` | 323-422 = **100** | **323-408 = 86**（`-14` 行：`toggleMap` 字面量 13 项 + 注释被换成 3 行派生） | 见下 |
| `cache.js` | 162 行 / 91 行 `createSearchCache` | **172 行 / 101 行** | 新增 `knownCount` 短路 |
| `provider.js` | — | 582 行；N2 摊平在 **267-274**（分析中途曾被改成 585 行后又回退，md5 稳定 `877b1943…`） | 已复核 |

**`index.js` 的变更内容**（`grep`/`diff` 确认，与拆分无关，是另一路的优化）：
`resolveOptions` 里手写的 13 项 `toggleMap`（原 333-351，19 行）被替换为一行派生键：
```js
336:  enabledBackends = ALL_BACKENDS.filter((id) => config?.[`enable${id.charAt(0).toUpperCase()}${id.slice(1)}`] === true);
```
我验证了它的正确性：13 个派生键 **全部存在于 Config**（`enableExa`…`enableTinyfish`，`grep` 0 缺失）；
逐 toggle 单开 → 恰好启用该后端 **13/13**；空 config → 默认 4 个 keyless；显式 `enabledBackends` 仍优先。
**所以本报告按 558 行的新盘面给段表，同时保留"132/100 行"作为任务给出值的对照。**

`cache.js` 的 162 行原件在 `src-work/backups/opt-evict-20261123T144137/cache.js.orig`（md5 `e266d074…` 之前），
两者只差 `knownCount` 三处（见 §C）。

---

## A. `apply`（`index.js:428-558`，**131 行**；任务口径 132 行）

### A1. 段表（行号覆盖校验：仅空行未覆盖）

| 段 | 行 | 行数 | 代码行 | 做的事 |
| --- | --- | --- | --- | --- |
| 头部状态 | 429-431 | 3 | 2 | `let current = () => config`（惰性配置源）、`let settingsForms`（0.2.x 表单实例） |
| **settings 服务接入**（`ctx.inject(["settings"])` 整体） | 433-467 | 35 | 23 | 见下两行 |
| ├ 0.1.5 分支 | 435-443 | 9 | 8 | `settings.installSection(ctx, NAMESPACE, Config, config, {setSource, onChange})`；`return` 结束注入回调 |
| └ 0.2.x 分支 | 444-466 | 23 | 12 | `describe`+`mutate` 双检 → 捕获 `settingsForms`；`current` 改每次 `findPluginRow(settings.describe())` 读活值（460 行） |
| **Config schema 注册** | ⚠ **不在 apply 内** | — | — | `Config` 是模块级 `z.object({...})`（160-283，124 行，含 13 个 `enable*` 与 13 个 `*ApiKeyEnv`/10 个 `*BaseURL`）；apply 只把它交给 `installSection`（437）与 `getConfig: () => Config`（543） |
| **history 与 cache 装配** | 469-482 | 14 | 7 | `resolveStoreDir()` → `createSearchCache({dir: storeDir/results, ttlMs: () => resolveOptions(ctx, current()).cacheTtlS*1000, maxEntries: CACHE_DEFAULTS.maxEntries})` → `createHistoryStore({dir, maxEntries: HISTORY_MAX_ENTRIES})` |
| **provider 装配** | 484-497 | 14 | 12 | `createUnifiedSearchProvider({ctx, resolveOptions: () => resolveOptions(ctx, current()), backends: BACKENDS, cache: searchCache（直接传 store，490）, history:{record: 门控 historyEnabled 后 record}})` |
| **provider 注册** | 499 | 1 | 1 | `ctx.web.registerSearchProvider(provider)`（裸调用，无 disposer 包裹——`dsh-web` 内部自己 `ctx.effect`，见 §A4 附注） |
| webServer 注入头注释 | 501-505 | 5 | 0 | 说明这是可选、晚挂载的 host 服务；headless/CI 不跑回调 |
| **注入开 + `getConnection`** | 506-513 | 8 | 8 | `ctx.inject(["webServer"], (webCtx) => {`；`getConnection` try/catch 包 `ctx.get("connection")` |
| **effect 注释 + 开 + `disposers`** | 514-519 | 6 | 2 | **`webCtx.effect(() => {`（518）** + `const disposers = [];`（519） |
| 增量注册注释 | 520-523 | 4 | 0 | 说明 duplicate 会抛、中途抛出必须回滚否则路由永久泄漏 |
| **三组 HTTP 路由注册** | 524-546 | 23 | 18 | `registers = [health(525-530), history(533-537), settings(541-545)]`，每项是 `() => register*(webCtx.webServer, {...})` 闭包，各自携带依赖 |
| **增量 disposer** | 547-548 | 2 | 2 | `try { for (const register of registers) disposers.push(...register()); }`（548） |
| **catch 里逆序回滚再 throw** | 549-554 | 6 | 6 | `catch (err) { for (const dispose of disposers.reverse()) { try{dispose()}catch{} } throw err; }`（550-553） |
| 合成 disposer + effect 收口 | 555-557 | 3 | 3 | `return () => disposers.forEach((dispose) => dispose());`（555）；`}, "unified-search: web routes");`（556）；`});`（557） |

合计 **131 行 / 86 代码行 / 45 注释与空行**（非代码占比 34%）。

**"Config schema 注册"这一项任务列进了 apply，但实际不在 apply 里**：`Config` 是模块级导出（160-283），
apply 对它的全部作为就是"把 `Config` 传给 `installSection`（437）+ 传给 settings 路由（543）"。
这一点很重要：**apply 里没有 schema 逻辑，拆 apply 不会碰 schema**。

### A2. 关键约束：`webCtx.effect` 那段**不能拆散**

**精确行号：effect 调用 518 → 556；A.6 泄漏修复的三件套是 547-554。**

```
518:    webCtx.effect(() => {
519:      const disposers = [];
...
547:      try {
548:        for (const register of registers) disposers.push(...register());
549:      } catch (err) {
550:        for (const dispose of disposers.reverse()) {
551:          try { dispose(); } catch { /* best-effort rollback */ }
552:        }
553:        throw err;
554:      }
555:      return () => disposers.forEach((dispose) => dispose());
556:    }, "unified-search: web routes");
```

**为什么拆了会破坏回滚顺序（机制）**
1. `WebServer.register(route)` 在 `(kind, path)` 重复时**抛错**——真机实现
   `/opt/dsh-0222/node_modules/@deepseek-ai/dsh-host-webserver/lib/index.js:377`：
   `throw new Error("webserver: duplicate ${route.kind} route \"${route.path}\"")`（`table.has(route.path)` 判定）。
2. 三组注册共 4 条路由，是**逐条 get-or-throw**。若第 3 组（settings）抛，前两组已拿到的 2 个 disposer
   **只存在于 `disposers` 数组里**。
3. `ctx.effect(工厂)` 在工厂**抛异常**时不提交、不产出 disposer → 那 2 条已注册路由**永久留在表里**（无主 disposer）。
   下一次 reload 立刻撞 duplicate → "一次失败、永久失败"。
4. 因此「**边注册边收集**（548）+ **catch 里 `.reverse()` 逐个回滚**（550-552）+ **原样 `throw err`**（553）」
   必须是**同一个 try 块内的原子序列**：
   - 拆开「push」与「catch 回滚」→ `disposers` 作用域断开，回滚拿不到已注册的 disposer；
   - 去掉 `.reverse()` → 释放序变成与注册序相同（不是后进先出），且丢掉"后注册者先释放"的次序保证；
   - 去掉 `throw err` → 上层看不到失败，插件"静默半启动"（4 条路由缺一条，还不报错）。

**证据 1｜源码级 pin（三条正则硬钉这三句，且读的是 `lib/index.js`）**
`tests/settings-api.test.js:246-254`
```js
// 65 号 A.6 / E1: a duplicate route mid-registration must not leak the
// routes already acquired. Roll them back before rethrowing so a later
// reload can register the full set again.
test("partial route registration rolls back on a duplicate route", async () => {
  const src = readFileSync(new URL("../lib/index.js", import.meta.url), "utf8");
  assert.match(src, /for \(const register of registers\) disposers\.push\(\.\.\.register\(\)\)/);
  assert.match(src, /for \(const dispose of disposers\.reverse\(\)\)/);
  assert.match(src, /throw err;/);
```
→ **这三句必须字面留在 `lib/index.js`**。我实测把 `registerWebRoutes` 抽到 `lib/routes.js`（+re-export）：
`pass 80 / fail 1`，失败项正是本测试（`settings-api.test.js` 中 `✔ pass 18 / ✖ fail 1`）。
→ **同文件内三分（变体 A）**：`81/81` 全过 ✅。**边界很硬：能拆成函数，不能拆成文件。**

**证据 2｜行为级 pin（同文件 255-283 用内联副本模拟"第 3 组失败"）**
```js
const disposers = [];
const registers = [ health, history, () => { table.set("/api/unified-search/settings", {}); throw "duplicate" }, settings ];
try { for (const register of registers) disposers.push(...register()); assert.fail(...); }
catch (err) { for (const dispose of disposers.reverse()) dispose(); }
assert.equal(table.size, 1, "only the foreign pre-occupied route may remain");
```
断言 `table.size === 1` 且只剩那条外来占用。**注意它是测试内联副本，不是真 `apply` 的 effect**——
真 `apply` 的行为由下条补测。

**证据 3｜我实测的真 `apply` 端到端（补上测试没覆盖的缺口）**
自建 ctx（`webServer.register` duplicate 抛、`effect` 记录工厂是否提交），跑**真** `apply(ctx, {})`：

| 场景 | 剩余路由 | effect 提交次数 | 结论 |
| --- | --- | --- | --- |
| 干净加载 | 4（health / settings / websearch/history / websearch/history/clear） | 1 | `dispose()` 后归 0 ✅ |
| 预占 `/api/unified-search/settings`（第 3 组抛） | **仅 1 条**（那条外来占用） | **0** | 已注册的 2 条被回滚、无 disposer 泄漏 ✅ |
| 同上，但**删掉 catch 回滚**（变异 M4） | **4 条全留** | 0 | 泄漏 3 条 ❌；`pass 80 / fail 1`（仅源码正则挡下） |

→ **`reverse()` 回滚段是 apply 里唯一"删了就立刻回归"的代码，也是最不能拆的代码。**

### A3. 拆分方案（哪些段可提成独立函数）

**可提（3 个，全部同文件）**

| 新函数 | 来源行 | 目标行数 | 说明 |
| --- | --- | --- | --- |
| `registerSettingsSource(ctx, config)` | 429-467 | 43 | 返回 `{ current, settingsForms }`。**必须留 `lib/index.js`**：`findPluginRow(settings.describe())`（460）被三条测试正则钉住（`lead-20261107.test.js:87-89`、`lead-20261107-p0.test.js:111-113`、`lead-20261108-interaction.test.js:64`） |
| `createStores(ctx, getConfig)` | 469-482 | 17 | 返回 `{ storeDir, searchCache, historyStore }`。**必须把 `current` 改成传入的 `getConfig`**：`ttlMs` 闭包（479）靠它读活 ttl；若仍捕获原 `current` 变量会串味 |
| `registerWebRoutes(webCtx, registers, deps)` | 518-556 | 18（effect 包壳）+ 调用方 registers | **整段搬、一个字不改**（含 518 effect 开、547-554 三件套、555 合成 disposer、556 标签）。闭包中的 `ctx`/`current`/`historyStore`/`settingsForms`/`getConnection` 改由 `deps` 传入 |

**不可提**：506-513（注入开 + `getConnection`）、524-546（`registers` 闭包表，依赖环太多）——
两者留在 apply，`registers` 由 apply 构造后**作为参数**交给 `registerWebRoutes`（这是 A.6 不被打散的关键：
注册表与"注册+回滚"分离，但"注册+回滚"自身是一个不可分的函数体）。

**实测行数变化（三个变体，全部 `node --check` 通过；均在 `/tmp` 副本上）**

| 变体 | `apply` | 新增函数 | `index.js` 总行 | 测试 | A.6 探针 |
| --- | --- | --- | --- | --- | --- |
| 原始（新盘面） | 428-558 = **131** | — | **558** | 81/81 ✅ | 六元组：`remaining=1/effects=0` ✅ |
| **A：同文件三分（保留注释）** | 521-588 = **68** | `registerSettingsSource` 43 + `createStores` 17 + `registerWebRoutes` 18 | **588**（**+30**） | **81/81 ✅** | 与原始**逐字节相同** ✅ |
| B：`registerWebRoutes` 提到 `lib/routes.js` | — | `routes.js`（含那三句） | 573 盘面：513 + 23；558 盘面亦重测（`grep` 命中 0/1：`index.js:0`、`routes.js:1`） | **80/81 ❌**（`settings-api.test.js`：`pass 18 / fail 1`，失败项 = 本测试；`settings-api.test.js:252` 正则失配） | — |

变体 A：`apply` **131 → 68 行（-63，-48%）**；文件 558 → 588（**+30**，比 573 时代实测的 +52 少了 22 行，
因为 `toggleMap` 已被压成一行、`createStores` 也变短）。
净收益是"入口函数 -48%"，代价是文件 +5.4%；注释被搬运部分吃掉了一些节省。

### A4. 判定：拆 apply 是否值得？

**结论：可拆，价值中低。若本轮已经要动 apply 就顺势三分；不要为拆而拆。**

- **拆的理由**：131 行 / 5 职责（settings、stores、provider、路由、effect 生命周期）混在一个函数。
  三分后 `apply` 剩 68 行，读起来是"装配清单"（建配置源 → 建两 store → 建 provider → 注册 provider →
  注入 webServer + 挂路由）。这是**真实可读性收益**（-48%），而不是行数游戏。
- **不拆的理由（更硬）**：① 文件总行 **+30**，总复杂度没降，只是换位置；② 三个新函数里两个（settings、routes）
  被**源码级正则**钉在 `lib/index.js`，任何"顺手挪模块"的重构会立刻破测试（变体 B 已证明）；
  ③ `apply` 只有 1 个调用点（Cordis loader），没有第二消费者，**提取的收益纯是阅读体验，不是复用**。
- **`webCtx.effect` 那段怎么办？** 三条硬规则：
  1. **整段搬、绝不切碎**：518-556 原样作为 `registerWebRoutes` 的函数体（含注释与 `"unified-search: web routes"` 标签）。
  2. **不移到新文件**：三条正则在 `../lib/index.js` 上匹配（`settings-api.test.js:251`）。
  3. **参数化 `registers` 而不是内联**：`apply` 构造 `registers`（依赖显式）→ `registerWebRoutes(webCtx, registers, deps)`。
     如此"A.6 原子序列"在一个函数内闭环，且 `deps`（`getConfig`/`historyStore`/`settingsForms`/`getConnection`）
     让依赖来源一眼可见。
  4. **改后必须重跑 A.6 端到端探针**：现有测试只覆盖内联副本，真 `apply` 的回滚没有被任何测试观察。
     探针判据：预占 settings 路径 → `remaining === 1`、`effectsCommitted === 0`、抛出。
- **附注（顺带发现，不属本任务）**：`registerSearchProvider`（499）没有交给 `webCtx.effect` 或 fiber——
  但 `@deepseek-ai/dsh-web` 的 `registerProvider` 内部自己 `this.ctx.effect(...)` 并返回 disposer
  （`dsh-web/lib/index.js:164-176`），所以 reload 不会泄漏；只是 apply 丢弃了返回值（可读性瑕疵，非缺陷）。
- **成本**：~50 行 diff、0 行为变化、1 个文件。**收益 2/5，风险 1/5。**

---

## B. `resolveOptions`（`index.js:323-408`，**86 行**；任务口径 100 行）

### B1. 段表

> **纠偏 1**：任务问"读 `settings.describe()`"——**`resolveOptions` 不读 settings 服务**。
> 活配置读取在 `apply` 的 `current` 闭包（458-465，`findPluginRow(settings.describe())`）；
> `resolveOptions(ctx, config)` 只消费调用方**已经解析好的** `config`。这是一条重要的分层，
> 拆 `resolveOptions` 时不要把 `settings.describe()` 搬进来（会引入每搜索一次 describe 调用，且破坏
> `apply` 里被正则钉住的那句）。
>
> **纠偏 2**：任务问"Config schema 默认合并"——同样的，schema 默认由 schemastery 在 `installSection`/settings
> 服务侧填；`resolveOptions` 只做 `?? 默认常量` 的兜底（`DEFAULT_BASE_URLS`/`DEFAULT_MODELS`/`DEFAULT_KEY_ENV`），
> 不是 Config 默认合并。

| 段 | 行 | 行数 | 代码行 | 做的事 |
| --- | --- | --- | --- | --- |
| 签名 + 头部注释 + `let enabledBackends = []` | 323-327 | 5 | 2 | — |
| **① 显式列表优先** | 329-331 | 3 | 3 | `config.enabledBackends.length > 0` → `.filter(id => ALL_BACKENDS.includes(id))`（未知 id 静默丢弃） |
| **② 13 开关（派生键，新盘面）** | 333-337 | 5 | 3 | `ALL_BACKENDS.filter(id => config?.[`enable${Cap(id)}`] === true)`。**旧盘面是 19 行手写 `toggleMap`（333-351）**；派生后与 `BACKENDS` 自动同步（我验证 13/13 正确、Config 无缺键） |
| **③ `ENABLED_ENV` 环境变量** | 339-347 | 9 | 9 | `launchEnvironmentOf(ctx).get(ENABLED_ENV)?.value` → `split(/[,\s]+/)` → trim → 白名单过滤 |
| **④ `DEFAULT_ENABLED` 兜底** | 349-351 | 3 | 3 | `[...DEFAULT_ENABLED]`（exa/parallel/ddg/searxng 四个 keyless） |
| **13 后端 `backendOpts` 摊平** | 353-376 | 24 | 22 | `for (const id of ALL_BACKENDS)`（**13 个全部，不是 enabled**，355）；每项产出 10 个字段 |
| ├ **5 个"结果敏感键"** | **359-364** | 6 | 6 | `apiKeyEnv`(360) / `baseURL`(361) / `model`(362) / `searchDepth`(363，仅 tavily) / `safeSearch`(364) |
| └ `resolveApiKey` 异步闭包 | 369-374 | 6 | 6 | `ctx.get("credentials")` → `credentials.resolve(ref)` → 回落 `launchEnvironmentOf(ctx).get(ref)` |
| **全局键归一（language）** | 378 | 1 | 1 | `config.language.trim()`（非字符串 → `""`） |
| **返回 · 标量 + filters** | 380-404 | 25 | 22 | `enabledBackends` / `numResults`(382) / `concurrency` / `backendTimeoutMs` / `dedupStrategy` / `rerank` / `resultTelemetry` / `cacheEnabled` / `cacheTtlS`(391) / `breaker*`(392-396) / `historyEnabled` / `multiQueryEnabled` / `deepCoverage` / `filters{recency,lang}` |
| **返回 · backends + ctx** | 405-407 | 3 | 3 | `backends`（13 项）、`ctx` |
| 收尾 | 408 | 1 | 1 | `}` |

合计 **86 行 / 69 代码行 / 17 注释与空行**（任务口径的 100 行版含 19 行手写 `toggleMap` 与更长注释）。

### B2. 关键：N2 摊平逻辑的真实位置与"不能漏键"

**⚠️ 纠偏 3（最重要）：N2 的摊平不在 `resolveOptions`，而在 `provider.js`。**
两半必须同时存在：

| 半 | 位置 | 行 | 内容 |
| --- | --- | --- | --- |
| **生产半** | `index.js` `resolveOptions` | **359-364** | `apiKeyEnv`(360) / `baseURL`(361) / `model`(362) / `searchDepth`(363) / `safeSearch`(364) |
| **摊平半（N2 修复点）** | `provider.js` `search()` | **267-273**（注释 263-266；`cacheKeyFor` 调用 274） | 见下 |

```js
267:        for (const id of opts.enabledBackends ?? []) {
268:          const be = opts.backends?.[id];
269:          if (!be || typeof be !== "object") continue;
270:          for (const k of ["baseURL", "model", "searchDepth", "safeSearch", "apiKeyEnv"]) {
271:            if (be[k] !== undefined) resultOptions[`${id}.${k}`] = be[k];
272:          }
273:        }
274:        cacheKey = cacheKeyFor({ query: effReq.query, filters, maxResults, backends: opts.enabledBackends, mode: cacheMode, resultOptions });
```

**"摊平逻辑不能因拆分而漏键"的量化证据**（用**正确**后端契约 `{ sources: [...] }` 跑 13 后端 × 敏感键矩阵，
拦截 `cache.get` 判定是否命中旧键）：

| 树 | 探测项 | stale-HIT（漏键导致命中旧缓存） |
| --- | --- | --- |
| **真树**（5 键全摊平） | 13 baseURL + model/searchDepth/apiKeyEnv 变体 = **40** | **0** ✅ |
| 变异 M1：`k` 列表删掉 `baseURL` | 13 | **13（全漏）** ❌ |
| 变异 M2：删掉整个摊平块 | 13 | **13（全漏）** ❌ |
| 变异 M3：`resultOptions` 传 `{}` | 13 | **13（全漏）** ❌ |

**5 个键都是"结果可见"的**（后端把收到的 `beOpts` 回显进结果 URL；命中旧缓存时 URL 仍带旧值）：

| 改动 | 真树 | 只摊平 `baseURL` 的变异树 |
| --- | --- | --- |
| `model` m1→m2 | miss，新结果 `/m2/` | **HIT**，仍 `m1` ❌ |
| `searchDepth` basic→advanced | miss，新结果 `/advanced/` | **HIT**，仍 `basic` ❌ |
| `safeSearch` true→false | miss，新结果 `/false/` | **HIT**，仍 `true` ❌ |
| `apiKeyEnv` 换名 | miss | **HIT** ❌ |
| `baseURL` 换端点 | miss | miss ✅ |

摊平规模（实测）：13 后端全启用 → **39** 个 `${id}.${k}` 键（`exa`/`parallel`/`ddg` 无 model，只有 tavily 有
searchDepth；13×5=65 的理论上界落到 39）；默认 4 后端 → **8** 键。canonical JSON 体积：13 后端 **1602 B**、
默认 **347 B**（sha256 输入，可忽略）。

**⚠️ 重大发现：现有测试实际上没有 pin 住 N2（空转）。**
`tests/lead-20261107.test.js:121-156` 的 `N2: changing a backend's baseURL invalidates the cache`：

```js
const backend = {
  available: () => true,
  async search() { calls++; return [ { url: `https://example.com/${calls}`, title: "t", snippet: "s" } ]; },
};
```
它返回**裸数组**，而真后端契约是 `return { sources }`（`lib/backends/brave.js:82`）。后果：
1. `collectFanoutResults`（`provider.js:155` `for (const src of settled.value?.sources ?? [])`）拿到 `undefined ?? []` → `sources: []`；
2. 写缓存时存 `sources: []`（509）；命中判据要求 `hit.value.sources.length > 0`（276）→ **永远 miss**；
3. 所以 `calls` 必然 1→2，**与缓存键是否包含 baseURL 毫无关系**。

实测（`/tmp/vacuity.mjs`，原样 fixture）：
```
bareArray  calls=2 (test asserts 2) r1.sources=0 r2.sources=0
   log: [["get",…,"miss"],["set",…"sources=0"],["get",…,"miss"],["set",…"sources=0"]]
correct    calls=2 (test asserts 2) r1.sources=1 r2.sources=1
```
→ **删掉 `baseURL` 键、删掉整个摊平块、甚至把 `resultOptions` 换成 `{}`，81 个测试全部 81/81 通过**
（变异 M1/M2/M3 实测均 `pass 81 / fail 0`）。只有换成正确契约跑 40 项矩阵才暴露 13 处漏键。

**真正 pin 住"缓存键含 result-affecting 设置"的只有两条弱断言**：
- `lead-20261107.test.js:105-116`：直接调 `cacheKeyFor({resultOptions})`，只覆盖
  `safeSearch/rerank/dedupStrategy/searxngBaseURL`——**绕过了 `provider.js` 的摊平循环**，
  且 `searxngBaseURL` 是**顶层**键名，不是 `${id}.${k}` 形态；
- `lead-20261108-interaction.test.js:68-74`：纯源码正则 `assert.match(prov, /resultOptions/)` +
  `/cacheKeyFor\(\{[^}]*resultOptions/`——字出现即过。

→ **拆/改 `resolveOptions` 时，"5 键全产 + `${id}.` 前缀"这条没有测试兜底，只能靠人守。**

### B3. 拆分方案 + 行数变化 + 风险

**可提（2 个，同文件）**

| 新函数 | 来源行 | 目标行数 | 风险点 |
| --- | --- | --- | --- |
| `resolveEnabledBackends(ctx, config)` | 323-351 | 19 | 四级优先级（显式 > toggle > env > 默认）是**一条链**，不能改成"合并"；`env` 分支里的 `launchEnvironmentOf(ctx)` 必须继续只在前两级空时调用 |
| `buildBackendOptions(ctx, config)` | 353-376 | 25 | **必须继续遍历 `ALL_BACKENDS`（13 个），不能改成 `enabledBackends`**（见 D5） |

**实测（变体 C：两段提取，`resolveOptions` 只剩"调用两次 + 拼 return"）**

| 项 | 原始 | 变体 C |
| --- | --- | --- |
| `resolveOptions` | 323-408 = **86 行** | 374-403 = **30 行**（-56） |
| `resolveEnabledBackends` | — | 324-342 = 19 |
| `buildBackendOptions` | — | 348-372 = 25 |
| `index.js` 总行 | 558 | **553**（**-5**，几乎持平：拆出的注释+签名抵消了节省） |
| 测试 | 81/81 | **81/81** ✅ |
| 等价性 | — | **6 组 config 结构比对 0 diff**；13 后端 `resolveApiKey` 全在；13/13 单 toggle 隔离正确 |

**风险清单（按严重度）**
1. **`opts.backends` 覆盖面缩水**（R1）：只产 enabled → `available()`（`provider.js:188` 遍历
   `opts.enabledBackends` 但 `191` 读 `opts.backends?.[id] ?? {}`）与缓存键双失效。
2. **N2 无测试兜底**（R2，见 B2）：拆完若漏键，81/81 依然全绿。
3. **`ctx` 传参**（R3）：拆出后 `ctx` 必须显式传（`resolveApiKey` 闭包 369-374 捕获它）。
   **绝不能** 存成模块级单例——多 profile 并发加载会串号。
4. **`cacheTtlS` 的夹取与 `breakerCooldownMs` 的 0 语义**（R4）：`391` 的 `Math.max(30, …)` 与
   `394-396` 的 `!= null` 三态（0 = 关闭冷却）不能"归一"成 `|| default`。
5. **`launchEnvironmentOf(ctx)`** 在 340 与 372 各调一次；拆分后仍是两次（别顺手缓存成模块级）。
6. **热路径**（R6）：`resolveOptions` 每次搜索至少调 1 次（`provider.js:207`），另有 `available()`（186）、
   `apply` 的两个闭包（479 ttlMs、493 historyEnabled）、3 条路由。实测 **88 µs/次**（新盘面；旧盘面 131 µs/次），
   拆分 → 多 2 次函数调用（可忽略，但方向是"变慢"）。

### B4. 判定：值得拆吗？

**结论：不值得单独拆；价值低于 A。**

- **正面**：86 行里 3 个职责（选后端 21 行 / 造选项 24 行 / 拼 return 25 行）。后者是纯字面量投影，
  前两者有分支。拆后 `resolveOptions` **30 行**，两块逻辑各有清晰输入输出；将来加后端只动 ①②③ 与 `BACKENDS`。
- **负面（更硬）**：① **净行数 -5**（几乎零收益——提取出的 JSDoc/签名把节省吃光）；
  ② 没有第二个调用点需要这两个 helper 单独复用；③ **N2 没有回归防线**（B2），任何改动都在裸奔；
  ④ `toggleMap` 刚被压成一行（16:18 那轮优化），**选后端的逻辑现在是 3 行表达式**，已不算"难读"。
- **与 A 的对比**：A 的可读性收益是 `apply` **-63 行（-48%）**；B 是 `-56 行`（占 86 行的 65%）但文件总行仅 -5。
  同样是"形变"，A 更划算（apply 是入口、职责多）。
- **建议**：**排在 A 之后；且必须先补 N2 行为测试**（假后端返回 `{ sources: [{url}] }`，断言改
  `baseURL`/`model`/`searchDepth`/`safeSearch`/`apiKeyEnv` 任一后 `calls` 递增、且返回结果带新值）。
  没有这条测试，拆 `resolveOptions` 等于在无网线的高空作业。
- **收益 2/5，风险 2/5。**

---

## C. `createSearchCache`（`cache.js:72-172`，**101 行**；任务口径 91 行 / 162 行文件）

### C0. 先纠正三个前提

1. **没有内存 LRU。** 全函数无 `Map`、无内存条目表。`get()` = `existsSync` + `readFileSync` + `JSON.parse`
   （**每次读盘、每次解析**）；`set()` = `writeFileSync`(tmp) + `renameSync` + `evict()`。唯一的"内存态"是
   101 行版新增的 `let knownCount`（**一个整数，不是条目缓存**）。所以"C1 段表里的 LRU"应记作**磁盘单层 + 一个计数**。
2. **TTL 是"读时惰性过期"**，不是定时器：`get()` 命中时判 `age*1000 > ttl` → unlink + 返回 null（`138-141`）。
   没有后台清理任务，所以过期条目会**一直占着目录**直到被读到、或被 LRU 淘汰。
3. **`set` 的原子写**：tmp 兄弟文件 + `rename`（`88-92`），tmp 名 = `${file}.${process.pid}.tmp`；
   `listEntries` 用 `name.includes(".tmp")` 过滤，避免把自己的临时文件当条目。

### C1. 段表（两份：任务口径 91 行 / 当前 101 行）

**91 行版（`backups/opt-evict-*/cache.js.orig`，文件 162 行）**

| 段 | 行 | 行数 | 做的事 |
| --- | --- | --- | --- |
| `cacheKeyFor`（**在 `createSearchCache` 之外**） | 39-56 | 18 | sha256 over canonical JSON `{q,f,n,b,m,o}`，取前 32 hex；`o` = 过滤掉函数与 `resolve*` 键后的 `resultOptions`（43-45）→ **这就是 N2 键的落点** |
| 签名 + `ttlOf` + `cap` | 72-75 | 4 | `ttlMs` 可为值或 `() => number`（设置热更新）；`cap = max(1, floor(maxEntries))` |
| `fileFor` | 77 | 1 | `path.join(dir, key + ".json")` |
| `ensureDir` | 79-81 | 3 | `mkdirSync(recursive)` |
| `atomicWrite`(+JSDoc) | 83-92 | 10 | 见 C0.3 |
| **`listEntries`** | 95-108 | 14 | `existsSync(dir)` 短路 → `readdirSync` → 过滤 `.json` 且非 `.tmp` → 逐文件 `statSync().mtimeMs`（try/catch 跳 raced delete）→ **按 mtime 升序排序** |
| **`evict`（磁盘淘汰）** | 110-115 | 6 | `listEntries()` → `for (i < len - cap) unlinkSync`（删最旧） |
| return 对象 + get JSDoc | 117-121 | 5 | — |
| **`get`（TTL 过期在此）** | 122-138 | 17 | exists → read+parse → 结构校验（`record.value` 必需）→ `ageSeconds` → `ttlOf()` → 过期则 unlink+null → `{value, age}` |
| **`set`（原子写 + 淘汰）** | 141-149 | 9 | `ensureDir` → `atomicWrite` → **`evict()`（无条件，每次都扫全目录）**；整体 try/catch 吞 fs 错误 |
| `clear` | 152-160 | 9 | `listEntries()` 全删 |

**101 行版（当前盘面，文件 172 行）新增/改动**

| 段 | 行 | 行数 | 变化 |
| --- | --- | --- | --- |
| **`knownCount` 声明** | 110-113 | 4 | **新增**：`let knownCount = null`（"null=未知，首次写入扫一次"） |
| **`evict`（短路）** | 115-123 | 9 | **新增** `116: if (knownCount === null) knownCount = listEntries().length;`、`117: if (knownCount <= cap) return;`，收尾 `122: knownCount = Math.min(knownCount, cap)` |
| **`set`** | 149-158 | 10 | **新增** `153: if (knownCount !== null) knownCount += 1;`（**无条件 +1，覆盖写也 +1**） |
| **`get`** | 130-146 | 17 | **不变**：unlink 过期条目时**不** `-1`（→ 漂移源之一） |
| **`clear`** | 161-170 | 10 | **新增** `166: knownCount = 0` |
| 其余 | — | — | `cacheKeyFor`/`fileFor`/`ensureDir`/`atomicWrite`/`listEntries` **逐字节一致** |

### C2. 性能量化：磁盘淘汰是否每次 `set` 都全目录扫描？

**91 行版：是，100% 每次 `set` 都 `readdirSync` + 每文件一次 `statSync`。**
**101 行版：靠 `knownCount` 短路，但计数会漂移 → "不扫"只是部分成立。**

**（a）纯扫描成本（`readdirSync` + 每文件 `statSync`，20 次中位）**

| 目录文件数 | 一次扫描 | 备注 |
| --- | --- | --- |
| **200（= 生产 cap）** | **0.591-0.608 ms** | 生产实际目录恰 200 文件 / 618 KB（`/home/dsh/.dsh/cache/websearch/results`） |
| 1000 | 2.93-3.04 ms | cap=1000 时 |
| 5000 | 14.72-14.83 ms | |
| 10000 | 56.7 ms（p50）/ 99 ms（max） | |

**（b）`set` 端到端（cap=200、目录 200、稳态；3-5 轮取中位）**

| 版本 | 场景 | mean | p50 | p95 |
| --- | --- | --- | --- | --- |
| 91 行（必扫） | cap=200 稳态（每 set 1 次淘汰） | 0.680-0.715 ms | 0.635 | 0.904 |
| 101 行（短路） | 同上（仍在 cap，仍每次扫） | 0.645-0.825 ms | 0.592-0.706 | 0.901-1.349 |
| 91 行 | **低于 cap**（dir=200, cap=2000） | **0.934-1.128 ms** | 0.882-1.148 | 1.257 |
| 101 行 | **低于 cap**（同上） | **0.032 ms** | 0.030 | 0.038 |
| — | 纯 `write+rename`（无扫描下界） | **0.023-0.028 ms** | — | — |

→ **淘汰扫描占 `set` 的 96%**（cap=200：总 0.615 ms = 扫描 0.593 ms + 写入 0.023 ms）。
`get` 在 200 文件下 **0.014-0.25 ms**（不扫描）。

**（c）系统调用证明（`strace`，100 次 set 的斜率，cap=200）**

| 版本 | `getdents64` / set | `statx` / set |
| --- | --- | --- |
| 91 行 | **2.0**（每 set 一次 readdir） | **~200.0**（= 目录文件数） |
| 101 行（低于 cap） | **0.0** | **0.0** |
| 101 行（在 cap） | 2.0 | ~200.0 |

**（d）`knownCount` 漂移缺陷（并发改动引入，需上报）**

`knownCount` 在 `set()` 里**无条件 +1**（覆盖写也 +1，153），`get()` 里 unlink 过期条目**不 -1**（139）。
于是"同一批键反复覆盖"让计数单调超过真实文件数 → 误判"超 cap" → 回退全目录扫描：

| 场景（真实目录 **50** 文件、cap **200**、**400 次 set = 50 键 × 8 轮覆盖**） | 91 行 | 101 行 |
| --- | --- | --- |
| `getdents64` 实测总数 | **804**（= 2/set，每次都扫） | **406**（= 1.01/set） |
| 理想值（`knownCount` 生效） | — | **~2**（仅首扫 1 次 + 边界） |

→ 101 行本应"**几乎 0 次扫描**"，实测仍是 **1 次/set**：优化被自身漂移**吃掉 99%**。
端到端（dir=50、cap=200、500 次覆盖写）：101 行 `p50 0.208 / p95 0.393 / **max 4.180 ms**`，
91 行 `p50 0.210 / p95 0.301 / max **0.538 ms**` → **p50 持平，max 差 7.8 倍**（偶发尖刺）。
**无正确性损害**（已验证：真实目录仍为 50，无过度删除/清空，TTL/clear 语义不变）。

**（e）真实性能问题判定：有，但不是"每次都扫"这句，而是两点**

1. **P1｜漂移导致优化自我失效**（101 行引入）：见 C2d。属"已修一半、留了新缺陷"。
2. **P2｜cap 稳态仍有 96% 时间花在扫描**（0.6 ms/set）。相对秒级搜索可忽略，但**存在真优化**：
   把淘汰改为**摊销**（trim 到 `0.9*cap`，让接下来约 10% 的写入免扫）。实测：

| 方案 | mean/set（cap=200、400 次 set、5 轮中位） | 目录稳定值 | 正确性 |
| --- | --- | --- | --- |
| 当前（trim 到 cap） | **0.645 ms** | 200 | ✅ |
| **摊销（trim 到 0.9\*cap）** | **0.079 ms（-87.7%）** | 181 | ✅ 最新条目保留；1000 次 set 后 `oldest=k819`；TTL/clear 与 91 行逐项一致 |

3. **P3｜规模只有在有人调大 `maxEntries` 时才痛**：生产 `maxEntries` 硬编码 200（`index.js:480`
   `CACHE_DEFAULTS.maxEntries`，Config 无 `cacheMaxEntries` 字段）。1000/2000/5000/10000 文件时扫描升到
   3.0 / 7.4 / 14.8 / **56.7 ms**——那时才成为真问题。
4. 冷启动：101 行首次 set 必扫一次（seed=500 时首 set **4.0-8.6 ms**），之后进入短路。

### C3. 拆分方案 + 行数变化 + 风险

**可提（同文件，纯提升作用域）**

| 新函数（模块级） | 来源 | 目标行数 |
| --- | --- | --- |
| `listEntries(dir)` | 95-108 | 14 |
| `evict(dir, cap, state)` | 115-123（`knownCount` 折进 `state`） | 9 |

（`atomicWrite` 只有 5 行且只依赖 `process.pid`，提不提都行。）

**实测（变体 C1：`listEntries` + `evict` 提到模块级，`knownCount` 收进 `const state = { knownCount: null }`）**

| 项 | 原始 | 拆后 |
| --- | --- | --- |
| `createSearchCache` | 72-172 = **101 行** | 99-173 = **75 行**（-26） |
| `cache.js` 总行 | 172 | **173**（+1） |
| 测试 | 81/81 | **81/81** ✅ |
| 性能 | mean 0.833（cap 稳态）/ 0.032（低于 cap）/ 0.191（trim burst） | 逐项一致（±2%） |
| 正确性 | 200 文件 / oldest=k800 / 新条目保留 / TTL / clear | 全部一致 |

**⚠️ 不可提**：`cacheKeyFor`。我试过移到 `lib/keys.js`（+re-export），结果
`cache key includes result-affecting options`（`lead-20261108-interaction.test.js:68-74`，读 `../lib/cache.js`
源码并 `assert.match(src, /resultOptions/)` + `/o: shaped/`）**直接失败**。

**风险清单**
1. **`knownCount` 必须随 `evict` 一起搬**：提到模块级但把计数留在闭包 → 多实例串号。`state` 参数是唯一安全形态。
2. **`dir` 参数化要同步到 `clear`**：`listEntries` 改成 `listEntries(dir)` 后，`clear()`（163）也必须跟着改，
   否则 `clear` 会扫错目录**静默不删**。
3. **`atomicWrite` 的 tmp 命名**（`${file}.${process.pid}.tmp`）与 `listEntries` 的 `.tmp` 过滤（99）是**成对约束**：
   若改成随机 tmp 名，过滤判据必须同步。
4. **`get()` 的惰性 unlink 与 `knownCount` 不同步**（101 行缺陷，C2d）：拆分是修它的天然时机，**但那是行为改动**，
   不属于"拆分"。

### C4. 判定：值得拆吗？有无真实性能问题需要先修？

**拆分判定：不值得单独做。**
101 行 = 5 个私有助手（`fileFor`/`ensureDir`/`atomicWrite`/`listEntries`/`evict`）+ 3 个方法，结构已是
"工厂 + 私有助手"，本身可读。拆成模块级助手 -26 行（**75 行**），但把 `dir`/`cap`/`state` 三个参数显式化，
**换来的只是"看起来更短"**，总复杂度未降（`cache.js` 反而 +1 行）。且 `cacheKeyFor` 不能动（源码正则），
拆一半让模块边界更碎。**收益 1/5，风险 2/5。**

**性能判定：有真问题，优先级高于任何拆分。按此顺序处理**

| 优先 | 事项 | 证据 | 建议动作 |
| --- | --- | --- | --- |
| **P1** | `knownCount` 漂移（覆盖写 +1、`get()` unlink 不减）→ 误判超 cap → 回退全扫 | 400 次覆盖写：`getdents64` **406**（=1.01 扫描/set，理想 ~2 次总量）；`max` 0.538→**4.180 ms（7.8×）** | 覆盖写不 +1（先 `existsSync` 判新），或 `get()` unlink 时 `-1`；或直接用 P2 的摊销方案一并覆盖 |
| **P2** | 摊销淘汰（trim 到 `0.9*cap`） | cap 稳态 mean **0.645 → 0.079 ms（-87.7%）**，正确性全过 | 值得做（行为等价优化）；需一条"目录稳定在 `[0.9cap, cap]`"的测试 |
| P3 | `maxEntries` 硬编码 | `index.js:480` 传的是 `CACHE_DEFAULTS.maxEntries`；Config 无 `cacheMaxEntries` 字段 | 与"插件不得硬编码可调项"的仓规冲突，独立于本任务 |
| — | 拆分（C3） | -26 行、0 行为变化、`cache.js` +1 行 | **不做**，除非 P1/P2 的改动正好动 `evict` |

> P1/P2 触及 `evict`/`set`/`get`，**正是 `createSearchCache` 的核心**。若同时做拆分，diff 会混在一起、
> 评审无法分辨"行为修复"与"搬移"。**先修 P1/P2，再决定是否顺手拆。**

---

## D. 不能拆清单（含行号与证据）

| # | 不可拆对象 | 行号 | 为什么 | 证据 |
| --- | --- | --- | --- | --- |
| **D1** | **A.6 三件套**：`try`(547) + `disposers.push(...register())`(548) + `catch` 里 `disposers.reverse()`(550-552) + `throw err`(553) | `index.js` **547-554**（effect 整体 **518-556**） | 拆开断 `disposers` 作用域 / 破坏后进先出释放序 / 静默半启动（路由缺一条还不报错） | ① 源码正则三条：`settings-api.test.js:252-254`；② 行为模拟：同文件 255-283（内联副本）；③ 我实测真 `apply`：删回滚后剩 **4** 条（本应 1 条），`pass 80/fail 1` |
| **D2** | 三句的**字面形态 + 所在文件**（`push(...register())` / `disposers.reverse()` / `throw err;`） | 548 / 550 / 553，且必须在 **`lib/index.js`** | 三条正则读的是 `../lib/index.js`（`settings-api.test.js:251`）。**移到 `lib/routes.js` 必失败** | 变异 B 实测：抽出到 routes.js + re-export → **`pass 18 / fail 1`**（失败项 = 本测试）。同文件内三分 → **81/81** ✅ |
| **D3** | `findPluginRow(settings.describe())` 调用点 | `index.js` **460**（闭包 458-465） | 三条源码正则 + 命名空间劫持防护（第三方 row 在前不得命中） | `lead-20261107.test.js:87-89`、`lead-20261107-p0.test.js:111-113`、`lead-20261108-interaction.test.js:64`；行为断言 `lead-20261107.test.js:92-100`（`otherRow` 在前仍选中 `pluginRow`） |
| **D4** | **N2 摊平循环**（`${id}.` 前缀 + 5 键列表） | `provider.js` **267-273**（`cacheKeyFor` 在 274） | 漏任一键 = 改设置后仍命中旧缓存（**结果可见**的错）。**且现有测试不兜底** | ① 40 项矩阵：真树 0 漏；删 `baseURL` 13/13 漏；删整块 13/13 漏；传 `{}` 全漏。② 回显矩阵：model/searchDepth/safeSearch/apiKeyEnv 漏键即返回旧值。③ **空转证据**：`lead-20261107.test.js:121-156` 假后端返回裸数组 → `sources:[]` → 永远 miss（实测 `r1.sources=0/r2.sources=0`），`calls` 必然 1→2，与键无关 |
| **D5** | `for (const id of ALL_BACKENDS)`（**13 个全产，不是 enabled**） | `index.js` **353-376**（循环头 355） | 改成只产 `enabledBackends` → `available()`（`provider.js:188-194` 读 `opts.backends?.[id]`）与 `ttlMs`/缓存键双双缺项；某后端首次启用即缺 options | `provider.js:191` `opts.backends?.[id] ?? {}`；`index.js:479` 的 `ttlMs` 依赖同一份快照 |
| **D6** | `cacheTtlS` 夹取 + `breakerCooldownMs` 的 0 语义 | `index.js` **391**（`Math.max(30, …)`）、**394-396**（`!= null` 三态，0 = 关闭） | 任何"归一"成 `x \|\| default` 会把合法 0 吃掉（0 = 关闭冷却，不是"未设置"） | 注释 395 `// 0 = disabled`；Config 描述 196 "设为 0 表示关闭冷却" |
| **D7** | `cacheKeyFor` 的所在文件 + `resultOptions` 过滤（剔函数/`resolve*`） | `cache.js` **39-56**（尤其 43-45） | 移出 `cache.js` → 源码正则失败；不剔除函数 → 键随闭包身份变化、永远 miss | 变异实测：移到 `lib/keys.js` + re-export → `cache key includes result-affecting options` **失败**；`lead-20261107.test.js:113-115` pin "函数不污染键" |
| **D8** | `get()`/`set()` 的 **never-throw** 契约（整体 try/catch 吞 fs 错误） | `cache.js` 130-146（catch 143-145）/ 149-158（catch 155-157） | 缓存坏了不能弄挂搜索 | 文件头注释 8-9；JSDoc 70 `get/set/clear never throw` |
| **D9** | `atomicWrite` 的 tmp+rename 形态 + `.tmp` 过滤 | `cache.js` 88-92 与 `listEntries` 99 | 非原子写留半截 JSON；两者是**成对约束**，改一个必须改另一个 | 注释 84-87（Windows `MoveFileExW` 说明）；99 行过滤 |
| **D10** | `resolveStoreDir()` 的 `os.homedir()` 兜底（不用 `process.env.HOME`） | `index.js` **419-421**（JSDoc 410-418） | Windows 下 `HOME` 常空 → storeDir 变相对路径 → cache/history **静默失效** | JSDoc 410-418 明写 compat-audit P2-7；apply 的注释 472-475 再述一次；已导出可测 |
| **D11** | `ctx.effect` 的标签字面量 `"unified-search: web routes"` | `index.js` **556** | 与 effect 调用本身成对；宿主用它做诊断/溯源 | 位于 D2 同一语句；拆分时整段搬会带走它 |

---

## E. 判定汇总 + 无法验证

### E1. 三者"做/不做"

| 对象 | 现状（新盘面） | 拆分价值 | 拆分风险 | **判定** | 前置条件 |
| --- | --- | --- | --- | --- | --- |
| **`apply`** | `index.js:428-558` = **131 行**，5 职责混装 | **2/5**（apply → 68 行，**-63/-48%**；文件 +30 行；零复用） | **1/5**（0 行为变化；已构造变体验过 81/81 + A.6 探针逐字节一致） | **可以做，但不单独开**：本轮若已要动 `apply` 就顺势三分；否则不排期 | ① 三分必须同文件；② `registerWebRoutes` 整段搬 518-556；③ 改后重跑 A.6 端到端探针 |
| **`resolveOptions`** | `index.js:323-408` = **86 行**，3 职责，热路径 **88 µs/次** | **2/5**（→30 行，但文件仅 **-5** 行） | **2/5**（`ALL_BACKENDS` 覆盖、`ctx` 传参、0 语义夹取三处易错；**N2 无测试兜底**） | **不该单独拆**；排在 A 之后，且**必须先补 N2 行为测试** | 先写"假后端返回 `{sources}`、改 5 键任一 → calls 递增 + 结果带新值"的测试 |
| **`createSearchCache`** | `cache.js:72-172` = **101 行**（任务口径 91），工厂 + 5 助手，已可读 | **1/5**（→75 行，`cache.js` **+1** 行，只换作用域） | **2/5**（`knownCount`/`dir`/`.tmp` 三个状态参数易串） | **不做**。P1/P2 性能修复优先，且修复会动同一段代码 | — |

### E2. `cache` 有无真实性能问题：**有**

- **P1（真缺陷，由并发改动引入）**：`knownCount` 覆盖写无条件 +1、`get()` 惰性 unlink 不减 → 误判超 cap →
  回退全目录扫描。证据：400 次覆盖写（真实目录 50 文件、cap 200）→ `getdents64` **406**（= 1.01 扫描/set，
  理想 **~2 次总量**）；`max` 0.538 → **4.180 ms（7.8×）**。**无正确性损害**。
- **P2（真优化空间）**：cap 稳态下 `set` 的 **96%** 时间在"读目录 + 每文件 stat"（0.615 ms 里 0.593 ms）。
  摊销淘汰（trim 到 `0.9*cap`）实测 **0.645 → 0.079 ms（-87.7%）**，正确性全过（目录稳定 181、最新条目保留、
  `oldest=k819`、TTL/clear 不变）。
- **量级定位（别夸大）**：生产目录正好 **200**（= cap），一次扫描 **0.6 ms**；一次搜索秒级 →
  "每次搜索多 0.6 ms"，**不是用户可感知问题**。真正该修的是 P1（4 ms 尖刺 + 优化自我失效），P2 是顺手。
  **规模超 cap**（1000/2000/5000/10000 文件）时扫描升到 3.0 / 7.4 / 14.8 / **56.7 ms**，但只在有人调大
  `maxEntries`（当前硬编码 200、Config 无字段）时才发生。

### E3. 无法验证

1. **真实搜索耗时**：`/home/dsh/.dsh/cache/websearch/history.json` 只有
   `query/time/resultCount/backendsOk/backendsTotal`，**无 duration**；`latestBackendHealth` 是内存 Map
   （`provider.js:60-62`），不落盘 → 无法把 0.6 ms 与真机搜索时长做比率，只能定性。
2. **真机 `WebServer.register` 的 duplicate 抛错**：我用的是运行中 runtime
   `/opt/dsh-0222/node_modules/@deepseek-ai/dsh-host-webserver/lib/index.js:377`，并自建 `ws.register` 复现；
   **未在真 DSH Web 实例上触发一次真实 duplicate 崩溃**。
3. **P1 在生产是否触发**：取决于"同键反复 `set`"频率。`provider.js` 命中时提前 return（276-299）、**不调 `set`**，
   只有 miss 才写；所以"同键覆盖写"需要"同键 miss"（TTL 过期后 / 写失败重试）。**生产频次未测得**，
   我按 50 键 × 8 轮覆盖构造上界。
4. **`opts.ctx` 的用途**：`resolveOptions` 返回 `ctx`（406），但 `lib/` 内**无读取点**（`grep` 无 `opts.ctx` 消费）。
   无法判定是给宿主/仓外的预留，还是死代码。若是死代码可删（少一个字段），**但删前需确认无仓外消费者**。
5. **`maxEntries` 是否"故意"不可配**：`CACHE_DEFAULTS` 注释说"settings feed these from index.js"，
   但 `index.js:480` 传的是常量、Config 无 `cacheMaxEntries` → 无法从代码判定是遗漏还是有意。
6. **`toggleMap` → 派生键（16:18 那轮）的语义等价性**：我验了 13/13 单 toggle + 默认 + 显式列表 + 全关，
   **但未验证 `config` 里出现非规范大小写键（如 `enableEXA`）时的行为差异**——旧 `toggleMap` 也不认这种键，
   两者应等价，未实测。
7. **变体 A / C1 / C（均在 `/tmp` 副本）**全部 81/81 通过，但**未在真 DSH profile 里加载过**：
   Cordis 生命周期（effect 提交/回滚/fiber 归属）只在自建 ctx 上验过（A.6 六元组逐字节一致）。

### E4. 方法论附注（可复现）

- 环境：Node **v24.22.2**，任务目录 `/tmp`；基准每格 3-5 轮取中位；`readdir+stat` 扫描成本单独测（20 次中位）。
- 系统调用：`strace -f -e trace=getdents64,statx,newfstatat,openat,rename,unlink`，用「N=0 与 N=100 的斜率」扣预热。
- 变异测试：`/tmp/mut/plugin`（真树副本）逐项删键/删块，跑 `node --test tests/*.test.js`（真树基线 **81/81**）。
- A.6 探针：`/tmp/probeA.mjs`（自建 ctx + duplicate 抛 + effect 记账），比较
  `{routes, afterDispose, keys, threw, remaining, effectsCommitted}` 六元组，原始与变体逐字节相同。
- **未修改任何源码**：真树 `index.js` 的 md5 在我开工时是 `37cb6a67…`（573 行），收尾时是 `da6d3f73…`（558 行）
  ——**那是其他 agent 在 16:18 的改动**（`toggleMap`→派生键 + 布局），不是本报告所为；我全程只在 `/tmp` 副本上改。
  `cache.js`（`e266d074…` / 172 行）、`provider.js`（`877b1943…` / 582 行）md5 全程稳定。
