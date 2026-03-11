import { invoke, isTauri } from '@tauri-apps/api/core';
import { Bell, Bot, Code, Command, Download, Key, List, Mic, Monitor, Moon, MoonStar, Sun, SunMoon, Timer, Upload, Waypoints, Wifi } from 'lucide-react';
import type { SettingsContext, SettingsItem } from './settings-types';
import {
  getSyncServerUrlOverride,
  resolveSyncServerUrl,
  setSyncServerUrlOverride,
} from '@/config/port-env';
import {
  getThemePreference,
  setThemePreference,
  subscribeThemePreferenceChanges,
} from '@/config/theme';
import {
  getDeveloperModeEnabled,
  setDeveloperModeEnabled,
  subscribeDeveloperModeChanges,
} from '@/config/developer-mode';
import {
  getAgentPageEnabled,
  setAgentPageEnabled,
  subscribeAgentPageEnabledChanges,
} from '@/config/agent-page-enabled';
import {
  getDesktopAdaptiveEnabled,
  setDesktopAdaptiveEnabled,
  subscribeDesktopAdaptiveChanges,
} from '@/config/desktop-adaptive';
import {
  getUseMockDataEnabled,
  setUseMockDataEnabled,
  subscribeUseMockDataChanges,
} from '@/config/mock-data';
import {
  getDevtoolsEnabled,
  setDevtoolsEnabled,
  subscribeDevtoolsChanges,
} from '@/config/devtools-mode';
import { getLLMApiKey } from '@/config/llm-settings';
import {
  getCommandPaletteEnabled,
  setCommandPaletteEnabled,
  subscribeCommandPaletteEnabledChanges,
} from '@/config/command-palette-enabled';
import {
  getVoiceTranscriptSendMode,
  setVoiceTranscriptSendMode,
  subscribeVoiceTranscriptSendModeChanges,
} from '@/config/voice-transcript-send-mode';
import {
  getVoiceShortcutHotkey,
  setVoiceShortcutHotkey,
  subscribeVoiceShortcutHotkeyChanges,
  VOICE_SHORTCUT_HOTKEY_VALUES,
} from '@/config/voice-shortcut-hotkey';
import {
  getVoiceShortcutSendMode,
  setVoiceShortcutSendMode,
  subscribeVoiceShortcutSendModeChanges,
} from '@/config/voice-shortcut-send-mode';
import {
  getVoiceShortcutMicPrewarmEnabled,
  setVoiceShortcutMicPrewarmEnabled,
  subscribeVoiceShortcutMicPrewarmChanges,
} from '@/config/voice-shortcut-mic-prewarm';
import {
  DEFAULT_VOICE_OVERLAY_BOTTOM_OFFSET,
  getVoiceOverlayBottomOffset,
  getVoiceOverlayOpacity,
  getVoiceOverlayShowDiagnostics,
  getVoiceOverlayTranscriptLines,
  MAX_VOICE_OVERLAY_BOTTOM_OFFSET,
  MAX_VOICE_OVERLAY_OPACITY,
  MAX_VOICE_OVERLAY_TRANSCRIPT_LINES,
  MIN_VOICE_OVERLAY_BOTTOM_OFFSET,
  MIN_VOICE_OVERLAY_OPACITY,
  MIN_VOICE_OVERLAY_TRANSCRIPT_LINES,
  setVoiceOverlayBottomOffset,
  setVoiceOverlayOpacity,
  setVoiceOverlayShowDiagnostics,
  setVoiceOverlayTranscriptLines,
  subscribeVoiceOverlayBottomOffsetChanges,
  subscribeVoiceOverlayOpacityChanges,
  subscribeVoiceOverlayShowDiagnosticsChanges,
  subscribeVoiceOverlayTranscriptLinesChanges,
} from '@/config/voice-overlay-preferences';
import {
  getVoiceShortcutAsrProvider,
  getVoiceShortcutAsrProviderLabel,
  setVoiceShortcutAsrProvider,
  subscribeVoiceShortcutAsrProviderChanges,
} from '@/config/voice-shortcut-asr-provider';
import {
  DEFAULT_VOLCANO_RESOURCE_ID,
  VOLCANO_RESOURCE_PRESETS,
  getVolcanoResourceId,
  setVolcanoResourceId,
} from '@/lib/asr/volcano-config';
import {
  getFeedbackPreferences,
  setFeedbackPreferences,
  subscribeFeedbackPreferencesChanges,
} from '@/config/feedback-preferences';
import {
  getTimerPreferences,
  subscribeTimerPreferencesChanges,
  updateTimerPreferences,
  type CountdownEndMode,
} from '@/config/timer-preferences';
import { syncDevtoolsWithSettings } from '@/lib/debug/devtools-runtime';
import {
  TIMER_END_SOUND_PRESETS,
  type TimerEndSoundPresetId,
} from '@/lib/media/timer-end-sounds';
import {
  exportBackup,
  exportTasksJson,
  exportTasksSqlite,
  importBackup,
} from '@/services/impl/settings-data-service';
import {
  AiApiKeySetting,
  DevicePairingSetting,
  MossVoiceTestSetting,
  TaskBackendStatusSetting,
  TaskImportActionSetting,
  VolcanoVoiceTestSetting,
} from '@/ui/app/components/settings/settings-custom-items';

const MOSS_API_KEY_STORAGE_KEY = 'moss_api_key';

function normalizeMossApiKey(value: string): string {
  if (!value) {
    return '';
  }
  let normalized = value.trim();
  normalized = normalized.replace(/^['"]|['"]$/g, '');
  normalized = normalized.replace(/^Bearer\s+/i, '');
  return normalized.trim();
}

function readStoredMossApiKey(): string {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return '';
  }

  try {
    return normalizeMossApiKey(window.localStorage.getItem(MOSS_API_KEY_STORAGE_KEY) || '');
  } catch {
    return '';
  }
}

function writeStoredMossApiKey(value: string): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return;
  }

  const normalized = normalizeMossApiKey(value);
  if (!normalized) {
    window.localStorage.removeItem(MOSS_API_KEY_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(MOSS_API_KEY_STORAGE_KEY, normalized);
}

function maskStoredSecret(value: string): string {
  if (!value) {
    return '未配置';
  }
  if (value.length <= 6) {
    return `${value.slice(0, 2)}***`;
  }
  return `${value.slice(0, 4)}***${value.slice(-2)}`;
}

function getFeedbackContentSelection(): string[] {
  const preferences = getFeedbackPreferences();
  const values: string[] = [];

  if (preferences.timingInfoEnabled) values.push('timing');
  if (preferences.statisticsEnabled) values.push('statistics');
  if (preferences.quickFeedbackEnabled) values.push('quick');

  return values;
}

function setFeedbackContentSelection(values: string[]): void {
  setFeedbackPreferences({
    timingInfoEnabled: values.includes('timing'),
    statisticsEnabled: values.includes('statistics'),
    quickFeedbackEnabled: values.includes('quick'),
  });
}

function getResolvedSyncServerUrl(): string {
  return getSyncServerUrlOverride() ?? resolveSyncServerUrl(import.meta.env as Record<string, string | undefined>);
}

function normalizeSyncServerUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/, '');
  if (!normalized) {
    throw new Error('同步服务器地址不能为空');
  }

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error('同步服务器地址格式无效');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('同步服务器地址必须以 http:// 或 https:// 开头');
  }

  return normalized;
}

function validateSyncServerUrl(value: string): string | null {
  try {
    normalizeSyncServerUrl(value);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : '同步服务器地址格式无效';
  }
}

async function setVoiceShortcutHotkeyWithRuntime(value: string): Promise<void> {
  if (!await isTauri()) {
    setVoiceShortcutHotkey(value);
    return;
  }

  try {
    const appliedHotkey = await invoke<string>('voice_shortcut_set', { shortcut: value });
    setVoiceShortcutHotkey(appliedHotkey, { emitEvent: false });
  } catch (error) {
    const runtimeHotkey = await invoke<string>('voice_shortcut_get').catch(() => getVoiceShortcutHotkey());
    setVoiceShortcutHotkey(runtimeHotkey, { emitEvent: false });
    throw error;
  }
}

function formatVoiceShortcutTestId(value: string): string {
  return `new-settings-voice-shortcut-${value.toLowerCase().replace(/\+/g, '-').replace(/\s+/g, '')}`;
}

function devOnly(ctx: SettingsContext): boolean {
  return Boolean(ctx.developerMode);
}

function volcanoOnly(ctx: SettingsContext): boolean {
  return ctx.voiceShortcutAsrProvider === 'volcano';
}

function setDeveloperModeWithSideEffects(enabled: boolean): void {
  setDeveloperModeEnabled(enabled);
  if (!enabled) {
    setDevtoolsEnabled(false);
  }
  void syncDevtoolsWithSettings();
}

function setDevtoolsEnabledWithSync(enabled: boolean): void {
  setDevtoolsEnabled(enabled);
  void syncDevtoolsWithSettings();
}

function setUseMockDataAndReload(enabled: boolean): void {
  setUseMockDataEnabled(enabled);
  if (typeof window !== 'undefined' && window.location) {
    window.location.reload();
  }
}

export const FEATURE_TOGGLE_SETTING_IDS = [
  'agent-page-enabled',
  'desktop-adaptive',
  'command-palette-enabled',
] as const;

export const FEATURE_TOGGLE_SETTINGS = [
  {
    id: 'agent-page-enabled',
    label: '网络页面',
    icon: Waypoints,
    rowTestId: 'feature-toggle-agent-page-row',
    controlTestId: 'feature-toggle-agent-page-switch',
    get: getAgentPageEnabled,
    set: setAgentPageEnabled,
    subscribe: subscribeAgentPageEnabledChanges,
  },
  {
    id: 'desktop-adaptive',
    label: '桌面端适配',
    icon: Monitor,
    rowTestId: 'feature-toggle-desktop-adaptive-row',
    controlTestId: 'new-settings-desktop-adaptive-switch',
    get: getDesktopAdaptiveEnabled,
    set: setDesktopAdaptiveEnabled,
    subscribe: subscribeDesktopAdaptiveChanges,
  },
  {
    id: 'command-palette-enabled',
    label: '命令面板',
    icon: Command,
    rowTestId: 'feature-toggle-command-palette-row',
    controlTestId: 'feature-toggle-command-palette-switch',
    get: getCommandPaletteEnabled,
    set: setCommandPaletteEnabled,
    subscribe: subscribeCommandPaletteEnabledChanges,
  },
] as const;

export const SETTINGS_REGISTRY: SettingsItem[] = [
  {
    id: 'theme',
    label: '主题',
    icon: MoonStar,
    category: 'appearance',
    type: 'enum',
    options: [
      { label: '浅色', value: 'light', icon: Sun },
      { label: '自动', value: 'system', icon: SunMoon },
      { label: '深色', value: 'dark', icon: Moon },
    ],
    optionTestId: (value) => `new-settings-theme-${value}`,
    get: () => getThemePreference(),
    set: (value: string) => {
      setThemePreference(value as 'system' | 'light' | 'dark');
    },
    subscribe: subscribeThemePreferenceChanges,
  },
  {
    id: 'countdown-end-mode',
    label: '倒计时结束',
    icon: Timer,
    category: 'timer',
    type: 'enum',
    enumStyle: 'dialog',
    dialogTitle: '倒计时结束模式',
    dialogDescription: '选择倒计时结束后的行为',
    options: [
      {
        label: '硬停止',
        value: 'hard',
        description: '倒计时结束后立即停止',
      },
      {
        label: '柔和提醒',
        value: 'soft',
        description: '倒计时结束后继续计时并提醒',
      },
    ],
    get: () => getTimerPreferences().countdownEndMode,
    set: (value: string) => updateTimerPreferences({ countdownEndMode: value as CountdownEndMode }).countdownEndMode,
    subscribe: (cb: (value: string) => void) => subscribeTimerPreferencesChanges((preferences) => cb(preferences.countdownEndMode)),
  },
  {
    id: 'sound-preset',
    label: '提示音',
    icon: Bell,
    category: 'timer',
    type: 'enum',
    enumStyle: 'dialog',
    dialogTitle: '选择提示音',
    dialogDescription: '倒计时结束时播放的提示音',
    options: [
      {
        label: '关闭提示音',
        summaryLabel: '已关闭',
        value: 'off',
      },
      ...TIMER_END_SOUND_PRESETS.map((preset) => ({
        label: preset.label,
        value: preset.id,
      })),
    ],
    get: () => {
      const preferences = getTimerPreferences();
      return preferences.countdownEndSoundEnabled ? preferences.countdownEndSoundPresetId : 'off';
    },
    set: (value: string) => {
      if (value === 'off') {
        updateTimerPreferences({ countdownEndSoundEnabled: false });
        return 'off';
      }

      return updateTimerPreferences({
        countdownEndSoundEnabled: true,
        countdownEndSoundPresetId: value as TimerEndSoundPresetId,
      }).countdownEndSoundPresetId;
    },
    subscribe: (cb: (value: string) => void) => subscribeTimerPreferencesChanges((preferences) => {
      cb(preferences.countdownEndSoundEnabled ? preferences.countdownEndSoundPresetId : 'off');
    }),
  },
  {
    id: 'feedback-content',
    label: '反馈内容',
    icon: List,
    category: 'feedback',
    description: '可多选，默认仅开启快速反馈',
    rowTestId: 'new-settings-feedback-content-row',
    type: 'enum',
    multiSelect: true,
    options: [
      { label: '时刻信息', value: 'timing' },
      { label: '统计信息', value: 'statistics' },
      { label: '快速反馈', value: 'quick' },
    ],
    optionTestId: (value) => `new-settings-feedback-content-${value}`,
    get: getFeedbackContentSelection,
    set: setFeedbackContentSelection,
    subscribe: (cb) => subscribeFeedbackPreferencesChanges(() => cb(getFeedbackContentSelection())),
  },
  {
    id: 'voice-transcript-send-mode',
    label: '语音转写后',
    icon: Mic,
    category: 'input',
    description: '仅作用于「当下」页面输入框，默认插入输入框',
    rowTestId: 'new-settings-voice-transcript-mode-row',
    type: 'enum',
    options: [
      { label: '插入输入框', value: 'insert' },
      { label: '直接发送', value: 'direct-send' },
    ],
    optionTestId: (value) => `new-settings-voice-transcript-mode-${value}`,
    get: () => getVoiceTranscriptSendMode(),
    set: (value: string) => {
      setVoiceTranscriptSendMode(value as 'insert' | 'direct-send');
    },
    subscribe: subscribeVoiceTranscriptSendModeChanges,
  },
  {
    id: 'voice-shortcut-send-mode',
    label: '聊天与外部输入语音完成后',
    icon: Mic,
    category: 'input',
    rowTestId: 'new-settings-voice-shortcut-send-mode-row',
    type: 'enum',
    options: [
      { label: '仅插入文本', value: 'insert-only' },
      { label: '自动回车发送', value: 'auto-enter-send' },
    ],
    optionTestId: (value) => `new-settings-voice-shortcut-send-mode-${value}`,
    get: () => getVoiceShortcutSendMode(),
    set: (value: string) => {
      setVoiceShortcutSendMode(value as 'insert-only' | 'auto-enter-send');
    },
    subscribe: subscribeVoiceShortcutSendModeChanges,
  },
  {
    id: 'voice-shortcut-hotkey',
    label: '全局语音快捷键',
    icon: Mic,
    category: 'input',
    description: 'Shortcut Voice（快捷键语音）默认 Alt+Q，按一次开始再按一次结束',
    rowTestId: 'new-settings-voice-shortcut-row',
    type: 'enum',
    options: VOICE_SHORTCUT_HOTKEY_VALUES.map((value) => ({ label: value, value })),
    optionTestId: (value) => formatVoiceShortcutTestId(value),
    get: () => getVoiceShortcutHotkey(),
    set: async (value: string) => {
      await setVoiceShortcutHotkeyWithRuntime(value);
    },
    subscribe: subscribeVoiceShortcutHotkeyChanges,
    errorMessagePrefix: '全局语音快捷键切换失败',
  },
  {
    id: 'voice-shortcut-asr-provider',
    label: '快捷语音引擎',
    icon: Mic,
    category: 'input',
    rowTestId: 'new-settings-voice-provider-row',
    type: 'enum',
    options: [
      { label: 'MOSS', value: 'moss' },
      { label: '火山', value: 'volcano' },
    ],
    optionTestId: (value) => `new-settings-voice-provider-${value}`,
    get: () => getVoiceShortcutAsrProvider(),
    set: (value: string) => setVoiceShortcutAsrProvider(value as 'moss' | 'volcano'),
    subscribe: subscribeVoiceShortcutAsrProviderChanges,
    successMessage: (value: string) => `快捷语音引擎已切换为 ${getVoiceShortcutAsrProviderLabel(value as 'moss' | 'volcano')}`,
  },
  {
    id: 'voice-shortcut-mic-prewarm',
    label: '预启动麦克风',
    icon: Mic,
    category: 'input',
    rowTestId: 'new-settings-voice-prewarm-row',
    controlTestId: 'new-settings-voice-prewarm-switch',
    type: 'boolean',
    get: () => getVoiceShortcutMicPrewarmEnabled(),
    set: setVoiceShortcutMicPrewarmEnabled,
    subscribe: subscribeVoiceShortcutMicPrewarmChanges,
  },
  {
    id: 'voice-overlay-opacity',
    label: '悬浮窗透明度',
    icon: MoonStar,
    category: 'input',
    rowTestId: 'new-settings-voice-overlay-opacity-row',
    controlTestId: 'new-settings-voice-overlay-opacity-slider',
    type: 'number',
    min: MIN_VOICE_OVERLAY_OPACITY,
    max: MAX_VOICE_OVERLAY_OPACITY,
    step: 1,
    unit: '%',
    get: () => getVoiceOverlayOpacity(),
    set: setVoiceOverlayOpacity,
    subscribe: subscribeVoiceOverlayOpacityChanges,
  },
  {
    id: 'voice-overlay-show-diagnostics',
    label: '显示语音悬浮窗诊断信息',
    icon: Code,
    category: 'input',
    rowTestId: 'new-settings-voice-overlay-diagnostics-row',
    controlTestId: 'new-settings-voice-overlay-diagnostics-switch',
    type: 'boolean',
    get: () => getVoiceOverlayShowDiagnostics(),
    set: setVoiceOverlayShowDiagnostics,
    subscribe: subscribeVoiceOverlayShowDiagnosticsChanges,
  },
  {
    id: 'voice-overlay-transcript-lines',
    label: '悬浮窗实时文本行数',
    icon: List,
    category: 'input',
    rowTestId: 'new-settings-voice-overlay-transcript-lines-row',
    controlTestId: 'new-settings-voice-overlay-transcript-lines-slider',
    type: 'number',
    min: MIN_VOICE_OVERLAY_TRANSCRIPT_LINES,
    max: MAX_VOICE_OVERLAY_TRANSCRIPT_LINES,
    step: 1,
    formatValue: (value: number) => `${value} 行`,
    get: () => getVoiceOverlayTranscriptLines(),
    set: setVoiceOverlayTranscriptLines,
    subscribe: subscribeVoiceOverlayTranscriptLinesChanges,
  },
  {
    id: 'voice-overlay-bottom-offset',
    label: '悬浮窗距任务栏间距',
    icon: Waypoints,
    category: 'input',
    rowTestId: 'new-settings-voice-overlay-bottom-offset-row',
    controlTestId: 'new-settings-voice-overlay-bottom-offset-slider',
    type: 'number',
    min: MIN_VOICE_OVERLAY_BOTTOM_OFFSET,
    max: MAX_VOICE_OVERLAY_BOTTOM_OFFSET,
    step: 1,
    unit: 'px',
    get: () => getVoiceOverlayBottomOffset(),
    set: setVoiceOverlayBottomOffset,
    subscribe: subscribeVoiceOverlayBottomOffsetChanges,
  },
  {
    id: 'volcano-resource-model',
    label: '火山资源模型',
    icon: Mic,
    category: 'input',
    rowTestId: 'new-settings-volcano-resource-row',
    type: 'enum',
    visible: volcanoOnly,
    options: VOLCANO_RESOURCE_PRESETS.map((preset) => ({
      label: preset.label.replace(/^模型\s+/, ''),
      value: preset.value,
    })),
    optionTestId: (value) => `new-settings-volcano-resource-${value}`,
    helperText: (value: string) => `当前默认资源：${VOLCANO_RESOURCE_PRESETS.find((preset) => preset.value === value)?.label.replace(/^模型\s+/, '') ?? value}。`,
    get: () => getVolcanoResourceId() || DEFAULT_VOLCANO_RESOURCE_ID,
    set: (value: string) => setVolcanoResourceId(value),
  },
  {
    id: 'moss-api-token',
    label: 'MOSS API Token',
    icon: Key,
    category: 'input',
    rowTestId: 'new-settings-voice-token-row',
    type: 'string',
    stringStyle: 'dialog',
    sensitive: true,
    dialogFieldKind: 'secret',
    dialogFooterStart: {
      type: 'secret-toggle',
      showLabel: '显示 Token',
      hideLabel: '隐藏 Token',
    },
    dialogFooterEnd: '用于新 UI 语音输入转写',
    allowClear: true,
    placeholder: '输入 MOSS API Token',
    dialogTitle: '语音输入设置',
    dialogDescription: '配置 MOSS API Token（仅保存在当前设备）',
    emptyValueLabel: '未配置',
    get: readStoredMossApiKey,
    set: (value: string) => {
      const normalized = normalizeMossApiKey(value);
      writeStoredMossApiKey(normalized);
      return normalized;
    },
    mask: (value: string) => `已配置 (${maskStoredSecret(value)})`,
    successMessage: 'MOSS API Token 已保存',
    clearSuccessMessage: 'MOSS API Token 已清除',
  },
  {
    id: 'moss-voice-test',
    label: 'MOSS 语音测试',
    category: 'input',
    type: 'custom',
    visible: devOnly,
    component: MossVoiceTestSetting,
  },
  {
    id: 'volcano-asr-test',
    label: '火山引擎 ASR 测试',
    category: 'input',
    type: 'custom',
    visible: devOnly,
    component: VolcanoVoiceTestSetting,
  },
  {
    id: 'ai-api-key',
    label: 'AI API Key',
    category: 'ai',
    type: 'custom',
    component: AiApiKeySetting,
  },
  {
    id: 'sync-server-url',
    label: '同步服务器',
    icon: Wifi,
    category: 'sync',
    type: 'string',
    stringStyle: 'dialog',
    dialogFieldKind: 'plain',
    dialogInputType: 'url',
    placeholder: 'http://127.0.0.1:6984',
    dialogTitle: '同步服务器',
    dialogDescription: '设置事件日志同步的服务器地址',
    get: getResolvedSyncServerUrl,
    set: (value: string) => {
      const normalized = normalizeSyncServerUrl(value);
      setSyncServerUrlOverride(normalized);
      return normalized;
    },
    validate: validateSyncServerUrl,
    successMessage: (value: string) => `同步服务器地址已保存：${value}`,
  },
  {
    id: 'export-backup',
    label: '导出备份',
    icon: Download,
    category: 'data',
    type: 'action',
    onAction: () => exportBackup(),
    errorMessagePrefix: '导出失败',
  },
  {
    id: 'import-backup',
    label: '导入数据',
    icon: Upload,
    category: 'data',
    type: 'action',
    onAction: () => importBackup('merge'),
    errorMessagePrefix: '导入失败',
  },
  {
    id: 'export-tasks-json',
    label: '导出任务 JSON',
    icon: Download,
    category: 'data',
    type: 'action',
    visible: devOnly,
    onAction: () => exportTasksJson(),
    errorMessagePrefix: '任务导出失败',
  },
  {
    id: 'export-tasks-sqlite',
    label: '导出任务 SQLite',
    icon: Download,
    category: 'data',
    type: 'action',
    visible: devOnly,
    onAction: () => exportTasksSqlite(),
    errorMessagePrefix: '任务导出失败',
  },
  {
    id: 'import-tasks',
    label: '导入任务数据',
    category: 'data',
    type: 'custom',
    visible: devOnly,
    component: TaskImportActionSetting,
  },
  {
    id: 'developer-mode',
    label: '开发者模式',
    icon: Code,
    category: 'developer',
    type: 'boolean',
    description: '开启后可使用语音测试等实验功能',
    get: () => getDeveloperModeEnabled(),
    set: setDeveloperModeWithSideEffects,
    subscribe: subscribeDeveloperModeChanges,
  },
  {
    id: 'use-mock-data',
    label: '使用测试数据',
    icon: Code,
    category: 'developer',
    controlTestId: 'new-settings-use-mock-data-switch',
    type: 'boolean',
    visible: devOnly,
    get: () => getUseMockDataEnabled(),
    set: setUseMockDataAndReload,
    subscribe: subscribeUseMockDataChanges,
  },
  {
    id: 'devtools',
    label: '开发者工具',
    icon: Code,
    category: 'developer',
    controlTestId: 'new-settings-devtools-switch',
    type: 'boolean',
    visible: devOnly,
    get: () => getDevtoolsEnabled(),
    set: setDevtoolsEnabledWithSync,
    subscribe: subscribeDevtoolsChanges,
  },
  {
    id: 'feature-toggles',
    label: '功能开关',
    icon: Bot,
    category: 'developer',
    type: 'group',
    groupStyle: 'adaptive-overlay',
    dialogTitle: '功能开关',
    dialogDescription: '启用或关闭实验性功能',
    visible: devOnly,
    children: FEATURE_TOGGLE_SETTINGS.map((setting) => ({
      id: setting.id,
      label: setting.label,
      icon: setting.icon,
      category: 'developer',
      type: 'boolean' as const,
      rowTestId: setting.rowTestId,
      controlTestId: setting.controlTestId,
      get: setting.get,
      set: setting.set,
      subscribe: setting.subscribe,
    })),
  },
  {
    id: 'device-pairing',
    label: '设备配对',
    category: 'developer',
    type: 'custom',
    visible: devOnly,
    component: DevicePairingSetting,
  },
  {
    id: 'task-backend-status',
    label: '任务后端状态',
    category: 'developer',
    type: 'custom',
    visible: devOnly,
    component: TaskBackendStatusSetting,
  },
  {
    id: 'clear-local-cache',
    label: '清空本地缓存',
    description: '将清除设备上的临时设置与缓存',
    category: 'danger',
    type: 'action',
    actionMode: 'button',
    buttonLabel: '立即清空',
    onAction: () => '敬请期待',
  },
  {
    id: 'reset-all-settings',
    label: '重置所有设置',
    description: '恢复默认配置，不影响历史事件数据',
    category: 'danger',
    type: 'action',
    actionMode: 'button',
    buttonLabel: '恢复默认',
    confirmMessage: '确认恢复所有默认设置？',
    onAction: () => '敬请期待',
  },
];

export function getVisibleSettings(ctx: SettingsContext): SettingsItem[] {
  return SETTINGS_REGISTRY.filter((item) => !item.visible || item.visible(ctx));
}

export const DEFAULT_VOICE_OVERLAY_OFFSET = DEFAULT_VOICE_OVERLAY_BOTTOM_OFFSET;
export const DEFAULT_LLM_API_KEY = getLLMApiKey();
export const DEFAULT_VOLCANO_MODEL = DEFAULT_VOLCANO_RESOURCE_ID;
export const REGISTRY_VERSION = '2026-03-11';
