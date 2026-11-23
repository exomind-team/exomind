import { describe, expect, it, vi } from 'vitest';
import { betaShareHandoffSourceId, createBetaShareHandoffsClient, parseBetaShareHandoff, parseBetaShareHandoffList } from '@/beta/share-handoff-client';

const summary={handoff_id:'handoff-1',received_at_ms:1234,state:'ready',bound_profile_id:null,profile_match:true,error_code:null,recovery_instruction:null,text_state:'ready',text_preview:'https://example.test',items:[{
  item_id:'item-1',name:'image.png',media_type:'image/png',byte_length:4,state:'ready',error_code:null,recovery_instruction:null,
}]};
const handoff={handoff_id:summary.handoff_id,received_at_ms:summary.received_at_ms,state:summary.state,bound_profile_id:null,error_code:null,recovery_instruction:null,
  text_state:summary.text_state,text:'https://example.test',items:[{...summary.items[0],sha256:'a'.repeat(64)}]};

describe('Beta Android share handoff client',()=>{
  it('validates bounded summaries and keeps the full share text behind get',()=>{
    expect(parseBetaShareHandoffList([summary])).toMatchObject([{handoff_id:'handoff-1',text_preview:'https://example.test',items:[{item_id:'item-1',byte_length:4}]}]);
    expect(parseBetaShareHandoffList([{...summary,items:[{...summary.items[0],media_type:'image/*'}]}])[0].items[0].media_type).toBe('image/*');
    expect(parseBetaShareHandoff({...handoff,text:'https://example.test\nshared note'})).toMatchObject({handoff_id:'handoff-1',text:'https://example.test\nshared note'});
    expect(parseBetaShareHandoff(null)).toBeNull();
  });

  it('accepts quota receipts and bounded acknowledged tombstones as distinct terminal states',()=>{
    const quota={...summary,state:'interrupted' as const,error_code:'quota_exceeded' as const,recovery_instruction:'请处理待处理分享后重新分享',text_state:'none' as const,text_preview:null,items:[]};
    const storage={...quota,handoff_id:'handoff-storage',error_code:'storage_unavailable' as const,recovery_instruction:'请释放设备存储空间后重新分享'};
    const acknowledged={...summary,handoff_id:'handoff-2',state:'acknowledged' as const,error_code:null,recovery_instruction:null,text_state:'acknowledged' as const,text_preview:null,
      items:[{...summary.items[0],state:'acknowledged' as const}]};
    expect(parseBetaShareHandoffList([quota,storage,acknowledged])).toMatchObject([
      {handoff_id:'handoff-1',error_code:'quota_exceeded',state:'interrupted'},
      {handoff_id:'handoff-storage',error_code:'storage_unavailable'},
      {handoff_id:'handoff-2',state:'acknowledged',text_state:'acknowledged'},
    ]);
  });

  it('preserves profile-bound foreign rows while requiring Native redaction',()=>{
    const foreign={...summary,bound_profile_id:'profile-a',profile_match:false,text_state:'none' as const,text_preview:null,items:[]};
    expect(parseBetaShareHandoffList([foreign])[0]).toMatchObject({bound_profile_id:'profile-a',profile_match:false,text_state:'none',text_preview:null,items:[]});
    expect(()=>parseBetaShareHandoffList([{...foreign,text_preview:'secret'}])).toThrow();
    expect(()=>parseBetaShareHandoffList([{...foreign,bound_profile_id:null}])).toThrow();
  });

  it('rejects raw URI/path data, duplicate items, and oversized batches',()=>{
    expect(()=>parseBetaShareHandoffList([{...summary,uri:'content://private/1'}])).toThrow();
    expect(()=>parseBetaShareHandoffList([{...summary,items:[summary.items[0],summary.items[0]]}])).toThrow();
    expect(()=>parseBetaShareHandoffList([{...summary,items:[{...summary.items[0],name:'../private/path.png'}]}])).toThrow();
    expect(()=>parseBetaShareHandoffList(Array.from({length:257},(_,index)=>({...summary,handoff_id:`handoff-${index}`})))).toThrow();
    const manyItems=Array.from({length:256},(_,index)=>({...summary.items[0],item_id:`item-${index}`,name:`${index}.png`}));
    expect(parseBetaShareHandoffList([{...summary,items:manyItems}])[0].items).toHaveLength(256);
    expect(()=>parseBetaShareHandoffList([{...summary,items:[...manyItems,{...manyItems[0],item_id:'item-256'}]}])).toThrow();
    expect(()=>parseBetaShareHandoff({...handoff,text:'x'.repeat(65_537)})).toThrow();
  });

  it('uses opaque handoff IDs for reads, acknowledgements, discard, and cancel',async()=>{
    const call=vi.fn(async(command:string)=>command==='beta_share_handoff_list'?[summary]
      :command==='beta_share_handoff_get'?handoff
        :command==='beta_share_handoff_bind_profile'?{bound_profile_id:'profile-a'}
        :command==='beta_share_handoff_ack_text'?{acknowledged:true}
          :command==='beta_share_handoff_ack_item'?{acknowledged:true}
            :command==='beta_share_handoff_discard'?{discarded:true}
              :command==='beta_share_handoff_cancel'?{cancel_requested:true,status:'cancelled'}:undefined);
    const client=createBetaShareHandoffsClient(call as never,vi.fn() as never);

    await client.list('profile-a');
    expect(await client.get('handoff-1','profile-a')).toMatchObject({text:'https://example.test'});
    await client.bindProfile('handoff-1','profile-a');
    await client.acknowledgeText('handoff-1','profile-a');
    await client.acknowledgeItem('handoff-1','item-1','profile-a');
    await client.discard('handoff-1','profile-a');
    await client.cancel('handoff-1');
    expect(call.mock.calls.map(([command])=>command)).toEqual([
      'beta_share_handoff_list','beta_share_handoff_get','beta_share_handoff_bind_profile','beta_share_handoff_ack_text',
      'beta_share_handoff_ack_item','beta_share_handoff_discard','beta_share_handoff_cancel',
    ]);
    expect(call.mock.calls[0][1]).toEqual({profile_id:'profile-a'});
    expect(call.mock.calls[1][1]).toEqual({handoff_id:'handoff-1',profile_id:'profile-a'});
    expect(call.mock.calls[2][1]).toEqual({handoff_id:'handoff-1',profile_id:'profile-a'});
    expect(call.mock.calls[4][1]).toEqual({handoff_id:'handoff-1',item_id:'item-1',profile_id:'profile-a'});
  });

  it('omits profile_id when no profile has been selected',async()=>{
    const call=vi.fn(async()=>[summary]),client=createBetaShareHandoffsClient(call as never,vi.fn() as never);
    await client.list('');
    expect(call).toHaveBeenCalledWith('beta_share_handoff_list');
  });

  it('notifies only for a valid available handoff ID',async()=>{
    let callback:((event:{payload:{handoff_id:string}})=>void)|undefined;
    const subscribe=vi.fn(async(_event:string,handler:typeof callback)=>{callback=handler;return vi.fn();});
    const client=createBetaShareHandoffsClient(vi.fn() as never,subscribe as never),available=vi.fn();
    const stop=await client.onAvailable(available);
    expect(subscribe).toHaveBeenCalledWith('beta-share-handoff-available',expect.any(Function));
    callback?.({payload:{handoff_id:'invalid id'}});
    callback?.({payload:{handoff_id:'handoff-2'}});
    expect(available).toHaveBeenCalledTimes(1);
    expect(available).toHaveBeenCalledWith('handoff-2');
    expect(stop).toBeInstanceOf(Function);
  });

  it('derives a bounded stable local source identity from each handoff item',()=>{
    const first=betaShareHandoffSourceId('handoff-1','item-1');
    expect(first).toMatch(/^share-[a-f0-9]{32}$/);
    expect(betaShareHandoffSourceId('handoff-1','item-1')).toBe(first);
    expect(betaShareHandoffSourceId('handoff-1','item-2')).not.toBe(first);
  });
});
