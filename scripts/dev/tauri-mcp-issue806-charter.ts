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
};

type ConsoleEntry = {
  level: 'info' | 'warn' | 'error';
  text: string;
};

type SessionCardExerciseResult = {
  sessionId: string;
  expectation: 'active' | 'completed';
  status: 'passed' | 'failed' | 'skipped';
  terminalVisible: boolean;
  disconnectedVisible: boolean;
  disconnectedMessage: string | null;
  consoleEntries: ConsoleEntry[];
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
  afterMismatches: ReturnType<typeof compareSessionSummaries>;
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
): Promise<void> {
  const result = await client.executeJs<{ clicked: boolean; reason: string | null }>(
    `(() => {
      const node = document.querySelector(${JSON.stringify(selector)});
      if (!(node instanceof HTMLElement)) {
        return { clicked: false, reason: 'not-found' };
      }
      node.click();
      return { clicked: true, reason: null };
    })()`,
  );

  if (!result.clicked) {
    throw new Error(`failed to click ${label}: ${result.reason}`);
  }
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

async function collectRuntimeState(client: RawBridgeClient): Promise<RuntimeStateSnapshot> {
  return await client.executeJs<RuntimeStateSnapshot>(`(async () => {
    const runtimeStatus = await window.__TAURI__.core.invoke('runtime_service_status').catch((error) => ({
      running: false,
      host: '127.0.0.1',
      port: 9124,
      hostId: null,
      error: String(error),
    }));
    const host = typeof runtimeStatus?.host === 'string' && runtimeStatus.host.length > 0
      ? runtimeStatus.host
      : '127.0.0.1';
    const port = typeof runtimeStatus?.port === 'number' && Number.isFinite(runtimeStatus.port)
      ? runtimeStatus.port
      : 9124;
    const rtBaseUrl = 'http://' + (host === '0.0.0.0' ? '127.0.0.1' : host) + ':' + String(port);

    const sessions = await fetch(rtBaseUrl + '/sessions')
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('HTTP ' + String(response.status));
        }
        return await response.json();
      })
      .catch(() => []);
    const ptys = await fetch(rtBaseUrl + '/pty')
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('HTTP ' + String(response.status));
        }
        return await response.json();
      })
      .catch(() => []);

    return {
      runtimeStatus,
      sessions: Array.isArray(sessions) ? sessions : [],
      ptys: Array.isArray(ptys) ? ptys : [],
    };
  })()`);
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
  await Bun.sleep(1_000);
  await client.executeJs(`(() => window.__TAURI__.core.invoke('runtime_service_start', { host: '0.0.0.0', port: 9124 }).then(() => true))()`);

  const startedAt = Date.now();
  let recovered:
    | {
      uiSummary: UiSessionSummary;
      rtSummary: ReturnType<typeof summarizeRtSessions>;
      runtimeState: RuntimeStateSnapshot;
      mismatches: ReturnType<typeof compareSessionSummaries>;
    }
    | null = null;
  while ((Date.now() - startedAt) < timeoutMs) {
    const uiSummary = await collectUiSessionSummary(client);
    const runtimeState = await collectRuntimeState(client);
    const rtSummary = summarizeRtSessions(runtimeState.sessions);
    const mismatches = compareSessionSummaries(uiSummary, rtSummary);
    const ready = runtimeState.runtimeStatus.running === true
      && (runtimeState.runtimeStatus.hostId ?? null) !== beforeHostId
      && uiSummary.active === beforeUiSummary.active
      && rtSummary.active === beforeUiSummary.active
      && runtimeState.ptys.length === beforeUiSummary.active
      && mismatches.length === 0;

    if (ready) {
      recovered = { uiSummary, rtSummary, runtimeState, mismatches };
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
    afterMismatches: recovered.mismatches,
    notes,
  };
}

async function waitForSessionPanel(client: RawBridgeClient, timeoutMs: number): Promise<SessionPanelProbe> {
  return await waitForJs<SessionPanelProbe>(
    client,
    `(() => {
      const terminal = document.querySelector('[data-testid="agent-rightpanel-pty-terminal"]');
      const disconnected = document.querySelector('[data-testid="agent-rightpanel-pty-disconnected"]');
      const terminalVisible = !!terminal && getComputedStyle(terminal).display !== 'none';
      const disconnectedVisible = !!disconnected && getComputedStyle(disconnected).display !== 'none';
      return {
        ready: terminalVisible || disconnectedVisible,
        terminalVisible,
        disconnectedVisible,
        disconnectedMessage: document.querySelector('[data-testid="agent-rightpanel-pty-disconnected-message"]')?.textContent?.trim() ?? null,
        disconnectedText: disconnected?.textContent?.replace(/\\s+/g, ' ').trim().slice(0, 280) ?? null,
      };
    })()`,
    (value) => value.ready,
    timeoutMs,
    'terminal panel state',
  );
}

async function exerciseSessionCard(
  client: RawBridgeClient,
  sessionId: string,
  expectation: 'active' | 'completed',
  timeoutMs: number,
): Promise<SessionCardExerciseResult> {
  await installConsoleTap(client);
  await clickBySelector(client, `[data-testid="session-card-${sessionId}"]`, `session-card-${sessionId}`);
  const panel = await waitForSessionPanel(client, timeoutMs);
  const consoleEntries = await readConsoleEntries(client);
  const notes: string[] = [];

  if (panel.terminalVisible) {
    notes.push('right panel terminal container became visible');
  }
  if (panel.disconnectedVisible) {
    notes.push('right panel showed disconnected history/failure state');
  }
  if (panel.disconnectedMessage) {
    notes.push(`ui failure message: ${panel.disconnectedMessage}`);
  }

  const hasAgentHubPtyTrace = consoleEntries.some((entry) => entry.text.includes('[agent-hub][pty][open]'));
  if (hasAgentHubPtyTrace) {
    notes.push('console emitted [agent-hub][pty][open] trace');
  }

  const passed = (panel.terminalVisible || panel.disconnectedVisible)
    && (!panel.disconnectedVisible || !!panel.disconnectedMessage)
    && hasAgentHubPtyTrace;

  if (!hasAgentHubPtyTrace) {
    notes.push('missing [agent-hub][pty][open] trace');
  }
  if (panel.disconnectedVisible && !panel.disconnectedMessage) {
    notes.push('disconnected state missing explicit failure message');
  }

  return {
    sessionId,
    expectation,
    status: passed ? 'passed' : 'failed',
    terminalVisible: panel.terminalVisible,
    disconnectedVisible: panel.disconnectedVisible,
    disconnectedMessage: panel.disconnectedMessage,
    consoleEntries,
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

function buildMarkdownReport(input: {
  timestamp: string;
  instance: CharterInstanceDescriptor;
  uiSummary: UiSessionSummary;
  rtSummary: ReturnType<typeof summarizeRtSessions>;
  mismatches: ReturnType<typeof compareSessionSummaries>;
  activeSessionChecks: SessionCardExerciseResult[];
  completedSessionCheck: SessionCardExerciseResult | null;
  proposalInboxCheck: ProposalPageCheck;
  runtimeRestartCheck: RuntimeRestartCheck;
  postRestartActiveSessionChecks: SessionCardExerciseResult[];
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
  ];

  if (input.activeSessionChecks.length === 0) {
    lines.push('- No active session cards were present in the current instance.');
  } else {
    for (const check of input.activeSessionChecks) {
      lines.push(`- Active session \`${check.sessionId}\`: ${check.status.toUpperCase()} (${check.notes.join('; ') || 'no notes'})`);
    }
  }

  if (input.completedSessionCheck) {
    lines.push(`- Completed session \`${input.completedSessionCheck.sessionId}\`: ${input.completedSessionCheck.status.toUpperCase()} (${input.completedSessionCheck.notes.join('; ') || 'no notes'})`);
  } else {
    lines.push('- No completed session card was present to verify the disconnected-history fallback.');
  }

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
    `- Notes: ${input.runtimeRestartCheck.notes.join('; ') || 'none'}`,
    '',
    '## Post-Restart Active Card Checks',
    '',
  );

  if (input.postRestartActiveSessionChecks.length === 0) {
    lines.push('- No active session cards were present after restart.');
  } else {
    for (const check of input.postRestartActiveSessionChecks) {
      lines.push(`- Active session \`${check.sessionId}\`: ${check.status.toUpperCase()} (${check.notes.join('; ') || 'no notes'})`);
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

    const uiSummary = await collectUiSessionSummary(client);
    const rtState = await collectRuntimeState(client);
    const rtSummary = summarizeRtSessions(rtState.sessions);
    const mismatches = compareSessionSummaries(uiSummary, rtSummary);

    const activeSessionChecks: SessionCardExerciseResult[] = [];
    for (const sessionId of uiSummary.activeSessionIds) {
      activeSessionChecks.push(await exerciseSessionCard(client, sessionId, 'active', args.timeoutMs));
    }

    const completedSessionCheck = uiSummary.completedSessionIds[0]
      ? await exerciseSessionCard(client, uiSummary.completedSessionIds[0]!, 'completed', args.timeoutMs)
      : null;

    const proposalInboxCheck = await checkProposalInboxPage(client, args.timeoutMs);
    await navigateToRoute(client, '/agents', args.timeoutMs);
    await ensureSessionsView(client, args.timeoutMs);

    const runtimeRestartCheck = await restartRuntimeAndWaitForRecovery(
      client,
      Math.max(args.timeoutMs, 30_000),
    );

    const postRestartActiveSessionChecks: SessionCardExerciseResult[] = [];
    for (const sessionId of runtimeRestartCheck.afterUiSummary.activeSessionIds) {
      postRestartActiveSessionChecks.push(await exerciseSessionCard(client, sessionId, 'active', args.timeoutMs));
    }

    const activeCountWithinLimit = uiSummary.active < 5 && runtimeRestartCheck.afterUiSummary.active < 5;
    const activeChecksPassed = activeSessionChecks.every((check) => check.status === 'passed');
    const postRestartActiveChecksPassed = postRestartActiveSessionChecks.every((check) => check.status === 'passed');
    const completedCheckPassed = completedSessionCheck ? completedSessionCheck.status === 'passed' : true;
    const overallPass = activeCountWithinLimit
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
        uiRtConsistent: mismatches.length === 0,
        activeChecksPassed,
        runtimeRestartPassed: runtimeRestartCheck.status === 'passed',
        postRestartActiveChecksPassed,
        completedCheckPassed,
        proposalInboxLoaded: proposalInboxCheck.status === 'passed',
      },
      uiSummary,
      rtSummary,
      mismatches,
      activeSessionChecks,
      completedSessionCheck,
      proposalInboxCheck,
      runtimeRestartCheck,
      postRestartActiveSessionChecks,
      sqliteRtSummary: instance.runtimeDbPath
        ? (() => {
          try {
            return summarizeRtSessions(readRtSessionsFromSqlite(instance.runtimeDbPath!));
          } catch {
            return null;
          }
        })()
        : null,
      overallPass,
    };

    await mkdir(outDir, { recursive: true });
    await writeFile(jsonReportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    await writeFile(markdownReportPath, buildMarkdownReport({
      timestamp: report.generatedAt,
      instance,
      uiSummary,
      rtSummary,
      mismatches,
      activeSessionChecks,
      completedSessionCheck,
      proposalInboxCheck,
      runtimeRestartCheck,
      postRestartActiveSessionChecks,
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
