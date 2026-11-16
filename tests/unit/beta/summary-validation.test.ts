import { describe,expect,it } from 'vitest';
import { MAX_SUMMARY_CONFLICTS,MAX_SUMMARY_INPUT_ENCODED_BYTES } from '@/beta/summary-types';
import { validateSummaryArtifact,validateSummaryArtifactPage,validateSummaryArtifactRecord,validateSummaryControlCommand,validateSummaryReceipt,validateSummaryRequestCommand,validateSummarySelection,validateSummaryServiceStatus,validateSummarySnapshot,validateSummaryTask,validateSummaryTaskPage } from '@/beta/summary-validation';
import { A,B,C,D,E,N,O,P,R,T,artifact,control,manyIds,receipt,record,request,snapshot,task } from './summary-client-fixtures';

describe('summary strict scoped wire decoders',()=>{
  it('keeps cancelled/old-lifecycle task state separate from historical running attempts',()=>{
    for(const state of['cancelled','failed']as const){const value=task();value.state=state;value.reason=state==='failed'?'old_lifecycle':'cancelled';expect(validateSummaryTask(value,P,T).current_run?.attempt?.state).toBe('running');value.current_run!.snapshot!.sources=[];expect(()=>validateSummaryTask(value,P,T)).toThrow();}
    expect(validateSummaryTask({...task(),state:'waiting_configuration',current_run:{...task().current_run!,snapshot:null,attempt:null}},P,T).current_run?.snapshot).toBeNull();
    expect(()=>validateSummaryTask({...task(),state:'blocked'},P,T)).toThrow();expect(()=>validateSummaryTask({...task(),profile_id:N},P,T)).toThrow();expect(()=>validateSummaryTask({...task(),task_id:N},P,T)).toThrow();expect(()=>validateSummaryTask({...task(),ticket:'forbidden'},P,T)).toThrow();
  });
  it('checks safe counters and exact current-run selection without replacing the frozen snapshot',()=>{
    const value=task();value.current_run!.snapshot!.selection.to_ms=3000;expect(()=>validateSummaryTask(value,P,T)).toThrow();
    for(const patch of[{owner_generation:Number.MAX_SAFE_INTEGER+1},{created_at_ms:-1},{reason:'x'.repeat(65)},{current_run:undefined}])expect(()=>validateSummaryTask({...task(),...patch},P,T)).toThrow();
    const read=validateSummaryTask(task(),P,T);expect(read.current_run!.snapshot!.sources).toEqual(snapshot().sources);
  });
  it('allows all 66560 incomplete-graph conflict references and refuses only beyond the declared bound',()=>{
    const values=manyIds(MAX_SUMMARY_CONFLICTS);expect(validateSummaryTask({...task(),conflicts:values},P,T).conflicts).toHaveLength(MAX_SUMMARY_CONFLICTS);
    expect(()=>validateSummaryTask({...task(),conflicts:Array(MAX_SUMMARY_CONFLICTS+1)},P,T)).toThrow();expect(()=>validateSummaryTask({...task(),control_heads:manyIds(513)},P,T)).toThrow();
  });
  it('binds origin heads to P and keeps coverage material IDs unique/in scope and omitted IDs outside sources',()=>{
    const cases=[()=>{const value=snapshot();value.origin_heads[0].origin.profile_id=N;return value;},()=>{const value=snapshot();value.origin_heads.push(structuredClone(value.origin_heads[0]));return value;},()=>{const value=snapshot();value.coverage.metadata_only=[N];return value;},()=>{const value=snapshot();value.coverage.unread_originals=[O,O];return value;},()=>{const value=snapshot();value.coverage.omitted_source_ids=[E];return value;},()=>{const value=snapshot();value.coverage.read_failures=[N,N];return value;},()=>{const value=snapshot();value.coverage.missing_parents=[N,N];return value;}];
    for(const create of cases)expect(()=>validateSummarySnapshot(create(),P)).toThrow();
    const read=snapshot();read.coverage.read_failures=[E];read.coverage.missing_parents=[E];expect(validateSummarySnapshot(read,P).coverage.read_failures).toEqual([E]);
  });
  it('bounds source/material/input data and rejects unknown kinds, duplicate sources and implicit material selection',()=>{
    const tooLarge=snapshot();tooLarge.input_encoded_bytes=MAX_SUMMARY_INPUT_ENCODED_BYTES+1;expect(()=>validateSummarySnapshot(tooLarge,P)).toThrow();
    const duplicate=snapshot();duplicate.sources.push({...duplicate.sources[0]});expect(()=>validateSummarySnapshot(duplicate,P)).toThrow();
    const unknown=snapshot();unknown.sources[0].kind='summary/1';expect(()=>validateSummarySnapshot(unknown,P)).toThrow();
    const feedback=snapshot();feedback.feedback_ids=[E];expect(()=>validateSummarySnapshot(feedback,P)).toThrow();
    const selected=snapshot();selected.selection.selected_original_ids=[O];expect(()=>validateSummarySnapshot(selected,P)).toThrow();selected.materials[0].selected=true;expect(validateSummarySnapshot(selected,P).materials[0].selected).toBe(true);
    expect(()=>validateSummarySelection({...snapshot().selection,block_ids:[B,B]})).toThrow();expect(()=>validateSummarySelection({...snapshot().selection,selected_original_ids:undefined})).toThrow();
  });
  it('requires known evidence and permits read-original claims only for explicitly selected verified originals',()=>{
    const invalid=artifact();invalid.output.evidence=[N];expect(()=>validateSummaryArtifact(invalid,P,T)).toThrow();invalid.output.evidence=[];expect(()=>validateSummaryArtifact(invalid,P,T)).toThrow();
    const empty=artifact();empty.snapshot.sources=[];empty.output.evidence=[];expect(()=>validateSummaryArtifact(empty,P,T)).toThrow();
    const emptyRaw=record();emptyRaw.snapshot.sources=[];emptyRaw.output.evidence=[];expect(()=>validateSummaryArtifactRecord(emptyRaw,P)).toThrow();
    const value=artifact();value.output.read_original_ids=[O];expect(()=>validateSummaryArtifact(value,P,T)).toThrow();value.snapshot.selection.selected_original_ids=[O];value.snapshot.materials[0].selected=true;value.snapshot.materials[0].read_state='missing';expect(()=>validateSummaryArtifact(value,P,T)).toThrow();
    value.snapshot.materials[0].read_state='verified_available';expect(validateSummaryArtifact(value,P,T).output.read_original_ids).toEqual([O]);
    // The frozen pre-call disclosure can still say unread; output records the
    // later actual material use. They are not silently made mutually exclusive.
    expect(validateSummaryArtifact(value,P,T).snapshot.coverage.unread_originals).toEqual([O]);
  });
  it('bounds UTF-8 output/metadata/usage and rejects private keys instead of returning them as model metadata',()=>{
    const value=artifact();value.output.narrative='汉'.repeat(45000);expect(()=>validateSummaryArtifact(value,P,T)).toThrow();
    const usage=artifact();usage.output.usage.input_tokens=Number.MAX_SAFE_INTEGER+1;expect(()=>validateSummaryArtifact(usage,P,T)).toThrow();
    const empty=artifact();empty.output.narrative='  \n';expect(()=>validateSummaryArtifact(empty,P,T)).toThrow();
    const secret=artifact();expect(()=>validateSummaryArtifact({...secret,output:{...secret.output,model:{...secret.output.model,api_key:'synthetic-private'}}},P,T)).toThrow();
    const valid=validateSummaryArtifact(artifact(),P,T);expect(valid.output.usage).toEqual({input_tokens:0,output_tokens:null,provider_request_id:null});
  });
  it('does not turn an immutable record into a qualified view or invent current/reason fields',()=>{
    const raw=record();const decoded=validateSummaryArtifactRecord(raw,P);expect(Object.prototype.hasOwnProperty.call(decoded,'current')).toBe(false);expect(Object.prototype.hasOwnProperty.call(decoded,'reason')).toBe(false);
    expect(()=>validateSummaryArtifact(raw,P,T)).toThrow();expect(()=>validateSummaryArtifactRecord(artifact(),P)).toThrow();expect(()=>validateSummaryArtifactRecord({...raw,current:true},P)).toThrow();expect(()=>validateSummaryArtifactRecord({...raw,local_seq:0},P)).toThrow();
    expect(validateSummaryArtifact({...artifact(),current:false,reason:'historical_or_unqualified'},P,T).current).toBe(false);
  });
  it('validates task cursors/order and artifact cursor progress without inventing a local_seq for ArtifactView',()=>{
    expect(validateSummaryTaskPage({items:[task(),{...task(),task_id:N}],next_after:N},P,null,2).next_after).toBe(N);
    expect(()=>validateSummaryTaskPage({items:[{...task(),task_id:N},task()],next_after:T},P,null,2)).toThrow();expect(()=>validateSummaryTaskPage({items:[task()],next_after:N},P,null,1)).toThrow();expect(()=>validateSummaryTaskPage({items:[task()],next_after:T},P,T,1)).toThrow();
    expect(validateSummaryArtifactPage({items:[artifact()],next_before:2,highwater:4},P,T,null,1).next_before).toBe(2);
    expect(()=>validateSummaryArtifactPage({items:[artifact()],next_before:2,highwater:4},P,T,2,1)).toThrow();expect(()=>validateSummaryArtifactPage({items:[artifact(),artifact()],next_before:null,highwater:4},P,T,null,2)).toThrow();
    expect(validateSummaryArtifactPage({items:[],next_before:null,highwater:4},P,T,0,25).items).toEqual([]);
  });
  it('validates all human control variants and outgoing bounds before any IO',()=>{
    expect(validateSummaryRequestCommand(request())).toEqual(request());expect(validateSummaryControlCommand(control())).toEqual(control());
    for(const action of[{kind:'take_over_for_self',run_id:R,resume_cancelled:false},{kind:'resolve_owner',run_id:R,owner_device_id:D,resume_cancelled:true},{kind:'queue_update',run_id:R,selection:snapshot().selection,supersedes_artifact_id:A}])expect(validateSummaryControlCommand({...control(),action}).action).toEqual(action);
    expect(()=>validateSummaryControlCommand({...control(),action:{kind:'retry'}})).toThrow();expect(()=>validateSummaryControlCommand({...control(),expected_control_heads:manyIds(129)})).toThrow();expect(()=>validateSummaryControlCommand({...control(),expected_owner_generation:Number.MAX_SAFE_INTEGER})).toThrow();
    expect(()=>validateSummaryRequestCommand({...request(),artifact_kind:'external_summary'})).toThrow();expect(()=>validateSummaryRequestCommand({...request(),selection:{...snapshot().selection,block_ids:[B,N]}})).toThrow();
  });
  it('binds strict local receipts to command/event/P and keeps owner status a status rather than a result',()=>{
    const command=request();expect(validateSummaryReceipt(receipt(command),command).durability).toBe('local_committed');for(const change of[{event_id:E},{profile_id:N},{command_id:E},{local_seq:0},{durability:'peer_received'},{executor:'not-a-field'}])expect(()=>validateSummaryReceipt({...receipt(command),...change},command)).toThrow();
    expect(validateSummaryServiceStatus({running:false,active_profile_id:P,active_task_id:T,last_error_code:null}).running).toBe(false);expect(()=>validateSummaryServiceStatus({running:true,active_profile_id:P,active_task_id:null,last_error_code:null})).toThrow();expect(()=>validateSummaryServiceStatus({running:true,active_profile_id:null,active_task_id:null,last_error_code:null,api_key:'never-return'})).toThrow();
    expect(()=>validateSummaryTask({...task(),owner_device_id:'00000000-0000-0000-0000-000000000000'},P,T)).toThrow();expect(()=>validateSummaryTask({...task(),owner_control_event_id:C.toUpperCase()},P,T)).toThrow();
  });
});
