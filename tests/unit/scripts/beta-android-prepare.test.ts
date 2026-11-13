import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  return { root, files, snapshot: () => Object.fromEntries(Object.entries(files).map(([key,path]) => [key,readFileSync(path,'utf8')])) };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('isolated Beta Android preparation', () => {
  it('patches fresh Beta display integration, preserves Gradle and permissions, and is idempotent', async () => {
    const { prepareBetaAndroid } = await import('../../../scripts/dev/beta-android-prepare');
    const work = fixture(); const before = work.snapshot();
    const result = prepareBetaAndroid(work.root);
    expect(result.changedFiles).toHaveLength(2);
    const after = work.snapshot(); expect(after.gradle).toBe(before.gradle); expect(after.config).toBe(before.config);
    expect(after.activity).toContain('fun setExomindFullscreen(enabled: Boolean)');
    expect(after.activity).toContain('override fun onConfigurationChanged(newConfig: android.content.res.Configuration)');
    expect(after.activity).toMatch(/super\.onResume\(\)\s+applyExomindSystemBars\(\)/);
    expect(after.activity).toContain('if (hasFocus) applyExomindSystemBars()');
    expect(after.activity).toContain('if (exomindFullscreen) cutout else bars or cutout');
    expect(after.activity).not.toMatch(/MulticastLock|WifiManager|WindowInsetsCompat\.CONSUMED/);
    expect(after.manifest).toContain('android:configChanges=');
    expect(after.manifest).not.toMatch(/RECORD_AUDIO|MODIFY_AUDIO_SETTINGS|ACCESS_WIFI|CHANGE_WIFI|usesCleartextTraffic="true"/);
    expect(prepareBetaAndroid(work.root).changedFiles).toEqual([]); expect(work.snapshot()).toEqual(after);
  });
  it('rejects an Alpha namespace before changing any file', async () => {
    const { prepareBetaAndroid } = await import('../../../scripts/dev/beta-android-prepare');
    const work = fixture('com.exomind.app.v06'); const before = work.snapshot();
    expect(() => prepareBetaAndroid(work.root)).toThrow(/Beta|namespace/); expect(work.snapshot()).toEqual(before);
  });
  it.each(['applicationId','launcher','package','incomplete'])('rejects %s mismatch before writing the manifest', async kind => {
    const { prepareBetaAndroid } = await import('../../../scripts/dev/beta-android-prepare');
    const work = fixture();
    if (kind === 'applicationId') writeFileSync(work.files.gradle, readFileSync(work.files.gradle,'utf8').replace(`applicationId = "${beta}"`, 'applicationId = "other.app"'));
    if (kind === 'launcher') writeFileSync(work.files.manifest, readFileSync(work.files.manifest,'utf8').replace('.MainActivity','.OtherActivity'));
    if (kind === 'package') writeFileSync(work.files.activity, freshActivity.replace(beta,'com.exomind.app.v06'));
    if (kind === 'incomplete') writeFileSync(work.files.activity, `package ${beta}\nclass MainActivity : TauriActivity() {\n  fun setExomindFullscreen(enabled: Boolean) {}\n}\n`);
    const before = work.snapshot(); expect(() => prepareBetaAndroid(work.root)).toThrow(); expect(work.snapshot()).toEqual(before);
  });
});
