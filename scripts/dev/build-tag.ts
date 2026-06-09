#!/usr/bin/env bun

/**
 * build-tag.ts — 单一发布标签生成脚本
 *
 * 格式: v{version}
 * 示例: v0.4.0
 *
 * 说明:
 * - patch 位（补丁位）就是连续构建序号，不再区分 build 版本和 release 版本
 * - 版本号必须同时与 package.json / Cargo.toml / tauri.conf.json 对齐
 */

import { execFileSync } from 'node:child_process';
import { readCanonicalVersion } from './release-version-lib.ts';

type Options = {
  dryRun: boolean;
  noPush: boolean;
};

function parseArgs(): Options {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes('--dry-run'),
    noPush: args.includes('--no-push'),
  };
}

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf-8' }).trim();
}

function tagExists(tag: string): boolean {
  try {
    git('rev-parse', '-q', '--verify', `refs/tags/${tag}`);
    return true;
  } catch {
    return false;
  }
}

function remoteTagExists(tag: string): boolean {
  try {
    return Boolean(git('ls-remote', '--tags', '--refs', 'origin', tag));
  } catch {
    return false;
  }
}

function main() {
  const options = parseArgs();
  const version = readCanonicalVersion();
  const tag = `v${version}`;

  console.log(`规范版本 (canonical version / 规范版本): ${version}`);
  console.log(`发布标签 (release tag / 发布标签): ${tag}`);

  if (tagExists(tag)) {
    throw new Error(`标签已存在，拒绝重复创建: ${tag}`);
  }
  if (remoteTagExists(tag)) {
    throw new Error(`远端标签已存在，拒绝重复创建: ${tag}`);
  }

  if (options.dryRun) {
    console.log('[dry-run] 未执行任何操作');
    return;
  }

  git('tag', tag);
  console.log(`✓ 标签已创建: ${tag}`);

  if (options.noPush) {
    console.log('(--no-push) 标签未推送');
    return;
  }

  git('push', 'origin', tag);
  console.log(`✓ 标签已推送: ${tag}`);
}

main();
