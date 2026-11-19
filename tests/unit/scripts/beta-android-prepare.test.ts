import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];
const beta = 'com.exomind.app.v06.beta';
const freshActivity = `package ${beta}
import android.os.Bundle
import androidx.activity.enableEdgeToEdge
class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }
}
`;
const freshManifest = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />

    <!-- AndroidTV support -->
    <uses-feature android:name="android.software.leanback" android:required="false" />

    <application
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:theme="@style/Theme.exomind_tauri_init_probe"
        android:usesCleartextTraffic="\${usesCleartextTraffic}">
        <activity
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode"
            android:launchMode="singleTask"
            android:label="@string/main_activity_title"
            android:name=".MainActivity"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
                <!-- AndroidTV support -->
                <category android:name="android.intent.category.LEANBACK_LAUNCHER" />
            </intent-filter>
        </activity>

        <provider
          android:name="androidx.core.content.FileProvider"
          android:authorities="\${applicationId}.fileprovider"
          android:exported="false"
          android:grantUriPermissions="true">
          <meta-data
            android:name="android.support.FILE_PROVIDER_PATHS"
            android:resource="@xml/file_paths" />
        </provider>
    </application>
</manifest>
`;

function fixture(namespace = beta) {
  const root = mkdtempSync(join(tmpdir(), 'exomind-beta-android-')); roots.push(root);
  const files = {
    config: join(root, 'src-tauri/tauri.beta.conf.json'),
    gradle: join(root, 'src-tauri/gen/android/app/build.gradle.kts'),
    manifest: join(root, 'src-tauri/gen/android/app/src/main/AndroidManifest.xml'),
    activity: join(root, 'src-tauri/gen/android/app/src/main/java/com/exomind/app/v06/beta/MainActivity.kt'),
  };
  const put = (path: string, value: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, value); };
  put(files.config, JSON.stringify({ identifier: beta, app: { windows: [{ label: 'main', url: 'beta.html' }] } }));
  put(files.gradle, `android {\n    namespace = "${namespace}"\n    defaultConfig {\n        applicationId = "${beta}"\n    }\n}\n`);
  put(files.manifest, freshManifest);
  put(files.activity, freshActivity);
  cpSync(join(process.cwd(),'src-tauri/icons/android'),join(root,'src-tauri/icons/android'),{recursive:true});
  return { root, files, snapshot: () => Object.fromEntries(Object.entries(files).map(([key,path]) => [key,readFileSync(path,'utf8')])) };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('isolated Beta Android preparation', () => {
  it('B14-U05: replaces template launcher resources from the maintained brand pack, including round/adaptive icons',async()=>{
    const {prepareBetaAndroid}=await import('../../../scripts/dev/beta-android-prepare');const work=fixture();
    const target=join(work.root,'src-tauri/gen/android/app/src/main/res/mipmap-xhdpi/ic_launcher.png');mkdirSync(dirname(target),{recursive:true});writeFileSync(target,'synthetic Tauri template icon');
    prepareBetaAndroid(work.root,{ndkVersion:null});
    expect(readFileSync(target)).toEqual(readFileSync(join(work.root,'src-tauri/icons/android/mipmap-xhdpi/ic_launcher.png')));
    const round=readFileSync(join(work.root,'src-tauri/gen/android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml'),'utf8');expect(round).toContain('@mipmap/ic_launcher_foreground');
    expect(work.snapshot().manifest).toContain('android:icon="@mipmap/ic_launcher"');expect(work.snapshot().manifest).toContain('android:roundIcon="@mipmap/ic_launcher_round"');
    expect(prepareBetaAndroid(work.root,{ndkVersion:null}).changedFiles).toEqual([]);
  });
  it('B12-08: pins the AGP strip NDK explicitly and preserves repeated preparation',async()=>{
    const {prepareBetaAndroid}=await import('../../../scripts/dev/beta-android-prepare');const work=fixture();
    prepareBetaAndroid(work.root,{ndkVersion:'28.0.13004108'});
    expect(work.snapshot().gradle).toContain('ndkVersion = "28.0.13004108"');
    expect(prepareBetaAndroid(work.root,{ndkVersion:'28.0.13004108'}).changedFiles).toEqual([]);
  });

  it.each(['\n','\r\n'])('B12-08: prepares fresh debug native-symbol policy and keeps the diagnostic opt-in idempotent (%j)',async newline=>{
    const {prepareBetaAndroid}=await import('../../../scripts/dev/beta-android-prepare');const work=fixture();
    const original=readFileSync(work.files.gradle,'utf8');
    writeFileSync(work.files.gradle,original.trimEnd().replace(/\n}$/, '\n    buildTypes {\n        getByName("debug") {\n            isDebuggable = true\n            isJniDebuggable = true\n            packaging { jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so") }\n        }\n    }\n}')+'\n');
    writeFileSync(work.files.gradle,readFileSync(work.files.gradle,'utf8').replace(/\r?\n/g,newline));
    prepareBetaAndroid(work.root,{ndkVersion:null});const prepared=work.snapshot().gradle;
    expect(prepared).not.toContain('isJniDebuggable = true');expect(prepared).toContain('isDebuggable = true');
    expect(prepared).toContain('exomind.keepNativeSymbols');expect(prepared).toContain('if (keepNativeSymbols)');
    expect(prepareBetaAndroid(work.root,{ndkVersion:null}).changedFiles).toEqual([]);expect(work.snapshot().gradle).toBe(prepared);
  });
  it('patches the fresh Tauri Android template with only audio permissions and is idempotent', async () => {
    const { prepareBetaAndroid } = await import('../../../scripts/dev/beta-android-prepare');
    const work = fixture(); const before = work.snapshot();
    const result = prepareBetaAndroid(work.root,{ndkVersion:null});
    expect(result.changedFiles).toContain(work.files.manifest);expect(result.changedFiles).toContain(work.files.activity);expect(result.changedFiles).not.toContain(work.files.gradle);
    const after = work.snapshot(); expect(after.gradle).toBe(before.gradle); expect(after.config).toBe(before.config);
    expect(after.activity).toContain('fun setExomindFullscreen(enabled: Boolean)');
    expect(after.activity).toContain('override fun onConfigurationChanged(newConfig: android.content.res.Configuration)');
    expect(after.activity).toMatch(/super\.onResume\(\)\s+applyExomindSystemBars\(\)/);
    expect(after.activity).toContain('if (hasFocus) applyExomindSystemBars()');
    expect(after.activity).toContain('if (exomindFullscreen) cutout else bars or cutout');
    expect(after.activity).not.toMatch(/MulticastLock|WifiManager|WindowInsetsCompat\.CONSUMED/);
    expect(after.manifest).toContain('android:configChanges=');
    const permissionNames = [...after.manifest.matchAll(/<uses-permission\b[^>]*android:name="([^"]+)"/g)]
      .map(([, name]) => name);
    expect(permissionNames).toHaveLength(3);
    expect(permissionNames).toEqual(expect.arrayContaining([
      'android.permission.INTERNET',
      'android.permission.RECORD_AUDIO',
      'android.permission.MODIFY_AUDIO_SETTINGS',
    ]));
    expect(after.manifest.match(/android\.permission\.RECORD_AUDIO/g)).toHaveLength(1);
    expect(after.manifest.match(/android\.permission\.MODIFY_AUDIO_SETTINGS/g)).toHaveLength(1);
    expect(after.manifest).not.toMatch(/android\.permission\.(CAMERA|READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE|MANAGE_EXTERNAL_STORAGE)/);
    expect(prepareBetaAndroid(work.root,{ndkVersion:null}).changedFiles).toEqual([]); expect(work.snapshot()).toEqual(after);
  });
  it('preserves an existing audio permission without adding a duplicate', async () => {
    const { prepareBetaAndroid } = await import('../../../scripts/dev/beta-android-prepare');
    const work = fixture();
    writeFileSync(work.files.manifest, freshManifest.replace(
      '    <uses-permission android:name="android.permission.INTERNET" />',
      '    <uses-permission android:name="android.permission.INTERNET" />\n    <uses-permission android:name="android.permission.RECORD_AUDIO" />',
    ));

    prepareBetaAndroid(work.root, { ndkVersion: null });
    const manifest = work.snapshot().manifest;
    expect(manifest.match(/android\.permission\.RECORD_AUDIO/g)).toHaveLength(1);
    expect(manifest.match(/android\.permission\.MODIFY_AUDIO_SETTINGS/g)).toHaveLength(1);
  });
  it('accepts the CI manifest preparer output without duplicating audio permissions', async () => {
    const { prepareBetaAndroid } = await import('../../../scripts/dev/beta-android-prepare');
    const {
      ensureCleartextTrafficInManifest,
      ensureConfigChangesInManifest,
      ensureRequiredAudioPermissionsInManifest,
    } = await import('../../../scripts/dev/android-manifest-permission-lib');
    const work = fixture();
    const withCiPermissions = ensureRequiredAudioPermissionsInManifest(freshManifest).manifestXml;
    const withCiCleartext = ensureCleartextTrafficInManifest(withCiPermissions).manifestXml;
    const withCiConfigChanges = ensureConfigChangesInManifest(withCiCleartext).manifestXml;
    writeFileSync(work.files.manifest, withCiConfigChanges);

    prepareBetaAndroid(work.root, { ndkVersion: null });
    const permissionNames = [...work.snapshot().manifest.matchAll(/<uses-permission\b[^>]*android:name="([^"]+)"/g)]
      .map(([, name]) => name);
    expect(permissionNames).toHaveLength(6);
    expect(permissionNames.filter(name => name === 'android.permission.RECORD_AUDIO')).toHaveLength(1);
    expect(permissionNames.filter(name => name === 'android.permission.MODIFY_AUDIO_SETTINGS')).toHaveLength(1);
    expect(work.snapshot().manifest).toContain('android:usesCleartextTraffic="true"');
  });
  it.each([
    'android.permission.CAMERA',
    'android.permission.READ_EXTERNAL_STORAGE',
    'android.permission.WRITE_EXTERNAL_STORAGE',
    'android.permission.MANAGE_EXTERNAL_STORAGE',
    'android.permission.ACCESS_FINE_LOCATION',
  ])('fails closed on an unsupported permission in the generated template: %s', async permission => {
    const { prepareBetaAndroid } = await import('../../../scripts/dev/beta-android-prepare');
    const work = fixture();
    writeFileSync(work.files.manifest, freshManifest.replace(
      '    <uses-feature android:name="android.software.leanback" android:required="false" />',
      `    <uses-permission android:name="${permission}" />\n    <uses-feature android:name="android.software.leanback" android:required="false" />`,
    ));
    const before = work.snapshot();

    expect(() => prepareBetaAndroid(work.root, { ndkVersion: null })).toThrow(/unsupported|template|permission/i);
    expect(work.snapshot()).toEqual(before);
  });
  it('fails closed on an unfamiliar Tauri application attribute before writing', async () => {
    const { prepareBetaAndroid } = await import('../../../scripts/dev/beta-android-prepare');
    const work = fixture();
    writeFileSync(work.files.manifest, freshManifest.replace(
      '<application\n',
      '<application android:screenOrientation="portrait"\n',
    ));
    const before = work.snapshot();

    expect(() => prepareBetaAndroid(work.root, { ndkVersion: null })).toThrow(/unsupported|template|application/i);
    expect(work.snapshot()).toEqual(before);
  });
  it('rejects an Alpha namespace before changing any file', async () => {
    const { prepareBetaAndroid } = await import('../../../scripts/dev/beta-android-prepare');
    const work = fixture('com.exomind.app.v06'); const before = work.snapshot();
    expect(() => prepareBetaAndroid(work.root,{ndkVersion:null})).toThrow(/Beta|namespace/); expect(work.snapshot()).toEqual(before);
  });
  it('keeps the Beta composer above actual IME insets, including fullscreen', async () => {
    const { prepareBetaAndroid } = await import('../../../scripts/dev/beta-android-prepare');
    const work = fixture();
    prepareBetaAndroid(work.root,{ndkVersion:null});
    const activity = work.snapshot().activity;
    expect(activity).toContain('window.setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)');
    expect(activity).toContain('val ime = androidx.core.view.WindowInsetsCompat.Type.ime()');
    expect(activity).toContain('maxOf(padding.bottom, insets.getInsets(ime).bottom)');
    expect(activity).toContain('.setInsets(ime, androidx.core.graphics.Insets.NONE)');
    expect(prepareBetaAndroid(work.root,{ndkVersion:null}).changedFiles).toEqual([]);
  });
  it.each(['applicationId','launcher','package','incomplete'])('rejects %s mismatch before writing the manifest', async kind => {
    const { prepareBetaAndroid } = await import('../../../scripts/dev/beta-android-prepare');
    const work = fixture();
    if (kind === 'applicationId') writeFileSync(work.files.gradle, readFileSync(work.files.gradle,'utf8').replace(`applicationId = "${beta}"`, 'applicationId = "other.app"'));
    if (kind === 'launcher') writeFileSync(work.files.manifest, readFileSync(work.files.manifest,'utf8').replace('.MainActivity','.OtherActivity'));
    if (kind === 'package') writeFileSync(work.files.activity, freshActivity.replace(beta,'com.exomind.app.v06'));
    if (kind === 'incomplete') writeFileSync(work.files.activity, `package ${beta}\nclass MainActivity : TauriActivity() {\n  fun setExomindFullscreen(enabled: Boolean) {}\n}\n`);
    const before = work.snapshot(); expect(() => prepareBetaAndroid(work.root,{ndkVersion:null})).toThrow(); expect(work.snapshot()).toEqual(before);
  });
});
