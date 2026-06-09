import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getFocusKeepAwakeEnabled,
  setFocusKeepAwakeEnabled,
  subscribeFocusKeepAwakeChanges,
} from '@/config/focus-keep-awake';
import { log } from '@/lib/logger';
import { getTimeBlockService } from '@/lib/services';
import { resolveTimeBlockPhase, type ActiveBlockData } from '@/lib/types/event';
import {
  getFocusKeepAwakeSupport,
  setFocusKeepAwakeEnabledInRuntime,
} from '@/services/focus-keep-awake.service';

const FOCUS_KEEP_AWAKE_BLOCK_LOAD_RETRY_MS = 1500;

export interface FocusKeepAwakeControl {
  visible: boolean;
  enabled: boolean;
  available: boolean;
  pending: boolean;
  buttonTitle: string;
  ariaLabel: string;
  onToggle: () => void;
}

export function isFocusKeepAwakeEligibleBlock(block: ActiveBlockData | null): boolean {
  if (!block) {
    return false;
  }

  if (block.blockType === 'gap') {
    return false;
  }

  if (
    block.feedbackSubmittedAt
    || block.actionEndedAt
    || block.feedbackStartedAt
    || block.phase === 'feedback_in_progress'
    || block.phase === 'action_ended'
    || block.phase === 'feedback_submitted'
  ) {
    return false;
  }

  const phase = resolveTimeBlockPhase(block);
  return phase === 'running' || phase === 'paused';
}

export function useFocusKeepAwakeController(pageActive: boolean): FocusKeepAwakeControl {
  const timeBlockServiceRef = useRef(getTimeBlockService());
  const [enabled, setEnabled] = useState(() => getFocusKeepAwakeEnabled());
  const [activeBlock, setActiveBlock] = useState<ActiveBlockData | null>(null);
  const [blockStateReady, setBlockStateReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const support = getFocusKeepAwakeSupport();
  const keepAwakeRelevant = isFocusKeepAwakeEligibleBlock(activeBlock);
  const shouldRequestKeepAwake = blockStateReady
    && pageActive
    && enabled
    && support.supported
    && keepAwakeRelevant;

  useEffect(() => {
    return subscribeFocusKeepAwakeChanges((nextEnabled) => {
      setEnabled(nextEnabled);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = timeBlockServiceRef.current.onBlockChange((block) => {
      if (cancelled) {
        return;
      }
      setActiveBlock(block);
      setBlockStateReady(true);
    });

    const loadActiveBlock = () => {
      void timeBlockServiceRef.current.loadActiveBlock().then((block) => {
        if (cancelled) {
          return;
        }
        setActiveBlock(block);
        setBlockStateReady(true);
      }).catch((error) => {
        if (cancelled) {
          return;
        }
        log.warn(`[FocusKeepAwake] loadActiveBlock failed ${error instanceof Error ? error.message : String(error)}`);
        retryTimer = setTimeout(loadActiveBlock, FOCUS_KEEP_AWAKE_BLOCK_LOAD_RETRY_MS);
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
    if (!blockStateReady) {
      setPending(false);
      return;
    }

    if (!support.supported) {
      if (enabled && pageActive) {
        setRuntimeError(support.reason);
      } else {
        setRuntimeError(null);
      }
      return;
    }

    let disposed = false;
    setPending(true);

    void setFocusKeepAwakeEnabledInRuntime(shouldRequestKeepAwake)
      .then(() => {
        if (disposed) {
          return;
        }
        setRuntimeError(null);
      })
      .catch((error) => {
        if (disposed) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        log.warn(`[FocusKeepAwake] runtime apply failed ${message}`);
        setRuntimeError(message);
      })
      .finally(() => {
        if (disposed) {
          return;
        }
        setPending(false);
      });

    return () => {
      disposed = true;
    };
  }, [blockStateReady, enabled, pageActive, shouldRequestKeepAwake, support.reason, support.supported]);

  useEffect(() => {
    return () => {
      void setFocusKeepAwakeEnabledInRuntime(false).catch(() => {});
    };
  }, []);

  const handleToggle = useCallback(() => {
    setRuntimeError(null);
    setEnabled(setFocusKeepAwakeEnabled(!enabled));
  }, [enabled]);

  if (!support.supported) {
    return {
      visible: false,
      enabled,
      available: false,
      pending: false,
      buttonTitle: support.reason ?? '当前环境不支持保持亮屏',
      ariaLabel: '保持亮屏不可用',
      onToggle: handleToggle,
    };
  }

  if (runtimeError) {
    return {
      visible: keepAwakeRelevant,
      enabled,
      available: true,
      pending: false,
      buttonTitle: `保持亮屏失败：${runtimeError}`,
      ariaLabel: '保持亮屏失败',
      onToggle: handleToggle,
    };
  }

  return {
    visible: keepAwakeRelevant,
    enabled,
    available: true,
    pending,
    buttonTitle: enabled ? '关闭保持亮屏' : '开启保持亮屏',
    ariaLabel: enabled ? '关闭保持亮屏' : '开启保持亮屏',
    onToggle: handleToggle,
  };
}
