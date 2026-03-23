# Review Agent Phase C Prompt Loading Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor the review-agent entry flow from full cold-start preloading to minimal startup contract plus router-driven on-demand references, without changing core discovery/review logic.

**Architecture:** Phase C keeps the existing router/discovery/review state machine intact. The main changes are in documentation layering and a small output-layer contract: each script emits `referencesMustRead` so the Agent knows which detailed protocol docs must be loaded after the current action is known.

**Tech Stack:** Markdown docs, TypeScript CLI scripts, Vitest, `gh` CLI smoke commands

---

### Task 1: Rewrite the entry prompt around minimal startup contract

**Files:**
- Modify: `docs/agents/review-agent/review-agent.prompt.md`
- Reference: `docs/agents/review-agent/router-and-recovery.md`
- Reference: `docs/agents/review-agent/common-contract.md`

**Step 1: Write the failing expectation list**

Document the exact behaviors the new prompt must express:

```text
- cold start reads AGENTS.md plus only the minimal startup contract
- router runs before discovery/review/comment/state docs are loaded
- discovery docs are loaded only when action=discovery
- review docs are loaded only when action=review
- comment policy is loaded only when review actually writes/edits a comment
- state/worktree docs are loaded only when recovery or local verification is needed
```

**Step 2: Verify current prompt still violates the new expectation**

Run:

```bash
sed -n '1,120p' docs/agents/review-agent/review-agent.prompt.md
```

Expected: it still lists `common-contract.md`, `discovery-loop.md`, `review-loop.md`, `comment-policy-and-templates.md`, and `state-files-and-worktrees.md` as cold-start must-read files.

**Step 3: Write the minimal prompt rewrite**

Update the prompt so it says:
- read `AGENTS.md`
- follow the inlined minimal startup contract
- run `npx tsx Scripts/review-agent/router.ts`
- then load detailed protocol docs from `referencesMustRead` or `router.action`

**Step 4: Re-read the prompt to verify the structure**

Run:

```bash
sed -n '1,160p' docs/agents/review-agent/review-agent.prompt.md
```

Expected: the prompt no longer requires full preloading before router.

**Step 5: Commit**

```bash
git add docs/agents/review-agent/review-agent.prompt.md
git commit -m "docs(review-agent): shrink prompt cold-start contract"
```

### Task 2: Re-scope shared docs so phase docs can be loaded on demand

**Files:**
- Modify: `docs/agents/review-agent/common-contract.md`
- Modify: `docs/agents/review-agent/router-and-recovery.md`
- Modify: `docs/agents/review-agent/discovery-loop.md`
- Modify: `docs/agents/review-agent/review-loop.md`
- Modify: `docs/agents/review-agent/comment-policy-and-templates.md`
- Modify: `docs/agents/review-agent/state-files-and-worktrees.md`

**Step 1: Write the failing checklist**

Define the doc-boundary requirements:

```text
- common-contract.md is no longer a cold-start must-read file
- router-and-recovery.md explicitly owns startup/router phase selection
- discovery-loop.md assumes phase is already discovery
- review-loop.md assumes phase is already review
- comment-policy-and-templates.md is action-layer only
- state-files-and-worktrees.md is recovery/verification only
```

**Step 2: Verify at least one current doc still mixes layers**

Run:

```bash
sed -n '1,220p' docs/agents/review-agent/common-contract.md
sed -n '1,220p' docs/agents/review-agent/comment-policy-and-templates.md
```

Expected: current docs still read as general startup material instead of clearly scoped reference layers.

**Step 3: Apply the doc-boundary rewrite**

Make the docs explicit about when they must be read:
- startup
- discovery-only
- review-only
- comment-action only
- recovery/worktree only

**Step 4: Re-read the edited docs**

Run:

```bash
sed -n '1,220p' docs/agents/review-agent/common-contract.md
sed -n '1,220p' docs/agents/review-agent/router-and-recovery.md
sed -n '1,220p' docs/agents/review-agent/comment-policy-and-templates.md
```

Expected: responsibilities are separated and phase loading order is explicit.

**Step 5: Commit**

```bash
git add docs/agents/review-agent/common-contract.md docs/agents/review-agent/router-and-recovery.md docs/agents/review-agent/discovery-loop.md docs/agents/review-agent/review-loop.md docs/agents/review-agent/comment-policy-and-templates.md docs/agents/review-agent/state-files-and-worktrees.md
git commit -m "docs(review-agent): separate startup and phase references"
```

### Task 3: Add `referencesMustRead` to router output without changing routing logic

**Files:**
- Modify: `Scripts/review-agent/router-lib.ts`
- Modify: `Scripts/review-agent/router.ts`
- Test: `tests/unit/review-agent/router.test.ts`

**Step 1: Write the failing tests**

Add assertions that router decisions now include `referencesMustRead`, for example:

```ts
expect(result.referencesMustRead).toEqual([
  'docs/agents/review-agent/discovery-loop.md',
]);
```

and

```ts
expect(result.referencesMustRead).toEqual([
  'docs/agents/review-agent/review-loop.md',
]);
```

**Step 2: Run tests to verify they fail**

Run:

```bash
npx vitest run tests/unit/review-agent/router.test.ts
```

Expected: FAIL because `referencesMustRead` is not present yet.

**Step 3: Write the minimal implementation**

Extend router decision output only:
- `action=discovery` -> `['docs/agents/review-agent/discovery-loop.md']`
- `action=review` -> `['docs/agents/review-agent/review-loop.md']`
- `idle-wait` can return `[]` or a minimal restart reference, but must not change routing behavior

**Step 4: Run tests to verify they pass**

Run:

```bash
npx vitest run tests/unit/review-agent/router.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add Scripts/review-agent/router-lib.ts Scripts/review-agent/router.ts tests/unit/review-agent/router.test.ts
git commit -m "feat(review-agent): emit router must-read references"
```

### Task 4: Add `referencesMustRead` to discovery and review outputs

**Files:**
- Modify: `Scripts/review-agent/discovery.ts`
- Modify: `Scripts/review-agent/review-loop.ts`
- Test: `tests/unit/review-agent/discovery.test.ts`
- Test: `tests/unit/review-agent/review-loop.test.ts`

**Step 1: Write the failing tests**

Add or update tests for pure output helpers / output shapes so that:
- discovery output includes `docs/agents/review-agent/discovery-loop.md`
- review summary output includes `docs/agents/review-agent/review-loop.md`
- review action outputs include `docs/agents/review-agent/review-loop.md`
- review action outputs that publish or validate comments also include `docs/agents/review-agent/comment-policy-and-templates.md`

**Step 2: Run tests to verify they fail**

Run:

```bash
npx vitest run tests/unit/review-agent/discovery.test.ts tests/unit/review-agent/review-loop.test.ts
```

Expected: FAIL because those outputs do not yet include `referencesMustRead`.

**Step 3: Write the minimal implementation**

Add output-only fields in `discovery.ts` and `review-loop.ts`.
Do not change:
- state persistence
- target selection
- review comment resolution
- merge/approve/comment logic

**Step 4: Run tests to verify they pass**

Run:

```bash
npx vitest run tests/unit/review-agent/discovery.test.ts tests/unit/review-agent/review-loop.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add Scripts/review-agent/discovery.ts Scripts/review-agent/review-loop.ts tests/unit/review-agent/discovery.test.ts tests/unit/review-agent/review-loop.test.ts
git commit -m "feat(review-agent): emit phase must-read references"
```

### Task 5: Run focused verification and smoke commands

**Files:**
- No new files unless verification finds a gap

**Step 1: Run the review-agent unit suite**

Run:

```bash
npx vitest run tests/unit/review-agent
```

Expected: PASS

**Step 2: Run router smoke**

Run:

```bash
npx tsx Scripts/review-agent/router.ts
```

Expected: JSON output succeeds and includes `referencesMustRead`.

**Step 3: Run discovery smoke**

Run:

```bash
npx tsx Scripts/review-agent/discovery.ts --limit 20
```

Expected: JSON output succeeds and includes `referencesMustRead`.

**Step 4: Run review-loop summary smoke**

Run:

```bash
npx tsx Scripts/review-agent/review-loop.ts --pr 465
```

Expected: JSON output succeeds and includes `referencesMustRead`.

**Step 5: Run repo-wide type check for evidence**

Run:

```bash
npx tsc --noEmit --pretty false
```

Expected: if it still fails, failures should remain limited to the pre-existing unrelated repo typing problems.

### Task 6: Report, commit final doc updates, and prepare PR sync

**Files:**
- Modify: `docs/plans/2026-03-11-review-agent-phase-c-prompt-loading-design.md`
- Modify: `docs/plans/2026-03-11-review-agent-phase-c-prompt-loading-plan.md`

**Step 1: Record final verification results in the phase C report material**

Capture:
- unit test command and result
- router/discovery/review smoke outputs
- any remaining unrelated `tsc` failures

**Step 2: Prepare PR comment content**

Summarize:
- what changed in phase C
- what did not change
- why phase C improves startup cost and flow correctness over phase B

**Step 3: Commit remaining planning/docs artifacts if needed**

```bash
git add docs/plans/2026-03-11-review-agent-phase-c-prompt-loading-design.md docs/plans/2026-03-11-review-agent-phase-c-prompt-loading-plan.md
git commit -m "docs(review-agent): record phase-c prompt loading design"
```

