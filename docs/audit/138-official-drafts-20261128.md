# 138 — 2026-11-28 official overridden drafts (2.13.7)

Baseline 2.13.6 (`5c60a22`, 239 tests). Bug re-audit found the remaining
staged-value trap: disabling an overridden control did not drop its draft, so
`numResults=40` staged before switching to `official` was still posted (and
ignored at runtime); an invalid `150` could block Save behind a locked field.

When `intervention` switches to `official`, the card now drops drafts for
`numResults`, `rerank`, `resultTelemetry` and `resultHeader` before
republishing; their controls return to the locked state. Save therefore posts
only `intervention`, and an invalid overridden draft cannot block it. The cache
TTL gate is unchanged: a staged TTL stays editable while the cache is off.

Tests: official switch drops overridden drafts; an invalid overridden draft
cannot block Save.
