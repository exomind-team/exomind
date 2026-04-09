import type { RuntimeTopologyResponse } from './runtime-topology';

// Runtime host status（运行主机状态）用于设备页真实探测展示
export type RuntimeHostStatus = 'unknown' | 'online' | 'offline' | 'warning';
export type RuntimeHostTrustState = 'manual_seed' | 'discovered_candidate' | 'confirmed_peer';
export type RuntimeHostVerificationStatus = 'idle' | 'running' | 'verified' | 'failed';
export type RuntimeHostVerificationTrigger = 'pairing_auto' | 'manual_retry';
export type RuntimeHostAuthTokenSource = 'manual_seed' | 'external_target';

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
  deviceId?: string; // device_id（逻辑设备 ID）
  lastTopology?: RuntimeTopologyResponse; // last_topology（最近一次成功获取的拓扑快照）
  trustState?: RuntimeHostTrustState; // trust_state（信任状态）
  advertisedListenAddress?: string; // advertised_listen_address（对端自宣告监听地址）
  lastSuccessfulDialAddress?: string; // last_successful_dial_address（最近一次成功拨号地址）
  manualOverride?: string; // manual_override（手工固定地址）
  authToken?: string; // auth_token（远端 control-plane Bearer；mesh pairing secret 不写入这里）
  authTokenSource?: RuntimeHostAuthTokenSource; // auth_token_source（控制面 Bearer 来源；历史未知 peer token 会被清洗）
  verificationStatus?: RuntimeHostVerificationStatus; // verification_status（互通验证状态）
  lastVerifiedAt?: string; // last_verified_at（最近验证时间）
  lastVerificationTrigger?: RuntimeHostVerificationTrigger; // last_verification_trigger（最近验证触发来源）
  localInitiatedRttMs?: number; // local_initiated_rtt_ms（本地主动发起 RTT）
  peerInitiatedRttMs?: number; // peer_initiated_rtt_ms（对端主动发起 RTT）
  lastVerificationError?: string; // last_verification_error（最近一次验证错误）
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
