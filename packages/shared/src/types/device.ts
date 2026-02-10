/**
 * 设备类型定义
 */

/**
 * 设备类型枚举
 */
export enum DeviceType {
  PHONE = 'phone',
  TABLET = 'tablet',
  DESKTOP = 'desktop',
  SERVER = 'server',
}

/**
 * 设备信息
 */
export interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  deviceType: DeviceType;
  platform: string;
  createdAt: number;
  lastSync?: number;
}
