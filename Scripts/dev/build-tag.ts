#!/usr/bin/env bun

/**
 * build-tag.ts — 统一构建标签生成脚本
 *
 * 格式: build/v{version}-build.{seq}.{YYYYMMDD}T{HHmm}Z
 * 示例: build/v0.3.3-build.1.20260227T1349Z
 *
 * 用法:
 *   bun run build:tag              # 创建并推送标签
 *   bun run build:tag --dry-run    # 仅预览，不执行
 *   bun run build:tag --no-push    # 创建标签但不推送
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

function readVersion(): string {
  const pkgPath = join(import.meta.dir, '..', '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  const version = pkg.version;
  if (!version) {
    throw new Error('package.json 中未找到 version 字段');
  }
  return version;
}

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf-8' }).trim();
}

/**
 * 查询当前版本已有的最大构建序号
 *
 * 兼容两种格式:
 *   新格式: build/v{version}-build.{N}.{timestamp}Z  → 提取 N
 *   旧格式: build/v{version}-build.{timestamp}       → 按数量计入
 */
function getNextBuildNumber(version: string): number {
  let tags: string;
  try {
    tags = git('tag', '--list', `build/v${version}-build.*`);
  } catch {
    return 1;
  }

  if (!tags) return 1;

  const escaped = version.replace(/\./g, '\\.');
  // 新格式: build/v0.3.3-build.{N}.20260227T1349Z
  const newPattern = new RegExp(`^build/v${escaped}-build\\.(\\d+)\\.\\d{8}T\\d{4}Z$`);
  // 旧格式: build/v0.3.3-build.20260227T1545 (无序号)
  const oldPattern = new RegExp(`^build/v${escaped}-build\\.\\d{8}T\\d{4}$`);

  let maxSeq = 0;
  let oldCount = 0;

  for (const tag of tags.split('\n')) {
    const newMatch = tag.match(newPattern);
    if (newMatch) {
      const num = parseInt(newMatch[1], 10);
      if (num > maxSeq) maxSeq = num;
      continue;
    }
    if (oldPattern.test(tag)) {
      oldCount++;
    }
  }

  // 新序号 = max(已有最大序号, 旧标签总数) + 1
  return Math.max(maxSeq, oldCount) + 1;
}

function formatUtcTimestamp(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const h = String(now.getUTCHours()).padStart(2, '0');
  const min = String(now.getUTCMinutes()).padStart(2, '0');
  return `${y}${m}${d}T${h}${min}Z`;
}

function main() {
  const opts = parseArgs();
  const version = readVersion();
  const seq = getNextBuildNumber(version);
  const timestamp = formatUtcTimestamp();
  const tag = `build/v${version}-build.${seq}.${timestamp}`;

  console.log(`版本: v${version}`);
  console.log(`构建序号: ${seq}`);
  console.log(`时间戳 (UTC): ${timestamp}`);
  console.log(`标签: ${tag}`);

  if (opts.dryRun) {
    console.log('\n[dry-run] 未执行任何操作');
    return;
  }

  // 创建标签
  git('tag', tag);
  console.log(`\n✓ 标签已创建: ${tag}`);

  if (opts.noPush) {
    console.log('(--no-push) 标签未推送');
    return;
  }

  // 推送标签
  git('push', 'origin', tag);
  console.log(`✓ 标签已推送: ${tag}`);
}

main();
