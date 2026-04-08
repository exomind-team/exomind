---
name: release-governance
description: Use when publishing an ExoMind preview build or formal release, or when aligning GitHub Release notes, Pages metadata, tag workflow, and CHANGELOG governance.
---

# Release Governance

This skill is the project-local entry for ExoMind release operations.

## When To Use

Use this skill when the user asks to:

- 发布一个 preview build / 预发布版本
- promote 一个正式 release / 正式版
- 调整 GitHub Release、Pages 下载页、版本契约、release notes
- 把正式版本摘要沉淀到 `CHANGELOG.md`

## Load Order

1. Read `references/workflow.md` for the current preview/release contract and execution checklist.
2. Read `references/release-notes-format.md` when the task touches release body structure or note wording.
3. Inspect `.github/workflows/release.yml` and `.github/workflows/release-pages.yml` before changing release automation.

## Core Rules

- Canonical tag only uses `v0.x.y`; do not reintroduce `build/` or `release/` tag namespaces.
- Preview release body is generated deterministically from PR / commit / asset data; do not couple LLM calls into the main Action.
- `CHANGELOG.md` is reserved for formal release history, not daily preview builds.
- GitHub Pages is the public download metadata surface; release assets still come from GitHub Releases.
- If a task edits release automation, verify both release creation and Pages deployment paths.
