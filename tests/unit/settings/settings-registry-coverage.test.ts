import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(async () => false),
}));

import '../components/settings/setup-settings-mocks.tsx';
import { settingsPagePreferenceState } from '../components/settings/setup-settings-mocks.tsx';
import {
  FEATURE_TOGGLE_SETTING_IDS,
  FEATURE_TOGGLE_SETTINGS,
  getVisibleSettings,
  SETTINGS_REGISTRY,
} from '@/ui/app/config/settings/settings-registry';
import type { SettingsContext } from '@/ui/app/config/settings/settings-types';

const AUDITED_SETTINGS_IDS = [
  'theme',
  'countdown-end-mode',
  'sound-preset',
  'focus-bgm',
  'feedback-content',
  'input-send-mode',
  'task-page-fuzzy-search',
  'task-create-success-action',
  'voice-transcript-send-mode',
  'voice-shortcut-send-mode',
  'voice-shortcut-hotkey',
  'main-window-shortcut',
  'main-window-shortcut-quick-focus',
  'voice-shortcut-asr-provider',
  'voice-shortcut-mic-prewarm',
  'voice-overlay-opacity',
  'voice-overlay-show-diagnostics',
  'voice-overlay-transcript-lines',
  'voice-overlay-bottom-offset',
  'now-workbench-overlay-enabled',
  'volcano-resource-model',
  'moss-api-token',
  'moss-voice-test',
  'volcano-asr-test',
  'ai-registry',
  'sync-server-url',
  'eventlog-backend-mode',
  'task-backend-mode',
  'timeblock-backend-mode',
  'data-transfer',
  'data-legacy-migration',
  'more-update',
  'more-help-center',
  'more-feedback',
  'more-telemetry',
  'more-report-bug',
  'more-debug-log',
  'about-website',
  'about-sponsor',
  'about-legal',
  'about-version',
  'about-build',
  'developer-mode',
  'use-mock-data',
  'devtools',
  'feature-toggles',
  'instance-diagnostics',
  'device-pairing',
  'clear-local-cache',
  'reset-all-settings',
] as const;

const INLINE_SINGLE_ENUM_IDS = [
  'theme',
  'input-send-mode',
  'task-create-success-action',
  'voice-transcript-send-mode',
  'voice-shortcut-send-mode',
  'voice-shortcut-hotkey',
  'voice-shortcut-asr-provider',
  'volcano-resource-model',
] as const;

const DIALOG_ENUM_IDS = [
  'countdown-end-mode',
  'sound-preset',
] as const;

const SELECT_ENUM_IDS = [] as const;

const MULTI_ENUM_IDS = [
  'feedback-content',
  'main-window-shortcut',
] as const;

const BOOLEAN_IDS = [
  'main-window-shortcut-quick-focus',
  'voice-shortcut-mic-prewarm',
  'task-page-fuzzy-search',
  'voice-overlay-show-diagnostics',
  'now-workbench-overlay-enabled',
  'developer-mode',
  'use-mock-data',
  'devtools',
] as const;

const NUMBER_IDS = [
  'voice-overlay-opacity',
  'voice-overlay-transcript-lines',
  'voice-overlay-bottom-offset',
] as const;

const ROW_ACTION_IDS = [
  'data-legacy-migration',
  'more-update',
  'more-help-center',
  'more-feedback',
  'more-telemetry',
  'more-report-bug',
  'more-debug-log',
  'about-website',
  'about-sponsor',
  'about-legal',
  'about-version',
  'about-build',
] as const;

const BUTTON_ACTION_IDS = [
  'clear-local-cache',
  'reset-all-settings',
] as const;

const CUSTOM_ITEM_IDS = [
  'focus-bgm',
  'moss-voice-test',
  'volcano-asr-test',
  'ai-registry',
  'data-transfer',
  'instance-diagnostics',
  'device-pairing',
] as const;

const DEV_ONLY_IDS = [
  'eventlog-backend-mode',
  'task-backend-mode',
  'timeblock-backend-mode',
  'use-mock-data',
  'devtools',
  'feature-toggles',
  'instance-diagnostics',
  'device-pairing',
] as const;

function getItem<T extends typeof SETTINGS_REGISTRY[number]['type']>(
  id: string,
  type: T,
): Extract<(typeof SETTINGS_REGISTRY)[number], { type: T }> {
  const item = SETTINGS_REGISTRY.find((entry) => entry.id === id);
  expect(item, `missing settings item: ${id}`).toBeDefined();
  expect(item?.type).toBe(type);
  return item as Extract<(typeof SETTINGS_REGISTRY)[number], { type: T }>;
}

function getBaseCtx(): SettingsContext {
  return {
    isDesktop: false,
    isTauriWindow: false,
    developerMode: false,
    desktopAdaptiveEnabled: false,
    voiceShortcutAsrProvider: 'moss',
  };
}

describe('settings registry coverage audit', () => {
  it('keeps the audited registry checklist in sync with all current settings items', () => {
    expect(SETTINGS_REGISTRY.map((item) => item.id)).toEqual(AUDITED_SETTINGS_IDS);
  });

  it('maps every standard registry item to an audited shared renderer family', () => {
    INLINE_SINGLE_ENUM_IDS.forEach((id) => {
      const item = getItem(id, 'enum');
      expect(item.multiSelect).not.toBe(true);
      expect(item.enumStyle).toBeUndefined();
    });

    DIALOG_ENUM_IDS.forEach((id) => {
      const item = getItem(id, 'enum');
      expect(item.multiSelect).not.toBe(true);
      expect(item.enumStyle).toBe('dialog');
    });

    SELECT_ENUM_IDS.forEach((id) => {
      const item = getItem(id, 'enum');
      expect(item.multiSelect).not.toBe(true);
      expect(item.enumStyle).toBe('select');
    });

    MULTI_ENUM_IDS.forEach((id) => {
      const item = getItem(id, 'enum');
      expect(item.multiSelect).toBe(true);
      expect(item.enumStyle).toBeUndefined();
    });

    BOOLEAN_IDS.forEach((id) => {
      const item = getItem(id, 'boolean');
      expect(typeof item.get).toBe('function');
      expect(typeof item.set).toBe('function');
    });

    NUMBER_IDS.forEach((id) => {
      const item = getItem(id, 'number');
      expect(typeof item.min).toBe('number');
      expect(typeof item.max).toBe('number');
      expect(typeof item.step).toBe('number');
    });

    ROW_ACTION_IDS.forEach((id) => {
      const item = getItem(id, 'action');
      expect(item.actionMode ?? 'row').toBe('row');
    });

    BUTTON_ACTION_IDS.forEach((id) => {
      const item = getItem(id, 'action');
      expect(item.actionMode).toBe('button');
      expect(item.buttonLabel).toBeTruthy();
    });

    const theme = getItem('theme', 'enum');
    expect(theme.options.map((option) => option.value)).toEqual(['light', 'system', 'dark']);
    expect(theme.options.every((option) => Boolean(option.icon))).toBe(true);

    const countdownEndMode = getItem('countdown-end-mode', 'enum');
    expect(countdownEndMode.options.every((option) => Boolean(option.description))).toBe(true);

    const soundPreset = getItem('sound-preset', 'enum');
    expect(soundPreset.dialogTitle).toBe('选择提示音');

    const volcanoResourceModel = getItem('volcano-resource-model', 'enum');
    expect(volcanoResourceModel.options.map((option) => option.label)).toEqual([
      '1.0 小时版',
      '1.0 并发版',
      '2.0 小时版',
      '2.0 并发版',
    ]);

    const mossApiToken = getItem('moss-api-token', 'string');
    expect(mossApiToken.stringStyle).toBe('dialog');
    expect(mossApiToken.dialogFieldKind).toBe('secret');
    expect(mossApiToken.allowClear).toBe(true);
    expect(mossApiToken.dialogFooterStart?.type).toBe('secret-toggle');

    const syncServerUrl = getItem('sync-server-url', 'string');
    expect(syncServerUrl.stringStyle).toBe('dialog');
    expect(syncServerUrl.dialogFieldKind).toBe('plain');
    expect(syncServerUrl.dialogInputType).toBe('url');

    const featureToggles = getItem('feature-toggles', 'group');
    expect(featureToggles.groupStyle).toBe('adaptive-overlay');
    expect(featureToggles.children.map((child) => child.id)).toEqual([
      'me-page-enabled',
      'agent-page-enabled',
      'desktop-adaptive',
      'command-palette-enabled',
    ]);

    const resetAllSettings = getItem('reset-all-settings', 'action');
    expect(resetAllSettings.confirmMessage).toBe('确认恢复所有默认设置？');
  });

  it('limits custom escape hatches to the explicitly audited special entries', () => {
    const customIds = SETTINGS_REGISTRY
      .filter((item): item is Extract<typeof SETTINGS_REGISTRY[number], { type: 'custom' }> => item.type === 'custom')
      .map((item) => item.id);

    expect(customIds).toEqual(CUSTOM_ITEM_IDS);
  });

  it('keeps developer-only and provider-sensitive entries behind their intended gates', () => {
    const baseIds = getVisibleSettings(getBaseCtx()).map((item) => item.id);
    const developerIds = getVisibleSettings({
      ...getBaseCtx(),
      developerMode: true,
    }).map((item) => item.id);
    const volcanoIds = getVisibleSettings({
      ...getBaseCtx(),
      developerMode: true,
      voiceShortcutAsrProvider: 'volcano',
    }).map((item) => item.id);

    DEV_ONLY_IDS.forEach((id) => {
      expect(baseIds).not.toContain(id);
      expect(developerIds).toContain(id);
    });

    // 语音测试项现已统一为“仅开发者模式可见”，不再受 provider 限制
    expect(baseIds).not.toContain('moss-voice-test');
    expect(developerIds).toContain('moss-voice-test');
    expect(volcanoIds).toContain('moss-voice-test');
    expect(baseIds).not.toContain('volcano-asr-test');
    expect(developerIds).toContain('volcano-asr-test');
    expect(volcanoIds).toContain('volcano-asr-test');

    // 资源模型仍然只在 volcano provider 下可见
    expect(baseIds).not.toContain('volcano-resource-model');
    expect(developerIds).not.toContain('volcano-resource-model');
    expect(volcanoIds).toContain('volcano-resource-model');
  });

  it('keeps every registry item reachable across supported settings contexts', () => {
    settingsPagePreferenceState.isTauriWindow = true;
    const contexts: SettingsContext[] = [
      getBaseCtx(),
      {
        ...getBaseCtx(),
        isDesktop: true,
        isTauriWindow: true,
      },
      {
        ...getBaseCtx(),
        developerMode: true,
      },
      {
        ...getBaseCtx(),
        isDesktop: true,
        isTauriWindow: true,
        developerMode: true,
        voiceShortcutAsrProvider: 'volcano',
      },
    ];

    const visibleIds = new Set(
      contexts.flatMap((ctx) => getVisibleSettings(ctx).map((item) => item.id)),
    );

    expect(Array.from(visibleIds).sort()).toEqual([...AUDITED_SETTINGS_IDS].sort());
  });

  it('keeps the feature toggles drawer checklist in sync with its audited child settings', () => {
    expect(FEATURE_TOGGLE_SETTING_IDS).toEqual([
      'me-page-enabled',
      'agent-page-enabled',
      'desktop-adaptive',
      'command-palette-enabled',
    ]);
    expect(FEATURE_TOGGLE_SETTINGS.map((item) => item.id)).toEqual(FEATURE_TOGGLE_SETTING_IDS);
    FEATURE_TOGGLE_SETTINGS.forEach((item) => {
      expect(typeof item.get).toBe('function');
      expect(typeof item.set).toBe('function');
      expect(typeof item.subscribe).toBe('function');
    });
  });
});
