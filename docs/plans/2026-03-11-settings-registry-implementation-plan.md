# Settings Registry Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the duplicated mobile/desktop settings rendering in `SettingsPage` with a schema-driven settings registry that acts as the single source of truth.

**Architecture:** Introduce a typed registry under `src/ui/app/config/settings/`, feed it into generic settings renderers plus dedicated mobile/desktop layouts, and reduce `SettingsPage` to platform detection plus layout dispatch. Preserve existing behavior by reusing current config getters/setters and extracting the import/export side effects into a settings data service.

**Tech Stack:** React 18, TypeScript, Vitest, Testing Library, existing `src/config/*` preference modules, existing app UI primitives.

---

### Task 1: Lock the target behavior with registry-focused tests

**Files:**
- Create: `tests/unit/settings/settings-registry-consistency.test.ts`
- Modify: `tests/unit/settings/settings-desktop-vc-tabs.issue198.test.tsx`
- Modify: `tests/unit/settings/settings-input-section.issue199.test.tsx`

**Step 1: Write the failing test**

Add a new consistency suite that imports `SETTINGS_REGISTRY` and `DESKTOP_TAB_CONFIG` and asserts:
- every top-level item has a unique `id`
- every item `type` is supported
- every category appears in desktop tab config
- `voice-shortcut-hotkey` exists and can be awaited when `set()` returns a promise

Add one desktop-layout regression that expects the new tab labels:
- `外观主题`
- `专注设置`
- `输入`
- `服务`
- `数据`
- `开发者`
- `危险区域`

Update the input-section test to keep asserting the input items still render from the page surface.

**Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run tests/unit/settings/settings-registry-consistency.test.ts tests/unit/settings/settings-desktop-vc-tabs.issue198.test.tsx tests/unit/settings/settings-input-section.issue199.test.tsx
```

Expected:
- `settings-registry-consistency.test.ts` fails because registry files do not exist yet
- desktop tab assertion fails because old desktop tabs still use `通知 / 关于`

**Step 3: Write minimal implementation**

Create the empty scaffolding needed for the tests to import:
- `src/ui/app/config/settings/settings-types.ts`
- `src/ui/app/config/settings/desktop-tab-config.ts`
- `src/ui/app/config/settings/settings-registry.ts`

Populate only the minimal exported types/config needed to make the tests compile, even if renderers still do nothing with them yet.

**Step 4: Run test to verify it passes**

Run the same `vitest` command and confirm only the newly implemented expectations are green.

**Step 5: Commit**

```bash
git add docs/plans/2026-03-11-settings-registry-implementation-plan.md tests/unit/settings/settings-registry-consistency.test.ts tests/unit/settings/settings-desktop-vc-tabs.issue198.test.tsx tests/unit/settings/settings-input-section.issue199.test.tsx src/ui/app/config/settings/settings-types.ts src/ui/app/config/settings/desktop-tab-config.ts src/ui/app/config/settings/settings-registry.ts
git commit -m "test: add settings registry coverage"
```

### Task 2: Add generic renderers and migrate registry-backed items

**Files:**
- Create: `src/ui/app/components/settings/settings-item-row.tsx`
- Create: `src/ui/app/components/settings/settings-section.tsx`
- Create: `src/ui/app/components/settings/settings-renderers.tsx`
- Modify: `src/ui/app/config/settings/settings-registry.ts`
- Modify: `tests/unit/settings/settings-feedback-section.test.tsx`
- Modify: `tests/unit/settings/settings-timer-card.issue182.test.tsx`
- Modify: `tests/unit/settings/settings-input-section.issue199.test.tsx`

**Step 1: Write the failing test**

Extend the existing settings tests so they verify registry-backed UI still behaves correctly through the generic renderer layer:
- feedback multi-select toggles still update `setFeedbackPreferences`
- timer controls still show the expected rows and choices
- input controls still render the existing test IDs and invoke the same setters

Where necessary, add assertions that the shared row renderer keeps labels/descriptions visible.

**Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run tests/unit/settings/settings-feedback-section.test.tsx tests/unit/settings/settings-timer-card.issue182.test.tsx tests/unit/settings/settings-input-section.issue199.test.tsx
```

Expected:
- failures because the new renderer components and registry-driven markup do not exist yet

**Step 3: Write minimal implementation**

Implement:
- `settings-item-row.tsx` for the shared row shell
- `settings-section.tsx` for section cards/titles
- `settings-renderers.tsx` with renderers for `boolean`, `enum`, `number`, `string`, `action`, `group`, `custom`

In `settings-registry.ts`, wire the real config getters/setters/subscribers for:
- theme
- timer end mode / sound preset
- feedback content
- input/voice settings
- sync server URL
- developer flags
- danger actions

Keep custom items for complex blocks like AI key config, feature toggles, device pairing, and task backend status.

**Step 4: Run test to verify it passes**

Run the same targeted `vitest` command and confirm the migrated behavior is green.

**Step 5: Commit**

```bash
git add src/ui/app/components/settings/settings-item-row.tsx src/ui/app/components/settings/settings-section.tsx src/ui/app/components/settings/settings-renderers.tsx src/ui/app/config/settings/settings-registry.ts tests/unit/settings/settings-feedback-section.test.tsx tests/unit/settings/settings-timer-card.issue182.test.tsx tests/unit/settings/settings-input-section.issue199.test.tsx
git commit -m "feat: add registry-backed settings renderers"
```

### Task 3: Extract settings data service and replace page layouts

**Files:**
- Create: `src/services/impl/settings-data-service.ts`
- Create: `src/ui/app/layouts/MobileSettingsLayout.tsx`
- Create: `src/ui/app/layouts/DesktopSettingsLayout.tsx`
- Modify: `src/ui/app/pages/SettingsPage.tsx`
- Modify: `tests/unit/settings/task-import-export.issue481.test.tsx`
- Modify: `tests/unit/settings/task-backend-diagnostics.issue481.test.tsx`
- Modify: `tests/unit/settings/settings-desktop-vc-tabs.issue198.test.tsx`

**Step 1: Write the failing test**

Add/adjust tests so they assert:
- task import/export actions still dispatch through the page surface
- task backend diagnostics still render in developer settings
- desktop tabs use the new category mapping and no longer expose the old `通知 / 关于` grouping

**Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run tests/unit/settings/task-import-export.issue481.test.tsx tests/unit/settings/task-backend-diagnostics.issue481.test.tsx tests/unit/settings/settings-desktop-vc-tabs.issue198.test.tsx
```

Expected:
- failures because layouts/service extraction is not complete yet

**Step 3: Write minimal implementation**

Implement `settings-data-service.ts` to own import/export side effects and Web/Tauri file-pick differences.

Create:
- `MobileSettingsLayout.tsx` for category sections plus `UserCard` / `MoreSection` / `AboutSection`
- `DesktopSettingsLayout.tsx` for tab grouping driven by `DESKTOP_TAB_CONFIG`

Refactor `SettingsPage.tsx` into:
- `useIsDesktop` detection
- `SettingsContext`
- registry filtering
- layout dispatch
- lightweight local state only for page-level affordances that cannot live in registry metadata

Delete obsolete inline settings markup once the new layouts cover it.

**Step 4: Run test to verify it passes**

Run the same targeted `vitest` command and confirm the page replacement is green.

**Step 5: Commit**

```bash
git add src/services/impl/settings-data-service.ts src/ui/app/layouts/MobileSettingsLayout.tsx src/ui/app/layouts/DesktopSettingsLayout.tsx src/ui/app/pages/SettingsPage.tsx tests/unit/settings/task-import-export.issue481.test.tsx tests/unit/settings/task-backend-diagnostics.issue481.test.tsx tests/unit/settings/settings-desktop-vc-tabs.issue198.test.tsx
git commit -m "refactor: move settings page to schema-driven layouts"
```

### Task 4: Final verification and cleanup

**Files:**
- Modify: `tests/unit/components/settings/setup-settings-mocks.tsx`
- Modify: any touched files from previous tasks

**Step 1: Write the failing test**

If the new registry/layouts require extra mocked subscribers or custom components, add the smallest missing test coverage before cleanup.

**Step 2: Run test to verify it fails**

Run the narrowest relevant `vitest` command for the new assertion.

**Step 3: Write minimal implementation**

Normalize mocks, remove dead helpers/imports from old settings code, and make sure the registry exports stay stable.

**Step 4: Run test to verify it passes**

Run:

```bash
npx tsc --noEmit
npx vitest run tests/unit/settings/settings-registry-consistency.test.ts tests/unit/settings/settings-feedback-section.test.tsx tests/unit/settings/settings-timer-card.issue182.test.tsx tests/unit/settings/settings-input-section.issue199.test.tsx tests/unit/settings/settings-desktop-vc-tabs.issue198.test.tsx tests/unit/settings/task-import-export.issue481.test.tsx tests/unit/settings/task-backend-diagnostics.issue481.test.tsx
```

Expected:
- TypeScript passes
- all settings-registry-related tests pass, regardless of unrelated existing suite failures

**Step 5: Commit**

```bash
git add src/ui/app/components/settings/setup-settings-mocks.tsx src/ui/app/config/settings src/ui/app/components/settings src/ui/app/layouts src/ui/app/pages/SettingsPage.tsx src/services/impl/settings-data-service.ts tests/unit/settings
git commit -m "test: verify settings registry migration"
```
