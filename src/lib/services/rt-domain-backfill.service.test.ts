import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeHostRecord } from '@/lib/types/agent-hub';

const { notifyTaskDataChangedMock, notifyTimeBlockDataChangedMock } = vi.hoisted(() => ({
  notifyTaskDataChangedMock: vi.fn(),
  notifyTimeBlockDataChangedMock: vi.fn(),
}));

vi.mock('@/lib/services/task.service', () => ({
  notifyTaskDataChanged: notifyTaskDataChangedMock,
}));

vi.mock('@/lib/services/timeblock.service', () => ({
  notifyTimeBlockDataChanged: notifyTimeBlockDataChangedMock,
}));

import { RtDomainBackfillService } from './rt-domain-backfill.service';

function createHost(overrides: Partial<RuntimeHostRecord> = {}): RuntimeHostRecord {
  return {
    id: 'host-record-1',
    name: 'Peer Host',
    host: '10.0.0.2',
    port: 9124,
    status: 'online',
    createdAt: '2026-04-13T00:00:00.000Z',
    updatedAt: '2026-04-13T00:00:00.000Z',
    trustState: 'confirmed_peer',
    hostId: 'peer-1',
    ...overrides,
  };
}

function createTaskReconcileResult(overrides: Partial<Awaited<ReturnType<{ reconcilePeer: () => Promise<{
  peerId: string;
  changed: boolean;
  unresolvedDrift: boolean;
  strategy: 'noop' | 'pull' | 'pull_then_snapshot' | 'unresolved';
  imported: number;
  skipped: number;
  total: number;
  localSummary: {
    schemaVersion: 1;
    scopeKey: string;
    taskCount: number;
    maxUpdatedAt: number;
    revisionHash: string;
    generatedAt: number;
  };
  remoteSummary: {
    schemaVersion: 1;
    scopeKey: string;
    taskCount: number;
    maxUpdatedAt: number;
    revisionHash: string;
    generatedAt: number;
  };
}> }['reconcilePeer']>>> = {}) {
  const summary = {
    schemaVersion: 1 as const,
    scopeKey: 'anonymous',
    taskCount: 1,
    maxUpdatedAt: 100,
    revisionHash: 'hash-a',
    generatedAt: 999,
  };

  return {
    peerId: 'peer-1',
    changed: false,
    unresolvedDrift: false,
    strategy: 'noop' as const,
    imported: 0,
    skipped: 0,
    total: 0,
    localSummary: summary,
    remoteSummary: summary,
    ...overrides,
  };
}

describe('RtDomainBackfillService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reconciles task peers and runs eventlog/timeblock mesh snapshots for mesh-only peers', async () => {
    const hostService = {
      listHosts: vi.fn().mockResolvedValue([
        createHost({
          id: 'record-mesh-only',
          hostId: 'peer-mesh-only',
          authToken: undefined,
        }),
      ]),
    };
    const taskReconciliationService = {
      reconcileScopeGrants: vi.fn().mockResolvedValue({
        scopeKey: 'anonymous',
        grantedPeers: 1,
      }),
      reconcilePeer: vi.fn().mockResolvedValue(createTaskReconcileResult({
        peerId: 'peer-mesh-only',
        changed: true,
        strategy: 'pull',
        imported: 2,
        total: 2,
        })),
    };
    const localEventLogBackupService = {
      reconcileEventLogScopeGrants: vi.fn().mockResolvedValue({
        scopeKey: 'anonymous',
        grantedPeers: 1,
      }),
      exportPeerEventsAsSqliteSnapshot: vi.fn().mockResolvedValue({
        fileName: 'peer-eventlog.sqlite',
        bytes: Uint8Array.from([1]),
        eventCount: 3,
      }),
      importEventsFromSqliteSnapshot: vi.fn().mockResolvedValue({
        imported: 3,
        skipped: 0,
        total: 3,
      }),
    };
    const localTimeBlockBackupService = {
      reconcileTimeBlockScopeGrants: vi.fn().mockResolvedValue({
        scopeKey: 'anonymous',
        grantedPeers: 1,
      }),
      exportPeerTimeBlocksAsSqliteSnapshot: vi.fn().mockResolvedValue({
        fileName: 'peer-timeblocks.sqlite',
        bytes: Uint8Array.from([2]),
        timeBlockCount: 2,
        activeBlockPresent: true,
      }),
      importTimeBlocksFromSqliteSnapshot: vi.fn().mockResolvedValue({
        imported: 1,
        skipped: 0,
        total: 1,
        activeBlockUpdated: true,
      }),
    };
    const createPeerEventLogBackupService = vi.fn();
    const createPeerTimeBlockBackupService = vi.fn();

    const service = new RtDomainBackfillService({
      hostService,
      taskReconciliationService,
      localEventLogBackupService,
      localTimeBlockBackupService,
      createPeerEventLogBackupService,
      createPeerTimeBlockBackupService,
    });

    const summary = await service.backfillConfirmedPeers();

    expect(taskReconciliationService.reconcileScopeGrants).toHaveBeenCalledTimes(1);
    expect(taskReconciliationService.reconcilePeer).toHaveBeenCalledWith('peer-mesh-only');
    expect(localEventLogBackupService.reconcileEventLogScopeGrants).toHaveBeenCalledTimes(1);
    expect(localTimeBlockBackupService.reconcileTimeBlockScopeGrants).toHaveBeenCalledTimes(1);
    expect(localEventLogBackupService.exportPeerEventsAsSqliteSnapshot).toHaveBeenCalledWith('peer-mesh-only');
    expect(localEventLogBackupService.importEventsFromSqliteSnapshot).toHaveBeenCalledWith(
      Uint8Array.from([1]),
      'merge',
    );
    expect(localTimeBlockBackupService.exportPeerTimeBlocksAsSqliteSnapshot).toHaveBeenCalledWith('peer-mesh-only');
    expect(localTimeBlockBackupService.importTimeBlocksFromSqliteSnapshot).toHaveBeenCalledWith(
      Uint8Array.from([2]),
      'merge',
    );
    expect(createPeerEventLogBackupService).not.toHaveBeenCalled();
    expect(createPeerTimeBlockBackupService).not.toHaveBeenCalled();
    expect(summary).toMatchObject({
      peers: 1,
      eventlog: {
        imported: 3,
        skipped: 0,
        total: 3,
      },
      tasks: {
        imported: 2,
        skipped: 0,
        total: 2,
      },
      timeblocks: {
        imported: 1,
        skipped: 0,
        total: 1,
        activeBlockUpdated: true,
      },
    });
    expect(notifyTaskDataChangedMock).toHaveBeenCalledTimes(1);
    expect(notifyTimeBlockDataChangedMock).toHaveBeenCalledTimes(1);
  });

  it('uses host.hostId for mesh routes, dedupes by hostId, and avoids legacy direct exporters when hostId exists', async () => {
    const hostService = {
      listHosts: vi.fn().mockResolvedValue([
        createHost({
          id: 'record-mesh',
          hostId: 'peer-mesh',
          authToken: undefined,
        }),
        createHost({
          id: 'record-control',
          hostId: 'peer-control',
          host: '10.0.0.3',
          authToken: 'control-secret',
          lastSuccessfulDialAddress: '10.0.0.3:9321',
        }),
        createHost({
          id: 'record-control-duplicate',
          hostId: 'peer-control',
          host: '10.0.0.30',
          authToken: 'control-secret-duplicate',
          lastSuccessfulDialAddress: '10.0.0.30:9321',
        }),
      ]),
    };
    const taskReconciliationService = {
      reconcileScopeGrants: vi.fn().mockResolvedValue({
        scopeKey: 'anonymous',
        grantedPeers: 2,
      }),
      reconcilePeer: vi.fn()
        .mockResolvedValueOnce(createTaskReconcileResult({
          peerId: 'peer-mesh',
          changed: false,
        }))
        .mockResolvedValueOnce(createTaskReconcileResult({
          peerId: 'peer-control',
          changed: false,
        })),
    };
    const localEventLogBackupService = {
      reconcileEventLogScopeGrants: vi.fn().mockResolvedValue({
        scopeKey: 'anonymous',
        grantedPeers: 2,
      }),
      exportPeerEventsAsSqliteSnapshot: vi.fn()
        .mockResolvedValueOnce({
          fileName: 'peer-mesh.sqlite',
          bytes: Uint8Array.from([10]),
          eventCount: 1,
        })
        .mockResolvedValueOnce({
          fileName: 'peer-control.sqlite',
          bytes: Uint8Array.from([11]),
          eventCount: 2,
        }),
      importEventsFromSqliteSnapshot: vi.fn().mockResolvedValue({
        imported: 1,
        skipped: 0,
        total: 1,
      }),
    };
    const localTimeBlockBackupService = {
      reconcileTimeBlockScopeGrants: vi.fn().mockResolvedValue({
        scopeKey: 'anonymous',
        grantedPeers: 2,
      }),
      exportPeerTimeBlocksAsSqliteSnapshot: vi.fn()
        .mockResolvedValueOnce({
          fileName: 'mesh-timeblocks.sqlite',
          bytes: Uint8Array.from([20]),
          timeBlockCount: 1,
          activeBlockPresent: false,
        })
        .mockResolvedValueOnce({
          fileName: 'control-timeblocks.sqlite',
          bytes: Uint8Array.from([21]),
          timeBlockCount: 1,
          activeBlockPresent: true,
        }),
      importTimeBlocksFromSqliteSnapshot: vi.fn().mockResolvedValue({
        imported: 1,
        skipped: 0,
        total: 1,
        activeBlockUpdated: true,
      }),
    };
    const createPeerEventLogBackupService = vi.fn();
    const createPeerTimeBlockBackupService = vi.fn();

    const service = new RtDomainBackfillService({
      hostService,
      taskReconciliationService,
      localEventLogBackupService,
      localTimeBlockBackupService,
      createPeerEventLogBackupService,
      createPeerTimeBlockBackupService,
    });

    const summary = await service.backfillConfirmedPeers();

    expect(taskReconciliationService.reconcileScopeGrants).toHaveBeenCalledTimes(1);
    expect(taskReconciliationService.reconcilePeer).toHaveBeenNthCalledWith(1, 'peer-mesh');
    expect(taskReconciliationService.reconcilePeer).toHaveBeenNthCalledWith(2, 'peer-control');
    expect(taskReconciliationService.reconcilePeer).toHaveBeenCalledTimes(2);
    expect(taskReconciliationService.reconcilePeer).not.toHaveBeenCalledWith('record-mesh');
    expect(taskReconciliationService.reconcilePeer).not.toHaveBeenCalledWith('record-control');

    expect(localEventLogBackupService.exportPeerEventsAsSqliteSnapshot).toHaveBeenNthCalledWith(1, 'peer-mesh');
    expect(localEventLogBackupService.exportPeerEventsAsSqliteSnapshot).toHaveBeenNthCalledWith(2, 'peer-control');
    expect(localTimeBlockBackupService.exportPeerTimeBlocksAsSqliteSnapshot).toHaveBeenNthCalledWith(1, 'peer-mesh');
    expect(localTimeBlockBackupService.exportPeerTimeBlocksAsSqliteSnapshot).toHaveBeenNthCalledWith(2, 'peer-control');
    expect(createPeerEventLogBackupService).not.toHaveBeenCalled();
    expect(createPeerTimeBlockBackupService).not.toHaveBeenCalled();
    expect(localEventLogBackupService.importEventsFromSqliteSnapshot).toHaveBeenCalledWith(
      Uint8Array.from([10]),
      'merge',
    );
    expect(localTimeBlockBackupService.importTimeBlocksFromSqliteSnapshot).toHaveBeenCalledWith(
      Uint8Array.from([20]),
      'merge',
    );
    expect(summary).toMatchObject({
      peers: 2,
      eventlog: { imported: 2, skipped: 0, total: 2 },
      tasks: { imported: 0, skipped: 0, total: 0 },
      timeblocks: { imported: 2, skipped: 0, total: 2, activeBlockUpdated: true },
    });
    expect(notifyTaskDataChangedMock).not.toHaveBeenCalled();
    expect(notifyTimeBlockDataChangedMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to legacy direct snapshot exporters for confirmed peers that lack hostId but still have control auth', async () => {
    const hostService = {
      listHosts: vi.fn().mockResolvedValue([
        createHost({
          id: 'record-legacy-control',
          hostId: undefined,
          host: '10.0.0.9',
          authToken: 'legacy-secret',
          lastSuccessfulDialAddress: '10.0.0.9:9321',
        }),
      ]),
    };
    const taskReconciliationService = {
      reconcileScopeGrants: vi.fn(),
      reconcilePeer: vi.fn(),
    };
    const localEventLogBackupService = {
      reconcileEventLogScopeGrants: vi.fn(),
      exportPeerEventsAsSqliteSnapshot: vi.fn(),
      importEventsFromSqliteSnapshot: vi.fn().mockResolvedValue({
        imported: 4,
        skipped: 0,
        total: 4,
      }),
    };
    const localTimeBlockBackupService = {
      reconcileTimeBlockScopeGrants: vi.fn(),
      exportPeerTimeBlocksAsSqliteSnapshot: vi.fn(),
      importTimeBlocksFromSqliteSnapshot: vi.fn().mockResolvedValue({
        imported: 2,
        skipped: 0,
        total: 2,
        activeBlockUpdated: false,
      }),
    };
    const createPeerEventLogBackupService = vi.fn().mockReturnValue({
      exportEventsAsSqliteSnapshot: vi.fn().mockResolvedValue({
        fileName: 'legacy-eventlog.sqlite',
        bytes: Uint8Array.from([31]),
        eventCount: 4,
      }),
    });
    const createPeerTimeBlockBackupService = vi.fn().mockReturnValue({
      exportTimeBlocksAsSqliteSnapshot: vi.fn().mockResolvedValue({
        fileName: 'legacy-timeblocks.sqlite',
        bytes: Uint8Array.from([41]),
        timeBlockCount: 2,
      }),
    });

    const service = new RtDomainBackfillService({
      hostService,
      taskReconciliationService,
      localEventLogBackupService,
      localTimeBlockBackupService,
      createPeerEventLogBackupService,
      createPeerTimeBlockBackupService,
    });

    const summary = await service.backfillConfirmedPeers();

    expect(taskReconciliationService.reconcileScopeGrants).not.toHaveBeenCalled();
    expect(taskReconciliationService.reconcilePeer).not.toHaveBeenCalled();
    expect(localEventLogBackupService.reconcileEventLogScopeGrants).not.toHaveBeenCalled();
    expect(localTimeBlockBackupService.reconcileTimeBlockScopeGrants).not.toHaveBeenCalled();
    expect(createPeerEventLogBackupService).toHaveBeenCalledWith(expect.objectContaining({
      host: '10.0.0.9',
      port: 9321,
      authToken: 'legacy-secret',
    }));
    expect(createPeerTimeBlockBackupService).toHaveBeenCalledWith(expect.objectContaining({
      host: '10.0.0.9',
      port: 9321,
      authToken: 'legacy-secret',
    }));
    expect(localEventLogBackupService.importEventsFromSqliteSnapshot).toHaveBeenCalledWith(
      Uint8Array.from([31]),
      'merge',
    );
    expect(localTimeBlockBackupService.importTimeBlocksFromSqliteSnapshot).toHaveBeenCalledWith(
      Uint8Array.from([41]),
      'merge',
    );
    expect(summary).toMatchObject({
      peers: 1,
      eventlog: { imported: 4, skipped: 0, total: 4 },
      timeblocks: { imported: 2, skipped: 0, total: 2, activeBlockUpdated: false },
    });
    expect(notifyTaskDataChangedMock).not.toHaveBeenCalled();
    expect(notifyTimeBlockDataChangedMock).toHaveBeenCalledTimes(1);
  });
});
