import { expect, test, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';

const RUNTIME_HOST = '127.0.0.1';
const RUNTIME_PORT = 4477;
const RUNTIME_NAME = 'E2E Runtime';

async function setupIssue205Flags(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('exomind:uiMode', 'new');
    localStorage.setItem('exomind:agentPageEnabled', 'true');
    localStorage.setItem('exomind:useMockData', 'true');
  });
}

test.describe('Issue #205 runtime host device flow（设备页 RuntimeHost 闭环）', () => {
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
      if (request.url === '/health') {
        response.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
        response.end(JSON.stringify({
          status: 'ok',
          host: RUNTIME_HOST,
          port: RUNTIME_PORT,
        }));
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
    await setupIssue205Flags(page);
  });

  test('add host then probe to online status（新增主机并探测在线）', async ({ page }) => {
    await page.goto('/agents');
    await page.waitForLoadState('networkidle');

    await page.getByTestId('agent-view-toggle-device').click();
    await expect(page.getByTestId('runtime-host-panel')).toBeVisible();

    await page.getByTestId('runtime-host-name-input').fill(RUNTIME_NAME);
    await page.getByTestId('runtime-host-address-input').fill(RUNTIME_HOST);
    await page.getByTestId('runtime-host-port-input').fill(String(RUNTIME_PORT));
    await page.getByTestId('runtime-host-add-button').click();

    const hostCard = page.locator('[data-testid="runtime-host-panel"] div').filter({ hasText: RUNTIME_NAME }).first();
    await expect(hostCard).toBeVisible();
    await hostCard.getByRole('button', { name: '探测' }).click();
    await expect(hostCard.locator('[data-testid^="runtime-host-status-"]')).toHaveText('online');
  });
});
