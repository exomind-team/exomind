import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BetaShareHandoffInbox } from '@/beta/BetaShareHandoffInbox';
import type { BetaShareHandoff, BetaShareHandoffSummary, BetaShareHandoffsClient } from '@/beta/share-handoff-client';
import type { BetaDraftController } from '@/beta/drafts';

const summary:BetaShareHandoffSummary={handoff_id:'handoff-1',received_at_ms:1000,state:'ready',bound_profile_id:null,profile_match:true,error_code:null,recovery_instruction:null,text_state:'ready',text_preview:'https://example.test',items:[{
  item_id:'item-1',name:'shared.png',media_type:'image/png',byte_length:4,state:'ready',error_code:null,recovery_instruction:null,
}]};
const full:BetaShareHandoff={handoff_id:summary.handoff_id,received_at_ms:summary.received_at_ms,state:summary.state,bound_profile_id:null,error_code:null,recovery_instruction:null,text_state:'ready',text:'https://example.test\nshared note',items:[{...summary.items[0],sha256:'a'.repeat(64)}]};

function clientFixture():BetaShareHandoffsClient{
  return {
    list:vi.fn(async()=>[summary]),get:vi.fn(async()=>full),bindProfile:vi.fn(async()=>{}),
    acknowledgeText:vi.fn(async()=>{}),acknowledgeItem:vi.fn(async()=>{}),
    discard:vi.fn(async()=>{}),cancel:vi.fn(async()=>({cancel_requested:true,status:'cancelled'})),onAvailable:vi.fn(async()=>vi.fn()),
  };
}

function controllerFixture(fileOriginal=true){
  return {
    appendSharedHandoffText:vi.fn(async()=>true),
    addFiles:vi.fn(async()=>['draft-file-1']),
    submit:vi.fn(async()=>null),
    snapshot:()=>({drafts:{'profile-a':{files:[{id:'draft-file-1',...(fileOriginal?{original:{original_id:'draft-file-1',sha256:'a'.repeat(64),byte_length:4,file_name:'shared.png',media_type:'image/png'}}:{})}]}}}),
    flush:vi.fn(async()=>{}),
  } as unknown as BetaDraftController;
}

function renderInbox(client:BetaShareHandoffsClient,controller:BetaDraftController,onSwitchProfile?: (profileId:string)=>void){
  const refresh=vi.fn(async()=>{});
  render(<BetaShareHandoffInbox client={client} queue={{handoffs:[summary],loading:false,error:'',refresh}} controller={controller} profileId="profile-a" profileName="工作档案" onSwitchProfile={onSwitchProfile}/>);
  return refresh;
}

describe('BetaShareHandoffInbox',()=>{
  it('reports unknown receipt state after a queue read failure and keeps retry available',async()=>{
    const user=userEvent.setup(),refresh=vi.fn(async()=>{});
    render(<BetaShareHandoffInbox client={clientFixture()} queue={{handoffs:[],loading:false,error:'read failed',refresh}}
      controller={controllerFixture()} profileId="profile-a" profileName="工作档案"/>);

    expect(screen.getByRole('alert')).toHaveTextContent('系统分享状态未知');
    expect(screen.getByRole('alert')).toHaveTextContent('请保留来源应用中的原始内容');
    expect(screen.getByRole('alert')).not.toHaveTextContent('由本机保留');
    await user.click(screen.getByRole('button',{name:'重新读取'}));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('requires an explicit draft action, appends text once, imports each opaque file, then acknowledges the ready sources',async()=>{
    const user=userEvent.setup(),client=clientFixture(),controller=controllerFixture(),refresh=renderInbox(client,controller);
    expect(client.get).not.toHaveBeenCalled();
    expect(controller.appendSharedHandoffText).not.toHaveBeenCalled();
    expect(controller.addFiles).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button',{name:'添加到「工作档案」草稿'}));

    expect(client.get).toHaveBeenCalledWith('handoff-1','profile-a');
    expect(client.bindProfile).toHaveBeenCalledWith('handoff-1','profile-a');
    expect(client.bindProfile.mock.invocationCallOrder[0]).toBeLessThan(controller.appendSharedHandoffText.mock.invocationCallOrder[0]);
    expect(client.bindProfile.mock.invocationCallOrder[0]).toBeLessThan(controller.addFiles.mock.invocationCallOrder[0]);
    expect(controller.appendSharedHandoffText).toHaveBeenCalledWith('profile-a','handoff-1',full.text);
    expect(controller.addFiles).toHaveBeenCalledWith('profile-a',[
      {kind:'shared_handoff_file',handoffId:'handoff-1',itemId:'item-1',profileId:'profile-a',name:'shared.png',size:4,type:'image/png'},
    ],{sourceIds:[expect.stringMatching(/^share-[a-f0-9]{32}$/)]});
    expect(controller.flush).toHaveBeenCalledTimes(1);
    expect(client.acknowledgeText).toHaveBeenCalledWith('handoff-1','profile-a');
    expect(client.acknowledgeItem).toHaveBeenCalledWith('handoff-1','item-1','profile-a');
    expect(refresh).toHaveBeenCalled();
    expect(controller.submit).not.toHaveBeenCalled();
  });

  it('does not consume a share attachment until its local source is integrity-bound in the draft',async()=>{
    const user=userEvent.setup(),client=clientFixture(),controller=controllerFixture(false);
    renderInbox(client,controller);

    await user.click(screen.getByRole('button',{name:'添加到「工作档案」草稿'}));

    expect(client.acknowledgeText).toHaveBeenCalledWith('handoff-1','profile-a');
    expect(client.acknowledgeItem).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('本机附件尚未完成完整性校验');
  });

  it('acknowledges ready items independently when another item in the same share batch fails',async()=>{
    const user=userEvent.setup(),client=clientFixture();
    const second={item_id:'item-2',name:'shared-2.png',media_type:'image/png',byte_length:4,error_code:null,recovery_instruction:null,state:'ready' as const};
    const mixedSummary={...summary,items:[...summary.items,second]};
    client.list=vi.fn(async()=>[mixedSummary]);
    client.get=vi.fn(async()=>({...full,items:[...full.items,{...second,sha256:'b'.repeat(64)}]}));
    let addCount=0;
    const controller={
      appendSharedHandoffText:vi.fn(async()=>true),
      addFiles:vi.fn(async()=>[`draft-file-${++addCount}`]),
      snapshot:()=>({drafts:{'profile-a':{files:[{id:`draft-file-${addCount}`,...(addCount===2?{original:{original_id:`draft-file-${addCount}`,sha256:'b'.repeat(64),byte_length:4,file_name:'shared-2.png',media_type:'image/png'}}:{})}]}}}),
      flush:vi.fn(async()=>{}),submit:vi.fn(async()=>null),
    } as unknown as BetaDraftController;
    renderInbox(client,controller);

    await user.click(screen.getByRole('button',{name:'添加到「工作档案」草稿'}));

    expect(client.acknowledgeItem).toHaveBeenCalledTimes(1);
    expect(client.acknowledgeItem).toHaveBeenCalledWith('handoff-1','item-2','profile-a');
    expect(screen.getByRole('alert')).toHaveTextContent('本机附件尚未完成完整性校验');
    expect(controller.submit).not.toHaveBeenCalled();
  });

  it('keeps earlier ready files actionable after the user cancels a later file in a multi-share',async()=>{
    const user=userEvent.setup(),client=clientFixture();
    const cancelledItem={item_id:'item-2',name:'cancelled.png',media_type:'image/png',byte_length:4,state:'cancelled' as const,error_code:'cancelled' as const,recovery_instruction:'此附件未完成'};
    const cancelledSummary:BetaShareHandoffSummary={...summary,state:'cancelled',error_code:'cancelled',recovery_instruction:'接收已取消',text_state:'none',text_preview:null,items:[summary.items[0],cancelledItem]};
    const cancelledFull:BetaShareHandoff={handoff_id:cancelledSummary.handoff_id,received_at_ms:cancelledSummary.received_at_ms,state:'cancelled',bound_profile_id:null,error_code:'cancelled',recovery_instruction:'接收已取消',text_state:'none',text:null,items:[{...full.items[0]},{...cancelledItem,sha256:null}]};
    client.list=vi.fn(async()=>[cancelledSummary]);
    client.get=vi.fn(async()=>cancelledFull);
    const controller=controllerFixture();
    renderInbox(client,controller);

    await user.click(screen.getByRole('button',{name:'添加到「工作档案」草稿'}));

    expect(client.acknowledgeItem).toHaveBeenCalledTimes(1);
    expect(client.acknowledgeItem).toHaveBeenCalledWith('handoff-1','item-1','profile-a');
    expect(controller.submit).not.toHaveBeenCalled();
  });

  it('keeps a cancelled receipt with no ready payload visible until explicit discard',async()=>{
    const user=userEvent.setup(),client=clientFixture(),controller=controllerFixture();
    const cancelled:BetaShareHandoffSummary={...summary,state:'cancelled',error_code:'cancelled',
      recovery_instruction:'未完成内容不会继续接收；请从来源应用重新分享。',text_state:'cancelled',text_preview:null,items:[]};
    const refresh=vi.fn(async()=>{});
    render(<BetaShareHandoffInbox client={client} queue={{handoffs:[cancelled],loading:false,error:'',refresh}} controller={controller}
      profileId="profile-a" profileName="工作档案"/>);

    expect(screen.getByRole('heading',{name:'系统分享接收已取消'})).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('已确认取消接收');
    expect(screen.queryByRole('button',{name:/添加到/})).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'取消接收'})).not.toBeInTheDocument();
    await user.click(screen.getByRole('button',{name:'放弃本次分享…'}));
    await user.click(screen.getByRole('button',{name:'确认放弃'}));

    expect(client.discard).toHaveBeenCalledWith('handoff-1','profile-a');
    expect(refresh).toHaveBeenCalled();
    expect(controller.submit).not.toHaveBeenCalled();
  });

  it.each([
    {code:'quota_exceeded' as const, message:'已加入草稿的文字和附件仍保留'},
    {code:'storage_unavailable' as const, message:'释放设备存储空间'},
  ])('keeps the Native $code cause visible after ready-prefix import',async({code,message})=>{
    const user=userEvent.setup(),client=clientFixture(),controller=controllerFixture();
    const unfinished={...summary.items[0],item_id:'item-2',name:'unfinished.png',state:'interrupted' as const,error_code:code,recovery_instruction:null};
    const partialSummary:BetaShareHandoffSummary={...summary,state:'interrupted',error_code:code,recovery_instruction:null,
      text_state:'none',text_preview:null,items:[summary.items[0],unfinished]};
    const partialFull:BetaShareHandoff={...full,state:'interrupted',error_code:code,recovery_instruction:null,text_state:'none',text:null,
      items:[full.items[0],{...unfinished,sha256:null}]};
    client.list=vi.fn(async()=>[partialSummary]);
    client.get=vi.fn(async()=>partialFull);
    renderInbox(client,controller);

    await user.click(screen.getByRole('button',{name:'添加到「工作档案」草稿'}));

    expect(controller.addFiles).toHaveBeenCalledTimes(1);
    expect(client.acknowledgeItem).toHaveBeenCalledWith('handoff-1','item-1','profile-a');
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('alert')).not.toHaveTextContent('系统分享未能全部加入草稿');
    expect(controller.submit).not.toHaveBeenCalled();
  });

  it('preserves ready-prefix success when a later staged item hit the quota',async()=>{
    const user=userEvent.setup(),client=clientFixture(),controller=controllerFixture();
    const quotaItem={...summary.items[0],item_id:'item-2',name:'later.png',state:'interrupted' as const,error_code:'quota_exceeded' as const};
    const quotaSummary:BetaShareHandoffSummary={...summary,state:'interrupted',error_code:'quota_exceeded',recovery_instruction:'暂存额度已满',items:[summary.items[0],quotaItem]};
    const quotaFull:BetaShareHandoff={...full,state:'interrupted',items:[full.items[0],{...quotaItem,sha256:null}]};
    client.list=vi.fn(async()=>[quotaSummary]);
    client.get=vi.fn(async()=>quotaFull);
    renderInbox(client,controller);

    await user.click(screen.getByRole('button',{name:'添加到「工作档案」草稿'}));

    expect(controller.addFiles).toHaveBeenCalledTimes(1);
    expect(client.acknowledgeItem).toHaveBeenCalledWith('handoff-1','item-1','profile-a');
    expect(client.acknowledgeItem).not.toHaveBeenCalledWith('handoff-1','item-2','profile-a');
    expect(screen.getByRole('alert')).toHaveTextContent('已完成的文字和附件保留');
  });

  it('maps storage staging failures to device storage recovery guidance',()=>{
    const client=clientFixture(),controller=controllerFixture();
    const storageFailure:BetaShareHandoffSummary={...summary,state:'interrupted',error_code:'storage_unavailable',recovery_instruction:null,
      text_state:'none',text_preview:null,items:[]};
    render(<BetaShareHandoffInbox client={client} queue={{handoffs:[storageFailure],loading:false,error:'',refresh:vi.fn(async()=>{})}}
      controller={controller} profileId="profile-a" profileName="工作档案"/>);

    expect(screen.getByRole('alert')).toHaveTextContent('释放设备存储空间');
    expect(screen.getByRole('alert')).toHaveTextContent('重新分享原始内容');
  });

  it('does not split content across profiles when the binding conflicts',async()=>{
    const user=userEvent.setup(),client=clientFixture(),controller=controllerFixture(),refresh=vi.fn(async()=>{});
    client.bindProfile=vi.fn(async()=>{throw Object.assign(new Error('conflict'),{code:'profile_conflict'});});
    render(<BetaShareHandoffInbox client={client} queue={{handoffs:[summary],loading:false,error:'',refresh}} controller={controller} profileId="profile-b" profileName="別の檔案"/>);

    await user.click(screen.getByRole('button',{name:'添加到「別の檔案」草稿'}));

    expect(client.get).toHaveBeenCalledWith('handoff-1','profile-b');
    expect(client.bindProfile).toHaveBeenCalledWith('handoff-1','profile-b');
    expect(controller.appendSharedHandoffText).not.toHaveBeenCalled();
    expect(controller.addFiles).not.toHaveBeenCalled();
    expect(client.acknowledgeText).not.toHaveBeenCalled();
    expect(client.acknowledgeItem).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent('已绑定到另一档案');
  });

  it('shows redacted foreign shares as a profile recovery, never as an empty share',async()=>{
    const user=userEvent.setup(),client=clientFixture(),controller=controllerFixture(),onSwitchProfile=vi.fn();
    const foreign:BetaShareHandoffSummary={...summary,bound_profile_id:'profile-a',profile_match:false,text_state:'none',text_preview:null,items:[]};
    render(<BetaShareHandoffInbox client={client} queue={{handoffs:[foreign],loading:false,error:'',refresh:vi.fn(async()=>{})}} controller={controller}
      profileId="profile-b" profileName="另一档案" profileNameFor={id=>id==='profile-a'?'个人档案':id} onSwitchProfile={onSwitchProfile}/>);

    expect(screen.getByRole('heading',{name:'系统分享属于其他档案'})).toBeInTheDocument();
    expect(screen.getByText(/分享内容已隐藏/)).toBeInTheDocument();
    expect(screen.queryByText(/无文字内容/)).not.toBeInTheDocument();
    expect(screen.queryByText('https://example.test')).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:/添加到/})).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:/放弃本次分享/})).not.toBeInTheDocument();
    await user.click(screen.getByRole('button',{name:'切换到「个人档案」档案'}));
    expect(onSwitchProfile).toHaveBeenCalledWith('profile-a');
  });
});
