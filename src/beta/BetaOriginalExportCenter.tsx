import { Tooltip } from '@/components/ui/tooltip';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import type { BetaClient } from './client';
import { originalExportTasks, type OriginalExportTask } from './original-export-tasks';
import { useBetaViewActive } from './view-activity';

function taskPhaseLabel(task: OriginalExportTask): string {
  if (task.phase === 'running') return task.cancelPending ? '正在取消，等待确认' : '进行中';
  if (task.phase === 'succeeded') return '已完成';
  if (task.phase === 'cancelled') return '已取消';
  if (task.phase === 'failed') return task.statusSource === 'request_error' ? '结果待查证' : '失败';
  return '上次未确认';
}

export function BetaOriginalExportCenter({ client, profileId, visible = true }: { client: BetaClient; profileId: string; visible?: boolean }) {
  const owner = originalExportTasks(client);
  const all = useSyncExternalStore(owner.subscribe, owner.snapshot);
  const [open, setOpen] = useState(false);
  const viewActive = useBetaViewActive(visible);
  const tasks = all.filter(task => task.profileId === profileId);
  const running = tasks.filter(task => task.phase === 'running').length;
  const restoredActive = tasks.some(task => task.phase === 'running' && task.statusSource === 'history');
  const history = owner.historyStatus(profileId);
  const originalExports = client.originalExports;
  const hasHistoryReader = typeof originalExports?.history === 'function';
  const shouldObserve = viewActive && (open || restoredActive);

  useEffect(() => {
    if (!viewActive) return;
    void owner.restoreHistory(profileId);
  }, [owner, profileId, viewActive]);

  useEffect(() => {
    if (!shouldObserve) return;
    return owner.observe(profileId);
  }, [owner, profileId, shouldObserve]);

  useEffect(() => {
    if (!viewActive) setOpen(false);
  }, [viewActive]);

  if (!originalExports
    || (tasks.length === 0 && history.phase !== 'failed' && !open)) return null;

  return <Dialog open={open && viewActive} onOpenChange={next => { setOpen(next && viewActive); }}>
    <DialogTrigger asChild>
      <Tooltip content={history.phase === 'failed'
          ? '导出历史读取失败；打开任务中心后可重试'
          : running ? running + ' 项导出正在处理' : '附件导出任务'}><Button
        variant="ghost"
        size="icon"
        aria-label="附件导出任务"

        className="relative"
      >
        <Download size={16}/>
        {running > 0 && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-brand-accent"/>}
      </Button></Tooltip>
    </DialogTrigger>
    <DialogContent className="max-h-[80dvh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>附件导出任务</DialogTitle>
        <DialogDescription>
          本机保留最近32项结果。关闭面板不影响导出；隐藏页面只暂停状态刷新。
        </DialogDescription>
      </DialogHeader>

      {history.phase === 'loading' && <p role="status" className="text-xs text-secondary">正在读取原生导出历史…</p>}
      {history.phase === 'failed' && <div className="space-y-2">
        <p role="alert" className="text-xs text-destructive">{history.message}</p>
        <Button variant="outline" size="sm" onClick={() => { void owner.refreshHistory(profileId); }}>重试读取</Button>
      </div>}
      {history.phase === 'unavailable' && <p className="text-xs text-muted">当前连接未提供原生导出历史；本会话内任务仍保留。</p>}
      {history.phase === 'ready' && tasks.length === 0 && <p className="text-xs text-muted">暂无导出任务</p>}
      {tasks.map(task => <div key={task.requestId} className="space-y-2 border-b border-border-card py-2">
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 break-all text-sm font-medium">{task.fileName}</p>
          <span className="shrink-0 text-[11px] text-muted">{taskPhaseLabel(task)}</span>
        </div>
        <p
          role={task.phase === 'failed' ? 'alert' : 'status'}
          className={task.phase === 'failed' ? 'text-xs text-destructive' : 'text-xs text-secondary'}
        >
          {task.message}
        </p>
        {task.phase === 'running' && <Button
          variant="outline"
          size="sm"
          disabled={task.cancelPending}
          onClick={() => { void owner.cancel(task.requestId); }}
        >
          取消导出
        </Button>}
        {task.phase === 'interrupted' && <div className="space-y-1">
          <Button variant="outline" size="sm" onClick={() => { owner.reselectInterrupted(task.requestId); }}>
            重新选择保存位置
          </Button>
          <p className="text-[11px] text-muted">会新建导出请求；不会自动覆盖或删除上次目标。</p>
        </div>}
        {task.phase === 'failed' && task.statusSource === 'request_error' && hasHistoryReader
          && <Button variant="outline" size="sm" onClick={() => { void owner.refreshHistory(profileId); }}>
            查证原生状态
          </Button>}
      </div>)}
    </DialogContent>
  </Dialog>;
}
