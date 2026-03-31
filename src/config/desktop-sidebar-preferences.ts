import {
  readRuntimeBackedValue,
  writeRuntimeBackedValue,
} from './runtime-preference-storage';

export const DESKTOP_SIDEBAR_COLLAPSED_STORAGE_KEY = 'exomind:desktop-sidebar-collapsed';
export const DESKTOP_SIDEBAR_COLLAPSED_CHANGED_EVENT = 'exomind:desktop-sidebar-collapsed-changed';

export function getDesktopSidebarCollapsed(): boolean {
  return readRuntimeBackedValue(DESKTOP_SIDEBAR_COLLAPSED_STORAGE_KEY) === '1';
}

export function setDesktopSidebarCollapsed(collapsed: boolean): boolean {
  writeRuntimeBackedValue(
    DESKTOP_SIDEBAR_COLLAPSED_STORAGE_KEY,
    collapsed ? '1' : '0',
    DESKTOP_SIDEBAR_COLLAPSED_CHANGED_EVENT,
  );
  return collapsed;
}
