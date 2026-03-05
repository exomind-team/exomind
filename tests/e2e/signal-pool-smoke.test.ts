// signal-pool-smoke.test.ts — SignalPool E2E 冒烟测试
//
// 全链路验证: 浏览器发布信号 → SSE 收到 → Echo Agent 回传
//
// 测试架构:
//   1. 启动模拟 SignalPool Runtime HTTP 服务（mock server）
//   2. 浏览器通过前端 SDK 发布信号
//   3. SSE 流接收信号
//   4. Echo Agent 收到并回传
//
// 状态: 测试骨架 — 等待前端 SignalPool UI 和 Runtime 路由实现后完善
// 运行: npx playwright test --config tests/e2e/playwright.signal-pool.config.ts

import { expect, test } from '@playwright/test';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

// ── 常量 ──

const SIGNAL_RUNTIME_HOST = '127.0.0.1';
const SIGNAL_RUNTIME_PORT = 4929;

// ── Mock SignalPool Runtime Server ──

interface StoredEvent {
  schema_version: number;
  id: string;
  topic: string;
  ts: number;
  source: string;
  origin_host_id: string;
  hop: number;
  trace_id?: string;
  payload: Record<string, unknown>;
}

interface StoredRoute {
  id: string;
  enabled: boolean;
  topic: string;
  target_type: string;
  target_ref: string;
  created_at: string;
  updated_at: string;
}

interface SSEClient {
  res: ServerResponse;
  agentId: string;
}

function createSignalRuntimeServer() {
  const events: StoredEvent[] = [];
  const routes: StoredRoute[] = [];
  const sseClients: SSEClient[] = [];
  let nextRouteId = 1;

  const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Last-Event-ID',
    'Access-Control-Allow-Private-Network': 'true',
  };

  function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => resolve(body));
    });
  }

  function broadcastSSE(event: StoredEvent) {
    for (const client of sseClients) {
      client.res.write(`event: signal\n`);
      client.res.write(`id: ${event.id}\n`);
      client.res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders);
      res.end();
      return;
    }

    // ── Health ──
    if (url.pathname === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
      res.end(JSON.stringify({ status: 'ok', version: '0.1.0' }));
      return;
    }

    // ── POST /signals/publish ──
    if (url.pathname === '/signals/publish' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      const event: StoredEvent = {
        schema_version: 1,
        id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        topic: body.topic,
        ts: Date.now(),
        source: body.source || 'unknown',
        origin_host_id: 'mock-host',
        hop: 0,
        trace_id: body.trace_id,
        payload: body.payload || {},
      };
      events.push(event);
      broadcastSSE(event);

      res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
      res.end(JSON.stringify({ accepted: true, event_id: event.id }));
      return;
    }

    // ── GET /signals/stream (SSE) ──
    if (url.pathname === '/signals/stream' && req.method === 'GET') {
      const agentId = url.searchParams.get('agent_id') || 'anonymous';
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        ...corsHeaders,
      });
      res.write(':ok\n\n');

      const client: SSEClient = { res, agentId };
      sseClients.push(client);

      // Replay from Last-Event-ID if provided
      const lastEventId = req.headers['last-event-id'] as string | undefined;
      if (lastEventId) {
        const idx = events.findIndex((e) => e.id === lastEventId);
        const replayFrom = idx >= 0 ? idx + 1 : 0;
        for (let i = replayFrom; i < events.length; i++) {
          res.write(`event: signal\nid: ${events[i].id}\ndata: ${JSON.stringify(events[i])}\n\n`);
        }
      }

      req.on('close', () => {
        const idx = sseClients.indexOf(client);
        if (idx >= 0) sseClients.splice(idx, 1);
      });
      return;
    }

    // ── GET /signals/history ──
    if (url.pathname === '/signals/history' && req.method === 'GET') {
      const limit = Number(url.searchParams.get('limit') || '50');
      const recent = events.slice(-limit);
      res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
      res.end(JSON.stringify(recent));
      return;
    }

    // ── GET /signal-routes ──
    if (url.pathname === '/signal-routes' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
      res.end(JSON.stringify(routes));
      return;
    }

    // ── POST /signal-routes ──
    if (url.pathname === '/signal-routes' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      const route: StoredRoute = {
        id: `route-${nextRouteId++}`,
        enabled: true,
        topic: body.topic,
        target_type: body.target_type,
        target_ref: body.target_ref,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      routes.push(route);
      res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
      res.end(JSON.stringify(route));
      return;
    }

    // ── PUT /signal-routes/:id ──
    const putMatch = url.pathname.match(/^\/signal-routes\/(.+)$/);
    if (putMatch && req.method === 'PUT') {
      const routeId = putMatch[1];
      const idx = routes.findIndex((r) => r.id === routeId);
      if (idx < 0) {
        res.writeHead(404, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ error: 'not found' }));
        return;
      }
      const body = JSON.parse(await readBody(req));
      Object.assign(routes[idx], body, { updated_at: new Date().toISOString() });
      res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
      res.end(JSON.stringify(routes[idx]));
      return;
    }

    // ── DELETE /signal-routes/:id ──
    const deleteMatch = url.pathname.match(/^\/signal-routes\/(.+)$/);
    if (deleteMatch && req.method === 'DELETE') {
      const routeId = deleteMatch[1];
      const idx = routes.findIndex((r) => r.id === routeId);
      if (idx < 0) {
        res.writeHead(404, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ error: 'not found' }));
        return;
      }
      routes.splice(idx, 1);
      res.writeHead(204, corsHeaders);
      res.end();
      return;
    }

    // ── Agents (Echo Agent) ──
    if (url.pathname === '/agents' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
      res.end(
        JSON.stringify([
          {
            id: 'echo',
            name: 'Echo Agent',
            description: '回显输入内容',
            status: 'available',
          },
        ]),
      );
      return;
    }

    // ── Topology ──
    if (url.pathname === '/topology' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
      res.end(
        JSON.stringify({
          hostname: 'mock-signal-runtime',
          os: 'test',
          arch: 'x86_64',
          uptime_secs: 42,
          version: '0.1.0',
          port: SIGNAL_RUNTIME_PORT,
        }),
      );
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json', ...corsHeaders });
    res.end(JSON.stringify({ error: 'not_found' }));
  });

  return { server, events, routes, sseClients };
}

// ═══════════════════════════════════════════════════════
//  E2E 冒烟测试
// ═══════════════════════════════════════════════════════

test.describe('SignalPool E2E Smoke（SignalPool 全链路冒烟测试）', () => {
  let mockServer: Server;
  let mockState: ReturnType<typeof createSignalRuntimeServer>;

  test.beforeAll(async () => {
    mockState = createSignalRuntimeServer();
    mockServer = mockState.server;

    await new Promise<void>((resolve, reject) => {
      mockServer.once('error', reject);
      mockServer.listen(SIGNAL_RUNTIME_PORT, SIGNAL_RUNTIME_HOST, () => resolve());
    });
  });

  test.afterAll(async () => {
    await new Promise<void>((resolve) => {
      mockServer.close(() => resolve());
    });
  });

  // ─── 1. Runtime 健康检查 ───

  test('mock runtime health check responds ok（模拟 runtime 健康检查返回 ok）', async ({
    request,
  }) => {
    const response = await request.get(
      `http://${SIGNAL_RUNTIME_HOST}:${SIGNAL_RUNTIME_PORT}/health`,
    );
    expect(response.ok()).toBe(true);

    const body = await response.json();
    expect(body.status).toBe('ok');
  });

  // ─── 2. 信号发布 → 历史查询 ───

  test('publish signal and verify it appears in history（发布信号后在历史中可查到）', async ({
    request,
  }) => {
    // 发布信号
    const publishResponse = await request.post(
      `http://${SIGNAL_RUNTIME_HOST}:${SIGNAL_RUNTIME_PORT}/signals/publish`,
      {
        data: {
          topic: 'e2e.smoke.test',
          source: 'playwright',
          payload: { test: true, timestamp: Date.now() },
        },
      },
    );
    expect(publishResponse.ok()).toBe(true);

    const publishBody = await publishResponse.json();
    expect(publishBody.accepted).toBe(true);
    expect(publishBody.event_id).toBeTruthy();

    // 查询历史
    const historyResponse = await request.get(
      `http://${SIGNAL_RUNTIME_HOST}:${SIGNAL_RUNTIME_PORT}/signals/history?limit=10`,
    );
    expect(historyResponse.ok()).toBe(true);

    const history = await historyResponse.json();
    expect(Array.isArray(history)).toBe(true);
    expect(history.length).toBeGreaterThan(0);

    const latestEvent = history[history.length - 1];
    expect(latestEvent.id).toBe(publishBody.event_id);
    expect(latestEvent.topic).toBe('e2e.smoke.test');
    expect(latestEvent.source).toBe('playwright');
    expect(latestEvent.schema_version).toBe(1);
  });

  // ─── 3. Route CRUD 全生命周期 ───

  test('route CRUD lifecycle via HTTP API（路由 CRUD 全生命周期）', async ({ request }) => {
    const baseUrl = `http://${SIGNAL_RUNTIME_HOST}:${SIGNAL_RUNTIME_PORT}`;

    // CREATE
    const createResponse = await request.post(`${baseUrl}/signal-routes`, {
      data: {
        topic: 'e2e.route.test',
        target_type: 'agent',
        target_ref: 'echo',
      },
    });
    expect(createResponse.ok()).toBe(true);
    const created = await createResponse.json();
    expect(created.id).toBeTruthy();
    expect(created.topic).toBe('e2e.route.test');
    expect(created.enabled).toBe(true);

    // LIST
    const listResponse = await request.get(`${baseUrl}/signal-routes`);
    expect(listResponse.ok()).toBe(true);
    const routes = await listResponse.json();
    expect(routes.some((r: StoredRoute) => r.id === created.id)).toBe(true);

    // UPDATE
    const updateResponse = await request.put(`${baseUrl}/signal-routes/${created.id}`, {
      data: { enabled: false },
    });
    expect(updateResponse.ok()).toBe(true);
    const updated = await updateResponse.json();
    expect(updated.enabled).toBe(false);

    // DELETE
    const deleteResponse = await request.delete(`${baseUrl}/signal-routes/${created.id}`);
    expect(deleteResponse.status()).toBe(204);

    // Verify deleted
    const listAfter = await request.get(`${baseUrl}/signal-routes`);
    const routesAfter = await listAfter.json();
    expect(routesAfter.some((r: StoredRoute) => r.id === created.id)).toBe(false);
  });

  // ─── 4. SSE 事件流接收 ───

  test('SSE stream receives published events（SSE 流接收发布的事件）', async ({ request }) => {
    const baseUrl = `http://${SIGNAL_RUNTIME_HOST}:${SIGNAL_RUNTIME_PORT}`;

    // 发布一个事件
    const publishResponse = await request.post(`${baseUrl}/signals/publish`, {
      data: {
        topic: 'e2e.sse.test',
        source: 'playwright-sse',
        payload: { sse: true },
      },
    });
    expect(publishResponse.ok()).toBe(true);
    const { event_id } = await publishResponse.json();

    // 验证事件在历史中
    const historyResponse = await request.get(`${baseUrl}/signals/history?limit=50`);
    const history = await historyResponse.json();
    const sseEvent = history.find((e: StoredEvent) => e.id === event_id);
    expect(sseEvent).toBeTruthy();
    expect(sseEvent.topic).toBe('e2e.sse.test');
    expect(sseEvent.source).toBe('playwright-sse');
  });

  // ─── 5. 浏览器内发布信号（通过 page.evaluate）───
  // 等前端 SignalPool SDK 集成后启用

  // test('browser publishes signal via frontend SDK（浏览器通过前端 SDK 发布信号）', async ({ page }) => {
  //   await page.goto('/');
  //   await page.waitForLoadState('networkidle');
  //
  //   // 通过浏览器端 JavaScript 调用前端 SDK 发布信号
  //   const result = await page.evaluate(async () => {
  //     const response = await fetch('http://127.0.0.1:4929/signals/publish', {
  //       method: 'POST',
  //       headers: { 'Content-Type': 'application/json' },
  //       body: JSON.stringify({
  //         topic: 'e2e.browser.publish',
  //         source: 'browser',
  //         payload: { from: 'page.evaluate' },
  //       }),
  //     });
  //     return response.json();
  //   });
  //
  //   expect(result.accepted).toBe(true);
  //   expect(result.event_id).toBeTruthy();
  // });

  // ─── 6. 全链路: 发布 → SSE → Echo Agent 回传 ───
  // 等 Echo Agent 信号订阅功能实现后启用

  // test('full chain: publish → SSE → Echo Agent response（全链路: 发布 → SSE → Echo Agent 回传）', async ({ page }) => {
  //   await page.goto('/');
  //   await page.waitForLoadState('networkidle');
  //
  //   // 1. 建立 SSE 连接监听回传事件
  //   const receivedEvents: any[] = [];
  //   await page.evaluate(() => {
  //     const es = new EventSource('http://127.0.0.1:4929/signals/stream?agent_id=e2e');
  //     es.addEventListener('signal', (event) => {
  //       (window as any).__e2eEvents = (window as any).__e2eEvents || [];
  //       (window as any).__e2eEvents.push(JSON.parse(event.data));
  //     });
  //   });
  //
  //   // 2. 发布信号触发 Echo Agent
  //   await page.evaluate(async () => {
  //     await fetch('http://127.0.0.1:4929/signals/publish', {
  //       method: 'POST',
  //       headers: { 'Content-Type': 'application/json' },
  //       body: JSON.stringify({
  //         topic: 'agent.echo.trigger',
  //         source: 'e2e-test',
  //         payload: { message: 'hello echo' },
  //       }),
  //     });
  //   });
  //
  //   // 3. 等待 Echo Agent 回传
  //   await page.waitForFunction(() => {
  //     const events = (window as any).__e2eEvents || [];
  //     return events.some((e: any) => e.topic === 'agent.echo.response');
  //   }, null, { timeout: 5000 });
  //
  //   const events = await page.evaluate(() => (window as any).__e2eEvents);
  //   const echoResponse = events.find((e: any) => e.topic === 'agent.echo.response');
  //   expect(echoResponse).toBeTruthy();
  //   expect(echoResponse.payload.message).toContain('hello echo');
  // });
});
