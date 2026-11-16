import { describe,expect,it,vi } from 'vitest';
import { parseSummaryModelConfiguration,SummaryModelConfigurationController,summaryModelCommand,type SummaryModelConfiguration,type SummaryModelConfigurationCommand } from '@/beta/summary-model-config';
import { nativeSummaryModelConfigurationService,webSummaryModelConfigurationService } from '@/beta/summary-model-client';
import { deferred } from './fixtures';

const P='11111111-1111-4111-8111-111111111111',Q='22222222-2222-4222-8222-222222222222',D='33333333-3333-4333-8333-333333333333',R='44444444-4444-4444-8444-444444444444',A='55555555-5555-4555-8555-555555555555',C='66666666-6666-4666-8666-666666666666',N='77777777-7777-4777-8777-777777777777';
const configuration:SummaryModelConfiguration={profile_id:P,revision:A,enabled:false,include_suggestions:false,base_url:'http://127.0.0.1:4000/v1',model:'synthetic-model',has_api_key:true,max_output_tokens:2048,timeout_ms:60000};
const identity=()=>({protocol:'exomind-beta/1',device_id:D,runtime_id:R,running:true});
function saved(command:SummaryModelConfigurationCommand,keyBefore=true):SummaryModelConfiguration{return{profile_id:P,revision:command.command_id,enabled:command.enabled,include_suggestions:command.include_suggestions,base_url:command.base_url,model:command.model,has_api_key:command.api_key.kind==='keep'?keyBefore:command.api_key.kind==='set',max_output_tokens:command.max_output_tokens,timeout_ms:command.timeout_ms};}
function fixture(){const service={read:vi.fn(async()=>configuration),save:vi.fn(async(_profile:string,command:SummaryModelConfigurationCommand)=>saved(command))};return{service,owner:new SummaryModelConfigurationController(service,D,P,()=>C)};}
describe('Beta summary model configuration without secret readback',()=>{
  it('keeps masked credentials by default and submits only supported fields with CAS and a stable command ID',async()=>{
    const f=fixture();await f.owner.load();expect(f.owner.snapshot().draft.newApiKey).toBe('');expect(f.owner.snapshot().draft.secretAction).toBe('keep');
    f.owner.edit(draft=>({...draft,enabled:true,includeSuggestions:true,model:'updated-model'}));await f.owner.save();
    expect(f.service.save).toHaveBeenCalledWith(P,{command_id:C,expected_revision:A,enabled:true,include_suggestions:true,base_url:configuration.base_url,model:'updated-model',api_key:{kind:'keep'},max_output_tokens:2048,timeout_ms:60000});
    expect(f.owner.snapshot()).toMatchObject({phase:'idle',requestPending:false,configuration:{revision:C,has_api_key:true,include_suggestions:true},draft:{newApiKey:'',secretAction:'keep'}});
    expect(f.owner.snapshot().notice).toContain('配置已保存');f.owner.dispose();
  });
  it('distinguishes keep/set/clear; an empty new key never silently clears a stored key',async()=>{
    const f=fixture();await f.owner.load();const draft=f.owner.snapshot().draft;
    expect(summaryModelCommand(configuration,{...draft,secretAction:'clear'},C).api_key).toEqual({kind:'clear'});
    expect(summaryModelCommand(configuration,{...draft,secretAction:'set',newApiKey:'synthetic new key'},C).api_key).toEqual({kind:'set',value:'synthetic new key'});
    expect(()=>summaryModelCommand(configuration,{...draft,secretAction:'set',newApiKey:''},C)).toThrow();
    f.owner.edit(value=>({...value,secretAction:'set',newApiKey:''}));await f.owner.save();expect(f.service.save).not.toHaveBeenCalled();expect(f.owner.snapshot().error).toContain('新密钥');f.owner.dispose();
  });
  it('retries an uncertain save with the same frozen payload/ID and never exposes a provider/native error body',async()=>{
    const f=fixture();await f.owner.load();f.service.save.mockRejectedValueOnce(new Error('synthetic-private-path-and-secret'));
    f.owner.edit(draft=>({...draft,secretAction:'set',newApiKey:'synthetic-write-only'}));await f.owner.save();expect(f.owner.snapshot().requestPending).toBe(true);
    expect(f.owner.edit(draft=>({...draft,model:'must-not-rebind-same-id'}))).toBe(false);expect(f.owner.snapshot().error).not.toContain('synthetic-private-path-and-secret');
    await f.owner.retry();expect(f.service.save.mock.calls[1][1]).toBe(f.service.save.mock.calls[0][1]);expect(f.owner.snapshot().draft.newApiKey).toBe('');expect(JSON.stringify(f.owner.snapshot().configuration)).not.toContain('synthetic-write-only');f.owner.dispose();
  });
  it('allows correction after the exact Host validation rejection, without reusing the rejected ID for changed fields',async()=>{
    const f=fixture();let index=0;const owner=new SummaryModelConfigurationController(f.service,D,P,()=>index++?N:C);await owner.load();f.service.save.mockRejectedValueOnce({code:'model_configuration_invalid',message:'synthetic-private-validation-body'});
    await owner.save();expect(owner.snapshot()).toMatchObject({phase:'failed',requestPending:false});expect(owner.snapshot().error).not.toContain('synthetic-private-validation-body');expect(owner.edit(draft=>({...draft,model:'corrected-model'}))).toBe(true);
    await owner.save();expect(f.service.save.mock.calls[1][1]).toMatchObject({command_id:N,model:'corrected-model'});owner.dispose();f.owner.dispose();
  });
  it('reconciles a committed save after a dropped response by reading its revision without sending another write',async()=>{
    const f=fixture();await f.owner.load();let applied:SummaryModelConfiguration|undefined;
    f.service.save.mockImplementationOnce(async(_profile,command)=>{applied=saved(command);throw new Error('response lost');});await f.owner.save();f.service.read.mockImplementationOnce(async()=>applied!);await f.owner.load();
    expect(f.service.save).toHaveBeenCalledTimes(1);expect(f.owner.snapshot()).toMatchObject({phase:'idle',requestPending:false,configuration:{revision:C}});f.owner.dispose();
  });
  it('never declares success from the right revision paired with different settings',async()=>{
    const f=fixture();await f.owner.load();f.service.save.mockResolvedValueOnce({...configuration,revision:C,model:'wrong receipt model'});await f.owner.save();expect(f.owner.snapshot()).toMatchObject({phase:'unconfirmed',requestPending:true,notice:null});
    f.service.read.mockResolvedValueOnce({...configuration,revision:C,model:'wrong receipt model'});await f.owner.load();expect(f.owner.snapshot()).toMatchObject({phase:'unconfirmed',requestPending:true,notice:null});expect(f.owner.snapshot().error).toContain('不一致');f.owner.dispose();
  });
  it('preserves a conflicting draft, then uses a new command ID with the refreshed revision only on explicit save',async()=>{
    const f=fixture();let ids=0;const owner=new SummaryModelConfigurationController(f.service,D,P,()=>ids++?N:C);await owner.load();owner.edit(draft=>({...draft,model:'retained-conflict-draft'}));f.service.save.mockRejectedValueOnce(new Error('CAS conflict'));await owner.save();
    f.service.read.mockResolvedValueOnce({...configuration,revision:R,model:'another-window-model'});await owner.load();expect(owner.snapshot()).toMatchObject({phase:'conflict',requestPending:false,draft:{model:'retained-conflict-draft'}});
    await owner.save();expect(f.service.save.mock.calls[1][1]).toMatchObject({command_id:N,expected_revision:R,model:'retained-conflict-draft'});owner.dispose();f.owner.dispose();
  });
  it('fences a disposed P editor response and does not overwrite the next Q editor or retain its entered key in the disposed snapshot',async()=>{
    const f=fixture();await f.owner.load();const gate=deferred<SummaryModelConfiguration>();f.service.save.mockReturnValueOnce(gate.promise);f.owner.edit(draft=>({...draft,secretAction:'set',newApiKey:'synthetic-transient-key'}));const pending=f.owner.save();await Promise.resolve();f.owner.dispose();
    const next=new SummaryModelConfigurationController({read:async()=>({...configuration,profile_id:Q,model:'Q model'}),save:async()=>{throw new Error('not requested');}},D,Q);await next.load();gate.resolve(saved(f.service.save.mock.calls[0][1]));await pending;
    expect(f.owner.snapshot().draft.newApiKey).toBe('');expect(next.snapshot()).toMatchObject({configuration:{profile_id:Q,model:'Q model'},draft:{newApiKey:''}});next.dispose();
  });
  it('rejects wrong scope, secret-bearing statuses, unsafe limits and credentials/query in endpoint URLs',()=>{
    for(const raw of[{...configuration,profile_id:Q},{...configuration,api_key:'must-never-be-returned'},{...configuration,include_suggestions:'yes'},{...configuration,max_output_tokens:0},{...configuration,timeout_ms:120001},{...configuration,base_url:'https://user:secret@synthetic.example/v1'},{...configuration,base_url:'https://synthetic.example/v1?token=synthetic'}])expect(()=>parseSummaryModelConfiguration(raw,P)).toThrow();
    expect(parseSummaryModelConfiguration({...configuration,revision:null,enabled:false,include_suggestions:false,base_url:'',model:'',has_api_key:false},P).has_api_key).toBe(false);
  });
  it('uses only exact Native config commands and rejects a runtime change instead of reporting a successful read',async()=>{
    const call=vi.fn(async(name:string)=>name==='beta_status'?identity():configuration);const service=nativeSummaryModelConfigurationService(call as Parameters<typeof nativeSummaryModelConfigurationService>[0]);await service.read(P);
    expect(call).toHaveBeenCalledWith('beta_summary_model_configuration',{profileId:P});expect(call.mock.calls.map(([name])=>name)).toEqual(['beta_status','beta_summary_model_configuration','beta_status']);
    const f=fixture();await f.owner.load();const command=summaryModelCommand(configuration,f.owner.snapshot().draft,C);await service.save(P,command);expect(call).toHaveBeenCalledWith('beta_configure_summary_model',{profileId:P,command});f.owner.dispose();
    let runtime=R;const changedCall=vi.fn(async()=>{runtime=N;return configuration;});const changed=nativeSummaryModelConfigurationService(changedCall as Parameters<typeof nativeSummaryModelConfigurationService>[0],async()=>({...identity(),runtime_id:runtime}));
    await expect(changed.read(P)).rejects.toMatchObject({code:'summary_model_service_changed'});await expect(changed.read(P)).rejects.toMatchObject({code:'summary_model_service_changed'});expect(changedCall).toHaveBeenCalledTimes(1);
  });
  it('uses owner-authenticated Beta HTTP config paths, never the model-provider URL',async()=>{
    const json=vi.fn(async(_profile:string,_path:string,method:string,body?:SummaryModelConfigurationCommand)=>method==='POST'?saved(body!):configuration);
    const service=webSummaryModelConfigurationService({identity:async()=>identity(),ownerJson:json});await service.read(P);const f=fixture();await f.owner.load();const command=summaryModelCommand(configuration,f.owner.snapshot().draft,C);await service.save(P,command);
    expect(json.mock.calls).toEqual([[P,`/profiles/${P}/summary-model`,'GET'],[P,`/profiles/${P}/summary-model`,'POST',command]]);f.owner.dispose();
  });
});
