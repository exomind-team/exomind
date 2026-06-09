import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeHostRecord } from '@/lib/types/agent-hub';

const mocks = vi.hoisted(() => ({
  listHostsMock: vi.fn(),
  localEventImportMock: vi.fn(),
  localTaskImportMock: vi.fn(),
  localTimeBlockImportMock: vi.fn(),
  peerEventExportMock: vi.fn(),
  peerTaskExportMock: vi.fn(),
  peerTimeBlockExportMock: vi.fn(),
  notifyTaskDataChangedMock: vi.fn(),
  notifyTimeBlockDataChangedMock: vi.fn(),
}));

vi.mock('@/lib/services/task.service', () => ({
  notifyTaskDataChanged: mocks.notifyTaskDataChangedMock,
}));

vi.mock('@/lib/services/timeblock.service', () => ({
  notifyTimeBlockDataChanged: mocks.notifyTimeBlockDataChangedMock,
}));

import { RtDomainBackfillService } from '@/lib/services/rt-domain-backfill.service';

describe('RtDomainBackfillService', () => {
  const confirmedPeer: RuntimeHostRecord = {
    id: 'peer-1',
    name: 'Peer One',
    host: '192.168.1.10',
    port: 9124,
    status: 'online',
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    isLocal: false,
    hostId: 'peer-host-1',
    trustState: 'confirmed_peer',
    authToken: 'remote-control-token',
  };

  beforeEach(() => {
    mocks.listHostsMock.mockReset().mockResolvedValue([confirmedPeer]);
    mocks.peerEventExportMock.mockReset().mockResolvedValue({
      fileName: 'events.sqlite',
      bytes: new Uint8Array([1, 2, 3]),
      eventCount: 3,
    });
    mocks.peerTaskExportMock.mockReset().mockResolvedValue({
      fileName: 'tasks.sqlite',
      bytes: new Uint8Array([4, 5, 6]),
      taskCount: 2,
    });
    mocks.peerTimeBlockExportMock.mockReset().mockResolvedValue({
      fileName: 'timeblocks.sqlite',
      bytes: new Uint8Array([7, 8, 9]),
      timeBlockCount: 1,
      activeBlockPresent: false,
    });
    mocks.localEventImportMock.mockReset().mockResolvedValue({ imported: 3, skipped: 0, total: 3 });
    mocks.localTaskImportMock.mockReset().mockResolvedValue({ imported: 2, skipped: 0, total: 2 });
    mocks.localTimeBlockImportMock.mockReset().mockResolvedValue({
      imported: 1,
      skipped: 0,
      total: 1,
      activeBlockUpdated: false,
    });
    mocks.notifyTaskDataChangedMock.mockReset();
    mocks.notifyTimeBlockDataChangedMock.mockReset();
  });

  it('backfills confirmed peers via sqlite snapshots and notifies local domains（通过 sqlite 快照补拉 confirmed peer 并通知本地域刷新）', async () => {
    const service = new RtDomainBackfillService({
      hostService: {
        listHosts: mocks.listHostsMock,
      },
      localEventLogBackupService: {
        importEventsFromSqliteSnapshot: mocks.localEventImportMock,
      },
      localTaskBackupService: {
        importTasksFromSqliteSnapshot: mocks.localTaskImportMock,
      },
      localTimeBlockBackupService: {
        importTimeBlocksFromSqliteSnapshot: mocks.localTimeBlockImportMock,
      },
      createPeerEventLogBackupService: () => ({
        exportEventsAsSqliteSnapshot: mocks.peerEventExportMock,
      }),
      createPeerTaskBackupService: () => ({
        exportTasksAsSqliteSnapshot: mocks.peerTaskExportMock,
      }),
      createPeerTimeBlockBackupService: () => ({
        exportTimeBlocksAsSqliteSnapshot: mocks.peerTimeBlockExportMock,
      }),
    });

    const result = await service.backfillConfirmedPeers();

    expect(mocks.listHostsMock).toHaveBeenCalledTimes(1);
    expect(mocks.peerEventExportMock).toHaveBeenCalledTimes(1);
    expect(mocks.peerTaskExportMock).toHaveBeenCalledTimes(1);
    expect(mocks.peerTimeBlockExportMock).toHaveBeenCalledTimes(1);
    expect(mocks.localEventImportMock).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), 'merge');
    expect(mocks.localTaskImportMock).toHaveBeenCalledWith(new Uint8Array([4, 5, 6]), 'merge');
    expect(mocks.localTimeBlockImportMock).toHaveBeenCalledWith(new Uint8Array([7, 8, 9]), 'merge');
    expect(mocks.notifyTaskDataChangedMock).toHaveBeenCalledTimes(1);
    expect(mocks.notifyTimeBlockDataChangedMock).toHaveBeenCalledTimes(1);
    expect(result.peers).toBe(1);
    expect(result.eventlog.imported).toBe(3);
    expect(result.tasks.imported).toBe(2);
    expect(result.timeblocks.imported).toBe(1);
  });

  it('ignores hosts that are not confirmed peers（忽略未确认 peer 的主机）', async () => {
    mocks.listHostsMock.mockResolvedValue([
      {
        ...confirmedPeer,
        id: 'manual-1',
        trustState: 'manual_seed',
      },
    ]);

    const service = new RtDomainBackfillService({
      hostService: {
        listHosts: mocks.listHostsMock,
      },
      localEventLogBackupService: {
        importEventsFromSqliteSnapshot: mocks.localEventImportMock,
      },
      localTaskBackupService: {
        importTasksFromSqliteSnapshot: mocks.localTaskImportMock,
      },
      localTimeBlockBackupService: {
        importTimeBlocksFromSqliteSnapshot: mocks.localTimeBlockImportMock,
      },
      createPeerEventLogBackupService: () => ({
        exportEventsAsSqliteSnapshot: mocks.peerEventExportMock,
      }),
      createPeerTaskBackupService: () => ({
        exportTasksAsSqliteSnapshot: mocks.peerTaskExportMock,
      }),
      createPeerTimeBlockBackupService: () => ({
        exportTimeBlocksAsSqliteSnapshot: mocks.peerTimeBlockExportMock,
      }),
    });

    const result = await service.backfillConfirmedPeers();

    expect(mocks.peerEventExportMock).not.toHaveBeenCalled();
    expect(mocks.localEventImportMock).not.toHaveBeenCalled();
    expect(result.peers).toBe(0);
  });

  it('skips tokenless confirmed peers to avoid protected snapshot 401s（confirmed peer 缺少控制面 token 时跳过补拉）', async () => {
    mocks.listHostsMock.mockResolvedValue([
      {
        ...confirmedPeer,
        authToken: undefined,
      },
    ]);

    const service = new RtDomainBackfillService({
      hostService: {
        listHosts: mocks.listHostsMock,
      },
      localEventLogBackupService: {
        importEventsFromSqliteSnapshot: mocks.localEventImportMock,
      },
      localTaskBackupService: {
        importTasksFromSqliteSnapshot: mocks.localTaskImportMock,
      },
      localTimeBlockBackupService: {
        importTimeBlocksFromSqliteSnapshot: mocks.localTimeBlockImportMock,
      },
      createPeerEventLogBackupService: () => ({
        exportEventsAsSqliteSnapshot: mocks.peerEventExportMock,
      }),
      createPeerTaskBackupService: () => ({
        exportTasksAsSqliteSnapshot: mocks.peerTaskExportMock,
      }),
      createPeerTimeBlockBackupService: () => ({
        exportTimeBlocksAsSqliteSnapshot: mocks.peerTimeBlockExportMock,
      }),
    });

    const result = await service.backfillConfirmedPeers();

    expect(mocks.peerEventExportMock).not.toHaveBeenCalled();
    expect(mocks.peerTaskExportMock).not.toHaveBeenCalled();
    expect(mocks.peerTimeBlockExportMock).not.toHaveBeenCalled();
    expect(mocks.localEventImportMock).not.toHaveBeenCalled();
    expect(mocks.localTaskImportMock).not.toHaveBeenCalled();
    expect(mocks.localTimeBlockImportMock).not.toHaveBeenCalled();
    expect(result.peers).toBe(0);
  });
});
