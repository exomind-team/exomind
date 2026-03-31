// Runtime host status（运行主机状态）用于设备页真实探测展示
export type RuntimeHostStatus = 'unknown' | 'online' | 'offline' | 'warning';
export type RuntimeHostTrustState = 'manual_seed' | 'discovered_candidate' | 'confirmed_peer';

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
  hostId?: string; // host_id（逻辑主机 ID）
  trustState?: RuntimeHostTrustState; // trust_state（信任状态）
  advertisedListenAddress?: string; // advertised_listen_address（对端自宣告监听地址）
  lastSuccessfulDialAddress?: string; // last_successful_dial_address（最近一次成功拨号地址）
  manualOverride?: string; // manual_override（手工固定地址）
  authToken?: string; // auth_token（Bearer / peer token，配对后获取）
}

export interface RuntimeServiceStatus {
  running: boolean;
  host: string;
  port: number;
  externalRuntime?: boolean; // external_runtime（由其他管理程序托管的 Runtime）
  hostId?: string; // host_id（逻辑主机 ID）
  pid?: number;
  startedAt?: string;
  error?: string;
}
