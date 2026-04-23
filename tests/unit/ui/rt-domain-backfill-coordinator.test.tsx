import { render, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __primeRuntimeConfigForTests,
  __resetRuntimeConfigCacheForTests,
} from '@/config/runtime-config-cache';
import { RtDomainBackfillCoordinator } from '@/ui/app/components/RtDomainBackfillCoordinator';

type SyncStoreState = {
  isLoggedIn: boolean;
  activeProfileId: string | null;
};

const syncStoreState: SyncStoreState = {
  isLoggedIn: true,
  activeProfileId: 'profile-local',
};

const backfillService = {
  backfillConfirmedPeers: vi.fn().mockResolvedValue(undefined),
};

vi.mock('@/ui/stores/sync-store', () => ({
  useSyncStore: vi.fn((selector: (state: SyncStoreState) => unknown) => selector(syncStoreState)),
}));

vi.mock('@/lib/services/rt-domain-backfill.service', () => ({
  getRtDomainBackfillService: vi.fn(() => backfillService),
}));

describe('RtDomainBackfillCoordinator', () => {
  beforeEach(() => {
    __resetRuntimeConfigCacheForTests();
    syncStoreState.isLoggedIn = true;
    syncStoreState.activeProfileId = 'profile-local';
    backfillService.backfillConfirmedPeers.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('starts backfill when user is logged in with an active profile（登录且有当前档案时启动补拉）', async () => {
    render(<RtDomainBackfillCoordinator />);

    await waitFor(() => {
      expect(backfillService.backfillConfirmedPeers).toHaveBeenCalledTimes(1);
    });
  });

  it('does not start backfill when no active profile is selected（没有当前档案时不应补拉）', async () => {
    syncStoreState.activeProfileId = null;
    render(<RtDomainBackfillCoordinator />);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(backfillService.backfillConfirmedPeers).not.toHaveBeenCalled();
  });

  it('does not start backfill when sync automation is disabled（关闭自动同步时不应补拉）', async () => {
    __primeRuntimeConfigForTests({
      'exomind:syncAutomationEnabled': 'false',
    });
    render(<RtDomainBackfillCoordinator />);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(backfillService.backfillConfirmedPeers).not.toHaveBeenCalled();
  });

  it('retries backfill on the 15s interval while the profile stays active（当前档案激活时应按 15s 定时补拉）', async () => {
    vi.useFakeTimers();
    render(<RtDomainBackfillCoordinator />);

    await vi.advanceTimersByTimeAsync(0);
    expect(backfillService.backfillConfirmedPeers).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(backfillService.backfillConfirmedPeers).toHaveBeenCalledTimes(2);
  });

  it('retries backfill when the window regains focus or network comes back（focus/online 事件应立即重试补拉）', async () => {
    vi.useFakeTimers();
    render(<RtDomainBackfillCoordinator />);

    await vi.advanceTimersByTimeAsync(0);
    expect(backfillService.backfillConfirmedPeers).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(0);
    expect(backfillService.backfillConfirmedPeers).toHaveBeenCalledTimes(2);

    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(backfillService.backfillConfirmedPeers).toHaveBeenCalledTimes(3);
  });

  it('cleans up timers and listeners after unmount（卸载后不再继续补拉）', async () => {
    vi.useFakeTimers();
    const view = render(<RtDomainBackfillCoordinator />);

    await vi.advanceTimersByTimeAsync(0);
    expect(backfillService.backfillConfirmedPeers).toHaveBeenCalledTimes(1);

    view.unmount();
    await vi.advanceTimersByTimeAsync(15_000);
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);

    expect(backfillService.backfillConfirmedPeers).toHaveBeenCalledTimes(1);
  });
});
