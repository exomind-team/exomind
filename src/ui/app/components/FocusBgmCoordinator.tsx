import { useCallback, useEffect, useRef } from 'react';
import { getTimeBlockService } from '@/lib/services';
import {
  getFocusBgmPreferences,
  subscribeFocusBgmPreferencesChanges,
  type FocusBgmPreferences,
} from '@/config/focus-bgm-preferences';
import { getFocusBgmPlayer } from '@/lib/media/focus-bgm-player';
import { resolveCountdownOverrunMs } from '@/lib/timeblock/countdown-overrun';
import type { ActiveBlockData } from '@/lib/types/event';

function isFeedbackPhase(block: ActiveBlockData): boolean {
  if (block.feedbackSubmittedAt) {
    return true;
  }

  return block.phase === 'feedback_in_progress'
    || block.phase === 'action_ended'
    || Boolean(block.actionEndedAt || block.feedbackStartedAt);
}

function shouldStopForCountdownEnd(
  block: ActiveBlockData,
  preferences: FocusBgmPreferences,
): boolean {
  if (block.mode !== 'countdown' || preferences.stopBehavior !== 'timer-end') {
    return false;
  }

  return resolveCountdownOverrunMs(block) > 0;
}

function hasPlayableBgm(preferences: FocusBgmPreferences): boolean {
  return preferences.enabled
    && (preferences.sourceType === 'preset' || preferences.customTracks.length > 0);
}

export function FocusBgmCoordinator(): null {
  const timeBlockServiceRef = useRef(getTimeBlockService());
  const playerRef = useRef(getFocusBgmPlayer());
  const currentBlockRef = useRef<ActiveBlockData | null>(null);
  const currentPreferencesRef = useRef(getFocusBgmPreferences());
  const currentStartIdRef = useRef<string | null>(null);

  const syncPlayback = useCallback(async (
    block: ActiveBlockData | null,
    preferences: FocusBgmPreferences,
  ) => {
    currentBlockRef.current = block;
    currentPreferencesRef.current = preferences;

    if (!hasPlayableBgm(preferences)) {
      currentStartIdRef.current = null;
      await playerRef.current.stop();
      return;
    }

    if (!block) {
      currentStartIdRef.current = null;
      await playerRef.current.stop();
      return;
    }

    if (isFeedbackPhase(block) || shouldStopForCountdownEnd(block, preferences)) {
      currentStartIdRef.current = null;
      await playerRef.current.stop();
      return;
    }

    await playerRef.current.syncRuntimePreferences(preferences);

    const shouldStartFresh = currentStartIdRef.current !== block.startId
      || (currentStartIdRef.current === null && playerRef.current.getState().status === 'idle');

    if (block.paused) {
      if (shouldStartFresh) {
        await playerRef.current.startFromPreferences(preferences);
        currentStartIdRef.current = block.startId;
      }
      await playerRef.current.pause();
      return;
    }

    if (shouldStartFresh) {
      await playerRef.current.startFromPreferences(preferences);
      currentStartIdRef.current = block.startId;
      return;
    }

    if (playerRef.current.getState().status === 'paused') {
      await playerRef.current.resume();
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const unsubscribeBlock = timeBlockServiceRef.current.onBlockChange((block) => {
      if (cancelled) {
        return;
      }

      void syncPlayback(block, currentPreferencesRef.current);
    });

    const unsubscribePreferences = subscribeFocusBgmPreferencesChanges((preferences) => {
      if (cancelled) {
        return;
      }

      void syncPlayback(currentBlockRef.current, preferences);
    });

    void timeBlockServiceRef.current.loadActiveBlock().then((block) => {
      if (cancelled) {
        return;
      }

      void syncPlayback(block, currentPreferencesRef.current);
    });

    return () => {
      cancelled = true;
      unsubscribeBlock();
      unsubscribePreferences();
      currentStartIdRef.current = null;
      void playerRef.current.stop();
    };
  }, [syncPlayback]);

  return null;
}
