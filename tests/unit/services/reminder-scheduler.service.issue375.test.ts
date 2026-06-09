import { describe, expect, it, vi } from 'vitest';
import {
  ReminderSchedulerServiceImpl,
} from '@/lib/services/reminder-scheduler.service';
import type { ReminderService } from '@/lib/services/reminder.service';
import type { Reminder } from '@/lib/types/reminder';

function makeReminder(overrides: Partial<Reminder> = {}): Reminder {
  const now = Date.now();
  return {
    id: overrides.id ?? `reminder-${Math.random().toString(16).slice(2)}`,
    title: overrides.title ?? 'scheduler reminder',
    content: overrides.content ?? '',
    dueAt: overrides.dueAt ?? now,
    status: overrides.status ?? 'pending',
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    completedAt: overrides.completedAt,
  };
}

function createReminderServiceMock(state: { reminders: Reminder[] }): ReminderService {
  const getDuePendingReminders = vi.fn(async (at: number) => state.reminders
    .filter((reminder) => reminder.status === 'pending' && reminder.dueAt <= at));

  const markTriggered = vi.fn(async (id: string, triggeredAt = Date.now()) => {
    const reminder = state.reminders.find((item) => item.id === id);
    if (!reminder) return null;
    if (reminder.status !== 'pending') return { ...reminder };
    reminder.status = 'triggered';
    reminder.updatedAt = triggeredAt;
    return { ...reminder };
  });

  const listReminders = vi.fn(async () => state.reminders.map((reminder) => ({ ...reminder })));

  const noOp = vi.fn();
  const unresolved = vi.fn(async () => null);
  const unresolvedList = vi.fn(async () => []);

  return {
    listReminders,
    listRemindersByStatus: unresolvedList,
    getReminder: unresolved,
    createReminder: unresolved as unknown as ReminderService['createReminder'],
    updateReminder: unresolved as unknown as ReminderService['updateReminder'],
    markTriggered,
    completeReminder: unresolved,
    getDuePendingReminders,
    startSync: noOp as unknown as ReminderService['startSync'],
    stopSync: noOp as unknown as ReminderService['stopSync'],
    onReminderChange: () => () => {},
  };
}

describe('ReminderSchedulerService issue-375', () => {
  it('transitions due pending reminders and emits triggered events once', async () => {
    const state = {
      reminders: [
        makeReminder({ id: 'pending-1', dueAt: Date.now() - 1_000, status: 'pending' }),
      ],
    };
    const reminderService = createReminderServiceMock(state);
    const scheduler = new ReminderSchedulerServiceImpl(reminderService);
    const triggeredIds: string[] = [];

    scheduler.onTriggered((reminder) => {
      triggeredIds.push(reminder.id);
    });

    await scheduler.runNow();
    await scheduler.runNow();

    expect(triggeredIds).toEqual(['pending-1']);
    expect(state.reminders[0].status).toBe('triggered');
  });

  it('re-emits a reminder after it is completed then triggered again', async () => {
    const triggered = makeReminder({ id: 'r-1', status: 'triggered' });
    const state = {
      reminders: [triggered],
    };
    const reminderService = createReminderServiceMock(state);
    const scheduler = new ReminderSchedulerServiceImpl(reminderService);
    const triggeredIds: string[] = [];

    scheduler.onTriggered((reminder) => {
      triggeredIds.push(reminder.id);
    });

    await scheduler.runNow();
    state.reminders = [];
    await scheduler.runNow();
    state.reminders = [makeReminder({ ...triggered, status: 'triggered' })];
    await scheduler.runNow();

    expect(triggeredIds).toEqual(['r-1', 'r-1']);
  });
});
