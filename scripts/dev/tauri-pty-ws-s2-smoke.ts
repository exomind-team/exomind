#!/usr/bin/env bun

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

type ParsedArgs = {
  name: string;
  webPort: number;
  bridgePort: number;
  outDir: string;
  timeoutMs: number;
};

type RawBridgeMessage = {
  id?: string;
  success?: boolean;
  data?: unknown;
  error?: unknown;
};

type RuntimeRequestContext = {
  rtBaseUrl: string;
  authToken: string | null;
  runtimeRunning: boolean;
  hostId: string | null;
};

type RuntimePtyRecord = {
  id: string;
  session_id?: string | null;
  name?: string | null;
};

type RuntimeSessionRecord = {
  id: string;
  role?: string | null;
  pty_id?: string | null;
  agent_kind?: string | null;
  status?: string | null;
  last_active_at?: string | null;
};

type RightPanelSnapshot = {
  terminalVisible: boolean;
  xtermReady: boolean;
  loadingVisible: boolean;
  terminalErrorMessage: string | null;
};

type AgentExerciseResult = {
  agentType: 'claude' | 'codex';
  sessionName: string;
  sessionId: string | null;
  ptyId: string | null;
  marker: string;
  strategy: 'ui-paste' | 'input-ws' | 'failed';
  status: 'passed' | 'failed';
  probeStatus: string | null;
  terminalReady: boolean;
  notes: string[];
};

type ProbeResult = {
  status: string;
  sawReady: boolean;
  sawReset: boolean;
  markerSeen: boolean;
  recentOutput: string;
  notes: string[];
};

class RawBridgeClient {
  private readonly ws: WebSocket;
  private readonly pending = new Map<
    string,
    {
      resolve: (message: RawBridgeMessage) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private sequence = 0;
  private readonly openPromise: Promise<void>;

  constructor(private readonly url: string) {
    this.ws = new WebSocket(url);
    this.openPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`raw bridge connect timeout: ${url}`));
      }, 10_000);

      this.ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      });
      this.ws.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error(`raw bridge failed to connect: ${url}`));
      });
    });

    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as RawBridgeMessage;
      if (!message.id) {
        return;
      }
      const slot = this.pending.get(message.id);
      if (!slot) {
        return;
      }
      clearTimeout(slot.timer);
      this.pending.delete(message.id);
      slot.resolve(message);
    });

    this.ws.addEventListener('close', () => {
      for (const [, slot] of this.pending) {
        clearTimeout(slot.timer);
        slot.reject(new Error(`raw bridge closed: ${url}`));
      }
      this.pending.clear();
    });
  }

  async ready(): Promise<void> {
    await this.openPromise;
  }

  async send<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
    await this.ready();

    return await new Promise<T>((resolve, reject) => {
      const id = `req-${++this.sequence}`;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`raw bridge command timeout: ${command}`));
      }, 60_000);

      this.pending.set(id, {
        resolve: (message) => {
          if (message.success === false) {
            reject(new Error(`raw bridge command failed: ${command}: ${JSON.stringify(message.error ?? null)}`));
            return;
          }
          resolve(message.data as T);
        },
        reject,
        timer,
      });

      this.ws.send(JSON.stringify({ id, command, args }));
    });
  }

  async executeJs<T>(script: string): Promise<T> {
    return await this.send<T>('execute_js', {
      script,
      windowLabel: 'main',
    });
  }

  close(): void {
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close();
    }
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  let name = 'issue897-s2';
  let webPort: number | null = null;
  let bridgePort: number | null = null;
  let outDir = path.join(process.cwd(), '.tmp', 'reports', 'tauri-pty-ws-s2-smoke');
  let timeoutMs = 20_000;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const value = argv[index + 1];
    if (token === '--name' && value) {
      name = value;
      index += 1;
      continue;
    }
    if (token === '--web-port' && value) {
      webPort = Number.parseInt(value, 10);
      index += 1;
      continue;
    }
    if (token === '--bridge-port' && value) {
      bridgePort = Number.parseInt(value, 10);
      index += 1;
      continue;
    }
    if (token === '--out-dir' && value) {
      outDir = path.resolve(process.cwd(), value);
      index += 1;
      continue;
    }
    if (token === '--timeout-ms' && value) {
      timeoutMs = Number.parseInt(value, 10);
      index += 1;
      continue;
    }
  }

  if (!webPort || !bridgePort) {
    throw new Error('usage: bun scripts/dev/tauri-pty-ws-s2-smoke.ts --web-port <port> --bridge-port <port> [--name <name>] [--out-dir <dir>] [--timeout-ms <ms>]');
  }

  return { name, webPort, bridgePort, outDir, timeoutMs };
}

async function waitForJs<T>(
  client: RawBridgeClient,
  script: string,
  predicate: (value: T) => boolean,
  timeoutMs: number,
  label: string,
): Promise<T> {
  const startedAt = Date.now();
  let lastValue: T | undefined;

  while ((Date.now() - startedAt) < timeoutMs) {
    lastValue = await client.executeJs<T>(script);
    if (predicate(lastValue)) {
      return lastValue;
    }
    await Bun.sleep(200);
  }

  throw new Error(`timed out waiting for ${label}: ${JSON.stringify(lastValue ?? null)}`);
}

async function navigateToRoute(client: RawBridgeClient, route: string, timeoutMs: number): Promise<void> {
  await client.executeJs(`(() => { window.location.assign(${JSON.stringify(route)}); return true; })()`);
  await waitForJs<{ pathname: string }>(
    client,
    `(() => ({ pathname: window.location.pathname }))()`,
    (value) => value.pathname === route,
    timeoutMs,
    `route ${route}`,
  );
}

async function clickBySelector(
  client: RawBridgeClient,
  selector: string,
  label: string,
  timeoutMs: number,
): Promise<void> {
  await waitForJs<{ present: boolean }>(
    client,
    `(() => ({ present: !!document.querySelector(${JSON.stringify(selector)}) }))()`,
    (value) => value.present,
    timeoutMs,
    `${label} presence`,
  );

  const result = await client.executeJs<{ clicked: boolean; reason: string | null }>(
    `(() => {
      const node = document.querySelector(${JSON.stringify(selector)});
      if (!(node instanceof HTMLElement)) {
        return { clicked: false, reason: 'not-found' };
      }
      node.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
      node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return { clicked: true, reason: null };
    })()`,
  );

  if (!result.clicked) {
    throw new Error(`failed to click ${label}: ${result.reason}`);
  }
}

async function setFieldValue(
  client: RawBridgeClient,
  selector: string,
  value: string,
  label: string,
  timeoutMs: number,
): Promise<void> {
  await waitForJs<{ present: boolean }>(
    client,
    `(() => ({ present: !!document.querySelector(${JSON.stringify(selector)}) }))()`,
    (result) => result.present,
    timeoutMs,
    `${label} presence`,
  );

  const updated = await client.executeJs<{ ok: boolean; reason: string | null }>(
    `(() => {
      const node = document.querySelector(${JSON.stringify(selector)});
      if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement)) {
        return { ok: false, reason: 'field-not-found' };
      }
      const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(node), 'value');
      descriptor?.set?.call(node, ${JSON.stringify(value)});
      node.dispatchEvent(new Event('input', { bubbles: true }));
      node.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, reason: null };
    })()`,
  );

  if (!updated.ok) {
    throw new Error(`failed to set ${label}: ${updated.reason}`);
  }
}

async function selectComboboxValue(
  client: RawBridgeClient,
  triggerSelector: string,
  optionLabel: string,
  label: string,
  timeoutMs: number,
): Promise<void> {
  await clickBySelector(client, triggerSelector, `${label} trigger`, timeoutMs);
  await waitForJs<{ present: boolean }>(
    client,
    `(() => {
      const expected = ${JSON.stringify(optionLabel)}.trim().toLowerCase();
      const options = Array.from(document.querySelectorAll('[role="option"], [data-radix-collection-item]'));
      return {
        present: options.some((node) => node.textContent?.trim().toLowerCase() === expected),
      };
    })()`,
    (result) => result.present,
    timeoutMs,
    `${label} option presence`,
  );

  const selected = await client.executeJs<{ ok: boolean; reason: string | null }>(
    `(() => {
      const expected = ${JSON.stringify(optionLabel)}.trim().toLowerCase();
      const option = Array.from(document.querySelectorAll('[role="option"], [data-radix-collection-item]'))
        .find((node) => node.textContent?.trim().toLowerCase() === expected);
      if (!(option instanceof HTMLElement)) {
        return { ok: false, reason: 'option-not-found' };
      }
      option.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
      option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      option.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      option.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return { ok: true, reason: null };
    })()`,
  );

  if (!selected.ok) {
    throw new Error(`failed to select ${label}: ${selected.reason}`);
  }
}

async function ensureSessionsView(client: RawBridgeClient, timeoutMs: number): Promise<void> {
  await waitForJs<{ ready: boolean }>(
    client,
    `(() => ({ ready: !!document.querySelector('[data-testid="agent-view-toggle-sessions"]') }))()`,
    (value) => value.ready,
    timeoutMs,
    'sessions toggle',
  );
  await clickBySelector(client, '[data-testid="agent-view-toggle-sessions"]', 'sessions toggle', timeoutMs);
  await waitForJs<{ ready: boolean }>(
    client,
    `(() => ({
      ready: !!document.querySelector('[data-testid="sessions-view"]')
        || !!document.querySelector('[data-testid="sessions-empty-state"]')
    }))()`,
    (value) => value.ready,
    timeoutMs,
    'sessions view',
  );
}

async function collectRuntimeRequestContext(client: RawBridgeClient): Promise<RuntimeRequestContext> {
  return await client.executeJs<RuntimeRequestContext>(`(async () => {
    const runtimeStatus = await window.__TAURI__.core.invoke('runtime_service_status').catch(() => null);
    const runtimeMode = window.localStorage.getItem('exomind:runtimeTargetMode');
    const externalAddress = (window.localStorage.getItem('exomind:runtimeExternalAddress') ?? '').trim();
    const authToken = (window.localStorage.getItem('exomind:runtimeExternalAuthToken') ?? '').trim();
    const normalizeHost = (value) => value === '0.0.0.0' ? '127.0.0.1' : value;
    const runtimeHost = typeof runtimeStatus?.host === 'string' && runtimeStatus.host.length > 0
      ? runtimeStatus.host
      : '127.0.0.1';
    const runtimePort = typeof runtimeStatus?.port === 'number' && Number.isFinite(runtimeStatus.port)
      ? runtimeStatus.port
      : 9124;
    const rtBaseUrl = runtimeMode === 'external' && externalAddress
      ? 'http://' + externalAddress
      : 'http://' + normalizeHost(runtimeHost) + ':' + String(runtimePort);

    return {
      rtBaseUrl,
      authToken: authToken || null,
      runtimeRunning: runtimeStatus?.running === true,
      hostId: typeof runtimeStatus?.hostId === 'string' ? runtimeStatus.hostId : null,
    };
  })()`);
}

function buildRuntimeRequestHeaders(
  authToken?: string | null,
  extraHeaders: Record<string, string> = {},
): HeadersInit {
  return authToken
    ? { ...extraHeaders, Authorization: `Bearer ${authToken}` }
    : extraHeaders;
}

async function fetchRuntimeJsonWithAuth<T>(
  context: RuntimeRequestContext,
  resourcePath: string,
  timeoutMs = 4_000,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${context.rtBaseUrl}${resourcePath}`, {
      headers: buildRuntimeRequestHeaders(context.authToken),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json() as T;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchRuntimeJsonViaBrowser<T>(
  client: RawBridgeClient,
  resourcePath: string,
  timeoutMs = 4_000,
): Promise<T> {
  return await client.executeJs<T>(`(async () => {
    const runtimeStatus = await window.__TAURI__.core.invoke('runtime_service_status').catch(() => null);
    const runtimeMode = window.localStorage.getItem('exomind:runtimeTargetMode');
    const externalAddress = (window.localStorage.getItem('exomind:runtimeExternalAddress') ?? '').trim();
    const authToken = (window.localStorage.getItem('exomind:runtimeExternalAuthToken') ?? '').trim();
    const normalizeHost = (value) => value === '0.0.0.0' ? '127.0.0.1' : value;
    const runtimeHost = typeof runtimeStatus?.host === 'string' && runtimeStatus.host.length > 0
      ? runtimeStatus.host
      : '127.0.0.1';
    const runtimePort = typeof runtimeStatus?.port === 'number' && Number.isFinite(runtimeStatus.port)
      ? runtimeStatus.port
      : 9124;
    const rtBaseUrl = runtimeMode === 'external' && externalAddress
      ? 'http://' + externalAddress
      : 'http://' + normalizeHost(runtimeHost) + ':' + String(runtimePort);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ${timeoutMs});
    try {
      const headers = authToken ? { Authorization: 'Bearer ' + authToken } : {};
      const response = await fetch(rtBaseUrl + ${JSON.stringify(resourcePath)}, {
        headers,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error('HTTP ' + String(response.status));
      }
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  })()`);
}

async function spawnTerminalAgentViaDialog(
  client: RawBridgeClient,
  input: {
    agentType: 'claude' | 'codex';
    name: string;
    workdir: string;
  },
  timeoutMs: number,
): Promise<{
  closed: boolean;
  loading: boolean;
  errorText: string | null;
}> {
  await ensureSessionsView(client, timeoutMs);
  await clickBySelector(client, '[data-testid="pty-spawn-button"]', 'pty spawn button', timeoutMs);

  const dialogState = await waitForJs<{ routeOpen: boolean; createOpen: boolean }>(
    client,
    `(() => ({
      routeOpen: !!document.querySelector('[data-testid="pty-mode-route"]'),
      createOpen: !!document.querySelector('[data-testid="pty-agent-type"]'),
    }))()`,
    (value) => value.routeOpen || value.createOpen,
    timeoutMs,
    `spawn dialog ${input.agentType}`,
  );

  if (dialogState.routeOpen) {
    await clickBySelector(client, '[data-testid="pty-mode-create"]', 'pty mode create', timeoutMs);
  }

  await waitForJs<{ open: boolean }>(
    client,
    `(() => ({ open: !!document.querySelector('[data-testid="pty-agent-type"]') }))()`,
    (value) => value.open,
    timeoutMs,
    `spawn create form ${input.agentType}`,
  );

  await selectComboboxValue(
    client,
    '[data-testid="pty-agent-type"]',
    input.agentType === 'claude' ? 'Claude' : 'Codex',
    'pty agent type',
    timeoutMs,
  );
  await setFieldValue(client, '[data-testid="pty-session-name"]', input.name, 'pty session name', timeoutMs);
  await setFieldValue(client, '[data-testid="pty-session-workdir"]', input.workdir, 'pty session workdir', timeoutMs);
  await clickBySelector(client, '[data-testid="pty-spawn-submit"]', `spawn submit ${input.agentType}`, timeoutMs);

  const readSubmitStateScript = `(() => {
    const submit = document.querySelector('[data-testid="pty-spawn-submit"]');
    const errorNode = Array.from(document.querySelectorAll('[data-testid="pty-spawn-dialog-body"] .text-red-500'))
      .find((node) => node.textContent && node.textContent.trim().length > 0);
    return {
      closed: !document.querySelector('[data-testid="pty-spawn-dialog-body"]')
        && !document.querySelector('[data-testid="pty-agent-type"]')
        && !document.querySelector('[data-testid="pty-mode-route"]'),
      loading: submit instanceof HTMLButtonElement
        ? submit.disabled && ((submit.textContent ?? '').includes('启动中'))
        : false,
      errorText: errorNode instanceof HTMLElement ? (errorNode.textContent ?? '').trim() || null : null,
    };
  })()`;

  const submitStarted = await waitForJs<{
    closed: boolean;
    loading: boolean;
    errorText: string | null;
  }>(
    client,
    readSubmitStateScript,
    (value) => value.closed || value.loading || Boolean(value.errorText),
    timeoutMs,
    `spawn submit start ${input.agentType}`,
  );

  if (submitStarted.closed || submitStarted.errorText) {
    return submitStarted;
  }

  return await waitForJs<{
    closed: boolean;
    loading: boolean;
    errorText: string | null;
  }>(
    client,
    readSubmitStateScript,
    (value) => value.closed || Boolean(value.errorText) || !value.loading,
    Math.max(timeoutMs, 60_000),
    `spawn submit settle ${input.agentType}`,
  );
}

async function waitForSpawnedSession(
  client: RawBridgeClient,
  name: string,
  timeoutMs: number,
): Promise<{
  sessionId: string;
  ptyId: string;
  role: string;
  status: string | null;
  lastActiveAt: string | null;
}> {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    const sessions = await fetchRuntimeJsonViaBrowser<RuntimeSessionRecord[]>(client, '/sessions').catch(() => []);
    const match = sessions.find((session) => (
      session.role?.trim() === name
      && typeof session.pty_id === 'string'
      && session.pty_id.trim().length > 0
    ));
    if (match?.id && match.pty_id && match.role) {
      return {
        sessionId: match.id,
        ptyId: match.pty_id,
        role: match.role,
        status: match.status ?? null,
        lastActiveAt: match.last_active_at ?? null,
      };
    }
    await Bun.sleep(250);
  }
  throw new Error(`timed out waiting for spawned session: ${name}`);
}

async function waitForSessionWakeViaBrowser(
  client: RawBridgeClient,
  input: {
    sessionId: string;
    previousStatus: string | null;
    previousLastActiveAt: string | null;
    timeoutMs: number;
  },
): Promise<{
  changed: boolean;
  status: string | null;
  lastActiveAt: string | null;
  notes: string[];
}> {
  const startedAt = Date.now();
  let lastSnapshot = {
    changed: false,
    status: input.previousStatus,
    lastActiveAt: input.previousLastActiveAt,
    notes: ['session-wake-poll-timeout'],
  };

  while ((Date.now() - startedAt) < input.timeoutMs) {
    const sessions = await fetchRuntimeJsonViaBrowser<RuntimeSessionRecord[]>(client, '/sessions').catch(() => []);
    const match = sessions.find((session) => session.id === input.sessionId) ?? null;
    if (match) {
      const status = match.status ?? null;
      const lastActiveAt = match.last_active_at ?? null;
      const statusChanged = status !== input.previousStatus;
      const activityChanged = lastActiveAt !== input.previousLastActiveAt;
      lastSnapshot = {
        changed: statusChanged || activityChanged,
        status,
        lastActiveAt,
        notes: [
          `status:${status ?? 'null'}`,
          `last_active_at:${lastActiveAt ?? 'null'}`,
          `status_changed:${String(statusChanged)}`,
          `activity_changed:${String(activityChanged)}`,
        ],
      };
      if (lastSnapshot.changed) {
        return lastSnapshot;
      }
    }
    await Bun.sleep(250);
  }

  return lastSnapshot;
}

async function waitForSessionCard(client: RawBridgeClient, sessionId: string, timeoutMs: number): Promise<void> {
  await waitForJs<{ present: boolean }>(
    client,
    `(() => ({ present: !!document.querySelector(${JSON.stringify(`[data-testid="session-card-${sessionId}"]`)}) }))()`,
    (value) => value.present,
    timeoutMs,
    `session card ${sessionId}`,
  );
}

async function readRightPanelSnapshot(client: RawBridgeClient): Promise<RightPanelSnapshot> {
  return await client.executeJs<RightPanelSnapshot>(`(() => {
    const container = document.querySelector('[data-testid="agent-rightpanel-pty-terminal"]');
    const loadingNode = container?.querySelector('[data-testid="pty-terminal-loading"]')
      ?? document.querySelector('[data-testid="pty-terminal-loading"]');
    const errorNode = container?.querySelector('[data-testid="pty-terminal-error"]')
      ?? document.querySelector('[data-testid="pty-terminal-error"]');
    return {
      terminalVisible: !!container && getComputedStyle(container).display !== 'none',
      xtermReady: !!container?.querySelector('.xterm'),
      loadingVisible: !!loadingNode && getComputedStyle(loadingNode).display !== 'none',
      terminalErrorMessage: errorNode?.textContent?.trim() ?? null,
    };
  })()`);
}

async function waitForRightPanelReady(client: RawBridgeClient, timeoutMs: number): Promise<RightPanelSnapshot> {
  return await waitForJs<RightPanelSnapshot>(
    client,
    `(() => {
      const container = document.querySelector('[data-testid="agent-rightpanel-pty-terminal"]');
      const loadingNode = container?.querySelector('[data-testid="pty-terminal-loading"]')
        ?? document.querySelector('[data-testid="pty-terminal-loading"]');
      const errorNode = container?.querySelector('[data-testid="pty-terminal-error"]')
        ?? document.querySelector('[data-testid="pty-terminal-error"]');
      return {
        terminalVisible: !!container && getComputedStyle(container).display !== 'none',
        xtermReady: !!container?.querySelector('.xterm'),
        loadingVisible: !!loadingNode && getComputedStyle(loadingNode).display !== 'none',
        terminalErrorMessage: errorNode?.textContent?.trim() ?? null,
      };
    })()`,
    (value) => value.terminalVisible && value.xtermReady && !value.loadingVisible && !value.terminalErrorMessage,
    timeoutMs,
    'right panel PTY ready',
  );
}

async function dispatchRightPanelPaste(
  client: RawBridgeClient,
  text: string,
): Promise<{ dispatched: boolean; reason: string | null }> {
  return await client.executeJs<{ dispatched: boolean; reason: string | null }>(`(() => {
    const container = document.querySelector('[data-testid="agent-rightpanel-pty-terminal"]');
    const focusTarget = container?.querySelector('.xterm-helper-textarea')
      ?? container?.querySelector('.xterm')
      ?? container;
    if (!(focusTarget instanceof HTMLElement)) {
      return { dispatched: false, reason: 'focus-target-missing' };
    }
    try {
      focusTarget.focus();
      const dataTransfer = new DataTransfer();
      dataTransfer.setData('text/plain', ${JSON.stringify(text)});
      const pasteEvent = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(pasteEvent, 'clipboardData', {
        configurable: true,
        value: dataTransfer,
      });
      focusTarget.dispatchEvent(pasteEvent);
      return { dispatched: true, reason: null };
    } catch (error) {
      return {
        dispatched: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  })()`);
}

async function startTailProbe(
  client: RawBridgeClient,
  input: {
    probeId: string;
    runtimeContext: RuntimeRequestContext;
    ptyId: string;
    marker: string;
    timeoutMs: number;
  },
): Promise<void> {
  const started = await client.executeJs<boolean>(`(async () => {
    const globalKey = '__issue897PtyWsS2ProbeRegistry';
    const registry = window[globalKey] ?? {};
    window[globalKey] = registry;
    const probeId = ${JSON.stringify(input.probeId)};
    const rtBaseUrl = ${JSON.stringify(input.runtimeContext.rtBaseUrl)};
    const authToken = ${JSON.stringify(input.runtimeContext.authToken)};
    const ptyId = ${JSON.stringify(input.ptyId)};
    const marker = ${JSON.stringify(input.marker)};
    const timeoutMs = ${Math.max(1_000, input.timeoutMs)};

    const url = new URL(rtBaseUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = \`\${url.pathname.replace(/\\/$/, '')}/pty/\${encodeURIComponent(ptyId)}/ws\`;
    url.search = '';
    url.searchParams.set('mode', 'output');
    url.searchParams.set('cursor', '9007199254740991');
    const normalizedToken = authToken?.trim?.() ?? '';
    if (normalizedToken) {
      url.searchParams.set('token', normalizedToken);
    }

    const decodePayload = (payload) => {
      try {
        const decoded = atob(payload);
        const bytes = new Uint8Array(decoded.length);
        for (let index = 0; index < decoded.length; index += 1) {
          bytes[index] = decoded.charCodeAt(index);
        }
        return new TextDecoder().decode(bytes);
      } catch {
        return payload;
      }
    };

    const record = {
      ready: false,
      done: false,
      result: null,
      socket: null,
      promise: null,
      notes: [],
      recentOutput: '',
    };
    registry[probeId] = record;

    record.promise = new Promise((resolve) => {
      let sawReady = false;
      let sawReset = false;
      let markerSeen = false;
      const finish = (status) => {
        if (record.done) {
          return;
        }
        record.done = true;
        record.result = {
          status,
          sawReady,
          sawReset,
          markerSeen,
          recentOutput: record.recentOutput,
          notes: [...record.notes],
        };
        try {
          record.socket?.close();
        } catch {
          // Ignore close races.
        }
        resolve(record.result);
      };

      const socket = new WebSocket(url.toString());
      record.socket = socket;
      const timer = setTimeout(() => finish('timeout'), timeoutMs);
      record.notes.push('socket-created');

      socket.addEventListener('open', () => {
        record.notes.push('open');
      });

      socket.addEventListener('message', (event) => {
        try {
          const message = JSON.parse(String(event.data));
          if (message?.type === 'ready') {
            sawReady = true;
            record.notes.push('ready');
            return;
          }
          if (message?.type === 'output_reset') {
            sawReset = true;
            record.ready = sawReady && sawReset;
            record.notes.push('output_reset');
            return;
          }
          if (message?.type === 'output' && typeof message.data === 'string') {
            const text = decodePayload(message.data);
            record.recentOutput = (record.recentOutput + text).slice(-16_384);
            if (record.recentOutput.includes(marker)) {
              markerSeen = true;
              clearTimeout(timer);
              finish('passed');
            }
            return;
          }
          if (message?.type === 'error') {
            record.notes.push('error:' + String(message.code ?? 'unknown') + ':' + String(message.message ?? ''));
            clearTimeout(timer);
            finish('error');
            return;
          }
          if (message?.type === 'eof') {
            record.notes.push('eof');
            clearTimeout(timer);
            finish(markerSeen ? 'passed' : 'eof');
          }
        } catch (error) {
          record.notes.push('message-parse:' + (error instanceof Error ? error.message : String(error)));
        }
      });

      socket.addEventListener('error', () => {
        record.notes.push('socket-error');
      });

      socket.addEventListener('close', () => {
        if (!record.done) {
          clearTimeout(timer);
          finish(markerSeen ? 'passed' : 'closed');
        }
      });
    });

    const startedAt = Date.now();
    while ((Date.now() - startedAt) < Math.min(timeoutMs, 5_000)) {
      if (record.ready) {
        return true;
      }
      if (record.done) {
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    return false;
  })()`);

  if (!started) {
    throw new Error(`probe failed to reach ready state for PTY ${input.ptyId}`);
  }
}

async function sendMarkerViaInputWebSocket(
  client: RawBridgeClient,
  input: {
    runtimeContext: RuntimeRequestContext;
    ptyId: string;
    text: string;
    timeoutMs: number;
  },
): Promise<{ ok: boolean; notes: string[] }> {
  return await client.executeJs<{ ok: boolean; notes: string[] }>(`(async () => {
    const rtBaseUrl = ${JSON.stringify(input.runtimeContext.rtBaseUrl)};
    const authToken = ${JSON.stringify(input.runtimeContext.authToken)};
    const ptyId = ${JSON.stringify(input.ptyId)};
    const text = ${JSON.stringify(input.text)};
    const timeoutMs = ${Math.max(1_000, input.timeoutMs)};

    const url = new URL(rtBaseUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = \`\${url.pathname.replace(/\\/$/, '')}/pty/\${encodeURIComponent(ptyId)}/ws\`;
    url.search = '';
    url.searchParams.set('mode', 'input');
    const normalizedToken = authToken?.trim?.() ?? '';
    if (normalizedToken) {
      url.searchParams.set('token', normalizedToken);
    }

    const encodePayload = (value) => {
      const bytes = new TextEncoder().encode(value);
      let binary = '';
      for (const item of bytes) {
        binary += String.fromCharCode(item);
      }
      return btoa(binary);
    };

    return await new Promise((resolve) => {
      const notes = [];
      const socket = new WebSocket(url.toString());
      let sent = false;
      const finish = (ok) => {
        clearTimeout(timer);
        try {
          socket.close();
        } catch {
          // Ignore close races.
        }
        resolve({ ok, notes });
      };
      const timer = setTimeout(() => {
        notes.push('timeout');
        finish(false);
      }, timeoutMs);

      socket.addEventListener('open', () => {
        notes.push('open');
      });

      socket.addEventListener('message', (event) => {
        try {
          const message = JSON.parse(String(event.data));
          if (message?.type === 'ready') {
            notes.push('ready');
            if (message.read_only === true) {
              notes.push('read-only');
              finish(false);
              return;
            }
            socket.send(JSON.stringify({
              type: 'input',
              input_seq: 1,
              data: encodePayload(text),
            }));
            notes.push('input-sent');
            sent = true;
            return;
          }
          if (message?.type === 'ack' && Number(message.input_seq) === 1) {
            notes.push('ack');
            finish(true);
            return;
          }
          if (message?.type === 'error') {
            notes.push('error:' + String(message.code ?? 'unknown') + ':' + String(message.message ?? ''));
            finish(false);
          }
        } catch (error) {
          notes.push('message-parse:' + (error instanceof Error ? error.message : String(error)));
        }
      });

      socket.addEventListener('error', () => {
        notes.push('socket-error');
      });

      socket.addEventListener('close', () => {
        if (!sent) {
          notes.push('closed-before-ack');
          finish(false);
        }
      });
    });
  })()`);
}

async function awaitTailProbe(
  client: RawBridgeClient,
  probeId: string,
  timeoutMs: number,
): Promise<ProbeResult> {
  const startedAt = Date.now();
  let lastSnapshot: { done: boolean; result: ProbeResult | null } | null = null;

  while ((Date.now() - startedAt) < timeoutMs) {
    lastSnapshot = await client.executeJs<{ done: boolean; result: ProbeResult | null }>(`(() => {
      const registry = window.__issue897PtyWsS2ProbeRegistry ?? {};
      const record = registry[${JSON.stringify(probeId)}];
      if (!record) {
        return { done: true, result: null };
      }
      return {
        done: record.done === true,
        result: record.result ?? null,
      };
    })()`);

    if (lastSnapshot.done) {
      break;
    }

    await Bun.sleep(200);
  }

  await client.executeJs(`(() => {
    const registry = window.__issue897PtyWsS2ProbeRegistry ?? {};
    delete registry[${JSON.stringify(probeId)}];
    return true;
  })()`);

  if (lastSnapshot?.result) {
    return lastSnapshot.result;
  }

  return {
    status: 'poll_timeout',
    sawReady: false,
    sawReset: false,
    markerSeen: false,
    recentOutput: '',
    notes: ['probe-poll-timeout'],
  };
}

async function exerciseAgent(
  client: RawBridgeClient,
  agentType: 'claude' | 'codex',
  timeoutMs: number,
  projectRoot: string,
): Promise<AgentExerciseResult> {
  const runToken = `${Date.now()}-${agentType}`;
  const sessionName = `issue897-${agentType}-s2-${runToken}`;
  const marker = `ISSUE897-${agentType.toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
  const result: AgentExerciseResult = {
    agentType,
    sessionName,
    sessionId: null,
    ptyId: null,
    marker,
    strategy: 'failed',
    status: 'failed',
    probeStatus: null,
    terminalReady: false,
    notes: [],
  };

  try {
    const spawnDialogState = await spawnTerminalAgentViaDialog(client, {
      agentType,
      name: sessionName,
      workdir: projectRoot.replaceAll('\\', '/'),
    }, timeoutMs);
    result.notes.push('spawn dialog completed');
    result.notes.push(`spawn dialog state: ${JSON.stringify(spawnDialogState)}`);
    if (spawnDialogState.errorText) {
      result.notes.push(`spawn dialog error: ${spawnDialogState.errorText}`);
      return result;
    }
    if (!spawnDialogState.closed) {
      result.notes.push('spawn dialog remained open after submit; continuing to resolve runtime session state');
    }

    const spawned = await waitForSpawnedSession(client, sessionName, timeoutMs);
    result.sessionId = spawned.sessionId;
    result.ptyId = spawned.ptyId;
    result.notes.push(`resolved session ${spawned.sessionId}`);
    result.notes.push(`resolved PTY ${spawned.ptyId}`);
    result.notes.push(`initial session status ${spawned.status ?? 'null'}`);
    result.notes.push(`initial last_active_at ${spawned.lastActiveAt ?? 'null'}`);

    await waitForSessionCard(client, spawned.sessionId, timeoutMs);
    await clickBySelector(client, `[data-testid="session-card-${spawned.sessionId}"]`, `session card ${spawned.sessionId}`, timeoutMs);
    const panel = await waitForRightPanelReady(client, timeoutMs);
    result.terminalReady = panel.terminalVisible && panel.xtermReady && !panel.terminalErrorMessage;
    result.notes.push(`right panel ready: ${String(result.terminalReady)}`);

    if (!result.terminalReady) {
      const snapshot = await readRightPanelSnapshot(client);
      result.notes.push(`right panel snapshot: ${JSON.stringify(snapshot)}`);
      return result;
    }

    const runtimeContext = await collectRuntimeRequestContext(client);
    const probeId = `issue897-s2-${agentType}-${Date.now().toString(36)}`;
    const uiProbeTimeoutMs = Math.min(timeoutMs, 6_000);
    await startTailProbe(client, {
      probeId,
      runtimeContext,
      ptyId: spawned.ptyId,
      marker,
      timeoutMs: uiProbeTimeoutMs,
    });
    result.notes.push(`tail probe started: ${probeId}`);

    const paste = await dispatchRightPanelPaste(client, marker);
    if (!paste.dispatched) {
      result.notes.push(`paste dispatch failed: ${paste.reason ?? 'unknown reason'}`);
      const probe = await awaitTailProbe(client, probeId, Math.max(uiProbeTimeoutMs, 8_000));
      result.probeStatus = probe.status;
      result.notes.push(...probe.notes);
    } else {
      result.notes.push('paste dispatched to right panel terminal');
      const probe = await awaitTailProbe(client, probeId, Math.max(uiProbeTimeoutMs, 8_000));
      result.probeStatus = probe.status;
      result.notes.push(...probe.notes);
      result.notes.push(`marker seen via PTY output websocket: ${String(probe.markerSeen)}`);
      result.notes.push(`recent output tail: ${JSON.stringify(probe.recentOutput.slice(-256))}`);
      if (probe.markerSeen) {
        result.strategy = 'ui-paste';
        result.status = 'passed';
      }
    }

    if (result.status !== 'passed') {
      const fallbackProbeId = `issue897-s2-fallback-${agentType}-${Date.now().toString(36)}`;
      await startTailProbe(client, {
        probeId: fallbackProbeId,
        runtimeContext,
        ptyId: spawned.ptyId,
        marker,
        timeoutMs: Math.min(Math.max(timeoutMs, 8_000), 12_000),
      });
      const wsSend = await sendMarkerViaInputWebSocket(client, {
        runtimeContext,
        ptyId: spawned.ptyId,
        text: marker,
        timeoutMs: Math.min(Math.max(timeoutMs, 4_000), 10_000),
      });
      result.notes.push(...wsSend.notes.map((note) => `input-ws:${note}`));
      const fallbackProbe = await awaitTailProbe(client, fallbackProbeId, Math.min(Math.max(timeoutMs, 8_000), 15_000));
      result.probeStatus = fallbackProbe.status;
      result.notes.push(...fallbackProbe.notes.map((note) => `fallback-probe:${note}`));
      result.notes.push(`fallback marker seen via PTY output websocket: ${String(fallbackProbe.markerSeen)}`);
      result.notes.push(`fallback output tail: ${JSON.stringify(fallbackProbe.recentOutput.slice(-256))}`);
      const wake = await waitForSessionWakeViaBrowser(client, {
        sessionId: spawned.sessionId,
        previousStatus: spawned.status,
        previousLastActiveAt: spawned.lastActiveAt,
        timeoutMs: Math.min(Math.max(timeoutMs, 4_000), 10_000),
      });
      result.notes.push(...wake.notes.map((note) => `session-wake:${note}`));
      if (wsSend.ok && (fallbackProbe.markerSeen || wake.changed)) {
        result.strategy = 'input-ws';
        result.status = 'passed';
      }
    }

    try {
      const cleanup = await sendMarkerViaInputWebSocket(client, {
        runtimeContext,
        ptyId: spawned.ptyId,
        text: '\u007f'.repeat(marker.length),
        timeoutMs: Math.min(Math.max(timeoutMs, 4_000), 10_000),
      });
      if (cleanup.ok) {
        result.notes.push('cleanup backspaces sent via input websocket');
      } else {
        result.notes.push(...cleanup.notes.map((note) => `cleanup-ws:${note}`));
      }
    } catch (error) {
      result.notes.push(`cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    return result;
  } catch (error) {
    result.notes.push(error instanceof Error ? error.message : String(error));
    return result;
  }
}

function buildMarkdownReport(input: {
  generatedAt: string;
  instance: ParsedArgs;
  results: AgentExerciseResult[];
  overallPass: boolean;
}): string {
  const lines = [
    '# PTY WebSocket S2 Tauri Smoke',
    '',
    `- generatedAt: ${input.generatedAt}`,
    `- instance: ${input.instance.name}`,
    `- webPort: ${input.instance.webPort}`,
    `- bridgePort: ${input.instance.bridgePort}`,
    `- overallPass: ${String(input.overallPass)}`,
    '',
    '## Results',
    '',
  ];

  for (const result of input.results) {
    lines.push(`### ${result.agentType}`);
    lines.push(`- status: ${result.status}`);
    lines.push(`- sessionName: \`${result.sessionName}\``);
    lines.push(`- sessionId: \`${result.sessionId ?? 'null'}\``);
    lines.push(`- ptyId: \`${result.ptyId ?? 'null'}\``);
    lines.push(`- marker: \`${result.marker}\``);
    lines.push(`- strategy: \`${result.strategy}\``);
    lines.push(`- terminalReady: \`${String(result.terminalReady)}\``);
    lines.push(`- probeStatus: \`${result.probeStatus ?? 'null'}\``);
    lines.push(`- notes: ${result.notes.join('; ') || 'none'}`);
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const client = new RawBridgeClient(`ws://127.0.0.1:${args.bridgePort}`);
  await client.ready();

  try {
    await navigateToRoute(client, '/agents', args.timeoutMs);
    await ensureSessionsView(client, args.timeoutMs);

    const results: AgentExerciseResult[] = [];
    results.push(await exerciseAgent(client, 'codex', args.timeoutMs, process.cwd()));
    results.push(await exerciseAgent(client, 'claude', args.timeoutMs, process.cwd()));

    const overallPass = results.every((result) => result.status === 'passed');
    const generatedAt = new Date().toISOString();
    const timestamp = generatedAt.replaceAll(':', '-');
    const jsonReportPath = path.join(args.outDir, `${timestamp}-${args.name}.json`);
    const markdownReportPath = path.join(args.outDir, `${timestamp}-${args.name}.md`);

    await mkdir(args.outDir, { recursive: true });
    await writeFile(jsonReportPath, `${JSON.stringify({
      generatedAt,
      instance: args,
      results,
      overallPass,
    }, null, 2)}\n`, 'utf8');
    await writeFile(markdownReportPath, buildMarkdownReport({
      generatedAt,
      instance: args,
      results,
      overallPass,
    }), 'utf8');

    process.stdout.write(`${JSON.stringify({
      overallPass,
      jsonReportPath,
      markdownReportPath,
      results,
    }, null, 2)}\n`);

    if (!overallPass) {
      process.exitCode = 1;
    }
  } finally {
    client.close();
  }
}

await main();
