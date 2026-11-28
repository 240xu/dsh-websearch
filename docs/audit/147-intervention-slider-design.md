# 147 — intervention slider design (2.13.15)

Status: approved direction from round-10 audit; implementation starts here.

## Target

`intervention` is a three-stop ordered mode: `official` → `balanced` →
`thorough`. It replaces the native `<select>` with a discrete slider while
keeping the controller's staged-value state machine unchanged.

## What is official

- DSH 0.2.2-rc.5 has no slider primitive. Finite enums use native `<select>`;
  the official reasoning-effort control is a `menuitemradio` menu.
- The visual reference (`@ayanehana/dsh-reasoning-effort@1.0.0`, MIT) is a
  third-party plugin. We re-derive the anatomy (bar, ticks, thumb, current
  label) from DSH tokens; we do not copy its CSS, canvas, gradients, runner,
  `step=0.01`, or theme overrides. No third-party stylesheet text is shipped.

## Behavior

- Native `<input type="range" min=0 max=2 step=1>` is the interaction layer:
  arrows, Home/End, click-to-jump, drag, disabled via fieldset.
- `aria-label` = section title; `aria-valuetext` = short localized stop name;
  `aria-describedby` = `wsc-intervention-hint`; ticks/labels are
  `aria-hidden` decorations.
- Dragging updates only a DOM preview (`--wsc-progress` and `data-index`).
  Commit happens on `pointerup`, `keyup`, or `blur`, calling the existing
  `card.edit("intervention", tier)` once with the string tier.
- This prevents `dropOfficialDrafts` from firing while the thumb passes the
  official stop; only a committed official value drops the four drafts.
- Short labels under the track: 官方 / 平衡 / 彻底; the existing long labels
  remain in the hint. No new long copy.
- An unknown/missing stored tier shows `balanced` (the runtime default).
- A no-op commit goes through the existing early return and does not dirty
  the form.

## Visual

- Track 8px, `--dsw-alias-border-l3`; fill/thumb use
  `--dsw-alias-state-business-primary` / `--dsw-alias-switch-thumb`;
  shadow `--dsw-elevation-soft`; labels use secondary/primary label tokens.
- Focus ring on the wrapper via `:focus-visible`; disabled/read-only uses the
  fieldset plus opacity; reduced motion removes transitions.
- Grid row spans the full card width; labels use three equal columns with
  start/center/end alignment and `overflow-wrap: anywhere`.

## Tests

- Range renders with min/max/step, label, valuetext, describedby.
- Drag preview changes `data-index`/progress but does not stage or POST.
- Release commits exactly one string op; no-op release stages nothing.
- Keyboard Arrow/Home/End commit the right tier.
- Dragging across official and back does not drop `numResults` drafts;
  committing official does.
- Read-only/disabled: pointer/key activity stages nothing.
- Select inventory drops from 8 to 7; dictionary completeness and token gates
  updated (`--dsw-alias-switch-thumb` added to the allowlist).

## Implementation notes (final)

- The range is uncontrolled (`defaultValue`) with an `inputRef`; the commit
  effect writes `value`/`aria-valuetext`/progress back to the same node, so
  focus survives a commit. No `key` remount.
- Pointer release commits immediately; keyboard commits after a 160 ms settle
  so a rapid pass through `official` does not drop the four overridden drafts.
  Timer lives in a ref, is cleared on keydown/pointerup/blur/pointercancel and
  on unmount.
- Clicking a short stop label commits that stop (mouse-down is prevented so
  the range keeps focus).
- Visual preview: `docs/audit/assets/intervention-slider-light.png` and
  `...-dark.png` (synthetic token/stylesheet render, not a live DSH capture).
