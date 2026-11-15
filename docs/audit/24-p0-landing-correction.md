# Lead 裁决 9 · P0① 落点修正（2026-11-06 13:00，C 级，一手核验）

> 由「工程级实施规划」代理提出，Lead 用本机文件逐字复核，**全部成立**。本文件补充 [99-final-verdicts.md](99-final-verdicts.md) 裁决 2 的 P0①；凡与该裁决冲突的旧表述（含 99 / REPORT / 09c / 09 / 00 / 02 中「改 `~/.dsh/profiles/web/cordis.patch.yml` 补 fetchProvider」）一律以本文件为准。

## 1. 精确落点（A/C 级）

| 层 | 文件 | `id: web` config | 证据 |
| --- | --- | --- | --- |
| base bundle（发布版） | `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-base/cordis.patch.yml:467-471` | `searchProvider: deepseek-official` + **`fetchProvider: http`** | A |
| **插件 bundle patch（真正 override）** | `/home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/cordis.patch.yml` | **只有** `searchProvider: unified`（整体替换 config，抹掉 fetchProvider） | A |
| profile patch | `/home/dsh/.dsh/profiles/web/cordis.patch.yml` | **无 `id: web` 条目**（只有 tool-web 等） | A（`grep` 0 命中） |

⇒ **`web_fetch` 的 `WEB_PROVIDER_AMBIGUOUS` 根因**：插件 bundle patch 的 `- id: web` 整体替换 config，丢掉 base 的 `fetchProvider: http`；运行时 fetch 侧注册了 `http` + `deepseek-fetch-api` 两个可用 provider，无 configuredId 即抛歧义。**不是 profile patch 漏写**。

## 2. P0① 的两个等价解（新增「零文件编辑」解，优先级更高）

### 解 A（**默认推荐 · 零文件编辑**）【A】
发布版 `dsh-web/lib/index.js:45,55,60,115` 逐字：
```
* `$DSH_WEB_SEARCH_PROVIDER` / `$DSH_WEB_FETCH_PROVIDER` are equivalent to ...
this.fetchProviderEnv = process.env.DSH_WEB_FETCH_PROVIDER;
const configuredId = this.config.fetchProvider.get() ?? this.fetchProviderEnv;
```
⇒ 只需给 `dsh web` 进程设 **`DSH_WEB_FETCH_PROVIDER=http`**（或 `DSH_WEB_SEARCH_PROVIDER` 同理），即可 pin fetch provider，**无需改任何 yml**。验收：`dsh web --dump-config` 的 `id: web` 应出现 `fetchProvider: http`（或实跑 `web_fetch({url:"https://example.com"})` 返回 200 内容）。
- 注意：设进程 env 需重启 `dsh web`（**改状态，需用户批准**）；但**不动任何文件**，回滚成本最低（取消 env 再重启）。

### 解 B（yml 路线，需用户批准且落点要正确）【A】
- **正确落点**：在 `/home/dsh/.dsh/profiles/web/cordis.patch.yml` **新增**一个 `- id: web` 条目并 **restate 完整 config**（`searchProvider: unified` + `fetchProvider: http`）——利用 patch 在 bundle patch 之后应用的顺序覆盖。
- **不要**改插件自带 `node_modules/@240xu/dsh-websearch/cordis.patch.yml`（会被 `pnpm install` / 升级 2.8.8 覆盖）。
- 依据：DSH upgrade-guide 的「A patch replaces the matched row's whole `config`」；见 [02 附录 A](02-runtime-state.md) 与 [09c 续-6](09c-opencode-integration.md)。

## 3. 对 [99 裁决 2](99-final-verdicts.md) 的修订

| 原表述 | 修订后 |
| --- | --- |
| P0① = 「`cordis.patch.yml` 的 `- id: web` 补 `fetchProvider: http`」 | **P0① = 优先设 `DSH_WEB_FETCH_PROVIDER=http`（零文件编辑）；或 profile patch 新增 `- id: web` 并 restate 完整 config**。两解均需重启 `dsh web`（改状态，需批准）。 |
| 「`- id: web` 整体替换丢 fetchProvider」未指明是哪一层 | 明确为**插件 bundle patch 层**（base 原有 `fetchProvider: http`）。 |

P0②/③/④、以及「升级修不了 web_fetch」的结论**不变**（2.8.8 的 bundle patch 与 2.8.4 逐字相同，仍无 fetchProvider）。

## 4. 给三个专项代理的指令

- **20-content-assessment（评估）**：把 P0① 可执行性判定改为「存在零文件编辑解，依据充分度上调；但需重启服务 → 仍属需批准动作」；并在「四问覆盖度」里记一条：运行时组合树层级（base → bundle → profile patch）此前报告表述不精确，已由本裁决补齐。
- **21-engineering-plan（规划）**：WBS 的 P0① 拆成 解 A（默认）/ 解 B（备选），决策树把「零依赖最小修复」列为默认推荐路径；`23-decision-inputs.md` 的「验收命令表」补 `DSH_WEB_FETCH_PROVIDER` 的 env 检查命令（`tr '\0' '\n' < /proc/<pid>/environ | grep DSH_WEB_FETCH_PROVIDER`）。
- **22-execution-drafts（执行）**：草案 A 改为「**先给 env 方案**（含启动命令示例与回滚），再给 profile patch 的新增条目（修改前=无该条目 / 修改后=完整 `- id: web` 两条 config）」，**不要**写成修改插件 node_modules 内的 patch。

---

本文件无凭证值、无浮动 ref 作为依据；全程只读，未改任何源码/配置、未重启服务、未执行升级。
