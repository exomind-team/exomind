# Voice Input Experience Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add separate voice send preferences for `Now` vs chat/external input, plus configurable voice overlay diagnostics, transcript lines, and overlay position.

**Architecture:** Keep product semantics explicit by separating `Now` page voice behavior from global shortcut / chat-external behavior. Store new preferences in config modules, expose them in settings, apply overlay display preferences in the overlay page, and apply chat/external auto-send in the global shortcut service plus Tauri shortcut commands.

**Tech Stack:** React 18, TypeScript, Vitest, Tauri v2, Rust

---

### Task 1: Freeze requirement baseline in tests and docs

**Files:**
- Modify: `tests/unit/settings/settings-input-section.issue199.test.tsx`
- Modify: `tests/unit/config/voice-overlay-preferences.test.ts`
- Create: `tests/unit/config/voice-shortcut-send-mode.test.ts`
- Modify: `tests/unit/pages/VoiceOverlayPage.test.tsx`
- Modify: `tests/unit/services/voice-shortcut.service.test.ts`

**Step 1: Write the failing tests**

- Add settings assertions for:
  - separate chat/external send row
  - diagnostics switch
  - transcript line control
  - overlay position control
- Add config tests for new chat/external send preference
- Add overlay tests for diagnostics hidden/default and configurable line count
- Add shortcut service tests for `auto enter send`

**Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run tests/unit/settings/settings-input-section.issue199.test.tsx tests/unit/config/voice-overlay-preferences.test.ts tests/unit/config/voice-shortcut-send-mode.test.ts tests/unit/pages/VoiceOverlayPage.test.tsx tests/unit/services/voice-shortcut.service.test.ts
```

Expected:

- FAIL because new settings/config behavior does not exist yet.

**Step 3: Write minimal implementation**

- Add new config modules / config state only as needed to satisfy tests.

**Step 4: Run tests to verify they pass**

Run the same command and confirm green.

**Step 5: Commit**

```bash
git add docs/plans/2026-03-11-voice-input-experience-design.md docs/plans/2026-03-11-voice-input-experience-implementation-plan.md tests/unit/settings/settings-input-section.issue199.test.tsx tests/unit/config/voice-overlay-preferences.test.ts tests/unit/config/voice-shortcut-send-mode.test.ts tests/unit/pages/VoiceOverlayPage.test.tsx tests/unit/services/voice-shortcut.service.test.ts
git commit -m "test: freeze voice input experience requirements"
```

### Task 2: Add new preference modules and settings UI

**Files:**
- Create: `src/config/voice-shortcut-send-mode.ts`
- Modify: `src/config/voice-overlay-preferences.ts`
- Modify: `src/ui/app/pages/SettingsPage.tsx`
- Modify: `tests/unit/components/settings/setup-settings-mocks.tsx`
- Modify: `tests/unit/settings/settings-input-section.issue199.test.tsx`
- Modify: `tests/unit/config/voice-overlay-preferences.test.ts`
- Create: `tests/unit/config/voice-shortcut-send-mode.test.ts`

**Step 1: Write the failing test**

- Extend tests to assert exact defaults, labels, and updates.

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/settings/settings-input-section.issue199.test.tsx tests/unit/config/voice-overlay-preferences.test.ts tests/unit/config/voice-shortcut-send-mode.test.ts
```

**Step 3: Write minimal implementation**

- Add chat/external send preference storage
- Extend overlay preferences with:
  - diagnostics toggle
  - transcript lines
  - bottom offset
- Surface controls in both settings layouts

**Step 4: Run tests to verify it passes**

```bash
npx vitest run tests/unit/settings/settings-input-section.issue199.test.tsx tests/unit/config/voice-overlay-preferences.test.ts tests/unit/config/voice-shortcut-send-mode.test.ts
```

**Step 5: Commit**

```bash
git add src/config/voice-shortcut-send-mode.ts src/config/voice-overlay-preferences.ts src/ui/app/pages/SettingsPage.tsx tests/unit/components/settings/setup-settings-mocks.tsx tests/unit/settings/settings-input-section.issue199.test.tsx tests/unit/config/voice-overlay-preferences.test.ts tests/unit/config/voice-shortcut-send-mode.test.ts
git commit -m "feat: add voice send and overlay preferences"
```

### Task 3: Apply overlay display preferences

**Files:**
- Modify: `src/pages/VoiceOverlayPage.tsx`
- Modify: `tests/unit/pages/VoiceOverlayPage.test.tsx`

**Step 1: Write the failing test**

- Assert diagnostics visibility follows preference
- Assert transcript area line count follows preference

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/pages/VoiceOverlayPage.test.tsx
```

**Step 3: Write minimal implementation**

- Read new overlay preferences
- Use them to conditionally render diagnostics
- Apply line-count-driven transcript sizing

**Step 4: Run test to verify it passes**

```bash
npx vitest run tests/unit/pages/VoiceOverlayPage.test.tsx
```

**Step 5: Commit**

```bash
git add src/pages/VoiceOverlayPage.tsx tests/unit/pages/VoiceOverlayPage.test.tsx
git commit -m "feat: apply voice overlay display preferences"
```

### Task 4: Apply chat/external auto-send to shortcut flow

**Files:**
- Modify: `src/services/voice-shortcut.service.ts`
- Modify: `src-tauri/src/commands/shortcut_commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `tests/unit/services/voice-shortcut.service.test.ts`

**Step 1: Write the failing test**

- Assert default mode keeps paste-only behavior
- Assert auto-send mode performs `paste + enter`

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/services/voice-shortcut.service.test.ts
```

Expected:

- FAIL because auto-enter-send does not exist.

**Step 3: Write minimal implementation**

- Read chat/external send preference in shortcut service
- Add native command to simulate Enter where needed
- Keep current paste behavior as default

**Step 4: Run test to verify it passes**

```bash
npx vitest run tests/unit/services/voice-shortcut.service.test.ts
```

**Step 5: Commit**

```bash
git add src/services/voice-shortcut.service.ts src-tauri/src/commands/shortcut_commands.rs src-tauri/src/lib.rs tests/unit/services/voice-shortcut.service.test.ts
git commit -m "feat: add auto enter send for external voice input"
```

### Task 5: Apply overlay position preference to native window placement

**Files:**
- Modify: `src/ui/app/pages/SettingsPage.tsx`
- Modify: `src-tauri/src/commands/shortcut_commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `tests/unit/settings/settings-input-section.issue199.test.tsx`
- Modify: `src-tauri/src/commands/shortcut_commands.rs` tests

**Step 1: Write the failing test**

- Assert position calculation respects configurable bottom offset

**Step 2: Run test to verify it fails**

```bash
cargo test shortcut_commands --manifest-path src-tauri/Cargo.toml
```

**Step 3: Write minimal implementation**

- Add runtime command/state for configurable overlay bottom margin
- Reposition existing overlay window after setting change

**Step 4: Run test to verify it passes**

```bash
cargo test shortcut_commands --manifest-path src-tauri/Cargo.toml
```

**Step 5: Commit**

```bash
git add src/ui/app/pages/SettingsPage.tsx src-tauri/src/commands/shortcut_commands.rs src-tauri/src/lib.rs
git commit -m "feat: make voice overlay position configurable"
```

### Task 6: Run verification sweep

**Files:**
- Verify only

**Step 1: Run TypeScript verification**

```bash
npx tsc --noEmit
```

**Step 2: Run targeted unit tests**

```bash
npx vitest run tests/unit/settings/settings-input-section.issue199.test.tsx tests/unit/config/voice-overlay-preferences.test.ts tests/unit/config/voice-shortcut-send-mode.test.ts tests/unit/pages/VoiceOverlayPage.test.tsx tests/unit/services/voice-shortcut.service.test.ts
```

**Step 3: Run Rust tests**

```bash
cargo test shortcut_commands --manifest-path src-tauri/Cargo.toml
```

**Step 4: Review diff and capture evidence**

```bash
git diff --stat
```

**Step 5: Commit**

```bash
git add .
git commit -m "feat: improve voice input experience settings and overlay"
```
