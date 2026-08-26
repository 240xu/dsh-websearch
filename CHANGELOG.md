# Changelog

## 2.4.0 - 2026-08-25

Multi-judge review round: 5 independent reviewers; findings cross-validated before fixing.

### Fixed
- Panel: SearXNG no longer misgrouped as key-requiring (optionalKey flag); the false
  missing-key warning is gone; optional private-instance keys moved to their own section.
- rank.js rerank URL-tokenizer stripped uppercase before lowercasing, so URL match
  weight silently failed on capitalized URLs.
- provider: numResults now propagates into every backend fetch (it previously only
  applied to the final slice).
- provider: allKeyMissing guidance also fires for WEB_PROVIDER_CREDENTIAL_MISSING
  (deepseek/anthropic/openai paths).
- parallel.js outcome recorded after the isError check (mirrors the exa fix).
- ~400 lines of dead code removed (util/rpc.js legacy MCP client + duplicate
  backends/index.js registry).

### Hardened (security judge findings)
- baseURL trust-boundary guard: https enforced (plain http only for private hosts),
  credentials-in-URL rejected - API keys can no longer follow a misconfigured endpoint.
- Server-controlled error bodies truncated to 300 chars before entering errors/logs;
  host-log outcome payloads capped at 500 chars.
- Result URLs scheme-whitelisted to http(s) at merge time (javascript:/data: from
  poisoned backends never reach consumers); DDG uddg decoding covered transitively.
- redirect:error on all REST backends (previously inconsistent).
- mcp-client: SSE multi-data-line envelopes parsed; notification response drained;
  parallel session id no longer leaks pid (crypto.randomUUID).

### UX
- Read-only scope banner with disabled save; toggle writes surface conflict/failure
  instead of silent rejection; validation failures name the offending fields; an all-off
  state shows the fallback hint; telemetry line includes truncated failure reason.
- README: stale session.append design text replaced with the host-logger reality;
  availability semantics corrected; test command generalized.
## 2.3.0 - 2026-08-25

### Added

- Result health telemetry (default on): every search appends a compact
  [websearch backends] line (per-backend status + duration) to result.content so
  the agent can self-diagnose and guide the user; resultTelemetry=false opts out.
- SearXNG network failures hint at switching searxngBaseURL; README documents a
  curated public-instance table.
- Settings panel: telemetry toggle in the shaping section.


## 2.2.0 - 2026-08-25

### Fixed (P0)

- Session-log landmine removed: per-backend request/outcome diagnostics no
  longer append custom event types to the session ledger. The session event
  vocabulary is a closed generated set and session.append() cannot mark an
  envelope ignorable, so ANY session that ran a search was refused by the
  persistence read path on next load (writes succeeded, reads failed).
  Diagnostics now go to the host logger (ctx.logger), which is what
  out-of-repo plugins must use.

### Changed (UX)

- All-backends-failed errors now enumerate each backend's own reason and,
  when every enabled backend lacks its key, point at Settings > Web Search.
- Settings card: API-key inputs detect env-shadowed references via
  credentials.describe().writable - they render read-only with an
  "provided by env" badge instead of failing a doomed write.
- Per-key save failures are isolated and named instead of failing the whole
  card silently; SETTINGS_CONFLICT writes surface a retry banner.

### Tests

- Failure-enumeration, key-missing-guidance and ddg end-to-end regression
  coverage (68 total).

## 2.1.1 - 2026-08-25

### Fixed

- ddg.js crashed on EVERY real search (throwIfSearchAborted is not defined):
  the v2.0 abort-guard refactor added the call but never the import, and no
  test executed the backend end-to-end so it slipped through. Two regression
  tests now run ddgBackend.search against mocked HTML.

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

