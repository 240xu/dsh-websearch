# 143 — 2026-11-28 all-skipped variant accounting (2.13.12)

Baseline 2.13.11 (`eb8912d`, 242 tests). Final **244/244** tests; 12
consecutive full-suite runs green.

## P2: a budget expiry between admission and first start produced a 0-of-N error

`shouldStartVariant` admits a variant while budget remains, but each backend
recomputes `remainingNow` at its own start. If the clock crosses the deadline
between those two checks, every backend pushes `skipped: true`, yet
`variantsRun` incremented. The all-failed path then reported:

`all attempted backends failed (0 of 2 enabled; 2 skipped for budget) - …`

which contradicts itself and hides the intended budget-exhausted error.

`variantStarted()` and the loop now count a variant only when at least one
telemetry entry is not `skipped`. An entirely skipped variant contributes no
failures/telemetry and leaves the zero-variant guard or the facet-skip note
to describe the outcome. Caller aborts are still thrown before that check.

Tests: the pure predicate matrix (all skipped / mixed / success), the invalid
baseURL configuration error, and the 244-test
suite remains green. The exact clock race is a last-resort path; the predicate
is the deterministic coverage.
