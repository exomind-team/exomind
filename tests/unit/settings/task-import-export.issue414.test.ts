import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventData } from '@/lib/types/event';
import type { TaskNode } from '@/lib/types/task';
import { ExoMindEnvironment } from '@/lib/environment/environment';
import { EventLogServiceImpl } from '@/lib/services/eventlog.service';
import { exportTasksForBackup, importTasksFromBackup } from '@/lib/services/task.service';
import { getCurrentUserId } from '@/lib/storage/event-storage';
import { clearAllTaskStorageInstances, getTaskStorage } from '@/lib/storage/task-storage';

type EventLogPortShape = {
  listEvents: () => Promise<EventData[]>;
  appendEvent: (event: EventData) => Promise<void>;
  getEvent: (id: string) => Promise<EventData | null>;
  clearEvents: () => Promise<void>;
};

function createMockPort(initialEvents: EventData[] = []): EventLogPortShape {
  let current = initialEvents;
  return {
    listEvents: vi.fn(async () => [...current]),
    appendEvent: vi.fn(async (event: EventData) => {
      current = [event, ...current];
    }),
    getEvent: vi.fn(async (id: string) => current.find((event) => event.id === id) ?? null),
    clearEvents: vi.fn(async () => {
      current = [];
    }),
  };
}

function createTask(id: string, overrides: Partial<TaskNode> = {}): TaskNode {
  const base = Number(id.replace(/\D/g, '')) || 1;
  const createdAt = 1_700_000_000_000 + base * 1_000;
  return {
    id,
    title: `task-${id}`,
    status: 'not_started',
    priority: 'medium',
    dependsOn: [],
    tags: [],
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

async function seedTasks(tasks: TaskNode[]): Promise<void> {
  const storage = getTaskStorage(getCurrentUserId());
  await storage.clearAll();
  for (const task of tasks) {
    await storage.addTask(task);
  }
}

describe('Issue #414 task backup import/export', () => {
  beforeEach(async () => {
    localStorage.setItem('exomind:useMockData', 'false');
    ExoMindEnvironment.resetForTests();
    clearAllTaskStorageInstances();
    await seedTasks([]);
  });

  afterEach(async () => {
    await seedTasks([]);
    clearAllTaskStorageInstances();
    ExoMindEnvironment.resetForTests();
  });

  it('exports JSON with tasks block and version', async () => {
    await seedTasks([createTask('t1')]);
    const port = createMockPort([
      { id: 'e1', timestamp: 1000, content: 'event-1', tags: ['note'] },
    ]);

    const service = new EventLogServiceImpl({ port });
    const json = await service.exportEventsAsJson();
    const payload = JSON.parse(json) as { version: number; events?: EventData[]; tasks?: TaskNode[] };

    expect(payload.version).toBe(1);
    expect(payload.events).toHaveLength(1);
    expect(payload.tasks).toHaveLength(1);
    expect(payload.tasks?.[0]?.id).toBe('t1');
  });

  it('merge import deduplicates by task.id and keeps union', async () => {
    await seedTasks([
      createTask('t1', { title: 'local-task-1' }),
      createTask('t2', { title: 'local-task-2' }),
    ]);

    const result = await importTasksFromBackup([
      createTask('t2', { title: 'backup-task-2', updatedAt: 1_700_000_009_999 }),
      createTask('t3', { title: 'backup-task-3' }),
    ], 'merge');

    const tasks = await exportTasksForBackup();

    expect(result).toEqual({ imported: 1, skipped: 1, total: 3 });
    expect(tasks).toHaveLength(3);
    expect(tasks.find((task) => task.id === 't2')?.title).toBe('backup-task-2');
    expect(tasks.find((task) => task.id === 't3')).toBeDefined();
  });

  it('overwrite import replaces entire task collection from backup', async () => {
    await seedTasks([
      createTask('t1'),
      createTask('t2'),
    ]);

    const result = await importTasksFromBackup([
      createTask('t9', { title: 'backup-task-9' }),
    ], 'overwrite');

    const tasks = await exportTasksForBackup();

    expect(result).toEqual({ imported: 1, skipped: 0, total: 1 });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.id).toBe('t9');
  });

  it('rolls back previous tasks when overwrite import fails midway', async () => {
    await seedTasks([
      createTask('t1'),
      createTask('t2'),
    ]);

    const storage = getTaskStorage(getCurrentUserId());
    const originalAddTask = storage.addTask.bind(storage);
    let addCount = 0;
    const addSpy = vi.spyOn(storage, 'addTask').mockImplementation(async (task: TaskNode) => {
      addCount += 1;
      if (addCount === 2) {
        throw new Error('boom');
      }
      return originalAddTask(task);
    });

    await expect(importTasksFromBackup([
      createTask('t9'),
      createTask('t10'),
    ], 'overwrite')).rejects.toThrow('boom');

    addSpy.mockRestore();
    const tasks = await exportTasksForBackup();
    expect(tasks.map((task) => task.id).sort()).toEqual(['t1', 't2']);
  });

  it('imports legacy events-only backup without changing tasks', async () => {
    await seedTasks([
      createTask('t1'),
      createTask('t2'),
    ]);
    const port = createMockPort([
      { id: 'e-local', timestamp: 900, content: 'local', tags: ['note'] },
    ]);
    const service = new EventLogServiceImpl({ port });
    const backup = JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      events: [
        { id: 'e-remote', timestamp: 1000, content: 'remote', tags: ['note'] },
      ],
    });

    const result = await service.importEventsFromJson(backup, 'overwrite');
    const tasks = await exportTasksForBackup();

    expect(result.events).toEqual({ imported: 1, skipped: 0, total: 1 });
    expect(result.tasks).toEqual({ imported: 0, skipped: 0, total: 2 });
    expect(tasks.map((task) => task.id).sort()).toEqual(['t1', 't2']);
  });
});
