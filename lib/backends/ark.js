// ark.js — 火山方舟 (Volcengine Ark) backend (key-gated).
//
// Ark's Responses API is OpenAI-Responses compatible for the one shape this
// plugin needs: POST {baseURL}/responses with the server-side
// `tools: [{ type: "web_search" }]` tool returns an `output[]` array whose
// items are `web_search_call` / `message`, and the message's `output_text`
// content carries `url_citation` annotations (`url`, `title`). That is exactly
// what `openai.js` already parses, so this backend reuses its transport and
// only pins Ark's endpoint/model defaults plus the `max_keyword` knob Ark
// exposes on the same tool.
//
// Verified against `https://ark.cn-beijing.volces.com/api/plan/v3/responses`
// (Agent Plan) with `doubao-seed-2.1-pro` on 2026-10-23: HTTP 200,
// output types `["reasoning", "web_search_call", "reasoning", "message"]`,
// `url_citation` annotations present.
//
// Platform keys use `https://ark.cn-beijing.volces.com/api/v3`; Agent Plan
// keys use the `/api/plan/v3` prefix. Both are plain Responses endpoints, so
// the only difference is the configured base URL.

import { openaiBackend } from "./openai.js";

export const arkBackend = {
  id: "ark",
  requiresCredential: true,

  /**
   * options: { apiKey, baseURL?, model? }
   */
  available(options) {
    return openaiBackend.available(options);
  },

  /**
   * @param {WebSearchRequest} request
   * @param {AbortSignal} signal
   * @param {object} options   { apiKey, baseURL?, model? }
   * @param {{ recordRequest?: Function, recordOutcome?: Function }} [hooks]
   * @returns {Promise<WebSearchResult>}
   */
  async search(request, signal, options, hooks = {}) {
    return openaiBackend.search(request, signal, options, hooks);
  },
};
