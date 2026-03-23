/**
 * SignalPool 类型定义
 *
 * 镜像 Rust 端 crates/exomind-runtime/src/signal/types.rs 的数据契约。
 * 用于前端 SSE 订阅、信号发布、路由管理。
 */

// ── SignalEvent ──────────────────────────────────────────────

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

// ── SignalRoute ──────────────────────────────────────────────

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

// ── DeliveryRecord ───────────────────────────────────────────

export type DeliveryStatus = 'sent' | 'failed' | 'skipped';

export interface DeliveryRecord {
  event_id: string;
  route_id: string;
  target_ref: string;
  status: DeliveryStatus;
  reason?: string;
  started_at: string;
  finished_at: string;
}

// ── Publish API ──────────────────────────────────────────────

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

// ── Route CRUD API ───────────────────────────────────────────

export interface CreateRouteRequest {
  topic: string;
  target_type: TargetType;
  target_ref: string;
  enabled?: boolean;
}

export interface UpdateRouteRequest {
  topic?: string;
  target_type?: TargetType;
  target_ref?: string;
  enabled?: boolean;
}
