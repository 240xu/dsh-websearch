# 决策树与验收的一手输入（Lead 实测，2026-11-06 12:45，Asia/Shanghai）

> 供 21-engineering-plan.md（规划）与 22-execution-drafts.md（执行）取用。全部为只读观测，C/D 级。
> 全库口径以 [99-final-verdicts.md](99-final-verdicts.md) 为准。

## 1. PR #7 / Issue #8 状态（C 级，认证 GitHub API）

| 项 | 值 |
| --- | --- |
| [PR #7](https://github.com/240xu/dsh-websearch/pull/7) `state` | **open** |
| `merged` | `False` |
| `mergeable` | **`True`** |
| `head sha` | `bcb24b1efbb4bcdab3fad5ae4830cfe4fb860f5f` |
| `changed_files` | 3（`lib/index.js` +18/−1、`lib/provider.js` +1/−1、新增 `tests/v28x-settings-bridge.test.js` +57） |
| `updated_at` | 2026-11-04T10:22:28Z（此后再无更新） |
| [Issue #8](https://github.com/240xu/dsh-websearch/issues/8) | **open**；作者 2026-11-05T13:23:29Z 留言「稍等稍等，马上解决!」，截至采样未修 |
| 仓库 open issues | 6 条（#3/#4/#5/#6/#7/#8） |

**对决策树的含义**：PR 已可合并但两天无新动作、作者口头承诺修 #8 但未落地 ⇒ 「等作者」分支必须给**明确时间窗 + 超时自动转「自行 fork」**的触发条件，不能无限等待。升级 2.8.8 前须复查这两个编号。

## 2. sidecar 可达性（D 级，curl 实测）

- `POST http://172.30.0.1:13070/fwd` 带空 spec `{}` → **HTTP 400**（端口活着但 spec 不合法）。
- [08 附录 A.2](08-own-repo.md) 实测：spec **带 `proxy` 字段** → 200 / 1077B / 3.36s；不带 → 502。
- ⇒ **P0② 的「sidecar 可达」判据必须写成「按 2.8.8 `forwarderFor` 的完整 spec 实跑返回 200」**，只测 TCP 端口或空 spec 400 都不算通过。

## 3. 本机插件代码状态（A/D 级）

- `/home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/lib/util/egress-fetch.js` 中 `DSH_EGRESS_FORWARDER` / `forwarderFetch` **计数 = 0**（本机 2.8.4）。
- 但进程 2085 的 environ **已设** `DSH_EGRESS_FORWARDER` 与 `DSH_EGRESS_FORWARDER_PROXY`。
- ⇒ 「环境就绪、代码未就绪」，是 P0② 必须升级（≥2.8.5）的最直接 A 级证据；也是零部署依赖备选「补 `headers.host ?? target.host`」的立论前提。

## 4. 验收命令的「只读 / 需批准」分类（供执行代理）

| 命令 | 是否改状态 | 需用户批准 | 预期 |
| --- | --- | --- | --- |
| `node` 最小 A/B 脚本（CONNECT + Host 变量） | 否 | 否 | `WITHOUT Host: 403` / `WITH Host: 200` |
| `dsh web --dump-config \| grep -A3 'id: web'` | 否（02 已验证 profile sha256 前后一致） | 否 | 出现 `fetchProvider: http` 与 `searchProvider: unified` |
| `web_fetch({url:"https://example.com"})` | 否 | 否 | 返回 200 内容（当前基线为 `WEB_PROVIDER_AMBIGUOUS`） |
| `GET /api/unified-search/health`（带 auth cookie） | 否 | 否 | `backends[]` 至少 1 个 `reachable:true` |
| `web_search({queries:[...]})` | 否 | 否 | 结果含 `Sources:` 且不再 `all enabled backends failed (4)` |
| fixture 单测（`node --test tests/*.test.js`，无 live network） | 否 | 否 | 全绿 |
| 改 `cordis.patch.yml` / 改 `lib/` / `pnpm install` / 重启 `dsh web` / 设 env | **是** | **是** | — |

## 5. 其它已复核的静态事实（避免规划重复取证）

- npm `@240xu/dsh-websearch` `dist-tags.latest` 仍 **2.8.8**；本机仍装 **2.8.4**；GUI `127.0.0.1:3080` 仍 **401**；源码 checkout `dsh-v0.2.1-alpha.2` / GUI 发布版 `0.2.1-rc.2`。
- 无 `dev:web` watcher → 任何 Web 工件改动需重建并刷新页面才生效。
- 2.8.8 的 `normalizeHeaders` **仍删 Host**，无 forwarder 时同样 403（[12](12-change-lineage.md) tarball 全量 diff 证实 2.8.8 的 `lib/` 与 2.8.6 逐字节相同）。

---

本文件无凭证值、无浮动 ref 作为依据；全程只读。
