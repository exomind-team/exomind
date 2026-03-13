# Settings Inline Enum Alignment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current self-invented inline enum segmented buttons with `dev`-derived natural-width controls that match the approved single-select and multi-select interaction model.

**Architecture:** Keep the registry-driven settings page intact and swap only the inline enum renderer internals. Single-select uses a measured shared active indicator; multi-select uses per-option fade overlays inside the same shell family.

**Tech Stack:** React, TypeScript, Tailwind utility classes, Vitest, Testing Library

---

### Task 1: Lock the new renderer contract with failing tests

**Files:**
- Modify: `tests/unit/settings/settings-renderers.test.tsx`
- Test: `tests/unit/settings/settings-renderers.test.tsx`

**Step 1: Write the failing test**

Add tests that assert:
- single-select inline enum renders a shell with an active indicator element
- multi-select inline enum renders option-level activation overlays and updates them after click

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/settings/settings-renderers.test.tsx`
Expected: FAIL because the current renderer still uses the old bordered segmented buttons and has no indicator / overlay structure.

**Step 3: Write minimal implementation**

Implement the smallest renderer changes required to satisfy the tests without touching dialog enum behavior.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/settings/settings-renderers.test.tsx`
Expected: PASS

### Task 2: Implement the inline enum shell and selection layers

**Files:**
- Modify: `src/ui/app/components/settings/settings-renderers.tsx`
- Modify: `src/ui/app/config/settings/settings-types.ts` (only if typing needs a minimal extension)

**Step 1: Write the failing test**

Extend the renderer tests if needed to cover:
- single-select width-following indicator state
- icon-bearing options still render correctly inside inline buttons

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/settings/settings-renderers.test.tsx`
Expected: FAIL on the newly added case.

**Step 3: Write minimal implementation**

Build:
- single-select measured indicator
- shared shell classes derived from `TimerConfigPanel` / `EstimatedTimeEditor`
- multi-select per-button background fade

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/settings/settings-renderers.test.tsx`
Expected: PASS

### Task 3: Verify settings-page integration does not regress

**Files:**
- Modify: `tests/unit/settings/settings-input-section.issue199.test.tsx`
- Modify: `tests/unit/settings/settings-feedback-section.test.tsx`
- Modify: `tests/unit/settings/settings-layouts.test.tsx`

**Step 1: Write or adjust failing tests**

Add only the assertions needed if integration snapshots / class expectations changed.

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/settings/settings-input-section.issue199.test.tsx tests/unit/settings/settings-feedback-section.test.tsx tests/unit/settings/settings-layouts.test.tsx`
Expected: FAIL only if the renderer DOM contract changed in a meaningful way.

**Step 3: Write minimal implementation**

Update tests or markup to keep the settings layouts aligned with the new inline enum renderer.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/settings/settings-input-section.issue199.test.tsx tests/unit/settings/settings-feedback-section.test.tsx tests/unit/settings/settings-layouts.test.tsx`
Expected: PASS

### Task 4: Final verification

**Files:**
- Modify: none unless failures force follow-up

**Step 1: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 2: Run focused settings tests**

Run: `npx vitest run tests/unit/settings/settings-renderers.test.tsx tests/unit/settings/settings-input-section.issue199.test.tsx tests/unit/settings/settings-feedback-section.test.tsx tests/unit/settings/settings-layouts.test.tsx tests/unit/settings/settings-desktop-vc-tabs.issue198.test.tsx`
Expected: PASS

**Step 3: Live-check the running web worktree**

Open: `http://127.0.0.1:5174/settings`
Expected: inline enum controls reflect the new shell / indicator behavior without breaking helper text or row order.
