import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { Switch } from '@/components/ui/switch';
import { getEventLogService } from '@/lib/services';
import {
  getSyncServerUrlOverride,
  resolveSyncServerUrl,
  setSyncServerUrlOverride,
} from '@/config/port-env';
import { resolveVersionBuildInfo } from '@/config/version-build-info';
import {
  getThemePreference,
  setThemePreference,
  type ThemePreference,
} from '@/config/theme';
import {
  getDeveloperModeEnabled,
  setDeveloperModeEnabled,
} from '@/config/developer-mode';
import {
  getAgentPageEnabled,
  setAgentPageEnabled,
} from '@/config/agent-page-enabled';
import {
  getDesktopAdaptiveEnabled,
  setDesktopAdaptiveEnabled,
} from '@/config/desktop-adaptive';
import {
  getTimerPreferences,
  subscribeTimerPreferencesChanges,
  updateTimerPreferences,
  type CountdownEndMode,
} from '@/config/timer-preferences';
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
  getLLMApiKey,
  getLLMBaseUrl,
  getLLMModel,
  setLLMApiKey,
  setLLMBaseUrl,
  setLLMModel,
} from '@/config/llm-settings';
import {
  getCommandPaletteEnabled,
  setCommandPaletteEnabled,
  subscribeCommandPaletteEnabledChanges,
} from '@/config/command-palette-enabled';
import {
  getVoiceTranscriptSendMode,
  setVoiceTranscriptSendMode,
  subscribeVoiceTranscriptSendModeChanges,
  type VoiceTranscriptSendMode,
} from '@/config/voice-transcript-send-mode';
import {
  getVoiceShortcutHotkey,
  setVoiceShortcutHotkey,
  subscribeVoiceShortcutHotkeyChanges,
  VOICE_SHORTCUT_HOTKEY_VALUES,
  type VoiceShortcutHotkey,
} from '@/config/voice-shortcut-hotkey';
import {
  getFeedbackPreferences,
  setFeedbackPreferences,
  subscribeFeedbackPreferencesChanges,
  type FeedbackPreferences,
} from '@/config/feedback-preferences';
import { syncDevtoolsWithSettings } from '@/lib/debug/devtools-runtime';
import {
  TIMER_END_SOUND_PRESETS,
  getTimerEndSoundPresetById,
  type TimerEndSoundPresetId,
} from '@/lib/media/timer-end-sounds';
import { UserCard } from '@/ui/app/components/UserCard';
import { MoreSection } from '@/ui/app/components/MoreSection';
import { AboutSection } from '@/ui/app/components/AboutSection';
import { Divider, SectionCard, SectionTitle, SettingRow } from '@/ui/app/components/settings-shared';
import { useNavigate } from '@tanstack/react-router';
import {
  Bell,
  Bot,
  Check,
  ChevronRight,
  Code,
  Command,
  Download,
  Key,
  Monitor,
  Mic,
  Moon,
  MoonStar,
  List,
  Sun,
  Timer,
  Upload,
  Wifi,
} from 'lucide-react';

type ImportStrategy = 'merge' | 'overwrite';
type PickedJsonFile = {
  path: string;
  content: string;
};

type DesktopTabKey = 'theme' | 'focus' | 'notification' | 'about' | 'danger';

const MOSS_API_KEY_STORAGE_KEY = 'moss_api_key';

function buildBackupFileName(): string {
  const date = new Date().toISOString().slice(0, 10);
  return `exomind-eventlog-${date}.json`;
}

function normalizeMossApiKey(value: string): string {
  if (!value) return '';
  let normalized = value.trim();
  normalized = normalized.replace(/^['"]|['"]$/g, '');
  normalized = normalized.replace(/^Bearer\s+/i, '');
  return normalized.trim();
}

function readStoredMossApiKey(): string {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return '';
  }
  const storage = window.localStorage as Partial<Storage>;
  if (typeof storage.getItem !== 'function') {
    return '';
  }
  try {
    return normalizeMossApiKey(storage.getItem(MOSS_API_KEY_STORAGE_KEY) || '');
  } catch {
    return '';
  }
}

function writeStoredMossApiKey(value: string): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return;
  }
  const storage = window.localStorage as Partial<Storage>;
  if (typeof storage.setItem !== 'function') {
    return;
  }
  storage.setItem(MOSS_API_KEY_STORAGE_KEY, value);
}

function removeStoredMossApiKey(): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return;
  }
  const storage = window.localStorage as Partial<Storage>;
  if (typeof storage.removeItem !== 'function') {
    return;
  }
  storage.removeItem(MOSS_API_KEY_STORAGE_KEY);
}

function maskMossApiKey(value: string): string {
  if (value.length <= 6) return `${value.slice(0, 2)}***`;
  return `${value.slice(0, 4)}***${value.slice(-2)}`;
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
    const onChange = (event: MediaQueryListEvent) => {
      setIsDesktop(event.matches);
    };

    setIsDesktop(mediaQueryList.matches);
    mediaQueryList.addEventListener('change', onChange);
    return () => {
      mediaQueryList.removeEventListener('change', onChange);
    };
  }, [minWidth]);

  return isDesktop;
}

export function SettingsPage() {
  const envMap = import.meta.env as Record<string, string | undefined>;
  const versionBuildInfo = resolveVersionBuildInfo(envMap, '0.3.6');
  const autoSyncServerUrl = resolveSyncServerUrl(envMap, {
    syncServerOverride: null,
  });
  const [syncServerUrl, setSyncServerUrl] = useState(() => getSyncServerUrlOverride() || autoSyncServerUrl);
  const [savedSyncServerUrl, setSavedSyncServerUrl] = useState<string | null>(() => getSyncServerUrlOverride());
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>(() => getThemePreference());
  const [developerMode, setDeveloperMode] = useState<boolean>(() => getDeveloperModeEnabled());
  const [agentPageEnabled, setAgentPageEnabledState] = useState<boolean>(
    () => getAgentPageEnabled()
  );
  const [desktopAdaptiveEnabled, setDesktopAdaptiveEnabledState] = useState<boolean>(
    () => getDesktopAdaptiveEnabled()
  );
  const [useMockData, setUseMockData] = useState<boolean>(() => getUseMockDataEnabled());
  const [devtoolsEnabled, setDevtoolsEnabledState] = useState<boolean>(() => getDevtoolsEnabled());
  const [commandPaletteEnabled, setCommandPaletteEnabledState] = useState<boolean>(() => getCommandPaletteEnabled());
  const [voiceTranscriptSendMode, setVoiceTranscriptSendModeState] = useState<VoiceTranscriptSendMode>(
    () => getVoiceTranscriptSendMode()
  );
  const [voiceShortcutHotkey, setVoiceShortcutHotkeyState] = useState<VoiceShortcutHotkey>(
    () => getVoiceShortcutHotkey()
  );
  const [feedbackPreferences, setFeedbackPreferencesState] = useState<FeedbackPreferences>(
    () => getFeedbackPreferences()
  );
  const [timerPreferences, setTimerPreferencesState] = useState(() => getTimerPreferences());
  const [soundPickerOpen, setSoundPickerOpen] = useState(false);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [countdownModeDialogOpen, setCountdownModeDialogOpen] = useState(false);
  const [featureTogglesDialogOpen, setFeatureTogglesDialogOpen] = useState(false);
  const [voiceInputDialogOpen, setVoiceInputDialogOpen] = useState(false);
  const [mossApiKey, setMossApiKey] = useState(() => readStoredMossApiKey());
  const [mossApiKeyDraft, setMossApiKeyDraft] = useState('');
  const [showMossApiKey, setShowMossApiKey] = useState(false);
  const [llmDialogOpen, setLlmDialogOpen] = useState(false);
  const [llmApiKeyDraft, setLlmApiKeyDraft] = useState(() => getLLMApiKey());
  const [llmBaseUrlDraft, setLlmBaseUrlDraft] = useState(() => getLLMBaseUrl());
  const [llmModelDraft, setLlmModelDraft] = useState(() => getLLMModel());
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importStrategy] = useState<ImportStrategy>('merge');
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [comingSoonVisible, setComingSoonVisible] = useState(false);
  const comingSoonTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeDesktopTab, setActiveDesktopTab] = useState<DesktopTabKey>('theme');
  const sectionThemeRef = useRef<HTMLElement | null>(null);
  const sectionFocusRef = useRef<HTMLElement | null>(null);
  const sectionNotificationRef = useRef<HTMLElement | null>(null);
  const sectionDangerRef = useRef<HTMLElement | null>(null);
  const sectionAboutRef = useRef<HTMLElement | null>(null);
  const isDesktop = useIsDesktop();
  const isDesktopVcLayout = isDesktop && desktopAdaptiveEnabled;

  const showComingSoon = () => {
    if (comingSoonTimer.current) clearTimeout(comingSoonTimer.current);
    setComingSoonVisible(true);
    comingSoonTimer.current = setTimeout(() => setComingSoonVisible(false), 1500);
  };

  const clearNotice = () => {
    setStatusMessage('');
    setErrorMessage('');
  };

  const normalizeSyncServerUrl = (value: string): string => {
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
  };

  const handleSaveSyncServerUrl = () => {
    clearNotice();

    try {
      const normalized = normalizeSyncServerUrl(syncServerUrl);
      setSyncServerUrlOverride(normalized);
      const saved = getSyncServerUrlOverride() || normalized;
      setSavedSyncServerUrl(saved);
      setSyncServerUrl(saved);
      setStatusMessage(`同步服务器地址已保存：${saved}`);
      setSyncDialogOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      setErrorMessage(`保存失败：${message}`);
    }
  };

  const handleExportBackup = async () => {
    clearNotice();
    setLoading(true);
    try {
      const service = getEventLogService();
      const json = await service.exportEventsAsJson();
      const payload = JSON.parse(json) as { events?: unknown[] };
      const count = Array.isArray(payload.events) ? payload.events.length : 0;
      const defaultName = buildBackupFileName();

      const isRunningInTauri = await isTauri();
      if (isRunningInTauri) {
        const savedPath = await invoke<string | null>('save_json_file', {
          content: json,
          defaultName,
        });
        if (!savedPath) {
          setStatusMessage('已取消保存。');
          return;
        }
        setStatusMessage(`导出成功，共 ${count} 条事件。保存路径：${savedPath}`);
        return;
      }

      downloadJsonFallback(json, defaultName);
      setStatusMessage(`导出成功，共 ${count} 条事件。`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      setErrorMessage(`导出失败：${message}`);
    } finally {
      setLoading(false);
    }
  };

  const downloadJsonFallback = (json: string, filename: string) => {
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const handleImportBackup = async () => {
    clearNotice();

    const isRunningInTauri = await isTauri();
    if (!isRunningInTauri) {
      fileInputRef.current?.click();
      return;
    }

    setLoading(true);
    try {
      const picked = await invoke<PickedJsonFile | null>('pick_json_file');
      if (!picked) {
        setStatusMessage('已取消导入。');
        return;
      }
      await processImport(picked);
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      setErrorMessage(`导入失败：${message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleFileInputChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      const content = await file.text();
      await processImport({ path: file.name, content });
    } finally {
      e.target.value = '';
      setLoading(false);
    }
  };

  const processImport = async (picked: PickedJsonFile) => {
    try {
      const service = getEventLogService();
      const result = await service.importEventsFromJson(picked.content, importStrategy);
      setStatusMessage(
        `导入成功：新增 ${result.imported} 条，跳过 ${result.skipped} 条，当前共 ${result.total} 条。来源：${picked.path}`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      setErrorMessage(`导入失败：${message}`);
    }
  };

  const handleDeveloperModeToggle = (checked: boolean) => {
    setDeveloperModeEnabled(checked);
    setDeveloperMode(checked);
    if (!checked) {
      setDevtoolsEnabled(false);
      setDevtoolsEnabledState(false);
    }
    void syncDevtoolsWithSettings();
  };

  const handleAgentPageEnabledToggle = (checked: boolean) => {
    setAgentPageEnabled(checked);
    setAgentPageEnabledState(checked);
  };

  const handleDesktopAdaptiveToggle = (checked: boolean) => {
    setDesktopAdaptiveEnabled(checked);
    setDesktopAdaptiveEnabledState(checked);
  };

  const handleUseMockDataToggle = (checked: boolean) => {
    setUseMockDataEnabled(checked);
    setUseMockData(checked);
    // Reload page（刷新页面）to re-bootstrap runtime adapters（重建运行时适配器注入）.
    window.location.reload();
  };

  const handleDevtoolsToggle = (checked: boolean) => {
    setDevtoolsEnabled(checked);
    setDevtoolsEnabledState(checked);
    void syncDevtoolsWithSettings();
  };

  const navigate = useNavigate();

  const handleCommandPaletteToggle = (checked: boolean) => {
    setCommandPaletteEnabled(checked);
    setCommandPaletteEnabledState(checked);
  };

  const handleOpenLegalSupport = () => {
    navigate({ to: '/settings/legal-support' });
  };

  const handleOpenOfficialWebsite = () => {
    if (typeof window === 'undefined') return;
    window.open('https://exo-mind.ai/', '_blank', 'noopener,noreferrer');
  };

  const handleOpenSponsor = () => {
    if (typeof window === 'undefined') return;
    window.open('https://exo-mind.ai/', '_blank', 'noopener,noreferrer');
  };

  const handleVoiceTranscriptSendModeChange = (mode: VoiceTranscriptSendMode) => {
    setVoiceTranscriptSendMode(mode);
    setVoiceTranscriptSendModeState(mode);
  };
  const handleVoiceShortcutHotkeyChange = (hotkey: VoiceShortcutHotkey) => {
    const normalizedHotkey = setVoiceShortcutHotkey(hotkey);
    setVoiceShortcutHotkeyState(normalizedHotkey);
  };
  const handleFeedbackPreferenceToggle = (key: keyof FeedbackPreferences) => {
    const next = {
      ...feedbackPreferences,
      [key]: !feedbackPreferences[key],
    };
    setFeedbackPreferences(next);
    setFeedbackPreferencesState(next);
  };

  const handleOpenVoiceInputSettings = () => {
    clearNotice();
    setMossApiKeyDraft(mossApiKey);
    setShowMossApiKey(false);
    setVoiceInputDialogOpen(true);
  };

  const handleSaveMossApiKey = () => {
    clearNotice();
    const normalized = normalizeMossApiKey(mossApiKeyDraft);
    if (!normalized) {
      setErrorMessage('MOSS API Token 不能为空');
      return;
    }
    writeStoredMossApiKey(normalized);
    setMossApiKey(normalized);
    setVoiceInputDialogOpen(false);
    setStatusMessage('MOSS API Token 已保存');
  };

  const handleClearMossApiKey = () => {
    clearNotice();
    removeStoredMossApiKey();
    setMossApiKey('');
    setMossApiKeyDraft('');
    setVoiceInputDialogOpen(false);
    setStatusMessage('MOSS API Token 已清除');
  };

  const handleOpenVoiceTest = () => {
    clearNotice();
    if (!developerMode) {
      setErrorMessage('请先开启开发者模式后使用语音测试');
      return;
    }
    navigate({ to: '/moss-test' });
  };

  const handleOpenVolcanoTest = () => {
    clearNotice();
    if (!developerMode) {
      setErrorMessage('请先开启开发者模式后使用语音测试');
      return;
    }
    navigate({ to: '/volcano-asr-test' });
  };

  const handleOpenLlmDialog = () => {
    setLlmApiKeyDraft(getLLMApiKey());
    setLlmBaseUrlDraft(getLLMBaseUrl());
    setLlmModelDraft(getLLMModel());
    setLlmDialogOpen(true);
  };

  const handleSaveLlmSettings = () => {
    clearNotice();
    setLLMApiKey(llmApiKeyDraft);
    setLLMBaseUrl(llmBaseUrlDraft);
    setLLMModel(llmModelDraft);
    setLlmDialogOpen(false);
    setStatusMessage('AI 设置已保存');
  };

  useEffect(() => {
    const unsubscribe = subscribeTimerPreferencesChanges((nextPreferences) => {
      setTimerPreferencesState(nextPreferences);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    return subscribeUseMockDataChanges((enabled) => {
      setUseMockData(enabled);
    });
  }, []);

  useEffect(() => {
    return subscribeDevtoolsChanges((enabled) => {
      setDevtoolsEnabledState(enabled);
    });
  }, []);

  useEffect(() => {
    return subscribeCommandPaletteEnabledChanges((enabled) => {
      setCommandPaletteEnabledState(enabled);
    });
  }, []);

  useEffect(() => {
    return subscribeVoiceTranscriptSendModeChanges((mode) => {
      setVoiceTranscriptSendModeState(mode);
    });
  }, []);

  useEffect(() => {
    return subscribeVoiceShortcutHotkeyChanges((hotkey) => {
      setVoiceShortcutHotkeyState(hotkey);
    });
  }, []);

  useEffect(() => {
    return subscribeFeedbackPreferencesChanges((nextPreferences) => {
      setFeedbackPreferencesState(nextPreferences);
    });
  }, []);

  const handleCountdownEndModeChange = (mode: CountdownEndMode) => {
    setTimerPreferencesState(updateTimerPreferences({ countdownEndMode: mode }));
    setCountdownModeDialogOpen(false);
  };

  const handleThemePreferenceChange = (nextPreference: ThemePreference) => {
    setThemePreference(nextPreference);
    setThemePreferenceState(nextPreference);
  };

  const handleSoundPresetChange = (presetId: TimerEndSoundPresetId | 'off') => {
    if (presetId === 'off') {
      setTimerPreferencesState(updateTimerPreferences({ countdownEndSoundEnabled: false }));
      setSoundPickerOpen(false);
      return;
    }
    setTimerPreferencesState(updateTimerPreferences({
      countdownEndSoundEnabled: true,
      countdownEndSoundPresetId: presetId,
    }));
    setSoundPickerOpen(false);
  };

  const currentSoundLabel = timerPreferences.countdownEndSoundEnabled
    ? getTimerEndSoundPresetById(timerPreferences.countdownEndSoundPresetId).label
    : '已关闭';

  const countdownEndModeLabel = timerPreferences.countdownEndMode === 'hard' ? '硬停止' : '柔和提醒';
  const mossApiKeyStatusLabel = mossApiKey
    ? `已配置 (${maskMossApiKey(mossApiKey)})`
    : '未配置';
  const voiceTestStatusLabel = developerMode ? '可用' : '需开发者模式';

  const syncHost = (() => {
    try {
      return new URL(savedSyncServerUrl || autoSyncServerUrl).hostname;
    } catch {
      return '127.0.0.1';
    }
  })();

  const desktopTabItems: Array<{ key: DesktopTabKey; label: string; ref: { current: HTMLElement | null } }> = [
    { key: 'theme', label: '外观主题', ref: sectionThemeRef },
    { key: 'focus', label: '专注设置', ref: sectionFocusRef },
    { key: 'notification', label: '通知', ref: sectionNotificationRef },
    { key: 'about', label: '关于', ref: sectionAboutRef },
    { key: 'danger', label: '危险区域', ref: sectionDangerRef },
  ];

  const handleDesktopTabClick = (tabKey: DesktopTabKey, sectionRef: { current: HTMLElement | null }) => {
    setActiveDesktopTab(tabKey);
    sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const renderDesktopVcContent = () => (
    <div data-testid="new-settings-desktop-vc-root" className="flex h-full min-h-full flex-col">
      <header className="border-b border-[#F0ECE8] px-10 pb-4 pt-8 dark:border-[#292524]">
        <h1 className="text-[22px] font-semibold text-[#1C1917] dark:text-[#FAFAF9]">设置</h1>
        <p className="mt-1 text-sm text-[#78716C] dark:text-[#A8A29E]">管理你的应用偏好和账户设置</p>
      </header>

      <div className="border-b border-[#F0ECE8] px-10 py-3 dark:border-[#292524]">
        <div data-testid="new-settings-desktop-vc-tabs" className="inline-flex items-center gap-1 rounded-lg bg-[#F5F0ED] p-1 dark:bg-[#292524]">
          {desktopTabItems.map((tab) => (
            <button
              key={tab.key}
              type="button"
              aria-pressed={activeDesktopTab === tab.key}
              onClick={() => handleDesktopTabClick(tab.key, tab.ref)}
              className={`rounded-md px-3 py-1.5 text-xs transition-colors ${
                activeDesktopTab === tab.key
                  ? 'bg-white font-medium text-[#1C1917] shadow-[0_1px_2px_rgba(0,0,0,0.08)] dark:bg-[#44403C] dark:text-[#FAFAF9]'
                  : 'text-[#78716C] dark:text-[#A8A29E]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div data-testid="new-settings-desktop-vc-scroll" className="flex-1 overflow-y-auto px-10 py-6">
        <div className="mx-auto w-full max-w-[980px] space-y-6 pb-10">
          <section ref={sectionThemeRef} className="space-y-2" data-testid="new-settings-desktop-vc-section-theme">
            <SectionTitle>外观主题</SectionTitle>
            <SectionCard>
              <div className="flex items-center justify-between px-4 py-[14px]">
                <div className="flex items-center gap-3">
                  <MoonStar className="h-[18px] w-[18px] text-[#78716C]" />
                  <span className="text-sm text-[#1C1917] dark:text-[#FAFAF9]">主题</span>
                </div>
                <div
                  id="theme-preference-new"
                  role="group"
                  aria-label="主题"
                  className="flex items-center rounded-[10px] bg-[#F5F0ED] p-[3px] dark:bg-[#292524]"
                >
                  <button
                    type="button"
                    data-testid="new-settings-theme-system"
                    aria-pressed={themePreference === 'system'}
                    onClick={() => handleThemePreferenceChange('system')}
                    disabled={loading}
                    className={`rounded-[8px] px-2.5 py-1.5 text-xs transition-colors disabled:cursor-not-allowed ${
                      themePreference === 'system'
                        ? 'bg-white font-medium text-[#1C1917] dark:bg-[#44403C] dark:text-[#FAFAF9]'
                        : 'text-[#A8A29E]'
                    }`}
                  >
                    自动
                  </button>
                  <button
                    type="button"
                    data-testid="new-settings-theme-light"
                    aria-pressed={themePreference === 'light'}
                    onClick={() => handleThemePreferenceChange('light')}
                    disabled={loading}
                    className={`rounded-[8px] px-2.5 py-1.5 text-xs transition-colors disabled:cursor-not-allowed ${
                      themePreference === 'light'
                        ? 'bg-white font-medium text-[#1C1917] dark:bg-[#44403C] dark:text-[#FAFAF9]'
                        : 'text-[#A8A29E]'
                    }`}
                  >
                    浅色
                  </button>
                  <button
                    type="button"
                    data-testid="new-settings-theme-dark"
                    aria-pressed={themePreference === 'dark'}
                    onClick={() => handleThemePreferenceChange('dark')}
                    disabled={loading}
                    className={`rounded-[8px] px-2.5 py-1.5 text-xs transition-colors disabled:cursor-not-allowed ${
                      themePreference === 'dark'
                        ? 'bg-white font-medium text-[#1C1917] dark:bg-[#44403C] dark:text-[#FAFAF9]'
                        : 'text-[#A8A29E]'
                    }`}
                  >
                    深色
                  </button>
                </div>
              </div>
            </SectionCard>
          </section>

          <section ref={sectionFocusRef} className="space-y-2" data-testid="new-settings-desktop-vc-section-focus">
            <SectionTitle>专注设置</SectionTitle>
            <SectionCard>
              <SettingRow
                icon={<Timer className="h-[18px] w-[18px] text-[#78716C]" />}
                label="倒计时结束"
                onClick={() => setCountdownModeDialogOpen(true)}
                right={
                  <div className="flex items-center gap-1">
                    <span className="text-sm text-[#A8A29E]">{countdownEndModeLabel}</span>
                    <ChevronRight className="h-4 w-4 text-[#D6D3D1] dark:text-[#57534E]" />
                  </div>
                }
              />
              <Divider />
              <SettingRow
                icon={<Bell className="h-[18px] w-[18px] text-[#78716C]" />}
                label="提示音"
                onClick={() => setSoundPickerOpen(true)}
                right={
                  <div className="flex items-center gap-1">
                    <span className="text-sm text-[#A8A29E]">{currentSoundLabel}</span>
                    <ChevronRight className="h-4 w-4 text-[#D6D3D1] dark:text-[#57534E]" />
                  </div>
                }
              />
            </SectionCard>
          </section>

          <section ref={sectionNotificationRef} className="space-y-2" data-testid="new-settings-desktop-vc-section-notification">
            <SectionTitle>通知</SectionTitle>
            <SectionCard>
              <SettingRow
                icon={<Wifi className="h-[18px] w-[18px] text-[#78716C]" />}
                label="同步服务器"
                onClick={() => setSyncDialogOpen(true)}
                right={
                  <div className="flex items-center gap-1">
                    <span className="text-sm text-[#A8A29E]">{syncHost}</span>
                    <ChevronRight className="h-4 w-4 text-[#D6D3D1] dark:text-[#57534E]" />
                  </div>
                }
              />
              <div data-testid="new-settings-input-section">
                <Divider />
                <div data-testid="new-settings-voice-shortcut-row">
                  <SettingRow
                    icon={<Mic className="h-[18px] w-[18px] text-[#78716C]" />}
                    label="全局语音快捷键"
                    right={(
                      <div
                        role="group"
                        aria-label="全局语音快捷键"
                        className="flex items-center rounded-[10px] bg-[#F5F0ED] p-[3px] dark:bg-[#292524]"
                      >
                        {VOICE_SHORTCUT_HOTKEY_VALUES.map((hotkey) => {
                          const testId = hotkey === 'Alt+Q'
                            ? 'new-settings-voice-shortcut-alt-q'
                            : hotkey === 'Alt+W'
                              ? 'new-settings-voice-shortcut-alt-w'
                              : 'new-settings-voice-shortcut-ctrl-space';
                          return (
                            <button
                              key={hotkey}
                              type="button"
                              data-testid={testId}
                              aria-pressed={voiceShortcutHotkey === hotkey}
                              onClick={() => handleVoiceShortcutHotkeyChange(hotkey)}
                              disabled={loading}
                              className={`rounded-[8px] px-2.5 py-1.5 text-xs transition-colors disabled:cursor-not-allowed ${
                                voiceShortcutHotkey === hotkey
                                  ? 'bg-white font-medium text-[#1C1917] shadow-[0_1px_3px_rgba(0,0,0,0.08)] dark:bg-[#44403C] dark:text-[#FAFAF9]'
                                  : 'text-[#A8A29E]'
                              }`}
                            >
                              {hotkey}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  />
                </div>
                <div className="pb-[14px] pl-[46px] pr-4">
                  <span className="text-xs text-[#A8A29E]">Shortcut Voice（快捷键语音）默认 Alt+Q，按一次开始再按一次结束</span>
                </div>
                <Divider />
                <div data-testid="new-settings-voice-token-row">
                  <SettingRow
                    icon={<Bot className="h-[18px] w-[18px] text-[#78716C]" />}
                    label="MOSS API Token"
                    onClick={handleOpenVoiceInputSettings}
                    right={
                      <div className="flex items-center gap-1">
                        <span className="text-sm text-[#A8A29E]">{mossApiKeyStatusLabel}</span>
                        <ChevronRight className="h-4 w-4 text-[#D6D3D1] dark:text-[#57534E]" />
                      </div>
                    }
                  />
                </div>
                <Divider />
                <div data-testid="new-settings-moss-test-row">
                  <SettingRow
                    icon={<Bot className="h-[18px] w-[18px] text-[#78716C]" />}
                    label="MOSS 语音测试"
                    onClick={handleOpenVoiceTest}
                    right={
                      <div className="flex items-center gap-1">
                        <span className="text-sm text-[#A8A29E]">{voiceTestStatusLabel}</span>
                        <ChevronRight className="h-4 w-4 text-[#D6D3D1] dark:text-[#57534E]" />
                      </div>
                    }
                  />
                </div>
                <Divider />
                <div data-testid="new-settings-volcano-test-row">
                  <SettingRow
                    icon={<Mic className="h-[18px] w-[18px] text-[#78716C]" />}
                    label="火山引擎 ASR 测试"
                    onClick={handleOpenVolcanoTest}
                    right={
                      <div className="flex items-center gap-1">
                        <span className="text-sm text-[#A8A29E]">{voiceTestStatusLabel}</span>
                        <ChevronRight className="h-4 w-4 text-[#D6D3D1] dark:text-[#57534E]" />
                      </div>
                    }
                  />
                </div>
              </div>
              <Divider />
              <SettingRow
                icon={<Code className="h-[18px] w-[18px] text-[#78716C]" />}
                label="开发者模式"
                right={<Switch checked={developerMode} onCheckedChange={handleDeveloperModeToggle} />}
              />
              {developerMode && (
                <>
                  <div className="pb-[14px] pl-[46px] pr-4">
                    <span className="text-xs text-[#A8A29E]">开启后可使用语音测试等实验功能</span>
                  </div>
                  <SettingRow
                    icon={<Code className="h-[18px] w-[18px] text-[#78716C]" />}
                    label="使用测试数据"
                    right={
                      <Switch
                        data-testid="new-settings-use-mock-data-switch"
                        checked={useMockData}
                        onCheckedChange={handleUseMockDataToggle}
                      />
                    }
                  />
                  <Divider />
                  <SettingRow
                    icon={<Code className="h-[18px] w-[18px] text-[#78716C]" />}
                    label="开发者工具"
                    right={
                      <Switch
                        data-testid="new-settings-devtools-switch"
                        checked={devtoolsEnabled}
                        onCheckedChange={handleDevtoolsToggle}
                      />
                    }
                  />
                  <Divider />
                  <SettingRow
                    icon={<Bot className="h-[18px] w-[18px] text-[#78716C]" />}
                    label="功能开关"
                    onClick={() => setFeatureTogglesDialogOpen(true)}
                    right={<ChevronRight className="h-4 w-4 text-[#D6D3D1] dark:text-[#57534E]" />}
                  />
                </>
              )}
            </SectionCard>
          </section>

          <section className="space-y-2">
            <SectionTitle>AI 设置</SectionTitle>
            <SectionCard>
              <SettingRow
                icon={<Key className="h-[18px] w-[18px] text-[#78716C]" />}
                label="AI API Key"
                onClick={handleOpenLlmDialog}
                right={
                  <div className="flex items-center gap-1">
                    <span className="text-sm text-[#A8A29E]">{llmApiKeyDraft ? '已配置' : '未配置'}</span>
                    <ChevronRight className="h-4 w-4 text-[#D6D3D1] dark:text-[#57534E]" />
                  </div>
                }
              />
            </SectionCard>
          </section>

          <section ref={sectionAboutRef} className="space-y-5" data-testid="new-settings-desktop-vc-section-about">
            <MoreSection
              onNavigateUpdate={() => navigate({ to: '/update' })}
              onComingSoon={showComingSoon}
            />

            <AboutSection
              appVersion={versionBuildInfo.appVersion}
              buildHash={versionBuildInfo.buildHash}
              onOpenOfficialWebsite={handleOpenOfficialWebsite}
              onOpenSponsor={handleOpenSponsor}
              onOpenLegalSupport={handleOpenLegalSupport}
            />
          </section>

          <section ref={sectionDangerRef} className="space-y-2" data-testid="new-settings-desktop-vc-section-danger">
            <SectionTitle>危险区域</SectionTitle>
            <div className="overflow-hidden rounded-2xl border border-[#DC2626] bg-white dark:bg-[#1C1917]">
              <div className="flex items-center justify-between px-4 py-[14px]">
                <div>
                  <p className="text-sm text-[#1C1917] dark:text-[#FAFAF9]">清空本地缓存</p>
                  <p className="mt-1 text-xs text-[#A8A29E]">将清除设备上的临时设置与缓存</p>
                </div>
                <button
                  type="button"
                  onClick={showComingSoon}
                  className="rounded-md bg-[#DC2626] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#B91C1C]"
                >
                  立即清空
                </button>
              </div>
              <div className="mx-4 h-px bg-[#F0ECE8] dark:bg-[#292524]" />
              <div className="flex items-center justify-between px-4 py-[14px]">
                <div>
                  <p className="text-sm text-[#1C1917] dark:text-[#FAFAF9]">重置所有设置</p>
                  <p className="mt-1 text-xs text-[#A8A29E]">恢复默认配置，不影响历史事件数据</p>
                </div>
                <button
                  type="button"
                  onClick={showComingSoon}
                  className="rounded-md bg-[#DC2626] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#B91C1C]"
                >
                  恢复默认
                </button>
              </div>
            </div>
          </section>

          {statusMessage && (
            <div className="rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
              {statusMessage}
            </div>
          )}
          {errorMessage && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {errorMessage}
            </div>
          )}

          <footer className="flex flex-col items-center gap-1 pt-2 text-xs text-[#A8A29E]">
            <span>ExoMind {versionBuildInfo.appVersion}</span>
            <span>Build {versionBuildInfo.buildHash}</span>
          </footer>
        </div>
      </div>
    </div>
  );

  return (
    <div
      className={isDesktopVcLayout ? 'h-full min-h-full bg-[#FAF7F5] dark:bg-[#0C0A09]' : 'min-h-full bg-[#FAF7F5] dark:bg-[#0C0A09]'}
    >
      {/* Hidden file input for import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={handleFileInputChange}
      />

      {isDesktopVcLayout ? renderDesktopVcContent() : (
        <>

      {/* Header */}
      <header className="flex items-center justify-center px-6 py-3">
        <h1 className="text-lg font-semibold leading-[1.5] text-[#1C1917] dark:text-[#FAFAF9]">设置</h1>
      </header>

      {/* Settings Content */}
      <div className="space-y-5 px-5 pb-[calc(env(safe-area-inset-bottom,0px)+108px)] pt-2">

        {/* ── User Card ── */}
        <UserCard />

        {/* ── Theme Section (外观) ── */}
        <section className="space-y-2">
          <SectionTitle>外观</SectionTitle>
          <SectionCard>
            <div className="flex items-center justify-between px-4 py-[14px]">
              <div className="flex items-center gap-3">
                <MoonStar className="h-[18px] w-[18px] text-[#78716C]" />
                <span className="text-sm text-[#1C1917] dark:text-[#FAFAF9]">主题</span>
              </div>
              <div
                id="theme-preference-new"
                role="group"
                aria-label="主题"
                className="flex items-center rounded-[10px] bg-[#F5F0ED] p-[3px] dark:bg-[#292524]"
              >
                <button
                  type="button"
                  data-testid="new-settings-theme-system"
                  aria-pressed={themePreference === 'system'}
                  onClick={() => handleThemePreferenceChange('system')}
                  disabled={loading}
                  className={`flex items-center gap-1 rounded-[8px] px-2.5 py-1.5 text-xs transition-colors disabled:cursor-not-allowed ${
                    themePreference === 'system'
                      ? 'bg-white font-medium text-[#1C1917] shadow-[0_1px_3px_rgba(0,0,0,0.08)] dark:bg-[#44403C] dark:text-[#FAFAF9]'
                      : 'text-[#A8A29E]'
                  }`}
                >
                  <Monitor className="h-3.5 w-3.5" />
                  自动
                </button>
                <button
                  type="button"
                  data-testid="new-settings-theme-light"
                  aria-pressed={themePreference === 'light'}
                  onClick={() => handleThemePreferenceChange('light')}
                  disabled={loading}
                  className={`flex items-center gap-1 rounded-[8px] px-2.5 py-1.5 text-xs transition-colors disabled:cursor-not-allowed ${
                    themePreference === 'light'
                      ? 'bg-white font-medium text-[#1C1917] shadow-[0_1px_3px_rgba(0,0,0,0.08)] dark:bg-[#44403C] dark:text-[#FAFAF9]'
                      : 'text-[#A8A29E]'
                  }`}
                >
                  <Sun className="h-3.5 w-3.5" />
                  浅色
                </button>
                <button
                  type="button"
                  data-testid="new-settings-theme-dark"
                  aria-pressed={themePreference === 'dark'}
                  onClick={() => handleThemePreferenceChange('dark')}
                  disabled={loading}
                  className={`flex items-center gap-1 rounded-[8px] px-2.5 py-1.5 text-xs transition-colors disabled:cursor-not-allowed ${
                    themePreference === 'dark'
                      ? 'bg-white font-medium text-[#1C1917] shadow-[0_1px_3px_rgba(0,0,0,0.08)] dark:bg-[#44403C] dark:text-[#FAFAF9]'
                      : 'text-[#A8A29E]'
                  }`}
                >
                  <Moon className="h-3.5 w-3.5" />
                  深色
                </button>
              </div>
            </div>
          </SectionCard>
        </section>

        {/* ── Timer Section (计时器) ── */}
        <section className="space-y-2">
          <SectionTitle>计时器</SectionTitle>
          <SectionCard>
            <SettingRow
              icon={<Timer className="h-[18px] w-[18px] text-[#78716C]" />}
              label="倒计时结束"
              onClick={() => setCountdownModeDialogOpen(true)}
              right={
                <div className="flex items-center gap-1">
                  <span className="text-sm text-[#A8A29E]">{countdownEndModeLabel}</span>
                  <ChevronRight className="h-4 w-4 text-[#D6D3D1] dark:text-[#57534E]" />
                </div>
              }
            />
            <Divider />
            <SettingRow
              icon={<Bell className="h-[18px] w-[18px] text-[#78716C]" />}
              label="提示音"
              onClick={() => setSoundPickerOpen(true)}
              right={
                <div className="flex items-center gap-1">
                  <span className="text-sm text-[#A8A29E]">{currentSoundLabel}</span>
                  <ChevronRight className="h-4 w-4 text-[#D6D3D1] dark:text-[#57534E]" />
                </div>
              }
            />
          </SectionCard>
        </section>

        {/* ── Input Section (输入) ── */}
        <section className="space-y-2" data-testid="new-settings-input-section">
          <SectionTitle>输入</SectionTitle>
          <SectionCard>
            <div data-testid="new-settings-voice-transcript-mode-row">
              <SettingRow
                icon={<Mic className="h-[18px] w-[18px] text-[#78716C]" />}
                label="语音转写后"
                right={(
                  <div
                    role="group"
                    aria-label="语音转写后行为"
                    className="flex items-center rounded-[10px] bg-[#F5F0ED] p-[3px] dark:bg-[#292524]"
                  >
                    <button
                      type="button"
                      data-testid="new-settings-voice-transcript-mode-insert"
                      aria-pressed={voiceTranscriptSendMode === 'insert'}
                      onClick={() => handleVoiceTranscriptSendModeChange('insert')}
                      disabled={loading}
                      className={`rounded-[8px] px-2.5 py-1.5 text-xs transition-colors disabled:cursor-not-allowed ${
                        voiceTranscriptSendMode === 'insert'
                          ? 'bg-white font-medium text-[#1C1917] shadow-[0_1px_3px_rgba(0,0,0,0.08)] dark:bg-[#44403C] dark:text-[#FAFAF9]'
                          : 'text-[#A8A29E]'
                      }`}
                    >
                      插入输入框
                    </button>
                    <button
                      type="button"
                      data-testid="new-settings-voice-transcript-mode-direct-send"
                      aria-pressed={voiceTranscriptSendMode === 'direct-send'}
                      onClick={() => handleVoiceTranscriptSendModeChange('direct-send')}
                      disabled={loading}
                      className={`rounded-[8px] px-2.5 py-1.5 text-xs transition-colors disabled:cursor-not-allowed ${
                        voiceTranscriptSendMode === 'direct-send'
                          ? 'bg-white font-medium text-[#1C1917] shadow-[0_1px_3px_rgba(0,0,0,0.08)] dark:bg-[#44403C] dark:text-[#FAFAF9]'
                          : 'text-[#A8A29E]'
                      }`}
                    >
                      直接发送
                    </button>
                  </div>
                )}
              />
            </div>
            <div className="pb-[14px] pl-[46px] pr-4">
              <span className="text-xs text-[#A8A29E]">仅作用于「当下」页面输入框，默认插入输入框</span>
            </div>
            <Divider />
            <div data-testid="new-settings-voice-shortcut-row">
              <SettingRow
                icon={<Mic className="h-[18px] w-[18px] text-[#78716C]" />}
                label="全局语音快捷键"
                right={(
                  <div
                    role="group"
                    aria-label="全局语音快捷键"
                    className="flex items-center rounded-[10px] bg-[#F5F0ED] p-[3px] dark:bg-[#292524]"
                  >
                    {VOICE_SHORTCUT_HOTKEY_VALUES.map((hotkey) => {
                      const testId = hotkey === 'Alt+Q'
                        ? 'new-settings-voice-shortcut-alt-q'
                        : hotkey === 'Alt+W'
                          ? 'new-settings-voice-shortcut-alt-w'
                          : 'new-settings-voice-shortcut-ctrl-space';
                      return (
                        <button
                          key={hotkey}
                          type="button"
                          data-testid={testId}
                          aria-pressed={voiceShortcutHotkey === hotkey}
                          onClick={() => handleVoiceShortcutHotkeyChange(hotkey)}
                          disabled={loading}
                          className={`rounded-[8px] px-2.5 py-1.5 text-xs transition-colors disabled:cursor-not-allowed ${
                            voiceShortcutHotkey === hotkey
                              ? 'bg-white font-medium text-[#1C1917] shadow-[0_1px_3px_rgba(0,0,0,0.08)] dark:bg-[#44403C] dark:text-[#FAFAF9]'
                              : 'text-[#A8A29E]'
                          }`}
                        >
                          {hotkey}
                        </button>
                      );
                    })}
                  </div>
                )}
              />
            </div>
            <div className="pb-[14px] pl-[46px] pr-4">
              <span className="text-xs text-[#A8A29E]">Shortcut Voice（快捷键语音）默认 Alt+Q，按一次开始再按一次结束</span>
            </div>
            <Divider />
            <div data-testid="new-settings-voice-token-row">
              <SettingRow
                icon={<Bot className="h-[18px] w-[18px] text-[#78716C]" />}
                label="MOSS API Token"
                onClick={handleOpenVoiceInputSettings}
                right={
                  <div className="flex items-center gap-1">
                    <span className="text-sm text-[#A8A29E]">{mossApiKeyStatusLabel}</span>
                    <ChevronRight className="h-4 w-4 text-[#D6D3D1] dark:text-[#57534E]" />
                  </div>
                }
              />
            </div>
            <Divider />
            <div data-testid="new-settings-moss-test-row">
              <SettingRow
                icon={<Bot className="h-[18px] w-[18px] text-[#78716C]" />}
                label="MOSS 语音测试"
                onClick={handleOpenVoiceTest}
                right={
                  <div className="flex items-center gap-1">
                    <span className="text-sm text-[#A8A29E]">{voiceTestStatusLabel}</span>
                    <ChevronRight className="h-4 w-4 text-[#D6D3D1] dark:text-[#57534E]" />
                  </div>
                }
              />
            </div>
            <Divider />
            <div data-testid="new-settings-volcano-test-row">
              <SettingRow
                icon={<Mic className="h-[18px] w-[18px] text-[#78716C]" />}
                label="火山引擎 ASR 测试"
                onClick={handleOpenVolcanoTest}
                right={
                  <div className="flex items-center gap-1">
                    <span className="text-sm text-[#A8A29E]">{voiceTestStatusLabel}</span>
                    <ChevronRight className="h-4 w-4 text-[#D6D3D1] dark:text-[#57534E]" />
                  </div>
                }
              />
            </div>
          </SectionCard>
        </section>

        {/* ── Feedback Section (反馈) ── */}
        <section className="space-y-2" data-testid="new-settings-feedback-section">
          <SectionTitle>时间块反馈</SectionTitle>
          <SectionCard>
            <div data-testid="new-settings-feedback-content-row">
              <SettingRow
                icon={<List className="h-[18px] w-[18px] text-[#78716C]" />}
                label="反馈内容"
                right={(
                  <div
                    role="group"
                    aria-label="时间块反馈内容"
                    className="flex items-center rounded-[10px] bg-[#F5F0ED] p-[3px] dark:bg-[#292524]"
                  >
                    <button
                      type="button"
                      data-testid="new-settings-feedback-content-timing"
                      aria-pressed={feedbackPreferences.timingInfoEnabled}
                      onClick={() => handleFeedbackPreferenceToggle('timingInfoEnabled')}
                      disabled={loading}
                      className={`rounded-l-[8px] rounded-r-none px-2.5 py-1.5 text-xs transition-colors disabled:cursor-not-allowed ${
                        feedbackPreferences.timingInfoEnabled
                          ? 'bg-white font-medium text-[#1C1917] shadow-[0_1px_3px_rgba(0,0,0,0.08)] dark:bg-[#44403C] dark:text-[#FAFAF9]'
                          : 'text-[#A8A29E]'
                      }`}
                    >
                      时刻信息
                    </button>
                    <button
                      type="button"
                      data-testid="new-settings-feedback-content-statistics"
                      aria-pressed={feedbackPreferences.statisticsEnabled}
                      onClick={() => handleFeedbackPreferenceToggle('statisticsEnabled')}
                      disabled={loading}
                      className={`rounded-none px-2.5 py-1.5 text-xs transition-colors disabled:cursor-not-allowed ${
                        feedbackPreferences.statisticsEnabled
                          ? 'bg-white font-medium text-[#1C1917] shadow-[0_1px_3px_rgba(0,0,0,0.08)] dark:bg-[#44403C] dark:text-[#FAFAF9]'
                          : 'text-[#A8A29E]'
                      }`}
                    >
                      统计信息
                    </button>
                    <button
                      type="button"
                      data-testid="new-settings-feedback-content-quick"
                      aria-pressed={feedbackPreferences.quickFeedbackEnabled}
                      onClick={() => handleFeedbackPreferenceToggle('quickFeedbackEnabled')}
                      disabled={loading}
                      className={`rounded-l-none rounded-r-[8px] px-2.5 py-1.5 text-xs transition-colors disabled:cursor-not-allowed ${
                        feedbackPreferences.quickFeedbackEnabled
                          ? 'bg-white font-medium text-[#1C1917] shadow-[0_1px_3px_rgba(0,0,0,0.08)] dark:bg-[#44403C] dark:text-[#FAFAF9]'
                          : 'text-[#A8A29E]'
                      }`}
                    >
                      快速反馈
                    </button>
                  </div>
                )}
              />
            </div>
            <div className="pb-[14px] pl-[46px] pr-4">
              <span className="text-xs text-[#A8A29E]">可多选，默认仅开启快速反馈</span>
            </div>
          </SectionCard>
        </section>

        {/* ── AI Section (AI 设置) ── */}
        <section className="space-y-2">
          <SectionTitle>AI 设置</SectionTitle>
          <SectionCard>
            <SettingRow
              icon={<Key className="h-[18px] w-[18px] text-[#78716C]" />}
              label="AI API Key"
              onClick={handleOpenLlmDialog}
              right={
                <div className="flex items-center gap-1">
                  <span className="text-sm text-[#A8A29E]">{llmApiKeyDraft ? '已配置' : '未配置'}</span>
                  <ChevronRight className="h-4 w-4 text-[#D6D3D1] dark:text-[#57534E]" />
                </div>
              }
            />
          </SectionCard>
        </section>

        {/* ── Sync Section (同步) ── */}
        <section className="space-y-2">
          <SectionTitle>同步</SectionTitle>
          <SectionCard>
            <SettingRow
              icon={<Wifi className="h-[18px] w-[18px] text-[#78716C]" />}
              label="同步服务器"
              onClick={() => setSyncDialogOpen(true)}
              right={
                <div className="flex items-center gap-1">
                  <span className="text-sm text-[#A8A29E]">{syncHost}</span>
                  <ChevronRight className="h-4 w-4 text-[#D6D3D1] dark:text-[#57534E]" />
                </div>
              }
            />
          </SectionCard>
        </section>

        {/* ── Import/Export Section (数据) ── */}
        <section className="space-y-2">
          <SectionTitle>数据</SectionTitle>
          <SectionCard>
            <SettingRow
              icon={<Download className="h-[18px] w-[18px] text-[#78716C]" />}
              label="导出备份"
              onClick={handleExportBackup}
              right={<ChevronRight className="h-4 w-4 text-[#D6D3D1] dark:text-[#57534E]" />}
            />
            <Divider />
            <SettingRow
              icon={<Upload className="h-[18px] w-[18px] text-[#78716C]" />}
              label="导入数据"
              onClick={handleImportBackup}
              right={<ChevronRight className="h-4 w-4 text-[#D6D3D1] dark:text-[#57534E]" />}
            />
          </SectionCard>
        </section>

        <MoreSection
          onNavigateUpdate={() => navigate({ to: '/update' })}
          onComingSoon={showComingSoon}
        />

        <AboutSection
          appVersion={versionBuildInfo.appVersion}
          buildHash={versionBuildInfo.buildHash}
          onOpenOfficialWebsite={handleOpenOfficialWebsite}
          onOpenSponsor={handleOpenSponsor}
          onOpenLegalSupport={handleOpenLegalSupport}
        />

        {/* ── Developer Section (开发者) ── */}
        <section className="space-y-2">
          <SectionTitle>开发者</SectionTitle>
          <SectionCard>
            <SettingRow
              icon={<Code className="h-[18px] w-[18px] text-[#78716C]" />}
              label="开发者模式"
              right={
                <Switch
                  checked={developerMode}
                  onCheckedChange={handleDeveloperModeToggle}
                />
              }
            />
            {developerMode && (
              <>
                <div className="pb-[14px] pl-[46px] pr-4">
                  <span className="text-xs text-[#A8A29E]">开启后可使用语音测试等实验功能</span>
                </div>
                <SettingRow
                  icon={<Code className="h-[18px] w-[18px] text-[#78716C]" />}
                  label="使用测试数据"
                  right={
                    <Switch
                      data-testid="new-settings-use-mock-data-switch"
                      checked={useMockData}
                      onCheckedChange={handleUseMockDataToggle}
                    />
                  }
                />
                <Divider />
                <SettingRow
                  icon={<Code className="h-[18px] w-[18px] text-[#78716C]" />}
                  label="开发者工具"
                  right={
                    <Switch
                      data-testid="new-settings-devtools-switch"
                      checked={devtoolsEnabled}
                      onCheckedChange={handleDevtoolsToggle}
                    />
                  }
                />
                <Divider />
                <SettingRow
                  icon={<Bot className="h-[18px] w-[18px] text-[#78716C]" />}
                  label="功能开关"
                  onClick={() => setFeatureTogglesDialogOpen(true)}
                  right={<ChevronRight className="h-4 w-4 text-[#D6D3D1] dark:text-[#57534E]" />}
                />
              </>
            )}
          </SectionCard>
        </section>

        <section className="space-y-2">
          <SectionTitle>危险区域</SectionTitle>
          <div className="overflow-hidden rounded-2xl border border-[#DC2626] bg-white dark:bg-[#1C1917]">
            <div className="flex items-center justify-between px-4 py-[14px]">
              <div>
                <p className="text-sm text-[#1C1917] dark:text-[#FAFAF9]">清空本地缓存</p>
                <p className="mt-1 text-xs text-[#A8A29E]">将清除设备上的临时设置与缓存</p>
              </div>
              <button
                type="button"
                onClick={showComingSoon}
                className="rounded-md bg-[#DC2626] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#B91C1C]"
              >
                立即清空
              </button>
            </div>
            <div className="mx-4 h-px bg-[#F0ECE8] dark:bg-[#292524]" />
            <div className="flex items-center justify-between px-4 py-[14px]">
              <div>
                <p className="text-sm text-[#1C1917] dark:text-[#FAFAF9]">重置所有设置</p>
                <p className="mt-1 text-xs text-[#A8A29E]">恢复默认配置，不影响历史事件数据</p>
              </div>
              <button
                type="button"
                onClick={showComingSoon}
                className="rounded-md bg-[#DC2626] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#B91C1C]"
              >
                恢复默认
              </button>
            </div>
          </div>
        </section>

        {/* Status / Error messages */}
        {statusMessage && (
          <div className="rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
            {statusMessage}
          </div>
        )}
        {errorMessage && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {errorMessage}
          </div>
        )}
      </div>
        </>
      )}

      {/* Coming Soon Toast */}
      {comingSoonVisible && (
        <div className={`fixed inset-x-0 z-50 flex justify-center ${isDesktopVcLayout ? 'bottom-8' : 'bottom-28'}`}>
          <div className="rounded-full bg-[#1C1917] px-4 py-2 text-sm text-white shadow-lg dark:bg-[#FAFAF9] dark:text-[#1C1917]">
            即将推出
          </div>
        </div>
      )}

      {/* ── Countdown End Mode Dialog ── */}
      <Dialog open={countdownModeDialogOpen} onOpenChange={setCountdownModeDialogOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>倒计时结束模式</DialogTitle>
            <DialogDescription>选择倒计时结束后的行为</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => handleCountdownEndModeChange('hard')}
              className="flex w-full items-center justify-between rounded-xl border border-[#F0ECE8] px-4 py-3 text-left text-sm hover:bg-[#FAF7F5] dark:border-[#292524] dark:hover:bg-[#1C1917]"
            >
              <div>
                <div className="font-medium text-[#1C1917] dark:text-[#FAFAF9]">硬停止</div>
                <div className="mt-0.5 text-xs text-[#A8A29E]">倒计时结束后立即停止</div>
              </div>
              {timerPreferences.countdownEndMode === 'hard' && <Check className="h-4 w-4 text-[#C75B3A]" />}
            </button>
            <button
              type="button"
              onClick={() => handleCountdownEndModeChange('soft')}
              className="flex w-full items-center justify-between rounded-xl border border-[#F0ECE8] px-4 py-3 text-left text-sm hover:bg-[#FAF7F5] dark:border-[#292524] dark:hover:bg-[#1C1917]"
            >
              <div>
                <div className="font-medium text-[#1C1917] dark:text-[#FAFAF9]">柔和提醒</div>
                <div className="mt-0.5 text-xs text-[#A8A29E]">倒计时结束后继续计时并提醒</div>
              </div>
              {timerPreferences.countdownEndMode === 'soft' && <Check className="h-4 w-4 text-[#C75B3A]" />}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Sound Picker Dialog ── */}
      <Dialog open={soundPickerOpen} onOpenChange={setSoundPickerOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>选择提示音</DialogTitle>
            <DialogDescription>倒计时结束时播放的提示音</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => handleSoundPresetChange('off')}
              className="flex w-full items-center justify-between rounded-xl border border-[#F0ECE8] px-4 py-3 text-left text-sm hover:bg-[#FAF7F5] dark:border-[#292524] dark:hover:bg-[#1C1917]"
            >
              <span className="text-[#1C1917] dark:text-[#FAFAF9]">关闭提示音</span>
              {!timerPreferences.countdownEndSoundEnabled && <Check className="h-4 w-4 text-[#C75B3A]" />}
            </button>

            {TIMER_END_SOUND_PRESETS.map((preset) => {
              const selected = timerPreferences.countdownEndSoundEnabled
                && timerPreferences.countdownEndSoundPresetId === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleSoundPresetChange(preset.id)}
                  className="flex w-full items-center justify-between rounded-xl border border-[#F0ECE8] px-4 py-3 text-left text-sm hover:bg-[#FAF7F5] dark:border-[#292524] dark:hover:bg-[#1C1917]"
                >
                  <span className="text-[#1C1917] dark:text-[#FAFAF9]">{preset.label}</span>
                  {selected && <Check className="h-4 w-4 text-[#C75B3A]" />}
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Voice Input Dialog ── */}
      <Dialog open={voiceInputDialogOpen} onOpenChange={setVoiceInputDialogOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>语音输入设置</DialogTitle>
            <DialogDescription>配置 MOSS API Token（仅保存在当前设备）</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <input
              type={showMossApiKey ? 'text' : 'password'}
              value={mossApiKeyDraft}
              onChange={(e) => setMossApiKeyDraft(e.target.value)}
              placeholder="输入 MOSS API Token"
              className="w-full rounded-xl border border-[#F0ECE8] bg-white px-4 py-3 text-sm text-[#1C1917] outline-none placeholder:text-[#D6D3D1] focus:border-[#C75B3A] focus:ring-1 focus:ring-[#C75B3A] dark:border-[#292524] dark:bg-[#1C1917] dark:text-[#FAFAF9] dark:placeholder:text-[#57534E]"
            />
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setShowMossApiKey((prev) => !prev)}
                className="text-xs text-[#78716C] underline-offset-2 hover:underline dark:text-[#A8A29E]"
              >
                {showMossApiKey ? '隐藏 Token' : '显示 Token'}
              </button>
              <span className="text-xs text-[#A8A29E]">用于新 UI 语音输入转写</span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setVoiceInputDialogOpen(false)}
                className="flex-1 rounded-xl border border-[#F0ECE8] px-4 py-2.5 text-sm font-medium text-[#78716C] hover:bg-[#FAF7F5] dark:border-[#292524] dark:text-[#A8A29E] dark:hover:bg-[#1C1917]"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleClearMossApiKey}
                className="flex-1 rounded-xl border border-[#F0ECE8] px-4 py-2.5 text-sm font-medium text-[#78716C] hover:bg-[#FAF7F5] dark:border-[#292524] dark:text-[#A8A29E] dark:hover:bg-[#1C1917]"
              >
                清除
              </button>
              <button
                type="button"
                onClick={handleSaveMossApiKey}
                className="flex-1 rounded-xl bg-[#C75B3A] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#B5502F]"
              >
                保存
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── LLM Settings Dialog ── */}
      <Dialog open={llmDialogOpen} onOpenChange={setLlmDialogOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>AI 设置</DialogTitle>
            <DialogDescription>配置 Agent 对话使用的大语言模型（OpenAI 兼容格式）</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#78716C] dark:text-[#A8A29E]">API Key</label>
              <input
                type="password"
                value={llmApiKeyDraft}
                onChange={(e) => setLlmApiKeyDraft(e.target.value)}
                placeholder="sk-..."
                className="w-full rounded-xl border border-[#F0ECE8] bg-white px-4 py-3 text-sm text-[#1C1917] outline-none placeholder:text-[#D6D3D1] focus:border-[#C75B3A] focus:ring-1 focus:ring-[#C75B3A] dark:border-[#292524] dark:bg-[#1C1917] dark:text-[#FAFAF9] dark:placeholder:text-[#57534E]"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#78716C] dark:text-[#A8A29E]">Base URL</label>
              <input
                type="url"
                value={llmBaseUrlDraft}
                onChange={(e) => setLlmBaseUrlDraft(e.target.value)}
                placeholder="https://api.openai.com/v1"
                className="w-full rounded-xl border border-[#F0ECE8] bg-white px-4 py-3 text-sm text-[#1C1917] outline-none placeholder:text-[#D6D3D1] focus:border-[#C75B3A] focus:ring-1 focus:ring-[#C75B3A] dark:border-[#292524] dark:bg-[#1C1917] dark:text-[#FAFAF9] dark:placeholder:text-[#57534E]"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#78716C] dark:text-[#A8A29E]">模型</label>
              <input
                type="text"
                value={llmModelDraft}
                onChange={(e) => setLlmModelDraft(e.target.value)}
                placeholder="gpt-4o"
                className="w-full rounded-xl border border-[#F0ECE8] bg-white px-4 py-3 text-sm text-[#1C1917] outline-none placeholder:text-[#D6D3D1] focus:border-[#C75B3A] focus:ring-1 focus:ring-[#C75B3A] dark:border-[#292524] dark:bg-[#1C1917] dark:text-[#FAFAF9] dark:placeholder:text-[#57534E]"
              />
            </div>
            <p className="text-xs text-[#A8A29E]">支持 OpenAI、DeepSeek、Moonshot 等兼容 API</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setLlmDialogOpen(false)}
                className="flex-1 rounded-xl border border-[#F0ECE8] px-4 py-2.5 text-sm font-medium text-[#78716C] hover:bg-[#FAF7F5] dark:border-[#292524] dark:text-[#A8A29E] dark:hover:bg-[#1C1917]"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSaveLlmSettings}
                className="flex-1 rounded-xl bg-[#C75B3A] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#B5502F]"
              >
                保存
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Feature Toggles Drawer ── */}
      <Drawer open={featureTogglesDialogOpen} onOpenChange={setFeatureTogglesDialogOpen}>
        <DrawerContent className="dark:bg-[#1C1917]">
          <div className="px-5 pb-8 pt-2">
            <DrawerTitle className="text-center text-base font-semibold text-[#1C1917] dark:text-[#FAFAF9]">
              功能开关
            </DrawerTitle>
            <p className="mt-1 text-center text-xs text-[#A8A29E]">启用或关闭实验性功能</p>
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between rounded-xl border border-[#F0ECE8] px-4 py-3 dark:border-[#292524]">
                <span className="text-sm text-[#1C1917] dark:text-[#FAFAF9]">桌面端适配</span>
                <Switch
                  data-testid="new-settings-desktop-adaptive-switch"
                  checked={desktopAdaptiveEnabled}
                  onCheckedChange={handleDesktopAdaptiveToggle}
                />
              </div>
              <div className="flex items-center justify-between rounded-xl border border-[#F0ECE8] px-4 py-3 dark:border-[#292524]">
                <div className="flex items-center gap-2">
                  <Bot className="h-[16px] w-[16px] text-[#78716C]" />
                  <span className="text-sm text-[#1C1917] dark:text-[#FAFAF9]">Agent 页面</span>
                </div>
                <Switch
                  data-testid="feature-toggle-agent-page-switch"
                  checked={agentPageEnabled}
                  onCheckedChange={handleAgentPageEnabledToggle}
                />
              </div>
              <div
                className="flex items-center justify-between rounded-xl border border-[#F0ECE8] px-4 py-3 dark:border-[#292524]"
                data-testid="feature-toggle-command-palette-row"
              >
                <div className="flex items-center gap-2">
                  <Command className="h-[16px] w-[16px] text-[#78716C]" />
                  <span className="text-sm text-[#1C1917] dark:text-[#FAFAF9]">命令面板</span>
                </div>
                <Switch
                  data-testid="feature-toggle-command-palette-switch"
                  checked={commandPaletteEnabled}
                  onCheckedChange={handleCommandPaletteToggle}
                />
              </div>
            </div>
          </div>
        </DrawerContent>
      </Drawer>

      {/* ── Sync Server Dialog ── */}
      <Dialog open={syncDialogOpen} onOpenChange={setSyncDialogOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>同步服务器</DialogTitle>
            <DialogDescription>设置事件日志同步的服务器地址</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <input
              type="url"
              value={syncServerUrl}
              onChange={(e) => setSyncServerUrl(e.target.value)}
              placeholder="https://example.com"
              className="w-full rounded-xl border border-[#F0ECE8] bg-white px-4 py-3 text-sm text-[#1C1917] outline-none placeholder:text-[#D6D3D1] focus:border-[#C75B3A] focus:ring-1 focus:ring-[#C75B3A] dark:border-[#292524] dark:bg-[#1C1917] dark:text-[#FAFAF9] dark:placeholder:text-[#57534E]"
            />
            {errorMessage && (
              <p className="text-xs text-red-500">{errorMessage}</p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSyncDialogOpen(false)}
                className="flex-1 rounded-xl border border-[#F0ECE8] px-4 py-2.5 text-sm font-medium text-[#78716C] hover:bg-[#FAF7F5] dark:border-[#292524] dark:text-[#A8A29E] dark:hover:bg-[#1C1917]"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSaveSyncServerUrl}
                className="flex-1 rounded-xl bg-[#C75B3A] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#B5502F]"
              >
                保存
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
