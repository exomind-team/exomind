# State Files And Worktrees

## Directory Layout

Recommended state layout under `./temp/`:

```text
temp/
  pr-monitor/
    state.json
    queue.json
    backoff.json
    cursor.json
    drafts/
  worktrees/
    pr-<number>/
```

## State Schema

### `state.json`

- current loop state
- selected PR number
- last successful round timestamp
- failure streak

### `queue.json`

- ordered `actionable_prs`
- current `pending_queue`

### `backoff.json`

- current sleep seconds
- consecutive no-change rounds

### `cursor.json`

- last handled `[Codex Reviewer]` comment timestamp per PR
- last seen commit SHA per PR
- last handled comment or review id per PR

## Cursor Rules

- Update cursors only after a successful round.
- Do not advance cursors when review publishing fails.
- Keep enough cursor data to avoid duplicate review comments after restart.

## Backoff State

- initialize at 180 seconds
- double on consecutive no-change rounds
- cap at 1800 seconds
- reset to 180 when any actionable PR appears

## Worktree Lifecycle

### Create

Create `./temp/worktrees/pr-{number}/` only when review-loop rules justify it.

### Reuse

Reuse an existing PR worktree when:

- it points to the same PR head context
- it is still readable and usable

### Keep

Keep the worktree after a review round if the PR is still open and more validation may be needed.

### Remove

Remove the worktree only after the PR is merged or clearly obsolete.

## Cleanup Rules

At the end of a review round:

- clean temporary drafts under `./temp/pr-monitor/drafts/` when no longer needed
- preserve queue and cursor state
- preserve relevant PR worktrees

At the end of a no-target round:

- check for merged PR worktrees and remove them
- persist backoff state before sleeping

## Recovery After Restart

On restart:

1. read `state.json`, `queue.json`, `backoff.json`, and `cursor.json`
2. verify the selected PR is still open
3. verify pending queue entries are still open
4. resume from current GitHub truth, not blindly from saved local state
