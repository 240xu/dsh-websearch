# 98 · 代码冗余与死代码审计（P2 骨架 → Lead 工具实测补完，2026-11-23）

> P2 专家落盘 51 行骨架后未补完；Lead 用**解构感知的静态扫描 + 上游 tarball 对照**补完。
> 结论：**可安全删除的死代码 = 0 行**；真正的冗余是 4 处结构性重复（已处理 3 处）。

## 1. 未使用的导出

扫出 **34 个「零外部引用」导出**（107 个导出中），但逐条对照上游 npm 2.8.4 tarball 后：

| 类别 | 数量 | 判定 |
| --- | --- | --- |
| **上游原有**（我们只是保留了它的 `export`） | **27** | **不能删** —— 删了会让补丁与上游分叉更大，升级 rebase 时冲突更多 |
| 文件内部仍在用（只是没别处引用） | 6 | 只需去掉 `export` 关键字（但会让 G5 补丁多 6 段噪声，**收益 < 成本**） |
| 完全未用且上游没有 | **0** | 无 |

**逐条核对证据**（`grep -c` 上游 tarball）：

```
QUERY_GUIDANCE_EN/ZH      上游 1 次 → 上游原有
isLoopbackHost           上游 1 次 → 上游原有
connectionAdmissionView  上游 1 次 → 上游原有
structuralRejection      上游 1 次 → 上游原有
abortable                上游 1 次 → 上游原有
getBackendBreaker        上游 1 次 → 上游原有
```

⇒ **死导出裁剪净收益为负**，建议 0 删除。

## 2. 未使用的参数 / 变量

第一版脚本报 4 条，**全部是解构参数误报**（脚本正则不认 `{ query, filters, ... }`）。改用解构感知的扫描后：

```
真正未使用的顶层 export 函数参数: 0
```

（复核：`cache.js:39` 的 `resultOptions` 在函数体内被读；`health.js:45` 的 `getBackendHealth` 在 `:47` 被读。）

⇒ **0 个未使用参数**。

## 3. 重复实现（本节是实际可做的）

### 3.1 ✅ 已修：4 处 `history.record` → `recordHistory`（B1，−12 行）

`provider.js` 的 cache 命中 / 有结果 / 成功但 0 结果 / 全失败，四处形状完全相同。

### 3.2 ✅ 已修：`allTelemetry.filter(t => t.ok).length` 重复 3 次 → 算一次 `okCount`

### 3.3 ✅ 已修：`rejectionFor` 的错误体在 health/history/settings-api 逐字重复 → `trust.js` 的 `rejectionBody(code)`

### 3.4 ❌ **不能**合并 `sendJson`（实测反证）

| 文件 | 签名 | 响应头 | 守卫 |
| --- | --- | --- | --- |
| `health.js:102` | `send(code, body)` | `application/json` | 无 |
| `history.js:136` | `send(res, code, body)` | `application/json` | 无 |
| `settings-api.js:281` | `sendJson(res, status, payload)` | `application/json; charset=utf-8` + **`cache-control: no-store`** | **`writableEnded` 守卫** |

三者参数签名、响应头、守卫全不同。合并会让 settings **丢掉 `no-store`**（缓存敏感响应被浏览器缓存 = 安全退化）。

### 3.5 ✅ 已修：`provider.js:515` 两段注释叠在一起（残留）

```js
// The cooldown set was captured at fan-out start. Recomputing with
// Date.now() here (after every backend returned) can find the
// window already expired and emit a bare "⏸cooled" for a backend   ← 半句话
// The note is anchored to fan-out time. If the window expires      ← 第二段开始
```

这是 65 号 A.8 修法落地时把旧注释删了一半留下的残片。**已合并成 3 行完整注释，provider.js 585 → 582 行**。

## 4. 死分支 / 不可能路径

| 位置 | 情况 | 判定 |
| --- | --- | --- |
| `typeof x === "function"` 守卫（`health.js:47`、`history.js:153`、`settings-api.js:96`） | 调用点总传函数 | **保留**：这些是 host 注入的 deps，测试与生产都可能传 Map 而非函数（已有测试覆盖两种） |
| `catch { /* nothing to do */ }`（`history.js:92`、`cache.js` 多处） | 故意吞掉 fs 错误 | **保留**：fail-soft 是设计（磁盘故障不该破坏搜索） |
| `searxng.js` 的死 `if` | 65 号提过 | 属**上游代码**，删了会扩大分叉 ⇒ 保留 |

## 5. 注释冗余

扫描「>5 行连续 `//`」：**27 块 / 260 行**。逐块对照上游 tarball：

- **上游原有：183 行**（不属我们的冗余）
- **我们新增：73 行**，其中真正可删的只有 §3.5 那 2 行残片（其余是契约说明：Host 头为什么必须补回、M-1 为什么 id=1 会撞车、cooled 为何用扇出时刻 —— 都有防止后人「改回去」的价值）

## 6. 测试冗余

- 8 个测试文件 / 81 test / 279 assert，其中 **80 条是 `assert.match(src, ...)` 源码级断言**。
- 这些不是冗余，是「防止有人悄悄改回已修 bug」的护栏（例如 pin 住 11 处 `webErrorFromResponse`、pin 住 `id: 2 : 3`）。
- **不建议合并**：合并会降低定位精度。

## 7. 总可删行数估算（最终）

| 项 | 行数 | 状态 |
| --- | --- | --- |
| `history.record` 4→1 | −12 | ✅ 已做 |
| 叠注释残片 | −2 | ✅ 已做 |
| 死导出 / 死参数 / 死分支 | 0 | ❌ 净收益为负 |
| `sendJson` 合并 | 0 | ❌ 安全退化 |
| **合计** | **−14 行**（6104 → 6090） | 待本轮最后一次统计 |

## 8. 无法验证 / E 级

- 27 个上游导出的「未来用途」无法判断（可能给 host 或扩展留的）。
- `client.js` 的 UI 冗余见 [100 号](100-client-audit.md)（本轮另一路专家，骨架未补完）。

## 9. 结论

- **A**：未用导出/参数/分支的「零」是工具实测 + 上游对照，不是估算。
- **A**：3 处结构重复已提取，81/81 单测仍全绿。
- **B**：`sendJson` 不可合并有逐字段证据。
- **C**：注释冗余的「新增 73 行」中，除残片外均有防回归价值。
- **E**：上游导出未来用途。

---
无凭证值写入本文件。
