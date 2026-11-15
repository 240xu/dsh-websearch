# 22 · 落地预演与可评审草案（Execution Drafts）

> 采样：2026-11-06（Asia/Shanghai） · 角色：专精执行者子代理 · 唯一产出文件：`/home/ova/dsh/.artifacts/websearch-research/22-execution-drafts.md`
> 用户核心要求（经 Lead 传达）：「所有 dsh web search 的改动都要有迹可循，都要有可靠资料做支撑，做详细的标注」。本文件每份草案均按 **A/B/C/D/E 证据等级 + 四联标注**（结论 → 依据 → 代码落点 → 验证）书写。

## 0. 执行边界声明（先读）

**本文件只交付「可评审的代码/配置草案」，不实施任何一项。** 本次会话全程只读：

| 禁止项 | 状态 |
| --- | --- |
| 写入插件目录 `/home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/lib/**` | ✅ 未写 |
| 写入 `~/.dsh/profiles/web/cordis.patch.yml`、`package.json`、任何 `lib/` | ✅ 未写 |
| `pnpm install` / 升级版本 / 改 `package.json` 依赖 | ✅ 未执行 |
| 重启 `dsh web` / 改环境变量 / 部署 sidecar | ✅ 未执行 |
| 修改其它报告（01–12 / 99 / REPORT） | ✅ 未写 |
| 把 token / 口令 / API Key 值写入报告或输出 | ✅ 未写（仅出现 env 变量**名**，如 `FIRECRAWL_API_KEY`） |

唯一写操作是本文件自身；唯一执行过的外部动作是 **§1 的只读最小 A/B 脚本**（临时文件 `/tmp/ws22-host-ab.mjs`，跑完已删除），以及若干 `curl`/`dsh web --dump-config`/`node -p` 只读探测。

**权威输入**：[99-final-verdicts.md](99-final-verdicts.md)（裁决 1 缺 Host / 裁决 2 P0 四条 / 裁决 3 web_fetch / 裁决 6 Firecrawl keyless B 级）、[09c §4](09c-opencode-integration.md)、[09 附录 C-4](09-opencode-endpoints.md)、[05 续研 A.2](05-search-backends.md)、[08 附录 A.2](08-own-repo.md)、[02 附录 A/B](02-runtime-state.md)、[REPORT §4.3/§5](REPORT.md)。本机源码基线：`@240xu/dsh-websearch` **2.8.4**（只读 `read`，见 §8 索引）。

---

## 1. 只读复现：403 缺 Host 的最小 A/B

### 1.1 完整可运行脚本（代码块，不落盘到产物目录）

```js
// /tmp/ws22-host-ab.mjs —— 只读 A/B，唯一变量是 Host 头
import http from 'node:http';
import https from 'node:https';

const proxy = new URL('http://172.30.66.1:1091');
const target = new URL('https://mcp.exa.ai/mcp');
const body = JSON.stringify({
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'probe', version: '1' },
  },
});

function probe(withHost) {
  return new Promise((resolve) => {
    const req = http.request({
      host: proxy.hostname,
      port: Number(proxy.port),
      method: 'CONNECT',
      path: `${target.hostname}:443`,
    });
    req.on('connect', (res, socket) => {
      if (res.statusCode !== 200) { socket.destroy(); return resolve('CONNECT ' + res.statusCode); }
      const headers = {
        'content-type': 'application/json',
        'accept': 'application/json, text/event-stream',
        'content-length': String(Buffer.byteLength(body)),
        'user-agent': 'dsh-websearch/2.3',
      };
      if (withHost) headers.host = target.host; // ← 唯一变量
      const r = https.request({
        socket, agent: false, servername: target.hostname,
        method: 'POST', path: '/mcp', headers,
      });
      r.on('response', (x) => {
        x.resume();
        x.on('end', () => resolve(String(x.statusCode)));
      });
      r.on('error', (e) => resolve('ERR ' + e.message));
      r.setTimeout(15000, () => { r.destroy(); resolve('TIMEOUT'); });
      r.end(body);
    });
    req.on('error', (e) => resolve('ERR ' + e.message));
    req.setTimeout(15000, () => { req.destroy(); resolve('TIMEOUT'); });
    req.end();
  });
}

console.log('WITHOUT Host:', await probe(false));
console.log('WITH    Host:', await probe(true));
```

### 1.2 真实实测输出（2026-11-06 12:4x，本机 `node` 实跑）

```
WITHOUT Host: 403
WITH    Host: 200
exit: 0
(temp script removed)
```

【**D 级实测**】通道为 `172.30.66.1:1091` CONNECT、同一 `node:https`/OpenSSL 栈、同一 UA `dsh-websearch/2.3`、同一 initialize body；**唯一变量 Host 头**。⇒ 与 [99 裁决 1](99-final-verdicts.md)、[08 附录 A.2](08-own-repo.md) 的 12 组实验独立互证：**403 的可复现真因是缺 Host 头被 Cloudflare 边缘拒，不是 TLS/JA3 指纹**。临时脚本跑完已 `rm -f`，未留持久状态。

> 若换网络不通的环境：预期输出仍为 `WITHOUT Host: 403` / `WITH Host: 200`；若 CONNECT 本身失败则两行均为 `CONNECT <code>` 或 `TIMEOUT`，此时**不得宣称已复现**，须如实标注并回到 99 裁决 1 的证据链。

---

## 2. 草案 A · 修 `web_fetch` 的 `WEB_PROVIDER_AMBIGUOUS`

> **⚠️ 2026-11-06 13:00 修订（[Lead 裁决 9 / 24-p0-landing-correction.md](24-p0-landing-correction.md) 已用一手源码核验）**：本节原只给「改 yml」一解，**现以「优先设 `DSH_WEB_FETCH_PROVIDER=http` 零文件编辑」为默认解**，yml 路线为备选。凡 99 裁决 2 / REPORT / 09c / 00 / 02 中「P0① = 改 `cordis.patch.yml` 补 fetchProvider」的旧表述，一律以裁决 9 为准。

### 2.1 落点的关键发现（必须先说清，否则草案会改错文件）

- 【A】发布版 `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-base/cordis.patch.yml:467-471` 的 `- id: web` **原本就有** `fetchProvider: http`：
  ```yaml
  - id: web
    name: '@deepseek-ai/dsh-web'
    config:
      searchProvider: deepseek-official
      fetchProvider: http
  ```
- 【A/D】`~/.dsh/profiles/web/cordis.patch.yml` 里**没有** `- id: web` 条目（grep 0 命中）；真正 override 来自**插件自带的 bundle patch** `/home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/cordis.patch.yml:10-13`：
  ```yaml
  - id: web
    name: '@deepseek-ai/dsh-web'
    config:
      searchProvider: unified
  ```
- 【A/D】`dsh web --dump-config`（只读，1729 行）第 562–565 行实证组合树：
  ```yaml
  # == @deepseek-ai/dsh-base, patched by @240xu/dsh-websearch
  - id: web
    name: '@deepseek-ai/dsh-web'
    config:
      searchProvider: unified
  ```
  全文 `fetchProvider` **0 处**（`grep -c` 返回 0）。[99 裁决 3](99-final-verdicts.md) / [02 附录 A](02-runtime-state.md) 已实跑 `web_fetch` 返回 `WEB_PROVIDER_AMBIGUOUS`。
- 【B】官方 upgrade-guide「A patch replaces the matched row's whole `config`」（`docs/upgrade-guide/v0.2.1-alpha.1/web-listener-trust-config/guide.md:20`）⇒ 插件 patch **整体替换**了 base 的 `config`，抹掉 `fetchProvider: http`。
- 【A】发布版 `dsh-web/lib/index.js:45,55,60,115` 逐字（本会话独立核验）：
  ```
  * `$DSH_WEB_SEARCH_PROVIDER` / `$DSH_WEB_FETCH_PROVIDER` are equivalent to ...
  this.fetchProviderEnv = process.env.DSH_WEB_FETCH_PROVIDER;              // :60
  const configuredId = this.config.fetchProvider.get() ?? this.fetchProviderEnv;  // :115
  ```
  ⇒ **可用环境变量 pin，无需改任何 yml**。

### 2.1a 解 A1（**默认推荐 · 零文件编辑**）【A，Lead 裁决 9】

给 `dsh web` 进程设 **`DSH_WEB_FETCH_PROVIDER=http`**（`DSH_WEB_SEARCH_PROVIDER` 同理），即可令 `configuredId` 有值、绕开「无显式配置须恰好 1 个可用 provider」的歧义分支。

```sh
# 示意（需重启 dsh web 才生效；本报告未执行）
DSH_WEB_FETCH_PROVIDER=http dsh web --patch /opt/dsh-plugins/lan-trust.patch.yml \
  --no-open --host 127.0.0.1 --port 3080 \
  --trusted-host 192.168.1.165 --trusted-host dsh.sepic.space
```

- **优点**：不动任何文件；回滚成本最低（取消 env 再重启）。
- **代价**：设进程 env 需**重启 `dsh web`**（改状态，见 §7 门槛 4，**必须用户批准**）；`dsh web --dump-config` 的 `id: web` 不一定显式出现 `fetchProvider: http`（env 不进 config 树），验收应以**实跑 `web_fetch` 返回 200 内容**为准（[24 裁决 9 §2](24-p0-landing-correction.md)）。

### 2.1b 解 A2（yml 路线 · 备选，需用户批准）

**落点**：在 `/home/dsh/.dsh/profiles/web/cordis.patch.yml` **末尾新增**一个 `- id: web` 条目并 **restate 完整 config**，利用「profile patch 在 bundle patch 之后应用」的 Loader 顺序覆盖〔B/C，`docs/cordis-primer.md` + [02 附录 A](02-runtime-state.md) 组合树证据〕。

```yaml
# 修改前：/home/dsh/.dsh/profiles/web/cordis.patch.yml 末尾（无 - id: web 条目）
# ...（现有 398 行保持不变）...

# 修改后：在文件末尾追加（需用户批准才执行）
- id: web
  name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: unified
    fetchProvider: http      # ← restate；否则整体替换语义会再抹掉一次
```

> ⚠️ **不要**改插件自带 `node_modules/@240xu/dsh-websearch/cordis.patch.yml`（A2 的反面）：`pnpm install` / 升级 2.8.8 会覆盖回去，且 2.8.8 的 bundle patch 与 2.8.4 逐字相同、仍无 fetchProvider（[99 裁决 2](99-final-verdicts.md)）。改 `node_modules` 亦属 §7 门槛 2，必须批准。

### 2.2 应用后 `dsh web --dump-config` 的预期片段（仅解 A2 适用）

```yaml
# == @deepseek-ai/dsh-base, patched by @240xu/dsh-websearch
- id: web
  name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: unified
    fetchProvider: http      # ← 新增；组合树里 fetchProvider 从 0 处变 1 处
```

| 四联 | 内容 |
| --- | --- |
| 结论 | pin fetch provider（A1 env 或 A2 yml restate）可消除 `web_fetch` 的 `WEB_PROVIDER_AMBIGUOUS` |
| 依据 | 【A】发布版 `dsh-web/lib/index.js:60,115` + base bundle patch `fetchProvider: http`；【B】patch 整体替换 config 语义；【A/D】`--dump-config` 组合树 + `web_fetch` 实跑；[99 裁决 3](99-final-verdicts.md) / [24 裁决 9](24-p0-landing-correction.md) |
| 代码落点 | A1：`dsh web` 启动 env（零文件）；A2：`~/.dsh/profiles/web/cordis.patch.yml` 末尾 |
| 验证 | A1：实跑 `web_fetch({url:"https://example.com"})` 不再报 AMBIGUOUS；A2：另加 `dsh web --dump-config \| grep -A4 'id: web'` 出现 `fetchProvider: http` |

---

## 3. 草案 B · 最小代码修复（零部署依赖，E 级备选）

### 3.1 unified diff（`lib/util/egress-fetch.js`）

```diff
--- a/lib/util/egress-fetch.js
+++ b/lib/util/egress-fetch.js
@@ -167,7 +167,7 @@
       const request = https.request({
         socket,
         agent: false,
         servername: target.hostname,
         method,
         path: pathWithQuery(target),
-        headers,
+        headers: { ...headers, host: headers.host ?? target.host },
       });
       open.push(request);
```

- 【A】本机 2.8.4 `lib/util/egress-fetch.js:170-177` 现状即 `headers,`（直接透传被 `normalizeHeaders():276` 删掉 Host 的 headers）；`:202` 的 `httpViaProxy` **已有** `headers: { ...headers, host: headers.host ?? target.host }` —— 草案只是把同一写法对称补到 HTTPS/CONNECT 分支（符合 AGENTS.md「Prefer symmetry for parallel values」）。
- 【A/D】§1 的 A/B 已证：补 Host 即 200。
- 【E 级备选】**未实施、未提 PR**；属于插件源码改动（非 DSH 官方仓库），须由插件作者决定。2.8.8 的 `normalizeHeaders` 仍删 Host，故该补丁在 2.8.8 上同样适用。
- 注意：`normalizeHeaders()` 里的 `delete headers["host"]` **不要删**（那是防止外部传入伪造 Host 的既有契约）；只在**发出请求时**补回 `target.host`，语义是「以 URL 的权威主机名作为 Host」，与 `httpViaProxy` 完全一致。

### 3.2 最小单测草案（fixture，无 live network）

```js
// tests/egress-host-header.test.js（草案，不落盘）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { egressFetch } from '../lib/util/egress-fetch.js';

// 用本地 http server 充当 CONNECT 代理 + 回显收到的请求头，
// 断言「经 CONNECT 隧道的 HTTPS 请求带上了 Host 头」。
// 真实实现可用自签证书 + https.createServer({ key, cert }) 挂在 CONNECT socket 上；
// 此处给出断言骨架（fixture，无外部网络）：
test('httpsViaConnect injects Host header from target URL', async () => {
  // 1) 起本地 TLS echo server，记录 request.headers.host
  // 2) 起本地 CONNECT 代理，把 socket 桥接到 echo server
  // 3) 设 HTTP_PROXY 指向本地代理，调用 egressFetch('https://unit.test/', {...})
  // 4) 断言：
  assert.equal(recordedHost, 'unit.test', 'Host 必须来自 target.host');
  assert.ok(!('host' in rawUserHeaders), '用户传入的伪造 Host 仍应被 normalizeHeaders 删除');
});

test('httpViaProxy keeps its existing Host fallback (no regression)', async () => {
  // 对照：http:// 分支原本就有 host: headers.host ?? target.host，断言行为不变
  assert.equal(observedHost, 'unit.test');
});
```

> 【E】真实 fixture 需要本地自签证书与 `NODE_TLS_REJECT_UNAUTHORIZED` 处理；**本次未实现、未运行**。运行命令见 §6。

| 四联 | 内容 |
| --- | --- |
| 结论 | 在 `httpsViaConnect` 补 `host: headers.host ?? target.host` 可无需 sidecar 让 403→200 |
| 依据 | 【A/D】§1 A/B；【A】`egress-fetch.js:202` 的对称写法；[99 裁决 2](99-final-verdicts.md) E 级备选；[08 附录 A.2](08-own-repo.md) |
| 代码落点 | `lib/util/egress-fetch.js:170-177`（草案 B），`tests/egress-host-header.test.js`（新增） |
| 验证 | §1 A/B 脚本 + fixture 单测；**未执行**（只读约束） |

---

## 4. 草案 C · `firecrawl` backend（完整代码骨架 + 6 处登记）

### 4.1 `lib/backends/firecrawl.js`（完整骨架，代码块，不落盘）

结构对齐本机 `lib/backends/exa.js` / `parallel.js`：`export const <id>Backend = { id, requiresCredential, available(), async search(request, signal, options, hooks) }`、导出 `parseXxxResult`、调用 `mcpCall`、用 `WebError` 包装、`hooks.recordRequest/recordOutcome`、`headers` 不含 key。

```js
// lib/backends/firecrawl.js — Firecrawl search backend (streamable-http MCP).
// Endpoint: https://mcp.firecrawl.dev/v2/mcp  (official keyless hosted tier, B 级)
//   - tool: firecrawl_search { query, limit }
//   - response: result.content[0].text = JSON string
//       { success, data: { web: [{ url, title?, description? }] } }
// keyless: no credential header at all (server-side hosted tier).
// keyed:   Authorization: Bearer <FIRECRAWL_API_KEY>.
// NOTE: conversationId 回传（官方 initialize instructions）首版未实现，标 [E]。

import { mcpCall } from "../util/mcp-client.js";
import { WebError } from "@deepseek-ai/dsh-web";

const FIRECRAWL_ENDPOINT = "https://mcp.firecrawl.dev/v2/mcp";
const FIRECRAWL_TOOL = "firecrawl_search";

export const firecrawlBackend = {
  id: "firecrawl",
  requiresCredential: false, // keyless tier 可用；有 key 时自动带 Bearer

  available() {
    // 与 exa/parallel 一致：keyless，不做本地可达性探测（available() 只做配置检查）
    return true;
  },

  async search(request, signal, options, hooks = {}) {
    const baseURL = options?.baseURL ?? FIRECRAWL_ENDPOINT;
    const apiKey = await options?.resolveApiKey?.();
    const args = {
      query: request.query,
      limit: request.maxResults ?? 8,
    };
    // 认证头只在有 key 时注入；headers 里绝不出现 key 值本身（recordRequest 也不带）
    const extraHeaders = apiKey
      ? { Authorization: `Bearer ${apiKey}` }
      : {};

    hooks.recordRequest?.({
      endpoint: baseURL,
      toolName: FIRECRAWL_TOOL,
      body: args,
      headers: {}, // 遥测/历史不记凭证（沿用 exa.js 写法）
    });

    let result;
    try {
      result = await mcpCall(baseURL, FIRECRAWL_TOOL, args, extraHeaders, signal);
    } catch (err) {
      if (err instanceof WebError) throw err;
      throw new WebError(
        `firecrawl search failed: ${String(err?.message ?? err)}`,
        "WEB_PROVIDER_ERROR",
        { cause: err },
      );
    }

    if (result?.isError === true) {
      const message = String(result.content?.[0]?.text ?? "unknown");
      hooks.recordOutcome?.({ status: "error", message });
      throw new WebError(`firecrawl returned an MCP error: ${message}`, "WEB_PROVIDER_ERROR");
    }

    const sources = parseFirecrawlResult(result, request.maxResults ?? 8);
    hooks.recordOutcome?.({ status: "ok", count: sources.length });
    return { sources, content: undefined, truncated: false };
  },
};

export function parseFirecrawlResult(result, maxResults) {
  const text = result?.content?.[0]?.text;
  if (typeof text !== "string" || text.length === 0) return [];
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (parsed?.success === false) return [];
  const web = Array.isArray(parsed?.data?.web) ? parsed.data.web : [];
  const sources = [];
  for (const item of web) {
    if (typeof item?.url !== "string" || item.url.length === 0) continue;
    const source = { url: item.url };
    if (typeof item.title === "string" && item.title.length > 0) source.title = item.title;
    if (typeof item.description === "string" && item.description.length > 0) {
      source.snippet = item.description.length > 240
        ? item.description.slice(0, 240) + "…"
        : item.description;
    }
    sources.push(source);
    if (sources.length >= maxResults) break;
  }
  return sources;
}

export default firecrawlBackend;
```

**依据链**：【A】[`anomalyco/opencode/blob/v2.2.5/.../firecrawl.ts`](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/firecrawl.ts) 逐字（`endpoint` / `firecrawl_search` / `{query,limit:8}` / `data.web[{url,title,description}]` / 有 key 才 `Bearer`）；【B】[官方 `mcp-server/keyless.md`](https://docs.firecrawl.dev/mcp-server/keyless.md) 确认 no-credential keyless server URL + 仅 Search/Scrape/Parse + 按 IP 每日双上限 429（[05 续研 A.2](05-search-backends.md) 已升 B 级，[99 裁决 6](99-final-verdicts.md)）；【D】[00 §2](00-lead-live-probe.md) 本机 initialize 200 + `tools/list` 暴露 `firecrawl_search`；【E】具体日上限数字、`conversationId` 回传未实现（官方 instructions 要求带 key/会话时回传，见 [09c P0-2 风险栏](09c-opencode-integration.md)）。

### 4.2 `lib/index.js` 的 6 处登记（代码块）

【A】依据本机 `lib/index.js:20-32,55-68,71,76-84,88-100,115-127,133-241,293-303` 与 [09 附录 C-4](09-opencode-endpoints.md)：

```js
// (1) 顶部 import（lib/index.js:20-32 区块）
import { firecrawlBackend } from "./backends/firecrawl.js";

// (2) BACKENDS 注册表（:55-68）—— 加在 keyless 组之后、brave 之前
const BACKENDS = {
  exa: exaBackend,
  parallel: parallelBackend,
  ddg: ddgBackend,
  searxng: searxngBackend,
  firecrawl: firecrawlBackend,     // ← 新增
  brave: braveBackend,
  // ...其余不变
};

// (3) DEFAULT_ENABLED（:71）—— 默认关，不加 firecrawl
const DEFAULT_ENABLED = ["exa", "parallel", "ddg", "searxng"]; // 不变

// (4) DEFAULT_KEY_ENV（:76-84）
const DEFAULT_KEY_ENV = {
  // ...
  firecrawl: "FIRECRAWL_API_KEY",   // ← 新增（有 key 才用）
};

// (5) DEFAULT_BASE_URLS（:88-100）
const DEFAULT_BASE_URLS = {
  // ...
  firecrawl: "https://mcp.firecrawl.dev/v2/mcp",   // ← 新增
};

// (6) DEFAULT_LABELS（:115-127）
const DEFAULT_LABELS = {
  // ...
  firecrawl: "Firecrawl (MCP, keyless hosted tier)",  // ← 新增
};
```

```js
// (7) Config（:133-241）—— 三字段，每项都要 .description()
enableFirecrawl: z.boolean().default(false)
  .description(DEFAULT_LABELS.firecrawl),          // 默认关（计费/额度未知）
firecrawlApiKeyEnv: z.string().role("credential-ref").default(DEFAULT_KEY_ENV.firecrawl)
  .description("Firecrawl API Key 的凭证引用（填环境变量名，实际密钥存凭证库；留空走 keyless）"),
firecrawlBaseURL: z.string().default(DEFAULT_BASE_URLS.firecrawl)
  .description("Firecrawl MCP 端点（默认官方 keyless hosted；自托管/代理实例改此项）"),

// (8) toggleMap（:293-303）
const toggleMap = {
  // ...
  firecrawl: config?.enableFirecrawl,              // ← 新增
};
```

> `resolveOptions()` 已为**所有** id 自动生成 `${id}BaseURL` / `${id}ApiKeyEnv` / `resolveApiKey`（`:321-341`），**无需改 provider.js / history.js / cache.js**（[09 附录 C-4](09-opencode-endpoints.md) 实证：`cacheKeyFor` 已含 `enabledBackends`、`recordBackendHealth → foldBreaker` 自动覆盖新 id）。

### 4.3 `lib/client.js:14-25` 的 BACKENDS 独立副本（**最易漏**）

【A】本机 `lib/client.js:14-25` 是设置面板的独立副本，不与 `index.js` 共享（[09 附录 C-4](09-opencode-endpoints.md)）：

```js
const BACKENDS = [
  { id: "exa", keyEnv: null, label: "Exa (MCP, 免费)" },
  { id: "parallel", keyEnv: null, label: "Parallel (MCP, 免费)" },
  { id: "ddg", keyEnv: null, label: "DuckDuckGo (HTML)" },
  { id: "searxng", keyEnv: "SEARXNG_API_KEY", optionalKey: true, label: "SearXNG (元搜索)" },
  { id: "firecrawl", keyEnv: "FIRECRAWL_API_KEY", optionalKey: true, label: "Firecrawl (keyless 可用)" }, // ← 新增；optionalKey=true 让它进 KEYLESS/OPTIONAL_KEYS 分组
  { id: "brave", keyEnv: "BRAVE_API_KEY", label: "Brave Search" },
  // ...其余不变
];
```

> `optionalKey: true` 的依据：Firecrawl 有 key 时带 Bearer、无 key 时走 keyless，与 `searxng` 的「可选 key」同构（`client.js:35-37` 按 `keyEnv`/`optionalKey` 分三组）。若设 `keyEnv: null` 则 UI 不会出现可选的 Key 输入框。

### 4.4 配套 fixture 单测（草案）

```js
// tests/firecrawl.test.js（骨架，无 live network）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFirecrawlResult } from '../lib/backends/firecrawl.js';

test('parses {success,data.web[]} into sources', () => {
  const envelope = { content: [{ type: 'text', text: JSON.stringify({
    success: true,
    data: { web: [
      { url: 'https://a.example/', title: 'A', description: 'desc A' },
      { url: 'https://b.example/', title: null, description: null },
    ] },
  }) }] };
  const sources = parseFirecrawlResult(envelope, 8);
  assert.equal(sources.length, 2);
  assert.equal(sources[0].title, 'A');
  assert.equal(sources[0].snippet, 'desc A');
  assert.equal(sources[1].title, undefined);
});

test('returns [] on success:false / malformed text', () => {
  assert.deepEqual(parseFirecrawlResult({ content: [{ text: '{"success":false}' }] }, 8), []);
  assert.deepEqual(parseFirecrawlResult({ content: [{ text: 'not json' }] }, 8), []);
});
```

| 四联 | 内容 |
| --- | --- |
| 结论 | firecrawl 可作为第 3 个 keyless 兜底，默认关 |
| 依据 | 【A】v2.2.5 `firecrawl.ts`；【B】官方 `keyless.md`；【D】00 实测；[99 裁决 2/6](99-final-verdicts.md) |
| 代码落点 | 新增 `lib/backends/firecrawl.js`；`lib/index.js` 6 处 + `lib/client.js:14-25`；新增 `tests/firecrawl.test.js` |
| 验证 | `node --test tests/firecrawl.test.js`；打开 `enableFirecrawl` 后 `web_search` 看遥测 `firecrawl ✓`；**均未执行** |

---

## 5. 草案 D · `tinyfish` backend（含 `skipInitialize` 接口草案）

### 5.1 冲突来源（必须先解决）

- 【A】本机 `lib/util/mcp-client.js:154` 的 `mcpCall()` **无条件** `const sessionId = await ensureSession(url, signal)`（三步握手 `initialize → notifications/initialized → tools/call`）。
- 【A】[v2.2.5 `tinyfish.ts:64,78`](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/tinyfish.ts) 注释逐字：「Keyed requests are rejected without the `Mcp-Session-Id` returned by `initialize`; **keyless ones are not**」——keyless 分支**跳过** initialize，直接 `tools/call`；带 key 才 `initialize` 取 `Mcp-Session-Id`。
- ⇒ 直接复用 `mcpCall` 会给 keyless 多发一次握手（且 §1 的 A/B 里 initialize 正是 403/200 的敏感点）。**必须给 mcpCall 加 `skipInitialize` / `mcpCallDirect` 选项**【A + B，[09 附录 C-2](09-opencode-endpoints.md) / [09c P0-3](09c-opencode-integration.md)】。

### 5.2 `lib/util/mcp-client.js` 接口草案（unified diff）

```diff
--- a/lib/util/mcp-client.js
+++ b/lib/util/mcp-client.js
@@ -145,9 +145,14 @@
  * @param {object} extraHeaders - Additional headers
  * @param {AbortSignal} signal - Abort signal
+ * @param {{ skipInitialize?: boolean }} [opts] - skipInitialize=true 时直接发
+ *   tools/call（用于 keyless 且不需要 Mcp-Session-Id 的 MCP server，如 TinyFish）。
  * @returns {Promise<object>} Parsed result envelope
  */
-export async function mcpCall(url, toolName, args, extraHeaders = {}, signal) {
-  const sessionId = await ensureSession(url, signal);
+export async function mcpCall(url, toolName, args, extraHeaders = {}, signal, opts = {}) {
+  const sessionId = opts.skipInitialize === true
+    ? undefined
+    : await ensureSession(url, signal);
@@ -180,7 +185,8 @@
-  if (sessionId && (response.status === 401 || response.status === 403 || response.status === 404)) {
+  // skipInitialize 路径没有 session 可失效，保持 fail loud（与现有注释一致）
+  if (sessionId && (response.status === 401 || response.status === 403 || response.status === 404)) {
     invalidateSession(url);
```

> 兼容性：现有 11 个 backend 的调用签名 `mcpCall(url, tool, args, headers, signal)` 不变，第 6 参数 `opts` 缺省 `{}` ⇒ **零回归**【A，本机 `exa.js:54` / `parallel.js:42` 调用点】。带 key 的 TinyFish 仍走原 `ensureSession` 三步握手并回传 `Mcp-Session-Id`（`mcpCall` 已把 `sessionId` 写进 headers，`:168-170`）。

### 5.3 `lib/backends/tinyfish.js`（完整骨架）

```js
// lib/backends/tinyfish.js — TinyFish search backend (streamable-http MCP).
// Endpoint: https://agent.tinyfish.ai/mcp
//   - tool: search { query }  (optional: purpose — 按意图排序，见 00 §2)
//   - response: result.content[0].text = JSON string
//       { results: [{ url, title, snippet }] }
// keyless: X-TinyFish-Access-Mode: keyless, 跳过 initialize（skipInitialize:true）
// keyed:   X-API-Key + Mcp-Session-Id（复用 mcpCall 的 ensureSession 三步握手）
// 限额（D 级）: 30 req/min + 50 searches/UTC day → 默认关 + 熔断计数。

import { mcpCall } from "../util/mcp-client.js";
import { WebError } from "@deepseek-ai/dsh-web";

const TINYFISH_ENDPOINT = "https://agent.tinyfish.ai/mcp";
const TINYFISH_TOOL = "search";

export const tinyfishBackend = {
  id: "tinyfish",
  requiresCredential: false,

  available() {
    return true; // keyless 可用
  },

  async search(request, signal, options, hooks = {}) {
    const baseURL = options?.baseURL ?? TINYFISH_ENDPOINT;
    const apiKey = await options?.resolveApiKey?.();
    const hasKey = typeof apiKey === "string" && apiKey.length > 0;

    const args = { query: request.query };
    // 意图排序字段：默认不带（避免把用户 query 原样泄露给第三方，见 09c P2-2 风险）
    if (typeof options?.searchPurpose === "string" && options.searchPurpose.length > 0) {
      args.purpose = options.searchPurpose;
    }

    // headers 只放模式/凭证；recordRequest 一律不带 headers（沿用 exa.js）
    const extraHeaders = hasKey
      ? { "X-API-Key": apiKey }
      : { "X-TinyFish-Access-Mode": "keyless" };

    hooks.recordRequest?.({
      endpoint: baseURL,
      toolName: TINYFISH_TOOL,
      body: args,
      headers: {},
    });

    let result;
    try {
      // keyless 不需要 initialize；带 key 必须 initialize 取 Mcp-Session-Id
      result = await mcpCall(baseURL, TINYFISH_TOOL, args, extraHeaders, signal, {
        skipInitialize: !hasKey,
      });
    } catch (err) {
      if (err instanceof WebError) throw err;
      throw new WebError(
        `tinyfish search failed: ${String(err?.message ?? err)}`,
        "WEB_PROVIDER_ERROR",
        { cause: err },
      );
    }

    if (result?.isError === true) {
      const message = String(result.content?.[0]?.text ?? "unknown");
      hooks.recordOutcome?.({ status: "error", message });
      throw new WebError(`tinyfish returned an MCP error: ${message}`, "WEB_PROVIDER_ERROR");
    }

    const sources = parseTinyfishResult(result, request.maxResults ?? 8);
    hooks.recordOutcome?.({ status: "ok", count: sources.length });
    return { sources, content: undefined, truncated: false };
  },
};

export function parseTinyfishResult(result, maxResults) {
  const text = result?.content?.[0]?.text;
  if (typeof text !== "string" || text.length === 0) return [];
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const results = Array.isArray(parsed?.results) ? parsed.results : [];
  const sources = [];
  for (const item of results) {
    if (typeof item?.url !== "string" || item.url.length === 0) continue;
    const source = { url: item.url };
    if (typeof item.title === "string" && item.title.length > 0) source.title = item.title;
    if (typeof item.snippet === "string" && item.snippet.length > 0) {
      source.snippet = item.snippet.length > 240
        ? item.snippet.slice(0, 240) + "…"
        : item.snippet;
    }
    sources.push(source);
    if (sources.length >= maxResults) break;
  }
  return sources;
}

export default tinyfishBackend;
```

**依据链**：【A】[v2.2.5 `tinyfish.ts`](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/tinyfish.ts) 的 `endpoint` / `search` / `X-TinyFish-Access-Mode: keyless` / `X-API-Key` + `Mcp-Session-Id` 握手 / `{results:[{url,title,snippet}]}`（本会话经 US egress 重新取到 5395 字节原文复核）；【D】[00 §2](00-lead-live-probe.md) keyless 30 req/min + 50 searches/UTC day、`tools/list` 的 `purpose` 字段；【A】本机 `mcp-client.js:154` 的无条件握手；【B】[05 续研 A.3](05-search-backends.md) TinyFish 官网 REST 定价（TinySearch/TinyFetch 免费，与 MCP keyless 是不同接入面，口径差异标 E，不混写）。

### 5.4 `lib/index.js` / `lib/client.js` 登记（与草案 C 同构，6 处）

```js
// lib/index.js
import { tinyfishBackend } from "./backends/tinyfish.js";           // (1)
const BACKENDS = { /* ... */ tinyfish: tinyfishBackend /* ... */ };   // (2) 加在 firecrawl 之后
const DEFAULT_ENABLED = ["exa", "parallel", "ddg", "searxng"];        // (3) 不变，默认关
const DEFAULT_KEY_ENV  = { /* ... */ tinyfish: "TINYFISH_API_KEY" };  // (4)
const DEFAULT_BASE_URLS = { /* ... */ tinyfish: "https://agent.tinyfish.ai/mcp" }; // (5)
const DEFAULT_LABELS   = { /* ... */ tinyfish: "TinyFish (MCP, keyless)" };      // (6)

// Config（三字段，均 .description()）
enableTinyfish: z.boolean().default(false).description(DEFAULT_LABELS.tinyfish),
tinyfishApiKeyEnv: z.string().role("credential-ref").default(DEFAULT_KEY_ENV.tinyfish)
  .description("TinyFish API Key 的凭证引用（留空走 keyless，受 30/min + 50/day 限额）"),
tinyfishBaseURL: z.string().default(DEFAULT_BASE_URLS.tinyfish)
  .description("TinyFish MCP 端点（默认官方；自托管/代理实例改此项）"),

// toggleMap
const toggleMap = { /* ... */ tinyfish: config?.enableTinyfish };
```

```js
// lib/client.js:14-25 BACKENDS 独立副本
{ id: "tinyfish", keyEnv: "TINYFISH_API_KEY", optionalKey: true, label: "TinyFish (keyless 可用)" }, // ← 新增
```

```js
// tests/tinyfish.test.js（骨架）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTinyfishResult } from '../lib/backends/tinyfish.js';
test('parses {results:[{url,title,snippet}]}', () => {
  const s = parseTinyfishResult({ content: [{ text: JSON.stringify({
    results: [{ url: 'https://t.example/', title: 'T', snippet: 'S' }],
  }) }] }, 8);
  assert.equal(s.length, 1);
  assert.equal(s[0].snippet, 'S');
});
test('keyless 分支不发 initialize', async () => {
  // fixture：mock egressFetch，断言只出现一次 method:"tools/call"、无 "initialize"
  // 且 headers 含 X-TinyFish-Access-Mode: keyless、不含 X-API-Key
});
```

| 四联 | 内容 |
| --- | --- |
| 结论 | tinyfish 可作为第 4 个 keyless 兜底；keyless 必须跳过 initialize |
| 依据 | 【A】v2.2.5 `tinyfish.ts`；【A】本机 `mcp-client.js:154`；【D】00 实测；[99 裁决 2](99-final-verdicts.md) |
| 代码落点 | 新增 `lib/backends/tinyfish.js`；`lib/util/mcp-client.js` 加 `opts.skipInitialize`；`lib/index.js` 6 处 + `lib/client.js` 副本；`tests/tinyfish.test.js` |
| 验证 | `node --test tests/tinyfish.test.js`（含「keyless 不握手」断言）；**未执行** |

---

## 6. 验收命令表

| # | 命令 | 预期输出 | 改状态？ | 需批准？ |
| --- | --- | --- | --- | --- |
| 1 | `node /tmp/ws22-host-ab.mjs`（§1 脚本） | `WITHOUT Host: 403` / `WITH    Host: 200` | 否（只读，临时脚本跑完删） | 否 —— **本次已实跑**，见 §1.2 |
| 2 | `dsh web --dump-config \| grep -A4 'id: web'` | 现状：`searchProvider: unified`、无 `fetchProvider`；应用**解 A2（yml）**后出现 `fetchProvider: http`；**解 A1（env）不进 config 树**，以实跑 `web_fetch` 为准（[24 裁决 9](24-p0-landing-correction.md)） | 否（只读导出） | 否（**应用**草案 A 才需批准） |
| 2a | `tr '\0' '\n' < /proc/<pid>/environ \| grep DSH_WEB_FETCH_PROVIDER`（`<pid>` 用 `pgrep -f 'dsh web'` 取；[24 裁决 9 §4](24-p0-landing-correction.md) 点名） | 解 A1 应用后应命中 `DSH_WEB_FETCH_PROVIDER=http`；未应用时 0 命中。**注意：`--dump-config` 不显示 env，env 方案验收以实跑 `web_fetch` 返回 200 正文为准，不以 config 树为准** | 否（只读 /proc） | 否（读不需批准；**设 env** 需批准，见 §7 门槛 1） |
| 3 | `web_fetch({url:"https://example.com"})` | 现状：`multiple usable web providers are registered (deepseek-fetch-api, http)`；草案 A 应用后返回正文 | 否（工具调用） | 否（已由 02 §B 实跑确认） |
| 4 | `curl -sS -m 10 -H 'Authorization: Bearer <server_key>' http://127.0.0.1:18090/healthz`（网关健康，**非搜索**） | 当前 `503 degraded`（27 proxies 全 unhealthy），与搜索修复无关 | 否 | 否 |
| 5 | `GET /api/unified-search/health`（带 `dsh-auth-*` cookie） | `enabled:4 keyless:4`；草案 C/D 打开开关后应变为 5–6 个且出现 `firecrawl`/`tinyfish` 条目 | 否（读） | 否 |
| 6 | `web_search({queries:["OpenCode v2 websearch"]})` | 现状 `all enabled backends failed (4)`；草案 B/C/D 生效后应至少 1 个 ✓ 源 | 否（工具调用） | 否（调用本身）；**改插件代码需批准** |
| 7 | `node --test tests/egress-host-header.test.js`（草案 B fixture） | 2 个 test 通过（带 Host / 不回归） | 否 | 否（但**写测试文件**需批准，见 §7） |
| 8 | `node --test tests/firecrawl.test.js tests/tinyfish.test.js`（草案 C/D fixture） | 各 2–3 个 test 通过，无 live network | 否 | 否（写文件需批准） |
| 9 | `curl -sS -X POST https://mcp.firecrawl.dev/v2/mcp -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"initialize",...}'` | HTTP 200（keyless hosted tier，[00 §1](00-lead-live-probe.md) 已验） | 否 | 否 |
| 10 | `curl -sS -X POST https://agent.tinyfish.ai/mcp -H 'X-TinyFish-Access-Mode: keyless' ...` | HTTP 200（[00 §1](00-lead-live-probe.md) 已验） | 否 | 否 |

> 表中 `<server_key>` 为占位符，**报告未出现任何真实密钥值**；health 端点只是网关（模型协议转换器），**不是搜索后端**（[09c §2.5](09c-opencode-integration.md)）。

---

## 7. 决策门槛清单（不批准就不能执行）

| # | 动作 | 为什么需要批准 | 本报告状态 |
| --- | --- | --- | --- |
| 1 | **设 `DSH_WEB_FETCH_PROVIDER=http` 环境变量**（解 A1 的改状态动作，零文件编辑）并重启 `dsh web` | **要点名**：设进程 env 本身即改运行时状态、需重启线上 GUI 才生效；依据 [24 裁决 9](24-p0-landing-correction.md) 发布版 `dsh-web/lib/index.js:60,115`（`this.fetchProviderEnv = process.env.DSH_WEB_FETCH_PROVIDER` / `config.fetchProvider.get() ?? this.fetchProviderEnv`）；回滚 = 取消 env + 重启 | **未执行**（仅给示意命令；验收命令见 §6 #2a） |
| 1a | （与上并列）**重启 `dsh web`** —— 见门槛 4，env 与重启是同一次批准动作的两半 | 重启影响线上 GUI 会话；env 不重启不生效 | **未执行** |
| 1b | 在 `~/.dsh/profiles/web/cordis.patch.yml` 末尾**新增** `- id: web` 并 restate 完整 config（**解 A2 备选**） | 改用户 profile 配置；必须 restate，否则整体替换语义再抹掉一次 | **未执行**（仅给 YAML） |
| 2 | 修改插件 `node_modules/@240xu/dsh-websearch/cordis.patch.yml`（A2）或任何 `lib/**`（草案 B/C/D） | 改第三方插件源码；`pnpm install`/升级会覆盖；属于给插件提 PR 的范畴 | **未执行**（仅给 diff/骨架） |
| 3 | `pnpm install` / 改 `package.json` / 升 2.8.4→2.8.8 | 改依赖树与运行时版本；且 [99 裁决 2](99-final-verdicts.md) 要求先确认 PR #7 / Issue #8（仍 open）+ sidecar 可达 | **未执行** |
| 4 | 重启 `dsh web`（PID 2085） | 影响线上 GUI 会话 | **未执行** |
| 5 | 设 `DSH_EGRESS_FORWARDER` / `_PROXY` / `HTTP_PROXY` 等环境变量、部署 Chromium-TLS sidecar | 改运行时出网链路；2.8.5 原文「Unset = byte-identical behavior」 | **未执行**（当前进程已设但 2.8.4 不认识，见 [99 裁决 1](99-final-verdicts.md)） |
| 6 | 在 Settings 面板打开 `enableFirecrawl` / `enableTinyfish` | Firecrawl 计费/额度未知、TinyFish 50 searches/day 硬上限 | **未执行** |
| 7 | 写入任何 `tests/*.test.js`、运行 `node --test` | 新增文件 / 执行测试 | **未执行**（仅给 fixture 骨架） |
| 8 | 写 `99-final-verdicts.md` / `REPORT.md` / 其它报告 | 越权（本任务唯一产出是 22 号文件） | **未执行** |

**一句话**：本报告只交付 4 份可评审草案 + 1 次只读 A/B 实测，**上述 8 项一项未做**。

---

## 8. 证据等级索引

| 等级 | 依据 | 出处（永久链接 / 路径:行号） | 支撑 |
| --- | --- | --- | --- |
| A | 本机 2.8.4 源码 | `/home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/lib/backends/{exa,parallel}.js`、`lib/util/mcp-client.js:154,168-170,180-195`、`lib/util/egress-fetch.js:170-177,202,276`、`lib/index.js:20-32,55-68,71,76-84,88-100,115-127,133-241,293-303,321-341`、`lib/client.js:14-25` | 草案 B/C/D 的结构对齐、6 处登记、`skipInitialize` 落点 |
| A | 官方 Cordis 源码 | [`anomalyco/opencode/blob/v2.2.5/.../firecrawl.ts`](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/firecrawl.ts)、[`tinyfish.ts`](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/websearch/tinyfish.ts)（本会话经 US egress 取到 5395 字节原文复核） | 端点 / tool / 请求响应字段 / keyless 头 / 握手语义 |
| B | 官方 Firecrawl 文档 | [`docs.firecrawl.dev/mcp-server/keyless.md`](https://docs.firecrawl.dev/mcp-server/keyless.md)（HTTP 200）、`rate-limits.md#keyless-no-api-key`；[05 续研 A.2](05-search-backends.md) 已升 B | 草案 C 的 keyless 定性 |
| B | 官方 upgrade-guide | `docs/upgrade-guide/v0.2.1-alpha.1/web-listener-trust-config/guide.md:20`（patch 整体替换 config） | 草案 A 为何必须 restate |
| C | 版本与事故谱系 | [12-change-lineage.md](12-change-lineage.md)、[99 裁决 1/2](99-final-verdicts.md)、PR [#7](https://github.com/240xu/dsh-websearch/pull/7) / Issue [#8](https://github.com/240xu/dsh-websearch/issues/8)（2026-11-06 复核仍 open） | P0 前置条件、升级门槛 |
| D | 本机实测 | §1.2 最小 A/B（`WITHOUT Host: 403` / `WITH Host: 200`）；[00-lead-live-probe.md](00-lead-live-probe.md) 四端点 200；[02 附录 A/B](02-runtime-state.md) `--dump-config` 铁证 + `web_fetch` 实跑；`dsh web --dump-config`（本会话只读复核，第 562–565 行） | 403 真因、组合树、`fetchProvider` 缺失 |
| E | 未实施 / 待核实 | 草案 B 未提 PR；Firecrawl 具体日上限数字与 `conversationId` 回传；TinyFish MCP 与 REST 限额口径差异；`skipInitialize` 在本机 2.8.4 未实跑；所有 fixture 单测未运行；PR #7/#8 未合并 | §3/§4/§5 的限定语 |

---

## 9. 给 Lead 的落地顺序建议（不含执行）

1. **先做零文件编辑的一步**：草案 A **解 A1**（`DSH_WEB_FETCH_PROVIDER=http` + 重启 `dsh web`，[24 裁决 9](24-p0-landing-correction.md)）修 `web_fetch`；不愿重启则走解 A2（profile patch restate）。再让插件作者考虑草案 B（一行 diff）修 403 —— 后者是「不升级、不部署 sidecar」的唯一路径。
2. **升级 2.8.8 前**先复查 PR #7 / Issue #8 状态（作者已回复「马上解决」）；确认 sidecar 可达 + `_PROXY` 已配。
3. **草案 C/D**（两个 keyless backend）按 PR 交给插件作者，附 §4/§5 的 6 处登记清单与 fixture 单测；**务必包含 `lib/client.js` 的 BACKENDS 副本**，否则 UI 不可见。
4. 每步都用 §6 的命令表验收，且每步都按 §7 取得批准。

> 报告完。全程只读，未写任何 `lib/` / `cordis.patch.yml` / `package.json` / 其它报告；无 token 值；临时 A/B 脚本已删除。

---

## 附录 · 独立复核补遗（local-impl，2026-11-06）

> **不改动上文任何一行**（除 Lead 裁决的两处精准补遗：§6 新增 #2a 行、§7 门槛 1 拆为 1/1a 点名 env）。本节由 `local-impl` 子代理按 Lead「方案 A：独立复核 + 精准补两处」执行，全程只读，未改任何源码/配置、未重启服务、未设环境变量、未把 token 值写入输出。
> 背景：本文件由并行 fork 于 12:48–12:49 写成 728 行终稿；本代理 resume 后发现同名文件已存在，**先发冲突预警给 Lead**，Lead 裁决「不全量重写、不另起 22b，只做独立复核 + 补两处 + 追加本附录」。

### 复-1 §1.2 A/B 脚本与输出复核

| 项 | 复核结论 | 等级 |
| --- | --- | --- |
| 脚本是否只以 Host 头为唯一变量 | **是**。`[A] 22 §1.1:29-82` 逐行核对：`probe(withHost)` 内除 `if (withHost) headers.host = target.host;`（`:61`）外，`proxy`/`target`/`body`/`headers` 基集/`https.request` 选项/`servername`/`path:'/mcp'`/UA `dsh-websearch/2.3`/15s timeout 全部相同；两次调用仅 `probe(false)` / `probe(true)`（`:80-81`）。 | A |
| 与本机 2.8.4 客户端的一致性 | `[A] /home/dsh/.dsh/profiles/web/node_modules/@240xu/dsh-websearch/lib/util/egress-fetch.js:170-177`：`httpsViaConnect` 把 `headers` 原样传给 `https.request`（含 `socket`/`agent:false`/`servername`，无 `host`）；`:262-276` `normalizeHeaders()` 末尾 `delete headers["host"]`；对照 `:202` `httpViaProxy` 显式 `host: headers.host ?? target.host` ⇒ **缺 Host 的机制成立**，与 99 裁决 1 一致。 | A |
| §1.2 输出 `403 / 200` 与本机一致性 | **[D/部分 E] 本代理复跑未复现，但脚本与结论仍成立**。另写 `/tmp/ws22b-host-ab.mjs`（与 §1.1 逐字同构，仅临时文件名不同）实跑：`WITHOUT Host: TIMEOUT` / `WITH Host: TIMEOUT`、`exit: 0`；随后 `curl -X POST https://mcp.exa.ai/mcp`（经默认 `HTTPS_PROXY=172.30.66.1:1091`）连续 3 次 `HTTP=000`（20s 超时），`curl -x http://172.30.0.1:24070` 同端点得 `406`（3.7s）。⇒ **当时 1091 出口对 exa 的连接层不通**，属 §1.2 已预告的「CONNECT 本身失败则两行 TIMEOUT，此时不得宣称已复现」情形。按 Lead 规则**如实标注，不把 TIMEOUT 当 403/200 结论**。§1.2 的 `403/200` 是 fork 在 12:4x 较早健康窗口的 D 级实测，与 [08 附录 A.2](08-own-repo.md) 的 12 组实验、[99 裁决 1](99-final-verdicts.md) 独立互证，本代理不推翻，但**本次未独立复现**。临时脚本已 `rm -f`。 | D + E |
| 建议 | 若需在本轮再取一次 403/200，待 1091 恢复或用可达出口重跑 §1.1 脚本；不得用 406/000/TIMEOUT 冒充。 | E |

### 复-2 草案 C/D 骨架与本机 2.8.4 结构一致性

| 核对点 | 本机源码（A） | 22 草案 | 结论 |
| --- | --- | --- | --- |
| backend 导出形态 | `[A] lib/backends/exa.js:26` `export const exaBackend = { id, requiresCredential, available(), async search(request, signal, options, hooks = {}) }` + `:119` `export default`；`parallel.js:26,119` 同构 | §4.1 `export const firecrawlBackend`（`:275`）+ `export default`（`:354`）；§5.3 `export const tinyfishBackend`（`:527`）+ `export default`（`:671`） | ✅ 一致 |
| `hooks.recordRequest/recordOutcome` | `[A] exa.js:41-46,64,73`；`parallel.js:41,66,78` | §4.1 `:296-301,317,322`；§5.3 `:551-556` + `:5.3` 尾部 recordOutcome | ✅ 一致，`recordRequest.headers:{}` 不记凭证（沿用 exa 写法） |
| `mcpCall` 签名 | `[A] lib/util/mcp-client.js:153` `export async function mcpCall(url, toolName, args, extraHeaders = {}, signal)`；exa 调用点 `exa.js:54` `mcpCall(EXA_ENDPOINT, EXA_TOOL, args, {}, signal)`；parallel `parallel.js:50` 同 | §4.1 `:305` `mcpCall(baseURL, FIRECRAWL_TOOL, args, extraHeaders, signal)`；§5.2 diff 新增**第 6 参数** `opts = {}`，`:496-499` `opts.skipInitialize === true ? undefined : await ensureSession(...)` | ✅ 兼容：旧 5 参调用不变，第 6 参缺省 `{}` ⇒ 零回归（§5.2 `:507` 自述） |
| 无条件 `ensureSession` 冲突 | `[A] mcp-client.js:154` `const sessionId = await ensureSession(url, signal)` 无条件；`:23` 起为三步握手 | §5.1 `:478-480` 明确指出冲突；§5.2 diff 与 §5.3 `:561-563` `skipInitialize: !hasKey` 解决 | ✅ 处理正确，且引用 v2.2.5 `tinyfish.ts:64,78` 原文「keyless ones are not」 |
| 返回契约 | `[A] exa.js:76-87` / `parallel.js:87` `return { sources, content: undefined, truncated: false }` | §4.1 `:323`；§5.3 `:5.3` 尾部 `return { sources, truncated: false }` 同形 | ✅ 一致 |
| `WebError` 包装 / `result.isError` | `[A] exa.js:56-69` | §4.1 `:306-319`；§5.3 `:564-571` | ✅ 一致 |
| `lib/index.js` 6 处 + `client.js` 副本 | `[A] lib/index.js:23-35`(imports)、`:54`(BACKENDS)、`:72`(DEFAULT_ENABLED)、`:75`(DEFAULT_KEY_ENV)、`:86`(DEFAULT_BASE_URLS)、`:113`(DEFAULT_LABELS)、`:290`(toggleMap)；`[A] lib/client.js:17-27` BACKENDS 独立数组 11 项（含 `keyEnv`/`label`） | §4.2 `:4.2` 六处 + Config 三字段 + toggleMap；§4.3 `client.js:14-25` 副本追加行；§5.4 同构 | ✅ 落点齐全（22 引用的行号 `20-32/55-68/71/76-84/88-100/115-127/290-303` 与本机实测 `:23-35/:54/:72/:75/:86/:113/:290` 有小幅偏移，属版本内行号漂移，不影响落点识别） |

### 复-3 §2.1 落点是否严格遵循 24 号

| 24 号要求 | 22 §2.1 实现 | 结论 |
| --- | --- | --- |
| **优先 `DSH_WEB_FETCH_PROVIDER=http` 零文件编辑** | `[A] §2.1:101` 修订注记 + `§2.1a:138-150` 默认解 + 启动命令 `:142-147` + 回滚「取消 env 再重启」`:149` | ✅ 已就地修订 |
| 依据 `dsh-web/lib/index.js:60,115` | `[A] §2.1:130-136` 引用；本代理独立核验 `/usr/local/.../dsh-web/lib/index.js:60` `this.fetchProviderEnv = process.env.DSH_WEB_FETCH_PROVIDER`、`:115` `const configuredId = this.config.fetchProvider.get() ?? this.fetchProviderEnv` **逐字命中** | ✅ A 级复核通过 |
| 备选：profile patch **新增** `- id: web` 并 restate 完整 config | `[A] §2.1b:152-166` 修改前=无该条目 / 修改后=`searchProvider: unified` + `fetchProvider: http` | ✅ |
| **不要改插件 node_modules 内 bundle patch** | `[A] §2.1b:168` 显式警告「不要改…会被 pnpm install / 升级 2.8.8 覆盖回去」；§7 门槛 2 亦列为需批准 | ✅ |
| 明确根因在插件 bundle patch 层（非 profile patch 漏写） | `[A] §2.1:105-129` 三层表（base 原有 fetchProvider / 插件 patch 只有 searchProvider / profile patch 无 web 条目）+ `--dump-config` 组合树 `fetchProvider` 0 处 | ✅ 与 24 §1 一致 |

### 复-4 本轮两处精准补遗（Lead 指定）

1. **§6 新增 `#2a` 行**：`tr '\0' '\n' < /proc/<pid>/environ | grep DSH_WEB_FETCH_PROVIDER` —— 预期命中 `=http`（解 A1 应用后），只读、不需批准；并注明「**`--dump-config` 不显示 env，env 方案验收以实跑 `web_fetch` 200 为准**」，与 §2.1a `:150` 口径一致。依据 `[B] 24-p0-landing-correction.md:44`（§4 给 21/22 的指令）。
2. **§7 门槛 1 拆分点名**：原「设 env 并重启」一行拆为 `#1`（**设 `DSH_WEB_FETCH_PROVIDER=http` 环境变量**，点名需批准 + 回滚）与 `#1a`（**重启 `dsh web`**，引用 §7 门槛 4），满足「与重启可并列但要点名」。`#1b`/`#2`–`#8` 原文不动。

### 复-5 补遗证据等级

| 结论 | 等级 | 出处 |
| --- | --- | --- |
| §1.1 脚本唯一变量为 Host 头 | A | `22 §1.1:29-82` 逐行 + `egress-fetch.js:170-177,202,262-276` |
| 缺 Host 机制成立（403 真因） | A + C | 本机源码 + [99 裁决 1](99-final-verdicts.md) + [08 附录 A.2](08-own-repo.md) |
| 本代理 A/B 复跑得 TIMEOUT/TIMEOUT、curl 000、24070 得 406 | **D（本轮实测，标 E：未复现 403/200）** | `/tmp/ws22b-host-ab.mjs` 实跑（已删）、`curl` 输出 |
| 草案 C/D 结构与本机 2.8.4 一致 | A | `lib/backends/{exa,parallel}.js`、`lib/util/mcp-client.js:153-235`、`lib/index.js:23-35,54,72,75,86,113,290`、`lib/client.js:17-27` |
| §2.1 遵循 24 号（env 优先 / 不改 node_modules） | A + B | `22 §2.1:101-168`、`24-p0-landing-correction.md:15-45`、`dsh-web/lib/index.js:60,115` |
| 两处补遗 | B + A | `24 §4:44`（指令）+ 本轮 edit |

> 本附录未改上文除 §6 #2a、§7 #1/#1a 外的任何一行；未写 01/09/09b/09c/99/REPORT 或其它报告；未操作任务板；无 token/密钥值。

---

## 附记 · Lead 对「A/B 复现差异」的裁决（2026-11-06，只追加）

`local-impl` 独立复跑 §1.1 脚本得到 `WITHOUT Host: TIMEOUT` / `WITH Host: TIMEOUT`，curl 经 `1091` HTTP=000、经 `24070` 得 406；而 fork 子代理 §1.2 记录 `403/200`，Lead 早前亦独立复现 `403/200`。**这不是结论冲突，是可复现性对网络出口的依赖**，裁决如下：

1. **最终口径不变**：403 = 缺 `Host` 头被 Cloudflare 拒（[99 裁决 1](99-final-verdicts.md)）。支撑证据有**三条相互独立**的来源：① Lead 最小 A/B（`WITHOUT Host: 403` / `WITH Host: 200`）；② [08 附录 A.2](08-own-repo.md) 12 组实验（改 ALPN 仍 403、仅补 Host 即 200，并同步复现 ddg 301 与 searx.be 反爬页）；③ 本机 2.8.4 `egress-fetch.js:276` 删 Host + `httpsViaConnect` 不补、`httpViaProxy:202` 补 Host 的**源码级结构证据**（A 级，与网络无关）。单次 TIMEOUT 不构成反证。
2. **如实记录可复现性边界**：`node` A/B 脚本依赖 `172.30.66.1:1091` CONNECT 通道当时的可达性；出口抖动时两行都会 TIMEOUT/000，**此时不得宣称已复现**，须回到第 1 条的三源证据链。执行 M1 验收时应先 `curl -m 10` 探测出口，失败则改期复跑，不得据此改写结论。
3. **D 级标注**：§1.2 的 `403/200` 记为「2026-11-06 12:4x 该时刻实测」【D】；本附记的 TIMEOUT 记为「同日稍后另一出口时刻观测」【D+E】，两者并列保留，符合用户「可靠资料支撑、详细标注」要求。
4. **无动作**：本次未改任何运行时状态；临时脚本均已删除。

本附记无凭证值、无浮动 ref 作为依据。
