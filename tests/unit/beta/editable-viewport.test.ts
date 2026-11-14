import { afterEach, describe, expect, it, vi } from 'vitest';
import { keepBetaEditableInViewport } from '@/beta/editable-viewport';

let detach: (() => void) | undefined;
afterEach(() => { detach?.(); detach=undefined; document.body.replaceChildren(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function field(top=137,bottom=175) {
  const input=document.createElement('textarea');document.body.append(input);
  vi.spyOn(input,'getBoundingClientRect').mockReturnValue({top,bottom,left:20,right:290,width:270,height:bottom-top} as DOMRect);
  const scroll=vi.fn();Object.defineProperty(input,'scrollIntoView',{value:scroll,configurable:true});return{input,scroll};
}
function install() {
  vi.useFakeTimers();const viewport=Object.assign(new EventTarget(),{offsetTop:0,offsetLeft:0,height:97,width:640});
  vi.stubGlobal('visualViewport',viewport);detach=keepBetaEditableInViewport();return viewport;
}
describe('Beta editable visibility after keyboard resize',()=>{
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
