# Self-Hosted Bun Install Stabilization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stabilize `bun install --frozen-lockfile` on the self-hosted Windows runner by clearing global Bun cache, isolating install cache, and adding safe retry fallback.

**Architecture:** Add a deterministic install pipeline in `.github/workflows/release.yml` for `build-apk-exe-selfhosted`. The pipeline uses three guards: global cache cleanup（全局缓存清理）, isolated cache directory（隔离缓存目录）, and retry install（重试安装）. Verification is test-first with workflow-guard tests plus local smoke E2E.

**Tech Stack:** GitHub Actions YAML, Bun 1.3.8, Vitest, Playwright, PowerShell（Windows Shell）

---

### Task 1: Plan + PR bootstrap（计划与 PR 初始化）

**Files:**
- Create: `docs/plans/2026-03-04-ci-bun-install-selfhosted-stabilization.md`
- Create: `docs/pr/2026-03-04-ci-bun-install-plan-comment.md`

**Step 1: Write plan and PR comment markdown**

- Include problem statement, root-cause evidence, acceptance criteria, and TDD workflow.

**Step 2: Commit**

Run:
```bash
git add docs/plans/2026-03-04-ci-bun-install-selfhosted-stabilization.md docs/pr/2026-03-04-ci-bun-install-plan-comment.md
git commit -m "docs(plan): add self-hosted bun install stabilization plan"
```

**Step 3: Create or link PR**

Run:
```bash
git push -u origin vk/a2af-fix-ci-bun-insta
gh pr create --base dev --head vk/a2af-fix-ci-bun-insta --draft --title "fix(ci): stabilize self-hosted bun install with cache isolation" --body-file docs/pr/2026-03-04-ci-bun-install-plan-comment.md
```

**Step 4: Post plan comment**

Run:
```bash
gh pr comment --body-file docs/pr/2026-03-04-ci-bun-install-plan-comment.md
```

### Task 2: RED - add failing workflow guard test（先失败测试）

**Files:**
- Create: `tests/ci/release-selfhosted-bun-install.test.ts`
- Modify: `package.json`

**Step 1: Write failing test**

- Assert workflow self-hosted job contains:
  - `Clear bun global cache (清理 bun 全局缓存)` step
  - isolated cache usage (`--cache-dir` or `BUN_INSTALL_CACHE_DIR`)
  - retry/fallback install flow (`try/catch` + second install attempt)

**Step 2: Run test to verify RED**

Run:
```bash
bun vitest run tests/ci/release-selfhosted-bun-install.test.ts
```

Expected:
- FAIL, because workflow does not yet include all required guards.

**Step 3: Commit RED**

Run:
```bash
git add tests/ci/release-selfhosted-bun-install.test.ts package.json
git commit -m "test(ci): add failing guard test for self-hosted bun install hardening"
```

### Task 3: GREEN - implement workflow hardening（最小实现）

**Files:**
- Modify: `.github/workflows/release.yml`

**Step 1: Add global Bun cache cleanup**

- Use PowerShell to remove stale lock files and cache directory safely:
  - `bun pm cache rm` (best effort)
  - remove `$env:USERPROFILE\.bun\install\cache` (best effort)

**Step 2: Add isolated cache directory**

- Set `$bunCacheDir = Join-Path $env:RUNNER_TEMP "bun-install-cache"` and pass to install command with `--cache-dir`.

**Step 3: Add retry install flow**

- First install uses isolated cache.
- On failure/exception, remove isolated cache and retry once with a fresh directory.

**Step 4: Verify GREEN**

Run:
```bash
bun vitest run tests/ci/release-selfhosted-bun-install.test.ts
```

Expected:
- PASS.

**Step 5: Commit GREEN**

Run:
```bash
git add .github/workflows/release.yml
git commit -m "ci: harden self-hosted bun install with cache purge and isolated retry"
```

### Task 4: Verification（验证）

**Files:**
- Modify: `docs/pr/2026-03-04-ci-bun-install-progress-comment.md` (optional, if persisted)

**Step 1: Run focused unit verification**

Run:
```bash
bun vitest run tests/ci/release-selfhosted-bun-install.test.ts
```

**Step 2: Run Playwright smoke verification**

Run:
```bash
bun run test:e2e:issue120
```

**Step 3: Run build gate**

Run:
```bash
bun run build
```

**Step 4: Commit verification docs if needed**

Run:
```bash
git add docs/pr/2026-03-04-ci-bun-install-progress-comment.md
git commit -m "docs(pr): add ci stabilization verification evidence"
```

### Task 5: PR description + review（PR 描述与评审）

**Files:**
- Create: `docs/pr/2026-03-04-ci-bun-install-pr-body.md`
- Create: `docs/pr/2026-03-04-ci-bun-install-review-comment.md`

**Step 1: Update PR description**

Run:
```bash
gh pr edit --body-file docs/pr/2026-03-04-ci-bun-install-pr-body.md
```

**Step 2: Post review summary comment**

Run:
```bash
gh pr comment --body-file docs/pr/2026-03-04-ci-bun-install-review-comment.md
```

**Step 3: Trigger 3 workflow runs (workflow_dispatch)**

Run:
```bash
gh workflow run "Build & Release" -f build_scope=windows
gh workflow run "Build & Release" -f build_scope=windows
gh workflow run "Build & Release" -f build_scope=windows
```

**Step 4: Collect results and post final acceptance comment**

- Each run should pass `Install dependencies (安装依赖)` within target duration.
- Add run URLs and elapsed time to PR final comment.

---

## Acceptance Checklist（验收清单）

- [ ] `bun install` step is no longer hanging in self-hosted job.
- [ ] `release.yml` includes global cache cleanup + isolated cache + retry fallback.
- [ ] Local RED/GREEN test evidence is present.
- [ ] Playwright smoke test passes locally.
- [ ] `bun run build` passes locally.
- [ ] PR contains plan/progress/review comments.
- [ ] Three consecutive workflow runs complete without install hang.
