#!/usr/bin/env bun

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  buildPagesReleaseMetadata,
  type GithubReleaseSummary,
  type ReleaseManifest,
} from './release-pages-metadata-lib.ts';

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
  assets: Array<{
    name: string;
    size: number;
    browser_download_url: string;
  }>;
};

const DEFAULT_OUTPUT_DIR = 'website/public/releases';
const DEFAULT_REPO = process.env.GITHUB_REPOSITORY || 'exomind-team/exomind';
const MANIFEST_ASSET_NAME = 'exomind-release-manifest.json';

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

async function toSummary(release: GithubRestRelease): Promise<GithubReleaseSummary> {
  const manifestAsset = release.assets.find((asset) => asset.name === MANIFEST_ASSET_NAME);
  const manifest = manifestAsset ? await fetchManifest(manifestAsset.browser_download_url) : null;

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
  const summaries = await Promise.all(releases.map((release) => toSummary(release)));
  const metadata = buildPagesReleaseMetadata(summaries);

  await writeJson(join(outputDir, 'preview', 'latest.json'), metadata.preview.latest);
  await writeJson(join(outputDir, 'preview', 'versions.json'), metadata.preview);
  await writeJson(join(outputDir, 'release', 'latest.json'), metadata.release.latest);
  await writeJson(join(outputDir, 'release', 'versions.json'), metadata.release);

  console.log(`Synced release metadata for ${options.repo} into ${outputDir}`);
  console.log(
    `Preview=${metadata.preview.versions.length} Release=${metadata.release.versions.length}`,
  );
}

await main();
