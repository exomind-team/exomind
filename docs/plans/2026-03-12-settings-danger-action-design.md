# Settings Danger Action Design

**Date:** 2026-03-12

**Goal:** Align the settings-page danger area with the old `dev` danger card while keeping the registry architecture and adding a reusable action-item button mode.

## Constraints

- Only reuse existing `dev` structures and existing in-repo UI primitives.
- This batch does not introduce a new confirmation dialog component.
- Existing `confirmMessage` semantics stay valid and must also work for button-mode actions.
- The danger section remains the last rendered settings group.
- Group styling must be color-configurable through a tone color, not a fixed enum.

## Reference Basis

- Old `dev` settings danger card in `61ecc3a:src/ui/app/pages/SettingsPage.tsx`
- Current shared settings section shell in `src/ui/app/components/settings/settings-section.tsx`
- Current action renderer in `src/ui/app/components/settings/settings-renderers.tsx`
- Existing dialog primitive in `src/components/ui/dialog.tsx` is not used for danger confirmation in this batch

## Approved Design

### Section Layer

- `SettingsSection` gains `toneColor?: string | null`.
- `null` keeps the current neutral shell.
- A non-null color injects a CSS custom property and switches the section border, divider, and action emphasis to that color family.
- The danger section passes a red tone color from layout/config and still renders last.

### Action Item Layer

- `ActionSettingsItem` gains `actionMode?: 'row' | 'button'`.
- Existing `buttonLabel` remains the visible CTA text for `button` mode.
- Existing `confirmMessage` remains the confirmation field for this batch.
- `row` keeps current full-row activation behavior.
- `button` renders:
  - left: label + optional description
  - right: explicit button
  - only the button fires the action

### Danger Section Application

- Danger entries move to `actionMode: 'button'`.
- Buttons use the inherited danger tone styling from the section.
- The section shell uses the red tone and matches old `dev` placement and visual emphasis.

## Testing Strategy

- Add failing renderer tests for:
  - button-mode actions rendering left content plus right CTA button
  - `confirmMessage` still gating button-mode actions
- Add failing SettingsPage test for:
  - danger section shell exposing the tone color
  - danger actions rendering explicit CTA buttons instead of clickable rows
- Run targeted settings tests plus `npx tsc --noEmit`.
