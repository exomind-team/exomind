import { describe,expect,it,vi } from 'vitest';
import { nativeBetaClient,webBetaClient } from '@/beta/client';
import { validateDeadlineEnvelope } from '@/beta/timeblocks-validation';
import { P,Q,D,R,B,C,revision,status,snapshot,activeSnapshot,command,receipt,envelope } from './timeblock-fixtures';

const respond=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
describe('timeblock transports and typed reply boundaries',()=>{
  it('Native sends the real command/snapshot/node/interval/timeline IPC argument shapes',async()=>{
    const input=command();
    const call=vi.fn(async(name:string)=>name==='beta_status'?status():name==='beta_timeblock_command'?receipt(input):name==='beta_timeblock_snapshot'?snapshot():name==='beta_timeblock_intervals'?{items:[],revision,next_from_ms:null,complete:true}:{items:[],highwater:0,next_before:null});
    const client=nativeBetaClient(call as Parameters<typeof nativeBetaClient>[0]);
    await client.timeblocks!.command(input);await client.timeblocks!.snapshot(P);await client.timeblocks!.nodes(P,{limit:5});await client.timeblocks!.intervals(P,{from_ms:0,to_ms:100,limit:5});await client.timelinePage!(P,{limit:5});
    expect(call).toHaveBeenCalledWith('beta_timeblock_command',{command:input});
    expect(call).toHaveBeenCalledWith('beta_timeblock_snapshot',{profileId:P});
    expect(call).toHaveBeenCalledWith('beta_timeblock_nodes',{profileId:P,query:{limit:5}});
    expect(call).toHaveBeenCalledWith('beta_timeblock_intervals',{profileId:P,query:{from_ms:0,to_ms:100,limit:5}});
    expect(call).toHaveBeenCalledWith('beta_timeline_page',{profileId:P,query:{limit:5}});
  });
  it('checks anonymous capability before releasing owner credentials for new HTTP APIs',async()=>{
    const fetcher=vi.fn(async()=>respond({...status(),capabilities:{timeblocks:false}}));
    const client=webBetaClient('http://localhost:4310','owner-secret',fetcher);
    await expect(client.timeblocks!.snapshot(P)).rejects.toMatchObject({code:'unsupported_timeblocks'});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('HTTP uses the profile path/human grant and never sends caller clock or author',async()=>{
    const input=command();const fetcher=vi.fn(async(url:RequestInfo|URL)=>{
      if(String(url).endsWith('/hello'))return respond(status());
      if(String(url).endsWith('/grants'))return respond({profile_id:P,kind:'human',token:'human'});
      return respond(receipt(input));
    });
    const client=webBetaClient('http://localhost:4310','owner',fetcher);await client.timeblocks!.command(input);
    const calls=fetcher.mock.calls as unknown as [string,RequestInit][];
    const sent=calls.find(([url])=>url.endsWith(`/profiles/${P}/timeblocks/commands`))!;
    expect(sent[1].headers).toMatchObject({Authorization:'Bearer human'});
    expect(JSON.parse(sent[1].body as string)).toEqual({command_id:input.command_id,event_id:input.event_id,expected_revision:revision,action:input.action});
    expect(sent[0]).not.toContain('secret');
  });
  it('rejects wrong-profile snapshots and mismatched receipts rather than returning an idle success',async()=>{
    let response:unknown={...snapshot(),profile_id:Q};const input=command();
    const call=vi.fn(async(name:string)=>name==='beta_status'?status():response);const client=nativeBetaClient(call as Parameters<typeof nativeBetaClient>[0]);
    await expect(client.timeblocks!.snapshot(P)).rejects.toMatchObject({code:'invalid_timeblock_response'});
    response={...receipt(input),event_id:Q};
    await expect(client.timeblocks!.command(input)).rejects.toMatchObject({code:'invalid_receipt'});
  });
  it('does not accept a delayed read across a Host runtime replacement',async()=>{
    let statusReads=0;const call=vi.fn(async(name:string)=>name==='beta_status'?{...status(),runtime_id:statusReads++===0?R:Q}:snapshot());
    const client=nativeBetaClient(call as Parameters<typeof nativeBetaClient>[0]);
    await expect(client.timeblocks!.snapshot(P)).rejects.toMatchObject({code:'runtime_changed'});
  });
  it('rejects unknown typed-node kind, wrong page scope and inconsistent pagination',async()=>{
    let response:unknown={items:[{kind:'future_kind',record:{}}],highwater:1,next_before:null};
    const call=vi.fn(async(name:string)=>name==='beta_status'?status():response);const client=nativeBetaClient(call as Parameters<typeof nativeBetaClient>[0]);
    await expect(client.timelinePage!(P,{limit:5})).rejects.toMatchObject({code:'invalid_timeline'});
    response={items:[],highwater:9,next_before:null};
    await expect(client.timelinePage!(P,{through:8,limit:5})).rejects.toMatchObject({code:'invalid_timeline'});
    response={items:[{event_id:B,profile_id:Q,local_seq:1}],highwater:1,next_before:null};
    await expect(client.timeblocks!.nodes(P,{limit:5})).rejects.toMatchObject({code:'invalid_timeblock_response'});
  });
  it.each(['runtime','device','profile','revision','block','generation'] as const)('rejects a stale %s deadline envelope without scheduling anything',field=>{
    const value=structuredClone(envelope());
    if(field==='runtime')value.runtime_id=Q;else if(field==='device')value.device_id=Q;else if(field==='profile')value.profile_id=Q;else if(field==='revision')value.projection_revision='b'.repeat(64);else if(field==='block')value.block_id=Q;else value.deadline!.generation++;
    expect(()=>validateDeadlineEnvelope(value,{status:status(),snapshot:activeSnapshot()})).toThrow();
  });
  it('accepts the exact Native deadline envelope as read-only data',()=>{
    expect(validateDeadlineEnvelope(envelope(),{status:status(),snapshot:activeSnapshot()})).toMatchObject({device_id:D,block_id:B,deadline:{deadline_id:C}});
  });
  it('accepts a newer remaining-time sample with unchanged deadline identity and generation',()=>{
    const updated=envelope();updated.deadline!.remaining_ms=75;
    expect(validateDeadlineEnvelope(updated,{status:status(),snapshot:activeSnapshot()}).deadline?.remaining_ms).toBe(75);
  });
});
