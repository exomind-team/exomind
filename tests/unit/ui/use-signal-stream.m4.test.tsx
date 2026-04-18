import { render, cleanup, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMBEDDED_RUNTIME_STATUS_STORAGE_KEY, setRuntimeTargetMode } from '@/config/runtime-target';

const {
  runtimeStatuses,
  getStatusMock,
  startMock,
  stopMock,
  onSignalMock,
  signalServiceOptions,
  signalHandlerOptions,
  appendEventDataMock,
  notifyEventLogChangedMock,
  notifyTaskDataChangedMock,
  notifyProposalDataChangedMock,
  notifyReminderDataChangedMock,
  notifyTimeBlockDataChangedMock,
  emitProposalLifecycleMock,
  projectActiveBlockSnapshotMock,
  projectReminderReplicationUpsertMock,
  projectTaskReplicationUpsertMock,
  projectTimeBlockCompletedReplicationMock,
  MockSignalStreamService,
} = vi.hoisted(() => {
  const queuedStatuses: RuntimeStatus[] = [];
  const queuedSignalServiceOptions: Array<Record<string, unknown>> = [];
  const queuedSignalHandlerOptions: Array<Record<string, unknown>> = [];
  const queuedGetStatusMock = vi.fn<() => Promise<RuntimeStatus>>(async () => {
    if (queuedStatuses.length === 0) {
      throw new Error('runtime status queue exhausted（运行时状态队列已耗尽）');
    }
    const next = queuedStatuses.shift();
    if (!next) {
      throw new Error('runtime status queue returned empty value（运行时状态队列返回空值）');
    }
    return next;
  });

  const queuedStartMock = vi.fn();
  const queuedStopMock = vi.fn();
  const queuedOnSignalMock = vi.fn(() => () => {});
  const queuedAppendEventDataMock = vi.fn(async () => undefined);
  const queuedNotifyEventLogChangedMock = vi.fn();
  const queuedNotifyTaskDataChangedMock = vi.fn();
  const queuedNotifyProposalDataChangedMock = vi.fn();
  const queuedNotifyReminderDataChangedMock = vi.fn();
  const queuedNotifyTimeBlockDataChangedMock = vi.fn();
  const queuedEmitProposalLifecycleMock = vi.fn();
  const queuedProjectActiveBlockSnapshotMock = vi.fn(async () => undefined);
  const queuedProjectReminderReplicationUpsertMock = vi.fn(async () => 'inserted');
  const queuedProjectTaskReplicationUpsertMock = vi.fn(async () => 'inserted');
  const queuedProjectTimeBlockCompletedReplicationMock = vi.fn(async () => 'inserted');

  class HoistedMockSignalStreamService {
    constructor(options: Record<string, unknown>) {
      queuedSignalServiceOptions.push(options);
    }

    onSignal = queuedOnSignalMock;
    start = queuedStartMock;
    stop = queuedStopMock;
  }

  return {
    runtimeStatuses: queuedStatuses,
    getStatusMock: queuedGetStatusMock,
    startMock: queuedStartMock,
    stopMock: queuedStopMock,
    onSignalMock: queuedOnSignalMock,
    signalServiceOptions: queuedSignalServiceOptions,
    signalHandlerOptions: queuedSignalHandlerOptions,
    appendEventDataMock: queuedAppendEventDataMock,
    notifyEventLogChangedMock: queuedNotifyEventLogChangedMock,
    notifyTaskDataChangedMock: queuedNotifyTaskDataChangedMock,
    notifyProposalDataChangedMock: queuedNotifyProposalDataChangedMock,
    notifyReminderDataChangedMock: queuedNotifyReminderDataChangedMock,
    notifyTimeBlockDataChangedMock: queuedNotifyTimeBlockDataChangedMock,
    emitProposalLifecycleMock: queuedEmitProposalLifecycleMock,
    projectActiveBlockSnapshotMock: queuedProjectActiveBlockSnapshotMock,
    projectReminderReplicationUpsertMock: queuedProjectReminderReplicationUpsertMock,
    projectTaskReplicationUpsertMock: queuedProjectTaskReplicationUpsertMock,
    projectTimeBlockCompletedReplicationMock: queuedProjectTimeBlockCompletedReplicationMock,
    MockSignalStreamService: HoistedMockSignalStreamService,
  };
});

import { useSignalStream } from '@/ui/hooks/useSignalStream';

type RuntimeStatus = {
  running: boolean;
  host: string;
  port: number;
  hostId?: string;
  authSecret?: string;
  error?: string;
};

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: vi.fn(async () => true),
  invoke: vi.fn(),
}));

vi.mock('@/lib/services/signal-stream.service', () => ({
  SignalStreamService: MockSignalStreamService,
}));

vi.mock('@/lib/services/signal-handlers', () => ({
  startSignalHandlers: vi.fn((options: Record<string, unknown>) => {
    signalHandlerOptions.push(options);
    return async () => {};
  }),
}));

vi.mock('@/lib/services/eventlog.service', () => ({
  getEventLogService: () => ({
    appendEventData: appendEventDataMock,
  }),
  notifyEventLogChanged: notifyEventLogChangedMock,
}));

vi.mock('@/lib/services/task.service', () => ({
  notifyTaskDataChanged: notifyTaskDataChangedMock,
}));

vi.mock('@/lib/services/proposal-data-change.service', () => ({
  notifyProposalDataChanged: notifyProposalDataChangedMock,
}));

vi.mock('@/lib/services/proposal-lifecycle.service', () => ({
  emitProposalLifecycle: emitProposalLifecycleMock,
}));

vi.mock('@/lib/services/reminder.service', () => ({
  notifyReminderDataChanged: notifyReminderDataChangedMock,
}));

vi.mock('@/lib/services/timeblock.service', () => ({
  notifyTimeBlockDataChanged: notifyTimeBlockDataChangedMock,
}));

vi.mock('@/lib/services/ecs-eventlog-replication.service', () => ({
  appendEventWithEcsReplication: vi.fn(),
  projectEventLogReplicationAppend: vi.fn(async () => 'inserted'),
}));

vi.mock('@/lib/services/ecs-active-block-replication.service', () => ({
  projectActiveBlockReplicationSnapshot: projectActiveBlockSnapshotMock,
  getReplicatedActiveBlock: (payload: { block?: unknown; active?: unknown }) => payload.block ?? payload.active ?? null,
}));

vi.mock('@/lib/services/ecs-reminder-replication.service', () => ({
  projectReminderReplicationUpsert: projectReminderReplicationUpsertMock,
}));

vi.mock('@/lib/services/ecs-task-replication.service', () => ({
  projectTaskReplicationUpsert: projectTaskReplicationUpsertMock,
}));

vi.mock('@/lib/services/ecs-timeblock-completed-replication.service', () => ({
  projectTimeBlockCompletedReplication: projectTimeBlockCompletedReplicationMock,
}));

vi.mock('@/lib/services/runtime-control.service', () => ({
  getRuntimeControlService: () => ({
    getStatus: getStatusMock,
  }),
}));

vi.mock('@/lib/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  },
}));

function HookHarness(): null {
  useSignalStream();
  return null;
}

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('useSignalStream m4（SSE Runtime 目标切换）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
    runtimeStatuses.length = 0;
    signalServiceOptions.length = 0;
    signalHandlerOptions.length = 0;
    getStatusMock.mockClear();
    startMock.mockClear();
    stopMock.mockClear();
    onSignalMock.mockClear();
    appendEventDataMock.mockClear();
    notifyEventLogChangedMock.mockClear();
    notifyTaskDataChangedMock.mockClear();
    notifyProposalDataChangedMock.mockClear();
    notifyReminderDataChangedMock.mockClear();
    notifyTimeBlockDataChangedMock.mockClear();
    emitProposalLifecycleMock.mockClear();
    projectActiveBlockSnapshotMock.mockClear();
    projectReminderReplicationUpsertMock.mockClear();
    projectTaskReplicationUpsertMock.mockClear();
    projectTimeBlockCompletedReplicationMock.mockClear();
    setRuntimeTargetMode('embedded');
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('waits for embedded runtime to report running before opening SSE（等待内嵌 Runtime 真正运行后再打开 SSE）', async () => {
    window.localStorage.setItem(
      EMBEDDED_RUNTIME_STATUS_STORAGE_KEY,
      JSON.stringify({
        host: '127.0.0.1',
        port: 4077,
      }),
    );
    runtimeStatuses.push(
      {
        running: false,
        host: '127.0.0.1',
        port: 4077,
      },
      {
        running: true,
        host: '127.0.0.1',
        port: 48202,
        hostId: 'desktop-host',
        authSecret: 'embedded-secret',
      },
    );

    render(<HookHarness />);
    await flushMicrotasks();

    expect(getStatusMock).toHaveBeenCalledTimes(1);
    expect(signalServiceOptions).toHaveLength(0);
    expect(startMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    await flushMicrotasks();

    expect(getStatusMock).toHaveBeenCalledTimes(2);
    expect(signalServiceOptions).toHaveLength(1);

    expect(startMock).toHaveBeenCalledTimes(1);
    expect(signalServiceOptions[0]).toMatchObject({
      agentId: 'ui',
      host: expect.objectContaining({
        host: '127.0.0.1',
        port: 48202,
        isLocal: true,
      }),
    });
    expect((signalServiceOptions[0].host as { authToken?: string }).authToken).toBeUndefined();
    expect(window.localStorage.getItem(EMBEDDED_RUNTIME_STATUS_STORAGE_KEY)).toContain('"port":48202');
    expect(window.localStorage.getItem(EMBEDDED_RUNTIME_STATUS_STORAGE_KEY)).not.toContain('"authSecret"');
  });

  it('bridges eventlog.appended into EventLogService（把 eventlog.appended 桥接进 EventLogService）', async () => {
    runtimeStatuses.push({
      running: true,
      host: '127.0.0.1',
      port: 19574,
      hostId: 'desktop-host',
      authSecret: 'embedded-secret',
    });

    render(<HookHarness />);
    await flushMicrotasks();

    expect(signalHandlerOptions).toHaveLength(1);
    const onEventLogAppended = signalHandlerOptions[0].onEventLogAppended as
      | ((payload: { text: string; ts: number; inputMode?: string; captureSource?: string }) => Promise<void>)
      | undefined;

    expect(onEventLogAppended).toEqual(expect.any(Function));

    await onEventLogAppended?.({
      text: 'external-pipeline-manual-verify-1305',
      ts: 1773810305000,
      inputMode: 'external',
      captureSource: 'manual',
    });

    expect(appendEventDataMock).toHaveBeenCalledWith(expect.objectContaining({
      content: 'external-pipeline-manual-verify-1305',
      timestamp: 1773810305000,
      tags: ['note'],
      metadata: expect.objectContaining({
        source: expect.any(Object),
      }),
    }));
  });

  it('bridges global-shortcut voice eventlog.appended into EventLogService（全局语音快捷键事件会桥接进 EventLogService）', async () => {
    runtimeStatuses.push({
      running: true,
      host: '127.0.0.1',
      port: 19574,
      hostId: 'desktop-host',
      authSecret: 'embedded-secret',
    });

    render(<HookHarness />);
    await flushMicrotasks();

    const onEventLogAppended = signalHandlerOptions[0].onEventLogAppended as
      | ((payload: {
        text: string;
        ts: number;
        inputMode?: string;
        captureSource?: string;
        targetScope?: string;
        window?: { title?: string; processName?: string };
        agentContext?: { agentId?: string; agentName?: string; sessionId?: string };
      }) => Promise<void>)
      | undefined;

    await onEventLogAppended?.({
      text: 'voice shortcut appended',
      ts: 1773810310000,
      inputMode: 'voice',
      captureSource: 'global-shortcut',
      targetScope: 'agent-chat',
      window: {
        title: 'Cursor - ExoMind',
        processName: 'Cursor.exe',
      },
      agentContext: {
        agentId: 'codex',
        agentName: 'Codex',
        sessionId: 'session-1',
      },
    });

    expect(appendEventDataMock).toHaveBeenCalledWith(expect.objectContaining({
      content: 'voice shortcut appended',
      timestamp: 1773810310000,
      tags: ['voice'],
      metadata: expect.objectContaining({
        inputSource: 'voice',
        inputMethod: 'recognition',
        signal: expect.objectContaining({
          captureSource: 'global-shortcut',
          targetScope: 'agent-chat',
        }),
      }),
    }));
  });

  it('ignores non-shortcut voice eventlog.appended payloads to avoid draft duplication（忽略非快捷键 voice eventlog.appended，避免草稿输入被自动记日志）', async () => {
    runtimeStatuses.push({
      running: true,
      host: '127.0.0.1',
      port: 19574,
      hostId: 'desktop-host',
      authSecret: 'embedded-secret',
    });

    render(<HookHarness />);
    await flushMicrotasks();

    const onEventLogAppended = signalHandlerOptions[0].onEventLogAppended as
      | ((payload: { text: string; ts: number; inputMode?: string; captureSource?: string }) => Promise<void>)
      | undefined;

    await onEventLogAppended?.({
      text: 'voice draft candidate',
      ts: 1773810310000,
      inputMode: 'voice',
      captureSource: 'frontend:now-input-row',
    });

    expect(appendEventDataMock).not.toHaveBeenCalled();
  });

  it('deduplicates repeated active-block snapshots and only flushes the latest throttled payload（活跃时间块快照去重并只投影节流窗口中的最新值）', async () => {
    runtimeStatuses.push({
      running: true,
      host: '127.0.0.1',
      port: 19574,
      hostId: 'desktop-host',
      authSecret: 'embedded-secret',
    });

    render(<HookHarness />);
    await flushMicrotasks();

    const onActiveBlockReplicationSnapshot = signalHandlerOptions[0].onActiveBlockReplicationSnapshot as
      | ((payload: {
        schemaVersion: 1;
        block: {
          startId: string;
          startTime: number;
          name: string;
          mode: 'countup';
          elapsed: number;
          paused: boolean;
          phase: 'running';
          version: number;
          lastTransitionAt: number;
          taskIds: string[];
          taskAssociationLog: unknown[];
        };
        cursor: {
          kind: 'active_block_snapshot';
          startId: string;
          version: number;
          lastTransitionAt: number;
          actorId?: string;
        };
      }) => Promise<void>)
      | undefined;

    const payloadV1 = {
      schemaVersion: 1 as const,
      block: {
        startId: 'block-1',
        startTime: 1773810310000,
        name: '专注中',
        mode: 'countup' as const,
        elapsed: 10,
        paused: false,
        phase: 'running' as const,
        version: 1,
        lastTransitionAt: 1773810310000,
        taskIds: ['task-a'],
        taskAssociationLog: [],
      },
      cursor: {
        kind: 'active_block_snapshot' as const,
        startId: 'block-1',
        version: 1,
        lastTransitionAt: 1773810310000,
        actorId: 'rt-a',
      },
    };
    const payloadV2 = {
      ...payloadV1,
      block: {
        ...payloadV1.block,
        version: 2,
        lastTransitionAt: 1773810311000,
      },
      cursor: {
        ...payloadV1.cursor,
        version: 2,
        lastTransitionAt: 1773810311000,
      },
    };

    await onActiveBlockReplicationSnapshot?.(payloadV1);
    expect(projectActiveBlockSnapshotMock).toHaveBeenCalledTimes(1);
    expect(projectActiveBlockSnapshotMock).toHaveBeenLastCalledWith(payloadV1);

    await onActiveBlockReplicationSnapshot?.(payloadV1);
    expect(projectActiveBlockSnapshotMock).toHaveBeenCalledTimes(1);

    await onActiveBlockReplicationSnapshot?.(payloadV2);
    await onActiveBlockReplicationSnapshot?.(payloadV2);
    expect(projectActiveBlockSnapshotMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(projectActiveBlockSnapshotMock).toHaveBeenCalledTimes(2);
    expect(projectActiveBlockSnapshotMock).toHaveBeenLastCalledWith(payloadV2);
  });

  it('projects runtime active-upserted payloads through the same throttled path（运行时 active_upserted 走同一条节流投影链）', async () => {
    runtimeStatuses.push({
      running: true,
      host: '127.0.0.1',
      port: 19574,
      hostId: 'desktop-host',
      authSecret: 'embedded-secret',
    });

    render(<HookHarness />);
    await flushMicrotasks();

    const onActiveBlockReplicationSnapshot = signalHandlerOptions[0].onActiveBlockReplicationSnapshot as
      | ((payload: {
        schemaVersion: 1;
        scopeKey?: string;
        active?: {
          startId: string;
          startTime: number;
          name: string;
          mode: 'countup';
          elapsed: number;
          paused: boolean;
          phase: 'running';
          version?: number;
          lastTransitionAt?: number;
          updatedAt?: number;
          actorId?: string;
          taskIds?: string[];
          taskAssociationLog?: unknown[];
        };
        cursor: {
          kind: 'timeblock_active';
          startId: string;
          updatedAt: number;
          originHostId?: string;
        };
      }) => Promise<void>)
      | undefined;

    const payload = {
      schemaVersion: 1 as const,
      scopeKey: 'profile-local',
      active: {
        startId: 'runtime-block-1',
        startTime: 1773810410000,
        name: '运行时专注中',
        mode: 'countup' as const,
        elapsed: 42,
        paused: false,
        phase: 'running' as const,
        version: 7,
        lastTransitionAt: 1773810414000,
        updatedAt: 1773810414000,
        actorId: 'rt-a',
        taskIds: ['task-a'],
        taskAssociationLog: [],
      },
      cursor: {
        kind: 'timeblock_active' as const,
        startId: 'runtime-block-1',
        updatedAt: 1773810414000,
        originHostId: 'rt-a',
      },
    };

    await onActiveBlockReplicationSnapshot?.(payload);

    expect(projectActiveBlockSnapshotMock).toHaveBeenCalledTimes(1);
    expect(projectActiveBlockSnapshotMock).toHaveBeenLastCalledWith(payload);
  });

  it('notifies task and event listeners from RT lifecycle signals（RT 生命周期信号触发前端热更新）', async () => {
    runtimeStatuses.push({
      running: true,
      host: '127.0.0.1',
      port: 19574,
      hostId: 'desktop-host',
      authSecret: 'embedded-secret',
    });

    render(<HookHarness />);
    await flushMicrotasks();

    await signalHandlerOptions[0].onTaskCreated?.({
      id: 'task-created-1',
      title: 'created task',
      status: 'pending',
    });
    await signalHandlerOptions[0].onTaskUpdated?.({
      id: 'task-updated-1',
      title: 'updated task',
      status: 'pending',
    });
    await signalHandlerOptions[0].onTaskTransitioned?.({
      task: {
        id: 'task-transitioned-1',
        title: 'transitioned task',
        status: 'in_progress',
      },
      old_status: 'pending',
      new_status: 'in_progress',
    });
    await signalHandlerOptions[0].onTaskCancelled?.({
      id: 'task-cancelled-1',
      title: 'cancelled task',
      status: 'cancelled',
    });
    await signalHandlerOptions[0].onEventLogReplicationAppended?.({
      schemaVersion: 1,
      replicationSeq: 11,
      cursor: {
        kind: 'replication_seq',
        value: 11,
      },
      event: {
        id: 'evt-rep-11',
        content: 'replicated event',
        createdAt: '2026-03-26T00:00:00.000Z',
        type: 'note',
        replicationSeq: 11,
      },
    });

    expect(notifyTaskDataChangedMock).toHaveBeenCalledTimes(4);
    expect(notifyEventLogChangedMock).toHaveBeenCalledTimes(3);
  });

  it('projects remote task replication payload and then notifies task listeners（远端任务复制快照投影后触发列表刷新）', async () => {
    runtimeStatuses.push({
      running: true,
      host: '127.0.0.1',
      port: 19574,
      hostId: 'local-host',
      authSecret: 'embedded-secret',
    });

    render(<HookHarness />);
    await flushMicrotasks();

    await signalHandlerOptions[0].onTaskReplicationUpserted?.({
      schemaVersion: 1,
      scopeKey: 'profile-local',
      cursor: {
        kind: 'task_snapshot',
        taskId: 'task-rep-1',
        updatedAt: 1_700_000_001_000,
        originHostId: 'desktop-host',
      },
      task: {
        id: 'task-rep-1',
        title: 'Replicated task',
        status: 'pending',
        priority: 'medium',
        dependsOn: [],
        tags: [],
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_001_000,
        timeBlockIds: [],
      },
    });

    expect(projectTaskReplicationUpsertMock).toHaveBeenCalledTimes(1);
    expect(notifyTaskDataChangedMock).toHaveBeenCalledTimes(1);
  });

  it('bridges proposal replication into proposal data refresh notifications（proposal replication 直接触发请求箱数据刷新）', async () => {
    runtimeStatuses.push({
      running: true,
      host: '127.0.0.1',
      port: 19574,
      hostId: 'desktop-host',
      authSecret: 'embedded-secret',
    });

    render(<HookHarness />);
    await flushMicrotasks();

    await signalHandlerOptions[0].onProposalReplicationUpserted?.({
      schemaVersion: 1,
      scopeKey: 'profile-local',
      cursor: {
        kind: 'proposal_snapshot',
        proposalId: 'proposal-rep-1',
        updatedAt: '2026-04-19T10:00:00.000Z',
        originHostId: 'desktop-host',
      },
      proposal: {
        id: 'proposal-rep-1',
        title: 'Replicated proposal',
        body: 'from peer',
        actionType: 'append_event',
        actionParams: { content: 'from peer' },
        references: [],
        status: 'pending',
        publisher: {
          publisherType: 'agent',
          id: 'agent-a',
          name: 'Agent A',
        },
        comments: [],
        createdAt: '2026-04-19T09:00:00.000Z',
        updatedAt: '2026-04-19T10:00:00.000Z',
      },
    });

    expect(notifyProposalDataChangedMock).toHaveBeenCalledTimes(1);
  });

  it('bridges proposal lifecycle topics into the proposal lifecycle event bus（proposal lifecycle topic 派发给提醒层）', async () => {
    runtimeStatuses.push({
      running: true,
      host: '127.0.0.1',
      port: 19574,
      hostId: 'desktop-host',
      authSecret: 'embedded-secret',
    });

    render(<HookHarness />);
    await flushMicrotasks();

    await signalHandlerOptions[0].onProposalCreated?.({
      schemaVersion: 1,
      scopeKey: 'profile-local',
      cursor: {
        kind: 'proposal_created',
        proposalId: 'proposal-created-1',
        updatedAt: '2026-04-19T10:00:00.000Z',
        originHostId: 'desktop-host',
      },
      proposal: {
        id: 'proposal-created-1',
        title: 'Created proposal',
        body: 'needs review',
        action_type: 'create_task',
        action_params: { title: 'Created task' },
        references: [],
        status: 'pending',
        publisher: {
          publisher_type: 'agent',
          id: 'agent-a',
          name: 'Agent A',
        },
        comments: [],
        created_at: '2026-04-19T09:00:00.000Z',
        updated_at: '2026-04-19T10:00:00.000Z',
      },
    });
    await signalHandlerOptions[0].onProposalStatusChanged?.({
      schemaVersion: 1,
      scopeKey: 'profile-local',
      cursor: {
        kind: 'proposal_status_changed',
        proposalId: 'proposal-created-1',
        updatedAt: '2026-04-19T10:02:00.000Z',
        originHostId: 'desktop-host',
      },
      proposal: {
        id: 'proposal-created-1',
        title: 'Created proposal',
        body: 'needs review',
        action_type: 'create_task',
        action_params: { title: 'Created task' },
        references: [],
        status: 'approved',
        publisher: {
          publisher_type: 'agent',
          id: 'agent-a',
          name: 'Agent A',
        },
        comments: [],
        created_at: '2026-04-19T09:00:00.000Z',
        updated_at: '2026-04-19T10:02:00.000Z',
      },
      transition: {
        fromStatus: 'pending',
        toStatus: 'approved',
      },
    });
    await signalHandlerOptions[0].onProposalExecutionFailed?.({
      schemaVersion: 1,
      scopeKey: 'profile-local',
      cursor: {
        kind: 'proposal_execution_failed',
        proposalId: 'proposal-created-1',
        updatedAt: '2026-04-19T10:03:00.000Z',
        originHostId: 'desktop-host',
      },
      proposal: {
        id: 'proposal-created-1',
        title: 'Created proposal',
        body: 'needs review',
        action_type: 'create_task',
        action_params: { title: 'Created task' },
        references: [],
        status: 'approved',
        publisher: {
          publisher_type: 'agent',
          id: 'agent-a',
          name: 'Agent A',
        },
        comments: [{
          author: {
            publisher_type: 'agent',
            id: 'runtime-executor',
            name: 'Runtime Executor',
          },
          content: '批准后执行失败：not implemented',
          created_at: '2026-04-19T10:03:00.000Z',
        }],
        created_at: '2026-04-19T09:00:00.000Z',
        updated_at: '2026-04-19T10:03:00.000Z',
      },
      execution: {
        failureMessage: 'not implemented',
      },
    });

    expect(emitProposalLifecycleMock).toHaveBeenCalledTimes(3);
    expect(emitProposalLifecycleMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
      topic: 'proposal.created',
      payload: expect.objectContaining({
        proposal: expect.objectContaining({
          actionType: 'create_task',
          createdAt: '2026-04-19T09:00:00.000Z',
        }),
      }),
    }));
    expect(emitProposalLifecycleMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
      topic: 'proposal.status_changed',
      payload: expect.objectContaining({
        proposal: expect.objectContaining({
          actionType: 'create_task',
          status: 'approved',
        }),
      }),
    }));
    expect(emitProposalLifecycleMock).toHaveBeenNthCalledWith(3, expect.objectContaining({
      topic: 'proposal.execution_failed',
      payload: expect.objectContaining({
        proposal: expect.objectContaining({
          comments: [expect.objectContaining({
            createdAt: '2026-04-19T10:03:00.000Z',
          })],
        }),
      }),
    }));
  });

  it('notifies task listeners when remote replication was already applied by runtime actor（远端任务已被运行时先落地时也要刷新 UI）', async () => {
    runtimeStatuses.push({
      running: true,
      host: '127.0.0.1',
      port: 19574,
      hostId: 'local-host',
      authSecret: 'embedded-secret',
    });
    projectTaskReplicationUpsertMock.mockResolvedValueOnce('ignored');

    render(<HookHarness />);
    await flushMicrotasks();

    await signalHandlerOptions[0].onTaskReplicationUpserted?.({
      schemaVersion: 1,
      scopeKey: 'profile-local',
      cursor: {
        kind: 'task_snapshot',
        taskId: 'task-rep-ignored',
        updatedAt: 1_700_000_002_000,
        originHostId: 'peer-host',
      },
      task: {
        id: 'task-rep-ignored',
        title: 'Replicated task already applied',
        status: 'pending',
        priority: 'medium',
        dependsOn: [],
        tags: [],
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_002_000,
        timeBlockIds: [],
      },
    });

    expect(projectTaskReplicationUpsertMock).toHaveBeenCalledTimes(1);
    expect(notifyTaskDataChangedMock).toHaveBeenCalledTimes(1);
  });

  it('skips same-host task replication echo to avoid duplicate local refresh（同源任务复制回声不应重复投影与刷新）', async () => {
    runtimeStatuses.push({
      running: true,
      host: '127.0.0.1',
      port: 19574,
      hostId: 'desktop-host',
      authSecret: 'embedded-secret',
    });

    render(<HookHarness />);
    await flushMicrotasks();

    await signalHandlerOptions[0].onTaskReplicationUpserted?.({
      schemaVersion: 1,
      scopeKey: 'profile-local',
      cursor: {
        kind: 'task_snapshot',
        taskId: 'task-local-echo',
        updatedAt: 1_700_000_003_000,
        originHostId: 'desktop-host',
      },
      task: {
        id: 'task-local-echo',
        title: 'Local echo task',
        status: 'pending',
        priority: 'medium',
        dependsOn: [],
        tags: [],
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_003_000,
        timeBlockIds: [],
      },
    });

    expect(projectTaskReplicationUpsertMock).not.toHaveBeenCalled();
    expect(notifyTaskDataChangedMock).not.toHaveBeenCalled();
  });

  it('projects reminder replication payload and then notifies reminder listeners（提醒复制快照投影后再触发提醒刷新）', async () => {
    runtimeStatuses.push({
      running: true,
      host: '127.0.0.1',
      port: 19574,
      hostId: 'desktop-host',
      authSecret: 'embedded-secret',
    });

    render(<HookHarness />);
    await flushMicrotasks();

    await signalHandlerOptions[0].onReminderReplicationUpserted?.({
      schemaVersion: 1,
      scopeKey: 'profile-local',
      cursor: {
        kind: 'reminder_snapshot',
        reminderId: 'reminder-rep-1',
        updatedAt: 1_700_000_001_000,
        originHostId: 'desktop-host',
      },
      reminder: {
        id: 'reminder-rep-1',
        title: 'Replicated reminder',
        content: 'from peer',
        dueAt: 1_700_000_100_000,
        status: 'pending',
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_001_000,
      },
    });

    expect(projectReminderReplicationUpsertMock).toHaveBeenCalledTimes(1);
    expect(notifyReminderDataChangedMock).toHaveBeenCalledTimes(1);
  });

  it('projects completed timeblock replication payload and then notifies timeblock listeners（已完成时间块复制快照投影后再触发时间块刷新）', async () => {
    runtimeStatuses.push({
      running: true,
      host: '127.0.0.1',
      port: 19574,
      hostId: 'desktop-host',
      authSecret: 'embedded-secret',
    });

    render(<HookHarness />);
    await flushMicrotasks();

    await signalHandlerOptions[0].onTimeBlockCompletedReplication?.({
      schemaVersion: 1,
      scopeKey: 'profile-local',
      cursor: {
        kind: 'timeblock_completed',
        blockId: 'tb-rep-1',
        completedAt: 1_700_000_060_000,
        originHostId: 'desktop-host',
      },
      block: {
        id: 'tb-rep-1',
        name: 'Replicated block',
        startId: 'tb-rep-1',
        endId: 'end-rep-1',
        note: 'done',
        tags: ['block_feedback'],
        startTime: 1_700_000_000_000,
        endTime: 1_700_000_060_000,
        blockType: 'active',
        taskIds: [],
        taskAssociationLog: [],
        transitions: [],
      },
    });

    expect(projectTimeBlockCompletedReplicationMock).toHaveBeenCalledTimes(1);
    expect(notifyTimeBlockDataChangedMock).toHaveBeenCalledTimes(1);
  });
});
