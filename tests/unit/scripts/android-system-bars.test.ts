import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureAndroidSystemBarsInMainActivity, ensureMdnsMulticastLockInMainActivity, ensureMdnsMulticastLockInMainActivityFile } from '../../../scripts/dev/android-manifest-permission-lib';

describe('Android generated Activity system bars', () => {
  it('upgrades the existing multicast Activity without discarding keyboard or custom integration', () => {
    const generated = ensureMdnsMulticastLockInMainActivity(`package com.exomind.app.v06
class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
  }
}
`).activityKotlin;
    const existing = generated.replace('acquireMulticastLock()', 'acquireMulticastLock()\n    Log.i("Custom", "keep me")');
    const result = ensureAndroidSystemBarsInMainActivity(existing);

    expect(result.changed).toBe(true);
    expect(result.activityKotlin).toContain('Log.i("Custom", "keep me")');
    expect(result.activityKotlin).toContain('notifyKeyboardState(newConfig)');
    expect(result.activityKotlin).toContain('installExomindSystemBarInsets()');
    expect(result.activityKotlin).toContain('view.setPadding(padding.left, padding.top, padding.right, padding.bottom)');
    expect(result.activityKotlin).toContain('if (exomindFullscreen) controller.hide(bars) else controller.show(bars)');
    expect(result.activityKotlin).toContain('if (hasFocus) applyExomindSystemBars()');
    expect(result.activityKotlin).toContain('super.onResume()');
    expect(result.activityKotlin).not.toContain('WindowInsetsCompat.CONSUMED');
    expect(ensureAndroidSystemBarsInMainActivity(result.activityKotlin)).toEqual({ activityKotlin: result.activityKotlin, changed: false });
  });

  it('leaves unrelated or incomplete Activities intact', () => {
    for (const activity of ['class OtherActivity {}', 'class MainActivity : TauriActivity() {}']) {
      expect(ensureAndroidSystemBarsInMainActivity(activity)).toEqual({ activityKotlin: activity, changed: false });
    }
  });

  it.each([
    'class UnsupportedActivity { val marker = \'createMulticastLock("exomind-mdns-lock")\' }',
    'class MainActivity : TauriActivity() {\n  val marker = \'createMulticastLock("exomind-mdns-lock")\'\n  fun setExomindFullscreen(enabled: Boolean) {}\n}\n',
  ])('does not certify an Activity with only an old or partial integration marker', (activity) => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'alpha-system-bars-'));
    const activityPath = join(temporaryDirectory, 'MainActivity.kt');
    try {
      writeFileSync(activityPath, activity);
      expect(ensureMdnsMulticastLockInMainActivityFile(activityPath)).toEqual({ status: 'invalid-activity', changed: false });
      expect(readFileSync(activityPath, 'utf8')).toBe(activity);
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('certifies file integration only after both multicast and system bars are installed', () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'alpha-system-bars-'));
    const activityPath = join(temporaryDirectory, 'MainActivity.kt');
    try {
      writeFileSync(activityPath, 'package com.exomind.app.v06\nclass MainActivity : TauriActivity() {\n  override fun onCreate(savedInstanceState: Bundle?) {\n    super.onCreate(savedInstanceState)\n  }\n}\n');
      expect(ensureMdnsMulticastLockInMainActivityFile(activityPath)).toEqual({ status: 'updated', changed: true });
      expect(readFileSync(activityPath, 'utf8')).toContain('installExomindSystemBarInsets()');
      expect(ensureMdnsMulticastLockInMainActivityFile(activityPath)).toEqual({ status: 'already-present', changed: false });
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
