import { betaUuid } from './initialization';
import { exportOriginalDownload } from './original-download';
import { errorMessage } from './drafts';
import type { BetaClient } from './client';
import type { BetaOriginal } from './original-types';

interface ExportIdentity { requestId: string; profileId: string; originalId: string; sha256: string; fileName: string }
export type OriginalExportTask = ExportIdentity & (
  | { phase: 'running'; cancelPending: boolean; message: string }
  | { phase: 'succeeded' | 'cancelled' | 'failed'; message: string }
);
const RETAINED_EXPORT_RESULTS = 32;

/** Native owns the picker/stream. This instance owns accepted task identities
 * and receipts for one client, independently of message/search/view lifetime.
 * It stores no bytes and polls nothing. Only an explicit cancel targets Native;
 * application shutdown and capability checks remain Native responsibilities. */
export class OriginalExportTasks {
  private tasks: readonly OriginalExportTask[] = [];
  private readonly listeners = new Set<() => void>();
  constructor(private readonly client: BetaClient) {}
  snapshot = () => this.tasks;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private replace(task: OriginalExportTask) {
    const next = [...this.tasks.filter(item => item.requestId !== task.requestId), task];
    const retained = new Set(next.filter(item => item.phase !== 'running').slice(-RETAINED_EXPORT_RESULTS).map(item => item.requestId));
    this.tasks = next.filter(item => item.phase === 'running' || retained.has(item.requestId));
    this.listeners.forEach(listener => listener());
  }
  start(profileId: string, original: BetaOriginal): string {
    const existing = this.tasks.find(task => task.profileId === profileId && task.originalId === original.original_id && task.sha256 === original.sha256 && task.phase === 'running');
    if (existing) return existing.requestId;
    if (!this.client.originalExports) throw new Error('当前连接未提供原生导出');
    const task: OriginalExportTask = { requestId: betaUuid(), profileId, originalId: original.original_id, sha256: original.sha256, fileName: original.file_name, phase: 'running', cancelPending: false, message: '正在流式导出并校验原件…' };
    this.replace(task); void this.perform(task, { ...original }); return task.requestId;
  }
  private async perform(task: OriginalExportTask, original: BetaOriginal) {
    try {
      const result = await exportOriginalDownload(this.client, task.profileId, original, task.requestId);
      if (result.kind !== 'native') throw new Error('原生导出未返回可确认的回执');
      const value = result.result;
      this.replace({ ...task, phase: value.cancelled ? 'cancelled' : 'succeeded', message: value.cancelled ? value.partial_output ? '导出已取消，所选位置可能保留未完成的新文档，请检查后清理' : '导出已取消' : '原件已导出并完成校验' });
    } catch (failure) { this.replace({ ...task, phase: 'failed', message: errorMessage(failure) }); }
  }
  async cancel(requestId: string): Promise<void> {
    const task = this.tasks.find(item => item.requestId === requestId);
    if (!task || task.phase !== 'running' || task.cancelPending) return;
    this.replace({ ...task, cancelPending: true, message: '正在取消导出…' });
    try {
      const accepted = await this.client.originalExports!.cancel(requestId);
      if (this.tasks.find(item => item.requestId === requestId)?.phase === 'running') this.replace({ ...task, cancelPending: accepted, message: accepted ? '正在取消导出…' : '导出已进入完成阶段，正在等待确认' });
    } catch (failure) {
      if (this.tasks.find(item => item.requestId === requestId)?.phase === 'running') this.replace({ ...task, cancelPending: false, message: `取消尚未确认：${errorMessage(failure)}；原导出仍待确认` });
    }
  }
}

const clients = new WeakMap<BetaClient, OriginalExportTasks>();
export function originalExportTasks(client: BetaClient): OriginalExportTasks {
  let tasks = clients.get(client);
  if (!tasks) { tasks = new OriginalExportTasks(client); clients.set(client, tasks); }
  return tasks;
}
