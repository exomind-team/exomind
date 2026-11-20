import { selectField } from './select-field';
import { StrictMode } from 'react';
import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { afterEach,describe,expect,it,vi } from 'vitest';
import { ManualSummarySelection } from '@/beta/manual-summary-selection';
import { BetaManualSummaryDialog } from '@/beta/BetaManualSummaryDialog';
import { SummaryTasksController } from '@/beta/summary-tasks-controller';
import type { BetaTimeblockClient,BetaTimeblockNode,BetaTimeblockSnapshot } from '@/beta/timeblocks-types';
import type { SummaryClient,SummarySelection } from '@/beta/summary-types';
import { A,B,D,N,O,P,R,artifact,manyIds,receipt,task } from './summary-client-fixtures';
import { fakeClient } from './fixtures';
import { memoryIntentJournal } from './timeblock-ui-fixtures';

const revision='a'.repeat(64);
function state():BetaTimeblockSnapshot{return{profile_id:P,revision,heads:[],active:null,pending_feedback:[],clock:{server_now_ms:999999,epoch_changed:false,wall_clock_moved_back:false}};}
function node(seq:number,ms:number,payload:BetaTimeblockNode['payload']):BetaTimeblockNode{return{event_id:manyIds(50)[seq],profile_id:P,device_id:D,source:{kind:'human',author_id:D,owner_generation:null},parents:[],occurred_at_ms:ms,effective_at_ms:ms,clock:{epoch_id:R,elapsed_ms:ms},payload,digest:'b'.repeat(64),local_seq:seq};}
function start(seq:number,ms:number,block:string,name:string){return node(seq,ms,{kind:'action',action:{kind:'start',block_id:block,name,note:'',timer:{mode:'count_up'}}});}
function feedback(seq:number,ms:number,block:string){return node(seq,ms,{kind:'action',action:{kind:'submit_feedback',block_id:block,feedback:{kind:'skipped'}}});}
function fixture(){
  const anchors=new Map<string,SummarySelection>([[B,{block_ids:[B],from_ms:10,to_ms:20,selected_original_ids:[]}],[N,{block_ids:[N],from_ms:21,to_ms:21,selected_original_ids:[]}],[O,{block_ids:[O],from_ms:22,to_ms:30,selected_original_ids:[]}]]);
  const nodes=[start(7,40,D,'Current later'),feedback(6,30,O),start(5,22,O,'Last'),feedback(4,21,N),start(3,21,N,'Zero middle'),feedback(2,20,B),start(1,10,B,'First')];
  const blocks={snapshot:vi.fn<BetaTimeblockClient['snapshot']>(async()=>state()),nodes:vi.fn<BetaTimeblockClient['nodes']>(async()=>({items:nodes,highwater:7,next_before:null})),intervals:vi.fn<BetaTimeblockClient['intervals']>(async()=>({items:[{from_ms:10,to_ms:20,kind:'running',block_id:B,source_event_ids:[]},{from_ms:20,to_ms:22,kind:'gap',block_id:null,source_event_ids:[]},{from_ms:22,to_ms:30,kind:'running',block_id:O,source_event_ids:[]}],revision,next_from_ms:null,complete:true})),command:vi.fn<BetaTimeblockClient['command']>(async command=>receipt(command))}satisfies BetaTimeblockClient;
  const summaries={tasks:vi.fn<SummaryClient['tasks']>(async()=>({items:[],next_after:null})),task:vi.fn<SummaryClient['task']>(async()=>task()),artifacts:vi.fn<SummaryClient['artifacts']>(async()=>({items:[artifact()],next_before:null,highwater:7})),blockSelection:vi.fn<SummaryClient['blockSelection']>(async(_profile,id)=>{const anchor=anchors.get(id);if(!anchor)throw Error('feedback required');return anchor;}),request:vi.fn<SummaryClient['request']>(async command=>receipt(command)),control:vi.fn<SummaryClient['control']>(async command=>receipt(command))}satisfies SummaryClient;
  const owner=new ManualSummarySelection(blocks,summaries,P);return{owner,blocks,summaries,nodes,anchors};
}
afterEach(cleanup);
describe('authoritative manual compression selection',()=>{
  it('allows a single authoritative completed block without treating a partial candidate page as a complete range',async()=>{
    const f=fixture();f.blocks.nodes.mockResolvedValue({items:f.nodes.slice(0,2),highwater:7,next_before:6});await f.owner.loadCandidates();expect(f.owner.snapshot().nodesComplete).toBe(false);await f.owner.prepare(B);expect(await f.owner.confirmed()).toEqual(f.anchors.get(B));expect(f.blocks.intervals).not.toHaveBeenCalled();
    await f.owner.prepare(B,O);expect(f.owner.snapshot().stage).toBe('idle');expect(f.owner.snapshot().error).toContain('范围尚未确认');expect(f.summaries.request).not.toHaveBeenCalled();f.owner.dispose();
  });
  it('keeps zero-duration middle blocks absent from intervals and safely excludes a later running candidate',async()=>{
    const f=fixture();await f.owner.loadCandidates();await f.owner.prepare(B,O);expect(f.owner.snapshot().stage).toBe('ready');expect((await f.owner.confirmed()).block_ids).toEqual([B,N,O]);expect(f.summaries.blockSelection).not.toHaveBeenCalledWith(P,D);expect(f.owner.snapshot().gapCount).toBe(1);expect(f.blocks.intervals).toHaveBeenCalledWith(P,{from_ms:10,to_ms:30,through:revision,limit:100});expect(f.summaries.request).not.toHaveBeenCalled();f.owner.dispose();
  });
  it('requires explicit node/interval pagination and the same fixed projection revision',async()=>{
    const f=fixture();f.blocks.nodes.mockResolvedValueOnce({items:f.nodes.slice(0,4),highwater:7,next_before:4}).mockResolvedValueOnce({items:f.nodes.slice(4),highwater:7,next_before:null});await f.owner.loadCandidates();expect(f.blocks.nodes).toHaveBeenCalledTimes(1);await f.owner.loadCandidates();expect(f.blocks.nodes).toHaveBeenLastCalledWith(P,{limit:100,through:7,before:4});
    f.blocks.intervals.mockResolvedValueOnce({items:[{from_ms:10,to_ms:20,kind:'running',block_id:B,source_event_ids:[]}],revision,next_from_ms:20,complete:false}).mockResolvedValueOnce({items:[{from_ms:20,to_ms:22,kind:'gap',block_id:null,source_event_ids:[]},{from_ms:22,to_ms:30,kind:'running',block_id:O,source_event_ids:[]}],revision,next_from_ms:null,complete:true});
    await f.owner.prepare(B,O);expect(f.owner.snapshot().stage).toBe('intervals');await expect(f.owner.confirmed()).rejects.toThrow();expect(f.blocks.intervals).toHaveBeenCalledTimes(1);await f.owner.continueIntervals();expect(f.blocks.intervals).toHaveBeenLastCalledWith(P,{from_ms:20,to_ms:30,through:revision,limit:100});expect(f.owner.snapshot().stage).toBe('ready');f.owner.dispose();
  });
  it('blocks an unresolved earlier candidate and ambiguous same-timestamp boundaries rather than dropping it',async()=>{
    const f=fixture();f.blocks.nodes.mockResolvedValue({items:[...f.nodes,start(8,5,R,'Unresolved before')],highwater:8,next_before:null});await f.owner.loadCandidates();await f.owner.prepare(B,O);expect(f.owner.snapshot().selection).toBeNull();expect(f.owner.snapshot().error).toContain('未反馈');f.owner.dispose();
    const next=fixture();next.anchors.set(N,{block_ids:[N],from_ms:10,to_ms:10,selected_original_ids:[]});await next.owner.loadCandidates();await next.owner.prepare(B,O);expect(next.owner.snapshot().stage).toBe('idle');expect(next.summaries.request).not.toHaveBeenCalled();next.owner.dispose();
  });
  it('refuses an unknown interval block or a changed revision at final confirmation',async()=>{
    const f=fixture();await f.owner.loadCandidates();f.blocks.intervals.mockResolvedValueOnce({items:[{from_ms:10,to_ms:30,kind:'running',block_id:R,source_event_ids:[]}],revision,next_from_ms:null,complete:true});await f.owner.prepare(B,O);expect(f.owner.snapshot().selection).toBeNull();
    await f.owner.prepare(B);f.blocks.snapshot.mockResolvedValueOnce({...state(),revision:'c'.repeat(64)});await expect(f.owner.confirmed()).rejects.toThrow();expect(f.owner.snapshot().stage).toBe('idle');expect(f.summaries.request).not.toHaveBeenCalled();f.owner.dispose();
  });
  it('renders the Alpha dialog and creates a persisted manual request only after authoritative selection and explicit confirmation',async()=>{
    const f=fixture(),journal=memoryIntentJournal(),base=fakeClient();const operations=new SummaryTasksController(f.summaries,D,P,async()=>null,undefined,undefined,journal);await operations.ready();const closed=vi.fn();render(<BetaManualSummaryDialog client={{...base,timeblocks:f.blocks,summaries:f.summaries}} profileId={P} owner={operations} onClose={closed} now={999999} dateMode="compact"/>);
    expect(screen.getByRole('button',{name:'确认创建总块'})).toBeDisabled();fireEvent.keyDown(screen.getByRole('combobox',{name:'压缩时间块'}),{key:'ArrowDown'});const firstOption=await screen.findByRole('option',{name:'First · 已有反馈事实'});expect(f.summaries.request).not.toHaveBeenCalled();fireEvent.click(firstOption);fireEvent.click(screen.getByRole('button',{name:'核验真实范围'}));await waitFor(()=>expect(screen.getByRole('button',{name:'确认创建总块'})).toBeEnabled());expect(f.summaries.request).not.toHaveBeenCalled();
    await selectField(screen.getByRole('combobox',{name:'压缩派生形式'}),'compressed_message');fireEvent.click(screen.getByRole('button',{name:'确认创建记录'}));await waitFor(()=>expect(f.summaries.request).toHaveBeenCalledTimes(1));expect(f.summaries.request.mock.calls[0][0]).toMatchObject({profile_id:P,purpose:'manual_compress_v1',artifact_kind:'compressed_message',selection:f.anchors.get(B)});expect(journal.write).toHaveBeenCalled();expect(f.blocks.command).not.toHaveBeenCalled();await waitFor(()=>expect(closed).toHaveBeenCalled());expect(operations.snapshot().requests[0].phase).toBe('committed');await operations.close();
  });
  it('keeps image selection separate from explicit consent to the displayed provider',async()=>{
    const f=fixture(),base=fakeClient(),journal=memoryIntentJournal();
    const original={original_id:A,sha256:'c'.repeat(64),byte_length:68,file_name:'synthetic-pixel.png',media_type:'image/png'};
    const source={event_id:manyIds(100)[99],profile_id:P,device_id:D,author_id:D,author_kind:'human' as const,occurred_at_ms:15,text:'Synthetic image',tags:[],digest:'a'.repeat(64),local_seq:7,originals:[original]};
    base.eventsPage.mockResolvedValue({items:[source],next_before:null,highwater:7});
    const timelinePeriodPage=vi.fn(async()=>({items:[{kind:'capture' as const,record:source}],next_before:null,highwater:7}));
    const requestWithMaterialConsent=vi.fn(async(input:{command:Parameters<SummaryClient['request']>[0];consent:{provider_config_revision:string;max_original_bytes:number}})=>receipt(input.command));
    const summaries={...f.summaries,requestWithMaterialConsent};
    const summaryModel={read:vi.fn(async()=>({profile_id:P,revision:N,enabled:true,include_suggestions:false,base_url:'https://synthetic.invalid/v1',model:'synthetic-vision',has_api_key:true,max_output_tokens:2048,timeout_ms:10000})),save:vi.fn(async()=>{throw Error('not part of this test');})};
    const operations=new SummaryTasksController(summaries,D,P,async()=>null,undefined,undefined,journal);
    await operations.ready();
    render(<BetaManualSummaryDialog client={{...base,status:async()=>({protocol:'exomind-beta/1',device_id:D,runtime_id:R,running:true,capabilities:{summary_originals:true}}),timeblocks:f.blocks,summaries,summaryModel,timelinePeriodPage}} profileId={P} owner={operations} onClose={vi.fn()} now={999999} dateMode="compact"/>);
    try{
      await selectField(screen.getByRole('combobox',{name:'压缩时间块'}),B);
      fireEvent.click(screen.getByRole('button',{name:'核验真实范围'}));
      await waitFor(()=>expect(screen.getByRole('button',{name:'确认创建总块'})).toBeEnabled());
      fireEvent.click(screen.getByRole('button',{name:'选择给模型的原件'}));
      const image=await screen.findByRole('checkbox',{name:/synthetic-pixel\.png/});
      expect(image).not.toBeChecked();
      fireEvent.click(image);
      expect(screen.getByText(/https:\/\/synthetic\.invalid/)).toBeInTheDocument();
      expect(screen.getByText(/synthetic-vision/)).toBeInTheDocument();
      const send=screen.getByRole('button',{name:'发送所选原件并创建总块'});
      expect(send).toBeDisabled();
      expect(requestWithMaterialConsent).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('checkbox',{name:/同意.*所选原件.*发送/}));
      fireEvent.click(send);
      await waitFor(()=>expect(requestWithMaterialConsent).toHaveBeenCalledTimes(1));
      expect(f.summaries.request).not.toHaveBeenCalled();
      expect(requestWithMaterialConsent.mock.calls[0][0]).toMatchObject({command:{selection:{selected_original_ids:[A]}},consent:{provider_config_revision:N,max_original_bytes:68}});
    }finally{await operations.close();}
  });
  it('can submit the plain text request after a StrictMode setup and cleanup replay',async()=>{
    const f=fixture(),base=fakeClient(),operations=new SummaryTasksController(f.summaries,D,P,async()=>null,undefined,undefined,memoryIntentJournal());
    await operations.ready();
    render(<StrictMode><BetaManualSummaryDialog client={{...base,timeblocks:f.blocks,summaries:f.summaries}} profileId={P} owner={operations} onClose={vi.fn()} now={999999} dateMode="compact"/></StrictMode>);
    try{
      await selectField(screen.getByRole('combobox',{name:'压缩时间块'}),B);
      fireEvent.click(screen.getByRole('button',{name:'核验真实范围'}));
      await waitFor(()=>expect(screen.getByRole('button',{name:'确认创建总块'})).toBeEnabled());
      fireEvent.click(screen.getByRole('button',{name:'确认创建总块'}));
      await waitFor(()=>expect(f.summaries.request).toHaveBeenCalledTimes(1));
    }finally{await operations.close();}
  });
});
