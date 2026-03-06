import { render, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskSyncCoordinator } from '@/ui/app/components/TaskSyncCoordinator';
import { ReminderSyncCoordinator } from '@/ui/app/components/ReminderSyncCoordinator';

type SyncStoreState = {
  isLoggedIn: boolean;
  credentials: {
    username?: string;
    remoteIdentityKey?: string;
  } | null;
  status: {
    state: 'disconnected' | 'connecting' | 'connected' | 'syncing' | 'error';
  };
};

const syncStoreState: SyncStoreState = {
  isLoggedIn: true,
  credentials: {
    remoteIdentityKey: 'remote-space',
    username: 'fallback-user',
  },
  status: {
    state: 'disconnected',
  },
};

const taskService = {
  startSync: vi.fn().mockResolvedValue(undefined),
  stopSync: vi.fn().mockResolvedValue(undefined),
};

const reminderService = {
  startSync: vi.fn().mockResolvedValue(undefined),
  stopSync: vi.fn().mockResolvedValue(undefined),
};

vi.mock('@/ui/stores/sync-store', () => ({
  useSyncStore: vi.fn((selector: (state: SyncStoreState) => unknown) => selector(syncStoreState)),
  resolveRemoteSyncKey: vi.fn((credentials: SyncStoreState['credentials']) =>
    credentials?.remoteIdentityKey?.trim() || credentials?.username?.trim() || null
  ),
}));

vi.mock('@/lib/services', () => ({
  getTaskService: vi.fn(() => taskService),
}));

vi.mock('@/lib/services/reminder.service', () => ({
  getReminderService: vi.fn(() => reminderService),
}));

vi.mock('@/config/port-env', () => ({
  SYNC_SERVER_URL_CHANGED_EVENT: 'exomind:test-sync-server-url-changed',
  resolveSyncServerUrl: vi.fn(() => 'http://127.0.0.1:6984'),
}));

describe('legacy sync coordinators issue-381（旧同步协调器门控）', () => {
  beforeEach(() => {
    syncStoreState.isLoggedIn = true;
    syncStoreState.credentials = {
      remoteIdentityKey: 'remote-space',
      username: 'fallback-user',
    };
    syncStoreState.status.state = 'disconnected';
    taskService.startSync.mockClear();
    taskService.stopSync.mockClear();
    reminderService.startSync.mockClear();
    reminderService.stopSync.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('TaskSyncCoordinator should not start legacy sync unless sync-store status is connected（未连接时不应启动旧同步）', async () => {
    render(<TaskSyncCoordinator />);

    await waitFor(() => {
      expect(taskService.stopSync).toHaveBeenCalled();
    });

    expect(taskService.startSync).not.toHaveBeenCalled();
  });

  it('ReminderSyncCoordinator should not start legacy sync unless sync-store status is connected（未连接时不应启动旧同步）', async () => {
    render(<ReminderSyncCoordinator />);

    await waitFor(() => {
      expect(reminderService.stopSync).toHaveBeenCalled();
    });

    expect(reminderService.startSync).not.toHaveBeenCalled();
  });

  it('TaskSyncCoordinator still starts legacy sync after explicit legacy connection（显式连接后仍保留旧链路）', async () => {
    syncStoreState.status.state = 'connected';

    render(<TaskSyncCoordinator />);

    await waitFor(() => {
      expect(taskService.startSync).toHaveBeenCalledWith('http://127.0.0.1:6984/remote-space');
    });
  });

  it('ReminderSyncCoordinator still starts legacy sync after explicit legacy connection（显式连接后仍保留旧链路）', async () => {
    syncStoreState.status.state = 'connected';

    render(<ReminderSyncCoordinator />);

    await waitFor(() => {
      expect(reminderService.startSync).toHaveBeenCalledWith('http://127.0.0.1:6984/remote-space__reminders');
    });
  });

  it('TaskSyncCoordinator keeps legacy sync alive while sync-store is syncing（手动同步中不应误停）', async () => {
    syncStoreState.status.state = 'syncing';

    render(<TaskSyncCoordinator />);

    await waitFor(() => {
      expect(taskService.startSync).toHaveBeenCalledWith('http://127.0.0.1:6984/remote-space');
    });
  });

  it('ReminderSyncCoordinator keeps legacy sync alive while sync-store is syncing（手动同步中不应误停）', async () => {
    syncStoreState.status.state = 'syncing';

    render(<ReminderSyncCoordinator />);

    await waitFor(() => {
      expect(reminderService.startSync).toHaveBeenCalledWith('http://127.0.0.1:6984/remote-space__reminders');
    });
  });
});
