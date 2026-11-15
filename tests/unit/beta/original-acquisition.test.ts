import { describe,expect,it,vi } from 'vitest';
import { nativeOriginalAcquisition, originalAcquisitionError } from '@/beta/original-acquisition';

const P='11111111-1111-4111-8111-111111111111',O='22222222-2222-4222-8222-222222222222',D='33333333-3333-4333-8333-333333333333',R='44444444-4444-4444-8444-444444444444';
const original={original_id:O,sha256:'a'.repeat(64),byte_length:100,file_name:'fixture.raw',media_type:'application/octet-stream'};
const status={profile_id:P,original_id:O,original,availability:'missing',next_offset:0,byte_length:100,request_id:null,peer_device_id:null,transfer_state:'idle',last_error_code:null};
describe('Native on-demand original transport boundary',()=>{
  it('keeps metadata-only and partial bytes distinct from a complete original',async()=>{
    let reply:unknown=status;const call=vi.fn(async()=>reply);const client=nativeOriginalAcquisition(call as Parameters<typeof nativeOriginalAcquisition>[0]);
    expect((await client.status(P,O)).availability).toBe('missing');expect(call).toHaveBeenCalledWith('beta_peer_original_status',{profileId:P,originalId:O});
    reply={...status,availability:'partial',next_offset:100,request_id:R,peer_device_id:D,transfer_state:'verifying'};
    expect(await client.status(P,O)).toMatchObject({availability:'partial',transfer_state:'verifying'});
    for(const bad of [{...status,profile_id:D},{...status,original_id:D},{...status,availability:'complete',next_offset:99},{...status,next_offset:101},{...status,transfer_state:'receiving'},{...status,byte_length:99}]){
      reply=bad;await expect(client.status(P,O)).rejects.toMatchObject({code:'invalid_original_transfer_response'});
    }
  });
  it('sends an explicit source and distinct request UUID; cancellation never loses profile/original scope',async()=>{
    const call=vi.fn(async(name:string)=>name==='beta_peer_original_cancel'?true:{original,verified:true,resumed_from:40,transferred_bytes:60});
    const client=nativeOriginalAcquisition(call as Parameters<typeof nativeOriginalAcquisition>[0]);
    expect(await client.fetch(P,O,D,R)).toMatchObject({verified:true,resumed_from:40,transferred_bytes:60});
    expect(call).toHaveBeenCalledWith('beta_peer_original_fetch',{profileId:P,originalId:O,peerDeviceId:D,requestId:R});
    expect(await client.cancel(P,O,R)).toBe(true);expect(call).toHaveBeenLastCalledWith('beta_peer_original_cancel',{profileId:P,originalId:O,requestId:R});
    const count=call.mock.calls.length;await expect(client.fetch(P,O,D,'00000000-0000-0000-0000-000000000000')).rejects.toMatchObject({code:'invalid_original_transfer_response'});expect(call).toHaveBeenCalledTimes(count);
  });
  it('lists only sources whose membership is ready and does not start any transfer or pairing',async()=>{
    const peer={device_id:D,fingerprint_sha256:'b'.repeat(64),member_generation:1,member_state:'ready',connection_state:'waiting',endpoints:[],last_sync_at_ms:null,last_error_code:null,event_sync:'complete',originals_sync:'unknown'};
    const call=vi.fn(async()=>({runtime_id:R,device_id:O,profile_id:P,network_enabled:true,local_addresses:[],peers:[peer,{...peer,device_id:R,member_state:'revoked'}]}));
    const client=nativeOriginalAcquisition(call as Parameters<typeof nativeOriginalAcquisition>[0]);
    expect(await client.sources(P)).toEqual({network_enabled:true,devices:[D]});expect(call).toHaveBeenCalledTimes(1);expect(call).toHaveBeenCalledWith('beta_peer_status',{profileId:P});
  });
  it('discloses offline, denied and integrity failures without claiming success',()=>{
    expect(originalAcquisitionError('unreachable')).toContain('离线');expect(originalAcquisitionError({code:'membership_denied'})).toContain('授权');
    expect(originalAcquisitionError('original_hash_mismatch')).toContain('校验失败');expect(originalAcquisitionError('original_integrity_mismatch')).toContain('未作为可用原件');
  });
});
