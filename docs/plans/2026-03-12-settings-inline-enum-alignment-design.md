# Settings Inline Enum Alignment Design

**Date:** 2026-03-12

**Goal:** Align settings-page inline enum controls with the existing `dev` visual language while honoring the confirmed exception that settings rows do not need to copy the `当下` page layout verbatim.

## Constraints

- Only extract or minimally extend patterns that already exist in `dev`.
- This task applies to inline enum controls only. Dialog-based enum selectors stay on their own `dev` references.
- Web frontend only. Do not change Rust runtime behavior.
- Single-select inline enum keeps natural-width options instead of equal-width grid cells.
- Multi-select inline enum keeps natural-width options and uses per-option fade-in activation instead of a moving shared highlight.

## Reference Basis

- Visual grammar source: `src/ui/app/components/TimerConfigPanel.tsx`
- Matching variant source: `src/ui/app/components/EstimatedTimeEditor.tsx`
- Old settings-page segmented controls remain historical references for row composition and helper text placement, not for the inline enum internals.

## Approved Design

### Single Select

- Use the `预期时长` three-layer structure as the base:
  - shell container
  - absolute active indicator
  - foreground option buttons
- Keep settings-row usage natural-width with `inline-flex`, not equal-width `grid`.
- Measure the active button and animate the indicator with both `transform` and `width` so the highlight adapts to different label widths.
- Preserve existing option click behavior, async set handling, helper text, and test ids.

### Multi Select

- Reuse the same outer shell, spacing, typography, and rounded corners.
- Do not use a shared moving indicator.
- Each option owns its own activation background layer.
- The activation layer transitions with opacity only; no sliding animation.

### Row Integration

- Continue rendering through the existing settings registry and `SettingRow`.
- Preserve icon placement, helper-text indentation, and current registry API shape unless a tiny type extension is required by implementation.

## Testing Strategy

- Add renderer tests that fail against the current self-invented segmented buttons.
- Verify single-select renders the moving indicator shell.
- Verify multi-select renders per-option activation overlays and toggles them correctly.
- Run targeted `vitest` renderer/layout tests plus `npx tsc --noEmit`.
