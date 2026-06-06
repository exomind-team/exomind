import { useCallback, useEffect, useMemo, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  getCurrentUserId,
  getEventStorage,
  type Event as StoredEvent,
} from "@/lib/storage/event-storage";
import { setProfileSession } from "@/lib/profile/profile-storage";

import {
  getEventLogService,
  getTaskService,
  getTaskTimerService,
  getTimeBlockService,
} from "@/lib/services";
import { readEventRefsFromMetadata } from "@/lib/eventlog/event-refs";
import { appendTaskStatusChangeDescription } from "@/lib/task/task-status-change-description";
import {
  resolveActiveBlockTaskIds,
  type ActiveBlockData,
  type Event as UiEvent,
  type TimerConfig,
} from "@/lib/types/event";
import type { TaskNode, TaskStatus } from "@/lib/types/task";
import {
  normalizeEndTaskStatusChoice,
  type TaskStatusChoice,
} from "@/ui/app/components/TaskStatusSelector";
import {
  buildNowWorkbenchOverlayModel,
  type NowWorkbenchOverlayMode,
} from "./now-workbench-overlay-model";
import { getNowWorkbenchOverlayService } from "@/services/now-workbench-overlay.service";

interface NowWorkbenchOverlayController {
  model: ReturnType<typeof buildNowWorkbenchOverlayModel>;
  feedbackOpen: boolean;
  feedback: string;
  activeBlockTasks: TaskNode[];
  taskStatusChoices: Record<string, TaskStatusChoice>;
  debugInfo: {
    userId: string;
    mode: string;
    taskCount: number;
    eventCount: number;
    activeBlockName: string;
    latestEventContent: string;
    lastReloadAt: string;
    lastAction: string;
  };
  setFeedback(value: string): void;
  setTaskStatusChoice(taskId: string, value: TaskStatusChoice): void;
  handleHide(): Promise<void>;
  handleReturnToMain(): Promise<void>;
  handlePauseOrResume(): Promise<void>;
  handleOpenEndDialog(): Promise<void>;
  handleConfirmEnd(): Promise<void>;
  handleStartTask(task: TaskNode): Promise<void>;
  handleSend(content: string, tags?: string[]): Promise<void>;
}

interface NowWorkbenchOverlayDebugInfo {
  userId: string;
  mode: NowWorkbenchOverlayMode;
  taskCount: number;
  eventCount: number;
  activeBlockName: string;
  latestEventContent: string;
  lastReloadAt: string;
  lastAction: string;
}

function toUiEvent(event: StoredEvent): UiEvent {
  return {
    id: event.id,
    content: event.content,
    timestamp: Date.parse(event.createdAt),
    tags: new Set(event.type ? [event.type] : []),
    metadata: event.metadata,
    refs: readEventRefsFromMetadata(event.metadata ?? null),
  };
}

function isFeedbackStage(block: ActiveBlockData | null): boolean {
  if (!block) return false;
  return (
    block.phase === "feedback_in_progress" ||
    block.phase === "action_ended" ||
    Boolean(block.actionEndedAt || block.feedbackStartedAt)
  );
}

function isTerminalTask(task: TaskNode): boolean {
  return task.status === "completed" || task.status === "cancelled";
}

function buildQuickStartTimerConfig(
  task: TaskNode,
  spentMinutes: number,
): TimerConfig {
  if (task.estimatedMinutes == null) {
    return { mode: "countup" };
  }

  return {
    mode: "countdown",
    minutes: Math.max(1, Math.round(task.estimatedMinutes - spentMinutes)),
  };
}

const EMPTY_MODEL = buildNowWorkbenchOverlayModel({
  activeBlock: null,
  tasks: [],
  events: [],
  now: Date.now(),
});

export function useNowWorkbenchOverlayController(): NowWorkbenchOverlayController {
  const timeBlockService = useMemo(() => getTimeBlockService(), []);
  const taskService = useMemo(() => getTaskService(), []);
  const taskTimerService = useMemo(() => getTaskTimerService(), []);
  const eventLogService = useMemo(() => getEventLogService(), []);
  const overlayService = useMemo(() => getNowWorkbenchOverlayService(), []);
  const [activeBlock, setActiveBlock] = useState<ActiveBlockData | null>(null);
  const [tasks, setTasks] = useState<TaskNode[]>([]);
  const [events, setEvents] = useState<UiEvent[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [taskStatusChoices, setTaskStatusChoices] = useState<
    Record<string, TaskStatusChoice>
  >({});
  const [profileReady, setProfileReady] = useState(false);
  const [debugInfo, setDebugInfo] = useState<NowWorkbenchOverlayDebugInfo>(
    () => ({
      userId: (() => { try { return getCurrentUserId(); } catch { return ''; } })(),
      mode: EMPTY_MODEL.mode,
      taskCount: 0,
      eventCount: 0,
      activeBlockName: "",
      latestEventContent: "",
      lastReloadAt: "",
      lastAction: "init",
    }),
  );

  const updateDebugInfo = useCallback(
    (patch: Partial<NowWorkbenchOverlayDebugInfo>) => {
      setDebugInfo((current) => ({
        ...current,
        ...patch,
      }));
    },
    [],
  );

  const loadTasks = useCallback(async () => {
    try {
      const nextTasks = await taskService.listTasks(true);
      setTasks(nextTasks);
      updateDebugInfo({
        userId: getCurrentUserId(),
        taskCount: nextTasks.length,
      });
    } catch (error) {
      updateDebugInfo({
        lastAction: `load-tasks:error:${error instanceof Error ? error.message : String(error)}`,
      });
      throw error;
    }
  }, [taskService]);

  const loadEvents = useCallback(async () => {
    const userId = getCurrentUserId();
    try {
      const page = await getEventStorage(userId).getEventsPage({ limit: 2 });
      const nextEvents = page.events.map(toUiEvent);
      setEvents(nextEvents);
      updateDebugInfo({
        userId,
        eventCount: nextEvents.length,
        latestEventContent: nextEvents[0]?.content ?? "",
      });
    } catch (error) {
      updateDebugInfo({
        userId,
        lastAction: `load-events:error:${error instanceof Error ? error.message : String(error)}`,
      });
      throw error;
    }
  }, []);

  const loadActiveBlock = useCallback(async () => {
    try {
      const block = await timeBlockService.loadActiveBlock();
      setActiveBlock(block);
      setFeedbackOpen(isFeedbackStage(block));
      updateDebugInfo({
        userId: getCurrentUserId(),
        activeBlockName: block?.name ?? "",
      });
    } catch (error) {
      updateDebugInfo({
        lastAction: `load-active-block:error:${error instanceof Error ? error.message : String(error)}`,
      });
      throw error;
    }
  }, [timeBlockService]);

  const reloadAll = useCallback(async () => {
    if (!profileReady) return; // 等 profile 到达后再加载
    await Promise.all([loadActiveBlock(), loadTasks(), loadEvents()]);
  }, [profileReady, loadActiveBlock, loadTasks, loadEvents]);

  useEffect(() => {
    let disposed = false;

    // 监听主窗口发来的档案同步事件（唯一可靠的档案来源）
    const unlistenProfile = listen<{ profileId: string }>(
      "main-window-profile-sync",
      (event) => {
        if (disposed) return;
        const { profileId } = event.payload;
        if (profileId) {
          setProfileSession({
            version: 1,
            activeProfileId: profileId,
            unlockedProfileIds: [profileId],
          });
          setProfileReady(true);
          void reloadAll();
        }
      },
    );

    // listener 设置完毕后，主动向主窗口请求档案
    void emit("overlay-request-profile").catch(() => {});

    const unsubscribeBlock = timeBlockService.onBlockChange((block) => {
      if (disposed) return;
      setActiveBlock(block);
      setFeedbackOpen(isFeedbackStage(block));
      setNow(Date.now());
      void loadTasks();
    });

    return () => {
      disposed = true;
      unlistenProfile.then((fn) => fn());
      unsubscribeBlock();
    };
  }, [loadTasks, reloadAll, timeBlockService]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void reloadAll();
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [reloadAll]);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    let disposed = false;
    let unlisten: (() => void) | null = null;

    void getCurrentWindow()
      .onFocusChanged((event) => {
        if (disposed || !event.payload) {
          return;
        }
        void reloadAll();
      })
      .then((cleanup) => {
        if (disposed) {
          cleanup();
          return;
        }
        unlisten = cleanup;
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [reloadAll]);

  useEffect(() => {
    if (!activeBlock || activeBlock.paused || isFeedbackStage(activeBlock)) {
      return;
    }

    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [activeBlock]);

  const model = useMemo(
    () =>
      buildNowWorkbenchOverlayModel({
        activeBlock,
        tasks,
        events,
        now,
      }),
    [activeBlock, events, now, tasks],
  );
  const activeBlockTaskIds = useMemo(
    () => resolveActiveBlockTaskIds(activeBlock),
    [activeBlock],
  );
  const activeBlockTasks = useMemo(() => {
    if (activeBlockTaskIds.length === 0) {
      return [];
    }
    const taskMap = new Map(tasks.map((task) => [task.id, task]));
    return activeBlockTaskIds
      .map((taskId) => taskMap.get(taskId))
      .filter((task): task is TaskNode => Boolean(task));
  }, [activeBlockTaskIds, tasks]);

  useEffect(() => {
    updateDebugInfo({
      userId: (() => { try { return getCurrentUserId(); } catch { return ''; } })(),
      mode: model.mode,
      taskCount: model.visibleTasks.length,
      eventCount: model.recentEvents.length,
      activeBlockName: model.activeBlock?.name ?? "",
      latestEventContent: model.recentEvents[0]?.content ?? "",
      lastReloadAt: new Date().toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }),
    });
  }, [model, updateDebugInfo]);

  useEffect(() => {
    setTaskStatusChoices((current) => {
      if (activeBlockTaskIds.length === 0) {
        return Object.keys(current).length === 0 ? current : {};
      }

      const nextChoices = activeBlockTaskIds.reduce<
        Record<string, TaskStatusChoice>
      >((choices, taskId) => {
        choices[taskId] = normalizeEndTaskStatusChoice(current[taskId]);
        return choices;
      }, {});

      const currentKeys = Object.keys(current);
      const nextKeys = Object.keys(nextChoices);
      if (
        currentKeys.length === nextKeys.length &&
        nextKeys.every((taskId) => current[taskId] === nextChoices[taskId])
      ) {
        return current;
      }

      return nextChoices;
    });
  }, [activeBlockTaskIds]);

  const setTaskStatusChoice = useCallback(
    (taskId: string, value: TaskStatusChoice) => {
      setTaskStatusChoices((current) => ({
        ...current,
        [taskId]: value,
      }));
    },
    [],
  );

  const handleHide = useCallback(async () => {
    if (!isTauri()) {
      await overlayService.hideTemporarily();
      updateDebugInfo({ lastAction: "hide:fallback-success" });
      return;
    }

    try {
      await getCurrentWindow().hide();
      updateDebugInfo({ lastAction: "hide:success" });
    } catch (error) {
      updateDebugInfo({
        lastAction: `hide:error:${error instanceof Error ? error.message : String(error)}`,
      });
      throw error;
    }
  }, [overlayService, updateDebugInfo]);

  const handleReturnToMain = useCallback(async () => {
    try {
      await overlayService.focusMainWindow();
      updateDebugInfo({ lastAction: "return-to-main:success" });
    } catch (error) {
      updateDebugInfo({
        lastAction: `return-to-main:error:${error instanceof Error ? error.message : String(error)}`,
      });
      throw error;
    }
  }, [overlayService, updateDebugInfo]);

  const handlePauseOrResume = useCallback(async () => {
    try {
      const block = await timeBlockService.loadActiveBlock();
      if (!block) return;
      if (block.paused || block.phase === "paused") {
        await timeBlockService.resumeBlock();
        updateDebugInfo({ lastAction: "resume:success" });
      } else {
        await timeBlockService.pauseBlock();
        updateDebugInfo({ lastAction: "pause:success" });
      }
      await loadActiveBlock();
    } catch (error) {
      updateDebugInfo({
        lastAction: `pause-or-resume:error:${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }, [loadActiveBlock, timeBlockService, updateDebugInfo]);

  const handleOpenEndDialog = useCallback(async () => {
    try {
      const block = await timeBlockService.loadActiveBlock();
      if (!block) return;
      const nextTaskIds = resolveActiveBlockTaskIds(block);
      if (!isFeedbackStage(block)) {
        await timeBlockService.markEnding();
      }
      await loadActiveBlock();
      setTaskStatusChoices(
        nextTaskIds.reduce<Record<string, TaskStatusChoice>>(
          (choices, taskId) => {
            choices[taskId] = normalizeEndTaskStatusChoice(undefined);
            return choices;
          },
          {},
        ),
      );
      setFeedbackOpen(true);
      updateDebugInfo({ lastAction: "open-end-dialog:success" });
    } catch (error) {
      updateDebugInfo({
        lastAction: `open-end-dialog:error:${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }, [loadActiveBlock, timeBlockService, updateDebugInfo]);

  const handleConfirmEnd = useCallback(async () => {
    try {
      const blockBeforeEnd = activeBlock;
      const taskIdsSnapshot = resolveActiveBlockTaskIds(blockBeforeEnd);
      const taskTitles = activeBlockTasks.reduce<Record<string, string>>(
        (titles, task) => {
          titles[task.id] = task.title;
          return titles;
        },
        {},
      );
      const taskStatusOutcomes = taskIdsSnapshot.reduce<Record<string, string>>(
        (outcomes, taskId) => {
          const taskStatusChoice = normalizeEndTaskStatusChoice(
            taskStatusChoices[taskId],
          );
          outcomes[taskId] = taskStatusChoice;
          return outcomes;
        },
        {},
      );

      if (taskIdsSnapshot.length > 0) {
        await timeBlockService.endBlock(feedback, {
          taskStatusOutcomes:
            Object.keys(taskStatusOutcomes).length > 0
              ? taskStatusOutcomes
              : undefined,
          taskTitles:
            Object.keys(taskTitles).length > 0 ? taskTitles : undefined,
        });
      } else {
        await timeBlockService.endBlock(feedback);
      }

      if (blockBeforeEnd && taskIdsSnapshot.length > 0) {
        try {
          await taskTimerService.onBlockEndForTasks(
            taskIdsSnapshot,
            blockBeforeEnd.startId,
          );
          for (const taskId of taskIdsSnapshot) {
            const taskStatusChoice = normalizeEndTaskStatusChoice(
              taskStatusChoices[taskId],
            );
            const task = activeBlockTasks.find(
              (candidate) => candidate.id === taskId,
            );
            if (task) {
              await appendTaskStatusChangeDescription({
                taskId,
                taskTitle: task.title,
                fromStatus: task.status,
                toStatus: taskStatusChoice as TaskStatus,
                description: feedback,
              });
            }
          }
        } catch (transitionError) {
          updateDebugInfo({
            lastAction: `end-block:task-transition-error:${transitionError instanceof Error ? transitionError.message : String(transitionError)}`,
          });
        }
      }

      setFeedback("");
      setFeedbackOpen(false);
      setTaskStatusChoices({});
      await reloadAll();
      updateDebugInfo({ lastAction: "end-block:success" });
    } catch (error) {
      updateDebugInfo({
        lastAction: `end-block:error:${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }, [
    activeBlock,
    activeBlockTasks,
    feedback,
    reloadAll,
    taskService,
    taskStatusChoices,
    taskTimerService,
    timeBlockService,
    updateDebugInfo,
  ]);

  const handleStartTask = useCallback(
    async (task: TaskNode) => {
      if (isTerminalTask(task)) {
        updateDebugInfo({ lastAction: `task-select:skip-terminal:${task.id}` });
        return;
      }

      try {
        if (activeBlock) {
          await taskTimerService.addTaskToBlock(task.id);
          updateDebugInfo({
            lastAction: `task-select:add-to-block:${task.id}`,
          });
        } else {
          const spentMinutes =
            task.estimatedMinutes != null
              ? await taskTimerService.calculateSpentMinutes(task.id)
              : 0;
          await taskTimerService.startBlockForTask(
            task.id,
            buildQuickStartTimerConfig(task, spentMinutes),
          );
          updateDebugInfo({ lastAction: `task-select:start-block:${task.id}` });
        }
        await reloadAll();
      } catch (error) {
        updateDebugInfo({
          lastAction: `task-select:error:${task.id}:${error instanceof Error ? error.message : String(error)}`,
        });
        throw error;
      }
    },
    [activeBlock, reloadAll, taskTimerService, updateDebugInfo],
  );

  const handleSend = useCallback(
    async (content: string, tags?: string[]) => {
      try {
        const tagSet = tags?.length ? new Set(tags) : undefined;
        if (tagSet) {
          await eventLogService.addEvent(content, tagSet);
        } else {
          await eventLogService.addEvent(content);
        }
        await loadEvents();
        updateDebugInfo({ lastAction: "send:success" });
      } catch (error) {
        updateDebugInfo({
          lastAction: `send:error:${error instanceof Error ? error.message : String(error)}`,
        });
        throw error;
      }
    },
    [eventLogService, loadEvents, updateDebugInfo],
  );

  return {
    model: model ?? EMPTY_MODEL,
    feedbackOpen,
    feedback,
    activeBlockTasks,
    taskStatusChoices,
    debugInfo,
    setFeedback,
    setTaskStatusChoice,
    handleHide,
    handleReturnToMain,
    handlePauseOrResume,
    handleOpenEndDialog,
    handleConfirmEnd,
    handleStartTask,
    handleSend,
  };
}
