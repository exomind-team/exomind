import { expect, test, type Page } from '@playwright/test';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

type RuntimeAgent = {
  id: string;
  name: string;
  description: string;
  status: string;
};

function buildInitialAgents(): RuntimeAgent[] {
  return [
    {
      id: 'runtime-claude',
      name: 'Claude Runtime',
      description: 'Claude CLI runtime agent',
      status: 'available',
    },
    {
      id: 'runtime-codex',
      name: 'Codex Runtime',
      description: 'Codex app-server runtime agent',
      status: 'available',
    },
  ];
}

function json(response: ServerResponse, status: number, payload: unknown) {
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Private-Network': 'true',
  });
  response.end(JSON.stringify(payload));
}

function writeSse(response: ServerResponse, payload: unknown) {
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
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
          createdAt: '2026-03-07T00:00:00.000Z',
          updatedAt: '2026-03-07T00:00:00.000Z',
        },
      ]),
    );
  }, port);
}

test.describe('Issue #385 Agent Hub runtime Claude/Codex（流式会话 + 动态生命周期）', () => {
  let runtimeServer: ReturnType<typeof createServer>;
  let runtimePort = 0;
  let runtimeAgents = buildInitialAgents();
  let createdSequence = 0;

  test.beforeAll(async () => {
    runtimeServer = createServer(async (request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');

      if (request.method === 'OPTIONS') {
        response.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Private-Network': 'true',
        });
        response.end();
        return;
      }

      if (url.pathname === '/health' && request.method === 'GET') {
        json(response, 200, { status: 'ok', port: runtimePort });
        return;
      }

      if (url.pathname === '/topology' && request.method === 'GET') {
        json(response, 200, {
          hostname: 'runtime-e2e',
          os: 'Windows 11',
          arch: 'x64',
          uptime_secs: 7200,
          version: '0.3.6-e2e',
          port: runtimePort,
          total_memory_mb: 2048,
          used_memory_mb: 768,
        });
        return;
      }

      if (url.pathname === '/signal-routes' && request.method === 'GET') {
        json(response, 200, []);
        return;
      }

      if (url.pathname === '/signals/history' && request.method === 'GET') {
        json(response, 200, []);
        return;
      }

      if (url.pathname === '/agents' && request.method === 'GET') {
        json(response, 200, runtimeAgents);
        return;
      }

      if (url.pathname === '/agents' && request.method === 'POST') {
        const body = (await readJsonBody(request)) as { kind?: string };
        createdSequence += 1;
        const kind = body.kind ?? 'echo';
        const createdAgent: RuntimeAgent = {
          id: `${kind}-created-${createdSequence}`,
          name: `${kind === 'codex' ? 'Codex' : kind === 'claude' ? 'Claude CLI' : 'Echo'} Agent ${createdSequence}`,
          description: `${kind} runtime agent`,
          status: 'available',
        };
        runtimeAgents = [...runtimeAgents, createdAgent];
        json(response, 201, createdAgent);
        return;
      }

      const deleteMatch = url.pathname.match(/^\/agents\/([^/]+)$/);
      if (deleteMatch && request.method === 'DELETE') {
        const agentId = decodeURIComponent(deleteMatch[1] ?? '');
        runtimeAgents = runtimeAgents.filter((agent) => agent.id !== agentId);
        json(response, 200, { status: 'deleted', id: agentId });
        return;
      }

      const chatMatch = url.pathname.match(/^\/agents\/([^/]+)\/chat$/);
      if (chatMatch && request.method === 'POST') {
        const agentId = decodeURIComponent(chatMatch[1] ?? '');
        const body = (await readJsonBody(request)) as { session_id?: string };

        response.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Private-Network': 'true',
        });

        if (agentId.includes('claude')) {
          writeSse(response, { type: 'session.started', session_id: body.session_id ?? 'claude-session-1' });
          writeSse(response, { type: 'output.delta', content: 'Claude runtime 已连接' });
          writeSse(response, { type: 'done' });
          response.end();
          return;
        }

        if (agentId.includes('codex')) {
          writeSse(response, { type: 'session.started', session_id: body.session_id ?? 'codex-session-1' });
          writeSse(response, { type: 'thinking.delta', content: 'Codex 正在分析任务' });
          writeSse(response, { type: 'tool.call', name: 'searchDocs', payload: { query: 'agent hub runtime' } });
          writeSse(response, { type: 'tool.result', name: 'searchDocs', payload: { hits: 2 } });
          writeSse(response, { type: 'output.delta', content: 'Codex runtime 已连接' });
          writeSse(response, { type: 'done' });
          response.end();
          return;
        }

        writeSse(response, { type: 'output.delta', content: 'Echo runtime 在线' });
        writeSse(response, { type: 'done' });
        response.end();
        return;
      }

      json(response, 404, { error: 'not found' });
    });

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
    runtimeAgents = buildInitialAgents();
    createdSequence = 0;
    await seedRuntimeHost(page, runtimePort);
  });

  test('creates and stops a Codex runtime agent（可创建并停止 Codex Runtime Agent）', async ({ page }) => {
    await page.goto('/agents', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('agent-hub-page')).toBeVisible();
    await page.getByTestId('agent-add-node-button').click();
    await expect(page.getByTestId('agent-add-node-sheet')).toBeVisible();
    await page.getByTestId('agent-add-node-option-codex').click();

    await expect(page.getByTestId('agent-list-view')).toBeVisible();
    await expect(page.getByText('Codex Agent 1')).toBeVisible();

    await page.getByText('Codex Agent 1').click();
    await expect(page.getByTestId('agent-rightpanel-stop-agent')).toBeVisible();
    await page.getByTestId('agent-rightpanel-stop-agent').click();

    await expect(page.getByTestId('agent-rightpanel-stop-agent')).toHaveCount(0);
    await expect(page.getByText('Codex Agent 1')).toHaveCount(0);
  });

  test('streams Claude runtime output in conversation page（Claude CLI 对话页流式输出）', async ({ page }) => {
    await page.goto('/agents/chat/runtime-claude', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('agent-conversation-page')).toBeVisible();
    await page.getByTestId('agent-chat-input').fill('连接 Claude CLI');
    await page.getByTestId('agent-chat-send-button').click();

    await expect(page.getByTestId('agent-runtime-event-output')).toContainText('Claude runtime 已连接');
  });

  test('renders Codex typed runtime events in conversation page（Codex 对话页渲染 typed runtime 事件）', async ({ page }) => {
    await page.goto('/agents/chat/runtime-codex', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('agent-conversation-page')).toBeVisible();
    await page.getByTestId('agent-chat-input').fill('连接 Codex');
    await page.getByTestId('agent-chat-send-button').click();

    await expect(page.getByTestId('agent-runtime-event-thinking')).toContainText('Codex 正在分析任务');
    await expect(page.getByTestId('agent-runtime-event-tool-call')).toContainText('searchDocs');
    await expect(page.getByTestId('agent-runtime-event-tool-result')).toContainText('"hits":2');
    await expect(page.getByTestId('agent-runtime-event-output')).toContainText('Codex runtime 已连接');
  });
});
