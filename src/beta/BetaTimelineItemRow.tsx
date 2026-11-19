import { useMemo } from 'react';
import { Bot } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ChatMessageRowView } from '@/ui/app/components/ChatMessageRowView';
import { EventTimestamp } from '@/ui/app/components/EventTimestamp';
import type { EventDateDisplayMode } from '@/lib/eventlog/format-event-timestamp';
import type { BetaClient, BetaEvent } from './client';
import type { BetaTimelineItem } from './timeblocks-types';
import type { SummaryArtifactRecord, SummarySourceRef } from './summary-types';
import { BetaSummaryHistoryRow } from './BetaSummaryHistoryRow';
import { BetaExternalSummaryHistoryRow } from './BetaExternalSummaryHistoryRow';
import { BetaTimeblockAvatar } from './BetaTimeblockAvatar';
import { betaTimeblockLabel } from './timeblock-label';
import { OriginalDownloads } from './OriginalDownloads';
import { BetaMessageActions, BetaMessageReferenceLinks } from './BetaMessageActions';
import { stripBetaMessageReferencesForDisplay, type BetaMessageReferenceSource, type BetaMessageReferenceIdentity, type BetaMessageReference } from './message-references';
interface BetaTimelineItemRowProps {
  item: BetaTimelineItem;
  client: BetaClient;
  deviceId: string;
  revision: number;
  now: number;
  dateMode: EventDateDisplayMode;
  recordsActive: boolean;
  deviceLabel: (deviceId: string) => string;
  onQuote: (source: BetaMessageReferenceSource) => void;
  onCorrect?: (record: BetaEvent) => void;
  onOpenReference: (reference: BetaMessageReferenceIdentity) => void;
  sourceLabel: (reference: BetaMessageReference) => string | undefined;
  onInspectSummary: (record: SummaryArtifactRecord) => void;
  onOpenSource?: (source: SummarySourceRef) => void;
}

export function BetaTimelineItemRow({
  item,
  client,
  deviceId,
  revision,
  now,
  dateMode,
  recordsActive,
  deviceLabel,
  onQuote,
  onCorrect,
  onOpenReference,
  sourceLabel,
  onInspectSummary,
  onOpenSource,
}: BetaTimelineItemRowProps) {
  const capture = item.kind === 'capture' ? item.record : null;
  const timeblock = item.kind === 'timeblock' ? item.record : null;
  const captureText = capture?.text;
  const displayCaptureText = useMemo(
    () => captureText ? stripBetaMessageReferencesForDisplay(captureText) : '',
    [captureText],
  );
  const timeblockText = timeblock ? betaTimeblockLabel(timeblock) : '';
  const actionContent = item.kind === 'capture'
    ? item.record.text
    : item.kind === 'timeblock'
      ? timeblockText
      : item.kind === 'summary/1'
        ? item.record.output.narrative
        : item.record.narrative;
  const attachmentOnly = !!capture && !capture.text.trim() && !!capture.originals?.length;
  const attachmentNames = capture?.originals?.map(original => original.file_name.trim()).filter(Boolean) ?? [];
  const referenceLabel = attachmentOnly
    ? '附件记录'
    : timeblock
      ? '系统时间块'
      : item.kind === 'summary/1'
        ? 'AI 总结'
        : item.kind === 'agent_summary/1'
          ? '外部 Agent 回顾'
          : undefined;
  const referenceMetadata = attachmentOnly
    ? attachmentNames.length
      ? `附件名：${attachmentNames.join('、')}`
      : `附件数：${capture?.originals?.length ?? 0}`
    : undefined;
  const canQuote = actionContent.trim().length > 0 || !!referenceLabel || !!referenceMetadata;
  const messageActions = (
    <>
      <BetaMessageActions
        content={actionContent}
        profileId={item.record.profile_id}
        eventId={item.record.event_id}
        align={capture?.author_kind === 'human' ? 'end' : 'start'}
        onQuote={canQuote ? onQuote : undefined}
        onCorrect={capture && onCorrect ? () => onCorrect(capture) : undefined}
        referenceLabel={referenceLabel}
        referenceMetadata={referenceMetadata}
      />
      {capture ? (
        <BetaMessageReferenceLinks value={capture.text} onOpen={onOpenReference} sourceLabel={sourceLabel} />
      ) : null}
    </>
  );

  if (item.kind === 'capture') {
    const event = item.record;
    return (
      <ChatMessageRowView
        eventId={event.event_id}
        timelineKind="capture"
        tone={event.author_kind === 'human' ? 'user' : 'agent-feedback'}
        className="group"
        avatar={
          <Avatar className={`${event.author_kind === 'human' ? '' : 'mt-0.5 '}h-8 w-8 shrink-0`}>
            <AvatarFallback className={event.author_kind === 'human'
              ? 'rounded-full bg-orange-100 text-[11px] font-semibold text-orange-800 dark:bg-orange-950 dark:text-orange-100'
              : 'bg-violet-600 text-white'}>
              {event.author_kind === 'human' ? '我' : <Bot size={16} />}
            </AvatarFallback>
          </Avatar>
        }
        metadata={
          <>
            <span className="text-muted">{deviceLabel(event.device_id)}</span>
            <EventTimestamp timestamp={event.occurred_at_ms} now={now} mode={dateMode} />
            <span className="text-xs font-semibold text-strong">
              {event.author_kind === 'human' ? '我' : 'Agent 记录'}
            </span>
          </>
        }
        content={displayCaptureText
          ? <p className="select-text whitespace-pre-wrap break-words">{displayCaptureText}</p>
          : null}
        afterBubble={!!event.originals?.length && (
          <OriginalDownloads
            client={client}
            deviceId={deviceId}
            profileId={event.profile_id}
            originals={event.originals}
            visible={recordsActive}
          />
        )}
        actions={messageActions}
      />
    );
  }

  if (item.kind === 'timeblock') {
    return (
      <ChatMessageRowView
        eventId={item.record.event_id}
        timelineKind="timeblock"
        tone="system"
        avatar={<BetaTimeblockAvatar node={item.record} />}
        metadata={
          <>
            <span className="text-xs font-semibold text-strong">
              {item.record.source.kind === 'scheduler' ? '计时服务' : '我 · 时间块'}
            </span>
            <EventTimestamp timestamp={item.record.occurred_at_ms} now={now} mode={dateMode} />
          </>
        }
        content={<p className="whitespace-pre-wrap break-words">{timeblockText}</p>}
        actions={messageActions}
      />
    );
  }

  if (item.kind === 'summary/1') {
    return (
      <BetaSummaryHistoryRow
        record={item.record}
        api={client.summaries}
        revision={revision}
        now={now}
        dateMode={dateMode}
        onInspect={onInspectSummary}
        onOpenSource={onOpenSource}
        messageActions={messageActions}
      />
    );
  }

  return (
    <BetaExternalSummaryHistoryRow
      record={item.record}
      now={now}
      dateMode={dateMode}
      onOpenSource={onOpenSource}
      messageActions={messageActions}
    />
  );
}
