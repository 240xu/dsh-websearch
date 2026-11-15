# 89 · B1 源码级发现与 D5 裁决再修订（2026-11-15 22:30）

> B1 顾问在 22:25 发来源码级早期发现，推翻了 86/88 号里「D5 无法最小落地、复议为产品语义取舍」的结论。Lead 用 GitHub API 独立复核后落本号。**只评估，未改代码/运行时。**

## 1. B1 的三条发现（逐条复核）

### ① 7 个同类仓库元数据 + 源码已核实，不再是 E

B1 用认证 GitHub API 核实 7 个仓库**全部 MIT**；`f0909172434/dsh-plugin-verified-search` 是 **301 → `Chih-Kai-Wang/dsh-plugin-verified-search`**（MIT）。它读到了源码：

| 项目 | 源码级亮点 |
| --- | --- |
| `liustack/modsearch` `cooldown.ts` | 持久化 `state.json`、per-key `::key:N`、45min/24h 双窗口、原子并发合并；**`classifyQuota` 明确把 429 每秒限流排除在冷却外，只冷却 432/433 月度预算** |
| `modsearch` `router.ts` | `reorderByCooldown` 把冷却引擎**移到队尾而非排除**（我们 3b 是「排除」，这是另一种取舍） |
| `chendefine/...aggregation` `provider.ts` | 优先队列 + `AttemptFailure` 全失败摘要 + **Key Rotation 游标** |
| `keys.ts` / `config.ts` | 逗号 key 池 + `maskApiKey`；`.volatile` 实时生效 |
| `jwilson411/dsh-ssrf-guard` `src/ssrf.js` | `SSRF_DENIED` **稳定 code** + 7 个 reason token，自认不是 DNS-rebinding 保护 |
| `Chih-Kai-Wang/dsh-plugin-verified-search` `src/domains.ts` | `VERIFIED_SEARCH_INVALID_FILTER` 稳定 code |

⇒ 83/86/87 号里把这些标为「E / 未读源码」的部分**应升级为 A/B**；尤其「稳定 code 而非 message」与我们 `webErrorFromResponse` 的错误契约同向，是跨项目共识。

### ② D5 **可以最小落地**，不需要 sessionID（决定性）

Lead 用 GitHub API 拉 PR #47334 的 `packages/core/src/websearch.ts` diff 逐行核实：

```
行 31:  const cooldowns = new Map<ID, { until, error }>()        ← layer 作用域，全局
行 73:  randomProvider(now, affinity, attempted?)                 ← 同时用 cooldowns + attempted
行 130: const affinity = preferred.get(options?.sessionID)        ← per-session
行 135: const attempted = new Set<ID>()                           ← query() 内部，per-query 局部
行 140: attempted.add(provider.id)
行 151: cooldowns.set(provider.id, cooldown)
```

⇒ **`attempted`（本次尝试过哪些）是 per-query 局部，`cooldowns` 才全局**。B1 的结论成立：我们不必注入 `Session.ID`，可以把 **3b 的「全配额快速失败」判决绑定本次 `search()` 的局部失败集合**；全局 `latestBackendHealth` 只用于「跳过单后端 + health/history 可观测」。

**这同时化解了 A2 对候选③的担忧**：A2 说「3b 只用本次失败会让上次刚打进冷却、本次还没发请求的场景失去快速失败」——但按 PR 的形态，全局冷却**仍决定跳过**，所以那些后端根本不会进 eligible；快速失败只在「本次确实没有可用后端且本次失败全是配额类」时触发，不会退回 V3 之前「全冷却 fail-open 重打限流端点」。

**当前代码证据**（`lib/provider.js`）：`allFailures = []` 定义在 `search()` 内（:456，本次扇出局部），而 3b 快速失败在**扇出之前**读模块级 `latestBackendHealth`（:321-340）⇒ 正是 D5 的根因：把「别的会话/上次搜索的结果」当成本次判决依据。

### ③ 87 号把 verified-search 当「SSRF 出网边界」是误读

B1 指出其 README 明写「allowlist 是**返回来源的 hostname 后过滤**，不是 network-egress or privacy boundary」。⇒ 87 号「照搬会误伤我们 RFC1918 plain-http baseURL trust gate」的**结论仍对**（不该照搬），但**理由应修正**：它不是出网边界，而是结果侧来源过滤，与我们的 baseURL trust gate 根本不是同一层。

## 2. D5 裁决再修订（覆盖 86/88 号）

| 版本 | 结论 |
| --- | --- |
| 86 号初版 | ② 分离全局冷却与会话判定，**推荐** |
| 86/88 号 22:20 更正（A2 终版） | 单进程单例 + 无 sessionID ⇒ **无法最小落地，复议为产品语义取舍** |
| **本号（B1 源码级 + Lead 复核）** | **可以最小落地**：3b 判决绑定本次 search 的局部失败集合，全局冷却只用于跳过单后端 + 可观测。仍属**动核心执行语义**，需用户点头，但不再是「无法落地」或「产品语义取舍」 |

**最小改动**：`lib/provider.js` 一处 —— 把 3b 快速失败的判定数据源从 `latestBackendHealth`（模块级）改为本次 search 的局部集合；`tests/lead-20261109-3b-runtime.test.js` 加双会话断言。不动 health/history/settings API、不动磁盘格式、不动 Config。

**验收命令**：真 provider 双会话（A 全 429 → B 不被 3b 拒绝且真扇出；A 自身仍快速失败）+ `3b-runtime.test.js` 2/2 + 全量 81→83 + 35 文件同步 + 重启 + 三 API + `web_search`。

## 3. 抄取清单的净变化

- **升级为值得抄**：`modsearch` 的 `classifyQuota`「429 每秒限流 ≠ 432/433 月度预算」这一**区分**（我们 `webErrorFromResponse` 把 429 与 402 都归 `rateLimited=true`，没有区分「短期限流」与「月度预算耗尽」的冷却时长）；`reorderByCooldown` 移到队尾而非排除（3b 混合故障的另一种解法）。
- **维持不抄**：升级 2.8.8、替换整行 web config、照搬 Effect/Session.ID、有序 fallback 替换全并发 RRF。
- **理由修正**：verified-search 是结果侧来源过滤，不是出网边界。

## 4. 待用户点头

1. 是否按本号 §2 落地 D5（动 3b 判定数据源）；
2. `history/clear` 删整文件（A2 发现）是否改产品语义；
3. 对外 PR / publish / rc.3（88 号四类裁决不变）。

---
无凭证值写入本文件；PR diff 逐行证据可由 `GET /repos/anomalyco/opencode/pulls/47334/files` 复现。
