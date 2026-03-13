# Settings Dialog Alignment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Align settings dialog enums and single-value text dialogs with the established `dev` patterns while preserving the registry architecture.

**Architecture:** Keep the implementation inside the existing settings renderers and settings custom items instead of creating a new dialog system. Migrate dialog enum entries to registry-backed renderers, migrate single-value text dialogs to one shared family, and leave multi-field dialogs custom but visually aligned.

**Tech Stack:** React, TypeScript, Radix Dialog, Vitest, Testing Library, Tailwind utilities backed by CSS variables

---

### Task 1: Lock the target dialog behavior with failing tests

**Files:**
- Modify: `tests/unit/settings/settings-renderers.test.tsx`
- Modify: `tests/unit/settings/settings-timer-card.issue182.test.tsx`
- Test: `tests/unit/settings/settings-renderers.test.tsx`
- Test: `tests/unit/settings/settings-timer-card.issue182.test.tsx`

**Step 1: Write the failing tests**

- Add a renderer-level test for dialog enum options with descriptions
- Add a renderer-level test for dialog enum options without descriptions but with tone-driven selection overlay and adaptive border class
- Add a renderer-level test for single-value dialog footer layout, clear button, and `Key` icon for `MOSS API Token`
- Extend timer card coverage so the migrated registry entries still expose the historical dialog copy and selectable options

**Step 2: Run tests to verify they fail**

Run:

```bash
npx vitest run tests/unit/settings/settings-renderers.test.tsx tests/unit/settings/settings-timer-card.issue182.test.tsx
```

Expected:
- FAIL on missing descriptions, missing footer layout, or mismatched dialog structure

**Step 3: Commit**

```bash
git add tests/unit/settings/settings-renderers.test.tsx tests/unit/settings/settings-timer-card.issue182.test.tsx
git commit -m "test(settings): lock dialog alignment requirements"
```

### Task 2: Expand settings metadata for dialog enum and single-value dialog families

**Files:**
- Modify: `src/ui/app/config/settings/settings-types.ts`
- Modify: `src/ui/app/config/settings/settings-registry.ts`
- Modify: `src/ui/app/config/settings/settings-custom-items.tsx`

**Step 1: Write the minimal type additions**

- Add `enumStyle: 'segmented' | 'select' | 'dialog'`
- Add `description?: string` to enum options
- Add single-value dialog metadata for plain/secret field kind, footer content, and clear behavior

**Step 2: Migrate registry entries**

- Move `countdown-end-mode` to `enum + dialog`
- Move `sound-preset` to `enum + dialog`
- Update `moss-api-token` metadata and icon
- Update `sync-server-url` metadata

**Step 3: Keep multi-field custom entries custom**

- Remove only the now-obsolete custom enum entry implementations
- Leave `AiApiKeySetting` custom

**Step 4: Commit**

```bash
git add src/ui/app/config/settings/settings-types.ts src/ui/app/config/settings/settings-registry.ts src/ui/app/components/settings/settings-custom-items.tsx
git commit -m "refactor(settings): map dialog settings to registry families"
```

### Task 3: Implement dialog enum renderer and single-value dialog renderer

**Files:**
- Modify: `src/ui/app/components/settings/settings-renderers.tsx`
- Modify: `src/index.css`

**Step 1: Implement dialog enum renderer**

- Render dialog cards with optional description blocks
- Reuse fade overlay logic from inline multi-select for selected state
- Use CSS-variable-backed utility classes for borders and fills

**Step 2: Implement single-value dialog renderer**

- Render standardized footer metadata row
- Render full-width action buttons with optional clear
- Support secret/plain behavior without splitting into separate component families

**Step 3: Add CSS utilities**

- Add explicit utilities for dialog card borders, selected fills, and footer/button families so TSX does not hard-code colors

**Step 4: Commit**

```bash
git add src/ui/app/components/settings/settings-renderers.tsx src/index.css
git commit -m "refactor(settings): align dialog renderers with dev patterns"
```

### Task 4: Visually align remaining multi-field dialog elements

**Files:**
- Modify: `src/ui/app/components/settings/settings-custom-items.tsx`

**Step 1: Update `AiApiKeySetting` dialog elements**

- Keep it custom
- Replace ad hoc button/input styling with the same dialog element rhythm used by the single-value family

**Step 2: Commit**

```bash
git add src/ui/app/components/settings/settings-custom-items.tsx
git commit -m "style(settings): align multi-field dialog elements"
```

### Task 5: Verify and inspect in the running web app

**Files:**
- Modify only if verification reveals a bug

**Step 1: Run focused tests**

```bash
npx vitest run tests/unit/settings/settings-renderers.test.tsx tests/unit/settings/settings-timer-card.issue182.test.tsx
```

Expected:
- PASS

**Step 2: Run broader settings regression**

```bash
npx vitest run tests/unit/settings/settings-renderers.test.tsx tests/unit/settings/settings-input-section.issue199.test.tsx tests/unit/settings/settings-feedback-section.test.tsx tests/unit/settings/settings-layouts.test.tsx tests/unit/settings/settings-desktop-vc-tabs.issue198.test.tsx tests/unit/settings/settings-danger-section.test.tsx tests/unit/settings/settings-section-tones.test.tsx tests/unit/components/settings/DesktopAdaptiveToggle.test.tsx tests/unit/settings/settings-timer-card.issue182.test.tsx
```

Expected:
- PASS

**Step 3: Run typecheck**

```bash
npx tsc --noEmit
```

Expected:
- PASS

**Step 4: Verify the dev server**

Run:

```bash
curl -sS -D - -o /dev/null http://127.0.0.1:5174/settings | head -n 8
```

Expected:
- `HTTP 200`

**Step 5: Manual Web inspection**

Inspect:
- `倒计时结束模式`
- `选择提示音`
- `MOSS API Token`
- `同步服务器`
- `AI 设置`

**Step 6: Commit**

```bash
git add <verified files>
git commit -m "test(settings): verify dialog alignment regression coverage"
```
