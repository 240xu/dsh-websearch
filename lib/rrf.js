// rrf.js — v2.8.0 Reciprocal Rank Fusion (pure functions, zero deps).
//
// RRF merges multiple ranked result lists into one: each list contributes
// score 1/(k + rank) to every item it contains (k=60 is the canonical value
// from Cormack et al. 2009, popularized by RAG-Fusion
// https://github.com/Raudaschl/rag-fusion). Items are deduped by URL; the
// first-seen entry wins for metadata, scores accumulate across lists.
//
// Why RRF over naive concatenation: it needs no score calibration across
// backends/queries (only ranks), and demotes one-off hits while promoting
// items that appear in several lists.

/** Canonical RRF constant. */
export const RRF_K = 60;

/** Stable key for dedupe (URL string; missing/odd URLs fall back to title). */
function itemKey(item) {
  if (item && typeof item.url === "string" && item.url.length > 0) return item.url;
  if (item && typeof item.title === "string") return `t:${item.title}`;
  return "";
}

/**
 * Fuse ranked lists of search sources with Reciprocal Rank Fusion.
 *
 * @param {Array<Array<object>>} lists  each list is already ranked best-first
 * @param {{k?: number, weights?: number[]}} [opts]  k constant (default 60);
 *   optional per-list weights (the original query can outweigh derived variants)
 * @returns {{ fused: object[], scores: Map<string, number> }}
 *   fused: sources sorted by accumulated RRF score desc (ties keep first
 *   appearance order); sources without a usable key are dropped.
 */
export function rrfFuse(lists, { k = RRF_K, weights } = {}) {
  const kk = Number(k) > 0 ? Number(k) : RRF_K;
  const scores = new Map(); // key -> accumulated score
  const firstSeen = new Map(); // key -> source object (first metadata wins)
  const order = []; // keys in first-appearance order (stable ties)

  const allLists = Array.isArray(lists) ? lists : [];
  for (let index = 0; index < allLists.length; index++) {
    const list = allLists[index];
    if (!Array.isArray(list)) continue;
    const weight = Number(weights?.[index]);
    const w = Number.isFinite(weight) && weight > 0 ? weight : 1;
    for (let rank = 0; rank < list.length; rank++) {
      const item = list[rank];
      const key = itemKey(item);
      if (!key) continue;
      scores.set(key, (scores.get(key) ?? 0) + w / (kk + rank));
      if (!firstSeen.has(key)) {
        firstSeen.set(key, item);
        order.push(key);
      }
    }
  }

  const fused = [...order]
    .sort((a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0))
    .map((key) => firstSeen.get(key));
  return { fused, scores };
}
