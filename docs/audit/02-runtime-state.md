# 02 — DSH 远端 / 运行时 web search 现状

> 调研时间：2026-11-04 16:35–16:46 (+08:00)
> 调研人：子代理 `runtime-state`
> 权限与范围：全程只读（ps / curl / ls / grep / read / glob / cordis_inspect_query），未修改任何配置或源码，未重启服务。
> 本报告**只写此一个文件**。报告内**不出现任何真实密钥、token、密码值**；一律只写引用名（如 `ZEN_API_KEY`、`DSH_WEB_STATIC_TOKEN`）。

---

## 0. 一句话结论（先给答案）

**当前这个 GUI（`http://127.0.0.1:3080`，PID 2200）里，LLM 调用 `web_search` 实际走的不是发布版自带的 `deepseek-official` provider，而是社区 bundle `@240xu/dsh-websearch@2.8.4` 注册的聚合 provider `unified`。** 该 provider 当前只启用 4 个 keyless 后端（exa / parallel / ddg / searxng），且**四个全部实时失败**（我本会话亲自复跑 + 实时 health 端点双重确认），因此**当前 `web_search` 事实上不可用**；**没有任何可用的搜索 API key 被配置或启用**（7 个 key-gated 后端开关全部为 `false`，`user` 设置层为空，进程环境里也没有对应 key 引用名）。

---

## 1. 运行时拓扑图

```
浏览器 (GUI, http://127.0.0.1:3080, 401 需鉴权)
   │  token=... → 303 → Set-Cookie: dsh-auth-<authority-hash>=v1.<jwt>
   ▼
┌──────────────────────────────────────────────────────────────────────┐
│ PID 2200 (dsh 用户, STARTED Wed Nov 4 07:52:06 2026, cwd /home/ova/dsh)│
│ node /usr/local/bin/dsh web                                          │
│   --patch /opt/dsh-plugins/lan-trust.patch.yml                       │
│   --no-open --host 127.0.0.1 --port 3080                             │
│   --trusted-host 192.168.1.165 --trusted-host dsh.sepic.space         │
│ stdout/stderr → /home/ova/re-agent/dsh-web.log                        │
│ env: DSH_HOME=/home/dsh/.dsh, HTTP(S)_PROXY 预设, DEEPSEEK_API_KEY    │
│      (仅键名; 仅 DSH_WEB_STATIC_TOKEN / DEEPSEEK_BASE_URL 相关键名)    │
└──────────────────────────────────────────────────────────────────────┘
   │  /usr/local/bin/dsh → ../lib/node_modules/@deepseek-ai/dsh/lib/bin.js
   │  = 发布版 npm 包 0.2.1-rc.2（root:root，只有 lib/ 与 lib/types/，无 yml）
   ▼
发布版 CLI 从 resolveDshHome() → $DSH_HOME=/home/dsh/.dsh
   → resolveProfileDir("web") = /home/dsh/.dsh/profiles/web
   → 按 package.json 的 dsh.profile.bundles 顺序叠加 patch 层：
        cordis.yml (空 [])
      → @deepseek-ai/dsh-base / dsh-web-app / ... 各 bundle 的 cordis.patch.yml
      → @240xu/dsh-websearch 的 bundle patch（见下）
      → 用户层 cordis.patch.yml (web, 398 行)
      → $DSH_HOME/cordis.patch.yml (无)
      → --patch /opt/dsh-plugins/lan-trust.patch.yml (仅插入 lan-trust)
   ▼
┌────────────────────────── 关键：web 能力缝的最终装配 ─────────────────┐
│ @deepseek-ai/dsh-base/cordis.patch.yml:467-489（ shipped 默认）         │
│   id: web        config: { searchProvider: deepseek-official,          │
│                           fetchProvider: http }                        │
│   id: web-search-deepseek   config: { apiKeyEnv: DEEPSEEK_API_KEY }    │
│   id: web-deepseek-api      config: { apiKeyEnv: DEEPSEEK_API_KEY }    │
│   id: web-fetch-http                                                    │
│   id: tool-web              config: { fetch: true,                     │
│                                       searchTimeoutMs: 60000 }        │
│ @deepseek-ai/dsh-web-app/cordis.patch.yml:579  → id: tool-web disabled │
│ web profile 用户 patch:381-385 → 重新声明 tool-web (fetch:true,        │
│                                   searchTimeoutMs:60000)，挂进 preset  │
│ @240xu/dsh-websearch/cordis.patch.yml:7-13（bundle 层，先于用户层）    │
│   insert id: dsh-websearch  name: '@240xu/dsh-websearch'               │
│   - id: web config: { searchProvider: unified }   ← 覆盖 base 默认值   │
│     （config 整体替换，不深合并 → base 的 fetchProvider: http 被丢掉）  │
└──────────────────────────────────────────────────────────────────────┘
   ▼
ctx.web (Service "web": registerSearchProvider / registerFetchProvider /
         search / fetch) —— host Service.listService 实测存在此 key
   ├─ SearchProvider id="deepseek-official"  (shipped, 注册了但被绕过)
   └─ SearchProvider id="unified"            ← 实际生效（配置唯一指定）
        由 @240xu/dsh-websearch apply(): ctx.web.registerSearchProvider(provider)
        扇出 4 个 keyless 后端（并发 6 / 单后端 30s，ddg/searxng 上限 5s）
          exa      https://mcp.exa.ai/mcp           (MCP, keyless)  → 403
          parallel https://search.parallel.ai/mcp   (MCP, keyless)  → 403
          ddg      https://html.duckduckgo.com/html/(HTML 抓取, keyless) → 301
          searxng  https://searx.be                (元搜索, keyless) → 非 JSON
        + 7 个 key-gated 后端（brave/tavily/serper/mojeek/deepseek/
          anthropic/openai）全部 enableXxx=false → 未进入候选
   ▼
tool-web 暴露给模型的工具：web_search / web_fetch
   （host Tool.listTools 实测两者都在当前 Agent 的工具目录中）
   web_fetch → ctx.web.fetch() → fetchProvider 未显式配置 → 单可用 provider
               自动回退（httpFetchProvider / deepseek-fetch-api 二选一）
```

---

## 2. 启动参数含义 & web vs headless profile 差异

### 2.1 完整命令行（复核）

```
ps -p 2200 -o pid,user,args=
2200 dsh node /usr/local/bin/dsh web --patch /opt/dsh-plugins/lan-trust.patch.yml \
  --no-open --host 127.0.0.1 --port 3080 \
  --trusted-host 192.168.1.165 --trusted-host dsh.sepic.space
```
`ps -p 2200 -o lstart,etime`：`Wed Nov  4 07:52:06 2026`，`08:49:03`（截至采样）。
`/proc/2200/cwd → /home/ova/dsh`；`/proc/2200/fd/1` 与 `fd/2` → `/home/ova/re-agent/dsh-web.log`。

### 2.2 各参数含义（均取自发布版 lib 源码，非猜测）

| 参数 | 归属（源码位置） | 含义 |
| --- | --- | --- |
| `web`（位置参数） | `lib/bin.js` launcher：`dsh <name>` 等价于 `dsh --profile <name>` | 选择 `$DSH_HOME/profiles/web` |
| `--patch <path>` | `lib/bin.js:105` 的 `.option("--patch <path>", "extra patch-list overlay applied after the profile layer (repeatable)", collect)` | 在所有 bundle 层 + 用户 patch 之后追加一层 overlay。此处 `/opt/dsh-plugins/lan-trust.patch.yml` 实测**只插入 `id: lan-trust` 一行**（文件 6 行），把 LAN IP / 隧道域名标记为 Host-owning，使设置界面在非 loopback 来源可用 |
| `--host 127.0.0.1` | `dsh-web-app/lib/startup.js:25` `option("--host <host>", "bind address: one concrete IPv4 or IPv6 literal of a local interface; wildcard addresses are rejected")` | 绑定地址；历史失败日志显示旧值 `192.168.1.88:3080` 曾触发 `EADDRNOTAVAIL` |
| `--port 3080` | 同上 | 监听端口 |
| `--no-open` | `dsh-web-app/lib/startup.js:25` `option("--no-open", "do not open the Web UI in the default browser")` + `startup.js:62 openBrowser: options.open` | 启动时不自动打开浏览器（服务在后台常驻） |
| `--trusted-host <authority...>` | `dsh-web-app/lib/startup.js:25` `option("--trusted-host <authority...>", "extra authority the /api browser-trust fence accepts (host or host:port; repeatable)")` + `:67 trustedHosts: options.trustedHost ?? []` | **仅扩展 `/api` browser-trust 白名单**（额外信任 `192.168.1.165`、`dsh.sepic.space` 两个 Host authority），与搜索 provider/搜索后端**无关**；`startup.js` 明确 `--public-url` "grants no trust" |

### 2.3 「这个 GUI 用的是发布版 lib 还是源码」

**用的是发布版 lib，不是源码 checkout。**

- `/usr/local/bin/dsh` → `../lib/node_modules/@deepseek-ai/dsh/lib/bin.js`（`readlink -f` = `/usr/local/lib/node_modules/@deepseek-ai/dsh/lib/bin.js`），文件属主 `root:root`，安装时间 `Oct 21 07:42`。
- 发布版 `/usr/local/lib/node_modules/@deepseek-ai/dsh/package.json` version **`0.2.1-rc.2`**，目录只有 `lib/` 与 `lib/types/`，无 `cordis*.yml`。
- 源码 checkout `/home/ova/dsh`（工作目录，属主 `ova`）root `package.json` version **`0.2.1-alpha.2`**；`packages/web/*` 6 个包均为 `0.2.1-alpha.2`。两者是**不同的物理目录**（inode 不同），无 symlink 关系。
- **但进程 cwd 恰为 `/home/ova/dsh`**：这只是工作目录（决定 Session 的默认工作区 / `process.cwd()` 的 `!!js` 表达式），**不决定模块加载**。模块加载锚点是 launcher 自身包目录 `/usr/local/lib/node_modules/@deepseek-ai/dsh/`。发布版 lib 的 `dsh-app-boot/lib/index.js:486-500` 注释明确："Module resolution is two-anchor by construction: a bundle name resolves first from the dsh installation (the launcher's own package), then from the profile directory."
- 结论：**运行的是 npm 安装的 0.2.1-rc.2 发布版 + `$DSH_HOME/profiles/web/node_modules` 里的本地插件**；`/home/ova/dsh` 只是被当作工作区/源码资料库，不参与运行时加载。
- 无 `dev:web` / vite watcher 进程（Lead 已确认），因此**源码改动不会热更新到这个 GUI**；任何源码侧变更需重建发布包/客户端产物并刷新页面。

### 2.4 dsh 如何解析 profile（发布版 lib 源码依据）

`dsh-app-boot/lib/index.js`：
- `resolveDshHome()`（`dsh-home-paths/lib/index.js:100-112`）：优先显式配置 → `$DSH_HOME` → `~/.dsh`。本进程 `DSH_HOME=/home/dsh/.dsh`。
- `resolveProfileDir(name, home)`（`:546-548`）：`join(home, "profiles", name)` → `/home/dsh/.dsh/profiles/web`。
- 层叠顺序（`:486-500` 与 `readProfilePatches` `:1125-1135`）：`[]` 根 → 按 `package.json` 的 `dsh.profile.bundles` 顺序应用各 bundle 的 `dsh.bundle.patch` → profile 的 `cordis.patch.yml` → `$DSH_HOME/cordis.patch.yml` → `--patch` overlays → 遥测开关 patch。
- **config 是整体替换、不深合并**（`cordis-composition-reference` skill）：所以 `@240xu/dsh-websearch` 的 `- id: web, config: { searchProvider: unified }` 会把 base 的 `{ searchProvider: deepseek-official, fetchProvider: http }` 整个替换掉。

### 2.5 web vs headless profile 差异

| 项 | web profile | headless profile |
| --- | --- | --- |
| `cordis.yml` | 4 行，空 `[]` + 注释 | 4 行，空 `[]` + 注释（完全相同） |
| `cordis.patch.yml` | **398 行** | **37 行** |
| `package.json` bundles | 12 个（含 `@240xu/dsh-websearch`、`@ayanehana/dsh-reasoning-effort`、3 个本地 link 插件、4 个 experimental bundle） | 2 个：`@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-headless` |
| 搜索 provider | **被 `@240xu/dsh-websearch` 覆盖为 `unified`** | **无 `@240xu/dsh-websearch` bundle** → 沿用 base 默认 `searchProvider: deepseek-official`（`web-search-deepseek`，需 `DEEPSEEK_API_KEY`） |
| `tool-web` | 用户 patch:381-385 在 preset 内重新启用（`fetch:true`, `searchTimeoutMs:60000`），抵消 `dsh-web-app:579` 的 `disabled: true` | 无 tool-web 覆盖行 |
| 默认模型 | `agent-default-model`: `wbcn` / `hy4free` / `reasoningEffort: max`；`llm-pi-ai` 配 3 组 provider（zen / wbgl / wbcn，引用名 `ZEN_API_KEY` / `WBGL_API_KEY` / `WBCN_API_KEY`） | `agent-default-model`: `deepseek-official` / `deepseek-v4.1-flash-free` |
| preset | `agent-preset-registry`: default `android-re`, selectedDefault `unrestricted`；insert 自定义 `preset-android-re`（含 tool-web / tool-fs / tool-fs-search / delegation / compaction / plan-mode 等） | insert `agent-preset-registry` + `preset-android-re`（极简，仅 persona）+ `mcp-rea` |
| 其它 | `permission` presets（`defaultPreset: danger-full-access`）、`ui-settings-general`、`system-prompt`、`session-log-deepseek(enabled:false)`、`ui-chat`、5 条 redteam disable、`tool-plugin-manager` disabled | 无 |
| 与搜索无关的本地插件（简述） | `dsh-our-free-model`(link:/opt/dsh-plugins/dsh-our-free-model)、`dsh-purge-community`(link)、`dsh-nightly-automation`(link)、`@ayanehana/dsh-reasoning-effort`：分别管模型选择/清理演练/夜间自动化/推理强度，**均不注册 `ctx.web` provider，也不改搜索后端** | 无 |

---

## 3. `web/cordis.patch.yml` 全量搜索相关条目（对照 headless）

### 3.1 与 web / search / fetch / LLM provider / agent preset 相关的每一行

| 行号 | id | name | config 关键字段 | 与搜索的关系 |
| --- | --- | --- | --- | --- |
| 4-7 | `ui-settings-general` | `@deepseek-ai/dsh-client-ui-settings-general` | `welcomeNoticeVersion: 2026-09-28.1` | UI，无关 |
| **8-194** | `llm-pi-ai` | `@deepseek-ai/dsh-llm-pi-ai` | `providers`: `zen`(`apiKeyEnv: ZEN_API_KEY`, `api: openai-completions`, `baseURL: https://zen.sepic.space/v1`)、`wbgl`(`WBGL_API_KEY`, `https://workbuddy.sepic.space/v1`, `reasoning: max`)、`wbcn`(`WBCN_API_KEY`, 同 baseURL)。共 3 组、15 个模型条目；`wbcn` 含 `hy4free` | **LLM 对话 provider**，不是搜索 provider；key 引用名仅这三个 |
| 196-209 | `permission` | `@deepseek-ai/dsh-permission-presets` | `presets` read-only / workspace-write / danger-full-access；`defaultPreset: danger-full-access` | 无关 |
| **210-215** | `agent-default-model` | `@deepseek-ai/dsh-agent-default-model` | `provider: wbcn`, `model: hy4free`, `reasoningEffort: max` | 决定对话模型（本会话即 hy4free），与搜索后端无关 |
| 224-242 | `redteam-store` / `redteam-ui` / `redteam-mode` / `redteam-mode-store` / `redteam-mode-ui` | `dsh-redteam-*` | `disabled: true` ×5 | 无关 |
| 244-249 | `system-prompt` | （覆盖） | `includeHarnessIdentity: false`, `personaPrefix: ""`, `personaSuffix: ""` | 无关 |
| **253-257** | `agent-preset-registry` | `@deepseek-ai/dsh-agent-preset-registry` | `default: android-re`, `selectedDefault: unrestricted` | 决定挂载哪个 preset（内含 tool-web） |
| **258-390** | `insert` → `preset-android-re` | `@deepseek-ai/dsh-agent-preset` | `id: android-re`, `order: 10`, `plugins:` 一长串 | 自定义 preset，搜索工具在此挂载 |
| 286-291 | `tool-bash` / `tool-pwsh` | … | `disabled: !!js process.platform === 'win32'` / `!== 'win32'` | 无关 |
| **294-297** | `tool-fs-search` | `@deepseek-ai/dsh-tool-fs-search` | `sampleOverCapGlobResults: false` | **本地文件搜索**（grep/glob 类），不是 web 搜索；Lead 特别点名的两行之一 |
| 331-347 | `compaction` group | `cordis:group` + `compaction-basic` / `command-compact` / `tool-result-pruner` | `thresholdChars: 8192`, `headChars: 4096`, `tailChars: 1024` | 上下文压缩，影响搜索结果回灌后的剪裁，非搜索后端 |
| 348-374 | `delegation` group | `cordis:group` + subagent / workflow 工具 | `provider: spawn` / `fork` | 无关 |
| 379-380 | `tool-todo` | `@deepseek-ai/dsh-tool-todo` | `allowParallelInProgress: true` | 无关 |
| **381-385** | **`tool-web`** | **`@deepseek-ai/dsh-tool-web`** | **`fetch: true`, `searchTimeoutMs: 60000`** | **暴露 `web_search` / `web_fetch` 工具给 LLM**；与 base:486-489 值相同（用户层复述以抵消 web-app 的 disable）。**注意：没有 `searchProvider` 字段——provider 选择在 `id: web` 行，不在这里** |
| 386-387 | `present` | `@deepseek-ai/dsh-tool-present` | — | 交付物 |
| 388-390 | `tool-plugin-manager` | `@deepseek-ai/dsh-plugin-manager/tools` | `disabled: true` | 无关 |
| 391-394 | `session-log-deepseek` | `@deepseek-ai/dsh-session-log-deepseek` | `enabled: false` | 无关 |
| 395-398 | `ui-chat` | `@deepseek-ai/dsh-client-ui-chat` | `collapseTiming: next-input` | UI |

### 3.2 关键澄清（容易踩坑）

- **用户 patch 里没有 `- id: web` 行，也没有 `@240xu/dsh-websearch` 字样**。`searchProvider: unified` 来自 **bundle 层** `@240xu/dsh-websearch/cordis.patch.yml:10-13`，先于用户层应用；用户层未再覆盖 id `web`，所以它保留。
- `tool-web` 的 config 只有 `fetch` 与 `searchTimeoutMs`，**没有任何 search backend / API key / provider 选择 / 并发 / 上限字段**；这些都归 `@240xu/dsh-websearch` 的独立 Config（`lib/index.js:133-241`）管，且通过 **Settings 服务**（namespace `dsh-websearch`）而非 `cordis.patch.yml` 生效。
- `searchTimeoutMs: 60000` 是**工具层**超时；`unified` provider 自身还有 `backendTimeoutMs: 30000`（默认，Settings 实时值）与 `ddg`/`searxng` 的 5s 上限（`provider.js:38-47`）。两层超时并存。

### 3.3 headless 对应配置对照

| 项 | web | headless |
| --- | --- | --- |
| `- id: web` 覆盖 | 由 `@240xu/dsh-websearch` bundle 设为 `searchProvider: unified`（隐含丢掉 `fetchProvider: http`） | 无 → base 默认 `searchProvider: deepseek-official` + `fetchProvider: http` |
| `tool-web` | 用户 patch 重新启用（fetch:true, searchTimeoutMs:60000） | 无覆盖；base 的 tool-web 存在，但 `dsh-web-app` 的 disable 不适用于 headless bundle |
| `tool-fs-search` | 有（config `sampleOverCapGlobResults: false`） | 无 |
| `@240xu/dsh-websearch` bundle | 在 `package.json:20` 声明、已安装 | 无 |
| 搜索 API key 引用名 | `ZEN_API_KEY`/`WBGL_API_KEY`/`WBCN_API_KEY`（**对话 LLM 用**，非搜索）；`DEEPSEEK_API_KEY`（base 的 `web-search-deepseek` 用，但被绕过） | `DEEPSEEK_API_KEY`（`web-search-deepseek` 默认） |

---

## 4. cordis_inspect_query：文件声明 vs 运行时生效

### 4.1 实测结果

| 查询 | 结果 |
| --- | --- |
| `cordis_inspect_list` | host: `Service` / `Event` / `Config` / `Tool`；client: `Service` / `Event` / `Builtin` / `Slots` / `Theme`（与 Lead 一致） |
| `host Tool.listTools`（无 input） | 成功。当前 Agent 工具目录里**确有 `web_search`（queries: string[1..4]）与 `web_fetch`（url）**；另有 `cordis_inspect_query` 等。说明 tool-web 已挂载且 `disabled:true` 已被用户层抵消 |
| `host Service.listService`（无 input） | 成功，返回完整 service 目录。**与 web 相关的 Service**：`web`（"The web access service."，方法 `registerSearchProvider` / `registerFetchProvider` / `search` / `fetch`）、`webApp`（"The Web GUI this process serves"，`getAdvertisedUrl()`）、`webServer`（"The browser HTTP carrier service."，`register` / `renderIndex` / `collectIndexInjections` 等）、`clientModules`（web 插件表）。完整输出落盘 `/tmp/dsh-spill-.../f9118290bea2-...txt` |
| `host Config.listConfigs`（**无 input**） | 成功，返回**第 1 页 25 条，`total: 220`, `nextOffset: 25`**。首屏全是 `include:*`（cordis:include 展开的 shipped 行），含 `include:session-log-deepseek`、`include:agent-default-model` 等 |
| `host Config.listConfigs` **带任何 input 对象**（试过 `{}`、`{"offset":25}`、`{"limit":100}`、`{"name":"..."}`、`{"entry":"web"}`、`{"entry":"tool-web"}`、`{"service":"web"}` 等 10+ 种） | **一律报错**：`Host Cordis inspect Config.listConfigs rejected input: "input" must be an object`；`Service.listService` 带 input 同样报错。**这是本会话 Inspect 通道的 input 序列化/校验缺陷**——传 JSON 对象被判为非对象，只有省略 `input` 才能走默认目录。**因此无法分页读完 220 条，也无法取单条 Config schema**。这是「待确认」缺口，已用文件层 + HTTP 端点交叉补足 |
| `client *` 查询 | 需页面在线，未调用（Lead 已说明可能超时），本报告不依赖 |

### 4.2 运行时生效证据（用 HTTP 端点补偿 Inspect 缺陷）

通过 `/` 的 `?token=` 换到 `dsh-auth-<hash>` cookie 后（trust fence 要求 "connection service admit"，单纯 query token / Origin 都不够），实测三个端点**全部 200 且 `ok:true`**：

| 端点 | 关键返回 | 结论 |
| --- | --- | --- |
| `GET /api/unified-search/health` | `{"ok":true,"enabled":4,"keyless":4,"backends":[...11 条...]}` | **运行时确实只有 4 个 keyless 后端启用**；exa/parallel/ddg/searxng `reachable:false`, `lastOk:null`，错误串与我复跑的 `web_search` 完全一致；brave…openai 7 个 `enabled:false` |
| `GET /api/websearch/history` | 6 条历史（query + time + resultCount:8 + backendsOk:3/backendsTotal:4），时间戳约为 2026-10 月中旬；`backends[]` 显示 4 个后端 `failCount: 25/26`、`ok:false` | **历史证明这些后端曾经成功过 3/4**（旧记录 backendsOk=3），但**当前进程全部失败**；累计失败计数 25-26 次 |
| `GET /api/unified-search/settings` | `{"ok":true,"namespace":"dsh-websearch","writable":true,"applies":"live","revision":0,"value":{...},"base":{...},"user":{}}` | **`user` 层为空对象 `{}`，`revision:0`，`value` 与 `base` 完全相同** → **没有任何用户自定义的搜索 key 或后端开关被写入**；全部为出厂默认值 |

### 4.3 文件声明 vs 运行时生效：差异清单

| # | 文件声明 | 运行时实际 | 性质 |
| --- | --- | --- | --- |
| 1 | `dsh-base:470` `searchProvider: deepseek-official` | `searchProvider: unified`（`@240xu/dsh-websearch` bundle patch 覆盖） | **被覆盖，且是决定性差异** |
| 2 | `dsh-base:471` `fetchProvider: http` | config 整体替换后该字段**消失**；`ctx.web.fetch()` 走可用 provider 自动回退（`httpFetchProvider` / `deepseek-fetch-api` 之一） | **隐性副作用**（bundle 未 restate 该字段） |
| 3 | `dsh-web-app:579` `id: tool-web disabled: true` | web 用户 patch:381 重新声明并启用 → `listTools` 里 `web_search`/`web_fetch` 都在 | 被用户层抵消 |
| 4 | `llm.env` / `.credentials.yaml` 里有 3 个 key 引用名 | Settings `user:{}`、进程环境无 `BRAVE_API_KEY` 等键名 → 7 个 key-gated 后端全部 `enabled:false` | **文件里的 key 是 LLM 对话用的，不是搜索用的** |
| 5 | `cordis.patch.yml` 里 `tool-web.config` 只有 2 个字段 | `@240xu/dsh-websearch` 有独立 40+ 字段 Config（并发/缓存/熔断/多查询/11 后端开关/key 引用名），经 Settings 面板生效 | **配置平面分裂**：搜索后端配置不在 cordis.patch.yml |
| 6 | `~/.dsh/logs/startup-*.log`（946 个，最新 2026-10-31）中**零条** unified/websearch/exa/searxng 记录 | 当前进程 stdout 在 `/home/ova/re-agent/dsh-web.log`（仅 1584 字节），且插件按 `lib/util/log.js` 走 `ctx.logger` **不写 startup 文件**，后端遥测只进内存 Map + session 事件 | **日志位置错配**：查 startup 日志查不到 unified 是预期的 |
| 7 | `dsh purge` 插件 | 当前 log 显示 `1 entry did not activate: dsh-purge (dsh-purge-community): failed to import: Cannot find package 'yaml'` | 与搜索无关，但说明有 1 个本地插件未激活（旧 startup 日志还显示 `EADDRNOTAVAIL: 192.168.1.88:3080` 是历史失败启动，非本次） |

---

## 5. `~/.dsh` 里的实际运行证据

### 5.1 会话日志（sessions/，234 文件，188 MB，`.jsonl.zstd` + `.lock`）

- **必须用 `zstd -dc` 解压后 grep**（`.zstd` 压缩，直接 grep 无匹配——这是第一轮 `No matches found` 的原因，不是"没调用过"）。
- 解压检索结果：
  - **12 个 session 文件含 `unified search: all enabled backends failed (4)`**，错误串与本次复跑逐字一致（含 `exa: MCP initialize HTTP 403` / `parallel: ... 403` / `ddg: ... redirect mode is set to error (301)` / `searxng: invalid JSON response`）。样本：`--home-ova-dsh--/session-01bc183f-...`、`session-0fc21e92-...`、`session-0c5579ca-...`、`session-6262e958-...`、`d335f57c-...` 等。
  - **17 个 session 文件含 `"unified"` / `searchProvider.*unified` / `dsh-websearch`**。
  - 另有大量 `--home-dsh-worktrees-websearch-polish--/` 与 `--tmp--/` 下的 session 含 `web_search`/`web_fetch` 调用（多为插件自身开发/测试期）。
  - 最新 `--home-ova-dsh--/a77c25ee-...` 中同时出现 `"name":"web_search"` 与多次 `web_fetch`。
- 结论：**`web_search` 在本 GUI 会话历史上被真实调用过多次，且近期（当前进程期）稳定失败**。

### 5.2 startup 日志（logs/，946 个 `.log`，19 MB）

- `grep -rilE 'unified|websearch|web-search|exa|searxng|searchProvider|MCP initialize' logs/` → **0 个文件命中**。
- 最新 `startup-2026-10-31T01-18-57...log` 内容：`profile: 'web'`、`StartupError ... 2 required plugins did not activate`：`webserver` `EADDRNOTAVAIL: address not available 192.168.1.88:3080`（旧 IP）、`dsh-purge-community` 缺 `yaml` 包；`Plugins waiting for services (7)`。**这是 10-31 的一次失败启动，不是当前进程**。
- 当前进程的 stderr 在 `/home/ova/re-agent/dsh-web.log`：`ExperimentalWarning: SQLite`、`dsh inspector: devtools://...`、`dsh: warning: 1 entry did not activate`（`dsh-purge` 缺 `yaml`）、`dsh web: http://127.0.0.1:3080/?token=...`。**没有任何 web 插件加载失败或搜索报错**——与插件设计的 "Host-logger diagnostics … deliberately NOT session events" 一致（README:205）。
- 结论：**startup 日志中没有 unified-search 加载/失败记录**，因为没有专用文件日志；运行证据在 session 日志 + 内存 health Map。

### 5.3 health / history 路由运行证据（Lead 追问）

- 三个路由均已在当前进程注册且可用（带 auth cookie 时 200 `ok:true`）：
  - `GET /api/unified-search/health`（`lib/health.js:88`）
  - `GET /api/websearch/history`（`lib/history.js:166`）+ `POST /api/websearch/history/clear`（`:182`）
  - `GET|POST /api/unified-search/settings`（`lib/settings-api.js:37,56`）
- 直接 `curl`（无 cookie）→ `401`；带 query token / Cookie 猜名 / Authorization Bearer / `X-DSH-Token` / Origin 单独 → `{"ok":false,"error":"untrusted request"}`（`lib/trust.js` 的 `rejectionFor` 走 `connection.admit()`，比结构性 fence 更严）。用 `/?token=...` 的 303 `Set-Cookie: dsh-auth-<hash>=v1.<jwt>; HttpOnly; SameSite=Strict` 才通过。
- `history.json`（`/home/dsh/.dsh/cache/websearch/history.json`）磁盘落盘 6 条，与 HTTP 端点返回一致（环形 50 条上限）。

### 5.4 凭证 / key 引用名（**只列名字**）

| 文件 | 引用名 | 用途 | 是否搜索 key |
| --- | --- | --- | --- |
| `/home/dsh/.dsh/.credentials.yaml` | `ZEN_API_KEY`、`WBGL_API_KEY`、`WBCN_API_KEY`（`refs:` 段） | `llm-pi-ai` 的 zen / wbgl / wbcn 对话 provider | ❌ 否 |
| 同上 | `client-connection/browser-session` → `secret` | GUI 浏览器会话密钥 | ❌ 否 |
| `/home/dsh/.dsh/llm.env` | `DEEPSEEK_BASE_URL`、`DEEPSEEK_API_KEY` | 对话/官方搜索端点（`baseURL` 为 `https://ai.furry.vg/v1`，非密钥） | ⚠️ 仅 `DEEPSEEK_API_KEY` 是 base `web-search-deepseek` 的引用名，但该 provider **被绕过**；进程环境确有 `DEEPSEEK_API_KEY` 键名 |
| `/home/dsh/.dsh/web-auth.env` | `DSH_WEB_STATIC_TOKEN` | Web 静态鉴权 | ❌ 否 |
| `@240xu/dsh-websearch` Settings `value` | `braveApiKeyEnv` / `tavilyApiKeyEnv` / `serperApiKeyEnv` / `mojeekApiKeyEnv` / `deepseekApiKeyEnv` / `anthropicApiKeyEnv` / `openaiApiKeyEnv` / `searxngApiKeyEnv`（均为**默认环境变量名**，值未填入） | 7 个 key-gated 后端 | ⚠️ 引用名存在但 `enableXxx:false`，且 `user:{}` 无覆盖 |
| 进程 `/proc/2200/environ` 键名 | `DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`、`DSH_EGRESS_FORWARDER_PROXY`、`DSH_HOME`、`DSH_WEB_STATIC_TOKEN`、`GW_PROXY`、`HTTP_PROXY`、`HTTPS_PROXY`、`NO_PROXY`/`no_proxy` | — | **无** `BRAVE_API_KEY` / `TAVILY_API_KEY` / `SERPER_API_KEY` / `MOJEEK_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `DSH_UNIFIED_SEARCH_BACKENDS` 等键名 |

- `llm.env` base url：`DEEPSEEK_BASE_URL=https://ai.furry.vg/v1`（**非密钥，允许写出**）。
- 全盘 `grep` 检索 `BRAVE_API_KEY|TAVILY_API_KEY|...|unified-search|enableBrave|...` 于 `/home/dsh/.dsh` 的非 node_modules 文件 → **零命中**（除 node_modules 内的源码/README 自身）。

---

## 6. 「远端」：发布版 npm 包 vs 源码版本 vs 实际安装

### 6.1 版本对照

| 包 | 发布版 `package.json` 声明 | 发布版 `node_modules` 实装版本 | 源码 checkout `/home/ova/dsh` | 是否一致 |
| --- | --- | --- | --- | --- |
| `@deepseek-ai/dsh` (CLI) | **0.2.1-rc.2** (`/usr/local/lib/.../package.json:4`) | — (顶层包) | **0.2.1-alpha.2** (`/home/ova/dsh/package.json:3`) | ❌ 源码更旧一个 tag |
| `@deepseek-ai/dsh-tool-web` | `0.2.1-rc.2`（CLI package.json:86） | **0.2.1-rc.2** | `0.2.1-alpha.2` (`packages/web/tool-web/package.json`) | 发布版内部自洽；源码不同 |
| `@deepseek-ai/dsh-web-app` | `0.2.1-rc.2`（:88） | **0.2.1-rc.2** | `0.2.1-alpha.2` (`packages/client/web/package.json`) | 同上 |
| `@deepseek-ai/dsh-web` | （peer/间接） | **0.2.1-rc.2** | `0.2.1-alpha.2` (`packages/web/web/package.json`) | 同上 |
| `@deepseek-ai/dsh-web-search-deepseek` | （bundle 内） | **0.2.1-rc.2** | `0.2.1-alpha.2` (`packages/web/web-search-deepseek/package.json`) | 同上 |
| `@deepseek-ai/dsh-web-fetch-http` | （bundle 内） | **0.2.1-rc.2** | `0.2.1-alpha.2` (`packages/web/web-fetch-http/package.json`) | 同上 |
| `@deepseek-ai/dsh-web-deepseek-api` | （bundle 内） | **0.2.1-rc.2** | — | — |
| `@deepseek-ai/dsh-client-ui-settings-web-search` | （bundle 内） | **0.2.1-rc.2** | — | — |
| `@deepseek-ai/dsh-host-webserver` | （bundle 内） | **0.2.1-rc.2** | — | — |

发布版 `node_modules/@deepseek-ai/` 下实际存在的 web 相关包（`ls -d`）：`dsh-client-ui-settings-web-search`、`dsh-experimental-session-search`、`dsh-host-webserver`、`dsh-tool-fs-search`、`dsh-tool-web`、`dsh-web`、`dsh-web-app`、`dsh-web-deepseek-api`、`dsh-web-fetch-http`、`dsh-web-frontend`、`dsh-web-search-deepseek`。
**注意：发布版内没有 `dsh-web-search-exa` / `dsh-web-search-perplexity` / `dsh-web-search-tavily` 等包**——这些只出现在源码 `packages/web/` 的 6 个包里（由 task-1 负责），**当前运行时并未安装**。

### 6.2 远端最新版本（网络可用，`HTTP_PROXY=http://172.30.66.1:1091` 预设）

| 查询 | 结果 |
| --- | --- |
| `npm view @240xu/dsh-websearch version` | **`2.8.8`**（`EXIT=0`，网络通） |
| `npm view @240xu/dsh-websearch dist-tags` | `{"latest":"2.8.8"}` |
| 版本序列 | `2.8.4`(2026-10-18 06:02Z) → `2.8.5`(10-18 10:31Z) → `2.8.6`(10-18 14:04Z) → `2.8.7`(10-20 12:53Z) → **`2.8.8`(2026-10-21 14:10Z)** |
| 当前安装 | `2.8.4`（`package.json:3`，目录 mtime `Oct 21 20:17`） |
| 结论 | **落后 4 个 patch 版本（2.8.5/2.8.6/2.8.7/2.8.8）**，且 `2.8.8` 发布时间早于本机安装时间（10-21 20:17 > 14:10Z+8=22:10 北京时间？——本机 20:17 早于发布 22:10，故安装时尚未发布）。README 的 CHANGELOG 章节提到 v2.8.1/2.8.2 修复，2.8.5-2.8.8 的变更内容**未在本机包内**（无 CHANGELOG.md 文件，`files` 数组也不含），需远端拉取（可由 task-8 负责） |

> 网络可用但仅做 `npm view` 只读查询，未安装/升级任何包。

---

## 7. 第 6 问正式回答：实际走哪个 provider？有无可用 key？

### 7.1 确定结论

**（A）实际 provider = `@240xu/dsh-websearch@2.8.4` 注册的 `unified` 聚合 provider，不是 `deepseek-official`。**

证据链（每一环都实测）：
1. `/home/dsh/.dsh/profiles/web/package.json:20` 把 `@240xu/dsh-websearch` 列入 `dsh.profile.bundles`（`:5` 声明版本 `2.8.4`）。
2. 实体 `/home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/` 存在，`package.json:55-58` 声明 `dsh.bundle.patch: ./cordis.patch.yml`。
3. 该 bundle patch `:7-13` 做两件事：`insert id: dsh-websearch` + **`- id: web, config: { searchProvider: unified }`**。按 Loader 规则 config 整体替换 → 覆盖 `dsh-base/cordis.patch.yml:470` 的 `deepseek-official`。
4. 发布版 `dsh-web/lib/index.js:100` `const configuredId = this.config.searchProvider.get() ?? this.searchProviderEnv` → `:134` 显式 `configuredId` 命中 `providers.get("unified")`；无 `WEB_PROVIDER_AMBIGUOUS`（插件只注册一个 provider，`lib/index.js:448`）。
5. `lib/index.js:31` `const PROVIDER_ID = "unified"`；`index.js:46` `export const name = "unified-search"`。
6. **我本会话亲自调用 `web_search`**，返回错误串以 `unified search: all enabled backends failed (4) - exa: ... parallel: ... ddg: ... searxng: ...` 开头——这是 `provider.js:489-493` 抛出的 `WEB_PROVIDER_ERROR`，**只有 unified provider 会生成这个前缀**。
7. 实时 `GET /api/unified-search/health` 返回 `enabled:4, keyless:4` 且 4 条 `lastError` 与上面逐字一致——证明该 provider 在当前进程内已注册并运行。
8. 进程环境无 `DSH_WEB_SEARCH_PROVIDER`（键名列表已核对），排除 env 覆盖。

**（B）当前 `web_search` 事实上不可用；4 个启用的后端全部失败。**

| 后端 | 类型 | 实时失败原因 | 源码位置 |
| --- | --- | --- | --- |
| `exa` | keyless MCP (`https://mcp.exa.ai/mcp`) | `MCP initialize HTTP 403: <html>...403 Forbidden...` | `lib/backends/exa.js:13,62` |
| `parallel` | keyless MCP (`https://search.parallel.ai/mcp`) | `MCP initialize HTTP 403` | `lib/backends/parallel.js` |
| `ddg` | keyless HTML 抓取 | `fetch failed: redirect mode is set to error (301)` | `lib/backends/ddg.js:38-40` 显式 `redirect: "error"`（Lead 指出的重定向拒绝策略） |
| `searxng` | keyless 元搜索 (`https://searx.be`) | `SearXNG: invalid JSON response` | `lib/backends/searxng.js:89-91`（公共实例返回非 JSON，疑似被代理/拦截页替换） |

- health 端点 `reachable:false` / `lastOk:null`，history 端点 `failCount: 25/26`。
- 403 与「无直连外网、必须经 egress 代理」的宿主网络环境（`~/.dsh/AGENTS.md` §5/§6 记录 `dsh` 用户 egress 被 iptables 限制）高度吻合：MCP 初始化请求经 `HTTP_PROXY` 出口被对端/中间层拒绝；`ddg` 的 301 被插件自身的 `redirect:"error"` 硬拒；`searxng` 拿到 HTML 而非 JSON。**这是环境/网络 + 插件策略的组合失败，不是"没配 key"导致的失败**（4 个都是 keyless）。

**（C）没有任何可用的搜索 API key。**

1. Settings 端点 `user: {}`、`revision: 0`、`value === base` → **零用户覆盖**，7 个 key-gated 后端开关全为 `false`（`enableBrave/enableTavily/enableSerper/enableMojeek/enableDeepseek/enableAnthropic/enableOpenai: false`）。
2. `enabledBackends: []`（空数组）→ 走 `DEFAULT_ENABLED = ["exa","parallel","ddg","searxng"]`（`lib/index.js:72,317`），与 health 的 `enabled:4` 完全一致。
3. 进程 `/proc/2200/environ` 键名里**没有** `BRAVE_API_KEY` / `TAVILY_API_KEY` / `SERPER_API_KEY` / `MOJEEK_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `DSH_UNIFIED_SEARCH_BACKENDS`。
4. `.credentials.yaml` 的 `refs:` 只有 `ZEN_API_KEY` / `WBGL_API_KEY` / `WBCN_API_KEY`（对话 LLM 用），`llm.env` 只有 `DEEPSEEK_BASE_URL` / `DEEPSEEK_API_KEY`。
5. `DEEPSEEK_API_KEY` 键名虽在进程环境中，但它只喂 `web-search-deepseek` / `web-deepseek-api`（shipped，`apiKeyEnv: DEEPSEEK_API_KEY`），**这两个 provider 因 `searchProvider=unified` 被完全绕过**；且 `unified` 的 `deepseek` 后端 `enableDeepseek:false`，所以该键名对当前搜索路径**无任何作用**。
6. 全盘非 node_modules 配置文件检索 `enableBrave|unified-search|BRAVE_API_KEY|...` → 零命中。

**（D）`web_fetch` 的附带影响（重要但未 100% 确认）**

bundle patch 用 `{ searchProvider: unified }` 整体替换 `id: web` 的 config，**把 `fetchProvider: http` 一起丢了**（`cordis-composition-reference`：config 不深合并）。`dsh-web/lib/index.js:112` 在 `configuredId === undefined` 时走 "usable providers 恰好 1 个" 自动选择；当前注册了 `HttpFetchProvider`（`dsh-web-fetch-http/lib/index.js:678`）与 `deepseek-fetch-api`（`dsh-web-deepseek-api/lib/index.js:305,386`）两个 fetch provider，是否恰好 1 个 `available()` 取决于账号/凭据状态 → **可能触发 `WEB_PROVIDER_AMBIGUOUS`，也可能自动选中其中一个**。本次未实测 `web_fetch` 的成功请求（session 日志里有多次 `web_fetch` 调用记录，但未逐条判定成败）。列为「待确认」。

### 7.2 待确认 / 证据缺口

| # | 缺口 | 原因 | 可补办法 |
| --- | --- | --- | --- |
| 1 | `host Config.listConfigs` 无法分页（220 条只读到第 1 页 25 条），无法取 `web` / `tool-web` / `dsh-websearch` 单条 Config schema | 本会话 `cordis_inspect_query` 传任何 `input` 对象都被判 `"input" must be an object`（Inspect 通道序列化缺陷），仅省略 input 可用 | 换一个会话/重启后重试；或改用 `--dump-config` / configEditor Service（`configuration()` 方法在 `Service.listService` 目录里可见）离线导出 |
| 2 | `client *` Provider 未查询 | 需页面在线，可能超时；本报告结论不依赖 | Lead 若需要可另开会话查 |
| 3 | `web_fetch` 当前是否真的可用 / 是否 `WEB_PROVIDER_AMBIGUOUS` | 未实测成功请求；`fetchProvider` 被 bundle 覆盖丢失 | 用带 auth cookie 的 `web_fetch` 或 `/api` 调用实测 |
| 4 | `@240xu/dsh-websearch` 2.8.5–2.8.8 的 CHANGELOG 内容 | 本机包 `files` 不含 `CHANGELOG.md`，README 只写到 2.8.1/2.8.2 | 远端 `npm view` / GitHub（task-8 负责仓库权威梳理） |
| 5 | 4 个 keyless 后端 403/301/非 JSON 的精确网络层归因 | 只观测到应用层错误串；`dsh` 用户 egress 由 iptables 限制（AGENTS.md §10），代理链路未抓包 | 需 `curl -v` 经 `HTTP_PROXY` 对 `mcp.exa.ai` / `html.duckduckgo.com` / `searx.be` 复现，或抓包 |
| 6 | `--patch lan-trust` 是否影响 `/api/unified-search/*` 的 trust fence | 实测带 `192.168.1.165` Host 仍被 `untrusted request`（但那次未带 auth cookie，变量未隔离） | 用 LAN IP + auth cookie 单独验证（不影响本报告主结论） |
| 7 | 历史 6 条 `backendsOk:3/4` 是哪些后端成功 | `history.json` 只存聚合计数，不存 per-backend 明细（README:191 明确设计） | 查对应日期的 session 日志解压结果 |

---

## 8. 证据清单（文件:行号 / 命令输出）

**进程与 CLI**
- `ps -p 2200 -o pid,user,args=` → 完整命令行（§2.1）
- `ps -p 2200 -o lstart,etime` → `Wed Nov 4 07:52:06 2026`, `08:49:03`
- `readlink -f /usr/local/bin/dsh` → `/usr/local/lib/node_modules/@deepseek-ai/dsh/lib/bin.js`
- `/usr/local/lib/node_modules/@deepseek-ai/dsh/package.json:2,4` → `name`, `version: 0.2.1-rc.2`；`:86,88` → `dsh-tool-web` / `dsh-web-app` 版本
- `/home/ova/dsh/package.json:3` → `0.2.1-alpha.2`
- `/proc/2200/cwd` → `/home/ova/dsh`；`/proc/2200/fd/1,2` → `/home/ova/re-agent/dsh-web.log`
- `/proc/2200/environ` 键名 `cut -d= -f1` → 见 §5.4
- `dsh-app-boot/lib/index.js:486-500, 546-548, 1060-1145` → profile 解析与层叠
- `dsh-home-paths/lib/index.js:100-112` → `resolveDshHome`
- `dsh-web-app/lib/startup.js:8,25,28,31,62,67` → 所有 flag 语义
- `lib/bin.js:27-28,45,61,84,105` → `--patch` 语义

**Profile 文件**
- `/home/dsh/.dsh/profiles/web/cordis.yml:1-4`（空 `[]`）
- `/home/dsh/.dsh/profiles/web/package.json:5,6-9,13-27`（bundles 列表）
- `/home/dsh/.dsh/profiles/web/cordis.patch.yml:8-194`（llm-pi-ai）、`:210-215`（默认模型）、`:253-257`、`:258-390`（preset insert）、`:294-297`（tool-fs-search）、`:381-385`（tool-web）、`:391-398`
- `/home/dsh/.dsh/profiles/headless/{cordis.yml,package.json,cordis.patch.yml:1-37}`
- `/opt/dsh-plugins/lan-trust.patch.yml:1-6`

**Bundle（决定性）**
- `/home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/package.json:3,4,47-53,55-69`
- 同目录 `cordis.patch.yml:7-13`
- `lib/provider.js:31`（`const PROVIDER_ID = "unified"`）、`:38-47`
- `lib/backends/{exa,parallel,ddg,searxng,brave,tavily,serper,mojeek,anthropic-like,openai}.js` 的 `available()` 与错误点；`ddg.js:38-40`（`redirect:"error"`）；`searxng.js:89-91`；`exa.js:13,62`
- `lib/health.js:84-108`；`lib/history.js:150-182`；`lib/settings-api.js:37,52-56`；`lib/trust.js:82-179`
- `README.md:6,8,12,14,16,59-65,73-79,96,101,116,118,142,191,197-205,216,250-251`

**Shipped 默认（被覆盖前）**
- `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-base/cordis.patch.yml:467-489`
- `.../dsh-web-app/cordis.patch.yml:579-580`
- `.../dsh-web/lib/index.js:38-46,49-59,90-145`
- `.../dsh-web-search-deepseek/lib/index.js:99-101,199-205`
- `.../dsh-web-fetch-http/lib/index.js:678`；`.../dsh-web-deepseek-api/lib/index.js:305,386`

**Inspect / 实时端点 / 运行证据**
- `cordis_inspect_list` → 8 个 Provider（§4.1）
- `host Tool.listTools`（无 input）→ `web_search` / `web_fetch` schema
- `host Service.listService`（无 input）→ `web` / `webApp` / `webServer` / `clientModules`；完整输出 `/tmp/dsh-spill-AdzH1a/session-88c8af2934b2/f9118290bea2-cordis_inspect_query.txt`
- `host Config.listConfigs`（无 input）→ `total:220, nextOffset:25`，25 条 `include:*`
- 带 input 的 10+ 次尝试 → `"input" must be an object`
- `web_search({queries:[...]})` 本会话实跑 → `Error: unified search: all enabled backends failed (4) - exa: MCP initialize HTTP 403 ... parallel: MCP initialize HTTP 403 ... ddg: ... redirect mode is set to error (301) ... searxng: invalid JSON response`
- `curl -sS -D - -o /dev/null "http://127.0.0.1:3080/?token=<...>"` → `303` + `Set-Cookie: dsh-auth-<hash>=v1.<jwt>; HttpOnly; SameSite=Strict`
- `GET /api/unified-search/health`（带该 cookie + Origin）→ `{"ok":true,"enabled":4,"keyless":4,...}` 全量 JSON
- `GET /api/websearch/history` → 6 条 + `failCount:25/26`
- `GET /api/unified-search/settings` → `user:{}`, `revision:0`, `applies:"live"`, `writable:true`
- 无 cookie 基线 → `401` / `{"ok":false,"error":"untrusted request"}`
- `zstd -dc` 解压 grep sessions → 12 文件含 `all enabled backends failed (4)`，17 文件含 `unified`
- `/home/dsh/.dsh/cache/websearch/history.json:1-44`
- `/home/ova/re-agent/dsh-web.log`（1584 B）→ `1 entry did not activate`（dsh-purge 缺 yaml）+ 启动 URL
- `grep -rilE 'unified|websearch|...' /home/dsh/.dsh/logs/` → 0 命中
- `npm view @240xu/dsh-websearch version` → `2.8.8`；`dist-tags` → `latest:2.8.8`；`versions` / `time` → 序列与日期
- `for p in ...; grep -m1 '"version"' <pkg>/package.json` → 7 个发布版 web 包均 `0.2.1-rc.2`
- `find /home/ova/dsh/packages -path "*/<p>/package.json"` → 4 个源码包均 `0.2.1-alpha.2`

---

## 9. 给 Lead 的要点速览

1. **GUI 跑的是发布版 0.2.1-rc.2**（`/usr/local/lib/node_modules/@deepseek-ai/dsh`），源码 checkout `/home/ova/dsh` 是 0.2.1-alpha.2，只是 cwd / 工作区，不参与加载；无 watcher，源码改动不会自动生效。
2. **搜索被第三方 bundle 劫持**：`@240xu/dsh-websearch@2.8.4` 在 bundle 层 `- id: web, config: {searchProvider: unified}`，把 base 的 `deepseek-official` 换掉，并顺带丢了 `fetchProvider: http`。
3. **当前 `web_search` 100% 失败**（我复跑 + health 端点）：4 个 keyless 后端 exa/parallel (MCP 403)、ddg (301 被 `redirect:"error"` 拒)、searxng (非 JSON) 全挂；`failCount` 已 25-26。
4. **零可用搜索 key**：Settings `user:{}` `revision:0`，7 个 key-gated 后端全 `false`，进程环境无对应 key 键名；`DEEPSEEK_API_KEY` 只喂被绕过的 shipped provider。
5. **health / history / settings 三个路由都在跑且带 auth cookie 可读**；startup 日志里查不到 unified 是设计使然（走 ctx.logger + session 事件 + 内存 Map）。
6. **npm 上最新是 2.8.8，本机 2.8.4，落后 4 个 patch 版本**（网络可用，`npm view` 已验证）。
7. 唯一工具缺口：`cordis_inspect_query` 带 input 必报错，Config 220 条只读到第一页、单条 schema 取不到；已用 HTTP 端点 + 文件层补足，主结论不受影响。

---

## 附录 · 续研补充（2026-11-05）

> **声明：本附录只追加，不改写、不删减、不推翻上文 §0–§9 的任何结论。** 上文基于 2026-11-04 16:35–16:46 的现场快照；本附录基于 2026-11-05 20:09–20:22 (+08:00) 的复核，用于补齐 §7.2 自列的 7 条缺口。上文结论在新现场下全部保持成立（复核见 §A.0）。
> **标注口径**：按全队 [_SKELETON.md](_SKELETON.md) §7–20 —— **A**=源码实证（本地 `路径:行号` 或带 ref 永久链接）、**B**=官方文档、**C**=版本记录（CHANGELOG / tag / commit sha / npm 版本与时间）、**D**=本机实测（curl / web_fetch / health API / Node 复现脚本输出）、**E**=推断或待核实（显式标注，不得当结论）。**四联**=`结论/改动 → 依据(B/C) → 代码落点(A) → 验证方式(D)`，缺项标 E。
> **只读边界**：全程 `ps` / `curl` / `ss` / `read` / `grep` / `npm view` / `npm pack`（解包到 `/tmp`）/ Node 内联只读脚本；**未改任何配置、未改源码、未重启服务、未升级任何包、未安装到 profile**。报告中不出现任何 token / 密钥值。

### A.0 现场变更复核（不改上文结论）

| 项 | 2026-11-04 上文 | 2026-11-05 复核 | 影响 |
| --- | --- | --- | --- |
| dsh web 进程 | PID **2200**，STARTED `Nov 4 07:52:06` | **PID 2200 已不存在**；现为 **PID 2085**，STARTED `Thu Nov 5 18:37:15`，命令行**逐字相同**（`--patch /opt/dsh-plugins/lan-trust.patch.yml --no-open --host 127.0.0.1 --port 3080 --trusted-host 192.168.1.165 --trusted-host dsh.sepic.space`） | 服务在两次采样间**重启过一次**，但配置未变 |
| GUI | `http://127.0.0.1:3080` 401 | 仍 `root=401` | 一致 |
| stdout/stderr | `/home/ova/re-agent/dsh-web.log` | 同路径，mtime `Nov 5 18:37`，1584 B；启动 URL 中的 token **已轮换**（不记录值） | cookie 交换流程仍需用新 token |
| `/proc/<pid>/cwd` | `/home/ova/dsh` | 仍 `/home/ova/dsh` | 一致 |
| profile / bundle | `@240xu/dsh-websearch@2.8.4` | 仍是 2.8.4（`/home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/package.json:3`） | **未升级**，§0/§7 结论仍成立 |
| health API | 4 后端 `reachable:false`、`failCount 25/26` | 重启后内存 Map 清零：`reachable:null`、`lastError:null`、`updatedAt=1793880882332`；但 `enabled:4, keyless:4`、7 个 key-gated 全 `false` 不变 | 印证上文「health 是纯内存被动遥测、不落盘」的论断 |
| settings API | `user:{}`, `revision:0`, `applies:"live"` | **逐字一致** | 零用户覆盖仍成立 |

**结论（四联）**：上文 §0–§9 的结论在 2026-11-05 现场依然成立，仅进程 PID 与启动 token 轮换。**依据** [C] `ps -p 2085 -o lstart,args` + [D] `curl /api/unified-search/{health,settings}` 实跑 → **代码落点** [A] `/proc/2085/cmdline`、`/home/dsh/.dsh/profiles/web/package.json:5,20` → **验证** [D] 与上文 §4.2 / §8 逐项比对；**E**：重启发生在两次采样之间，具体触发原因未查（不属本次范围）。

### A. 缺口 1：Config 220 条只读 25 条（Inspect input 通道缺陷）—— 已绕过，且定位到根因

**结论（四联）**：
- **结论**：`cordis_inspect_query` 的 `input` 在本会话被宿主判为「非 object」，**所有带 input 的查询一律失败**（不是 `Config.listConfigs` 单方法问题）；但用 **`dsh web --dump-config`** 可离线导出**完整 composed entry tree（1729 行 / 742 个 `id|name` 行）**，等价于把 220 条 Config 目录 + 每条的最终 config 一次性读全，且不依赖 Inspect 通道。
- **依据** [A/D]：`/usr/local/lib/node_modules/@deepseek-ai/dsh/lib/bin.js:105` 声明 `.option("--dump-config", "print the composed profile tree and exit")`；`lib/dump-config-CWs_HdOc.js:27` 只有一句 `process.stdout.write(renderConfigDump(...))`，**无 `writeFile` / `mkdir`**；`lib/bin.js:239-243` 的 `case "dump-config"` 只 `await import(...)` 后打印并退出。
- **代码落点** [A]：`dsh-app-boot/lib/index.js:1065-1145`（`loadProfile` / `readProfilePatches` / `composeEntries`，与运行时同一套 `applyEntryPatches`）；`lib/dump-config-CWs_HdOc.js:27`。
- **验证** [D]：执行 `node /usr/local/bin/dsh web --dump-config`（stdout 重定向到 `/tmp/composed.yml`）→ `wc -l = 1729`，`grep -cE '^\s*-?\s*(id|name):' = 742`，`exit=0`；stderr 只有 10 条无害的 `patch: entry "redteam-*" not found` 警告。**只读性实测**：`sha256sum /home/dsh/.dsh/profiles/web/package.json` 执行前后均为 `0aad16ad…e12`；`LINK_PROJECTION_DIR=".dsh-module-fallback"`（`:629`）在本 profile 不存在 → `removeLinkProjections`（`:637-645`）提前 return；`normalizeShippedProfile`（`:946-955`）只对 `INSTALLATION_OWNED_PROFILE_TUPLES` 中的 `headless` 生效，web profile 有 13 个自定义 bundles 不匹配 → 不写 manifest。
- **补注** [D]：本次重试 `{"offset":25,"limit":25}`、`{"name":"@deepseek-ai/dsh-web"}` 仍报 `Host Cordis inspect Config.listConfigs rejected input: "input" must be an object`；11-04 已测得 `Service.listService` 带 input 同样报错 → **是宿主 Inspect 通道对 input 的通用序列化/校验缺陷，不是 Config 方法本身**。

**新证据（决定性，直接补强 §4.3 差异 #2）**：从 dump 出的完整树中检出唯一 `id: web`（`/tmp/composed.yml:562-565`）：

```yaml
# == @deepseek-ai/dsh-base, patched by @240xu/dsh-websearch
- id: web
  name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: unified
# == @deepseek-ai/dsh-base
- id: web-search-deepseek
```

全文 `searchProvider` **仅 1 处**（:565），`fetchProvider` **0 处**。这是 §4.3 表中「bundle patch 用整体替换把 `fetchProvider: http` 一起丢掉」的**运行时组合树级铁证**，而非此前由 Loader 语义推断得出。

### B. 缺口 2：`web_fetch` 因 `fetchProvider` 丢失是否真触发 `WEB_PROVIDER_AMBIGUOUS` —— **确认触发，上文 §7.2(D) 待确认项可结案**

**结论（四联）**：
- **结论**：**是。当前 GUI 的 `web_fetch` 工具 100% 失败**，错误为 `Error: multiple usable web providers are registered (deepseek-fetch-api, http); configure one explicitly`（错误码 `WEB_PROVIDER_AMBIGUOUS`）。根因是 §A 证实的 `fetchProvider: http` 被 bundle patch 丢弃，而运行时同时注册了 2 个可用 fetch provider，seam 的「无显式配置则要求恰好 1 个可用」规则被打破。
- **依据** [A]：`/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web/lib/index.js:38`（注释 "No id configured, multiple usable providers → WEB_PROVIDER_AMBIGUOUS"）、`:112`（`const configuredId = this.config.fetchProvider.get() ?? this.fetchProviderEnv`；undefined 时走自动选择）、`:134`（`if (usable.length > 1) throw new WebError(\`multiple usable web providers are registered (...); configure one explicitly\`, "WEB_PROVIDER_AMBIGUOUS")`）；两个 provider 的注册点 [A] `dsh-web-fetch-http/lib/index.js:678`（`ctx.web.registerFetchProvider(new HttpFetchProvider(limits))`）与 `dsh-web-deepseek-api/lib/index.js:305,386`（`DEEPSEEK_FETCH_API_PROVIDER_ID = "deepseek-fetch-api"` + `registerFetchProvider`）。
- **代码落点** [A]：`/tmp/composed.yml:562-565`（`id: web` config 无 `fetchProvider`）+ `dsh-web/lib/index.js:112,134`。
- **验证** [D]：本附录会话实跑 `web_fetch({url:"https://example.com"})` → 返回上述 `Error: multiple usable web providers are registered (deepseek-fetch-api, http); configure one explicitly`。**注意**：这是 `web_fetch` 工具层失败，**与 `web_search` 走 unified 无关**；上文 §7.1(D) 曾标「可能触发，也可能自动选中」，现可确定为前者。
- **附带修正（对上文 §0 的补充，非推翻）**：上文 §0 说「`web_search` 事实不可用」，仍成立；但**应补一句「`web_fetch` 同样不可用，且原因不同（provider 歧义而非后端全挂）」**。[C/D] 上文 §7.2 的「待确认」项 #3 现结案。
- **E（仍待核实）**：`dsh-web-fetch-http` 与 `deepseek-fetch-api` 的 `available()` 为何同时为 true（后者依赖账号凭据），未逐行追；以及 `DSH_WEB_FETCH_PROVIDER` env 是否可显式指定（源码 `dsh-web/lib/index.js:54-59` 有 `fetchProviderEnv` 但本次未设）。修复方式推断为在 bundle patch 中 restate `fetchProvider: http`，**属改动建议，未执行**（只读约束）。

### C. 缺口 3：403 / 301 的网络层归因 —— **已定位到客户端 TLS 指纹，并被 2.8.8 源码自证**

这是本次续研的最大收获。上文/§_SKELETON:67 把 403 归因为「插件 2.8.4 代理/TLS 指纹链路」但标 **E（强推断未抓包）**；本次升级为 **A+C+D 级实证链**。

#### C.1 排除法实测（全部只读 curl / Node 内联脚本）

| 变体 | 目标 | 结果 | 排除掉了什么 |
| --- | --- | --- | --- |
| `curl` 默认 UA、`protocolVersion 2024-11-05`（Lead 基线） | exa | **HTTP 200** | 上游端点故障 |
| `curl` + UA `dsh-websearch/2.3` + `protocolVersion 2025-06-18`（插件精确 headers） | exa | **HTTP 200** | UA / MCP 协议版本 |
| 同上 | parallel | **HTTP 200** | 同上（两端一致） |
| `curl` + `User-Agent:` 空 | exa | **HTTP 200** | UA 有无 |
| `curl --http1.1` + 完整 initialize body | exa | **HTTP 200**（ALPN `http/1.1`） | HTTP/2 vs HTTP/1.1 |
| `curl -v` | exa | `CONNECT 200` → TLSv1.3 / `TLS_AES_256_GCM_SHA384` / X25519 / ALPN h2 → `subject: CN=mcp.exa.ai`, `issuer: Google Trust Services WE1` | 证书/代理链路本身 |
| **直接 `import` 本机 2.8.4 的 `lib/util/egress-fetch.js`**，用完全相同的 headers/body 调 `egressFetch()` | exa + parallel | **HTTP 403**，返回体 `<html><head><title>403 Forbidden</title></head>…<center><h1>403 Forbidden</h1></center><hr><center>cloudflare</center>` | —— **这就是故障本体** |
| 同一 `egressFetch` 4 组 headers 变体（plugin-exact / no-ua / curl-ua / +Connection） | exa | **4/4 全 403** | 任何 header 组合 |
| 裸 `node:https.request` over `http.request(CONNECT)`，UA 伪装成 curl | exa | **HTTP 403 / server=cloudflare** | 当时判为「锁定到 Node TLS 栈」；**2026-11-06 裁决**：缺 `Host` 头才是变量，见文末附记 |
| `python3 http.client` + `set_tunnel`（无 TLS） | exa/parallel | **HTTP 400 "plain HTTP request was sent to HTTPS port" / server=cloudflare** | 佐证 Cloudflare 在链路末端、按客户端形态区别对待 |

**四联（C.1 主结论）**：
- **结论（⚠️ 2026-11-06 已证伪，见文末「附记 · Lead 裁决」；本段保留为排除法过程记录）**：403 **不是上游 MCP 端点拒绝、不是 UA、不是 MCP 协议版本、不是 HTTP 版本、不是出口 IP**——这部分排除法仍然成立；但「由 Node/OpenSSL 发起的 TLS ClientHello 指纹被 Cloudflare 拒绝」**不成立**：同一 CONNECT 通道、同一 TLS 栈，仅补 `Host` 头即 200（`WITHOUT Host: 403` / `WITH Host: 200`），真因是 `egress-fetch.js:276` 删 Host 头。curl（不同 TLS 指纹）在完全相同代理/headers/目标下 200 的现象，实为 curl 自动带 Host 头所致。
- **依据** [B/C] Cloudflare 403 HTML 中的 `<center>cloudflare</center>`（curl `-v` 与 Node 复现均见 `server: cloudflare`）；[C] `2.8.8` 的 `lib/util/egress-fetch.js` 头注释（见 C.2）。
- **代码落点** [A]：本机 2.8.4 `lib/util/egress-fetch.js` 的 `httpsViaConnect()`（约 `:120-190`，`https.request({socket, agent:false, servername, ...})`）+ `lib/util/mcp-client.js:11-12,52-68`（`UA="dsh-websearch/2.3"`、`PROTOCOL_VERSION="2025-06-18"`、`redirect:"error"`）。
- **验证** [D]：上表 9 组实跑；`node -v = v22.20.0`、`process.versions.openssl = 3.5.2`。

#### C.2 2.8.8 源码自证（把 E 升级为 C+A）

**四联**：
- **结论**：`@240xu/dsh-websearch@2.8.8` 的 `egress-fetch.js` **在文件头注释里明确写出本次故障的成因**，并新增 TLS-egress forwarder（用 Chromium TLS 栈的 sidecar 转发）作为修复；2.8.4 无此代码路径，故本机 env 里虽已设 `DSH_EGRESS_FORWARDER` 也不生效。
- **依据** [C]：`npm pack @240xu/dsh-websearch@2.8.8`（只读，解包到 `/tmp/ws288`）；`npm view @240xu/dsh-websearch version` → `2.8.8`（2026-11-05 复核，与 11-04 一致）；`dist-tags.latest=2.8.8`；`npm time` 序列 `2.8.4`(10-18 06:02Z) → `2.8.8`(10-21 14:10Z)。[C] 与 [_SKELETON.md](_SKELETON.md):62 的 commit 链 `5c828745`(2.8.4) → `fc737d22`(2.8.5 TLS-egress forwarder) → `592237f7`(2.8.6 node:http 修 dispatcher-hijack) 吻合。
- **代码落点** [A]：2.8.8 `lib/util/egress-fetch.js` 新增头注释（逐字）：`Optional TLS-egress forwarder: when DSH_EGRESS_FORWARDER is set (a local sidecar exposing a POST /fwd API backed by a Chromium TLS stack) … This exists because some upstreams (Exa, DuckDuckGo) gate on the client TLS fingerprint (JA3) rather than on the exit IP; the Node TLS fingerprint is rejected where a real browser's is accepted.`；`egressFetch()` 首行改为 `const forwarder = forwarderFor(url); if (forwarder !== undefined) return forwarderFetch(...)`；`forwarderFor()` 读 `DSH_EGRESS_FORWARDER` / `DSH_EGRESS_FORWARDER_PROXY`；新增 `forwarderFetch()` / `forwarderExchange()` / `forwarderTimeoutMs()`（POST `/fwd` + `x-sidecar-spec` base64）。本机 2.8.4 的 `egressFetch()` **无此分支**（`diff -u` 首段显示新增 100+ 行）。
- **验证** [D]：`diff -u <本机 2.8.4> <2.8.8>` 输出确认上述差异；本机 `package.json:3 = 2.8.4`；[D] 进程 environ 键名复核：`DSH_EGRESS_FORWARDER` **SET**、`DSH_EGRESS_FORWARDER_PROXY` **SET**（11-04 §5.4 只列了后者，**漏列前者，此处补正**）；`ss -ltnp` 见 `127.0.0.1:9223` 监听，但 `POST http://127.0.0.1:9223/fwd` 返回 **404** → **该监听不是 2.8.8 期望的 `/fwd` sidecar，或不兼容**。[D] 2.8.8 的 `cordis.patch.yml` 与 2.8.4 **逐字相同**（仍只有 `searchProvider: unified`，**没有 restate `fetchProvider`**）→ **升级到 2.8.8 不能修复 §B 的 web_fetch AMBIGUOUS**。
- **E（保留限定语）**：① `127.0.0.1:9223` 的具体进程未能从 `ss` 归属到 PID（`ss -ltnp` 该行无 `pid=` 字段，属其他用户/命名空间），`/fwd` 404 说明它不提供 2.8.8 需要的接口；因此**「升级到 2.8.8 即可修好 exa/parallel 403」仍属推断**——即使升级，还需一个兼容的 Chromium-TLS sidecar 监听在 `DSH_EGRESS_FORWARDER` 所指地址。② 本次未做 TLS 抓包（无 tcpdump 权限/未提权），"TLS ClientHello 指纹" 是排除法 + 2.8.8 源码注释的**双重佐证**，非逐字节 JA3 比对。③ 未升级、未启 sidecar、未改 env（只读约束）。

#### C.3 301 与 SearXNG 的精确定性（补上文 §7.1(B)）

**四联**：
- **结论**：`ddg` 的 301 **不是端点故障，是插件自己的 `redirect:"error"` 策略在 egressFetch 层主动抛错**；`searxng` 的「invalid JSON」是 **`searx.be` 返回浏览器校验 HTML 页**（反爬），不是 JSON 解析 bug。
- **依据** [A]：本机 2.8.4 `lib/backends/ddg.js:38-40`（`egressFetch(DDG_ENDPOINT, {…, redirect:"error"})`）；`lib/util/egress-fetch.js` 的 `tunneledFetch()`：`if (REDIRECT_STATUS.has(response.status)) { … if (init.redirect === "error") { await drain(response); throw new TypeError(\`fetch failed: redirect mode is set to error (${response.status})\`); } }`；`lib/backends/searxng.js:89-91`（`response.json()` 失败 → `new WebError("SearXNG: invalid JSON response", "WEB_PROVIDER_ERROR")`）。
- **代码落点** [A]：同上；`lib/util/mcp-client.js` 的 `ensureSession()` 也用 `redirect:"error"`（故 exa/parallel 若被 302 也会同样失败，但本次观测是 403）。
- **验证** [D]：`curl -D - 'https://html.duckduckgo.com/html/?q=test'` → `HTTP/2 202`、`server: nginx`、`content-type: text/html`（DDG 该路径本次未直接返 301，但插件的 `redirect:"error"` 对任何 3xx 都会抛错，属**预期安全行为**，与 [00-lead-live-probe.md](00-lead-live-probe.md):102 判断一致）；`curl -D - 'https://searx.be/search?q=test&format=json&…'` → **HTTP 200 但 `content-type: text/html`**，正文为 `<!doctype html>…<title>Verifying your browser…</title><!-- No-JS visitors are sent to the image captcha -->` → **这就是 `invalid JSON response` 的真实内容**。
- **E**：DDG 301 的 `Location` 目标本次未取到（curl 走的是 202 分支，与插件 Node 客户端路径不同）；上游是否对 Node UA 单独返 301 未逐包确认。

### D. 缺口 4：2.8.5–2.8.8 的 CHANGELOG 内容 —— 已取到部分，但本机 npm tarball 不含独立 CHANGELOG

**四联**：
- **结论**：`npm pack` 的 2.8.8 tarball **`files` 不含 `CHANGELOG.md`**（只有 `lib/`、`examples/`、`README.md`、`LICENSE`、`cordis.patch.yml`、`package.json`）；版本演进细节在 `README.md` 的 "What's new" 分节，本机可查到的最高到 **v2.8.3**（2.8.4–2.8.8 的条目不在包内 README）。**但 2.8.5/2.8.6 的修复内容已由源码 diff 直接证实**（§C.2），比 CHANGELOG 更硬。
- **依据** [C]：`/tmp/ws288/package/package.json` 的 `files` 数组；`README.md` 分节标题 `## v2.8.3 · Bug 猎场修复第二批`、`## v2.8.2 · Bug 猎场修复`、`## v2.8.1 SettingsForms 适配`、`## v2.8.0 查全查多`、`## v2.7.3 …`；`npm view @240xu/dsh-websearch time` 给出 2.8.4–2.8.8 的发布时间。
- **代码落点** [A]：`/tmp/ws288/package/lib/util/egress-fetch.js` 头注释 + `forwarderFetch()`（2.8.5/2.8.6 的落点）；`lib/util/mcp-client.js` 的 UA/协议版本在 2.8.4 与 2.8.8 **完全相同**（`dsh-websearch/2.3` / `2025-06-18`）→ 证明修复**不在 UA 层**，与 §C.1 排除法一致。
- **验证** [D]：`npm pack` + `tar -xzf` + `find`/`grep` 实跑；`grep -n 'const UA|const PROTOCOL_VERSION'` 两版本对照。
- **E**：2.8.5/2.8.6/2.8.7/2.8.8 逐版本的完整 CHANGELOG 需远端 GitHub（[08-own-repo.md](08-own-repo.md) / [12-change-lineage.md](12-change-lineage.md) 已由其他成员负责，本次不重复拉取）。README 中 2.8.0 还记录了 `ddg` 超时上限由 5s 上调至 8s（`:158`），本机 2.8.4 的 `provider.js:38-41` 仍是 `ddg: 5000` → **这是 2.8.4 与远端 README 描述的一个版本差异**，但与当前 403/301 故障无因果关系。

### E. 缺口 5–7 与新增缺口的结案状态

| §7.2 原编号 | 缺口 | 结案状态 | 依据 |
| --- | --- | --- | --- |
| 1 | Config 220 条只读 25 条 | ✅ **已绕过并定位根因**（§A）：`--dump-config` 导出 1729 行完整树；Inspect input 缺陷是宿主通道通用问题 | [A] `bin.js:105` / `dump-config-CWs_HdOc.js:27`；[D] hash 前后一致 + 1729 行 |
| 2 | `client *` Provider 未查询 | ⏸ **仍未做**（需页面在线，可能超时）；本报告结论不依赖 | [E] 保留 |
| 3 | `web_fetch` 是否 AMBIGUOUS | ✅ **确认触发**（§B）：实跑返回 `multiple usable web providers are registered (deepseek-fetch-api, http)` | [D] 实跑；[A] `dsh-web/lib/index.js:112,134` + `/tmp/composed.yml:562-565` |
| 4 | 2.8.5–2.8.8 CHANGELOG | 🟡 **部分结案**（§D）：tarball 无 CHANGELOG，但 2.8.5/2.8.6 修复由源码 diff 证实 | [C] npm `files`；[A/D] `egress-fetch.js` diff |
| 5 | 403/301/非 JSON 网络层归因 | ✅ **主因定位**（§C）：Node/OpenSSL TLS 指纹被 Cloudflare 拒；301 是插件 `redirect:"error"`；searxng 是浏览器校验 HTML | [D] 9 组排除法 + Node/PY 复现；[C/A] 2.8.8 源码头注释自证 |
| 6 | `--patch lan-trust` 是否影响 trust fence | 🟡 **部分**：本次用 `127.0.0.1` + auth cookie 稳定 200；未隔离 LAN IP 变量 | [D] `/api/*` 实跑；[E] 保留，不影响主结论 |
| 7 | 历史 6 条 `backendsOk:3/4` 是哪些后端成功 | ⏸ **仍未逐条定位**（`history.json` 按设计只存聚合计数，见 README:191）；但 11-05 重启后 health 清零再次印证「遥测纯内存」 | [E] 保留 |

**新增缺口（本次发现）**：
- **[E]** `127.0.0.1:9223` 的监听进程身份未确认（其他用户/命名空间），且 `/fwd` 返回 404 → 现有 `DSH_EGRESS_FORWARDER` env 与 2.8.8 期望的 sidecar 协议**可能不匹配**；这是「升级能否修好」的关键未知数。
- **[E]** 未做 TLS 抓包，JA3 级比对未执行；403 归因是排除法 + 上游源码注释 + Cloudflare 响应体三重佐证，非字节级证明。
- **[D→建议，未执行]** 最小修复面有两条且互相独立：① 在 `@240xu/dsh-websearch` 的 bundle patch 中 restate `fetchProvider: http`（修 `web_fetch` AMBIGUOUS）；② 升级 2.8.4 → 2.8.8 **并**确保 `DSH_EGRESS_FORWARDER` 指向兼容的 Chromium-TLS sidecar（修 exa/parallel 403）。**均属改动建议，本次一行未改。**

### F. 附录证据清单（追加，全部 2026-11-05 实跑）

- `ps -p 2200` → 不存在；`ps -eo pid,user,args | grep '[d]sh web'` → PID 2085，`Thu Nov 5 18:37:15`
- `curl -o /dev/null -w "%{http_code}" http://127.0.0.1:3080/` → `401`
- `/proc/2085/environ` 键名 → 新增确认 `DSH_EGRESS_FORWARDER` **SET**（11-04 §5.4 漏列，此处补正）
- `sha256sum /home/dsh/.dsh/profiles/web/package.json` → 前后均 `0aad16addfae52ed8b82476a23806ab3733ec6145b3e5c07f9ee0f68b71dee12`
- `node /usr/local/bin/dsh web --dump-config > /tmp/composed.yml` → `1729` 行 / `742` 个 `id|name` 行 / `exit=0`；`:562-565` = `id: web` 仅 `searchProvider: unified`；全文 `fetchProvider` **0 处**
- `web_fetch({"url":"https://example.com"})` → `Error: multiple usable web providers are registered (deepseek-fetch-api, http); configure one explicitly`
- `curl -X POST https://mcp.exa.ai/mcp`（默认 UA / 2024-11-05）→ `HTTP 200` `event: message`
- `curl -X POST … -H 'User-Agent: dsh-websearch/2.3'` + `protocolVersion 2025-06-18` → exa `200`；parallel `200`
- `curl --http1.1` + 完整 body → `HTTP 200`（ALPN `http/1.1`）；`curl -H 'User-Agent:'` → `HTTP 200`
- `curl -v` → `CONNECT 200` / TLSv1.3 `TLS_AES_256_GCM_SHA384` / X25519 / ALPN h2 / `CN=mcp.exa.ai` / issuer `Google Trust Services WE1`
- `node --input-type=module -e 'import {egressFetch} …'`（本机 2.8.4 模块）→ exa/parallel 均 `STATUS=403 CT=text/html`，body `<center>cloudflare</center>`；4 组 headers 变体全 403
- 裸 `node https.request` over `http.request(CONNECT)` → `STATUS=403 SERVER=cloudflare`
- `python3 http.client.set_tunnel()`（无 TLS）→ `HTTP 400 "plain HTTP request was sent to HTTPS port" / server=cloudflare`
- `curl -D - 'https://searx.be/search?…&format=json'` → `HTTP 200` 但 `content-type: text/html`，`<title>Verifying your browser…</title>`
- `curl -D - 'https://html.duckduckgo.com/html/?q=test'` → `HTTP/2 202` / `server: nginx`
- `npm view @240xu/dsh-websearch version` → `2.8.8`；`npm pack @240xu/dsh-websearch@2.8.8` → `/tmp/ws288/`
- `diff -u <2.8.4 egress-fetch.js> <2.8.8 egress-fetch.js>` → 新增 forwarder 分支 + 头注释「gate on the client TLS fingerprint (JA3) … Node TLS fingerprint is rejected where a real browser's is accepted」
- `/tmp/ws288/package/cordis.patch.yml` → 与 2.8.4 逐字相同（仍无 `fetchProvider`）；`package.json` `files` 无 `CHANGELOG.md`
- `grep 'const UA|PROTOCOL_VERSION'` 两版本 → 均 `dsh-websearch/2.3` / `2025-06-18`
- `GET /api/unified-search/health`（新 token 换 `dsh-auth-<hash>` cookie）→ `enabled:4 keyless:4`，4 后端 `reachable:null / lastError:null`（重启清零）
- `GET /api/unified-search/settings` → `ok:true namespace:dsh-websearch revision:0 applies:live user:{}`
- `ss -ltnp` → `127.0.0.1:9223` 监听；`POST http://127.0.0.1:9223/fwd` → `HTTP 404`
- `node -v` → `v22.20.0`；`node -p process.versions.openssl` → `3.5.2`

*附录完。上文 §0–§9 未被改动（与本目录 `.baseline-20261105-2006/02-runtime-state.md` 逐字一致，续研前已 `diff -q` 校验）。无 token / 密钥值出现在任何输出。*

---

## 附记 · Lead 裁决（2026-11-06，只追加，不改动上文任何一行）

**上文附录 §C（第 495–511 行）把 403 归因于「Node/OpenSSL TLS ClientHello 指纹被 Cloudflare 拒绝」——该结论已被后续一手 A/B 证伪，保留为排除法过程记录，最终口径以本附记为准。**

- 【A/D】本机 2.8.4 `lib/util/egress-fetch.js:276` 的 `normalizeHeaders()` 有 `delete headers["host"]`，而 `httpsViaConnect` 直接把该 headers 传进 CONNECT 隧道（**不像** `httpViaProxy:202` 补 `host: headers.host ?? target.host`）→ HTTPS 请求**缺 Host 头**被 Cloudflare 边缘拒。
- 【A/D，Lead 最小复现】同一 CONNECT 通道（`172.30.66.1:1091`）、同一 `node:https`/OpenSSL 3.5.2 栈、同一 UA、同一 body，**唯一变量是 Host 头**：`WITHOUT Host: 403` / `WITH Host: 200`。TLS 栈完全没变 ⇒ **与 JA3/TLS 指纹无关**；[08 附录 A.2](08-own-repo.md) 的 12 组实验（显式改 ALPN 仍 403、仅补 Host 即 200）独立互证。
- 【A】2.8.8 的 `normalizeHeaders` **仍删 Host**，无 forwarder 时同样 403；当前进程已设 `DSH_EGRESS_FORWARDER`/`_PROXY` 但 2.8.4 代码里 forwarder 关键字计数 0（env 被静默忽略）。
- ⇒ 正确结论：**P0 升级须「升到 ≥2.8.5 且 sidecar 可达 + `DSH_EGRESS_FORWARDER_PROXY` 已配」**，或零部署依赖的 E 级备选「补 `headers.host ?? target.host`」；**单升版本不够**。2.8.5 CHANGELOG 的「JA3 指纹」是作者当时的假设，不是可复现机制。
- 【仍 E】CF 具体 WAF 规则编号、`forwarderFor` spec 与 sidecar 逐字段一致性、升级后是否恢复。另用户仓库 open 的 [PR #7](https://github.com/240xu/dsh-websearch/pull/7) / [Issue #8](https://github.com/240xu/dsh-websearch/issues/8) 说明 2.8.8 在 DSH 0.2.x 上设置 inert / 存不了 API Key，「升级即修复」必须继续标 E。

详见 [REPORT.md](REPORT.md) 执行摘要 3 / §5 与 [11 裁决附录](11-traceability-audit.md)。本附记无凭证值、未改上文。

