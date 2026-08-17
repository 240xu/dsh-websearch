# dsh-unified-search

DSH（DeepSeek Harness）原生插件：向 `ctx.web` 注册聚合搜索 provider **`unified`**，内置 `web_search` 工具零配置直接可用。

## 后端

| 后端 | Key | 端点 | 说明 |
|---|---|---|---|
| exa | 免（可选 `EXA_API_KEY` 提额） | `mcp.exa.ai/mcp` | opencode 同源 |
| parallel | 免 | `search.parallel.ai/mcp` | opencode 同源 |
| ddg | 免 | DuckDuckGo HTML | 兜底 |
| deepseek | `DEEPSEEK_API_KEY` | `api.deepseek.com/anthropic/v1/messages` + `web_search_2025/2026*` | Claude 线，本机可达 |
| anthropic | `ANTHROPIC_API_KEY` | `ANTHROPIC_BASE_URL/messages` + `web_search_20260*` | Claude Code 同机制 |
| openai | `OPENAI_API_KEY` | `OPENAI_BASE_URL/responses` + `web_search` | Codex 同机制 |

## 安装

```bash
cp -r dsh-unified-search /data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/
# 或放入任意可被 dsh loader 解析的 node_modules 目录
```

在 `~/.dsh/profiles/<profile>/cordis.patch.yml` 追加（见 `examples/cordis.patch.yml`）：

```yaml
- id: unified-search
  name: 'dsh-unified-search'
- id: web
  name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: unified
```

重启 dsh web 后，内置 `web_search` 工具即走 unified provider。

## 设置（Settings）

插件注册 `unified-search` 设置段：

- `enabledBackends`: 后端开关数组（缺省全部）
- `numResults`: 每后端结果数上限
- `exaApiKeyEnv` / `deepseekApiKeyEnv` / `anthropicApiKeyEnv` / `openaiApiKeyEnv`: 每后端 key 的凭据引用名
- `deepseekBaseURL` / `anthropicBaseURL` / `openaiBaseURL`: 端点（缺省官方）
- `deepseekModel` / `anthropicModel` / `openaiModel`: 模型（缺省 deepseek-v4-flash / claude-sonnet-4-6 / gpt-5-codex）

Key 解析顺序：Settings 字面值 → 凭据服务（`~/.dsh/.credentials.yaml`，如 `DEEPSEEK_API_KEY`）→ 进程环境变量。
凭据服务名可指向任意你已配置的 key（例如自定义 `apiKeyEnv: MY_OPENAI_KEY` 并在 Models 页存储）。

## 环境变量（不经设置时兜底）

```bash
export EXA_API_KEY=...            # exa 提额（可选）
export DEEPSEEK_API_KEY=...       # deepseek 后端
export ANTHROPIC_API_KEY=...      # anthropic 后端
export ANTHROPIC_BASE_URL=...     # 自定义 anthropic 兼容端点
export OPENAI_API_KEY=...         # openai/codex 后端
export OPENAI_BASE_URL=...        # 自定义 openai 兼容端点
export DSH_WEB_SEARCH_PROVIDER=unified   # 亦可直接钉住选择
```

## 插件格式速记

```js
export const name = "unified-search";      // 诊断名
export const inject = ["web"];             // 依赖 ctx.web
export function apply(ctx, config) {
  installSettingsSection(ctx, settingsNamespace("unified-search"), Config, config, …);
  ctx.web.registerSearchProvider(new UnifiedSearchProvider(…));  // {id, available(), search()}
}
```

`WebSearchResult = { content?, sources: [{url, title?, snippet?, publishedAt?}], truncated }`。

## License

MIT © 2026 Xu198440
