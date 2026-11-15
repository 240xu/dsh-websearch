# 37 · 六专家审查裁决汇总（终版）

> 2026-11-07，用户要求「分配三位对抗型审查专家，两位官方行为对齐专家和挖掘专家进一步深挖」。
> 6 位专家独立 fresh context、写作用域互不重叠、以**证伪**为目标；因 fork 子代理多次「取证完成但写文件前失败」，
> 另唤醒 6 位 durable teammate 做独立备份版。最终 **9 份报告**落盘（主版 + 部分 `-b` 备份版），共 39 份 md / 约 13400 行。
> 基线快照：`.baseline-20261107-1455/`；Lead 预发现：`36-lead-prefindings.md`；端到端保存实测：`38-e2e-save-probe.md`；
> 执行真相：[25-execution-log.md §12](25-execution-log.md)；口径权威链 = **99 + 24**。

## 1. 专家与产物

| 角色 | 目标 | 产物 | 行数 |
| --- | --- | --- | --- |
| 对抗 A | 保存链路证伪 | `30-adversarial-save.md` + `-b` | 137 |
| 对抗 B | 搜索执行证伪 | `31-adversarial-search.md`(369) + `-b`(278) | 647 |
| 对抗 C | 运维/回滚证伪 | `32-adversarial-ops.md`(313) + `-b`(447) | 760 |
| 官方对齐 A | 客户端凭证契约 | `33-official-alignment-client.md`(370) + `-b`(293) | 663 |
| 官方对齐 B | web seam / 工具契约 | `34-official-alignment-seam.md`(323) + `-b`(218) | 541 |
| 挖掘 | 未发现缺口 / 上游动态 | `35-deep-dig.md` + `-b`(189) | — |
| Lead 交叉材料 | 预发现 / 汇总 / 保存实测 | `36` / `37` / `38` | — |

**各报告自报最关键发现**：
- 30/30-b：PR #7 `ns` 主匹配死代码、升级 2.8.8 会静默回退；`remote.credentials` 真注册、`res.ok===false` 不误判 void。
- 31/31-b：**P0** 两个新后端不调 `resolveApiKey()`；`*BaseURL` 惰性；firecrawl 失败是 keyless 额度降级非代码 bug。
- 32/32-b：**P0** 回滚链漏文件；文档 28 项过时；`/tmp` cookie 含 JWT；14 测试含静态断言。
- 33/33-b：**必须修** `readCredential` 不判 `res.ok`；官方 inject 最小集无需补；rc.2=rc.5=0.2.2-rc.1 凭证契约逐字相同。
- 34/34-b：`unified` 单 provider 与 env pin 均官方源码支持；**D-3** config 遮蔽 env、**D-5** `DSH_UNIFIED_SEARCH_BACKENDS` 被 4 个 `.default(true)` toggle 吞掉；模型可见文本已由官方 tool/result 记录。
- 35/35-b：**状态类 P0** 作者「ok了」但未发布、升级反覆盖；官方 0.2.2-rc.1 需 Node≥24.9.0（本机 22.20.0）；OpenCode v2.2.6 新增 `provider.ts` 但仍 5 provider、firecrawl/tinyfish 未落后；10 条文档债 + 死代码清单。

## 2. 缺陷总表（Lead 裁决后）

| # | 来源 | 描述 | 严重度 | 独立复现 | 等级 | 裁决 |
| --- | --- | --- | --- | --- | --- | --- |
| F-1 | 31 + 31-b | `firecrawl.js:45`/`tinyfish.js:45` 只读 `options.apiKey` 字面量，`resolveOptions` 只给 `resolveApiKey()` → 可选 Key 永不到后端、TinyFish keyed 分支死代码 | **P0** | ✅ 两份独立报告 + Lead 行为级 mock | A/D | **成立，已修** |
| F-2 | 30 + 30-b + 33-b | PR #7 `current()` 的 `ns === "unified-search"` 主匹配是死代码（运行时 ns=`dsh-websearch`）；npm 2.8.8 无 shape fallback → 升级回退 | P1 | ✅ 三份 + Lead live API | A/D | **成立，已修** |
| F-3 | 31 + 31-b | 两个 `*BaseURL` 注册却不消费（硬编码端点），绕过 trust gate / sidecar | P1 | ✅ 两份 | A | **成立，已修** |
| F-4 | 33 + 33-b | `readCredential()` 不判 `RemoteResult.ok`，`{ok:false}` 落进 legacy `connection` 分支可能用陈旧值掩盖失败 | P1 | ✅ 两份 | A | **成立，已修**（不复用 `failedKeys`） |
| F-4b | 30 主版（443 行，20:50 到） | `remote.credentials` 写在 `inject` 是**硬依赖**：若某 host/启动时序未挂载该命名空间，整个 client fiber 不激活、整张设置卡片消失（最小 Cordis 复现 `ranWith=false`） | P1(条件性) | 单份 + Lead 复核 | A/D | **条件性风险，当前不成立，未改**（见 C-10） |
| F-5 | 32 + 32-b | §6 回滚链漏 `provider.js`、`lead-20261107.test.js`（+新增 `lead-20261107-p0.test.js`）、无验证命令 | P1(运维) | ✅ 两份 | A | **成立，已修**（§6 重写为 10 文件审计表） |
| F-6 | 34 + 34-b | `config.fetchProvider.get() ?? env`：将来 profile patch 写 `fetchProvider` 会让 drop-in env 静默失效 | P2(未来) | ✅ 两份 + Lead 源码 | A | **成立，当前不影响**；列为「未来改动前必读」 |
| F-7 | 34 + 34-b | `DSH_UNIFIED_SEARCH_BACKENDS` 被 4 个 `.default(true)` toggle 遮蔽，env 分支永不到达；README「强制指定」失真 | P2 | ✅ 两份 + node 四组推演 | A/D | **成立，当前不影响**（未依赖该 env） |
| F-8 | 32 + 32-b | `/tmp/*.cookies` mode 644 含会话 JWT；`/tmp/*.json` 含 64-hex | P2(安全) | ✅ 两份 | A | **成立，已清理本会话 2 个**；其余属它会话未动 |
| F-9 | 32 + 32-b + 35 | REPORT/99/25 共 20+ 处过时表述（份数、行数、PID、「默认关」、「当前不可用」、9 文件→10 文件） | P2(文档) | ✅ 三份 | A | **成立，已修头部与索引**；正文快照按 99 号约定保留为过程记录 |
| F-10 | 35 + 36 | 死代码：`resultHeader` 死开关、`QUERY_GUIDANCE_*` 死导出、`isTrustedApiRequest` 死 fence；settings-api 零单测；`DISCOVERY_FIELDS` 多 ns 误选 | P2/P3 | ✅ 两份 | A | **成立，未改**（产品行为/需用户决定，见 §6） |
| F-11 | 35 | 上游 PR#7/Issue#8 仍 open、作者「ok了」未发布、**升级 2.8.8 会覆盖本地自修重新引入缺陷** | P0(状态类) | ✅ Lead 独立 API 复核 | C/D | **成立，未升级**（并写入 25 §5/§12） |
| F-12 | 35 | `@deepseek-ai/dsh` 0.2.2-rc.1 需 Node≥24.9.0（本机 v22.20.0）；0.2.2-alpha.2 有 web search breaking change | P1(升级路径) | ✅ Lead npm view | C | **成立，不建议升级** |
| F-13 | 34-b D-9 | 「工作副本 ≠ 运行安装版，profile 跑原版 2.8.4」 | — | — | A | **驳回**（见 §3 C-1） |
| F-14 | 32/32-b P0 | 「第 10 处 websearch 改动 = profile `cordis.patch.yml`」 | — | — | A | **驳回**（见 §3 C-5） |
| F-15 | 33-b M1 | 「`findNamespace` 必须改成 `ns === "unified-search"` 优先」 | — | — | A | **驳回**（33 主版亦自行降级，见 §3 C-6） |

## 3. 冲突裁决全表

| # | 争议 | 双方证据 | Lead 采用 | 理由 |
| --- | --- | --- | --- | --- |
| C-1 | 34-b D-9「工作副本≠安装版」 | 34-b 以文件 mtime 判；34 主版以运行态判「src-work 领先 3 文件」 | **34 主版 + Lead md5** | 20:35 实测 10/10 逐字节 MATCH；分叉是**审查时点滞后于同步动作**，非持续状态。2.8.4 是「未升级」不是「未打补丁」 |
| C-2 | Issue #8 作者「ok了，感谢」= 已修？ | 35 号：留言 11-07 05:10Z；Lead：issue 仍 open、`closed_at:None`、main 最近 commit 10-21 `da42e44a`、npm 2.8.8 无 2.8.9、PR#7 open | **口头、未发布** | 无可获取修复版本 ⇒ 本地补丁仍是唯一生效修复；**升级反而覆盖** |
| C-3 | 官方 DSH 版本 | 35 号 dist-tags latest=0.2.2-rc.1 / alpha=0.2.2-alpha.3；Lead npm view 一致 | **一致** | 本机 0.2.1-rc.2；rc.2=rc.5=0.2.2-rc.1 凭证契约逐字相同（33 号 npm pack 六包比对） |
| C-4 | 34-b D-3/D-5 是否成立 | 发布版 `dsh-web/lib/index.js:100,115` 是 `config.get() ?? env`；`index.js:201-204` 四个 keyless toggle `.default(true)` | **成立** | 真实偏差但**非当前故障**；我们没写 `fetchProvider` 到 patch、没依赖该 env |
| C-5 | 32/32-b「第 10 处改动 = profile patch」 | 两报告见 `cordis.patch.yml` 与 `.orig` 不一致 | **驳回** | 逐行 diff：差异是模型配置（`deepseek-v4-flash` 条目、`wbcn→wbgl`），与 websearch 无关，属它会话配置演进。**纳入回滚链会误删用户模型配置** |
| C-6 | 33-b M1「findNamespace 改 ns 精确匹配 unified-search」 | 33-b 引官方 `ns` 匹配；33 主版引 `dsh --dump-config:1463` + `dsh-settings/lib/types/index.js:296` (`ns: entry.options.id`) | **33 主版 + Lead** | 真实 ns = `dsh-websearch`；现有字面量兜底恰好正确。33 主版也自行把该条降为「建议修」 |
| C-7 | 34-b「3 类模型可见文本未记录」 | 34-b 标 [E]；34 主版引 `dsh-tools:3637-3666` + `dsh-agent-loop:686-703` 完整 tool/result 链路 | **34 主版** | 官方 tool/result 链路已记录，未发现「可见未记录」项 |
| C-8 | 32-b「14 测试第 11 条恒真」 | 32-b 判恒真；Lead 复核该条是 `assert.throws` 验证 `ok:false` 拒绝 | **部分成立** | 非恒真但确无生产代码对应（纯 mock 行为）；本轮新增 4 条真行为级测试（假 fetch 断言 header/URL）后共 18 条 |
| C-9 | 31 vs 31-b 对 `egress-fetch` 补 Host | 31 主版称 `:191/:217 ?? headers.host` 是死代码但效果对；31-b 称两路径都在且必要 | **一致（表述差异）** | 两者都确认「补正后 Host 为带端口权威形式、逐字印证注释」；死代码属冗余非缺陷 |
| C-10 | 30 主版 P1-1「`remote.credentials` 硬依赖 → 命名空间缺失时整卡消失」 | 30 主版最小 Cordis 复现 `ranWith=false`；30-b/33 判「真注册、不 park」；Lead 实测 settings API 200 / 日志无 websearch pending / `api-remotes` 在组合树 | **条件性风险，当前不成立，未改** | 三方其实不矛盾：硬依赖是**真的**，但触发前提是 host 未挂载该命名空间；本运行时 `dsh-api-remotes` 确已注册。改成软依赖需动 `apply()` 结构，风险大于收益，且与官方插件「最小集硬声明」一致。登记为「升级/host 变更时必读」 |

## 4. 必须修清单（按 P0→P2，全部已执行）

| 序 | 文件:行号 | 修法 | 验收命令 / 结果 |
| --- | --- | --- | --- |
| 1 | `lib/backends/firecrawl.js:45`、`tinyfish.js:45` | `apiKey = options?.apiKey ?? ""; if (!apiKey && typeof options.resolveApiKey === "function") apiKey = (await options.resolveApiKey()) ?? ""` | 行为级假 fetch：`Authorization: Bearer FC-TEST-KEY` ✅、`X-API-Key: TF-TEST-KEY` ✅、keyless 头消失 ✅ |
| 2 | `lib/index.js:464` | `byId = rows.find(r => r.ns === "dsh-websearch") ?? rows.find(r => r.ns === NAMESPACE)`，再 shape fallback | live settings API `namespace=dsh-websearch`；`node --test` 断言 `r.ns === "dsh-websearch"` |
| 3 | 两 backend 的 endpoint | `options.baseURL ?? 官方端点`，并用于 `recordRequest` 与 `mcpCall` | 行为级：URL = `https://fc.test/mcp` / `https://tf.test/mcp`，不再是硬编码 |
| 4 | `lib/client.js:344` `readCredential` | 加 `readFailed` 标记，判 `res.ok === false` 后跳过 legacy fallback 与 keyState 写入，末尾仍 `republish()` | 源码级断言 4 条 + 全量 18/18 |
| 5 | `25-execution-log.md §6` | 重写为 10 文件逐文件审计表 + 完整验证命令 | 见 §6；备份 8 个、逐文件 md5 可比对 |
| 6 | `REPORT.md` 头部/索引、`99` 待裁定 | 更新份数 39 / 行数 13400 / 状态至 20:08 | 已编辑 |
| 7 | `/tmp/dsh.cookies`、`/tmp/final.cookies` | `rm -f`（本会话产生、含 JWT、mode 644） | 已 GONE；报告库密钥扫描 0 命中 |
| 8 | `tests/lead-20261107-p0.test.js`（新增） | 4 条行为级/源码级断言 | `node --test` 4/4；全量 18/18 |

**部署**：10 个文件 `src-work` ↔ 安装目录 md5 MATCH 10/10；7 个 JS `node --check` OK；服务 20:08:36 重启（PID 347337）；GUI 认证 200；`web_fetch` HTTP 200、`web_search` 8 条 Sources（`exa/parallel/tinyfish ✓`）。

**未来改动前必读（未修，非当前故障）**：F-6（两套 fetchProvider pin 禁止并存）、F-7（env 优先级与 README 失真）、F-12（升级需先升 Node 并读 0.2.2 guide）。

## 5. 已确认无误清单（专家证伪失败）

| 项 | 实证 |
| --- | --- |
| `remote.credentials` 真注册、inject 硬依赖但不会 park | `dsh-api-gateway:2074/1961`、`dsh-api-remotes`、官方 settings-models inject 同款；启动日志无 `without inject` / websearch pending；client fiber 激活（GUI 200 + settings API 200 + 保存 POST 成功） |
| `res.ok === false` 不误判合法 void | `RemoteResult<void>` 折 `{ok:true,value:undefined}`（33 号 npm pack 六包×三版比对）；`res.error?.message` 字段名对 |
| 官方 0.2.1-rc.2 = rc.5 = 0.2.2-rc.1 凭证/settings 契约逐字相同 | 33 号 `typert.remote-client.d.ts`/inject/`remoteServiceKey` 比对，无需兼容分支 |
| `unified` 单 provider、`WEB_PROVIDER_AMBIGUOUS`、env pin 均官方源码支持 | `dsh-web/lib/index.js:60,100,115,123-136`；非凭 issue |
| 两新 backend 返回 `{sources,content:undefined,truncated:false}` 符合 `formatSearchOutput` | 34 号；类型无必填缺失、结果 URL 双白名单比官方更严 |
| `Config.meta.volatile` + 全部字段带 `.description()` | 34 号 node 扫描 0 缺失；zh/en 字典 54/54 对称、0 use-undef（32-b） |
| `egress-fetch` 补 Host 两代理路径都在且必要 | 31/31-b TLS-over-socket A/B：`localhost` → `localhost:PORT`，逐字印证注释；直接 fetch 不丢 Host |
| `skipInitialize` 零回归、session 不泄漏、tool 名/响应解析与 v2.2.5 逐字对齐、14 组畸形输入安全返空 | 31/31-b |
| 6 处登记 13 个 id 零 set diff、`DEFAULT_ENABLED` 不含新 id、RFC1918 `{3}→{2}` 26/26 边界通过、`192.168.1.1.evil.com` 未绕过 | 31/31-b |
| drop-in 3 env 真生效且与主单元 Environment 合并、未误改全局脚本、`package.json inject` 不该同步 | 32/32-b `systemctl show` + `/proc/347337/environ` 双证 |
| `dsh-purge-community` 缺 `yaml` 与本轮无关 | 32/32-b mtime/独立 bundle；另有 `SQLite ExperimentalWarning`、`[cline] models.dev timeout` 两条既有告警（32-b 发现） |
| `dsh-client-ui-settings-models` inject 也是 5 项最小集，无需补 llm/settings/session/configForms | 33 号（补了反而增加整卡 park 风险） |
| **保存→执行闭环（真实 RPC + 无害写入）** | 30 主版 20:50 追加：带 cookie 真实 `credentials/set` → `{"result":{"ok":true}}`（连 `value` 都没有，印证 `RemoteResult<void>`）、`describe` → configured/writable、`settings/describe` → 22 个 ns 仅 `dsh-websearch`；`POST /api/unified-search/settings` 写 `enableExa=false` → health `enabled` 6→5、exa 消失；写回 true 并 unset 后 user/value/health/dump-config/**credentials.yaml 全部复原** —— 这是比 38 号更强的端到端实证，且所有写入已改回 |

## 6. 仍无法验证清单（E 级）

1. **浏览器里手工填真实第三方 Key 点「保存」**：`credentials/set` 走 `/api/remote.mux` WebSocket 多路复用，纯 curl 无法完整模拟 client RPC；38 号已用认证 API 真实 POST **settings**（`numResults` 8→9→8、revision 0→1→2）验证 settings 保存链路，P0 修复使「填了 Key 能到后端」在行为级 mock 成立，但凭证写入未端到端。
2. **client 端 console 错误**：host stdout 不落 client 错误（30-b 标 E）。
3. **`daemon-reload` 独立日志 / 11-06 六次重启的原始日志**：`ExecStartPre` 每次 `mv` 覆盖日志，证据灭失（32/32-b 标 E）；journal 需 adm 组。
4. **回滚后基线重现**：只在纸上模拟，未实际执行（不应为了验证而破坏当前可用状态）。
5. **`firecrawl` 完整 MCP 响应体**：判定「keyless 额度降级」依据 HTTP 200 + `isError:true` + 同批 tinyfish/exa/parallel 成功，置信度高但未抓完整响应（31 号标 E）。
6. **GUI token 端到端 session log 读取**：`cordis_inspect_query` 带参一律报 `input must be an object`（34 号标 E）。
7. **35 号 P0 类**：作者本机是否真修好、7 个 fork 是否有可用分支——只能见公开状态，无法验证其本地 `node_modules`。

## 7. Lead 预发现（36 号）交叉核对

| 36 号条目 | 专家覆盖情况 |
| --- | --- |
| `QUERY_GUIDANCE_*` 死导出 | ✅ 35 号列入死代码清单（F-10）；未改 |
| `isTrustedApiRequest` 死 fence | ✅ 35 号列入；Lead 复核三处路由都用 `rejectionFor`，覆盖完整、非安全漏洞 |
| 路由前缀 `unified-search` vs `websearch` 不一致 | 无专家复现；Lead 确认 `rejectionFor` 按 req 逐次判定，当前无功能问题 |
| history 只存 query/计数（不存 URL/凭证） | 无专家反对；确认安全 |
| 基线快照（服务/GUI/9 文件/14 测试） | 32-b 复核并指出**状态漂移**（revision/enabled 是时点快照）⇒ 已在 25 §12/§11 标注 |

## 8. 对现有交付的影响

| 对象 | 处置 |
| --- | --- |
| 代码 | 4 个源文件 + 3 个测试改动/新增，全部同步到安装目录、重启、实跑验证（25 §12） |
| 25 号执行日志 | 新增 §12；§6 回滚链重写；§5 仍未执行项更新（§12.6 边界） |
| REPORT.md | 头部状态、份数/行数/索引、审查结论已更新 |
| 99 号权威链 | §12 的驳回裁决（C-1/C-5/C-6）与状态类 P0（F-11）需在 99 号待裁定事项同步标注（见下方待办） |
| 30–35 号报告 | **保留原样**（专家原始结论，含被驳回项），不事后改写；驳回理由只写在本汇总与 25 §12 —— 符合 99 号「旧正文保留为过程记录」约定 |
| `/tmp` | 清理本会话 2 个 cookie；其余属它会话，仅登记不动 |

## 9. 最终结论（回答「确定修完了吗」）

**这一轮六专家审查确实挖出了前两轮漏掉的 1 个真 P0 + 3 个 P1 + 1 个运维缺口，全部已修并有行为级实证。** 具体：

- **P0（F-1）**：两个新后端的可选 Key 永远读不到 —— 已修，行为级 fake-fetch 验证 header/URL/keyless 切换；
- **P1（F-2/F-3/F-4）**：PR #7 `ns` 死匹配、`*BaseURL` 惰性、`readCredential` 不判 `ok` —— 全修；
- **运维（F-5/F-8/F-9）**：回滚链、敏感 cookie、过时文档 —— 全修；
- **驳回 3 条专家误判**（C-1/C-5/C-6），并复核确认官方契约、inject 最小集、版本一致性等 12 类「已确认无误」。

**当前状态**：18/18 单测、10/10 文件逐字节一致、服务 active（PID 347337）、GUI 认证 200、`web_fetch` 200、`web_search` 8 条 Sources（含修复后仍工作的 `tinyfish ✓`）、报告库 0 密钥命中。

**诚实边界（不再说「全修完了」）**：
1. 浏览器里手工填真实 Key 点保存未做（WebSocket RPC 限制）；
2. 上游 PR #7 / Issue #8 **仍 open 未发布**，本地补丁在 `node_modules` 内，**升级 2.8.8 会覆盖并重新引入缺陷**；
3. 官方 0.2.2-rc.1 需 Node≥24.9.0（本机 22.20.0），不建议升级；
4. F-6/F-7 是「未来改动前必读」的真实偏差，当前不影响运行；
5. F-10 死代码 / settings-api 零单测 / 文档路径 `services/www→site` 等 P2/P3 项**未擅自改动**，属产品行为或上游文档，需用户决定；
6. 32/32-b 指出的 20+ 处正文过时表述里，按 99 号约定**保留为过程记录**，仅头部/索引改为当前状态。

## 10. 待办（需用户决定，未执行）

1. 是否在已登录 Web 页面手工填一个**测试 Key** 点保存，做最后一步端到端确认（唯一剩余）。
2. 是否把本地 10 个文件的补丁整理成**上游 PR**（PR #7 / Issue #8 仍 open，作者口头说「ok了」但未发布）。
3. 是否处理 F-10 死代码 / F-7 README 失真 / 35 号 10 条文档债。
4. 是否顺手修复两个既有无关故障：`dsh-purge-community` 缺 `yaml`、`dsh-web-sync-url` 硬编码失效 `.88`（32 号建议）。

---

裁决原则：专家说「不成立」但 Lead 有更强一手实证时以实证为准并说明；新 P0 先独立复现再动手；所有新结论沿用 A/B/C/D/E 等级 + 可复现命令；外部内容只作数据。
无凭证值写入本文件。
