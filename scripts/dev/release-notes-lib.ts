import type { ReleaseManifest } from "./release-pages-metadata-lib.ts";

export interface ReleaseNotesPullRequest {
  number: number;
  title: string;
  url: string;
  authorLogin: string;
  mergedAt?: string | null;
}

export interface ReleaseNotesDirectCommit {
  sha: string;
  shortSha: string;
  title: string;
  url: string;
  authorName: string;
  authorLogin?: string | null;
  committedAt?: string | null;
  files?: string[];
}

export interface ReleaseNotesInput {
  releaseName: string;
  currentTag: string;
  currentVersion: string;
  previousTag?: string | null;
  compareUrl?: string | null;
  manifest?: ReleaseManifest | null;
  pullRequests: ReleaseNotesPullRequest[];
  directCommits: ReleaseNotesDirectCommit[];
}

type HighlightSectionKey =
  | "added"
  | "fixed"
  | "changed"
  | "docs"
  | "maintenance";

const CANONICAL_TAG_RE = /^v\d+\.\d+\.\d+$/;
const ASSET_LABELS: Record<string, string> = {
  "windows-x64-setup": "Windows Setup",
  "windows-x64-installer": "Windows Installer (MSI)",
  "android-arm64": "Android APK (arm64)",
  "android-x86": "Android APK (x86)",
  "macos-aarch64": "macOS DMG (Apple Silicon)",
  "macos-x64": "macOS DMG (Intel)",
  "linux-x64-appimage": "Linux AppImage",
  "linux-x64-deb": "Linux DEB",
  "runtime-windows-x64": "Runtime Windows",
  "runtime-macos-aarch64": "Runtime macOS",
  "runtime-linux-x64": "Runtime Linux",
};

function parseSemverParts(tag: string): [number, number, number] | null {
  const match = tag.trim().match(/^v(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    return null;
  }

  return [
    Number.parseInt(match[1] ?? "0", 10),
    Number.parseInt(match[2] ?? "0", 10),
    Number.parseInt(match[3] ?? "0", 10),
  ];
}

function compareTagsDesc(left: string, right: string): number {
  const leftParts = parseSemverParts(left);
  const rightParts = parseSemverParts(right);

  if (!leftParts || !rightParts) {
    return right.localeCompare(left);
  }

  for (let index = 0; index < leftParts.length; index += 1) {
    const delta = rightParts[index] - leftParts[index];
    if (delta !== 0) {
      return delta;
    }
  }

  return 0;
}

export function findPreviousCanonicalTag(
  currentTag: string,
  tags: string[],
): string | null {
  if (!CANONICAL_TAG_RE.test(currentTag.trim())) {
    return null;
  }

  const canonicalTags = [
    ...new Set(
      [currentTag, ...tags]
        .map((tag) => tag.trim())
        .filter((tag) => CANONICAL_TAG_RE.test(tag)),
    ),
  ];
  canonicalTags.sort(compareTagsDesc);
  const currentIndex = canonicalTags.indexOf(currentTag.trim());

  return currentIndex >= 0 ? (canonicalTags[currentIndex + 1] ?? null) : null;
}

export function normalizeChangeTitle(title: string): string {
  return title
    .trim()
    .replace(/^[a-z]+(?:\([^)]+\))?!?:\s*/i, "")
    .replace(/\s+/g, " ");
}

export function classifyChange(title: string): HighlightSectionKey {
  const normalized = title.trim().toLowerCase();

  if (normalized.startsWith("feat")) {
    return "added";
  }
  if (normalized.startsWith("fix")) {
    return "fixed";
  }
  if (normalized.startsWith("docs")) {
    return "docs";
  }
  if (
    normalized.startsWith("chore") ||
    normalized.startsWith("ci") ||
    normalized.startsWith("build") ||
    normalized.startsWith("test")
  ) {
    return "maintenance";
  }

  return "changed";
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(2)} KiB`;
  }
  return `${bytes} B`;
}

function formatHighlightSource(
  source: ReleaseNotesPullRequest | ReleaseNotesDirectCommit,
): string {
  if ("number" in source) {
    return `[PR #${source.number}](${source.url}) by @${source.authorLogin}`;
  }

  const author = source.authorLogin
    ? `@${source.authorLogin}`
    : source.authorName;
  return `[\`${source.shortSha}\`](${source.url}) by ${author}`;
}

function createNormalizedTitleKey(title: string): string {
  return normalizeChangeTitle(title).trim().toLowerCase();
}

function isMergeCommitTitle(title: string): boolean {
  return title.trim().toLowerCase().startsWith("merge ");
}

function isCoveredByPullRequestTitle(
  directCommitTitleKey: string,
  pullRequestTitleKeys: string[],
): boolean {
  if (!directCommitTitleKey) {
    return false;
  }

  const directCommitTokens = directCommitTitleKey.split(/\s+/).filter(Boolean);
  return pullRequestTitleKeys.some(
    (pullRequestTitleKey) => {
      if (pullRequestTitleKey === directCommitTitleKey) {
        return true;
      }

      const pullRequestTokens = pullRequestTitleKey.split(/\s+/).filter(Boolean);
      if (
        directCommitTokens.length < 3 ||
        directCommitTokens.length >= pullRequestTokens.length
      ) {
        return false;
      }

      return directCommitTokens.every(
        (token, index) => token === pullRequestTokens[index],
      );
    },
  );
}

function normalizeReleaseNotesInput(input: ReleaseNotesInput): ReleaseNotesInput {
  const pullRequestMap = new Map<number, ReleaseNotesPullRequest>();
  for (const pullRequest of input.pullRequests) {
    if (!pullRequestMap.has(pullRequest.number)) {
      pullRequestMap.set(pullRequest.number, pullRequest);
    }
  }

  const pullRequests = [...pullRequestMap.values()];
  const pullRequestTitleKeys = pullRequests
    .map((pullRequest) => createNormalizedTitleKey(pullRequest.title))
    .filter(Boolean);
  const directCommits: ReleaseNotesDirectCommit[] = [];
  const seenCommitShas = new Set<string>();

  for (const directCommit of input.directCommits) {
    if (seenCommitShas.has(directCommit.sha)) {
      continue;
    }
    seenCommitShas.add(directCommit.sha);

    if (isMergeCommitTitle(directCommit.title)) {
      continue;
    }

    const directCommitTitleKey = createNormalizedTitleKey(directCommit.title);
    if (isCoveredByPullRequestTitle(directCommitTitleKey, pullRequestTitleKeys)) {
      continue;
    }

    directCommits.push(directCommit);
  }

  return {
    ...input,
    pullRequests,
    directCommits,
  };
}

function renderHighlights(input: ReleaseNotesInput): string[] {
  const sectionTitles: Record<HighlightSectionKey, string> = {
    added: "### Added / 新增",
    fixed: "### Fixed / 修复",
    changed: "### Changed / 调整",
    docs: "### Docs / 文档",
    maintenance: "### Maintenance / 维护",
  };

  const grouped = new Map<HighlightSectionKey, string[]>();
  const sources: Array<ReleaseNotesPullRequest | ReleaseNotesDirectCommit> = [
    ...input.pullRequests,
    ...input.directCommits,
  ];

  for (const source of sources) {
    const key = classifyChange(source.title);
    const summary = `${normalizeChangeTitle(source.title)} (${formatHighlightSource(source)})`;
    const entries = grouped.get(key) ?? [];
    entries.push(`- ${summary}`);
    grouped.set(key, entries);
  }

  if (grouped.size === 0) {
    return [
      "## What Changed / 本次变化",
      "- No user-facing changes detected in this range.",
    ];
  }

  const lines = ["## What Changed / 本次变化"];
  const orderedKeys: HighlightSectionKey[] = [
    "added",
    "fixed",
    "changed",
    "docs",
    "maintenance",
  ];

  for (const key of orderedKeys) {
    const entries = grouped.get(key);
    if (!entries?.length) {
      continue;
    }
    lines.push("", sectionTitles[key], ...entries);
  }

  return lines;
}

function renderPullRequests(pullRequests: ReleaseNotesPullRequest[]): string[] {
  const lines = ["### Merged PRs / 合并 PR"];

  if (pullRequests.length === 0) {
    lines.push("- None in this release range.");
    return lines;
  }

  for (const pullRequest of pullRequests) {
    lines.push(
      `- [#${pullRequest.number}](${pullRequest.url}) ${pullRequest.title} — @${pullRequest.authorLogin}`,
    );
  }

  return lines;
}

function renderDirectCommits(
  directCommits: ReleaseNotesDirectCommit[],
): string[] {
  const lines = ["### Direct Commits / 直接提交"];

  if (directCommits.length === 0) {
    lines.push("- None. All detected changes are covered by merged PRs.");
    return lines;
  }

  for (const commit of directCommits) {
    const author = commit.authorLogin
      ? `@${commit.authorLogin}`
      : commit.authorName;
    lines.push(
      `- [\`${commit.shortSha}\`](${commit.url}) ${commit.title} — ${author}`,
    );
    if (commit.files?.length) {
      lines.push(`  - Files: ${commit.files.join(", ")}`);
    }
  }

  return lines;
}

function renderArtifacts(manifest?: ReleaseManifest | null): string[] {
  const lines = ["## Downloads / 下载产物"];

  if (!manifest) {
    lines.push("- Release manifest is unavailable.");
    return lines;
  }

  const entries = Object.entries(manifest.assets);
  if (entries.length === 0) {
    lines.push("- No packaged assets recorded in manifest.");
    return lines;
  }

  const appLines: string[] = [];
  const runtimeLines: string[] = [];
  const sortedEntries = [...entries].sort(([leftKey], [rightKey]) =>
    leftKey.localeCompare(rightKey),
  );

  for (const [assetKey, asset] of sortedEntries) {
    const label = ASSET_LABELS[assetKey] ?? assetKey;
    const line = `- ${label}: \`${asset.name}\` (${formatBytes(asset.size)})`;
    if (assetKey.startsWith("runtime-")) {
      runtimeLines.push(line);
      continue;
    }
    appLines.push(line);
  }

  if (appLines.length > 0) {
    lines.push("", "### App / 主应用", ...appLines);
  }

  if (runtimeLines.length > 0) {
    lines.push("", "### Runtime / 运行时", ...runtimeLines);
  }

  return lines;
}

export function renderReleaseNotesMarkdown(input: ReleaseNotesInput): string {
  const normalizedInput = normalizeReleaseNotesInput(input);
  const lines: string[] = [
    `## ${normalizedInput.releaseName}`,
    "",
    "## Release Scope / 发布范围",
    `- Tag: \`${normalizedInput.currentTag}\``,
    `- Version: \`${normalizedInput.currentVersion}\``,
  ];

  if (normalizedInput.previousTag) {
    lines.push(`- Previous Tag: \`${normalizedInput.previousTag}\``);
  } else {
    lines.push("- Previous Tag: initial canonical tag range");
  }

  if (normalizedInput.compareUrl) {
    const compareLabel = normalizedInput.previousTag
      ? `${normalizedInput.previousTag}...${normalizedInput.currentTag}`
      : normalizedInput.currentTag;
    lines.push(`- Compare: [\`${compareLabel}\`](${normalizedInput.compareUrl})`);
  }

  lines.push(`- Merged PRs: ${normalizedInput.pullRequests.length}`);
  lines.push(`- Direct Commits: ${normalizedInput.directCommits.length}`);
  lines.push("");
  lines.push(...renderHighlights(normalizedInput));
  lines.push("");
  lines.push("## Change Sources / 变更来源");
  lines.push("");
  lines.push(...renderPullRequests(normalizedInput.pullRequests));
  lines.push("");
  lines.push(...renderDirectCommits(normalizedInput.directCommits));
  lines.push("");
  lines.push(...renderArtifacts(normalizedInput.manifest));

  return `${lines.join("\n").trim()}\n`;
}
