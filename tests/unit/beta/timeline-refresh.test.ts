import { describe, expect, it, vi } from 'vitest';
import { mergeTimelineItems, refreshTimelineWindow } from '@/beta/timeline-refresh';
import type { BetaTimelineItem, BetaTimelinePage } from '@/beta/timeblocks-types';
const event=(seq:number,text=`record-${seq}`):BetaTimelineItem=>({kind:'capture',record:{event_id:`event-${seq}`,profile_id:'p',device_id:'d',author_id:'a',author_kind:'human',occurred_at_ms:1000,text,tags:[],digest:'a'.repeat(64),local_seq:seq}});
const page=(values:number[],highwater:number,next_before:number|null):BetaTimelinePage=>({items:values.map(value=>event(value)),highwater,next_before});

describe('Beta loaded timeline window',()=>{
  it('retains older loaded pages while collecting a multi-page new tail through one highwater',async()=>{
    const previous=page([3,2,1],3,null);
    const read=vi.fn().mockResolvedValueOnce(page([7,6],7,6)).mockResolvedValueOnce(page([5,4],7,4)).mockResolvedValueOnce(page([3,2],7,2));
    const result=await refreshTimelineWindow(read,previous,'literal');
    expect(result.items.map(item=>item.record.local_seq)).toEqual([7,6,5,4,3,2,1]);
    expect(result.next_before).toBeNull();
    expect(read).toHaveBeenNthCalledWith(2,{limit:100,search:'literal',before:6,through:7});
    expect(read).toHaveBeenNthCalledWith(3,{limit:100,search:'literal',before:4,through:7});
  });
  it('does not silently mark an unfinished incoming gap as the end of history',async()=>{
    const previous=page([1],1,null);let sequence=2000;
    const read=vi.fn(async()=>page([sequence--],2000,sequence+1));
    const result=await refreshTimelineWindow(read,previous,'');
    expect(read).toHaveBeenCalledTimes(16);
    expect(result.next_before).not.toBeNull();
    expect(result.items.some(item=>item.record.local_seq===1)).toBe(true);
  });
  it('rejects a rewound highwater or changed immutable record instead of clearing known rows',async()=>{
    const old=page([3,2,1],3,null);
    await expect(refreshTimelineWindow(vi.fn(async()=>page([],2,null)),old,'')).rejects.toMatchObject({code:'timeline_changed'});
    expect(()=>mergeTimelineItems(old.items,[event(3,'changed')])).toThrow();
    expect(old.items[0].record).toMatchObject({text:'record-3'});
  });
});
