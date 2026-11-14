import { act,fireEvent,render,screen,waitFor,cleanup } from '@testing-library/react';
import { afterEach,describe,expect,it,vi } from 'vitest';
import { BetaApp } from '@/beta/BetaApp';
import { BetaFocusTimer } from '@/beta/BetaFocusTimer';
import { BetaTimeblockController } from '@/beta/timeblocks-controller';
import { asyncDraftLocks,deferred } from './fixtures';
import { memoryIntentJournal } from './timeblock-ui-fixtures';
import { P,Q,D,R,B,C,snapshot,activeSnapshot,timeblockClient,receipt } from './timeblock-fixtures';
import type { BetaTimeblockSnapshot,BetaTimeblockCommand } from '@/beta/timeblocks-types';

afterEach(()=>{cleanup();vi.restoreAllMocks();});
describe('shared Alpha focus presentation with real Beta commands',()=>{
  it('keeps Start/Pause/Resume/End/feedback/skipped/append/Rotate as explicit scoped user actions',async()=>{
    const client=timeblockClient();let remote:BetaTimeblockSnapshot=snapshot();
    client.timeblocks.snapshot.mockImplementation(async()=>structuredClone(remote));
    client.timeblocks.command.mockImplementation(async(command:BetaTimeblockCommand)=>{
      const action=command.action;
      if(action.kind==='start'||action.kind==='rotate'){
        const spec=action.kind==='start'?action:action.next;
        remote={...remote,active:{block_id:spec.block_id,name:spec.name,note:spec.note,timer:spec.timer,phase:'running',work_ms:0,deadline_reached:false,deadline:null},pending_feedback:action.kind==='rotate'?[action.from_block_id]:remote.pending_feedback};
      }else if(action.kind==='pause'||action.kind==='resume')remote={...remote,active:{...remote.active!,phase:action.kind==='pause'?'paused':'running'}};
      else if(action.kind==='end_action')remote={...remote,active:{...remote.active!,phase:'feedback_pending'},pending_feedback:[...new Set([...remote.pending_feedback,action.block_id])]};
      else if(action.kind==='submit_feedback')remote={...remote,active:remote.active?.block_id===action.block_id?null:remote.active,pending_feedback:remote.pending_feedback.filter(id=>id!==action.block_id)};
      remote.revision=String(client.timeblocks.command.mock.calls.length).padStart(64,'0');return receipt(command);
    });
    const owner=await BetaTimeblockController.open(client,D,P,{journal:memoryIntentJournal()});
    const onCommitted=vi.fn();const ui=render(<BetaFocusTimer controller={owner} client={client} profileId={P} onCommitted={onCommitted}/>);
    try{
      fireEvent.click(await screen.findByTestId('new-focus-idle-card'));
      fireEvent.change(screen.getByTestId('new-focus-task-input'),{target:{value:'first block'}});
      await waitFor(()=>expect(screen.getByText('草稿已暂存 · 尚未提交')).toBeInTheDocument());
      fireEvent.click(screen.getByTestId('new-focus-start-button'));
      expect(await screen.findByTestId('new-focus-running-clock')).toBeInTheDocument();
      expect(screen.getByTestId('new-focus-running-name-display').tagName).toBe('SPAN');
      fireEvent.click(screen.getByTestId('new-focus-pause-resume-button'));
      await waitFor(()=>expect(screen.getByTestId('new-focus-pause-resume-button')).toHaveAttribute('aria-label','继续（Resume）'));
      fireEvent.click(screen.getByTestId('new-focus-pause-resume-button'));
      await waitFor(()=>expect(screen.getByTestId('new-focus-pause-resume-button')).toHaveAttribute('aria-label','暂停（Pause）'));
      fireEvent.click(screen.getByRole('button',{name:'切换时间块'}));
      fireEvent.change(screen.getByTestId('new-focus-task-input'),{target:{value:'next block'}});
      await waitFor(()=>expect(screen.getByTestId('new-focus-start-button')).toBeEnabled());
      fireEvent.click(screen.getByTestId('new-focus-start-button'));
      await waitFor(()=>expect(screen.getByTestId('new-focus-running-name-display')).toHaveTextContent('next block'));
      fireEvent.click(screen.getByTestId('new-focus-end-button'));
      const feedback=await screen.findByTestId('new-focus-feedback-textarea');
      fireEvent.change(feedback,{target:{value:'current feedback'}});
      await waitFor(()=>expect(screen.getByTestId('new-focus-feedback-confirm')).toBeEnabled());fireEvent.click(screen.getByTestId('new-focus-feedback-confirm'));
      await waitFor(()=>expect(screen.queryByTestId('new-focus-feedback-textarea')).not.toBeInTheDocument());
      const oldId=client.timeblocks.command.mock.calls[0][0].action;
      const firstId=oldId.kind==='start'?oldId.block_id:B;
      await waitFor(()=>expect(screen.getByRole('button',{name:`填写反馈 ${firstId.slice(0,8)}`})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:`填写反馈 ${firstId.slice(0,8)}`}));
      fireEvent.click(await screen.findByRole('button',{name:'明确跳过反馈'}));
      await waitFor(()=>expect(screen.queryByTestId('new-focus-feedback-textarea')).not.toBeInTheDocument());
      await waitFor(()=>expect(screen.getByRole('button',{name:'追加反馈'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'追加反馈'}));
      const appended=await screen.findByTestId('new-focus-feedback-textarea');fireEvent.change(appended,{target:{value:'later note'}});
      await waitFor(()=>expect(screen.getByTestId('new-focus-feedback-confirm')).toBeEnabled());fireEvent.click(screen.getByTestId('new-focus-feedback-confirm'));
      await waitFor(()=>expect(client.timeblocks.command.mock.calls.at(-1)?.[0].action.kind).toBe('append_feedback'));
      expect(client.timeblocks.command.mock.calls.map(([command])=>command.action.kind)).toEqual(['start','pause','resume','rotate','end_action','submit_feedback','submit_feedback','append_feedback']);
      expect(client.timeblocks.command.mock.calls.every(([command])=>command.profile_id===P)).toBe(true);
    }finally{ui.unmount();await owner.close();}
  });
  it('renders the mixed authoritative timeline rather than silently using the capture-only projection',async()=>{
    const locks=Object.getOwnPropertyDescriptor(navigator,'locks');Object.defineProperty(navigator,'locks',{configurable:true,value:asyncDraftLocks()});
    const client=timeblockClient();client.profiles.mockResolvedValue([{profile_id:P,display_name:'P'},{profile_id:Q,display_name:'Q'}]);
    const node={event_id:C,profile_id:P,device_id:D,source:{kind:'human' as const,author_id:R,owner_generation:null},parents:[],occurred_at_ms:1234,effective_at_ms:1234,clock:{epoch_id:R,elapsed_ms:0},payload:{kind:'action' as const,action:{kind:'start' as const,block_id:B,name:'real typed block',note:'',timer:{mode:'count_up' as const}}},digest:'b'.repeat(64),local_seq:1};
    const timelinePage=vi.fn(async()=>({items:[{kind:'timeblock' as const,record:node}],highwater:1,next_before:null}));
    const ui=render(<BetaApp client={{...client,timelinePage}} intentJournal={memoryIntentJournal()}/>);
    try{expect(await screen.findByText('开始时间块：real typed block')).toBeInTheDocument();expect(timelinePage).toHaveBeenCalledWith(P,{limit:100});expect(client.eventsPage).not.toHaveBeenCalled();}
    finally{ui.unmount();await act(async()=>{await Promise.resolve();});if(locks)Object.defineProperty(navigator,'locks',locks);else Reflect.deleteProperty(navigator,'locks');}
  });
  it('advances only presentation at zero and never sends a countdown ending',async()=>{
    const client=timeblockClient();client.timeblocks.snapshot.mockResolvedValue(activeSnapshot());
    const owner=await BetaTimeblockController.open(client,D,P,{journal:memoryIntentJournal(),monotonicNow:()=>60_000});await owner.refresh();
    const ui=render(<BetaFocusTimer controller={owner} client={client} profileId={P}/>);
    try{await screen.findByTestId('new-focus-running-clock');expect(client.timeblocks.command).not.toHaveBeenCalled();}
    finally{ui.unmount();await owner.close();}
  });
  it('holds the document writer lock until accepted local draft writes have completed on close',async()=>{
    const locks=Object.getOwnPropertyDescriptor(navigator,'locks');let releases=0;
    Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_name:string,_options:unknown,callback:(lock:Lock)=>Promise<void>)=>{try{await callback({} as Lock);}finally{releases++;}}}});
    const client=timeblockClient();client.profiles.mockResolvedValue([{profile_id:P,display_name:'P'}]);delete (client as {timeblocks?:unknown}).timeblocks;
    const gate=deferred<void>();const values=new Map<string,string>();const journal={read:async(key:string)=>values.get(key)??null,write:vi.fn(async(key:string,raw:string)=>{await gate.promise;values.set(key,raw);})};
    const ui=render(<BetaApp client={client} intentJournal={journal}/>);
    try{
      const input=await screen.findByRole('textbox',{name:'记录当下'});fireEvent.change(input,{target:{value:'accepted local draft'}});
      await waitFor(()=>expect(journal.write).toHaveBeenCalled());ui.unmount();await Promise.resolve();expect(releases).toBe(0);
      gate.resolve();await waitFor(()=>expect(releases).toBe(1));
      const raw=[...values.values()].map(value=>JSON.parse(value)).find(value=>value.drafts?.[P]);expect(raw.drafts[P].text).toBe('accepted local draft');expect(client.capture).not.toHaveBeenCalled();
    }finally{gate.resolve();ui.unmount();if(locks)Object.defineProperty(navigator,'locks',locks);else Reflect.deleteProperty(navigator,'locks');}
  });
  it('does not fall back to weak storage when the production journal cannot open',async()=>{
    const locks=Object.getOwnPropertyDescriptor(navigator,'locks');const idb=Object.getOwnPropertyDescriptor(globalThis,'indexedDB');
    Object.defineProperty(navigator,'locks',{configurable:true,value:asyncDraftLocks()});Object.defineProperty(globalThis,'indexedDB',{configurable:true,value:undefined});
    const client=timeblockClient();client.profiles.mockResolvedValue([{profile_id:P,display_name:'P'}]);const ui=render(<BetaApp client={client}/>);
    try{expect(await screen.findByRole('alert')).toHaveTextContent('草稿');expect(screen.queryByRole('textbox',{name:'记录当下'})).not.toBeInTheDocument();expect(client.capture).not.toHaveBeenCalled();}
    finally{ui.unmount();if(locks)Object.defineProperty(navigator,'locks',locks);else Reflect.deleteProperty(navigator,'locks');if(idb)Object.defineProperty(globalThis,'indexedDB',idb);else Reflect.deleteProperty(globalThis,'indexedDB');}
  });
  it('failed strict commit prevents profile switching without destroying the editable P draft',async()=>{
    const locks=Object.getOwnPropertyDescriptor(navigator,'locks');const manager=asyncDraftLocks();Object.defineProperty(navigator,'locks',{configurable:true,value:manager});
    const client=timeblockClient();client.profiles.mockResolvedValue([{profile_id:P,display_name:'P'},{profile_id:Q,display_name:'Q'}]);delete (client as {timeblocks?:unknown}).timeblocks;
    let fail=true;const values=new Map<string,string>();const journal={read:async(key:string)=>values.get(key)??null,write:async(key:string,raw:string)=>{if(fail)throw new Error('quota');values.set(key,raw);}};
    const ui=render(<BetaApp client={client} intentJournal={journal}/>);
    try{
      const input=await screen.findByRole('textbox',{name:'记录当下'});fireEvent.change(input,{target:{value:'retain P'}});
      await screen.findByRole('button',{name:'重试记录草稿暂存'});
      const select=screen.getByRole('combobox',{name:'当前档案'});fireEvent.change(select,{target:{value:Q}});
      await screen.findByText(/未切换档案/);expect(select).toHaveValue(P);expect(screen.getByRole('textbox',{name:'记录当下'})).toHaveValue('retain P');
      expect(manager.request).toHaveBeenCalledTimes(1);fireEvent.change(input,{target:{value:'retain P and keep editing'}});
      fail=false;fireEvent.change(select,{target:{value:Q}});await waitFor(()=>expect(select).toHaveValue(Q));await screen.findByRole('textbox',{name:'记录当下'});
      fireEvent.change(select,{target:{value:P}});await waitFor(()=>expect(select).toHaveValue(P));expect(await screen.findByRole('textbox',{name:'记录当下'})).toHaveValue('retain P and keep editing');
    }finally{fail=false;ui.unmount();await act(async()=>{await Promise.resolve();});if(locks)Object.defineProperty(navigator,'locks',locks);else Reflect.deleteProperty(navigator,'locks');}
  });
});
