import { describe, expect, it, vi } from 'vitest';
import {
  consumePendingTimeBlockNotificationAction,
  dispatchTimeBlockNotificationAction,
  subscribeTimeBlockNotificationAction,
} from '@/lib/services/timeblock-notification-dispatcher';

describe('timeblock notification dispatcher issue-249（动作分发与挂起恢复）', () => {
  it('notifies subscribers and stores pending action（通知订阅者并缓存挂起动作）', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeTimeBlockNotificationAction(listener);

    dispatchTimeBlockNotificationAction('start');

    expect(listener).toHaveBeenCalledWith('start');
    expect(consumePendingTimeBlockNotificationAction()).toBe('start');
    expect(consumePendingTimeBlockNotificationAction()).toBeNull();

    unsubscribe();
  });
});

