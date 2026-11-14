import { act,cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { NativeIntentJournal } from '@/beta/native-intent-journal';
import { ExistingBrowserIntentJournal,openDurableIntentStorage } from '@/beta/local-intent-journal';
import { BetaDraftController } from '@/beta/drafts';
import { BetaTimeblockController } from '@/beta/timeblocks-controller';
import { BetaApp } from '@/beta/BetaApp';
import { asyncDraftLocks,deferred,fakeClient,memoryStorage,saved } from './fixtures';
import { memoryIntentJournal } from './timeblock-ui-fixtures';
import type { BetaReceipt } from '@/beta/client';
import { P,Q,D,timeblockClient } from './timeblock-fixtures';

const platform=vi.hoisted(()=>({native:false,invoke:vi.fn()}));
vi.mock('@tauri-apps/api/core',async(importOriginal)=>({...await importOriginal<typeof import('@tauri-apps/api/core')>(),isTauri:()=>platform.native,invoke:platform.invoke}));
const originalLocks=Object.getOwnPropertyDescriptor(navigator,'locks');
beforeEach(()=>{localStorage.clear();platform.native=false;platform.invoke.mockReset();Object.defineProperty(navigator,'locks',{configurable:true,value:asyncDraftLocks()});});
afterEach(()=>{cleanup();vi.unstubAllGlobals();platform.native=false;if(originalLocks)Object.defineProperty(navigator,'locks',originalLocks);else Reflect.deleteProperty(navigator,'locks');});
const key='exomind:beta:drafts:device-a';
function cached(text:string){const store=memoryStorage();const owner=new BetaDraftController(fakeClient(),'device-a',store);owner.setDraft('p',text);owner.dispose();return store.getItem(key)!;}

describe('Native private SQLite intent adapter and recovery',()=>{
  it('treats primary Native raw as authoritative without touching broken IDB/predecessor/LS',async()=>{
    const call=vi.fn(async(name:string)=>name==='beta_read_local_intent'?'new raw':null);
    const journal=new NativeIntentJournal(call as ConstructorParameters<typeof NativeIntentJournal>[0]);
    const predecessor={read:vi.fn(async()=>{throw new Error('corrupt browser');})};const legacy={getItem:vi.fn(()=>{throw new Error('weak cache');})};
    const storage=await openDurableIntentStorage({key,journal,predecessor,legacy,validate:()=>{}});
    expect(storage.getItem(key)).toBe('new raw');storage.setItem(key,'next raw');await storage.commit();
    expect(call).toHaveBeenCalledWith('beta_read_local_intent',{key});expect(call).toHaveBeenCalledWith('beta_write_local_intent',{key,raw:'next raw'});
    expect(call.mock.calls.every(([name])=>name==='beta_read_local_intent'||name==='beta_write_local_intent')).toBe(true);
    expect(predecessor.read).not.toHaveBeenCalled();expect(legacy.getItem).not.toHaveBeenCalled();storage.close();
  });
  it('preserves structured IPC failures and never falls back to a browser journal',async()=>{
    const call=vi.fn(async()=>{throw{code:'local_intent_unavailable',message:'本机缓存不可用'};});const predecessor={read:vi.fn(async()=>null)};
    const journal=new NativeIntentJournal(call as ConstructorParameters<typeof NativeIntentJournal>[0]);
    await expect(openDurableIntentStorage({key,journal,predecessor,legacy:{getItem:()=> 'old'},validate:()=>{}})).rejects.toMatchObject({code:'local_intent_unavailable',message:'本机缓存不可用'});
    expect(predecessor.read).not.toHaveBeenCalled();
  });
  it('reads only an enumerated existing browser DB and does not create a missing predecessor',async()=>{
    const factory={databases:vi.fn(async()=>[]),open:vi.fn(()=>{throw new Error('must not open');})};vi.stubGlobal('indexedDB',factory);
    expect(await new ExistingBrowserIntentJournal().read(key)).toBeNull();expect(factory.open).not.toHaveBeenCalled();
  });
  it('aborts a predecessor upgrade if Chromium deletes the DB after enumeration',async()=>{
    const abort=vi.fn();const opening={onupgradeneeded:null as null|(()=>void),onerror:null,onsuccess:null,onblocked:null,transaction:{abort}};
    const factory={databases:async()=>[{name:'exomind-beta-local-intents',version:1}],open:vi.fn(()=>opening)};vi.stubGlobal('indexedDB',factory);
    const reading=new ExistingBrowserIntentJournal().read(key);await vi.waitFor(()=>expect(factory.open).toHaveBeenCalledWith('exomind-beta-local-intents'));
    opening.onupgradeneeded!();await expect(reading).rejects.toMatchObject({code:'intent_predecessor_unavailable'});expect(abort).toHaveBeenCalledTimes(1);
  });
  it('keeps the Native write error category through the required commit gate',async()=>{
    const call=vi.fn(async(name:string)=>{if(name==='beta_read_local_intent')return'old';throw{code:'local_intent_full',message:'本机缓存空间不足'};});
    const journal=new NativeIntentJournal(call as ConstructorParameters<typeof NativeIntentJournal>[0]);const storage=await openDurableIntentStorage({key,journal,validate:()=>{}});
    storage.setItem(key,'latest');await expect(storage.commit()).rejects.toMatchObject({code:'local_intent_full',message:'本机缓存空间不足'});expect(storage.getItem(key)).toBe('latest');storage.close();
  });
  it('copies a valid predecessor to primary and waits for Native write confirmation before editing',async()=>{
    const gate=deferred<void>();const primary={read:vi.fn(async()=>null),write:vi.fn(async()=>gate.promise)};
    const legacy={getItem:vi.fn(()=> 'older')};let ready=false;
    const opening=openDurableIntentStorage({key,journal:primary,predecessor:{read:async()=> 'newer browser'},legacy,validate:raw=>{if(raw!=='newer browser')throw new Error('bad');}}).then(value=>{ready=true;return value;});
    await vi.waitFor(()=>expect(primary.write).toHaveBeenCalledWith(key,'newer browser'));expect(ready).toBe(false);expect(legacy.getItem).not.toHaveBeenCalled();
    gate.resolve();const storage=await opening;expect(storage.getItem(key)).toBe('newer browser');storage.close();
  });
  it('requires explicit recovery for missing strong caches plus weak raw, preserving the original weak value',async()=>{
    const journal=memoryIntentJournal(),legacy=memoryStorage();legacy.setItem(key,'old value');
    await expect(openDurableIntentStorage({key,journal,predecessor:{read:async()=>null},legacy,validate:()=>{}})).rejects.toMatchObject({code:'intent_recovery_required'});
    expect(journal.write).not.toHaveBeenCalled();
    const restored=await openDurableIntentStorage({key,journal,predecessor:{read:async()=>null},legacy,allowLegacyImport:true,validate:()=>{}});
    expect(restored.getItem(key)).toBe('old value');expect(legacy.getItem(key)).toBe('old value');restored.close();
  });
  it('does not authorize LS recovery when a predecessor read or value is bad',async()=>{
    const journal=memoryIntentJournal(),legacy={getItem:vi.fn(()=> 'old')};
    await expect(openDurableIntentStorage({key,journal,predecessor:{read:async()=>{throw new Error('corruption');}},legacy,allowLegacyImport:true,validate:()=>{}})).rejects.toMatchObject({code:'intent_predecessor_unavailable'});
    await expect(openDurableIntentStorage({key,journal,predecessor:{read:async()=> 'bad'},legacy,allowLegacyImport:true,validate:()=>{throw new Error('bad raw');}})).rejects.toMatchObject({code:'intent_cache_corrupt'});
    expect(legacy.getItem).not.toHaveBeenCalled();expect(journal.write).not.toHaveBeenCalled();
  });
  it('production Native selection hydrates IPC primary despite browser storage failure',async()=>{
    platform.native=true;platform.invoke.mockImplementation(async(name:string)=>name==='beta_read_local_intent'?cached('Native primary draft'):null);
    vi.stubGlobal('indexedDB',{databases:()=>{throw new Error('browser engine corruption');}});
    const client=fakeClient();const ui=render(<BetaApp client={client}/>);
    try{expect(await screen.findByRole('textbox',{name:'记录当下'})).toHaveValue('Native primary draft');expect(client.capture).not.toHaveBeenCalled();}
    finally{ui.unmount();await act(async()=>{await Promise.resolve();});}
  });
  it('offers explicit weak-cache recovery with an honest missing-recent-input warning and no auto capture',async()=>{
    const raw=cached('older cached draft');localStorage.setItem(key,raw);const journal=memoryIntentJournal(),client=fakeClient();
    const ui=render(<BetaApp client={client} intentJournal={journal}/>);
    try{
      expect(await screen.findByRole('button',{name:'恢复旧缓存（保留原缓存）'})).toBeInTheDocument();expect(screen.queryByRole('textbox',{name:'记录当下'})).not.toBeInTheDocument();
      expect(screen.getByText(/^旧缓存可能缺少最近输入或原件源/)).toBeInTheDocument();expect(client.capture).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button',{name:'恢复旧缓存（保留原缓存）'}));expect(await screen.findByRole('textbox',{name:'记录当下'})).toHaveValue('older cached draft');
      expect(localStorage.getItem(key)).toBe(raw);expect(journal.values.get(key)).toBe(raw);expect(client.capture).not.toHaveBeenCalled();
    }finally{ui.unmount();await act(async()=>{await Promise.resolve();});}
  });
  it('does not carry a P recovery confirmation into Q timeblock drafts',async()=>{
    const client=timeblockClient();client.profiles.mockResolvedValue([{profile_id:P,display_name:'P'},{profile_id:Q,display_name:'Q'}]);
    const p=new BetaTimeblockController(client,D,P,localStorage);p.setStartDraft({name:'older P draft'});p.dispose();
    const q=new BetaTimeblockController(client,D,Q,localStorage);q.setStartDraft({name:'older Q draft'});q.dispose();
    const journal=memoryIntentJournal();const ui=render(<BetaApp client={client} intentJournal={journal}/>);
    try{
      fireEvent.click(await screen.findByRole('button',{name:'恢复旧缓存（保留原缓存）'}));
      await screen.findByRole('textbox',{name:'记录当下'});
      await waitFor(()=>expect(screen.getByRole('combobox',{name:'当前档案'})).toBeEnabled());
      fireEvent.change(screen.getByRole('combobox',{name:'当前档案'}),{target:{value:Q}});
      expect(await screen.findByRole('button',{name:'恢复旧缓存（保留原缓存）'})).toBeInTheDocument();
      expect(screen.queryByRole('textbox',{name:'记录当下'})).not.toBeInTheDocument();
      expect(journal.values.has(p.storageKey)).toBe(true);expect(journal.values.has(q.storageKey)).toBe(false);
      expect(localStorage.getItem(q.storageKey)).toContain('older Q draft');expect(client.timeblocks.command).not.toHaveBeenCalled();
    }finally{ui.unmount();await act(async()=>{await Promise.resolve();});}
  });
  it('timeblock factory migrates predecessor before exposing a draft and preserves Native primary authority',async()=>{
    const client=timeblockClient(),legacy=memoryStorage();const older=new BetaTimeblockController(client,D,P,legacy);older.setStartDraft({name:'from predecessor'});older.dispose();
    const raw=legacy.getItem(older.storageKey)!;const journal=memoryIntentJournal(),gate=deferred<void>();
    journal.write.mockImplementation(async(key,raw)=>{await gate.promise;journal.values.set(key,raw);});
    const predecessor={read:vi.fn(async()=>raw)};let ready=false;
    const opening=BetaTimeblockController.open(client,D,P,{journal,predecessor,legacy:{getItem:()=>{throw new Error('must not read LS');}}}).then(owner=>{ready=true;return owner;});
    await vi.waitFor(()=>expect(journal.write).toHaveBeenCalledWith(older.storageKey,raw));expect(ready).toBe(false);
    gate.resolve();const migrated=await opening;expect(migrated.snapshot().draft.name).toBe('from predecessor');await migrated.close();
    predecessor.read.mockRejectedValueOnce(new Error('now corrupt'));
    const reopened=await BetaTimeblockController.open(client,D,P,{journal,predecessor,legacy:{getItem:()=>{throw new Error('must not read LS');}}});
    expect(predecessor.read).toHaveBeenCalledTimes(1);expect(reopened.snapshot().draft.name).toBe('from predecessor');expect(client.timeblocks.command).not.toHaveBeenCalled();await reopened.close();
  });
  it('Native journal reopen and an old receipt cannot consume a newer draft',async()=>{
    const values=new Map<string,string>();const call=vi.fn(async(name:string,args?:Record<string,unknown>)=>{if(name==='beta_read_local_intent')return values.get(String(args!.key))??null;values.set(String(args!.key),String(args!.raw));return null;});
    const journal=new NativeIntentJournal(call as ConstructorParameters<typeof NativeIntentJournal>[0]);const client=fakeClient();const flight=deferred<BetaReceipt>();client.capture.mockReturnValueOnce(flight.promise);
    const first=await BetaDraftController.open(client,'device-a',{journal});first.setDraft('p','old');const sending=first.submit('p');await vi.waitFor(()=>expect(client.capture).toHaveBeenCalledTimes(1));
    const command=client.capture.mock.calls[0][0];first.setDraft('p','newer');await first.flush();await first.close();
    const reopened=await BetaDraftController.open(client,'device-a',{journal});flight.resolve(saved(command));await sending;client.receipt.mockResolvedValueOnce(saved(command));await reopened.retry(command.command_id);await reopened.flush();
    expect(reopened.snapshot().drafts.p.text).toBe('newer');expect(client.capture).toHaveBeenCalledTimes(1);expect(JSON.parse(values.get(key)!).drafts.p.text).toBe('newer');await reopened.close();
  });
});
