import { invoke } from '@tauri-apps/api/core';
import { BetaApiError } from './api-error';
import type { BetaStatus } from './client';
import type { SummaryClient,SummaryControlCommand,SummaryRequestCommand } from './summary-types';
import { summaryUuid,validateSummaryArtifactPage,validateSummaryControlCommand,validateSummaryPageLimit,validateSummaryReceipt,validateSummaryRequestCommand,validateSummarySelection,validateSummaryServiceStatus,validateSummaryTask,validateSummaryTaskPage } from './summary-validation';

type NativeCall=<T>(command:string,args?:Record<string,unknown>)=>Promise<T>;
interface Operations {
  tasks(profileId:string,after:string|null,limit:number):Promise<unknown>;
  task(profileId:string,taskId:string):Promise<unknown>;
  artifacts(profileId:string,taskId:string,before:number|null,limit:number):Promise<unknown>;
  selection(profileId:string,blockId:string):Promise<unknown>;
  request(command:SummaryRequestCommand):Promise<unknown>;
  control(command:SummaryControlCommand):Promise<unknown>;
  status?():Promise<unknown>;
}
function invalidQuery():never{throw new BetaApiError('invalid_summary_request','回顾查询参数无效，未发送');}
const failureMessages:Record<string,string>={
  invalid_summary_response:'回顾响应与请求范围尚未确认，请刷新后重试',invalid_summary_request:'回顾请求无效，未声明已提交',
  summary_service_changed:'本机服务已变化，旧回顾结果未应用，请重新连接',unsupported_summaries:'当前服务尚未提供回顾任务能力',
  unauthorized:'当前授权已失效，请重新授权',forbidden:'当前授权不允许此回顾操作',summary_forbidden:'当前授权不允许此回顾操作',
  summary_conflict:'回顾归属或控制已变化，请刷新后再操作',summary_stale:'此回顾执行已失效，旧结果不会发布',summary_blocked:'此回顾需要先处理来源或控制状态',
  summary_not_found:'本机尚未找到此回顾任务或结果',not_found:'本机尚未找到请求内容',stopped:'本机服务已停止',clock_unavailable:'本机时钟尚未确认，此操作未执行',
  conflict:'请求标识已与其他内容绑定，请保留原命令并核对',invalid_request:'请求格式无效，未声明已提交',payload_too_large:'请求超过服务支持的大小，未声明已提交',
  recovery_required:'本机资料需要恢复，请先处理资料状态',host_error:'回顾服务尚未完成此请求，请稍后重试',summary_transport:'回顾请求结果尚未确认，请保留原命令后查证或重试',
};
function safeFailure(error:unknown):BetaApiError{
  const raw=error&&typeof error==='object'&&'code'in error&&typeof error.code==='string'?error.code:'';
  const code=Object.prototype.hasOwnProperty.call(failureMessages,raw)?raw:'summary_transport';
  const status=error instanceof BetaApiError&&Number.isInteger(error.status)&&error.status>=100&&error.status<=599?error.status:0;
  return new BetaApiError(code,failureMessages[code],status);
}
function beforeCursor(value:number|null):number|null{if(value!==null&&(!Number.isSafeInteger(value)||value<0))return invalidQuery();return value;}
function client(identity:()=>Promise<BetaStatus>,operations:Operations):SummaryClient{
  let bound:{device:string;runtime:string}|null=null;let changed=false;
  async function check(){
    const value=await identity();let device:string,runtime:string;
    try{if(!value||value.protocol!=='exomind-beta/1'||value.running!==true)throw new Error('Unavailable');device=summaryUuid(value.device_id);runtime=summaryUuid(value.runtime_id);}
    catch{changed=true;throw new BetaApiError('summary_service_changed','本机服务身份尚未确认，请重新连接后读取回顾');}
    if(changed||bound&&(device!==bound.device||runtime!==bound.runtime)){changed=true;throw new BetaApiError('summary_service_changed','本机服务已变化，旧回顾结果未应用，请重新连接');}
    bound={device,runtime};
    if(value.capabilities?.summary_jobs!==true)throw new BetaApiError('unsupported_summaries','当前服务尚未提供回顾任务能力');
    return bound;
  }
  async function stable<T>(read:()=>Promise<unknown>,parse:(value:unknown)=>T):Promise<T>{try{const before=await check();const value=await read();const after=await check();if(before.device!==after.device||before.runtime!==after.runtime)throw new BetaApiError('summary_service_changed','本机服务已变化，旧回顾结果未应用，请重新连接');return parse(value);}catch(error){throw safeFailure(error);}}
  const result:SummaryClient={
    async tasks(profileId,after=null,limit=25){summaryUuid(profileId);if(after!==null)summaryUuid(after);validateSummaryPageLimit(limit);return stable(()=>operations.tasks(profileId,after,limit),value=>validateSummaryTaskPage(value,profileId,after,limit));},
    async task(profileId,taskId){summaryUuid(profileId);summaryUuid(taskId);return stable(()=>operations.task(profileId,taskId),value=>validateSummaryTask(value,profileId,taskId));},
    async artifacts(profileId,taskId,before=null,limit=25){summaryUuid(profileId);summaryUuid(taskId);beforeCursor(before);validateSummaryPageLimit(limit);return stable(()=>operations.artifacts(profileId,taskId,before,limit),value=>validateSummaryArtifactPage(value,profileId,taskId,before,limit));},
    async blockSelection(profileId,blockId){summaryUuid(profileId);summaryUuid(blockId);return stable(()=>operations.selection(profileId,blockId),value=>{const selection=validateSummarySelection(value);if(selection.block_ids.length!==1||selection.block_ids[0]!==blockId||selection.selected_original_ids.length)throw new BetaApiError('invalid_summary_response','时间块范围与请求不一致，未选择任何原件');return selection;});},
    async request(command){const frozen=validateSummaryRequestCommand(command);return stable(()=>operations.request(frozen),value=>validateSummaryReceipt(value,frozen));},
    async control(command){const frozen=validateSummaryControlCommand(command);return stable(()=>operations.control(frozen),value=>validateSummaryReceipt(value,frozen));},
  };
  if(operations.status)result.serviceStatus=()=>stable(()=>operations.status!(),validateSummaryServiceStatus);
  return result;
}
export function nativeSummaryClient(call:NativeCall=invoke,identity:()=>Promise<BetaStatus>=()=>call('beta_status')):SummaryClient{
  return client(identity,{
    tasks:(profileId,after,limit)=>call('beta_summary_tasks',{profileId,after,limit}),
    task:(profileId,taskId)=>call('beta_summary_task',{profileId,taskId}),
    artifacts:(profileId,taskId,before,limit)=>call('beta_summary_artifacts',{profileId,taskId,before,limit}),
    selection:(profileId,blockId)=>call('beta_summary_block_selection',{profileId,blockId}),
    request:command=>call('beta_request_summary',{command}),control:command=>call('beta_control_summary',{command}),
    status:()=>call('beta_summary_service_status'),
  });
}
export interface SummaryWebIO {
  identity():Promise<BetaStatus>;
  /** Scoped human/observer JSON request, relative to /beta/v1. The adapter does
   * not mint a grant or silently promote a rejected request to owner authority. */
  json(profileId:string,path:string,method:'GET'|'POST',body?:SummaryRequestCommand|SummaryControlCommand):Promise<unknown>;
  ownerJson?(path:string,method:'GET'):Promise<unknown>;
}
export function webSummaryClient(io:SummaryWebIO):SummaryClient{
  const base=(profile:string)=>`/profiles/${encodeURIComponent(profile)}`;
  const query=(key:string,cursor:string|number|null,limit:number)=>{const values=new URLSearchParams({limit:String(limit)});if(cursor!==null)values.set(key,String(cursor));return values.toString();};
  return client(()=>io.identity(),{
    tasks:(profile,after,limit)=>io.json(profile,`${base(profile)}/summaries/tasks?${query('after',after,limit)}`,'GET'),
    task:(profile,task)=>io.json(profile,`${base(profile)}/summaries/tasks/${encodeURIComponent(task)}`,'GET'),
    artifacts:(profile,task,before,limit)=>io.json(profile,`${base(profile)}/summaries/tasks/${encodeURIComponent(task)}/artifacts?${query('before',before,limit)}`,'GET'),
    selection:(profile,block)=>io.json(profile,`${base(profile)}/timeblocks/${encodeURIComponent(block)}/summary-selection`,'GET'),
    request:command=>io.json(command.profile_id,`${base(command.profile_id)}/summaries/requests`,'POST',command),
    control:command=>io.json(command.profile_id,`${base(command.profile_id)}/summaries/controls`,'POST',command),
    ...(io.ownerJson?{status:()=>io.ownerJson!('/summary-service','GET')}:{}),
  });
}
