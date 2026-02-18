#!/usr/bin/env bun

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { ensureRecordAudioPermissionInManifestFile } from './android-manifest-permission-lib';
import { resolveTauriExecutable } from './tauri-cli-lib';

type AndroidLifecycleCommand = 'init' | 'build' | 'dev';

const ANDROID_LIFECYCLE_COMMANDS: AndroidLifecycleCommand[] = ['init', 'build', 'dev'];

function getAndroidLifecycleCommand(args: string[]): AndroidLifecycleCommand | null {
  if (args[0] !== 'android') {
    return null;
  }

  const candidate = args[1] as AndroidLifecycleCommand | undefined;
  return candidate && ANDROID_LIFECYCLE_COMMANDS.includes(candidate) ? candidate : null;
}

function ensureAndroidRecordAudioPermission(projectRoot: string): void {
  const manifestPath = join(projectRoot, 'src-tauri', 'gen', 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
  const result = ensureRecordAudioPermissionInManifestFile(manifestPath);

  if (result.status === 'updated') {
    console.log('[android-permission] injected android.permission.RECORD_AUDIO');
    return;
  }

  if (result.status === 'missing-file') {
    console.log('[android-permission] skipped: AndroidManifest.xml not found yet');
    return;
  }

  if (result.status === 'already-present') {
    console.log('[android-permission] already present');
    return;
  }

  console.warn('[android-permission] skipped: manifest format is not recognized');
}

function main(): never {
  const tauriArgs = process.argv.slice(2);
  const androidCommand = getAndroidLifecycleCommand(tauriArgs);

  // For build/dev: patch first, then execute tauri.
  if (androidCommand && androidCommand !== 'init') {
    ensureAndroidRecordAudioPermission(process.cwd());
  }

  const tauriExecutable = resolveTauriExecutable({ projectRoot: process.cwd() });
  const run = spawnSync(tauriExecutable, tauriArgs, { stdio: 'inherit' });

  if (run.error) {
    throw run.error;
  }

  // For init: project is generated after command, so patch here.
  if (androidCommand === 'init' && run.status === 0) {
    ensureAndroidRecordAudioPermission(process.cwd());
  }

  process.exit(run.status ?? 1);
}

main();
