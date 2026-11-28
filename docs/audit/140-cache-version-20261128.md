# 140 — 2026-11-28 cache semantics version (2.13.9)

Baseline 2.13.8 (`f602cda`, 240 tests). Final **240/240** tests.

The result cache key covered query/filters/bound/backends/mode/options, but
not the implementation's result semantics. Entries written by older code
(e.g. a multi-query run truncated before 2.13.3, or a plan parsed before
2.13.4) stayed readable after an upgrade and could replay behavior the new
code deliberately avoids.

`cacheKeyFor` now includes `CACHE_SEMANTICS_VERSION` (currently **2**). The
version is bumped only when cached result semantics change without a new key
field; old entries miss and age out normally. No cache files are deleted.

Test: a different `version` produces a different key.
