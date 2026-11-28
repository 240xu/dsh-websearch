# 145 — 2026-11-28 stale invalid-field status (2.13.14)

Baseline 2.13.13 (`c9e3b3c`, 246 tests). Final **247/247** tests.

`dropOfficialDrafts()` removed the four overridden drafts and their
`failedFields`, but left the controller's `failed` flag set. After an invalid
`numResults` failed Save and the user switched to official, the list was empty
while the card still reported an invalid-fields status.

The drop now clears `failed` when it leaves `failedFields` empty. The status
strip and the field-level error agree again.

Test: invalid `numResults=150` → Save fails (`failed === true`) → switch to
official → `numResults` is no longer failed and `failed === false`.
