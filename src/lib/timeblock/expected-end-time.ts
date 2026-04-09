import type { TimeBlockData } from '@/lib/types/event';
import { derivePhaseFromBlock } from '@/lib/timeblock/derive';
import { resolveCountdownTiming } from '@/lib/timeblock/countdown-progress';

export interface CountdownEndTimeDisplay {
  kind: 'expected' | 'actual';
  timestamp: number;
  timeText: string;
  text: string;
  paused: boolean;
}

interface ResolveCountdownEndTimeDisplayInput {
  block?: TimeBlockData | null;
  mode?: 'countup' | 'countdown';
  remainingMs?: number;
  overtimeMs?: number;
  paused?: boolean;
  isActionEnded?: boolean;
  now?: number;
  locale?: string;
  timeZone?: string;
}

function formatMinuteClock(timestamp: number, locale: string, timeZone?: string): string {
  return new Date(timestamp).toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  });
}

export function resolveCountdownEndTimeDisplay(
  input: ResolveCountdownEndTimeDisplayInput,
): CountdownEndTimeDisplay | null {
  const now = input.now ?? Date.now();
  const locale = input.locale ?? 'zh-CN';

  let paused = Boolean(input.paused);
  let kind: CountdownEndTimeDisplay['kind'];
  let timestamp: number;

  if (input.block) {
    const timing = resolveCountdownTiming(input.block, now);
    if (!timing) {
      return null;
    }

    paused = derivePhaseFromBlock(input.block) === 'paused';
    if (timing.overrunMs > 0) {
      kind = 'actual';
      timestamp = timing.effectiveNow - timing.overrunMs;
    } else {
      if (timing.isFeedbackStage) {
        return null;
      }

      kind = 'expected';
      timestamp = now + timing.remainingMs;
    }
  } else {
    if (input.mode !== 'countdown') {
      return null;
    }

    const overtimeMs = Math.max(0, input.overtimeMs ?? 0);
    if (overtimeMs > 0) {
      kind = 'actual';
      timestamp = now - overtimeMs;
    } else {
      if (input.isActionEnded) {
        return null;
      }

      kind = 'expected';
      timestamp = now + Math.max(0, input.remainingMs ?? 0);
    }
  }

  const timeText = formatMinuteClock(timestamp, locale, input.timeZone);
  const text = kind === 'actual'
    ? `已于 ${timeText} 到点`
    : paused
      ? `暂停中，若恢复预计 ${timeText} 结束`
      : `预计 ${timeText} 结束`;

  return {
    kind,
    timestamp,
    timeText,
    text,
    paused,
  };
}
