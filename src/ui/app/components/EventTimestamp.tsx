import { useEffect, useState } from 'react';
import { formatEventTimestamp, type EventDateDisplayMode } from '@/lib/eventlog/format-event-timestamp';

export function EventTimestamp({ timestamp, now, mode }: { timestamp: number; now: number; mode: EventDateDisplayMode }) {
  const [override, setOverride] = useState<EventDateDisplayMode | null>(null);
  useEffect(() => setOverride(null), [mode, timestamp]);
  const current = override ?? mode;
  return (
    <button type="button" className="max-w-full break-words text-muted tabular-nums hover:text-foreground focus-visible:outline focus-visible:outline-2"
      aria-label={`${formatEventTimestamp(timestamp, 'full', now)}，点击切换完整或简略日期`}
      title={formatEventTimestamp(timestamp, 'full', now)}
      onClick={() => setOverride(current === 'full' ? 'compact' : 'full')}>
      <time dateTime={Number.isFinite(timestamp) && Number.isFinite(new Date(timestamp).getTime()) ? new Date(timestamp).toISOString() : undefined}>
        {formatEventTimestamp(timestamp, current, now)}
      </time>
    </button>
  );
}
