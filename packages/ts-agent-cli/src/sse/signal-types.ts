/**
 * SignalPool 类型定义 (Agent Shell 端)
 *
 * 镜像 Rust RT 的 crates/exomind-runtime/src/signal/types.rs 数据契约。
 */

export interface SignalEvent {
  schema_version: number;
  id: string;
  topic: string;
  ts: number;
  source: string;
  origin_host_id: string;
  hop: number;
  trace_id?: string;
  payload: unknown;
}

export type TargetType = 'actor' | 'agent' | 'frontend' | 'remote';

export interface SignalRoute {
  id: string;
  enabled: boolean;
  topic: string;
  target_type: TargetType;
  target_ref: string;
  created_at: string;
  updated_at: string;
}

export interface PublishRequest {
  topic: string;
  source?: string;
  payload: unknown;
  trace_id?: string;
  origin_host_id?: string;
}

export interface PublishResponse {
  accepted: boolean;
  event_id: string;
}
