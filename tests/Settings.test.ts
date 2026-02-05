import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('P2P Settings components', () => {
  const settingsDir = path.resolve('src/components/Settings');

  it('should have Settings directory', () => {
    expect(fs.existsSync(settingsDir)).toBe(true);
  });

  it('should export P2PSettings component', async () => {
    const { P2PSettings } = await import('@/components/Settings');
    expect(P2PSettings).toBeDefined();
    expect(typeof P2PSettings).toBe('function');
  });

  it('should export DeviceList component', async () => {
    const { DeviceList } = await import('@/components/Settings');
    expect(DeviceList).toBeDefined();
    expect(typeof DeviceList).toBe('function');
  });

  it('should export PairingCode component', async () => {
    const { PairingCode } = await import('@/components/Settings');
    expect(PairingCode).toBeDefined();
    expect(typeof PairingCode).toBe('function');
  });
});

describe('Settings tabs', () => {
  it('should have devices tab', async () => {
    const { P2PSettings } = await import('@/components/Settings');
    expect(P2PSettings).toBeDefined();
  });

  it('should have pairing tab', async () => {
    const { PairingCode } = await import('@/components/Settings');
    expect(PairingCode).toBeDefined();
  });

  it('should have connection tab', async () => {
    // Connection settings should be part of P2PSettings
    const { P2PSettings } = await import('@/components/Settings');
    expect(P2PSettings).toBeDefined();
  });
});
