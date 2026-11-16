import { useSyncExternalStore } from 'react';
import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { afterEach,describe,expect,it,vi } from 'vitest';
import { BetaSummaryModelSettingsView } from '@/beta/BetaSummaryModelSettingsView';
import { SummaryModelConfigurationController,type SummaryModelConfiguration,type SummaryModelConfigurationCommand } from '@/beta/summary-model-config';
import { AIRegistryOfferingFormView,type AIRegistryFormDraft } from '@/ui/app/components/settings/AIRegistryOfferingFormView';

vi.mock('@/config/llm-settings',()=>{throw new Error('Beta configuration must not read legacy settings');});
vi.mock('@/lib/ai-registry/storage',()=>{throw new Error('Beta configuration must not read legacy storage');});
const P='11111111-1111-4111-8111-111111111111',D='33333333-3333-4333-8333-333333333333',R='44444444-4444-4444-8444-444444444444',C='66666666-6666-4666-8666-666666666666';
const configuration:SummaryModelConfiguration={profile_id:P,revision:R,enabled:false,include_suggestions:false,base_url:'http://127.0.0.1:4000/v1',model:'synthetic-model',has_api_key:true,max_output_tokens:2048,timeout_ms:60000};
function Editor({owner}:{owner:SummaryModelConfigurationController}){const state=useSyncExternalStore(owner.subscribe,owner.snapshot);return<BetaSummaryModelSettingsView profileId={P} profileName="P" state={state} onDraftChange={change=>{owner.edit(change);}} onSave={()=>{void owner.save();}} onReset={()=>owner.reset()} onReload={()=>{void owner.load();}} onRetry={()=>{void owner.retry();}}/>;}
afterEach(()=>{cleanup();vi.restoreAllMocks();});
describe('summary model settings reuse the Alpha form without unsupported fields',()=>{
  it('shows only supported settings, keeps secrets masked, and saves enable/suggestions only after an explicit action',async()=>{
    const read=vi.spyOn(Storage.prototype,'getItem');const write=vi.spyOn(Storage.prototype,'setItem');
    const save=vi.fn(async(_profile:string,command:SummaryModelConfigurationCommand)=>({...configuration,revision:command.command_id,enabled:command.enabled,include_suggestions:command.include_suggestions,base_url:command.base_url,model:command.model,max_output_tokens:command.max_output_tokens,timeout_ms:command.timeout_ms}));
    const owner=new SummaryModelConfigurationController({read:async()=>configuration,save},D,P,()=>C);await owner.load();render(<Editor owner={owner}/>);
    expect(screen.getByText('本机已保存密钥')).toBeInTheDocument();expect(screen.queryByLabelText('新 API Key')).not.toBeInTheDocument();expect(screen.queryByText('Capability Key')).not.toBeInTheDocument();expect(screen.queryByText('质量分')).not.toBeInTheDocument();expect(screen.queryByText('备注 / Notes')).not.toBeInTheDocument();expect(screen.queryByText('Vendor / 渠道厂商')).not.toBeInTheDocument();
    expect(screen.getByRole('switch',{name:'在回顾中包含建议'})).not.toBeChecked();fireEvent.click(screen.getByRole('switch',{name:'保存后启用回顾'}));fireEvent.click(screen.getByRole('switch',{name:'在回顾中包含建议'}));
    expect(save).not.toHaveBeenCalled();expect(screen.getByText('已保存为停用')).toBeInTheDocument();fireEvent.change(screen.getByLabelText('模型名称'),{target:{value:'updated-model'}});fireEvent.click(screen.getByRole('button',{name:'保存回顾配置'}));
    await waitFor(()=>expect(save).toHaveBeenCalledTimes(1));expect(save.mock.calls[0][1]).toMatchObject({enabled:true,include_suggestions:true,api_key:{kind:'keep'},model:'updated-model'});await screen.findByText('已保存为启用');expect(read).not.toHaveBeenCalled();expect(write).not.toHaveBeenCalled();owner.dispose();
  });
  it('keeps the original Alpha registry mode and full fields as the unchanged default',()=>{
    const draft:AIRegistryFormDraft={capabilityKey:'llm.chat',capabilityDisplayName:'Chat',channelName:'Alpha',vendor:'openai',baseUrl:'https://synthetic.example/v1',model:'alpha-model',apiKey:'synthetic-alpha-key',qualityScoreManual:'',stabilityLevelManual:'',latencyTierManual:'',notes:'',setAsDefault:false};
    render(<AIRegistryOfferingFormView draft={draft} onDraftChange={vi.fn()} capabilityOptions={[]} vendorOptions={[]} error={null} onSave={vi.fn()} onReset={vi.fn()}/>);
    for(const label of['Capability Key','Capability Name','Channel Name','Vendor / 渠道厂商','质量分','备注 / Notes'])expect(screen.getByText(label)).toBeInTheDocument();expect(screen.getByPlaceholderText('sk-...')).toHaveValue('synthetic-alpha-key');expect(screen.getByRole('button',{name:'保存'})).toBeEnabled();expect(screen.getByRole('button',{name:'重置'})).toBeEnabled();
  });
  it('shows a write-only new-key field only for an explicit replacement and clears it after confirmed save',async()=>{
    const save=vi.fn(async(_profile:string,command:SummaryModelConfigurationCommand)=>({...configuration,revision:command.command_id}));const owner=new SummaryModelConfigurationController({read:async()=>configuration,save},D,P,()=>C);await owner.load();owner.edit(draft=>({...draft,secretAction:'set'}));render(<Editor owner={owner}/>);
    expect(screen.getByLabelText('新 API Key')).toHaveValue('');fireEvent.change(screen.getByLabelText('新 API Key'),{target:{value:'synthetic-new-key'}});expect(save).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'保存回顾配置'}));
    await waitFor(()=>expect(save).toHaveBeenCalledTimes(1));expect(save.mock.calls[0][1].api_key).toEqual({kind:'set',value:'synthetic-new-key'});await waitFor(()=>expect(screen.queryByLabelText('新 API Key')).not.toBeInTheDocument());expect(document.body.textContent).not.toContain('synthetic-new-key');owner.dispose();
  });
  it('never displays a previous profile editor in another selected profile',async()=>{
    const owner=new SummaryModelConfigurationController({read:async()=>configuration,save:async()=>configuration},D,P);await owner.load();const callback=vi.fn();render(<BetaSummaryModelSettingsView profileId={R} profileName="Other" state={owner.snapshot()} onDraftChange={callback} onSave={callback} onReset={callback} onReload={callback} onRetry={callback}/>);expect(screen.getByRole('alert')).toHaveTextContent('配置不属于当前档案');expect(screen.queryByLabelText('模型名称')).not.toBeInTheDocument();expect(callback).not.toHaveBeenCalled();owner.dispose();
  });
});
