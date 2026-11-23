import { BetaApiError, validateReceipt, type BetaClient, type BetaCommand, type BetaReceipt } from './client';
import { betaUuid } from './initialization';
import { hashFileSource, readFileSource, sourceKey, type FileSource, type FileSourceStore } from './file-source-store';
import { productionFileSources } from './native-source-store';
import { ORIGINAL_CHUNK_BYTES, type BetaOriginal, type BetaStage } from './original-types';
import { openDurableIntentStorage, type DurableIntentStorage, type LocalIntentJournal, type IntentPredecessor } from './local-intent-journal';
import { productionIntentStorage } from './native-intent-journal';
import type { AttachmentProgress, FileSourceWork } from './attachment-progress';
import { hasNativeAttachmentSources, isNativeAttachment, isSharedHandoffAttachment, type AttachmentSelection } from './native-attachment-types';
import { MAX_BETA_EVENT_TAG_BYTES, MAX_BETA_EVENT_TAGS } from './record-organization-client';

export interface DraftFile {
  id: string; stage_id: string; source_key: string;
  /** Stable origin supplied by an owning capture controller, such as a recording session. */
  source_id?: string;
  file_name: string; byte_length: number; media_type: string;
  original?: BetaOriginal;
  state: 'preparing' | 'uploading' | 'verified' | 'failed' | 'source_missing';
  next_offset: number; message?: string;
}
interface Draft {
  text: string;
  revision: number;
  tags?: string[];
  files?: DraftFile[];
  imported_handoffs?: string[];
  restored_command_id?: string;
}
export interface PendingCapture {
  command: BetaCommand; draft_revision: number;
  state: 'pending' | 'unknown' | 'failed' | 'committed';
  message?: string; error_code?: string; receipt?: BetaReceipt;
  files?: DraftFile[]; capture_attempted?: boolean;
  /** Local-only source text restored after failure when send-boundary trim changed it. */
  editable_text?: string;
}
interface Confirmation { receipt: BetaReceipt; draft_revision: number }
interface PersistedState { version: 1; drafts: Record<string, Draft>; pending: PendingCapture[]; confirmed: Confirmation[] }
export type AttachmentQueueStage = 'preparation' | 'upload';
export interface AttachmentQueueProgress {
  kind: 'queued' | 'retry';
  stage: AttachmentQueueStage;
  position?: number;
  retryIndex?: number;
  retryDelayMs?: number;
}
export interface BetaAttachmentProgress extends AttachmentProgress { queue?: AttachmentQueueProgress }
export interface DraftSnapshot extends PersistedState { persistenceError: string | null; persistenceState: 'idle' | 'pending' | 'failed'; fileProgress: Readonly<Record<string,BetaAttachmentProgress>> }
type DraftStorage = Pick<Storage, 'getItem' | 'setItem'>;

interface QueuedAttachmentWork<T> {
  id: string;
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

/** FIFO work slots keep each Native/Host operation bounded while allowing
 * distinct attachment identities to make progress independently. */
class BoundedAttachmentQueue<T> {
  private readonly waiting: QueuedAttachmentWork<T>[] = [];
  private active = 0;

  constructor(private readonly limit: number, private readonly changed: (id: string, position: number | null) => void) {}

  enqueue(id: string, run: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.waiting.push({ id, run, resolve, reject });
      this.notifyWaiting();
      this.drain();
    });
  }

  cancel(id: string, error: unknown): boolean {
    const index = this.waiting.findIndex(item => item.id === id);
    if (index < 0) return false;
    const [item] = this.waiting.splice(index, 1);
    item.reject(error);
    this.notifyWaiting();
    this.drain();
    return true;
  }

  cancelAll(error: unknown): void {
    const waiting = this.waiting.splice(0);
    for (const item of waiting) item.reject(error);
  }

  private notifyWaiting(): void {
    this.waiting.forEach((item, index) => this.changed(item.id, index + 1));
  }

  private drain(): void {
    while (this.active < this.limit && this.waiting.length) {
      const item = this.waiting.shift()!;
      this.active++;
      this.changed(item.id, null);
      this.notifyWaiting();
      void Promise.resolve().then(item.run).then(item.resolve, item.reject).finally(() => {
        this.active--;
        this.drain();
      });
    }
  }
}

const PREPARATION_WORKER_LIMIT = 2;
const UPLOAD_WORKER_LIMIT = 2;
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
const AUTOMATIC_UPLOAD_RETRY_DELAYS_MS=[250,500,1000] as const;
const MAX_IMPORTED_HANDOFF_IDS=128;
const MAX_CAPTURE_TEXT_BYTES=128*1024;
type UploadRetryDelay=(milliseconds:number)=>Promise<void>;
const waitForUploadRetry:UploadRetryDelay=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
const RETRYABLE_UPLOAD_ERROR_CODES=new Set([
  'unavailable','network_error','network_unavailable','transport_error','timeout','temporarily_unavailable','service_unavailable',
  'local_source_unavailable','source_store_unavailable','source_store_failed','source_incomplete','storage_failed','offline',
  'original_not_ready','original_no_progress','busy','operation_busy',
]);
function retryableUploadError(error:unknown):boolean{
  if(error instanceof BetaApiError){if(error.status===408||error.status===429||error.status>=500)return true;return RETRYABLE_UPLOAD_ERROR_CODES.has(error.code);}
  if(error instanceof TypeError)return true;
  if(error instanceof Error)return 'code' in error&&typeof error.code==='string'&&RETRYABLE_UPLOAD_ERROR_CODES.has(error.code);
  return !!error&&typeof error==='object'&&'code' in error&&typeof error.code==='string'&&RETRYABLE_UPLOAD_ERROR_CODES.has(error.code);
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
    || (file.source_id !== undefined && (typeof file.source_id !== 'string' || !file.source_id.trim() || file.source_id.length > 128))
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
function validTags(tags: readonly string[]): boolean {
  return tags.length <= MAX_BETA_EVENT_TAGS
    && tags.every(tag => typeof tag === 'string' && tag.trim().length > 0
      && new TextEncoder().encode(tag).byteLength <= MAX_BETA_EVENT_TAG_BYTES);
}
function load(raw: string | null, deviceId: string): PersistedState {
  if (raw === null) return { version: 1, drafts: {}, pending: [], confirmed: [] };
  const value = JSON.parse(raw) as PersistedState;
  if (value.version !== 1 || !value.drafts || typeof value.drafts !== 'object' || !Array.isArray(value.pending)) throw new Error('Invalid draft cache');
  for (const [profile, draft] of Object.entries(value.drafts)) {
    if (typeof draft.text !== 'string' || !Number.isSafeInteger(draft.revision) || draft.revision < 0
      || (draft.tags !== undefined && (!Array.isArray(draft.tags) || !validTags(draft.tags)))
      || (draft.imported_handoffs !== undefined && (!Array.isArray(draft.imported_handoffs)
        || draft.imported_handoffs.length > MAX_IMPORTED_HANDOFF_IDS
        || draft.imported_handoffs.some(id => typeof id !== 'string' || !id.trim() || id.length > 128 || /[\u0000-\u001f\u007f\s]/.test(id))
        || new Set(draft.imported_handoffs).size !== draft.imported_handoffs.length))
      || (draft.restored_command_id !== undefined
        && (typeof draft.restored_command_id !== 'string' || !draft.restored_command_id.trim()))
      || (draft.files !== undefined && !Array.isArray(draft.files))) throw new Error('Invalid draft');
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
      || !Array.isArray(command.tags) || !validTags(command.tags)
      || (entry.editable_text !== undefined && typeof entry.editable_text !== 'string')
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
  private readonly sourceHandles = new Map<string,AttachmentSelection>();
  private readonly preparations = new Map<string,Promise<void>>();
  private readonly fileCancellation=new Map<string,AbortController>();
  private readonly preparationQueue: BoundedAttachmentQueue<void>;
  private readonly uploadQueue: BoundedAttachmentQueue<BetaStage>;
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
    private readonly uuid: () => string = betaUuid, private readonly clock: () => number = Date.now, sources?: FileSourceStore,
    private readonly uploadRetryDelay:UploadRetryDelay=waitForUploadRetry) {
    this.sources = sources ?? productionFileSources(); this.ownsSources = !sources;
    this.key = `exomind:beta:drafts:${deviceId}`;
    try { this.state = { ...load(storage.getItem(this.key), deviceId), persistenceError: null, persistenceState: 'idle', fileProgress:{} }; }
    catch {
      this.restoreBlocked = true;
      this.state = { version: 1, drafts: {}, pending: [], confirmed: [], persistenceError: '草稿缓存无法读取，已停止写入以保留原缓存', persistenceState: 'failed', fileProgress:{} };
    }
    this.preparationQueue = new BoundedAttachmentQueue(PREPARATION_WORKER_LIMIT,
      (id, position) => this.queueProgress(id, 'preparation', position));
    this.uploadQueue = new BoundedAttachmentQueue(UPLOAD_WORKER_LIMIT,
      (id, position) => this.queueProgress(id, 'upload', position));
    let external=durable(storage)?storage.snapshot().externalRevision??0:0;
    if (durable(storage)) this.unsubscribePersistence = storage.subscribe(() => {
      if (this.disposed || this.restoreBlocked) return;
      const status = storage.snapshot();let restored:Partial<PersistedState>={};if((status.externalRevision??0)!==external){external=status.externalRevision??0;restored=load(storage.getItem(this.key),deviceId);} this.state = { ...this.state,...restored, persistenceState: status.state, persistenceError: status.error };
      this.listeners.forEach(listener => listener());
    });
  }

  snapshot = (): DraftSnapshot => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  hasRetainedFileSource = (profileId:string,id:string):boolean => this.needed(profileId,id)&&this.sourceHandles.has(id);
  dispose(): void {
    if (!this.disposed) { this.disposed = true; this.listeners.clear(); this.unsubscribePersistence?.(); }
    const cancelled = new BetaApiError('inactive_session', '当前记录窗口已关闭；排队附件仍保留在草稿中');
    this.preparationQueue.cancelAll(cancelled);
    this.uploadQueue.cancelAll(cancelled);
    for(const cancellation of this.fileCancellation.values())cancellation.abort();
    this.fileCancellation.clear();
    this.sourceHandles.clear();
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

  setDraft(profileId: string, text: string): boolean {
    const previous = this.state.drafts[profileId] ?? { text: '', revision: 0, tags: [] };
    const cancelledBeforeCapture = this.state.pending.filter(entry =>
      entry.command.profile_id === profileId
      && entry.capture_attempted === false
      && (entry.state === 'pending' || entry.state === 'failed'));
    if (cancelledBeforeCapture.length) {
      const cancelledIds = new Set(cancelledBeforeCapture.map(entry => entry.command.command_id));
      const textParts = [
        ...cancelledBeforeCapture.map(entry => entry.editable_text ?? entry.command.text),
        text,
      ].filter(part => part.length > 0);
      const filesById = new Map<string, DraftFile>();
      for (const entry of cancelledBeforeCapture) {
        for (const file of entry.files ?? []) {
          filesById.set(file.id, { ...file, ...(file.original ? { original: { ...file.original } } : {}) });
        }
      }
      for (const file of previous.files ?? []) {
        filesById.set(file.id, { ...file, ...(file.original ? { original: { ...file.original } } : {}) });
      }
      const tags = Array.from(new Set([
        ...cancelledBeforeCapture.flatMap(entry => entry.command.tags),
        ...(previous.tags ?? []),
      ]));
      const files = Array.from(filesById.values());
      this.publish({
        ...this.state,
        drafts: { ...this.state.drafts, [profileId]: {
          ...previous,
          text: textParts.join('\n\n'),
          revision: previous.revision + 1,
          tags,
          ...(files.length ? { files } : {}),
          restored_command_id: undefined,
        } },
        pending: this.state.pending.filter(entry => !cancelledIds.has(entry.command.command_id)),
      }, true);
      return true;
    }
    this.publish({ ...this.state, drafts: { ...this.state.drafts, [profileId]: {
      ...previous, text, revision: previous.revision + 1, restored_command_id: undefined,
    } } });
    return false;
  }

  /** Append shared text once to the selected profile's durable draft. The
   * handoff ID stays with the draft so duplicate Android intents cannot append
   * the same text again before the Native handoff is acknowledged. */
  async appendSharedHandoffText(profileId: string, handoffId: string, text: string): Promise<boolean> {
    this.active();
    if (!profileId.trim() || !handoffId.trim() || handoffId.length > 128
      || /[\u0000-\u001f\u007f\s]/.test(handoffId) || typeof text !== 'string' || !text.length) {
      throw new BetaApiError('invalid_share_handoff', '系统分享内容无效，未改动当前草稿');
    }
    const previous = this.state.drafts[profileId] ?? { text: '', revision: 0, tags: [] };
    const imported = previous.imported_handoffs ?? [];
    if (imported.includes(handoffId)) {
      // A previous append may have reached local storage before its durable
      // acknowledgement failed. Reconfirm that same state before the caller
      // acknowledges the Native handoff; never append the text twice.
      if (durable(this.storage)) await this.requiredCommit();
      this.active();
      return false;
    }
    const imported_handoffs = [...imported, handoffId].slice(-MAX_IMPORTED_HANDOFF_IDS);
    const nextText = previous.text ? `${previous.text}\n\n${text}` : text;
    if(new TextEncoder().encode(nextText).byteLength>MAX_CAPTURE_TEXT_BYTES){
      throw new BetaApiError('capture_text_too_large','分享文字与当前草稿合计超过单条记录上限；现有内容和分享均保留，请先发送或缩短当前草稿再重试');
    }
    this.publish({ ...this.state, drafts: { ...this.state.drafts, [profileId]: {
      ...previous, text: nextText, revision: previous.revision + 1, imported_handoffs,
      restored_command_id: undefined,
    } } }, true);
    if (durable(this.storage)) await this.requiredCommit();
    this.active();
    return true;
  }

  setTags(profileId: string, tags: readonly string[]): void {
    const normalized = Array.from(new Set(tags.map(tag => tag.trim()).filter(Boolean)));
    if (!validTags(normalized)) throw new BetaApiError('invalid_tags', '最多可添加 64 个标签，每个标签最多 128 字节');
    const previous = this.state.drafts[profileId] ?? { text: '', revision: 0, tags: [] };
    if (JSON.stringify(previous.tags ?? []) === JSON.stringify(normalized)) return;
    this.publish({ ...this.state, drafts: { ...this.state.drafts, [profileId]: {
      ...previous, tags: normalized, revision: previous.revision + 1, restored_command_id: undefined,
    } } });
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
  private findFile(id: string): DraftFile | undefined {
    return Object.values(this.state.drafts).flatMap(draft => draft.files ?? []).find(file => file.id === id)
      ?? this.state.pending.flatMap(item => item.files ?? []).find(file => file.id === id);
  }
  private queueProgress(id: string, stage: AttachmentQueueStage, position: number | null): void {
    if (this.disposed) return;
    const file = this.findFile(id);
    if (!file) return;
    const now = this.clock(), previous = this.state.fileProgress[id];
    const progress: BetaAttachmentProgress = position === null
      ? { phase: stage === 'preparation' ? 'copying' : 'staging',
          completed: stage === 'preparation' ? 0 : file.next_offset, total: file.byte_length,
          startedAt: previous?.startedAt ?? now, phaseStartedAt: now, updatedAt: now }
      : { phase: 'queued', completed: null, total: file.byte_length, startedAt: previous?.startedAt ?? now,
          phaseStartedAt: now, updatedAt: now, queue: { kind: 'queued', stage, position } };
    this.state = { ...this.state, fileProgress: { ...this.state.fileProgress, [id]: progress } };
    this.listeners.forEach(listener => listener());
  }
  private retryWaitProgress(profileId: string, id: string, stage: AttachmentQueueStage, retryIndex: number, delay: number): void {
    if (this.disposed || !this.needed(profileId, id)) return;
    const file = this.findFile(id);
    if (!file) return;
    const now = this.clock(), previous = this.state.fileProgress[id];
    const progress: BetaAttachmentProgress = { phase: 'queued', completed: null, total: file.byte_length,
      startedAt: previous?.startedAt ?? now, phaseStartedAt: now, updatedAt: now,
      queue: { kind: 'retry', stage, retryIndex, retryDelayMs: delay } };
    this.state = { ...this.state, fileProgress: { ...this.state.fileProgress, [id]: progress } };
    this.listeners.forEach(listener => listener());
  }
  private fileWork(profileId:string,file:DraftFile):FileSourceWork {
    let cancellation=this.fileCancellation.get(file.id);if(!cancellation){cancellation=new AbortController();this.fileCancellation.set(file.id,cancellation);}
    return {
      signal:cancellation.signal,
      cancelled:()=>this.disposed||!this.needed(profileId,file.id),
      progress:(phase,completed,total)=>{
        if(this.disposed||!this.needed(profileId,file.id))return;
        const now=this.clock(),previous=this.state.fileProgress[file.id];
        if(previous?.phase===phase&&previous.completed!==null&&previous.completed>0&&completed!==total&&now-previous.updatedAt<150)return;
        const progress:BetaAttachmentProgress={phase,completed,total,startedAt:previous?.startedAt??now,phaseStartedAt:previous?.phase===phase?previous.phaseStartedAt:now,updatedAt:now};
        // Progress is observation, not a draft edit or durable journal write.
        this.state={...this.state,fileProgress:{...this.state.fileProgress,[file.id]:progress}};
        this.listeners.forEach(listener=>listener());
      },
    };
  }
  private selected(profileId:string,id:string):void {
    this.active();if(!this.needed(profileId,id))throw new BetaApiError('selection_removed','附件准备已取消，已有原件保持不变');
  }

  /** Read only the source still selected by this draft, never a caller's key. */
  async previewSource(profileId: string, id: string): Promise<FileSource | null> {
    this.active();
    const file = this.state.drafts[profileId]?.files?.find(item => item.id === id);
    if (!file || file.state === 'preparing') return null;
    let source = await this.sources.get(file.source_key);
    if(!source&&file.original&&this.client.originals){
      const stage=this.bindStage(profileId,file,await this.client.originals.status(profileId,file.stage_id));
      if(stage.state==='verified'){const api=this.client.originals;source={size:file.byte_length,sha256:file.original.sha256,read:(offset,length)=>api.readStage(profileId,file.stage_id,offset,length)};}
    }
    this.active();
    const current = this.state.drafts[profileId]?.files?.find(item => item.id === id);
    // Upload progress replaces metadata objects without changing the image.
    // Fence by its immutable source identity, not the transient object/state.
    if (!current || current.source_key !== file.source_key || current.byte_length !== file.byte_length
      || current.original?.sha256 !== file.original?.sha256 || source?.size !== file.byte_length) return null;
    return source;
  }

  async addFiles(profileId: string, selected: readonly AttachmentSelection[], options: { sourceIds?: readonly (string | undefined)[] } = {}): Promise<string[]> {
    this.active();
    if (!this.client.originals) throw new BetaApiError('unsupported_capability', '当前服务尚未提供原件暂存');
    // Persist the whole selection intent before yielding, so B cannot disappear
    // from the intended A/B group while A is being copied/hashed.
    const inputs = Array.from(selected);
    const sourceIds = options.sourceIds ?? [];
    if (sourceIds.length && sourceIds.length !== inputs.length) throw new BetaApiError('invalid_source_identity', '附件来源身份与所选文件数量不一致');
    const ids = new Array<string>(inputs.length);
    const incomingInputs: Array<{ file: AttachmentSelection; index: number; sourceId?: string }> = [];
    const previousDraft = this.state.drafts[profileId] ?? { text: '', revision: 0, tags: [] };
    const seenSourceIds = new Set<string>();
    for (let index = 0; index < inputs.length; index++) {
      const sourceId = sourceIds[index];
      if (sourceId !== undefined) {
        if (!sourceId.trim() || sourceId.length > 128 || seenSourceIds.has(sourceId)) {
          throw new BetaApiError('invalid_source_identity', '附件来源身份无效或重复');
        }
        seenSourceIds.add(sourceId);
        const existing = previousDraft.files?.find(file => file.source_id === sourceId);
        if (existing) {
          if (existing.byte_length !== inputs[index].size || existing.media_type !== (inputs[index].type || 'application/octet-stream')) {
            throw new BetaApiError('source_identity_conflict', '同一录音来源对应了不同附件内容，原草稿保持不变');
          }
          ids[index] = existing.id;
          const source = await this.previewSource(profileId, existing.id);
          if (!source || source.size !== inputs[index].size) await this.reselectFile(profileId, existing.id, inputs[index]);
          continue;
        }
      }
      incomingInputs.push({ file: inputs[index], index, ...(sourceId ? { sourceId } : {}) });
    }
    const incoming: DraftFile[] = incomingInputs.map(({ file, sourceId }) => {
      const id = this.uuid();
      return { id, stage_id: this.uuid(), source_key: sourceKey(this.deviceId, profileId, id), file_name: file.name,
        ...(sourceId ? { source_id: sourceId } : {}), byte_length: file.size, media_type: file.type || 'application/octet-stream', state: 'preparing', next_offset: 0 };
    });
    if (!incoming.length) return ids;
    incomingInputs.forEach(({ index }, position) => { ids[index] = incoming[position].id; });
    const previous = this.state.drafts[profileId] ?? { text: '', revision: 0, tags: [] };
    const selectedAt=this.clock(),fileProgress={...this.state.fileProgress};for(const file of incoming)fileProgress[file.id]={phase:'queued',completed:null,total:file.byte_length,startedAt:selectedAt,phaseStartedAt:selectedAt,updatedAt:selectedAt};
    const next = { ...this.state,fileProgress, drafts: { ...this.state.drafts, [profileId]: {
      ...previous, revision: previous.revision + 1, files: [...(previous.files ?? []), ...incoming],
      restored_command_id: undefined,
    } } };
    incomingInputs.forEach(({file},index)=>this.sourceHandles.set(incoming[index].id,file));
    let admitted=false;
    try { this.publish(next, true);admitted=true; if (durable(this.storage)) { await this.requiredCommit(); this.active(); } }
    catch (error) {
      const latest=this.state.drafts[profileId]??{text:'',revision:0},incomingIds=new Set(incoming.map(file=>file.id)),existing=new Set(latest.files?.map(file=>file.id));
      const failed=(file:DraftFile):DraftFile=>({...file,state:'failed',message:errorMessage(error)});
      const files=[...(latest.files??[]).map(file=>incomingIds.has(file.id)?failed(file):file),...(!admitted?incoming.filter(file=>!existing.has(file.id)).map(failed):[])];
      this.publish({...this.state,drafts:{...this.state.drafts,[profileId]:{...latest,revision:latest.revision+(admitted?0:1),files}}});
      return ids;
    }
    await Promise.all(incoming.map(async (file, index) => {
      try { await this.copyAndPrepare(profileId, file, incomingInputs[index].file); }
      catch (error) {
        if (!this.disposed) this.patchFile(profileId, file.id, { state: 'failed', message: errorMessage(error) });
      }
    }));
    return ids;
  }

  removeFile(profileId: string, id: string): void {
    this.active(); const previous = this.state.drafts[profileId]; if (!previous) return;
    const retainedByPending = this.state.pending.some(item => item.command.profile_id === profileId && item.files?.some(file => file.id === id));
    const fileProgress = retainedByPending ? this.state.fileProgress
      : Object.fromEntries(Object.entries(this.state.fileProgress).filter(([fileId]) => fileId !== id));
    this.publish({ ...this.state, drafts: { ...this.state.drafts, [profileId]: { ...previous,
      revision: previous.revision + 1, files: previous.files?.filter(file => file.id !== id),
      restored_command_id: undefined } }, fileProgress });
    if(!this.needed(profileId,id)){
      const cancelled = new BetaApiError('selection_removed', '附件已从草稿移除，尚未开始的准备已取消');
      this.preparationQueue.cancel(id, cancelled);
      this.uploadQueue.cancel(id, cancelled);
      this.fileCancellation.get(id)?.abort();this.fileCancellation.delete(id);this.sourceHandles.delete(id);
    }
    // A frozen pending submission may still need these bytes. Removing a next
    // draft selection never deletes the Core original or its browser source.
  }

  private async prepareSource(profileId: string, file: DraftFile): Promise<void> {
    this.selected(profileId,file.id);const work=this.fileWork(profileId,file);
    let sha:string;
    if(hasNativeAttachmentSources(this.sources)){
      const verified=await this.sources.verifySource(file.source_key,work);
      if(verified.size!==file.byte_length)throw new BetaApiError('source_mismatch','原件长度与草稿不一致，请重新选择原文件');sha=verified.sha256;
    }else{
      await this.sources.resume?.(file.source_key);this.selected(profileId,file.id);
      const source=await this.sources.get(file.source_key);this.selected(profileId,file.id);
      if(!source)throw new BetaApiError('source_missing','本机暂存源未找到，请重新选择原文件；不会跳过此项提交');
      if(source.size!==file.byte_length)throw new BetaApiError('source_mismatch','原件长度与草稿不一致，请重新选择原文件');
      sha=await hashFileSource(source,work.cancelled,completed=>work.progress('reading_source',completed,source.size));
    }
    this.selected(profileId,file.id);
    if (file.original && file.original.sha256 !== sha) throw new BetaApiError('source_mismatch', '重新选择的文件与原件 hash 不同，原提交保持不变');
    const original: BetaOriginal = { original_id: file.id, sha256: sha, byte_length: file.byte_length, file_name: file.file_name, media_type: file.media_type };
    const prepared: DraftFile = { ...file, original, state: 'uploading', message: undefined };
    this.patchFile(profileId, file.id, prepared, true);
    if (durable(this.storage)) { await this.requiredCommit(); this.active(); }
    if (this.needed(profileId, file.id)) void this.ensureUploaded(profileId, prepared).catch(() => {});
  }

  private async resumeDraftFile(profileId: string, file: DraftFile): Promise<void> {
    try {
      if (!file.original) {
        const source=this.sourceHandles.get(file.id);
        if(source)await this.copyAndPrepare(profileId,file,source);
        else await this.prepareSource(profileId,file);
      }
      else await this.ensureUploaded(profileId, file);
    } catch (error) {
      if (!this.disposed) this.patchFile(profileId, file.id, { state: errorCode(error) === 'source_missing' ? 'source_missing' : 'failed', message: errorMessage(error) });
    }
  }

  async resumeFile(profileId: string, id: string): Promise<void> {
    this.active();
    const file = this.state.drafts[profileId]?.files?.find(item => item.id === id);
    if (!file) throw new BetaApiError('source_missing', '当前草稿中找不到该原件');
    await this.resumeDraftFile(profileId, file);
  }

  async resumeFiles(profileId: string): Promise<void> {
    const files = this.state.drafts[profileId]?.files ?? [];
    await Promise.all(files.map(file => this.disposed ? Promise.resolve() : this.resumeDraftFile(profileId, file)));
  }

  private copyAndPrepare(profileId:string,file:DraftFile,source:AttachmentSelection):Promise<void>{
    const existing=this.preparations.get(file.id);if(existing)return existing;
    const operation=this.withAutomaticUploadRetry(profileId,file.id,'preparing','preparation',()=>this.preparationQueue.enqueue(file.id,async()=>{
        this.selected(profileId,file.id);
        const work=this.fileWork(profileId,file);
        if(isNativeAttachment(source)){
          if(!hasNativeAttachmentSources(this.sources))throw new BetaApiError('unsupported_file_source','当前环境不能读取系统文件，请通过附件重新选择');
          await this.sources.importFile(file.source_key,source,work);
        }else if(isSharedHandoffAttachment(source)){
          if(!hasNativeAttachmentSources(this.sources)||!this.sources.importSharedHandoff)throw new BetaApiError('unsupported_file_source','当前环境不能读取系统分享来源；分享内容仍保留，可以重试');
          await this.sources.importSharedHandoff(file.source_key,source,work);
        }else await this.sources.put(file.source_key,source,work);
        this.selected(profileId,file.id);await this.prepareSource(profileId,file);
      }));
    const tracked=operation.then(()=>{this.sourceHandles.delete(file.id);}).finally(()=>{
      if(this.preparations.get(file.id)===tracked)this.preparations.delete(file.id);
    });
    this.preparations.set(file.id,tracked);
    return tracked;
  }

  private async withAutomaticUploadRetry<T>(profileId:string,id:string,busyState:'preparing'|'uploading',queueStage:AttachmentQueueStage,action:()=>Promise<T>):Promise<T>{
    for(let retry=0;;retry++){
      this.selected(profileId,id);
      try{return await action();}
      catch(error){
        if(retry>=AUTOMATIC_UPLOAD_RETRY_DELAYS_MS.length||!retryableUploadError(error))throw error;
        const delay=AUTOMATIC_UPLOAD_RETRY_DELAYS_MS[retry];
        this.patchFile(profileId,id,{state:busyState,message:`暂存遇到暂时错误，${retry+1}/${AUTOMATIC_UPLOAD_RETRY_DELAYS_MS.length} 次自动重试将在 ${delay} 毫秒后进行`});
        this.retryWaitProgress(profileId,id,queueStage,retry+1,delay);
        await this.uploadRetryDelay(delay);
      }
    }
  }

  async reselectFile(profileId: string, id: string, source: AttachmentSelection): Promise<void> {
    this.active(); const draft = this.state.drafts[profileId]; const file = draft?.files?.find(item => item.id === id);
    if (!draft || !file) throw new BetaApiError('source_missing', '当前草稿中找不到该原件');
    if (source.size !== file.byte_length) throw new BetaApiError('source_mismatch', '重新选择的文件长度不同，原提交保持不变');
    if(!isNativeAttachment(source)&&!isSharedHandoffAttachment(source)){const sha=await hashFileSource(source,()=>this.disposed);this.active();if(file.original&&sha!==file.original.sha256)throw new BetaApiError('source_mismatch','重新选择的文件与原件 hash 不同，原提交保持不变');}
    this.sourceHandles.set(file.id,source);
    const current = this.state.drafts[profileId];
    try {
      this.publish({ ...this.state, drafts: { ...this.state.drafts, [profileId]: { ...current, revision: current.revision + 1,
        files: current.files?.map(item => item.id === id ? { ...item, state: 'preparing' as const, message: undefined } : item),
        restored_command_id: undefined } } }, true);
      if (durable(this.storage)) { await this.requiredCommit(); this.active(); }
      await this.copyAndPrepare(profileId,file,source);
    }
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
    const operation = this.withAutomaticUploadRetry(
      profileId,file.id,'uploading','upload',()=>this.uploadQueue.enqueue(file.id,()=>this.uploadFile(profileId,file)),
    ).catch(error => {
      if (!this.disposed) this.patchFile(profileId, file.id, { state: errorCode(error) === 'source_missing' ? 'source_missing' : 'failed', message: errorMessage(error) });
      throw error;
    });
    this.uploads.set(file.stage_id, operation);
    void operation.finally(() => { if (this.uploads.get(file.stage_id) === operation) this.uploads.delete(file.stage_id); }).catch(() => {});
    return operation;
  }

  private async uploadFile(profileId: string, file: DraftFile): Promise<BetaStage> {
    this.active();
    const work=this.fileWork(profileId,file);
    if (durable(this.storage)) { await this.requiredCommit(); this.active(); }
    if (!this.needed(profileId, file.id)) throw new BetaApiError('selection_removed', '此草稿项已移除，其暂存仍保留');
    const api = this.client.originals; if (!api || !file.original) throw new BetaApiError('unsupported_capability', '原件暂存尚未就绪');
    const original = file.original;
    if(hasNativeAttachmentSources(this.sources)){
      const result=await this.sources.stageLocalSource(file.source_key,{stage_id:file.stage_id,original_id:original.original_id,profile_id:profileId,expected_sha256:original.sha256,byte_length:original.byte_length,file_name:original.file_name,media_type:original.media_type},work),stage=this.bindStage(profileId,file,result.stage);
      this.selected(profileId,file.id);if(stage.state!=='verified')throw new BetaApiError('original_not_ready','附件尚未校验完成');
      this.patchFile(profileId,file.id,{state:'verified',next_offset:file.byte_length,message:result.cleanupConfirmed?undefined:'附件已就绪，本机临时副本清理待确认'});
      return stage;
    }
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
      if (source.size !== file.byte_length || await hashFileSource(source,work.cancelled,completed=>work.progress('reading_source',completed,source.size)) !== original.sha256) throw new BetaApiError('source_mismatch', '本机源与固定原件 hash 不同，尚未提交记录');
      work.progress('staging',stage.next_offset,file.byte_length);
      while (stage.next_offset < file.byte_length) {
        this.selected(profileId,file.id); const offset = stage.next_offset;
        const bytes = await readFileSource(source, offset, Math.min(ORIGINAL_CHUNK_BYTES, file.byte_length - offset)); this.selected(profileId,file.id);
        if (!bytes.length) throw new BetaApiError('source_incomplete', '原件源读取中断，暂存偏移已保留');
        stage = this.bindStage(profileId, file, await api.write(profileId, file.stage_id, offset, bytes)); this.active();
        if (stage.next_offset < offset + bytes.length) throw new BetaApiError('original_no_progress', '原件暂存未推进，偏移已保留，可重试');
        this.patchFile(profileId, file.id, { state: 'uploading', next_offset: stage.next_offset });
        work.progress('staging',stage.next_offset,file.byte_length);
      }
    }
    if (stage.state !== 'verified') { this.selected(profileId,file.id);work.progress('verifying_stage',null,file.byte_length); stage = this.bindStage(profileId, file, await api.verify(profileId, file.stage_id)); this.active(); }
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
    const pendingForProfile = this.state.pending.find(entry => entry.command.profile_id === profileId && entry.state !== 'committed');
    const restoredPending = draft?.restored_command_id
      ? this.state.pending.find(entry => entry.command.profile_id === profileId
        && entry.command.command_id === draft.restored_command_id
        && entry.state !== 'committed')
      : undefined;
    if (restoredPending) return this.retry(restoredPending.command.command_id);
    if (!draft?.text.trim() && !draft?.files?.length) return pendingForProfile ? this.retry(pendingForProfile.command.command_id) : null;
    const previous = this.state.pending.find(entry => entry.command.profile_id === profileId
      && entry.draft_revision === draft.revision && entry.state !== 'committed');
    if (previous) return this.retry(previous.command.command_id);
    const files = draft.files?.map(file => ({ ...file, original: { ...file.original! } })) ?? [];
    const commandText = draft.text.trim();
    const preserveEditableText = draft.text !== commandText
      && new TextEncoder().encode(draft.text).byteLength <= MAX_CAPTURE_TEXT_BYTES;
    const command = freezeCommand({ command_id: this.uuid(), event_id: this.uuid(), profile_id: profileId,
      occurred_at_ms: this.clock(), text: commandText, tags: [...(draft.tags ?? [])], ...(files.length ? { originals: files.map(file => ({ ...file.original! })) } : {}) });
    const pending: PendingCapture = {
      command, draft_revision: draft.revision, state: 'pending',
      ...(preserveEditableText ? { editable_text: draft.text } : {}),
      ...(files.length ? { files } : {}),
      capture_attempted: false,
    };
    const nextDraft = { text: '', revision: draft.revision + 1, tags: [], files: [] };
    this.publish({
      ...this.state,
      drafts: { ...this.state.drafts, [profileId]: nextDraft },
      pending: [...this.state.pending, pending],
    }, true);
    if (durable(this.storage)) {
      try { await this.requiredCommit(); }
      catch (error) {
        if (!this.disposed) {
          const latest = this.state.drafts[profileId];
          const unchanged = latest?.revision === nextDraft.revision
            && !latest.text
            && !latest.tags?.length
            && !latest.files?.length;
          this.publish({
            ...this.state,
            ...(unchanged ? { drafts: { ...this.state.drafts, [profileId]: draft } } : {}),
            pending: this.state.pending.map(entry => entry.command.command_id === command.command_id
              ? { ...entry, state: 'failed' as const, message: errorMessage(error), error_code: errorCode(error) }
              : entry),
          });
        }
        throw error;
      }
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
  private restoreEditableDraftFromPending(pending: PendingCapture): void {
    if (this.disposed) return;
    const profileId = pending.command.profile_id;
    const current = this.state.drafts[profileId];
    if (!current || current.revision !== pending.draft_revision + 1
      || current.text.length || current.tags?.length || current.files?.length) return;
    const files = pending.files?.map(file => ({
      ...file,
      ...(file.original ? { original: { ...file.original } } : {}),
    }));
    this.publish({
      ...this.state,
      drafts: {
        ...this.state.drafts,
        [profileId]: {
          text: pending.editable_text ?? pending.command.text,
          revision: current.revision + 1,
          tags: [...pending.command.tags],
          files,
          restored_command_id: pending.command.command_id,
        },
      },
    });
  }
  private commit(pending: PendingCapture, value: unknown): BetaReceipt {
    const receipt = validateReceipt(value, pending.command);
    if (this.disposed) return receipt;
    const profile = pending.command.profile_id;
    const draft = this.state.drafts[profile];
    let drafts = this.state.drafts;
    if (draft?.restored_command_id === pending.command.command_id
      || draft?.revision === pending.draft_revision) {
      drafts = { ...drafts, [profile]: { text: '', revision: draft.revision + 1, tags: [], files: [] } };
    } else if (draft && pending.files?.length) {
      // The successful command owns only the attachment identities it froze.
      // A later text/tag edit inherits the old file list, so remove exactly
      // those submitted files while preserving whatever the user added since.
      const submitted = new Set(pending.files.map(file => file.id));
      const files = draft.files?.filter(file => !submitted.has(file.id));
      if (files && files.length !== (draft.files?.length ?? 0)) {
        drafts = { ...drafts, [profile]: { ...draft, revision: draft.revision + 1, files } };
      }
    }
    this.publish({ ...this.state, drafts,
      pending: this.state.pending.filter(entry => entry.command.command_id !== pending.command.command_id),
      confirmed: [...this.state.confirmed, { receipt, draft_revision: pending.draft_revision }].slice(-8) });
    return receipt;
  }

  private async perform(pending: PendingCapture, reconcileFirst: boolean): Promise<BetaReceipt | null> {
    const stillPending = () => this.state.pending.some(entry => entry.command.command_id === pending.command.command_id);
    if (!stillPending()) return null;
    if (durable(this.storage)) {
      try { await this.requiredCommit(); }
      catch (error) {
        if (!this.disposed) {
          this.updatePending(pending.command.command_id, { state: 'failed', message: errorMessage(error), error_code: errorCode(error) });
          this.restoreEditableDraftFromPending(pending);
        }
        return null;
      }
      if (this.disposed || !stillPending()) return null;
    }
    if (reconcileFirst) {
      try {
        const receipt = await this.client.receipt(pending.command.profile_id, pending.command.command_id);
        if (receipt) return this.commit(pending, receipt);
        if (!stillPending()) return null;
      } catch (error) {
        if (!this.disposed) {
          this.updatePending(pending.command.command_id, { state: 'unknown', message: errorMessage(error), error_code: errorCode(error) });
          this.restoreEditableDraftFromPending(pending);
        }
        return null;
      }
    }
    if (this.disposed) return null;
    this.updatePending(pending.command.command_id, { state: 'pending', message: undefined, error_code: undefined });
    let captureAttempted = false;
    try {
      await Promise.all((pending.files ?? []).map(file => this.ensureUploaded(pending.command.profile_id, file)));
      if (this.disposed || !stillPending()) return null;
      const next = { ...this.state, pending: this.state.pending.map(item => item.command.command_id === pending.command.command_id ? { ...item, capture_attempted: true } : item) };
      this.publish(next, true);
      if (durable(this.storage)) { await this.requiredCommit(); if (this.disposed || !stillPending()) return null; }
      captureAttempted = true;
      return this.commit(pending, await this.client.capture(pending.command));
    }
    catch (error) {
      if (!this.disposed) {
        const requestMayHaveReachedService = pending.capture_attempted === true || captureAttempted;
        this.updatePending(pending.command.command_id, {
          state: requestMayHaveReachedService ? 'unknown' : 'failed',
          capture_attempted: requestMayHaveReachedService,
          message: errorMessage(error), error_code: errorCode(error),
        });
        this.restoreEditableDraftFromPending(pending);
      }
      return null;
    }
  }
}
