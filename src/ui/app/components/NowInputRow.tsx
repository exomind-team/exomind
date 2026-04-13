import {
  KeyboardEvent,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Clipboard, Image, Mic, SendHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast-hook';
import {
  getVoiceTranscriptSendMode,
  subscribeVoiceTranscriptSendModeChanges,
  type VoiceTranscriptSendMode,
} from '@/config/voice-transcript-send-mode';
import { getClipboardService } from '@/lib/services';
import type { ClipboardFailureReason } from '@/lib/services';
import { VoiceInputButton, type VoiceInputButtonHandle } from '@/components/VoiceInputButton';
import type { VoiceMessageInputHandle } from '@/components/VoiceMessageInput';
import {
  getInputSendMode,
  subscribeInputSendModeChanges,
  shouldSubmitOnEnter,
  type InputSendMode,
} from '@/config/input-send-mode';
import { clearInputDraft, readInputDraft, writeInputDraft } from '@/lib/storage/input-draft-storage';
import { publishVoiceTranscriptSignal } from '@/lib/services/voice-signal.service';
import { log } from '@/lib/logger';
import { normalizeRecognitionText } from '@/lib/voice/recognition-text';
import type { EventRef } from '@/lib/types/event';
import {
  buildEventRefQuoteLine,
  extractEventPermalinksFromContent,
  normalizeEventRefs,
} from '@/lib/eventlog/event-refs';

interface NowInputRowProps {
  onSend: (content: string, tags?: string[], refs?: EventRef[]) => void | Promise<void>;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  draftStorageKey?: string | null;
  draftDebounceMs?: number;
  features?: {
    quote?: boolean;
  };
  quotedRefs?: EventRef[];
  onQuotedRefsChange?: (refs: EventRef[]) => void;
  resolveQuotedRefSummary?: (eventId: string) => string | undefined;
  onOpenQuotedEvent?: (eventId: string) => void;
}

function buildAutoDraftStorageKey(placeholder: string): string {
  const pathname = typeof window !== 'undefined' ? window.location.pathname || '/' : '/';
  const normalizedPlaceholder = placeholder.trim() || 'default';
  return `exomind:draft:now-input:${pathname}:${normalizedPlaceholder}`;
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

function mergeTranscriptText(currentValue: string, transcript: string): string {
  const trimmedCurrent = currentValue.trim();
  if (!trimmedCurrent) return transcript;
  return `${trimmedCurrent} ${transcript}`;
}

function insertTextareaNewline(textarea: HTMLTextAreaElement, onChangeValue: (nextValue: string) => void): void {
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  const nextValue = `${textarea.value.slice(0, start)}\n${textarea.value.slice(end)}`;
  const nextCursor = start + 1;

  onChangeValue(nextValue);
  requestAnimationFrame(() => {
    textarea.selectionStart = nextCursor;
    textarea.selectionEnd = nextCursor;
    textarea.focus();
  });
}

function focusTextarea(textarea: HTMLTextAreaElement | null): void {
  textarea?.focus();
  requestAnimationFrame(() => {
    textarea?.focus();
  });
}

function areEventRefsEqual(left: readonly EventRef[], right: readonly EventRef[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((ref, index) => (
    ref.kind === right[index]?.kind
    && ref.eventId === right[index]?.eventId
    && ref.summary === right[index]?.summary
  ));
}

function insertMissingQuotedRefLines(content: string, refs: readonly EventRef[]): string {
  if (refs.length === 0) {
    return content;
  }

  const existingEventIds = new Set(extractEventPermalinksFromContent(content).map((item) => item.eventId));
  const missingLines = refs
    .filter((ref) => !existingEventIds.has(ref.eventId))
    .map((ref) => buildEventRefQuoteLine(ref));

  if (missingLines.length === 0) {
    return content;
  }

  return content.length > 0 ? `${missingLines.join('\n')}\n${content}` : missingLines.join('\n');
}

function removeQuotedRefLines(content: string, eventIds: readonly string[]): string {
  if (eventIds.length === 0 || content.length === 0) {
    return content;
  }

  const removedIds = new Set(eventIds);
  const filteredLines = content
    .split(/\r?\n/u)
    .filter((line) => !extractEventPermalinksFromContent(line).some((item) => removedIds.has(item.eventId)));
  return filteredLines.join('\n').replace(/^\n+/u, '');
}

function deriveQuotedRefsFromContent(
  content: string,
  currentRefs: readonly EventRef[],
  resolveSummary?: (eventId: string) => string | undefined,
): EventRef[] {
  const currentById = new Map(currentRefs.map((ref) => [ref.eventId, ref]));
  const contentRefs = extractEventPermalinksFromContent(content).map((item) => ({
    kind: 'event' as const,
    eventId: item.eventId,
    summary: currentById.get(item.eventId)?.summary ?? item.label ?? resolveSummary?.(item.eventId),
  }));
  return normalizeEventRefs(contentRefs);
}

export const NowInputRow = forwardRef<VoiceMessageInputHandle, NowInputRowProps>(function NowInputRow({
  onSend,
  onValueChange,
  placeholder = '记录当下的事实...',
  draftStorageKey,
  draftDebounceMs = 300,
  features,
  quotedRefs = [],
  onQuotedRefsChange,
  resolveQuotedRefSummary,
  onOpenQuotedEvent,
}, ref) {
  const effectiveDraftStorageKey = draftStorageKey === null ? null : draftStorageKey ?? buildAutoDraftStorageKey(placeholder);
  const [value, setValue] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [voiceTranscriptSendMode, setVoiceTranscriptSendMode] = useState<VoiceTranscriptSendMode>(() => getVoiceTranscriptSendMode());
  const [inputSendMode, setInputSendMode] = useState<InputSendMode>(() => getInputSendMode());
  const [pasteFeedback, setPasteFeedback] = useState<'idle' | 'success' | 'error'>('idle');
  const [attachmentFeedback, setAttachmentFeedback] = useState<'idle' | 'pending'>('idle');
  const [pasteFailureLabel, setPasteFailureLabel] = useState('未粘贴');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const voiceButtonRef = useRef<VoiceInputButtonHandle | null>(null);
  const pasteFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attachmentFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submittingRef = useRef(false);
  const previousQuotedRefsRef = useRef<EventRef[]>([]);
  const quoteSyncPendingRef = useRef(false);
  const quoteFeatureEnabled = features?.quote === true;
  const normalizedQuotedRefs = useMemo(
    () => quoteFeatureEnabled ? normalizeEventRefs(quotedRefs) : [],
    [quoteFeatureEnabled, quotedRefs],
  );

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

  useEffect(() => {
    onValueChange?.(value);
  }, [onValueChange, value]);

  useEffect(() => {
    if (!quoteFeatureEnabled) {
      quoteSyncPendingRef.current = false;
      return;
    }

    const nextQuotedRefs = deriveQuotedRefsFromContent(value, normalizedQuotedRefs, resolveQuotedRefSummary);
    if (quoteSyncPendingRef.current) {
      if (!areEventRefsEqual(nextQuotedRefs, normalizedQuotedRefs)) {
        return;
      }
      quoteSyncPendingRef.current = false;
    }

    if (!onQuotedRefsChange || areEventRefsEqual(nextQuotedRefs, normalizedQuotedRefs)) {
      return;
    }

    onQuotedRefsChange(nextQuotedRefs);
  }, [normalizedQuotedRefs, onQuotedRefsChange, quoteFeatureEnabled, resolveQuotedRefSummary, value]);

  useEffect(() => subscribeVoiceTranscriptSendModeChanges(setVoiceTranscriptSendMode), []);

  useEffect(() => subscribeInputSendModeChanges(setInputSendMode), []);
  useEffect(() => () => {
    if (pasteFeedbackTimerRef.current) {
      clearTimeout(pasteFeedbackTimerRef.current);
      pasteFeedbackTimerRef.current = null;
    }
    if (attachmentFeedbackTimerRef.current) {
      clearTimeout(attachmentFeedbackTimerRef.current);
      attachmentFeedbackTimerRef.current = null;
    }
    if (draftPersistTimerRef.current) {
      clearTimeout(draftPersistTimerRef.current);
      draftPersistTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!effectiveDraftStorageKey) return;

    const savedDraft = readInputDraft(effectiveDraftStorageKey);
    if (savedDraft !== null) {
      setValue(savedDraft);
    }
  }, [effectiveDraftStorageKey]);

  useEffect(() => {
    if (!effectiveDraftStorageKey) return;

    if (draftPersistTimerRef.current) {
      clearTimeout(draftPersistTimerRef.current);
      draftPersistTimerRef.current = null;
    }

    draftPersistTimerRef.current = setTimeout(() => {
      if (!value.trim()) {
        clearInputDraft(effectiveDraftStorageKey);
      } else {
        writeInputDraft(effectiveDraftStorageKey, value);
      }
      draftPersistTimerRef.current = null;
    }, draftDebounceMs);

    return () => {
      if (draftPersistTimerRef.current) {
        clearTimeout(draftPersistTimerRef.current);
        draftPersistTimerRef.current = null;
      }
    };
  }, [draftDebounceMs, effectiveDraftStorageKey, value]);

  useLayoutEffect(() => {
    if (!quoteFeatureEnabled) {
      previousQuotedRefsRef.current = [];
      quoteSyncPendingRef.current = false;
      return;
    }
    const previousRefs = previousQuotedRefsRef.current;
    const nextIds = new Set(normalizedQuotedRefs.map((ref) => ref.eventId));
    const removedIds = previousRefs
      .filter((ref) => !nextIds.has(ref.eventId))
      .map((ref) => ref.eventId);

    setValue((current) => {
      const withoutRemoved = removeQuotedRefLines(current, removedIds);
      const nextValue = insertMissingQuotedRefLines(withoutRemoved, normalizedQuotedRefs);
      if (nextValue !== current) {
        quoteSyncPendingRef.current = true;
      }
      return nextValue;
    });

    previousQuotedRefsRef.current = normalizedQuotedRefs;
  }, [normalizedQuotedRefs, quoteFeatureEnabled]);

  const submitInput = useCallback(async () => {
    if (submittingRef.current) return;

    const preparedValue = quoteFeatureEnabled ? insertMissingQuotedRefLines(value, normalizedQuotedRefs) : value;
    const trimmed = preparedValue.trim();
    if (!trimmed) return;
    const resolvedRefs = quoteFeatureEnabled
      ? deriveQuotedRefsFromContent(trimmed, normalizedQuotedRefs, resolveQuotedRefSummary)
      : [];
    submittingRef.current = true;
    setIsSubmitting(true);
    const saved = preparedValue;
    setValue('');
    try {
      await onSend(trimmed, undefined, quoteFeatureEnabled ? resolvedRefs : undefined);
      if (draftPersistTimerRef.current) {
        clearTimeout(draftPersistTimerRef.current);
        draftPersistTimerRef.current = null;
      }
      if (effectiveDraftStorageKey) {
        clearInputDraft(effectiveDraftStorageKey);
      }
      if (quoteFeatureEnabled) {
        onQuotedRefsChange?.([]);
      }
      focusTextarea(textareaRef.current);
    } catch (error) {
      setValue(saved);
      if (draftPersistTimerRef.current) {
        clearTimeout(draftPersistTimerRef.current);
        draftPersistTimerRef.current = null;
      }
      if (effectiveDraftStorageKey) {
        writeInputDraft(effectiveDraftStorageKey, saved);
      }
      focusTextarea(textareaRef.current);
      log.error(`[NowInputRow] send failed: ${error instanceof Error ? error.message : String(error)}`);
      toast({ title: '发送失败', description: '请检查网络连接后重试', variant: 'destructive' });
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }, [effectiveDraftStorageKey, normalizedQuotedRefs, onQuotedRefsChange, onSend, quoteFeatureEnabled, resolveQuotedRefSummary, value]);

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
    const normalized = normalizeRecognitionText(text);
    if (!normalized) return;

    void publishVoiceTranscriptSignal({ text: normalized }, {
      source: 'frontend:now-input-row',
    }).catch((publishError) => {
      log.warn(`[new-now-input][voice-signal] ${publishError instanceof Error ? publishError.message : String(publishError)}`);
    });

    if (voiceTranscriptSendMode === 'direct-send') {
      const preparedValue = quoteFeatureEnabled ? insertMissingQuotedRefLines(normalized, normalizedQuotedRefs) : normalized;
      const refs = quoteFeatureEnabled
        ? deriveQuotedRefsFromContent(preparedValue, normalizedQuotedRefs, resolveQuotedRefSummary)
        : [];
      void onSend(preparedValue, ['voice'], quoteFeatureEnabled ? refs : undefined);
      return;
    }

    setValue((prev) => mergeTranscriptText(prev, normalized));
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      const nextValue = textareaRef.current?.value ?? '';
      const end = nextValue.length;
      if (textareaRef.current) {
        textareaRef.current.selectionStart = end;
        textareaRef.current.selectionEnd = end;
      }
    });
  }, [normalizedQuotedRefs, onSend, quoteFeatureEnabled, resolveQuotedRefSummary, voiceTranscriptSendMode]);

  const appendDraftText = useCallback((text: string) => {
    const normalized = normalizeRecognitionText(text);
    if (!normalized) return;

    setValue((prev) => mergeTranscriptText(prev, normalized));
    requestAnimationFrame(() => {
      resizeTextarea();
      focusTextarea(textareaRef.current);
      const nextValue = textareaRef.current?.value ?? '';
      const end = nextValue.length;
      if (textareaRef.current) {
        textareaRef.current.selectionStart = end;
        textareaRef.current.selectionEnd = end;
      }
    });
  }, [resizeTextarea]);

  const handleVoiceError = useCallback((error: string) => {
    log.error(`[new-now-input][voice] ${error}`);
  }, []);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      textareaRef.current?.blur();
      return;
    }

    if (event.key !== 'Enter' || event.altKey) return;

    if (shouldSubmitOnEnter(inputSendMode, event)) {
      event.preventDefault();
      if (value.trim()) {
        void submitInput();
      } else if (inputSendMode === 'ctrl-enter-send' && (event.ctrlKey || event.metaKey)) {
        textareaRef.current?.blur();
        voiceButtonRef.current?.start();
      }
      return;
    }

    const textarea = textareaRef.current;
    if (!textarea) return;

    event.preventDefault();
    insertTextareaNewline(textarea, (nextValue) => {
      setValue(nextValue);
      resizeTextarea(textarea);
    });
  }, [inputSendMode, resizeTextarea, submitInput, value]);

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
    appendText: (text: string) => {
      appendDraftText(text);
    },
  }), [appendDraftText]);

  return (
    <div className="shrink-0 border-t border-[#E7E5E4] bg-[#FAF7F5] dark:border-[#292524] dark:bg-[#0C0A09]" data-testid="new-now-input-row">
      <div className="px-4 py-2">
        {quoteFeatureEnabled && normalizedQuotedRefs.length > 0 ? (
          <div className="mb-2 flex flex-col gap-2" data-testid="new-now-quote-banner">
            {normalizedQuotedRefs.map((ref) => (
              <div
                key={ref.eventId}
                className="flex items-center gap-2 rounded-2xl border border-[#E7E5E4] bg-white/90 px-3 py-2 shadow-sm dark:border-[#292524] dark:bg-[#1C1917]"
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => onOpenQuotedEvent?.(ref.eventId)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    onOpenQuotedEvent?.(ref.eventId);
                  }}
                  data-testid={`new-now-quote-open-${ref.eventId}`}
                >
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#C75B3A] dark:text-[#FDBA74]">
                    引用
                  </div>
                  <div className="truncate text-xs font-medium text-stone-700 dark:text-stone-100">
                    {ref.summary ?? '事件引用'}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onQuotedRefsChange?.(normalizedQuotedRefs.filter((item) => item.eventId !== ref.eventId));
                  }}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:text-[#78716C] dark:hover:bg-[#292524] dark:hover:text-[#E7E5E4]"
                  aria-label={`移除引用：${ref.summary ?? ref.eventId}`}
                  data-testid={`new-now-quote-remove-${ref.eventId}`}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        ) : null}
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
            disabled={isSubmitting || !value.trim()}
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
