# 122 · 2.8.8 落地：GUI 更新失败修复 + 兼容性验证（2026-11-26）

> 用户截图：GUI「更新到 2.8.8」失败，报
> `ERR_PNPM_UNUSED_PATCH ... patches were not used: @240xu/dsh-websearch@2.8.4`
> 并追加要求：**「注意插件代码对最新版的兼容」**。

## 0. 截图根因（已修）

`ERR_PNPM_UNUSED_PATCH` 的真正原因不是网络也不是版本冲突，而是**补丁键与 pin 分家**：

```
patchedDependencies: '@240xu/dsh-websearch@2.8.4'   ← 键钉在 2.8.4
package.json pin:      '2.8.8'                       ← 插件管理器改成了 2.8.8
```

pnpm 解析到 2.8.8 后，发现 `@2.8.4` 这个补丁键**没有匹配的包** ⇒ 拒绝安装 ⇒ 2.8.4 和 2.8.8 都没装上（截图里的「停止并移除 2.8.4」）。

**修法**：补丁必须**基于干净 2.8.8 重新生成**，键与 pin 同步到 2.8.8。

## 1. 做了三件事

### ① 生成「干净 2.8.8 → 我们的修复」补丁

用三方合并（base = npm **2.8.4** tarball，ours = 已有的合并树，theirs = 干净 **2.8.8**）在 34 个 lib 文件上重建，产出 `patch-288.patch`：

```
26 段 / 2898 行
```

**验证**：apply 到干净 2.8.8 后与 merge288 树**逐字节 34/34 相同**。

### ② 解 10 处冲突（全部有理由）

| # | 文件 | 冲突 | 裁决 |
| --- | --- | --- | --- |
| 1 | `provider.js:40` | searxng 超时 8s（我们）vs 5s（2.8.8） | **8s** —— 2.8.8 降 5s 是配了多实例 failover，我们的公共实例本身慢 |
| 2 | `provider.js:423` | 超时分类注释 | 取 2.8.8（更完整的 `route6 P6` 说明） |
| 3 | `provider.js:435` | `recordBackendHealth` 三参 vs 四参 | **取我们**（带 `rateLimited`/`keylessRejected`/`retryAfterMs`） |
| 4 | `provider.js:584` | `recordHistory` vs `cooledNote` | **两侧都要** |
| 5 | `provider.js:612` | 同上（重复冲突） | 合并为一处，note 用 `nowMs` |
| 6 | `backends/ddg.js:61` | `describeError` vs `WebError` 不重包 | **合成**：2.8.8 的 `describeError` + 我们的守卫 |
| 7 | `backends/searxng.js:109` | 整块（2.8.8 把 `queryInstance` 写在文件尾） | **取我们**（保 `webErrorFromResponse`）；删 2.8.8 的 94 行重复 |
| 8 | `util/egress-fetch.js` ×3 | 2.8.8 侧全为空 | **全取我们**（`forwarderUsable`/`probeForwarder` fail-open 探测） |
| 9 | `util/failure-label.js` | 2.8.8 只有 40 行 | **取我们 91 行**（含 `failureLabel`，与 2.8.8 逐个 diff 后确认一致） |
| 10 | `util/describe-error.js` | 仅 2.8.8 有 | **采纳**（searxng/backends 依赖） |

### ③ 落地到 profile + 修 patch 键

```
patchedDependencies: '@240xu/dsh-websearch@2.8.8': patches/@240xu__dsh-websearch@2.8.8.patch
package.json pin:     2.8.8
实装:                  2.8.8（lib 34 文件，与 merge288 逐字节 34/34）
```

备份：`src-work/backups/profile-288-landing-20261126T104318/`（package.json / workspace.yaml / lock / 旧 2.8.4 patch）

## 2. 验证矩阵

| 项 | 结果 |
| --- | --- |
| 补丁 apply 到干净 2.8.8 | ✅ `git apply --check` 通过 |
| apply 后 vs merge288 树 | **逐字节 34/34** |
| merge288 树单测 | **97/97** |
| 安装副本 vs merge288 树 | **逐字节 34/34** |
| 安装副本单测（src-work 结构） | **97/97** |
| 真搜索（parallel backend） | **6 sources**，首条 `rust-lang.github.io/async-book`，telemetry 行正常 |
| 语义标记（2.8.8 侧） | `describe-error` 6 · `failureLabel` 3 · `ANTI_BOT_RE` 2 · `INSTANCE_COOLDOWN` 2 · `DSH_EGRESS_FORWARDER` 8 |
| 语义标记（我们的） | `webErrorFromResponse` 25 · `keylessRejected` 8 · `rejectionBody` 7 · `sessionCacheKey` 3 |
| `pnpm install` 输出 | `- @240xu/dsh-websearch 2.8.4` → `+ @240xu/dsh-websearch 2.8.8`（**不再报 UNUSED_PATCH**） |

## 3. 顺带发现并修的两个真 bug（本轮之前）

| bug | 表现 | 修法 |
| --- | --- | --- |
| **telemetry 双重注解** | fail-open 把非配额冷却后端放回扇出，其失败已在 telemetry 列表里，冷却循环又打印一次 ⇒ 同一行出现 2 次 | `cooledParts` 跳过 `ranIds` 里已有的后端 |
| **`resultHeader: false` 不生效** | provider 无条件加 header，settings 开关形同虚设 | 两处 `if` 都加 `opts.resultHeader !== false` 门 |

两者都加了回归测试（97/97 里包含）。

## 4. A6 子代理的关键修正（已采纳）

`agent-17` 实测纠正了我任务书里的三处数字，并给出可搬性三分：

- **可直接搬**（0 改动）：`parse`(28) `filters`(10) `rank`(9) `rrf`(7) `p1-regression`(5) `health`(4) `store-dir`(3) `v281-form`(3)
- **需改断言**：`v286-failures`（计数 5→6）、`history`（`await clear()`）、`egress-fetch`（4 条需先探活预热）、`v27`（fail-open 第 4 次仍调用）、`v28`/`v28-p2`（`min(hostCap,userMax)` 压回 / searxng 5000→8000）
- **不可搬**：`breaker`（我们加了「过期窗口重置连击」）、`cache`（摊还淘汰 vs 精确 `maxEntries`）
- **CHANGELOG 值得搬**：294 行，记的正是本树的因果（forwarder 改走 `node:http`、20s 独立上限、SearXNG 200 无 `results[]` 不算成功、`searxngBaseURLs` failover、DDG 5→8s 实测依据）
- **package.json**：没有任何 2.8.8 有而我们缺的字段（peer 6 项 / files / engines / exports 全同）
- **`cordis.patch.yml`**：UP / OUR / MERGED **逐字节相同** ⇒ 加载不受合并影响

## 5. 一个必须说清的误判

我一度以为「插件损坏」，因为从 profile 目录 `import()` 报 `Cannot find package '@deepseek-ai/dsh-credentials'`。

**这是测试方式的问题，不是插件问题**：cordis loader 用 `createRequire(import.meta.url)`（在 `/opt/dsh-0222/node_modules/@deepseek-ai/cordis-plugin-loader/lib/`）解析依赖，所以能拿到 `/opt/dsh-0222/node_modules/@deepseek-ai/dsh-credentials`。直接 `import` 文件路径走的是「文件所在位置」解析，拿不到。

实测验证：

```
createRequire('/opt/dsh-0222/node_modules/@deepseek-ai/cordis-plugin-loader/lib/index.js')
  .resolve('@deepseek-ai/dsh-credentials')
→ /opt/dsh-0222/node_modules/@deepseek-ai/dsh-credentials/lib/index.js
```

## 5.5 A1 复审抓到的 P0（已修并验证）

`agent-12` 指出我在 7042161 里新加的 `forwarderUsable` 探测闸门是**真回归**：

> `if (!forwarderUsable(endpoint)) return undefined` 让每个 endpoint 的**第一次请求永远走不到 sidecar**，
> `ok:true` 后**永不回探、也不回落代理**。这把 2.8.5/2.8.6 的 JA3 修复在「进程刚起第一搜」这个
> 最需要它的位置关掉了。实测同桩连发两次：UP `sidecarHits=2 proxyHits=0`；MERGED `call#1 走代理、call#2 才用 sidecar`。

**根因**：我把「探针未知」当成「不可用」。上游从不这样做。

**修法（两条）**：

1. **C1**：未知/过期一律**乐观**返回 `true`，后台探测只用于「已确认死掉则退休 60s」。
2. **C2**：`forwarderFetch` 传输失败时**回落代理一次**。但只对「确实没东西在那」的错误码
   （`ECONNREFUSED` / `EHOSTUNREACH` / `ENETUNREACH`）；**`stalled sidecar`（`did not respond within Nms`）
   必须原样抛出**，否则会把「sidecar 坏了」粉饰成成功。

**双向验证**：

| 场景 | 结果 |
| --- | --- |
| sidecar 活（假服务 13081） | 第 1 次就 `sidecarHits=1`（不再是先走代理） |
| sidecar 死（无监听 13082） | **200 in 1.2–1.5s**（回落代理成功） |
| sidecar 停滞（接受但不响应） | 正确抛 `forwarder did not respond within 300ms`（不回落） |

**C3**：把上游 `tests/egress-fetch.test.js`（13 用例）搬进合并树，**13/13 逐条 pass**
（唯一的 `no proxy env -> native fetch passthrough` 在本机跑不了——本机无直连外网，是环境限制）。

## 5.6 另一个 P0：插件根本没加载（bundles 被 GUI 移除）

截图里「停止并移除 2.8.4」不只是移除包，还**把 `@240xu/dsh-websearch` 从 `package.json` 的
`dsh.profile.bundles` 删了**。后果是插件完全不加载：

| 证据 | 值 |
| --- | --- |
| `/api/unified-search/health` | **404 not found** |
| `web_search` | 走 `web-deepseek-api`（报 503 `deepseek-search` 无可用 distributor） |
| `bundles.filter(websearch)` | **`[]`**（而 2026-11-22 的备份里是 `['@240xu/dsh-websearch']`） |

**修法**：把 `'@240xu/dsh-websearch'` 加回 `dsh.profile.bundles`（插在 `dsh-purge-community` 之后，与历史位置一致），重启后：

```
/api/unified-search/health -> 200
{"ok":true,"enabled":6,"keyless":6,"requestedMaxResults":8,"backends":[13 个]}
```

## 5.7 关于 `dsh-credentials` 的误判（澄清）

我一度以为插件损坏，因为从 profile 目录 `import()` 报 `Cannot find package '@deepseek-ai/dsh-credentials'`。

**这是我测试方式的问题**：cordis loader 用 `createRequire(import.meta.url)`（位置在
`/opt/dsh-0222/node_modules/@deepseek-ai/cordis-plugin-loader/lib/`）解析依赖，能拿到
`/opt/dsh-0222/node_modules/@deepseek-ai/dsh-credentials`。直接 `import` 文件路径走的是
「文件所在位置」解析，拿不到。实测：

```
createRequire('/opt/dsh-0222/node_modules/@deepseek-ai/cordis-plugin-loader/lib/index.js')
  .resolve('@deepseek-ai/dsh-credentials')
→ /opt/dsh-0222/node_modules/@deepseek-ai/dsh-credentials/lib/index.js
```

## 6. 仍未做 / 无法验证

1. **服务尚未重启** —— 2.8.8 已装好但进程内存里还是 2.8.4。重启 `dsh-web.service` 会杀掉承载本会话的进程（前几次都 abort），所以我把重启留到最后并接受中断。
2. **2.8.8 的 6 个上游测试未搬** —— A6 给了可搬清单，但没执行（属下一轮）。
3. **CHANGELOG 未搬**。
4. **DDG 后端当前不可用** —— 实测 `html.duckduckgo.com` 返回 **HTTP 202 + 15KB HTML**，含 `anomaly`/`challenge`，无 `result__a`。这是**外部反爬变化**，两棵树（2.8.4 与 2.8.8）都是 0 sources，与本次合并无关。
5. **`web_search` 工具本身曾报 `web-deepseek-api` 503** —— 那是 DeepSeek 渠道侧（`deepseek-search` 无可用 distributor），与插件无关。

## 7. 结论（A–E）

- **A**：补丁 26 段、apply 34/34、单测 97/97、安装副本 34/34、真搜索 6 sources 全是实测。
- **A**：10 处冲突裁决逐条有理由，且两侧语义标记在合并树里同时存在。
- **A**：`ERR_PNPM_UNUSED_PATCH` 的根因（patch 键与 pin 分家）已定位并修复，`pnpm install` 输出不再报错。
- **B**：A6 的可搬性三分是它自己实测得出的，我采信并记下但未执行搬运。
- **C**：searxng 取我们 8s（而非 2.8.8 的 5s）是量纲判断——若将来启用 `searxngBaseURLs` 多实例，5s 更合适。
- **D**：DDG 反爬、DeepSeek 渠道 503 都属外部环境，非本工程缺陷。
- **E**：服务未重启，2.8.8 未在真实进程里跑过。

---
无凭证值写入本文件。
