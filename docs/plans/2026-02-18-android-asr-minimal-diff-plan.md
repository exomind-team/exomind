# Android ASR Permission Minimal Diff Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep `dev` release workflow as baseline and only retain issue #143 (Android ASR microphone permission / Android 录音权限) necessary changes with minimal CI risk.

**Architecture:** Use a script-layer patch (`Scripts/dev/tauri.ts` + manifest permission lib) to ensure `android.permission.RECORD_AUDIO` is persisted after Android init/build, while avoiding fragile runtime patching of generated Gradle/Kotlin files in CI. Keep `release.yml` close to `origin/dev`.

**Tech Stack:** Bun, TypeScript, Vitest, GitHub Actions (self-hosted Windows runner / 自托管 Windows Runner)

---

## Precise Change List (精确变更清单)

### Keep (保留)

1. `src/components/VoiceInputButton.tsx`
- Keep Android-specific microphone denial guidance text (`permissionGuide`).

2. `Scripts/dev/android-manifest-permission-lib.ts`
- Keep full manifest patch logic (including multiline `<manifest>` and multiline `INTERNET` block handling).

3. `Scripts/dev/tauri.ts`
- Keep wrapper behavior that patches manifest around Android lifecycle commands.

4. `Scripts/dev/tauri-cli-lib.ts`
- Keep local CLI resolution and Windows fallback logic (`tauri.exe` / `tauri.cmd` / `tauri`).

5. `tests/unit/scripts/android-manifest-permission-lib.test.ts`
- Keep all permission injector tests.

6. `tests/unit/scripts/tauri-cli-lib.test.ts`
- Keep all tauri executable resolution tests.

### Revert (回滚到 `origin/dev`)

1. `package.json`
- Revert `"tauri": "bun Scripts/dev/tauri.ts"` to `"tauri": "tauri"` (avoid changing global tauri invocation semantics / 避免全局 tauri 调用语义变化).
- Revert `version` to `0.2.0`.

2. `.github/workflows/release.yml`
- Revert CI-only fragile edits:
  - `Provide node.bat shim...`
  - `Patch Android BuildTask npm working root...`
  - forced `prerelease: false`
  - removed preview metadata resolver
  - removed signed APK pipeline in favor of raw apk upload
- Keep `origin/dev` structure and signing/release logic.

### Optional / Decision Needed (可选，待决策)

1. `Scripts/dev/android-meta-check-lib.ts`
2. `tests/unit/scripts/android-meta-check-lib.test.ts`
- Current changes are useful but not strictly required for issue #143.
- Recommended: separate PR (`chore(android-meta-check)`) to reduce scope.

3. `logs.zip`
- Do not track or commit.

---

### Task 1: Prepare Minimal-Diff Working State

**Files:**
- Modify: `package.json`
- Modify: `.github/workflows/release.yml`
- Keep unchanged: issue #143 related script/test files listed above

**Step 1: Revert package.json only to dev baseline**

Run:
```powershell
git checkout origin/dev -- package.json
```

Expected:
- `package.json` no longer differs from `origin/dev`.

**Step 2: Restore release workflow to dev baseline**

Run:
```powershell
git checkout origin/dev -- .github/workflows/release.yml
```

Expected:
- CI recovers the known-good preview2 pipeline behavior.

**Step 3: Re-apply only issue #143 minimal CI hook (if needed)**

Recommended minimal hook:
- Use existing `bun tauri android init` / `bun tauri android build ...` from `origin/dev`.
- Add one lightweight verification step after init:
  - `Verify RECORD_AUDIO permission persisted（校验权限已持久化）`.

Expected:
- No generated-file patching in CI.
- Permission persistence is asserted in workflow.

**Step 4: Review diff scope**

Run:
```powershell
git diff --name-status origin/dev...HEAD
```

Expected:
- Only issue #143 feature files + tests remain.
- `release.yml` differences are minimal and explainable.

**Step 5: Commit**

Run:
```powershell
git add package.json .github/workflows/release.yml
git commit -m "ci: restore dev baseline workflow and keep minimal ASR permission checks"
```

Expected:
- One focused commit that shrinks CI blast radius.

---

### Task 2: Validate Script-Level Permission Persistence

**Files:**
- Test: `tests/unit/scripts/android-manifest-permission-lib.test.ts`
- Test: `tests/unit/scripts/tauri-cli-lib.test.ts`

**Step 1: Run unit tests for permission and tauri CLI wrapper**

Run:
```powershell
bun test tests/unit/scripts/android-manifest-permission-lib.test.ts tests/unit/scripts/tauri-cli-lib.test.ts
```

Expected:
- `0 fail`.

**Step 2: Run Android meta check tests (if kept in this branch)**

Run:
```powershell
bun test tests/unit/scripts/android-meta-check-lib.test.ts
```

Expected:
- `0 fail`.

**Step 3: Verify local Android init/build command chain (minimal smoke)**

Run:
```powershell
bun Scripts/dev/tauri.ts android init
bun Scripts/dev/tauri.ts android build --ci --apk --split-per-abi -t aarch64 i686
```

Expected:
- Build completes and outputs release APKs under `src-tauri/gen/android/app/build/outputs/apk/`.

---

### Task 3: Minimal CI Verification (No Extra Workflow Mutation)

**Files:**
- Modify: `.github/workflows/release.yml` (only if Task 1 Step 3 adds verification step)

**Step 1: Push branch**

Run:
```powershell
git push
```

Expected:
- Remote branch updated.

**Step 2: Trigger real build with existing tag rule**

Run:
```powershell
git tag build/v0.2.1-preview9-data-<shortsha>
git push origin build/v0.2.1-preview9-data-<shortsha>
```

Expected:
- `Build & Release` workflow triggered on self-hosted Windows.

**Step 3: Confirm pass/fail evidence**

Run:
```powershell
gh run list --workflow release.yml --limit 5
gh run view <run_id> --json conclusion,jobs
```

Expected:
- `build-android` success.
- No `BuildTask.kt` patch step exists.
- Signed APK artifacts published (same as dev baseline behavior).

---

## Minimal Verification Evidence (当前已完成的最小验证)

Command:
```powershell
bun test tests/unit/scripts/android-manifest-permission-lib.test.ts tests/unit/scripts/tauri-cli-lib.test.ts tests/unit/scripts/android-meta-check-lib.test.ts
```

Result:
- `14 pass`
- `0 fail`

---

## Approach Options (Brainstorming / 头脑风暴方案)

1. **Option A (Recommended): Baseline-first Minimal Diff**
- Restore `release.yml` + `package.json` to `origin/dev`.
- Keep issue #143 script + tests.
- Add only lightweight permission verification in CI.
- Pros: lowest risk, easiest to reason, aligns with preview2 proven flow.
- Cons: wrapper effect in CI is limited unless explicitly called.

2. **Option B: Wrapper-driven CI build**
- Keep `release.yml` using `bun Scripts/dev/tauri.ts android init/build`.
- Avoid any generated-file patching.
- Pros: permission persistence strongly enforced in CI path.
- Cons: diverges from dev baseline and increases behavior surface.

3. **Option C: Full dev workflow parity + app-level only**
- Revert all CI/script chain changes; keep only UI/runtime permission guidance.
- Pros: smallest CI risk.
- Cons: does not guarantee generated manifest persistence after re-init.

---

## Recommendation

Choose **Option A** first. If CI still has permission drift, escalate to **Option B** while still forbidding generated-file patching in workflow.

