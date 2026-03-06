import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test, type Page } from '@playwright/test';

type RuntimeRoute = {
  id: string;
  enabled: boolean;
  topic: string;
  target_type: 'agent' | 'actor' | 'frontend';
  target_ref: string;
  created_at: string;
  updated_at: string;
};

const RUNTIME_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Private-Network': 'true',
};

const RUNTIME_ROUTES: RuntimeRoute[] = [
  {
    id: 'route-000',
    enabled: true,
    topic: 'voice.input.transcript',
    target_type: 'agent',
    target_ref: 'classifier',
    created_at: '2026-03-04T00:00:00Z',
    updated_at: '2026-03-04T00:00:00Z',
  },
  {
    id: 'route-001',
    enabled: true,
    topic: 'user.input.text',
    target_type: 'agent',
    target_ref: 'classifier',
    created_at: '2026-03-04T00:00:00Z',
    updated_at: '2026-03-04T00:00:00Z',
  },
  {
    id: 'route-002',
    enabled: true,
    topic: 'user.input.text',
    target_type: 'actor',
    target_ref: 'eventlog',
    created_at: '2026-03-04T00:00:00Z',
    updated_at: '2026-03-04T00:00:00Z',
  },
  {
    id: 'route-003',
    enabled: true,
    topic: 'session.end',
    target_type: 'agent',
    target_ref: 'reviewer',
    created_at: '2026-03-04T00:00:00Z',
    updated_at: '2026-03-04T00:00:00Z',
  },
  {
    id: 'route-004',
    enabled: true,
    topic: 'timeblock.completed',
    target_type: 'agent',
    target_ref: 'reviewer',
    created_at: '2026-03-04T00:00:00Z',
    updated_at: '2026-03-04T00:00:00Z',
  },
  {
    id: 'route-005',
    enabled: false,
    topic: 'input.classified',
    target_type: 'actor',
    target_ref: 'task',
    created_at: '2026-03-04T00:00:00Z',
    updated_at: '2026-03-04T00:00:00Z',
  },
  {
    id: 'route-006',
    enabled: true,
    topic: '*',
    target_type: 'frontend',
    target_ref: 'ui',
    created_at: '2026-03-04T00:00:00Z',
    updated_at: '2026-03-04T00:00:00Z',
  },
];

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  for (const [headerName, headerValue] of Object.entries(RUNTIME_CORS_HEADERS)) {
    res.setHeader(headerName, headerValue);
  }
  res.end(JSON.stringify(body));
}

function runtimeHandler(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (req.method === 'OPTIONS') {
    res.writeHead(204, RUNTIME_CORS_HEADERS);
    res.end();
    return;
  }

  if (url.pathname === '/health' && req.method === 'GET') {
    json(res, 200, { status: 'ok' });
    return;
  }

  if (url.pathname === '/agents' && req.method === 'GET') {
    json(res, 200, [
      { id: 'classifier', name: 'Classifier Agent', description: 'classifies input', status: 'available' },
      { id: 'reviewer', name: 'Reviewer Agent', description: 'reviews sessions', status: 'busy' },
    ]);
    return;
  }

  if (url.pathname === '/topology' && req.method === 'GET') {
    json(res, 200, {
      hostname: 'e2e-runtime',
      os: 'linux',
      arch: 'x64',
      uptime_secs: 3600,
      version: '0.3.3-e2e',
      port: 19190,
      total_memory_mb: 2048,
      used_memory_mb: 512,
    });
    return;
  }

  if (url.pathname === '/signal-routes' && req.method === 'GET') {
    json(res, 200, RUNTIME_ROUTES);
    return;
  }

  json(res, 404, { error: 'not found' });
}

async function seedRuntimeHost(page: Page, port: number): Promise<void> {
  await page.addInitScript((runtimePort: number) => {
    localStorage.setItem('exomind:uiMode', 'new');
    localStorage.setItem('exomind:agentPageEnabled', 'true');
    localStorage.setItem('exomind:useMockData', 'false');
    localStorage.setItem(
      'exomind_agent_runtime_hosts_v1',
      JSON.stringify([
        {
          id: 'runtime-e2e-host',
          name: `127.0.0.1:${runtimePort}`,
          host: '127.0.0.1',
          port: runtimePort,
          status: 'online',
          createdAt: '2026-03-04T00:00:00.000Z',
          updatedAt: '2026-03-04T00:00:00.000Z',
        },
      ])
    );
  }, port);
}

async function seedDirectRuntimeFallback(page: Page, port: number): Promise<void> {
  await page.addInitScript((runtimePort: number) => {
    localStorage.setItem('exomind:uiMode', 'new');
    localStorage.setItem('exomind:agentPageEnabled', 'true');
    localStorage.setItem('exomind:useMockData', 'false');
    localStorage.removeItem('exomind_agent_runtime_hosts_v1');
    localStorage.setItem('exomind:agentHubRuntimePorts', JSON.stringify([runtimePort]));
  }, port);
}

test.describe('Issue #245f M2 Agent Hub signal routes（路由列表 + 拓扑图）', () => {
  let runtimeServer: ReturnType<typeof createServer>;
  let runtimePort = 0;

  test.beforeAll(async () => {
    runtimeServer = createServer(runtimeHandler);
    await new Promise<void>((resolve) => {
      runtimeServer.listen(0, '127.0.0.1', () => resolve());
    });
    const address = runtimeServer.address() as AddressInfo;
    runtimePort = address.port;
  });

  test.afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      runtimeServer.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  });

  test.beforeEach(async ({ page }) => {
    await seedRuntimeHost(page, runtimePort);
  });

  test('desktop: list shows real routes and topology shows key flows（桌面端验收）', async ({ page }) => {
    await page.goto('/agents', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('agent-hub-page')).toBeVisible();
    await expect(page.getByTestId('agent-topology-view')).toBeVisible();
    await expect(page.locator('.react-flow__minimap')).toHaveCount(0);
    await expect(page.locator('.react-flow__edge')).toHaveCount(8);
    await expect(page.getByTestId('rf__node-input:voice')).toBeVisible();
    await expect(page.getByTestId('rf__node-topic:voice.input.transcript')).toBeVisible();

    const viewportTransformBefore = await page.locator('.react-flow__viewport').evaluate((el) => {
      return (el as HTMLElement).style.transform;
    });
    await page.locator('.react-flow__controls-button').first().click();
    await page.waitForTimeout(120);
    const viewportTransformAfter = await page.locator('.react-flow__viewport').evaluate((el) => {
      return (el as HTMLElement).style.transform;
    });
    expect(viewportTransformAfter).not.toBe(viewportTransformBefore);

    const firstNode = page.locator('.react-flow__node').first();
    await expect(firstNode).toBeVisible();
    await expect(firstNode).toHaveClass(/draggable/);

    await page.getByTestId('agent-view-toggle-list').click();
    await expect(page.getByTestId('agent-signal-route-section')).toBeVisible();
    const routeRows = page.locator('[data-testid^="agent-signal-route-row-"]');
    await expect(routeRows).toHaveCount(7);
    const route000 = page.getByTestId('agent-signal-route-row-route-000');
    await expect(route000).toContainText('voice.input.transcript');
    await expect(route000).toContainText('classifier');
    await expect(route000).toContainText('agent');
    const route001 = page.getByTestId('agent-signal-route-row-route-001');
    await expect(route001).toContainText('user.input.text');
    await expect(route001).toContainText('classifier');
    await expect(route001).toContainText('agent');
    const route002 = page.getByTestId('agent-signal-route-row-route-002');
    await expect(route002).toContainText('user.input.text');
    await expect(route002).toContainText('eventlog');
    await expect(route002).toContainText('actor');
    const route003 = page.getByTestId('agent-signal-route-row-route-003');
    await expect(route003).toContainText('session.end');
    await expect(route003).toContainText('reviewer');
    await expect(route003).toContainText('agent');
  });

  test('mobile: can view list and topology（移动端可查看列表和拓扑）', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/agents', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('agent-hub-page')).toBeVisible();
    await page.getByTestId('agent-view-toggle-list').click();
    await expect(page.getByTestId('agent-signal-route-section')).toBeVisible();
    await expect(page.locator('[data-testid^="agent-signal-route-row-"]')).toHaveCount(7);
    await expect(page.getByTestId('agent-signal-route-row-route-000')).toContainText('classifier');
    await expect(page.getByTestId('agent-signal-route-row-route-001')).toContainText('classifier');
    await expect(page.getByTestId('agent-signal-route-row-route-002')).toContainText('eventlog');
    await expect(page.getByTestId('agent-signal-route-row-route-003')).toContainText('reviewer');

    await page.getByTestId('agent-view-toggle-topology').click();
    await expect(page.getByTestId('agent-topology-canvas')).toBeVisible();
    await expect(page.locator('.react-flow__minimap')).toHaveCount(0);
    await expect(page.locator('.react-flow__edge')).toHaveCount(8);
    await expect(page.getByTestId('rf__node-input:voice')).toBeVisible();
  });

  test('dark mode: topology canvas keeps nodes visible（暗色模式可见性）', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('exomind:themePreference', 'dark');
    });
    await page.goto('/agents', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('agent-topology-canvas')).toBeVisible();
    await expect(page.locator('.react-flow__edge')).toHaveCount(8);
    await expect(page.getByTestId('rf__node-input:voice')).toBeVisible();
    const darkNodeCount = await page.locator('.react-flow__node').count();
    expect(darkNodeCount).toBeGreaterThan(0);
    await expect(page.locator('.react-flow__minimap')).toHaveCount(0);

    const canvasBackground = await page.getByTestId('agent-topology-canvas').evaluate((node) => {
      return window.getComputedStyle(node).backgroundColor;
    });
    expect(canvasBackground).toBe('rgb(28, 25, 23)');
  });

  test('mock fallback: topology still renders nodes when runtime host is missing（mock 回退场景）', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('exomind:uiMode', 'new');
      localStorage.setItem('exomind:agentPageEnabled', 'true');
      localStorage.setItem('exomind:useMockData', 'true');
      localStorage.removeItem('exomind_agent_runtime_hosts_v1');
    });

    await page.goto('/agents', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('agent-hub-page')).toBeVisible();
    await expect(page.getByTestId('agent-topology-canvas')).toBeVisible();

    const nodeCount = await page.locator('.react-flow__node').count();
    expect(nodeCount).toBeGreaterThan(0);
  });

  test('direct runtime fallback: no saved host still shows live routes（直连回退场景）', async ({ page }) => {
    await seedDirectRuntimeFallback(page, runtimePort);

    await page.goto('/agents', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('agent-topology-canvas')).toBeVisible();
    await expect(page.locator('.react-flow__edge')).toHaveCount(8);

    await page.getByTestId('agent-view-toggle-list').click();
    await expect(page.getByTestId('agent-signal-route-section')).toBeVisible();
    await expect(page.getByText(/auto/)).toBeVisible();
    await expect(page.locator('[data-testid^="agent-signal-route-row-"]')).toHaveCount(7);
  });
});
