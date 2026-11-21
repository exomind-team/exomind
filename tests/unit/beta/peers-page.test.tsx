import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BetaPeersPage } from '@/beta/BetaPeersPage';
import type { BetaJoinResult, BetaPeerStatus, BetaPeersClient } from '@/beta/peers-client';
import { deferred } from './fixtures';

const P='11111111-1111-4111-8111-111111111111';
const Q='22222222-2222-4222-8222-222222222222';
const D='33333333-3333-4333-8333-333333333333';
const R='44444444-4444-4444-8444-444444444444';
const B='55555555-5555-4555-8555-555555555555';
const status=(profile=P):BetaPeerStatus=>({runtime_id:R,device_id:D,profile_id:profile,network_enabled:false,local_addresses:[],peers:[]});
function peers(){return{
  status:vi.fn(async(profile:string)=>status(profile)),nearbyCandidates:vi.fn<BetaPeersClient['nearbyCandidates']>(async()=>[]),setEnabled:vi.fn(async()=>{}),
  createInvitation:vi.fn(async()=>({invitation_text:'opaque-secret',invitation_id:B,expires_at_ms:2000,local_addresses:[]})),
  inspectInvitation:vi.fn(async()=>({profile_id:P,profile_name:'目标档案',issuer_device_id:B,fingerprint_sha256:'a'.repeat(64),expires_at_ms:2000,compatible:true})),
  joinInvitation:vi.fn<BetaPeersClient['joinInvitation']>(async()=>({profile_id:P,peer_device_id:B,state:'pending'})),
  sync:vi.fn(async()=>{}),revoke:vi.fn(async()=>{}),
} satisfies BetaPeersClient;}
const props={profileId:Q,profileName:'原档案Q',runtimeId:R,deviceId:D};

describe('Beta device joining UI',()=>{
  it('recovers an unreachable invitation through another route while retaining the invitation identity and old profile',async()=>{
    const client=peers(),joined=vi.fn(async()=>{});
    client.joinInvitation.mockRejectedValueOnce(new Error('邀请地址暂不可达'))
      .mockResolvedValue({profile_id:P,peer_device_id:B,state:'ready'});
    render(<BetaPeersPage {...props} peers={client} onJoined={joined}/>);
    fireEvent.change(screen.getByLabelText('另一设备的完整邀请'),{target:{value:'synthetic-invitation'}});
    fireEvent.click(screen.getByRole('button',{name:'检查邀请'}));
    await screen.findByText('加入「目标档案」');
    fireEvent.click(screen.getByRole('button',{name:'确认加入档案'}));
    await screen.findByText('邀请地址暂不可达');
    expect(joined).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'更换连接地址'}));
    fireEvent.change(screen.getByLabelText('其他连接地址'),{target:{value:'192.0.2.3:43344'}});
    fireEvent.click(screen.getByRole('button',{name:'确认加入档案'}));
    await waitFor(()=>expect(joined).toHaveBeenCalledWith(P));
    expect(client.joinInvitation).toHaveBeenLastCalledWith('synthetic-invitation','192.0.2.3:43344');
    expect(client.createInvitation).not.toHaveBeenCalled();
  });
  it('pauses hidden observation and a late previous read cannot overwrite the resumed status',async()=>{
    const client=peers(),old=deferred<BetaPeerStatus>();
    client.status.mockImplementationOnce(()=>old.promise).mockResolvedValue({...status(Q),network_enabled:true});
    const view=render(<BetaPeersPage {...props} peers={client} visible={false} onJoined={vi.fn(async()=>{})}/>);
    expect(client.status).not.toHaveBeenCalled();
    view.rerender(<BetaPeersPage {...props} peers={client} visible onJoined={vi.fn(async()=>{})}/>);
    await waitFor(()=>expect(client.status).toHaveBeenCalledOnce());
    view.rerender(<BetaPeersPage {...props} peers={client} visible={false} onJoined={vi.fn(async()=>{})}/>);
    view.rerender(<BetaPeersPage {...props} peers={client} visible onJoined={vi.fn(async()=>{})}/>);
    await waitFor(()=>expect(screen.getByRole('switch',{name:'设备同步'})).toBeChecked());
    await act(async()=>{old.resolve(status(Q));await old.promise;});
    expect(screen.getByRole('switch',{name:'设备同步'})).toBeChecked();
    vi.useFakeTimers();
    try{
      view.rerender(<BetaPeersPage {...props} peers={client} visible={false} onJoined={vi.fn(async()=>{})}/>);
      await act(async()=>{await vi.advanceTimersByTimeAsync(6000);});
      expect(client.status).toHaveBeenCalledTimes(2);expect(client.sync).not.toHaveBeenCalled();expect(client.setEnabled).not.toHaveBeenCalled();
    }finally{view.unmount();vi.useRealTimers();}
  });
  it('requires authoritative network confirmation and does not optimistically mark enabled',async()=>{
    const client=peers();const enabled=deferred<void>();client.setEnabled.mockImplementationOnce(()=>enabled.promise);
    render(<BetaPeersPage {...props} peers={client} onJoined={vi.fn(async()=>{})}/>);
    const control=await screen.findByRole('switch',{name:'设备同步'});expect(control).not.toBeChecked();
    fireEvent.click(control);expect(client.setEnabled).toHaveBeenCalledWith(true);expect(control).not.toBeChecked();
    client.status.mockResolvedValue({...status(Q),network_enabled:true});
    await act(async()=>{enabled.resolve();await enabled.promise;});
    await waitFor(()=>expect(control).toBeChecked());
    expect(client.sync).not.toHaveBeenCalled();
  });
  it('keeps Q selected while join is pending, and only ready invokes the profile switch',async()=>{
    const client=peers();const joined=vi.fn(async()=>{});
    const ready=vi.fn(async()=>({profile_id:P,peer_device_id:B,state:'ready' as const}));
    render(<BetaPeersPage {...props} peers={client} onJoined={joined}/>);
    fireEvent.change(screen.getByLabelText('另一设备的完整邀请'),{target:{value:'opaque-secret'}});
    fireEvent.click(screen.getByRole('button',{name:'检查邀请'}));
    expect(await screen.findByText('加入「目标档案」')).toBeInTheDocument();
    expect(screen.getByText(/当前「原档案Q」会保留/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'确认加入档案'}));
    expect(await screen.findByText(/加入尚待确认/)).toBeInTheDocument();expect(joined).not.toHaveBeenCalled();
    client.joinInvitation.mockImplementation(ready);
    fireEvent.click(screen.getByRole('button',{name:'继续查证加入'}));
    await waitFor(()=>expect(joined).toHaveBeenCalledWith(P));
  });
  it('discards a delayed P status after selecting Q',async()=>{
    const client=peers();const old=deferred<BetaPeerStatus>();client.status.mockImplementationOnce(()=>old.promise);
    const joined=vi.fn(async()=>{});
    const {rerender}=render(<BetaPeersPage {...props} profileId={P} profileName="P" peers={client} onJoined={joined}/>);
    rerender(<BetaPeersPage {...props} peers={client} onJoined={joined}/>);
    expect(await screen.findByRole('switch',{name:'设备同步'})).not.toBeChecked();
    await act(async()=>{old.resolve({...status(P),network_enabled:true});await old.promise;});
    expect(screen.getByRole('switch',{name:'设备同步'})).not.toBeChecked();
    expect(joined).not.toHaveBeenCalled();
  });
  it('lets an empty device inspect and join without inventing an unrelated profile',async()=>{
    const client=peers();render(<BetaPeersPage {...props} profileId="" profileName="" peers={client} onJoined={vi.fn(async()=>{})}/>);
    fireEvent.change(screen.getByLabelText('另一设备的完整邀请'),{target:{value:'opaque-secret'}});
    fireEvent.click(screen.getByRole('button',{name:'检查邀请'}));
    expect(await screen.findByText('加入「目标档案」')).toBeInTheDocument();
    expect(client.status).not.toHaveBeenCalled();expect(client.createInvitation).not.toHaveBeenCalled();
    expect(screen.queryByRole('switch',{name:'设备同步'})).not.toBeInTheDocument();
  });
  it('does not let an old join result replace a newly pasted invitation',async()=>{
    const client=peers();const flight=deferred<BetaJoinResult>();client.joinInvitation.mockReturnValueOnce(flight.promise);const joined=vi.fn(async()=>{});
    render(<BetaPeersPage {...props} peers={client} onJoined={joined}/>);
    const input=screen.getByLabelText('另一设备的完整邀请');fireEvent.change(input,{target:{value:'old-invitation'}});
    fireEvent.click(screen.getByRole('button',{name:'检查邀请'}));await screen.findByText('加入「目标档案」');
    fireEvent.click(screen.getByRole('button',{name:'确认加入档案'}));await waitFor(()=>expect(client.joinInvitation).toHaveBeenCalledTimes(1));
    fireEvent.change(input,{target:{value:'new-invitation'}});
    await act(async()=>{flight.resolve({profile_id:P,peer_device_id:B,state:'ready'});await flight.promise;});
    expect(joined).not.toHaveBeenCalled();expect(input).toHaveValue('new-invitation');expect(screen.queryByText('加入「目标档案」')).not.toBeInTheDocument();
  });
  it('automatically copies a freshly generated invitation through the supplied clipboard edge',async()=>{
    const client=peers();const copyText=vi.fn(async()=>{});
    render(<BetaPeersPage {...props} peers={client} onJoined={vi.fn(async()=>{})} copyText={copyText}/>);

    fireEvent.click(await screen.findByRole('button',{name:'生成邀请'}));

    expect(await screen.findByText('邀请已生成并复制到剪贴板')).toBeInTheDocument();
    expect(copyText).toHaveBeenCalledOnce();
    expect(copyText).toHaveBeenCalledWith('opaque-secret');
    expect(screen.getByLabelText('完整邀请')).toHaveValue('opaque-secret');
  });
  it('keeps a generated invitation visible when automatic copy fails and lets the user retry',async()=>{
    const client=peers();const copyText=vi.fn(async()=>{}).mockRejectedValueOnce(new Error('clipboard denied'));
    render(<BetaPeersPage {...props} peers={client} onJoined={vi.fn(async()=>{})} copyText={copyText}/>);

    fireEvent.click(await screen.findByRole('button',{name:'生成邀请'}));

    expect(await screen.findByText(/邀请已生成，但自动复制失败/)).toBeInTheDocument();
    expect(screen.getByLabelText('完整邀请')).toHaveValue('opaque-secret');
    const retry=screen.getByRole('button',{name:'复制邀请'});
    expect(retry).toBeEnabled();
    fireEvent.click(retry);
    expect(await screen.findByText('完整邀请已复制')).toBeInTheDocument();
    expect(copyText).toHaveBeenCalledTimes(2);
  });
  it('ignores copy feedback from an invitation owned by a previous profile scope',async()=>{
    const client=peers();const pending=deferred<void>();const copyText=vi.fn(()=>pending.promise);
    const view=render(<BetaPeersPage {...props} profileId={P} profileName="档案P" peers={client} onJoined={vi.fn(async()=>{})} copyText={copyText}/>);
    fireEvent.click(await screen.findByRole('button',{name:'生成邀请'}));
    await waitFor(()=>expect(copyText).toHaveBeenCalledOnce());

    view.rerender(<BetaPeersPage {...props} peers={client} profileId={Q} profileName="档案Q" onJoined={vi.fn(async()=>{})} copyText={copyText}/>);
    await act(async()=>{pending.resolve();await pending.promise;});

    expect(screen.queryByText('邀请已生成并复制到剪贴板')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('完整邀请')).not.toBeInTheDocument();
  });
});

describe('Nearby device selection',()=>{
  it('can explicitly stop discovery again before joining or creating a profile',async()=>{
    const client=peers();
    render(<BetaPeersPage {...props} profileId="" profileName="" peers={client} onJoined={vi.fn(async()=>{})}/>);
    fireEvent.click(screen.getByRole('button',{name:'开启设备同步与发现'}));
    await waitFor(()=>expect(client.setEnabled).toHaveBeenCalledWith(true));
    await screen.findByText('设备同步与附近发现已开启；这不会授权其他设备。');
    fireEvent.click(screen.getByRole('button',{name:'关闭设备同步与发现'}));
    await waitFor(()=>expect(client.setEnabled).toHaveBeenCalledWith(false));
    expect(client.status).not.toHaveBeenCalled();
    expect(client.createInvitation).not.toHaveBeenCalled();
    expect(client.joinInvitation).not.toHaveBeenCalled();
  });
  it('uses a selected address only after the full invitation is checked and confirmed',async()=>{
    const address='127.0.0.1:43344';
    const client=peers();
    client.nearbyCandidates.mockResolvedValue([{
      device_id:B,addresses:[address],expires_at_ms:Date.now()+20_000,verification_state:'unverified',
    }]);
    client.joinInvitation.mockResolvedValueOnce({profile_id:P,peer_device_id:B,state:'ready'});
    const joined=vi.fn(async()=>{});
    render(<BetaPeersPage {...props} peers={client} onJoined={joined}/>);

    expect(await screen.findByText('潜在设备')).toBeInTheDocument();
    expect(screen.getByText('未验证 · 发现不会授权此设备访问档案')).toBeInTheDocument();
    const invitation=screen.getByLabelText('另一设备的完整邀请');
    fireEvent.click(screen.getByRole('button',{name:/选择设备/}));
    expect(await screen.findByText(/已选择设备.*候选地址.*127\.0\.0\.1:43344/)).toBeInTheDocument();
    expect(client.inspectInvitation).not.toHaveBeenCalled();
    expect(client.joinInvitation).not.toHaveBeenCalled();

    fireEvent.change(invitation,{target:{value:'opaque-secret'}});
    expect(screen.getByText(/已选择设备.*候选地址.*127\.0\.0\.1:43344/)).toBeInTheDocument();
    expect(client.inspectInvitation).not.toHaveBeenCalled();
    expect(client.joinInvitation).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button',{name:'检查邀请'}));
    expect(await screen.findByText('加入「目标档案」')).toBeInTheDocument();
    expect(client.inspectInvitation).toHaveBeenCalledWith('opaque-secret');
    expect(client.joinInvitation).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button',{name:'确认加入档案'}));
    await waitFor(()=>expect(client.joinInvitation).toHaveBeenCalledWith('opaque-secret',address));
    await waitFor(()=>expect(joined).toHaveBeenCalledWith(P));
  });

  it('clears a selected address when the inspected invitation names another device',async()=>{
    const address='127.0.0.1:43344';
    const otherIssuer='66666666-6666-4666-8666-666666666666';
    const client=peers();
    client.nearbyCandidates.mockResolvedValue([{
      device_id:B,addresses:[address],expires_at_ms:Date.now()+20_000,verification_state:'unverified',
    }]);
    client.inspectInvitation.mockResolvedValueOnce({
      profile_id:P,profile_name:'目标档案',issuer_device_id:otherIssuer,
      fingerprint_sha256:'a'.repeat(64),expires_at_ms:Date.now()+20_000,compatible:true,
    });
    client.joinInvitation.mockResolvedValueOnce({profile_id:P,peer_device_id:otherIssuer,state:'ready'});
    const joined=vi.fn(async()=>{});
    render(<BetaPeersPage {...props} peers={client} onJoined={joined}/>);

    expect(await screen.findByText('潜在设备')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:/选择设备/}));
    const invitation=screen.getByLabelText('另一设备的完整邀请');
    fireEvent.change(invitation,{target:{value:'opaque-secret'}});
    expect(screen.getByText(/已选择设备.*候选地址.*127\.0\.0\.1:43344/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button',{name:'检查邀请'}));
    expect(await screen.findByText('加入「目标档案」')).toBeInTheDocument();
    expect(screen.queryByText(/已选择设备.*候选地址.*127\.0\.0\.1:43344/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button',{name:'确认加入档案'}));
    await waitFor(()=>expect(client.joinInvitation).toHaveBeenCalled());
    expect(client.joinInvitation.mock.calls[0]).toEqual(['opaque-secret']);
    await waitFor(()=>expect(joined).toHaveBeenCalledWith(P));
  });
});
