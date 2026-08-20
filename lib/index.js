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
  searxng: searxngBackend,
  brave: braveBackend,
  tavily: tavilyBackend,
  serper: serperBackend,
  mojeek: mojeekBackend,
  deepseek: deepseekBackend,
  anthropic: anthropicBackend,
  openai: openaiBackend,
};

/** All backend ids in registry order. */
const ALL_BACKENDS = Object.keys(BACKENDS);

/** Backends enabled by default (keyless only). */
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

/** Default models for model-carrying backends. */
const DEFAULT_MODELS = {
  deepseek: "deepseek-v4-flash",
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-4o",
};

/**
 * GUI-friendly labels for each backend (shown in the Settings panel).
 */
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

/**
 * Settings schema — flat, GUI-friendly. Every object property is optional by
 * default in schemastery; defaults are supplied via .default(). API keys are
 * credential-refs (env-var names), which the Settings UI renders as a
 * credential selector / secret field.
 */
export const Config = z.object({
  // Global
  numResults: z.number().step(1).min(1).max(50).default(8)
    .description("每次搜索返回的最大结果数"),
  concurrency: z.number().step(1).min(1).max(10).default(6)
    .description("同时并发的后端数量"),
  backendTimeoutMs: z.number().step(1000).min(1000).max(120000).default(30000)
    .description("单后端最大等待时间（毫秒）"),

  // Enable toggles (one per backend)
  enableExa: z.boolean().default(true).description(DEFAULT_LABELS.exa),
  enableParallel: z.boolean().default(true).description(DEFAULT_LABELS.parallel),
  enableDdg: z.boolean().default(true).description(DEFAULT_LABELS.ddg),
  enableSearxng: z.boolean().default(true).description(DEFAULT_LABELS.searxng),
  enableBrave: z.boolean().default(false).description(DEFAULT_LABELS.brave),
  enableTavily: z.boolean().default(false).description(DEFAULT_LABELS.tavily),
  enableSerper: z.boolean().default(false).description(DEFAULT_LABELS.serper),
  enableMojeek: z.boolean().default(false).description(DEFAULT_LABELS.mojeek),
  enableDeepseek: z.boolean().default(false).description(DEFAULT_LABELS.deepseek),
  enableAnthropic: z.boolean().default(false).description(DEFAULT_LABELS.anthropic),
  enableOpenai: z.boolean().default(false).description(DEFAULT_LABELS.openai),

  // Credential refs (env-var names; secrets live in the credentials service)
  braveApiKeyEnv: z.string().role("credential-ref").default(DEFAULT_KEY_ENV.brave),
  tavilyApiKeyEnv: z.string().role("credential-ref").default(DEFAULT_KEY_ENV.tavily),
  serperApiKeyEnv: z.string().role("credential-ref").default(DEFAULT_KEY_ENV.serper),
  mojeekApiKeyEnv: z.string().role("credential-ref").default(DEFAULT_KEY_ENV.mojeek),
  deepseekApiKeyEnv: z.string().role("credential-ref").default(DEFAULT_KEY_ENV.deepseek),
  anthropicApiKeyEnv: z.string().role("credential-ref").default(DEFAULT_KEY_ENV.anthropic),
  openaiApiKeyEnv: z.string().role("credential-ref").default(DEFAULT_KEY_ENV.openai),
  searxngApiKeyEnv: z.string().role("credential-ref").default("SEARXNG_API_KEY")
    .description("SearXNG 私有实例的 API Key（公共实例留空）"),

  // Base URLs (defaults from built-in registry)
  braveBaseURL: z.string().default(DEFAULT_BASE_URLS.brave),
  tavilyBaseURL: z.string().default(DEFAULT_BASE_URLS.tavily),
  serperBaseURL: z.string().default(DEFAULT_BASE_URLS.serper),
  mojeekBaseURL: z.string().default(DEFAULT_BASE_URLS.mojeek),
  searxngBaseURL: z.string().default(DEFAULT_BASE_URLS.searxng),
  deepseekBaseURL: z.string().default(DEFAULT_BASE_URLS.deepseek),
  anthropicBaseURL: z.string().default(DEFAULT_BASE_URLS.anthropic),
  openaiBaseURL: z.string().default(DEFAULT_BASE_URLS.openai),

  // Models
  deepseekModel: z.string().default(DEFAULT_MODELS.deepseek),
  anthropicModel: z.string().default(DEFAULT_MODELS.anthropic),
  openaiModel: z.string().default(DEFAULT_MODELS.openai),
  tavilySearchDepth: z.union(["basic", "advanced"]).default("basic")
    .description("Tavily 搜索深度"),

  // Legacy compatibility: explicit enabled-backend list overrides toggles
  enabledBackends: z.array(z.string())
    .description("显式启用后端列表（优先于上方开关；留空则用开关）"),
});

/**
 * Project one resolved settings section into the options snapshot the provider
 * serves its NEXT search with. Key resolution: credentialRef -> credentials
 * service -> env.
 */
export function resolveOptions(ctx, config) {
  // 1. Determine enabled backends: explicit list > toggles > env > defaults
  let enabledBackends = [];

  if (config?.enabledBackends && config.enabledBackends.length > 0) {
    enabledBackends = config.enabledBackends.filter((id) => ALL_BACKENDS.includes(id));
  }

  if (enabledBackends.length === 0) {
    const toggleMap = {
      exa: config?.enableExa,
      parallel: config?.enableParallel,
      ddg: config?.enableDdg,
      searxng: config?.enableSearxng,
      brave: config?.enableBrave,
      tavily: config?.enableTavily,
      serper: config?.enableSerper,
      mojeek: config?.enableMojeek,
      deepseek: config?.enableDeepseek,
      anthropic: config?.enableAnthropic,
      openai: config?.enableOpenai,
    };
    enabledBackends = ALL_BACKENDS.filter((id) => toggleMap[id] === true);
  }

  if (enabledBackends.length === 0) {
    const envList = launchEnvironmentOf(ctx).get(ENABLED_ENV)?.value;
    if (envList && envList.length > 0) {
      enabledBackends = envList
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter((s) => ALL_BACKENDS.includes(s));
    }
  }

  if (enabledBackends.length === 0) {
    enabledBackends = [...DEFAULT_ENABLED];
  }

  // 2. Resolve each backend option
  const backends = {};
  for (const id of ALL_BACKENDS) {
    const keyEnvName = config?.[`${id}ApiKeyEnv`] ?? DEFAULT_KEY_ENV[id];
    const ref = credentialRef(keyEnvName);

    backends[id] = {
      apiKeyEnv: keyEnvName,
      baseURL: config?.[`${id}BaseURL`] ?? DEFAULT_BASE_URLS[id],
      model: config?.[`${id}Model`] ?? DEFAULT_MODELS[id],
      searchDepth: config?.tavilySearchDepth,
      label: DEFAULT_LABELS[id] ?? id,
      requiresKey: DEFAULT_KEY_ENV[id] !== undefined,
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
  };
}

/**
 * Register the unified search provider with ctx.web. Installs a settings
 * section so users can configure enabled backends / numResults / base URLs /
 * model names / credential references in the DSH Settings panel.
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
