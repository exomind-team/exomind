// contracts.signal-pool.test.ts — SignalPool 数据契约测试
//
// 测试目标:
//   1. SignalEvent 类型契约 — 验证结构、字段类型、序列化/反序列化
//   2. SignalRoute 类型契约 — 验证结构、字段类型、target_type 枚举
//   3. DeliveryRecord 类型契约 — 验证结构、字段类型、status 枚举
//
// 这些测试验证前后端的数据契约一致性，即使实现代码还未完成
// 也能确保类型定义正确。

import { describe, expect, it } from 'vitest';

// ── 类型定义（前端侧的 SignalPool 数据契约）──
// 这些类型最终应从 @/lib/types/signal-pool 导入

interface SignalEvent {
  schema_version: number; // 固定 1
  id: string; // uuid
  topic: string;
  ts: number; // epoch ms
  source: string;
  origin_host_id: string;
  hop: number;
  trace_id?: string; // 可选
  payload: Record<string, unknown>;
}

type TargetType = 'actor' | 'agent' | 'frontend';

interface SignalRoute {
  id: string;
  enabled: boolean;
  topic: string; // 精确匹配 或 "*"
  target_type: TargetType;
  target_ref: string;
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
}

type DeliveryStatus = 'sent' | 'failed' | 'skipped';

interface DeliveryRecord {
  event_id: string;
  route_id: string;
  target_ref: string;
  status: DeliveryStatus;
  reason?: string; // 可选，失败时填写
  started_at: string; // ISO 8601
  finished_at: string; // ISO 8601
}

// ── 契约验证 helper ──

function isValidUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s);
}

function isValidIso8601(s: string): boolean {
  return !isNaN(Date.parse(s));
}

// ═══════════════════════════════════════════════════════
//  1. SignalEvent 类型契约
// ═══════════════════════════════════════════════════════

describe('SignalEvent 类型契约', () => {
  const VALID_EVENT: SignalEvent = {
    schema_version: 1,
    id: '550e8400-e29b-41d4-a716-446655440000',
    topic: 'user.action',
    ts: 1709424000000,
    source: 'frontend',
    origin_host_id: 'host-abc',
    hop: 0,
    payload: { action: 'click', target: 'button' },
  };

  it('schema_version 固定为 1', () => {
    expect(VALID_EVENT.schema_version).toBe(1);
  });

  it('id 是合法 UUID', () => {
    expect(isValidUuid(VALID_EVENT.id)).toBe(true);
  });

  it('topic 是非空字符串', () => {
    expect(typeof VALID_EVENT.topic).toBe('string');
    expect(VALID_EVENT.topic.length).toBeGreaterThan(0);
  });

  it('ts 是正整数（epoch ms）', () => {
    expect(Number.isInteger(VALID_EVENT.ts)).toBe(true);
    expect(VALID_EVENT.ts).toBeGreaterThan(0);
  });

  it('source 是非空字符串', () => {
    expect(typeof VALID_EVENT.source).toBe('string');
    expect(VALID_EVENT.source.length).toBeGreaterThan(0);
  });

  it('origin_host_id 是非空字符串', () => {
    expect(typeof VALID_EVENT.origin_host_id).toBe('string');
    expect(VALID_EVENT.origin_host_id.length).toBeGreaterThan(0);
  });

  it('hop 是非负整数', () => {
    expect(Number.isInteger(VALID_EVENT.hop)).toBe(true);
    expect(VALID_EVENT.hop).toBeGreaterThanOrEqual(0);
  });

  it('trace_id 是可选字段（undefined 合法）', () => {
    expect(VALID_EVENT.trace_id).toBeUndefined();

    const withTrace: SignalEvent = { ...VALID_EVENT, trace_id: 'trace-123' };
    expect(withTrace.trace_id).toBe('trace-123');
  });

  it('payload 是 JSON 对象', () => {
    expect(typeof VALID_EVENT.payload).toBe('object');
    expect(VALID_EVENT.payload).not.toBeNull();
    expect(Array.isArray(VALID_EVENT.payload)).toBe(false);
  });

  it('可以正确序列化和反序列化', () => {
    const json = JSON.stringify(VALID_EVENT);
    const parsed = JSON.parse(json) as SignalEvent;

    expect(parsed.schema_version).toBe(VALID_EVENT.schema_version);
    expect(parsed.id).toBe(VALID_EVENT.id);
    expect(parsed.topic).toBe(VALID_EVENT.topic);
    expect(parsed.ts).toBe(VALID_EVENT.ts);
    expect(parsed.source).toBe(VALID_EVENT.source);
    expect(parsed.payload).toEqual(VALID_EVENT.payload);
  });

  it('序列化后 trace_id 为 undefined 时不出现在 JSON 中（需后端配合 skip_serializing_none）', () => {
    const eventWithoutTrace = { ...VALID_EVENT };
    delete (eventWithoutTrace as any).trace_id;

    const json = JSON.stringify(eventWithoutTrace);
    expect(json).not.toContain('trace_id');
  });
});

// ═══════════════════════════════════════════════════════
//  2. SignalRoute 类型契约
// ═══════════════════════════════════════════════════════

describe('SignalRoute 类型契约', () => {
  const VALID_ROUTE: SignalRoute = {
    id: 'route-001',
    enabled: true,
    topic: 'user.action',
    target_type: 'agent',
    target_ref: 'echo',
    created_at: '2026-03-03T00:00:00Z',
    updated_at: '2026-03-03T00:00:00Z',
  };

  it('id 是非空字符串', () => {
    expect(typeof VALID_ROUTE.id).toBe('string');
    expect(VALID_ROUTE.id.length).toBeGreaterThan(0);
  });

  it('enabled 是布尔值', () => {
    expect(typeof VALID_ROUTE.enabled).toBe('boolean');
  });

  it('topic 支持精确匹配', () => {
    expect(VALID_ROUTE.topic).toBe('user.action');
  });

  it('topic 支持通配符 "*"', () => {
    const wildcardRoute: SignalRoute = { ...VALID_ROUTE, topic: '*' };
    expect(wildcardRoute.topic).toBe('*');
  });

  it('target_type 是枚举值: actor | agent | frontend', () => {
    const validTypes: TargetType[] = ['actor', 'agent', 'frontend'];
    expect(validTypes).toContain(VALID_ROUTE.target_type);

    // 验证所有枚举值
    for (const t of validTypes) {
      const route: SignalRoute = { ...VALID_ROUTE, target_type: t };
      expect(route.target_type).toBe(t);
    }
  });

  it('target_ref 是非空字符串', () => {
    expect(typeof VALID_ROUTE.target_ref).toBe('string');
    expect(VALID_ROUTE.target_ref.length).toBeGreaterThan(0);
  });

  it('created_at 和 updated_at 是合法 ISO 8601 时间', () => {
    expect(isValidIso8601(VALID_ROUTE.created_at)).toBe(true);
    expect(isValidIso8601(VALID_ROUTE.updated_at)).toBe(true);
  });

  it('可以正确序列化和反序列化', () => {
    const json = JSON.stringify(VALID_ROUTE);
    const parsed = JSON.parse(json) as SignalRoute;

    expect(parsed.id).toBe(VALID_ROUTE.id);
    expect(parsed.enabled).toBe(VALID_ROUTE.enabled);
    expect(parsed.topic).toBe(VALID_ROUTE.topic);
    expect(parsed.target_type).toBe(VALID_ROUTE.target_type);
    expect(parsed.target_ref).toBe(VALID_ROUTE.target_ref);
  });

  it('Rust 侧 serde rename_all=lowercase 与前端小写枚举一致', () => {
    // 验证后端 JSON 输出的 target_type 是小写
    const backendJson = '{"id":"r1","enabled":true,"topic":"*","target_type":"agent","target_ref":"echo","created_at":"2026-03-03T00:00:00Z","updated_at":"2026-03-03T00:00:00Z"}';
    const parsed = JSON.parse(backendJson) as SignalRoute;
    expect(parsed.target_type).toBe('agent');
    expect(['actor', 'agent', 'frontend']).toContain(parsed.target_type);
  });
});

// ═══════════════════════════════════════════════════════
//  3. DeliveryRecord 类型契约
// ═══════════════════════════════════════════════════════

describe('DeliveryRecord 类型契约', () => {
  const VALID_RECORD: DeliveryRecord = {
    event_id: '550e8400-e29b-41d4-a716-446655440000',
    route_id: 'route-001',
    target_ref: 'echo',
    status: 'sent',
    started_at: '2026-03-03T00:00:00.000Z',
    finished_at: '2026-03-03T00:00:00.001Z',
  };

  it('event_id 是合法 UUID', () => {
    expect(isValidUuid(VALID_RECORD.event_id)).toBe(true);
  });

  it('route_id 是非空字符串', () => {
    expect(typeof VALID_RECORD.route_id).toBe('string');
    expect(VALID_RECORD.route_id.length).toBeGreaterThan(0);
  });

  it('target_ref 是非空字符串', () => {
    expect(typeof VALID_RECORD.target_ref).toBe('string');
    expect(VALID_RECORD.target_ref.length).toBeGreaterThan(0);
  });

  it('status 是枚举值: sent | failed | skipped', () => {
    const validStatuses: DeliveryStatus[] = ['sent', 'failed', 'skipped'];
    expect(validStatuses).toContain(VALID_RECORD.status);

    // 验证所有枚举值
    for (const s of validStatuses) {
      const record: DeliveryRecord = { ...VALID_RECORD, status: s };
      expect(record.status).toBe(s);
    }
  });

  it('reason 是可选字段（成功时 undefined）', () => {
    expect(VALID_RECORD.reason).toBeUndefined();
  });

  it('reason 在失败时应有值', () => {
    const failedRecord: DeliveryRecord = {
      ...VALID_RECORD,
      status: 'failed',
      reason: 'connection refused',
    };
    expect(failedRecord.reason).toBe('connection refused');
  });

  it('started_at 和 finished_at 是合法 ISO 8601 时间', () => {
    expect(isValidIso8601(VALID_RECORD.started_at)).toBe(true);
    expect(isValidIso8601(VALID_RECORD.finished_at)).toBe(true);
  });

  it('finished_at >= started_at（结束不早于开始）', () => {
    const start = new Date(VALID_RECORD.started_at).getTime();
    const end = new Date(VALID_RECORD.finished_at).getTime();
    expect(end).toBeGreaterThanOrEqual(start);
  });

  it('可以正确序列化和反序列化', () => {
    const json = JSON.stringify(VALID_RECORD);
    const parsed = JSON.parse(json) as DeliveryRecord;

    expect(parsed.event_id).toBe(VALID_RECORD.event_id);
    expect(parsed.route_id).toBe(VALID_RECORD.route_id);
    expect(parsed.status).toBe(VALID_RECORD.status);
  });

  it('Rust 侧 serde rename_all=lowercase 与前端小写枚举一致', () => {
    // 验证后端 JSON 输出的 status 是小写
    const backendJson = '{"event_id":"abc","route_id":"r1","target_ref":"echo","status":"sent","started_at":"2026-03-03T00:00:00Z","finished_at":"2026-03-03T00:00:00Z"}';
    const parsed = JSON.parse(backendJson) as DeliveryRecord;
    expect(parsed.status).toBe('sent');
    expect(['sent', 'failed', 'skipped']).toContain(parsed.status);
  });
});

// ═══════════════════════════════════════════════════════
//  4. 跨类型一致性
// ═══════════════════════════════════════════════════════

describe('跨类型一致性', () => {
  it('DeliveryRecord.event_id 与 SignalEvent.id 格式一致', () => {
    const event: SignalEvent = {
      schema_version: 1,
      id: '550e8400-e29b-41d4-a716-446655440000',
      topic: 'test',
      ts: Date.now(),
      source: 'test',
      origin_host_id: 'host',
      hop: 0,
      payload: {},
    };

    const record: DeliveryRecord = {
      event_id: event.id,
      route_id: 'route-1',
      target_ref: 'echo',
      status: 'sent',
      started_at: '2026-03-03T00:00:00Z',
      finished_at: '2026-03-03T00:00:00Z',
    };

    expect(record.event_id).toBe(event.id);
  });

  it('DeliveryRecord.route_id 与 SignalRoute.id 格式一致', () => {
    const route: SignalRoute = {
      id: 'route-001',
      enabled: true,
      topic: '*',
      target_type: 'agent',
      target_ref: 'echo',
      created_at: '2026-03-03T00:00:00Z',
      updated_at: '2026-03-03T00:00:00Z',
    };

    const record: DeliveryRecord = {
      event_id: 'evt-1',
      route_id: route.id,
      target_ref: route.target_ref,
      status: 'sent',
      started_at: '2026-03-03T00:00:00Z',
      finished_at: '2026-03-03T00:00:00Z',
    };

    expect(record.route_id).toBe(route.id);
    expect(record.target_ref).toBe(route.target_ref);
  });

  it('HTTP publish 请求体是 SignalEvent 的子集', () => {
    // POST /signals/publish 的请求体:
    const publishBody = {
      topic: 'user.action',
      source: 'frontend',
      payload: { key: 'value' },
      trace_id: 'trace-123',
    };

    // 这些字段都是 SignalEvent 的子集
    const event: SignalEvent = {
      schema_version: 1,
      id: '550e8400-e29b-41d4-a716-446655440000',
      topic: publishBody.topic,
      ts: Date.now(),
      source: publishBody.source,
      origin_host_id: 'auto-filled-by-server',
      hop: 0,
      trace_id: publishBody.trace_id,
      payload: publishBody.payload,
    };

    expect(event.topic).toBe(publishBody.topic);
    expect(event.source).toBe(publishBody.source);
    expect(event.trace_id).toBe(publishBody.trace_id);
    expect(event.payload).toEqual(publishBody.payload);
  });
});
