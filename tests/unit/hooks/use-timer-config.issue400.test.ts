import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useTimerConfig } from '@/ui/app/hooks/useTimerConfig';

describe('useTimerConfig', () => {
  it('defaults to countup config without estimated minutes（未传估时时默认返回正计时配置）', () => {
    const { result } = renderHook(() => useTimerConfig());

    expect(result.current.countdownMinutes).toBe(25);
    expect(result.current.timerConfig).toEqual({ mode: 'countup' });
  });

  it('uses provided initial minutes（使用传入的初始分钟数）', () => {
    const { result } = renderHook(() => useTimerConfig(45));

    expect(result.current.countdownMinutes).toBe(45);
  });

  it('switches timerConfig to countup（切换到正计时后返回 countup 配置）', () => {
    const { result } = renderHook(() => useTimerConfig());

    act(() => {
      result.current.setTimerMode('countup');
    });

    expect(result.current.timerConfig).toEqual({ mode: 'countup' });
  });

  it('resets to next task initial minutes when reset key changes（任务切换时按新任务重新初始化）', () => {
    const { result, rerender } = renderHook(
      ({ initialMinutes, resetKey }: { initialMinutes?: number; resetKey?: string }) => useTimerConfig(initialMinutes, resetKey),
      {
        initialProps: { initialMinutes: 120, resetKey: 'task-1' },
      },
    );

    act(() => {
      result.current.setTimerMode('countup');
    });

    rerender({ initialMinutes: 30, resetKey: 'task-2' });

    expect(result.current.timerMode).toBe('countdown');
    expect(result.current.countdownMinutes).toBe(30);
    expect(result.current.customDurationDraft).toBe('30');
    expect(result.current.timerConfig).toEqual({ mode: 'countdown', minutes: 30 });
  });

  it('syncTimerConfig does not block later estimated-minute sync（自动同步不应阻断后续估时同步）', () => {
    const { result, rerender } = renderHook(
      ({ initialMinutes }: { initialMinutes?: number }) => useTimerConfig(initialMinutes, 'task-1'),
      {
        initialProps: { initialMinutes: 120 },
      },
    );

    act(() => {
      result.current.syncTimerConfig({ mode: 'countdown', minutes: 30 });
    });

    rerender({ initialMinutes: 60 });

    expect(result.current.timerMode).toBe('countdown');
    expect(result.current.countdownMinutes).toBe(60);
    expect(result.current.timerConfig).toEqual({ mode: 'countdown', minutes: 60 });
  });
});
