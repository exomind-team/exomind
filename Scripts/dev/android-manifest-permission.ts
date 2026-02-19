#!/usr/bin/env bun

import { join } from 'node:path';
import { ensureRecordAudioPermissionInManifestFile } from './android-manifest-permission-lib';

function resolveManifestPath(cliArgs: string[]): string {
  // Default to generated Android manifest（默认定位到 Android 生成清单文件）
  if (cliArgs[0]) {
    return cliArgs[0];
  }

  return join(process.cwd(), 'src-tauri', 'gen', 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
}

function main(): void {
  const manifestPath = resolveManifestPath(process.argv.slice(2));
  const result = ensureRecordAudioPermissionInManifestFile(manifestPath);

  if (result.status === 'missing-file' || result.status === 'invalid-manifest') {
    throw new Error(`[android-permission] patch failed: ${result.status} (${manifestPath})`);
  }

  console.log(`[android-permission] ${result.status}: ${manifestPath}`);
}

main();
