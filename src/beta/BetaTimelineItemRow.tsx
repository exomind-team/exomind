import { useMemo, useState } from 'react';
import { Bot } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ChatMessageRowView } from '@/ui/app/components/ChatMessageRowView';
import { EventTimestamp } from '@/ui/app/components/EventTimestamp';
import type { EventDateDisplayMode } from '@/lib/eventlog/format-event-timestamp';
import type { BetaClient, BetaEvent } from './client';
import type { BetaTimelineItem } from './timeblocks-types';
import type { UserRangeSelection } from './user-range-export-client';
import type { BetaMessageExportChoice } from './BetaMessageActions';
import type { SummaryArtifactRecord, SummarySourceRef } from './summary-types';
import { BetaSummaryHistoryRow } from './BetaSummaryHistoryRow';
import { BetaExternalSummaryHistoryRow } from './BetaExternalSummaryHistoryRow';
import { BetaTimeblockAvatar } from './BetaTimeblockAvatar';
import { BetaCaptureMarkdown } from './BetaCaptureMarkdown';
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
  rangeExport?: { selections: readonly UserRangeSelection[]; onToggle: (selection: UserRangeSelection) => void };
  exportMode?: boolean;
  located?: boolean;
}

type TimelineExportChoice = BetaMessageExportChoice;

const TIMELINE_ROW_CLASS = 'group [&>div.flex-col]:w-fit [&>div.min-w-0]:w-fit [&>div.min-w-0]:flex-none';
const TIMELINE_SUMMARY_ROW_CLASS = '[&_[data-testid=new-mobile-system-message-row]>div.min-w-0]:w-fit [&_[data-testid=new-mobile-system-message-row]>div.min-w-0]:flex-none [&_[data-testid=new-mobile-agent-feedback-bubble]]:[overflow-wrap:anywhere]';
const MESSAGE_TAG_CLASS = 'inline-flex max-w-full rounded-full border border-border-subtle bg-transparent px-2 py-0.5 text-[10px] leading-relaxed text-secondary [overflow-wrap:anywhere]';

function MessageTags({ tags, align }: { tags: readonly string[]; align: 'start' | 'end' }) {
  if (!tags.length) return null;
  return (
    <ul
      className={`flex max-w-full flex-wrap gap-1 ${align === 'end' ? 'justify-end' : 'justify-start'}`}
      aria-label="消息标签"
      data-testid="beta-message-tags"
    >
      {tags.map(tag => (
        <li key={tag} className="max-w-full">
          <span className={MESSAGE_TAG_CLASS} title={tag} data-testid="beta-message-tag">{tag}</span>
        </li>
      ))}
    </ul>
  );
}

function timeblockExportChoices(node: Extract<BetaTimelineItem, { kind: 'timeblock' }>['record']): TimelineExportChoice[] {
  if (node.payload.kind !== 'action') {
    return [{ selection: { kind: 'timeblock', block_id: node.payload.block_id }, label: '此时间块' }];
  }
  const action = node.payload.action;
  if (action.kind === 'rotate') {
    return [
      { selection: { kind: 'timeblock', block_id: action.from_block_id }, label: '前一时间块' },
      { selection: { kind: 'timeblock', block_id: action.next.block_id }, label: '后一时间块' },
    ];
  }
  return [{ selection: { kind: 'timeblock', block_id: action.block_id }, label: '此时间块' }];
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
  rangeExport,
  exportMode = false,
  located = false,
}: BetaTimelineItemRowProps) {
  const [messageActionsExpanded, setMessageActionsExpanded] = useState(false);
  const capture = item.kind === 'capture' ? item.record : null;
  const timeblock = item.kind === 'timeblock' ? item.record : null;
  const captureText = capture?.text;
  const displayCaptureText = useMemo(
    () => captureText ? stripBetaMessageReferencesForDisplay(captureText) : '',
    [captureText],
  );
  const hasCaptureReferences = !!captureText && displayCaptureText !== captureText;
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
  const exportChoices: TimelineExportChoice[] = !rangeExport ? [] : capture
    ? [{ selection: { kind: 'event', event_id: capture.event_id }, label: '此消息' }]
    : timeblock ? timeblockExportChoices(timeblock) : [];
  const messageActions = (
    <BetaMessageActions
      content={actionContent}
      profileId={item.record.profile_id}
      eventId={item.record.event_id}
      align={capture?.author_kind === 'human' ? 'end' : 'start'}
      onQuote={canQuote ? onQuote : undefined}
      onCorrect={capture && onCorrect ? () => onCorrect(capture) : undefined}
      referenceLabel={referenceLabel}
      referenceMetadata={referenceMetadata}
      exportChoices={exportChoices}
      selectedExportSelections={rangeExport?.selections}
      onToggleExportSelection={rangeExport?.onToggle}
      exportMode={exportMode}
      expanded={messageActionsExpanded}
      onExpandedChange={setMessageActionsExpanded}
      alwaysVisible={!!capture && !displayCaptureText && !hasCaptureReferences}
    />
  );
  const toggleMessageActions = () => setMessageActionsExpanded(value => !value);
  const captureAfterBubble = capture && (!!capture.tags?.length || !!capture.originals?.length)
    ? <div className={`mt-1 flex max-w-full flex-col gap-1 ${capture.author_kind === 'human' ? 'items-end' : 'items-start'}`}>
      <MessageTags tags={capture.tags ?? []} align={capture.author_kind === 'human' ? 'end' : 'start'} />
      {!!capture.originals?.length && (
        <OriginalDownloads
          client={client}
          deviceId={deviceId}
          profileId={capture.profile_id}
          originals={capture.originals}
          visible={recordsActive}
        />
      )}
    </div>
    : undefined;

  if (item.kind === 'capture') {
    const event = item.record;
    return (
      <ChatMessageRowView
        eventId={event.event_id}
        timelineKind="capture"
        tone={event.author_kind === 'human' ? 'user' : 'agent-feedback'}
        className={TIMELINE_ROW_CLASS}
        onBubbleBlankClick={toggleMessageActions}
        located={located}
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
        content={displayCaptureText || hasCaptureReferences ? (
          <div className="min-w-0 max-w-full space-y-2">
            {displayCaptureText ? <BetaCaptureMarkdown content={displayCaptureText} /> : null}
            <BetaMessageReferenceLinks value={event.text} onOpen={onOpenReference} sourceLabel={sourceLabel} />
          </div>
        ) : null}
        afterBubble={captureAfterBubble}
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
        className={TIMELINE_ROW_CLASS}
        onBubbleBlankClick={toggleMessageActions}
        located={located}
        avatar={<BetaTimeblockAvatar node={item.record} />}
        metadata={
          <>
            <span className="text-xs font-semibold text-strong">
              {item.record.source.kind === 'scheduler' ? '计时服务' : '我 · 时间块'}
            </span>
            <EventTimestamp timestamp={item.record.occurred_at_ms} now={now} mode={dateMode} />
          </>
        }
        content={<p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{timeblockText}</p>}
        actions={messageActions}
      />
    );
  }

  if (item.kind === 'summary/1') {
    return (
      <div className={`min-w-0 max-w-full ${TIMELINE_SUMMARY_ROW_CLASS}`}>
      <BetaSummaryHistoryRow
          record={item.record}
          api={client.summaries}
          revision={revision}
          now={now}
          dateMode={dateMode}
          onInspect={onInspectSummary}
          onOpenSource={onOpenSource}
          messageActions={messageActions}
          onBubbleBlankClick={toggleMessageActions}
          located={located}
        />
      </div>
    );
  }

  return (
    <div className={`min-w-0 max-w-full ${TIMELINE_SUMMARY_ROW_CLASS}`}>
      <BetaExternalSummaryHistoryRow
        record={item.record}
        now={now}
        dateMode={dateMode}
        onOpenSource={onOpenSource}
        messageActions={messageActions}
        onBubbleBlankClick={toggleMessageActions}
        located={located}
      />
    </div>
  );
}
