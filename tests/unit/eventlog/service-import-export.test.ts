import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { EventData } from '@/lib/types/event';
import type { TaskNode } from '@/lib/types/task';
import { EventLogServiceImpl, type TaskBackupGateway } from '@/lib/services/eventlog.service';

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

describe('EventLogService import/export', () => {
  let port: EventLogPortShape;
  let taskBackup: TaskBackupGateway;

  beforeEach(() => {
    port = createMockPort([
      { id: 'e1', timestamp: 1000, content: 'old', tags: ['note'] },
      { id: 'e2', timestamp: 2000, content: 'old-2', tags: ['note'] },
    ]);
    const task: TaskNode = {
      id: 't1',
      title: 'task-1',
      status: 'not_started',
      priority: 'medium',
      dependsOn: [],
      tags: [],
      createdAt: 1000,
      updatedAt: 1000,
    };
    taskBackup = {
      exportTasks: vi.fn(async () => [task]),
      importTasks: vi.fn(async () => ({ imported: 0, skipped: 0, total: 1 })),
    };
  });

  it('exports eventlog as json backup', async () => {
    const service = new EventLogServiceImpl({ port, taskBackup });
    const json = await service.exportEventsAsJson();
    const parsed = JSON.parse(json) as { version: number; events: EventData[]; tasks: TaskNode[] };
    expect(parsed.version).toBe(1);
    expect(parsed.events).toHaveLength(2);
    expect(parsed.tasks).toHaveLength(1);
  });

  it('imports backup with merge strategy', async () => {
    taskBackup.importTasks = vi.fn(async () => ({ imported: 1, skipped: 0, total: 2 }));
    const service = new EventLogServiceImpl({ port, taskBackup });
    const backup = JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      events: [
        { id: 'e2', timestamp: 3000, content: 'new-2', tags: ['note'] },
        { id: 'e3', timestamp: 4000, content: 'new-3', tags: ['note'] },
      ],
      tasks: [
        {
          id: 't2',
          title: 'task-2',
          status: 'in_progress',
          priority: 'high',
          dependsOn: [],
          tags: ['focus'],
          createdAt: 2000,
          updatedAt: 2500,
        },
      ],
    });

    const result = await service.importEventsFromJson(backup, 'merge');
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.total).toBe(3);
    expect(result.events).toEqual({ imported: 1, skipped: 1, total: 3 });
    expect(result.tasks).toEqual({ imported: 1, skipped: 0, total: 2 });
    expect(taskBackup.importTasks).toHaveBeenCalledWith(expect.any(Array), 'merge');
  });

  it('rolls back imported events when task import fails', async () => {
    const importTasksMock = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ imported: 0, skipped: 0, total: 1 });
    taskBackup.importTasks = importTasksMock;
    const service = new EventLogServiceImpl({ port, taskBackup });
    const backup = JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      events: [
        { id: 'e2', timestamp: 3000, content: 'new-2', tags: ['note'] },
        { id: 'e3', timestamp: 4000, content: 'new-3', tags: ['note'] },
      ],
      tasks: [
        {
          id: 't2',
          title: 'task-2',
          status: 'in_progress',
          priority: 'high',
          dependsOn: [],
          tags: ['focus'],
          createdAt: 2000,
          updatedAt: 2500,
        },
      ],
    });

    await expect(service.importEventsFromJson(backup, 'merge')).rejects.toThrow('boom');

    const events = await service.loadEvents();
    expect(events.map((event) => event.id).sort()).toEqual(['e1', 'e2']);
    expect(events.find((event) => event.id === 'e2')?.content).toBe('old-2');
    expect(events.find((event) => event.id === 'e3')).toBeUndefined();
    expect(importTasksMock).toHaveBeenCalledTimes(2);
    expect(importTasksMock.mock.calls[1]?.[1]).toBe('overwrite');
  });
});
