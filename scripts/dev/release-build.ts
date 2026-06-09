#!/usr/bin/env bun

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  compareCanonicalVersions,
  findLatestCanonicalTag,
  OPTIONAL_VERSION_FILE_RELATIVE_PATHS,
  readCanonicalVersion,
  resolveCanonicalVersionFromTexts,
  resolveReleaseVersionPlan,
  stripTagPrefix,
  type ReleaseBumpKind,
  VERSION_FILE_RELATIVE_PATHS,
  writeCanonicalVersion,
} from './release-version-lib.ts';

type ExecutionMode = 'bump-and-tag' | 'tag-only';

type Options = {
  branch: string;
  bump: ReleaseBumpKind;
  dryRun: boolean;
  explicitVersion?: string;
  mode: ExecutionMode;
  noVerify: boolean;
  remote: string;
};

type RemoteTagRef = {
  sha: string;
  tag: string;
};

type RemoteState = {
  branchHeadSha: string;
  branchRef: string;
  branchVersion: string;
  latestTag: string | null;
  latestVersion: string | null;
  taggedByHead: string[];
  tagRefs: RemoteTagRef[];
};

type BuildReleaseRun = {
  conclusion?: string | null;
  createdAt?: string;
  databaseId: number;
  displayTitle?: string;
  event?: string;
  headBranch?: string;
  headSha?: string;
  status?: string;
  url?: string;
};

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const options: Options = {
    branch: 'dev',
    bump: 'patch',
    dryRun: args.includes('--dry-run'),
    explicitVersion: undefined,
    mode: args.includes('--tag-only') ? 'tag-only' : 'bump-and-tag',
    noVerify: args.includes('--no-verify'),
    remote: 'origin',
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const nextValue = args[index + 1];

    if (arg === '--bump' && nextValue) {
      if (nextValue === 'major' || nextValue === 'minor' || nextValue === 'patch') {
        options.bump = nextValue;
      } else {
        throw new Error(`不支持的 bump 类型: ${nextValue}`);
      }
      index += 1;
      continue;
    }

    if (arg === '--set' && nextValue) {
      options.explicitVersion = nextValue;
      index += 1;
      continue;
    }

    if (arg === '--branch' && nextValue) {
      options.branch = nextValue;
      index += 1;
      continue;
    }

    if (arg === '--remote' && nextValue) {
      options.remote = nextValue;
      index += 1;
      continue;
    }
  }

  if (options.mode === 'tag-only') {
    if (options.explicitVersion) {
      throw new Error('--tag-only 模式不接受 --set；tag 版本应来自远端 dev 最新提交中的版本文件。');
    }
    if (options.bump !== 'patch') {
      throw new Error('--tag-only 模式不接受 --bump；它不会修改版本文件。');
    }
    if (options.noVerify) {
      throw new Error('--tag-only 模式不接受 --no-verify；它不会执行本地构建校验。');
    }
  }

  return options;
}

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf-8' }).trim();
}

function run(command: string, args: string[]): void {
  execFileSync(command, args, { stdio: 'inherit' });
}

function runQuiet(command: string, args: string[]): string {
  return execFileSync(command, args, { encoding: 'utf-8' }).trim();
}

function assertCleanWorktree(): void {
  const status = git('status', '--short');
  if (status.trim()) {
    throw new Error('工作区不干净，拒绝自动 bump 版本和打 tag。');
  }
}

function assertCurrentBranch(expectedBranch: string): void {
  const currentBranch = git('rev-parse', '--abbrev-ref', 'HEAD');
  if (currentBranch !== expectedBranch) {
    throw new Error(`当前分支必须是 ${expectedBranch}，实际为 ${currentBranch}`);
  }
}

function assertLocalHeadSynced(remoteBranchRef: string): void {
  const localHead = git('rev-parse', 'HEAD');
  if (localHead !== remoteBranchRef) {
    throw new Error(
      `本地 HEAD (${localHead.slice(0, 8)}) 未同步到远端最新提交 (${remoteBranchRef.slice(0, 8)})；请先更新到远端最新后再执行。`,
    );
  }
}

function tagExistsLocally(tag: string): boolean {
  try {
    git('rev-parse', '-q', '--verify', `refs/tags/${tag}`);
    return true;
  } catch {
    return false;
  }
}

function fetchRemoteState(remote: string, branch: string): RemoteState {
  const branchRef = `${remote}/${branch}`;
  const branchHeadSha = git('ls-remote', remote, `refs/heads/${branch}`).split(/\s+/)[0] ?? '';
  if (!branchHeadSha) {
    throw new Error(`无法解析远端分支 ${remote}/${branch} 的最新提交。`);
  }

  const tempRef = `refs/codex/release-build/${process.pid}-${Date.now()}`;
  runQuiet('git', ['fetch', '--no-tags', remote, `refs/heads/${branch}:${tempRef}`]);

  const tagsOutput = git('ls-remote', '--tags', '--refs', remote, 'v*');
  const tagRefs: RemoteTagRef[] = tagsOutput
    ? tagsOutput
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const match = line.match(/^([0-9a-f]{40})\s+refs\/tags\/(.+)$/i);
          if (!match) {
            return null;
          }
          return {
            sha: match[1] ?? '',
            tag: match[2] ?? '',
          };
        })
        .filter((value): value is RemoteTagRef => Boolean(value))
    : [];

  const latestTag = findLatestCanonicalTag(tagRefs.map((entry) => entry.tag));
  const latestVersion = latestTag ? stripTagPrefix(latestTag) : null;
  const taggedByHead = [...new Set(tagRefs.filter((entry) => entry.sha === branchHeadSha).map((entry) => entry.tag))].sort(
    (left, right) => compareCanonicalVersions(right, left),
  );

  let branchVersion = '';
  try {
    branchVersion = resolveCanonicalVersionFromTexts({
      packageJson: git('show', `${tempRef}:${VERSION_FILE_RELATIVE_PATHS.packageJson}`),
      cargoToml: git('show', `${tempRef}:${VERSION_FILE_RELATIVE_PATHS.cargoToml}`),
      tauriConfig: git('show', `${tempRef}:${VERSION_FILE_RELATIVE_PATHS.tauriConfig}`),
    });
  } finally {
    runQuiet('git', ['update-ref', '-d', tempRef]);
  }

  return {
    branchHeadSha,
    branchRef,
    branchVersion,
    latestTag,
    latestVersion,
    taggedByHead,
    tagRefs,
  };
}

function printRemoteState(options: Options, state: RemoteState): void {
  console.log(`模式: ${options.mode}`);
  console.log(`目标 remote: ${options.remote}`);
  console.log(`目标分支: ${options.branch}`);
  console.log(`远端分支 ref: ${state.branchRef}`);
  console.log(`远端分支提交: ${state.branchHeadSha}`);
  console.log(`远端分支版本: ${state.branchVersion}`);
  console.log(`远端最新 canonical tag: ${state.latestTag ?? '<none>'}`);
  console.log(`远端最新版本: ${state.latestVersion ?? '<none>'}`);
}

function printBumpPlan(options: Options, state: RemoteState): { nextTag: string; nextVersion: string } {
  const localVersion = readCanonicalVersion();
  const versionPlan = resolveReleaseVersionPlan({
    localVersion,
    remoteTags: state.tagRefs.map((entry) => entry.tag),
    bump: options.bump,
    explicitVersion: options.explicitVersion,
  });

  console.log(`当前本地版本: ${localVersion}`);
  console.log(`下一版本: ${versionPlan.nextVersion}`);
  console.log(`下一标签: ${versionPlan.nextTag}`);
  console.log(`校验: ${options.noVerify ? 'skip' : 'bun x tsc --noEmit + bun run website:build'}`);

  return {
    nextTag: versionPlan.nextTag,
    nextVersion: versionPlan.nextVersion,
  };
}

function resolveTagOnlyTarget(state: RemoteState): { tag: string; create: boolean } {
  const desiredTag = `v${state.branchVersion}`;
  if (state.latestVersion && compareCanonicalVersions(state.branchVersion, state.latestVersion) <= 0) {
    throw new Error(
      `远端 ${state.branchRef} 最新提交中的版本 ${state.branchVersion} 未领先于远端最新版本 ${state.latestVersion}，不能创建新的 build tag。`,
    );
  }

  const existingTag = state.tagRefs.find((entry) => entry.tag === desiredTag);
  if (!existingTag) {
    return {
      tag: desiredTag,
      create: true,
    };
  }

  if (existingTag.sha !== state.branchHeadSha) {
    throw new Error(
      `远端标签 ${desiredTag} 已存在，但不指向 ${state.branchRef} 最新提交；拒绝复用。`,
    );
  }

  return {
    tag: desiredTag,
    create: false,
  };
}

function createAndPushTag(tag: string, commitSha: string, remote: string): void {
  if (tagExistsLocally(tag)) {
    const localSha = git('rev-list', '-n', '1', tag);
    if (localSha !== commitSha) {
      throw new Error(`本地标签 ${tag} 已存在，但不指向目标提交 ${commitSha.slice(0, 8)}。`);
    }
  } else {
    runQuiet('git', ['tag', tag, commitSha]);
  }

  run('git', ['push', remote, tag]);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function listBuildReleaseRuns(): BuildReleaseRun[] {
  const raw = runQuiet('gh', [
    'run',
    'list',
    '--workflow',
    'Build & Release',
    '--limit',
    '20',
    '--json',
    'databaseId,displayTitle,event,headBranch,headSha,status,conclusion,url,createdAt',
  ]);

  return raw ? (JSON.parse(raw) as BuildReleaseRun[]) : [];
}

async function waitForBuildReleaseRun(tag: string, sha: string): Promise<BuildReleaseRun> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const matched = listBuildReleaseRuns().find(
      (runInfo) =>
        runInfo.event === 'push' &&
        runInfo.headBranch === tag &&
        runInfo.headSha === sha,
    );

    if (matched) {
      return matched;
    }

    await sleep(5000);
  }

  throw new Error(`在 GitHub Actions 中未找到 ${tag} (${sha.slice(0, 8)}) 对应的 Build & Release workflow。`);
}

async function watchBuildRelease(tag: string, sha: string): Promise<void> {
  const runInfo = await waitForBuildReleaseRun(tag, sha);
  console.log(`Build & Release: ${runInfo.url ?? `<run:${runInfo.databaseId}>`}`);
  run('gh', ['run', 'watch', String(runInfo.databaseId), '--exit-status', '--interval', '20']);
}

async function runBumpAndTag(options: Options, state: RemoteState): Promise<void> {
  assertCurrentBranch(options.branch);
  assertLocalHeadSynced(state.branchHeadSha);

  if (state.taggedByHead.length > 0) {
    console.log(
      `远端 ${state.branchRef} 最新提交已存在 canonical tag ${state.taggedByHead.join(', ')}，没有新的未发布 dev 提交；提前结束。`,
    );
    return;
  }

  const localVersion = readCanonicalVersion();
  if (localVersion !== state.branchVersion) {
    throw new Error(
      `本地版本 ${localVersion} 与远端 ${state.branchRef} 最新提交中的版本 ${state.branchVersion} 不一致；请先同步分支与版本文件。`,
    );
  }
  if (state.latestVersion && compareCanonicalVersions(state.branchVersion, state.latestVersion) > 0) {
    throw new Error(
      `远端 ${state.branchRef} 最新提交的版本 ${state.branchVersion} 已领先于远端最新版本 ${state.latestVersion}；这说明版本 bump 已完成，请改用 --tag-only。`,
    );
  }

  const { nextTag, nextVersion } = printBumpPlan(options, state);
  if (state.tagRefs.some((entry) => entry.tag === nextTag)) {
    throw new Error(`远端标签已存在，拒绝重复创建: ${nextTag}`);
  }
  if (tagExistsLocally(nextTag)) {
    throw new Error(`本地标签已存在，拒绝重复创建: ${nextTag}`);
  }

  if (options.dryRun) {
    console.log('[dry-run] 未执行版本文件修改、commit、push、tag 或 CI 跟踪。');
    return;
  }

  assertCleanWorktree();

  await writeCanonicalVersion(nextVersion);

  if (!options.noVerify) {
    run('bun', ['x', 'tsc', '--noEmit']);
    run('bun', ['run', 'website:build']);
  }

  const commitMessage = `chore(release): bump version to ${nextVersion}`;
  const filesToCommit = [
    VERSION_FILE_RELATIVE_PATHS.packageJson,
    VERSION_FILE_RELATIVE_PATHS.cargoToml,
    VERSION_FILE_RELATIVE_PATHS.tauriConfig,
    OPTIONAL_VERSION_FILE_RELATIVE_PATHS.cargoLock,
  ].filter((relativePath) => existsSync(resolve(process.cwd(), relativePath)));
  run('git', [
    'add',
    ...filesToCommit,
  ]);
  run('git', ['commit', '-m', commitMessage]);
  run('git', ['push', options.remote, options.branch]);

  const refreshedState = fetchRemoteState(options.remote, options.branch);
  if (refreshedState.branchVersion !== nextVersion) {
    throw new Error(
      `远端 ${refreshedState.branchRef} 的版本仍为 ${refreshedState.branchVersion}，预期为 ${nextVersion}；拒绝继续打 tag。`,
    );
  }

  const existingOnHead = refreshedState.taggedByHead.find((tag) => tag === nextTag);
  if (existingOnHead) {
    console.log(`远端 ${refreshedState.branchRef} 最新提交已存在标签 ${nextTag}，改为直接跟踪 CI。`);
  } else {
    if (refreshedState.taggedByHead.length > 0) {
      throw new Error(
        `远端 ${refreshedState.branchRef} 最新提交已存在其他 canonical tag: ${refreshedState.taggedByHead.join(', ')}`,
      );
    }
    createAndPushTag(nextTag, refreshedState.branchHeadSha, options.remote);
  }

  await watchBuildRelease(nextTag, refreshedState.branchHeadSha);
}

async function runTagOnly(options: Options, state: RemoteState): Promise<void> {
  if (state.taggedByHead.length > 0) {
    console.log(
      `远端 ${state.branchRef} 最新提交已存在 canonical tag ${state.taggedByHead.join(', ')}，提前结束，不重复打 tag。`,
    );
    return;
  }

  const target = resolveTagOnlyTarget(state);
  console.log(`tag-only 目标标签: ${target.tag}`);
  console.log(`tag-only 是否需要创建标签: ${target.create ? 'yes' : 'no'}`);

  if (options.dryRun) {
    console.log('[dry-run] 未执行 tag push 或 CI 跟踪。');
    return;
  }

  if (target.create) {
    createAndPushTag(target.tag, state.branchHeadSha, options.remote);
  } else {
    console.log(`远端 ${state.branchRef} 最新提交已经具有 build tag ${target.tag}，改为直接跟踪 CI。`);
  }

  await watchBuildRelease(target.tag, state.branchHeadSha);
}

async function main() {
  const options = parseArgs();
  const state = fetchRemoteState(options.remote, options.branch);
  printRemoteState(options, state);

  if (options.mode === 'tag-only') {
    await runTagOnly(options, state);
    return;
  }

  await runBumpAndTag(options, state);
}

await main();
