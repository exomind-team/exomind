import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EventTimestamp } from '@/ui/app/components/EventTimestamp';
import { formatEventTimestamp } from '@/lib/eventlog/format-event-timestamp';

const at = (year: number, month: number, day: number) => new Date(year, month - 1, day, 19, 16).getTime();
const now = at(2026, 11, 13);
describe('事件日期披露', () => {
  it.each([
    [at(2026, 11, 13), '19:16'],
    [at(2026, 11, 12), '12日 · 19:16'],
    [at(2026, 10, 13), '10月13日 · 19:16'],
    [at(2025, 11, 13), '2025年11月13日 · 19:16'],
  ])('只省略与当前日期一致的部分', (stamp, expected) => {
    expect(formatEventTimestamp(stamp as number, 'compact', now)).toBe(expected);
  });
  it('星期模式保留跨周、月、年的消歧日期', () => {
    expect(formatEventTimestamp(at(2026, 11, 12), 'weekday', now)).toBe('星期四 · 19:16');
    expect(formatEventTimestamp(at(2026, 11, 5), 'weekday', now)).toBe('5日（星期四） · 19:16');
    expect(formatEventTimestamp(at(2025, 11, 13), 'weekday', now)).toBe('2025年11月13日（星期四） · 19:16');
  });
  it('跨午夜重新披露日期，不按经过24小时判断', () => {
    const stamp = new Date(2026, 11, 31, 23, 59).getTime();
    expect(formatEventTimestamp(stamp, 'compact', new Date(2027, 0, 1, 0, 0).getTime())).toBe('2026年12月31日 · 23:59');
    expect(formatEventTimestamp(NaN, 'full', now)).toBe('时间未知');
  });
  it('鼠标或键盘可切换完整和简略，偏好改变后使用新偏好', () => {
    const { rerender } = render(<EventTimestamp timestamp={at(2026, 11, 12)} now={now} mode="compact" />);
    const button = screen.getByRole('button');
    expect(button).toHaveTextContent('12日 · 19:16');
    fireEvent.click(button);
    expect(button).toHaveTextContent('2026年11月12日 · 19:16');
    fireEvent.click(button);
    expect(button).toHaveTextContent('12日 · 19:16');
    rerender(<EventTimestamp timestamp={at(2026, 11, 12)} now={now} mode="weekday" />);
    expect(button).toHaveTextContent('星期四 · 19:16');
    fireEvent.click(button);
    expect(button).toHaveTextContent('2026年11月12日 · 19:16');
    fireEvent.click(button);
    expect(button).toHaveTextContent('星期四 · 19:16');
  });
});
