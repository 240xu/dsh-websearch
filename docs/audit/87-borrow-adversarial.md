# 87 · 对抗型评估：抄同类项目的风险（B2 骨架 → Lead 补完，2026-11-15 22:08）

> **⚠️ 22:20 补注（A2 终版）**：反方「NO-GO 本轮不改代码」的结论进一步被坐实——provider 单例 + 无会话标识，使「抄 PR#47334 状态分离」连最小落地都缺前置条件；`history.clear()` 删整文件是**我们自己的**跨会话问题，不是抄来的。
> 立场：**默认不抄**，除非证据证明收益大于代价。B2 顾问落盘 15 行骨架后结束，由 Lead 用一手实证补完。只评估，**未改任何源码/运行时**。

## 1. 逐条「抄了会怎样」风险表

| 候选 | 具体风险（≥2） | 等级 / 依据 |
| --- | --- | --- |
| **OpenCode PR #47334 sticky per session** | ① 它是 TS + `effect` 的 Service/Layer/Stream/KV 架构，照搬会引入重依赖并改变插件与 Cordis `ctx.effect` 的生命周期语义；② 我们插件**没有 `Session.ID` 对应物**，`query(input,{sessionID})` 的签名无处注入；③ `preferred.clear()` 依赖 `SessionEvent.Deleted/Moved`，DSH 无等价事件，清理只能靠弱引用/超时，容易内存泄漏；④ 只抄「状态分离」不动架构才安全 | A/B（PR diff 原文 + 我们 `lib/index.js` 只有 `ctx.inject(["webServer"])`） |
| **#60176 把 432/402 纳入轮换** | ① **432 不是标准 HTTP 状态**，`Response`/`fetch` 在部分运行时会拒收；先确认上游真发（当前 E）；② 我们 `webErrorFromResponse` 已把 402 算 QUOTA、403 不算，再加 432 会扩大「配额」面，可能把普通计费错误也冷却 60s；③ 该 Issue 是 **open 未修**，没有已验证实现可抄 | A（API 实测 open）+ C（432 风险） |
| **#58327 自定义 provider 上报 rate limit** | ① 同样是 **open 抱怨**，抄的是契约不是实现；② 我们 11 处 `webErrorFromResponse` 已经是结构化入口，再加一层「上报协议」纯属重复；③ 若真加，需要动 `BACKENDS` 注册接口与每个 backend，测试面从 80 条扩到 13 个后端 × 分类组合 | A + C |
| **aggregation 优先队列 ordered fallback** | ① 与全并发 RRF **产品取舍冲突**：首个成功即胜会丢掉 12 个后端的结果，`rrfFuse`/`dedupeSources`/`backendsOk/Total` 语义全变；② 需要新增 Config 字段 → GUI 文案（zh/en 双字典）→ `cacheKeyFor` 的 `resultOptions` → 25 §6 回滚链 → 26 备份，一条链全要同步；③ 实时可改顺序意味着缓存键要含顺序，否则改顺序被 900s 缓存掩盖（正是我们刚修的 N2 同类问题） | A（本地 provider/cache/index 结构）+ C |
| **verified-search 的 SSRF/allowlist 清单** | ① 我们已有 `https?://` 白名单 + **RFC1918 plain-http baseURL trust gate**（为自托管 SearXNG 开的口子），照搬「non-public resolved addresses 一律拒」会**误伤合法内网实例**；② DNS rebinding 需要解析后校验，我们 `egress-fetch` 走代理/CONNECT，做真校验要改网络层；③ 只读到介绍页、未读源码与许可证（E） | A（本地 `lead-20261106.test.js` 的 trust gate 断言）+ E |
| **modsearch 的 bundle 两个 patch op 替换整行 web config** | ① 历轮实测：替换整行 `id: web` 会抹掉 `fetchProvider` → **`WEB_PROVIDER_AMBIGUOUS`**，我们靠 systemd drop-in `DSH_WEB_FETCH_PROVIDER=http` 才恢复；② 它会把 `searchProvider` 指向别人，直接绕开我们 `id:"unified"` 的单一注册 | A（24/49 号 + 运行态 env） |
| **升级上游 2.8.8** | ① 覆盖 **11/23** 个被改文件、逐字节相同 0 个 ⇒ 重新引入 N1–N4、3b、D8、disposer；② profile 精确 pin 2.8.4 会被 `pnpm add` 覆盖（E2 X.2 实测 `install_bundle` 语义） | A（E2/74 号） |

## 2. 本地补丁已等价或更好（反证「必须抄」）

| 上游/同类亮点 | 我们已有 |
| --- | --- |
| ddg 超时 5s→8s（2.8.8） | `BACKEND_TIMEOUT_OVERRIDES_MS = {ddg:8000,searxng:8000}` + 内部超时 telemetry 前置分类 |
| forwarder hop 直连 `node:http(s)`（2.8.6） | `egress-fetch.js` 三条出口路径 + Host 补正 + `collect()` try/catch |
| 结构化 rate limit 上报（#58327 诉求） | `webErrorFromResponse` 挂 `status/code/rateLimited/quota/keylessRejected` + `failure-label.js` route on code |
| 402/quota 轮换（#60176 诉求） | 402=QUOTA、3b `rateLimitedCooled` 分类、keyless 独立文案（**比 open Issue 更完整**） |
| shared cooldowns / late successes（#47334 测试项） | 全局 `latestBackendHealth` + `foldBreaker` 过期窗口重置 + `createLimiter`；**缺的只是「会话判定隔离」与迟到成功的显式测试** |
| 缓存键含结果影响项 | N2 修后 22 全局项 + 13 后端级摊入（`${id}.${k}`） |
| 可观测性 | D8 的 `requestedMaxResults` / `rateLimited` / `keylessRejected` / `cooledUntilMs` |
| MCP 鉴权 | N4 的 `sessionCacheKey` 认证头摘要 + 3 处握手透传 |

⇒ **8 项里 7 项已等价或更好**，剩下的真实缺口只有 D5 的状态隔离与迟到成功测试。

## 3. 许可证 / 依赖 / 维护成本

- 只看到介绍页、**未读源码与 LICENSE**：`f0909172434/dsh-plugin-verified-search`、`jwilson411/dsh-ssrf-guard`、`liustack/modsearch`、`chendefine/dsh-web-search-aggregation`、`CharlotteN7/dsh-netguard` ⇒ 全部 **E**，不臆断可否商用/抄代码。
- `anomalyco/opencode` 的 PR diff 是公开可读的（A），但它是另一个代码库的不同许可证；我们只抄**设计意图**，不复制代码。
- 需要用户点头才能动：#1 D5 状态分离（核心状态）、#5 SSRF 清单（可能误伤内网）、任何新增 Config 字段、对外 PR/publish。

## 4. 最小安全抄法（如果一定要抄）

**只抄一个设计意图：把「全局冷却事实」与「本次会话的失败判定」拆成两个数据源**（PR #47334 的结构），不抄它的 Effect/Stream/Session.ID 实现。

- 文件：`lib/provider.js` 唯一一处核心状态拆分；`tests/lead-20261109-3b-runtime.test.js` 加双会话断言。
- 不动：`health.js` / `history.js` / `settings-api.js`、磁盘格式、3 个 API 契约、Config schema、GUI。
- 验收不破坏 80/80 与 35/35 的方式：先加**只观察不生效**的 `sessionFailures` 收集 → 断言 A/B 互不干扰 → 再切换 3b 判定数据源 → 全量单测 → 35 文件同步 → 重启 → 三 API + `web_search` 复跑。

## 5. 最终裁决：**NO-GO（本轮不改代码）**

理由：8 项亮点里 7 项本地已有等价/更好实现，唯一真缺口（D5）是**架构/执行语义改动**，按会话约定必须用户点头；而「抄」的最大风险恰恰是覆盖我们刚修完的 35 文件补丁。本轮应只交付评估与规划。

**唯一零风险立刻可做**：把「新增后端必须走 `webErrorFromResponse`」写进 README + 一条静态断言（把 #58327 的教训固化成契约，零运行时改动）。

## 6. 已确认无误 / 7. 无法验证

已确认：PR#47334 已合并、两个 Issue 均 open、上游 2.8.8 覆盖 11/23、本地 80/80 与 35/35、G5 已由 `refresh.sh` 保证 35/35。
无法验证（E）：5 个同类项目的源码/许可证/star、432 是否真发、PR#47334 的 54 项测试逐条内容（只读到 PR body 与文件清单）。

## 8. 5 条反直觉

1. 对抗评估的结论是「**别抄**」——因为最大的风险不是抄错，而是**升级/替换会覆盖我们 3 轮修的 35 文件**。
2. 两个最相关的 OpenCode Issue 都是别人**还没修的抱怨**；我们本地已经比它们完整。
3. 「有序 fallback」对我们是功能**降级**（13 后端融合 → 首个成功即胜），却常被当成优化。
4. SSRF 清单里的「拒绝非公网地址」会直接打死我们为自托管 SearXNG 专门开的 trust gate。
5. 抄「状态分离」这个**数据结构决定**是安全的，抄 `Session.ID` 这个 **API 签名**是危险的——同一个 PR 里两者并存。

---
无凭证值写入本文件。
