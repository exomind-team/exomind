import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BetaShareHandoffCard, type BetaShareHandoffCardProps } from '@/beta/BetaShareHandoffCard';

function props(overrides:Partial<BetaShareHandoffCardProps>={}):BetaShareHandoffCardProps{
  return {
    handoffId:'handoff-1',profileName:'工作档案',text:'https://example.test/\n参考内容',textState:'ready',
    items:[{id:'item-1',name:'现场照片.png',mediaType:'image/png',byteLength:1536,state:'ready'}],
    state:'ready',onCancelReceive:vi.fn(),onAddToDraft:vi.fn(),onDiscard:vi.fn(),...overrides,
  };
}

describe('BetaShareHandoffCard',()=>{
  it('shows the target and staged evidence while keeping the event behind Send',async()=>{
    const user=userEvent.setup(),onAddToDraft=vi.fn();
    render(<BetaShareHandoffCard {...props({onAddToDraft})}/>);

    expect(screen.getByRole('heading',{name:'系统分享已接收'})).toBeInTheDocument();
    expect(screen.getByText(/内容已暂存在本机；加入「工作档案」草稿后仍需手动发送/)).toBeInTheDocument();
    expect(screen.getByText('现场照片.png')).toBeInTheDocument();
    expect(screen.getByText('1.5 KiB · image/png · 已校验')).toBeInTheDocument();
    expect(screen.queryByText(/事件已创建|已记入档案/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button',{name:'添加到「工作档案」草稿'}));
    expect(onAddToDraft).toHaveBeenCalledTimes(1);
  });

  it('offers a real cancel action during receipt and does not expose commit',async()=>{
    const user=userEvent.setup(),onCancelReceive=vi.fn();
    render(<BetaShareHandoffCard {...props({state:'receiving',onCancelReceive})}/>);

    expect(screen.getByRole('status')).toHaveTextContent('正在安全暂存分享内容');
    expect(screen.getByRole('button',{name:'取消接收'})).toBeEnabled();
    expect(screen.queryByRole('button',{name:/添加到/})).not.toBeInTheDocument();
    await user.click(screen.getByRole('button',{name:'取消接收'}));
    expect(onCancelReceive).toHaveBeenCalledTimes(1);
  });

  it('requires explicit confirmation before discarding a ready handoff',async()=>{
    const user=userEvent.setup(),onDiscard=vi.fn();
    render(<BetaShareHandoffCard {...props({onDiscard})}/>);

    await user.click(screen.getByRole('button',{name:'放弃本次分享…'}));
    expect(onDiscard).not.toHaveBeenCalled();
    expect(screen.getByRole('group',{name:'确认放弃系统分享'})).toHaveTextContent('不会创建事件记录');
    await user.click(screen.getByRole('button',{name:'确认放弃'}));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('tells the user to re-share when the Android source permission expires',()=>{
    render(<BetaShareHandoffCard {...props({
      text:'',textState:'none',state:'failed',
      items:[{id:'item-1',name:'现场照片.png',mediaType:'image/png',byteLength:1536,state:'failed',message:'来源权限已失效，请回来源应用重新分享。'}],
    })}/>);

    expect(screen.getByText('来源权限已失效，请回来源应用重新分享。')).toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'重试接收'})).not.toBeInTheDocument();
  });

  it('shows a redacted foreign profile as a switch action and hides normal share actions',async()=>{
    const user=userEvent.setup(),onSwitchToBoundProfile=vi.fn();
    render(<BetaShareHandoffCard {...props({profileMismatch:true,boundProfileName:'个人档案',text:'',textState:'none',items:[],onSwitchToBoundProfile})}/>);

    expect(screen.getByRole('heading',{name:'系统分享属于其他档案'})).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('分享内容已隐藏');
    expect(screen.queryByText(/无文字内容/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:/添加到/})).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:/放弃本次分享/})).not.toBeInTheDocument();
    await user.click(screen.getByRole('button',{name:'切换到「个人档案」档案'}));
    expect(onSwitchToBoundProfile).toHaveBeenCalledTimes(1);
  });
});
