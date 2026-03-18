import {
  KeyboardEvent,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { Clipboard, Image, Mic, SendHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast-hook';
import { getClipboardService } from '@/lib/services';
import type { ClipboardFailureReason } from '@/lib/services';
import { VoiceInputButton, type VoiceInputButtonHandle } from '@/components/VoiceInputButton';
import type { VoiceMessageInputHandle } from '@/components/VoiceMessageInput';
import { publishVoiceTranscriptSignal } from '@/lib/services/voice-signal.service';
import { log } from '@/lib/logger';
import { normalizeRecognitionText } from '@/lib/voice/recognition-text';

interface NowInputRowProps {
  onSend: (content: string, tags?: string[]) => void | Promise<void>;
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

function getPasteFailureLabel(reason: ClipboardFailureReason): string {
  if (reason === 'permission-denied') return '无权限';
  if (reason === 'not-focused') return '未激活';
  if (reason === 'insecure-context' || reason === 'not-supported') return '不支持';
  return '未粘贴';
}

export const NowInputRow = forwardRef<VoiceMessageInputHandle, NowInputRowProps>(function NowInputRow({
  onSend,
  placeholder = '记录当下的事实...',
}, ref) {
  const [value, setValue] = useState('');
  const [pasteFeedback, setPasteFeedback] = useState<'idle' | 'success' | 'error'>('idle');
  const [attachmentFeedback, setAttachmentFeedback] = useState<'idle' | 'pending'>('idle');
  const [pasteFailureLabel, setPasteFailureLabel] = useState('未粘贴');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const voiceButtonRef = useRef<VoiceInputButtonHandle | null>(null);
  const pasteFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attachmentFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    if (attachmentFeedbackTimerRef.current) {
      clearTimeout(attachmentFeedbackTimerRef.current);
      attachmentFeedbackTimerRef.current = null;
    }
  }, []);

  const submitInput = useCallback(async () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    const saved = value;
    setValue('');
    try {
      await onSend(trimmed);
    } catch (error) {
      setValue(saved);
      log.error(`[NowInputRow] send failed: ${error instanceof Error ? error.message : String(error)}`);
      toast({ title: '发送失败', description: '请检查网络连接后重试', variant: 'destructive' });
    }
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
      log.warn(`[clipboard] readText failed: ${result.error instanceof Error ? result.error.message : String(result.error)} ${JSON.stringify({ ...getClipboardDebugSnapshot(), reason: result.reason })}`);
      setPasteFailureLabel(getPasteFailureLabel(result.reason));
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

  const handleVoiceResult = useCallback((text: string) => {
    const normalized = normalizeRecognitionText(text.trim());
    if (!normalized) return;

    void publishVoiceTranscriptSignal({ text: normalized }, {
      source: 'frontend:now-input-row',
    }).catch((publishError) => {
      log.warn(`[new-now-input][voice-signal] ${publishError instanceof Error ? publishError.message : String(publishError)}`);
    });

    // 语音输入始终直接发送到事件日志——语音是即时事件，应该立即入库
    onSend(normalized, ['voice']);
  }, [onSend]);

  const handleVoiceError = useCallback((error: string) => {
    log.error(`[new-now-input][voice] ${error}`);
  }, []);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      textareaRef.current?.blur();
      return;
    }
    if (event.key !== 'Enter') return;
    if (!(event.ctrlKey || event.metaKey)) return;
    if (event.altKey || event.shiftKey) return;

    event.preventDefault();
    if (value.trim()) {
      submitInput();
    } else {
      textareaRef.current?.blur();
      voiceButtonRef.current?.start();
    }
  }, [submitInput, value]);

  const handleAttachmentClick = useCallback(() => {
    if (attachmentFeedbackTimerRef.current) {
      clearTimeout(attachmentFeedbackTimerRef.current);
      attachmentFeedbackTimerRef.current = null;
    }

    setAttachmentFeedback('pending');
    attachmentFeedbackTimerRef.current = setTimeout(() => {
      setAttachmentFeedback('idle');
      attachmentFeedbackTimerRef.current = null;
    }, 1500);
  }, []);

  useImperativeHandle(ref, () => ({
    focusText: () => {
      textareaRef.current?.focus();
    },
    startVoiceRecording: () => {
      voiceButtonRef.current?.start();
    },
  }), []);

  return (
    <div className="mb-2 shrink-0 border-t border-[#E7E5E4] bg-[#FAF7F5] dark:border-[#292524] dark:bg-[#0C0A09]" data-testid="new-now-input-row">
      <div className="px-4 py-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleAttachmentClick}
            className={`flex h-9 shrink-0 items-center justify-center rounded-full bg-[#EDECE9] px-2 text-stone-500 dark:bg-[#292524] dark:text-[#A8A29E] ${
              attachmentFeedback === 'pending' ? 'min-w-[56px]' : 'w-9'
            }`}
            aria-label={attachmentFeedback === 'pending' ? '待开发' : '附件'}
            data-testid="new-now-attachment-button"
          >
            {attachmentFeedback === 'pending'
              ? <span className="text-[10px] font-medium leading-none">待开发</span>
              : <Image size={16} />}
          </button>

          <VoiceInputButton
            ref={voiceButtonRef}
            onResult={handleVoiceResult}
            onError={handleVoiceError}
            showWaveform={true}
            showTimer={false}
            showPermissionUnlockButton={false}
            enableShortcut={true}
            size={36}
            waveformColorVar="--brand-accent"
            buttonClassName="shrink-0"
            idleButtonClassName="bg-[#EDECE9] text-stone-500 dark:bg-[#292524] dark:text-[#A8A29E]"
            idleButtonStyle={{ boxShadow: 'none' }}
            icons={{
              idle: <Mic size={16} />,
              recording: <Mic size={16} />,
            }}
            style={{ flexShrink: 0 }}
          />

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
                      {pasteFailureLabel}
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
