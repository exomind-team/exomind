import { describe,expect,it,vi } from 'vitest';
import { BetaApiError } from '@/beta/api-error';
import { SummaryTasksController } from '@/beta/summary-tasks-controller';
import { decodeSummaryIntents,summaryIntentKey,SummaryIntentJournal } from '@/beta/summary-intent-journal';
import type { LocalIntentJournal } from '@/beta/local-intent-journal';
import type { SummaryClient,SummaryMaterialRequest,SummaryMaterialControl } from '@/beta/summary-types';
import { deferred } from './fixtures';
import { memoryIntentJournal } from './timeblock-ui-fixtures';
import { D,N,O,P,artifact,control,manyIds,receipt,request,snapshot,task } from './summary-client-fixtures';

function fixture(journal:LocalIntentJournal=memoryIntentJournal()){
  const api={tasks:vi.fn<SummaryClient['tasks']>(async()=>({items:[task()],next_after:null})),task:vi.fn<SummaryClient['task']>(async()=>task()),artifacts:vi.fn<SummaryClient['artifacts']>(async()=>({items:[artifact()],next_before:null,highwater:3})),blockSelection:vi.fn<SummaryClient['blockSelection']>(async()=>snapshot().selection),request:vi.fn<SummaryClient['request']>(async command=>receipt(command)),control:vi.fn<SummaryClient['control']>(async command=>receipt(command))}satisfies SummaryClient;
  const read=vi.fn(async()=>null as ReturnType<typeof receipt>|null);let id=1;const uuid=vi.fn(()=>manyIds(100)[id++]);const owner=new SummaryTasksController(api,D,P,read,uuid,undefined,journal);return{api,read,uuid,owner,journal};
}
describe('durable summary creation/control intents',()=>{
  it('roundtrips local consent and refuses a changed consent attached to the same immutable command',async()=>{
    const journal=memoryIntentJournal(),store=await SummaryIntentJournal.open(D,P,journal);
    const command={...request(),selection:{...request().selection,selected_original_ids:[O]}},consent={provider_config_revision:N,max_original_bytes:68};
    await store.put({operation:'request',kind:'create',command,consent,phase:'unknown',receipt:null});
    const raw=journal.values.get(summaryIntentKey(D,P))!;
    expect(decodeSummaryIntents(raw,D,P)[0]).toMatchObject({command,consent});
    await expect(store.put({operation:'request',kind:'create',command,consent:{...consent,max_original_bytes:69},phase:'unknown',receipt:null})).rejects.toThrow();
    expect(journal.values.get(summaryIntentKey(D,P))).toBe(raw);await store.close();
  });
  it('restores a consented unknown request without dispatch, then explicitly retries its original envelope',async()=>{
    const journal=memoryIntentJournal(),f=fixture(journal),consent={provider_config_revision:N,max_original_bytes:68};
    const send=vi.fn(async(input:SummaryMaterialRequest)=>receipt(input.command));
    Object.assign(f.api,{requestWithMaterialConsent:send});send.mockRejectedValueOnce(new BetaApiError('summary_transport','lost reply'));
    await f.owner.ready();await f.owner.create('compressed_message',{...snapshot().selection,selected_original_ids:[O]},consent);
    const original=send.mock.calls[0][0];expect(f.owner.snapshot().requests[0]).toMatchObject({phase:'unknown',consent});
    await f.owner.close();
    const next=fixture(journal),retried=vi.fn(async(input:SummaryMaterialRequest)=>receipt(input.command));Object.assign(next.api,{requestWithMaterialConsent:retried});
    await next.owner.ready();await vi.waitFor(()=>expect(next.owner.snapshot().requests[0].phase).toBe('unknown'));
    expect(retried).not.toHaveBeenCalled();expect(next.api.request).not.toHaveBeenCalled();
    await next.owner.retryRequest(next.owner.snapshot().requests[0]);
    expect(retried).toHaveBeenCalledWith(original);expect(next.uuid).not.toHaveBeenCalled();expect(next.api.request).not.toHaveBeenCalled();
    await next.owner.close();
  });
  it('allows a stale consent rejection to be dismissed before a newly confirmed request',async()=>{
    const f=fixture(),send=vi.fn(async(_input:SummaryMaterialRequest)=>{throw new BetaApiError('model_configuration_conflict','changed config',409);});
    Object.assign(f.api,{requestWithMaterialConsent:send});await f.owner.ready();
    await f.owner.create('compressed_message',{...snapshot().selection,selected_original_ids:[O]},{provider_config_revision:N,max_original_bytes:68});
    expect(f.owner.snapshot().requests[0].phase).toBe('rejected');
    await f.owner.dismissRequest(f.owner.snapshot().requests[0]);expect(f.owner.snapshot().requests).toEqual([]);
    expect(send).toHaveBeenCalledTimes(1);expect(f.api.request).not.toHaveBeenCalled();await f.owner.close();
  });
  it('keeps a consented control across reopen and leaves selected-original cancellation on the legacy route',async()=>{
    const journal=memoryIntentJournal(),f=fixture(journal),consent={provider_config_revision:N,max_original_bytes:68};
    const send=vi.fn(async(input:SummaryMaterialControl)=>receipt(input.command));Object.assign(f.api,{controlWithMaterialConsent:send});
    const selected={...task(),state:'failed' as const,selection:{...snapshot().selection,selected_original_ids:[O]}};
    await f.owner.ready();await f.owner.act('retry',selected);expect(f.uuid).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();expect(f.api.control).not.toHaveBeenCalled();
    send.mockRejectedValueOnce(new BetaApiError('summary_transport','lost reply'));await f.owner.act('retry',selected,consent);
    const original=send.mock.calls[0][0];await f.owner.close();
    const next=fixture(journal),retried=vi.fn(async(input:SummaryMaterialControl)=>receipt(input.command));Object.assign(next.api,{controlWithMaterialConsent:retried});
    await next.owner.ready();await vi.waitFor(()=>expect(next.owner.snapshot().intents[0].phase).toBe('unknown'));expect(retried).not.toHaveBeenCalled();
    await next.owner.retryIntent(next.owner.snapshot().intents[0]);expect(retried).toHaveBeenCalledWith(original);expect(next.api.control).not.toHaveBeenCalled();expect(next.uuid).not.toHaveBeenCalled();
    await next.owner.act('cancel',{...selected,state:'running'});expect(next.api.control).toHaveBeenCalledTimes(1);expect(retried).toHaveBeenCalledTimes(1);await next.owner.close();
  });
  it('requires durable commit before any paid RPC and fences a late commit on a profile-switch request',async()=>{
    const journal=memoryIntentJournal(),gate=deferred<void>();journal.write.mockImplementationOnce(async(key,raw)=>{await gate.promise;journal.values.set(key,raw);});const f=fixture(journal);await f.owner.ready();
    const pending=f.owner.create('compressed_block',snapshot().selection);await vi.waitFor(()=>expect(journal.write).toHaveBeenCalledTimes(1));expect(f.api.request).not.toHaveBeenCalled();const original=f.owner.snapshot().requests[0].command;
    f.owner.fenceDispatch();gate.resolve();await pending;expect(f.api.request).not.toHaveBeenCalled();expect(decodeSummaryIntents(journal.values.get(summaryIntentKey(D,P))!,D,P)[0].command).toEqual(original);await f.owner.close();
    const next=fixture(journal);await next.owner.ready();await vi.waitFor(()=>expect(next.owner.snapshot().requests[0].phase).toBe('unknown'));expect(next.api.request).not.toHaveBeenCalled();expect(next.uuid).not.toHaveBeenCalled();await next.owner.retryRequest(next.owner.snapshot().requests[0]);expect(next.api.request.mock.calls[0][0]).toEqual(original);expect(next.owner.snapshot().requests[0].phase).toBe('committed');await next.owner.close();
  });
  it('restores an unknown paid request without replay and retries the same immutable IDs after explicit action',async()=>{
    const journal=memoryIntentJournal(),f=fixture(journal);await f.owner.ready();f.api.request.mockRejectedValueOnce(new BetaApiError('summary_transport','lost'));await f.owner.create('compressed_message',snapshot().selection);const original=f.api.request.mock.calls[0][0];expect(f.owner.snapshot().requests[0].phase).toBe('unknown');await f.owner.close();
    const next=fixture(journal);await next.owner.ready();await vi.waitFor(()=>expect(next.owner.snapshot().requests[0].phase).toBe('unknown'));expect(next.api.request).not.toHaveBeenCalled();await next.owner.create('compressed_message',snapshot().selection);expect(next.uuid).not.toHaveBeenCalled();await next.owner.retryRequest(next.owner.snapshot().requests[0]);expect(next.api.request.mock.calls[0][0]).toEqual(original);expect(Object.isFrozen(next.owner.snapshot().requests[0].command)).toBe(true);expect(next.owner.snapshot().requests[0].message).toContain('不代表模型已执行');await next.owner.close();
  });
  it('reconciles a saved request with a real matching receipt, without inventing a task ID or another paid call',async()=>{
    const journal=memoryIntentJournal(),store=await SummaryIntentJournal.open(D,P,journal),command=request();await store.put({operation:'request',kind:'create',command,phase:'unknown',receipt:null});await store.close();
    const f=fixture(journal);f.read.mockResolvedValue(receipt(command));await f.owner.ready();await vi.waitFor(()=>expect(f.owner.snapshot().requests[0].phase).toBe('committed'));expect(f.api.request).not.toHaveBeenCalled();expect(f.owner.snapshot().requests[0].command).not.toHaveProperty('task_id');expect(f.owner.snapshot().requests[0].receipt).toEqual(receipt(command));await f.owner.close();
  });
  it('preserves corrupt cache and disables paid writes, while an explicit cancellation uses fresh task state and a fixed in-memory command',async()=>{
    const journal=memoryIntentJournal();journal.values.set(summaryIntentKey(D,P),'broken-cache');const f=fixture(journal);await f.owner.ready();expect(f.owner.snapshot().persistence).toBe('failed');await f.owner.create('compressed_block',snapshot().selection);await f.owner.act('retry',{...task(),state:'failed'});expect(f.uuid).not.toHaveBeenCalled();expect(journal.write).not.toHaveBeenCalled();
    f.api.control.mockRejectedValueOnce(new BetaApiError('summary_transport','lost cancellation'));await f.owner.cancelWithoutJournal(task().task_id);const command=f.api.control.mock.calls[0][0];expect(f.api.task).toHaveBeenCalledWith(P,task().task_id);expect(command.action).toEqual({kind:'cancel'});expect(f.owner.snapshot().intents[0]).toMatchObject({recoveryOnly:true,phase:'unknown'});const count=f.uuid.mock.calls.length;
    await f.owner.retryIntent(f.owner.snapshot().intents[0]);expect(f.api.control.mock.calls[1][0]).toBe(command);expect(f.uuid).toHaveBeenCalledTimes(count);expect(f.owner.snapshot().tasks.every(item=>item.state!=='cancelled')).toBe(true);expect(f.api.request).not.toHaveBeenCalled();expect(journal.write).not.toHaveBeenCalled();expect(journal.values.get(summaryIntentKey(D,P))).toBe('broken-cache');await f.owner.close();
  });
  it('does not create a cancellation UUID when fresh state is already cancelled, and never overwrites a failed read with empty data',async()=>{
    const journal=memoryIntentJournal();journal.read.mockRejectedValue(new Error('read failed'));const f=fixture(journal);await f.owner.ready();f.api.task.mockResolvedValue({...task(),state:'cancelled'});await f.owner.cancelWithoutJournal(task().task_id);expect(f.uuid).not.toHaveBeenCalled();expect(f.api.control).not.toHaveBeenCalled();expect(journal.write).not.toHaveBeenCalled();await f.owner.close();
  });
  it('rejects wrong device/profile, unknown fields and altered same-ID payloads without importing secrets or weak storage',async()=>{
    const journal=memoryIntentJournal(),store=await SummaryIntentJournal.open(D,P,journal),command=control();await store.put({operation:'control',kind:'cancel',command,phase:'prepared',receipt:null});const raw=journal.values.get(summaryIntentKey(D,P))!;expect(()=>decodeSummaryIntents(raw,N,P)).toThrow();expect(()=>decodeSummaryIntents(raw,D,N)).toThrow();expect(()=>decodeSummaryIntents(JSON.stringify({...JSON.parse(raw),api_key:'synthetic-secret'}),D,P)).toThrow();await expect(store.put({operation:'control',kind:'cancel',command:{...command,event_id:D},phase:'unknown',receipt:null})).rejects.toThrow();expect(journal.values.get(summaryIntentKey(D,P))).toBe(raw);expect(raw).not.toContain('api_key');await store.close();
  });
  it('blocks RPC after a failed or late-closing durable write and preserves the original fixed request for recovery',async()=>{
    const journal=memoryIntentJournal();journal.write.mockRejectedValueOnce(new Error('disk failed'));const f=fixture(journal);await f.owner.ready();await f.owner.create('compressed_message',snapshot().selection);expect(f.api.request).not.toHaveBeenCalled();expect(f.owner.snapshot().persistence).toBe('failed');expect(f.owner.snapshot().requests[0].phase).toBe('unknown');await f.owner.close();
    const gate=deferred<void>(),nextJournal=memoryIntentJournal();nextJournal.write.mockImplementationOnce(async(key,raw)=>{await gate.promise;nextJournal.values.set(key,raw);});const next=fixture(nextJournal);await next.owner.ready();const pending=next.owner.create('compressed_block',snapshot().selection);await vi.waitFor(()=>expect(nextJournal.write).toHaveBeenCalledTimes(1));next.owner.dispose();gate.resolve();await pending;await next.owner.close();expect(next.api.request).not.toHaveBeenCalled();expect(decodeSummaryIntents(nextJournal.values.get(summaryIntentKey(D,P))!,D,P)).toHaveLength(1);
  });
});
