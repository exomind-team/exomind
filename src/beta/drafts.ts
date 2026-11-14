import { BetaApiError, validateReceipt, type BetaClient, type BetaCommand, type BetaReceipt } from './client';
import { betaUuid } from './initialization';
import { hashFileSource, readFileSource, sourceKey, type FileSource, type FileSourceStore } from './file-source-store';
import { productionFileSources } from './native-source-store';
import { ORIGINAL_CHUNK_BYTES, type BetaOriginal, type BetaStage } from './original-types';
import { openDurableIntentStorage, type DurableIntentStorage, type LocalIntentJournal, type IntentPredecessor } from './local-intent-journal';
import { productionIntentStorage } from './native-intent-journal';

export interface DraftFile {
  id: string; stage_id: string; source_key: string;
  file_name: string; byte_length: number; media_type: string;
  original?: BetaOriginal;
  state: 'preparing' | 'uploading' | 'verified' | 'failed' | 'source_missing';
  next_offset: number; message?: string;
}
interface Draft { text: string; revision: number; files?: DraftFile[] }
export interface PendingCapture {
  command: BetaCommand; draft_revision: number;
  state: 'pending' | 'unknown' | 'failed' | 'committed';
  message?: string; error_code?: string; receipt?: BetaReceipt;
  files?: DraftFile[]; capture_attempted?: boolean;
}
interface Confirmation { receipt: BetaReceipt; draft_revision: number }
interface PersistedState { version: 1; drafts: Record<string, Draft>; pending: PendingCapture[]; confirmed: Confirmation[] }
export interface DraftSnapshot extends PersistedState { persistenceError: string | null; persistenceState: 'idle' | 'pending' | 'failed' }
type DraftStorage = Pick<Storage, 'getItem' | 'setItem'>;
function durable(storage: DraftStorage): storage is DurableIntentStorage {
  const candidate = storage as Partial<DurableIntentStorage>;
  return candidate.durable === true && typeof candidate.commit === 'function' && typeof candidate.snapshot === 'function' && typeof candidate.subscribe === 'function';
}

export function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return typeof error === 'string' ? error : '服务暂时不可用，请查证后重试';
}
function errorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'unavailable';
}
function validOriginal(item: BetaOriginal): boolean {
  return !!item && typeof item.original_id === 'string' && typeof item.sha256 === 'string' && /^[a-f0-9]{64}$/.test(item.sha256)
    && Number.isSafeInteger(item.byte_length) && item.byte_length >= 0 && typeof item.file_name === 'string' && typeof item.media_type === 'string';
}
function sameOriginal(left: BetaOriginal, right: BetaOriginal): boolean {
  return left.original_id === right.original_id && left.sha256 === right.sha256 && left.byte_length === right.byte_length
    && left.file_name === right.file_name && left.media_type === right.media_type;
}
function validateFile(file: DraftFile, profileId: string, deviceId: string): void {
  if (!file || typeof file.id !== 'string' || typeof file.stage_id !== 'string' || file.source_key !== sourceKey(deviceId, profileId, file.id)
    || typeof file.file_name !== 'string' || !Number.isSafeInteger(file.byte_length) || file.byte_length < 0 || typeof file.media_type !== 'string'
    || !['preparing','uploading','verified','failed','source_missing'].includes(file.state)
    || !Number.isSafeInteger(file.next_offset) || file.next_offset < 0 || file.next_offset > file.byte_length
    || (file.original && (!validOriginal(file.original) || file.original.original_id !== file.id || file.original.byte_length !== file.byte_length
      || file.original.file_name !== file.file_name || file.original.media_type !== file.media_type))) throw new Error('Invalid original draft');
  if (file.state === 'verified' && !file.original) throw new Error('Invalid verified draft');
  if (file.state === 'uploading') { file.state = 'failed'; file.message = '暂存中断，可恢复'; }
}
function freezeCommand(command: BetaCommand): BetaCommand {
  if (command.originals) {
    if (!Array.isArray(command.originals) || !command.originals.every(validOriginal)) throw new Error('Invalid original manifest');
    command.originals.forEach(Object.freeze); Object.freeze(command.originals);
  }
  Object.freeze(command.tags); return Object.freeze(command);
}
function load(raw: string | null, deviceId: string): PersistedState {
  if (raw === null) return { version: 1, drafts: {}, pending: [], confirmed: [] };
  const value = JSON.parse(raw) as PersistedState;
  if (value.version !== 1 || !value.drafts || typeof value.drafts !== 'object' || !Array.isArray(value.pending)) throw new Error('Invalid draft cache');
  for (const [profile, draft] of Object.entries(value.drafts)) {
    if (typeof draft.text !== 'string' || !Number.isSafeInteger(draft.revision) || draft.revision < 0 || (draft.files !== undefined && !Array.isArray(draft.files))) throw new Error('Invalid draft');
    draft.files?.forEach(file => validateFile(file, profile, deviceId));
  }
  const confirmed: Confirmation[] = value.confirmed ?? [];
  if (!Array.isArray(confirmed)) throw new Error('Invalid confirmations');
  for (const entry of confirmed) {
    validateReceipt(entry.receipt);
    if (!Number.isSafeInteger(entry.draft_revision) || entry.draft_revision < 0) throw new Error('Invalid confirmation revision');
  }
  for (const entry of value.pending) {
    const command = entry.command;
    if (!command || typeof command.command_id !== 'string' || typeof command.event_id !== 'string'
      || typeof command.profile_id !== 'string' || typeof command.text !== 'string' || !Number.isSafeInteger(command.occurred_at_ms)
      || !Array.isArray(command.tags) || !command.tags.every(tag => typeof tag === 'string')
      || !['pending','unknown','failed','committed'].includes(entry.state) || !Number.isSafeInteger(entry.draft_revision) || entry.draft_revision < 0) throw new Error('Invalid pending capture');
    if (entry.state === 'committed') confirmed.push({ receipt: validateReceipt(entry.receipt, command), draft_revision: entry.draft_revision });
    if (entry.state === 'pending') entry.state = 'unknown';
    if (entry.files !== undefined && !Array.isArray(entry.files)) throw new Error('Invalid pending files');
    entry.files?.forEach(file => validateFile(file, command.profile_id, deviceId));
    if ((command.originals?.length ?? 0) !== (entry.files?.length ?? 0)
      || entry.files?.some((file,index) => !file.original || !command.originals?.[index] || !sameOriginal(file.original, command.originals[index]))) throw new Error('Invalid pending manifest binding');
    freezeCommand(command);
  }
  return { ...value, pending: value.pending.filter(entry => entry.state !== 'committed'), confirmed: confirmed.slice(-8) };
}

/** Owns one device's local drafts and immutable retry snapshots. It has no
 * legacy profile/event store and never interprets an accepted request as a
 * saved fact. The caller must dispose it before replacing its UI owner. */
export class BetaDraftController {
  private state: DraftSnapshot;
  private readonly key: string;
  private readonly listeners = new Set<() => void>();
  private readonly inFlight = new Map<string, Promise<BetaReceipt | null>>();
  private disposed = false;
  private restoreBlocked = false;
  private readonly sources: FileSourceStore;
  private readonly ownsSources: boolean;
  private readonly uploads = new Map<string, Promise<BetaStage>>();
  private uploadTail: Promise<unknown> = Promise.resolve();
  private unsubscribePersistence: (() => void) | undefined;
  private closing: Promise<void> | undefined;

  /** Production creation: hydrate/validate strict local intent storage before
   * exposing an editor. The sync constructor remains for explicit legacy tests. */
  static async open(client: BetaClient, deviceId: string, options: {
    journal?: LocalIntentJournal; predecessor?: IntentPredecessor; allowLegacyImport?: boolean; legacy?: DraftStorage; sources?: FileSourceStore; uuid?: () => string; clock?: () => number;
  } = {}): Promise<BetaDraftController> {
    const defaults=options.journal?undefined:productionIntentStorage();
    const storage = await openDurableIntentStorage({ key: `exomind:beta:drafts:${deviceId}`, journal: options.journal??defaults?.journal,
      predecessor: options.predecessor??defaults?.predecessor, allowLegacyImport: options.allowLegacyImport,
      // Do not even access the global getter until the journal proves absence.
      legacy: options.legacy ?? { getItem: key => globalThis.localStorage?.getItem(key) ?? null },
      validate: raw => { load(raw, deviceId); } });
    const controller = new BetaDraftController(client, deviceId, storage, options.uuid, options.clock, options.sources);
    if (controller.restoreBlocked) { controller.dispose(); throw new BetaApiError('intent_cache_corrupt', '本机草稿恢复未完成，已保留原缓存'); }
    return controller;
  }

  constructor(private readonly client: BetaClient, private readonly deviceId: string, private readonly storage: DraftStorage,
    private readonly uuid: () => string = betaUuid, private readonly clock: () => number = Date.now, sources?: FileSourceStore) {
    this.sources = sources ?? productionFileSources(); this.ownsSources = !sources;
    this.key = `exomind:beta:drafts:${deviceId}`;
    try { this.state = { ...load(storage.getItem(this.key), deviceId), persistenceError: null, persistenceState: 'idle' }; }
    catch {
      this.restoreBlocked = true;
      this.state = { version: 1, drafts: {}, pending: [], confirmed: [], persistenceError: '草稿缓存无法读取，已停止写入以保留原缓存', persistenceState: 'failed' };
    }
    if (durable(storage)) this.unsubscribePersistence = storage.subscribe(() => {
      if (this.disposed || this.restoreBlocked) return;
      const status = storage.snapshot(); this.state = { ...this.state, persistenceState: status.state, persistenceError: status.error };
      this.listeners.forEach(listener => listener());
    });
  }

  snapshot = (): DraftSnapshot => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  dispose(): void {
    if (!this.disposed) { this.disposed = true; this.listeners.clear(); this.unsubscribePersistence?.(); }
    if (!this.closing) {
      this.closing = (async () => { try { if (durable(this.storage)) await this.storage.commit(); }
        finally { if (durable(this.storage)) this.storage.close?.(); if (this.ownsSources) this.sources.close?.(); } })();
      void this.closing.catch(() => {});
    }
  }
  async close(): Promise<void> { this.dispose(); await this.closing; }
  async flush(): Promise<void> { this.active(); if (durable(this.storage)) await this.requiredCommit(); }
  private async requiredCommit(): Promise<void> {
    if (!durable(this.storage)) return;
    try { await this.storage.commit(); }
    catch {
      if (!this.disposed) { this.state = { ...this.state, persistenceState: 'failed', persistenceError: '本机草稿暂存未确认，尚未发送；请保留窗口并重试' }; this.listeners.forEach(listener => listener()); }
      throw new BetaApiError('draft_cache_unavailable', '本机草稿暂存未确认，尚未发送；请重试原提交');
    }
  }
  private publish(next: DraftSnapshot, required = false): void {
    if (this.disposed) return;
    if (this.restoreBlocked) throw new BetaApiError('draft_cache_unavailable', '请先处理无法读取的草稿缓存');
    const { version, drafts, pending, confirmed } = next;
    try {
      this.storage.setItem(this.key, JSON.stringify({ version, drafts, pending, confirmed }));
      const status = durable(this.storage) ? this.storage.snapshot() : { state: 'idle' as const, error: null };
      this.state = { ...next, persistenceError: status.error, persistenceState: status.state };
    } catch {
      if (required) throw new BetaApiError('draft_cache_unavailable', '未能暂存本次提交，尚未向服务发送');
      this.state = { ...next, persistenceError: '草稿缓存写入失败，请保留此窗口；已确认保存的记录不受影响', persistenceState: 'failed' };
    }
    this.listeners.forEach(listener => listener());
  }

  setDraft(profileId: string, text: string): void {
    const previous = this.state.drafts[profileId] ?? { text: '', revision: 0 };
    this.publish({ ...this.state, drafts: { ...this.state.drafts, [profileId]: { ...previous, text, revision: previous.revision + 1 } } });
  }

  private needed(profileId: string, id: string): boolean {
    return !!this.state.drafts[profileId]?.files?.some(file => file.id === id)
      || this.state.pending.some(item => item.command.profile_id === profileId && item.files?.some(file => file.id === id));
  }
  private patchFile(profileId: string, id: string, patch: Partial<DraftFile>, required = false): void {
    const draft = this.state.drafts[profileId];
    const files = draft?.files?.map(file => file.id === id ? { ...file, ...patch } : file);
    this.publish({ ...this.state,
      drafts: draft ? { ...this.state.drafts, [profileId]: { ...draft, files } } : this.state.drafts,
      pending: this.state.pending.map(item => item.command.profile_id === profileId && item.files
        ? { ...item, files: item.files.map(file => file.id === id ? { ...file, ...patch } : file) } : item),
    }, required);
  }
  private active(): void { if (this.disposed) throw new BetaApiError('inactive_session', '当前记录窗口已关闭'); }

  async addFiles(profileId: string, selected: readonly File[]): Promise<void> {
    this.active();
    if (!this.client.originals) throw new BetaApiError('unsupported_capability', '当前服务尚未提供原件暂存');
    // Persist the whole selection intent before yielding, so B cannot disappear
    // from the intended A/B group while A is being copied/hashed.
    const inputs = Array.from(selected);
    const incoming: DraftFile[] = inputs.map(file => {
      const id = this.uuid();
      return { id, stage_id: this.uuid(), source_key: sourceKey(this.deviceId, profileId, id), file_name: file.name,
        byte_length: file.size, media_type: file.type || 'application/octet-stream', state: 'preparing', next_offset: 0 };
    });
    if (!incoming.length) return;
    const previous = this.state.drafts[profileId] ?? { text: '', revision: 0 };
    const next = { ...this.state, drafts: { ...this.state.drafts, [profileId]: { ...previous, revision: previous.revision + 1, files: [...(previous.files ?? []), ...incoming] } } };
    try { this.publish(next, true); if (durable(this.storage)) { await this.requiredCommit(); this.active(); } }
    catch (error) {
      this.publish({ ...next, drafts: { ...next.drafts, [profileId]: { ...next.drafts[profileId], files: [...(previous.files ?? []), ...incoming.map(file => ({ ...file, state: 'failed' as const, message: errorMessage(error) }))] } } });
      return;
    }
    for (let index = 0; index < incoming.length; index++) {
      const file = incoming[index];
      try {
        this.active();
        // Complete the backend's durable source copy before publishing the
        // original manifest or beginning Core stage/capture operations.
        await this.sources.put(file.source_key, inputs[index]);
        this.active(); await this.prepareSource(profileId, file);
      } catch (error) {
        if (!this.disposed) this.patchFile(profileId, file.id, { state: 'failed', message: errorMessage(error) });
      }
    }
  }

  removeFile(profileId: string, id: string): void {
    this.active(); const previous = this.state.drafts[profileId]; if (!previous) return;
    this.publish({ ...this.state, drafts: { ...this.state.drafts, [profileId]: { ...previous,
      revision: previous.revision + 1, files: previous.files?.filter(file => file.id !== id) } } });
    // A frozen pending submission may still need these bytes. Removing a next
    // draft selection never deletes the Core original or its browser source.
  }

  private async prepareSource(profileId: string, file: DraftFile): Promise<void> {
    await this.sources.resume?.(file.source_key); this.active();
    const source = await this.sources.get(file.source_key); this.active();
    if (!source) throw new BetaApiError('source_missing', '本机暂存源未找到，请重新选择原文件；不会跳过此项提交');
    if (source.size !== file.byte_length) throw new BetaApiError('source_mismatch', '原件长度与草稿不一致，请重新选择原文件');
    const sha = await hashFileSource(source, () => this.disposed); this.active();
    if (file.original && file.original.sha256 !== sha) throw new BetaApiError('source_mismatch', '重新选择的文件与原件 hash 不同，原提交保持不变');
    const original: BetaOriginal = { original_id: file.id, sha256: sha, byte_length: file.byte_length, file_name: file.file_name, media_type: file.media_type };
    const prepared: DraftFile = { ...file, original, state: 'uploading', message: undefined };
    this.patchFile(profileId, file.id, prepared, true);
    if (durable(this.storage)) { await this.requiredCommit(); this.active(); }
    if (this.needed(profileId, file.id)) void this.ensureUploaded(profileId, prepared).catch(() => {});
  }

  async resumeFiles(profileId: string): Promise<void> {
    const files = this.state.drafts[profileId]?.files ?? [];
    for (const file of files) {
      if (this.disposed) return;
      try {
        if (!file.original) await this.prepareSource(profileId, file);
        else await this.ensureUploaded(profileId, file);
      } catch (error) {
        if (!this.disposed) this.patchFile(profileId, file.id, { state: errorCode(error) === 'source_missing' ? 'source_missing' : 'failed', message: errorMessage(error) });
      }
    }
  }

  async reselectFile(profileId: string, id: string, source: File): Promise<void> {
    this.active(); const draft = this.state.drafts[profileId]; const file = draft?.files?.find(item => item.id === id);
    if (!draft || !file) throw new BetaApiError('source_missing', '当前草稿中找不到该原件');
    if (source.size !== file.byte_length) throw new BetaApiError('source_mismatch', '重新选择的文件长度不同，原提交保持不变');
    const sha = await hashFileSource(source, () => this.disposed); this.active();
    if (file.original && sha !== file.original.sha256) throw new BetaApiError('source_mismatch', '重新选择的文件与原件 hash 不同，原提交保持不变');
    const current = this.state.drafts[profileId];
    this.publish({ ...this.state, drafts: { ...this.state.drafts, [profileId]: { ...current, revision: current.revision + 1,
      files: current.files?.map(item => item.id === id ? { ...item, state: 'preparing' as const, message: undefined } : item) } } }, true);
    if (durable(this.storage)) { await this.requiredCommit(); this.active(); }
    try { await this.sources.put(file.source_key, source); this.active(); await this.prepareSource(profileId, file); }
    catch (error) { if (!this.disposed) this.patchFile(profileId, id, { state: 'failed', message: errorMessage(error) }); throw error; }
  }

  private bindStage(profileId: string, file: DraftFile, stage: BetaStage): BetaStage {
    if (!file.original || stage.stage_id !== file.stage_id || stage.profile_id !== profileId
      || !stage.original || !sameOriginal(stage.original, file.original) || !Number.isSafeInteger(stage.next_offset)
      || stage.next_offset < 0 || stage.next_offset > file.byte_length || (stage.state === 'verified' && stage.next_offset !== file.byte_length)) {
      throw new BetaApiError('original_state_mismatch', '服务原件状态与固定草稿不一致，尚未提交记录');
    }
    return stage;
  }

  private ensureUploaded(profileId: string, file: DraftFile): Promise<BetaStage> {
    const existing = this.uploads.get(file.stage_id); if (existing) return existing;
    const operation = this.uploadTail.catch(() => {}).then(() => this.uploadFile(profileId, file)).catch(error => {
      if (!this.disposed) this.patchFile(profileId, file.id, { state: errorCode(error) === 'source_missing' ? 'source_missing' : 'failed', message: errorMessage(error) });
      throw error;
    });
    this.uploads.set(file.stage_id, operation); this.uploadTail = operation.catch(() => {});
    void operation.finally(() => { if (this.uploads.get(file.stage_id) === operation) this.uploads.delete(file.stage_id); }).catch(() => {});
    return operation;
  }

  private async uploadFile(profileId: string, file: DraftFile): Promise<BetaStage> {
    this.active();
    if (durable(this.storage)) { await this.requiredCommit(); this.active(); }
    if (!this.needed(profileId, file.id)) throw new BetaApiError('selection_removed', '此草稿项已移除，其暂存仍保留');
    const api = this.client.originals; if (!api || !file.original) throw new BetaApiError('unsupported_capability', '原件暂存尚未就绪');
    const original = file.original;
    let stage = this.bindStage(profileId, file, await api.begin({ stage_id: file.stage_id, original_id: original.original_id, profile_id: profileId,
      expected_sha256: original.sha256, byte_length: original.byte_length, file_name: original.file_name, media_type: original.media_type }));
    this.active();
    if (stage.state === 'hash_mismatch') throw new BetaApiError('original_hash_mismatch', '原件校验失败，暂存仍保留；请移除此项后重新选择');
    this.patchFile(profileId, file.id, { state: stage.state === 'verified' ? 'verified' : 'uploading', next_offset: stage.next_offset, message: undefined });
    let usedSource: FileSource | undefined;
    if (stage.next_offset < file.byte_length) {
      await this.sources.resume?.(file.source_key); this.active();
      const source = await this.sources.get(file.source_key); this.active();
      if (!source) throw new BetaApiError('source_missing', '本机暂存源未找到，请重新选择原文件；不会跳过此项提交');
      usedSource = source;
      if (source.size !== file.byte_length || await hashFileSource(source, () => this.disposed) !== original.sha256) throw new BetaApiError('source_mismatch', '本机源与固定原件 hash 不同，尚未提交记录');
      while (stage.next_offset < file.byte_length) {
        this.active(); const offset = stage.next_offset;
        const bytes = await readFileSource(source, offset, Math.min(ORIGINAL_CHUNK_BYTES, file.byte_length - offset)); this.active();
        if (!bytes.length) throw new BetaApiError('source_incomplete', '原件源读取中断，暂存偏移已保留');
        stage = this.bindStage(profileId, file, await api.write(profileId, file.stage_id, offset, bytes)); this.active();
        if (stage.next_offset < offset + bytes.length) throw new BetaApiError('original_no_progress', '原件暂存未推进，偏移已保留，可重试');
        this.patchFile(profileId, file.id, { state: 'uploading', next_offset: stage.next_offset });
      }
    }
    if (stage.state !== 'verified') { this.active(); stage = this.bindStage(profileId, file, await api.verify(profileId, file.stage_id)); this.active(); }
    if (stage.state !== 'verified') throw new BetaApiError('original_not_ready', '整组原件尚未校验就绪，记录未提交');
    this.patchFile(profileId, file.id, { state: 'verified', next_offset: file.byte_length, message: undefined });
    // Core owns a durable verified copy now. Only this local source duplicate is
    // released; a failed local cleanup never changes the verified save result.
    try { await this.sources.remove(file.source_key, usedSource); }
    catch { if (!this.disposed) this.patchFile(profileId, file.id, { message: '原件已暂存；本机源清理暂未确认' }); }
    return stage;
  }

  async submit(profileId: string): Promise<BetaReceipt | null> {
    if (this.disposed) throw new BetaApiError('inactive_session', '当前记录窗口已关闭');
    const draft = this.state.drafts[profileId];
    if (draft?.files?.some(file => !file.original || file.state === 'preparing')) throw new BetaApiError('original_preparing', '所选原件尚未完成本机复制和校验，请等待、重选或明确移除');
    if (!draft?.text.trim() && !draft?.files?.length) return null;
    const previous = this.state.pending.find(entry => entry.command.profile_id === profileId
      && entry.draft_revision === draft.revision && entry.state !== 'committed');
    if (previous) return this.retry(previous.command.command_id);
    const files = draft.files?.map(file => ({ ...file, original: { ...file.original! } })) ?? [];
    const command = freezeCommand({ command_id: this.uuid(), event_id: this.uuid(), profile_id: profileId,
      occurred_at_ms: this.clock(), text: draft.text, tags: [], ...(files.length ? { originals: files.map(file => ({ ...file.original! })) } : {}) });
    const pending: PendingCapture = { command, draft_revision: draft.revision, state: 'pending', ...(files.length ? { files, capture_attempted: false } : {}) };
    this.publish({ ...this.state, pending: [...this.state.pending, pending] }, true);
    if (durable(this.storage)) {
      try { await this.requiredCommit(); }
      catch (error) { if (!this.disposed) this.updatePending(command.command_id, { state: 'failed', message: errorMessage(error), error_code: errorCode(error) }); throw error; }
      if (this.disposed) return null;
    }
    return this.send(pending, false);
  }

  retry(commandId: string): Promise<BetaReceipt | null> {
    if (this.disposed) return Promise.reject(new BetaApiError('inactive_session', '当前记录窗口已关闭'));
    const pending = this.state.pending.find(entry => entry.command.command_id === commandId);
    const confirmed = this.state.confirmed.find(entry => entry.receipt.command_id === commandId);
    if (confirmed) return Promise.resolve(confirmed.receipt);
    if (!pending) return Promise.reject(new BetaApiError('missing_submission', '找不到待确认提交'));
    if (pending.state === 'committed' && pending.receipt) return Promise.resolve(pending.receipt);
    return this.send(pending, true);
  }

  private send(pending: PendingCapture, reconcileFirst: boolean): Promise<BetaReceipt | null> {
    const id = pending.command.command_id;
    const running = this.inFlight.get(id);
    if (running) return running;
    const operation = this.perform(pending, reconcileFirst);
    this.inFlight.set(id, operation);
    void operation.finally(() => { if (this.inFlight.get(id) === operation) this.inFlight.delete(id); }).catch(() => {});
    return operation;
  }

  private updatePending(id: string, change: Partial<PendingCapture>): void {
    this.publish({ ...this.state, pending: this.state.pending.map(entry => entry.command.command_id === id ? { ...entry, ...change } : entry) });
  }
  private commit(pending: PendingCapture, value: unknown): BetaReceipt {
    const receipt = validateReceipt(value, pending.command);
    if (this.disposed) return receipt;
    const profile = pending.command.profile_id;
    const draft = this.state.drafts[profile];
    const drafts = draft?.revision === pending.draft_revision
      ? { ...this.state.drafts, [profile]: { text: '', revision: draft.revision + 1, files: [] } }
      : this.state.drafts;
    this.publish({ ...this.state, drafts,
      pending: this.state.pending.filter(entry => entry.command.command_id !== pending.command.command_id),
      confirmed: [...this.state.confirmed, { receipt, draft_revision: pending.draft_revision }].slice(-8) });
    return receipt;
  }

  private async perform(pending: PendingCapture, reconcileFirst: boolean): Promise<BetaReceipt | null> {
    if (durable(this.storage)) {
      try { await this.requiredCommit(); }
      catch (error) { if (!this.disposed) this.updatePending(pending.command.command_id, { state: 'failed', message: errorMessage(error), error_code: errorCode(error) }); return null; }
      if (this.disposed) return null;
    }
    if (reconcileFirst) {
      try {
        const receipt = await this.client.receipt(pending.command.profile_id, pending.command.command_id);
        if (receipt) return this.commit(pending, receipt);
      } catch (error) {
        if (!this.disposed) this.updatePending(pending.command.command_id, { state: 'unknown', message: errorMessage(error), error_code: errorCode(error) });
        return null;
      }
    }
    if (this.disposed) return null;
    this.updatePending(pending.command.command_id, { state: 'pending', message: undefined, error_code: undefined });
    let captureAttempted = false;
    try {
      for (const file of pending.files ?? []) await this.ensureUploaded(pending.command.profile_id, file);
      if (this.disposed) return null;
      const next = { ...this.state, pending: this.state.pending.map(item => item.command.command_id === pending.command.command_id ? { ...item, capture_attempted: true } : item) };
      this.publish(next, true);
      if (durable(this.storage)) { await this.requiredCommit(); if (this.disposed) return null; }
      captureAttempted = true;
      return this.commit(pending, await this.client.capture(pending.command));
    }
    catch (error) {
      if (!this.disposed) this.updatePending(pending.command.command_id, { state: captureAttempted ? 'unknown' : 'failed', message: errorMessage(error), error_code: errorCode(error) });
      return null;
    }
  }
}
