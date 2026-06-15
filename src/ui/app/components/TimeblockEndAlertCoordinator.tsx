import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { toast } from '@/components/ui/toast-hook';
import {
  getTimeblockEndAutoOpenFocusEnabled,
  subscribeTimeblockEndAutoOpenFocusChanges,
} from '@/config/timeblock-end-alert';
import {
  getTimerPreferences,
  subscribeTimerPreferencesChanges,
} from '@/config/timer-preferences';
import { log } from '@/lib/logger';
import { resolveHandoffAction } from '@/lib/timeblock/handoff-policy';
import { getTimeBlockService } from '@/lib/services';
import {
  resolveTimeblockEndAlertRequest,
  type TimeblockEndAlertRequest,
} from '@/lib/timeblock/end-alert-policy';
import { resolveTimeBlockPhase, type ActiveBlockData } from '@/lib/types/event';
import {
  cancelTimeblockEndAlertInRuntime,
  getTimeblockEndAlertNotificationPermissionStateInRuntime,
  getTimeblockEndAlertSupport,
  requestTimeblockEndAlertNotificationPermissionInRuntime,
  scheduleTimeblockEndAlertInRuntime,
  subscribeTimeblockEndAlertIntentFromRuntime,
  takePendingTimeblockEndHandoffFromRuntime,
} from '@/services/timeblock-end-alert-runtime';
import {
  getEventlogPathForTab,
  resolveEventlogTabFromLocation,
  setEventlogLastTab,
} from '@/ui/app/pages/eventlog-route-memory';

function isDocumentHidden(): boolean {
  if (typeof document === 'undefined') {
    return false;
  }
  return document.visibilityState !== 'visible';
}

const TIMEBLOCK_END_ALERT_INTENT_EVENT = 'exomind:timeblock-end-alert-intent';
const TIMEBLOCK_END_ALERT_BLOCK_LOAD_RETRY_MS = 500;

export interface TimeblockEndAlertSyncDecision {
  kind: 'skip' | 'cancel' | 'schedule';
  request?: TimeblockEndAlertRequest;
}

export interface ResolveTimeblockEndAlertSyncDecisionOptions {
  armedStartIds?: ReadonlySet<string>;
  now?: number;
}

export function isTimeblockEndAlertRequestOverdue(
  request: TimeblockEndAlertRequest,
  now: number = Date.now(),
): boolean {
  return request.dueAt <= now;
}

export function isFocusPageCountdownOwner(
  pathname: string,
  search: string,
  documentHidden: boolean,
): boolean {
  if (documentHidden || pathname !== '/eventlog') {
    return false;
  }

  return resolveEventlogTabFromLocation(pathname, search) === 'focus';
}

export function shouldAutoOpenFocusOnTimeblockEnd(
  autoOpenFocusEnabled: boolean,
  documentHidden: boolean,
): boolean {
  return autoOpenFocusEnabled && documentHidden;
}

export function resolveTimeblockEndAlertSyncDecision(
  supported: boolean,
  blockStateReady: boolean,
  desiredAlert: TimeblockEndAlertRequest | null,
  options: ResolveTimeblockEndAlertSyncDecisionOptions = {},
): TimeblockEndAlertSyncDecision {
  if (!supported || !blockStateReady) {
    return { kind: 'skip' };
  }

  if (!desiredAlert) {
    return { kind: 'cancel' };
  }

  if (
    options.armedStartIds?.has(desiredAlert.startId)
    && isTimeblockEndAlertRequestOverdue(desiredAlert, options.now)
  ) {
    return { kind: 'skip' };
  }

  return {
    kind: 'schedule',
    request: desiredAlert,
  };
}

export function TimeblockEndAlertCoordinator(): null {
  const navigate = useNavigate();
  const location = useLocation();
  const timeBlockServiceRef = useRef(getTimeBlockService());
  const activeBlockRef = useRef<ActiveBlockData | null>(null);
  const armedAlertStartIdsRef = useRef<Set<string>>(new Set());
  const notificationPermissionPromptedRef = useRef(false);
  const notificationPermissionTipShownRef = useRef(false);
  const [activeBlock, setActiveBlock] = useState<ActiveBlockData | null>(null);
  const [blockStateReady, setBlockStateReady] = useState(false);
  const [timerPreferences, setTimerPreferences] = useState(() => getTimerPreferences());
  const [autoOpenFocus, setAutoOpenFocus] = useState(() => getTimeblockEndAutoOpenFocusEnabled());
  const [documentHidden, setDocumentHidden] = useState(() => isDocumentHidden());
  const support = getTimeblockEndAlertSupport();

  const focusPageVisible = isFocusPageCountdownOwner(
    location.pathname,
    location.searchStr ?? '',
    documentHidden,
  );
  const runningCountdownVisible = !documentHidden
    && Boolean(activeBlock)
    && activeBlock?.mode === 'countdown'
    && resolveTimeBlockPhase(activeBlock) === 'running';
  const desiredAlert = resolveTimeblockEndAlertRequest({
    block: activeBlock,
    frontendOwnsCountdownEnd: focusPageVisible,
    soundEnabled: timerPreferences.countdownEndSoundEnabled,
    autoOpenFocus: shouldAutoOpenFocusOnTimeblockEnd(autoOpenFocus, documentHidden),
  });
  const syncDecision = useMemo(
    () => resolveTimeblockEndAlertSyncDecision(
      support.supported,
      blockStateReady,
      desiredAlert,
      {
        armedStartIds: armedAlertStartIdsRef.current,
      },
    ),
    [blockStateReady, desiredAlert, support.supported],
  );

  useEffect(() => {
    activeBlockRef.current = activeBlock;
  }, [activeBlock]);

  const consumePendingHandoff = useCallback(async () => {
    if (!blockStateReady) {
      return;
    }

    try {
      const pending = await takePendingTimeblockEndHandoffFromRuntime();
      if (!pending) {
        return;
      }

      if (pending.startId) {
        try {
          const decision = resolveHandoffAction({
            pendingStartId: pending.startId,
            currentBlock: activeBlockRef.current,
            countdownEndMode: timerPreferences.countdownEndMode,
          });
          if (decision.kind === 'markEnding') {
            await timeBlockServiceRef.current.markEnding();
          } else {
            log.info(
              `[TimeblockEndAlert] handoff skipped markEnding (${decision.reason})`,
            );
          }
        } catch (error) {
          log.warn(`[TimeblockEndAlert] markEnding from handoff failed ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      setEventlogLastTab('focus');
      await navigate({
        to: getEventlogPathForTab('focus'),
      });
    } catch (error) {
      log.warn(`[TimeblockEndAlert] consume handoff failed ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [blockStateReady, navigate, timerPreferences.countdownEndMode]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = timeBlockServiceRef.current.onBlockChange((block) => {
      if (!cancelled) {
        setActiveBlock(block);
        setBlockStateReady(true);
      }
    });

    const loadActiveBlock = () => {
      void timeBlockServiceRef.current.loadActiveBlock()
        .then((block) => {
          if (!cancelled) {
            setActiveBlock(block);
            setBlockStateReady(true);
          }
        })
        .catch((error) => {
          if (cancelled) {
            return;
          }
          log.warn(`[TimeblockEndAlert] loadActiveBlock failed ${error instanceof Error ? error.message : String(error)}`);
          retryTimer = setTimeout(loadActiveBlock, TIMEBLOCK_END_ALERT_BLOCK_LOAD_RETRY_MS);
        });
    };

    loadActiveBlock();

    return () => {
      cancelled = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    return subscribeTimerPreferencesChanges((preferences) => {
      setTimerPreferences(preferences);
    });
  }, []);

  useEffect(() => {
    return subscribeTimeblockEndAutoOpenFocusChanges((enabled) => {
      setAutoOpenFocus(enabled);
    });
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }

    const handleWindowFocus = () => {
      if (!isDocumentHidden()) {
        setDocumentHidden(false);
        void consumePendingHandoff();
      }
    };

    const handleVisibilityChange = () => {
      const hidden = isDocumentHidden();
      setDocumentHidden(hidden);
      if (!hidden) {
        void consumePendingHandoff();
      }
    };
    const handleRuntimeIntent = () => {
      void consumePendingHandoff();
    };

    window.addEventListener('focus', handleWindowFocus);
    window.addEventListener(TIMEBLOCK_END_ALERT_INTENT_EVENT, handleRuntimeIntent);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    let unlistenRuntimeIntent: (() => void) | null = null;
    let runtimeIntentListenerCancelled = false;
    void subscribeTimeblockEndAlertIntentFromRuntime(handleRuntimeIntent)
      .then((unlisten) => {
        if (runtimeIntentListenerCancelled) {
          unlisten();
          return;
        }
        unlistenRuntimeIntent = unlisten;
      })
      .catch((error) => {
        log.warn(`[TimeblockEndAlert] runtime intent listener failed ${error instanceof Error ? error.message : String(error)}`);
      });

    return () => {
      runtimeIntentListenerCancelled = true;
      unlistenRuntimeIntent?.();
      window.removeEventListener('focus', handleWindowFocus);
      window.removeEventListener(TIMEBLOCK_END_ALERT_INTENT_EVENT, handleRuntimeIntent);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [consumePendingHandoff]);

  useEffect(() => {
    if (!blockStateReady) {
      return;
    }

    void consumePendingHandoff();
  }, [blockStateReady, consumePendingHandoff]);

  useEffect(() => {
    if (!support.supported || !runningCountdownVisible) {
      return;
    }

    let cancelled = false;
    void getTimeblockEndAlertNotificationPermissionStateInRuntime()
      .then(async (state) => {
        if (cancelled) {
          return;
        }

        if (state === 'prompt' && !notificationPermissionPromptedRef.current) {
          notificationPermissionPromptedRef.current = true;
          state = await requestTimeblockEndAlertNotificationPermissionInRuntime();
        }

        if (cancelled || state !== 'denied' || notificationPermissionTipShownRef.current) {
          return;
        }

        notificationPermissionTipShownRef.current = true;
        toast({
          title: '通知未授权',
          description: 'Android 未授予通知权限时，后台倒计时结束仍会尝试播发提示音，但不会显示可点击通知。',
          variant: 'destructive',
        });
      })
      .catch((error) => {
        log.warn(`[TimeblockEndAlert] notification permission check failed ${error instanceof Error ? error.message : String(error)}`);
      });

    return () => {
      cancelled = true;
    };
  }, [runningCountdownVisible, support.supported]);

  useEffect(() => {
    if (syncDecision.kind === 'skip') {
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        if (syncDecision.kind === 'cancel') {
          await cancelTimeblockEndAlertInRuntime();
          return;
        }

        const request = syncDecision.request;
        if (!request) {
          return;
        }

        await scheduleTimeblockEndAlertInRuntime(request);
        armedAlertStartIdsRef.current.add(request.startId);
      } catch (error) {
        if (!cancelled) {
          log.warn(`[TimeblockEndAlert] runtime sync failed ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [syncDecision]);

  return null;
}
