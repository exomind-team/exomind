import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMobileFullscreenEnabled } from '@/config/mobile-fullscreen-preference';
import { applyMobileFullscreenPreference, changeMobileFullscreenPreference } from '@/services/mobile-display.service';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

describe('Android fullscreen preference', () => {
  beforeEach(() => {
    window.localStorage.clear();
    invoke.mockReset();
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Linux; Android 15)' });
  });
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    vi.unstubAllGlobals();
  });

  it('defaults to visible system bars, persists a successful choice and reapplies it after startup', async () => {
    expect(getMobileFullscreenEnabled()).toBe(false);
    await applyMobileFullscreenPreference();
    expect(invoke).toHaveBeenLastCalledWith('mobile_fullscreen_set', { enabled: false });
    await changeMobileFullscreenPreference(true);
    expect(getMobileFullscreenEnabled()).toBe(true);
    await applyMobileFullscreenPreference();
    expect(invoke).toHaveBeenLastCalledWith('mobile_fullscreen_set', { enabled: true });
  });

  it('keeps the previous choice when the native update fails', async () => {
    invoke.mockRejectedValue(new Error('activity unavailable'));
    await expect(changeMobileFullscreenPreference(true)).rejects.toThrow('activity unavailable');
    expect(getMobileFullscreenEnabled()).toBe(false);
  });

  it('leaves desktop and regular Web pages outside Android native control', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Windows' });
    await applyMobileFullscreenPreference(true);
    vi.stubGlobal('navigator', { userAgent: 'Android' });
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    await applyMobileFullscreenPreference(true);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('serializes startup with later settings and commits the final choice in order', async () => {
    let completeStartup!: () => void;
    invoke.mockImplementationOnce(() => new Promise<void>((resolve) => { completeStartup = resolve; }));
    const startup = applyMobileFullscreenPreference(false);
    const firstChoice = changeMobileFullscreenPreference(true);
    const lastChoice = changeMobileFullscreenPreference(false);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    completeStartup();
    await Promise.all([startup, firstChoice, lastChoice]);
    expect(invoke.mock.calls.map((call) => call[1])).toEqual([{ enabled: false }, { enabled: true }, { enabled: false }]);
    expect(getMobileFullscreenEnabled()).toBe(false);
  });
});
