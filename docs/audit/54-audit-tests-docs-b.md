# 54 · 备份版审计 D（测试/文档/回滚）· 独立完整报告

> **唯一写文件**：`/home/ova/dsh/.artifacts/websearch-research/54-audit-tests-docs-b.md`。
> `54-audit-tests-docs.md` 在本次调研开始与落盘时均**不存在**（`ls 54-audit-tests-docs*.md` 无命中），
> 故本文件是**独立全量备份版**，不是交叉复核补遗；不覆盖、不删减任何其它报告。
> 未改源码/配置/运行时/其它报告；未操作任务板；全程只读（read/grep/glob + 只读 bash + `node --test` 实跑 + md5sum）。
> 取证时间 2026-11-08 22:40–23:07 Asia/Shanghai，主机 `wuming`。
>
> **证据等级**（全队规范，见 [07 §8.1](07-dsh-docs.md)）：**A**＝源码实证（路径:行号）；
> **B**＝官方规范/仓库明文；**C**＝版本记录；**D**＝本机实测（命令+exit code/输出）；
> **E**＝推断或待核实（显式标注，不得当结论）。
>
> **基线**：`.baseline-20261108-2205/`；服务 11-08 12:40 重启（Lead 背景，MainPID 见 §3）。

---

## 0. 三项核心结论（先行）

| # | 项 | 结论 | 等级 |
|---|---|---|---|
| ① | 6 个测试文件断言分类 + 实跑 | **152 个 `assert.*` 调用 / 43 个 `test()`**；`node --test tests/*.test.js` 在 `src-work/plugin/` **43/43 pass / 0 fail**（exit 0），在**安装目录** 33 tests / 28 pass / **5 fail**（路径陷阱，非回归）。**源码级静态断言 ≈ 96 条、真行为级 ≈ 56 条**（逐文件见 §1.2）。**发现 1 处自指假绿**（`lead-20261106.test.js:215-221` 把修复逻辑抄进测试再断言）、**2 处源码文本断言无行为验证**（§1.4） | **A/D** |
| ② | 回滚链 23 文件 ↔ 16 `*.orig` ↔ 25 §6 | **不完整**。16 个 `.orig` 全齐（含 `breaker.js.orig`/`exa.js.orig`/`parallel.js.orig`）；但 25 §6 的 `rm` 清单**只列 3 个新增文件**，实际新增 **10 个**（`failure-label.js`、`namespace.js`、2 backend、6 新测试全缺）；且 §6 的 `cp` 只列 4 个文件，实际修改 **13 个** | **A/D** |
| ③ | 过时表述 | 25/45/49/50/REPORT/99 中至少 **20 处**数字/状态过时：份数（25/53）、文件数（10/17/23）、备份数（8/13/16）、单测数（18/25/43）、PID（262230/2097/2334）、「待决项已执行」 | **A/D** |

---

## 1. ① 6 个测试文件逐条审计

### 1.1 实跑记录（D，只读）

```sh
S=/home/ova/dsh/.artifacts/websearch-research/src-work/plugin
cd "$S" && node --test tests/*.test.js
```

```
1..43
# tests 43
# suites 0
# pass 43
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 360.057601
```
**exit code 0**。

对照（**路径陷阱，A/D**）：`cd /home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch && node --test tests/*.test.js`
→ `1..33 / # pass 28 / # fail 5`；5 个失败全为
`Cannot find package '@deepseek-ai/dsh-web' imported from …/lib/backends/firecrawl.js` 等。
原因：`src-work/plugin/node_modules/@deepseek-ai/*` 是测试专用 symlink（25 §1:25 已注明），安装目录 `lib/` 保持纯净。
⇒ **43/43 只在 `src-work/plugin/` 成立**；审查者若在安装目录跑会误报 5 个回归。

### 1.2 逐文件统计（A/D）

| 文件 | 行数 | `test()` | `assert.*` | **源码级静态** | **真行为级** | 恒真/自指/硬编码 |
|---|---|---|---|---|---|---|
| `tests/lead-20261106.test.js` | 222 | 11 | 55 | **34** | **21** | ⚠️ **1 处自指**（`:215-221`）+ 2 处源码文本锚点 |
| `tests/lead-20261107-p0.test.js` | 112 | 4 | 13 | **5** | **8** | 0（fake `globalThis.fetch` 驱动真 backend） |
| `tests/lead-20261107.test.js` | 116 | 4 | 16 | **4** | **12** | 0（`:74-76` **从 provider.js 提取正则**，非硬编码，已修正历史问题） |
| `tests/lead-20261108-interaction.test.js` | 112 | 9 | 35 | **35** | **0** | ⚠️ **全部源码级**（文件头 `:16-18` 自承「assert the applied fixes at source level」） |
| `tests/lead-20261108-quota.test.js` | 43 | 3 | 17 | **0** | **17** | 0（直接 import `foldBreaker`/`rateLimited` 真函数） |
| `tests/settings-api.test.js` | 147 | 5（含 7 组 `for` 生成 = 12 子测试） | 16 | **0** | **16** | 0（真实 `registerSettingsRoutes` + fake Host，走真实 HTTP handler） |
| **合计** | **752** | **43**（`for` 展开后） | **152** | **≈96** | **≈56** | — |

> 计数口径：`assert.*` 出现次数按 `grep -cE 'assert\.'`；`for` 循环生成的子测试按实跑 `1..43` 计。
> 「源码级静态」＝`readFileSync(...)` + `assert.match/doesNotMatch/includes` 匹配源码文本；
> 「真行为级」＝调用真函数/真 backend/真 HTTP handler 并断言返回值、请求头、URL、缓存键。

### 1.3 逐条裁决：恒真 / 自指 / 硬编码 / 只匹配源码文本

| # | 文件:行号 | 断言 | 判定 | 等级 |
|---|---|---|---|---|
| 1 | `lead-20261106.test.js:215-221` | `test("issue #8: ok:false envelope is rejected…")`：在测试体内**重新写一遍** `const rejected = res.ok === false; assert.equal(rejected, true); assert.throws(() => { if (rejected) throw … })` —— 被测的「修复逻辑」是测试自己抄的副本，不是 `lib/client.js` 的真实代码 | ⚠️ **自指假绿**：删掉 `client.js` 的 `ok:false` 检查，这条测试**仍然通过**。测试名承诺行为级，实际是恒真+自指 | **A/D** |
| 2 | `lead-20261106.test.js:102-108` | `assert.match(src, /delete headers\["host"\]/)` + 数 `headers.host ?? target.host` 出现 2 次 | **只匹配源码文本**，不验证 Host 真被发出；但 `:103-107` 注释已诚实说明「source-level regression」「manual A/B in 22 §1.2」⇒ **可接受的诚实标注**，不是隐瞒 | **A** |
| 3 | `lead-20261106.test.js:111-115, 119-211` | 4 个 test 全为 `readFileSync(lib/client.js)` + 正则匹配 `inject`/`guards`/`KeyedBackendCard`/`metered` 等 | **只匹配源码文本不验证行为**；但 `:117-118` 注释自承「bundled client module, so assert statically rather than rendering React」⇒ 诚实标注，**可接受**；风险是源码重构（等价改写）会让测试误红 | **A** |
| 4 | `lead-20261107.test.js:72-83` | 正则**从 `provider.js:74` 提取**（`const m = src.match(/const privHost = bu \? (\/.*?\/)\.test\(bu\.hostname\)/)`）再测 13 个 host | ✅ **非硬编码**（`:70-71` 注释明说「a hard-coded copy would make this test tautological」）——这是对 35 号主版「硬编码正则恒真」的**已修正** | **A/D** |
| 5 | `lead-20261107-p0.test.js:99-112` | `source-level` test 里 `assert.match(idx, /findPluginRow\(settings\.describe\(\)\)/)` 等 | 只匹配源码文本，但同文件 `:48-97` 有 3 个真行为级 test 兜底 ⇒ **可接受** | **A** |
| 6 | `lead-20261108-interaction.test.js:20-112` | **9 个 test / 35 断言全部** `readFileSync` + `assert.match/doesNotMatch` | ⚠️ **整文件零行为级断言**。文件头 `:16-18` 自承「Behaviour-level reproductions … live in 40-bug-interaction.md §6」（**在报告里，不在测试里**）⇒ 若 `client.js` 里 `safeFailureReason` 实现被改坏但函数名/正则形状保留，这 9 条仍全绿 | **A/D** |
| 7 | `lead-20261108-quota.test.js:9-43` | 直接 `import { foldBreaker }`/`{ rateLimited, retryAfterMsFrom }` 并断言真实返回 | ✅ **真行为级**，0 源码级；`:13` 甚至测中文 `额度不足` | **A/D** |
| 8 | `settings-api.test.js` | `registerSettingsRoutes` + fake `webServer`/`req`/`res`，断言真实 HTTP 状态码 400/409/200 与 `mutate` 调用参数 | ✅ **真行为级**（走真实 handler 路径，不导出私有函数） | **A/D** |
| 9 | 全库 `grep -rnE 'length >= 0|assert.ok\(true\)|assert.equal\(1, 1\)|toBeTruthy\(\)|toBeDefined\(\)'` | **0 命中** | ✅ 无经典恒真断言 | **A/D** |

**关键发现（假绿）**：**`lead-20261106.test.js:215-221` 是唯一明确的「自指假绿」**——它把 `ok:false` 判定逻辑抄进测试，
断言对象是测试自己的局部变量，不是 `lib/client.js`。同文件 `:180-211` 已有对应源码级静态断言，
但那条只验证「源码里有这段文本」，也不验证运行时行为。⇒ **Issue #8 的 `ok:false` 拒绝行为目前没有真正的行为级回归证据**（E：未实跑浏览器保存）。

### 1.4 已确认无误（测试）

| # | 事实 | 等级 |
|---|---|---|
| 1 | 无 `length >= 0` / `assert.ok(true)` / `.toBeTruthy()` 等经典恒真 | **A/D** |
| 2 | 无 live network：所有 `fetch` 均被 `globalThis.fetch` fake 或走 `withFakeFetch`；`lead-20261107.test.js:23-28` 与 `p0:25-27` 主动清除代理 env | **A/D** |
| 3 | 无真实 key：只用 `"FC-TEST-KEY"` / `"TF-TEST-KEY"` 字面量 | **A/D** |
| 4 | `43/43` 实跑绿（src-work 路径）；`settings-api.test.js` 不 import 任何 `@deepseek-ai/*`，安装目录裸跑亦不受缺包影响 | **D** |

---

## 2. ② 回滚链逐文件核对（23 改动 ↔ 16 `*.orig` ↔ 25 §6）

### 2.1 三个集合的实测（A/D）

```sh
B=/home/ova/dsh/.artifacts/websearch-research/src-work/backups
ls "$B"/*.orig | wc -l     # 16
```

**16 个 `*.orig` 全清单**（按文件名）：`client.js.orig`、`cordis.patch.yml.orig`、`egress-fetch.js.orig`、
`index.js.orig`、`mcp-client.js.orig`、`profile-cordis.patch.yml.orig`、`profile-package.json.orig`、
`provider.js.orig`、`cache.js.orig`、`breaker.js.orig`、`exa.js.orig`、`parallel.js.orig`、
`health.js.orig`、`history.js.orig`、`trust.js.orig`、`settings-api.js.orig`。

⇒ **`breaker.js.orig` / `exa.js.orig` / `parallel.js.orig` 三者齐全** ✅（A/D）。

**25 §6（当前 25-execution-log.md）回滚块**逐字（A）：

```bash
P=/home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch
B=/home/ova/dsh/.artifacts/websearch-research/src-work/backups
cp "$B/egress-fetch.js.orig" "$P/lib/util/egress-fetch.js"
cp "$B/mcp-client.js.orig"   "$P/lib/util/mcp-client.js"
cp "$B/index.js.orig"        "$P/lib/index.js"
cp "$B/client.js.orig"       "$P/lib/client.js"
rm -f "$P/lib/backends/firecrawl.js" "$P/lib/backends/tinyfish.js" "$P/tests/lead-20261106.test.js"
sudo rm -f /etc/systemd/system/dsh-web.service.d/10-websearch-lead-fix.conf
sudo systemctl daemon-reload
sudo systemctl restart dsh-web.service
```

### 2.2 逐文件核对表（**关键不一致**）

> 改动文件以 `.baseline-20261108-2205/PLUGIN_CHECKSUMS.txt` 与实际安装目录 `lib/` mtime/内容判定；
> 「23 = 13 修改 + 10 新增」为 Lead 给定口径，本表按实文件逐一验证。

| # | 改动文件（安装目录相对路径） | 类型 | `.orig` 备份 | 25 §6 是否覆盖 | 判定 |
|---|---|---|---|---|---|
| 1 | `lib/util/egress-fetch.js` | 修改 | `egress-fetch.js.orig` ✅ | ✅ `cp` | OK |
| 2 | `lib/util/mcp-client.js` | 修改 | `mcp-client.js.orig` ✅ | ✅ `cp` | OK |
| 3 | `lib/index.js` | 修改 | `index.js.orig` ✅ | ✅ `cp` | OK |
| 4 | `lib/client.js` | 修改 | `client.js.orig` ✅ | ✅ `cp` | OK |
| 5 | `lib/provider.js` | 修改 | `provider.js.orig` ✅ | ❌ **缺 `cp`** | **不一致** |
| 6 | `lib/cache.js` | 修改 | `cache.js.orig` ✅ | ❌ 缺 | **不一致** |
| 7 | `lib/breaker.js` | 修改 | `breaker.js.orig` ✅ | ❌ 缺 | **不一致** |
| 8 | `lib/backends/exa.js` | 修改 | `exa.js.orig` ✅ | ❌ 缺 | **不一致** |
| 9 | `lib/backends/parallel.js` | 修改 | `parallel.js.orig` ✅ | ❌ 缺 | **不一致** |
| 10 | `lib/health.js` | 修改 | `health.js.orig` ✅ | ❌ 缺 | **不一致** |
| 11 | `lib/history.js` | 修改 | `history.js.orig` ✅ | ❌ 缺 | **不一致** |
| 12 | `lib/trust.js` | 修改 | `trust.js.orig` ✅ | ❌ 缺 | **不一致** |
| 13 | `lib/settings-api.js` | 修改 | `settings-api.js.orig` ✅ | ❌ 缺 | **不一致** |
| 14 | `lib/util/failure-label.js` | **新增** | 无（应 `rm`） | ❌ **不在 rm 清单** | **不一致** |
| 15 | `lib/util/namespace.js` | **新增** | 无（应 `rm`） | ❌ **不在 rm 清单** | **不一致** |
| 16 | `lib/backends/firecrawl.js` | 新增 | 无 | ✅ `rm` | OK |
| 17 | `lib/backends/tinyfish.js` | 新增 | 无 | ✅ `rm` | OK |
| 18 | `tests/lead-20261106.test.js` | 新增 | 无 | ✅ `rm` | OK |
| 19 | `tests/lead-20261107.test.js` | 新增 | 无 | ❌ **不在 rm 清单** | **不一致** |
| 20 | `tests/lead-20261107-p0.test.js` | 新增 | 无 | ❌ **不在 rm 清单** | **不一致** |
| 21 | `tests/lead-20261108-interaction.test.js` | 新增 | 无 | ❌ | **不一致** |
| 22 | `tests/lead-20261108-quota.test.js` | 新增 | 无 | ❌ | **不一致** |
| 23 | `tests/settings-api.test.js` | 新增 | 无 | ❌ | **不一致** |

**汇总（A/D）**：
- 16 个 `.orig` **全齐**，覆盖 13 个修改文件中的 13 个（多出的 3 个 `cordis.patch.yml.orig`/`profile-*` 是未改动/别处文件）✅
- 25 §6 只写 **4 个 `cp`**（缺 9 个）+ **3 个 `rm`**（缺 7 个）⇒ **16 处遗漏**
- **`failure-label.js` / `namespace.js` / 2 新 backend 中 `firecrawl`/`tinyfish` 已列、6 新测试中只有 1 个已列** ⇒
  Lead 点名的 6 个重点对象里，**5 个不在 rm 清单**（`failure-label.js`、`namespace.js`、`lead-20261107.test.js`、
  `lead-20261107-p0.test.js`、`lead-20261108-interaction.test.js`、`lead-20261108-quota.test.js`、`settings-api.test.js` 共 7 个缺）。
- 另有 `profile-cordis.patch.yml`（第十处未登记改动，见 [32 §2.3](32-adversarial-ops-b.md)）与 systemd drop-in 也未完整覆盖。

> **反直觉点**：备份数量（16）**大于** §6 的 `cp` 数量（4），说明备份是逐轮补齐的，而**回滚命令块从未同步更新**。
> 按 §6 原样执行后，仍有 9 个修改文件保留补丁、7 个新增文件残留 ⇒ **「完整回滚 / 全可逆」不成立**（P1）。

### 2.3 建议修法（**只给提案，未执行**）

```diff
--- a/25-execution-log.md §6
+++ b/25-execution-log.md §6
@@ 1) 恢复代码到改前（13 个修改文件）
 cp "$B/egress-fetch.js.orig" "$P/lib/util/egress-fetch.js"
 cp "$B/mcp-client.js.orig"   "$P/lib/util/mcp-client.js"
 cp "$B/index.js.orig"        "$P/lib/index.js"
 cp "$B/client.js.orig"       "$P/lib/client.js"
+cp "$B/provider.js.orig"     "$P/lib/provider.js"
+cp "$B/cache.js.orig"        "$P/lib/cache.js"
+cp "$B/breaker.js.orig"      "$P/lib/breaker.js"
+cp "$B/exa.js.orig"          "$P/lib/backends/exa.js"
+cp "$B/parallel.js.orig"     "$P/lib/backends/parallel.js"
+cp "$B/health.js.orig"       "$P/lib/health.js"
+cp "$B/history.js.orig"      "$P/lib/history.js"
+cp "$B/trust.js.orig"        "$P/lib/trust.js"
+cp "$B/settings-api.js.orig" "$P/lib/settings-api.js"
+rm -f "$P/lib/util/failure-label.js" "$P/lib/util/namespace.js" \
+      "$P/lib/backends/firecrawl.js" "$P/lib/backends/tinyfish.js" \
+      "$P/tests/lead-20261106.test.js" "$P/tests/lead-20261107.test.js" \
+      "$P/tests/lead-20261107-p0.test.js" "$P/tests/lead-20261108-interaction.test.js" \
+      "$P/tests/lead-20261108-quota.test.js" "$P/tests/settings-api.test.js"
```

**回滚验收（只读模拟，未执行）**：改完后逐文件 `md5sum` 与 `.orig` 比对应 13/13 MATCH，
`ls lib/util/failure-label.js lib/util/namespace.js tests/lead-*.test.js tests/settings-api.test.js` 应全部不存在。

---

*（骨架已落盘；§3 过时表述全表 / §4 README 契约 / §5 注释残留 / §6 密钥扫描 / 反直觉与裁决表待续补。）*
