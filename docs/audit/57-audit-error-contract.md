# 57 · 交叉审计 F · 全链路错误契约与 HTTP 状态透传

> 采样：2026-11-08（Asia/Shanghai） · 角色：第 6 份交叉审计 F（`local-impl`，task-32） · **唯一产出文件** `/home/ova/dsh/.artifacts/websearch-research/57-audit-error-contract.md`
> 触发：Lead 预研发现「跨所有 backend 的公共模式缺陷」无人专攻 —— 发布版 `HarnessError` 要求「route on `code`, never by parsing `message`」，而我们的分类器靠文本正则、所有 HTTP 抛错都不带 Response headers。
> **执行边界**：只读 `read`/`grep`/`glob` + 只读 `node` 最小复现脚本（stdin，未落盘到产物目录）+ 只读 `ps`。**未写任何源码/配置/运行时/其它报告**，未改 `src-work/`，未重启服务，未设 env，未跑 npm，未操作任务板，未把任何 token/密钥值写入报告或输出。
> 证据等级沿用全库规范：**A**=源码实证（路径:行号 / 带 ref 永久链接）、**B**=官方文档、**C**=版本/裁决记录、**D**=本机实测（命令+结果）、**E**=推断或待核实（显式标注，不得当结论）。
> 口径权威链：`99-final-verdicts.md` + `50-decisions-executed.md` + `56-full-audit-SKELETON.md`；不重复 30–35 已裁决结论。

---

## 0. 取证基线

| 对象 | 路径 / 版本 | 证据 |
| --- | --- | --- |
| 发布版 `HarnessError` | `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-llm/lib/types/error.js` | `[A]` 逐行读，`:12-20` |
| 发布版 `WebError` | `/usr/local/.../dsh-web/lib/index.js:19` `var WebError = class extends HarnessError {}` | `[A]` |
| 我们的工作副本 | `/home/ova/dsh/.artifacts/websearch-research/src-work/plugin/lib/`（`failure-label.js` 11-08 18:18、`mcp-client.js` 17:27、`egress-fetch.js` 07:34 已被改） | `[A]` |
| 运行安装版（对照） | `/home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/lib/` | `[A]` |
| 基线快照 | `.baseline-20261108-2205/`（53 份 md + 40 插件文件） | `[C] 56-full-audit-SKELETON.md` 基线表 |
| 服务 | active PID 587384（18:34 启动），43/43 单测、23 文件一致 | `[C] 56` §基线；`[D] ps aux` 复核 |
| 既有裁决 | `50-decisions-executed.md:16,32,52`（429 3a 已落地、3b 待批准）、`56-full-audit-SKELETON.md:40-52`（Lead 静态底稿：53 处 throw） | `[C]` |

**计数一致性（D）**：本代理 `grep -rn "throw new WebError" src-work/plugin/lib --include='*.js' | wc -l` → **53**，与 Lead 静态底稿 `56 §底稿` 的 53 处/14 文件**逐文件吻合**（8+5+4×6+3+2×4 = 53）。

---

## 1. 官方契约摘录（A/B 级，路径:行号）

`[A] /usr/local/.../dsh-llm/lib/types/error.js:12-20`：
```js
/**
 * Base class for all harness errors. Carries a `code` (stable, programmatic —
 * e.g. `NO_ADAPTER`, `INVALID_ARGS`) distinct from the
 * human-readable `message`, and supports `cause` chaining via the standard
 * `ErrorOptions`. `name` defaults to the subclass constructor name.
 */
export class HarnessError extends Error {
    /** Stable machine-routable failure class (e.g. `RATE_LIMIT`); route on this, never by parsing `message`. */
    code;                                                        // :14
    constructor(message, code, options) {                         // :15
        super(message, options);                                  // :16
        this.code = code;                                         // :17
        this.name = new.target.name;
    }
}
```
**同一文件已定义的稳定 code 常量**（`[A] :20-45`）：`CONTEXT_WINDOW_EXCEEDED_CODE='CONTEXT_WINDOW_EXCEEDED'`、`QUOTA_EXCEEDED_CODE='QUOTA'`、`ACCOUNT_QUOTA_EXCEEDED_CODE='ACCOUNT_QUOTA'`、`EMPTY_RESPONSE_CODE='EMPTY_RESPONSE'`、`INVALID_CREDENTIAL_CODE='INVALID_CREDENTIAL'`。
⇒ **关键事实（本审计新发现）**：官方 JSDoc `:13` 举的例子正是 `` `RATE_LIMIT` ``，且已有 `QUOTA` 常量 —— 我们**不需要发明新 code 名**，应优先复用官方常量/命名。

`[A] /usr/local/.../dsh-web/lib/index.js:19`：`var WebError = class extends HarnessError {};` —— **无字段扩展、无自定义构造器**，只继承 `code` + `cause`（`ErrorOptions`）。
`[A] dsh-web/lib/types/types.d.ts`：`WebError extends HarnessError`，JSDoc「Consumers must tolerate provider-specific codes」。

`[B] /home/ova/dsh/AGENTS.md:134`「Model-visible ⟺ logged」；`:error-handling` 相关条目「use typed, structured failures」。

---

## 2. 现状链路逐段实证（A/D）

### 2.1 分类器（问题核心）

`[A] /home/ova/dsh/.artifacts/websearch-research/src-work/plugin/lib/util/failure-label.js:1-23` 全文：
```js
// failure-label.js — classify quota/rate-limit failures from a WebError's
// message. Response headers do not reach WebError in this implementation, so
// retryAfterMsFrom() falls back to a fixed 60s cooldown.       // ← 作者自己承认

export function rateLimited(err) {
  const s = String(err?.message ?? err);
  return /HTTP 429|rate.?limit|429\b/i.test(s) || /Anonymo|quota|额度/i.test(s);   // :8
}
export function retryAfterMsFrom(err) {
  const v = err?.cause?.response?.headers?.get?.("retry-after") ?? err?.retryAfter; // :17
  if (v == null || String(v).trim() === "") return 60_000;
  const secs = Number(v);
  if (Number.isFinite(secs)) return secs >= 0 ? secs * 1000 : 60_000;
  const date = Date.parse(v);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 60_000;
}
```

### 2.2 抛错点全量清单（53 处 / 14 文件，A 级）

**非 2xx 直接抛错点（11 处，需 helper）**——这是本审计的主改动面：

| # | 文件:行号 | 现状 code | 是否带 status / retryAfter |
| --- | --- | --- | --- |
| 1 | `lib/util/mcp-client.js:64` `MCP initialize HTTP ${initResponse.status}: ${text}` | `WEB_PROVIDER_ERROR` | ❌ 都不带（但有 `initResponse.headers.get("Mcp-Session-Id")` 在 `:70`，说明 headers **可用**） |
| 2 | `lib/util/mcp-client.js:222` `MCP tools/call HTTP ${response.status}: ${text}` | `WEB_PROVIDER_ERROR` | ❌ |
| 3 | `lib/backends/searxng.js:82`（`status===429 || >=500` 分支，带「instance struggling」提示） | `WEB_PROVIDER_ERROR` | ❌（`:81` 明明判了 429） |
| 4 | `lib/backends/searxng.js:84`（其余非 2xx） | `WEB_PROVIDER_ERROR` | ❌ |
| 5 | `lib/backends/tavily.js:80` `Tavily API error (HTTP ${response.status}): ${text}` | `WEB_PROVIDER_ERROR` | ❌ |
| 6 | `lib/backends/serper.js:71` | `WEB_PROVIDER_ERROR` | ❌ |
| 7 | `lib/backends/brave.js:69` | `WEB_PROVIDER_ERROR` | ❌ |
| 8 | `lib/backends/mojeek.js:71` | `WEB_PROVIDER_ERROR` | ❌ |
| 9 | `lib/backends/ddg.js:52` `ddg HTTP ${res.status}...` | `WEB_PROVIDER_ERROR` | ❌ |
| 10 | `lib/backends/openai.js:106` `message`（`:94` 先拼 `HTTP ${response.status}`，但 `:98-102` 解析 JSON 成功后 **`message` 被 provider detail 覆盖，HTTP 状态丢失**） | `WEB_PROVIDER_ERROR` | ❌ |
| 11 | `lib/backends/anthropic-like.js:152` `message`（同 openai，`:140` 的 `HTTP ${response.status}` 可能被 `:146` detail 覆盖） | `WEB_PROVIDER_ERROR` | ❌ |

> **注**：`openai.js:106` / `anthropic-like.js:152` 是**最隐蔽的一处**：连 `HTTP 429` 文本都可能不出现（被 `parsed.error.message` 替换），导致 `rateLimited()` 连兜底正则都命中不了 → **429 被当成普通失败，要等 3 次才熔断**。这是比 Lead 预研更严重的变体（新发现 N-1）。

**MCP 结果级抛错（4 处，无 HTTP Response）**：`mcp-client.js:229`（`MCP error ${envelope.error.code}: ...`）、`exa.js:77` / `parallel.js:70` / `tinyfish.js:91` / `firecrawl.js:93` 的 `result.isError === true` → `returned an MCP error: ${message}`。这类**没有 Response**，只能靠 `envelope.error.code` / 文本，helper 不适用；但 `envelope.error.code` 是结构化字段（`:229`），应优先读它（新发现 N-2）。

**其余 38 处**（网络失败 `{cause:error}`、缺 key `WEB_PROVIDER_UNAVAILABLE` / `WEB_PROVIDER_CREDENTIAL_MISSING`、解析失败、abort `WEB_ABORTED`、provider 层 baseURL/timeout/all-fail）都**不是 HTTP 非 2xx**，不需要 helper，但共享「构造后附加字段」的写法约束（见裁决 3）。完整分布：

| 文件 | throw 数 | 文件 | throw 数 |
| --- | --- | --- | --- |
| `util/mcp-client.js` | 8 | `provider.js` | 5 |
| `backends/anthropic-like.js` | 5 | `brave.js` / `mojeek.js` / `openai.js` / `searxng.js` / `serper.js` / `tavily.js` | 各 4 |
| `parallel.js` | 3 | `ddg.js` / `exa.js` / `firecrawl.js` / `tinyfish.js` | 各 2 |

**code 分布（D，`grep -oE` 统计）**：`WEB_PROVIDER_ERROR` 49、`WEB_ABORTED` 10、`WEB_PROVIDER_UNAVAILABLE` 6、`WEB_PROVIDER_CREDENTIAL_MISSING` 3 —— **53 处里 49 处共用同一个 catch-all code**，无法区分 429/401/403/5xx/网络失败，正是「route on code」无法落地的原因。

### 2.3 headers 其实是可得的（关键前提，A 级）

Lead 预研说「Response headers 拿不到」——**不准确，需修正**：
`[A] lib/util/egress-fetch.js:249-260` `collect(res)` 构造 `new Response(payload, { status: res.statusCode ?? 502, headers: headersFromRaw(res) })`；`[A] :262-267` `headersFromRaw()` 从 `res.rawHeaders` 建 `Headers`；`[A] :7` 注释自述提供 `status, headers.get(), text(), json(), body.cancel()`。
⇒ **每个 backend 拿到的 `response` 都有 `response.headers.get("retry-after")` 和 `response.status`**，只是**抛错时没带走**。这不是传输层限制，是构造层遗漏 —— 修法比 Lead 预想更简单（不必改 egress-fetch）。

### 2.4 `retryAfterMsFrom()` 的真实行为（D 级复现）

`[D]` 本会话 `node` stdin 脚本（未落盘）：
```
现状 message-only:            60000 ms (期望 7000)      ← 恒 60s 兜底，Lead 判断成立
cause.response.headers:       7000 ms                    ← 若把 Response 放 cause.response 就能工作
proposed err.retryAfter:      7000 ms                    ← 构造后附加即可
HTTP-date form:               8299 ms (~9000)            ← Date.parse 分支可用
```
`[A] failure-label.js:17` 已预留 `err?.retryAfter` 与 `err?.cause?.response?.headers?.get?.("retry-after")` 两条读取路径，**两条当前都无人写入**：
`[D] grep -rn "cause: response\|\.retryAfter =\|\.status =\|\.rateLimited =" src-work/plugin/lib --include='*.js'` → **0 命中**（唯一 `status` 赋值是 `settings-api.js:246` 的 HTTP 响应对象，与 WebError 无关）。

### 2.5 429 3a / 3b 链路（C 级，需澄清 Lead 的前提）

`[C] 50-decisions-executed.md:16,32`：429 **3a（纯内部）已落地** —— 新增 `failure-label.js`、`breaker.js foldBreaker` 加 `opts.rateLimited`、一次 429 立即冷却、`provider.js recordBackendHealth` 把 `rateLimited` 存进 health entry；`:52`：**429 3b（全配额冷却快速失败）仍是「条件-go，需批准」，因为 `Retry-After` 实际取不到、只能 60s 兜底**。

**修正 Lead 前提（Q4）**：我在当前 `provider.js` **找不到 `.every(e => e.rateLimited === true)` 快速失败分支**。`[A] provider.js:290-304` 的实际语义是 **fail-open**：`if (active.length > 0) eligible = active; else cooled.clear(); // all cooled -> fail-open`（全冷却时**照常扇出**，不是快速失败）。`rateLimited` 只在 `:73` 存进 health entry，且 `[D] grep -rn "rateLimited"` 全 lib 只命中 `failure-label.js` / `breaker.js:27,43` / `provider.js:28,73,355` —— **没有任何读取 health entry 的 `rateLimited` 字段的消费者**（`health.js` 的响应 `:55-72` 不返回该字段、`history.js:100-115` 也不返回）。
⇒ 结论：`rateLimited` 目前是**只写不读的冗余状态**；3b 快速失败**尚未实现**，不是「不可靠」，而是「不存在」。这个区分影响裁决 4 的措辞。

### 2.6 `HarnessError` 构造语义（D 级复现，裁决 3）

`[D]` 本会话 `node --input-type=module` 忠实复刻 `error.js:12-20`：
```
A constructor-options: { code:'WEB_PROVIDER_ERROR', cause:'root', status:undefined, retryAfter:undefined }
  → super(message, options) 只吃 cause，传入的 status/retryAfter 被静默丢弃
B post-assign:        { code:'RATE_LIMIT', cause:'root', status:429, retryAfter:'7', rateLimited:true, instanceofHarnessError:true }
  → 构造后赋值安全，与 cause 共存，instanceof 链不变
C JSON.stringify:     {"code":"RATE_LIMIT","name":"WebError","status":429,"retryAfter":"7","rateLimited":true}
  → 附加字段参与序列化（tool/result meta 可能被持久化，是优点也是隐私面，见 N-4）
D code writable:      QUOTA
  → code 可写（非 readonly 运行时），但不应滥用
```

---

## 3. 逐条裁决表（5 个必答）

| # | 问题 | 裁决 | 依据（等级 + 路径:行号） |
| --- | --- | --- | --- |
| **1** | 是否应给非 2xx 稳定 code + 分类器优先读 code、正则只兜底 | **应，P0**。`code` 用官方命名：429 → `RATE_LIMIT`（JSDoc `:13` 的举例）、402/配额 → `QUOTA`（`QUOTA_EXCEEDED_CODE`）；其余保持 `WEB_PROVIDER_ERROR`。**不要发明 `WebError` 子类**（发布版 `WebError = class extends HarnessError {}` 无自定义构造器，第三方插件 subclass 会破坏 `instanceof WebError` 的 6 处判断，见 `abort.js:25,58`、`provider.js:146,501`、5 个 backend 的 `if (err instanceof WebError) throw err`）。**最小改法 = 工厂函数**（只在我们插件内构造时附加字段），不改发布版包：`new WebError(msg, code, {cause})` → 构造后 `Object.assign(err, { status, retryAfter, rateLimited })`。分类器改为「先 `err.code` → 再 `err.status` → 再 `err.rateLimited` → 最后正则兜底」。 | `[A] error.js:13,20-45`；`[A] dsh-web/lib/index.js:19`；`[A] failure-label.js:8`；`[D]` §2.6 复现；`[D]` 正则误判 4 例（§4 F-2） |
| **2** | 共享 helper `webErrorFromResponse(response, text)` 设计 + 全量抛错点 | **应，P0**。统一挂 `status` + `retryAfter` + `rateLimited` + `code`。改动面 = **11 个非 2xx 抛错点（10 文件：8 backend + mcp-client 2 处）** + 1 个新 helper 文件 + 1 处分类器 + 1 处 provider 消费。**不是 53 处全改**：其余 38 处（网络/解析/abort/缺 key）无 Response，保持原样；4 处 MCP 结果级抛错无 Response，用 `envelope.error.code` 代替（§4 N-2）。完整清单见 §2.2 表 + §5 diff。 | `[A] §2.2` 全量枚举；`[A] egress-fetch.js:249-267`（headers 可得）；`[D] grep` 计数 53/11 |
| **3** | `status`/`retryAfter` 与 `cause` 是否冲突；options 只吃 cause 的安全写法 | **不冲突**。`cause` 是 `ErrorOptions` 标准字段由 `super(message, options)` 处理；`status`/`retryAfter`/`rateLimited` 是构造后赋值的自有属性，互不覆盖。**唯一禁止**：把它们塞进第三个参数 options（`[D]` §2.6 A 组证明会被静默丢弃）。安全写法见 §5 diff 的 `attach()`：先 `const err = new WebError(msg, code, { cause })`, 再 `err.status = status; err.retryAfter = ...; err.rateLimited = ...;`，且**必须保留 `{cause: error}`** 以维持 `describeError`/链式诊断（`egress-fetch.js:344-348 sanitize` 与 `util/abort.js:58` 都依赖 cause）。 | `[A] error.js:15-18`；`[D]` §2.6 A/B/C/D 四组输出；`[A] util/abort.js:58` |
| **4** | 与 429 3b（全配额冷却快速失败）的关系 | **需修正前提**：当前**没有** `.every(e => e.rateLimited === true)` 快速失败分支；`provider.js:290-304` 是 fail-open（全冷却照常扇出），`rateLimited` 只写进 health entry 且**零读取消费者**（`health.js:55-72` / `history.js:100-115` 都不返回）。`[C] 50-decisions-executed.md:52` 明确 3b 仍是「条件-go，需批准」。⇒ **code/header 透传是 3b 的必要前置**，但不是「让它变可靠」而是「让它可实施」：只有 `err.status`/`err.rateLimited` 可信后，才能在 fan-out 前用 `allFailures.every(...)` 或 `candidates.every(c => latestBackendHealth.get(c.id)?.rateLimited)` 做快速失败并给出准确 `Retry-After`。**3b 仍属产品行为改动，需用户批准，本审计只给前置条件**。 | `[A] provider.js:73,290-304,355`；`[A] health.js:55-72`；`[A] history.js:100-115`；`[C] 50-decisions-executed.md:16,32,52`；`[D] grep -rn rateLimited` 全 lib |
| **5** | 其它跨模块公共模式缺陷 | **发现 5 条**（N-1 ~ N-5），见 §4：openai/anthropic 的 HTTP 状态被 detail 覆盖（最隐蔽）、`envelope.error.code` 未利用、`hooks.recordOutcome` status/count 不一致、错误文本 300 字符回显未脱敏、附加字段参与 JSON 序列化的隐私面。 | 逐条见 §4 |

---

## 4. 缺陷清单（P0/P1/P2）

### 4.1 P0（2 条，必须修）

| ID | 缺陷 | 现状 / 影响 | 最小修法（diff 见 §5） | 回归断言 |
| --- | --- | --- | --- | --- |
| **F-1** | **非 2xx 抛错不带 status/retryAfter/code**（11 处） | `[A]` §2.2；`retryAfterMsFrom()` 恒 60s（`[D]` §2.4）；违反官方「route on code, never by parsing message」（`[B] error.js:13`）；429 无法按 `Retry-After` 精确冷却 | 新增 `lib/util/web-error.js` 的 `webErrorFromResponse(response, text, label)`，11 处抛错改调它；分类器 `rateLimited()` 优先读 `code`/`status`/`rateLimited` | 假 `Response(429, {retry-after:"7"})` → `err.status===429`、`err.retryAfter==="7"`、`err.code==="RATE_LIMIT"`、`retryAfterMsFrom(err)===7000`；无 header → 60000；`{cause}` 链保留 |
| **F-2** | **`rateLimited()` 纯文本正则误判**（`[A] failure-label.js:8`） | `[D]` 本会话 8 例复现：**4 例误判** —— `HTTP 402: quota exceeded`（402 非 429）、`HTTP 200: anonymous user`（成功响应！`Anonymo` 命中）、`HTTP 503: anonymous gateway`（5xx 非配额）、`Perplexity quota is 0E-16`（无关文本含 quota）。误判会让 breaker **1 次就冷却**（`breaker.js:43`），把可用后端错误跳过；漏判（`openai.js` detail 覆盖，见 N-1）则**等 3 次**才冷却 | 同 F-1 的分类器改写：`if (err?.code === "RATE_LIMIT" \|\| err?.code === "QUOTA") return true; if (Number(err?.status) === 429) return true; if (err?.rateLimited === true) return true; /* 正则仅兜底，且去掉裸 `quota`/`Anonymo`，收紧为 `HTTP 429\|429\b\|rate.?limit` */` | 新增 4 条负例断言（402/200/503/无关 quota 文本均 `false`）；保留现有 `lead-20261108-quota.test.js:9-18` 的 7 条正/负例全绿（**零回归**） |

### 4.2 P1（3 条，建议修）

| ID | 缺陷 | 现状 / 影响 | 最小修法 | 回归断言 |
| --- | --- | --- | --- | --- |
| **N-1** | **`openai.js:94-106` / `anthropic-like.js:140-152` 把 `HTTP ${response.status}` 覆盖成 provider detail** | `[A]` 两个文件；解析 JSON 成功时 `message = detail`，**连 `HTTP 429` 文本都消失** ⇒ `rateLimited()` 的正则兜底也命中不了，429 被当普通失败（最隐蔽的 429 漏判，比 F-1 更甚） | 在覆盖前 `const status = response.status;` 并传给 `webErrorFromResponse`；message 仍可用 detail 但 `err.status` 独立携带 | 假 429 + JSON body `{"error":{"message":"slow down"}}` → `err.status===429` 且 `rateLimited(err)===true`（当前为 false） |
| **N-2** | **`mcp-client.js:229` 有结构化 `envelope.error.code` 却只拼进 message** | `[A]` `:229`；MCP 结果级错误（无 HTTP Response）无法用 helper，但 `envelope.error.code` 是稳定的机器可读字段，正是「route on code」的天然入口；`:135` 解析失败也吞掉原始文本 | 抛错前 `const code = envelope.error.code;`，构造后 `err.providerCode = code`；分类器加 `err.providerCode === "rate_limit_error" \| ...` 分支（**白名单，不解析 message**）；`:135` 把 `text.slice(0,120)` 附到 cause 便于诊断但不作为分类依据 | 假 `envelope.error.code="rate_limit_error"` → `err.providerCode` 命中且 `rateLimited===true`；未知 code → 不误判 |
| **N-3** | **`hooks.recordOutcome` 状态/计数字段不一致**（跨 13 backend） | `[A]` `[D]` grep 全量：成功态混用 `"ok"`（exa/parallel/ddg/tinyfish/firecrawl/openai/anthropic 部分）与 `"success"`（searxng/tavily/serper/brave/mojeek）；计数字段混用 `count`（多数）与 `sources`（`openai.js:112`、`anthropic-like.js:157`）。`util/log.js:58-61` 只判 `status === "error"`，故目前**不影响日志级别**，但任何将来按 `status==="ok"` 或 `count` 聚合的遥测都会漏一半 backend | 统一常量或归一化：在 `util/log.js` 的 `recordBackendOutcome` 入口做 `const ok = status === "ok" \|\| status === "success"; const count = out.count ?? out.sources;`，**单点归一**（不改 13 个 backend，改动面最小） | 分别传 `{status:"ok",count:3}` / `{status:"success",sources:3}` → 归一化后一致；`status:"error"` 仍走 `logger.warn` |

### 4.3 P2（2 条，可接受 / 需登记）

| ID | 缺陷 | 现状 / 影响 | 建议 |
| --- | --- | --- | --- |
| **N-4** | **错误文本回显未脱敏 + 附加字段参与序列化** | `[A]` 9 处 `text().slice(0,300)`（brave/mojeek/searxng/serper/tavily/mcp-client ×2）与 `ddg.js:51` 的 200 字符，直接把上游响应体拼进 `WebError.message`；`provider.js:352` 截 80、`:497` 截 120 后进模型可见的 `all enabled backends failed` 文本。若上游错误体含回显的 query/token 片段，会进入模型请求与 session log（`[D]` §2.6 C 组证明附加字段参与 `JSON.stringify`）。**当前无实证泄露**，`[E]` 标待核实 | 不扩大改动面：在 `webErrorFromResponse` 里对 `text` 做与 `egress-fetch.js:344-348 sanitize()` 同级的 `\s+` 压缩 + 截 140，并对 `retryAfter` 只存规范化毫秒数（不存原始 header 值），避免把任意上游字符串带进序列化面 |
| **N-5** | **`mcp-client.js:121,133` 空 catch 吞解析异常** | `[A]` 两处 `catch {}` 在 SSE/JSON 解析链里；`:135` 最终抛「failed to parse response envelope」但**不带原始文本**，与 §4.1 的「空 catch names the error」（`AGENTS.md`）规范有张力。`[C] 56 §底稿` 已把它们列为「需核对是否吞真实错误」 | 与 N-2 合并处理：把最后一段 `text.slice(0,120)` 放进 `{cause}` 或 `err.parsePreview`，不改分类语义；**不单独列 P0/P1**（`56` 已登记，避免重复裁决） |

---

## 5. 可 apply 的 diff 片段（提案，未执行）

### 5.1 新增 `lib/util/web-error.js`（共享 helper，单一改动点）

```diff
--- /dev/null
+++ b/lib/util/web-error.js
@@ -0,0 +1,42 @@
+// Shared HTTP-failure constructor for the unified search provider.
+// WebError (published dsh-web) extends HarnessError, whose constructor
+// `super(message, options)` consumes only `cause`; extra fields MUST be
+// assigned after construction (verified against dsh-llm/lib/types/error.js:15-18).
+import { WebError } from "@deepseek-ai/dsh-web";
+
+/** Canonical codes: RATE_LIMIT is the JSDoc example at error.js:13; QUOTA is
+ *  QUOTA_EXCEEDED_CODE at error.js:22. Never invent a WebError subclass —
+ *  6 call sites rely on `instanceof WebError` (abort.js:25,58; provider.js:146,501;
+ *  exa/parallel/tinyfish/firecrawl/openai/anthropic-like catch guards). */
+export const RATE_LIMIT_CODE = "RATE_LIMIT";
+export const QUOTA_CODE = "QUOTA";
+
+function headerValue(response, name) {
+  try { return response?.headers?.get?.(name) ?? undefined; } catch { return undefined; }
+}
+
+/**
+ * Build a WebError from a non-2xx Response, preserving the cause chain.
+ * @param {Response} response - egressFetch Response (egress-fetch.js:249-260
+ *   constructs it with status + headersFromRaw, so retry-after IS reachable).
+ * @param {string} text - already-bounded upstream body (<=300 chars).
+ * @param {string} label - backend name for the human-readable message.
+ * @param {{cause?: unknown}} [opts] - optional underlying error.
+ */
+export function webErrorFromResponse(response, text, label, opts = {}) {
+  const status = Number(response?.status) || 0;
+  const retryAfter = headerValue(response, "retry-after");
+  const rateLimited = status === 429;
+  const code = rateLimited ? RATE_LIMIT_CODE
+    : (status === 402 || status === 403) ? QUOTA_CODE
+    : "WEB_PROVIDER_ERROR";
+  const message = `${label} API error (HTTP ${status}): ${String(text ?? "").slice(0, 140)}`;
+  // `super(message, code, options)` only accepts `cause`; attach the rest AFTER.
+  const err = new WebError(message, code, opts.cause === undefined ? undefined : { cause: opts.cause });
+  err.status = status;
+  err.retryAfter = retryAfter;          // raw header value; retryAfterMsFrom parses it
+  err.rateLimited = rateLimited;
+  return err;
+}
```

### 5.2 `lib/util/failure-label.js` 分类器（正则降为兜底）

```diff
--- a/lib/util/failure-label.js
+++ b/lib/util/failure-label.js
@@ -1,9 +1,20 @@
-// failure-label.js — classify quota/rate-limit failures from a WebError's
-// message. Response headers do not reach WebError in this implementation, so
-// retryAfterMsFrom() falls back to a fixed 60s cooldown.
+// failure-label.js — classify quota/rate-limit failures. Route on the stable
+// `code` / `status` / `rateLimited` fields first (HarnessError JSDoc:
+// "route on this, never by parsing message"); message regex is a legacy
+// fallback for errors built before webErrorFromResponse() landed.
+import { RATE_LIMIT_CODE, QUOTA_CODE } from "./web-error.js";
 
 /** True when the error message indicates a rate limit or exhausted quota. */
 export function rateLimited(err) {
+  if (err?.code === RATE_LIMIT_CODE || err?.code === QUOTA_CODE) return true;
+  if (err?.rateLimited === true) return true;
+  if (Number(err?.status) === 429) return true;
+  if (typeof err?.providerCode === "string"
+      && /^(rate_limit_error|quota_exceeded|insufficient_quota)$/.test(err.providerCode)) return true;
+  // Legacy fallback: MUST NOT match bare "quota"/"Anonymo" (false positives on
+  // HTTP 200/402/503 bodies). Keep only status-bearing / explicit rate wording.
   const s = String(err?.message ?? err);
-  return /HTTP 429|rate.?limit|429\b/i.test(s) || /Anonymo|quota|额度/i.test(s);
+  return /HTTP 429|429\b|rate.?limit/i.test(s) || /额度/i.test(s);
 }
```

> `[E]` 兼容性风险：`50-decisions-executed.md:32` 的 3a 依赖 `Anonymo` 命中 Firecrawl keyless 的真实串「`Anonymous keyless access is unavailable`」，且 `tests/lead-20261108-quota.test.js:11` 有该断言。**去掉 `Anonymo` 会让这条既有测试失败**。故 §5.2 我保留了「显式 rate wording」但**未保留 `Anonymo`** —— 这是需要 Lead 裁决的取舍：要么 (a) 在 `webErrorFromResponse` 里为 Firecrawl keyless 的 429/403 明确置 `rateLimited:true`（推荐，结构化），要么 (b) 暂时保留 `Anonymo` 兜底并标注「仅 legacy 路径」直到所有 backend 都改用 helper。**本报告不擅自定案**，标 E 交 Lead。

### 5.3 11 处抛错点改法（同一模板）

```diff
--- a/lib/backends/tavily.js
+++ b/lib/backends/tavily.js
@@ -1,4 +1,5 @@
 import { WebError } from "@deepseek-ai/dsh-web";
+import { webErrorFromResponse } from "../util/web-error.js";
@@ -77,9 +78,9 @@
     if (!response.ok) {
       const text = await response.text().catch(() => "").then((tx) => tx.slice(0, 300));
       hooks?.recordOutcome?.({ status: "error", message: `HTTP ${response.status}: ${text}` });
-      throw new WebError(`Tavily API error (HTTP ${response.status}): ${text}`, "WEB_PROVIDER_ERROR");
+      throw webErrorFromResponse(response, text, "Tavily");
     }
```

**全量 11 处（文件:行号 → 替换目标）**：

| # | 文件:行号 | 备注 |
| --- | --- | --- |
| 1 | `backends/tavily.js:80` | 直替 |
| 2 | `backends/serper.js:71` | 直替 |
| 3 | `backends/brave.js:69` | 直替 |
| 4 | `backends/mojeek.js:71` | 直替 |
| 5 | `backends/ddg.js:52` | 变量名 `res` 非 `response` |
| 6 | `backends/searxng.js:82` | 429/5xx 分支，保留「instance struggling」提示可拼进 `text` |
| 7 | `backends/searxng.js:84` | 其余非 2xx 分支 |
| 8 | `backends/openai.js:106` | **N-1**：必须用 `response.status`，不能用被 detail 覆盖的 `message` |
| 9 | `backends/anthropic-like.js:152` | **N-1**：同上，且 label 用 `${id}` |
| 10 | `util/mcp-client.js:64` | `initResponse`（initialize 阶段） |
| 11 | `util/mcp-client.js:222` | `response`（tools/call 阶段） |

> `[A]` 另有 `mcp-client.js:196` 的 401/403/404 重试分支：它**不抛错**（invalidateSession + 重试），helper 不适用，但重试后仍会落到 `:222`，故覆盖完整。

### 5.4 N-3 单点归一（`util/log.js`，不改 13 个 backend）

```diff
--- a/lib/util/log.js
+++ b/lib/util/log.js
@@ -55,6 +55,9 @@
 export function recordBackendOutcome(ctx, backendId, outcome) {
   try {
     const logger = ctx && ctx.logger;
     if (!logger) return;
-    const status = outcome && typeof outcome.status === "string" ? outcome.status : "";
+    // Normalize the two legacy success spellings and count field names so a
+    // future telemetry consumer sees one shape across all 13 backends.
+    const raw = outcome && typeof outcome.status === "string" ? outcome.status : "";
+    const status = raw === "success" ? "ok" : raw;
+    const normalized = (outcome?.count === undefined && outcome?.sources !== undefined)
+      ? { ...outcome, status, count: outcome.sources } : { ...outcome, status };
-    const line = "[websearch:" + backendId + "] outcome " + JSON.stringify(outcome ?? {}).slice(0, 500);
+    const line = "[websearch:" + backendId + "] outcome " + JSON.stringify(normalized).slice(0, 500);
     if (status === "error" && typeof logger.warn === "function") logger.warn(line);
     else if (typeof logger.debug === "function") logger.debug(line);
```

### 5.5 N-1 的 openai/anthropic 补 status（伪 diff，与 5.3 合并）

```diff
   if (!response.ok) {
+    const status = response.status;              // ← before any JSON parse overwrites `message`
     let message = `${id} API error (HTTP ${status})`;
     try { const parsed = await response.json(); /* ... message = detail ... */ } catch { ... }
     hooks.recordOutcome?.({ status: "error", message });
-    throw new WebError(message, "WEB_PROVIDER_ERROR");
+    const err = webErrorFromResponse(response, message, id);
+    // keep provider detail but never lose the machine-readable status/code
+    throw err;
   }
```

---

## 6. 改动面与风险评估

| 维度 | 评估 | 证据 |
| --- | --- | --- |
| 文件数 | **新增 1**（`util/web-error.js`）+ **修改 12**（8 backend: tavily/serper/brave/mojeek/ddg/searxng/openai/anthropic-like；`util/mcp-client.js`；`util/failure-label.js`；`util/log.js`；`tests/*` 新增断言）+ `provider.js` **仅 3b 获批后才动**（当前不动） | `[A]` §2.2 / §5.3 全量表 |
| 代码行数 | 约 +45（helper）+ 11 处各 2 行替换 + 分类器 ~10 行 + log ~5 行 ≈ **+85 / −15** | `[E]` 估算，非实测 |
| 不改的东西 | 发布版 `dsh-llm` / `dsh-web` 包（硬约束）；`egress-fetch.js`（headers 已可得）；53 处里的其余 38 处 WebError；`provider.js` 的 fail-open 分支；模型可见文本（3b 需批准） | `[A] §2.3`；`[C] 50-decisions-executed.md:32` |
| 兼容性风险 1 | **去掉 `Anonymo` 会破 `tests/lead-20261108-quota.test.js:11`**（3a 的 Firecrawl keyless 真实串）→ 见 §5.2 的 `[E]` 取舍，需 Lead 裁决；建议 (a) 在 helper 里把 Firecrawl 403/429 明确置 `rateLimited:true` | `[C] 50:32`；`[A] tests/...:11` |
| 兼容性风险 2 | 6 处 `instanceof WebError` 判断：helper 返回的是**原生 `new WebError(...)`**（不是子类），instanceof 链不变 → **零回归** | `[A] abort.js:25,58`、`provider.js:146,501`、5 backend catch guards；`[D]` §2.6 B 组 `instanceofHarnessError:true` |
| 兼容性风险 3 | `code` 从 `WEB_PROVIDER_ERROR` 变为 `RATE_LIMIT`/`QUOTA`：`provider.js:501` 的 `allKeyMissing` 只判 `WEB_PROVIDER_UNAVAILABLE`/`WEB_PROVIDER_CREDENTIAL_MISSING`，**不受影响**；`allFailures` 的 `err.message` 拼接也不受影响 | `[A] provider.js:496-505` |
| 兼容性风险 4 | 附加字段参与 `JSON.stringify`（`[D]` §2.6 C 组）→ `tool/result.meta` 可能持久化 `status`/`retryAfter`；**当前无实证泄露**（`[E]` N-4），但建议 helper 只存规范化秒数、不存原始 header 值 | `[D]` §2.6 |
| 升级风险 | 补丁仍在 `node_modules` 内，npm 2.8.8 / 上游 PR #7 未合并 → **升级会覆盖**（`[C] 35-deep-dig-b.md` / `50:52`）。新增文件 `util/web-error.js` 必须纳入回滚链与 `PLUGIN_CHECKSUMS.txt`（`[C] 56 §7` 文档/回滚链待办） | `[C]` 既有裁决 |
| 基线兼容 | `.baseline-20261108-2205`（40 插件文件 checksum）：新增 1 文件 + 改 12 文件 → 需同步更新基线，单测须从 43/43 扩到 ≥50/50 | `[C] 56 §基线` |
| 服务状态 | 本审计**未重启**、未改运行时（PID 587384 保持），所有提案待 Lead 统一执行 | `[D] ps aux` |

---

## 7. 回归断言建议（新增测试文件草案 `tests/lead-20261108-error-contract.test.js`）

| # | 断言 | 对应缺陷 | 类型 |
| --- | --- | --- | --- |
| 1 | `webErrorFromResponse(new Response("x",{status:429,headers:{"retry-after":"7"}}), "x", "Tavily")` → `err instanceof WebError`、`err.code==="RATE_LIMIT"`、`err.status===429`、`err.retryAfter==="7"`、`err.rateLimited===true` | F-1 | 行为级 |
| 2 | 同上但无 `retry-after` → `retryAfterMsFrom(err)===60000`；有 `retry-after:"7"` → `===7000`；HTTP-date → ≈9000 | F-1 | 行为级（`[D]` §2.4 已验证数值） |
| 3 | `status:402` → `err.code==="QUOTA"` 且 `rateLimited(err)===true`（code 路径，不靠 message） | F-1/F-2 | 行为级 |
| 4 | 4 个误判负例：`HTTP 402: quota exceeded` 构造的**普通 Error**（无 code/status）、`HTTP 200: anonymous user`、`HTTP 503: anonymous gateway`、`Perplexity quota is 0E-16` → `rateLimited()===false` | F-2 | 行为级（当前实现 4 例全 `true`，`[D]` §4 F-2） |
| 5 | 保留 `tests/lead-20261108-quota.test.js:9-18` 全部 7 条断言**零回归**（若按 §5.2 去掉 `Anonymo`，需按 `[E]` 取舍先裁决） | 兼容性 | 回归 |
| 6 | 假 429 + JSON body `{"error":{"message":"slow down"}}` → `err.status===429` 且 `rateLimited(err)===true`（当前 `openai.js`/`anthropic-like.js` 为 false） | N-1 | 行为级 |
| 7 | `recordBackendOutcome` 分别接 `{status:"ok",count:3}` / `{status:"success",sources:3}` → 归一化日志 JSON 一致；`status:"error"` 走 `logger.warn` | N-3 | 行为级（mock ctx.logger） |
| 8 | 构造后附加字段与 `{cause: new Error("root")}` 共存：`err.cause.message==="root"` 且 `err.status===429`；`JSON.stringify(err)` 含 `status`/`retryAfter` 但**不含** `message`（Error.message 默认不序列化） | 裁决 3 / N-4 | 行为级（`[D]` §2.6 B/C） |
| 9 | 全量 `grep -rn "throw new WebError"` 仍为 53 处，但其中 11 处改为 `webErrorFromResponse`（源码级计数断言） | 改动面 | 源码级 |
| 10 | `node --test tests/*.test.js` 全绿（43/43 基线 + 新增 ≥7 条） | 全局 | 集成 |

---

## 8. 已确认无误（不重复证伪）

| 项 | 结论 | 证据 |
| --- | --- | --- |
| `egress-fetch.js` 的 Response 构造 | `status` + `headersFromRaw(res)` 齐全，`retry-after` **可达** —— Lead 预研「headers 拿不到」需修正为「抛错时未带走」 | `[A] egress-fetch.js:249-267`；`[D]` §2.4 |
| `instanceof WebError` 链 | helper 用原生 `new WebError`（非子类），6 处判断不受影响 | `[A]` §6 兼容性 2 |
| `WebError.cause` 链 | `super(message, options)` 只吃 cause，构造后赋值不冲突 | `[D]` §2.6 A/B |
| 3a 已落地、3b 未实现 | 不是「快速失败不可靠」而是「快速失败不存在」；fail-open 是有意设计（`breaker.js:8-9` 注释「a fully-cooled fan-out falls back」） | `[C] 50:16,32,52`；`[A] provider.js:290-304` |
| `provider.js:501` 的 `allKeyMissing` | 只判两个官方 code，改 429 的 code 不影响 | `[A] provider.js:496-505` |
| 30–35 已裁决结论（inject 最小集、RemoteResult、unified 单 provider、RFC1918、结果 URL 白名单） | 本审计不触碰、不重复证伪 | `[C] 99 / 24` |
| 53 处 throw / 14 文件计数 | 与 Lead 静态底稿逐文件吻合 | `[D] grep` vs `[C] 56 §底稿` |

---

## 9. 无法验证 / 待裁决（E 级）

1. `[E]` **§5.2 去掉 `Anonymo` 与 3a 既有测试的冲突**：`50-decisions-executed.md:32` + `tests/lead-20261108-quota.test.js:11` 依赖该词命中 Firecrawl keyless 真实串。两个解法（helper 结构化置位 / 保留 legacy 兜底）需 **Lead 裁决**，本报告不擅自定案。
2. `[E]` **`RATE_LIMIT` vs `QUOTA` 的边界**：402/403 归 `QUOTA` 是我的提议（依据 `QUOTA_EXCEEDED_CODE`），但 403 也可能是 WAF/权限而非配额；更精确的做法是只对 `status===429` 置 `RATE_LIMIT`、402 置 `QUOTA`、403 保持 `WEB_PROVIDER_ERROR`。需 Lead 定。
3. `[E]` **3b 快速失败的最终形态**：`allFailures.every(...)` 还是 `candidates.every(c => health.rateLimited)`、以及模型可见错误文本怎么改，属产品行为，**需用户批准**（`[C] 50:52`），本审计只给前置条件。
4. `[E]` **N-4 错误体是否真的含敏感回显**：9 处 `slice(0,300)` 直接拼上游 body，但本次未抓到含 token/query 的真实错误体，**无实证泄露**，只登记为隐私面。
5. `[E]` **附加字段是否真的进入 `tool/result.meta`**：`[D]` 只证明 `JSON.stringify(err)` 含这些字段，未端到端读 session log 验证持久化路径（GUI token 未使用）。
6. `[E]` **`mcp-client.js:121,133` 空 catch 是否吞过真实错误**：`[C] 56 §底稿` 已列为待核对，本审计不重复裁决，仅并入 N-5 建议。
7. `[E]` **改动后 43/43 单测是否全绿**：所有 diff 都**未 apply**（遵守「先提案后执行」），回归断言是设计稿，不是实测结果。
8. `[E]` **升级 2.8.8 / 上游 PR #7 合并后，本 helper 是否需要 rebase**：`[C] 35-deep-dig-b.md` 已登记「升级反覆盖」，本审计只把「新增文件纳入回滚链」列为风险。

---

## 10. 证据等级索引

| 等级 | 依据 | 出处 |
| --- | --- | --- |
| A | 官方错误契约 | `/usr/local/.../dsh-llm/lib/types/error.js:12-20,22,24-45`；`/usr/local/.../dsh-web/lib/index.js:19`；`lib/types/types.d.ts` |
| A | 我们的分类器 / 抛错点 / headers / 消费链 | `src-work/plugin/lib/util/failure-label.js:1-23`；`util/egress-fetch.js:249-267,344-348`；`util/mcp-client.js:64,70,121,133,135,196,222,229`；`util/log.js:55-61`；`breaker.js:27,43`；`provider.js:28,73,290-304,352,355,496-505`；`health.js:55-72`；`history.js:100-115`；**11 处非 2xx 抛错点见 §2.2 表**；13 backend 的 `recordOutcome` 见 §4 N-3 |
| B | 官方约定 | `/home/ova/dsh/AGENTS.md:134`；`HarnessError` JSDoc `:13` |
| C | 裁决/版本/基线 | `50-decisions-executed.md:16,32,52`；`56-full-audit-SKELETON.md:40-52,基线表`；`99-final-verdicts.md`；`35-deep-dig-b.md` |
| D | 本会话实测 | `grep -rn "throw new WebError"` → 53/14 文件；`grep -rn rateLimited` → 零读取消费者；`node` §2.6 四组（options 忽略额外字段 / 构造后赋值 / JSON 序列化 / code 可写）；`node` §2.4（60000 vs 7000 vs 8299）；`node` §4 F-2 8 例正则误判；`ps aux` PID 587384；`tests/lead-20261108-quota.test.js:9-43` 逐行读 |
| E | 待裁决/未验证 | §9 共 8 条 |

---

> 报告完。全程只读，唯一写操作是本文件自身；未改源码/配置/运行时/其它报告，未重启服务，未设 env，未跑 npm，未操作任务板，无 token/密钥值。所有改进均为「可 apply 的 diff 片段 + 回归断言建议」，由 Lead 统一裁决执行。
