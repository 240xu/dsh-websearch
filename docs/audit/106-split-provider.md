# 106 · `createUnifiedSearchProvider` 400 行拆解方案（只读分析，不改代码）

> 专家 S2 交付。唯一写盘文件：本文件。未改源码/配置/运行时/任务板，无 commit。
> 全部行号钉在 **md5 `877b1943538cf3b9d9a0bf3a84e4ebfc` / 582 行 / mtime 2026-11-23 14:48:12**。

## 0 坐标与事实核验

| 项 | 值 | 证据 |
| --- | --- | --- |
| 目标文件 | `.artifacts/websearch-research/src-work/plugin/lib/provider.js` | 582 行，30 143 字节 |
| `createUnifiedSearchProvider` | **181–580 = 400 行** | 这正是「400 行」的来源 |
| `search()` 方法体 | **205–578 = 374 行** | 若目标其实是 `search`，是 374 不是 400 |
| 线上同一份 | `/home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/lib/provider.js` | `diff -q` → IDENTICAL，同 md5，v2.8.4 |
| 单测基线 | `node --test tests/*.test.js` → **81 pass / 0 fail**（~700ms） | 实测；`node --test tests/`（目录形式）会 `MODULE_NOT_FOUND`，必须用 glob |
| 读源码的断言 | 8 个测试文件共 81 条 `assert.match(src…)`，其中 **12 条**读 `provider.js` | quota×10 / 07×1 / interaction×1 |

**期间发生过文件被改写（重要证据，非我造成）**：14:45:39 出现 598 行版本（md5 `ac4287a4…`，含一个新顶层 `planSearch` 在 82 行），14:48:12 回落为现在的 582 行版本。我最初读到的 582 行与最终 582 行 md5 不同（`ac4287a4…` → `877b1943…`）。**现在这版与线上包逐字节一致，以它为准**；本文件所有行号都按这一版复核过两遍（`sed` 逐边界打印）。

## 1 段边界表（核心）

行号已逐条 `sed -n` 验证边界内容。「行数」含注释/空行；「代码行」= 去掉纯注释行与空行。

| 段 | 起–止 | 行数 | 代码 | 语义 | 读写的跨段变量（详见 §2） |
| --- | --- | --- | --- | --- | --- |
| **S0** | 181–204 | 24 | 13 | 工厂头 + `id` + `available()` | 只读 `resolveOptions/backends`，无状态 |
| **S1** | 205–246 | 42 | 26 | `throwIfSearchAborted` + 请求整形（`filters`/`hostCap`/`userMax`/`shapeQuery`/空查询早拒/`coverage`/`multi`/`variants`/`cacheMode`） | 声明 `effReq maxResults concurrency backendTimeoutMs coverage backendMaxResults multi variants cacheMode`，出向 S2a/S5/S6 |
| **S2a** | 247–274 | 28 | 17 | 缓存键构造（`resultOptions` 两个正则 + 后端级 `${id}.${k}` 摊平 + `cacheKeyFor`） | 声明 `cacheEnabled`、写 `cacheKey`；读 `effReq/filters/maxResults/cacheMode/concurrency/backendTimeoutMs` |
| **S2b** | 275–300 | 26 | 21 | 缓存命中短路：http(s) 白名单过滤 → 空则当 miss（`cacheKey=null`）→ 加 `[websearch cache] age Ns` → `recordHistory` → **提前 return** | 写 `cacheKey`；读 `request/cache/history` |
| **S3a** | 301–320 | 20 | 14 | 候选构造：`breakerCfg`/`nowMs`/`candidates[]`（`available()` 过滤） | 声明 `breakerCfg nowMs candidates` |
| **S3b** | 321–373 | 53 | 43 | 冷却选择：`cooled`/`rateLimitedCooled`/`eligible`，fail-open、配额快失败（keyless 分流）、纯故障 `cooled.clear()`；368–373 是 `eligible.length===0` 的 `WEB_PROVIDER_UNAVAILABLE` 守卫 | 写 `cooled eligible`；读 `candidates/breakerCfg/nowMs` + 模块级 `latestBackendHealth` |
| **S4** | 374–452 | 79 | 64 | `fanoutVariant`：`telemetry[]`、`createLimiter`、`runBackend`（RFC1918 baseURL 门、AbortController、`AbortSignal.any`、超时、`.then` 成功/失败两支写 `telemetry`+`recordBackendHealth`、`.catch` 超时改码、`.finally` clearTimeout）、`Promise.allSettled`、`throwIfSearchAborted`、PHASE 1 `collectFanoutResults` | 读 `signal/concurrency/backendTimeoutMs/eligible/breakerCfg/ctx`；写模块级健康表（经 `recordBackendHealth`） |
| **S5** | 453–484 | 32 | 24 | 逐 variant 串行扇出 → 累加 `allTelemetry/allFailures/hardError` → 取消检查 `searchAborted` → PHASE 2 `dedupeSources` / PHASE 3 `rerankSources` → `perVariant.push`；484 算 `okCount` | 声明 `perVariant allTelemetry allFailures hardError okCount`；块内局部 `fold/ordered` |
| **S6** | 485–537 | 53 | 36 | PHASE 4 融合（`orderedLists`/`ordered`，multi 走 `rrfFuse`）→ 成功支：`slice(maxResults)`、结果头（CJK 判 zh）、`cache.set`、`recordHistory`、telemetry 行（冷却注解 + 12 条截断 + `… +N`）、return | 读 `perVariant allTelemetry cooled okCount cacheKey cache multi maxResults maxResults/request` |
| **S7** | 538–578 | 41 | 30 | 两支终结：`allFailures.length===0` → 成功但空（保留 mergedContent + 头 + 写空缓存 + history + return 空）；否则合成 `all enabled backends failed (N) - detail`（`allKeyMissing` → keyless hint）、写 history、`throw WEB_PROVIDER_ERROR{cause:hardError}` | 读 `allFailures hardError perVariant okCount allTelemetry cacheKey cache request/history` |
| 收尾 | 579–580 | 2 | 2 | `};` `}` | — |
| 合计 | **181–580** | **400** | 288 | — | — |

**与你 6 段判断的映射**：S0+S1 合起来就是你说的「候选构造前的入口/整形」；S2a+S2b 是「缓存读写」（缓存**读**在 S2b、**写**在 S6/550 与 S7/550，被拆成三处，这是本文最重要的非直觉发现）；S3a+S3b 是「熔断与冷却」；S4 是「扇出 fold」；S5+S6 是「合并去重 RRF」；S7 是「telemetry + history + 错误合成」——但 **telemetry 行的合成其实在 S6:512–531，不在 S7**；S7 只有 history + 错误合成。所以按语义切是 9 段，不是 6 段。6 段切法会把「缓存写」与「缓存读」分到不同段（S2b ↔ S6/S7），这正是耦合最深的切口。

## 2 闭包耦合表

### 2.1 一级：同一绑定被多段读写（真正的拆分成本）

| 变量 | 声明 | 写点 | 读点 | 横跨 | 严重度 |
| --- | --- | --- | --- | --- | --- |
| `cacheKey` | S2a:253 | S2a:274, **S2b:284** | S2b:275, **S6:508,509, S7:550** | S2a+S2b+S6+S7 | **极高**：读段在 3 个不同分支 |
| `allTelemetry` | S5:457 | S5:468 | S5:484, **S6:511,512,524,528, S7:549,572** | S5+S6+S7 | **极高**：5 处消费 |
| `perVariant` | S5:456 | S5:479 | **S6:489,501, S7:544** | S5+S6+S7 | 高 |
| `okCount` | S5:484 | — | S6:511, S7:549,572 | S5+S6+S7 | 中（派生只读） |
| `allFailures` | S5:458 | S5:469 | S7:543,560,564,565,574 | S5+S7 | 高 |
| `hardError` | S5:459 | S5:470 | S7:576 | S5+S7 | 中 |
| `cooled` | S3b:321 | S3b:328, **S3b:364 (`clear()`)** | **S6:512,514** | S3b+S6 | 高（写/读跨段，且 clear 改变 telemetry 可见性） |
| `eligible` | S3b:323 | S3b:342,363 | S3b:368, **S4:441,450** | S3b+S4 | 高（扇出输入） |
| `candidates` | S3a:312 | S3a:319 | S3b:323,325,340,363 | S3a+S3b | 中 |
| `nowMs` | S3a:311 | — | S3b:327,345, **S6:518** | S3a+S3b+S6 | 中高；**一个值贯穿冷却判定与注解锚点**，见 §6.5 |
| `breakerCfg` | S3a:307 | — | S3b:324, **S4:409,422** | S3a+S3b+S4 | 中高（健康写入也要它） |
| `effReq` | S1:218 | S1:232 | S1:222…243, **S2a:274** | S1+S2a | 中 |
| `multi` | S1:242 | — | S1:243,246, **S6:490** | S1+S6 | 中（跨了 5 段距离） |
| `maxResults` | S1:233 | — | S1:218,241, S2a:274, S5:464, S6:496,509,535 | S1+S2a+S5+S6 | 中（只读，纯参数） |
| `variants` | S1:243 | — | S5:460 | S1+S5 | 低 |
| `backendMaxResults` | S1:241 | — | S5:464 | S1+S5 | 低 |
| `cacheMode` | S1:246 | — | S2a:274 | S1+S2a | 低 |
| `rateLimitedCooled` | S3b:322 | S3b:329 | S3b:343 | S3b | 无（段内自洽，可整段搬） |

### 2.2 二级：跨**调用**共享（不在同一次 search 内，但决定拆分是否会悄悄坏掉）

| 状态 | 写 | 读 | 后果 |
| --- | --- | --- | --- |
| `latestBackendHealth`（模块级 Map） | 仅 `recordBackendHealth`（由 **S4:409,422** 调用） | **S3b:326**（下次 search 的冷却判定）、`getLatestBackendHealth()`（health 路由 + 测试）、`getBackendBreaker()` | 拆成两个模块若各建一张 Map，**冷却永不触发、health 路由读空表、3b 三测全假绿**。这是 B 方案唯一的硬雷 |
| `cache`（注入对象，闭包在 S0:181） | S6:509, S7:550 | S2a:252, S2b:275/287, S6:508 | 读写同一实例，拆文件时须作为参数传 |
| `history`（注入对象） | — | **4 处** `recordHistory`：S2b:292、S6:511、S7:549、S7:572 | 105 号已把 4 处统一到一个 helper，再拆散就是倒退 |
| `breakerCfg` 的 `null` 语义 | S3a:307 | S3b:324、S4（经 `recordBackendHealth` → `foldBreaker(…, breakerCfg ?? undefined)`） | 关闭熔断时**仍然写健康表**（`breakerEnabled:false → null`）。抽 S3 时必须把 `breakerCfg` 一起交回调用方，否则 S4 的写入路径失去配置 |

### 2.3 三级：同名不同绑定——**别误判为共享**（文本分析易踩）

| 名字 | 真相 |
| --- | --- |
| `ordered` | S5:478 是 **for 循环块内** `const`（每 variant 一份）；S6:490 是 **方法顶层** `const`（融合结果）。两个不同绑定，无耦合 |
| `fold` | S5:467 循环内 `const`，逐轮覆盖，不外泄 |
| `telemetry` | S4:379 `fanoutVariant` 局部，靠 `{...fold, telemetry}` 返回 |
| S2a:260 的 `concurrency`/`backendTimeoutMs` | 命中的是缓存键**正则字面量**里的字符串，不是变量读。按文本统计会多算两处 |

## 3 两套方案对比（全部实测，不是估算）

| 方案 | provider.js 行数 | 新增文件 | `search()` 行数 | 单测 | 源码断言要改 | 风险 | 值得做 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 基线 | 582 | — | 374 | 81/81 | 0 | — | — |
| **A-1** 只抽 S3a+S3b → 同文件 `selectEligibleBackends` | 594 (+12) | 0 | 311 (−63) | **81/81** | **0** | **低** | ✅ |
| **A-2** 只抽 S1 → 同文件 `planSearch` | 600 (+18) | 0 | 335 (−39) | **81/81** | 0 | 低 | ✅ |
| **A-3** 只抽 S6 的 telemetry 支 → 同文件 `renderTelemetryLine` | 595 (+13) | 0 | 358 (−16) | **81/81** | 0 | 低 | ✅ |
| **A-4** 抽 S2a 键构造 + S7 错误合成（同文件） | 609 (+27) | 0 | 338 (−36) | **81/81** | 0 | 中低 | ⚠️ 收益小 |
| **A-ALL** S1+S3+S6 三合一（推荐落地形态） | **619** | 0 | **257 (−117, −31%）** | **81/81** | 0 | **低** | ✅✅ |
| **B-1** 把 S3a+S3b 搬到 `lib/search/select-eligible.js`（+`health-state.js` 共 2 文件） | 513 (−69) | +71 行 | 311 | **80/81** | **1 条**（quota:81 `rateLimitedCooled\.set\(c\.id, entry\)` 读 provider.js 找不到） | **中高** | ⚠️ 只为 69 行 |
| **B-2** 把 S7 搬到 `lib/search/search-outcome.js` | 545 (−37) | +62 行 | 336 | **81/81** | 0（S7 无被钉文本） | 中 | ⚠️ 需传 10 个参数 |

**行为等价性（两套都过）**：10 场景指纹（见 §6.3）在基线、A-1/A-2/A-3/A-4/A-ALL、B-1、B-2 上**全部等于 `0653cc76d724`**。所以两套都能做到行为不变；差别只在**测试与维护成本**。

**实测到的 3 次「天真切口」翻车（这是本方案的实操价值）**：

1. 抽 S2a 时把 `effReq/filters/maxResults/cacheMode` 留在函数体里当自由变量 → `ReferenceError: effReq is not defined`（`N2` 测直接红）。必须显式传 plan 对象。
2. 抽 S7 到新文件，`allTelemetry.length` 未改成参数 → `ReferenceError: allTelemetry is not defined`。自由变量捕获是跨文件搬迁的真实杀手。
3. 合并拼接时 `const opts = resolveOptions()` 出现两次 → `SyntaxError: Identifier 'opts' has already been declared`。

## 4 必须留在原函数内（不该拆）清单

按「共享可变状态太深」判：

| 位置 | 留住的具体变量/行为 | 理由 |
| --- | --- | --- |
| **S4 整段**（374–452） | `signal`、`concurrency`、`backendTimeoutMs`、`eligible`、`breakerCfg`、`ctx`；内部 `telemetry`、`controller`、`mergedSignal`、`timeoutId`；对模块健康表的**写入** | 6 个入参 + 写 Module Map；`runBackend` 里还钉着 07 测的 `privHost` 正则与 quota 测的 `timed out after ${effectiveTimeoutMs}ms`。抽出去要动 2 条断言 + 换 79 行，**负收益** |
| **S2b**（275–300） | `cacheKey`、`request`、`cache`、`history`；**提前 `return`** | 短路语义就是「从 search 里 return」；改成 helper 返回值哨兵等于重写控制流 |
| **S6 的成功支 495–537（除 telemetry 支）** | `ordered`、`cacheKey`、`okCount`、`allTelemetry` | 一段里同时 `cache.set` + `recordHistory` + 组装 return，三处共享状态；只把 512–531 的**纯渲染**抽走（已验证 A-3） |
| **S7**（538–578，A 形态下） | `allFailures`、`perVariant`、`okCount`、`cacheKey`、`hardError` | 10 个依赖；A 形态抽它不划算（A-4 实测只省 36 行、风险中低）。B 形态可行但必须整包传参（B-2 已验证） |
| **S3b 的 `eligible.length===0` 守卫**（368–373） | `eligible` | 与选择同源的不变量：严禁出现「挑了但空」的中间态 |
| `recordHistory` 的 4 个调用点 | `history` | 105 号明令不可再拆散（S2b/S6:511/S7:549/S7:572） |

## 5 推荐段边界（只能拆 2–3 段时）

**推荐 A-ALL：3 段，全部同文件、全部零断言改动、全部实测 81/81 + 指纹不变。** 按落地顺序（每步可独立回滚、独立验收）：

| 顺序 | 段 | 切出函数 | 实测 span（含 JSDoc） | 出参 | 收益 |
| --- | --- | --- | --- | --- | --- |
| ① | **S1** 205–246 | `planSearch(request, opts)` | 43 行（181–223） | 10 字段对象 | 唯一**纯函数**段：无 I/O、无共享可变状态、可单测。抽它零风险 |
| ② | **S3a+S3b** 301–373 | `selectEligibleBackends(opts, backends, nowMs)` | 62 行（235–296） | `{candidates, breakerCfg, eligible, cooled}` | 最独立的一块逻辑（fail-open/配额快失败全部自洽），且把 53 行「决策」从 374 行流程里摘出来 |
| ③ | **S6 的 telemetry 支** 512–531 | `renderTelemetryLine(allTelemetry, cooled, nowMs)` | 19 行（307–325） | 字符串 | 纯渲染，唯一依赖是 `nowMs` 锚点（显式传参即保真） |

**效果（实测）**：`provider.js` 582→619；`search()` **374→257（−117 行，−31%）**；`node --check` 通过；81/81 通过；指纹 `0653cc76d724` 不变。

**为什么不是「拆 5 段」**：S2a/S2b/S6主/S7 全部挂在 `cacheKey` 与 `allTelemetry` 这两条 4 段长链上；每多切一刀，要么加参数包（S7 需 10 个），要么把分支挪出 `return` 语义（S2b）。边际收益从第三刀起就掉到 20 行以下，而风险从「零断言」跳到「要动断言/要重建 Map 实例」。

**②的关键传参形状（决定成败）**：

```js
const nowMs = Date.now();                                   // 必须留在 search 里
const { candidates, breakerCfg, eligible, cooled } =
  selectEligibleBackends(opts, backends, nowMs);
if (eligible.length === 0) throw new WebError(/* WEB_PROVIDER_UNAVAILABLE */);
```

`nowMs` 在 search 内算一次、向外传，才能让 S6:518 继续用「扇出时刻」注解（quota:147/148 钉的就是这个）。**若 helper 内部自己 `Date.now()`，注解锚点会漂移**，S6 的 `(expired during search)` 判定（quota:172）会变得不可预期。

## 6 验收断言（最小可执行集合）

### 6.1 语法与结构
1. `node --check lib/provider.js`（Linux 下 npm 包未编译场景的等价物）。
2. 5 个锚点仍在：`export function createUnifiedSearchProvider`、`async search(request, signal)`、`const cooled = new Map()`、`const perVariant = []`、`all enabled backends failed`（新行号可漂移，文本不可变）。

### 6.2 测试（不改任何断言）
3. `node --test tests/*.test.js` → **81 pass / 0 fail**。若报 `ERR_MODULE_NOT_FOUND`，先跑 `tests/relink-test-deps.sh`（它按 `dsh-web.service` 的 MainPID 重建 6 个 `@deepseek-ai` 软链）。**A 形态不需要改任何 `assert.match`**；只要有一个 B 形态的跨文件搬迁，就必须同步改对应的读源断言（B-1 实测就挂在 quota:81）。

### 6.3 行为指纹（主证据）
4. 同一个 10 场景脚本，拆分前后输出**同一个哈希**。基线：**`0653cc76d724`**（已对基线、A×5、B×2 全部复现）。归一化只针对抖动字段（`\d+ms`、`age \d+s`、`retry after ~\d+s`）；sources 顺序、`truncated`、头部/telemetry 行结构、history 元组全部逐字比对。

```js
// node this.mjs <plugin-dir>   →  期望输出 0653cc76d724
import { createHash } from "node:crypto";
const P = await import("file://" + process.argv[2] + "/lib/provider.js");
const sha = (o) => createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 12);
const norm = (s) => typeof s === "string"
  ? s.replace(/\d+ms/g, "<ms>").replace(/age \d+s/g, "age <age>s").replace(/retry after ~\d+s/g, "retry after ~<s>s")
  : s;
const base = { backends: {}, numResults: 8, filters: {}, safeSearch: true, rerank: false, dedupStrategy: "url",
  cacheEnabled: false, resultTelemetry: true, breakerEnabled: false, multiQueryEnabled: false, deepCoverage: false,
  historyEnabled: false, backendTimeoutMs: 30000, language: "", recency: "any", resultHeader: true };
const mk = (id, fn) => ({ id, available: () => true, search: async () => fn() });
const s = (u) => ({ url: u, title: "T" + u.slice(-1), snippet: "S" });
const two = { a: mk("a", () => ({ sources: ["https://e.com/1","https://e.com/2","https://e.com/9"].map(s), content: "answer A" })),
              b: mk("b", () => ({ sources: ["https://e.com/2","https://e.com/3"].map(s) })) };
async function sc(tag, opts, backends, req, cacheStore, preHealth) {
  const H = P.getLatestBackendHealth(); H.clear();
  if (preHealth) for (const [k, v] of Object.entries(preHealth)) H.set(k, v);
  const hist = [];
  const cache = cacheStore && { get: (k) => cacheStore.get(k), set: (k, v) => cacheStore.set(k, v) };
  const prov = P.createUnifiedSearchProvider({ ctx: {}, resolveOptions: () => opts, backends, cache,
    history: { record: (e) => hist.push({ q: e.query, n: e.resultCount, ok: e.backendsOk, tot: e.backendsTotal }) } });
  try {
    const r = await prov.search(req, new AbortController().signal);
    const out = { sources: r.sources.map((x) => x.url), truncated: r.truncated, content: norm(r.content ?? ""), hist };
    return { tag, ok: true, hash: sha(out), order: out.sources.map((u) => u.split("/").pop()).join(","), hist };
  } catch (e) { return { tag, ok: false, hash: sha({ err: String(e.message), code: e.code, hist }) }; }
}
const R = [];
R.push(await sc("S1_single",   { ...base, enabledBackends: ["a","b"], backends: { a:{}, b:{} } }, two, { query: "same query", maxResults: 8 }));
R.push(await sc("S2_rerank3",  { ...base, enabledBackends: ["a","b"], backends: { a:{}, b:{} }, rerank: true }, two, { query: "same query", maxResults: 3 }));
R.push(await sc("S3_multi",    { ...base, enabledBackends: ["a","b"], backends: { a:{}, b:{} }, multiQueryEnabled: true }, two, { query: "cats vs dogs", maxResults: 8 }));
const store = new Map();
R.push(await sc("S4_cacheMiss",{ ...base, enabledBackends: ["a"], backends: { a:{} }, cacheEnabled: true }, { a: two.a }, { query: "cache me", maxResults: 8 }, store));
R.push(await sc("S5_cacheHit", { ...base, enabledBackends: ["a"], backends: { a:{} }, cacheEnabled: true }, { a: two.a }, { query: "cache me", maxResults: 8 }, store));
R.push(await sc("S6_zeroOk",   { ...base, enabledBackends: ["z"], backends: { z:{} } }, { z: mk("z", () => ({ sources: [] })) }, { query: "rare q", maxResults: 8 }));
R.push(await sc("S7_allFail",  { ...base, enabledBackends: ["x","y"], backends: { x:{}, y:{} } },
  { x: mk("x", () => { throw new Error("HTTP 429 too many requests"); }), y: mk("y", () => { throw new Error("connection refused"); }) },
  { query: "dead", maxResults: 8 }));
R.push(await sc("S8_cooledFailOpen", { ...base, enabledBackends: ["c"], backends: { c:{} }, breakerEnabled: true, breakerThreshold: 3, breakerCooldownMs: 60000 },
  { c: two.a }, { query: "cooled q", maxResults: 8 }, undefined,
  { c: { ok:false, at:Date.now()-5000, ms:1, error:"x", failCount:3, cooledUntil:Date.now()+24000, rateLimited:false } }));
R.push(await sc("S9_emptyQuery", { ...base, enabledBackends: ["a"], backends: { a:{} } }, two, { query: "搜索", maxResults: 8 }));
R.push(await sc("S10_keyless", { ...base, enabledBackends: ["k"], backends: { k:{} }, breakerEnabled: true, breakerThreshold: 3, breakerCooldownMs: 60000 },
  { k: mk("k", () => { throw new Error("HTTP 429 too many requests"); }) }, { query: "keyless", maxResults: 8 }, undefined,
  { k: { ok:false, at:Date.now()-1000, ms:1, error:"429", failCount:2, cooledUntil:Date.now()+30000, rateLimited:true, keylessRejected:true } }));
console.log(sha(R));
```

### 6.4 单场景刻意断言（比哈希更可读，出问题定位快）
- S1 顺序必须 `1,2,9,3`、`truncated=false`（跨后端按扇出优先级拼接收敛）。
- S2 `maxResults=3` → 3 条且 `truncated=true`。
- S3 multi → `history.backendsTotal=6`（2 后端 × 3 variant），telemetry 行里 `a ✓.. · b ✓..` 重复 3 次。
- S5 命中 → sources/content 与 S4 完全一致（除 `age`）。
- S7 → 错误串含 `all enabled backends failed (2) - x: HTTP 429…; y: connection refused`，`code=WEB_PROVIDER_ERROR`，`history.resultCount=0`。
- S8 → telemetry 行尾部同时有 `c ✓…/3` 与 `c ⏸cooled 24s`（fail-open 仍写注解）。
- S9 `"搜索"` → `empty query after shaping`；S10 → `all backends need an API key (keyless access is unavailable)`，且**零后端调用**。

### 6.5 跨调用状态（B 方案的必测项，A 方案也别省）
5. **Map 实例身份**：`getLatestBackendHealth()` 返回的必须是 `recordBackendHealth` 写入的**同一个** Map。断言：同 provider 连打两次同一后端，第二次必须看到第一次留下的 `failCount`；再断言 `getBackendBreaker(id)` 与 `getLatestBackendHealth().get(id)` 字段一致。这条专抓「拆文件各建一张表」的静默失败。
6. **`breakerEnabled:false` 仍写健康表**：`breakerCfg=null` 时 `foldBreaker(…, undefined)` 仍记录 `failCount/lastOkAt`（S8 变体）。
7. **`nowMs` 锚点**：构造一个"冷却窗口在慢搜索期间过期"的场景（后端 delay > 冷却剩余），telemetry 行必须出现 `(expired during search)`。这锁死 §5②的传参要求。

### 6.6 落地到真实 seam（本任务范围外，但必须写清）
8. 真机验收只能在 **dev 实例 3081**（`dev-instance.sh`）：同一 query 前后两次 `web_search` 的 sources 数量/顺序/content 一致。**主实例 3080 不许重启**（agent 就跑在 `0::/system.slice/dsh-web.service` 里，见 105 号）。且改动需同时落到 fixture 与 `~/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/`（当前两者**逐字节相同**），走 `g5/refresh.sh` 重建 + 35/35 校验。

## 7 无法验证 / 无法证明的部分

| # | 无法验证 | 原因 |
| --- | --- | --- |
| V1 | 真实 `ctx.web` seam 端到端（同一 query 走 host → provider → 模型可见结果） | 只读会话、无网、无 key；只用 fake backend 打 provider 自身 API。seam 侧顺序/去重由 `ctx.web` 决定，未观测 |
| V2 | `web_search` 真机前后的 sources 一致性 | 需在 3081 真实实例跑两次真查询（含真后端延迟），未做 |
| V3 | `/api/unified-search/health` 路由在 B 方案后仍读对表 | 只验证了 Map 实例身份（§6.5），未起 WebServer 打 HTTP |
| V4 | 严格逐字节 `content` 相等 | `ms`/`age` 天然抖动，只能归一化后比对 |
| V5 | 全库 `pnpm` 侧 gates（typecheck/lint/duplication） | 这是 npm 包 fixture（`@240xu/dsh-websearch` 2.8.4），不进 DSH monorepo 的 tsconfig 面 |
| V6 | 我读文件期间别人对 `provider.js` 的写入动机 | 观察到 14:45→14:48 两次改写（含临时 `planSearch` 在 82 行），无归属证据；本文已钉 md5 |

### A / B / C / D / E 判定

- **A（同文件内联拆分）= 采纳**。证据：A-ALL 实测 `582→619`、`search 374→257`、`81/81`、指纹不变、**零断言改动**、无新文件、无 Map 复制风险。移植成本最低、回滚最干净。
- **B（拆文件到 `lib/search/`）= 不采纳（本轮）**。证据：B-1 必须改 quota:81 的读源才有 81/81；且必须把 `latestBackendHealth` 提升成独立模块由两侧共享（否则静默失效）；净收益只有 −69 行。B-2 虽 81/81，但要传 10 个参数。**留作二期**：等 `lib/search/` 真有 3+ 个模块时再搬，届时把 12 条源断言改成"读 provider.js 或 lib/search/*.js"的聚合读法，一次性付清。
- **C（S4 扇出段）= 冻结**。6 个入参 + 写 Module Map + 2 条被钉文本；抽它要动 `privHost` 与 `timed out after` 两条断言，是唯一"动断言"的段。收益（79 行）不值得。
- **D（S2b 缓存命中短路 / S7 终结分支）= 冻结（A 形态）**。S2b 的提前 `return` 与 S7 的 10 依赖，使其只在 B 形态下可搬；A 形态下抽它们 = 加参数包换 26/41 行。
- **E（拆分上限）= `search() ≈ 255 行`**。这是 A-ALL 的实测下限（257）。再往下必须破 `cacheKey`（4 段链）或 `allTelemetry`（3 段链），即进入"必须改断言或必须共享模块状态"的区间。**在这个包上，250 行左右就是这道缝的物理下限**，不是懒惰。

---

# 附录 X：Lead 复核与裁决（2026-11-23 15:50）

## X.1 坐标复核：全部通过

| 专家给的 | Lead 实测 | 结论 |
| --- | --- | --- |
| md5 `877b1943…` / 582 行 / mtime 14:48:12 | md5 `877b1943` / 582 行 / mtime 2026-11-23 14:48:12 | ✅ |
| 与安装树逐字节相同 | `cmp` 通过，安装树同 md5 | ✅ |
| 14:45:39 曾出现 598 行 `planSearch` 中间版 | 备份 `opt-b2-20261123T144538/provider.js.orig` 即该 598 行版本 | ✅ |
| `search()` 本体 205–578 = 374 行 | 实测 205 起、578 止 | ✅ |
| `latestBackendHealth` 是模块级 Map（`provider.js:57`），只有 `recordBackendHealth` 写、S3b 读 | `:57 const latestBackendHealth = new Map()`；写 `:74`、读 `:326` | ✅ 风险成立 |

**专家这条风险判断很关键**：拆文件时若各建一张表，会**静默让冷却失效**，而 3b 的三个测试会因读取新表而**假绿**。

## X.2 段边界复核：9 段全部对上

抽查 17 个边界行（204/205、246/247、300/301、320/321、373/374、452/453、484/485、537/538、578），每一处都落在专家标注的位置。**比 Lead 最初的 8 段划分更细**（把 S2/S3 各拆成 a/b）。

## X.3 Lead 的裁决：**接受 A 的方案判断，但本轮不执行**

原因是**量纲冲突**，不是技术问题：

| 方案 | 行数变化 | 与「代码精简」目标 |
| --- | --- | --- |
| A-ALL（5 段全提） | 582 → **619**（**+37**） | ❌ 背离 |
| 只做 S6（`renderTelemetryLine`） | 582 → **594**（+12），压缩 JSDoc 后 **585**（+3） | ❌ 仍为净增 |
| S1 `planSearch`（上一轮试过） | 582 → **598**（+16） | ❌ 已回滚 |

**Lead 实测「拆分固有成本 ≈ +3 行/段」**：函数签名 + 闭合括号 + `return` 无法省掉，压缩 JSDoc 到 3 行后仍 +3。

## X.4 行为验证：专家说的指纹 Lead 复现了

Lead 用 `provider.js.orig`（582 行）与提取后的版本跑 6 场景（5 个正常查询 + 1 个 telemetry 关闭），剥离 telemetry 行（含真实 ms）后取 md5：

```
NEW: 4aea2048fb86c8c1e296f832ff257409
OLD: 4aea2048fb86c8c1e296f832ff257409
一致: ✅
```

⇒ **拆分确实行为无变化**，技术上成立。

## X.5 结论

**A 与 B 的技术判断全部采纳**（B 不推荐、A 可做、S4/S2b/S6主支/S7 冻结、下限 ≈255 行）。**本轮不执行**，因为 +3 起的净增与用户「代码精简」的量纲要求冲突。**建议下一轮以「重构」为名目时再做**（届时不以行数为考核）。

专家报告里的 B 实测代价（B-1 要新建 health-state 共享 Map、B-2 要传 10 个参数、净收益仅 −69 行）**是本轮最有价值的产出**——它直接否掉了「拆文件能减行」这个直觉。
