import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { Bell, CalendarDays, Expand, Monitor, Moon, Sun } from 'lucide-react';
import { PageShell } from '@/ui/app/components/PageShell';
import { SettingsSection } from '@/ui/app/components/settings/settings-section';
import { Divider, SettingRow } from '@/ui/app/components/settings-shared';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import type { EventDateDisplayMode } from '@/lib/eventlog/format-event-timestamp';
import { errorMessage } from './drafts';
import { setBetaDateDisplayMode, setBetaTheme, useBetaDateDisplayMode, useBetaTheme, type BetaTheme } from './preferences';
import { resolveVersionBuildInfo } from '@/config/version-build-info';
import { version } from '../../package.json';
import { deadlineAlertFailure, deadlineNotificationPermission, nativeBetaDeadlineAlertsClient, type BetaDeadlineAlertsClient, type BetaDeadlineAlertStatus } from './deadline-alert-client';
import { SummaryModelConfigurationController, type SummaryModelConfigurationService } from './summary-model-config';
import { BetaSummaryModelSettingsView } from './BetaSummaryModelSettingsView';

export function BetaSettingsPage({ profileName, profileId='', deviceId='', summaryModel, onDisconnect, deadlineAlerts }: { profileName: string; profileId?:string; deviceId?:string; summaryModel?:SummaryModelConfigurationService|null; onDisconnect?: () => void; deadlineAlerts?: BetaDeadlineAlertsClient | null }) {
  const theme = useBetaTheme();
  const dateMode = useBetaDateDisplayMode();
  const [error, setError] = useState('');
  const [fullscreen, setFullscreen] = useState(() => { try { return localStorage.getItem('exomind:mobileFullscreenEnabled') === 'true'; } catch { return false; } });
  const [displayBusy, setDisplayBusy] = useState(false);
  const [nativeAlerts] = useState(() => isTauri() ? nativeBetaDeadlineAlertsClient() : null);
  const alerts = deadlineAlerts === undefined ? nativeAlerts : deadlineAlerts;
  const android = isTauri() && /android/i.test(navigator.userAgent);
  const choose = (change: () => void) => { try { change(); setError(''); } catch (failure) { setError(`显示设置未能保存：${errorMessage(failure)}`); } };
  async function setMobileFullscreen(enabled: boolean) {
    if (displayBusy) return;
    setDisplayBusy(true); setError('');
    try {
      await invoke('mobile_fullscreen_set', { enabled });
      setFullscreen(enabled);
      try { localStorage.setItem('exomind:mobileFullscreenEnabled', String(enabled)); }
      catch { setError('本次全屏显示已应用，下次启动设置未能保存，请稍后重试'); }
    } catch (failure) { setError(`全屏显示未能应用：${errorMessage(failure)}`); }
    finally { setDisplayBusy(false); }
  }
  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
  const build = resolveVersionBuildInfo(import.meta.env, version);
  return <PageShell title="设置" contentClassName="overflow-y-auto">
    <div className="mx-auto max-w-3xl space-y-5 px-5 pb-8 pt-5 md:px-8 md:py-8">
      <SettingsSection title="外观与显示">
        <SettingRow icon={<ThemeIcon className="size-4 text-muted"/>} label="外观主题" right={<Select value={theme} onValueChange={value => choose(() => setBetaTheme(value as BetaTheme))}>
          <SelectTrigger aria-label="外观主题" className="h-8 w-32"><SelectValue/></SelectTrigger>
          <SelectContent><SelectItem value="system">跟随系统</SelectItem><SelectItem value="light">浅色</SelectItem><SelectItem value="dark">深色</SelectItem></SelectContent>
        </Select>}/>
        <Divider/>
        <SettingRow icon={<CalendarDays className="size-4 text-muted"/>} label="记录日期" right={<Select value={dateMode} onValueChange={value => choose(() => setBetaDateDisplayMode(value as EventDateDisplayMode))}>
          <SelectTrigger aria-label="记录日期" className="h-8 w-32"><SelectValue/></SelectTrigger>
          <SelectContent><SelectItem value="compact">简略日期</SelectItem><SelectItem value="full">完整日期</SelectItem><SelectItem value="weekday">星期日期</SelectItem></SelectContent>
        </Select>}/>
        <p className="px-4 pb-3 text-xs text-muted">跨日、跨月和跨年会披露日期。点击记录旁的时间可切换完整与简略显示。</p>
        {android && <><Divider/><SettingRow icon={<Expand className="size-4 text-muted"/>} label="安卓全屏" right={<Switch aria-label="安卓全屏" checked={fullscreen} disabled={displayBusy} onCheckedChange={enabled => { void setMobileFullscreen(enabled); }}/>} /></>}
      </SettingsSection>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DeadlineAlertSettings client={alerts}/>
      <SettingsSection title="当前档案">
        <SettingRow label="档案" right={<span className="max-w-[60%] truncate text-sm text-secondary">{profileName || '尚未选择'}</span>}/>
        <Divider/><SettingRow label="资料保存" right={<span className="text-sm text-secondary">先保存到本机</span>}/>
      </SettingsSection>
      <SummaryModelSettings service={summaryModel??null} deviceId={deviceId} profileId={profileId} profileName={profileName}/>
      <SettingsSection title="关于">
        <SettingRow label="外心 · Beta" right={<span className="text-xs text-muted">{build.appVersion} · {build.buildHash}</span>}/>
        <p className="px-4 pb-4 text-xs leading-relaxed text-muted">记录、原件与时间块使用本机独立资料目录。设备同步的记录与原件状态分别显示。</p>
      </SettingsSection>
      {onDisconnect && <Button variant="outline" onClick={onDisconnect}>断开当前服务</Button>}
    </div>
  </PageShell>;
}

interface ModelEditorSlot {service:SummaryModelConfigurationService;deviceId:string;profileId:string;owner:SummaryModelConfigurationController;active:boolean}
function SummaryModelSettings({service,deviceId,profileId,profileName}:{service:SummaryModelConfigurationService|null;deviceId:string;profileId:string;profileName:string}){
  const [slot,setSlot]=useState<ModelEditorSlot|null>(null);
  const startup=useRef<{service:SummaryModelConfigurationService;deviceId:string;profileId:string;promise:Promise<void>}|null>(null);
  useEffect(()=>{
    if(!service||!deviceId||!profileId){setSlot(null);return;}
    const owner=new SummaryModelConfigurationController(service,deviceId,profileId);
    const current:ModelEditorSlot={service,deviceId,profileId,owner,active:true};setSlot(current);
    const prior=startup.current;const previous=prior&&prior.service===service&&prior.deviceId===deviceId&&prior.profileId===profileId?prior.promise:null;
    const promise=(async()=>{if(previous)await previous.catch(()=>{});if(current.active)await owner.load();})();
    startup.current={service,deviceId,profileId,promise};
    // Configuration drafts/entered keys are owned by this editor only. Their
    // lifetime never replaces or flushes the Record/Timeblock draft journal.
    return()=>{current.active=false;owner.dispose();};
  },[service,deviceId,profileId]);
  if(!service)return<SettingsSection title="回顾模型"><p className="px-4 py-4 text-xs text-secondary">当前连接尚未提供回顾模型配置。</p></SettingsSection>;
  if(!deviceId||!profileId)return<SettingsSection title="回顾模型"><p className="px-4 py-4 text-xs text-secondary">请先选择并加载本机档案，再配置回顾模型。</p></SettingsSection>;
  if(!slot?.active||slot.service!==service||slot.deviceId!==deviceId||slot.profileId!==profileId)return<SettingsSection title="回顾模型"><p role="status" className="px-4 py-4 text-xs text-secondary">正在读取当前档案的回顾配置…</p></SettingsSection>;
  return<ModelEditor owner={slot.owner} profileId={profileId} profileName={profileName}/>;
}
function ModelEditor({owner,profileId,profileName}:{owner:SummaryModelConfigurationController;profileId:string;profileName:string}){
  const state=useSyncExternalStore(owner.subscribe,owner.snapshot);
  return<BetaSummaryModelSettingsView profileId={profileId} profileName={profileName} state={state}
    onDraftChange={update=>{owner.edit(update);}} onSave={()=>{void owner.save();}} onReset={()=>owner.reset()}
    onReload={()=>{void owner.load();}} onRetry={()=>{void owner.retry();}}/>;
}

type AlertLifetime = { active: boolean };
function DeadlineAlertSettings({ client }: { client: BetaDeadlineAlertsClient | null }) {
  const [status, setStatus] = useState<BetaDeadlineAlertStatus | null>(null);
  const [busy, setBusy] = useState<'status' | 'permission' | null>(client ? 'status' : null);
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const lifetime = useRef<AlertLifetime>({ active: false });
  const flight = useRef<Promise<void> | null>(null);
  function current(owner: AlertLifetime) { return owner.active && lifetime.current === owner; }
  function read(owner: AlertLifetime, permission: boolean) {
    if (!client) return;
    const previous = flight.current;
    const operation = (async () => {
      // StrictMode and a replaced transport can leave one accepted read in
      // flight. Serialize behind it; a late result never updates a new owner.
      if (previous) await previous.catch(() => {});
      if (!current(owner)) return;
      setBusy(permission ? 'permission' : 'status'); setError(''); setNotice('');
      try {
        if (permission) {
          const result = await client.requestPermission();
          if (!current(owner)) return;
          setNotice(result.state === 'prompt' ? '请完成系统通知权限确认后刷新资格' : result.state === 'denied' ? '通知权限未允许' : result.state === 'unavailable' ? '当前环境无法申请通知权限' : result.state === 'granted' ? '通知权限已允许' : '权限请求结果尚未确认，请刷新资格');
        }
        const next = await client.status();
        if (current(owner)) setStatus(next);
      } catch {
        if (current(owner)) { setStatus(null); setError(deadlineAlertFailure(null)); }
      } finally { if (current(owner)) setBusy(null); }
    })();
    flight.current = operation;
    void operation.finally(() => { if (flight.current === operation) flight.current = null; }).catch(() => {});
  }
  useEffect(() => {
    const owner = { active: true }; lifetime.current = owner;
    setStatus(null); setError(''); setNotice(''); setBusy(client ? 'status' : null);
    read(owner, false);
    return () => { owner.active = false; };
  }, [client]);
  const unavailable = !client || status?.platform_state === 'unavailable';
  const platform = unavailable ? '当前环境不提供安卓系统提醒' : busy && !status ? '正在读取资格…' : !status ? '资格尚未确认' : status.platform_state === 'failed' ? '系统提醒需要处理' : '已读取系统提醒资格';
  return <SettingsSection title="安卓系统提醒" testId="beta-deadline-alert-settings">
    <SettingRow icon={<Bell className="size-4 text-muted"/>} label="系统提醒" right={<span role="status" className="max-w-[60%] text-right text-xs text-secondary">{platform}</span>}/>
    {!unavailable && status && <>
      <Divider/><SettingRow label="通知权限" right={<span className="text-sm text-secondary">{deadlineNotificationPermission(status.notification_permission)}</span>}/>
      <Divider/><SettingRow label="精确闹钟资格" right={<span className="text-sm text-secondary">{status.exact_alarm ? '具备' : '未具备'}</span>}/>
      <Divider/><SettingRow label="待处理提醒" right={<span className="text-sm text-secondary">{status.pending_count}</span>}/>
      <Divider/><SettingRow label="已登记提醒" right={<span className="text-sm text-secondary">{status.scheduled_count}</span>}/>
      <Divider/><SettingRow label="已投递提醒" right={<span className="text-sm text-secondary">{status.delivered_count}</span>}/>
      <Divider/><SettingRow label="后台保活" right={<span className="text-sm text-secondary">{status.keepalive_requested ? '已请求' : '未请求'}</span>}/>
      <p className="px-4 pb-3 text-xs leading-relaxed text-muted">保活已请求不代表后台服务正在运行。提醒仍受系统权限与电量策略影响，资格状态不代表准时送达。</p>
      {(status.last_error_code || status.platform_state === 'failed') && <p role="alert" className="px-4 pb-3 text-xs text-destructive">{deadlineAlertFailure(status.last_error_code)}</p>}
    </>}
    {client && <div className="flex flex-wrap gap-2 px-4 pb-3">
      <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => { if (!flight.current) read(lifetime.current, false); }}>{busy === 'status' ? '正在读取…' : '刷新提醒资格'}</Button>
      {!unavailable && status?.platform_state === 'ready' && status.notification_permission !== 'granted' && <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => { if (!flight.current) read(lifetime.current, true); }}>{busy === 'permission' ? '等待系统确认…' : '请求通知权限'}</Button>}
    </div>}
    {notice && <p role="status" className="px-4 pb-3 text-xs text-muted">{notice}</p>}
    {error && <p role="alert" className="px-4 pb-3 text-xs text-destructive">{error}</p>}
  </SettingsSection>;
}
