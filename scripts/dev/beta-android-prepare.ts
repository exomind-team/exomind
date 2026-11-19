import {
  closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ensureBetaApplicationIcons,planBetaAndroidBranding,sameGeneratedBytes,type BetaGeneratedChange as FileChange } from './beta-android-branding';
import {
  ACCESS_NETWORK_STATE_PERMISSION,
  ACCESS_WIFI_STATE_PERMISSION,
  ANDROID_CONFIG_CHANGES_VALUE,
  CHANGE_WIFI_MULTICAST_STATE_PERMISSION,
  MODIFY_AUDIO_SETTINGS_PERMISSION,
  RECORD_AUDIO_PERMISSION,
  ensureAndroidSystemBarsInMainActivity,
  ensureConfigChangesInManifest,
  ensureDebugNativeLibsAreStrippedInGradle,
  ensureWebViewAudioCapturePermissionsInManifest,
  ensureConfiguredNdkVersionInGradle,
  resolveInstalledNdkVersion,
} from './android-manifest-permission-lib';

const BETA_PACKAGE = 'com.exomind.app.v06.beta';
const ANDROID_APP = ['src-tauri', 'gen', 'android', 'app'];
const NATIVE_SYMBOLS_PROPERTY = 'exomind.keepNativeSymbols';
const TAURI_ANDROID_INIT_CONFIG_CHANGES_VALUE = 'orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode';
const ALLOWED_BETA_ANDROID_PERMISSIONS = new Set([
  'android.permission.INTERNET',
  RECORD_AUDIO_PERMISSION,
  MODIFY_AUDIO_SETTINGS_PERMISSION,
  ACCESS_NETWORK_STATE_PERMISSION,
  ACCESS_WIFI_STATE_PERMISSION,
  CHANGE_WIFI_MULTICAST_STATE_PERMISSION,
]);

export interface BetaAndroidPreparation {
  projectRoot: string;
  changedFiles: string[];
}


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

function assertKnownAttributes(tag: string, allowed: readonly string[], label: string): void {
  const names = [...tag.matchAll(/\s([A-Za-z_][A-Za-z0-9_.:-]*)\s*=/g)].map(match => match[1]);
  if (names.length !== new Set(names).size || names.some(name => !allowed.includes(name))) {
    reject(`Unsupported ${label} attributes in the generated Beta Android template`);
  }
}

function assertPermissions(xml: string, requireAudio: boolean): void {
  const permissionOpenings = [...xml.matchAll(/<uses-permission(?=\s|\/?>)/g)];
  const declarations = [...xml.matchAll(/<uses-permission(?=\s|\/?>)[^>]*\/>/g)];
  if (permissionOpenings.length !== declarations.length) reject('Unsupported Beta Android permission declaration shape');
  for (const [tag] of declarations) assertKnownAttributes(tag, ['android:name'], 'uses-permission');
  const names = declarations.map(([tag]) => attribute(tag, 'android:name'));
  if (names.some(name => !name || !ALLOWED_BETA_ANDROID_PERMISSIONS.has(name))
    || names.length !== new Set(names).size
    || names.filter(name => name === 'android.permission.INTERNET').length !== 1) {
    reject('Unsupported or duplicate permission in the generated Beta Android template');
  }
  if (requireAudio && [RECORD_AUDIO_PERMISSION, MODIFY_AUDIO_SETTINGS_PERMISSION]
    .some(permission => names.filter(name => name === permission).length !== 1)) {
    reject('Beta Android template is missing a required audio capture permission');
  }
}

function assertLauncherActivity(activity: string): void {
  const opening = activity.slice(0, activity.indexOf('>') + 1);
  assertKnownAttributes(opening, ['android:configChanges', 'android:launchMode', 'android:label', 'android:name', 'android:exported'], 'MainActivity');
  if ((attribute(opening, 'android:name') !== '.MainActivity' && attribute(opening, 'android:name') !== `${BETA_PACKAGE}.MainActivity`)
    || attribute(opening, 'android:launchMode') !== 'singleTask'
    || attribute(opening, 'android:label') !== '@string/main_activity_title'
    || attribute(opening, 'android:exported') !== 'true'
    || ![TAURI_ANDROID_INIT_CONFIG_CHANGES_VALUE, ANDROID_CONFIG_CHANGES_VALUE]
      .includes(attribute(opening, 'android:configChanges') ?? '')) {
    reject('Unsupported Beta MainActivity in the generated Android template');
  }
  const filters = [...activity.matchAll(/<intent-filter\b[^>]*>[\s\S]*?<\/intent-filter\s*>/g)];
  if (filters.length !== 1) reject('Beta MainActivity must own exactly one launcher intent filter');
  const filterOpening = filters[0][0].slice(0, filters[0][0].indexOf('>') + 1);
  assertKnownAttributes(filterOpening, [], 'launcher intent filter');
  const actions = [...filters[0][0].matchAll(/<action\b[^>]*\/>/g)];
  const categories = [...filters[0][0].matchAll(/<category\b[^>]*\/>/g)];
  for (const [tag] of actions) assertKnownAttributes(tag, ['android:name'], 'launcher action');
  for (const [tag] of categories) assertKnownAttributes(tag, ['android:name'], 'launcher category');
  if (actions.length !== 1 || attribute(actions[0][0], 'android:name') !== 'android.intent.action.MAIN'
    || categories.length !== 2
    || !categories.some(([tag]) => attribute(tag, 'android:name') === 'android.intent.category.LAUNCHER')
    || !categories.some(([tag]) => attribute(tag, 'android:name') === 'android.intent.category.LEANBACK_LAUNCHER')) {
    reject('Unsupported Beta launcher intent filter in the generated Android template');
  }
  const filterBody = filters[0][0].slice(filterOpening.length).replace(/<action\b[^>]*\/>|<category\b[^>]*\/>/g, '');
  const activityBody = activity.slice(opening.length, activity.lastIndexOf('</activity>')).replace(filters[0][0], '');
  if (/<[A-Za-z_]/.test(filterBody) || /<[A-Za-z_]/.test(activityBody)) reject('Unsupported Beta MainActivity content in the generated Android template');
}

function assertFileProvider(provider: string): void {
  const opening = provider.slice(0, provider.indexOf('>') + 1);
  assertKnownAttributes(opening, ['android:name', 'android:authorities', 'android:exported', 'android:grantUriPermissions'], 'FileProvider');
  if (attribute(opening, 'android:name') !== 'androidx.core.content.FileProvider'
    || attribute(opening, 'android:authorities') !== '${applicationId}.fileprovider'
    || attribute(opening, 'android:exported') !== 'false'
    || attribute(opening, 'android:grantUriPermissions') !== 'true') {
    reject('Unsupported FileProvider in the generated Beta Android template');
  }
  const metadata = [...provider.matchAll(/<meta-data\b[^>]*\/>/g)];
  for (const [tag] of metadata) assertKnownAttributes(tag, ['android:name', 'android:resource'], 'FileProvider metadata');
  if (metadata.length !== 1 || attribute(metadata[0][0], 'android:name') !== 'android.support.FILE_PROVIDER_PATHS'
    || attribute(metadata[0][0], 'android:resource') !== '@xml/file_paths') {
    reject('Unsupported FileProvider metadata in the generated Beta Android template');
  }
  const body = provider.slice(opening.length, provider.lastIndexOf('</provider>')).replace(metadata[0]?.[0] ?? '', '');
  if (/<[A-Za-z_]/.test(body)) reject('Unsupported FileProvider content in the generated Beta Android template');
}

function assertApplication(xml: string): string {
  const applications = [...xml.matchAll(/<application\b[^>]*>[\s\S]*?<\/application\s*>/g)];
  if (applications.length !== 1 || [...xml.matchAll(/<application\b/g)].length !== 1) {
    reject('Expected one Tauri application in the generated Beta Android template');
  }
  const application = applications[0][0];
  const opening = application.slice(0, application.indexOf('>') + 1);
  assertKnownAttributes(opening, ['android:icon', 'android:roundIcon', 'android:label', 'android:theme', 'android:usesCleartextTraffic'], 'application');
  const cleartext = attribute(opening, 'android:usesCleartextTraffic');
  if (attribute(opening, 'android:icon') !== '@mipmap/ic_launcher'
    || (attribute(opening, 'android:roundIcon') !== undefined && attribute(opening, 'android:roundIcon') !== '@mipmap/ic_launcher_round')
    || attribute(opening, 'android:label') !== '@string/app_name'
    || !attribute(opening, 'android:theme')?.startsWith('@style/Theme.')
    || (cleartext !== '${usesCleartextTraffic}' && cleartext !== 'true')) {
    reject('Unsupported application attributes in the generated Beta Android template');
  }

  const activities = [...application.matchAll(/<activity\b[^>]*>[\s\S]*?<\/activity\s*>/g)];
  const providers = [...application.matchAll(/<provider\b[^>]*>[\s\S]*?<\/provider\s*>/g)];
  if (activities.length !== 1 || [...application.matchAll(/<activity\b/g)].length !== 1
    || providers.length !== 1 || [...application.matchAll(/<provider\b/g)].length !== 1) {
    reject('Unsupported application children in the generated Beta Android template');
  }
  assertLauncherActivity(activities[0][0]);
  assertFileProvider(providers[0][0]);
  const body = application.slice(opening.length, application.lastIndexOf('</application>'))
    .replace(activities[0][0], '').replace(providers[0][0], '');
  if (/<[A-Za-z_]/.test(body)) reject('Unsupported application content in the generated Beta Android template');
  return application;
}

function assertManifest(source: string, requireAudio = false): void {
  const xml = withoutComments(source);
  const manifests = [...xml.matchAll(/<manifest\b[^>]*>/g)];
  const manifestClosings = [...xml.matchAll(/<\/manifest\s*>/g)];
  if (manifests.length !== 1 || manifestClosings.length !== 1 || /<!DOCTYPE|<!ENTITY/i.test(xml)) {
    reject('Unsupported Beta Android Manifest template');
  }
  const manifest = manifests[0][0];
  assertKnownAttributes(manifest, ['xmlns:android', 'package'], 'manifest');
  if (attribute(manifest, 'xmlns:android') !== 'http://schemas.android.com/apk/res/android') {
    reject('Unsupported Android namespace in the generated Beta Android template');
  }
  const packageName = attribute(manifest, 'package');
  if (packageName && packageName !== BETA_PACKAGE) reject('Android Manifest package must match Beta');
  assertPermissions(xml, requireAudio);

  const features = [...xml.matchAll(/<uses-feature\b[^>]*\/>/g)];
  if ([...xml.matchAll(/<uses-feature\b/g)].length !== features.length || features.length !== 1
    || attribute(features[0][0], 'android:name') !== 'android.software.leanback'
    || attribute(features[0][0], 'android:required') !== 'false') {
    reject('Unsupported uses-feature in the generated Beta Android template');
  }
  assertKnownAttributes(features[0][0], ['android:name', 'android:required'], 'uses-feature');
  const application = assertApplication(xml);
  const rootBody = xml.slice(manifests[0].index! + manifests[0][0].length, xml.lastIndexOf('</manifest>'))
    .replace(application, '')
    .replace(/<uses-permission(?=\s|\/?>)[^>]*\/>/g, '')
    .replace(/<uses-feature\b[^>]*\/>/g, '');
  if (/<[A-Za-z_]/.test(rootBody)) reject('Unsupported Android Manifest content in the generated Beta template');
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
      mkdirSync(dirname(change.path),{recursive:true});
      const temporary = `${change.path}.beta-prepare-${randomUUID()}.tmp`;
      const descriptor = openSync(temporary, 'wx');
      staged.push({ change, temporary });
      try { writeFileSync(descriptor, change.after, { encoding: 'utf8' }); }
      finally { closeSync(descriptor); }
    }
    for (const { change, temporary } of staged) {
      if (existsSync(change.path)&&lstatSync(change.path).isSymbolicLink() || !sameGeneratedBytes(existsSync(change.path)?readFileSync(change.path):null,change.before)) {
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

function prepareNativeSymbols(gradle: string): string {
  // Generated files are ignored. Keep this policy in the maintained prepare
  // step so a clean android init and every local/CI candidate get the same rule.
  if (gradle.includes(`val keepNativeSymbols = providers.gradleProperty("${NATIVE_SYMBOLS_PROPERTY}")`)) return gradle;
  const stripped = ensureDebugNativeLibsAreStrippedInGradle(gradle).buildGradleKts;
  const newline = gradle.includes('\r\n') ? '\r\n' : '\n';
  return stripped.replace(/^([ \t]*)isJniDebuggable[ \t]*=[ \t]*(?:true|false)[ \t]*(\r?)$/m, (_line, indent: string, carriage: string) => [
    `${indent}val keepNativeSymbols = providers.gradleProperty("${NATIVE_SYMBOLS_PROPERTY}").orNull?.toBoolean() ?: false`,
    `${indent}isJniDebuggable = keepNativeSymbols`,
    `${indent}if (keepNativeSymbols) { packaging { jniLibs.keepDebugSymbols.add("**/*.so") } }`,
  ].join(newline)+carriage);
}

export function prepareBetaAndroid(projectRoot: string, options: {ndkVersion?: string | null} = {}): BetaAndroidPreparation {
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
  // AGP no longer consults ANDROID_NDK_HOME. Pin its strip tool to the same
  // installed NDK used by Rust instead of silently packaging an unstripped SO.
  const ndkVersion = options.ndkVersion === undefined ? resolveInstalledNdkVersion() : options.ndkVersion;
  const nextGradle = ensureConfiguredNdkVersionInGradle(prepareNativeSymbols(gradle),ndkVersion).buildGradleKts;
  assertGradle(nextGradle);
  const audioManifest = ensureWebViewAudioCapturePermissionsInManifest(
    ensureConfigChangesInManifest(manifest).manifestXml,
  ).manifestXml;
  const nextManifest = ensureBetaApplicationIcons(audioManifest);
  const nextActivity = applyBetaImeInsets(ensureAndroidSystemBarsInMainActivity(activity, { ensureConfigurationChanged: true }).activityKotlin);
  assertManifest(nextManifest, true); assertActivity(nextActivity, true);
  if (attribute(withoutComments(nextManifest).match(/<activity\b[^>]*>/)?.[0] ?? '', 'android:configChanges') !== ANDROID_CONFIG_CHANGES_VALUE) {
    reject('Beta Activity configChanges integration is missing');
  }
  const changes:FileChange[] = [{ path: gradlePath, before: gradle, after: nextGradle }, { path: manifestPath, before: manifest, after: nextManifest }, { path: activityPath, before: activity, after: nextActivity }]
    .filter(change => !sameGeneratedBytes(change.before,change.after));
  changes.push(...planBetaAndroidBranding(projectRoot));
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
