import { describe, expect, it } from 'vitest';
import type { TaskNode } from '@/lib/types/task';
import type { TimeBlock } from '@/lib/types/event';
import { buildTaskTimeblockDetailViewModel } from '@/ui/app/pages/task-timeblock-detail-view';

function makeTask(overrides: Partial<TaskNode> & { id: string; title: string }): TaskNode {
  return {
    id: overrides.id,
    title: overrides.title,
    description: undefined,
    status: 'completed',
    priority: 'high',
    dependsOn: [],
    tags: [],
    estimatedMinutes: 120,
    timeBlockIds: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeBlock(overrides: Partial<TimeBlock> & { id: string; name: string; startTime: number; endTime: number }): TimeBlock {
  return {
    id: overrides.id,
    name: overrides.name,
    startId: overrides.startId ?? overrides.id,
    endId: overrides.endId ?? `${overrides.id}-end`,
    note: overrides.note,
    tags: overrides.tags ?? new Set(['block_feedback']),
    startTime: overrides.startTime,
    endTime: overrides.endTime,
  };
}

describe('buildTaskTimeblockDetailViewModel（时间块详情视图模型）', () => {
  const start = new Date('2026-03-06T09:00:00+08:00').getTime();
  const end = new Date('2026-03-06T10:30:00+08:00').getTime();

  it('builds summary metrics and schedule badge（构建概要指标与进度徽章）', () => {
    const task = makeTask({
      id: 'task-1',
      title: '深度工作：EventLog 模块实现',
      estimatedMinutes: 120,
      timeBlockIds: ['block-1'],
    });
    const block = makeBlock({
      id: 'block-1',
      name: '深度工作：EventLog 模块实现',
      startTime: start,
      endTime: end,
    });

    const model = buildTaskTimeblockDetailViewModel({
      task,
      blocks: [block],
      reviewMarkdown: '',
      useMockData: true,
    });

    expect(model.summary.blockName).toBe('深度工作：EventLog 模块实现');
    expect(model.summary.badges.map((badge) => badge.label)).toEqual(['已完成', '提前30分钟']);
    expect(model.summary.metrics.find((item) => item.key === 'duration')?.value).toBe('1h 30m');
    expect(model.summary.metrics.find((item) => item.key === 'expected')?.value).toBe('2h');
  });

  it('builds timeline including blocker and AI event（构建含阻塞与 AI 反馈的时间线）', () => {
    const task = makeTask({
      id: 'task-2',
      title: '实现任务详情页',
      estimatedMinutes: 90,
      timeBlockIds: ['block-2'],
    });
    const block = makeBlock({
      id: 'block-2',
      name: '实现任务详情页',
      note: '中途遇到依赖冲突，修复后继续推进',
      startTime: start,
      endTime: end,
    });

    const model = buildTaskTimeblockDetailViewModel({
      task,
      blocks: [block],
      reviewMarkdown: '## AI 反馈：实现任务详情页\n\n**做得好的** 主流程推进清晰\n\n**卡住的地方** 依赖版本冲突\n\n**建议** 先锁定版本再开发',
      useMockData: true,
    });

    expect(model.timeline.items).toHaveLength(7);
    expect(model.timeline.items.some((item) => item.title.includes('依赖冲突'))).toBe(true);
    expect(model.timeline.items[model.timeline.items.length - 1].title).toBe('AI 反馈');
  });

  it('derives plan-vs-actual and ai summary sections（派生计划/实际与 AI 总结）', () => {
    const task = makeTask({
      id: 'task-3',
      title: '重构时间块详情页',
      estimatedMinutes: 60,
      timeBlockIds: ['block-3'],
    });
    const block = makeBlock({
      id: 'block-3',
      name: '重构时间块详情页',
      note: '比预期多花时间在兼容旧测试',
      startTime: start,
      endTime: end,
    });

    const model = buildTaskTimeblockDetailViewModel({
      task,
      blocks: [block],
      reviewMarkdown: '## AI 反馈：重构时间块详情页\n\n**做得好的** 保持主流程可用\n\n**卡住的地方** 测试兼容成本偏高\n\n**建议** 先抽离 ViewModel 再改 UI',
      useMockData: true,
    });

    expect(model.planActual.diffReason).toContain('超出');
    expect(model.aiSummary.keyOutput).toContain('保持主流程可用');
    expect(model.aiSummary.blocker).toContain('测试兼容成本偏高');
    expect(model.aiSummary.suggestion).toContain('先抽离 ViewModel');
  });

  it('uses preferred block id when provided（提供 blockId 时优先打开对应历史时间块）', () => {
    const task = makeTask({
      id: 'task-4',
      title: '历史时间块定位',
      estimatedMinutes: 60,
      timeBlockIds: ['block-a', 'block-b'],
    });
    const blockA = makeBlock({
      id: 'block-a',
      name: '上午块',
      startTime: start,
      endTime: start + 30 * 60_000,
    });
    const blockB = makeBlock({
      id: 'block-b',
      name: '下午块',
      startTime: start + 4 * 60 * 60_000,
      endTime: start + 5 * 60 * 60_000,
    });

    const model = buildTaskTimeblockDetailViewModel({
      task,
      blocks: [blockA, blockB],
      preferredBlockId: 'block-a',
      reviewMarkdown: '',
      useMockData: true,
    });

    expect(model.summary.blockName).toBe('上午块');
    expect(model.summary.metrics.find((item) => item.key === 'duration')?.value).toBe('30m');
  });

  it('uses real eventlog timeline when mock mode is off（关闭测试数据时使用真实事件时间线）', () => {
    const task = makeTask({
      id: 'task-5',
      title: '真实事件线',
      estimatedMinutes: 90,
      timeBlockIds: ['block-real'],
    });
    const block = makeBlock({
      id: 'block-real',
      name: '真实时间块',
      startTime: start,
      endTime: end,
    });

    const model = buildTaskTimeblockDetailViewModel({
      task,
      blocks: [block],
      useMockData: false,
      eventLogs: [
        {
          id: 'ev-1',
          createdAt: new Date(start + 5 * 60_000).toISOString(),
          content: '开始真实时间块',
          type: 'block_start',
        },
        {
          id: 'ev-2',
          createdAt: new Date(start + 40 * 60_000).toISOString(),
          content: '处理中途阻塞',
          type: 'note',
        },
        {
          id: 'ev-3',
          createdAt: new Date(end - 2 * 60_000).toISOString(),
          content: '结束真实时间块',
          type: 'block_end',
        },
      ],
    });

    expect(model.timeline.items.map((item) => item.title)).toEqual(['开始时间块', '事件记录', '结束时间块']);
    expect(model.timeline.items[1].description).toContain('处理中途阻塞');
  });

  it('linkedBlocks contains all blocks matched by task.timeBlockIds（linkedBlocks 包含任务关联的所有已完成时间块）', () => {
    const task = makeTask({
      id: 'task-linked',
      title: '关联时间块展示',
      estimatedMinutes: 60,
      timeBlockIds: ['block-a', 'block-b'],
    });
    const blockA = makeBlock({
      id: 'block-a',
      name: '上午块',
      startTime: start,
      endTime: start + 30 * 60_000,
    });
    const blockB = makeBlock({
      id: 'block-b',
      name: '下午块',
      startTime: start + 4 * 60 * 60_000,
      endTime: start + 5 * 60 * 60_000,
    });
    const unrelated = makeBlock({
      id: 'block-other',
      name: '无关块',
      startTime: start,
      endTime: end,
    });

    const model = buildTaskTimeblockDetailViewModel({
      task,
      blocks: [blockA, blockB, unrelated],
      reviewMarkdown: '',
      useMockData: true,
    });

    expect(model.linkedBlocks).toHaveLength(2);
    expect(model.linkedBlocks.map((b) => b.name)).toEqual(['下午块', '上午块']);
    expect(model.linkedBlocks.every((b) => !b.isActive)).toBe(true);
    expect(model.linkedBlocks[0].durationLabel).toBe('1h');
    expect(model.linkedBlocks[1].durationLabel).toBe('30m');
  });

  it('linkedBlocks includes active block when present（进行中的活跃时间块出现在 linkedBlocks 列表开头）', () => {
    const task = makeTask({
      id: 'task-active',
      title: '活跃块测试',
      status: 'in_progress',
      estimatedMinutes: 60,
      timeBlockIds: ['block-done'],
    });
    const doneBlock = makeBlock({
      id: 'block-done',
      name: '已完成块',
      startTime: start,
      endTime: start + 45 * 60_000,
    });

    const now = new Date(start + 2 * 60 * 60_000);
    const model = buildTaskTimeblockDetailViewModel({
      task,
      blocks: [doneBlock],
      activeBlock: {
        startId: 'block-active',
        name: '当前块',
        startTime: start + 60 * 60_000,
        taskId: 'task-active',
        mode: 'countup',
        phase: 'focus',
        paused: false,
        elapsed: 0,
      },
      reviewMarkdown: '',
      useMockData: true,
      now,
    });

    expect(model.linkedBlocks).toHaveLength(2);
    expect(model.linkedBlocks[0].isActive).toBe(true);
    expect(model.linkedBlocks[0].name).toBe('当前块');
    expect(model.linkedBlocks[0].endLabel).toBe('进行中');
    expect(model.linkedBlocks[1].isActive).toBe(false);
    expect(model.linkedBlocks[1].name).toBe('已完成块');
  });

  it('linkedBlocks is empty when task has no timeBlockIds（无关联时间块 ID 时返回空列表）', () => {
    const task = makeTask({
      id: 'task-empty',
      title: '空时间块任务',
      estimatedMinutes: 60,
      timeBlockIds: [],
    });

    const model = buildTaskTimeblockDetailViewModel({
      task,
      blocks: [],
      reviewMarkdown: '',
      useMockData: true,
    });

    expect(model.linkedBlocks).toHaveLength(0);
  });
});
