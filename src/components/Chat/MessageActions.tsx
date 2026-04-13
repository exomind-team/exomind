/**
 * MessageActions - 消息操作按钮行
 *
 * GH#68: 消息复制功能
 * 每条消息气泡下方显示复制/引用按钮
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { Copy, Check, Link2, Quote, X } from 'lucide-react';
import { toast } from '@/components/ui/toast-hook';
import { getClipboardService } from '@/lib/services';
import type { ClipboardFailureReason } from '@/lib/services';
import { log } from '@/lib/logger';

interface MessageActionsProps {
  content: string;
  align: 'start' | 'end';
  permalink?: string;
  onQuote?: () => void;
  features?: {
    permalink?: boolean;
    quote?: boolean;
  };
}

function getCopyFailureLabel(reason: ClipboardFailureReason): string {
  if (reason === 'permission-denied') return '无权限';
  if (reason === 'not-focused') return '未激活';
  if (reason === 'insecure-context' || reason === 'not-supported') return '不支持';
  return '未复制';
}

type ClipboardActionKind = 'content' | 'permalink';
type ClipboardFeedbackState =
  | { kind: ClipboardActionKind; status: 'success' }
  | { kind: ClipboardActionKind; status: 'error'; label: string }
  | null;

export function MessageActions({ content, align, permalink, onQuote, features }: MessageActionsProps) {
  const [feedback, setFeedback] = useState<ClipboardFeedbackState>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const permalinkEnabled = features?.permalink === true && typeof permalink === 'string' && permalink.length > 0;
  const quoteEnabled = features?.quote === true && typeof onQuote === 'function';

  useEffect(() => () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
  }, []);

  const handleCopy = useCallback(async (kind: ClipboardActionKind, value: string) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }

    const result = await getClipboardService().writeText(value);
    if (!result.ok) {
      setFeedback({
        kind,
        status: 'error',
        label: getCopyFailureLabel(result.reason),
      });
      timerRef.current = setTimeout(() => {
        setFeedback(null);
      }, 1500);
      log.error(`[MessageActions] clipboard.writeText failed: ${result.error instanceof Error ? result.error.message : String(result.error)} ${JSON.stringify({ kind, reason: result.reason })}`);
      toast({ title: result.title, description: result.description, variant: 'destructive' });
      return;
    }

    setFeedback({ kind, status: 'success' });
    timerRef.current = setTimeout(() => setFeedback(null), 1500);
  }, []);

  if (!content?.trim()) return null;

  const renderClipboardButton = (
    kind: ClipboardActionKind,
    defaultLabel: string,
    successLabel: string,
    errorFallbackLabel: string,
    icon: JSX.Element,
    value: string,
    testId: string,
  ) => {
    const isActive = feedback?.kind === kind;
    const isSuccess = isActive && feedback?.status === 'success';
    const isError = isActive && feedback?.status === 'error';
    const label = isSuccess
      ? successLabel
      : isError
        ? (feedback.label || errorFallbackLabel)
        : defaultLabel;
    const buttonIcon = isError
      ? <X className="h-3.5 w-3.5" />
      : isSuccess
        ? <Check className="h-3.5 w-3.5" />
        : icon;

    return (
      <button
        data-testid={testId}
        onClick={() => {
          void handleCopy(kind, value);
        }}
        className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] hover:bg-stone-100 dark:hover:bg-stone-800 ${
          isError ? 'text-red-500 dark:text-red-400' : 'text-[#C8C0BA]'
        }`}
      >
        {buttonIcon}
        {label}
      </button>
    );
  };

  return (
    <div
      data-testid="msg-actions-row"
      className={`flex items-center gap-1 pt-0.5 ${align === 'start' ? 'justify-start pl-1' : 'justify-end pr-1'}`}
    >
      {renderClipboardButton('content', '复制', '已复制', '未复制', <Copy className="h-3.5 w-3.5" />, content, 'msg-copy-btn')}
      {permalinkEnabled
        ? renderClipboardButton('permalink', '链接', '已复制链接', '未链接', <Link2 className="h-3.5 w-3.5" />, permalink, 'msg-link-btn')
        : null}
      {quoteEnabled ? (
        <button
          data-testid="msg-quote-btn"
          type="button"
          onClick={onQuote}
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-[#C8C0BA] hover:bg-stone-100 dark:hover:bg-stone-800"
        >
          <Quote className="h-3.5 w-3.5" />
          引用
        </button>
      ) : null}
    </div>
  );
}
