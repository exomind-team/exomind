# PR499 Review Regressions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restore the two verified regressions on PR #499: combined backup/import semantics and Tauri voice shortcut mount-time sync.

**Architecture:** Keep the registry-driven settings architecture intact. Fix behavior at the current abstraction boundaries by restoring combined backup handling inside `settings-data-service` and reintroducing one-shot Tauri hotkey sync from `SettingsPage`.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, Tauri API mocks

---

### Task 1: Combined Backup Regression

**Files:**
- Modify: `src/services/impl/settings-data-service.ts`
- Test: `tests/unit/services/settings-data-service.test.ts`

**Step 1: Write the failing test**

- Add a test proving `exportBackup()` merges event payload and task payload for the top-level backup path.
- Add a test proving `importBackup()` restores embedded `tasks` from a combined payload.

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/services/settings-data-service.test.ts`

Expected: backup tests fail because the current implementation only exports/imports events.

**Step 3: Write minimal implementation**

- Restore combined payload export semantics.
- Restore embedded task import semantics while keeping pure-event payloads compatible.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/services/settings-data-service.test.ts`

Expected: backup tests pass.

### Task 2: Voice Shortcut Mount Sync Regression

**Files:**
- Modify: `src/ui/app/pages/SettingsPage.tsx`
- Test: `tests/unit/settings/settings-input-section.issue199.test.tsx`

**Step 1: Write the failing test**

- Add a test proving that in Tauri the settings page calls `voice_shortcut_get` on mount and syncs the cached hotkey value.

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/settings/settings-input-section.issue199.test.tsx`

Expected: new mount-sync test fails because the registry page currently does not resync on load.

**Step 3: Write minimal implementation**

- Reintroduce a one-shot mount effect in `SettingsPage` that reads `voice_shortcut_get` in Tauri and updates the cached config value.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/settings/settings-input-section.issue199.test.tsx`

Expected: mount-sync test passes and existing shortcut tests stay green.

### Task 3: Final Verification And Branch Update

**Files:**
- Verify working tree and branch state

**Step 1: Run focused verification**

Run:
- `npx vitest run tests/unit/services/settings-data-service.test.ts tests/unit/settings/settings-input-section.issue199.test.tsx`
- `npx vitest run tests/unit/settings/settings-registry-consistency.test.ts tests/unit/settings/settings-renderers.test.tsx tests/unit/settings/settings-layouts.test.tsx tests/unit/settings/settings-page-layout-dispatch.test.tsx tests/unit/components/settings/DeveloperSection.test.tsx tests/unit/components/settings/DesktopAdaptiveToggle.test.tsx tests/unit/settings/settings-about-merge.issue198.test.tsx tests/unit/settings/settings-desktop-vc-tabs.issue198.test.tsx tests/unit/settings/settings-feedback-section.test.tsx tests/unit/settings/settings-input-section.issue199.test.tsx tests/unit/settings/settings-mock-data-toggle.issue213.test.tsx tests/unit/settings/settings-timer-card.issue182.test.tsx tests/unit/settings/task-import-export.issue481.test.tsx tests/unit/settings/task-backend-diagnostics.issue481.test.tsx tests/unit/settings/import-export.test.tsx tests/unit/settings/export-runtime.test.tsx tests/unit/settings/ui-transition.test.ts tests/unit/services/settings-data-service.test.ts`
- `npx tsc --noEmit`

**Step 2: Commit**

Run:
- `git add docs/plans/2026-03-11-pr499-review-regressions.md src/services/impl/settings-data-service.ts src/ui/app/pages/SettingsPage.tsx tests/unit/services/settings-data-service.test.ts tests/unit/settings/settings-input-section.issue199.test.tsx`
- `git commit -m "fix(settings): restore backup and hotkey sync regressions"`

**Step 3: Push**

Run: `git push origin feature/issue-312-settings-registry`

**Step 4: PR progress comment**

- Post a PR comment summarizing the two fixed regressions and the fresh verification evidence.
