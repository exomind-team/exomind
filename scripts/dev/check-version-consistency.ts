/**
 * 版本号一致性校验脚本
 *
 * 用法:
 *   bun scripts/dev/check-version-consistency.ts [--expected <version>]
 *
 * --expected: 传入预期版本号（如 tag 版本），校验所有文件是否匹配。
 *             不传时仅校验各文件之间版本一致。
 *
 * CI 中通过 GITHUB_REF_NAME 环境变量自动读取 tag 版本作为 expected。
 * 退出码 0 = 通过，1 = 不一致或版本格式错误。
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface VersionSource {
  file: string;
  label: string;
  read: (text: string) => string;
}

const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..');

function readPackageJsonVersion(text: string): string {
  return JSON.parse(text).version?.trim() ?? '';
}

function readCargoTomlVersion(text: string): string {
  const m = text.match(/^\s*version\s*=\s*"([^"]+)"\s*$/m);
  return m?.[1]?.trim() ?? '';
}

function readTauriConfVersion(text: string): string {
  return JSON.parse(text).version?.trim() ?? '';
}

function readCargoLockVersion(text: string, packageName = 'exomind'): string {
  const re = new RegExp(
    `\\[\\[package\\]\\]\\r?\\nname = "${packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\r?\\nversion = "([^"]+)"`,
  );
  const m = text.match(re);
  return m?.[1]?.trim() ?? '';
}

const SOURCES: VersionSource[] = [
  {
    file: resolve(PROJECT_ROOT, 'package.json'),
    label: 'package.json',
    read: readPackageJsonVersion,
  },
  {
    file: resolve(PROJECT_ROOT, 'src-tauri', 'Cargo.toml'),
    label: 'src-tauri/Cargo.toml',
    read: readCargoTomlVersion,
  },
  {
    file: resolve(PROJECT_ROOT, 'src-tauri', 'tauri.conf.json'),
    label: 'src-tauri/tauri.conf.json',
    read: readTauriConfVersion,
  },
];

const CARGO_LOCK_PATH = resolve(PROJECT_ROOT, 'Cargo.lock');

function parseArgs(): { expected?: string } {
  const args = process.argv.slice(2);
  let expected: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--expected' && args[i + 1]) {
      expected = args[++i];
    }
  }

  if (!expected) {
    const refName = process.env.GITHUB_REF_NAME ?? '';
    if (refName.startsWith('v') && /^\d+\.\d+\.\d+$/.test(refName.slice(1))) {
      expected = refName.slice(1);
    }
  }

  return { expected };
}

function main(): never {
  const { expected } = parseArgs();

  const readings: { label: string; file: string; version: string }[] = [];

  for (const src of SOURCES) {
    if (!existsSync(src.file)) {
      console.error(`FAIL: ${src.label} 不存在 (${src.file})`);
      process.exit(1);
    }
    const version = src.read(readFileSync(src.file, 'utf-8'));
    readings.push({ label: src.label, file: src.file, version });
  }

  if (existsSync(CARGO_LOCK_PATH)) {
    const version = readCargoLockVersion(readFileSync(CARGO_LOCK_PATH, 'utf-8'));
    readings.push({ label: 'Cargo.lock (exomind)', file: CARGO_LOCK_PATH, version });
  }

  let hasError = false;

  console.log('=== 版本号一致性校验 ===');
  for (const r of readings) {
    console.log(`  ${r.label}: ${r.version}`);
  }

  const uniqueVersions = [...new Set(readings.map((r) => r.version).filter(Boolean))];

  if (uniqueVersions.length === 0) {
    console.error('FAIL: 未读取到任何有效版本号');
    process.exit(1);
  }

  if (uniqueVersions.length > 1) {
    console.error('FAIL: 版本号不一致:');
    for (const r of readings) {
      console.error(`  ${r.label} = ${r.version}`);
    }
    hasError = true;
  }

  const resolvedVersion = uniqueVersions[0] ?? '';

  if (expected) {
    const expectedClean = expected.replace(/^v/, '').trim();
    if (resolvedVersion !== expectedClean) {
      console.error(
        `FAIL: 文件版本 ${resolvedVersion} 与预期版本 ${expectedClean} 不一致`,
      );
      console.error('  预期来源: --expected 参数 或 GITHUB_REF_NAME tag');
      hasError = true;
    } else {
      console.log(`PASS: 所有文件版本 = ${resolvedVersion}，与预期版本一致`);
    }
  } else if (!hasError) {
    console.log(`PASS: 所有文件版本一致 = ${resolvedVersion}（无 --expected，未校验 tag）`);
  }

  if (hasError) {
    process.exit(1);
  }

  process.exit(0);
}

main();
