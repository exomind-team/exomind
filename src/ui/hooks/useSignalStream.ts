/**
 * useSignalStream - 前端 SSE 信号流 hook
 *
 * 连接 Rust RT 的 SSE 端点，将信号事件路由到前端处理器。
 * 当前处理 review.completed → EventStorage（agent_feedback 标签）。
 *
 * 在 App.tsx 中调用一次即可，整个应用生命周期内保持 SSE 连接。
 */

import { useEffect, useRef } from 'react';
import { SignalStreamService } from '@/lib/services/signal-stream.service';
import {
  startSignalHandlers,
  type ReviewCompletedPayload,
} from '@/lib/services/signal-handlers';
import { getEventStorage } from '@/lib/storage/event-storage';

const RT_HOST = 'localhost';
const RT_PORT = 1949;

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

  useEffect(() => {
    const service = new SignalStreamService({
      host: {
        id: 'default-rt',
        name: 'Local RT',
        host: RT_HOST,
        port: RT_PORT,
        status: 'unknown',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isLocal: true,
      },
      agentId: 'ui',
    });

    const handler = startSignalHandlers({
      onReviewCompleted: async (payload) => {
        const content = formatReviewAsMarkdown(payload);
        const storage = getEventStorage();
        await storage.addEvent({
          id: crypto.randomUUID(),
          content,
          createdAt: new Date().toISOString(),
          type: 'agent_feedback',
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
    console.log('[SignalStream] SSE connection started');

    return () => {
      service.stop();
      serviceRef.current = null;
      console.log('[SignalStream] SSE connection stopped');
    };
  }, []);
}
