import { describe,expect,it } from 'vitest';
import { BetaTimeblockController,timeblockClock } from '@/beta/timeblocks-controller';
import { deferred,memoryStorage } from './fixtures';
import { P,Q,D,B,C,revision,timeblockClient,activeSnapshot,snapshot,receipt } from './timeblock-fixtures';
import type { BetaReceipt } from '@/beta/client';

function fixture(){const client=timeblockClient();const storage=memoryStorage();let id=0;let now=0;
  const uuid=()=>`77777777-7777-4777-8777-${String(++id).padStart(12,'0')}`;
  const create=(profile=P)=>new BetaTimeblockController(client,D,profile,storage,{uuid,monotonicNow:()=>now});
  return{client,storage,create,advance:(ms:number)=>{now+=ms;}};}
describe('authoritative Beta timeblock controller',()=>{
  it('persists the entire start command before RPC; lost receipt/reopen retries exactly the old revision and IDs',async()=>{
    const f=fixture();const first=f.create();await first.refresh();first.setStartDraft({name:'original'});
    f.client.timeblocks.command.mockRejectedValueOnce({code:'network',message:'lost receipt'});await first.start();
    const input=f.client.timeblocks.command.mock.calls[0][0];first.dispose();
    const cache=f.storage.getItem(first.storageKey)!;expect(cache.includes(input.command_id)).toBe(true);
    const restored=f.create();expect(f.client.timeblocks.command).toHaveBeenCalledTimes(1);
    f.client.receipt.mockResolvedValueOnce(receipt(input));await restored.retry(input.command_id);
    expect(f.client.timeblocks.command).toHaveBeenCalledTimes(1);expect(restored.snapshot().pending).toHaveLength(0);
  });
  it('retries a missing receipt with identical action/revision even after a new service snapshot',async()=>{
    const f=fixture();const controller=f.create();await controller.refresh();controller.setStartDraft({name:'first'});
    f.client.timeblocks.command.mockRejectedValueOnce('offline');await controller.start();const original=f.client.timeblocks.command.mock.calls[0][0];
    f.client.timeblocks.snapshot.mockResolvedValue({...snapshot(),revision:'b'.repeat(64)});await controller.refresh();
    await controller.retry(original.command_id);
    expect(f.client.timeblocks.command.mock.calls[1][0]).toEqual(original);expect(original.expected_revision).toBe(revision);
  });
  it('late confirmation cannot clear a newer same-text start draft or another profile cache',async()=>{
    const f=fixture();const controller=f.create();await controller.refresh();controller.setStartDraft({name:'same'});
    const flight=deferred<BetaReceipt>();f.client.timeblocks.command.mockReturnValueOnce(flight.promise);const sending=controller.start();
    controller.setStartDraft({name:'same'});const q=f.create(Q);q.setStartDraft({name:'other profile'});
    flight.resolve(receipt(f.client.timeblocks.command.mock.calls[0][0]));await sending;
    expect(controller.snapshot().draft.name).toBe('same');expect(q.snapshot().draft.name).toBe('other profile');
  });
  it('does not advance a hard countdown into a local ending fact',async()=>{
    const f=fixture();f.client.timeblocks.snapshot.mockResolvedValue(activeSnapshot());const controller=f.create();await controller.refresh();
    f.advance(60_000);expect(timeblockClock(controller.snapshot().remote!,60_000).text).toBe('00:00');
    expect(f.client.timeblocks.command).not.toHaveBeenCalled();
  });
  it('a late old-block feedback confirmation cannot end the newer active block or clear its feedback draft',async()=>{
    const f=fixture();const remote={...activeSnapshot(),pending_feedback:[C]};f.client.timeblocks.snapshot.mockResolvedValue(remote);
    const controller=f.create();await controller.refresh();controller.setFeedbackDraft(C,'old feedback');controller.setFeedbackDraft(B,'new feedback');
    await controller.submitFeedback(C);
    expect(f.client.timeblocks.command.mock.calls[0][0].action).toEqual({kind:'submit_feedback',block_id:C,feedback:{kind:'text',text:'old feedback'}});
    expect(controller.snapshot().feedback[B].text).toBe('new feedback');expect(controller.snapshot().remote?.active?.block_id).toBe(B);
  });
  it('stops stale refreshes and disposed owners from overwriting a newer snapshot/draft',async()=>{
    const f=fixture();const slow=deferred<ReturnType<typeof snapshot>>();f.client.timeblocks.snapshot.mockReturnValueOnce(slow.promise);
    const controller=f.create();const old=controller.refresh();await Promise.resolve();
    await controller.refresh();slow.resolve({...snapshot(),revision:'f'.repeat(64)});await old;
    expect(controller.snapshot().remote?.revision).toBe(revision);controller.dispose();
    const fresh=f.create();fresh.setStartDraft({name:'fresh'});expect(fresh.snapshot().draft.name).toBe('fresh');
  });
  it('fails closed on quota or malformed cache, and never blind-resends when receipt lookup fails',async()=>{
    const f=fixture();const controller=f.create();await controller.refresh();controller.setStartDraft({name:'retain'});
    f.client.timeblocks.command.mockRejectedValueOnce('offline');await controller.start();const input=f.client.timeblocks.command.mock.calls[0][0];
    f.client.receipt.mockRejectedValueOnce('offline');await controller.retry(input.command_id);expect(f.client.timeblocks.command).toHaveBeenCalledTimes(1);
    const quota=new BetaTimeblockController(f.client,D,Q,{getItem:()=>null,setItem:()=>{throw new Error('quota');}});
    f.client.timeblocks.snapshot.mockResolvedValue({...snapshot(),profile_id:Q});await quota.refresh();quota.setStartDraft({name:'unsent'});
    await expect(quota.start()).rejects.toBeDefined();expect(f.client.timeblocks.command).toHaveBeenCalledTimes(1);
  });
});
