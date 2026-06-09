import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Reminder } from '@/lib/types/reminder';
import { RemindersPage } from '@/ui/app/pages/RemindersPage';

const listRemindersMock = vi.fn<() => Promise<Reminder[]>>();
const createReminderMock = vi.fn();
const updateReminderMock = vi.fn();
const completeReminderMock = vi.fn();
const clearFocusMock = vi.fn();
const onReminderChangeMock = vi.fn(() => () => {});

vi.mock('@/lib/services/reminder.service', () => ({
  getReminderService: vi.fn(() => ({
    listReminders: listRemindersMock,
    onReminderChange: onReminderChangeMock,
    createReminder: createReminderMock,
    updateReminder: updateReminderMock,
    completeReminder: completeReminderMock,
  })),
}));

vi.mock('@/ui/stores/reminder-ui-store', () => ({
  useReminderUiStore: (selector: (state: {
    composeRequestToken: number;
    focusReminderId: string | null;
    clearFocus: () => void;
  }) => unknown) =>
    selector({
      composeRequestToken: 0,
      focusReminderId: null,
      clearFocus: clearFocusMock,
    }),
}));

describe('Reminders dialog shortcuts（提醒弹窗快捷提交）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listRemindersMock.mockResolvedValue([]);
    createReminderMock.mockResolvedValue({
      id: 'reminder-1',
      title: '测试提醒',
      content: '测试正文',
      dueAt: Date.now() + 60_000,
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } satisfies Reminder);
    updateReminderMock.mockResolvedValue(null);
    completeReminderMock.mockResolvedValue(undefined);
  });

  it('submits the reminder dialog from the content textarea with Ctrl/Cmd+Enter', async () => {
    render(<RemindersPage />);

    await waitFor(() => {
      expect(listRemindersMock).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole('button', { name: '新建' }));

    fireEvent.change(screen.getByPlaceholderText('例如：提交周报'), {
      target: { value: '测试提醒' },
    });

    const contentTextarea = screen.getByPlaceholderText(
      '写下提醒详情，例如待办清单、链接、备注...',
    );
    fireEvent.change(contentTextarea, {
      target: { value: '通过 Ctrl+Enter 提交提醒' },
    });

    fireEvent.keyDown(contentTextarea, { key: 'Enter' });
    expect(createReminderMock).not.toHaveBeenCalled();

    fireEvent.keyDown(contentTextarea, { key: 'Enter', metaKey: true });

    await waitFor(() => {
      expect(createReminderMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '测试提醒',
          content: '通过 Ctrl+Enter 提交提醒',
        }),
      );
    });
  });
});
