import { useCallback, useEffect, useMemo, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getCurrentUserId, getEventStorage, type Event as StoredEvent } from '@/lib/storage/event-storage';
import {
  getEventLogService,
  getTaskService,
  getTimeBlockService,
} from '@/lib/services';
import type { ActiveBlockData, Event as UiEvent } from '@/lib/types/event';
import type { TaskNode, TaskStatus } from '@/lib/types/task';
import type { TaskStatusChoice } from '@/ui/app/components/TaskStatusSelector';
import { buildNowWorkbenchOverlayModel, type NowWorkbenchOverlayMode } from './now-workbench-overlay-model';
import { getNowWorkbenchOverlayService } from '@/services/now-workbench-overlay.service';

interface NowWorkbenchOverlayController {
  model: ReturnType<typeof buildNowWorkbenchOverlayModel>;
  feedbackOpen: boolean;
  feedback: string;
  taskStatusChoice: TaskStatusChoice;
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
  setTaskStatusChoice(value: TaskStatusChoice): void;
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
  };
}

function isFeedbackStage(block: ActiveBlockData | null): boolean {
  if (!block) return false;
  return block.phase === 'feedback_in_progress'
    || block.phase === 'action_ended'
    || Boolean(block.actionEndedAt || block.feedbackStartedAt);
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
  const eventLogService = useMemo(() => getEventLogService(), []);
  const overlayService = useMemo(() => getNowWorkbenchOverlayService(), []);
  const [activeBlock, setActiveBlock] = useState<ActiveBlockData | null>(null);
  const [tasks, setTasks] = useState<TaskNode[]>([]);
  const [events, setEvents] = useState<UiEvent[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [taskStatusChoice, setTaskStatusChoice] = useState<TaskStatusChoice>('continue');
  const [debugInfo, setDebugInfo] = useState<NowWorkbenchOverlayDebugInfo>(() => ({
    userId: getCurrentUserId(),
    mode: EMPTY_MODEL.mode,
    taskCount: 0,
    eventCount: 0,
    activeBlockName: '',
    latestEventContent: '',
    lastReloadAt: '',
    lastAction: 'init',
  }));

  const updateDebugInfo = useCallback((patch: Partial<NowWorkbenchOverlayDebugInfo>) => {
    setDebugInfo((current) => ({
      ...current,
      ...patch,
    }));
  }, []);

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
        latestEventContent: nextEvents[0]?.content ?? '',
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
        activeBlockName: block?.name ?? '',
      });
    } catch (error) {
      updateDebugInfo({
        lastAction: `load-active-block:error:${error instanceof Error ? error.message : String(error)}`,
      });
      throw error;
    }
  }, [timeBlockService]);

  const reloadAll = useCallback(async () => {
    await Promise.all([
      loadActiveBlock(),
      loadTasks(),
      loadEvents(),
    ]);
  }, [loadActiveBlock, loadTasks, loadEvents]);

  useEffect(() => {
    let disposed = false;

    void reloadAll();

    const unsubscribeBlock = timeBlockService.onBlockChange((block) => {
      if (disposed) return;
      setActiveBlock(block);
      setFeedbackOpen(isFeedbackStage(block));
      setNow(Date.now());
      void loadTasks();
    });

    return () => {
      disposed = true;
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

    void getCurrentWindow().onFocusChanged((event) => {
      if (disposed || !event.payload) {
        return;
      }
      void reloadAll();
    }).then((cleanup) => {
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

  const model = useMemo(() => buildNowWorkbenchOverlayModel({
    activeBlock,
    tasks,
    events,
    now,
  }), [activeBlock, events, now, tasks]);

  useEffect(() => {
    updateDebugInfo({
      userId: getCurrentUserId(),
      mode: model.mode,
      taskCount: model.visibleTasks.length,
      eventCount: model.recentEvents.length,
      activeBlockName: model.activeBlock?.name ?? '',
      latestEventContent: model.recentEvents[0]?.content ?? '',
      lastReloadAt: new Date().toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }),
    });
  }, [model, updateDebugInfo]);

  const handleHide = useCallback(async () => {
    if (!isTauri()) {
      await overlayService.hideTemporarily();
      updateDebugInfo({ lastAction: 'hide:fallback-success' });
      return;
    }

    try {
      await getCurrentWindow().hide();
      updateDebugInfo({ lastAction: 'hide:success' });
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
      updateDebugInfo({ lastAction: 'return-to-main:success' });
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
      if (block.paused || block.phase === 'paused') {
        await timeBlockService.resumeBlock();
        updateDebugInfo({ lastAction: 'resume:success' });
      } else {
        await timeBlockService.pauseBlock();
        updateDebugInfo({ lastAction: 'pause:success' });
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
      if (!isFeedbackStage(block)) {
        await timeBlockService.markEnding();
      }
      await loadActiveBlock();
      setFeedbackOpen(true);
      updateDebugInfo({ lastAction: 'open-end-dialog:success' });
    } catch (error) {
      updateDebugInfo({
        lastAction: `open-end-dialog:error:${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }, [loadActiveBlock, timeBlockService, updateDebugInfo]);

  const handleConfirmEnd = useCallback(async () => {
    try {
      const blockBeforeEnd = activeBlock;
      await timeBlockService.endBlock(feedback);

      if (taskStatusChoice !== 'continue' && blockBeforeEnd?.taskId) {
        try {
          await taskService.transitionTask(blockBeforeEnd.taskId, taskStatusChoice as TaskStatus);
        } catch (transitionError) {
          updateDebugInfo({
            lastAction: `end-block:task-transition-error:${transitionError instanceof Error ? transitionError.message : String(transitionError)}`,
          });
        }
      }

      setFeedback('');
      setFeedbackOpen(false);
      setTaskStatusChoice('continue');
      await reloadAll();
      updateDebugInfo({ lastAction: 'end-block:success' });
    } catch (error) {
      updateDebugInfo({
        lastAction: `end-block:error:${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }, [activeBlock, feedback, reloadAll, taskService, taskStatusChoice, timeBlockService, updateDebugInfo]);

  const handleStartTask = useCallback(async (task: TaskNode) => {
    updateDebugInfo({ lastAction: `task-select:open-config:${task.id}` });
  }, [updateDebugInfo]);

  const handleSend = useCallback(async (content: string, tags?: string[]) => {
    try {
      const tagSet = tags?.length ? new Set(tags) : undefined;
      if (tagSet) {
        await eventLogService.addEvent(content, tagSet);
      } else {
        await eventLogService.addEvent(content);
      }
      await loadEvents();
      updateDebugInfo({ lastAction: 'send:success' });
    } catch (error) {
      updateDebugInfo({
        lastAction: `send:error:${error instanceof Error ? error.message : String(error)}`,
      });
      throw error;
    }
  }, [eventLogService, loadEvents, updateDebugInfo]);

  return {
    model: model ?? EMPTY_MODEL,
    feedbackOpen,
    feedback,
    taskStatusChoice,
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
