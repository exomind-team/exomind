import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useBetaNow } from '@/beta/date-clock';

afterEach(() => vi.useRealTimers());
describe('Beta current-date clock', () => {
  it('updates at midnight/minute boundary and immediately on focus after sleep', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026,10,13,23,59,59,900));
    const { result, unmount } = renderHook(useBetaNow);
    act(() => { vi.advanceTimersByTime(100); });
    expect(new Date(result.current).getDate()).toBe(14);
    vi.setSystemTime(new Date(2026,10,16,9,30,10));
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(result.current).toBe(Date.now()); unmount();
  });
});
