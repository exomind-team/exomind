import { Key, Monitor, Moon, MoonStar, Search, Sun, SunMoon } from 'lucide-react';
import type { SettingsItemBase } from './settings-types';

/** Presentation shared by Alpha and Beta. Persistence and platform commands
 * remain in each host's bindings; importing this catalog has no side effects. */
export const PORTABLE_SETTINGS = {
  date: {
    id: 'event-date-display', label: '消息日期显示', icon: Monitor, category: 'appearance',
    description: '简略日期只省略与今天相同的部分；星期模式同周显示星期，跨月或跨年仍显示日期。点击消息时间可切换完整与简略日期。',
  },
  fullscreen: {
    id: 'mobile-fullscreen-enabled', label: '全屏模式', icon: Monitor, category: 'appearance',
    description: '隐藏 Android 系统栏；关闭时内容避让状态栏、导航栏和屏幕缺口，横竖屏均生效。',
    rowTestId: 'new-settings-mobile-fullscreen-row',
  },
  theme: { id: 'theme', label: '主题', icon: MoonStar, category: 'appearance' },
  desktopAdaptive: {
    id: 'desktop-adaptive', label: '桌面端适配', icon: Monitor, category: 'appearance',
    rowTestId: 'feature-toggle-desktop-adaptive-row',
  },
  overlay: {
    id: 'now-workbench-overlay-enabled', label: '启用悬浮工作台', icon: Monitor, category: 'appearance',
    description: '在桌面最上层显示可独立隐藏的当下工作台，提供专注计时与事件记录。',
    rowTestId: 'new-settings-now-overlay-enabled-row',
  },
  sendMode: {
    id: 'input-send-mode', label: '输入框发送方式', icon: Key, category: 'input',
    description: '统一控制文本输入框使用 Enter 发送还是 Ctrl/Cmd+Enter 发送',
    rowTestId: 'new-settings-input-send-mode-row',
  },
  shortcut: {
    id: 'main-window-shortcut', label: '主窗口全局快捷键', icon: Monitor, category: 'input',
    rowTestId: 'new-settings-main-window-shortcut-row',
  },
  quickFocus: {
    id: 'main-window-shortcut-quick-focus', label: '唤起后快速聚焦输入', icon: Search, category: 'input',
    description: '关闭时仅显示并聚焦主窗口；开启后会在当下记录页进一步聚焦记录输入框',
    rowTestId: 'new-settings-main-window-shortcut-quick-focus-row',
  },
} as const satisfies Record<string, SettingsItemBase>;

export const THEME_SETTING_OPTIONS = [
  { label: '浅色', value: 'light', icon: Sun },
  { label: '自动', value: 'system', icon: SunMoon },
  { label: '深色', value: 'dark', icon: Moon },
];
export const DATE_DISPLAY_SETTING_OPTIONS = [
  { label: '简略日期', value: 'compact' }, { label: '完整日期', value: 'full' }, { label: '星期', value: 'weekday' },
];
export const INPUT_SEND_SETTING_OPTIONS = [
  { label: 'Enter 发送', value: 'enter-send' }, { label: 'Ctrl+Enter 发送', value: 'ctrl-enter-send' },
];
