#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { ReleaseManifest } from "./release-pages-metadata-lib.ts";
import {
  findPreviousCanonicalTag,
  renderReleaseNotesMarkdown,
  type ReleaseNotesDirectCommit,
  type ReleaseNotesPullRequest,
} from "./release-notes-lib.ts";

type Options = {
  repo: string;
  tag: string;
  output: string;
  title?: string;
  token?: string;
  manifest?: string;
};

type GithubTag = {
  name: string;
};

type GithubCompareCommit = {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author?: {
      name?: string | null;
      date?: string | null;
    } | null;
  };
  author?: {
    login?: string | null;
  } | null;
};

type GithubCompareResponse = {
  html_url: string;
  commits: GithubCompareCommit[];
};

type GithubCommitPull = {
  number: number;
  title: string;
  html_url: string;
  merged_at?: string | null;
  user?: {
    login?: string | null;
  } | null;
};

type GithubCommitDetail = {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author?: {
      name?: string | null;
      date?: string | null;
    } | null;
  };
  author?: {
    login?: string | null;
  } | null;
  files?: Array<{
    filename: string;
  }>;
};

const DEFAULT_REPO = process.env.GITHUB_REPOSITORY || "exomind-team/exomind";
const DEFAULT_TAG = process.env.GITHUB_REF_NAME || "";
const DEFAULT_OUTPUT = ".tmp/release-notes.md";

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const options: Options = {
    repo: DEFAULT_REPO,
    tag: DEFAULT_TAG,
    output: DEFAULT_OUTPUT,
    title: undefined,
    token: process.env.GITHUB_TOKEN,
    manifest: "release-assets/exomind-release-manifest.json",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const nextValue = args[index + 1];

    if (arg === "--repo" && nextValue) {
      options.repo = nextValue;
      index += 1;
      continue;
    }

    if (arg === "--tag" && nextValue) {
      options.tag = nextValue;
      index += 1;
      continue;
    }

    if (arg === "--output" && nextValue) {
      options.output = nextValue;
      index += 1;
      continue;
    }

    if (arg === "--title" && nextValue) {
      options.title = nextValue;
      index += 1;
      continue;
    }

    if (arg === "--token" && nextValue) {
      options.token = nextValue;
      index += 1;
      continue;
    }

    if (arg === "--manifest" && nextValue) {
      options.manifest = nextValue;
      index += 1;
    }
  }

  return options;
}

function assertOptions(options: Options) {
  if (!options.tag || !/^v\d+\.\d+\.\d+$/.test(options.tag)) {
    throw new Error(
      `Expected canonical release tag like v0.x.y, received: ${options.tag || "<empty>"}`,
    );
  }
  if (!options.repo.includes("/")) {
    throw new Error(`Invalid GitHub repo: ${options.repo}`);
  }
}

async function githubJson<T>(url: string, token?: string): Promise<T> {
  const headers = new Headers({
    Accept: "application/vnd.github+json",
    "User-Agent": "exomind-release-notes-generator",
  });
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(
      `GitHub API request failed: ${response.status} ${response.statusText} (${url})`,
    );
  }
  return response.json() as Promise<T>;
}

async function fetchAllCanonicalTags(
  repo: string,
  token?: string,
): Promise<string[]> {
  const tags: string[] = [];

  for (let page = 1; page <= 10; page += 1) {
    const url = `https://api.github.com/repos/${repo}/tags?per_page=100&page=${page}`;
    const batch = await githubJson<GithubTag[]>(url, token);
    tags.push(...batch.map((tag) => tag.name));
    if (batch.length < 100) {
      break;
    }
  }

  return tags;
}

async function fetchCompareRange(
  repo: string,
  previousTag: string,
  currentTag: string,
  token?: string,
): Promise<GithubCompareResponse> {
  const encodedBase = encodeURIComponent(previousTag);
  const encodedHead = encodeURIComponent(currentTag);
  return githubJson<GithubCompareResponse>(
    `https://api.github.com/repos/${repo}/compare/${encodedBase}...${encodedHead}`,
    token,
  );
}

async function fetchPullRequestsForCommit(
  repo: string,
  sha: string,
  token?: string,
): Promise<GithubCommitPull[]> {
  return githubJson<GithubCommitPull[]>(
    `https://api.github.com/repos/${repo}/commits/${sha}/pulls`,
    token,
  );
}

async function fetchCommitDetail(
  repo: string,
  sha: string,
  token?: string,
): Promise<GithubCommitDetail> {
  return githubJson<GithubCommitDetail>(
    `https://api.github.com/repos/${repo}/commits/${sha}`,
    token,
  );
}

async function readManifest(
  manifestPath?: string,
): Promise<ReleaseManifest | null> {
  if (!manifestPath) {
    return null;
  }

  const resolvedPath = resolve(manifestPath);
  const content = await readFile(resolvedPath, "utf8");
  return JSON.parse(content) as ReleaseManifest;
}

function firstLine(message: string): string {
  return message.split("\n")[0]?.trim() ?? "";
}

function toPullRequestSummary(pull: GithubCommitPull): ReleaseNotesPullRequest {
  return {
    number: pull.number,
    title: pull.title.trim(),
    url: pull.html_url,
    authorLogin: pull.user?.login?.trim() || "unknown",
    mergedAt: pull.merged_at ?? null,
  };
}

async function buildReleaseNotesData(
  options: Options,
  manifest: ReleaseManifest | null,
): Promise<{
  previousTag: string | null;
  compareUrl: string | null;
  pullRequests: ReleaseNotesPullRequest[];
  directCommits: ReleaseNotesDirectCommit[];
}> {
  const allTags = await fetchAllCanonicalTags(options.repo, options.token);
  const previousTag = findPreviousCanonicalTag(options.tag, allTags);

  if (!previousTag) {
    const currentSha =
      manifest?.commit?.trim() || process.env.GITHUB_SHA?.trim() || "";
    if (!currentSha) {
      return {
        previousTag: null,
        compareUrl: null,
        pullRequests: [],
        directCommits: [],
      };
    }

    const commit = await fetchCommitDetail(
      options.repo,
      currentSha,
      options.token,
    );
    return {
      previousTag: null,
      compareUrl: null,
      pullRequests: [],
      directCommits: [
        {
          sha: commit.sha,
          shortSha: commit.sha.slice(0, 8),
          title: firstLine(commit.commit.message),
          url: commit.html_url,
          authorName: commit.commit.author?.name?.trim() || "unknown",
          authorLogin: commit.author?.login?.trim() || null,
          committedAt: commit.commit.author?.date ?? null,
          files: (commit.files ?? []).slice(0, 6).map((file) => file.filename),
        },
      ],
    };
  }

  const compare = await fetchCompareRange(
    options.repo,
    previousTag,
    options.tag,
    options.token,
  );
  const pullRequestMap = new Map<number, ReleaseNotesPullRequest>();
  const directCommits: ReleaseNotesDirectCommit[] = [];

  for (const commit of compare.commits) {
    const pulls = await fetchPullRequestsForCommit(
      options.repo,
      commit.sha,
      options.token,
    );
    const mergedPulls = pulls.filter(
      (pull) => pull.number && pull.html_url && pull.merged_at,
    );

    if (mergedPulls.length > 0) {
      for (const pull of mergedPulls) {
        if (!pullRequestMap.has(pull.number)) {
          pullRequestMap.set(pull.number, toPullRequestSummary(pull));
        }
      }
      continue;
    }

    const detail = await fetchCommitDetail(
      options.repo,
      commit.sha,
      options.token,
    );
    directCommits.push({
      sha: commit.sha,
      shortSha: commit.sha.slice(0, 8),
      title: firstLine(commit.commit.message),
      url: commit.html_url,
      authorName: commit.commit.author?.name?.trim() || "unknown",
      authorLogin: commit.author?.login?.trim() || null,
      committedAt: commit.commit.author?.date ?? null,
      files: (detail.files ?? []).slice(0, 6).map((file) => file.filename),
    });
  }

  const pullRequests = [...pullRequestMap.values()].sort(
    (left, right) => right.number - left.number,
  );

  return {
    previousTag,
    compareUrl: compare.html_url || null,
    pullRequests,
    directCommits,
  };
}

async function main() {
  const options = parseArgs();
  assertOptions(options);

  const manifest = await readManifest(options.manifest);
  const releaseData = await buildReleaseNotesData(options, manifest);
  const currentVersion = options.tag.replace(/^v/, "");
  const releaseName = options.title?.trim() || `Preview ${options.tag}`;
  const body = renderReleaseNotesMarkdown({
    releaseName,
    currentTag: options.tag,
    currentVersion,
    previousTag: releaseData.previousTag,
    compareUrl: releaseData.compareUrl,
    manifest,
    pullRequests: releaseData.pullRequests,
    directCommits: releaseData.directCommits,
  });

  const outputPath = resolve(options.output);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, body, "utf8");

  console.log(`Generated release notes: ${outputPath}`);
  console.log(`Previous tag: ${releaseData.previousTag ?? "none"}`);
  console.log(
    `PRs=${releaseData.pullRequests.length} DirectCommits=${releaseData.directCommits.length}`,
  );
}

await main();
