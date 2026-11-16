import { BetaApiError } from './api-error';
import { betaUuid } from './initialization';

export interface SummaryModelConfiguration { profile_id:string; revision:string|null; enabled:boolean; include_suggestions:boolean; base_url:string; model:string; has_api_key:boolean; max_output_tokens:number; timeout_ms:number }
export type SummaryModelSecretUpdate={kind:'keep'}|{kind:'clear'}|{kind:'set';value:string};
export interface SummaryModelConfigurationCommand { command_id:string; expected_revision:string|null; enabled:boolean; include_suggestions:boolean; base_url:string; model:string; api_key:SummaryModelSecretUpdate; max_output_tokens:number; timeout_ms:number }
/** Implementations bind one Host/device identity and use owner authority, not
 * a human/agent grant. No provider/model request is part of this service. */
export interface SummaryModelConfigurationService { read(profileId:string):Promise<unknown>; save(profileId:string,command:SummaryModelConfigurationCommand):Promise<unknown> }
export interface SummaryModelDraft { enabled:boolean; includeSuggestions:boolean; baseUrl:string; model:string; secretAction:'keep'|'clear'|'set'; newApiKey:string; maxOutputTokens:string; timeoutMs:string }
export interface SummaryModelEditorState { deviceId:string; profileId:string; configuration:SummaryModelConfiguration|null; draft:SummaryModelDraft; phase:'unloaded'|'loading'|'idle'|'saving'|'unconfirmed'|'conflict'|'failed'; requestPending:boolean; error:string|null; notice:string|null }
const encoder=new TextEncoder();
function errorCode(value:unknown):string{return value&&typeof value==='object'&&'code'in value&&typeof value.code==='string'?value.code:'';}
function invalid(message='配置响应尚未确认，请重新读取'):never{throw new BetaApiError('invalid_summary_model_configuration',message);}
function uuid(value:unknown):string{if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)||value==='00000000-0000-0000-0000-000000000000')return invalid();return value;}
function text(value:unknown,max:number):string{if(typeof value!=='string'||value.length>max||encoder.encode(value).length>max)return invalid();return value;}
function integer(value:unknown,min:number,max:number):number{if(!Number.isSafeInteger(value)||Number(value)<min||Number(value)>max)return invalid();return Number(value);}
function providerFields(baseUrl:string,model:string,tokens:number,timeout:number){
  text(baseUrl,4096);text(model,256);integer(tokens,1,32768);integer(timeout,1000,120000);
  if(!model.trim())return invalid('请输入模型名称');
  let url:URL;try{url=new URL(baseUrl);}catch{return invalid('请输入有效的接口基础地址');}
  if(!['http:','https:'].includes(url.protocol)||!url.hostname||url.username||url.password||url.search||url.hash)return invalid('接口基础地址不允许凭据、查询参数或片段');
}
export function parseSummaryModelConfiguration(value:unknown,profileId:string):SummaryModelConfiguration{
  if(!value||typeof value!=='object'||Array.isArray(value))return invalid();const raw=value as Record<string,unknown>;
  const keys=['profile_id','revision','enabled','include_suggestions','base_url','model','has_api_key','max_output_tokens','timeout_ms'];
  if(Object.keys(raw).some(key=>!keys.includes(key))||keys.some(key=>!(key in raw))||raw.profile_id!==profileId||typeof raw.enabled!=='boolean'||typeof raw.include_suggestions!=='boolean'||typeof raw.has_api_key!=='boolean')return invalid();
  uuid(raw.profile_id);const revision=raw.revision===null?null:uuid(raw.revision);const base=text(raw.base_url,4096),model=text(raw.model,256),tokens=integer(raw.max_output_tokens,1,32768),timeout=integer(raw.timeout_ms,1000,120000);
  if(revision===null){if(raw.enabled||raw.include_suggestions||raw.has_api_key||base||model)return invalid();}else providerFields(base,model,tokens,timeout);
  return{profile_id:profileId,revision,enabled:raw.enabled,include_suggestions:raw.include_suggestions,base_url:base,model,has_api_key:raw.has_api_key,max_output_tokens:tokens,timeout_ms:timeout};
}
function blankDraft():SummaryModelDraft{return{enabled:false,includeSuggestions:false,baseUrl:'',model:'',secretAction:'keep',newApiKey:'',maxOutputTokens:'2048',timeoutMs:'60000'};}
function draftFrom(value:SummaryModelConfiguration):SummaryModelDraft{return{enabled:value.enabled,includeSuggestions:value.include_suggestions,baseUrl:value.base_url,model:value.model,secretAction:'keep',newApiKey:'',maxOutputTokens:String(value.max_output_tokens),timeoutMs:String(value.timeout_ms)};}
function draftUnchanged(draft:SummaryModelDraft,value:SummaryModelConfiguration):boolean{const original=draftFrom(value);return(Object.keys(original) as Array<keyof SummaryModelDraft>).every(key=>original[key]===draft[key]);}
function numeric(value:string,min:number,max:number,label:string):number{if(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)<min||Number(value)>max)return invalid(`${label}须为 ${min}–${max} 之间的整数`);return Number(value);}
export function summaryModelCommand(configuration:SummaryModelConfiguration,draft:SummaryModelDraft,commandId:string):SummaryModelConfigurationCommand{
  uuid(commandId);uuid(configuration.profile_id);if(configuration.revision!==null)uuid(configuration.revision);const tokens=numeric(draft.maxOutputTokens,1,32768,'最大输出量'),timeout=numeric(draft.timeoutMs,1000,120000,'请求超时');
  const base=draft.baseUrl.trim(),model=draft.model.trim();providerFields(base,model,tokens,timeout);
  let secret:SummaryModelSecretUpdate;
  if(draft.secretAction==='keep')secret={kind:'keep'};else if(draft.secretAction==='clear')secret={kind:'clear'};else if(draft.secretAction==='set'){
    const value=text(draft.newApiKey,16384);if(!value.length||/[\u0000-\u001f\u007f]/.test(value))return invalid('请输入有效的新密钥，未输入不会清除原密钥');secret={kind:'set',value};
  }else return invalid('请明确选择密钥保留、替换或清除');
  if(typeof draft.enabled!=='boolean'||typeof draft.includeSuggestions!=='boolean')return invalid();
  return Object.freeze({command_id:commandId,expected_revision:configuration.revision,enabled:draft.enabled,include_suggestions:draft.includeSuggestions,base_url:base,model,api_key:Object.freeze(secret),max_output_tokens:tokens,timeout_ms:timeout});
}
function matchesSaved(value:SummaryModelConfiguration,command:SummaryModelConfigurationCommand,keyAfter:boolean):boolean{return value.revision===command.command_id&&value.enabled===command.enabled&&value.include_suggestions===command.include_suggestions&&value.base_url===command.base_url&&value.model===command.model&&value.has_api_key===keyAfter&&value.max_output_tokens===command.max_output_tokens&&value.timeout_ms===command.timeout_ms;}

/** Entered secrets and uncertain commands stay in this editor's memory only.
 * A retry reuses the frozen command, never its UUID with changed form fields.
 * Disposal fences late replies; it does not claim rollback of an accepted save. */
export class SummaryModelConfigurationController {
  private state:SummaryModelEditorState;
  private readonly listeners=new Set<()=>void>();private flight:Promise<void>|null=null;private generation=0;private closed=false;
  private request:{command:SummaryModelConfigurationCommand;keyAfter:boolean}|null=null;
  constructor(private readonly service:SummaryModelConfigurationService,readonly deviceId:string,readonly profileId:string,private readonly makeUuid:()=>string=betaUuid){this.state={deviceId,profileId,configuration:null,draft:blankDraft(),phase:'unloaded',requestPending:false,error:null,notice:null};}
  snapshot=():SummaryModelEditorState=>this.state;
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  private emit(next:SummaryModelEditorState){if(this.closed)return;this.state=next;for(const listener of this.listeners)listener();}
  private current(generation:number){return!this.closed&&generation===this.generation;}
  private begin(work:()=>Promise<void>):Promise<void>{if(this.closed)return Promise.resolve();if(this.flight)return this.flight;const operation=Promise.resolve().then(work).finally(()=>{if(this.flight===operation)this.flight=null;});this.flight=operation;return operation;}
  edit(update:(draft:SummaryModelDraft)=>SummaryModelDraft):boolean{if(this.closed||this.flight||this.request||!this.state.configuration)return false;this.emit({...this.state,draft:update(this.state.draft),error:null,notice:null});return true;}
  reset():void{if(this.closed||this.flight||this.request||!this.state.configuration)return;this.emit({...this.state,draft:draftFrom(this.state.configuration),phase:'idle',error:null,notice:null});}
  private accepted(value:SummaryModelConfiguration){this.request=null;this.emit({...this.state,configuration:value,draft:draftFrom(value),phase:'idle',requestPending:false,error:null,notice:'回顾模型配置已保存；这不代表服务已连接或已完成生成'});}
  load():Promise<void>{
    if(this.closed||this.flight)return this.flight??Promise.resolve();const generation=this.generation;
    this.emit({...this.state,phase:'loading',error:null,notice:null});
    return this.begin(async()=>{
      if(!this.current(generation))return;
      try{const value=parseSummaryModelConfiguration(await this.service.read(this.profileId),this.profileId);if(!this.current(generation))return;
        const request=this.request;
        if(request&&matchesSaved(value,request.command,request.keyAfter)){this.accepted(value);return;}
        if(request&&value.revision===request.command.command_id){this.emit({...this.state,phase:'unconfirmed',requestPending:true,error:'读回配置与本次保存不一致，尚未声明保存成功，请核对后重试',notice:null});return;}
        if(request&&value.revision===request.command.expected_revision){this.emit({...this.state,configuration:value,phase:'unconfirmed',requestPending:true,error:'保存结果仍待确认，可查证或重试同一请求',notice:null});return;}
        if(request){this.request=null;this.emit({...this.state,configuration:value,phase:'conflict',requestPending:false,error:'本机配置已变化；草稿仍保留，请检查后再保存',notice:null});return;}
        const prior=this.state.configuration;const dirty=!!prior&&!draftUnchanged(this.state.draft,prior);const changed=dirty&&prior?.revision!==value.revision;
        this.emit({...this.state,configuration:value,draft:dirty?this.state.draft:draftFrom(value),phase:changed?'conflict':'idle',requestPending:false,error:changed?'本机配置已变化；草稿仍保留，请检查后再保存':null,notice:null});
      }catch(failure){if(this.current(generation))this.emit({...this.state,phase:this.request?'unconfirmed':'failed',error:errorCode(failure)==='summary_model_service_changed'?'本机服务已变化，请关闭并重新打开设置后核对配置':'本机回顾配置尚未读取成功，请重试；记录功能不受影响',notice:null});}
    });
  }
  save():Promise<void>{
    if(this.closed||this.flight)return this.flight??Promise.resolve();if(this.request)return this.retry();
    const configuration=this.state.configuration;if(!configuration){this.emit({...this.state,error:'请先读取本机回顾配置'});return Promise.resolve();}
    try{const command=summaryModelCommand(configuration,this.state.draft,this.makeUuid());this.request={command,keyAfter:command.api_key.kind==='keep'?configuration.has_api_key:command.api_key.kind==='set'};}
    catch(failure){this.emit({...this.state,error:failure instanceof BetaApiError?failure.message:'保存请求尚未创建，请重试'});return Promise.resolve();}
    return this.retry();
  }
  retry():Promise<void>{
    if(this.closed||this.flight||!this.request)return this.flight??Promise.resolve();const generation=this.generation,request=this.request;
    this.emit({...this.state,phase:'saving',requestPending:true,error:null,notice:null});
    return this.begin(async()=>{
      if(!this.current(generation))return;
      try{const value=parseSummaryModelConfiguration(await this.service.save(this.profileId,request.command),this.profileId);if(!this.current(generation))return;if(!matchesSaved(value,request.command,request.keyAfter))throw new Error('Unconfirmed save receipt');this.accepted(value);}
      catch(failure){if(this.current(generation)){
        if(errorCode(failure)==='model_configuration_invalid'){
          // This exact Host error is emitted before any configuration write.
          // It permits correction; unknown/network failures retain the command.
          this.request=null;this.emit({...this.state,phase:'failed',requestPending:false,error:'此配置未被保存，请检查接口、模型和密钥后重试',notice:null});
        }else this.emit({...this.state,phase:'unconfirmed',requestPending:true,error:errorCode(failure)==='summary_model_service_changed'?'本机服务已变化，保存结果仍待核对，请重新打开设置':'保存结果待确认，请查证或重试同一请求；输入仍保留在此窗口',notice:null});
      }}
    });
  }
  dispose():void{this.closed=true;++this.generation;this.request=null;this.listeners.clear();this.state={...this.state,draft:{...this.state.draft,newApiKey:''},requestPending:false};}
}
