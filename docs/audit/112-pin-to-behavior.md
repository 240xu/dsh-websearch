# 112 · 源码 pin → 行为断言转换（解锁后续重构的前置工程，2026-11-25）

> 用户「做」。这是我在 111 号里点名的**唯一能解锁后续跨文件重构的前置工作**。
> `client.js` 是 `window.__ModuleLoader__` 工厂，controller 全在闭包里，所以老断言只能 pin 源码文本 ——
> 任何重构搬代码就断，而真回归反而漏过。

## 0. 结论

| 项 | 转换前 | 转换后 |
| --- | --- | --- |
| 总测试 | 81 | **89** |
| `client.js` 行为测试 | **0** | **9** |
| 源码 `assert.match(src)`（两个文件） | **48** | **41**（删掉 7 条已被行为测试覆盖的） |
| 补丁段数 | 37 | **38**（新增 `tests/client-behavior.test.js`） |

## 1. 怎么做到的（技术上最关键的三个突破）

### 1.1 在 Node 里加载 `window.__ModuleLoader__` 工厂

`client.js` 的形态：

```js
window.__ModuleLoader__.load({ id: "...", factory: (require) => { ... } });
```

⇒ 用 `new Function("window", "CustomEvent", src)` 注入 fake window，捕获 `load()` 的入参，
再调 `factory()` 并给它两个假 react 面（`react/jsx-runtime` 与 `react`）。

**验证**：`module loaded: apply,inject`。

### 1.2 通过 `apply(ctx)` 把 controller 的 props 掏出来

`apply` 里：

```js
ctx.slots.inject("settings.section", () => ctx.slots.register({ ..., inject: () => controller.inject() }, UnifiedSearchSection));
```

⇒ fake `slots.inject` 必须**真的执行回调**（我第一次写成 `() => {}` 空实现，导致 `register` 根本没被调用，白查了半小时）。
`controller.inject()` 返回 `{ hooks: { unifiedSearchCard: store }, edit, setToggle, reset, editKey, save, discard }` —— **这就是行为测试的驱动面**。

### 1.3 用 fake `fetch` 驱动真 `SettingsRoutesBridge`

默认 bridge 走 HTTP：

```
GET  /api/unified-search/settings
POST /api/unified-search/settings  { ops, expectedRevision }
```

⇒ fake `fetch` 能直接观察到**真实 POST body**：

```
body: {"ops":[{"op":"set","path":["numResults"],"value":3}]}
```

这比 pin 源码字符串强得多 —— 它断言的是**发给宿主的东西**。

## 2. 9 条行为测试

| # | 断言什么 | 对应的旧源码 pin |
| --- | --- | --- |
| 1 | `edit` 进 projection（`stagedCount` 1、`savedAt` 归零） | 新覆盖 |
| 2 | 空白 key 草稿不滞留（`stagedCount` 回 0） | ✅ 替代 `interaction` 的 `trim() === ""` |
| 3 | `reset` 不发写 | 新覆盖 |
| 4 | `save` 发**一个** bundled set op 并清 staged | 新覆盖 |
| 5 | 写失败保留草稿 + 分类 `SETTINGS_CONFLICT` | 新覆盖 |
| 6 | `discard` 清空所有 staged 与失败态 | 新覆盖 |
| 7 | 第二次 `save` 在飞时是 no-op（不双写） | 新覆盖 |
| 8 | 两个 queued write 各读自己的 revision（`expectedRevision` 不同） | ✅ 替代 `interaction` 的 `writeQueue` 4 条 pin |
| 9 | 渲染出 **7 个 `wsc-keyCard`** + ≥3 个组标题 | ✅ 替代 `lead-20261106` 的 `KeyedBackendCard` + `children: KEYED.map` 2 条 pin |

## 3. 注入验证（证明测试真能抓 bug，不是摆设）

每条都做「注入语义 bug → 断言失败 → 还原 → 全绿」：

| 注入的 bug | 结果 |
| --- | --- |
| `if (String(text).trim() === "")` → `=== "\u0000"` | **1 fail / 6 pass**（精确定位） |
| `if (this.saving) return;` → `if (false) return;` | **1 fail**（`a second save while one is in flight`） |
| `writeQueue.then(run, run)` → 直接 `writeNow(ops)` | **1 fail**（`queued writes each read the revision`） |
| `children: KEYED.map(...)` → `children: [].map(...)` | **1 fail**（`7 !== 0`） |

**注意第 4 条**：我第一次写这条测试时是**假绿** —— 只断言「有 element」，删掉 `KEYED.map` 仍 9/9 通过。
改成按 `className: "wsc-keyCard"` 计数后才真能抓。这条教训写进了本文件。

## 4. 过程中我自己踩的三个坑（都记下来，免得后人重踩）

| 坑 | 现象 | 根因 | 修法 |
| --- | --- | --- | --- |
| fake `slots.inject` 写成空实现 | `register` 从未被调用，捕获不到 render 组件 | 真 host 会执行回调 | `inject: (_name, fn) => { fn(); }` |
| 只调 `setImmediate` 等 load | render 拿到 `ready: false`，只画出 `…` 占位 | `bridge.load()` 有多个 await | `await new Promise((r) => setTimeout(r, 20))` |
| walk 不展开组件函数 | 只收集到 76 个节点，全是外壳 | fake `jsx` 把组件函数放在 `type` 里不调用 | `if (typeof node.type === "function") walk(node.type(node.props))` |

**第四条**：断言「2 个 keyCard」是错的 —— `KEYED` 是「所有需要 key 的后端」（7 个），与 enabled 无关。实测 7 才对。

## 5. 没转的（保留源码 pin，附理由）

| 位置 | 为什么留 |
| --- | --- |
| `interaction` 的「save() keeps edits arriving during in-flight writes」 | 需要竞态注入（在 await 间插一次 edit），当前 fake 架构做不到精确时序 |
| `interaction` 的「credential failure reasons are redacted」 | 需要 fake `connection.api.credentials`，可做但属下一批 |
| `interaction` 的「a failed toggle resyncs with the host」 | 需要观察 `scope.load()` 被二次调用，可做但属下一批 |
| `lead-20261106` 的 5 条 `assert.doesNotMatch` | **反例断言**：pin「旧 bug 的写法不存在」，保留为廉价护栏 |
| `interaction` 其余 22 条 `assert.match` | 含 M-1/M-3/N4 等非 client.js 的 pin，与 `client.js` 行为测试无关 |
| 7 条 i18n 死键 / 4 条 `findPluginRow` 等 | 不在 `client.js`，与本工程无关 |

## 6. 解锁了什么

`client.js` 现在有 **9 条真行为测试**，意味着：

- `UnifiedSearchSection`（176 行）**可以安全拆**（渲染断言按 className 计数，不 pin 函数名）
- `UnifiedSearchCardController`（**266 行**）的**状态机部分**可以安全拆（`edit/save/reset/editKey/discard` 全有行为覆盖）
- 但 `writeCredential/readCredential` 的时序细节仍只有源码 pin ⇒ 拆那两块**还需要**补第 5 节里没转的 3 条

## 7. 验收

| 项 | 结果 |
| --- | --- |
| 单测 | **89/89** |
| 38 段逐字节 | **38/38** |
| `refresh.sh` | 已补到核 **38 项**（新增 `tests/client-behavior.test.js`） |
| dev 3081 | health **200**（enabled=6, backends=13） |
| 主实例 3080 | active PID 3830346，**未重启** |
| 提交 | `c644a0b`（行为测试）+ `f18f4e8`（patch 38 段） |

## 8. 结论（A–E）

- **A**：89/89、38/38、9 条行为测试、4 次注入验证全是实测。
- **A**：三个技术突破（fake window / `inject()` 驱动 / fake fetch 观察 POST body）都有可复现的最小验证。
- **A**：我自己的假绿（渲染断言只数 element）已发现并修正，教训写进 §3。
- **B**：剩余 38 条源码 pin 里，能继续转的只剩 3 条（需竞态注入或 fake connection）。
- **C**：`CardController` 266 行能否整体拆，取决于是否补那 3 条。
- **E**：真机浏览器渲染（本轮用 fake react，未验真 React reconciler）。

---
无凭证值写入本文件。
