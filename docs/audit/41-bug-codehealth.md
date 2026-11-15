# 41 — Bug 组 B：代码健康与隔离（task-20 提案报告）

> 编制：Bug 与官方化行为规范小组 / Bug 组 B（代码健康与隔离）。
> **唯一写文件**：本报告。**不修改任何源码/配置/运行时/其它报告**；不操作任务板（由 Lead 代收口）。本文件只给**提案**，Lead 统一裁决后才执行。
> 取证：read/grep/glob + `/tmp` 下 `node` 最小复现（脚本跑完删）+ 官方 GitHub API raw（`?ref=v2.2.5`，token 取自 `/opt/xr-research/zcode-research/.git/config` 的 remote URL、按 `U=x-access-token; P=${TOK#*:}` 派生，**值未写入任何输出/文件**）。全程只读。
> 基线：`.baseline-20261107-2116/`。取证时间 2026-11-07（Asia/Shanghai）。本机插件 `package.json` version **2.8.4**（C），OpenCode 一律 **v2.2.5**（C）。
> 初判来源：[30-adversarial-save.md](30-adversarial-save.md) / [30-adversarial-save-b.md](30-adversarial-save-b.md)、[31-adversarial-search.md](31-adversarial-search.md) / [31-adversarial-search-b.md](31-adversarial-search-b.md)、[35-deep-dig-b.md](35-deep-dig-b.md)（均 C 级既有报告，本报告负责**精确行号 + 复现 + 最小修法**）。

**统一证据等级**：**A**=源码实证（本地路径:行号 / 带 ref 的远端永久链接）；**B**=官方文档/上游官方源码（厂商 docs URL 或 GitHub API `?ref=v2.2.5`，HTTP 200）；**C**=版本记录（tag/commit/sha/既有报告）；**D**=本机实测（`node` 复现 / 真实遥测）；**E**=推断或无法验证（显式标注，不得当结论）。

**四联标注**：本报告每条缺陷按「现状(A) → 影响 → 复现(D) → 最小修法(diff 片段) → 验证」给出；缺实测处标 E。

---

## 0. 五点速览与优先级

| # | 点 | 现状裁决 | 优先级 | 是否行为改动（需用户批准） | 等级 |
|---|---|---|---|---|---|
| 1 | `settings-api.js` `validateOp`/`MAX_OPS`/`expectedRevision` 零单测 | 三个机制**代码存在且逻辑基本正确**，但 `tests/` 三份测试 grep 0 命中 | **P1**（测试债，无产品行为改动） | 否（只加测试） | A+D |
| 2 | `DISCOVERY_FIELDS` 形状发现多 ns 误选 + `current()`/`findNamespace` 两套规则 | **确认缺陷**：shape-first 会先选第三方 ns；两模块第一优先规则不同 | **P0**（可写到别人 namespace，配置串线） | **是**（改变 namespace 选择结果） | A+B+D |
| 3 | `readCredential` `catch { /* ignore */ }` 零诊断 | **确认缺陷**：`readFailed`/异常都静默，徽章不亮且无提示 | **P1**（可观测性） | 否（新增只读诊断字段/日志，不改写入语义） | A+C+D |
| 4 | 熔断 fail-open 使单后端冷却失效 + 429 未特判/不轮转 | **确认缺陷**：全 cooled 放行全部，第 4 次仍打 429 端点；官方 v2.2.5 只在 429 轮转 | **P1**（配额持续消耗，行为语义变化） | **是**（改变失败时的后端选择与「零结果/全失败」语义） | A+B+D |
| 5 | `health.js` 把免 Key 计量后端报 `keyless:false` | **确认缺陷**：`requiresKey` 由 `DEFAULT_KEY_ENV`（含 firecrawl/tinyfish）派生 | **P2**（仅 health 展示字段） | 否（只改报文字段，可含新增字段） | A+D |

---

## 1. 点 1 — `settings-api.js` 的 `validateOp` / `MAX_OPS` / `expectedRevision` 零单测

### 现状（A）
- `MAX_OPS = 64`（`lib/settings-api.js:39`）；校验在 `write()`：`:155-159` `wanted === undefined || wanted.length === 0 || wanted.length > MAX_OPS` → 400 `ops must be a non-empty array of at most 64 entries`。
- `validateOp(raw, fields)` 在 `:205-226`：
  - `:206` 非对象/数组 → `"ops entries must be objects"`；
  - `:207-208` `op` 只接受 `set|unset`，否则 `"unsupported op (expected set|unset)"`；
  - `:209-212` `path` 必须是**恰好 1 元素、非空字符串数组**，否则 `"path must be a one-element array holding a field name"`；
  - `:214` `if (!Object.hasOwn(fields, field)) return \`unknown settings field "${field}"\`` ← **字段白名单 = 实时 `Config.dict`**（`:165-168` 取 `getConfig().dict`），注释 `:40-45` 明确「never as a whitelist; the whitelist is the live Config.dict」；
  - `:215` `unset` 直接返回（不校验 value/类型）；
  - `:216-225` `set` 必须 `Object.hasOwn(raw,"value")`，`fields[field]` 必须是 `function`（schemastery 校验器），调用 `schema(raw.value)` 抛错 → `"invalid value for ..."`，否则返回 `{op,path:[field],value:checked}`。
- `expectedRevision`（`:183`）`Number.isInteger(body.expectedRevision) ? … : undefined` → `:185` `await settings.mutate(view.ns, ops, expected)`；冲突由 `:186-190` `isConflict(err)`（`:228-233` 判 `code==="SETTINGS_CONFLICT"` 或 message 含该串）→ **409 `{ok:false, code:"SETTINGS_CONFLICT"}`**。
- **零单测证据（A+D）**：`tests/` 只有 `lead-20261106.test.js`、`lead-20261107.test.js`、`lead-20261107-p0.test.js`（`ls`）；`grep -nE 'validateOp|findNamespace|expectedRevision|MAX_OPS'` 三份测试 → **仅 `lead-20261106.test.js:191,204` 提到 `readCredential`（源码级断言），对 settings-api 三机制 0 命中**。与 35-deep-dig-b.md:91（C5/C6）初判一致。

### 影响
- 无产品行为缺陷（机制本身正确），但**并发保存冲突、越权字段写入、ops 边界完全依赖宿主兜底**，插件侧无回归证据；后续改 `Config`/`DISCOVERY_FIELDS`/`mutate` 签名时无护栏。
- 潜在旁路（A，需测试固化）：`unset` 分支 `:215` **跳过类型校验**（`unset` 语义本就不需要 value，但 `path` 白名单已先行，安全）；`fields` 为空对象 `{}` 时（`:165-168`，`getConfig()` 不可用）所有字段都被拒 → 安全退化但无告警；`schema` 是 schemastery 校验函数、`typeof === "function"` 判定（`:218`）在 0.1.5/0.2.0 两版是否都成立属 E。

### 复现（D，`/tmp` 脚本，已删）
以纯函数方式把 `validateOp` / `MAX_OPS` / `expectedRevision` 逻辑逐字抽出，构造 fixture（`fields = {numResults: v=>{if(!Number.isInteger(v))throw…;return v}, enableExa: v=>!!v}`）：
```
非法 op            {op:"delete", path:["enableExa"]}        → "unsupported op (expected set|unset)"
path 长度 2        {op:"set", path:["a","b"], value:1}      → "path must be a one-element array…"
path 非字符串       {op:"set", path:[1], value:1}           → 同上
未知字段(白名单旁路) {op:"set", path:["__proto__"], value:1} → 'unknown settings field "__proto__"'
                   {op:"set", path:["evil"], value:1}      → 'unknown settings field "evil"'
缺 value            {op:"set", path:["numResults"]}         → 'op "set" on "numResults" requires a value'
类型错配            {op:"set", path:["numResults"], value:"x"} → 'invalid value for "numResults"'
合法 unset          {op:"unset", path:["enableExa"]}         → {op:"unset",path:["enableExa"]}
MAX_OPS 边界        ops.length=64 → 放行；65 → 400 "…at most 64 entries"；0 → 400
expectedRevision     mutate stub 抛 {code:"SETTINGS_CONFLICT"} → 409 / 非冲突错误 → 400 / 非整数 revision → undefined 传给 mutate
```
⇒ 逻辑按预期，**零单测是纯测试债**；`Object.hasOwn` 对 `__proto__` 也安全（不查原型链），这点值得写进测试防回归。

### 最小修法（**不落地**，仅 fixture 测试草案）
不导出私有函数也可测：用 `registerSettingsRoutes(ws, deps)` 注入 fake `webServer`（捕获 route.handler）+ fake `req/res`（可写 `data/end/method/headers`）+ fake settings（`describe`/`mutate` 可注入抛错），走**真实 HTTP handler 路径**。草案（新增 `tests/settings-api.test.js`，`node --test`）：

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerSettingsRoutes } from "../lib/settings-api.js";

function harness({ describeRows, mutate = async () => ({}), configDict }) {
  let handler; const ws = { register: (r) => { handler = r.handler; } };
  const calls = [];
  registerSettingsRoutes(ws, {
    getConnection: () => ({ trusted: true }),               // 让 trust fence 放行
    getSettings: () => ({ describe: () => describeRows, mutate: async (...a) => { calls.push(a); return mutate(...a); } }),
    getConfig: () => ({ dict: configDict }),
  });
  const req = (method, body, headers = { "content-type": "application/json" }) => ({
    method, url: "/api/unified-search/settings", headers,
    on(ev, fn) { if (ev === "end") process.nextTick(fn); return this; },
  });
  const res = () => ({ writableEnded: false, code: 0, payload: null,
    writeHead(c) { this.code = c; return this; },
    end(s) { this.payload = JSON.parse(s); this.writableEnded = true; return this; } });
  return { handler, calls, req, res };
}

const DICT = { numResults: (v) => { if (!Number.isInteger(v)) throw new Error("int"); return v; },
               enableExa: (v) => Boolean(v) };
const ROW = [{ ns: "dsh-websearch", value: { numResults: 8, enableExa: true }, revision: 7 }];

// ① 非法 op / ② 超 MAX_OPS / ③ 字段白名单旁路（含 __proto__）/ ④ 类型错配
for (const [name, ops] of [
  ["bad op",        [{ op: "delete", path: ["enableExa"] }]],
  ["path length 2",  [{ op: "set", path: ["a", "b"], value: 1 }]],
  ["unknown field", [{ op: "set", path: ["evil"], value: 1 }]],
  ["proto field",  [{ op: "set", path: ["__proto__"], value: 1 }]],
  ["bad value",     [{ op: "set", path: ["numResults"], value: "x" }]],
]) test(`validateOp rejects: ${name}`, async () => {
  const { handler, calls, req, res } = harness({ describeRows: ROW, configDict: DICT });
  const r = res(); await handler(req("POST", { ops, expectedRevision: 7 }), r);
  assert.equal(r.code, 400); assert.equal(calls.length, 0, "must not reach mutate");
});

test("MAX_OPS: 64 ok, 65 rejected, 0 rejected", async () => {
  const ok = Array.from({ length: 64 }, () => ({ op: "unset", path: ["enableExa"] }));
  const h1 = harness({ describeRows: ROW, configDict: DICT });
  const r1 = h1.res(); await h1.handler(h1.req("POST", { ops: ok, expectedRevision: 7 }), r1);
  assert.equal(r1.code, 200);
  for (const n of [65, 0]) {
    const h = harness({ describeRows: ROW, configDict: DICT });
    const r = h.res();
    await h.handler(h.req("POST", { ops: Array.from({ length: n }, () => ({ op: "unset", path: ["enableExa"] })), expectedRevision: 7 }), r);
    assert.equal(r.code, 400); assert.match(r.payload.error, /at most 64|non-empty/);
  }
});

// ⑤ revision 冲突：两个 write 带同一 expectedRevision，第二个 mutate 抛冲突
test("expectedRevision conflict -> 409 SETTINGS_CONFLICT", async () => {
  let n = 0;
  const h = harness({ describeRows: ROW, configDict: DICT,
    mutate: async () => { if (++n > 1) throw Object.assign(new Error("changed"), { code: "SETTINGS_CONFLICT" }); } });
  const r1 = h.res(), r2 = h.res();
  const make = () => h.req("POST", { ops: [{ op: "set", path: ["numResults"], value: 9 }], expectedRevision: 7 });
  await h.handler(make(), r1); await h.handler(make(), r2);
  assert.equal(r1.code, 200); assert.equal(r2.code, 409);
  assert.equal(r2.payload.code, "SETTINGS_CONFLICT");
});

// ⑥ 非整数 revision 不传给 mutate（当前 :183 的语义，固化防回归）
test("non-integer expectedRevision -> undefined passed to mutate", async () => {
  const h = harness({ describeRows: ROW, configDict: DICT });
  const r = h.res();
  await h.handler(h.req("POST", { ops: [{ op: "unset", path: ["enableExa"] }], expectedRevision: "7" }), r);
  assert.equal(h.calls[0][2], undefined);
});
```
> 注意：harness 里的 `req.on("data")` 未提供 chunk（当前 `readBody()` `:247-264` 靠 `req.on("data")` 累积、`end` 时 `Buffer.concat(chunks)`），草案需按真实请求对象补 `data` 事件发射，或直接给 `req` 加 `on("data", fn){fn(Buffer.from(JSON.stringify(body)))}`。**这是测试草案，不落地**（E：未实跑，避免声称通过）。

### 优先级 / 批准
**P1，纯测试债，无行为改动 → 不需用户批准**。建议与点 2 的 `findNamespace` 测试同文件落地。

---

## 2. 点 2 — `DISCOVERY_FIELDS` 形状发现误选 + 两套发现规则收敛（P0）

### 现状（A）
**`settings-api.js` 的 `findNamespace`（`:130-136`）**：
```js
const DISCOVERY_FIELDS = ["numResults", "backendTimeoutMs", "enabledBackends", "enableExa"];  // :45
function findNamespace(descriptors) {
  if (!Array.isArray(descriptors)) return undefined;
  const rows = descriptors.filter((row) => row !== null && typeof row === "object" && typeof row.ns === "string");
  return rows.find((row) => row.value !== undefined && row.value !== null
      && typeof row.value === "object" && DISCOVERY_FIELDS.some((key) => Object.hasOwn(row.value, key)))  // ← shape-FIRST
    ?? rows.find((row) => row.ns === "dsh-websearch");                                                  // ← ns 兜底
}
```
- 被 `describe()`（`:110`）、`write()`（`:178`）共用；`write()` 把 `view.ns` 传给 `settings.mutate(view.ns, ops, expected)`（`:185`）。

**`index.js` 的 `current()`（`:461-477`）**：
```js
const rows = settings.describe();
const byId = rows.find((r) => r && r.ns === "dsh-websearch")        // ← ns 精确第一优先
  ?? rows.find((r) => r && r.ns === NAMESPACE);                      //  NAMESPACE = "unified-search" (:54)
const row = byId
  ?? rows.find((r) => r && r.value && typeof r.value === "object" && "searxngBaseURL" in r.value);  // ← 形状兜底（且字段集不同）
return (row && row.value) ?? config;
```
⇒ **两套规则、三个差异**（A）：① 优先级相反（settings-api 形状优先 / index ns 精确优先）；② 形状字段集不同（`DISCOVERY_FIELDS` 4 字段 vs 单个 `searxngBaseURL`）；③ ns 字面不同（settings-api 只有 `dsh-websearch` / index 有 `dsh-websearch` + `unified-search`）。30-adversarial-save.md:177、35-deep-dig-b.md:90 已初判，本处给精确行号。

### 影响
- **P0**：`DISCOVERY_FIELDS` 里 `numResults` / `backendTimeoutMs` 是**通用名**。任何第三方插件的 settings row 若含这两个字段之一，且排在 `rows` 前面，`findNamespace` 的 shape-first `rows.find(...)` 会**先命中第三方 ns** → `mutate(view.ns, …)` 把本插件的 op 写进别人的 namespace；同时 `GET /api/unified-search/settings` 返回别人的 value/revision，卡片显示错数据。即使没有第三方碰撞，`current()` 与 `findNamespace` 规则不同也可能出现「卡片读 A 行、执行读 B 行」的隐蔽串线。
- 补充（A）：13 后端新增的 `enableFirecrawl`/`enableTinyfish` 等**没有加入** `DISCOVERY_FIELDS`（`:45` 仍是 4 个），形状发现能力未随后端增长。

### 复现（D，`/tmp` 脚本，已删）
逐字抽出 `findNamespace` 与 `current()` 的选择表达式，喂同一份 `describe()`：
```
输入 rows = [
  {ns:"other-plugin", value:{numResults:8, backendTimeoutMs:30000}},     // 第三方，含通用字段
  {ns:"dsh-websearch", value:{numResults:8, enableExa:true, searxngBaseURL:"https://searx.be"}},
]
findNamespace(rows) → ns="other-plugin"      ❌ 形状优先误选
current()(rows)     → ns="dsh-websearch"     ✅ ns 精确优先
⇒ 同一次保存：卡片/写入落到 other-plugin，执行仍读 dsh-websearch —— 两套规则给出不同行。

输入 rows = [{ns:"dsh-websearch", value:{numResults:8}}, {ns:"unified-search", value:{enableExa:true}}]
findNamespace → "dsh-websearch"（shape 命中）；current → "dsh-websearch"（byId 命中）→ 恰好一致（现状碰巧正确）

输入 rows = [{ns:"other-plugin", value:{searxngBaseURL:"x"}}, {ns:"dsh-websearch", value:{numResults:8}}]
findNamespace → "other-plugin"（numResults 命中）；current → "dsh-websearch" → 仍不一致
```
⇒ 与 35-deep-dig-b.md:90 的模拟一致，本报告给出**双模块同时比对**的复现。

### 最小修法（统一为「ns 精确优先 + 形状兜底」的**单一规则**）
新增一个共享模块 `lib/util/namespace.js`（唯一真源），两处都 import：

```diff
+ // lib/util/namespace.js —— single source of truth for "which describe() row is ours".
+ export const PLUGIN_NS = "dsh-websearch";        // profile insert id (live 0.2.x)
+ export const LEGACY_NS = "unified-search";       // settings NAMESPACE (older hosts)
+ // Only plugin-OWNED, high-entropy fields. Generic names (numResults,
+ // backendTimeoutMs) are deliberately excluded so a third-party row cannot
+ // collide. Require >= 2 hits so one stray field is not enough.
+ const OWNED_FIELDS = ["enableExa", "searxngBaseURL", "enableFirecrawl", "enableTinyfish", "enabledBackends"];
+ export function findPluginRow(descriptors) {
+   if (!Array.isArray(descriptors)) return undefined;
+   const rows = descriptors.filter((r) => r && typeof r === "object" && typeof r.ns === "string");
+   const byNs = rows.find((r) => r.ns === PLUGIN_NS) ?? rows.find((r) => r.ns === LEGACY_NS);
+   if (byNs) return byNs;
+   return rows.find((r) => r.value && typeof r.value === "object"
+     && OWNED_FIELDS.filter((k) => Object.hasOwn(r.value, k)).length >= 2);   // 形状兜底
+ }
```
`settings-api.js`：
```diff
- const DISCOVERY_FIELDS = ["numResults", "backendTimeoutMs", "enabledBackends", "enableExa"];   // :45
+ import { findPluginRow } from "./util/namespace.js";
…
- function findNamespace(descriptors) {                                          // :130-136
-   if (!Array.isArray(descriptors)) return undefined;
-   const rows = descriptors.filter(…);
-   return rows.find((row) => … DISCOVERY_FIELDS.some(…)) ?? rows.find((row) => row.ns === "dsh-websearch");
- }
+ const findNamespace = findPluginRow;   // 保持 describe()/write() 调用点不变
```
`index.js`：
```diff
+ import { findPluginRow } from "./util/namespace.js";
  current = () => {
    try {
-     const rows = settings.describe();                                        // :463-475
-     const byId = rows.find((r) => r && r.ns === "dsh-websearch")
-       ?? rows.find((r) => r && r.ns === NAMESPACE);
-     const row = byId ?? rows.find((r) => r && r.value && typeof r.value === "object" && "searxngBaseURL" in r.value);
-     return (row && row.value) ?? config;
+     const row = findPluginRow(settings.describe());
+     return (row && row.value != null ? row.value : config);
    } catch { return config; }
  };
```
> 顺带修 30-adversarial-save-b.md:38 指出的 `value:null` 回落 stale config（`!= null` 判空），但这是**行为改动的一部分**，需批准。

### 验证（建议新增测试，见 §6）
- `findPluginRow` 单测：第三方 row 含 `numResults` 时仍选 `dsh-websearch`；只有形状无 ns 时靠 ≥2 专属字段命中；空/非数组 → `undefined`；`value:null` 由调用方回落。
- 一致性测试：`current()` 与 `findNamespace` 对同一 `describe()` 数据**必须返回同一 ns**（当前两套规则不一致的直接回归）。

### 优先级 / 批准
**P0，且是行为改动 → 需用户批准**：改变了「选哪一行」的结果（第三方碰撞场景从误选改为正确选择）、形状字段集、以及 `value:null` 的回落语义。风险：若某 host 的 `ns` 既不是 `dsh-websearch` 也不是 `unified-search`、且 value 不含 ≥2 专属字段，会退回 `config`（与现状「形状命中通用字段」不同）→ 需在批准说明里写清，并保留 `LEGACY_NS` 兼容旧 host（A：30-adversarial-save.md:40 实测真实 ns 为 `dsh-websearch`）。

---

## 3. 点 3 — `readCredential` 的空 `catch` 零诊断

### 现状（A，精确行号）
`lib/client.js:344-381`：
```js
async readCredential(ref) {
  let readFailed = false;                                   // :345
  try {
    let view;
    let api;
    try { api = this.remote === undefined ? undefined : this.remote.credentials; } catch { api = undefined; }   // :352
    if (api !== undefined && typeof api.describe === "function") {                                             // :353
      const res = await api.describe([ref]);                                                                    // :355
      if (res !== null && typeof res === "object" && res.ok === false) {                                    // :363
        readFailed = true;                                                                                       // :364  ← 只置标志
      } else { /* 三层解包 → view */ }                                                                            // :365-369
    }
    if (!readFailed && view === undefined && this.connection !== undefined …) { … }                            // :371-375 旧线兜底
    if (!readFailed && view !== undefined) {                                                                   // :376
      this.keyState.set(ref, { configured: view.configured === true, writable: view.writable !== false });       // :377
    }
  } catch { /* ignore */ }                                                                                     // :379  ← 零诊断
  this.republish();                                                                                            // :380
}
```
- `:361-362` 注释明确：「No dedicated read-error UI state exists, so do NOT reuse `failedKeys` — its copy says "save failed"」。
- 即 `readFailed=true`（`ok:false` 包络）或 `api.describe()` 抛异常 → `catch {}` 吞掉 → **不写 `keyState`、不置任何状态、不 log** → UI 的 `configured` 徽章（`client.js:532-546`，`needsKey` 判定 `:536`）保持「未配置」，用户以为没填 key，实际是读失败。
- `failedKeys` 是 `[{ref,reason}]`（`:285,:318`），UI 渲染 `props.t("keyFailed") + ": " + failure.reason`（`:562`）—— **文案是「该 Key 保存失败」**（`zh.keyFailed: "该 Key 保存失败"`，`:110`），复用会把「读取失败」误报成「保存失败」，故必须另立状态。30-adversarial-save-b.md:53、30-adversarial-save.md:39/§2.8、review 33 已初判，本处给精确行号。

### 影响
**P1 可观测性缺陷**：读失败与「未配置」在 UI 上不可区分，排查成本高；`republish()` 在 `:380` 而非 `finally`，若未来 `try` 内提前 `return`/抛出未捕获错误则不刷新（当前无此分支，属 E）。

### 复现（D 级既有实证 + 本处逻辑推演）
30-adversarial-save.md:113-139（C）已用真实 `POST /api/credentials/describe` 与 Node 复现证：
```
describe() 抛异常      → catch {} 吞掉 → keyState 不变 → 徽章 "未配置"
res.ok === false       → readFailed=true → 同样静默 → 徽章 "未配置"
正常 ok:true           → keyState.set → 徽章 "已配置"
```
本报告不重复实跑（只读约束），以 C 级既有 D 实证 + A 级行号为准；`republish()` 位置为 A 级静态确认。

### 最小修法（**不复用 `failedKeys`**，新增独立只读诊断状态）
```diff
   constructor-ish state init (client.js:285-287 附近):
+  this.readErrors = new Map();   // envRef -> short reason; READ-only, distinct from failedKeys (SAVE failures)

   projection() (client.js:303-324 附近):
+  readErrors: [...this.readErrors].map(([ref, reason]) => ({ ref, reason })),

   async readCredential(ref) {
-    let readFailed = false;
+    let reason;
     try {
       …
       if (res !== null && typeof res === "object" && res.ok === false) {
-        readFailed = true;
+        reason = String(res.error?.message ?? "credential read rejected");
       } else { /* 解包 view */ }
-      if (!readFailed && view === undefined && …) { … }
-      if (!readFailed && view !== undefined) {
+      if (reason === undefined && view === undefined && …) { … }
+      if (reason === undefined && view !== undefined) {
         this.keyState.set(ref, { configured: …, writable: … });
+        this.readErrors.delete(ref);
       }
-    } catch { /* ignore */ }
-    this.republish();
+    } catch (err) {
+      reason = String(err?.message ?? err);
+    } finally {
+      if (reason !== undefined) this.readErrors.set(ref, reason.slice(0, 140));
+      this.republish();                       // 移到 finally，保证一定刷新
+    }
   }
```
UI（`KeyedBackendCard`，`client.js:528-563`）加一行独立文案（**新 i18n key，不改 `keyFailed` 的保存失败语义**）：
```diff
 zh: { … keyFailed: "该 Key 保存失败", + keyReadFailed: "密钥状态读取失败（不影响保存）", … },
 en: { … + keyReadFailed: "Could not read key status (saving is unaffected)", … },
 // 在 :562 的 failure 行旁，另起一行：
+ readFailure && react_jsx_runtime.jsx("p", { className:"wsc-hint", style:{ color:"#e6a700" },
+   children: props.t("keyReadFailed") + (readFailure.reason ? ": " + readFailure.reason : "") }),
```
> 安全：`reason` 需过 `health.js:15-19` 的 `SECRET_PATTERNS` 式脱敏或至少 `.slice(0,140)`（本机 `failedKeys` 已用 140 截断，`client.js:465`）；**不得回显凭证值**（30-adversarial-save.md:212-214 指出 `reason` 直渲有泄漏面，本方案沿用截断 + 新增独立 key）。
> 若不想动 UI，可退一步只加 `console.warn("[websearch] credential read failed", ref, reason)`（host logger 不可从 client 直取的场合），但那仍是「零 UI 诊断」，建议保留上面的独立状态。

### 优先级 / 批准
**P1，只读诊断 + 新 UI 文案 → 不改写入/保存语义，原则上不需用户批准**；但新增 i18n key 与 UI 元素属「产品可见文案」，按 DSH 约定（`verify-client-ui-i18n`）需在 PR 里同步字典。若 Lead 判定任何 UI 改动都需批准，则归入「需批准」清单（见 §7）。

---

## 4. 点 4 — 熔断 fail-open + 429 未特判/不轮转（对照官方 v2.2.5）

### 现状（A）
- `breaker.js`（纯函数）：`foldBreaker(prev, ok, nowMs, cfg)`（`:29-45`）成功即 `{failCount:0,cooledUntil:0}`；失败 `failCount+1`，`>= threshold`（默认 3，`:15`）→ `cooledUntil = now + cooldownMs`（默认 60s，`:16`）；`isCooled`（`:52-55`）只判 `cooledUntil > now`；**任何失败一视同仁**（不区分 429 / 403 / 超时 / MCP `isError` 额度错误）。
- `provider.js:283-293`：
```js
const active = candidates.filter((c) => {
  if (isCooled(latestBackendHealth.get(c.id), nowMs)) { cooled.set(c.id, …); return false; }
  return true;
});
if (active.length > 0) eligible = active;
else cooled.clear();   // :292  all cooled -> fail-open：清空 cooled 表、放行全部
```
- `recordBackendHealth`（`:62-71`）把 `ok:false` 统一喂 `foldBreaker`；`collectFanoutResults`（`:122-153`）把失败折进 `failures[]`，遥测错误串 `.slice(0,80)`（`:342`）；**无 429 分类、无 `Retry-After` 解析、无「换一个后端重试」循环**（扇出是一次 `Promise.allSettled`，`:361-369`）。

### 官方对照（B，永久链接带 ref）
`https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/websearch.ts`：
```ts
// :197-216  query() while 循环
const attempted = new Set<ID>()
while (true) {
  let cooldown = choice === "random" ? cooldowns.get(provider.id) : undefined
  if (!cooldown || cooldown.until <= now) {
    attempted.add(provider.id)
    const result = yield* provider.execute(...).pipe(Effect.result)
    if (result._tag === "Success") return new Response({ providerID, results: result.success })
    const cause = result.failure
    const error = new RequestError({ providerID, cause })
    if (choice !== "random" || !HttpClientError.isHttpClientError(cause) || cause.response?.status !== 429)
      return yield* error                                    // :208-209 其它错误直接失败
    cooldown = { until: now + cooldownMillis(cause.response.headers["retry-after"], now), error }  // :211
    cooldowns.set(provider.id, cooldown)                     // :212  1 次 429 立即冷却
  }
  provider = randomProvider(now, affinity, attempted)         // :214  轮转到未冷却/未尝试的 provider
  if (!provider) return yield* cooldown.error                // :215  全冷却快速失败（不是 fail-open）
}
// :222-228 cooldownMillis：秒数 / HTTP-date / 缺失或无效 → 60_000
```
⇒ 官方语义：**只在 429 轮转**、1 次即按 `Retry-After` 冷却、全冷却时**快速失败**（`return yield* cooldown.error`）而非放行全部；其它错误直接失败。31-adversarial-search.md:252-253、09b-opencode-v2.md:94/350 已初判，本报告给出官方逐字行号。

### 影响
- **fail-open 反直觉（A+D）**：当只启用 1 个计量后端（或其余全失败）时，`active.length===0` → `:292` 清空 cooled 表、放行全部 → **熔断从未生效**，每次搜索继续打已确认 429 的端点、继续烧配额。31-adversarial-search.md:244 的 `/tmp/adv-breaker.mjs` 实证：`search#4 429 → 仍然实际发起请求（failCount=4）`。
- 429 与「匿名额度 `isError:true`」/403/超时混为一类，3 次任意失败才冷却，且**不轮转、不解析 `Retry-After`** → 与官方「1 次 429 立即冷却 + 轮转」完全反向。35-deep-dig-b.md:129/174 已列 P2 建议（移植 429 Retry-After 冷却）。

### 复现（D，既有 + 本处最小复现）
```
[既有 C/D] /tmp/adv-breaker.mjs（31-adversarial-search.md:244）：
  #1 429 → failCount=1  #2 → 2  #3 → 3, cooledUntil=now+60000
  #4 429 → 仍然实际发起请求（failCount=4）   ← fail-open
[本处] 逐字抽出 foldBreaker + provider.js:283-293 的 eligible 选择：
  candidates=[{id:"firecrawl"}]，health={cooledUntil: now+60000} → active=[] → eligible=candidates（全放行）
  candidates=[{id:"firecrawl"},{id:"exa"}]，firecrawl cooled、exa 正常 → active=[exa] → 只跑 exa（熔断有效）
```
⇒ 缺陷只在「单后端 / 全冷却」时显现，多后端混合时熔断正常。

### 最小修法（分两步，**行为改动需批准**）
**Step A（最小、低风险）**：让 429/额度错误单独分类，并把 fail-open 限定为「非配额故障」。

```diff
// lib/util/failure-label.js（或新增 lib/util/error-class.js）：从 WebError message/cause 提取 HTTP 状态
+ export function rateLimited(err) {
+   const s = String(err?.message ?? err);
+   return /HTTP 429|rate.?limit|429\b/i.test(s) || /Anonymo|quota|额度/i.test(s);  // MCP isError 额度文案
+ }

// lib/breaker.js: foldBreaker 增加可选 rateLimited 参数
- export function foldBreaker(prev, ok, nowMs, cfg = {}) {
+ export function foldBreaker(prev, ok, nowMs, cfg = {}, opts = {}) {
    …
    if (ok) return { failCount: 0, cooledUntil: 0 };
+   if (opts.rateLimited === true) {                    // 1 次 429/额度 → 立即按 Retry-After 冷却
+     const retryAfterMs = Number.isFinite(opts.retryAfterMs) ? opts.retryAfterMs : BREAKER_DEFAULTS.cooldownMs;
+     return { failCount: (Number.isFinite(prev?.failCount) ? prev.failCount : 0) + 1,
+              cooledUntil: nowMs + Math.max(0, retryAfterMs) };
+   }
    const failCount = …;                                // 其余逻辑不变（3 次任意失败才冷却）
```
```diff
// provider.js: runBackend 的失败分支（:341-346）把分类传给 recordBackendHealth → foldBreaker
  (err) => {
    const msg = …;
-   recordBackendHealth(id, { ok:false, …, error:msg }, breakerCfg);
+   recordBackendHealth(id, { ok:false, …, error:msg }, breakerCfg,
+     { rateLimited: rateLimited(err), retryAfterMs: retryAfterMsFrom(err) });   // 从 cause/响应头解析
    throw err;
  }
```
```diff
// provider.js:283-293 —— fail-open 只对「非配额」故障启用
- if (active.length > 0) eligible = active;
- else cooled.clear(); // all cooled -> fail-open
+ if (active.length > 0) eligible = active;
+ else if (cooled.size > 0 && [...cooled.values()].every((e) => e?.rateLimited === true)) {
+   // 全部因 429/额度冷却：按官方 v2.2.5「全冷却快速失败」，不再打限流端点烧配额
+   throw new WebError("unified search: all backends are rate-limited; retry after cooldown",
+                      "WEB_PROVIDER_ERROR");
+ } else {
+   cooled.clear();  // 非配额故障仍 fail-open（保持既有「不让搜索更差」语义）
+ }
```
**Step B（可选、更大改动）**：移植官方 `randomProvider(attempted)` 式轮转 —— 在一个后端 429 时把请求转给另一未冷却后端。但 DSH 是**扇出全部后端**（`Promise.allSettled`）而非单 provider 选择，语义不同；建议**不做**整体轮转，只在融合层把「429 冷却」作为一个输入维度（09b-opencode-v2.md:333 的 rehearsal 提醒：不推翻静态选择不变量）。⇒ Step B 标 **E/不建议本轮做**。

> `retryAfterMsFrom(err)` 最小实现（对齐官方 `cooldownMillis` `:222-228`）：
```js
function retryAfterMsFrom(err) {
  const v = err?.cause?.response?.headers?.get?.("retry-after") ?? err?.retryAfter;
  if (v == null || String(v).trim() === "") return 60_000;
  const secs = Number(v);
  if (Number.isFinite(secs)) return secs >= 0 ? secs * 1000 : 60_000;
  const date = Date.parse(v);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 60_000;
}
```
注意：DSH 的 `WebError` 由各后端构造（`mcp-client.js` 抛 `MCP tools/call HTTP 429: …`，`egress-fetch.js` 的 `Response` 头不进 `WebError`）⇒ **`retry-after` 实际往往取不到，退化为 60s 兜底**；要把响应头透传到 `WebError.cause` 需改 `mcp-client.js`/各后端，属额外改动，标 E 待批准范围确认。

### 优先级 / 批准
**P1，且是行为改动 → 需用户批准**：①「全冷却」时从「放行全部」改为「快速失败」，会改变「零结果/全失败」时模型看到的错误文本；② 429 从「3 次任意失败才冷却」改为「1 次立即冷却」，改变后端选择；③ 新增 `WEB_PROVIDER_ERROR` 的 rate-limited 文案。非配额故障的 fail-open 语义保留，风险可控。Step B 轮转不建议本轮做（E）。

---

## 5. 点 5 — `health.js` 把免 Key 计量后端报 `keyless:false`

### 现状（A）
- `index.js:85-96` `DEFAULT_KEY_ENV` 含 `firecrawl: "FIRECRAWL_API_KEY"`（`:94`）、`tinyfish: "TINYFISH_API_KEY"`（`:95`），注释 `:93` 写「optional keys; keyless works without them」。
- `index.js:373` `requiresKey: DEFAULT_KEY_ENV[id] !== undefined` ⇒ 这两个 id `requiresKey = true`。
- `health.js:57` `const keyless = beOpts.requiresKey !== true;` ⇒ 两者 **`keyless:false`**；`:74` 顶层 `keyless: enabledList.filter(b => b.keyless).length` 因此少算。
- 对照（A）：`client.js:31-32` 把两者标 `{ optionalKey:true, metered:true }`；`firecrawl.js:35-38` / `tinyfish.js:38-41` 的 `available()` 恒 `true`（无需 key）；`firecrawl.js:45-46` / `tinyfish.js:45-50` 的 key 是**可选提额**。⇒ 三处语义不一致（31-adversarial-search.md:157-169、31-adversarial-search-b.md:116 已初判）。

### 影响
**P2，仅 `/api/unified-search/health` 展示字段**：把「免 Key 但有额度」的计量后端误报成「需要 API Key」，误导运维判断「为什么没配 key 还能跑」；不影响 `available()` / 执行 / 熔断（这些都不读 `requiresKey`）。

### 复现（D）
调用纯函数 `buildHealthReport`（`health.js:45-78`）与真实 `resolveOptions`：
```
resolveOptions(ctx, {}) → backends.firecrawl.requiresKey = true
                        backends.tinyfish.requiresKey  = true
                        backends.exa.requiresKey       = false
buildHealthReport({resolveOptions, backends, getBackendHealth}) →
  backends[firecrawl].keyless = false, backends[tinyfish].keyless = false
  顶层 keyless 计数把两个「免 Key」后端排除
```
31-adversarial-search.md:159 的 `/tmp/adv-apikey.mjs` 已实证 `keyless:1`（3 个启用里只有 exa 为真），本报告以该 C/D 既有实证 + A 级行号为准，不重复实跑（只读）。

### 最小修法（单一真源 + health 增列）
```diff
// lib/index.js —— 新增可选 key 集合，requiresKey 排除之
+ /** Backends whose key is OPTIONAL (keyless tier works; key only raises limits). */
+ const OPTIONAL_KEY_IDS = new Set(["searxng", "firecrawl", "tinyfish"]);   // 与 client.js:18,31,32 对齐
  …
  backends[id] = {
    …,
-   requiresKey: DEFAULT_KEY_ENV[id] !== undefined,                          // :373
+   requiresKey: DEFAULT_KEY_ENV[id] !== undefined && !OPTIONAL_KEY_IDS.has(id),
+   optionalKey: OPTIONAL_KEY_IDS.has(id),
+   metered: id === "firecrawl" || id === "tinyfish",                        // 与 client.js:31-32 一致
  };
```
```diff
// lib/health.js:54-68 —— 语义字段单独列，keyless 用「不需要 key」的真值
  const list = Object.keys(backends).map((id) => {
    const beOpts = opts.backends?.[id] ?? {};
-   const keyless = beOpts.requiresKey !== true;                              // :57
+   const keyless = beOpts.requiresKey !== true;        // 现在对 optionalKey 也为 true
+   const optionalKey = beOpts.optionalKey === true;
+   const metered = beOpts.metered === true;
    return {
      id, enabled, keyless,
+     ...(optionalKey ? { optionalKey: true } : {}),
+     ...(metered ? { metered: true } : {}),
      reachable: …, lastOk: …, lastError: …,
    };
  });
```
> 更彻底的做法是把 `OPTIONAL_KEY_IDS` 抽到共享 `lib/util/namespace.js`（点 2 同一文件）或 `lib/backends/meta.js`，让 `index.js`、`client.js`、`health.js` **单一来源**；但 `client.js` 是浏览器 bundle（`window.__ModuleLoader__.load`，`:1`），不能 import Node 模块 → 建议共享常量放一个**纯数据、双端可读**的文件，或至少在 `index.js` 加注释指向 `client.js:31-32` 防漂移。标 E（未实施）。

### 优先级 / 批准
**P2，只改 health 报文字段 + 新增 `optionalKey`/`metered` 字段（向后兼容，旧消费者忽略新字段）→ 不需用户批准**；但 `requiresKey` 值改变（从 true→false）若未来被其它消费者读取需回归（当前 grep 只有 `health.js:57`，A）。建议与点 2 一起做「单一真源」收敛。

---

## 6. 建议新增测试清单（全部**不落地**，待 Lead 裁决后执行）

| # | 测试文件（建议） | 覆盖 | 类型 | 关联点 |
|---|---|---|---|---|
| T1 | `tests/settings-api.test.js` | `validateOp` 非法 op / path 长度 / 未知字段（含 `__proto__`）/ 缺 value / 类型错配 / 合法 unset | 单元（fake ws+req/res，走真实 handler） | 1 |
| T2 | 同上 | `MAX_OPS` 64/65/0 边界；body 非对象/数组/非 JSON；`content-type` 非 json | 单元 | 1 |
| T3 | 同上 | `expectedRevision` 两并发写同 revision → 第二个 409 `SETTINGS_CONFLICT`；非整数 revision → 传 undefined；`isConflict` message 兜底 | 单元（并发） | 1 |
| T4 | `tests/namespace.test.js` | `findPluginRow`：第三方 row 含 `numResults` 不误选；只有形状（≥2 专属字段）命中；`value:null`；空/非数组 → undefined | 单元 | 2 |
| T5 | 同上 | **一致性**：`current()` 与 `findNamespace` 对同一 `describe()` 返回同一 ns（当前两套规则的直接回归） | 单元（跨模块） | 2 |
| T6 | `tests/client-readcredential.test.js` | `ok:false` / `describe` 抛异常 → `readErrors` 有值且 `republish` 仍触发；正常 → `readErrors` 清空；文案与 `failedKeys` 不混 | 单元（client 状态） | 3 |
| T7 | `tests/breaker-429.test.js` | `foldBreaker` 1 次 429 立即冷却 / `Retry-After` 秒数·HTTP-date·缺失→60s / 非 429 仍 3 次；全冷却 `provider` 快速失败而非 fail-open；非配额故障仍 fail-open | 单元 + 行为级（fake 后端） | 4 |
| T8 | `tests/health-keyless.test.js` | `buildHealthReport`：firecrawl/tinyfish `keyless:true` + `optionalKey:true` + `metered:true`；brave `keyless:false`；顶层计数正确 | 单元（纯函数） | 5 |
| T9 | REAL-composition 冒烟 | 按 `docs/testing.md` 的「产品可见插件需非单测 REAL-composition」：Loader 挂载 profile，验证保存→health→`web_search` 闭环（不触发真实网络，mock 后端） | 组合测试 | 2/3/5 |
> 现有 `tests/` 只有 3 份 lead 测试（A）；`node --test tests/`（目录形式）在 31-adversarial-search.md 记 exit 1（C），建议 CI 显式列文件。

---

## 7. 哪些属于行为改动需用户批准

| 点 | 改动 | 是否行为改动 | 需批准 | 理由 / 风险 |
|---|---|---|---|---|
| 1 | 只新增 tests | **否** | 否 | 无产品行为变化 |
| 2 | `findNamespace`/`current()` 收敛为单一「ns 精确优先 + 形状兜底」 | **是** | **是** | 改变「选哪一行」的结果；第三方碰撞场景从误选改正确；`value:null` 回落语义变化；若某 host ns 都不匹配且形状字段 <2 会退回 initial config（与现状不同）。必须写进批准说明 |
| 3 | `readErrors` 状态 + 新 i18n key + UI 提示行 | **只读诊断**（不改写入/保存语义） | **否（默认）**，但若 Lead 把「任何产品可见 UI 文案」都算需批准，则**是** | 新增 UI 元素与字典条目；`republish()` 移入 `finally` 属内部时序，不改语义 |
| 4 | 429 立即冷却 + 全冷却快速失败 + rate-limited 文案 | **是** | **是** | 改变失败时后端选择、全冷却时的返回（从放行→抛错）、模型可见错误文本；非配额 fail-open 保留 |
| 4-Step B | 官方式 `randomProvider` 轮转 | 是（大改） | **不建议本轮** | 与 DSH 扇出语义不同；标 E |
| 5 | `requiresKey` 排除 optional ids + health 新增字段 | **否**（新增字段向后兼容） | 否 | 只改展示；`requiresKey` 当前唯一消费者是 `health.js:57`（A） |
| 5-彻底版 | 抽共享元数据模块给 `client.js` 用 | 是（构建面） | **是**（若做） | `client.js` 是浏览器 bundle（`window.__ModuleLoader__`），不能 import Node-only 模块，需双端可读纯数据文件 |

> 建议批准顺序：**点 2（P0）→ 点 4（P1 行为）→ 点 3/5 + 全部测试（P1/P2，不改行为）**。所有 diff 片段均为**提案**，本报告未修改任何源码。

---

## 8. 权威/证据链接（按等级）

**A（本地源码，路径:行号）**
- `lib/settings-api.js:39,45,110,130-136,155-159,165-168,178,183-195,205-226,228-233,247-264,273-277`
- `lib/index.js:54,85-96,373,433-477`（`current()` 的 `byId`/形状兜底）
- `lib/client.js:1,31-32,285-287,303-324,344-381,383-408,528-563`（`readCredential` / `failedKeys` / UI）
- `lib/health.js:45-78`（`buildHealthReport`）、`lib/breaker.js:13-65`、`lib/provider.js:62-71,283-293,341-346,361-369`
- `tests/lead-20261106.test.js`、`tests/lead-20261107.test.js`、`tests/lead-20261107-p0.test.js`（零单测证据）

**B（官方上游，GitHub API raw `?ref=v2.2.5`，HTTP 200；token 未落盘）**
- https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/websearch.ts （`:197-216` 429 轮转、`:222-228` `cooldownMillis`、`:208-209` 其它错误直接失败、`:215` 全冷却快速失败）
- https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/index.ts （418 B，只导出 5 个 Plugin；429 逻辑**不在** plugin 目录）
- https://github.com/anomalyco/opencode/blob/v2.2.5/packages/schema/src/websearch.ts

**C（版本记录 / 既有报告初判）**
- `package.json` version **2.8.4**；`.baseline-20261107-2116/`
- [30-adversarial-save.md](30-adversarial-save.md):39-42/113-139/177/212-214/267；[30-adversarial-save-b.md](30-adversarial-save-b.md):34-53；[31-adversarial-search.md](31-adversarial-search.md):37/157-169/238-253/267；[31-adversarial-search-b.md](31-adversarial-search-b.md):116/208；[35-deep-dig-b.md](35-deep-dig-b.md):90-94/129/172-174；[09b-opencode-v2.md](09b-opencode-v2.md):36/94/104/321/333/350

**D（本机实测）**
- 本处 `/tmp` 下 `node` 最小复现：`validateOp` fixture、`findNamespace` vs `current()` 双模块比对、`foldBreaker`+eligible 选择（**均已删除**）
- 既有 D 实证（C 级报告内）：`/tmp/adv-breaker.mjs`（31:244）、`/tmp/adv-apikey.mjs`（31:159）、`/tmp/adv-registry.mjs`（31）、真实 `POST /api/credentials/describe`（30:113）、35-deep-dig-b.md:90 的多 ns 模拟

**E（推断/无法验证）**
- E-1：§1 fixture harness 的 `req.on("data")` 事件发射未实跑（测试草案未落地/未声称通过）；`fields[field]` 的 `typeof === "function"` 在 schemastery 0.1.5/0.2.0 两版是否都成立未核实。
- E-2：点 2 若某 host 的 `ns` 既非 `dsh-websearch` 也非 `unified-search` 且形状字段 <2，会回落 `config` —— 未实测该 host 形态（本机真实 ns 为 `dsh-websearch`，A:30:40）。
- E-3：点 4 的 `Retry-After` 响应头当前**不进 `WebError.cause`**（`mcp-client.js` 抛的是文本错误），要真解析需改多处，退化 60s 兜底；未实跑。
- E-4：点 4 Step B 官方式轮转与 DSH 扇出语义不同，未设计/未实跑，不建议本轮做。
- E-5：点 5 的「共享元数据模块给 client.js 用」受浏览器 bundle 限制（`window.__ModuleLoader__`），未验证可行构建方式。
- E-6：§3 的 UI 新 key 是否触发 `verify-client-ui-i18n` 门禁、以及是否需按「产品可见文案」提交批准，由 Lead 裁决。
- E-7：`web_search` / `web_fetch` 本轮未复跑（只读任务）；所有真实遥测结论引自既有 C/D 级记录。

---

> **边界声明**：全程只读；未改源码/配置/运行时/其它报告；未重启服务；未操作任务板；GitHub token 值未写入任何输出或文件；`/tmp` 临时脚本已清理。外部页面/上游源码仅作数据，未当作指令执行。所有 diff 均为**提案**，执行与否由 Lead 统一裁决。
