import { BetaApiError, validateReceipt, type BetaClient, type BetaCommand, type BetaReceipt } from './client';
import { betaUuid } from './initialization';

interface Draft { text: string; revision: number }
export interface PendingCapture {
  command: BetaCommand; draft_revision: number;
  state: 'pending' | 'unknown' | 'failed' | 'committed';
  message?: string; error_code?: string; receipt?: BetaReceipt;
}
interface Confirmation { receipt: BetaReceipt; draft_revision: number }
interface PersistedState { version: 1; drafts: Record<string, Draft>; pending: PendingCapture[]; confirmed: Confirmation[] }
export interface DraftSnapshot extends PersistedState { persistenceError: string | null }
type DraftStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return typeof error === 'string' ? error : '服务暂时不可用，请查证后重试';
}
function errorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'unavailable';
}
function load(raw: string | null): PersistedState {
  if (raw === null) return { version: 1, drafts: {}, pending: [], confirmed: [] };
  const value = JSON.parse(raw) as PersistedState;
  if (value.version !== 1 || !value.drafts || typeof value.drafts !== 'object' || !Array.isArray(value.pending)) throw new Error('Invalid draft cache');
  for (const draft of Object.values(value.drafts)) if (typeof draft.text !== 'string' || !Number.isSafeInteger(draft.revision) || draft.revision < 0) throw new Error('Invalid draft');
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
    Object.freeze(command.tags); Object.freeze(command);
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

  constructor(private readonly client: BetaClient, deviceId: string, private readonly storage: DraftStorage,
    private readonly uuid: () => string = betaUuid, private readonly clock: () => number = Date.now) {
    this.key = `exomind:beta:drafts:${deviceId}`;
    try { this.state = { ...load(storage.getItem(this.key)), persistenceError: null }; }
    catch {
      this.restoreBlocked = true;
      this.state = { version: 1, drafts: {}, pending: [], confirmed: [], persistenceError: '草稿缓存无法读取，已停止写入以保留原缓存' };
    }
  }

  snapshot = (): DraftSnapshot => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  dispose(): void { this.disposed = true; this.listeners.clear(); }
  private publish(next: DraftSnapshot, required = false): void {
    if (this.disposed) return;
    if (this.restoreBlocked) throw new BetaApiError('draft_cache_unavailable', '请先处理无法读取的草稿缓存');
    const { version, drafts, pending, confirmed } = next;
    try {
      this.storage.setItem(this.key, JSON.stringify({ version, drafts, pending, confirmed }));
      this.state = { ...next, persistenceError: null };
    } catch {
      if (required) throw new BetaApiError('draft_cache_unavailable', '未能暂存本次提交，尚未向服务发送');
      this.state = { ...next, persistenceError: '草稿缓存写入失败，请保留此窗口；已确认保存的记录不受影响' };
    }
    this.listeners.forEach(listener => listener());
  }

  setDraft(profileId: string, text: string): void {
    const previous = this.state.drafts[profileId] ?? { text: '', revision: 0 };
    this.publish({ ...this.state, drafts: { ...this.state.drafts, [profileId]: { text, revision: previous.revision + 1 } } });
  }

  async submit(profileId: string): Promise<BetaReceipt | null> {
    if (this.disposed) throw new BetaApiError('inactive_session', '当前记录窗口已关闭');
    const draft = this.state.drafts[profileId];
    if (!draft?.text.trim()) return null;
    const previous = this.state.pending.find(entry => entry.command.profile_id === profileId
      && entry.draft_revision === draft.revision && entry.state !== 'committed');
    if (previous) return this.retry(previous.command.command_id);
    const command: BetaCommand = Object.freeze({ command_id: this.uuid(), event_id: this.uuid(), profile_id: profileId,
      occurred_at_ms: this.clock(), text: draft.text, tags: Object.freeze([]) as unknown as string[] });
    const pending: PendingCapture = { command, draft_revision: draft.revision, state: 'pending' };
    this.publish({ ...this.state, pending: [...this.state.pending, pending] }, true);
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
      ? { ...this.state.drafts, [profile]: { text: '', revision: draft.revision + 1 } }
      : this.state.drafts;
    this.publish({ ...this.state, drafts,
      pending: this.state.pending.filter(entry => entry.command.command_id !== pending.command.command_id),
      confirmed: [...this.state.confirmed, { receipt, draft_revision: pending.draft_revision }].slice(-8) });
    return receipt;
  }

  private async perform(pending: PendingCapture, reconcileFirst: boolean): Promise<BetaReceipt | null> {
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
    try { return this.commit(pending, await this.client.capture(pending.command)); }
    catch (error) {
      if (!this.disposed) this.updatePending(pending.command.command_id, { state: 'unknown', message: errorMessage(error), error_code: errorCode(error) });
      return null;
    }
  }
}
