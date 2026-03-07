#!/usr/bin/env bun

import { join } from 'node:path';
import {
  ensureMdnsMulticastLockInMainActivityFile,
  ensureReleaseCleartextTrafficInGradleFile,
  ensureRequiredAudioPermissionsInManifestFile,
} from './android-manifest-permission-lib';

function resolveManifestPath(cliArgs: string[]): string {
  // Default to generated Android manifest（默认定位到 Android 生成清单文件）
  if (cliArgs[0]) {
    return cliArgs[0];
  }

  return join(process.cwd(), 'src-tauri', 'gen', 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
}

function resolveBuildGradlePath(cliArgs: string[]): string {
  // Default to generated Android build.gradle.kts（默认定位到 Android 构建配置）
  if (cliArgs[1]) {
    return cliArgs[1];
  }

  return join(process.cwd(), 'src-tauri', 'gen', 'android', 'app', 'build.gradle.kts');
}

function resolveMainActivityPath(cliArgs: string[]): string {
  if (cliArgs[2]) {
    return cliArgs[2];
  }

  return join(
    process.cwd(),
    'src-tauri',
    'gen',
    'android',
    'app',
    'src',
    'main',
    'java',
    'com',
    'exomind',
    'app',
    'MainActivity.kt',
  );
}

function main(): void {
  const cliArgs = process.argv.slice(2);
  const manifestPath = resolveManifestPath(cliArgs);
  const buildGradlePath = resolveBuildGradlePath(cliArgs);
  const mainActivityPath = resolveMainActivityPath(cliArgs);
  const manifestResult = ensureRequiredAudioPermissionsInManifestFile(manifestPath);
  const gradleResult = ensureReleaseCleartextTrafficInGradleFile(buildGradlePath);
  const activityResult = ensureMdnsMulticastLockInMainActivityFile(mainActivityPath);

  if (manifestResult.status === 'missing-file' || manifestResult.status === 'invalid-manifest') {
    throw new Error(`[android-permission] manifest patch failed: ${manifestResult.status} (${manifestPath})`);
  }
  if (gradleResult.status === 'missing-file' || gradleResult.status === 'invalid-gradle') {
    throw new Error(`[android-permission] gradle patch failed: ${gradleResult.status} (${buildGradlePath})`);
  }
  if (activityResult.status === 'missing-file' || activityResult.status === 'invalid-activity') {
    throw new Error(`[android-permission] main activity patch failed: ${activityResult.status} (${mainActivityPath})`);
  }

  console.log(`[android-permission] manifest ${manifestResult.status}: ${manifestPath}`);
  console.log(`[android-permission] gradle ${gradleResult.status}: ${buildGradlePath}`);
  console.log(`[android-permission] activity ${activityResult.status}: ${mainActivityPath}`);
}

main();
