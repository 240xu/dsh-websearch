# v2.8.0 真实调用实测记录（2026-09-29）

环境：Node v26.4.0 / Termux linux，直连各后端默认 baseURL。

## Exa（MCP, keyless）— ✅ 通过

- 请求：`web_search_exa { query: "github dsh plugins", numResults: 3, category: "github" }`
  （category 由 `inferExaCategory` 从查询中的 "github" 推断注入）
- 响应：MCP ok，3 条来源，全部为 github.com 域（category 生效的证据）：
  - https://github.com/topics/dsh-plugin?o=desc&s=updated
  - https://github.com/topics/dsh-plugins
  - https://github.com/awesome-dsh-plugin/awesome-dsh-plugin
- 结论：`category` 参数被端点接受且生效。

## DuckDuckGo（HTML 抓取）— ⚠ 本环境网络受限

- `fetch failed`（连接层失败，非 HTTP 错误），重试两次同样。
- 判定：本沙箱对外网限速/白名单（exa.ai 可达、html.duckduckgo.com 不可达），
  非后端代码回归——v2.7.x 起该后端代码路径未变，且有 parse 级测试覆盖
  （tests/parse.test.js ddg 28 组含真实 HTML fixture）。

## SearXNG（searx.be 与 searx.tiekoetter.com）— ⚠ 同上

- 两实例均 `fetch failed`（连接层）。deepCoverage 的 `categories=general,news,it`
  参数构造有单测覆盖（v28 provider 层 + 后端 URL 构造），真实连通性待
  用户环境验证（自托管实例不受本环境网络策略影响）。

## per-backend 超时实测

- 挂死 ddg 后端 + backendTimeoutMs=30000：实测 5013ms 抛
  `backend "ddg" timed out after 5000ms`（tests/v28-p2.test.js 第 2 组）。
