# 75 · E3 独立评估：运行时与环境韧性 — 下一步该做的

> 角色：独立评估专家 E3（运行时 / 环境韧性）；独立取证，不引用他人结论。
> 取证窗口：2026-11-15 13:45–14:08 +08:00（真实工具/API/shell 实跑）。
> 约束遵守：**唯一写文件＝本文件**；未改源码/配置/运行时/其它报告；未操作任务板；未重启服务；未写 credentials；token/cookie/JWT 值全程脱敏。
> 取证方式：skill catalog 中无与本「运行时取证 + 环境加固评估」直接匹配的技能（dsh-* 系列面向代码/文档/PR 评审，webapp-testing 面向浏览器前端），按规则采用 shell / web 工具 / 文件只读直接取证。

**题给基线**：服务 active PID 3207503（11-14 22:28:58 启动），runtime `/opt/dsh-0222`（node24），cmdline `/opt/node24/bin/node /opt/dsh-0222/node_modules/@deepseek-ai/dsh/lib/bin.js web --no-open --host 127.0.0.1 --port 3080 --trusted-host 192.168.1.7 ...`（无 `--patch`）；`DSH_HOME=/home/dsh/.dsh`、三 env 保持；GUI 401→认证 200；35/35 文件一致、73/73 单测。
**关键背景**：11-12 第三次 runtime 切换致 `src-work/plugin/node_modules/@deepseek-ai/` 下 6 个 test-only symlink 全悬空（指向已不存在的 `/usr/local/lib/node_modules/@deepseek-ai/dsh/...`），`node --test` 从 73/73 掉到 41/49（8 fail，`ERR_MODULE_NOT_FOUND @deepseek-ai/dsh-web`）；重建到 `/opt/dsh-0222/node_modules/@deepseek-ai/*` 后恢复 73/73。

---

## A. 逐项探测表（命令 / 真实输出 / 判定）

### A.1 真实工具复跑 + 遥测

| # | 命令 | 真实输出（摘要） | 判定 |
| --- | --- | --- | --- |
| 1 | `web_fetch("https://example.com")` | `Fetched https://example.com/ (HTTP 200)`；body `Example Domain` + "This domain is for use in documentation examples…" | ✅ 200，fetch provider 正常 |
| 2 | `web_search` 查询组 ①（2×不同查询：`"systemd systemctl show MainPID ExecStart service reload"` / `"websearch telemetry history settings unified-search"`） | 合并遥测两行：`searxng ✗3944ms (SearXNG: invalid JSON response) · exa ✓4269ms/8 · parallel ✓5395ms/8 · firecrawl ✗5396ms (firecrawl returned an MCP error: Anonymo…) · tinyfish ✓5400ms/8 · ddg ✓6236ms/8`；第二行 `exa ✓3397ms/8 · searxng ✗4066ms · parallel ✓5124ms/8 · firecrawl ✗5396ms · ddg ✓6667ms/8 · tinyfish ✓7765ms/8`；8 Sources（systemctl / CHANGELOG 等） | ✅ 有真实遥测；6 启用后端中 4 ✓ / 2 ✗ |
| 3 | `web_search` 查询组 ②（2×不同查询：`"DeepSeek Harness dsh web runtime health check"` / `"node --test ERR_MODULE_NOT_FOUND symlink dangling workspace"`） | 第一行 `exa ✓3807ms/8 · searxng ✗4138ms · ddg ✓5433ms/8 · parallel ✓5504ms/8 · tinyfish ✓6786ms/8 · firecrawl ⏸cooled 58s`；第二行 `exa ✓3806ms/8 · searxng ✗4135ms · ddg ✓5440ms/8 · tinyfish ✓5441ms/8 · parallel ✓5447ms/8 · firecrawl ⏸cooled 58s`；8 Sources | ✅ 两组不同查询均落库；`⏸cooled` 证明熔断冷却在运行态生效 |
| 4 | 认证 cookie → `GET /api/websearch/history` 查我方 query | 4 条全部 `HIT`：`systemd systemctl show…` / `websearch telemetry…` / `DeepSeek Harness dsh web runtime health check` / `node --test ERR_MODULE_NOT_FOUND…` | ✅ 遥测不是 mock，确由本进程写入 history |

### A.2 认证三 API（token/cookie 值严禁入报告）

| # | 命令 | 真实输出 | 判定 |
| --- | --- | --- | --- |
| 5 | `grep -oE 'token=…' /home/ova/re-agent/dsh-web.log \| tail -1` | 命中 1 行（`dsh web: http://127.0.0.1:3080/?token=…`）；token 长度 43（值脱敏） | ✅ 取到 |
| 6 | `curl -D - "http://127.0.0.1:3080/?token=…"` | `HTTP/1.1 303 See Other`；`location: ./`；`set-cookie: dsh-auth-<hash>=v1.<jwt>; Max-Age=2592000; Path=/; Expires=Tue, 15 Dec 2026 05:51:06 GMT; HttpOnly; SameSite=Strict`（值 224 字符，脱敏） | ✅ 303 + HttpOnly/SameSite=Strict |
| 7 | `GET /api/unified-search/settings`（cookie + loopback Origin） | `200` `application/json`；`ok:true, namespace:dsh-websearch, writable:true, applies:"live", revision:0`；`user={numResults:8, enableFirecrawl:true, enableTinyfish:true}`；`value` 与 `base` 仅差 `enableFirecrawl/enableTinyfish`；`enabledBackends:[]`；13 后端开关 + `deepseekModel:deepseek-v4-flash` | ✅ 200；user 层非空（与 02:207 旧口径不同） |
| 8 | `GET /api/unified-search/health` | `200`；`ok:true, enabled:6, keyless:6, requestedMaxResults:8, updatedAt:1794721921072`；`backends[13]`，每条含 `rateLimited/keylessRejected/cooledUntilMs/reachable/lastOk/lastError` | ✅ 200；6 启用（exa/parallel/ddg/searxng/firecrawl/tinyfish） |
| 9 | `GET /api/websearch/history` | `200`；`ok:true, entries[50]（环形上限已饱和）, backends[6]`；entries 含 `query/time/resultCount/backendsOk/backendsTotal`；backends 含 `at/cooled/cooledUntilMs/failCount/id/keylessRejected/ms/ok/rateLimited` | ✅ 200；磁盘 `/home/dsh/.dsh/cache/websearch/history.json` 8814B / 50 条，与 HTTP 一致 |

### A.3 fence（未授权 401 / 跨站 403；未真 clear）

| # | 命令 | 真实输出 | 判定 |
| --- | --- | --- | --- |
| 10 | 无 cookie 直连 `GET /`、`/api/unified-search/{settings,health}`、`/api/websearch/history` | 全部 `401` | ✅ 未授权围栏 |
| 11 | 带 cookie + `Origin: https://evil.example.com` 打三 API | 全部 `403 {"ok":false,"error":"untrusted request"}` | ✅ 跨站围栏（Origin 维） |
| 12 | 带 cookie + `Host: evil.example.com` 打 health | `403 {"ok":false,"error":"untrusted request"}` | ✅ 跨站围栏（Host 维） |
| 13 | 仅 query token、无 cookie 打 health | `401 {"ok":false,"error":"untrusted request"}` | ✅ query token 不足以过 fence |
| 14 | 带 cookie + `Origin: http://127.0.0.1:3080` 打 settings | `200` | ✅ 基线对照 |
| 15 | `POST /api/websearch/history/clear`（未授权，仅取码，**未执行 clear 动作**） | `401` | ✅ 不真 clear，写端点同样受围栏 |

### A.4 D8 新字段是否仍有值（运行态实证）

| # | 字段 | 真实值 | 判定 |
| --- | --- | --- | --- |
| 16 | `health.requestedMaxResults` | `8` | ✅ 有值 |
| 17 | `health.backends[*].rateLimited` | firecrawl `true`，其余 `false`；13/13 条齐全 | ✅ 有值 |
| 18 | `health.backends[*].keylessRejected` | firecrawl `true`，其余 `false`；13/13 条齐全 | ✅ 有值 |
| 19 | `health.backends[*].cooledUntilMs` | searxng `1794721889769`、firecrawl `1794721890492`，其余 `null`；13/13 条齐全 | ✅ 有值（但见 N7：是历史时刻） |
| 20 | `history.backends[*]` 三字段 | 6/6 条含 `rateLimited/keylessRejected/cooledUntilMs`；firecrawl `rateLimited=true,keylessRejected=true,cooledUntilMs=1794721890492,failCount=4` | ✅ 有值，旧键 `at/cooled/failCount/ms/ok/id` 全保留、无 apiKey 泄漏 |
| 21 | 时间戳解码 | `1794721828322`→13:50:28、`1794721831736`→13:50:31、`1794721921072`→13:52:01（+08） | ✅ 与我方 13:48–13:52 的 web_search 时刻吻合 |

### A.5 运行态 / 文件 / 测试（独立复跑，非引用）

| # | 命令 | 真实输出 | 判定 |
| --- | --- | --- | --- |
| 22 | `systemctl is-active dsh-web.service` | `active`；`MainPID=3207503`；`ActiveEnterTimestamp=Sat 2026-11-14 22:29:12 CST` | ✅ active（systemd 记 22:29:12，题给 22:28:58 为进程启动，差 14s） |
| 23 | `tr '\0' ' ' < /proc/3207503/cmdline` | 逐字 `/opt/node24/bin/node /opt/dsh-0222/node_modules/@deepseek-ai/dsh/lib/bin.js web --no-open --host 127.0.0.1 --port 3080 --trusted-host 192.168.1.7 --trusted-host dsh.sepic.space` | ✅ 与题给一致；**两个** `--trusted-host`；无 `--patch` |
| 24 | `tr '\0' '\n' < /proc/3207503/environ` | `DSH_HOME=/home/dsh/.dsh`、`HOME=/home/dsh`、`PATH=/opt/node24/bin:…`、`DSH_WEB_FETCH_PROVIDER=http`、`HTTP_PROXY=HTTPS_PROXY=http://172.30.66.1:1091`、`NO_PROXY/no_proxy`、`DSH_EGRESS_FORWARDER`、`DSH_PERMISSION_MODE`、`DSH_WEB_STATIC_TOKEN`（脱敏） | ✅ 三 env 保持；`/etc/systemd/system/dsh-web.service.d/10-websearch-lead-fix.conf` 在位（3 行 Environment） |
| 25 | `plugin_manager list_plugins`（分页 200+） | `include:dsh-websearch → @240xu/dsh-websearch enabled=true fiberPhase=active` | ✅ 实时插件态 |
| 26 | `diff -rq src-work/plugin $P \| grep -vE 'node_modules\|lock\|\.tgz'` | `0` 行差异 | ✅ 35/35 文件一致（独立复验） |
| 27 | `cd src-work/plugin && node --test tests/*.test.js` | `ℹ tests 73 / pass 73 / fail 0 / duration_ms 558.118585`；`exit=0` | ✅ 73/73 真实实跑（未引用报告） |
| 28 | 8 个测试文件写盘审计 | 唯一写操作 `lead-20261107.test.js:22` `process.env.DSH_HOME = mkdtempSync(join(tmpdir(), "lead-settings-"))`；无 `writeFile/appendFile/unlink` 指向生产路径 | ✅ 跑测试不污染运行时/credentials |
| 29 | 6 symlink 健康 | `cordis / dsh-credentials / dsh-launch-environment / dsh-settings / dsh-web / schemastery` 全 `OK`，`readlink -f` 指向 `/opt/dsh-0222/node_modules/@deepseek-ai/*` 且目标存在；`require.resolve` 6/6 `OK` | ✅ 当前健康（韧性另见 B） |
| 30 | `ls -ld /usr/local/lib/node_modules/@deepseek-ai` | `No such file or directory`（旧悬空目标仍不存在） | ✅ 印证旧故障根因 |
| 31 | launcher `stat + sed` | mtime `2026-11-11 21:26:22`、`663 bytes`；`exec /opt/node24/bin/node /opt/dsh-0222/.../bin.js web --no-open --host 127.0.0.1 --port 3080 --trusted-host 192.168.1.7 --trusted-host dsh.sepic.space`；无 proxy 行、无 `--patch` | ✅ 与 71:12 记录逐字一致 → **11-14 重启不是第四次切换** |
| 32 | `hostname -I` / `ip -4 -o addr` | `wlp0s20f3 192.168.1.7/24` | ✅ `--trusted-host .7` 与当前 LAN IP 匹配 |
| 33 | `grep proxy llm.env / web-auth.env` | 0 命中（两文件无 proxy/fetch-provider 行）；`systemctl show -p Environment` 主单元只有 HOME/DSH_HOME/PATH | ✅ 3 个 env 全部来自 drop-in（影响 §6 4b 判定，见 C/N3） |

---

## B. 测试脚手架韧性 + symlink 加固方案

### B.1 当前状态（健康，但脆）
6 个 symlink 全部是**绝对路径硬绑定** `/opt/dsh-0222/node_modules/@deepseek-ai/<pkg>`，mtime 均为 `Nov 12 23:37`（11-12 人工重建）。这是三次 runtime 路径迁移后的第三个落点：
`/usr/local/lib/node_modules/@deepseek-ai/dsh/` → `/home/dsh/.dsh-exp022/runtime/` → `/opt/dsh-0222/`。
每次切换只改 launcher / runtime，不改这 6 个 symlink ⇒ 必然悬空。本次已确认旧目标仍不存在、新目标全存在、73/73 通过，但**健康是时点态，不是韧性**。

配套缺口：`src-work/plugin/README.md:237` 只写 `node --test tests/`、`:240` 写「v2.7.0 起 76+ tests pass」，**没有一句说明裸跑需 6 个 host 注入包、也没有生成命令**；`25-execution-log.md:25` 仅一句「请在 `src-work/plugin/` 用测试专用 symlink 跑」，无路径、无脚本、无验收。

### B.2 可 apply 的最小加固步骤（不执行；本任务唯一写文件是本报告；不改生产代码、不提交）

**步骤 0 · 动态推导 scope（两条路径本轮实测都得同一结果 `/opt/dsh-0222/node_modules/@deepseek-ai`）：**
```bash
# 主路径：以「正在跑的服务」为准，不用 which dsh（which 可能指向另一套安装）
PID=$(systemctl show -p MainPID --value dsh-web.service)
BIN=$(tr '\0' '\n' < /proc/"$PID"/cmdline | grep -E '/@deepseek-ai/dsh/lib/bin\.js$' | head -1)
SCOPE=$(dirname "$(dirname "$(dirname "$BIN")")")      # → <runtime>/node_modules/@deepseek-ai
# fallback（无服务时）：SCOPE=$(dirname "$(dirname "$(dirname "$(readlink -f "$(command -v dsh)")")")")
```
**步骤 1 · 幂等重建 6 个链接：**
```bash
cd /home/ova/dsh/.artifacts/websearch-research/src-work/plugin
mkdir -p node_modules/@deepseek-ai
for m in cordis dsh-credentials dsh-launch-environment dsh-settings dsh-web schemastery; do
  test -d "$SCOPE/$m" || { echo "MISSING $SCOPE/$m" >&2; exit 1; }
  ln -sfn "$SCOPE/$m" "node_modules/@deepseek-ai/$m"
done
```
**步骤 2 · 把依赖声明进测试 README**（`src-work/plugin/tests/README.md` 或主 README §测试，新增一节）：列出 6 个包名、说明它们来自 DSH host 而非 npm、贴步骤 0–1、写明「安装 `lib/` 保持纯净，这些链接只存在于 `src-work/plugin/node_modules/`」。

**步骤 3 · 可选：把 `npm test` / CI 入口包一层** `pretest` 钩子调用步骤 0–1（仅改测试脚手架，不碰生产 `lib/`）。

### B.3 验收命令
```bash
# a) 零悬空
for m in cordis dsh-credentials dsh-launch-environment dsh-settings dsh-web schemastery; do
  test -e "$(readlink -f node_modules/@deepseek-ai/$m)" || echo "DANGLE $m"
done
# b) 模块可解析（6/6 OK）
node -e "for (const m of ['@deepseek-ai/dsh-web','@deepseek-ai/cordis','@deepseek-ai/dsh-settings','@deepseek-ai/dsh-credentials','@deepseek-ai/dsh-launch-environment','@deepseek-ai/schemastery']) console.log(m, require.resolve(m))"
# c) 全量单测
cd /home/ova/dsh/.artifacts/websearch-research/src-work/plugin && node --test tests/*.test.js
#   期望 tests 73 / pass 73 / fail 0 / exit 0
# d) 切换演练（只读推导，不真切）：把 SCOPE 换成任意新 runtime 路径，确认 6 个包都在，再跑 a–c
#   期望无 ERR_MODULE_NOT_FOUND @deepseek-ai/dsh-web
```
**取舍**：主路径用 `MainPID` 而非 `which dsh`——服务是 systemd 独立进程，shell 的 `dsh` 未必同 runtime；本轮两者恰好一致，但不能当作保证。

---

## C. 回滚链在「新 runtime」下核对（25 §6，只读）

| 项 | 25 §6 位置 | 本轮只读实测 | 判定 |
| --- | --- | --- | --- |
| 23 cp | `:98–120` | 逐行 23 条；备份目录 `26` 个 `*.orig`（26 含 3 个 profile/包级，链内 23） | ✅ 数量与清单一致 |
| 12 rm | `:123–134` | 12 个路径逐一 `test -e` → **12/12 present** | ✅ 可删、无遗漏 |
| md5 验证环 | `:142–150` | `diff -rq` = 0 差异，23 对可比 | ✅ 当前可验（未执行 cp） |
| REMOVED 环 | `:151–158` | 期望「12 行 REMOVED」与 12 rm 对齐 | ✅ 自洽 |
| 4b MainPID 步 | `:164–168` | `systemctl show -p MainPID --value dsh-web.service` → `3207503`；`/proc/3207503/environ` 可读 | ✅ 与当前 cmdline 一致；用 PID 不用 pgrep 的结论仍成立（现 cmdline 无字面 `dsh web --patch`） |
| 4b「期望无输出」 | `:166–168` | grep 的三个 env 全部来自 drop-in；`llm.env`/`web-auth.env`/主单元 `Environment` **0 命中** | ⚠️ 当前成立，但属隐式依赖（见 N3） |
| 前提 1 | `:88` | cmdline 逐字 `/opt/dsh-0222/.../bin.js web --no-open…` 无 `--patch`；`plugin_manager` 实时 `enabled=true fiberPhase=active` | ✅ 一致（但同段「此前 11-09 21:25」与 `:90`/71:8 的「20:17」矛盾，见 N5） |
| 前提 2 | `:89` + `71:16` | 「全系统只剩一套」**被推翻**：第二套 = `/home/dsh/.dsh/dsh-purge-community/install-recovery/2026-11-11T08-35-08-200Z-dba1431d/failed-node_modules/@240xu/dsh-websearch`（46 文件，mtime 2026-11-06 13:45，含 lead-2026110x 测试）。`/proc/3207503/{maps,fd,cmdline,environ}` 对该路径 **0 引用**；`plugin_manager` 的 active 副本是 `$P` | ⚠️ 措辞过时；**「$P 是运行时实际加载的副本」结论仍成立**，回滚链不必改 `$P`（见 N2） |
| 前提 3 | `:90` + `:182–185` | launcher mtime `11-11 21:26:22` / 663B；`.bak-direct-20261106T111430Z` 存在且确为 `PATH=/opt/node22/bin` + `exec /usr/local/bin/dsh web --patch …` `.165` | ✅ 一致；可选回退确实会退回 node22（默认不执行是对的） |
| 可选步 / 清理说明 | `:180–187` | 两次重写、`systemctl show -p MainPID` 为唯一权威链 | ✅ 一致 |
| 功能验证预期 | `:169–171` | 当前 `web_fetch` 200、`web_search` 4–5/6 成功 ⇒ 回滚后重现基线故障属预期 | ✅ 逻辑自洽（未执行） |

**结论：25 §6 在新 runtime（`/opt/dsh-0222`、无 `--patch`、PID 3207503）下仍可执行**，23 cp + 12 rm + 4b 步与当前 cmdline/文件系统全部对齐；唯一需修的是**前提 2 的事实措辞**（非结构）。

### C.2 仍过时的表述清单（文件:行号）

**「需改」类（事实失实 / 权威载体当前态错误）**
| 位置 | 过时内容 | 本轮实测 |
| --- | --- | --- |
| `25-execution-log.md:89` | 「全系统只剩**一套** `@240xu/dsh-websearch` 安装」 | 两套；第二套在 `install-recovery/…/failed-node_modules/`（未被加载） |
| `71-goal-runtime-switch.md:16` | 「全系统 `find` 只剩**一套**」 | 同上 |
| `25-execution-log.md:88` | 「此前 **11-09 21:25** 为 exp022 …」 | 与 `:90`、`71:8` 的「11-09 20:17」内部矛盾（差 1h08，笔误） |
| `02-runtime-state.md:106` | `--trusted-host` 额外信任 `192.168.1.165` | 现为 `192.168.1.7`（`hostname -I` 实测） |
| `02-runtime-state.md:205–207` | 「运行时确实只有 **4 个** keyless 后端启用」/「history **6 条**」/「`user` 层为**空对象**」/「当前进程**全部失败**」 | `enabled=6`、`history=50`、`user` 3 键、4–5/6 后端 ✓；这三行措辞是「实测/当前进程」，无时点标记，最易误读 |
| `25-execution-log.md:198` | 「`node --test` 输出 **8/8**」 | 8 是测试**文件数**；用例数为 73/73（62:148 已指出，仍未改） |
| `REPORT.md:20` | 「服务 23:06 重启（**PID 170703**）」 | 现 PID 3207503、11-14 22:29；REPORT 是权威载体，头部需补当前态 |

**「按 99:3 保留快照」类（`99-final-verdicts.md:3` 明定「旧正文保留为过程记录、未逐行改写；冲突以 99/REPORT 为准」）**
| 位置 | 内容 | 处理 |
| --- | --- | --- |
| `25-execution-log.md:53/227/260/303/363/430/469/554` | `MainPID=2261219 / 2097 / 196024 / 240813 / 262230 / 347337 / 587384` 等历史重启 PID | 加「11-0x 时点快照」标记，勿删 |
| `69:4`、`71:9`、`72:21` | PID `170703`（11-11 23:06 重启） | 快照保留；REPORT 头部另补当前态 |
| `01:724`、`02:27/92/436`、`09c:377`、`21:184`、`22:146`、`30-b:16`、`32-b:26`、`35:135`、`55:27`、`63:15`、`67:18` | 旧 cmdline 含 `--patch /opt/dsh-plugins/lan-trust.patch.yml` + `.165` | 当时的 `[D]` 取证，保留 + 时点标记 |
| `45:198`、`49:48`、`50:41`、`25:555` | `43/43 单测`、`23/23 文件`、`16 备份`、`50 份 md / 18028 行` | 历史快照，保留 |
| `58:84`、`59:11/15`、`60:8`、`56:119` | `56/56`、`60/60`、`34/34` | 历史快照（含并发漂移记录），保留 |
| `64:47`「68 份 md / 22376 行」、`72:34`「76 份 md」 | 份数写死 | 按 99:3 动态口径（`62:12` 已把 `REPORT:6` 改为「以 `ls *.md|wc -l` 为准」✅）保留为时点值 |
| `76:22/51/158` | `MainPID=3207503`、`73/73`、`35/35`、`26` | ✅ **当前仍正确，无需改**（P1 同轮报告） |

---

## D. 报告库口径一致性（76→实测 79+ 份 md）

`ls *.md | wc -l` 本轮 13:45 = **79**（编号 77 份 + `REPORT.md` + `_SKELETON.md`）；14:05 观测到兄弟代理又新增 `77-upstream-publish-status.md` / `78-upstream-first-push.md`、改写 `67` / `76` ⇒ 任务书「76 份」是 11-12 时点值，按 99:3 属移动靶。

| 维度 | 旧口径（出现处） | 本轮实测当前值 | 归类 |
| --- | --- | --- | --- |
| PID | `170703`(69:4/71:9/72:21/REPORT:20)、`2432384`/`2731223`（**全库 0 命中**）、`3207503`(76:22/51/158)、另有 `2200/2085/262230/347337/587384/2334/2339/240813/2261219/2097/196024/2512598/3751811` | **3207503**（active, 11-14 22:29:12） | 170703 等历史值 → 快照；2432384/2731223 已无痕迹；3207503 → 当前正确 |
| 单测数 | `8/8`(25:198 口径错)、`18/18`、`25/25`、`41/49`(故障态)、`43/43`、`56/56`、`60/60`、`64/64`、`66` | **73/73**（`node --test` 实跑） | 除 76/72 的 73 外全部快照 |
| 文件数 | `10/10`、`17/17`、`23/23`、`34/34`、`35/35` | **35/35**（`diff -rq` = 0） | 35/35 当前正确（56:119/58:70/62:31/72:30）；23/34/17/10 快照 |
| 备份数 | `8 / 13 / 16 / 26` | **26** `*.orig` | 26 当前正确 |
| md 份数 | `50 / 68 / 76` | **79+**（并发增长） | 全部快照，按 `ls|wc -l` 动态口径 |
| health 后端数 | `4 keyless`（02:205） | **6 / 6 keyless** | 02 §5 需改或标时点（见 C.2） |
| history 条数 | `6 条`（02:206） | **50 条（环形饱和）** | 同上 |
| settings.user | `{}`（02:207） | **3 键** | 同上 |
| trusted-host | `.165`（02:106 等 12 处） | **.7** | 02:106 需改；其余 cmdline 引用属快照 |

---

## E. 新缺陷 / 已确认无误 / 无法验证 / 5 条反直觉

### E.1 新缺陷（仅运行时/环境能暴露；按优先级）

| ID | 级别 | 缺陷 | 证据 | 最小处置 |
| --- | --- | --- | --- | --- |
| **N1** | **P1** | **6 个 test-only symlink 仍是绝对路径硬绑 `/opt/dsh-0222`，无再生机制、无 README 声明** ⇒ 第四次 runtime 切换必然复现 11-12 的 41/49 | A#29/30/31；旧目标仍不存在；README:237/240 无依赖说明；25:25 仅一句 | 按 B 落动态生成脚本 + 测试 README 声明 + 4 条验收命令；不碰生产 `lib/` |
| **N2** | P2 | 25:89 / 71:16「全系统只剩一套」被 `install-recovery/…/failed-node_modules/@240xu/dsh-websearch` 推翻（46 文件） | C 前提 2；`find` + `/proc/3207503/{maps,fd,environ}` 0 引用 + `plugin_manager` active=$P | 措辞改为「两套，仅 `$P` 在解析链上被加载；另一套为 11-11 安装失败 recovery 快照」；`$P` 与回滚链不变 |
| **N3** | P2 | §6 4b「期望无输出」隐含依赖 `llm.env`/`web-auth.env`/主单元**不含**那 3 个 env；launcher 会 `. ` 这两个文件，将来任一被补 proxy 行 → 4b 假红 | A#33；drop-in 3 行是唯一来源 | 在 4b 注释补一句「若 env 文件另有同名变量，改比对 `systemctl show -p Environment` 与 `/proc/$PID/environ` 的差集」 |
| **N4** | P2 | `02-runtime-state.md:205–207` 的运行时表仍是 11-04 口径且用「实测/当前进程」措辞 | A#7/8/9 对照 | 加「11-04 快照」框并指向本报告/72；或更新为 6/50/3 键 |
| **N5** | P3 | 25:88「11-09 21:25」与 25:90、71:8「11-09 20:17」内部时间矛盾 | C 前提 1 | 统一为 20:17 |
| **N6** | P3 | history 环形 50 条**已饱和**，我的 4 次 web_search 已把更早记录挤出环；「累计 failCount」「6 条历史」类结论不可作全量审计轨迹 | A#9；磁盘 8814B/50 条 | 报告里凡引 history 计数须标「最近 N 次窗口」；需要全量则另存 session log |
| **N7** | P3 | D8 的 `cooledUntilMs` 是**过去时刻的绝对 epoch**，无「是否已过期」派生字段：14:05 观测时 firecrawl/searxng 的冷却戳已是 14 分钟前，`rateLimited/keylessRejected` 仍 `true`、`history.cooled` 仍 `false`、`health.updatedAt` 停在 825s 前 | A#16–21 + 14:05 复算；`health.js` 「从不主动探测」设计 | 这是设计取舍（配额安全）；建议 health 增一个 `nowMs`/`cooledActive` 派生布尔，否则值班读表会把化石当实时熔断态 |

### E.2 已确认无误
- 服务 `active`、`MainPID=3207503`、cmdline 与题给逐字一致（两个 `--trusted-host`、无 `--patch`）、systemd 启动 11-14 22:29:12。
- 三 env 保持 + drop-in 在位 + `DSH_WEB_FETCH_PROVIDER=http`；`node -v` = `v24.22.2`。
- `web_fetch` 200；两组不同 `web_search` 均产真实遥测（4–5/6 后端 ✓），4 条 query 落 history。
- 认证 303→`dsh-auth-*` cookie；三 API 全 200；fence 401（未授权）/403（跨站 Origin、跨站 Host、query-token-only）齐全；clear 未真调。
- D8 新字段（health 顶层 + 13 后端 + history 6 后端）**全部有值**，旧键保留、无凭证泄漏。
- 6 symlink 全健康；`node --test tests/*.test.js` 真实 **73/73 pass 0 fail**；35/35 文件 `diff -rq` = 0；26 `*.orig`；12 新增全在。
- 25 §6 的 23 cp + 12 rm + 4b `MainPID` 步与当前 cmdline/文件系统一致，**回滚链可执行**；前提 3（launcher 两次重写 / node22 备份）一致；11-14 重启未引入第四次切换。
- `plugin_manager` 实时 `include:dsh-websearch enabled=true fiberPhase=active`；`--trusted-host .7` 与当前 LAN IP 一致。
- 全程未写 credentials、未重启服务、未改源码/配置/其它报告/任务板；`git status` 中的大量改动为兄弟会话既有，与本评估无关。

### E.3 无法验证（受「不重启 / 不写 / 不切 runtime」约束）
- 不重启 ⇒ 无法验证「重启后 symlink / 3 env / D8 字段 / history 仍保持」的持久性，只能证明当前进程态。
- 不真 clear ⇒ `POST /history/clear` 授权后行为与环形重置未验证（仅取未授权 401）。
- 不切 runtime ⇒ B 的动态方案只做了**只读推导**（`MainPID` 与 `which dsh` 两条路径都得 `/opt/dsh-0222/node_modules/@deepseek-ai`），未实跑第四次切换演练。
- 未执行 §6 回滚 ⇒ 23 对 md5、12 行 REMOVED、回滚后基线故障只做了只读核对。
- 跨站只测 GET；`POST /api/unified-search/settings` / 授权后 `POST /clear` 的 fence 未测（避免写用户数据）。
- recovery 第二套副本是否曾在历史某刻被加载，只有当前 `/proc` 快照，无法回溯。
- 报告库在取证窗口内被兄弟代理并发改写（67/76/77/78 mtime 变化），全库精确计数/行数是移动靶；本轮数字以 13:45 与 14:05 两次采样为准。

### E.4 5 条反直觉
1. **11-14 22:28 的重启不是第四次 runtime 切换**：launcher mtime 仍 `11-11 21:26:22`、663B、cmdline 与 71:12 逐字相同。PID 从 170703 变 3207503 只是同配置重启 —— 只看 PID 漂移会把「进程换皮」误判成「环境演进」。
2. **「全系统只剩一套」在 11-12 之后不再成立，但回滚结论反而仍成立**：第二套藏在 `dsh-purge-community/install-recovery/…/failed-node_modules/`（11-11 安装失败的 recovery，46 文件含全部 lead-2026110x 测试），`find` 能找到，`/proc/3207503/{maps,fd,cmdline,environ}` 却 0 引用 ⇒ **「存在」≠「被解析」**；`$P` 仍是唯一 active 副本。
3. **`settings.user` 非空却 `revision:0` 且 `applies:"live"`**：用户层 3 个键（`numResults` + 两个 `true`）不推动 revision（volatile settings service 语义），而 `enabled=6` 正是这两个 `true` 驱动的；02:207「`user:{}` ⇒ 无自定义」的旧推论链已失效。
4. **history 的「6 条」「failCount 25/26」不是全量历史，是当时环形窗口**：现在恰 50 条（上限饱和），我这次 4 次 `web_search` 已进环并挤掉更早记录；任何「累计失败次数」结论都会被环形覆盖抹掉。
5. **D8 新字段「有值」≠「实时」**：`cooledUntilMs` 是 14 分钟前的绝对时间戳，`health.updatedAt` 停在 825s 前，因为 health 路由**从不主动探测**（配额安全）；只有下一次 `web_search` 才刷新。运行时读到的熔断态其实是上次扇出的化石 —— 这是纯运行态才能暴露的观测陷阱。

---

## 结论与优先级（A/B/C/D/E 汇总）

| 序 | 结论 | 优先级 |
| --- | --- | --- |
| **A** | 运行态**全绿**：真实工具（fetch 200 + 2 组不同 query 的 search 遥测）、认证三 API 200、fence 401/403 齐全、D8 新字段全有值、6 symlink 健康、73/73 单测实跑、35/35 文件一致、插件 active。**未发现阻断性故障** | 现状 ✅ |
| **B** | **最该加固的一件事 = N1：把 6 个 test-only symlink 从绝对路径硬绑改成按 live `MainPID` 动态生成 + 写进测试 README + 4 条验收命令**。这是「三次切换必损一次」的唯一结构性根因，当前健康只是时点运气；改动面仅限 `src-work` 测试脚手架，不碰生产 `lib/`、不提交 | **P1 · 下一步首选** |
| **C** | 25 §6 回滚链在新 runtime 下**仍可执行**（23 cp + 12 rm + 4b MainPID 步全对齐）；需修的只有前提 2 的事实措辞（N2）+ 4b 隐式 env 依赖（N3）+ 一处时间笔误（N5），均不改链结构 | P2（文档） |
| **D** | 报告库按 99:3 分两类：「需改」= 25:89/71:16/25:88/02:106/02:205–207/25:198/REPORT:20；其余旧 PID、旧单测数（8/18/25/41/43/56/60/64/66）、旧文件数（10/17/23/34）、旧份数（50/68/76）一律**保留为时点快照**并加时点标记。当前正确口径：79+ md / 73/73 / 35/35 / 26 备份 / PID 3207503 | P2–P3 |
| **E** | 运行态专属新发现 7 条（N1–N7），其中 N6（环形饱和挤出取证）、N7（冷却戳是化石）只有活进程能观测；已确认无误 10 组；无法验证 7 项全部源于「不重启/不写」约束 | 记录 |

**给 Lead 的一句话**：当前运行态全绿、回滚链可原样执行；下一步只做一件事 —— 给 `src-work/plugin/node_modules/@deepseek-ai/` 的 6 个测试链接加「按 `systemctl show -p MainPID --value dsh-web.service` 推导 runtime scope 的幂等再生脚本 + README 声明」，把第三次切换的连带损伤变成第四次切换时的零损伤。

（本报告唯一写文件；无源码/配置/运行时/credentials 改动；无服务重启；token/cookie/JWT 值全程脱敏。）
