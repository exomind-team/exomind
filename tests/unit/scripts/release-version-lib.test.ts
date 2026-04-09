import { describe, expect, it } from 'vitest';
import {
  applyCanonicalVersionToTexts,
  bumpCanonicalVersion,
  findLatestCanonicalTag,
  resolveCanonicalVersionFromTexts,
  resolveReleaseVersionPlan,
} from '../../../scripts/dev/release-version-lib.ts';

describe('release-version-lib', () => {
  it('finds the latest canonical tag from mixed tag namespaces（应忽略非 canonical tag 并按语义化版本取最新）', () => {
    const result = findLatestCanonicalTag([
      'release/v0.3.5',
      'build/v0.3.6-build.68',
      'v0.4.2',
      'v0.4.4',
      'v0.4.3',
    ]);

    expect(result).toBe('v0.4.4');
  });

  it('bumps only when local version is already synced to the latest remote version（本地必须先与远端最新版本对齐后才能自动 bump）', () => {
    const plan = resolveReleaseVersionPlan({
      localVersion: '0.4.4',
      remoteTags: ['v0.4.4', 'v0.4.2'],
      bump: 'patch',
    });

    expect(plan.baseVersion).toBe('0.4.4');
    expect(plan.nextVersion).toBe('0.4.5');
    expect(plan.nextTag).toBe('v0.4.5');
  });

  it('rejects bump planning when local version is not the latest remote version（本地版本落后或超前远端最新版本时应直接拒绝）', () => {
    expect(() =>
      resolveReleaseVersionPlan({
        localVersion: '0.4.3',
        remoteTags: ['v0.4.4', 'v0.4.2'],
        bump: 'patch',
      }),
    ).toThrow(/本地版本 0.4.3 与远端最新版本 0.4.4 不一致/);
  });

  it('accepts an explicit version only when it is newer than the base（显式版本必须大于基线版本）', () => {
    const plan = resolveReleaseVersionPlan({
      localVersion: '0.4.4',
      remoteTags: ['v0.4.4'],
      bump: 'patch',
      explicitVersion: '0.4.6',
    });

    expect(plan.nextVersion).toBe('0.4.6');
  });

  it('rejects explicit versions that do not advance（显式版本不允许原地重复）', () => {
    expect(() =>
      resolveReleaseVersionPlan({
        localVersion: '0.4.4',
        remoteTags: ['v0.4.4'],
        bump: 'patch',
        explicitVersion: '0.4.4',
      }),
    ).toThrow(/下一版本必须大于基线版本/);
  });

  it('updates all canonical version files consistently（应同时更新三处 canonical version 文件）', () => {
    const updated = applyCanonicalVersionToTexts(
      {
        packageJson: JSON.stringify({ name: 'exomind', version: '0.4.4' }, null, 2),
        cargoToml: ['[package]', 'name = "exomind"', 'version = "0.4.4"', ''].join('\n'),
        tauriConfig: JSON.stringify({ productName: 'ExoMind', version: '0.4.4' }, null, 2),
      },
      '0.4.5',
    );

    expect(resolveCanonicalVersionFromTexts(updated)).toBe('0.4.5');
    expect(updated.packageJson).toContain('"version": "0.4.5"');
    expect(updated.cargoToml).toContain('version = "0.4.5"');
    expect(updated.tauriConfig).toContain('"version": "0.4.5"');
  });

  it('bumps semantic versions by major minor and patch（应支持 major/minor/patch bump）', () => {
    expect(bumpCanonicalVersion('0.4.4', 'patch')).toBe('0.4.5');
    expect(bumpCanonicalVersion('0.4.4', 'minor')).toBe('0.5.0');
    expect(bumpCanonicalVersion('0.4.4', 'major')).toBe('1.0.0');
  });
});
