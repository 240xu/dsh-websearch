// multiquery.js — v2.8.0 query-variant derivation (pure functions, zero deps).
//
// Gated multi-query: arXiv:2404.01037 (Wang et al.) shows BLIND multi-query
// can degrade retrieval — so variants are only derived for queries that look
// genuinely multi-faceted, and the original query always participates in the
// fusion with full weight. Splitting is purely mechanical (at separator
// words/punctuation); entity text is never rewritten.
//
// Separators per the v2.8 spec: "vs", "and", 比较, 对比, 和 — plus sentence
// punctuation for the long-query case.

const SEPARATOR_SPLIT_RE = /\s+(?:vs\.?|and)\s+|\s*(?:比较|对比|和)\s*|\s*[、；;。！？!?|]+\s*/i;
const COMPLEX_MARK_RE = /(?:\bvs\.?\b|\band\b|比较|对比|和)/i;

/** Sub-query hard cap (original + 2 variants max). */
export const MAX_SUB_QUERIES = 3;

/**
 * Heuristic gate: does this query look multi-faceted enough to justify
 * multi-query fan-out? Long queries (>60 chars) or queries containing a
 * separator word qualify. Returns false for anything else — blind
 * multi-query degrades (arXiv:2404.01037), so the default is NO.
 */
export function isComplexQuery(query) {
  if (typeof query !== "string") return false;
  const q = query.trim();
  if (q.length === 0) return false;
  if (q.length > 60) return true;
  return COMPLEX_MARK_RE.test(q);
}

/**
 * Derive 2-3 sub-query variants from a complex query: the original query
 * (always first, full weight in fusion) plus up to two mechanical splits at
 * separator boundaries. Never rewrites entity text; returns [query] when no
 * usable split exists.
 */
export function deriveSubQueries(query) {
  const base = typeof query === "string" ? query.trim() : "";
  if (base.length === 0) return [];
  const parts = base
    .split(SEPARATOR_SPLIT_RE)
    .map((p) => p.trim())
    .filter((p) => p.length >= 2);
  if (parts.length < 2) return [base];
  const variants = [base, parts[0], parts.slice(1).join(" ")];
  return [...new Set(variants.map((v) => v.trim()).filter(Boolean))].slice(0, MAX_SUB_QUERIES);
}
