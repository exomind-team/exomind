import { describe, expect, it, vi } from 'vitest';
import { nativeBetaClient, webBetaClient } from '@/beta/client';
import { ORIGINAL_CHUNK_BYTES, type BetaBeginStage, type BetaStage } from '@/beta/original-types';

const command: BetaBeginStage = { stage_id:'stage', original_id:'original', profile_id:'profile', expected_sha256:'a'.repeat(64), byte_length:3, file_name:'unknown.raw', media_type:'application/octet-stream' };
const stage: BetaStage = { stage_id:command.stage_id, profile_id:command.profile_id, original:{original_id:command.original_id,sha256:command.expected_sha256,byte_length:3,file_name:command.file_name,media_type:command.media_type},state:'uploading',next_offset:0,generation:1 };
const hello = {protocol:'exomind-beta/1',device_id:'device',runtime_id:'run',running:true,capabilities:{originals:true,max_original_chunk_bytes:ORIGINAL_CHUNK_BYTES}};
const json = (body: unknown) => new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});

describe('Beta original transports', () => {
  it('uses direct Native stage commands and rejects wrong-profile stage replies', async () => {
    let wrong = false;
    const call = vi.fn(async (name: string) => name==='beta_status' ? hello : {...stage,profile_id:wrong?'other':command.profile_id});
    const client=nativeBetaClient(call as Parameters<typeof nativeBetaClient>[0]);
    expect(await client.originals!.begin(command)).toEqual(stage);
    expect(call).toHaveBeenCalledWith('beta_begin_stage',{command});
    wrong=true;
    await expect(client.originals!.status(command.profile_id,command.stage_id)).rejects.toMatchObject({code:'invalid_stage'});
  });
  it('negotiates originals before sending bytes and bounds chunks before invoking Native', async () => {
    const unsupported=vi.fn(async()=>({...hello,capabilities:{originals:false}}));
    const old=nativeBetaClient(unsupported as Parameters<typeof nativeBetaClient>[0]);
    await expect(old.originals!.begin(command)).rejects.toMatchObject({code:'unsupported_originals'});
    expect(unsupported).toHaveBeenCalledTimes(1);
    const call=vi.fn(async(name:string)=>name==='beta_status'?hello:stage);
    const client=nativeBetaClient(call as Parameters<typeof nativeBetaClient>[0]);
    await expect(client.originals!.write(command.profile_id,command.stage_id,0,new Uint8Array(ORIGINAL_CHUNK_BYTES+1))).rejects.toMatchObject({code:'invalid_chunk'});
    expect(call).not.toHaveBeenCalledWith('beta_write_stage_chunk',expect.anything());
  });
  it('puts raw HTTP bytes with a scoped grant and never a credential-bearing URL', async () => {
    const fetcher=vi.fn(async(url:RequestInfo|URL)=>String(url).endsWith('/hello')?json(hello):String(url).endsWith('/grants')?json({profile_id:command.profile_id,kind:'human',token:'scoped'}):json({...stage,next_offset:3}));
    const client=webBetaClient('http://localhost:4310','owner',fetcher);
    const bytes=new Uint8Array([0,255,13]);
    await client.originals!.write(command.profile_id,command.stage_id,0,bytes);
    const request=fetcher.mock.calls.find(([url])=>String(url).includes('/chunks?offset=0')) as unknown as [string,RequestInit];
    expect(request[1].headers).toMatchObject({Authorization:'Bearer scoped','Content-Type':'application/octet-stream'});
    expect(Array.from(new Uint8Array(request[1].body as ArrayBuffer))).toEqual([0,255,13]);
    expect(fetcher.mock.calls.every(([url])=>!String(url).includes('owner')&&!String(url).includes('scoped'))).toBe(true);
  });
  it('bounds and preserves raw binary reads and rejects a Native range from another offset', async () => {
    const fetcher=vi.fn(async(url:RequestInfo|URL)=>String(url).endsWith('/hello')?json(hello):String(url).endsWith('/grants')?json({profile_id:command.profile_id,kind:'human',token:'scoped'}):new Response(new Uint8Array([0,255,13]),{headers:{'Content-Type':'application/octet-stream'}}));
    const client=webBetaClient('http://localhost:4310','owner',fetcher);
    expect(Array.from(await client.originals!.readOriginal(command.profile_id,command.original_id,0,3))).toEqual([0,255,13]);
    const native=nativeBetaClient((async(name:string)=>name==='beta_status'?hello:{original:stage.original,offset:1,bytes:[0,255,13]}) as Parameters<typeof nativeBetaClient>[0]);
    await expect(native.originals!.readOriginal(command.profile_id,command.original_id,0,3)).rejects.toMatchObject({code:'invalid_original_range'});
    const oversized=webBetaClient('http://localhost:4310','owner',vi.fn(async(url:RequestInfo|URL)=>String(url).endsWith('/hello')?json(hello):String(url).endsWith('/grants')?json({profile_id:command.profile_id,kind:'human',token:'s'}):new Response(new Uint8Array(5),{headers:{'Content-Type':'application/octet-stream'}})));
    await expect(oversized.originals!.readOriginal(command.profile_id,command.original_id,0,3)).rejects.toMatchObject({code:'invalid_original_range'});
  });
});
