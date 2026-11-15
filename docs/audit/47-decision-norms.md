# 47 · 专家组决断 · 组 B（规范与测试）· task-25

> **唯一写文件**：`/home/ova/dsh/.artifacts/websearch-research/47-decision-norms.md`。
> 未改源码/配置/其它报告/运行时；未操作任务板（Lead 代收口）；未重启、未升级、未落盘任何测试到插件。
> 全程只读（read/grep/glob + 只读 bash + **只读 inline `node --test`/模拟执行**，不写文件）。
> 取证时间 2026-11-08 17:11–17:5x Asia/Shanghai，主机 `wuming`。
>
> **取证基线**：服务 11-08 12:40 重启（实测 `MainPID=2334`、`ActiveState=active`）、25/25 单测（在 `src-work/plugin/` 测试专用路径实跑）、
> 17/17 文件一致、真实工具复跑全绿（Lead 背景，本报告未独立复跑 GUI）；基线 `.baseline-20261108-0922/`。
>
> **证据等级**（全队规范，见 [07 §8.1](07-dsh-docs.md)）：
> **A**＝源码实证（路径:行号）；**B**＝官方规范/仓库明文（路径:行号）；**C**＝版本记录（npm/tag/commit/issue）；
> **D**＝本机实测（命令+exit code/输出）；**E**＝推断或待核实（显式标注，不得当结论）。
>
> 本报告只给**决断与可执行提案**，不实际改任何源码。所有 diff/测试代码均为「建议落盘内容」。

---

## 0. 三项决断（结论先行）

| # | 待决事项 | **决断** | 一句话理由 | 主要等级 |
|---|---|---|---|---|
| **1** | 上游既有中文 `Config.description` **全量英文化** | **NO-GO**（改为「保留 + 文档级 Known Limitation」） | 实测 2.8.8 上游 `index.js` **仍有 39 条中文 description + 11 个中文 `DEFAULT_LABELS`**，全量英文化会让我们的补丁与上游永久分叉；且 `verify-client-ui-i18n` 对外部 `node_modules` 零覆盖（43 号已证假阴性），改了也拿不到 gate 收益 | **A/D** |
| **2** | settings-api **6 组 fixture 落盘** | **GO**（无条件） | 纯测试债、零产品行为改动；本报告已用**真实 `registerSettingsRoutes` + fake Host** 把 6 组 12 条断言**实跑全绿**（`# pass 12`），并证明不依赖 live host / 真实 key | **A/D** |
| **3** | 升级到 `@deepseek-ai/dsh@0.2.2-rc.1` | **NO-GO（当前）；CONDITIONAL-GO（未来，7 道硬门禁全过才允许）** | 硬阻塞：本机 Node `v22.20.0` < `engines.node >= 24.9.0`；且 0.2.2-alpha.2 有 web search breaking change；2.8.8 仍缺 `remote.credentials` / 仍删 Host / settings inert ⇒ 升级会**重现 3 个已修缺陷**。当前 profile pin 2.8.4，不升级是零动作稳态 | **A/C/D** |

> **Lead 补充证据的采用**：官方 OpenCode `v2.2.6` 的 `packages/core/src/plugin/websearch/mcp.ts` 只发单个 `tools/call`（`id:1`、无 initialize），
> 与 [42 号](42-officialize-contract.md) 路径订正、[35 号](35-deep-dig.md)「v2.2.6 新增 provider.ts、仍 5 provider、schema 未变」一致。
> 本报告明确：**这是 OpenCode 版本线，与 DSH 官方包 `@deepseek-ai/dsh@0.2.2-rc.1` 是两条独立版本线**，
> 决断 3 只针对 DSH 官方包升级，不把 v2.2.6 的 `mcp.ts` 行为当作 DSH 升级依据（等级 **A**，Lead 转述，本会话未独立取 raw）。
> v2.2.6 的 `mcp.ts` 事实只用于决断 2 的旁证（「跳过 initialize 是官方既有做法」），不影响 3 项 go/no-go。

---

## 1. 决断 1 · 上游既有中文 `Config.description` 全量英文化 → **NO-GO**

### 1.1 决断与依据

**决断：NO-GO。** 不执行全量英文化；改为**文档级处置**（保留现状 + 登记 Known Limitation，见 §1.5）。

| 判据 | 实测/出处 | 结论 | 等级 |
|---|---|---|---|
| 当前还剩多少中文 description | `$P/lib/index.js` 共 **55** 个 `.description(`，其中**中文 38**、英文 17（本机 `grep -cP`）；另有 13 个 `DEFAULT_LABELS`，**11 个中英混排 + 2 个英文**（本轮已改） | 全量改 = **38 + 11 = 49 处**字符串改动 | **A/D** |
| **2.8.8 上游是否也是中文** | **决定性反证**：缓存的 2.8.8 原文 `/tmp/dec48/up288/lib/index.js` 共 **50** 个 `.description(`，其中**中文 39**；`DEFAULT_LABELS` `:113-125` 的 **11 个标签全部中英混排且逐字与本机 2.8.4 相同** | 中文是**上游作者自己的风格**，不是本轮引入的偏差 | **A/D** |
| 与 2.8.8 冲突 | [44 §3 冲突矩阵](44-officialize-upstream.md):506：2.8.4→2.8.8 `index.js` 只多了 `searxngBaseURLs` **+7 行**，我们的 10 个 hunk `patch --dry-run` **5/5 CLEAN-APPLY**。若改 49 处 description，G3（`index.js` 9 个登记 hunk）的上下文全部变化 → **补丁必然 FAILED** | 全量改会**亲手破坏** 44 号已证的「可干净重放」 | **A/D** |
| 是否产品可见文案 | 是。`$P/README.md:122` 逐字「0.2.0 表单渲染**唯一用户可见文案来自 meta.description**」；43 号 N5（`.agents/notes/implemented/architecture/2026-08-23-locale-owned-client-ui-copy.md`）「Product-owned catalog descriptions follow the same rule」 | **业务上确属 i18n 约束**（43 号判断成立） | **A/B** |
| gate 能否强制 | `scripts/verify-client-ui-i18n.ts:319-337` 的 `sourceFiles()` 只 glob 仓库内 `packages/client/*/src/**/*.tsx` 等；插件在 `/home/dsh/.dsh/profiles/web/node_modules/`（仓库外、`.js` 后缀），**0 匹配** | `verify-client-ui-i18n` **不会拒**（43 号已证的假阴性）；改了也拿不到 gate 收益 | **A/D** |
| snapshot 风险 | `grep` 全部 4 个测试文件 + `.baseline-20261108-0922/`：**0 处断言依赖中文 description 字符串**；`meta.description` 只在 0.2.0 SettingsForms 表单渲染，**不进模型请求** | 改了**不触发** `AGENTS.md:154` 的 keyless recorded-session snapshot；但**会**改变 GUI 表单可见文本（需 GUI 证据，[packages/client/AGENTS.md](packages/client/AGENTS.md) 的 `test:web` lane） | **A/D** |
| 收益/成本 | 收益＝规范洁癖（且 gate 不覆盖）；成本＝49 处 diff + 与上游永久分叉 + 升级重放失败 + GUI 快照可能需重录 | 成本远大于收益 | **A/D** |

> **反直觉点 1**：43 号「按 DSH 规范不合规」的判断**成立**，但「因此要全量改」**不成立**——
> 因为 `verify-client-ui-i18n` 的强制对象是**仓库内 Client 源码**，而这个文案在**外部 npm 插件的 Host 半 Config schema** 里；
> 且上游 2.8.8 同样是中文。规范适用性 ≠ 本轮执行必要性。这是「业务约束成立、工程动作 no-go」的典型分离。

### 1.2 已执行部分（本轮之前的 43 号提案）现状核对

Lead 说「上一轮只改了本轮新增的 2+4 处」。实测**已落地**（A/D）：

| 项 | 当前值 | 状态 |
|---|---|---|
| `DEFAULT_LABELS.firecrawl` `:145` | `"Firecrawl (MCP, keyless with quota, off by default)"` | ✅ 已英文 |
| `DEFAULT_LABELS.tinyfish` `:146` | `"TinyFish (MCP, keyless 30/min and 50/day, off by default)"` | ✅ 已英文 |
| `firecrawlApiKeyEnv` `:242` | `"Firecrawl API key credential reference (optional; blank uses the hosted keyless tier)"` | ✅ 已英文 |
| `tinyfishApiKeyEnv` `:244` | `"TinyFish API key credential reference (optional; blank uses keyless mode)"` | ✅ 已英文 |
| `firecrawlBaseURL` `:266` | `"Firecrawl MCP endpoint (official v2 by default; may point at a TLS sidecar)"` | ✅ 已英文 |
| `tinyfishBaseURL` `:268` | `"TinyFish MCP endpoint (official by default; may point at a TLS sidecar)"` | ✅ 已英文 |

⇒ 6 处新增已收敛；`index.js` 与 `src-work/plugin/lib/index.js` md5 **一致**（`0e733c0f17ce2100ccbedf3952aeef21`），
与 `.baseline-20261108-0922/PLUGIN_CHECKSUMS.txt:6` 一致。**本轮不需要再改这 6 处**。

### 1.3 若 GO 的完整替换清单（**本决断不采纳，仅存档供未来上游协作**）

> 以下命令可生成完整清单，无需手写 49 条：
> `grep -nP '\.description\("[^"]*[\x{4e00}-\x{9fff}]' $P/lib/index.js`（38 行）+ `sed -n '136,148p' $P/lib/index.js`（11 个 label）。
> 逐条英文文本按「保留字段名/默认值/技术名词，去掉中文叙述」翻译即可（例：`:163` `每次搜索返回的最大结果数` → `"Maximum sources returned per search"`；
> `:224` `Brave API Key 的凭证引用…` → `"Credential ref for the Brave API key; the secret lives in the credential store"`）。
> **本报告不列全 49 条英文**，因为决断是 NO-GO，列出会误导执行者以为要改。完整清单可由上面两条命令随时生成（A 级）。

### 1.4 回滚 / 验收（针对「若误执行 GO」）

```sh
# 只读验收：确认未做全量英文化
P=/home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch
grep -cP '\.description\("[^"]*[\x{4e00}-\x{9fff}]' "$P/lib/index.js"   # 期望 38
md5sum "$P/lib/index.js" /home/ova/dsh/.artifacts/websearch-research/src-work/plugin/lib/index.js
# 期望两者相同 = 0e733c0f17ce2100ccbedf3952aeef21（基线 .baseline-20261108-0922/PLUGIN_CHECKSUMS.txt:6）

# 若误改了：用基线逐字节还原（需批准，本报告未执行）
cp /home/ova/dsh/.artifacts/websearch-research/.baseline-20261108-0922/src-work/plugin/lib/index.js "$P/lib/index.js"
# 或从 backups 重放：cp src-work/backups/index.js.orig + 重放 10 个补丁（见 44 §3）
```

### 1.5 NO-GO 的**文档级处置**（建议，纯文档、零代码风险）

在插件 `README.md` 的「Known Limitations and Deferred Work」同类位置（或新增 `## 已知限制`）加一段，
并在 [43 号](43-officialize-norms.md) §1.5 把「建议改（另案）」改判为「**裁决：保留 + 已登记**」：

```markdown
## Known Limitations and Deferred Work

- **Config descriptions are shipped in Chinese (upstream-authored).** `lib/index.js` contains
  38 Chinese `meta.description` strings and `DEFAULT_LABELS` contains 11 mixed zh/en backend
  labels. DSH's `verify-client-ui-i18n` (AGENTS.md:153) applies to in-repo Client sources
  (`packages/client/*/src/**/*.tsx`); this plugin is an external npm package under
  `node_modules/`, so the gate does not scan it. The six fields added for Firecrawl/TinyFish
  were authored in neutral English; the remaining Chinese strings are kept byte-identical to
  upstream 2.8.8 (which also ships 39 Chinese descriptions) so the local patch set stays
  cleanly replayable after an upgrade. Anglicizing them in a local fork would diverge from
  upstream without adding gate coverage. Tracked as a documentation debt, not a runtime defect.
```

**等级 A/B/D**（中文条数 A、gate 范围 A、2.8.8 中文 A/D、规范出处 B）。

### 1.6 分档

| 项 | 分档 |
|---|---|
| 保持 38 中文 description + 11 中文 label 不动 | **NO-GO（不改）** |
| 在 README/43 号登记 Known Limitation | **GO（纯文档，零风险）** |
| 未来若上游自己英文化，我们同步 | **条件-GO**（届时 44 号补丁需重生成，E 级，未验证） |

---

## 2. 决断 2 · settings-api 6 组 fixture → **GO**

### 2.1 决断与依据

**决断：GO（无条件）。** 纯测试债、零产品行为改动、不需用户批准（[41 号](41-bug-codehealth.md):140 已判「P1，纯测试债，无行为改动 → 不需用户批准」）。

| 判据 | 实测 | 等级 |
|---|---|---|
| 机制存在且逻辑正确 | `lib/settings-api.js`：`MAX_OPS=64` `:40`、边界 `:147-150`、`validateOp` `:196-217`（`Object.hasOwn` 白名单 `:205`）、`expectedRevision` `:174`、冲突→409 `:178-180`、`isConflict` `:219-224` | **A** |
| 零单测 | `grep -nE 'validateOp\|findNamespace\|expectedRevision\|MAX_OPS' $P/tests/` → 现有 4 个测试文件**0 命中**这三机制（41 号 :39 核过，本会话复核） | **A/D** |
| **6 组可实跑** | 本报告用**真实 `registerSettingsRoutes()`**（不是抽出的纯函数）+ fake `webServer`/`req`/`res`/`settings`/`config`，走真实 HTTP handler 路径，**12 条断言 `# pass 12`、exit code 0** | **D** |
| 不依赖 live host | fake `getConnection: () => ({ admit: () => ({}) })` 让 `rejectionFor` 放行；fake `getSettings().describe()/mutate()`、fake `getConfig().dict`；`req` 用内存 listener 发 `data`/`end`（**修复了 41 号草案 `:137` 自承的缺陷**：`guarded()` `:84-89` 用 `Promise.resolve().then()` 延迟挂载 listener，必须先 `await new Promise(setImmediate)` 再 `emit`）；全程无网络、无 DSH runtime、无真实 key | **A/D** |
| 不依赖真实 key | `DICT` 的 `numResults`/`enableExa` 是纯校验函数；`ROW` 是内存对象 | **A/D** |

### 2.2 41 号草案的 2 个缺陷（已在本次 GO 中修正，A/D）

| # | 41 号草案问题 | 本次修正 |
|---|---|---|
| 1 | `:137` 自承「`req.on("data")` 未提供 chunk，草案未实跑（E）」 | 实现 `req.emit()`：先 `data` 发 `Buffer.from(JSON.stringify(body))`，再 `end`；并在 `handler()` 后 `await new Promise(setImmediate)` 等 `guarded()` 的微任务把 `readBody()` 的 listener 挂上 |
| 2 | `:73` fake `getConnection: () => ({ trusted: true })` 与真实 `rejectionFor`（`trust.js:82-120`）不兼容——真实实现只认 `admit` / `requestRejection` 方法 | 改为 `getConnection: () => ({ admit: () => ({}) })`，与 `trust.js:91-96` 逐字对齐，`rejectionFor` 返回 `undefined` 放行 |

> **反直觉点 2**：41 号草案**不能直接落盘**——它自己标了 E「未实跑」，且 `getConnection` 的形状是猜的。
> 本报告把它从「草案」升级为「**已实跑 12/12 的可落盘代码**」，这是本次 GO 的主要增量。

### 2.3 6 组测试代码（**建议落盘内容**，已实跑通过）

> 目标文件：`tests/settings-api.test.js`（新增）。运行：`cd src-work/plugin && node --test tests/settings-api.test.js`（用测试专用 symlink 路径）。
> **本报告未把该文件写入插件**（硬约束：只写 47 号一个文件）。

```js
// tests/settings-api.test.js — fenced settings bridge: op validation, batch bounds,
// and optimistic-revision conflicts. Fixtures only: no live host, network, or credentials.
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerSettingsRoutes } from "../lib/settings-api.js";

const DICT = {
  numResults: (v) => { if (!Number.isInteger(v)) throw new Error("int"); return v; },
  enableExa: (v) => Boolean(v),
};
const ROW = [{
  ns: "dsh-websearch",
  value: { numResults: 8, enableExa: true },
  base: {}, user: {}, revision: 7, applies: "live",
}];

function harness({ mutate = async () => ({}), configDict = DICT } = {}) {
  let handler;
  const calls = [];
  registerSettingsRoutes({ register: (r) => { handler = r.handler; } }, {
    // trust.js:91-96 — an admit() returning no rejection lets the request through.
    getConnection: () => ({ admit: () => ({}) }),
    getSettings: () => ({
      describe: () => ROW,
      mutate: async (...args) => { calls.push(args); return mutate(...args); },
    }),
    getConfig: () => ({ dict: configDict }),
  });

  const req = (body, { contentType = "application/json" } = {}) => {
    const listeners = {};
    return {
      method: "POST", url: "/api/unified-search/settings",
      headers: { host: "127.0.0.1:3080", "content-type": contentType },
      on(event, fn) { (listeners[event] ??= []).push(fn); return this; },
      removeAllListeners(event) {
        if (event) delete listeners[event];
        else for (const key of Object.keys(listeners)) delete listeners[key];
        return this;
      },
      emit() {
        const chunk = Buffer.from(JSON.stringify(body));
        for (const fn of listeners.data ?? []) fn(chunk);
        for (const fn of listeners.end ?? []) fn();
      },
    };
  };
  const res = () => ({
    writableEnded: false, code: 0, payload: null,
    writeHead(code) { this.code = code; return this; },
    setHeader() { return this; },
    end(text) {
      try { this.payload = JSON.parse(text); } catch { this.payload = text; }
      this.writableEnded = true;
      return this;
    },
  });
  return { handler, calls, req, res };
}

async function call(h, body, opts) {
  const rq = h.req(body, opts);
  const rs = h.res();
  h.handler(rq, rs);
  // guarded() defers the handler by a microtask; readBody() attaches listeners there.
  await new Promise(setImmediate);
  rq.emit();
  for (let i = 0; i < 50 && !rs.writableEnded; i++) await new Promise(setImmediate);
  return rs;
}

// ① validateOp rejects: illegal op / path length / __proto__ bypass / missing value / type
for (const [name, ops, expected] of [
  ["bad op",           [{ op: "delete", path: ["enableExa"] }],          /unsupported op/],
  ["path length 2",    [{ op: "set", path: ["a", "b"], value: 1 }],      /one-element/],
  ["path non-string",  [{ op: "set", path: [1], value: 1 }],             /one-element/],
  ["unknown field",    [{ op: "set", path: ["evil"], value: 1 }],        /unknown settings field/],
  ["proto field",      [{ op: "set", path: ["__proto__"], value: 1 }],   /unknown settings field/],
  ["missing value",    [{ op: "set", path: ["numResults"] }],            /requires a value/],
  ["type mismatch",    [{ op: "set", path: ["numResults"], value: "x" }],/invalid value/],
]) {
  test(`validateOp rejects: ${name}`, async () => {
    const h = harness();
    const r = await call(h, { ops, expectedRevision: 7 });
    assert.equal(r.code, 400);
    assert.match(String(r.payload.error), expected);
    assert.equal(h.calls.length, 0, "invalid ops must not reach mutate");
  });
}

// ② MAX_OPS boundaries: 64 accepted, 65 and 0 rejected
test("MAX_OPS: 64 ok, 65 rejected, 0 rejected", async () => {
  const ok = Array.from({ length: 64 }, () => ({ op: "unset", path: ["enableExa"] }));
  const h1 = harness();
  const r1 = await call(h1, { ops: ok, expectedRevision: 7 });
  assert.equal(r1.code, 200);
  for (const n of [65, 0]) {
    const h = harness();
    const r = await call(h, {
      ops: Array.from({ length: n }, () => ({ op: "unset", path: ["enableExa"] })),
      expectedRevision: 7,
    });
    assert.equal(r.code, 400);
    assert.match(r.payload.error, /at most 64|non-empty/);
  }
});

// ③ concurrent writes with the same expectedRevision -> second gets 409
test("expectedRevision conflict -> 409 SETTINGS_CONFLICT", async () => {
  let n = 0;
  const h = harness({
    mutate: async () => {
      if (++n > 1) throw Object.assign(new Error("changed"), { code: "SETTINGS_CONFLICT" });
    },
  });
  const body = { ops: [{ op: "set", path: ["numResults"], value: 9 }], expectedRevision: 7 };
  const r1 = await call(h, body);
  const r2 = await call(h, body);
  assert.equal(r1.code, 200);
  assert.equal(r2.code, 409);
  assert.equal(r2.payload.code, "SETTINGS_CONFLICT");
});

// ④ non-integer expectedRevision is not forwarded to mutate (settings-api.js:174)
test("non-integer expectedRevision -> undefined passed to mutate", async () => {
  const h = harness();
  const r = await call(h, { ops: [{ op: "unset", path: ["enableExa"] }], expectedRevision: "7" });
  assert.equal(r.code, 200);
  assert.equal(h.calls[0][2], undefined);
});

// ⑤ non-conflict mutate failure -> 400 (not swallowed as success)
test("non-conflict mutate error -> 400", async () => {
  const h = harness({ mutate: async () => { throw new Error("disk full"); } });
  const r = await call(h, { ops: [{ op: "unset", path: ["enableExa"] }], expectedRevision: 7 });
  assert.equal(r.code, 400);
  assert.match(r.payload.error, /disk full/);
});

// ⑥ a legal op reaches mutate with the schema-checked value and integer revision
test("legal set reaches mutate with checked value", async () => {
  const h = harness();
  const r = await call(h, { ops: [{ op: "set", path: ["numResults"], value: 9 }], expectedRevision: 7 });
  assert.equal(r.code, 200);
  assert.deepEqual(h.calls[0][1], [{ op: "set", path: ["numResults"], value: 9 }]);
  assert.equal(h.calls[0][2], 7);
});
```

**实跑证据（D）**：本报告在 `/home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/` 下以
`node --input-type=module` inline 执行同一份逻辑，输出：

```
ok - validateOp rejects: bad op / path length 2 / path non-string / unknown field /
     proto field / missing value / type mismatch        (7 条)
ok - MAX_OPS: 64 ok, 65 rejected, 0 rejected
ok - concurrent expectedRevision conflict -> 409
ok - non-integer expectedRevision -> undefined
ok - non-conflict mutate error -> 400
ok - legal set reaches mutate with checked value
# pass 12
```

### 2.4 与现有 25/25 的关系 / 测试路径陷阱（**重要，A/D**）

| 运行位置 | 结果 | 原因 |
|---|---|---|
| `cd $P && node --test tests/*.test.js` | **# tests 15 / pass 10 / fail 5** | 5 个失败全是 `Cannot find package '@deepseek-ai/dsh-web' / '@deepseek-ai/dsh-credentials'`：安装目录 `lib/` 保持纯净、无测试 symlink |
| `cd src-work/plugin && node --test tests/*.test.js` | **# tests 25 / pass 25 / fail 0** | 该目录有 `node_modules/@deepseek-ai/dsh-web` 与 `test-node_modules/` 测试专用 symlink（25 §1:25 文件头已注明） |

⇒ **新增 `tests/settings-api.test.js` 后应在 `src-work/plugin/` 跑，期望 25 → 37**（12 条新 `test()`），
且它**不 import 任何 `@deepseek-ai/*` 包**（只 import `../lib/settings-api.js`，后者只依赖同包 `trust.js`/`util/namespace.js`），
所以**即使在安装目录裸跑也不会因缺包失败**——这是本测试相对现有 5 个的额外稳健性（A/D）。
**⚠️ 但本报告未把文件写入任一目录**，故 37/37 是**推断（E）**，落盘后需实跑确认。

### 2.5 回滚 / 验收

```sh
S=/home/ova/dsh/.artifacts/websearch-research/src-work/plugin
cd "$S" && node --test tests/settings-api.test.js          # 期望 12/12 pass, exit 0
cd "$S" && node --test tests/*.test.js                     # 期望 37/37（落盘后实测，当前 25/25）
grep -c '^import.*@deepseek-ai' "$S/tests/settings-api.test.js"   # 期望 0（不依赖 host 包）
# 回滚：rm tests/settings-api.test.js（新增文件，无备份依赖），25/25 恢复
```

### 2.6 分档

| 项 | 分档 |
|---|---|
| 落盘上述 6 组 / 12 断言 | **GO**（纯测试，零行为改动，已实跑） |
| 同时修 41 号草案的 2 个缺陷 | **GO**（已含在 §2.3 代码中） |
| 把 `validateOp`/`MAX_OPS` 抽成 export 便于单测 | **NO-GO**（41 号 :62 已判「不导出私有函数也可测」，走真实 handler 更好，避免扩大公开 API） |

---

## 3. 决断 3 · 升级 `@deepseek-ai/dsh@0.2.2-rc.1` → **NO-GO（当前）/ CONDITIONAL-GO（未来）**

### 3.1 硬决断

**当前：NO-GO。不升级。** 这是**硬结论**，不是「暂缓」；普通 `pnpm install` 也不会触发（profile 精确 pin，见 §3.4）。

**未来：CONDITIONAL-GO** —— 只有当 §3.5 的 **7 道门禁全部满足并逐条留证** 后才允许，且**升级与插件升级是两次独立动作**（见 §3.6）。

### 3.2 三条独立阻塞（任一成立即 NO-GO）

| # | 阻塞 | 实测 / 出处 | 等级 |
|---|---|---|---|
| **B1** | **Node 版本硬门槛**：`0.2.2-rc.1` 的 `engines.node >= 24.9.0`；本机 `node -v` = **v22.20.0**；当前安装 `@deepseek-ai/dsh` = **0.2.1-rc.2**（无 engines 字段） | [44 §4.1:524](44-officialize-upstream.md)（npm registry `/0.2.2-rc.1` 200，C）+ 本机 `node -v` / `require(...).version`（D） | **C/D** |
| **B2** | **0.2.2-alpha.2 web search breaking change**：官方删除 `dsh-web-search-exa`(provider `exa`) / `…-perplexity`(provider `perplexity`)，默认 `searchProvider` 从 `deepseek-official` 改 `deepseek-search-api`；`web-search-credential-modes` guide 移除 `baseURL`/`apiKeyEnv`/`apiKey` 字段；`v0.2.1-rc.3` 把 `searchMaxQueries` 4→10、`searchMaxResults` 8→10 | [44 §4.1:525-527](44-officialize-upstream.md)（3 份 upgrade guide raw 200，B/C）；guide 原文「Compositions that set `web.searchProvider` themselves see no change」⇒ 我们显式 `searchProvider: unified` 基本无碍，但**组合树残留 exa/perplexity 行会加载失败**、**`DEEPSEEK_BASE_URL` 串台风险**、**10 次 provider 搜索压力面变化**均标 E | **B/C + E** |
| **B3** | **升级会重现 3 个已修缺陷**：2.8.8（npm latest）`client.js:649` 仍缺 `remote.credentials`（Issue #8 保存失败）、`egress-fetch.js` 的 `normalizeHeaders` 仍删 Host（403）、`current()` 仍 `settingsForms = settings`（settings inert）。升级覆盖 `node_modules` 全部 10 个本地补丁 | [44 §3:17,510](44-officialize-upstream.md)（A/D）；[35-deep-dig-b](35-deep-dig-b.md) §1（C）；44 §4.1:528-529 | **A/C/D** |

> **⚠️ 版本线隔离（Lead 补充，A）**：OpenCode **`v2.2.6`** 的 `packages/core/src/plugin/websearch/mcp.ts`
> （`call()` 只发单个 `tools/call`，`id:1`、无 initialize；exa/parallel 都用它）属于 **OpenCode 仓库版本线**；
> 决断 3 的对象是 **DSH 官方 npm 包 `@deepseek-ai/dsh@0.2.2-rc.1`**，两条线**互不构成升级依据**。
> v2.2.6 的 `mcp.ts` 事实只用于说明「跳过 initialize 是官方既有做法」（与 42/35 号一致），
> **不得**用它推断 DSH 升级后的行为，也不改变 B1/B2/B3 任一阻塞。

### 3.3 当前稳态（**不升级 = 零动作**，A/D）

| 项 | 实测 |
|---|---|
| `~/.dsh/profiles/web/package.json` | `"@240xu/dsh-websearch": "2.8.4"`（**精确 pin、无 `^`**）；`pnpm-lock.yaml:12-13` 亦 pin 2.8.4 |
| 服务 | `systemctl show dsh-web.service` → `MainPID=2334`、`ActiveState=active`；drop-in 3 行 `Environment=` 仍在（含 `DSH_WEB_FETCH_PROVIDER=http`、`HTTP(S)_PROXY=…1091`） |
| 插件版本 | `node -p require(…/package.json).version` → **2.8.4** |
| 一致性 | `lib/index.js` 与 `src-work/plugin` md5 一致（`0e733c0f…`），与 `.baseline-20261108-0922/PLUGIN_CHECKSUMS.txt:6` 一致 |
| 测试 | `cd src-work/plugin && node --test tests/*.test.js` → **25/25 pass / 0 fail**（本报告实跑，D） |

⇒ 「不升级」不是拖延，而是**当前唯一不破坏 3 个已修缺陷的稳态**。风险只在
「手工改版本号 / 换机重装 / `pnpm store prune` 后重解包」（44 §4.1 末，D/E）。

### 3.4 升级对象澄清（避免误执行）

| 动作 | 是否本决断对象 | 说明 |
|---|---|---|
| `pnpm install`（普通） | ❌ | pin 2.8.4，不会升级；**允许** |
| 手工把 `package.json` 改成 `2.8.8` / `pnpm update @240xu/dsh-websearch` | ❌（**同样 NO-GO**） | 这是**插件**升级，会覆盖 10 个补丁并重现 3 缺陷；44 §3 已证，属 B3 |
| 升级 `@deepseek-ai/dsh` 0.2.1-rc.2 → 0.2.2-rc.1 | ✅ 本决断对象 | B1+B2+B3 全阻塞 |
| 升级 Node v22.20.0 → ≥24.9.0 | ⚠️ 前置门禁，**单独决断** | 会影响 dsh 用户全局 Node、`/opt/node22`、systemd `PATH`、其它服务；**本决断不 go** |

### 3.5 CONDITIONAL-GO 的 7 道硬门禁（**全部满足才允许**，逐条留 A/D 证据）

> 顺序执行；任一条失败即退回 NO-GO。全部需用户批准 + 隔离副本演练；**本轮一条未执行**。

| # | 门禁 | 验收命令 / 证据 | 等级 |
|---|---|---|---|
| **G1** | **先升 Node 到 ≥ 24.9.0**，并在**隔离 profile** 验证 `dsh web` 能启动（不影响 `MainPID=2334` 的现网服务） | `node -v` ≥ `v24.9.0`；`pnpm -v` 兼容；新 profile `--dump-config` 无 `PENDING` 行 | **C/D**（当前 v22.20.0 → 未满足） |
| **G2** | 逐字读 3 份官方 upgrade guide：`v0.2.2-alpha.2/web-search-default-provider`、`v0.2.2-alpha.2/web-search-credential-modes`、`v0.2.1-rc.3/web-search-defaults`，并**对照本机 `cordis.patch.yml` / `dsh web --dump-config` 全树**确认无残留 `id: exa/perplexity` 行、无 `baseURL/apiKeyEnv/apiKey` 字段 | raw 200（44 §4.1 已取）；本机 `grep -nE 'exa|perplexity|baseURL|apiKeyEnv' ~/.dsh/profiles/web/cordis.patch.yml`；`dsh web --dump-config \| grep -A5 'id: web$'` | **B/A + E**（串台/压力面未实跑） |
| **G3** | **升级前**存档当前 10 文件 md5 与生成 patch-package 补丁（或等价 `diff -u` 补丁集） | `md5sum -c .baseline-20261108-0922/PLUGIN_CHECKSUMS.txt` → 全 OK；44 §4.2 命令 | **A/D** |
| **G4** | 在隔离副本上 `patch --dry-run -p1` 验证 G1→G4 补丁对**目标版本**仍 CLEAN-APPLY | 44 §3 的 dry-run 顺序（当前对 2.8.8 是 5/5 CLEAN）；升级到 0.2.2-rc.1 后**必须重跑**，不能沿用 | **D**（当前未做，E） |
| **G5** | 升级后**按序重放**全部 10 个补丁，逐文件 `md5sum -c` 与 G3 存档比对 | 44 §6.1 的 V1–V7 验收表（`remote.credentials` / `host: headers.host` / `settings.describe` / `skipInitialize` / `resolveApiKey` 五不变量） | **A/D** |
| **G6** | 复核 systemd drop-in 三行 env 仍在；若走 2.8.8 forwarder 路径须补 `DSH_EGRESS_FORWARDER_PROXY`（当前**未设**） | `systemctl show dsh-web.service -p Environment`；`tr '\0' '\n' < /proc/<pid>/environ \| grep -i forwarder` | **D/E** |
| **G7** | 真实工具复跑 + 25/25（或含决断 2 的 37/37）单测 + GUI 认证 200 + health `enabled` 含 firecrawl/tinyfish | `web_fetch({url:"https://example.com"})` → 200；`web_search` → 8 Sources；`cd src-work/plugin && node --test tests/*.test.js`；认证 `GET /api/unified-search/settings` → `ok:true` | **D**（Lead 背景为 11-08 12:40 全绿，升级后须重跑） |

### 3.6 两个「升级」必须分开（**关键，A**）

- **DSH 官方包升级**（本决断对象）改的是 `/usr/local/lib/node_modules/@deepseek-ai/dsh/` 与 `dsh` CLI；
- **社区插件升级**（`@240xu/dsh-websearch` 2.8.4→2.8.8）改的是 `~/.dsh/profiles/web/node_modules/`。
- 两者**互不替代**：即使 G1–G7 全过、DSH 升到 0.2.2-rc.1，**也绝不自动升插件**——
  插件升级单独受 B3 约束（仍 NO-GO，44 §3）。
- 反过来，插件 2.8.8 的 `mcp.ts`/forwarder 改动也**不能**用来推断 DSH 0.2.2-rc.1 的行为。

### 3.7 回滚（若误执行升级）

```sh
# 只读验收：确认未升级
node -v                                                        # 期望 v22.20.0
node -p "require('/usr/local/lib/node_modules/@deepseek-ai/dsh/package.json').version"  # 期望 0.2.1-rc.2
node -p "require('/home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/package.json').version"  # 期望 2.8.4
md5sum -c /home/ova/dsh/.artifacts/websearch-research/.baseline-20261108-0922/PLUGIN_CHECKSUMS.txt

# 若误升级（需批准，本报告未执行）：
# 1) 恢复 package.json 精确 pin 2.8.4 + pnpm-lock.yaml（G3 存档）
# 2) 用 G3 的 diff -u 补丁集重放 10 文件，md5sum -c 验 17/17
# 3) sudo systemctl restart dsh-web.service（会中断现网，须窗口）
# 4) 重跑 G7 全部真实工具 + 25/25
```

### 3.8 分档

| 项 | 分档 |
|---|---|
| 当前升级 DSH 0.2.2-rc.1 | **NO-GO（硬）** |
| 当前升级插件 2.8.8 | **NO-GO（44 号已决，本决断重申）** |
| 普通 `pnpm install`（pin 2.8.4，不升） | **可接受** |
| 升 Node ≥24.9.0 | **NO-GO 本轮**（单独立项，影响全局） |
| 未来 7 门禁全过后升级 | **CONDITIONAL-GO** |
| 44 号 patch-package 持久化方案 | **需用户决定**（45 号 :108，不属本 3 项） |

---

## 4. 汇总表（决断 → 等级 → 命令 → 回滚）

| # | 决断 | 主要等级 | 可复现命令（只读） | 回滚 |
|---|---|---|---|---|
| 1 | **NO-GO** 全量英文化；**GO** 登记 Known Limitation | **A/B/D** | `grep -cP '\.description\("[^"]*[\x{4e00}-\x{9fff}]' $P/lib/index.js`（38）；`/tmp/dec48/up288/lib/index.js`（2.8.8 中文 39）；`sed -n '319,337p' scripts/verify-client-ui-i18n.ts` | 误改则用 `.baseline-20261108-0922/src-work/plugin/lib/index.js` 还原；文档条目删掉即可 |
| 2 | **GO** 6 组 / 12 断言 fixture | **A/D** | `cd src-work/plugin && node --test tests/settings-api.test.js`（落盘后 12/12）；本报告 inline 实跑 `# pass 12` | `rm tests/settings-api.test.js`（新增文件），25/25 恢复 |
| 3 | **NO-GO（当前）/ CONDITIONAL-GO（7 门禁）** | **A/B/C/D** | `node -v`（v22.20.0）；`node -p require('@deepseek-ai/dsh/package.json').version`（0.2.1-rc.2）；`grep '"@240xu/dsh-websearch"' ~/.dsh/profiles/web/package.json`（2.8.4）；`md5sum -c .baseline-20261108-0922/PLUGIN_CHECKSUMS.txt` | 恢复 pin + 重放 G3 补丁 + `md5sum -c` + 重跑 G7 |

---

## 5. 已确认无误 / 无法验证

### 5.1 已确认无误（本会话实跑）

| # | 事实 | 等级 |
|---|---|---|
| 1 | 6 处新增 Config description/DEFAULT_LABELS **已英文**；`index.js` 与 `src-work/plugin`、`.baseline-20261108-0922` md5 三方一致 | **A/D** |
| 2 | 2.8.8 上游 `index.js` 有 **39 条中文 description + 11 个中文 label** ⇒ 中文是上游风格 | **A/D** |
| 3 | 6 组 fixture **12/12 实跑通过**，走真实 `registerSettingsRoutes` handler，不依赖 live host/真实 key | **D** |
| 4 | 现有测试在**安装目录**裸跑 10/15（5 个因缺测试 symlink 失败），在 **`src-work/plugin/`** 跑 **25/25** —— 不是回归，是 25 §1:25 已注明的路径约定 | **A/D** |
| 5 | 0 处测试/snapshot 断言依赖中文 description 字符串 ⇒ 决断 1 的 no-go 不影响任何测试 | **A/D** |
| 6 | `trust.js:91-96` 的 `admit()` 形状已核对；41 号草案的 `getConnection` 形状是猜的，已修正 | **A/D** |
| 7 | 服务 `MainPID=2334` active、drop-in 3 env 仍在、插件仍 2.8.4 | **D** |

### 5.2 无法验证（E，不得当结论）

| # | 项 | 原因 | 建议 |
|---|---|---|---|
| E-1 | 落盘 `tests/settings-api.test.js` 后全量是否 37/37 | 本报告未写该文件（硬约束） | 落盘后 `cd src-work/plugin && node --test tests/*.test.js` |
| E-2 | 0.2.2-rc.1 升级后与 `unified` provider 的组合树实测、`DEEPSEEK_BASE_URL` 串台、`searchMaxQueries=10` 压力面 | 未升级（只读） | G2/G7 门禁里实跑 |
| E-3 | 44 号 G1→G4 补丁对 **0.2.2-rc.1**（而非 2.8.8）是否仍 CLEAN-APPLY | dry-run 只对 2.8.8 / PR#7 head 做过 | G4 门禁重跑 |
| E-4 | `patch-package` 的 pnpm 根包 postinstall 是否执行 | 未安装（44 §4.2 已标 E） | 隔离副本演练 |
| E-5 | 0.2.0 SettingsForms 是否**真的**原样渲染 `meta.description`（README:122 是作者自述） | 未跑 GUI 表单 | 认证 GUI 里查看设置面板 |
| E-6 | 官方 OpenCode v2.2.6 `mcp.ts` 的 raw 内容 | Lead 转述已核实，本会话未独立 `web_fetch` | 由 42/35 号交叉复核 |
| E-7 | 未来上游自己英文化后我们同步的补丁冲突面 | 未来事件 | 届时重生成 44 号补丁集 |

---

## 6. 五条反直觉发现

1. **「规范上不合规」≠「本轮该改」**：43 号证明中文 description 业务上违反 N1/N5，但
   `verify-client-ui-i18n` 只扫仓库内 Client `.tsx`，插件在仓库外 `node_modules` 的 `.js`（假阴性）；
   而 2.8.8 上游**自己也是 39 条中文**。⇒ 全量英文化既拿不到 gate 收益，又会亲手毁掉 44 号「5/5 CLEAN-APPLY」的重放能力。**A/D**。

2. **41 号的 6 组 fixture 草案不能直接落盘**：它自己标了 E「`req.on("data")` 未实跑」，且
   `getConnection: () => ({ trusted: true })` 与真实 `rejectionFor`（只认 `admit`/`requestRejection`）不兼容。
   本次 GO 的增量是把草案升级为**已实跑 12/12** 的可落盘代码，并修掉这两个缺陷。**A/D**。

3. **「25/25 全绿」只在特定目录成立**：`cd $P && node --test tests/*.test.js` 实测 **10/15**（5 个
   `Cannot find package '@deepseek-ai/dsh-web'`），`cd src-work/plugin` 才是 **25/25**。
   审查者若在安装目录跑会误报 5 个回归；25 §1:25 的文件头注释早有说明。**A/D**。

4. **两个「升级」是两条独立动作、互不解禁**：DSH 官方包 0.2.2-rc.1 与社区插件
   `@240xu/dsh-websearch` 2.8.8 分属不同路径、不同版本线；即使 DSH 升级 7 门禁全过，
   **也绝不顺带升插件**（B3 仍阻塞）。Lead 补充的 OpenCode v2.2.6 是**第三条**版本线，更不能混。**A/C**。

5. **「不升级」是零动作稳态而非技术债**：profile `package.json` 精确 pin `2.8.4`（无 `^`）、
   `pnpm-lock.yaml` 同 pin ⇒ 普通 `pnpm install` 不会升；三行 drop-in env 与 10 个补丁都在。
   真正的风险只在「手工改版本号 / 换机重装 / store prune 后重解包」，属运维操作而非代码缺陷。**A/D**。

---

## 7. 只读取证命令索引

```sh
P=/home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch
S=/home/ova/dsh/.artifacts/websearch-research/src-work/plugin
B=/home/ova/dsh/.artifacts/websearch-research/.baseline-20261108-0922

# 决断 1
grep -nP '\.description\("[^"]*[\x{4e00}-\x{9fff}]' "$P/lib/index.js"          # 38 行
sed -n '136,153p' "$P/lib/index.js"                                             # 13 labels
grep -cP '\.description\("[^"]*[\x{4e00}-\x{9fff}]' /tmp/dec48/up288/lib/index.js  # 2.8.8 = 39
sed -n '113,125p' /tmp/dec48/up288/lib/index.js                                 # 2.8.8 labels
sed -n '319,337p' /home/ova/dsh/scripts/verify-client-ui-i18n.ts
grep -n 'meta.description' "$P/README.md"                                       # :122
md5sum "$P/lib/index.js" "$S/lib/index.js"; grep index.js "$B/PLUGIN_CHECKSUMS.txt"

# 决断 2（本报告 inline 实跑，未落盘）
grep -n 'MAX_OPS\|validateOp\|expectedRevision\|isConflict' "$P/lib/settings-api.js"
sed -n '77,120p' "$P/lib/trust.js"                                              # admit() 形状
cd "$S" && node --test tests/*.test.js                                          # 25/25
cd "$P" && node --test tests/*.test.js                                          # 10/15（路径陷阱）

# 决断 3
node -v                                                                          # v22.20.0
node -p "require('/usr/local/lib/node_modules/@deepseek-ai/dsh/package.json').version"   # 0.2.1-rc.2
grep -n '"@240xu/dsh-websearch"' /home/dsh/.dsh/profiles/web/package.json      # 2.8.4 pin
systemctl show dsh-web.service -p MainPID -p ActiveState -p Environment
md5sum -c "$B/PLUGIN_CHECKSUMS.txt"
sed -n '518,533p' /home/ova/dsh/.artifacts/websearch-research/44-officialize-upstream.md
sed -n '165,177p' /home/ova/dsh/.artifacts/websearch-research/45-reform-verdicts-SKELETON.md
```

---

**本报告无凭证值写入；未改任何源码/配置/其它报告/运行时；未操作任务板；未落盘测试、未升级、未重启。**
**三项决断：1 = NO-GO（改登记 Known Limitation）｜2 = GO｜3 = NO-GO 当前 / CONDITIONAL-GO 未来（7 门禁）。**
