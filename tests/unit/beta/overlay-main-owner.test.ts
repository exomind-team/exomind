import { describe,expect,it,vi } from 'vitest';
import { MainOverlayOwner } from '@/beta/overlay/main-owner';
import type { OverlayAction,OverlayScope,OverlayTicket } from '@/beta/overlay/protocol';
import { BetaDraftController } from '@/beta/drafts';
import { BetaTimeblockController } from '@/beta/timeblocks-controller';
import { deferred,saved } from './fixtures';
import { memoryIntentJournal } from './timeblock-ui-fixtures';
import { P,Q,D,R,B,C,activeSnapshot,timeblockClient,receipt } from './timeblock-fixtures';

const scope:OverlayScope={device_id:D,runtime_id:R,profile_id:P,ui_owner_generation:C};
let sequence=0;
function ticket(action:OverlayAction,patch:Partial<OverlayScope>={}):OverlayTicket{
  return{ticket_id:crypto.randomUUID(),request:{request_id:crypto.randomUUID(),seq:++sequence,overlay_generation:B,scope:{...scope,...patch},expected_revision:'a'.repeat(64),action}};
}
async function fixture(){
  const client=timeblockClient();client.timeblocks.snapshot.mockResolvedValue(activeSnapshot());
  const capture=await BetaDraftController.open(client,D,{journal:memoryIntentJournal()});
  const focus=await BetaTimeblockController.open(client,D,P,{journal:memoryIntentJournal()});await focus.refresh();
  const committed=vi.fn(),validateTicket=vi.fn(async()=>{});const owner=new MainOverlayOwner({scope,client,capture,focus,validateTicket,onCommitted:committed});
  return{client,capture,focus,owner,committed,validateTicket,async close(){owner.dispose();await Promise.all([capture.close(),focus.close()]);}};
}
describe('Native verified tickets execute through the single Main owner',()=>{
  it('rechecks the Native-issued ticket immediately before mutation, including a revoked document generation',async()=>{
    const f=await fixture();try{f.validateTicket.mockRejectedValueOnce({code:'overlay_scope_changed',message:'document revoked'});
      expect(await f.owner.execute(ticket({kind:'pause',block_id:B}))).toMatchObject({ok:false,code:'overlay_scope_changed'});expect(f.client.timeblocks.command).not.toHaveBeenCalled();
    }finally{await f.close();}
  });
  it('freezes the verified body before any awaited checks so caller mutation cannot replace it',async()=>{
    const f=await fixture(),gate=deferred<void>();f.validateTicket.mockImplementationOnce(()=>gate.promise);
    try{const input=ticket({kind:'capture_edit',draft_revision:0,text:'frozen A'});const operation=f.owner.execute(input);
      await vi.waitFor(()=>expect(f.validateTicket).toHaveBeenCalledTimes(1));input.request.action={kind:'capture_edit',draft_revision:0,text:'mutated B'};gate.resolve();
      expect((await operation).ok).toBe(true);expect(f.capture.snapshot().drafts[P].text).toBe('frozen A');
    }finally{gate.resolve();await f.close();}
  });
  it('reuses the same in-flight verified ticket instead of generating another Core command',async()=>{
    const f=await fixture(),gate=deferred<ReturnType<typeof receipt>>();f.client.timeblocks.command.mockReturnValueOnce(gate.promise);
    try{
      const input=ticket({kind:'pause',block_id:B});const first=f.owner.execute(input),again=f.owner.execute(structuredClone(input));
      await vi.waitFor(()=>expect(f.client.timeblocks.command).toHaveBeenCalledTimes(1));const command=f.client.timeblocks.command.mock.calls[0][0];
      expect(command).toMatchObject({profile_id:P,expected_revision:input.request.expected_revision,action:{kind:'pause',block_id:B}});
      gate.resolve(receipt(command));expect((await first).ok).toBe(true);expect(await again).toEqual(await first);expect(f.committed).toHaveBeenCalledTimes(1);
    }finally{const command=f.client.timeblocks.command.mock.calls[0]?.[0];if(command)gate.resolve(receipt(command));await f.close();}
  });
  it('rejects changed content under the same Native ticket without replacing the first intent',async()=>{
    const f=await fixture();try{const first=ticket({kind:'capture_edit',draft_revision:0,text:'A'});expect((await f.owner.execute(first)).ok).toBe(true);
      const changed=structuredClone(first);changed.request.action={kind:'capture_edit',draft_revision:0,text:'B'};
      expect(await f.owner.execute(changed)).toMatchObject({ok:false,code:'overlay_request_conflict'});expect(f.capture.snapshot().drafts[P].text).toBe('A');expect(f.client.capture).not.toHaveBeenCalled();
    }finally{await f.close();}
  });
  it.each([{profile_id:Q},{runtime_id:B},{device_id:B},{ui_owner_generation:B}])('rejects an old or foreign binding %j',async patch=>{
    const f=await fixture();try{expect(await f.owner.execute(ticket({kind:'pause',block_id:B},patch))).toMatchObject({ok:false,code:'overlay_scope_changed'});expect(f.client.timeblocks.command).not.toHaveBeenCalled();}finally{await f.close();}
  });
  it('does not convert stale revision or a previous block control into a new current control',async()=>{
    const f=await fixture();try{const stale=ticket({kind:'pause',block_id:B});stale.request.expected_revision='b'.repeat(64);
      expect(await f.owner.execute(stale)).toMatchObject({ok:false,code:'overlay_revision_conflict'});
      expect(await f.owner.execute(ticket({kind:'end_action',block_id:C}))).toMatchObject({ok:false,code:'overlay_block_changed'});expect(f.client.timeblocks.command).not.toHaveBeenCalled();
    }finally{await f.close();}
  });
  it('preserves a newer Main draft when an Overlay capture receipt arrives late',async()=>{
    const f=await fixture(),gate=deferred<ReturnType<typeof saved>>();f.client.capture.mockReturnValueOnce(gate.promise);
    try{f.capture.setDraft(P,'sent A');await f.capture.flush();const input=ticket({kind:'capture',draft_revision:f.capture.snapshot().drafts[P].revision});const sending=f.owner.execute(input);
      await vi.waitFor(()=>expect(f.client.capture).toHaveBeenCalledTimes(1));f.capture.setDraft(P,'new B');await f.capture.flush();const command=f.client.capture.mock.calls[0][0];gate.resolve(saved(command));
      expect((await sending).ok).toBe(true);expect(f.capture.snapshot().drafts[P].text).toBe('new B');await f.owner.execute(input);expect(f.client.capture).toHaveBeenCalledTimes(1);
    }finally{const command=f.client.capture.mock.calls[0]?.[0];if(command)gate.resolve(saved(command));await f.close();}
  });
  it('uses compare-and-set for an Overlay edit while Main has already changed the same draft',async()=>{
    const f=await fixture();try{f.capture.setDraft(P,'Main latest');await f.capture.flush();expect(await f.owner.execute(ticket({kind:'capture_edit',draft_revision:0,text:'Overlay stale'}))).toMatchObject({ok:false,code:'overlay_draft_conflict'});
      expect(f.capture.snapshot().drafts[P].text).toBe('Main latest');expect(f.client.capture).not.toHaveBeenCalled();
    }finally{await f.close();}
  });
  it('revokes a ticket across an awaited identity check without issuing a late mutation',async()=>{
    const f=await fixture(),gate=deferred<Awaited<ReturnType<typeof f.client.status>>>();f.client.status.mockReturnValueOnce(gate.promise);
    try{const operation=f.owner.execute(ticket({kind:'pause',block_id:B}));f.owner.dispose();gate.resolve({protocol:'exomind-beta/1',device_id:D,runtime_id:R,running:true});
      expect(await operation).toMatchObject({ok:false,code:'overlay_scope_changed'});expect(f.client.timeblocks.command).not.toHaveBeenCalled();
    }finally{await f.close();}
  });
});
