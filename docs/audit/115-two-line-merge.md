# 115 · 两线代码校准合并 + 全量回归（2026-11-25）

> 用户「核对两线代码，校准合并，开端口完成全量回归验证」。
> 两线：`main`（上游 2.8.8，30 lib 文件）vs `local-audit-35files-20261115`（2.8.4 + 38 段补丁，33 lib 文件）。

## 0. 结果

| 项 | 结果 |
| --- | --- |
| 合并树 | **34 lib 文件 / 6558 行**（我们 6129 / main 5432） |
| 三方合并冲突 | 6 处（provider 4 / ddg 1 / searxng 1）—— **全部手工合成** |
| 单测 | **95/95** |
| 端口回归 | **3082**（合并树 + 独立 `DSH_HOME`）：root 200 / health 200 / 真搜索 **6 sources** |
| 其它端口 | 3080（2.8.4 树）401 / 3081（dev）401 —— **均未受影响** |
| 分支 | `merge/upstream-288-plus-fixes`（`7042161`），已推送 |

## 1. 差异矩阵（29 个共有文件）

| 类别 | 文件 | 判定 |
| --- | --- | --- |
| **identical**（7） | `util/filters.js` `prompting.js` `util/rank.js` `multiquery.js` `rrf.js` `util/log.js` `util/abort.js` | 直接取 |
| **仅我们有**（4） | `util/web-error.js` `util/namespace.js` `backends/firecrawl.js` `backends/tinyfish.js` | 保留 |
| **仅 main**（1） | `util/describe-error.js` | 采纳（searxng/backends 依赖它） |
| **A 类：上游大改** | `util/egress-fetch.js`（362→477）· `backends/searxng.js`（122→224）· `history.js` · `health.js` | 采纳上游 + 保留我们的修复 |
| **B 类：我们重写** | `util/failure-label.js`（60 vs main 40） | 合并两者 |
| **C 类：两边都改** | `provider.js`(17 hunk) `index.js`(14) `client.js`(22) `settings-api.js`(9) `mcp-client.js`(9) 等 | 三方合并 |

**语义标记对照**（合并后同时具备两侧特性）：

| marker | ours | main | merged |
| --- | --- | --- | --- |
| `webErrorFromResponse` | 25 | 0 | **25** |
| `keylessRejected` | 8 | 0 | **8** |
| `sessionCacheKey` | 3 | 0 | **3** |
| `rejectionBody` | 7 | 0 | **7** |
| `describeError` | 0 | 16 | **16** |
| `failureLabel` | 0 | 3 | **3** |
| `ANTI_BOT_RE` | 0 | 2 | **2** |
| `INSTANCE_COOLDOWN` | 0 | 2 | **2** |
| `DSH_EGRESS_FORWARDER` | 0 | 8 | **8** |

## 2. 六处冲突的裁决（每处都写明了理由）

| # | 文件 | 冲突 | 裁决 |
| --- | --- | --- | --- |
| 1 | `provider.js:39` | `BACKEND_TIMEOUT_OVERRIDES_MS`：我们 ddg/searxng 都 8s，main 是 ddg 8s / **searxng 5s** | **取 8s**。上游把 searxng 降到 5s 是因为配了多实例 failover（快失败更划算），但我们的公共实例本身慢，5s 会掐断 |
| 2 | `provider.js:422` | 超时分类 | **合成**：main 的 `timedOut` 抛 `WebError` + 我们的 `recordBackendHealth` 带 3 个诊断字段（`rateLimited`/`keylessRejected`/`retryAfterMs`） |
| 3 | `provider.js:585` | 失败详情 | **取 main** 的 `MAX_FAILURE_DETAILS` + `+N more`（我们的 4 条截断是旧版）；**但我在第一次合成时误删了这个 `detail` 定义**，后来补回 |
| 4 | `provider.js:606` | `recordHistory` vs `cooledNote` | **两侧都要**（不同功能） |
| 5 | `backends/ddg.js:60` | `describeError` vs 结构化错误不重包 | **合成**：`describeError(err)` 记录 + `if (err instanceof WebError) throw err` |
| 6 | `backends/searxng.js:73` | 整个 fetch 块 | **取 main 重写**（语义健康判定 + 反爬分类 + 多实例 failover），但把两处 `new WebError` 换成 `webErrorFromResponse` 保留 `status/retryAfter/rateLimited` |

## 3. 决定性修补：让 forwarder 分支 fail-open

**问题**：合并后 `egress-fetch.js` 有了 main 的 `DSH_EGRESS_FORWARDER` 分支。本机 `172.30.0.1:13070` **无监听**，服务 environ 里**却设了这个变量** ⇒ 每个请求要等 ~20s 才 reject，而 ddg 8s 就超时 ⇒ **整个 provider 挂**。

**第一次尝试失败**：在 `egressFetch` 加 `catch` + 自我禁用 —— **来不及**，20s > 8s 后端超时。

**最终方案**（`forwarderUsable` + `probeForwarder`）：

```js
function forwarderUsable(endpoint) {
  const probe = forwarderProbes.get(endpoint);
  if (probe?.ok) return true;
  if (probe && Date.now() - probe.at < 60_000) return false;
  forwarderProbes.set(endpoint, { ok: false, at: Date.now() });
  probeForwarder(endpoint);   // 异步 net.connect，2s 超时
  return false;               // 未知 ⇒ 本次走 proxy（fail-open 优先）
}
```

**设计要点**：`forwarderFor()` 必须同步，所以**首次调用故意返回「不可用」** —— proxy 路径永远正确，而死 sidecar 每个请求要 20s。探测成功后缓存 60s；失败也缓存 60s（sidecar 后起也能被拾取）。

**双向验证**：

| 场景 | 结果 |
| --- | --- |
| `DSH_EGRESS_FORWARDER` 指向死端口（13070） | `egressFetch` → **HTTP 200**（回落 proxy） |
| 指向活端口（起假 forwarder 在 13072） | 假 forwarder **命中 1 次**（第 2 次请求切过去了） |
| 完全没有该 env | **HTTP 200** |

## 4. 全量回归证据

| 环节 | 结果 |
| --- | --- |
| `node --test tests/*.test.js`（合并树） | **95/95** |
| `egressFetch` 三种 env 场景 | 全 200（见上表） |
| **3082 实例**（合并树 + 独立 `DSH_HOME=/home/dsh/.dsh-merge`） | root **200** / health **200**（enabled=6, backends=13） |
| 3082 实装 `provider.search()` 真搜索 | **6 sources**，首条 `rust-lang.github.io/async-book`，telemetry 行存在 |
| 3080（当前生产 2.8.4 树） | **401**（未受影响，未重启） |
| 3081（dev） | **401**（未受影响） |

## 5. 过程中我犯的 4 个错（都已修）

| 错 | 后果 | 修法 |
| --- | --- | --- |
| 用 `re.sub` 删冲突块 | 把 `BACKEND_TIMEOUT_OVERRIDES_MS` 整个定义删了 | 手工补回 |
| 冲突 3 取 main 的 `cooledNote` 时**丢了 `detail` 定义** | 真搜索时报 `detail is not defined` | 补回 `MAX_FAILURE_DETAILS` 那段 |
| 冲突 3 与冲突 4 **各插了一次 `cooledNote`** | `Identifier 'cooledNote' has already been declared` | 删重复 |
| `forwarderReachable` 用 `require()` | ESM 里不可用 | 改成 `net.connect` 异步探测 |
| 从 `failure-label.js` 提取 `failureLabel` 用了「到下一个 export」 | 只截到 4 行注释，函数体丢了 | 改用花括号计数精确定位 |

**第 2 条最关键**：它逃过了 95 个单测（因为单测不跑真实扇出），只有**真搜索**才暴露。这印证了「端口回归不可省」。

## 6. 仍存在的限制（诚实登记）

1. **GitHub 仍拒绝 PR**：`No common ancestor between main and merge/upstream-288-plus-fixes.` —— 合并树依然是基于 2.8.4 tarball 的 orphan 历史。工作已在 `merge/upstream-288-plus-fixes` 分支上，**可 clone / 可 diff / 可作为 GitHub Release 附件的来源**，但无法作为 PR 合入 main。
2. **3082 需要独立 `DSH_HOME`**：`/home/dsh/.dsh-merge` 是硬拷贝 profile + 合并树，`@deepseek-ai/dsh-web` 是软链到 `/opt/dsh-0222`。这套只在调试用，不是生产部署。
3. **未测**：真机浏览器渲染（client.js 只跑了 fake react）；forwarder **活着**时的真实转发（只验了命中计数，没验返回内容）。

## 7. 结论（A–E）

- **A**：差异矩阵、6 处冲突裁决、95/95、3082 三段 200、三种 env 场景都是实测。
- **A**：合并后两侧语义标记（9 个）全部同时存在。
- **A**：`detail is not defined` 只在真搜索暴露 —— 单测覆盖不到的缺口已记。
- **B**：searxng 取 main 重写是对的（它比我们的 122 行完整得多），但「两处 `new WebError` → `webErrorFromResponse`」是我们的判断。
- **C**：`failure-label.js` 91 行（60 我们 + 30 main）是否该精简，取决于 `failureLabel` 与我们的 `rateLimited` 是否真互补。
- **E**：forwarder 活着时的真实转发内容未验。

---
无凭证值写入本文件。
