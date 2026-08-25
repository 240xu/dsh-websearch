// ddg.js — DuckDuckGo HTML backend (keyless, no API key required)
// Endpoint: https://html.duckduckgo.com/html/  (POST form-encoded q=...)
// Returns a simple HTML results page. We extract .result__a (anchor with
// href through duckduckgo.com/l/?uddg=<encoded-url> redirect), .result__title
// text, and .result__snippet text. This is a fallback tier: Exa/Parallel
// are richer, DDG is the zero-dependency safety-net.

import { searchAborted, isAbortError, throwIfSearchAborted } from "../util/abort.js";
import { applyDdgFilters, normalizeFilters } from "../util/filters.js";
import { WebError } from "@deepseek-ai/dsh-web";

export const DDG_ENDPOINT = "https://html.duckduckgo.com/html/";

export const ddgBackend = {
  id: "ddg",
  requiresCredential: false,

  available() {
    return true; // keyless
  },

  /**
   * @param {WebSearchRequest} request
   * @param {AbortSignal} signal
   * @param {{ recordRequest?: Function, recordOutcome?: Function }} [hooks]
   * @returns {Promise<WebSearchResult>}
   */
  async search(request, signal, options, hooks = {}) {
    throwIfSearchAborted(signal);
    const params = new URLSearchParams({ q: request.query, b: Math.random().toString().slice(2) });
    applyDdgFilters(params, normalizeFilters(request.filters));
    const body = params.toString();
    hooks.recordRequest?.({ endpoint: DDG_ENDPOINT, toolName: "html", body: { q: request.query }, headers: {} });

    let text;
    try {
      const res = await fetch(DDG_ENDPOINT, {
        method: "POST",
        redirect: "error",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "text/html",
          "User-Agent": "dsh-websearch/2.1",
        },
        body,
        ...(signal !== undefined ? { signal } : {}),
      });
      if (!res.ok) {
        let detail = "";
        try { detail = (await res.text()).slice(0, 200); } catch {}
        throw new WebError(`ddg HTTP ${res.status}${detail ? ": " + detail : ""}`, "WEB_PROVIDER_ERROR");
      }
      text = await res.text();
    } catch (err) {
      if (signal?.aborted === true || isAbortError(err)) throw searchAborted(signal, err);
      hooks.recordOutcome?.({ status: "error", message: String(err?.message ?? err) });
      throw new WebError(
        `ddg search failed: ${String(err?.message ?? err)}`,
        "WEB_PROVIDER_ERROR",
        { cause: err },
      );
    }

    hooks.recordOutcome?.({ status: "ok" });

    const sources = parseDdgHtml(text, request.maxResults ?? 8);
    return { sources, content: undefined, truncated: false };
  },
};

/**
 * Minimal regex-based DDG HTML parser. Extracts result blocks:
 *   <a class="result__a" href="...uddg=<encoded>...">Title Text</a>
 *   <a class="result__snippet" ...>Snippet text</a>
 * The real URL is the uddg= query param (DDG wraps results in a redirect).
 *
 * Resilient to class-attribute ordering / whitespace variations.
 *
 * @param {string} html
 * @param {number} maxResults
 * @returns {Array<{url:string,title?:string,snippet?:string}>}
 */
export function parseDdgHtml(html, maxResults) {
  if (!html) return [];
  // Result anchors: <a ... class="result__a" ... href="<url>">Title</a>
  const anchorRe = /<a\b[^>]*\bclass="[^"]*result__a[^"]*"[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const sources = [];
  let m;
  while ((m = anchorRe.exec(html)) !== null) {
    const rawHref = m[1];
    const url = decodeDdgUddg(rawHref);
    if (!url) continue;

    // Title text: strip nested tags inside the anchor.
    const title = stripTags(m[2]).trim();

    // Snippet: search forward from this anchor for the nearest result__snippet.
    const after = html.slice(m.index + m[0].length);
    const snipRe = /<a\b[^>]*\bclass="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i;
    const snipM = snipRe.exec(after);
    const snippet = snipM ? stripTags(snipM[1]).trim() : undefined;

    const source = { url };
    if (title) source.title = title;
    if (snippet && snippet.length > 0) source.snippet = snippet;
    sources.push(source);
    if (sources.length >= maxResults) break;
  }
  return sources;
}

/**
 * Decode DDG's uddg= redirect param to the real target URL.
 * Links look like //duckduckgo.com/l/?uddg=<encoded>&rut=...  — we want <decoded>.
 */
function decodeDdgUddg(href) {
  try {
    // Strip optional protocol-relative prefix.
    const u = href.replace(/^\/\//, "https://");
    const idx = u.indexOf("uddg=");
    if (idx === -1) {
      // If there's no uddg param but it's a clean http(s) URL, use as-is.
      return /^https?:\/\//.test(u) ? u : null;
    }
    const tail = u.slice(idx + 5);
    const amp = tail.indexOf("&");
    const enc = amp === -1 ? tail : tail.slice(0, amp);
    return decodeURIComponent(enc);
  } catch {
    return null;
  }
}

/** Strip all HTML tags from a fragment, collapse whitespace. */
function stripTags(s) {
  return String(s).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export default ddgBackend;
