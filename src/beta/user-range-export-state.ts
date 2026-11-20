import { useEffect, useState } from 'react';
import { betaUuid } from './initialization';
import {
  IndexedDbLocalIntentJournal,
  openDurableIntentStorage,
  type DurableIntentStorage,
  type LocalIntentJournal,
} from './local-intent-journal';
import {
  UserRangeExportError,
  type UserRangeExportClient,
  type UserRangeExportRequest,
  type UserRangeExportResult,
  type UserRangeExportStatus,
  type UserRangeSelection,
} from './user-range-export-client';

export const USER_RANGE_EXPORT_MAX_SELECTIONS = 512;
export const USER_RANGE_EXPORT_INTENT_BUDGET_BYTES = 64 * 1024;
const MAX_JOURNAL_KEY_BYTES = 256;
const OBSERVE_INTERVAL_MS = 1000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/i;
const ACTIVE_PHASES: UserRangeExportStatus['phase'][] = [
  'preparing', 'awaiting_destination', 'writing', 'verifying', 'cancelling', 'publishing',
];

export interface UserRangeExportIntent {
  version: 1;
  request_id: string;
  profile_id: string;
  selections: UserRangeSelection[];
  device_id: string;
  runtime_id: string;
}

export interface UserRangeExportTask extends UserRangeExportIntent {
  phase: UserRangeExportStatus['phase'] | 'unknown';
  result: UserRangeExportResult | null;
  message: string | null;
  cancelAccepted: boolean | null;
}

export interface UserRangeExportSnapshot {
  ready: boolean;
  supported: boolean;
  storageReady: boolean;
  profile_id: string;
  selections: UserRangeSelection[];
  task: UserRangeExportTask | null;
  error: string | null;
}

export interface UserRangeExportStateOptions {
  deviceId: string;
  runtimeId: string;
  profileId: string;
  uuid?: () => string;
  /** Test seam only. Production deliberately uses IndexedDB, not NativeIntentJournal. */
  journal?: LocalIntentJournal;
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value) && !/^0{8}-0{4}-0{4}-0{4}-0{12}$/i.test(value);
}

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid object');
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some(key => !keys.includes(key))) throw new Error('unexpected fields');
  return raw;
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function selectionKey(selection: UserRangeSelection): string {
  return selection.kind === 'event' ? `event:${selection.event_id}` : `timeblock:${selection.block_id}`;
}

function validateSelection(value: unknown): UserRangeSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid selection');
  const raw = value as Record<string, unknown>;
  if (raw.kind === 'event') {
    const item = object(value, ['kind', 'event_id']);
    if (!isUuid(item.event_id)) throw new Error('invalid event id');
    return { kind: 'event', event_id: item.event_id.toLowerCase() };
  }
  if (raw.kind === 'timeblock') {
    const item = object(value, ['kind', 'block_id']);
    if (!isUuid(item.block_id)) throw new Error('invalid timeblock id');
    return { kind: 'timeblock', block_id: item.block_id.toLowerCase() };
  }
  throw new Error('invalid selection kind');
}

function validateSelections(value: unknown): UserRangeSelection[] {
  if (!Array.isArray(value) || value.length > USER_RANGE_EXPORT_MAX_SELECTIONS) throw new Error('invalid selection count');
  const selections = value.map(validateSelection);
  if (new Set(selections.map(selectionKey)).size !== selections.length) throw new Error('duplicate selection');
  return selections;
}

function validateIntent(value: unknown): UserRangeExportIntent {
  const raw = object(value, ['version', 'request_id', 'profile_id', 'selections', 'device_id', 'runtime_id']);
  if (raw.version !== 1 || !isUuid(raw.request_id) || !isUuid(raw.profile_id) || !isUuid(raw.device_id)
    || typeof raw.runtime_id !== 'string' || raw.runtime_id.length === 0 || raw.runtime_id.length > 128) {
    throw new Error('invalid export intent scope');
  }
  const selections = validateSelections(raw.selections);
  if (selections.length === 0) throw new Error('empty export intent');
  return {
    version: 1,
    request_id: raw.request_id.toLowerCase(),
    profile_id: raw.profile_id.toLowerCase(),
    selections,
    device_id: raw.device_id.toLowerCase(),
    runtime_id: raw.runtime_id,
  };
}

function validateIntentRaw(raw: string): void {
  if (utf8Length(raw) > USER_RANGE_EXPORT_INTENT_BUDGET_BYTES) throw new Error('intent exceeds 64 KiB');
  validateIntent(JSON.parse(raw));
}

function validateSelectionSnapshot(value: unknown, profileId: string): UserRangeSelection[] {
  const raw = object(value, ['version', 'profile_id', 'selections']);
  if (raw.version !== 1 || raw.profile_id !== profileId) throw new Error('selection scope mismatch');
  return validateSelections(raw.selections);
}

function validateSelectionRaw(raw: string, profileId: string): void {
  if (utf8Length(raw) > USER_RANGE_EXPORT_INTENT_BUDGET_BYTES) throw new Error('selection snapshot exceeds 64 KiB');
  validateSelectionSnapshot(JSON.parse(raw), profileId);
}

function encodeIntent(intent: UserRangeExportIntent): string {
  const raw = JSON.stringify(intent);
  if (utf8Length(raw) > USER_RANGE_EXPORT_INTENT_BUDGET_BYTES) {
    throw new Error('本次选择超过 64 KiB 本机待查预算；尚未发起导出');
  }
  return raw;
}

function validSavedResult(result: UserRangeExportResult): boolean {
  return result.phase !== 'saved'
    || (Number.isSafeInteger(result.archive_byte_length) && Number(result.archive_byte_length) > 0
      && typeof result.archive_sha256 === 'string' && SHA256.test(result.archive_sha256));
}

function initialSnapshot(profileId: string): UserRangeExportSnapshot {
  return { ready: false, supported: false, storageReady: false, profile_id: profileId, selections: [], task: null, error: null };
}

function safeStorageMessage(error: unknown): string {
  if (error instanceof Error && error.name === 'BetaApiError') return error.message;
  if (error instanceof Error && error.message.includes('64 KiB')) return error.message;
  return '本机导出待查记录暂不可用；尚未发起新的导出。';
}

function safeExportMessage(error: unknown): string {
  return error instanceof UserRangeExportError
    ? error.message
    : '导出回应未确认；正在按原 request ID 查证，请不要重复提交。';
}

function isActive(task: UserRangeExportTask | null): boolean {
  return !!task && ACTIVE_PHASES.includes(task.phase as UserRangeExportStatus['phase']);
}

function sameTask(task: UserRangeExportTask | null, intent: UserRangeExportIntent): boolean {
  return !!task && task.request_id === intent.request_id && task.profile_id === intent.profile_id
    && task.device_id === intent.device_id && task.runtime_id === intent.runtime_id;
}

function taskFromIntent(intent: UserRangeExportIntent, phase: UserRangeExportTask['phase'], message: string | null = null): UserRangeExportTask {
  return { ...intent, selections: intent.selections.map(selection => ({ ...selection })), phase, result: null, message, cancelAccepted: null };
}

function taskFromResult(intent: UserRangeExportIntent, result: UserRangeExportResult): UserRangeExportTask {
  return {
    ...taskFromIntent(intent, result.phase),
    phase: result.phase,
    result,
    message: result.phase === 'saved' ? '导出文件已由 Native 保存。'
      : result.failure_code ? `Native 结束于 ${result.phase}（${result.failure_code}）。`
        : `Native 结束于 ${result.phase}。`,
  };
}

// Journal keys follow the persistent Host identity; runtime_id remains provenance on each intent.
export function userRangeExportIntentKey(deviceId: string): string {
  return boundedKey(`exomind:beta:user-range-export:intent:${JSON.stringify([deviceId])}`);
}

export function userRangeExportSelectionKey(deviceId: string, profileId: string): string {
  return boundedKey(`exomind:beta:user-range-export:selection:${JSON.stringify([deviceId, profileId])}`);
}

function boundedKey(key: string): string {
  if (utf8Length(key) > MAX_JOURNAL_KEY_BYTES) throw new Error('本机导出缓存 key 超过 256 字节');
  return key;
}

/**
 * Persistent device-scoped intent and profile-scoped choices, observed by the current runtime.
 * Production uses the existing strict IndexedDB journal with an isolated key:
 * NativeIntentJournal's Host allowlist intentionally rejects arbitrary keys.
 */
export class UserRangeExportStateController {
  private state: UserRangeExportSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly journal: LocalIntentJournal;
  private readonly ownsJournal: boolean;
  private readonly uuid: () => string;
  private intentStorage: DurableIntentStorage | undefined;
  private selectionStorage: DurableIntentStorage | undefined;
  private readyFlight: Promise<void> | undefined;
  private selectionGeneration = 0;
  private selectionQueue: Promise<void> = Promise.resolve();
  private statusFlight: Promise<void> | undefined;
  private observationTimer: ReturnType<typeof setTimeout> | undefined;
  private observing = false;
  private disposed = false;

  constructor(private readonly client: UserRangeExportClient, private readonly options: UserRangeExportStateOptions) {
    this.state = initialSnapshot(options.profileId);
    this.uuid = options.uuid ?? betaUuid;
    this.journal = options.journal ?? new IndexedDbLocalIntentJournal();
    this.ownsJournal = options.journal === undefined;
  }

  snapshot = (): UserRangeExportSnapshot => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit(patch: Partial<UserRangeExportSnapshot>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) {
      try { listener(); } catch { /* A UI subscriber cannot interrupt Native reconciliation. */ }
    }
  }

  ready(): Promise<void> {
    if (!this.readyFlight) this.readyFlight = this.hydrate();
    return this.readyFlight;
  }

  private async hydrate(): Promise<void> {
    let capabilityConfirmed = false;
    try {
      const capability = await this.client.capabilities();
      if (this.disposed) return;
      capabilityConfirmed = capability.schema === 1 && capability.supported === true;
      if (!capabilityConfirmed) {
        this.emit({ ready: true, supported: false, storageReady: false, error: null });
        return;
      }

      const intentKey = userRangeExportIntentKey(this.options.deviceId);
      const selectionKey = userRangeExportSelectionKey(this.options.deviceId, this.state.profile_id);
      const intentStorage = await openDurableIntentStorage({
        key: intentKey,
        journal: this.journal,
        validate: validateIntentRaw,
      });
      this.intentStorage = intentStorage;
      if (this.disposed) { intentStorage.close(); this.intentStorage = undefined; return; }
      const selectionStorage = await openDurableIntentStorage({
        key: selectionKey,
        journal: this.journal,
        validate: raw => validateSelectionRaw(raw, this.state.profile_id),
      });
      this.selectionStorage = selectionStorage;
      if (this.disposed) { intentStorage.close(); selectionStorage.close(); this.intentStorage = undefined; this.selectionStorage = undefined; return; }
      const selections = this.readSelections(selectionStorage, this.state.profile_id);
      const rawIntent = intentStorage.getItem(intentKey);
      let task: UserRangeExportTask | null = null;
      if (rawIntent !== null) {
        const intent = validateIntent(JSON.parse(rawIntent));
        // runtime_id records the originating process generation; this Host may query it after restart.
        if (intent.device_id !== this.options.deviceId) {
          throw new Error('export intent scope mismatch');
        }
        task = taskFromIntent(intent, 'unknown', '正在按原 request ID 恢复 Native 状态…');
      }
      this.emit({ ready: true, supported: true, storageReady: true, selections, task, error: null });
      if (task) await this.refreshStatus();
    } catch (error) {
      this.intentStorage?.close(); this.intentStorage = undefined;
      this.selectionStorage?.close(); this.selectionStorage = undefined;
      this.emit({
        ready: true,
        supported: capabilityConfirmed,
        storageReady: false,
        error: safeStorageMessage(error),
      });
    }
  }

  private readSelections(storage: DurableIntentStorage, profileId: string): UserRangeSelection[] {
    const raw = storage.getItem(userRangeExportSelectionKey(this.options.deviceId, profileId));
    return raw === null ? [] : validateSelectionSnapshot(JSON.parse(raw), profileId);
  }

  private queueSelectionChange(change: () => Promise<void>): Promise<void> {
    const next = this.selectionQueue.then(change, change);
    this.selectionQueue = next.catch(() => {});
    return next;
  }

  private async persistSelections(
    storage: DurableIntentStorage,
    profileId: string,
    selections: UserRangeSelection[],
  ): Promise<void> {
    const key = userRangeExportSelectionKey(this.options.deviceId, profileId);
    const raw = JSON.stringify({ version: 1, profile_id: profileId, selections });
    validateSelectionRaw(raw, profileId);
    storage.setItem(key, raw);
    await storage.commit();
  }

  async switchProfile(profileId: string): Promise<void> {
    await this.ready();
    if (!this.state.storageReady || !this.state.supported || !isUuid(profileId) || profileId === this.state.profile_id) return;
    const generation = ++this.selectionGeneration;
    this.emit({ profile_id: profileId.toLowerCase(), selections: [], error: null, storageReady: false });
    let nextStorage: DurableIntentStorage | undefined;
    try {
      nextStorage = await openDurableIntentStorage({
        key: userRangeExportSelectionKey(this.options.deviceId, profileId),
        journal: this.journal,
        validate: raw => validateSelectionRaw(raw, profileId),
      });
      if (this.disposed || generation !== this.selectionGeneration) { nextStorage.close(); return; }
      const selections = this.readSelections(nextStorage, profileId);
      this.selectionStorage?.close();
      this.selectionStorage = nextStorage;
      this.emit({ profile_id: profileId.toLowerCase(), selections, storageReady: true, error: null });
    } catch (error) {
      nextStorage?.close();
      if (!this.disposed && generation === this.selectionGeneration) {
        this.emit({ storageReady: false, error: safeStorageMessage(error) });
      }
    }
  }

  toggleSelection(value: UserRangeSelection): Promise<void> {
    const generation = this.selectionGeneration;
    return this.queueSelectionChange(async () => {
      if (this.disposed || generation !== this.selectionGeneration || !this.state.storageReady || !this.selectionStorage) return;
      let selection: UserRangeSelection;
      try { selection = validateSelection(value); }
      catch { this.emit({ error: '选取身份无效，当前清单未改变。' }); return; }
      const key = selectionKey(selection);
      const existing = this.state.selections.some(item => selectionKey(item) === key);
      if (!existing && this.state.selections.length >= USER_RANGE_EXPORT_MAX_SELECTIONS) {
        this.emit({ error: '最多选择 512 项；当前清单已保留。' });
        return;
      }
      const selections = existing
        ? this.state.selections.filter(item => selectionKey(item) !== key)
        : [...this.state.selections.map(item => ({ ...item })), selection];
      await this.saveSelections(generation, selections);
    });
  }

  removeSelection(value: UserRangeSelection): Promise<void> {
    const key = selectionKey(validateSelection(value));
    return this.queueSelectionChange(async () => {
      if (this.disposed || !this.state.storageReady || !this.selectionStorage) return;
      const generation = this.selectionGeneration;
      const selections = this.state.selections.filter(item => selectionKey(item) !== key);
      await this.saveSelections(generation, selections);
    });
  }

  resetSelections(): Promise<void> {
    return this.queueSelectionChange(async () => {
      if (this.disposed || !this.state.storageReady || !this.selectionStorage) return;
      await this.saveSelections(this.selectionGeneration, []);
    });
  }

  clearSelections(): Promise<void> { return this.resetSelections(); }

  private async saveSelections(generation: number, selections: UserRangeSelection[]): Promise<void> {
    const storage = this.selectionStorage;
    const profileId = this.state.profile_id;
    if (!storage) return;
    try {
      await this.persistSelections(storage, profileId, selections);
      if (this.disposed || generation !== this.selectionGeneration || storage !== this.selectionStorage) return;
      this.emit({ selections, error: null });
    } catch (error) {
      if (!this.disposed && generation === this.selectionGeneration) this.emit({ error: safeStorageMessage(error) });
    }
  }

  startExport(): Promise<void> { return this.submit(false); }

  confirmNewRequestAfterUnknown(): Promise<void> { return this.submit(true); }

  private async submit(confirmedUnknown: boolean): Promise<void> {
    await this.ready();
    if (this.disposed || !this.state.supported || !this.state.storageReady || !this.intentStorage) return;
    const previousTask = this.state.task;
    if (confirmedUnknown) {
      if (previousTask?.phase !== 'unknown') return;
    } else if (previousTask && (previousTask.phase === 'unknown' || isActive(previousTask))) {
      this.emit({ error: '仍有一个 Native 导出结果待查；先查证它，不能自动重发。' });
      return;
    }
    if (this.state.selections.length === 0) {
      this.emit({ error: '先从消息更多操作中选入记录或时间块。' });
      return;
    }

    let requestId: string;
    try { requestId = this.uuid(); if (!isUuid(requestId)) throw new Error('invalid request id'); }
    catch { this.emit({ error: '无法生成本次导出 request ID；尚未发起。' }); return; }
    const selections = this.state.selections.map(selection => ({ ...selection }));
    const request: UserRangeExportRequest = {
      request_id: requestId.toLowerCase(),
      profile_id: this.state.profile_id,
      selections,
    };
    const intent = validateIntent({
      version: 1,
      request_id: request.request_id,
      profile_id: request.profile_id,
      selections,
      device_id: this.options.deviceId,
      runtime_id: this.options.runtimeId,
    });
    let raw: string;
    try { raw = encodeIntent(intent); }
    catch (error) { this.emit({ error: safeStorageMessage(error) }); return; }

    const key = userRangeExportIntentKey(this.options.deviceId);
    try {
      this.intentStorage.setItem(key, raw);
      await this.intentStorage.commit();
    } catch (error) {
      this.emit({ error: safeStorageMessage(error) });
      return;
    }
    if (this.disposed) return;

    this.emit({ task: taskFromIntent(intent, 'preparing'), error: null });
    try {
      const result = await this.client.exportRange(request);
      if (this.disposed || !sameTask(this.state.task, intent)) return;
      if (result.request_id !== intent.request_id || result.profile_id !== intent.profile_id || !validSavedResult(result)) {
        this.emit({ task: taskFromIntent(intent, 'unknown', 'Native 终态回执无效；保存结果尚未确认。') });
        return;
      }
      this.emit({ task: taskFromResult(intent, result), error: null });
    } catch (error) {
      if (this.disposed || !sameTask(this.state.task, intent)) return;
      this.emit({ task: taskFromIntent(intent, 'unknown', safeExportMessage(error)) });
      await this.refreshStatus();
    }
  }

  async refreshStatus(): Promise<void> {
    if (this.statusFlight) return this.statusFlight;
    const task = this.state.task;
    if (!task || this.disposed) return;
    const intent: UserRangeExportIntent = {
      version: 1, request_id: task.request_id, profile_id: task.profile_id,
      selections: task.selections.map(selection => ({ ...selection })),
      device_id: task.device_id, runtime_id: task.runtime_id,
    };
    const flight = this.readStatus(intent);
    this.statusFlight = flight;
    try { await flight; }
    finally { if (this.statusFlight === flight) this.statusFlight = undefined; }
  }

  private async readStatus(intent: UserRangeExportIntent): Promise<void> {
    try {
      const status = await this.client.status(intent.profile_id, intent.request_id);
      if (this.disposed || !sameTask(this.state.task, intent)) return;
      if (status === null) {
        const previous = this.state.task;
        this.emit({ task: {
          ...taskFromIntent(intent, 'unknown', 'Native 尚无此 request ID 的状态；请核对任务和目的文件后再决定。'),
          cancelAccepted: previous?.cancelAccepted ?? null,
        } });
        return;
      }
      if (status.request_id !== intent.request_id || status.profile_id !== intent.profile_id) {
        this.emit({ task: taskFromIntent(intent, 'unknown', 'Native 状态与原 request ID 不一致；结果尚未确认。') });
        return;
      }
      if (status.result !== null) {
        if (status.result.request_id !== intent.request_id || status.result.profile_id !== intent.profile_id
          || status.result.phase !== status.phase || !validSavedResult(status.result)) {
          this.emit({ task: taskFromIntent(intent, 'unknown', 'Native 终态回执无效；保存结果尚未确认。') });
          return;
        }
        this.emit({ task: taskFromResult(intent, status.result), error: null });
        return;
      }
      const previous = this.state.task;
      this.emit({ task: {
        ...taskFromIntent(intent, status.phase, previous?.cancelAccepted === true
          ? '取消请求已受理；正在等待 Native 终态。'
          : `Native 正在处理：${status.phase}。`),
        cancelAccepted: previous?.cancelAccepted ?? null,
      } });
    } catch (error) {
      if (this.disposed || !sameTask(this.state.task, intent)) return;
      const previous = this.state.task;
      this.emit({ task: {
        ...taskFromIntent(intent, 'unknown', safeExportMessage(error)),
        cancelAccepted: previous?.cancelAccepted ?? null,
      } });
    }
  }

  async requestCancel(): Promise<void> {
    const task = this.state.task;
    if (!task || !isActive(task) || this.disposed) return;
    const intent: UserRangeExportIntent = {
      version: 1, request_id: task.request_id, profile_id: task.profile_id,
      selections: task.selections.map(selection => ({ ...selection })),
      device_id: task.device_id, runtime_id: task.runtime_id,
    };
    try {
      const response = await this.client.cancel(intent.request_id);
      if (this.disposed || !sameTask(this.state.task, intent)) return;
      if (response.request_id !== intent.request_id) throw new Error('cancel request id mismatch');
      this.emit({ task: {
        ...this.state.task!,
        phase: response.accepted ? 'cancelling' : this.state.task!.phase,
        cancelAccepted: response.accepted,
        message: response.accepted
          ? '取消请求已受理；仍在等待 Native 终态。'
          : 'Native 未受理取消；正在查证原任务状态。',
      } });
    } catch (error) {
      if (this.disposed || !sameTask(this.state.task, intent)) return;
      this.emit({ task: { ...this.state.task!, message: safeExportMessage(error), cancelAccepted: null } });
    }
    await this.refreshStatus();
  }

  startObserving(): void {
    if (this.disposed || this.observing) return;
    this.observing = true;
    this.scheduleObservation(0);
  }

  stopObserving(): void {
    this.observing = false;
    clearTimeout(this.observationTimer);
    this.observationTimer = undefined;
  }

  private scheduleObservation(delay: number): void {
    clearTimeout(this.observationTimer);
    if (!this.observing || !this.state.task || this.disposed) return;
    if (this.state.task.phase !== 'unknown' && !isActive(this.state.task)) return;
    this.observationTimer = setTimeout(() => {
      this.observationTimer = undefined;
      void this.refreshStatus().finally(() => this.scheduleObservation(OBSERVE_INTERVAL_MS));
    }, delay);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopObserving();
    ++this.selectionGeneration;
    this.listeners.clear();
    this.intentStorage?.close(); this.intentStorage = undefined;
    this.selectionStorage?.close(); this.selectionStorage = undefined;
    if (this.ownsJournal) this.journal.close?.();
  }
}

const EMPTY_SELECTIONS: UserRangeSelection[] = [];

export function useUserRangeExportState(
  client: UserRangeExportClient | undefined,
  scope: { deviceId: string; runtimeId: string; profileId: string },
  visible: boolean,
): { owner: UserRangeExportStateController | null; state: UserRangeExportSnapshot } {
  const [owner, setOwner] = useState<UserRangeExportStateController | null>(null);
  const [state, setState] = useState<UserRangeExportSnapshot>(() => initialSnapshot(scope.profileId));

  useEffect(() => {
    let mounted = true;
    let opened: UserRangeExportStateController | undefined;
    setOwner(null);
    setState(initialSnapshot(scope.profileId));
    if (!client || !isUuid(scope.deviceId) || !scope.runtimeId || !isUuid(scope.profileId)) return () => { mounted = false; };
    opened = new UserRangeExportStateController(client, scope);
    void opened.ready().then(() => {
      if (!mounted) { opened?.dispose(); return; }
      setOwner(opened);
      setState(opened.snapshot());
    });
    return () => {
      mounted = false;
      opened?.dispose();
    };
  }, [client, scope.deviceId, scope.runtimeId, scope.profileId]);

  useEffect(() => {
    if (!owner) return;
    const unsubscribe = owner.subscribe(() => setState(owner.snapshot()));
    if (visible) owner.startObserving();
    else owner.stopObserving();
    return () => {
      unsubscribe();
      owner.stopObserving();
    };
  }, [owner, visible]);

  return { owner, state: owner ? state : { ...initialSnapshot(scope.profileId), selections: EMPTY_SELECTIONS } };
}