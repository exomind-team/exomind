import { selectField } from './select-field';
import { StrictMode } from 'react';
import { act,cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { BetaApp } from '@/beta/BetaApp';
import { BetaSettingsPage } from '@/beta/BetaSettingsPage';
import type { SummaryModelConfiguration,SummaryModelConfigurationCommand,SummaryModelConfigurationService } from '@/beta/summary-model-config';
import { asyncDraftLocks,deferred,fakeClient } from './fixtures';
import { memoryIntentJournal } from './timeblock-ui-fixtures';

vi.mock('@/config/llm-settings',()=>{throw new Error('Model registration must not load legacy LLM settings');});
vi.mock('@/lib/ai-registry/storage',()=>{throw new Error('Model registration must not load legacy registry storage');});
const P='11111111-1111-4111-8111-111111111111',Q='22222222-2222-4222-8222-222222222222',D='33333333-3333-4333-8333-333333333333',R='44444444-4444-4444-8444-444444444444',A='55555555-5555-4555-8555-555555555555',C='66666666-6666-4666-8666-666666666666';
const locks=Object.getOwnPropertyDescriptor(navigator,'locks');
function configuration(profile=P):SummaryModelConfiguration{return{profile_id:profile,revision:profile===P?A:C,enabled:false,include_suggestions:false,base_url:'http://127.0.0.1:4000/v1',model:profile===P?'P model':'Q model',has_api_key:true,max_output_tokens:2048,timeout_ms:60000};}
function receipt(profile:string,command:SummaryModelConfigurationCommand):SummaryModelConfiguration{return{...configuration(profile),revision:command.command_id,enabled:command.enabled,include_suggestions:command.include_suggestions,base_url:command.base_url,model:command.model,max_output_tokens:command.max_output_tokens,timeout_ms:command.timeout_ms,has_api_key:command.api_key.kind!=='clear'};}
function service(){return{read:vi.fn(async(profile:string)=>configuration(profile)),save:vi.fn(async(profile:string,command:SummaryModelConfigurationCommand)=>receipt(profile,command))}satisfies SummaryModelConfigurationService;}
function clientWith(model:SummaryModelConfigurationService){const client=fakeClient();client.status.mockResolvedValue({protocol:'exomind-beta/1',device_id:D,runtime_id:R,running:true});client.profiles.mockResolvedValue([{profile_id:P,display_name:'P'},{profile_id:Q,display_name:'Q'}]);return{...client,summaryModel:model};}
beforeEach(()=>{localStorage.clear();sessionStorage.clear();Object.defineProperty(navigator,'locks',{configurable:true,value:asyncDraftLocks()});});
afterEach(()=>{cleanup();localStorage.clear();vi.restoreAllMocks();if(locks)Object.defineProperty(navigator,'locks',locks);else Reflect.deleteProperty(navigator,'locks');});

describe('Beta settings own model editors independently of Record drafts',()=>{
  it('injects the active P service, retains model edits across navigation and leaves the mounted Record draft/journal untouched',async()=>{
    const model=service(),client=clientWith(model),journal=memoryIntentJournal();render(<BetaApp client={client} intentJournal={journal}/>);
    const input=await screen.findByRole('textbox',{name:'记录当下'});fireEvent.change(input,{target:{value:'Record draft stays separate'}});await screen.findByText('记录草稿已暂存 · 尚未提交');
    fireEvent.click(screen.getByRole('button',{name:'设置'}));const field=await screen.findByRole('textbox',{name:'模型名称'});await waitFor(()=>expect(field).toHaveValue('P model'));fireEvent.change(field,{target:{value:'Model draft only in this editor'}});
    expect(model.read).toHaveBeenCalledWith(P);expect(model.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'当下'}));expect(screen.getByRole('textbox',{name:'记录当下'})).toBe(input);expect(input).toHaveValue('Record draft stays separate');
    fireEvent.click(screen.getByRole('button',{name:'设置'}));expect(screen.getByRole('textbox',{name:'模型名称'})).toHaveValue('Model draft only in this editor');
    expect([...journal.values.values()].some(raw=>raw.includes('Model draft only in this editor'))).toBe(false);expect(client.capture).not.toHaveBeenCalled();
  });
  it('disposes an accepted P save before Q opens so its late reply cannot replace Q settings or the Record draft',async()=>{
    const model=service(),gate=deferred<SummaryModelConfiguration>(),client=clientWith(model),journal=memoryIntentJournal();model.save.mockReturnValueOnce(gate.promise);
    render(<BetaApp client={client} intentJournal={journal}/>);const input=await screen.findByRole('textbox',{name:'记录当下'});fireEvent.change(input,{target:{value:'P Record before model save'}});await screen.findByText('记录草稿已暂存 · 尚未提交');
    fireEvent.click(screen.getByRole('button',{name:'设置'}));const field=await screen.findByRole('textbox',{name:'模型名称'});await waitFor(()=>expect(field).toHaveValue('P model'));fireEvent.change(field,{target:{value:'P accepted pending model'}});fireEvent.click(screen.getByRole('button',{name:'保存回顾配置'}));await waitFor(()=>expect(model.save).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button',{name:'当下'}));const select=screen.getByRole('combobox',{name:'当前档案'});await waitFor(()=>expect(select).toBeEnabled());await selectField(select,Q);await waitFor(()=>expect(select).toHaveValue(Q));
    fireEvent.click(screen.getByRole('button',{name:'设置'}));await waitFor(()=>expect(screen.getByRole('textbox',{name:'模型名称'})).toHaveValue('Q model'));
    await act(async()=>{gate.resolve(receipt(P,model.save.mock.calls[0][1]));});expect(screen.getByRole('textbox',{name:'模型名称'})).toHaveValue('Q model');expect(screen.queryByText(/配置已保存；/)).not.toBeInTheDocument();
    expect(JSON.parse(journal.values.get(`exomind:beta:drafts:${D}`)!).drafts[P].text).toBe('P Record before model save');expect(model.save.mock.calls.map(([profile])=>profile)).toEqual([P]);
  });
  it('loads Q immediately instead of waiting for an obsolete P initial read, and ignores that read when it arrives',async()=>{
    const model=service(),gate=deferred<SummaryModelConfiguration>();model.read.mockImplementation(profile=>profile===P?gate.promise:Promise.resolve(configuration(Q)));
    const props={profileName:'P',profileId:P,deviceId:D,summaryModel:model,deadlineAlerts:null};const ui=render(<BetaSettingsPage {...props}/>);await waitFor(()=>expect(model.read).toHaveBeenCalledWith(P));
    ui.rerender(<BetaSettingsPage {...props} profileId={Q} profileName="Q"/>);await waitFor(()=>expect(screen.getByRole('textbox',{name:'模型名称'})).toHaveValue('Q model'));
    await act(async()=>{gate.resolve(configuration(P));});expect(screen.getByRole('textbox',{name:'模型名称'})).toHaveValue('Q model');expect(model.save).not.toHaveBeenCalled();
  });
  it('serializes same-scope StrictMode startup reads and never saves or calls a model on mount',async()=>{
    const model=service(),gate=deferred<SummaryModelConfiguration>();let active=0,maxActive=0;model.read.mockImplementation(async()=>{++active;maxActive=Math.max(maxActive,active);try{return await gate.promise;}finally{--active;}});
    render(<StrictMode><BetaSettingsPage profileName="P" profileId={P} deviceId={D} summaryModel={model} deadlineAlerts={null}/></StrictMode>);await waitFor(()=>expect(model.read).toHaveBeenCalled());
    expect(maxActive).toBe(1);await act(async()=>{gate.resolve(configuration(P));});await waitFor(()=>expect(screen.getByRole('textbox',{name:'模型名称'})).toHaveValue('P model'));expect(maxActive).toBe(1);expect(model.save).not.toHaveBeenCalled();
  });
  it('does not request configuration without a loaded local profile and reports an absent service honestly',()=>{
    const model=service();const ui=render(<BetaSettingsPage profileName="" deviceId={D} summaryModel={model} deadlineAlerts={null}/>);expect(screen.getByText(/请先选择并加载本机档案/)).toBeInTheDocument();expect(model.read).not.toHaveBeenCalled();
    ui.rerender(<BetaSettingsPage profileName="P" profileId={P} deviceId={D} deadlineAlerts={null}/>);expect(screen.getByText('当前连接尚未提供回顾模型配置。')).toBeInTheDocument();expect(model.save).not.toHaveBeenCalled();
  });
});
