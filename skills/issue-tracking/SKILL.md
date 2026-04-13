---
name: issue-tracking
description: Track ExoMind issues from natural-language user reports by deduplicating, checking current dev state, creating or updating issues, and linking dependencies without asking the user for structured forms.
---

# Issue Tracking

This skill is the project-local skill entry extracted from `docs/agents/issue-tracking/`.

## When To Use

Use this skill when the user asks to:

- 追踪一个问题、需求或回归
- create or update a GitHub issue from a natural-language report
- deduplicate an issue against existing open or closed issues
- attach current dev-state evidence and dependency links to an issue

## Load Order

1. Read `references/charter.md` for the full tracking charter, SOP, template, and validation rules.
2. Read `references/boot-prompt.md` when you need the standard issue-tracking prompt contract.
3. Read `references/portable-charter.md` and `references/portable-boot-prompt.md` only when you need the portable variants.

## Core Rules

- Start from the user's natural-language description; do not ask for form-style structured inputs.
- Always deduplicate before deciding to create or update an issue.
- Always inspect current `dev` implementation state and record file-path evidence.
- Use dependency links and bidirectional references when the charter requires them.
- Normalize issue/comment link formatting before publishing: avoid bare URLs, avoid local absolute paths, and turn repository references into short-named Markdown links.
