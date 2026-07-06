import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getCurrentProfileOrLegacyIdMock, syncStoreGetStateMock } = vi.hoisted(() => ({
  getCurrentProfileOrLegacyIdMock: vi.fn(() => 'profile-default'),
  syncStoreGetStateMock: vi.fn(() => ({ activeProfileId: null })),
}));

vi.mock('@/lib/profile/profile-storage', () => ({
  getCurrentProfileOrLegacyId: getCurrentProfileOrLegacyIdMock,
}));

vi.mock('@/ui/stores/sync-store', () => ({
  useSyncStore: {
    getState: syncStoreGetStateMock,
  },
}));

import { appendRuntimeProfileScope } from '@/lib/adapters/runtime-profile-scope';

describe('appendRuntimeProfileScope（运行时档案作用域拼接）', () => {
  beforeEach(() => {
    getCurrentProfileOrLegacyIdMock.mockReset();
    getCurrentProfileOrLegacyIdMock.mockReturnValue('profile-default');
    syncStoreGetStateMock.mockReset();
    syncStoreGetStateMock.mockReturnValue({ activeProfileId: null });
  });

  it('prefers active profile from sync store（优先使用主窗口同步状态里的档案）', () => {
    syncStoreGetStateMock.mockReturnValue({ activeProfileId: 'profile-store' });

    expect(appendRuntimeProfileScope('/eventlog')).toBe('/eventlog?user_id=profile-store');
    expect(getCurrentProfileOrLegacyIdMock).not.toHaveBeenCalled();
  });

  it('preserves existing query params and appends user_id（保留原查询参数并追加 user_id）', () => {
    getCurrentProfileOrLegacyIdMock.mockReturnValue('profile-a');

    expect(appendRuntimeProfileScope('/tasks/import/sqlite?strategy=overwrite')).toBe(
      '/tasks/import/sqlite?strategy=overwrite&user_id=profile-a',
    );
  });

  it('falls back to legacy user identifier from profile storage（回退到档案存储返回的旧用户标识）', () => {
    getCurrentProfileOrLegacyIdMock.mockReturnValue('legacy-user');

    expect(appendRuntimeProfileScope('/eventlog')).toBe('/eventlog?user_id=legacy-user');
  });
});
