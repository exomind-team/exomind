import { afterEach, describe, expect, it, vi } from 'vitest';
import { keepBetaEditableInViewport } from '@/beta/editable-viewport';

let detach: (() => void) | undefined;
afterEach(() => { detach?.(); detach=undefined; document.body.replaceChildren(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function field(top=137,bottom=175) {
  const input=document.createElement('textarea');document.body.append(input);
  let rect={top,bottom,left:20,right:290,width:270,height:bottom-top} as DOMRect;
  vi.spyOn(input,'getBoundingClientRect').mockImplementation(()=>rect);
  const scroll=vi.fn();Object.defineProperty(input,'scrollIntoView',{value:scroll,configurable:true});return{input,scroll,setRect:(top:number,bottom:number)=>{rect={...rect,top,bottom,height:bottom-top};}};
}
function install(height=97,width=640) {
  vi.useFakeTimers();const viewport=Object.assign(new EventTarget(),{offsetTop:0,offsetLeft:0,height:97,width:640});
  viewport.height=height;viewport.width=width;
  vi.stubGlobal('visualViewport',viewport);detach=keepBetaEditableInViewport();return viewport;
}
function observers(){
  const resize:Array<{targets:Element[];disconnected:boolean;notify():void}>=[],mutation:Array<{targets:Node[];disconnected:boolean;notify():void}>=[];
  class Resize {
    targets:Element[]=[];disconnected=false;
    constructor(private readonly callback:()=>void){resize.push(this);}
    observe(target:Element){this.targets.push(target);}disconnect(){this.disconnected=true;}
    notify(){if(!this.disconnected)this.callback();}
  }
  class Mutation {
    targets:Node[]=[];disconnected=false;
    constructor(private readonly callback:()=>void){mutation.push(this);}
    observe(target:Node){this.targets.push(target);}disconnect(){this.disconnected=true;}
    notify(){if(!this.disconnected)this.callback();}
  }
  vi.stubGlobal('ResizeObserver',Resize);vi.stubGlobal('MutationObserver',Mutation);return{resize,mutation};
}
describe('Beta editable visibility after keyboard resize',()=>{
  it('does not reopen observers for hidden resize/input and waits for a new visible focus',()=>{
    let hidden=false;vi.spyOn(document,'hidden','get').mockImplementation(()=>hidden);
    const events=observers(),target=field(20,116);target.input.focus();const viewport=install(317,360);viewport.dispatchEvent(new Event('resize'));vi.advanceTimersByTime(20);
    hidden=true;document.dispatchEvent(new Event('visibilitychange'));target.setRect(434.5,530.5);
    viewport.dispatchEvent(new Event('resize'));window.dispatchEvent(new Event('resize'));target.input.dispatchEvent(new Event('input',{bubbles:true}));viewport.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(1000);expect(events.resize).toHaveLength(1);expect(events.resize[0].disconnected).toBe(true);expect(target.scroll).not.toHaveBeenCalled();
    hidden=false;document.dispatchEvent(new Event('visibilitychange'));viewport.dispatchEvent(new Event('scroll'));vi.advanceTimersByTime(20);expect(target.scroll).not.toHaveBeenCalled();
    target.scroll.mockImplementation(()=>target.setRect(187,283));target.input.dispatchEvent(new FocusEvent('focusin',{bubbles:true}));vi.advanceTimersByTime(20);
    expect(events.resize).toHaveLength(2);expect(target.scroll).toHaveBeenCalledTimes(1);
  });
  it('rejects a queued geometry callback while hidden even before visibilitychange is delivered',()=>{
    let hidden=false;vi.spyOn(document,'hidden','get').mockImplementation(()=>hidden);
    const events=observers(),target=field(20,116);target.input.focus();const viewport=install(317,360);viewport.dispatchEvent(new Event('resize'));vi.advanceTimersByTime(20);
    hidden=true;target.setRect(434.5,530.5);viewport.dispatchEvent(new Event('scroll'));events.resize[0].notify();vi.advanceTimersByTime(20);
    expect(target.scroll).not.toHaveBeenCalled();expect(events.resize[0].disconnected).toBe(true);
  });
  it('coalesces repeated resize callbacks without extending the same settlement deadline',()=>{
    const events=observers(),target=field(20,116);target.input.focus();const viewport=install(317,360);viewport.dispatchEvent(new Event('resize'));
    for(let index=0;index<5;index++){vi.advanceTimersByTime(500);viewport.dispatchEvent(new Event('resize'));window.dispatchEvent(new Event('resize'));}
    expect(events.resize).toHaveLength(1);vi.advanceTimersByTime(501);expect(events.resize[0].disconnected).toBe(true);
    target.setRect(434.5,530.5);viewport.dispatchEvent(new Event('scroll'));vi.advanceTimersByTime(20);expect(target.scroll).not.toHaveBeenCalled();
  });
  it('starts a new editing intent when the active textarea grows after the old settlement expired',()=>{
    const events=observers(),target=field(20,58);target.input.focus();const viewport=install(317,360);viewport.dispatchEvent(new Event('resize'));vi.advanceTimersByTime(5000);
    target.setRect(280,376);target.scroll.mockImplementation(()=>target.setRect(180,276));target.input.dispatchEvent(new Event('input',{bubbles:true}));
    vi.advanceTimersByTime(20);expect(target.scroll).toHaveBeenCalledTimes(1);expect(events.resize).toHaveLength(2);
  });
  it.each(['wheel','touchmove'])('requires a new explicit edit to resume after %s; old resize/scroll cannot revive it',gesture=>{
    const target=field(20,58);target.input.focus();const viewport=install(317,360);viewport.dispatchEvent(new Event('resize'));vi.advanceTimersByTime(20);
    document.dispatchEvent(new Event(gesture));target.setRect(280,376);viewport.dispatchEvent(new Event('resize'));window.dispatchEvent(new Event('resize'));viewport.dispatchEvent(new Event('scroll'));vi.advanceTimersByTime(500);
    expect(target.scroll).not.toHaveBeenCalled();target.scroll.mockImplementation(()=>target.setRect(180,276));target.input.dispatchEvent(new Event('input',{bubbles:true}));
    vi.advanceTimersByTime(20);expect(target.scroll).toHaveBeenCalledTimes(1);
  });
  it('recognizes an active IME composition completion as a fresh edit without reviving on unrelated field input',()=>{
    const target=field(20,58),other=field(10,48);target.input.focus();const viewport=install(317,360);viewport.dispatchEvent(new Event('resize'));vi.advanceTimersByTime(5000);
    target.setRect(280,376);other.input.dispatchEvent(new Event('input',{bubbles:true}));vi.advanceTimersByTime(20);expect(target.scroll).not.toHaveBeenCalled();
    target.scroll.mockImplementation(()=>target.setRect(180,276));target.input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'字'}));
    vi.advanceTimersByTime(20);expect(target.scroll).toHaveBeenCalledTimes(1);expect(other.scroll).not.toHaveBeenCalled();
  });
  it('rescues a late native viewport pan after the first 350ms checks have finished',()=>{
    const target=field(20,116);target.input.focus();const viewport=install(317,360);viewport.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(1100);expect(target.scroll).not.toHaveBeenCalled();
    target.setRect(434.5,530.5);target.scroll.mockImplementation(()=>target.setRect(187,283));viewport.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(20);expect(target.scroll).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('scroll'));vi.advanceTimersByTime(20);expect(target.scroll).toHaveBeenCalledTimes(1);
  });
  it('rechecks a late active-field resize during the same bounded IME settlement',()=>{
    const events=observers(),target=field(280,310);target.input.focus();const viewport=install(317,360);viewport.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(1100);target.setRect(280,376);target.scroll.mockImplementation(()=>target.setRect(180,276));
    const observer=events.resize.find(item=>item.targets.includes(target.input));expect(observer).toBeDefined();observer?.notify();
    vi.advanceTimersByTime(20);expect(target.scroll).toHaveBeenCalledTimes(1);
  });
  it('rechecks a late sibling/status reflow even when the active field keeps its previous size',()=>{
    const events=observers(),target=field(20,116);target.input.focus();const viewport=install(317,360);viewport.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(1100);target.setRect(434.5,530.5);target.scroll.mockImplementation(()=>target.setRect(187,283));
    expect(events.mutation.length).toBeGreaterThan(0);events.mutation.at(-1)?.notify();
    vi.advanceTimersByTime(20);expect(target.scroll).toHaveBeenCalledTimes(1);
  });
  it('disconnects settlement observers and does not follow viewport/page movement after the window expires',()=>{
    const events=observers(),target=field(20,116);target.input.focus();const viewport=install(317,360);viewport.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(5000);expect(events.resize.length).toBeGreaterThan(0);expect(events.resize.every(item=>item.disconnected)).toBe(true);expect(events.mutation.every(item=>item.disconnected)).toBe(true);
    target.setRect(434.5,530.5);viewport.dispatchEvent(new Event('scroll'));window.dispatchEvent(new Event('scroll'));events.resize.forEach(item=>item.notify());events.mutation.forEach(item=>item.notify());
    vi.runAllTimers();expect(target.scroll).not.toHaveBeenCalled();
  });
  it.each(['wheel','touchmove'])('cancels correction on intentional %s instead of pulling the field back into view',gesture=>{
    const events=observers(),target=field(20,116);target.input.focus();const viewport=install(317,360);viewport.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(20);document.dispatchEvent(new Event(gesture));target.setRect(434.5,530.5);viewport.dispatchEvent(new Event('scroll'));window.dispatchEvent(new Event('scroll'));
    events.resize.forEach(item=>item.notify());events.mutation.forEach(item=>item.notify());vi.advanceTimersByTime(1500);expect(target.scroll).not.toHaveBeenCalled();
  });
  it('rescues the focused control after landscape IME shrinks the viewport',()=>{
    const {input,scroll}=field();input.focus();const viewport=install();viewport.dispatchEvent(new Event('resize'));
    vi.runAllTimers();expect(scroll).toHaveBeenCalledWith({block:'center',inline:'nearest',behavior:'instant'});
  });
  it('does not scroll an already visible field or ordinary page scrolling',()=>{
    const {input,scroll}=field(20,58);input.focus();const viewport=install();viewport.dispatchEvent(new Event('resize'));
    vi.runAllTimers();document.dispatchEvent(new Event('scroll'));vi.runAllTimers();expect(scroll).not.toHaveBeenCalled();
  });
  it('uses the newly focused field and leaves the old field alone',()=>{
    const first=field(),second=field();first.input.focus();const viewport=install();viewport.dispatchEvent(new Event('resize'));
    second.input.focus();vi.runAllTimers();expect(first.scroll).not.toHaveBeenCalled();expect(second.scroll).toHaveBeenCalled();
  });
  it('cancels pending work on detach and never scrolls noneditable controls',()=>{
    const {input,scroll}=field();input.focus();const viewport=install();viewport.dispatchEvent(new Event('resize'));detach!();vi.runAllTimers();expect(scroll).not.toHaveBeenCalled();
    const button=document.createElement('button');document.body.append(button);button.focus();detach=keepBetaEditableInViewport();viewport.dispatchEvent(new Event('resize'));vi.runAllTimers();expect(scroll).not.toHaveBeenCalled();
  });
});
