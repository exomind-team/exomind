import { describe, expect, it } from 'vitest';
import type { TaskNode } from '@/lib/types/task';
import { filterMonth, filterNow, filterToday, filterWeek } from '@/ui/app/pages/task-tab-filters';

function makeTask(overrides: Partial<TaskNode> & { id: string }): TaskNode {
  return {
    title: overrides.id,
    description: undefined,
    status: 'not_started',
    priority: 'medium',
    dependsOn: [],
    tags: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('#410 task tab ordering contract', () => {
  const now = new Date(2026, 2, 5, 12, 0, 0);
  const todayStart = new Date(2026, 2, 5, 0, 0, 0).getTime();
  const weekNowMs = now.getTime();
  const monthStart = new Date(2026, 2, 1).getTime();

  it('filterNow hides completed tasks', () => {
    const inProgress = makeTask({ id: 'inProgress', status: 'in_progress', updatedAt: 100 });
    const suspended = makeTask({ id: 'suspended', status: 'suspended', updatedAt: 90 });
    const completed = makeTask({ id: 'completed', status: 'completed', updatedAt: 110 });

    const result = filterNow([completed, inProgress, suspended]);

    expect(result.map((task) => task.id)).toEqual(['inProgress', 'suspended']);
  });

  it('filterToday keeps completed tasks when they match day scope', () => {
    const completedToday = makeTask({
      id: 'completedToday',
      status: 'completed',
      dueAt: todayStart + 10_000,
      updatedAt: todayStart + 20_000,
    });

    const result = filterToday([completedToday], now);

    expect(result.map((task) => task.id)).toEqual(['completedToday']);
  });

  it('filterWeek/filterMonth keep completed tasks when they match scope', () => {
    const completedInWeek = makeTask({
      id: 'completedInWeek',
      status: 'completed',
      dueAt: weekNowMs + 3 * 86_400_000,
      updatedAt: weekNowMs + 100,
    });
    const completedInMonth = makeTask({
      id: 'completedInMonth',
      status: 'completed',
      dueAt: monthStart + 10 * 86_400_000,
      updatedAt: monthStart + 200,
    });

    expect(filterWeek([completedInWeek], now).map((task) => task.id)).toEqual(['completedInWeek']);
    expect(filterMonth([completedInMonth], now).map((task) => task.id)).toEqual(['completedInMonth']);
  });

  it('date views sort by status priority and updatedAt desc within each group', () => {
    const inProgressOld = makeTask({ id: 'inProgressOld', status: 'in_progress', updatedAt: todayStart + 1_000 });
    const inProgressNew = makeTask({ id: 'inProgressNew', status: 'in_progress', updatedAt: todayStart + 9_000 });
    const notStartedOld = makeTask({ id: 'notStartedOld', status: 'not_started', dueAt: todayStart + 12_000, updatedAt: todayStart + 2_000 });
    const notStartedNew = makeTask({ id: 'notStartedNew', status: 'not_started', dueAt: todayStart + 13_000, updatedAt: todayStart + 8_000 });
    const suspended = makeTask({ id: 'suspended', status: 'suspended', dueAt: todayStart + 20_000, updatedAt: todayStart + 7_000 });
    const completed = makeTask({ id: 'completed', status: 'completed', dueAt: todayStart + 25_000, updatedAt: todayStart + 6_000 });

    const result = filterToday(
      [completed, suspended, notStartedOld, inProgressOld, notStartedNew, inProgressNew],
      now,
    );

    expect(result.map((task) => task.id)).toEqual([
      'inProgressNew',
      'inProgressOld',
      'notStartedNew',
      'notStartedOld',
      'suspended',
      'completed',
    ]);
  });

  it('abandoned tasks are still excluded in all tabs', () => {
    const abandonedToday = makeTask({
      id: 'abandonedToday',
      status: 'abandoned',
      dueAt: todayStart + 30_000,
      updatedAt: todayStart + 30_000,
    });

    expect(filterNow([abandonedToday])).toEqual([]);
    expect(filterToday([abandonedToday], now)).toEqual([]);
    expect(filterWeek([abandonedToday], now)).toEqual([]);
    expect(filterMonth([abandonedToday], now)).toEqual([]);
  });

  it('date views keep stable ordering when unexpected statuses appear', () => {
    const completed = makeTask({
      id: 'completed',
      status: 'completed',
      dueAt: todayStart + 10_000,
      updatedAt: todayStart + 10_000,
    });
    const unknownAlpha = makeTask({
      id: 'unknownAlpha',
      status: 'alpha_custom' as TaskNode['status'],
      dueAt: todayStart + 20_000,
      updatedAt: todayStart + 1_000,
    });
    const unknownZombie = makeTask({
      id: 'unknownZombie',
      status: 'zombie_custom' as TaskNode['status'],
      dueAt: todayStart + 30_000,
      updatedAt: todayStart + 9_000,
    });

    const result = filterToday([unknownZombie, completed, unknownAlpha], now);
    expect(result.map((task) => task.id)).toEqual(['completed', 'unknownAlpha', 'unknownZombie']);
  });

  it('week/month views keep stable ordering when unexpected statuses appear', () => {
    const completedInWeek = makeTask({
      id: 'completedInWeek',
      status: 'completed',
      dueAt: weekNowMs + 1 * 86_400_000,
      updatedAt: weekNowMs + 10_000,
    });
    const unknownAlphaWeek = makeTask({
      id: 'unknownAlphaWeek',
      status: 'alpha_custom' as TaskNode['status'],
      dueAt: weekNowMs + 2 * 86_400_000,
      updatedAt: weekNowMs + 1_000,
    });
    const unknownZombieWeek = makeTask({
      id: 'unknownZombieWeek',
      status: 'zombie_custom' as TaskNode['status'],
      dueAt: weekNowMs + 3 * 86_400_000,
      updatedAt: weekNowMs + 9_000,
    });

    const weekResult = filterWeek([unknownZombieWeek, completedInWeek, unknownAlphaWeek], now);
    expect(weekResult.map((task) => task.id)).toEqual([
      'completedInWeek',
      'unknownAlphaWeek',
      'unknownZombieWeek',
    ]);

    const completedInMonth = makeTask({
      id: 'completedInMonth',
      status: 'completed',
      dueAt: monthStart + 5 * 86_400_000,
      updatedAt: monthStart + 10_000,
    });
    const unknownAlphaMonth = makeTask({
      id: 'unknownAlphaMonth',
      status: 'alpha_custom' as TaskNode['status'],
      dueAt: monthStart + 10 * 86_400_000,
      updatedAt: monthStart + 1_000,
    });
    const unknownZombieMonth = makeTask({
      id: 'unknownZombieMonth',
      status: 'zombie_custom' as TaskNode['status'],
      dueAt: monthStart + 15 * 86_400_000,
      updatedAt: monthStart + 9_000,
    });

    const monthResult = filterMonth([unknownZombieMonth, completedInMonth, unknownAlphaMonth], now);
    expect(monthResult.map((task) => task.id)).toEqual([
      'completedInMonth',
      'unknownAlphaMonth',
      'unknownZombieMonth',
    ]);
  });

  it('unknown statuses use code-unit ordering to avoid locale-dependent drift', () => {
    const completed = makeTask({
      id: 'completed',
      status: 'completed',
      dueAt: todayStart + 10_000,
      updatedAt: todayStart + 10_000,
    });
    const unknownZ = makeTask({
      id: 'unknownZ',
      status: 'z_custom' as TaskNode['status'],
      dueAt: todayStart + 20_000,
      updatedAt: todayStart + 1_000,
    });
    const unknownUmlaut = makeTask({
      id: 'unknownUmlaut',
      status: '\u00E4_custom' as TaskNode['status'],
      dueAt: todayStart + 30_000,
      updatedAt: todayStart + 9_000,
    });

    const result = filterToday([unknownUmlaut, completed, unknownZ], now);
    expect(result.map((task) => task.id)).toEqual(['completed', 'unknownZ', 'unknownUmlaut']);
  });
});
