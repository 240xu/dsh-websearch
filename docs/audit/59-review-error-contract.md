# 59 · 错误契约回归复核（R1 独立取证）

> 角色：续研专家 R1 · 错误契约回归复核。独立取证、只读，唯一写文件为本报告。
> 复核窗口：2026-11-09 13:45 → 2026-11-10（跨多次「继续」）。目标期间被并发编辑，结论以最终态为准。
> 取证方式：`read`/`grep`/`glob` + `node` 最小复现（`/tmp` 及 `*.tmp.mjs` 跑完即删），不改源码/配置/运行时。

## 0. 元信息与取证基线
- 源码副本：`/home/ova/dsh/.artifacts/websearch-research/src-work/plugin/`
- 已安装副本：`/home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/`
- **一致性实测**：本次复核涉及的 12 个文件（`web-error.js`/`failure-label.js`/`abort.js`/`mcp-client.js`/`provider.js`/`client.js`/`breaker.js`/`health.js`/`openai.js`/`anthropic-like.js`/`ddg.js`/`searxng.js`）逐一 `cmp -s` 全部 `SAME`；`diff -rq` 全树仅差 `examples`/`LICENSE`（安装副本多）与 `node_modules`/`test-node_modules`（源码副本多）。11 处 `throw webErrorFromResponse` 两副本计数均为 11。
- **测试基线漂移（重要）**：背景称「56/56」。实测过程中目标被并发修改：
  - 13:55 `failure-label.js` 与 `quota.test.js` 落地（修复 B-1 过去 http-date）；13:59 `mcp-client.js`、14:00 `sse.test.js`、14:04 `interaction.test.js` 陆续落地。
  - 中途一次联合跑 `node --test tests/*.test.js` 得 **57 tests / 2 fail**（`MCP: response id does not match the request`），单文件隔离跑全过 → 判定为**编辑落地中途的瞬时不一致**，非稳定回归；相同文件重跑即消失。
  - 最终态：**60 tests / 60 pass / 0 fail**（`node --test tests/*.test.js`，`EXIT=0`）。文件 mtime 自 14:04 后稳定。
  - 结论：领军给的「56/56」已过期；当前是 60/60。本报告所有裁决基于最终态。
- 关键外部事实：`WebError`（`@deepseek-ai/dsh-web@0.2.1-rc.2`）= `class extends HarnessError {}`；`HarnessError` 构造器 `constructor(message, code, options){ super(message, options); this.code=code; this.name=new.target.name; }`（`dsh-llm/lib/index.js:126-134`）。`options` 透传 `Error`，仅 `cause` 生效。`DEFAULT_RETRYABLE_CODES` 含 `"RATE_LIMIT"`（同文件 `:251-257`），`QUOTA_EXCEEDED_CODE="QUOTA"`（`:138`），`harnessErrorCode()` 只看最外层 `HarnessError.code`（`:471-473`）。

---

## A. 逐条裁决表

| # | 复核项 | 裁决 | 文件:行号 | 命令 / 证据 |
|---|---|---|---|---|
| 1a | 11 处第一实参是否都是非 2xx `Response` | **成立** | 见 A-1 明细表 | `grep -rn "throw webErrorFromResponse" lib/`（11 命中）+ 逐处 `sed` 上下文 + `egress-fetch.js:245-260` |
| 1b | `openai.js`/`anthropic-like.js` 是否误把 `message` 当第一实参 | **不成立（未误传）** | `openai.js:107`、`anthropic-like.js:153` | 两处均为 `webErrorFromResponse(response, message, …)`；`message` 是**第二实参**（正文文本，非 Response），第一实参恒为 `response`。背景担心的「以前用 message 变量」已正确改造。 |
| 1c | helper 内 `Number(response?.status)` 每处是否拿到真实状态码 | **成立**（egressFetch 路径） | `web-error.js:27`、`egress-fetch.js:253-256` | `collect()` 用 `new Response(payload,{status: res.statusCode ?? 502, headers})` 构造，`status` 是真实数值。实测 `Response(429)`→`err.status=429`。`Number()\|\|0` 对 undefined/null 归 0（防御，无调用命中）。 |
| 1d | 11 处 text 实参是否为正文字符串 | **成立** | 各 backend | `text` 均为 `await response.text()` 截断串；`openai`/`anthropic-like` 为 `message`（`${id} API error (HTTP …)` 或解析出的 detail）。无一处误把 Response/对象当 text。 |
| 2a | `provider.js` 的 `allFailures.every(f => f.err.code === …)` 是否误分类新 code | **不成立（无误分类，但非针对本改动）** | `provider.js:529` | 该 `every` 只判 `WEB_PROVIDER_UNAVAILABLE`/`WEB_PROVIDER_CREDENTIAL_MISSING`，用于「全部缺 key」提示，`RATE_LIMIT`/`QUOTA` 本就不在其枚举内 → 不会因新 code 触发或漏触发任何分支。真正消费新 code 的是 `provider.js:383` 的 `rateLimited(err)`。 |
| 2b | `util/abort.js` 的 `isAbortedWebError` 是否「只认 WEB_PROVIDER_ERROR」 | **不成立（前提有误）** | `abort.js:24-26` | 实测代码为 `error instanceof WebError && error.code === "WEB_ABORTED"`，**只认 WEB_ABORTED**，不认 WEB_PROVIDER_ERROR。新 code `RATE_LIMIT`/`QUOTA` 不是 `WEB_ABORTED` → 不会被误判为取消；`instanceof WebError` 且 helper 产物确为 WebError 实例，但 code 不匹配 → 正确落到「backend failed」。 |
| 2c | `client.js` 的 `safeFailureReason` 是否只认 `WEB_PROVIDER_ERROR` | **不成立（无关模块）** | `client.js:289-292`、`client.js:513`、`client.js:423` | 该函数校验**任意** `[a-z][a-z0-9/_-]{0,60}` 形态 code（`settings-api`/credentials 的失败码），不枚举任何 WebError code；喂入的是 `keyErr`/`{code: reason}`，从不接收 `webErrorFromResponse` 产物。与本次错误契约无交集。 |
| 2d | 新 code 在**下游 seam** 有无被吞/被改 | **部分成立（新发现，见 N-3）** | `provider.js:533-537`、`dsh-llm/lib/index.js:471-473` | `webErrorFromResponse` 产物只在 fan-out 内部经 `rateLimited()`/`retryAfterMsFrom()` 消费（`provider.js:383`）用于 breaker；`RATE_LIMIT`/`QUOTA` **从不作为最终错误码上抛给 seam**——全失败时被 `provider.js:533` 包成 `WEB_PROVIDER_ERROR`（cause 才带 RATE_LIMIT），3b 快速失败也是 `WEB_PROVIDER_ERROR`。`harnessErrorCode()` 只取最外层 code → seam/重试策略看不到 `RATE_LIMIT`。 |
| 3 | 3b `.every(e => e.rateLimited === true)` 混合故障边界 | **成立（缺陷确认）** | `provider.js:300-326` | 真 provider harness 复现：`429+429` → 快速失败 0 调用；`429+403(均配额)` → 快速失败；**`429 + timeout/500(非配额已冷却)` → FAIL_OPEN**、两后端全重跑；`Retry-After:0` 混合 → 只重跑 1 个。逐条见 A-3 / 缺陷 P1-1、P1-2。 |
| 4 | `retryAfterMsFrom` 六类边界 | **部分成立（多数正确，2 处缺陷）** | `failure-label.js:30-43` | 实测矩阵见 A-4。`"0"`/数字 `0`→`0`（P2-1）；`"999999999"`/`"1e9"`→`1e12ms`（无上限，P1-3）；过去 http-date 已修为 `60000`（背景里担心的 B-1 已被并发修复）；HTTP-date 未来值正解；负数/空/NaN/非法→`60000`。 |
| 5 | `opts.cause` + 构造后赋值是否破坏 `instanceof WebError` | **不成立（未破坏）** | `web-error.js:35-45` | 实测：`instanceof WebError`/`HarnessError`/`Error` 全 `true`，`err.cause === cause` 为 `true`，`err.code/name` 正常，post-assign 的 `status/retryAfter/rateLimited/quota` 全部可读。`opts.cause===undefined` 走 `undefined` options 亦正常。**但 11 个调用点无一传 opts**（`grep` 确认），`opts.cause` 分支是死路径（P2-4）。 |
| 6 | 新发现优先 | **成立（6 项）** | 见 B 节 | P0-1 / P1-1 / P1-2 / P1-3 / P2-1 / P2-2 / P2-3 / P2-4，均带可复现判定。 |

### A-1 明细：11 处调用点逐核

| # | 文件:行 | 第一实参 | 来自 | 前置 `!ok` 守卫 | 判定 |
|---|---|---|---|---|---|
| 1 | `mcp-client.js:65` | `initResponse` | `egressFetch` (:47) | `:63 if(!initResponse.ok)` | ✓ 真 Response |
| 2 | `mcp-client.js:231` | `response` | `egressFetch` (:181) + 401/403/404 重试后 `response` 再赋值 (:206) | `:225 if(!response.ok)` | ✓ 真 Response（重试覆盖后仍为 Response） |
| 3 | `openai.js:107` | `response` | `egressFetch` (:72) | `:94 if(!response.ok)` | ✓ 真 Response；`message` 是第二实参 |
| 4 | `anthropic-like.js:153` | `response` | `egressFetch` (:116) | `:140 if(!response.ok)` | ✓ 真 Response；`message` 是第二实参 |
| 5 | `brave.js:70` | `response` | `egressFetch` (:51) | `:67` | ✓ |
| 6 | `mojeek.js:72` | `response` | `egressFetch` (:57) | `:69` | ✓ |
| 7 | `serper.js:72` | `response` | `egressFetch` (:51) | `:69` | ✓ |
| 8 | `tavily.js:81` | `response` | `egressFetch` (:60) | `:78` | ✓ |
| 9 | `searxng.js:83` | `response` | `egressFetch` (:66) | `:79` | ✓（但 :82-85 双分支等价，见 P2-2） |
| 10 | `searxng.js:85` | `response` | 同上 | `:79` | ✓ |
| 11 | `ddg.js:53` | `res` | `egressFetch` (:39) | `:50 if(!res.ok)` | ✓ 真 Response；**但抛错点在 fetch try/catch 内被二次包装，见 P0-1** |

`Number(response?.status)` 实测矩阵（`node` 复现）：`429→429`、`"429"→429`、`402→402`、`403→403`、`500→500`、`0/undefined/null→0`。egressFetch 的 `collect()` 保证 status 为数值；所有 11 处均经 egressFetch，无一命中退化路径。

### A-2 明细：下游 code 消费点全表（`grep -rn "\.code ===" lib/`）

| 位置 | 判定的 code | 与新 code 的关系 |
|---|---|---|
| `abort.js:25` `isAbortedWebError` | 仅 `WEB_ABORTED` | 新 code 不匹配 → 正确不视为取消 |
| `provider.js:147` `collectFanoutResults` | 仅 `WEB_ABORTED` | 同上 |
| `provider.js:529` `allKeyMissing` | `WEB_PROVIDER_UNAVAILABLE` / `WEB_PROVIDER_CREDENTIAL_MISSING` | 与新 code 无交集，不误判 |
| `failure-label.js:10` `rateLimited` | `RATE_LIMIT_CODE` / `QUOTA_CODE` | **新 code 的唯一结构化消费者**（经 `provider.js:383`） |
| `client.js:290` `safeFailureReason` | 任意合法形态字符串 | 不接收 helper 产物，无关 |
| `dsh-llm` `harnessErrorCode` | 最外层 `HarnessError.code` | 最终上抛恒为 `WEB_PROVIDER_ERROR`（见 N-3/P1-2 影响） |

### A-3 明细：3b 混合故障真 provider harness 复现

驱动**真实** `createUnifiedSearchProvider` + 假 backend（抛 `webErrorFromResponse` 产物），`getLatestBackendHealth()` 注入。命令：`node ./r1-3b-real.tmp.mjs`（跑完删）。

| 场景 | 第一次扇出后 health | 第二次 search 结果 | 第二次 backend 调用数 |
|---|---|---|---|
| 两个 429，Retry-After 60 | 均 `rateLimited=true, cooled≈60s` | `all backends are rate-limited; retry after ~60s` | **0**（快速失败生效） |
| **混合**：exa 429(R-A 0) + parallel 429(R-A 60) | exa `rateLimited=true cooled=0(未冷却)` / parallel `cooled=60s` | `all enabled backends failed (1) - exa …` | **1**（只重跑 exa，配额端点被再打一次） |
| **混合**：exa 429 + parallel 403 | 均 `rateLimited=true cooled=60s` | 快速失败 ~60s | 0（403 被当配额→覆盖，见 P1-1） |
| 内存等价 harness：429 + timeout(`rateLimited=false` 已冷却) | 一真一假 | **FAIL_OPEN**（`cooled.clear()`） | **2**（全部重跑，含已 429 的端点） |
| 内存等价 harness：403 + 500 | 一真一假 | **FAIL_OPEN** | 2 |

`.every(e => e?.rateLimited === true)` 只在「全冷却且全配额」时快速失败；只要有一个非配额或 `Retry-After:0` 的冷却项，就退回 fail-open 重跑全部。这与 52-b「部分配额故障未覆盖」一致，**且额外发现 `Retry-After:0` 会把该后端从 cooled 集合剔除**（`isCooled()` 要求 `> nowMs`），产生第三种边界。

### A-4 明细：`retryAfterMsFrom` 边界矩阵（对最终态 `failure-label.js:30-43` 实测）

| 输入 `err.retryAfter` | 结果(ms) | 判定 |
|---|---|---|
| `"7"` / `12` | `7000` / `12000` | ✓ 秒数字符串/数字 |
| `0` / `"0"` | **`0`** | ⚠ P2-1：零长度冷却，breaker 不生效 |
| `-5` / `-3` | `60000` | ✓ 负数回退 |
| `""` / `"   "` / `undefined` / `null` | `60000` | ✓ 空/缺失回退 |
| `"NaN"` / `"abc"` | `60000` | ✓ 非法回退 |
| `"1.5"` | `1500` | ✓（非整数秒被接受） |
| `"0x10"` | `16000` | ⚠ `Number()` 接受十六进制 |
| `"1e9"` | `1000000000000` | ⚠ `Number()` 接受指数 |
| `"999999999"` | `999999999000` (≈11574 天) | ⚠ **P1-3 无上限** |
| `"Wed, 21 Oct 2015 07:28:00 GMT"`（过去） | `60000` | ✓ 背景 B-1 已被并发修复（`:39-42` 新增 `ms > 0 ? ms : 60_000`） |
| 未来 HTTP-date | `>0`（实测 4318） | ✓ |
| `cause.response.headers.get("retry-after")` | `5000` | ✓ legacy 兜底 |
| HTTP-date 恰好过去 1ms | `60000`（而非 0） | ✓ |

---

## B. 缺陷清单（P0/P1/P2）

### P0-1 · `ddg.js` 把 helper 产物二次包装成 `WEB_PROVIDER_ERROR`，结构化字段降级
- **现状**：`ddg.js:50-64` 的 `webErrorFromResponse(res, …)` 抛错位于 fetch 的 `try` 内；`:56` 的 `catch` 无条件把任何非 abort 错误（含 helper 的 `WebError`）包成 `new WebError("ddg search failed: …", "WEB_PROVIDER_ERROR", {cause: err})`。其余 10 处的 helper 抛错都在 `try` 之外。
- **复现**（`node` 驱动真 `ddgBackend` + fake fetch）：
  - `429` → 顶层 `code=WEB_PROVIDER_ERROR, status=undefined, rateLimited=undefined, cause.code=RATE_LIMIT`；`rateLimited(wrapper)=true` 仅靠 message 里残留的 `"HTTP 429"` **legacy 正则**兜底，`retryAfterMsFrom(wrapper)` 需走 `cause.retryAfter` 兜底。
  - `402/403` → 顶层 `code=WEB_PROVIDER_ERROR, quota=undefined, cause.code=QUOTA`；**`rateLimited(wrapper)=false`**（`"HTTP 402/403"` 不含 429/额度/keyless 字样）→ 该后端的 QUOTA 分类**彻底丢失**，3a 立即冷却与 3b 全配额快速失败都漏算 ddg。
- **影响**：ddg（唯一 keyless HTML 后端，常作为兜底）在被限流/配额时不被 breaker 冷却，也不参与 3b 判定 → 全配额场景继续打 ddg，可能把「避免烧配额」的快速失败击穿。是 11 处里唯一的结构契约破口。
- **可 apply diff**：
```diff
--- a/lib/backends/ddg.js
+++ b/lib/backends/ddg.js
@@
     } catch (err) {
       if (signal?.aborted === true || isAbortError(err)) throw searchAborted(signal, err);
+      if (err instanceof WebError) throw err;   // helper 的 RATE_LIMIT/QUOTA 原样上抛
       hooks.recordOutcome?.({ status: "error", message: String(err?.message ?? err) });
       throw new WebError(
```
  （与 `firecrawl.js:82`/`tinyfish.js:80`/`exa.js:66`/`parallel.js:53` 的既有 `if (err instanceof WebError) throw err;` 保持一致。）
- **回归断言**：
```js
// tests/… 新增
test("ddg 402/403 keeps the QUOTA contract at top level", async () => {
  const { ddgBackend } = await import("../lib/backends/ddg.js");
  const { rateLimited } = await import("../lib/util/failure-label.js");
  // fake fetch → new Response("forbidden",{status:403}); proxy env cleared
  await assert.rejects(
    ddgBackend.search({query:"q",maxResults:2}, undefined, {}, hooks),
    (err) => err.code === "QUOTA" && err.quota === true && rateLimited(err) === true,
  );
});
```

### P1-1 · `status===403` 无条件映射为 `QUOTA`（把鉴权失败当配额耗尽）
- **现状**：`web-error.js:30` `const quota = status === 402 || status === 403;`。HTTP 403 在搜索类 API 里通常是「key 无效 / 无权限 / WAF 拦截」，并非配额耗尽。
- **影响**：`rateLimited()` → true → `foldBreaker` 立即冷却 60s（真实 harness 实测 `403` 使 `cooledUntil-now=60000`），且 3b 把该后端计入「全配额」→ 触发 `all backends are rate-limited` 快速失败。用户看到「被限流请稍后」，真因却是 key 失效，且 breaker 会掩盖问题 60s。`mcp-client.js:201` 自己也把 403 当「session 失效重试」，与 helper 的「配额」语义冲突。
- **可 apply diff**：
```diff
--- a/lib/util/web-error.js
+++ b/lib/util/web-error.js
@@
-  const quota = status === 402 || status === 403;
+  // 403 is commonly an invalid/unauthorized key, not an exhausted quota;
+  // only 402 (Payment Required) is unambiguously quota/billing here.
+  const quota = status === 402;
```
- **回归断言**：`webErrorFromResponse(new Response("x",{status:403}),"invalid key","Brave")` → `code === "WEB_PROVIDER_ERROR"`、`quota === false`、`rateLimited(err) === false`；并断言 402 仍为 `QUOTA`。

### P1-2 · 3b `.every()` 在混合故障下 fail-open，重打已限流端点（52-b 确认 + 扩边界）
- **现状**：`provider.js:311` 仅当 `active.length===0 && 所有 cooled 项 rateLimited===true` 才快速失败；否则 `:324 cooled.clear()` 并把 `eligible` 保持为**全部 candidates**（`:301 let eligible = candidates` 未被改写），于是连已 429 冷却的后端一起重跑。
- **复现**：真 provider harness（A-3）：`429 + timeout` / `429 + 500` 组合第二次 search 后端调用数 = **2**（全重跑）；`429(R-A=0) + 429(R-A=60)` = **1**（只重跑未冷却那个，仍打了限流端点）。内存等价 harness 的 `.every` 亦复现 `FAIL_OPEN (cooled.clear)`。
- **影响**：与 3b 注释「Re-issuing the fan-out would hit the same limited endpoints and burn more quota」自相矛盾；部分配额故障时快速失效保护落空。
- **可 apply diff**（保留至少一个未冷却后端参与，只跳过已配额冷却的）：
```diff
--- a/lib/provider.js
+++ b/lib/provider.js
@@
-        if (active.length > 0) eligible = active;
+        if (active.length > 0) {
+          // Keep cooled-out backends out of the fan-out even when a
+          // non-quota backend is still active: re-hitting a 429/402 endpoint
+          // burns quota. active already excludes every cooled candidate.
+          eligible = active;
+        }
         else if (cooled.size > 0 && [...cooled.values()].every((e) => e?.rateLimited === true)) {
```
  注：当前 `if (active.length > 0) eligible = active;` 只在**存在未冷却后端**时生效；当 `active.length===0`（全冷却）但非全配额时走 `else` 分支 `cooled.clear()` 且 `eligible` 仍为 `candidates`（全量）——这是 52-b 的核心漏点。更稳妥的改法是全冷却时按 `rateLimited` 逐个过滤 `candidates`，只对未配额冷却者 fail-open：
```diff
-        } else {
-          // Non-quota outages keep the existing fail-open behaviour so a
-          // breaker can never make search worse than no breaker.
-          cooled.clear();
-        }
+        } else {
+          // Only non-quota-cooled backends fail open; keep quota-cooled ones
+          // out so a mixed fault never re-hits a limited endpoint.
+          eligible = candidates.filter((c) => {
+            const e = cooled.get(c.id);
+            return e?.rateLimited !== true || !isCooled(e, nowMs);
+          });
+          cooled.clear();
+        }
```
- **回归断言**（真 provider）：`[exa:429, ddg:timeout×3→非配额冷却]` 第二次 search 应只调用 `ddg`，`exa` 调用数 = 0；并断言 `429(R-A:0)+429(R-A:60)` 场景不重打 parallel。

### P1-3 · `Retry-After` 无上限，可让后端被冷却 31 年
- **现状**：`failure-label.js:36` `secs * 1000` 无 clamp；`breaker.js:52` `nowMs + Math.max(0, retryAfterMs)` 无 cap。
- **复现**（真 helper+foldBreaker）：`"999999999"` → `999999999000ms`(≈11574 天)；`"1e9"` → `1e12ms`；`isCooled(...,nowMs)=true`。一个恶意/错误配置的 `Retry-After` 头即可永久禁用某后端，且 3b 快速失败会报 `retry after ~999999999s`，用户/模型无法行动。
- **可 apply diff**：
```diff
--- a/lib/util/failure-label.js
+++ b/lib/util/failure-label.js
@@
   const secs = Number(v);
-  if (Number.isFinite(secs)) return secs >= 0 ? secs * 1000 : 60_000;
+  // A hostile or misconfigured header must not disable a backend for years.
+  const MAX_RETRY_AFTER_MS = 24 * 60 * 60 * 1000;
+  if (Number.isFinite(secs)) return secs >= 0 ? Math.min(secs * 1000, MAX_RETRY_AFTER_MS) : 60_000;
   if (!Number.isFinite(date)) return 60_000;
   const ms = date - Date.now();
-  return ms > 0 ? ms : 60_000;
+  return ms > 0 ? Math.min(ms, MAX_RETRY_AFTER_MS) : 60_000;
```
- **回归断言**：`retryAfterMsFrom({retryAfter:"999999999"}) <= 86_400_000`；`foldBreaker` 后 `cooledUntil-now <= 86_400_000`。

### P2-1 · `Retry-After: 0` 产生零长度冷却，breaker 形同关闭
- **现状**：`"0"`/`0` → `0ms` → `foldBreaker` `cooledUntil = nowMs + 0`，`isCooled` 要求 `> nowMs` → 立刻不冷却。
- **复现**：真 provider harness（A-3 第 2 行）：`Retry-After:0` 的 exa 第二次被立即重打。
- **可 apply diff**：`if (Number.isFinite(secs)) return secs > 0 ? … : (secs === 0 ? 60_000 : 60_000)`，即 0 回退默认；或在 `foldBreaker` 对 `retryAfterMs<=0` 用 `cooldownMs`。
- **回归断言**：`retryAfterMsFrom({retryAfter:"0"}) === 60_000`；真 provider 下 `Retry-After:0` 的后端第二次仍被冷却跳过。
- 说明：HTTP 规范允许 `Retry-After: 0` 表示「可立即重试」，但从 breaker 视角立刻重打会放大限流；至少应给最小冷却（如 1s）而非 0。

### P2-2 · `searxng.js:82-85` 双分支等价（死分支）
- **现状**：`if (response.status === 429 || >=500) throw webErrorFromResponse(response, text, "SearXNG");` 与 `throw webErrorFromResponse(response, text, "SearXNG");` 完全一致。疑似上一轮替换遗留（旧版可能一处用不同 message）。
- **影响**：无功能差异（helper 已按 status 分类），但误导读者以为 429/5xx 有特殊处理；若后续有人只改其中一支会引入不一致。
- **可 apply diff**：删除 `:82-84` 的 `if`，只保留 `:85` 一处。
- **回归断言**：源码级 `assert.doesNotMatch(src, /if \(response\.status === 429 \|\| response\.status >= 500\)/)`。

### P2-3 · `openai.js`/`anthropic-like.js` 解析失败时 message 自嵌套
- **现状**：`:95`/`:141` 预置 `message = "${id} API error (HTTP ${response.status})"`，若 `response.json()` 抛错被吞，`webErrorFromResponse` 又拼一次前缀 → 实测 `"OpenAI API error (HTTP 429): openai API error (HTTP 429)"`。
- **影响**：仅可读性；健康面板/遥测里出现重复状态串。
- **可 apply diff**：预置改为 `let message = ""`（或 `"(no detail)"`），让 helper 统一加前缀。
- **回归断言**：`webErrorFromResponse(r, "", "OpenAI").message === "OpenAI API error (HTTP 429): "`。

### P2-4 · `opts.cause` 是死参数，且 `WEB_PROVIDER_ERROR` 丢失上游 cause
- **现状**：`web-error.js:26,38` 支持 `opts.cause`，但 11 个调用点全部只传 3 个实参（`grep -rn "webErrorFromResponse(.*{" lib/` 无命中）。HTTP 失败本身无 JS cause 可传，属可接受；但 `provider.js:533` 全失败汇总只把 `hardError`（**第一个**失败）作为 cause，其余后端的 `RATE_LIMIT`/`QUOTA` 结构化信息全部丢弃。
- **影响**：seam 侧无法从最终错误判断「本次是全配额失败还是普通故障」；`harnessErrorCode()` 恒得 `WEB_PROVIDER_ERROR`，`DEFAULT_RETRYABLE_CODES` 里的 `RATE_LIMIT` 对 web 搜索重试策略不生效（见 E-3）。
- **可 apply diff**：`provider.js:533` 在 `allFailures.every(f => rateLimited(f.err))` 时改用 `RATE_LIMIT` code 或附加 `failure` snapshot；或在 `webErrorFromResponse` 内把 `response` 挂到 `err.cause`（供 `retryAfterMsFrom` 的 legacy 兜底）。
- **回归断言**：全后端 429 时 `provider.search()` 拒绝的 `err.code === "RATE_LIMIT"`（或 `err.failure.code`）。

---

## C. 已确认无误（逐项实测）

1. **11 处第一实参全部是真非 2xx `Response`**：逐处 `grep`+`sed` 上下文核对，`egressFetch` 的 `collect()` 用 `new Response(...,{status:res.statusCode, headers})` 构造（`egress-fetch.js:253-256`），`Retry-After` 头经 `headersFromRaw` 可达。
2. **`openai.js`/`anthropic-like.js` 未误传 `message`**：`message` 是第二实参（正文文本），第一实参恒为 `response`；背景担心不成立。
3. **`Number(response?.status)` 拿到真实状态码**：实测 `Response(429/402/403/500)` → `err.status` 对应数值；`undefined/null→0` 防御分支无调用命中。
4. **`instanceof WebError` 未被破坏**：构造后赋值 + `opts.cause` 均保留 `instanceof WebError/HarnessError/Error`、`err.cause===cause`、`err.code`、`err.name`。
5. **下游无「只认 WEB_PROVIDER_ERROR」的误分类**：`abort.js:25` 只认 `WEB_ABORTED`；`provider.js:147/529` 判的是另外三类码；`client.js:safeFailureReason` 与 WebError 无交集。新 code 不会被误判成取消或缺 key。
6. **`failure-label.js` 分类器优先级正确**：结构化 `code`/`rateLimited`/`quota`/`status` 在前，正则仅 legacy 兜底；`new Error("quota exceeded")→false`、`"HTTP 200: anonymous"→false`、`"额度不足"→true`、`"MCP … HTTP 429"→true` 全部符合 `quota.test.js` 断言。
7. **过去 HTTP-date 缺陷已被并发修复**：`failure-label.js:39-42` 现在 `ms > 0 ? ms : 60_000`，实测 `"Wed, 21 Oct 2015 …"` → `60000`；`quota.test.js:105-111` 相应断言通过。
8. **3b 纯配额场景正确快速失败**：真 provider harness 实测 `429+429` 与 `429+403` 第二次 search **0 次 backend 调用**，message `all backends are rate-limited; retry after ~60s`。`3b-runtime.test.js` 与 `quota.test.js:76-83` 均通过。
9. **非配额冷却保持 fail-open**：`3b-runtime.test.js:74-101` 通过（预置 `rateLimited:false` 的冷却后端仍被调用 1 次）。
10. **源码副本与已安装副本一致**：本次涉及 12 文件逐一 `cmp -s` 全 `SAME`；11 处调用点两副本计数一致。
11. **最终测试全绿**：`node --test tests/*.test.js` → 60/60 pass，EXIT=0。

## D. 无法验证（诚实边界）

1. **真 provider 线上 HTTP 交互**：无有效 API key/额度（全局记忆 §9：DeepSeek 新号余额 `0E-16`，402），未对真实搜索端点发请求；所有 HTTP 故障均用 `Response` 对象 + fake `globalThis.fetch` 注入。egressFetch 的代理/CONNECT 传输层未实测（只读了实现）。
2. **seam / GUI 对新 code 的最终展示**：`ctx.web` 消费 `WebError` 的宿主代码在 `/usr/local/lib/node_modules/@deepseek-ai/dsh/`（当前运行时 checkout 已变为 `/home/dsh/.dsh-exp022/runtime/`），本次未加载运行中的宿主进程做端到端观测；`harnessErrorCode` 行为来自静态读取 `dsh-llm/lib/index.js`。
3. **服务 PID 2512598 的运行时状态**：未 attach/查询该进程（只读复核，不改运行时）；3b 结论来自新建 provider 实例 + 模块级 `latestBackendHealth` Map 注入，而非线上进程内状态。
4. **并发编辑的最终意图**：13:55–14:04 有其它 agent 连续落地修改（B-1 修复、SSE id 校验、M-1/M-3 交互），期间一次 57/2 的瞬时失败无法复现（重跑即 60/60）；无法判定那次失败是「编辑中途」还是「测试隔离」，只能标注为瞬时。
5. **`Retry-After` 十六进制/指数头的真实出现率**：仅证明 `Number()` 会接受（`0x10→16s`、`1e9→1e12ms`），未证明真实上游会发这种头；按 P1-3 的低概率面处理。

## E. 5 条反直觉

- **A**：`openai.js`/`anthropic-like.js` 里那个叫 `message` 的变量恰恰**没有**被误传为 Response——它正是第二实参（正文），第一实参是 `response`。背景里「以前用 message 变量」的担心，改造后反而成了最规范的两处。真正的第一实参异常不在这两处，而在 `ddg.js`：它传对了 Response，却因 `try/catch` 位置把 helper 的 `RATE_LIMIT`/`QUOTA` 全包成了 `WEB_PROVIDER_ERROR`（P0-1）。
- **B**：`rateLimited()` 的 legacy 正则本该是「兜底」，却在 ddg 的 429 场景下成了**唯一**能让它被识别为配额的路径（靠 message 里残留的 `"HTTP 429"` 字符串）；而 402/403 连这个兜底都没有 → 同一个 helper 产物，只因被多包了一层，QUOTA 分类静默消失。结构化字段的「防御性兜底」掩盖了结构化契约的破口。
- **C**：`web-error.js` 精心产出的 `RATE_LIMIT`（恰好是 dsh-llm `DEFAULT_RETRYABLE_CODES` 里唯一与限流相关的可重试码）**从来不会到达 seam**——`harnessErrorCode()` 只读最外层 code，而全失败/3b 快速失败都把外层写死成 `WEB_PROVIDER_ERROR`。也就是说这套新 code 全部价值只在插件内部的 breaker，对 harness 级重试策略零影响；改 `RATE_LIMIT` 字面量对模型重试行为没有任何作用。
- **D**：3b 的 `.every(rateLimited===true)` 越是「保守」越危险：一个后端返回 `Retry-After: 0`（HTTP 规范里合法、意为「立即可重试」）会让它 `cooledUntil === nowMs`，被 `isCooled()`（`> nowMs`）判为**未冷却**，于是它从 `cooled` 集合里消失、变成 `active`，`active.length>0` 直接跳过整个快速失败分支——第二次 search 精确地把那个刚 429 的端点再打一次。零冷却不是「不保护」，是「主动重打」。
- **E**：`safeFailureReason` / `isAbortedWebError` / `allKeyMissing.every(...)` 这三处被点名要查的下游，没有一处「只认 `WEB_PROVIDER_ERROR`」：`isAbortedWebError` 只认 `WEB_ABORTED`，`safeFailureReason` 不认任何特定码（只校验字符串形态），`allKeyMissing` 认的是另外两个码。任务书里的前提被源码推翻后，真正的风险反而转移到没人问的地方——`harnessErrorCode()` 只取最外层 code（见 C），以及 `web-error.js:30` 把 `403` 无条件算作 `QUOTA`（P1-1，把「key 无效」说成「稍后重试」并冷却 60s）。

---

## 附：本次执行的关键命令（可复算）

```bash
P=/home/ova/dsh/.artifacts/websearch-research/src-work/plugin
# 一致性
diff -rq $P/ /home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/
for f in ...; do cmp -s $P/$f /home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/$f; done
# 调用点/下游枚举
grep -rn "throw webErrorFromResponse" $P/lib/
grep -rn "\.code ===\|instanceof WebError" $P/lib/
# 测试
cd $P && node --test tests/*.test.js      # 60/60 pass
# 最小复现（均跑完删除）
node ./r1-helper.tmp.mjs        # helper + 真 Response + instanceof / cause
node ./r1-ddg.tmp.mjs           # 真 ddgBackend + fake fetch 429
node ./r1-ddg2.tmp.mjs          # ddg 429/402/403/500 分类丢失
node ./r1-3b.mjs                # 3b .every 内存等价 harness
node ./r1-3b-real.tmp.mjs       # 真 provider 3b 混合故障
node ./r1-final.tmp.mjs         # 403→QUOTA / 无上限 Retry-After / 0 / message 重复
node ./r1-bound.tmp.mjs         # retryAfterMsFrom 全边界矩阵
```

> 唯一写文件：`/home/ova/dsh/.artifacts/websearch-research/59-review-error-contract.md`（本报告）。未改源码/配置/运行时/其它报告，未操作任务板。
