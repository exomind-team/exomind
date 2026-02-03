/**
 * Device 类型定义
 */

export type DeviceType = 'desktop' | 'mobile';
export type DeviceStatus = 'online' | 'offline' | 'away';

export interface Device {
  id: string;
  name: string;
  type: DeviceType;
  status: DeviceStatus;
  ip?: string;
  port?: number;
  passwordHash?: string;
  lastSeen: string;
  createdAt: string;
}

export function createDevice(params: { name: string; type: DeviceType }): Device {
  const now = new Date().toISOString();
  return {
    id: 'device-' + Date.now(),
    name: params.name,
    type: params.type,
    status: 'offline',
    lastSeen: now,
    createdAt: now,
  };
}
