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

1. Before tagging, dispatch `Build & Release` on the exact candidate ref with `validate_release=true`:
   - builds Android, Windows, macOS, and Linux artifacts
   - uploads validation artifacts but does not create or mutate a GitHub Release
   - must finish green before the immutable canonical tag is created
2. Download the exact Windows and Android validation artifacts and pass the fresh-state plus upgrade-state cross-device release gate described below.
3. Push `v0.x.y` tag:
   - starts `Build & Release`
4. If all four platform build jobs and `create-release` succeed:
   - `Build & Release` creates or updates a GitHub Release as preview (`prerelease: true`)
5. `Build & Release` success:
   - triggers `Sync Release Pages` via `workflow_run`
   - refreshes `website/public/releases/**`
   - rebuilds and deploys GitHub Pages from `dev`
   - note: in the default `release:build` path, the version-bump commit is pushed to `dev` before the tag is pushed, so an earlier `Sync Release Pages` run may also happen from the `push` trigger before the release-tag workflow completes
   - observed on 2026-04-11: that earlier `push`-triggered Pages run completed before the preview GitHub Release existed, so it could not publish the new `releases/preview/latest.json`; treat the later `workflow_run` sync as the final source of truth for the freshly cut preview metadata
6. Promote existing tag:
   - preferred path: use `workflow_dispatch` input `promote_tag`
   - this updates the existing GitHub Release to `prerelease: false`
   - this also applies the scripted side effects (`make_latest`, release title normalization) on the same canonical tag
   - GitHub UI-only promotion is manual fallback only; if used, manually run `Sync Release Pages` afterwards and re-verify Pages metadata because UI changes do not automatically guarantee the scripted side effects or Pages refresh path

GitHub Releases remain the download asset source.
GitHub Pages remains the public metadata / channel surface.
Pages channel metadata is gated by release metadata rules, not by GitHub Release existence alone.
Pages timeline output is looser and may still show non-draft canonical or legacy-compatible tags even when channel metadata is absent.
Website changelog output is derived from GitHub Release bodies through `scripts/dev/sync-release-pages.ts`
and `website/src/lib/release-highlights.ts`. Editing an existing GitHub Release body, then rerunning
`Sync Release Pages`, can update the public `/releases/timeline.json` used by `/changelog/`.

Release completion is fail-closed: a manually uploaded installer, an existing GitHub Release, or a green
`Sync Release Pages` run does not make a failed `Build & Release` run successful. Never move a published
canonical tag to repaired code; retain it as a failed candidate and use the next patch version.

## Preview Build

1. Decide the release path before touching version files:
   - default `bump+tag`: do not pre-bump local version files; keep `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` aligned with the latest released version so `release:build` can bump them itself
   - when the repo tracks `Cargo.lock`, the script also normalizes the root `exomind` package version there before commit so the worktree returns to a clean state after release
   - manual/tag-prepared path: only pre-align those files yourself when you intentionally plan to use `--tag-only` or another manual fallback
2. Before publishing a public preview, review the user-facing release meaning:
   - list the shipped PRs / direct commits that affect product behavior
   - map each meaningful change to a user scenario, user-visible change, try/verify path, and public copy
   - write the public copy from the contributor-as-user voice: explain what we changed because it affects how we actually use ExoMind
   - for the current Chinese public website, put readable Simplified Chinese first and keep English-only engineering terms out of the primary public blocks
   - exclude or demote version bumps, dependency pins, CI fixes, Pages sync, manifests, lockfiles, and internal release pipeline work from primary website highlights
   - write or review one concise `给使用者看的摘要` for the website changelog/download surface
   - place the curated website bullets in the first `## What Changed / 本次变化` block, because Pages parses that block and keeps at most 5 highlights
   - if no meaningful user-visible change exists, treat the build as an engineering validation build and avoid presenting it as a product iteration on public surfaces
3. Push the exact candidate ref, then run the build-only release validation and wait for a green result:

```bash
gh workflow run release.yml --ref <candidate-ref> -f validate_release=true
gh run watch <run-id> --exit-status
```

3.1. Before creating the immutable tag, download the Windows and Android artifacts from that exact validation run and complete the cross-device release gate:
   - use the same candidate version on PC and a physical Android device
   - test a fresh state with no pre-existing peer, then an upgrade state that retains the previous version's confirmed peer and runtime data
   - require mutual mDNS visibility, a complete PIN pairing flow, one EventLog live-sync roundtrip, and EventLog/Task/TimeBlock snapshot or backfill without HTTP 409 authentication errors
   - record RT truth (`/mesh/discovered`, `/mesh/peers`, relevant response status) separately from UI truth
   - if either path fails, cancel publishing; do not create or move the canonical tag

4. Preferred local entry after the validation run is green:

```bash
bun run release:build --dry-run
bun run release:build
```

   Practical prerequisite:
   - install and authenticate GitHub CLI (`gh`), because the non-dry-run path uses `gh run list` / `gh run watch` after pushing the tag.
   - observed on 2026-04-11: `--dry-run` validates remote state and prints the planned next version/tag, but it does not run the default local checks (`bun x tsc --noEmit` / `bun run website:build`)

   Default mode is `bump+tag`:
   - treat the latest canonical `v0.x.y` tag on `origin` as the only version truth source
   - require current branch to be `dev`
   - require a clean worktree before mutating version files
   - require local `dev` HEAD and local version files to already match the latest remote `dev` commit
   - require the latest remote `dev` commit to be untagged
   - require the latest remote `dev` commit to still carry the latest released version number
   - bump local canonical version files and sync tracked `Cargo.lock` root package version when present
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

5. Manual fallback:

```bash
bun run build:tag
```

   `build:tag` only creates/pushes `v{current-version}` from already-aligned local version files.
   It does not perform the remote `dev` state checks that `release:build` does.

6. Run any additional local verification needed for the change when the default checks are insufficient.
7. Confirm GitHub Actions:
   - `Build & Release`
   - `Sync Release Pages`
   - the tag-triggered run—not only the earlier build-only validation—must be green before reporting release success
8. Check:
   - GitHub Release assets
   - `exomind-release-manifest.json` is present on the GitHub Release and matches the release tag/version
   - GitHub Pages root
   - `releases/preview/latest.json`
   - website changelog/download copy describes user-visible outcomes before raw developer notes
   - if the release is expected on Pages, confirm it was not dropped by missing manifest or manifest/tag/version mismatch during Pages sync
   - if specific asset entries are missing from Pages metadata, compare the manifest asset names against the actual GitHub Release assets because partial omission is possible without dropping the whole release entry

## Formal Release

1. Start from an existing stable preview tag.
2. Review / edit release body and public website copy from the product side: summarize why the release matters to users in the contributor-as-user voice, put readable Simplified Chinese first for the current Chinese public site, preserve the structured compare/highlight semantics if you want curated Pages highlights to survive, and keep raw engineering evidence outside the primary public changelog.
   - If the formal release is the stable publication of a long preview line, summarize the accumulated user-visible change since the last stable/public baseline, not just the final preview-to-preview diff.
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

## Historical Release Note Backfill

Use historical backfill when a public website changelog entry is visible but its Release Note
only exposes developer artifacts, such as version bumps, CI changes, dependency pins, or release
pipeline housekeeping.

1. Edit only existing GitHub Releases; do not invent releases for tags that have no GitHub Release.
2. Preserve the original generated notes under `## Developer Notes / 工程证据` so reviewers can still audit PRs, commits, assets, and compare ranges.
3. Add `## 给使用者看的摘要`, then put the public bullets in the first `## What Changed / 本次变化` block.
4. Limit public bullets to the highest-signal 3-5 user-visible outcomes because Pages timeline metadata keeps at most 5 highlights.
5. Rerun `Sync Release Pages` and verify both GitHub Pages and the public domain JSON, for example:

```bash
curl.exe https://exomind-team.github.io/exomind/releases/timeline.json
curl.exe https://exo-mind.ai/releases/timeline.json
```

## Verification Commands

```bash
gh release view v0.4.3 --json name,tagName,isPrerelease,isDraft,body,url,assets
curl.exe -I https://exomind-team.github.io/exomind/
curl.exe https://exomind-team.github.io/exomind/releases/preview/latest.json
curl.exe https://exomind-team.github.io/exomind/releases/release/latest.json
```
