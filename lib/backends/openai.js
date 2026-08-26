// openai.js — OpenAI Responses API backend (key-gated)
// Uses POST /responses with the built-in "web_search" tool (Responses API
// native web search). The Responses API returns:
//   output: [
//     { type:"web_search_call", id, status:"completed" },
//     { type:"message", content:[ { type:"output_text", text, annotations:
//       [ { type:"url_citation", url, title, start_index, end_index } ] } ] }
//   ]
// Sources = url_citation annotations (deduped by url); the surrounding output_text
// segment ~[start,end] can serve as a rough snippet when the API doesn't
// return a separate excerpt.

import { throwIfSearchAborted, searchAborted, isAbortError } from "../util/abort.js";
import { WebError } from "@deepseek-ai/dsh-web";

const UA = "dsh-websearch/2.3";

export const openaiBackend = {
  id: "openai",
  requiresCredential: true,

  /**
   * options: { apiKey, baseURL?, model? }
   */
  available(options) {
    const okKey = (typeof options?.apiKey === "string" && options.apiKey.length > 0)
      || typeof options?.resolveApiKey === "function";
    const urlOk = typeof options?.baseURL === "string" && URL.canParse(options.baseURL);
    return okKey && urlOk;
  },

  /**
   * @param {WebSearchRequest} request
   * @param {AbortSignal} signal
   * @param {object} options   { apiKey, baseURL?, model? }
   * @param {{ recordRequest?: Function, recordOutcome?: Function }} [hooks]
   * @returns {Promise<WebSearchResult>}
   */
  async search(request, signal, options, hooks = {}) {
    throwIfSearchAborted(signal);
    const apiKey = options?.apiKey ?? await options?.resolveApiKey?.();
    if (!apiKey || apiKey.length === 0) {
      hooks.recordOutcome?.({ status: "error", message: "credential missing" });
      throw new WebError(
        "openai search has no API key",
        "WEB_PROVIDER_CREDENTIAL_MISSING",
      );
    }
    const baseURL = (options.baseURL || "https://api.openai.com/v1").replace(/\/$/, "");
    const model = options.model || "gpt-4o";
    const endpoint = `${baseURL}/responses`;

    const body = {
      model,
      tools: [{ type: "web_search" }],
      input: request.query,
    };

    hooks.recordRequest?.({
      endpoint,
      toolName: "openai:web_search",
      body: { model, query: request.query },
      headers: {},
    });

    throwIfSearchAborted(signal);

    let response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        redirect: "error",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Accept": "application/json",
          "User-Agent": UA,
        },
        body: JSON.stringify(body),
        ...(signal !== undefined ? { signal } : {}),
      });
    } catch (err) {
      if (signal?.aborted === true || isAbortError(err)) throw searchAborted(signal, err);
      hooks.recordOutcome?.({ status: "error", message: String(err?.message ?? err) });
      throw new WebError(
        `openai search request failed: ${String(err?.message ?? err)}`,
        "WEB_PROVIDER_ERROR",
        { cause: err },
      );
    }

    if (!response.ok) {
      let message = `openai API error (HTTP ${response.status})`;
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
      const json = await response.json();
      const sources = parseOpenAIResponses(json, request.maxResults ?? 8);
      hooks.recordOutcome?.({ status: "ok", sources: sources.length });
      return { sources, content: undefined, truncated: false };
    } catch (err) {
      if (signal?.aborted === true || isAbortError(err)) throw searchAborted(signal, err);
      if (err instanceof WebError) {
        hooks.recordOutcome?.({ status: "error", message: err.message });
        throw err;
      }
      hooks.recordOutcome?.({ status: "error", message: String(err?.message ?? err) });
      throw new WebError(
        `openai returned an unprocessable response body: ${String(err?.message ?? err)}`,
        "WEB_PROVIDER_ERROR",
        { cause: err },
      );
    }
  },
};

/**
 * Parse a /responses body into WebSearchSource[]. Sources come from
 * output[].content[].annotations[] with type "url_citation". Each carries
 * { url, title, start_index, end_index } — we optionally slice the surrounding
 * output_text to produce a rough snippet.
 *
 * @param {object} json  the /responses body
 * @param {number} maxResults
 * @returns {Array<{url:string,title?:string,snippet?:string}>}
 */
export function parseOpenAIResponses(json, maxResults) {
  if (!json || !Array.isArray(json.output)) return [];
  const seen = new Set();
  const sources = [];

  for (const out of json.output) {
    if (out.type !== "message" || !Array.isArray(out.content)) continue;
    for (const block of out.content) {
      if (block.type !== "output_text" || typeof block.text !== "string") continue;
      for (const ann of block.annotations ?? []) {
        if (ann.type !== "url_citation" || !ann.url || seen.has(ann.url)) continue;
        seen.add(ann.url);
        const source = { url: ann.url };
        if (ann.title && ann.title.length > 0) source.title = ann.title;
        // Rough snippet: the text slice around the citation. May be verbose;
        // cap to 240 chars as a courtesy. Only emit if non-empty & informative.
        if (
          typeof ann.start_index === "number" &&
          typeof ann.end_index === "number" &&
          ann.end_index > ann.start_index
        ) {
          const slice = block.text.slice(ann.start_index, ann.end_index).trim();
          if (slice.length > 0) source.snippet = slice.slice(0, 240);
        }
        sources.push(source);
        if (sources.length >= maxResults) return sources;
      }
    }
  }
  return sources;
}

export default openaiBackend;
