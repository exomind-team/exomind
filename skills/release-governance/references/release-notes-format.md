# Release Notes Format

Preview release notes should stay deterministic and human-readable.
They are generated from repository / GitHub metadata, not handwritten in the normal preview path.

Public website release copy must be product-facing. GitHub Release notes may carry
developer evidence, but the website changelog and download surfaces must first answer:

- What user workflow changed?
- Who should care about this version?
- How can a preview user try or verify the change?
- What limitation or preview risk remains?

The public voice should be "we as contributors who also use ExoMind"（贡献者也是使用者）.
Do not write as an anonymous product department announcing abstract progress, and do
not translate commit titles directly. Write as contributors explaining why a change
matters in real daily use: what became easier, what stopped breaking, what is still
only safe for early testing, and what evidence backs that claim.

For the current Chinese-facing website, the primary public sentence should be readable
Simplified Chinese. English is acceptable as a product name, code evidence, or secondary
translation, but it must not be the only explanation of a change on public changelog
or download surfaces.

GitHub Release bodies are mutable after publication. When public changelog quality is
wrong, prefer a careful Release Note backfill plus a `Sync Release Pages` run over
leaving raw developer artifacts on the website.

## Public Voice

Use a first-person contributor voice for website-facing summaries and highlights:

- Prefer "我们修了 / 我们把 / 我们希望" when the sentence explains a real user workflow.
- Explain why the change mattered to us as users, not only what code changed.
- Put plain Simplified Chinese first for the Chinese public website; keep English-only release lines out of the primary public blocks.
- Say plainly when a version is only a download/release reliability fix.
- For preview lines promoted as stable candidates, explain the accumulated daily-use arc from the last public baseline.
- Keep raw commit titles, PR titles, conventional-commit prefixes, code names, dependency names, and CI details under `## Developer Notes / 工程证据`.

Avoid these patterns in the first public sections:

- Product-deck language: "将 X 推进为 Y", "赋能", "全面升级" without a concrete workflow.
- Raw engineering language: "runtime fallback", "pin dependency", "SSE endpoint", "bump version" as primary copy.
- English-only generated notes on a Chinese public page.
- Fake feature packaging for a version that only repaired the build, download, or release pipeline.
- A changelog that reads as if it was written by someone outside the product who never tried the build.

## Current Structure

1. `Release Scope / 发布范围`
   - tag
   - version
   - previous tag, if a previous canonical tag exists
   - compare link, if a compare range can be resolved
   - PR / direct commit counts
2. `What Changed / 本次变化`
   - grouped into `Added` / `Fixed` / `Changed` / `Docs` / `Maintenance`
   - rendered highlights prefer merged PRs first, then only the remaining direct commits
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

- Public changelog copy must describe user-visible outcomes, not implementation work. A good highlight is phrased around a user action or experience: "时间块结束后的反馈记录更稳定" is acceptable; "route timeblock_summary event log reads/writes through correct user profile" is not acceptable as primary public copy.
- Every public preview/formal release needs a one-sentence `给使用者看的摘要` before detailed bullets when the release is shown on the website or download page.
- Website changelog highlights are parsed from the first `## What Changed` / `## What's Changed` / `## Changes` block in the GitHub Release body. Put public copy there before any generated developer section.
- `scripts/dev/sync-release-pages.ts` trims parsed highlights to 5 entries for `releases/timeline.json`; order the bullets by user importance, not by commit chronology.
- Website changelog cards escape highlight text instead of rendering Markdown. Do not put Markdown links, inline-code backticks, raw URLs, or PR references in the first public bullets; keep those in `Developer Notes / 工程证据`.
- When preserving generated notes, place them after the curated public section under `## Developer Notes / 工程证据`. A second later `## What Changed` inside developer notes is acceptable as archival evidence, but it must not be the first `What Changed` block.
- For website-facing highlights, use this mapping before publishing:
  - Code / PR / commit
  - User scenario
  - User-visible change
  - Try / verify path
  - Public copy
- Hide or demote pure maintenance items from the primary website changelog: version bumps, dependency pins, CI fixes, Pages sync fixes, manifest fixes, lockfile updates, internal scripts, and release pipeline changes. If they must be preserved, place them in developer notes or GitHub Release details.
- For a stable candidate that represents a whole preview line, write the public summary from the last stable/public baseline to the candidate tag. Direct tag-to-tag diffs remain developer evidence, but they may be too narrow for the product story.
- Historical backfill should edit only existing GitHub Releases. If a tag has no GitHub Release, record it as absent instead of fabricating public history.
- Preview risk should be explicit when the change affects runtime agents, persistence, sync, downloads, or user history. Say whether the build is suitable for early testing or daily long-term use.
- Prefer short functional phrasing in highlights; strip conventional commit prefixes when rendering summaries.
- The current generator path is `scripts/dev/generate-release-notes.ts` + `scripts/dev/release-notes-lib.ts`, and `scripts/dev/sync-release-pages.ts` also parses release bodies for compare/highlight metadata; update this reference doc when either contract changes.
- PRs are primary evidence when present.
- Direct commits whose normalized title is already covered by a merged PR title should be suppressed from rendered notes.
- Merge commits (`Merge ...`) should be filtered out of rendered highlights and direct-commit listings.
- Commits without merged PRs must still be listed explicitly.
- Artifact section should be grouped by app vs runtime, not a flat raw manifest dump.
- Release notes should reflect the current project policy tag range (`v0.x.y` under this policy); do not describe legacy `build/...` or `release/...` tag flows as active behavior.
- If a human edits a release body after generation, keep the compare range and highlight structure machine-readable if you want curated Pages highlights to survive; otherwise Pages sync may fall back to synthesized highlights from compare data instead of failing outright.
- GitHub Pages currently stores at most 5 highlights per release; do not assume every curated bullet will surface there.
- `CHANGELOG.md` is not updated for preview notes.

## Public Copy Template

Use this structure when curating or reviewing website-facing release copy:

```md
## 给使用者看的摘要

vX.Y.Z preview/release:
一句话，用“我们作为使用者/贡献者”的口吻说明这版对真实使用有什么意义。

## What Changed / 本次变化

- 使用者能感受到的新能力或变化。
- 某个具体工作流里的稳定性、连续性或可靠性改善。
- 下载、平台、安装或启动体验的影响，如果这次发布主要修的是这些。
- 预览限制、已知风险，或者是否适合日常长时间使用的建议。

## Developer Notes / 工程证据

- PRs, commits, compare range, assets, and other audit evidence.
```

## Translation Examples

| Developer wording | Public wording |
| --- | --- |
| `bump version to 0.4.21` | Omit from public highlights. |
| `pin tauri js packages to rust minor` | Omit unless it fixes a user-visible install/startup problem. |
| `resolve embedded runtime port via IPC instead of stale localStorage cache` | 我们让浮动工作台连接到当前后台服务，减少旧缓存导致的错连和错误状态。 |
| `route timeblock_summary event log reads/writes through correct user profile` | 我们让时间块总结和反馈写回正确用户档案，降低复盘历史混到一起的风险。 |
| `resolve OOM crash + SSE signal stream leaks` | 我们修了长时间运行时的内存崩溃和持续连接泄漏，降低试用一整天时突然崩掉或持续耗资源的风险。 |
