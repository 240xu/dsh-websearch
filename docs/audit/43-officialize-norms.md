# 43 · 官方化组 B（i18n 与代码规范）提案报告

> **task-22 交付**。只写 `/home/ova/dsh/.artifacts/websearch-research/43-officialize-norms.md` 这一个文件；
> **未改任何源码/配置/其它报告/运行时，未操作任务板**。全程只读（read/grep/glob + 只读 bash）。
> 取证时间 2026-11-07 21:39–22:55 Asia/Shanghai，主机 `wuming`。
>
> **性质**：**只给提案，不实际改源码**。所有 diff 片段是「应改成什么」的建议文本，不是已执行的改动。
> **证据等级**（全队规范，见 [07 §8.1](07-dsh-docs.md)）：
> **A**＝源码/文件实证（路径:行号）；**B**＝官方文档/仓库规范原文（路径:行号）；
> **C**＝版本记录；**D**＝本机实测（命令+输出）；**E**＝推断或待核实（显式标注，不得当结论）。
>
> **取证对象**：本机运行插件 `@240xu/dsh-websearch@2.8.4`
> `/home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/`（下文简称 `$P`），
> 源码工作副本 `.artifacts/websearch-research/src-work/plugin/`（与安装目录 md5 一致，见 [32](32-adversarial-ops-b.md) §3.1），
> 规范源 `/home/ova/dsh/AGENTS.md`、`/home/ova/dsh/docs/AGENTS.md`、
> `/home/ova/dsh/scripts/verify-client-ui-i18n.ts`、`.agents/skills/dsh-prose-standard/SKILL.md`、
> `.agents/notes/implemented/architecture/2026-08-23-locale-owned-client-ui-copy.md`。

---

## 0. 规范原文（本次裁决依据）

| 编号 | 规范 | 出处 | 等级 |
|---|---|---|---|
| **N1** | 「**Client UI copy is locale-owned.** Route product text through typed dictionaries and `t` or localized primitive props; `verify-client-ui-i18n` rejects hardcoded copy」 | `AGENTS.md:153`（决策链接 `.agents/notes/implemented/architecture/2026-08-23-locale-owned-client-ui-copy.md`） | **B** |
| **N2** | 「**Comments and docs state complete contracts and context, not reasoning transcripts.** … **Do not narrate control flow or tests, preserve review history, or restate code.** Keep behavior, failure, timing, ownership, and safe-use facts; link the rationale.」 | `AGENTS.md:171` | **B** |
| **N2b** | 「**Comments and JSDoc state complete contracts, not reasoning transcripts.** Preserve behavior, failure, timing, ownership, modality, exceptions, consequences, and non-obvious orientation; **delete narration, test walkthroughs, review analysis, and code restatement.** Keep the local contract and link its rationale.」 | `docs/AGENTS.md:45` | **B** |
| **N2c** | 「**Keep comments local.** Do not restate code, expand unrelated comments, or explain distant behavior without local need」 | `AGENTS.md:148` | **B** |
| **N2d** | slop checklist：「**Reasoning transcripts**: step-by-step implementation narration, proof of obvious branches, test walkthroughs, or rejected local alternatives. Keep the resulting contract or durable rationale; **delete the path used to derive it**.」 | `docs/AGENTS.md:68` | **B** |
| **N2e** | 「Comments describe non-obvious contracts or rationale that code cannot express; they do not restate what code already implies.」「**Internal comments**: … **Delete control-flow narration and code restatement**.」「**Tests**: explain only non-obvious test design … **Delete walkthroughs and inventories**.」 | `.agents/skills/dsh-prose-standard/SKILL.md:12,49,51` | **B** |
| **N3** | 「**Document current state.** Keep history in commits, PRs, Agent Notes, postmortems, or scoped persistence records. **Other prose names live mechanisms, not changes or stack positions.**」 | `docs/AGENTS.md:39` | **B** |
| **N4** | 「Docs accompany every code change: update affected README and JSDoc contracts together.」 | `AGENTS.md:173` | **B** |
| **N5** | 「Locale dictionaries own all product-authored client UI wording. … **A value authored by a user, model, provider, plugin, wire peer, or operating system remains data and renders verbatim**; protocol tags, tool names, paths, URLs, JSON/JavaScript literals, and stable internal ids are not translated.」「**Product-owned catalog descriptions follow the same rule.** The client maps an exact built-in provider, model, and description to a locale key; **a changed description or an external provider description remains provider data and renders verbatim**.」 | `.agents/notes/implemented/architecture/2026-08-23-locale-owned-client-ui-copy.md`（Decision 段） | **B** |
| **N6** | 「Tests describe behavior, not correctness.」 | `AGENTS.md:151` | **B** |

---

## 1. 逐项一：Client UI copy 是 locale-owned — Config.description 中文混排

### 1.1 违规点（事实层）

**新增 6 个 Config 字段**（`$P/lib/index.js`）及其 `.description(...)` 文本全部中文/中英混排：

| # | 字段 | 行号 | 当前 description 来源/文本 | 等级 |
|---|---|---|---|---|
| 1 | `enableFirecrawl` | `:213` | `.description(DEFAULT_LABELS.firecrawl)` → `:144` `Firecrawl (MCP, 免 Key 但有额度, 默认关)` | **A** |
| 2 | `enableTinyfish` | `:214` | `.description(DEFAULT_LABELS.tinyfish)` → `:145` `TinyFish (MCP, 免 Key 30/min·50/day, 默认关)` | **A** |
| 3 | `firecrawlApiKeyEnv` | `:236-237` | `.description("Firecrawl API Key 凭证引用（可选；留空用免 Key hosted tier）")` | **A** |
| 4 | `tinyfishApiKeyEnv` | `:238-239` | `.description("TinyFish API Key 凭证引用（可选；留空用免 Key 模式）")` | **A** |
| 5 | `firecrawlBaseURL` | `:260-261` | `.description("Firecrawl MCP 端点（默认官方 v2；可指向 TLS sidecar）")` | **A** |
| 6 | `tinyfishBaseURL` | `:262-263` | `.description("TinyFish MCP 端点（默认官方；可指向 TLS sidecar）")` | **A** |

**这不是「只有 6 个」的问题**（A 级，`grep -c '\.description("[^"]*[一-龥]' $P/lib/index.js` = **42** / 共 **55** 个 `.description(`，
`DEFAULT_LABELS` `:130-146` 的 **13 个标签全部中英混排**）：中文混排是**插件作者 2.8.4 的既有全量风格**，
我们只是沿用了它。两点必须分开判定，否则会误报：

- **既有 36 个中文 description**：属**上游作者的既有约定**，本轮未引入；若按 DSH 规范审查，属「既有偏差」，改动面大、且会与 2.8.8 上游冲突（**E**：升级后是否仍中文未取到 tarball 复核）。
- **本轮新增 6 个**：是本轮**引入/延续**的偏差，应随本轮一起收敛。

### 1.2 `verify-client-ui-i18n` 会不会拒？—— **不会**（关键裁决）

**【A/D】不会拒，原因是「作用域不匹配」，不是「内容合规」。**

`scripts/verify-client-ui-i18n.ts:319-337` 的 `sourceFiles()` 只 glob：

```ts
'packages/client/*/src/**/*.tsx'
'packages/client/ui-*/src/**/*.{ts,tsx}'
`${clientRoot}/**/*.{ts,tsx}`        // packages/*/*/src/client/ 下有 .tsx 的树
'apps/web/src/**/*.{ts,tsx}'
'apps/desktop/src/{main,update-coordinator}.{ts,tsx}'
'apps/desktop/renderer/*.js'
```

- 本机实测（D）：`$P/lib/index.js` 绝对路径 `/home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/lib/index.js`
  **不在** `/home/ova/dsh/` 仓库根内（`path.startsWith('/home/ova/dsh/') === false`），且不匹配任何一条 glob（文件是 `.js`，不是 `src/client/**/*.ts(x)`）。
- gate 的 `main()` `:341-345` 有 `MINIMUM_CLIENT_UI_SOURCES=450` 的发现下限保护，但那是防「corpus 被收窄」，**不会把外部 `node_modules` 纳入**。
- 决策记录 N5 明说「The TypeScript-AST check discovers every package `src/client` tree that contains TSX, all helper TS files under `packages/client/ui-*`, and the web app source」——**只覆盖仓库内 Client 源码**，不是任意第三方插件。

⇒ **`verify-client-ui-i18n` 对外部 npm 插件零覆盖，绿色是「没扫到」，不是「通过」**。
若把插件源码**复制进 DSH 仓库**并改成 `src/client/**/*.tsx` 让 gate 扫到，则
`COPY_NAME` `:35` / `COPY_SUFFIX` `:36` 会命中 `description` 属性，`:101` `looksLikeNaturalText` 会因中文/CJK 判真，
`:26` `COPY_ATTRIBUTES` 亦含 `description` ⇒ **会拒**（A 级，读 gate 源码推定）。**等级 A（源码）+ E（假设场景推演）**。

> **反直觉点 1**：「gate 没红」在本次是**假阴性**。工程结论应写「按 DSH 规范不合规，但当前 gate 因插件在 `node_modules` 外部而无法强制」，
> **不能**写成「已通过 `verify-client-ui-i18n`」。

### 1.3 `Config.description` 与 UI copy **是否同一约束**？—— **同一业务事实，不同机制**

| 维度 | `lib/client.js` 的 UI 字典 | `lib/index.js` 的 `Config.description` |
|---|---|---|
| 机制 | `ctx.locale.register(NS, { zh, en })` + `props.t()`（`client.js:776,801`）；`BACKENDS` 里还有 13 个硬编码 `label:`（`:15-32`） | schemastery `z.boolean()/z.string().description(...)`，落到 `meta.description` |
| 谁渲染 | Client 组件按 `t(key)` 取 | **0.2.x SettingsForms 从插件 Config 自动生成表单** |
| 证据 | `client.js:62,117` 两本字典；`props.t()` 46 处 | **`$P/README.md:122` 逐字**：「补齐全部裸字段（×ApiKeyEnv/×BaseURL/×Model）的 description——**0.2.0 表单渲染唯一用户可见文案来自 meta.description**」 |
| DSH 官方侧 | N1/N5 的 locale-owned 规则 | `packages/settings/settings/src/schema.ts:37-47` `volatileForm(schema)` 用 `plainSchema` 保留 `node.meta`（含 `description`）并交给表单；`AGENTS.md:173` 要求 description/JSDoc 随代码更新 |

**裁决【A/B】**：
- **从「产品可见文案」角度二者是同一约束**——N5 明文「**Product-owned catalog descriptions follow the same rule**」；
  且 `README.md:122` 自证 `meta.description` 是 **0.2.0 表单唯一用户可见文案**。
  一个中文 `description` 在英文 locale 下就是「中文 UI」，与 `client.js` 里硬编码中文 `label:` 性质相同，都是 N1 要收敛的对象。
- **从「由哪个 gate 强制」角度不是同一机制**——`verify-client-ui-i18n` 只管仓库内 Client 源码；
  `sourceFiles()` 的 glob 不覆盖外部插件；`description` 是 Config schema 元数据，走 `dsh-settings` 的 `volatileForm`/`plainSchema` 路径。
- **N5 的例外条款不适用**：「a changed description or an **external provider description** remains provider data and renders verbatim」——
  这里的「external provider」指**外部模型/服务提供方**下发的描述；本插件的 `.description()` 是**插件作者自己写死的**，不是外部运行时数据，
  所以不能拿「provider data」当豁免。**等级 A/B**。

### 1.4 合规方案（**二选一，建议 A**）

#### 方案 A（**推荐**）：`description` 改为**中性英文**、与 `DEFAULT_LABELS` 一起收敛；UI 展示仍走字典

理由：① `meta.description` 被 0.2.0 SettingsForms 直接渲染，**无法在插件侧按 locale 切换**（插件的 `ctx.locale` 在 Client 半，
`lib/index.js` 是 Host 半，无 `t` 座位；要按 locale 得让 Host 读 Client locale 服务，属跨面耦合，收益低）；
② 英文是**中性技术描述**（不是「英文 UI」而是「locale-neutral config metadata」），符合 `docs/AGENTS.md` 的 current-state 直述；
③ 改动最小、不与 2.8.8 上游 schema 冲突（只改字符串，不改字段名/类型/默认值）；
④ 面板里真正的**产品文案**（分组名、提示、徽章）继续留在 `client.js` zh/en 字典，职责不混。

```diff
--- a/lib/index.js
+++ b/lib/index.js
@@ DEFAULT_LABELS (:130-146) — 13 labels 全部改中性英文；此处只列本轮新增两项
-  firecrawl: "Firecrawl (MCP, 免 Key 但有额度, 默认关)",
-  tinyfish: "TinyFish (MCP, 免 Key 30/min·50/day, 默认关)",
+  firecrawl: "Firecrawl (MCP, keyless tier rate limited, off by default)",
+  tinyfish: "TinyFish (MCP, keyless 30/min 50/day, off by default)",
@@ :236-239
-  firecrawlApiKeyEnv: ... .description("Firecrawl API Key 凭证引用（可选；留空用免 Key hosted tier）"),
-  tinyfishApiKeyEnv: ... .description("TinyFish API Key 凭证引用（可选；留空用免 Key 模式）"),
+  firecrawlApiKeyEnv: ... .description("Credential ref for the optional Firecrawl API key; empty uses the hosted keyless tier."),
+  tinyfishApiKeyEnv: ... .description("Credential ref for the optional TinyFish API key; empty uses keyless mode."),
@@ :260-263
-  firecrawlBaseURL: ... .description("Firecrawl MCP 端点（默认官方 v2；可指向 TLS sidecar）"),
-  tinyfishBaseURL: ... .description("TinyFish MCP 端点（默认官方；可指向 TLS sidecar）"),
+  firecrawlBaseURL: ... .description("Firecrawl MCP endpoint; defaults to the official v2 URL and may point at a TLS sidecar."),
+  tinyfishBaseURL: ... .description("TinyFish MCP endpoint; defaults to the official URL and may point at a TLS sidecar."),
```

**配套（建议，非必须）**：`lib/client.js:15-32` 的 13 个 `label:` 硬编码中文（如 `"Firecrawl (免 Key · 有额度 · 默认关)"`）
也是 N1 意义上的产品文案；但它们由 `BACKENDS` 数组直接渲染、**未走 `t()`**。合规做法是在 zh/en 字典各加
`backendLabel.<id>` 键并 `props.t(...)` 取，或按 N5「plugin-authored data renders verbatim」明确登记为**例外**并在 README 说明。
**等级 B（规范要求）+ A（当前硬编码事实）**。

#### 方案 B（不推荐，成本高）：让 `description` 走 locale 字典

需 Host 半 `lib/index.js` 读取 Client locale 服务 → 跨 Host/Client 面、需在 `inject` 加 locale 依赖、
且 `Config` schema 在 `apply()` 之前就已构造（locale 服务可能尚未激活），存在加载顺序问题。
**等级 E（未验证可行性）**，且违反 `packages/client/AGENTS.md` 的「components never see ctx / layering red lines」精神。
**结论：不采用**。

#### 方案 C（**明确否决**）：因「gate 没红」而保留中文

违反 §1.2 的假阴性结论与 N5 的「product-owned catalog descriptions follow the same rule」。**否决**。

### 1.5 分档

| 项 | 分档 | 理由 |
|---|---|---|
| 新增 6 个中文 `description` 改中性英文 | **必须改** | 本轮引入、N1/N5 明文、`README:122` 自证是唯一可见文案；改动零风险（只改字符串） |
| `DEFAULT_LABELS` 其余 11 个 / 其余 36 个中文 `description` | **建议改** | 属上游既有风格，收敛需全量 + 与 2.8.8 对齐（**E**）；不属本轮回归 |
| `lib/client.js` 13 个硬编码 `label:` | **建议改**（或按 N5 登记例外） | 同上，属 UI copy 但当前 gate 扫不到 |

---

## 2. 逐项二：死代码清理（删除 / 保留+理由）

### 2.1 逐条裁决表

| # | 死代码 | 事实（A） | 裁决 | 会不会破坏 snapshot / 上游契约 | 等级 |
|---|---|---|---|---|---|
| **D1** | **`resultHeader` 是 Config 里不存在的死开关（恒真）** | `provider.js:419,464` 判 `opts.resultHeader !== false`；**`resolveOptions()`（`index.js:318-410`）的返回对象里根本没有 `resultHeader` 字段**（逐行读 `:387-410` 无此键）；`grep -rn 'resultHeader' lib/` 只有 5 处：2 处 import/定义、2 处读取、1 处 `:417` 注释。**Config schema 也无此字段**（`index.js:154-283` 无）。⇒ 条件恒真，`resultHeader()`（生成 `RESULT_HEADER_ZH/EN`）**总是执行**，是模型可见文本的一部分 | **删除「开关判据」，保留 `resultHeader()` 函数与生成文本**。把 `if (opts.resultHeader !== false && …)` 改为 `if (…)`；删 `:417` 的「可用 opts.resultHeader === false 关闭」注释 | **不会破坏上游契约**：字段从未在 Config/options 中存在，无 caller 可传；**但会改变模型可见文本吗？不会**——恒真分支本就一直走，删除判据后输出逐字不变。⚠️ **`resultHeader()` 函数本身不能删**：它产出的 `RESULT_HEADER_*` 是模型可见提示（[34 §2 ⑦a](34-official-alignment-seam.md) 已确认随 `content` 回灌），删了会改变模型可见文本 ⇒ 需按 `AGENTS.md:154` 更新 snapshot（**E**：本次未端到端验证 session log 中该字段，见 34 D-6） | **A**（+E 关于 snapshot） |
| **D2** | **`QUERY_GUIDANCE_EN/ZH` 死导出** | `prompting.js:78,87` 定义；`provider.js:25` 只 import `shapeQuery / resultHeader / TELEMETRY_TAG`；全库 `grep -rn QUERY_GUIDANCE lib/` **只有 2 处定义、0 处引用**；`README.md` 中 `grep QUERY_GUIDANCE|查询构造指引|prompting` **0 命中**；`client.js` 无 `ctx.systemPrompt.section`（[36 §1](36-lead-prefindings.md):9-12 已独立核过） | **保留 + 补一句契约注释**（见下）⇒ 若产品决定不注入，则**删除**并在 README 标注 | **删除不会破坏 snapshot**（从未进模型请求），**可能破坏上游 API 契约**：它是 `export const`，属包级公开符号；2.8.8 是否仍导出/是否有外部宿主 import **未核实（E）**。⇒ 保守做法是**保留**，但把注释从「导出给宿主/代理层注入 agent 系统提示用；本插件不发送」改成明确的**当前状态契约**（见 §3.2 改写表） | **A + E**（上游契约） |
| **D3** | **`history.js` 的 `isTrustedApiRequest` 死 fence** | `history.js:104` 定义；`grep -rc isTrustedApiRequest lib/*.js` → 只有 `history.js:1`（定义）与 `trust.js:1`（注释提及），**0 处调用**。实际三条路由（`health.js:94`、`settings-api.js:84`、`history.js:157`）**全部**用 `rejectionFor(req, connection)`（`trust.js:82`）。`trust.js:123` 注释自称「The replica fence. Same shape as the kernel's `isTrustedApiRequest`」⇒ 是**作者留下的第二套 fence** | **删除**（`history.js:104-120` 整个函数 + 其 JSDoc `:96-103`），但**保留 `rejectionFor` 三处调用不变** | **不会破坏 snapshot**（不产生任何输出）；**不会破坏安全**：[36 §2](36-lead-prefindings.md):14-18 已确认三处 `rejectionFor` 覆盖完整、fence 无绕过。**⚠️ 上游契约风险（E）**：同名函数在官方 `dsh-client-connection/lib/index.js:240` 也存在（我实测 `grep` 命中），但那是**不同包、不同签名**（官方是 `(request, trustedHosts, bindHost, protocol)`，插件是 `(req)`），不是 import 关系；插件内 0 调用 ⇒ 删除安全。**注意命名混淆**：若保留，维护者易误以为它在生效 | **A/D + E**（同名不同包） |
| **D4** | **`client.js` 6 个「定义未用」字典键** | 深度键提取（[32 §6.1](32-adversarial-ops-b.md)）实测 zh/en **各 54 键完全对称**；6 个键 `title` / `dirty` / `saved` / `reset` / `overridden` / `togglesTitle` 在 `props.t()` / `ctx.locale.bind(NS)()` 中 **0 引用**。**关键**：`src-work/backups/client.js.orig`（改前原文）中这 6 个键**同样存在且同样未用** ⇒ **非本轮引入，是上游 2.8.4 既有冗余** | **保留（本轮不动）**，理由：① 非本轮回归，动了会扩大 diff、与 2.8.8 上游分歧；② 键集合 zh/en 对称，字典 parity gate 绿；③ **可能**被 `t()` 动态拼接或未来 UI 消费（**E**：未跑浏览器验证）。建议作为**独立上游 PR** 清理 | **不会破坏 snapshot**（不渲染即无可见输出）；**不会破坏上游契约**（是内部字典键，非 export）。删除风险低但收益也低 ⇒ 归「建议改（另案）」 | **A/D + E** |
| **D4b** | （澄清，非缺陷）`nav` / `keyLabel` | `nav` 在 `client.js:801` 由 `ctx.locale.bind(NS)("nav")` 引用；`keyLabel` 在 `:719` 由 `props.t("keyLabel", { id: b.id })` 插值引用。**不是死键**，是简单 `t("key")` 正则没覆盖 bind/双参形式 | **保留** | — | **A/D** |

### 2.2 删除/保留对 snapshot 与上游契约的总表

| 动作 | snapshot 影响 | 上游契约影响 | 建议验收 |
|---|---|---|---|
| 删 D1 的 `opts.resultHeader !== false` 判据 | **零**（恒真分支输出逐字不变） | 零（字段本就不存在） | `node --test tests/*`；`grep -n resultHeader lib/` 只剩 `resultHeader()` 定义与 2 处调用 |
| 删 D2 `QUERY_GUIDANCE_*` | 零（从未进模型请求） | **E**：公开 export，2.8.8 未核实 | 若删：先 `npm pack @240xu/dsh-websearch@2.8.8` 核对 `prompting.js` 是否仍导出（**本次只读未做**） |
| 删 D3 `isTrustedApiRequest` | 零 | 低（不同包同名，插件内 0 调用） | 删后 `grep -rn isTrustedApiRequest lib/` 应只剩 `trust.js:123` 注释；三处 `rejectionFor` 不变 |
| 删 D4 6 键 | 零 | 零（内部字典） | 删后重跑键 parity 脚本，zh/en 仍须各 48 键且对称 |

> **反直觉点 2**：`resultHeader` 的「死开关」和 `resultHeader()` 的「模型可见文本」是**两件事**。
> 34 号把它列为「模型可见但未显式满足 Model-visible⟺logged」的三段之一（[34 §2 ⑦a/⑦c](34-official-alignment-seam.md)）。
> 因此**只删判据、不删函数**；若连函数一起删，会改变模型可见文本 ⇒ 触发 `AGENTS.md:154` 的 snapshot 要求。

### 2.3 分档

| 项 | 分档 |
|---|---|
| D1 删除恒真判据 + 删 `:417` 误导注释 | **必须改**（注释明确承诺了一个不存在的开关，属 `docs/AGENTS.md:39` 的「文档描述当前状态」违规） |
| D3 删除死 fence | **建议改**（消除两套 fence 的维护漂移风险；[36 §2](36-lead-prefindings.md) 已判「非安全漏洞，仅冗余」） |
| D2 保留但改写注释为当前状态契约 | **建议改**（本轮不改符号，只改注释；删除留待上游 2.8.8 核对后另案） |
| D4 6 键保留 | **可接受**（既有冗余，另案） |

---

## 3. 逐项三：注释规范 — 去掉 review 叙事

### 3.1 违规判定（B 级规范 + A 级事实）

`$P/lib/` 与 `$P/tests/` 中带 `lead (20…)` / `lead-fix (20…)` 前缀的注释共 **69 处**
（逐文件：`index.js` 12、`client.js` 17、`firecrawl.js` 5、`tinyfish.js` 5、`provider.js` 4、
`egress-fetch.js` 2、`mcp-client.js` 2、`trust.js` 2、`lead-20261106.test.js` 9、
`lead-20261107.test.js` 3、`lead-20261107-p0.test.js` 8）。

其中**明确违反 N2/N2b/N2d「不得保留 review history / 不得 narrate」**的是含以下 token 的注释：
`review 30-b P1`、`review 31-b P0/P1`、`review 33`、`P0`、`P1`、`issue #8`、`upstream PR #7`、
`WBS T-08/T-09`、`21-engineering-plan.md`、`22-execution-drafts.md`、`Added by … as part of … plan`、
`Previously …`（过程叙事）、`TWO adversarial reviewers`。

**分两类**：
- **(a) 日期 + 作者前缀** `// lead (2026-11-06)` / `// lead-fix (…)`：DSH 规范未禁止作者/日期，但
  `AGENTS.md:148`「Keep comments local」+ N3「history 放 commits/PRs/Agent Notes，其他 prose 只讲现行机制」
  ⇒ **建议统一去掉**（版本历史由 git/25 号执行日志承担）。
- **(b) review 编号 / P0 / issue 编号 / 审查过程叙事**：**明确违反 N2/N2b/N2d**，**必须改**。

**关键保护（A/D）**：三个测试文件的静态断言**只匹配代码表达式**（`lead-20261106.test.js:102-153`、
`lead-20261107.test.js:82-85`、`lead-20261107-p0.test.js:103-105`），
`grep` 确认 **0 处断言依赖注释文本** ⇒ 改注释**不会让任何现有测试变红**，也**不需要**更新 snapshot（注释不进模型请求）。
等级 **A/D**。

### 3.2 注释改写对照表（**建议文本，未执行**）

> 保留契约/依据/失败模式/所有权，删除 review 编号、日期、过程叙事、「Previously」「was unreachable」等历史叙述。
> 「依据」按 N2「link the rationale」改为指向**机制名/官方文档/上游编号但不带审查叙事**；PR/issue 编号若确属契约来源可保留为纯引用
> （如 `RFC1918`、`DSH 0.2.x remote service keys`），但不得写「review XX 发现」「P0」。

| # | 文件:行号 | 现文本（短引） | **新文本（建议）** | 分档 |
|---|---|---|---|---|
| 1 | `lib/index.js:464-470` | `// lead-fix (2026-11-07, review 30-b P1): on DSH 0.2.x the settings service keys namespaces by entry.options.id … The upstream PR #7 matched only the latter, so its primary lookup was dead code … Match the live id first (keeping NAMESPACE for older hosts), then shape, then fall back to initial config.` | `// DSH 0.2.x keys settings namespaces by entry.options.id ("dsh-websearch");\n// older hosts use the NAMESPACE id. Match both before the shape fallback,\n// then fall back to the initial config when describe() fails.` | **必须改** |
| 2 | `lib/provider.js:316-320` | `// lead-fix (2026-11-07, upstream PR #7): 192.168/16 and 172.16/12 already match the first two octets … The old {3} made every RFC1918 plain-http baseURL fail the trust gate even though the docs promise private hosts may use http.` | `// The first two octets of 192.168/16 and 172.16/12 are already matched,\n// so exactly two further octets may follow. Plain-http is allowed only for\n// RFC1918 hosts that pass this gate.` | **必须改** |
| 3 | `lib/backends/tinyfish.js:45-48` | `// lead-fix (2026-11-07, review 31-b P0): resolveOptions() gives an async resolveApiKey(), not a literal apiKey. Without this the keyed branch … was unreachable dead code and every request was silently keyless.` | `// resolveOptions() supplies an async resolveApiKey() closure. A literal\n// apiKey is accepted for stubs; a failed resolution degrades to keyless.` | **必须改** |
| 4 | `lib/backends/tinyfish.js:58-59` | `// lead-fix (2026-11-07, review 31-b P1): honour configured baseURL so the sidecar/proxy path and provider.js trust gate are not bypassed.` | `// Use the configured baseURL so the provider trust gate and sidecar path apply.` | **必须改** |
| 5 | `lib/backends/firecrawl.js:45-52` | `// lead-fix (2026-11-07, review 31-b P0): resolveOptions() supplies an async resolveApiKey(), NOT a literal apiKey. Reading only the literal made the optional key unreachable … Match anthropic-like.js:71 … A failure to resolve degrades to keyless.` | `// resolveOptions() supplies an async resolveApiKey(); a literal apiKey is\n// accepted for stubs (same split as anthropic-like.js). Resolution failure\n// degrades to the keyless tier.` | **必须改** |
| 6 | `lib/backends/firecrawl.js:56-58` | `// lead-fix (2026-11-07, review 31-b P1): honour the configured baseURL instead of hardcoding it, so the sidecar/proxy path and the provider.js trust gate apply. Fall back to the official endpoint when unset.` | `// Use the configured baseURL so the provider trust gate and sidecar path\n// apply; fall back to the official endpoint when unset.` | **必须改** |
| 7 | `lib/client.js:348-351` | `// lead-fix (2026-11-06, issue #8): guard the property access. Before the inject fix this threw and the empty catch below swallowed it, so the "configured" badge never lit up.` | `// A host that does not register remote.credentials throws on property\n// access; guard it so read failures cannot be swallowed by the outer catch.` | **必须改** |
| 8 | `lib/client.js:356-362` | `// lead-fix (2026-11-07, review 33): judge the envelope FIRST. An ok:false response is a read failure … Previously the three-layer unwrap turned it into undefined … (No dedicated read-error UI state exists, so do NOT reuse failedKeys — its copy says "save failed".)` | `// An ok:false envelope is a read failure, not "unconfigured". Do not reuse\n// failedKeys here: it has no read-error state and its copy says "save failed".` | **必须改** |
| 9 | `lib/client.js:384-392` | `// lead-fix (2026-11-06, issue #8): two defects fixed here. (a) The property access itself can throw … (b) set() resolves with a { ok, value } \| { ok:false, error } envelope rather than throwing …` | `// set() resolves with { ok, value } | { ok:false, error }; treat ok === false\n// as a failure. Guard the remote.credentials property access so hosts that\n// omit the namespace fall back to the connection API instead of throwing.` | **必须改** |
| 10 | `lib/client.js:518-524` | `* lead (2026-11-06 UX): combined card for a key-gated backend. Previously the enable switch lived in "Requires API key" and the credential input in a separate grid far below, forcing the user to scroll … Co-locate them here …` | `* One card per key-gated backend: toggle, configured badge, key link,\n* input, hint, and per-key error. The toggle writes immediately; the key is\n* staged until Save.` | **必须改** |
| 11 | `lib/client.js:764-771` | `// lead-fix (2026-11-06, github.com/240xu/dsh-websearch/issues/8): DSH 0.2.x registers each remote namespace as its OWN service key … Accessing … without declaring it in inject THROWS … which made every key save fail … The official dsh-client-ui-settings-models plugin declares the same key.` | `// DSH 0.2.x registers each remote namespace as its own service key;\n// remote.credentials must be declared in inject or property access throws.\n// The official settings-models plugin declares the same key.` | **必须改** |
| 12 | `lib/util/mcp-client.js:160-162` | `// dsh-websearch / lead-fix (2026-11-06): keep the 3-step handshake as the default (zero regression for exa/parallel) but allow a direct tools/call for keyless stateless servers. See 22-execution-drafts.md draft D.` | `// The 3-step handshake stays the default; keyless stateless servers may\n// skip initialize via options.skipInitialize.` | **必须改** |
| 13 | `lib/util/egress-fetch.js:170-180` | `// dsh-websearch / lead-fix (2026-11-06): normalizeHeaders() strips Host (see below). … Offline proof (local CONNECT proxy + TLS server, 2026-11-06): patched -> Host "localhost:45277" …` | `// normalizeHeaders() strips Host. For a CONNECT-tunnelled request Node\n// synthesises a portless Host from options.host; Cloudflare-fronted MCP\n// endpoints reject it with 403. Restore an explicit, port-qualified Host\n// here, matching httpViaProxy().` | **必须改**（删 A/B 实验叙事，保留因果契约） |
| 14 | `lib/index.js:36` | `// lead (2026-11-06): OpenCode v2 keyless MCP backends, see 21-engineering-plan.md T-08/T-09.` | （**删除整行**；import 本身自解释，N2c「do not restate code」） | **建议改** |
| 15 | `lib/index.js:69-70, 80-81, 93, 111, 142-143, 212, 233-235, 258-259, 339` | 9 处 `// lead (2026-11-06): …`，内容多为「appended last」「opt-in by default」「keep in sync with BACKENDS / Config toggles」 | 保留**契约句**、删前缀与日期。例：`:69-70` → `// Appended last so default fan-out order is unchanged; both are opt-in\n// because their keyless tiers are metered.`；`:339` → `// Keep in sync with BACKENDS / Config toggles.`（这句是真实不变量，保留） | **建议改** |
| 16 | `lib/client.js:26-29, 42-45, 66, 71, 88, 121, 126, 143, 618-619, 638-639, 650-651, 722-724` | 12 处 `// lead (2026-11-06 UX): …`，多为「split metered out of keyless」「switch is immediate, key needs Save」「old grid has been merged」 | 保留**设计不变量**（「metered 不进 KEYLESS」「switch 即时 / key 需 Save」「一张卡」），删前缀/日期/`Previously`/`has been merged`。例 `:88` → `// The toggle writes immediately; the key is staged until Save.` | **建议改** |
| 17 | `lib/backends/{firecrawl,tinyfish}.js:3-7` | `// Added by dsh-websearch / lead (2026-11-06) as part of the OpenCode v2 endpoint-merge plan, see: .artifacts/.../21-engineering-plan.md (WBS T-08/T-09), 22-execution-drafts.md …` | 文件头改为**模块契约**（N2e「Module comments: state the module's role, dependencies, responsibilities」）：`// Firecrawl search backend (streamable-http MCP, v2). Endpoint … keyless … keyed …`，保留端点/协议/额度事实，**删 plan/WBS/报告路径**（历史归 25 号执行日志） | **必须改** |
| 18 | `tests/lead-20261107.test.js:1-11` | `// … "saving a setting does nothing" bug (upstream PR #7) … Added 2026-11-07 by lead … Background: on DSH 0.2.x apply(ctx, config) receives only schema defaults … This pins the fix from PR #7 that we applied locally.` | `// Fixtures only: fake Context, settings service, and fetch; no live network,\n// credentials, or DSH runtime. Pins that apply() reads live settings values\n// instead of the initial schema-default config.` | **必须改** |
| 19 | `tests/lead-20261107-p0.test.js:1-11` | `// … regression for review 31-b P0. // P0 (independently found by TWO adversarial reviewers, 31 / 31-b): … was unreachable dead code … // P1: both *BaseURL … were registered but never consumed` | `// Pins that both backends consume resolveApiKey() and the configured\n// baseURL; fixtures only, no live network.` | **必须改** |
| 20 | `tests/lead-20261106.test.js:103, 117, 146, 175, 180, 186, 204, 215` | 8 处含 `lead`/`issue #8`/`review 33`/`UX polish`/`UX round 2`；测试名 `:180` `test("client.js issue #8: …")`、`:215` `test("issue #8: ok:false envelope …")` | 测试名按 N6「describe behavior, not correctness」改为行为描述：`"credential save path rejects an ok:false envelope"`；注释删前缀/编号，保留「为什么用 fake host」「为什么静态断言 i18n」的设计说明 | **必须改** |
| 21 | `lib/provider.js:85, 99, 458`；`lib/cache.js:34`；`lib/trust.js:37, 86` | **上游既有**注释含 `2.8.2（P1）`、`arch-review P1-1`、`(issue #89)` | **可接受（本轮不动）**：非本轮引入，属上游 2.8.4 既有风格；若做全库统一清理，另案处理 | **可接受** |

### 3.3 改写原则（供执行者复用）

1. **删**：`lead` / `lead-fix` / 日期 / `review NN` / `P0` / `P1` / `issue #8` / `PR #7` / `WBS T-` / 报告路径 / `Previously` / `was unreachable` / `Added by … as part of … plan` / A/B 实验过程。
2. **留**：条件、时序、失败模式、所有权、副作用、否定保证、异常、不变量（N2b 的 enumerate）。
3. **依据**改为「机制名 + 链接」而非「谁在何时发现」：如 `DSH 0.2.x remote service keys`、`RFC1918`、`official settings-models plugin`。
4. **历史**统一由 git commit / [25 执行日志](25-execution-log.md) / Agent Notes 承担（N3），源码注释只讲现行机制。
5. **验收**：`grep -rnE 'lead(-fix)|review [0-9]|P0|P1|WBS T-|issue #8|PR #7' $P/lib $P/tests` 应只剩上游既有项（#21）；
   `node --test tests/*.test.js` 应仍 14+/14+ 通过（注释不参与断言，A/D）。

### 3.4 分档汇总

| 类别 | 数量 | 分档 |
|---|---|---|
| 含 review/P0/P1/issue/PR/WBS/过程叙事的注释（表中 #1–13、17–20） | **约 24 处** | **必须改** |
| 仅 `// lead (date)` 前缀但内容是契约（#14–16） | **约 21 处** | **建议改** |
| 上游既有 `2.8.2（P1）` / `arch-review` / `issue #89`（#21） | **6 处** | **可接受**（另案） |

---

## 4. 逐项四：README env 优先级失真

### 4.1 违规点（A/D，引 34 号已核实结论）

`$P/README.md:116` 逐字：

> 环境变量兜底：未在 credentials 配置时回退读同名环境变量；`DSH_UNIFIED_SEARCH_BACKENDS` **可逗号分隔强制指定启用集合**。

但 `lib/index.js:318-357` `resolveOptions()` 的实际顺序是
`config.enabledBackends` → **Config toggles** → `ENABLED_ENV`（`DSH_UNIFIED_SEARCH_BACKENDS`）→ `DEFAULT_ENABLED`，
而 `:201-204` 四个 keyless toggle 均为 `.default(true)` ⇒ schemastery 把默认值填进 config ⇒
**toggle 分支永远非空，env 分支永远到不了**。

[34-official-alignment-seam-b.md:110](34-official-alignment-seam-b.md) 的 **D 级** node 忠实推演四组输出：
A「schema 默认 + env=`firecrawl`」→ `["exa","parallel","ddg","searxng"]`（**env 被吞**）；
B「全 toggle=false + env=`firecrawl`」→ `["firecrawl"]`；
C「无 config + env=`firecrawl`」→ `["firecrawl"]`；
D「`enabledBackends:['tinyfish']`」→ `["tinyfish"]`。
[34-official-alignment-seam.md:93-95](34-official-alignment-seam.md) 独立复核同结论，并指出
「运行态 `/proc/262230/environ` 无 `DSH_UNIFIED_SEARCH_BACKENDS`，所以当前线上不受影响」（D 级）。

⇒ 「**强制指定**」是**失真表述**：在默认配置下该 env **静默无效**。`lib/index.js:319` 的注释
`// 1. Determine enabled backends: explicit list > toggles > env > defaults` 虽顺序写对，
但未说明「toggle 有 schema 默认 ⇒ env 实际不可达」，同属需精确化项。

### 4.2 规范出处

- **N3** `docs/AGENTS.md:39`「Document current state … Other prose names live mechanisms, not changes」；
- **N4** `AGENTS.md:173`「Docs accompany every code change: update affected README … together」；
- `docs/AGENTS.md:45`「Comments and JSDoc state complete contracts」（`:319` 注释亦属此）；
- 07 号报告里的 DSH README 纪律：`packages/web/*/README.md` 的 `## Known Limitations and Deferred Work` 必须记录
  「durable consumer gaps」（[07 §1](07-dsh-docs.md)）⇒ 这个 env 失效正是应登记的 consumer gap。

### 4.3 准确措辞（**建议 diff，未执行**）

**方案 1（推荐，只改文档，零行为风险）**：把「强制」降级为**实际语义**并登记为已知限制。

```diff
--- a/README.md
+++ b/README.md
@@ :116
-环境变量兜底：未在 credentials 配置时回退读同名环境变量；`DSH_UNIFIED_SEARCH_BACKENDS` 可逗号分隔强制指定启用集合。
+环境变量兜底：未在 credentials 配置时回退读同名环境变量。
+`DSH_UNIFIED_SEARCH_BACKENDS` 可逗号分隔指定启用集合，但它只在**所有 `enableXxx` 开关都显式为 `false`
+且未设置 `enabledBackends`** 时生效：四个 keyless 开关的 schema 默认是 `true`，会被 schemastery 填入
+config，使开关分支优先于 env。优先级为 `enabledBackends` → 开关 → 该 env → `DEFAULT_ENABLED`。
+若要让 env 生效，请先在设置面板把四个 keyless 开关全部关闭（或改用 `enabledBackends` 显式列表）。
```

**方案 2（若同时改代码，需另案批准）**：把 `ENABLED_ENV` 判据**提到 toggle 之前**，
或把 4 个 `.default(true)` 改成「未设置时视为未配置」语义（34 号建议，[34-official-alignment-seam-b.md:155](34-official-alignment-seam-b.md)）。
此时 README 可保留「强制指定」，但**必须**同步改 `:319` 注释并加 fixture 单测（A 组推演应得 `["firecrawl"]`）。
⚠️ 这是**行为改动**，会改变默认配置下 `web_search` 的后端集合 ⇒ 触发 `AGENTS.md:154` 的 keyless recorded-session snapshot 要求。
**等级 E（未执行、未验证）**。

**配套注释修正**（`lib/index.js:319`）：

```diff
-  // 1. Determine enabled backends: explicit list > toggles > env > defaults
+  // 1. Determine enabled backends: explicit list > toggles > env > defaults.
+  // Schema-defaulted toggles are always populated, so the env applies only
+  // after every toggle is explicitly disabled.
```

### 4.4 分档

| 项 | 分档 | 理由 |
|---|---|---|
| README `:116`「强制指定」改为实际优先级 + 登记为 Known Limitation | **必须改** | 用户按文档设 env 会静默无效（运维陷阱），N3/N4 明文；只改文档零风险 |
| `lib/index.js:319` 注释补「toggle 默认填充 ⇒ env 仅兜底」 | **必须改** | 注释描述了不完整的契约（N2b） |
| 方案 2 改代码优先级 | **建议改（另案，需批准 + snapshot）** | 属行为变更，非本轮「只给提案」范围 |

---

## 5. 总表：必须改 / 建议改 / 可接受

| # | 项 | 章节 | 分档 | 证据等级 | 改动面 |
|---|---|---|---|---|---|
| 1 | 新增 6 个 `Config.description`（含 2 个 `DEFAULT_LABELS`）改中性英文 | §1.4 方案 A | **必须改** | **A/B**（gate 不会拒为 A/D） | 只改字符串，零行为风险 |
| 2 | `resultHeader` 恒真判据 `opts.resultHeader !== false` + `:417` 误导注释 | §2.1 D1 | **必须改** | **A** | 删判据，输出逐字不变 |
| 3 | 24 处 review/P0/issue/PR/WBS 叙事注释改写 | §3.2 #1–13,17–20 | **必须改** | **B + A/D** | 只改注释，0 断言依赖 |
| 4 | README `:116`「强制指定」失真 + `index.js:319` 注释不完整 | §4.3 | **必须改** | **A/D**（引 34 号） | 只改文档 + 注释 |
| 5 | 删 `history.js` 死 fence `isTrustedApiRequest` | §2.1 D3 | **建议改** | **A/D + E** | 删函数，三处 `rejectionFor` 不变 |
| 6 | `QUERY_GUIDANCE_*` 保留但注释改当前状态契约 | §2.1 D2 | **建议改** | **A + E**（上游 export 未核实） | 只改注释 |
| 7 | 21 处 `// lead (date)` 前缀删除（保留契约句） | §3.2 #14–16 | **建议改** | **B** | 只改注释 |
| 8 | `client.js` 13 个硬编码 `label:` 走字典或登记 N5 例外 | §1.4 配套 | **建议改** | **A/B** | 字典键 + `t()` |
| 9 | 其余 36 个中文 `.description` / 11 个 `DEFAULT_LABELS` 收敛 | §1.5 | **建议改（另案）** | **A + E**（2.8.8 未核实） | 全量，需与上游对齐 |
| 10 | 6 个死字典键删除 | §2.1 D4 | **可接受**（另案） | **A/D + E** | 非本轮回归 |
| 11 | 上游既有 `2.8.2（P1）` / `arch-review P1-1` / `issue #89` 注释 | §3.2 #21 | **可接受** | **A** | 非本轮引入 |
| 12 | 方案 2 改 env 代码优先级 | §4.3 | **建议改（需批准 + snapshot）** | **E** | 行为变更 |

---

## 6. 已确认无误 / 无法验证

### 6.1 已确认无误

| # | 事实 | 等级 |
|---|---|---|
| 1 | zh/en 字典 **54/54 完全对称、0 use-undef**；`nav`/`keyLabel` 非死键（bind/插值引用） | **A/D**（[32 §6.1](32-adversarial-ops-b.md)） |
| 2 | 14 个测试 61 断言、0 恒真、0 live network、0 真实 key；`node --test` 实跑 14/14 | **D** |
| 3 | **0 处测试断言依赖注释文本** ⇒ 注释改写不会变红、不需 snapshot | **A/D** |
| 4 | `dsh.client.inject`（`package.json:57-66`，包级依赖列表）**不需要**随 `lib/client.js:758` 的 service key 改动同步（[25 §10.2](25-execution-log.md):201 判断成立）；Lead 补充证据：官方 `dsh-client-ui-settings-web-search/lib/client.js:482-488` 的 inject 是 5 项 `["slots","locale","remote","remote.credentials","configForms"]`，`:348-350` 是 `describe([ref])` + `response.value[ref]` **一层解包** | **A/B**（Lead 已核实，我未独立复跑官方文件，按转述引用） |
| 5 | `rejectionFor` 在 `health.js:94`/`settings-api.js:84`/`history.js:157` 三处覆盖完整，删死 fence 不影响安全 | **A/D**（[36 §2](36-lead-prefindings.md)） |
| 6 | `prompting.js`/`history.js` 与 `src-work/plugin` md5 一致、无 `.orig` 备份 ⇒ 这两个文件**本轮未被改动**，其死代码是上游既有 | **A/D** |
| 7 | 当前运行进程 env 无 `DSH_UNIFIED_SEARCH_BACKENDS` ⇒ README 失真暂未造成线上影响 | **D**（[34](34-official-alignment-seam.md):93） |

### 6.2 无法验证（E，不得当结论）

| # | 项 | 原因 | 建议 |
|---|---|---|---|
| E-1 | 2.8.8 上游是否仍导出 `QUERY_GUIDANCE_*` / 仍有中文 `description` | 本会话未下载 2.8.8 tarball；`/tmp` 中无已解包副本 | `npm pack @240xu/dsh-websearch@2.8.8` 后比对 `lib/prompting.js` / `lib/index.js` |
| E-2 | 6 个死字典键是否被 `t()` 动态拼接 / 浏览器运行时消费 | 只静态扫 `lib/client.js`，未跑浏览器 | 浏览器控制台 `Object.keys(locale NS)` 比对 |
| E-3 | `resultHeader` 生成的文本在 session log 的 `tool/result` 中是否完整持久化 | 34 号已标 D-6「未端到端验证」；本任务只读、无 GUI token 取 session log | 认证会话里跑一次 `web_search` 后读 `tool/result.content` |
| E-4 | 把插件源码放进 DSH 仓库让 gate 扫到后**具体报几条违规** | 需复制文件 + 改扩展名（会写文件，超出只读范围） | 在隔离 worktree 用 `findUiI18nViolations()` 导出的 API 跑一次 |
| E-5 | 方案 2（改 env 优先级）对默认 `web_search` 后端集合与 snapshot 的实际影响 | 属行为改动，未执行 | 需在批准后在隔离副本跑 34 号四组推演 + snapshot |
| E-6 | 0.2.0 SettingsForms 是否**真的**把 `meta.description` 原样渲染（README:122 是插件作者自述） | `packages/client/ui-primitives/src/settings-form/form-model.ts` 未找到 `meta.description` 直读；可能是 host 侧表单生成 | 读 `dsh-settings` host 半或跑一次 GUI 表单渲染 |
| E-7 | 官方 `dsh-client-ui-settings-web-search` 的 inject / 解包层数 | Lead 转述已核实，本会话未独立复跑该官方文件 | 由 33/34 号官方对齐专家交叉复核 |

---

## 7. 五条反直觉发现

1. **`verify-client-ui-i18n` 绿色是假阴性**：gate 的 `sourceFiles()`（`scripts/verify-client-ui-i18n.ts:319-337`）只 glob
   `packages/client/*/src/**/*.tsx`、`apps/web/src/**/*.{ts,tsx}` 等**仓库内**路径；
   插件在 `/home/dsh/.dsh/profiles/web/node_modules/`（仓库外、`.js` 后缀），**根本没被扫**。
   所以「中文 description 合规」不能靠 gate 证明，必须靠 N5 + `README:122` 人工判定。**A/D**。

2. **`Config.description` 与 UI copy 是「同一业务事实、两套机制」**：N5 明文「Product-owned catalog descriptions follow the same rule」，
   且 `$P/README.md:122` 自证 `meta.description` 是 0.2.0 表单**唯一用户可见文案** ⇒ 按规范**同一约束**；
   但强制 gate 不同（一个是 Client AST，一个是 `dsh-settings` 的 `volatileForm`/`plainSchema`，`schema.ts:37-47`）。
   答「是否同一约束」必须分这两层，否则两面都会答错。**A/B**。

3. **`resultHeader` 的「死开关」不等于「死文本」**：`opts.resultHeader !== false` 恒真（Config/options 里根本没这字段），
   但 `resultHeader()` 产出的 `RESULT_HEADER_ZH/EN` 是**模型可见文本**（34 号 ⑦a/⑦c）。
   ⇒ 只能删判据，**不能删函数**；删函数会改变模型可见文本并触发 `AGENTS.md:154` 的 snapshot 要求。**A + E**。

4. **4 处死代码里 3 处是「上游既有」，只有 1 处是本轮引入**：
   `prompting.js`/`history.js` 与 `src-work/plugin` md5 一致且**无 `.orig` 备份**（本轮没碰过）；
   6 个死字典键在 `client.js.orig`（改前原文）里同样存在。
   ⇒ 若把 4 项全算成「本轮技术债」会误伤上游契约，也会把 diff 无谓放大。**A/D**。

5. **注释改写零测试风险，但「review 叙事」分布比预期广**：不只是 `// lead-fix (…, review 31-b P0)`，
   还包括文件头的 `Added by … as part of … plan / WBS T-08`（`firecrawl.js:3-7`）、
   测试名里的 `issue #8`（`lead-20261106.test.js:180,215`）、以及上游既有的 `2.8.2（P1）`/`arch-review P1-1`（`provider.js:85`、`cache.js:34`）。
   共约 **24 处必须改 + 21 处建议改 + 6 处可接受**；`grep` 实测 **0 处断言依赖注释文本**，所以改写不会让 14/14 变红。**A/D**。

**附加（第 6 条）**：README 的 env 失真**不是文档笔误而是代码语义后果**——34 号用 node 四组推演证明
「schema 默认 toggle 永远填充 ⇒ env 分支不可达」。因此**只改 README 措辞**就能合规（方案 1），
而「恢复强制语义」要改代码并触发 snapshot（方案 2）。两者成本差一个数量级，建议先做方案 1。**A/D + E**。

---

## 8. 取证命令索引（全部只读，可复现）

```sh
P=/home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch

# §1 gate 作用域
sed -n '319,337p' /home/ova/dsh/scripts/verify-client-ui-i18n.ts
grep -n 'Client UI copy is locale-owned' /home/ova/dsh/AGENTS.md
grep -n 'Comments and docs state complete' /home/ova/dsh/AGENTS.md
sed -n '1,30p' /home/ova/dsh/.agents/notes/implemented/architecture/2026-08-23-locale-owned-client-ui-copy.md
grep -n '\.description(' "$P/lib/index.js" | head -60
sed -n '130,146p' "$P/lib/index.js"
grep -n 'meta.description' "$P/README.md"
sed -n '37,47p' /home/ova/dsh/packages/settings/settings/src/schema.ts

# §2 死代码
grep -rn 'resultHeader' "$P/lib/"; sed -n '387,410p' "$P/lib/index.js"
grep -rn 'QUERY_GUIDANCE' "$P/lib/"; sed -n '70,110p' "$P/lib/prompting.js"
grep -rc 'isTrustedApiRequest' "$P/lib/"*.js | grep -v ':0'
grep -rn 'rejectionFor' "$P/lib/"
md5sum "$P/lib/prompting.js" "$P/lib/history.js" \
  /home/ova/dsh/.artifacts/websearch-research/src-work/plugin/lib/prompting.js \
  /home/ova/dsh/.artifacts/websearch-research/src-work/plugin/lib/history.js

# §3 注释
grep -rnEi 'lead(-fix)? \(|review [0-9]|P0|P1|issue #8|PR #7|WBS T-|Added by dsh-websearch' \
  "$P/lib/" "$P/tests/" --include='*.js'
grep -rnE 'assert|match|includes' "$P/tests/"*.test.js | grep -i 'lead\|review\|PR #'   # → 0 命中

# §4 README
sed -n '110,124p' "$P/README.md"
sed -n '318,357p' "$P/lib/index.js"
grep -n 'DSH_UNIFIED_SEARCH_BACKENDS\|强制指定\|D-5' \
  /home/ova/dsh/.artifacts/websearch-research/34-official-alignment-seam*.md | head -12
```

---

**本报告无凭证值写入；未改任何源码/配置/其它报告/运行时；未操作任务板。**
**全部为提案，所有 diff 片段均为「建议文本」，未落盘到插件。**
