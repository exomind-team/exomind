import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { state, markMigrationSkipped, markMigrationPending, markMigrationCompleted } = vi.hoisted(() => ({
  state: {
    runtime: 'tauri' as 'tauri' | 'web',
    completed: false,
    skipped: false,
    pending: false,
    rtEmpty: true,
    summary: {
      eventlogCount: 1,
      taskCount: 1,
      timeblockCount: 0,
      hasActiveBlock: false,
      hasAnyData: true,
    },
  },
  markMigrationSkipped: vi.fn(),
  markMigrationPending: vi.fn(),
  markMigrationCompleted: vi.fn(),
}));

vi.mock('@/lib/environment/bootstrap', () => ({
  detectRuntime: () => state.runtime,
}));

vi.mock('@/lib/migration/legacy-migration-detector', () => ({
  detectLegacyData: vi.fn(async () => state.summary),
  detectRtIsEmpty: vi.fn(async () => state.rtEmpty),
}));

vi.mock('@/lib/migration/legacy-migration-executor', () => ({
  executeMigration: vi.fn(async () => ({ success: true, migratedDomains: ['eventlog', 'task', 'timeblock'] })),
}));

vi.mock('@/lib/migration/legacy-migration-flags', () => ({
  isMigrationCompleted: () => state.completed,
  isMigrationSkipped: () => state.skipped,
  isMigrationPending: () => state.pending,
  markMigrationSkipped,
  markMigrationPending,
  markMigrationCompleted,
}));

vi.mock('@/lib/adapters/tauri-eventlog-storage', () => ({
  TauriEventLogStorageAdapter: class {
    listEvents = vi.fn(async () => []);
  },
}));

vi.mock('@/lib/adapters/task-pouch-adapter', () => ({
  TaskPouchAdapter: class {
    listTasks = vi.fn(async () => []);
  },
}));

vi.mock('@/lib/adapters/web-storage', () => ({
  WebStorageAdapter: class {
    read = vi.fn(async () => null);
  },
}));

vi.mock('@/lib/adapters/eventlog-rt-adapter', () => ({
  EventLogRtAdapter: class {
    listEvents = vi.fn(async () => []);
  },
}));

vi.mock('@/lib/adapters/task-rt-adapter', () => ({
  TaskRtAdapter: class {
    listTasks = vi.fn(async () => []);
  },
}));

vi.mock('@/lib/adapters/runtime-profile-scope', () => ({
  appendRuntimeProfileScope: (path: string) => path,
}));

vi.mock('@/lib/services/timeblock-backup.service', () => ({
  TimeBlockBackupServiceImpl: class {},
}));

vi.mock('@/config/runtime-target', () => ({
  getSelectedRuntimeTarget: () => ({ host: '127.0.0.1', port: 9124 }),
}));

import { MigrationDialogController } from '@/ui/components/MigrationDialogController';

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  state.runtime = 'tauri';
  state.completed = false;
  state.skipped = false;
  state.pending = false;
  state.rtEmpty = true;
  state.summary = {
    eventlogCount: 1,
    taskCount: 1,
    timeblockCount: 0,
    hasActiveBlock: false,
    hasAnyData: true,
  };
  markMigrationSkipped.mockReset();
  markMigrationPending.mockReset();
  markMigrationCompleted.mockReset();
});

describe('MigrationDialogController behavior', () => {
  it('reopens migration dialog when pending retry exists even if RT is no longer empty', async () => {
    state.pending = true;
    state.rtEmpty = false;

    render(<MigrationDialogController />);

    await waitFor(() => {
      expect(screen.getByText('检测到旧版数据')).toBeInTheDocument();
    });
  });

  it('does not auto-open when migration was skipped', async () => {
    state.skipped = true;

    render(<MigrationDialogController />);

    await waitFor(() => {
      expect(screen.queryByText('检测到旧版数据')).toBeNull();
    });
  });

  it('marks migration as skipped when the dialog is deferred', async () => {
    render(<MigrationDialogController />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '暂不迁移' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '暂不迁移' }));

    expect(markMigrationSkipped).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByText('检测到旧版数据')).toBeNull();
    });
  });
});
