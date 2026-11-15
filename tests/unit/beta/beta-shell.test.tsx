import { useEffect } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BetaAppShell } from '@/beta/BetaAppShell';
const layout=vi.hoisted(()=>({desktop:false}));
vi.mock('@/ui/app/hooks/useIsDesktop',()=>({useIsDesktop:()=>layout.desktop}));

describe('Beta shell workspace ownership',()=>{
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
