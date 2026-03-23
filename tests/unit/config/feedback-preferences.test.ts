import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FEEDBACK_SKIP_CONFIRM_COOLDOWN_SECONDS,
  getFeedbackPreferences,
  setFeedbackPreferences,
  subscribeFeedbackPreferencesChanges,
} from '@/config/feedback-preferences';

describe('feedback preferences（反馈内容开关）', () => {
  let storage: Record<string, string>;

  beforeEach(() => {
    storage = {};
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => (key in storage ? storage[key] : null),
        setItem: (key: string, value: string) => {
          storage[key] = value;
        },
      },
    });
  });

  it('defaults to quick-feedback only（默认仅快速反馈）', () => {
    expect(getFeedbackPreferences()).toEqual({
      timingInfoEnabled: false,
      statisticsEnabled: false,
      quickFeedbackEnabled: true,
    });
  });

  it('freezes empty-feedback confirm cool-down policy at 5 seconds', () => {
    expect(FEEDBACK_SKIP_CONFIRM_COOLDOWN_SECONDS).toBe(5);
  });

  it('persists and emits custom event（持久化并广播）', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeFeedbackPreferencesChanges(listener);

    setFeedbackPreferences({
      timingInfoEnabled: true,
      statisticsEnabled: true,
      quickFeedbackEnabled: false,
    });

    expect(storage['exomind:feedbackPreferences']).toBe(
      JSON.stringify({
        timingInfoEnabled: true,
        statisticsEnabled: true,
        quickFeedbackEnabled: false,
      }),
    );
    expect(listener).toHaveBeenCalledWith({
      timingInfoEnabled: true,
      statisticsEnabled: true,
      quickFeedbackEnabled: false,
    });
    unsubscribe();
  });

  it('handles storage event updates（支持 storage 事件同步）', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeFeedbackPreferencesChanges(listener);

    window.dispatchEvent(new StorageEvent('storage', {
      key: 'exomind:feedbackPreferences',
      newValue: JSON.stringify({
        timingInfoEnabled: true,
        statisticsEnabled: false,
        quickFeedbackEnabled: true,
      }),
    }));

    expect(listener).toHaveBeenCalledWith({
      timingInfoEnabled: false,
      statisticsEnabled: false,
      quickFeedbackEnabled: true,
    });
    unsubscribe();
  });
});
