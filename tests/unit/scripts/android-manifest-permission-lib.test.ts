import { describe, expect, it } from 'vitest';
import {
  RECORD_AUDIO_PERMISSION,
  ensureRecordAudioPermissionInManifest,
} from '../../../Scripts/dev/android-manifest-permission-lib';

describe('ensureRecordAudioPermissionInManifest', () => {
  it('injects RECORD_AUDIO permission when missing（缺失时自动注入）', () => {
    const input = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />
    <application android:label="@string/app_name" />
</manifest>
`;

    const result = ensureRecordAudioPermissionInManifest(input);

    expect(result.changed).toBe(true);
    expect(result.manifestXml).toContain(RECORD_AUDIO_PERMISSION);
    expect(result.manifestXml.match(new RegExp(RECORD_AUDIO_PERMISSION, 'g'))).toHaveLength(1);
  });

  it('keeps manifest unchanged when permission already exists（已存在时保持不变）', () => {
    const input = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="${RECORD_AUDIO_PERMISSION}" />
    <application android:label="@string/app_name" />
</manifest>
`;

    const result = ensureRecordAudioPermissionInManifest(input);

    expect(result.changed).toBe(false);
    expect(result.manifestXml).toBe(input);
  });

  it('injects permission even without INTERNET declaration（无 INTERNET 也能注入）', () => {
    const input = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application android:label="@string/app_name" />
</manifest>
`;

    const result = ensureRecordAudioPermissionInManifest(input);

    expect(result.changed).toBe(true);
    expect(result.manifestXml).toContain(RECORD_AUDIO_PERMISSION);
    expect(result.manifestXml).toContain('<application android:label="@string/app_name" />');
  });
});
