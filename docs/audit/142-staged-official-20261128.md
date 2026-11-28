# 142 — 2026-11-28 staged official reconciliation (2.13.11)

Baseline 2.13.10 (`dca2ecf`, 241 tests). Final **242/242** tests; 15
consecutive full-suite runs green.

## P1: the reload reconcile deleted an edit made after staging balanced

2.13.10 reconciled official drafts inside `republish()` against the **committed**
snapshot. The card decides official from the **staged-effective** tier. With a
saved official profile:

1. stage `intervention=balanced` (controls unlock);
2. edit `numResults=40`;
3. `republish()` still sees committed `official`, deletes `numResults`, and the
   keystroke vanishes; Save posts only `intervention`.

`republish()` now derives the tier from the staged `intervention` when present
(`clear` maps to empty), falling back to the snapshot. A reload to official
with no staged tier still drops the four drafts.

Test: saved official → stage balanced → edit `numResults=40` → the input stays
enabled with `"40"`, and Save posts `numResults=40`.

## P3: first variant needs a small slice, not 1 ms

`shouldStartVariant(0, remaining, floor)` now requires `max(50 ms, …)` for
variant 1 (only `min(50, floor)` for sub-50ms configured values). A 1 ms
remainder no longer starts every backend with a 1 ms timeout; the zero-variant
guard remains for a genuinely spent deadline. Tests cover 49/50/999/1000.

## Docs

- README test count 241 → 241 (was still 240 in the prose line).
- Audit 139 restated as the 2.13.8 record; the predicate test belongs to 141.
- Audit 137's old “draft stays staged” sentence struck.
- `officialHint` names multiQuery/deep coverage as additionally forced off.

## Verification

- 15 × full suite 242/242.
- Cache-version key test now exists (`version: 99` differs).
