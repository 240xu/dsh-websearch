# 52-audit-core-b — 备份版审计 B（核心执行层）

> 备份版（5 个 fork 做 51–55 全量审计时的独立兜底）。取证时 `/home/ova/dsh/.artifacts/websearch-research/52-audit-core.md` **不存在**（`ls 52-*` 报 no such file），故按主版写；若后续主版落盘，本报告可作为交叉复核基线。
> **唯一写文件**：本报告。不改源码/配置/运行时/其它报告；不操作任务板（Lead 代收口）。全程只读（read/grep/glob + `/tmp` 下 `node` 最小复现，脚本跑完删）。
> 取证对象：`/home/ova/dsh/.artifacts/websearch-research/src-work/plugin/lib/`（**src-work 工作副本**，比本机安装的 2.8.4 新，含 `util/namespace.js`、`util/failure-label.js`）。基线 `.baseline-20261107-2116/`。取证时间 2026-11-08（Asia/Shanghai）。
> 证据等级：**A**=源码实证（路径:行号 / 带 ref 远端永久链接）；**B**=官方文档/上游官方源码（GitHub API `?ref=v2.2.5` 等，HTTP 200）；**C**=版本记录/既有报告（[57-audit-error-contract.md](57-audit-error-contract.md)、[50-decisions-executed.md](50-decisions-executed.md)）；**D**=本机实测（`node` 复现）；**E**=推断或无法验证（显式标注，不得当结论）。
> 初判来源：C 级 [57-audit-error-contract.md](57-audit-error-contract.md) §2.5 / §3 裁决 4 / §4 F-1、F-2、N-1、N-2、N-4；[41-bug-codehealth.md](41-bug-codehealth.md) §4；[31-adversarial-search.md](31-adversarial-search.md) §8。

---

## 0. 三条核心裁决（Lead 指定，先落盘）

### ① `provider.js:304` 全冷却 fail-open + `rateLimited` 零读取消费者 ⇒ 3b 尚未实现 【A+C】

**现状（A，精确行号）**：
```js
// src-work/plugin/lib/provider.js:293-305
const cooled = new Map();
let eligible = candidates;
if (breakerCfg) {
  const active = candidates.filter((c) => {
    if (isCooled(latestBackendHealth.get(c.id), nowMs)) {
      cooled.set(c.id, latestBackendHealth.get(c.id));   // :298 记下被冷却的 entry
      return false;
    }
    return true;
  });
  if (active.length > 0) eligible = active;
  else cooled.clear(); // all cooled -> fail-open                 // :304 ← 缺陷
}
```
- 当**所有**候选后端都在冷却窗口内（全部 429/额度失败）时，`active.length === 0` → 走 `:304`：`cooled.clear()` 清空冷却表，`eligible` 仍是 `candidates`（**全量照常扇出**）。⇒ 每次搜索重新打一遍已确认 429 的端点，**持续烧配额**，熔断形同虚设（[31-adversarial-search.md:244](31-adversarial-search.md) 的 `/tmp/adv-breaker.mjs` 实证 `search#4 429 → 仍然实际发起请求（failCount=4）`，C/D）。
- `rateLimited` 的落点（A）：`provider.js:63-75` `recordBackendHealth` 里 `rateLimited: opts.rateLimited === true`（`:73`）写进 health entry；调用点 `:354-355` 传 `{ rateLimited: rateLimited(err), retryAfterMs: retryAfterMsFrom(err) }`。
- **零读取消费者（C，57 号已证 + 本处 A 复核）**：`grep -rn "rateLimited" src-work/plugin/lib` 命中仅 `failure-label.js:6`、`breaker.js:27,43`、`provider.js:28,73,355` —— 都是**写/参数**，没有任何一处读 `latestBackendHealth.get(id).rateLimited`。`health.js:54-70` 的响应字段不含 `rateLimited`；`history.js:101-116` `toBackendObservability` 也只输出 `ok/ms/at/failCount/cooled`。⇒ **`rateLimited` 是只写不读的冗余状态；3b「全冷却快速失败」分支在源码中根本不存在**（57 §2.5 逐字结论）。`:304` 的注释 `// all cooled -> fail-open` 与 `breaker.js:9-11` 文件头注释「a fully-cooled fan-out falls back to running every backend (fail-open) so the breaker can never make search WORSE than no breaker」一致 —— 是**有意设计**，但与「429 配额保护」目标冲突。

**影响**：全部后端被限流时，不但不快速失败，反而清空冷却表全量重试；模型端拿到的是「N 个后端各自 429」的 `all enabled backends failed` 文本，而非明确的「限流、稍后重试」。**属行为改动（改模型可见文本 + 执行语义），需用户批准**。

**最小修法（提案，未执行）**：
```diff
// provider.js:303-305
  if (active.length > 0) eligible = active;
- else cooled.clear(); // all cooled -> fail-open
+ else if ([...cooled.values()].every((e) => e?.rateLimited === true)) {
+   // 全部因 429/额度冷却：按官方 v2.2.5「全冷却快速失败」，不再打限流端点烧配额。
+   // 需用户批准：改变模型可见错误文本与执行语义。
+   const until = Math.max(...[...cooled.values()].map((e) => e?.cooledUntil ?? 0));
+   const waitS = Math.max(0, Math.ceil((until - Date.now()) / 1000));
+   throw new WebError(
+     `unified search: all backends are rate-limited; retry after ~${waitS}s`,
+     "WEB_PROVIDER_ERROR",
+   );
+ } else {
+   cooled.clear(); // 非配额故障仍 fail-open（保持既有「不让搜索更差」语义）
+ }
```
> 前提：`cooled` 里的 entry 必须带可信 `rateLimited`。当前 `rateLimited()` 是纯文本正则（`failure-label.js:6-9`），57 §4 F-2 实测 **4 例误判**（`HTTP 402: quota exceeded`、`HTTP 200: anonymous user`、`HTTP 503: anonymous gateway`、无关文本含 `quota`）与 N-1 漏判（`openai.js:94-106` / `anthropic-like.js:140-152` 把 `HTTP 429` 覆盖成 provider detail）⇒ **直接按 `rateLimited` 快速失败会误伤可用后端**。必须先落地 57 §5 的 `webErrorFromResponse()`（结构化 `status`/`code`）再改此处，属**必要前置**（见 ②）。

### ② 3a 链完整性 + `retryAfterMsFrom()` 恒 60s 兜底 【A+C+D】

**3a（一次 429 立即冷却）链路（A）**：
```
provider.js:351-356  runBackend 失败回调
  → { rateLimited: rateLimited(err), retryAfterMs: retryAfterMsFrom(err) }
provider.js:63-65    recordBackendHealth → foldBreaker(prev, false, at, breakerCfg, opts)
breaker.js:43-46     if (opts.rateLimited === true) return { failCount, cooledUntil: now + max(0, retryAfterMs ?? cooldownMs) }
provider.js:66-74    latestBackendHealth.set(id, { ...entry, failCount, cooledUntil, rateLimited })
provider.js:296-302  下一次扇出 isCooled(...) 跳过该后端
```
⇒ **链路完整、无断点**（A）。`breaker.js:43` 确实绕过了 `threshold=3` 的普通失败路径（` breaker.js:47-48`），1 次即冷却；`cooledAnnotation`（`breaker.js:69-73`）给 `⏸cooled Ns` 遥测（`provider.js:446-450`）。**已确认无误**。

**`retryAfterMsFrom()` 恒 60s 兜底（A+D）**：
```js
// util/failure-label.js:16-23
export function retryAfterMsFrom(err) {
  const v = err?.cause?.response?.headers?.get?.("retry-after") ?? err?.retryAfter;
  if (v == null || String(v).trim() === "") return 60_000;      // :18 ← 几乎恒走这里
  …
}
```
- `egress-fetch.js:249-264` 的 `collect(res)` **确实构造了带完整 headers 的 `Response`**（`headersFromRaw(res)` `:266-271` 用 `res.rawHeaders`），但各后端在 `!response.ok` 时只取 `response.text()` 前 300 字符拼进 `WebError.message`，**没有把 `response` 挂到 `cause`/附加字段**（57 §2.2 / §2.3，C）。`grep -rn "cause: response|\.retryAfter =|\.status =|\.rateLimited =" src-work/plugin/lib` → **0 命中**（57 §2.4，D）。
- ⇒ `err.cause.response.headers.get("retry-after")` 恒 `undefined`，`err.retryAfter` 也无人设置 → `retryAfterMsFrom()` **恒返回 60_000**（D 级：把 `failure-label.js` 逐字抽出，喂 5 种伪造 err 均得 60000，除非手工塞 `cause.response` 或 `retryAfter` 字段；脚本已删）。
- **评估 57 F-1 的 `webErrorFromResponse()` 链**：方案正确且是 3b 的**必要前置**——统一 helper 在非 2xx 抛错点构造 `WebError` 后 `Object.assign(err, { status, retryAfter, rateLimited, code })`，分类器优先读 `code`/`status`（不再靠正则），`retryAfterMsFrom` 才能拿到真实 `Retry-After`。改动面 = 11 处非 2xx 抛错点（8 backend + `mcp-client` 2 处，57 §2.2 全量表）+ 1 helper + 1 分类器 + 1 provider 消费。
- **风险/待裁决（C/E）**：57 §5.2 注明的兼容性取舍 —— 3a 依赖 `Anonymo` 正则命中 Firecrawl keyless 的真实串「`Anonymous keyless access is unavailable`」，且 `tests/lead-20261108-quota.test.js:11` 有断言；去掉 `Anonymo` 会让既有测试失败。需 Lead 在 (a) helper 里为 Firecrawl 429/403 置结构化 `rateLimited:true` / (b) 暂留 `Anonymo` 兜底 之间裁决。本报告不擅自定案（E）。

### ③ `cacheKeyFor` 纳入 `resultOptions` 后的结果决定项漏项 【A+D】

**现状（A）**：`cache.js:39-56` `cacheKeyFor({query, filters, maxResults, backends, mode, resultOptions})`，canonical JSON 为 `{q,f,n,b,m,o}`；`provider.js:237-243` 构造 `resultOptions`：
```js
const resultOptions = {};
for (const [k, v] of Object.entries(opts)) {
  if (typeof v === "function") continue;
  if (/^(safeSearch|rerank|dedupStrategy|language|recency|numResults|resultHeader|resultTelemetry)$/.test(k)
      || /BaseURL$|^.*Model$|^.*ApiKeyEnv$|^enable[A-Z]/.test(k)) resultOptions[k] = v;
}
```
`cacheMode`（`provider.js:226`）= `(multi ? "multi" : "single") + (coverage ? "+coverage" : "")`，已进 key 的 `m`。`backends`（enabledBackends 排序）、`filters`、`maxResults`、`query`（shaped）都在 key 里。

**漏掉的结果决定项（A，逐项裁决）**：
| 选项 | 是否影响结果 | 是否进 key | 裁决 |
|---|---|---|---|
| `multiQueryEnabled` | **是**（决定 `variants` 数量、RRF 融合） | 间接：经 `cacheMode` 的 `multi`/`single`（`provider.js:222,226`） | ✅ 已覆盖（前提 `isComplexQuery` 只依赖 query，query 在 key 里） |
| `deepCoverage` | **是**（`backendMaxResults = ceil(n*1.5)`、`deepCoverage:true` 传给后端切 Tavily advanced / SearXNG 多类目 / Exa category） | 间接：`+coverage` 在 `cacheMode`；`maxResults` 进 key | ✅ 已覆盖 |
| `backendTimeoutMs` | **间接**：超时窗口改变「哪些后端来得及返回」→ 改变 sources 集合 | **否**（正则未列，`cacheMode` 也不含） | ❌ **P2 漏项** |
| `concurrency` | **否**（只影响同时跑几个，不改每后端结果；决定论上不改变合并结果） | 否 | ✅ 合理省略 |
| `breakerEnabled/Threshold/CooldownMs`、`cacheEnabled/Ttl`、`historyEnabled`、`enabledBackends` | `enabledBackends` 已单独进 `b`；其余只影响是否用缓存/熔断/历史，不改一次搜索的归并结果 | 否 | ✅ 合理省略 |
| `filters` 内的 `region` | **是**（若后端支持 region 映射） | 在 `f`（`normalizeFilters` 输出，A） | ✅ 已覆盖 |
| **`request?.maxResults` vs `opts.numResults`** | 请求级覆盖会改 `maxResults` | 在 `n`（`provider.js:198`） | ✅ 已覆盖 |
| **凭证值（API key 解析结果）** | 可能改后端返回（keyed vs keyless、提额） | **否**（只存 `*ApiKeyEnv` **引用名**，不存实际值） | ❌ **P2 漏项**：换 key/从 keyless 切 keyed 后 TTL 内可能吃旧结果（E：需真实后端验证是否真有差异） |
| `resultHeader`（Config 里不存在的死开关，41 §6 / 35-deep-dig-b F-10） | 恒真（`provider.js:430` 已无条件 prepend） | 列进正则但 `opts` 无此键 → 恒不写入 | ✅ 无害（但属死字段，P2 清理） |
| `resultTelemetry` | **是**（决定 `content` 尾部的遥测行） | ✅ 列进正则 | ✅ 已覆盖 |

**行为级复现（D）**：把 `cacheKeyFor` + `provider.js:237-243` 的 `resultOptions` 构造逐字抽出（`/tmp` 脚本，已删）：
```
opts A = {numResults:8, rerank:false, dedupStrategy:"url", backendTimeoutMs:30000,
          concurrency:6, enabledBackends:["exa"], tavilyBaseURL:"https://api.tavily.com/search"}
opts B = {...A, backendTimeoutMs:1000}         → cacheKeyFor(...,resultOptions A) === cacheKeyFor(...,resultOptions B)  ❌ 同键
opts C = {...A, rerank:true}                    → 不同键 ✅（改设置不吃旧结果）
opts D = {...A, dedupStrategy:"url+title"}      → 不同键 ✅
opts E = {...A, enabledBackends:["exa","ddg"]} → 不同键 ✅（b 维度）
opts F = {...A, multiQueryEnabled:true} + cacheMode multi → 不同键 ✅（m 维度）
opts G = {...A, deepCoverage:true} + cacheMode +coverage → 不同键 ✅
```
⇒ **「改设置是否真不再吃旧结果」：核心结果决定项（rerank/dedup/language/recency/numResults/*BaseURL/*Model/开关/multi/coverage/backends）全部覆盖，行为级复现通过**；仅 `backendTimeoutMs` 与「实际凭证值」两处漏项（P2/E）。

**最小修法（提案）**：`provider.js:240` 正则补 `backendTimeoutMs`；凭证值若要进 key 需 hash 后写入（**不得存明文**），且需先确认它真会改变结果（E，未实测）。

---

## 1. 必查 7 点逐条裁决表

> 以下为 §0 三条之外的补充裁决（§4–§7 展开）。

| # | 点 | 裁决 | 等级 |
|---|---|---|---|
| 4 | 扇出超时 `AbortSignal`/`setTimeout`/`clearTimeout` 清理、`allSettled` 尾延迟、错误隔离 | **清理链完整**（`.finally(clearTimeout)` 每路径都挂）；`Promise.allSettled` 尾延迟 = 最慢后端（默认 30s，ddg/searxng 5s 上限）；错误隔离完整 | A+D |
| 5 | `rrfFuse` / URL 白名单 / k=60 / 多查询门控 / 零结果 | **基本无误**；发现 P2：`rrf.js:17-20` 的 `itemKey` 允许 `t:title` 兜底键进入融合（但白名单在 collect 阶段已挡）、`isComplexQuery` 的 `COMPLEX_MARK_RE` 含裸 `和` 与 split 正则边界不一致导致「判复杂但拆不出变体」 | A+D |
| 6 | `history.js` 写链并发 / `health.js` 脱敏 / `resultHeader` 残留引用 | **写链正确**（promise chain + atomic rename）；`sanitizeError` 3 条正则有可绕过面（P2）；`resultHeader` 恒真判据已删（`provider.js:430`），但 `cacheKeyFor` 正则仍列 `resultHeader` 死字段 | A+D |
| 7 | 新发现 | 见 §6（P1 新发现 2 条 + P2 3 条） | A+D+E |
| 2 | `webErrorFromResponse` 链评估 | 方案正确、是 3b 必要前置；有 `Anonymo` 兼容性取舍需 Lead 裁决 | A+B+C |
| 3 | `cacheKeyFor` 漏项 | 2 处漏项（backendTimeoutMs / 凭证值），核心项全覆盖 | A+D |

---

## 2. §4 扇出超时与错误隔离（A+D）

**清理链（A）**：`provider.js:337-369` 每个 `runBackend`：
```js
const controller = new AbortController();                                  // :337
const mergedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;  // :338-340
const timeoutId = setTimeout(() => controller.abort(), effectiveTimeoutMs); // :342
return backend.search(variantReq, mergedSignal, beOpts, hooks)
  .then(ok, fail)                                                          // :345-357
  .catch(/* 超时重分类 WEB_PROVIDER_ERROR */)                                // :359-368
  .finally(() => clearTimeout(timeoutId));                                 // :369 ← 唯一清理点，挂在 promise 链尾
```
- `.finally` 挂在整条链尾（`.then().catch().finally()`），**成功 / 失败 / 超时重分类 / catch 内再抛** 四种路径都会执行 → 无泄漏（A）。`createLimiter`（`:90-116`）用 `Promise.resolve().then(fn).then(resolve).catch(reject).finally(...)`（`:108-111`），同步抛出的 baseURL 校验（`:333-335`）也落进 `finally`（`:103-107` 注释有 2.8.2 实测 exit=13 的修复记录）。
- **尾延迟（A+D）**：`Promise.allSettled`（`:372-380`）等**所有** settled；`effectiveBackendTimeoutMs`（`:45-48`）= `min(override, backendTimeoutMs)`，`BACKEND_TIMEOUT_OVERRIDES_MS = {ddg:5000, searxng:5000}`（`:39-42`），其余后端用全局 30000（`index.js` Config 默认）。⇒ 整批延迟 = `max(各后端耗时)`，一个不响应的 MCP/REST 非 ddg/searxng 后端可把整批拖到 30s；`concurrency`（默认 6，`:214`）只限制同时跑的数量，不改变尾延迟。D 级：抽出 `effectiveBackendTimeoutMs` 验证 `("exa",30000)→30000`、`("ddg",30000)→5000`、`("ddg",2000)→2000`。
- **错误隔离（A）**：`collectFanoutResults`（`:126-157`）把每个 rejected 折进 `failures[]`；`WEB_ABORTED` 仅在 caller signal 真触发时 `hardAborted`（`:146-149`）；`signal?.aborted || fold.hardAborted` → `searchAborted`（`:404-406`）；只要 `ordered.length > 0` 就返回 sources（`:423-467`），部分失败不拖垮整批；「全部成功但 0 条」正常返回空（`:473-492`，2.8.2 P1 修复）；仅 `allFailures.length > 0 && ordered.length===0` 才 `all enabled backends failed`（`:494-509`）。`throwIfSearchAborted`（`:192,:381`）在入口与扇出后各一次。
- **P2 小缺口（A）**：`AbortSignal.any` 创建的 mergedSignal 无 `removeEventListener` 显式解绑，但 `controller` 随 `runBackend` 结束即被回收，GC 可释放；调用方 signal 的监听随 provider 生命周期存在（每次 search 新建），无累积泄漏（E：未做长跑内存压测）。

---

## 3. §5 RRF / 白名单 / 多查询门控 / 零结果（A+D）

- **URL 白名单（A）**：`collectFanoutResults:142` `if (src && typeof src.url === "string" && /^https?:\/\//i.test(src.url))` —— 扇出阶段**丢弃**非 http(s) scheme；缓存命中路径 `provider.js:248-250` 二次过滤（防篡改缓存文件绕过），两处对称 ✅。`rrf.js:17-20` `itemKey` 对缺失 url 的项用 `t:title` 兜底进融合（P2：理论上可让无 URL 项混入 fused，但因 collect 阶段已挡，实际不可达；`rrfFuse` 也被其它调用方复用的话需各自保证，标 E）。
- **RRF k=60（A）**：`RRF_K = 60`（`rrf.js:14`），`1/(kk + rank)`（`:44`，rank 从 0 开始 —— 标准 RRF 常用 rank 从 1 开始 `1/(k+rank)`，`rank=0` 使首项权重 `1/60` 而非 `1/61`；常数偏移不影响相对排序，**非缺陷**，但文档 `:4-6` 引 Cormack et al. 2009 时未说明 0-based，属文档精度 P2）。`fused` 按分数降序、并列保持 first-appearance（`:52-54`）✅ 确定性。
- **多查询门控（A+D）**：`isComplexQuery`（`multiquery.js:31-37`）`q.length > 60` 或 `COMPLEX_MARK_RE = /(?:\bvs\.?\b|\band\b|比较|对比|和)/i`（`:20`）命中；`multiQueryEnabled` 默认 false（`index.js` Config，A）。**新发现 P2（D）**：`COMPLEX_MARK_RE` 含**裸 `和`**（无边界），而 `SEPARATOR_SPLIT_RE`（`:19`）要求 CJK 分隔符**任一侧有空白/标点**才切 ⇒ 词内「柔和」「和平」「和尚」会被 `isComplexQuery` 判为复杂，但 `deriveSubQueries` 拆不出 parts → `variants=[base]`，`multi=true` 却只有一个变体，`cacheMode` 仍标 `multi`（`provider.js:222,226`），`rrfFuse` 用单列表（`provider.js:418-420`）→ **结果不变但缓存键与单查询模式不同**（无害但浪费一次扇出判定 + 缓存分片）。D 级复现：`isComplexQuery("柔和光线")→true`、`deriveSubQueries("柔和光线")→["柔和光线"]`。建议门控复用 split 正则的边界版本。
- **零结果（A）**：`:473-492` 明确「零结果 ≠ 全部失败」，保留 `mergedContent`（Tavily 直答）+ `resultHeader` + 历史 + 缓存空结果（`:486`），`truncated:false`。✅ **已确认无误**（2.8.2 P1 修复逐字在注释 `:469-472`）。

---

## 4. §6 history / health / resultHeader（A+D）

- **`history.js` 写链（A）**：`:44` `let writeChain = Promise.resolve()`，`:66-78` `record()` 用 `writeChain = writeChain.then(() => {...})` 串行化 read-modify-write，`:56-62` `atomicWriteAll` tmp+rename；`toPublicEntry`（`:17-25`）只留 `query/time/resultCount/backendsOk/backendsTotal`，无 URL/凭证 ✅。**并发正确**（arch-review P2-2 注释 `:38-43` 有据）。P2：`clear()`（`:86-92`）**不在 writeChain 内** —— 并发 `record` 与 `clear` 交错时，clear 删文件后链中待执行的 record 可能**重建文件**（丢失「清空」语义）；`list()` 也不进链（读的是已原子落盘的文件，安全）。建议 `clear` 也 `writeChain = writeChain.then(...)`。
- **`health.js` 脱敏（A+D）**：`SECRET_PATTERNS`（`:15-19`）3 条：`sk-[A-Za-z0-9_-]{8,}`、`Bearer\s+[A-Za-z0-9._-]{8,}`、`(api[_-]?key|token|secret|password)\s*[=:]\s*\S{6,}`；`sanitizeError`（`:25-32`）先替换再 `\s+` 压缩再截 120。**P2 可绕过面（D）**：`x-api-key: <40-char>` 中 `x-api-key` 不匹配 `api[_-]?key`（前缀 `x-` 挡住）；`Authorization: Bearer` 已覆盖但 `X-API-Key` / `x-dsh-auth-token` 不被第 3 条匹配（无 `=` 或 `:` 后紧跟值的形态取决于 error 文本）；超长 token 若出现在 120 字符截断之后以外的位置也可能漏。⇒ 正则够用但非完备；建议加 `(x-api-key|x-dsh-auth-token|authorization)\s*[:=]\s*\S+` 与「全串 `\S{32,}` 一律 [redacted]」兜底。另 `health.js:63-64` 已新增 `optionalKey`/`metered` 字段（41 §5 修法已落地，A）✅。
- **`resultHeader` 恒真判据（A）**：`provider.js:430` `if (sources.length > 0 || outContent !== undefined) { const header = resultHeader(...); ... }` —— **无条件 prepend**（注释 `:427-428` 明写 "The result header is always prepended"）；零结果分支 `:475-478` 同样无开关。`grep -rn "opts.resultHeader\|resultHeader === false\|resultHeader !==" src-work/plugin/lib` → **0 命中**（A）。⇒ 死开关判据已删、无残留引用 ✅。但 `cacheKeyFor` 构造正则（`provider.js:240`）仍列 `resultHeader` —— 恒不写入 in key 的**死字段**（P2 清理项，无害）。`QUERY_GUIDANCE_EN/ZH`（`prompting.js:78-91`）仍是「导出但本插件不发送」的死导出（35-deep-dig-b F-10，C），非本轮必改。

---

## 5. §7 新发现（优先级排序）

| 级别 | 新发现 | 证据 | 影响 / 最小修法 |
|---|---|---|---|
| **P1（新）** | **`cooled.clear()` 在 3b 快速失败实现后会把 `cooled` 表清空，导致遥测丢失**：`provider.js:446-450` 的 `cooledParts` 依赖 `cooled.size > 0` 生成 `⏸cooled Ns`。当前 fail-open 分支 `:304` 一清空，即便全冷却，结果里的遥测行也**没有冷却标注**（模型看不到「哪些后端在冷却」）。即使不改 3b，也应把 `cooled.clear()` 改为「保留 cooled 用于遥测、只把 eligible 设为 candidates」 | A（`provider.js:304,446-450`）；D（抽出 cooled Map 复现 `size→0`） | 可观测性缺陷。`else { /* keep cooled for telemetry */ eligible = candidates; }`（`clear` 只删不写）。属低风险、非模型结果语义改动 |
| **P1（新）** | **`rateLimited` 写进 health entry 但 `breakerCfg=null`（用户关熔断）时完全不生效**：`provider.js:279-282` `breakerEnabled === false` → `breakerCfg=null` → `foldBreaker(..., null, opts)` 仍会用 `opts.rateLimited` 立即冷却（因为 `breaker.js:43` 不检查 cfg），但 `:295` `if (breakerCfg)` 整块跳过 → **冷却窗口写了却从不读**（`isCooled` 不在候选筛选里跑）。⇒ 关熔断后 `rateLimited` 状态纯属浪费，且「一次 429 立即冷却」承诺在关熔断时无效（符合「关熔断」语义，但文档未说明） | A（`provider.js:279-282,295-305`；`breaker.js:43`） | 文档/语义澄清；若要「关熔断仍尊重 429」，需把 429 冷却移出 `if (breakerCfg)`（行为改动，需批准） |
| **P2（新）** | `cacheKeyFor` 漏 `backendTimeoutMs` 与实际凭证值（§0 ③） | A+D | 正则补字段；凭证值需 hash（E 待确认是否真影响结果） |
| **P2（新）** | `history.js:86-92` `clear()` 不在 `writeChain` 内，并发 `record`/`clear` 可重建文件 | A | `clear` 也走 `writeChain.then(...)` |
| **P2（新）** | `isComplexQuery` 裸 `和` 与 split 边界不一致 → 判复杂但拆不出变体，`cacheMode` 误标 `multi` | A+D | 门控复用 split 正则的边界版本 |

---

## 6. 缺陷清单（P0/P1/P2：现状/影响/最小修法/回归断言）

| 级别 | 缺陷 | 现状（A） | 影响 | 最小修法 | 回归断言 | 需批准 |
|---|---|---|---|---|---|---|
| **P0** | 全冷却 fail-open 清空冷却表、重新全打 429 端点（§0 ①） | `provider.js:304` `else cooled.clear()`；`rateLimited` 只写不读 | 持续烧配额；3b 未实现 | 见 §0 ① diff（全 `rateLimited` 时快速失败 + 明确错误文本；非配额仍 fail-open） | 构造 4 个 `rateLimited:true` 冷却 entry → 抛 `all backends are rate-limited` 且**不调用任何 backend.search**；混合（1 非配额冷却）仍 fail-open | **是**（改模型可见文本 + 执行语义） |
| **P0** | `webErrorFromResponse()` 前置缺失 → `retryAfterMsFrom()` 恒 60s、分类器正则误判/漏判（§0 ② / 57 F-1,F-2,N-1） | `failure-label.js:6-9,16-23`；11 处非 2xx 抛错不带 status | 无法精确按 `Retry-After` 冷却；429 可能漏判等 3 次；402/200/503 误判 | 57 §5 的 helper + 11 处替换 + 分类器改「先 code/status 后正则」 | 假 `Response(429,{retry-after:"7"})` → `err.status=429, err.retryAfter="7", err.code="RATE_LIMIT", retryAfterMsFrom=7000`；无 header→60000；4 例误判负例全 `false`；`{cause}` 链保留 | **是**（若改错误文本） |
| **P1** | `cooled.clear()` 清空导致冷却遥测丢失（§5 新发现） | `provider.js:304,446-450` | 模型看不到冷却标注 | 保留 cooled 用于遥测，只重置 eligible | 全冷却结果里 `content` 含 `⏸cooled` 行 | 否（仅诊断文本） |
| **P1** | 关熔断时 `rateLimited` 冷却写了不读（§5 新发现） | `provider.js:279-282,295` | 语义未文档化 | 文档澄清，或把 429 冷却移出 `if (breakerCfg)` | 关熔断 + 一次 429 → 明确「不冷却」或「仍冷却」二选一并断言 | 视方案 |
| **P2** | `cacheKeyFor` 漏 `backendTimeoutMs` / 凭证值 | `provider.js:240`、`cache.js:39-56` | TTL 内可能吃旧结果 | 正则补 `backendTimeoutMs`；凭证值 hash 后入 key（先确认影响） | 改 `backendTimeoutMs` → 不同 key；改 `rerank`/`dedup`/`multi`/`coverage`/`backends` 仍不同 key | 否 |
| **P2** | `history.js clear()` 不进 writeChain | `history.js:86-92` | 并发清空被覆盖 | `clear` 走 `writeChain.then(...)` | 并发 `record`+`clear` 后 `list()` 为空 | 否 |
| **P2** | `isComplexQuery` 裸 `和` 边界不一致 | `multiquery.js:19-20,31-37` | `cacheMode` 误标 multi | 门控复用 split 边界 | `"柔和光线"` → `isComplexQuery=false`（或至少不产生 multi 缓存键） | 否 |
| **P2** | `sanitizeError` 3 条正则可绕过 | `health.js:15-19` | 潜在 token 回显（无实证泄露，E） | 加 `x-api-key`/`x-dsh-auth-token` 与 `\S{32,}` 兜底 | 构造 `x-api-key: sk-...` 与 40 字符裸串 → `[redacted]` | 否 |
| **P2** | `resultHeader` 死字段仍在 cache 正则；`QUERY_GUIDANCE_*` 死导出 | `provider.js:240`；`prompting.js:78-91` | 无害冗余 | 清理 | 无行为变化 | 否 |

---

## 7. 已确认无误（证伪清单）

1. ✅ `52-audit-core.md` 取证时不存在（`ls 52-*` 实证），本备份无需改为补遗。
2. ✅ **3a 链完整**：`recordBackendHealth(`:63-75`) → `foldBreaker(`:43-46`)` 一次 429 立即冷却 → `isCooled`(`:297`) 跳过 → `cooledAnnotation` 遥测，无断点（A）。
3. ✅ **扇出清理链完整**：`.finally(clearTimeout)`（`provider.js:369`）覆盖成功/失败/超时/同步抛四条路径；`createLimiter` 的 `.then(fn)` 防死锁（`provider.js:108`）有 2.8.2 实测注释（A+C）。
4. ✅ **错误隔离完整**：`allSettled` + 每后端独立 AbortController + `AbortSignal.any` + 软降级 + 部分成功即返回 + 「成功但零结果」正常返回空（A）。
5. ✅ **URL 白名单双处对称**：扇出 `provider.js:142` 与缓存命中 `provider.js:248-250` 都拦非 http(s)（A）。
6. ✅ **RRF 确定性**：k=60、`1/(k+rank)`、并列保持 first-appearance、`itemKey` 丢无键项（A）；rank 0-based 不影响相对排序（D）。
7. ✅ **多查询默认关、门控从严**：`multiQueryEnabled` 默认 false、原查询全权重参与、`MAX_SUB_QUERIES=3`、CJK 词内裸「和」不切（`multiquery.js:12-19` 注释 + D 复现）（A+D）。
8. ✅ **零结果 ≠ 全部失败**（`provider.js:473-492`），`mergedContent` 与 `resultHeader` 均保留（A）。
9. ✅ **`history.js` 写链并发正确**：`writeChain` 串行化 + atomic tmp+rename + `toPublicEntry` 无 URL/凭证（A）；`health.js` 已含 `optionalKey`/`metered`（41 §5 修法落地，A）。
10. ✅ **`resultHeader` 恒真判据已删、无残留引用**：`provider.js:430` 无条件 prepend，grep `opts.resultHeader` 0 命中（A）。
11. ✅ **`cacheKeyFor` 核心结果决定项全覆盖**：rerank/dedup/language/recency/numResults/*BaseURL/*Model/*ApiKeyEnv/enable*/multi/coverage/backends/filters/maxResults/query 全部进 key；行为级复现「改设置不吃旧结果」通过（D）。

---

## 8. 无法验证（E）

- **E-1**：`webErrorFromResponse()` helper 与 11 处替换**未执行、未实跑**；`Anonymo` 兼容性取舍（57 §5.2 注）需 Lead 裁决，本报告不定案。
- **E-2**：3b 快速失败 diff **未落地**；「全 `rateLimited` 时不调用任何 backend」的回归断言为提案，未执行。
- **E-3**：「实际凭证值改变后端返回」未用真实 key 验证（keyless vs keyed、Firecrawl 提额），故 `cacheKeyFor` 是否真需纳入凭证 hash 标 E。
- **E-4**：`rrfFuse` 被本插件以外调用方复用的可能性、`itemKey` 的 `t:title` 兜底是否可达，未核实（当前 collect 阶段已挡，实际不可达）。
- **E-5**：`AbortSignal.any` 的长跑内存/监听器累积未做压测（推理为无泄漏，标 E）。
- **E-6**：`sanitizeError` 的 token 回显**无实证泄露**，仅正则静态分析（57 N-4 同样标 E）。
- **E-7**：`src-work` 工作副本与本机安装版 2.8.4 的差异面未逐文件比对（本报告以 `src-work` 为准；Lead 若以安装版为准需重新核对行号）。
- **E-8**：`web_search`/`web_fetch` 本轮未复跑（只读任务）；所有真实遥测结论引自既有 C/D 级报告（31/41/57/50）。

---

## 9. 五条反直觉发现

1. **【反直觉】「fail-open 保证不让搜索更差」在配额场景恰好相反**：`breaker.js:9-11` 与 `provider.js:276-278` 都把「全冷却放行全部」写成安全性保证，但全后端 429 时它清空冷却表、每次重新全打一遍 —— **唯一被保护的量（配额）反而被持续消耗**。修法不是「加强熔断」而是「对配额故障取消 fail-open」，即官方 `core/src/websearch.ts:215` 的「全冷却快速失败」。（A+B+C）
2. **【反直觉】3a 已经把 `rateLimited` 存进 health entry，却没有任何地方读它**：`provider.js:73` 写、`breaker.js:43` 用（用的是**调用时传入的 opts**，不是 health entry 里的字段），`health.js`/`history.js` 都不返回该字段。⇒ 一个「为 3b 预留的状态」在 3b 不存在时是纯冗余；57 号据此把「3b 不可靠」修正为「3b 不存在」，措辞差别直接影响裁决。（A+C）
3. **【反直觉】`retryAfterMsFrom()` 看起来支持秒数/HTTP-date/兜底三种分支，实际恒走兜底**：`egress-fetch.js:249-271` 明明构造了带完整 `rawHeaders` 的 `Response`，但 11 处抛错点把它丢掉只留文本 → `err.cause.response` 恒 undefined → 60_000 恒定。**「功能已实现」与「功能可达」是两件事**；修法不在解析器而在抛错点。（A+C+D）
4. **【反直觉】`cacheKeyFor` 把 `resultHeader` 列进结果决定项，但它既不在 Config 里、也不影响结果**：`provider.js:430` 已无条件 prepend，`resultHeader` 是死字段；`multiQueryEnabled`/`deepCoverage` 这两个**真正改变结果**的开关反而没有直接进 key，而是靠 `cacheMode` 字符串间接覆盖 ——「显式列名」与「实际覆盖」不对称，审计时容易误判漏项。（A+D）
5. **【反直觉】`isComplexQuery` 判定「复杂」与实际「拆出变体」用两套不同边界**：门控正则含裸 `和`（无空白边界），切分正则要求 CJK 分隔符任一侧有空白 → 「柔和光线」被判复杂却只产生 1 个变体，`cacheMode` 仍标 `multi`、`rrfFuse` 收单列表。结果不变，但缓存键分片与一次无谓的扇出判定被悄悄引入 —— **门控与执行的一致性缺口比门控本身更难发现**。（A+D）

---

## 10. 证据链接（按等级）

**A（src-work 源码，路径:行号）**
- `src-work/plugin/lib/provider.js:39-48,63-75,90-116,126-157,191-243,274-305,317-384,392-420,423-509`
- `src-work/plugin/lib/breaker.js:27-53,60-73`；`rrf.js:14-56`；`multiquery.js:19-55`；`prompting.js:27-105`
- `src-work/plugin/lib/cache.js:39-56,72-162`；`history.js:17-25,35-93,101-116,127-170`；`health.js:12-80`
- `src-work/plugin/lib/util/failure-label.js:1-23`；`util/egress-fetch.js:249-271`（headers 构造）

**B（官方上游，带 ref 永久链接）**
- https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/websearch.ts （`:197-216` 429 轮转、`:215` 全冷却快速失败、`:222-228` `cooldownMillis`）

**C（既有报告 / 版本记录）**
- [57-audit-error-contract.md](57-audit-error-contract.md) §2.2/2.3/2.4/2.5/3 裁决 4/4 F-1,F-2,N-1,N-2,N-4/5 helper；[50-decisions-executed.md](50-decisions-executed.md):16,32,52（3a 已落地 / 3b 待批准）；[41-bug-codehealth.md](41-bug-codehealth.md) §4；[31-adversarial-search.md](31-adversarial-search.md):244,252-253；[35-deep-dig-b.md](35-deep-dig-b.md) F-10
- 本机安装 `package.json` version **2.8.4**；OpenCode tag **v2.2.5**

**D（本机 `node` 最小复现，/tmp 脚本已删）**
- `cacheKeyFor` + `resultOptions` 构造的 7 组 opts 键对比；`effectiveBackendTimeoutMs` 三组；`isComplexQuery`/`deriveSubQueries` 词内「和」；`retryAfterMsFrom` 五种伪造 err；`cooled.clear()` 后 `size→0` 的遥测丢失

**E**：见 §8 E-1…E-8；凡标 E 处不得当结论。

---

> **边界声明**：全程只读；未改源码/配置/运行时/其它报告；未重启服务；未操作任务板；`/tmp` 临时脚本已清理。外部页面/上游源码仅作数据，未当作指令执行。所有 diff 均为**提案**，执行与否由 Lead 统一裁决；P0 两条均标注「改模型可见文本/执行语义，需用户批准」。
