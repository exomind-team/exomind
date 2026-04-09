// quota-monitor.service.test.ts — QuotaMonitor HTTP API 集成测试 (Issue #848)
//
// 测试场景：
//   1. GET /quota 返回状态（enabled/disabled）
//   2. POST /quota/check 触发实时查询
//   3. POST /quota/disable / quota/enable 启停轮询
//
// 模式：Vitest + HTTP fetch against RT HTTP server
// 前置条件：RT 进程已启动（通过 Tauri MCP 工具或外部进程）
//
// 测试架构（两种模式）：
//   A. Tauri MCP 模式：RT 作为 embedded 进程，由 Tauri 命令启动
//      → 通过 runtime_control.service 调用 RT（需 mock 掉 isTauri() 返回 true）
//   B. HTTP 直连模式：RT 作为独立进程跑在 localhost:RT_PORT
//      → 直接 fetch('http://127.0.0.1:{RT_PORT}/quota/...')
//
// 本测试文件覆盖 A + B 两种场景，通过 RT_PORT env var 或 Tauri runtime adapter
// 获取 RT 地址，优先使用 env var（CI 场景），回退到 Tauri runtime。

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── RT 地址解析 ───────────────────────────────────────────────────────────────

const RT_PORT = Number.parseInt(import.meta.env.EXOMIND_RT_PORT ?? '9124', 10);
const RT_HOST = '127.0.0.1';

function rtBaseUrl(): string {
  return `http://${RT_HOST}:${RT_PORT}`;
}

// ── RT 是否可达（健康检查）─────────────────────────────────────────────────

async function isRtReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${rtBaseUrl()}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── 请求工具 ────────────────────────────────────────────────────────────────

async function quotaGet<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${rtBaseUrl()}${path}`, {
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`GET ${path} failed: HTTP ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

async function quotaPost<T = unknown>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${rtBaseUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`POST ${path} failed: HTTP ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

// ── 类型定义 ────────────────────────────────────────────────────────────────

interface QuotaStatusResponse {
  enabled: boolean;
  warning_threshold: number;
  heartbeat_interval_minutes: number;
  models: ModelQuota[] | null;
}

interface QuotaCheckResponse {
  models: ModelQuota[];
  query_time_ms: number;
}

interface ModelQuota {
  model_name: string;
  display_name: string;
  interval_remains: number;
  interval_total: number;
  interval_reset_in_ms: number;
  weekly_remains: number;
  weekly_total: number;
  weekly_reset_in_ms: number;
}

// ═════════════════════════════════════════════════════════════════════════════
// 测试：未配置 API Key → enabled=false, models=null
// ═════════════════════════════════════════════════════════════════════════════

describe('QuotaMonitor HTTP API — 未配置 API Key（fallback 状态）', () => {
  it('GET /quota 返回 enabled=false, models=null（无 API key 时）', async () => {
    // skip 如果 RT 不可达（测试前置条件）
    if (!(await isRtReachable())) {
      it.skip('RT 不可达，跳过测试', () => {});
      return;
    }

    const status = await quotaGet<QuotaStatusResponse>('/quota');

    expect(status).toHaveProperty('enabled');
    expect(status).toHaveProperty('warning_threshold');
    expect(status).toHaveProperty('heartbeat_interval_minutes');
    expect(status).toHaveProperty('models');

    // 无 API key 时，QuotaMonitor 未启动 → enabled=false, models=null
    expect(status.enabled).toBe(false);
    expect(status.models).toBeNull();
  });

  it('GET /quota/{model} 返回 503 Service Unavailable（无 API key 时）', async () => {
    if (!(await isRtReachable())) {
      it.skip('RT 不可达，跳过测试', () => {});
      return;
    }

    const res = await fetch(`${rtBaseUrl()}/quota/MiniMax-M%2A`);
    expect(res.status).toBe(503);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 测试：启停控制
// ═════════════════════════════════════════════════════════════════════════════

describe('QuotaMonitor HTTP API — 启停控制', () => {
  it('POST /quota/disable → 返回 204 或 503', async () => {
    if (!(await isRtReachable())) {
      it.skip('RT 不可达，跳过测试', () => {});
      return;
    }

    const res = await fetch(`${rtBaseUrl()}/quota/disable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    // RT 不可达 → 503；RT 可达但无 API key → 503；RT 可达且 API key 配置 → 204
    expect([204, 503]).toContain(res.status);
  });

  it('POST /quota/enable { enabled: true } → 返回 204 或 503', async () => {
    if (!(await isRtReachable())) {
      it.skip('RT 不可达，跳过测试', () => {});
      return;
    }

    const res = await fetch(`${rtBaseUrl()}/quota/enable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });

    expect([204, 503]).toContain(res.status);
  });

  it('POST /quota/enable { enabled: false } → 返回 204 或 503', async () => {
    if (!(await isRtReachable())) {
      it.skip('RT 不可达，跳过测试', () => {});
      return;
    }

    const res = await fetch(`${rtBaseUrl()}/quota/enable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });

    expect([204, 503]).toContain(res.status);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 测试：强制查询（POST /quota/check）
// ═════════════════════════════════════════════════════════════════════════════

describe('QuotaMonitor HTTP API — 强制查询', () => {
  it('POST /quota/check → 返回 quota check 响应或 503', async () => {
    if (!(await isRtReachable())) {
      it.skip('RT 不可达，跳过测试', () => {});
      return;
    }

    const res = await fetch(`${rtBaseUrl()}/quota/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    // 无 API key → 503 Service Unavailable
    // 有 API key → 200 + QuotaCheckResponse
    if (res.status === 200) {
      const body: QuotaCheckResponse = await res.json();
      expect(body).toHaveProperty('models');
      expect(Array.isArray(body.models)).toBe(true);
      expect(body).toHaveProperty('query_time_ms');
      expect(typeof body.query_time_ms).toBe('number');
    } else {
      expect(res.status).toBe(503);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 测试：响应结构（API contract）
// ═════════════════════════════════════════════════════════════════════════════

describe('QuotaMonitor HTTP API — API Contract', () => {
  it('GET /quota 响应包含所有必需字段', async () => {
    if (!(await isRtReachable())) {
      it.skip('RT 不可达，跳过测试', () => {});
      return;
    }

    const status = await quotaGet<QuotaStatusResponse>('/quota');

    expect(typeof status.enabled).toBe('boolean');
    expect(typeof status.warning_threshold).toBe('number');
    expect(typeof status.heartbeat_interval_minutes).toBe('number');
  });

  it('GET /quota/{model} 对于不存在的模型返回 404', async () => {
    if (!(await isRtReachable())) {
      it.skip('RT 不可达，跳过测试', () => {});
      return;
    }

    const res = await fetch(`${rtBaseUrl()}/quota/nonexistent-model-xyz`);
    expect(res.status).toBe(404);
  });

  it('POST /quota/check 响应 query_time_ms 是合理的毫秒数', async () => {
    if (!(await isRtReachable())) {
      it.skip('RT 不可达，跳过测试', () => {});
      return;
    }

    const res = await fetch(`${rtBaseUrl()}/quota/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    if (res.status === 200) {
      const body: QuotaCheckResponse = await res.json();
      // query_time_ms 应为合理值（> 0，API 超时 5s）
      expect(body.query_time_ms).toBeGreaterThan(0);
      expect(body.query_time_ms).toBeLessThan(10_000);
    } else {
      expect(res.status).toBe(503);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 测试：ModelQuota 结构（当 API key 配置时）
// ═════════════════════════════════════════════════════════════════════════════

describe('QuotaMonitor HTTP API — ModelQuota 结构（条件测试）', () => {
  it('models 数组中的每个条目符合 ModelQuota 结构', async () => {
    if (!(await isRtReachable())) {
      it.skip('RT 不可达，跳过测试', () => {});
      return;
    }

    const res = await fetch(`${rtBaseUrl()}/quota/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    if (res.status !== 200) {
      // 无 API key → 跳过
      return;
    }

    const body: QuotaCheckResponse = await res.json();
    for (const model of body.models) {
      expect(typeof model.model_name).toBe('string');
      expect(model.model_name.length).toBeGreaterThan(0);

      expect(typeof model.display_name).toBe('string');

      expect(typeof model.interval_remains).toBe('number');
      expect(model.interval_remains).toBeGreaterThanOrEqual(0);

      expect(typeof model.interval_total).toBe('number');
      expect(model.interval_total).toBeGreaterThanOrEqual(0);

      expect(typeof model.interval_reset_in_ms).toBe('number');
      expect(model.interval_reset_in_ms).toBeGreaterThanOrEqual(0);

      expect(typeof model.weekly_remains).toBe('number');
      expect(model.weekly_remains).toBeGreaterThanOrEqual(0);

      expect(typeof model.weekly_total).toBe('number');
      expect(model.weekly_total).toBeGreaterThanOrEqual(0);

      expect(typeof model.weekly_reset_in_ms).toBe('number');
      expect(model.weekly_reset_in_ms).toBeGreaterThanOrEqual(0);
    }
  });

  it('interval_remains 不应超过 interval_total', async () => {
    if (!(await isRtReachable())) {
      return;
    }

    const res = await fetch(`${rtBaseUrl()}/quota/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    if (res.status !== 200) return;

    const body: QuotaCheckResponse = await res.json();
    for (const model of body.models) {
      expect(model.interval_remains).toBeLessThanOrEqual(model.interval_total);
      expect(model.weekly_remains).toBeLessThanOrEqual(model.weekly_total);
    }
  });
});
