import {
  forwardRef,
  type KeyboardEvent,
  type MouseEventHandler,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Music4,
  NotepadText,
  Pause,
  Play,
  Shrink,
  Square,
  Target,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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

type FocusUiState = "idle" | "config" | "running"; // UI State Machine（界面状态机）
type RunningSubState = "running" | "paused"; // Running Sub-state（运行子状态）
export type FocusTimerState = "idle" | "running" | "paused";
type FocusTimerSurface = "default" | "overlay"; // Surface Variant（表面样式变体）
type FocusTaskConfigContext =
  | string
  | { title: string; preselectedTaskIds?: string[] };

interface FocusTimerWidgetProps {
  surface?: FocusTimerSurface;
  overlayRunningChrome?: {
    statusLabel: string;
    onCollapse: () => void;
    onReturnToMain: () => void;
    onSurfaceMount?: (node: HTMLDivElement | null) => void;
    onSurfaceMouseDownCapture?: MouseEventHandler<HTMLDivElement>;
    surfacePressed?: boolean;
  };
  prestartSelectedTaskIds?: string[];
  onPrestartSelectedTaskIdsChange?: (taskIds: string[]) => void;
  showRunningLinkedTasks?: boolean;
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
  return name?.trim() || "未命名任务";
}

function formatClock(ms: number): string {
  const safe = Math.max(0, Math.floor(ms));
  const totalSeconds = Math.floor(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function glassCardShadowClass(): string {
  return "shadow-[0_1px_2px_rgba(0,0,0,0.03),0_8px_24px_-6px_rgba(0,0,0,0.08),0_20px_40px_-8px_rgba(0,0,0,0.05)]";
}

function expectedOptionClass(active: boolean): string {
  return `relative z-10 h-8 w-full whitespace-nowrap rounded-[8px] px-[8px] text-center text-[12px] transition-colors duration-200 ${
    active
      ? "font-semibold text-[#1C1917] dark:text-[#FAFAF9]"
      : "text-[#78716C] hover:text-[#57534E] dark:hover:text-[#D6D3D1]"
  }`;
}

const PRESET_COUNTDOWN_MINUTES = [15, 25, 45] as const;
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

function isPresetCountdownMinutes(minutes: number): boolean {
  return PRESET_COUNTDOWN_MINUTES.includes(
    minutes as (typeof PRESET_COUNTDOWN_MINUTES)[number],
  );
}

function resolveExpectedOptionIndex(mode: TimerMode, minutes: number): number {
  if (mode === "countup") return 0;
  const presetIndex = PRESET_COUNTDOWN_MINUTES.indexOf(
    minutes as (typeof PRESET_COUNTDOWN_MINUTES)[number],
  );
  return presetIndex >= 0 ? presetIndex + 1 : 4;
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
  const selectableTasks = usePrestartSelectableTasks();
  const [internalSelectedTaskIds, setInternalSelectedTaskIds] = useState<
    string[]
  >(initialConfigDraft?.selectedTaskIds ?? []);
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
  const isCustomDurationSelected =
    timerMode === "countdown" && !isPresetCountdownMinutes(countdownMinutes);
  const customDurationTriggerText = isCustomDurationSelected
    ? `${countdownMinutes}m`
    : "自定义";
  const runningNameDisplayText = formatRunningBlockName(taskName);

  const setRunningNameEditing = useCallback((nextEditing: boolean) => {
    isRunningNameEditingRef.current = nextEditing;
    setIsRunningNameEditingState(nextEditing);
  }, []);
  const activeExpectedIndex = resolveExpectedOptionIndex(
    timerMode,
    countdownMinutes,
  );
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
  const selectedTaskIds = prestartSelectedTaskIds ?? internalSelectedTaskIds;
  taskNameDraftRef.current = taskNameDraft;
  timerModeRef.current = timerMode;
  countdownMinutesRef.current = countdownMinutes;
  selectedTaskIdsRef.current = selectedTaskIds;
  const setSelectedTaskIds = useCallback(
    (nextValue: string[] | ((current: string[]) => string[])) => {
      const resolvedValue = normalizePreselectedTaskIds(
        typeof nextValue === "function"
          ? nextValue(selectedTaskIds)
          : nextValue,
      );
      if (onPrestartSelectedTaskIdsChange) {
        onPrestartSelectedTaskIdsChange(resolvedValue);
        return;
      }
      setInternalSelectedTaskIds(resolvedValue);
    },
    [onPrestartSelectedTaskIdsChange, selectedTaskIds],
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
      selectedTaskIds: selectedTaskIdsRef.current,
      inputFocused: taskInputFocusIntentRef.current,
      ...overrides,
      updatedAt: Date.now(),
    }),
    [],
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
        selectedTaskIds: normalizePreselectedTaskIds(snapshot.selectedTaskIds),
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
      const resolvedTaskIds = resolveActiveTaskIds(visibleBlock);
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

    const selectedTasks = selectedTaskIds
      .map((taskId) => selectableTasks.find((task) => task.id === taskId))
      .filter((task): task is TaskNode => Boolean(task));
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
  const focusBgmToggleAriaLabel = "背景音设置（Background audio settings）";
  const focusBgmToggleIcon = <Music4 size={16} />;

  const handleSubmitEnd = useCallback(
    async (feedbackText?: string) => {
      if (feedbackSubmitting) return;
      const trimmedFeedback = feedbackText?.trim() ?? "";
      const blockDataSnapshot = activeBlockDataRef.current;
      const taskIdsSnapshot = resolveActiveTaskIds(blockDataSnapshot);
      const linkedTasksSnapshot = linkedTasks;
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
      if (blockDataSnapshot && taskIdsSnapshot.length > 0) {
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

  const isEndActionDisabled = feedbackInProgress && feedbackOpen;
  const endActionAriaLabel = feedbackInProgress
    ? "反馈中（Feedback in progress）"
    : "停止（Stop）";
  const endActionTitle = feedbackInProgress ? "反馈中" : "停止";
  const endActionButtonClass = feedbackInProgress
    ? "h-11 w-11 rounded-[12px] bg-brand p-0 text-white hover:bg-brand/90 hover:text-white"
    : "h-11 w-11 rounded-[12px] bg-[#C75B3A] p-0 text-white hover:bg-[#B24D2F] hover:text-white";
  const endActionIcon = feedbackInProgress ? (
    <NotepadText size={18} className="text-white" />
  ) : (
    <Square size={18} />
  );
  const feedbackConfirmLabel = resolveFeedbackSubmitLabel({
    feedback,
    isSubmitting: feedbackSubmitting,
    skipConfirmState: skipFeedbackConfirmState,
    skipConfirmCountdownSec: skipFeedbackCountdownSec,
    defaultLabel: "确认停止",
  });

  const renderRunningNameControl = (variant: "default" | "overlay") => {
    const isOverlayVariant = variant === "overlay";
    if (isRunningNameEditing) {
      return (
        <Input
          ref={runningNameInputRef}
          data-testid="new-focus-running-name-input"
          value={runningNameDraft}
          disabled={isRunningNameSaving}
          onChange={(event) => setRunningNameDraft(event.target.value)}
          onKeyDown={handleRunningNameKeyDown}
          onBlur={() => {
            if (isRunningNameEditingRef.current) {
              void handleSubmitRunningName();
            }
          }}
          onMouseDown={(event) => event.stopPropagation()}
          aria-label="编辑时间块名称（Edit time block name）"
          className={`h-8 w-full min-w-0 border-[#E7E5E4]/80 bg-white/70 px-2 text-left font-semibold shadow-none focus-visible:ring-1 focus-visible:ring-[#C75B3A] dark:border-[#FFFFFF20] dark:bg-[#FFFFFF12] ${
            isOverlayVariant
              ? "mt-0.5 text-[18px] leading-[1.25] text-[#F5EDE7]"
              : "text-[20px] leading-[1.25] text-[#1C1917] dark:text-[#FAFAF9]"
          }`}
        />
      );
    }

    return (
      <button
        type="button"
        data-testid="new-focus-running-name-display"
        onClick={handleBeginRunningNameEdit}
        onMouseDown={(event) => event.stopPropagation()}
        disabled={feedbackInProgress || isRunningNameSaving}
        title="编辑时间块名称"
        className={`block min-w-0 max-w-full truncate rounded-[8px] text-left font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C75B3A]/45 disabled:cursor-default disabled:opacity-100 ${
          isOverlayVariant
            ? "pt-0.5 text-[18px] leading-[1.35] text-[#F5EDE7] hover:text-white"
            : `text-[20px] leading-[1.4] ${isOverlaySurface ? "text-[#F5EDE7]" : "text-[#1C1917] hover:text-[#B24D2F] dark:text-[#FAFAF9] dark:hover:text-[#F5B097]"}`
        }`}
      >
        {runningNameDisplayText}
      </button>
    );
  };

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
          typeof taskConfig === "string"
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
      uiState,
    ],
  );

  const isOverlaySurface = surface === "overlay";
  const overlayChrome = isOverlaySurface
    ? (overlayRunningChrome ?? null)
    : null;
  const hasIntegratedOverlayChrome = overlayChrome !== null;
  const hasRunningLinkedTasks =
    showRunningLinkedTasks && linkedTasks.length > 0;
  const useAutoHeightConfigLayout = !isOverlaySurface;
  const useAutoHeightRunningLayout =
    !isOverlaySurface || (hasIntegratedOverlayChrome && hasRunningLinkedTasks);
  const baseStageHeightClass = useAutoHeightConfigLayout
    ? "min-h-[200px] pb-4 pt-4"
    : hasIntegratedOverlayChrome
      ? "h-[192px]"
      : "h-[200px]";
  const baseGlowHeightClass = useAutoHeightConfigLayout
    ? "bottom-4"
    : hasIntegratedOverlayChrome
      ? "h-[186px]"
      : "h-[163px]";
  const baseCardHeightClass = useAutoHeightConfigLayout
    ? "min-h-[169px]"
    : hasIntegratedOverlayChrome
      ? "h-[192px]"
      : "h-[169px]";
  const runningStageHeightClass = useAutoHeightRunningLayout
    ? useAutoHeightConfigLayout
      ? "min-h-[200px] pb-4 pt-4"
      : hasIntegratedOverlayChrome
        ? "min-h-[246px]"
        : "min-h-[276px] pb-4 pt-4"
    : hasRunningLinkedTasks
      ? hasIntegratedOverlayChrome
        ? "h-[276px]"
        : "h-[252px]"
      : baseStageHeightClass;
  const runningGlowHeightClass = useAutoHeightRunningLayout
    ? "bottom-4"
    : hasRunningLinkedTasks
      ? hasIntegratedOverlayChrome
        ? "h-[240px]"
        : "h-[215px]"
      : baseGlowHeightClass;
  const runningCardHeightClass = useAutoHeightRunningLayout
    ? useAutoHeightConfigLayout
      ? "min-h-[169px]"
      : "min-h-[246px]"
    : hasRunningLinkedTasks
      ? hasIntegratedOverlayChrome
        ? "h-[246px]"
        : "h-[221px]"
      : baseCardHeightClass;
  const showOverlaySurfaceBackdropGlow = !hasIntegratedOverlayChrome;
  const runningCardLayoutClass = useAutoHeightRunningLayout
    ? (hasIntegratedOverlayChrome ? "relative w-full" : "relative mx-4")
    : (hasIntegratedOverlayChrome ? "absolute inset-x-0 top-0" : "absolute left-4 right-4 top-4");
  const overlaySurfacePressedClass = overlayChrome?.surfacePressed
    ? "ring-1 ring-inset ring-[#FDE4DE]/60"
    : "";

  return (
    <div
      className={
        isOverlaySurface ? "bg-transparent" : "bg-[#FAF7F5] dark:bg-[#0C0A09]"
      }
      data-testid="new-focus-timer-widget"
    >
      {uiState === "idle" && (
        <section className={isOverlaySurface ? "pt-0" : "pt-[10px]"}>
          <div
            className="relative mx-auto h-[104px] w-full max-w-[390px]"
            data-testid="new-focus-state-idle"
          >
            <div
              className={`absolute left-1/2 top-[18px] h-[74px] w-[calc(100%-40px)] max-w-[353px] -translate-x-1/2 rounded-[22px] blur-[8px] ${
                isOverlaySurface
                  ? "bg-[rgba(12,10,9,0.24)]"
                  : "bg-gradient-to-br from-[#EDADA0] via-[#E08E7A] to-[#D4785F] dark:from-[#8B3A25] dark:via-[#6B2E1E] dark:to-[#4A1F14]"
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
                  ? "border border-white/55 bg-[rgba(28,25,23,0.78)] text-[#FAFAF9]"
                  : "border border-[#FFFFFF80] bg-[linear-gradient(180deg,rgba(255,255,255,0.64)_0%,rgba(255,255,255,0.36)_100%)] dark:border-[#FFFFFF15] dark:[background-color:rgba(28,25,23,0.5)] dark:bg-[linear-gradient(180deg,rgba(28,25,23,0.25)_0%,rgba(28,25,23,0)_100%)]"
              }`}
            >
              <div className="mr-3 flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[#FEF0ED] dark:bg-[#2A1510] text-[#C75B3A] dark:text-[#E8734E]">
                  <Target size={20} />
                </div>
                <div className="min-w-0">
                  <p
                    className={`truncate text-[16px] font-semibold leading-[1.4] ${isOverlaySurface ? "text-[#F5EDE7]" : "text-[#1C1917] dark:text-[#FAFAF9]"}`}
                  >
                    点击开启时间块
                  </p>
                  <p
                    className={`truncate text-[12px] leading-[1.4] ${isOverlaySurface ? "text-[#D6C2B8]" : "text-[#78716C]"}`}
                  >
                    配置时间块，开启新计时
                  </p>
                </div>
              </div>
              <ChevronRight
                size={20}
                className="shrink-0 text-[#C75B3A] dark:text-[#E8734E]"
              />
            </button>
          </div>
        </section>
      )}

      {uiState === "config" && (
        <section className={isOverlaySurface ? "pt-0" : "pt-[10px]"}>
          <div
            className={`relative mx-auto w-full max-w-[390px] ${baseStageHeightClass}`}
            data-testid="new-focus-state-config"
          >
            <div
              className={`absolute left-1/2 top-[20px] ${baseGlowHeightClass} w-[calc(100%-40px)] max-w-[353px] -translate-x-1/2 rounded-[22px] blur-[8px] ${
                isOverlaySurface
                  ? "bg-[rgba(12,10,9,0.24)]"
                  : "bg-gradient-to-br from-[#EDADA0] via-[#E08E7A] to-[#D4785F] dark:from-[#8B3A25] dark:via-[#6B2E1E] dark:to-[#4A1F14]"
              }`}
              aria-hidden
            />

            <div
              id="new-focus-config-panel"
              className={`${useAutoHeightConfigLayout ? "relative mx-4" : "absolute left-4 right-4 top-4"} flex ${baseCardHeightClass} flex-col gap-3 ${isOverlaySurface ? "overflow-y-auto" : ""} rounded-[24px] px-[18px] py-4 backdrop-blur-[24px] ${glassCardShadowClass()} ${
                isOverlaySurface
                  ? "border border-white/55 bg-[rgba(28,25,23,0.78)] text-[#FAFAF9]"
                  : "border border-[#FFFFFF80] bg-[linear-gradient(180deg,rgba(255,255,255,0.64)_0%,rgba(255,255,255,0.36)_100%)] dark:border-[#FFFFFF15] dark:[background-color:rgba(28,25,23,0.5)] dark:bg-[linear-gradient(180deg,rgba(28,25,23,0.25)_0%,rgba(28,25,23,0)_100%)]"
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
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    taskNameDraftRef.current = nextValue;
                    taskInputFocusIntentRef.current = true;
                    setTaskNameDraft(nextValue);
                    persistCurrentConfigDraft({
                      taskNameDraft: nextValue,
                      inputFocused: true,
                    });
                  }}
                  onFocus={() => {
                    taskInputFocusIntentRef.current = true;
                    persistCurrentConfigDraft({ inputFocused: true });
                  }}
                  onBlur={() => {
                    if (uiStateRef.current === "running") return;
                    taskInputFocusIntentRef.current = false;
                    persistCurrentConfigDraft({ inputFocused: false });
                  }}
                  onKeyDown={handleTaskInputKeyDown}
                  placeholder="输入时间块名称..."
                  rows={1}
                  className="max-h-24 border-[#E7E5E4]/80 dark:border-[#FFFFFF20] bg-white/60 dark:bg-[#FFFFFF10] text-sm dark:text-[#FAFAF9]"
                />
              </div>

              <div className="h-px w-full bg-[#D4785F30] dark:bg-[#D4785F20]" />

              <div className="flex min-w-0 flex-col gap-1.5">
                <span className="text-[12px] font-medium text-[#57534E] dark:text-[#A8A29E]">
                  预期时长
                </span>
                <div
                  className="relative min-w-0 overflow-hidden rounded-[10px] border border-[#E7E5E4] bg-[#F5F0ED]/50 dark:border-[#FFFFFF20] dark:bg-[#FFFFFF08]"
                  data-testid="new-focus-expected-time-row"
                  onKeyDown={handleExpectedTimeKeyDown}
                >
                  <div
                    data-testid="new-focus-expected-active-indicator"
                    className="pointer-events-none absolute inset-y-0 left-0 w-1/5 rounded-[8px] border border-brand-accent/40 bg-brand-accent/15 shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-transform duration-200 ease-out"
                    style={{
                      transform: `translateX(${activeExpectedIndex * 100}%)`,
                    }}
                  />
                  <div className="relative z-10 grid min-w-0 grid-cols-5 gap-0">
                    <button
                      type="button"
                      data-testid="new-focus-expected-countup"
                      onClick={() => {
                        setIsCustomDurationEditing(false);
                        setTimerMode("countup");
                      }}
                      className={expectedOptionClass(timerMode === "countup")}
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
                          setTimerMode("countdown");
                          setCountdownMinutes(minutes);
                        }}
                        className={expectedOptionClass(
                          timerMode === "countdown" &&
                            countdownMinutes === minutes,
                        )}
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
                          setCustomDurationDraft(
                            event.target.value.replace(/[^\d]/g, ""),
                          );
                        }}
                        onBlur={() => applyCustomDuration(customDurationDraft)}
                        onKeyDown={handleCustomDurationKeyDown}
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
                            ? "font-semibold text-[#1C1917] dark:text-[#FAFAF9]"
                            : "text-[#C75B3A] hover:text-[#B24D2F]"
                        }`}
                        aria-label="自定义倒计时（Custom countdown）"
                      >
                        <ChevronDown
                          size={12}
                          className="transition-transform"
                        />
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

      {uiState === "running" && (
        <section
          className={isOverlaySurface ? "pt-0" : "pt-[10px]"}
          data-testid="new-focus-state-running"
        >
          <div
            className={`relative mx-auto w-full max-w-[390px] ${runningStageHeightClass}`}
          >
            {showOverlaySurfaceBackdropGlow ? (
              <div
                className={`absolute left-1/2 top-[20px] ${runningGlowHeightClass} w-[calc(100%-40px)] max-w-[353px] -translate-x-1/2 rounded-[22px] blur-[8px] ${
                  isOverlaySurface
                    ? "bg-[rgba(12,10,9,0.24)]"
                    : "bg-gradient-to-br from-[#EDADA0] via-[#E08E7A] to-[#D4785F] dark:from-[#8B3A25] dark:via-[#6B2E1E] dark:to-[#4A1F14]"
                }`}
                aria-hidden
              />
            ) : null}
            <div
              ref={overlayChrome?.onSurfaceMount}
              data-testid="new-focus-running-task-card"
              data-overlay-visible-surface={hasIntegratedOverlayChrome ? "true" : undefined}
              onMouseDownCapture={overlayChrome?.onSurfaceMouseDownCapture}
              className={`${runningCardLayoutClass} flex ${runningCardHeightClass} flex-col gap-3 rounded-[24px] px-5 py-4 backdrop-blur-[24px] ${glassCardShadowClass()} ${
                isOverlaySurface
                  ? "border border-white/55 bg-[rgba(28,25,23,0.78)] text-[#FAFAF9]"
                  : "border border-[#FFFFFF80] bg-[linear-gradient(180deg,rgba(255,255,255,0.64)_0%,rgba(255,255,255,0.36)_100%)] dark:border-[#FFFFFF15] dark:[background-color:rgba(28,25,23,0.5)] dark:bg-[linear-gradient(180deg,rgba(28,25,23,0.25)_0%,rgba(28,25,23,0)_100%)]"
              } ${overlaySurfacePressedClass}`}
            >
              {overlayChrome ? (
                <div
                  className="flex min-w-0 items-start justify-between gap-3"
                  data-testid="new-focus-overlay-running-header"
                >
                  <div
                    data-testid="new-focus-overlay-drag-handle"
                    data-tauri-drag-region
                    title="按住这里拖动窗口"
                    className="min-w-0 cursor-grab select-none active:cursor-grabbing"
                  >
                    <p
                      className="truncate text-[10px] font-medium uppercase tracking-[0.12em] text-[#D6C2B8]"
                      data-tauri-drag-region
                    >
                      {overlayChrome.statusLabel}
                    </p>
                    {renderRunningNameControl("overlay")}
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
                    {renderRunningNameControl("default")}
                  </div>
                  <div className="ml-auto flex shrink-0 items-center gap-2">
                    {showKeepAwakeButton && keepAwakeControl ? (
                      <FocusKeepAwakeButton control={keepAwakeControl} />
                    ) : null}
                    {hasFocusBgmConfigured ? (
                      <Button
                        type="button"
                        variant="ghost"
                        data-testid="new-focus-bgm-toggle-button"
                        aria-label={focusBgmToggleAriaLabel}
                        className={`h-9 w-9 rounded-[10px] p-0 ${
                          isOverlaySurface
                            ? "border border-white/10 bg-white/8 text-[#E7D7CF] hover:bg-white/15"
                            : "border border-[#E7E5E4] bg-white/50 text-[#C75B3A] hover:bg-white/70 dark:border-[#FFFFFF20] dark:bg-[#FFFFFF10] dark:text-[#E8734E]"
                        }`}
                        onClick={() => {
                          setFocusBgmDialogOpen(true);
                        }}
                      >
                        {focusBgmToggleIcon}
                      </Button>
                    ) : null}
                  </div>
                </div>
              )}
              <div className="h-px w-full bg-[#D4785F30] dark:bg-[#D4785F20]" />
              <div className="flex items-center justify-between px-1 pt-1">
                <Button
                  type="button"
                  data-testid="new-focus-pause-resume-button"
                  aria-label={isPaused ? "继续（Resume）" : "暂停（Pause）"}
                  disabled={feedbackInProgress}
                  onClick={() => {
                    void handlePauseOrResume();
                  }}
                  className={
                    isPaused
                      ? "h-11 w-11 rounded-[12px] bg-[#16A34A] p-0 text-white hover:bg-[#15803D]"
                      : "h-11 w-11 rounded-[12px] bg-warning p-0 text-white hover:bg-warning/90 hover:text-white"
                  }
                >
                  {isPaused ? <Play size={18} /> : <Pause size={18} />}
                </Button>
                <div className="flex min-w-0 flex-col items-center gap-1 px-2">
                  <span
                    className={`font-mono text-[40px] font-normal leading-[1.1] tracking-[2px] ${
                      isCountdownWarning
                        ? "text-[#C75B3A]"
                        : "text-[#1C1917] dark:text-[#FAFAF9]"
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
                  <div
                    data-testid="new-focus-running-linked-tasks"
                    className="min-h-0 px-1"
                  >
                    <p
                      className={`pb-1 text-[11px] font-medium ${isOverlaySurface ? "text-[#D6C2B8]" : "text-[#78716C] dark:text-[#A8A29E]"}`}
                    >
                      关联任务
                    </p>
                    <ul
                      className={`list-disc space-y-1 pl-4 text-[12px] leading-[1.35] ${isOverlaySurface ? "text-[#F5EDE7]" : "text-[#44403C] dark:text-[#E7E5E4]"}`}
                    >
                      {linkedTasks.map((task) => (
                        <li
                          key={task.id}
                          data-testid={`new-focus-running-linked-task-${task.id}`}
                          className={
                            useAutoHeightRunningLayout || !isOverlaySurface
                              ? "break-words whitespace-normal marker:text-[#C75B3A]"
                              : "truncate marker:text-[#C75B3A]"
                          }
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
    </div>
  );
});
