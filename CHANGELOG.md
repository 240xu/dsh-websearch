# Changelog

## 2.7.3 - 2026-09-29

Compatibility fixes from the six-package compat audit:

- Fixed (P0): the client settings card no longer hard-crashes on DSH 0.1.7 —
  settingsScope access is feature-detected (0.1.5 unchanged; 0.1.7 degrades to
  a console.warn breadcrumb with the shim/config guidance).
- Changed (P1): the server-side settings section no longer silently no-ops on
  the 0.1.7 SettingsForms line — one-time console.warn; search itself is
  unaffected via cordis config.
- Added: engines "node": ">=20.3" (AbortSignal.any).
- Changed: package description slimmed; version history lives in CHANGELOG.md.

## 2.7.2 - 2026-09-27

- Settings: the six v2.7 fields carry user-language labels at the schema layer
  (meta.label + top-level .label, units in the tail — e.g. "缓存有效期（秒）"),
  and descriptions now open with the human-readable name (fe-ui W1 remainder;
  on-device rendering tracked as visual-check V5).

## 2.7.1 - 2026-09-26

Review fixes (arch-review P1-1 + P2×3, fe-ui W1):

- Fixed: cache key now includes the enabledBackends selection set — switching
  the backend mix no longer serves a stale result from the old combination.
- Hardened: the cache-hit path re-applies the URL scheme whitelist (a tampered
  cache file cannot smuggle javascript:/data: sources to the model).
- Fixed: history record() serializes through an in-process promise chain (no
  lost updates on concurrent search completions); /api/websearch/* routes sit
  behind a trust fence (loopback Host + same-site browser context).
- Changed: breakerCooldownMs=0 now explicitly disables the cooldown window
  (it previously fell back to 60s); user-language settings labels with
  cache/breaker/history grouping; window event dsh-websearch:open-settings
  (ready flag + ack) for devkit command interop.

## 2.7.0 - 2026-09-25

Three opt-out-by-default features; the v2.6.0 prompting layer is untouched.

### Added
- Disk result cache (lib/cache.js): keyed on shaped query + filters +
  maxResults + enabled backends; TTL 900s, 200-entry cap with oldest-by-mtime
  eviction; atomic tmp+rename writes under $DSH_HOME/cache/websearch/results/;
  hits skip the fan-out entirely and append a "[websearch cache] cache hit,
  age Ns" note. Settings: cacheEnabled / cacheTtl.
- Backend circuit breaker (lib/breaker.js): 3 consecutive failures cool a
  backend for 60s (telemetry: "id ⏸cooled Ns"); state folds into the shared
  health entry (failCount/cooledUntil); fail-open when every candidate is
  cooled — the breaker can only make search faster, never worse.
  Settings: breakerEnabled / breakerThreshold / breakerCooldownMs.
- Search history API (lib/history.js): append-only ring of 50
  {query, time, resultCount, backendsOk, backendsTotal} in history.json;
  GET /api/websearch/history (read-only) + POST /api/websearch/history/clear.
  Settings: historyEnabled.

## 2.6.0 - 2026-09-24

Systematic search prompting (lib/prompting.js), per Tavily/Exa/Anthropic/OpenAI
official guidance:

- Deterministic query shaping before fan-out: conversational filler stripped
  (EN+ZH), whitespace compressed, 1500-char clamp; entities/versions/dates
  never rewritten.
- Result-presentation header at the top of the model-visible content: cite the
  URL for every fact, prefer official/primary and newer sources, ignore
  off-topic snippets; language auto-selected (zh/en).
- Telemetry line self-labeled "(diagnostic only, not a source)" so models do
  not mistake backend health telemetry for result sources.

## 2.5.0 - 2026-09-20

- Read-only GET /api/unified-search/health: enabled/keyless/reachable per
  backend from the last real search's telemetry — never probes anything
  (quota safety), error strings truncated + token-redacted.
- Module-level per-search backend telemetry capture powering the health route.

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

