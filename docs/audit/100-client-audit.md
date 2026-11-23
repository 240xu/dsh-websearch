# 100 · client.js（918 行）UI 状态机冗余审计（P4 骨架 → Lead 工具实测补完，2026-11-23）

> P4 专家落盘 26 行骨架后未补完；Lead 用工具补完。
> 结论：**client.js 只有 1 处真冗余（已修，918 → 917 行）**；其余看起来重复的地方都是必要条件不同，不该合并。

## 0. 结构与证据基线

- 目标：`src-work/plugin/lib/client.js`（**918 行**）
- 形态：**一个 `window.__ModuleLoader__` 闭包工厂** —— `export apply(ctx)` + 8 个内嵌函数
  （`createStore` / `safeFailureReason` / `ToggleRow` / `KeyedBackendCard` / `SelectField` / `UnifiedSearchSection` / `selectBridge` / `apply`）
- 相关测试：`tests/lead-20261108-interaction.test.js`（13 条源码级断言直接读 `lib/client.js`）
- 方法：`grep` / `node` 脚本做集合差集 + 全文件引用计数

## 1. 状态字段盘点

`createStore` 里由 `apply` 持有的可变状态（`:300-380` 一带）：

| 字段 | 语义 | 可否派生 |
| --- | --- | --- |
| `staged: Map` | 字段级待保存编辑 | 本源状态 |
| `stagedKeys: Map` | key 级待保存编辑 | 本源状态 |
| `savedAt: number` | 上次保存成功的时间戳（用于「已保存 ✓」提示） | 本源状态 |
| `savedFieldRefs` / `savedKeyRefs` | 保存后比对用的快照引用 | 本源状态（用于判断"是否真的改了"） |
| `failed: boolean` | 最近一次保存失败 | **不可派生**：需要区分「失败」与「用户又编辑了」（后者会清它） |
| `conflict: boolean` | 失败是否为 `SETTINGS_CONFLICT` | 可派生自 `failed + error` 但当前保留诊断用 |
| `failedFields: Set` | 哪些字段校验失败 | 本源状态 |
| `failedKeys: Array<{ref,reason}>` | 哪些 key 写失败（**带 reason**，不是纯字符串） | 本源状态 |
| `readErrors: Array<{ref,reason}>` | 读取 key 时的错误 | 本源状态 |
| `writeQueue: Promise` | 串行化写入链（防止 revision 竞态） | 本源状态 |
| `saving: boolean` | 写入进行中 | 可派生自 `writeQueue` 状态，但当前显式更清晰 |

**判定**：`stagedCount` 已经是派生的（`this.staged.size + this.stagedKeys.size`，`:334`）。其余字段没有可安全派生的 —— 它们各自承载「上一次操作的结果」，派生会丢掉时序信息。

## 2. 渲染分支重复量化

| 检查项 | 结果 |
| --- | --- |
| `SelectField(` 调用次数 | **1**（只有一个共享组件，已复用） |
| `type: "checkbox"` 出现 | 2（`ToggleRow` 与 `KeyedBackendCard` 各一 —— 一个是后端总开关、一个是带 key 的卡片，DOM 结构不同） |
| `type: "password"` 出现 | 2（key 输入区，一个在 `KeyedBackendCard`、一个在 OPTIONAL 区，见下） |
| `BACKENDS.filter` 出现 | **6 处**（`:46-49` 四个分类常量 + `:658` enabledCount + `:659` keyedBackends） |

### 真冗余（已修）

**`:659` 的 `keyedBackends` 与 `:48` 的 `KEYED` 是同一个表达式**：

```js
:48   const KEYED = BACKENDS.filter((b) => b.keyEnv && !b.optionalKey);
:659  const keyedBackends = BACKENDS.filter((b) => b.keyEnv && !b.optionalKey);   ← 完全重复
```

`:660` 与 `:682` 用到 `keyedBackends`（算 `keysReady` 与显示 `keysReady + "/" + length`）。**已改为直接用 `KEYED`，删掉重复的 filter 调用与临时变量**：

```js
const keysReady = KEYED.filter((b) => b.state.keyState[b.keyEnv]?.configured).length;   // :660
children: keysReady + "/" + KEYED.length                                                // :681
```

**client.js 918 → 917 行**，`node --check` OK，**81/81 单测仍全绿**（`interaction.test.js` 里没有 pin `keyedBackends`）。

### 不是冗余（不该合并）

| 位置 | 为什么保留 |
| --- | --- |
| `ToggleRow` vs `KeyedBackendCard` 里的 checkbox | 前者只渲染「label + 开关」；后者还要渲染 key 状态点（`#e6a700`/`#888`/`#2ea043`）、`keyMissing` 提示、badge、`getKey` 外链、password 输入、失败/读失败提示。合并会变成 10+ 分支的巨型组件 |
| `METERED` / `KEYLESS` / `KEYED` / `OPTIONAL_KEYS` 四个 filter | 四个集合语义不同（免 key 且非计量 / 可带可选 key / 必须 key / 可选 key），`KEYLESS` 甚至带 `!b.metered` 的复合条件 |
| `SelectField` 单一实现 | 已经是复用的，无需再抽 |

## 3. i18n 字典死键清单

| 项 | 数量 |
| --- | --- |
| zh 键 | 55 |
| en 键 | 56 |
| `t("k")` / `bind(NS)("k")` 直接引用 | 63 |

**字典有、但无 `t()` 直接引用的键**：`title` / `dirty` / `saved` / `reset` / `overridden` / `togglesTitle`（6 个），外加 **只有 en 有** 的 `validation`（1 个）。

**但这 7 个键全部是上游 npm 2.8.4 原有**（`grep -c` 上游 `client.js`：`title` 2 / `dirty` 2 / `saved` 2 / `reset` 4 / `overridden` 4 / `togglesTitle` 2）。

⇒ **删除会让我们的补丁与上游分叉扩大**，且只有 7 行收益。**判定：不删**（与 98 号「死代码 0 可删」同一原则）。

## 4. CSS

`client.js` 里**没有独立 `const css = ...` 常量**（内联 style 对象分散在 JSX 里）。无重复选择器可提取。

## 5. 可提取纯函数清单

| 候选 | 现状 | 判定 |
| --- | --- | --- |
| `toggleField(id)` | `:655` 已是一个内联箭头 | 已是提取态 |
| `safeFailureReason(err)` | `:289` 已是独立函数 | 已是提取态 |
| `createStore(initial)` | `:190` 已是独立函数 | 已是提取态 |
| `computeDirty(staged, stagedKeys)` | 现在直接用 `stagedCount` | 派生值已存在，无需再抽 |

⇒ **没有新的纯函数可提取**。

## 6. 受影响断言清单

`interaction.test.js` 有 **13 条**直接读 `lib/client.js` 源码的断言。本轮改动（删 `keyedBackends`）**不在其中**（grep 无命中），所以 **0 条断言受影响**，81/81 直接通过。

其余 3 个测试文件也各 pin 了 `client.js`（`lead-20261106.test.js` 8 条、`lead-20261107.test.js` 1 条、`lead-20261108-sse.test.js` 3 条），同样未被本轮改动触及。

## 7. 三批收敛方案（结论：只做第一批）

| 批 | 内容 | 状态 |
| --- | --- | --- |
| **P4-1** | 消除 `:659` 与 `:48` 的重复 filter | **✅ 本轮已做**（−1 行） |
| P4-2 | 删 7 个 i18n 死键 | ❌ 上游原有，分叉代价 > 7 行收益 |
| P4-3 | 合并 `ToggleRow` + `KeyedBackendCard` | ❌ 会变成 10+ 分支巨型组件，可读性下降 |

## 8. 无法验证 / 证据缺口

- **E**：`failed` / `conflict` 的「可派生性」只做了静态分析，未在浏览器里跑真实 UI 验证时序语义。
- **E**：7 个 i18n 死键是否被宿主（外部 locale 注入）使用 —— 上游保留它们可能有外部用途。
- **C**：`client.js` 917 行是否还有未发现的重复 —— 只做了结构扫描与引用计数，没做语义级克隆检测。

## 9. 结论（A–E）

- **A**：`918 → 917`、81/81、`node --check` OK 是实测。
- **A**：`keyedBackends` 与 `KEYED` 逐字相同，是 grep 直接证据。
- **A**：7 个 i18n 死键是「上游原有」由 `grep -c` 上游 tarball 证明。
- **B**：`ToggleRow`/`KeyedBackendCard` 不宜合并是结构分析结论。
- **E**：真实浏览器 UI 时序。

---
无凭证值写入本文件。
