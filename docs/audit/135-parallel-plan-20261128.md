# 135 — 2026-11-28 Parallel plan facet tails (2.13.4)

Baseline 2.13.3 (`4d00c5e`, 235 tests). Final **236/236** tests.

The planned Parallel call merges up to three facets into one response, but
`parseParallelResult` was called with `request.maxResults` (e.g. 10). That
sliced the merged response to 10 before the provider's cross-backend merge,
so facet 2/3 tail sources could never contribute — a plan-capable backend
lost diversity that per-variant calls would have kept.

`parallelParseLimit(request)` now multiplies the requested max by the plan
facet count, capped at 300 (the user max is 100 and a plan has at most three
facets). The provider still truncates the final merged result to its own
bound; this only stops an early local slice. Single-query calls keep the
exact `maxResults` limit.

Tests: plan with 3 facets / max 8 → 24; max 100 / 2 facets → 200; no plan → 8.

Residual (accepted): plan sources enter only the primary RRF list (weight 2),
not each facet's list. Changing that would require duplicating plan sources
into synthetic per-facet lists and would double-count ranks; documented rather
than changed.
