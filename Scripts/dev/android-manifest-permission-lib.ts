import { readFileSync, writeFileSync } from 'node:fs';

export const RECORD_AUDIO_PERMISSION = 'android.permission.RECORD_AUDIO';
export const MODIFY_AUDIO_SETTINGS_PERMISSION = 'android.permission.MODIFY_AUDIO_SETTINGS';
export const REQUIRED_AUDIO_PERMISSIONS = [RECORD_AUDIO_PERMISSION, MODIFY_AUDIO_SETTINGS_PERMISSION] as const;
export const RELEASE_CLEARTEXT_PLACEHOLDER = 'manifestPlaceholders["usesCleartextTraffic"] = "true"';

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

  for (const permission of REQUIRED_AUDIO_PERMISSIONS) {
    const patchResult = ensurePermissionInManifest(updatedManifest, permission);
    updatedManifest = patchResult.manifestXml;
    changed ||= patchResult.changed;
  }

  return { manifestXml: updatedManifest, changed };
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

export function ensureReleaseCleartextTrafficInGradleFile(buildGradlePath: string): GradleFilePatchResult {
  try {
    const originalGradle = readFileSync(buildGradlePath, 'utf8');
    const patched = ensureReleaseCleartextTrafficInGradle(originalGradle);

    if (!patched.changed) {
      return originalGradle.includes(RELEASE_CLEARTEXT_PLACEHOLDER)
        ? { status: 'already-present', changed: false }
        : { status: 'invalid-gradle', changed: false };
    }

    writeFileSync(buildGradlePath, patched.buildGradleKts, 'utf8');
    return { status: 'updated', changed: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { status: 'missing-file', changed: false };
    }

    throw error;
  }
}
