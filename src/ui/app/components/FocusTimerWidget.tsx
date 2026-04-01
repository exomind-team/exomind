import {
  forwardRef,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { ArrowUpRight, ChevronDown, ChevronRight, Music4, NotepadText, Pause, Play, Shrink, Square, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  getTimerPreferences,
  subscribeTimerPreferencesChanges,
} from '@/config/timer-preferences';
import {
  getFocusBgmPreferences,
  subscribeFocusBgmPreferencesChanges,
} from '@/config/focus-bgm-preferences';
import { getTimerEndSoundPresetById } from '@/lib/media/timer-end-sounds';
import { log } from '@/lib/logger';
import { getTaskService, getTaskTimerService, getTimeBlockService, type TimerConfig, type TimerMode } from '@/lib/services';
import { appendTaskStatusChangeDescription } from '@/lib/task/task-status-change-description';
import { resolveCountdownOverrunMs } from '@/lib/timeblock/countdown-overrun';
import { resolveCountdownEndTimeDisplay } from '@/lib/timeblock/expected-end-time';
import { resolveActiveBlockTaskIds, type ActiveBlockData } from '@/lib/types/event';
import type { TaskNode, TaskStatus } from '@/lib/types/task';
import { FocusBgmPanel } from '@/ui/app/components/settings/settings-custom-items';
import { TimeBlockFeedbackDialog } from '@/ui/app/components/TimeBlockFeedbackDialog';
import {
  normalizeEndTaskStatusChoice,
  type TaskStatusChoice,
} from '@/ui/app/components/TaskStatusSelector';
import {
  resolveFeedbackSubmitLabel,
  useFeedbackSubmitControls,
} from '@/ui/app/components/useFeedbackSubmitControls';
import {
  usePrestartSelectableTasks,
} from '@/ui/app/components/prestart-task-selection';

type FocusUiState = 'idle' | 'config' | 'running'; // UI State Machine（界面状态机）
type RunningSubState = 'running' | 'paused'; // Running Sub-state（运行子状态）
export type FocusTimerState = 'idle' | 'running' | 'paused';
type FocusTimerSurface = 'default' | 'overlay'; // Surface Variant（表面样式变体）
type FocusTaskConfigContext = string | { title: string; preselectedTaskIds?: string[] };

interface FocusTimerWidgetProps {
  surface?: FocusTimerSurface;
  overlayRunningChrome?: {
    statusLabel: string;
    onCollapse: () => void;
    onReturnToMain: () => void;
  };
  prestartSelectedTaskIds?: string[];
  onPrestartSelectedTaskIdsChange?: (taskIds: string[]) => void;
  showRunningLinkedTasks?: boolean;
}

export interface FocusTimerWidgetHandle {
  expandAndFocusTaskName: () => void;
  openTaskConfig: (taskConfig: FocusTaskConfigContext) => void;
  getTimerState: () => FocusTimerState;
  pauseOrResume: () => Promise<void>;
  endDialog: () => void;
}

function isFeedbackStage(block: ActiveBlockData): boolean {
  if (block.feedbackSubmittedAt) {
    return false;
  }
  return block.phase === 'feedback_in_progress'
    || block.phase === 'action_ended'
    || Boolean(block.actionEndedAt || block.feedbackStartedAt);
}

function formatClock(ms: number): string {
  const safe = Math.max(0, Math.floor(ms));
  const totalSeconds = Math.floor(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function glassCardShadowClass(): string {
  return 'shadow-[0_1px_2px_rgba(0,0,0,0.03),0_8px_24px_-6px_rgba(0,0,0,0.08),0_20px_40px_-8px_rgba(0,0,0,0.05)]';
}

function expectedOptionClass(active: boolean): string {
  return `relative z-10 h-8 w-full whitespace-nowrap rounded-[8px] px-[8px] text-center text-[12px] transition-colors duration-200 ${
    active
      ? 'font-semibold text-[#1C1917] dark:text-[#FAFAF9]'
      : 'text-[#78716C] hover:text-[#57534E] dark:hover:text-[#D6D3D1]'
  }`;
}

const PRESET_COUNTDOWN_MINUTES = [15, 25, 45] as const;
const MAX_CUSTOM_COUNTDOWN_MINUTES = 720;

function perfNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function isPresetCountdownMinutes(minutes: number): boolean {
  return PRESET_COUNTDOWN_MINUTES.includes(minutes as (typeof PRESET_COUNTDOWN_MINUTES)[number]);
}

function resolveExpectedOptionIndex(mode: TimerMode, minutes: number): number {
  if (mode === 'countup') return 0;
  const presetIndex = PRESET_COUNTDOWN_MINUTES.indexOf(minutes as (typeof PRESET_COUNTDOWN_MINUTES)[number]);
  return presetIndex >= 0 ? presetIndex + 1 : 4;
}

function resolveActiveTaskIds(block: ActiveBlockData | null): string[] {
  return resolveActiveBlockTaskIds(block);
}

function buildTaskStatusChoices(
  taskIds: string[],
  previousChoices: Record<string, TaskStatusChoice> = {},
): Record<string, TaskStatusChoice> {
  return taskIds.reduce<Record<string, TaskStatusChoice>>((nextChoices, taskId) => {
    nextChoices[taskId] = normalizeEndTaskStatusChoice(previousChoices[taskId]);
    return nextChoices;
  }, {});
}

function normalizePreselectedTaskIds(taskIds: string[] | undefined): string[] {
  if (!taskIds) {
    return [];
  }
  return Array.from(new Set(taskIds.map((taskId) => taskId.trim()).filter(Boolean)));
}

export const FocusTimerWidget = forwardRef<FocusTimerWidgetHandle, FocusTimerWidgetProps>(function FocusTimerWidget(
  {
    surface = 'default',
    overlayRunningChrome,
    prestartSelectedTaskIds,
    onPrestartSelectedTaskIdsChange,
    showRunningLinkedTasks = true,
  },
  ref,
) {
  const timeBlockServiceRef = useRef(getTimeBlockService());
  const mutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const frameRef = useRef<number | null>(null);
  const taskInputRef = useRef<HTMLTextAreaElement | null>(null);
  const customDurationInputRef = useRef<HTMLInputElement | null>(null);
  const countdownEndedRef = useRef(false);
  const countdownOverrunRef = useRef(false);
  const hardEndTriggeredRef = useRef(false);
  const linkedTasksLoadRequestRef = useRef(0);

  const [uiState, setUiState] = useState<FocusUiState>('idle');
  const [runningSubState, setRunningSubState] = useState<RunningSubState>('running');

  const [taskNameDraft, setTaskNameDraft] = useState('');
  const [taskName, setTaskName] = useState('');
  const [timerMode, setTimerMode] = useState<TimerMode>('countdown');
  const [countdownMinutes, setCountdownMinutes] = useState(25);
  const [customDurationDraft, setCustomDurationDraft] = useState('25');
  const [isCustomDurationEditing, setIsCustomDurationEditing] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(25 * 60 * 1000);
  const [countdownOvertimeMs, setCountdownOvertimeMs] = useState(0);
  const [timerPreferences, setTimerPreferences] = useState(() => getTimerPreferences());
  const [focusBgmPreferences, setFocusBgmPreferences] = useState(() => getFocusBgmPreferences());
  const [focusBgmDialogOpen, setFocusBgmDialogOpen] = useState(false);

  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [feedbackInProgress, setFeedbackInProgress] = useState(false);
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const selectableTasks = usePrestartSelectableTasks();
  const [internalSelectedTaskIds, setInternalSelectedTaskIds] = useState<string[]>([]);
  const {
    canSubmitFeedback,
    handleFeedbackKeyDown,
    isSkipFeedbackCoolingDown,
    resetSkipFeedbackConfirm,
    skipFeedbackConfirmState,
    skipFeedbackCountdownSec,
  } = useFeedbackSubmitControls({ submitMode: 'ctrl-enter-only' });

  // Task status selector in feedback dialog
  const activeBlockDataRef = useRef<ActiveBlockData | null>(null);
  const taskStatusChoiceBlockRef = useRef<string | null>(null);
  const [linkedTasks, setLinkedTasks] = useState<TaskNode[]>([]);
  const [taskStatusChoices, setTaskStatusChoices] = useState<Record<string, TaskStatusChoice>>({});

  const isRunningUi = uiState === 'running';
  const isPaused = isRunningUi && runningSubState === 'paused';
  const isCustomDurationSelected = timerMode === 'countdown' && !isPresetCountdownMinutes(countdownMinutes);
  const customDurationTriggerText = isCustomDurationSelected ? `${countdownMinutes}m` : '自定义';
  const activeExpectedIndex = resolveExpectedOptionIndex(timerMode, countdownMinutes);
  const isCountdownOvertime =
    timerMode === 'countdown' && countdownOverrunRef.current;
  const isCountdownWarning =
    timerMode === 'countdown'
    && (isCountdownOvertime || (elapsedMs <= 60000 && elapsedMs > 0));
  const countdownEndTimeDisplay = isRunningUi
    ? resolveCountdownEndTimeDisplay({
      block: activeBlockDataRef.current,
      mode: timerMode,
      remainingMs: timerMode === 'countdown' ? elapsedMs : undefined,
      overtimeMs: isCountdownOvertime ? countdownOvertimeMs : 0,
      paused: isPaused,
      isActionEnded: feedbackInProgress,
      now: Date.now(),
    })
    : null;
  const selectedTaskIds = prestartSelectedTaskIds ?? internalSelectedTaskIds;
  const setSelectedTaskIds = useCallback((nextValue: string[] | ((current: string[]) => string[])) => {
    const resolvedValue = normalizePreselectedTaskIds(
      typeof nextValue === 'function' ? nextValue(selectedTaskIds) : nextValue,
    );
    if (onPrestartSelectedTaskIdsChange) {
      onPrestartSelectedTaskIdsChange(resolvedValue);
      return;
    }
    setInternalSelectedTaskIds(resolvedValue);
  }, [onPrestartSelectedTaskIdsChange, selectedTaskIds]);
  const syncIdleElapsedFromMode = useCallback((mode: TimerMode, minutes: number) => {
    setElapsedMs(mode === 'countdown' ? minutes * 60 * 1000 : 0);
  }, []);

  const focusTaskInput = useCallback(() => {
    requestAnimationFrame(() => {
      taskInputRef.current?.focus();
    });
  }, []);

  const enterConfigState = useCallback(() => {
    if (isRunningUi) return;
    setUiState('config');
    focusTaskInput();
  }, [focusTaskInput, isRunningUi]);

  useEffect(() => {
    const selectableTaskIdSet = new Set(selectableTasks.map((task) => task.id));
    setSelectedTaskIds((current) => current.filter((taskId) => selectableTaskIdSet.has(taskId)));
  }, [selectableTasks]);

  // Keep draft minutes synced for custom input（自定义输入框与草稿分钟同步）
  useEffect(() => {
    setCustomDurationDraft(String(countdownMinutes));
  }, [countdownMinutes]);

  useEffect(() => {
    const unsubscribe = subscribeTimerPreferencesChanges((preferences) => {
      setTimerPreferences(preferences);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeFocusBgmPreferencesChanges((preferences) => {
      setFocusBgmPreferences(preferences);
    });
    return unsubscribe;
  }, []);

  const playCountdownEndSound = useCallback(async () => {
    if (!timerPreferences.countdownEndSoundEnabled) return;
    const preset = getTimerEndSoundPresetById(timerPreferences.countdownEndSoundPresetId);
    log.warn(`[TimerSound] play preset=${preset.id} url=${preset.url}`);
    try {
      const audio = new Audio(preset.url);
      audio.loop = false;
      audio.preload = 'auto';
      audio.currentTime = 0;
      await audio.play();
      log.warn(`[TimerSound] play:ok preset=${preset.id}`);
    } catch (e) {
      log.warn(`[TimerSound] play:error preset=${preset.id} error=${e instanceof Error ? e.message : String(e)}`);
    }
  }, [timerPreferences.countdownEndSoundEnabled, timerPreferences.countdownEndSoundPresetId]);

  const applyActiveBlock = useCallback((block: ActiveBlockData | null) => {
    activeBlockDataRef.current = block;
    if (!block) {
      linkedTasksLoadRequestRef.current += 1;
      taskStatusChoiceBlockRef.current = null;
      setUiState('idle');
      setRunningSubState('running');
      setTaskName('');
      setTaskNameDraft('');
      setSelectedTaskIds([]);
      setFeedbackOpen(false);
      setFeedbackInProgress(false);
      setFeedbackSubmitting(false);
      resetSkipFeedbackConfirm();
      countdownEndedRef.current = false;
      countdownOverrunRef.current = false;
      hardEndTriggeredRef.current = false;
      setCountdownOvertimeMs(0);
      syncIdleElapsedFromMode(timerMode, countdownMinutes);
      setLinkedTasks([]);
      setTaskStatusChoices({});
      return;
    }

    const resolvedTaskIds = resolveActiveTaskIds(block);
    const taskLoadRequestId = linkedTasksLoadRequestRef.current + 1;
    linkedTasksLoadRequestRef.current = taskLoadRequestId;

    if (resolvedTaskIds.length > 0) {
      void Promise.all(resolvedTaskIds.map((taskId) => getTaskService().getTask(taskId)))
        .then((tasks) => {
          if (linkedTasksLoadRequestRef.current !== taskLoadRequestId) {
            return;
          }
          setLinkedTasks(tasks.filter((task): task is TaskNode => task !== null));
        })
        .catch(() => {
          if (linkedTasksLoadRequestRef.current !== taskLoadRequestId) {
            return;
          }
          setLinkedTasks([]);
        });
    } else {
      setLinkedTasks([]);
    }
    setTaskStatusChoices((previousChoices) => {
      if (taskStatusChoiceBlockRef.current !== block.startId) {
        taskStatusChoiceBlockRef.current = block.startId;
        return buildTaskStatusChoices(resolvedTaskIds);
      }
      return buildTaskStatusChoices(resolvedTaskIds, previousChoices);
    });

    setTaskName(block.name);
    setTaskNameDraft(block.name);
    setTimerMode(block.mode);
    if (block.mode === 'countdown' && block.targetMinutes) {
      setCountdownMinutes(block.targetMinutes);
    }
    const restoredOverrunMs = block.mode === 'countdown' && timerPreferences.countdownEndMode === 'soft'
      ? resolveCountdownOverrunMs(block)
      : 0;
    const hasRestoredOverrun = restoredOverrunMs > 0;
    setElapsedMs(block.mode === 'countdown' && hasRestoredOverrun ? 0 : Math.max(0, block.elapsed));
    const nextFeedbackInProgress = isFeedbackStage(block);
    setFeedbackInProgress(nextFeedbackInProgress);
    setFeedbackSubmitting(false);
    resetSkipFeedbackConfirm();
    setUiState('running');
    setRunningSubState(nextFeedbackInProgress || block.paused ? 'paused' : 'running');
    hardEndTriggeredRef.current = nextFeedbackInProgress;
    countdownEndedRef.current = hasRestoredOverrun;
    countdownOverrunRef.current = hasRestoredOverrun;
    setCountdownOvertimeMs(hasRestoredOverrun ? restoredOverrunMs : 0);
  }, [countdownMinutes, resetSkipFeedbackConfirm, syncIdleElapsedFromMode, timerMode, timerPreferences.countdownEndMode]);

  useEffect(() => {
    let cancelled = false;
    console.log('[FocusTimer] useEffect: subscribing to onBlockChange');
    const unsubscribe = timeBlockServiceRef.current.onBlockChange((block) => {
      console.log('[FocusTimer] onBlockChange fired', block ? { startId: block.startId, mode: block.mode, phase: block.phase, paused: block.paused, feedbackSubmittedAt: block.feedbackSubmittedAt } : 'NULL');
      if (cancelled) { console.log('[FocusTimer] onBlockChange: cancelled, skipping'); return; }
      applyActiveBlock(block);
    });

    const load = async () => {
      const block = await timeBlockServiceRef.current.loadActiveBlock();
      console.log('[FocusTimer] loadActiveBlock on mount', block ? { startId: block.startId, mode: block.mode, phase: block.phase } : 'NULL');
      if (cancelled) return;
      if (block) {
        applyActiveBlock(block);
      }
    };

    void load();
    return () => {
      console.log('[FocusTimer] useEffect cleanup: unsubscribing');
      cancelled = true;
      unsubscribe();
    };
  }, [applyActiveBlock]);

  useEffect(() => {
    if (!isRunningUi || isPaused) {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      return;
    }

    let last = Date.now();
    const tick = () => {
      const now = Date.now();
      const delta = now - last;
      last = now;

      // Soft end（软结束）时进入超时累计：显示 +xx:xx:xx
      if (timerMode === 'countdown' && countdownOverrunRef.current) {
        setCountdownOvertimeMs((prev) => prev + delta);
        frameRef.current = requestAnimationFrame(tick);
        return;
      }

      setElapsedMs((previous) => {
        const next = timerMode === 'countdown' ? previous - delta : previous + delta;

        if (timerMode === 'countdown' && next <= 0) {
          const overshoot = Math.max(0, -next);
          if (!countdownEndedRef.current) {
            countdownEndedRef.current = true;
            if (previous > 0) {
              void playCountdownEndSound();
            }
          }

          if (timerPreferences.countdownEndMode === 'soft') {
            countdownOverrunRef.current = true;
            setCountdownOvertimeMs(overshoot);
            return 0;
          }

          if (!hardEndTriggeredRef.current) {
            hardEndTriggeredRef.current = true;
            void timeBlockServiceRef.current.markEnding();
            setRunningSubState('paused');
            setFeedbackOpen(true);
          }
          return 0;
        }

        return timerMode === 'countdown' ? Math.max(0, next) : next;
      });

      if (!hardEndTriggeredRef.current) {
        frameRef.current = requestAnimationFrame(tick);
      }
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [isPaused, isRunningUi, playCountdownEndSound, timerMode, timerPreferences.countdownEndMode]);

  useEffect(() => {
    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (uiState !== 'idle') return;
    countdownEndedRef.current = false;
    countdownOverrunRef.current = false;
    hardEndTriggeredRef.current = false;
    setCountdownOvertimeMs(0);
    syncIdleElapsedFromMode(timerMode, countdownMinutes);
  }, [countdownMinutes, syncIdleElapsedFromMode, timerMode, uiState]);

  const handleStart = useCallback(async () => {
    const lines = taskNameDraft.split(/\r?\n/);
    const name = (lines[0] ?? '').trim();
    const description = lines.slice(1).join('\n').trim();
    if (!name) {
      focusTaskInput();
      return;
    }

    const config: TimerConfig = {
      mode: timerMode,
      minutes: timerMode === 'countdown' ? countdownMinutes : undefined,
    };

    countdownEndedRef.current = false;
    countdownOverrunRef.current = false;
    hardEndTriggeredRef.current = false;
    setCountdownOvertimeMs(0);

    const selectedTasks = selectedTaskIds
      .map((taskId) => selectableTasks.find((task) => task.id === taskId))
      .filter((task): task is TaskNode => Boolean(task));
    const selectedIdsForStart = selectedTasks.map((task) => task.id);
    const skippedTaskIds = selectedTaskIds.filter((taskId) => !selectedIdsForStart.includes(taskId));
    if (skippedTaskIds.length > 0) {
      log.warn(`[TB-UI] prestart selection skipped ${JSON.stringify({ skippedTaskIds })}`);
    }
    for (const task of selectedTasks) {
      if (task.status === 'pending' || task.status === 'suspended') {
        await getTaskService().transitionTask(task.id, 'in_progress');
      }
    }

    const block = selectedIdsForStart.length > 0
      ? await timeBlockServiceRef.current.startBlock(name, config, description || undefined, { taskIds: selectedIdsForStart })
      : await timeBlockServiceRef.current.startBlock(name, config, description || undefined);
    activeBlockDataRef.current = block;
    setTaskName(name);
    setTaskNameDraft(name);
    setElapsedMs(Math.max(0, block.elapsed));
    setFeedbackInProgress(false);
    setRunningSubState('running');
    setUiState('running');
  }, [countdownMinutes, focusTaskInput, selectableTasks, selectedTaskIds, taskNameDraft, timerMode]);

  const handleTaskInputKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key !== 'Enter') return;
    if (!(event.ctrlKey || event.metaKey)) return;
    if (event.altKey || event.shiftKey) return;

    event.preventDefault();
    void handleStart();
  }, [handleStart]);

  const handleCollapseToIdle = useCallback(() => {
    if (uiState !== 'config') return;
    setIsCustomDurationEditing(false);
    setUiState('idle');
  }, [uiState]);

  const handleOpenCustomDurationEditor = useCallback(() => {
    setIsCustomDurationEditing(true);
    requestAnimationFrame(() => {
      customDurationInputRef.current?.focus();
      customDurationInputRef.current?.select();
    });
  }, []);

  const applyCustomDuration = useCallback((rawValue: string) => {
    const parsedValue = Number.parseInt(rawValue.trim(), 10);
    if (Number.isFinite(parsedValue)) {
      const safeMinutes = Math.max(1, Math.min(MAX_CUSTOM_COUNTDOWN_MINUTES, parsedValue));
      setTimerMode('countdown');
      setCountdownMinutes(safeMinutes);
      setCustomDurationDraft(String(safeMinutes));
    } else {
      setCustomDurationDraft(String(countdownMinutes));
    }
    setIsCustomDurationEditing(false);
  }, [countdownMinutes]);

  const enqueueServiceMutation = useCallback((
    label: string,
    execute: () => Promise<void>,
  ): void => {
    mutationQueueRef.current = mutationQueueRef.current.then(async () => {
      try {
        await execute();
      } catch (error) {
        log.error(`[TB-UI] ${label} failed ${error instanceof Error ? error.message : String(error)}`);
        try {
          const block = await timeBlockServiceRef.current.loadActiveBlock();
          applyActiveBlock(block);
        } catch (reloadError) {
          log.error(`[TB-UI] ${label} recover failed ${reloadError instanceof Error ? reloadError.message : String(reloadError)}`);
        }
      }
    });
  }, [applyActiveBlock]);

  const handlePauseOrResume = useCallback(async () => {
    if (!isRunningUi) return;
    if (feedbackInProgress) return;

    if (runningSubState === 'running') {
      const t0 = perfNow();
      log.info('[TB-UI] click pause -> pauseBlock start');
      setRunningSubState('paused');
      enqueueServiceMutation('pauseBlock', async () => {
        await timeBlockServiceRef.current.pauseBlock();
        log.info(`[TB-UI] click pause -> pauseBlock done ${JSON.stringify({ elapsedMs: Math.round(perfNow() - t0) })}`);
      });
      return;
    }

    const t0 = perfNow();
    log.info('[TB-UI] click resume -> resumeBlock start');
    setRunningSubState('running');
    enqueueServiceMutation('resumeBlock', async () => {
      await timeBlockServiceRef.current.resumeBlock();
      log.info(`[TB-UI] click resume -> resumeBlock done ${JSON.stringify({ elapsedMs: Math.round(perfNow() - t0) })}`);
    });
  }, [enqueueServiceMutation, feedbackInProgress, isRunningUi, runningSubState]);

  const handleOpenEndDialog = useCallback(() => {
    if (!isRunningUi) return;
    if (feedbackInProgress) {
      setFeedbackOpen(true);
      return;
    }
    const t0 = perfNow();
    log.info('[TB-UI] click end -> markEnding start');
    setRunningSubState('paused');
    setFeedbackInProgress(true);
    enqueueServiceMutation('markEnding', async () => {
      await timeBlockServiceRef.current.markEnding();
      log.info(`[TB-UI] click end -> markEnding done ${JSON.stringify({ elapsedMs: Math.round(perfNow() - t0) })}`);
    });
    setFeedbackOpen(true);
  }, [enqueueServiceMutation, feedbackInProgress, isRunningUi]);

  const hasFocusBgmConfigured = focusBgmPreferences.enabled
    && (focusBgmPreferences.sourceType === 'preset' || focusBgmPreferences.customTracks.length > 0);
  const focusBgmToggleAriaLabel = '背景音设置（Background audio settings）';
  const focusBgmToggleIcon = <Music4 size={16} />;

  const handleSubmitEnd = useCallback(async (feedbackText?: string) => {
    if (feedbackSubmitting) return;
    const trimmedFeedback = feedbackText?.trim() ?? '';
    const blockDataSnapshot = activeBlockDataRef.current;
    const taskIdsSnapshot = resolveActiveTaskIds(blockDataSnapshot);
    const linkedTasksSnapshot = linkedTasks;
    const taskStatusChoicesSnapshot = { ...taskStatusChoices };
    const taskTitles = linkedTasksSnapshot.reduce<Record<string, string>>((titles, task) => {
      titles[task.id] = task.title;
      return titles;
    }, {});
    const taskStatusOutcomes = taskIdsSnapshot.reduce<Record<string, string>>((outcomes, taskId) => {
      const statusChoice = normalizeEndTaskStatusChoice(taskStatusChoicesSnapshot[taskId]);
      outcomes[taskId] = statusChoice;
      return outcomes;
    }, {});
    if (!canSubmitFeedback(trimmedFeedback)) {
      return;
    }
    setFeedbackSubmitting(true);

    const t0 = perfNow();
    log.info('[TB-UI] click submit-end -> endBlock start');

    try {
      await mutationQueueRef.current;
      if (taskIdsSnapshot.length > 0) {
        await timeBlockServiceRef.current.endBlock(trimmedFeedback || undefined, {
          taskStatusOutcomes: Object.keys(taskStatusOutcomes).length > 0 ? taskStatusOutcomes : undefined,
          taskTitles: Object.keys(taskTitles).length > 0 ? taskTitles : undefined,
        });
      } else {
        await timeBlockServiceRef.current.endBlock(trimmedFeedback || undefined);
      }
    } catch (error) {
      log.error(`[TB-UI] endBlock failed ${error instanceof Error ? error.message : String(error)}`);
      try {
        const block = await timeBlockServiceRef.current.loadActiveBlock();
        applyActiveBlock(block);
      } catch (reloadError) {
        log.error(`[TB-UI] endBlock recover failed ${reloadError instanceof Error ? reloadError.message : String(reloadError)}`);
      }
      setFeedbackSubmitting(false);
      return;
    }

    log.info(`[TB-UI] click submit-end -> endBlock done ${JSON.stringify({ elapsedMs: Math.round(perfNow() - t0) })}`);

    // Record block association and apply task status transition
    if (blockDataSnapshot && taskIdsSnapshot.length > 0) {
      try {
        await getTaskTimerService().onBlockEndForTasks(taskIdsSnapshot, blockDataSnapshot.startId);
        for (const taskId of taskIdsSnapshot) {
          const taskStatusChoice = normalizeEndTaskStatusChoice(taskStatusChoicesSnapshot[taskId]);
          const task = linkedTasksSnapshot.find((candidate) => candidate.id === taskId);
          await getTaskService().transitionTask(taskId, taskStatusChoice as TaskStatus);
          if (task) {
            await appendTaskStatusChangeDescription({
              taskId,
              taskTitle: task.title,
              fromStatus: task.status,
              toStatus: taskStatusChoice as TaskStatus,
              description: trimmedFeedback,
            });
          }
        }
      } catch (error) {
        log.error(`[TB-UI] task status update failed ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    setFeedback('');
    setFeedbackOpen(false);
    setFeedbackInProgress(false);
    setFeedbackSubmitting(false);
    setUiState('idle');
    setRunningSubState('running');
    setTaskName('');
    setTaskNameDraft('');
    setLinkedTasks([]);
    taskStatusChoiceBlockRef.current = null;
    setTaskStatusChoices({});
    countdownEndedRef.current = false;
    countdownOverrunRef.current = false;
    hardEndTriggeredRef.current = false;
    setCountdownOvertimeMs(0);
    syncIdleElapsedFromMode(timerMode, countdownMinutes);
  }, [
    applyActiveBlock,
    canSubmitFeedback,
    countdownMinutes,
    feedbackSubmitting,
    syncIdleElapsedFromMode,
    linkedTasks,
    taskStatusChoices,
    timerMode,
  ]);

  const handleConfirmEnd = useCallback(async () => {
    const feedbackText = feedback.trim() || undefined;
    await handleSubmitEnd(feedbackText);
  }, [feedback, handleSubmitEnd]);

  const handleFeedbackDialogOpenChange = useCallback((nextOpen: boolean) => {
    setFeedbackOpen(nextOpen);
  }, []);

  const isEndActionDisabled = feedbackInProgress && feedbackOpen;
  const endActionAriaLabel = feedbackInProgress ? '反馈中（Feedback in progress）' : '结束（End）';
  const endActionTitle = feedbackInProgress ? '反馈中' : '结束';
  const endActionButtonClass = feedbackInProgress
    ? 'h-11 w-11 rounded-[12px] bg-brand p-0 text-white hover:bg-brand/90 hover:text-white'
    : 'h-11 w-11 rounded-[12px] bg-[#C75B3A] p-0 text-white hover:bg-[#B24D2F] hover:text-white';
  const endActionIcon = feedbackInProgress
    ? <NotepadText size={18} className="text-white" />
    : <Square size={18} />;
  const feedbackConfirmLabel = resolveFeedbackSubmitLabel({
    feedback,
    isSubmitting: feedbackSubmitting,
    skipConfirmState: skipFeedbackConfirmState,
    skipConfirmCountdownSec: skipFeedbackCountdownSec,
    defaultLabel: '确认结束',
  });

  useImperativeHandle(
    ref,
    () => ({
      expandAndFocusTaskName: () => {
        if (uiState === 'running') return;
        setUiState('config');
        setSelectedTaskIds([]);
        focusTaskInput();
      },
      openTaskConfig: (taskConfig: FocusTaskConfigContext) => {
        if (uiState === 'running') return;
        const nextTitle = typeof taskConfig === 'string'
          ? taskConfig.trim()
          : taskConfig.title.trim();
        const nextPreselectedTaskIds = typeof taskConfig === 'string'
          ? []
          : normalizePreselectedTaskIds(taskConfig.preselectedTaskIds);
        setTaskNameDraft(nextTitle);
        setSelectedTaskIds(nextPreselectedTaskIds);
        setUiState('config');
        focusTaskInput();
      },
      getTimerState: () => {
        if (uiState !== 'running') return 'idle';
        return runningSubState === 'paused' ? 'paused' : 'running';
      },
      pauseOrResume: async () => {
        await handlePauseOrResume();
      },
      endDialog: () => {
        handleOpenEndDialog();
      },
    }),
    [focusTaskInput, handleOpenEndDialog, handlePauseOrResume, runningSubState, uiState],
  );

  const isOverlaySurface = surface === 'overlay';
  const overlayChrome = isOverlaySurface ? overlayRunningChrome ?? null : null;
  const hasIntegratedOverlayChrome = overlayChrome !== null;
  const hasRunningLinkedTasks = showRunningLinkedTasks && linkedTasks.length > 0;
  const useAutoHeightConfigLayout = !isOverlaySurface;
  const useAutoHeightRunningLayout = !isOverlaySurface || (hasIntegratedOverlayChrome && hasRunningLinkedTasks);
  const baseStageHeightClass = useAutoHeightConfigLayout
    ? 'min-h-[200px] pb-4 pt-4'
    : hasIntegratedOverlayChrome ? 'h-[222px]' : 'h-[200px]';
  const baseGlowHeightClass = useAutoHeightConfigLayout
    ? 'bottom-4'
    : hasIntegratedOverlayChrome ? 'h-[186px]' : 'h-[163px]';
  const baseCardHeightClass = useAutoHeightConfigLayout
    ? 'min-h-[169px]'
    : hasIntegratedOverlayChrome ? 'h-[192px]' : 'h-[169px]';
  const runningStageHeightClass = useAutoHeightRunningLayout
    ? useAutoHeightConfigLayout ? 'min-h-[200px] pb-4 pt-4' : 'min-h-[276px] pb-4 pt-4'
    : hasRunningLinkedTasks
    ? hasIntegratedOverlayChrome ? 'h-[276px]' : 'h-[252px]'
    : baseStageHeightClass;
  const runningGlowHeightClass = useAutoHeightRunningLayout
    ? 'bottom-4'
    : hasRunningLinkedTasks
    ? hasIntegratedOverlayChrome ? 'h-[240px]' : 'h-[215px]'
    : baseGlowHeightClass;
  const runningCardHeightClass = useAutoHeightRunningLayout
    ? useAutoHeightConfigLayout ? 'min-h-[169px]' : 'min-h-[246px]'
    : hasRunningLinkedTasks
    ? hasIntegratedOverlayChrome ? 'h-[246px]' : 'h-[221px]'
    : baseCardHeightClass;

  return (
    <div
      className={isOverlaySurface ? 'bg-transparent' : 'bg-[#FAF7F5] dark:bg-[#0C0A09]'}
      data-testid="new-focus-timer-widget"
    >
      {uiState === 'idle' && (
        <section className={isOverlaySurface ? 'pt-0' : 'pt-[10px]'}>
          <div className="relative mx-auto h-[104px] w-full max-w-[390px]" data-testid="new-focus-state-idle">
            <div
              className={`absolute left-1/2 top-[18px] h-[74px] w-[calc(100%-40px)] max-w-[353px] -translate-x-1/2 rounded-[22px] blur-[8px] ${
                isOverlaySurface
                  ? 'bg-[rgba(12,10,9,0.24)]'
                  : 'bg-gradient-to-br from-[#EDADA0] via-[#E08E7A] to-[#D4785F] dark:from-[#8B3A25] dark:via-[#6B2E1E] dark:to-[#4A1F14]'
              }`}
              aria-hidden
            />

            <button
              type="button"
              data-testid="new-focus-idle-card"
              onClick={enterConfigState}
              aria-expanded="false"
              aria-controls="new-focus-config-panel"
              aria-label="展开专注配置（Expand focus configuration）"
              className={`absolute left-4 right-4 top-4 flex h-[68px] items-center justify-between rounded-[24px] px-5 py-[18px] text-left backdrop-blur-[24px] ${glassCardShadowClass()} ${
                isOverlaySurface
                  ? 'border border-white/55 bg-[rgba(28,25,23,0.78)] text-[#FAFAF9]'
                  : 'border border-[#FFFFFF80] bg-[linear-gradient(180deg,rgba(255,255,255,0.64)_0%,rgba(255,255,255,0.36)_100%)] dark:border-[#FFFFFF15] dark:[background-color:rgba(28,25,23,0.5)] dark:bg-[linear-gradient(180deg,rgba(28,25,23,0.25)_0%,rgba(28,25,23,0)_100%)]'
              }`}
            >
              <div className="mr-3 flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[#FEF0ED] dark:bg-[#2A1510] text-[#C75B3A] dark:text-[#E8734E]">
                  <Target size={20} />
                </div>
                <div className="min-w-0">
                  <p className={`truncate text-[16px] font-semibold leading-[1.4] ${isOverlaySurface ? 'text-[#F5EDE7]' : 'text-[#1C1917] dark:text-[#FAFAF9]'}`}>点击开启时间块</p>
                  <p className={`truncate text-[12px] leading-[1.4] ${isOverlaySurface ? 'text-[#D6C2B8]' : 'text-[#78716C]'}`}>配置时间块，开启新计时</p>
                </div>
              </div>
              <ChevronRight size={20} className="shrink-0 text-[#C75B3A] dark:text-[#E8734E]" />
            </button>
          </div>
        </section>
      )}

      {uiState === 'config' && (
        <section className={isOverlaySurface ? 'pt-0' : 'pt-[10px]'}>
          <div className={`relative mx-auto w-full max-w-[390px] ${baseStageHeightClass}`} data-testid="new-focus-state-config">
            <div
              className={`absolute left-1/2 top-[20px] ${baseGlowHeightClass} w-[calc(100%-40px)] max-w-[353px] -translate-x-1/2 rounded-[22px] blur-[8px] ${
                isOverlaySurface
                  ? 'bg-[rgba(12,10,9,0.24)]'
                  : 'bg-gradient-to-br from-[#EDADA0] via-[#E08E7A] to-[#D4785F] dark:from-[#8B3A25] dark:via-[#6B2E1E] dark:to-[#4A1F14]'
              }`}
              aria-hidden
            />

            <div
              id="new-focus-config-panel"
              className={`${useAutoHeightConfigLayout ? 'relative mx-4' : 'absolute left-4 right-4 top-4'} flex ${baseCardHeightClass} flex-col gap-3 ${isOverlaySurface ? 'overflow-y-auto' : ''} rounded-[24px] px-[18px] py-4 backdrop-blur-[24px] ${glassCardShadowClass()} ${
                isOverlaySurface
                  ? 'border border-white/55 bg-[rgba(28,25,23,0.78)] text-[#FAFAF9]'
                  : 'border border-[#FFFFFF80] bg-[linear-gradient(180deg,rgba(255,255,255,0.64)_0%,rgba(255,255,255,0.36)_100%)] dark:border-[#FFFFFF15] dark:[background-color:rgba(28,25,23,0.5)] dark:bg-[linear-gradient(180deg,rgba(28,25,23,0.25)_0%,rgba(28,25,23,0)_100%)]'
              }`}
            >
              <div className="flex items-center gap-[10px]">
                <button
                  type="button"
                  data-testid="new-focus-config-collapse-button"
                  aria-expanded="true"
                  aria-controls="new-focus-config-panel"
                  aria-label="收起专注配置（Collapse focus configuration）"
                  onClick={handleCollapseToIdle}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[#FEF0ED] dark:bg-[#2A1510] text-[#C75B3A] dark:text-[#E8734E] transition-transform active:scale-95"
                >
                  <Target size={20} />
                </button>
                <Textarea
                  ref={taskInputRef}
                  data-testid="new-focus-task-input"
                  value={taskNameDraft}
                  onChange={(event) => setTaskNameDraft(event.target.value)}
                  onKeyDown={handleTaskInputKeyDown}
                  placeholder="输入时间块名称..."
                  rows={1}
                  className="max-h-24 border-[#E7E5E4]/80 dark:border-[#FFFFFF20] bg-white/60 dark:bg-[#FFFFFF10] text-sm dark:text-[#FAFAF9]"
                />
              </div>

              <div className="h-px w-full bg-[#D4785F30] dark:bg-[#D4785F20]" />

              <div className="flex min-w-0 flex-col gap-1.5">
                <span className="text-[12px] font-medium text-[#57534E] dark:text-[#A8A29E]">预期时长</span>
                <div
                  className="relative min-w-0 overflow-hidden rounded-[10px] border border-[#E7E5E4] bg-[#F5F0ED]/50 dark:border-[#FFFFFF20] dark:bg-[#FFFFFF08]"
                  data-testid="new-focus-expected-time-row"
                >
                  <div
                    data-testid="new-focus-expected-active-indicator"
                    className="pointer-events-none absolute inset-y-0 left-0 w-1/5 rounded-[8px] border border-brand-accent/40 bg-brand-accent/15 shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-transform duration-200 ease-out"
                    style={{ transform: `translateX(${activeExpectedIndex * 100}%)` }}
                  />
                  <div className="relative z-10 grid min-w-0 grid-cols-5 gap-0">
                  <button
                    type="button"
                    data-testid="new-focus-expected-countup"
                    onClick={() => {
                      setIsCustomDurationEditing(false);
                      setTimerMode('countup');
                    }}
                    className={expectedOptionClass(timerMode === 'countup')}
                  >
                    正计时
                  </button>

                  {PRESET_COUNTDOWN_MINUTES.map((minutes) => (
                    <button
                      key={minutes}
                      type="button"
                      data-testid={`new-focus-expected-${minutes}`}
                      onClick={() => {
                        setIsCustomDurationEditing(false);
                        setTimerMode('countdown');
                        setCountdownMinutes(minutes);
                      }}
                      className={expectedOptionClass(timerMode === 'countdown' && countdownMinutes === minutes)}
                    >
                      {minutes}m
                    </button>
                  ))}

                  {isCustomDurationEditing ? (
                    <Input
                      ref={customDurationInputRef}
                      data-testid="new-focus-expected-custom-input"
                      value={customDurationDraft}
                      onChange={(event) => {
                        setCustomDurationDraft(event.target.value.replace(/[^\d]/g, ''));
                      }}
                      onBlur={() => applyCustomDuration(customDurationDraft)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          applyCustomDuration(customDurationDraft);
                        }
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          setCustomDurationDraft(String(countdownMinutes));
                          setIsCustomDurationEditing(false);
                        }
                      }}
                      aria-label="自定义倒计时分钟（Custom countdown minutes）"
                      placeholder="分钟"
                      className="relative z-10 h-8 w-full border-transparent bg-transparent px-[6px] text-center text-[12px] font-semibold leading-none text-[#1C1917] shadow-none outline-none ring-0 focus-visible:ring-0 dark:text-[#FAFAF9]"
                    />
                  ) : (
                    <button
                      type="button"
                      data-testid="new-focus-expected-custom-trigger"
                      onClick={handleOpenCustomDurationEditor}
                      className={`relative z-10 flex h-8 w-full items-center justify-center gap-1 whitespace-nowrap rounded-[8px] px-[8px] text-[12px] transition-colors duration-200 ${
                        isCustomDurationSelected
                          ? 'font-semibold text-[#1C1917] dark:text-[#FAFAF9]'
                          : 'text-[#C75B3A] hover:text-[#B24D2F]'
                      }`}
                      aria-label="自定义倒计时（Custom countdown）"
                    >
                      <ChevronDown size={12} className="transition-transform" />
                      {customDurationTriggerText}
                    </button>
                  )}
                  </div>
                </div>
              </div>

              <Button
                type="button"
                data-testid="new-focus-start-button"
                onClick={() => {
                  void handleStart();
                }}
                className="h-10 w-full rounded-[12px] bg-[#C75B3A] text-[14px] font-medium text-white hover:bg-[#B24D2F] dark:bg-[#C75B3A] dark:hover:bg-[#B24D2F]"
              >
                <Play size={16} className="mr-2" />
                开始
              </Button>
            </div>
          </div>
        </section>
      )}

      {uiState === 'running' && (
        <section className={isOverlaySurface ? 'pt-0' : 'pt-[10px]'} data-testid="new-focus-state-running">
          <div className={`relative mx-auto w-full max-w-[390px] ${runningStageHeightClass}`}>
            <div
              className={`absolute left-1/2 top-[20px] ${runningGlowHeightClass} w-[calc(100%-40px)] max-w-[353px] -translate-x-1/2 rounded-[22px] blur-[8px] ${
                isOverlaySurface
                  ? 'bg-[rgba(12,10,9,0.24)]'
                  : 'bg-gradient-to-br from-[#EDADA0] via-[#E08E7A] to-[#D4785F] dark:from-[#8B3A25] dark:via-[#6B2E1E] dark:to-[#4A1F14]'
              }`}
              aria-hidden
            />
            <div
              data-testid="new-focus-running-task-card"
              className={`${useAutoHeightRunningLayout ? 'relative mx-4' : 'absolute left-4 right-4 top-4'} flex ${runningCardHeightClass} flex-col gap-3 rounded-[24px] px-5 py-4 backdrop-blur-[24px] ${glassCardShadowClass()} ${
                isOverlaySurface
                  ? 'border border-white/55 bg-[rgba(28,25,23,0.78)] text-[#FAFAF9]'
                  : 'border border-[#FFFFFF80] bg-[linear-gradient(180deg,rgba(255,255,255,0.64)_0%,rgba(255,255,255,0.36)_100%)] dark:border-[#FFFFFF15] dark:[background-color:rgba(28,25,23,0.5)] dark:bg-[linear-gradient(180deg,rgba(28,25,23,0.25)_0%,rgba(28,25,23,0)_100%)]'
              }`}
            >
              {overlayChrome ? (
                <div className="flex min-w-0 items-start justify-between gap-3" data-testid="new-focus-overlay-running-header">
                  <div
                    data-testid="new-focus-overlay-drag-handle"
                    data-tauri-drag-region
                    title="按住这里拖动窗口"
                    className="min-w-0 cursor-grab select-none active:cursor-grabbing"
                  >
                    <p className="truncate text-[10px] font-medium uppercase tracking-[0.12em] text-[#D6C2B8]" data-tauri-drag-region>
                      {overlayChrome.statusLabel}
                    </p>
                    <p className="truncate pt-0.5 text-[18px] font-semibold leading-[1.35] text-[#F5EDE7]" data-tauri-drag-region>
                      {taskName || '未命名任务'}
                    </p>
                  </div>
                  <div className="ml-auto flex shrink-0 items-center gap-1.5">
                    {hasFocusBgmConfigured ? (
                      <Button
                        type="button"
                        variant="ghost"
                        data-testid="new-focus-bgm-toggle-button"
                        aria-label={focusBgmToggleAriaLabel}
                        className="h-8 w-8 rounded-[10px] border border-white/10 bg-white/8 p-0 text-[#E7D7CF] hover:bg-white/15"
                        onClick={() => {
                          setFocusBgmDialogOpen(true);
                        }}
                      >
                        {focusBgmToggleIcon}
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={overlayChrome.onCollapse}
                      aria-label="收起"
                      title="收起"
                      className="h-8 w-8 rounded-[10px] border border-white/10 bg-white/8 p-0 text-[#E7D7CF] hover:bg-white/15"
                    >
                      <Shrink size={15} />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={overlayChrome.onReturnToMain}
                      aria-label="显示主程序"
                      title="显示主程序"
                      className="h-8 w-8 rounded-[10px] border border-white/10 bg-white/8 p-0 text-[#E7D7CF] hover:bg-white/15"
                    >
                      <ArrowUpRight size={15} />
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[#FEF0ED] dark:bg-[#2A1510] text-[#C75B3A] dark:text-[#E8734E]">
                      <Target size={20} />
                    </div>
                    <p className={`truncate text-[20px] font-semibold leading-[1.4] ${isOverlaySurface ? 'text-[#F5EDE7]' : 'text-[#1C1917] dark:text-[#FAFAF9]'}`}>{taskName || '未命名任务'}</p>
                  </div>
                  {hasFocusBgmConfigured ? (
                    <Button
                      type="button"
                      variant="ghost"
                      data-testid="new-focus-bgm-toggle-button"
                      aria-label={focusBgmToggleAriaLabel}
                      className={`h-9 w-9 rounded-[10px] p-0 ${
                        isOverlaySurface
                          ? 'border border-white/10 bg-white/8 text-[#E7D7CF] hover:bg-white/15'
                          : 'border border-[#E7E5E4] bg-white/50 text-[#C75B3A] hover:bg-white/70 dark:border-[#FFFFFF20] dark:bg-[#FFFFFF10] dark:text-[#E8734E]'
                      }`}
                      onClick={() => {
                        setFocusBgmDialogOpen(true);
                      }}
                    >
                      {focusBgmToggleIcon}
                    </Button>
                  ) : null}
                </div>
              )}
              <div className="h-px w-full bg-[#D4785F30] dark:bg-[#D4785F20]" />
              <div className="flex items-center justify-between px-1 pt-1">
                <Button
                  type="button"
                  data-testid="new-focus-pause-resume-button"
                  aria-label={isPaused ? '继续（Resume）' : '暂停（Pause）'}
                  disabled={feedbackInProgress}
                  onClick={() => {
                    void handlePauseOrResume();
                  }}
                  className={
                    isPaused
                      ? 'h-11 w-11 rounded-[12px] bg-[#16A34A] p-0 text-white hover:bg-[#15803D]'
                      : 'h-11 w-11 rounded-[12px] bg-warning p-0 text-white hover:bg-warning/90 hover:text-white'
                  }
                >
                  {isPaused ? <Play size={18} /> : <Pause size={18} />}
                </Button>
                <div className="flex min-w-0 flex-col items-center gap-1 px-2">
                  <span
                    className={`font-mono text-[40px] font-normal leading-[1.1] tracking-[2px] ${
                      isCountdownWarning ? 'text-[#C75B3A]' : 'text-[#1C1917] dark:text-[#FAFAF9]'
                    }`}
                    data-testid="new-focus-running-clock"
                  >
                    {isCountdownOvertime
                      ? `+${formatClock(countdownOvertimeMs)}`
                      : formatClock(elapsedMs)}
                  </span>
                  {countdownEndTimeDisplay && (
                    <span
                      data-testid="new-focus-end-time"
                      className="max-w-full truncate text-[12px] leading-[1.2] text-[#8C7D78] dark:text-[#A8A29E]"
                    >
                      {countdownEndTimeDisplay.text}
                    </span>
                  )}
                </div>
                <Button
                  type="button"
                  data-testid="new-focus-end-button"
                  aria-label={endActionAriaLabel}
                  title={endActionTitle}
                  disabled={isEndActionDisabled}
                  onClick={handleOpenEndDialog}
                  className={endActionButtonClass}
                >
                  {endActionIcon}
                </Button>
              </div>
              {hasRunningLinkedTasks && (
                <>
                  <div className="h-px w-full bg-[#D4785F24] dark:bg-[#D4785F18]" />
                  <div data-testid="new-focus-running-linked-tasks" className="min-h-0 px-1">
                    <p className={`pb-1 text-[11px] font-medium ${isOverlaySurface ? 'text-[#D6C2B8]' : 'text-[#78716C] dark:text-[#A8A29E]'}`}>
                      关联任务
                    </p>
                    <ul className={`list-disc space-y-1 pl-4 text-[12px] leading-[1.35] ${isOverlaySurface ? 'text-[#F5EDE7]' : 'text-[#44403C] dark:text-[#E7E5E4]'}`}>
                      {linkedTasks.map((task) => (
                        <li
                          key={task.id}
                          data-testid={`new-focus-running-linked-task-${task.id}`}
                          className={useAutoHeightRunningLayout || !isOverlaySurface ? 'break-words whitespace-normal marker:text-[#C75B3A]' : 'truncate marker:text-[#C75B3A]'}
                          title={task.title}
                        >
                          {task.title}
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              )}
            </div>
          </div>
        </section>
      )}

      <TimeBlockFeedbackDialog
        open={feedbackOpen}
        onOpenChange={handleFeedbackDialogOpenChange}
        title="结束专注并记录反馈"
        description="记录本次专注反馈后将结束当前时间块"
        feedback={feedback}
        onFeedbackChange={(value) => {
          resetSkipFeedbackConfirm();
          setFeedback(value);
        }}
        onFeedbackKeyDown={(event) => {
          handleFeedbackKeyDown(event, handleConfirmEnd, (nextValue) => {
            resetSkipFeedbackConfirm();
            setFeedback(nextValue);
          });
        }}
        feedbackPlaceholder="记录本次专注的反馈..."
        feedbackTestId="new-focus-feedback-textarea"
        onSubmit={() => {
          void handleConfirmEnd();
        }}
        submitLabel={feedbackConfirmLabel}
        submitDisabled={feedbackSubmitting || isSkipFeedbackCoolingDown}
        submitTestId="new-focus-feedback-confirm"
        submitButtonClassName="inline-flex items-center justify-center rounded-[10px] bg-brand-accent px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 hover:bg-brand-accent/90"
        textareaClassName="min-h-[96px] resize-none dark:bg-[rgba(255,255,255,0.06)] dark:border-[#FFFFFF15] dark:text-[#FAFAF9] dark:placeholder:text-[#78716C]"
        tasks={linkedTasks}
        outcomes={taskStatusChoices}
        onOutcomeChange={(taskId, choice) => {
          setTaskStatusChoices((previousChoices) => ({
            ...previousChoices,
            [taskId]: choice,
          }));
        }}
        taskStatusTestIds={{
          row: (taskId) => `feedback-task-status-row-${taskId}`,
          selector: (taskId) => `feedback-task-status-selector-${taskId}`,
          optionPrefix: (taskId) => `feedback-task-status-${taskId}`,
        }}
      />

      <Dialog open={focusBgmDialogOpen} onOpenChange={setFocusBgmDialogOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>专注背景音</DialogTitle>
            <DialogDescription>在专注进行中调整背景音配置与音量</DialogDescription>
          </DialogHeader>
          <FocusBgmPanel ctx={{ isDesktop: !isOverlaySurface }} />
        </DialogContent>
      </Dialog>
    </div>
  );
});
