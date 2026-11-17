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
  status:vi.fn(async(profile:string)=>status(profile)),setEnabled:vi.fn(async()=>{}),
  createInvitation:vi.fn(async()=>({invitation_text:'opaque-secret',invitation_id:B,expires_at_ms:2000,local_addresses:[]})),
  inspectInvitation:vi.fn(async()=>({profile_id:P,profile_name:'目标档案',issuer_device_id:B,fingerprint_sha256:'a'.repeat(64),expires_at_ms:2000,compatible:true})),
  joinInvitation:vi.fn<BetaPeersClient['joinInvitation']>(async()=>({profile_id:P,peer_device_id:B,state:'pending'})),
  sync:vi.fn(async()=>{}),revoke:vi.fn(async()=>{}),
} satisfies BetaPeersClient;}
const props={profileId:Q,profileName:'原档案Q',runtimeId:R,deviceId:D};

describe('Beta device joining UI',()=>{
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
});
