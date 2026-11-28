# 153 — settings UX closure and low-risk optimization (2.13.20)

Baseline 2.13.19 (`1a88ba0`, 285 tests). Final **296/296**.

## UX fixes

Expert passes: frontend-ux, slider-ux-audit, audit-client. Full-card source and
render review at 240px, 360px, light and dark themes.

- Tier switch reports dropped drafts in the live region instead of silently
  discarding them; the tier description is shown once beside the slider and a
  short "controlled by the current tier" line remains near the locked controls.
- 240px wrapping: status strip, action bar and live region wrap instead of
  clipping error text. Hidden slider input no longer overlaps label clicks;
  0%/100% tick dots are inset; dark-theme thumb gets a 2px layer-2 ring
  (contrast 5.99:1 against the fill).
- Heading levels are h4 throughout; toggle errors moved outside the label and
  linked through aria-describedby; disabled switches lose pointer/hover affordance.
- One save-model hint replaces ten per-key repetitions. Empty Save shows a
  saved acknowledgement. Empty `enabledBackends` no longer disables controls.
- Credential read failures show one summary with a retry action; per-card
  read-failure paragraphs were removed to avoid ten repeated warnings.
- A failed refresh after a successful load keeps values and drafts, shows a
  retryable `refreshFailed` notice, and never turns into the unavailable state.
- Partial legacy saves announce "N fields saved" instead of simultaneously
  announcing "Save failed"; key errors and unavailable states are live regions.
- Read-only and unavailable states keep Discard available for local drafts.

## Low-risk optimization

- Telemetry result/empty paths share `telemetryLine()`; the result-only
  breaker/skipped annotations and the empty-path spelling are preserved.
- MCP tools/call has its own 60s per-RPC deadline (`deadlineMs` override),
  independent of the provider's shared backend budget; caller abort wins.
- Provider `ready()` distinguishes available-but-keyless from a key-gated
  backend whose credential cannot resolve; it performs no network request.
- `publishedAt` is normalized to UTC ISO-8601 through `isoPublishedAt()`;
  relative/invalid ages are dropped, on both fresh and cache-hit paths.

## Verification

- 293 tests, 10 consecutive runs.
- Light/dark static rendered harness at 240px and 360px: actions wrap, status
  remains readable, dark thumb is separated from fill.
- Remaining: no real React/browser mount; the client test harness still renders
  one hook pass. Custom-backend and new-backend work remain in the goal.
