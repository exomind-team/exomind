import { useEffect } from 'react';
import { cleanup,fireEvent,render,screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach,describe,expect,it,vi } from 'vitest';
import { FocusTimerView } from '@/ui/app/components/FocusTimerView';
import { NowWorkbenchOverlayView,type NowWorkbenchOverlayViewProps } from '@/ui/app/components/NowWorkbenchOverlayView';

afterEach(cleanup);
function props():NowWorkbenchOverlayViewProps {
  const actions={expand:vi.fn(),collapse:vi.fn(),selectTiming:vi.fn(),editCustom:vi.fn(),start:vi.fn(),beginRename:vi.fn(),pauseResume:vi.fn(),end:vi.fn()};
  return {
    model:{mode:'running',title:'Current block',statusLabel:'进行中',clockText:'24:59',paused:false,miniCollapsed:false,miniHovered:false,idleExpanded:false,surfaceActive:false},
    onMiniHover:vi.fn(),onIdleHover:vi.fn(),onIdleFocusCapture:vi.fn(),onIdleBlurCapture:vi.fn(),onIdleCollapse:vi.fn(),
    onExpand:vi.fn(),onCollapse:vi.fn(),onReturnToMain:vi.fn(),onPauseOrResume:vi.fn(),onEndBlock:vi.fn(),
    onSurfaceMount:vi.fn(),onSurfaceMouseDownCapture:vi.fn(),
    slots:{running:chrome=><FocusTimerView surface="overlay" model={{phase:'running',name:{text:'Current block',draft:'',editing:false,saving:false,readOnly:true},clock:{text:'24:59',warning:false},paused:false,feedback:{inProgress:false,dialogOpen:false}}} actions={actions} overlayChrome={chrome}/>,record:<input aria-label="记录slot"/>,dialogs:<div role="dialog" aria-label="反馈slot"/>},
  };
}

describe('shared live Alpha overlay presentation',()=>{
  it('renders the actual overlay FocusTimerView slot with the original full-card shell and chrome actions',()=>{
    const value=props();const ui=render(<NowWorkbenchOverlayView {...value}/>);
    expect(screen.getByTestId('new-focus-overlay-running-header')).toBeInTheDocument();
    expect(screen.getByTestId('new-focus-running-name-display')).toHaveTextContent('Current block');
    expect(screen.getByTestId('now-overlay-single-card-stage')).toHaveStyle({width:'390px',maxWidth:'390px'});
    expect(ui.container.firstElementChild).toHaveClass('now-workbench-overlay-root--single-card');
    expect(screen.queryByTestId('now-overlay-collapsed-pill')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'收起'}));expect(value.onCollapse).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button',{name:'显示主程序'}));expect(value.onReturnToMain).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog',{name:'反馈slot'})).toBeInTheDocument();
  });
  it('preserves mini/peek markup, supplied authoritative clock, hover, control and native drag-region callbacks',()=>{
    const value=props();value.model={...value.model,miniCollapsed:true};const ui=render(<NowWorkbenchOverlayView {...value}/>);
    const pill=screen.getByTestId('now-overlay-collapsed-pill');expect(pill).toHaveClass('w-[224px]','px-3','py-2');
    expect(screen.getByTestId('now-overlay-collapsed-clock')).toHaveTextContent('24:59');
    const handle=screen.getByTestId('now-overlay-drag-handle');expect(handle).toHaveAttribute('data-tauri-drag-region');
    expect(screen.getByRole('button',{name:'展开'})).not.toHaveAttribute('data-tauri-drag-region');
    fireEvent.mouseDown(handle,{button:0});expect(value.onSurfaceMouseDownCapture).toHaveBeenCalledTimes(1);
    fireEvent.mouseEnter(pill);expect(value.onMiniHover).toHaveBeenCalledWith(true);
    ui.rerender(<NowWorkbenchOverlayView {...value} model={{...value.model,miniHovered:true,paused:true,surfaceActive:true}}/>);
    expect(screen.getByTestId('now-overlay-collapsed-pill')).toHaveClass('w-[328px]','px-4','py-3','ring-1');
    fireEvent.click(screen.getByRole('button',{name:'继续'}));expect(value.onPauseOrResume).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button',{name:'结束'}));expect(value.onEndBlock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button',{name:'展开'}));expect(value.onExpand).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button',{name:'显示主程序'}));expect(value.onReturnToMain).toHaveBeenCalledTimes(1);
    fireEvent.mouseLeave(screen.getByTestId('now-overlay-collapsed-pill'));expect(value.onMiniHover).toHaveBeenLastCalledWith(false);
    expect(screen.queryByTestId('now-overlay-single-card-stage')).not.toBeInTheDocument();
  });
  it('keeps the original idle bubble, expanded input slot, focus/hover callbacks and nudge measurement target',()=>{
    const value=props();value.model={...value.model,mode:'idle'};const ui=render(<NowWorkbenchOverlayView {...value}/>);
    const pill=screen.getByTestId('now-overlay-idle-pill');expect(pill).toHaveClass('w-[252px]','rounded-[22px]');
    expect(pill).toHaveAttribute('data-overlay-visible-surface','true');expect(screen.queryByRole('textbox',{name:'记录slot'})).not.toBeInTheDocument();
    fireEvent.mouseEnter(pill);expect(value.onIdleHover).toHaveBeenCalledWith(true);
    ui.rerender(<NowWorkbenchOverlayView {...value} model={{...value.model,idleExpanded:true,nudge:{title:'准备收工',body:'A supplied hint',ctaLabel:'回主程序收工'}}}/>);
    const expanded=screen.getByTestId('now-overlay-idle-expanded');expect(expanded).toHaveClass('w-[396px]','rounded-[24px]');
    const shell=screen.getByTestId('now-overlay-ritual-nudge').parentElement!;
    expect(shell).toHaveAttribute('data-overlay-visible-surface','true');expect(expanded).not.toHaveAttribute('data-overlay-visible-surface');
    const input=screen.getByRole('textbox',{name:'记录slot'});fireEvent.focus(input);expect(value.onIdleFocusCapture).toHaveBeenCalledTimes(1);
    fireEvent.blur(input);expect(value.onIdleBlurCapture).toHaveBeenCalledTimes(1);
    fireEvent.mouseLeave(expanded);expect(value.onIdleHover).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByRole('button',{name:'收起'}));expect(value.onIdleCollapse).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button',{name:'回主程序收工'}));expect(value.onReturnToMain).toHaveBeenCalledTimes(1);
  });
  it('preserves Alpha slot unmount semantics without unmounting a parent business owner or adding hidden geometry',()=>{
    const mounted=vi.fn(),unmounted=vi.fn(),ownerClosed=vi.fn();
    function Running(){useEffect(()=>{mounted();return()=>unmounted();},[]);return<div data-testid="running-slot"/>;}
    function Owner({value}:{value:NowWorkbenchOverlayViewProps}){useEffect(()=>()=>ownerClosed(),[]);return<NowWorkbenchOverlayView {...value}/>;}
    const value=props();value.slots={...value.slots,running:()=> <Running/>};const ui=render(<Owner value={value}/>);
    expect(mounted).toHaveBeenCalledTimes(1);ui.rerender(<Owner value={{...value,model:{...value.model,miniCollapsed:true}}}/>);
    expect(unmounted).toHaveBeenCalledTimes(1);expect(screen.queryByTestId('running-slot')).not.toBeInTheDocument();expect(ownerClosed).not.toHaveBeenCalled();
    expect(ui.container.querySelectorAll('.now-workbench-overlay-root')).toHaveLength(1);expect(ui.container.querySelector('[hidden]')).toBeNull();
    ui.rerender(<Owner value={value}/>);expect(mounted).toHaveBeenCalledTimes(2);expect(ownerClosed).not.toHaveBeenCalled();
    ui.unmount();expect(ownerClosed).toHaveBeenCalledTimes(1);
  });
  it('keeps the live Alpha path wired to this component while the pure View imports no runtime/window/storage controller',()=>{
    const alpha=readFileSync('src/pages/NowWorkbenchOverlayPage.tsx','utf8'),view=readFileSync('src/ui/app/components/NowWorkbenchOverlayView.tsx','utf8');
    expect(alpha).toContain('<NowWorkbenchOverlayView');expect(alpha).toContain('slots={{');expect(alpha).toContain('<FocusTimerWidget');
    expect(view).not.toMatch(/@tauri-apps|startDragging\(|getTimeBlockService|useSyncStore|localStorage|runtime-target|NowInputRow['"]/);
    expect(view).toContain('data-tauri-drag-region');expect(alpha).toContain('new LogicalSize(targetOverlaySize.width, targetOverlaySize.height)');
  });
});
