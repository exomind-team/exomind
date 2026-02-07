import { describe, it, expect, beforeEach } from 'vitest';
import { DeviceDiscovery, DiscoveredDevice } from '../../src/lib/sync/device-discovery';

describe('DeviceDiscovery', () => {
  let discovery: DeviceDiscovery;

  beforeEach(() => {
    discovery = new DeviceDiscovery();
  });

  it('should start with empty device list', () => {
    expect(discovery.getDiscoveredDevices()).toEqual([]);
  });

  it('should add discovered device', () => {
    const device: DiscoveredDevice = {
      id: 'test-1',
      name: 'Test Device',
      ip: '192.168.1.100',
      port: 8080,
      type: 'desktop',
    };
    discovery.addDevice(device);
    expect(discovery.getDiscoveredDevices()).toContainEqual(device);
  });
});
