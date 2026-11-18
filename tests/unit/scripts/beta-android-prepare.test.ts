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
  put(files.manifest, '<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n<uses-permission android:name="android.permission.INTERNET"/>\n<application android:label="ExoMind Beta"><activity android:name=".MainActivity" android:exported="true"><intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter></activity></application>\n</manifest>\n');
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
  it('patches fresh Beta display integration, preserves Gradle and permissions, and is idempotent', async () => {
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
    expect(after.manifest).not.toMatch(/RECORD_AUDIO|MODIFY_AUDIO_SETTINGS|ACCESS_WIFI|CHANGE_WIFI|usesCleartextTraffic="true"/);
    expect(prepareBetaAndroid(work.root,{ndkVersion:null}).changedFiles).toEqual([]); expect(work.snapshot()).toEqual(after);
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
