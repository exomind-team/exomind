import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(async () => false),
}));

import '../components/settings/setup-settings-mocks.tsx';
import { settingsPagePreferenceState } from '../components/settings/setup-settings-mocks.tsx';
import { getVisibleSettings, SETTINGS_REGISTRY } from '@/ui/app/config/settings/settings-registry';
import type { SettingsContext, SettingsItem } from '@/ui/app/config/settings/settings-types';

function getBaseCtx(): SettingsContext {
  return {
    isDesktop: false,
    isTauriWindow: false,
    developerMode: false,
    desktopAdaptiveEnabled: false,
    voiceShortcutAsrProvider: 'moss',
    voiceRuntimeProvider: 'doubao-o2-realtime',
    voiceRuntimeMode: 'push-to-talk',
  };
}

function flattenAll(items: SettingsItem[]): SettingsItem[] {
  return items.flatMap((item) => item.type === 'group'
    ? [item, ...flattenAll(item.children)]
    : [item]);
}

function flattenVisible(items: SettingsItem[], ctx: SettingsContext): SettingsItem[] {
  return items.flatMap((item) => {
    if (item.visible && !item.visible(ctx)) {
      return [];
    }
    if (item.type === 'group') {
      return [item, ...flattenVisible(item.children, ctx)];
    }
    return [item];
  });
}

describe('settings registry coverage audit', () => {
  it('exposes the new top-level voice groups and removes legacy voice groups（顶层语音分组替代旧入口）', () => {
    const topLevelIds = SETTINGS_REGISTRY.map((item) => item.id);

    expect(topLevelIds).toContain('voice-input-settings');
    expect(topLevelIds).toContain('voice-assistant-settings');
    expect(topLevelIds).not.toContain('voice-dialogue-settings');
    expect(topLevelIds).not.toContain('voice-diagnostics-settings');
  });

  it('keeps critical voice child settings inside the two capability groups（关键语音子项收口到两大能力组）', () => {
    const allIds = flattenAll(SETTINGS_REGISTRY).map((item) => item.id);

    [
      'voice-shortcut-enabled',
      'voice-input-provider-settings',
      'voice-transcript-send-mode',
      'voice-shortcut-send-mode',
      'voice-auto-record',
      'voice-shortcut-hotkey',
      'voice-assistant-provider-settings',
      'voice-runtime-cloud-session-policy',
      'voice-runtime-auto-speak-enabled',
      'voice-runtime-doubao-app-id',
      'voice-runtime-omni-compatible-model',
      'voice-runtime-omni-api-key',
    ].forEach((id) => {
      expect(allIds).toContain(id);
    });
  });

  it('limits custom escape hatches to the audited custom entries（custom 逃生舱保持在受审计范围内）', () => {
    const customIds = flattenAll(SETTINGS_REGISTRY)
      .filter((item): item is Extract<SettingsItem, { type: 'custom' }> => item.type === 'custom')
      .map((item) => item.id);

    expect(customIds).toEqual([
      'sound-preset',
      'focus-bgm',
      'voice-input-provider-settings',
      'voice-omni-profile',
      'voice-omni-prompts',
      'volcano-engine-key',
      'volcano-usage-summary',
      'moss-voice-test',
      'volcano-asr-test',
      'voice-assistant-provider-settings',
      'ai-registry',
      'data-transfer',
      'instance-diagnostics',
      'device-pairing',
    ]);
  });

  it('keeps provider-specific rows visible only in matching contexts（provider 定向配置只在匹配上下文可见）', () => {
    const mossIds = flattenVisible(getVisibleSettings(getBaseCtx()), getBaseCtx()).map((item) => item.id);
    const volcanoCtx = { ...getBaseCtx(), voiceShortcutAsrProvider: 'volcano' };
    const volcanoIds = flattenVisible(getVisibleSettings(volcanoCtx), volcanoCtx).map((item) => item.id);
    const qwenCtx = { ...getBaseCtx(), voiceShortcutAsrProvider: 'qwen-omni' };
    const qwenIds = flattenVisible(getVisibleSettings(qwenCtx), qwenCtx).map((item) => item.id);
    const developerQwenCtx = { ...qwenCtx, developerMode: true };
    const developerQwenIds = flattenVisible(getVisibleSettings(developerQwenCtx), developerQwenCtx).map((item) => item.id);

    expect(mossIds).toContain('moss-api-token');
    expect(mossIds).not.toContain('volcano-engine-key');
    expect(volcanoIds).toContain('volcano-engine-key');
    expect(volcanoIds).toContain('volcano-endpoint');
    expect(volcanoIds).not.toContain('moss-api-token');
    expect(qwenIds).not.toContain('voice-omni-profile');
    expect(qwenIds).not.toContain('voice-omni-model');
    expect(qwenIds).not.toContain('volcano-engine-key');
    expect(developerQwenIds).toContain('voice-omni-profile');
    expect(developerQwenIds).toContain('voice-omni-model');
    expect(developerQwenIds).not.toContain('volcano-engine-key');
  });

  it('switches provider config by runtime provider and keeps diagnostics out of registry children（provider 配置可切换且诊断入口不再挂在 registry 子项）', () => {
    const baseCtx = getBaseCtx();
    const omniCompatibleCtx = { ...getBaseCtx(), voiceRuntimeProvider: 'qwen-omni-compatible' };
    const omniRealtimeCtx = { ...getBaseCtx(), voiceRuntimeProvider: 'qwen-omni-realtime' };
    const developerOmniCompatibleCtx = { ...omniCompatibleCtx, developerMode: true };
    const developerOmniRealtimeCtx = { ...omniRealtimeCtx, developerMode: true };

    const baseIds = flattenVisible(getVisibleSettings(baseCtx), baseCtx).map((item) => item.id);
    const omniCompatibleIds = flattenVisible(getVisibleSettings(omniCompatibleCtx), omniCompatibleCtx).map((item) => item.id);
    const omniRealtimeIds = flattenVisible(getVisibleSettings(omniRealtimeCtx), omniRealtimeCtx).map((item) => item.id);
    const developerOmniCompatibleIds = flattenVisible(
      getVisibleSettings(developerOmniCompatibleCtx),
      developerOmniCompatibleCtx,
    ).map((item) => item.id);
    const developerOmniRealtimeIds = flattenVisible(
      getVisibleSettings(developerOmniRealtimeCtx),
      developerOmniRealtimeCtx,
    ).map((item) => item.id);

    expect(baseIds).not.toContain('voice-runtime-lab-nav-enabled');
    expect(baseIds).not.toContain('open-voice-runtime-lab');
    expect(omniCompatibleIds).not.toContain('voice-runtime-lab-nav-enabled');
    expect(omniRealtimeIds).not.toContain('open-voice-runtime-lab');

    expect(baseIds).toContain('voice-runtime-doubao-app-id');
    expect(omniCompatibleIds).not.toContain('voice-runtime-omni-compatible-model');
    expect(omniCompatibleIds).not.toContain('voice-runtime-doubao-app-id');
    expect(omniRealtimeIds).not.toContain('voice-runtime-omni-api-key');
    expect(omniRealtimeIds).not.toContain('voice-runtime-omni-model');
    expect(developerOmniCompatibleIds).toContain('voice-runtime-omni-compatible-model');
    expect(developerOmniCompatibleIds).not.toContain('voice-runtime-doubao-app-id');
    expect(developerOmniRealtimeIds).toContain('voice-runtime-omni-api-key');
    expect(developerOmniRealtimeIds).toContain('voice-runtime-omni-model');
  });

  it('keeps the inline developer toggle checklist in sync with its audited child settings（开发者分组内联开关清单与审计项保持一致）', async () => {
    const registryModule = await import('@/ui/app/config/settings/settings-registry');

    expect(registryModule.FEATURE_TOGGLE_SETTING_IDS).toEqual([
      'me-page-enabled',
      'agent-page-enabled',
      'goals-page-enabled',
      'proposal-inbox-enabled',
      'desktop-adaptive',
      'command-palette-enabled',
    ]);
    expect(registryModule.FEATURE_TOGGLE_SETTINGS.map((item) => item.id)).toEqual(registryModule.FEATURE_TOGGLE_SETTING_IDS);
  });
});
