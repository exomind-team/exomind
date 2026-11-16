import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BetaAppShell } from '@/beta/BetaAppShell';
import { observeBetaCompactEditing } from '@/beta/compact-editing';

vi.mock('@/ui/app/hooks/useIsDesktop', () => ({ useIsDesktop: () => false }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function viewport(height: number) {
  const visual = Object.assign(new EventTarget(), { offsetTop: 0, offsetLeft: 0, width: 640, height });
  vi.stubGlobal('visualViewport', visual);
  vi.stubGlobal('innerHeight', height);
  return visual;
}
function measuredField(field: HTMLTextAreaElement, top = 0, contentHeight = 96) {
  vi.spyOn(field, 'getBoundingClientRect').mockImplementation(() => {
    const max = parseFloat(field.style.maxHeight) || contentHeight;
    const height = Math.min(contentHeight, max);
    return { top, bottom: top + height, left: 104, right: 580, width: 476, height } as DOMRect;
  });
}
async function settle(action: () => void) { await act(async () => { action(); await Promise.resolve(); }); }

describe('Beta compact editing uses real available space', () => {
  it('recovers the real 97px viewport / 37px main failure with both viewport heights equal, then restores the Alpha bar and field size', async () => {
    const visual = viewport(97);
    render(<BetaAppShell section="now" onSectionChange={vi.fn()} profileName="P" onProfileClick={vi.fn()}
      now={<textarea aria-label="capture" style={{ height: '96px', minHeight: '38px', maxHeight: '96px' }}/>} sync={<p>同步</p>} settings={<p>设置</p>}/>);
    const field = screen.getByRole('textbox', { name: 'capture' }) as HTMLTextAreaElement;
    measuredField(field);
    const bar = screen.getByTestId('mobile-bottom-tab');
    vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue({ top: 37, bottom: 97, left: 0, right: 640, width: 640, height: 60 } as DOMRect);
    // Before correction, the original test's real touch point (342,48) falls
    // inside the bar although the textarea itself fits visualViewport.
    expect(field.getBoundingClientRect().height / 2).toBeGreaterThan(bar.getBoundingClientRect().top);
    expect(window.innerHeight).toBe(window.visualViewport?.height);
    await settle(() => { field.focus(); visual.dispatchEvent(new Event('resize')); });
    expect(screen.queryByTestId('mobile-bottom-tab')).not.toBeInTheDocument();
    expect(field.getBoundingClientRect().top).toBeGreaterThanOrEqual(0);
    expect(field.getBoundingClientRect().bottom).toBeLessThanOrEqual(97);
    expect(field.getBoundingClientRect().height).toBeGreaterThan(37);
    expect(field.style.height).toBe('96px'); // Alpha's natural/content height is retained.
    expect(document.activeElement).toBe(field);
    visual.height = 360; vi.stubGlobal('innerHeight', 360);
    await settle(() => { visual.dispatchEvent(new Event('resize')); window.dispatchEvent(new Event('resize')); });
    expect(screen.getByTestId('mobile-bottom-tab')).toBeInTheDocument();
    expect(field.style.minHeight).toBe('38px'); expect(field.style.maxHeight).toBe('96px');
    expect(document.activeElement).toBe(field);
  });
  it('clamps an editor smaller than its Alpha minimum when necessary and restores only owned sizing on blur/detach', async () => {
    const visual = viewport(31); const workspace = document.createElement('div');
    const field = document.createElement('textarea'); field.style.minHeight = '38px'; field.style.maxHeight = '96px'; workspace.append(field); document.body.append(workspace);
    measuredField(field, 0, 96); const changed = vi.fn(); const detach = observeBetaCompactEditing(workspace, changed);
    try {
      await settle(() => { field.focus(); visual.dispatchEvent(new Event('resize')); });
      expect(changed).toHaveBeenLastCalledWith(true); expect(field.getBoundingClientRect().height).toBeLessThanOrEqual(31); expect(parseFloat(field.style.minHeight)).toBeLessThanOrEqual(31);
      await settle(() => { field.blur(); });
      expect(changed).toHaveBeenLastCalledWith(false); expect(field.style.minHeight).toBe('38px'); expect(field.style.maxHeight).toBe('96px');
      await settle(() => { field.focus(); });
      field.style.maxHeight = '17px'; detach();
      expect(field.style.maxHeight).toBe('17px'); expect(field.style.minHeight).toBe('38px');
    } finally { detach(); workspace.remove(); }
  });
  it('keeps the normal Alpha bar in portrait and without an active editor', async () => {
    const visual = viewport(341);
    render(<BetaAppShell section="now" onSectionChange={vi.fn()} profileName="P" onProfileClick={vi.fn()}
      now={<textarea aria-label="portrait capture"/>} sync={<p>同步</p>} settings={<p>设置</p>}/>);
    const field = screen.getByRole('textbox', { name: 'portrait capture' }) as HTMLTextAreaElement; measuredField(field, 100);
    await settle(() => { field.focus(); visual.dispatchEvent(new Event('resize')); });
    expect(screen.getByTestId('mobile-bottom-tab')).toBeInTheDocument(); expect(field.style.maxHeight).toBe('');
    await settle(() => { field.blur(); visual.height = 97; visual.dispatchEvent(new Event('resize')); });
    expect(screen.getByTestId('mobile-bottom-tab')).toBeInTheDocument();
  });
  it('fits the real settings 46px URL field into a 45px scroll clip while preserving its full caret line, then restores its Alpha size', async () => {
    const visual = viewport(97), frame = document.createElement('div'), main = document.createElement('main'), workspace = document.createElement('div'), clip = document.createElement('div'), field = document.createElement('input');
    field.type = 'url';field.style.cssText = 'box-sizing:border-box;height:46px;line-height:20px;font-size:14px;padding:12px 16px;border:1px solid black';clip.style.overflowY = 'auto';workspace.style.overflowY = 'hidden';clip.append(field);workspace.append(clip);main.append(workspace);frame.append(main);document.body.append(frame);
    const box = (top: number, height: number) => ({ top, bottom: top + height, left: 0, right: 640, width: 640, height } as DOMRect);
    for (const element of [frame,main,workspace]) vi.spyOn(element,'getBoundingClientRect').mockImplementation(() => box(0,visual.height));
    vi.spyOn(clip,'getBoundingClientRect').mockImplementation(() => box(52,visual.height - 52));Object.defineProperty(clip,'clientHeight',{get:()=>visual.height - 52});
    vi.spyOn(field,'getBoundingClientRect').mockImplementation(() => box(52.281,Math.min(46,parseFloat(field.style.maxHeight)||46)));
    const original = field.getBoundingClientRect();expect(original.bottom).toBeGreaterThan(97);expect(original.height).toBe(46);
    const changed = vi.fn(),detach = observeBetaCompactEditing(workspace,changed);
    try {
      await settle(()=>{field.focus();visual.dispatchEvent(new Event('resize'));});
      const rect = field.getBoundingClientRect(),style = getComputedStyle(field),caretBudget = rect.height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - parseFloat(style.borderTopWidth) - parseFloat(style.borderBottomWidth);
      expect(changed).toHaveBeenLastCalledWith(true);expect(rect.top).toBeGreaterThanOrEqual(52);expect(rect.bottom).toBeLessThanOrEqual(97);expect(rect.height).toBe(44);expect(caretBudget).toBeGreaterThanOrEqual(parseFloat(style.lineHeight));expect(field.style.height).toBe('46px');expect(document.activeElement).toBe(field);
      visual.height = 360;vi.stubGlobal('innerHeight',360);await settle(()=>visual.dispatchEvent(new Event('resize')));
      expect(changed).toHaveBeenLastCalledWith(false);expect(field.style.maxHeight).toBe('');expect(field.style.minHeight).toBe('');expect(field.style.paddingTop).toBe('12px');expect(field.style.paddingBottom).toBe('12px');expect(field.getBoundingClientRect().height).toBe(46);expect(document.activeElement).toBe(field);
    } finally { detach();frame.remove(); }
  });
  it('restores only compact input padding it still owns on blur and cleanup', async () => {
    const visual = viewport(45),workspace = document.createElement('div'),field = document.createElement('input');field.style.cssText = 'height:46px;line-height:20px;padding-top:12px;padding-bottom:12px;border-width:1px';workspace.append(field);document.body.append(workspace);
    vi.spyOn(field,'getBoundingClientRect').mockImplementation(()=>({top:0,bottom:Math.min(46,parseFloat(field.style.maxHeight)||46),left:0,right:640,width:640,height:Math.min(46,parseFloat(field.style.maxHeight)||46)} as DOMRect));
    const detach = observeBetaCompactEditing(workspace,vi.fn());
    try {
      await settle(()=>{field.focus();visual.dispatchEvent(new Event('resize'));});expect(parseFloat(field.style.paddingTop)).toBeLessThan(12);
      await settle(()=>field.blur());expect(field.style.paddingTop).toBe('12px');expect(field.style.paddingBottom).toBe('12px');
      await settle(()=>field.focus());field.style.paddingTop = '9px';detach();expect(field.style.paddingTop).toBe('9px');expect(field.style.paddingBottom).toBe('12px');
    } finally { detach();workspace.remove(); }
  });
});
