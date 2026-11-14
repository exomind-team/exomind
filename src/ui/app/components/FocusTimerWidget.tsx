import {
  forwardRef,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getTimerPreferences,
  subscribeTimerPreferencesChanges,
} from "@/config/timer-preferences";
import {
  getFocusBgmPreferences,
  subscribeFocusBgmPreferencesChanges,
} from "@/config/focus-bgm-preferences";
import { getTimerEndSoundPresetById } from "@/lib/media/timer-end-sounds";
import { log } from "@/lib/logger";
import { PerfTrace, logPerfInfo, perfNow, waitForNextPaint } from "@/lib/utils/perf-trace";
import {
  getTaskService,
  getTaskTimerService,
  getEventLogService,
  getTimeBlockService,
  type TimerConfig,
  type TimerMode,
} from "@/lib/services";
import { getEventSourceMetadata } from "@/lib/eventlog/source-metadata";
import { appendTaskStatusChangeDescription } from "@/lib/task/task-status-change-description";
import { resolveCountdownOverrunMs } from "@/lib/timeblock/countdown-overrun";
import { resolveCountdownEndTimeDisplay } from "@/lib/timeblock/expected-end-time";
import {
  resolveActiveBlockTaskIds,
  type ActiveBlockData,
} from "@/lib/types/event";
import type { TaskNode, TaskStatus } from "@/lib/types/task";
import { FocusBgmPanel } from "@/ui/app/components/settings/settings-custom-items";
import { TimeBlockFeedbackDialog } from "@/ui/app/components/TimeBlockFeedbackDialog";
import {
  normalizeEndTaskStatusChoice,
  type TaskStatusChoice,
} from "@/ui/app/components/TaskStatusSelector";
import { FocusKeepAwakeButton } from "@/ui/app/components/FocusKeepAwakeButton";
import type { FocusKeepAwakeControl } from "@/ui/app/components/FocusKeepAwakeController";
import { createUuidV4 } from "@/lib/utils/uuid";
import {
  resolveFeedbackSubmitLabel,
  useFeedbackSubmitControls,
} from "@/ui/app/components/useFeedbackSubmitControls";
import { usePrestartSelectableTasks } from "@/ui/app/components/prestart-task-selection";
import {
  FocusTimerView,
  type FocusTimerOverlayChrome,
  type FocusTimerSurface,
  type FocusTimerViewModel,
} from "./FocusTimerView";

type FocusUiState = "idle" | "config" | "running"; // UI State Machine（界面状态机）
type RunningSubState = "running" | "paused"; // Running Sub-state（运行子状态）
export type FocusTimerState = "idle" | "running" | "paused";
type FocusTaskConfigContext =
  | string
  | { title: string; preselectedTaskIds?: string[] };

interface FocusTimerWidgetProps {
  surface?: FocusTimerSurface;
  overlayRunningChrome?: FocusTimerOverlayChrome;
  prestartSelectedTaskIds?: string[];
  onPrestartSelectedTaskIdsChange?: (taskIds: string[]) => void;
  showRunningLinkedTasks?: boolean;
  taskAssociationsEnabled?: boolean;
  keepAwakeControl?: FocusKeepAwakeControl;
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
  return (
    block.phase === "feedback_in_progress" ||
    block.phase === "action_ended" ||
    Boolean(block.actionEndedAt || block.feedbackStartedAt)
  );
}

function isRenderableActiveBlock(block: ActiveBlockData): boolean {
  return (
    block.blockType !== "gap" &&
    !block.feedbackSubmittedAt &&
    !(block.transitions ?? []).some((transition) => transition.type === "end")
  );
}

function isQuickStartKeyEvent(event: KeyboardEvent<HTMLElement>): boolean {
  return (
    !event.nativeEvent.isComposing &&
    event.key === "Enter" &&
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey
  );
}

function parseCustomDurationMinutes(rawValue: string): number | null {
  const parsedValue = Number.parseInt(rawValue.trim(), 10);
  if (!Number.isFinite(parsedValue)) {
    return null;
  }
  return Math.max(1, Math.min(MAX_CUSTOM_COUNTDOWN_MINUTES, parsedValue));
}

function formatRunningBlockName(name: string | null | undefined): string {
  return name?.trim() || "未命名时间块";
}

function formatClock(ms: number): string {
  const safe = Math.max(0, Math.floor(ms));
  const totalSeconds = Math.floor(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

const MAX_CUSTOM_COUNTDOWN_MINUTES = 720;
const DEFAULT_COUNTDOWN_MINUTES = 25;
const FOCUS_CONFIG_DRAFT_STORAGE_KEY =
  "exomind:focus-timer:config-draft:v1";
const FOCUS_CONFIG_DRAFT_MAX_AGE_MS = 30 * 60 * 1000;

interface FocusConfigDraftSnapshot {
  taskNameDraft: string;
  timerMode: TimerMode;
  countdownMinutes: number;
  selectedTaskIds: string[];
  inputFocused: boolean;
  updatedAt: number;
}

function resolveActiveTaskIds(block: ActiveBlockData | null): string[] {
  return resolveActiveBlockTaskIds(block);
}

function getFocusConfigDraftStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function normalizeCountdownMinutes(value: unknown): number {
  const parsed =
    typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_COUNTDOWN_MINUTES;
  return Math.max(1, Math.min(MAX_CUSTOM_COUNTDOWN_MINUTES, Math.round(parsed)));
}

function isFocusConfigDraftMeaningful(
  snapshot: FocusConfigDraftSnapshot,
): boolean {
  return (
    snapshot.inputFocused ||
    snapshot.taskNameDraft.trim().length > 0 ||
    snapshot.selectedTaskIds.length > 0 ||
    snapshot.timerMode !== "countdown" ||
    snapshot.countdownMinutes !== DEFAULT_COUNTDOWN_MINUTES
  );
}

function normalizeFocusConfigDraftSnapshot(
  value: unknown,
): FocusConfigDraftSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const updatedAt =
    typeof candidate.updatedAt === "number"
      ? candidate.updatedAt
      : Number(candidate.updatedAt);
  if (!Number.isFinite(updatedAt)) return null;
  if (Date.now() - updatedAt > FOCUS_CONFIG_DRAFT_MAX_AGE_MS) return null;

  const timerMode: TimerMode =
    candidate.timerMode === "countup" ? "countup" : "countdown";
  const snapshot: FocusConfigDraftSnapshot = {
    taskNameDraft:
      typeof candidate.taskNameDraft === "string"
        ? candidate.taskNameDraft
        : "",
    timerMode,
    countdownMinutes: normalizeCountdownMinutes(candidate.countdownMinutes),
    selectedTaskIds: normalizePreselectedTaskIds(
      Array.isArray(candidate.selectedTaskIds)
        ? candidate.selectedTaskIds.filter(
            (taskId): taskId is string => typeof taskId === "string",
          )
        : [],
    ),
    inputFocused: candidate.inputFocused === true,
    updatedAt,
  };

  return isFocusConfigDraftMeaningful(snapshot) ? snapshot : null;
}

function readFocusConfigDraftSnapshot(): FocusConfigDraftSnapshot | null {
  const storage = getFocusConfigDraftStorage();
  if (!storage) return null;

  try {
    const rawValue = storage.getItem(FOCUS_CONFIG_DRAFT_STORAGE_KEY);
    if (!rawValue) return null;
    const snapshot = normalizeFocusConfigDraftSnapshot(JSON.parse(rawValue));
    if (!snapshot) {
      storage.removeItem(FOCUS_CONFIG_DRAFT_STORAGE_KEY);
    }
    return snapshot;
  } catch {
    storage.removeItem(FOCUS_CONFIG_DRAFT_STORAGE_KEY);
    return null;
  }
}

function writeFocusConfigDraftSnapshot(
  snapshot: FocusConfigDraftSnapshot,
): void {
  const storage = getFocusConfigDraftStorage();
  if (!storage) return;

  try {
    if (!isFocusConfigDraftMeaningful(snapshot)) {
      storage.removeItem(FOCUS_CONFIG_DRAFT_STORAGE_KEY);
      return;
    }
    storage.setItem(FOCUS_CONFIG_DRAFT_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Ignore storage quota / permission failures; in-memory state still wins.
  }
}

function clearFocusConfigDraftSnapshot(): void {
  const storage = getFocusConfigDraftStorage();
  if (!storage) return;
  try {
    storage.removeItem(FOCUS_CONFIG_DRAFT_STORAGE_KEY);
  } catch {
    // Ignore storage permission failures.
  }
}

function buildTaskStatusChoices(
  taskIds: string[],
  previousChoices: Record<string, TaskStatusChoice> = {},
): Record<string, TaskStatusChoice> {
  return taskIds.reduce<Record<string, TaskStatusChoice>>(
    (nextChoices, taskId) => {
      nextChoices[taskId] = normalizeEndTaskStatusChoice(
        previousChoices[taskId],
      );
      return nextChoices;
    },
    {},
  );
}

function normalizePreselectedTaskIds(taskIds: string[] | undefined): string[] {
  if (!taskIds) {
    return [];
  }
  return Array.from(
    new Set(taskIds.map((taskId) => taskId.trim()).filter(Boolean)),
  );
}

export const FocusTimerWidget = forwardRef<
  FocusTimerWidgetHandle,
  FocusTimerWidgetProps
>(function FocusTimerWidget(
  {
    surface = "default",
    overlayRunningChrome,
    prestartSelectedTaskIds,
    onPrestartSelectedTaskIdsChange,
    showRunningLinkedTasks = true,
    taskAssociationsEnabled = true,
    keepAwakeControl,
  },
  ref,
) {
  const timeBlockServiceRef = useRef(getTimeBlockService());
  const mutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const frameRef = useRef<number | null>(null);
  const taskInputRef = useRef<HTMLTextAreaElement | null>(null);
  const customDurationInputRef = useRef<HTMLInputElement | null>(null);
  const runningNameInputRef = useRef<HTMLInputElement | null>(null);
  const countdownEndedRef = useRef(false);
  const countdownOverrunRef = useRef(false);
  const hardEndTriggeredRef = useRef(false);
  const linkedTasksLoadRequestRef = useRef(0);
  const uiStateRef = useRef<FocusUiState>("idle");
  const taskNameDraftRef = useRef("");
  const timerModeRef = useRef<TimerMode>("countdown");
  const countdownMinutesRef = useRef(DEFAULT_COUNTDOWN_MINUTES);
  const selectedTaskIdsRef = useRef<string[]>([]);
  const taskInputFocusIntentRef = useRef(false);
  const localStartInFlightRef = useRef(false);
  const locallyEndedStartIdsRef = useRef<Set<string>>(new Set());
  const isRunningNameEditingRef = useRef(false);
  const runningNameSaveInFlightRef = useRef(false);
  const initialConfigDraftRef = useRef<
    FocusConfigDraftSnapshot | null | undefined
  >(undefined);
  if (initialConfigDraftRef.current === undefined) {
    const restoredDraft = readFocusConfigDraftSnapshot();
    initialConfigDraftRef.current = restoredDraft;
    taskInputFocusIntentRef.current = restoredDraft?.inputFocused ?? false;
  }
  const initialConfigDraft = initialConfigDraftRef.current;

  const [uiState, setUiState] = useState<FocusUiState>(
    initialConfigDraft?.inputFocused ? "config" : "idle",
  );
  const setFocusUiState = useCallback((nextState: FocusUiState) => {
    uiStateRef.current = nextState;
    setUiState(nextState);
  }, []);
  const [runningSubState, setRunningSubState] =
    useState<RunningSubState>("running");

  const [taskNameDraft, setTaskNameDraft] = useState(
    initialConfigDraft?.taskNameDraft ?? "",
  );
  const [taskName, setTaskName] = useState("");
  const [runningNameDraft, setRunningNameDraft] = useState("");
  const [isRunningNameEditing, setIsRunningNameEditingState] = useState(false);
  const [isRunningNameSaving, setIsRunningNameSaving] = useState(false);
  const [timerMode, setTimerMode] = useState<TimerMode>(
    initialConfigDraft?.timerMode ?? "countdown",
  );
  const [countdownMinutes, setCountdownMinutes] = useState(
    initialConfigDraft?.countdownMinutes ?? DEFAULT_COUNTDOWN_MINUTES,
  );
  const [customDurationDraft, setCustomDurationDraft] = useState(
    String(initialConfigDraft?.countdownMinutes ?? DEFAULT_COUNTDOWN_MINUTES),
  );
  const [isCustomDurationEditing, setIsCustomDurationEditing] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(
    (initialConfigDraft?.timerMode ?? "countdown") === "countdown"
      ? (initialConfigDraft?.countdownMinutes ?? DEFAULT_COUNTDOWN_MINUTES) *
          60 *
          1000
      : 0,
  );
  const [countdownOvertimeMs, setCountdownOvertimeMs] = useState(0);
  const [timerPreferences, setTimerPreferences] = useState(() =>
    getTimerPreferences(),
  );
  const [focusBgmPreferences, setFocusBgmPreferences] = useState(() =>
    getFocusBgmPreferences(),
  );
  const [focusBgmDialogOpen, setFocusBgmDialogOpen] = useState(false);

  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [feedbackInProgress, setFeedbackInProgress] = useState(false);
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const selectableTasks = usePrestartSelectableTasks(taskAssociationsEnabled);
  const [internalSelectedTaskIds, setInternalSelectedTaskIds] = useState<
    string[]
  >(taskAssociationsEnabled ? initialConfigDraft?.selectedTaskIds ?? [] : []);
  const {
    canSubmitFeedback,
    handleFeedbackKeyDown,
    isSkipFeedbackCoolingDown,
    resetSkipFeedbackConfirm,
    skipFeedbackConfirmState,
    skipFeedbackCountdownSec,
  } = useFeedbackSubmitControls({ submitMode: "ctrl-enter-only" });

  // Task status selector in feedback dialog
  const activeBlockDataRef = useRef<ActiveBlockData | null>(null);
  const taskStatusChoiceBlockRef = useRef<string | null>(null);
  const [linkedTasks, setLinkedTasks] = useState<TaskNode[]>([]);
  const [taskStatusChoices, setTaskStatusChoices] = useState<
    Record<string, TaskStatusChoice>
  >({});

  const isRunningUi = uiState === "running";
  uiStateRef.current = uiState;
  const isPaused = isRunningUi && runningSubState === "paused";
  const runningNameDisplayText = formatRunningBlockName(taskName);

  const setRunningNameEditing = useCallback((nextEditing: boolean) => {
    isRunningNameEditingRef.current = nextEditing;
    setIsRunningNameEditingState(nextEditing);
  }, []);
  const isCountdownOvertime =
    timerMode === "countdown" && countdownOverrunRef.current;
  const isCountdownWarning =
    timerMode === "countdown" &&
    (isCountdownOvertime || (elapsedMs <= 60000 && elapsedMs > 0));
  const countdownEndTimeDisplay = isRunningUi
    ? resolveCountdownEndTimeDisplay({
        block: activeBlockDataRef.current,
        mode: timerMode,
        remainingMs: timerMode === "countdown" ? elapsedMs : undefined,
        overtimeMs: isCountdownOvertime ? countdownOvertimeMs : 0,
        paused: isPaused,
        isActionEnded: feedbackInProgress,
        now: Date.now(),
      })
    : null;
  const selectedTaskIds = taskAssociationsEnabled
    ? prestartSelectedTaskIds ?? internalSelectedTaskIds
    : [];
  taskNameDraftRef.current = taskNameDraft;
  timerModeRef.current = timerMode;
  countdownMinutesRef.current = countdownMinutes;
  selectedTaskIdsRef.current = selectedTaskIds;
  const setSelectedTaskIds = useCallback(
    (nextValue: string[] | ((current: string[]) => string[])) => {
      const resolvedValue = taskAssociationsEnabled
        ? normalizePreselectedTaskIds(
            typeof nextValue === "function"
              ? nextValue(selectedTaskIds)
              : nextValue,
          )
        : [];
      if (onPrestartSelectedTaskIdsChange) {
        onPrestartSelectedTaskIdsChange(resolvedValue);
        return;
      }
      setInternalSelectedTaskIds(resolvedValue);
    },
    [onPrestartSelectedTaskIdsChange, selectedTaskIds, taskAssociationsEnabled],
  );
  const syncIdleElapsedFromMode = useCallback(
    (mode: TimerMode, minutes: number) => {
      setElapsedMs(mode === "countdown" ? minutes * 60 * 1000 : 0);
    },
    [],
  );

  const focusTaskInput = useCallback(() => {
    taskInputFocusIntentRef.current = true;
    requestAnimationFrame(() => {
      taskInputRef.current?.focus();
    });
  }, []);

  const buildCurrentConfigDraftSnapshot = useCallback(
    (
      overrides: Partial<
        Omit<FocusConfigDraftSnapshot, "updatedAt">
      > = {},
    ): FocusConfigDraftSnapshot => ({
      taskNameDraft: taskNameDraftRef.current,
      timerMode: timerModeRef.current,
      countdownMinutes: countdownMinutesRef.current,
      inputFocused: taskInputFocusIntentRef.current,
      ...overrides,
      selectedTaskIds: taskAssociationsEnabled
        ? overrides.selectedTaskIds ?? selectedTaskIdsRef.current
        : [],
      updatedAt: Date.now(),
    }),
    [taskAssociationsEnabled],
  );

  const persistCurrentConfigDraft = useCallback(
    (
      overrides: Partial<
        Omit<FocusConfigDraftSnapshot, "updatedAt">
      > = {},
    ) => {
      writeFocusConfigDraftSnapshot(
        buildCurrentConfigDraftSnapshot(overrides),
      );
    },
    [buildCurrentConfigDraftSnapshot],
  );

  const restoreConfigDraftSnapshot = useCallback(
    (snapshot: FocusConfigDraftSnapshot): void => {
      const normalizedSnapshot: FocusConfigDraftSnapshot = {
        taskNameDraft: snapshot.taskNameDraft,
        timerMode: snapshot.timerMode,
        countdownMinutes: normalizeCountdownMinutes(snapshot.countdownMinutes),
        selectedTaskIds: taskAssociationsEnabled
          ? normalizePreselectedTaskIds(snapshot.selectedTaskIds)
          : [],
        inputFocused: snapshot.inputFocused,
        updatedAt: Date.now(),
      };
      activeBlockDataRef.current = null;
      linkedTasksLoadRequestRef.current += 1;
      taskStatusChoiceBlockRef.current = null;
      setTaskName("");
      setTaskNameDraft(normalizedSnapshot.taskNameDraft);
      setTimerMode(normalizedSnapshot.timerMode);
      setCountdownMinutes(normalizedSnapshot.countdownMinutes);
      setCustomDurationDraft(String(normalizedSnapshot.countdownMinutes));
      setSelectedTaskIds(normalizedSnapshot.selectedTaskIds);
      setFeedbackOpen(false);
      setFeedbackInProgress(false);
      setFeedbackSubmitting(false);
      resetSkipFeedbackConfirm();
      countdownEndedRef.current = false;
      countdownOverrunRef.current = false;
      hardEndTriggeredRef.current = false;
      setCountdownOvertimeMs(0);
      syncIdleElapsedFromMode(
        normalizedSnapshot.timerMode,
        normalizedSnapshot.countdownMinutes,
      );
      setLinkedTasks([]);
      setTaskStatusChoices({});
      setRunningSubState("running");
      setFocusUiState("config");
      taskInputFocusIntentRef.current = normalizedSnapshot.inputFocused;
      writeFocusConfigDraftSnapshot({
        ...normalizedSnapshot,
        updatedAt: Date.now(),
      });
      if (normalizedSnapshot.inputFocused) {
        focusTaskInput();
      }
    },
    [
      focusTaskInput,
      resetSkipFeedbackConfirm,
      setFocusUiState,
      setSelectedTaskIds,
      syncIdleElapsedFromMode,
      taskAssociationsEnabled,
    ],
  );

  const buildProtectedLocalConfigDraftSnapshot = useCallback(() => {
    if (uiStateRef.current !== "config") return null;
    const activeElement =
      typeof document === "undefined" ? null : document.activeElement;
    const inputFocused =
      activeElement === taskInputRef.current || taskInputFocusIntentRef.current;
    const snapshot = buildCurrentConfigDraftSnapshot({ inputFocused });
    return isFocusConfigDraftMeaningful(snapshot) ? snapshot : null;
  }, [buildCurrentConfigDraftSnapshot]);

  const persistProtectedLocalConfigDraft = useCallback(() => {
    const snapshot = buildProtectedLocalConfigDraftSnapshot();
    if (!snapshot) return null;
    taskInputFocusIntentRef.current = snapshot.inputFocused;
    writeFocusConfigDraftSnapshot(snapshot);
    return snapshot;
  }, [buildProtectedLocalConfigDraftSnapshot]);

  const preserveProtectedLocalConfigDraft = useCallback(() => {
    const snapshot = persistProtectedLocalConfigDraft();
    if (!snapshot) return null;
    if (snapshot.inputFocused) {
      focusTaskInput();
    }
    return snapshot;
  }, [focusTaskInput, persistProtectedLocalConfigDraft]);

  const rememberLocallyEndedStartId = useCallback((startId: string) => {
    const nextStartIds = new Set(locallyEndedStartIdsRef.current);
    nextStartIds.add(startId);
    locallyEndedStartIdsRef.current = new Set(
      Array.from(nextStartIds).slice(-20),
    );
  }, []);

  const enterConfigState = useCallback(() => {
    if (isRunningUi) return;
    taskInputFocusIntentRef.current = true;
    const storedDraft = readFocusConfigDraftSnapshot();
    if (storedDraft) {
      restoreConfigDraftSnapshot({ ...storedDraft, inputFocused: true });
      return;
    }
    setFocusUiState("config");
    focusTaskInput();
  }, [focusTaskInput, isRunningUi, restoreConfigDraftSnapshot, setFocusUiState]);

  useEffect(() => {
    const initialDraft = initialConfigDraftRef.current;
    if (initialDraft?.inputFocused && uiStateRef.current === "config") {
      focusTaskInput();
    }
  }, [focusTaskInput]);

  useEffect(() => {
    if (uiState === "running") return;
    persistCurrentConfigDraft({
      inputFocused: uiState === "config" && taskInputFocusIntentRef.current,
    });
  }, [
    countdownMinutes,
    persistCurrentConfigDraft,
    selectedTaskIds,
    taskNameDraft,
    timerMode,
    uiState,
  ]);

  useEffect(() => {
    const selectableTaskIdSet = new Set(selectableTasks.map((task) => task.id));
    setSelectedTaskIds((current) =>
      current.filter((taskId) => selectableTaskIdSet.has(taskId)),
    );
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
    const preset = getTimerEndSoundPresetById(
      timerPreferences.countdownEndSoundPresetId,
    );
    log.warn(`[TimerSound] play preset=${preset.id} url=${preset.url}`);
    try {
      const audio = new Audio(preset.url);
      audio.loop = false;
      audio.preload = "auto";
      audio.currentTime = 0;
      await audio.play();
      log.warn(`[TimerSound] play:ok preset=${preset.id}`);
    } catch (e) {
      log.warn(
        `[TimerSound] play:error preset=${preset.id} error=${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }, [
    timerPreferences.countdownEndSoundEnabled,
    timerPreferences.countdownEndSoundPresetId,
  ]);

  const applyActiveBlock = useCallback(
    (block: ActiveBlockData | null) => {
      const visibleBlock = block && isRenderableActiveBlock(block) ? block : null;
      if (
        visibleBlock &&
        locallyEndedStartIdsRef.current.has(visibleBlock.startId)
      ) {
        return;
      }

      if (!visibleBlock) {
        const preservedDraft = preserveProtectedLocalConfigDraft();
        if (preservedDraft) {
          return;
        }
        const storedDraft = readFocusConfigDraftSnapshot();
        activeBlockDataRef.current = null;
        taskInputFocusIntentRef.current = storedDraft?.inputFocused ?? false;
        linkedTasksLoadRequestRef.current += 1;
        taskStatusChoiceBlockRef.current = null;
        setFocusUiState(storedDraft?.inputFocused ? "config" : "idle");
        setRunningSubState("running");
        setTaskName("");
        setRunningNameDraft("");
        setRunningNameEditing(false);
        setIsRunningNameSaving(false);
        runningNameSaveInFlightRef.current = false;
        setTaskNameDraft(storedDraft?.taskNameDraft ?? "");
        if (storedDraft) {
          setTimerMode(storedDraft.timerMode);
          setCountdownMinutes(storedDraft.countdownMinutes);
          setCustomDurationDraft(String(storedDraft.countdownMinutes));
          setSelectedTaskIds(storedDraft.selectedTaskIds);
        } else {
          setSelectedTaskIds([]);
        }
        setFeedbackOpen(false);
        setFeedbackInProgress(false);
        setFeedbackSubmitting(false);
        resetSkipFeedbackConfirm();
        countdownEndedRef.current = false;
        countdownOverrunRef.current = false;
        hardEndTriggeredRef.current = false;
        setCountdownOvertimeMs(0);
        syncIdleElapsedFromMode(
          storedDraft?.timerMode ?? timerMode,
          storedDraft?.countdownMinutes ?? countdownMinutes,
        );
        setLinkedTasks([]);
        setTaskStatusChoices({});
        if (storedDraft?.inputFocused) {
          focusTaskInput();
        }
        return;
      }

      const protectedDraft = localStartInFlightRef.current
        ? null
        : persistProtectedLocalConfigDraft();
      const storedDraft = protectedDraft ?? readFocusConfigDraftSnapshot();

      if (!storedDraft) {
        clearFocusConfigDraftSnapshot();
      }
      taskInputFocusIntentRef.current = false;
      activeBlockDataRef.current = visibleBlock;
      const resolvedTaskIds = taskAssociationsEnabled
        ? resolveActiveTaskIds(visibleBlock)
        : [];
      const taskLoadRequestId = linkedTasksLoadRequestRef.current + 1;
      linkedTasksLoadRequestRef.current = taskLoadRequestId;

      if (resolvedTaskIds.length > 0) {
        void Promise.all(
          resolvedTaskIds.map((taskId) => getTaskService().getTask(taskId)),
        )
          .then((tasks) => {
            if (linkedTasksLoadRequestRef.current !== taskLoadRequestId) {
              return;
            }
            setLinkedTasks(
              tasks.filter((task): task is TaskNode => task !== null),
            );
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
        if (taskStatusChoiceBlockRef.current !== visibleBlock.startId) {
          taskStatusChoiceBlockRef.current = visibleBlock.startId;
          return buildTaskStatusChoices(resolvedTaskIds);
        }
        return buildTaskStatusChoices(resolvedTaskIds, previousChoices);
      });

      setTaskName(visibleBlock.name);
      if (!isRunningNameEditingRef.current) {
        setRunningNameDraft(visibleBlock.name);
      }
      setTaskNameDraft(visibleBlock.name);
      setTimerMode(visibleBlock.mode ?? "countup");
      if (visibleBlock.mode === "countdown" && visibleBlock.targetMinutes) {
        setCountdownMinutes(visibleBlock.targetMinutes);
      }
      const restoredOverrunMs =
        visibleBlock.mode === "countdown" &&
        timerPreferences.countdownEndMode === "soft"
          ? resolveCountdownOverrunMs(visibleBlock)
          : 0;
      const hasRestoredOverrun = restoredOverrunMs > 0;
      setElapsedMs(
        visibleBlock.mode === "countdown" && hasRestoredOverrun
          ? 0
          : Math.max(0, visibleBlock.elapsed ?? 0),
      );
      const nextFeedbackInProgress = isFeedbackStage(visibleBlock);
      setFeedbackInProgress(nextFeedbackInProgress);
      setFeedbackSubmitting(false);
      resetSkipFeedbackConfirm();
      setFocusUiState("running");
      setRunningSubState(
        nextFeedbackInProgress || visibleBlock.paused ? "paused" : "running",
      );
      hardEndTriggeredRef.current = nextFeedbackInProgress;
      countdownEndedRef.current = hasRestoredOverrun;
      countdownOverrunRef.current = hasRestoredOverrun;
      setCountdownOvertimeMs(hasRestoredOverrun ? restoredOverrunMs : 0);
    },
    [
      countdownMinutes,
      focusTaskInput,
      persistProtectedLocalConfigDraft,
      preserveProtectedLocalConfigDraft,
      resetSkipFeedbackConfirm,
      setFocusUiState,
      setRunningNameEditing,
      syncIdleElapsedFromMode,
      timerMode,
      timerPreferences.countdownEndMode,
    ],
  );

  useEffect(() => {
    let cancelled = false;
    const unsubscribe = timeBlockServiceRef.current.onBlockChange((block) => {
      if (cancelled) {
        return;
      }
      applyActiveBlock(block);
    });

    const load = async () => {
      const block = await timeBlockServiceRef.current.loadActiveBlock();
      if (cancelled) return;
      if (block) {
        applyActiveBlock(block);
      }
    };

    void load();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [applyActiveBlock, taskAssociationsEnabled]);

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
      if (timerMode === "countdown" && countdownOverrunRef.current) {
        setCountdownOvertimeMs((prev) => prev + delta);
        frameRef.current = requestAnimationFrame(tick);
        return;
      }

      setElapsedMs((previous) => {
        const next =
          timerMode === "countdown" ? previous - delta : previous + delta;

        if (timerMode === "countdown" && next <= 0) {
          const overshoot = Math.max(0, -next);
          if (!countdownEndedRef.current) {
            countdownEndedRef.current = true;
            if (previous > 0) {
              void playCountdownEndSound();
            }
          }

          if (timerPreferences.countdownEndMode === "soft") {
            countdownOverrunRef.current = true;
            setCountdownOvertimeMs(overshoot);
            return 0;
          }

          if (!hardEndTriggeredRef.current) {
            hardEndTriggeredRef.current = true;
            void timeBlockServiceRef.current.markEnding();
            setRunningSubState("paused");
            setFeedbackOpen(true);
          }
          return 0;
        }

        return timerMode === "countdown" ? Math.max(0, next) : next;
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
  }, [
    isPaused,
    isRunningUi,
    playCountdownEndSound,
    timerMode,
    timerPreferences.countdownEndMode,
  ]);

  useEffect(() => {
    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (uiState !== "idle") return;
    countdownEndedRef.current = false;
    countdownOverrunRef.current = false;
    hardEndTriggeredRef.current = false;
    setCountdownOvertimeMs(0);
    syncIdleElapsedFromMode(timerMode, countdownMinutes);
  }, [countdownMinutes, syncIdleElapsedFromMode, timerMode, uiState]);

  const handleStart = useCallback(async (timerConfigOverride?: TimerConfig) => {
    const config: TimerConfig =
      timerConfigOverride ??
      {
        mode: timerMode,
        minutes: timerMode === "countdown" ? countdownMinutes : undefined,
      };
    const trace = new PerfTrace("TB-UI startBlock", {
      component: "FocusTimerWidget",
      timerMode: config.mode,
      selectedTaskCount: selectedTaskIds.length,
    });
    const lines = taskNameDraft.split(/\r?\n/);
    const name = (lines[0] ?? "").trim();
    const description = lines.slice(1).join("\n").trim();
    if (!name) {
      focusTaskInput();
      return;
    }

    countdownEndedRef.current = false;
    countdownOverrunRef.current = false;
    hardEndTriggeredRef.current = false;
    setCountdownOvertimeMs(0);
    trace.step("prepare-start", {
      hasDescription: description.length > 0,
      countdownMinutes: config.mode === "countdown" ? config.minutes : null,
    });

    const selectedTasks = taskAssociationsEnabled
      ? selectedTaskIds
          .map((taskId) => selectableTasks.find((task) => task.id === taskId))
          .filter((task): task is TaskNode => Boolean(task))
      : [];
    const selectedIdsForStart = selectedTasks.map((task) => task.id);
    const skippedTaskIds = selectedTaskIds.filter(
      (taskId) => !selectedIdsForStart.includes(taskId),
    );
    if (skippedTaskIds.length > 0) {
      log.warn(
        `[TB-UI] prestart selection skipped ${JSON.stringify({ skippedTaskIds })}`,
      );
    }
    trace.step("resolve-selected-tasks", {
      selectedTaskCount: selectedTasks.length,
      skippedTaskCount: skippedTaskIds.length,
    });

    localStartInFlightRef.current = true;
    try {
      let transitionedTaskCount = 0;
      for (const task of selectedTasks) {
        if (task.status === "pending" || task.status === "suspended") {
          await getTaskService().transitionTask(task.id, "in_progress");
          transitionedTaskCount += 1;
        }
      }
      trace.step("prestart-task-transitions", {
        transitionedTaskCount,
      });

      const block =
        selectedIdsForStart.length > 0
          ? await timeBlockServiceRef.current.startBlock(
              name,
              config,
              description || undefined,
              { taskIds: selectedIdsForStart },
              {
                traceId: trace.traceId,
                trigger: "FocusTimerWidget.handleStart",
                source: "focus-timer",
              },
            )
          : await timeBlockServiceRef.current.startBlock(
              name,
              config,
              description || undefined,
              undefined,
              {
                traceId: trace.traceId,
                trigger: "FocusTimerWidget.handleStart",
                source: "focus-timer",
              },
            );
      trace.step("service-start-block", {
        startId: block.startId,
      });
      clearFocusConfigDraftSnapshot();
      taskInputFocusIntentRef.current = false;
      activeBlockDataRef.current = block;
      setTaskName(name);
      setTaskNameDraft(name);
      setElapsedMs(Math.max(0, block.elapsed ?? 0));
      setFeedbackInProgress(false);
      setRunningSubState("running");
      setFocusUiState("running");
      trace.step("apply-ui-running-state", {
        startId: block.startId,
      });
      // Measure when the new active-block state is actually visible, not just when service work returns.
      await waitForNextPaint();
      trace.step("notify-to-paint", {
        startId: block.startId,
      });
      trace.finish({
        startId: block.startId,
        startBlockClickToDoneMs: trace.totalMs(),
      });
    } catch (error) {
      trace.fail(error);
      throw error;
    } finally {
      localStartInFlightRef.current = false;
    }
  }, [
    countdownMinutes,
    focusTaskInput,
    selectableTasks,
    selectedTaskIds,
    taskAssociationsEnabled,
    setFocusUiState,
    taskNameDraft,
    timerMode,
  ]);

  const handleTaskInputKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (!isQuickStartKeyEvent(event)) return;

      event.preventDefault();
      void handleStart();
    },
    [handleStart],
  );

  const handleExpectedTimeKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!isQuickStartKeyEvent(event)) return;

      event.preventDefault();
      void handleStart();
    },
    [handleStart],
  );

  const handleCollapseToIdle = useCallback(() => {
    if (uiState !== "config") return;
    taskInputFocusIntentRef.current = false;
    persistCurrentConfigDraft({ inputFocused: false });
    setIsCustomDurationEditing(false);
    setFocusUiState("idle");
  }, [persistCurrentConfigDraft, setFocusUiState, uiState]);

  const handleOpenCustomDurationEditor = useCallback(() => {
    setIsCustomDurationEditing(true);
    requestAnimationFrame(() => {
      customDurationInputRef.current?.focus();
      customDurationInputRef.current?.select();
    });
  }, []);

  const applyCustomDuration = useCallback(
    (rawValue: string) => {
      const safeMinutes = parseCustomDurationMinutes(rawValue);
      if (safeMinutes !== null) {
        setTimerMode("countdown");
        setCountdownMinutes(safeMinutes);
        setCustomDurationDraft(String(safeMinutes));
      } else {
        setCustomDurationDraft(String(countdownMinutes));
      }
      setIsCustomDurationEditing(false);
    },
    [countdownMinutes],
  );

  const handleCustomDurationKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (isQuickStartKeyEvent(event)) {
        event.preventDefault();
        event.stopPropagation();
        const safeMinutes =
          parseCustomDurationMinutes(event.currentTarget.value) ??
          countdownMinutes;
        setTimerMode("countdown");
        setCountdownMinutes(safeMinutes);
        setCustomDurationDraft(String(safeMinutes));
        setIsCustomDurationEditing(false);
        void handleStart({ mode: "countdown", minutes: safeMinutes });
        return;
      }

      if (event.nativeEvent.isComposing) return;
      if (event.key === "Enter") {
        event.preventDefault();
        applyCustomDuration(event.currentTarget.value);
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setCustomDurationDraft(String(countdownMinutes));
        setIsCustomDurationEditing(false);
      }
    },
    [applyCustomDuration, countdownMinutes, handleStart],
  );

  const enqueueServiceMutation = useCallback(
    (label: string, execute: () => Promise<void>): void => {
      mutationQueueRef.current = mutationQueueRef.current.then(async () => {
        try {
          await execute();
        } catch (error) {
          log.error(
            `[TB-UI] ${label} failed ${error instanceof Error ? error.message : String(error)}`,
          );
          try {
            const block = await timeBlockServiceRef.current.loadActiveBlock();
            applyActiveBlock(block);
          } catch (reloadError) {
            log.error(
              `[TB-UI] ${label} recover failed ${reloadError instanceof Error ? reloadError.message : String(reloadError)}`,
            );
          }
        }
      });
    },
    [applyActiveBlock],
  );

  const handleBeginRunningNameEdit = useCallback(() => {
    if (!isRunningUi || feedbackInProgress) return;
    setRunningNameDraft(formatRunningBlockName(taskName));
    setRunningNameEditing(true);
    requestAnimationFrame(() => {
      runningNameInputRef.current?.focus();
      runningNameInputRef.current?.select();
    });
  }, [feedbackInProgress, isRunningUi, setRunningNameEditing, taskName]);

  const handleCancelRunningNameEdit = useCallback(() => {
    setRunningNameDraft(taskName);
    setRunningNameEditing(false);
  }, [setRunningNameEditing, taskName]);

  const appendRunningNameRenameEvent = useCallback(
    async (
      block: ActiveBlockData,
      previousName: string,
      nextName: string,
    ) => {
      try {
        await getEventLogService().appendEventData({
          id: createUuidV4(),
          timestamp: Date.now(),
          content: `时间块改名：${formatRunningBlockName(previousName)} → ${formatRunningBlockName(nextName)}`,
          tags: ["block_rename"],
          metadata: {
            source: getEventSourceMetadata(),
            blockId: block.startId,
            previousName,
            nextName,
            recordType: "timeblock_rename",
          },
        });
      } catch (error) {
        log.error(
          `[TB-UI] append timeblock rename event failed ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
    [],
  );

  const handleSubmitRunningName = useCallback(async () => {
    if (runningNameSaveInFlightRef.current) return;
    const activeBlock = activeBlockDataRef.current;
    if (!activeBlock) {
      setRunningNameEditing(false);
      return;
    }

    const previousName = activeBlock.name;
    const nextName =
      runningNameDraft.trim() || formatRunningBlockName(previousName);
    setRunningNameDraft(nextName);
    if (nextName === previousName) {
      setRunningNameEditing(false);
      return;
    }

    runningNameSaveInFlightRef.current = true;
    setIsRunningNameSaving(true);
    try {
      await mutationQueueRef.current;
      const updated = await timeBlockServiceRef.current.updateActiveBlock({
        name: nextName,
      });
      if (!updated) {
        throw new Error("updateActiveBlock returned null");
      }
      applyActiveBlock(updated);
      setRunningNameEditing(false);
      await appendRunningNameRenameEvent(updated, previousName, updated.name);
    } catch (error) {
      log.error(
        `[TB-UI] rename active block failed ${error instanceof Error ? error.message : String(error)}`,
      );
      setRunningNameEditing(false);
      try {
        const block = await timeBlockServiceRef.current.loadActiveBlock();
        applyActiveBlock(block);
      } catch (reloadError) {
        log.error(
          `[TB-UI] rename active block recover failed ${reloadError instanceof Error ? reloadError.message : String(reloadError)}`,
        );
      }
    } finally {
      runningNameSaveInFlightRef.current = false;
      setIsRunningNameSaving(false);
    }
  }, [
    appendRunningNameRenameEvent,
    applyActiveBlock,
    runningNameDraft,
    setRunningNameEditing,
  ]);

  const handleRunningNameKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        handleCancelRunningNameEdit();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        void handleSubmitRunningName();
      }
    },
    [handleCancelRunningNameEdit, handleSubmitRunningName],
  );

  const handlePauseOrResume = useCallback(async () => {
    if (!isRunningUi) return;
    if (feedbackInProgress) return;

    if (runningSubState === "running") {
      const t0 = perfNow();
      logPerfInfo("[TB-UI] click pause -> pauseBlock start");
      setRunningSubState("paused");
      enqueueServiceMutation("pauseBlock", async () => {
        await timeBlockServiceRef.current.pauseBlock();
        logPerfInfo(
          `[TB-UI] click pause -> pauseBlock done ${JSON.stringify({ elapsedMs: Math.round(perfNow() - t0) })}`,
        );
      });
      return;
    }

    const t0 = perfNow();
    logPerfInfo("[TB-UI] click resume -> resumeBlock start");
    setRunningSubState("running");
    enqueueServiceMutation("resumeBlock", async () => {
      await timeBlockServiceRef.current.resumeBlock();
      logPerfInfo(
        `[TB-UI] click resume -> resumeBlock done ${JSON.stringify({ elapsedMs: Math.round(perfNow() - t0) })}`,
      );
    });
  }, [
    enqueueServiceMutation,
    feedbackInProgress,
    isRunningUi,
    runningSubState,
  ]);

  const handleOpenEndDialog = useCallback(() => {
    if (!isRunningUi) return;
    if (feedbackInProgress) {
      setFeedbackOpen(true);
      return;
    }
    const t0 = perfNow();
    logPerfInfo("[TB-UI] click end -> markEnding start");
    setRunningSubState("paused");
    setFeedbackInProgress(true);
    enqueueServiceMutation("markEnding", async () => {
      await timeBlockServiceRef.current.markEnding();
      logPerfInfo(
        `[TB-UI] click end -> markEnding done ${JSON.stringify({ elapsedMs: Math.round(perfNow() - t0) })}`,
      );
    });
    setFeedbackOpen(true);
  }, [enqueueServiceMutation, feedbackInProgress, isRunningUi]);

  const hasFocusBgmConfigured =
    focusBgmPreferences.enabled &&
    (focusBgmPreferences.sourceType === "preset" ||
      focusBgmPreferences.customTracks.length > 0);
  const showKeepAwakeButton =
    surface !== "overlay" && Boolean(keepAwakeControl?.visible);
  const handleSubmitEnd = useCallback(
    async (feedbackText?: string) => {
      if (feedbackSubmitting) return;
      const trimmedFeedback = feedbackText?.trim() ?? "";
      const blockDataSnapshot = activeBlockDataRef.current;
      const taskIdsSnapshot = taskAssociationsEnabled
        ? resolveActiveTaskIds(blockDataSnapshot)
        : [];
      const linkedTasksSnapshot = taskAssociationsEnabled ? linkedTasks : [];
      const taskStatusChoicesSnapshot = { ...taskStatusChoices };
      const taskTitles = linkedTasksSnapshot.reduce<Record<string, string>>(
        (titles, task) => {
          titles[task.id] = task.title;
          return titles;
        },
        {},
      );
      const taskStatusOutcomes = taskIdsSnapshot.reduce<Record<string, string>>(
        (outcomes, taskId) => {
          const statusChoice = normalizeEndTaskStatusChoice(
            taskStatusChoicesSnapshot[taskId],
          );
          outcomes[taskId] = statusChoice;
          return outcomes;
        },
        {},
      );
      if (!canSubmitFeedback(trimmedFeedback)) {
        return;
      }
      setFeedbackSubmitting(true);

      const trace = new PerfTrace("TB-UI submitEnd", {
        component: "FocusTimerWidget",
        taskCount: taskIdsSnapshot.length,
        hasFeedback: trimmedFeedback.length > 0,
      });
      logPerfInfo("[TB-UI] click submit-end -> endBlock start");
      trace.step("prepare-submit", {
        feedbackLength: trimmedFeedback.length,
        taskCount: taskIdsSnapshot.length,
      });

      try {
        await mutationQueueRef.current;
        trace.step("await-mutation-queue");
        if (taskIdsSnapshot.length > 0) {
          await timeBlockServiceRef.current.endBlock(
            trimmedFeedback || undefined,
            {
              taskStatusOutcomes:
                Object.keys(taskStatusOutcomes).length > 0
                  ? taskStatusOutcomes
                  : undefined,
              taskTitles:
                Object.keys(taskTitles).length > 0 ? taskTitles : undefined,
            },
            {
              traceId: trace.traceId,
              trigger: "FocusTimerWidget.handleSubmitEnd",
              source: "focus-timer",
            },
          );
        } else {
          await timeBlockServiceRef.current.endBlock(
            trimmedFeedback || undefined,
            undefined,
            {
              traceId: trace.traceId,
              trigger: "FocusTimerWidget.handleSubmitEnd",
              source: "focus-timer",
            },
          );
        }
        trace.step("service-end-block");
        if (blockDataSnapshot?.startId) {
          rememberLocallyEndedStartId(blockDataSnapshot.startId);
        }
      } catch (error) {
        log.error(
          `[TB-UI] endBlock failed ${error instanceof Error ? error.message : String(error)}`,
        );
        trace.fail(error, { phase: "service-end-block" });
        try {
          const block = await timeBlockServiceRef.current.loadActiveBlock();
          applyActiveBlock(block);
        } catch (reloadError) {
          log.error(
            `[TB-UI] endBlock recover failed ${reloadError instanceof Error ? reloadError.message : String(reloadError)}`,
          );
        }
        setFeedbackSubmitting(false);
        return;
      }

      // Record block association and apply task status transition
      if (taskAssociationsEnabled && blockDataSnapshot && taskIdsSnapshot.length > 0) {
        try {
          await getTaskTimerService().onBlockEndForTasks(
            taskIdsSnapshot,
            blockDataSnapshot.startId,
          );
          for (const taskId of taskIdsSnapshot) {
            const taskStatusChoice = normalizeEndTaskStatusChoice(
              taskStatusChoicesSnapshot[taskId],
            );
            const task = linkedTasksSnapshot.find(
              (candidate) => candidate.id === taskId,
            );
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
          log.error(
            `[TB-UI] task status update failed ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      trace.step("task-followups");

      const storedDraft = readFocusConfigDraftSnapshot();
      setFeedback("");
      setFeedbackOpen(false);
      setFeedbackInProgress(false);
      setFeedbackSubmitting(false);
      setFocusUiState(storedDraft?.inputFocused ? "config" : "idle");
      setRunningSubState("running");
      taskInputFocusIntentRef.current = storedDraft?.inputFocused ?? false;
      setTaskName("");
      setRunningNameDraft("");
      setRunningNameEditing(false);
      setIsRunningNameSaving(false);
      runningNameSaveInFlightRef.current = false;
      setTaskNameDraft(storedDraft?.taskNameDraft ?? "");
      if (storedDraft) {
        setTimerMode(storedDraft.timerMode);
        setCountdownMinutes(storedDraft.countdownMinutes);
        setCustomDurationDraft(String(storedDraft.countdownMinutes));
        setSelectedTaskIds(storedDraft.selectedTaskIds);
      } else {
        setSelectedTaskIds([]);
      }
      setLinkedTasks([]);
      taskStatusChoiceBlockRef.current = null;
      setTaskStatusChoices({});
      countdownEndedRef.current = false;
      countdownOverrunRef.current = false;
      hardEndTriggeredRef.current = false;
      setCountdownOvertimeMs(0);
      syncIdleElapsedFromMode(
        storedDraft?.timerMode ?? timerMode,
        storedDraft?.countdownMinutes ?? countdownMinutes,
      );
      if (!storedDraft) {
        clearFocusConfigDraftSnapshot();
      } else if (storedDraft.inputFocused) {
        focusTaskInput();
      }
      trace.step("apply-ui-idle-state");
      // The feedback flow is only "done" once the idle state is painted back to screen.
      await waitForNextPaint();
      trace.step("notify-to-paint");
      trace.finish({
        endBlockClickToDoneMs: trace.totalMs(),
      });
      logPerfInfo(
        `[TB-UI] click submit-end -> endBlock done ${JSON.stringify({ traceId: trace.traceId, elapsedMs: trace.totalMs() })}`,
      );
    },
    [
      applyActiveBlock,
      canSubmitFeedback,
      countdownMinutes,
      feedbackSubmitting,
      focusTaskInput,
      syncIdleElapsedFromMode,
      linkedTasks,
      rememberLocallyEndedStartId,
      setFocusUiState,
      setRunningNameEditing,
      taskStatusChoices,
      taskAssociationsEnabled,
      timerMode,
    ],
  );

  const handleConfirmEnd = useCallback(async () => {
    const feedbackText = feedback.trim() || undefined;
    await handleSubmitEnd(feedbackText);
  }, [feedback, handleSubmitEnd]);

  const handleFeedbackDialogOpenChange = useCallback((nextOpen: boolean) => {
    setFeedbackOpen(nextOpen);
  }, []);

  const feedbackConfirmLabel = resolveFeedbackSubmitLabel({
    feedback,
    isSubmitting: feedbackSubmitting,
    skipConfirmState: skipFeedbackConfirmState,
    skipConfirmCountdownSec: skipFeedbackCountdownSec,
    defaultLabel: "确认停止",
  });

  useImperativeHandle(
    ref,
    () => ({
      expandAndFocusTaskName: () => {
        if (uiState === "running") return;
        setFocusUiState("config");
        setSelectedTaskIds([]);
        focusTaskInput();
      },
      openTaskConfig: (taskConfig: FocusTaskConfigContext) => {
        if (uiState === "running") return;
        const nextTitle =
          typeof taskConfig === "string"
            ? taskConfig.trim()
            : taskConfig.title.trim();
        const nextPreselectedTaskIds =
          !taskAssociationsEnabled || typeof taskConfig === "string"
            ? []
            : normalizePreselectedTaskIds(taskConfig.preselectedTaskIds);
        setTaskNameDraft(nextTitle);
        setSelectedTaskIds(nextPreselectedTaskIds);
        setFocusUiState("config");
        focusTaskInput();
      },
      getTimerState: () => {
        if (uiState !== "running") return "idle";
        return runningSubState === "paused" ? "paused" : "running";
      },
      pauseOrResume: async () => {
        await handlePauseOrResume();
      },
      endDialog: () => {
        handleOpenEndDialog();
      },
    }),
    [
      focusTaskInput,
      handleOpenEndDialog,
      handlePauseOrResume,
      runningSubState,
      setFocusUiState,
      setSelectedTaskIds,
      taskAssociationsEnabled,
      uiState,
    ],
  );

  const isOverlaySurface = surface === "overlay";
  const viewModel: FocusTimerViewModel =
    uiState === "idle"
      ? { phase: "idle" }
      : uiState === "config"
        ? {
            phase: "config",
            name: taskNameDraft,
            mode: timerMode,
            minutes: countdownMinutes,
            custom: {
              editing: isCustomDurationEditing,
              draft: customDurationDraft,
            },
          }
        : {
            phase: "running",
            name: {
              text: runningNameDisplayText,
              draft: runningNameDraft,
              editing: isRunningNameEditing,
              saving: isRunningNameSaving,
            },
            clock: {
              text: isCountdownOvertime
                ? "+" + formatClock(countdownOvertimeMs)
                : formatClock(elapsedMs),
              warning: isCountdownWarning,
              endTimeText: countdownEndTimeDisplay?.text,
            },
            paused: isPaused,
            feedback: {
              inProgress: feedbackInProgress,
              dialogOpen: feedbackOpen,
            },
            linkedTasks: showRunningLinkedTasks
              ? linkedTasks.map(({ id, title }) => ({ id, title }))
              : [],
          };

  return (
    <FocusTimerView
      model={viewModel}
      surface={surface}
      overlayChrome={overlayRunningChrome}
      actions={{
        expand: enterConfigState,
        collapse: handleCollapseToIdle,
        selectTiming: (mode, minutes) => {
          setIsCustomDurationEditing(false);
          setTimerMode(mode);
          if (minutes !== undefined) setCountdownMinutes(minutes);
        },
        editCustom: handleOpenCustomDurationEditor,
        start: handleStart,
        beginRename: handleBeginRunningNameEdit,
        pauseResume: handlePauseOrResume,
        end: handleOpenEndDialog,
        openBgm: hasFocusBgmConfigured ? () => setFocusBgmDialogOpen(true) : undefined,
      }}
      bindings={{
        configName: {
          inputRef: taskInputRef,
          onChange: (event) => {
            const nextValue = event.target.value;
            taskNameDraftRef.current = nextValue;
            taskInputFocusIntentRef.current = true;
            setTaskNameDraft(nextValue);
            persistCurrentConfigDraft({ taskNameDraft: nextValue, inputFocused: true });
          },
          onFocus: () => {
            taskInputFocusIntentRef.current = true;
            persistCurrentConfigDraft({ inputFocused: true });
          },
          onBlur: () => {
            if (uiStateRef.current === "running") return;
            taskInputFocusIntentRef.current = false;
            persistCurrentConfigDraft({ inputFocused: false });
          },
          onKeyDown: handleTaskInputKeyDown,
        },
        customMinutes: {
          inputRef: customDurationInputRef,
          onChange: (event) =>
            setCustomDurationDraft(event.target.value.replace(/[^\d]/g, "")),
          onBlur: () => applyCustomDuration(customDurationDraft),
          onKeyDown: handleCustomDurationKeyDown,
        },
        runningName: {
          inputRef: runningNameInputRef,
          onChange: (event) => setRunningNameDraft(event.target.value),
          onKeyDown: handleRunningNameKeyDown,
          onBlur: () => {
            if (isRunningNameEditingRef.current) void handleSubmitRunningName();
          },
        },
        expectedTimeKeyDown: handleExpectedTimeKeyDown,
      }}
      slots={{
        keepAwake:
          showKeepAwakeButton && keepAwakeControl
            ? <FocusKeepAwakeButton control={keepAwakeControl} />
            : null,
        dialogs: (
          <>
            <TimeBlockFeedbackDialog
              open={feedbackOpen}
              onOpenChange={handleFeedbackDialogOpenChange}
              title="停止专注并记录反馈"
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
                  <DialogDescription>
                    在专注进行中调整背景音配置与音量
                  </DialogDescription>
                </DialogHeader>
                <FocusBgmPanel ctx={{ isDesktop: !isOverlaySurface }} />
              </DialogContent>
            </Dialog>
          </>
        ),
      }}
    />
  );
});
