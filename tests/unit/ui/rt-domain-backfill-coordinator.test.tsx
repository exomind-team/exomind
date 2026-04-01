import { render, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    syncStoreState.isLoggedIn = true;
    syncStoreState.activeProfileId = 'profile-local';
    backfillService.backfillConfirmedPeers.mockClear();
  });

  afterEach(() => {
    cleanup();
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
});
