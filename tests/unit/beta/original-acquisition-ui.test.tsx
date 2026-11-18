import { act,cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { afterEach,describe,expect,it,vi } from 'vitest';
import { OriginalDownloads } from '@/beta/OriginalDownloads';
import type { BetaOriginalAcquisitionClient,BetaOriginalFetchResult,BetaOriginalTransferStatus } from '@/beta/original-acquisition';
import { deferred,fakeClient } from './fixtures';

const P='11111111-1111-4111-8111-111111111111',Q='55555555-5555-4555-8555-555555555555',O='22222222-2222-4222-8222-222222222222',D='33333333-3333-4333-8333-333333333333',R='44444444-4444-4444-8444-444444444444';
const original={original_id:O,sha256:'a'.repeat(64),byte_length:100,file_name:'fixture.raw',media_type:'application/octet-stream'};
function fixture(){
  const pending=deferred<BetaOriginalFetchResult>();
  let snapshot:BetaOriginalTransferStatus={profile_id:P,original_id:O,original,availability:'missing',next_offset:0,byte_length:100,request_id:null,peer_device_id:null,transfer_state:'idle',last_error_code:null};
  const status=vi.fn(async(profile:string)=>({...snapshot,profile_id:profile}));
  const sources=vi.fn(async()=>({network_enabled:true,devices:[D]}));
  const fetch=vi.fn((_profile:string,_original:string,_peer:string,_request:string)=>pending.promise);
  const cancel=vi.fn(async(_profile:string,_original:string,_request:string)=>true);
  const acquisition:BetaOriginalAcquisitionClient={status,sources,fetch,cancel};
  const save=vi.fn(async()=>({cancelled:false as const,byte_length:100,sha256:original.sha256}));
  const client={...fakeClient(),originalAcquisition:acquisition,originalExports:{save,cancel:async()=>true}};
  return{client,status,sources,fetch,cancel,save,pending,setSnapshot:(next:Partial<BetaOriginalTransferStatus>)=>{snapshot={...snapshot,...next};}};
}
afterEach(()=>{cleanup();vi.restoreAllMocks();});
describe('Original cards acquire real bytes before export',()=>{
  it('B14-A04: a completed background transfer refreshes only its observed original, and leaving stops observation',async()=>{
    const f=fixture();let changed=()=>{};const stop=vi.fn();
    const observe=vi.fn(async(_profile:string,_original:string,notify:()=>void)=>{changed=notify;return stop;});
    const client={...f.client,originalAcquisition:{...f.client.originalAcquisition,observe}};
    const ui=render(<OriginalDownloads client={client} profileId={P} originals={[original]}/>);await screen.findByText('本机缺少原件，仅有记录信息');
    f.setSnapshot({availability:'complete',next_offset:100});await act(async()=>{changed();});await screen.findByText('本机原件已完整校验');
    expect(f.fetch).not.toHaveBeenCalled();ui.unmount();expect(stop).toHaveBeenCalledTimes(1);const reads=f.status.mock.calls.length;changed();expect(f.status).toHaveBeenCalledTimes(reads);
  });
  it('B14-A04: one click searches authorized sources without requiring a source picker',async()=>{
    const f=fixture(),fetchAny=vi.fn(async(_profile:string,_original:string,_request:string,onAttempt:(value:{index:number;total:number;deviceId:string})=>void)=>{onAttempt({index:1,total:2,deviceId:D});return f.pending.promise;});
    const client={...f.client,originalAcquisition:{...f.client.originalAcquisition,fetchAny}};
    render(<OriginalDownloads client={client} profileId={P} originals={[original]}/>);await screen.findByText('本机缺少原件，仅有记录信息');
    fireEvent.click(screen.getByRole('button',{name:'获取原件'}));await waitFor(()=>expect(fetchAny).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('combobox',{name:'原件来源 fixture.raw'})).not.toBeInTheDocument();expect(f.fetch).not.toHaveBeenCalled();
    f.setSnapshot({availability:'complete',next_offset:100});await act(async()=>{f.pending.resolve({original,verified:true,resumed_from:0,transferred_bytes:100});});await screen.findByText('已获取并校验原件');
  });
  it('rechecks a changed descriptor instead of leaving the replacement row in initial loading',async()=>{
    const f=fixture();const ui=render(<OriginalDownloads client={f.client} profileId={P} originals={[original]}/>);
    await screen.findByText('本机缺少原件，仅有记录信息');
    const changed={...original,file_name:'replacement.raw'};f.setSnapshot({original:changed});
    ui.rerender(<OriginalDownloads client={f.client} profileId={P} originals={[changed]}/>);
    await waitFor(()=>expect(f.status).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('本机缺少原件，仅有记录信息')).toBeVisible();
    expect(screen.getByRole('button',{name:'下载 replacement.raw'})).toBeDisabled();expect(f.fetch).not.toHaveBeenCalled();
  });
  it('shows missing metadata honestly, polls bounded progress and cancels the exact acquisition UUID',async()=>{
    const f=fixture();render(<OriginalDownloads client={f.client} profileId={P} originals={[original]}/>);
    await screen.findByText('本机缺少原件，仅有记录信息');const download=screen.getByRole('button',{name:'下载 fixture.raw'});expect(download).toBeDisabled();
    fireEvent.click(screen.getByRole('button',{name:'获取原件'}));await screen.findByRole('combobox',{name:'原件来源 fixture.raw'});
    expect(f.fetch).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'开始获取'}));
    await screen.findByText('正在获取原件…');const request=f.fetch.mock.calls[0][3];
    expect(f.fetch).toHaveBeenCalledWith(P,O,D,request);
    f.setSnapshot({availability:'partial',next_offset:40,request_id:request,peer_device_id:D,transfer_state:'receiving'});
    await waitFor(()=>expect(screen.getByRole('progressbar',{name:'原件获取进度 fixture.raw'})).toHaveAttribute('aria-valuenow','40'));
    fireEvent.click(screen.getByRole('button',{name:'取消获取'}));await waitFor(()=>expect(f.cancel).toHaveBeenCalledWith(P,O,request));
    f.setSnapshot({transfer_state:'cancelled',last_error_code:'cancelled'});await act(async()=>{f.pending.reject({code:'cancelled'});});
    await screen.findByText('获取已取消，已收到的部分会保留');expect(download).toBeDisabled();expect(f.save).not.toHaveBeenCalled();
  });
  it('does not treat a verified fetch reply or 100% received bytes as local completion until status confirms it',async()=>{
    const f=fixture();render(<OriginalDownloads client={f.client} profileId={P} originals={[original]}/>);
    await screen.findByText('本机缺少原件，仅有记录信息');fireEvent.click(screen.getByRole('button',{name:'获取原件'}));await screen.findByRole('button',{name:'开始获取'});fireEvent.click(screen.getByRole('button',{name:'开始获取'}));
    f.setSnapshot({availability:'partial',next_offset:100,request_id:R,peer_device_id:D,transfer_state:'idle'});
    await act(async()=>{f.pending.resolve({original,verified:true,resumed_from:0,transferred_bytes:100});});
    await screen.findByText('本次获取已结束，原件仍未完成；已收到的部分会保留');expect(screen.queryByText('已获取并校验原件')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'下载 fixture.raw'})).toBeDisabled();
    f.setSnapshot({availability:'complete'});fireEvent.click(screen.getByRole('button',{name:'检查原件 fixture.raw'}));
    await screen.findByText('本机原件已完整校验');expect(screen.getByRole('button',{name:'下载 fixture.raw'})).toBeEnabled();
  });
  it('rejects stale completions after profile replacement without cancelling another profile in the background',async()=>{
    const f=fixture();const ui=render(<OriginalDownloads client={f.client} profileId={P} originals={[original]}/>);
    await screen.findByText('本机缺少原件，仅有记录信息');fireEvent.click(screen.getByRole('button',{name:'获取原件'}));await screen.findByRole('button',{name:'开始获取'});fireEvent.click(screen.getByRole('button',{name:'开始获取'}));
    await waitFor(()=>expect(f.fetch).toHaveBeenCalledTimes(1));ui.rerender(<OriginalDownloads client={f.client} profileId={Q} originals={[original]}/>);
    await screen.findByText('本机缺少原件，仅有记录信息');await act(async()=>{f.pending.resolve({original,verified:true,resumed_from:0,transferred_bytes:100});});
    expect(screen.queryByText('已获取并校验原件')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'下载 fixture.raw'})).toBeDisabled();expect(f.cancel).not.toHaveBeenCalled();
  });
  it('does not fabricate an authorized source when none is ready',async()=>{
    const f=fixture();f.sources.mockResolvedValue({network_enabled:true,devices:[]});render(<OriginalDownloads client={f.client} profileId={P} originals={[original]}/>);
    await screen.findByText('本机缺少原件，仅有记录信息');fireEvent.click(screen.getByRole('button',{name:'获取原件'}));await screen.findByText('尚无已授权的来源设备，请先在设备页完成加入确认');
    expect(screen.queryByRole('button',{name:'开始获取'})).not.toBeInTheDocument();expect(f.fetch).not.toHaveBeenCalled();
  });
});
