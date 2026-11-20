import { describe,expect,it,vi } from 'vitest';
import { BetaApiError } from '@/beta/api-error';
import { nativeSummaryClient,webSummaryClient } from '@/beta/summary-client';
import { A,B,D,E,N,O,P,R,T,artifact,control,identity,receipt,request,snapshot,task } from './summary-client-fixtures';

describe('summary client exact Native/HTTP boundary',()=>{
  it('uses separate consent envelopes in Native and HTTP without altering the Core commands',async()=>{
    const command={...request(),selection:{...request().selection,selected_original_ids:[O]}},consent={provider_config_revision:N,max_original_bytes:68};
    const action={...control(),action:{kind:'take_over_for_self' as const,run_id:R,resume_cancelled:false}};
    const hello=async()=>({...identity(),capabilities:{summary_jobs:true,summary_originals:true}});
    const call=vi.fn(async(_name:string,args?:Record<string,unknown>)=>receipt(args!.command as ReturnType<typeof request>));
    const native=nativeSummaryClient(call as Parameters<typeof nativeSummaryClient>[0],hello);
    await native.requestWithMaterialConsent!({command,consent});await native.controlWithMaterialConsent!({command:action,consent});
    expect(call).toHaveBeenCalledWith('beta_request_summary_with_material_consent',{command,consent});
    expect(call).toHaveBeenCalledWith('beta_control_summary_with_material_consent',{command:action,consent});
    const json=vi.fn(async(_profile:string,_path:string,_method:string,input?:unknown)=>receipt((input as {command:ReturnType<typeof request>}).command));
    const web=webSummaryClient({identity:hello,json});await web.requestWithMaterialConsent!({command,consent});await web.controlWithMaterialConsent!({command:action,consent});
    expect(json).toHaveBeenCalledWith(P,`/profiles/${P}/summaries/material-requests`,'POST',{command,consent});
    expect(json).toHaveBeenCalledWith(P,`/profiles/${P}/summaries/material-controls`,'POST',{command:action,consent});
    expect(command).not.toHaveProperty('consent');expect(action).not.toHaveProperty('consent');
  });
  it('rejects missing capability or invalid consent before sending and preserves the legacy text route',async()=>{
    const call=vi.fn(async(_name:string,args?:Record<string,unknown>)=>receipt(args!.command as ReturnType<typeof request>));
    const api=nativeSummaryClient(call as Parameters<typeof nativeSummaryClient>[0],async()=>identity());
    const command={...request(),selection:{...request().selection,selected_original_ids:[O]}},consent={provider_config_revision:N,max_original_bytes:68};
    await expect(api.requestWithMaterialConsent!({command,consent})).rejects.toMatchObject({code:'unsupported_summary_originals'});
    expect(call).not.toHaveBeenCalled();
    const ready=nativeSummaryClient(call as Parameters<typeof nativeSummaryClient>[0],async()=>({...identity(),capabilities:{summary_jobs:true,summary_originals:true}}));
    await expect(ready.requestWithMaterialConsent!({command,consent:{...consent,max_original_bytes:262145}})).rejects.toThrow();
    expect(call).not.toHaveBeenCalled();
    await api.request(request());expect(call).toHaveBeenCalledWith('beta_request_summary',{command:request()});
  });
  it('retains a stale provider rejection with a safe instruction to renew original consent',async()=>{
    const call=vi.fn(async()=>{throw new BetaApiError('model_configuration_conflict','synthetic-private-provider-path',409);});
    const api=nativeSummaryClient(call as Parameters<typeof nativeSummaryClient>[0],async()=>({...identity(),capabilities:{summary_jobs:true,summary_originals:true}}));
    await expect(api.requestWithMaterialConsent!({command:{...request(),selection:{...request().selection,selected_original_ids:[O]}},consent:{provider_config_revision:N,max_original_bytes:68}})).rejects.toMatchObject({code:'model_configuration_conflict',status:409,message:expect.stringContaining('重新核对原件')});
  });
  it('uses the exact Native commands/default cursors and returns receipts rather than pretending generation succeeded',async()=>{
    const call=vi.fn(async(name:string,args?:Record<string,unknown>)=>{
      if(name==='beta_status')return identity();if(name==='beta_summary_tasks')return{items:[task()],next_after:null};if(name==='beta_summary_task')return task();if(name==='beta_summary_artifacts')return{items:[artifact()],next_before:null,highwater:3};
      if(name==='beta_summary_block_selection')return snapshot().selection;if(name==='beta_request_summary'||name==='beta_control_summary')return receipt(args!.command as ReturnType<typeof request>);
      if(name==='beta_summary_service_status')return{running:true,active_profile_id:N,active_task_id:T,last_error_code:null};throw Error('unexpected command');
    });
    const client=nativeSummaryClient(call as Parameters<typeof nativeSummaryClient>[0]);
    expect((await client.tasks(P)).items).toHaveLength(1);expect(call).toHaveBeenCalledWith('beta_summary_tasks',{profileId:P,after:null,limit:25});
    await client.task(P,T);expect(call).toHaveBeenCalledWith('beta_summary_task',{profileId:P,taskId:T});
    await client.artifacts(P,T);expect(call).toHaveBeenCalledWith('beta_summary_artifacts',{profileId:P,taskId:T,before:null,limit:25});
    expect((await client.blockSelection(P,B)).selected_original_ids).toEqual([]);expect(call).toHaveBeenCalledWith('beta_summary_block_selection',{profileId:P,blockId:B});
    const command=request();expect(await client.request(command)).toEqual(receipt(command));expect(call).toHaveBeenCalledWith('beta_request_summary',{command});
    const action=control();expect(await client.control(action)).toEqual(receipt(action));expect(call).toHaveBeenCalledWith('beta_control_summary',{command:action});
    expect(await client.serviceStatus!()).toMatchObject({active_profile_id:N,running:true});expect(call).toHaveBeenCalledWith('beta_summary_service_status');
    expect(call.mock.calls.every(([name])=>name==='beta_status'||['beta_summary_tasks','beta_summary_task','beta_summary_artifacts','beta_summary_block_selection','beta_request_summary','beta_control_summary','beta_summary_service_status'].includes(name))).toBe(true);
  });
  it('rejects unsupported capability and malformed query/write arguments before sending a domain command',async()=>{
    const call=vi.fn(async()=>({}));const unavailable=nativeSummaryClient(call as Parameters<typeof nativeSummaryClient>[0],async()=>({...identity(),capabilities:{summary_jobs:false}}));
    await expect(unavailable.tasks(P)).rejects.toMatchObject({code:'unsupported_summaries'});expect(call).not.toHaveBeenCalled();
    const client=nativeSummaryClient(call as Parameters<typeof nativeSummaryClient>[0],async()=>identity());
    await expect(client.tasks(P,null,101)).rejects.toMatchObject({code:'invalid_summary_response'});await expect(client.artifacts(P,T,-1)).rejects.toMatchObject({code:'invalid_summary_request'});await expect(client.control({...control(),action:{kind:'cancel',run_id:R}as never})).rejects.toMatchObject({code:'invalid_summary_request'});expect(call).not.toHaveBeenCalled();
  });
  it('fences runtime/device replacements before returning data and never silently rebinds the same service',async()=>{
    let runtime=R;const call=vi.fn(async()=>{runtime=N;return task();});const client=nativeSummaryClient(call as Parameters<typeof nativeSummaryClient>[0],async()=>({...identity(),runtime_id:runtime}));
    await expect(client.task(P,T)).rejects.toMatchObject({code:'summary_service_changed'});await expect(client.task(P,T)).rejects.toMatchObject({code:'summary_service_changed'});expect(call).toHaveBeenCalledTimes(1);
    let device=D;const deviceCall=vi.fn(async()=>{device=N;return task();});await expect(nativeSummaryClient(deviceCall as Parameters<typeof nativeSummaryClient>[0],async()=>({...identity(),device_id:device})).task(P,T)).rejects.toMatchObject({code:'summary_service_changed'});
  });
  it('binds receipts and returned task/block scopes instead of accepting successful but unrelated responses',async()=>{
    let response:unknown={...receipt(request()),event_id:E};const call=vi.fn(async()=>response);const client=nativeSummaryClient(call as Parameters<typeof nativeSummaryClient>[0],async()=>identity());
    await expect(client.request(request())).rejects.toMatchObject({code:'invalid_summary_response'});response={...task(),profile_id:N};await expect(client.task(P,T)).rejects.toMatchObject({code:'invalid_summary_response'});
    response={...snapshot().selection,selected_original_ids:[A]};await expect(client.blockSelection(P,B)).rejects.toMatchObject({code:'invalid_summary_response'});
  });
  it('captures an outgoing command before awaiting identity so caller edits cannot change its P/payload midflight',async()=>{
    const command=request();const call=vi.fn(async(_name:string,args?:Record<string,unknown>)=>receipt(args!.command as ReturnType<typeof request>));const client=nativeSummaryClient(call as Parameters<typeof nativeSummaryClient>[0],async()=>identity());
    const pending=client.request(command);command.profile_id=N;command.selection.block_ids=[N];expect((await pending).profile_id).toBe(P);expect(call).toHaveBeenCalledWith('beta_request_summary',{command:expect.objectContaining({profile_id:P,selection:expect.objectContaining({block_ids:[B]})})});
  });
  it('uses scoped Beta HTTP routes and exposes the global service read only with explicit owner IO',async()=>{
    const json=vi.fn(async(_profile:string,path:string,method:string,body?:unknown)=>{
      if(method==='POST')return receipt(body as ReturnType<typeof request>);if(path.includes('/artifacts?'))return{items:[artifact()],next_before:null,highwater:3};if(path.includes('/summary-selection'))return snapshot().selection;if(path.includes('/tasks?'))return{items:[task()],next_after:null};return task();
    });const owner=vi.fn(async()=>({running:false,active_profile_id:null,active_task_id:null,last_error_code:null}));
    const client=webSummaryClient({identity:async()=>identity(),json,ownerJson:owner});await client.tasks(P,null,25);await client.task(P,T);await client.artifacts(P,T,9,10);await client.blockSelection(P,B);await client.request(request());await client.control(control());await client.serviceStatus!();
    expect(json.mock.calls.map(([,path,method])=>[path,method])).toEqual([[`/profiles/${P}/summaries/tasks?limit=25`,'GET'],[`/profiles/${P}/summaries/tasks/${T}`,'GET'],[`/profiles/${P}/summaries/tasks/${T}/artifacts?limit=10&before=9`,'GET'],[`/profiles/${P}/timeblocks/${B}/summary-selection`,'GET'],[`/profiles/${P}/summaries/requests`,'POST'],[`/profiles/${P}/summaries/controls`,'POST']]);
    expect(owner).toHaveBeenCalledWith('/summary-service','GET');expect(webSummaryClient({identity:async()=>identity(),json}).serviceStatus).toBeUndefined();
  });
  it('never promotes a forbidden scoped request to owner or exposes native/provider error bodies',async()=>{
    const owner=vi.fn(async()=>({}));const json=vi.fn(async()=>{throw new BetaApiError('forbidden','synthetic-private-path-key',403);});const client=webSummaryClient({identity:async()=>identity(),json,ownerJson:owner});
    await expect(client.request(request())).rejects.toMatchObject({code:'forbidden',status:403,message:'当前授权不允许此回顾操作'});expect(owner).not.toHaveBeenCalled();
    const native=nativeSummaryClient((async()=>{throw new Error('synthetic-provider-url-with-secret');})as Parameters<typeof nativeSummaryClient>[0],async()=>identity());await expect(native.task(P,T)).rejects.toMatchObject({code:'summary_transport',message:expect.not.stringContaining('synthetic-provider-url-with-secret')});
  });
});
