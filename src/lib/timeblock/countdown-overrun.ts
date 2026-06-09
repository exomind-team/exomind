import type { TimeBlockData } from '@/lib/types/event';
import { resolveCountdownTiming } from '@/lib/timeblock/countdown-progress';

export function resolveCountdownOverrunMs(block: TimeBlockData, now: number = Date.now()): number {
  const timing = resolveCountdownTiming(block, now);
  if (!timing) {
    return 0;
  }

  return timing.overrunMs;
}
