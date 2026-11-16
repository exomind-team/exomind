import { useEffect,useRef,useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Avatar,AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ChatMessageRowView } from '@/ui/app/components/ChatMessageRowView';
import { EventTimestamp } from '@/ui/app/components/EventTimestamp';
import type { EventDateDisplayMode } from '@/lib/eventlog/format-event-timestamp';
import { SummaryEvidenceDetails,summaryArtifactLabel,summaryStateLabel } from './BetaReviewView';
import { sameSummaryArtifact,summaryFailure } from './summary-ui';
import type { SummaryArtifactRecord,SummaryArtifactView,SummaryClient,SummarySourceRef,SummaryTaskView } from './summary-types';

export function BetaSummaryHistoryRow({record,api,revision,now,dateMode,onInspect,onOpenSource}:{record:SummaryArtifactRecord;api?:SummaryClient;revision:number;now:number;dateMode:EventDateDisplayMode;onInspect:(record:SummaryArtifactRecord)=>void;onOpenSource?:(source:SummarySourceRef)=>void}){
  const host=useRef<HTMLDivElement>(null);const [visible,setVisible]=useState(()=>typeof IntersectionObserver==='undefined');
  const [reload,setReload]=useState(0);const [qualification,setQualification]=useState<{api:SummaryClient;revision:number;task:SummaryTaskView;artifact:SummaryArtifactView}|null>(null);
  const [loading,setLoading]=useState(false);const [error,setError]=useState('');
  useEffect(()=>{if(visible||typeof IntersectionObserver==='undefined')return;const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setVisible(true);observer.disconnect();}});if(host.current)observer.observe(host.current);return()=>observer.disconnect();},[visible]);
  useEffect(()=>{
    if(!api||!visible){setLoading(false);return;}let active=true;setLoading(true);setError('');
    const before=record.local_seq<Number.MAX_SAFE_INTEGER?record.local_seq+1:null;
    // One bounded artifact read uses its immutable local-sequence position.
    // Never scan all history or substitute the task's newer result for this row.
    void Promise.all([api.task(record.profile_id,record.task_id),api.artifacts(record.profile_id,record.task_id,before,1)]).then(([task,page])=>{
      if(!active)return;const artifact=page.items.find(item=>item.event_id===record.event_id);
      if(task.profile_id!==record.profile_id||task.task_id!==record.task_id||!artifact||!sameSummaryArtifact(record,artifact)||artifact.current!==(task.latest_artifact_id===record.event_id))throw Error('Qualification changed');
      setQualification({api,revision,task,artifact});
    }).catch(failure=>{if(active){setQualification(null);setError(summaryFailure(failure));}}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[api,visible,record.profile_id,record.task_id,record.event_id,record.digest,record.local_seq,revision,reload]);
  const qualified=qualification&&qualification.api===api&&qualification.revision===revision&&qualification.task.profile_id===record.profile_id&&qualification.task.task_id===record.task_id&&sameSummaryArtifact(record,qualification.artifact)?qualification:null;
  const valid=!loading&&!!qualified;const sources=new Map(record.snapshot.sources.map(source=>[source.event_id,source]));
  return<div ref={host}><ChatMessageRowView eventId={record.event_id} tone="system"
    avatar={<Avatar className="mt-0.5 h-8 w-8 shrink-0"><AvatarFallback className="bg-surface text-brand-accent"><Sparkles size={16}/></AvatarFallback></Avatar>}
    metadata={<><span className="text-xs font-semibold text-strong">{summaryArtifactLabel(record.artifact_kind)}</span><EventTimestamp timestamp={record.occurred_at_ms} now={now} mode={dateMode}/>{valid&&qualified&&<span>{summaryStateLabel(qualified.task.state)}</span>}</>}
    content={<div className="space-y-2"><p className="whitespace-pre-wrap break-words">{record.output.narrative}</p>
      <p role="status" className="text-xs text-muted">{loading?'正在核对这条结果的当前资格；原文保持不变。':valid&&qualified?qualified.artifact.current?'此版本当前有效；资格来自本次任务查询。':'保留的历史或未获当前资格版本。':api?'此版本当前资格尚未确认，不能仅凭历史记录宣称生成成功。':'此连接未提供资格读取，以下只呈现原始结果。'}</p>
      {valid&&qualified&&qualified.task.latest_artifact_id!==record.event_id&&qualified.task.latest_artifact_id&&<p className="text-xs text-muted">任务已有其他版本，本条正文与依据不会被替换。</p>}
      <div className="flex flex-wrap gap-1 text-xs">{record.output.evidence.map(id=>{const source=sources.get(id);return source?<Button key={id} variant="ghost" size="sm" disabled={!onOpenSource} onClick={()=>onOpenSource?.(source)}>来源 {id.slice(0,8)}</Button>:<span key={id}>引用来源尚未确认</span>;})}</div>
      {error&&<p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>}
    afterBubble={<SummaryEvidenceDetails snapshot={record.snapshot} output={record.output} conflicts={qualified?.task.conflicts??[]} now={now} dateMode={dateMode}/>}
    actions={<div className="mt-2 flex gap-1"><Button variant="outline" size="sm" onClick={()=>onInspect(record)}>查看回顾任务</Button>{api&&<Button variant="ghost" size="sm" disabled={loading} onClick={()=>{setVisible(true);setReload(value=>value+1);}}>核对此版本资格</Button>}</div>}/></div>;
}
