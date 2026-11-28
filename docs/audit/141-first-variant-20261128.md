# 141 — 2026-11-28 first-variant start and official reload (2.13.10)

Baseline 2.13.9 (`a8ffcb1`, 240 tests). Final **241/241** tests; 15
consecutive full-suite runs green.

## Fixes

- **Variant 1 always runs on any remaining budget (P2).** The 1 s
  `minVariantBudgetMs` floor equals the schema's minimum
  `backendTimeoutMs` (1000). A single clock tick between
  `searchDeadline = Date.now() + 1000` and the first loop check left 999 ms,
  so the loop broke before any backend and the new zero-variant guard returned
  a budget error for a valid configuration. `shouldStartVariant()` now starts
  variant 1 while `remaining > 0` and applies the meaningful-slice floor only
  to later variants.
- **Official-overridden drafts are dropped on reload/revert (P2).** The 2.13.7
  drop lived only in `edit()` and only when the new text differed from the
  committed value. Reverting to a saved `official` profile, or receiving an
  official snapshot from another client, left `numResults`/`rerank` drafts
  staged; Save posted ignored values. The card controller reconciles on every
  `republish()` and `edit()` now drops before the revert early-return; stale
  `failedFields` for those controls are cleared too.
- **Starved-cache test is no longer vacuous (P2).** The raw `Map` stub did not
  match the provider's `{value, age}` hit shape, so “not cached” passed even
  if the run was cached. The test now uses a shape-correct stub and asserts
  `cacheStore.size === 0` after the truncated run.
- **Docs:** README test count 241; cache hit note is conditional; cache key
  components corrected; provider cache/floor/share comments aligned; audit 137
  marked superseded by 138 and its nonexistent pagination control removed.

## Verification

- `shouldStartVariant(0, 999, 1000) === true`;
  `(1, 999, 1000) === false`; 15 full-suite stress runs green.
- Existing official draft tests plus the cache-stub assertion.
