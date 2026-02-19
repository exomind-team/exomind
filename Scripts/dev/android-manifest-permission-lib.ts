import { readFileSync, writeFileSync } from 'node:fs';

export const RECORD_AUDIO_PERMISSION = 'android.permission.RECORD_AUDIO';

export type ManifestPatchResult = {
  manifestXml: string;
  changed: boolean;
};

export type ManifestFilePatchResult =
  | { status: 'updated'; changed: true }
  | { status: 'already-present'; changed: false }
  | { status: 'missing-file'; changed: false }
  | { status: 'invalid-manifest'; changed: false };

export function ensureRecordAudioPermissionInManifest(manifestXml: string): ManifestPatchResult {
  if (manifestXml.includes(RECORD_AUDIO_PERMISSION)) {
    return { manifestXml, changed: false };
  }

  const newline = manifestXml.includes('\r\n') ? '\r\n' : '\n';
  const permissionLine = `    <uses-permission android:name="${RECORD_AUDIO_PERMISSION}" />`;

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

export function ensureRecordAudioPermissionInManifestFile(manifestPath: string): ManifestFilePatchResult {
  try {
    const originalManifest = readFileSync(manifestPath, 'utf8');
    const patched = ensureRecordAudioPermissionInManifest(originalManifest);

    if (!patched.changed) {
      return originalManifest.includes(RECORD_AUDIO_PERMISSION)
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
