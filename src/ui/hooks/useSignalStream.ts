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
              });
              if (!cancelled) {
                setRuntimeTargetHydrated(true);
              }
              return;
            }
          } catch (error) {
            if (!loggedHydrationError) {
              console.warn('[SignalStream] failed to hydrate embedded runtime status:', error);
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
        status: 'unknown',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isLocal: runtimeTarget.mode === 'embedded',
      },
      agentId: 'ui',
    });

    const handler = startSignalHandlers({
      onEventLogReplicationAppended: async (payload: EventLogReplicationAppendedPayload) => {
        const result = await projectEventLogReplicationAppend(payload);
        if (result === 'inserted') {
          console.log('[SignalStream] eventlog.replication.appended → EventStorage');
        }
      },
      onActiveBlockReplicationSnapshot: async (payload: ActiveBlockReplicationSnapshotPayload) => {
        await projectActiveBlockSnapshot(payload);
        console.log('[SignalStream] active_block.replication.snapshot → ActiveBlockStorage');
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
        console.log('[SignalStream] review.completed → EventStorage (agent_feedback)');
      },
    });

    service.onSignal((event) => {
      handler(event).catch((err) => {
        console.error('[SignalStream] handler error:', err);
      });
    });

    service.start();
    serviceRef.current = service;
    console.log(`[SignalStream] SSE connection started (${targetLabel})`);

    return () => {
      service.stop();
      serviceRef.current = null;
      console.log(`[SignalStream] SSE connection stopped (${targetLabel})`);
    };
  }, [runtimeTarget, runtimeTargetHydrated]);
}
