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
  const lines = manifestXml.split(/\r?\n/);
  const permissionLine = `    <uses-permission android:name="${RECORD_AUDIO_PERMISSION}" />`;

  const internetPermissionLine = lines.findIndex((line) => line.includes('android.permission.INTERNET'));
  if (internetPermissionLine >= 0) {
    lines.splice(internetPermissionLine + 1, 0, permissionLine);
    return { manifestXml: lines.join(newline), changed: true };
  }

  const manifestStartLine = lines.findIndex((line) => line.includes('<manifest'));
  if (manifestStartLine >= 0) {
    lines.splice(manifestStartLine + 1, 0, permissionLine);
    return { manifestXml: lines.join(newline), changed: true };
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
