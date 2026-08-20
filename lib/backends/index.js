/**
 * Unified backend registry for dsh-unified-search.
 * Auto-discovers and exports all backend implementations.
 */

import { exaBackend } from "./exa.js";
import { parallelBackend } from "./parallel.js";
import { ddgBackend } from "./ddg.js";
import { deepseekBackend, anthropicBackend } from "./anthropic-like.js";
import { openaiBackend } from "./openai.js";
import { braveBackend } from "./brave.js";
import { tavilyBackend } from "./tavily.js";
import { serperBackend } from "./serper.js";
import { searxngBackend } from "./searxng.js";
import { mojeekBackend } from "./mojeek.js";

// Individual backend exports for direct import
export { exaBackend } from "./exa.js";
export { parallelBackend } from "./parallel.js";
export { ddgBackend } from "./ddg.js";
export { deepseekBackend, anthropicBackend } from "./anthropic-like.js";
export { openaiBackend } from "./openai.js";
export { braveBackend } from "./brave.js";
export { tavilyBackend } from "./tavily.js";
export { serperBackend } from "./serper.js";
export { searxngBackend } from "./searxng.js";
export { mojeekBackend } from "./mojeek.js";


/** All registered backends. Order = default fan-out priority. */
export const BACKENDS = {
  exa: exaBackend,
  parallel: parallelBackend,
  ddg: ddgBackend,
  searxng: searxngBackend,      // keyless, new
  brave: braveBackend,          // key-gated, new
  tavily: tavilyBackend,        // key-gated, new
  serper: serperBackend,        // key-gated, new
  mojeek: mojeekBackend,        // key-gated, new
  deepseek: deepseekBackend,
  anthropic: anthropicBackend,
  openai: openaiBackend,
};

/** All backend IDs in registry order. */
export const ALL_BACKEND_IDS = Object.keys(BACKENDS);

/** Default enabled backends (keyless only). */
export const DEFAULT_ENABLED = ["exa", "parallel", "ddg", "searxng"];

/** Environment variable names for key-gated backends. */
export const DEFAULT_KEY_ENV = {
  deepseek: "DEEPSEEK_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  brave: "BRAVE_API_KEY",
  tavily: "TAVILY_API_KEY",
  serper: "SERPER_API_KEY",
  mojeek: "MOJEEK_API_KEY",
};

/** Default base URLs for each backend. */
export const DEFAULT_BASE_URLS = {
  exa: "https://mcp.exa.ai/mcp",
  parallel: "https://search.parallel.ai/mcp",
  ddg: "https://html.duckduckgo.com/html/",
  searxng: "https://searx.be",
  brave: "https://api.search.brave.com/res/v1/web/search",
  tavily: "https://api.tavily.com/search",
  serper: "https://google.serper.dev/search",
  mojeek: "https://api.mojeek.com/v1/search",
  deepseek: "https://api.deepseek.com/anthropic/v1",
  anthropic: "https://api.anthropic.com/v1",
  openai: "https://api.openai.com/v1",
};

/** Backend type classification for GUI. */
export const BACKEND_TYPES = {
  exa: "mcp",
  parallel: "mcp",
  ddg: "keyless",
  searxng: "keyless",
  brave: "credential",
  tavily: "credential",
  serper: "credential",
  mojeek: "credential",
  deepseek: "credential",
  anthropic: "credential",
  openai: "credential",
};

/** Human-readable labels for GUI. */
export const BACKEND_LABELS = {
  exa: "Exa (MCP, 免费无 Key)",
  parallel: "Parallel (MCP, 免费无 Key)",
  ddg: "DuckDuckGo (HTML 抓取, 兜底)",
  searxng: "SearXNG (元搜索, 免费无 Key)",
  brave: "Brave Search (独立索引, 2000/月免费)",
  tavily: "Tavily (AI 专用, 含答案摘要)",
  serper: "Serper.dev (Google 抓取, 2500/月免费)",
  mojeek: "Mojeek (独立索引, 1000/天免费)",
  deepseek: "DeepSeek (原生 web_search, 需 Key)",
  anthropic: "Anthropic (Claude 原生 web_search, 需 Key)",
  openai: "OpenAI (Responses API web_search, 需 Key)",
};

/** Backend descriptions for GUI tooltips. */
export const BACKEND_DESCRIPTIONS = {
  exa: "流式 HTTP MCP 协议，原生 web_search_exa 工具，结果含标题/URL/高亮摘要",
  parallel: "流式 HTTP MCP 协议，原生 web_search 工具，返回结构化 JSON 含摘要数组",
  ddg: "HTML 页面抓取解析，通过 uddg= 参数还原真实 URL，零依赖兜底",
  searxng: "开源元搜索引擎聚合，可指向公共实例或自托管，隐私友好",
  brave: "Brave 独立搜索索引，REST API，免费 2000 次/月，结果质量高",
  tavily: "AI 专用搜索，可返回 AI 生成答案 + 结构化结果，支持深度搜索模式",
  serper: "抓取 Google SERP，结构化 organic[] 结果，免费 2500 次/月，速度极快",
  mojeek: "英国独立搜索引擎，无追踪，免费 1000 次/天，英文为主",
  deepseek: "DeepSeek Anthropic 兼容 API + 原生 web_search_20250305 工具",
  anthropic: "Claude 官方 Messages API + web_search_20250305 原生工具",
  openai: "OpenAI Responses API + 原生 web_search 工具，解析 url_citation 注释",
};

