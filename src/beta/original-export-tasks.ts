import { betaUuid } from './initialization';
import { exportOriginalDownload } from './original-download';
import { errorMessage } from './drafts';
import type { BetaClient } from './client';
import type { BetaOriginal } from './original-types';
import type { BetaOriginalExportHistoryEntry } from './original-export';

interface ExportIdentity {
  requestId: string;
  profileId: string;
  originalId: string;
  sha256: string;
  fileName: string;
  byteLength: number;
}

export type OriginalExportTask = ExportIdentity & (
  | { phase: 'running'; statusSource: 'request' | 'history'; cancelPending: boolean; message: string }
  | {
      phase: 'succeeded' | 'cancelled';
      statusSource: 'history' | 'receipt';
      failureCode: string | null;
      partialOutput: boolean;
      message: string;
    }
  | {
      phase: 'failed';
      statusSource: 'history';
      failureCode: string | null;
      partialOutput: boolean;
      message: string;
    }
  | {
      phase: 'failed';
      statusSource: 'request_error';
      failureCode: null;
      partialOutput: null;
      message: string;
    }
  | {
      phase: 'interrupted';
      statusSource: 'history';
      failureCode: string | null;
      partialOutput: boolean;
      message: string;
    }
);

export type OriginalExportHistoryState =
  | { phase: 'idle' | 'loading' | 'ready' | 'unavailable' }
  | { phase: 'failed'; message: string };

const RETAINED_EXPORT_RESULTS = 32;
const HISTORY_REFRESH_INTERVAL_MS = 1000;

function historyTask(entry: BetaOriginalExportHistoryEntry): OriginalExportTask {
  const identity: ExportIdentity = {
    requestId: entry.request_id,
    profileId: entry.profile_id,
    originalId: entry.original_id,
    sha256: entry.sha256,
    fileName: entry.file_name,
    byteLength: entry.byte_length,
  };

  switch (entry.phase) {
    case 'preparing':
      return { ...identity, phase: 'running', statusSource: 'history', cancelPending: false, message: '正在准备导出…' };
    case 'awaiting_destination':
      return { ...identity, phase: 'running', statusSource: 'history', cancelPending: false, message: '正在等待选择保存位置…' };
    case 'writing':
      return { ...identity, phase: 'running', statusSource: 'history', cancelPending: false, message: '正在写入原件…' };
    case 'verifying':
      return { ...identity, phase: 'running', statusSource: 'history', cancelPending: false, message: '正在校验保存结果…' };
    case 'succeeded':
      return {
        ...identity, phase: 'succeeded', statusSource: 'history', failureCode: null,
        partialOutput: entry.partial_output, message: '原件已导出并完成校验',
      };
    case 'cancelled':
      return {
        ...identity, phase: 'cancelled', statusSource: 'history', failureCode: entry.failure_code,
        partialOutput: entry.partial_output,
        message: entry.partial_output
          ? '导出已取消，所选位置可能保留未完成的新文档，请检查后清理'
          : '导出已取消，原件保留',
      };
    case 'failed':
      return {
        ...identity, phase: 'failed', statusSource: 'history', failureCode: entry.failure_code,
        partialOutput: entry.partial_output,
        message: entry.failure_code
          ? '导出失败（' + entry.failure_code + '），原件保留'
          : '导出失败，原件保留',
      };
    case 'interrupted':
      return {
        ...identity, phase: 'interrupted', statusSource: 'history', failureCode: entry.failure_code,
        partialOutput: entry.partial_output,
        message: '上次导出未确认，所选位置可能留有空/未完成文档，原件保留',
      };
    default: {
      const unreachable: never = entry.phase;
      return unreachable;
    }
  }
}

function isTerminal(task: OriginalExportTask): boolean {
  return task.phase !== 'running';
}

function isConfirmedTerminal(task: OriginalExportTask): boolean {
  return task.phase !== 'running' && (task.statusSource === 'history' || task.statusSource === 'receipt');
}

interface Observation {
  timer?: ReturnType<typeof setTimeout>;
}

/** Native owns the picker and stream. This owner keeps a bounded UI snapshot,
 * restores it from Native's journal, and observes recovered active work only
 * while its Beta view is visible.
 * Hiding the view clears observation timers; it never cancels Native work. */
export class OriginalExportTasks {
  private tasks: readonly OriginalExportTask[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly taskRevisions = new Map<string, number>();
  private readonly historyStates = new Map<string, OriginalExportHistoryState>();
  private readonly historyReads = new Map<string, Promise<void>>();
  private observation: Observation | undefined;

  constructor(private readonly client: BetaClient) {}

  snapshot = () => this.tasks;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  historyStatus(profileId: string): OriginalExportHistoryState {
    return this.historyStates.get(profileId) ?? { phase: 'idle' };
  }

  private emit(): void {
    // The task list is the existing external-store snapshot. Replace its
    // reference when history-only state changes so subscribers observe it.
    this.tasks = [...this.tasks];
    this.listeners.forEach(listener => listener());
  }

  private setHistoryStatus(profileId: string, status: OriginalExportHistoryState): void {
    this.historyStates.set(profileId, status);
    this.emit();
  }

  private replace(task: OriginalExportTask): void {
    const next = [...this.tasks.filter(item => item.requestId !== task.requestId), task];
    const retained = new Set(next.filter(item => isTerminal(item)).slice(-RETAINED_EXPORT_RESULTS).map(item => item.requestId));
    this.tasks = next.filter(item => item.phase === 'running' || retained.has(item.requestId));
    this.taskRevisions.set(task.requestId, (this.taskRevisions.get(task.requestId) ?? 0) + 1);
    const kept = new Set(this.tasks.map(item => item.requestId));
    for (const requestId of this.taskRevisions.keys()) {
      if (!kept.has(requestId)) this.taskRevisions.delete(requestId);
    }
    this.emit();
  }

  private readHistory(profileId: string, observation?: Observation): Promise<void> {
    const existing = this.historyReads.get(profileId);
    if (existing) return existing;

    const read = this.performHistoryRead(profileId, observation);
    this.historyReads.set(profileId, read);
    void read.finally(() => {
      if (this.historyReads.get(profileId) === read) this.historyReads.delete(profileId);
    }).catch(() => {});
    return read;
  }

  private async performHistoryRead(profileId: string, observation?: Observation): Promise<void> {
    const readHistory = this.client.originalExports?.history;
    if (!readHistory) {
      if (!observation || this.observation === observation) {
        this.setHistoryStatus(profileId, { phase: 'unavailable' });
      }
      return;
    }

    if (!observation) this.setHistoryStatus(profileId, { phase: 'loading' });
    const revisionsAtStart = new Map(
      this.tasks.filter(task => task.profileId === profileId)
        .map(task => [task.requestId, this.taskRevisions.get(task.requestId) ?? 0]),
    );

    try {
      const entries = await readHistory.call(this.client.originalExports, profileId);
      if (observation && this.observation !== observation) return;
      if (!Array.isArray(entries) || entries.some(entry => !entry || entry.profile_id !== profileId)) {
        throw new Error('原生导出历史与当前档案不一致');
      }

      for (const entry of entries) {
        const current = this.tasks.find(task => task.requestId === entry.request_id);
        const revisionAtStart = revisionsAtStart.get(entry.request_id);
        if (current) {
          // A read started before a new local task, task update, or terminal
          // result cannot roll that newer state back.
          if (revisionAtStart === undefined
            || this.taskRevisions.get(entry.request_id) !== revisionAtStart
            || isConfirmedTerminal(current)) continue;
        } else if (revisionAtStart !== undefined) {
          continue;
        }
        let restored = historyTask(entry);
        if (current?.phase === 'running' && current.cancelPending && restored.phase === 'running') {
          restored = { ...restored, cancelPending: true, message: current.message };
        }
        this.replace(restored);
      }

      if (!observation || this.observation === observation) {
        this.setHistoryStatus(profileId, { phase: 'ready' });
      }
    } catch (failure) {
      if (!observation || this.observation === observation) {
        this.setHistoryStatus(profileId, {
          phase: 'failed',
          message: '导出历史读取失败：' + errorMessage(failure),
        });
      }
    }
  }

  /** Startup recovery is read-only. Native remains the authority for outcomes. */
  restoreHistory(profileId: string): Promise<void> {
    return this.readHistory(profileId);
  }

  /** Explicit read retry used by the task center. */
  refreshHistory(profileId: string): Promise<void> {
    return this.readHistory(profileId);
  }

  /** Serially observe Native-owned history while the page is visible.
   * Request-owned tasks rely on their save promise and do not need polling. */
  observe(profileId: string): () => void {
    this.stopObserving();
    const observation: Observation = {};
    this.observation = observation;

    const read = async () => {
      if (this.observation !== observation) return;
      await this.readHistory(profileId, observation);
      if (this.observation !== observation) return;
      if (this.tasks.some(task => task.profileId === profileId
        && task.phase === 'running' && task.statusSource === 'history')) {
        observation.timer = setTimeout(() => { void read(); }, HISTORY_REFRESH_INTERVAL_MS);
      }
    };
    void read();

    return () => {
      if (this.observation === observation) this.stopObserving();
    };
  }

  private stopObserving(): void {
    if (!this.observation) return;
    clearTimeout(this.observation.timer);
    this.observation = undefined;
  }

  start(profileId: string, original: BetaOriginal): string {
    return this.startRequest(profileId, original, true);
  }

  private startRequest(profileId: string, original: BetaOriginal, reuseExisting: boolean): string {
    const existing = reuseExisting && this.tasks.find(task => task.profileId === profileId
      && task.originalId === original.original_id && task.sha256 === original.sha256 && task.phase === 'running');
    if (existing) return existing.requestId;
    if (!this.client.originalExports) throw new Error('当前连接未提供原生导出');
    const task: OriginalExportTask = {
      requestId: betaUuid(),
      profileId,
      originalId: original.original_id,
      sha256: original.sha256,
      fileName: original.file_name,
      byteLength: original.byte_length,
      phase: 'running',
      statusSource: 'request',
      cancelPending: false,
      message: '正在流式导出并校验原件…',
    };
    this.replace(task);
    void this.perform(task, { ...original });
    return task.requestId;
  }

  reselectInterrupted(requestId: string): string | undefined {
    const task = this.tasks.find(item => item.requestId === requestId && item.phase === 'interrupted');
    if (!task) return undefined;
    return this.startRequest(task.profileId, {
      original_id: task.originalId,
      sha256: task.sha256,
      byte_length: task.byteLength,
      file_name: task.fileName,
      media_type: 'application/octet-stream',
    }, false);
  }

  private async perform(task: Extract<OriginalExportTask, { phase: 'running' }>, original: BetaOriginal): Promise<void> {
    try {
      const result = await exportOriginalDownload(this.client, task.profileId, original, task.requestId);
      if (result.kind !== 'native') throw new Error('原生导出未返回可确认的回执');
      const current = this.tasks.find(item => item.requestId === task.requestId);
      if (current && isConfirmedTerminal(current)) return;
      const value = result.result;
      this.replace({
        ...task,
        phase: value.cancelled ? 'cancelled' : 'succeeded',
        statusSource: 'receipt',
        failureCode: null,
        partialOutput: value.cancelled ? value.partial_output === true : false,
        message: value.cancelled
          ? value.partial_output
            ? '导出已取消，所选位置可能保留未完成的新文档，请检查后清理'
            : '导出已取消，原件保留'
          : '原件已导出并完成校验',
      });
    } catch (failure) {
      const current = this.tasks.find(item => item.requestId === task.requestId);
      if (!current || current.statusSource === 'history' || isConfirmedTerminal(current)) return;
      if (current.phase === 'running' && current.cancelPending) {
        this.replace({
          ...current,
          message: '取消已受理，导出结果仍待原生确认；所选位置可能留有空/未完成文档，原件保留：'
            + errorMessage(failure),
        });
        return;
      }
      this.replace({
        ...current,
        phase: 'failed',
        statusSource: 'request_error',
        failureCode: null,
        partialOutput: null,
        message: '导出结果未确认，请查证所选位置；原件保留：' + errorMessage(failure),
      });
    }
  }

  async cancel(requestId: string): Promise<void> {
    const task = this.tasks.find(item => item.requestId === requestId);
    if (!task || task.phase !== 'running' || task.cancelPending) return;
    this.replace({ ...task, cancelPending: true, message: '正在取消导出…' });
    try {
      const accepted = await this.client.originalExports!.cancel(requestId);
      const current = this.tasks.find(item => item.requestId === requestId);
      if (current?.phase === 'running') {
        this.replace({
          ...current,
          cancelPending: accepted,
          message: accepted ? '正在取消导出…' : '导出已进入完成阶段，正在等待确认',
        });
      }
    } catch (failure) {
      const current = this.tasks.find(item => item.requestId === requestId);
      if (current?.phase === 'running') {
        this.replace({
          ...current,
          cancelPending: false,
          message: '取消尚未确认：' + errorMessage(failure) + '；原导出仍待确认',
        });
      }
    }
  }
}

const clients = new WeakMap<BetaClient, OriginalExportTasks>();
export function originalExportTasks(client: BetaClient): OriginalExportTasks {
  let tasks = clients.get(client);
  if (!tasks) {
    tasks = new OriginalExportTasks(client);
    clients.set(client, tasks);
  }
  return tasks;
}
