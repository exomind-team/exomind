import { useEffect, useMemo, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { getDesktopAdaptiveEnabled, subscribeDesktopAdaptiveChanges } from '@/config/desktop-adaptive';
import { getDeveloperModeEnabled, subscribeDeveloperModeChanges } from '@/config/developer-mode';
import { parseMainWindowShortcutSelection, setMainWindowShortcutSelection } from '@/config/main-window-shortcut';
import {
  getEmbeddedRuntimeNetworkMode,
  getRuntimeTargetMode,
  isTauriWindow,
  subscribeEmbeddedRuntimeNetworkModeChanges,
  subscribeRuntimeTargetChanges,
} from '@/config/runtime-target';
import { getVoiceShortcutAsrProvider, subscribeVoiceShortcutAsrProviderChanges } from '@/config/voice-shortcut-asr-provider';
import { getVoiceRuntimeProvider, subscribeVoiceRuntimeProviderChanges } from '@/config/voice-runtime-settings';
import { getVoiceRuntimeMode, subscribeVoiceRuntimeModeChanges } from '@/config/voice-runtime-mode';
import { setVoiceShortcutHotkey } from '@/config/voice-shortcut-hotkey';
import { PageShell } from '@/ui/app/components/PageShell';
import { UserCard } from '@/ui/app/components/UserCard';
import { DesktopSettingsLayout } from '@/ui/app/layouts/DesktopSettingsLayout';
import { MobileSettingsLayout } from '@/ui/app/layouts/MobileSettingsLayout';
import { getVisibleSettings } from '@/ui/app/config/settings/settings-registry';
import type { SettingsContext } from '@/ui/app/config/settings/settings-types';
import { LogPanelDialog } from '@/ui/app/config/settings/LogPanelDialog';
import { useIsDesktop } from '@/ui/app/hooks/useIsDesktop';

/*
 * REGISTRY-DRIVEN SETTINGS PAGE
 *
 * This file must stay under 500 lines. All individual setting items are
 * declared in settings-registry.ts and rendered by shared renderers.
 *
 * If you need to add a new setting, add it to the registry — not here.
 */

function useSubscribed<T>(get: () => T, subscribe: (cb: (v: T) => void) => () => void): T {
  const [value, setValue] = useState(get);
  useEffect(() => subscribe(setValue), [subscribe]);
  return value;
}

function useSettingsContext(): SettingsContext {
  const isDesktop = useIsDesktop();
  const developerMode = useSubscribed(getDeveloperModeEnabled, subscribeDeveloperModeChanges);
  const desktopAdaptiveEnabled = useSubscribed(getDesktopAdaptiveEnabled, subscribeDesktopAdaptiveChanges);
  const voiceShortcutAsrProvider = useSubscribed(getVoiceShortcutAsrProvider, subscribeVoiceShortcutAsrProviderChanges);
  const voiceRuntimeProvider = useSubscribed(getVoiceRuntimeProvider, subscribeVoiceRuntimeProviderChanges);
  const voiceRuntimeMode = useSubscribed(getVoiceRuntimeMode, subscribeVoiceRuntimeModeChanges);
  const embeddedRuntimeNetworkMode = useSubscribed(
    getEmbeddedRuntimeNetworkMode,
    subscribeEmbeddedRuntimeNetworkModeChanges,
  );
  const runtimeTargetMode = useSubscribed(
    getRuntimeTargetMode,
    (listener) => subscribeRuntimeTargetChanges((target) => listener(target.mode)),
  );

  return useMemo<SettingsContext>(() => ({
    isDesktop,
    isTauriWindow: isTauriWindow(),
    isLandscape: isDesktop,
    developerMode,
    desktopAdaptiveEnabled,
    voiceShortcutAsrProvider,
    voiceRuntimeProvider,
    voiceRuntimeMode,
    embeddedRuntimeNetworkMode,
    runtimeTargetMode,
  }), [
    isDesktop,
    developerMode,
    desktopAdaptiveEnabled,
    voiceShortcutAsrProvider,
    voiceRuntimeProvider,
    voiceRuntimeMode,
    embeddedRuntimeNetworkMode,
    runtimeTargetMode,
  ]);
}

export function SettingsPage() {
  const ctx = useSettingsContext();
  const isDesktop = useIsDesktop();
  const desktopAdaptiveEnabled = useSubscribed(getDesktopAdaptiveEnabled, subscribeDesktopAdaptiveChanges);
  const isDesktopVcLayout = isDesktop && desktopAdaptiveEnabled;
  const items = useMemo(() => getVisibleSettings(ctx), [ctx]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (!(await isTauri())) return;

      invoke<string>('voice_shortcut_get')
        .then((hotkey) => {
          if (!cancelled && hotkey) {
            setVoiceShortcutHotkey(hotkey);
          }
        })
        .catch(() => {});

      invoke<string | null>('main_window_shortcut_get')
        .then((hotkey) => {
          if (cancelled) {
            return;
          }

          const selection = parseMainWindowShortcutSelection(hotkey);
          if (selection) {
            setMainWindowShortcutSelection(selection, { emitEvent: false, customized: false });
          }
        })
        .catch(() => {});
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (isDesktopVcLayout) {
    return (
      <>
        <PageShell title="设置" hideHeader contentClassName="h-full min-h-full">
          <div className="h-full min-h-full bg-page dark:bg-page-dark">
            <div className="mx-auto max-w-3xl px-8 py-8">
              <UserCard />
              <div className="mt-6">
                <DesktopSettingsLayout items={items} ctx={ctx} />
              </div>
            </div>
          </div>
        </PageShell>
        <LogPanelDialog />
      </>
    );
  }

  return (
    <>
      <PageShell title="设置" contentClassName="space-y-5 px-5 pb-[calc(env(safe-area-inset-bottom,0px)+108px)] pt-2">
        <div className="space-y-5 bg-page dark:bg-page-dark">
          <UserCard />
          <MobileSettingsLayout items={items} ctx={ctx} />
        </div>
      </PageShell>
      <LogPanelDialog />
    </>
  );
}
