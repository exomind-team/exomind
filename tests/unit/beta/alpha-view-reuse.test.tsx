import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Settings, Target } from 'lucide-react';
import { AlphaDesktopShellView, AlphaDesktopSidebarView, AlphaMobileShellView } from '@/ui/app/components/AlphaAppShellView';
import { ChatMessageRowView } from '@/ui/app/components/ChatMessageRowView';

describe('shared Alpha presentation without legacy bootstrap',()=>{
  it('retains desktop collapse, header, active item and footer geometry with caller-owned actions',()=>{
    const toggle=vi.fn();const choose=vi.fn();
    render(<AlphaDesktopShellView sidebar={<AlphaDesktopSidebarView collapsed={false} onToggleCollapsed={toggle} footer={<span>档案P</span>}
      items={[{key:'now',title:'当下',icon:Target,active:true}]}
      renderNavigationItem={(item,view)=><button className={view.className} data-testid={view.testId} onClick={choose}>{view.children}</button>}/>}>内容</AlphaDesktopShellView>);
    expect(screen.getByTestId('desktop-sidebar')).toHaveClass('w-64');
    expect(screen.getByTestId('desktop-sidebar-item-now')).toHaveClass('font-medium');
    expect(screen.getByTestId('desktop-settings-content')).toHaveTextContent('内容');
    expect(screen.getByText('档案P')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'收起侧边栏'}));expect(toggle).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button',{name:'当下'}));expect(choose).toHaveBeenCalledTimes(1);
  });
  it('keeps mobile safe-area navigation while the owner switches content',()=>{
    const choose=vi.fn();render(<AlphaMobileShellView items={[{key:'settings',title:'设置',icon:Settings,active:true}]} renderNavigationItem={(item,view)=><button className={view.className} onClick={choose}>{view.children}</button>}><p>内容</p></AlphaMobileShellView>);
    expect(screen.getByTestId('mobile-bottom-tab')).toHaveClass('absolute','bottom-0');
    expect(screen.getByRole('main')).toHaveClass('bottom-[calc(env(safe-area-inset-bottom,0px)+60px)]');
    fireEvent.click(screen.getByRole('button',{name:'设置'}));expect(choose).toHaveBeenCalledTimes(1);
  });
  it('preserves user/system message slots and the actual event row ref',()=>{
    const ref=createRef<HTMLDivElement>();render(<ChatMessageRowView eventId="event-p" rowRef={ref} tone="user" avatar={<span>头像</span>} metadata={<span>昨天</span>} content={<p>原文</p>} actions={<button>复制</button>}/>);
    expect(ref.current).toBe(screen.getByTestId('new-mobile-user-message-row'));
    expect(ref.current).toHaveAttribute('data-event-id','event-p');
    expect(screen.getByText('原文').parentElement).toHaveClass('bg-user-bubble','rounded-2xl');
    expect(screen.getByRole('button',{name:'复制'})).toBeInTheDocument();
    expect(ref.current?.lastElementChild).toHaveTextContent('头像');
  });
});
