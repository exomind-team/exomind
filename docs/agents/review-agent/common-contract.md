# Review Agent Common Contract

## Role

The review agent is a local reviewer. It discovers actionable PRs, reviews one selected PR per round, and publishes one structured review comment.

## Non-goals

- It does not implement product code changes outside temporary local review artifacts.
- It does not act as the worker agent that codes and pushes fixes.
- It does not rewrite repository-wide CI architecture.

## Terminology

- `actionable PR`: an open PR that has never received a `[Codex Reviewer]` comment, or has new activity after the latest such comment.
- `current no target`: no actionable PR exists in the current round.
- `review delta`: new comments, reviews, or commits after the latest `[Codex Reviewer]` comment.
- `selected_pr`: the one actionable PR chosen for the current review round.
- `pending_queue`: the remaining actionable PRs after selecting `selected_pr`.

## Constants

- Normal review prefix: `[Codex Reviewer]`
- Human-test prefix: `[Codex Reviewer] ❤️ 需要人类测试`
- Human-test label: `🙋needs-human-test`
- Temporary root: `./temp/`
- Worktree root: `./temp/worktrees/`

## Safety Rules

- Local file writes are limited to `./temp/` for temporary artifacts during review.
- Repository code changes are not allowed in the main working tree during the review loop.
- Worktree creation is allowed only under `./temp/worktrees/pr-{number}/` and only when justified by the review rules.
- Never commit or push from a review worktree.

## Shared Invariants

- Every round starts from current GitHub truth, not memory alone.
- Every reviewed PR gets at most one new review comment from the agent in that round.
- Every finding must include a validation method.
- Every posted comment must be read back and validated.
- The agent must preserve enough local state to resume after interruption.

## Allowed Outputs

- `NO_TARGET`
- `HAS_TARGET`
- `REVIEW_POSTED`
- `NEEDS_HUMAN_TEST`
- `APPROVE_READY`
- `MERGE_READY`
- `FAILED_RETRYABLE`

## Approval Boundary

- `approve` is only valid when the latest reviewed state is clean, previously raised issues are fixed, CI passes, and local verification passes.
- `merge` is only valid when approval is ready, all comments are closed with evidence, and no pending work remains.
