import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useTimerConfig } from '@/ui/app/hooks/useTimerConfig';

describe('useTimerConfig', () => {
  it('defaults to 25-minute countdown config（默认返回 25 分钟倒计时配置）', () => {
    const { result } = renderHook(() => useTimerConfig());

    expect(result.current.timerConfig).toEqual({ mode: 'countdown', minutes: 25 });
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
});
