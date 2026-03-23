# Voice Overlay Soft Floating Card Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a soft floating card treatment and subtle edge-breath audio feedback to the voice overlay while keeping transcript text as the primary focus.

**Architecture:** Extend the overlay payload with audio level data, feed that from the voice shortcut runtime during recording, and use CSS custom properties on the overlay card to drive border / halo / shadow intensity. Keep the structural layout stable and increase transcript emphasis primarily through typography changes in recording and recognizing states.

**Tech Stack:** React 18, TypeScript, Vitest, Tauri frontend runtime

---

### Task 1: Freeze overlay visual requirements in tests

**Files:**
- Modify: `tests/unit/pages/VoiceOverlayPage.test.tsx`
- Modify: `tests/unit/services/voice-shortcut.service.test.ts`

**Step 1: Write the failing test**

- Add assertions for:
  - stronger floating-card border / shadow styling
  - larger transcript typography in recording / recognizing states
  - audio-level-driven overlay style variables
  - voice shortcut service emitting `audioLevel` during Volcano recording

**Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run tests/unit/pages/VoiceOverlayPage.test.tsx tests/unit/services/voice-shortcut.service.test.ts
```

Expected:

- FAIL because the overlay has no audio-reactive edge-breath styling yet.

**Step 3: Write minimal implementation**

- Add only the smallest payload / style changes needed.

**Step 4: Run test to verify it passes**

```bash
npx vitest run tests/unit/pages/VoiceOverlayPage.test.tsx tests/unit/services/voice-shortcut.service.test.ts
```

**Step 5: Commit**

```bash
git add tests/unit/pages/VoiceOverlayPage.test.tsx tests/unit/services/voice-shortcut.service.test.ts
git commit -m "test: freeze voice overlay floating card requirements"
```

### Task 2: Add audio-level data to the overlay runtime payload

**Files:**
- Modify: `src/lib/asr/volcano-streaming-capture.ts`
- Modify: `src/services/voice-shortcut.service.ts`
- Modify: `tests/unit/services/voice-shortcut.service.test.ts`

**Step 1: Write the failing test**

- Assert Volcano streaming level updates are forwarded into `voice-overlay-state`.

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/services/voice-shortcut.service.test.ts
```

**Step 3: Write minimal implementation**

- Add an optional `onLevel` callback in streaming capture.
- Compute a normalized audio level from current samples.
- Emit `audioLevel` only while recording.

**Step 4: Run test to verify it passes**

```bash
npx vitest run tests/unit/services/voice-shortcut.service.test.ts
```

**Step 5: Commit**

```bash
git add src/lib/asr/volcano-streaming-capture.ts src/services/voice-shortcut.service.ts tests/unit/services/voice-shortcut.service.test.ts
git commit -m "feat: feed volcano audio level into voice overlay"
```

### Task 3: Apply soft floating card styling in the overlay page

**Files:**
- Modify: `src/pages/VoiceOverlayPage.tsx`
- Modify: `tests/unit/pages/VoiceOverlayPage.test.tsx`

**Step 1: Write the failing test**

- Assert:
  - border and halo styles exist
  - transcript text is emphasized
  - inline style variables react to `audioLevel`

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/pages/VoiceOverlayPage.test.tsx
```

**Step 3: Write minimal implementation**

- Add CSS custom properties for:
  - edge alpha
  - halo alpha
  - shadow strength
- Increase live transcript text size slightly.
- Keep secondary text visually quieter.

**Step 4: Run test to verify it passes**

```bash
npx vitest run tests/unit/pages/VoiceOverlayPage.test.tsx
```

**Step 5: Commit**

```bash
git add src/pages/VoiceOverlayPage.tsx tests/unit/pages/VoiceOverlayPage.test.tsx
git commit -m "feat: add soft floating card styling to voice overlay"
```

### Task 4: Verification sweep

**Files:**
- Verify only

**Step 1: Run targeted tests**

```bash
npx vitest run tests/unit/lib/voice-recognition-text.test.ts tests/unit/pages/VoiceOverlayPage.test.tsx tests/unit/services/voice-shortcut.service.test.ts tests/unit/settings/settings-input-section.issue199.test.tsx tests/unit/config/voice-overlay-preferences.test.ts tests/unit/config/voice-shortcut-send-mode.test.ts
```

**Step 2: Run TypeScript verification**

```bash
npx tsc --noEmit
```

**Step 3: Review diff**

```bash
git diff --stat
```

**Step 4: Commit**

```bash
git add .
git commit -m "feat: polish voice overlay floating card"
```
