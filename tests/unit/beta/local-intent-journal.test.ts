import {afterEach,describe,expect,it,vi} from 'vitest';
import {deferred,memoryStorage} from './fixtures';
afterEach(()=>vi.unstubAllGlobals());

describe('durable local intent bridge',()=>{
  it('hydrates from journal even when legacy storage rolled back, and waits for the commit acknowledgement',async()=>{
    const {openDurableIntentStorage}=await import('@/beta/local-intent-journal');
    const legacy=memoryStorage();legacy.setItem('exomind:beta:drafts:device','old');
    const gate=deferred<void>();const journal={read:vi.fn(async()=> 'committed'),write:vi.fn(async()=>gate.promise)};
    const storage=await openDurableIntentStorage({key:'exomind:beta:drafts:device',journal,legacy,validate:()=>{}});
    expect(storage.getItem('exomind:beta:drafts:device')).toBe('committed');
    storage.setItem('exomind:beta:drafts:device','newest');let done=false;const committed=storage.commit().then(()=>{done=true;});
    await Promise.resolve();expect(done).toBe(false);expect(storage.snapshot().state).toBe('pending');
    gate.resolve();await committed;expect(storage.snapshot().state).toBe('idle');
  });
  it('migrates only a validated legacy value and never returns a fake empty cache after read/migration failure',async()=>{
    const {openDurableIntentStorage}=await import('@/beta/local-intent-journal');
    const legacy=memoryStorage();const key='exomind:beta:drafts:device';legacy.setItem(key,'legacy raw');
    const gate=deferred<void>();const journal={read:vi.fn(async()=>null),write:vi.fn(async()=>gate.promise)};
    const opened=openDurableIntentStorage({key,journal,legacy,validate:raw=>{if(raw!=='legacy raw')throw Error('invalid');}});
    let hydrated=false;void opened.then(()=>{hydrated=true;}).catch(()=>{});await Promise.resolve();await Promise.resolve();expect(hydrated).toBe(false);
    gate.reject(new Error('quota'));await expect(opened).rejects.toBeDefined();expect(legacy.getItem(key)).toBe('legacy raw');
    journal.read.mockRejectedValueOnce(new Error('read unavailable'));
    await expect(openDurableIntentStorage({key,journal,legacy,validate:()=>{}})).rejects.toBeDefined();
  });
  it('serializes at most one in-flight write and coalesces the next snapshot without stale overwrite',async()=>{
    const {openDurableIntentStorage}=await import('@/beta/local-intent-journal');const key='exomind:beta:drafts:device';
    const first=deferred<void>();const writes:string[]=[];let active=0,maxActive=0;
    const journal={read:async()=>null,write:vi.fn(async(_key:string,raw:string)=>{active++;maxActive=Math.max(maxActive,active);writes.push(raw);if(writes.length===1)await first.promise;active--;})};
    const storage=await openDurableIntentStorage({key,journal,validate:()=>{}});
    storage.setItem(key,'a');storage.setItem(key,'b');storage.setItem(key,'c');const flush=storage.commit();
    first.resolve();await flush;expect(maxActive).toBe(1);expect(writes[writes.length-1]).toBe('c');expect(writes.length).toBeLessThanOrEqual(2);
  });
  it('keeps the newest snapshot after a failed write and retries only on an explicit commit',async()=>{
    const {openDurableIntentStorage}=await import('@/beta/local-intent-journal');const key='exomind:beta:drafts:device';
    const journal={read:async()=>null,write:vi.fn(async():Promise<void>=>{throw Error('quota');})};
    const storage=await openDurableIntentStorage({key,journal,validate:()=>{}});storage.setItem(key,'original');await expect(storage.commit()).rejects.toBeDefined();
    storage.setItem(key,'newest');expect(storage.getItem(key)).toBe('newest');expect(storage.snapshot().state).toBe('failed');
    journal.write.mockResolvedValue(undefined);await storage.commit();expect(journal.write).toHaveBeenLastCalledWith(key,'newest');expect(storage.snapshot().state).toBe('idle');
  });
});

describe('strict IndexedDB acknowledgement boundary',()=>{
  it('normalizes a synchronous indexedDB.open exception without exposing its text',async()=>{
    const {IndexedDbLocalIntentJournal}=await import('@/beta/local-intent-journal');
    vi.stubGlobal('indexedDB',{open:()=>{throw new DOMException('synthetic private detail','SecurityError');}});
    const journal=new IndexedDbLocalIntentJournal();const error=await journal.read('capture/device').catch(value=>value);
    expect(error).toMatchObject({code:'intent_store_unavailable'});expect(error.message).not.toContain('synthetic private detail');journal.close();
  });
  function controlled(durability='strict') {
    const request:{result?:unknown;onsuccess?:()=>void}={};
    const transaction={durability,oncomplete:undefined as undefined|(()=>void),onabort:undefined as undefined|(()=>void),onerror:undefined as undefined|(()=>void),abort:vi.fn(),objectStore:()=>({put:vi.fn(()=>request),get:vi.fn(()=>request)})};
    const database={objectStoreNames:{contains:()=>true},transaction:vi.fn(()=>transaction),close:vi.fn()};
    const opening:{result:typeof database;onsuccess?:()=>void;onerror?:()=>void;onblocked?:()=>void}={result:database};
    vi.stubGlobal('indexedDB',{open:()=>opening});return{request,transaction,database,opening};
  }
  it('does not acknowledge put request success until the strict transaction completes',async()=>{
    const {IndexedDbLocalIntentJournal}=await import('@/beta/local-intent-journal');const fake=controlled();const journal=new IndexedDbLocalIntentJournal();
    let done=false;const writing=journal.write('capture/device','{}').then(()=>{done=true;});fake.opening.onsuccess!();await Promise.resolve();
    fake.request.onsuccess!();await Promise.resolve();expect(done).toBe(false);
    fake.transaction.oncomplete!();await writing;expect(done).toBe(true);
    expect(fake.database.transaction).toHaveBeenCalledWith('intents','readwrite',{durability:'strict'});journal.close();
  });
  it('refuses an ignored strict option and preserves abort as failure after request success',async()=>{
    const {IndexedDbLocalIntentJournal}=await import('@/beta/local-intent-journal');const unsupported=controlled('default');const journal=new IndexedDbLocalIntentJournal();
    const writing=journal.write('capture/device','{}');unsupported.opening.onsuccess!();await expect(writing).rejects.toMatchObject({code:'intent_durability_unavailable'});expect(unsupported.transaction.abort).toHaveBeenCalled();journal.close();
    const fake=controlled();const next=new IndexedDbLocalIntentJournal();const aborted=next.write('capture/device','{}');fake.opening.onsuccess!();await Promise.resolve();fake.request.onsuccess!();fake.transaction.onabort!();
    await expect(aborted).rejects.toMatchObject({code:'intent_commit_failed'});next.close();
  });
});
