import { expect, test, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';

const RUNTIME_HOST = '127.0.0.1';
const RUNTIME_PORT = 4919;
const RUNTIME_NAME = 'Runtime A';

async function setupIssue201Flags(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('exomind:uiMode', 'new');
    localStorage.setItem('exomind:agentPageEnabled', 'true');
    localStorage.setItem('exomind:useMockData', 'false');
  });
}

test.describe('Issue #201 AgentsPage runtime aggregation（真实 runtime 多主机聚合）', () => {
  let runtimeServer: Server | null = null;

  test.beforeAll(async () => {
    runtimeServer = createServer((request, response) => {
      const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Private-Network': 'true',
      };
      if (request.method === 'OPTIONS') {
        response.writeHead(204, corsHeaders);
        response.end();
        return;
      }

      if (request.url === '/agents') {
        response.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
        response.end(JSON.stringify([
          {
            id: 'echo',
            name: 'Echo Agent',
            description: '回显输入内容',
            status: 'available',
          },
        ]));
        return;
      }

      if (request.url === '/topology') {
        response.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
        response.end(JSON.stringify({
          host_id: 'runtime-host-201',
          hostname: 'local-runtime',
          os: 'Windows 11',
          arch: 'x86_64',
          uptime_secs: 99,
          version: '0.1.0',
          port: RUNTIME_PORT,
          capabilities: {
            agent_kinds: ['claude_cli', 'codex_cli', 'api'],
            api_providers: ['openai', 'anthropic'],
          },
        }));
        return;
      }

      if (request.url === '/health') {
        response.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
        response.end(JSON.stringify({ status: 'ok' }));
        return;
      }

      response.writeHead(404, { 'Content-Type': 'application/json', ...corsHeaders });
      response.end(JSON.stringify({ error: 'not_found' }));
    });

    await new Promise<void>((resolve, reject) => {
      runtimeServer?.once('error', reject);
      runtimeServer?.listen(RUNTIME_PORT, RUNTIME_HOST, () => resolve());
    });
  });

  test.afterAll(async () => {
    if (!runtimeServer) return;
    await new Promise<void>((resolve) => {
      runtimeServer?.close(() => resolve());
    });
  });

  test.beforeEach(async ({ page }) => {
    await setupIssue201Flags(page);
  });

  test('aggregates runtime list and switches to offline after server stop（聚合渲染并在服务关闭后显示 offline）', async ({ page }) => {
    await page.goto('/agents');
    await expect(page.getByTestId('agent-hub-page')).toBeVisible();

    await page.getByTestId('agent-add-node-button').click();
    await page.getByTestId('agent-add-node-option-device').click();
    await expect(page.getByTestId('agent-host-manager-sheet')).toBeVisible();

    await page.getByTestId('runtime-host-name-input').fill(RUNTIME_NAME);
    await page.getByTestId('runtime-host-address-input').fill(`${RUNTIME_HOST}:${RUNTIME_PORT}`);
    await page.getByTestId('runtime-host-add-button').click();

    const hostCard = page.locator('[data-testid="agent-host-manager-sheet"] div').filter({ hasText: RUNTIME_NAME }).first();
    await expect(hostCard).toBeVisible();
    await expect(hostCard.locator('[data-testid^="runtime-host-status-"]')).toHaveText('online');

    await page.getByTestId('agent-host-manager-close').click();
    await page.getByTestId('agent-view-toggle-list').click();
    await expect(page.getByText('Echo Agent')).toBeVisible();
    await expect(page.getByText(new RegExp(`来源 ${RUNTIME_HOST}:${RUNTIME_PORT}`))).toBeVisible();

    await new Promise<void>((resolve) => {
      runtimeServer?.close(() => resolve());
    });
    runtimeServer = null;

    await page.getByTestId('agent-add-node-button').click();
    await page.getByTestId('agent-add-node-option-device').click();
    const offlineCard = page.locator('[data-testid="agent-host-manager-sheet"] div').filter({ hasText: RUNTIME_NAME }).first();
    await offlineCard.getByRole('button', { name: '重试' }).click();
    await expect(offlineCard.locator('[data-testid^="runtime-host-status-"]')).toHaveText('offline');
  });
});
