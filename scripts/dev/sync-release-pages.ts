#!/usr/bin/env bun

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  buildPagesReleaseMetadata,
  buildPagesReleaseTimeline,
  type GithubReleaseSummary,
  type ReleaseManifest,
} from './release-pages-metadata-lib.ts';
import {
  extractCompareRangeFromMarkdown,
  parseReleaseHighlights,
  type ReleaseHighlight,
  type ReleaseHighlightKind,
} from '../../website/src/lib/release-highlights.ts';
import {
  classifyChange,
  findPreviousCanonicalTag,
  normalizeChangeTitle,
} from './release-notes-lib.ts';

type Options = {
  outputDir: string;
  repo: string;
  token?: string;
};

type GithubRestRelease = {
  tag_name: string;
  prerelease: boolean;
  draft: boolean;
  published_at: string | null;
  html_url: string;
  body: string | null;
  assets: Array<{
    name: string;
    size: number;
    browser_download_url: string;
  }>;
};

type GithubCompareCommit = {
  sha: string;
  html_url: string;
  author?: {
    login: string;
  } | null;
  commit: {
    message: string;
    author?: {
      name: string;
      date: string | null;
    } | null;
  };
};

type GithubCompareResponse = {
  commits?: GithubCompareCommit[];
};

type CompareRange = {
  repo: string;
  base: string;
  head: string;
};

const DEFAULT_OUTPUT_DIR = 'website/public/releases';
const DEFAULT_REPO = process.env.GITHUB_REPOSITORY || 'exomind-team/exomind';
const MANIFEST_ASSET_NAME = 'exomind-release-manifest.json';
const MAX_RELEASE_HIGHLIGHTS = 5;
const COMPARE_HIGHLIGHTS_CACHE = new Map<string, Promise<ReleaseHighlight[]>>();

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const options: Options = {
    outputDir: DEFAULT_OUTPUT_DIR,
    repo: DEFAULT_REPO,
    token: process.env.GITHUB_TOKEN,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const nextValue = args[index + 1];

    if (arg === '--output-dir' && nextValue) {
      options.outputDir = nextValue;
      index += 1;
      continue;
    }

    if (arg === '--repo' && nextValue) {
      options.repo = nextValue;
      index += 1;
      continue;
    }

    if (arg === '--token' && nextValue) {
      options.token = nextValue;
      index += 1;
    }
  }

  return options;
}

async function githubJson<T>(url: string, token?: string): Promise<T> {
  const headers = new Headers({
    Accept: 'application/vnd.github+json',
    'User-Agent': 'exomind-release-pages-sync',
  });
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`GitHub API request failed: ${response.status} ${response.statusText} (${url})`);
  }
  return response.json() as Promise<T>;
}

async function fetchManifest(assetUrl: string): Promise<ReleaseManifest | null> {
  const response = await fetch(assetUrl, {
    headers: {
      'User-Agent': 'exomind-release-pages-sync',
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    return null;
  }

  return response.json() as Promise<ReleaseManifest>;
}

async function fetchAllReleases(repo: string, token?: string): Promise<GithubRestRelease[]> {
  const releases: GithubRestRelease[] = [];

  for (let page = 1; page < 10; page += 1) {
    const url = `https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`;
    const batch = await githubJson<GithubRestRelease[]>(url, token);
    releases.push(...batch);
    if (batch.length < 100) {
      break;
    }
  }

  return releases;
}

function trimHighlights(highlights: ReleaseHighlight[]): ReleaseHighlight[] {
  return highlights.slice(0, MAX_RELEASE_HIGHLIGHTS);
}

function isNoiseCommitTitle(title: string): boolean {
  return /^(?:merge pull request|merge branch)\b/i.test(title.trim());
}

function summarizeCompareCommits(commits: GithubCompareCommit[]): ReleaseHighlight[] {
  const grouped = new Map<ReleaseHighlightKind, string[]>();
  const seen = new Set<string>();
  const orderedKinds: ReleaseHighlightKind[] = ['added', 'fixed', 'changed', 'docs', 'maintenance'];

  for (const commit of commits) {
    const rawTitle = commit.commit.message.split(/\r?\n/, 1)[0]?.trim() ?? '';
    if (!rawTitle || isNoiseCommitTitle(rawTitle)) {
      continue;
    }

    const text = normalizeChangeTitle(rawTitle);
    if (!text) {
      continue;
    }

    const dedupeKey = text.toLowerCase();
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);

    const kind = classifyChange(rawTitle) as ReleaseHighlightKind;
    const entries = grouped.get(kind) ?? [];
    entries.push(text);
    grouped.set(kind, entries);
  }

  const highlights: ReleaseHighlight[] = [];

  for (const kind of orderedKinds) {
    const entries = grouped.get(kind) ?? [];
    for (const text of entries) {
      highlights.push({ kind, text });
      if (highlights.length >= MAX_RELEASE_HIGHLIGHTS) {
        return highlights;
      }
    }
  }

  return highlights;
}

function resolveCompareRange(
  release: GithubRestRelease,
  repo: string,
  allTagNames: string[],
): CompareRange | null {
  const fromMarkdown = extractCompareRangeFromMarkdown(release.body);
  if (fromMarkdown) {
    return fromMarkdown;
  }

  const previousCanonicalTag = findPreviousCanonicalTag(release.tag_name, allTagNames);
  if (!previousCanonicalTag) {
    return null;
  }

  return {
    repo,
    base: previousCanonicalTag,
    head: release.tag_name,
  };
}

async function fetchCompareHighlights(
  range: CompareRange,
  token?: string,
): Promise<ReleaseHighlight[]> {
  const cacheKey = `${range.repo}:${range.base}...${range.head}`;
  const existing = COMPARE_HIGHLIGHTS_CACHE.get(cacheKey);
  if (existing) {
    return existing;
  }

  const promise = githubJson<GithubCompareResponse>(
    `https://api.github.com/repos/${range.repo}/compare/${encodeURIComponent(range.base)}...${encodeURIComponent(range.head)}`,
    token,
  )
    .then((response) => summarizeCompareCommits(response.commits ?? []))
    .catch((error) => {
      console.warn(`Failed to fetch compare highlights for ${cacheKey}:`, error);
      return [];
    });

  COMPARE_HIGHLIGHTS_CACHE.set(cacheKey, promise);
  return promise;
}

async function resolveReleaseHighlights(
  release: GithubRestRelease,
  context: {
    repo: string;
    token?: string;
    allTagNames: string[];
  },
): Promise<ReleaseHighlight[]> {
  const parsed = trimHighlights(parseReleaseHighlights(release.body));
  if (parsed.length > 0) {
    return parsed;
  }

  const compareRange = resolveCompareRange(release, context.repo, context.allTagNames);
  if (!compareRange) {
    return [];
  }

  return trimHighlights(await fetchCompareHighlights(compareRange, context.token));
}

async function toSummary(
  release: GithubRestRelease,
  context: {
    repo: string;
    token?: string;
    allTagNames: string[];
  },
): Promise<GithubReleaseSummary> {
  const manifestAsset = release.assets.find((asset) => asset.name === MANIFEST_ASSET_NAME);
  const manifest = manifestAsset ? await fetchManifest(manifestAsset.browser_download_url) : null;
  const highlights = await resolveReleaseHighlights(release, context);

  return {
    tagName: release.tag_name,
    prerelease: release.prerelease,
    draft: release.draft,
    publishedAt: release.published_at,
    htmlUrl: release.html_url,
    assets: release.assets.map((asset) => ({
      name: asset.name,
      size: asset.size,
      browserDownloadUrl: asset.browser_download_url,
    })),
    manifest,
    body: release.body,
    highlights,
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function main() {
  const options = parseArgs();
  const outputDir = resolve(options.outputDir);

  const releases = await fetchAllReleases(options.repo, options.token);
  const allTagNames = releases.map((release) => release.tag_name);
  const summaries = await Promise.all(
    releases.map((release) =>
      toSummary(release, {
        repo: options.repo,
        token: options.token,
        allTagNames,
      }),
    ),
  );
  const metadata = buildPagesReleaseMetadata(summaries);
  const timeline = buildPagesReleaseTimeline(summaries);

  await writeJson(join(outputDir, 'preview', 'latest.json'), metadata.preview.latest);
  await writeJson(join(outputDir, 'preview', 'versions.json'), metadata.preview);
  await writeJson(join(outputDir, 'release', 'latest.json'), metadata.release.latest);
  await writeJson(join(outputDir, 'release', 'versions.json'), metadata.release);
  await writeJson(join(outputDir, 'timeline.json'), timeline);

  console.log(`Synced release metadata for ${options.repo} into ${outputDir}`);
  console.log(
    `Preview=${metadata.preview.versions.length} Release=${metadata.release.versions.length} Timeline=${timeline.preview.length + timeline.release.length}`,
  );
}

await main();
