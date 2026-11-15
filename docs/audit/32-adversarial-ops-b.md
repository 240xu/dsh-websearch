# 32 · 对抗审查备份 · 运维与回滚（子代理 ops-B，2026-11-07）

> **只写本报告一个文件**：`/home/ova/dsh/.artifacts/websearch-research/32-adversarial-ops-b.md`。
> 全程只读：read/grep/glob + 只读 bash（systemctl show / ps / md5sum / stat / grep / curl / node --test）；
> **未改源码/配置/其它报告、未重启、未执行回滚、未操作任务板**（task-15 由 Lead 处理）。
> 取证时间 2026-11-07 15:14–15:35 Asia/Shanghai，主机 `wuming`，工作目录 `/home/ova/dsh`。
>
> **与审查 C 的防冲突**：`32-adversarial-ops.md` 在本次调研开始时（15:14）与结束时（15:35）均**不存在**
> （`ls .artifacts/websearch-research/32-adversarial-ops*.md` 两次只列出本文件将创建的路径之外的 3x 文件；
> 15:20 出现过 `38-e2e-save-probe.md`）。故本文件不是「交叉复核补遗」，而是**独立全量备份版**。
> 若审查 C 稍后落盘 `32-adversarial-ops.md`，本文件不覆盖、不删减、不改写它；两者应并存供 Lead 对照。
>
> **证据等级（沿用全队规范，见 [07 §8.1](07-dsh-docs.md)）**：
> **A**＝源码/文件实证（路径:行号或固定 ref 永久链接）；**B**＝官方文档（URL+访问日期+HTTP 状态）；
> **C**＝版本记录（CHANGELOG/tag/commit sha/issue/PR）；**D**＝本机实测（命令 + exit code/输出）；
> **E**＝推断或待核实（显式标注，**不得当结论**）。**缺口**＝按指定范围 grep/glob 后确实未找到。

---

## 0. 取证基线（当前真实状态，D 级，2026-11-07 15:14–15:35）

| 项 | 实测值 | 命令 / 出处 | 等级 |
|---|---|---|---|
| 服务 | `dsh-web.service` `ActiveState=active`、`LoadState=loaded`、`NeedDaemonReload=no` | `systemctl show dsh-web.service -p …` | **D** |
| MainPID | **262230**，`ExecMainStartTimestamp=Sat 2026-11-07 13:51:12 CST` | 同上 + `ps -p 262230 -o lstart` | **D** |
| 进程 cmdline | `node /usr/local/bin/dsh web --patch /opt/dsh-plugins/lan-trust.patch.yml --no-open --host 127.0.0.1 --port 3080 --trusted-host 192.168.1.165 --trusted-host dsh.sepic.space` | `ps -p 262230 -o cmd` | **D** |
| 插件版本 | **2.8.4**（`node -p require(…/package.json).version`），`pnpm-lock.yaml:12-13` 亦 pin 2.8.4 | 只读 | **D/A** |
| GUI | `?token=` → `curl -L -c/-b` → **HTTP 200** | 认证只读探测 | **D** |
| 9 文件一致 | 9/9 与 `src-work/plugin/` md5 **MATCH**（逐文件见 §3.1） | `md5sum` 逐个比对 | **D** |
| 备份 | **8 个 `*.orig`**（`client/egress-fetch/index/mcp-client/provider/cordis.patch/profile-cordis.patch/profile-package.json`） | `ls -la src-work/backups/` | **D** |
| 单测 | **14/14 pass / 0 fail**（`node --test` 实跑 325ms，见 §6.3） | 只读实跑（不写状态） | **D** |
| settings（**注意：已漂移**） | 15:20 前后 `revision` 从 0→4→6 变动，`user` 含 `enableFirecrawl/tinyfish=true`，且 15:24 采样 `enableExa=false` / `resultTelemetry=false`，15:35 又变回 `true` | 认证 `GET /api/unified-search/settings` | **D** |
| health（**注意：已漂移**） | 15:24 采样 `enabled=5` ids `[parallel,ddg,searxng,firecrawl,tinyfish]`（**不是 Lead 基线的 6**） | 认证 `GET /api/unified-search/health` | **D** |
| drop-in | `/etc/systemd/system/dsh-web.service.d/10-websearch-lead-fix.conf`，3 行 `Environment=` | `cat` + `systemctl show -p Environment` | **D** |
| 全库 md | 顶层 **28 份 md**（含 36/37/38 与本报告），索引表只列 **24 行** | `ls *.md | wc -l` / `sed -n '253,280p' REPORT.md | grep -c '^| \['` | **D** |

> **⚠️ 反直觉起点**：Lead 广播给出的「当前真实状态」（MainPID=262230、health `enabled=6`、`tinyfish ✓/8`）中，
> **MainPID 与版本属实**，但 **`enabled=6` 在我采样时已不成立**（实测 5，见 §4.2）。
> 这不是文档写错，而是**并行的其它审查代理（38-e2e-save-probe 与后续 agent）在 15:03–15:35 持续 POST settings**，
> 导致 `revision` 与 `user` 层不断变化（`/tmp/s0..s4.json` 记录了 0→1→2；我两次采样到 4 与 6）。
> ⇒ 任何写「当前 health enabled=6」的报告都只是**采样时点快照**，不是恒定状态。等级 **D**（实测）。

---

## 1. 逐条裁决表

### §1 systemd drop-in：三行 `Environment=` 是否真生效？代理是否只作用于该服务？

| 核点 | 裁决 | 证据 | 等级 |
|---|---|---|---|
| 三行是否写入单元 | **成立**。文件含 `[Service]` + `DSH_WEB_FETCH_PROVIDER=http`、`HTTP_PROXY=http://172.30.66.1:1091`、`HTTPS_PROXY=http://172.30.66.1:1091`，另有 15 行注释说明回滚 | `/etc/systemd/system/dsh-web.service.d/10-websearch-lead-fix.conf:1-24`（`chmod 644`，mtime `2026-11-06 14:17:44`） | **A/D** |
| 是否进入**进程 env** | **成立**。`/proc/262230/environ` 逐字含 `DSH_WEB_FETCH_PROVIDER=http`、`HTTP_PROXY=…1091`、`HTTPS_PROXY=…1091`；另含 `DSH_EGRESS_FORWARDER=http://172.30.0.1:13070/fwd` 与 `NO_PROXY/no_proxy`（来自启动脚本，非 drop-in） | `tr '\0' '\n' < /proc/262230/environ \| grep -iE 'proxy\|DSH_WEB_FETCH'` | **D** |
| 是否进入 **systemd 生效配置** | **成立**。`systemctl show … -p Environment` 输出 `HOME=… DSH_HOME=… PATH=… DSH_WEB_FETCH_PROVIDER=http HTTP_PROXY=… HTTPS_PROXY=…`；`DropInPaths` 列出该文件；`NeedDaemonReload=no` | `systemctl show dsh-web.service -p Environment -p DropInPaths -p NeedDaemonReload` | **D** |
| 主单元是否**覆盖** drop-in | **不覆盖**。主单元 `/etc/systemd/system/dsh-web.service:12-14` 只有 `HOME`/`DSH_HOME`/`PATH` 三个 `Environment=`，**无** `DSH_WEB_FETCH_PROVIDER`、**无** `HTTP(S)_PROXY`；两者是不同键，drop-in 追加而非冲突 | `grep -n Environment /etc/systemd/system/dsh-web.service` | **A** |
| `daemon-reload` 是否做过 | **间接成立（无法取得直接日志）**。`NeedDaemonReload=no` + `DropInPaths` 已列出该文件 + 进程实际持有三个变量 + 服务在 13:51:12 重启，四者共同证明单元配置已被 systemd 重新读取。但 `journalctl -u systemd \| grep reload` **0 命中**（日志轮转/权限），`journalctl -u dsh-web.service` 只有 crontab 行 | `systemctl show` + `journalctl`（grep 结果为空） | **D + E**（「具体哪一次 daemon-reload、由谁执行」为 E；25 §2:42 自称「每次改动后均 daemon-reload」属自述，无独立日志佐证） |
| `HTTP(S)_PROXY` 是否**只作用于该服务** | **部分成立（有重要限定）**。① 全局启动脚本 `/usr/local/sbin/dsh-web-run-native.sh:1-24` **全文无** `HTTP_PROXY`/`HTTPS_PROXY`（只有 `:18-19` 的 `NO_PROXY`），mtime `2026-11-06 11:14:36`（早于 drop-in 13:48/14:17）⇒ **未误改脚本**，25 §2:41 / §0:5 的声明成立。② `/etc/environment` 无 proxy 行。③ **但** `/etc/systemd/system/docker.service.d/http-proxy.conf:2-3` 与 `hk-relay-mihomo.service:2` 也含 `172.30.66.1:1091` —— 是 **docker 服务与 mihomo 中继的既有独立配置**，与本轮改动无关（mtime/内容均不含 `dsh-websearch`），不构成「全局污染」。④ **关键反例**：`DSH_EGRESS_FORWARDER` 来自启动脚本 `:16`，`llm.env`/`web-auth.env` 由 `:7-10`  sourced，这些是**该服务进程**的环境，不是全局 | 全部只读 grep/stat | **A/D** |
| 25 §2:43 回滚命令是否完整 | **不完整**（见 §2）；但就 drop-in 本身 `rm + daemon-reload + restart` 三步是对的 | `25-execution-log.md:43` | **A** |

**§1 小结**：三行 env **确实生效**（进程 + systemd 双证），主单元不覆盖，全局启动脚本一字未改。
`daemon-reload` 只能间接证明（E 级补注）。**代理作用域是「dsh-web.service 这个服务」，不是「整个主机」**，
但同一台机器上另有 docker/mihomo 使用同一网关地址，属既有事实，勿误读为本轮扩散。

---

### §2 回滚链完整性：25 §6 能否回到基线？9 改动文件 ↔ 8 备份逐一枚举

#### 2.1 实际改动文件清单（9 个，D 级，md5 全部 MATCH）

| # | 安装目录相对路径 | 类型 | 备份文件（`src-work/backups/`） | 25 §6 是否覆盖 |
|---|---|---|---|---|
| 1 | `lib/util/egress-fetch.js` | 修改 | `egress-fetch.js.orig` | ✅ `:89` `cp` |
| 2 | `lib/util/mcp-client.js` | 修改 | `mcp-client.js.orig` | ✅ `:90` `cp` |
| 3 | `lib/index.js` | 修改 | `index.js.orig` | ✅ `:91` `cp` |
| 4 | `lib/client.js` | 修改 | `client.js.orig` | ✅ `:92` `cp` |
| 5 | `lib/provider.js` | **修改（§11 新增）** | `provider.js.orig`（8 个备份中第 8 个，mtime `Nov 7 13:50`） | ❌ **遗漏** |
| 6 | `lib/backends/firecrawl.js` | 新增 | 无（应 `rm`） | ✅ `:93` `rm` |
| 7 | `lib/backends/tinyfish.js` | 新增 | 无（应 `rm`） | ✅ `:93` `rm` |
| 8 | `tests/lead-20261106.test.js` | 新增 | 无（应 `rm`） | ✅ `:93` `rm` |
| 9 | `tests/lead-20261107.test.js` | **新增（§11 新增）** | 无（应 `rm`） | ❌ **遗漏** |

**另有 3 个「备份存在但文件未改动」**（D 级：`md5sum` 比对）：
`cordis.patch.yml.orig` ↔ 插件自带 `cordis.patch.yml` **SAME**（25 §0:12 已声明未触碰，正确）；
`profile-package.json.orig` ↔ `/home/dsh/.dsh/profiles/web/package.json` **SAME**（未触碰，正确）；
**`profile-cordis.patch.yml.orig` ↔ `/home/dsh/.dsh/profiles/web/cordis.patch.yml` 为 CHANGED**（见 §2.3，属**未登记的第十处改动**）。

> **算术核对（Lead 广播口径）**：9 个改动文件 = **5 个「有备份需 cp」** + **4 个「新增需 rm」**。
> 备份目录 8 个 `*.orig` = 5 个对应改动文件 + 3 个「未改动/别处」文件。
> 25 §6 实际只写了 **4 个 cp + 3 个 rm = 7 个动作**，**漏 2 个**（`provider.js` 的 cp、`lead-20261107.test.js` 的 rm）。
> 25 §0:9 写「7 个文件 `*.orig`，含 4 个 lib 文件」是**早期快照**（当时还没 `provider.js.orig`）；
> 25 §11.6:278 已自述「备份增至 8 个」，但 **§6 回滚块从未同步更新** ⇒ 这是**确凿的文档债/回滚缺陷**。

#### 2.2 只读模拟回滚（**未执行**）：按 §6 原样跑会发生什么

| 步骤 | 结果（推断） | 等级 |
|---|---|---|
| 4 个 `cp` | 4 个文件正确还原 | **A**（命令文本） |
| 3 个 `rm` | 3 个新增文件正确删除 | **A** |
| **遗漏 1**：`lib/provider.js` 未还原 | 保留 PR #7 的 RFC1918 正则改动（`192.168(\.\d{1,3}){2}`），**回滚后与基线不一致**；因该文件只影响私有实例 baseURL trust gate，对「重现基线症状」无直接影响，但违反「逐字节回到基线」承诺 | **A + E**（影响面推断） |
| **遗漏 2**：`tests/lead-20261107.test.js` 未删 | 安装目录残留一个测试文件；`node --test tests/*` 会多跑 3 条（且这 3 条依赖 `lib/index.js` 的新 `current()`，回滚后**可能失败**） | **A + E** |
| **遗漏 3**：`profile-cordis.patch.yml` 未还原 | 见 §2.3 | **A** |
| `rm drop-in + daemon-reload + restart` | 3 个 env 消失 → `DSH_WEB_FETCH_PROVIDER` 不再 pin | **A/D** |

#### 2.3 第十处改动：profile `cordis.patch.yml`（**全库报告均未登记**）

`src-work/backups/profile-cordis.patch.yml.orig`（备份时间 `2026-11-06 08:23:57`）与当前
`/home/dsh/.dsh/profiles/web/cordis.patch.yml`（mtime `2026-11-07 15:17:23`，且在我采样期间仍在变）`diff -u` 结果：

- 删除 `deepseek-v4-flash` 模型条目（14 行）；
- `dsh-agent-default-model` 的 `model: deepseek-v4-flash` → `deepseek-v4.1-flash`；
- **追加** `- id: dsh-websearch / name: "@240xu/dsh-websearch" / config: { numResults: 8 }`（6 行）。

25 §0:12 **明确写着「未触碰 `~/.dsh/profiles/web/cordis.patch.yml`」** —— 与当前文件状态**矛盾**（A 级）。
该文件在 15:17 仍在被其它 agent 修改（mtime 晚于 25 号执行日志 14:20 的落盘），**不能断定是本轮 Lead 改动**（E）；
但无论如何，**§6 回滚链完全没有覆盖这个文件**，且它含有 `id: dsh-websearch` 的搜索配置行 ⇒
「回到基线」后 `numResults: 8` 的显式配置与 bundle 层的 provider 注册仍然残留。
**这是比漏 2 个文件更值得记的缺陷**。

#### 2.4 回滚后哪些命令会重现 `WEB_PROVIDER_AMBIGUOUS` / `all enabled backends failed`

| 症状 | 触发条件 | 依据 | 等级 |
|---|---|---|---|
| `web_fetch` → `Error: multiple usable web providers are registered (deepseek-fetch-api, http); configure one explicitly`（`WEB_PROVIDER_AMBIGUOUS`） | 移除 drop-in 的 `DSH_WEB_FETCH_PROVIDER=http` 且**不重启其它挂载**（发布版仍挂 `dsh-web-deepseek-api`）。25 §2:40、[99 裁决 3](99-final-verdicts.md):31、[24](24-p0-landing-correction.md) 一致：根因是插件 bundle patch 的 `- id: web` 整体替换抹掉 base 的 `fetchProvider: http`，env pin 是零文件编辑解 | **A/C**（发布版 `dsh-web/lib/index.js:60,115,121-134`） |
| `web_search` → `all enabled backends failed (4)` 或全超时 | 移除 `HTTP_PROXY/HTTPS_PROXY` 后，`dsh` 用户受 `DSH_EGRESS` iptables 白名单限制（只放行 `172.30.66.1:1091` 等），直连必然全部 `000`；4 个 keyless 后端 5s 超时。25 §2:41、[02](02-runtime-state.md):511 的出口矩阵互证 | **A/C/D**（机制为 A，回滚后**是否仍全 000** 属 E：出口状态会变） |
| **但**：`egress-fetch.js` 补 Host 的修复**不在 §6 的 4 个 cp 之外**，它会被 `cp egress-fetch.js.orig` 还原 ⇒ 即使代理仍在，403 也会回来 | 25 §1:18、[99 裁决 1](99-final-verdicts.md):7-9 | **A** |

> **裁决**：25 §6 的结论句（`:98-99`「web_fetch 应重现 … web_search 应重现 …」）**方向正确**，
> 但作为「完整回滚」**不成立**——漏 2 个文件动作 + 漏 1 个配置文件 + `need daemon-reload` 无独立日志。
> 严重度 **P1**（不会导致数据丢失，但「全可逆/逐字节一致」的承诺被削弱，且残留文件可能让回滚后的测试套件变红）。

---

### §3 升级覆盖风险

| 核点 | 裁决 | 证据 | 等级 |
|---|---|---|---|
| `pnpm install` / 升 2.8.8 会覆盖哪些文件 | **全部 9 个改动文件 + 整个 `lib/`、`tests/`、`package.json`、`cordis.patch.yml`**。`profile package.json:dependencies` pin `@240xu/dsh-websearch: "2.8.4"`，`pnpm-lock.yaml:12-13` 亦 pin 2.8.4；升级版本会重写 `node_modules/@240xu/dsh-websearch/` 整个目录（该目录现含 9 个本地改动文件与 2 个新增测试） | `cat /home/dsh/.dsh/profiles/web/package.json` + `pnpm-lock.yaml:11-14,29-32` + `ls -la` 安装目录 | **A** |
| 25 §5:78 / §11.7:284 是否已声明 | **已声明**（「升级会覆盖 `node_modules` 内改动，需重新应用或提上游 PR」）⇒ 不是新发现，是**已登记风险**，但**没有落地的补丁/diff 文件** | `25-execution-log.md:78,284` | **A** |
| `package.json` 的 `dsh.client.inject` 是否需同步 | **不需要**。`package.json:57-66` 的 `inject` 是**包级依赖列表**（5 个 `@deepseek-ai/dsh-*` 包名），而 §10 修的是 `lib/client.js:758` 的 **service key 数组** `["slots","locale","connection","remote","remote.credentials"]`。25 §10.2:201 已明确「package.json 的 `dsh.client.inject` 是包级依赖列表，不是 service key，故不改（测试里有断言防误加）」。实测 `src-work/plugin/package.json` 与安装目录 `package.json` **逐字节一致**，且两处 `inject` 列表完全相同 ⇒ 结论成立 | `package.json:57-66`、`lib/client.js:758`、md5 比对、25 §10.2:201 | **A/D** |
| 是否应整理成上游 PR diff | **应做但未做**（25 §5:80、§11.7:284、99 :70 均列为「仍未执行」）。当前 `src-work/plugin/` 是完整可 diff 的工作副本，`src-work/backups/*.orig` 是改前原文，`diff -u` 可直接生成补丁；缺的是**一份整理好的 PR 描述 + 与 PR #7 / Issue #8 的对齐说明**。注意：`lib/index.js` 的 `current()` 修复**逐字对齐 PR #7**（25 §11.4:258），`lib/provider.js` 正则也是 PR #7 附带 ⇒ 上游合并后这两处可退役，其余 7 处需单独提 PR | 25 §5:80、§11.4:258、§11.7:284、99 :70 | **A + E**（「PR 是否会被接受」为 E） |

**反直觉点**：`dsh.client.inject` 里**没有** `@deepseek-ai/dsh-credentials` 之类 service key，
但 `package.json` 的 `peerDependencies`（`:50-53`）却有 `@deepseek-ai/dsh-settings` / `dsh-credentials` /
`dsh-launch-environment` ⇒ **依赖声明与 service inject 是两套机制**，25 §10.2 的判断正确，
审查时若把两者混为一谈会误报「漏改」。等级 **A**。

---

### §4 文档与实际状态一致性

#### 4.1 REPORT.md 头部 / 99 待裁定 / 25 §8–§11 的过时表述判定

| 位置 | 原文要点 | 当前实况 | 判定 | 等级 |
|---|---|---|---|---|
| `REPORT.md:6` | 「**25 份 md 报告，约 9800 行**」 | 顶层实际 **28 份 md**（新增 36/37/38 与本报告、以及后续 3x），总行数 **9975**；索引表 `:253-280` 只列 **24 行** | **过时**（数字偏差；`REPORT.md:251` 已有「下表行数按交付时点记录」免责注，属 P2） | **D** |
| `REPORT.md:8` | 「累计 9 个文件… **8 个备份**… 全可逆」「`health enabled=6`」「`tinyfish ✓3941ms/8`」 | 9 文件/8 备份属实；**`enabled=6` 在 15:24 采样为 5**（并发 agent 改 settings，见 §0）；`tinyfish ✓/8` 是 14:17 的历史实跑，非当前恒定值 | **「全可逆」被 §2 削弱**；enabled=6 是时点快照非恒定 | **D** |
| `REPORT.md:16`（执行摘要第 2 条） | 「**当前 `web_search` 事实不可用**：4 个 keyless 后端全失败…`enabled:4`…`user:{}` / `revision:0`」 | 当前 `enabled=5`（或 6，随时点变），`user` 层非空、`revision=4→6`，`web_fetch` 200、`web_search` 有真实结果 | **严重过时**（这是 11-04 的调研快照，虽 §8 有「已执行」注记框，但**正文结论句仍用现在时「当前…事实不可用」**） | **D/A** |
| `99-final-verdicts.md:3` | 「本目录 **17 份报告** 跨度 11-04 → 11-06」 | 顶层 28 份，跨度到 11-07 | **过时**（数字）；同文件 `:66` 已加「状态更新」框，属过程记录 | **D** |
| `99-final-verdicts.md:64-71` 待裁定 4 项 | ① 产品决策动机仍 E；② PR#7/#8 时间窗已解除；③ P0 已授权执行；④ 闭源/E 级缺口维持 | ① 仍 E（无新资料）；②/③ 已就地追加 11-06/11-07 更新；④ 中「**DSH 官方 8 条约定的引入 commit**」已被 [07 附录](07-dsh-docs.md) 补上 1 条（拒绝重定向→C 级），其余 8 条仍 E；「**vitest 实跑绿**」——本次 `node --test` 14/14 已实跑（D），但**不是 `vitest`**，措辞需精确 | **部分过时**（④ 两项） | **A/D** |
| `99-final-verdicts.md:70` | 「**仍未执行**：…在浏览器里手工填测试 key 点保存（唯一剩余端到端确认）」 | 15:20 `38-e2e-save-probe.md` 已用认证 API **真实 POST settings** 完成读写闭环（numResults 8→9→8，revision 0→2），但**未写真实第三方 key**、**未点浏览器按钮** | **部分过时**：settings 保存链路已做，凭证 `credentials/set` 仍未做；应改写为「凭证写入链路（WebSocket RPC）未端到端验证」 | **A/D** |
| `25-execution-log.md:9` | 「备份目录… **7 个文件** `*.orig`，含 4 个 lib 文件」 | 实际 **8 个**，含 **5 个** lib 文件（多了 `provider.js.orig`） | **过时**（§11.6:278 已自述增至 8，但 §0 未回改） | **D** |
| `25-execution-log.md:11,63,139,172,216` | 「**7 个文件** 逐字节 MATCH」 | §11.6:277 已改为 **9 个文件**；§8/§9/§10 各轮表格仍是 7 | **过时**（同一文件内新旧口径并存） | **D** |
| `25-execution-log.md:142,175` | 「**7 个 `*.orig` 完好**」 | 8 个 | **过时** | **D** |
| `25-execution-log.md:27` | 「未改 `provider.js` / `history.js` / `cache.js`」 | §11.4:259 明确改了 `lib/provider.js:316` | **自相矛盾**（§1 当时未改，§11 改了，但 §1 的「未做」句未加时间限定） | **A** |
| `25-execution-log.md:77` | §5 第 1 条「`enableFirecrawl`/`enableTinyfish` **仍默认 false**，需在设置面板打开」 | schema 默认仍 false（正确），但**用户已打开且生效**（`:70`、`:248`、§11.5、38 号均证） | **半过时**：应补「（已由用户打开并于 PR#7 修复后生效）」 | **A/D** |
| `25-execution-log.md:78,80,284` | 「升级 2.8.8 未做」「提上游 PR 需用户决定」「PR #7 仍未上游合并」 | 仍成立 | **未过时** | **A** |
| `25-execution-log.md:249` | §11.3 「health `enabled=4`（修复前）」 | 是**历史对照值**，标注「修复前」正确 | **未过时** | **A** |
| `25-execution-log.md:276-279`（§11.6） | 「MainPID=262230、9 文件 MATCH、14/14、8 备份、GUI 200」 | **全部实测属实**（§0） | **未过时** | **D** |
| `25-execution-log.md:283`（§11.7 边界 1） | 「未在浏览器里手工点『保存』写入一个真实第三方 key」 | 仍成立（38 号也未写第三方 key） | **未过时** | **A** |
| `36-lead-prefindings.md:41-49` | 基线表 `enabled=6`、8 备份、25 份基线快照 | enabled=6 为 15:00 时点值；`.baseline-20261107-1455/` 实测含 26 个 md + CHECKSUMS（36:49 写 26 个 md ✅） | **基本属实**，enabled 为时点值 | **D** |
| 索引表行数/份数 | `REPORT.md:253-280` 共 **24 行**（含 `13-raw-evidence.txt` 这个 .txt）；头部写 25 份 md | 实际顶层 28 份 md；索引表**未收录** 36/37/38/本报告/30–35 号专家报告（当时未落盘） | **行数偏少、份数偏少**，但 `:251` 有「按交付时点记录」免责 | **D** |

#### 4.2 「默认关 / 未执行 / 待批准 / 已生效」专项

| 短语 | 命中位置 | 是否仍写「已生效却说未生效」 | 等级 |
|---|---|---|---|
| 「默认关」 | `25:21,22,27,122-125`、`20:107-108`、`09c:132,213,214`、`src-work/plugin/README.md:99` | **否** —— 这些都是「schema 默认值 false」的历史/设计陈述，99:70 已补「用户手动打开且 PR#7 后生效」。`src-work/plugin/README.md:99` 仍是**旧版 README**（写 11 个后端开关、无 firecrawl/tinyfish），属工作副本未同步 | **A** |
| 「未执行」 | 25:5,75 等 | 25 §5 的「开启新后端」(`:77`) **已由用户执行**（settings.user=true），但句子写的是「需在设置面板打开」的**建议**，不是「未执行」断言 ⇒ 属 P2 措辞 | **A/D** |
| 「待批准」 | 全库 **0 命中** | — | **缺口（无此项）** |
| 「待用户裁定」 | `99:64`、`REPORT.md:270` | 99 的 4 项已就地逐项更新状态（`:66` 状态框 + ②③ 追加），**不是未处理的待办**；标题保留属过程记录 | **A** |
| 「health enabled=6」 | REPORT:8、25:268、36:47、99:69、38:22 | **实时值已漂移**（§0 采样 5）⇒ 全部是「时点快照」，若用于「当前状态」断言则过时 | **D** |

---

### §5 密钥泄漏严格扫描（值，不是变量名）

**扫描范围**：`.artifacts/websearch-research/**/*.md`（含 2 个 `.baseline-*` 快照，共 70 份 md）、
`13-raw-evidence.txt`、`/home/ova/re-agent/dsh-web.log[.prev]`、`/tmp/*.json`、`/tmp/*.cookies`、
`/etc/systemd/system/dsh-web.service*`、安装目录 `lib/*.js`。

**扫描模式**（值级，字面量一律脱敏）：`cfut_…`、`ghp_…`、`github_pat_…`、全局记忆里的本机口令 / HK 服务器口令（**不写出值**）、`gptreg-mail-…`、
`?token=<值>`、`Authorization: Bearer <值>`、settings `user` 里的值、cookie `v1.<JWT>`。

| 模式 | 命中 | 判定 | 等级 |
|---|---|---|---|
| `cfut_` / `ghp_` / `github_pat_` | **0** | 无 Cloudflare / GitHub PAT 值 | **D** |
| 全局记忆中的本机 / HK 服务器口令（值已脱敏） | **0** | 两个口令**未进入任何 md** | **D** |
| `gptreg-mail-…` | **0** | 无 Worker API token 值 | **D** |
| GUI `?token=<值>` | md 中**全部是占位符**：`36:41`「`?token=`」、`02:20/201/239/248/399`「`token=...` / `?token=<...>` / `?token=…`」、`10:63`「`?token=<`」 | **0 个真实值**；但**真实值存在于** `/home/ova/re-agent/dsh-web.log:16`（mode **600**、owner `dsh`），形如 `?token=<REDACTED>`。该日志由 systemd 单元 `ExecStartPre` 每轮 `install -m 600` 重建 ⇒ **权限正确、非泄漏**，但它是活凭据，任何 `grep` 输出须脱敏（本报告已脱敏） | **D** |
| `Authorization: Bearer <值>` | `09c:100,197`（+2 份 baseline 镜像）共 6 处，均为 **`Bearer public`**（OpenCode Zen 匿名 lane 的**公开字面量**，非密钥） | **不构成泄漏**；建议注明「public 是固定字面量」以免审查者误报 | **A** |
| settings `user` 里的值 | `/tmp/b-settings.json`、`/tmp/s0..s4.json`、`/tmp/set*.json` 的 `user` 全为 `{"enableFirecrawl":true,"enableTinyfish":true}` 或加 `numResults`；`*ApiKeyEnv` 字段值是**环境变量名**（如 `BRAVE_API_KEY`，13–17 字符），**无任何 key 值** | **0 个密钥值** | **D** |
| `/tmp/*.cookies` | 8 个 cookie 文件（`/tmp/b.cookies`、`dsh.cookies`、`dsh2.cookies`、`f.cookies`、`save-test.cookies`、`z.cookies`、`opsB.cookies`、`opsB2.cookies`）**每个含 1 个 `v1.<JWT>` 会话令牌**，文件 mode **644**（world-readable） | **⚠️ P2 实操风险**：`/tmp` 下 644 的会话 cookie 可被同机任意用户读取（本机 `ova`/`dsh`/`root` 多用户共存）。这些 cookie 是**短时会话凭证**，随服务重启/过期失效，且**不是**第三方 API key；但按「有迹可循 + 最小暴露」纪律，建议 `chmod 600` 或清理。**不在 md 报告里，故不违反「报告无凭证」承诺** | **D** |
| `13-raw-evidence.txt` | 原始 npm/commit 输出，无 token 值 | 干净 | **D** |

**结论**：**全库 25+ 份 md 报告 0 个真实密钥值**（25 §8.2:142、§9.2:175、§10.3:217、§11.6:278 的「全库密钥扫描 0 命中」自述**成立**，等级 D 复核）。
需清理项仅 2 个、均 P2：① `/tmp/*.cookies` 的 644 权限（8 文件）；② `dsh-web.log:16` 的活 token 虽 600 但属活凭据，建议报告里一律用占位符（已遵守）。
**`Authorization: Bearer public` 是公开字面量，勿误判为泄漏**。

---

### §6 i18n / 测试真实性

#### 6.1 zh/en 键集合对称性（写脚本比对，D 级）

用 Node 脚本对 `lib/client.js:62`（`const zh = {`）与 `:117`（`const en = {`）做**深度跟踪的顶层键提取**（避免把注释/嵌套/字符串里的 `xxx:` 误算）：

| 项 | 结果 | 判定 |
|---|---|---|
| zh 顶层键数 | **54** | — |
| en 顶层键数 | **54** | — |
| zh-only（en 缺失） | **[]** | ✅ 完全对称 |
| en-only（zh 缺失） | **[]** | ✅ 完全对称 |
| `props.t("…")` / `ctx.locale.bind(NS)("…")` 引用键 | **62 个不同键**（含跨文件/动态形式） | — |
| **用未定义（use-undef）** | **0** | ✅ 无「用未定义的键」 |
| **定义未用（def-unused）** | **6 个**：`title` / `dirty` / `saved` / `reset` / `overridden` / `togglesTitle` | ⚠️ 见下 |
| 初筛误判已排除 | `nav`（`:801` `ctx.locale.bind(NS)("nav")` 引用）、`keyLabel`（`:719` `props.t("keyLabel",{id})` 插值引用）——这 2 个**不是死键**，是正则没覆盖 bind/双参形式 | **D** |
| 6 个死键是否为**本轮引入** | `src-work/backups/client.js.orig`（改前原文）中 6 个键**全部已存在**且同样未被 `t()` 引用 ⇒ **既有冗余，非本轮回归** | **A/D** |
| 25 §9.1:161 声称「清理死文案：`keysTitle`/`keyHint` 从两本字典删除」 | 实测当前两本字典**确无** `keysTitle`/`keyHint` ⇒ 该清理**已落地** | **A** |
| 25 §8.1:129「新增 4 个键两本各定义一次且都被 `props.t()` 引用」 | `groupMetered`/`meteredHint`/`statusMetered`/`statusOffByDefault` 各 `def=2` 且被引用；测试 `:135-136` 有静态断言 | **A/D** |

> **裁决**：zh/en **完全对称、零 use-undef**（比 25 §8.2:137「4 个键 def=2/use=1 全部达标」更广的结论）。
> 唯一缺陷是 **6 个既有死键**（P2，代码冗余，不影响功能；`dsh-prose-standard` 的「不 restate / 不留死文案」纪律建议清理，但**不属本轮回归**）。

#### 6.2 14 个测试是否都真有断言 / 有无恒真断言

| 项 | 结果 | 等级 |
|---|---|---|
| 测试文件 | `tests/lead-20261106.test.js` = **11 tests / 51 asserts**；`tests/lead-20261107.test.js` = **3 tests / 10 asserts**；合计 **14 / 61** | **A** |
| 恒真断言扫描（`length >= 0` / `assert.ok(true)` / `assert.equal(1,1)` / `.toBeTruthy()` / `.toBeDefined()`） | **0 命中** | **A/D** |
| 断言类型 | 全部为 `assert.equal` / `assert.deepEqual` / `assert.match` / `assert.doesNotMatch` / `assert.ok(<具体条件>)`；`:108` 甚至断言 `restorations.length === 2`（精确值，非恒真） | **A** |
| 行为级测试 | `lead-20261107.test.js:21-61` 用假 settings + 私有 baseURL + `safeSearch:false`，断言真实 URL 含 `192.168.1.100:8385` 且 `safesearch=0`、**不是** `searx.be`；`:70-77` RFC1918 正反例；`:80-85` 源码级 `current()` 结构 | **A** |
| 是否依赖 live network | **否**。`lead-20261106` 全是 fixture / 源码字符串断言；`lead-20261107:26-27` **主动清除** `HTTP_PROXY/HTTPS_PROXY/NO_PROXY` 再跑（注释在 25 §11.4:262 说明「否则 egressFetch 走代理而非 fake fetch」）。唯一外部依赖是 `node --test` 与本地文件读取 | **A/D** |
| 是否依赖真实 key | **否**。全程无 `process.env.*_API_KEY` 读取；`DSH_HOME` 指向 `mkdtempSync`（临时目录），运行后由测试自行恢复 env | **A** |
| **实跑结果** | `cd src-work/plugin && node --test tests/lead-20261106.test.js tests/lead-20261107.test.js` → `# tests 14 / # pass 14 / # fail 0 / # skipped 0`，`duration_ms 325.6`，exit code 0 | **D**（本次独立复跑，只读） |

> **注意等级精度**：25 §7:111 写「单测通过 **8/8**」、§8.2:136「8/8」、§9.2:170「9/9」、§10.3:212「11/11」、§11.6:277「14/14」——
> 这是**逐轮累加的历史记录**，全部正确；但 25 §7:111 属 §7 证据等级表（写「详见 §8」却标 8/8），
> 与 §11 的 14/14 并存易被误读为矛盾 ⇒ **P2 措辞**。99 :71 的「`vitest` 实跑绿」应改为「`node --test` 14/14 实跑绿（本次 ops-B 独立复跑）」，因**从未用 vitest**。

#### 6.3 与 38-e2e-save-probe 的关系（并发写操作的副作用，D 级）

`/tmp/s0.json → s4.json` 记录 `revision` 0→1→2 与 `numResults` 8→9→8；我 15:24 采样 `revision=4`、
15:35 采样 `revision=6`，`user` 层里 `enableExa` / `resultTelemetry` 在两次采样间**来回翻转**。
⇒ **并发审查代理在持续写 settings**，导致：
- `health enabled` 在 5 与 6 之间漂移（§0）；
- 任何以「当前 settings/health」为论据的报告都必须**标注采样时刻**，否则不可复核；
- 25 §11.5:268 的 `enabled=6` 是 14:17 的**历史决定性实证**，仍有效，但**不是 15:24 的当前值**。

---

### §7 启动告警：`dsh-purge-community` 缺 `yaml`

| 核点 | 裁决 | 证据 | 等级 |
|---|---|---|---|
| 告警内容 | `/home/ova/re-agent/dsh-web.log:4-5`：`dsh: warning: 1 entry did not activate` + `dsh-purge (dsh-purge-community): failed to import: Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'yaml' imported from /opt/dsh-plugins/dsh-purge-community/lib/permission-state.js`，附完整 Node ESM resolve 栈 | `sed` 全文 | **A/D** |
| 是否**本轮改动**引起 | **否（确证）**。① `node -e require.resolve('yaml',{paths:[…]})` → `MODULE_NOT_FOUND`（依赖本就缺失）；② `/opt/dsh-plugins/dsh-purge-community/package.json` 的 `dependencies` 未列 `yaml`（只读检查）；③ 该插件全部文件 mtime 为 `1985-10-26`（npm 打包固定时间戳）/ 目录 `2026-10-25 19:19`，**远早于本轮 11-06/11-07 改动**；④ 25 §11.2:238 与 §11.7:286 已两次登记为「既有问题，与本轮改动无关」 | **A/D** |
| 与 web search 改动是否相关 | **无关**。插件名 `dsh-purge-community` 是状态自检/提示词/备份回滚组件，profile `package.json` 的 bundle 列表里独立一行；其失败只影响自身 entry，不影响 `@240xu/dsh-websearch` 或 `dsh-web` seam | `package.json` bundle 列表 + 日志栈 | **A** |
| 还有没有其它被忽略的告警 | **有 2 条，均低优先级**：① `dsh-web.log:1-2` `ExperimentalWarning: SQLite is an experimental feature`（Node 运行时固有）；② `dsh-web.log:17` `[cline] models.dev 目录拉取失败（缺的模型与图片能力退回本地兜底表）：The operation was aborted due to timeout`（**外部目录拉取超时，走本地兜底**）；③ `dsh inspector: devtools://…`（调试器信息，非告警）。**25 / 36 / 99 全部只登记了 `1 entry did not activate` 一条，另 2 条从未被任何报告提及** | `dsh-web.log` 全文逐行 | **A/D** |
| `[cline]` 告警是否影响搜索 | **不影响搜索执行**（模型目录兜底），但它是**另一个 outbound 超时**，与 25 §5:81 记录的「1091 出口抖动」可能同源 ⇒ 值得在运维报告里并列 | 日志 + 25 §5:81 | **D + E**（同源为推断） |

---

### §8 全库过时表述清单（文件:行号 + 应改成什么）

> 只列**当前状态已变但正文仍用现在时/旧数字**的条目；明确标注「历史/修复前/交付时点」的**不列入**（属合规过程记录）。

| # | 文件:行号 | 现状原文（短引） | 应改成 | 严重度 |
|---|---|---|---|---|
| 1 | `REPORT.md:16` | 「**当前 `web_search` 事实不可用**：4 个 keyless 后端全失败…`enabled:4`…`user:{}` / `revision:0`」 | 「**11-04 调研时点** `web_search` 事实不可用…；11-06 执行后已恢复（见 :8 与 25 §3/§11）」 | **P1**（正文现在时与 :8 状态框直接冲突） |
| 2 | `25-execution-log.md:9` | 「备份目录… **7 个文件**，含 4 个 lib 文件」 | 「**8 个** `*.orig`，含 **5 个** lib 文件（`provider.js.orig` 于 §11 追加）」 | **P2** |
| 3 | `25-execution-log.md:11,63,139,172,216` | 「**7 个文件**逐字节 MATCH」（5 处） | 统一为 **9 个文件**（§11.6:277 已是 9）或加「§8 之前为 7」时间限定 | **P2** |
| 4 | `25-execution-log.md:142,175` | 「**7 个 `*.orig` 完好**」 | 「**8 个**」 | **P2** |
| 5 | `25-execution-log.md:27` | 「未改 `provider.js` / `history.js` / `cache.js`」 | 「**§1 阶段**未改；`lib/provider.js:316` 已于 §11.4 按 PR #7 修改」 | **P1**（同文件内自相矛盾） |
| 6 | `25-execution-log.md:77` | 「`enableFirecrawl`/`enableTinyfish` 仍默认 `false`…**需在设置面板打开**」 | 追加「（schema 默认仍 false；用户已打开，PR #7 修复后 health 已含两者，见 §11.5 / 38 号）」 | **P2** |
| 7 | `25-execution-log.md:83-100`（§6） | 「**完整回滚**（一条命令链）」+ 4 cp / 3 rm | 改为 **5 cp + 4 rm**，补 `provider.js.orig` 与 `tests/lead-20261107.test.js`，并补 `profile-cordis.patch.yml.orig` 的归属说明；标题去掉「完整」或注明「§11 后需同步」 | **P1**（见 §2） |
| 8 | `25-execution-log.md:12` | 「**未触碰** `~/.dsh/profiles/web/cordis.patch.yml`」 | 当前文件与 `profile-cordis.patch.yml.orig` **不一致**（含新增 `id: dsh-websearch` 行）；应注明「11-07 15:17 后有其它 agent 改动，本日志未覆盖」 | **P1**（见 §2.3） |
| 9 | `99-final-verdicts.md:3` | 「本目录 **17 份报告** 跨度 11-04 → 11-06」 | 「**交付时 17 份**（现顶层 28 份），跨度至 11-07」 | **P2** |
| 10 | `99-final-verdicts.md:70` | 「**仍未执行**…在浏览器里手工填测试 key 点保存（**唯一**剩余端到端确认）」 | 「settings 保存链路已由 38 号用认证 API 读写闭环验证；**凭证 `credentials/set`（WebSocket RPC）与浏览器按钮点击**仍未端到端验证」 | **P2** |
| 11 | `99-final-verdicts.md:71` | 「`vitest` 实跑绿」 | 「**`node --test` 14/14 实跑绿**（ops-B 15:30 独立复跑）；未使用 vitest」 | **P2** |
| 12 | `REPORT.md:6` | 「**25 份** md 报告，约 **9800 行**」 | 「交付时 25 份；现顶层 **28 份**、约 **9975 行**（含 36/37/38 与 3x 专家报告）」 | **P2**（`:251` 已有免责注） |
| 13 | `REPORT.md:253-280` 索引表 | 只列 **24 行**，未收 30–38 号 | 补行或注明「审查轮次报告见 37 号汇总骨架」 | **P2** |
| 14 | `25-execution-log.md:111`（§7 证据等级表） | 「单测通过 \| D \| `node --test` 输出 **8/8**（详见 §8）」 | 加「§7 时点 8/8；§11 后 14/14」 | **P2** |
| 15 | `REPORT.md:8` / `25:268` / `36:47` / `99:69` / `38:22` | 「health `enabled=6`」 | 全部标注「**14:17 时点值**；15:24 并发探针期间实测 5，随 settings 写入漂移」 | **P2** |
| 16 | `src-work/plugin/README.md:99` | 「**11 个后端开关**」（无 firecrawl/tinyfish） | 工作副本 README 未随 §1 改动同步；若用于 PR diff 会误导 | **P2** |
| 17 | `02-runtime-state.md:207,402,419,442,570`、`20:25`、`_SKELETON:63`、`22:679` | 「settings `user:{}` / `revision:0`」「health `enabled:4`」「当前 `web_search` 全失败」 | 均为 **11-04/05 调研快照**，99 裁决 8 已声明「旧正文保留为过程记录」⇒ **可保留**，但建议各文件文首加一行「本文件为 11-04 快照，当前状态见 25/99」 | **P2（可保留）** |

---

## 2. 缺陷清单（P0 / P1 / P2）

### P0（阻断级）
**无**。本次对抗审查**没有发现任何 P0**：服务可用、三行 env 生效、9 文件一致、14/14 实跑绿、全库 0 密钥值泄漏、回滚的主路径（4cp+3rm+drop-in 移除）方向正确。

### P1（应修，影响「全可逆 / 全库一致」承诺）

| # | 缺陷 | 证据 | 等级 | 建议 |
|---|---|---|---|---|
| **P1-1** | **回滚链漏 2 个文件动作**：`lib/provider.js` 无 `cp provider.js.orig`、`tests/lead-20261107.test.js` 无 `rm`。25 §6 标题却写「完整回滚」 | `25:83-100` vs §2.1 枚举（9 文件 vs 7 动作）、`provider.js.orig` 实存（8 个备份之一） | **A/D** | §6 补 2 行；或在 §11.6 加「§6 为 §1 时点版本，§11 后需追加 2 动作」 |
| **P1-2** | **第十处未登记改动**：`/home/dsh/.dsh/profiles/web/cordis.patch.yml` 与 `profile-cordis.patch.yml.orig` 不一致（含新增 `id: dsh-websearch` 配置行），而 25 §0:12 明写「未触碰」；§6 完全未覆盖 | `diff -u`（§2.3）、当前文件 mtime `15:17:23` | **A + E**（谁改的为 E） | 查清归属（并发 agent 或 Lead），补进 25 号或单列「外部改动」；回滚链明确是否应还原 |
| **P1-3** | `25-execution-log.md:27` 与 `:259` **自相矛盾**（「未改 provider.js」vs「改了 provider.js:316」） | 两行直读 | **A** | 加时间限定（§1 阶段 / §11 阶段） |
| **P1-4** | `REPORT.md:16` 正文仍用现在时断言「当前 `web_search` 事实不可用」与同文件 `:8`「均实跑可用」直接冲突 | 两行直读 | **A/D** | 改为「11-04 调研时点」 |
| **P1-5** | 「**全可逆 / 逐字节回到基线**」承诺被 P1-1/1-2 削弱：按 §6 原样执行后仍残留 1 个改动文件、1 个新增测试、1 个配置差异 | §2.2 只读模拟 | **A + E** | 修 §6 后重做一次**只读** md5 模拟枚举（勿真回滚） |

### P2（文档债 / 实操卫生）

| # | 缺陷 | 等级 |
|---|---|---|
| P2-1 | 过时数字：25 号「7 个文件/7 个 `*.orig`」共 7 处、99:3「17 份」、REPORT:6「25 份 / 9800 行」、索引表 24 行 | **D** |
| P2-2 | 99:70「唯一剩余端到端确认」未反映 38 号 settings 读写闭环；99:71「vitest」实为 `node --test` | **A/D** |
| P2-3 | 6 个**既有**死 i18n 键（`title/dirty/saved/reset/overridden/togglesTitle`），非本轮引入（`client.js.orig` 同样存在） | **A/D** |
| P2-4 | `src-work/plugin/README.md:99` 仍是 11 后端旧版，未同步 2 个新 backend | **A** |
| P2-5 | `/tmp/*.cookies`（8 个）mode **644** 且含 `v1.<JWT>` 会话令牌，同机多用户可读；建议 600 或清理 | **D** |
| P2-6 | `dsh-web.log:1-2`（SQLite ExperimentalWarning）与 `:17`（`[cline] models.dev 拉取超时`）两条告警全库从未登记 | **A/D** |
| P2-7 | 25 §7:111「8/8（详见 §8）」与 §11.6「14/14」并存，需加时点限定；`enabled=6` 类时点值未标采样时间 | **A/D** |
| P2-8 | `Authorization: Bearer public`（09c:100,197 + 2 镜像共 6 处）是公开字面量，建议注明以免被后续审查误报为泄漏 | **A** |
| P2-9 | `daemon-reload` 只有间接证据（`NeedDaemonReload=no` + 进程 env），无 journal 直接行；25:42 的自述应标 E 或补 `systemctl daemon-reload` 的时间戳记录 | **D + E** |

---

## 3. 已确认无误（证伪失败清单）

| # | 断言 | 复核手段 | 等级 |
|---|---|---|---|
| 1 | 三行 `Environment=` 真生效 | `systemctl show -p Environment` + `/proc/262230/environ` 双证 | **D** |
| 2 | 主单元不覆盖 drop-in（只有 HOME/DSH_HOME/PATH） | `dsh-web.service:12-14` | **A** |
| 3 | 全局启动脚本 `dsh-web-run-native.sh` **未**被误加 `HTTP(S)_PROXY` | 全文 grep + mtime `11-06 11:14:36`（早于 drop-in） | **A/D** |
| 4 | `DSH_WEB_FETCH_PROVIDER` **只**来自 drop-in（主单元/脚本均无） | 三处 grep | **A** |
| 5 | 插件版本仍 **2.8.4**、`pnpm-lock` 亦 pin 2.8.4 | `node -p` + `pnpm-lock.yaml:12-13` | **A/D** |
| 6 | **9/9** 文件 `src-work/plugin` ↔ 安装目录 md5 逐字节 MATCH | 逐个 `md5sum` | **D** |
| 7 | **8 个** `*.orig` 完好 | `ls -la src-work/backups/` | **D** |
| 8 | **14/14** 单测通过、0 恒真断言、0 live network、0 真实 key | `node --test` 实跑 + 断言类型扫描 | **D/A** |
| 9 | zh/en 字典 **54/54 完全对称**、零 use-undef | Node 深度键提取脚本 | **D** |
| 10 | `dsh.client.inject`（包级依赖）**不需要**随 `lib/client.js` 的 service key 改动同步 | `package.json:57-66` + `:758` + md5 一致 + 25 §10.2:201 | **A/D** |
| 11 | 全库 md **0 个真实密钥值**（cfut/ghp/github_pat/口令/mail-token/GUI token/Bearer 值/settings user 值） | 值级 grep（§5） | **D** |
| 12 | `dsh-purge-community` 缺 `yaml` 与本轮改动**无关**（mtime 1985/10-25、依赖本就缺、独立 bundle） | `require.resolve` + stat + 日志栈 | **A/D** |
| 13 | GUI 认证后 **HTTP 200**、`settings ok=true writable=true applies=live` | 认证只读 curl | **D** |
| 14 | 25 §6 的**方向**正确：移除 drop-in 会重现 `WEB_PROVIDER_AMBIGUOUS`，移除代理会重现全 000 / `all enabled backends failed` | 99 裁决 3 / 24 / 02:511 交叉 | **A/C** |
| 15 | 25 §10.2「`keysTitle`/`keyHint` 死文案已删除」**已落地**（当前两本字典均无） | 键集合比对 | **A/D** |

---

## 4. 无法验证（E 级 / 缺口，不得当结论）

| # | 项 | 原因 | 建议 |
|---|---|---|---|
| E-1 | `daemon-reload` **具体执行时刻与执行者** | journal 无 reload 行（轮转/权限），只有 `NeedDaemonReload=no` 间接证据 | 查 systemd manager 日志归档或 `systemctl show -p …Timestamp` |
| E-2 | 按 §6 **真跑一次回滚**后是否逐字节回到基线 | 任务明确「只读模拟，不实际执行」；且会破坏当前可用服务 | 在隔离副本上跑，勿动生产 |
| E-3 | `profile-cordis.patch.yml` 差异**由谁、何时、为何**产生 | 文件 15:17 仍在变，25 号日志 14:20 落盘，无审计轨迹 | 查其它 agent 的 shell 历史 / 会话日志；本报告只判「存在且未登记」 |
| E-4 | 升级到 2.8.8 后本地 9 处改动**逐条是否仍适用** | 未升级（只读约束），且 2.8.8 tarball 未在本会话重新下载比对 | 由 35 号挖掘专家 / 后续 PR 工作承接 |
| E-5 | 凭证 `credentials/set`（WebSocket RPC）端到端 | 纯 curl 无法模拟 client RPC；38 号也只做了 settings | 需浏览器会话 |
| E-6 | `[cline] models.dev 超时` 与 1091 出口抖动**同源** | 只有时间相近，无抓包 | 查出口矩阵日志 |
| E-7 | `firecrawl` keyless 匿名额度具体数字 / `firecrawl ✗ MCP error` 是否纯额度 | 25 §11.7:285 已标预期降级，无服务端响应全文 | 保留 E |
| E-8 | 6 个死 i18n 键**是否有框架侧动态消费**（如 `locale.bind` 之外的运行时插值） | 只静态扫描 `lib/client.js`；未跑浏览器 | 浏览器控制台 `Object.keys(NS)` 比对 |
| E-9 | GitHub/GUI 会话 token 是否曾出现在**未被本次 glob 覆盖**的其它路径（如 `.zstd` session、`.git/config`、其它 `/tmp` 子目录） | 任务限定「全库 25+ 份 md、日志、`/tmp/*.json`、`/tmp/*.cookies`」；额外路径未授权/未逐一展开 | 如需全盘，另立项 |
| E-10 | 审查 C 的 `32-adversarial-ops.md` 结论 | 文件在本次调研期间**不存在**（两次 ls 均未见） | 若落盘后由 Lead 对照两份报告 |

---

## 5. 五条反直觉发现

1. **「8 个备份 vs 9 个改动文件」的真正缺口不是「少 1 个备份」，而是「回滚命令只写了 7 个动作」**。
   9 = 5 个有备份（需 `cp`）+ 4 个新增（需 `rm`）；8 个 `*.orig` = 5 个对应改动 + **3 个根本不属于这 9 个文件**
   （插件 `cordis.patch.yml` / profile `cordis.patch.yml` / profile `package.json`）。25 §6 只有 **4 cp + 3 rm**，
   漏 `provider.js` 的 cp 与 `lead-20261107.test.js` 的 rm。数字对得上，动作对不上 —— 这是最容易被「8 vs 9」表象掩盖的真实缺陷。**等级 A/D**。

2. **还有第十处改动，全库报告都没登记**：profile `cordis.patch.yml` 与它的 `.orig` 不一致，且新增了
   `- id: dsh-websearch` 的 `numResults: 8` 行；而 25 §0:12 白纸黑字写「未触碰」。该文件 **15:17:23 仍在被并发 agent 修改**
   （晚于 25 号落盘），因此不能断定是本轮 Lead 所为（E），但**回滚链完全没覆盖它**。「回到基线」后搜索配置仍残留。**等级 A + E**。

3. **「当前状态」在审查期间是移动的**：我 15:24 采到 `revision=4 / enabled=5 / enableExa=false`，
   15:35 采到 `revision=6 / enableExa=true`；`/tmp/s0..s4.json` 记录 38 号 agent 的 8→9→8 写入。
   ⇒ 所有写「health enabled=6」「user={…}」的报告都是**采样时点快照**，不是恒定事实；
   若不标时刻，两份都是「对的」却互相矛盾。这直接呼应 99 号「口径冲突」的根因，但这次是**运行时状态**而非文档。**等级 D**。

4. **`daemon-reload` 其实没有任何直接日志证据**：`journalctl -u systemd | grep reload` 0 命中，
   `journalctl -u dsh-web.service` 只有 crontab 行。能证明「配置已生效」的是 `NeedDaemonReload=no`
   + `DropInPaths` + 进程 env + 13:51 重启这四个**间接**事实。25 §2:42「每次改动后均 daemon-reload」
   是自述，不是可复核的 D 级证据。**等级 D + E**。

5. **「`Authorization: Bearer` 命中」是假阳性、「`/tmp/*.cookies` 的 644」才是真风险**：
   md 里 6 处 `Bearer public` 是 OpenCode Zen 匿名 lane 的**公开字面量**，不是密钥；
   全库 md 确实 0 泄漏。但 8 个 `/tmp/*.cookies`（mode 644）各含一个 `v1.<JWT>` 会话令牌，
   同机 `ova`/`dsh`/`root` 多用户可读 —— 真正的清理对象在 `/tmp`，不在报告里。**等级 D**。

**附加反直觉（第 6 条，免费）**：`dsh-web.log` 里除「1 entry did not activate」外还有
`ExperimentalWarning: SQLite` 与 `[cline] models.dev 目录拉取失败…timeout` 两条告警，
**25/36/99 三份运维向报告全部只登记了第一条**。后者可能正是 25 §5:81「1091 出口抖动」的另一副面孔（E）。**等级 A/D + E**。

---

## 6. 取证命令索引（可复现，全部只读）

```sh
# §1 systemd
cat /etc/systemd/system/dsh-web.service.d/10-websearch-lead-fix.conf
systemctl show dsh-web.service -p Environment -p MainPID -p ActiveState -p DropInPaths -p NeedDaemonReload -p ExecMainStartTimestamp
tr '\0' '\n' < /proc/262230/environ | grep -iE 'proxy|DSH_WEB_FETCH|DSH_EGRESS'
grep -n 'Environment\|ExecStart' /etc/systemd/system/dsh-web.service
grep -nE 'HTTP_PROXY|HTTPS_PROXY|proxy' /usr/local/sbin/dsh-web-run-native.sh
stat -c '%y %n' /usr/local/sbin/dsh-web-run-native.sh /etc/systemd/system/dsh-web.service.d/10-websearch-lead-fix.conf

# §2 回滚
ls -la .artifacts/websearch-research/src-work/backups/
for f in lib/util/egress-fetch.js lib/util/mcp-client.js lib/index.js lib/client.js lib/provider.js \
         lib/backends/firecrawl.js lib/backends/tinyfish.js tests/lead-20261106.test.js tests/lead-20261107.test.js; do
  md5sum "/home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/$f" \
         ".artifacts/websearch-research/src-work/plugin/$f"; done
diff -u .artifacts/websearch-research/src-work/backups/profile-cordis.patch.yml.orig \
        /home/dsh/.dsh/profiles/web/cordis.patch.yml
sed -n '83,101p' .artifacts/websearch-research/25-execution-log.md

# §3 升级
cat /home/dsh/.dsh/profiles/web/package.json; sed -n '10,15p' /home/dsh/.dsh/profiles/web/pnpm-lock.yaml
sed -n '55,68p' /home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/package.json

# §5 密钥（值级）
grep -rnIiE 'cfut_[A-Za-z0-9_-]{10,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|<本机口令脱敏>|<HK口令脱敏>|gptreg-mail-[A-Za-z0-9]{10,}' --include='*.md' .
grep -n 'token=' /home/ova/re-agent/dsh-web.log | sed -E 's/token=[A-Za-z0-9._-]+/token=<REDACTED>/g'
for f in /tmp/*.cookies; do stat -c '%a %n' "$f"; done

# §6 i18n / 测试（脚本见正文 §6.1，深度键提取 + t()/bind() 引用收集）
cd .artifacts/websearch-research/src-work/plugin && node --test tests/lead-20261106.test.js tests/lead-20261107.test.js

# §7 告警
sed -E 's/token=[A-Za-z0-9._-]+/token=<REDACTED>/g' /home/ova/re-agent/dsh-web.log
node -e "try{require.resolve('yaml',{paths:['/opt/dsh-plugins/dsh-purge-community']})}catch(e){console.log(e.code)}"

# §4 认证只读探测（token 只在 shell 变量，不落输出）
T=$(grep -oE 'token=[A-Za-z0-9_-]+' /home/ova/re-agent/dsh-web.log | tail -1 | cut -d= -f2)
C=/tmp/opsB.cookies; curl -sS -L -c "$C" -b "$C" -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:3080/?token=$T"
curl -sS -b "$C" http://127.0.0.1:3080/api/unified-search/settings
curl -sS -b "$C" http://127.0.0.1:3080/api/unified-search/health
```

---

**本报告无凭证值写入；未改任何源码/配置/其它报告；未重启、未回滚、未操作任务板。**
**与 `32-adversarial-ops.md`（审查 C）互不覆盖；若其落盘，请以 Lead 的 37 号汇总骨架做交叉裁决。**
