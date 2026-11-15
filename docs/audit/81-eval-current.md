# 81 · 当前成果复核（A1 骨架 → Lead 补完，2026-11-15 22:10）

> A1 顾问落盘 24 行骨架 + 早期预警（G5 权威源陈旧）；Lead 逐条独立复核后补完。只读取证，未改源码/运行时。

## 1. 逐条裁决

| # | 复核项 | 裁决 | 证据 |
| --- | --- | --- | --- |
| 1 | 80/80 单测、33/33 语法、35/35 三方一致 | **成立** | `node --test` 80 pass/0 fail；`node --check` 全覆盖；`src-work`↔安装副本↔发布仓库 md5 逐文件核对 |
| 2 | **G5 权威源是旧快照** | **成立，P1（已修）** | 旧 patch 含 `req.destroy()` / `id: skipInitialize?1:2`、无 `sessionCacheKey` / 后端级缓存键；39 段 vs HEAD diff 43 段；真实 apply 到洁净 2.8.4 后仅 **25/35** 与 src-work 相同（10 个 DIFF = E1 修的 4 lib + 6 tests）⇒ 会把 N1–N4 四条 P1 全部重新引入。已由 [85 号](85-a1-g5-refresh.md) 重新生成 + `g5/refresh.sh` 固化，现 **37 段 / 3983 行 / 35/35** |
| 3 | E1 修复是否引入回归（N1–N4 / A.6–A.8） | **未发现新回归** | N1 运行态 70KB POST → **HTTP 413** + 后续 GET 200；N2 真磁盘缓存改 `baseURL` 后第二次真扇出；N3 P0 fake 改为回显请求 id 后 4 个真实后端路径不误杀，`web_search` 运行态四后端全 ✓；N4 真 HTTP 两把 key → 2 次 initialize 且各带对应 key；A.6 回滚断言 + 正常路径 disposer 4/4；A.7 `maxRunning` 避开同名遮蔽；A.8 未过期窗口仍 `⏸cooled Ns` |
| 4 | 分支内容一致性 | **成立（修复后）** | `52e26ae` → `83cfae8`（G5）→ `b17f834`（84/85 号）；远端 ref 与本地 HEAD 全 SHA 一致；`docs/audit/` 报告份数随提交递增 |
| 5 | 全历史密钥值扫描 | **0 命中** | `git log --all -p` + 工作树严格正则（cfut_/gptreg-mail-/口令/dsh-auth-/gho_/ghp_）；11-15 曾发现 `.baseline-20261111-2230/67-assessment-runtime.md` 一处旧 Set-Cookie，已脱敏 |

## 2. A1 早期预警的贡献

A1 在 21:50 报「G5 权威源与 HEAD 不一致」，Lead 独立复核后确认**比预警更严重**（25/35 而非仅「含旧代码」），并追到根因：**每次代码提交后没有强制重生成补丁**。修法不是再手工生成一次，而是新增 `g5/refresh.sh`（生成 + 37 段下限 + 洁净树 apply + 35/35 cmp，双位置可跑），把「文档声称」变成「可执行验收」。

## 3. 仍存缺陷

**无未修 P0/P1（除 D5）**。D5 是历轮重裁为「P1 待用户决定」的架构改动，见 [82 号](82-eval-d5-landing.md) / [86 号](86-borrow-review.md) §3。

## 4. 已确认无误 / 无法验证

已确认：服务 active PID 566981、三 env、`web_fetch` 200、`web_search` 8 Sources、认证三 API 200、D8 字段有值、35/35、80/80、G5 35/35、全历史 0 密钥。
无法验证（E）：真 HMR/插件卸载触发 disposer、真 429 上游 `Retry-After` 原始响应头、真并发双写 TOCTOU、GUI 目视 D8 新字段（client.js 不 fetch health/history）。

## 5. 5 条反直觉

1. 一次「已经验收过 35/35」的补丁，在**下一次代码提交后**就成了会重新引入 4 条 P1 的毒药 —— 验收是一次性的，源是活的。
2. `--dry-run` 曾对带格式缺陷的补丁误报 CLEAN；只有**真实 apply + 逐字节 cmp** 才算证据。
3. 补丁范围不收窄会把 `g5/archive/` 三份旧补丁一起 diff 进去（25494 行 / 43 段），「段数变多」反而说明范围错了。
4. 修 G5 的正确产出不是新补丁，而是**一个每次提交后必须跑的脚本**。
5. A1 预警只说「含旧代码」，独立复核才发现 apply 后只有 25/35 —— 专家预警也要自己复现，不能直接采信。

---
无凭证值写入本文件。

---

# 附录 · A1 独立复核终版（22:14 追加，不共享 / 不采信上文 Lead 结论）

> A1 于 21:43 落盘骨架 → 21:50 发出早期预警 → 21:53–22:13 独立完成全部取证。
> 上文 §1–5 是 Lead 在 21:59 覆写的「Lead 补完版」；本节是 **A1 自己的裁决**，
> 凡与上文口径不同处，以本节实测为准。取证期间工作树被并发刷新 3 次，逐次记录时间线。
> 全程只读：read/grep/glob + `node` 行为级复现（/tmp，已删）+ md5sum + 只读 git。
> 唯一写文件 = 本文件；未改源码/配置/运行时/其它报告；未操作任务板；未 commit/push。

## A. 逐条裁决表（成立 / 不成立 / 证据不足 + 命令 + 输出）

| # | 复核项 | 裁决 | 命令 | 输出（关键值） |
| --- | --- | --- | --- | --- |
| A1 | 「80/80 单测」 | **不成立（数字已过期）** | `cd src-work/plugin && node --test tests/*.test.js` | 21:45 首跑 `tests 80 / pass 80 / fail 0`；22:08 当前态重跑 **`tests 81 / pass 81 / fail 0`**。结论「无失败」成立，「80」已被 22:03 新增测试推进为 81 |
| A2 | `node --check` 全量 | **成立** | `for f in $(find lib tests -name '*.js'); do node --check "$f"; done` | `OK=41 FAIL=0`（lib 33 + tests 8）；安装副本/发布仓库与 src-work 逐字节相同，语法结论可传递 |
| A3 | 35 文件 md5 三方比对 | **成立（且更宽：45/45）** | `md5sum` 逐文件对 W=src-work / I=安装副本 / R=发布仓库 | 21:45：**45 路径 SAME=45 DIFF=0 MISSING=0**（33 lib js + 9 tests + README/package.json/cordis.patch.yml）；22:07 当前态重算仍 **45/45** |
| A4 | N1 `req.resume()` 对正常 POST / keep-alive / 极端大 body | **成立（无回归）** | 真 `http.createServer` + 真 `http.Agent({keepAlive:true})` 行为级复现 | 正常 POST `200`；70KB → `413 {"error":"request body too large"}`；**2MB** → `413`；同 keep-alive 连接后续 GET `200`；超限后同连接再发正常 POST `200`；`mutate` 仅 2 次（未被重复触发） |
| A5 | N2 `resultOptions` 摊入后端级设置后缓存键稳定 | **成立（键稳定 + 端到端不误命中）** | `cacheKeyFor` 纯函数 + 真 `createUnifiedSearchProvider` + 真磁盘缓存 | 同配置两次 key `2805e54b…` 相等；改 `baseURL` 后 `00604ea5…` 不等；`model` 变化不等；函数/`resolve*` 字段被过滤；摊入 5 键 `baseURL/model/searchDepth/safeSearch/apiKeyEnv` 覆盖 `resolveOptions()` 的全部结果相关 per-backend 字段。端到端：`calls 1→1(命中)→2(改 baseURL 不命中)→2(命中)` |
| A6 | N3 id 2/3 + plain-JSON 严格校验对 4 个真实 MCP 后端误杀风险 | **成立（回显 id 时零误杀）+ 证据不足（真实 outer id 未取证）** | 抽出真 `parseEnvelope` + **真 `mcpCall` + 假 fetch** 全链路复现（exa/parallel/firecrawl/tinyfish keyless+keyed 五种形态） | 期望 id=2（skip）/3（sessionful）；响应**回显请求 id**/`"2"` 字符串 id/**无 id**/SSE 回显 → 全部 OK；`foreign id=7` → `WEB_PROVIDER_ERROR`（设计如此）；混合 SSE（id1 initialize + id3 real）挑中 real；SSE 全帧 id 不匹配 → `failed to parse response envelope`。**但** 00/05 号一手实测只记录了 `result.content[0].text`，**未记录外层 JSON-RPC envelope 的 `id` 字段**——「4 个真实后端一定回显请求 id」是 JSON-RPC 规范推断，非本机抓包证据，标「证据不足」 |
| A7 | N4 `sessionCacheKey` keyless / 并发同 URL 不同 key 串会话 | **成立（核心无串会话）+ 次要缺口** | 真 `sessionCacheKey` 纯函数 + 真 `mcpCall` 并发复现 | `KEY_A≠KEY_B`、`Auth A≠Auth B`、大小写归一、URL 不同、keyless `X-TinyFish-Access-Mode` 与 `{}` 不同键；并发同 URL 两 key → **2 次 initialize，各带 CONC_A/CONC_B**；KEY_A 再来命中缓存不 initialize。**缺口**：白名单仅 `authorization/x-api-key/x-tinyfish-access-mode` 3 头，`keyless({})` 与「任意无关头」（`User-Agent`/`Accept`）同键；且 `invalidateSession(url, extraHeaders)` 在 `mcpCall` 的 401/403/404 重试路径带摘要正确，但 4 个后端除 tinyfish keyed 外全 `skipInitialize:true`，会话缓存实际只在 tinyfish keyed 生效 |
| A8 | A.6 disposer 回滚在正常路径 4 路由全注册 | **成立** | 真 `registerHealthRoute/registerHistoryRoutes/registerSettingsRoutes` 行为级复现 | 正常路径 `注册路由数=4 disposer=4`，`dispose 后剩余=0`；异常路径（第 3 次 register 抛错）源码含 `disposers.reverse()` 逆序回滚 + `throw err`，81 号已有断言 |
| A9 | A.7 `maxRunning` 并发上限 = 配置值 | **成立** | `createLimiter(n)` + 6 任务测 peak | `0/-1/NaN/undefined/1 → peak=1`；`3 → peak=3`；全部 `done=6`。`maxRunning` 命名避开与返回函数 `limit` 冲突 |
| A10 | A.8 窗口未过期时 `⏸cooled Ns` 无多余后缀 | **成立** | `cooledAnnotation(live,t0)` + `isCooled(live,t0)` | 窗口内 `"⏸cooled 42s"`，渲染 `isCooled=true` → 无 `(expired during search)`；慢搜索过期时 `ann` 非空 + 后缀，`isCooled=false` 时 `ann=""` 不会进 cooledParts |
| A11 | **G5 权威源：对洁净 2.8.4 `git apply --check` + 真实 apply + 35/35 逐字节** | **部分成立（存在 3 个不同版本的补丁，其中 1 个仍陈旧）** | `git archive d2602823`→`git init`→`git apply --check`→`git apply`→`cmp` 35 文件 | 见下方 §A′ 时间线。**当前最终态**：发布仓库工作树 B / HEAD 树 C / `git diff d2602823 HEAD -- lib tests README.md package.json .gitignore` Fresh 三者 md5 同为 `0491d5af…`、37 段、`apply --check=0`、真实 apply 后 **35/35 byte-identical** ⇒ **成立**。但**顶层 `g5/G5-authoritative.patch` A 仍为 `17abefa5…`（83cfae8 时代旧快照），apply 后 33/35（DIFF: README.md、tests/lead-20261107.test.js）** ⇒ 该路径下的「唯一权威源」**不成立** |
| A12 | `g5/archive/` 三份旧补丁被 README 标为非权威 | **成立（3 份）+ 不成立（第 5 份）** | `g5/README.md` §「归档（仅参考，非权威）」+ `md5sum`/`cmp` | README 表格逐一点名 `G5-lead-legacy.patch` / `G5-e2-284.patch` / `G5-e2-35files.patch` 并给出非权威理由。**但** `g5/G5-full-35files.patch`（177338 B）与 `archive/G5-lead-legacy.patch` **md5 完全相同 `fcb6c4a0…`（逐字节相同）**，且 README **0 次提及** 该文件名 ⇒ 同一份已知有格式缺陷的旧补丁以「非 archive」文件名仍留在权威目录，未被标记 |
| A13 | 分支 HEAD 与远端 `local-audit-35files-20261115` 一致 | **成立（持续同步）** | 只读 `git ls-remote origin` + `git rev-parse` | 21:45 `52e26ae`=远端；22:06 `37d7200`=远端；22:08 `b14679f`=远端；22:13 远端 `b14679f`=本地 HEAD。**但** 分支名是 **`master`**（远端跟踪 `origin/local-audit-35files-20261115`），远端 `main`/HEAD 仍是 `da42e44a`（未合并），「已推送分支内容正确」仅对该分支成立 |
| A14 | `docs/audit/` 报告份数 | **不成立（数字已过期）** | `find docs/audit -name '*.md' | wc -l` | 21:45 `84`；22:08 `92`；22:12 `92`。收口结论里的固定份数已被并发提交推进 |
| A15 | 全历史密钥值扫描（值，不是变量名） | **成立（0 命中）+ 2 个配置层注记** | `git cat-file --batch-all-objects` 全部 235→更多 blob 逐 blob `grep -F` 真实值 + 每 commit `git grep -F` | 真实值 `ghp_<REDACTED>…`/`cfut_rJd…`/`gptreg-mail-<REDACTED>`/`<REDACTED>`/`<REDACTED>` 在**所有 blob（含不可达/reflog 旧 commit）0 命中**；`ghp_`/`cfut_` 命中的全是**扫描正则文本**与「值未写入」声明。**注记 1**：`.git/config` remote URL 内嵌明文 PAT `ghp_…@github.com`（本地配置层，不进 blob、不推送，但本机可读）。**注记 2**：`ova442757@163.com` 在 HEAD 树 6 处（LICENSE + 5 份 docs/audit），是**公开 commit author 邮箱 / 账号名**，非口令/token 值；32/54/62 号已自裁为 P2 边缘 |
| A16 | 「无未修 P0/P1（除 D5）」 | **不成立（存在 2 条未修项，见 §B）** | 见 §B1/B2 行为级证据 | D5 之外仍有一条 P1（G5 顶层权威源陈旧）与一条 P2（第 5 份补丁未标记）；且 D5 本身经 `getLatestBackendHealth()` 复现为**模块级单例 Map，两 provider 实例 `===` 共享**（跨会话干扰仍在，确为未修 P1） |
| A17 | 「已推送分支内容正确」 | **不成立（口径不全）** | A11+A13 | 代码层 45/45 正确、远端同步正确；但提交进 HEAD 的 `G5-authoritative.patch` 在 21:52–22:05 之间一度是旧快照（`17abefa5`），22:05 后才刷新为 `0491d5af`；顶层 artifacts 目录的「唯一权威源」至今仍是旧快照。收口时点若早于 22:05，该结论不成立 |

## A′. 取证期间并发变更时间线（关键：结论随采样时点漂移）

| 时点 | 事件 | A1 观测 |
| --- | --- | --- |
| 21:43 | 落盘 24 行骨架 | — |
| 21:45 | 首轮取证 | 80/80、45/45 SAME、HEAD `52e26ae`(7 commits)、docs/audit `84`、远端 `52e26ae` |
| 21:50 | A1 早期预警（G5 旧快照 10 个 DIFF） | patch 39 段 md5=`369942B` 级旧版，apply 后 45 文件 **SAME=35/DIFF=10**，10 个 DIFF 的 md5 全 == `230c1cf`（E1 修复前）、work/HEAD == `52e26ae`（修复后）；patch 内 `req.destroy()`、`id: skipInitialize?1:2`、无 `sessionCacheKey`、无后端级 `resultOptions` |
| 21:52 | Lead 新增 `g5/refresh.sh` + 重生成 37 段 patch `17abefa5` | README 改为「每次提交后必须跑 refresh.sh」，声明 37 段/3983 行/35/35 |
| 21:55 | README 记「验收 21:55」 | — |
| 21:59 | **Lead 覆写本文件**为「补完版」（37 行，声称 80/80、52e26ae→83cfae8→b17f834、25/35） | A1 未采信，继续独立取证 |
| 22:03–22:04 | 三副本 `tests/lead-20261107.test.js` 被改为 `09a61046…` | 21:52 patch 段仍是旧 blob `166a1e7` ⇒ 第二次脱节：A apply 后 **33/35**（README + 该测试 DIFF） |
| 22:05 | 工作树 patch 刷新为 `0491d5af`（37 段，4024 行），提交 `b14679f` | B/C/Fresh 三者一致、35/35 成立；**顶层 A 未同步** |
| 22:06–22:08 | HEAD `37d7200`→`b14679f`，远端同步；81/81；docs/audit 92；commits 11 | 稳定态 |

> 反直觉事实：README 写「35/35」，但同一时刻顶层 `g5/` 与 `publish-work/repo/g5/` 是**两份不同的 `G5-authoritative.patch`**；`git status` clean 只保证发布仓库自洽，不保证 artifacts 顶层副本自洽。

## B. 新缺陷清单（现状 / 影响 / 最小 diff / 回归断言）

### B1 · **P1｜顶层「唯一权威源」仍是旧快照，apply 后 33/35**（A1 原始发现未被完全修净）
- **现状**：22:13 采样，`/home/ova/dsh/.artifacts/websearch-research/g5/G5-authoritative.patch` md5 `17abefa573a7`（== `83cfae8` 提交的版本，21:52），而发布仓库工作树/HEAD 树/`git diff …` 三者均为 `0491d5af7d67`（22:05）。README §3「唯一权威源 `G5-authoritative.patch`」未区分路径，用户/PR 评审按 README 从 artifacts 顶层取补丁即拿到旧版：`apply --check` 仍 exit 0（补丁语法合法），真实 apply 到洁净 2.8.4 后 **35 文件 SAME=33**，DIFF = `README.md`、`tests/lead-20261107.test.js`。相对更早的 21:45 版（35/45、含 4 条 P1 旧代码）已收敛，但**「唯一权威源 35/35」这一收口结论在顶层路径不成立**。
- **影响**：对外 PR / patch-package / 手工升级若取顶层补丁，落地产物与已推送分支差 2 文件（其中 `tests/lead-20261107.test.js` 是 22:03 新增的回归断言）；交付物分叉会重演 21:50 那类「一次性验收 ≠ 持续一致」事故。
- **最小 diff**：`cp publish-work/repo/g5/G5-authoritative.patch g5/G5-authoritative.patch`（或把 `refresh.sh` 的输出同时写到两处并 `cmp` 双份）；README §3 明确「唯一权威源 = `publish-work/repo/g5/G5-authoritative.patch`，顶层 `g5/` 副本为派生、必须 `cmp -s` 相等」。
- **回归断言**：`refresh.sh` 末尾追加
  ```bash
  cmp -s "$OUT" "$HERE/../publish-work/repo/g5/G5-authoritative.patch" \
    || { echo "top-level copy stale" >&2; exit 1; }
  ```
  并加一条测试：`git apply --check` + 真实 apply 后 `cmp` 35 文件 = 35/35，且 `md5sum` 顶层==仓库==`git diff d2602823 HEAD -- lib tests README.md package.json .gitignore`。

### B2 · **P2｜第五份补丁 `G5-full-35files.patch` 未标非权威，且与已知缺陷补丁逐字节相同**
- **现状**：`g5/G5-full-35files.patch` 177338 B，md5 `fcb6c4a091e7` == `g5/archive/G5-lead-legacy.patch`（README 已判「段头含 `|---`、`patch -p1` 真实 apply 交互等待、22 个修改文件未生效、`--dry-run` 误报 exit 0」）。README 的「归档（仅参考，非权威）」表只列 archive/ 三份，**对该文件 0 次提及**；`grep -c '^diff --git'` = 0（是 `--- a/` 手工 diff 格式）。
- **影响**：权威目录里存在一份「看起来像主补丁、实际是已废弃格式」的同名近似文件，按 README「唯一权威源」以外的直觉取用会踩已知格式陷阱。
- **最小 diff**：把它移入 `g5/archive/`（或删除），并在 README 归档表补一行 `G5-full-35files.patch | Lead 首版别名 | 与 archive/G5-lead-legacy.patch 逐字节相同，格式缺陷同上`。
- **回归断言**：`for f in g5/*.patch; do [ "$(basename "$f")" = G5-authoritative.patch ] || grep -q "$(basename "$f")" g5/README.md; done` + `cmp -s` 检查 archive 与权威源不相同。

### B3 · **P2｜`sessionCacheKey` 白名单外认证头不参与键；且会话缓存对 4 后端大多不生效**（新发现，非回归）
- **现状**：`sessionCacheKey` 只摘要 `authorization|x-api-key|x-tinyfish-access-mode`；`keyless({})` 与 `{ "User-Agent": "x" }` / `{ "Accept": "…" }` 得到**同一键** `https://mcp.example/mcp\0`。同时 4 个后端中 exa/parallel/firecrawl 全 `skipInitialize:true`、tinyfish keyless 也 `skipInitialize:true`，只有 **tinyfish keyed** 走 `ensureSession` ⇒ 会话缓存实际覆盖面极窄。
- **影响**：当前 4 后端配置下无实际串会话（已行为级验证）；但若将来某 keyless 端点改用自定义认证头（如 `X-Exa-Api-Key`、`X-Tavily-Access-Mode`）并启用 sessionful 模式，换 key 会复用旧 `Mcp-Session-Id`。属潜在设计缺口，非当前线上故障。
- **最小 diff**：白名单改为「按值指纹纳入所有非空 extraHeaders」，或至少补 `x-.*-api-key|x-.*-access-mode|x-subscription-token`；`sessionCacheKey` 对 `extraHeaders` 全键排序后 join（排除 `content-type`/`accept`/`user-agent` 等无认证语义头）。
- **回归断言**：`sessionCacheKey(url, {"X-Custom-Auth":"A"}) !== sessionCacheKey(url, {"X-Custom-Auth":"B"})`；并发两不同自定义头触发 2 次 initialize 且各带对应头。

### B4 · **P1（已确认未修，历轮 D5）｜`latestBackendHealth` 模块级单例跨会话干扰仍在**
- **现状**：`getLatestBackendHealth()` 返回同一个模块级 `Map`（两个 `createUnifiedSearchProvider` 实例 `===` 共享）；本进程 `size=0`。80/82 号重裁为「P1 待用户决定」。
- **影响**：会话 A 全 429 → 全健康的会话 B 被 3b 快速失败、零调用。
- **最小 diff / 断言**：按 82 号方案改 per-session `healthStore` 注入 provider/health/history；断言「A 会话写 cooled 后 B 会话 `search` 仍发起后端调用」。**本轮只读，未改。**

## C. 已确认无误（A1 独立行为级证据）
1. N1 `req.resume()`：正常 POST 200 / 70KB 413 / **2MB 413** / keep-alive 后续 GET 200 / 同连接再 POST 200，无 ECONNRESET、无 `mutate` 重复。
2. N2 缓存键：同配置两次相等且端到端命中、改 `baseURL` 不命中旧键、改 `model` 不等、函数字段被过滤；摊入 5 键覆盖 `resolveOptions` 全部结果相关 per-backend 字段。
3. N3：真 `mcpCall` + 假 fetch 全链路，5 种后端形态下「回显请求 id / 字符串 id / 无 id / SSE 回显」均不误杀；`foreign id` 按设计抛 `WEB_PROVIDER_ERROR`；混合 SSE 挑中 id=3。
4. N4：`KEY_A→KEY_B` 两次 initialize 各带对应 key；并发同 URL 不同 key **不串会话**；大小写归一；keyless `X-TinyFish-Access-Mode` 与 `{}` 不同键。
5. A.6 正常路径 4 路由全注册 + 4 disposer 全部可回滚到 0；异常路径源码逆序回滚 + 重抛。
6. A.7 `maxRunning` = `Math.max(1, floor(Number(c)||1))`，0/-1/NaN/undefined 全在 200ms 内 resolve、peak=1；配置 3 → peak=3。
7. A.8 窗口未过期仍 `⏸cooled 42s` 无多余后缀；仅渲染时过期才追加 `(expired during search)`。
8. 三方 45 文件逐字节一致（22:13 稳定态）；`node --check` 41/41；`node --test` 81/81；远端 ref == 本地 HEAD `b14679f`。
9. 全 git 对象（含不可达/reflog 旧 commit）按真实凭证值 0 命中；`ova442757@163.com` 是公开 author 邮箱，非口令值。
10. 服务 active PID 566981（11-15 15:25:14 起，22:13 仍存活），`127.0.0.1:3080` 监听，env 含 `DSH_EGRESS_FORWARDER=http://172.30.0.1:13070/fwd`、`HTTPS_PROXY=http://172.30.66.1:1091`、`DSH_HOME=/home/dsh/.dsh`。

## D. 无法验证（E，明确列出，不算「已确认无误」）
1. **4 个真实 MCP 后端外层 JSON-RPC envelope 的 `id` 字段**：00/05 号一手实测只记录 `result.content[0].text`，无 outer envelope 抓包；N3 零误杀结论建立在「JSON-RPC 回显请求 id」规范 + 假 fetch 复现上，未对 `mcp.exa.ai` / `search.parallel.ai` / `mcp.firecrawl.dev` / `agent.tinyfish.ai` 做真实带 `id=2/3` 的现网复验（本轮只读、未改运行时、未发外网请求）。
2. 真 HMR / 插件卸载触发 `webCtx.effect` disposer 的运行时路径（只做了注册函数级行为复现）。
3. 真 429 上游 `Retry-After` 原始响应头、真并发双写 TOCTOU、GUI 目视 D8 字段。
4. G5 补丁对 npm 2.8.8 的 `git apply --check` 失败口径（README 称「4 文件 6 hunk FAILED」）：本轮未重跑 2.8.8 树，沿用历轮结论。
5. 顶层 A 旧补丁是否已被 Lead 在 22:13 之后再次同步（采样截止 22:13:09）；若之后刷新，B1 自动消解，但 A′ 时间线仍成立。

## E. 5 条反直觉（A1 版）
1. **`git apply --check` exit 0 与「补丁内容正确」毫无关系**：21:45 的 39 段旧补丁 `--check` 与真实 `apply` 都 exit 0，落地后却与当前代码差 10 个文件——其中 4 个正是刚修完的 P1。语法合法性不校验语义时效性。
2. **收口结论里的数字会自己过期**：21:45 是「80/80、84 份、7 commits、52e26ae」，22:08 变成「81/81、92 份、11 commits、b14679f」，期间 A1 没改任何源码——是并发提交把「已验收」的事实推走了。
3. **同一文件名在两处是两份不同的补丁，且 `git status` 是 clean**：`git status` 只保证发布仓库自洽；artifacts 顶层 `g5/` 是派生副本，README 用「唯一权威源」指了它却没约束它必须与仓库 `cmp -s`。
4. **`.git/config` 里明文 PAT 与「全历史 0 密钥」可以同时为真**：remote URL 的 `x-access-token:ghp_…@` 不在任何 blob 里、不推送、不进 `git grep --all`，但本机任意可读进程能拿到——「值级扫描全历史」不覆盖本地配置层。
5. **修 G5 的真正产出不是补丁而是脚本，但脚本也会晚于代码提交**：`refresh.sh` 21:52 落地并声明「每次提交后必须跑」，22:03 代码提交后仍出现 33/35 分叉，22:05 才补跑——把验收固化成脚本解决了「忘了」，没解决「顺序」，必须挂进 pre-commit / CI 才闭合。

## F. 给 lead 的 ≤12 行简报
见 `send_message` 已发送内容（21:50 早期预警 + 本轮终版）。
核心：**发现 2 条未修项**——(1) 顶层 `g5/G5-authoritative.patch` 仍是 21:52 旧快照，apply 后 33/35，与已推送 HEAD 树 `0491d5af` 分叉；(2) `g5/G5-full-35files.patch` 与已判非权威的 `archive/G5-lead-legacy.patch` 逐字节相同却未标记。D5 仍是未修 P1。E1 的 N1–N4 / A.6–A.8 经 A1 独立行为级复现**无新回归**；80/80→81/81、84→92 份属并发推进，非缺陷。

---
A1 独立复核终版完。无凭证值写入本文件。

