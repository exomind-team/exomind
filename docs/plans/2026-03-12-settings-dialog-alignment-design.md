# Settings Dialog Alignment Design

## Context

The registry-based settings page has already aligned inline controls and section tone handling, but dialog-based settings are still behind the historical `dev` implementation. The current regressions are concentrated in three families:

- dialog enum pickers lose option descriptions and still hard-code card borders
- single-value text dialogs were simplified into a generic input + buttons shell
- multi-field dialogs still need to visually follow the same dialog element family

The user-established rule is strict: settings dialog components must be derived from existing `dev` patterns instead of introducing a new design family.

## Source Patterns

The canonical reference for the concrete dialog layouts is the historical settings page implementation at commit `61ecc3a`, especially:

- `倒计时结束模式`
- `选择提示音`
- `MOSS API Token`

The current `dev` branch still provides the dialog shell primitives in `src/components/ui/dialog.tsx`, so the implementation should combine:

- historical layout/content patterns from `61ecc3a`
- current shared dialog primitives and CSS variable pipeline from `dev`

## Goals

- Restore per-option descriptions for dialog enums when the source setting provides them
- Make dialog option card borders and inputs theme-adaptive through CSS variables/utilities rather than hard-coded colors in TSX
- Unify all single-value text editing entries in the settings page into one family, with support for plain text and secret text
- Keep multi-field dialogs as custom implementations, but make them visually use the same dialog element family

## Non-Goals

- No Rust changes
- No expansion into non-settings surfaces
- No new general-purpose dialog design system outside the settings scope
- No unbounded JSX slot API for arbitrary footer content

## Family 1: Dialog Enum Picker

### Covered Cases

- `倒计时结束模式`
- `提示音`
- future settings items that choose from an enum inside a dialog

### Behavior

- Setting row remains the entry point
- Dialog title and description come from setting metadata
- Each option renders as a card button
- If an option has a description, render a two-line layout matching the historical `倒计时结束模式`
- If an option has no description, render a one-line layout matching the historical `选择提示音`
- Selected state uses an overlay fill with fade-in/fade-out, the same visual logic as inline multi-select enum overlays
- Because dialog cards are spatially separated, there is no sliding indicator

### Styling Rules

- Card border must use CSS-variable-backed utilities
- Selected overlay must use the settings tone color pipeline
- No hex color literals inside TSX for dialog card borders, selected fills, or primary action colors

## Family 2: Single-Value Text Dialog

### Covered Cases

- `MOSS API Token`
- `同步服务器`
- future settings items that edit exactly one persisted text value

### Behavior

- Entry remains a normal settings row
- The dialog edits exactly one text field
- Two field modes are supported:
  - `plain`
  - `secret`
- Footer is standardized into:
  - one metadata row with left and right helper content
  - one full-width action row
- Action row layout:
  - `取消`
  - optional `清空`
  - `保存`
- Buttons always split available width evenly
- `secret` mode supports show/hide text in the footer-start area

### Constraints

- Footer metadata is constrained to dev-backed patterns only:
  - plain text helper
  - secret visibility toggle
- `MOSS API Token` must switch row icon from `Bot` to `Key`
- `MOSS API Token` keeps the historical clear behavior

## Multi-Field Dialogs

Dialogs like `AI 设置` remain custom implementations. They should not be forced into the single-value renderer, but they should reuse:

- current dialog primitives
- the same button sizing and layout rhythm
- the same token-driven borders and surfaces

## Data Model Adjustments

- `enum` gains a dialog presentation mode
- enum options gain optional `description`
- dialog strings gain metadata for:
  - field kind
  - left footer content
  - right footer content
  - clear button availability

## Acceptance Criteria

- `倒计时结束模式` shows option descriptions again
- `选择提示音` option borders adapt in dark mode instead of staying white
- `MOSS API Token` row icon is `Key`
- `MOSS API Token` dialog shows left/right footer information and full-width `取消/清空/保存`
- `同步服务器` uses the same single-value dialog family
- all affected tests are updated or added before implementation
