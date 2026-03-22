import { invoke, isTauri } from '@tauri-apps/api/core';
import {
  Activity,
  Bell,
  Bot,
  Bug,
  Code,
  Command,
  DatabaseZap,
  GitCommit,
  Globe,
  Heart,
  Key,
  LifeBuoy,
  List,
  MessageSquare,
  Mic,
  Monitor,
  Moon,
  MoonStar,
  Search,
  RefreshCw,
  ScrollText,
  Shield,
  Sun,
  SunMoon,
  Tag,
  Timer,
  UserRound,
  Waypoints,
  Wifi,
} from 'lucide-react';
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
  getMePageEnabled,
  setMePageEnabled,
  subscribeMePageEnabledChanges,
} from '@/config/me-page-enabled';
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
  getInputSendMode,
  setInputSendMode,
  subscribeInputSendModeChanges,
} from '@/config/input-send-mode';
import {
  getTaskPageFuzzySearchEnabled,
  setTaskPageFuzzySearchEnabled,
  subscribeTaskPageFuzzySearchChanges,
} from '@/config/task-page-fuzzy-search';
import {
  getTaskCreateSuccessAction,
  setTaskCreateSuccessAction,
  subscribeTaskCreateSuccessActionChanges,
} from '@/config/task-create-success-action';
import {
  getTaskDagPanSpeed,
  setTaskDagPanSpeed,
  subscribeTaskDagPanSpeedChanges,
  getTaskDagZoomSpeed,
  setTaskDagZoomSpeed,
  subscribeTaskDagZoomSpeedChanges,
  MIN_TASK_DAG_PAN_SPEED,
  MAX_TASK_DAG_PAN_SPEED,
  MIN_TASK_DAG_ZOOM_SPEED,
  MAX_TASK_DAG_ZOOM_SPEED,
} from '@/config/task-dag-keyboard-preferences';
import {
  getVoiceShortcutHotkey,
  setVoiceShortcutHotkey,
  subscribeVoiceShortcutHotkeyChanges,
  VOICE_SHORTCUT_HOTKEY_VALUES,
} from '@/config/voice-shortcut-hotkey';
import {
  MAIN_WINDOW_SHORTCUT_OPTION_VALUES,
  getMainWindowShortcutSelection,
  setMainWindowShortcutSelection,
  subscribeMainWindowShortcutSelectionChanges,
  validateMainWindowShortcutSelection,
  type MainWindowShortcutSelection,
} from '@/config/main-window-shortcut';
import {
  getMainWindowShortcutQuickFocusEnabled,
  setMainWindowShortcutQuickFocusEnabled,
  subscribeMainWindowShortcutQuickFocusChanges,
} from '@/config/main-window-shortcut-focus';
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
  getNowWorkbenchOverlayEnabled,
  setNowWorkbenchOverlayEnabled,
  subscribeNowWorkbenchOverlayEnabledChanges,
} from '@/config/now-workbench-overlay-preferences';
import {
  getVoiceShortcutAsrProvider,
  getVoiceShortcutAsrProviderLabel,
  setVoiceShortcutAsrProvider,
  subscribeVoiceShortcutAsrProviderChanges,
} from '@/config/voice-shortcut-asr-provider';
import {
  DEFAULT_VOLCANO_RESOURCE_ID,
  VOLCANO_ENDPOINT_OPTIONS,
  VOLCANO_LANGUAGE_OPTIONS,
  VOLCANO_RESOURCE_PRESETS,
} from '@/lib/asr/volcano-config';
import {
  getVolcanoEndpointSetting,
  getVolcanoLanguageSetting,
  getVolcanoResourceIdSetting,
  setVolcanoEndpointSetting,
  setVolcanoLanguageSetting,
  setVolcanoResourceIdSetting,
  subscribeVolcanoEndpointChanges,
  subscribeVolcanoLanguageChanges,
  subscribeVolcanoResourceIdChanges,
} from '@/config/volcano-asr-settings';
import {
  getVoiceAutoRecordEnabled,
  setVoiceAutoRecordEnabled,
  subscribeVoiceAutoRecordChanges,
} from '@/config/voice-auto-record';
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
import { isMigrationCompleted, clearMigrationFlags } from '@/lib/migration/legacy-migration-flags';
import {
  TIMER_END_SOUND_PRESETS,
  type TimerEndSoundPresetId,
} from '@/lib/media/timer-end-sounds';
import { resolveVersionBuildInfo } from '@/config/version-build-info';
import { openExternalUrl } from '@/lib/utils/open-external';
import { isDesktopOperatingSystem } from '@/config/runtime-target';
import {
  DataTransferSetting,
  DevInstanceDiagnosticsSetting,
  DevicePairingSetting,
  FocusBgmSetting,
  MossVoiceTestSetting,
  VolcanoEngineKeySetting,
  VolcanoVoiceTestSetting,
} from '@/ui/app/components/settings/settings-custom-items';
import { AIRegistrySetting } from '@/ui/app/components/settings/ai-registry-settings-card';
import {
  getEventlogBackendMode,
  setEventlogBackendMode,
  getTaskBackendMode,
  setTaskBackendMode,
  getTimeblockBackendMode,
  setTimeblockBackendMode,
} from '@/config/domain-backend-mode';
import { syncMainWindowShortcutSelectionWithRuntime } from '@/services/main-window-shortcut-runtime';

/*
 * AGENT GUIDE: ADDING SETTINGS
 *
 * This file is the single registry for settings-page exposure.
 *
 * Add a new setting by:
 * 1. Picking an existing `SettingsItem` family from `settings-types.ts`.
 * 2. Wiring `get` / `set` / `subscribe` to the real config/service module that owns the value.
 * 3. Adding `visible` gating here if the item is dev-only or provider-specific.
 * 4. Reusing existing shared renderer families before considering `custom`.
 *
 * Do not read settings elsewhere by importing this registry and scanning it.
 * Product/runtime code should import the owning config/service module directly.
 */

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
  const mainWindowShortcutStatus = validateMainWindowShortcutSelection(
    getMainWindowShortcutSelection(),
    getVoiceShortcutHotkey(),
  );
  if (
    mainWindowShortcutStatus.kind === 'valid'
    && mainWindowShortcutStatus.hotkey.toLowerCase() === value.trim().toLowerCase()
  ) {
    throw new Error(`与主窗口快捷键 ${mainWindowShortcutStatus.hotkey} 冲突`);
  }

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

async function setMainWindowShortcutSelectionWithRuntime(value: string[]): Promise<string[]> {
  const normalized = setMainWindowShortcutSelection(value as MainWindowShortcutSelection);
  await syncMainWindowShortcutSelectionWithRuntime({
    notify: true,
    selection: normalized,
  });

  return normalized;
}

function getMainWindowShortcutHelperText(value: string[]): string {
  const status = validateMainWindowShortcutSelection(
    value as MainWindowShortcutSelection,
    getVoiceShortcutHotkey(),
  );
  if (status.kind === 'valid') {
    return `当前生效：${status.hotkey}。按下后显示并聚焦主窗口；若主窗口已聚焦则最小化。`;
  }
  return status.message;
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

function mossOnly(ctx: SettingsContext): boolean {
  return ctx.voiceShortcutAsrProvider === 'moss';
}

function desktopOperatingSystemOnly(): boolean {
  return isDesktopOperatingSystem();
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

function resolveVersionText(): string {
  if (typeof import.meta === 'undefined') return '0.3.6';
  const envMap = import.meta.env as Record<string, string | undefined>;
  return resolveVersionBuildInfo(envMap, '0.3.6').appVersion;
}

function resolveBuildText(): string {
  if (typeof import.meta === 'undefined') return 'dev';
  const envMap = import.meta.env as Record<string, string | undefined>;
  return resolveVersionBuildInfo(envMap, '0.3.6').buildHash || 'dev';
}

function clearExomindLocalCache(): string {
  if (typeof window === 'undefined') {
    return '当前环境不支持清空本地缓存';
  }

  const keysToRemove: string[] = [];
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith('exomind:')) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // Ignore localStorage cleanup failures.
  }

  try {
    window.sessionStorage.clear();
  } catch {
    // Ignore sessionStorage cleanup failures.
  }

  window.setTimeout(() => {
    window.location.reload();
  }, 0);

  return '已清空本地缓存，页面正在刷新。';
}

function resetAllSettings(): string {
  if (typeof window === 'undefined') {
    return '当前环境不支持重置设置';
  }

  try {
    window.localStorage.clear();
  } catch {
    // Ignore localStorage cleanup failures.
  }

  try {
    window.sessionStorage.clear();
  } catch {
    // Ignore sessionStorage cleanup failures.
  }

  window.setTimeout(() => {
    window.location.reload();
  }, 0);

  return '已重置所有设置，页面正在刷新。';
}

export const FEATURE_TOGGLE_SETTING_IDS = [
  'me-page-enabled',
  'agent-page-enabled',
  'desktop-adaptive',
  'command-palette-enabled',
] as const;

export const FEATURE_TOGGLE_SETTINGS = [
  {
    id: 'me-page-enabled',
    label: 'Me 页面',
    icon: UserRound,
    rowTestId: 'feature-toggle-me-page-row',
    controlTestId: 'feature-toggle-me-page-switch',
    get: getMePageEnabled,
    set: setMePageEnabled,
    subscribe: subscribeMePageEnabledChanges,
  },
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

/*
 * AGENT GUIDE: REGISTRY RULES
 *
 * Notes for future agents:
 * - IDs should stay stable because tests, analytics, and future migrations may rely on them.
 * - `rowTestId` / `controlTestId` / `optionTestId` belong here so tests can follow the public settings schema.
 * - If a new entry visually matches an existing setting family in dev, extend that family instead of adding a new custom shell.
 * - `group` is preferred over `custom` for "tap row -> open overlay -> edit several child settings" flows.
 */
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
    id: 'focus-bgm',
    label: '专注背景音',
    category: 'timer',
    type: 'custom',
    component: FocusBgmSetting,
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
    id: 'input-send-mode',
    label: '输入框发送方式',
    icon: Key,
    category: 'input',
    description: '统一控制「任务 / 当下」输入框使用 Enter 发送还是 Ctrl/Cmd+Enter 发送',
    rowTestId: 'new-settings-input-send-mode-row',
    type: 'enum',
    options: [
      { label: 'Enter 发送', value: 'enter-send' },
      { label: 'Ctrl+Enter 发送', value: 'ctrl-enter-send' },
    ],
    optionTestId: (value) => `new-settings-input-send-mode-${value}`,
    get: () => getInputSendMode(),
    set: (value: string) => {
      setInputSendMode(value as 'enter-send' | 'ctrl-enter-send');
    },
    subscribe: subscribeInputSendModeChanges,
  },
  {
    id: 'task-page-fuzzy-search',
    label: '任务页输入框模糊搜索',
    icon: Search,
    category: 'input',
    description: '仅作用于任务页；开启后会用输入框第一行对任务标题做防抖模糊过滤',
    rowTestId: 'new-settings-task-page-fuzzy-search-row',
    controlTestId: 'new-settings-task-page-fuzzy-search-switch',
    type: 'boolean',
    get: () => getTaskPageFuzzySearchEnabled(),
    set: (value: boolean) => setTaskPageFuzzySearchEnabled(value),
    subscribe: subscribeTaskPageFuzzySearchChanges,
  },
  {
    id: 'task-create-success-action',
    label: '创建任务后',
    icon: List,
    category: 'input',
    description: '仅作用于任务页快速添加；默认继续回焦，也可切换为直接打开新建任务详情',
    rowTestId: 'new-settings-task-create-success-action-row',
    type: 'enum',
    options: [
      { label: '继续快速输入', value: 'refocus' },
      { label: '打开任务详情', value: 'open-detail' },
    ],
    optionTestId: (value) => `new-settings-task-create-success-action-${value}`,
    get: () => getTaskCreateSuccessAction(),
    set: (value: string) => {
      setTaskCreateSuccessAction(value as 'refocus' | 'open-detail');
    },
    subscribe: subscribeTaskCreateSuccessActionChanges,
  },
  {
    id: 'task-dag-pan-speed',
    label: '任务依赖图键盘移动速度',
    icon: Waypoints,
    category: 'input',
    description: '仅作用于任务依赖图；控制方向键与无焦点 WASD 的画布移动速度（单位：px/s）。',
    rowTestId: 'new-settings-task-dag-pan-speed-row',
    controlTestId: 'new-settings-task-dag-pan-speed-slider',
    type: 'number',
    min: MIN_TASK_DAG_PAN_SPEED,
    max: MAX_TASK_DAG_PAN_SPEED,
    step: 5,
    unit: 'px/s',
    get: () => getTaskDagPanSpeed(),
    set: setTaskDagPanSpeed,
    subscribe: subscribeTaskDagPanSpeedChanges,
  },
  {
    id: 'task-dag-zoom-speed',
    label: '任务依赖图键盘缩放速度',
    icon: Waypoints,
    category: 'input',
    description: '仅作用于任务依赖图；控制 Z / Shift+Z 的连续缩放速度（单位：%/s）。',
    rowTestId: 'new-settings-task-dag-zoom-speed-row',
    controlTestId: 'new-settings-task-dag-zoom-speed-slider',
    type: 'number',
    min: MIN_TASK_DAG_ZOOM_SPEED,
    max: MAX_TASK_DAG_ZOOM_SPEED,
    step: 5,
    unit: '%/s',
    get: () => getTaskDagZoomSpeed(),
    set: setTaskDagZoomSpeed,
    subscribe: subscribeTaskDagZoomSpeedChanges,
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
    id: 'voice-auto-record',
    label: '语音输入自动记录',
    icon: Mic,
    category: 'input',
    description: '默认开启；关闭后全局语音快捷键识别结果不会自动写入事件日志。',
    rowTestId: 'new-settings-voice-auto-record-row',
    controlTestId: 'new-settings-voice-auto-record-switch',
    type: 'boolean',
    get: () => getVoiceAutoRecordEnabled(),
    set: setVoiceAutoRecordEnabled,
    subscribe: subscribeVoiceAutoRecordChanges,
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
    id: 'main-window-shortcut',
    label: '主窗口全局快捷键',
    icon: Monitor,
    category: 'input',
    description: '多选组合键；Ctrl / Alt 为修饰键，Q / E / Space 中必须且只能选择一个',
    rowTestId: 'new-settings-main-window-shortcut-row',
    type: 'enum',
    multiSelect: true,
    visible: desktopOperatingSystemOnly,
    options: MAIN_WINDOW_SHORTCUT_OPTION_VALUES.map((value) => ({ label: value, value })),
    optionTestId: (value) => `new-settings-main-window-shortcut-${value.toLowerCase()}`,
    get: () => getMainWindowShortcutSelection(),
    set: async (value: string[]) => {
      return await setMainWindowShortcutSelectionWithRuntime(value);
    },
    subscribe: subscribeMainWindowShortcutSelectionChanges,
    helperText: (value: string[]) => getMainWindowShortcutHelperText(value),
  },
  {
    id: 'main-window-shortcut-quick-focus',
    label: '唤起后快速聚焦输入',
    icon: Search,
    category: 'input',
    description: '关闭时仅显示并聚焦主窗口；开启后会在当下记录页或任务主页面进一步聚焦输入框',
    rowTestId: 'new-settings-main-window-shortcut-quick-focus-row',
    controlTestId: 'new-settings-main-window-shortcut-quick-focus-switch',
    type: 'boolean',
    visible: desktopOperatingSystemOnly,
    get: () => getMainWindowShortcutQuickFocusEnabled(),
    set: (value: boolean) => setMainWindowShortcutQuickFocusEnabled(value),
    subscribe: subscribeMainWindowShortcutQuickFocusChanges,
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
    id: 'now-workbench-overlay-enabled',
    label: '启用当下工作台悬浮窗',
    icon: Monitor,
    category: 'input',
    description: '开启后会在桌面最上层显示固定尺寸的当下工作台悬浮窗，关闭后完全隐藏。',
    rowTestId: 'new-settings-now-overlay-enabled-row',
    controlTestId: 'new-settings-now-overlay-enabled-switch',
    type: 'boolean',
    get: () => getNowWorkbenchOverlayEnabled(),
    set: setNowWorkbenchOverlayEnabled,
    subscribe: subscribeNowWorkbenchOverlayEnabledChanges,
  },
  {
    id: 'volcano-engine-key',
    label: '火山引擎 Key',
    category: 'input',
    type: 'custom',
    visible: volcanoOnly,
    component: VolcanoEngineKeySetting,
  },
  {
    id: 'volcano-endpoint',
    label: '火山识别模式',
    icon: Mic,
    category: 'input',
    rowTestId: 'new-settings-volcano-endpoint-row',
    type: 'enum',
    visible: volcanoOnly,
    enumStyle: 'dialog',
    dialogTitle: '火山识别模式',
    dialogDescription: '选择火山语音识别调用模式',
    options: VOLCANO_ENDPOINT_OPTIONS.map((option) => ({
      label: option.label,
      value: option.value,
      description: option.description,
    })),
    optionTestId: (value) => `new-settings-volcano-endpoint-${value}`,
    helperText: (value: string) => VOLCANO_ENDPOINT_OPTIONS.find((option) => option.value === value)?.description ?? null,
    get: () => getVolcanoEndpointSetting(),
    set: (value: string) => setVolcanoEndpointSetting(value as (typeof VOLCANO_ENDPOINT_OPTIONS)[number]['value']),
    subscribe: subscribeVolcanoEndpointChanges,
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
    get: () => getVolcanoResourceIdSetting() || DEFAULT_VOLCANO_RESOURCE_ID,
    set: (value: string) => setVolcanoResourceIdSetting(value),
    subscribe: subscribeVolcanoResourceIdChanges,
  },
  {
    id: 'volcano-resource-id',
    label: '火山 Resource ID',
    icon: Mic,
    category: 'input',
    rowTestId: 'new-settings-volcano-resource-id-row',
    type: 'string',
    visible: volcanoOnly,
    stringStyle: 'dialog',
    dialogFieldKind: 'plain',
    placeholder: 'volc.seedasr.sauc.duration',
    dialogTitle: '火山 Resource ID',
    dialogDescription: '可直接输入完整的火山 Resource ID，自定义资源时优先使用这里。',
    emptyValueLabel: '未配置',
    get: getVolcanoResourceIdSetting,
    set: setVolcanoResourceIdSetting,
    subscribe: subscribeVolcanoResourceIdChanges,
    successMessage: '火山 Resource ID 已保存',
  },
  {
    id: 'volcano-language',
    label: '火山识别语言',
    icon: Mic,
    category: 'input',
    rowTestId: 'new-settings-volcano-language-row',
    type: 'enum',
    visible: volcanoOnly,
    enumStyle: 'dialog',
    dialogTitle: '火山识别语言',
    dialogDescription: '选择火山语音识别语言；当前主要在部分模式下生效。',
    options: VOLCANO_LANGUAGE_OPTIONS.map((option) => ({
      label: option.label,
      value: option.value,
    })),
    optionTestId: (value) => `new-settings-volcano-language-${value}`,
    get: getVolcanoLanguageSetting,
    set: setVolcanoLanguageSetting,
    subscribe: subscribeVolcanoLanguageChanges,
  },
  {
    id: 'moss-api-token',
    label: 'MOSS API Token',
    icon: Key,
    category: 'input',
    rowTestId: 'new-settings-voice-token-row',
    type: 'string',
    visible: mossOnly,
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
    visible: (ctx) => devOnly(ctx) && mossOnly(ctx),
    component: MossVoiceTestSetting,
  },
  {
    id: 'volcano-asr-test',
    label: '火山引擎 ASR 测试',
    category: 'input',
    type: 'custom',
    visible: (ctx) => devOnly(ctx) && volcanoOnly(ctx),
    component: VolcanoVoiceTestSetting,
  },
  {
    id: 'ai-registry',
    label: 'AI Registry',
    category: 'ai',
    type: 'custom',
    component: AIRegistrySetting,
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
    id: 'eventlog-backend-mode',
    label: '事件日志后端',
    icon: DatabaseZap,
    category: 'data',
    type: 'enum',
    enumStyle: 'dialog',
    dialogTitle: '事件日志后端',
    dialogDescription: '切换后页面将自动刷新',
    visible: devOnly,
    options: [
      { label: 'RT SQLite', value: 'rt-sqlite', description: '推荐，使用本地 SQLite 存储' },
      { label: 'Legacy', value: 'legacy', description: '旧版 JSON 文件存储' },
    ],
    get: getEventlogBackendMode,
    set: (value: string) => { setEventlogBackendMode(value as 'legacy' | 'rt-sqlite'); window.location.reload(); },
  },
  {
    id: 'task-backend-mode',
    label: '任务后端',
    icon: DatabaseZap,
    category: 'data',
    type: 'enum',
    enumStyle: 'dialog',
    dialogTitle: '任务后端',
    dialogDescription: '切换后页面将自动刷新',
    visible: devOnly,
    options: [
      { label: 'RT SQLite', value: 'rt-sqlite', description: '推荐，使用本地 SQLite 存储' },
      { label: 'Legacy', value: 'legacy', description: '旧版 JSON 文件存储' },
    ],
    get: getTaskBackendMode,
    set: (value: string) => { setTaskBackendMode(value as 'legacy' | 'rt-sqlite'); window.location.reload(); },
  },
  {
    id: 'timeblock-backend-mode',
    label: '时间块后端',
    icon: DatabaseZap,
    category: 'data',
    type: 'enum',
    enumStyle: 'dialog',
    dialogTitle: '时间块后端',
    dialogDescription: '切换后页面将自动刷新',
    visible: devOnly,
    options: [
      { label: 'RT SQLite', value: 'rt-sqlite', description: '推荐，使用本地 SQLite 存储' },
      { label: 'Legacy', value: 'legacy', description: '旧版 JSON 文件存储' },
    ],
    get: getTimeblockBackendMode,
    set: (value: string) => { setTimeblockBackendMode(value as 'legacy' | 'rt-sqlite'); window.location.reload(); },
  },
  {
    id: 'data-transfer',
    label: '数据迁移',
    category: 'data',
    type: 'custom',
    component: DataTransferSetting,
  },
  {
    id: 'data-legacy-migration',
    label: '迁移旧版数据',
    description: '将旧版存储中的数据迁移到本地 SQLite',
    category: 'data',
    type: 'action',
    icon: DatabaseZap,
    visible: (ctx) => {
      if (!ctx.isDesktop) return false;
      try {
        return !isMigrationCompleted();
      } catch {
        return false;
      }
    },
    onAction: () => {
      try {
        clearMigrationFlags();
        window.location.reload();
      } catch {
        // ignore
      }
    },
  },
  {
    id: 'more-update',
    label: '更新',
    icon: RefreshCw,
    category: 'more',
    type: 'action',
    onAction: () => {
      window.location.pathname = '/update';
    },
  },
  {
    id: 'more-help-center',
    label: '帮助中心',
    icon: LifeBuoy,
    category: 'more',
    type: 'action',
    onAction: () => openExternalUrl('https://github.com/exomind-team/exomind/wiki'),
  },
  {
    id: 'more-feedback',
    label: '反馈建议',
    icon: MessageSquare,
    category: 'more',
    type: 'action',
    onAction: () => openExternalUrl('https://github.com/exomind-team/exomind/issues/new?labels=feedback&template=feedback.md'),
  },
  {
    id: 'more-telemetry',
    label: '遥测',
    icon: Activity,
    category: 'more',
    type: 'action',
    onAction: () => '敬请期待',
  },
  {
    id: 'more-report-bug',
    label: '报告问题',
    icon: Bug,
    category: 'more',
    type: 'action',
    onAction: () => openExternalUrl('https://github.com/exomind-team/exomind/issues/new?labels=bug&template=bug_report.md'),
  },
  {
    id: 'more-debug-log',
    label: '调试日志',
    icon: ScrollText,
    category: 'more',
    type: 'action',
    onAction: () => {
      window.dispatchEvent(new CustomEvent('open-log-panel'))
      return undefined
    },
  },
  {
    id: 'about-website',
    label: '官网',
    icon: Globe,
    category: 'about',
    type: 'action',
    onAction: () => openExternalUrl('https://exo-mind.ai/'),
  },
  {
    id: 'about-sponsor',
    label: '赞助开发者（Starlin）',
    icon: Heart,
    category: 'about',
    type: 'action',
    onAction: () => openExternalUrl('https://exo-mind.ai/'),
  },
  {
    id: 'about-legal',
    label: '法律与支持',
    icon: Shield,
    category: 'about',
    type: 'action',
    onAction: () => {
      window.location.pathname = '/settings/legal-support';
    },
  },
  {
    id: 'about-version',
    label: '版本',
    icon: Tag,
    category: 'about',
    type: 'action',
    hideChevron: true,
    rightText: resolveVersionText,
    copyValue: resolveVersionText,
    copySuccessMessage: '已复制版本号',
    onAction: () => {},
  },
  {
    id: 'about-build',
    label: '构建',
    icon: GitCommit,
    category: 'about',
    type: 'action',
    hideChevron: true,
    rightText: resolveBuildText,
    copyValue: resolveBuildText,
    copySuccessMessage: '已复制构建号',
    onAction: () => {},
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
    id: 'instance-diagnostics',
    label: '实例诊断信息',
    category: 'developer',
    type: 'custom',
    visible: devOnly,
    component: DevInstanceDiagnosticsSetting,
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
    id: 'clear-local-cache',
    label: '清空本地缓存',
    description: '清除 UI 偏好与临时缓存，不影响事件日志、任务和时间块数据',
    category: 'danger',
    type: 'action',
    actionMode: 'button',
    buttonLabel: '立即清空',
    confirmMessage: '确认清空本地缓存？UI 偏好（DAG 布局、搜索选项、模式记忆等）将恢复默认。事件日志、任务和时间块数据不受影响。',
    onAction: clearExomindLocalCache,
  },
  {
    id: 'reset-all-settings',
    label: '重置所有设置',
    description: '将所有设置项恢复为默认值，不影响事件日志、任务和时间块数据',
    category: 'danger',
    type: 'action',
    actionMode: 'button',
    buttonLabel: '恢复默认',
    confirmMessage: '确认重置所有设置？所有配置（含 API Key、快捷键、UI 偏好）将恢复默认。事件日志、任务和时间块数据不受影响。',
    onAction: resetAllSettings,
  },
];

export function getVisibleSettings(ctx: SettingsContext): SettingsItem[] {
  return SETTINGS_REGISTRY.filter((item) => !item.visible || item.visible(ctx));
}

export const DEFAULT_VOICE_OVERLAY_OFFSET = DEFAULT_VOICE_OVERLAY_BOTTOM_OFFSET;
export const DEFAULT_LLM_API_KEY = getLLMApiKey();
export const DEFAULT_VOLCANO_MODEL = DEFAULT_VOLCANO_RESOURCE_ID;
export const REGISTRY_VERSION = '2026-03-11';
