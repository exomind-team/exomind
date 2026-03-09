# Review Agent Docs

## Purpose

This document set defines the local review-agent loop that scans open PRs, selects actionable targets, reviews them, and publishes one structured review comment per round.

This doc set is intentionally narrower than the repository-wide PR automation discussion. It is written for the local `gh`-driven review loop and its downstream handoff.

## Scope Boundary

- In scope:
  - discover actionable PRs from open PRs
  - select one PR from the actionable queue
  - collect PR and issue context for review
  - publish one review comment per PR per round
  - maintain local state in `./temp/`
- Out of scope:
  - worker-agent coding flow
  - branch implementation locks
  - repository-wide CI architecture redesign

## Reading Order

Read these files in order:

1. `docs/agents/review-agent/common-contract.md`
2. `docs/agents/review-agent/discovery-loop.md`
3. `docs/agents/review-agent/state-files-and-worktrees.md`
4. `docs/agents/review-agent/review-loop.md`
5. `docs/agents/review-agent/comment-policy-and-templates.md`

## Loop Overview

The review agent runs as a two-stage state machine:

- Stage A `Discovery`: scan open PRs and build an actionable queue.
- Stage B `Review`: read context for the selected PR, perform review, and publish exactly one review comment for that round.

## Flow Preview

```text
┌─────────────────────────────────────────────────────────────────────┐
│                Review Agent Loop (Preview)                         │
└─────────────────────────────────────────────────────────────────────┘

  [Loop Start]
        |
        v
┌─────────────────────────────────────────────────────────────────────┐
│ Load Contracts + State                                             │
│ - read AGENTS.md                                                   │
│ - read review-agent contracts                                      │
│ - read ./temp/ queue / cursor / backoff / selected_pr              │
└─────────────────────────────────────────────────────────────────────┘
        |
        v
┌─────────────────────────────────────────────────────────────────────┐
│ Stage A: Discovery                                                 │
│ - gh pr list --state open (sorted by updatedAt)                    │
│ - for each PR:                                                     │
│   * find last [Codex Reviewer] comment                             │
│   * compare later comments / reviews / commits                     │
│ - build actionable PR queue                                        │
└─────────────────────────────────────────────────────────────────────┘
        |
        +-------------------------------+
        |                               |
        | queue empty                   | queue not empty
        v                               v
┌──────────────────────────────┐   ┌─────────────────────────────────┐
│ No Target                    │   │ Select PR                      │
│ - cleanup merged worktrees   │   │ - choose next actionable PR    │
│ - compute backoff            │   │ - persist selected_pr          │
│ - sleep                      │   │ - persist pending_queue        │
└──────────────────────────────┘   └─────────────────────────────────┘
        |                               |
        |                               v
        |                    ┌──────────────────────────────────────┐
        |                    │ Stage B: Review                      │
        |                    │ - read PR body                       │
        |                    │ - parse refs/closes/fixes            │
        |                    │ - read issue / sub-issue context     │
        |                    │ - inspect diff                       │
        |                    │ - full review or priority review     │
        |                    │ - build findings + validation        │
        |                    └──────────────────────────────────────┘
        |                               |
        |                               v
        |                    ┌──────────────────────────────────────┐
        |                    │ Publish 1 Review Comment             │
        |                    │ - [Codex Reviewer]                   │
        |                    │ - or needs-human-test comment        │
        |                    │ - read back and validate             │
        |                    └──────────────────────────────────────┘
        |                               |
        +-------------------------------+
                                        |
                                        v
                         ┌──────────────────────────────────────────┐
                         │ Persist State + Next Loop                │
                         │ - update cursor / queue / backoff        │
                         │ - cleanup temp files                     │
                         │ - go back to Loop Start                  │
                         └──────────────────────────────────────────┘
```

## State Flow

- `NO_TARGET`: no actionable PRs were found in the current scan.
- `HAS_TARGET`: at least one actionable PR exists and one PR is selected.
- `REVIEW_POSTED`: the selected PR was reviewed and one comment was posted.
- `NEEDS_HUMAN_TEST`: the selected PR needs human verification and the agent should not try to auto-resolve it.
- `FAILED_RETRYABLE`: the current round failed but should be retried later.

## Issue Mapping

- Issue `#450` covers Stage A `Discovery` and the state handoff needed to make it stable.
- Downstream review depth, comment policy, and approval gates are documented here because Stage A must hand off into them cleanly.
