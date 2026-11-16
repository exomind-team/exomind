import {describe,it,expect,vi} from 'vitest';
import {nativeTimelineEventReader,webTimelineEventReader} from '@/beta/timeline-event-client';
const P='11111111-1111-4111-8111-111111111111',Q='22222222-2222-4222-8222-222222222222',D='33333333-3333-4333-8333-333333333333',E='44444444-4444-4444-8444-444444444444',R='55555555-5555-4555-8555-555555555555';
const status=()=>({protocol:'exomind-beta/1',device_id:D,runtime_id:R,running:true,capabilities:{summary_jobs:true}});
const item=()=>({kind:'capture',record:{event_id:E,profile_id:P,device_id:D,author_id:D,author_kind:'human',occurred_at_ms:1794560000000,text:'Synthetic exact source',tags:[],digest:'a'.repeat(64),local_seq:4,originals:[]}});
describe('scoped exact timeline source reads',()=>{
 it('uses exact Native and human-scoped HTTP routes, with null reserved for actual absence',async()=>{
  const call=vi.fn(async(name:string)=>name==='beta_status'?status():item());const native=nativeTimelineEventReader(call as Parameters<typeof nativeTimelineEventReader>[0]);expect((await native(P,E))?.record.event_id).toBe(E);expect(call).toHaveBeenCalledWith('beta_timeline_event',{profileId:P,eventId:E});
  const json=vi.fn(async()=>null);const web=webTimelineEventReader({identity:async()=>status(),json});expect(await web(P,E)).toBeNull();expect(json).toHaveBeenCalledWith(P,`/profiles/${P}/timeline/events/${E}`);
 });
 it('rejects wrong IDs/scopes and internal job records rather than returning an empty success',async()=>{
  for(const response of [{...item(),record:{...item().record,event_id:Q}},{...item(),record:{...item().record,profile_id:Q}},{kind:'summary_job/1',record:{}}]){
   const read=webTimelineEventReader({identity:async()=>status(),json:async()=>response});await expect(read(P,E)).rejects.toMatchObject({code:expect.any(String)});
  }
 });
 it('does not apply a response after runtime changes',async()=>{
  let n=0;const read=webTimelineEventReader({identity:async()=>({...status(),runtime_id:n++===0?R:Q}),json:async()=>item()});await expect(read(P,E)).rejects.toMatchObject({code:'source_service_changed'});
 });
 it('keeps storage errors distinct and never forwards arbitrary diagnostics',async()=>{
  const read=webTimelineEventReader({identity:async()=>status(),json:async()=>{throw {code:'storage_error',message:'synthetic private path /private/diagnostic'};}});await expect(read(P,E)).rejects.toMatchObject({code:'storage_error',message:'本机存储暂不能读取来源，请稍后重试'});
 });
});
