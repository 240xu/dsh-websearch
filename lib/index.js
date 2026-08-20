/**
 * dsh-websearch: unified web search provider for the DSH web seam (ctx.web).
 * Registers ONE provider under id "unified" that fans out to multiple backends
 * concurrently and merges (URL-deduped) results. Keyless backends (Exa, Parallel,
 * DuckDuckGo, SearXNG) give zero-config search; key-gated backends (DeepSeek/
 * Anthropic/OpenAI/Brave/Tavily/Serper/Mojeek) activate when their API key is
 * stored via the credentials service or the launching environment.
 *
 * @module @deepseek-ai/dsh-websearch
 */
import z from "@deepseek-ai/schemastery";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import {
  installSettingsSection,
  settingsNamespace,
} from "@deepseek-ai/dsh-settings";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import { WebError } from "@deepseek-ai/dsh-web";

// Import all backends
import { exaBackend } from "./backends/exa.js";
import { parallelBackend } from "./backends/parallel.js";
import { ddgBackend } from "./backends/ddg.js";
import {
  deepseekBackend,
  anthropicBackend,
} from "./backends/anthropic-like.js";
import { openaiBackend } from "./backends/openai.js";
import { braveBackend } from "./backends/brave.js";
import { tavilyBackend } from "./backends/tavily.js";
import { serperBackend } from "./backends/serper.js";
import { searxngBackend } from "./backends/searxng.js";
import { mojeekBackend } from "./backends/mojeek.js";
import { createUnifiedSearchProvider } from "./provider.js";

/** Cordis plugin name used by loader diagnostics. */
export const name = "unified-search";
/** The web seam this provider registers into. */
export const inject = ["web"];

/** Settings namespace key. */
const NAMESPACE = settingsNamespace("unified-search");

/** Full backend registry. Order = default fan-out priority. */
const BACKENDS = {
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

/** All backend ids in registry order. */
const ALL_BACKENDS = Object.keys(BACKENDS);

/** Keyless backends enabled by default; key-gated only when their key exists. */
const DEFAULT_ENABLED = ["exa", "parallel", "ddg", "searxng"];

/** Environment-variable names each key-gated backend reads. */
const DEFAULT_KEY_ENV = {
  deepseek: "DEEPSEEK_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  brave: "BRAVE_API_KEY",
  tavily: "TAVILY_API_KEY",
  serper: "SERPER_API_KEY",
  mojeek: "MOJEEK_API_KEY",
};

/** Default base URLs. */
const DEFAULT_BASE_URLS = {
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

/** Env var that overrides the default backend sweep order / enabled set. */
const ENABLED_ENV = "DSH_UNIFIED_SEARCH_BACKENDS";

/** Per-backend GUI configuration schema. */
const BackendConfigSchema = z.object({
  id: z.string(),
  enabled: z.boolean().default(true),
  label: z.string().optional(),
  description: z.string().optional(),
  type: z.enum(["keyless", "credential", "mcp"]).optional(),
  requiresKey: z.boolean().optional(),
  keyEnvVar: z.string().optional(),
  baseURL: z.string().optional(),
  model: z.string().optional(),
  searchDepth: z.enum(["basic", "advanced"]).optional(), // for Tavily
});

export const Config = z.object({
  // Global settings
  enabledBackends: z.array(z.string()).optional(),
  numResults: z.number().step(1).min(1).max(50).default(8),
  concurrency: z.number().step(1).min(1).max(10).default(6),
  backendTimeoutMs: z.number().step(1000).min(1000).max(120000).default(30000),
  
  // Per-backend GUI configs (optional, for Settings UI rendering)
  backendConfigs: z.array(BackendConfigSchema).optional(),
  
  // Key references for key-gated backends (credentialRef for Settings UI password field)
  deepseekApiKeyEnv: z.string().role("credential-ref").optional(),
  deepseekBaseURL: z.string().optional(),
  deepseekModel: z.string().optional(),
  anthropicApiKeyEnv: z.string().role("credential-ref").optional(),
  anthropicBaseURL: z.string().optional(),
  anthropicModel: z.string().optional(),
  openaiApiKeyEnv: z.string().role("credential-ref").optional(),
  openaiBaseURL: z.string().optional(),
  openaiModel: z.string().optional(),
  braveApiKeyEnv: z.string().role("credential-ref").optional(),
  braveBaseURL: z.string().optional(),
  tavilyApiKeyEnv: z.string().role("credential-ref").optional(),
  tavilyBaseURL: z.string().optional(),
  tavilyModel: z.string().optional(),
  tavilySearchDepth: z.enum(["basic", "advanced"]).optional(),
  serperApiKeyEnv: z.string().role("credential-ref").optional(),
  serperBaseURL: z.string().optional(),
  mojeekApiKeyEnv: z.string().role("credential-ref").optional(),
  mojeekBaseURL: z.string().optional(),
  searxngApiKeyEnv: z.string().role("credential-ref").optional(),
  searxngBaseURL: z.string().optional(),
});

/** Default labels for GUI (fallback if not in backendConfigs). */
const DEFAULT_LABELS = {
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

/** Default descriptions for GUI tooltips. */
const DEFAULT_DESCRIPTIONS = {
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

/** Backend type classification for GUI. */
const BACKEND_TYPES = {
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

/** Default base URLs. */
const FALLBACK_BASE_URLS = {
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

/**
 * Project one resolved settings section into the options snapshot the provider
 * serves its NEXT search with. Environment fallbacks stay here, not in the
 * backends. Key resolution uses credentialRef → credentials service → env.
 *
 * @param {object} ctx   Cordis plugin context
 * @param {object} config the currently authoritative section
 * @returns {object} options for one search
 */
export function resolveOptions(ctx, config) {
  // 1. Determine enabled backends: backendConfigs.enabled > enabledBackends > env > defaults
  let enabledBackends = [];
  
  if (config?.backendConfigs && Array.isArray(config.backendConfigs)) {
    // Priority 1: backendConfigs with explicit enabled flags
    enabledBackends = config.backendConfigs
      .filter((bc) => bc.enabled !== false)
      .map((bc) => bc.id)
      .filter((id) => ALL_BACKENDS.includes(id));
  }
  
  if (enabledBackends.length === 0) {
    // Priority 2: legacy enabledBackends array
    enabledBackends = config?.enabledBackends ?? [];
  }
  
  if (enabledBackends.length === 0) {
    // Priority 3: env override
    const envList = launchEnvironmentOf(ctx).get("DSH_UNIFIED_SEARCH_BACKENDS")?.value;
    if (envList && envList.length > 0) {
      enabledBackends = envList
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter((s) => ALL_BACKENDS.includes(s));
    }
  }
  
  if (enabledBackends.length === 0) {
    // Priority 4: defaults (keyless only)
    enabledBackends = ["exa", "parallel", "ddg", "searxng"];
  }

  // 2. Build backendConfigs map for quick lookup
  const backendConfigMap = new Map();
  if (config?.backendConfigs && Array.isArray(config.backendConfigs)) {
    for (const bc of config.backendConfigs) {
      if (bc.id) backendConfigMap.set(bc.id, bc);
    }
  }

  // 3. Resolve each backend's options
  const backends = {};
  for (const id of ALL_BACKENDS) {
    const guiConfig = backendConfigMap.get(id) ?? {};
    const keyEnvName = config?.[`${id}ApiKeyEnv`] ?? guiConfig.keyEnvVar ?? DEFAULT_KEY_ENV[id];
    const ref = credentialRef(keyEnvName);
    
    backends[id] = {
      // Core options
      apiKeyEnv: keyEnvName,
      baseURL: config?.[`${id}BaseURL`] ?? guiConfig.baseURL ?? FALLBACK_BASE_URLS[id],
      model: config?.[`${id}Model`] ?? guiConfig.model,
      searchDepth: config?.[`${id}SearchDepth`] ?? guiConfig.searchDepth, // Tavily
      
      // GUI metadata (passed through for potential future use)
      label: guiConfig.label ?? DEFAULT_LABELS[id] ?? id,
      description: guiConfig.description ?? DEFAULT_DESCRIPTIONS[id] ?? "",
      type: guiConfig.type ?? BACKEND_TYPES[id] ?? "keyless",
      requiresKey: guiConfig.requiresKey ?? (DEFAULT_KEY_ENV[id] ? true : false),
      keyEnvVar: keyEnvName,
      
      // Key resolution (lazy, per search)
      resolveApiKey: async () => {
        const credentials = ctx.get("credentials");
        if (credentials !== undefined) return (await credentials.resolve(ref))?.value;
        const ambient = launchEnvironmentOf(ctx).get(ref);
        return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined;
      },
    };
  }

  return {
    enabledBackends,
    numResults: config?.numResults ?? 8,
    concurrency: config?.concurrency ?? 6,
    backendTimeoutMs: config?.backendTimeoutMs ?? 30000,
    backends,
    ctx,
    // GUI metadata for potential Settings UI consumption
    backendGuiMeta: {
      labels: DEFAULT_LABELS,
      descriptions: DEFAULT_DESCRIPTIONS,
      types: BACKEND_TYPES,
      defaultBaseUrls: FALLBACK_BASE_URLS,
    },
  };
}

/**
 * Register the unified search provider with ctx.web. Installs a settings
 * section so users can configure enabled backends / numResults / base URLs /
 * model names / credential references; wires the provider's resolveOptions
 * thunk to read the live section each call.
 *
 * @param {object} ctx   Cordis plugin context
 * @param {object} config the initial section
 */
export function apply(ctx, config) {
  let current = () => config;

  installSettingsSection(ctx, NAMESPACE, Config, config, {
    setSource: (source) => {
      current = source;
    },
    onChange: () => {},
  });

  const provider = createUnifiedSearchProvider({
    ctx,
    resolveOptions: () => resolveOptions(ctx, current()),
    backends: BACKENDS,
  });

  ctx.web.registerSearchProvider(provider);
}
