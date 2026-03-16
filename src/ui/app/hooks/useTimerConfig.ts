import { useEffect, useMemo, useRef, useState } from 'react';
import type { TimerMode } from '@/lib/services';

const DEFAULT_COUNTDOWN_MINUTES = 25;
const MAX_CUSTOM_COUNTDOWN_MINUTES = 720;

function normalizeCountdownMinutes(minutes?: number): number {
  if (!Number.isFinite(minutes)) {
    return DEFAULT_COUNTDOWN_MINUTES;
  }

  return Math.max(1, Math.min(MAX_CUSTOM_COUNTDOWN_MINUTES, Math.round(minutes ?? DEFAULT_COUNTDOWN_MINUTES)));
}

export interface UseTimerConfigResult {
  timerMode: 'countup' | 'countdown';
  countdownMinutes: number;
  setTimerMode: (mode: 'countup' | 'countdown') => void;
  setCountdownMinutes: (minutes: number) => void;
  customDurationDraft: string;
  setCustomDurationDraft: (draft: string) => void;
  commitCustomDuration: () => void;
  timerConfig: { mode: 'countup' } | { mode: 'countdown'; minutes: number };
}

export function useTimerConfig(initialMinutes?: number, resetKey?: string): UseTimerConfigResult {
  const normalizedInitialMinutes = normalizeCountdownMinutes(initialMinutes);
  const hasUserConfiguredRef = useRef(false);
  const lastResetKeyRef = useRef(resetKey);
  const initialMinutesRef = useRef(initialMinutes);
  initialMinutesRef.current = initialMinutes;

  const [timerMode, setTimerModeState] = useState<TimerMode>(initialMinutes ? 'countdown' : 'countup');
  const [countdownMinutes, setCountdownMinutesState] = useState(normalizedInitialMinutes);
  const [customDurationDraft, setCustomDurationDraftState] = useState(String(normalizedInitialMinutes));

  useEffect(() => {
    if (lastResetKeyRef.current === resetKey) {
      return;
    }

    lastResetKeyRef.current = resetKey;
    hasUserConfiguredRef.current = false;
    setTimerModeState(initialMinutesRef.current ? 'countdown' : 'countup');
    setCountdownMinutesState(normalizedInitialMinutes);
    setCustomDurationDraftState(String(normalizedInitialMinutes));
  }, [normalizedInitialMinutes, resetKey]);

  useEffect(() => {
    if (hasUserConfiguredRef.current) {
      return;
    }

    setTimerModeState(initialMinutes ? 'countdown' : 'countup');
    setCountdownMinutesState(normalizedInitialMinutes);
    setCustomDurationDraftState(String(normalizedInitialMinutes));
  }, [initialMinutes, normalizedInitialMinutes]);

  const setTimerMode = (mode: TimerMode) => {
    hasUserConfiguredRef.current = true;
    setTimerModeState(mode);
  };

  const setCountdownMinutes = (minutes: number) => {
    const safeMinutes = normalizeCountdownMinutes(minutes);
    hasUserConfiguredRef.current = true;
    setTimerModeState('countdown');
    setCountdownMinutesState(safeMinutes);
    setCustomDurationDraftState(String(safeMinutes));
  };

  const setCustomDurationDraft = (draft: string) => {
    hasUserConfiguredRef.current = true;
    setCustomDurationDraftState(draft);
  };

  const commitCustomDuration = () => {
    const parsedValue = Number.parseInt(customDurationDraft.trim(), 10);
    if (Number.isFinite(parsedValue)) {
      setCountdownMinutes(parsedValue);
      return;
    }

    setCustomDurationDraftState(String(countdownMinutes));
  };

  const timerConfig = useMemo<UseTimerConfigResult['timerConfig']>(() => {
    if (timerMode === 'countdown') {
      return { mode: 'countdown', minutes: countdownMinutes };
    }

    return { mode: 'countup' };
  }, [countdownMinutes, timerMode]);

  return {
    timerMode,
    countdownMinutes,
    setTimerMode,
    setCountdownMinutes,
    customDurationDraft,
    setCustomDurationDraft,
    commitCustomDuration,
    timerConfig,
  };
}
