/**
 * useSignalStream - 前端 SSE 信号流 hook
 *
 * 连接 Rust RT 的 SSE 端点，将信号事件路由到前端处理器。
 * 当前处理 review.completed → EventStorage（agent_feedback 标签）。
 *
 * 在 App.tsx 中调用一次即可，整个应用生命周期内保持 SSE 连接。
 */

import { useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { SignalStreamService } from '@/lib/services/signal-stream.service';
import { toProposal } from '@/lib/adapters/proposal-rt-payload';
import {
  startSignalHandlers,
  type EventLogAppendedPayload,
  type EventLogReplicationAppendedPayload,
  type KeyboardStatePayload,
  type ReviewCompletedPayload,
} from '@/lib/services/signal-handlers';
import { applyKeyboardStateFromSignal } from '@/config/hardware-keyboard';
import { getEventSourceMetadata } from '@/lib/eventlog/source-metadata';
import { createUuidV4 } from '@/lib/utils/uuid';
import {
  appendEventWithEcsReplication,
  projectEventLogReplicationAppend,
} from '@/lib/services/ecs-eventlog-replication.service';
import {
  getReplicatedActiveBlock,
  projectActiveBlockReplicationSnapshot as projectActiveBlockSnapshot,
  type ActiveBlockReplicationSnapshotPayload,
} from '@/lib/services/ecs-active-block-replication.service';
import { projectTaskReplicationUpsert } from '@/lib/services/ecs-task-replication.service';
import { projectReminderReplicationUpsert } from '@/lib/services/ecs-reminder-replication.service';
import { projectTimeBlockCompletedReplication } from '@/lib/services/ecs-timeblock-completed-replication.service';
import {
  getSelectedRuntimeTarget,
  readEmbeddedRuntimeStatus,
  rememberEmbeddedRuntimeStatus,
  subscribeRuntimeTargetChanges,
  type RuntimeTarget,
} from '@/config/runtime-target';
import { getRuntimeControlService } from '@/lib/services/runtime-control.service';
import { getEventLogService, notifyEventLogChanged } from '@/lib/services/eventlog.service';
import { notifyReminderDataChanged } from '@/lib/services/reminder.service';
import { notifyTaskDataChanged } from '@/lib/services/task.service';
import { notifyTimeBlockDataChanged } from '@/lib/services/timeblock.service';
import { notifyProposalDataChanged } from '@/lib/services/proposal-data-change.service';
import { emitProposalLifecycle } from '@/lib/services/proposal-lifecycle.service';
import { log } from '@/lib/logger';

const EMBEDDED_RUNTIME_STATUS_RETRY_MS = 1_000;

function buildActiveBlockSnapshotSignature(payload: ActiveBlockReplicationSnapshotPayload): string {
  const block = getReplicatedActiveBlock(payload);
  if (!block) {
    return [
      payload.cursor.startId,
      payload.cursor.version ?? '',
      payload.cursor.lastTransitionAt ?? payload.cursor.updatedAt ?? '',
      payload.cursor.actorId ?? payload.cursor.originHostId ?? '',
      'missing-block',
    ].join('|');
  }

  return [
    payload.cursor.startId,
    payload.cursor.version ?? block.version ?? '',
    payload.cursor.lastTransitionAt ?? payload.cursor.updatedAt ?? block.lastTransitionAt ?? block.updatedAt ?? block.startTime,
    payload.cursor.actorId ?? payload.cursor.originHostId ?? block.actorId ?? '',
    block.phase ?? '',
    block.paused ? '1' : '0',
  ].join('|');
}

function formatReviewAsMarkdown(payload: ReviewCompletedPayload): string {
  const isTimeblock = payload.review_type === 'timeblock';
  const title = isTimeblock
    ? `AI 反馈：${payload.block_name ?? '时间块'}`
    : 'AI 日终复盘';

  const lines = [`## ${title}`, ''];

  if (payload.effective) {
    lines.push(`**做得好的** ${payload.effective}`, '');
  }
  if (payload.stuck) {
    lines.push(`**卡住的地方** ${payload.stuck}`, '');
  }
  if (payload.suggestion) {
    lines.push(`**建议** ${payload.suggestion}`, '');
  }
  if (payload.improve) {
    lines.push(`**改进建议** ${payload.improve}`, '');
  }
  if (payload.avoid) {
    lines.push(`**应该避免** ${payload.avoid}`, '');
  }

  return lines.join('\n').trimEnd();
}

function buildSignalEventLogId(payload: EventLogAppendedPayload): string {
  const fingerprint = [
    payload.ts,
    payload.captureSource ?? '',
    payload.inputMode ?? '',
    payload.text,
  ].join('|');

  let hash = 0;
  for (let index = 0; index < fingerprint.length; index += 1) {
    hash = ((hash * 31) + fingerprint.charCodeAt(index)) >>> 0;
  }

  return `signal-eventlog-${payload.ts}-${hash.toString(16)}`;
}

export function useSignalStream(): void {
  const serviceRef = useRef<SignalStreamService | null>(null);
  const [runtimeTarget, setRuntimeTarget] = useState<RuntimeTarget>(() => getSelectedRuntimeTarget());
  const [runtimeTargetHydrated, setRuntimeTargetHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let loggedHydrationError = false;

    const hydrateEmbeddedRuntimeStatus = async () => {
      if (!(await isTauri()) || runtimeTarget.mode !== 'embedded') {
        if (!cancelled) {
          setRuntimeTargetHydrated(true);
        }
        return;
      }

      try {
        if (!cancelled) {
          setRuntimeTargetHydrated(false);
        }

        while (!cancelled) {
          try {
            const status = await getRuntimeControlService().getStatus();
            if (status.running) {
              rememberEmbeddedRuntimeStatus({
                host: status.host,
                port: status.port,
                hostId: status.hostId,
              });
              if (!cancelled) {
                setRuntimeTargetHydrated(true);
              }
              return;
            }
          } catch (error) {
            if (!loggedHydrationError) {
              log.warn(`[SignalStream] failed to hydrate embedded runtime status: ${error instanceof Error ? error.message : String(error)}`);
              loggedHydrationError = true;
            }
          }

          await new Promise((resolve) => window.setTimeout(resolve, EMBEDDED_RUNTIME_STATUS_RETRY_MS));
        }
      } finally {
        if (!cancelled && runtimeTarget.mode !== 'embedded') {
          setRuntimeTargetHydrated(true);
        }
      }
    };

    void hydrateEmbeddedRuntimeStatus();

    return () => {
      cancelled = true;
    };
  }, [runtimeTarget.mode]);

  useEffect(() => {
    const unsubscribe = subscribeRuntimeTargetChanges((nextTarget) => {
      setRuntimeTarget((currentTarget) => {
        if (
          currentTarget.mode === nextTarget.mode
          && currentTarget.host === nextTarget.host
          && currentTarget.port === nextTarget.port
        ) {
          return currentTarget;
        }
        return nextTarget;
      });
    });

    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!runtimeTargetHydrated) {
      return;
    }

    const currentRuntimeHostId = runtimeTarget.mode === 'embedded'
      ? readEmbeddedRuntimeStatus()?.hostId ?? null
      : null;
    const targetLabel = `${runtimeTarget.mode}:${runtimeTarget.host}:${runtimeTarget.port}`;
    const service = new SignalStreamService({
      host: {
        id: `rt-target-${targetLabel}`.replace(/[^\w-]/g, '-'),
        name: runtimeTarget.mode === 'embedded' ? 'Embedded RT' : 'External RT',
        host: runtimeTarget.host,
        port: runtimeTarget.port,
        authToken: runtimeTarget.authToken,
        status: 'unknown',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isLocal: runtimeTarget.mode === 'embedded',
      },
      agentId: 'ui',
    });

    // Throttle state for onActiveBlockReplicationSnapshot — lives in effect scope
    // so cleanup can clear the timer. See #554, #944.
    let activeBlockThrottleTimer: ReturnType<typeof setTimeout> | null = null;
    let activeBlockLastProcessedAt = 0;
    let activeBlockLastSignature: string | null = null;
    let activeBlockPendingPayload: ActiveBlockReplicationSnapshotPayload | null = null;
    let activeBlockPendingSignature: string | null = null;

    const handler = startSignalHandlers({
      onTaskCreated: async () => {
        notifyTaskDataChanged();
      },
      onTaskUpdated: async () => {
        notifyTaskDataChanged();
      },
      onTaskTransitioned: async () => {
        notifyTaskDataChanged();
        notifyEventLogChanged();
      },
      onTaskCancelled: async () => {
        notifyTaskDataChanged();
        notifyEventLogChanged();
      },
      onTaskReplicationUpserted: async (payload) => {
        const isSameRuntimeOrigin = Boolean(
          currentRuntimeHostId
          && payload.cursor.originHostId
          && payload.cursor.originHostId === currentRuntimeHostId,
        );
        if (isSameRuntimeOrigin) {
          return;
        }

        const result = await projectTaskReplicationUpsert(payload);
        if (result !== 'ignored' || !currentRuntimeHostId || payload.cursor.originHostId !== currentRuntimeHostId) {
          notifyTaskDataChanged();
        }
      },
      onReminderReplicationUpserted: async (payload) => {
        const result = await projectReminderReplicationUpsert(payload);
        if (result !== 'ignored') {
          notifyReminderDataChanged();
        }
      },
      onProposalReplicationUpserted: async () => {
        notifyProposalDataChanged();
      },
      onProposalCreated: async (payload) => {
        emitProposalLifecycle({
          topic: 'proposal.created',
          payload: {
            ...payload,
            proposal: toProposal(payload.proposal),
          },
        });
      },
      onProposalStatusChanged: async (payload) => {
        emitProposalLifecycle({
          topic: 'proposal.status_changed',
          payload: {
            ...payload,
            proposal: toProposal(payload.proposal),
          },
        });
      },
      onProposalExecutionFailed: async (payload) => {
        emitProposalLifecycle({
          topic: 'proposal.execution_failed',
          payload: {
            ...payload,
            proposal: toProposal(payload.proposal),
          },
        });
      },
      onEventLogAppended: async (payload: EventLogAppendedPayload) => {
        const isExternalInput = payload.inputMode === 'external';
        const isGlobalShortcutVoice =
          payload.inputMode === 'voice'
          && payload.captureSource === 'global-shortcut';

        if (!isExternalInput && !isGlobalShortcutVoice) {
          return;
        }

        const content = payload.text.trim();
        if (!content) {
          return;
        }

        await getEventLogService().appendEvent({
          id: buildSignalEventLogId({
            ...payload,
            text: content,
            ts: Number.isFinite(payload.ts) && payload.ts > 0 ? payload.ts : Date.now(),
          }),
          content,
          tags: [isGlobalShortcutVoice ? 'voice' : 'note'],
          metadata: {
            source: getEventSourceMetadata(),
            ...(isGlobalShortcutVoice ? {
              inputSource: 'voice',
              inputMethod: 'recognition',
            } : {}),
            signal: {
              topic: 'eventlog.appended',
              inputMode: payload.inputMode ?? null,
              captureSource: payload.captureSource ?? null,
              targetScope: payload.targetScope ?? null,
              window: payload.window ?? null,
              agentContext: payload.agentContext ?? null,
            },
          },
        });
        log.info('[SignalStream] eventlog.appended → EventLogService');
      },
      onEventLogReplicationAppended: async (payload: EventLogReplicationAppendedPayload) => {
        const result = await projectEventLogReplicationAppend(payload);
        if (result === 'inserted') {
          notifyEventLogChanged();
          log.info('[SignalStream] eventlog.replication.appended → EventStorage');
        }
      },
      // Throttle: RT may dispatch active block replication at high frequency,
      // causing UI state overwrites. Cap at 1s. See #554, #944.
      // State variables declared before startSignalHandlers for cleanup access.
      onActiveBlockReplicationSnapshot: async (payload: ActiveBlockReplicationSnapshotPayload) => {
        const signature = buildActiveBlockSnapshotSignature(payload);
        if (signature === activeBlockLastSignature || signature === activeBlockPendingSignature) {
          return;
        }

        const now = Date.now();
        const elapsed = now - activeBlockLastProcessedAt;

        if (elapsed >= 1000) {
          activeBlockLastProcessedAt = now;
          activeBlockLastSignature = signature;
          await projectActiveBlockSnapshot(payload);
          return;
        }

        activeBlockPendingPayload = payload;
        activeBlockPendingSignature = signature;
        if (!activeBlockThrottleTimer) {
          activeBlockThrottleTimer = setTimeout(async () => {
            activeBlockThrottleTimer = null;
            if (activeBlockPendingPayload) {
              activeBlockLastProcessedAt = Date.now();
              const p = activeBlockPendingPayload;
              const queuedSignature = activeBlockPendingSignature;
              activeBlockPendingPayload = null;
              activeBlockPendingSignature = null;
              activeBlockLastSignature = queuedSignature;
              await projectActiveBlockSnapshot(p);
            }
          }, 1000 - elapsed);
        }
      },
      onTimeBlockCompletedReplication: async (payload) => {
        const result = await projectTimeBlockCompletedReplication(payload);
        if (result !== 'ignored') {
          notifyTimeBlockDataChanged();
        }
      },
      onReviewCompleted: async (payload) => {
        const content = formatReviewAsMarkdown(payload);
        await appendEventWithEcsReplication({
          id: createUuidV4(),
          content,
          createdAt: new Date().toISOString(),
          type: 'agent_feedback',
          metadata: {
            source: getEventSourceMetadata(),
          },
        });
        log.info('[SignalStream] review.completed → EventStorage (agent_feedback)');
      },
      onKeyboardStateChanged: async (payload: KeyboardStatePayload) => {
        applyKeyboardStateFromSignal(payload as unknown as Record<string, unknown>);
        log.info(`[SignalStream] device.keyboard.state → hasKeyboard=${payload.hasHardwareKeyboard} type=${payload.keyboardType}`);
      },
    });

    const unsubscribe = service.onSignal((event) => {
      handler(event).catch((err) => {
        log.error(`[SignalStream] handler error: ${err instanceof Error ? err.message : String(err)}`);
      });
    });

    service.start();
    serviceRef.current = service;
    log.info(`[SignalStream] SSE connection started (${targetLabel})`);

    return () => {
      if (activeBlockThrottleTimer) {
        clearTimeout(activeBlockThrottleTimer);
        activeBlockThrottleTimer = null;
      }
      unsubscribe();
      service.stop();
      serviceRef.current = null;
      log.info(`[SignalStream] SSE connection stopped (${targetLabel})`);
    };
  }, [runtimeTarget, runtimeTargetHydrated]);
}
