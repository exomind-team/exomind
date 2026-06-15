import { describe, it, expect } from 'vitest';
import { resolveHandoffAction } from './handoff-policy';
import type { ActiveBlockData } from '@/lib/types/event';

function makeRunningBlock(startId: string): ActiveBlockData {
  return {
    startId,
    name: 'TB1',
    mode: 'countdown',
    targetMinutes: 25,
    blockType: 'active',
    startTime: 1_000_000,
    elapsed: 0,
    paused: false,
    phase: 'running',
    transitions: [{ type: 'start', at: 1_000_000 }],
  };
}

function makePausedBlock(startId: string): ActiveBlockData {
  return {
    ...makeRunningBlock(startId),
    paused: true,
    pausedAt: 1_100_000,
    phase: 'paused',
    transitions: [
      { type: 'start', at: 1_000_000 },
      { type: 'pause', at: 1_100_000 },
    ],
  };
}

function makeFeedbackBlock(startId: string): ActiveBlockData {
  return {
    ...makeRunningBlock(startId),
    phase: 'feedback_in_progress',
    actionEndedAt: 1_200_000,
    feedbackStartedAt: 1_200_000,
    transitions: [
      { type: 'start', at: 1_000_000 },
      { type: 'feedback_start', at: 1_200_000 },
    ],
  };
}

describe('resolveHandoffAction — soft 模式回归测试', () => {
  // ─────────────────────────────────────────────────────────────────
  // RED: 这是 bug 的核心 — soft 模式下 handoff 绝不能 markEnding
  // 旧实现：consumePendingHandoff 无条件调用 markEnding
  // 新实现：soft 模式必须返回 navigateOnly
  // ─────────────────────────────────────────────────────────────────

  it('soft 模式 + running block + handoff → navigateOnly（不应 markEnding）', () => {
    const decision = resolveHandoffAction({
      pendingStartId: 'tb-1',
      currentBlock: makeRunningBlock('tb-1'),
      countdownEndMode: 'soft',
    });
    expect(decision.kind).toBe('navigateOnly');
    expect(decision.reason).toBe('soft_mode_skip');
  });

  it('soft 模式 + paused block + handoff → navigateOnly（不应 markEnding）', () => {
    const decision = resolveHandoffAction({
      pendingStartId: 'tb-1',
      currentBlock: makePausedBlock('tb-1'),
      countdownEndMode: 'soft',
    });
    expect(decision.kind).toBe('navigateOnly');
    expect(decision.reason).toBe('soft_mode_skip');
  });

  // ─────────────────────────────────────────────────────────────────
  // GREEN: hard 模式保留原有行为
  // ─────────────────────────────────────────────────────────────────

  it('hard 模式 + running block + handoff → markEnding', () => {
    const decision = resolveHandoffAction({
      pendingStartId: 'tb-1',
      currentBlock: makeRunningBlock('tb-1'),
      countdownEndMode: 'hard',
    });
    expect(decision.kind).toBe('markEnding');
    expect(decision.reason).toBe('hard_mode_mark_ending');
  });

  it('hard 模式 + paused block + handoff → markEnding', () => {
    const decision = resolveHandoffAction({
      pendingStartId: 'tb-1',
      currentBlock: makePausedBlock('tb-1'),
      countdownEndMode: 'hard',
    });
    expect(decision.kind).toBe('markEnding');
  });

  // ─────────────────────────────────────────────────────────────────
  // 前置条件守卫 — 即使 hard 模式也必须满足
  // ─────────────────────────────────────────────────────────────────

  it('无 pendingStartId → navigateOnly（不依赖 mode）', () => {
    const decision = resolveHandoffAction({
      pendingStartId: '',
      currentBlock: makeRunningBlock('tb-1'),
      countdownEndMode: 'hard',
    });
    expect(decision.kind).toBe('navigateOnly');
    expect(decision.reason).toBe('no_pending_start_id');
  });

  it('pendingStartId 与当前块不匹配 → navigateOnly', () => {
    const decision = resolveHandoffAction({
      pendingStartId: 'tb-old',
      currentBlock: makeRunningBlock('tb-new'),
      countdownEndMode: 'hard',
    });
    expect(decision.kind).toBe('navigateOnly');
    expect(decision.reason).toBe('block_mismatch');
  });

  it('当前块无活动（已结束/feedback）→ navigateOnly', () => {
    const decision = resolveHandoffAction({
      pendingStartId: 'tb-1',
      currentBlock: makeFeedbackBlock('tb-1'),
      countdownEndMode: 'hard',
    });
    expect(decision.kind).toBe('navigateOnly');
    expect(decision.reason).toBe('phase_not_active');
  });

  it('无当前块 → navigateOnly', () => {
    const decision = resolveHandoffAction({
      pendingStartId: 'tb-1',
      currentBlock: null,
      countdownEndMode: 'hard',
    });
    expect(decision.kind).toBe('navigateOnly');
    expect(decision.reason).toBe('block_mismatch');
  });
});
