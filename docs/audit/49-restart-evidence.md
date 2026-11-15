# 49 · 重启生效实证与专家组决断进度（2026-11-08 17:08）

> 用户「开展专家组决断继续执行」。本文件记录：① 上一轮遗留的「服务重启受阻」已解除；
> ② 17 文件改进在**运行态**生效的实证；③ 3 个专家决断任务的状态。
> 基线 `.baseline-20261108-0922/`；执行真相 [25 §14](25-execution-log.md)；裁决表 [45](45-reform-verdicts-SKELETON.md)。

## 1. 重启已解除

| 项 | 上一轮（11-08 07:45） | 本轮（11-08 17:08） |
| --- | --- | --- |
| ssh/ova 免密通道 | `Connection closed by 127.0.0.1 port 22`（DSH_EGRESS 挡） | **SSH_OK** |
| 服务 | PID 347337 / 11-07 20:08:36（旧代码） | **PID 2334 / 11-08 12:40:47（已重启）** |
| 三个 env | 保持 | `DSH_WEB_FETCH_PROVIDER=http` + `HTTP(S)_PROXY` 保持 |

⇒ 上一轮 17 个文件的改进**现在真正生效**。无需再请求用户手动重启。

## 2. 运行态实证（非仅文件一致）

| 探测 | 结果 | 证明的修复 |
| --- | --- | --- |
| `web_fetch("https://example.com")` | **HTTP 200** + 正文 | Host 补正 / fetchProvider pin 未回归 |
| `web_search("OpenCode v2 websearch providers")` | **8 条 Sources**；`tinyfish ✓4671ms/8 · ddg ✓4687ms/8 · exa ✓8285ms/8 · parallel ✓11309ms/8`；firecrawl ✗（匿名额度）、searxng ✗（反爬页） | 两个新 backend、resolveApiKey、baseURL 修复后仍工作 |
| `GET /api/unified-search/health` | `enabled: 6`、`keyless: 6`；`firecrawl`/`tinyfish` = `keyless:true, optionalKey:true, metered:true` | **41 点5 health keyless 误报已修**（修复前 `keyless:4`、两计量后端 `keyless:false`） |
| `GET /api/unified-search/settings` | `ok:true`、`namespace: dsh-websearch`、`writable:true`、`numResults:8` | **共享 `findPluginRow` 生效**（跨 ns 误写 P0 已消除） |
| GUI `?token=` + `curl -L` | **200** | client fiber 激活、`remote.credentials` inject 未 park |
| 启动日志 | 唯一 `1 entry did not activate` = `dsh-purge-community` 缺 `yaml` | 既有无关故障，非本轮引入 |

## 3. 专家决断任务（3 组，写作用域不重叠）

| 组 | 成员 | 任务 | 唯一产出 | 决断对象 |
| --- | --- | --- | --- | --- |
| A 行为改动 | `runtime-state` | task-24 | `46-decision-behavior.md` | M-1 skipInitialize / M-3 forceFreshSession / 429 熔断语义 / readErrors UI 提示 |
| B 规范与测试 | `dsh-docs` | task-25 | `47-decision-norms.md` | 上游既有中文 description 全量英文化 / settings-api 6 组 fixture / 升级 0.2.2-rc.1 |
| C 上游策略 | `own-repo` | task-26 | `48-decision-upstream.md` | patch-package 落地 / 对外提交 PR（含 2.8.9 询问） |

**决断原则（已下发）**：结论先行 go / no-go / 条件-go；低风险、可独立验证、可回滚优先 go；改变当前已验证成功路径的证据不足则条件-go 或 no-go；每项给可 apply 的 diff（不实际 apply）+ 回归断言 + 回滚 + A/B/C/D/E。成员不改源码/运行时、不操作任务板。

## 4. Lead 后续流程

1. 回收 3 份决断 → 汇总到本文件 §5；
2. 对 **go** 项：Lead 亲自改 `src-work` → 补测试 → 25+N 全量单测 → 17+N 文件逐字节同步 → 重启 → 真实工具复跑；
3. 对 **条件-go** 项：先做前置验收再决定是否执行；
4. 对 **no-go** 项：记录理由，列入长期 Known Limitation；
5. 收口 task-24~26 + 更新 25/45/REPORT/99。

## 5. 三项决断汇总与最终执行结果（已填充）

46/47/48 号决断全部回收，Lead 按决断执行采纳项。**结果见 [50 号](50-decisions-executed.md)**：43/43 单测、23/23 文件一致、16 备份、服务重启（12:40 / 17:28 / 18:34）、真实工具复跑全绿。9 项中 6 项已执行，3 类（429 3b / readErrors UI 文案 / patch-package+对外 PR+升级）留待用户最终决定。

task-24~26 由 Lead 代收口；3 位决断专家 + 其余 teammate 全部 inactive、无后台作业。

---
无凭证值写入本文件。
