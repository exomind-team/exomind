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
});
