import { describe, expect, it } from 'vitest';
import {
  collectArtifactSizeSummary,
  parseAndroidStringValues,
  resolveMissingIconFiles,
} from '../../../Scripts/dev/android-meta-check-lib.ts';

describe('android-meta-check-lib', () => {
  it('parses android string resources from xml', () => {
    const xml = `
      <resources>
        <string name="app_name">ExoMind</string>
        <string name="main_activity_title">ExoMind</string>
      </resources>
    `;

    const values = parseAndroidStringValues(xml);
    expect(values.app_name).toBe('ExoMind');
    expect(values.main_activity_title).toBe('ExoMind');
  });

  it('returns missing icon paths based on base dir', () => {
    const missing = resolveMissingIconFiles(
      ['icons/32x32.png', 'icons/missing.png'],
      (absolutePath) => absolutePath.endsWith('32x32.png'),
      'D:/repo/src-tauri',
    );

    expect(missing).toHaveLength(1);
    expect(missing[0].replaceAll('\\', '/')).toContain('icons/missing.png');
  });

  it('collects artifact size summary for apk and aab files', () => {
    const summary = collectArtifactSizeSummary([
      'D:/repo/src-tauri/gen/android/app/build/outputs/apk/arm64-v8a/debug/app-arm64-v8a-debug.apk',
      'D:/repo/src-tauri/gen/android/app/build/outputs/bundle/universalRelease/app-universal-release.aab',
      'D:/repo/src-tauri/gen/android/app/build/outputs/mapping/release/mapping.txt',
    ], (filePath) => {
      if (filePath.endsWith('.apk')) return 15 * 1024 * 1024;
      if (filePath.endsWith('.aab')) return 28 * 1024 * 1024;
      return 1024;
    });

    expect(summary).toHaveLength(2);
    expect(summary[0]).toMatchObject({ kind: 'apk' });
    expect(summary[1]).toMatchObject({ kind: 'aab' });
  });
});
