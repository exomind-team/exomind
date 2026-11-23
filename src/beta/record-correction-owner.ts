import { BetaApiError } from './api-error';
import { sha256 } from '@noble/hashes/sha2.js';
import { validateReceipt, type BetaClient, type BetaEvent, type BetaReceipt } from './client';
import { betaUuid } from './initialization';
import {
  IndexedDbLocalIntentJournal,
  openDurableIntentStorage,
  type DurableIntentStorage,
  type LocalIntentJournal,
} from './local-intent-journal';
import { productionIntentStorage } from './native-intent-journal';
import { betaCorrectionTextIssue, type BetaRecordCorrectionCommand } from './record-organization-client';

/** Engineering budget: at most 32 retained commands and 2 MiB of serialized JSON.
 * A full journal refuses another command; it never drops an unresolved entry. */
export const MAX_PENDING_CORRECTIONS = 32;
export const MAX_CORRECTION_JOURNAL_BYTES = 2 * 1024 * 1024;

const JOURNAL_PREFIX = 'exomind:beta:record-corrections';
const MAX_DEVICE_ID_CHARS = 256;
const MAX_SERVICE_SCOPE_CHARS = 512;
const SHA256 = /^[a-f0-9]{64}$/;

type PersistedCorrectionEntry =
  | { status: 'pending'; command: BetaRecordCorrectionCommand }
  | { status: 'accepted'; command: BetaRecordCorrectionCommand; receipt: BetaReceipt };

export type BetaCorrectionRecoveryStatus = 'saving' | 'save_failed' | 'pending' | 'sending' | 'accepted';

export interface BetaCorrectionRecoveryEntry {
  readonly command: Readonly<BetaRecordCorrectionCommand>;
  readonly status: BetaCorrectionRecoveryStatus;
  readonly receipt?: BetaReceipt;
  readonly message?: string;
}

export interface BetaCorrectionOwnerSnapshot {
  readonly entries: readonly BetaCorrectionRecoveryEntry[];
  readonly error?: string;
}

export interface BetaRecordCorrectionOwnerOptions {
  deviceId: string;
  /** Stable endpoint identity only. Never include an owner token or grant. */
  serviceScope: string;
  journal?: LocalIntentJournal;
  uuid?: () => string;
  clock?: () => number;
}

interface PersistedEnvelope {
  version: 1;
  device_id: string;
  service_scope: string;
  entries: PersistedCorrectionEntry[];
}

interface CandidateCorrection {
  command: BetaRecordCorrectionCommand;
  status: 'saving' | 'save_failed';
  message?: string;
}

interface TransientCorrection {
  command: BetaRecordCorrectionCommand;
  status: 'pending' | 'sending' | 'accepted';
  receipt?: BetaReceipt;
  message?: string;
}

type EntryMutation = (entries: PersistedCorrectionEntry[]) => PersistedCorrectionEntry[] | null;

const targetKey = (profileId: string, eventId: string) => `${profileId}\u0000${eventId}`;
const commandKey = (commandId: string) => commandId;

function journalKey(deviceId: string, serviceScope: string): string {
  const scopeDigest = Array.from(sha256(new TextEncoder().encode(serviceScope)), byte => byte.toString(16).padStart(2, '0')).join('');
  return `${JOURNAL_PREFIX}:${encodeURIComponent(deviceId)}:${scopeDigest}`;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BetaApiError('intent_cache_corrupt', '本机更正恢复记录无法识别，已停止发送');
  }
  return value as Record<string, unknown>;
}

function parseCommand(value: unknown): BetaRecordCorrectionCommand {
  const raw = object(value);
  const required = ['command_id', 'event_id', 'profile_id', 'occurred_at_ms', 'target_event_id', 'target_digest', 'corrected_text'];
  if (Object.keys(raw).some(key => !required.includes(key)) || required.some(key => !(key in raw))
    || typeof raw.command_id !== 'string' || !raw.command_id
    || typeof raw.event_id !== 'string' || !raw.event_id
    || typeof raw.profile_id !== 'string' || !raw.profile_id
    || !Number.isSafeInteger(raw.occurred_at_ms) || Number(raw.occurred_at_ms) < 0
    || typeof raw.target_event_id !== 'string' || !raw.target_event_id
    || raw.event_id === raw.target_event_id
    || typeof raw.target_digest !== 'string' || !SHA256.test(raw.target_digest)
    || typeof raw.corrected_text !== 'string' || betaCorrectionTextIssue(raw.corrected_text)) {
    throw new BetaApiError('intent_cache_corrupt', '本机更正恢复记录的命令无效，已停止发送');
  }
  return Object.freeze({
    command_id: raw.command_id,
    event_id: raw.event_id,
    profile_id: raw.profile_id,
    occurred_at_ms: Number(raw.occurred_at_ms),
    target_event_id: raw.target_event_id,
    target_digest: raw.target_digest,
    corrected_text: raw.corrected_text,
  });
}

function sameCommand(left: BetaRecordCorrectionCommand, right: BetaRecordCorrectionCommand): boolean {
  return left.command_id === right.command_id && left.event_id === right.event_id
    && left.profile_id === right.profile_id && left.occurred_at_ms === right.occurred_at_ms
    && left.target_event_id === right.target_event_id && left.target_digest === right.target_digest
    && left.corrected_text === right.corrected_text;
}

function parseEnvelope(raw: string | null, scope: { deviceId: string; serviceScope: string }): PersistedEnvelope {
  if (raw === null) return { version: 1, device_id: scope.deviceId, service_scope: scope.serviceScope, entries: [] };
  if (new TextEncoder().encode(raw).byteLength > MAX_CORRECTION_JOURNAL_BYTES) {
    throw new BetaApiError('intent_cache_corrupt', '本机更正恢复记录超过安全容量，已保留原值并停止写入');
  }
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { throw new BetaApiError('intent_cache_corrupt', '本机更正恢复记录无法解析，已保留原值并停止写入'); }
  const envelope = object(value);
  const fields = ['version', 'device_id', 'service_scope', 'entries'];
  if (Object.keys(envelope).some(key => !fields.includes(key)) || fields.some(key => !(key in envelope))
    || envelope.version !== 1 || envelope.device_id !== scope.deviceId || envelope.service_scope !== scope.serviceScope
    || !Array.isArray(envelope.entries) || envelope.entries.length > MAX_PENDING_CORRECTIONS) {
    throw new BetaApiError('intent_cache_corrupt', '本机更正恢复记录作用域或容量不匹配，已停止写入');
  }

  const commandIds = new Set<string>();
  const pendingTargets = new Set<string>();
  const entries = envelope.entries.map((rawEntry): PersistedCorrectionEntry => {
    const entry = object(rawEntry);
    const command = parseCommand(entry.command);
    if (commandIds.has(command.command_id)) {
      throw new BetaApiError('intent_cache_corrupt', '本机更正恢复记录包含重复命令，已停止写入');
    }
    commandIds.add(command.command_id);
    if (entry.status === 'pending' && Object.keys(entry).length === 2) {
      const key = targetKey(command.profile_id, command.target_event_id);
      if (pendingTargets.has(key)) throw new BetaApiError('intent_cache_corrupt', '本机更正恢复记录包含同目标的多个未决命令');
      pendingTargets.add(key);
      return { status: 'pending', command };
    }
    if (entry.status === 'accepted' && Object.keys(entry).length === 3) {
      return { status: 'accepted', command, receipt: validateReceipt(entry.receipt, command) };
    }
    throw new BetaApiError('intent_cache_corrupt', '本机更正恢复记录状态无效，已停止写入');
  });
  return { version: 1, device_id: scope.deviceId, service_scope: scope.serviceScope, entries };
}

function receiptFor(command: BetaRecordCorrectionCommand, value: unknown): BetaReceipt {
  return validateReceipt(value, command);
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '本机更正恢复记录暂时不可用';
}

function isJournalConflict(error: unknown): boolean {
  return error instanceof BetaApiError && error.code === 'intent_cache_conflict';
}

function isDefinitiveRejection(error: unknown): boolean {
  if (!(error instanceof BetaApiError)) return false;
  if (error.code === 'correction_target_conflict' || error.code === 'correction_requires_human'
    || error.code === 'invalid_request' || error.code === 'invalid_correction') return true;
  return error.status !== undefined && error.status >= 400 && error.status < 500
    && ![408, 425, 429].includes(error.status);
}

function emptySnapshot(): BetaCorrectionOwnerSnapshot {
  return { entries: [] };
}

/** Device/service scoped owner for immutable correction commands. The dialog
 * only observes this owner; closing or switching profile does not cancel writes. */
export class BetaRecordCorrectionOwner {
  private readonly key: string;
  private readonly listeners = new Set<() => void>();
  private readonly candidates = new Map<string, CandidateCorrection>();
  private readonly transient = new Map<string, TransientCorrection>();
  private readonly targetFlights = new Map<string, Promise<BetaCorrectionRecoveryEntry>>();
  private storage: DurableIntentStorage;
  private persisted: PersistedCorrectionEntry[];
  private snapshotValue: BetaCorrectionOwnerSnapshot = emptySnapshot();
  private observerError: string | undefined;
  private unsubscribeStorage: (() => void) | undefined;
  private externalRevision = 0;
  private mutationTail: Promise<void> = Promise.resolve();
  private activeOperations = 0;
  private closed = false;
  private storageClosed = false;

  private constructor(
    private readonly deviceId: string,
    private readonly serviceScope: string,
    private readonly journal: LocalIntentJournal,
    private readonly ownsJournal: boolean,
    private readonly uuid: () => string,
    private readonly clock: () => number,
    storage: DurableIntentStorage,
  ) {
    this.key = journalKey(deviceId, serviceScope);
    this.storage = storage;
    this.persisted = parseEnvelope(storage.getItem(this.key), { deviceId, serviceScope }).entries;
    this.attachStorage();
    this.emit();
  }

  static async open(options: BetaRecordCorrectionOwnerOptions): Promise<BetaRecordCorrectionOwner> {
    if (!options.deviceId || options.deviceId.length > MAX_DEVICE_ID_CHARS
      || !options.serviceScope || options.serviceScope.length > MAX_SERVICE_SCOPE_CHARS) {
      throw new BetaApiError('intent_scope_invalid', '更正恢复作用域无法识别，已停止发送');
    }
    const production = productionIntentStorage();
    const journal = options.journal ?? production.journal ?? new IndexedDbLocalIntentJournal();
    const ownsJournal = !options.journal && !production.journal;
    const key = journalKey(options.deviceId, options.serviceScope);
    const validate = (raw: string) => { parseEnvelope(raw, { deviceId: options.deviceId, serviceScope: options.serviceScope }); };
    let storage: DurableIntentStorage;
    try {
      storage = await openDurableIntentStorage({ key, journal, validate });
    } catch (error) {
      if (ownsJournal) journal.close?.();
      throw error;
    }
    const owner = new BetaRecordCorrectionOwner(
      options.deviceId,
      options.serviceScope,
      journal,
      ownsJournal,
      options.uuid ?? betaUuid,
      options.clock ?? Date.now,
      storage,
    );
    await owner.cleanupRestoredAcceptedEntries();
    return owner;
  }

  snapshot = (): BetaCorrectionOwnerSnapshot => this.snapshotValue;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private attachStorage(): void {
    if (this.closed) return;
    this.externalRevision = this.storage.snapshot().externalRevision ?? 0;
    this.unsubscribeStorage = this.storage.subscribe(() => {
      if (this.closed) return;
      const status = this.storage.snapshot();
      const revision = status.externalRevision ?? 0;
      if (status.state !== 'idle' || revision === this.externalRevision) return;
      this.externalRevision = revision;
      try {
        this.persisted = parseEnvelope(this.storage.getItem(this.key), { deviceId: this.deviceId, serviceScope: this.serviceScope }).entries;
        this.observerError = undefined;
        this.emit();
      } catch (error) {
        this.observerError = errorText(error);
        this.emit();
      }
    });
  }

  private emit(): void {
    const entries = new Map<string, BetaCorrectionRecoveryEntry>();
    for (const item of this.persisted) {
      const transient = this.transient.get(commandKey(item.command.command_id));
      entries.set(item.command.command_id, transient ? this.toSnapshotEntry(transient) : this.toSnapshotEntry(item));
    }
    for (const candidate of this.candidates.values()) {
      entries.set(candidate.command.command_id, this.toSnapshotEntry(candidate));
    }
    for (const [id, item] of this.transient) {
      if (!entries.has(id)) entries.set(id, this.toSnapshotEntry(item));
    }
    this.snapshotValue = {
      entries: [...entries.values()],
      ...(this.observerError ? { error: this.observerError } : {}),
    };
    for (const listener of this.listeners) {
      try { listener(); } catch { /* Subscribers are observers, never journal owners. */ }
    }
  }

  private toSnapshotEntry(entry: PersistedCorrectionEntry | CandidateCorrection | TransientCorrection): BetaCorrectionRecoveryEntry {
    if (entry.status === 'accepted') {
      return {
        command: entry.command,
        status: 'accepted',
        receipt: entry.receipt,
        ...('message' in entry && entry.message ? { message: entry.message } : {}),
      };
    }
    return {
      command: entry.command,
      status: entry.status,
      ...('receipt' in entry && entry.receipt ? { receipt: entry.receipt } : {}),
      ...('message' in entry && entry.message ? { message: entry.message } : {}),
    };
  }

  private currentEntries(): PersistedCorrectionEntry[] {
    return parseEnvelope(this.storage.getItem(this.key), { deviceId: this.deviceId, serviceScope: this.serviceScope }).entries;
  }

  private envelopeRaw(entries: PersistedCorrectionEntry[]): string {
    if (entries.length > MAX_PENDING_CORRECTIONS) {
      throw new BetaApiError('correction_recovery_capacity', '本机未决更正已达容量上限；现有命令均已保留，未发送本次更正');
    }
    const raw = JSON.stringify({
      version: 1,
      device_id: this.deviceId,
      service_scope: this.serviceScope,
      entries,
    } satisfies PersistedEnvelope);
    if (new TextEncoder().encode(raw).byteLength > MAX_CORRECTION_JOURNAL_BYTES) {
      throw new BetaApiError('correction_recovery_capacity', '本机更正恢复记录已达 2 MiB 容量上限；现有命令均已保留，未发送本次更正');
    }
    return raw;
  }

  private writeEntries(entries: PersistedCorrectionEntry[]): Promise<void> {
    this.storage.setItem(this.key, this.envelopeRaw(entries));
    return this.storage.commit();
  }

  private mutateEntries(update: EntryMutation): Promise<void> {
    const operation = this.mutationTail.then(() => this.mutateEntriesSerial(update));
    this.mutationTail = operation.catch(() => {});
    return operation;
  }

  private async mutateEntriesSerial(update: EntryMutation): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = this.currentEntries();
      const next = update(current);
      if (next === null) {
        this.persisted = current;
        this.emit();
        return;
      }
      try {
        await this.writeEntries(next);
        this.persisted = next;
        this.observerError = undefined;
        this.emit();
        return;
      } catch (error) {
        await this.reopenStorage();
        const latest = this.currentEntries();
        this.persisted = latest;
        if (update(latest) === null) {
          this.emit();
          return;
        }
        if (!isJournalConflict(error) || attempt === 2) throw error;
      }
    }
  }

  private async reopenStorage(): Promise<void> {
    this.unsubscribeStorage?.();
    this.unsubscribeStorage = undefined;
    this.storage.close();
    this.storage = await openDurableIntentStorage({
      key: this.key,
      journal: this.journal,
      validate: raw => { parseEnvelope(raw, { deviceId: this.deviceId, serviceScope: this.serviceScope }); },
    });
    this.persisted = this.currentEntries();
    this.observerError = undefined;
    this.attachStorage();
    this.emit();
  }

  private createCommand(target: Pick<BetaEvent, 'event_id' | 'profile_id' | 'digest'>, correctedText: string): BetaRecordCorrectionCommand {
    if (!target.event_id || !target.profile_id || !SHA256.test(target.digest)) {
      throw new BetaApiError('invalid_correction', '原始记录没有可验证的摘要，不能提交更正');
    }
    const textIssue = betaCorrectionTextIssue(correctedText);
    if (textIssue === 'empty') throw new BetaApiError('invalid_correction', '请先写下非空更正内容');
    if (textIssue === 'invalid_unicode') throw new BetaApiError('invalid_correction', '更正内容包含无法传输的 Unicode 字符，请重新输入该字符');
    if (textIssue === 'too_large') throw new BetaApiError('invalid_correction', '更正内容超过 128 KiB UTF-8 字节上限，请删减后再保存');
    const commandId = this.uuid();
    const eventId = this.uuid();
    const occurredAt = this.clock();
    if (!commandId || !eventId || commandId === eventId || eventId === target.event_id
      || !Number.isSafeInteger(occurredAt) || occurredAt < 0) {
      throw new BetaApiError('invalid_correction', '无法生成有效的更正命令身份');
    }
    return Object.freeze({
      command_id: commandId,
      event_id: eventId,
      profile_id: target.profile_id,
      occurred_at_ms: occurredAt,
      target_event_id: target.event_id,
      target_digest: target.digest,
      corrected_text: correctedText,
    });
  }

  private pendingForTarget(profileId: string, targetEventId: string): PersistedCorrectionEntry | undefined {
    return this.persisted.find(entry => entry.status === 'pending'
      && entry.command.profile_id === profileId && entry.command.target_event_id === targetEventId);
  }

  private acceptedForTarget(profileId: string, targetEventId: string): Extract<PersistedCorrectionEntry, { status: 'accepted' }> | undefined {
    return [...this.persisted].reverse().find((entry): entry is Extract<PersistedCorrectionEntry, { status: 'accepted' }> =>
      entry.status === 'accepted' && entry.command.profile_id === profileId && entry.command.target_event_id === targetEventId);
  }

  private runTarget(
    profileId: string,
    targetEventId: string,
    action: () => Promise<BetaCorrectionRecoveryEntry>,
  ): Promise<BetaCorrectionRecoveryEntry> {
    const key = targetKey(profileId, targetEventId);
    const active = this.targetFlights.get(key);
    if (active) return active;
    const flight = this.track(action);
    this.targetFlights.set(key, flight);
    void flight.finally(() => {
      if (this.targetFlights.get(key) === flight) this.targetFlights.delete(key);
    }).catch(() => {});
    return flight;
  }

  private async track<T>(action: () => Promise<T>): Promise<T> {
    if (this.closed) throw new BetaApiError('inactive_session', '更正恢复窗口已关闭；已发出的命令仍保留');
    this.activeOperations += 1;
    try { return await action(); }
    finally {
      this.activeOperations -= 1;
      this.closeStorageIfIdle();
    }
  }

  async submit(
    client: BetaClient,
    target: Pick<BetaEvent, 'event_id' | 'profile_id' | 'digest'>,
    correctedText: string,
  ): Promise<BetaCorrectionRecoveryEntry> {
    return this.runTarget(target.profile_id, target.event_id, async () => {
      if (this.pendingForTarget(target.profile_id, target.event_id)) {
        throw new BetaApiError('correction_pending_conflict', '此记录已有一条待查证更正；请先查证并重试原命令');
      }
      const key = targetKey(target.profile_id, target.event_id);
      let candidate = this.candidates.get(key);
      if (candidate && candidate.command.corrected_text !== correctedText) {
        throw new BetaApiError('correction_unsubmitted_changed', '本机暂存失败的更正仍保留原文；请重试本机暂存或显式取消后重新编辑');
      }
      if (!candidate) candidate = { command: this.createCommand(target, correctedText), status: 'saving' };
      this.candidates.set(key, { ...candidate, status: 'saving', message: undefined });
      this.emit();
      try {
        await this.persistPending(candidate.command);
        this.candidates.delete(key);
        this.emit();
      } catch (error) {
        const failedCandidate: CandidateCorrection = { ...candidate, status: 'save_failed', message: errorText(error) };
        this.candidates.set(key, failedCandidate);
        this.emit();
        if (error instanceof BetaApiError && error.code === 'correction_pending_conflict') throw error;
        return this.toSnapshotEntry(failedCandidate);
      }
      return this.reconcile(client, candidate.command);
    });
  }

  async retry(client: BetaClient, profileId: string, targetEventId: string): Promise<BetaCorrectionRecoveryEntry> {
    return this.runTarget(profileId, targetEventId, async () => {
      const pending = this.pendingForTarget(profileId, targetEventId);
      if (pending) return this.reconcile(client, pending.command);
      const key = targetKey(profileId, targetEventId);
      const candidate = this.candidates.get(key);
      if (candidate) {
        this.candidates.set(key, { ...candidate, status: 'saving', message: undefined });
        this.emit();
        try {
          await this.persistPending(candidate.command);
          this.candidates.delete(key);
          this.emit();
        } catch (error) {
          const failedCandidate: CandidateCorrection = { ...candidate, status: 'save_failed', message: errorText(error) };
          this.candidates.set(key, failedCandidate);
          this.emit();
          if (error instanceof BetaApiError && error.code === 'correction_pending_conflict') throw error;
          return this.toSnapshotEntry(failedCandidate);
        }
        return this.reconcile(client, candidate.command);
      }
      const accepted = this.acceptedForTarget(profileId, targetEventId);
      if (accepted) {
        await this.cleanupAccepted(accepted.command, accepted.receipt);
        return { command: accepted.command, status: 'accepted', receipt: accepted.receipt };
      }
      throw new BetaApiError('correction_not_pending', '没有可恢复的本机更正命令');
    });
  }

  async cancelUnsubmitted(profileId: string, targetEventId: string): Promise<boolean> {
    const key = targetKey(profileId, targetEventId);
    return this.track(async () => {
      const candidate = this.candidates.get(key);
      if (!candidate || candidate.status !== 'save_failed') return false;
      try {
        // The empty or current envelope write fences a delayed acknowledgement
        // from turning an explicitly cancelled, never-sent candidate pending.
        await this.mutateEntries(entries => entries.filter(entry => entry.command.command_id !== candidate.command.command_id));
      } catch (error) {
        this.candidates.set(key, { ...candidate, message: `取消尚未确认：${errorText(error)}` });
        this.emit();
        return false;
      }
      this.candidates.delete(key);
      this.emit();
      return true;
    });
  }

  async retryCleanup(profileId: string, targetEventId: string): Promise<void> {
    await this.track(async () => {
      const accepted = this.snapshotValue.entries.filter(entry => entry.status === 'accepted'
        && entry.command.profile_id === profileId && entry.command.target_event_id === targetEventId);
      for (const entry of accepted) {
        if (entry.receipt) await this.cleanupAccepted({ ...entry.command }, entry.receipt);
      }
    });
  }

  /** Reopen the journal after an observer error without sending a correction. */
  async retryRecovery(): Promise<void> {
    await this.track(async () => {
      try {
        await this.reopenStorage();
      } catch (error) {
        this.observerError = errorText(error);
        this.emit();
        throw error;
      }
    });
  }

  private async persistPending(command: BetaRecordCorrectionCommand): Promise<void> {
    await this.mutateEntries(entries => {
      const byId = entries.find(entry => entry.command.command_id === command.command_id);
      if (byId) {
        if (!sameCommand(byId.command, command)) throw new BetaApiError('correction_command_conflict', '同一命令身份已对应其他内容，已保留本机记录');
        return null;
      }
      const pending = entries.find(entry => entry.status === 'pending'
        && entry.command.profile_id === command.profile_id && entry.command.target_event_id === command.target_event_id);
      if (pending) throw new BetaApiError('correction_pending_conflict', '另一界面已为此记录保存待查证更正；未覆盖原命令');
      return [...entries, { status: 'pending', command }];
    });
  }

  private async reconcile(client: BetaClient, command: BetaRecordCorrectionCommand): Promise<BetaCorrectionRecoveryEntry> {
    let receipt: BetaReceipt | null;
    this.transient.set(command.command_id, {
      command,
      status: 'pending',
      message: '本机命令已持久保存；正在查找服务回执，尚未确认本次请求是否已发送。',
    });
    this.emit();
    try {
      receipt = await client.receipt(command.profile_id, command.command_id);
      if (receipt) receipt = receiptFor(command, receipt);
    } catch (error) {
      return this.keepPending(command, `更正已暂存，回执尚待查证：${errorText(error)}`);
    }
    if (receipt) return this.accept(command, receipt);
    if (!client.recordOrganization) {
      return this.keepPending(command, '更正已暂存；当前服务暂不支持重试，原命令仍保留。');
    }
    this.transient.set(command.command_id, {
      command,
      status: 'sending',
      message: '本机命令已持久保存；正在发送更正请求，尚未收到服务回执。',
    });
    this.emit();
    try {
      const result = receiptFor(command, await client.recordOrganization.recordCorrection({ ...command }));
      return this.accept(command, result);
    } catch (error) {
      if (isDefinitiveRejection(error)) {
        this.transient.delete(command.command_id);
        try { await this.removeCommand(command); }
        catch (cleanupError) {
          this.transient.set(command.command_id, {
            command, status: 'pending', message: `服务已明确拒绝更正；本机恢复记录清理失败：${errorText(cleanupError)}`,
          });
          this.emit();
        }
        throw error;
      }
      return this.keepPending(command, `提交结果尚未确认；重试会先查回执，并复用同一命令：${errorText(error)}`);
    }
  }

  private keepPending(command: BetaRecordCorrectionCommand, message: string): BetaCorrectionRecoveryEntry {
    this.transient.set(command.command_id, { command, status: 'pending', message });
    this.emit();
    return this.toSnapshotEntry(this.transient.get(command.command_id)!);
  }

  private async accept(command: BetaRecordCorrectionCommand, receipt: BetaReceipt): Promise<BetaCorrectionRecoveryEntry> {
    const accepted: BetaCorrectionRecoveryEntry = { command, status: 'accepted', receipt };
    this.transient.set(command.command_id, {
      command, status: 'accepted', receipt,
      message: '更正已记录，正在清理本机恢复记录。',
    });
    this.emit();
    try {
      await this.markAccepted(command, receipt);
      await this.removeCommand(command);
      this.transient.delete(command.command_id);
      this.emit();
    } catch (error) {
      this.transient.set(command.command_id, {
        command, status: 'accepted', receipt,
        message: `更正已被服务接受；本机恢复记录清理未完成：${errorText(error)}。可重试清理。`,
      });
      this.emit();
    }
    return accepted;
  }

  private async markAccepted(command: BetaRecordCorrectionCommand, receipt: BetaReceipt): Promise<void> {
    await this.mutateEntries(entries => {
      const index = entries.findIndex(entry => entry.command.command_id === command.command_id);
      if (index < 0) return null;
      const previous = entries[index];
      if (!sameCommand(previous.command, command)) throw new BetaApiError('correction_command_conflict', '服务回执不匹配本机命令，已保留恢复记录');
      if (previous.status === 'accepted' && previous.receipt.event_digest === receipt.event_digest
        && previous.receipt.local_seq === receipt.local_seq) return null;
      const next = entries.slice();
      next[index] = { status: 'accepted', command, receipt };
      return next;
    });
  }

  private async removeCommand(command: BetaRecordCorrectionCommand): Promise<void> {
    await this.mutateEntries(entries => {
      const existing = entries.find(entry => entry.command.command_id === command.command_id);
      if (!existing) return null;
      if (!sameCommand(existing.command, command)) throw new BetaApiError('correction_command_conflict', '本机恢复记录已改变，未清理其他命令');
      return entries.filter(entry => entry.command.command_id !== command.command_id);
    });
  }

  private async cleanupAccepted(command: BetaRecordCorrectionCommand, receipt: BetaReceipt): Promise<void> {
    try {
      await this.markAccepted(command, receipt);
      await this.removeCommand(command);
      this.transient.delete(command.command_id);
      this.emit();
    } catch (error) {
      this.transient.set(command.command_id, {
        command, status: 'accepted', receipt,
        message: `更正已被服务接受；本机恢复记录清理未完成：${errorText(error)}。可重试清理。`,
      });
      this.emit();
    }
  }

  private async cleanupRestoredAcceptedEntries(): Promise<void> {
    const entries = this.persisted.filter((entry): entry is Extract<PersistedCorrectionEntry, { status: 'accepted' }> =>
      entry.status === 'accepted');
    for (const entry of entries) await this.cleanupAccepted(entry.command, entry.receipt);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribeStorage?.();
    this.unsubscribeStorage = undefined;
    this.listeners.clear();
    this.closeStorageIfIdle();
  }

  private closeStorageIfIdle(): void {
    if (!this.closed || this.activeOperations || this.storageClosed) return;
    this.storageClosed = true;
    this.storage.close();
    if (this.ownsJournal) this.journal.close?.();
  }
}
