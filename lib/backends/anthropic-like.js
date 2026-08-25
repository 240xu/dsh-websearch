// anthropic-like.js — shared backend for DeepSeek & Anthropic Messages-API
// providers using the native web_search server tool. Both speak the
// Anthropic-compatible Messages API; they differ only in baseURL, default
// model name, and api-version header. DeepSeek's endpoint is
// https://api.deepseek.com/anthropic/v1 (note the /anthropic prefix — chat
// completions use a different base, NOT reused here).
//
// Response shape (Anthropic Messages format):
//   content: [
//     { type: "web_search_tool_result", content: [ { type:"web_search_result", url, title, page_age }, ... ] },
//     { type: "text", text, citations:[{url, cited_text}] },
//     ...
//   ]
// The snippet comes from a text block's citation[] (keyed by url, first match
// wins). Each search costs a model turn; absence of a web_search_tool_result
// block is an error, not a prose fallback.

import { throwIfSearchAborted, searchAborted, isAbortError } from "../util/abort.js";
import { WebError } from "@deepseek-ai/dsh-web";

/** Attribution header; bumped with the package version. */
const UA = "dsh-websearch/2.1";

/**
 * Factory: create an Anthropic-like Messages backend.
 *
 * @param {object} spec
 * @param {string} spec.id          backend id ("deepseek" | "anthropic")
 * @param {string} spec.defaultBaseURL
 * @param {string} spec.defaultModel
 * @param {string} spec.defaultApiVersion   e.g. "2023-06-01"
 * @param {string} spec.toolName            "web_search_20250305"
 * @param {string} [spec.futureToolName]    optional newer tool for dual fallback
 * @returns {object} backend object { id, requiresCredential, available, search }
 */
export function createAnthropicLikeBackend(spec) {
  const {
    id,
    defaultBaseURL,
    defaultModel,
    defaultApiVersion,
    toolName,
    futureToolName,
  } = spec;

  return {
    id,
    requiresCredential: true,

    /**
     * options provider by provider.js: { apiKey, baseURL?, model?, apiVersion?, maxTokens?, maxUses?, apiVersion }
     */
    available(options) {
      // Per the official reference impl (dsh-web-search-deepseek): a backend is
      // usable when it has either a literal apiKey OR a lazy resolver function —
      // availability is a cheap local check, the key is resolved per search.
      const okKey = (typeof options?.apiKey === "string" && options.apiKey.length > 0)
        || typeof options?.resolveApiKey === "function";
      const urlOk = typeof options?.baseURL === "string" && URL.canParse(options.baseURL);
      return okKey && urlOk;
    },

    /**
     * @param {WebSearchRequest} request
     * @param {AbortSignal} signal
     * @param {object} options   resolved options (apiKey, baseURL, model, apiVersion, maxTokens, maxUses)
     * @param {{ recordRequest?: Function, recordOutcome?: Function }} [hooks]
     * @returns {Promise<WebSearchResult>}
     */
    async search(request, signal, options, hooks = {}) {
      throwIfSearchAborted(signal);
      const apiKey = options?.apiKey ?? await options?.resolveApiKey?.();
      if (!apiKey || apiKey.length === 0) {
        hooks.recordOutcome?.({ status: "error", message: "credential missing" });
        throw new WebError(
          `${id} search has no API key`,
          "WEB_PROVIDER_CREDENTIAL_MISSING",
        );
      }

      const baseURL = options.baseURL || defaultBaseURL;
      const model = options.model || defaultModel;
      const apiVersion = options.apiVersion || defaultApiVersion;
      const maxTokens = options.maxTokens ?? 4096;
      const maxUses = options.maxUses ?? 5;
      const endpoint = `${baseURL.replace(/\/$/, "")}/messages`;

      const body = {
        model,
        max_tokens: maxTokens,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Perform a web search for the query: ${request.query}`,
              },
            ],
          },
        ],
        tools: [{ type: toolName, name: "web_search", max_uses: maxUses }],
      };

      hooks.recordRequest?.({
        endpoint,
        toolName: `${id}:web_search`,
        body: { model, max_tokens: maxTokens, max_uses: maxUses, query: request.query },
        headers: { "anthropic-version": apiVersion },
      });

      throwIfSearchAborted(signal);

      let response;
      try {
        response = await fetch(endpoint, {
          method: "POST",
          redirect: "error",
          headers: {
            "x-api-key": apiKey,
            "authorization": `Bearer ${apiKey}`,
            "anthropic-version": apiVersion,
            "content-type": "application/json",
            "accept": "application/json",
            "user-agent": UA,
          },
          body: JSON.stringify(body),
          ...(signal !== undefined ? { signal } : {}),
        });
      } catch (err) {
        if (signal?.aborted === true || isAbortError(err)) throw searchAborted(signal, err);
        hooks.recordOutcome?.({ status: "error", message: String(err?.message ?? err) });
        throw new WebError(
          `${id} search request failed: ${String(err?.message ?? err)}`,
          "WEB_PROVIDER_ERROR",
          { cause: err },
        );
      }

      if (!response.ok) {
        let message = `${id} API error (HTTP ${response.status})`;
        try {
          const parsed = await response.json();
          const detail =
            typeof parsed.error === "string"
              ? parsed.error
              : parsed.error?.message ?? parsed.message;
          if (detail !== undefined && detail.length > 0) message = detail;
        } catch (err) {
          if (signal?.aborted === true || isAbortError(err)) throw searchAborted(signal, err);
        }
        hooks.recordOutcome?.({ status: "error", message });
        throw new WebError(message, "WEB_PROVIDER_ERROR");
      }

      try {
        const result = mapAnthropicResponse(await response.json(), id, futureToolName);
        hooks.recordOutcome?.({ status: "ok", sources: result.sources.length });
        return { sources: result.sources, content: undefined, truncated: false };
      } catch (err) {
        if (signal?.aborted === true || isAbortError(err)) throw searchAborted(signal, err);
        if (err instanceof WebError) {
          hooks.recordOutcome?.({ status: "error", message: err.message });
          throw err;
        }
        hooks.recordOutcome?.({ status: "error", message: String(err?.message ?? err) });
        throw new WebError(
          `${id} returned an unprocessable response body: ${String(err?.message ?? err)}`,
          "WEB_PROVIDER_ERROR",
          { cause: err },
        );
      }
    },
  };
}

/**
 * Optional dual-tool fallback: try the newer tool first; if that tool name is
 * rejected by the API (HTTP error mapping is upstream of us), the provider
 * retries with the established fallback. Here we just expose both — the
 * provider loops through candidates and uses whichever result block appears.
 */
export function tryDualToolResponse(response, id, primaryTool, fallbackTool) {
  return mapAnthropicResponse(response, id, primaryTool);
}

/**
 * Walk web_search_tool_result blocks for citeable web_search_result items,
 * join each to its citation excerpt as snippet, dedupe by url.
 * @param {object} response  parsed Messages body
 * @param {string} id        backend id (for error message)
 * @returns {{sources: WebSearchSource[]}}
 */
export function mapAnthropicResponse(response, id) {
  const blocks = response?.content ?? [];
  const resultBlocks = blocks.filter(
    (b) => b.type === "web_search_tool_result",
  );
  if (resultBlocks.length === 0) {
    throw new WebError(
      `${id} returned no web_search_tool_result blocks; native web search may not have triggered`,
      "WEB_PROVIDER_ERROR",
    );
  }
  const snippets = citationSnippets(blocks);
  const seen = new Set();
  const sources = [];
  for (const block of resultBlocks) {
    for (const item of block.content ?? []) {
      if (item.type !== "web_search_result" || !item.url || item.url.length === 0 || seen.has(item.url)) continue;
      seen.add(item.url);
      const snippet = snippets.get(item.url);
      const source = { url: item.url };
      if (item.title != null && item.title.length > 0) source.title = item.title;
      if (snippet != null && snippet.length > 0) source.snippet = snippet;
      if (item.page_age != null && item.page_age.length > 0) source.publishedAt = item.page_age;
      sources.push(source);
    }
  }
  return { sources };
}

/**
 * Build a url → cited_text map from text blocks' citations[] (first wins).
 * web_search_result items carry url/title/page_age but typically no inline
 * snippet; the excerpt lives in a separate text block's citation keyed by url.
 */
function citationSnippets(blocks) {
  const map = new Map();
  for (const block of blocks) {
    if (block.type !== "text") continue;
    for (const cite of block.citations ?? []) {
      if (
        cite.url != null &&
        cite.url.length > 0 &&
        cite.cited_text != null &&
        cite.cited_text.length > 0 &&
        !map.has(cite.url)
      ) {
        map.set(cite.url, cite.cited_text);
      }
    }
  }
  return map;
}

/** Pre-built instances for the two anthropic-like providers we ship. */
export const deepseekBackend = createAnthropicLikeBackend({
  id: "deepseek",
  defaultBaseURL: "https://api.deepseek.com/anthropic/v1",
  defaultModel: "deepseek-v4-flash",
  defaultApiVersion: "2023-06-01",
  toolName: "web_search_20250305",
});

export const anthropicBackend = createAnthropicLikeBackend({
  id: "anthropic",
  defaultBaseURL: "https://api.anthropic.com/v1",
  defaultModel: "claude-sonnet-4-6",
  defaultApiVersion: "2023-06-01",
  toolName: "web_search_20250305",
});
