import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_WINDOWS_APPBAR_WIDTH_DIP,
  getWindowsAppBarEnabled,
  getWindowsAppBarWidthDip,
  setWindowsAppBarEnabled,
  setWindowsAppBarWidthDip,
} from './windows-appbar-preferences';

describe('Windows AppBar preferences（Windows 停靠偏好）', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('is disabled by default and uses the product width', () => {
    expect(getWindowsAppBarEnabled()).toBe(false);
    expect(getWindowsAppBarWidthDip()).toBe(DEFAULT_WINDOWS_APPBAR_WIDTH_DIP);
  });

  it('clamps the persisted width to the supported range', () => {
    expect(setWindowsAppBarWidthDip(40)).toBe(220);
    expect(setWindowsAppBarWidthDip(360)).toBe(360);
    expect(setWindowsAppBarWidthDip(1200)).toBe(720);
  });

  it('persists the enabled state', () => {
    expect(setWindowsAppBarEnabled(true)).toBe(true);
    expect(getWindowsAppBarEnabled()).toBe(true);
  });
});
