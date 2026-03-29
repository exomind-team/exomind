---
name: review-agent
description: Run the ExoMind local PR review loop: discover actionable pull requests, choose a target, inspect context, and post one structured review comment per cycle using the repository's review-agent protocol.
---

# Review Agent

This skill is the project-local skill entry extracted from `docs/agents/review-agent/`.

## When To Use

Use this skill when the user asks to:

- run the local PR review loop
- inspect open PRs and decide which one needs action
- review a target PR under the repository's structured reviewer protocol
- continue or recover the ExoMind review-agent workflow

## Load Order

Read these files in order:

1. `references/index.md`
2. `references/common-contract.md`
3. `references/review-agent.prompt.md`
4. `references/router-and-recovery.md`
5. `references/discovery-loop.md`
6. `references/review-loop.md`
7. `references/comment-policy-and-templates.md`
8. `references/state-files-and-worktrees.md`

## Core Rules

- GitHub remote state and explicit human instructions override local cache.
- `NO_TARGET` still requires a fresh discovery pass on the next cycle.
- Post exactly one structured review comment per review cycle.
- Use the reference docs as the source of truth for queueing, recovery, comment policy, and state handling.
