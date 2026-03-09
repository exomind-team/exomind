# Discovery Loop

## Inputs

- Current repository open PR list from `gh pr list --state open`
- Existing review comments on each PR
- New comments, reviews, and commits on each PR
- Local discovery state from `./temp/`

## Scan Algorithm

1. Fetch open PRs and sort by `updatedAt` descending.
2. For each PR, find the latest comment whose body starts with `[Codex Reviewer]`.
3. If no such comment exists, mark the PR actionable.
4. If such a comment exists, compare its timestamp with later PR activity.
5. If any later comment, review activity, or commit exists, mark the PR actionable.
6. Otherwise skip the PR.

## Delta Rules

New activity after the latest `[Codex Reviewer]` comment includes:

- top-level PR comments
- review submissions
- review-thread replies
- new commits

Service-noise comments may still trigger a re-check, but they should not force deep re-review if no code delta exists.

## Selection Rules

- Build `actionable_prs` as a queue ordered by PR `updatedAt`.
- Choose the first PR in that queue as `selected_pr`.
- Persist the rest as `pending_queue`.
- If the queue is empty, output `NO_TARGET`.

## Failure Handling

- If one PR lookup fails, skip that PR and continue.
- If the entire round fails to inspect any PRs meaningfully, increment `failure_streak`.
- On three consecutive fully failed rounds, sleep for 300 seconds and keep the failure record.
- Any successful round resets `failure_streak` to zero.

## Backoff Policy

- Base sleep: 180 seconds
- If consecutive rounds find no changes, double the sleep duration
- Maximum sleep: 1800 seconds
- If any new actionable PR appears, reset sleep back to 180 seconds

## Output State

Every discovery round should produce:

- `state`: `HAS_TARGET` or `NO_TARGET`
- `actionable_prs`
- `selected_pr`
- `pending_queue`
- `failure_streak`
- `next_sleep_seconds`

## Worked Examples

### Example 1

- PR has no `[Codex Reviewer]` comment
- Result: actionable

### Example 2

- PR has a `[Codex Reviewer]` comment from yesterday
- PR receives a new commit today
- Result: actionable

### Example 3

- PR has a `[Codex Reviewer]` comment
- No later comments, reviews, or commits
- Result: skipped
