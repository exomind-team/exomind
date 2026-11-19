import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { Bell } from 'lucide-react';
import { PageShell } from '@/ui/app/components/PageShell';
import { SettingsSection } from '@/ui/app/components/settings/settings-section';
import { Divider, SettingRow } from '@/ui/app/components/settings-shared';
import { Button } from '@/components/ui/button';
import { errorMessage } from './drafts';
import { resolveVersionBuildInfo } from '@/config/version-build-info';
import type { SettingsContext } from '@/ui/app/config/settings/settings-types';
import { DesktopSettingsLayout } from '@/ui/app/layouts/DesktopSettingsLayout';
import { MobileSettingsLayout } from '@/ui/app/layouts/MobileSettingsLayout';
import { useIsDesktop } from '@/ui/app/hooks/useIsDesktop';
import { betaAppVersion } from './app-identity';
import { deadlineAlertFailure, deadlineNotificationPermission, nativeBetaDeadlineAlertsClient, type BetaDeadlineAlertsClient, type BetaDeadlineAlertStatus } from './deadline-alert-client';
import { SummaryModelConfigurationController, type SummaryModelConfigurationService } from './summary-model-config';
import { BetaSummaryModelSettingsView } from './BetaSummaryModelSettingsView';
import { BetaRuntimeLocation } from './BetaRuntimeLocation';
import { betaDesktopPreferences } from './desktop-preferences';
import { BetaSettingsPanels, createBetaSettingsRegistry } from './settings-registry';
import { useBetaDesktopAdaptiveEnabled } from './preferences';
import { BetaDiagnosticsEntry } from './BetaDiagnosticsPanel';
import { createBetaDiagnosticsClient, type BetaDiagnosticsClient } from './diagnostics-client';

export function BetaSettingsPage({ profileName, profileId='', deviceId='', summaryModel, onDisconnect, onManageProfile, endpoint, deadlineAlerts, visible=true, diagnosticsClient }: { profileName: string; profileId?:string; deviceId?:string; summaryModel?:SummaryModelConfigurationService|null; onDisconnect?: () => void; onManageProfile?: () => void; endpoint?: string; deadlineAlerts?: BetaDeadlineAlertsClient | null; visible?:boolean; diagnosticsClient?:BetaDiagnosticsClient|null }) {
  const wide = useIsDesktop();
  const desktopLayout = useBetaDesktopAdaptiveEnabled() && wide;
  const native = isTauri();
  const android = native && /android/i.test(navigator.userAgent);
  const nativeDesktop = native && !/Android|iPhone|iPad/i.test(navigator.userAgent);
  const desktop = useSyncExternalStore(betaDesktopPreferences.subscribe, betaDesktopPreferences.get);
  const [desktopLoading, setDesktopLoading] = useState(nativeDesktop && !desktop);
  const [desktopError, setDesktopError] = useState('');
  const desktopFlight = useRef<Promise<void> | null>(null);
  const alive = useRef(true);
  const [fullscreen, setFullscreen] = useState(() => { try { return localStorage.getItem('exomind:mobileFullscreenEnabled') === 'true'; } catch { return false; } });
  const fullscreenValue = useRef(fullscreen); fullscreenValue.current = fullscreen;
  const fullscreenQueue = useRef<Promise<unknown>>(Promise.resolve());
  const [nativeAlerts] = useState(() => isTauri() ? nativeBetaDeadlineAlertsClient() : null);
  const [modelHost] = useState(() => document.createElement('div'));
  const [diagnosticsHost] = useState(() => document.createElement('div'));
  const [nativeDiagnostics] = useState(() => createBetaDiagnosticsClient());
  const [diagnosticsMounted,setDiagnosticsMounted] = useState(false);
  const diagnostics = diagnosticsClient === undefined ? nativeDiagnostics : diagnosticsClient;
  const alerts = deadlineAlerts === undefined ? nativeAlerts : deadlineAlerts;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  function refreshDesktop(): Promise<void> {
    if (desktopFlight.current) return desktopFlight.current;
    setDesktopLoading(true); setDesktopError('');
    const flight = betaDesktopPreferences.refresh().then(() => { if (alive.current) setDesktopError(''); })
      .catch(failure => { if (alive.current) setDesktopError(errorMessage(failure)); })
      .finally(() => { if (desktopFlight.current === flight) { desktopFlight.current = null; if (alive.current) setDesktopLoading(false); } });
    desktopFlight.current = flight; return flight;
  }
  useEffect(() => { if (nativeDesktop) void refreshDesktop(); }, [nativeDesktop]);
  const fullscreenBinding = useMemo(() => ({
    get: () => fullscreenValue.current,
    set: (enabled: boolean) => {
      const operation = fullscreenQueue.current.then(async () => {
        await invoke('mobile_fullscreen_set', { enabled });
        // Native has already applied this state. Keep it visible even if the
        // separate startup preference write fails; do not claim persistence.
        fullscreenValue.current = enabled; if (alive.current) setFullscreen(enabled);
        try { localStorage.setItem('exomind:mobileFullscreenEnabled', String(enabled)); }
        catch { throw new Error('本次全屏已应用，但下次启动偏好未能保存，请重试'); }
        return enabled;
      });
      fullscreenQueue.current = operation.catch(() => {}); return operation;
    },
  }), []);
  const build = resolveVersionBuildInfo(import.meta.env, betaAppVersion);
  const ctx = useMemo<SettingsContext>(() => ({
    isDesktop: desktopLayout, isLandscape: desktopLayout, isTauriWindow: native,
    copyText: async value => {
      if (native) await invoke('plugin:clipboard-manager|write_text', { text: value });
      else if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
      else throw new Error('当前环境无法自动复制，请手动选择文本');
    },
  }), [desktopLayout, native]);
  const items = useMemo(() => createBetaSettingsRegistry({
    nativeDesktop, android, desktopLoading, desktopError, profileName, profileId,
    appVersion: build.appVersion, buildHash: build.buildHash, fullscreen: fullscreenBinding,
    refreshDesktop, onManageProfile, onDisconnect,
  }).filter(item => !item.visible || item.visible(ctx)), [nativeDesktop, android, desktop, desktopLoading, desktopError, profileName, profileId, build.appVersion, build.buildHash, fullscreenBinding, onManageProfile, onDisconnect, ctx]);
  return <PageShell title="设置" contentClassName="overflow-y-auto">
    <div className="mx-auto max-w-3xl space-y-5 px-5 pb-8 pt-5 md:px-8 md:py-8">
      <BetaSettingsPanels.Provider value={{
        model: modelHost,
        alerts: <DeadlineAlertSettings client={alerts}/>,
        location: <BetaRuntimeLocation endpoint={endpoint}/>,
        diagnostics: diagnosticsHost,
        onDiagnosticsMount: setDiagnosticsMounted,
      }}>
        {desktopLayout ? <DesktopSettingsLayout items={items} ctx={ctx}/> : <MobileSettingsLayout items={items} ctx={ctx}/>}
      </BetaSettingsPanels.Provider>
      {createPortal(<SummaryModelSettings service={summaryModel??null} deviceId={deviceId} profileId={profileId} profileName={profileName}/>, modelHost, 'beta-settings-model')}
      {createPortal(<BetaDiagnosticsEntry client={diagnostics} visible={visible&&diagnosticsMounted}/>, diagnosticsHost, 'beta-settings-diagnostics')}
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
