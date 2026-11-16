import { useEffect,useState } from 'react';
import { Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { EventTimestamp } from '@/ui/app/components/EventTimestamp';
import type { EventDateDisplayMode } from '@/lib/eventlog/format-event-timestamp';
import type { BetaTimelineItem } from './timeblocks-types';
import type { SummarySourceRef } from './summary-types';
import { betaTimeblockLabel } from './timeblock-label';

export type SummarySourceReader=(profileId:string,eventId:string)=>Promise<BetaTimelineItem|null>;
export function BetaSummarySourceDialog({profileId,source,reader,onClose,now,dateMode}:{profileId:string;source:SummarySourceRef|null;reader?:SummarySourceReader;onClose:()=>void;now:number;dateMode:EventDateDisplayMode}){
  const [result,setResult]=useState<{profileId:string;source:SummarySourceRef;reader:SummarySourceReader;item:BetaTimelineItem|null}|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0);
  useEffect(()=>{
    let active=true;setResult(null);setError('');if(!source||!reader){setLoading(false);return;}
    setLoading(true);void reader(profileId,source.event_id).then(value=>{
      if(!active)return;
      if(value&&(value.record.profile_id!==profileId||value.record.event_id!==source.event_id||value.record.digest!==source.digest||(source.kind==='capture'?value.kind!=='capture':value.kind!=='timeblock')))throw Error('Source binding mismatch');
      setResult({profileId,source,reader,item:value});
    }).catch(()=>{if(active)setError('来源读取尚未完成或与引用不一致，未编造来源正文；请重试。');}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[profileId,source?.event_id,source?.digest,source?.kind,reader,revision]);
  const bound=result&&result.profileId===profileId&&result.reader===reader&&result.source.event_id===source?.event_id&&result.source.digest===source?.digest&&result.source.kind===source?.kind?result:null;
  const item=bound?.item??null;
  return<Dialog open={!!source} onOpenChange={open=>{if(!open)onClose();}}><DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto"><DialogHeader><DialogTitle>引用来源</DialogTitle><DialogDescription>只读取当前档案中的精确来源，不扫描其他历史或自动读取原件正文。</DialogDescription></DialogHeader>
    {!reader?<p className="text-sm text-muted">当前连接尚未提供精确来源读取。</p>:loading?<p role="status" className="text-sm text-muted">正在读取来源…</p>:error?<p role="alert" className="text-sm text-destructive">{error}</p>:bound&&!item?<p className="text-sm text-muted">本机没有可见的该来源，未声称已读。</p>:null}
    {item&&<div className="space-y-2 text-sm"><EventTimestamp timestamp={item.record.occurred_at_ms} now={now} mode={dateMode}/>
      {item.kind==='capture'?<><p className="whitespace-pre-wrap break-words">{item.record.text||'此记录仅引用原件。'}</p>{!!item.record.originals?.length&&<div className="space-y-1 text-xs text-muted"><p>以下仅为原件引用，不表示已读取正文：</p>{item.record.originals.map(original=><p key={original.original_id} className="break-all">{original.file_name} · {original.byte_length} 字节</p>)}</div>}</>:item.kind==='timeblock'?<p className="whitespace-pre-wrap break-words">{betaTimeblockLabel(item.record)}</p>:<p>此内容类型与引用不一致，未呈现为来源。</p>}
    </div>}
    {reader&&<Button variant="outline" disabled={loading} onClick={()=>setRevision(value=>value+1)}>重新读取此来源</Button>}
  </DialogContent></Dialog>;
}
