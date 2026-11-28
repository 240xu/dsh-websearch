// exa.js — Exa search backend (streamable-http MCP, keyless).
// Exa's MCP server is at https://mcp.exa.ai/mcp. It exposes:
//   - web_search_exa   { query, numResults }  -> searching
//   - web_fetch_exa    { urls, maxCharacters } -> page content (not used here)
// Responses come back as text/event-stream where the JSON envelope holds
// result.content[0].text as human-readable blocks of "Title:/URL:/Published:
// .../Highlights: .../  ..." separated by "\n\n---\n\n"; we split into source objects.
// Exa is keyless — its public MCP endpoint requires no API key.

import { mcpCall } from "../util/mcp-client.js";
import { WebError } from "@deepseek-ai/dsh-web";
import { describeError } from "../util/describe-error.js";

const EXA_ENDPOINT = "https://mcp.exa.ai/mcp";
const EXA_TOOL = "web_search_exa";

export const exaBackend = {
  id: "exa",
  requiresCredential: false,

  available() {
    return true; // keyless endpoint
  },

  async search(request, signal, options, hooks = {}) {
    const args = {
      query: request.query,
      numResults: Math.max(1, Math.min(Number(request.maxResults) || 10, 100)),
    };
    hooks.recordRequest?.({
      endpoint: EXA_ENDPOINT,
      toolName: EXA_TOOL,
      body: args,
      headers: {},
    });

    let result;
    try {
      // The public Exa MCP endpoint is stateless; the official provider sends
      // a single tools/call with no initialize round-trip.
      result = await mcpCall(EXA_ENDPOINT, EXA_TOOL, args, {}, signal, { skipInitialize: true });
    } catch (err) {
      if (err instanceof WebError) throw err;
      throw new WebError(
        `exa search failed: ${describeError(err)}`,
        "WEB_PROVIDER_ERROR",
        { cause: err },
      );
    }

    if (result?.isError === true) {
      const message = String(result.content?.[0]?.text ?? "unknown");
      hooks.recordOutcome?.({ status: "error", message });
      throw new WebError(`exa returned an MCP error: ${message}`, "WEB_PROVIDER_ERROR");
    }

    const sources = parseExaResult(result, Math.max(1, Math.min(Number(request.maxResults) || 10, 100)));
    hooks.recordOutcome?.({ status: "ok", count: sources.length });

    return { sources, content: undefined, truncated: false };
  },
};

export function parseExaResult(result, maxResults) {
  const text = result?.content?.[0]?.text;
  if (typeof text !== "string" || text.length === 0) return [];
  const blocks = text.split("\n\n---\n\n");
  const sources = [];
  for (const block of blocks) {
    const url = matchField(block, /^URL:\s*(.+)$/m);
    if (!url) continue;
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
  if (!m) return undefined;
  const tail = block.slice(m.index + m[0].length);
  const bullets = [...tail.matchAll(/^\s+-\s+(.+)$/gm)].map((b) => b[1].trim());
  if (bullets.length === 0) return undefined;
  // Bound what reaches the model: highlights are excerpts, not full text.
  return bullets.join(" … ").slice(0, 400);
}

export default exaBackend;
