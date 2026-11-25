# 113 · pin 转换完成：48 → 17，行为测试 18 条（2026-11-25）

> 用户选了「先补最后一处密钥竞态，把 pin 清零，然后拆 266 行 controller」。
> 本文件是**第一阶段（pin 清零）**的完成记录。**266 行拆分尚未开始**（pin 还剩 17 条，见 §6）。

## 0. 结果

| 指标 | 起点 | 现在 |
| --- | --- | --- |
| 总测试 | 89 | **92** |
| `client.js` 行为测试 | 12 | **18** |
| 源码 `assert.match(src)`（06 + interaction） | 48 | **17** |
| 读 `client.js` 的测试文件 | 2 | **2**（06 三处 / interaction 零处） |
| 单测 | 89/89 | **92/92** |
| 补丁 | 38 段 / 4486 行 | **38 段 / 4619 行 / 38/38** |

## 1. 新增 6 条行为测试（每条都做过注入验证）

| # | 覆盖什么 | 注入验证 |
| --- | --- | --- |
| 13 | **凭据写入竞态**：挂住 `credentials.set` → 再 `editKey` → 放行 → 断言新草稿存活 | 删 `savedKeyRefs` 身份守卫 → **1 fail** |
| 14 | **未重编辑的 key 草稿被消费**（savedAt 记时、`configured` 置真） | 删 `savedKeyRefs.set(ref, staged)` 快照 → **1 fail** |
| 15 | **readErrors 分类**：`describe()` 返 `ok:false` + 恶意 message → 只落固定码 | 把 `res.ok === false` 改成 `=== true` → **1 fail** |
| 16 | **metered / keyless 分组互斥**：数 keyless grid 里的 toggle（恰好 4） | 删 `&& !b.metered` → **1 fail** |
| 17 | **`ok:false` 信封被拒**：`credentials.set` 返 `{ok:false}` → 报失败、不置 configured | 把 `rejected` 硬编码为 `false` → **1 fail** |
| 18 | **onEditKey 转发**：键入的 key 真的到达 `credentials.set` | 把 `onEditKey` 改成 `() => undefined` → **1 fail** |

## 2. 过程中我自己犯的 5 个错（全部修好，且都是**测试**的错不是产品的错）

| 错 | 现象 | 根因 | 修法 |
| --- | --- | --- | --- |
| `bootCard` 的 `ctx.get` 恒返回 `undefined` | `written.length === 0`，凭据测试全挂 | `apply` 里 `ctx.get("connection")` 拿不到 fake，`writeCredential` 走「service unavailable」 | `get: (name) => options[name]` |
| `stagedKeys` 当函数用 | `snap.stagedKeys("BRAVE_API_KEY")` → undefined | 投影里它是**对象**（`fromEntries`），只有 `stagedText` 是函数 | 改成 `snap.stagedKeys["..."]` |
| `=== "groupMetered"` 严格相等 | header 找不到 | 渲染树里的 children 被 fake jsx 包了一层 | 改 `String(n.props?.children)` |
| 「metered 混入 keyless」注入后仍 16/16 | **假绿** | 只断言「两个 header 都在」，没断言互斥 | 改成数 keyless grid 的 toggle 数（=4） |
| `failedKeys` 不含 `"rejected"` | 断言失败 | 固定回退串是 `"write rejected"`，**本身含 `rejected`** | 改断言 `=== "write rejected"` |

**第 4 条最值得记**：这是我第二次在同一类问题上栽（第一次是 §112 的渲染断言只数 element）。**「存在性断言」永远不如「计数断言」**。

## 3. 顺带发现并修的一件事

`bootCard` 的 `ctx.get` 恒返回 `undefined` 是**测试基础设施的缺陷**，不是产品缺陷。它意味着：在本次修复之前，任何想测凭据路径的测试都会「因为没写进去而通过」——这是**假绿的结构性来源**。修好之后，凭据路径才真正可测。

## 4. 已删的 pin（按组）

| 组 | 删掉几条 | 替代 |
| --- | --- | --- |
| `save() keeps edits that arrive during in-flight writes` | 4 | 测试 13 |
| `credential failure reasons are redacted` | 4 | 测试 15 |
| `a failed toggle resyncs with the host` | 4 | 早先转换的「failed toggle」 |
| `save() snapshots staged entries before awaiting` | 4 | 测试 13 + 14 |
| `readErrors: fixed-code read failures` | 7 | 测试 15 |
| `metered backends are separate`（METERED/KEYLESS 4 条） | 4 | 测试 16 |
| `res.ok === false` / `throw ... "credential write rejected"` | 2 | 测试 17 |
| `onEditKey: (ref, text) => card.editKey(...)` | 1 | 测试 18 |
| **合计** | **30 条**（48 → 17 差 31，含早先 1 条改写） | — |

## 5. 保留的 17 条（附理由，不是「懒得转」）

| 类别 | 条数 | 为什么必须源码 pin |
| --- | --- | --- |
| **i18n 双字典定义**（`groupMetered` 等 4 键 × 2 语言 = 各定义一次） | 8 | 字典在闭包里；行为测试只能透过 `props.t` 拿键名，**无法断言「zh/en 各定义一次」** |
| **`inject` 数组声明**（`"remote.credentials"`） | 1 | `apply` 的 inject 常量是槽契约，渲染/行为都观测不到 |
| **`findPluginRow` / `cacheKeyFor` / `skipInitialize` / `ApiKeyEnv` 正则** | 8 | 都不在 `client.js`，属别的模块，与本工程无关 |

## 6. **尚未做：266 行 controller 拆分**

我在 §112 里说「pin 清零后就能拆 `CardController` 266 行」，**这个前提现在只成立了一半**：

- ✅ **`client.js` 里与状态机/凭据相关的 pin 已全部转成行为断言**
- ⚠️ 但 17 条里还有 9 条读 `client.js`（8 条 i18n + 1 条 inject）—— 它们**不阻碍拆 controller**（i18n 字典和 inject 常量不在 controller 里），但**会阻碍**把 `zh`/`en` 字典或 `apply` 搬到别的文件

⇒ **`UnifiedSearchCardController`（266 行）和 `UnifiedSearchSection`（176 行）现在都可以拆了**，只要不搬那两个东西。

## 7. 验收

| 项 | 结果 |
| --- | --- |
| 单测 | **92/92** |
| 38 段逐字节 | **38/38** |
| `refresh.sh` | 38/38 byte-identical（双份 `93b8a1306005`） |
| dev 3081 | health **200**（enabled=6, backends=13） |
| 主实例 3080 | active PID 3830346，**未重启** |
| 提交 | `0e9f9b3` |

## 8. 结论（A–E）

- **A**：92/92、38/38、6 条新测试、6 次注入验证全是实测。
- **A**：`bootCard` 的 `ctx.get` 缺陷是结构性假绿来源，已修。
- **A**：两次「存在性断言」假绿（§112 的渲染、本轮的 metered）都已改成计数断言。
- **B**：剩余 17 条 pin 里 9 条读 `client.js`，但不阻碍拆分（不在目标函数内）。
- **C**：拆 266 行时若不慎搬动 `zh`/`en` 字典或 `apply`，会立刻挂 9 条 pin。
- **E**：真机浏览器渲染仍未验证（fake react 而非真 reconciler）。

---
无凭证值写入本文件。
