import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { resolveVersionBuildInfo } from '@/config/version-build-info';
import * as developerModeConfig from '@/config/developer-mode';
import * as desktopAdaptiveConfig from '@/config/desktop-adaptive';
import * as voiceProviderConfig from '@/config/voice-shortcut-asr-provider';
import { setVoiceShortcutHotkey } from '@/config/voice-shortcut-hotkey';
import { UserCard } from '@/ui/app/components/UserCard';
import { MoreSection } from '@/ui/app/components/MoreSection';
import { AboutSection } from '@/ui/app/components/AboutSection';
import { getVisibleSettings } from '@/ui/app/config/settings/settings-registry';
import type { SettingsContext } from '@/ui/app/config/settings/settings-types';
import { MobileSettingsLayout } from '@/ui/app/layouts/MobileSettingsLayout';
import { DesktopSettingsLayout } from '@/ui/app/layouts/DesktopSettingsLayout';
import { useNavigate } from '@tanstack/react-router';

const NOOP_SUBSCRIBE = () => () => {};

function useOptionalExternalValue<T>(
  getValue: () => T,
  subscribe?: (listener: (value: T) => void) => () => void,
): T {
  return useSyncExternalStore(
    subscribe ? (onStoreChange) => subscribe(() => onStoreChange()) : NOOP_SUBSCRIBE,
    getValue,
    getValue,
  );
}

function useIsDesktop(minWidth = 768): boolean {
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia(`(min-width: ${minWidth}px)`).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mediaQueryList = window.matchMedia(`(min-width: ${minWidth}px)`);
    const handleChange = (event: MediaQueryListEvent) => {
      setIsDesktop(event.matches);
    };

    setIsDesktop(mediaQueryList.matches);
    mediaQueryList.addEventListener('change', handleChange);
    return () => {
      mediaQueryList.removeEventListener('change', handleChange);
    };
  }, [minWidth]);

  return isDesktop;
}

function useIsLandscape(): boolean {
  const [isLandscape, setIsLandscape] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia('(orientation: landscape)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mediaQueryList = window.matchMedia('(orientation: landscape)');
    const handleChange = (event: MediaQueryListEvent) => {
      setIsLandscape(event.matches);
    };

    setIsLandscape(mediaQueryList.matches);
    mediaQueryList.addEventListener('change', handleChange);
    return () => {
      mediaQueryList.removeEventListener('change', handleChange);
    };
  }, []);

  return isLandscape;
}

/*
 * AGENT GUIDE: RUNTIME LOADING
 *
 * `SettingsPage` only builds `SettingsContext` and asks the registry which items are visible for the current device/runtime.
 *
 * For code outside the settings page:
 * - Do not read settings by reaching into `SettingsPage` or iterating the registry.
 * - Import the owning config/service module directly and subscribe there.
 *
 * The registry is a UI schema.
 * The config/service modules remain the source of truth.
 */
export function SettingsPage() {
  const envMap = import.meta.env as Record<string, string | undefined>;
  const versionBuildInfo = resolveVersionBuildInfo(envMap, '0.3.6');
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const isLandscape = useIsLandscape();
  const developerMode = useOptionalExternalValue(
    developerModeConfig.getDeveloperModeEnabled,
    developerModeConfig.subscribeDeveloperModeChanges,
  );
  const desktopAdaptiveEnabled = useOptionalExternalValue(
    desktopAdaptiveConfig.getDesktopAdaptiveEnabled,
    desktopAdaptiveConfig.subscribeDesktopAdaptiveChanges,
  );
  const voiceShortcutAsrProvider = useOptionalExternalValue(
    voiceProviderConfig.getVoiceShortcutAsrProvider,
    voiceProviderConfig.subscribeVoiceShortcutAsrProviderChanges,
  );
  const [comingSoonVisible, setComingSoonVisible] = useState(false);
  const comingSoonTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (comingSoonTimer.current) {
        clearTimeout(comingSoonTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (!await isTauri()) {
        return;
      }

      try {
        const runtimeHotkey = await invoke<string>('voice_shortcut_get');
        if (!cancelled) {
          setVoiceShortcutHotkey(runtimeHotkey);
        }
      } catch {
        // Keep the locally cached hotkey if runtime sync fails（运行时同步失败时保留本地快捷键）
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const ctx: SettingsContext = {
    isDesktop,
    isLandscape,
    developerMode,
    desktopAdaptiveEnabled,
    voiceShortcutAsrProvider,
  };
  const items = getVisibleSettings(ctx);

  const showComingSoon = () => {
    if (comingSoonTimer.current) {
      clearTimeout(comingSoonTimer.current);
    }
    setComingSoonVisible(true);
    comingSoonTimer.current = setTimeout(() => {
      setComingSoonVisible(false);
    }, 1500);
  };

  const aboutContent = (
    <>
      <MoreSection
        onNavigateUpdate={() => navigate({ to: '/update' })}
        onComingSoon={showComingSoon}
      />
      <AboutSection
        appVersion={versionBuildInfo.appVersion}
        buildHash={versionBuildInfo.buildHash}
        onOpenOfficialWebsite={() => {
          if (typeof window !== 'undefined') {
            window.open('https://exo-mind.ai/', '_blank', 'noopener,noreferrer');
          }
        }}
        onOpenSponsor={() => {
          if (typeof window !== 'undefined') {
            window.open('https://exo-mind.ai/', '_blank', 'noopener,noreferrer');
          }
        }}
        onOpenLegalSupport={() => navigate({ to: '/settings/legal-support' })}
      />
    </>
  );

  const useDesktopLayout = isDesktop && desktopAdaptiveEnabled;

  return (
    <div className="mx-auto min-h-full max-w-5xl px-4 py-6 md:px-10 md:py-8">
      {useDesktopLayout ? (
        <DesktopSettingsLayout items={items} ctx={ctx} aboutContent={aboutContent} />
      ) : (
        <div className="space-y-5">
          <UserCard />
          <MobileSettingsLayout items={items} ctx={ctx} />
          <MoreSection
            onNavigateUpdate={() => navigate({ to: '/update' })}
            onComingSoon={showComingSoon}
          />
          <AboutSection
            appVersion={versionBuildInfo.appVersion}
            buildHash={versionBuildInfo.buildHash}
            onOpenOfficialWebsite={() => {
              if (typeof window !== 'undefined') {
                window.open('https://exo-mind.ai/', '_blank', 'noopener,noreferrer');
              }
            }}
            onOpenSponsor={() => {
              if (typeof window !== 'undefined') {
                window.open('https://exo-mind.ai/', '_blank', 'noopener,noreferrer');
              }
            }}
            onOpenLegalSupport={() => navigate({ to: '/settings/legal-support' })}
          />
        </div>
      )}
      {comingSoonVisible ? (
        <div className="mt-4 text-center text-xs text-[#78716C]">敬请期待</div>
      ) : null}
    </div>
  );
}
