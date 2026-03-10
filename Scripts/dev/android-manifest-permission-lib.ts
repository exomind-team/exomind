import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export const RECORD_AUDIO_PERMISSION = 'android.permission.RECORD_AUDIO';
export const MODIFY_AUDIO_SETTINGS_PERMISSION = 'android.permission.MODIFY_AUDIO_SETTINGS';
export const ACCESS_NETWORK_STATE_PERMISSION = 'android.permission.ACCESS_NETWORK_STATE';
export const ACCESS_WIFI_STATE_PERMISSION = 'android.permission.ACCESS_WIFI_STATE';
export const CHANGE_WIFI_MULTICAST_STATE_PERMISSION = 'android.permission.CHANGE_WIFI_MULTICAST_STATE';
export const REQUIRED_AUDIO_PERMISSIONS = [RECORD_AUDIO_PERMISSION, MODIFY_AUDIO_SETTINGS_PERMISSION] as const;
export const REQUIRED_NETWORK_DISCOVERY_PERMISSIONS = [
  ACCESS_NETWORK_STATE_PERMISSION,
  ACCESS_WIFI_STATE_PERMISSION,
  CHANGE_WIFI_MULTICAST_STATE_PERMISSION,
] as const;
export const RELEASE_CLEARTEXT_PLACEHOLDER = 'manifestPlaceholders["usesCleartextTraffic"] = "true"';
const DEBUG_KEEP_SYMBOLS_MARKER = 'jniLibs.keepDebugSymbols.add(';

export type ManifestPatchResult = {
  manifestXml: string;
  changed: boolean;
};

export type ManifestFilePatchResult =
  | { status: 'updated'; changed: true }
  | { status: 'already-present'; changed: false }
  | { status: 'missing-file'; changed: false }
  | { status: 'invalid-manifest'; changed: false };

export type GradlePatchResult = {
  buildGradleKts: string;
  changed: boolean;
};

export type GradleFilePatchResult =
  | { status: 'updated'; changed: true }
  | { status: 'already-present'; changed: false }
  | { status: 'missing-file'; changed: false }
  | { status: 'invalid-gradle'; changed: false };

export type KotlinPatchResult = {
  activityKotlin: string;
  changed: boolean;
};

export type KotlinFilePatchResult =
  | { status: 'updated'; changed: true }
  | { status: 'already-present'; changed: false }
  | { status: 'missing-file'; changed: false }
  | { status: 'invalid-activity'; changed: false };

function normalizeNdkVersion(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function resolveInstalledNdkVersion(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit =
    normalizeNdkVersion(env.EXOMIND_ANDROID_NDK_VERSION)
    ?? normalizeNdkVersion(env.ANDROID_NDK_VERSION);
  if (explicit) {
    return explicit;
  }

  const ndkHome =
    normalizeNdkVersion(env.NDK_HOME)
    ?? normalizeNdkVersion(env.ANDROID_NDK_HOME);
  if (!ndkHome) {
    const androidSdkRoot =
      normalizeNdkVersion(env.ANDROID_HOME)
      ?? normalizeNdkVersion(env.ANDROID_SDK_ROOT);
    if (!androidSdkRoot) {
      return null;
    }

    const ndkRoot = join(androidSdkRoot, 'ndk');
    try {
      const versions = readdirSync(ndkRoot)
        .filter((entry) => {
          try {
            return statSync(join(ndkRoot, entry)).isDirectory();
          } catch {
            return false;
          }
        })
        .sort((left, right) => right.localeCompare(left, undefined, { numeric: true, sensitivity: 'base' }));

      return normalizeNdkVersion(versions[0] ?? null);
    } catch {
      return null;
    }
  }

  return normalizeNdkVersion(basename(ndkHome.replace(/[\\/]+$/, '')));
}

const MDNS_MULTICAST_LOCK_MARKER = 'createMulticastLock("exomind-mdns-lock")';

function detectNewline(value: string): string {
  return value.includes('\r\n') ? '\r\n' : '\n';
}

function findGradleBlockRange(
  source: string,
  blockOpenPattern: RegExp
): { start: number; end: number } | null {
  const match = blockOpenPattern.exec(source);
  if (!match || match.index === undefined) {
    return null;
  }

  const braceOffset = match[0].lastIndexOf('{');
  if (braceOffset < 0) {
    return null;
  }

  const openBraceIndex = match.index + braceOffset;
  let depth = 0;

  for (let index = openBraceIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') {
      depth += 1;
      continue;
    }
    if (char !== '}') {
      continue;
    }

    depth -= 1;
    if (depth === 0) {
      return {
        start: match.index,
        end: index + 1,
      };
    }
  }

  return null;
}

function buildMainActivityWithMulticastLock(packageName: string, newline: string): string {
  return [
    `package ${packageName}`,
    '',
    'import android.content.Context',
    'import android.net.wifi.WifiManager',
    'import android.os.Bundle',
    'import android.util.Log',
    'import androidx.activity.enableEdgeToEdge',
    '',
    'class MainActivity : TauriActivity() {',
    '  private var multicastLock: WifiManager.MulticastLock? = null',
    '',
    '  override fun onCreate(savedInstanceState: Bundle?) {',
    '    enableEdgeToEdge()',
    '    super.onCreate(savedInstanceState)',
    '    acquireMulticastLock()',
    '  }',
    '',
    '  override fun onDestroy() {',
    '    releaseMulticastLock()',
    '    super.onDestroy()',
    '  }',
    '',
    '  private fun acquireMulticastLock() {',
    '    val wifiManager = applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager',
    '    if (wifiManager == null) {',
    '      Log.w("ExoMind", "wifi manager unavailable; multicast lock skipped")',
    '      return',
    '    }',
    '',
    '    runCatching {',
    '      multicastLock = wifiManager.createMulticastLock("exomind-mdns-lock").apply {',
    '        setReferenceCounted(false)',
    '        acquire()',
    '      }',
    '      Log.i("ExoMind", "mDNS multicast lock acquired")',
    '    }.onFailure { error ->',
    '      Log.w("ExoMind", "failed to acquire multicast lock", error)',
    '    }',
    '  }',
    '',
    '  private fun releaseMulticastLock() {',
    '    runCatching {',
    '      multicastLock?.let { lock ->',
    '        if (lock.isHeld) {',
    '          lock.release()',
    '        }',
    '      }',
    '      multicastLock = null',
    '    }.onFailure { error ->',
    '      Log.w("ExoMind", "failed to release multicast lock", error)',
    '    }',
    '  }',
    '}',
    '',
  ].join(newline);
}

function ensurePermissionInManifest(manifestXml: string, permission: string): ManifestPatchResult {
  if (manifestXml.includes(permission)) {
    return { manifestXml, changed: false };
  }

  const newline = manifestXml.includes('\r\n') ? '\r\n' : '\n';
  const permissionLine = `    <uses-permission android:name="${permission}" />`;

  // Match the complete INTERNET permission element (single-line or multi-line).
  const internetPermissionPattern =
    /<uses-permission\b[\s\S]*?android:name\s*=\s*["']android\.permission\.INTERNET["'][\s\S]*?(?:\/>|<\/uses-permission>)/;
  const internetMatch = manifestXml.match(internetPermissionPattern);
  if (internetMatch?.index !== undefined) {
    const insertionPoint = internetMatch.index + internetMatch[0].length;
    const afterInternet = manifestXml.slice(insertionPoint);
    const hasLeadingNewline = afterInternet.startsWith('\n') || afterInternet.startsWith('\r\n');
    const injected = `${newline}${permissionLine}${hasLeadingNewline ? '' : newline}`;
    return {
      manifestXml: `${manifestXml.slice(0, insertionPoint)}${injected}${afterInternet}`,
      changed: true,
    };
  }

  // Fallback: insert right after <manifest ...> opening tag.
  const manifestOpenTagPattern = /<manifest\b[\s\S]*?>/;
  const manifestOpenTagMatch = manifestXml.match(manifestOpenTagPattern);
  if (manifestOpenTagMatch?.index !== undefined) {
    const insertionPoint = manifestOpenTagMatch.index + manifestOpenTagMatch[0].length;
    const afterManifestOpenTag = manifestXml.slice(insertionPoint);
    const hasLeadingNewline = afterManifestOpenTag.startsWith('\n') || afterManifestOpenTag.startsWith('\r\n');
    const injected = `${hasLeadingNewline ? '' : newline}${permissionLine}${newline}`;
    return {
      manifestXml: `${manifestXml.slice(0, insertionPoint)}${injected}${afterManifestOpenTag}`,
      changed: true,
    };
  }

  return { manifestXml, changed: false };
}

export function ensureRequiredAudioPermissionsInManifest(manifestXml: string): ManifestPatchResult {
  let updatedManifest = manifestXml;
  let changed = false;

  for (const permission of [...REQUIRED_AUDIO_PERMISSIONS, ...REQUIRED_NETWORK_DISCOVERY_PERMISSIONS]) {
    const patchResult = ensurePermissionInManifest(updatedManifest, permission);
    updatedManifest = patchResult.manifestXml;
    changed ||= patchResult.changed;
  }

  return { manifestXml: updatedManifest, changed };
}

export function ensureMdnsMulticastLockInMainActivity(activityKotlin: string): KotlinPatchResult {
  if (activityKotlin.includes(MDNS_MULTICAST_LOCK_MARKER)) {
    return { activityKotlin, changed: false };
  }

  const packageMatch = activityKotlin.match(/^\s*package\s+([^\s]+)\s*$/m);
  const mainActivityMatch = activityKotlin.match(/class\s+MainActivity\s*:\s*TauriActivity\(\)/);
  if (!packageMatch || !mainActivityMatch) {
    return { activityKotlin, changed: false };
  }

  const newline = detectNewline(activityKotlin);
  return {
    activityKotlin: buildMainActivityWithMulticastLock(packageMatch[1], newline),
    changed: true,
  };
}

export function ensureRequiredAudioPermissionsInManifestFile(manifestPath: string): ManifestFilePatchResult {
  try {
    const originalManifest = readFileSync(manifestPath, 'utf8');
    const patched = ensureRequiredAudioPermissionsInManifest(originalManifest);

    if (!patched.changed) {
      return REQUIRED_AUDIO_PERMISSIONS.every((permission) => originalManifest.includes(permission))
        ? { status: 'already-present', changed: false }
        : { status: 'invalid-manifest', changed: false };
    }

    writeFileSync(manifestPath, patched.manifestXml, 'utf8');
    return { status: 'updated', changed: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { status: 'missing-file', changed: false };
    }

    throw error;
  }
}

export function ensureMdnsMulticastLockInMainActivityFile(activityPath: string): KotlinFilePatchResult {
  try {
    const originalActivity = readFileSync(activityPath, 'utf8');
    const patched = ensureMdnsMulticastLockInMainActivity(originalActivity);

    if (!patched.changed) {
      return originalActivity.includes(MDNS_MULTICAST_LOCK_MARKER)
        ? { status: 'already-present', changed: false }
        : { status: 'invalid-activity', changed: false };
    }

    writeFileSync(activityPath, patched.activityKotlin, 'utf8');
    return { status: 'updated', changed: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { status: 'missing-file', changed: false };
    }

    throw error;
  }
}

export function ensureReleaseCleartextTrafficInGradle(buildGradleKts: string): GradlePatchResult {
  const releaseWithCleartextPattern =
    /getByName\("release"\)\s*\{[\s\S]*manifestPlaceholders\["usesCleartextTraffic"\]\s*=\s*"true"/;
  if (releaseWithCleartextPattern.test(buildGradleKts)) {
    return { buildGradleKts, changed: false };
  }

  const releaseBlockOpenPattern = /getByName\("release"\)\s*\{/;
  const match = buildGradleKts.match(releaseBlockOpenPattern);
  if (!match) {
    return { buildGradleKts, changed: false };
  }

  const newline = buildGradleKts.includes('\r\n') ? '\r\n' : '\n';
  const updatedGradle = buildGradleKts.replace(
    releaseBlockOpenPattern,
    `getByName("release") {${newline}            ${RELEASE_CLEARTEXT_PLACEHOLDER}`
  );
  return { buildGradleKts: updatedGradle, changed: updatedGradle !== buildGradleKts };
}

export function ensureDebugNativeLibsAreStrippedInGradle(buildGradleKts: string): GradlePatchResult {
  if (!buildGradleKts.includes(DEBUG_KEEP_SYMBOLS_MARKER)) {
    return { buildGradleKts, changed: false };
  }

  const debugBlockRange = findGradleBlockRange(buildGradleKts, /getByName\("debug"\)\s*\{/);
  if (!debugBlockRange) {
    return { buildGradleKts, changed: false };
  }

  const newline = detectNewline(buildGradleKts);
  const debugBlock = buildGradleKts.slice(debugBlockRange.start, debugBlockRange.end);
  const withoutKeepSymbols = debugBlock
    .replace(/\s*jniLibs\.keepDebugSymbols\.add\(".*?\.so"\)\s*/g, newline)
    .replace(/\s*packaging\s*\{\s*\}/g, newline)
    .replace(new RegExp(`${newline}{3,}`, 'g'), `${newline}${newline}`);

  if (withoutKeepSymbols === debugBlock) {
    return { buildGradleKts, changed: false };
  }

  return {
    buildGradleKts: `${buildGradleKts.slice(0, debugBlockRange.start)}${withoutKeepSymbols}${buildGradleKts.slice(debugBlockRange.end)}`,
    changed: true,
  };
}

export function ensureConfiguredNdkVersionInGradle(
  buildGradleKts: string,
  ndkVersion: string | null | undefined
): GradlePatchResult {
  const normalizedNdkVersion = normalizeNdkVersion(ndkVersion);
  if (!normalizedNdkVersion) {
    return { buildGradleKts, changed: false };
  }

  const existingPattern = /^\s*ndkVersion\s*=\s*"[^"]+"\s*$/m;
  if (existingPattern.test(buildGradleKts)) {
    const updatedGradle = buildGradleKts.replace(
      existingPattern,
      `    ndkVersion = "${normalizedNdkVersion}"`
    );
    return { buildGradleKts: updatedGradle, changed: updatedGradle !== buildGradleKts };
  }

  const androidBlockPattern = /android\s*\{\s*/;
  const match = buildGradleKts.match(androidBlockPattern);
  if (!match) {
    return { buildGradleKts, changed: false };
  }

  const updatedGradle = buildGradleKts.replace(
    androidBlockPattern,
    `android {\n    ndkVersion = "${normalizedNdkVersion}"\n    `
  );
  return { buildGradleKts: updatedGradle, changed: updatedGradle !== buildGradleKts };
}

export function ensureReleaseCleartextTrafficInGradleFile(
  buildGradlePath: string,
  desiredNdkVersion?: string | null
): GradleFilePatchResult {
  try {
    const originalGradle = readFileSync(buildGradlePath, 'utf8');
    const cleartextPatched = ensureReleaseCleartextTrafficInGradle(originalGradle);
    const patched = ensureDebugNativeLibsAreStrippedInGradle(cleartextPatched.buildGradleKts);
    const ndkPatched = ensureConfiguredNdkVersionInGradle(patched.buildGradleKts, desiredNdkVersion);
    const updatedGradle = ndkPatched.buildGradleKts;
    const changed = cleartextPatched.changed || patched.changed || ndkPatched.changed;

    if (!changed) {
      return originalGradle.includes(RELEASE_CLEARTEXT_PLACEHOLDER)
        && !originalGradle.includes(DEBUG_KEEP_SYMBOLS_MARKER)
        && (!desiredNdkVersion || originalGradle.includes(`ndkVersion = "${desiredNdkVersion}"`))
        ? { status: 'already-present', changed: false }
        : { status: 'invalid-gradle', changed: false };
    }

    writeFileSync(buildGradlePath, updatedGradle, 'utf8');
    return { status: 'updated', changed: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { status: 'missing-file', changed: false };
    }

    throw error;
  }
}
