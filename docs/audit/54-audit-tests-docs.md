# 54 · 全量 bug 审计 D：测试 / 文档 / 回滚一致性（中文报告）

> 专家 D（测试/文档/回滚一致性），task-30。目标：**找假绿与不一致**。独立取证，只读。
> 采样时间 2026-11-08 22:15–23:05（Asia/Shanghai）。**注意：本轮 5 位审计专家并发写报告，`*.md` 份数/行数是移动靶**；本报告所有「份数/行数」均给出**取证时点与可复现命令**，并以 `.baseline-20261108-2205/`（51 份 md / 18131 行，含 `CHECKSUMS.txt`+`PLUGIN_CHECKSUMS.txt` 共 53 文件）为锚点。
> 方法：`read`/`grep`/`glob` + `node --test` 实跑 + `md5sum` + 只读 bash。**唯一写文件 = 本报告**；不改源码/配置/运行时/其它报告，不操作任务板。
> 证据等级：A = 本机实跑/文件逐字节；B = 代码逐行可判；C = 文档自述；D = 实跑 stdout；E = 推断。
> 每行裁决给 A/B/C/D/E。

---

## 0. 一句话结论

- **无 `assert.ok(true)`、无 `length >= 0`、无纯恒真断言**（A/D）。但**存在 1 条自指/镜像式「假绿」**（`lead-20261106.test.js:215-222` 在测试里重写生产逻辑再断言，不 import 生产代码），且**源码级静态断言占比 65%（100/152 静态，实际执行 198）**，其中 `lead-20261108-interaction.test.js` **35/35 全部是源码文本正则**——这类断言只验证「源码里有没有这行」，不验证行为（A/B）。
- **`node --test` 在 `src-work/plugin/` 43/43 全绿，在安装目录裸跑 28/33、5 fail**（D/A）。差异属**已知限制**（`@deepseek-ai/dsh-web` / `dsh-credentials` 由 DSH host 注入，安装目录 `node_modules/@deepseek-ai` 只有 `cosmokit`+`schemastery`），**不是新增假绿**，但**是「43/43 全绿」的口径未注明运行位置**的文档债（B/C）。
- **回滚链不可执行（P0）**：`25-execution-log.md §6` 仍是 **17 文件版本**（10 `cp` + 7 `rm`），而 `§15`/`50` 宣称已同步为 **23 文件 / 16 备份**。实测缺 **3 个 `cp`**（`breaker.js`/`exa.js`/`parallel.js`）、**3 个 `rm`**（`failure-label.js`/`lead-20261108-quota.test.js`/`settings-api.test.js`），验证循环只覆盖 5 个 cp + 5 个 rm，且**「5 行 REMOVED」与实际 rm 清单 7 行自相矛盾**（A）。
- **过时表述大量**：报告库份数/行数是并发写入下的移动靶——锚点 `.baseline-20261108-2205/` = **51 份 md / 18131 行**；`REPORT.md:6` 写「51 份 md / 约 18200 行」，`50:46`/`25:528`/`45:198` 写「**50 份 md / 18028 行**」。按 mtime 回溯，**19:31（这批文档写就时）已有 51 份 md / 18131 行** ⇒ 「50 份」少 1、「18028 行」少 103（A）。23:05 实测顶层 `*.md` = 55 份 / 19135 行（含本报告 348 行）。§6 的「17 文件」「13 个 orig」「5 个新增」「5 行 REMOVED」全部过时（A）。`56:4` 把基线写成「53 份 md + 40 插件文件」也把 2 个非 md 文件算成了 md（实为 51 md + 2 checksum 文件）。

---

## 1. 逐条裁决表（6 个测试 / 断言分类 / 假绿）

### 1.1 断言总数与分类（必须给结论点 1）

| 文件 | `test()` 块 | 静态 `assert.*` 调用点 | 运行时实际执行断言 | 源码级静态断言（读文件/正则） | 真行为级断言（import 或执行生产函数） | 判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `lead-20261106.test.js` | 11 | **55** | 62 | **42**（L102/113/114/123-130/135-136/140/142/143/152-159/162/166/167/171/184/191/192/195/196/202/207-210 等，全为 `readFileSync`+`assert.match` 源码文本） | **13**（L46-52 parseFirecrawl 7、L56-59 4、L73 1、L84-87 4、L91-93 3 = 19 条行为级调用点，其中 L218/219 是镜像自指另计） | **A/D** |
| `lead-20261107-p0.test.js` | 4 | **13** | 16 | **5**（L103-105/109/111，源码级） | **8**（L58-60/75-78/93/95，假 fetch 驱动真 backend，验证 header/URL） | **A/D** |
| `lead-20261107.test.js` | 4 | **16** | 27 | **4**（L75/78/81 正则提取 + L89/90 源码匹配 = 5，其中 L75-81 是「从源码提取正则」） | **11**（L56/59/60/61 apply+provider.search；L95/97/99/100 `findPluginRow`；L110/112/115 `cacheKeyFor`） | **A/D** |
| `lead-20261108-interaction.test.js` | 9 | **35** | 40 | **35（100%）** | **0** | **A/B** |
| `lead-20261108-quota.test.js` | 3 | **17** | 17 | **0** | **17**（`rateLimited`/`retryAfterMsFrom`/`foldBreaker` 全部 import 真函数） | **A/D** |
| `settings-api.test.js` | 12（含 7 个表驱动） | **16** | 36 | **0** | **36**（真 `registerSettingsRoutes` + fake Host） | **A/D** |
| **合计** | **43** | **152** | **198** | **≈100（65%）** | **≈85（43%，含 1 条镜像自指）** | **A/D** |

> 口径说明（A）：「静态调用点」= `grep -coE 'assert\.[a-zA-Z]+'`；「运行时执行」= 用 `node --import` 内联 hook 包裹 `assert.*` 计数（每文件单跑，6 文件合计 62+16+27+40+17+36 = **198**）。表驱动 for 循环使运行时 > 静态。
> 「源码级」= 断言对象是 `readFileSync` 出来的源码文本（含 `assert.match`/`doesNotMatch`/计数正则）；「真行为级」= import 生产模块并调用/驱动其函数。两列按**静态调用点**归类，合计 ≈152。

### 1.2 恒真 / 自指 / 硬编码逐条清单

| # | 位置 | 类型 | 裁决 | 说明 |
| --- | --- | --- | --- | --- |
| 1 | `lead-20261106.test.js:215-222` | **自指 / 假绿**（P1） | **B/A** | 测试名「ok:false envelope is rejected instead of reported as saved」，但**不 import `lib/client.js`**，而是在 L217/L220 把生产代码 `lib/client.js:436-437` 的 `res.ok === false` 判断与 `throw` **原样抄进测试**再断言。若生产端删掉 `if (rejected) throw`，此测试**仍绿**。对照 `lead-20261106.test.js:194-196` 的静态 `assert.match` 至少还读了源码文本；这一条连源码都没读。⇒ **真·假绿**：文档（25 §10.3 / 32-b）称其为「行为级」不成立。 |
| 2 | `lead-20261107.test.js:72-83` | **硬编码期望值自我断言 → 已修**（原 35 号 P2-1） | **A/D** | 35-deep-dig.md:98 曾判「把修复后正则逐字硬编码进测试 = 恒真」。**当前版本已改为从 `provider.js` 源码用 `/const privHost = bu \? (\/.*?\/)\.test/` 动态提取正则**（L73-76），再断言 7 个 private / 6 个 public host。⇒ 若把 `provider.js` 正则改回 `{3}`，`m[1]` 变化使 L78/L81 失败，**不再恒真**（A）。但仍是**源码级**：`assert.ok(m)` 只保证正则文本存在，不驱动 `provider.js` 的 `schemeOk` 分支；`45:115` 声称「补一条真行为级测试（import 真实 provider 的正则路径）」——**实测 6 个测试文件中无任何一处 `import provider.js`**（`grep -rn 'provider.js' tests/` 只命中注释与 `readFileSync`）。⇒ **45:115 是过时/失实表述**（B/C）。 |
| 3 | `lead-20261108-interaction.test.js:20-112` | **100% 源码级静态** | **A/B** | 35/35 断言全是 `readFileSync(lib/client.js|index.js|settings-api.js|cache.js|provider.js|mcp-client.js|tinyfish.js)` + `assert.match(正则)`。测的是「文件里有没有这行代码」，不是「代码跑起来是否如此」。文件头 L16-18 自认「these tests assert the applied fixes at source level」。⇒ **不是恒真**（锚点确实绑定具体源码行），但**是弱证据**：重命名变量/格式化即全红，删掉功能但保留一行注释即全绿。 |
| 4 | `lead-20261106.test.js:96-109` | 源码级 + 计数自指 | **B** | L104-108 过滤掉注释行后数 `headers.host ?? target.host` 出现 2 次；测试名说「via source inspection」，诚实标注。非恒真，但同样不验证 CONNECT 隧道行为（文件头 L14-20 已承认是手动 A/B 覆盖）。 |
| 5 | `lead-20261107-p0.test.js:99-112` | 源码级补充 | **B** | 4 个 test 中第 4 个是纯 `assert.match` 源码；前 3 个是**真行为级**（假 fetch 断言 `Authorization: Bearer FC-TEST-KEY` / `X-API-Key` / keyless 降级）。这是 6 个文件里**行为级质量最高**的一组。 |
| 6 | `settings-api.test.js` / `lead-20261108-quota.test.js` | **真行为级、无假绿** | **A/D** | 分别 import `registerSettingsRoutes`、`foldBreaker`/`rateLimited`/`retryAfterMsFrom`，用 fake Host / 真实错误对象驱动。断言有具体期望值（400/409/200、`cooledUntil = now+30_000`、`12_000`），无 `assert.ok(true)`、无 `length >= 0`。 |
| 7 | 全库 | `assert.ok(true)` / `length >= 0` | **A** | `grep -nE 'assert\.ok\(true\|length\s*>=\s*0'` → **0 命中**。 |

**逐文件清单（简版，每条 A/B/D）**

- `lead-20261106.test.js`（11 test / 55 静态）：A — parse 函数 5 条真行为；B — 其余 6 条全源码静态；**D — L215-222 自指假绿**。
- `lead-20261107.test.js`（4 test / 16 静态）：A — `apply()`+`provider.search` 与 `findPluginRow`/`cacheKeyFor` 共 3 条真行为；B — 正则提取 1 条源码级（已非恒真）。
- `lead-20261107-p0.test.js`（4 test / 13 静态）：A/D — 3 条真行为（假 fetch）；B — 1 条源码级。
- `lead-20261108-interaction.test.js`（9 test / 35 静态）：**B — 35/35 源码级，0 行为级**。
- `lead-20261108-quota.test.js`（3 test / 17 静态）：A/D — 17/17 真行为级。
- `settings-api.test.js`（12 test / 16 静态）：A/D — 36 次真行为执行。

### 1.3 实跑结果（必须给结论点 2）

| 运行位置 | 命令 | 结果 | 证据 |
| --- | --- | --- | --- |
| `src-work/plugin/`（有 `node_modules/@deepseek-ai/*` → 发布 CLI 的 6 个 symlink） | `node --test tests/*.test.js` | **# tests 43 / pass 43 / fail 0 / EXIT=0** | **D** |
| 安装目录 `/home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/`（裸跑） | 同上 | **# tests 33 / pass 28 / fail 5 / EXIT=1** | **D** |

安装目录 5 个 fail 全为 `ERR_MODULE_NOT_FOUND`：

| 失败测试 | 缺失包 | 来源 |
| --- | --- | --- |
| `lead-20261106.test.js` 整文件加载失败 | `@deepseek-ai/dsh-web`（`lib/backends/firecrawl.js`） | A |
| `P0: firecrawl …` / `P0: tinyfish …` / `keyless fallback …` | `@deepseek-ai/dsh-web` | A |
| `apply() resolves live settings…` | `@deepseek-ai/dsh-credentials`（`lib/index.js`） | A |

**准确判断（A/B/C）**：
1. **是已知限制**：`lead-20261106.test.js:4-10` 文件头、25 §1 第 8 行、25 §4、45:116、32-adversarial-ops.md §5 均已记录「`@deepseek-ai/dsh-web` 由 DSH host 注入，裸 `node --test` 从 npm 包无法解析；请在 `src-work/plugin/` 用测试专用 symlink 跑」。实测安装目录 `node_modules/@deepseek-ai/` 只有 `cosmokit`、`schemastery`（2 项），profile 级同；而 `src-work/plugin/node_modules/@deepseek-ai/*` 6 个 symlink 全指向 `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/*`（A）。⇒ 差异**成立且已被文档预告**。
2. **算不算「假绿」？分两层**：
   - **不算新增假绿（A）**：`src-work` 的 43/43 是真跑（测试进程确实加载并调用了生产模块），不是跳过、不是 mock 掉断言；5 个 fail 是**环境缺依赖**，不是测试逻辑伪装通过。
   - **算「口径假绿 / 文档债」（P2，B/C）**：所有对外结论（`25 §15`、`50 §4`、`REPORT:12`、`99:72`、`45:198`）只写「**43/43 单测**」，**无一注明运行位置**，也没附「安装目录裸跑 28/33、5 fail」。`35-deep-dig.md:19/155/171` 早已点名这个口径问题，`45:116` 裁决说「保留但改文档措辞」——**实测未改**。读者按字面从安装目录复跑会得到 5 fail。⇒ 属「假绿」的**表述层面**，非执行层面。
3. **反直觉**：`src-work/plugin/test-node_modules/` 是与 `node_modules/` 相同的 6 个 symlink，但**全库无任何测试/patch/命令引用 `test-node_modules`**（`grep` 0 命中，A）。它是**死脚手架**；真正让 `node --test` 通过的是 `node_modules/`。任务描述里的「test-only symlink」实际指 `node_modules/`。

---

## 2. 假绿 / 不一致清单（P0 / P1 / P2）

| 级别 | # | 问题 | 位置 | 证据 | 建议 |
| --- | --- | --- | --- | --- | --- |
| **P0** | 1 | **回滚链与现状脱节且自相矛盾**：§6 标题仍「17 文件版本」，正文只列 10 `cp` + 7 `rm`，而 §15/50 宣称已更新 23 文件 / 16 备份。实测 23 改动（13 改 + 10 新）中有 **3 个改文件无 `cp`**、**3 个新文件无 `rm`**，验证循环只覆盖 5+5，且注释「删除 5 个新增文件」与 7 行 `rm` / 「期望 5 行 REMOVED」三处数字互不一致。 | `25-execution-log.md:83,85,86,93,105,118-127` vs `:530` | **A** | 按本报告 §4 的 23 行表重写 §6：13 `cp` + 10 `rm` + 全量验证循环 + drop-in 移除 + 功能验证。 |
| **P0** | 2 | **§15 声称「详见 50 号 §4 回滚链」但 50 号 §4 是「终局验证」，无任何 cp/rm 命令**；45 号裁决表也无 23 文件清单。⇒ 23 文件回滚链**在任何文档里都不存在可执行版本**。 | `25:530` / `50-decisions-executed.md:35-46` / `45` | **A/C** | 把回滚链写进 §6 或 50 §4 之一，去掉交叉引用空指针。 |
| **P1** | 3 | **1 条真·自指假绿**：`lead-20261106.test.js:215-222` 把生产判断抄进测试再断言，不 import 生产代码；文档（25 §10.3、32-b）称其「行为级」不成立。 | `tests/lead-20261106.test.js:215-222` / `25:272` | **B/A** | 改为 import 真 `writeCredential`（或抽出纯函数 `isRejectedEnvelope`）后断言；否则标注为「镜像式示例，非回归证据」。 |
| **P1** | 4 | **README / package.json 后端数仍是 11，代码已是 13**：`README:6/12/99/131`、`package.json description` 全写 11，但 `lib/index.js` 的 `BACKENDS` 有 13 项、`Config` 有 13 个 `enableXxx`、新增 `firecrawl`/`tinyfish` 开关。`README:18-30` 后端表只列 11 行，**缺 2 个新 backend**；`README:114` 说「每个 key-gated 后端都有 `${id}BaseURL`」但 firecrawl/tinyfish 也有（且非 key-gated）。 | `src-work/plugin/README.md:6,8,12,18-30,99,114,131` / `package.json` | **A/B** | 统一改为 13（或写「多个」避免漂移，参考 client.js 已做的去硬编码）。 |
| **P1** | 5 | **45:115 声称已补「import 真实 provider 的」真行为级测试，实测 0 处 import**；`35-deep-dig.md:98` 的「恒真」结论已被源码提取修复，但 35 号主版**未就地加注**（仍在 99:3「旧正文保留为快照」框架外被当作现行结论引用）。 | `45-reform-verdicts-SKELETON.md:115` / `tests/*.test.js` | **A/C** | 删/改 45:115；给 35:98 加「已被 L73-76 源码提取修复」注。 |
| **P1** | 6 | **报告库份数/行数系统性过时**：见 §3 全表。`50 §4:46`、`25 §15:528`、`45:198`、`99:72` 的「50 份 md / 18028 行」按 mtime 回溯，19:31 实际已是 **51 份 / 18131 行**（锚点 `.baseline-20261108-2205/` = 51 md / 18131 行）。`REPORT:6` 的「51 份 / 约 18200 行」在 19:29 份数正确、行数少 69，之后随并发写入持续漂移。 | `REPORT.md:6`、`50:46`、`25:528`、`45:198` | **A** | 写明「计数随并发报告增长，见 `ls *.md | wc -l`」，并统一到锚点 51 md / 18131 行。 |
| **P2** | 7 | **「43/43 单测」未注明运行位置 / 未附安装目录 5 fail**：见 §1.3。 | `25:528`、`50:39`、`REPORT:12`、`99:72`、`45:198` | **B/C/D** | 补「`src-work/plugin/`（test symlink）43/43；安装目录裸跑 28/33、5 fail 属 host 注入包缺失的已知限制」。 |
| **P2** | 8 | **§14.2:489「未执行」7 项中有 4 项已在 §15/50 执行**（M-1、M-3、readErrors 兼容版、429 3a、settings-api fixture）：同一文档前后自相矛盾。 | `25:489` vs `25:525`、`50 §3` | **A/C** | 给 489 加「（本节为 07:45 快照，6 项已于 §15 执行）」或改写为已完成。 |
| **P2** | 9 | **`25 §7:171` 证据等级表仍写「单测通过 D｜`node --test` 输出 8/8」**；`§3 V2:50` 写 7/7、`§8.2:196` 8/8、`§9.2:230` 9/9、`§10.3:272` 11/11、`§11.6:337` 14/14、`§12.5:400` 18/18、`§14.3:496` 25/25、`§15:528` 43/43。历史快照保留是允许的（99:3 已声明），但**§7 作为「当前证据等级」表未标注快照属性**易误读。 | `25:50,171,196,230,272,337,400,496,528` | **C** | 给 §7 加「历史增量记录，终局值见 §15」。 |
| **P2** | 10 | **`25 §0:9` 写备份「7 个文件」、`§0:11`/`§4:63` 写「7 个文件逐字节 MATCH」、`§8.2:202`/`§9.2:235` 写「7 个 `*.orig` 完好」、`§11.6:338` 写「备份增至 8 个」**：截至当前 16 个。均为历史快照。 | `25:9,11,63,202,235,338` | **C/A** | 同 #9，加快照标记。 |
| **P2** | 11 | **`README.md:116` env 优先级表述与代码一致但措辞可更准**：代码 `lib/index.js:329-365` 顺序为 `config.enabledBackends` → `enableXxx` toggles → `DSH_UNIFIED_SEARCH_BACKENDS` env → `DEFAULT_ENABLED`，README「优先级低于 enabledBackends 与 enableXxx 开关」「仅在所有开关被显式关闭时生效」**实测成立**（A）。但 `index.js:325-326` 的注释「The four keyless toggles default to true」在 `DEFAULT_ENABLED` 已是 4 个的前提下成立；无不一致。 | `README:116` / `lib/index.js:325-365` | **A** | 无需改；仅记录「已确认一致」。 |
| **P2** | 12 | **`25 §6:115` 回滚命令含 `SSHPASS=<本机 ova 口令>` 占位符**：不是真实值（0 密钥命中见 §7），但**若用户照抄会得到 `SSHPASS=<...>` 字面值导致 ssh 失败**，且口令需用户自行填入。 | `25:115` | **A/C** | 改为 `read -s -p 'ova password: ' PW && SSHPASS="$PW" …`，避免把口令写进文档/历史。 |
| **P2** | 13 | **`REPORT:64` 仍写「需用户手动在 `cordis.patch.yml` 里补 `fetchProvider: http`（只写进报告，未执行）」**，而实际已用 systemd drop-in `Environment=DSH_WEB_FETCH_PROVIDER=http` 落地并重启（49/50/99 均已确认）。属 11-05 快照未加注。 | `REPORT.md:64` vs `25 §2`、`49 §1` | **A/C** | 加「（已由 drop-in 方案替代，见 25 §2）」。 |
| **P2** | 14 | **`99:70` 仍写「仍未执行：升级 2.8.8、提上游 PR、在浏览器里手工填测试 key 点保存（唯一剩余端到端确认）」**，但 99:72 已列 5 项未执行；「唯一剩余」表述过时。 | `99-final-verdicts.md:70` vs `:72` | **C** | 删除「唯一剩余」或改为「11-07 时点」。 |
| **P2** | 15 | **`/tmp/dec.cookies` 仍存完整会话 JWT**（值，非变量名），权限 **644 dsh:dsh**，26 天有效（`expiresAt 1796721152` ≈ 2026-12-08）；`/home/ova/re-agent/dsh-web.log{,.prev}`/`dsh-web.url` 各有 1 行 `?token=<值>`（600）。报告内 0 命中。 | §7 | **A** | **只报告，不删除**；建议用户清理并收紧 umask。 |

---

## 3. 过时表述全表（文件:行号 → 当前真实值 → 应改成什么）

> 当前真实值（A，2026-11-08 22:15–23:05 实测）：**23 改动文件 = 13 修改 + 10 新增**；**16 个 `*.orig`**（其中 13 个属回滚链，3 个是 profile/package 级：`cordis.patch.yml.orig`、`profile-cordis.patch.yml.orig`、`profile-package.json.orig`）；**43/43 单测**（`src-work/plugin/`）；**38/38 JS `node --check` OK**（不是 32/32）；**服务 PID 587384 / 18:34:33 重启 / active**；报告库份数/行数用锚点 **`.baseline-20261108-2205/` = 51 份 md / 18131 行**（23:05 顶层已增至 55 份，属并发写入）；**报告内真实凭证值 0 命中**。
> 注：`50:40`、`25:528`、`REPORT:12`、`45:198`、`99:72` 的「**32/32 语法**」与实测 **38/38** 不符（A）——`find lib tests -name '*.js' | wc -l` = 38，全 OK。

| # | 文件:行号 | 过时表述 | 当前真实值 | 应改成 | 等级 |
| --- | --- | --- | --- | --- | --- |
| 1 | `25-execution-log.md:83` | `## 6. 完整回滚（… 17 文件版本）` | 23 文件 | `（… 23 文件版本）` | A |
| 2 | `25:85` | `现为 17 个文件 = 10 个可从备份还原 + 7 个新增需删除` | 23 = 13 还原 + 10 删除 | 改数字 + 补 `breaker/exa/parallel` 3 改、`failure-label`/2 测试 3 新 | A |
| 3 | `25:86` | `备份目录 … 现为 13 个` | 16 个（链内 13 + 3 profile/包级） | `16 个（链内 13）` | A |
| 4 | `25:93` | `# 1) 从 .orig 还原 12 个被修改的文件`（实际 10 行 `cp`） | 13 个改文件 | 标题改 13，`cp` 补 3 行 | A |
| 5 | `25:105` | `# 2) 删除 5 个新增文件（2 backend + 1 util + 4 测试）`（实际 7 行 `rm`） | 10 个新文件 | 标题改 10，补 3 行 `rm` | A |
| 6 | `25:119` | 验证 `md5sum` 循环只列 5 个文件 | 13 个 | 补 8 个 | A |
| 7 | `25:123-125` | 验证 `REMOVED` 循环只列 5 个文件 | 10 个 | 补 5 个 | A |
| 8 | `25:127` | `# 期望：5 行 REMOVED` | 10 行 | 改 10；且与 #5 的 7 行 `rm` 冲突 | A |
| 9 | `25:136-149` | 逐文件审计表只 10 行（10 文件版） | 23 行 | 按 §4 表替换 | A |
| 10 | `25:9` | 备份「7 个文件」 | 16 | 加「（11-06 快照）」或改 16 | C/A |
| 11 | `25:11,63,199,232,276` | 「7 个文件逐字节 MATCH」 | 23/23 | 加快照标记 | C/A |
| 12 | `25:50` | `7/7 通过`（V2） | 43/43 | 加「（11-06 快照）」 | C |
| 13 | `25:171` | 证据等级表「单测通过 D｜8/8」 | 43/43 | 标注历史或改 43/43 | C |
| 14 | `25:196,230,272` | 8/8、9/9、11/11 | 43/43 | 快照标记 | C |
| 15 | `25:202,235` | 「7 个 `*.orig` 完好」 | 16 | 快照标记 | C |
| 16 | `25:337,338` | 「14/14 单测」「备份增至 8 个」 | 43/43、16 | 快照标记 | C |
| 17 | `25:400,402,403` | 「18/18」「10 个文件 MATCH 10/10」「PID 347337」 | 43/43、23/23、PID 587384 | 快照标记 | C/A |
| 18 | `25:489` | 「未执行（需用户决定）」列 M-1/M-3/readErrors/429/settings fixture | 其中 5 项已于 §15 执行 | 加「本节 07:45 快照，见 §15」 | A/C |
| 19 | `25:496` | 「25/25 通过」 | 43/43 | 快照标记 | C |
| 20 | `25:498-500` | 「17/17 文件」「13 个 `*.orig`」「§6 已重写为 17 文件版本（10 cp + 7 rm）」 | 23/23、16、§6 实为 10 cp+7 rm **未更新** | 快照标记 + **删掉「已重写」失实断言** | A/C |
| 21 | `25:508,510` | 「17 文件改进已在运行时生效」 | 23 文件 | 快照标记（当时 17 属实） | C |
| 22 | `25:524` | `46…(509) / 47…(541) / 48…(283)` 行数 | 实测 `wc -l`：46=509 ✅ 47=541 ✅ 48=283 ✅ | **无需改（已确认无误）** | A |
| 23 | `25:528` | 「43/43 单测、**32/32 语法**、23/23 文件一致、16 备份、**50 份 md / 18028 行**」 | 38/38 语法；19:31 时点 51 份 / 18131 行（mtime 回溯 + baseline 锚点） | 32/32→38/38；改「50 份 / 18028 行」为动态计数或注明时点 | A |
| 24 | `25:530` | 「§6 回滚链**同步更新为 23 文件版本** … 详见 **50 号 §4**」 | §6 未更新；50 §4 无回滚链 | **删掉「同步更新」**；改为「§6 待更新」 | A |
| 25 | `45-reform-verdicts-SKELETON.md:4` | 「当前 18/18 单测、10 文件逐字节一致、服务 active PID=347337」 | 43/43、23/23、PID 587384 | 加「（11-07 21:16 快照）」 | C/A |
| 26 | `45:22` | 「兼容现有 18 个测试 + 10 文件一致性」 | 43 + 23 | 快照标记 | C |
| 27 | `45:59` | 「期望 32/32」 | 43/43 | 快照标记 | C |
| 28 | `45:115` | 「本轮**补一条真行为级测试**（import 真实 provider 的正则路径）」 | **0 处 import provider.js**；修复方式是源码提取正则 | 改为「改为从源码提取正则（仍属源码级）」 | A/B |
| 29 | `45:153-156` | 「25/25 / 17/17 / 13 个 orig / §6 已重写为 17 文件」 | 43/43 / 23/23 / 16 / §6 未更新 23 | 快照标记 + 删「已重写」 | A/C |
| 30 | `45:162-163` | 「PID 2334」「17 文件改进已在运行时生效」 | PID 587384 / 23 文件 | 快照标记（当时属实） | C/A |
| 31 | `45:198` | 「43/43 单测、32/32 语法、23/23 文件、16 备份、服务 18:34（PID 587384）、**50 份 md / 18028 行**」 | 38/38 语法；19:31 时点 51 份 / 18131 行 | 同 #23 | A |
| 32 | `49-restart-evidence.md:4,15,22` | 「17 文件改进」 | 23 文件 | 快照标记（17:08 时点属实） | C |
| 33 | `49:12` | 「PID 2334 / 11-08 12:40:47」 | PID 587384 / 18:34:33 | 加「后又于 17:28、18:34 两次重启，终态 PID 587384」 | A/C |
| 34 | `49:41` | 「25+N 全量单测 → 17+N 文件逐字节同步」 | 43/43、23/23 | 快照标记 | C |
| 35 | `49:48` | 「43/43 单测、23/23 文件一致、16 备份、服务重启（12:40 / 17:28 / 18:34）」 | ✅ **已确认无误** | 无需改 | A |
| 36 | `50-decisions-executed.md:8` | 「上一轮 17 文件改进真正生效」 | 23 文件 | 快照标记（指上一轮 17 属实） | C |
| 37 | `50:39-40` | 「43/43 通过」「**32/32 `node --check` OK**」 | 38/38 | 32/32→38/38 | A |
| 38 | `50:42` | 「16 个 `*.orig`（本轮新增 `breaker.js.orig`）」 | 本轮实增 **3 个**：`breaker.js.orig`、`exa.js.orig`、`parallel.js.orig`（mtime 均 10-21 上游原文件，11-08 才拷入备份目录） | 补 2 个 | A |
| 39 | `50:43` | 「18:34:33，PID 587384」 | ✅ 与 `systemctl show` 一致 | 无需改 | A |
| 40 | `50:46` | 「**50 份 md / 18028 行**，密钥扫描 0 命中」 | 18:43 时点 46 份 / 16966 行；19:31 时点 51 份 / 18131 行（两时点均非 50/18028） | 改为动态计数或注明时点 | A |
| 41 | `50:63` | 「文档数字统一：**23 文件 / 16 备份 / 43 单测 / 50 份 md**」 | 19:31 时点 51 份；38/38 语法 | 改动态计数 | A |
| 42 | `50 §4` | 被 `25:530` 引用为「23 文件回滚链」，实为「终局验证」 | 无 cp/rm 命令 | 补链或去掉 `25:530` 引用 | A/C |
| 43 | `REPORT.md:6` | 「**51 份 md 报告，约 18200 行**」 | 19:29 时点 51 份 / 18131 行（份数对、行数少 69）；23:05 增至 55 份 | 写动态计数或注明时点 | A |
| 44 | `REPORT.md:8` | 「10 个文件逐字节一致」「18/18 单测」「PID 347337」 | 23/23、43/43、PID 587384 | 加「11-07 20:08 快照」 | C/A |
| 45 | `REPORT.md:10` | 「31/31 语法、25/25 单测、17/17、13 个备份」「PID 2334」 | 38/38、43/43、23/23、16、PID 587384 | 加「11-08 07:45 快照」 | A/C |
| 46 | `REPORT.md:12` | 「43/43 单测、**32/32 语法**、23/23 文件、16 备份」 | 38/38 语法 | 32/32→38/38 | A |
| 47 | `REPORT.md:24` | 执行摘要第 2 条「当前 `web_search` 事实不可用… enabled:4 keyless:4」 | 已修，`health keyless:6`、`web_search` 8 Sources（49 §2） | 加「（11-04 基线快照，已被 §12/49 推翻）」 | A/C |
| 48 | `REPORT.md:64` | 「需用户手动在 `cordis.patch.yml` 里补 `fetchProvider: http`（只写进报告，未执行）」 | 已由 systemd drop-in 落地并重启 | 加注 | A/C |
| 49 | `REPORT.md:288` | 「本次调研全程只读，未修改任何源码/配置、未重启服务」 | 与全文「已执行改动 + 3 次重启」直接冲突 | 改为「原始调研阶段只读；执行阶段见 25」 | A/C |
| 50 | `99-final-verdicts.md:3` | 「本目录 **17 份报告**跨度 11-04 → 11-06」 | 锚点 51 份（22:05）/ 55 份（23:05） | 加「（11-06 快照）」 | C/A |
| 51 | `99:11` | 「当前进程（PID 2085）」 | PID 587384 | 快照标记 | C/A |
| 52 | `99:70` | 「18/18 单测、10 个文件」「仍未执行：…（**唯一剩余**端到端确认）」 | 43/43、23/23；99:72 另列 5 项未执行 | 删「唯一剩余」 | A/C |
| 53 | `99:72` | 「43/43 单测、23/23 文件一致、16 备份、PID 587384」 | ✅ 一致（未提语法/份数） | 无需改 | A |
| 54 | `99:74` | 「25/25 单测、17/17、13 备份、PID 2334」 | 43/43、23/23、16、587384 | 快照标记 | C/A |

> **「需用户手动重启」是否已解除 → 已解除（A）**：`25:510`「已完成」、`49:15`「无需再请求用户手动重启」、`45:160-163`、`REPORT:10/12`、`99:72/74` 均一致；实测 `systemctl show dsh-web.service` = `ActiveState=active / MainPID=587384 / ExecMainStartTimestamp=2026-11-08 18:34:33`（A）。**但 `REPORT:64` 的旧「需用户手动补 config」表述未加注**（见 #48），属残留而非「重启」本身。
> **待决项是否已执行**：9 项 → 6 项已执行（M-3、M-1、settings-api fixture、readErrors 兼容版、429 3a、中文 description NO-GO 登记）、3 类未执行（429 3b / readErrors UI 文案 / patch-package+PR+升级），`50 §3/§5`、`REPORT:12`、`99:72` **一致**（A）。仅 `25:489` 未加快照标记造成表面矛盾（#18）。

---

## 4. 回滚链逐文件核对表（23 文件 → cp/rm → 备份 → drop-in → 验证）

**实测基线（A）**：`src-work/plugin` ↔ 安装目录 **41/41** 文件 `md5 MATCH`（含 cordis.patch.yml/package.json 等未改动文件）；其中**改动 23**（13 改 + 10 新）。13 个改文件的 `.orig` 与安装目录当前文件 **md5 全部 DIFF-OK**（证明 `.orig` 是有效的改前还原源），16 个 `.orig` 全存在。

| # | 改动文件（安装目录相对 `$P`） | 类型 | 备份 | 备份存在 / md5 可作还原源 | §6 是否有 `cp` | §6 是否有 `rm` | §6 验证循环覆盖 | 裁决 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `lib/util/egress-fetch.js` | 改 | `egress-fetch.js.orig` | ✅ DIFF-OK | ✅ L94 | — | ✅ md5 | **A 通过** |
| 2 | `lib/util/mcp-client.js` | 改 | `mcp-client.js.orig` | ✅ | ✅ L95 | — | ✅ md5 | **A 通过** |
| 3 | `lib/index.js` | 改 | `index.js.orig` | ✅ | ✅ L96 | — | ✅ md5 | **A 通过** |
| 4 | `lib/client.js` | 改 | `client.js.orig` | ✅ | ✅ L97 | — | ✅ md5 | **A 通过** |
| 5 | `lib/provider.js` | 改 | `provider.js.orig` | ✅ | ✅ L98 | — | ✅ md5 | **A 通过** |
| 6 | `lib/cache.js` | 改 | `cache.js.orig` | ✅ | ✅ L99 | — | ❌ 未列 | **A 漏验证**（cp 有） |
| 7 | `lib/health.js` | 改 | `health.js.orig` | ✅ | ✅ L100 | — | ❌ | **A 漏验证** |
| 8 | `lib/history.js` | 改 | `history.js.orig` | ✅ | ✅ L101 | — | ❌ | **A 漏验证** |
| 9 | `lib/settings-api.js` | 改 | `settings-api.js.orig` | ✅ | ✅ L102 | — | ❌ | **A 漏验证** |
| 10 | `README.md` | 改 | `README.md.orig` | ✅ | ✅ L103 | — | ❌ | **A 漏验证** |
| 11 | `lib/breaker.js` | 改（本轮 429 3a） | **`breaker.js.orig`** | ✅ **存在**（2889B，10-21 20:17）| ❌ **缺 cp** | — | ❌ | **A P0 遗漏** |
| 12 | `lib/backends/exa.js` | 改（本轮 M-1） | **`exa.js.orig`** | ✅ **存在**（4413B） | ❌ **缺 cp** | — | ❌ | **A P0 遗漏** |
| 13 | `lib/backends/parallel.js` | 改（本轮 M-1） | **`parallel.js.orig`** | ✅ **存在**（3916B） | ❌ **缺 cp** | — | ❌ | **A P0 遗漏** |
| 14 | `lib/backends/firecrawl.js` | 新 | 无（应 rm） | — | — | ✅ L106 | ✅ REMOVED | **A 通过** |
| 15 | `lib/backends/tinyfish.js` | 新 | 无（应 rm） | — | — | ✅ L107 | ✅ REMOVED | **A 通过** |
| 16 | `lib/util/namespace.js` | 新 | 无（应 rm） | — | — | ✅ L108 | ❌ 未列 | **A 漏验证** |
| 17 | **`lib/util/failure-label.js`** | 新（429 3a） | 无（应 rm） | — | — | ❌ **缺 rm** | ❌ | **A P0 遗漏** |
| 18 | `tests/lead-20261106.test.js` | 新 | 无 | — | — | ✅ L109 | ✅ | **A 通过** |
| 19 | `tests/lead-20261107.test.js` | 新 | 无 | — | — | ✅ L110 | ✅ | **A 通过** |
| 20 | `tests/lead-20261107-p0.test.js` | 新 | 无 | — | — | ✅ L111 | ✅ | **A 通过** |
| 21 | `tests/lead-20261108-interaction.test.js` | 新 | 无 | — | — | ✅ L112 | ❌ 未列 | **A 漏验证** |
| 22 | **`tests/lead-20261108-quota.test.js`** | 新（429 3a） | 无 | — | — | ❌ **缺 rm** | ❌ | **A P0 遗漏** |
| 23 | **`tests/settings-api.test.js`** | 新（fixture GO） | 无 | — | — | ❌ **缺 rm** | ❌ | **A P0 遗漏** |

**汇总（A）**：13 改 → §6 有 `cp` **10 个（缺 3）**；10 新 → §6 有 `rm` **7 个（缺 3）**；验证循环覆盖 **5 cp + 5 rm（缺 8 cp + 5 rm）**。

**任务特别核对项（A）**：
- `breaker.js.orig` / `exa.js.orig` / `parallel.js.orig` **3 个全齐**，md5 与安装目录当前文件均不同 ⇒ 可作还原源 ✅；但 **§6 一条 `cp` 都没写** ⇒ 备份存在 ≠ 回滚可执行。
- `failure-label.js`（util 新增）、`namespace.js`（util 新增）、2 个新 backend（`firecrawl`/`tinyfish`）、6 个新测试 → 共 10 个新增。§6 的 `rm` 只含 **2 backend + `namespace.js` + 4 个旧测试** = 7 个；**`failure-label.js`、`lead-20261108-quota.test.js`、`settings-api.test.js` 均不在 rm 清单**（A）。标题「删除 5 个新增文件（2 backend + 1 util + 4 测试）」与实际 7 行 `rm` 及真实 10 个新增**三重矛盾**。
- `cordis.patch.yml.orig`（bundle patch）、`profile-cordis.patch.yml.orig`、`profile-package.json.orig` 是 **profile/package 级备份，不属于 23 文件链**（`25:151-155` 已裁决不纳入，A）。其中 `cordis.patch.yml` 与工作副本 **md5 SAME**（未改动），无需 `cp`。

**drop-in 移除（A/C）**：§6 第 3 步 L114-116 正确（`rm /etc/systemd/system/dsh-web.service.d/10-websearch-lead-fix.conf` + `daemon-reload` + `restart`）；实测 drop-in 存在、含 3 个 `Environment=`（`DSH_WEB_FETCH_PROVIDER=http` + 2 个 `HTTP(S)_PROXY`），服务 active PID 587384。⇒ **此步唯一完整可执行**。但 `SSHPASS=<本机 ova 口令>` 是占位符（P2 #12），照抄会失败。

**验证命令（A）**：§6 第 4 步 `md5sum` 循环只 5 文件、第 5 步 `test ! -e` 循环只 5 文件、注释「期望 5 行 REMOVED」；`/proc/$(pgrep -f 'dsh web --patch' …)/environ` 检查 env 的思路可用（`pgrep` 实测命中 PID 587384）。**功能验证（L131-133）保留但需重写**：`web_fetch -> WEB_PROVIDER_AMBIGUOUS` 是移除 drop-in 后的预期，成立（C）。

**⇒ 结论：回滚链「真的可执行」= 否（P0）**。按 §6 原样执行会**残留 6 个文件**（3 个改过的源码未还原：`breaker.js`/`exa.js`/`parallel.js`；3 个新增未删：`failure-label.js`/`lead-20261108-quota.test.js`/`settings-api.test.js`），且验证循环会给出**不完整的假通过**（5 行 REMOVED 与 7 行 rm 不符，8 个 cp 未校验）。

---

## 5. 注释规范残留清单（lib/，AGENTS.md 要求不叙述过程）

**方法（A）**：`grep -rnE '(lead|2026-11-0[0-9]|PR #|issue #|[0-9]{2}-[a-z-]+\.md|§|WBS|review|P0|P1|P2|审查|裁决|采纳|驳回)' lib/ --include='*.js'`，再逐条用 `backups/*.orig` 反查是否**上游既有**（`trust.js`/`multiquery.js` 等无 `.orig` 的文件按「安装目录原包」判定）。

### 5.1 本轮引入 / 需修（P1）

| # | 文件:行号 | 原文（截取） | 违反点 | 建议 | 等级 |
| --- | --- | --- | --- | --- | --- |
| 1 | `lib/index.js:463-465` | `// drive execution (github.com/240xu/dsh-websearch/pull/7 — "settings are inert on DSH 0.2.x"). Applied 2026-11-07 by lead, mirroring the upstream PR's fix so a future npm upgrade reconciles cleanly.` | **日期 + 作者前缀（`Applied 2026-11-07 by lead`）+ 审查/PR 叙事 + 过程叙述**（「mirroring… so a future upgrade reconciles」） | 只留契约：`// Read the live settings-service values on every resolve; apply() only receives schema defaults on DSH 0.2.x.` | **A/B** |
| 2 | `lib/backends/tinyfish.js:19` | `// conflate the two. See 05-search-backends.md appendix A.3.` | **内部报告路径 + 章节号**（本轮新增文件自带） | 改为指向公开来源（TinyFish 官方限流文档）或删掉引用，保留数字本身 | **A/B** |
| 3 | `lib/backends/tinyfish.js:8-14` | `// Aligned with the OpenCode v2 websearch provider: https://github.com/…/v2.2.5/…/tinyfish.ts`、`// TinyFish v2.2.5 source comment: "Keyed requests are rejected …"`、`// Our mcpCall() gained options.skipInitialize to express exactly this split without regressing exa/parallel.` | **「gained」变更叙事 / 过程叙述**（AGENTS.md：不叙述控制流与改动史） | 改为现状契约：`// Keyed requests require the Mcp-Session-Id from initialize; keyless ones do not. mcpCall's skipInitialize selects the stateless path.` | **B** |
| 4 | `lib/backends/firecrawl.js:24-27` | `// which we normalise to the DSH source shape { url, title?, snippet? }` / `// Registration is intentionally opt-in … because the keyless tier is metered and its exact ceiling is unknown.` | 「we normalise」「intentionally」轻度过程/意图叙述；**无编号/路径/日期**，属可接受边界 | 建议改为被动式；**不列 P0/P1**，登记 P2 | **B** |
| 5 | `lib/util/failure-label.js:1-3` | `// failure-label.js — classify quota/rate-limit failures from a WebError's message. Response headers do not reach WebError in this implementation, so retryAfterMsFrom() falls back to a fixed 60s cooldown.` | 「in this implementation」+ 解释兜底原因，属**契约/失败模式事实**，AGENTS.md 允许 | **无需改（已确认无误）** | **B** |

### 5.2 上游既有（`.orig` 内逐字存在，按 `43 §14.2:486` / `25 §14.2:486` 裁决保留，登记 P2 不修）

| 文件:行号 | 原文 | 判定 |
| --- | --- | --- |
| `lib/cache.js:34` | `// (arch-review P1-1). Also includes …` | **A** 上游既有（`cache.js.orig:34`）→ review 编号残留 |
| `lib/history.js:40` | `// … (arch-review P2-2).` | **A** 上游既有 → review 编号 |
| `lib/history.js:98` | `* payload (v2.8.0 P2): …` | **A** 上游既有 → 版本+编号 |
| `lib/breaker.js:35` | `// … (arch-review P2 note).` | **A** 上游既有 |
| `lib/index.js:13` | `// NOTE (2026-09-12, dsh 0.1.5 compat): …` | **A** 上游既有 → **日期前缀** |
| `lib/index.js:184` | `// W1 (fe-ui review): labels speak …` | **A** 上游既有 → review 编号 |
| `lib/index.js:295` | `* Per-field user-language labels (fe-ui W1 remainder): …` | **A** 上游既有 → **WBS 式编号 W1** |
| `lib/index.js:428-429` | `* … (compat-audit P2-7).` | **A** 上游既有 → review 编号 |
| `lib/index.js:491` | `// … (compat-audit P2-7).` | **A** 上游既有 |
| `lib/client.js:862` | `// (fe-ui C3 keeps devkit toast …)` | **A** 上游既有 → review 编号 |
| `lib/provider.js:34` | `// Per-backend timeout ceilings (v2.8.0, P2): …` | **A** 上游既有 |
| `lib/provider.js:89` | `// 2.8.2: exported for P1 regression tests …` | **A** 上游既有 → P1 编号 + 测试叙事 |
| `lib/provider.js:103,203,469` | `// 2.8.2（P1）/（P2）：…` | **A** 上游既有 → 版本+P 编号 |
| `lib/multiquery.js:12,16` | `// 2.8.2（P2）/（P2 定稿）：…` | **A** 安装目录原包（无 `.orig`，未改动）→ P 编号 + 「定稿」过程词 |
| `lib/trust.js:37,86` | `// … (issue #89).` | **A** 上游既有（`25 §14.2:486` 明确「trust.js 的 2 处 issue #89 是上游既有，保留」） |

**关键裁决（A/B）**：`25 §14.2:486` 与 `45:144` 宣称「**审查叙事/P0-P1 编号/WBS/内部报告路径全部清零**」——**不成立**：
- 上述 **18 处**上游既有残留仍在（review 编号 / P0-P1-P2 / W1 / 日期前缀 / `issue #89`）；
- 本轮**新增文件** `tinyfish.js:19` 自带内部报告路径 `05-search-backends.md appendix A.3`；
- 本轮**修改** `index.js:464` 自带 `Applied 2026-11-07 by lead`（日期+作者前缀 + PR 叙事）。
⇒ 准确说法应是「**本轮新写入的审查叙事已清零，上游既有的 18 处与本轮 2 处新残留仍在**」。这是**「注释审查叙事清零」这一对外结论的假绿**（P1，B/A）。

---

## 6. README.md 契约 vs 代码

| 契约点 | README 表述 | 代码实测 | 裁决 |
| --- | --- | --- | --- |
| env 优先级 | `README:116`「`DSH_UNIFIED_SEARCH_BACKENDS` … 优先级低于 `enabledBackends` 与 `enableXxx` 开关；四个免 Key 后端开关默认均为 `true`，该环境变量仅在所有开关被显式关闭时生效（Known Limitation）」 | `lib/index.js:329-365`：`config.enabledBackends` → `toggleMap`（13 个 `enableXxx`）→ `launchEnvironmentOf(ctx).get(ENABLED_ENV)` → `DEFAULT_ENABLED = ["exa","parallel","ddg","searxng"]`。`lib/index.js:325-326` 注释与 README 逐字呼应 | **A 一致（已确认无误）** |
| `baseURL` 字段 | `README:114`「每个 key-gated 后端都有对应 `${id}BaseURL`；DeepSeek/Anthropic/OpenAI 另有 `${id}Model`；Tavily 有 `tavilySearchDepth`」 | `lib/index.js:247-267` 有 **11 个** `*BaseURL` Config 字段（brave/tavily/serper/mojeek/searxng/deepseek/anthropic/openai + **firecrawl/tinyfish**）；`:375` `baseURL: config?.[`${id}BaseURL`] ?? DEFAULT_BASE_URLS[id]` 对 `ALL_BACKENDS`（13）全派生 | **A 部分不一致**：firecrawl/tinyfish 也派生 `BaseURL` 且**非 key-gated**（keyless + optionalKey），README 未提 2 个新后端（见 P1 #4）。`searxng` 也是 keyless 却有 `searxngBaseURL`，「每个 key-gated」措辞本就不精确。 |
| Config 字段总数 | `README:99`「**11 个后端开关**」列 11 个 `enableXxx` | `lib/index.js` 有 **13 个** `enableXxx`（+`enableFirecrawl`/`enableTinyfish`，`:218` 注释 opt-in） | **A 不一致（P1 #4）** |
| 后端数（多处） | `README:6` eleven backends / `:12` 十一后端 / `:99` 11 个 / `:131` 11 后端扇出；`package.json description`「11 backends」「11 后端」；`README:18-30` 后端表 11 行 | `BACKENDS` 13 项、`ALL_BACKENDS` 13、`Config` 13 个 toggle | **A 不一致（P1 #4）**。注：`lib/client.js` 已按 `25 §8.1:182` 把硬编码「11」去掉，测试 `lead-20261106:129-130` 用 `doesNotMatch` 守住——**README/package.json 漏改**。 |
| `searxngBaseURL` 可配置 / plain-http 信任门 | `README:36-44` 说改 `searxngBaseURL` 换源；未提 plain-http 仅限 RFC1918 | `lib/provider.js:327-335` `privHost` 正则 + `schemeOk`（https 或 http+private）+ 拒 credentials-in-URL | **A 契约缺失**（README 未说明这个安全门），但非矛盾；登记 P2 |
| credentials / env 兜底 | `README:8,101,116`「实际 key 存于 credentials 服务或环境变量」 | `lib/index.js:370-371` `credentialRef(keyEnvName)` + `resolveApiKey` 经 credentials/launchEnvironment；provider 侧 `resolveApiKey()` 闭包（`lead-20261107-p0.test.js` 真行为验证） | **A 一致** |

---

## 7. 密钥扫描（值，非变量名）

### 7.1 报告库 md（A，0 命中）

| 范围 | 结果 | 等级 |
| --- | --- | --- |
| 顶层 `*.md`（不含 baseline 快照目录、不含本报告；取证时 52→54 份，并发增长）正则：`cfut_` / `ghp_` / `github_pat_` / `gptreg-mail-` / `dsh-auth-` / `v1.eyJ…` / `eyJ…{30,}` / `sk-…{24,}` / `"key":"<32hex>"` | **0 个文件含真实凭证值** | **A** |
| AGENTS.md §2 两个本机/HK 口令**字面值**逐文件 `grep -qF` 反查 | **0 命中** | **A** |
| `25 §6:115` `SSHPASS=<本机 ova 口令>` | **占位符，非值** | **A** |
| `32-adversarial-ops.md:156,175` 的 `cfut_[A-Za-z0-9_-]{10,}` 等 | **扫描正则文本（脱敏模式），不是值**；`sk-management-framework` 是 URL slug | **A** |
| `12-change-lineage.md:90` `ova442757@163.com` | GitHub commit author 邮箱 / 平台账号名，**非口令/token 值**（`32-adversarial-ops.md:162` 已判 P2 边缘） | **A/C** |

⇒ **报告内值 0 命中，成立（A）**。与 `25:502`、`50:46`、`45:158`、`REPORT:10` 的「0 密钥命中」一致。

### 7.2 `/tmp/*.cookies`、`/tmp/*.json`、日志（仍需清理，只报告不删）

| 文件 | 内容 | 权限 | 结论 | 等级 |
| --- | --- | --- | --- | --- |
| **`/tmp/dec.cookies`** | **1 个完整 `dsh-auth-<hash>=v1.eyJ…` 会话 JWT（含签名）**；`expiresAt 1796721152` ≈ 2026-12-08（仍有效约 26 天），`authority 127.0.0.1:3080` | **644 dsh:dsh** | **仍需清理** | **A** |
| `/tmp/*.json`（15 个：`c43`/`dec-h`/`dec-s`/`g`/`modelratio_new`/`mr`/`na`/`na2`/`r9`/`rank`/`status`/`t2`/`toc`/`ts2_19103`/`ts2_19104`） | 上述正则 **0 命中**；两个口令字面值 **0 命中** | 644 | 当前无需清理（但 `status.json` 22:26 仍在被本轮审计写入，属活跃临时文件） | **A** |
| `/home/ova/re-agent/dsh-web.log` / `.log.prev` / `dsh-web.url` | 各 1 行 `?token=<值>`（GUI 会话 token） | 600 | **仍需清理**（32-adversarial-ops.md §4 已记录，至今仍在） | **A** |
| `32-adversarial-ops.md §4` 旧记录中的 `/tmp/b.cookies`、`dsh.cookies`、`dsh2.cookies`、`f.cookies`、`save-test.cookies`、`/tmp/chm.json`、`chwrapped.json`（64-hex key） | **当前 `ls /tmp/*.cookies` 只剩 `dec.cookies`**，其余已被清理或轮转 | — | 大部分已不在；**但 `dec.cookies` 是 17:12 新产生的**，证明「后续代理仍在产生新 cookie jar」的判断仍成立 | **A** |

⇒ **结论（A）**：报告内 0 命中；`/tmp/dec.cookies`（1 个有效 JWT，644）+ 3 个 600 日志/URL 文件**仍需清理**。**本报告不删除、不修改任何文件**（只读取证）。

---

## 8. 已确认无误

| # | 项 | 证据 | 等级 |
| --- | --- | --- | --- |
| 1 | `src-work/plugin` ↔ 安装目录 **41/41 文件 md5 MATCH**，23 改动文件全一致 | `md5sum` 逐文件 | **A** |
| 2 | 16 个 `.orig` 全存在；13 个链内备份与安装目录当前文件 **md5 全 DIFF**（有效还原源） | `md5sum` | **A** |
| 3 | `breaker.js.orig` / `exa.js.orig` / `parallel.js.orig` **3 个齐**（尽管 §6 未写 cp） | `ls -l` + md5 | **A** |
| 4 | `node --test tests/*.test.js` 在 `src-work/plugin/` **43/43 pass / 0 fail / EXIT=0** | 实跑 stdout | **D** |
| 5 | 38/38 JS `node --check` 全 OK | 实跑 | **A/D** |
| 6 | 无 `assert.ok(true)`、无 `length >= 0`、无纯恒真断言 | `grep` + 逐条读 | **A** |
| 7 | `lead-20261107.test.js` 的 RFC1918 正则**已从源码动态提取**，35 号「恒真」结论已修复 | L73-76 逐行 + 假设反推 | **A/B** |
| 8 | `settings-api.test.js` / `lead-20261108-quota.test.js` / `p0` 前 3 条为**真行为级**，断言有具体期望值 | 逐条读 | **A/D** |
| 9 | README env 优先级与 `lib/index.js:329-365` **一致** | 逐行比对 | **A** |
| 10 | drop-in 存在且含 3 个 `Environment=`；§6 第 3 步移除命令**完整可执行** | `cat` / `systemctl show` | **A/C** |
| 11 | 服务重启受阻**已解除**：`ActiveState=active / MainPID=587384 / 18:34:33` | `systemctl show` + `pgrep` | **A** |
| 12 | 9 待决项 → 6 执行 / 3 类未执行，`50 §3/§5` + `REPORT:12` + `99:72` **一致** | 逐条读 | **A/C** |
| 13 | `25:524` 三份决断报告行数 509/541/283 | `wc -l` | **A** |
| 14 | 报告库 md 内真实凭证**值** 0 命中 | §7.1 | **A** |
| 15 | `50:43` PID 587384 / 18:34:33 与实测一致 | `systemctl show` | **A** |
| 16 | `49:48` 终局数字（43/43、23/23、16 备份、3 次重启）自洽 | 读 | **A** |

## 9. 无法验证 / 诚实边界

| # | 项 | 原因 | 等级 |
| --- | --- | --- | --- |
| 1 | **回滚链「实际执行后」是否真能回到基线** | 本任务只读，**不得执行 cp/rm/restart**；只能静态核对命令完备性。且「回到基线」还依赖 `settings.user` 用户数据（`25:157-160` 已诚实声明不在链内） | **E/A** |
| 2 | `web_fetch` / `web_search` 当前运行态是否仍全绿 | 需认证 token 调 GUI/API；本报告不改运行时、不取 token。`49 §2`/`50 §4` 是 17:08/18:34 的历史实跑，非本次复跑 | **C/E** |
| 3 | `settings.user` 里 `enableFirecrawl/enableTinyfish:true` 是否仍在 | 属运行时用户数据，需认证 API；`25:157-160` 已声明不擅自读取/改动 | **E** |
| 4 | 3 个 `profile-*`/`cordis.patch` 级 `.orig` 是否对应「用户模型配置演进」 | `25:151-155` 已裁决为其它会话改动，未逐行 diff 其内容（本报告只读了首行） | **C** |
| 5 | 18 处上游注释残留中 `multiquery.js`/`trust.js` 的「上游既有」判定 | 这两个文件无 `.orig` 备份；依据「安装目录原包 10-21 时间戳 + `25 §14.2:486` 自述」推断，未与 npm 2.8.4 tarball 逐字比对 | **B/C** |
| 6 | 「50 份 md / 18028 行」在各文档**写作时刻**的精确值 | 用 mtime 回溯（18:43 = 46 份 / 16966 行；19:31 = 51 份 / 18131 行）+ `.baseline-20261108-2205/`（51 md / 18131 行）交叉锚定；并发写入使「当前值」持续变化，不宣称唯一终值 | **A/C** |
| 7 | `/tmp/dec.cookies` 的 JWT 是否已被服务端吊销 | 只能读 `expiresAt`，未向服务端验证；仅报告不清理 | **A/E** |

---

## 10. 5 条反直觉发现（每条 A/B/C/D/E）

1. **【A】「回滚链已更新」是全文最贵的一句假绿**：`25:530` 白纸黑字写「**§6 回滚链同步更新为 23 文件版本**」并指向「**50 号 §4**」，但 §6 仍是 17 文件版（10 cp + 7 rm），50 号 §4 是「终局验证」表、**一个 `cp`/`rm` 都没有**，45 号裁决表也无 23 文件清单。⇒ 23 文件回滚链**在所有文档里都不存在**。更反直觉的是：3 个本轮新增备份（`breaker/exa/parallel.orig`）**文件齐、md5 有效**，却因文档没写 `cp` 而完全用不上——**备份齐全 ≠ 可回滚**。

2. **【A/D】「43/43 全绿」与「安装目录 28/33、5 fail」都是真的，且不矛盾**：差异 100% 来自 `@deepseek-ai/dsh-web` / `dsh-credentials` 的 host 注入（安装目录 `node_modules/@deepseek-ai` 只有 2 个包，src-work 有 6 个 symlink）。这不是假绿，但**所有对外结论都不写运行位置**；更反直觉的是 `src-work/plugin/test-node_modules/` 里那套「test-only symlink」**全库 0 引用**，是死脚手架——真正在起作用的是同名的 `node_modules/`。

3. **【A/B】宣称「注释审查叙事清零」的文件本身带着日期作者前缀**：`25 §14.2:486`/`45:144` 说「审查叙事、P0/P1 编号、WBS、内部报告路径**全部 0 残留**」，实测 `lib/` 仍有 **18 处上游既有**残留（`arch-review P1-1`、`W1 (fe-ui review)`、`NOTE (2026-09-12…)`、`2.8.2（P1）`、`issue #89` 等）**+ 2 处本轮新写**（`lib/index.js:464` 的 `Applied 2026-11-07 by lead`、新增文件 `tinyfish.js:19` 的 `See 05-search-backends.md appendix A.3`）。⇒ 「清零」只覆盖「本轮改写过的那些行」，不是全库扫描。

4. **【A/C】同一份 `25-execution-log.md` 里，§14.2 的「未执行 7 项」与 §15 的「已执行 6 项」直接打架，且 §15 的「32/32 语法」实测是 38/38**：更细看，`§7 证据等级表` 仍写「单测 8/8」、`§0` 仍写「备份 7 个」，而这些都是**合法的历史增量快照**——问题不在数字旧，而在**没有任何一处加「快照」标记**，读者按「当前状态」读必然误判。反直觉的是：`99:3` 早已声明「旧正文保留为过程记录」，但这套免责**只覆盖专题报告，没覆盖 25 号执行日志自己**。

5. **【A】最像「行为级」的一条测试其实是纯自指**：`lead-20261106.test.js:215-222` 名为「ok:false envelope is rejected instead of reported as saved」，文档（25 §10.3、32-b）把它算作「行为级」，但它**既不 import `lib/client.js` 也不读源码文本**——只在测试里把生产端 `lib/client.js:436-437` 的 `res.ok === false` + `throw` **原样重抄一遍**再 `assert.throws`。删掉生产端的 `throw`，这条测试**照样绿**。相反，被 35 号骂「恒真」的 `lead-20261107.test.js` 正则测试**早已改成从 `provider.js` 源码动态提取**，反而是更有效的一条——**文档骂错了对象，且 `45:115` 还补了一句「已补真行为级 import 测试」，实测 6 个文件 0 处 import provider.js**。

---

> 本报告未修改任何源码 / 配置 / 运行时 / 其它报告；未删除 `/tmp` 任何文件；未操作任务板。
> 所有数字均可用本报告内给出的只读命令复现。
