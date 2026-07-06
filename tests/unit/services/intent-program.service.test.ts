import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IntentProgramServiceImpl,
  createSeedIntentPrograms,
} from '@/lib/services/intent-program.service';
import type { EventLogService } from '@/lib/services/eventlog.service';
import type { Event } from '@/lib/types/event';
import type {
  IntentProgram,
  IntentProgramRunRecord,
} from '@/lib/types/intent-program';

class MemoryIntentProgramStorage {
  private programs: IntentProgram[] | null = null;

  async read(): Promise<IntentProgram[] | null> {
    return this.programs ? structuredClone(this.programs) : null;
  }

  async write(programs: IntentProgram[]): Promise<void> {
    this.programs = structuredClone(programs);
  }
}

function createEventLogMock(seedEvents: Event[] = []): EventLogService {
  const events = [...seedEvents];
  return {
    loadEvents: vi.fn(async () => structuredClone(events)),
    addEvent: vi.fn(async (content, tags) => {
      const event = {
        id: `event-${events.length + 1}`,
        timestamp: Date.parse('2026-07-07T00:00:00.000Z') + events.length,
        content,
        tags: tags ?? new Set(['note']),
      };
      events.unshift(event);
      return event;
    }),
    exportEventsAsJson: vi.fn(async () => '{}'),
    importEventsFromJson: vi.fn(async () => ({ imported: 0, skipped: 0, total: 0 })),
    onEvent: vi.fn(() => () => undefined),
  };
}

describe('intent program service（意图程序服务）', () => {
  let storage: MemoryIntentProgramStorage;
  let eventLog: EventLogService;
  let service: IntentProgramServiceImpl;

  beforeEach(() => {
    storage = new MemoryIntentProgramStorage();
    eventLog = createEventLogMock();
    service = new IntentProgramServiceImpl({
      storage,
      eventLog,
      now: () => '2026-07-07T08:00:00.000Z',
      idFactory: () => 'run-fixed',
    });
  });

  it('seeds Fable path-three experiment cards（内置 Fable 路径三实验卡组）', async () => {
    const programs = await service.listPrograms();

    expect(programs).toHaveLength(5);
    expect(programs.map((program) => program.id)).toEqual([
      'research-to-note',
      'discussion-to-tasks',
      'code-review-gate',
      'idea-to-outline',
      'learning-to-review-card',
    ]);
    expect(programs[2]?.humanGate.requiredWhen).toContain('代码修改准备进入主干');
    expect(programs[2]?.recertification.cadenceDays).toBe(30);
    expect(programs[2]?.truthPolicy).toContain('EventLog');
  });

  it('turns a delegated program into an awaiting human review run（试运行后进入人核验收）', async () => {
    const run = await service.runProgram('research-to-note');

    expect(run.program.state).toBe('awaiting_review');
    expect(run.record.state).toBe('awaiting_review');
    expect(run.record.verificationSnapshot).toContain('claim/method/source/verdict');
    expect(eventLog.addEvent).toHaveBeenCalledWith(
      expect.stringContaining('试运行意图程序'),
      expect.any(Set),
    );
  });

  it('blocks another run while a program is awaiting human review（待人核时阻断重复自动运行）', async () => {
    await service.runProgram('research-to-note');

    await expect(service.runProgram('research-to-note')).rejects.toThrow('不能自动运行');
  });

  it('records human override as a first-class sovereignty event（人工覆写是一等主权事件）', async () => {
    const run = await service.runProgram('research-to-note');

    const result = await service.overrideRun(
      'research-to-note',
      run.record.id,
      '验收预算超载，先降级为人工审查。',
    );

    expect(result.state).toBe('overridden');
    expect(result.runs.at(0)?.decisionNote).toContain('验收预算超载');
    expect(eventLog.addEvent).toHaveBeenLastCalledWith(
      expect.stringContaining('人工覆写意图程序'),
      expect.any(Set),
    );
  });

  it('rejects stale run decisions after authority has been paused（暂停后旧执行记录不能复活运行权）', async () => {
    const run = await service.runProgram('research-to-note');
    await service.pauseProgram('research-to-note', '人核暂停，等待重新著作。');

    await expect(service.acceptRun('research-to-note', run.record.id, '旧验收补点通过')).rejects.toThrow('不再等待人核验收');
    const program = await service.getProgram('research-to-note');

    expect(program?.state).toBe('paused');
  });

  it('rejects duplicate decisions on the same run（同一执行记录不能重复裁决）', async () => {
    const run = await service.runProgram('research-to-note');
    await service.acceptRun('research-to-note', run.record.id, '已经验收。');

    await expect(service.overrideRun('research-to-note', run.record.id, '事后覆写')).rejects.toThrow('不再等待人核验收');
  });

  it('downgrades automation when recertification fails（再认证失败时降级自动化）', async () => {
    const result = await service.recertifyProgram('research-to-note', {
      verdict: 'fail',
      note: '我已经解释不清来源要求。',
    });

    expect(result.state).toBe('needs_reauthoring');
    expect(result.recertification.lastVerdict).toBe('fail');
    expect(result.recertification.lastNote).toContain('解释不清');
    expect(eventLog.addEvent).toHaveBeenLastCalledWith(
      expect.stringContaining('再认证失败'),
      expect.any(Set),
    );
  });

  it('keeps or pauses delegation based on recertification verdict（再认证通过或部分通过会维持或暂停委托）', async () => {
    const passed = await service.recertifyProgram('research-to-note', {
      verdict: 'pass',
      note: '我仍能解释来源策略与验收标准。',
    });
    const partial = await service.recertifyProgram('idea-to-outline', {
      verdict: 'partial',
      note: '提纲可用，但发表边界需要重写。',
    });

    expect(passed.state).toBe('delegated');
    expect(passed.recertification.lastVerdict).toBe('pass');
    expect(partial.state).toBe('paused');
    expect(partial.recertification.lastVerdict).toBe('partial');
  });

  it('does not let recertification bypass a pending human review（再认证不能绕过待裁决执行记录）', async () => {
    await service.runProgram('research-to-note');

    await expect(service.recertifyProgram('research-to-note', {
      verdict: 'pass',
      note: '试图直接恢复委托。',
    })).rejects.toThrow('先裁决当前执行记录');

    const program = await service.getProgram('research-to-note');
    expect(program?.state).toBe('awaiting_review');
    expect(program?.runs.at(0)?.state).toBe('awaiting_review');
  });

  it('expires overdue delegated programs and blocks running them（到期委托会进入 expired 并阻断运行）', async () => {
    const overdue = createSeedIntentPrograms('2026-06-01T08:00:00.000Z').map((program) => (
      program.id === 'research-to-note'
        ? {
            ...program,
            state: 'delegated' as const,
            recertification: {
              ...program.recertification,
              nextReviewAt: '2026-07-01T08:00:00.000Z',
            },
          }
        : program
    ));
    await storage.write(overdue);

    const programs = await service.listPrograms();
    const expired = programs.find((program) => program.id === 'research-to-note');

    expect(expired?.state).toBe('expired');
    expect(eventLog.addEvent).toHaveBeenCalledWith(
      expect.stringContaining('委托到期'),
      expect.any(Set),
    );
    await expect(service.runProgram('research-to-note')).rejects.toThrow('不能自动运行');
  });

  it('blocks running a paused program until it is re-delegated（暂停委托会丧失自动运行权）', async () => {
    await service.pauseProgram('research-to-note', '先停下来重新核对边界。');

    await expect(service.runProgram('research-to-note')).rejects.toThrow('不能自动运行');
  });

  it('reads sovereignty events back from EventLog canonical source（从 EventLog 真相源回读主权事件）', async () => {
    eventLog = createEventLogMock([
      {
        id: 'event-ordinary',
        timestamp: 3,
        content: '普通日记事件',
        tags: new Set(['note']),
      },
      {
        id: 'event-override',
        timestamp: 2,
        content: '人工覆写意图程序：Agent 代码修改验收闸门',
        tags: new Set(['intent_program', 'intent_override']),
      },
      {
        id: 'event-run',
        timestamp: 1,
        content: '试运行意图程序：技术调研整理为 Markdown',
        tags: new Set(['intent_program', 'intent_run']),
      },
    ]);
    service = new IntentProgramServiceImpl({
      storage,
      eventLog,
      now: () => '2026-07-07T08:00:00.000Z',
      idFactory: () => 'run-fixed',
    });

    const events = await service.listSovereigntyEvents();

    expect(events.map((event) => event.id)).toEqual(['event-override', 'event-run']);
    expect(events[0]?.content).toContain('人工覆写意图程序');
    expect(events[0]?.tags).toContain('intent_override');
  });

  it('calculates sovereignty metrics from runnable fields（从字段计算三权指标）', () => {
    const programs = createSeedIntentPrograms('2026-07-07T08:00:00.000Z');
    const metrics = service.calculateMetrics(programs);

    expect(metrics.total).toBe(5);
    expect(metrics.awaitingHumanReview).toBe(1);
    expect(metrics.needsReauthoring).toBe(1);
    expect(metrics.averageSovereigntyScore).toBeGreaterThanOrEqual(85);
  });

  it('keeps newest run first after accept（接受后最新执行记录排在最前）', async () => {
    const run = await service.runProgram('research-to-note');
    const accepted = await service.acceptRun('research-to-note', run.record.id, '我已核对随机样例。');

    const newestRun = accepted.runs.at(0) as IntentProgramRunRecord;
    expect(accepted.state).toBe('accepted');
    expect(newestRun.state).toBe('accepted');
    expect(newestRun.decisionNote).toContain('随机样例');
  });
});
