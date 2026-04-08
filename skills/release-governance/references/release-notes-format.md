# Release Notes Format

Preview release notes should stay deterministic and human-readable.

## Current Structure

1. `Release Scope / 发布范围`
   - tag
   - version
   - previous tag
   - compare link
   - PR / direct commit counts
2. `What Changed / 本次变化`
   - grouped by `feat/fix/refactor/docs/chore`
3. `Change Sources / 变更来源`
   - merged PRs
   - direct commits
4. `Downloads / 下载产物`
   - app artifacts
   - runtime artifacts

## Governance Rules

- Prefer short functional phrasing in highlights; strip conventional commit prefixes when rendering summaries.
- PRs are primary evidence when present.
- Commits without merged PRs must still be listed explicitly.
- Artifact section should be grouped by app vs runtime, not a flat raw manifest dump.
- `CHANGELOG.md` is not updated for preview notes.
