# 21-LEAD-backup · 工程级实施规划骨架（Lead 保底稿）

> 若 `21-engineering-plan.md`（专项规划代理）成功落盘，以它为准；本文件仅作保底与交叉校验，不与其冲突。
> 权威口径：[99-final-verdicts.md](99-final-verdicts.md) + [24-p0-landing-correction.md](24-p0-landing-correction.md)；决策输入：[23-decision-inputs.md](23-decision-inputs.md)。
> 全部为**计划与草案**，未执行任何改状态动作。

## 1. 目标与范围

- **目标**：让当前 GUI 的 `web_search` 至少 1 个后端返回源、`web_fetch` 返回 200 内容、设置面板可保存 key 且生效、无回归。
- **In scope**：P0 四条（[99 裁决 2](99-final-verdicts.md)）、零依赖最小修复、对应回归测试与验收。
- **Out of scope**：改官方 `packages/web/` 源码、改 DSH agent-loop、网关代理池修复、shallow clone 补历史、批量替换浮动链接。
- **成功判据（可量化）**：① `web_fetch({url:"https://example.com"})` 返回 200 内容而非 `WEB_PROVIDER_AMBIGUOUS`；② `web_search({queries:[...]})` 结果含 `Sources:` 且不再 `all enabled backends failed (4)`；③ `/api/unified-search/health` 的 `backends[]` 至少 1 个 `reachable:true`；④ fixture 单测全绿；⑤ 设置面板保存 key 后角标亮起。

## 2. 决策树（默认推荐路径）

```
START
 ├─ 作者是否已合并 PR #7 且修好 Issue #8？
 │    ├─ 是 → 走「标准升级路径」(P0② 全量)
 │    └─ 否（当前状态：PR open/mergeable=True 但 2 天无更新，#8 open 且作者仅口头承诺）
 │         ├─ 设时间窗 T（建议 48h，从 2026-11-05 13:23 作者留言起算）
 │         │    ├─ T 内有合并 → 标准升级路径
 │         │    └─ T 超时 → 自行 fork（只改 profile patch / 新增 backend，不改 node_modules 内 bundle patch）
 │         └─ 或立即走「零依赖最小修复」——**默认推荐**
 └─ 零依赖最小修复（不动版本、不动 sidecar）：
      ① 设 DSH_WEB_FETCH_PROVIDER=http（修 web_fetch，需重启、需批准）
      ② 在 egress-fetch.js 的 httpsViaConnect 补 headers.host ?? target.host
         （修 403 缺 Host，A/B 已证；属给插件提 PR，需用户决定）
      这两条互不依赖，可并行；都不需要等 PR #7/#8。
```

**默认推荐理由**：PR #7/#8 是「设置 inert / 存不了 key」类问题，只影响 key-gated 后端；而当前 4 个 keyless 后端全挂的根因（缺 Host）与 `web_fetch` 歧义，都能用零依赖修复独立解决，不必被作者进度阻塞。依据 [23](23-decision-inputs.md) §1（C）、[24](24-p0-landing-correction.md) §2（A）、[99 裁决 1/3](99-final-verdicts.md)（A/D）。

## 3. WBS（工作分解，精确到文件/函数）

| ID | 任务 | 依赖 | 精确落点 | 改动类型 | 需重启/重装 | 需批准 |
| --- | --- | --- | --- | --- | --- | --- |
| W1 | 复现基线（只读） | — | `node` 最小 A/B（CONNECT + Host 变量）；`dsh web --dump-config` | 无 | 否 | 否 |
| W2 | P0① 解 A：env pin fetch | W1 | `dsh web` 进程 env `DSH_WEB_FETCH_PROVIDER=http`（发布版 `dsh-web/lib/index.js:60,115` 支持） | 环境 | **重启** | **是** |
| W3 | P0① 解 B：profile patch 新增 `- id: web` | W1 | `/home/dsh/.dsh/profiles/web/cordis.patch.yml` 新增条目并 restate `searchProvider: unified` + `fetchProvider: http`（**不是**改插件 `node_modules/.../cordis.patch.yml`） | 配置 | 重启 | 是 |
| W4 | 零依赖修复 403：`httpsViaConnect` 补 Host | W1 | 插件 `lib/util/egress-fetch.js` 的 `https.request` headers（`httpViaProxy:202` 已有 `host: headers.host ?? target.host` 可参照）；本机 2.8.4 的 `normalizeHeaders():276` 删 Host | 插件源码 | 重启 | 是 |
| W5 | P0② 升级 2.8.4→2.8.8 | W1 + PR#7/#8 状态复查 | `profile/package.json` 的 `dependencies."@240xu/dsh-websearch"`；`pnpm install` | 依赖 | **重装+重启** | 是 |
| W6 | sidecar spec 验收 | W5 | `POST $DSH_EGRESS_FORWARDER` 带 `proxy` 字段的完整 spec → 200（空 spec 400 不算通过） | 无 | 否 | 否 |
| W7 | P0③ firecrawl backend | W1 | 新增 `lib/backends/firecrawl.js`；`lib/index.js` 6 处（Config 三字段含 `.description()`、toggleMap、DEFAULT_KEY_ENV、DEFAULT_BASE_URLS、DEFAULT_LABELS、BACKENDS+import、DEFAULT_ENABLED 默认关）；**`lib/client.js:14-25` BACKENDS 副本** | 插件源码 | 重启 | 是 |
| W8 | P0④ tinyfish backend | W1 | 同 W7 + `mcpCall` 的 `skipInitialize`/`mcpCallDirect`（keyless 不需 initialize，v2.2.5 `tinyfish.ts:78`） | 插件源码 | 重启 | 是 |
| W9 | fixture 单测 | W4/W7/W8 | 新增 `tests/*.test.js`，无 live network | 测试 | 否 | 否 |
| W10 | 文档/索引同步 | W2-W9 | `99`/`REPORT`/`24` 的状态从「待执行」改为「已执行 + 结果」 | 文档 | 否 | 否 |

**依赖图**：W1 → {W2 ∥ W3 ∥ W4}；W5 依赖 PR#7/#8 复查；W6 依赖 W5；W7/W8 可并行但需 W1 的结构核对；W9 依赖 W4/W7/W8；W10 最后。

## 4. 里程碑与 DoD

| 里程碑 | 内容 | DoD |
| --- | --- | --- |
| **M1 · 恢复可用** | W1 + W2（或 W3）+ W4 | `web_fetch` 200、`web_search` 至少 1 后端返回源、A/B 脚本 `WITH Host: 200` |
| **M2 · 版本与后端** | W5 + W6 + W7 + W8 | 2.8.8 生效、sidecar spec 200、firecrawl/tinyfish 在设置面板可见且可搜、11→13 后端 |
| **M3 · 可回归** | W9 + W10 | fixture 单测全绿、健康检查、`--dump-config` 含 fetchProvider、文档状态更新 |

## 5. 验收命令表（只读类可立即跑；改状态类需批准）

| 命令 | 只读? | 预期 |
| --- | --- | --- |
| `node` 最小 A/B（见 [22-execution-drafts.md](22-execution-drafts.md) 草案 A） | ✅ | `WITHOUT Host: 403` / `WITH Host: 200` |
| `dsh web --dump-config \| grep -A4 'id: web'` | ✅ | W2/W3 后出现 `fetchProvider: http`（base 的 `deepseek-official` 被覆盖但仍 pin unified） |
| `tr '\0' '\n' < /proc/<pid>/environ \| grep DSH_WEB_FETCH_PROVIDER` | ✅ | W2 后命中 `=http` |
| `web_fetch({url:"https://example.com"})` | ✅ | 200 内容（基线为 `WEB_PROVIDER_AMBIGUOUS`） |
| `web_search({queries:["OpenCode v2"]})` | ✅ | 含 `Sources:`、非 `all enabled backends failed (4)` |
| `curl` health API（带 auth cookie） | ✅ | `backends[]` 至少 1 个 `reachable:true` |
| `POST $DSH_EGRESS_FORWARDER` 带完整 spec（含 `proxy`） | ✅ | 200（空 spec 400 不算） |
| `node --test tests/*.test.js` | ✅ | 全绿、无 live network |
| 改 patch / 改 `lib/` / `pnpm install` / 重启 `dsh web` / 设 env | ❌ | **需用户批准** |

## 6. 回滚

| 动作 | 回滚 | 验证回到基线 |
| --- | --- | --- |
| W2 env pin | 取消 `DSH_WEB_FETCH_PROVIDER` + 重启 | `web_fetch` 重现 AMBIGUOUS |
| W3 patch 新增 | 删该 `- id: web` 条目 + 重启 | `--dump-config` 回到只有 `searchProvider: unified` |
| W4 补 Host | 还原 `httpsViaConnect` headers + 重启 | A/B 脚本 `WITHOUT Host: 403` 重现 |
| W5 升级 | `package.json` 改回 2.8.4 + `pnpm install` + 重启 | `node -p require('…/package.json').version` = 2.8.4 |
| W7/W8 新 backend | 删 `lib/backends/firecrawl.js`/`tinyfish.js` + 撤销 index/client 6 处 + 重启 | 设置面板后端数回到 11 |

## 7. 风险登记（≥10 条）

| # | 风险 | 触发 | 影响 | 概率 | 缓解 | 责任 |
| --- | --- | --- | --- | --- | --- | --- |
| R1 | PR #7 未合并 | 作者 2 天无动作 | 2.8.8 设置 inert，`enabledBackends` 不生效 | 高 | 走零依赖路径；或超时自行 fork | 用户/规划 |
| R2 | Issue #8 未修 | 同上 | 所有 key-gated 后端存不了 key | 高 | 同上；keyless 后端不受影响 | 用户/规划 |
| R3 | 2.8.8 仍删 Host | 只升版本不配 forwarder | 403 不变 | 高 | W4 或 W6（sidecar 带 proxy spec） | 执行 |
| R4 | `lib/client.js:14-25` BACKENDS 独立副本漏改 | 新增 backend | 设置面板看不到新后端 | 中 | W7/W8 的 6 处清单逐项核对 | 执行 |
| R5 | MCP `ensureSession` 与 keyless 冲突 | 接 tinyfish | 多发一次 initialize 握手、可能被拒 | 中 | `skipInitialize`/`mcpCallDirect` | 执行 |
| R6 | Firecrawl/TinyFish keyless 限额与计费 | 高频调用 | 429 / 额度耗尽 | 中 | 默认关 + 冷却 + 遥测 | 规划 |
| R7 | 改插件 `node_modules` 被升级覆盖 | 误改 bundle patch | 改动丢失 | 中 | **只改 profile patch / 新增 backend 文件**，不改 node_modules 内 patch（[24](24-p0-landing-correction.md)） | 执行 |
| R8 | `Model-visible ⟺ logged` | 新增后端结果格式 | session log 不可重建 | 中 | 复用既有 `hooks.recordRequest/Outcome` 与统一结果结构 | 执行 |
| R9 | snapshot / REAL-composition 未更新 | 行为变更 | CI 快照失败 | 中 | 补 fixture + keyless recorded-session；boot test-only cordis.yml | 执行 |
| R10 | GUI 401 + 无 `dev:web` watcher | 改 Web 工件 | 改动不生效 | 高 | 重建工件 + 刷新页面；用 `--dump-config` 离线验证 | 执行 |
| R11 | 官方 `dsh-tool-web` 跨包权限不可改 | 想移植 v2 permission | 产品级改动无落点 | 低 | 降级为文档建议（[09c P1-3](09c-opencode-integration.md)） | 规划 |
| R12 | shallow clone 无法本地 blame | 查规则引入 commit | 需 GitHub API | 低 | 已由 [11](11-traceability-audit.md) 补齐 | 评估 |

## 8. 测试策略（遵循 DSH 仓库约定）

- **unit**：`tests/*.test.js` fixture，无 live network（对应 `docs/testing.md` 的 keyless 要求）。
- **e2e**：需 key 的后端 self-skip（无 `*_API_KEY` 时跳过）。
- **snapshot**：keyless recorded-session，`snapshots/AGENTS.md` 的 normalization fixed points；新后端若改变模型可见文本须更新快照。
- **REAL-composition**：`packages/AGENTS.md` 要求产品可见插件用 boot test-only `cordis.yml` 的非单测验证；本计划的新 backend 属插件层，建议补一条组合级测试。
- 硬约束：`Model-visible ⟺ logged`（AGENTS.md:134）、`No hardcoded tunables`（配置化而非写死常量）、`Write model-facing contracts from the model's perspective`（packages/AGENTS.md:13）。

## 9. DoD 与交接

- **DoD**：M1/M2/M3 全部达标；W10 更新 99/REPORT/24 的状态；无未标 E 的结论；无凭证值入报告。
- **需要用户决策的点**：① 是否允许重启 `dsh web` / 设 env（W2）；② 是否自行修 PR #7/#8 还是等作者（时间窗 T）；③ 是否给插件提「补 Host」PR（W4）；④ 是否升级到 2.8.8（W5）；⑤ 是否新增 firecrawl/tinyfish（W7/W8）。
- **给执行代理的输入**：W1 的 A/B 脚本、W2/W3 的修改前后 YAML、W4 的 unified diff、W7/W8 的 backend 骨架与 6 处清单、第 5 节验收表。见 [22-execution-drafts.md](22-execution-drafts.md)。

## 10. 证据等级索引

| 依据 | 等级 | 出处 |
| --- | --- | --- |
| 403 = 缺 Host 头 | A/D | [99 裁决 1](99-final-verdicts.md)、[08 附录 A.2](08-own-repo.md)、Lead A/B |
| P0① env pin 落点 | A | [24](24-p0-landing-correction.md)（`dsh-web/lib/index.js:60,115`、插件 bundle patch、base bundle:467-471） |
| PR #7/#8 状态、sidecar 400/200 | C/D | [23](23-decision-inputs.md) |
| 6 处 backend 改动、`client.js` 副本 | A | [09 附录 C-4](09-opencode-endpoints.md)、[09c §4](09c-opencode-integration.md) |
| Firecrawl keyless 官方 | B | [05 续研 A.2](05-search-backends.md) |
| 版本链 / 2.8.8 ≡ 2.8.6 lib | C/A | [12](12-change-lineage.md) |
| DSH 测试与模型可见约定 | A/B | `AGENTS.md`、`packages/AGENTS.md`、`docs/testing.md`、`snapshots/AGENTS.md` |

---

本文件为计划保底稿，无凭证值、无浮动 ref 作为依据；全程只读，未改源码/配置、未重启服务、未执行升级。
