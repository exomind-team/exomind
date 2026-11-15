import { useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { CalendarDays, Expand, Monitor, Moon, Sun } from 'lucide-react';
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

export function BetaSettingsPage({ profileName, onDisconnect }: { profileName: string; onDisconnect?: () => void }) {
  const theme = useBetaTheme();
  const dateMode = useBetaDateDisplayMode();
  const [error, setError] = useState('');
  const [fullscreen, setFullscreen] = useState(() => { try { return localStorage.getItem('exomind:mobileFullscreenEnabled') === 'true'; } catch { return false; } });
  const [displayBusy, setDisplayBusy] = useState(false);
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
      <SettingsSection title="当前档案">
        <SettingRow label="档案" right={<span className="max-w-[60%] truncate text-sm text-secondary">{profileName || '尚未选择'}</span>}/>
        <Divider/><SettingRow label="资料保存" right={<span className="text-sm text-secondary">先保存到本机</span>}/>
      </SettingsSection>
      <SettingsSection title="关于">
        <SettingRow label="外心 · Beta" right={<span className="text-xs text-muted">{build.appVersion} · {build.buildHash}</span>}/>
        <p className="px-4 pb-4 text-xs leading-relaxed text-muted">记录、原件与时间块使用本机独立资料目录。设备同步的记录与原件状态分别显示。</p>
      </SettingsSection>
      {onDisconnect && <Button variant="outline" onClick={onDisconnect}>断开当前服务</Button>}
    </div>
  </PageShell>;
}
