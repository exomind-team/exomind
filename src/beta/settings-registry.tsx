import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Activity, Command, Copy, FolderOpen, Keyboard, KeyRound, MapPin, Monitor, RefreshCw } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '@/components/ui/button';
import type { SettingsItem } from '@/ui/app/config/settings/settings-types';
import { DATE_DISPLAY_SETTING_OPTIONS, INPUT_SEND_SETTING_OPTIONS, PORTABLE_SETTINGS, THEME_SETTING_OPTIONS } from '@/ui/app/config/settings/portable-settings';
import { QuickExitShortcutSetting } from '@/ui/app/components/settings/quick-exit-shortcut-setting';
import { getBetaDateDisplayMode, getBetaDesktopAdaptiveEnabled, getBetaOverlayEnabled, getBetaTheme, setBetaDateDisplayMode, setBetaDesktopAdaptiveEnabled, setBetaOverlayEnabled, setBetaTheme, subscribeBetaDisplayPreference } from './preferences';
import { getBetaInputSendMode, setBetaInputSendMode, subscribeBetaInputSendMode } from './input-preferences';
import { betaDesktopPreferences } from './desktop-preferences';

/** Stable custom slots preserve the model editor's component lifetime while
 * registry values change. They contain existing multi-field stateful editors,
 * not alternate renderers for ordinary boolean/enum/string settings. */
export const BetaSettingsPanels = createContext<{ model: HTMLElement | null; alerts: ReactNode; location: ReactNode; diagnostics?: HTMLElement | null; onDiagnosticsMount?: (active: boolean) => void; agentGrants?: HTMLElement | null; onAgentGrantsMount?: (active: boolean) => void }>({ model: null, alerts: null, location: null });
function PanelMount({host,onActive}:{host:HTMLElement|null;onActive?:(active:boolean)=>void}) {
  const mount = useCallback((node: HTMLDivElement | null) => { if (node && host) node.append(host); }, [host]);
  useEffect(()=>{if(!host)return;onActive?.(true);return()=>onActive?.(false);},[host,onActive]);
  return <div className="p-4" ref={mount}/>;
}
function ModelPanel() { return <PanelMount host={useContext(BetaSettingsPanels).model}/>; }
function DiagnosticsPanel() { const panels=useContext(BetaSettingsPanels);return <PanelMount host={panels.diagnostics??null} onActive={panels.onDiagnosticsMount}/>; }
function AgentGrantsPanel() { const panels=useContext(BetaSettingsPanels);return <PanelMount host={panels.agentGrants??null} onActive={panels.onAgentGrantsMount}/>; }
type DeadlineNotificationChannelState = {
  notificationPermission: 'granted' | 'prompt' | 'denied' | 'unavailable';
  notificationsEnabled: boolean;
  channelSupported: boolean;
  channelExists: boolean;
  channelImportance: 'unavailable' | 'blocked' | 'min' | 'low' | 'default' | 'high' | 'max' | 'unknown';
  channelSoundEnabled: boolean | null;
  settingsAvailable: boolean;
};

function parseDeadlineNotificationChannelState(value: unknown): DeadlineNotificationChannelState | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const permissions = ['granted', 'prompt', 'denied', 'unavailable'] as const;
  const importances = ['unavailable', 'blocked', 'min', 'low', 'default', 'high', 'max', 'unknown'] as const;
  if (!(permissions as readonly unknown[]).includes(record.notificationPermission)) return null;
  if (typeof record.notificationsEnabled !== 'boolean' || typeof record.channelSupported !== 'boolean' || typeof record.channelExists !== 'boolean') return null;
  if (!(importances as readonly unknown[]).includes(record.channelImportance)) return null;
  if (record.channelSoundEnabled !== null && typeof record.channelSoundEnabled !== 'boolean') return null;
  if (typeof record.settingsAvailable !== 'boolean') return null;
  return record as DeadlineNotificationChannelState;
}

function DeadlineNotificationChannelSettings() {
  const [state, setState] = useState<DeadlineNotificationChannelState | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  const [reading, setReading] = useState(false);
  const [opening, setOpening] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);
  const mounted = useRef(true);
  const readGeneration = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; readGeneration.current += 1; };
  }, []);

  const refresh = useCallback(async () => {
    const generation = ++readGeneration.current;
    setReading(true);
    setReadFailed(false);
    try {
      const parsed = parseDeadlineNotificationChannelState(
        await invoke<unknown>('beta_deadline_alert_channel_state'),
      );
      if (!parsed) throw new Error('invalid channel state');
      if (mounted.current && generation === readGeneration.current) setState(parsed);
    } catch {
      if (mounted.current && generation === readGeneration.current) setReadFailed(true);
    } finally {
      if (mounted.current && generation === readGeneration.current) setReading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const refreshWhenVisible = () => { if (!document.hidden) void refresh(); };
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [refresh]);

  const openSettings = async () => {
    setOpening(true);
    setOpenFailed(false);
    try {
      await invoke('beta_deadline_alert_open_channel_settings');
    } catch {
      if (mounted.current) setOpenFailed(true);
    } finally {
      if (mounted.current) setOpening(false);
    }
  };

  let explanation = reading && !state ? '正在读取 Android 通知渠道状态…' : '声音状态尚未读取。';
  if (state) {
    if (state.notificationPermission !== 'granted' || !state.notificationsEnabled) {
      explanation = '通知权限未允许；系统提醒与声音都可能不可用。';
    } else if (!state.channelSupported) {
      explanation = '此 Android 版本没有通知渠道；到点提醒使用设备全局通知声音。';
    } else if (!state.channelExists) {
      explanation = 'Android 提醒渠道尚未建立，声音状态未知。';
    } else if (state.channelImportance === 'blocked') {
      explanation = 'Android 已停用此提醒渠道；通知与声音都不可用。';
    } else if (state.channelSoundEnabled === false) {
      explanation = '此提醒渠道没有配置通知声。可在系统设置中为该渠道启用声音或选择系统音效。';
    } else if (state.channelSoundEnabled === true) {
      explanation = 'Android 渠道已配置通知声；系统优先级仍可能降低或抑制声音。';
    } else {
      explanation = 'Android 未提供此渠道的声音状态；请在系统通知设置中查看。';
    }
  }
  if (state?.channelSupported && state.channelExists && state.channelImportance !== 'unavailable') {
    explanation += ` 渠道优先级：${({ blocked: '已停用', min: '最低', low: '低', default: '默认', high: '高', max: '最高', unknown: '未知' } as const)[state.channelImportance] ?? '未知'}。`;
  }
  if (readFailed) {
    explanation = state
      ? `本次读取失败；以下保留上次确认值：${explanation}`
      : 'Android 提醒渠道状态未知，请重新读取或打开系统设置。';
  }

  return <section className="space-y-2 border-t border-border-page pt-3" data-testid="beta-deadline-notification-sound-settings" aria-label="提醒声音设置">
    <p className="text-xs font-medium text-secondary">到点提醒声音</p>
    <p role={readFailed ? 'alert' : 'status'} className="text-xs text-secondary">{readFailed ? 'Android 提醒渠道状态未知，请重新读取。' : explanation}</p>
    {readFailed && state && <p className="text-xs text-secondary">{explanation}</p>}
    {state?.channelSupported === false && <p className="text-xs text-secondary">此版本使用设备全局通知声音，修改会影响其他应用的通知声音。</p>}
    <p className="text-xs text-muted">勿扰、静音模式、通知音量和系统通知策略由 Android 裁决；设置状态不证明声音已播放。</p>
    {openFailed && <p role="alert" className="text-xs text-destructive">无法打开 Android 提醒渠道设置。请在系统设置的应用通知中查找“时间块到点”。</p>}
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" disabled={reading} onClick={() => { void refresh(); }}>
        {reading ? '正在读取…' : '重新读取声音状态'}
      </Button>
      <Button type="button" variant="outline" size="sm" className="min-h-11" disabled={opening || state?.settingsAvailable === false} onClick={() => { void openSettings(); }}>
        {opening ? '正在打开…' : state?.channelSupported === false ? '打开系统通知声音设置' : state?.channelSupported ? '打开 Android 时间块提醒渠道设置' : '打开 Android 通知声音设置'}
      </Button>
    </div>
  </section>;
}

function AlertsPanel() {
  const alerts = useContext(BetaSettingsPanels).alerts;
  return <div className="space-y-4 p-4">
    {alerts}
    <DeadlineNotificationChannelSettings />
  </div>;
}
function LocationPanel() { return <div className="px-4 py-4">{useContext(BetaSettingsPanels).location}</div>; }

export interface BetaSettingsBindings {
  nativeDesktop: boolean;
  android: boolean;
  desktopLoading: boolean;
  desktopError: string;
  profileName: string;
  profileId: string;
  appVersion: string;
  buildHash: string;
  fullscreen: { get: () => boolean; set: (enabled: boolean) => Promise<boolean> };
  refreshDesktop: () => Promise<void>;
  onManageProfile?: () => void;
  onDisconnect?: () => void;
}
const subscribeTheme = (listener: (value: string) => void) => subscribeBetaDisplayPreference(() => listener(getBetaTheme()));
const subscribeDate = (listener: (value: string) => void) => subscribeBetaDisplayPreference(() => listener(getBetaDateDisplayMode()));
const subscribeDesktopAdaptive = (listener: (value: boolean) => void) => subscribeBetaDisplayPreference(() => listener(getBetaDesktopAdaptiveEnabled()));
const subscribeOverlay = (listener: (value: boolean) => void) => subscribeBetaDisplayPreference(() => listener(getBetaOverlayEnabled()));
const subscribeShortcut = (listener: (value: string) => void) => betaDesktopPreferences.subscribe(() => { const value = betaDesktopPreferences.get(); if (value) listener(value.shortcut ?? ''); });
const subscribeQuickFocus = (listener: (value: boolean) => void) => betaDesktopPreferences.subscribe(() => { const value = betaDesktopPreferences.get(); if (value) listener(value.quick_focus); });

/** Same SettingsItem contract and renderer as Alpha. Beta bindings own only
 * persistence/platform differences; no legacy Runtime or profile is opened. */
export function createBetaSettingsRegistry(bindings: BetaSettingsBindings): SettingsItem[] {
  const items: SettingsItem[] = [
    {
      ...PORTABLE_SETTINGS.theme, type: 'enum', options: THEME_SETTING_OPTIONS,
      optionTestId: value => `new-settings-theme-${value}`,
      get: getBetaTheme, set: (value: string) => {
        if (value !== 'system' && value !== 'light' && value !== 'dark') throw new Error('请选择有效的主题');
        setBetaTheme(value);
      }, subscribe: subscribeTheme,
    },
    {
      ...PORTABLE_SETTINGS.date, type: 'enum', options: DATE_DISPLAY_SETTING_OPTIONS,
      get: getBetaDateDisplayMode, set: (value: string) => {
        if (value !== 'compact' && value !== 'full' && value !== 'weekday') throw new Error('请选择有效的日期显示方式');
        setBetaDateDisplayMode(value);
      }, subscribe: subscribeDate,
    },
    {
      ...PORTABLE_SETTINGS.desktopAdaptive, type: 'boolean', visible: () => bindings.nativeDesktop,
      controlTestId: 'new-settings-desktop-adaptive-switch',
      description: '在宽窗口使用桌面布局；关闭后使用紧凑布局，此开关仍可在设置中重新开启。',
      get: getBetaDesktopAdaptiveEnabled, set: setBetaDesktopAdaptiveEnabled, subscribe: subscribeDesktopAdaptive,
      errorMessagePrefix: '桌面端适配未能保存',
    },
    {
      ...PORTABLE_SETTINGS.overlay, type: 'boolean', visible: () => bindings.nativeDesktop,
      controlTestId: 'new-settings-now-overlay-enabled-switch',
      get: getBetaOverlayEnabled, set: value => setBetaOverlayEnabled(value, bindings.profileId), subscribe: subscribeOverlay,
      errorMessagePrefix: '悬浮工作台未能应用',
    },
    {
      ...PORTABLE_SETTINGS.fullscreen, type: 'boolean', visible: () => bindings.android,
      controlTestId: 'new-settings-mobile-fullscreen-switch',
      get: bindings.fullscreen.get, set: bindings.fullscreen.set,
      errorMessagePrefix: '全屏模式切换失败',
    },
    {
      ...PORTABLE_SETTINGS.sendMode, type: 'enum', options: INPUT_SEND_SETTING_OPTIONS,
      optionTestId: value => `new-settings-input-send-mode-${value}`,
      get: getBetaInputSendMode, set: setBetaInputSendMode, subscribe: subscribeBetaInputSendMode,
    },
  ];
  const desktop = betaDesktopPreferences.get();
  if (bindings.nativeDesktop) {
    items.push({
      id: 'quick-exit-shortcut',
      label: '快速退出快捷键',
      icon: Command,
      category: 'input',
      description: '设置一个全局快捷键，在任意窗口按下后退出应用；退出始终走应用生命周期并等待运行时停止。',
      type: 'custom',
      component: QuickExitShortcutSetting,
    });
    if (desktop) {
      items.push({
        ...PORTABLE_SETTINGS.shortcut, type: 'string', stringStyle: 'dialog',
        description: '点击编辑组合键，例如 Ctrl+Shift+Space；清空可关闭。系统登记成功后才生效。',
        dialogTitle: '主窗口全局快捷键', dialogDescription: '使用 Ctrl、Alt、Shift、Super 等修饰键和一个主键，按 + 连接。与其他程序冲突时会保留原有设置并提示。',
        controlTestId: 'new-settings-main-window-shortcut-input', allowClear: true,
        emptyValueLabel: '已关闭', placeholder: 'Ctrl+Shift+Space',
        get: () => betaDesktopPreferences.get()?.shortcut ?? '',
        set: async value => (await betaDesktopPreferences.setShortcut(value.trim() || null)).shortcut ?? '',
        subscribe: subscribeShortcut,
        validate: value => value.trim().length > 128 ? '快捷键过长，请使用组合键表示' : null,
        errorMessagePrefix: '快捷键未能应用',
      }, {
        ...PORTABLE_SETTINGS.quickFocus, type: 'boolean',
        controlTestId: 'new-settings-main-window-shortcut-quick-focus-switch',
        get: () => betaDesktopPreferences.get()?.quick_focus ?? false,
        set: async enabled => (await betaDesktopPreferences.setQuickFocus(enabled)).quick_focus,
        subscribe: subscribeQuickFocus, errorMessagePrefix: '快速聚焦未能保存',
      }, {
        id: 'beta-shortcut-registration', label: '当前已登记的唤起键', icon: Keyboard, category: 'input', type: 'action', hideChevron: true,
        rightText: () => betaDesktopPreferences.get()?.registered_shortcuts.join(' · ') || '未登记',
        description: bindings.desktopError || desktop.error || undefined,
        copyValue: () => betaDesktopPreferences.get()?.registered_shortcuts.join(' · '), onAction: () => {},
      });
    }
    items.push({
      id: 'beta-shortcut-refresh', label: bindings.desktopLoading ? '正在读取快捷键状态…' : '重新读取快捷键状态',
      description: !desktop ? bindings.desktopError || '读取本机实际登记状态后可编辑快捷键。' : undefined,
      category: 'input', type: 'action', icon: RefreshCw, disabled: bindings.desktopLoading,
      onAction: bindings.refreshDesktop,
    });
  }
  if (bindings.android) items.push({ id: 'beta-deadline-alert-settings', label: '安卓系统提醒', category: 'timer', type: 'custom', component: AlertsPanel });
  items.push({ id: 'beta-summary-model-settings', label: '回顾模型', category: 'ai', type: 'custom', component: ModelPanel }, {
    id: 'beta-runtime-location', label: '当前运行位置', category: 'connection', icon: MapPin, type: 'custom', component: LocationPanel,
  }, {
    id: 'beta-current-profile', label: bindings.onManageProfile ? '管理档案' : '当前档案', description: bindings.profileName || '尚未选择档案',
    category: 'data', type: 'action', icon: FolderOpen, hideChevron: !bindings.onManageProfile,
    onAction: bindings.onManageProfile ?? (() => {}),
  }, {
    id: 'beta-profile-id', label: '档案标识', category: 'data', type: 'action', icon: Copy, hideChevron: true,
    rightText: bindings.profileId ? bindings.profileId.slice(0, 8) : '尚未选择', copyValue: bindings.profileId, onAction: () => {},
  }, {
    id: 'beta-agent-grants', label: 'Agent 授权', description: '查看并管理当前档案的 Agent 权限', category: 'data', icon: KeyRound, type: 'custom', component: AgentGrantsPanel,
  }, {
    id: 'beta-runtime-diagnostics', label: '运行诊断', description: 'CPU、内存与本机存储的按需观察', category: 'about', icon: Activity, type: 'custom', component: DiagnosticsPanel,
  }, {
    id: 'about-version', label: '应用版本', category: 'about', type: 'action', icon: Monitor, hideChevron: true,
    rightText: bindings.appVersion, copyValue: bindings.appVersion, onAction: () => {},
  }, {
    id: 'about-build', label: '构建版本', category: 'about', type: 'action', hideChevron: true,
    rightText: bindings.buildHash, copyValue: bindings.buildHash, onAction: () => {},
  });
  if (bindings.onDisconnect) items.push({ id: 'beta-disconnect', label: '断开当前服务', category: 'connection', type: 'action', onAction: bindings.onDisconnect });
  return items;
}
