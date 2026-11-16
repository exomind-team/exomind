import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Divider, SettingRow } from '@/ui/app/components/settings-shared';
import { SettingsSection } from '@/ui/app/components/settings/settings-section';
import { AIRegistryOfferingFormView, AI_REGISTRY_FIELD_LABEL_CLASS, AI_REGISTRY_INPUT_CLASS, type AIRegistryFormDraft } from '@/ui/app/components/settings/AIRegistryOfferingFormView';
import type { SummaryModelDraft, SummaryModelEditorState } from './summary-model-config';

export interface BetaSummaryModelSettingsViewProps {
  profileId:string;
  profileName:string;
  state:SummaryModelEditorState;
  onDraftChange:(update:(draft:SummaryModelDraft)=>SummaryModelDraft)=>void;
  onSave:()=>void;
  onReset:()=>void;
  onReload:()=>void;
  onRetry:()=>void;
}
function offering(draft:SummaryModelDraft):AIRegistryFormDraft{return{capabilityKey:'',capabilityDisplayName:'',channelName:'',vendor:'',baseUrl:draft.baseUrl,model:draft.model,apiKey:draft.newApiKey,qualityScoreManual:'',stabilityLevelManual:'',latencyTierManual:'',notes:'',setAsDefault:false};}

/** Pure device/profile editor. Unsupported Alpha registry fields are hidden,
 * not saved as pretend Beta features. A credential is always write-only. */
export function BetaSummaryModelSettingsView({profileId,profileName,state,onDraftChange,onSave,onReset,onReload,onRetry}:BetaSummaryModelSettingsViewProps){
  if(state.profileId!==profileId||state.configuration&&state.configuration.profile_id!==profileId)return<p role="alert" className="text-sm text-destructive">配置不属于当前档案，请重新打开设置</p>;
  const busy=state.phase==='loading'||state.phase==='saving';const locked=busy||state.requestPending||!state.configuration;
  const value=state.draft;const configuration=state.configuration;
  return<div className="space-y-4" data-testid="beta-summary-model-settings">
    <fieldset disabled={locked} className="min-w-0 space-y-4">
      <SettingsSection title="本机回顾设置">
        <SettingRow label="档案" right={<span className="max-w-[60%] truncate text-sm text-secondary">{profileName||'当前档案'}</span>}/><Divider/>
        <SettingRow label="本机已保存状态" right={<span className="text-sm text-secondary">{!configuration?'尚未读取':!configuration.revision?'尚未保存':configuration.enabled?'已保存为启用':'已保存为停用'}</span>}/><Divider/>
        <SettingRow label="保存后启用回顾" right={<Switch aria-label="保存后启用回顾" checked={value.enabled} onCheckedChange={enabled=>onDraftChange(draft=>({...draft,enabled}))}/>}/><Divider/>
        <SettingRow label="在回顾中包含建议" right={<Switch aria-label="在回顾中包含建议" checked={value.includeSuggestions} onCheckedChange={includeSuggestions=>onDraftChange(draft=>({...draft,includeSuggestions}))}/>}/><Divider/>
        <SettingRow label="已保存的密钥状态" right={<span className="text-sm text-secondary">{!configuration?'尚未读取':configuration.has_api_key?'本机已保存密钥':'未保存密钥'}</span>}/>
        <p className="px-4 pb-3 text-xs text-muted">修改仅保存后生效。只保存在本机此档案，不随设备同步。保存启用后会处理本机负责的回顾；原件仍需单独选择给模型。</p>
      </SettingsSection>
      <AIRegistryOfferingFormView mode="summary" draft={offering(value)} capabilityOptions={[]} vendorOptions={[]} error={null}
        onDraftChange={update=>onDraftChange(current=>{const next=update(offering(current));return{...current,baseUrl:next.baseUrl,model:next.model,newApiKey:next.apiKey};})}
        onSave={onSave} onReset={onReset} saveLabel="保存回顾配置" saveDisabled={locked} secretFieldVisible={value.secretAction==='set'}
        beforeSecret={<div className="space-y-1.5"><label className={AI_REGISTRY_FIELD_LABEL_CLASS}>密钥操作</label>
          <Select value={value.secretAction} onValueChange={secretAction=>onDraftChange(draft=>({...draft,secretAction:secretAction as SummaryModelDraft['secretAction'],newApiKey:''}))}>
            <SelectTrigger aria-label="密钥操作" className={AI_REGISTRY_INPUT_CLASS}><SelectValue/></SelectTrigger><SelectContent>
              <SelectItem value="keep">保留当前密钥状态</SelectItem><SelectItem value="set">输入或替换密钥</SelectItem><SelectItem value="clear">明确清除已保存密钥</SelectItem>
            </SelectContent></Select>
          {value.secretAction==='keep'?<p className="text-xs text-muted">不读取、不回填已保存密钥；保存其他字段不会清除它。</p>:value.secretAction==='clear'?<p className="text-xs text-muted">保存后会清除本机此档案的已保存密钥。</p>:<p className="text-xs text-muted">新密钥仅保留在当前编辑窗口；输入为空不会清除旧密钥。</p>}
        </div>}
        afterSecret={<><p className="text-xs text-muted">填写兼容 Chat Completions 的基础地址（如 …/v1），服务会追加 chat/completions。保存不发送连接测试请求。</p>
          <div className="grid grid-cols-2 gap-2"><label className="space-y-1.5"><span className={AI_REGISTRY_FIELD_LABEL_CLASS}>最大输出 tokens</span><input aria-label="最大输出 tokens" className={AI_REGISTRY_INPUT_CLASS} type="number" min="1" max="32768" step="1" value={value.maxOutputTokens} onChange={event=>onDraftChange(draft=>({...draft,maxOutputTokens:event.target.value}))}/></label>
          <label className="space-y-1.5"><span className={AI_REGISTRY_FIELD_LABEL_CLASS}>请求超时（毫秒）</span><input aria-label="请求超时（毫秒）" className={AI_REGISTRY_INPUT_CLASS} type="number" min="1000" max="120000" step="1" value={value.timeoutMs} onChange={event=>onDraftChange(draft=>({...draft,timeoutMs:event.target.value}))}/></label></div>
        </>}/>
    </fieldset>
    <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={busy} onClick={onReload}>{state.requestPending?'查证保存结果':'重新读取本机配置'}</Button>
      {state.requestPending&&<Button variant="outline" size="sm" disabled={busy} onClick={onRetry}>重试同一保存请求</Button>}
    </div>
    {busy&&<p role="status" className="text-xs text-muted">{state.phase==='saving'?'正在确认本机配置保存…':'正在读取本机回顾配置…'}</p>}
    {state.error&&<p role="alert" className="text-xs text-destructive">{state.error}</p>}
    {state.notice&&<p role="status" className="text-xs text-muted">{state.notice}</p>}
  </div>;
}
