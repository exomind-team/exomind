---
name: issue-triage
description: Triage and govern ExoMind GitHub issues by identifying completed, duplicated, stale, or mis-prioritized issues and applying the repository's issue governance rules.
---

# Issue Triage

This skill is the project-local skill entry extracted from `docs/agents/issue-triage/`.

## When To Use

Use this skill when the user asks to:

- clean up the issue pool
- close implemented or superseded issues
- merge overlapping issue tracking
- normalize priorities and issue governance status

## Load Order

1. Read `references/AGENTS.md` for the triage workflow, closure policy, merge rules, and governance principles.
2. Read `references/prompt.md` if you need the original execution prompt wording.

## Core Rules

- Keep evidence-first issue governance: verify against code and merged PRs.
- Leave a reasoned trail when closing or merging issue tracking.
- Apply repository priority rules instead of ad hoc cleanup.
