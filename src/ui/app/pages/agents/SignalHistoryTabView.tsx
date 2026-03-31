import { useMemo, useState } from 'react';
import {
  formatSignalPayload,
  formatSignalPayloadDetails,
  formatSignalTime,
  formatRelativeSignalTime,
  isLinkProofSignalTopic,
  signalTopicTint,
} from './agents-utils';
import type { SignalEvent } from '@/lib/types/signal-pool';

const LINK_PROOF_FILTER_VALUE = 'link-proof';

export function SignalHistoryTabView({
  events,
  hostLabel,
  onSelectSignal,
}: {
  events: SignalEvent[];
  hostLabel?: string;
  onSelectSignal: (signalId: string) => void;
}) {
  const [topicFilter, setTopicFilter] = useState<string>('all');
  const topicOptions = useMemo(() => {
    const businessTopics = Array.from(
      new Set(
        events
          .filter((eventItem) => !isLinkProofSignalTopic(eventItem.topic))
          .map((eventItem) => eventItem.topic),
      ),
    ).slice(0, 8);
    const hasLinkProofEvents = events.some((eventItem) => isLinkProofSignalTopic(eventItem.topic));
    return [
      'all',
      ...(hasLinkProofEvents ? [LINK_PROOF_FILTER_VALUE] : []),
      ...businessTopics,
    ];
  }, [events]);
  const filteredEvents = useMemo(
    () => {
      if (topicFilter === 'all') {
        return events;
      }
      if (topicFilter === LINK_PROOF_FILTER_VALUE) {
        return events.filter((eventItem) => isLinkProofSignalTopic(eventItem.topic));
      }
      return events.filter((eventItem) => eventItem.topic === topicFilter);
    },
    [events, topicFilter],
  );

  return (
    <section data-testid="agent-signal-history-view" className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-[#1C1917] dark:text-[#FAFAF9]">Signal History</p>
          {hostLabel && (
            <span className="rounded-full bg-[#F5F0ED] px-2 py-0.5 font-mono text-[10px] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]">
              {hostLabel}
            </span>
          )}
        </div>
        <span className="text-xs text-[#78716C] dark:text-[#A8A29E]">{filteredEvents.length} 条</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {topicOptions.map((topic) => {
          const active = topicFilter === topic;
          return (
            <button
              key={topic}
              type="button"
              onClick={() => setTopicFilter(topic)}
              data-testid={`signal-history-filter-${topic === 'all' ? 'all' : topic}`}
              className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${
                active
                  ? 'bg-[#C75B3A] text-white'
                  : 'bg-[#F5F0ED] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]'
              }`}
            >
              {topic === 'all'
                ? '全部主题'
                : topic === LINK_PROOF_FILTER_VALUE
                  ? '链路验证'
                  : `主题 ${topic}`}
            </button>
          );
        })}
      </div>

      {filteredEvents.length === 0 ? (
        <div className="rounded-[10px] border border-[#E7E3E0] bg-white px-4 py-8 text-center text-xs text-[#78716C] dark:border-[#292524] dark:bg-[#0C0A09] dark:text-[#A8A29E]">
          暂无信号历史
        </div>
      ) : (
        <div className="divide-y divide-[#E7E3E0] overflow-hidden rounded-[10px] border border-[#E7E3E0] bg-white dark:divide-[#292524] dark:border-[#292524] dark:bg-[#0C0A09]">
          {filteredEvents.map((eventItem) => {
            const payloadText = formatSignalPayload(eventItem.payload, eventItem.topic);
            const payloadDetailsText = formatSignalPayloadDetails(eventItem.payload);
            const tint = signalTopicTint(eventItem.topic);
            const isSystemLinkProof = isLinkProofSignalTopic(eventItem.topic);

            return (
            <div
              key={eventItem.id}
              data-testid={`signal-history-item-${eventItem.id}`}
              className="overflow-hidden"
            >
              <button
                type="button"
                onClick={() => onSelectSignal(eventItem.id)}
                data-testid={`signal-history-open-${eventItem.id}`}
                className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-[#FAF7F5] dark:hover:bg-[#1C1917]"
              >
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: tint }} />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="truncate font-mono text-xs text-[#44403C] dark:text-[#D6D3D1]">{eventItem.topic}</p>
                    {isSystemLinkProof && (
                      <span
                        data-testid={`signal-history-system-badge-${eventItem.id}`}
                        className="shrink-0 rounded-full bg-[#0F766E20] px-2 py-0.5 text-[10px] font-medium text-[#0F766E]"
                      >
                        系统信号
                      </span>
                    )}
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-[#78716C] dark:text-[#A8A29E]">
                    {payloadText}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[10px] text-[#78716C] dark:text-[#A8A29E]">
                    {formatRelativeSignalTime(eventItem.ts)}
                  </p>
                  <p className="mt-0.5 text-[10px] text-[#A8A29E] dark:text-[#78716C]">{formatSignalTime(eventItem.ts)}</p>
                  <p className="mt-0.5 text-[10px] text-[#A8A29E] dark:text-[#78716C]">{eventItem.source}</p>
                </div>
              </button>
              <details
                data-testid={`signal-history-payload-${eventItem.id}`}
                className="border-t border-[#F5F0ED] px-4 py-2 dark:border-[#1C1917]"
              >
                <summary className="cursor-pointer text-[11px] text-[#78716C] dark:text-[#A8A29E]">
                  展开 payload
                </summary>
                <pre className="mt-2 overflow-x-auto rounded-lg bg-[#FAF7F5] p-3 text-[10px] text-[#57534E] dark:bg-[#1C1917] dark:text-[#D6D3D1]">
                  {`Payload:\n${payloadDetailsText}`}
                </pre>
              </details>
            </div>
          )})}
        </div>
      )}
    </section>
  );
}
