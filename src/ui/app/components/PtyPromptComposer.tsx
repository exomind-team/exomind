import { useCallback, useRef, useState } from 'react';
import { Loader2, SendHorizontal } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { sendPtyTextInput, type PtyInputTarget } from './pty-input';

export interface PtyPromptComposerProps {
  target: PtyInputTarget;
  placeholder?: string;
  disabled?: boolean;
  compact?: boolean;
  className?: string;
}

function appendTerminalEnter(text: string): string {
  return text.endsWith('\r') ? text : `${text}\r`;
}

export function PtyPromptComposer({
  target,
  placeholder = '本地草稿输入，Enter 发送到终端，Shift+Enter 换行',
  disabled = false,
  compact = false,
  className,
}: PtyPromptComposerProps) {
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const handleSubmit = useCallback(async () => {
    if (disabled || isSending || !draft.trim()) {
      return;
    }

    const payload = appendTerminalEnter(draft);

    setIsSending(true);
    setErrorMessage('');

    try {
      const response = await sendPtyTextInput(target, payload);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      setDraft('');
      textareaRef.current?.focus();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(`发送到终端失败: ${message}`);
    } finally {
      setIsSending(false);
    }
  }, [disabled, draft, isSending, target]);

  return (
    <div
      data-testid="pty-prompt-composer"
      className={[
        'border-t border-[#292524] bg-[#120F0E]',
        compact ? 'px-2 py-1.5' : 'px-4 py-3',
        className ?? '',
      ].filter(Boolean).join(' ')}
    >
      <div className={compact ? 'flex items-end gap-2' : 'flex items-end gap-3'}>
        <Textarea
          ref={textareaRef}
          data-testid="pty-prompt-input"
          value={draft}
          disabled={disabled || isSending}
          rows={compact ? 1 : 2}
          placeholder={placeholder}
          onChange={(event) => {
            setDraft(event.target.value);
            if (errorMessage) {
              setErrorMessage('');
            }
          }}
          onKeyDown={(event) => {
            const nativeEvent = event.nativeEvent as KeyboardEvent & { isComposing?: boolean; keyCode?: number };
            if (nativeEvent.isComposing || nativeEvent.keyCode === 229) {
              return;
            }

            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void handleSubmit();
            }
          }}
          className={[
            'min-h-0 flex-1 resize-none border-[#3F3A37] bg-[#1C1917] text-[#FAFAF9] placeholder:text-[#78716C]',
            compact ? 'max-h-24 text-[11px] leading-5' : 'max-h-32 text-xs leading-5',
          ].join(' ')}
        />
        <button
          type="button"
          data-testid="pty-prompt-send"
          disabled={disabled || isSending || !draft.trim()}
          onClick={() => {
            void handleSubmit();
          }}
          className={[
            'inline-flex shrink-0 items-center justify-center rounded-md bg-[#0D9488] text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50',
            compact ? 'h-8 w-8' : 'h-9 w-9',
          ].join(' ')}
          aria-label="发送到终端"
          title="发送到终端"
        >
          {isSending ? <Loader2 size={compact ? 12 : 14} className="animate-spin" /> : <SendHorizontal size={compact ? 12 : 14} />}
        </button>
      </div>
      {errorMessage ? (
        <p
          data-testid="pty-prompt-error"
          className={compact ? 'mt-1 text-[10px] text-[#FCA5A5]' : 'mt-2 text-[11px] text-[#FCA5A5]'}
        >
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
