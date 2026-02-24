import {
  KeyboardEvent,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { Clipboard, Image, SendHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast-hook';
import { getClipboardService } from '@/lib/services';
import type { VoiceMessageInputHandle } from '@/components/VoiceMessageInput';

interface NewNowInputRowProps {
  onSend: (content: string) => void;
  placeholder?: string;
}

const getClipboardDebugSnapshot = () => {
  const protocol = typeof window !== 'undefined' ? window.location.protocol : 'unknown';
  const host = typeof window !== 'undefined' ? window.location.host : 'unknown';
  const secure = typeof window !== 'undefined' ? window.isSecureContext : false;
  const hasNavigatorClipboard = typeof navigator !== 'undefined' && !!navigator.clipboard;
  const hasReadText = typeof navigator !== 'undefined' && typeof navigator.clipboard?.readText === 'function';

  return { protocol, host, secure, hasNavigatorClipboard, hasReadText };
};

export const NewNowInputRow = forwardRef<VoiceMessageInputHandle, NewNowInputRowProps>(function NewNowInputRow({
  onSend,
  placeholder = '记录当下的事实...',
}, ref) {
  const [value, setValue] = useState('');
  const [pasteFeedback, setPasteFeedback] = useState<'idle' | 'success' | 'error'>('idle');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pasteFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resizeTextarea = useCallback((target?: HTMLTextAreaElement | null) => {
    const el = target ?? textareaRef.current;
    if (!el) return;

    el.style.height = 'auto';
    const minHeight = 44;
    const maxHeight = 96;
    const nextHeight = Math.max(minHeight, Math.min(el.scrollHeight, maxHeight));
    el.style.height = `${nextHeight}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, []);

  useEffect(() => {
    resizeTextarea();
  }, [value, resizeTextarea]);

  useEffect(() => () => {
    if (pasteFeedbackTimerRef.current) {
      clearTimeout(pasteFeedbackTimerRef.current);
      pasteFeedbackTimerRef.current = null;
    }
  }, []);

  const submitInput = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue('');
  }, [onSend, value]);

  const insertClipboardText = useCallback((text: string) => {
    if (!text) return;
    setValue((prev) => {
      const textarea = textareaRef.current;
      if (textarea) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const next = prev.slice(0, start) + text + prev.slice(end);
        // 延迟设置光标位置到粘贴文本之后
        requestAnimationFrame(() => {
          textarea.selectionStart = textarea.selectionEnd = start + text.length;
          textarea.focus();
        });
        return next;
      }
      return prev + text;
    });
  }, []);

  const handlePasteFromClipboard = useCallback(async () => {
    if (pasteFeedbackTimerRef.current) {
      clearTimeout(pasteFeedbackTimerRef.current);
      pasteFeedbackTimerRef.current = null;
    }

    const result = await getClipboardService().readText();
    if (!result.ok) {
      console.warn('[clipboard] readText failed:', result.error, {
        ...getClipboardDebugSnapshot(),
        reason: result.reason,
      });
      setPasteFeedback('error');
      pasteFeedbackTimerRef.current = setTimeout(() => {
        setPasteFeedback('idle');
        pasteFeedbackTimerRef.current = null;
      }, 1500);
      textareaRef.current?.focus();
      toast({ title: result.title, description: result.description, variant: 'destructive' });
      return;
    }

    setPasteFeedback('success');
    pasteFeedbackTimerRef.current = setTimeout(() => {
      setPasteFeedback('idle');
      pasteFeedbackTimerRef.current = null;
    }, 1500);
    insertClipboardText(result.text);
  }, [insertClipboardText]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      textareaRef.current?.blur();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submitInput();
    }
  }, [submitInput]);

  useImperativeHandle(ref, () => ({
    focusText: () => {
      textareaRef.current?.focus();
    },
    startVoiceRecording: () => {
      // voice recording（语音录制）入口由后续专用按钮接入
    },
  }), []);

  return (
    <div className="mb-2 shrink-0 border-t border-[#E7E5E4] bg-[#FAF7F5] dark:border-[#292524] dark:bg-[#0C0A09]" data-testid="new-now-input-row">
      <div className="px-4 py-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#EDECE9] text-stone-500 dark:bg-[#292524] dark:text-[#A8A29E]"
            aria-label="附件"
            data-testid="new-now-attachment-button"
          >
            <Image size={16} />
          </button>

          <div className="relative flex-1">
            <Textarea
              ref={textareaRef}
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                resizeTextarea(event.target);
              }}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              rows={1}
              className="min-h-[44px] rounded-3xl border-[#E7E5E4] bg-white px-4 py-2 pr-16 text-sm text-stone-700 placeholder:text-stone-400 dark:border-[#292524] dark:bg-[#1C1917] dark:text-[#FAFAF9] dark:placeholder:text-[#57534E]"
              data-testid="new-now-input-textarea"
            />
            <button
              type="button"
              onClick={handlePasteFromClipboard}
              className={`absolute right-[7px] top-1/2 flex h-[30px] min-w-[30px] -translate-y-1/2 items-center justify-center rounded-[15px] px-2 ${
                pasteFeedback === 'error'
                  ? 'text-red-500 dark:text-red-400'
                  : pasteFeedback === 'success'
                    ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300'
                    : 'text-stone-400 dark:text-[#78716C]'
              }`}
              aria-label="剪贴板"
              data-testid="new-now-input-inline-button"
            >
              {pasteFeedback === 'success'
                ? <span className="text-[10px] font-medium leading-none">已粘贴</span>
                : pasteFeedback === 'error'
                  ? (
                    <span className="inline-flex items-center gap-0.5 text-[10px] font-medium leading-none">
                      <X size={10} className="h-2.5 w-2.5" />
                      未粘贴
                    </span>
                  )
                  : <Clipboard size={16} />}
            </button>
          </div>

          <Button
            type="button"
            size="icon"
            onClick={submitInput}
            disabled={!value.trim()}
            className="h-9 w-9 shrink-0 rounded-full bg-[#C75B3A] text-white hover:bg-[#B24D2F] data-[disabled]:bg-[#D1D5DB] data-[disabled]:text-white"
            data-testid="new-now-send-button"
          >
            <SendHorizontal size={16} />
          </Button>
        </div>
      </div>
    </div>
  );
});
