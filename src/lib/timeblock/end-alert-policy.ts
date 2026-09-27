import { resolveCountdownTiming } from '@/lib/timeblock/countdown-progress';
import { resolveTimeBlockPhase, type ActiveBlockData } from '@/lib/types/event';

export interface TimeblockEndAlertRequest {
  startId: string;
  title: string;
  dueAt: number;
  soundEnabled: boolean;
  autoOpenFocus: boolean;
}

export interface ResolveTimeblockEndAlertRequestInput {
  block: ActiveBlockData | null;
  frontendOwnsCountdownEnd: boolean;
  soundEnabled: boolean;
  autoOpenFocus: boolean;
  now?: number;
}

export function resolveTimeblockEndAlertRequest(
  input: ResolveTimeblockEndAlertRequestInput,
): TimeblockEndAlertRequest | null {
  const {
    block,
    frontendOwnsCountdownEnd,
    soundEnabled,
    autoOpenFocus,
    now = Date.now(),
  } = input;

  if (!block || frontendOwnsCountdownEnd || block.blockType === 'gap' || block.mode !== 'countdown') {
    return null;
  }

  if (resolveTimeBlockPhase(block) !== 'running') {
    return null;
  }

  const timing = resolveCountdownTiming(block, now);
  if (!timing || timing.isFeedbackStage) {
    return null;
  }

  return {
    startId: block.startId,
    title: block.name.trim() || '未命名时间块',
    dueAt: timing.remainingMs <= 0
      ? timing.effectiveNow - timing.overrunMs
      : timing.effectiveNow + timing.remainingMs,
    soundEnabled,
    autoOpenFocus,
  };
}
