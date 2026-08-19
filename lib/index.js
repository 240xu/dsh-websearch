/**
 * dsh-unified-search: unified free web search provider for the DSH web seam (ctx.web).
 * Registers ONE provider under id "unified" that fans out to multiple backends
 * concurrently and merges (URL-deduped) results. Keyless backends (Exa, Parallel,
 * DuckDuckGo) give zero-config search; key-gated backends (DeepSeek/Anthropic/
 * OpenAI) activate when their API key is stored via the credentials service or
 * the launching environment.
 *
 * @module @deepseek-ai/dsh-unified-search
 */
import z from "@deepseek-ai/schemastery";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import {
  installSettingsSection,
  settingsNamespace,
} from "@deepseek-ai/dsh-settings";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import { WebError } from "@deepseek-ai/dsh-web";

import { exaBackend } from "./backends/exa.js";
import { parallelBackend } from "./backends/parallel.js";
import { ddgBackend } from "./backends/ddg.js";
import {
  deepseekBackend,
  anthropicBackend,
} from "./backends/anthropic-like.js";
import { openaiBackend } from "./backends/openai.js";
import { createUnifiedSearchProvider } from "./provider.js";

/** Cordis plugin name used by loader diagnostics. */
export const name = "unified-search";
/** The web seam this provider registers into. */
export const inject = ["web"];

/** Settings namespace key. */
const NAMESPACE = settingsNamespace("unified-search");

/** Full backend registry. Order matters only for the default-enabled list. */
const BACKENDS = {
  exa: exaBackend,
  parallel: parallelBackend,
  ddg: ddgBackend,
  deepseek: deepseekBackend,
  anthropic: anthropicBackend,
  openai: openaiBackend,
};

/** All backend ids in registry order. */
const ALL_BACKENDS = ["exa", "parallel", "ddg", "deepseek", "anthropic", "openai"];

/** Keyless backends enabled by default; key-gated only when their key exists. */
const DEFAULT_ENABLED = ["exa", "parallel", "ddg"];

/** Environment-variable names each key-gated backend reads. */
const DEFAULT_KEY_ENV = {
  deepseek: "DEEPSEEK_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

/** Env var that overrides the default backend sweep order / enabled set. */
const ENABLED_ENV = "DSH_UNIFIED_SEARCH_BACKENDS";

export const Config = z.object({
  enabledBackends: z.array(z.string()),
  numResults: z.number().step(1).min(1).max(20),
  // Key references for key-gated backends:
  deepseekApiKeyEnv: z.string().role("credential-ref"),
  deepseekBaseURL: z.string(),
  deepseekModel: z.string(),
  anthropicApiKeyEnv: z.string().role("credential-ref"),
  anthropicBaseURL: z.string(),
  anthropicModel: z.string(),
  openaiApiKeyEnv: z.string().role("credential-ref"),
  openaiBaseURL: z.string(),
  openaiModel: z.string(),
});

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
  // enabledBackends: config → env override → defaults (keyless only).
  let enabled = config?.enabledBackends ?? null;
  if (!enabled || enabled.length === 0) {
    const envList = launchEnvironmentOf(ctx).get(ENABLED_ENV)?.value;
    if (envList && envList.length > 0) {
      enabled = envList
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter((s) => ALL_BACKENDS.includes(s));
    }
  }
  if (!enabled || enabled.length === 0) enabled = [...DEFAULT_ENABLED];

  // Resolve each key-gated backend's options (apiKey via credentials service → env).
  const backends = {};
  for (const id of ["deepseek", "anthropic", "openai"]) {
    const keyEnvName = config?.[`${id}ApiKeyEnv`] ?? DEFAULT_KEY_ENV[id];
    const ref = credentialRef(keyEnvName);
    backends[id] = {
      apiKeyEnv: keyEnvName,
      baseURL: config?.[`${id}BaseURL`] ?? undefined,
      model: config?.[`${id}Model`] ?? undefined,
      resolveApiKey: async () => {
        const credentials = ctx.get("credentials");
        if (credentials !== undefined) return (await credentials.resolve(ref))?.value;
        const ambient = launchEnvironmentOf(ctx).get(ref);
        return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined;
      },
    };
    // Pre-resolve synchronously-available literal keys if set elsewhere;
    // providers lazily await resolveApiKey() on each search. We expose it
    // through resolveApiKey, mirroring dsh-web-search-deepseek.
  }

  return {
    enabledBackends: enabled,
    numResults: config?.numResults ?? 8,
    backends,
    ctx,
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
