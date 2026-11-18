import { ATTACHMENT_PHASE_LABELS, type AttachmentProgress } from './attachment-progress';
import { Progress } from '@/components/ui/progress';

function bytes(value:number):string { return value<1024*1024?`${(value/1024).toFixed(1)} KiB`:`${(value/1024/1024).toFixed(1)} MiB`; }
export function BetaAttachmentProgress({name,progress,active,now}:{name:string;progress?:AttachmentProgress;active:boolean;now:number}) {
  if(!active)return null;
  const completed=progress?.completed,total=progress?.total??0,phaseElapsed=progress?Math.max(0,(now-progress.phaseStartedAt)/1000):0;
  const remaining=typeof completed==='number'&&completed>0&&completed<total&&phaseElapsed>=1?Math.ceil((total-completed)/completed*phaseElapsed):null;
  const elapsed=progress?Math.max(0,Math.floor((now-progress.startedAt)/1000)):0;
  return <div className="mt-1 space-y-1 text-[11px] text-secondary" role="status">
    <div className="flex flex-wrap gap-x-2"><span>{progress?ATTACHMENT_PHASE_LABELS[progress.phase]:'等待准备'}</span>{typeof completed==='number'&&<span>{bytes(completed)} / {bytes(total)}</span>}<span>已耗时 {elapsed}s</span></div>
    <Progress className="block h-1 w-full" aria-label={`附件准备进度 ${name}`} max={Math.max(1,total)} {...(typeof completed==='number'?{value:completed}:{})}/>
    <p>{remaining===null?'剩余时间待估算':`本阶段预计还需约 ${remaining}s`}{progress&&now-progress.updatedAt>=10000?' · 尚无新进度，可取消后重试':''}</p>
  </div>;
}
