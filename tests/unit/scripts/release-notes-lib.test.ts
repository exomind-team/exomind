import { describe, expect, it } from "vitest";
import type { ReleaseManifest } from "../../../scripts/dev/release-pages-metadata-lib.ts";
import {
  classifyChange,
  findPreviousCanonicalTag,
  normalizeChangeTitle,
  renderReleaseNotesMarkdown,
} from "../../../scripts/dev/release-notes-lib.ts";

function makeManifest(version: string): ReleaseManifest {
  return {
    version,
    tag: `v${version}`,
    commit: "abcdef1234567890",
    generated_at: "2026-04-08T08:00:00Z",
    assets: {
      "windows-x64-setup": {
        name: `ExoMind-${version}-windows-x64-setup.exe`,
        size: 15_223_808,
        sha256: "a".repeat(64),
      },
      "android-arm64": {
        name: `ExoMind-${version}-android-arm64.apk`,
        size: 19_797_335,
        sha256: "b".repeat(64),
      },
    },
  };
}

describe("release-notes-lib", () => {
  it("finds the previous canonical tag using semantic version order（应按语义化版本找到上一个 canonical tag）", () => {
    const result = findPreviousCanonicalTag("v0.4.3", [
      "release/v0.3.5",
      "v0.4.1",
      "v0.4.3",
      "v0.4.2",
      "build/v0.3.3-build.29",
    ]);

    expect(result).toBe("v0.4.2");
  });

  it("normalizes conventional commit titles and classifies highlights（应去掉 conventional 前缀并归类功能变化）", () => {
    expect(normalizeChangeTitle("fix(release): prepare v0.4.3 pipeline")).toBe(
      "prepare v0.4.3 pipeline",
    );
    expect(classifyChange("feat(agent-hub): improve signal routing")).toBe(
      "added",
    );
    expect(classifyChange("fix(ci): unblock release pipeline")).toBe("fixed");
    expect(classifyChange("chore(release): refresh notes")).toBe("maintenance");
  });

  it("renders markdown with highlights PRs direct commits and artifacts（应输出完整 release notes 结构）", () => {
    const markdown = renderReleaseNotesMarkdown({
      releaseName: "Preview v0.4.3",
      currentTag: "v0.4.3",
      currentVersion: "0.4.3",
      previousTag: "v0.4.2",
      compareUrl:
        "https://github.com/exomind-team/exomind/compare/v0.4.2...v0.4.3",
      manifest: makeManifest("0.4.3"),
      pullRequests: [
        {
          number: 900,
          title: "feat(agent-hub): add release note panel",
          url: "https://github.com/exomind-team/exomind/pull/900",
          authorLogin: "HailayLin",
        },
      ],
      directCommits: [
        {
          sha: "d99ede9c9008dd3d390b87254df58fccb8721fb3",
          shortSha: "d99ede9c",
          title: "fix(release): prepare v0.4.3 pipeline",
          url: "https://github.com/exomind-team/exomind/commit/d99ede9c",
          authorName: "星林",
          authorLogin: "HailayLin",
          files: [".github/workflows/release.yml", "package.json"],
        },
      ],
    });

    expect(markdown).toContain("## Summary / 摘要");
    expect(markdown).toContain(
      "Compare: [`v0.4.2...v0.4.3`](https://github.com/exomind-team/exomind/compare/v0.4.2...v0.4.3)",
    );
    expect(markdown).toContain("### Added / 新增");
    expect(markdown).toContain(
      "add release note panel ([PR #900](https://github.com/exomind-team/exomind/pull/900) by @HailayLin)",
    );
    expect(markdown).toContain("### Fixed / 修复");
    expect(markdown).toContain(
      "prepare v0.4.3 pipeline ([`d99ede9c`](https://github.com/exomind-team/exomind/commit/d99ede9c) by @HailayLin)",
    );
    expect(markdown).toContain("## Direct Commits / 直接提交");
    expect(markdown).toContain(
      "Files: .github/workflows/release.yml, package.json",
    );
    expect(markdown).toContain("## Artifacts / 安装包");
    expect(markdown).toContain(
      "`windows-x64-setup`: `ExoMind-0.4.3-windows-x64-setup.exe`",
    );
  });
});
