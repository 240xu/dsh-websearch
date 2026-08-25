/**
 * @module dsh-websearch/util/rank
 *
 * Pure result-set post-processing for the unified provider:
 *   - dedupeSources(sources, strategy) : cross-backend dedup with field fill-in
 *   - rerankSources(sources, query)    : deterministic query-relevance ordering
 *
 * Both are pure, dependency-free and unit-tested in tests/rank.test.js.
 * Determinism matters: identical inputs must always produce identical output
 * so cached/replayed searches stay stable.
 */

/** Lowercase + tokenize into a Set. ASCII words (len>=2) plus CJK chars singly,
 * so Chinese/Japanese titles still produce meaningful overlap signals. */
export function tokenize(text) {
  const tokens = new Set();
  if (typeof text !== "string" || text.length === 0) return tokens;
  const lower = text.toLowerCase();
  // ASCII word runs of length >= 2 ...
  for (const w of lower.match(/[a-z0-9]{2,}/g) ?? []) tokens.add(w);
  // ... plus individual CJK chars (U+3400-U+9FFF common range covers CJK).
  for (const ch of lower.match(/[\u3400-\u9fff]/g) ?? []) tokens.add(ch);
  return tokens;
}

/** Jaccard similarity of two token sets: |A∩B| / |A∪B| ∈ [0,1]. */
export function tokenSimilarity(a, b) {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Titles this similar (Jaccard >= threshold) count as the same story when
 * strategy is "url+title" (aggregator mirrors / syndicated copies). */
const TITLE_DUP_THRESHOLD = 0.9;

/**
 * Dedupe an ordered source list.
 *
 * strategy "url"       — key on lowercased URL; later duplicates fill in any
 *                        missing title/snippet/publishedAt fields (existing
 *                        behavior, preserved verbatim).
 * strategy "url+title" — additionally drop later entries whose TITLE overlaps
 *                        an already-kept entry's title at >=0.9 Jaccard (both
 *                        titles non-empty). Different URLs reporting the same
 *                        story collapse to the higher-priority backend's hit.
 *
 * The input array is not mutated; returns a fresh array.
 */
export function dedupeSources(sources, strategy) {
  const out = [];
  const byUrl = new Map(); // urlKey -> kept source
  const keptTitles = [];   // [{ tokens }] only when strategy is url+title

  for (const s of sources ?? []) {
    if (!s || typeof s.url !== "string" || s.url.length === 0) continue;
    const key = s.url.toLowerCase();
    const existing = byUrl.get(key);
    if (existing) {
      if (!existing.title && s.title) existing.title = s.title;
      if (!existing.snippet && s.snippet) existing.snippet = s.snippet;
      if (!existing.publishedAt && s.publishedAt) existing.publishedAt = s.publishedAt;
      continue;
    }

    if (strategy === "url+title" && typeof s.title === "string" && s.title.length > 0) {
      const tokens = tokenize(s.title);
      const dupOf = keptTitles.find((k) => tokenSimilarity(k.tokens, tokens) >= TITLE_DUP_THRESHOLD);
      if (dupOf) {
        // Same story from another outlet: enrich the kept entry with any
        // fields the mirror carries and the original lacks.
        if (!dupOf.source.title && s.title) dupOf.source.title = s.title;
        if (!dupOf.source.snippet && s.snippet) dupOf.source.snippet = s.snippet;
        if (!dupOf.source.publishedAt && s.publishedAt) dupOf.source.publishedAt = s.publishedAt;
        continue;
      }
    }

    const copy = { ...s };
    byUrl.set(key, copy);
    out.push(copy);
    if (strategy === "url+title" && typeof s.title === "string" && s.title.length > 0) {
      // backfill this kept entry into its title bucket for later comparisons
      keptTitles.push({ tokens: tokenize(s.title), source: copy });
    }
  }
  return out;
}

/**
 * Score one source against the query tokens:
 *   title match ×3, snippet match ×2, URL match ×1.
 */
function scoreSource(source, queryTokens) {
  let score = 0;
  const titleTokens = tokenize(source.title ?? "");
  const snippetTokens = tokenize(source.snippet ?? "");
  const urlTokens = tokenize(String(source.url ?? "").replace(/[^a-z0-9]+/g, " "));
  for (const q of queryTokens) {
    if (titleTokens.has(q)) score += 3;
    if (snippetTokens.has(q)) score += 2;
    if (urlTokens.has(q)) score += 1;
  }
  return score;
}

/**
 * Deterministic relevance rerank. Stable sort by descending score; equal
 * scores keep their original relative order (fan-out priority wins ties).
 * Returns a fresh array; input untouched.
 */
export function rerankSources(sources, query) {
  const queryTokens = tokenize(query);
  if (queryTokens.size === 0 || !Array.isArray(sources)) return [...(sources ?? [])];
  return sources
    .map((s, index) => ({ s, index, score: scoreSource(s, queryTokens) }))
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .map((e) => e.s);
}
