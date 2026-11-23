import { useId, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { UserRangeSelection } from './user-range-export-client';
import {
  USER_RANGE_EXPORT_MAX_SELECTIONS,
  type UserRangeExportSnapshot,
  type UserRangeExportStateController,
  type UserRangeExportTask,
} from './user-range-export-state';

const PROGRESS_LABEL: Record<string, string> = {
  preparing: '正在准备',
  awaiting_destination: '等待选择保存位置',
  writing: '正在写入',
  verifying: '正在校验',
  cancelling: '等待取消结果',
  publishing: '正在确认本机文件',
};
const EXPORT_CONTROL_BUTTON_CLASS = 'min-h-8 [@media(pointer:coarse)]:min-h-11 touch-manipulation';

function shortId(value: string): string { return value.slice(0, 8); }
function selectionLabel(selection: UserRangeSelection): string {
  return selection.kind === 'event' ? `消息 ${shortId(selection.event_id)}` : `时间块 ${shortId(selection.block_id)}`;
}
function taskLabel(task: UserRangeExportTask): string {
  if (task.phase === 'unknown') return '结果未知，需核对';
  if (task.phase === 'saved') return '已保存并校验';
  if (task.phase === 'cancelled') return '已取消';
  if (task.phase === 'failed') return '未完成';
  if (task.phase === 'interrupted') return '保存中断';
  return PROGRESS_LABEL[task.phase] ?? '处理中';
}
function bytesLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
function unresolved(task: UserRangeExportTask | null): boolean {
  return !!task && (task.phase === 'unknown' || Object.prototype.hasOwnProperty.call(PROGRESS_LABEL, task.phase));
}

export function BetaUserRangeExportControls({
  owner,
  state,
  mode,
  onModeChange,
  profileNameFor = (profileId: string) => shortId(profileId),
}: {
  owner: UserRangeExportStateController;
  state: UserRangeExportSnapshot;
  mode: 'browse' | 'select-export';
  onModeChange: (mode: 'browse' | 'select-export') => void;
  profileNameFor?: (profileId: string) => string;
}) {
  const [confirmation, setConfirmation] = useState<'new' | 'unknown' | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const panelId = useId();
  if (!state.ready || !state.supported) return null;

  const task = state.task;
  const blocked = !state.storageReady || state.selections.length === 0 || unresolved(task);
  const canCancel = !!task && Object.prototype.hasOwnProperty.call(PROGRESS_LABEL, task.phase)
    && task.cancelAccepted !== true;
  const visibleSelections = state.selections.slice(0, 4);
  const result = task?.result ?? null;

  async function confirmAction(): Promise<void> {
    const action = confirmation;
    setConfirmation(null);
    if (action === 'unknown') await owner.confirmNewRequestAfterUnknown();
    else if (action === 'new') await owner.startExport();
  }

  return <section
    className="shrink-0 space-y-2 border-b border-border-page px-4 py-3"
    aria-label="选取内容导出"
    data-testid="beta-user-range-export-controls"
  >
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <Button type="button" variant={mode === 'select-export' ? 'secondary' : 'outline'} size="sm"
        className={EXPORT_CONTROL_BUTTON_CLASS + ' max-w-full shrink-0'}
        aria-expanded={mode === 'select-export'} aria-controls={panelId}
        onClick={() => { onModeChange(mode === 'select-export' ? 'browse' : 'select-export'); setConfirmation(null); setManageOpen(false); }}>
        {mode === 'select-export' ? '退出选择导出' : '选择并导出'} · 已选 {state.selections.length} 项
      </Button>
      {task && <p role="status" className="min-w-0 flex-1 text-xs text-secondary">{taskLabel(task)}</p>}
    </div>
    <div id={panelId} hidden={mode !== 'select-export'} className="space-y-2">
    {mode === 'select-export' && <p role="status" aria-live="polite" className="text-xs text-secondary">
      选择导出模式 · {profileNameFor(state.profile_id)} · 浏览周期变化或退出后保留已选内容。
    </p>}
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <div className="min-w-0 flex-1">
        <p className="text-xs text-secondary">
          每个档案最多 {USER_RANGE_EXPORT_MAX_SELECTIONS} 项；导出内容按档案分别保存。
        </p>
        <p className="text-xs text-muted">在消息或时间块的“更多操作”中选择要导出的内容。</p>
      </div>
      {state.selections.length > 4 && <Button type="button" size="sm" variant="ghost" className={EXPORT_CONTROL_BUTTON_CLASS} onClick={() => setManageOpen(true)}>
        管理全部 {state.selections.length} 项
      </Button>}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className={EXPORT_CONTROL_BUTTON_CLASS}
        disabled={state.selections.length === 0 || !state.storageReady}
        onClick={() => { void owner.resetSelections(); }}
      >清空</Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className={EXPORT_CONTROL_BUTTON_CLASS}
        disabled={blocked}
        onClick={() => setConfirmation('new')}
      >导出所选内容</Button>
    </div>

    {!state.storageReady && state.error && <p role="alert" className="text-xs text-destructive">{state.error}</p>}
    {state.storageReady && state.error && <p role="alert" className="text-xs text-destructive">{state.error}</p>}

    {state.selections.length > 0 && <ul className="flex flex-wrap gap-1.5" aria-label="已选导出内容">
      {visibleSelections.map(selection => {
        const label = selectionLabel(selection);
        return <li key={selection.kind === 'event' ? `event:${selection.event_id}` : `timeblock:${selection.block_id}`}
          className="flex min-w-0 max-w-full items-center gap-1 rounded-md border border-border-card bg-card px-2 py-1 text-xs text-secondary">
          <span className="truncate">{label}</span>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className={'h-8 w-8 min-h-8 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 ' + EXPORT_CONTROL_BUTTON_CLASS}
            aria-label={`从导出清单移除：${label}`}
            onClick={() => { void owner.removeSelection(selection); }}
          ><X aria-hidden="true" /></Button>
        </li>;
      })}
      {state.selections.length > visibleSelections.length && <li className="self-center text-xs text-muted">
        另有 {state.selections.length - visibleSelections.length} 项
      </li>}
    </ul>}

    {task && <div className="space-y-1 rounded-md border border-border-card bg-card px-3 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-xs font-medium text-strong">{taskLabel(task)} · 档案 {profileNameFor(task.profile_id)}</p>
      </div>
      {task.cancelAccepted === true && task.phase === 'unknown' && <p role="status" className="text-xs text-secondary">已请求取消，最终结果仍待确认。</p>}
      {task.message && !Object.prototype.hasOwnProperty.call(PROGRESS_LABEL, task.phase) && <p role={task.phase === 'failed' ? 'alert' : 'status'} className={task.phase === 'failed' ? 'text-xs text-destructive' : 'text-xs text-secondary'}>{task.message.split('Native').join('本机').split('request ID').join('导出编号')}</p>}
      {task.phase === 'unknown' && <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" className={EXPORT_CONTROL_BUTTON_CLASS} onClick={() => { void owner.refreshStatus(); }}>重新检查结果</Button>
        <Button type="button" size="sm" variant="outline" className={EXPORT_CONTROL_BUTTON_CLASS} onClick={() => setConfirmation('unknown')}>
          我已核对，另开导出
        </Button>
      </div>}
      {canCancel && <Button type="button" size="sm" variant="outline" className={EXPORT_CONTROL_BUTTON_CLASS} onClick={() => { void owner.requestCancel(); }}>取消此导出</Button>}
      {result && <div className="space-y-1 text-xs text-secondary">
        {result.phase === 'saved' && result.archive_byte_length !== null && result.archive_sha256 !== null && <>
          <p>文件已在本机保存 · {bytesLabel(result.archive_byte_length)}</p>
        </>}
        {result.phase === 'saved' ? <>
          <p>{result.content_complete ? '所选内容完整' : '部分内容未包含，请查看包内清单。'}</p>
          <p>本机原件：包含 {result.included_originals} 项，省略 {result.omitted_originals} 项。</p>
          {result.omitted_originals > 0 && <p className="text-muted">
            未包含的附件请查看包内清单。
          </p>}
        </> : !result.partial_output && <p>本次未生成可核对的导出包。</p>}
        {result.partial_output && <p>保存位置可能留有部分文件，请核对。</p>}
      </div>}
      <Button type="button" size="sm" variant="ghost" className={EXPORT_CONTROL_BUTTON_CLASS} aria-expanded={detailsOpen}
        onClick={() => setDetailsOpen(value => !value)}>{detailsOpen ? '收起校验详情' : '查看校验详情'}</Button>
      {detailsOpen && <div className="space-y-1 break-all text-xs text-secondary">
        <p>导出编号：<code>{task.request_id}</code></p>
        <p>档案编号：<code>{task.profile_id}</code></p>
        {result?.archive_sha256 && <p>SHA-256：<code>{result.archive_sha256}</code></p>}
        {result?.failure_code && <p>结果码：<code>{result.failure_code}</code></p>}
      </div>}
    </div>}

    <Dialog open={manageOpen} onOpenChange={setManageOpen}>
      <DialogContent className="max-h-[80dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>已选导出内容</DialogTitle>
          <DialogDescription>移除清单中的项目不会更改原记录或时间块。</DialogDescription>
        </DialogHeader>
        <ul className="space-y-1" aria-label="完整导出清单">
          {state.selections.map(selection => {
            const label = selectionLabel(selection);
            return <li key={selection.kind === 'event' ? `event:${selection.event_id}` : `timeblock:${selection.block_id}`}
              className="flex min-w-0 items-center gap-2 border-b border-border-card py-1">
              <span className="min-w-0 flex-1 break-all text-xs text-secondary">{label}</span>
            <Button type="button" size="sm" variant="ghost" className={EXPORT_CONTROL_BUTTON_CLASS} aria-label={`从导出清单移除：${label}`}
                onClick={() => { void owner.removeSelection(selection); }}>移除</Button>
            </li>;
          })}
        </ul>
        <DialogFooter>
          <Button type="button" variant="outline" className={EXPORT_CONTROL_BUTTON_CLASS} onClick={() => setManageOpen(false)}>完成</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={confirmation !== null} onOpenChange={open => { if (!open) setConfirmation(null); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{confirmation === 'unknown' ? '确认已核对后另开导出' : '确认导出所选内容'}</DialogTitle>
          <DialogDescription>
            保存包包含所选记录、时间块及本机可读的附件。缺失或超出大小限制的附件会记入清单。关闭面板或切换页面后，已发起的保存会继续。
          </DialogDescription>
        </DialogHeader>
        {confirmation === 'unknown' && task && <p className="break-all rounded-md border border-border-card bg-card p-3 text-xs text-secondary">
          上一次保存的结果仍未确认。请先检查保存位置，再决定是否重新选择位置导出。
        </p>}
        {confirmation === 'new' && <p className="text-xs text-secondary">
          将导出当前档案选中的 {state.selections.length} 项；原记录和文件保留。
        </p>}
        <DialogFooter>
          <Button type="button" variant="outline" className={EXPORT_CONTROL_BUTTON_CLASS} onClick={() => setConfirmation(null)}>返回</Button>
          <Button type="button" className={EXPORT_CONTROL_BUTTON_CLASS} onClick={() => { void confirmAction(); }}>
            {confirmation === 'unknown' ? '我已核对，另开导出' : '继续并选择保存位置'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </div>
  </section>;
}
