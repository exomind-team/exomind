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
2. Run local verification needed for the change.
3. Create tag with:

```bash
bun run build:tag
```

4. Confirm GitHub Actions:
   - `Build & Release`
   - `Sync Release Pages`
5. Check:
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
