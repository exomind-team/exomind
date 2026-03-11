# Review Agent Post-B2 Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the remaining merge-path blockers after Phase B2, make merge comment validation bilingual, and close the remaining live-trial evidence gap without reintroducing local-truth behavior.

**Architecture:** Keep GitHub remote state as the first truth source. For merge, stop precomputing authority from unsupported local/CLI fields and instead let the real `gh pr merge` result be the authoritative signal, then classify the failure into `MERGE_BLOCKED` or retryable failure. For pass comments, parse bilingual gate markers from the published main comment so comment-as-approval works on both Chinese and English PRs.

**Tech Stack:** TypeScript, `gh` CLI, Vitest, review-agent router/discovery/review-loop scripts

---

### Task 1: Remove `viewerCanMerge` as a merge preflight gate

**Files:**
- Modify: `Scripts/review-agent/review-loop-lib.ts`
- Modify: `Scripts/review-agent/review-loop.ts`
- Modify: `Scripts/review-agent/review-loop-runtime-lib.ts`
- Test: `tests/unit/review-agent/review-loop.test.ts`
- Docs: `docs/agents/review-agent/review-loop.md`

**Step 1: Write the failing tests**
- Replace the current expectation that merge mode requests `viewerCanMerge`.
- Add/adjust tests to assert:
  - merge mode does not request `viewerCanMerge`
  - merge mode still posts/updates the main comment first
  - merge rejection from `gh pr merge` is classified from the merge command error itself

**Step 2: Run tests to verify they fail**
- Run: `npx vitest run tests/unit/review-agent/review-loop.test.ts`
- Expected: existing merge-field test fails because current code still asks for `viewerCanMerge`

**Step 3: Write the minimal implementation**
- Remove `viewerCanMerge` from `buildPullRequestActionJsonFields()`.
- Remove `viewerCanMerge` from `PullRequestActionView` and `ExecuteReviewActionInput` unless still needed by tests.
- In merge mode, always rely on:
  - gate check result
  - published/re-read main comment
  - real `gh pr merge --squash` result
- Keep `classifyMergeFailure()` as the block/retry split point, and expand patterns only if test evidence requires it.

**Step 4: Run tests to verify they pass**
- Run: `npx vitest run tests/unit/review-agent/review-loop.test.ts`
- Expected: PASS

**Step 5: Update docs**
- In `docs/agents/review-agent/review-loop.md`, state that merge authority is determined by the real merge attempt / GitHub response, not by a cached or unsupported preflight field.

**Step 6: Commit**
- Commit message: `fix(review-agent): drop viewerCanMerge preflight`

### Task 2: Make merge-gate comment validation bilingual

**Files:**
- Modify: `Scripts/review-agent/review-loop-lib.ts`
- Test: `tests/unit/review-agent/review-loop.test.ts`
- Docs: `docs/agents/review-agent/comment-policy-and-templates.md`
- Docs: `docs/agents/review-agent/review-agent.prompt.md`

**Step 1: Write the failing tests**
- Add tests that an English pass comment is valid in merge mode, for example:
  - `Conclusion: pass`
  - `Gate: CI=passed local verification=passed`
  - `Evidence: npx vitest run ...`
- Add tests for inherited failure wording in both Chinese and English.

**Step 2: Run tests to verify they fail**
- Run: `npx vitest run tests/unit/review-agent/review-loop.test.ts`
- Expected: English merge-gate validation fails under the current Chinese-only parser

**Step 3: Write the minimal implementation**
- Refactor merge gate parsing into a small parser that accepts either:
  - `结论:` / `门禁:` / `证据:`
  - `Conclusion:` / `Gate:` / `Evidence:`
- Accept either local verification marker:
  - `本地验证=`
  - `local verification=`
- Accept inherited-failure explanation in either language; do not require a Chinese-only marker on English PRs.
- Keep the rest of the validation strict:
  - all three gate sections required
  - `CI=` required
  - local verification status required

**Step 4: Run tests to verify they pass**
- Run: `npx vitest run tests/unit/review-agent/review-loop.test.ts`
- Expected: PASS

**Step 5: Update docs and templates**
- In `docs/agents/review-agent/comment-policy-and-templates.md`, add bilingual pass-comment templates.
- In `docs/agents/review-agent/review-agent.prompt.md`, explicitly say merge/pass comments may use Chinese or English gate markers depending on PR language.

**Step 6: Commit**
- Commit message: `fix(review-agent): accept bilingual merge gates`

### Task 3: Re-verify merge blocked vs retryable behavior after the preflight removal

**Files:**
- Modify: `Scripts/review-agent/review-loop-runtime-lib.ts`
- Test: `tests/unit/review-agent/review-loop.test.ts`
- Docs: `docs/agents/review-agent/review-loop.md`

**Step 1: Write the failing tests**
- Add tests for representative merge errors:
  - permission / protected branch -> `MERGE_BLOCKED`
  - merge conflict / branch out of date -> `MERGE_BLOCKED` with sync note
  - transient CLI/network failure -> `FAILED_RETRYABLE`
- Assert that approve failure remains non-blocking for merge, as already intended.

**Step 2: Run tests to verify they fail**
- Run: `npx vitest run tests/unit/review-agent/review-loop.test.ts`
- Expected: at least one new merge classification test fails until patterns / flow are aligned

**Step 3: Write the minimal implementation**
- Tighten `classifyMergeFailure()` only where tests show ambiguity.
- Keep merge-blocked as a terminal state that returns control to discovery.
- Keep retryable merge failures on the same PR context with `FAILED_RETRYABLE` + `nextAction=review`.

**Step 4: Run tests to verify they pass**
- Run: `npx vitest run tests/unit/review-agent/review-loop.test.ts`
- Expected: PASS

**Step 5: Update docs**
- In `docs/agents/review-agent/review-loop.md`, document the exact split:
  - permission/protection/conflict => `MERGE_BLOCKED`
  - transient failures => retry review

**Step 6: Commit**
- Commit message: `test(review-agent): cover merge failure classification`

### Task 4: Run the focused verification set and smoke the scripts

**Files:**
- No code changes required unless verification finds a gap

**Step 1: Run unit tests**
- Run: `npx vitest run tests/unit/review-agent/review-loop.test.ts tests/unit/review-agent/router.test.ts tests/unit/review-agent/discovery.test.ts`
- Expected: PASS

**Step 2: Run the review-loop summary smoke**
- Run: `npx tsx Scripts/review-agent/review-loop.ts --pr 465`
- Expected: JSON summary output succeeds

**Step 3: Run the router smoke**
- Run: `npx tsx Scripts/review-agent/router.ts`
- Expected: JSON output succeeds

**Step 4: Record any pre-existing unrelated failures**
- Run: `npx tsc --noEmit --pretty false`
- Expected: if it still fails, failures should remain limited to unrelated pre-existing repo typing errors

### Task 5: Close the remaining Stage A evidence gap with a pure thread-reply live trial

**Files:**
- Modify: `docs/agents/review-agent/discovery-loop.md`
- Modify: `docs/agents/review-agent/index.md`
- Optional note: PR #465 comment thread

**Step 1: Document the exact live-trial procedure**
- Add a minimal runbook for a pure thread-reply-only wake-up case:
  - baseline `router` / `discovery`
  - add only a review thread reply on a target PR
  - rerun `router` / `discovery`
  - capture actionable selection / `latestThreadReplyAt`

**Step 2: Execute the live trial outside the unit-test loop**
- Run the documented commands against the real PR state
- Capture command outputs and GitHub timestamps in the PR comment

**Step 3: Do not mix the evidence task with the merge bugfix commits**
- Keep this as verification evidence, not product logic

### Task 6: Separate the next design track for `#479`

**Files:**
- Create or update a plan/comment only if needed

**Step 1: Split design scope from bugfix scope**
- Explicitly keep these out of the immediate patch set:
  - same-account self-approve semantics
  - multi-identity compatibility policy
  - who is allowed to finalize merge vs who only comments

**Step 2: Open the follow-up design thread**
- Track `#479` as the next design/implementation batch after the current merge-path blockers are removed.

