# 114 · client.js 结构化拆分（2026-11-25，目标模式第 1 轮）

> 用户「开目标模式，持续推进」。本轮把 113 号划定的边界执行掉。

## 0. 结果

| 指标 | 起点 | 现在 | 变化 |
| --- | --- | --- | --- |
| `UnifiedSearchSection` | **176 行** | **38 行** | **−138（−78%）** |
| 新增子组件 | — | `StatusSummary` 15 / `BackendToggles` 40 / `SettingsFields` 45 / `OptionalKeysAndActions` 37 | +137 |
| `client.js` 总行数 | 917 | **959** | **+42** |
| `lib/` 总行数 | 6087 | **6129** | **+42** |
| 总测试 | 92 | **93** | +1 |
| 补丁 | 38 段 / 4619 行 | **38 段 / 4921 行 / 38/38** | — |

**行数涨了 42 行** —— 这是拆分的固有成本（4 个组件各需签名 + JSDoc + 闭合）。用户这轮要的是「结构化拆分」，不是「减行数」，我按这个量纲执行。

## 1. 第一批：`UnifiedSearchSection` 拆分（已做）

`UnifiedSearchSection` 现在是 **4 个调用** 的扁平列表：

```js
return react_jsx_runtime.jsxs("div", { className: "wsc-card", children: [
  react_jsx_runtime.jsx(StatusSummary, { state, enabledCount, keysReady, t: props.t }),
  react_jsx_runtime.jsx(BackendToggles, { state, card, toggleField, t: props.t }),
  react_jsx_runtime.jsx(SettingsFields, { state, card, t: props.t }),
  react_jsx_runtime.jsx(OptionalKeysAndActions, { state, card, t: props.t }),
] });
```

| 子组件 | 行数 | 职责 |
| --- | --- | --- |
| `StatusSummary` | 15 | enabled/keys 计数 + 三条警示（全关回退、只读、metered 默认关） |
| `BackendToggles` | 40 | keyless toggles / keyed cards / metered 独立分组 |
| `SettingsFields` | 45 | 全局 3 个 input + 整形 6 个 select（`recencyOptions` 等一并移入） |
| `OptionalKeysAndActions` | 37 | 可选 key 网格 + 保存栏 |

**关键**：`SettingsFields` 把 `recencyOptions` / `dedupOptions` / `boolOptions` / `selVal` 一起吃掉了 —— 它们是纯 `t()` 派生，移进去反而更内聚。

## 2. 新增 1 条行为测试（补一个真缺口）

拆分后我做了注入验证，发现**删掉 `StatusSummary` 的 enabled 计数，93 个测试全过** —— 这是个真缺口。

补的第 19 条：

```js
test("the status strip reports enabled and keyed counts", ...)
// 断言：两个 <b>（enabled/total 与 keys/total）+ 两个标签都在
```

**验证闭环**：删掉 enabled 计数 → **1 fail / 92 pass** ✅ → 还原 → 93/93。

## 3. 第二批：`UnifiedSearchCardController`（266 行）—— **裁决：不拆**

我在 113 号说「266 行可以拆」，**实测后改变了判断**。

方法分布：

| 方法 | 行数 | 占比 |
| --- | --- | --- |
| **`save`** | **91** | **40%** |
| `readCredential` | 44 | |
| `projection` | 24 | |
| `writeCredential` | 23 | |
| `setToggle` | 20 | |
| `constructor` | 20 | |
| `inject` | 14 | |
| `editKey` | 10 | |
| 其余 8 个 | 20 | |

**不拆的三条理由**：

1. **`save` 91 行是一个事务**：字段循环 → 密钥循环 → 清理 → 判定 savedAt，四步共享 `savedFieldRefs` / `savedKeyRefs` / `doneFields` / `doneKeys` / `this.staged` / `this.stagedKeys` / `this.failed`。提成函数需要 **7 个参数**，调用点会变得比现在更难读。
2. **去掉 `save` 后只剩 175 行**，本来就不算巨型函数。
3. 与 105 号对 `provider` 段 3/4/6 的判定**完全同理**（共享可变状态 ⇒ 参数爆炸）。

**替代做法**：补 JSDoc。13 个方法里 **12 个原本没有**，补了 7 个关键契约：

- `projection` / `republish` / `edit` / `reset` / `editKey` —— 各自的不变量
- `save` —— 写明「快照在 await 之前」与「in-flight 时是 no-op」两条契约
- `inject` —— slot props 的形状

## 4. 过程中的 2 个失误（都是我的，已修）

| 错 | 现象 | 根因 | 修法 |
| --- | --- | --- | --- |
| 用行号删除 | 第一次提取 `StatusSummary` 时删错了段落，导致 0 个 keyCard、原块残留 | Python 插入后行号偏移没重算 | **改用内容锚点**（`s.index(ANCHOR_START)` + `s.index(ANCHOR_END)`），不再依赖行号 |
| 断言太绕 | 状态摘要测试用 `": "` 当锚点找不到 | fake jsx 的 children 结构是 `[t("x"), ": ", <b>]` | 简化成「数 `<b>` = 2」+「标签字符串在树里」 |

**第 1 条值得记**：这已经是本项目**第二次**因「行号偏移」出错（上一次是 §113 改 pin）。**内容锚点永远优于行号**。

## 5. 注入验证（4 次，全部精确命中）

| 注入 | 结果 |
| --- | --- |
| `children: KEYED.map` → `[].map`（在新 `BackendToggles` 里） | **1 fail** |
| 删 `StatusSummary` 的 enabled 计数 | **1 fail**（补测试前是 0 fail ⇒ 暴露缺口，补后有效） |
| （早先）`onEditKey` 改成 `() => undefined` | **1 fail** |
| （早先）`!b.metered` 删掉 | **1 fail** |

## 6. 验收

| 项 | 结果 |
| --- | --- |
| 单测 | **93/93** |
| 38 段逐字节 | **38/38**（双份 `659f38fe8410`） |
| dev 3081 | health **200**（enabled=6, backends=13） |
| 主实例 3080 | active PID 3830346，**全程未重启** |
| 提交 | `740676a`（section 拆分）+ `863916b`（controller JSDoc） |

## 7. 结论（A–E）

- **A**：176 → 38、+42 行、93/93、38/38 全是实测。
- **A**：`save` 拆解需 7 参数是方法逐一分析的结果。
- **A**：删 enabled 计数 93 全过 ⇒ 缺口真实存在；补测试后 1 fail 有效。
- **B**：controller 不拆是量纲判断（事务内聚 vs 参数爆炸）。
- **C**：`SettingsFields` 把 4 个 option 数组移入是否算「过度内聚」，取决于后续是否要给其它组件复用。
- **E**：真机浏览器渲染仍未验证（fake react）。

## 7.5 第 2 轮补测（同日续做）

第一轮之后又补了 2 条行为测试，覆盖两个从未被测的分支：

| 新增 | 注入验证 |
| --- | --- |
| **`settingsScope` 分支**：`ctx.get("settingsScope")` 有 `bind` ⇒ 完全不发 HTTP（`fetches === 0`） | 把 `selectBridge` 改成永远走 routes → **1 fail** |
| **legacy connection 分支**：`connection.api.credentials.describe({refs})` → 置 configured | 删掉该分支 → **2 fail**（连带 readErrors 测试） |

`settingsScope.bind()` 返回的必须是**完整 bridge 面孔**（`getSnapshot`/`subscribe`/`accept`/`load`/`set`/`unset`）——
我第一次只给 `load/set/unset`，构造函数就 `this.scope.getSnapshot is not a function`。

**`readCredential` 44 行经评估不抽纯函数**：9 处 `this` 里 6 处是写状态（`keyState`/`readErrors`/`republish`），
抽成 `describeCredential(remote, connection, ref)` 只能省 ~6 行，却要 fake 两套 API ⇒ **收益不抵测试成本**。
替代做法是**把三个分支全测到**（本轮已 done）。

## 8. 下一轮可做（如果继续）

1. **`UnifiedSearchCardController` 的 `readCredential`（44 行）**：它有三个分支（remote face / legacy connection / catch），可以抽成 `describeCredential(api, ref)` 纯函数 —— 但需要 fake 两种 API，测试成本高。
2. **给 `client-behavior.test.js` 加 `settingsScope` 路径的测试**：现在只测了 routes bridge（fake fetch），`settingsScope` 分支（`ctx.get("settingsScope")`）没有覆盖。
3. **`BackendToggles` 的 40 行**：三个组的骨架高度同构（header + grid + map），可以抽 `ToggleGroup` —— 但收益只有 ~8 行，且会让 metered 的特殊条件更难读。

---
无凭证值写入本文件。
