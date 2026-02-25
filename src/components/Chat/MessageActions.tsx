/**
 * MessageActions - 消息操作按钮行
 *
 * GH#68: 消息复制功能
 * 每条消息气泡下方显示复制/引用按钮
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { Copy, Check, Quote, X } from 'lucide-react';
import { toast } from '@/components/ui/toast-hook';
import { getClipboardService } from '@/lib/services';
import type { ClipboardFailureReason } from '@/lib/services';

interface MessageActionsProps {
  content: string;
  align: 'start' | 'end';
}

function getCopyFailureLabel(reason: ClipboardFailureReason): string {
  if (reason === 'permission-denied') return '无权限';
  if (reason === 'not-focused') return '未激活';
  if (reason === 'insecure-context' || reason === 'not-supported') return '不支持';
  return '未复制';
}

export function MessageActions({ content, align }: MessageActionsProps) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [copyFailureLabel, setCopyFailureLabel] = useState('未复制');
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
  }, []);

  const handleCopy = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }

    const result = await getClipboardService().writeText(content);
    if (!result.ok) {
      setCopied(false);
      setCopyFailureLabel(getCopyFailureLabel(result.reason));
      setCopyFailed(true);
      timerRef.current = setTimeout(() => {
        setCopyFailed(false);
      }, 1500);
      console.error('[MessageActions] clipboard.writeText failed:', result.error, { reason: result.reason });
      toast({ title: result.title, description: result.description, variant: 'destructive' });
      return;
    }

    setCopyFailed(false);
    setCopied(true);
    timerRef.current = setTimeout(() => setCopied(false), 1500);
  }, [content]);

  if (!content?.trim()) return null;

  return (
    <div
      data-testid="msg-actions-row"
      className={`flex items-center gap-1 pt-0.5 ${align === 'start' ? 'justify-start pl-1' : 'justify-end pr-1'}`}
    >
      <button
        data-testid="msg-copy-btn"
        onClick={handleCopy}
        className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] hover:bg-stone-100 dark:hover:bg-stone-800 ${
          copyFailed ? 'text-red-500 dark:text-red-400' : 'text-[#C8C0BA]'
        }`}
      >
        {copyFailed
          ? <X className="h-3.5 w-3.5" />
          : copied
            ? <Check className="h-3.5 w-3.5" />
            : <Copy className="h-3.5 w-3.5" />}
        {copyFailed ? copyFailureLabel : copied ? '已复制' : '复制'}
      </button>
      <button
        data-testid="msg-quote-btn"
        disabled
        className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-[#C8C0BA] opacity-50 cursor-not-allowed"
      >
        <Quote className="h-3.5 w-3.5" />
        引用
      </button>
    </div>
  );
}
