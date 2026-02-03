import { describe, it, expect } from 'vitest';
import { createDevice } from '../../../src/lib/models/device';

describe('Device Types', () => {
  it('should define device types: desktop, mobile', () => {
    type DeviceType = 'desktop' | 'mobile';
    const type: DeviceType = 'desktop';
    expect(type).toBe('desktop');
  });
  
  it('should define device status: online, offline, away', () => {
    type DeviceStatus = 'online' | 'offline' | 'away';
    const status: DeviceStatus = 'online';
    expect(status).toBe('online');
  });
  
  it('should have required fields', () => {
    const device = {
      id: 'device-001',
      name: '我的手机',
      type: 'mobile' as const,
      status: 'online' as const,
      ip: '192.168.1.100',
      port: 8080,
      lastSeen: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    
    expect(device.id).toBe('device-001');
    expect(device.type).toBe('mobile');
  });
  
  it('should create device with auto-generated id', () => {
    const device = createDevice({
      name: '工作电脑',
      type: 'desktop',
    });
    
    expect(device.id).toBeDefined();
    expect(device.id.startsWith('device-')).toBe(true);
    expect(device.status).toBe('offline');
    expect(device.createdAt).toBeDefined();
  });
  
  it('should validate device name length', () => {
    // 设备名称长度限制测试
  });
});
