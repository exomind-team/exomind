import { describe, expect, it } from 'vitest';
import {
  resolveAppVersion,
  resolveBuildHash,
  resolveVersionBuildInfo,
} from '@/config/version-build-info';

describe('version build info resolver', () => {
  it('prefers VITE_APP_VERSION when present（优先使用 VITE_APP_VERSION）', () => {
    const version = resolveAppVersion(
      {
        VITE_APP_VERSION: '0.2.1-beta.1',
      },
      '0.2.1'
    );

    expect(version).toBe('0.2.1-beta.1');
  });

  it('falls back to base version when app version env is missing（缺失时回退基础版本）', () => {
    const version = resolveAppVersion({}, '0.2.1');

    expect(version).toBe('0.2.1');
  });

  it('uses dev when build hash env is invalid（非法 hash 回退 dev）', () => {
    expect(resolveBuildHash(undefined)).toBe('dev');
    expect(resolveBuildHash('')).toBe('dev');
    expect(resolveBuildHash('abc')).toBe('dev');
  });

  it('normalizes build hash to short lowercase（hash 归一化为小写短哈希）', () => {
    expect(resolveBuildHash('DBCE231ABC')).toBe('dbce231');
    expect(resolveBuildHash('dbce231')).toBe('dbce231');
  });

  it('resolves complete app version and build hash（组合解析版本与哈希）', () => {
    const info = resolveVersionBuildInfo(
      {
        VITE_APP_VERSION: '0.2.1-beta.1',
        VITE_BUILD_HASH: 'DBCE23189',
      },
      '0.2.1'
    );

    expect(info.appVersion).toBe('0.2.1-beta.1');
    expect(info.buildHash).toBe('dbce231');
  });
});

