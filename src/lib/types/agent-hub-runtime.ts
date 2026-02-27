// Runtime host status（运行主机状态）用于设备页真实探测展示
export type RuntimeHostStatus = 'unknown' | 'online' | 'offline' | 'warning';

export interface RuntimeHostRecord {
  id: string;
  name: string;
  host: string;
  port: number;
  status: RuntimeHostStatus;
  createdAt: string;
  updatedAt: string;
  lastCheckedAt?: string;
  lastError?: string;
  isLocal?: boolean;
}

export interface RuntimeServiceStatus {
  running: boolean;
  host: string;
  port: number;
  pid?: number;
  startedAt?: string;
  error?: string;
}
