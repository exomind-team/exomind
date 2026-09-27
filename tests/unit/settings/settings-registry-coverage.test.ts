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
    // ASR provider 已归一为火山-only。
    voiceShortcutAsrProvider: 'volcano',
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
  it('exposes the single top-level voice input group and removes legacy voice groups（顶层只保留快捷语音输入分组，移除旧语音入口）', () => {
    const topLevelIds = SETTINGS_REGISTRY.map((item) => item.id);

    expect(topLevelIds).toContain('voice-input-settings');
    // 常驻语音助手 / 实时语音子系统已删除，对应顶层分组不应再出现。
    expect(topLevelIds).not.toContain('voice-assistant-settings');
    expect(topLevelIds).not.toContain('voice-dialogue-settings');
    expect(topLevelIds).not.toContain('voice-diagnostics-settings');
  });

  it('keeps the critical voice input child settings and drops removed runtime/assistant rows（保留快捷语音输入关键子项，移除已删的助手/实时语音子项）', () => {
    const allIds = flattenAll(SETTINGS_REGISTRY).map((item) => item.id);

    [
      'voice-shortcut-enabled',
      'voice-input-provider-settings',
      'voice-transcript-send-mode',
      'voice-shortcut-send-mode',
      'voice-auto-record',
      'voice-shortcut-hotkey',
    ].forEach((id) => {
      expect(allIds).toContain(id);
    });

    [
      'voice-assistant-provider-settings',
      'voice-runtime-cloud-session-policy',
      'voice-runtime-auto-speak-enabled',
      'voice-runtime-doubao-app-id',
      'voice-runtime-omni-compatible-model',
      'voice-runtime-omni-api-key',
      'voice-omni-profile',
      'voice-omni-prompts',
    ].forEach((id) => {
      expect(allIds).not.toContain(id);
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
      'volcano-engine-key',
      'volcano-usage-summary',
      'volcano-asr-test',
      'ai-registry',
      'data-transfer',
      'instance-diagnostics',
      'device-pairing',
    ]);
  });

  it('gates provider-specific rows by volcano provider and developer mode（provider 定向配置受火山 provider 与开发者模式控制）', () => {
    const baseCtx = getBaseCtx();
    const baseIds = flattenVisible(getVisibleSettings(baseCtx), baseCtx).map((item) => item.id);
    const developerCtx = { ...baseCtx, developerMode: true };
    const developerIds = flattenVisible(getVisibleSettings(developerCtx), developerCtx).map((item) => item.id);

    // 火山 provider 下，火山配置项常驻可见。
    expect(baseIds).toContain('volcano-engine-key');
    expect(baseIds).toContain('volcano-endpoint');
    // 诊断项收口到开发者模式。
    expect(baseIds).not.toContain('volcano-asr-test');

    expect(developerIds).toContain('volcano-engine-key');
    expect(developerIds).toContain('volcano-asr-test');
  });

  it('keeps the inline developer toggle checklist in sync with its audited child settings（开发者分组内联开关清单与审计项保持一致）', async () => {
    const registryModule = await import('@/ui/app/config/settings/settings-registry');

    expect(registryModule.FEATURE_TOGGLE_SETTING_IDS).toEqual([
      'agent-page-enabled',
      'goals-page-enabled',
      'proposal-inbox-enabled',
      'desktop-adaptive',
      'command-palette-enabled',
    ]);
    expect(registryModule.FEATURE_TOGGLE_SETTINGS.map((item) => item.id)).toEqual(registryModule.FEATURE_TOGGLE_SETTING_IDS);
  });
});
