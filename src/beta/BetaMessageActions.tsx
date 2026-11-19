import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, Copy, Link2, MoreHorizontal, PencilLine, Quote, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { writeBetaMessageClipboard } from './beta-message-clipboard';
import { MAX_BETA_MESSAGE_LOCATE_PAGES } from './beta-message-locator';
import {
  buildBetaMessageReferenceUri,
  extractBetaMessageReferences,
  type BetaMessageReference,
  type BetaMessageReferenceIdentity,
  type BetaMessageReferenceSource,
} from './message-references';

type ClipboardAction = 'body' | 'link';
type ClipboardFeedback =
  | { action: ClipboardAction; state: 'pending'; profileId: string; eventId: string; content: string }
  | { action: ClipboardAction; state: 'success'; profileId: string; eventId: string; content: string }
  | { action: ClipboardAction; state: 'error'; profileId: string; eventId: string; content: string }
  | null;

const CLIPBOARD_FEEDBACK_MS = 2000;
const ACTION_BUTTON_CLASS = 'min-h-9 [@media(pointer:coarse)]:min-h-11 touch-manipulation px-3';
const ACTION_TRIGGER_CLASS = 'h-8 w-8 min-h-8 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:pointer-events-auto [@media(pointer:coarse)]:opacity-100';

function OnDemandExplanation({ label, children }: { label: string; children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  return (
    <div className="space-y-1">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="min-h-8 [@media(pointer:coarse)]:min-h-11 touch-manipulation px-2 text-xs"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded(value => !value)}
      >
        <span>{label}</span>
        <ChevronDown size={13} aria-hidden="true" className={expanded ? 'rotate-180' : ''} />
      </Button>
      <div id={contentId} hidden={!expanded} className="px-2 text-[10px] leading-relaxed text-muted">{children}</div>
    </div>
  );
}

export interface BetaMessageActionsProps {
  content: string;
  profileId: string;
  eventId: string;
  align: 'start' | 'end';
  onQuote?: (source: BetaMessageReferenceSource) => void;
  referenceLabel?: string;
  referenceMetadata?: string;
  onCorrect?: () => void;
  writeClipboardText?: (value: string) => void | Promise<void>;
}

function feedbackText(feedback: ClipboardFeedback): string {
  if (!feedback) return '';
  if (feedback.state === 'pending') {
    return feedback.action === 'body' ? '正在复制消息正文' : '正在复制外心档案内定位链接';
  }
  if (feedback.state === 'success') {
    return feedback.action === 'body' ? '已复制消息正文' : '已复制外心档案内定位链接';
  }
  return feedback.action === 'body'
    ? '复制消息正文失败；请检查剪贴板权限后重试'
    : '复制外心档案内定位链接失败；请检查剪贴板权限后重试';
}

function referenceKey(reference: BetaMessageReferenceIdentity): string {
  return reference.profileId + ':' + reference.eventId;
}

function MessageReferenceSummary({
  reference,
  sourceLabel,
}: {
  reference: BetaMessageReference;
  sourceLabel?: (reference: BetaMessageReference) => string | undefined;
}) {
  const label = reference.label || '消息引用';
  const humanSource = sourceLabel?.(reference);
  return (
    <div className="min-w-0 flex-1">
      <div className="text-[10px] font-semibold text-brand-accent">引用</div>
      <div className="truncate text-xs font-medium text-strong">{label}</div>
      {humanSource ? <div className="truncate text-[10px] text-muted">来自 {humanSource}</div> : null}
      {reference.metadata ? <div className="truncate text-[10px] text-secondary">引用元数据：{reference.metadata}</div> : null}
      {reference.excerpt ? <div className="truncate text-[10px] text-secondary">{reference.excerpt}</div> : null}
    </div>
  );
}

export function BetaMessageActions({
  content,
  profileId,
  eventId,
  align,
  onQuote,
  referenceLabel,
  referenceMetadata,
  onCorrect,
  writeClipboardText = writeBetaMessageClipboard,
}: BetaMessageActionsProps) {
  const [feedback, setFeedback] = useState<ClipboardFeedback>(null);
  const [expanded, setExpanded] = useState(false);
  const requestSequence = useRef(0);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const trigger = useRef<HTMLButtonElement>(null);
  const actionsId = useId();
  const scope = useRef({ profileId, eventId, content, writeClipboardText });
  scope.current = { profileId, eventId, content, writeClipboardText };
  const alignmentClass = align === 'start' ? 'justify-start pl-1' : 'justify-end pr-1';
  let referenceUri: string | null = null;
  try {
    referenceUri = buildBetaMessageReferenceUri({ profileId, eventId });
  } catch {
    referenceUri = null;
  }

  useEffect(() => {
    requestSequence.current += 1;
    setFeedback(null);
    setExpanded(false);
    clearTimeout(feedbackTimer.current);
    return () => {
      requestSequence.current += 1;
      clearTimeout(feedbackTimer.current);
    };
  }, [profileId, eventId, content, writeClipboardText]);

  async function copy(action: ClipboardAction, value: string): Promise<void> {
    const sequence = ++requestSequence.current;
    const requestScope = { profileId, eventId, content, writeClipboardText };
    const isCurrent = () => sequence === requestSequence.current
      && scope.current.profileId === requestScope.profileId
      && scope.current.eventId === requestScope.eventId
      && scope.current.content === requestScope.content
      && scope.current.writeClipboardText === requestScope.writeClipboardText;
    clearTimeout(feedbackTimer.current);
    setFeedback({ action, state: 'pending', ...requestScope });

    try {
      await writeClipboardText(value);
      if (!isCurrent()) return;
      setFeedback({ action, state: 'success', ...requestScope });
    } catch {
      if (!isCurrent()) return;
      setFeedback({ action, state: 'error', ...requestScope });
    }

    feedbackTimer.current = setTimeout(() => {
      if (isCurrent()) setFeedback(null);
    }, CLIPBOARD_FEEDBACK_MS);
  }

  const visibleFeedback = feedback
    && feedback.profileId === profileId
    && feedback.eventId === eventId
    && feedback.content === content
    ? feedback
    : null;
  const feedbackMessage = feedbackText(visibleFeedback);
  return (
    <div
      className={'relative flex flex-wrap items-center gap-1 ' + alignmentClass}
      data-testid="beta-message-actions"
      onKeyDown={event => {
        if (event.key === 'Escape' && expanded) {
          event.stopPropagation();
          setExpanded(false);
          trigger.current?.focus();
        }
      }}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={'absolute -top-2 right-0 z-10 rounded-full ' + ACTION_TRIGGER_CLASS}
        aria-label="更多消息操作"
        aria-expanded={expanded}
        aria-controls={actionsId}
        onClick={() => setExpanded(value => !value)}
        ref={trigger}
        data-testid="beta-message-actions-toggle"
      >
        <MoreHorizontal aria-hidden="true" />
      </Button>
      <div id={actionsId} hidden={!expanded} className="flex flex-wrap items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          className={ACTION_BUTTON_CLASS + ' focus-visible:ring-1'}
          aria-label="复制消息正文"
          disabled={content.trim().length === 0}
          onClick={() => { void copy('body', content); }}
          data-testid="beta-message-copy-body"
        >
          <Copy aria-hidden="true" />
          <span>复制正文</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          className={ACTION_BUTTON_CLASS + ' focus-visible:ring-1'}
          aria-label="复制外心档案内定位链接"
          disabled={!referenceUri}
          onClick={() => { if (referenceUri) void copy('link', referenceUri); }}
          data-testid="beta-message-copy-link"
        >
          <Link2 aria-hidden="true" />
          <span>复制档案内链接</span>
        </Button>
        {onQuote && referenceUri && (content.trim().length > 0 || referenceLabel?.trim() || referenceMetadata?.trim()) ? (
          <Button
            type="button"
            variant="ghost"
            className={ACTION_BUTTON_CLASS + ' focus-visible:ring-1'}
            aria-label="引用消息"
            onClick={() => {
              setExpanded(false);
              onQuote({
                profileId,
                eventId,
                text: content,
                ...(referenceLabel?.trim() ? { label: referenceLabel.trim() } : {}),
                ...(referenceMetadata?.trim() ? { metadata: referenceMetadata.trim() } : {}),
              });
            }}
            data-testid="beta-message-quote"
          >
            <Quote aria-hidden="true" />
            <span>引用</span>
          </Button>
        ) : null}
        {onCorrect ? (
          <Button
            type="button"
            variant="ghost"
            className={ACTION_BUTTON_CLASS + ' focus-visible:ring-1'}
            aria-label="查看更正与原文"
            onClick={() => { setExpanded(false); onCorrect(); }}
            data-testid="beta-message-correction"
          >
            <PencilLine aria-hidden="true" />
            <span>更正与原文</span>
          </Button>
        ) : null}
      </div>
      {visibleFeedback ? (
        <span
          className="basis-full px-2 text-xs text-muted"
          role={visibleFeedback.state === 'error' ? 'alert' : 'status'}
          aria-live={visibleFeedback.state === 'error' ? 'assertive' : 'polite'}
          aria-atomic="true"
          data-testid="beta-message-action-feedback"
        >
          {feedbackMessage}
        </span>
      ) : null}
    </div>
  );
}

export interface BetaMessageReferenceDraftProps {
  value: string;
  onOpen: (reference: BetaMessageReferenceIdentity) => void;
  onRemove: (reference: BetaMessageReferenceIdentity) => void;
  sourceLabel?: (reference: BetaMessageReference) => string | undefined;
}

export function BetaMessageReferenceDraft({
  value,
  onOpen,
  onRemove,
  sourceLabel,
}: BetaMessageReferenceDraftProps) {
  const references = useMemo(() => extractBetaMessageReferences(value), [value]);
  if (references.length === 0) return null;

  return (
    <section
      className="mb-2 flex flex-col gap-2"
      aria-label="草稿中的外心档案内引用"
      data-testid="beta-message-reference-draft"
    >
      <OnDemandExplanation label="档案内引用如何保存">
        引用以可见 Markdown 行保存在记录正文中，只用于外心档案内定位；移除引用只改当前草稿。
      </OnDemandExplanation>
      {references.map(reference => {
        const label = reference.label || '消息引用';
        return (
          <div
            key={referenceKey(reference)}
            className="flex min-w-0 flex-wrap items-center gap-2 rounded-2xl border border-card bg-card px-3 py-2"
            data-testid="beta-message-reference-item"
          >
            <MessageReferenceSummary reference={reference} sourceLabel={sourceLabel} />
            <Button
              type="button"
              variant="ghost"
              className={ACTION_BUTTON_CLASS}
              aria-label={'在外心档案内回看原文：' + label}
              onClick={() => onOpen({ profileId: reference.profileId, eventId: reference.eventId })}
              data-testid="beta-message-reference-open"
            >
              档案内回看
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="min-h-9 min-w-9 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11 touch-manipulation focus-visible:ring-1"
              aria-label={'从草稿移除引用：' + label}
              onClick={() => onRemove({ profileId: reference.profileId, eventId: reference.eventId })}
              data-testid="beta-message-reference-remove"
            >
              <X aria-hidden="true" />
            </Button>
          </div>
        );
      })}
    </section>
  );
}

export interface BetaMessageReferenceLinksProps {
  value: string;
  onOpen: (reference: BetaMessageReferenceIdentity) => void;
  sourceLabel?: (reference: BetaMessageReference) => string | undefined;
}

export function BetaMessageReferenceLinks({
  value,
  onOpen,
  sourceLabel,
}: BetaMessageReferenceLinksProps) {
  const references = useMemo(() => extractBetaMessageReferences(value), [value]);
  if (references.length === 0) return null;

  return (
    <section
      className="mt-2 flex flex-col gap-2"
      aria-label="消息中的外心档案内引用原文"
      data-testid="beta-message-reference-links"
    >
      <OnDemandExplanation label="档案内引用说明">
        这些链接来自记录正文中的 Markdown 行，只在当前外心档案内定位。
      </OnDemandExplanation>
      {references.map(reference => (
        <div
          key={referenceKey(reference)}
          className="flex min-w-0 flex-wrap items-center gap-2 rounded-2xl border border-card bg-card px-3 py-2"
          data-testid="beta-message-reference-link"
        >
          <MessageReferenceSummary reference={reference} sourceLabel={sourceLabel} />
          <Button
            type="button"
            variant="ghost"
            className={ACTION_BUTTON_CLASS}
            aria-label={'在外心档案内回看原文：' + reference.label}
            onClick={() => onOpen({ profileId: reference.profileId, eventId: reference.eventId })}
            data-testid="beta-message-reference-link-open"
          >
            档案内回看
          </Button>
        </div>
      ))}
    </section>
  );
}

export type BetaMessageLocationNotice =
  | { kind: 'loading' }
  | { kind: 'found'; pagesRead: number; source: 'loaded' | 'event-id' | 'pages'; highwater: number | null }
  | { kind: 'profile-mismatch' }
  | { kind: 'not-found'; pagesRead: number; highwater: number; limitReached: boolean }
  | { kind: 'failed'; message: string }
  | { kind: 'cancelled' };

export interface BetaMessageLocationBoundaryProps {
  state: BetaMessageLocationNotice | null;
  children?: ReactNode;
  onCancel?: () => void;
  onRetry?: () => void;
  onLoadOlderAndRetry?: () => void;
  onReturnToReadingPosition: () => void;
  onReturnToLatest: () => void;
}

export function BetaMessageLocationBoundary({
  state,
  children,
  onCancel,
  onRetry,
  onLoadOlderAndRetry,
  onReturnToReadingPosition,
  onReturnToLatest,
}: BetaMessageLocationBoundaryProps) {
  if (!state) return null;

  const renderReturnActions = () => (
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" className={ACTION_BUTTON_CLASS} onClick={onReturnToReadingPosition}>
        回到原阅读位置
      </Button>
      <Button type="button" variant="ghost" className={ACTION_BUTTON_CLASS} onClick={onReturnToLatest}>
        回到最新记录
      </Button>
    </div>
  );

  if (state.kind === 'found') {
    const range = state.source === 'pages'
      ? `本次在固定历史快照 highwater ${state.highwater ?? '未知'} 下读取了 ${state.pagesRead} 页。`
      : state.source === 'event-id'
        ? '按当前外心档案内的事件身份精确读取，未翻页。'
        : '目标已在本次页面已经读取的记录中，无需额外翻页。';
    return (
      <section
        className="space-y-2 rounded-xl border border-card bg-card px-4 py-3"
        role="region"
        aria-label="外心档案内引用定位结果"
        data-testid="beta-message-location-boundary"
      >
        <p className="text-sm font-medium text-strong">已在当前外心档案内找到引用原文</p>
        <p className="text-xs text-secondary">原来的阅读位置仍可恢复。</p>
        <OnDemandExplanation label="查看查找范围">{range}</OnDemandExplanation>
        {children ? <div className="rounded-xl border border-card p-3">{children}</div> : null}
        {renderReturnActions()}
      </section>
    );
  }

  if (state.kind === 'loading') {
    return (
      <section
        className="flex flex-wrap items-center gap-2 rounded-xl border border-card bg-card px-4 py-3"
        role="status"
        aria-live="polite"
        data-testid="beta-message-location-boundary"
      >
        <span className="text-sm text-secondary">正在定位引用原文…</span>
        <Button type="button" variant="ghost" className={ACTION_BUTTON_CLASS} onClick={onCancel} disabled={!onCancel}>取消定位</Button>
      </section>
    );
  }

  if (state.kind === 'profile-mismatch') {
    return (
      <section
        className="space-y-2 rounded-xl border border-card bg-card px-4 py-3"
        role="status"
        aria-live="polite"
        data-testid="beta-message-location-boundary"
      >
        <p className="text-sm text-secondary">此引用属于另一个外心档案。请切换到相应档案后重试；当前草稿保持不变。</p>
        {renderReturnActions()}
      </section>
    );
  }

  if (state.kind === 'not-found') {
    const details = `本次按固定历史快照 highwater ${state.highwater} 查找 ${state.pagesRead} 页。`
      + (state.limitReached
        ? `单次自动查找最多 ${MAX_BETA_MESSAGE_LOCATE_PAGES} 页；加载更早记录后重试会先检查新加载的记录。`
        : '已到当前快照的最早记录。');
    return (
      <section className="space-y-2 rounded-xl border border-card bg-card px-4 py-3" role="status" aria-live="polite" data-testid="beta-message-location-boundary">
        <p className="text-sm text-secondary">
          {state.limitReached
            ? `当前档案中暂未找到引用原文。已检查 ${state.pagesRead} 页，它可能还在更早的记录中；草稿和阅读位置已保留。`
            : `当前档案中暂未找到引用原文。已检查 ${state.pagesRead} 页；草稿和阅读位置已保留。`}
        </p>
        <OnDemandExplanation label="查看查找范围">{details}</OnDemandExplanation>
        <div className="flex flex-wrap gap-2">
          {state.limitReached&&onLoadOlderAndRetry&&<Button type="button" variant="outline" className={ACTION_BUTTON_CLASS} onClick={onLoadOlderAndRetry}>加载更早记录并重试</Button>}
          <Button type="button" variant="outline" className={ACTION_BUTTON_CLASS} onClick={onRetry} disabled={!onRetry}>重试定位</Button>
          {renderReturnActions()}
        </div>
      </section>
    );
  }

  if (state.kind === 'failed') {
    return (
      <section
        className="space-y-2 rounded-xl border border-card bg-card px-4 py-3"
        role="alert"
        aria-live="assertive"
        data-testid="beta-message-location-boundary"
      >
        <p className="text-sm text-destructive">{state.message}</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" className={ACTION_BUTTON_CLASS} onClick={onRetry} disabled={!onRetry}>重试定位</Button>
          {renderReturnActions()}
        </div>
      </section>
    );
  }

  return (
    <section
      className="space-y-2 rounded-xl border border-card bg-card px-4 py-3"
      role="status"
      aria-live="polite"
      data-testid="beta-message-location-boundary"
    >
      <p className="text-sm text-secondary">已取消定位；当前草稿和阅读位置已保留。</p>
      {renderReturnActions()}
    </section>
  );
}
