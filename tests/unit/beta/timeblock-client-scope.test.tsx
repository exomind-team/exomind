import { act,cleanup,fireEvent,render,screen,waitFor,within } from '@testing-library/react';
import { afterEach,describe,expect,it } from 'vitest';
import { BetaApp } from '@/beta/BetaApp';
import { asyncDraftLocks,deferred,fakeClient } from './fixtures';

const originalLocks=Object.getOwnPropertyDescriptor(navigator,'locks');
afterEach(()=>{cleanup();if(originalLocks)Object.defineProperty(navigator,'locks',originalLocks);else Reflect.deleteProperty(navigator,'locks');});
function clientFor(device:string,profiles:Array<{profile_id:string;display_name:string}>){
  const client=fakeClient();client.status.mockResolvedValue({protocol:'exomind-beta/1',device_id:device,runtime_id:`runtime-${device}`,running:true});client.profiles.mockResolvedValue(profiles);return client;
}
function context(){
  Object.defineProperty(navigator,'locks',{configurable:true,value:asyncDraftLocks()});
  const old=clientFor('scope-old',[{profile_id:'old-p',display_name:'Old P'},{profile_id:'old-q',display_name:'Old Q'}]);
  const next=clientFor('scope-new',[{profile_id:'new-p',display_name:'New P'},{profile_id:'new-q',display_name:'New Q'}]);
  const gate=deferred<void>(),written=deferred<void>();const values=new Map<string,string>();
  const journal={read:async(key:string)=>values.get(key)??null,write:async(key:string,raw:string)=>{if(key==='exomind:beta:drafts:scope-old')await gate.promise;values.set(key,raw);if(key==='exomind:beta:drafts:scope-old')written.resolve();}};
  return{old,next,gate,written,values,journal};
}
// Switch device at the real journal acknowledgement boundary: the durable
// value is written, but the caller's flush/Promise.all continuation is late.
async function acknowledgeThenReplace(f:ReturnType<typeof context>,replace:()=>void){
  await act(async()=>{f.gate.resolve();await f.written.promise;await Promise.resolve();replace();});
}
describe('late profile operations stay in their original client/device generation',()=>{
  it('a late old P→Q flush cannot select old Q on a replacement device, and P bytes remain journaled',async()=>{
    const f=context();const ui=render(<BetaApp client={f.old} intentJournal={f.journal}/>);
    try{
      const input=await screen.findByRole('textbox',{name:'记录当下'});fireEvent.change(input,{target:{value:'old P durable draft'}});
      const select=screen.getByRole('combobox',{name:'当前档案'});fireEvent.change(select,{target:{value:'old-q'}});
      expect(select).toHaveValue('old-p');
      await acknowledgeThenReplace(f,()=>ui.rerender(<BetaApp client={f.next} intentJournal={f.journal}/>));
      await waitFor(()=>expect(screen.getByRole('combobox',{name:'当前档案'})).toHaveValue('new-p'));
      await screen.findByRole('textbox',{name:'记录当下'});
      await act(async()=>{await Promise.resolve();});
      const current=screen.getByRole('combobox',{name:'当前档案'});expect(current).toHaveValue('new-p');expect(current).toBeEnabled();
      expect(within(current).getAllByRole('option').map(option=>option.getAttribute('value'))).toEqual(['new-p','new-q']);
      expect(JSON.parse(f.values.get('exomind:beta:drafts:scope-old')!).drafts['old-p'].text).toBe('old P durable draft');
      expect(f.old.capture).not.toHaveBeenCalled();expect(f.next.capture).not.toHaveBeenCalled();
    }finally{f.gate.resolve();ui.unmount();}
  });
  it('a created old profile awaiting its second flush cannot be appended to the replacement device list',async()=>{
    const f=context();const provision=deferred<{profile_id:string;display_name:string}>();f.old.provisionProfile.mockReturnValueOnce(provision.promise);
    const ui=render(<BetaApp client={f.old} intentJournal={f.journal}/>);
    try{
      const input=await screen.findByRole('textbox',{name:'记录当下'});fireEvent.change(screen.getByRole('textbox',{name:'新档案名称'}),{target:{value:'Late old profile'}});
      await waitFor(()=>expect(screen.getByRole('button',{name:'创建档案'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'创建档案'}));
      await waitFor(()=>expect(f.old.provisionProfile).toHaveBeenCalledTimes(1));
      fireEvent.change(input,{target:{value:'P input while provisioning'}});
      const id=f.old.provisionProfile.mock.calls[0][0];
      await act(async()=>{provision.resolve({profile_id:id,display_name:'Late old profile'});await provision.promise;});
      await acknowledgeThenReplace(f,()=>ui.rerender(<BetaApp client={f.next} intentJournal={f.journal}/>));
      await waitFor(()=>expect(screen.getByRole('combobox',{name:'当前档案'})).toHaveValue('new-p'));await screen.findByRole('textbox',{name:'记录当下'});
      await act(async()=>{await Promise.resolve();});
      const current=screen.getByRole('combobox',{name:'当前档案'});expect(current).toHaveValue('new-p');expect(current).toBeEnabled();
      expect(within(current).queryByRole('option',{name:'Late old profile'})).not.toBeInTheDocument();
      expect(within(current).getAllByRole('option')).toHaveLength(2);expect(f.next.provisionProfile).not.toHaveBeenCalled();
      expect(JSON.parse(f.values.get('exomind:beta:drafts:scope-old')!).drafts['old-p'].text).toBe('P input while provisioning');
    }finally{f.gate.resolve();ui.unmount();}
  });
});
