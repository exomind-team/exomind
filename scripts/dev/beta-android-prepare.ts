import {
  closeSync, lstatSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  ANDROID_CONFIG_CHANGES_VALUE,
  ensureAndroidSystemBarsInMainActivity,
  ensureConfigChangesInManifest,
} from './android-manifest-permission-lib';

const BETA_PACKAGE = 'com.exomind.app.v06.beta';
const ANDROID_APP = ['src-tauri', 'gen', 'android', 'app'];

export interface BetaAndroidPreparation {
  projectRoot: string;
  changedFiles: string[];
}

interface FileChange { path: string; before: string; after: string }

/** This operation edits generated sources only. It never initializes a project,
 * runs Gradle, installs permissions, starts ADB, or selects a default root. */
export class BetaAndroidPreparationError extends Error {
  constructor(message: string, public readonly completedFiles: string[] = [], public readonly cause?: unknown) {
    super(message);
    this.name = 'BetaAndroidPreparationError';
  }
}

function reject(message: string): never {
  throw new BetaAndroidPreparationError(message);
}

function sourceFile(projectRoot: string, parts: string[]): string {
  let path = projectRoot;
  for (const [index, part] of parts.entries()) {
    path = join(path, part);
    const metadata = lstatSync(path);
    if (metadata.isSymbolicLink() || (index === parts.length - 1 ? !metadata.isFile() : !metadata.isDirectory())) {
      reject('Beta Android source paths must be ordinary files inside the explicit project root');
    }
  }
  const local = relative(projectRoot, path);
  if (!local || local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)) reject('Invalid Beta source path');
  return path;
}

function withoutComments(source: string): string {
  // This validator accepts the narrow generated Gradle/Kotlin/XML forms. It
  // deliberately rejects unfamiliar integration rather than guessing a repair.
  return source.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function assertGradle(source: string): void {
  const code = withoutComments(source);
  for (const field of ['namespace', 'applicationId']) {
    const declarations = [...code.matchAll(new RegExp(`^\\s*${field}\\s*=\\s*(["'])([^"']+)\\1`, 'gm'))];
    if (declarations.length !== 1 || declarations[0][2] !== BETA_PACKAGE) {
      reject(`Generated Android ${field} must explicitly equal the Beta package`);
    }
  }
}

function attribute(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])(.*?)\\1`))?.[2];
}

function assertManifest(source: string): void {
  const xml = withoutComments(source);
  const manifest = xml.match(/<manifest\b[^>]*>/)?.[0];
  if (!manifest || /<!DOCTYPE|<!ENTITY/i.test(xml)) reject('Unsupported Beta Android Manifest');
  const packageName = attribute(manifest, 'package');
  if (packageName && packageName !== BETA_PACKAGE) reject('Android Manifest package must match Beta');
  const activities = [...xml.matchAll(/<activity\b[^>]*>[\s\S]*?<\/activity\s*>/g)];
  if (activities.length !== 1 || /<activity-alias\b/.test(xml)) reject('Expected one explicit Beta launcher Activity');
  const activity = activities[0][0];
  const name = attribute(activity.slice(0, activity.indexOf('>') + 1), 'android:name');
  if (name !== '.MainActivity' && name !== `${BETA_PACKAGE}.MainActivity`) reject('Beta launcher must use its MainActivity');
  const launcher = [...activity.matchAll(/<intent-filter\b[^>]*>[\s\S]*?<\/intent-filter\s*>/g)].some(([filter]) =>
    /<action\b[^>]*android:name\s*=\s*["']android\.intent\.action\.MAIN["']/.test(filter)
    && /<category\b[^>]*android:name\s*=\s*["']android\.intent\.category\.LAUNCHER["']/.test(filter));
  if (!launcher) reject('Beta MainActivity must own the MAIN/LAUNCHER intent filter');
}

function assertActivity(source: string, integrated: boolean): void {
  const code = withoutComments(source);
  const packages = [...code.matchAll(/^\s*package\s+([^\s;]+)\s*;?\s*$/gm)];
  if (packages.length !== 1 || packages[0][1] !== BETA_PACKAGE
    || !/class\s+MainActivity\s*:\s*TauriActivity\(\)/.test(code)) reject('Kotlin MainActivity package must match Beta');
  if (!integrated) return;
  const required = [
    /@androidx\.annotation\.Keep\s+fun setExomindFullscreen\(enabled: Boolean\)/,
    /super\.onCreate\(savedInstanceState\)\s+installExomindSystemBarInsets\(\)/,
    /override fun onConfigurationChanged\([^)]*\)[^{]*\{\s*super\.onConfigurationChanged\(newConfig\)\s+applyExomindSystemBars\(\)/,
    /super\.onResume\(\)\s+applyExomindSystemBars\(\)/,
    /if \(hasFocus\) applyExomindSystemBars\(\)/,
    /getInsets\(if \(exomindFullscreen\) cutout else bars or cutout\)/,
    /setInsets\(bars or cutout, androidx\.core\.graphics\.Insets\.NONE\)/,
    /setInsetsIgnoringVisibility\(bars or cutout, androidx\.core\.graphics\.Insets\.NONE\)/,
    /if \(exomindFullscreen\) controller\.hide\(bars\) else controller\.show\(bars\)/,
    /window\.setSoftInputMode\(android\.view\.WindowManager\.LayoutParams\.SOFT_INPUT_ADJUST_RESIZE\)/,
    /val ime = androidx\.core\.view\.WindowInsetsCompat\.Type\.ime\(\)/,
    /maxOf\(padding\.bottom, insets\.getInsets\(ime\)\.bottom\)/,
    /\.setInsets\(ime, androidx\.core\.graphics\.Insets\.NONE\)/,
  ];
  if (required.some(pattern => !pattern.test(code)) || /WindowInsetsCompat\.CONSUMED/.test(code)) {
    reject('Incomplete Beta Activity system-bar integration; no files were written');
  }
  for (const method of ['setExomindFullscreen', 'onConfigurationChanged', 'onResume', 'onWindowFocusChanged']) {
    if ([...code.matchAll(new RegExp(`\\bfun\\s+${method}\\s*\\(`, 'g'))].length !== 1) {
      reject(`Ambiguous Beta Activity method: ${method}`);
    }
  }
}

/** The shared Alpha bar recipe preserves IME for its existing host. A fresh
 * edge-to-edge Beta Activity must apply those insets itself: Android's default
 * adjustPan leaves its bottom composer underneath the keyboard on API 35. */
function applyBetaImeInsets(activity: string): string {
  if (activity.includes('val ime = androidx.core.view.WindowInsetsCompat.Type.ime()')) return activity;
  const anchors = [
    '    androidx.core.view.WindowCompat.setDecorFitsSystemWindows(window, false)',
    '      view.setPadding(padding.left, padding.top, padding.right, padding.bottom)',
    '        .setInsets(bars or cutout, androidx.core.graphics.Insets.NONE)',
  ];
  if (anchors.some(anchor => activity.split(anchor).length !== 2)) {
    reject('Unsupported Beta IME inset integration; no files were written');
  }
  const newline = activity.includes('\r\n') ? '\r\n' : '\n';
  return activity
    .replace(anchors[0], `    window.setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)${newline}${anchors[0]}`)
    .replace(anchors[1], [
      '      val ime = androidx.core.view.WindowInsetsCompat.Type.ime()',
      '      view.setPadding(padding.left, padding.top, padding.right, maxOf(padding.bottom, insets.getInsets(ime).bottom))',
    ].join(newline))
    .replace('// Consume only what this root already applied; preserve IME insets.', '// Consume the bar and IME padding applied here; avoid applying it again in the child.')
    .replace(anchors[2], `${anchors[2]}${newline}        .setInsets(ime, androidx.core.graphics.Insets.NONE)`);
}

function writeChanges(changes: FileChange[]): string[] {
  const staged: { change: FileChange; temporary: string }[] = [];
  const completed: string[] = [];
  try {
    for (const change of changes) {
      const temporary = `${change.path}.beta-prepare-${randomUUID()}.tmp`;
      const descriptor = openSync(temporary, 'wx');
      staged.push({ change, temporary });
      try { writeFileSync(descriptor, change.after, { encoding: 'utf8' }); }
      finally { closeSync(descriptor); }
    }
    for (const { change, temporary } of staged) {
      if (lstatSync(change.path).isSymbolicLink() || readFileSync(change.path, 'utf8') !== change.before) {
        reject('Generated Beta source changed during preparation; preserving the newer source');
      }
      renameSync(temporary, change.path);
      completed.push(change.path);
    }
    return completed;
  } catch (cause) {
    throw new BetaAndroidPreparationError(
      completed.length ? 'Beta preparation partially completed; inspect completedFiles and rerun after resolving the source error'
        : 'Beta preparation failed before replacing generated sources',
      completed, cause,
    );
  } finally {
    // Only the uniquely named temporary files created by this operation.
    for (const { temporary } of staged) {
      try { unlinkSync(temporary); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          // Preserve a leftover diagnostic file rather than mask the primary failure.
          process.stderr.write('[beta-android-prepare] owned temporary file could not be removed\n');
        }
      }
    }
  }
}

export function prepareBetaAndroid(projectRoot: string): BetaAndroidPreparation {
  if (!isAbsolute(projectRoot) || lstatSync(projectRoot).isSymbolicLink() || !lstatSync(projectRoot).isDirectory()) {
    reject('An explicit absolute Beta project root is required');
  }
  for (let ancestor = projectRoot; ; ancestor = dirname(ancestor)) {
    if (lstatSync(ancestor).isSymbolicLink()) reject('Beta project root must not traverse symbolic links or junctions');
    if (dirname(ancestor) === ancestor) break;
  }
  const configPath = sourceFile(projectRoot, ['src-tauri', 'tauri.beta.conf.json']);
  const config: unknown = JSON.parse(readFileSync(configPath, 'utf8'));
  if (!config || typeof config !== 'object' || !('identifier' in config) || config.identifier !== BETA_PACKAGE) {
    reject('Project configuration does not identify ExoMind Beta');
  }
  const gradlePath = sourceFile(projectRoot, [...ANDROID_APP, 'build.gradle.kts']);
  const manifestPath = sourceFile(projectRoot, [...ANDROID_APP, 'src', 'main', 'AndroidManifest.xml']);
  const activityPath = sourceFile(projectRoot, [...ANDROID_APP, 'src', 'main', 'java', ...BETA_PACKAGE.split('.'), 'MainActivity.kt']);
  const gradle = readFileSync(gradlePath, 'utf8');
  const manifest = readFileSync(manifestPath, 'utf8');
  const activity = readFileSync(activityPath, 'utf8');
  assertGradle(gradle); assertManifest(manifest); assertActivity(activity, false);
  const nextManifest = ensureConfigChangesInManifest(manifest).manifestXml;
  const nextActivity = applyBetaImeInsets(ensureAndroidSystemBarsInMainActivity(activity, { ensureConfigurationChanged: true }).activityKotlin);
  assertManifest(nextManifest); assertActivity(nextActivity, true);
  if (attribute(withoutComments(nextManifest).match(/<activity\b[^>]*>/)?.[0] ?? '', 'android:configChanges') !== ANDROID_CONFIG_CHANGES_VALUE) {
    reject('Beta Activity configChanges integration is missing');
  }
  const changes = [{ path: manifestPath, before: manifest, after: nextManifest }, { path: activityPath, before: activity, after: nextActivity }]
    .filter(change => change.before !== change.after);
  return { projectRoot, changedFiles: writeChanges(changes) };
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== '--project-root' || !args[1]) {
      reject('Usage: bun scripts/dev/beta-android-prepare.ts --project-root <absolute Beta staging root>');
    }
    const result = prepareBetaAndroid(args[1]);
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    process.stderr.write(`[beta-android-prepare] ${error instanceof Error ? error.message : 'preparation failed'}\n`);
    if (error instanceof BetaAndroidPreparationError && error.completedFiles.length) {
      process.stderr.write(JSON.stringify({ completedFiles: error.completedFiles }) + '\n');
    }
    process.exitCode = 1;
  }
}
