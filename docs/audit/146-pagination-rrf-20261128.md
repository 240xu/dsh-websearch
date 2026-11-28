# 146 — 2026-11-28 page-2 pause and plan-source RRF

Baseline 2.13.14 (`088c322`, 247 tests). Final **248/248** tests.

## Page-2 pause boundary: verified, no code change

The SearXNG backend already behaves as documented:

- page 1 succeeds, page 2 fails → page 1 sources are returned and pagination
  pauses for 60 s;
- the next search requests page 1 only;
- after the pause expires, page 2 is attempted again;
- a page-2 success clears the pause, so the following search paginates again.

Test: `tests/lead-20261128-searxng-pages.test.js` now covers all four steps
against a local HTTP server, including clock advancement and page-2 recovery.
No production change was needed.

## Plan-source RRF weight: kept at 2, now explicitly covered

Parallel's public MCP response exposes one merged `results` array; it carries
no per-facet attribution. Adding the planned list to each facet list, or
scaling its weight by facet count, would over-count sources with no evidence
about which facet produced them. The existing weight 2 for the primary list
remains the deliberate trade-off, and the plan test now asserts the planned
source actually reaches the fused result (not just that the call happened).

Residual: a truly per-facet plan result would need a provider field Parallel
does not expose; without it, ranking changes are unvalidated.
