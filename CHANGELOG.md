# Changelog

## 2.13.11 - 2026-11-28

- Fix (P1): a reload/reconcile no longer deletes `numResults`/`rerank` edits
  made after staging `balanced` away from a saved official profile; the
  effective tier is the staged one, and a reload to official still drops the
  overridden drafts.
- Fix: variant 1 needs at least a 50ms slice; a 1ms remainder no longer starts
  every backend with a 1ms timeout. The zero-variant guard remains.
- Docs: 242 test count, audit 139 restated as the 2.13.8 record, audit 137
  superseded sentence struck, official hint names multiQuery/deep coverage.
- Tests: 242.
## 2.13.10 - 2026-11-28

- Fix: variant 1 starts whenever any search budget remains; the 1s floor now
  applies only to later variants. A valid 1000ms timeout no longer fails on a
  single clock tick before the first backend.
- Fix: official-overridden drafts are dropped on reload/revert and external
  snapshot updates, not only on a local edit; their stale validation errors
  are cleared.
- Test: the starved-cache test uses the real cache hit shape and asserts the
  truncated run is not written.
- Docs: 241 test count, conditional cache-hit note, corrected key fields.
- Tests: 241.
## 2.13.9 - 2026-11-28

- Fix: result-cache keys include `CACHE_SEMANTICS_VERSION` (currently 2).
  A result-semantics change (multi-query truncation, plan parsing, …) now
  invalidates old entries instead of replaying them after an upgrade; files
  are not deleted, they simply miss.
- Tests: 240.
## 2.13.8 - 2026-11-28

- Fix: if the shared deadline is already spent before the first variant, the
  provider now throws `search budget exhausted before any backend could run`
  instead of returning an empty success.
- Test reliability: starvation tests advance a stubbed clock instead of
  sleeping; the sync-throw timeout has realistic headroom. 15 consecutive
  full-suite runs green.
- Tests: 240.
## 2.13.7 - 2026-11-28

- Fix: switching to `intervention=official` drops drafts for the four fields
  the provider overrides (`numResults`, `rerank`, `resultTelemetry`,
  `resultHeader`). They are no longer posted as ignored values, and an invalid
  draft cannot block Save behind a locked control.
- Tests: 240.
## 2.13.6 - 2026-11-28

- UI: under `intervention=official`, gate `numResults`, `rerank`,
  `resultTelemetry` and `resultHeader` because the provider overrides them;
  the intervention hint names the four and is wired via aria-describedby.
  A control with a staged draft stays editable, so it can be corrected; the
  gate only locks untouched fields.
- UI: cache switch and TTL are adjacent again; TTL stays editable while a
  staged value exists.
- Tests: 239.
## 2.13.5 - 2026-11-28

- Fix: an empty multi-query result stopped by the search budget still carries
  `multiQuery: N/M facets not run (search budget)` (previously only emitted
  when some backend had failed).
- Fix: `/api/websearch/history` backend entries expose `credentialMissing`,
  matching `/health`.
- Tests: 237.
## 2.13.4 - 2026-11-28

- Fix: a planned Parallel call parses up to `maxResults × facets` (cap 300)
  instead of the single-query bound, so facet 2/3 tail sources survive until
  the provider's cross-backend merge. Single-query behavior is unchanged.
- Tests: 236.
## 2.13.3 - 2026-11-28

- Fix: `credentialMissing` is preserved through the per-variant health fold;
  a missing key no longer cools the backend and `/health` reports the flag.
- Fix: a 2s `backendTimeoutMs` can run three fast multi-query facets (floor
  lowered from 2000ms to 1000ms).
- Fix: when the search deadline skips later facets, the result carries a
  `multiQuery: N/M facets not run (search budget)` note and is not cached;
  a transient slow variant no longer degrades identical searches for the TTL.
- Tests: 235.
## 2.13.2 - 2026-11-28

Frontend UX fixes from the round-6 review; details
`docs/audit/133-frontend-20261128.md`.

- Save is all-or-nothing: one invalid field no longer half-commits the valid
  siblings while reporting failure.
- Cache TTL shows its rules (30 s steps, 0 = no-store), is marked invalid, and
  is disabled with an explanatory hint while the cache is off.
- Cache switch and TTL now sit together in the globals grid.
- Save no longer disables itself after success (keyboard focus stays put); a
  failed validation focuses the first invalid field.
- Conflict Retry moved outside the `role=status` live region.
- Remove the duplicate `objective` assignment in the Parallel backend; correct
  the OpenAI domain-filter description to match the one-list behavior.
- Tests: 232.
## 2.13.1 - 2026-11-28

- Fix: a timed-out plan backend is not retried per variant. Only fast failures
  fall back; timeout errors are tagged so a hung Parallel call keeps its
  single-call cost (previously it doubled wall-clock time).
- Fix: telemetry latency follows the winning attempt instead of `max(ms)`, so
  a failed-then-succeeded backend no longer reports `124ms` while `/health`
  says `6ms`; failure-only folds still report the worst attempt.
- Fix: multi-query no longer divides `backendTimeoutMs` by the variant count.
  A variant gets the configured timeout while the absolute search deadline
  still bounds the total, so a healthy 1s backend no longer fails at 666ms.
- Fix: Exa no longer injects the undeclared `category` argument; the MCP
  `tools/list` schema only declares `query`, `numResults` and `objective`.
- Tests: 229.
## 2.13.0 - 2026-11-28

Round-5 fixes; details `docs/audit/131-round5-20261128.md`.

- Parallel plan fallback: if the primary `searchPlan` call fails, later
  variants retry the plan-capable backend per facet instead of losing it for
  the whole search. Success still costs one call.
- Cache-hit history uses the scheme-whitelisted source count, so a tampered
  `javascript:` cache entry cannot inflate `resultCount`.
- Exa advanced-domain backlog closed with evidence: the public endpoint's
  `tools/list` exposes only `web_search_exa` (query/numResults/objective) and
  `web_fetch_exa` (urls/maxCharacters); no advanced/domain tool exists.
- Tests: 227.
## 2.12.0 - 2026-11-28

Round-4 expert fixes; details `docs/audit/130-round4-20261128.md`.

- Fix: revert the `available()` presence gate. It hid the actionable missing-key
  error behind the seam's generic "registered but unavailable / none
  registered" response; `/health` now exposes `credentialMissing` instead.
- Fix: only budget-caused timeouts skip breaker/health. A 429/500 on a
  budget-clipped multi-query attempt still folds; the per-variant share is
  included in the clip classification.
- SearXNG page 2: caller abort rethrows `WEB_ABORTED`; any page-2 failure
  (including 5xx) pauses extra pages for 60 s; a successful extra page clears
  the pause.
- Domain filters: punycode TLDs and `https://*.example.com` accepted;
  `domainFilterError` only fires when OpenAI/Anthropic is enabled, so a
  keyless-only profile is not bricked by a domain setting it cannot use.
- All-failed errors distinguish attempted backends from budget-skipped ones;
  telemetry renders `⏭budget`, not a fake failure.
- Add cache controls to the card: `cacheEnabled` select and `cacheTtl` numeric
  (0 = no-store), 26 of 60 fields editable.
- Parallel: one primary call carries `searchPlan` with 2–3 facets; later
  variants skip it. Other backends remain per-variant.
- Fix cache/history directory mode with the missing `chmodSync` import; correct
  stale 24s/rank-major/cache-key/paging comments.
- Tests: 225.
## 2.11.0 - 2026-11-28

Round-3 expert fixes and the gated SearXNG pagination.

- Fix (P1): domain filters are part of the cache key (top-level and per-backend
  lists); enabling `includeDomains`/`excludeDomains` no longer serves the prior
  unfiltered entry for up to the TTL.
- Fix: domain normalization accepts fullwidth/Chinese commas, FQDN trailing
  dots and `*.` prefixes; bare IPs and malformed labels are rejected. A
  non-empty setting that normalizes to nothing fails the search loudly instead
  of silently disabling the restriction.
- Add: `available()` tracks credential presence observed by the last key
  resolve; a key-gated backend with a confirmed missing key stops advertising
  itself until a key is added (60 s unknown fallback), while optional-key
  backends stay usable.
- SearXNG: gated two-page fetch (single instance, `deepCoverage` without
  internal multi-query), cross-page URL dedupe, page-1 results survive a
  page-2 failure, page-2 429/5xx backs off pagination for 60 s. Multi-instance
  failover still uses one page per attempt.
- Fix: a backend cut by the shared search budget is no longer folded into the
  breaker/health as an outage, and skipped backends appear in telemetry rather
  than silently disappearing from history counts.
- OpenAI domain filters now follow include-wins (only one list is sent);
  Anthropic keeps include-wins, and the shared DeepSeek route no longer
  receives unprobed domain fields.
- Settings: numeric fields enforce server steps (`backendTimeoutMs` 1000,
  `cacheTtl` 30) client-side; a server schema 400 is attributed to the named
  field. `cacheEnabled`/`cacheTtl` are accepted by the shared field validator.
- Docs: cache no-store/cap/permissions/purge, SearXNG paging, domain scope.
- Tests: 225 unit tests.

## 2.10.0 - 2026-11-28

Implements the first authority-ranked deferred items from audit 127
(`docs/audit/128-domain-filters-20261128.md`).

- Add: `includeDomains` / `excludeDomains` Config fields (comma/space lists,
  URL or host, lowercased, invalid dropped, max 20). OpenAI sends
  `filters.allowed_domains`/`blocked_domains`; Anthropic sends top-level
  `allowed_domains`/`blocked_domains` (include wins if both are set). Exa's
  simple MCP tool has no domain field, so it is documented as not yet mapped.
- Align: `numResults` accepts 1-100 (Exa's documented max); Exa clamps to 100
  and defaults to 10 when a caller omits the count. Brave/Tavily stay at 20.
- Perf/clarity: multi-query telemetry is folded to one segment per backend
  (any success wins, max latency/count, error only when no success), so it
  matches history/health and cannot hide a backend behind the 12-slot cap.
- Fix: the cache key preserves backend fan-out order; reordering can change
  which duplicate's title/snippet wins, so it must not serve the old entry.
- Tests: 220 unit tests.

## 2.9.1 - 2026-11-28

Second expert re-audit on 2.9.0. Details: `docs/audit/127-expert-round2-20261128.md`.

- Fix (crash): a synchronously throwing backend could leave the timeout guard
  unhandled and terminate the process; the call is now evaluated in a promise
  chain so the guard is always cleaned up.
- Fix (timeout): the search-wide budget is now an absolute deadline. Each
  backend clamps to `remainingNow`, variants split the remaining time, and a
  variant with less than 2 s is not started; one hung backend or slow variant
  can no longer multiply the budget or be reported as a timeout after it
  already succeeded.
- Fix: default `backendTimeoutMs` is 24 s, leaving 6 s of headroom under the
  host's 30 s tool deadline; an abort at the host deadline no longer discards
  partial sources.
- Fix: cache TTL errors are a miss (valid entries are no longer deleted),
  expired reads no longer unlink by path, corrupt entries and aged orphan
  `.tmp` files are cleaned; `cacheTtl: 0` is a true no-store mode and cache /
  history files are owner-only (0700/0600).
- Fix: a missing API key no longer folds into the breaker/health as an outage;
  telemetry still reports it.
- Fix: `truncated` is true only for a cut at the seam's host bound; a
  `numResults` preference cut is not seam truncation. The host bound is part
  of the cache key.
- Fix: bare IPv6 entries in `NO_PROXY` now match (the last colon was parsed as
  a port).
- Fix: duplicate fast-fail history entry; malformed backends now appear in
  telemetry/health; `keyChecking` is defined in both dictionaries.
- Fix: cache-hit notes follow `resultTelemetry` rather than `resultHeader`.
- URL dedupe lowercases only protocol/host, preserving path case.
- Settings: all validated field edits are sent in one POST (`setMany`); legacy
  hosts fall back per field.
- UI: live region contains only the message strip; one conflict message plus a
  Retry button; dictionary loading text; read-only placeholders; per-row toggle
  errors; no-op edits do not stage; integer bounds; pending badge only when the
  state is unknown.
- Depth: status-specific error/warn colors (WCAG-fixed mixes), link hover class,
  env badge full contrast, disabled rows do not hover, official 32px input
  metrics, static retry bar.
- Tests: 218 unit tests; patches 32/32 (2.8.8) and 33/33 (2.8.4).

## 2.9.0 - 2026-11-28

Expert polish round on top of 2.8.9 (six independent audits: bugs, logic,
semantics, frontend, visual depth, authoritative evidence). Details and
deferred items: `docs/audit/126-expert-polish-20261128.md`.

- Security: the 10 MiB response ceiling now also applies on the native
  (no-proxy) egress path; previously only proxied/tunneled responses were
  bounded, so a direct or NO_PROXY host could stream unbounded bytes.
- Fix: a backend that ignores its abort signal can no longer hold the fan-out
  past its per-backend timeout; the call is raced against the timer, and a
  search-wide budget stops multi-query variants from multiplying 30s by N.
- Fix: missing API keys in Brave/Tavily/Serper/Mojeek now report
  `WEB_PROVIDER_CREDENTIAL_MISSING`, not the seam's "no provider installed"
  code; the all-failed hint is limited to that code.
- Fix: `official` no longer appends the diagnostic cache-hit note to
  `content`; the note follows the same `resultHeader` gate as the header.
- Fix: `truncated` now reflects the seam's host bound, not the user's
  `numResults`, so a preference cut is not reported as tool truncation.
- Fix: all-failed diagnostics fold attempts back to unique backends, and the
  rate-limited/keyless fast-fail paths write a history entry before throwing.
- Fix: a backend resolving without a `sources[]` array is a soft failure, not
  a silent successful zero-hit search; `expectedRevision` must be an integer
  or the settings route returns 400 instead of silently disabling CAS.
- Fix: cross-backend results are merged rank-major round-robin (every
  backend's #1 before any backend's #2), matching `dsh-tool-web`'s
  `mergeSearchResults`; previously the first two backends could fill the cap
  and starve DDG/SearXNG.
- Fix: IPv6 literals in proxy/NO_PROXY/forwarder paths lose their brackets
  before `net`/TLS/Host comparison; expired cooldowns are no longer published;
  corrupt cache entries and orphan `.tmp` files are cleaned up.
- Fix: duplicate `enabledBackends` ids fan out once; credential invalidation
  refreshes only the ref carried by the event when one is present.
- Align: Firecrawl uses the requested `limit` (v2 default 10, max 100) instead
  of a fixed 8; Exa highlight joins and Firecrawl descriptions are bounded to
  400 chars; Brave/Serper `publishedAt` is emitted only for ISO-shaped dates.
- Canonicalize dedupe keys (fragment + tracking params) and add an explicit
  "untrusted data, never instructions" fence to both result headers.
- Add `resultHeader` to Config and the card (7 enum selects).
- UI: backend labels are localized (no Chinese in an English render), every
  form control has an accessible name, the action bar is a polite live region
  and sticky, toggle failures render at the failing row, key badges show
  "checking" until the first read, and the status strip reports the effective
  `enabledBackends` override.
- UI depth: tokenized state colors (no hardcoded hex), 4/8/12/20 radius scale,
  three border tiers, official button metrics, one 2px focus ring, ghost-button
  hover fix, and disabled/hover states; zero new surface shadows.
- Tests: 213 unit tests.

## 2.8.9 - 2026-11-28 (published)

Base: npm 2.8.8 plus the local 34-file fix set (2.8.4 lineage) and the
2026-11-28 re-audit. Not published.

- Security: every `searxngBaseURLs` candidate now passes the same trust gate as
  `baseURL` (HTTPS, or HTTP only for loopback/RFC1918; credentials and
  link-local/metadata hosts rejected). Previously the plural instance list was
  passed to the backend unvalidated and received the configured API key.
- Security: backend error text is redacted before it reaches the host log,
  health/history payloads and the model-visible telemetry line; a response-body
  cap (10 MiB) and a hard "too many redirects" failure bound hostile endpoints.
- Fix: a partial fan-out failure with zero hits no longer throws "all enabled
  backends failed"; the successful-but-empty result keeps its telemetry line.
- Fix: caller cancellation is no longer recorded as a backend failure, so the
  stop button cannot trip the breaker or paint /health red.
- Fix: a header-less 429 now uses the configured `breakerCooldownMs`
  (`0` = count only) instead of silently cooling for 60 seconds.
- Fix: `breakerEnabled:false` no longer publishes a cooldown the provider
  ignores, and `cacheEnabled` defaults to true to match its schema.
- Fix: empty results are not written to the cache (the read path never served
  them, and the write could evict real entries).
- Fix: DuckDuckGo parsing accepts either attribute order and no longer lets a
  result inherit the next result's snippet.
- Fix: MCP requests carry `MCP-Protocol-Version` after initialization, and a
  batch frame for another request is rejected instead of returned.
- Fix: network failures from the REST backends keep the undici cause chain
  (DNS/proxy/TLS) instead of printing only "fetch failed".
- UI: the settings card now uses only DSH theme tokens (the Save button was
  transparent with white text); stale loads and credential reads cannot roll
  back newer writes, a save conflict reloads the revision and remains
  retryable, a failed toggle clears on retry, and a read-only/unavailable
  snapshot no longer renders live controls or fabricated counts.
- Add: `intervention` setting (`official` / `balanced` / `thorough`) that makes
  the provider's degree of query rewriting and result presentation explicit.
  `official` passes the model's query verbatim, adds no header/telemetry to
  `content`, and follows the consumer's `maxResults`; `balanced` is the
  historical default; `thorough` enables rerank + deep coverage. Internal
  multi-query stays an independent opt-in because the host tool already merges
  1-10 model-authored queries.
- Fix: query shaping no longer deletes content words or one side of a quoted
  phrase (`findability` -> `ability`, `searching` -> `ing`,
  `Google Search Console` -> `Console`, unbalanced quotes). Only explicit
  conversational/request prefixes are stripped; pure filler still fails early.
- Fix: ranking keeps version digits, so `url+title` dedupe and rerank no longer
  merge "GPT-4" with "GPT-5" or "Node 8" with "Node 9".
- Fix: RRF gives the original query double weight, so a homepage repeated in
  narrow sub-query variants cannot outrank the page that answers the query.
- Fix: breaker/health fold once per backend per search instead of once per
  multi-query variant; one search can no longer trip the 3-failure threshold
  by itself.
- Fix: the result header's language and the tier/shaping switches participate
  in the cache key, so cross-language or cross-tier hits cannot replay the
  wrong header or flags.
- Fix: TinyFish keyed searches reuse the per-credential MCP session instead of
  re-running initialize on every search (rotation still re-initializes).
- Fix: SearXNG's multi-instance budget now receives the effective backend
  timeout; per-instance attempts split the real budget instead of each taking
  4.5s against the provider's 8s ceiling.
- Perf: cache eviction counts directory names on the common path and only
  stats entries when over the cap, then trims to a low-water mark (about 3x
  faster at the default 200-entry cap, still a hard bound).
- Align: default `numResults` is 10, matching `dsh-tool-web`'s
  `searchMaxResults` default; `official` ignores the user count entirely.
- Tests: 211 unit tests plus the separate health suite.

## 2.8.6 - 2026-10-18

Search-failure hardening (online incident: every backend search failed with "all enabled backends failed (4)").

- Fix: the sidecar forwarder hop now speaks `node:http(s)` directly instead of the global `fetch`. Hosts that install a global dispatcher (e.g. an HTTP_PROXY-wired `EnvHttpProxyAgent`) hijacked the request to the sidecar: with the sidecar host missing from NO_PROXY it was proxied away through the very chain the sidecar fronts (proxy log: `dial -> sidecar ... EOF`), killing every search. Regression test pins it.
- Fix: the forwarder hop gains its own ceiling — `min(caller signal, DSH_EGRESS_FORWARDER_TIMEOUT_MS ?? 20s)` — with distinct errors for caller abort vs "sidecar stalled?" vs "unreachable (cause chain)".
- Fix: all-fail diagnostics keep the full cause chain and enumerate every backend reason (no >4 truncation; cooled skips counted).
- Fix: SearXNG semantic health — HTTP 200 without `results[]` (anti-bot interstitial) no longer records as success and no longer resets the breaker; anti-bot pages get a friendly label.
- Add: opt-in SearXNG multi-instance failover (`searxngBaseURLs`).
- Fix: DDG timeout ceiling 5s to 8s (measured scrapes up to 7.7s were killed).
- Fix: backend timeouts are classified as timeouts in telemetry/health (were misreported as `unified search aborted`, i.e. user cancellation); proxy/forwarder path failures get their own label.

## 2.8.5 - 2026-10-18

Fingerprint-gated upstreams (Exa, DuckDuckGo) behind TLS-censoring exits.

- Add: optional TLS-egress forwarder. When `DSH_EGRESS_FORWARDER` is set to a local sidecar's `/fwd` endpoint (a forwarder backed by a browser TLS stack), backend requests relay through it and carry the upstream proxy in the sidecar spec (`DSH_EGRESS_FORWARDER_PROXY`, defaulting to `HTTPS_PROXY`). Exists because some upstreams gate on the client TLS fingerprint (JA3) rather than on the exit IP — Node's fingerprint is rejected where a Chromium one is accepted. Unset = byte-identical behavior.
- Fix: the DuckDuckGo backend now uses the GET form. The html endpoint serves the same results page, but the POST form is rejected by its bot wall for non-browser clients (method + fingerprint double gate).
- Tests: 3 new forwarder tests (spec encoding/passthrough, 502 error mapping, NO_PROXY bypass).

## 2.8.4 - 2026-10-18

0.2.1-alpha compatibility: the settings section is visible again on builds without the legacy `settingsScope` client service.

- Fix: the client `inject` no longer hard-depends on `settingsScope` (a missing service kept the web boot pending forever). The legacy scope path is preserved for builds that still publish it.
- Add: `settings.section` registers unconditionally; on 0.2.x the card binds a fenced bridge (`GET/POST /api/unified-search/settings`) to the host settings service and writes the same volatile profile entry the provider resolves from — no second settings store. Headless/CI profiles never mount `webServer`, so nothing runs there.
- Fix: numeric fields (`numResults`, `concurrency`, `backendTimeoutMs`) lost their bounds check and could never be saved.
- Fix: credential invalidation now listens to `credentials/reference-updated` (0.2.x) with the legacy `credentials/updated` kept as a fallback; credential read/write prefers the 0.2.x remote face.
- Add: outbound backend requests now honor `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` through a zero-dependency CONNECT tunnel (`lib/util/egress-fetch.js`), so deployments whose egress is a kill-switched proxy (containers) can search; behavior is unchanged when no proxy env is set.
- Fix: history/health routes fence through the host connection admission (kernel parity) instead of loopback-only host matching, so LAN and tunnel sessions are served; the health route gains the same fence.

## 2.8.3 - 2026-10-06

- v2.8.3: empty shaped-query rejected early (no fan-out/cache aliasing), ZH bare filler 搜索 added, CJK separators require a boundary on either side (entity protection), 4 regression tests

## 2.8.2 - 2026-09-30

- P1 fixes — legitimate zero-results no longer forged as all-backends-failed; limiter sync-throw no longer leaks running (deadlock); exa category inference gated on deepCoverage (parity with tavily/searxng); 3 regression tests

## 2.8.1 - 2026-09-29

DSH 0.2.0 SettingsForms adapter (ruling in dsh-plugin-hub/docs/reviews/
cross-settings-forms.md):

- Added: Config carries meta.volatile — the 0.2.0 settings service
  auto-generates its form from the plugin's Config but only fields under a
  volatile ancestor; without the mark the websearch form was empty. The whole
  Config is now the 0.2.0 Settings panel form.
- Removed: the "no installSection" console.warn on the 0.2.0 line (the
  auto-generated form IS the section; the warning contradicted the visible
  UI). The 0.1.5 installSection path is unchanged.
- Changed: descriptions added to all remaining bare fields (7 ×ApiKeyEnv,
  8 ×BaseURL, 3 ×Model) — meta.description is the only user-visible label
  lever on the 0.2.0 form renderer.
- Guard tests: Config.meta.volatile stays true; every top-level field has a
  non-empty description; RT volatileForm replication includes all fields.

## 2.8.0 - 2026-09-29

"Search wider, search deeper" — retrieval-depth upgrade, all feature-gated
(both new switches default OFF; see README "权威依据与取舍" for sources).

### Added
- multiQuery mode (`multiQueryEnabled`, default false): strictly gated
  (length > 60 or a vs/and/比较/对比/和 separator) derivation of 2-3 sub-queries,
  each fanned out fully, fused with Reciprocal Rank Fusion (k=60); the
  original query always participates with full weight (arXiv:2404.01037 guard).
- deepCoverage (`deepCoverage`, default false): per-backend result budget
  widened to ceil(maxResults × 1.5) before global dedupe/truncation; Tavily
  upgraded to search_depth "advanced"; SearXNG categories widened to
  "general,news,it"; Exa data-category inference (github / research paper /
  news, high-confidence only).
- Observability: GET /api/websearch/history now carries a `backends` array
  (last real outcome, latency, breaker state per backend — no error strings).
- Per-backend timeout ceilings: ddg/searxng capped at 5s
  (min(override, backendTimeoutMs)) so unreachable hosts no longer stall the
  fan-out tail; real-clock test at 5013ms.

### Verified
- Real-call: Exa MCP accepted `category: "github"` and returned github.com-only
  results (docs/real-call-2.8.0.md). DDG/SearXNG real calls blocked by this
  sandbox's egress policy (connection-level failures); covered by parse-level
  tests instead.

## 2.7.3 - 2026-09-29

Compatibility fixes from the six-package compat audit:

- Fixed (P0): the client settings card no longer hard-crashes on DSH 0.1.7 —
  settingsScope access is feature-detected (0.1.5 unchanged; 0.1.7 degrades to
  a console.warn breadcrumb with the shim/config guidance).
- Changed (P1): the server-side settings section no longer silently no-ops on
  the 0.1.7 SettingsForms line — one-time console.warn; search itself is
  unaffected via cordis config.
- Added: engines "node": ">=20.3" (AbortSignal.any).
- Fixed (P2): the cache/history store directory falls back to os.homedir()
  instead of process.env.HOME — HOME is usually unset on Windows, which made
  the store path relative and silently disabled cache/history.
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

