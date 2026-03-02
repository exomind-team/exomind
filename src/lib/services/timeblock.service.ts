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
import { getEventStorage } from '../storage/event-storage';
import {
  getActiveBlockStorage,
  getCurrentSyncUserId,
  type ActiveBlockStorage,
} from '../storage/active-block-storage';
import type {
  TimeBlock,
  TimeBlockData,
  ActiveBlockData,
  ActiveBlockPhase,
  TimerConfig,
} from '../types/event';
import { getFeedbackPreferences, type FeedbackPreferences } from '../../config/feedback-preferences';
import { createUuidV4 } from '../utils/uuid';

// 存储键
const TIME_BLOCKS_KEY = 'time_blocks';
const ACTIVE_BLOCK_KEY = 'active_block';

function perfNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export interface TimeBlockService {
  /** 加载已完成的时间块 */
  loadTimeBlocks(): Promise<TimeBlock[]>;

  /** 加载当前进行中的时间块 */
  loadActiveBlock(): Promise<ActiveBlockData | null>;

  /** 开始时间块 */
  startBlock(name: string, config: TimerConfig, description?: string): Promise<ActiveBlockData>;

  /** 标记“行动结束/开始填写反馈”（点击结束时刻） */
  markEnding(): Promise<void>;

  /** 暂停时间块 */
  pauseBlock(): Promise<void>;

  /** 继续时间块 */
  resumeBlock(): Promise<void>;

  /** 结束时间块 */
  endBlock(feedback?: string): Promise<TimeBlock | null>;

  /** 更新已计时时长（由 UI 定时调用） */
  updateElapsed(elapsed: number): Promise<void>;

  /** 监听时间块变化 */
  onBlockChange(callback: (block: ActiveBlockData | null) => void): () => void;

  /** 启动进行中时间块同步 */
  startSync(remoteUrl: string): Promise<void>;

  /** 停止进行中时间块同步 */
  stopSync(): Promise<void>;
}

export class TimeBlockServiceImpl implements TimeBlockService {
  private env: ExoMindEnvironment;
  private activeBlockStorage: ActiveBlockStorage | null = null;
  private activeStorageUserId: string | null = null;
  private useLegacyEnvStorage: boolean;
  private listeners: Set<(block: ActiveBlockData | null) => void> = new Set();
  private syncSubscriberCount = 0;
  private activeSyncRemoteUrl: string | null = null;
  private unsubscribeStorageListener: (() => void) | null = null;
  private lastAcceptedBlock: ActiveBlockData | null = null;
  private readonly actorId = createUuidV4();

  constructor(env?: ExoMindEnvironment) {
    this.env = env || ExoMindEnvironment.getInstance();
    this.useLegacyEnvStorage = typeof env !== 'undefined';
    if (!this.useLegacyEnvStorage) {
      this.switchActiveStorage();
    }
    this.attachStorageListener();
  }

  async loadTimeBlocks(): Promise<TimeBlock[]> {
    const data = await this.env.storage.read<TimeBlockData[]>(TIME_BLOCKS_KEY);
    if (!data) return [];

    return data.map(d => ({
      ...d,
      tags: new Set(d.tags),
    }));
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

  async startBlock(name: string, config: TimerConfig, description?: string): Promise<ActiveBlockData> {
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
    }
    const startId = createUuidV4();
    const now = Date.now();
    const initialElapsed = config.mode === 'countdown'
      ? (config.minutes ?? 25) * 60 * 1000
      : 0;

    // 创建开始事件
    const normalizedDescription = description?.trim();
    const eventContent = normalizedDescription ? `${name}\n${normalizedDescription}` : name;
    await this.addBlockEvent(eventContent, 'block_start', new Date(now).toISOString());

    // 保存进行中的时间块
    const activeBlock: ActiveBlockData = {
      startId,
      name,
      startTime: now,
      elapsed: initialElapsed,
      mode: config.mode,
      targetMinutes: config.mode === 'countdown' ? (config.minutes ?? 25) : undefined,
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
    await this.addBlockEvent(`${normalized.name} 暂停`, 'block_pause', new Date(now).toISOString());
    const eventMs = Math.round(perfNow() - eventStart);
    this.notifyChange(pausedBlock);
    console.log('[TB-SVC] pauseBlock done', {
      startId: pausedBlock.startId,
      saveMs,
      eventMs,
      totalMs: Math.round(perfNow() - opStart),
    });
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
    await this.addBlockEvent(`${normalized.name} 继续`, 'block_resume', new Date(now).toISOString());
    const eventMs = Math.round(perfNow() - eventStart);
    this.notifyChange(resumedBlock);
    console.log('[TB-SVC] resumeBlock done', {
      startId: resumedBlock.startId,
      saveMs,
      eventMs,
      totalMs: Math.round(perfNow() - opStart),
    });
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

    const actionEndedAt = normalized.actionEndedAt ?? now;
    const feedbackStartedAt = normalized.feedbackStartedAt ?? actionEndedAt;
    const pauseAccumulatedMs = (normalized.pauseAccumulatedMs ?? 0) + (
      normalized.paused && normalized.pausedAt
        ? Math.max(0, actionEndedAt - normalized.pausedAt)
        : 0
    );

    // 创建结束事件（通过 EventStorage，与 ChatPage 保持一致）
    const eventStart = perfNow();
    await this.addBlockEvent(`${normalized.name} 完成`, 'block_end', new Date(actionEndedAt).toISOString());
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
    console.log('[TB-SVC] markEnding done', {
      startId: endedBlock.startId,
      saveMs,
      eventMs,
      totalMs: Math.round(perfNow() - opStart),
    });
  }

  async endBlock(feedback?: string): Promise<TimeBlock | null> {
    const opStart = perfNow();
    const rawActiveData = await this.readActiveBlock();
    if (!rawActiveData) return null;
    const activeData = this.normalizeActiveBlock(rawActiveData);
    if (this.isCompletedBlock(activeData)) {
      this.rememberAcceptedBlock(activeData);
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
    });

    const storage = getEventStorage();
    const feedbackEventStart = perfNow();
    await storage.addEvent({
      id: createUuidV4(),
      content: report,
      createdAt: new Date(submittedAt).toISOString(),
      type: 'block_feedback',
      metadata: {
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
    };

    // 追加到已完成列表
    const completedWriteStart = perfNow();
    const completed = await this.env.storage.read<TimeBlockData[]>(TIME_BLOCKS_KEY) || [];
    completed.push(timeBlock);
    await this.env.storage.write(TIME_BLOCKS_KEY, completed);
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

    // 通知变化
    this.notifyChange(null);
    console.log('[TB-SVC] endBlock done', {
      startId: terminalBlock.startId,
      feedbackEventMs,
      completedWriteMs,
      saveTerminalMs,
      totalMs: Math.round(perfNow() - opStart),
    });

    return {
      ...timeBlock,
      tags: new Set(timeBlock.tags),
    };
  }

  async updateElapsed(_elapsed: number): Promise<void> {
    // 高频 elapsed 仅用于本地 UI 展示，不再写入同步存储。
    return;
  }

  onBlockChange(callback: (block: ActiveBlockData | null) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  async startSync(remoteUrl: string): Promise<void> {
    if (this.useLegacyEnvStorage) {
      return;
    }

    const syncUser = this.extractUserFromRemoteUrl(remoteUrl);
    this.switchActiveStorage(syncUser ?? undefined);

    this.syncSubscriberCount += 1;

    if (this.syncSubscriberCount > 1 && this.activeSyncRemoteUrl === remoteUrl) {
      return;
    }

    this.activeSyncRemoteUrl = remoteUrl;
    await this.getActiveStorage().syncToRemote(remoteUrl);
  }

  async stopSync(): Promise<void> {
    if (this.useLegacyEnvStorage) {
      return;
    }

    this.syncSubscriberCount = Math.max(0, this.syncSubscriberCount - 1);
    if (this.syncSubscriberCount > 0) {
      return;
    }

    this.activeSyncRemoteUrl = null;
    await this.getActiveStorage().stopSync();
  }

  /** 添加时间块事件（通过 EventStorage，与 ChatPage 保持一致） */
  private async addBlockEvent(
    content: string,
    tag: 'block_start' | 'block_end' | 'block_pause' | 'block_resume',
    createdAt: string,
  ): Promise<void> {
    const storage = getEventStorage();
    await storage.addEvent({
      id: createUuidV4(),
      content,
      createdAt,
      type: tag,
    });
  }

  private notifyChange(block: ActiveBlockData | null): void {
    this.listeners.forEach(cb => cb(block));
  }

  private attachStorageListener(): void {
    if (this.useLegacyEnvStorage || this.unsubscribeStorageListener || !this.activeBlockStorage) {
      return;
    }

    this.unsubscribeStorageListener = this.getActiveStorage().onBlockChange((block, source) => {
      if (source !== 'sync') {
        return;
      }

      if (!block) {
        this.notifyChange(null);
        return;
      }

      const normalized = this.normalizeActiveBlock(block);
      const preferred = this.pickPreferredBlock(this.lastAcceptedBlock, normalized);
      if (!this.isSameBlock(preferred, normalized)) {
        if (this.lastAcceptedBlock && this.lastAcceptedBlock.startId === normalized.startId) {
          void this.saveActiveBlock(this.lastAcceptedBlock);
        }
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

  private async readActiveBlock(): Promise<ActiveBlockData | null> {
    if (this.useLegacyEnvStorage) {
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
    if (this.useLegacyEnvStorage) {
      await this.env.storage.write(ACTIVE_BLOCK_KEY, block);
      return;
    }

    await this.getActiveStorage().saveActiveBlock(block);
  }

  private getActiveStorage(): ActiveBlockStorage {
    if (!this.useLegacyEnvStorage && !this.activeBlockStorage) {
      this.switchActiveStorage();
    }

    if (!this.activeBlockStorage) {
      throw new Error('ActiveBlockStorage is not available in legacy mode');
    }
    return this.activeBlockStorage;
  }

  private switchActiveStorage(userId?: string): void {
    if (this.useLegacyEnvStorage) {
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
    this.attachStorageListener();

    if (previousStorage && previousStorage !== this.activeBlockStorage) {
      void previousStorage.stopSync();
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
      ...data,
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
      || prev.pauseAccumulatedMs !== next.pauseAccumulatedMs;
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
    return Boolean(block.feedbackSubmittedAt);
  }

  private pickPreferredBlock(
    current: ActiveBlockData | null,
    incoming: ActiveBlockData,
  ): ActiveBlockData {
    if (!current) {
      return incoming;
    }

    if (current.startId !== incoming.startId) {
      if (incoming.startTime !== current.startTime) {
        return incoming.startTime > current.startTime ? incoming : current;
      }
      return this.getBlockOrderTime(incoming) >= this.getBlockOrderTime(current) ? incoming : current;
    }

    const currentPhase = this.getBlockPhase(current);
    const incomingPhase = this.getBlockPhase(incoming);
    if (incomingPhase !== currentPhase) {
      return incomingPhase > currentPhase ? incoming : current;
    }

    const currentVersion = current.version ?? 0;
    const incomingVersion = incoming.version ?? 0;
    if (currentVersion !== incomingVersion) {
      return incomingVersion > currentVersion ? incoming : current;
    }

    const currentActor = current.actorId ?? '';
    const incomingActor = incoming.actorId ?? '';
    if (currentActor !== incomingActor) {
      return incomingActor > currentActor ? incoming : current;
    }

    return this.getBlockOrderTime(incoming) >= this.getBlockOrderTime(current) ? incoming : current;
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
      && a.pausedAt === b.pausedAt;
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
