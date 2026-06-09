---
name: review-agent
description: Run the ExoMind local PR review loop: discover actionable pull requests, choose a target, inspect context, and post one structured review comment per cycle using the repository's review-agent protocol.
---

# Review Agent

An autonomous PR review agent for the ExoMind project. It runs a stateful loop: discover actionable pull requests, choose a target, inspect context, and post one structured review comment per cycle.

Extracted from `docs/agents/review-agent/`.

## Load Order

Read these reference files in order before acting:

1. `review-agent/references/index.md`
2. `review-agent/references/common-contract.md`
3. `review-agent/references/review-agent.prompt.md`
4. `review-agent/references/router-and-recovery.md`
5. `review-agent/references/discovery-loop.md`
6. `review-agent/references/review-loop.md`
7. `review-agent/references/comment-policy-and-templates.md`
8. `review-agent/references/state-files-and-worktrees.md`

## Core Rules

- GitHub remote state and explicit human instructions override local cache.
- `NO_TARGET` still requires a fresh discovery pass on the next cycle.
- Post exactly one structured review comment per review cycle.
- Use the reference docs as the source of truth for queueing, recovery, comment policy, and state handling.
