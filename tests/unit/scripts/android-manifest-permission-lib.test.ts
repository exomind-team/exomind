import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ACCESS_NETWORK_STATE_PERMISSION,
  ANDROID_USES_CLEARTEXT_TRAFFIC_ATTRIBUTE,
  ACCESS_WIFI_STATE_PERMISSION,
  CHANGE_WIFI_MULTICAST_STATE_PERMISSION,
  MODIFY_AUDIO_SETTINGS_PERMISSION,
  RECORD_AUDIO_PERMISSION,
  RELEASE_CLEARTEXT_PLACEHOLDER,
  ensureConfiguredNdkVersionInGradle,
  ensureCleartextTrafficInManifest,
  ensureDebugCleartextTrafficInGradle,
  ensureDebugNativeLibsAreStrippedInGradle,
  ensureMdnsMulticastLockInMainActivity,
  ensureReleaseCleartextTrafficInGradle,
  ensureRequiredAudioPermissionsInManifest,
  resolveInstalledNdkVersion,
} from '../../../scripts/dev/android-manifest-permission-lib';

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
    expect(result.manifestXml).toContain(ACCESS_NETWORK_STATE_PERMISSION);
    expect(result.manifestXml).toContain(ACCESS_WIFI_STATE_PERMISSION);
    expect(result.manifestXml).toContain(CHANGE_WIFI_MULTICAST_STATE_PERMISSION);
    expect(result.manifestXml.match(new RegExp(RECORD_AUDIO_PERMISSION, 'g'))).toHaveLength(1);
    expect(result.manifestXml.match(new RegExp(MODIFY_AUDIO_SETTINGS_PERMISSION, 'g'))).toHaveLength(1);
  });

  it('keeps manifest unchanged when permissions already exist（已存在时保持不变）', () => {
    const input = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="${MODIFY_AUDIO_SETTINGS_PERMISSION}" />
    <uses-permission android:name="${RECORD_AUDIO_PERMISSION}" />
    <uses-permission android:name="${ACCESS_NETWORK_STATE_PERMISSION}" />
    <uses-permission android:name="${ACCESS_WIFI_STATE_PERMISSION}" />
    <uses-permission android:name="${CHANGE_WIFI_MULTICAST_STATE_PERMISSION}" />
    <application android:label="@string/app_name" android:usesCleartextTraffic="true" />
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
    expect(result.manifestXml).toContain(ACCESS_NETWORK_STATE_PERMISSION);
    expect(result.manifestXml).toContain(ACCESS_WIFI_STATE_PERMISSION);
    expect(result.manifestXml).toContain(CHANGE_WIFI_MULTICAST_STATE_PERMISSION);
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

describe('ensureCleartextTrafficInManifest', () => {
  it('injects usesCleartextTraffic on application when missing（缺失时注入 cleartext）', () => {
    const input = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application android:label="@string/app_name" />
</manifest>
`;

    const result = ensureCleartextTrafficInManifest(input);

    expect(result.changed).toBe(true);
    expect(result.manifestXml).toContain(ANDROID_USES_CLEARTEXT_TRAFFIC_ATTRIBUTE);
  });

  it('replaces existing usesCleartextTraffic value with true（已有值时强制改为 true）', () => {
    const input = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application android:label="@string/app_name" android:usesCleartextTraffic="false" />
</manifest>
`;

    const result = ensureCleartextTrafficInManifest(input);

    expect(result.changed).toBe(true);
    expect(result.manifestXml).toContain(ANDROID_USES_CLEARTEXT_TRAFFIC_ATTRIBUTE);
    expect(result.manifestXml).not.toContain('android:usesCleartextTraffic="false"');
  });
});

describe('ensureMdnsMulticastLockInMainActivity', () => {
  it('injects multicast lock lifecycle into default MainActivity（默认 MainActivity 自动注入组播锁生命周期）', () => {
    const input = `package com.exomind.app

import android.os.Bundle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }
}
`;

    const result = ensureMdnsMulticastLockInMainActivity(input);

    expect(result.changed).toBe(true);
    expect(result.activityKotlin).toContain('private var multicastLock: WifiManager.MulticastLock? = null');
    expect(result.activityKotlin).toContain('acquireMulticastLock()');
    expect(result.activityKotlin).toContain('releaseMulticastLock()');
    expect(result.activityKotlin).toContain('wifiManager.createMulticastLock("exomind-mdns-lock")');
  });

  it('keeps MainActivity unchanged when multicast lock already exists（已存在组播锁逻辑时保持不变）', () => {
    const input = `package com.exomind.app

import android.content.Context
import android.net.wifi.WifiManager
import android.os.Bundle
import android.util.Log
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  private var multicastLock: WifiManager.MulticastLock? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    acquireMulticastLock()
  }

  override fun onDestroy() {
    releaseMulticastLock()
    super.onDestroy()
  }

  private fun acquireMulticastLock() {
    val wifiManager = applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
    if (wifiManager == null) {
      Log.w("ExoMind", "wifi manager unavailable; multicast lock skipped")
      return
    }

    multicastLock = wifiManager.createMulticastLock("exomind-mdns-lock").apply {
      setReferenceCounted(false)
      acquire()
    }
  }

  private fun releaseMulticastLock() {
    multicastLock?.release()
  }
}
`;

    const result = ensureMdnsMulticastLockInMainActivity(input);

    expect(result.changed).toBe(false);
    expect(result.activityKotlin).toBe(input);
  });

  it('skips files that are not the generated Tauri MainActivity（非生成的 Tauri MainActivity 不应误改）', () => {
    const input = `package com.exomind.app

class PairingDebugActivity
`;

    const result = ensureMdnsMulticastLockInMainActivity(input);

    expect(result.changed).toBe(false);
    expect(result.activityKotlin).toBe(input);
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

describe('ensureDebugCleartextTrafficInGradle', () => {
  it('injects cleartext placeholder into debug block when missing（debug 缺失时注入）', () => {
    const input = `android {
    buildTypes {
        getByName("debug") {
            isDebuggable = true
        }
        getByName("release") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
        }
    }
}
`;

    const result = ensureDebugCleartextTrafficInGradle(input);

    expect(result.changed).toBe(true);
    expect(result.buildGradleKts).toMatch(
      /getByName\("debug"\)\s*\{[\s\S]*manifestPlaceholders\["usesCleartextTraffic"\]\s*=\s*"true"/
    );
  });

  it('keeps gradle unchanged when debug cleartext already exists（已存在时保持不变）', () => {
    const input = `android {
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
        }
    }
}
`;

    const result = ensureDebugCleartextTrafficInGradle(input);

    expect(result.changed).toBe(false);
    expect(result.buildGradleKts).toBe(input);
  });
});

describe('ensureDebugNativeLibsAreStrippedInGradle', () => {
  it('removes keepDebugSymbols from debug build to avoid huge APKs（移除 debug keepDebugSymbols 以避免 APK 过大）', () => {
    const input = `android {
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {
                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
    }
}
`;

    const result = ensureDebugNativeLibsAreStrippedInGradle(input);

    expect(result.changed).toBe(true);
    expect(result.buildGradleKts).not.toContain('jniLibs.keepDebugSymbols.add');
    expect(result.buildGradleKts).toContain('getByName("debug") {');
    expect(result.buildGradleKts).toContain('isJniDebuggable = true');
  });

  it('keeps gradle unchanged when debug keepDebugSymbols is already absent（缺失时保持不变）', () => {
    const input = `android {
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isMinifyEnabled = false
        }
    }
}
`;

    const result = ensureDebugNativeLibsAreStrippedInGradle(input);

    expect(result.changed).toBe(false);
    expect(result.buildGradleKts).toBe(input);
  });
});

describe('ensureConfiguredNdkVersionInGradle', () => {
  it('injects ndkVersion when missing（缺失时注入本机 NDK 版本）', () => {
    const input = `android {
    compileSdk = 36
    namespace = "com.exomind.app"
}
`;

    const result = ensureConfiguredNdkVersionInGradle(input, '29.0.14206865');

    expect(result.changed).toBe(true);
    expect(result.buildGradleKts).toContain('ndkVersion = "29.0.14206865"');
  });

  it('replaces mismatched ndkVersion when different（版本不一致时替换为本机 NDK 版本）', () => {
    const input = `android {
    compileSdk = 36
    ndkVersion = "27.0.12077973"
    namespace = "com.exomind.app"
}
`;

    const result = ensureConfiguredNdkVersionInGradle(input, '29.0.14206865');

    expect(result.changed).toBe(true);
    expect(result.buildGradleKts).toContain('ndkVersion = "29.0.14206865"');
    expect(result.buildGradleKts).not.toContain('27.0.12077973');
  });
});

describe('resolveInstalledNdkVersion', () => {
  it('prefers explicit NDK_HOME folder name（优先使用 NDK_HOME 路径中的版本号）', () => {
    const version = resolveInstalledNdkVersion({
      NDK_HOME: 'D:\\data\\AndroidSDK\\ndk\\29.0.14206865',
    });

    expect(version).toBe('29.0.14206865');
  });

  it('falls back to latest Android SDK ndk directory（回退到 Android SDK 中最高版本的 ndk 目录）', () => {
    const sdkRoot = mkdtempSync(join(tmpdir(), 'android-sdk-'));

    try {
      mkdirSync(join(sdkRoot, 'ndk', '27.0.12077973'), { recursive: true });
      mkdirSync(join(sdkRoot, 'ndk', '29.0.14206865'), { recursive: true });

      const version = resolveInstalledNdkVersion({
        ANDROID_HOME: sdkRoot,
      });

      expect(version).toBe('29.0.14206865');
    } finally {
      rmSync(sdkRoot, { recursive: true, force: true });
    }
  });
});
