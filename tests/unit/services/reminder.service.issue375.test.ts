import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReminderServiceImpl } from '@/lib/services/reminder.service';
import type { IReminderPort } from '@/lib/environment/interfaces/reminder.port';
import type { Reminder, ReminderStatus } from '@/lib/types/reminder';

function makeReminder(overrides: Partial<Reminder> = {}): Reminder {
  const now = Date.now();
  return {
    id: overrides.id ?? `reminder-${Math.random().toString(16).slice(2)}`,
    title: overrides.title ?? 'test reminder',
    content: overrides.content ?? '',
    dueAt: overrides.dueAt ?? now + 60_000,
    status: overrides.status ?? 'pending',
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    completedAt: overrides.completedAt,
  };
}

function createMockPort(initialReminders: Reminder[]): IReminderPort {
  const store = new Map(initialReminders.map((reminder) => [reminder.id, { ...reminder }]));
  const listeners = new Set<(change: unknown) => void>();

  return {
    listReminders: vi.fn(async () => Array.from(store.values()).map((reminder) => ({ ...reminder }))),
    getReminderById: vi.fn(async (id: string) => {
      const reminder = store.get(id);
      return reminder ? { ...reminder } : null;
    }),
    createReminder: vi.fn(async (input) => {
      const now = Date.now();
      const created: Reminder = {
        id: `created-${store.size + 1}`,
        title: input.title,
        content: input.content,
        dueAt: input.dueAt,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      };
      store.set(created.id, created);
      return { ...created };
    }),
    updateReminder: vi.fn(async (id: string, updates) => {
      const current = store.get(id);
      if (!current) return null;
      const next = { ...current, ...updates, updatedAt: Date.now() };
      store.set(id, next);
      return { ...next };
    }),
    transitionReminder: vi.fn(async (id: string, to: ReminderStatus, at = Date.now()) => {
      const current = store.get(id);
      if (!current) return null;
      const next: Reminder = {
        ...current,
        status: to,
        updatedAt: at,
        ...(to === 'completed' ? { completedAt: at } : {}),
      };
      store.set(id, next);
      return { ...next };
    }),
    startSync: vi.fn(async () => {}),
    stopSync: vi.fn(async () => {}),
    onRemoteChange: vi.fn((callback: (change: unknown) => void) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    }),
  };
}

describe('ReminderService issue-375', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('creates overdue reminder and immediately marks it triggered', async () => {
    const port = createMockPort([]);
    const service = new ReminderServiceImpl(port);

    const result = await service.createReminder({
      title: 'overdue',
      content: 'content',
      dueAt: Date.now() - 30_000,
    });

    expect(result.status).toBe('triggered');
    expect(port.transitionReminder).toHaveBeenCalledWith(result.id, 'triggered', expect.any(Number));
  });

  it('rejects editing non-pending reminders', async () => {
    const reminder = makeReminder({ id: 'r1', status: 'triggered' });
    const port = createMockPort([reminder]);
    const service = new ReminderServiceImpl(port);

    await expect(service.updateReminder('r1', { title: 'new title' })).rejects.toThrow('仅未到期提醒可编辑');
  });

  it('returns due pending reminders sorted by nearest due first', async () => {
    const reminders = [
      makeReminder({ id: 'pending-late', dueAt: 3_000, status: 'pending' }),
      makeReminder({ id: 'pending-early', dueAt: 1_000, status: 'pending' }),
      makeReminder({ id: 'triggered', dueAt: 500, status: 'triggered' }),
      makeReminder({ id: 'pending-future', dueAt: 10_000, status: 'pending' }),
    ];
    const port = createMockPort(reminders);
    const service = new ReminderServiceImpl(port);

    const due = await service.getDuePendingReminders(4_000);
    expect(due.map((item) => item.id)).toEqual(['pending-early', 'pending-late']);
  });
});
