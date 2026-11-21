import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { KeyRound, X } from 'lucide-react';
import {
  captureShortcutAccelerator,
  shortcutModifierHint,
  type ShortcutCapturePolicy,
} from '@/config/shortcut-accelerator';
import { SettingRow } from '@/ui/app/components/settings-shared';

export type ShortcutFeedback = {
  tone: 'success' | 'error' | 'info';
  message: string;
} | null;

type UseShortcutCaptureOptions = {
  policy?: ShortcutCapturePolicy;
  onCommit: (accelerator: string) => Promise<void> | void;
  onClear: () => Promise<void> | void;
  successMessage?: (accelerator: string) => string;
  clearSuccessMessage?: string;
};

export function useShortcutCapture({
  policy,
  onCommit,
  onClear,
  successMessage,
  clearSuccessMessage = '已清除：未设置快捷键。',
}: UseShortcutCaptureOptions) {
  const [capturing, setCapturing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<ShortcutFeedback>(null);
  const captureButtonRef = useRef<HTMLButtonElement | null>(null);
  const savingRef = useRef(false);
  const modifierHint = shortcutModifierHint(policy);

  useEffect(() => {
    if (capturing) {
      captureButtonRef.current?.focus();
    }
  }, [capturing]);

  const beginCapture = () => {
    setFeedback(null);
    setCapturing(true);
  };

  const cancelCapture = () => {
    setCapturing(false);
    setFeedback({ tone: 'info', message: '已取消。' });
  };

  const blurCapture = () => {
    if (!savingRef.current) {
      setCapturing(false);
    }
  };

  const run = async (action: () => Promise<void> | void, message: string) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setFeedback(null);
    try {
      await action();
      setCapturing(false);
      setFeedback({ tone: 'success', message });
    } catch (error) {
      setCapturing(false);
      const message = error instanceof Error ? error.message : '保存快捷键失败。';
      setFeedback({
        tone: 'error',
        message: message.includes('重试') ? message : `${message} 可重新点击后重试。`,
      });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const clear = () => {
    void run(onClear, clearSuccessMessage);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (savingRef.current) return;

    const result = captureShortcutAccelerator(event, policy);
    switch (result.kind) {
      case 'cancelled':
        cancelCapture();
        break;
      case 'cleared':
        void run(onClear, clearSuccessMessage);
        break;
      case 'modifier-only':
        break;
      case 'ignored':
        setFeedback({
          tone: 'error',
          message: `不支持的按键。请使用 ${modifierHint} 加字母、数字、F1-F12 或空格。`,
        });
        break;
      case 'lone-key':
        setFeedback({ tone: 'error', message: `需要至少一个修饰键（${modifierHint}）。` });
        break;
      case 'meta-reserved':
        setFeedback({ tone: 'error', message: '不支持 Windows / Super 键（被系统保留）。' });
        break;
      case 'reserved':
        setFeedback({ tone: 'error', message: result.message });
        break;
      case 'captured':
        void run(
          () => onCommit(result.accelerator),
          successMessage?.(result.accelerator) ?? `已设置：${result.accelerator}`,
        );
        break;
    }
  };

  return {
    capturing,
    saving,
    feedback,
    beginCapture,
    cancelCapture,
    blurCapture,
    clear,
    handleKeyDown,
    captureButtonRef,
    modifierHint,
  };
}

export function ShortcutCaptureField({
  label,
  description,
  warning,
  value,
  emptyLabel = '未设置',
  captureHint = '按下组合键…',
  testId,
  icon,
  capture,
}: {
  label: string;
  description?: string;
  warning?: string;
  value: string | null;
  emptyLabel?: string;
  captureHint?: string;
  testId?: string;
  icon?: ReactNode;
  capture: ReturnType<typeof useShortcutCapture>;
}) {
  const {
    capturing,
    saving,
    feedback,
    beginCapture,
    cancelCapture,
    blurCapture,
    clear,
    handleKeyDown,
    captureButtonRef,
    modifierHint,
  } = capture;

  return (
    <div>
      <SettingRow
        testId={testId}
        icon={icon ?? <KeyRound className="h-[18px] w-[18px] text-[#78716C]" />}
        label={label}
        onClick={beginCapture}
        right={<span className="text-sm text-[#A8A29E]">{value ?? emptyLabel}</span>}
      />
      {description ? (
        <div className="pb-[14px] pl-[46px] pr-4">
          <span className="text-xs text-[#A8A29E]">{description}</span>
        </div>
      ) : null}
      {warning ? (
        <div
          role="note"
          className="mx-4 mb-3 rounded-xl border border-[#FCA5A5]/60 bg-[#FEF2F2] px-3 py-2 text-xs text-[#B91C1C] dark:border-[#7F1D1D] dark:bg-[#2A1510] dark:text-[#FCA5A5]"
        >
          {warning}
        </div>
      ) : null}
      {capturing ? (
        <div className="px-4 pb-3">
          <div className="flex items-center gap-2 rounded-xl border border-[#F0ECE8] bg-[#FAF7F5] p-2 dark:border-[#FFFFFF15] dark:bg-[#1C1917]">
            <button
              ref={captureButtonRef}
              type="button"
              autoFocus
              disabled={saving}
              onKeyDown={handleKeyDown}
              onBlur={blurCapture}
              aria-label={`正在捕获快捷键：${label}；按下 ${modifierHint} 加字母、数字、F1-F12 或空格；Esc 取消；Backspace 清除`}
              className="min-w-0 flex-1 rounded-lg border border-[#E7E5E4] bg-white px-3 py-2 text-left text-sm text-[#1C1917] outline-none focus:border-[#C75B3A] focus:ring-2 focus:ring-[#C75B3A]/30 dark:border-[#292524] dark:bg-[#292524] dark:text-[#FAFAF9]"
            >
              {captureHint}
            </button>
            <button
              type="button"
              onMouseDown={(event) => {
                event.preventDefault();
                cancelCapture();
              }}
              aria-label="取消捕获"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#E7E5E4] text-[#78716C] hover:bg-[#F5F0ED] dark:border-[#292524] dark:hover:bg-[#292524]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}
      {value ? (
        <div className="px-4 pb-2">
          <button
            type="button"
            onClick={clear}
            aria-label={`清除${label}`}
            className="text-xs text-[#A8A29E] underline-offset-2 hover:underline"
          >
            清除快捷键
          </button>
        </div>
      ) : null}
      <div role="status" aria-live="polite">
        {feedback ? (
          <p
            className={`px-4 pb-3 text-xs ${
              feedback.tone === 'error'
                ? 'text-[#B91C1C] dark:text-[#FCA5A5]'
                : 'text-[#78716C] dark:text-[#A8A29E]'
            }`}
          >
            {feedback.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
