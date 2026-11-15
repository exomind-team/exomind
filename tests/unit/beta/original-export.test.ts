import { afterEach, describe, expect, it, vi } from 'vitest';
import { nativeBetaClient } from '@/beta/client';
import { exportOriginalDownload, MAX_BASIC_DOWNLOAD_BYTES } from '@/beta/original-download';
import { nativeOriginalExports } from '@/beta/original-export';
import type { BetaOriginal } from '@/beta/original-types';
import { fakeClient } from './fixtures';

const original:BetaOriginal={original_id:'original',sha256:'a'.repeat(64),byte_length:MAX_BASIC_DOWNLOAD_BYTES+1,file_name:'large.raw',media_type:'application/octet-stream'};
const hello={protocol:'exomind-beta/1',device_id:'device',running:true,capabilities:{originals:true}};
const request='a8d00c7d-12bd-4df5-9c0b-e6339c31ba12';
afterEach(()=>{vi.restoreAllMocks();});

describe('Native original export stays outside Web Blob downloads',()=>{
  it('exports over 64 MiB through the Native picker without fetching bytes or constructing a Blob',async()=>{
    const blob=vi.spyOn(globalThis,'Blob');
    const call=vi.fn(async(name:string)=>{
      if(name==='beta_status')return hello;
      if(name==='beta_export_original')return{cancelled:false,byte_length:original.byte_length,sha256:original.sha256};
      throw new Error('unexpected byte fetch or command');
    });
    const client=nativeBetaClient(call as Parameters<typeof nativeBetaClient>[0]);
    expect(await exportOriginalDownload(client,'p',original,request)).toEqual({kind:'native',result:{cancelled:false,byte_length:original.byte_length,sha256:original.sha256}});
    expect(call).toHaveBeenCalledWith('beta_export_original',{profileId:'p',originalId:original.original_id,requestId:request});
    expect(call.mock.calls.map(([name])=>name)).toEqual(['beta_status','beta_export_original']);
    expect(blob).not.toHaveBeenCalled();
  });
  it('preserves cancellation and partial-output disclosure without falling back to Web',async()=>{
    const blob=vi.spyOn(globalThis,'Blob');
    const save=vi.fn(async()=>({cancelled:true as const,partial_output:true}));
    const client={...fakeClient(),originalExports:{save,cancel:async()=>true}};
    expect(await exportOriginalDownload(client,'p',original,request)).toEqual({kind:'native',result:{cancelled:true,partial_output:true}});
    expect(blob).not.toHaveBeenCalled();
  });
  it('never turns a Native failure or mismatched receipt into success or a Blob fallback',async()=>{
    const blob=vi.spyOn(globalThis,'Blob');
    const save=vi.fn(async()=>{throw new Error('export_incomplete');});
    const client={...fakeClient(),originalExports:{save,cancel:async()=>false}};
    await expect(exportOriginalDownload(client,'p',original,request)).rejects.toThrow('export_incomplete');
    const mismatch={...client,originalExports:{...client.originalExports,save:async()=>({cancelled:false as const,byte_length:3,sha256:original.sha256})}};
    await expect(exportOriginalDownload(mismatch,'p',original,request)).rejects.toMatchObject({code:'original_integrity'});
    expect(blob).not.toHaveBeenCalled();
  });
  it('retains the browser allocation ceiling before requesting any bytes',async()=>{
    await expect(exportOriginalDownload(fakeClient(),'p',original,request)).rejects.toMatchObject({code:'unsupported_capability'});
    const client=nativeBetaClient((async()=>hello)as Parameters<typeof nativeBetaClient>[0]);
    const read=vi.spyOn(client.originals!,'readOriginal');
    delete client.originalExports;
    await expect(exportOriginalDownload(client,'p',original,request)).rejects.toMatchObject({code:'download_too_large'});
    expect(read).not.toHaveBeenCalled();
  });
  it('passes exact request IDs to cancellation and rejects invented success/ambiguous replies',async()=>{
    let value:unknown=true;
    const call=vi.fn(async()=>value);
    const transport=nativeOriginalExports(call as Parameters<typeof nativeOriginalExports>[0]);
    expect(await transport.cancel(request)).toBe(true);
    expect(call).toHaveBeenCalledWith('beta_cancel_original_export',{requestId:request});
    value={cancelled:false,byte_length:original.byte_length,sha256:original.sha256,partial_output:true};
    await expect(transport.save('p',original.original_id,request)).rejects.toMatchObject({code:'invalid_export_response'});
    value={cancelled:true,partial_output:'maybe'};
    await expect(transport.save('p',original.original_id,request)).rejects.toMatchObject({code:'invalid_export_response'});
    value={success:true};
    await expect(transport.cancel(request)).rejects.toMatchObject({code:'invalid_export_response'});
  });
});
