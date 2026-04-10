# Release Notes Format

Preview release notes should stay deterministic and human-readable.
They are generated from repository / GitHub metadata, not handwritten in the normal preview path.

## Current Structure

1. `Release Scope / 发布范围`
   - tag
   - version
   - previous tag, if a previous canonical tag exists
   - compare link, if a compare range can be resolved
   - PR / direct commit counts
2. `What Changed / 本次变化`
   - grouped into `Added` / `Fixed` / `Changed` / `Docs` / `Maintenance`
   - `refactor` usually lands in `Changed`
   - `ci` / `build` / `test` / `chore` currently collapse into `Maintenance`
3. `Change Sources / 变更来源`
   - merged PRs
   - direct commits
4. `Downloads / 下载产物`
   - app artifacts
   - runtime artifacts

First canonical release caveat:
- the generator may emit a placeholder previous-tag line instead of a real prior tag
- the compare link may be absent when there is no previous canonical release range

## Governance Rules

- Prefer short functional phrasing in highlights; strip conventional commit prefixes when rendering summaries.
- The current generator path is `scripts/dev/generate-release-notes.ts` + `scripts/dev/release-notes-lib.ts`, and `scripts/dev/sync-release-pages.ts` also parses release bodies for compare/highlight metadata; update this reference doc when either contract changes.
- PRs are primary evidence when present.
- Commits without merged PRs must still be listed explicitly.
- Artifact section should be grouped by app vs runtime, not a flat raw manifest dump.
- Release notes should reflect the current project policy tag range (`v0.x.y` today); do not describe legacy `build/...` or `release/...` tag flows as active behavior.
- If a human edits a release body after generation, keep the compare range and highlight structure machine-readable if you want curated Pages highlights to survive; otherwise Pages sync may fall back to synthesized highlights from compare data instead of failing outright.
- GitHub Pages currently stores at most 5 highlights per release; do not assume every curated bullet will surface there.
- `CHANGELOG.md` is not updated for preview notes.
