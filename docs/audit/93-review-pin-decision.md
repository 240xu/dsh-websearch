# R2 决策：版本 pin 与升级路径判定（`@240xu/dsh-websearch`）

> 决策专家 R2 · 2026-11-22 · 只读审计（除本文件外未改任何状态）
> 结论：**C —— 锁 2.8.4，但把"锁"机制化；2.8.8 rebase 降级为有 gate 的排期工作项**

---

## 0. TL;DR

| 项 | 判定 |
| --- | --- |
| 该锁 2.8.4+补丁，还是 rebase 2.8.8？ | **锁 2.8.4**（第三条路 C：`exact pin` + `patchedDependencies` 载体 + 修 lock + 时间窗护栏） |
| 现在最危险的是什么 | **不是版本选错，是 lock 仍指 2.8.8 而 pin 已是 2.8.4** —— 实测下一次 `pnpm install` 会把补丁树**静默**换回干净 2.8.4（marker 3 → 0） |
| 立刻要做的一件事 | `cd /home/dsh/.dsh/profiles/web && pnpm install --lockfile-only`（已实测可修，且顺带修好 3 条 link/file 形式） |
| sidecar（13070） | 今天无害（我们树关键字 0 命中）；**rebase 到 2.8.8 会致命**（实测每条 fetch 先卡 20s 再抛错）。最小改法：删 launcher 第 12 行；`UnsetEnvironment=` **无效**（已证） |
| 2.8.8 rebase 成本 | 37 段中 **6 文件 11 hunk 真冲突**（fuzz=0）；另 **1 个同名新建冲突**（`failure-label.js` 双方各写一份、语义完全不同） |

---

## 1. 事实基线（本次全部实测，2026-11-22 19:38–20:35）

### 1.1 profile 真实状态（三处不一致，不止一处）

```
pin        : package.json  "2.8.8" → 已被改成 "2.8.4"（mtime 19:40:26）
lock       : importer specifier=2.8.4 / version=2.8.8(@schemastery@3.19.0)   ← 仍指 2.8.8
实装       : node_modules/@240xu/dsh-websearch  version=2.8.4，含全部补丁
补丁保真度 : 与 src-work/plugin 逐字节 **27/27 全等**（Lead 的恢复是干净的，无 .rej/.orig 残留）
node_modules 侧     : 该目录是个 git 仓库（HEAD=f5d4768 "base"，29 项 dirty）—— 恢复机制是它
```

**只读一致性校验（未落盘，mtime 未变）**：

```bash
$ pnpm install --frozen-lockfile --lockfile-only
EXIT=1
The importer resolution is broken at dependency "@240xu/dsh-websearch":
  version "2.8.8" doesn't satisfy range "2.8.4"
```

⇒ pin 与 lock 的矛盾已被 pnpm 自己点名。

### 1.2 npm 侧

| 事实 | 证据 |
| --- | --- |
| `latest = 2.8.8`，无 2.8.9，`dist-tags` 只有 latest | `npm view ... dist-tags` |
| 2.8.4 发布 `2026-10-18T06:02:07Z`（age 50788 min） | `npm view ... time` |
| 2.8.8 发布 `2026-10-21T14:10:40Z`（age 45979 min） | 同上 |
| 2.8.4 / 2.8.8 tarball sha512 与 lock 的 integrity 完全对上 | `openssl dgst -sha512 -binary \| base64` |

### 1.3 干净 2.8.8 树（校验过来源可信）

`g5/base288/240xu-dsh-websearch-2.8.8.tgz` → sha512 `sgDi0A…nfSw==` = lock 里 2.8.8 的 integrity ⇒ 与 npm 一致，可作基准。`lib/` 30 个 js（28→30，新增 `util/describe-error.js`、`util/failure-label.js`）。

### 1.4 上游 2.8.4 → 2.8.8 到底改了什么（10 个 lib + README + package.json）

| 文件 | 上游改动 | 性质 |
| --- | --- | --- |
| `util/describe-error.js` | **新增** 58 行，cause-chain 一行化 | 真改进（我们缺） |
| `util/failure-label.js` | **新增** 40 行，`failureLabel(id, raw)` 展示标签 | 真改进，但与**我们同名文件**语义冲突 |
| `util/egress-fetch.js` | +142/−3：**整个 sidecar `forwarderFetch` 分支** + `sanitize` 改 cause-chain | 致命（本机默认不可用） |
| `util/mcp-client.js` | +7/−3：只把 `${error}` 换成 `describeError(error)`（4 处） | 真改进，很小 |
| `provider.js` | +47/−18：route6 重写（timeout 先于 telemetry、`MAX_FAILURE_DETAILS=4`、`+N more`、`cooled-skipped` 注、ddg 5s→8s） | 真修 bug（我们**没有**这几条） |
| `backends/searxng.js` | +162/−59：多实例 failover + 冷却 10min + anti-bot 分类 | 真 feature |
| `backends/ddg.js` | +9/−7：POST → **GET 表单**（绕 bot wall）+ describeError | 真修 bug |
| `backends/exa.js` / `parallel.js` | 各 +2/−1：仅 describeError | 真改进，极小 |
| `index.js` | +7/−0：只加 `searxngBaseURLs` 配置项 + 传给 resolveOptions | 真 feature，极小 |
| `README.md` / `package.json` | README 改说明；package.json **只改 version 2.8.4→2.8.8**（description 未动） | 冲突可 3 秒裁决 |

**2.8.8 没有修的（对我们都是 P0/P1）**：

| 我们修的 | 我们树出现次数 | 2.8.8 出现次数 |
| --- | --- | --- |
| `webErrorFromResponse` | **25** | **0** |
| `keylessRejected` | 12 | **0** |
| `findPluginRow`（settings 实时绑定） | 6 | **0** |
| `sessionCacheKey` | 1 | **0** |
| `forceFreshSession` | 2 | **0** |
| `MAX_RETRY_AFTER_MS` | 1 | **0** |
| `webCtx.effect` 路由 disposer | 1 | **0** |
| `describeError` | 0 | 16（上游有，我们没有） |
| `failureLabel` | 0 | 3（上游有，我们没有） |

**Host 头**：2.8.8 仍然是 `delete headers["host"]`（`egress-fetch.js:404`），`httpsViaConnect` 仍 `headers,`（第 295–305 行）**裸传**；只有 `httpViaProxy` 恢复了 `host: headers.host ?? target.host`。⇒ 上游**没修** CONNECT 路径的 403。

**运行时实锤（同一目录、同一代理、同一目标，仅换 lib 树）**：

```js
// DSH_EGRESS_FORWARDER=""，HTTPS_PROXY=172.30.66.1:1091，POST https://mcp.exa.ai/mcp
2.8.8 树 → status=403  server=cloudflare
我们树   → status=400  server=cloudflare     ← 过了 CF 的 Host/403 门，进到 MCP 协议层
```

### 1.5 sidecar（`DSH_EGRESS_FORWARDER`）

| 项 | 实测 |
| --- | --- |
| 注入源 | **唯一**：`/usr/local/sbin/dsh-web-run-native.sh:12`（grep `/usr/local/sbin`+`/etc/systemd/system`+`*.env` 仅 1 命中）；live 进程 environ 确有该值 |
| 13070 | `ss` 无监听；`curl --noproxy '*'` → `(7) Connection refused`（0ms）；`bash /dev/tcp` → refused |
| 但我们树 | `grep -c DSH_EGRESS_FORWARDER lib` = **0** ⇒ 今天完全无害 |
| 2.8.8 树 | 8 处引用；`forwarderFor()` **不 fail-open**：只要 env 非空且 URL 不在 NO_PROXY 就走 sidecar |
| 真实 profile 环境下的行为 | `NO_PROXY=127.0.0.1,localhost,::1` 不覆盖外站 ⇒ 每次 `egressFetch` **卡满 20s** 后抛 `fetch failed: forwarder did not respond within 20000ms (sidecar stalled?)` |
| 归零对照 | 同 env 去掉 `DSH_EGRESS_FORWARDER` → 8ms 走 native fetch，200 |
| 一个未解释的差异 | Node `http.request` 打 13070 挂到我们 25s 主动 destroy（未拿到 ECONNREFUSED），curl/bash 却是立刻 refused。**结论不变**（两条路径都失败），但机制未查清，列入「无法验证」 |

⇒ 「2.8.8 在本机默认不可用」升级为**运行时可复现**：不是"慢"，是"每个搜索/抓取调用先烧 20s 再抛错"。

---

## 2. 成本量化：两个方向 + 一个变体

### 2.1 方向 A —— 锁 2.8.4 + 补丁（逐手段实测）

| # | 手段 | 可执行性 | 实测证据 | 判定 |
| --- | --- | --- | --- | --- |
| A1 | `package.json` 写 `"2.8.4"`（exact） | ✅ 可做 | 当前已是 2.8.4 | **不够**：`install_bundle` 内部就是 `pnpm add <spec> --save-exact`（`plugin-manager/lib/index.js:2986-2991`），会直接改写 manifest |
| A2 | `pnpm-lock.yaml` 与 pin 一致 | ✅ 可做，1 条命令 | 复制真实 lock 到 scratch 后 `pnpm install --lockfile-only` → 2.8.8 三处引用全变 2.8.4，随后 `--frozen-lockfile` **exit 0** | **必做**（今天就是坏的） |
| A3 | `pnpm.overrides` 写进 `package.json` | ⚠️ **无效** | pnpm 11 警告 `The "pnpm" field in package.json is no longer read by pnpm` | 否决（要写进 `pnpm-workspace.yaml`） |
| A4 | `pnpm-workspace.yaml: overrides: {'@240xu/dsh-websearch': 2.8.4}` | 🟡 半有效 | `pnpm install` 时**确实**把 manifest 的 2.8.8 压回 2.8.4；但 `pnpm add @2.8.8 --save-exact` **仍然 exit 0 装成 2.8.8**（两次复现） | 只是兜底，不能当锁 |
| A5 | `patchedDependencies: {'@240xu/dsh-websearch@2.8.4': patches/…patch}` | ✅ **最强** | 版本一变，pnpm 硬失败 `[ERR_PNPM_UNUSED_PATCH]`（**exit 1**）；且普通 `pnpm install` 在 lock 漂移时也 exit 1，不静默 | **推荐主锁** |
| A6 | `minimumReleaseAge: 48000` + `minimumReleaseAgeExclude: ['@240xu/dsh-websearch@2.8.4']` | ✅ 有效但**限时** | `pnpm add @2.8.8` → `ERR_PNPM_NO_MATURE_MATCHING_VERSION` exit 1；`^2.8.4` 也不会漂 | 时间窗护栏（到期 ≈ `2026-11-23T22:10Z`），不是永久锁 |
| A7 | `.npmrc` | ❌ | 只能指 registry/proxy，与版本选择无关 | — |
| A8 | patch-package | ❌ 硬阻塞 | 仍无 `package-lock.json`；且它不解决"装哪个版本" | 否决 |
| A9 | `file:` 自带 vendor 副本 | 🟡 可装但**无保护** | 装进去 marker=3；随后 `pnpm add @2.8.8` 直接替换（marker=0） | 可作 B 备选，不作锁 |
| A10 | profile 层能否"阻止" | 🟡 部分 | DSH 安装只快照 `package.json`+`pnpm-lock.yaml`（`index.js:688`），**不快照 node_modules**；失败回滚也回不来模块树 | 不能靠它 |
| A11 | `pnpm patch` 载体能否替代手工 | 🟡 **27/37 段** | `pnpm patch` → 人工 apply G5（35/35 全等）→ `pnpm patch-commit` → 重装后 **25/25 lib + package.json + README 逐字节全等**；但 **`tests/` 与 `.gitignore` 不进最终安装树** | 运行时 100%，测试网 0 |

**A 的真实成本**：pin 改成 exact（1 行）+ lock 修好（1 条命令）+ 写 `patchedDependencies`（1 段 YAML + 129 KB patch 落盘）+ 可选 `minimumReleaseAge`（2 行）。**合计 ≈ 15 分钟**，且有 refresh.sh 式可重生成流程的既有雏形。

**A 的残余风险（已实测）**：

1. **手打的补丁不抗 install**。`/tmp/mismatch`（完全复刻真实漂移状态）：`pnpm install` → 干净 2.8.4，`marker 3 → 0`，且 lock 被就地改成 2.8.4（**错误消失、补丁也消失**，最阴的一条）。
2. 但 **pin+lock 一致时**是安全的：`pnpm install` → `Already up to date`，`marker 3 → 3`（两次复现，含 `--frozen-lockfile`）。
3. **`rm -rf node_modules` + install** 必然清空（手打树无任何载体）。
4. `pnpm add` 装**别的** bundle 时，若 lock 一致则补丁存活（实测连装 `dsh-connect-workbuddy@5.30.0`、`@ayanehana/dsh-reasoning-effort@1.0.0` 后 marker 仍 3）——**但 A3/A5 已变成自动重放**，这才是长治久安点。

### 2.2 方向 B —— rebase 到 2.8.8（逐冲突裁决）

**复核结论：`git apply --check` 对干净 2.8.8 失败面比历轮记录更大。**

| 口径 | 结果 |
| --- | --- |
| `git apply --check`（严格） | **7 文件**不可应用（6 个真 hunk 冲突 + 1 个「文件已存在」） |
| GNU `patch -F0 --dry-run` | **6 文件 11 hunk FAILED**（`ddg 2/2`、`searxng 1/2`、`index 1/13`、`provider 5/16`、`mcp-client 1/9`、`package.json 1/1`） |
| GNU `patch` 默认 fuzz=2 | **5 文件 7 hunk FAILED** + 19 个 hunk 带 fuzz/offset「成功」 |
| g5/README 记的「4 文件 6 hunk」 | **两种口径都对不上，需订正**（见 §7 订正表） |
| 逐段 applicability（37 段拆开跑） | **30 段 OK / 7 段 BLOCKED** |

**最危险的不是 FAILED，是"fuzz 假成功"**：默认 fuzz=2 跑完只留 5 个 `.rej`，但产出树与我们的标准树 **11 个文件不一致、仅 16/27 相同**（不一致者：`util/egress-fetch.js`、`util/mcp-client.js`、`util/failure-label.js`、`index.js`、`provider.js`、`backends/exa.js`、`backends/parallel.js`、`backends/ddg.js`、`backends/searxng.js`、`README.md`、`package.json`）。一个"看起来成功"的 rebase 会静默退回上游语义，把我们 20+ 条 P0/P1 丢掉。这条必须写进流程禁令。

**逐冲突裁决表（上游改了什么 / 我们改了什么 / 怎么裁）**

| 文件 | 冲突 hunk | 上游 2.8.4→2.8.8 | 我们（G5） | 裁决 |
| --- | --- | --- | --- | --- |
| `package.json` | 1/1 | 只把 `version` 2.8.4→2.8.8（description 未动） | 把 description 改成「13 backends … Firecrawl + TinyFish」 | **取上游 version=2.8.8，保留我们的 description**。3 行手工，零风险 |
| `util/failure-label.js` | 「文件已存在」 | 新增 `failureLabel(id, raw)`：给 telemetry 行做展示级短标签（anti-bot/timeout/proxy 分类） | 新增 `keylessRejected` / `rateLimited` / `retryAfterMsFrom`：给 breaker 做**机器级**限流/配额分类 | **必须改名**：我们把文件改叫 `util/quota-classify.js`（或 `util/limit-signals.js`），`provider.js` 的 import 同步改；`failure-label.js` 让给上游。否则两套语义挤在一个文件名里，任何一次上游覆盖都会静默丢一套 |
| `util/mcp-client.js` | 1/9（import 行） | 4 处 `${error}` → `describeError(error)` | session cache 改 `url\0auth` 键 + `forceFreshSession`、parseEnvelope 重写（BOM/多 event/id 校验）、`skipInitialize`、id 1/2/3 分离、`webErrorFromResponse`、retry 保留凭证头 | **我们赢**，只吸收上游的 `describeError` 替换（比 `String(err)` 强）。1 个失败 hunk 是 import 行，手工并两行即可。低风险 |
| `backends/ddg.js` | 2/2 | POST → **GET 表单**（`target = ${ENDPOINT}?${params}`）、`describeError` | 加 `webErrorFromResponse` + `if (err instanceof WebError) throw err`（保住结构化字段） | **取上游整段**（GET 是真修复），再把我们那 3 行贴回去：① import；② `!res.ok` 处改 `webErrorFromResponse(res, detail, "ddg")`；③ catch 里加 WebError 直通。注意上游 `!res.ok` **仍是裸 WebError**，我们的修复依然必要 |
| `backends/searxng.js` | 1/2 | 函数被整体重写：多实例候选 + 顺序尝试 + 10min 冷却 + anti-bot 分类 + `INSTANCE_ATTEMPT_TIMEOUT_MS` | 只在 HTTP 错误分支加 `webErrorFromResponse` | **取上游整段**（这是 feature），把 `webErrorFromResponse` 重新插到**新的** `queryInstance()` 错误处。概念上 1 行，但要重跑 searxng 测试（我们没写过它的多实例路径） |
| `index.js` | 1/13 | 只加 `searxngBaseURLs` 配置项 + `resolveOptions` 里 spread | 13 处：firecrawl/tinyfish 两后端、`OPTIONAL_KEY_IDS`/`METERED_IDS`、credential-ref `pattern()` 收敛、`findPluginRow` 实时 settings、**`webCtx.effect` 路由 disposer + 回滚** | **我们基本是超集**：把上游那 2 处（+7 行）搬进我们树即可，其余维持。低风险 |
| `provider.js` | 5/16 | route6 重写：timeout 分类**先于** telemetry/health、`timedOut` 包成 `WebError`、`MAX_FAILURE_DETAILS=4` + `+N more`、`cooled-skipped` 注、ddg 5s→8s | 我们改 timeout/breaker/限流/all-fail compose：`rateLimited`+`retryAfterMsFrom`+`keylessRejected` 接入、失败原因 slice 200 字符、冷却注解、fail-open 分支 | **最高风险**：双方**各写一遍同一段语义**。裁决原则：**取上游 route6 骨架**（它同时修了我们没发现的 P6「telemetry 记错原因」），再把我们独有的 4 件事嵌进去（限流分类 → 冷却时长、`retryAfterMsFrom`、`keylessRejected`、`slice(0,200)`）。必须逐 hunk 对照 5 个 FAILED 位置（25/34/406/557/565）手工拼，**且必须重跑我们 8 个 lead-*.test.js** |
| `util/egress-fetch.js` | 0（干净应用） | **+142 行 sidecar 分支** | Host 头两处恢复 + `collect()` 里 `Response` 构造 try/catch + `normalizeHeaders` 注释 | ⚠️ **hunk 不冲突，但语义致命**：干净套上去 = 自动获得 sidecar 分支。**必须显式拒绝 `forwarderFor()` / `forwarderFetch()`**（或先处理 §4 的 env 前提）。这条比 11 个 hunk 更危险，因为它不报冲突 |

**工作量估算（含验证）**

| 项 | 估时 |
| --- | --- |
| 6 文件 11 hunk 手工裁决 + `failure-label` 改名 | 2–3 h |
| `egress-fetch` 的 sidecar 分支显式拒绝（并写测试断言「env 设置也不走 sidecar」） | 0.5 h |
| `provider.js` 语义拼接 + 重跑 `tests/lead-*.test.js`（8 个） | 1–1.5 h |
| 重建 `G5-authoritative` 基线（`refresh.sh` 的 base 从 2.8.4 换 2.8.8，`cmp` 目标仍 35）| 0.5 h |
| 回归：searxng 多实例 / ddg GET / settings 卡 / breaker 冷却 / keyless 403 / 路由 reload | 1–2 h |
| **合计** | **≈ 5–7 h 净工时**，且**必须有 35/35 逐字节 gate 才能收工** |

**B 的净收益评估**：能拿到 6 项上游改进（describeError、failureLabel、searxng failover、ddg GET、provider route6、mcp-client describeError）。**拿不到** anything else——2.8.8 里我们 20+ 条 P0/P1 命中率为 0，Host 403 没修，sidecar 反而添了一个硬失败路径。⇒ B 的终态 == （我们现在的树）+ 上述 6 项 − （重写 2 个文件的语义风险）。

### 2.3 变体横评

| 变体 | 内容 | 成本 | 抗 install | 抗版本升级 | 判定 |
| --- | --- | --- | --- | --- | --- |
| **A（裸）** | pin exact + 手打补丁 | 5 min | ❌ lock 漂移即静默清空 | ❌ | 否决（就是今天的现状） |
| **C（A 机制化）** | pin exact + `patchedDependencies` 载体 + lock 修好 + `minimumReleaseAge` 护栏 | 15 min | ✅ 自动重放（实测连装两个 bundle 后 marker 仍 3） | ✅ 硬失败 exit 1 | **推荐** |
| B | rebase 到 2.8.8 并重打 | 5–7 h + 全量回归 | 同 C（仍需载体） | 同上 | **排期做，不做应急** |
| D | 等上游 2.8.9 | 0 | — | — | 不可依赖：无 2.8.9、无 roadmap、latest 停在 2026-10-21 |
| E | `file:` vendor 副本 | 20 min | ✅ 目录级 | ❌ `pnpm add` 直接替换（实测） | 可作离线兜底 |

---

## 3. 判定与三条理由

**一句话结论：锁在 2.8.4，但把"锁"从"手打"换成"机制"（C）；2.8.8 的 rebase 排成独立工作项，等 gate 齐了再做，不拿它当应急选项。**

1. **2.8.8 在本机"默认不可用"，这一点已从推断升级为运行时证据。** `DSH_EGRESS_FORWARDER` 由 launcher 硬注入、13070 无监听，而 2.8.8 的 `forwarderFor()` 不 fail-open ⇒ 每个外站请求**先烧满 20s 再抛错**（实测 20009 ms / `forwarder did not respond`）。同时 Host 头仍未修（`delete headers["host"]` + `httpsViaConnect` 裸传），实测 `2.8.8 → 403 cloudflare`，我们树 `→ 400`（已过 CF 门）。⇒ **rebase 后必须先把我们这套修复原样补回**，B 的"升级"收益当场被抵掉。
2. **我们的 P0/P1 在 2.8.8 里命中 0，而 B 需要重写 2 处语义最重的文件。** `webErrorFromResponse` 25 处 / 上游 0；`keylessRejected` 12/0；`findPluginRow` 6/0；`sessionCacheKey`、`webCtx.effect` disposer 均 0。B 要逐 hunk 裁决 11 处，其中 `provider.js`（5 hunk）与 `searxng.js`（整函数重写）是**双方各写一遍的语义冲突**，风险和回归面都高于 6 项上游改进的收益。
3. **当前真正的风险不是"选错版本"，是 profile 里 pin 与 lock 已分家。** 实测完全复刻该状态（specifier 2.8.4 / version 2.8.8）后跑 `pnpm install`：补丁树被**静默**换成干净 2.8.4（`marker 3 → 0`），且 lock 被就地改成 2.8.4——**错误消失、补丁也消失**，这是最难事后察觉的失败模式。修它 ≈ 1 条命令 + 4 行（已在 replica 验证），而 B ≈ 5–7 h。

---

## 4. 立即要修的不一致：pin=2.8.4 / lock=2.8.8

### 4.1 会不会让下次 `pnpm install` 覆盖我们？——会，且是**静默**的

| 场景 | 实测结果 |
| --- | --- |
| 现状（pin 2.8.4，lock version 2.8.8，树=我们的） | `pnpm install` → 干净 2.8.4，**marker 0**，lock 就地改 2.8.4 |
| pin 与 lock 一致 + 手打补丁 | `pnpm install` → `Already up to date`，marker 3（安全） |
| 同上 + `--frozen-lockfile` | 同样 `Already up to date`，marker 3（安全） |
| 只读诊断（现状） | `pnpm install --frozen-lockfile --lockfile-only` → **EXIT 1**，指名 `version "2.8.8" doesn't satisfy range "2.8.4"` |
| `rm -rf node_modules` 后 install | marker 0（手打树无载体，必然丢） |

### 4.2 最小修法（4 步，已在复刻目录全域验证）

```bash
cd /home/dsh/.dsh/profiles/web
cp -a pnpm-lock.yaml pnpm-lock.yaml.bak-$(date +%Y%m%dT%H%M)

# 1) 让 pnpm 自己重算 lock（不下载、不动 node_modules）
pnpm install --lockfile-only

# 2) 校验：必须 exit 0
pnpm install --frozen-lockfile --lockfile-only; echo "expect EXIT=0, got $?"

# 3) 校验 pin/lock/实装三者一致
grep -n "240xu/dsh-websearch" pnpm-lock.yaml            # 三处都应是 2.8.4
node -p "require('./node_modules/@240xu/dsh-websearch/package.json').version"   # 2.8.4
grep -c findPluginRow node_modules/@240xu/dsh-websearch/lib/index.js           # 3

# 4) 上主锁（机制化，防下次 install/add 静默升级）
#    a. package.json 保持 "@240xu/dsh-websearch": "2.8.4"（exact，无 ^）
#    b. pnpm-workspace.yaml 追加：
#         patchedDependencies:
#           '@240xu/dsh-websearch@2.8.4': patches/@240xu__dsh-websearch@2.8.4.patch
#       并把现有 35 文件补丁转成 pnpm patch 载体（生成方式见 §4.4）
#    c. 可选时间窗护栏（到期 ≈ 2026-11-23T22:10Z，之后要加宽）：
#         minimumReleaseAge: 48000
#         minimumReleaseAgeExclude:
#           - '@240xu/dsh-websearch@2.8.4'
```

### 4.3 只做第 1 步够不够？——够"止血"，不治本

`--lockfile-only` 把三处 2.8.8 引用改成 2.8.4，并**顺带**把 3 条 `link:/file:` 的相对形式重写为 pnpm 自洽形式（replica 里 20 行变化），之后 `--frozen-lockfile` 由 `EXIT 1 → EXIT 0`。但**手打的补丁依然没有任何载体**：`rm -rf node_modules`、或被 `install_bundle` 触发一次重装，仍会清空。所以 1 步止血 + 4(b) 载体才是闭环。

> 注：真实 profile 的 `link:../../../../ova/...` 与 manifest 的 `link:/home/ova/...` 文本不一致（**目标其实相同**）。这是 lock 里既有的一处隐患，`--lockfile-only` 会一并修正；不要手工改这三个 path，交给 pnpm 生成。

### 4.4 把 35 文件补丁转成 pnpm 载体（已实测的全流程）

```bash
# 基线必须是干净 2.8.4（不许在我们树上做）
mkdir -p /tmp/edit284
pnpm patch @240xu/dsh-websearch@2.8.4 --edit-dir /tmp/edit284        # 落干净 2.8.4
cd /tmp/edit284 && patch -p1 --no-backup-if-mismatch -N \
  < /home/ova/dsh/.artifacts/websearch-research/g5/G5-authoritative.patch
# 校验 35/35 与 src-work 逐字节相同（refresh.sh 里有现成的 cmp 循环）
cd - && pnpm patch-commit /tmp/edit284                               # 生成 patches/*.patch + 写 workspace yaml
```

**实测保真度**：重新装出来的树 `lib` **25/25 逐字节全等**（外加 `package.json`+`README.md`）；**但 `tests/` 与 `.gitignore` 不进最终安装树**（pnpm patch 只对 tarball 内的文件生效）。⇒ 载体能扛运行时（100%），不能扛测试网（0/10 段）。测试网继续留在 `src-work/plugin/tests` + `tests/relink-test-deps.sh` 跑安装树。

---

## 5. sidecar（`DSH_EGRESS_FORWARDER`）处置

### 5.1 今天：无害，已证

我们 2.8.4 树关键字命中 **0**；`egress-fetch.js` 里没有 `forwarderFor`。env 只是躺在进程环境里。

### 5.2 但 rebase 到 2.8.8 就会致命

| 场景 | 行为 |
| --- | --- |
| env 空 / 未设 | 走 native fetch（8ms，200） |
| env 设 + URL 命中 NO_PROXY | 走 native fetch |
| **env 设 + URL 不在 NO_PROXY（= 本机真实情形）** | **卡 20s → `forwarder did not respond within 20000ms (sidecar stalled?)`** |
| env 设 + 目标 `http(s)` 且 13070 有监听（未来） | 走 sidecar，Host/TLS 指纹由它决定 |

⚠️ 关键：`forwarderFor()` 是**"有值即走"**，没有 probe/fallback。所以 rebase 后不是"偶发慢"，是"每次搜索都 20s 后失败"。

### 5.3 三种「让它永不生效」的最小改法

| 改法 | 具体动作 | 有效性 | 风险 |
| --- | --- | --- | --- |
| **① 删 launcher 行（推荐）** | `/usr/local/sbin/dsh-web-run-native.sh:12` 注释/删除 `export DSH_EGRESS_FORWARDER=…` → `systemctl daemon-reload && systemctl restart dsh-web` | ✅ 唯一注入源，删即净；对我们树**零行为变化**（本来不读） | ① 该脚本 root 拥有、是唯一 launcher，改动需 root；② 若将来真起了 sidecar，要记得改回来；③ 重启会瞬断 UI |
| ② drop-in 里 `Environment=DSH_EGRESS_FORWARDER=` 或 `UnsetEnvironment=` | 写 `/etc/systemd/system/dsh-web.service.d/*.conf` | ❌ **无效（已证）**：`UnsetEnvironment`/`Environment` 在 ExecStart **之前**生效，而 launcher 在自己的 shell 里 `export` 覆盖回来（`env -i … sh -c 'export …'` 实测覆盖成功） | 假安全感；改了不生效最难查 |
| ③ 代码里忽略（rebase 时一并做） | 在 `egress-fetch.js` 里让 `forwarderFor()` 直接 `return undefined`，并加一条断言测试「env 设置也不得走 forwarder」 | ✅ 与 2.8.8 语义解耦，且**这条测试会把未来上游覆盖钉死** | 偏离上游字节；`refresh.sh` 的 35/35 gate 要把这处计入补丁面；若未来真要用 sidecar 需显式回退 |
| ④ 去 13070 起监听 | 部署真 sidecar | 🟡 | **反向操作**：等于给 2.8.8 开门。在 B 未定之前**不要做** |

**推荐组合**：现在做 **①**（阻止未来误激活，且今天零影响）；如果真要走 B，再叠 **③ + 断言测试**（双保险，把"env 存在但代码不认"变成可回归的事实）。

---

## 6. 不该做（≥2 条，按危险度排序）

1. **不要跑任何 `pnpm install` / `pnpm add` / `plugin_manager install_bundle`，直到 lock 修好。** 现状下它们会**静默**清掉 35 文件补丁（实测 marker 3→0），且 lock 被就地改成 2.8.4，事后没有报错可查。
2. **不要用 `patch -p1` 的默认 fuzz（2）去做 2.8.8 rebase。** 它会"成功"、只留 5 个 `.rej`，却产出与我们标准树 **11/27 文件不一致** 的树——静默退回上游语义。只用 `git apply --check` / `patch -F0` 判定，并以 35/35 逐字节 `cmp` 收工。
3. **不要用 `pnpm add @240xu/dsh-websearch@2.8.8` 或以任何方式让 manifest 变成 2.8.8。** `overrides` 挡不住显式 add（实测 exit 0 装成 2.8.8）；只有 `patchedDependencies` 会硬失败（exit 1）。
4. **不要把 `node_modules/@240xu/dsh-websearch/.git`（HEAD `f5d4768 base`）当作版本控制。** `pnpm install` 会整目录替换，`.git` 一起消失；Lead 当前的恢复机制不可依赖。
5. **不要在 drop-in 里写 `Environment=DSH_EGRESS_FORWARDER=` 当作"已禁掉"。** 实测无效（launcher 后置 export 覆盖）。
6. **不要去 13070 起监听"让它能用"。** 那会把 2.8.8 的死路变成活路，等于替 B 提前开门。
7. **不要在 `g5/refresh.sh` 的 base 还指 2.8.4 的情况下宣称补丁"已 rebase 到 2.8.8"。** base 不换，37 段的 `cmp` 目标就仍对着 2.8.4 树，验收是假绿。

---

## 7. 对既有记录的订正（口径必须统一）

| 既有说法 | 实测 | 建议表述 |
| --- | --- | --- |
| 「4 文件 6 hunk FAILED」（g5/README） | `git apply --check`：**7 文件**（6 真冲突 + 1「已存在」）；`patch -F0`：**6 文件 11 hunk**；`patch` 默认 fuzz=2：**5 文件 7 hunk** | 写成「**严格口径：6 文件 11 hunk**（另 `util/failure-label.js` 同名已存在）；fuzz=2 放宽后表面降到 5 文件 7 hunk，但有 11/27 文件静默偏离，不可采用」 |
| 「升级 2.8.8 会覆盖 11/23 个被改文件」 | 37 段拆解：9 段 `tests/*` + 1 段 `.gitignore` + **4 段是我们新增、2.8.8 没有**（`firecrawl`/`tinyfish`/`namespace`/`web-error`）+ 23 段是"2.8.8 里也存在"的文件 | 「**23** = 我们碰过且 2.8.8 里也存在的文件；其中上游也改过 **10** 个；再加 1 个**同名新建冲突**（`util/failure-label.js`）⇒ **11 = 10 改动冲突 + 1 同名新建冲突**」 |
| 「与 2.8.8 逐字节相同 0 个」 | 23 文件集合内逐字节相同 = **0** | 成立，无需改 |
| 「2.8.8 有 sidecar 分支，本机 13070 无监听 ⇒ 默认不可用」 | 已运行时证实：**20s 卡死 + 抛错**，且 `forwarderFor()` 不 fail-open | 「不可用 = 每条外站请求先烧 20s 再失败」，比"不可用"更可验收 |

---

## 8. 风险

| # | 风险 | 触发条件 | 缓解 |
| --- | --- | --- | --- |
| R1 | lock 修复前任何 install 都会静默清补丁 | 任何人跑 `pnpm install` / 装插件 | 先做 §4.2 第 1 步；或临时把目录设为不可写 |
| R2 | `pnpm patch` 载体丢 `tests/`（10/37 段） | 用载体替代手打补丁 | 测试网继续用 `src-work/plugin/tests` + `relink-test-deps.sh`；把"测试不进安装树"写进文档 |
| R3 | 补丁文件改动 → lock 里 `patch_hash` 变化 | 更新 G5 后未重跑 `patch-commit` | 把 `refresh.sh` 扩成「重生成 G5 → 重跑 patch-commit → 校验 hash」一条链 |
| R4 | `minimumReleaseAge` 是**时间窗**，不是永久锁 | 48000 min → 约 `2026-11-23T22:10Z` 后 2.8.8 变"成熟" | 要么加宽（如 60000），要么明确它只是 tripwire，主锁仍是 `patchedDependencies` |
| R5 | B 路径的 `provider.js` 语义拼接出错 | 手拼 5 个 hunk 时选了上游/我们的一半 | 必须逐 hunk 记录裁决理由；收工前跑 8 个 `tests/lead-*.test.js` + 35/35 `cmp` |
| R6 | 删 launcher 行后，若未来真起 sidecar 会"明明设了却不走" | 后续有人部署 13070 | 在 drop-in 注释里写明「launcher 已禁；启用需同时恢复 launcher 与代码分支」 |
| R7 | 真实 profile 的 3 条 `link:/file:` 形式与 manifest 文本不一致 | 手工改 lock 时只改 websearch | 交给 `pnpm install --lockfile-only` 生成，不手改 |

---

## 9. 无法验证（诚实边界）

1. **sidecar 活着时的 2.8.8 行为**：13070 无监听、且按 §6 不该起。所以 `forwarderFetch()` 的成功路径（Host/TLS 指纹是否真能解 403）**只有上游注释可依，无本机观测**。
2. **13070 的连接语义差异**：curl/bash 立刻 `Connection refused`，而 Node `http.request` 挂到我们 25s 主动 destroy 才 `ECONNRESET`。**为什么两种客户端不同未查清**；不影响判定（两条路径都失败），但若将来要诊断 sidecar，这是第一个要解释的现象。
3. **`pnpm patch` 在未来 pnpm 版本是否仍忽略 `tests/`**：只在 v11.28.5 实测。
4. **2.8.9 是否存在/何时发**：npm 无 2.8.9、无 roadmap、latest 停在 `2026-10-21`。上游是否有"修 Host + 让 sidecar fail-open"的计划未知。
5. **B 的真实工时**：本次只做了 `git apply --check` / `-F0` 逐 hunk 计数与三方 diff 裁决分析，**未实做 rebase**，5–7 h 是基于冲突面与回归面的估计，非实测。
6. **`pnpm install --lockfile-only` 在真实 profile 的完整副作用**：只在复刻目录验证（20 行变化、随后 frozen exit 0）；真实目录**只做了只读校验**（exit 1），未落盘。

---

## 10. 证据索引（可复跑）

| 结论 | 复跑命令 |
| --- | --- |
| 2.8.8 严格冲突面 | `T=$(mktemp -d); cp -a g5/base288/package/. $T; cd $T; git init -q; git add -A; git commit -qm b; git apply --check -v g5/G5-authoritative.patch` |
| 逐 hunk 失败数 | 同上 + `patch -p1 -F0 --dry-run -N < <按文件拆开的段>` |
| fuzz 假成功 | 同上 + `patch -p1 --no-backup-if-mismatch -N < G5 patch`，然后 27 文件 `cmp` 到 `src-work/plugin` |
| 2.8.8 的 Host 403 | `node` 同时 import `lib288/util/egress-fetch.js` 与 `lib284p/…`，`DSH_EGRESS_FORWARDER=""`，`POST https://mcp.exa.ai/mcp` → `403` vs `400` |
| sidecar 致命性 | 同上但 `DSH_EGRESS_FORWARDER=http://172.30.0.1:13070/fwd`、`NO_PROXY=127.0.0.1,localhost,::1` → 20009ms 后抛错 |
| pin/lock 漂移静默清补丁 | 复刻 specifier 2.8.4 + version 2.8.8 + 手打补丁 → `pnpm install` → `grep -c findPluginRow` 由 3 变 0 |
| `patchedDependencies` 硬失败 | 同上环境加 `patchedDependencies@2.8.4` → `pnpm add @2.8.8 --save-exact` → `ERR_PNPM_UNUSED_PATCH` EXIT 1 |
| `--lockfile-only` 修法 | 复刻真实 lock → `pnpm install --lockfile-only` → `--frozen-lockfile --lockfile-only` EXIT 0 |
