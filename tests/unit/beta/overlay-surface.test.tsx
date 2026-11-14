import { act,cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { afterEach,describe,expect,it,vi } from 'vitest';
import { StrictMode } from 'react';
import { BetaOverlaySurface } from '@/beta/overlay/BetaOverlayPage';
import type { OverlaySession,OverlaySessionState } from '@/beta/overlay/session';
import type { OverlayAction,OverlayResponse,OverlayView } from '@/beta/overlay/protocol';
import { B,C,D,P,Q,R,activeSnapshot } from './timeblock-fixtures';
import { deferred } from './fixtures';

vi.mock('@/beta/overlay/window-layout',()=>({useOverlayWindowLayout:()=>({onSurfaceMount:()=>{},onSurfaceMouseDownCapture:()=>{},surfaceActive:false})}));
vi.mock('@/beta/overlay/native-port',()=>({nativeOverlayWindow:vi.fn(async()=>{}),nativeOverlayPort:vi.fn()}));
afterEach(cleanup);
function fixture(active=true){
  let view:OverlayView={scope:{device_id:D,runtime_id:R,profile_id:P,ui_owner_generation:C},theme:'light',remote:{...activeSnapshot(),active:active?{...activeSnapshot().active!,name:'authoritative A'}:null},clock:{text:'00:01',warning:true,stale:false},capture:{text:'',revision:0,file_count:2,state:'idle',error:null},feedback:{},focus_state:'idle',focus_error:null,focus_busy:false,focus_pending:[],capture_pending:[]};
  let state:OverlaySessionState={ready:true,view,error:null,pending:[]};const listeners=new Set<()=>void>();
  const update=(next:OverlayView)=>{view=next;state={...state,view,ready:true,error:null};listeners.forEach(fn=>fn());};
  const disconnect=()=>{state={...state,view:null,ready:false,error:'主窗口未连接'};listeners.forEach(fn=>fn());};
  const send=vi.fn(async(action:OverlayAction)=>{
    if(action.kind==='capture_edit')update({...view,capture:{...view.capture,text:action.text,revision:view.capture.revision+1}});
    if(action.kind==='feedback_edit')update({...view,feedback:{...view.feedback,[action.block_id]:{text:action.text,revision:(view.feedback[action.block_id]?.revision??0)+1}}});
    if(action.kind==='pause')update({...view,remote:{...view.remote!,active:{...view.remote!.active!,phase:'paused'}}});
    if(action.kind==='end_action')update({...view,remote:{...view.remote!,active:{...view.remote!.active!,phase:'feedback_pending'},pending_feedback:[action.block_id]}});
    return{ok:true as const,view,receipt:null};
  });
  const session={snapshot:()=>state,subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};},send,retry:vi.fn()} as unknown as OverlaySession;
  return{session,send,update,disconnect,view:()=>view};
}
describe('real Beta overlay uses shared Alpha presentation and Main actions',()=>{
  it('keeps original read-only recovery reachable with no Main view and does not migrate it when Q arrives',async()=>{
    const f=fixture(),gate=deferred<OverlayResponse>();f.update({...f.view(),remote:{...f.view().remote!,active:{...f.view().remote!.active!,phase:'feedback_pending'},pending_feedback:[B]}});
    const p=structuredClone(f.view());f.send.mockImplementationOnce(async()=>gate.promise);render(<BetaOverlaySurface session={f.session}/>);fireEvent.click(screen.getByTestId('new-focus-end-button'));
    fireEvent.change(await screen.findByTestId('now-overlay-feedback-textarea'),{target:{value:'P disconnected draft'}});await waitFor(()=>expect(f.send).toHaveBeenCalledTimes(1));const before=f.send.mock.calls.length;
    act(()=>f.disconnect());expect(screen.queryByTestId('now-overlay-feedback-surface')).not.toBeInTheDocument();expect(screen.queryByRole('textbox',{name:'记录当下'})).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button',{name:'查看原档案未确认输入'}));expect(screen.getByRole('textbox',{name:'原档案未确认反馈'})).toHaveValue('P disconnected draft');expect(screen.getByRole('textbox',{name:'原档案未确认反馈'})).toHaveAttribute('readonly');expect(f.send).toHaveBeenCalledTimes(before);
    act(()=>f.update({...p,scope:{...p.scope,profile_id:Q,ui_owner_generation:B},remote:{...p.remote!,profile_id:Q,active:null,pending_feedback:[]},feedback:{},capture:{...p.capture,text:'Q stays independent',revision:1}}));
    expect(screen.queryByTestId('now-overlay-feedback-surface')).not.toBeInTheDocument();fireEvent.mouseEnter(screen.getByTestId('now-overlay-idle-pill'));expect(screen.getByRole('textbox',{name:'记录当下'})).toHaveValue('Q stays independent');
    fireEvent.click(screen.getByRole('button',{name:'查看原档案未确认输入'}));expect(screen.getByRole('textbox',{name:'原档案未确认反馈'})).toHaveValue('P disconnected draft');
    await act(async()=>{gate.resolve({ok:true,view:{...p,feedback:{[B]:{text:'P disconnected draft',revision:1}}},receipt:null});});expect(f.send).toHaveBeenCalledTimes(before);expect(f.view().feedback).toEqual({});
  });
  it.each([{profile_id:Q},{ui_owner_generation:B},{runtime_id:B},{device_id:B}])('closes an acknowledged P feedback dialog when its complete scope changes %j',async patch=>{
    const f=fixture();f.update({...f.view(),remote:{...f.view().remote!,active:{...f.view().remote!.active!,phase:'feedback_pending'},pending_feedback:[B]}});
    render(<BetaOverlaySurface session={f.session}/>);fireEvent.click(screen.getByTestId('new-focus-end-button'));
    fireEvent.change(await screen.findByTestId('now-overlay-feedback-textarea'),{target:{value:'P acknowledged feedback'}});
    await waitFor(()=>expect(screen.getByTestId('now-overlay-feedback-confirm')).toBeEnabled());const savedP=structuredClone(f.view());const before=f.send.mock.calls.length;
    act(()=>f.update({...f.view(),scope:{...f.view().scope,...patch},remote:{...f.view().remote!,profile_id:patch.profile_id??P,active:null,pending_feedback:[]},feedback:patch.profile_id?{}:savedP.feedback,capture:{...f.view().capture,text:'new scope draft',revision:1}}));
    await waitFor(()=>expect(screen.queryByTestId('now-overlay-feedback-surface')).not.toBeInTheDocument());
    fireEvent.mouseEnter(screen.getByTestId('now-overlay-idle-pill'));expect(screen.getByRole('textbox',{name:'记录当下'})).toHaveValue('new scope draft');
    expect(savedP.feedback[B].text).toBe('P acknowledged feedback');expect(f.send).toHaveBeenCalledTimes(before);
  });
  it('retains unacknowledged P text behind a read-only recovery entry while Q gets its own clean surface',async()=>{
    const f=fixture(),gate=deferred<OverlayResponse>();f.update({...f.view(),remote:{...f.view().remote!,active:{...f.view().remote!.active!,phase:'feedback_pending'},pending_feedback:[B]}});
    const p=structuredClone(f.view());f.send.mockImplementationOnce(async()=>gate.promise);render(<BetaOverlaySurface session={f.session}/>);fireEvent.click(screen.getByTestId('new-focus-end-button'));
    fireEvent.change(await screen.findByTestId('now-overlay-feedback-textarea'),{target:{value:'P unconfirmed text'}});await waitFor(()=>expect(f.send).toHaveBeenCalledTimes(1));
    act(()=>f.update({...p,scope:{...p.scope,profile_id:Q,ui_owner_generation:B},remote:{...p.remote!,profile_id:Q,active:null,pending_feedback:[]},feedback:{},capture:{...p.capture,text:'Q independent draft',revision:1}}));
    await waitFor(()=>expect(screen.queryByTestId('now-overlay-feedback-surface')).not.toBeInTheDocument());
    fireEvent.click(await screen.findByRole('button',{name:'查看原档案未确认输入'}));
    const recovery=screen.getByRole('textbox',{name:'原档案未确认反馈'});expect(recovery).toHaveValue('P unconfirmed text');expect(recovery).toHaveAttribute('readonly');
    await act(async()=>{gate.resolve({ok:true,view:{...p,feedback:{[B]:{text:'P unconfirmed text',revision:1}}},receipt:null});});
    expect(recovery).toHaveValue('P unconfirmed text');expect(screen.queryByTestId('now-overlay-feedback-surface')).not.toBeInTheDocument();expect(f.send).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button',{name:'关闭查看'}));fireEvent.mouseEnter(screen.getByTestId('now-overlay-idle-pill'));expect(screen.getByRole('textbox',{name:'记录当下'})).toHaveValue('Q independent draft');
    fireEvent.click(screen.getByRole('button',{name:'查看原档案未确认输入'}));fireEvent.click(screen.getByRole('button',{name:'已在原档案核对'}));
    expect(screen.queryByRole('button',{name:'查看原档案未确认输入'})).not.toBeInTheDocument();expect(f.send).toHaveBeenCalledTimes(1);expect(f.view().capture.text).toBe('Q independent draft');
  });
  it('does not reopen the old feedback target when an end acknowledgement arrives after switching to Q',async()=>{
    const f=fixture(),gate=deferred<OverlayResponse>();const p=structuredClone(f.view());
    f.send.mockImplementationOnce(async()=>{f.update({...p,remote:{...p.remote!,active:{...p.remote!.active!,phase:'feedback_pending'},pending_feedback:[B]},focus_busy:true,focus_pending:[{command_id:C,state:'pending'}]});return gate.promise;});
    render(<BetaOverlaySurface session={f.session}/>);fireEvent.click(screen.getByTestId('new-focus-end-button'));await waitFor(()=>expect(f.send).toHaveBeenCalledTimes(1));
    act(()=>f.update({...p,scope:{...p.scope,profile_id:Q,ui_owner_generation:B},remote:{...p.remote!,profile_id:Q,active:null,pending_feedback:[]}}));
    await act(async()=>{gate.resolve({ok:true,view:{...p,remote:{...p.remote!,active:{...p.remote!.active!,phase:'feedback_pending'},pending_feedback:[B]}},receipt:null});});
    expect(screen.queryByTestId('now-overlay-feedback-surface')).not.toBeInTheDocument();expect(screen.getByTestId('now-overlay-idle-pill')).toBeInTheDocument();expect(f.send).toHaveBeenCalledTimes(1);
  });
  it('does not let the old capture continuation pick up Q after its local flush yields',async()=>{
    const f=fixture(false);f.update({...f.view(),capture:{...f.view().capture,text:'P ready draft',revision:1,file_count:0}});render(<BetaOverlaySurface session={f.session}/>);
    fireEvent.mouseEnter(screen.getByTestId('now-overlay-idle-pill'));
    act(()=>{fireEvent.click(screen.getByRole('button',{name:'发送'}));f.update({...f.view(),scope:{...f.view().scope,profile_id:Q,ui_owner_generation:B},remote:{...f.view().remote!,profile_id:Q,active:null},capture:{...f.view().capture,text:'Q must not submit',revision:1}});});
    await act(async()=>{await Promise.resolve();});expect(f.send.mock.calls.some(([action])=>action.kind==='capture')).toBe(false);
  });
  it('keeps draft editing functional through StrictMode effect rehearsal',async()=>{
    const f=fixture(false);render(<StrictMode><BetaOverlaySurface session={f.session}/></StrictMode>);fireEvent.mouseEnter(screen.getByTestId('now-overlay-idle-pill'));
    fireEvent.change(screen.getByRole('textbox',{name:'记录当下'}),{target:{value:'strict draft'}});
    await waitFor(()=>expect(f.send).toHaveBeenCalledWith({kind:'capture_edit',draft_revision:0,text:'strict draft'},expect.anything(),expect.any(Function)));
    await waitFor(()=>expect(screen.getByRole('button',{name:'发送'})).toBeEnabled());expect(f.view().capture.text).toBe('strict draft');
  });
  it('renders the actual running view, pauses via Main, and keeps mini/peek/expand interactive',async()=>{
    const f=fixture();render(<BetaOverlaySurface session={f.session}/>);
    expect(screen.getByTestId('new-focus-running-name-display')).toHaveTextContent('authoritative A');
    fireEvent.click(screen.getByTestId('new-focus-pause-resume-button'));
    await waitFor(()=>expect(f.send).toHaveBeenCalledWith({kind:'pause',block_id:B},expect.anything()));
    fireEvent.click(screen.getByRole('button',{name:'收起'}));const pill=screen.getByTestId('now-overlay-collapsed-pill');fireEvent.mouseEnter(pill);
    expect(screen.getByRole('button',{name:'继续'})).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'展开'}));
    expect(screen.getByTestId('new-focus-running-clock')).toHaveTextContent('00:01');expect(f.send.mock.calls.filter(([action])=>action.kind==='pause')).toHaveLength(1);
  });
  it('keeps feedback targeted at the old block after a newer active block appears',async()=>{
    const f=fixture();render(<BetaOverlaySurface session={f.session}/>);fireEvent.click(screen.getByTestId('new-focus-end-button'));
    const input=await screen.findByTestId('now-overlay-feedback-textarea');fireEvent.change(input,{target:{value:'old A feedback'}});
    await waitFor(()=>expect(f.send.mock.calls.some(([action])=>action.kind==='feedback_edit'&&action.block_id===B)).toBe(true));
    act(()=>f.update({...f.view(),remote:{...f.view().remote!,active:{...f.view().remote!.active!,block_id:C,name:'new C'},revision:'b'.repeat(64)}}));
    await waitFor(()=>expect(screen.getByTestId('now-overlay-feedback-confirm')).toBeEnabled());fireEvent.click(screen.getByTestId('now-overlay-feedback-confirm'));
    await waitFor(()=>expect(f.send.mock.calls.some(([action])=>action.kind==='submit_feedback'&&action.block_id===B)).toBe(true));
    expect(f.send.mock.calls.filter(([action])=>action.kind==='end_action')).toHaveLength(1);
  });
  it('saves idle input through Main before capture and preserves the whole Main attachment group',async()=>{
    const f=fixture(false);render(<BetaOverlaySurface session={f.session}/>);fireEvent.mouseEnter(screen.getByTestId('now-overlay-idle-pill'));
    fireEvent.change(screen.getByRole('textbox',{name:'记录当下'}),{target:{value:'record with existing files'}});
    await waitFor(()=>expect(screen.getByRole('button',{name:'发送'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'发送'}));
    await waitFor(()=>expect(f.send.mock.calls.some(([action])=>action.kind==='capture')).toBe(true));
    expect(f.send.mock.calls[0][0]).toEqual({kind:'capture_edit',draft_revision:0,text:'record with existing files'});
    expect(f.send.mock.calls.find(([action])=>action.kind==='capture')?.[0]).toEqual({kind:'capture',draft_revision:1});expect(f.view().capture.file_count).toBe(2);
  });
});
