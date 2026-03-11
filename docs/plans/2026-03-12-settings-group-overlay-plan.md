# Settings Group Overlay Alignment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn feature toggles into a real grouped settings item with landscape dialog / portrait drawer adaptation, and align volcano resource model to inline enum styling.

**Architecture:** Extend the settings registry/renderer system instead of adding another custom component. Group items become first-class overlay containers that render child settings items through the existing shared renderer family. Volcano resource model moves from `select` to inline enum with normalized labels.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, existing Dialog/Drawer primitives

---

### Task 1: Lock the new behavior with failing tests

**Files:**
- Modify: `tests/unit/settings/settings-renderers.test.tsx`
- Modify: `tests/unit/components/settings/DesktopAdaptiveToggle.test.tsx`
- Modify: `tests/unit/settings/settings-input-section.issue199.test.tsx`
- Modify: `tests/unit/settings/settings-registry-coverage.test.ts`

**Step 1: Write the failing test**

- Add a renderer test proving `group` items open as `Dialog` when `ctx.isLandscape === true` and as `Drawer` when `ctx.isLandscape === false`.
- Add a settings page test proving `功能开关` is still reachable but now rendered through the shared group path.
- Add an input section test proving `火山资源模型` renders as inline enum buttons and no option label contains the `模型 ` prefix.
- Update registry coverage audit so `feature-toggles` is no longer a `custom` escape hatch and `volcano-resource-model` is no longer `select`.

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/settings/settings-renderers.test.tsx tests/unit/components/settings/DesktopAdaptiveToggle.test.tsx tests/unit/settings/settings-input-section.issue199.test.tsx tests/unit/settings/settings-registry-coverage.test.ts`

Expected: FAIL on group overlay mode, feature-toggles classification, and volcano inline enum expectations.

### Task 2: Implement first-class group overlay rendering

**Files:**
- Modify: `src/ui/app/config/settings/settings-types.ts`
- Modify: `src/ui/app/components/settings/settings-renderers.tsx`
- Modify: `src/ui/app/pages/SettingsPage.tsx`

**Step 1: Write minimal implementation**

- Extend `SettingsContext` with `isLandscape`.
- Extend `GroupSettingsItem` with the metadata needed for overlay rendering (`groupStyle`, title/description/summary, trigger text).
- Replace the placeholder `GroupRenderer` with a real renderer that:
  - opens on row click,
  - chooses `Dialog` when `ctx.isLandscape`,
  - chooses `Drawer` when not,
  - renders child items via `SettingsItemRenderer`,
  - reuses tone style and shared divider behavior.

**Step 2: Run targeted tests**

Run: `npx vitest run tests/unit/settings/settings-renderers.test.tsx tests/unit/components/settings/DesktopAdaptiveToggle.test.tsx`

Expected: PASS

### Task 3: Convert feature toggles into a group item

**Files:**
- Modify: `src/ui/app/config/settings/settings-registry.ts`
- Modify: `src/ui/app/components/settings/settings-custom-items.tsx`
- Modify: `tests/unit/settings/settings-registry-coverage.test.ts`

**Step 1: Write minimal implementation**

- Remove `feature-toggles` from the audited `custom` whitelist.
- Replace the registry entry with a `group` item containing boolean child settings for:
  - `desktop-adaptive`
  - `agent-page-enabled`
  - `command-palette-enabled`
- Remove the temporary `FeatureTogglesSetting` wrapper from custom items if no longer used.

**Step 2: Run targeted tests**

Run: `npx vitest run tests/unit/components/settings/DesktopAdaptiveToggle.test.tsx tests/unit/settings/settings-registry-coverage.test.ts`

Expected: PASS

### Task 4: Align volcano resource model to inline enum

**Files:**
- Modify: `src/lib/asr/volcano-config.ts`
- Modify: `src/ui/app/config/settings/settings-registry.ts`
- Modify: `tests/unit/settings/settings-input-section.issue199.test.tsx`
- Modify: `tests/unit/settings/settings-registry-coverage.test.ts`

**Step 1: Write minimal implementation**

- Normalize preset labels by removing the `模型 ` prefix at the source or at registry mapping time.
- Change `volcano-resource-model` from `enumStyle: 'select'` to shared inline enum rendering.
- Keep existing provider-based visibility and helper text, but align displayed labels with the shortened names.

**Step 2: Run targeted tests**

Run: `npx vitest run tests/unit/settings/settings-input-section.issue199.test.tsx tests/unit/settings/settings-registry-coverage.test.ts`

Expected: PASS

### Task 5: Full verification

**Files:**
- No code changes expected

**Step 1: Run full relevant verification**

Run: `npx vitest run tests/unit/settings/settings-renderers.test.tsx tests/unit/components/settings/DesktopAdaptiveToggle.test.tsx tests/unit/settings/settings-input-section.issue199.test.tsx tests/unit/settings/settings-registry-coverage.test.ts tests/unit/settings/settings-export-runtime.issue222.test.tsx tests/unit/settings/settings-timer-card.issue182.test.tsx tests/unit/settings/task-import-export.issue481.test.tsx tests/unit/settings/task-backend-diagnostics.issue481.test.tsx tests/unit/settings/settings-feedback-section.test.tsx tests/unit/settings/settings-layouts.test.tsx tests/unit/settings/settings-danger-section.test.tsx tests/unit/settings/settings-section-tones.test.tsx tests/unit/settings/settings-theme-vars.test.ts tests/unit/settings/import-export.test.tsx`

Expected: PASS

**Step 2: Run type-check**

Run: `npx tsc --noEmit`

Expected: PASS

**Step 3: Verify dev server route**

Run: `curl -sS -D - -o /dev/null http://127.0.0.1:5174/settings | head -n 8`

Expected: `HTTP/1.1 200 OK`
