export type BetaTimelinePeriod = 'day' | 'week' | 'month';

export interface BetaPeriodWindow {
  from_ms: number;
  to_ms: number;
  time_zone: string;
}

interface LocalDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

type LocalDate = Pick<LocalDateTime, 'year' | 'month' | 'day'>;

const HOUR_MS = 60 * 60 * 1000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    calendar: 'iso8601',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  formatters.set(timeZone, formatter);
  return formatter;
}

function partsAt(epochMs: number, timeZone: string): LocalDateTime {
  if (!Number.isSafeInteger(epochMs)) throw new RangeError('时间锚点无效');
  const parts = new Map(formatterFor(timeZone).formatToParts(new Date(epochMs)).map(part => [part.type, part.value] as const));
  const value = (name: Intl.DateTimeFormatPart['type']): number => {
    const part = parts.get(name);
    if (part === undefined) throw new RangeError('无法读取本地时间');
    return Number(part);
  };
  const hour = value('hour');
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: hour === 24 ? 0 : hour,
    minute: value('minute'),
    second: value('second'),
    millisecond: ((epochMs % 1000) + 1000) % 1000,
  };
}

function utcEpoch(value: LocalDateTime): number {
  const date = new Date(0);
  date.setUTCFullYear(value.year, value.month - 1, value.day);
  date.setUTCHours(value.hour, value.minute, value.second, value.millisecond);
  return date.getTime();
}

function offsetAt(epochMs: number, timeZone: string): number {
  const instant = Math.floor(epochMs / 1000) * 1000;
  return utcEpoch(partsAt(instant, timeZone)) - instant;
}

function sameLocalTime(left: LocalDateTime, right: LocalDateTime): boolean {
  return left.year === right.year && left.month === right.month && left.day === right.day
    && left.hour === right.hour && left.minute === right.minute && left.second === right.second
    && left.millisecond === right.millisecond;
}

function localTimeToEpoch(value: LocalDateTime, timeZone: string): number {
  const wallEpoch = utcEpoch(value);
  const offsets = new Set<number>();
  for (const hours of [-36, -12, 0, 12, 36]) {
    offsets.add(offsetAt(wallEpoch + hours * HOUR_MS, timeZone));
  }
  const candidates = [...offsets].map(offset => wallEpoch - offset);
  const exact = candidates.filter(candidate => sameLocalTime(partsAt(candidate, timeZone), value));
  if (exact.length) return Math.min(...exact);

  // If the wall time falls into a forward clock jump, select the first valid
  // local time after the gap. Repeated wall times were handled above by taking
  // the earlier matching instant.
  const afterGap = candidates
    .map(epoch => ({ epoch, wall: utcEpoch(partsAt(epoch, timeZone)) }))
    .filter(candidate => candidate.wall > wallEpoch)
    .sort((left, right) => left.wall - right.wall || left.epoch - right.epoch)[0];
  if (afterGap) return afterGap.epoch;

  let guess = wallEpoch;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    guess = wallEpoch - offsetAt(guess, timeZone);
    if (sameLocalTime(partsAt(guess, timeZone), value)) return guess;
  }
  return guess;
}

function utcDate(year: number, month: number, day: number): Date {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function dateParts(date: Date): LocalDate {
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function addCalendarDays(date: LocalDate, days: number): LocalDate {
  return dateParts(utcDate(date.year, date.month, date.day + days));
}

function addCalendarMonthsClamped(date: LocalDate, months: number): LocalDate {
  const first = utcDate(date.year, date.month + months, 1);
  const lastDay = utcDate(first.getUTCFullYear(), first.getUTCMonth() + 2, 0).getUTCDate();
  return {
    year: first.getUTCFullYear(),
    month: first.getUTCMonth() + 1,
    day: Math.min(date.day, lastDay),
  };
}

function localZone(timeZone?: string): string {
  return timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
}

function atMidnight(date: LocalDate, timeZone: string): number {
  return localTimeToEpoch({ ...date, hour: 0, minute: 0, second: 0, millisecond: 0 }, timeZone);
}

export function resolveBetaPeriodWindow(
  anchorMs: number,
  period: BetaTimelinePeriod,
  timeZone?: string,
): BetaPeriodWindow {
  const zone = localZone(timeZone);
  const anchor = partsAt(anchorMs, zone);
  const localDay = { year: anchor.year, month: anchor.month, day: anchor.day };
  let firstDay: LocalDate;
  let nextDay: LocalDate;

  if (period === 'day') {
    firstDay = localDay;
    nextDay = addCalendarDays(firstDay, 1);
  } else if (period === 'week') {
    const weekday = utcDate(localDay.year, localDay.month, localDay.day).getUTCDay();
    firstDay = addCalendarDays(localDay, -((weekday + 6) % 7));
    nextDay = addCalendarDays(firstDay, 7);
  } else {
    firstDay = { year: anchor.year, month: anchor.month, day: 1 };
    nextDay = addCalendarMonthsClamped(firstDay, 1);
  }

  return {
    from_ms: atMidnight(firstDay, zone),
    to_ms: atMidnight(nextDay, zone),
    time_zone: zone,
  };
}

export function shiftBetaPeriodAnchor(
  anchorMs: number,
  period: BetaTimelinePeriod,
  delta: number,
  timeZone?: string,
): number {
  if (!Number.isSafeInteger(delta)) throw new RangeError('周期位移无效');
  if (delta === 0) return anchorMs;
  const zone = localZone(timeZone);
  const anchor = partsAt(anchorMs, zone);
  const localDay = { year: anchor.year, month: anchor.month, day: anchor.day };
  const shifted = period === 'month'
    ? addCalendarMonthsClamped(localDay, delta)
    : addCalendarDays(localDay, delta * (period === 'week' ? 7 : 1));
  return localTimeToEpoch({ ...shifted, hour: anchor.hour, minute: anchor.minute, second: anchor.second, millisecond: anchor.millisecond }, zone);
}

export function formatBetaPeriodWindow(window: BetaPeriodWindow, period: BetaTimelinePeriod, locale?: string): string {
  const start = new Date(window.from_ms);
  const end = new Date(window.to_ms - 1);
  if (period === 'month') {
    return new Intl.DateTimeFormat(locale, { timeZone: window.time_zone, year: 'numeric', month: 'long' }).format(start);
  }
  const formatter = new Intl.DateTimeFormat(locale, {
    timeZone: window.time_zone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  const startLabel = formatter.format(start);
  const endLabel = formatter.format(end);
  return startLabel === endLabel ? startLabel : startLabel + ' – ' + endLabel;
}
