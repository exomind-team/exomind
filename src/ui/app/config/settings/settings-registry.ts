import { invoke, isTauri } from '@tauri-apps/api/core';
import packageJson from '../../../../../package.json';
import {
  Activity,
  Bot,
  Bug,
  Code,
  Command,
  DatabaseZap,
  GitCommit,
  Globe,
  Heart,
  Inbox,
  Key,
  LifeBuoy,
  List,
  MessageSquare,
  Mic,
  Monitor,
  Moon,
  MoonStar,
  Orbit,
  Search,
  RefreshCw,
  ScrollText,
  Shield,
  History,
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
  EMBEDDED_RUNTIME_STATUS_STORAGE_KEY,
  DEFAULT_EXTERNAL_RUNTIME_PORT,
  formatRuntimeTargetAddress,
  getEmbeddedRuntimeAllowLanWithoutAuth,
  getEmbeddedRuntimeNetworkMode,
  getRuntimeExternalAddress,
  getRuntimeTargetMode,
  isTauriWindow,
  isDesktopOperatingSystem,
  parseRuntimeAddress,
  subscribeEmbeddedRuntimeAllowLanWithoutAuthChanges,
  subscribeRuntimeTargetChanges,
  subscribeEmbeddedRuntimeNetworkModeChanges,
} from '@/config/runtime-target';
import {
  RUNTIME_CONFIG_FRONTEND_IMPORT_KEYS,
  RUNTIME_CONFIG_FRONTEND_IMPORT_PREFIXES,
} from '@/config/runtime-config-adapter';
import {
  removeRuntimeConfigValue,
  removeRuntimeConfigValuesByPrefixes,
} from '@/config/runtime-config-cache';
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
  getApiAgentTabEnabled,
  setApiAgentTabEnabled,
  subscribeApiAgentTabEnabledChanges,
} from '@/config/api-agent-tab-enabled';
import {
  getMePageEnabled,
  setMePageEnabled,
  subscribeMePageEnabledChanges,
} from '@/config/me-page-enabled';
import {
  getGoalsPageEnabled,
  setGoalsPageEnabled,
  subscribeGoalsPageEnabledChanges,
} from '@/config/goals-page-enabled';
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
import {
  getPerfLoggingEnabled,
  setPerfLoggingEnabled,
  subscribePerfLoggingEnabledChanges,
} from '@/config/perf-logging-enabled';
import {
  getLLMApiKey,
} from '@/config/llm-settings';
import {
  getCommandPaletteEnabled,
  setCommandPaletteEnabled,
  subscribeCommandPaletteEnabledChanges,
} from '@/config/command-palette-enabled';
import {
  getProposalInboxEnabled,
  setProposalInboxEnabled,
  subscribeProposalInboxEnabledChanges,
} from '@/config/proposal-inbox-enabled';
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
  DEFAULT_PTY_TERMINAL_REPLAY_LIMIT_KB,
  MAX_PTY_WAITING_INPUT_IDLE_TIMEOUT_SECONDS,
  MAX_PTY_TERMINAL_REPLAY_LIMIT_KB,
  MIN_PTY_WAITING_INPUT_IDLE_TIMEOUT_SECONDS,
  MIN_PTY_TERMINAL_REPLAY_LIMIT_KB,
  getPtyTerminalReplayLimitKb,
  getPtyWaitingInputIdleTimeoutSeconds,
  setPtyTerminalReplayLimitKb,
  setPtyWaitingInputIdleTimeoutSeconds,
  subscribePtyTerminalReplayLimitKbChanges,
  subscribePtyWaitingInputIdleTimeoutSecondsChanges,
} from '@/config/pty-terminal-preferences';
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
  getTiledWorkbenchCommandShortcutScheme,
  getTiledWorkbenchNavigationShortcutScheme,
  getTiledWorkbenchPassthroughShortcut,
  setTiledWorkbenchCommandShortcutScheme,
  setTiledWorkbenchNavigationShortcutScheme,
  setTiledWorkbenchPassthroughShortcut,
  subscribeTiledWorkbenchCommandShortcutSchemeChanges,
  subscribeTiledWorkbenchNavigationShortcutSchemeChanges,
  subscribeTiledWorkbenchPassthroughShortcutChanges,
  type TiledWorkbenchCommandShortcutScheme,
  type TiledWorkbenchNavigationShortcutScheme,
  type TiledWorkbenchPassthroughShortcut,
} from '@/config/tiled-workbench-shortcuts';
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
  getVoiceShortcutEnabled,
  setVoiceShortcutEnabled,
  subscribeVoiceShortcutEnabledChanges,
} from '@/config/voice-shortcut-enabled';
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
  getVoiceOmniModelId,
  getVoiceOmniOptimizeEnabled,
  subscribeVoiceOmniModelIdChanges,
  subscribeVoiceOmniOptimizeEnabledChanges,
  setVoiceOmniModelId,
  setVoiceOmniOptimizeEnabled,
} from '@/config/voice-omni-settings';
import {
  getVoiceRuntimeAutoSpeakEnabled,
  getVoiceRuntimeCloudSessionPolicy,
  VOICE_RUNTIME_OMNI_COMPATIBLE_PROVIDER,
  VOICE_RUNTIME_OMNI_PROVIDER,
  setVoiceRuntimeAutoSpeakEnabled,
  setVoiceRuntimeCloudSessionPolicy,
  subscribeVoiceRuntimeAutoSpeakEnabledChanges,
  subscribeVoiceRuntimeCloudSessionPolicyChanges,
} from '@/config/voice-runtime-settings';
import {
  getVoiceRuntimeDoubaoAccessToken,
  getVoiceRuntimeDoubaoAppId,
  getVoiceRuntimeDoubaoSecretKey,
  getVoiceRuntimeDoubaoSpeaker,
  getVoiceRuntimeDoubaoWebsocketUrl,
  setVoiceRuntimeDoubaoAccessToken,
  setVoiceRuntimeDoubaoAppId,
  setVoiceRuntimeDoubaoSecretKey,
  setVoiceRuntimeDoubaoSpeaker,
  setVoiceRuntimeDoubaoWebsocketUrl,
  subscribeVoiceRuntimeDoubaoAccessTokenChanges,
  subscribeVoiceRuntimeDoubaoAppIdChanges,
  subscribeVoiceRuntimeDoubaoSecretKeyChanges,
  subscribeVoiceRuntimeDoubaoSpeakerChanges,
  subscribeVoiceRuntimeDoubaoWebsocketUrlChanges,
} from '@/config/voice-runtime-doubao';
import {
  getVoiceRuntimeOmniCompatibleAudioFormat,
  getVoiceRuntimeOmniCompatibleBaseUrl,
  getVoiceRuntimeOmniCompatibleModel,
  setVoiceRuntimeOmniCompatibleAudioFormat,
  setVoiceRuntimeOmniCompatibleBaseUrl,
  setVoiceRuntimeOmniCompatibleModel,
  subscribeVoiceRuntimeOmniCompatibleAudioFormatChanges,
  subscribeVoiceRuntimeOmniCompatibleBaseUrlChanges,
  subscribeVoiceRuntimeOmniCompatibleModelChanges,
} from '@/config/voice-runtime-omni-compatible';
import {
  getVoiceRuntimeOmniApiKey,
  getVoiceRuntimeOmniInstructions,
  getVoiceRuntimeOmniModel,
  getVoiceRuntimeOmniVoice,
  getVoiceRuntimeOmniWebsocketUrl,
  setVoiceRuntimeOmniApiKey,
  setVoiceRuntimeOmniInstructions,
  setVoiceRuntimeOmniModel,
  setVoiceRuntimeOmniVoice,
  setVoiceRuntimeOmniWebsocketUrl,
  subscribeVoiceRuntimeOmniApiKeyChanges,
  subscribeVoiceRuntimeOmniInstructionsChanges,
  subscribeVoiceRuntimeOmniModelChanges,
  subscribeVoiceRuntimeOmniVoiceChanges,
  subscribeVoiceRuntimeOmniWebsocketUrlChanges,
} from '@/config/voice-runtime-omni';
import {
  getMossApiKey,
  setMossApiKey,
} from '@/config/moss-api-key';
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
import {
  getTimeblockEndAutoOpenFocusEnabled,
  setTimeblockEndAutoOpenFocusEnabled,
  subscribeTimeblockEndAutoOpenFocusChanges,
} from '@/config/timeblock-end-alert';
import { syncDevtoolsWithSettings } from '@/lib/debug/devtools-runtime';
import {
  clearMigrationSkipped,
  isMigrationCompleted,
  isMigrationSkipped,
} from '@/lib/migration/legacy-migration-flags';
import { resolveVersionBuildInfo } from '@/config/version-build-info';
import { openExternalUrl } from '@/lib/utils/open-external';
import { setPersistedEmbeddedRuntimeNetworkMode } from '@/config/runtime-open-mode';
import {
  setPersistedEmbeddedRuntimeAllowLanWithoutAuth,
  setPersistedRuntimeExternalAddress,
  setPersistedRuntimeTargetMode,
} from '@/config/runtime-target-mode';
import {
  DataTransferSetting,
  DevInstanceDiagnosticsSetting,
  DevicePairingSetting,
  FocusBgmSetting,
  SoundPresetSetting,
  MossVoiceTestSetting,
  QwenOmniProfileSetting,
  QwenOmniPromptDocsSetting,
  VolcanoEngineKeySetting,
  VolcanoUsageSummarySetting,
  VolcanoVoiceTestSetting,
} from '@/ui/app/components/settings/settings-custom-items';
import { AIRegistrySetting } from '@/ui/app/components/settings/ai-registry-settings-card';
import { VoiceInputProviderSettings } from '@/ui/app/components/settings/voice-input-provider-settings';
import { VoiceAssistantProviderSettings } from '@/ui/app/components/settings/voice-assistant-provider-settings';
import {
  getEventlogBackendMode,
  setEventlogBackendMode,
} from '@/config/domain-backend-mode';
import {
  getEventlogMarkdownMirrorEnabled,
  setEventlogMarkdownMirrorEnabled,
  subscribeEventlogMarkdownMirrorEnabledChanges,
} from '@/config/eventlog-markdown-mirror-enabled';
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
  return normalizeMossApiKey(getMossApiKey());
}

function writeStoredMossApiKey(value: string): void {
  const normalized = normalizeMossApiKey(value);
  setMossApiKey(normalized);
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

function getResolvedRuntimeExternalAddress(): string {
  return getRuntimeExternalAddress();
}

function normalizeRuntimeExternalAddress(value: string): string {
  const parsed = parseRuntimeAddress(value);
  return formatRuntimeTargetAddress(parsed);
}

function validateRuntimeExternalAddress(value: string): string | null {
  try {
    normalizeRuntimeExternalAddress(value);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'RT 地址格式无效';
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

function tauriDevOnly(ctx: SettingsContext): boolean {
  return Boolean(ctx.developerMode) && Boolean(ctx.isTauriWindow);
}

function volcanoOnly(ctx: SettingsContext): boolean {
  return ctx.voiceShortcutAsrProvider === 'volcano';
}

function mossOnly(ctx: SettingsContext): boolean {
  return ctx.voiceShortcutAsrProvider === 'moss';
}

function qwenOmniOnly(ctx: SettingsContext): boolean {
  return ctx.voiceShortcutAsrProvider === 'qwen-omni';
}

function voiceRuntimeDoubaoOnly(ctx: SettingsContext): boolean {
  return (ctx.voiceRuntimeProvider ?? 'doubao-o2-realtime') === 'doubao-o2-realtime';
}

function voiceRuntimeOmniCompatibleOnly(ctx: SettingsContext): boolean {
  return ctx.voiceRuntimeProvider === VOICE_RUNTIME_OMNI_COMPATIBLE_PROVIDER;
}

function voiceRuntimeOmniRealtimeOnly(ctx: SettingsContext): boolean {
  return ctx.voiceRuntimeProvider === VOICE_RUNTIME_OMNI_PROVIDER;
}

function desktopOperatingSystemOnly(): boolean {
  return isDesktopOperatingSystem();
}

function androidTauriOnly(): boolean {
  if (!isTauriWindow() || isDesktopOperatingSystem() || typeof navigator === 'undefined') {
    return false;
  }
  return /android/i.test(navigator.userAgent ?? '');
}

function tauriWindowOnly(ctx: SettingsContext): boolean {
  return Boolean(ctx.isTauriWindow);
}

function embeddedRuntimeOnly(ctx: SettingsContext): boolean {
  return Boolean(ctx.isTauriWindow) && (ctx.runtimeTargetMode ?? 'embedded') === 'embedded';
}

function embeddedRuntimeLanOnly(ctx: SettingsContext): boolean {
  return embeddedRuntimeOnly(ctx) && (ctx.embeddedRuntimeNetworkMode ?? 'local') === 'lan';
}

function externalRuntimeOnly(ctx: SettingsContext): boolean {
  if (!ctx.isTauriWindow) {
    return true;
  }
  return (ctx.runtimeTargetMode ?? 'embedded') === 'external';
}

function embeddedRuntimeOrWeb(ctx: SettingsContext): boolean {
  return !ctx.isTauriWindow || embeddedRuntimeOnly(ctx);
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

const SETTINGS_APP_BASE_VERSION = packageJson.version ?? '0.0.0';

function resolveVersionText(): string {
  if (typeof import.meta === 'undefined') return SETTINGS_APP_BASE_VERSION;
  const envMap = import.meta.env as Record<string, string | undefined>;
  return resolveVersionBuildInfo(envMap, SETTINGS_APP_BASE_VERSION).appVersion;
}

function resolveBuildText(): string {
  if (typeof import.meta === 'undefined') return 'dev';
  const envMap = import.meta.env as Record<string, string | undefined>;
  return resolveVersionBuildInfo(envMap, SETTINGS_APP_BASE_VERSION).buildHash || 'dev';
}

const VOICE_SHORTCUT_ENABLED_ITEM: SettingsItem = {
  id: 'voice-shortcut-enabled',
  label: '启用快捷语音输入',
  icon: Mic,
  category: 'voice',
  rowTestId: 'new-settings-voice-shortcut-enabled-row',
  controlTestId: 'new-settings-voice-shortcut-enabled-switch',
  type: 'boolean',
  description: '关闭后全局快捷键语音输入不会响应录音开始动作。',
  get: getVoiceShortcutEnabled,
  set: setVoiceShortcutEnabled,
  subscribe: subscribeVoiceShortcutEnabledChanges,
};

const VOICE_INPUT_PROVIDER_SETTINGS_ITEM: SettingsItem = {
  id: 'voice-input-provider-settings',
  label: '快捷语音输入 Provider',
  category: 'voice',
  type: 'custom',
  component: VoiceInputProviderSettings,
};

const VOICE_ASSISTANT_PROVIDER_SETTINGS_ITEM: SettingsItem = {
  id: 'voice-assistant-provider-settings',
  label: '常驻语音助手 Provider',
  category: 'voice',
  type: 'custom',
  component: VoiceAssistantProviderSettings,
};

const VOICE_RUNTIME_DOUBAO_APP_ID_ITEM: SettingsItem = {
  id: 'voice-runtime-doubao-app-id',
  label: 'Doubao App ID',
  icon: Key,
  category: 'voice',
  type: 'string',
  visible: voiceRuntimeDoubaoOnly,
  stringStyle: 'dialog',
  dialogFieldKind: 'plain',
  placeholder: '输入 Doubao App ID',
  dialogTitle: 'Doubao App ID',
  dialogDescription: '用于 Doubao Realtime（豆包实时）运行时鉴权。',
  emptyValueLabel: '未配置',
  get: getVoiceRuntimeDoubaoAppId,
  set: setVoiceRuntimeDoubaoAppId,
  subscribe: subscribeVoiceRuntimeDoubaoAppIdChanges,
  successMessage: 'Doubao App ID 已保存',
};

const VOICE_RUNTIME_DOUBAO_ACCESS_TOKEN_ITEM: SettingsItem = {
  id: 'voice-runtime-doubao-access-token',
  label: 'Doubao Access Token',
  icon: Key,
  category: 'voice',
  type: 'string',
  visible: voiceRuntimeDoubaoOnly,
  stringStyle: 'dialog',
  sensitive: true,
  dialogFieldKind: 'secret',
  dialogFooterStart: { type: 'secret-toggle', showLabel: '显示 Token', hideLabel: '隐藏 Token' },
  allowClear: true,
  placeholder: '输入 Doubao Access Token',
  dialogTitle: 'Doubao Access Token',
  dialogDescription: '用于 Doubao Realtime（豆包实时）运行时鉴权。',
  emptyValueLabel: '未配置',
  get: getVoiceRuntimeDoubaoAccessToken,
  set: setVoiceRuntimeDoubaoAccessToken,
  subscribe: subscribeVoiceRuntimeDoubaoAccessTokenChanges,
  successMessage: 'Doubao Access Token 已保存',
  clearSuccessMessage: 'Doubao Access Token 已清除',
};

const VOICE_RUNTIME_DOUBAO_SECRET_KEY_ITEM: SettingsItem = {
  id: 'voice-runtime-doubao-secret-key',
  label: 'Doubao Secret Key',
  icon: Key,
  category: 'voice',
  type: 'string',
  visible: voiceRuntimeDoubaoOnly,
  stringStyle: 'dialog',
  sensitive: true,
  dialogFieldKind: 'secret',
  dialogFooterStart: { type: 'secret-toggle', showLabel: '显示 Secret', hideLabel: '隐藏 Secret' },
  allowClear: true,
  placeholder: '输入 Doubao Secret Key',
  dialogTitle: 'Doubao Secret Key',
  dialogDescription: '用于 Doubao Realtime（豆包实时）运行时鉴权。',
  emptyValueLabel: '未配置',
  get: getVoiceRuntimeDoubaoSecretKey,
  set: setVoiceRuntimeDoubaoSecretKey,
  subscribe: subscribeVoiceRuntimeDoubaoSecretKeyChanges,
  successMessage: 'Doubao Secret Key 已保存',
  clearSuccessMessage: 'Doubao Secret Key 已清除',
};

const VOICE_RUNTIME_DOUBAO_SPEAKER_ITEM: SettingsItem = {
  id: 'voice-runtime-doubao-speaker',
  label: 'Doubao Speaker',
  icon: Bot,
  category: 'voice',
  type: 'string',
  visible: voiceRuntimeDoubaoOnly,
  stringStyle: 'dialog',
  dialogFieldKind: 'plain',
  placeholder: 'zh_female_vv_jupiter_bigtts',
  dialogTitle: 'Doubao Speaker',
  dialogDescription: '配置 Doubao 返回音频的 speaker / 音色。',
  emptyValueLabel: '未配置',
  get: getVoiceRuntimeDoubaoSpeaker,
  set: setVoiceRuntimeDoubaoSpeaker,
  subscribe: subscribeVoiceRuntimeDoubaoSpeakerChanges,
  successMessage: 'Doubao Speaker 已保存',
};

const VOICE_RUNTIME_DOUBAO_WEBSOCKET_URL_ITEM: SettingsItem = {
  id: 'voice-runtime-doubao-websocket-url',
  label: 'Doubao WebSocket URL',
  icon: Wifi,
  category: 'voice',
  type: 'string',
  visible: voiceRuntimeDoubaoOnly,
  stringStyle: 'dialog',
  dialogFieldKind: 'plain',
  dialogInputType: 'url',
  placeholder: 'wss://openspeech.bytedance.com/api/v3/realtime/dialogue',
  dialogTitle: 'Doubao WebSocket URL',
  dialogDescription: '默认使用官方 Doubao Realtime WebSocket 地址。',
  emptyValueLabel: '未配置',
  get: getVoiceRuntimeDoubaoWebsocketUrl,
  set: setVoiceRuntimeDoubaoWebsocketUrl,
  subscribe: subscribeVoiceRuntimeDoubaoWebsocketUrlChanges,
  successMessage: 'Doubao WebSocket URL 已保存',
};

const VOICE_RUNTIME_OMNI_COMPATIBLE_MODEL_ITEM: SettingsItem = {
  id: 'voice-runtime-omni-compatible-model',
  label: 'Omni Compatible 模型',
  icon: Bot,
  category: 'voice',
  type: 'string',
  visible: voiceRuntimeOmniCompatibleOnly,
  stringStyle: 'dialog',
  dialogFieldKind: 'plain',
  placeholder: 'qwen3.5-omni-plus',
  dialogTitle: 'Omni Compatible 模型',
  dialogDescription: '半实时兼容链路默认使用 qwen3.5-omni-plus。',
  emptyValueLabel: '未配置',
  get: getVoiceRuntimeOmniCompatibleModel,
  set: setVoiceRuntimeOmniCompatibleModel,
  subscribe: subscribeVoiceRuntimeOmniCompatibleModelChanges,
  successMessage: 'Omni Compatible 模型已保存',
};

const VOICE_RUNTIME_OMNI_COMPATIBLE_BASE_URL_ITEM: SettingsItem = {
  id: 'voice-runtime-omni-compatible-base-url',
  label: 'Omni Compatible Base URL',
  icon: Wifi,
  category: 'voice',
  type: 'string',
  visible: voiceRuntimeOmniCompatibleOnly,
  stringStyle: 'dialog',
  dialogFieldKind: 'plain',
  dialogInputType: 'url',
  placeholder: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  dialogTitle: 'Omni Compatible Base URL',
  dialogDescription: 'DashScope OpenAI-compatible 接口地址。',
  emptyValueLabel: '未配置',
  get: getVoiceRuntimeOmniCompatibleBaseUrl,
  set: setVoiceRuntimeOmniCompatibleBaseUrl,
  subscribe: subscribeVoiceRuntimeOmniCompatibleBaseUrlChanges,
  successMessage: 'Omni Compatible Base URL 已保存',
};

const VOICE_RUNTIME_OMNI_COMPATIBLE_AUDIO_FORMAT_ITEM: SettingsItem = {
  id: 'voice-runtime-omni-compatible-audio-format',
  label: 'Omni Compatible 音频格式',
  icon: Bot,
  category: 'voice',
  type: 'enum',
  visible: voiceRuntimeOmniCompatibleOnly,
  options: [
    { label: 'WAV', value: 'wav' },
    { label: 'PCM16', value: 'pcm16' },
  ],
  optionTestId: (value) => `new-settings-voice-runtime-omni-compatible-audio-format-${value}`,
  get: getVoiceRuntimeOmniCompatibleAudioFormat,
  set: (value: string) => setVoiceRuntimeOmniCompatibleAudioFormat(value as 'wav' | 'pcm16'),
  subscribe: subscribeVoiceRuntimeOmniCompatibleAudioFormatChanges,
};

const VOICE_RUNTIME_OMNI_API_KEY_ITEM: SettingsItem = {
  id: 'voice-runtime-omni-api-key',
  label: 'Omni Realtime API Key',
  icon: Key,
  category: 'voice',
  type: 'string',
  visible: voiceRuntimeOmniRealtimeOnly,
  stringStyle: 'dialog',
  sensitive: true,
  dialogFieldKind: 'secret',
  dialogFooterStart: { type: 'secret-toggle', showLabel: '显示 Key', hideLabel: '隐藏 Key' },
  allowClear: true,
  placeholder: '输入 Omni Realtime API Key',
  dialogTitle: 'Omni Realtime API Key',
  dialogDescription: '仅用于实验性 Omni Realtime WebSocket 链路。',
  emptyValueLabel: '未配置',
  get: getVoiceRuntimeOmniApiKey,
  set: setVoiceRuntimeOmniApiKey,
  subscribe: subscribeVoiceRuntimeOmniApiKeyChanges,
  successMessage: 'Omni Realtime API Key 已保存',
  clearSuccessMessage: 'Omni Realtime API Key 已清除',
};

const VOICE_RUNTIME_OMNI_MODEL_ITEM: SettingsItem = {
  id: 'voice-runtime-omni-model',
  label: 'Omni Realtime 模型',
  icon: Bot,
  category: 'voice',
  type: 'string',
  visible: voiceRuntimeOmniRealtimeOnly,
  stringStyle: 'dialog',
  dialogFieldKind: 'plain',
  placeholder: 'qwen3.5-omni-plus-realtime',
  dialogTitle: 'Omni Realtime 模型',
  dialogDescription: '实验性实时链路使用的模型 ID。',
  emptyValueLabel: '未配置',
  get: getVoiceRuntimeOmniModel,
  set: setVoiceRuntimeOmniModel,
  subscribe: subscribeVoiceRuntimeOmniModelChanges,
  successMessage: 'Omni Realtime 模型已保存',
};

const VOICE_RUNTIME_OMNI_VOICE_ITEM: SettingsItem = {
  id: 'voice-runtime-omni-voice',
  label: 'Omni Realtime 音色',
  icon: Bot,
  category: 'voice',
  type: 'string',
  visible: voiceRuntimeOmniRealtimeOnly,
  stringStyle: 'dialog',
  dialogFieldKind: 'plain',
  placeholder: 'Ethan',
  dialogTitle: 'Omni Realtime 音色',
  dialogDescription: '返回语音时使用的音色名称。',
  emptyValueLabel: '未配置',
  get: getVoiceRuntimeOmniVoice,
  set: setVoiceRuntimeOmniVoice,
  subscribe: subscribeVoiceRuntimeOmniVoiceChanges,
  successMessage: 'Omni Realtime 音色已保存',
};

const VOICE_RUNTIME_OMNI_INSTRUCTIONS_ITEM: SettingsItem = {
  id: 'voice-runtime-omni-instructions',
  label: 'Omni Realtime 指令',
  icon: Bot,
  category: 'voice',
  type: 'string',
  visible: voiceRuntimeOmniRealtimeOnly,
  stringStyle: 'dialog',
  dialogFieldKind: 'plain',
  placeholder: '你是 ExoMind 的实时语音助手',
  dialogTitle: 'Omni Realtime 指令',
  dialogDescription: '用于配置实验性实时链路的系统提示词。',
  emptyValueLabel: '未配置',
  get: getVoiceRuntimeOmniInstructions,
  set: setVoiceRuntimeOmniInstructions,
  subscribe: subscribeVoiceRuntimeOmniInstructionsChanges,
  successMessage: 'Omni Realtime 指令已保存',
};

const VOICE_RUNTIME_OMNI_WEBSOCKET_URL_ITEM: SettingsItem = {
  id: 'voice-runtime-omni-websocket-url',
  label: 'Omni Realtime WebSocket URL',
  icon: Wifi,
  category: 'voice',
  type: 'string',
  visible: voiceRuntimeOmniRealtimeOnly,
  stringStyle: 'dialog',
  dialogFieldKind: 'plain',
  dialogInputType: 'url',
  placeholder: 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime',
  dialogTitle: 'Omni Realtime WebSocket URL',
  dialogDescription: '实验性实时 WebSocket 地址。',
  emptyValueLabel: '未配置',
  get: getVoiceRuntimeOmniWebsocketUrl,
  set: setVoiceRuntimeOmniWebsocketUrl,
  subscribe: subscribeVoiceRuntimeOmniWebsocketUrlChanges,
  successMessage: 'Omni Realtime WebSocket URL 已保存',
};

const VOICE_SHORTCUT_SETTINGS_GROUP: SettingsItem = {
  id: 'voice-input-settings',
  label: '快捷语音输入',
  description: '按快捷键开始录音并把识别结果写回输入框或发送链路。',
  icon: Mic,
  category: 'voice',
  type: 'group',
  groupStyle: 'inline-panel',
  dialogTitle: '快捷语音输入',
  dialogDescription: '先选快捷语音输入的 Provider，再配置对应参数与诊断项。',
  children: [
    VOICE_SHORTCUT_ENABLED_ITEM,
    VOICE_INPUT_PROVIDER_SETTINGS_ITEM,
    {
      id: 'voice-transcript-send-mode',
      label: '语音转写后',
      icon: Mic,
      category: 'voice',
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
      category: 'voice',
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
      category: 'voice',
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
      category: 'voice',
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
      id: 'voice-shortcut-mic-prewarm',
      label: '预启动麦克风',
      icon: Mic,
      category: 'voice',
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
      category: 'voice',
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
      category: 'voice',
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
      category: 'voice',
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
      category: 'voice',
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
      id: 'voice-omni-profile',
      label: 'Qwen Omni 供应商档案',
      category: 'voice',
      type: 'custom',
      visible: qwenOmniOnly,
      component: QwenOmniProfileSetting,
    },
    {
      id: 'voice-omni-prompts',
      label: 'Qwen Omni 提示词',
      category: 'voice',
      type: 'custom',
      visible: qwenOmniOnly,
      component: QwenOmniPromptDocsSetting,
    },
    {
      id: 'voice-omni-model',
      label: 'Qwen Omni 模型 ID',
      icon: Bot,
      category: 'voice',
      rowTestId: 'new-settings-voice-omni-model-row',
      controlTestId: 'new-settings-voice-omni-model-input',
      type: 'string',
      visible: qwenOmniOnly,
      stringStyle: 'dialog',
      dialogFieldKind: 'plain',
      placeholder: 'qwen3-omni-flash',
      dialogTitle: 'Qwen Omni 模型 ID',
      dialogDescription: '默认推荐 qwen3-omni-flash；也可以切换到其他已开通的 Qwen Omni 模型。',
      get: () => getVoiceOmniModelId(),
      set: (value: string) => setVoiceOmniModelId(value),
      subscribe: subscribeVoiceOmniModelIdChanges,
      successMessage: 'Qwen Omni 模型 ID 已保存',
    },
    {
      id: 'voice-omni-optimize',
      label: '启用 Qwen 二次排版',
      icon: Bot,
      category: 'voice',
      rowTestId: 'new-settings-voice-omni-optimize-row',
      controlTestId: 'new-settings-voice-omni-optimize-switch',
      type: 'boolean',
      visible: qwenOmniOnly,
      description: '开启后会在语音转写完成后再做一次文本排版，不改内容，只优化可读性。',
      get: () => getVoiceOmniOptimizeEnabled(),
      set: (value: boolean) => setVoiceOmniOptimizeEnabled(value),
      subscribe: subscribeVoiceOmniOptimizeEnabledChanges,
    },
    {
      id: 'volcano-engine-key',
      label: '火山引擎 Key',
      category: 'voice',
      type: 'custom',
      visible: volcanoOnly,
      component: VolcanoEngineKeySetting,
    },
    {
      id: 'volcano-usage-summary',
      label: '火山用量概览',
      category: 'voice',
      type: 'custom',
      visible: volcanoOnly,
      component: VolcanoUsageSummarySetting,
    },
    {
      id: 'volcano-endpoint',
      label: '火山识别模式',
      icon: Mic,
      category: 'voice',
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
      category: 'voice',
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
      category: 'voice',
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
      category: 'voice',
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
      category: 'voice',
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
      category: 'voice',
      type: 'custom',
      visible: (ctx) => devOnly(ctx) && mossOnly(ctx),
      component: MossVoiceTestSetting,
    },
    {
      id: 'volcano-asr-test',
      label: '火山引擎 ASR 测试',
      category: 'voice',
      type: 'custom',
      visible: (ctx) => devOnly(ctx) && volcanoOnly(ctx),
      component: VolcanoVoiceTestSetting,
    },
  ],
};

const VOICE_ASSISTANT_SETTINGS_GROUP: SettingsItem = {
  id: 'voice-assistant-settings',
  label: '常驻语音助手',
  description: '面向按键说话 / 环境监听的持续对话能力，未来可承载更多多模态输入。',
  icon: Bot,
  category: 'voice',
  type: 'group',
  groupStyle: 'inline-panel',
  dialogTitle: '常驻语音助手',
  dialogDescription: '先选模式，再选 Provider，并配置对应的对话运行时参数。',
  children: [
    VOICE_ASSISTANT_PROVIDER_SETTINGS_ITEM,
    {
      id: 'voice-runtime-cloud-session-policy',
      label: '云端会话策略',
      icon: Wifi,
      category: 'voice',
      rowTestId: 'new-settings-voice-runtime-cloud-session-policy-row',
      type: 'enum',
      enumStyle: 'dialog',
      dialogTitle: '云端会话策略',
      dialogDescription: '第一阶段支持按需上云与前台长连两种策略。',
      options: [
        { label: '按需上云', value: 'on-demand', description: '仅在需要时建立或使用云端会话。' },
        { label: '前台长连', value: 'foreground-persistent', description: '页面前台保持时持续维持会话。' },
      ],
      get: getVoiceRuntimeCloudSessionPolicy,
      set: (value: string) => setVoiceRuntimeCloudSessionPolicy(value as 'on-demand' | 'foreground-persistent'),
      subscribe: subscribeVoiceRuntimeCloudSessionPolicyChanges,
    },
    {
      id: 'voice-runtime-auto-speak-enabled',
      label: '启用自动播报',
      icon: Bot,
      category: 'voice',
      rowTestId: 'new-settings-voice-runtime-auto-speak-enabled-row',
      controlTestId: 'new-settings-voice-runtime-auto-speak-enabled-switch',
      type: 'boolean',
      description: '开启后，语音助手可响应后续信号驱动的主动播报。',
      get: getVoiceRuntimeAutoSpeakEnabled,
      set: setVoiceRuntimeAutoSpeakEnabled,
      subscribe: subscribeVoiceRuntimeAutoSpeakEnabledChanges,
    },
    VOICE_RUNTIME_DOUBAO_APP_ID_ITEM,
    VOICE_RUNTIME_DOUBAO_ACCESS_TOKEN_ITEM,
    VOICE_RUNTIME_DOUBAO_SECRET_KEY_ITEM,
    VOICE_RUNTIME_DOUBAO_SPEAKER_ITEM,
    VOICE_RUNTIME_DOUBAO_WEBSOCKET_URL_ITEM,
    VOICE_RUNTIME_OMNI_COMPATIBLE_MODEL_ITEM,
    VOICE_RUNTIME_OMNI_COMPATIBLE_BASE_URL_ITEM,
    VOICE_RUNTIME_OMNI_COMPATIBLE_AUDIO_FORMAT_ITEM,
    VOICE_RUNTIME_OMNI_API_KEY_ITEM,
    VOICE_RUNTIME_OMNI_MODEL_ITEM,
    VOICE_RUNTIME_OMNI_VOICE_ITEM,
    VOICE_RUNTIME_OMNI_INSTRUCTIONS_ITEM,
    VOICE_RUNTIME_OMNI_WEBSOCKET_URL_ITEM,
  ],
};

const UPDATE_SETTINGS_STORAGE_KEY = 'exomind-update-settings';
const RUNTIME_SESSION_CACHE_STORAGE_KEY = 'exomind:runtime-agent-session-cache:v1';
const LEGACY_PROVIDER_PROFILE_INDEX_STORAGE_KEY = 'exomind:agent-provider-profiles:index';
const LEGACY_PROVIDER_PROFILE_STORAGE_PREFIX = 'exomind:agent-provider-profiles:';
const LEGACY_LLM_STORAGE_KEYS = [
  'exomind:llmApiKey',
  'exomind:llmBaseUrl',
  'exomind:llmModel',
  'exomind:ai-registry:legacy-llm-bootstrap-completed',
] as const;
const LOCAL_CACHE_RUNTIME_CONFIG_KEYS = [
  'exomind:desktop-sidebar-collapsed',
  'exomind:dag-pan-speed',
  'exomind:dag-zoom-speed',
  'exomind:tasks-default-tab',
  'exomind:task-timer:auto-fill',
  'exomind:goals-mode',
  'exomind:goals-show-cancelled',
  'exomind:goals-guide-hidden',
  'task-timeline-range',
  'task-timeline-selected-task',
  'task-timeline-show-pending',
  'task-timeline-layout-mode',
  'exomind:dag-mode',
  'exomind:dag-direction',
  'exomind:dag-hide-terminal',
  'exomind:dag-background-mode',
  'exomind:dag-immersive',
  'exomind:dag-viewport',
  'exomind:dag-search-draft',
  'exomind:dag-search-options',
  'exomind:dag-visibility',
  'exomind:agentHubTopologyLayouts',
  'exomind:agentHubRuntimePorts',
  'exomind:ptyWaitingInputIdleTimeoutSeconds',
  'exomind:ptyTerminalReplayLimitKb',
  'exomind:voiceOverlayOpacity',
  'exomind:voiceOverlayShowDiagnostics',
  'exomind:voiceOverlayTranscriptLines',
  'exomind:voiceOverlayBottomOffset',
  'exomind:nowWorkbenchOverlayEnabled',
  'exomind:nowWorkbenchOverlayPosition',
] as const;
const LOCAL_CACHE_LOCAL_ONLY_KEYS = [
  EMBEDDED_RUNTIME_STATUS_STORAGE_KEY,
  RUNTIME_SESSION_CACHE_STORAGE_KEY,
] as const;
const RESET_SETTINGS_LOCAL_ONLY_KEYS = [
  ...LEGACY_LLM_STORAGE_KEYS,
  EMBEDDED_RUNTIME_STATUS_STORAGE_KEY,
  RUNTIME_SESSION_CACHE_STORAGE_KEY,
  LEGACY_PROVIDER_PROFILE_INDEX_STORAGE_KEY,
] as const;
const RESET_SETTINGS_LOCAL_ONLY_PREFIXES = [
  LEGACY_PROVIDER_PROFILE_STORAGE_PREFIX,
] as const;
const EXOMIND_SESSION_STORAGE_PREFIXES = ['exomind:'] as const;

function collectStorageKeysByPrefixes(
  storage: Storage,
  prefixes: readonly string[],
): string[] {
  const keys = new Set<string>();
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key) {
        continue;
      }
      if (prefixes.some((prefix) => key.startsWith(prefix))) {
        keys.add(key);
      }
    }
  } catch {
    // Ignore storage enumeration failures（忽略存储枚举失败）
  }
  return [...keys];
}

function removeLocalStorageKeys(keys: Iterable<string>): void {
  try {
    for (const key of new Set(keys)) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Ignore localStorage cleanup failures（忽略 localStorage 清理失败）
  }
}

function removeSessionStorageKeysByPrefixes(prefixes: readonly string[]): void {
  try {
    const keysToRemove = collectStorageKeysByPrefixes(window.sessionStorage, prefixes);
    for (const key of keysToRemove) {
      window.sessionStorage.removeItem(key);
    }
  } catch {
    // Ignore sessionStorage cleanup failures（忽略 sessionStorage 清理失败）
  }
}

function removeRuntimeConfigKeys(keys: Iterable<string>): void {
  for (const key of new Set(keys)) {
    removeRuntimeConfigValue(key);
  }
}

function removeRuntimeConfigKeysByPrefixes(prefixes: readonly string[]): void {
  removeRuntimeConfigValuesByPrefixes(prefixes);
}

function scheduleSettingsReload(): void {
  window.setTimeout(() => {
    window.location.reload();
  }, 0);
}

function clearExomindLocalCache(): string {
  if (typeof window === 'undefined') {
    return '当前环境不支持清空本地缓存';
  }

  removeRuntimeConfigKeys(LOCAL_CACHE_RUNTIME_CONFIG_KEYS);
  removeLocalStorageKeys(LOCAL_CACHE_LOCAL_ONLY_KEYS);
  removeSessionStorageKeysByPrefixes(EXOMIND_SESSION_STORAGE_PREFIXES);
  scheduleSettingsReload();

  return '已清空本地缓存，页面正在刷新。';
}

function resetAllSettings(): string {
  if (typeof window === 'undefined') {
    return '当前环境不支持重置设置';
  }

  removeRuntimeConfigKeys(RUNTIME_CONFIG_FRONTEND_IMPORT_KEYS);
  removeRuntimeConfigKeysByPrefixes(RUNTIME_CONFIG_FRONTEND_IMPORT_PREFIXES);
  removeRuntimeConfigKeys([UPDATE_SETTINGS_STORAGE_KEY]);
  removeLocalStorageKeys(RESET_SETTINGS_LOCAL_ONLY_KEYS);
  removeLocalStorageKeys(collectStorageKeysByPrefixes(window.localStorage, RESET_SETTINGS_LOCAL_ONLY_PREFIXES));
  removeSessionStorageKeysByPrefixes(EXOMIND_SESSION_STORAGE_PREFIXES);
  scheduleSettingsReload();

  return '已重置所有设置，页面正在刷新。';
}

export const FEATURE_TOGGLE_SETTING_IDS = [
  'me-page-enabled',
  'agent-page-enabled',
  'goals-page-enabled',
  'proposal-inbox-enabled',
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
    id: 'goals-page-enabled',
    label: '目标页面',
    icon: Orbit,
    rowTestId: 'feature-toggle-goals-page-row',
    controlTestId: 'feature-toggle-goals-page-switch',
    get: getGoalsPageEnabled,
    set: setGoalsPageEnabled,
    subscribe: subscribeGoalsPageEnabledChanges,
  },
  {
    id: 'proposal-inbox-enabled',
    label: '提案箱（任务域）',
    icon: Inbox,
    rowTestId: 'feature-toggle-proposal-inbox-row',
    controlTestId: 'feature-toggle-proposal-inbox-switch',
    get: getProposalInboxEnabled,
    set: setProposalInboxEnabled,
    subscribe: subscribeProposalInboxEnabledChanges,
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
    category: 'timer',
    type: 'custom',
    component: SoundPresetSetting,
  },
  {
    id: 'focus-bgm',
    label: '专注背景音',
    category: 'timer',
    type: 'custom',
    component: FocusBgmSetting,
  },
  {
    id: 'timeblock-end-auto-open-focus',
    label: '后台结束自动回到专注',
    icon: Activity,
    category: 'timer',
    rowTestId: 'new-settings-timeblock-end-auto-open-focus-row',
    controlTestId: 'new-settings-timeblock-end-auto-open-focus-switch',
    type: 'boolean',
    description: '仅 Android。倒计时在后台结束时，尝试自动拉起 App 并定位到当下/专注；系统不允许时会自动退回普通通知。',
    visible: androidTauriOnly,
    get: getTimeblockEndAutoOpenFocusEnabled,
    set: setTimeblockEndAutoOpenFocusEnabled,
    subscribe: subscribeTimeblockEndAutoOpenFocusChanges,
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
  VOICE_SHORTCUT_SETTINGS_GROUP,
  VOICE_ASSISTANT_SETTINGS_GROUP,
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
    id: 'tiled-workbench-navigation-shortcut-scheme',
    label: '平铺工作台方向快捷键',
    icon: Waypoints,
    category: 'terminal-agent',
    description: '仅作用于 Agent Hub 平铺工作台；控制焦点在窗格之间切换的宿主快捷键。',
    rowTestId: 'new-settings-tiled-workbench-navigation-shortcut-scheme-row',
    type: 'enum',
    enumStyle: 'dialog',
    dialogTitle: '平铺工作台方向快捷键',
    dialogDescription: '默认会在 PTY 聚焦时也优先拦截为宿主快捷键；如与终端内程序冲突，可切到 Alt-only 或直接关闭。',
    options: [
      {
        label: 'Alt+Shift+方向键',
        value: 'alt-shift-arrows',
        description: '默认方案，更不容易与 tmux / vim / Claude / Codex 内部快捷键冲突。',
      },
      {
        label: 'Alt+方向键',
        value: 'alt-arrows',
        description: '少按一个 Shift，但更容易与终端程序自身快捷键重叠。',
      },
      {
        label: '关闭',
        value: 'disabled',
        description: '不再拦截方向快捷键；只保留鼠标或其他 UI 焦点切换方式。',
      },
    ],
    optionTestId: (value) => `new-settings-tiled-workbench-navigation-shortcut-scheme-${value}`,
    get: () => getTiledWorkbenchNavigationShortcutScheme(),
    set: (value: string) => setTiledWorkbenchNavigationShortcutScheme(value as TiledWorkbenchNavigationShortcutScheme),
    subscribe: subscribeTiledWorkbenchNavigationShortcutSchemeChanges,
  },
  {
    id: 'tiled-workbench-command-shortcut-scheme',
    label: '平铺工作台命令快捷键',
    icon: Command,
    category: 'terminal-agent',
    description: '仅作用于 Agent Hub 平铺工作台；控制分割、清空、关闭、打开入口等宿主动作。',
    rowTestId: 'new-settings-tiled-workbench-command-shortcut-scheme-row',
    type: 'enum',
    enumStyle: 'dialog',
    dialogTitle: '平铺工作台命令快捷键',
    dialogDescription: '会覆盖 PTY 内同组合键的默认处理；若经常在终端内使用 Alt 字母组合，可切到更保守的默认方案或关闭。',
    options: [
      {
        label: 'Alt+Shift+字母',
        value: 'alt-shift-letters',
        description: '默认方案：H/V/X/Backspace/Enter 分别对应横分/纵分/关闭/清空/打开入口。',
      },
      {
        label: 'Alt+字母',
        value: 'alt-letters',
        description: '更省按键，但更容易与终端内的 Alt 字母快捷键冲突。',
      },
      {
        label: '关闭',
        value: 'disabled',
        description: '不再拦截这些宿主命令，只保留鼠标点击操作。',
      },
    ],
    optionTestId: (value) => `new-settings-tiled-workbench-command-shortcut-scheme-${value}`,
    get: () => getTiledWorkbenchCommandShortcutScheme(),
    set: (value: string) => setTiledWorkbenchCommandShortcutScheme(value as TiledWorkbenchCommandShortcutScheme),
    subscribe: subscribeTiledWorkbenchCommandShortcutSchemeChanges,
  },
  {
    id: 'tiled-workbench-passthrough-shortcut',
    label: '平铺工作台单次透传快捷键',
    icon: Monitor,
    category: 'terminal-agent',
    description: '用于把下一次宿主快捷键透传到当前聚焦 PTY，而不是执行工作台动作。',
    rowTestId: 'new-settings-tiled-workbench-passthrough-shortcut-row',
    type: 'enum',
    enumStyle: 'dialog',
    dialogTitle: '平铺工作台单次透传快捷键',
    dialogDescription: '先按一次透传键，再按下一次宿主快捷键，就会把该快捷键文本发给当前 PTY。',
    options: [
      {
        label: 'Alt+Shift+P',
        value: 'Alt+Shift+P',
        description: '默认方案，更不容易和终端内快捷键冲突。',
      },
      {
        label: 'Alt+P',
        value: 'Alt+P',
        description: '少按一个 Shift，但更容易和终端内 Alt+P 语义重叠。',
      },
      {
        label: '关闭',
        value: 'Disabled',
        description: '禁用单次透传入口。',
      },
    ],
    optionTestId: (value) => `new-settings-tiled-workbench-passthrough-shortcut-${String(value).toLowerCase().split('+').join('-')}`,
    get: () => getTiledWorkbenchPassthroughShortcut(),
    set: (value: string) => setTiledWorkbenchPassthroughShortcut(value as TiledWorkbenchPassthroughShortcut),
    subscribe: subscribeTiledWorkbenchPassthroughShortcutChanges,
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
    id: 'ai-registry',
    label: 'AI Registry',
    category: 'ai',
    type: 'custom',
    component: AIRegistrySetting,
  },
  {
    id: 'runtime-target-mode',
    label: '连接方式',
    icon: Wifi,
    category: 'connection',
    type: 'enum',
    enumStyle: 'dialog',
    visible: tauriWindowOnly,
    dialogTitle: '连接方式',
    dialogDescription: '选择使用当前设备，还是连接另一台设备。切换时会自动启动或关闭当前设备上的内置服务。',
    options: [
      {
        label: '内置',
        value: 'embedded',
        description: '使用当前设备上的内置服务。切换后会自动启动本机服务。',
      },
      {
        label: '外部',
        value: 'external',
        description: '连接到另一台设备。切换后会自动关闭本机服务，并使用下面填写的设备地址。',
      },
    ],
    optionTestId: (value) => `new-settings-runtime-target-mode-${value}`,
    get: () => getRuntimeTargetMode(),
    set: async (value: string) => await setPersistedRuntimeTargetMode(value as 'embedded' | 'external'),
    subscribe: (cb: (value: string) => void) => subscribeRuntimeTargetChanges((target) => cb(target.mode)),
    successMessage: (value: string) => value === 'external'
      ? '已切换为连接其他设备，本机服务会自动关闭'
      : '已切换为使用本机，系统会自动启动本机服务',
    errorMessagePrefix: '连接方式切换失败',
  },
  {
    id: 'embedded-runtime-open-mode',
    label: '本机开放范围',
    icon: Wifi,
    category: 'connection',
    type: 'enum',
    enumStyle: 'dialog',
    visible: embeddedRuntimeOnly,
    dialogTitle: '本机开放范围',
    dialogDescription: '决定当前设备上的内置服务只供本机使用，还是允许局域网访问；修改后在下次启动或手动重启时生效。',
    options: [
      {
        label: '仅本机',
        value: 'local',
        description: '只监听 127.0.0.1，仅当前设备可访问，不对局域网开放。',
      },
      {
        label: '局域网',
        value: 'lan',
        description: '监听 0.0.0.0，局域网设备可通过本机 IP 访问。',
      },
    ],
    optionTestId: (value) => `new-settings-embedded-runtime-open-mode-${value}`,
    helperText: (value: string) => value === 'lan'
      ? '当前会在下次启动或手动重启时切换为允许局域网访问。'
      : '当前会在下次启动或手动重启时切换为仅本机使用。',
    get: () => getEmbeddedRuntimeNetworkMode(),
    set: async (value: string) => await setPersistedEmbeddedRuntimeNetworkMode(value as 'local' | 'lan'),
    subscribe: subscribeEmbeddedRuntimeNetworkModeChanges,
    successMessage: (value: string) => value === 'lan'
      ? '已切换为允许局域网访问'
      : '已切换为仅本机使用',
    errorMessagePrefix: '开放范围保存失败',
  },
  {
    id: 'sync-server-url',
    label: 'RT 地址',
    icon: Wifi,
    category: 'connection',
    description: '需要连接另一台电脑或手机上的 ExoMind 时，在这里填写对方显示的地址；平时只在本机使用就不用改。',
    visible: externalRuntimeOnly,
    type: 'string',
    stringStyle: 'dialog',
    dialogFieldKind: 'plain',
    dialogInputType: 'text',
    placeholder: `192.168.1.23:${DEFAULT_EXTERNAL_RUNTIME_PORT}`,
    dialogTitle: '设置 RT 地址',
    dialogDescription: `填写你想连接的那台设备地址，例如 192.168.1.23:${DEFAULT_EXTERNAL_RUNTIME_PORT}。保存后，当前设备会切换到这个地址继续连接。`,
    get: getResolvedRuntimeExternalAddress,
    set: async (value: string) => {
      const normalized = normalizeRuntimeExternalAddress(value);
      await setPersistedRuntimeExternalAddress(normalized);
      await setPersistedRuntimeTargetMode('external');
      return normalized;
    },
    validate: validateRuntimeExternalAddress,
    successMessage: (value: string) => `已切换到 RT 地址：${value}`,
  },
  {
    id: 'pty-waiting-input-idle-timeout',
    label: '超时待决策时间',
    icon: Bot,
    category: 'terminal-agent',
    description: '控制 PTY 连续无输出多久后自动标记为等待决策。',
    visible: embeddedRuntimeOrWeb,
    rowTestId: 'new-settings-pty-waiting-input-idle-timeout-row',
    controlTestId: 'new-settings-pty-waiting-input-idle-timeout-slider',
    type: 'number',
    min: MIN_PTY_WAITING_INPUT_IDLE_TIMEOUT_SECONDS,
    max: MAX_PTY_WAITING_INPUT_IDLE_TIMEOUT_SECONDS,
    step: 1,
    unit: 's',
    get: () => getPtyWaitingInputIdleTimeoutSeconds(),
    set: setPtyWaitingInputIdleTimeoutSeconds,
    subscribe: subscribePtyWaitingInputIdleTimeoutSecondsChanges,
  },
  {
    id: 'pty-terminal-replay-limit-kb',
    label: '终端历史回放上限',
    icon: History,
    category: 'terminal-agent',
    description: `控制 PTY 近期历史回放窗口大小；默认 ${DEFAULT_PTY_TERMINAL_REPLAY_LIMIT_KB} KB，运行时 scrollback 与 transcript tail 会按此上限截尾回放。`,
    visible: embeddedRuntimeOrWeb,
    rowTestId: 'new-settings-pty-terminal-replay-limit-kb-row',
    controlTestId: 'new-settings-pty-terminal-replay-limit-kb-slider',
    type: 'number',
    min: MIN_PTY_TERMINAL_REPLAY_LIMIT_KB,
    max: MAX_PTY_TERMINAL_REPLAY_LIMIT_KB,
    step: 64,
    unit: 'KB',
    get: () => getPtyTerminalReplayLimitKb(),
    set: setPtyTerminalReplayLimitKb,
    subscribe: subscribePtyTerminalReplayLimitKbChanges,
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
    visible: tauriDevOnly,
    options: [
      { label: 'RT SQLite', value: 'rt-sqlite', description: '推荐，使用本地 SQLite 存储' },
      { label: 'Legacy', value: 'legacy', description: '旧版 JSON 文件存储' },
    ],
    get: getEventlogBackendMode,
    set: (value: string) => { setEventlogBackendMode(value as 'legacy' | 'rt-sqlite'); window.location.reload(); },
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
      if (!ctx.isDesktop || !ctx.isTauriWindow) return false;
      try {
        return !isMigrationCompleted() && isMigrationSkipped();
      } catch {
        return false;
      }
    },
    onAction: () => {
      try {
        clearMigrationSkipped();
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
    id: 'eventlog-markdown-mirror-enabled',
    label: '事件日志 Markdown 镜像',
    description: '实验性，默认关闭。关闭后 RT 不再在每次事件写入后自动重建 Markdown 镜像，可减少常态高频写入的整量回读与镜像重建开销；不影响 SQLite 真相源。',
    icon: ScrollText,
    category: 'developer',
    controlTestId: 'new-settings-eventlog-markdown-mirror-switch',
    type: 'boolean',
    visible: devOnly,
    get: () => getEventlogMarkdownMirrorEnabled(),
    set: setEventlogMarkdownMirrorEnabled,
    subscribe: subscribeEventlogMarkdownMirrorEnabledChanges,
  },
  {
    id: 'perf-logging-enabled',
    label: '性能跟踪日志',
    description: '实验性，默认关闭。关闭后不再输出前端 PERF 追踪与高频 click-to-done 性能日志，避免控制台泛洪；开启后统一输出 `[PERF] (xxms) ...` 与相关性能步骤日志。',
    icon: Activity,
    category: 'developer',
    controlTestId: 'new-settings-perf-logging-switch',
    type: 'boolean',
    visible: devOnly,
    get: () => getPerfLoggingEnabled(),
    set: setPerfLoggingEnabled,
    subscribe: subscribePerfLoggingEnabledChanges,
  },
  {
    id: 'api-agent-tab-enabled',
    label: 'API Agent Tab',
    description: '在网络页顶部显示 API Agent 调试页签',
    icon: Bot,
    category: 'developer',
    controlTestId: 'new-settings-api-agent-tab-switch',
    type: 'boolean',
    visible: devOnly,
    get: () => getApiAgentTabEnabled(),
    set: setApiAgentTabEnabled,
    subscribe: subscribeApiAgentTabEnabledChanges,
  },
  ...FEATURE_TOGGLE_SETTINGS.map((setting) => ({
    id: setting.id,
    label: setting.label,
    icon: setting.icon,
    category: 'developer' as const,
    type: 'boolean' as const,
    visible: devOnly,
    rowTestId: setting.rowTestId,
    controlTestId: setting.controlTestId,
    get: setting.get,
    set: setting.set,
    subscribe: setting.subscribe,
  })),
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
    label: '高级设备配对',
    category: 'developer',
    type: 'custom',
    visible: devOnly,
    component: DevicePairingSetting,
  },
  {
    id: 'embedded-runtime-lan-no-auth',
    label: '局域网免 Token',
    description: '仅在“内嵌 RT + RT 开放模式 = 局域网”时生效。开启后，局域网设备可直接访问受保护接口，不再需要 Bearer Token；修改后在下次启动或手动重启 RT 时生效。',
    icon: Shield,
    category: 'danger',
    type: 'boolean',
    rowTestId: 'new-settings-embedded-runtime-lan-no-auth-row',
    controlTestId: 'new-settings-embedded-runtime-lan-no-auth-switch',
    visible: embeddedRuntimeLanOnly,
    get: getEmbeddedRuntimeAllowLanWithoutAuth,
    set: async (value: boolean) => await setPersistedEmbeddedRuntimeAllowLanWithoutAuth(value),
    subscribe: subscribeEmbeddedRuntimeAllowLanWithoutAuthChanges,
    successMessage: (value: boolean) => value
      ? '已允许局域网设备免 Token 访问内嵌 RT'
      : '已恢复局域网访问需携带 Token',
    errorMessagePrefix: '局域网免 Token 设置保存失败',
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
export const REGISTRY_VERSION = '2026-04-08';
