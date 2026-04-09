import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(async () => false),
}));

import '../components/settings/setup-settings-mocks.tsx';
import { getVisibleSettings } from '@/ui/app/config/settings/settings-registry';
import type { SettingsContext } from '@/ui/app/config/settings/settings-types';

function getBaseCtx(): SettingsContext {
  return {
    isDesktop: false,
    isTauriWindow: false,
    developerMode: false,
    desktopAdaptiveEnabled: false,
    voiceShortcutAsrProvider: 'moss',
  };
}

describe('voice runtime settings registry（语音运行时设置注册）', () => {
  it('keeps experimental voice runtime entries behind developer mode（实验性语音运行时入口受开发者模式控制）', () => {
    const baseIds = getVisibleSettings(getBaseCtx()).map((item) => item.id);
    const developerDesktopIds = getVisibleSettings({
      ...getBaseCtx(),
      isDesktop: true,
      developerMode: true,
    }).map((item) => item.id);

    [
      'voice-runtime-enabled',
      'voice-runtime-mode',
      'voice-runtime-provider',
      'voice-runtime-cloud-session-policy',
      'voice-runtime-auto-speak-enabled',
      'voice-runtime-lab-nav-enabled',
      'open-voice-runtime-lab',
    ].forEach((id) => {
      expect(baseIds).not.toContain(id);
      expect(developerDesktopIds).toContain(id);
    });
  });
});
