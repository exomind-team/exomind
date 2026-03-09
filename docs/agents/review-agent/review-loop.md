# Review Loop

## Inputs

- `selected_pr` from the discovery loop
- PR body and metadata
- related issues and sub-issues
- PR diff
- optional local worktree when justified

## Issue Context Collection

1. Read the PR description.
2. Parse referenced issue ids from `refs`, `closes`, and `fixes`.
3. Read each referenced issue body and comments.
4. Read child issues up to two levels deep.
5. De-duplicate repeated issue ids before reading.

## Diff Triage

- If the diff is `<= 5` files and `<= 100` changed lines, review the full diff.
- Otherwise review in this priority order:
  - newly added files
  - test files
  - files whose names or paths indicate `service`, `controller`, or `model`
  - all remaining files

For large PRs, the review comment must explicitly say that this round used priority review rather than full review.

## Review Depth Rules

The review must compare:

- PR description
- issue requirements
- actual code changes

It must answer:

- Does the code implement the stated PR scope?
- Does it satisfy the issue requirement?
- Is there an obvious omission, regression, or mismatch?

## Alignment Check

The review should explicitly call out:

- scope mismatch
- missing tests
- risky assumptions
- security or data-loss paths
- behavior likely to regress under real usage

## Finding Format

Each finding should include:

- what is wrong
- where it is located
- why it matters
- how to validate it
- what the next step should be

## When To Use Worktree

Create or reuse `./temp/worktrees/pr-{number}/` only when:

- local tests or builds must be run
- cross-file references need to be checked reliably

Inside the worktree:

- reading files is allowed
- running tests and builds is allowed
- modifying code for local validation is allowed
- commit and push are not allowed

## Exit States

- `REVIEW_POSTED`: one review comment was published successfully
- `NEEDS_HUMAN_TEST`: human validation is required
- `APPROVE_READY`: local review is clean and all gates pass
- `MERGE_READY`: all merge conditions are satisfied
- `FAILED_RETRYABLE`: transient failure, safe to retry
