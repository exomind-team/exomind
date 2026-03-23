import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const mockInvoke = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}));

describe('MessageStorage device id (tauri)', () => {
  beforeEach(() => {
    vi.resetModules();
    mockInvoke.mockReset();
    localStorage.clear();
    (globalThis as { window: { __TAURI__?: unknown } }).window.__TAURI__ = { __VERSION__: '2.0.0' };
  });

  afterEach(() => {
    delete (globalThis as { window: { __TAURI__?: unknown } }).window.__TAURI__;
  });

  it('should prefer tauri get_device_id result and persist it', async () => {
    mockInvoke.mockResolvedValue('tauri-device-001');

    const module = await import('../../../src/lib/sync/message-storage');
    const storage = new module.MessageStorage('.exomind-test-tauri-id');
    await storage.waitForDeviceIdReady();

    expect(mockInvoke).toHaveBeenCalledWith('get_device_id');
    expect(storage.getDeviceId()).toBe('tauri-device-001');
    expect(localStorage.getItem('exomind:deviceId')).toBe('tauri-device-001');
  });

  it('should keep cached device id when tauri command fails', async () => {
    localStorage.setItem('exomind:deviceId', 'cached-tauri-device');
    mockInvoke.mockRejectedValue(new Error('command not found'));

    const module = await import('../../../src/lib/sync/message-storage');
    const storage = new module.MessageStorage('.exomind-test-tauri-fallback');
    await storage.waitForDeviceIdReady();

    expect(storage.getDeviceId()).toBe('cached-tauri-device');
  });

  it('should register get_device_id command in tauri backend', () => {
    const commandModule = readFileSync('src-tauri/src/commands/mod.rs', 'utf-8');
    const tauriLib = readFileSync('src-tauri/src/lib.rs', 'utf-8');

    expect(commandModule).toContain('device_commands');
    expect(tauriLib).toContain('get_device_id');
  });
});

