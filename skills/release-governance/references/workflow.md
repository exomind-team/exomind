# Release Workflow

## Contract

- Canonical version: `0.x.y`
- Canonical tag: `v0.x.y`
- Preview distribution: GitHub Release assets + GitHub Pages preview JSON
- Formal release archive: `CHANGELOG.md`

## Preview Build

1. Align version in:
   - `package.json`
   - `src-tauri/Cargo.toml`
   - `src-tauri/tauri.conf.json`
2. Preferred local entry:

```bash
bun run release:build --dry-run
bun run release:build
```

   Default mode is `bump+tag`:
   - treat the latest canonical `v0.x.y` tag on `origin` as the only version truth source
   - require local `dev` HEAD and local version files to already match the latest remote `dev` commit
   - require the latest remote `dev` commit to be untagged
   - require the latest remote `dev` commit to still carry the latest released version number
   - bump local canonical version files
   - run the default local checks
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
   and then tracks the `Build & Release` workflow.

   The script must not be used as “bump only”. Allowed paths are:
   - `tag-only`
   - `bump+tag`

3. Manual fallback:

```bash
bun run build:tag
```

4. Run any additional local verification needed for the change when the default checks are insufficient.
5. Confirm GitHub Actions:
   - `Build & Release`
   - `Sync Release Pages`
6. Check:
   - GitHub Release assets
   - GitHub Pages root
   - `releases/preview/latest.json`

## Formal Release

1. Start from an existing stable preview tag.
2. Review / edit release body if needed.
3. Promote the release via workflow dispatch or GitHub UI.
4. Update `CHANGELOG.md` with the final curated summary.
5. Verify `release/latest.json` after promotion if the workflow changes release state.

## Verification Commands

```bash
gh release view v0.4.3 --json name,tagName,isPrerelease,isDraft,body,url,assets
curl.exe -I https://exomind-team.github.io/exomind/
curl.exe https://exomind-team.github.io/exomind/releases/preview/latest.json
```
