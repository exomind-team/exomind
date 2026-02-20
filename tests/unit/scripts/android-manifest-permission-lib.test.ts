import { describe, expect, it } from 'vitest';
import {
  MODIFY_AUDIO_SETTINGS_PERMISSION,
  RECORD_AUDIO_PERMISSION,
  RELEASE_CLEARTEXT_PLACEHOLDER,
  ensureReleaseCleartextTrafficInGradle,
  ensureRequiredAudioPermissionsInManifest,
} from '../../../Scripts/dev/android-manifest-permission-lib';

describe('ensureRequiredAudioPermissionsInManifest', () => {
  it('injects audio permissions when missing（缺失时自动注入双权限）', () => {
    const input = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />
    <application android:label="@string/app_name" />
</manifest>
`;

    const result = ensureRequiredAudioPermissionsInManifest(input);

    expect(result.changed).toBe(true);
    expect(result.manifestXml).toContain(RECORD_AUDIO_PERMISSION);
    expect(result.manifestXml).toContain(MODIFY_AUDIO_SETTINGS_PERMISSION);
    expect(result.manifestXml.match(new RegExp(RECORD_AUDIO_PERMISSION, 'g'))).toHaveLength(1);
    expect(result.manifestXml.match(new RegExp(MODIFY_AUDIO_SETTINGS_PERMISSION, 'g'))).toHaveLength(1);
  });

  it('keeps manifest unchanged when permissions already exist（已存在时保持不变）', () => {
    const input = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="${MODIFY_AUDIO_SETTINGS_PERMISSION}" />
    <uses-permission android:name="${RECORD_AUDIO_PERMISSION}" />
    <application android:label="@string/app_name" />
</manifest>
`;

    const result = ensureRequiredAudioPermissionsInManifest(input);

    expect(result.changed).toBe(false);
    expect(result.manifestXml).toBe(input);
  });

  it('injects permissions even without INTERNET declaration（无 INTERNET 也能注入）', () => {
    const input = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application android:label="@string/app_name" />
</manifest>
`;

    const result = ensureRequiredAudioPermissionsInManifest(input);

    expect(result.changed).toBe(true);
    expect(result.manifestXml).toContain(RECORD_AUDIO_PERMISSION);
    expect(result.manifestXml).toContain(MODIFY_AUDIO_SETTINGS_PERMISSION);
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

    const result = ensureRequiredAudioPermissionsInManifest(input);

    expect(result.changed).toBe(true);
    expect(result.manifestXml).toContain('<manifest\n    xmlns:android="http://schemas.android.com/apk/res/android"\n    package="com.exomind.app">');
    expect(result.manifestXml).toContain(`    <uses-permission android:name="${RECORD_AUDIO_PERMISSION}" />`);
    expect(result.manifestXml).toContain(
      `    <uses-permission android:name="${MODIFY_AUDIO_SETTINGS_PERMISSION}" />`
    );
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

    const result = ensureRequiredAudioPermissionsInManifest(input);

    expect(result.changed).toBe(true);
    // Both audio permissions should be inserted AFTER the complete INTERNET permission tag (/>)
    expect(result.manifestXml).toContain(`    <uses-permission android:name="${RECORD_AUDIO_PERMISSION}" />`);
    expect(result.manifestXml).toContain(
      `    <uses-permission android:name="${MODIFY_AUDIO_SETTINGS_PERMISSION}" />`
    );
    expect(result.manifestXml).toContain('<uses-permission\n        android:name="android.permission.INTERNET" />');
    expect(result.manifestXml).toContain('<application android:label="@string/app_name" />');
  });

  it('injects after INTERNET with separate closing tag（INTERNET 关闭标签分离）', () => {
    const input = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission
        android:name="android.permission.INTERNET"
    />
    <application android:label="@string/app_name" />
</manifest>
`;

    const result = ensureRequiredAudioPermissionsInManifest(input);

    expect(result.changed).toBe(true);
    const lines = result.manifestXml.split('\n');
    const internetNameIndex = lines.findIndex((line) => line.includes('android.permission.INTERNET'));
    const internetCloseIndex = lines.findIndex(
      (line, index) => index >= internetNameIndex && line.includes('/>')
    );
    const modifyIndex = lines.findIndex((line) => line.includes('MODIFY_AUDIO_SETTINGS'));
    const recordAudioIndex = lines.findIndex((line) => line.includes('RECORD_AUDIO'));
    const appIndex = lines.findIndex((line) => line.includes('application'));
    expect(internetCloseIndex).toBeGreaterThan(internetNameIndex);
    expect(modifyIndex).toBeGreaterThan(internetCloseIndex);
    expect(recordAudioIndex).toBeGreaterThan(internetCloseIndex);
    expect(appIndex).toBeGreaterThan(modifyIndex);
    expect(appIndex).toBeGreaterThan(recordAudioIndex);
  });

  it('keeps injected permissions inside one-line manifest（单行 manifest 仍保持合法结构）', () => {
    const input =
      '<?xml version="1.0"?><manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:label="@string/app_name" /></manifest>';

    const result = ensureRequiredAudioPermissionsInManifest(input);

    expect(result.changed).toBe(true);
    expect(result.manifestXml).toContain(`android:name="${RECORD_AUDIO_PERMISSION}"`);
    expect(result.manifestXml).toContain(`android:name="${MODIFY_AUDIO_SETTINGS_PERMISSION}"`);
    expect(result.manifestXml.indexOf(RECORD_AUDIO_PERMISSION)).toBeGreaterThan(result.manifestXml.indexOf('<manifest'));
    expect(result.manifestXml.indexOf(RECORD_AUDIO_PERMISSION)).toBeLessThan(result.manifestXml.indexOf('</manifest>'));
    expect(result.manifestXml.indexOf(MODIFY_AUDIO_SETTINGS_PERMISSION)).toBeGreaterThan(
      result.manifestXml.indexOf('<manifest')
    );
    expect(result.manifestXml.indexOf(MODIFY_AUDIO_SETTINGS_PERMISSION)).toBeLessThan(
      result.manifestXml.indexOf('</manifest>')
    );
  });
});

describe('ensureReleaseCleartextTrafficInGradle', () => {
  it('injects cleartext placeholder into release block when missing（缺失时注入 cleartext）', () => {
    const input = `android {
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
        }
        getByName("release") {
            isMinifyEnabled = false
        }
    }
}
`;

    const result = ensureReleaseCleartextTrafficInGradle(input);

    expect(result.changed).toBe(true);
    expect(result.buildGradleKts).toContain(RELEASE_CLEARTEXT_PLACEHOLDER);
    expect(result.buildGradleKts.match(/manifestPlaceholders\["usesCleartextTraffic"\]\s*=\s*"true"/g)).toHaveLength(
      2
    );
  });

  it('keeps gradle unchanged when cleartext placeholder already exists（已存在时保持不变）', () => {
    const input = `android {
    buildTypes {
        getByName("release") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isMinifyEnabled = true
        }
    }
}
`;

    const result = ensureReleaseCleartextTrafficInGradle(input);

    expect(result.changed).toBe(false);
    expect(result.buildGradleKts).toBe(input);
  });
});
