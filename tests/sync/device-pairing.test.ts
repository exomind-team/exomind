import { describe, it, expect, beforeEach } from 'vitest';
import { DevicePairing } from '../../src/lib/sync/device-pairing';
import { DiscoveredDevice } from '../../src/lib/sync/device-discovery';

describe('DevicePairing', () => {
  let pairing: DevicePairing;

  beforeEach(() => {
    pairing = new DevicePairing();
  });

  it('should start with empty paired list', () => {
    expect(pairing.getPairedDevices()).toEqual([]);
  });

  it('should generate pairing code', async () => {
    const device: DiscoveredDevice = {
      id: 'test-1',
      name: 'Test Device',
      ip: '192.168.1.100',
      port: 8080,
      type: 'desktop',
    };
    const code = await pairing.requestPairing(device);
    expect(code).toHaveLength(6);
    expect(code).toMatch(/^[A-Z0-9]+$/);
  });
});
