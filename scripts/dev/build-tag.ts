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

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf-8' }).trim();
}

function readPackageVersion(): string {
  const pkgPath = join(import.meta.dir, '..', '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  return String(pkg.version ?? '').trim();
}

function readCargoVersion(): string {
  const cargoPath = join(import.meta.dir, '..', '..', 'src-tauri', 'Cargo.toml');
  const cargoText = readFileSync(cargoPath, 'utf-8');
  const match = cargoText.match(/^\s*version\s*=\s*"([^"]+)"\s*$/m);
  return match?.[1]?.trim() ?? '';
}

function readTauriVersion(): string {
  const tauriPath = join(import.meta.dir, '..', '..', 'src-tauri', 'tauri.conf.json');
  const tauriConfig = JSON.parse(readFileSync(tauriPath, 'utf-8'));
  return String(tauriConfig.version ?? '').trim();
}

function assertCanonicalVersion(version: string) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`版本号必须是 0.x.y 形式的纯语义化版本，当前为: ${version}`);
  }
}

function resolveCanonicalVersion(): string {
  const versions = {
    packageJson: readPackageVersion(),
    cargoToml: readCargoVersion(),
    tauriConfig: readTauriVersion(),
  };

  const uniqueVersions = [...new Set(Object.values(versions).filter(Boolean))];
  if (uniqueVersions.length !== 1) {
    throw new Error(
      `版本号未对齐: package.json=${versions.packageJson}, Cargo.toml=${versions.cargoToml}, tauri.conf.json=${versions.tauriConfig}`,
    );
  }

  const version = uniqueVersions[0];
  assertCanonicalVersion(version);
  return version;
}

function tagExists(tag: string): boolean {
  try {
    git('rev-parse', '-q', '--verify', `refs/tags/${tag}`);
    return true;
  } catch {
    return false;
  }
}

function main() {
  const options = parseArgs();
  const version = resolveCanonicalVersion();
  const tag = `v${version}`;

  console.log(`规范版本 (canonical version / 规范版本): ${version}`);
  console.log(`发布标签 (release tag / 发布标签): ${tag}`);

  if (tagExists(tag)) {
    throw new Error(`标签已存在，拒绝重复创建: ${tag}`);
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
