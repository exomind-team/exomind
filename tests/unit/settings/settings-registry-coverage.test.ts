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
  'task-dag-pan-speed',
  'task-dag-zoom-speed',
  'voice-transcript-send-mode',
  'voice-shortcut-send-mode',
  'voice-auto-record',
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
  'voice-omni-profile',
  'voice-omni-prompts',
  'voice-omni-model',
  'voice-omni-optimize',
  'volcano-engine-key',
  'volcano-usage-summary',
  'volcano-endpoint',
  'volcano-resource-model',
  'volcano-resource-id',
  'volcano-language',
  'moss-api-token',
  'moss-voice-test',
  'volcano-asr-test',
  'ai-registry',
  'runtime-target-mode',
  'embedded-runtime-open-mode',
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
  'me-page-enabled',
  'agent-page-enabled',
  'goals-page-enabled',
  'proposal-inbox-enabled',
  'desktop-adaptive',
  'command-palette-enabled',
  'instance-diagnostics',
  'device-pairing',
  'embedded-runtime-lan-no-auth',
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
  'runtime-target-mode',
  'embedded-runtime-open-mode',
  'volcano-endpoint',
  'volcano-language',
] as const;

const SELECT_ENUM_IDS = [] as const;

const MULTI_ENUM_IDS = [
  'feedback-content',
  'main-window-shortcut',
] as const;

const BOOLEAN_IDS = [
  'voice-auto-record',
  'main-window-shortcut-quick-focus',
  'voice-shortcut-mic-prewarm',
  'task-page-fuzzy-search',
  'voice-overlay-show-diagnostics',
  'now-workbench-overlay-enabled',
  'developer-mode',
  'use-mock-data',
  'devtools',
  'me-page-enabled',
  'agent-page-enabled',
  'goals-page-enabled',
  'proposal-inbox-enabled',
  'desktop-adaptive',
  'command-palette-enabled',
] as const;

const NUMBER_IDS = [
  'task-dag-pan-speed',
  'task-dag-zoom-speed',
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
  'sound-preset',
  'focus-bgm',
  'voice-omni-profile',
  'voice-omni-prompts',
  'volcano-engine-key',
  'volcano-usage-summary',
  'moss-voice-test',
  'volcano-asr-test',
  'ai-registry',
  'data-transfer',
  'instance-diagnostics',
  'device-pairing',
] as const;

const TAURI_DEV_ONLY_IDS = [
  'eventlog-backend-mode',
  'task-backend-mode',
  'timeblock-backend-mode',
] as const;

const DEV_ONLY_IDS = [
  'use-mock-data',
  'devtools',
  'me-page-enabled',
  'agent-page-enabled',
  'goals-page-enabled',
  'proposal-inbox-enabled',
  'desktop-adaptive',
  'command-palette-enabled',
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

    const soundPreset = getItem('sound-preset', 'custom');
    expect(soundPreset.label).toBe('提示音');

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

    const volcanoEngineKey = getItem('volcano-engine-key', 'custom');
    expect(volcanoEngineKey.label).toBe('火山引擎 Key');

    const volcanoResourceId = getItem('volcano-resource-id', 'string');
    expect(volcanoResourceId.stringStyle).toBe('dialog');
    expect(volcanoResourceId.dialogFieldKind).toBe('plain');

    const syncServerUrl = getItem('sync-server-url', 'string');
    expect(syncServerUrl.stringStyle).toBe('dialog');
    expect(syncServerUrl.dialogFieldKind).toBe('plain');
    expect(syncServerUrl.dialogInputType).toBe('text');

    const embeddedRuntimeOpenMode = getItem('embedded-runtime-open-mode', 'enum');
    expect(embeddedRuntimeOpenMode.options.map((option) => option.value)).toEqual(['local', 'lan']);
    expect(embeddedRuntimeOpenMode.visible?.({
      ...getBaseCtx(),
      isTauriWindow: false,
    })).toBe(false);
    expect(embeddedRuntimeOpenMode.visible?.({
      ...getBaseCtx(),
      isTauriWindow: true,
    })).toBe(true);

    const runtimeTargetMode = getItem('runtime-target-mode', 'enum');
    expect(runtimeTargetMode.options.map((option) => option.value)).toEqual(['embedded', 'external']);
    expect(runtimeTargetMode.visible?.({
      ...getBaseCtx(),
      isTauriWindow: false,
    })).toBe(false);
    expect(runtimeTargetMode.visible?.({
      ...getBaseCtx(),
      isTauriWindow: true,
    })).toBe(true);

    expect(getItem('me-page-enabled', 'boolean').category).toBe('developer');
    expect(getItem('agent-page-enabled', 'boolean').category).toBe('developer');
    expect(getItem('goals-page-enabled', 'boolean').category).toBe('developer');
    expect(getItem('proposal-inbox-enabled', 'boolean').category).toBe('developer');
    expect(getItem('desktop-adaptive', 'boolean').category).toBe('developer');
    expect(getItem('command-palette-enabled', 'boolean').category).toBe('developer');

    const clearLocalCache = getItem('clear-local-cache', 'action');
    expect(clearLocalCache.confirmMessage).toContain('确认清空本地缓存');

    const resetAllSettings = getItem('reset-all-settings', 'action');
    expect(resetAllSettings.confirmMessage).toContain('确认重置所有设置');

    const aboutVersion = getItem('about-version', 'action');
    expect(aboutVersion.hideChevron).toBe(true);
    expect(typeof aboutVersion.copyValue).toBe('function');

    const aboutBuild = getItem('about-build', 'action');
    expect(aboutBuild.hideChevron).toBe(true);
    expect(typeof aboutBuild.copyValue).toBe('function');
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
    const tauriDeveloperIds = getVisibleSettings({
      ...getBaseCtx(),
      developerMode: true,
      isTauriWindow: true,
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
    TAURI_DEV_ONLY_IDS.forEach((id) => {
      expect(baseIds).not.toContain(id);
      expect(developerIds).not.toContain(id);
      expect(tauriDeveloperIds).toContain(id);
    });

    expect(baseIds).toContain('moss-api-token');
    expect(developerIds).toContain('moss-api-token');
    expect(volcanoIds).not.toContain('moss-api-token');

    // MOSS 测试仍需要“开发者模式 + 当前引擎”
    expect(baseIds).not.toContain('moss-voice-test');
    expect(developerIds).toContain('moss-voice-test');
    expect(volcanoIds).not.toContain('moss-voice-test');

    // 火山测试入口需要“开发者模式 + 当前引擎”，配置字段仅受 provider 限制
    expect(baseIds).not.toContain('volcano-asr-test');
    expect(developerIds).not.toContain('volcano-asr-test');
    expect(volcanoIds).toContain('volcano-asr-test');

    [
      'volcano-engine-key',
      'volcano-endpoint',
      'volcano-resource-model',
      'volcano-resource-id',
      'volcano-language',
    ].forEach((id) => {
      expect(baseIds).not.toContain(id);
      expect(developerIds).not.toContain(id);
      expect(volcanoIds).toContain(id);
    });
  });

  it('keeps every registry item reachable across supported settings contexts', () => {
    settingsPagePreferenceState.isTauriWindow = true;
    settingsPagePreferenceState.isDesktopOperatingSystem = true;
    const contexts: SettingsContext[] = [
      getBaseCtx(),
      {
        ...getBaseCtx(),
        isDesktop: true,
        isTauriWindow: true,
        runtimeTargetMode: 'embedded',
        embeddedRuntimeNetworkMode: 'lan',
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
    settingsPagePreferenceState.isTauriWindow = false;
    settingsPagePreferenceState.isDesktopOperatingSystem = false;
  });

  it('keeps the inline developer toggle checklist in sync with its audited child settings（开发者分组内联开关清单与审计项保持一致）', () => {
    expect(FEATURE_TOGGLE_SETTING_IDS).toEqual([
      'me-page-enabled',
      'agent-page-enabled',
      'goals-page-enabled',
      'proposal-inbox-enabled',
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
