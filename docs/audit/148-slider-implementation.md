# 148 — intervention slider implementation (2.13.15)

Baseline 2.13.14 (`ee9c2c4`, 248 tests). Final **255/255** tests.

## Delivered

- `intervention` is a three-stop native range (official/balanced/thorough)
  with a DSH-token track, fill, thumb, tick dots, short stop labels and the
  existing hint as `aria-describedby`.
- Dragging previews only the DOM (`--wsc-progress`, `data-index`,
  `aria-valuetext`); no staging until release. The uncontrolled input and
  ref-based sync keep focus when the committed tier changes.
- Keyboard commits after 160 ms; rapid stops do not commit through official
  and therefore do not drop `numResults`/`rerank`/`telemetry`/`header`
  drafts. A committed official still drops them as before.
- Clicking a stop label is a shortcut; mouse-down is prevented to keep the
  range focused.
- Pointer cancel restores the committed stop; no-op release stages nothing;
  read-only remains enforced by the card fieldset.

## Expert review findings resolved

- P1 focus loss from `key={value}` remount → removed key, ref sync.
- P1 stale preview after interrupted gesture → `pointercancel` restore.
- P1 keyboard intermediate official committing/dropping drafts → 160 ms
  settle with captured tier + timer cleanup.
- P1 invisible range band covering the section heading → inset 0/height 24.
- P1 light thumb contrast → 1px business-primary border, no elevation shadow.
- P2 ticks reached-state, focus-ring width token, label buttons, timer cleanup,
  no-op tests and clickable labels.

## Verification

- 10 consecutive full-suite runs, 255/255.
- Token allowlist includes `switch-thumb`; select inventory is 7.
- Synthetic light/dark renders:
  [`assets/intervention-slider-light.png`](assets/intervention-slider-light.png),
  [`assets/intervention-slider-dark.png`](assets/intervention-slider-dark.png).
