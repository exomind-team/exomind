import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyThemePreference,
  getThemePreference,
  resolveThemePreference,
  setThemePreference,
  subscribeThemePreferenceChanges,
} from '@/config/theme';

describe('theme preference', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove('dark');
    document.documentElement.style.colorScheme = '';
  });

  it('defaults to system when not set', () => {
    expect(getThemePreference()).toBe('system');
  });

  it('falls back to system for invalid stored values', () => {
    window.localStorage.setItem('exomind:themePreference', 'nope');
    expect(getThemePreference()).toBe('system');
  });

  it('persists preference and notifies subscribers', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeThemePreferenceChanges(listener);

    setThemePreference('dark');
    expect(window.localStorage.getItem('exomind:themePreference')).toBe('dark');
    expect(listener).toHaveBeenCalledWith('dark');

    unsubscribe();
  });

  it('applies dark preference via html.dark and colorScheme', () => {
    expect(applyThemePreference('dark')).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('applies light preference via html.dark removal and colorScheme', () => {
    document.documentElement.classList.add('dark');

    expect(applyThemePreference('light')).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  it('resolves system theme using matchMedia', () => {
    const originalMatchMedia = window.matchMedia;

    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('prefers-color-scheme') ? true : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    expect(resolveThemePreference('system')).toBe('dark');
    expect(applyThemePreference('system')).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    window.matchMedia = originalMatchMedia;
  });
});

