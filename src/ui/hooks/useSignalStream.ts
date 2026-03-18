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
import {
  startSignalHandlers,
  type EventLogAppendedPayload,
  type EventLogReplicationAppendedPayload,
  type ReviewCompletedPayload,
} from '@/lib/services/signal-handlers';
import { getEventSourceMetadata } from '@/lib/eventlog/source-metadata';
import { createUuidV4 } from '@/lib/utils/uuid';
import {
  appendEventWithEcsReplication,
  projectEventLogReplicationAppend,
} from '@/lib/services/ecs-eventlog-replication.service';
import type { ActiveBlockReplicationSnapshotPayload } from '@/lib/services/ecs-active-block-replication.service';
import { projectActiveBlockReplicationSnapshot as projectActiveBlockSnapshot } from '@/lib/services/ecs-active-block-replication.service';
import {
  getSelectedRuntimeTarget,
  persistEmbeddedRuntimeStatus,
  subscribeRuntimeTargetChanges,
  type RuntimeTarget,
} from '@/config/runtime-target';
import { getRuntimeControlService } from '@/lib/services/runtime-control.service';
import { getEventLogService } from '@/lib/services/eventlog.service';
import { log } from '@/lib/logger';

const EMBEDDED_RUNTIME_STATUS_RETRY_MS = 1_000;

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
              persistEmbeddedRuntimeStatus({
                host: status.host,
                port: status.port,
                hostId: status.hostId,
                authSecret: status.authSecret,
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

    const handler = startSignalHandlers({
      onEventLogAppended: async (payload: EventLogAppendedPayload) => {
        if (payload.inputMode !== 'external') {
          return;
        }

        const content = payload.text.trim();
        if (!content) {
          return;
        }

        const timestamp = Number.isFinite(payload.ts) && payload.ts > 0
          ? payload.ts
          : Date.now();

        await getEventLogService().appendEventData({
          id: buildSignalEventLogId({
            ...payload,
            text: content,
            ts: timestamp,
          }),
          timestamp,
          content,
          tags: ['note'],
          metadata: {
            source: getEventSourceMetadata(),
            signal: {
              topic: 'eventlog.appended',
              inputMode: payload.inputMode ?? null,
              captureSource: payload.captureSource ?? null,
            },
          },
        });
        log.info('[SignalStream] eventlog.appended → EventLogService');
      },
      onEventLogReplicationAppended: async (payload: EventLogReplicationAppendedPayload) => {
        const result = await projectEventLogReplicationAppend(payload);
        if (result === 'inserted') {
          log.info('[SignalStream] eventlog.replication.appended → EventStorage');
        }
      },
      onActiveBlockReplicationSnapshot: async (payload: ActiveBlockReplicationSnapshotPayload) => {
        await projectActiveBlockSnapshot(payload);
        log.info('[SignalStream] active_block.replication.snapshot → ActiveBlockStorage');
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
    });

    service.onSignal((event) => {
      handler(event).catch((err) => {
        log.error(`[SignalStream] handler error: ${err instanceof Error ? err.message : String(err)}`);
      });
    });

    service.start();
    serviceRef.current = service;
    log.info(`[SignalStream] SSE connection started (${targetLabel})`);

    return () => {
      service.stop();
      serviceRef.current = null;
      log.info(`[SignalStream] SSE connection stopped (${targetLabel})`);
    };
  }, [runtimeTarget, runtimeTargetHydrated]);
}
