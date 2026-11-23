# 110 · S1 计划的执行结果（2026-11-23）

> S1 专家这次**补完了**（268 行，非骨架），给出三批计划。Lead 逐批执行、实测、并**否掉了一批**。

## 1. 批 0：`refresh.sh` 只核 35 项而补丁有 37 段 —— **真漏洞，已修**

S1 发现：`g5/refresh.sh` 的 `MOD` 清单列了 35 项，但权威补丁实际有 **37 段** ——
`lib/trust.js`（上一轮新增）与 `tests/relink-test-deps.sh`（早先新增）**从未被逐字节核对**。

**Lead 复核**：`grep MOD` 清单里确实没有这两个文件；`grep '^diff --git'` 确认补丁里确实有两段。
⇒ **S1 这条判断成立**，而且这是「假绿」风险（脚本报 35/35，实际有两段没验）。

**修法**：`MOD` 补 `lib/trust.js` + `tests/relink-test-deps.sh`；`:37` 的 `$n/35` → `$n/37`；`:38` 的 `[[ $n -eq 35 ]]` → `-eq 37`。

**修后实测**：

```
G5-authoritative.patch: 4193 lines, 37 segments, 37/37 byte-identical
both copies identical: 479bc9c8e40e
```

⇒ 那两段现在**也被核对**了，脚本不再能报假绿。

## 2. 批 1：`index.js` 573 → 558（**−15**）—— 采纳并执行

S1 给的两处：

### ① `toggleMap` 16 行 → 派生键

```js
// 之前：16 行手写映射
const toggleMap = { exa: config?.enableExa, parallel: config?.enableParallel, ... };
enabledBackends = ALL_BACKENDS.filter((id) => toggleMap[id] === true);

// 之后：1 行注释 + 1 行 filter
enabledBackends = ALL_BACKENDS.filter((id) =>
  config?.[`enable${id.charAt(0).toUpperCase()}${id.slice(1)}`] === true);
```

**Lead 的独立验证**（这是关键，不是照抄）：

1. 核 13 对映射：`exa→enableExa` … `searxng→enableSearxng`（注意 `searxng.capitalize()` 是 `Searxng`，与 schema 里的 `enableSearxng` 逐字相同）—— **13 对全部对应**
2. 核 Config schema 里这些键真的存在（`index.js:207 enableExa: z.boolean()...`）—— 不能瞎映射
3. **14 组开关组合逐组对照**（空 / 全开 / 13 个单开）新老实现在 `resolveOptions()` 上的输出：

```
14 组开关组合（空/全开/13 单开）全部一致: ✅
```

### ② `cache: { get, set }` 包装 → `cache: searchCache`

**先核 provider 的用法**：只有 `cache.get`（`:275`）×1 与 `cache.set`（`:509`/`:550`）×2，**没有任何其它方法**（`.clear`/`.delete` 都没用）。

⇒ 包装纯粹是 indirection，直接传 store 即可。

### 合计

| | 前 | 后 |
| --- | --- | --- |
| `index.js` | 573 | **558**（−15） |
| 断言影响 | — | **0**（无源码 pin 这两段） |

S1 估 −16，**实测 −15**（它在 ① 里多算了一行注释）。

## 3. 批 2：`provider.js` 结果头 → `withResultHeader()` —— **实测净增，已回滚**

S1 说「582 → 581（−1）」。**Lead 实际做出来是 594 行（+12）**，压缩 JSDoc 后仍 **588（+6）**。

原因：两处各 3 行代码（各 6 行）→ 换成 1 处 9 行 helper + 2 处各 1 行调用：

```
两个 log 语句 6 行 → helper 12 行（含 JSDoc）+ 2 行调用 = +6~12 行
```

**判定：回滚**（`provider.js` 恢复 582 行 / md5 `877b1943`）。这是本轮第三次遇到同一件事 ——
**提取的固有成本（函数签名 + 闭合 + return + JSDoc）在小片段上永远亏**。

## 4. 采纳 S1 的「不做」清单（全部复核成立）

| 项 | S1 理由 | Lead 复核 |
| --- | --- | --- |
| `UnifiedSearchCardController` 266 行 | 23 条源码 pin | **实测该 class 是 294–559 = 266 行**（S1 名称简写但坐标对）；`client.js` 无 node 测试，但有 4 个测试文件读它 |
| 跨文件拆 `provider` | `quota:81` 在整份 `provider.js` 里找子串 | 成立：`lead-20261108-quota.test.js` 有 10 条 `assert.match(src,...)` 读 `provider.js` |
| `anthropic-like` / `cache` 拆分 | 动了只扩大分叉面 | 与 109 号结论一致 |
| 6 个巨型函数只有 `index.js` 两处值得动 | — | **采纳**，正是批 1 |

S1 的**断言账**（102 语句 / 105 模式应用，其中 94 读整份 lib 源、3 读切片、5 运行时）比 Lead 上一轮统计的 49 条更细 —— 它统计的是「模式应用次数」而非「断言条数」，**两个口径都对，用途不同**。

## 5. 总账

| 指标 | 本轮开始 | 本轮结束 |
| --- | --- | --- |
| `lib/` 总行数 | 6104 | **6089**（**−15**） |
| `index.js` | 573 | **558** |
| `provider.js` | 582 | 582（批 2 回滚） |
| 单测 | 81/81 | **81/81** |
| 补丁 | 37 段 / 4165 行 / 35 项核对 | **37 段 / 4193 行 / 37 项核对** |
| dev 3081 | — | health **200**（enabled=6, backends=13） |
| 主实例 3080 | — | active PID 1414284，**全程未重启** |

## 6. 结论（A–E）

- **A**：批 0 的漏洞（35 vs 37）是 grep 实测；修后 `37/37 byte-identical`。
- **A**：批 1 的 `index.js 573→558` 与 14 组开关组合一致性是实测。
- **A**：批 2 的净增（+12/+6）是实测，S1 的 −1 估算有误。
- **B**：S1 的断言账（105 模式应用）与 Lead 的（49 条）口径不同但都成立。
- **C**：`UnifiedSearchCardController` 266 行是否该拆，取决于是否愿意先做「源码 pin → 行为断言」转换。
- **E**：真 seam 端到端（`web_search` 走 SDK 路径）本轮用 dev 3081 health 验证，未走完整 tool 调用。

## 7. 一句话

**S1 这轮做对了三件事**：抓到 `refresh.sh` 的 35-vs-37 假绿漏洞（真 bug）、找到 `index.js` 唯一值得动的 −15 行、明确画出「跨文件即断崖」的断言账。**唯一失手的是批 2 的 −1 估算**（实际 +6）—— 而这也再次证明：小片段提取在本项目里永远是净增。

---
无凭证值写入本文件。
