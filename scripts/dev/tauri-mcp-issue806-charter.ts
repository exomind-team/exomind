#!/usr/bin/env bun

import { spawnSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ManagedTauriInstanceRecord } from './tauri-dev-manager-lib';
import {
  compareSessionSummaries,
  parseSessionCardSessionId,
  resolveManagedInstanceBridgePort,
  summarizeRtSessions,
  type RtSessionRecord,
  type UiSessionSummary,
} from './tauri-mcp-issue806-charter-lib';

type ParsedArgs = {
  name?: string;
  outDir: string;
  timeoutMs: number;
  webPort?: number;
  bridgePort?: number;
  runtimeDb?: string;
};

type CharterInstanceDescriptor = {
  name: string;
  webPort: number;
  bridgePort: number;
  runtimeDbPath?: string;
  hmrPort?: number;
  rootPid?: number;
  source: 'managed' | 'direct';
};

type RawBridgeMessage = {
  id?: string;
  success?: boolean;
  data?: unknown;
  error?: unknown;
};

type SessionPanelProbe = {
  ready: boolean;
  terminalVisible: boolean;
  disconnectedVisible: boolean;
  disconnectedMessage: string | null;
  disconnectedText: string | null;
  terminalErrorMessage: string | null;
};

type ConsoleEntry = {
  level: 'info' | 'warn' | 'error';
  text: string;
};

type TerminalInputExerciseResult = {
  scope: 'right-panel' | 'tiled-pane';
  sessionId: string;
  status: 'passed' | 'failed' | 'skipped';
  marker: string | null;
  ptyId: string | null;
  strategy: 'paste' | 'runtime-input' | 'none';
  notes: string[];
};

type SessionCardExerciseResult = {
  target: 'session-card' | 'topology-node';
  sessionId: string;
  expectation: 'active' | 'completed';
  status: 'passed' | 'failed' | 'skipped';
  loadingObserved: boolean;
  terminalVisible: boolean;
  disconnectedVisible: boolean;
  disconnectedMessage: string | null;
  terminalErrorMessage: string | null;
  consoleEntries: ConsoleEntry[];
  input: TerminalInputExerciseResult | null;
  notes: string[];
};

type CharterCheck = {
  id: string;
  title: string;
  status: 'passed' | 'failed' | 'skipped';
  notes: string[];
};

type ViewModeCheck = {
  status: 'passed' | 'failed';
  targetView: 'topology' | 'sessions' | 'tiled';
  pathname: string;
  storedViewMode: string | null;
  notes: string[];
};

type TiledViewCheck = {
  status: 'passed' | 'failed';
  activeSessionIds: string[];
  loadingObserved: boolean;
  rightPanelVisible: boolean;
  paneRectsStable: boolean;
  liveTerminalCount: number;
  disconnectedPaneCount: number;
  inputChecks: TerminalInputExerciseResult[];
  notes: string[];
};

type MultiViewRoundTripCheck = {
  status: 'passed' | 'failed';
  sequence: string[];
  finalViewMode: string | null;
  notes: string[];
};

type ProposalPageCheck = {
  status: 'passed' | 'failed';
  href: string;
  loading: boolean;
  page: boolean;
  snippet: string | null;
};

type RuntimeStatusSnapshot = {
  running?: boolean;
  host?: string;
  port?: number;
  hostId?: string | null;
  startedAt?: string | null;
  error?: string | null;
};

type RuntimePtyRecord = {
  id: string;
  session_id?: string | null;
  name?: string | null;
};

type RuntimeStateSnapshot = {
  runtimeStatus: RuntimeStatusSnapshot;
  sessions: RtSessionRecord[];
  ptys: RuntimePtyRecord[];
};

type RuntimeRequestContext = {
  rtBaseUrl: string;
  authToken: string | null;
  runtimeRunning: boolean;
  hostId: string | null;
};

type TerminalScopeSnapshot = {
  terminalVisible: boolean;
  loadingVisible: boolean;
  xtermReady: boolean;
  disconnectedVisible: boolean;
  disconnectedMessage: string | null;
  disconnectedText: string | null;
  terminalErrorMessage: string | null;
};

type RuntimeRestartCheck = {
  status: 'passed' | 'failed';
  beforeUiSummary: UiSessionSummary;
  beforeRtSummary: ReturnType<typeof summarizeRtSessions>;
  beforePtyCount: number;
  beforeHostId: string | null;
  afterUiSummary: UiSessionSummary;
  afterRtSummary: ReturnType<typeof summarizeRtSessions>;
  afterPtyCount: number;
  afterHostId: string | null;
  afterActiveTerminalSessionRecordIds: string[];
  afterActiveTerminalRecoveryKeys: string[];
  afterLivePtyRecoveryKeys: string[];
  afterMissingActiveTerminalRecoveryKeys: string[];
  afterMismatches: ReturnType<typeof compareSessionSummaries>;
  notes: string[];
};

type Issue818PreparationResult = {
  status: 'prepared' | 'ready';
  spawnedAgents: Array<'claude' | 'codex'>;
  activeTerminalCount: number;
  activeTerminalAgentKinds: string[];
  fullscreenRecoveryPresent: boolean;
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
      }, 10_000);

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
  let name: string | undefined;
  let outDir = path.join(process.cwd(), '.tmp', 'reports', 'tauri-mcp-issue806-charter');
  let timeoutMs = 12_000;
  let webPort: number | undefined;
  let bridgePort: number | undefined;
  let runtimeDb: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const value = argv[index + 1];
    if (token === '--name' && value) {
      name = value;
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
    if (token === '--runtime-db' && value) {
      runtimeDb = path.resolve(process.cwd(), value);
      index += 1;
      continue;
    }
  }

  return { name, outDir, timeoutMs, webPort, bridgePort, runtimeDb };
}

async function readManagedInstanceRecords(projectRoot: string): Promise<ManagedTauriInstanceRecord[]> {
  const registryDir = path.join(projectRoot, '.tmp', 'tauri-dev-instances');
  const entries = await readdir(registryDir, { withFileTypes: true }).catch(() => []);
  const records: ManagedTauriInstanceRecord[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue;
    }

    const raw = await readFile(path.join(registryDir, entry.name), 'utf8').catch(() => null);
    if (!raw) {
      continue;
    }

    try {
      records.push(JSON.parse(raw) as ManagedTauriInstanceRecord);
    } catch {
      // Ignore malformed instance metadata.
    }
  }

  return records.sort((left, right) => left.name.localeCompare(right.name));
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function selectManagedInstance(
  projectRoot: string,
  requestedName?: string,
): Promise<ManagedTauriInstanceRecord> {
  const records = await readManagedInstanceRecords(projectRoot);
  const liveRecords = records.filter((record) => isPidAlive(record.rootPid));

  if (requestedName) {
    const exact = liveRecords.find((record) => record.name === requestedName);
    if (!exact) {
      throw new Error(`managed Tauri instance not running: ${requestedName}`);
    }
    return exact;
  }

  if (liveRecords.length === 1) {
    return liveRecords[0]!;
  }

  if (liveRecords.length === 0) {
    throw new Error('no running tauri:manager instance found');
  }

  throw new Error(`multiple running tauri:manager instances found: ${liveRecords.map((record) => record.name).join(', ')}; pass --name`);
}

function resolveDirectInstance(
  projectRoot: string,
  args: ParsedArgs,
): CharterInstanceDescriptor | null {
  if (!args.webPort && !args.bridgePort && !args.runtimeDb) {
    return null;
  }
  if (!args.webPort || !args.bridgePort) {
    throw new Error('direct charter mode requires both --web-port and --bridge-port');
  }

  const name = args.name?.trim() || `web-${args.webPort}`;
  const derivedRuntimeDbPath = path.join(
    projectRoot,
    '.tmp',
    'tauri-dev-state',
    name,
    'app-data',
    'runtime',
    'sessions.sqlite',
  );

  return {
    name,
    webPort: args.webPort,
    bridgePort: args.bridgePort,
    runtimeDbPath: args.runtimeDb ?? derivedRuntimeDbPath,
    source: 'direct',
  };
}

function readRtSessionsFromSqlite(databasePath: string): RtSessionRecord[] {
  const script = [
    'import json, sqlite3, sys',
    'path = sys.argv[1]',
    'conn = sqlite3.connect(path)',
    'conn.row_factory = sqlite3.Row',
    "cur = conn.cursor()",
    "cur.execute(\"SELECT id, status, interaction_mode, pty_id, source_host_id, created_at, last_active_at FROM agent_sessions ORDER BY COALESCE(last_active_at, created_at) DESC\")",
    'print(json.dumps([dict(row) for row in cur.fetchall()], ensure_ascii=False))',
  ].join('\n');

  const result = spawnSync('python', ['-c', script, databasePath], {
    cwd: process.cwd(),
    encoding: 'utf8',
    windowsHide: true,
  });

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `failed to read sqlite: ${databasePath}`);
  }

  return JSON.parse(result.stdout) as RtSessionRecord[];
}

function trySummarizeRtSessionsFromSqlite(
  databasePath?: string,
): ReturnType<typeof summarizeRtSessions> | null {
  if (!databasePath) {
    return null;
  }

  try {
    return summarizeRtSessions(readRtSessionsFromSqlite(databasePath));
  } catch {
    return null;
  }
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
    await Bun.sleep(250);
  }

  throw new Error(`timed out waiting for ${label}: ${JSON.stringify(lastValue ?? null)}`);
}

async function navigateToRoute(
  client: RawBridgeClient,
  route: string,
  timeoutMs: number,
): Promise<void> {
  await client.executeJs(`(() => { window.location.assign(${JSON.stringify(route)}); return true; })()`);

  await waitForJs<{ href: string; pathname: string }>(
    client,
    `(() => ({ href: window.location.href, pathname: window.location.pathname }))()`,
    (value) => value.pathname === route,
    timeoutMs,
    `route ${route}`,
  );
}

async function installConsoleTap(client: RawBridgeClient): Promise<void> {
  await client.executeJs(`(() => {
    const store = window.__issue806CharterConsoleTap ?? { entries: [], installed: false };
    if (!store.installed) {
      const patch = (level) => {
        const original = console[level].bind(console);
        console[level] = (...args) => {
          try {
            const text = args.map((item) => {
              if (typeof item === 'string') {
                return item;
              }
              try {
                return JSON.stringify(item);
              } catch {
                return String(item);
              }
            }).join(' ');
            store.entries.push({ level, text });
          } catch {
            // Ignore console tap serialization errors.
          }
          return original(...args);
        };
      };
      patch('info');
      patch('warn');
      patch('error');
      store.installed = true;
    }
    store.entries.length = 0;
    window.__issue806CharterConsoleTap = store;
    return true;
  })()`);
}

async function readConsoleEntries(client: RawBridgeClient): Promise<ConsoleEntry[]> {
  return await client.executeJs<ConsoleEntry[]>(`(() => window.__issue806CharterConsoleTap?.entries ?? [])()`);
}

async function clickBySelector(
  client: RawBridgeClient,
  selector: string,
  label: string,
  timeoutMs = 4_000,
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
  timeoutMs = 4_000,
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
      if (!(node instanceof HTMLInputElement || node instanceof HTMLSelectElement || node instanceof HTMLTextAreaElement)) {
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

async function readAgentHubViewState(client: RawBridgeClient): Promise<{
  pathname: string;
  storedViewMode: string | null;
  topologyVisible: boolean;
  sessionsVisible: boolean;
  tiledVisible: boolean;
}> {
  return await client.executeJs(`(() => ({
    pathname: window.location.pathname,
    storedViewMode: window.localStorage.getItem('exomind:agentHubViewMode'),
    topologyVisible: !!document.querySelector('[data-testid="agent-topology-view"]'),
    sessionsVisible: !!document.querySelector('[data-testid="sessions-view"]')
      || !!document.querySelector('[data-testid="sessions-empty-state"]'),
    tiledVisible: !!document.querySelector('[data-testid="tiled-grid"]'),
  }))()`);
}

async function ensureTopologyView(client: RawBridgeClient, timeoutMs: number): Promise<ViewModeCheck> {
  await waitForJs<{ ready: boolean }>(
    client,
    `(() => ({
      ready: !!document.querySelector('[data-testid="agent-view-toggle-topology"]')
    }))()`,
    (value) => value.ready,
    timeoutMs,
    'topology toggle',
  );
  await clickBySelector(client, '[data-testid="agent-view-toggle-topology"]', 'topology toggle');
  const state = await waitForJs<{
    pathname: string;
    storedViewMode: string | null;
    topologyVisible: boolean;
  }>(
    client,
    `(() => ({
      pathname: window.location.pathname,
      storedViewMode: window.localStorage.getItem('exomind:agentHubViewMode'),
      topologyVisible: !!document.querySelector('[data-testid="agent-topology-view"]'),
    }))()`,
    (value) => value.topologyVisible,
    timeoutMs,
    'topology view',
  );

  return {
    status: state.topologyVisible ? 'passed' : 'failed',
    targetView: 'topology',
    pathname: state.pathname,
    storedViewMode: state.storedViewMode,
    notes: state.topologyVisible
      ? ['topology view became visible']
      : ['topology view did not become visible'],
  };
}

async function ensureSessionsView(client: RawBridgeClient, timeoutMs: number): Promise<void> {
  await waitForJs<{ ready: boolean }>(
    client,
    `(() => ({
      ready: !!document.querySelector('[data-testid="agent-view-toggle-sessions"]')
    }))()`,
    (value) => value.ready,
    timeoutMs,
    'sessions toggle',
  );
  await clickBySelector(client, '[data-testid="agent-view-toggle-sessions"]', 'sessions toggle');
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

async function ensureTiledView(client: RawBridgeClient, timeoutMs: number): Promise<ViewModeCheck> {
  await waitForJs<{ ready: boolean }>(
    client,
    `(() => ({
      ready: !!document.querySelector('[data-testid="agent-view-toggle-tiled"]')
    }))()`,
    (value) => value.ready,
    timeoutMs,
    'tiled toggle',
  );
  await clickBySelector(client, '[data-testid="agent-view-toggle-tiled"]', 'tiled toggle');
  const state = await waitForJs<{
    pathname: string;
    storedViewMode: string | null;
    tiledVisible: boolean;
  }>(
    client,
    `(() => ({
      pathname: window.location.pathname,
      storedViewMode: window.localStorage.getItem('exomind:agentHubViewMode'),
      tiledVisible: !!document.querySelector('[data-testid="tiled-grid"]'),
    }))()`,
    (value) => value.tiledVisible,
    timeoutMs,
    'tiled view',
  );

  return {
    status: state.tiledVisible ? 'passed' : 'failed',
    targetView: 'tiled',
    pathname: state.pathname,
    storedViewMode: state.storedViewMode,
    notes: state.tiledVisible
      ? ['tiled view became visible']
      : ['tiled view did not become visible'],
  };
}

async function collectUiSessionSummary(client: RawBridgeClient): Promise<UiSessionSummary> {
  const raw = await client.executeJs<{
    active: number;
    completed: number;
    activeTestIds: string[];
    completedTestIds: string[];
    visibleTestIds: string[];
  }>(`(() => {
    const parseCount = (selector) => {
      const text = document.querySelector(selector)?.textContent?.trim() ?? '0';
      const parsed = Number.parseInt(text, 10);
      return Number.isFinite(parsed) ? parsed : 0;
    };

    const getTestIds = (selector) => Array.from(document.querySelectorAll(selector))
      .map((node) => node.getAttribute('data-testid') ?? '')
      .map((testId) => testId.trim())
      .filter(Boolean);

    return {
      active: parseCount('[data-testid="sessions-active-section"] span:last-child'),
      completed: parseCount('[data-testid="sessions-completed-section"] span:last-child'),
      activeTestIds: getTestIds('[data-testid="sessions-active-section"] [data-testid^="session-card-"]'),
      completedTestIds: getTestIds('[data-testid="sessions-completed-section"] [data-testid^="session-card-"]'),
      visibleTestIds: getTestIds('[data-testid^="session-card-"]'),
    };
  })()`);

  const extractIds = (testIds: string[]) => testIds
    .map((testId) => parseSessionCardSessionId(testId))
    .filter((value): value is string => typeof value === 'string');

  const activeSessionIds = extractIds(raw.activeTestIds);
  const completedSessionIds = extractIds(raw.completedTestIds);
  const visibleSessionIds = extractIds(raw.visibleTestIds);

  return {
    active: raw.active,
    completed: raw.completed,
    total: visibleSessionIds.length,
    activeSessionIds,
    completedSessionIds,
    visibleSessionIds,
  };
}

async function readIssue818PreparationState(client: RawBridgeClient): Promise<{
  activeTestIds: string[];
  fullscreenPtyId: string | null;
  fullscreenRecoveryPresent: boolean;
  fullscreenRecoveryAgentType: string | null;
  rightPanelTerminalVisible: boolean;
  xtermReady: boolean;
  terminalLoadingVisible: boolean;
  terminalErrorMessage: string | null;
}> {
  return await client.executeJs(`(() => {
    const tiledStateRaw = window.localStorage.getItem('exomind:agentHubTiledState');
    let tiledState = null;
    try {
      tiledState = tiledStateRaw ? JSON.parse(tiledStateRaw) : null;
    } catch {
      tiledState = null;
    }

    return {
      activeTestIds: Array.from(document.querySelectorAll('[data-testid="sessions-active-section"] [data-testid^="session-card-"]'))
        .map((node) => node.getAttribute('data-testid') ?? '')
        .filter(Boolean),
      fullscreenPtyId: typeof tiledState?.fullscreenPtyId === 'string' ? tiledState.fullscreenPtyId : null,
      fullscreenRecoveryPresent: !!tiledState?.fullscreenTerminalRecovery,
      fullscreenRecoveryAgentType: typeof tiledState?.fullscreenTerminalRecovery?.agentType === 'string'
        ? tiledState.fullscreenTerminalRecovery.agentType
        : null,
      rightPanelTerminalVisible: !!document.querySelector('[data-testid="agent-rightpanel-pty-terminal"]'),
      xtermReady: !!document.querySelector('[data-testid="agent-rightpanel-pty-terminal"] .xterm'),
      terminalLoadingVisible: !!document.querySelector('[data-testid="pty-terminal-loading"]'),
      terminalErrorMessage: document.querySelector('[data-testid="pty-terminal-error"]')?.textContent?.trim() ?? null,
    };
  })()`);
}

async function collectTopologyTerminalNodeTestIds(client: RawBridgeClient): Promise<string[]> {
  return await client.executeJs(`(() => Array.from(
    document.querySelectorAll('[data-testid^="rf__node-pty-"]'),
  ).map((node) => node.getAttribute('data-testid') ?? '').filter(Boolean))()`);
}

async function waitForTopologyTerminalNodeTestIds(
  client: RawBridgeClient,
  expectedSessionIds: string[],
  timeoutMs: number,
): Promise<string[]> {
  if (expectedSessionIds.length === 0) {
    return await collectTopologyTerminalNodeTestIds(client);
  }

  const startedAt = Date.now();
  let lastSeenTestIds: string[] = [];
  while (Date.now() - startedAt <= timeoutMs) {
    lastSeenTestIds = await collectTopologyTerminalNodeTestIds(client);
    const missingSessionIds = expectedSessionIds.filter((sessionId) => (
      !lastSeenTestIds.includes(`rf__node-pty-${sessionId}`)
    ));
    if (missingSessionIds.length === 0) {
      return lastSeenTestIds;
    }
    await Bun.sleep(200);
  }

  return lastSeenTestIds;
}

async function collectTiledViewState(client: RawBridgeClient): Promise<{
  visible: boolean;
  rightPanelVisible: boolean;
  loadingCount: number;
  liveTerminalCount: number;
  disconnectedPaneCount: number;
  paneRects: Array<{ x: number; y: number; width: number; height: number }>;
}> {
  return await client.executeJs(`(() => {
    const paneRects = Array.from(document.querySelectorAll('[data-testid="tiled-grid"] > div'))
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      });

    return {
      visible: !!document.querySelector('[data-testid="tiled-grid"]'),
      rightPanelVisible: !!document.querySelector('[data-testid="agent-rightpanel-shell"]'),
      loadingCount: document.querySelectorAll('[data-testid="pty-terminal-loading"]').length,
      liveTerminalCount: document.querySelectorAll('.xterm').length,
      disconnectedPaneCount: document.querySelectorAll('[data-testid^="tiled-grid-pty-disconnected-"]').length,
      paneRects,
    };
  })()`);
}

async function collectRuntimeStatus(client: RawBridgeClient): Promise<RuntimeStatusSnapshot> {
  return await client.executeJs<RuntimeStatusSnapshot>(`(async () => {
    return await window.__TAURI__.core.invoke('runtime_service_status').catch((error) => ({
      running: false,
      host: '127.0.0.1',
      port: 9124,
      hostId: null,
      error: String(error),
    }));
  })()`);
}

async function collectRuntimeState(client: RawBridgeClient): Promise<RuntimeStateSnapshot> {
  const [runtimeStatus, context] = await Promise.all([
    collectRuntimeStatus(client),
    collectRuntimeRequestContext(client),
  ]);

  const [sessions, ptys] = await Promise.all([
    fetchRuntimeJsonWithAuth<RtSessionRecord[]>(context, '/sessions').catch(() => []),
    fetchRuntimeJsonWithAuth<RuntimePtyRecord[]>(context, '/pty').catch(() => []),
  ]);

  return {
    runtimeStatus,
    sessions: Array.isArray(sessions) ? sessions : [],
    ptys: Array.isArray(ptys) ? ptys : [],
  };
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
  } catch (error) {
    const timedOut = controller.signal.aborted
      || (error instanceof Error && error.name === 'AbortError');
    throw new Error(timedOut ? `timeout after ${timeoutMs}ms` : (error instanceof Error ? error.message : String(error)));
  } finally {
    clearTimeout(timer);
  }
}

function getActiveTerminalSessionRecordIds(records: RtSessionRecord[]): string[] {
  return records
    .filter((record) => (
      record.interaction_mode === 'terminal'
      && record.status !== 'completed'
      && record.status !== 'archived'
    ))
    .map((record) => record.id)
    .sort((left, right) => left.localeCompare(right));
}

function getActiveTerminalAgentKinds(records: RtSessionRecord[]): string[] {
  return Array.from(new Set(
    records
      .filter((record) => (
        record.interaction_mode === 'terminal'
        && record.status !== 'completed'
        && record.status !== 'archived'
      ))
      .map((record) => String(record.agent_kind ?? '').trim())
      .filter((value) => value.length > 0),
  ))
    .sort((left, right) => left.localeCompare(right));
}

function resolveTerminalRecoveryKey(
  record: Pick<RtSessionRecord, 'id' | 'inner_session_id'>,
): string {
  const innerSessionId = record.inner_session_id?.trim();
  return innerSessionId && innerSessionId.length > 0
    ? innerSessionId
    : record.id;
}

function getActiveTerminalRecoveryKeys(records: RtSessionRecord[]): string[] {
  return Array.from(new Set(
    records
      .filter((record) => (
        record.interaction_mode === 'terminal'
        && record.status !== 'completed'
        && record.status !== 'archived'
      ))
      .map(resolveTerminalRecoveryKey)
      .filter((value) => value.length > 0),
  ))
    .sort((left, right) => left.localeCompare(right));
}

function getLivePtyRecoveryKeys(ptys: RuntimePtyRecord[]): string[] {
  return Array.from(new Set(
    ptys.flatMap((pty) => {
      const recoveryKeys = [
        pty.session_id?.trim() ?? '',
        pty.id?.trim() ?? '',
      ].filter((value) => value.length > 0);
      return recoveryKeys;
    }),
  ))
    .sort((left, right) => left.localeCompare(right));
}

async function spawnTerminalAgentViaDialog(
  client: RawBridgeClient,
  input: {
    agentType: 'claude' | 'codex';
    name: string;
    workdir: string;
  },
  timeoutMs: number,
): Promise<void> {
  await ensureSessionsView(client, timeoutMs);
  await clickBySelector(client, '[data-testid="pty-spawn-button"]', 'pty spawn button', timeoutMs);
  await waitForJs<{ open: boolean }>(
    client,
    `(() => ({ open: !!document.querySelector('[data-testid="pty-agent-type"]') }))()`,
    (value) => value.open,
    timeoutMs,
    `spawn dialog ${input.agentType}`,
  );
  await setFieldValue(client, '[data-testid="pty-agent-type"]', input.agentType, 'pty agent type', timeoutMs);
  await setFieldValue(client, '[data-testid="pty-session-name"]', input.name, 'pty session name', timeoutMs);
  await setFieldValue(client, '[data-testid="pty-session-workdir"]', input.workdir, 'pty session workdir', timeoutMs);
  await clickBySelector(client, '[data-testid="pty-spawn-submit"]', `spawn submit ${input.agentType}`, timeoutMs);
  await waitForJs<{ closed: boolean }>(
    client,
    `(() => ({ closed: !document.querySelector('[data-testid="pty-agent-type"]') }))()`,
    (value) => value.closed,
    Math.max(timeoutMs, 60_000),
    `spawn dialog close ${input.agentType}`,
  );
  await waitForJs<Awaited<ReturnType<typeof readIssue818PreparationState>>>(
    client,
    `(() => {
      const tiledStateRaw = window.localStorage.getItem('exomind:agentHubTiledState');
      let tiledState = null;
      try {
        tiledState = tiledStateRaw ? JSON.parse(tiledStateRaw) : null;
      } catch {
        tiledState = null;
      }

      return {
        activeTestIds: Array.from(document.querySelectorAll('[data-testid="sessions-active-section"] [data-testid^="session-card-"]'))
          .map((node) => node.getAttribute('data-testid') ?? '')
          .filter(Boolean),
        fullscreenPtyId: typeof tiledState?.fullscreenPtyId === 'string' ? tiledState.fullscreenPtyId : null,
        fullscreenRecoveryPresent: !!tiledState?.fullscreenTerminalRecovery,
        fullscreenRecoveryAgentType: typeof tiledState?.fullscreenTerminalRecovery?.agentType === 'string'
          ? tiledState.fullscreenTerminalRecovery.agentType
          : null,
        rightPanelTerminalVisible: !!document.querySelector('[data-testid="agent-rightpanel-pty-terminal"]'),
        xtermReady: !!document.querySelector('[data-testid="agent-rightpanel-pty-terminal"] .xterm'),
        terminalLoadingVisible: !!document.querySelector('[data-testid="pty-terminal-loading"]'),
        terminalErrorMessage: document.querySelector('[data-testid="pty-terminal-error"]')?.textContent?.trim() ?? null,
      };
    })()`,
    (value) => value.fullscreenRecoveryPresent
      && value.fullscreenRecoveryAgentType === input.agentType
      && value.rightPanelTerminalVisible
      && !value.terminalErrorMessage,
    Math.max(timeoutMs, 60_000),
    `issue818 post-spawn ${input.agentType}`,
  );
}

async function ensureIssue818RecoveryPreparation(
  client: RawBridgeClient,
  timeoutMs: number,
  projectRoot: string,
): Promise<Issue818PreparationResult> {
  await ensureSessionsView(client, timeoutMs);
  const runtimeState = await collectRuntimeState(client);
  const activeTerminalAgentKinds = getActiveTerminalAgentKinds(runtimeState.sessions);
  const uiState = await readIssue818PreparationState(client);

  const needsClaude = !activeTerminalAgentKinds.includes('claude');
  const needsCodex = !activeTerminalAgentKinds.includes('codex');
  const needsFullscreenRecovery = !uiState.fullscreenRecoveryPresent || !uiState.rightPanelTerminalVisible;
  const spawnedAgents: Array<'claude' | 'codex'> = [];
  const notes: string[] = [
    `initial active terminal agent kinds: ${activeTerminalAgentKinds.join(', ') || 'none'}`,
    `initial fullscreen recovery present: ${String(uiState.fullscreenRecoveryPresent)}`,
  ];

  if (!needsClaude && !needsCodex && !needsFullscreenRecovery) {
    return {
      status: 'ready',
      spawnedAgents,
      activeTerminalCount: getActiveTerminalSessionRecordIds(runtimeState.sessions).length,
      activeTerminalAgentKinds,
      fullscreenRecoveryPresent: uiState.fullscreenRecoveryPresent,
      notes,
    };
  }

  const normalizedWorkdir = projectRoot.replaceAll('\\', '/');
  const runToken = Date.now();
  if (needsCodex) {
    await spawnTerminalAgentViaDialog(client, {
      agentType: 'codex',
      name: `issue818-codex-${runToken}`,
      workdir: normalizedWorkdir,
    }, timeoutMs);
    spawnedAgents.push('codex');
  }
  if (needsClaude || needsFullscreenRecovery || (!needsCodex && !needsClaude)) {
    await spawnTerminalAgentViaDialog(client, {
      agentType: 'claude',
      name: `issue818-claude-${runToken}`,
      workdir: normalizedWorkdir,
    }, timeoutMs);
    if (!spawnedAgents.includes('claude')) {
      spawnedAgents.push('claude');
    }
  }

  const preparedRuntimeState = await collectRuntimeState(client);
  const preparedUiState = await readIssue818PreparationState(client);
  const preparedAgentKinds = getActiveTerminalAgentKinds(preparedRuntimeState.sessions);
  notes.push(
    `spawned agents: ${spawnedAgents.join(', ') || 'none'}`,
    `prepared active terminal agent kinds: ${preparedAgentKinds.join(', ') || 'none'}`,
    `prepared fullscreen recovery present: ${String(preparedUiState.fullscreenRecoveryPresent)}`,
  );

  return {
    status: 'prepared',
    spawnedAgents,
    activeTerminalCount: getActiveTerminalSessionRecordIds(preparedRuntimeState.sessions).length,
    activeTerminalAgentKinds: preparedAgentKinds,
    fullscreenRecoveryPresent: preparedUiState.fullscreenRecoveryPresent,
    notes,
  };
}

function encodeRuntimeInputData(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

async function postRuntimePtyInput(
  context: RuntimeRequestContext,
  ptyId: string,
  text: string,
  timeoutMs = 4_000,
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${context.rtBaseUrl}/pty/${encodeURIComponent(ptyId)}/input`, {
      method: 'POST',
      headers: buildRuntimeRequestHeaders(context.authToken, {
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({ data: encodeRuntimeInputData(text) }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    const timedOut = controller.signal.aborted
      || (error instanceof Error && error.name === 'AbortError');
    throw new Error(timedOut ? `timeout after ${timeoutMs}ms` : (error instanceof Error ? error.message : String(error)));
  } finally {
    clearTimeout(timer);
  }
}

function buildTerminalScopeScript(
  input: {
    scope: TerminalInputExerciseResult['scope'];
    sessionId?: string;
    needle?: string;
    text?: string;
  },
  body: string,
): string {
  return `(() => {
    const input = ${JSON.stringify(input)};
    const normalizeText = (value) => {
      if (typeof value !== 'string') {
        return null;
      }
      const normalized = value.replace(/\\s+/g, ' ').trim();
      return normalized.length > 0 ? normalized.slice(0, 280) : null;
    };
    const findTiledPane = () => {
      const grid = document.querySelector('[data-testid="tiled-grid"]');
      const anchor = [
        document.querySelector('[data-testid="tiled-grid-stop-' + input.sessionId + '"]'),
        document.querySelector('[data-testid="tiled-grid-archive-' + input.sessionId + '"]'),
        document.querySelector('[data-testid="tiled-grid-pty-disconnected-' + input.sessionId + '"]'),
        document.querySelector('[data-testid="tiled-grid-disconnected-' + input.sessionId + '"]'),
      ].find((candidate) => candidate instanceof HTMLElement) ?? null;

      let pane = anchor;
      while (pane && pane.parentElement !== grid) {
        pane = pane.parentElement;
      }
      return pane;
    };
    const resolveScope = () => {
      if (input.scope === 'right-panel') {
        const container = document.querySelector('[data-testid="agent-rightpanel-pty-terminal"]');
        return {
          container,
          xtermRows: container?.querySelector('.xterm-rows') ?? null,
          disconnected: document.querySelector('[data-testid="agent-rightpanel-pty-disconnected"]'),
          errorNode: container?.querySelector('[data-testid="pty-terminal-error"]')
            ?? document.querySelector('[data-testid="pty-terminal-error"]'),
          focusTarget: container?.querySelector('.xterm-helper-textarea')
            ?? container?.querySelector('.xterm')
            ?? container,
        };
      }

      const container = findTiledPane();
      return {
        container,
        xtermRows: container?.querySelector('.xterm-rows') ?? null,
        disconnected: document.querySelector('[data-testid="tiled-grid-pty-disconnected-' + input.sessionId + '"]')
          ?? document.querySelector('[data-testid="tiled-grid-disconnected-' + input.sessionId + '"]'),
        errorNode: container?.querySelector('[data-testid="pty-terminal-error"]') ?? null,
        focusTarget: container?.querySelector('.xterm-helper-textarea')
          ?? container?.querySelector('.xterm')
          ?? container,
      };
    };
    ${body}
  })()`;
}

async function readTerminalScopeSnapshot(
  client: RawBridgeClient,
  input: {
    scope: TerminalInputExerciseResult['scope'];
    sessionId?: string;
  },
): Promise<TerminalScopeSnapshot> {
  return await client.executeJs<TerminalScopeSnapshot>(buildTerminalScopeScript(
    input,
    `const scoped = resolveScope();
    const loadingNode = scoped.container?.querySelector('[data-testid="pty-terminal-loading"]') ?? null;
    const terminalVisible = !!scoped.container && getComputedStyle(scoped.container).display !== 'none';
    const disconnectedVisible = !!scoped.disconnected && getComputedStyle(scoped.disconnected).display !== 'none';
    const loadingVisible = !!loadingNode && getComputedStyle(loadingNode).display !== 'none';
    return {
      terminalVisible,
      loadingVisible,
      xtermReady: !!scoped.xtermRows,
      disconnectedVisible,
      disconnectedMessage: input.scope === 'right-panel'
        ? normalizeText(document.querySelector('[data-testid="agent-rightpanel-pty-disconnected-message"]')?.textContent ?? '')
        : normalizeText(scoped.disconnected?.textContent ?? ''),
      disconnectedText: normalizeText(scoped.disconnected?.textContent ?? ''),
      terminalErrorMessage: normalizeText(scoped.errorNode?.textContent ?? ''),
    };`,
  ));
}

function terminalScopeReady(snapshot: TerminalScopeSnapshot): boolean {
  if (snapshot.disconnectedVisible || Boolean(snapshot.terminalErrorMessage)) {
    return true;
  }

  return snapshot.terminalVisible
    && !snapshot.loadingVisible
    && snapshot.xtermReady;
}

async function waitForTerminalScopeReady(
  client: RawBridgeClient,
  input: {
    scope: TerminalInputExerciseResult['scope'];
    sessionId?: string;
  },
  timeoutMs: number,
): Promise<TerminalScopeSnapshot> {
  const startedAt = Date.now();
  let latest = await readTerminalScopeSnapshot(client, input);

  while ((Date.now() - startedAt) < timeoutMs) {
    if (terminalScopeReady(latest)) {
      return latest;
    }
    await Bun.sleep(100);
    latest = await readTerminalScopeSnapshot(client, input);
  }

  return latest;
}

async function terminalScopeContainsMarker(
  client: RawBridgeClient,
  input: {
    scope: TerminalInputExerciseResult['scope'];
    sessionId?: string;
    needle: string;
  },
): Promise<boolean> {
  return await client.executeJs<boolean>(buildTerminalScopeScript(
    input,
    `const scoped = resolveScope();
    const haystack = (scoped.xtermRows?.textContent ?? scoped.container?.textContent ?? '').replace(/\\s+/g, ' ');
    return haystack.includes(input.needle ?? '');`,
  ));
}

async function waitForTerminalMarker(
  client: RawBridgeClient,
  input: {
    scope: TerminalInputExerciseResult['scope'];
    sessionId?: string;
    marker: string;
  },
  timeoutMs: number,
): Promise<boolean> {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    if (await terminalScopeContainsMarker(client, {
      scope: input.scope,
      sessionId: input.sessionId,
      needle: input.marker,
    })) {
      return true;
    }
    await Bun.sleep(100);
  }
  return false;
}

async function dispatchTerminalPaste(
  client: RawBridgeClient,
  input: {
    scope: TerminalInputExerciseResult['scope'];
    sessionId?: string;
    text: string;
  },
): Promise<{ dispatched: boolean; reason: string | null }> {
  return await client.executeJs<{ dispatched: boolean; reason: string | null }>(buildTerminalScopeScript(
    input,
    `const scoped = resolveScope();
    if (!(scoped.focusTarget instanceof HTMLElement)) {
      return { dispatched: false, reason: 'focus-target-missing' };
    }
    try {
      scoped.focusTarget.focus();
      const dataTransfer = new DataTransfer();
      dataTransfer.setData('text/plain', input.text ?? '');
      const pasteEvent = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(pasteEvent, 'clipboardData', {
        configurable: true,
        value: dataTransfer,
      });
      scoped.focusTarget.dispatchEvent(pasteEvent);
      return { dispatched: true, reason: null };
    } catch (error) {
      return {
        dispatched: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }`,
  ));
}

function buildUiRtConsistencySignature(input: {
  uiSummary: UiSessionSummary;
  rtSummary: ReturnType<typeof summarizeRtSessions>;
  runtimeState: RuntimeStateSnapshot;
}): string {
  return JSON.stringify({
    ui: input.uiSummary,
    rt: input.rtSummary,
    hostId: input.runtimeState.runtimeStatus.hostId ?? null,
    ptyIds: [...input.runtimeState.ptys.map((pty) => pty.id)].sort(),
  });
}

async function waitForUiRtConsistency(
  client: RawBridgeClient,
  timeoutMs: number,
): Promise<{
  uiSummary: UiSessionSummary;
  runtimeState: RuntimeStateSnapshot;
  rtSummary: ReturnType<typeof summarizeRtSessions>;
  mismatches: ReturnType<typeof compareSessionSummaries>;
}> {
  const startedAt = Date.now();
  let latest = {
    uiSummary: await collectUiSessionSummary(client),
    runtimeState: await collectRuntimeState(client),
    rtSummary: summarizeRtSessions([]),
    mismatches: [] as ReturnType<typeof compareSessionSummaries>,
  };
  latest.rtSummary = summarizeRtSessions(latest.runtimeState.sessions);
  latest.mismatches = compareSessionSummaries(latest.uiSummary, latest.rtSummary);
  let stableConsistencySignature = latest.mismatches.length === 0
    ? buildUiRtConsistencySignature(latest)
    : null;
  let stableConsistencySamples = stableConsistencySignature ? 1 : 0;

  while ((Date.now() - startedAt) < timeoutMs) {
    if (latest.mismatches.length === 0 && stableConsistencySamples >= 3) {
      return latest;
    }

    await Bun.sleep(250);
    const uiSummary = await collectUiSessionSummary(client);
    const runtimeState = await collectRuntimeState(client);
    const rtSummary = summarizeRtSessions(runtimeState.sessions);
    const mismatches = compareSessionSummaries(uiSummary, rtSummary);
    latest = { uiSummary, runtimeState, rtSummary, mismatches };

    if (mismatches.length === 0) {
      const nextSignature = buildUiRtConsistencySignature(latest);
      if (nextSignature === stableConsistencySignature) {
        stableConsistencySamples += 1;
      } else {
        stableConsistencySignature = nextSignature;
        stableConsistencySamples = 1;
      }
    } else {
      stableConsistencySignature = null;
      stableConsistencySamples = 0;
    }
  }

  return latest;
}

async function restartRuntimeAndWaitForRecovery(
  client: RawBridgeClient,
  timeoutMs: number,
): Promise<RuntimeRestartCheck> {
  const beforeUiSummary = await collectUiSessionSummary(client);
  const beforeRuntimeState = await collectRuntimeState(client);
  const beforeRtSummary = summarizeRtSessions(beforeRuntimeState.sessions);
  const beforeHostId = beforeRuntimeState.runtimeStatus.hostId ?? null;

  await client.executeJs(`(() => window.__TAURI__.core.invoke('runtime_service_stop').then(() => true))()`);
  await waitForJs<RuntimeStatusSnapshot>(
    client,
    `(async () => await window.__TAURI__.core.invoke('runtime_service_status').catch((error) => ({ running: false, error: String(error) })))()`,
    (value) => value.running !== true,
    Math.min(timeoutMs, 20_000),
    'runtime stop',
  );
  await client.executeJs(`(() => window.__TAURI__.core.invoke('runtime_service_start', { host: '0.0.0.0', port: 9124 }).then(() => true))()`);
  await waitForJs<RuntimeStatusSnapshot>(
    client,
    `(async () => await window.__TAURI__.core.invoke('runtime_service_status').catch((error) => ({ running: false, error: String(error) })))()`,
    (value) => value.running === true,
    Math.min(timeoutMs, 20_000),
    'runtime start',
  );

  const startedAt = Date.now();
  let recovered:
    | {
      uiSummary: UiSessionSummary;
      rtSummary: ReturnType<typeof summarizeRtSessions>;
      runtimeState: RuntimeStateSnapshot;
      activeTerminalSessionRecordIds: string[];
      activeTerminalRecoveryKeys: string[];
      livePtyRecoveryKeys: string[];
      missingActiveTerminalRecoveryKeys: string[];
      mismatches: ReturnType<typeof compareSessionSummaries>;
    }
    | null = null;
  while ((Date.now() - startedAt) < timeoutMs) {
    const uiSummary = await collectUiSessionSummary(client);
    const runtimeState = await collectRuntimeState(client);
    const rtSummary = summarizeRtSessions(runtimeState.sessions);
    const activeTerminalSessionRecordIds = getActiveTerminalSessionRecordIds(runtimeState.sessions);
    const activeTerminalRecoveryKeys = getActiveTerminalRecoveryKeys(runtimeState.sessions);
    const livePtyRecoveryKeys = getLivePtyRecoveryKeys(runtimeState.ptys);
    const livePtyRecoveryKeySet = new Set(livePtyRecoveryKeys);
    const missingActiveTerminalRecoveryKeys = activeTerminalRecoveryKeys.filter((recoveryKey) => (
      !livePtyRecoveryKeySet.has(recoveryKey)
    ));
    const mismatches = compareSessionSummaries(uiSummary, rtSummary);
    const ready = runtimeState.runtimeStatus.running === true
      && (runtimeState.runtimeStatus.hostId ?? null) !== beforeHostId
      && uiSummary.active === beforeUiSummary.active
      && rtSummary.active === beforeUiSummary.active
      && missingActiveTerminalRecoveryKeys.length === 0
      && mismatches.length === 0;

    if (ready) {
      recovered = {
        uiSummary,
        rtSummary,
        runtimeState,
        activeTerminalSessionRecordIds,
        activeTerminalRecoveryKeys,
        livePtyRecoveryKeys,
        missingActiveTerminalRecoveryKeys,
        mismatches,
      };
      break;
    }

    await Bun.sleep(400);
  }

  if (!recovered) {
    throw new Error('timed out waiting for runtime restart recovery to settle');
  }

  const notes = [
    `before host: ${beforeHostId ?? 'none'}`,
    `after host: ${recovered.runtimeState.runtimeStatus.hostId ?? 'none'}`,
    `before active: ${beforeUiSummary.active}`,
    `after active: ${recovered.uiSummary.active}`,
    `after PTYs: ${recovered.runtimeState.ptys.length}`,
    `after active terminal session record ids: ${recovered.activeTerminalSessionRecordIds.join(', ') || 'none'}`,
    `after active terminal recovery keys: ${recovered.activeTerminalRecoveryKeys.join(', ') || 'none'}`,
    `after live PTY recovery keys: ${recovered.livePtyRecoveryKeys.join(', ') || 'none'}`,
    `after missing active terminal recovery keys: ${recovered.missingActiveTerminalRecoveryKeys.join(', ') || 'none'}`,
  ];

  return {
    status: recovered.mismatches.length === 0 ? 'passed' : 'failed',
    beforeUiSummary,
    beforeRtSummary,
    beforePtyCount: beforeRuntimeState.ptys.length,
    beforeHostId,
    afterUiSummary: recovered.uiSummary,
    afterRtSummary: recovered.rtSummary,
    afterPtyCount: recovered.runtimeState.ptys.length,
    afterHostId: recovered.runtimeState.runtimeStatus.hostId ?? null,
    afterActiveTerminalSessionRecordIds: recovered.activeTerminalSessionRecordIds,
    afterActiveTerminalRecoveryKeys: recovered.activeTerminalRecoveryKeys,
    afterLivePtyRecoveryKeys: recovered.livePtyRecoveryKeys,
    afterMissingActiveTerminalRecoveryKeys: recovered.missingActiveTerminalRecoveryKeys,
    afterMismatches: recovered.mismatches,
    notes,
  };
}

async function waitForSessionPanel(client: RawBridgeClient, timeoutMs: number): Promise<SessionPanelProbe> {
  const snapshot = await waitForTerminalScopeReady(client, { scope: 'right-panel' }, timeoutMs);
  return {
    ready: terminalScopeReady(snapshot),
    terminalVisible: snapshot.terminalVisible,
    disconnectedVisible: snapshot.disconnectedVisible,
    disconnectedMessage: snapshot.disconnectedMessage,
    disconnectedText: snapshot.disconnectedText,
    terminalErrorMessage: snapshot.terminalErrorMessage,
  };
}

function buildSkippedTerminalInputResult(
  scope: TerminalInputExerciseResult['scope'],
  sessionId: string,
  reason: string,
): TerminalInputExerciseResult {
  return {
    scope,
    sessionId,
    status: 'skipped',
    marker: null,
    ptyId: null,
    strategy: 'none',
    notes: [reason],
  };
}

async function exerciseTerminalInput(
  client: RawBridgeClient,
  options: {
    scope: TerminalInputExerciseResult['scope'];
    sessionId: string;
    timeoutMs: number;
  },
): Promise<TerminalInputExerciseResult> {
  const marker = `ISSUE806-${options.scope === 'right-panel' ? 'RP' : 'TP'}-${Date.now().toString(36).toUpperCase()}`;
  const result: TerminalInputExerciseResult = {
    scope: options.scope,
    sessionId: options.sessionId,
    status: 'skipped',
    marker,
    ptyId: null,
    strategy: 'none',
    notes: [],
  };

  try {
    const scopeSnapshot = await waitForTerminalScopeReady(client, {
      scope: options.scope,
      sessionId: options.sessionId,
    }, Math.min(options.timeoutMs, 4_000));

    if (!scopeSnapshot.terminalVisible) {
      result.notes.push('terminal container not found in current scope');
      return result;
    }

    if (scopeSnapshot.terminalErrorMessage) {
      result.notes.push(`terminal rendered explicit error: ${scopeSnapshot.terminalErrorMessage}`);
      return result;
    }

    if (!scopeSnapshot.xtermReady) {
      result.status = 'failed';
      result.notes.push('terminal rows were not ready in current scope');
      return result;
    }

    const runtimeContext = await collectRuntimeRequestContext(client);
    const [sessions, ptys] = await Promise.all([
      fetchRuntimeJsonWithAuth<RtSessionRecord[]>(runtimeContext, '/sessions').catch((error) => {
        result.notes.push(`failed to fetch /sessions: ${error instanceof Error ? error.message : String(error)}`);
        return [];
      }),
      fetchRuntimeJsonWithAuth<RuntimePtyRecord[]>(runtimeContext, '/pty').catch((error) => {
        result.notes.push(`failed to fetch /pty: ${error instanceof Error ? error.message : String(error)}`);
        return [];
      }),
    ]);

    const matchedSession = sessions.find((session) => session.id === options.sessionId) ?? null;
    const matchedPty = ptys.find((pty) => pty.session_id === options.sessionId) ?? null;
    const ptyId = typeof matchedSession?.pty_id === 'string' && matchedSession.pty_id.length > 0
      ? matchedSession.pty_id
      : matchedPty?.id ?? null;
    result.ptyId = ptyId;

    if (!ptyId) {
      result.status = 'failed';
      result.notes.push('could not resolve PTY id for session input check');
      return result;
    }

    const pasteResult = await dispatchTerminalPaste(client, {
      scope: options.scope,
      sessionId: options.sessionId,
      text: marker,
    });

    let markerEchoed = false;
    if (pasteResult.dispatched) {
      result.strategy = 'paste';
      result.notes.push('dispatched terminal paste event');
      markerEchoed = await waitForTerminalMarker(client, {
        scope: options.scope,
        sessionId: options.sessionId,
        marker,
      }, Math.min(options.timeoutMs, 4_000));
    } else {
      result.notes.push(`terminal paste dispatch failed: ${pasteResult.reason ?? 'unknown reason'}`);
    }

    if (!markerEchoed) {
      try {
        await postRuntimePtyInput(runtimeContext, ptyId, marker);
        result.strategy = 'runtime-input';
        result.notes.push('posted marker to runtime PTY input endpoint');
      } catch (error) {
        result.status = 'failed';
        result.notes.push(`runtime PTY input failed: ${error instanceof Error ? error.message : String(error)}`);
        return result;
      }

      markerEchoed = await waitForTerminalMarker(client, {
        scope: options.scope,
        sessionId: options.sessionId,
        marker,
      }, Math.min(options.timeoutMs, 4_000));
    }

    result.status = markerEchoed ? 'passed' : 'failed';
    result.notes.push(markerEchoed
      ? 'terminal echoed marker after input'
      : 'terminal did not echo marker after input');

    try {
      await postRuntimePtyInput(runtimeContext, ptyId, '\u007f'.repeat(marker.length));
      result.notes.push('attempted cleanup with backspaces');
    } catch (error) {
      result.notes.push(`cleanup input failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    return result;
  } catch (error) {
    result.status = 'failed';
    result.notes.push('terminal input exercise threw before completion');
    result.notes.push(error instanceof Error ? error.message : String(error));
    return result;
  }
}

async function detectTerminalLoadingDuringTransition(
  client: RawBridgeClient,
  timeoutMs: number,
): Promise<boolean> {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    const loadingVisible = await client.executeJs<boolean>(
      `(() => !!document.querySelector('[data-testid="pty-terminal-loading"]'))()`,
    );
    if (loadingVisible) {
      return true;
    }
    await Bun.sleep(50);
  }

  return false;
}

async function exerciseSessionCard(
  client: RawBridgeClient,
  sessionId: string,
  expectation: 'active' | 'completed',
  target: 'session-card' | 'topology-node',
  selector: string,
  timeoutMs: number,
  options: {
    verifyInput?: boolean;
  } = {},
): Promise<SessionCardExerciseResult> {
  await installConsoleTap(client);
  const loadingPromise = detectTerminalLoadingDuringTransition(client, Math.min(timeoutMs, 1500));
  try {
    await clickBySelector(client, selector, selector);
  } catch (error) {
    return {
      target,
      sessionId,
      expectation,
      status: 'failed',
      loadingObserved: await loadingPromise,
      terminalVisible: false,
      disconnectedVisible: false,
      disconnectedMessage: null,
      terminalErrorMessage: null,
      consoleEntries: await readConsoleEntries(client),
      input: null,
      notes: [
        'target session card/node disappeared before the charter could click it',
        error instanceof Error ? error.message : String(error),
      ],
    };
  }
  const panel = await waitForSessionPanel(client, timeoutMs);
  const loadingObserved = await loadingPromise;
  const consoleEntries = await readConsoleEntries(client);
  const notes: string[] = [];
  const shouldVerifyInput = options.verifyInput === true && expectation === 'active';

  if (loadingObserved) {
    notes.push('observed terminal loading indicator');
  }
  if (panel.terminalVisible) {
    notes.push('right panel terminal container became visible');
  }
  if (panel.disconnectedVisible) {
    notes.push('right panel showed disconnected history/failure state');
  }
  if (panel.disconnectedMessage) {
    notes.push(`ui failure message: ${panel.disconnectedMessage}`);
  }
  if (panel.terminalErrorMessage) {
    notes.push(`terminal overlay error: ${panel.terminalErrorMessage}`);
  }

  const hasAgentHubPtyTrace = consoleEntries.some((entry) => entry.text.includes('[agent-hub][pty][open]'));
  if (hasAgentHubPtyTrace) {
    notes.push('console emitted [agent-hub][pty][open] trace');
  }

  const inputResult = shouldVerifyInput && panel.terminalVisible && !panel.terminalErrorMessage
    ? await exerciseTerminalInput(client, {
      scope: 'right-panel',
      sessionId,
      timeoutMs,
    })
    : shouldVerifyInput
      ? buildSkippedTerminalInputResult(
        'right-panel',
        sessionId,
        panel.terminalErrorMessage
          ? `terminal already showed explicit error: ${panel.terminalErrorMessage}`
          : 'session did not reach a live right-panel terminal state',
      )
      : null;
  if (inputResult) {
    notes.push(`terminal input ${inputResult.status} via ${inputResult.strategy}`);
    if (inputResult.marker) {
      notes.push(`input marker: ${inputResult.marker}`);
    }
    notes.push(...inputResult.notes);
  }

  const hasExplicitFailureUi = Boolean(panel.disconnectedVisible && panel.disconnectedMessage)
    || Boolean(panel.terminalErrorMessage);
  const hasUsableTerminal = panel.terminalVisible && !panel.terminalErrorMessage;
  const passed = (hasUsableTerminal || hasExplicitFailureUi)
    && (!panel.disconnectedVisible || !!panel.disconnectedMessage)
    && hasAgentHubPtyTrace;
  const inputPassed = !shouldVerifyInput || !hasUsableTerminal || inputResult?.status === 'passed';

  if (!hasAgentHubPtyTrace) {
    notes.push('missing [agent-hub][pty][open] trace');
  }
  if (panel.disconnectedVisible && !panel.disconnectedMessage) {
    notes.push('disconnected state missing explicit failure message');
  }
  if (panel.terminalVisible && panel.terminalErrorMessage) {
    notes.push('live terminal container fell back to explicit terminal error overlay');
  }
  if (hasUsableTerminal && shouldVerifyInput && inputResult?.status !== 'passed') {
    notes.push('live terminal did not pass input echo verification');
  }

  return {
    target,
    sessionId,
    expectation,
    status: passed && inputPassed ? 'passed' : 'failed',
    loadingObserved,
    terminalVisible: panel.terminalVisible,
    disconnectedVisible: panel.disconnectedVisible,
    disconnectedMessage: panel.disconnectedMessage,
    terminalErrorMessage: panel.terminalErrorMessage,
    consoleEntries,
    input: inputResult,
    notes,
  };
}

async function checkProposalInboxPage(
  client: RawBridgeClient,
  timeoutMs: number,
): Promise<ProposalPageCheck> {
  await navigateToRoute(client, '/proposals', timeoutMs);

  const state = await waitForJs<ProposalPageCheck>(
    client,
    `(() => ({
      status: 'failed',
      href: window.location.href,
      loading: document.body ? ((document.body.textContent ?? '').includes('请求箱加载中...')) : false,
      page: !!document.querySelector('[data-testid="proposal-inbox-page"]'),
      snippet: document.body ? ((document.body.textContent ?? '').replace(/\\s+/g, ' ').trim().slice(0, 320) || null) : null,
    }))()`,
    (value) => value.page && !value.loading,
    timeoutMs,
    'proposal inbox page',
  );

  return {
    ...state,
    status: state.page && !state.loading ? 'passed' : 'failed',
  };
}

async function verifyTiledViewBehavior(
  client: RawBridgeClient,
  activeSessionIds: string[],
  timeoutMs: number,
): Promise<TiledViewCheck> {
  await ensureTiledView(client, timeoutMs);
  const initialState = await collectTiledViewState(client);
  let loadingObserved = initialState.loadingCount > 0;
  const loadingStartedAt = Date.now();
  while (!loadingObserved && (Date.now() - loadingStartedAt) < Math.min(timeoutMs, 1500)) {
    await Bun.sleep(50);
    loadingObserved = (await collectTiledViewState(client)).loadingCount > 0;
  }
  await Bun.sleep(500);
  const settledState = await collectTiledViewState(client);
  const inputChecks: TerminalInputExerciseResult[] = [];
  for (const sessionId of activeSessionIds) {
    inputChecks.push(await exerciseTerminalInput(client, {
      scope: 'tiled-pane',
      sessionId,
      timeoutMs,
    }));
  }
  const clickResult = await client.executeJs<{ clicked: boolean }>(
    `(() => {
      const sessionIds = ${JSON.stringify(activeSessionIds)};
      const candidates = sessionIds.flatMap((sessionId) => ([
        document.querySelector('[data-testid="tiled-grid-stop-' + sessionId + '"]'),
        document.querySelector('[data-testid="tiled-grid-archive-' + sessionId + '"]'),
        document.querySelector('[data-testid="tiled-grid-pty-disconnected-' + sessionId + '"]'),
      ])).filter(Boolean);

      const anchor = candidates[0];
      if (!(anchor instanceof HTMLElement)) {
        return { clicked: false };
      }

      const pane = anchor.parentElement?.parentElement?.parentElement ?? anchor.closest('div');
      if (!(pane instanceof HTMLElement)) {
        return { clicked: false };
      }

      pane.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return { clicked: true };
    })()`,
  );
  await Bun.sleep(300);
  const afterClickState = await collectTiledViewState(client);

  const paneRectsStable = JSON.stringify(settledState.paneRects) === JSON.stringify(afterClickState.paneRects);
  const rightPanelVisible = afterClickState.rightPanelVisible;
  const notes = [
    loadingObserved
      ? `observed ${initialState.loadingCount} tiled loading overlay(s)`
      : 'no tiled loading overlay observed during first sample',
    `live terminals in tiled view: ${afterClickState.liveTerminalCount}`,
    `disconnected panes in tiled view: ${afterClickState.disconnectedPaneCount}`,
    ...inputChecks.map((check) => (
      `tiled input ${check.sessionId}: ${check.status} via ${check.strategy}${check.marker ? ` (${check.marker})` : ''}`
    )),
    clickResult.clicked
      ? 'clicked a tiled pane root'
      : 'could not locate an interactive tiled pane root to click',
    paneRectsStable
      ? 'tiled pane rectangles stayed stable after click'
      : 'tiled pane rectangles changed after click',
    rightPanelVisible
      ? 'right panel became visible while tiled view stayed active'
      : 'right panel stayed closed after tiled pane click',
  ];

  return {
    status: loadingObserved
      && afterClickState.visible
      && !rightPanelVisible
      && paneRectsStable
      && inputChecks.every((check) => check.status === 'passed')
      ? 'passed'
      : 'failed',
    activeSessionIds,
    loadingObserved,
    rightPanelVisible,
    paneRectsStable,
    liveTerminalCount: afterClickState.liveTerminalCount,
    disconnectedPaneCount: afterClickState.disconnectedPaneCount,
    inputChecks,
    notes,
  };
}

async function verifyAgentViewRestorationViaTasks(
  client: RawBridgeClient,
  targetView: 'topology' | 'sessions' | 'tiled',
  timeoutMs: number,
): Promise<CharterCheck> {
  if (targetView === 'topology') {
    await ensureTopologyView(client, timeoutMs);
  } else if (targetView === 'tiled') {
    await ensureTiledView(client, timeoutMs);
  } else {
    await ensureSessionsView(client, timeoutMs);
  }

  await clickBySelector(client, '[data-testid="desktop-sidebar-item-tasks"]', 'tasks sidebar item');
  await waitForJs<{ pathname: string }>(
    client,
    `(() => ({ pathname: window.location.pathname }))()`,
    (value) => value.pathname === '/tasks',
    timeoutMs,
    'tasks page',
  );
  await clickBySelector(client, '[data-testid="desktop-sidebar-item-agents"]', 'agents sidebar item');

  const expectedVisibilityCheck = targetView === 'topology'
    ? `(() => ({
        pathname: window.location.pathname,
        storedViewMode: window.localStorage.getItem('exomind:agentHubViewMode'),
        visible: !!document.querySelector('[data-testid="agent-topology-view"]'),
      }))()`
    : targetView === 'tiled'
      ? `(() => ({
          pathname: window.location.pathname,
          storedViewMode: window.localStorage.getItem('exomind:agentHubViewMode'),
          visible: !!document.querySelector('[data-testid="tiled-grid"]'),
        }))()`
      : `(() => ({
          pathname: window.location.pathname,
          storedViewMode: window.localStorage.getItem('exomind:agentHubViewMode'),
          visible: !!document.querySelector('[data-testid="sessions-view"]')
            || !!document.querySelector('[data-testid="sessions-empty-state"]'),
        }))()`;

  const state = await waitForJs<{
    pathname: string;
    storedViewMode: string | null;
    visible: boolean;
  }>(
    client,
    expectedVisibilityCheck,
    (value) => value.pathname === '/agents' && value.visible,
    timeoutMs,
    `restore ${targetView} after tasks`,
  );

  const passed = state.visible && state.storedViewMode === targetView;
  return {
    id: `restore-${targetView}-after-tasks`,
    title: `从任务页返回后恢复网络/${targetView}`,
    status: passed ? 'passed' : 'failed',
    notes: [
      `pathname=${state.pathname}`,
      `storedViewMode=${state.storedViewMode ?? 'null'}`,
      passed
        ? `network view restored to ${targetView}`
        : `network view did not restore to ${targetView}`,
    ],
  };
}

async function verifyMultiViewRoundTrip(
  client: RawBridgeClient,
  timeoutMs: number,
): Promise<MultiViewRoundTripCheck> {
  const sequence = ['sessions', 'tiled', 'sessions', 'topology', 'sessions', 'tiled'];
  const notes: string[] = [];

  for (const view of sequence) {
    if (view === 'sessions') {
      await ensureSessionsView(client, timeoutMs);
    } else if (view === 'tiled') {
      await ensureTiledView(client, timeoutMs);
    } else {
      await ensureTopologyView(client, timeoutMs);
    }
    const state = await readAgentHubViewState(client);
    notes.push(`${view}: stored=${state.storedViewMode ?? 'null'} path=${state.pathname}`);
  }

  const finalState = await readAgentHubViewState(client);
  return {
    status: finalState.tiledVisible && finalState.storedViewMode === 'tiled'
      ? 'passed'
      : 'failed',
    sequence,
    finalViewMode: finalState.storedViewMode,
    notes,
  };
}

function buildMarkdownReport(input: {
  timestamp: string;
  instance: CharterInstanceDescriptor;
  charterChecks: CharterCheck[];
  topologyNodeChecks: SessionCardExerciseResult[];
  uiSummary: UiSessionSummary;
  rtSummary: ReturnType<typeof summarizeRtSessions>;
  mismatches: ReturnType<typeof compareSessionSummaries>;
  activeSessionChecks: SessionCardExerciseResult[];
  completedSessionCheck: SessionCardExerciseResult | null;
  proposalInboxCheck: ProposalPageCheck;
  tiledViewCheck: TiledViewCheck;
  multiViewRoundTripCheck: MultiViewRoundTripCheck;
  runtimeRestartCheck: RuntimeRestartCheck;
  postRestartActiveSessionChecks: SessionCardExerciseResult[];
  preRestartRtSummarySource: 'runtime-http' | 'sqlite-fallback';
  overallPass: boolean;
}): string {
  const lines = [
    '# Tauri MCP Charter Report',
    '',
    `- Generated at: \`${input.timestamp}\``,
    `- Instance: \`${input.instance.name}\` (${input.instance.source})`,
    `- Web: \`http://localhost:${input.instance.webPort}\``,
    `- Raw bridge: \`ws://127.0.0.1:${input.instance.bridgePort}\``,
    `- Overall: ${input.overallPass ? 'PASS' : 'FAIL'}`,
    `- Pre-restart RT source: \`${input.preRestartRtSummarySource}\``,
    '',
    '## Nine-Story Charter Checks',
    '',
  ];

  for (const check of input.charterChecks) {
    lines.push(`- ${check.id}: ${check.status.toUpperCase()} — ${check.title} (${check.notes.join('; ') || 'no notes'})`);
  }

  lines.push(
    '',
    '## Topology Terminal Nodes',
    '',
  );

  if (input.topologyNodeChecks.length === 0) {
    lines.push('- No topology PTY nodes were detected.');
  } else {
    for (const check of input.topologyNodeChecks) {
      lines.push(`- Topology session \`${check.sessionId}\`: ${check.status.toUpperCase()} (${check.notes.join('; ') || 'no notes'})`);
    }
  }

  lines.push(
    '',
    '## Pre-Restart Session Counts',
    '',
    `- UI active/completed/total: \`${input.uiSummary.active}/${input.uiSummary.completed}/${input.uiSummary.total}\``,
    `- RT active/completed/total: \`${input.rtSummary.active}/${input.rtSummary.completed}/${input.rtSummary.total}\``,
    `- UI visible ids: ${input.uiSummary.visibleSessionIds.length > 0 ? input.uiSummary.visibleSessionIds.map((value) => `\`${value}\``).join(', ') : '(none)'}`,
    `- RT visible ids: ${input.rtSummary.visibleSessionIds.length > 0 ? input.rtSummary.visibleSessionIds.map((value) => `\`${value}\``).join(', ') : '(none)'}`,
    '',
    '## Pre-Restart Session Card Checks',
    '',
  );

  if (input.activeSessionChecks.length === 0) {
    lines.push('- No active session cards were present in the current instance.');
  } else {
    for (const check of input.activeSessionChecks) {
      lines.push(`- Active session \`${check.sessionId}\`: ${check.status.toUpperCase()} (input=${check.input?.status ?? 'n/a'}; ${check.notes.join('; ') || 'no notes'})`);
    }
  }

  if (input.completedSessionCheck) {
    lines.push(`- Completed session \`${input.completedSessionCheck.sessionId}\`: ${input.completedSessionCheck.status.toUpperCase()} (${input.completedSessionCheck.notes.join('; ') || 'no notes'})`);
  } else {
    lines.push('- No completed session card was present to verify the disconnected-history fallback.');
  }

  lines.push(
    '',
    '## Tiled View',
    '',
    `- Status: ${input.tiledViewCheck.status.toUpperCase()}`,
    `- Loading observed: \`${String(input.tiledViewCheck.loadingObserved)}\``,
    `- Right panel visible while tiled: \`${String(input.tiledViewCheck.rightPanelVisible)}\``,
    `- Pane rects stable after click: \`${String(input.tiledViewCheck.paneRectsStable)}\``,
    `- Live terminal count: \`${input.tiledViewCheck.liveTerminalCount}\``,
    `- Disconnected pane count: \`${input.tiledViewCheck.disconnectedPaneCount}\``,
    `- Notes: ${input.tiledViewCheck.notes.join('; ') || 'none'}`,
  );
  if (input.tiledViewCheck.inputChecks.length === 0) {
    lines.push('- No tiled terminal input checks were executed.');
  } else {
    for (const check of input.tiledViewCheck.inputChecks) {
      lines.push(`- Tiled input \`${check.sessionId}\`: ${check.status.toUpperCase()} via \`${check.strategy}\` (${check.notes.join('; ') || 'no notes'})`);
    }
  }
  lines.push(
    '',
    '## Multi-View Round Trip',
    '',
    `- Status: ${input.multiViewRoundTripCheck.status.toUpperCase()}`,
    `- Sequence: ${input.multiViewRoundTripCheck.sequence.join(' -> ')}`,
    `- Final stored view: \`${input.multiViewRoundTripCheck.finalViewMode ?? 'null'}\``,
    `- Notes: ${input.multiViewRoundTripCheck.notes.join('; ') || 'none'}`,
  );

  lines.push('', '## Proposal Inbox', '', `- Status: ${input.proposalInboxCheck.status.toUpperCase()}`, `- Href: \`${input.proposalInboxCheck.href}\``, `- Loading visible: \`${String(input.proposalInboxCheck.loading)}\``);

  if (input.proposalInboxCheck.snippet) {
    lines.push(`- Snippet: ${input.proposalInboxCheck.snippet}`);
  }

  lines.push('', '## Pre-Restart Mismatches', '');
  if (input.mismatches.length === 0) {
    lines.push('- None');
  } else {
    for (const mismatch of input.mismatches) {
      lines.push(`- ${mismatch.field}: UI=${JSON.stringify(mismatch.ui)} RT=${JSON.stringify(mismatch.rt)}`);
    }
  }

  lines.push(
    '',
    '## Runtime Restart',
    '',
    `- Status: ${input.runtimeRestartCheck.status.toUpperCase()}`,
    `- Host transition: \`${input.runtimeRestartCheck.beforeHostId ?? 'none'}\` -> \`${input.runtimeRestartCheck.afterHostId ?? 'none'}\``,
    `- Before UI active/completed/total: \`${input.runtimeRestartCheck.beforeUiSummary.active}/${input.runtimeRestartCheck.beforeUiSummary.completed}/${input.runtimeRestartCheck.beforeUiSummary.total}\``,
    `- After UI active/completed/total: \`${input.runtimeRestartCheck.afterUiSummary.active}/${input.runtimeRestartCheck.afterUiSummary.completed}/${input.runtimeRestartCheck.afterUiSummary.total}\``,
    `- Before RT active/completed/total: \`${input.runtimeRestartCheck.beforeRtSummary.active}/${input.runtimeRestartCheck.beforeRtSummary.completed}/${input.runtimeRestartCheck.beforeRtSummary.total}\``,
    `- After RT active/completed/total: \`${input.runtimeRestartCheck.afterRtSummary.active}/${input.runtimeRestartCheck.afterRtSummary.completed}/${input.runtimeRestartCheck.afterRtSummary.total}\``,
    `- Before PTY count: \`${input.runtimeRestartCheck.beforePtyCount}\``,
    `- After PTY count: \`${input.runtimeRestartCheck.afterPtyCount}\``,
    `- After active terminal session record ids: ${input.runtimeRestartCheck.afterActiveTerminalSessionRecordIds.length > 0 ? input.runtimeRestartCheck.afterActiveTerminalSessionRecordIds.map((value) => `\`${value}\``).join(', ') : '(none)'}`,
    `- After active terminal recovery keys: ${input.runtimeRestartCheck.afterActiveTerminalRecoveryKeys.length > 0 ? input.runtimeRestartCheck.afterActiveTerminalRecoveryKeys.map((value) => `\`${value}\``).join(', ') : '(none)'}`,
    `- After live PTY recovery keys: ${input.runtimeRestartCheck.afterLivePtyRecoveryKeys.length > 0 ? input.runtimeRestartCheck.afterLivePtyRecoveryKeys.map((value) => `\`${value}\``).join(', ') : '(none)'}`,
    `- Missing active terminal recovery keys after restart: ${input.runtimeRestartCheck.afterMissingActiveTerminalRecoveryKeys.length > 0 ? input.runtimeRestartCheck.afterMissingActiveTerminalRecoveryKeys.map((value) => `\`${value}\``).join(', ') : '(none)'}`,
    `- Notes: ${input.runtimeRestartCheck.notes.join('; ') || 'none'}`,
    '',
    '## Post-Restart Active Card Checks',
    '',
  );

  if (input.postRestartActiveSessionChecks.length === 0) {
    lines.push('- No active session cards were present after restart.');
  } else {
    for (const check of input.postRestartActiveSessionChecks) {
      lines.push(`- Active session \`${check.sessionId}\`: ${check.status.toUpperCase()} (input=${check.input?.status ?? 'n/a'}; ${check.notes.join('; ') || 'no notes'})`);
    }
  }

  lines.push('', '## Post-Restart Mismatches', '');
  if (input.runtimeRestartCheck.afterMismatches.length === 0) {
    lines.push('- None');
  } else {
    for (const mismatch of input.runtimeRestartCheck.afterMismatches) {
      lines.push(`- ${mismatch.field}: UI=${JSON.stringify(mismatch.ui)} RT=${JSON.stringify(mismatch.rt)}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = process.cwd();
  const directInstance = resolveDirectInstance(projectRoot, args);
  const instance: CharterInstanceDescriptor = directInstance ?? await (async () => {
    const managedInstance = await selectManagedInstance(projectRoot, args.name);
    return {
      name: managedInstance.name,
      webPort: managedInstance.webPort,
      bridgePort: resolveManagedInstanceBridgePort(managedInstance.webPort),
      runtimeDbPath: path.join(projectRoot, '.tmp', 'tauri-dev-state', managedInstance.name, 'app-data', 'runtime', 'sessions.sqlite'),
      hmrPort: managedInstance.hmrPort,
      rootPid: managedInstance.rootPid,
      source: 'managed' as const,
    };
  })();
  const reportTimestamp = new Date().toISOString().replaceAll(':', '-');
  const outDir = args.outDir;
  const jsonReportPath = path.join(outDir, `${reportTimestamp}-${instance.name}.json`);
  const markdownReportPath = path.join(outDir, `${reportTimestamp}-${instance.name}.md`);

  const client = new RawBridgeClient(`ws://127.0.0.1:${instance.bridgePort}`);
  await client.ready();

  try {
    await navigateToRoute(client, '/agents', args.timeoutMs);
    await installConsoleTap(client);
    await ensureSessionsView(client, args.timeoutMs);
    const issue818Preparation = await ensureIssue818RecoveryPreparation(client, args.timeoutMs, projectRoot);
    process.stdout.write(`${JSON.stringify({
      issue818Preparation,
    }, null, 2)}\n`);

    const charterChecks: CharterCheck[] = [];
    const restoreSessionsCheck = await verifyAgentViewRestorationViaTasks(client, 'sessions', args.timeoutMs);
    charterChecks.push({
      ...restoreSessionsCheck,
      id: 'story-1',
      title: '进入网络页时恢复上次使用的会话子页面',
    });

    await ensureSessionsView(client, args.timeoutMs);
    const {
      uiSummary,
      runtimeState: rtState,
      rtSummary: runtimeHttpSummary,
      mismatches: runtimeHttpMismatches,
    } = await waitForUiRtConsistency(client, args.timeoutMs);
    const preRestartSqliteRtSummary = trySummarizeRtSessionsFromSqlite(instance.runtimeDbPath);
    const sqliteFallbackMismatches = preRestartSqliteRtSummary
      ? compareSessionSummaries(uiSummary, preRestartSqliteRtSummary)
      : null;
    const preRestartRtSummarySource: 'runtime-http' | 'sqlite-fallback' = runtimeHttpMismatches.length === 0
      ? 'runtime-http'
      : sqliteFallbackMismatches && sqliteFallbackMismatches.length === 0
        ? 'sqlite-fallback'
        : 'runtime-http';
    const rtSummary = preRestartRtSummarySource === 'sqlite-fallback' && preRestartSqliteRtSummary
      ? preRestartSqliteRtSummary
      : runtimeHttpSummary;
    const mismatches = compareSessionSummaries(uiSummary, rtSummary);

    const topologyViewCheck = await ensureTopologyView(client, args.timeoutMs);
    const topologyNodeTestIds = await waitForTopologyTerminalNodeTestIds(
      client,
      uiSummary.activeSessionIds,
      args.timeoutMs,
    );
    const missingTopologySessionIds = uiSummary.activeSessionIds.filter((sessionId) => (
      !topologyNodeTestIds.includes(`rf__node-pty-${sessionId}`)
    ));
    charterChecks.push({
      id: 'story-2',
      title: '拓扑图中呈现所有活跃终端节点',
      status: topologyViewCheck.status === 'passed' && missingTopologySessionIds.length === 0
        ? 'passed'
        : 'failed',
      notes: [
        ...topologyViewCheck.notes,
        `detected topology PTY nodes: ${topologyNodeTestIds.length}`,
        missingTopologySessionIds.length === 0
          ? 'all active sessions had topology PTY nodes'
          : `missing topology PTY nodes for: ${missingTopologySessionIds.join(', ')}`,
      ],
    });

    const topologyNodeChecks: SessionCardExerciseResult[] = [];
    for (const sessionId of uiSummary.activeSessionIds) {
      const selector = `[data-testid="rf__node-pty-${sessionId}"]`;
      if (!topologyNodeTestIds.includes(`rf__node-pty-${sessionId}`)) {
        topologyNodeChecks.push({
          target: 'topology-node',
          sessionId,
          expectation: 'active',
          status: 'failed',
          loadingObserved: false,
          terminalVisible: false,
          disconnectedVisible: false,
          disconnectedMessage: null,
          terminalErrorMessage: null,
          consoleEntries: [],
          input: null,
          notes: ['missing topology PTY node'],
        });
        continue;
      }
      topologyNodeChecks.push(await exerciseSessionCard(
        client,
        sessionId,
        'active',
        'topology-node',
        selector,
        args.timeoutMs,
        { verifyInput: false },
      ));
    }
    charterChecks.push({
      id: 'story-3',
      title: '点击拓扑图终端节点可打开对应 PTY 或明确失败态',
      status: topologyNodeChecks.every((check) => check.status === 'passed') ? 'passed' : 'failed',
      notes: topologyNodeChecks.map((check) => `${check.sessionId}:${check.status}`),
    });

    await ensureSessionsView(client, args.timeoutMs);
    const activeSessionChecks: SessionCardExerciseResult[] = [];
    for (const sessionId of uiSummary.activeSessionIds) {
      activeSessionChecks.push(await exerciseSessionCard(
        client,
        sessionId,
        'active',
        'session-card',
        `[data-testid="session-card-${sessionId}"]`,
        args.timeoutMs,
        { verifyInput: true },
      ));
    }
    charterChecks.push({
      id: 'story-4',
      title: '会话页中每张活跃会话卡都能加载对应 PTY 并接受输入回显',
      status: activeSessionChecks.every((check) => check.status === 'passed') ? 'passed' : 'failed',
      notes: activeSessionChecks.map((check) => (
        `${check.sessionId}:${check.status}:loading=${String(check.loadingObserved)}:input=${check.input?.status ?? 'n/a'}`
      )),
    });

    const repeatedSessionSwitchChecks: SessionCardExerciseResult[] = [];
    if (uiSummary.activeSessionIds.length >= 2) {
      const [firstSessionId, secondSessionId] = uiSummary.activeSessionIds;
      repeatedSessionSwitchChecks.push(await exerciseSessionCard(
        client,
        firstSessionId!,
        'active',
        'session-card',
        `[data-testid="session-card-${firstSessionId}"]`,
        args.timeoutMs,
        { verifyInput: false },
      ));
      repeatedSessionSwitchChecks.push(await exerciseSessionCard(
        client,
        secondSessionId!,
        'active',
        'session-card',
        `[data-testid="session-card-${secondSessionId}"]`,
        args.timeoutMs,
        { verifyInput: false },
      ));
      repeatedSessionSwitchChecks.push(await exerciseSessionCard(
        client,
        firstSessionId!,
        'active',
        'session-card',
        `[data-testid="session-card-${firstSessionId}"]`,
        args.timeoutMs,
        { verifyInput: false },
      ));
    }
    charterChecks.push({
      id: 'story-5',
      title: '会话页来回切换活跃卡片时 PTY 可稳定重放',
      status: repeatedSessionSwitchChecks.length === 0
        ? 'skipped'
        : repeatedSessionSwitchChecks.every((check) => check.status === 'passed')
          ? 'passed'
          : 'failed',
      notes: repeatedSessionSwitchChecks.length === 0
        ? ['fewer than two active sessions were present']
        : repeatedSessionSwitchChecks.map((check) => `${check.sessionId}:${check.status}`),
    });

    const completedSessionCheck = uiSummary.completedSessionIds[0]
      ? await exerciseSessionCard(
        client,
        uiSummary.completedSessionIds[0]!,
        'completed',
        'session-card',
        `[data-testid="session-card-${uiSummary.completedSessionIds[0]!}"]`,
        args.timeoutMs,
        { verifyInput: false },
      )
      : null;

    const tiledViewCheck = await verifyTiledViewBehavior(client, uiSummary.activeSessionIds, args.timeoutMs);
    charterChecks.push({
      id: 'story-6',
      title: '平铺页并行加载活跃 PTY 并接受输入回显',
      status: tiledViewCheck.status,
      notes: tiledViewCheck.notes,
    });
    charterChecks.push({
      id: 'story-7',
      title: '点击平铺窗口时右侧 Terminal 保持关闭且布局稳定',
      status: !tiledViewCheck.rightPanelVisible && tiledViewCheck.paneRectsStable
        ? 'passed'
        : 'failed',
      notes: tiledViewCheck.notes,
    });

    const multiViewRoundTripCheck = await verifyMultiViewRoundTrip(client, args.timeoutMs);
    charterChecks.push({
      id: 'story-8',
      title: '拓扑图/会话/平铺多视图往返切换保持稳定',
      status: multiViewRoundTripCheck.status,
      notes: multiViewRoundTripCheck.notes,
    });

    const restoreTiledCheck = await verifyAgentViewRestorationViaTasks(client, 'tiled', args.timeoutMs);
    charterChecks.push({
      ...restoreTiledCheck,
      id: 'story-9',
      title: '从任务页返回后恢复上次使用的平铺子页面与 PTY',
    });

    await ensureSessionsView(client, args.timeoutMs);
    const proposalInboxCheck = await checkProposalInboxPage(client, args.timeoutMs);
    await navigateToRoute(client, '/agents', args.timeoutMs);
    await ensureSessionsView(client, args.timeoutMs);

    const runtimeRestartCheck = await restartRuntimeAndWaitForRecovery(
      client,
      Math.max(args.timeoutMs, 30_000),
    );

    const postRestartActiveSessionChecks: SessionCardExerciseResult[] = [];
    for (const sessionId of runtimeRestartCheck.afterUiSummary.activeSessionIds) {
      postRestartActiveSessionChecks.push(await exerciseSessionCard(
        client,
        sessionId,
        'active',
        'session-card',
        `[data-testid="session-card-${sessionId}"]`,
        args.timeoutMs,
        { verifyInput: true },
      ));
    }

    const activeCountWithinLimit = uiSummary.active < 5 && runtimeRestartCheck.afterUiSummary.active < 5;
    const nineStoryChecksPassed = charterChecks.every((check) => check.status === 'passed' || check.status === 'skipped');
    const activeChecksPassed = activeSessionChecks.every((check) => check.status === 'passed');
    const postRestartActiveChecksPassed = postRestartActiveSessionChecks.every((check) => check.status === 'passed');
    const completedCheckPassed = completedSessionCheck ? completedSessionCheck.status === 'passed' : true;
    const overallPass = activeCountWithinLimit
      && nineStoryChecksPassed
      && mismatches.length === 0
      && activeChecksPassed
      && runtimeRestartCheck.status === 'passed'
      && postRestartActiveChecksPassed
      && completedCheckPassed
      && proposalInboxCheck.status === 'passed';

    const report = {
      generatedAt: new Date().toISOString(),
      instance,
      rawBridge: {
        url: `ws://127.0.0.1:${instance.bridgePort}`,
      },
      assertions: {
        activeCountWithinLimit,
        nineStoryChecksPassed,
        uiRtConsistent: mismatches.length === 0,
        activeChecksPassed,
        runtimeRestartPassed: runtimeRestartCheck.status === 'passed',
        postRestartActiveChecksPassed,
        completedCheckPassed,
        proposalInboxLoaded: proposalInboxCheck.status === 'passed',
      },
      charterChecks,
      topologyNodeChecks,
      preRestartRtSummarySource,
      uiSummary,
      rtSummary,
      mismatches,
      preRestartSqliteRtSummary,
      preRestartRuntimeHttpSummary: runtimeHttpSummary,
      preRestartRuntimeHttpMismatches: runtimeHttpMismatches,
      activeSessionChecks,
      completedSessionCheck,
      proposalInboxCheck,
      tiledViewCheck,
      multiViewRoundTripCheck,
      runtimeRestartCheck,
      postRestartActiveSessionChecks,
      sqliteRtSummary: trySummarizeRtSessionsFromSqlite(instance.runtimeDbPath),
      overallPass,
    };

    await mkdir(outDir, { recursive: true });
    await writeFile(jsonReportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    await writeFile(markdownReportPath, buildMarkdownReport({
      timestamp: report.generatedAt,
      instance,
      charterChecks,
      topologyNodeChecks,
      uiSummary,
      rtSummary,
      mismatches,
      activeSessionChecks,
      completedSessionCheck,
      proposalInboxCheck,
      tiledViewCheck,
      multiViewRoundTripCheck,
      runtimeRestartCheck,
      postRestartActiveSessionChecks,
      preRestartRtSummarySource,
      overallPass,
    }), 'utf8');

    process.stdout.write(`${JSON.stringify({
      overallPass,
      instance: instance.name,
      bridgePort: instance.bridgePort,
      activeCount: runtimeRestartCheck.afterUiSummary.active,
      mismatchCount: runtimeRestartCheck.afterMismatches.length,
      jsonReportPath,
      markdownReportPath,
    }, null, 2)}\n`);

    if (!overallPass) {
      process.exitCode = 1;
    }
  } finally {
    client.close();
  }
}

await main();
