import { describe,expect,it,vi } from 'vitest';
import { BetaTimeblockController } from '@/beta/timeblocks-controller';
import { deferred,memoryStorage } from './fixtures';
import { P,D,timeblockClient } from './timeblock-fixtures';
import type { LocalIntentJournal } from '@/beta/local-intent-journal';

describe('timeblock production intent journal',()=>{
  it('waits for the immutable pending command transaction, not merely the older draft ACK',async()=>{
    const client=timeblockClient();const older=deferred<void>(),pending=deferred<void>();const raws:string[]=[];
    const journal:LocalIntentJournal={read:async()=>null,write:vi.fn(async(_key,raw)=>{raws.push(raw);if(JSON.parse(raw).pending.length)await pending.promise;else if(raws.length===1)await older.promise;})};
    const owner=await BetaTimeblockController.open(client,D,P,{journal});await owner.refresh();owner.setStartDraft({name:'durable first'});
    const sending=owner.start();expect(client.timeblocks.command).not.toHaveBeenCalled();older.resolve();
    await vi.waitFor(()=>expect(raws.some(raw=>JSON.parse(raw).pending.length===1)).toBe(true));
    expect(client.timeblocks.command).not.toHaveBeenCalled();expect(owner.snapshot().persistenceState).toBe('pending');
    pending.resolve();await sending;
    const persisted=raws.map(raw=>JSON.parse(raw)).find(raw=>raw.pending.length===1).pending[0].command;
    expect(client.timeblocks.command.mock.calls[0][0]).toEqual(persisted);await owner.close();
  });
  it('uses the newer journal value over stale localStorage and never auto-submits during hydrate',async()=>{
    const client=timeblockClient();const newer=memoryStorage(),older=memoryStorage();
    const a=new BetaTimeblockController(client,D,P,newer);a.setStartDraft({name:'new strict draft'});
    const b=new BetaTimeblockController(client,D,P,older);b.setStartDraft({name:'old fallback'});
    const journal:LocalIntentJournal={read:async key=>newer.getItem(key),write:async(key,raw)=>newer.setItem(key,raw)};
    const restored=await BetaTimeblockController.open(client,D,P,{journal,legacy:older});
    expect(restored.snapshot().draft.name).toBe('new strict draft');expect(client.timeblocks.command).not.toHaveBeenCalled();await restored.close();
  });
  it('retains accepted local writes until close drains, and cancellation prevents later RPC',async()=>{
    const client=timeblockClient();const gate=deferred<void>();const values=new Map<string,string>();
    const journal:LocalIntentJournal={read:async key=>values.get(key)??null,write:async(key,raw)=>{await gate.promise;values.set(key,raw);}};
    const owner=await BetaTimeblockController.open(client,D,P,{journal});await owner.refresh();owner.setStartDraft({name:'accepted before close'});
    const sending=owner.start();let closed=false;const closing=owner.close().then(()=>{closed=true;});await Promise.resolve();
    expect(closed).toBe(false);gate.resolve();await closing;await sending;
    expect(client.timeblocks.command).not.toHaveBeenCalled();
    const next=await BetaTimeblockController.open(client,D,P,{journal});expect(next.snapshot().draft.name).toBe('accepted before close');await next.close();
  });
  it('fails closed on production journal open failure instead of opening empty or importing weak fallback',async()=>{
    const client=timeblockClient();const journal:LocalIntentJournal={read:async()=>{throw new Error('unavailable');},write:vi.fn()};
    await expect(BetaTimeblockController.open(client,D,P,{journal,legacy:{getItem:()=>null}})).rejects.toMatchObject({code:'intent_store_unavailable'});
    expect(journal.write).not.toHaveBeenCalled();expect(client.timeblocks.command).not.toHaveBeenCalled();
  });
});
