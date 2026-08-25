# Changelog

## 2.1.0 - 2026-08-25

### Added

- Cross-backend result shaping: settings-level recency / language / safeSearch
  filters mapped per-backend (Brave freshness/country/search_lang, Tavily
  time_range, Serper tbs/hl/gl, SearXNG time_range/language, DDG df);
  unsupported backends ignore unsupported dimensions. Request-level filters
  override settings defaults.
- dedupStrategy url | url+title - the new mode collapses syndicated mirrors by
  CJK-aware title similarity (Jaccard >= 0.9) with cross-entry field fill-in.
- Optional deterministic rerank (query-term overlap; title x3 / snippet x2 /
  URL x1; stable ties keep fan-out priority).
- Settings panel "结果策略 / Result shaping" section (recency, language, dedup
  strategy, rerank, safe search) with client-side validation; zh/en labels.
- tests/filters.test.js, tests/rank.test.js, tests/v21.test.js (30 new cases;
  64 total).

### Fixed

- exa.js recorded MCP isError results as successful outcomes before parsing;
  outcome events now reflect the real status/count.
- provider.js timeout machinery replaced: the old Promise.race left a dangling
  rejection path (unhandled-rejection crash risk) and misclassified internal
  timeouts as soft cancellations. Timeouts now fail loud as
  backend "<id>" timed out after Nms (WEB_PROVIDER_ERROR); caller cancellation
  semantics unchanged.
- mojeek.js no longer sends api_key in the query string (leaks into logs and
  history); auth moved to the Authorization bearer header.
- searxng.js language is configurable instead of hardcoded en; safe search is
  configurable (default ON, preserving prior behavior).
- resolveOptions scopes searchDepth to the Tavily backend options only.

## 2.0.6 - 2026-08-25

- Panel: group backend toggles into keyless/keyed sections.

## 2.0.5 - 2026-08-23

- npm publish pipeline established (@240xu/dsh-websearch).

## 2.0.0 - 2026-08-22

- Five new backends (Brave, Tavily, Serper, SearXNG, Mojeek) on the unified
  fan-out architecture; GUI metadata config schema.
