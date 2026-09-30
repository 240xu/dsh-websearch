/**
 * dsh-websearch: unified web search provider for the DSH web seam (ctx.web).
 * Registers ONE provider under id "unified" that fans out to multiple backends
 * concurrently and merges (URL-deduped) results. Keyless backends (Exa, Parallel,
 * DuckDuckGo, SearXNG) give zero-config search; key-gated backends (DeepSeek/
 * Anthropic/OpenAI/Brave/Tavily/Serper/Mojeek) activate when their API key is
 * stored via the credentials service or the launching environment.
 *
 * @module dsh-websearch
 */
import z from "@deepseek-ai/schemastery";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
// NOTE (2026-09-12, dsh 0.1.5 compat): installSettingsSection +
// settingsNamespace were removed from @deepseek-ai/dsh-settings in the 0.1.5
// line (only SettingsProvider/SettingsConflictError/redactSecrets remain).
// Settings sections are now installed through the `settings` service, as the
// stock plugins do (see dsh-permission-presets). NAMESPACE was always the
// plain string "unified-search". No import needed anymore.
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
import { createUnifiedSearchProvider, getLatestBackendHealth } from "./provider.js";
import { registerHealthRoute } from "./health.js";
import { createSearchCache, CACHE_DEFAULTS } from "./cache.js";
import { createHistoryStore, registerHistoryRoutes, HISTORY_MAX_ENTRIES } from "./history.js";
import { BREAKER_DEFAULTS } from "./breaker.js";
import os from "node:os";
import path from "node:path";

/** Cordis plugin name used by loader diagnostics. */
export const name = "unified-search";
/** The web seam this provider registers into. */
export const inject = ["web"];

/** Settings namespace key. */
const NAMESPACE = "unified-search";

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

  // v2.1 result shaping
  recency: z.union(["any", "day", "week", "month", "year"]).default("any")
    .description("时间范围过滤（映射到各后端原生参数；any=不过滤）"),
  language: z.string().default("")
    .description("搜索语言（如 en、zh-CN；留空用各后端默认）"),
  safeSearch: z.boolean().default(true)
    .description("安全搜索（SearXNG / Brave 支持开关，其余后端忽略）"),
  dedupStrategy: z.union(["url", "url+title"]).default("url")
    .description("去重策略：url 仅按链接；url+title 额外合并同标题的转载镜像"),
  rerank: z.boolean().default(false)
    .description("按查询词相关性重排序（确定性、并列时保持后端优先级）"),
  resultTelemetry: z.boolean().default(true)
    .description("在搜索结果尾部附一行后端健康遥测（状态+耗时），模型可据此自诊断"),

  // v2.7.0 disk cache / circuit breaker / search history
  // W1 (fe-ui review): labels speak user language with a group prefix
  // (【缓存】/【熔断】/【历史】) instead of camelCase keys; units are
  // spelled out (秒 / 毫秒) and grouping follows the field order below.
  cacheEnabled: z.boolean().default(true)
    .description("启用搜索结果缓存【缓存】：相同查询+过滤+条数在有效期内直接命中，不再请求后端"),
  cacheTtl: z.number().step(30).min(30).max(86400).default(900)
    .description("缓存有效期【缓存】（单位：秒）：默认 900 秒；不想用缓存请直接关闭上一项"),
  breakerEnabled: z.boolean().default(true)
    .description("后端熔断器【熔断】：连续失败达阈值后暂停该后端一段时间；全部暂停时自动放行，不会让搜索更差"),
  breakerThreshold: z.number().step(1).min(1).max(20).default(BREAKER_DEFAULTS.threshold)
    .description("熔断阈值【熔断】：连续失败多少次后触发（默认 3 次）"),
  breakerCooldownMs: z.number().step(1000).min(0).max(3600000).default(BREAKER_DEFAULTS.cooldownMs)
    .description("熔断冷却时长【熔断】（单位：毫秒）：默认 60000；设为 0 表示关闭冷却（熔断仅计数）"),
  historyEnabled: z.boolean().default(true)
    .description("记录搜索历史【历史】：只追加，最多 50 条；可在设置 → 搜索 中查看与清空"),

  // v2.8.0 查全查多
  multiQueryEnabled: z.boolean().default(false)
    .description("多查询融合【查全】：复杂查询（长度>60 或含 vs/and/比较/对比/和）自动派生 2-3 个子查询，各扇出后用 RRF(k=60) 融合；默认关"),
  deepCoverage: z.boolean().default(false)
    .description("深度覆盖【查全】：每后端请求条数上调 50% 再全局去重截断，牺牲带宽换覆盖面；Tavily 自动切 advanced 深度，SearXNG 扩展多类目；默认关"),

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
 * Per-field user-language labels (fe-ui W1 remainder): the settings renderer
 * falls back to camelCase keys when no label is present, so attach one to
 * each v2.7 descriptor (meta.label, plus a plain .label for renderers that
 * read the top level). Units live in the label tail (秒 / 毫秒). Whether the
 * host actually renders them is visual-check V5; the schema layer now
 * provides the field regardless.
 */
const FIELD_LABELS = {
  cacheEnabled: "启用搜索结果缓存",
  cacheTtl: "缓存有效期（秒）",
  breakerEnabled: "后端熔断器",
  breakerThreshold: "熔断阈值（连续失败次数）",
  breakerCooldownMs: "熔断冷却时长（毫秒）",
  historyEnabled: "记录搜索历史",
};
for (const [key, label] of Object.entries(FIELD_LABELS)) {
  const sch = Config.dict?.[key];
  if (sch) {
    sch.meta = { ...sch.meta, label };
    sch.label = label;
  }
}

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
      ...(id === "tavily" ? { searchDepth: config?.tavilySearchDepth ?? "basic" } : {}),
      safeSearch: config?.safeSearch !== false,
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

  const language = typeof config?.language === "string" ? config.language.trim() : "";

  return {
    enabledBackends,
    numResults: config?.numResults ?? 8,
    concurrency: config?.concurrency ?? 6,
    backendTimeoutMs: config?.backendTimeoutMs ?? 30000,
    // v2.1 shaping options consumed by the provider merge pipeline.
    dedupStrategy: config?.dedupStrategy === "url+title" ? "url+title" : "url",
    rerank: config?.rerank === true,
    resultTelemetry: config?.resultTelemetry !== false,
    // v2.7.0 cache / breaker / history
    cacheEnabled: config?.cacheEnabled === true,
    cacheTtlS: Math.max(30, Math.floor(Number(config?.cacheTtl) || CACHE_DEFAULTS.ttlMs / 1000)),
    breakerEnabled: config?.breakerEnabled !== false,
    breakerThreshold: Math.max(1, Math.floor(Number(config?.breakerThreshold) || BREAKER_DEFAULTS.threshold)),
    breakerCooldownMs: config?.breakerCooldownMs != null
      ? Math.max(0, Math.floor(Number(config?.breakerCooldownMs) || 0))  // 0 = disabled
      : BREAKER_DEFAULTS.cooldownMs,
    historyEnabled: config?.historyEnabled !== false,
    // v2.8.0 coverage / multiQuery
    multiQueryEnabled: config?.multiQueryEnabled === true,
    deepCoverage: config?.deepCoverage === true,
    filters: {
      recency: typeof config?.recency === "string" && config.recency !== "any" ? config.recency : undefined,
      lang: language.length > 0 ? language : undefined,
    },
    backends,
    ctx,
  };
}

/**
 * Resolve the plugin's persistent store directory (cache + history).
 * Pure and exported for tests: precedence is DSH_HOME > <home>/.dsh, where
 * home falls back to os.homedir() — NOT process.env.HOME, which is usually
 * unset on Windows and would silently disable cache/history (compat-audit
 * P2-7).
 * @param {{DSH_HOME?: string, HOME?: string}} env
 * @param {string} [fallbackHome] injected os.homedir() for tests
 */
export function resolveStoreDir(env = process.env, fallbackHome = os.homedir()) {
  return path.join(env.DSH_HOME || path.join(fallbackHome, ".dsh"), "cache", "websearch");
}

/**
 * Register the unified search provider with ctx.web. Installs a settings
 * section so users can configure enabled backends / numResults / base URLs /
 * model names / credential references in the DSH Settings panel.
 */
export function apply(ctx, config) {
  let current = () => config;

  ctx.inject(["settings"], (settingsCtx) => {
    const settings = settingsCtx.settings;
    if (typeof settings?.installSection === "function") {
      settings.installSection(ctx, NAMESPACE, Config, config, {
        setSource: (source) => {
          current = source;
        },
        onChange: () => {},
      });
      return;
    }
    // DSH 0.1.7+: the settings service is SettingsForms and has no
    // installSection. The Config schema still resolves through cordis config
    // (this file reads `current()`), so search keeps working; surface the gap
    // once instead of silently swallowing it (compat-audit P1).
    console.warn(
      "[dsh-websearch] settings service has no installSection (DSH >= 0.1.7 SettingsForms line); " +
      "the Settings panel section is not installed. Configure the unified-search namespace via cordis config " +
      "or the client settings card; migration to the SettingsForms API is tracked for a future release.",
    );
  });

  // v2.7.0 stores: disk cache + append-only search history, both under
  // DSH_HOME/cache/websearch (created lazily; every fs error is swallowed so
  // a broken store never breaks a search).
  // DSH_HOME wins when set; otherwise the OS home directory. os.homedir()
  // (not process.env.HOME) is the cross-platform fallback — HOME is usually
  // unset on Windows, which previously made storeDir relative to the current
  // working directory and silently disabled cache/history (compat-audit P2-7).
  const storeDir = resolveStoreDir();
  const searchCache = createSearchCache({
    dir: path.join(storeDir, "results"),
    ttlMs: () => resolveOptions(ctx, current()).cacheTtlS * 1000,
    maxEntries: CACHE_DEFAULTS.maxEntries,
  });
  const historyStore = createHistoryStore({ dir: storeDir, maxEntries: HISTORY_MAX_ENTRIES });

  const provider = createUnifiedSearchProvider({
    ctx,
    resolveOptions: () => resolveOptions(ctx, current()),
    backends: BACKENDS,
    cache: {
      get: (key) => searchCache.get(key),
      set: (key, value) => searchCache.set(key, value),
    },
    history: {
      record: (entry) => {
        if (resolveOptions(ctx, current()).historyEnabled !== true) return;
        historyStore.record(entry);
      },
    },
  });

  ctx.web.registerSearchProvider(provider);

  // Read-only health route: webServer is an optional, late-mounted host
  // service (same pattern as dsh-chat-import's panel routes). Headless / CI
  // profiles never mount it and the callback simply never runs. The route
  // only reads the settings snapshot + last per-search telemetry — it never
  // probes backends and never touches credential values.
  ctx.inject(["webServer"], (webCtx) => {
    registerHealthRoute(webCtx.webServer, {
      resolveOptions: () => resolveOptions(ctx, current()),
      backends: BACKENDS,
      getBackendHealth: getLatestBackendHealth,
    });
    // v2.7.0 search history: read-only GET + explicit clear POST.
    // v2.8.0: GET also carries per-backend last-outcome observability.
    registerHistoryRoutes(webCtx.webServer, {
      getStore: () => historyStore,
      getBackendHealth: getLatestBackendHealth,
    });
  });
}
