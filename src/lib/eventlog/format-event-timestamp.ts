export type EventDateDisplayMode = 'compact' | 'full' | 'weekday';

export function formatEventTimestamp(timestamp: number, mode: EventDateDisplayMode, now = Date.now()): string {
  const date = new Date(timestamp);
  const current = new Date(now);
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(current.getTime())) return '时间未知';
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  const sameYear = date.getFullYear() === current.getFullYear();
  const sameMonth = sameYear && date.getMonth() === current.getMonth();
  const sameDay = sameMonth && date.getDate() === current.getDate();
  const full = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  if (mode === 'full') return `${full} · ${time}`;
  let prefix = !sameYear ? full : !sameMonth ? `${date.getMonth() + 1}月${date.getDate()}日` : !sameDay ? `${date.getDate()}日` : '';
  if (mode === 'weekday') {
    const monday = new Date(current.getFullYear(), current.getMonth(), current.getDate());
    monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
    const nextMonday = new Date(monday);
    nextMonday.setDate(nextMonday.getDate() + 7);
    const weekday = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][date.getDay()];
    prefix = sameMonth && date >= monday && date < nextMonday ? weekday : `${prefix}（${weekday}）`;
  }
  return prefix ? `${prefix} · ${time}` : time;
}
