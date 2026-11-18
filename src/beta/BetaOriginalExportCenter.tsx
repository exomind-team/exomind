import { useSyncExternalStore } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import type { BetaClient } from './client';
import { originalExportTasks } from './original-export-tasks';

export function BetaOriginalExportCenter({ client, profileId }: { client: BetaClient; profileId: string }) {
  const owner = originalExportTasks(client);
  const all = useSyncExternalStore(owner.subscribe, owner.snapshot);
  const tasks = all.filter(task => task.profileId === profileId);
  if (!tasks.length) return null;
  const running = tasks.filter(task => task.phase === 'running').length;
  return <Dialog>
    <DialogTrigger asChild><Button variant="ghost" size="icon" aria-label="附件导出任务" title={running ? `${running} 项导出正在处理` : '附件导出任务'} className="relative"><Download size={16}/>{running > 0 && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-brand-accent"/>}</Button></DialogTrigger>
    <DialogContent className="max-h-[80dvh] overflow-y-auto"><DialogHeader><DialogTitle>附件导出任务</DialogTitle><DialogDescription>当前档案最近的本机任务。搜索、隐藏消息或切换页面不会取消已接受的导出；退出程序仍按原生任务生命周期处理。</DialogDescription></DialogHeader>
      {tasks.map(task => <div key={task.requestId} className="space-y-2 border-b border-border-card py-2"><p className="break-all text-sm font-medium">{task.fileName}</p><p role={task.phase === 'failed' ? 'alert' : 'status'} className={task.phase === 'failed' ? 'text-xs text-destructive' : 'text-xs text-secondary'}>{task.message}</p>{task.phase === 'running' && <Button variant="outline" size="sm" disabled={task.cancelPending} onClick={() => { void owner.cancel(task.requestId); }}>取消导出</Button>}</div>)}
    </DialogContent>
  </Dialog>;
}
