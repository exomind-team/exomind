import { describe, expect, it, vi } from 'vitest';
import { nativeBetaPeersClient } from '@/beta/peers-client';

const P='11111111-1111-4111-8111-111111111111';
const D='22222222-2222-4222-8222-222222222222';
const R='33333333-3333-4333-8333-333333333333';
const B='44444444-4444-4444-8444-444444444444';
const I='55555555-5555-4555-8555-555555555555';
const peer=()=>({device_id:B,fingerprint_sha256:'a'.repeat(64),member_generation:2,member_state:'ready',connection_state:'idle',endpoints:['127.0.0.1:4310'],last_sync_at_ms:null,last_error_code:null,event_sync:'pending',originals_sync:'unknown'});
const status=()=>({runtime_id:R,device_id:D,profile_id:P,network_enabled:true,local_addresses:['127.0.0.1:4310'],peers:[peer()]});

describe('Native peer management boundary',()=>{
  it('uses the explicit main-window command arguments without URL or storage credentials',async()=>{
    const call=vi.fn(async(name:string)=>name==='beta_peer_status'?status():name==='beta_peer_create_invitation'?{invitation_text:'opaque-secret',invitation_id:I,expires_at_ms:2000,local_addresses:[]}:name==='beta_peer_inspect_invitation'?{profile_id:P,profile_name:'P',issuer_device_id:B,fingerprint_sha256:'a'.repeat(64),expires_at_ms:2000,compatible:true,requires_replacement:true,endpoints:[{endpoint:'10.0.0.2:43344',disposition:'unreachable',elapsed_ms:1000,error_code:'timeout'}]}:name==='beta_peer_join_invitation'?{profile_id:P,peer_device_id:B,state:'ready'}:null);
    const client=nativeBetaPeersClient(call);
    await client.status(P);await client.setEnabled(false);await client.createInvitation(P,B);
    expect(await client.inspectInvitation('opaque-secret')).toMatchObject({requires_replacement:true});
    await client.joinInvitation('opaque-secret');await client.sync(P,B);await client.revoke(P,B,2);
    await client.joinInvitation('opaque-secret','192.0.2.3:43344');
    expect(call).toHaveBeenCalledWith('beta_peer_status',{profileId:P});
    expect(call).toHaveBeenCalledWith('beta_peer_set_enabled',{enabled:false});
    expect(call).toHaveBeenCalledWith('beta_peer_create_invitation',{profileId:P,peerDeviceId:B});
    expect(call).toHaveBeenCalledWith('beta_peer_inspect_invitation',{invitationText:'opaque-secret'});
    expect(call).toHaveBeenCalledWith('beta_peer_join_invitation',{invitationText:'opaque-secret'});
    expect(call).toHaveBeenCalledWith('beta_peer_join_invitation',{invitationText:'opaque-secret',dialAddress:'192.0.2.3:43344'});
    expect(call).toHaveBeenCalledWith('beta_peer_revoke',{profileId:P,peerDeviceId:B,expectedGeneration:2});
  });
  it('rejects wrong profile, duplicate devices, unknown states and malformed identities',async()=>{
    let reply:unknown={...status(),profile_id:B};const client=nativeBetaPeersClient(vi.fn(async()=>reply));
    await expect(client.status(P)).rejects.toMatchObject({code:'invalid_peer_response'});
    reply={...status(),peers:[peer(),peer()]};await expect(client.status(P)).rejects.toMatchObject({code:'invalid_peer_response'});
    reply={...status(),peers:[{...peer(),event_sync:'healthy'}]};await expect(client.status(P)).rejects.toMatchObject({code:'invalid_peer_response'});
    reply={...status(),device_id:'00000000-0000-0000-0000-000000000000'};await expect(client.status(P)).rejects.toMatchObject({code:'invalid_peer_response'});
  });
});

describe('Nearby device discovery boundary',()=> {
  it('reads only short-lived unverified candidates without a profile argument',async()=>{
    const candidate={device_id:B,addresses:['127.0.0.1:4310'],expires_at_ms:Date.now()+20_000,verification_state:'unverified'};
    let reply:unknown=[candidate];
    const call=vi.fn(async(name:string)=>name==='beta_peer_nearby_candidates'?reply:null);
    const client=nativeBetaPeersClient(call);

    expect(await client.nearbyCandidates()).toEqual([candidate]);
    expect(call).toHaveBeenCalledWith('beta_peer_nearby_candidates');

    reply=[{...candidate,profile_name:'private profile name'}];
    await expect(client.nearbyCandidates()).rejects.toMatchObject({code:'invalid_peer_response'});
    for (const invalid of [
      [candidate,candidate],
      [{...candidate,addresses:[candidate.addresses[0],candidate.addresses[0]]}],
      [{...candidate,addresses:Array.from({length:5},(_,index)=>`127.0.0.1:${4310+index}`)}],
      [{...candidate,verification_state:'verified'}],
      [{...candidate,expires_at_ms:0}],
      Array.from({length:65},()=>candidate),
    ]) {
      reply=invalid;
      await expect(client.nearbyCandidates()).rejects.toMatchObject({code:'invalid_peer_response'});
    }
  });
});

describe('Invitation preview endpoint reports',()=> {
  it('accepts bounded endpoint reports and preserves per-route failure',async()=>{
    const reply={
      profile_id:P,profile_name:'P',issuer_device_id:D,fingerprint_sha256:'a'.repeat(64),
      expires_at_ms:10,compatible:true,
      endpoints:[
        {endpoint:'127.0.0.1:43344',disposition:'skipped',elapsed_ms:0,error_code:'loopback_not_shareable'},
        {endpoint:'10.0.0.2:43344',disposition:'unreachable',elapsed_ms:2000,error_code:'timeout'},
      ],
    };
    const client=nativeBetaPeersClient(vi.fn(async()=>reply));
    await expect(client.inspectInvitation('invite')).resolves.toMatchObject({endpoints:expect.any(Array)});
  });
  it('accepts an empty endpoint report list when no shareable route exists',async()=>{
    const reply={profile_id:P,profile_name:'P',issuer_device_id:D,fingerprint_sha256:'a'.repeat(64),expires_at_ms:10,compatible:true,endpoints:[]};
    const client=nativeBetaPeersClient(vi.fn(async()=>reply));
    await expect(client.inspectInvitation('invite')).resolves.toMatchObject({endpoints:[]});
  });
  it('rejects unknown fields, duplicates, too many endpoints and malformed report values',async()=>{
    const endpoint=(overrides:Record<string,unknown>={})=>({endpoint:'10.0.0.2:43344',disposition:'unreachable',elapsed_ms:1,error_code:'timeout',...overrides});
    const base={profile_id:P,profile_name:'P',issuer_device_id:D,fingerprint_sha256:'a'.repeat(64),expires_at_ms:10,compatible:true,endpoints:[endpoint()]};
    const cases:unknown[]=[
      {...base,endpoints:[endpoint({extra:true})]},
      {...base,endpoints:[endpoint(),endpoint({disposition:'reachable',error_code:null})]},
      {...base,endpoints:Array.from({length:9},(_,index)=>endpoint({endpoint:`10.0.0.${index}:43344`}))},
      {...base,endpoints:[endpoint({disposition:'mystery'})]},
      {...base,endpoints:[endpoint({elapsed_ms:-1})]},
      {...base,endpoints:[endpoint({elapsed_ms:1.5})]},
      {...base,endpoints:[endpoint({error_code:''})]},
      {...base,endpoints:[endpoint({endpoint:'not-a-socket-address'})]},
      {...base,endpoints:[endpoint({disposition:'reachable',error_code:'timeout'})]},
    ];
    let reply:unknown=base;
    const client=nativeBetaPeersClient(vi.fn(async()=>reply));
    for(const value of cases){
      reply=value;
      await expect(client.inspectInvitation('invite')).rejects.toMatchObject({code:'invalid_peer_response'});
    }
  });
  it('validates join failure details instead of passing malformed endpoint reports through',async()=>{
    const endpoint={endpoint:'10.0.0.2:43344',disposition:'unreachable',elapsed_ms:1,error_code:'timeout'};
    const failure={code:'unreachable',message:'没有可用的连接来源',endpoints:[endpoint]};
    const client=nativeBetaPeersClient(vi.fn(async()=>Promise.reject(failure)));
    await expect(client.joinInvitation('invite')).rejects.toMatchObject({
      code:'unreachable',
      message:'没有可用的连接来源',
      endpoints:[endpoint],
    });

    const malformed=nativeBetaPeersClient(vi.fn(async()=>Promise.reject({
      ...failure,
      endpoints:[endpoint,{...endpoint,disposition:'reachable'}],
    })));
    await expect(malformed.joinInvitation('invite')).rejects.toMatchObject({code:'invalid_peer_response'});
  });
});

describe('Nearby scan boundary',()=> {
  const S='66666666-6666-4666-8666-666666666666';
  const scope=()=>({scope_id:'eth0:192.168.1.0/24',interface_name:'eth0',kind:'physical_lan',prefix:24,eligible:true,network:'192.168.1.0/24',reason:null});
  const scan=(overrides:Record<string,unknown>={})=>({
    scan_id:S,started_at_ms:1000,finished_at_ms:2000,stage:'complete',scopes:[scope()],
    attempted:10,discovered:2,skipped:1,cancelled:false,discovered_addresses:['192.168.1.7:43344'],...overrides,
  });
  it('reads network enabled without a profile argument',async()=>{
    let reply:unknown=true;
    const call=vi.fn(async(name:string)=>name==='beta_peer_network_enabled'?reply:null);
    const client=nativeBetaPeersClient(call);
    expect(await client.networkEnabled()).toBe(true);
    expect(call).toHaveBeenCalledWith('beta_peer_network_enabled');
    reply='yes';
    await expect(client.networkEnabled()).rejects.toMatchObject({code:'invalid_peer_response'});
  });
  it('reads selectable scopes and normalizes manual CIDR arguments',async()=>{
    let reply:unknown=[scope(),{scope_id:'et_4_tcod:10.137.0.0/24',interface_name:'et_4_tcod',kind:'overlay',prefix:24,eligible:true,network:'10.137.0.0/24',reason:null}];
    const call=vi.fn(async(name:string,args?:Record<string,unknown>)=>{
      if(name==='beta_peer_scan_scopes')return reply;
      if(name==='beta_peer_scan_start')return scan({finished_at_ms:0,stage:'tcp_probe',discovered_addresses:[],attempted:0,discovered:0});
      return null;
    });
    const client=nativeBetaPeersClient(call);
    expect(await client.scanScopes()).toEqual(reply);
    await client.scanNearby({scopeIds:['eth0:192.168.1.0/24','et_4_tcod:10.137.0.0/24'],manualCidrs:['10.137.0.2/24']});
    expect(call).toHaveBeenCalledWith('beta_peer_scan_start',{scopeIds:['eth0:192.168.1.0/24','et_4_tcod:10.137.0.0/24'],manualCidrs:['10.137.0.2/24']});
  });
  it('accepts multiple scopes from the same interface name with distinct scope ids',async()=>{
    const reply=[
      scope(),
      {scope_id:'eth0:10.0.0.0/24',interface_name:'eth0',kind:'physical_lan',prefix:24,eligible:true,network:'10.0.0.0/24',reason:null},
    ];
    const client=nativeBetaPeersClient(vi.fn(async()=>reply));
    expect(await client.scanScopes()).toHaveLength(2);
  });
  it('rejects malformed scopes, stages, counts and duplicate endpoints',async()=>{
    const cases:unknown[]=[
      [{...scope(),kind:'mystery'}],
      [{...scope(),eligible:true,network:''}],
      [{...scope(),reason:'Bad Reason'}],
      [{...scope()},{...scope()}],
    ];
    let reply:unknown=[scope()];
    const client=nativeBetaPeersClient(vi.fn(async()=>reply));
    for(const value of cases){
      reply=value;
      await expect(client.scanScopes()).rejects.toMatchObject({code:'invalid_peer_response'});
    }
    const scanCases:unknown[]=[
      scan({stage:'tcp_probe',finished_at_ms:2000}),
      scan({stage:'complete',finished_at_ms:0}),
      scan({attempted:2,discovered:3}),
      scan({discovered_addresses:['192.168.1.7:43344','192.168.1.7:43344']}),
      scan({discovered_addresses:Array.from({length:65},(_,i)=>`192.168.1.${i+1}:43344`)}),
      scan({cancelled:true,stage:'complete'}),
      scan({scopes:[scope(),scope()]}),
    ];
    reply=scan();
    const scanClient=nativeBetaPeersClient(vi.fn(async()=>reply));
    for(const value of scanCases){
      reply=value;
      await expect(scanClient.scanStatus(S)).rejects.toMatchObject({code:'invalid_peer_response'});
    }
  });
  it('passes scan ids through scan status and cancel commands',async()=>{
    let mode='status';
    const call=vi.fn(async(name:string,args?:Record<string,unknown>)=>{
      if(name==='beta_peer_scan_status'||name==='beta_peer_scan_cancel')return scan({stage:mode==='cancel'?'cancelled':'complete',cancelled:mode==='cancel',finished_at_ms:3000});
      return null;
    });
    const client=nativeBetaPeersClient(call);
    await client.scanStatus(S);
    expect(call).toHaveBeenCalledWith('beta_peer_scan_status',{scanId:S});
    mode='cancel';
    const cancelled=await client.cancelScan(S);
    expect(cancelled.cancelled).toBe(true);
    expect(call).toHaveBeenCalledWith('beta_peer_scan_cancel',{scanId:S});
  });
});
