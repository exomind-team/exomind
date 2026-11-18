import { act,fireEvent,render,screen,waitFor,cleanup } from '@testing-library/react';
import { afterEach,describe,expect,it,vi } from 'vitest';
import { BetaApp } from '@/beta/BetaApp';
import { BetaFocusTimer } from '@/beta/BetaFocusTimer';
import { BetaTimeblockController } from '@/beta/timeblocks-controller';
import { nativeBetaPeersClient } from '@/beta/peers-client';
import { asyncDraftLocks,deferred } from './fixtures';
import { memoryIntentJournal } from './timeblock-ui-fixtures';
import { P,Q,D,R,B,C,snapshot,activeSnapshot,timeblockClient,receipt } from './timeblock-fixtures';
import type { BetaTimeblockSnapshot,BetaTimeblockCommand } from '@/beta/timeblocks-types';

afterEach(()=>{cleanup();vi.restoreAllMocks();});
describe('shared Alpha focus presentation with real Beta commands',()=>{
  it('24b0368d: keeps hydrated controls stable during a snapshot read but disables them on a read failure',async()=>{
    const client=timeblockClient();client.timeblocks.snapshot.mockResolvedValue(activeSnapshot());
    const owner=await BetaTimeblockController.open(client,D,P,{journal:memoryIntentJournal()});
    const ui=render(<BetaFocusTimer controller={owner} client={client} profileId={P}/>);
    let pending:ReturnType<typeof deferred<ReturnType<typeof snapshot>>>|undefined;
    try{
      const append=await screen.findByRole('button',{name:'追加反馈'});
      await waitFor(()=>expect(append).toBeEnabled());
      const select=screen.getByRole('combobox',{name:'反馈时间块'});
      pending=deferred<ReturnType<typeof snapshot>>();client.timeblocks.snapshot.mockReturnValueOnce(pending.promise);
      fireEvent.click(screen.getByRole('button',{name:'刷新时间块'}));
      await waitFor(()=>expect(owner.snapshot().loading).toBe(true));
      expect(append).toBeEnabled();expect(screen.getByTestId('new-focus-pause-resume-button')).toBeEnabled();
      expect(screen.getByRole('combobox',{name:'反馈时间块'})).toBe(select);
      await act(async()=>{pending!.resolve(activeSnapshot());});
      client.timeblocks.snapshot.mockRejectedValueOnce({code:'network',message:'read failed'});
      fireEvent.click(screen.getByRole('button',{name:'刷新时间块'}));
      await screen.findByText('read failed');expect(append).toBeDisabled();
      expect(client.timeblocks.command).not.toHaveBeenCalled();
    }finally{pending?.resolve(activeSnapshot());ui.unmount();await owner.close();}
  });
  it('8d49542c: an initial history failure shows recovery instead of an endless loading message',async()=>{
    const client=timeblockClient();client.timeblocks.snapshot.mockRejectedValue({code:'timeblock_history_incomplete',message:'history incomplete'});
    const owner=await BetaTimeblockController.open(client,D,P,{journal:memoryIntentJournal()});
    const ui=render(<BetaFocusTimer controller={owner} client={client} profileId={P}/>);
    try{
      expect(await screen.findByText('尚未读取到可用的时间块状态，请按错误提示处理后刷新。')).toBeInTheDocument();
      expect(screen.getByText(/先让参与过此档案时间块的设备上线/)).toBeInTheDocument();
      expect(screen.queryByText('正在恢复并读取时间块…')).not.toBeInTheDocument();
      expect(client.timeblocks.command).not.toHaveBeenCalled();
    }finally{ui.unmount();await owner.close();}
  });
  it('ac1dcc95: opens the real sync section and returns to the same timeblock draft without submitting',async()=>{
    const locks=Object.getOwnPropertyDescriptor(navigator,'locks');Object.defineProperty(navigator,'locks',{configurable:true,value:asyncDraftLocks()});
    const client=timeblockClient();client.profiles.mockResolvedValue([{profile_id:P,display_name:'P'}]);
    const peers=nativeBetaPeersClient(async name=>{
      if(name==='beta_peer_status')return{runtime_id:R,device_id:D,profile_id:P,network_enabled:false,local_addresses:[],peers:[]};
      throw new Error(`Unexpected mutation: ${name}`);
    });
    const ui=render(<BetaApp client={client} peers={peers} intentJournal={memoryIntentJournal()}/>);
    try{
      fireEvent.click(await screen.findByTestId('new-focus-idle-card'));
      fireEvent.change(screen.getByTestId('new-focus-task-input'),{target:{value:'same draft after sync navigation'}});
      await screen.findByText('草稿已暂存 · 尚未提交');
      client.timeblocks.snapshot.mockRejectedValue({code:'timeblock_history_incomplete',message:'history incomplete'});
      fireEvent.click(screen.getByRole('button',{name:'刷新时间块'}));
      fireEvent.click(await screen.findByRole('button',{name:'查看设备同步'}));
      expect(await screen.findByRole('heading',{name:'设备同步'})).toBeVisible();
      fireEvent.click(screen.getByRole('button',{name:'当下',exact:true}));
      expect(screen.getByTestId('new-focus-task-input')).toHaveValue('same draft after sync navigation');
      expect(client.timeblocks.command).not.toHaveBeenCalled();
    }finally{ui.unmount();await act(async()=>{await Promise.resolve();});if(locks)Object.defineProperty(navigator,'locks',locks);else Reflect.deleteProperty(navigator,'locks');}
  });
  it('90d8bd80: keeps the draft and offers sync recovery when causal history cannot be projected',async()=>{
    const client=timeblockClient(),journal=memoryIntentJournal(),openSync=vi.fn();
    const owner=await BetaTimeblockController.open(client,D,P,{journal});
    owner.setStartDraft({name:'retained local draft'});await owner.refresh();
    client.timeblocks.snapshot.mockRejectedValue({code:'timeblock_history_incomplete',message:'时间块历史暂不能完整解释，现有记录已保留'});
    const ui=render(<BetaFocusTimer controller={owner} client={client} profileId={P} onOpenSync={openSync}/>);
    try{
      expect(await screen.findByText(/先让参与过此档案时间块的设备上线/)).toBeInTheDocument();
      expect(screen.getByTestId('new-focus-task-input')).toHaveValue('retained local draft');
      expect(screen.getByTestId('new-focus-start-button')).toBeDisabled();
      fireEvent.click(screen.getByRole('button',{name:'查看设备同步'}));expect(openSync).toHaveBeenCalledOnce();
      expect(client.timeblocks.command).not.toHaveBeenCalled();
      client.timeblocks.snapshot.mockResolvedValue(snapshot());
      fireEvent.click(screen.getByRole('button',{name:'刷新时间块'}));
      await waitFor(()=>expect(screen.getByTestId('new-focus-start-button')).toBeEnabled());
      expect(screen.queryByText(/先让参与过此档案时间块的设备上线/)).not.toBeInTheDocument();
      expect(screen.getByTestId('new-focus-task-input')).toHaveValue('retained local draft');
      expect(client.timeblocks.command).not.toHaveBeenCalled();
    }finally{ui.unmount();await owner.close();}
  });
  it('reopens the authoritative active block ahead of a retained next draft, which only an explicit rotation reveals',async()=>{
    const client=timeblockClient(),journal=memoryIntentJournal();client.timeblocks.snapshot.mockResolvedValue({...activeSnapshot(),active:{...activeSnapshot().active!,name:'active A'}});
    const previous=await BetaTimeblockController.open(client,D,P,{journal});previous.setStartDraft({name:'next B'});await previous.close();
    const owner=await BetaTimeblockController.open(client,D,P,{journal});
    const ui=render(<BetaFocusTimer controller={owner} client={client} profileId={P}/>);
    try{
      expect(await screen.findByTestId('new-focus-running-name-display')).toHaveTextContent('active A');
      expect(screen.getByTestId('new-focus-running-clock')).toBeInTheDocument();expect(screen.queryByTestId('new-focus-task-input')).not.toBeInTheDocument();
      expect(owner.snapshot().draft.name).toBe('next B');expect(client.timeblocks.command).not.toHaveBeenCalled();
      await waitFor(()=>expect(screen.getByRole('button',{name:'切换时间块'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'切换时间块'}));
      expect(screen.getByTestId('new-focus-task-input')).toHaveValue('next B');expect(client.timeblocks.command).not.toHaveBeenCalled();
      expect(JSON.parse(journal.values.get(owner.storageKey)!).draft.name).toBe('next B');
    }finally{ui.unmount();await owner.close();}
  });
  it('shows A after its delayed start receipt while preserving edited B until an explicit rotate',async()=>{
    const client=timeblockClient(),journal=memoryIntentJournal(),ack=deferred<ReturnType<typeof receipt>>();let remote=snapshot();
    client.timeblocks.snapshot.mockImplementation(async()=>structuredClone(remote));
    client.timeblocks.command.mockImplementation(async command=>{
      const action=command.action;if(action.kind!=='start'&&action.kind!=='rotate')throw new Error('unexpected action');
      const spec=action.kind==='start'?action:action.next;
      // Apply the backend projection before delaying only its ACK. A start
      // action's `kind` belongs to the command, never to the active-block DTO.
      remote={...remote,revision:String(client.timeblocks.command.mock.calls.length).padStart(64,'0'),active:{block_id:spec.block_id,name:spec.name,note:spec.note,timer:spec.timer,phase:'running',work_ms:0,deadline_reached:false,deadline:null}};
      return action.kind==='start'?ack.promise:receipt(command);
    });
    const owner=await BetaTimeblockController.open(client,D,P,{journal});owner.setStartDraft({name:'start A'});await owner.flush();
    const ui=render(<BetaFocusTimer controller={owner} client={client} profileId={P}/>);
    try{
      await waitFor(()=>expect(screen.getByTestId('new-focus-start-button')).toBeEnabled());fireEvent.click(screen.getByTestId('new-focus-start-button'));
      await waitFor(()=>expect(client.timeblocks.command).toHaveBeenCalledTimes(1));const first=client.timeblocks.command.mock.calls[0][0];
      expect(remote.active?.name).toBe('start A');expect(owner.snapshot().pending).toHaveLength(1);
      fireEvent.change(screen.getByTestId('new-focus-task-input'),{target:{value:'next B'}});await act(async()=>{await owner.flush();});
      expect(JSON.parse(journal.values.get(owner.storageKey)!).draft.name).toBe('next B');
      await act(async()=>{ack.resolve(receipt(first));});
      expect(await screen.findByTestId('new-focus-running-name-display')).toHaveTextContent('start A');
      expect(screen.queryByTestId('new-focus-task-input')).not.toBeInTheDocument();expect(client.timeblocks.command).toHaveBeenCalledTimes(1);
      await act(async()=>{await owner.flush();});expect(JSON.parse(journal.values.get(owner.storageKey)!).draft.name).toBe('next B');
      await waitFor(()=>expect(screen.getByRole('button',{name:'切换时间块'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'切换时间块'}));
      expect(screen.getByTestId('new-focus-task-input')).toHaveValue('next B');expect(client.timeblocks.command).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button',{name:'切换并开始'})).toBeEnabled();expect(screen.getByText('当前时间块：start A → 新时间块')).toBeVisible();
      fireEvent.click(screen.getByTestId('new-focus-start-button'));
      await waitFor(()=>expect(client.timeblocks.command).toHaveBeenCalledTimes(2));
      const second=client.timeblocks.command.mock.calls[1][0];expect(second.action).toMatchObject({kind:'rotate',from_block_id:first.action.kind==='start'?first.action.block_id:'',next:{name:'next B'}});
      expect(second.command_id).not.toBe(first.command_id);await waitFor(()=>expect(screen.getByTestId('new-focus-running-name-display')).toHaveTextContent('next B'));
    }finally{ui.unmount();const first=client.timeblocks.command.mock.calls[0]?.[0];if(first)ack.resolve(receipt(first));await owner.close();}
  });
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
      fireEvent.click(await screen.findByRole('button',{name:'明确跳过反馈',exact:true}));
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
