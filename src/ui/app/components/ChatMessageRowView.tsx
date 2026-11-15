import type { ReactNode, Ref } from 'react';

/** α's message row, shared without its event store, profile or router hooks. */
export function ChatMessageRowView({
  eventId, tone, avatar, metadata, content, afterBubble, actions, rowRef,
  className = '', timelineKind,
}: {
  eventId: string;
  tone: 'user' | 'system' | 'agent-feedback';
  avatar: ReactNode;
  metadata: ReactNode;
  content: ReactNode;
  afterBubble?: ReactNode;
  actions?: ReactNode;
  rowRef?: Ref<HTMLDivElement>;
  className?: string;
  timelineKind?: 'capture' | 'timeblock';
}) {
  if (tone === 'user') return <div ref={rowRef} className={`flex justify-end gap-2 ${className}`}
    data-event-id={eventId} data-testid="new-mobile-user-message-row" data-timeline-kind={timelineKind}>
    <div className="flex max-w-[84%] flex-col items-end">
      <div className="mb-1 flex flex-wrap items-center justify-end gap-1 text-[11px] leading-[1.4]" data-testid="new-mobile-message-meta">{metadata}</div>
      {content !== null && content !== undefined && <div className="rounded-2xl bg-user-bubble px-[14px] py-[10px] text-[13px] leading-[1.6] text-user-bubble-text [&_.prose]:text-inherit [&_.prose_p]:text-inherit [&_.prose_li]:text-inherit">{content}</div>}
      {afterBubble}{actions}
    </div>
    {avatar}
  </div>;
  const feedback = tone === 'agent-feedback';
  return <div ref={rowRef} className={`flex items-start gap-2 ${className}`}
    data-event-id={eventId} data-testid="new-mobile-system-message-row" data-timeline-kind={timelineKind}>
    {avatar}
    <div className="min-w-0 max-w-[85%] flex-1">
      <div className="mb-1 flex flex-wrap items-center gap-1 text-[11px] leading-[1.4]" data-testid="new-mobile-message-meta">{metadata}</div>
      {content !== null && content !== undefined && <div className={`rounded-2xl border px-[14px] py-3 text-[13px] leading-[1.6] ${feedback ? 'border-violet-200 bg-violet-50 text-violet-950 dark:border-violet-800 dark:bg-violet-950/35 dark:text-violet-100' : 'border-card bg-card text-strong'}`}
        data-testid={feedback ? 'new-mobile-agent-feedback-bubble' : undefined}>{content}</div>}
      {afterBubble}{actions}
    </div>
  </div>;
}
