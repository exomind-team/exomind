import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { FEEDBACK_SKIP_CONFIRM_COOLDOWN_SECONDS } from '@/config/feedback-preferences';
import {
  getInputSendMode,
  subscribeInputSendModeChanges,
  type InputSendMode,
  shouldSubmitOnEnter,
} from '@/config/input-send-mode';

export type FeedbackSkipConfirmState = 'idle' | 'cooldown' | 'armed';
export type FeedbackSubmitMode = 'respect-user-preference' | 'ctrl-enter-only';

export function resolveFeedbackSubmitLabel(params: {
  feedback: string;
  isSubmitting: boolean;
  skipConfirmState: FeedbackSkipConfirmState;
  skipConfirmCountdownSec: number;
  defaultLabel: string;
  submittingLabel?: string;
}): string {
  const {
    feedback,
    isSubmitting,
    skipConfirmState,
    skipConfirmCountdownSec,
    defaultLabel,
    submittingLabel = '提交中...',
  } = params;

  if (isSubmitting) {
    return submittingLabel;
  }

  if (feedback.trim().length === 0 && skipConfirmState === 'cooldown') {
    return `确认跳过反馈(${skipConfirmCountdownSec}s)`;
  }

  if (feedback.trim().length === 0 && skipConfirmState === 'armed') {
    return '确认跳过反馈';
  }

  return defaultLabel;
}

export function resolveFeedbackShortcutHint(mode: InputSendMode | FeedbackSubmitMode): string {
  return mode === 'enter-send'
    ? 'Enter 提交 · Ctrl+Enter / Shift+Enter 换行'
    : 'Ctrl+Enter 提交 · Enter / Shift+Enter 换行';
}

export function useFeedbackSubmitControls(options: { submitMode?: FeedbackSubmitMode } = {}) {
  const submitMode = options.submitMode ?? 'respect-user-preference';
  const [inputSendMode, setInputSendMode] = useState<InputSendMode>(() => getInputSendMode());
  const [skipFeedbackConfirmState, setSkipFeedbackConfirmState] = useState<FeedbackSkipConfirmState>('idle');
  const [skipFeedbackCountdownSec, setSkipFeedbackCountdownSec] = useState(FEEDBACK_SKIP_CONFIRM_COOLDOWN_SECONDS);
  const skipFeedbackConfirmIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearSkipFeedbackConfirmInterval = useCallback(() => {
    if (!skipFeedbackConfirmIntervalRef.current) {
      return;
    }
    clearInterval(skipFeedbackConfirmIntervalRef.current);
    skipFeedbackConfirmIntervalRef.current = null;
  }, []);

  const resetSkipFeedbackConfirm = useCallback(() => {
    clearSkipFeedbackConfirmInterval();
    setSkipFeedbackConfirmState('idle');
    setSkipFeedbackCountdownSec(FEEDBACK_SKIP_CONFIRM_COOLDOWN_SECONDS);
  }, [clearSkipFeedbackConfirmInterval]);

  const startSkipFeedbackConfirmCooldown = useCallback(() => {
    clearSkipFeedbackConfirmInterval();
    setSkipFeedbackConfirmState('cooldown');
    setSkipFeedbackCountdownSec(FEEDBACK_SKIP_CONFIRM_COOLDOWN_SECONDS);

    skipFeedbackConfirmIntervalRef.current = setInterval(() => {
      setSkipFeedbackCountdownSec((previousSeconds) => {
        if (previousSeconds <= 1) {
          clearSkipFeedbackConfirmInterval();
          setSkipFeedbackConfirmState('armed');
          return 0;
        }
        return previousSeconds - 1;
      });
    }, 1000);
  }, [clearSkipFeedbackConfirmInterval]);

  useEffect(() => subscribeInputSendModeChanges(setInputSendMode), []);

  useEffect(() => () => {
    clearSkipFeedbackConfirmInterval();
  }, [clearSkipFeedbackConfirmInterval]);

  const insertTextareaNewline = useCallback((
    textarea: HTMLTextAreaElement,
    onChangeValue: (nextValue: string) => void,
  ) => {
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
  }, []);

  const canSubmitFeedback = useCallback((rawFeedback: string | undefined) => {
    const trimmedFeedback = rawFeedback?.trim() ?? '';
    if (trimmedFeedback.length > 0) {
      resetSkipFeedbackConfirm();
      return true;
    }

    if (skipFeedbackConfirmState === 'idle') {
      startSkipFeedbackConfirmCooldown();
      return false;
    }

    if (skipFeedbackConfirmState === 'cooldown') {
      return false;
    }

    resetSkipFeedbackConfirm();
    return true;
  }, [resetSkipFeedbackConfirm, skipFeedbackConfirmState, startSkipFeedbackConfirmCooldown]);

  const handleFeedbackKeyDown = useCallback((
    event: KeyboardEvent<HTMLTextAreaElement>,
    onSubmit: () => void | Promise<void>,
    onChangeValue?: (nextValue: string) => void,
  ) => {
    if (event.nativeEvent.isComposing) return;
    if (submitMode === 'ctrl-enter-only') {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key === 'Enter') {
        event.preventDefault();
        void onSubmit();
      }
      return;
    }

    if (shouldSubmitOnEnter(inputSendMode, event)) {
      event.preventDefault();
      void onSubmit();
      return;
    }

    if (
      inputSendMode === 'enter-send'
      && (event.ctrlKey || event.metaKey)
      && !event.altKey
      && event.key === 'Enter'
      && onChangeValue
    ) {
      event.preventDefault();
      insertTextareaNewline(event.currentTarget, onChangeValue);
    }
  }, [inputSendMode, insertTextareaNewline, submitMode]);

  return {
    inputSendMode,
    shortcutHint: resolveFeedbackShortcutHint(submitMode === 'ctrl-enter-only' ? submitMode : inputSendMode),
    skipFeedbackConfirmState,
    skipFeedbackCountdownSec,
    isSkipFeedbackCoolingDown: skipFeedbackConfirmState === 'cooldown',
    resetSkipFeedbackConfirm,
    canSubmitFeedback,
    handleFeedbackKeyDown,
  };
}
