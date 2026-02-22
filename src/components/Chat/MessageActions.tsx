/**
 * MessageActions - 消息操作按钮行
 *
 * GH#68: 消息复制功能
 * 每条消息气泡下方显示复制/引用按钮
 */

import { useState, useCallback, useRef } from 'react';
import { Copy, Check, Quote } from 'lucide-react';
import { toast } from '@/components/ui/toast-hook';

interface MessageActionsProps {
  content: string;
  align: 'start' | 'end';
}

export function MessageActions({ content, align }: MessageActionsProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      timerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('[MessageActions] clipboard.writeText failed:', err);
      toast({ title: '复制失败，请重试', variant: 'destructive' });
    }
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
        className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-[#C8C0BA] hover:bg-stone-100 dark:hover:bg-stone-800"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? '已复制' : '复制'}
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
