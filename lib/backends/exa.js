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

const EXA_ENDPOINT = "https://mcp.exa.ai/mcp";
const EXA_TOOL = "web_search_exa";

/**
 * Infer an Exa data category from the query (v2.8.0). Only high-confidence
 * patterns map — Exa rejects unknown categories with a 400, so this returns
 * undefined unless a signal is explicit. Valid values per the Exa OpenAPI
 * enum: github / "research paper" / news / pdf / company / people /
 * "personal site" / "financial report".
 */
export function inferExaCategory(query) {
  const q = typeof query === "string" ? query.toLowerCase() : "";
  if (!q) return undefined;
  if (/\bgithub\b|\brepo\b|repository|开源项目|源码/.test(q)) return "github";
  if (/\barxiv\b|\bpaper\b|论文|研究文献|preprint/.test(q)) return "research paper";
  if (/\bnews\b|新闻|最新消息|动态/.test(q)) return "news";
  return undefined;
}

export const exaBackend = {
  id: "exa",
  requiresCredential: false,

  available() {
    return true; // keyless endpoint
  },

  async search(request, signal, options, hooks = {}) {
    const args = {
      query: request.query,
      numResults: request.maxResults ?? 8,
    };
    // v2.8.0: category inference (feature-detect — only sent when confident;
    // if the endpoint rejects it the fan-out demotes softly).
    const category = inferExaCategory(request.query);
    if (category) args.category = category;
    hooks.recordRequest?.({
      endpoint: EXA_ENDPOINT,
      toolName: EXA_TOOL,
      body: args,
      headers: {},
    });

    let result;
    try {
      result = await mcpCall(EXA_ENDPOINT, EXA_TOOL, args, {}, signal);
    } catch (err) {
      if (err instanceof WebError) throw err;
      throw new WebError(
        `exa search failed: ${String(err?.message ?? err)}`,
        "WEB_PROVIDER_ERROR",
        { cause: err },
      );
    }

    if (result?.isError === true) {
      const message = String(result.content?.[0]?.text ?? "unknown");
      hooks.recordOutcome?.({ status: "error", message });
      throw new WebError(`exa returned an MCP error: ${message}`, "WEB_PROVIDER_ERROR");
    }

    const sources = parseExaResult(result, request.maxResults ?? 8);
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
  return bullets.join(" … ");
}

export default exaBackend;
