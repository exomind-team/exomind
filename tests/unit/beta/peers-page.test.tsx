import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BetaPeersPage } from '@/beta/BetaPeersPage';
import { BetaApiError } from '@/beta/api-error';
import { BetaPeerJoinError } from '@/beta/peers-client';
import type { BetaInvitationPreview, BetaJoinResult, BetaNetworkScan, BetaPeerStatus, BetaPeersClient } from '@/beta/peers-client';
import { deferred } from './fixtures';

const P='11111111-1111-4111-8111-111111111111';
const Q='22222222-2222-4222-8222-222222222222';
const D='33333333-3333-4333-8333-333333333333';
const R='44444444-4444-4444-8444-444444444444';
const B='55555555-5555-4555-8555-555555555555';
const status=(profile=P):BetaPeerStatus=>({runtime_id:R,device_id:D,profile_id:profile,network_enabled:false,local_addresses:[],peers:[]});
function peers(){return{
  status:vi.fn(async(profile:string)=>status(profile)),nearbyCandidates:vi.fn<BetaPeersClient['nearbyCandidates']>(async()=>[]),setEnabled:vi.fn(async()=>{}),
  networkEnabled:vi.fn(async()=>true),
  environmentAlias:vi.fn<BetaPeersClient['environmentAlias']>(async()=>({device_id:D,effective_alias:'Studio PC',source:'os_default',custom_alias:null,max_chars:64})),
  setEnvironmentAlias:vi.fn<BetaPeersClient['setEnvironmentAlias']>(async alias=>({device_id:D,effective_alias:alias??'DESKTOP-0001',source:alias===null?'os_default':'custom',custom_alias:alias,max_chars:64})),
  scanScopes:vi.fn(async()=>[{scope_id:'eth0:192.168.1.0/24',interface_name:'eth0',kind:'physical_lan',prefix:24,eligible:true,network:'192.168.1.0/24',reason:null}]),
  scanNearby:vi.fn<BetaPeersClient['scanNearby']>(async()=>({scan_id:B,started_at_ms:1000,finished_at_ms:2000,stage:'complete',scopes:[],attempted:0,discovered:0,skipped:0,cancelled:false,discovered_addresses:[]})),
  scanStatus:vi.fn(async()=>({scan_id:B,started_at_ms:1000,finished_at_ms:2000,stage:'complete',scopes:[],attempted:0,discovered:0,skipped:0,cancelled:false,discovered_addresses:[]})),
  cancelScan:vi.fn(async()=>({scan_id:B,started_at_ms:1000,finished_at_ms:2000,stage:'cancelled',scopes:[],attempted:0,discovered:0,skipped:0,cancelled:true,discovered_addresses:[]})),
  createInvitation:vi.fn(async()=>({invitation_text:'opaque-secret',invitation_id:B,expires_at_ms:2000,local_addresses:[]})),
  inspectInvitation:vi.fn(async()=>({profile_id:P,profile_name:'目标档案',issuer_device_id:B,fingerprint_sha256:'a'.repeat(64),expires_at_ms:Date.now()+20_000,compatible:true,endpoints:[]})),
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
  it('edits the device-global environment alias and reports the saved source',async()=>{
    const client=peers();
    render(<BetaPeersPage {...props} profileId="" profileName="" peers={client} onJoined={vi.fn(async()=>{})}/>);
    expect(await screen.findByTestId('beta-environment-alias')).toHaveTextContent('Studio PC');
    expect(screen.getByText(/来源：系统默认名称/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'编辑名称'}));
    const input=screen.getByLabelText('本机外心实例名');
    fireEvent.change(input,{target:{value:'Travel Room PC'}});
    fireEvent.click(screen.getByRole('button',{name:'保存名称'}));
    await waitFor(()=>expect(client.setEnvironmentAlias).toHaveBeenCalledWith('Travel Room PC'));
    expect(await screen.findByText('本机外心实例名已保存。')).toBeInTheDocument();
    expect(screen.getByTestId('beta-environment-alias')).toHaveTextContent('Travel Room PC');
    expect(screen.getByText(/来源：自定义名称/)).toBeInTheDocument();
  });
  it('keeps a failed alias save actionable and retries the same draft',async()=>{
    const client=peers(),copyText=vi.fn(async()=>{});
    client.setEnvironmentAlias.mockRejectedValueOnce(new BetaApiError('alias_unavailable','save failed'));
    render(<BetaPeersPage {...props} peers={client} onJoined={vi.fn(async()=>{})} copyText={copyText}/>);
    await screen.findByTestId('beta-environment-alias');
    fireEvent.click(screen.getByRole('button',{name:'编辑名称'}));
    fireEvent.change(screen.getByLabelText('本机外心实例名'),{target:{value:'Retry PC'}});
    fireEvent.click(screen.getByRole('button',{name:'保存名称'}));
    expect(await screen.findByText(/实例名操作失败：save failed/)).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'复制名称诊断'})).toBeEnabled();
    fireEvent.click(screen.getByRole('button',{name:'复制名称诊断'}));
    await waitFor(()=>expect(copyText).toHaveBeenCalledWith(expect.stringContaining('code: alias_unavailable')));
    fireEvent.click(screen.getByRole('button',{name:'重试保存'}));
    await waitFor(()=>expect(client.setEnvironmentAlias).toHaveBeenCalledTimes(2));
    expect(client.setEnvironmentAlias).toHaveBeenLastCalledWith('Retry PC');
    expect(await screen.findByText('本机外心实例名已保存。')).toBeInTheDocument();
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
      device_id:B,fingerprint_sha256:'a'.repeat(64),effective_alias:'Tablet signed name',alias_source:'custom',alias_verification:'signed',alias_confirmed_at_ms:null,
      addresses:[address],expires_at_ms:Date.now()+20_000,verification_state:'unverified',
    }]);
    client.joinInvitation.mockResolvedValueOnce({profile_id:P,peer_device_id:B,state:'ready'});
    const joined=vi.fn(async()=>{});
    render(<BetaPeersPage {...props} peers={client} onJoined={joined}/>);

    expect(await screen.findByText('潜在设备')).toBeInTheDocument();
    expect(screen.getByText(/名称签名有效，但尚未完整同步确认/)).toBeInTheDocument();
    expect(screen.getByText(/广播地址仍未验证/)).toBeInTheDocument();
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
      device_id:B,fingerprint_sha256:'a'.repeat(64),effective_alias:'外心 44444444',alias_source:'stable_id',alias_verification:'none',alias_confirmed_at_ms:null,
      addresses:[address],expires_at_ms:Date.now()+20_000,verification_state:'unverified',
    }]);
    client.inspectInvitation.mockResolvedValueOnce({
      profile_id:P,profile_name:'目标档案',issuer_device_id:otherIssuer,
      fingerprint_sha256:'a'.repeat(64),expires_at_ms:Date.now()+20_000,compatible:true,endpoints:[],
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

describe('Invitation preview connectivity and membership labels',()=>{
  it('separates structural validity from a reachable TLS identity and never labels it as connection success',async()=>{
    const client=peers();
    client.inspectInvitation.mockResolvedValueOnce({
      profile_id:P,profile_name:'目标档案',issuer_device_id:B,fingerprint_sha256:'a'.repeat(64),expires_at_ms:Date.now()+20_000,compatible:true,
      endpoints:[{endpoint:'10.0.0.2:43344',disposition:'reachable',elapsed_ms:12,error_code:null}],
    });
    render(<BetaPeersPage {...props} peers={client} onJoined={vi.fn(async()=>{})}/>);
    fireEvent.change(screen.getByLabelText('另一设备的完整邀请'),{target:{value:'opaque-secret'}});
    fireEvent.click(screen.getByRole('button',{name:'检查邀请'}));
    expect(await screen.findByText('邀请格式与签名有效。')).toBeInTheDocument();
    expect(screen.getByText('协议/schema 兼容，可继续检查来源。')).toBeInTheDocument();
    expect(screen.getByText(/10\.0\.0\.2:43344 · 安全身份可达，尚未加入/)).toBeInTheDocument();
    expect(screen.queryByText('连接成功')).not.toBeInTheDocument();
  });
  it('keeps manual address retry and a copy diagnostic path when every endpoint is unreachable',async()=>{
    const client=peers();const copyText=vi.fn(async()=>{});
    client.inspectInvitation.mockResolvedValueOnce({
      profile_id:P,profile_name:'目标档案',issuer_device_id:B,fingerprint_sha256:'a'.repeat(64),expires_at_ms:Date.now()+20_000,compatible:true,
      endpoints:[
        {endpoint:'10.0.0.2:43344',disposition:'unreachable',elapsed_ms:2000,error_code:'timeout'},
        {endpoint:'127.0.0.1:43344',disposition:'skipped',elapsed_ms:0,error_code:'loopback_not_shareable'},
      ],
    });
    render(<BetaPeersPage {...props} peers={client} onJoined={vi.fn(async()=>{})} copyText={copyText}/>);
    fireEvent.change(screen.getByLabelText('另一设备的完整邀请'),{target:{value:'opaque-secret'}});
    fireEvent.click(screen.getByRole('button',{name:'检查邀请'}));
    expect(await screen.findByText(/10\.0\.0\.2:43344 · 地址不可达（timeout）/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('所有可尝试的连接来源均不可达');
    expect(screen.getByRole('list',{name:'连接来源检查结果'})).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'更换连接地址'})).toBeEnabled();
    fireEvent.click(screen.getByRole('button',{name:'复制连接诊断'}));
    expect(await screen.findByText('连接诊断已复制')).toBeInTheDocument();
    expect(copyText).toHaveBeenCalledOnce();
    expect(copyText.mock.calls[0][0]).toContain('10.0.0.2:43344 地址不可达（timeout）');
    expect(copyText.mock.calls[0][0]).not.toContain('opaque-secret');
  });
  it('distinguishes membership acceptance from later data sync confirmation',async()=>{
    const client=peers();const joined=vi.fn(async()=>{});
    client.inspectInvitation.mockResolvedValueOnce({
      profile_id:P,profile_name:'目标档案',issuer_device_id:B,fingerprint_sha256:'a'.repeat(64),expires_at_ms:Date.now()+20_000,compatible:true,
      endpoints:[{endpoint:'10.0.0.2:43344',disposition:'reachable',elapsed_ms:1,error_code:null}],
    });
    client.joinInvitation.mockResolvedValueOnce({profile_id:P,peer_device_id:B,state:'pending'});
    render(<BetaPeersPage {...props} peers={client} onJoined={joined}/>);
    fireEvent.change(screen.getByLabelText('另一设备的完整邀请'),{target:{value:'opaque-secret'}});
    fireEvent.click(screen.getByRole('button',{name:'检查邀请'}));
    await screen.findByText('加入「目标档案」');
    fireEvent.click(screen.getByRole('button',{name:'确认加入档案'}));
    expect(await screen.findByText(/成员资格尚未确认；加入尚待确认/)).toBeInTheDocument();
    expect(joined).not.toHaveBeenCalled();
    client.joinInvitation.mockResolvedValue({profile_id:P,peer_device_id:B,state:'ready'});
    fireEvent.click(screen.getByRole('button',{name:'继续查证加入'}));
    await waitFor(()=>expect(joined).toHaveBeenCalledWith(P));
    expect(await screen.findByText('成员资格已确认，正在打开…')).toBeInTheDocument();
  });
  it('shows data sync confirmation only on the authorized-device card',async()=>{
    const client=peers();
    client.status.mockResolvedValue({
      runtime_id:R,device_id:D,profile_id:Q,network_enabled:true,local_addresses:[],
      peers:[{device_id:B,fingerprint_sha256:'a'.repeat(64),effective_alias:'Tablet',alias_source:'custom',alias_verification:'confirmed',alias_confirmed_at_ms:900,member_generation:2,member_state:'ready',connection_state:'idle',endpoints:['10.0.0.2:43344'],last_sync_at_ms:1000,last_error_code:null,event_sync:'complete',originals_sync:'complete'}],
    });
    render(<BetaPeersPage {...props} peers={client} onJoined={vi.fn(async()=>{})}/>);
    expect(await screen.findByText('记录与原件已补齐')).toBeInTheDocument();
    expect(screen.getAllByText(/名称与设备身份已通过完整同步确认/).length).toBeGreaterThan(0);
    expect(screen.queryByText('连接成功')).not.toBeInTheDocument();
  });
  it('shows accepted membership and data-sync confirmation independently of a still-connecting link',async()=>{
    const client=peers();
    client.status.mockResolvedValue({
      runtime_id:R,device_id:D,profile_id:Q,network_enabled:true,local_addresses:[],
      peers:[{device_id:B,fingerprint_sha256:'a'.repeat(64),effective_alias:'Tablet',alias_source:'custom',alias_verification:'signed',alias_confirmed_at_ms:null,member_generation:2,member_state:'ready',connection_state:'connecting',endpoints:['10.0.0.2:43344'],last_sync_at_ms:1000,last_error_code:null,event_sync:'complete',originals_sync:'complete'}],
    });
    render(<BetaPeersPage {...props} peers={client} onJoined={vi.fn(async()=>{})}/>);
    expect(await screen.findByText('成员资格已接受')).toBeInTheDocument();
    expect(screen.getByText('名称签名有效，尚未通过下一次完整同步确认')).toBeInTheDocument();
    expect(screen.getByText('正在连接')).toBeInTheDocument();
    expect(screen.getByText(/上次数据同步确认/)).toBeInTheDocument();
  });
  it('keeps local structure validity separate from protocol compatibility',async()=>{
    const client=peers();
    client.inspectInvitation.mockResolvedValueOnce({
      profile_id:P,profile_name:'目标档案',issuer_device_id:B,fingerprint_sha256:'a'.repeat(64),expires_at_ms:Date.now()+20_000,compatible:false,
      endpoints:[{endpoint:'10.0.0.2:43344',disposition:'reachable',elapsed_ms:1,error_code:null}],
    });
    render(<BetaPeersPage {...props} peers={client} onJoined={vi.fn(async()=>{})}/>);
    fireEvent.change(screen.getByLabelText('另一设备的完整邀请'),{target:{value:'opaque-secret'}});
    fireEvent.click(screen.getByRole('button',{name:'检查邀请'}));
    expect(await screen.findByText('邀请格式与签名有效。')).toBeInTheDocument();
    expect(screen.getByText('协议/schema 不兼容，不能加入此档案。')).toBeInTheDocument();
    expect(screen.queryByText(/结构或版本不兼容/)).not.toBeInTheDocument();
    expect(screen.getByRole('button',{name:'确认加入档案'})).toBeDisabled();
  });
  it('marks an expired but structurally valid invitation and blocks a misleading join',async()=>{
    const client=peers();
    client.inspectInvitation.mockResolvedValueOnce({
      profile_id:P,profile_name:'目标档案',issuer_device_id:B,fingerprint_sha256:'a'.repeat(64),expires_at_ms:Date.now()-1,compatible:true,endpoints:[],
    });
    render(<BetaPeersPage {...props} peers={client} onJoined={vi.fn(async()=>{})}/>);
    fireEvent.change(screen.getByLabelText('另一设备的完整邀请'),{target:{value:'opaque-secret'}});
    fireEvent.click(screen.getByRole('button',{name:'检查邀请'}));
    expect(await screen.findByText('邀请结构有效，但已过期。')).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'确认加入档案'})).toBeDisabled();
  });
  it('renders endpoint reports from a failed join and keeps the manual retry path',async()=>{
    const client=peers();
    client.joinInvitation.mockRejectedValueOnce(new BetaPeerJoinError('unreachable','加入尝试未建立连接',[
      {endpoint:'10.0.0.9:43344',disposition:'unreachable',elapsed_ms:2000,error_code:'timeout'},
    ]));
    render(<BetaPeersPage {...props} peers={client} onJoined={vi.fn(async()=>{})}/>);
    fireEvent.change(screen.getByLabelText('另一设备的完整邀请'),{target:{value:'opaque-secret'}});
    fireEvent.click(screen.getByRole('button',{name:'检查邀请'}));
    await screen.findByText('加入「目标档案」');
    fireEvent.click(screen.getByRole('button',{name:'确认加入档案'}));
    expect(await screen.findByText('加入尝试未建立连接')).toBeInTheDocument();
    expect(screen.getByRole('list',{name:'上次加入尝试的连接来源'})).toHaveTextContent('10.0.0.9:43344 · 地址不可达（timeout）');
    expect(screen.getByRole('button',{name:'更换连接地址'})).toBeEnabled();
    expect(screen.getByRole('button',{name:'复制连接诊断'})).toBeEnabled();
  });
  it('ignores a late failed inspection after the invitation changes',async()=>{
    const client=peers();const pending=deferred<BetaInvitationPreview>();
    client.inspectInvitation.mockReturnValueOnce(pending.promise);
    render(<BetaPeersPage {...props} peers={client} onJoined={vi.fn(async()=>{})}/>);
    const input=screen.getByLabelText('另一设备的完整邀请');
    fireEvent.change(input,{target:{value:'old-invitation'}});
    fireEvent.click(screen.getByRole('button',{name:'检查邀请'}));
    await waitFor(()=>expect(client.inspectInvitation).toHaveBeenCalledOnce());
    fireEvent.change(input,{target:{value:'new-invitation'}});
    await act(async()=>{pending.reject(new Error('旧邀请检查失败'));await Promise.resolve();});
    await waitFor(()=>expect(screen.getByRole('button',{name:'检查邀请'})).toBeEnabled());
    expect(screen.queryByText('旧邀请检查失败')).not.toBeInTheDocument();
  });
  it('ignores a late failed join after the invitation changes',async()=>{
    const client=peers();const pending=deferred<BetaJoinResult>();
    client.joinInvitation.mockReturnValueOnce(pending.promise);
    render(<BetaPeersPage {...props} peers={client} onJoined={vi.fn(async()=>{})}/>);
    const input=screen.getByLabelText('另一设备的完整邀请');
    fireEvent.change(input,{target:{value:'old-invitation'}});
    fireEvent.click(screen.getByRole('button',{name:'检查邀请'}));
    await screen.findByText('加入「目标档案」');
    fireEvent.click(screen.getByRole('button',{name:'确认加入档案'}));
    await waitFor(()=>expect(client.joinInvitation).toHaveBeenCalledOnce());
    fireEvent.change(input,{target:{value:'new-invitation'}});
    await act(async()=>{pending.reject(new Error('旧加入尝试失败'));await Promise.resolve();});
    expect(screen.queryByText('旧加入尝试失败')).not.toBeInTheDocument();
    expect(input).toHaveValue('new-invitation');
  });
});

describe('Nearby network scan',()=>{
  const completed=(overrides:Record<string,unknown>={}):BetaNetworkScan=>({scan_id:B,started_at_ms:1000,finished_at_ms:2000,stage:'complete',scopes:[],attempted:10,discovered:2,skipped:1,cancelled:false,discovered_addresses:['192.168.1.7:43344'],...overrides});
  it('offers a real scan action and never leaves an empty nearby list terminal',async()=>{
    const client=peers();
    client.status.mockResolvedValue({...status(Q),network_enabled:true});
    client.scanNearby.mockResolvedValue(completed());
    render(<BetaPeersPage {...props} peers={client} onJoined={vi.fn(async()=>{})}/>);
    expect(await screen.findByText('暂未发现附近设备')).toBeInTheDocument();
    const scanButton=screen.getByRole('button',{name:'扫描当前内网'});
    await waitFor(()=>expect(scanButton).toBeEnabled());
    fireEvent.click(scanButton);
    expect(client.scanNearby).toHaveBeenCalledWith(expect.objectContaining({scopeIds:expect.any(Array)}));
    expect(await screen.findByText(/扫描结束/)).toBeInTheDocument();
    expect(screen.getByLabelText('未验证地址候选')).toHaveTextContent('开放端口，未验证身份');
  });
  it('exposes progress and a cancel action while scanning',async()=>{
    const client=peers();
    client.status.mockResolvedValue({...status(Q),network_enabled:true});
    const pending=deferred<BetaNetworkScan>();
    client.scanNearby.mockResolvedValue({scan_id:B,started_at_ms:1000,finished_at_ms:0,stage:'tcp_probe',scopes:[],attempted:3,discovered:0,skipped:2,cancelled:false,discovered_addresses:[]});
    client.scanStatus.mockReturnValueOnce(pending.promise);
    render(<BetaPeersPage {...props} peers={client} onJoined={vi.fn(async()=>{})}/>);
    const scanButton=screen.getByRole('button',{name:'扫描当前内网'});
    await waitFor(()=>expect(scanButton).toBeEnabled());
    fireEvent.click(scanButton);
    expect(await screen.findByText(/正在扫描 · 已尝试 3 · 已跳过 2/)).toBeInTheDocument();
    expect(screen.queryByText(/已发现 0/)).not.toBeInTheDocument();
    expect(screen.getByText(/开放端口将在扫描结束后汇总确认/)).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'取消扫描'})).toBeEnabled();
    await act(async()=>{pending.resolve(completed({discovered_addresses:[],discovered:0}));await pending.promise;});
    await waitFor(()=>expect(screen.getByText(/扫描结束/)).toBeInTheDocument());
  });
  it('failure offers retry, scope change, manual CIDR, EasyTier guidance and copy diagnostic',async()=>{
    const client=peers();const copyText=vi.fn(async()=>{});
    client.status.mockResolvedValue({...status(Q),network_enabled:true});
    client.scanNearby.mockRejectedValueOnce(new Error('扫描失败'));
    render(<BetaPeersPage {...props} peers={client} onJoined={vi.fn(async()=>{})} copyText={copyText}/>);
    const scanButton=screen.getByRole('button',{name:'扫描当前内网'});
    await waitFor(()=>expect(scanButton).toBeEnabled());
    fireEvent.click(scanButton);
    expect(await screen.findByRole('alert')).toHaveTextContent('扫描失败');
    expect(screen.getByText(/EasyTier 的 10\.137\.0\.0\/24/)).toBeInTheDocument();
    expect(screen.getByLabelText('手动扫描范围')).toBeEnabled();
    expect(screen.getByRole('button',{name:'扫描当前内网'})).toBeEnabled();
    fireEvent.click(screen.getByRole('button',{name:'复制扫描诊断'}));
    expect(await screen.findByText('附近扫描诊断已复制')).toBeInTheDocument();
    expect(copyText).toHaveBeenCalledOnce();
    expect(copyText.mock.calls[0][0]).toContain('扫描失败');
    expect(copyText.mock.calls[0][0]).not.toContain('eth0');
    expect(copyText.mock.calls[0][0]).not.toContain('192.168.1.0/24');
  });
  it('reports clipboard failure truthfully and keeps the copy action retryable',async()=>{
    const client=peers();const copyText=vi.fn(async()=>{throw new Error('clipboard denied');});
    client.status.mockResolvedValue({...status(Q),network_enabled:true});
    client.scanNearby.mockResolvedValue(completed());
    render(<BetaPeersPage {...props} peers={client} onJoined={vi.fn(async()=>{})} copyText={copyText}/>);
    const scanButton=screen.getByRole('button',{name:'扫描当前内网'});
    await waitFor(()=>expect(scanButton).toBeEnabled());
    fireEvent.click(scanButton);
    await screen.findByText(/扫描结束/);
    const copyButton=screen.getByRole('button',{name:'复制扫描诊断'});
    fireEvent.click(copyButton);
    expect(await screen.findByText(/扫描诊断复制失败/)).toBeInTheDocument();
    expect(copyButton).toBeEnabled();
    copyText.mockResolvedValueOnce(undefined);
    fireEvent.click(copyButton);
    expect(await screen.findByText('附近扫描诊断已复制')).toBeInTheDocument();
  });
  it('lets a no-profile state scan without inventing a profile',async()=>{
    const client=peers();
    client.scanNearby.mockResolvedValue(completed({discovered_addresses:[],discovered:0}));
    render(<BetaPeersPage {...props} profileId="" profileName="" peers={client} onJoined={vi.fn(async()=>{})}/>);
    const scanButton=screen.getByRole('button',{name:'扫描当前内网'});
    await waitFor(()=>expect(scanButton).toBeEnabled());
    fireEvent.click(scanButton);
    expect(client.scanNearby).toHaveBeenCalled();
    expect(client.status).not.toHaveBeenCalled();
    expect(await screen.findByText(/扫描结束/)).toBeInTheDocument();
  });
  it('does not silently enable the network for a no-profile scan and shows the prerequisite',async()=>{
    const client=peers();
    client.networkEnabled.mockResolvedValue(false);
    render(<BetaPeersPage {...props} profileId="" profileName="" peers={client} onJoined={vi.fn(async()=>{})}/>);
    const scanButton=screen.getByRole('button',{name:'扫描当前内网'});
    await screen.findByText(/请先开启设备同步后再扫描附近设备/);
    expect(scanButton).toBeDisabled();
    expect(client.setEnabled).not.toHaveBeenCalled();
    expect(client.scanNearby).not.toHaveBeenCalled();
  });
  it('unlocks a no-profile scan immediately after explicitly enabling the network',async()=>{
    const client=peers();
    client.networkEnabled.mockResolvedValueOnce(false).mockResolvedValue(true);
    client.scanNearby.mockResolvedValue(completed({discovered_addresses:[],discovered:0}));
    render(<BetaPeersPage {...props} profileId="" profileName="" peers={client} onJoined={vi.fn(async()=>{})}/>);
    const scanButton=screen.getByRole('button',{name:'扫描当前内网'});
    await screen.findByText(/请先开启设备同步后再扫描附近设备/);
    expect(scanButton).toBeDisabled();
    fireEvent.click(screen.getByRole('button',{name:'开启设备同步与发现'}));
    await waitFor(()=>expect(client.setEnabled).toHaveBeenCalledWith(true));
    await waitFor(()=>expect(scanButton).toBeEnabled());
    fireEvent.click(scanButton);
    expect(client.scanNearby).toHaveBeenCalledWith(expect.objectContaining({scopeIds:expect.any(Array)}));
    expect(await screen.findByText(/扫描结束/)).toBeInTheDocument();
  });
  it('shows a persistent no-profile enabled state and disables the redundant action',async()=>{
    const client=peers();
    render(<BetaPeersPage {...props} profileId="" profileName="" peers={client} onJoined={vi.fn(async()=>{})}/>);
    expect(await screen.findByText('设备同步已开启；附近发现可用，扫描不会授权任何档案。')).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'开启设备同步与发现'})).toBeDisabled();
    expect(screen.getByRole('button',{name:'关闭设备同步与发现'})).toBeEnabled();
  });
  it('surfaces a network state read failure with retry and a redacted diagnostic',async()=>{
    const client=peers();const copyText=vi.fn(async()=>{});
    client.networkEnabled.mockRejectedValueOnce(new Error('读取失败')).mockResolvedValue(true);
    render(<BetaPeersPage {...props} profileId="" profileName="" peers={client} onJoined={vi.fn(async()=>{})} copyText={copyText}/>);
    expect(await screen.findByText(/设备同步状态读取失败/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'复制扫描诊断'}));
    expect(await screen.findByText('附近扫描诊断已复制')).toBeInTheDocument();
    expect(copyText.mock.calls[0][0]).toContain('设备同步状态：读取失败');
    fireEvent.click(screen.getByRole('button',{name:'重新读取状态'}));
    await waitFor(()=>expect(screen.getByRole('button',{name:'扫描当前内网'})).toBeEnabled());
  });
  it('keeps the last known network truth and warns when a later read fails',async()=>{
    const client=peers();
    client.networkEnabled.mockResolvedValueOnce(true).mockRejectedValue(new Error('读取失败'));
    const view=render(<BetaPeersPage {...props} profileId="" profileName="" visible={false} peers={client} onJoined={vi.fn(async()=>{})}/>);
    vi.useFakeTimers();
    try{
      view.rerender(<BetaPeersPage {...props} profileId="" profileName="" visible peers={client} onJoined={vi.fn(async()=>{})}/>);
      await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
      const scanButton=screen.getByRole('button',{name:'扫描当前内网'});
      expect(scanButton).toBeEnabled();
      await act(async()=>{await vi.advanceTimersByTimeAsync(2100);});
      expect(client.networkEnabled.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(scanButton).toBeEnabled();
      expect(screen.getByText(/设备同步状态读取失败；以下保留上次确认值：已开启/)).toBeInTheDocument();
    }finally{view.unmount();vi.useRealTimers();}
  });
  it('reports omitted open-port candidates when the list hits the display cap',async()=>{
    const client=peers();
    client.status.mockResolvedValue({...status(Q),network_enabled:true});
    const addresses=Array.from({length:64},(_,index)=>`192.168.1.${index+1}:43344`);
    client.scanNearby.mockResolvedValue(completed({attempted:70,discovered:70,discovered_addresses:addresses}));
    render(<BetaPeersPage {...props} peers={client} onJoined={vi.fn(async()=>{})}/>);
    const scanButton=screen.getByRole('button',{name:'扫描当前内网'});
    await waitFor(()=>expect(scanButton).toBeEnabled());
    fireEvent.click(scanButton);
    expect(await screen.findByText(/另有 6 个开放端口未展示/)).toBeInTheDocument();
  });
  it('auto-retries a transient scan status failure and recovers',async()=>{
    const client=peers();
    client.status.mockResolvedValue({...status(Q),network_enabled:true});
    client.scanNearby.mockResolvedValue({scan_id:B,started_at_ms:1000,finished_at_ms:0,stage:'tcp_probe',scopes:[],attempted:0,discovered:0,skipped:0,cancelled:false,discovered_addresses:[]});
    client.scanStatus.mockRejectedValueOnce(new Error('读取失败')).mockResolvedValue(completed({discovered_addresses:[],discovered:0}));
    render(<BetaPeersPage {...props} peers={client} onJoined={vi.fn(async()=>{})}/>);
    const scanButton=screen.getByRole('button',{name:'扫描当前内网'});
    await waitFor(()=>expect(scanButton).toBeEnabled());
    fireEvent.click(scanButton);
    expect(await screen.findByText(/后台扫描仍可能运行/)).toBeInTheDocument();
    expect(await screen.findByText(/扫描结束/,undefined,{timeout:3000})).toBeInTheDocument();
  });
  it('keeps a background scan actionable after persistent status failures',async()=>{
    const client=peers();
    client.status.mockResolvedValue({...status(Q),network_enabled:true});
    client.scanNearby.mockResolvedValue({scan_id:B,started_at_ms:1000,finished_at_ms:0,stage:'tcp_probe',scopes:[],attempted:0,discovered:0,skipped:0,cancelled:false,discovered_addresses:[]});
    client.scanStatus.mockRejectedValue(new Error('读取失败'));
    render(<BetaPeersPage {...props} peers={client} onJoined={vi.fn(async()=>{})}/>);
    const scanButton=screen.getByRole('button',{name:'扫描当前内网'});
    await waitFor(()=>expect(scanButton).toBeEnabled());
    fireEvent.click(scanButton);
    expect(await screen.findByText(/扫描进度读取持续失败/,undefined,{timeout:5000})).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'继续读取'})).toBeEnabled();
    expect(screen.getByRole('button',{name:'取消扫描'})).toBeEnabled();
    expect(screen.getByRole('button',{name:'复制扫描诊断'})).toBeEnabled();
    const callsBefore=client.scanStatus.mock.calls.length;
    fireEvent.click(screen.getByRole('button',{name:'继续读取'}));
    await waitFor(()=>expect(client.scanStatus.mock.calls.length).toBeGreaterThan(callsBefore));
  });
  it('reports a no-host scope with skipped count instead of a generic no-port message',async()=>{
    const client=peers();
    client.status.mockResolvedValue({...status(Q),network_enabled:true});
    client.scanNearby.mockResolvedValue(completed({attempted:0,discovered:0,skipped:7,discovered_addresses:[]}));
    render(<BetaPeersPage {...props} peers={client} onJoined={vi.fn(async()=>{})}/>);
    const scanButton=screen.getByRole('button',{name:'扫描当前内网'});
    await waitFor(()=>expect(scanButton).toBeEnabled());
    fireEvent.click(scanButton);
    expect(await screen.findByText(/所选范围没有可探测的其他主机（已跳过 7）/)).toBeInTheDocument();
    expect(screen.queryByText(/没有发现开放端口/)).not.toBeInTheDocument();
  });
  it('ignores a late previous scan result after the profile scope changes',async()=>{
    const client=peers();
    client.status.mockResolvedValue({...status(Q),network_enabled:true});
    const pending=deferred<BetaNetworkScan>();
    client.scanNearby.mockReturnValueOnce(pending.promise);
    const view=render(<BetaPeersPage {...props} profileId={P} profileName="P" peers={client} onJoined={vi.fn(async()=>{})}/>);
    const scanButton=screen.getByRole('button',{name:'扫描当前内网'});
    await waitFor(()=>expect(scanButton).toBeEnabled());
    fireEvent.click(scanButton);
    await waitFor(()=>expect(client.scanNearby).toHaveBeenCalledOnce());
    view.rerender(<BetaPeersPage {...props} peers={client} onJoined={vi.fn(async()=>{})}/>);
    await act(async()=>{pending.resolve(completed());await pending.promise;});
    expect(screen.queryByText(/扫描结束/)).not.toBeInTheDocument();
  });
});
