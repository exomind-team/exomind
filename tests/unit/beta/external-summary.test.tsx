import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {BetaExternalSummaryHistoryRow} from '@/beta/BetaExternalSummaryHistoryRow';
import {validateExternalSummaryRecord} from '@/beta/external-summary';
import {validateTimelineItem,validateTimelinePage} from '@/beta/timeblocks-validation';

import {id,externalRecord} from './external-summary-fixtures';
afterEach(cleanup);
describe('external Agent summary uses its own typed read contract',()=>{
  it('decodes a typed external row and page without synthesizing internal task qualification',()=>{
    const value=externalRecord();expect(validateExternalSummaryRecord(value,id(2))).toEqual(value);expect(validateTimelineItem({kind:'agent_summary/1',record:value},id(2)).kind).toBe('agent_summary/1');expect(validateTimelinePage({items:[{kind:'agent_summary/1',record:value}],highwater:2,next_before:null},id(2),{limit:100}).items).toHaveLength(1);
    expect(()=>validateExternalSummaryRecord({...value,current:true},id(2))).toThrow();expect(()=>validateExternalSummaryRecord({...value,task_id:id(7)},id(2))).toThrow();expect(()=>validateExternalSummaryRecord({...value,profile_id:id(9)},id(2))).toThrow();expect(()=>validateTimelineItem({kind:'summary/1',record:value},id(2))).toThrow();
  });
  it('rejects unknown delivery claims, derived sources and unbound evidence',()=>{
    const value=externalRecord();for(const change of [
      {...value,snapshot:{...value.snapshot,sources:[]}},
      {...value,snapshot:{...value.snapshot,sources:[{...value.snapshot.sources[0],kind:'summary/1'}]}},
      {...value,snapshot:{...value.snapshot,sources:[value.snapshot.sources[0],value.snapshot.sources[0]]}},
      {...value,evidence:[id(9)]},{...value,evidence:[id(5),id(5)]},{...value,narrative:' '},{...value,narrative:'x'.repeat(128*1024+1)},
      {...value,snapshot:{...value.snapshot,coverage:{...value.snapshot.coverage,source_delivery:'attested'}}},
      {...value,snapshot:{...value.snapshot,observed_through:Number.POSITIVE_INFINITY}},
    ])expect(()=>validateExternalSummaryRecord(change,id(2))).toThrow();
  });
  it('keeps every material explicitly unread and rejects omitted or duplicate identities',()=>{
    const value=externalRecord(),material={original_id:id(6),sha256:'e'.repeat(64),byte_length:3,file_name:'synthetic.bin',media_type:'application/octet-stream'};
    const withMaterial={...value,snapshot:{...value.snapshot,materials:[material],coverage:{...value.snapshot.coverage,unread_original_ids:[id(6)]}}};expect(validateExternalSummaryRecord(withMaterial,id(2)).snapshot.materials).toEqual([material]);
    expect(()=>validateExternalSummaryRecord({...withMaterial,snapshot:{...withMaterial.snapshot,coverage:{...withMaterial.snapshot.coverage,unread_original_ids:[]}}},id(2))).toThrow();expect(()=>validateExternalSummaryRecord({...withMaterial,snapshot:{...withMaterial.snapshot,materials:[material,material]}},id(2))).toThrow();
  });
  it('reuses the Alpha row, real event date and exact source callback without a model-task action',()=>{
    const record=externalRecord(),onOpenSource=vi.fn();const view=render(<BetaExternalSummaryHistoryRow record={record} now={new Date(2026,10,16,12).getTime()} dateMode="compact" onOpenSource={onOpenSource}/>);
    expect(view.container.querySelector('[data-timeline-kind="agent_summary/1"]')).toBeInTheDocument();expect(view.container.querySelector('script')).toBeNull();expect(screen.getByText(record.narrative)).toBeInTheDocument();expect(screen.getByText('15日 · 19:16')).toBeInTheDocument();expect(screen.queryByText('回顾已生成')).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'查看回顾任务'})).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:/来源 /}));expect(onOpenSource).toHaveBeenCalledWith(record.snapshot.sources[0]);expect(screen.getByText(/不代表全部资料/)).toBeInTheDocument();
  });
});
