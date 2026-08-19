// exa.js — Exa search backend (streamable-http MCP, keyless).
// Exa's MCP server is at https://mcp.exa.ai/mcp. It exposes two tools:
//   - web_search_exa   { query, numResults }  → searching
//   - web_fetch_exa    { urls, maxCharacters } → page content (not used here)
// Responses come back as a text/event-stream where the JSON envelope holds
// result.content[0].text as a human-readable block of "Title:/URL:/Published:
// …/Highlights: …/  …" separated by "\n\n---\n\n"; we split into source
// objects. Exa is keyless — its public MCP endpoint requires no API key.

import { searchAborted, isAbortError } from "../util/abort.js";
import { rpcCall } from "../util/rpc.js";
import { WebError } from "@deepseek-ai/dsh-web";

const EXA_ENDPOINT = "https://mcp.exa.ai/mcp";
const EXA_TOOL = "web_search_exa";

export const exaBackend = {
  id: "exa",
  requiresCredential: false,

  available() {
    return true; // keyless endpoint
  },

  /**
   * @param {WebSearchRequest} request
   * @param {AbortSignal} signal
   * @param {{ recordRequest?: Function, recordOutcome?: Function }} [hooks]
   * @returns {Promise<WebSearchResult>}
   */
  async search(request, signal, hooks = {}) {
    const args = {
      query: request.query,
      numResults: request.maxResults ?? 8,
    };
    hooks.recordRequest?.({
      endpoint: EXA_ENDPOINT,
      toolName: EXA_TOOL,
      body: args,
      headers: {},
    });

    let result;
    try {
      result = await rpcCall(EXA_ENDPOINT, EXA_TOOL, args, {}, signal);
    } catch (err) {
      if (signal?.aborted === true || isAbortError(err)) throw searchAborted(signal, err || new Error("aborted"));
      if (err instanceof WebError) throw err;
      throw new WebError(
        `exa search failed: ${String(err?.message ?? err)}`,
        "WEB_PROVIDER_ERROR",
        { cause: err },
      );
    }

    hooks.recordOutcome?.({ status: "ok" });
    const sources = parseExaResult(result, request.maxResults ?? 8);

    // MCP ("isError": true) responses still come back with regular RPC shape
    // but flagged; surface as a provider error rather than empty results.
    if (result?.isError === true) {
      throw new WebError(
        `exa returned an MCP error: ${String(result.content?.[0]?.text ?? "unknown")}`,
        "WEB_PROVIDER_ERROR",
      );
    }

    return { sources, content: undefined, truncated: false };
  },
};

/**
 * Parse Exa's human-readable text response into WebSearchSource[].
 * The text is a series of blocks separated by "\n\n---\n\n". Each block has:
 *   Title: <title>
 *   URL: <url>
 *   Published: <date>            (optional)
 *   Author: <author>            (optional, ignored)
 *   Highlights:
 *     - <bullet>
 *     - <bullet>
 *
 * Snippet = " … "-joined Highlights bullets (when present). Blocks without a URL
 * are dropped.
 *
 * @param {object} result        MCP result envelope { content: [{ text }] }
 * @param {number} maxResults
 * @returns {Array<{url:string,title?:string,snippet?:string,publishedAt?:string}>}
 */
export function parseExaResult(result, maxResults) {
  const text = result?.content?.[0]?.text;
  if (typeof text !== "string" || text.length === 0) return [];
  const blocks = text.split("\n\n---\n\n");
  const sources = [];
  for (const block of blocks) {
    const url = matchField(block, /^URL:\s*(.+)$/m);
    if (!url) continue; // URL is the source-identity anchor; skip if absent.
    const source = { url: url.trim() };
    const title = matchField(block, /^Title:\s*(.+)$/m);
    if (title) source.title = title.trim();
    const published = matchField(block, /^Published:\s*(.+)$/m);
    if (published) source.publishedAt = published.trim();
    const snippet = joinHighlights(block);
    if (snippet) source.snippet = snippet;
    sources.push(source);
    if (sources.length >= maxResults) break;
  }
  return sources;
}

function matchField(block, re) {
  const m = re.exec(block);
  return m ? m[1].trim() : undefined;
}

function joinHighlights(block) {
  const m = /^Highlights:\s*$/m.exec(block);
  if (!m) return undefined; // No Highlights section → no snippet from this block.
  const tail = block.slice(m.index + m[0].length);
  const bullets = [...tail.matchAll(/^\s+-\s+(.+)$/gm)].map((b) => b[1].trim());
  if (bullets.length === 0) return undefined;
  return bullets.join(" … ");
}

export default exaBackend;
