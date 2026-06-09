---
name: release-governance
description: Use when publishing an ExoMind preview build or formal release, or when reconciling release automation/docs around GitHub Release notes, Pages metadata, canonical tags, and CHANGELOG governance.
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

## Source Of Truth

When release-related sources disagree, use this priority order:

1. `scripts/dev/release-build.ts` and `scripts/dev/release-version-lib.ts` for local release entrypoints, version alignment, and preflight rules.
2. `.github/workflows/release.yml` for preview build / promote behavior.
3. `.github/workflows/release-pages.yml`, `scripts/dev/sync-release-pages.ts`, and `scripts/dev/release-pages-metadata-lib.ts` for GitHub Pages metadata inclusion rules + deployment flow.
4. `scripts/dev/generate-release-notes.ts` and `scripts/dev/release-notes-lib.ts` for preview note generation.
5. `BUILD.md`, `CLAUDE.md`, old issues/PRs, and historical tags only as background context.

## Core Rules

- Project release policy currently uses `0.x.y` / `v0.x.y`.
- Local release scripts require canonical semver-like versions/tags (`x.y.z` / `vx.y.z`), but the tag-triggered workflow ingress itself is looser (`v*`) and can fail late if someone pushes a malformed tag; do not rely on workflow-side validation as the guardrail.
- Do not reintroduce `build/` or `release/` tag namespaces for new publishing.
- Preferred local entry is `bun run release:build`; `bun run build:tag` is fallback only when a manual tag push is explicitly needed.
- Non-dry-run `release:build` assumes `gh` is installed and authenticated because it shells out to GitHub CLI to locate and watch Actions runs after pushing.
- Preview release is created by pushing a canonical `v0.x.y` tag; formal release is a promotion of the existing tag, not a second tag family.
- Preview release body is generated deterministically from PR / commit / asset data; do not couple LLM calls into the main Action.
- `CHANGELOG.md` is reserved for manually curated formal release history, not daily preview builds and not an automation-managed source of truth.
- GitHub Pages is the public download metadata surface; release assets still come from GitHub Releases.
- Pages channel metadata (`preview/*`, `release/*`) only includes non-draft releases whose canonical tag, manifest presence, and manifest tag/version alignment satisfy `release-pages-metadata-lib.ts`.
- Asset-name mismatches do not necessarily drop the Pages release entry; they can leave the release visible on Pages with a partial or empty `assets` map.
- Pages `timeline.json` is looser than the channel metadata and can still show non-draft canonical or legacy-compatible release tags even when channel metadata is absent.
- Pages release metadata is synced from `dev` / `workflow_run`, not deployed directly from a tag ref.
- Historical `release/...` tags may still appear in timeline-compatible code paths; treat them as legacy compatibility only, never as an active publishing contract.
- If a task edits release automation, verify both release creation and Pages deployment paths.
