# Settings Danger Action Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a reusable button-mode action item and restyle the danger section to match the old `dev` danger card while preserving the registry-driven settings page.

**Architecture:** Extend the action-item renderer with a second activation mode and keep confirmation on the existing `confirmMessage` path for now. Move section color emphasis into `SettingsSection` so danger uses a red tone without hard-coding a one-off component.

**Tech Stack:** React, TypeScript, Tailwind utility classes, CSS custom properties, Vitest, Testing Library

---

### Task 1: Lock the new action-item contract with failing tests

**Files:**
- Modify: `tests/unit/settings/settings-renderers.test.tsx`

**Step 1: Write the failing test**

Add tests that assert:
- button-mode action renders left label content and a separate CTA button
- clicking the CTA triggers `onAction`
- button-mode action still respects `confirmMessage`

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/settings/settings-renderers.test.tsx`
Expected: FAIL because actions are still rendered as full-row clickable settings rows.

**Step 3: Write minimal implementation**

Implement only the renderer changes needed for the new action mode and existing confirmation behavior.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/settings/settings-renderers.test.tsx`
Expected: PASS

### Task 2: Lock danger-section styling with failing page tests

**Files:**
- Create: `tests/unit/settings/settings-danger-section.test.tsx`

**Step 1: Write the failing test**

Add tests that assert:
- danger section renders after developer content as already expected
- danger shell exposes the configured tone color
- danger actions render separate CTA buttons with the old `dev` structure

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/settings/settings-danger-section.test.tsx`
Expected: FAIL because the section still uses the neutral shell and action rows are not button-mode cards.

**Step 3: Write minimal implementation**

Add the smallest section-style and registry changes needed to satisfy the test.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/settings/settings-danger-section.test.tsx`
Expected: PASS

### Task 3: Wire danger section tone color and button mode through layouts

**Files:**
- Modify: `src/ui/app/components/settings/settings-section.tsx`
- Modify: `src/ui/app/components/settings/settings-renderers.tsx`
- Modify: `src/ui/app/config/settings/settings-types.ts`
- Modify: `src/ui/app/config/settings/settings-registry.ts`
- Modify: `src/ui/app/layouts/DesktopSettingsLayout.tsx`
- Modify: `src/ui/app/layouts/MobileSettingsLayout.tsx`
- Modify: `tests/unit/settings/settings-layouts.test.tsx` if required by DOM changes

**Step 1: Write any remaining failing test**

Only add another failing assertion if the layout needs explicit section-tone coverage.

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/settings/settings-renderers.test.tsx tests/unit/settings/settings-danger-section.test.tsx tests/unit/settings/settings-layouts.test.tsx`
Expected: FAIL only on the uncovered behavior.

**Step 3: Write minimal implementation**

Implement:
- `actionMode`
- danger section tone color
- registry wiring for danger actions

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/settings/settings-renderers.test.tsx tests/unit/settings/settings-danger-section.test.tsx tests/unit/settings/settings-layouts.test.tsx`
Expected: PASS

### Task 4: Final verification

**Files:**
- Modify: none unless a regression appears

**Step 1: Run focused settings tests**

Run: `npx vitest run tests/unit/settings/settings-renderers.test.tsx tests/unit/settings/settings-input-section.issue199.test.tsx tests/unit/settings/settings-feedback-section.test.tsx tests/unit/settings/settings-layouts.test.tsx tests/unit/settings/settings-desktop-vc-tabs.issue198.test.tsx tests/unit/settings/settings-danger-section.test.tsx`
Expected: PASS

**Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 3: Live-check the running web worktree**

Open: `http://127.0.0.1:5174/settings`
Expected: danger section uses the red shell, keeps last placement, and shows explicit CTA buttons.
