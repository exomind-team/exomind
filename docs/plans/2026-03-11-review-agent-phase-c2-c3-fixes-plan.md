# Review Agent Phase C2/C3 Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the remaining merge-path blockers and codify reviewer/worker role semantics so the review-agent can independently close PRs when gates pass.

**Architecture:** C2 fixes the action/runtime layer so merge decisions rely on GitHub merge results rather than unsupported preflight fields, and pass-comment validation accepts both Chinese and English gate templates. C3 fixes the protocol semantics so same-account worker/reviewer flows are modeled as different execution actors, with formal GitHub approve treated as best-effort compatibility rather than the source of truth.

**Tech Stack:** TypeScript, Vitest, gh CLI-backed review-agent scripts, Markdown docs/prompts.

---

### Task 1: Lock failing tests for C2 merge preflight and bilingual gate

**Files:**
- Modify: `tests/unit/review-agent/review-loop.test.ts`
- Modify: `agents/review-agent/scripts/review-loop-lib.ts`
- Modify: `agents/review-agent/scripts/review-loop-runtime-lib.ts`

**Step 1: Write the failing tests**
- Replace the `viewerCanMerge`-specific tests with tests that require merge mode to avoid requesting unsupported `viewerCanMerge` JSON.
- Add merge-comment validation cases for English `Conclusion:/Gate:/Evidence:` and `local verification=` lines.
- Add inherited-failure marker validation for an English pass comment.

**Step 2: Run the focused test file to verify it fails**
Run: `npx vitest run tests/unit/review-agent/review-loop.test.ts`
Expected: failures around merge JSON fields and English gate validation.

**Step 3: Implement the minimal C2 code**
- Stop requesting or consuming `viewerCanMerge`.
- Let real `gh pr merge --squash` errors drive blocked vs retryable classification.
- Accept bilingual pass-comment section headers and gate keys.

**Step 4: Run the focused test file to verify it passes**
Run: `npx vitest run tests/unit/review-agent/review-loop.test.ts`
Expected: all updated tests pass.

### Task 2: Lock failing tests for C3 actor-role semantics and truthful merge output

**Files:**
- Modify: `tests/unit/review-agent/review-loop.test.ts`
- Modify: `agents/review-agent/scripts/review-loop-runtime-lib.ts`
- Modify: `agents/review-agent/scripts/review-loop.ts`

**Step 1: Write the failing tests**
- Add a merge-path test proving an `approve` failure does not claim a successful formal review decision.
- Add or adjust expectations so merge output distinguishes formal-approve result from merge completion.

**Step 2: Run the focused test file to verify it fails**
Run: `npx vitest run tests/unit/review-agent/review-loop.test.ts`
Expected: failures around merge result metadata.

**Step 3: Implement the minimal C3 code**
- Separate approval-equivalent gate success from formal GitHub review success.
- Make merge-path outputs truthful when best-effort `approve` fails.
- Keep explicit `--approve` for compatibility, but do not let merge semantics imply an external user is required.

**Step 4: Run the focused test file to verify it passes**
Run: `npx vitest run tests/unit/review-agent/review-loop.test.ts`
Expected: all updated tests pass.

### Task 3: Update prompt/docs to match the new semantics

**Files:**
- Modify: `docs/agents/review-agent/review-agent.prompt.md`
- Modify: `docs/agents/review-agent/common-contract.md`
- Modify: `docs/agents/review-agent/review-loop.md`
- Modify: `docs/agents/review-agent/comment-policy-and-templates.md`
- Modify: `docs/agents/review-agent/index.md`

**Step 1: Update the protocol text**
- Remove `viewerCanMerge=false` preflight language.
- Document bilingual pass-comment gates.
- Document the actor model: same GitHub account may still represent distinct Worker/Reviewer agents.
- Document that formal `approve` is a compatibility attempt, not merge truth.

**Step 2: Run targeted tests and scripts**
Run:
- `npx vitest run tests/unit/review-agent/review-loop.test.ts tests/unit/review-agent/router.test.ts tests/unit/review-agent/discovery.test.ts`
- `npx tsx agents/review-agent/scripts/router.ts`
- `npx tsx agents/review-agent/scripts/review-loop.ts --pr 465`
Expected: tests pass and script output remains valid.

### Task 4: Final verification, commit, push, and PR sync

**Files:**
- Modify: `docs/plans/2026-03-11-review-agent-phase-c2-c3-fixes-plan.md`
- Update remote discussion on `#465`

**Step 1: Run final verification**
Run:
- `npx vitest run tests/unit/review-agent`
- `npx tsc --noEmit --pretty false`
Expected: unit tests pass; `tsc` may still show only pre-existing unrelated failures if unchanged.

**Step 2: Commit and push**
Run:
- `git -C temp/worktrees/pr-465 status --short`
- `git -C temp/worktrees/pr-465 add <changed files>`
- `git -C temp/worktrees/pr-465 commit -m "fix(review-agent): close remaining merge path gaps"`
- `git -C temp/worktrees/pr-465 push origin HEAD:docs/issue-450-review-agent-docs`

**Step 3: Sync PR progress**
- Post a PR #465 progress comment summarizing C2/C3 changes and test evidence.
- If needed, update the PR description so the new actor-role semantics are visible in the acceptance scope.
