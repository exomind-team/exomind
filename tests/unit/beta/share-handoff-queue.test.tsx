import { countPendingBetaShareHandoffs, useBetaShareHandoffQueue } from '@/beta/share-handoff-queue';
import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BetaShareHandoffsClient } from '@/beta/share-handoff-client';

const pending={handoff_id:'handoff-1',received_at_ms:1000,state:'ready' as const,bound_profile_id:null,profile_match:true,error_code:null,recovery_instruction:null,text_state:'ready' as const,text_preview:'shared',items:[]};

function Probe({client,onIncoming,profileId='profile-a'}:{client:BetaShareHandoffsClient;onIncoming:(id:string)=>void;profileId?:string}){
  const queue=useBetaShareHandoffQueue(client,profileId,onIncoming);
  return <div><span>{queue.state.handoffs.length}</span><button onClick={()=>{void queue.refresh();}}>refresh</button></div>;
}

describe('BetaShareHandoffQueue',()=>{
  it('opens the now workspace for a pending startup handoff and each new share once',async()=>{
    let emit:(handoffId:string)=>void=()=>{};
    const client:BetaShareHandoffsClient={
      list:vi.fn(async()=>[pending]),get:vi.fn(async()=>({...pending,text:'shared',items:[]})),bindProfile:vi.fn(async()=>{}),
      acknowledgeText:vi.fn(async()=>{}),acknowledgeItem:vi.fn(async()=>{}),discard:vi.fn(async()=>{}),cancel:vi.fn(async()=>({cancel_requested:true,status:'cancelled'})),
      onAvailable:vi.fn(async handler=>{emit=handler;return vi.fn();}),
    },onIncoming=vi.fn();
    render(<Probe client={client} onIncoming={onIncoming}/>);

    await waitFor(()=>expect(screen.getByText('1')).toBeInTheDocument());
    expect(onIncoming).toHaveBeenCalledTimes(1);
    expect(onIncoming).toHaveBeenCalledWith('handoff-1');

    await act(async()=>{emit('handoff-1');});
    expect(onIncoming).toHaveBeenCalledTimes(1);
    await act(async()=>{emit('handoff-2');});
    expect(onIncoming).toHaveBeenCalledTimes(2);
    expect(onIncoming).toHaveBeenLastCalledWith('handoff-2');
    expect(client.list).toHaveBeenCalledWith('profile-a');
  });

  it('refreshes an already mounted queue when Native announces a new handoff',async()=>{
    let emit:(handoffId:string)=>void=()=>{};
    let rows:typeof pending[]=[];
    const client:BetaShareHandoffsClient={
      list:vi.fn(async()=>rows),get:vi.fn(async()=>null),bindProfile:vi.fn(async()=>{}),
      acknowledgeText:vi.fn(async()=>{}),acknowledgeItem:vi.fn(async()=>{}),discard:vi.fn(async()=>{}),
      cancel:vi.fn(async()=>({cancel_requested:true,status:'cancelled'})),
      onAvailable:vi.fn(async handler=>{emit=handler;return vi.fn();}),
    },onIncoming=vi.fn();
    render(<Probe client={client} onIncoming={onIncoming}/>);

    await waitFor(()=>expect(client.list).toHaveBeenCalledTimes(1));
    expect(screen.getByText('0')).toBeInTheDocument();
    rows=[pending];
    await act(async()=>{emit(pending.handoff_id);});

    await waitFor(()=>expect(client.list).toHaveBeenCalledTimes(2));
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(onIncoming).toHaveBeenCalledWith(pending.handoff_id);
  });

  it('refreshes within the selected profile scope after a profile change',async()=>{
    const client:BetaShareHandoffsClient={
      list:vi.fn(async(profileId?:string)=>profileId==='profile-a'?[pending]:[{...pending,handoff_id:'foreign-a',bound_profile_id:'profile-a',profile_match:false,text_state:'none' as const,text_preview:null,items:[]}]),
      get:vi.fn(async()=>null),bindProfile:vi.fn(async()=>{}),acknowledgeText:vi.fn(async()=>{}),acknowledgeItem:vi.fn(async()=>{}),discard:vi.fn(async()=>{}),
      cancel:vi.fn(async()=>({cancel_requested:true,status:'cancelled'})),onAvailable:vi.fn(async()=>vi.fn()),
    };
    const onIncoming=vi.fn(),view=render(<Probe client={client} onIncoming={onIncoming}/>);
    await waitFor(()=>expect(client.list).toHaveBeenCalledWith('profile-a'));
    view.rerender(<Probe client={client} onIncoming={onIncoming} profileId="profile-b"/>);
    await waitFor(()=>expect(client.list).toHaveBeenCalledWith('profile-b'));
    expect(onIncoming).toHaveBeenCalledWith('foreign-a');
  });

  it('counts unbound shares and Native-redacted bound shares while no profile is selected',async()=>{
    const redacted={...pending,bound_profile_id:'profile-a',profile_match:false,text_state:'none' as const,text_preview:null,items:[]};
    const client:BetaShareHandoffsClient={
      list:vi.fn(async()=>[redacted,pending]),get:vi.fn(async()=>null),bindProfile:vi.fn(async()=>{}),acknowledgeText:vi.fn(async()=>{}),acknowledgeItem:vi.fn(async()=>{}),discard:vi.fn(async()=>{}),
      cancel:vi.fn(async()=>({cancel_requested:true,status:'cancelled'})),onAvailable:vi.fn(async()=>vi.fn()),
    };
    render(<Probe client={client} onIncoming={vi.fn()} profileId=""/>);
    await waitFor(()=>expect(screen.getByText('2')).toBeInTheDocument());
    expect(client.list).toHaveBeenCalledWith(undefined);
  });

  it('keeps a cancelled terminal receipt in pending recovery until discard',async()=>{
    const cancelled={...pending,state:'cancelled' as const,error_code:'cancelled' as const,
      text_state:'none' as const,text_preview:null,items:[]};
    const client:BetaShareHandoffsClient={
      list:vi.fn(async()=>[cancelled]),get:vi.fn(async()=>null),bindProfile:vi.fn(async()=>{}),acknowledgeText:vi.fn(async()=>{}),acknowledgeItem:vi.fn(async()=>{}),discard:vi.fn(async()=>{}),
      cancel:vi.fn(async()=>({cancel_requested:true,status:'cancelled'})),onAvailable:vi.fn(async()=>vi.fn()),
    };
    const onIncoming=vi.fn();
    expect(countPendingBetaShareHandoffs([cancelled])).toBe(1);
    render(<Probe client={client} onIncoming={onIncoming}/>);
    await waitFor(()=>expect(onIncoming).toHaveBeenCalledWith('handoff-1'));
    expect(screen.getByText('1')).toBeInTheDocument();
  });
});
