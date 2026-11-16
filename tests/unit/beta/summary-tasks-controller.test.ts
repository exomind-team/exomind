import { describe,expect,it,vi } from 'vitest';
import { BetaApiError } from '@/beta/api-error';
import { SummaryTasksController } from '@/beta/summary-tasks-controller';
import type { SummaryArtifactView,SummaryClient,SummaryControlCommand,SummaryTaskView } from '@/beta/summary-types';
import { deferred } from './fixtures';
import { memoryIntentJournal } from './timeblock-ui-fixtures';
import { A,D,N,P,T,artifact,manyIds,receipt,task } from './summary-client-fixtures';

async function fixture(){
  let server:SummaryTaskView=task();let versions:SummaryArtifactView[]=[artifact()];
  const api={tasks:vi.fn(async()=>({items:[server],next_after:null as string|null})),task:vi.fn(async()=>server),artifacts:vi.fn(async(_profile:string,_task:string,before:number|null)=>({items:versions.filter(item=>before===null||item.event_id===A),next_before:null as number|null,highwater:versions.length+2})),blockSelection:vi.fn(async()=>server.selection),request:vi.fn(async()=>{throw Error('not this slice');}),control:vi.fn(async(command:SummaryControlCommand)=>receipt(command))}satisfies SummaryClient;
  const read=vi.fn(async()=>null as ReturnType<typeof receipt>|null);let next=100;const uuid=vi.fn(()=>{const values=manyIds(++next);return values[values.length-1];});const owner=new SummaryTasksController(api,D,P,read,uuid,undefined,memoryIntentJournal());await owner.ready();
  return{api,read,uuid,owner,setTask:(value:SummaryTaskView)=>{server=value;},setVersions:(items:SummaryArtifactView[])=>{versions=items;}};
}
describe('summary task UI state and fixed control intents',()=>{
  it('reads 25 at a time with explicit more and no automatic control/model request',async()=>{
    const f=await fixture();const tasks=manyIds(26).map(id=>({...task(),task_id:id,trigger_key:'fixture:'+id}));f.api.tasks.mockImplementation(async(_profile?:string,after?:string|null)=>after?{items:tasks.slice(25),next_after:null}:{items:tasks.slice(0,25),next_after:tasks[24].task_id});
    await f.owner.loadTasks();expect(f.api.tasks).toHaveBeenCalledWith(P,null,25);expect(f.owner.snapshot().tasks).toHaveLength(25);expect(f.api.tasks).toHaveBeenCalledTimes(1);
    await f.owner.loadTasks(true);expect(f.api.tasks).toHaveBeenLastCalledWith(P,tasks[24].task_id,25);expect(f.owner.snapshot().tasks).toHaveLength(26);expect(f.api.control).not.toHaveBeenCalled();expect(f.api.request).not.toHaveBeenCalled();f.owner.dispose();
  });
  it('does not claim cancellation before a matching receipt and refreshed task state arrive',async()=>{
    const f=await fixture(),gate=deferred<ReturnType<typeof receipt>>();await f.owner.loadTasks();f.api.control.mockReturnValueOnce(gate.promise);const visible=f.owner.snapshot().tasks[0];const pending=f.owner.act('cancel',visible);
    expect(f.owner.snapshot().tasks[0].state).toBe('running');expect(f.owner.snapshot().intents[0].phase).toBe('sending');expect(f.api.control).not.toHaveBeenCalled();await vi.waitFor(()=>expect(f.api.control).toHaveBeenCalledTimes(1));const command=f.api.control.mock.calls[0][0];
    expect(command).toMatchObject({task_id:T,profile_id:P,expected_owner_generation:visible.owner_generation,expected_owner_control_event_id:visible.owner_control_event_id,expected_control_heads:visible.control_heads,action:{kind:'cancel'}});
    f.setTask({...visible,state:'cancelled',reason:'cancelled'});gate.resolve(receipt(command));await pending;expect(f.owner.snapshot().tasks[0].state).toBe('cancelled');expect(f.owner.snapshot().intents).toEqual([]);f.owner.dispose();
  });
  it('retries an unknown reply with the same frozen command and IDs, including a fixed new run',async()=>{
    const f=await fixture();const failed={...task(),state:'failed' as const,reason:'timeout'};f.setTask(failed);await f.owner.loadTasks();f.api.control.mockRejectedValueOnce(new BetaApiError('summary_transport','synthetic private failure'));
    await f.owner.act('retry',failed);const intent=f.owner.snapshot().intents[0],first=f.api.control.mock.calls[0][0];expect(intent.phase).toBe('unknown');expect(first.action.kind).toBe('take_over_for_self');const count=f.uuid.mock.calls.length;
    await f.owner.retryIntent(intent);expect(f.api.control.mock.calls[1][0]).toBe(first);expect(f.uuid).toHaveBeenCalledTimes(count);expect(f.owner.snapshot().tasks[0].state).toBe('failed');f.owner.dispose();
  });
  it('uses the original base receipt to reconcile a dropped reply without sending another write',async()=>{
    const f=await fixture();await f.owner.loadTasks();f.api.control.mockImplementationOnce(async command=>{f.read.mockResolvedValueOnce(receipt(command));throw new BetaApiError('summary_transport','lost response');});await f.owner.act('cancel',task());
    expect(f.api.control).toHaveBeenCalledTimes(1);expect(f.read).toHaveBeenCalledWith(P,f.api.control.mock.calls[0][0].command_id);expect(f.owner.snapshot().intents).toEqual([]);f.owner.dispose();
  });
  it('keeps old artifact text/snapshot selected while task.latest changes, then changes versions only on explicit request',async()=>{
    const f=await fixture();f.setTask({...task(),state:'succeeded',latest_artifact_id:A});await f.owner.selectTask(T);const original=f.owner.snapshot().detail!.selected!;
    const next={...artifact(),event_id:N,occurred_at_ms:4000,output:{...artifact().output,narrative:'new result'},supersedes_artifact_id:A};f.setVersions([next,{...artifact(),current:false,reason:'historical_or_unqualified'}]);f.setTask({...task(),state:'succeeded',latest_artifact_id:N,coverage_changed:true});
    await f.owner.refreshSelected();expect(f.owner.snapshot().detail!.selected?.event_id).toBe(A);expect(f.owner.snapshot().detail!.selected!.snapshot.digest).toBe(original.snapshot.digest);expect(f.owner.snapshot().detail!.selected!.output.narrative).toBe(original.output.narrative);
    await f.owner.openArtifact(N);expect(f.owner.snapshot().detail!.selected?.event_id).toBe(N);expect(f.owner.snapshot().detail!.selected?.output.narrative).toBe('new result');f.owner.dispose();
  });
  it('updates by new run without replacing the user-selected old result or selecting new originals',async()=>{
    const f=await fixture();const current={...task(),state:'succeeded' as const,latest_artifact_id:A,coverage_changed:true};f.setTask(current);await f.owner.selectTask(T);await f.owner.act('update',current);
    const action=f.api.control.mock.calls[0][0].action;expect(action).toMatchObject({kind:'queue_update',selection:current.selection,supersedes_artifact_id:A});expect(action.kind==='queue_update'&&action.selection.selected_original_ids).toEqual([]);expect(f.owner.snapshot().detail!.selected?.event_id).toBe(A);f.owner.dispose();
  });
  it('never truncates >128 expected heads, auto-takes over, or implicitly resumes a cancelled task',async()=>{
    const f=await fixture();const heads=manyIds(129);await f.owner.act('cancel',{...task(),control_heads:heads,conflicts:heads});expect(f.api.control).not.toHaveBeenCalled();expect(f.uuid).not.toHaveBeenCalled();expect(f.owner.snapshot().error).toContain('128');
    const remote={...task(),owner_device_id:N,state:'failed' as const};await f.owner.act('retry',remote);expect(f.api.control).not.toHaveBeenCalled();
    await f.owner.act('takeover',remote);expect(f.api.control.mock.calls[0][0].action).toMatchObject({kind:'take_over_for_self',resume_cancelled:false});
    await f.owner.act('resume',{...task(),state:'cancelled'});expect(f.api.control.mock.calls[1][0].action).toMatchObject({kind:'take_over_for_self',resume_cancelled:true});f.owner.dispose();
  });
  it('drops old scope reads after disposal instead of filling the next profile with a late result',async()=>{
    const f=await fixture(),gate=deferred<SummaryTaskView>();f.api.task.mockReturnValueOnce(gate.promise);const pending=f.owner.selectTask(T);f.owner.dispose();gate.resolve(task());await pending;
    expect(f.owner.snapshot().detail?.task).toBeNull();expect(f.api.control).not.toHaveBeenCalled();
  });
});
