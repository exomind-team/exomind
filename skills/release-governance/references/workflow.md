# Release Workflow

## Contract

- Project policy version line: `0.x.y`
- Project policy tag line: `v0.x.y`
- Local script validation: canonical semver-like `x.y.z` / `vx.y.z`
- Workflow ingress reality: tag-triggered CI starts on `v*`, so malformed tags can still enter CI and fail later
- Preview distribution: GitHub Release assets + GitHub Pages preview JSON
- Formal release archive (manual governance): `CHANGELOG.md`
- Current source of truth:
  - local release behavior: `scripts/dev/release-build.ts`
  - version alignment: `scripts/dev/release-version-lib.ts`
  - preview/promote CI: `.github/workflows/release.yml`
  - Pages sync/deploy wrapper: `.github/workflows/release-pages.yml` + `scripts/dev/sync-release-pages.ts`
  - Pages metadata contract: `scripts/dev/release-pages-metadata-lib.ts`
- If old repo docs mention `build/**`, `release/**`, or `release/...-preview`, treat them as stale unless the scripts/workflows above still implement them.

## Current CI Topology

1. Push `v0.x.y` tag:
   - starts `Build & Release`
2. If the build jobs and `create-release` job succeed:
   - `Build & Release` creates or updates a GitHub Release as preview (`prerelease: true`)
3. `Build & Release` success:
   - triggers `Sync Release Pages` via `workflow_run`
   - refreshes `website/public/releases/**`
   - rebuilds and deploys GitHub Pages from `dev`
   - note: in the default `release:build` path, the version-bump commit is pushed to `dev` before the tag is pushed, so an earlier `Sync Release Pages` run may also happen from the `push` trigger before the release-tag workflow completes
4. Promote existing tag:
   - preferred path: use `workflow_dispatch` input `promote_tag`
   - this updates the existing GitHub Release to `prerelease: false`
   - this also applies the scripted side effects (`make_latest`, release title normalization) on the same canonical tag
   - GitHub UI-only promotion is manual fallback only; if used, manually run `Sync Release Pages` afterwards and re-verify Pages metadata because UI changes do not automatically guarantee the scripted side effects or Pages refresh path

GitHub Releases remain the download asset source.
GitHub Pages remains the public metadata / channel surface.
Pages channel metadata is gated by release metadata rules, not by GitHub Release existence alone.
Pages timeline output is looser and may still show non-draft canonical or legacy-compatible tags even when channel metadata is absent.

## Preview Build

1. Decide the release path before touching version files:
   - default `bump+tag`: do not pre-bump local version files; keep `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` aligned with the latest released version so `release:build` can bump them itself
   - manual/tag-prepared path: only pre-align those files yourself when you intentionally plan to use `--tag-only` or another manual fallback
2. Preferred local entry:

```bash
bun run release:build --dry-run
bun run release:build
```

   Practical prerequisite:
   - install and authenticate GitHub CLI (`gh`), because the non-dry-run path uses `gh run list` / `gh run watch` after pushing the tag.

   Default mode is `bump+tag`:
   - treat the latest canonical `v0.x.y` tag on `origin` as the only version truth source
   - require current branch to be `dev`
   - require a clean worktree before mutating version files
   - require local `dev` HEAD and local version files to already match the latest remote `dev` commit
   - require the latest remote `dev` commit to be untagged
   - require the latest remote `dev` commit to still carry the latest released version number
   - bump local canonical version files
   - run the default local checks: `bun x tsc --noEmit` + `bun run website:build`
   - commit and push the version bump to `dev`
   - tag the latest remote `dev` commit and wait for `Build & Release` to finish

   If the latest remote `dev` commit is already tagged, the script exits early as a no-op.
   If the latest remote `dev` commit is already version-bumped beyond the latest remote tag,
   the script will refuse to bump again and tell the caller to use `--tag-only`.

   Tag-only mode is allowed when the latest remote `dev` commit has already been prepared manually:

```bash
bun run release:build --tag-only
```

   `--tag-only` will not modify local files. It reads the version directly from the latest
   remote `dev` commit, creates the canonical tag only if that commit is not already tagged,
   and tracks the `Build & Release` workflow only when this invocation actually creates the tag.
   If the latest remote `dev` commit is already canonically tagged, the script exits early
   without repeating commit / push / tag work, and it does not re-watch an existing workflow run.
   Use this only when the latest remote `dev` commit has already been version-prepared manually.

   The script must not be used as “bump only”. Allowed paths are:
   - `tag-only`
   - `bump+tag`

3. Manual fallback:

```bash
bun run build:tag
```

   `build:tag` only creates/pushes `v{current-version}` from already-aligned local version files.
   It does not perform the remote `dev` state checks that `release:build` does.

4. Run any additional local verification needed for the change when the default checks are insufficient.
5. Confirm GitHub Actions:
   - `Build & Release`
   - `Sync Release Pages`
6. Check:
   - GitHub Release assets
   - `exomind-release-manifest.json` is present on the GitHub Release and matches the release tag/version
   - GitHub Pages root
   - `releases/preview/latest.json`
   - if the release is expected on Pages, confirm it was not dropped by missing manifest or manifest/tag/version mismatch during Pages sync
   - if specific asset entries are missing from Pages metadata, compare the manifest asset names against the actual GitHub Release assets because partial omission is possible without dropping the whole release entry

## Formal Release

1. Start from an existing stable preview tag.
2. Review / edit release body if needed, but preserve the structured compare/highlight semantics if you want curated Pages highlights to survive; otherwise Pages sync can fall back to synthesized highlights from compare data, with weaker recovery on first-canonical-release edge cases.
3. Promote the release via `workflow_dispatch` with `promote_tag`; do not create a second `release/...` tag.
4. If GitHub UI was used as an emergency/manual fallback, manually trigger `Sync Release Pages` and verify the missing scripted side effects separately.
5. Manually update `CHANGELOG.md` with the final curated summary.
6. Verify both channel views after promotion:
   - `releases/release/latest.json`
   - `releases/preview/latest.json`

## Legacy Compatibility Notes

- Some repository docs and historical artifacts still mention `build/...` or `release/...` tags.
- Some Pages timeline code still tolerates legacy `release/...` tags for historical display.
- Neither case means those namespaces are valid for new releases. New publishing must stay on the current project policy tag line `v0.x.y`.

## Verification Commands

```bash
gh release view v0.4.3 --json name,tagName,isPrerelease,isDraft,body,url,assets
curl.exe -I https://exomind-team.github.io/exomind/
curl.exe https://exomind-team.github.io/exomind/releases/preview/latest.json
curl.exe https://exomind-team.github.io/exomind/releases/release/latest.json
```
