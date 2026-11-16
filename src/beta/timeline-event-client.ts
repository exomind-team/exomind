import { invoke } from '@tauri-apps/api/core';
import {BetaApiError} from './api-error';
import type {BetaStatus} from './client';
import type {BetaTimelineItem} from './timeblocks-types';
import {validateTimelineItem} from './timeblocks-validation';
import {summaryUuid} from './summary-validation';

type Call=<T>(command:string,args?:Record<string,unknown>)=>Promise<T>;
export type TimelineEventReader=(profileId:string,eventId:string)=>Promise<BetaTimelineItem|null>;
const messages:Record<string,string>={source_service_changed:'本机服务已变化，请重新连接后查看来源',invalid_timeline:'来源响应与这条记录不一致，请刷新后查证',unsupported_summaries:'当前服务不支持精确来源读取，请使用同版 Beta',forbidden:'当前授权不能查看这条来源',unauthorized:'当前授权已失效，请重新连接',recovery_required:'来源资料需要恢复，现有记录已保留',storage_error:'本机存储暂不能读取来源，请稍后重试',stopped:'本机服务已停止',source_unavailable:'来源暂不能读取，请稍后重试'};
function reader(identity:()=>Promise<BetaStatus>,read:(profile:string,event:string)=>Promise<unknown>):TimelineEventReader{
  let bound:{runtime:string;device:string}|null=null,invalid=false;
  async function check(){
    const state=await identity();const device=summaryUuid(state.device_id),runtime=summaryUuid(state.runtime_id);
    if(invalid||state.protocol!=='exomind-beta/1'||state.running!==true||bound&&(device!==bound.device||runtime!==bound.runtime)){invalid=true;throw new BetaApiError('source_service_changed',messages.source_service_changed);}
    if(state.capabilities?.summary_jobs!==true)throw new BetaApiError('unsupported_summaries',messages.unsupported_summaries);
    bound={device,runtime};return bound;
  }
  return async(profile,event)=>{
    try{
      summaryUuid(profile);summaryUuid(event);const before=await check();const value=await read(profile,event);const after=await check();
      if(before.device!==after.device||before.runtime!==after.runtime)throw new BetaApiError('source_service_changed',messages.source_service_changed);
      if(value===null)return null;
      const result=validateTimelineItem(value,profile);if(result.record.event_id!==event)throw new BetaApiError('invalid_timeline',messages.invalid_timeline);
      return result;
    }catch(error){const raw=error&&typeof error==='object'&&'code'in error&&typeof error.code==='string'?error.code:'';const code=Object.prototype.hasOwnProperty.call(messages,raw)?raw:'source_unavailable';throw new BetaApiError(code,messages[code]);}
  };
}
export function nativeTimelineEventReader(call:Call=invoke,identity:()=>Promise<BetaStatus>=()=>call('beta_status')):TimelineEventReader{return reader(identity,(profileId,eventId)=>call('beta_timeline_event',{profileId,eventId}));}
export function webTimelineEventReader(io:{identity():Promise<BetaStatus>;json(profileId:string,path:string):Promise<unknown>}):TimelineEventReader{return reader(()=>io.identity(),(profile,event)=>io.json(profile,`/profiles/${encodeURIComponent(profile)}/timeline/events/${encodeURIComponent(event)}`));}
