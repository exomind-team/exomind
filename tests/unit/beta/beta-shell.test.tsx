import { useEffect } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BetaAppShell } from '@/beta/BetaAppShell';
const layout=vi.hoisted(()=>({desktop:false}));
vi.mock('@/ui/app/hooks/useIsDesktop',()=>({useIsDesktop:()=>layout.desktop}));

describe('Beta shell workspace ownership',()=>{
  it('uses the real brand as the sole stable sidebar toggle and preserves the editor',()=>{
    layout.desktop=true; localStorage.clear();
    render(<BetaAppShell section="now" onSectionChange={vi.fn()} profileName="P" onProfileClick={vi.fn()} now={<textarea aria-label="brand draft" defaultValue="kept"/>} sync={null} settings={null}/>);
    const logo=screen.getByRole('img',{name:'外心'}),toggle=logo.closest('button')!;
    const editor=screen.getByRole('textbox',{name:'brand draft'});
    expect(toggle).toHaveAttribute('aria-pressed','false');
    fireEvent.click(toggle);expect(toggle).toHaveAttribute('aria-pressed','true');
    expect(screen.getAllByTestId('desktop-sidebar-toggle')).toHaveLength(1);
    fireEvent.keyDown(toggle,{key:'Enter'});fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed','false');
    expect(screen.getByRole('textbox',{name:'brand draft'})).toBe(editor);
  });
  it('moves one mounted workspace between the actual Alpha mobile and desktop shells',()=>{
    layout.desktop=false;const mounted=vi.fn();const closed=vi.fn();
    function Workspace(){useEffect(()=>{mounted();return closed;},[]);return <textarea aria-label="owned draft" defaultValue="kept"/>;}
    const props={section:'now' as const,onSectionChange:vi.fn(),profileName:'P',onProfileClick:vi.fn(),sync:<p>同步</p>,settings:<p>设置</p>};
    const {rerender}=render(<BetaAppShell {...props} now={<Workspace/>}/>);
    const input=screen.getByRole('textbox',{name:'owned draft'});fireEvent.change(input,{target:{value:'same owner'}});
    expect(screen.getByTestId('mobile-bottom-tab')).toBeInTheDocument();
    layout.desktop=true;rerender(<BetaAppShell {...props} now={<Workspace/>}/>);
    expect(screen.getByTestId('desktop-sidebar')).toBeInTheDocument();
    expect(screen.getByRole('textbox',{name:'owned draft'})).toBe(input);
    expect(input).toHaveValue('same owner');expect(mounted).toHaveBeenCalledTimes(1);expect(closed).not.toHaveBeenCalled();
  });
});
