import { Volume2 } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Divider, SettingRow } from '@/ui/app/components/settings-shared';
import { SettingsSection } from '@/ui/app/components/settings/settings-section';
import { getTimerPreferences, subscribeTimerPreferencesChanges, updateTimerPreferences } from '@/config/timer-preferences';
import { useEffect, useState } from 'react';

export function BetaTimeblockEndSoundSetting({ visible }: { visible: boolean }) {
  const [enabled, setEnabled] = useState(() => getTimerPreferences().countdownEndSoundEnabled);
  useEffect(() => subscribeTimerPreferencesChanges(preferences => setEnabled(preferences.countdownEndSoundEnabled)), []);
  if (!visible) return null;
  return <SettingsSection title="本机提醒" testId="beta-timeblock-end-sound-settings">
    <SettingRow icon={<Volume2 className="size-4 text-muted"/>} label="时间块结束时播放应用内提示音" right={
      <Switch aria-label="本机时间块结束提示音" checked={enabled}
        onCheckedChange={value=>updateTimerPreferences({countdownEndSoundEnabled:value})}/>
    }/>
    <Divider/><p className="px-4 pb-3 text-xs leading-relaxed text-muted">此开关控制外心进程在这台电脑上播放的声音；Android 系统通知由系统通知通道独立控制。</p>
  </SettingsSection>;
}
