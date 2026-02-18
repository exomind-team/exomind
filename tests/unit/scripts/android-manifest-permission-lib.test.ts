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

  it('injects after multiline manifest opening tag（多行 manifest 起始标签后注入）', () => {
    const input = `<?xml version="1.0" encoding="utf-8"?>
<manifest
    xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.exomind.app">
    <application android:label="@string/app_name" />
</manifest>
`;

    const result = ensureRecordAudioPermissionInManifest(input);

    expect(result.changed).toBe(true);
    expect(result.manifestXml).toContain('<manifest\n    xmlns:android="http://schemas.android.com/apk/res/android"\n    package="com.exomind.app">');
    expect(result.manifestXml).toContain(`    <uses-permission android:name="${RECORD_AUDIO_PERMISSION}" />`);
    expect(result.manifestXml).toContain('<application android:label="@string/app_name" />');
  });

  it('injects after multiline INTERNET permission（多行 INTERNET 权限后注入）', () => {
    const input = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission
        android:name="android.permission.INTERNET" />
    <application android:label="@string/app_name" />
</manifest>
`;

    const result = ensureRecordAudioPermissionInManifest(input);

    expect(result.changed).toBe(true);
    // RECORD_AUDIO should be inserted AFTER the complete INTERNET permission tag (/>)
    // NOT between the attribute line and the closing tag
    expect(result.manifestXml).toContain(`    <uses-permission android:name="${RECORD_AUDIO_PERMISSION}" />`);
    // The INTERNET permission should still be valid (closing tag on same line as attribute)
    expect(result.manifestXml).toContain('<uses-permission\n        android:name="android.permission.INTERNET" />');
    expect(result.manifestXml).toContain('<application android:label="@string/app_name" />');
  });

  it('injects after INTERNET with separate closing tag（INTERNET 关闭标签分离）', () => {
    // More complex case: uses-permission on one line, name attribute on another, closing /> on yet another
    const input = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission
        android:name="android.permission.INTERNET"
    />
    <application android:label="@string/app_name" />
</manifest>
`;

    const result = ensureRecordAudioPermissionInManifest(input);

    expect(result.changed).toBe(true);
    // RECORD_AUDIO should be inserted AFTER the complete INTERNET permission (after the closing />)
    // The structure should be valid: INTERNET closes first, then RECORD_AUDIO, then application
    const lines = result.manifestXml.split('\n');
    const internetCloseIndex = lines.findIndex(l => l.includes('android.permission.INTERNET') && l.includes('/>'));
    const recordAudioIndex = lines.findIndex(l => l.includes('RECORD_AUDIO'));
    const appIndex = lines.findIndex(l => l.includes('application'));
    expect(recordAudioIndex).toBeGreaterThan(internetCloseIndex);
    expect(appIndex).toBeGreaterThan(recordAudioIndex);
  });
});
