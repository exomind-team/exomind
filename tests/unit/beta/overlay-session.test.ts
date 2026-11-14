import { describe,expect,it,vi } from 'vitest';
import { OverlaySession,type OverlayPort } from '@/beta/overlay/session';
import { OverlayDraftBuffer } from '@/beta/overlay/draft-buffer';
import { nativeMainOverlayPort,nativeOverlayPort,validateOverlayRead,validateOverlayView,type OverlayInvoke } from '@/beta/overlay/native-port';
import type { OverlayRead,OverlayResponse,OverlayView } from '@/beta/overlay/protocol';
import { deferred } from './fixtures';
import { B,C,D,P,Q,R,activeSnapshot } from './timeblock-fixtures';

function view():OverlayView{return{scope:{device_id:D,runtime_id:R,profile_id:P,ui_owner_generation:C},theme:'light',remote:activeSnapshot(),clock:{text:'00:01',warning:true,stale:false},capture:{text:'',revision:0,file_count:0,state:'idle',error:null},feedback:{},focus_state:'idle',focus_error:null,focus_busy:false,focus_pending:[],capture_pending:[]};}
describe('overlay transport, display drafts and lost acknowledgements',()=>{
  it('keeps next B while retrying the exact uncertain A edit, then commits B under its next revision',async()=>{
    let current=view(),lost=true;const responses:OverlayRead['responses']=[],applied:string[]=[];
    const port:OverlayPort={attach:async()=>B,read:async()=>({overlay_generation:B,ready:true,view:current,responses}),submit:vi.fn(async request=>{
      if(!responses.some(item=>item.request_id===request.request_id)){
        if(request.action.kind!=='capture_edit')throw Error('unexpected action');applied.push(request.action.text);current={...current,capture:{...current.capture,text:request.action.text,revision:current.capture.revision+1}};responses.push({request_id:request.request_id,response:{ok:true,view:current,receipt:null}});
      }
      if(lost){lost=false;throw Error('lost A ACK');}
    })};
    const session=await OverlaySession.open(port),buffer=new OverlayDraftBuffer(session,current,{kind:'capture'});
    try{buffer.edit('A');await vi.waitFor(()=>expect(buffer.snapshot().error).toBe('lost A ACK'));buffer.edit('B');await buffer.retry();
      expect(buffer.snapshot()).toMatchObject({text:'B',dirty:false,saving:false,error:null});expect(applied).toEqual(['A','B']);
      const calls=vi.mocked(port.submit).mock.calls;expect(calls[1][0]).toEqual(calls[0][0]);expect(calls[2][0].action).toEqual({kind:'capture_edit',draft_revision:1,text:'B'});
    }finally{buffer.close();session.close();}
  });
  it('retries the identical Native request after a lost submit acknowledgement instead of creating another edit',async()=>{
    let current=view(),applied=0;const responses:OverlayRead['responses']=[];
    const port:OverlayPort={attach:async()=>B,read:async()=>({overlay_generation:B,ready:true,view:current,responses}),submit:vi.fn(async request=>{
      if(!responses.some(item=>item.request_id===request.request_id)){
        if(request.action.kind!=='capture_edit')throw Error('unexpected action');applied++;current={...current,capture:{...current.capture,text:request.action.text,revision:1}};responses.push({request_id:request.request_id,response:{ok:true,view:current,receipt:null}});
        throw Error('ack lost after apply');
      }
    })};
    const session=await OverlaySession.open(port);
    try{await expect(session.send({kind:'capture_edit',draft_revision:0,text:'A'})).rejects.toThrow('ack lost');const request=session.snapshot().pending[0];
      expect((await session.retry(request.request_id)).ok).toBe(true);expect(applied).toBe(1);expect(session.snapshot().pending).toHaveLength(0);
      const calls=vi.mocked(port.submit).mock.calls;expect(calls[1][0]).toEqual(calls[0][0]);
    }finally{session.close();}
  });
  it('coalesces new display input behind an outstanding draft ACK without losing the next text or reusing its revision',async()=>{
    let current=view();const gate=deferred<OverlayResponse>();const send=vi.fn(async(action:{kind:string;text:string;draft_revision:number})=>{
      const next={...current,capture:{...current.capture,text:action.text,revision:action.draft_revision+1}};
      if(send.mock.calls.length===1)return gate.promise;current=next;return{ok:true as const,view:next,receipt:null};
    });const session={send} as unknown as OverlaySession;const buffer=new OverlayDraftBuffer(session,current,{kind:'capture'});
    try{buffer.edit('A');await vi.waitFor(()=>expect(send).toHaveBeenCalledTimes(1));buffer.edit('B');
      current={...current,capture:{...current.capture,text:'A',revision:1}};gate.resolve({ok:true,view:current,receipt:null});await buffer.flush();
      expect(send.mock.calls.map(([action])=>[action.text,action.draft_revision])).toEqual([['A',0],['B',1]]);expect(buffer.snapshot()).toMatchObject({text:'B',dirty:false,error:null});
    }finally{buffer.close();}
  });
  it('keeps unacknowledged text when another profile arrives before the old ACK',async()=>{
    const first=view(),gate=deferred<OverlayResponse>(),session={send:vi.fn(async()=>gate.promise)} as unknown as OverlaySession;
    const buffer=new OverlayDraftBuffer(session,first,{kind:'capture'});
    try{buffer.edit('P unsaved text');await vi.waitFor(()=>expect(session.send).toHaveBeenCalledTimes(1));const next={...view(),scope:{...first.scope,profile_id:Q,ui_owner_generation:B},capture:{...first.capture,text:'Q draft'}};
      buffer.sync(next);gate.resolve({ok:true,view:{...first,capture:{...first.capture,text:'P unsaved text',revision:1}},receipt:null});
      await expect(buffer.flush()).rejects.toMatchObject({code:'overlay_scope_changed'});expect(buffer.snapshot()).toMatchObject({text:'P unsaved text',dirty:true,saving:false});expect(buffer.snapshot().error).toMatch(/档案已变化/);
    }finally{buffer.close();}
  });
  it('does not call a Native fallback or weaken a structured IPC denial',async()=>{
    const call=vi.fn(async()=>{throw{code:'forbidden',message:'wrong window'};});
    await expect(nativeOverlayPort(call as OverlayInvoke).read()).rejects.toMatchObject({code:'forbidden',message:'wrong window'});expect(call.mock.calls.map(([name])=>name)).toEqual(['beta_overlay_read']);
  });
  it('rejects unknown view fields, foreign snapshot scope and forged ticket actions',async()=>{
    expect(()=>validateOverlayView({...view(),owner_token:'must not be accepted'})).toThrow();
    expect(()=>validateOverlayView({...view(),remote:{...activeSnapshot(),profile_id:Q}})).toThrow();
    expect(()=>validateOverlayRead({overlay_generation:B,ready:false,view:view(),responses:[]})).toThrow();
    const request={request_id:B,seq:1,overlay_generation:B,scope:view().scope,expected_revision:'a'.repeat(64),action:{kind:'execute_anything'}};
    const call=vi.fn(async()=>[{ticket_id:C,request}]);await expect(nativeMainOverlayPort(call as OverlayInvoke).take(view().scope)).rejects.toMatchObject({code:'invalid_overlay_response'});
  });
});
