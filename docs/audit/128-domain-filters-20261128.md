# 128 — 2026-11-28 domain filters, Exa ceiling, telemetry fold (2.10.0)

Baseline: 2.9.1 (`e21264a`, 218 tests). This round implements the first two
authority-ranked deferred items from audit 127 and two smaller consistency
fixes. Verification: **220/220** tests, health 1/1, npm 2.10.0, both patches.

## Implemented

- **Domain filters** (`includeDomains` / `excludeDomains` Config strings):
  comma/space separated, URL or host accepted, lowercased bare host, invalid
  tokens dropped, deduped, capped at 20. `resolveOptions` exposes the lists
  top-level and on every backend's options; OpenAI sends
  `filters.allowed_domains` / `filters.blocked_domains` inside the
  `web_search` tool, Anthropic sends top-level `allowed_domains` /
  `blocked_domains` with include winning when both are set. Config is now 60
  fields; the card still edits 24 (domains are profile-level).
  - Sources: OpenAI web-search guide (`filters.allowed_domains`,
    `filters.blocked_domains`), Anthropic `web_search_20250305`
    (`allowed_domains`/`blocked_domains`, mutually exclusive).
  - Exa's simple MCP tool has no domain filter; switching to
    `web_search_advanced_exa` needs a tool-list probe, so it remains deferred
    rather than guessing the schema.
- **Exa / `numResults` ceiling**: Config max 50 → 100 and client bounds match;
  Exa sends `clamp(request.maxResults, 1, 100)`, default 10 when a caller
  omits it. Brave/Tavily still cap at their documented 20.
- **Multi-query telemetry folded by backend**: one segment per backend
  (`ok` = any success, `ms` = max, `count` = max, error = latest only when
  no success). A 5-backend × 3-variant search no longer repeats backends or
  hides one behind the 12-slot cap, and the line now agrees with
  history/health, which already folded per backend.
- **Cache key preserves fan-out order**: the backend list is no longer sorted.
  Reordering changes which duplicate's title/snippet wins, so it must miss.
- **Timeout test tolerance**: the absolute deadline can shave 1 ms off the
  configured per-backend timeout; the test accepts `1XXms` instead of exactly
  `120ms`. The production message still uses the clamped value actually
  enforced.

## Verification

- Domain normalization: URL/host/port inputs, invalid tokens, 30 → 20 cap.
- Cache order: `[exa,ddg]` and `[ddg,exa]` produce different keys.
- Full suite 220/220; live exa+parallel search unchanged.
- Patches: 32/32 (2.8.8), 33/33 (2.8.4).

## Still deferred

- Deterministic citation provenance / exact-quote audit. The native backends
  currently return `content: undefined` and discard the answer text, so a
  provider-side audit would first have to preserve that text; semantic
  entailment remains a host-side concern.
- Exa advanced MCP domain filters (tool schema probe first).
- SearXNG `pageno` under `deepCoverage`; Parallel 2–3 queries.
- `available()` key-presence tracking; cache `no-store` UI disclosure.
