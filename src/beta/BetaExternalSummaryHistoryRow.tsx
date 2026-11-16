import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Avatar,AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ChatMessageRowView } from '@/ui/app/components/ChatMessageRowView';
import { EventTimestamp } from '@/ui/app/components/EventTimestamp';
import type { EventDateDisplayMode } from '@/lib/eventlog/format-event-timestamp';
import type { SummarySourceRef } from './summary-types';
import type { ExternalSummaryRecord } from './external-summary';

export function BetaExternalSummaryHistoryRow({record,now,dateMode,onOpenSource}:{record:ExternalSummaryRecord;now:number;dateMode:EventDateDisplayMode;onOpenSource?:(source:SummarySourceRef)=>void}){
  const [shown,setShown]=useState(25);const sources=new Map(record.snapshot.sources.map(source=>[source.event_id,source]));
  return<ChatMessageRowView eventId={record.event_id} timelineKind="agent_summary/1" tone="system"
    avatar={<Avatar className="mt-0.5 h-8 w-8 shrink-0"><AvatarFallback className="bg-surface text-brand-accent"><Sparkles size={16}/></AvatarFallback></Avatar>}
    metadata={<><span className="text-xs font-semibold text-strong">外部 Agent 回顾</span><EventTimestamp timestamp={record.occurred_at_ms} now={now} mode={dateMode}/></>}
    content={<div className="space-y-2"><p className="whitespace-pre-wrap break-words">{record.narrative}</p><p className="text-xs text-muted">由 Agent {record.producer_agent_id.slice(0,8)} 在设备 {record.device_id.slice(0,8)} 提交。</p>
      <div className="flex flex-wrap gap-1 text-xs">{record.evidence.slice(0,shown).map(id=>{const source=sources.get(id);return source?<Button key={id} variant="ghost" size="sm" disabled={!onOpenSource} onClick={()=>onOpenSource?.(source)}>来源 {id.slice(0,8)}</Button>:<span key={id}>引用尚未确认</span>;})}</div>
      {shown<record.evidence.length&&<Button variant="ghost" size="sm" onClick={()=>setShown(value=>value+25)}>继续显示引用（尚有 {record.evidence.length-shown} 项）</Button>}
    </div>}
    afterBubble={<details className="mt-2 space-y-2 text-xs text-muted"><summary className="cursor-pointer">生成依据与覆盖</summary><p>这份回顾引用了明确列出的 {record.snapshot.sources.length} 项来源，不代表全部资料。来源由提交设备核对；未证明外部推理前已实际读取。</p><p>其他设备资料的完整性未知。本条是外部提交的独立回顾，不取得内部模型任务的当前结果资格。</p><p>附带 {record.snapshot.materials.length} 份原件引用，均未声明读取正文。</p></details>}/>;
}
