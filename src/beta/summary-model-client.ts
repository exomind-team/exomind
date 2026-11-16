import { invoke } from '@tauri-apps/api/core';
import { BetaApiError } from './api-error';
import type { BetaStatus } from './client';
import { parseSummaryModelConfiguration, type SummaryModelConfigurationCommand, type SummaryModelConfigurationService } from './summary-model-config';

type Call=<T>(command:string,args?:Record<string,unknown>)=>Promise<T>;
function identityFence(identity:()=>Promise<BetaStatus>){
  let bound:{device:string;runtime:string}|null=null;let invalid=false;
  return async()=>{
    const value=await identity();const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    if(!value||typeof value!=='object'||invalid||value.protocol!=='exomind-beta/1'||!value.running||!value.runtime_id||!uuid.test(value.device_id)||!uuid.test(value.runtime_id)||value.device_id==='00000000-0000-0000-0000-000000000000'||value.runtime_id==='00000000-0000-0000-0000-000000000000'||bound&&(bound.device!==value.device_id||bound.runtime!==value.runtime_id)){
      invalid=true;throw new BetaApiError('summary_model_service_changed','本机服务身份已变化，请重新打开设置后核对配置');
    }
    bound={device:value.device_id,runtime:value.runtime_id};return bound;
  };
}
function guardedService(identity:()=>Promise<BetaStatus>,read:(profileId:string)=>Promise<unknown>,save:(profileId:string,command:SummaryModelConfigurationCommand)=>Promise<unknown>):SummaryModelConfigurationService{
  const check=identityFence(identity);
  async function operation(profileId:string,request:()=>Promise<unknown>){const before=await check();const raw=await request();const after=await check();if(before.device!==after.device||before.runtime!==after.runtime)throw new BetaApiError('summary_model_service_changed','本机服务身份已变化，请重新打开设置后核对配置');return parseSummaryModelConfiguration(raw,profileId);}
  return{read:profileId=>operation(profileId,()=>read(profileId)),save:(profileId,command)=>operation(profileId,()=>save(profileId,command))};
}
export function nativeSummaryModelConfigurationService(call:Call=invoke,identity:()=>Promise<BetaStatus>=()=>call('beta_status')):SummaryModelConfigurationService{
  return guardedService(identity,profileId=>call('beta_summary_model_configuration',{profileId}),(profileId,command)=>call('beta_configure_summary_model',{profileId,command}));
}
export interface SummaryModelConfigurationWebIO {
  identity():Promise<BetaStatus>;
  /** Owner-authenticated request, relative to /beta/v1. Never use a human or
   * agent grant, credentials in URLs, or the separate model-provider URL. */
  ownerJson(profileId:string,path:string,method:'GET'|'POST',body?:SummaryModelConfigurationCommand):Promise<unknown>;
}
export function webSummaryModelConfigurationService(io:SummaryModelConfigurationWebIO):SummaryModelConfigurationService{
  const route=(profileId:string)=>`/profiles/${encodeURIComponent(profileId)}/summary-model`;
  return guardedService(()=>io.identity(),profileId=>io.ownerJson(profileId,route(profileId),'GET'),(profileId,command)=>io.ownerJson(profileId,route(profileId),'POST',command));
}
