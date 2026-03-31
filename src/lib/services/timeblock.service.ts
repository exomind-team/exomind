/**
 * TimeBlockService - 时间块管理
 *
 * ┌─────────────────────────────────────────┐
 * │  L3 Service                            │
 * │  ─────────────────────────────────     │
 * │  - 时间块 CRUD                         │
 * │  - 计时状态管理                         │
 * │  - 事件关联                           │
 * └─────────────────────────────────────────┘
 */

import { ExoMindEnvironment } from '../environment/environment';
import {
  getActiveBlockStorage,
  getCurrentSyncUserId,
  type ActiveBlockStorage,
} from '../storage/active-block-storage';
import { getTimeblockBackendMode, type DomainBackendMode } from '@/config/domain-backend-mode';
import { TimeBlockRtAdapter } from '@/lib/adapters/timeblock-rt-adapter';
import {
  normalizeActiveBlockTaskIds,
  normalizeTimeBlockTaskIds,
} from '../types/event';
import type {
  TimeBlock,
  TimeBlockData,
  ActiveBlockData,
  ActiveBlockPhase,
  BlockTaskAssociationEvent,
  TimerConfig,
} from '../types/event';
import { getFeedbackPreferences, type FeedbackPreferences } from '../../config/feedback-preferences';
import { getSelectedRuntimeTarget, type RuntimeTarget } from '@/config/runtime-target';
import { createUuidV4 } from '../utils/uuid';
import { getEventSourceMetadata } from '../eventlog/source-metadata';
import { generateGapBlocks } from './gap-backfill';
import { appendEventWithEcsReplication } from './ecs-eventlog-replication.service';
import { getEventLogService } from './eventlog.service';
import { publishActiveBlockReplicationSnapshot } from './ecs-active-block-replication.service';
import { SignalStreamService } from './signal-stream.service';
import { log } from '@/lib/logger';

// 存储键
const TIME_BLOCKS_KEY = 'time_blocks';
const ACTIVE_BLOCK_KEY = 'active_block';

function perfNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

interface BlockPreferenceDecision {
  preferred: ActiveBlockData;
  reason: string;
  compared: 'start_time' | 'phase' | 'version' | 'transition_time' | 'actor_id' | 'fallback';
}

interface TimeBlockRtPort {
  listCompletedBlocks(): Promise<TimeBlockData[]>;
  /** TODO(#780): migrate backfillGapBlocks to atomic RT primitive, then remove */
  replaceCompletedBlocks(blocks: TimeBlockData[]): Promise<void>;
  getActiveBlock(): Promise<ActiveBlockData | null>;
  /** TODO(#780): migrate saveActiveBlock/applyReplicatedActiveBlock callers, then remove */
  putActiveBlock(block: ActiveBlockData): Promise<void>;
  /** @deprecated No callers remain. Route returns 409 since #780 cleanup. */
  deleteActiveBlock(): Promise<void>;
  // #780 new RT routes
  rtStartBlock(params: { name: string; mode: string; targetMinutes?: number; taskIds?: string[]; sourcePlannedBlockId?: string }): Promise<{ completed: TimeBlockData | null; active: ActiveBlockData }>;
  rtStopBlock(): Promise<{ status: string }>;
  rtEndBlock(params: { feedback?: string; taskStatusOutcomes?: Record<string, string> }): Promise<{ completed: TimeBlockData | null; active: ActiveBlockData }>;
  rtPauseBlock(): Promise<{ status: string }>;
  rtResumeBlock(): Promise<{ status: string }>;
}

export interface TimeBlockServiceOptions {
  backendMode?: DomainBackendMode;
  rtAdapter?: TimeBlockRtPort;
}

export interface TimeBlockService {
  /** 加载已完成的时间块 */
  loadTimeBlocks(): Promise<TimeBlock[]>;

  /** 加载当前进行中的时间块 */
  loadActiveBlock(): Promise<ActiveBlockData | null>;

  /** 开始时间块 */
  startBlock(
    name: string,
    config: TimerConfig,
    description?: string,
    taskBinding?: string | { taskIds: string[] },
  ): Promise<ActiveBlockData>;

  /** 更新当前进行中时间块的任务关联 */
  updateActiveBlock(
    patch: Partial<Pick<ActiveBlockData, 'taskIds' | 'taskAssociationLog'>>,
  ): Promise<ActiveBlockData | null>;

  /** 标记“行动结束/开始填写反馈”（点击结束时刻） */
  markEnding(): Promise<void>;

  /** 暂停时间块 */
  pauseBlock(): Promise<void>;

  /** 继续时间块 */
  resumeBlock(): Promise<void>;

  /** 结束时间块 */
  endBlock(
    feedback?: string,
    options?: {
      taskStatusOutcomes?: Record<string, string>;
      taskTitles?: Record<string, string>;
    },
  ): Promise<TimeBlock | null>;

  /** 更新已计时时长（由 UI 定时调用） */
  updateElapsed(elapsed: number): Promise<void>;

  /** 监听时间块变化 */
  onBlockChange(callback: (block: ActiveBlockData | null) => void): () => void;

  /** 启动进行中时间块同步 */
  startSync(remoteUrl?: string): Promise<void>;

  /** 停止进行中时间块同步 */
  stopSync(): Promise<void>;

  /** 应用来自远端复制的 active block 快照 */
  applyReplicatedActiveBlock(block: ActiveBlockData): Promise<void>;
}

export class TimeBlockServiceImpl implements TimeBlockService {
  private env: ExoMindEnvironment;
  private activeBlockStorage: ActiveBlockStorage | null = null;
  private activeStorageUserId: string | null = null;
  private readonly useInjectedEnvStorage: boolean;
  private readonly backendMode: DomainBackendMode;
  private readonly rtAdapter: TimeBlockRtPort | null;
  private listeners: Set<(block: ActiveBlockData | null) => void> = new Set();
  private syncSubscriberCount = 0;
  private activeSyncRemoteUrl: string | null = null;
  private pendingStorageStop: Promise<void> = Promise.resolve();
  private unsubscribeStorageListener: (() => void) | null = null;
  private lastAcceptedBlock: ActiveBlockData | null = null;
  private lastCanonicalWriteBackSignature: string | null = null;
  private readonly actorId = createUuidV4();

  constructor(env?: ExoMindEnvironment, options: TimeBlockServiceOptions = {}) {
    this.env = env || ExoMindEnvironment.getInstance();
    this.useInjectedEnvStorage = typeof env !== 'undefined';
    this.backendMode = options.backendMode ?? this.resolveDefaultBackendMode();
    this.rtAdapter = this.backendMode === 'rt-sqlite'
      ? (options.rtAdapter ?? new TimeBlockRtAdapter())
      : null;
    if (this.backendMode === 'legacy' && !this.useInjectedEnvStorage) {
      this.switchActiveStorage();
    }
    this.attachStorageListener();
  }

  /**
   * TODO(#749): Once Tauri desktop fully migrates to rt-sqlite (MigrationDialog
   * no longer falls back to legacy), this can be simplified to always return
   * 'rt-sqlite'. The useInjectedEnvStorage path is test-only.
   */
  private resolveDefaultBackendMode(): DomainBackendMode {
    if (this.useInjectedEnvStorage) {
      return 'legacy';
    }

    return this.env.runtime === 'tauri' ? getTimeblockBackendMode() : 'rt-sqlite';
  }

  async loadTimeBlocks(): Promise<TimeBlock[]> {
    const data = await this.readCompletedBlockData();
    if (!data) return [];

    return data.map((block) => {
      const normalized = normalizeTimeBlockTaskIds(block);
      return {
        ...normalized,
        tags: new Set(normalized.tags),
      };
    });
  }

  /** #759: 全量补创历史 gap 块。返回插入的 gap 数量。 */
  async backfillGapBlocks(): Promise<number> {
    const blocks = await this.readCompletedBlockData();
    if (!blocks || blocks.length < 2) return 0;

    const gaps = generateGapBlocks(blocks);
    if (gaps.length === 0) return 0;

    const merged = [...blocks, ...gaps].sort((a, b) => a.startTime - b.startTime);
    await this.writeCompletedBlockData(merged);
    return gaps.length;
  }

  async updateActiveBlock(
    patch: Partial<Pick<ActiveBlockData, 'taskIds' | 'taskAssociationLog'>>,
  ): Promise<ActiveBlockData | null> {
    const existing = await this.readActiveBlock();
    if (!existing) return null;

    const now = Date.now();
    const normalizedExisting = this.normalizeActiveBlock(existing, now);
    if (this.isCompletedBlock(normalizedExisting)) {
      this.rememberAcceptedBlock(normalizedExisting);
      return null;
    }

    const updated = this.normalizeActiveBlock({
      ...normalizedExisting,
      ...patch,
      version: this.nextVersion(normalizedExisting),
      actorId: this.actorId,
      updatedAt: now,
    }, now);

    await this.saveActiveBlock(updated);
    this.rememberAcceptedBlock(updated);
    this.notifyChange(updated);
    return updated;
  }

  async loadActiveBlock(): Promise<ActiveBlockData | null> {
    const data = await this.readActiveBlock();
    if (!data) return null;

    const normalized = this.normalizeActiveBlock(data);
    if (this.shouldPersistCanonicalization(data, normalized)) {
      await this.saveActiveBlock(normalized);
    }

    this.rememberAcceptedBlock(normalized);
    if (this.isCompletedBlock(normalized)) {
      return null;
    }

    return normalized;
  }

  async startBlock(
    name: string,
    config: TimerConfig,
    description?: string,
    taskBinding?: string | { taskIds: string[] },
  ): Promise<ActiveBlockData> {
    // 不允许在已有活跃块（运行中/已暂停）时开启新块
    const existing = await this.readActiveBlock();
    if (existing) {
      const normalized = this.normalizeActiveBlock(existing);
      if (this.shouldPersistCanonicalization(existing, normalized)) {
        await this.saveActiveBlock(normalized);
      }
      this.rememberAcceptedBlock(normalized);
      if (!this.isCompletedBlock(normalized)) {
        return normalized;
      }
      // #759: 截断 gap 块，存为 completed TimeBlockData
      if (normalized.blockType === 'gap') {
        const now = Date.now();
        const completedGap: TimeBlockData = {
          id: normalized.startId,
          name: normalized.name,
          startId: normalized.startId,
          endId: createUuidV4(),
          tags: [],
          startTime: normalized.startTime,
          endTime: now,
          blockType: 'gap',
        };
        const completed = await this.readCompletedBlockData();
        completed.push(completedGap);
        await this.writeCompletedBlockData(completed);
      }
    }

    // #780: rt-sqlite 模式走新路由，RT 处理状态转换、事件写入、gap 截断
    if (this.backendMode === 'rt-sqlite' && this.rtAdapter) {
      const resolvedTaskIds = typeof taskBinding === 'string'
        ? [taskBinding]
        : taskBinding?.taskIds ?? [];
      const result = await this.rtAdapter.rtStartBlock({
        name,
        mode: config.mode,
        targetMinutes: config.mode === 'countdown' ? config.minutes : undefined,
        taskIds: resolvedTaskIds,
      });
      this.rememberAcceptedBlock(result.active);
      this.notifyChange(result.active);
      return result.active;
    }

    const startId = createUuidV4();
    const now = Date.now();
    const initialElapsed = config.mode === 'countdown'
      ? (config.minutes ?? 25) * 60 * 1000
      : 0;
    const resolvedTaskIds = typeof taskBinding === 'string'
      ? [taskBinding]
      : taskBinding?.taskIds ?? [];
    const taskAssociationLog: BlockTaskAssociationEvent[] = resolvedTaskIds.map((linkedTaskId) => ({
      blockId: startId,
      taskId: linkedTaskId,
      action: 'associated',
      timestamp: now,
      source: 'block_start',
    }));

    // 创建开始事件
    const normalizedDescription = description?.trim();
    const eventContent = normalizedDescription ? `${name}\n${normalizedDescription}` : name;
    if (this.shouldWriteFrontendLifecycleEvent()) {
      await this.addBlockEvent(eventContent, 'block_start', new Date(now).toISOString());
    }

    // 保存进行中的时间块
    const activeBlock: ActiveBlockData = {
      startId,
      name,
      startTime: now,
      elapsed: initialElapsed,
      mode: config.mode,
      targetMinutes: config.mode === 'countdown' ? (config.minutes ?? 25) : undefined,
      blockType: 'active',
      phase: 'running',
      version: 1,
      actorId: this.actorId,
      lastTransitionAt: now,
      lastResumedAt: now,
      accumulatedRunMs: 0,
      pauseAccumulatedMs: 0,
      paused: false,
      pausedAt: undefined,
      updatedAt: now,
      actionEndedAt: undefined,
      feedbackStartedAt: undefined,
      feedbackSubmittedAt: undefined,
      taskIds: resolvedTaskIds,
      taskAssociationLog,
      taskId: undefined,
    };
    const normalizedActiveBlock = this.normalizeActiveBlock(activeBlock, now);

    await this.saveActiveBlock(normalizedActiveBlock);
    this.rememberAcceptedBlock(normalizedActiveBlock);

    // 通知变化
    this.notifyChange(normalizedActiveBlock);

    return normalizedActiveBlock;
  }

  async pauseBlock(): Promise<void> {
    const opStart = perfNow();
    const now = Date.now();
    const raw = await this.readActiveBlock();
    if (!raw) return;
    const normalized = this.normalizeActiveBlock(raw, now);
    if (normalized.paused || this.isCompletedBlock(normalized) || this.isFeedbackInProgress(normalized)) {
      this.rememberAcceptedBlock(normalized);
      return;
    }

    // #780: rt-sqlite 模式走新路由
    if (this.backendMode === 'rt-sqlite' && this.rtAdapter) {
      await this.rtAdapter.rtPauseBlock();
      const updated = await this.rtAdapter.getActiveBlock();
      if (updated) {
        this.rememberAcceptedBlock(updated);
        this.notifyChange(updated);
      }
      return;
    }

    const pausedBlock: ActiveBlockData = this.normalizeActiveBlock({
      ...normalized,
      phase: 'paused',
      version: this.nextVersion(normalized),
      actorId: this.actorId,
      paused: true,
      pausedAt: now,
      lastTransitionAt: now,
      lastResumedAt: undefined,
      accumulatedRunMs: this.calculateRunDurationMs(normalized, now),
      updatedAt: now,
      pauseAccumulatedMs: normalized.pauseAccumulatedMs ?? 0,
    }, now);

    const saveStart = perfNow();
    await this.saveActiveBlock(pausedBlock);
    const saveMs = Math.round(perfNow() - saveStart);
    this.rememberAcceptedBlock(pausedBlock);

    // 记录暂停事件
    const eventStart = perfNow();
    if (this.shouldWriteFrontendLifecycleEvent()) {
      await this.addBlockEvent(`${normalized.name} 暂停`, 'block_pause', new Date(now).toISOString());
    }
    const eventMs = Math.round(perfNow() - eventStart);
    this.notifyChange(pausedBlock);
    log.info(`[TB-SVC] pauseBlock done ${JSON.stringify({ startId: pausedBlock.startId, saveMs, eventMs, totalMs: Math.round(perfNow() - opStart) })}`);
  }

  async resumeBlock(): Promise<void> {
    const opStart = perfNow();
    const now = Date.now();
    const raw = await this.readActiveBlock();
    if (!raw) return;
    const normalized = this.normalizeActiveBlock(raw, now);
    if (!normalized.paused || this.isCompletedBlock(normalized) || this.isFeedbackInProgress(normalized)) {
      this.rememberAcceptedBlock(normalized);
      return;
    }

    // #780: rt-sqlite 模式走新路由
    if (this.backendMode === 'rt-sqlite' && this.rtAdapter) {
      await this.rtAdapter.rtResumeBlock();
      const updated = await this.rtAdapter.getActiveBlock();
      if (updated) {
        this.rememberAcceptedBlock(updated);
        this.notifyChange(updated);
      }
      return;
    }

    const pausedAt = normalized.pausedAt ?? now;
    const pauseAccumulatedMs = (normalized.pauseAccumulatedMs ?? 0) + Math.max(0, now - pausedAt);
    const resumedBlock: ActiveBlockData = this.normalizeActiveBlock({
      ...normalized,
      phase: 'running',
      version: this.nextVersion(normalized),
      actorId: this.actorId,
      paused: false,
      pausedAt: undefined,
      lastTransitionAt: now,
      lastResumedAt: now,
      pauseAccumulatedMs,
      updatedAt: now,
      accumulatedRunMs: normalized.accumulatedRunMs ?? this.calculateRunDurationMs(normalized, now),
    }, now);

    const saveStart = perfNow();
    await this.saveActiveBlock(resumedBlock);
    const saveMs = Math.round(perfNow() - saveStart);
    this.rememberAcceptedBlock(resumedBlock);

    // 记录继续事件
    const eventStart = perfNow();
    if (this.shouldWriteFrontendLifecycleEvent()) {
      await this.addBlockEvent(`${normalized.name} 继续`, 'block_resume', new Date(now).toISOString());
    }
    const eventMs = Math.round(perfNow() - eventStart);
    this.notifyChange(resumedBlock);
    log.info(`[TB-SVC] resumeBlock done ${JSON.stringify({ startId: resumedBlock.startId, saveMs, eventMs, totalMs: Math.round(perfNow() - opStart) })}`);
  }

  async markEnding(): Promise<void> {
    const opStart = perfNow();
    const raw = await this.readActiveBlock();
    if (!raw) return;

    const now = Date.now();
    const normalized = this.normalizeActiveBlock(raw, now);
    if (normalized.actionEndedAt || this.isCompletedBlock(normalized)) {
      this.rememberAcceptedBlock(normalized);
      return;
    }

    // #780: rt-sqlite 模式走新路由（stop = markEnding）
    if (this.backendMode === 'rt-sqlite' && this.rtAdapter) {
      await this.rtAdapter.rtStopBlock();
      const updated = await this.rtAdapter.getActiveBlock();
      if (updated) {
        this.rememberAcceptedBlock(updated);
        this.notifyChange(updated);
      }
      return;
    }

    const actionEndedAt = normalized.actionEndedAt ?? now;
    const feedbackStartedAt = normalized.feedbackStartedAt ?? actionEndedAt;
    const pauseAccumulatedMs = (normalized.pauseAccumulatedMs ?? 0) + (
      normalized.paused && normalized.pausedAt
        ? Math.max(0, actionEndedAt - normalized.pausedAt)
        : 0
    );

    // rt-sqlite 由 RT 在 active block 进入结束态时写 block_end，避免前后端重复。
    const eventStart = perfNow();
    if (this.shouldWriteFrontendLifecycleEvent()) {
      await this.addBlockEvent(`${normalized.name} 完成`, 'block_end', new Date(actionEndedAt).toISOString());
    }
    const eventMs = Math.round(perfNow() - eventStart);

    const endedBlock: ActiveBlockData = this.normalizeActiveBlock({
      ...normalized,
      phase: 'feedback_in_progress',
      version: this.nextVersion(normalized),
      actorId: this.actorId,
      actionEndedAt,
      feedbackStartedAt,
      accumulatedRunMs: this.calculateRunDurationMs(normalized, actionEndedAt),
      lastTransitionAt: actionEndedAt,
      lastResumedAt: undefined,
      paused: false,
      pausedAt: undefined,
      pauseAccumulatedMs,
      updatedAt: actionEndedAt,
    }, actionEndedAt);

    const saveStart = perfNow();
    await this.saveActiveBlock(endedBlock);
    const saveMs = Math.round(perfNow() - saveStart);
    this.rememberAcceptedBlock(endedBlock);
    this.notifyChange(endedBlock);
    log.info(`[TB-SVC] markEnding done ${JSON.stringify({ startId: endedBlock.startId, saveMs, eventMs, totalMs: Math.round(perfNow() - opStart) })}`);
  }

  async endBlock(
    feedback?: string,
    options?: {
      taskStatusOutcomes?: Record<string, string>;
      taskTitles?: Record<string, string>;
    },
  ): Promise<TimeBlock | null> {
    const opStart = perfNow();
    const rawActiveData = await this.readActiveBlock();
    if (!rawActiveData) return null;
    const activeData = this.normalizeActiveBlock(rawActiveData);
    if (this.isCompletedBlock(activeData)) {
      this.rememberAcceptedBlock(activeData);
      return null;
    }

    // #780: rt-sqlite 模式走新路由，RT 处理 completed 保存、gap 创建、EventLog 写入
    if (this.backendMode === 'rt-sqlite' && this.rtAdapter) {
      const result = await this.rtAdapter.rtEndBlock({
        feedback,
        taskStatusOutcomes: options?.taskStatusOutcomes,
      });
      // RT 已处理：completed 块保存、gap 块创建、EventLog 写入
      // TS 只需更新本地状态
      this.rememberAcceptedBlock(result.active);
      this.notifyChange(result.active);

      if (result.completed) {
        return {
          ...result.completed,
          tags: new Set(result.completed.tags),
        };
      }
      return null;
    }

    const actionStartAt = activeData.startTime;
    const submittedAt = Date.now();
    const actionEndedAt = activeData.actionEndedAt ?? submittedAt;
    const feedbackStartedAt = activeData.feedbackStartedAt ?? actionEndedAt;

    const basePausedMs = activeData.pauseAccumulatedMs ?? 0;
    const finalPauseSliceMs = activeData.paused && activeData.pausedAt
      ? Math.max(0, actionEndedAt - activeData.pausedAt)
      : 0;
    const pausedDurationMs = basePausedMs + finalPauseSliceMs;

    const actionDurationMs = Math.max(0, actionEndedAt - activeData.startTime);
    const feedbackDurationMs = Math.max(0, submittedAt - feedbackStartedAt);
    const totalDurationMs = Math.max(0, submittedAt - activeData.startTime);
    const workDurationMs = Math.max(0, actionDurationMs - pausedDurationMs);
    const expectedDurationMs = activeData.mode === 'countdown'
      ? (activeData.targetMinutes ?? 25) * 60 * 1000
      : null;
    const expectedEndAt = expectedDurationMs === null
      ? null
      : actionStartAt + expectedDurationMs;

    const endId = createUuidV4();

    const timeBlockName = activeData.name;
    const feedbackText = feedback?.trim() ?? '';
    const hasFeedback = feedbackText.length > 0;
    const feedbackPreferences = getFeedbackPreferences();
    const report = this.buildFeedbackReport({
      timeBlockName,
      feedbackText,
      hasFeedback,
      feedbackPreferences,
      feedbackDurationMs,
      pausedDurationMs,
      workDurationMs,
      totalDurationMs,
      expectedDurationMs,
      expectedEndAt,
      actionStartAt,
      actionEndedAt,
      submittedAt,
      taskStatusOutcomes: options?.taskStatusOutcomes,
      taskTitles: options?.taskTitles,
    });

    const feedbackEventStart = perfNow();
    await appendEventWithEcsReplication({
      id: createUuidV4(),
      content: report,
      createdAt: new Date(submittedAt).toISOString(),
      type: 'block_feedback',
      metadata: {
        source: getEventSourceMetadata(),
        startTime: activeData.startTime,
        actionEndedAt,
        feedbackStartedAt,
        submittedAt,
        actionDurationMs,
        feedbackDurationMs,
        pausedDurationMs,
        workDurationMs,
        totalDurationMs,
        expectedDurationMs,
      },
    });
    const feedbackEventMs = Math.round(perfNow() - feedbackEventStart);

    // 保存已完成的时间块
    const timeBlock: TimeBlockData = {
      id: activeData.startId,  // 使用 startId 作为 id
      name: activeData.name,
      startId: activeData.startId,
      endId,
      note: feedback?.trim() || undefined,
      tags: ['block_feedback'],
      startTime: activeData.startTime,
      endTime: submittedAt,
      blockType: activeData.blockType ?? 'active',
      taskIds: activeData.taskIds ?? [],
      taskStatusOutcomes: options?.taskStatusOutcomes,
      taskAssociationLog: activeData.taskAssociationLog ?? [],
      sourcePlannedBlockId: activeData.sourcePlannedBlockId,
    };

    // 追加到已完成列表
    const completedWriteStart = perfNow();
    const completed = await this.readCompletedBlockData();
    completed.push(timeBlock);
    await this.writeCompletedBlockData(completed);
    const completedWriteMs = Math.round(perfNow() - completedWriteStart);

    // 保留终态标记，防止多端并发把状态回退到进行中
    const terminalBlock: ActiveBlockData = this.normalizeActiveBlock({
      ...activeData,
      phase: 'feedback_submitted',
      version: this.nextVersion(activeData),
      actorId: this.actorId,
      actionEndedAt,
      feedbackStartedAt,
      feedbackSubmittedAt: submittedAt,
      paused: false,
      pausedAt: undefined,
      lastResumedAt: undefined,
      lastTransitionAt: submittedAt,
      accumulatedRunMs: workDurationMs,
      pauseAccumulatedMs: pausedDurationMs,
      updatedAt: submittedAt,
    }, submittedAt);
    const saveTerminalStart = perfNow();
    await this.saveActiveBlock(terminalBlock);
    const saveTerminalMs = Math.round(perfNow() - saveTerminalStart);
    this.rememberAcceptedBlock(terminalBlock);

    // 发布 timeblock.completed 信号（fire-and-forget，失败不阻塞）
    // #759: gap 块不触发 completed 信号
    if (timeBlock.blockType !== 'gap') {
      this.publishTimeblockCompleted(timeBlock, report).catch((err) => {
        log.warn(`[TimeBlockService] failed to publish timeblock.completed signal: ${err instanceof Error ? err.message : String(err)}`);
      });
    }

    // #759: 创建 gap 块代替 notifyChange(null)
    const gapBlock: ActiveBlockData = this.normalizeActiveBlock({
      startId: createUuidV4(),
      name: '',
      mode: 'countup' as const,
      elapsed: 0,
      startTime: submittedAt,
      paused: false,
      taskIds: [],
      taskAssociationLog: [],
      blockType: 'gap',
      phase: undefined,
      version: 1,
      actorId: this.actorId,
      lastTransitionAt: submittedAt,
      updatedAt: submittedAt,
    }, submittedAt);
    await this.saveActiveBlock(gapBlock);
    this.rememberAcceptedBlock(gapBlock);
    this.notifyChange(gapBlock);
    log.info(`[TB-SVC] endBlock done, gap created ${JSON.stringify({ startId: terminalBlock.startId, gapStartId: gapBlock.startId, feedbackEventMs, completedWriteMs, saveTerminalMs, totalMs: Math.round(perfNow() - opStart) })}`);

    return {
      ...timeBlock,
      tags: new Set(timeBlock.tags),
    };
  }

  async applyReplicatedActiveBlock(block: ActiveBlockData): Promise<void> {
    const normalized = this.normalizeActiveBlock(block);
    if (this.backendMode === 'rt-sqlite') {
      await this.rtAdapter?.putActiveBlock(normalized);
    } else if (this.useInjectedEnvStorage) {
      await this.env.storage.write(ACTIVE_BLOCK_KEY, normalized);
    } else {
      await this.getActiveStorage().projectReplicatedActiveBlock(normalized);
    }

    this.rememberAcceptedBlock(normalized);
    if (this.isCompletedBlock(normalized)) {
      this.notifyChange(null);
      return;
    }
    this.notifyChange(normalized);
  }

  async updateElapsed(_elapsed: number): Promise<void> {
    // 高频 elapsed 仅用于本地 UI 展示，不再写入同步存储。
    return;
  }

  onBlockChange(callback: (block: ActiveBlockData | null) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  async startSync(remoteUrl?: string): Promise<void> {
    if (this.backendMode === 'rt-sqlite') {
      this.syncSubscriberCount += 1;
      const seededBlock = await this.loadActiveBlock();
      this.notifyChange(seededBlock);
      return;
    }

    if (this.useInjectedEnvStorage) {
      return;
    }

    const syncUser = remoteUrl ? this.extractUserFromRemoteUrl(remoteUrl) : null;
    this.switchActiveStorage(syncUser ?? undefined);

    this.syncSubscriberCount += 1;

    if (this.syncSubscriberCount > 1 && this.activeSyncRemoteUrl === remoteUrl) {
      return;
    }

    const previousRemoteUrl = this.activeSyncRemoteUrl;
    this.activeSyncRemoteUrl = remoteUrl ?? null;
    try {
      await this.pendingStorageStop;
      const seededBlock = await this.seedAcceptedBlockFromStorage();
      this.notifyChange(
        seededBlock && !this.isCompletedBlock(seededBlock)
          ? seededBlock
          : null
      );
    } catch (error) {
      this.syncSubscriberCount = Math.max(0, this.syncSubscriberCount - 1);
      this.activeSyncRemoteUrl = this.syncSubscriberCount > 0 ? previousRemoteUrl : null;
      throw error;
    }
  }

  async stopSync(): Promise<void> {
    if (this.backendMode === 'rt-sqlite') {
      this.syncSubscriberCount = Math.max(0, this.syncSubscriberCount - 1);
      return;
    }

    if (this.useInjectedEnvStorage) {
      return;
    }

    this.syncSubscriberCount = Math.max(0, this.syncSubscriberCount - 1);
    if (this.syncSubscriberCount > 0) {
      return;
    }

    this.activeSyncRemoteUrl = null;
    await this.pendingStorageStop;
    await this.getActiveStorage().stopSync();
  }

  /** 添加时间块事件（通过 EventStorage，与 ChatPage 保持一致） */
  private async addBlockEvent(
    content: string,
    tag: 'block_start' | 'block_end' | 'block_pause' | 'block_resume',
    createdAt: string,
  ): Promise<void> {
    await appendEventWithEcsReplication({
      id: createUuidV4(),
      content,
      createdAt,
      type: tag,
      metadata: {
        source: getEventSourceMetadata(),
      },
    });
  }

  private shouldWriteFrontendLifecycleEvent(): boolean {
    return this.backendMode !== 'rt-sqlite'
  }

  private notifyChange(block: ActiveBlockData | null): void {
    console.log('[TB-SVC] notifyChange', block ? { startId: block.startId, phase: block.phase, paused: block.paused, feedbackSubmittedAt: block.feedbackSubmittedAt } : 'NULL', new Error().stack?.split('\n').slice(1, 4).join(' <- '));
    this.listeners.forEach(cb => cb(block));
  }

  /**
   * 发布 timeblock.completed 信号到 RT，触发 Reviewer Agent 反馈。
   * Fire-and-forget：失败不影响 endBlock 主流程。
   */
  private async publishTimeblockCompleted(
    block: TimeBlockData,
    feedbackReport: string,
  ): Promise<void> {
    const runtimeTarget = this.resolveRuntimeTarget();
    if (!runtimeTarget) return;

    // 获取当前真相源中的最近事件作为上下文，避免继续读取旧 Pouch 副本。
    const recentEvents = (await getEventLogService().loadEvents())
      .slice(0, 20)
      .map((event) => ({
        text: event.content,
        ts: event.timestamp,
      }));

    const publisher = new SignalStreamService({
      host: {
        id: `runtime-${runtimeTarget.mode}`,
        name: runtimeTarget.mode === 'embedded' ? 'Embedded Runtime（内嵌运行时）' : 'External Runtime（外部运行时）',
        host: runtimeTarget.host,
        port: runtimeTarget.port,
        authToken: runtimeTarget.authToken,
        status: 'online',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isLocal: runtimeTarget.mode === 'embedded' || runtimeTarget.host === '127.0.0.1' || runtimeTarget.host === 'localhost',
      },
      agentId: 'timeblock-service',
    });

    const response = await publisher.publish({
      topic: 'timeblock.completed',
      source: 'frontend:timeblock-service',
      trace_id: `timeblock:${block.id}:${block.endTime}`,
      payload: {
        block: {
          id: block.id,
          name: block.name,
          startTime: block.startTime,
          endTime: block.endTime,
        },
        feedbackReport,
        recentEvents,
      },
    });

    if (!response.accepted) {
      log.warn('[TimeBlockService] RT publish was not accepted');
    }
  }

  private resolveRuntimeTarget(): RuntimeTarget | null {
    try {
      return getSelectedRuntimeTarget();
    } catch {
      return null;
    }
  }

  private attachStorageListener(): void {
    if (this.backendMode !== 'legacy' || this.useInjectedEnvStorage || this.unsubscribeStorageListener || !this.activeBlockStorage) {
      return;
    }

    this.unsubscribeStorageListener = this.getActiveStorage().onBlockChange((block, source) => {
      if (source === 'local') {
        if (block && this.syncSubscriberCount > 0) {
          void this.publishLocalActiveBlockSnapshot(block);
        }
        return;
      }

      if (source !== 'sync') {
        return;
      }

      if (!block) {
        this.notifyChange(null);
        return;
      }

      const normalized = this.normalizeActiveBlock(block);
      const decision = this.decidePreferredBlock(this.lastAcceptedBlock, normalized);
      const preferred = decision.preferred;
      if (!this.isSameBlock(preferred, normalized)) {
        this.rememberAcceptedBlock(preferred);
        this.logRejectedSyncPacket(normalized, preferred, decision);
        void this.persistCanonicalWriteBack(preferred, {
          trigger: 'reject_non_preferred_sync',
          decision,
          incoming: normalized,
        });
        return;
      }

      this.rememberAcceptedBlock(normalized);
      if (this.isCompletedBlock(normalized)) {
        this.notifyChange(null);
        return;
      }
      this.notifyChange(normalized);
    });
  }

  private async publishLocalActiveBlockSnapshot(block: ActiveBlockData): Promise<void> {
    try {
      await publishActiveBlockReplicationSnapshot(block);
    } catch (error) {
      log.warn(`[TB-SVC] publish active-block snapshot failed ${JSON.stringify({ storageUserId: this.activeStorageUserId, remoteUrl: this.activeSyncRemoteUrl, startId: block.startId, phase: block.phase ?? this.resolvePhase(block), version: block.version ?? null, error: error instanceof Error ? error.message : String(error) })}`);
    }
  }

  private async readActiveBlock(): Promise<ActiveBlockData | null> {
    if (this.backendMode === 'rt-sqlite') {
      return await this.rtAdapter?.getActiveBlock() ?? null;
    }

    if (this.useInjectedEnvStorage) {
      return await this.env.storage.read<ActiveBlockData>(ACTIVE_BLOCK_KEY);
    }

    const activeStorage = this.getActiveStorage();
    const fromActiveStorage = await activeStorage.loadActiveBlock();
    if (fromActiveStorage) {
      return fromActiveStorage;
    }

    const legacyData = await this.env.storage.read<ActiveBlockData>(ACTIVE_BLOCK_KEY);
    if (!legacyData) {
      return null;
    }

    await activeStorage.saveActiveBlock(legacyData);
    await this.env.storage.delete(ACTIVE_BLOCK_KEY);
    return legacyData;
  }

  private async saveActiveBlock(block: ActiveBlockData): Promise<void> {
    if (this.backendMode === 'rt-sqlite') {
      await this.rtAdapter?.putActiveBlock(block);
      if (this.syncSubscriberCount > 0) {
        void this.publishLocalActiveBlockSnapshot(block);
      }
      return;
    }

    if (this.useInjectedEnvStorage) {
      await this.env.storage.write(ACTIVE_BLOCK_KEY, block);
      return;
    }

    await this.getActiveStorage().saveActiveBlock(block);
  }

  private async readCompletedBlockData(): Promise<TimeBlockData[]> {
    const normalizeBlocks = (blocks: TimeBlockData[]) => blocks.map((block) => normalizeTimeBlockTaskIds(block));
    if (this.backendMode === 'rt-sqlite') {
      return normalizeBlocks(await this.rtAdapter?.listCompletedBlocks() ?? []);
    }

    return normalizeBlocks(await this.env.storage.read<TimeBlockData[]>(TIME_BLOCKS_KEY) || []);
  }

  private async writeCompletedBlockData(blocks: TimeBlockData[]): Promise<void> {
    if (this.backendMode === 'rt-sqlite') {
      console.log('[TB-SVC] writeCompletedBlockData', { count: blocks.length, payload: JSON.stringify(blocks).slice(0, 1000) });
      await this.rtAdapter?.replaceCompletedBlocks(blocks);
      return;
    }

    await this.env.storage.write(TIME_BLOCKS_KEY, blocks);
  }

  private getActiveStorage(): ActiveBlockStorage {
    if (this.backendMode === 'legacy' && !this.useInjectedEnvStorage && !this.activeBlockStorage) {
      this.switchActiveStorage();
    }

    if (!this.activeBlockStorage) {
      throw new Error('ActiveBlockStorage is not available in legacy mode');
    }
    return this.activeBlockStorage;
  }

  private switchActiveStorage(userId?: string): void {
    if (this.backendMode !== 'legacy' || this.useInjectedEnvStorage) {
      return;
    }

    const nextUserId = userId?.trim() || getCurrentSyncUserId();
    if (
      this.activeBlockStorage &&
      this.activeStorageUserId === nextUserId
    ) {
      return;
    }

    const previousStorage = this.activeBlockStorage;
    const previousUnsubscribe = this.unsubscribeStorageListener;

    this.unsubscribeStorageListener = null;
    if (previousUnsubscribe) {
      previousUnsubscribe();
    }

    this.activeBlockStorage = getActiveBlockStorage(nextUserId);
    this.activeStorageUserId = nextUserId;
    this.lastAcceptedBlock = null;
    this.lastCanonicalWriteBackSignature = null;
    this.attachStorageListener();

    if (previousStorage && previousStorage !== this.activeBlockStorage) {
      this.pendingStorageStop = this.pendingStorageStop
        .then(() => previousStorage.stopSync())
        .catch((error) => {
          log.error(`[TB-SVC] previous storage stopSync failed: ${error instanceof Error ? error.message : String(error)}`);
        });
    }
  }

  private extractUserFromRemoteUrl(remoteUrl: string): string | null {
    try {
      const path = new URL(remoteUrl).pathname;
      const segments = path.split('/').filter(Boolean);
      if (segments.length === 0) {
        return null;
      }
      return decodeURIComponent(segments[segments.length - 1]).trim() || null;
    } catch {
      return null;
    }
  }

  private normalizeActiveBlock(data: ActiveBlockData, now: number = Date.now()): ActiveBlockData {
    const normalizedTaskData = normalizeActiveBlockTaskIds(data);
    const taskAssociationLog = normalizedTaskData.taskAssociationLog ?? [];
    const phase = this.resolvePhase(data);
    const effectiveNow = this.getPhaseEffectiveNow(data, phase, now);
    const accumulatedRunMs = this.resolveAccumulatedRunMs(data);
    const runningStartedAt = phase === 'running'
      ? (data.lastResumedAt ?? this.resolveLegacyRunningStart(data, accumulatedRunMs, effectiveNow))
      : undefined;
    const runningSliceMs = phase === 'running' && runningStartedAt
      ? Math.max(0, effectiveNow - runningStartedAt)
      : 0;
    const runDurationMs = Math.max(0, accumulatedRunMs + runningSliceMs);
    const elapsed = data.mode === 'countdown'
      ? Math.max(0, this.getExpectedDurationMs(data) - runDurationMs)
      : runDurationMs;
    const paused = phase === 'paused';
    const lastTransitionAt = this.resolveLastTransitionAt(data, phase, effectiveNow);

    return {
      ...normalizedTaskData,
      phase,
      version: data.version ?? this.defaultVersionByPhase(phase),
      lastTransitionAt,
      lastResumedAt: phase === 'running' ? (runningStartedAt ?? effectiveNow) : undefined,
      accumulatedRunMs,
      paused,
      pausedAt: paused ? (data.pausedAt ?? lastTransitionAt) : undefined,
      pauseAccumulatedMs: data.pauseAccumulatedMs ?? 0,
      elapsed,
      updatedAt: lastTransitionAt,
      taskIds: normalizedTaskData.taskIds,
      taskAssociationLog,
      taskId: undefined,
    };
  }

  private shouldPersistCanonicalization(prev: ActiveBlockData, next: ActiveBlockData): boolean {
    return prev.phase !== next.phase
      || prev.version !== next.version
      || prev.actorId !== next.actorId
      || prev.lastTransitionAt !== next.lastTransitionAt
      || prev.lastResumedAt !== next.lastResumedAt
      || prev.accumulatedRunMs !== next.accumulatedRunMs
      || prev.paused !== next.paused
      || prev.pausedAt !== next.pausedAt
      || prev.actionEndedAt !== next.actionEndedAt
      || prev.feedbackStartedAt !== next.feedbackStartedAt
      || prev.feedbackSubmittedAt !== next.feedbackSubmittedAt
      || prev.pauseAccumulatedMs !== next.pauseAccumulatedMs
      || JSON.stringify(prev.taskIds ?? []) !== JSON.stringify(next.taskIds ?? [])
      || JSON.stringify(prev.taskAssociationLog ?? []) !== JSON.stringify(next.taskAssociationLog ?? []);
  }

  private getBlockPhase(block: ActiveBlockData): number {
    const phase = this.resolvePhase(block);
    if (phase === 'feedback_submitted') {
      return 2;
    }
    if (phase === 'feedback_in_progress') {
      return 1;
    }
    return 0;
  }

  private isCompletedBlock(block: ActiveBlockData): boolean {
    return block.blockType === 'gap' || Boolean(block.feedbackSubmittedAt);
  }

  private pickPreferredBlock(
    current: ActiveBlockData | null,
    incoming: ActiveBlockData,
  ): ActiveBlockData {
    return this.decidePreferredBlock(current, incoming).preferred;
  }

  private decidePreferredBlock(
    current: ActiveBlockData | null,
    incoming: ActiveBlockData,
  ): BlockPreferenceDecision {
    if (!current) {
      return {
        preferred: incoming,
        reason: 'no_current_baseline',
        compared: 'fallback',
      };
    }

    if (current.startId !== incoming.startId) {
      if (incoming.startTime !== current.startTime) {
        return incoming.startTime > current.startTime
          ? { preferred: incoming, reason: 'incoming_newer_start_time', compared: 'start_time' }
          : { preferred: current, reason: 'current_newer_start_time', compared: 'start_time' };
      }
      const currentOrderTime = this.getBlockOrderTime(current);
      const incomingOrderTime = this.getBlockOrderTime(incoming);
      return incomingOrderTime >= currentOrderTime
        ? { preferred: incoming, reason: 'incoming_newer_transition_different_start', compared: 'transition_time' }
        : { preferred: current, reason: 'current_newer_transition_different_start', compared: 'transition_time' };
    }

    const currentPhase = this.getBlockPhase(current);
    const incomingPhase = this.getBlockPhase(incoming);
    if (incomingPhase !== currentPhase) {
      return incomingPhase > currentPhase
        ? { preferred: incoming, reason: 'incoming_higher_phase', compared: 'phase' }
        : { preferred: current, reason: 'current_higher_phase', compared: 'phase' };
    }

    const currentVersion = current.version ?? 0;
    const incomingVersion = incoming.version ?? 0;
    if (currentVersion !== incomingVersion) {
      return incomingVersion > currentVersion
        ? { preferred: incoming, reason: 'incoming_higher_version', compared: 'version' }
        : { preferred: current, reason: 'current_higher_version', compared: 'version' };
    }

    const currentOrderTime = this.getBlockOrderTime(current);
    const incomingOrderTime = this.getBlockOrderTime(incoming);
    if (incomingOrderTime !== currentOrderTime) {
      return incomingOrderTime > currentOrderTime
        ? { preferred: incoming, reason: 'incoming_newer_transition', compared: 'transition_time' }
        : { preferred: current, reason: 'current_newer_transition', compared: 'transition_time' };
    }

    const currentActor = current.actorId ?? '';
    const incomingActor = incoming.actorId ?? '';
    if (currentActor !== incomingActor) {
      return incomingActor > currentActor
        ? { preferred: incoming, reason: 'incoming_actor_tie_break', compared: 'actor_id' }
        : { preferred: current, reason: 'current_actor_tie_break', compared: 'actor_id' };
    }

    return {
      preferred: incoming,
      reason: 'incoming_fallback',
      compared: 'fallback',
    };
  }

  private getBlockOrderTime(block: ActiveBlockData): number {
    return block.lastTransitionAt
      ?? block.feedbackSubmittedAt
      ?? block.actionEndedAt
      ?? block.pausedAt
      ?? block.lastResumedAt
      ?? block.startTime;
  }

  private isSameBlock(a: ActiveBlockData, b: ActiveBlockData): boolean {
    return a.startId === b.startId
      && a.name === b.name
      && a.mode === b.mode
      && a.targetMinutes === b.targetMinutes
      && a.startTime === b.startTime
      && a.phase === b.phase
      && a.version === b.version
      && a.actorId === b.actorId
      && a.lastTransitionAt === b.lastTransitionAt
      && a.lastResumedAt === b.lastResumedAt
      && a.accumulatedRunMs === b.accumulatedRunMs
      && a.actionEndedAt === b.actionEndedAt
      && a.feedbackStartedAt === b.feedbackStartedAt
      && a.feedbackSubmittedAt === b.feedbackSubmittedAt
      && a.pauseAccumulatedMs === b.pauseAccumulatedMs
      && a.paused === b.paused
      && a.pausedAt === b.pausedAt
      && JSON.stringify(a.taskIds ?? []) === JSON.stringify(b.taskIds ?? [])
      && JSON.stringify(a.taskAssociationLog ?? []) === JSON.stringify(b.taskAssociationLog ?? []);
  }

  private resolvePhase(block: ActiveBlockData): ActiveBlockPhase {
    if (block.feedbackSubmittedAt) {
      return 'feedback_submitted';
    }
    if (block.phase === 'feedback_submitted') {
      return 'feedback_submitted';
    }
    if (block.actionEndedAt || block.phase === 'feedback_in_progress' || block.phase === 'action_ended') {
      return 'feedback_in_progress';
    }
    if (block.phase === 'paused' || block.phase === 'running') {
      return block.phase;
    }
    return block.paused ? 'paused' : 'running';
  }

  private defaultVersionByPhase(phase: ActiveBlockPhase): number {
    if (phase === 'feedback_submitted') {
      return 4;
    }
    if (phase === 'feedback_in_progress' || phase === 'action_ended') {
      return 3;
    }
    if (phase === 'paused') {
      return 2;
    }
    return 1;
  }

  private nextVersion(block: ActiveBlockData): number {
    return (block.version ?? this.defaultVersionByPhase(this.resolvePhase(block))) + 1;
  }

  private resolveLastTransitionAt(
    block: ActiveBlockData,
    phase: ActiveBlockPhase,
    fallback: number,
  ): number {
    if (typeof block.lastTransitionAt === 'number') {
      return block.lastTransitionAt;
    }
    if (phase === 'feedback_submitted' && block.feedbackSubmittedAt) {
      return block.feedbackSubmittedAt;
    }
    if ((phase === 'feedback_in_progress' || phase === 'action_ended') && block.actionEndedAt) {
      return block.actionEndedAt;
    }
    if (phase === 'paused' && block.pausedAt) {
      return block.pausedAt;
    }
    if (phase === 'running' && block.lastResumedAt) {
      return block.lastResumedAt;
    }
    return block.updatedAt ?? block.startTime ?? fallback;
  }

  private getPhaseEffectiveNow(
    block: ActiveBlockData,
    phase: ActiveBlockPhase,
    now: number,
  ): number {
    if (phase === 'feedback_submitted') {
      return block.feedbackSubmittedAt ?? now;
    }
    if (phase === 'feedback_in_progress' || phase === 'action_ended') {
      return block.actionEndedAt ?? now;
    }
    if (phase === 'paused') {
      return block.pausedAt ?? now;
    }
    return now;
  }

  private getExpectedDurationMs(block: Pick<ActiveBlockData, 'mode' | 'targetMinutes'>): number {
    if (block.mode !== 'countdown') {
      return 0;
    }
    return (block.targetMinutes ?? 25) * 60 * 1000;
  }

  private resolveAccumulatedRunMs(block: ActiveBlockData): number {
    if (typeof block.accumulatedRunMs === 'number') {
      return Math.max(0, block.accumulatedRunMs);
    }

    if (block.mode === 'countdown') {
      const expectedDurationMs = this.getExpectedDurationMs(block);
      return Math.max(0, expectedDurationMs - Math.max(0, block.elapsed));
    }
    return Math.max(0, block.elapsed);
  }

  private resolveLegacyRunningStart(block: ActiveBlockData, accumulatedRunMs: number, now: number): number {
    if (typeof block.updatedAt === 'number') {
      return block.updatedAt;
    }

    const elapsedRunMs = block.mode === 'countdown'
      ? Math.max(0, this.getExpectedDurationMs(block) - Math.max(0, block.elapsed))
      : Math.max(0, block.elapsed);
    const runningSliceMs = Math.max(0, elapsedRunMs - accumulatedRunMs);
    return Math.max(block.startTime, now - runningSliceMs);
  }

  private calculateRunDurationMs(block: ActiveBlockData, at: number): number {
    const normalized = this.normalizeActiveBlock(block, at);
    if (normalized.mode === 'countdown') {
      return Math.max(0, this.getExpectedDurationMs(normalized) - Math.max(0, normalized.elapsed));
    }
    return Math.max(0, normalized.elapsed);
  }

  private isFeedbackInProgress(block: ActiveBlockData): boolean {
    return this.resolvePhase(block) === 'feedback_in_progress' && !Boolean(block.feedbackSubmittedAt);
  }

  private async seedAcceptedBlockFromStorage(): Promise<ActiveBlockData | null> {
    if (this.backendMode !== 'legacy' || this.useInjectedEnvStorage) {
      return null;
    }

    const storage = this.getActiveStorage();
    const raw = await storage.loadActiveBlock();
    if (!raw) {
      return null;
    }

    const normalized = this.normalizeActiveBlock(raw);
    if (this.shouldPersistCanonicalization(raw, normalized)) {
      await this.saveActiveBlock(normalized);
    }
    this.rememberAcceptedBlock(normalized);
    return normalized;
  }

  private async persistCanonicalWriteBack(
    block: ActiveBlockData,
    context: {
      trigger: string;
      decision?: BlockPreferenceDecision;
      incoming?: ActiveBlockData;
    } = {
      trigger: 'manual',
    }
  ): Promise<void> {
    const signature = this.getCanonicalWriteBackSignature(block);
    if (signature === this.lastCanonicalWriteBackSignature) {
      return;
    }

    const startedAt = perfNow();
    this.lastCanonicalWriteBackSignature = signature;
    try {
      await this.saveActiveBlock(block);
      log.info(`[TB-SVC] canonical write-back applied ${JSON.stringify({ trigger: context.trigger, reason: context.decision?.reason ?? null, compared: context.decision?.compared ?? null, storageUserId: this.activeStorageUserId, remoteUrl: this.activeSyncRemoteUrl, incomingStartId: context.incoming?.startId ?? null, targetStartId: block.startId, targetPhase: block.phase ?? this.resolvePhase(block), targetVersion: block.version ?? null, elapsedMs: Math.round(perfNow() - startedAt) })}`);
    } catch (error) {
      this.lastCanonicalWriteBackSignature = null;
      log.error(`[TB-SVC] canonical write-back failed ${JSON.stringify({ trigger: context.trigger, reason: context.decision?.reason ?? null, compared: context.decision?.compared ?? null, storageUserId: this.activeStorageUserId, remoteUrl: this.activeSyncRemoteUrl, incomingStartId: context.incoming?.startId ?? null, targetStartId: block.startId, targetPhase: block.phase ?? this.resolvePhase(block), targetVersion: block.version ?? null, elapsedMs: Math.round(perfNow() - startedAt), error: error instanceof Error ? error.message : String(error) })}`);
    }
  }

  private getCanonicalWriteBackSignature(block: ActiveBlockData): string {
    return JSON.stringify({
      context: {
        storageUserId: this.activeStorageUserId,
        remoteUrl: this.activeSyncRemoteUrl,
      },
      block: {
        startId: block.startId,
        name: block.name,
        mode: block.mode,
        targetMinutes: block.targetMinutes,
        startTime: block.startTime,
        phase: block.phase,
        version: block.version,
        actorId: block.actorId,
        lastTransitionAt: block.lastTransitionAt,
        lastResumedAt: block.lastResumedAt,
        accumulatedRunMs: block.accumulatedRunMs,
        actionEndedAt: block.actionEndedAt,
        feedbackStartedAt: block.feedbackStartedAt,
        feedbackSubmittedAt: block.feedbackSubmittedAt,
        pauseAccumulatedMs: block.pauseAccumulatedMs,
        paused: block.paused,
        pausedAt: block.pausedAt,
        taskIds: block.taskIds ?? [],
        taskAssociationLog: block.taskAssociationLog ?? [],
      },
    });
  }

  private logRejectedSyncPacket(
    incoming: ActiveBlockData,
    preferred: ActiveBlockData,
    decision: BlockPreferenceDecision,
  ): void {
    log.warn(`[TB-SVC] rejected non-preferred sync block ${JSON.stringify({ reason: decision.reason, compared: decision.compared, storageUserId: this.activeStorageUserId, remoteUrl: this.activeSyncRemoteUrl, incoming: { startId: incoming.startId, phase: this.resolvePhase(incoming), version: incoming.version ?? null, actorId: incoming.actorId ?? null, transitionTime: this.getBlockOrderTime(incoming) }, preferred: { startId: preferred.startId, phase: this.resolvePhase(preferred), version: preferred.version ?? null, actorId: preferred.actorId ?? null, transitionTime: this.getBlockOrderTime(preferred) } })}`);
  }

  private rememberAcceptedBlock(block: ActiveBlockData): void {
    this.lastAcceptedBlock = this.pickPreferredBlock(this.lastAcceptedBlock, block);
  }

  private formatDuration(ms: number): string {
    const totalSeconds = Math.round(Math.max(0, ms) / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    if (minutes > 0) {
      return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    // 📌【2026-02-13 21:57:18】人写：原先是想用「12s」这样的格式的，但会导致格式不一致
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  private formatClock(ts: number): string {
    return new Date(ts).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  private buildFeedbackReport(input: {
    timeBlockName: string;
    feedbackText: string;
    hasFeedback: boolean;
    feedbackPreferences: FeedbackPreferences;
    feedbackDurationMs: number;
    pausedDurationMs: number;
    workDurationMs: number;
    totalDurationMs: number;
    expectedDurationMs: number | null;
    expectedEndAt: number | null;
    actionStartAt: number;
    actionEndedAt: number;
    submittedAt: number;
    taskStatusOutcomes?: Record<string, string>;
    taskTitles?: Record<string, string>;
  }): string {
    const hasExpectedDuration = input.expectedDurationMs !== null;
    const expectedDurationMs = input.expectedDurationMs ?? 0;
    const expectedEndAt = input.expectedEndAt ?? 0;
    const overtimeMs = hasExpectedDuration
      ? Math.max(0, input.workDurationMs - expectedDurationMs)
      : 0;
    const expectedDiff = !hasExpectedDuration
      ? '无预期（正计时）'
      : input.actionEndedAt < expectedEndAt
        ? `🚀提前${this.formatDuration(expectedEndAt - input.actionEndedAt)}完成`
        : input.actionEndedAt > expectedEndAt && input.workDurationMs < expectedDurationMs
          ? `✨时间块已完成，超出预期结束时间${this.formatDuration(input.actionEndedAt - expectedEndAt)}`
          : input.workDurationMs > expectedDurationMs
            ? `🕒工作超时${this.formatDuration(input.workDurationMs - expectedDurationMs)}`
            : '与预期一致';
    const focusRhythm = input.pausedDurationMs > 0
      ? `有暂停 ${this.formatDuration(input.pausedDurationMs)}`
      : '连续专注';
    const feedbackStatus = input.hasFeedback ? '已填写' : '未填写';

    let result = ''
    let print = (...lines: string[]) => { for (const line of lines) { result += line + '\n' } }
    print(`## ${input.timeBlockName}`, ``);

    if (input.feedbackPreferences.timingInfoEnabled) {
      print(
        `### 时刻信息`,
        ``,
        `- 时间开始于：\`${this.formatClock(input.actionStartAt)}\``,
        `- 预期结束于：\`${input.expectedEndAt === null ? '∞' : this.formatClock(input.expectedEndAt)}\``,
        `- 时间结束于：\`${this.formatClock(input.actionEndedAt)}\``,
        `- 反馈提交于：\`${this.formatClock(input.submittedAt)}\``,
        ``,
      );
    }

    if (input.feedbackPreferences.statisticsEnabled) {
      print(
        `### 统计信息`,
        ``,
        `- 总共时长：**\`${this.formatDuration(input.totalDurationMs)}\`**`,
      );
      if (input.expectedDurationMs === null) {
        print(`- 预期时长：**\`∞\`**`)
      } else {
        print(`- 预期时长：**\`${this.formatDuration(input.expectedDurationMs)}\`**`)
      }
      if (input.workDurationMs > 0) print(`- 实际工作：**\`${this.formatDuration(input.workDurationMs)}\`**`)
      if (input.pausedDurationMs > 0) print(`- 暂停时长：**\`${this.formatDuration(input.pausedDurationMs)}\`**`)
      if (input.feedbackDurationMs > 0) print(`- 反馈用时：**\`${this.formatDuration(input.feedbackDurationMs)}\`**`)
      if (hasExpectedDuration && overtimeMs > 0) print(`- 超时投入：**\`${this.formatDuration(overtimeMs)}\`**`)
      print(``);
    }

    if (input.feedbackPreferences.quickFeedbackEnabled) {
      print(
        `### 快速反馈`,
        ``,
        `- 预期差异：**\`${expectedDiff}\`**`,
        `- 专注节奏：**\`${focusRhythm}\`**`,
        `- 反馈状态：**\`${feedbackStatus}\`**`,
      );
    }

    if (input.hasFeedback) {
      print(
        ``,
        `---`,
        ``,
        `${input.feedbackText}`,
      );
    }

    if (input.taskStatusOutcomes && Object.keys(input.taskStatusOutcomes).length > 0) {
      const statusLabels: Record<string, string> = {
        continue: '将继续',
        suspended: '已挂起',
        completed: '已完成',
        cancelled: '已取消',
      };
      print(``, `### 任务状态`);
      for (const [taskId, status] of Object.entries(input.taskStatusOutcomes)) {
        const title = input.taskTitles?.[taskId] ?? taskId;
        const label = statusLabels[status] ?? status;
        print(`- ${title}：${label}`);
      }
    }

    return result.trimEnd()
  }
}

// 单例导出
let timeBlockServiceInstance: TimeBlockService | null = null;

export function getTimeBlockService(): TimeBlockService {
  if (!timeBlockServiceInstance) {
    timeBlockServiceInstance = new TimeBlockServiceImpl();
  }
  return timeBlockServiceInstance;
}
