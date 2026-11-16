import { act,cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { BetaApp } from '@/beta/BetaApp';
import { BetaSummaryHistoryRow } from '@/beta/BetaSummaryHistoryRow';
import { BetaSummarySourceDialog } from '@/beta/BetaSummarySourceDialog';
import { BetaSummaryTasksPanel } from '@/beta/BetaSummaryTasksPanel';
import { validateTimelineItem,validateTimelinePage } from '@/beta/timeblocks-validation';
import type { SummaryClient,SummaryTaskView } from '@/beta/summary-types';
import { A,B,D,E,N,O,P,R,T,artifact,receipt,record,snapshot,task } from './summary-client-fixtures';
import { asyncDraftLocks,deferred,fakeClient } from './fixtures';
import { memoryIntentJournal } from './timeblock-ui-fixtures';
import { externalRecord } from './external-summary-fixtures';

const locks=Object.getOwnPropertyDescriptor(navigator,'locks');
beforeEach(()=>{localStorage.clear();vi.stubGlobal('IntersectionObserver',undefined);Object.defineProperty(navigator,'locks',{configurable:true,value:asyncDraftLocks()});});
afterEach(()=>{cleanup();localStorage.clear();vi.restoreAllMocks();vi.unstubAllGlobals();if(locks)Object.defineProperty(navigator,'locks',locks);else Reflect.deleteProperty(navigator,'locks');});
function summaries(){return{tasks:vi.fn<SummaryClient['tasks']>(async()=>({items:[{...task(),state:'succeeded',latest_artifact_id:A}],next_after:null})),task:vi.fn<SummaryClient['task']>(async()=>({...task(),state:'succeeded',latest_artifact_id:A})),artifacts:vi.fn<SummaryClient['artifacts']>(async()=>({items:[artifact()],next_before:null,highwater:3})),blockSelection:vi.fn<SummaryClient['blockSelection']>(async()=>snapshot().selection),request:vi.fn<SummaryClient['request']>(async command=>receipt(command)),control:vi.fn<SummaryClient['control']>(async command=>receipt(command))}satisfies SummaryClient;}
const now=4000,dateMode='compact' as const;
describe('summary/1 feed and qualified history rendering',()=>{
  it('renders an external Agent row through the real feed and opens its source without querying internal task qualification',async()=>{
    const api=summaries(),base=fakeClient(),external={...externalRecord(),profile_id:P,device_id:D};base.status.mockResolvedValue({protocol:'exomind-beta/1',device_id:D,runtime_id:R,running:true});base.profiles.mockResolvedValue([{profile_id:P,display_name:'P'}]);
    const source=external.snapshot.sources[0],reader=vi.fn(async()=>({kind:'capture' as const,record:{event_id:source.event_id,profile_id:P,device_id:D,author_id:D,author_kind:'human' as const,occurred_at_ms:1000,text:'external exact source',tags:[],digest:source.digest,local_seq:1}}));
    const client={...base,summaries:api,timelinePage:async()=>({items:[{kind:'agent_summary/1' as const,record:external}],highwater:2,next_before:null}),timelineEvent:reader};render(<BetaApp client={client} intentJournal={memoryIntentJournal()}/>);await screen.findByText('外部 Agent 回顾');fireEvent.click(screen.getByRole('button',{name:/来源 /}));await screen.findByText('external exact source');expect(reader).toHaveBeenCalledWith(P,source.event_id);expect(api.task).not.toHaveBeenCalled();expect(api.request).not.toHaveBeenCalled();expect(api.control).not.toHaveBeenCalled();
  });
  it('decodes the real summary/1 wire item directly and excludes internal job facts or forged qualification',()=>{
    expect(validateTimelineItem({kind:'summary/1',record:record()},P).kind).toBe('summary/1');expect(validateTimelinePage({items:[{kind:'summary/1',record:record()}],highwater:3,next_before:null},P,{limit:100}).items).toHaveLength(1);
    expect(()=>validateTimelineItem({kind:'summary_job/1',record:record()},P)).toThrow();expect(()=>validateTimelineItem({kind:'summary/1',record:{...record(),current:true}},P)).toThrow();expect(()=>validateTimelineItem({kind:'summary/1',record:{...record(),profile_id:N}},P)).toThrow();
    expect(validateTimelinePage({items:[{kind:'summary/1',record:{...record(),local_seq:Number.MAX_SAFE_INTEGER}}],highwater:Number.MAX_SAFE_INTEGER,next_before:null},P,{limit:1}).items).toHaveLength(1);
  });
  it('keeps raw text/date without inventing succeeded/current before the exact qualification returns',async()=>{
    const api=summaries(),gate=deferred<SummaryTaskView>();api.task.mockReturnValueOnce(gate.promise);render(<BetaSummaryHistoryRow record={record()} api={api} revision={3} now={now} dateMode={dateMode} onInspect={vi.fn()}/>);
    expect(screen.getByText(artifact().output.narrative)).toBeInTheDocument();expect(screen.queryByText('回顾已生成')).not.toBeInTheDocument();expect(screen.getByText(/正在核对这条结果/)).toBeInTheDocument();
    await act(async()=>{gate.resolve({...task(),state:'succeeded',latest_artifact_id:A});});await screen.findByText(/此版本当前有效/);expect(api.artifacts).toHaveBeenCalledWith(P,T,4,1);expect(api.request).not.toHaveBeenCalled();expect(api.control).not.toHaveBeenCalled();
  });
  it('does not substitute a newer artifact body when qualification changes and fences a late P read on rerender',async()=>{
    const api=summaries();const ui=render(<BetaSummaryHistoryRow record={record()} api={api} revision={3} now={now} dateMode={dateMode} onInspect={vi.fn()}/>);await screen.findByText(/此版本当前有效/);
    api.task.mockResolvedValue({...task(),state:'succeeded',latest_artifact_id:N});api.artifacts.mockResolvedValue({items:[{...artifact(),current:false,reason:'historical_or_unqualified'}],next_before:null,highwater:5});ui.rerender(<BetaSummaryHistoryRow record={record()} api={api} revision={5} now={now} dateMode={dateMode} onInspect={vi.fn()}/>);await screen.findByText('保留的历史或未获当前资格版本。');expect(screen.getByText(artifact().output.narrative)).toBeInTheDocument();
    const gate=deferred<SummaryTaskView>();api.task.mockReturnValueOnce(gate.promise);ui.rerender(<BetaSummaryHistoryRow record={record()} api={api} revision={6} now={now} dateMode={dateMode} onInspect={vi.fn()}/>);const next={...record(),event_id:N,profile_id:N,task_id:N};ui.rerender(<BetaSummaryHistoryRow record={next} revision={1} now={now} dateMode={dateMode} onInspect={vi.fn()}/>);
    await act(async()=>{gate.resolve({...task(),state:'succeeded',latest_artifact_id:A});});expect(screen.queryByText(/此版本当前有效/)).not.toBeInTheDocument();
  });
  it('registers the Alpha task dialog, paged read-only startup and explicit confirmation before control',async()=>{
    const api=summaries();api.tasks.mockResolvedValue({items:[task()],next_after:null});api.task.mockResolvedValue(task());const base=fakeClient();base.status.mockResolvedValue({protocol:'exomind-beta/1',device_id:D,runtime_id:R,running:true});base.profiles.mockResolvedValue([{profile_id:P,display_name:'P'}]);
    const client={...base,summaries:api,timelinePage:async()=>({items:[{kind:'summary/1' as const,record:record()}],highwater:3,next_before:null})};render(<BetaApp client={client} intentJournal={memoryIntentJournal()}/>);await screen.findByRole('textbox',{name:'记录当下'});fireEvent.click(screen.getByRole('button',{name:'回顾'}));
    await waitFor(()=>expect(api.tasks).toHaveBeenCalledWith(P,null,25));const row=await screen.findByRole('button',{name:/回顾 ·/});fireEvent.click(row);await screen.findByRole('button',{name:'取消生成'});expect(api.control).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'取消生成'}));expect(api.control).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'确认取消'}));await waitFor(()=>expect(api.control).toHaveBeenCalledTimes(1));expect(api.control.mock.calls[0][0]).toMatchObject({profile_id:P,task_id:T,expected_owner_generation:1,expected_owner_control_event_id:task().owner_control_event_id,expected_control_heads:task().control_heads});
  });
  it('opens only an exact requested source and distinguishes true null from read error without fetching original bytes',async()=>{
    const source=snapshot().sources[0];const reader=vi.fn(async()=>null);const props={profileId:P,source,reader,onClose:vi.fn(),now,dateMode};const ui=render(<BetaSummarySourceDialog {...props}/>);await screen.findByText('本机没有可见的该来源，未声称已读。');expect(reader).toHaveBeenCalledWith(P,E);
    reader.mockRejectedValueOnce(new Error('synthetic-private-path'));fireEvent.click(screen.getByRole('button',{name:'重新读取此来源'}));await screen.findByRole('alert');expect(screen.queryByText('本机没有可见的该来源，未声称已读。')).not.toBeInTheDocument();expect(screen.queryByText('synthetic-private-path')).not.toBeInTheDocument();
    ui.rerender(<BetaSummarySourceDialog {...props} source={{...source,event_id:B}} reader={async()=>({kind:'capture',record:{event_id:B,profile_id:P,device_id:D,author_id:D,author_kind:'human',occurred_at_ms:1000,text:'exact body',tags:[],digest:source.digest,local_seq:1,originals:[{original_id:O,sha256:'a'.repeat(64),byte_length:3,file_name:'bytes.raw',media_type:'application/octet-stream'}]}})}/>);await screen.findByText('exact body');expect(screen.getByText(/不表示已读取正文/)).toBeInTheDocument();
    const gate=deferred<null>();ui.rerender(<BetaSummarySourceDialog {...props} profileId={N} reader={()=>gate.promise}/>);expect(screen.queryByText('exact body')).not.toBeInTheDocument();await act(async()=>{gate.resolve(null);});
  });
  it('requires a named takeover confirmation and never automatically resumes a remote cancelled task',async()=>{
    const api=summaries(),remote={...task(),owner_device_id:N,state:'failed' as const};api.tasks.mockResolvedValue({items:[remote],next_after:null});api.task.mockResolvedValue(remote);const base=fakeClient();
    render(<BetaSummaryTasksPanel intentJournal={memoryIntentJournal()} open onOpenChange={vi.fn()} client={{...base,summaries:api}} deviceId={D} profileId={P} target={null} revision={0} now={now} dateMode={dateMode} onConfigure={vi.fn()} onChanged={vi.fn()}/>);
    fireEvent.click(await screen.findByRole('button',{name:/回顾 ·/}));fireEvent.click(await screen.findByRole('button',{name:'接管到本机并开启新一轮'}));expect(api.control).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'确认接管并开启新一轮'}));
    await waitFor(()=>expect(api.control).toHaveBeenCalledTimes(1));expect(api.control.mock.calls[0][0]).toMatchObject({expected_control_heads:remote.control_heads,expected_owner_control_event_id:remote.owner_control_event_id,action:{kind:'take_over_for_self',resume_cancelled:false}});
    await waitFor(()=>expect(screen.getByRole('button',{name:'刷新所选任务'})).toBeEnabled());api.task.mockResolvedValue({...remote,state:'cancelled'});fireEvent.click(screen.getByRole('button',{name:'刷新所选任务'}));await waitFor(()=>expect(screen.getAllByText('回顾已取消').length).toBeGreaterThan(0));expect(screen.queryByRole('button',{name:'接管到本机并开启新一轮'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'恢复已取消的回顾（新一轮）'})).not.toBeInTheDocument();
  });
});
