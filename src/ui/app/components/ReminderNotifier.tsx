import { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ToastAction } from '@/components/ui/toast';
import { toast } from '@/components/ui/toast-hook';
import { getTimerEndSoundPresetById } from '@/lib/media/timer-end-sounds';
import {
  getReminderSchedulerService,
  DEFAULT_REMINDER_SCHEDULER_INTERVAL_MS,
} from '@/lib/services/reminder-scheduler.service';
import { getReminderService } from '@/lib/services/reminder.service';
import type { Reminder } from '@/lib/types/reminder';
import { getTimerPreferences } from '@/config/timer-preferences';
import { requestReminderFocus } from '@/ui/stores/reminder-ui-store';

function formatDueAt(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRelativeDueText(dueAt: number, now = Date.now()): string {
  const diffMinutes = Math.round((dueAt - now) / 60000);
  if (Math.abs(diffMinutes) <= 1) return '刚刚到期';
  if (diffMinutes > 0) {
    if (diffMinutes < 60) return `${diffMinutes} 分钟后到期`;
    const diffHours = Math.round(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours} 小时后到期`;
    const diffDays = Math.round(diffHours / 24);
    return `${diffDays} 天后到期`;
  }

  const overdue = Math.abs(diffMinutes);
  if (overdue < 60) return `已过期 ${overdue} 分钟`;
  const overdueHours = Math.round(overdue / 60);
  if (overdueHours < 24) return `已过期 ${overdueHours} 小时`;
  const overdueDays = Math.round(overdueHours / 24);
  return `已过期 ${overdueDays} 天`;
}

function extractNotificationBody(reminder: Reminder): string {
  const compact = reminder.content.replace(/[#>*`_\-\[\]\(\)]/g, ' ').replace(/\s+/g, ' ').trim();
  if (compact.length > 0) {
    return compact.slice(0, 120);
  }
  return `${formatDueAt(reminder.dueAt)} · ${formatRelativeDueText(reminder.dueAt)}`;
}

export function ReminderNotifier(): null {
  const navigate = useNavigate();
  const reminderServiceRef = useRef(getReminderService());
  const schedulerRef = useRef(getReminderSchedulerService());
  const toastHandleRef = useRef<ReturnType<typeof toast> | null>(null);

  const playReminderSound = useCallback(async () => {
    const preferences = getTimerPreferences();
    if (!preferences.countdownEndSoundEnabled) return;

    const preset = getTimerEndSoundPresetById(preferences.countdownEndSoundPresetId);
    try {
      const audio = new Audio(preset.url);
      audio.loop = false;
      audio.preload = 'auto';
      audio.currentTime = 0;
      await audio.play();
    } catch {
      // Ignore autoplay failures.
    }
  }, []);

  const openReminderPage = useCallback((id: string) => {
    requestReminderFocus(id);
    void navigate({ to: '/reminders' });
  }, [navigate]);

  const sendSystemNotification = useCallback(async (reminder: Reminder) => {
    if (typeof window === 'undefined' || typeof Notification === 'undefined') {
      return;
    }

    let permission = Notification.permission;
    if (permission === 'default') {
      try {
        permission = await Notification.requestPermission();
      } catch {
        return;
      }
    }

    if (permission !== 'granted') {
      return;
    }

    try {
      const notification = new Notification(reminder.title, {
        body: extractNotificationBody(reminder),
        tag: `reminder:${reminder.id}`,
        requireInteraction: true,
      });
      notification.onclick = () => {
        if (typeof window.focus === 'function') {
          window.focus();
        }
        openReminderPage(reminder.id);
        notification.close();
      };
    } catch {
      // Ignore unsupported Notification constructor errors.
    }
  }, [openReminderPage]);

  const syncTriggeredToast = useCallback(async () => {
    const reminders = await reminderServiceRef.current.listReminders();
    const triggered = reminders
      .filter((reminder) => reminder.status === 'triggered')
      .sort((left, right) => right.dueAt - left.dueAt);

    if (triggered.length === 0) {
      toastHandleRef.current?.dismiss();
      toastHandleRef.current = null;
      return;
    }

    const leadReminder = triggered[0];
    const title = triggered.length > 1
      ? `有 ${triggered.length} 条提醒待处理`
      : `提醒到期：${leadReminder.title}`;
    const description = `${formatDueAt(leadReminder.dueAt)} · ${formatRelativeDueText(leadReminder.dueAt)}`;
    const action = (
      <ToastAction
        altText="标记提醒已处理"
        onClick={() => {
          void reminderServiceRef.current.completeReminder(leadReminder.id);
        }}
      >
        已处理
      </ToastAction>
    );

    if (toastHandleRef.current) {
      toastHandleRef.current.update({
        id: toastHandleRef.current.id,
        title,
        description,
        action,
        onClick: () => openReminderPage(leadReminder.id),
        duration: 24 * 60 * 60 * 1000,
      });
      return;
    }

    toastHandleRef.current = toast({
      title,
      description,
      action,
      onClick: () => openReminderPage(leadReminder.id),
      duration: 24 * 60 * 60 * 1000,
    });
  }, [openReminderPage]);

  useEffect(() => {
    const scheduler = schedulerRef.current;

    const unsubscribeTriggered = scheduler.onTriggered((reminder) => {
      void playReminderSound();
      void sendSystemNotification(reminder);
      void syncTriggeredToast();
    });

    const unsubscribeChange = reminderServiceRef.current.onReminderChange(() => {
      void syncTriggeredToast();
    });

    scheduler.start(DEFAULT_REMINDER_SCHEDULER_INTERVAL_MS);
    void syncTriggeredToast();

    return () => {
      unsubscribeTriggered();
      unsubscribeChange();
      scheduler.stop();
      toastHandleRef.current?.dismiss();
      toastHandleRef.current = null;
    };
  }, [playReminderSound, sendSystemNotification, syncTriggeredToast]);

  return null;
}
