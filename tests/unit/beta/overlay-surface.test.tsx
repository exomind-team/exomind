import { act,cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { afterEach,describe,expect,it,vi } from 'vitest';
import { StrictMode } from 'react';
import { BetaOverlaySurface } from '@/beta/overlay/BetaOverlayPage';
import type { OverlaySession,OverlaySessionState } from '@/beta/overlay/session';
import type { OverlayAction,OverlayView } from '@/beta/overlay/protocol';
import { B,C,D,P,R,activeSnapshot } from './timeblock-fixtures';

vi.mock('@/beta/overlay/window-layout',()=>({useOverlayWindowLayout:()=>({onSurfaceMount:()=>{},onSurfaceMouseDownCapture:()=>{},surfaceActive:false})}));
vi.mock('@/beta/overlay/native-port',()=>({nativeOverlayWindow:vi.fn(async()=>{}),nativeOverlayPort:vi.fn()}));
afterEach(cleanup);
function fixture(active=true){
  let view:OverlayView={scope:{device_id:D,runtime_id:R,profile_id:P,ui_owner_generation:C},theme:'light',remote:{...activeSnapshot(),active:active?{...activeSnapshot().active!,name:'authoritative A'}:null},clock:{text:'00:01',warning:true,stale:false},capture:{text:'',revision:0,file_count:2,state:'idle',error:null},feedback:{},focus_state:'idle',focus_error:null,focus_busy:false,focus_pending:[],capture_pending:[]};
  let state:OverlaySessionState={ready:true,view,error:null,pending:[]};const listeners=new Set<()=>void>();
  const update=(next:OverlayView)=>{view=next;state={...state,view};listeners.forEach(fn=>fn());};
  const send=vi.fn(async(action:OverlayAction)=>{
    if(action.kind==='capture_edit')update({...view,capture:{...view.capture,text:action.text,revision:view.capture.revision+1}});
    if(action.kind==='feedback_edit')update({...view,feedback:{...view.feedback,[action.block_id]:{text:action.text,revision:(view.feedback[action.block_id]?.revision??0)+1}}});
    if(action.kind==='pause')update({...view,remote:{...view.remote!,active:{...view.remote!.active!,phase:'paused'}}});
    if(action.kind==='end_action')update({...view,remote:{...view.remote!,active:{...view.remote!.active!,phase:'feedback_pending'},pending_feedback:[action.block_id]}});
    return{ok:true as const,view,receipt:null};
  });
  const session={snapshot:()=>state,subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};},send,retry:vi.fn()} as unknown as OverlaySession;
  return{session,send,update,view:()=>view};
}
describe('real Beta overlay uses shared Alpha presentation and Main actions',()=>{
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
