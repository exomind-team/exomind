import { createContext, useCallback, useContext, useEffect, type ReactNode } from 'react';
import { Activity, Copy, FolderOpen, Keyboard, MapPin, Monitor, RefreshCw } from 'lucide-react';
import type { SettingsItem } from '@/ui/app/config/settings/settings-types';
import { DATE_DISPLAY_SETTING_OPTIONS, INPUT_SEND_SETTING_OPTIONS, PORTABLE_SETTINGS, THEME_SETTING_OPTIONS } from '@/ui/app/config/settings/portable-settings';
import { getBetaDateDisplayMode, getBetaDesktopAdaptiveEnabled, getBetaOverlayEnabled, getBetaTheme, setBetaDateDisplayMode, setBetaDesktopAdaptiveEnabled, setBetaOverlayEnabled, setBetaTheme, subscribeBetaDisplayPreference } from './preferences';
import { getBetaInputSendMode, setBetaInputSendMode, subscribeBetaInputSendMode } from './input-preferences';
import { betaDesktopPreferences } from './desktop-preferences';

/** Stable custom slots preserve the model editor's component lifetime while
 * registry values change. They contain existing multi-field stateful editors,
 * not alternate renderers for ordinary boolean/enum/string settings. */
export const BetaSettingsPanels = createContext<{ model: HTMLElement | null; alerts: ReactNode; location: ReactNode; diagnostics?: HTMLElement | null; onDiagnosticsMount?: (active: boolean) => void }>({ model: null, alerts: null, location: null });
function PanelMount({host,onActive}:{host:HTMLElement|null;onActive?:(active:boolean)=>void}) {
  const mount = useCallback((node: HTMLDivElement | null) => { if (node && host) node.append(host); }, [host]);
  useEffect(()=>{if(!host)return;onActive?.(true);return()=>onActive?.(false);},[host,onActive]);
  return <div className="p-4" ref={mount}/>;
}
function ModelPanel() {
  const { model } = useContext(BetaSettingsPanels);
  const mount = useCallback((node: HTMLDivElement | null) => { if (node && model) node.append(model); }, [model]);
  return <div className="p-4" ref={mount}/>;
}
function DiagnosticsPanel() { const panels=useContext(BetaSettingsPanels);return <PanelMount host={panels.diagnostics??null} onActive={panels.onDiagnosticsMount}/>; }
function AlertsPanel() { return <div className="p-4">{useContext(BetaSettingsPanels).alerts}</div>; }
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
      get: getBetaOverlayEnabled, set: setBetaOverlayEnabled, subscribe: subscribeOverlay,
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
