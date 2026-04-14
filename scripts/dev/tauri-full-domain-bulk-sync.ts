#!/usr/bin/env bun

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ManagedTauriInstanceRecord } from './tauri-dev-manager-lib';
import { resolveManagedInstanceBridgePort } from './tauri-mcp-issue806-charter-lib';

type SyncSide = 'sync-a' | 'sync-b';
type DomainName = 'eventlog' | 'task' | 'timeblock' | 'proposal';

type CliOptions = {
  host: string;
  bridgePortA?: number;
  bridgePortB?: number;
  instanceNameA?: string;
  instanceNameB?: string;
  profileSlug: string;
  profilePassword: string;
  requestTimeoutMs: number;
  observationMs: number;
  pollIntervalMs: number;
  seedCount: number;
  outDir: string;
  route: string;
  runId: string;
};

type RawBridgeMessage = {
  id?: string;
  success?: boolean;
  data?: unknown;
  error?: unknown;
};

type RuntimeStatusSnapshot = {
  running?: boolean;
  host?: string;
  port?: number;
  hostId?: string | null;
  error?: string | null;
  externalRuntime?: boolean;
  startedAt?: string | null;
  pid?: number | null;
};

type ManagedInstanceDescriptor = {
  name: string;
  webPort: number;
  hmrPort?: number;
  bridgePort: number;
  rootPid?: number;
  source: 'manager' | 'direct';
};

type BridgeRuntimeContext = {
  runtimeStatus: RuntimeStatusSnapshot;
  rtBaseUrl: string;
  href: string;
  pathname: string;
  title: string;
  instance?: ManagedInstanceDescriptor;
};

type PageFetchResponse<T = unknown> = {
  ok: boolean;
  status: number;
  text: string;
  json: T | null;
  rtBaseUrl: string;
  hostId: string | null;
  href: string;
  error?: string | null;
};

type PollResult<T> = {
  ok: boolean;
  elapsedMs: number;
  value: T | null;
  attempts: number;
  lastError?: string | null;
};

type PeerRecord = {
  id: string;
  base_url: string;
  enabled: boolean;
  status?: string;
  last_seen?: string | null;
  last_error?: string | null;
  created_at?: string;
  updated_at?: string;
};

type BootstrappedProfile = {
  action: 'login' | 'register_then_login' | 'already_logged_in';
  activeProfileId: string | null;
  scopeKey: string;
  currentUser: string | null;
  isLoggedIn: boolean;
  sessionRaw: string | null;
};

type RuntimeHostRecord = {
  id: string;
  name: string;
  host: string;
  port: number;
  hostId?: string;
  trustState?: string;
  verificationStatus?: string;
  authToken?: string;
};

type TaskReplicationSummary = {
  schema_version: 1;
  scope_key: string;
  task_count: number;
  max_updated_at: number;
  revision_hash: string;
  generated_at: number;
};

type DomainSeedSummary = {
  domain: DomainName;
  requested: number;
  imported?: number;
  skipped?: number;
  total?: number;
  created?: number;
  sampleIds: string[];
  sampleMarkers: string[];
  notes: string[];
};

type MarkerScopeSnapshot = {
  eventlog: {
    count: number;
    sampleIds: string[];
    sampleMarkers: string[];
  };
  task: {
    count: number;
    sampleIds: string[];
    sampleMarkers: string[];
    replicationSummary: TaskReplicationSummary | null;
  };
  timeblock: {
    count: number;
    sampleIds: string[];
    sampleMarkers: string[];
  };
  proposal: {
    count: number;
    sampleIds: string[];
    sampleMarkers: string[];
  };
};

type DomainObservation = {
  domain: DomainName;
  converged: boolean;
  latencyMs: number | null;
  firstConvergedAt?: string;
  requiredCount: number;
  observedCount: number;
  missingSampleIds: string[];
  notes: string[];
};

type ObservationTick = {
  at: string;
  elapsedMs: number;
  sourceSnapshot: MarkerScopeSnapshot;
  targetSnapshot: MarkerScopeSnapshot;
  hostsB: RuntimeHostRecord[];
  peersA: PeerRecord[];
  peersB: PeerRecord[];
  domainStates: Record<DomainName, DomainObservation>;
};

type UiRouteCheck = {
  domain: DomainName;
  route: string;
  passed: boolean;
  elapsedMs: number | null;
  marker: string;
  snippet: string | null;
  notes: string[];
};

type PairingSummary = {
  sessionId: string;
  pin: string;
  responderInboundToken: string;
  initiatorInboundToken: string;
  peerConvergence: PollResult<{
    peersA: PeerRecord[];
    peersB: PeerRecord[];
  }>;
};

type BulkSyncSummary = {
  startedAt: string;
  finishedAt: string;
  runId: string;
  options: CliOptions;
  instances: {
    a: ManagedInstanceDescriptor;
    b: ManagedInstanceDescriptor;
  };
  bridge: {
    a: BridgeRuntimeContext;
    b: BridgeRuntimeContext;
  };
  profile: {
    a: BootstrappedProfile;
    b: BootstrappedProfile;
  };
  baseline: {
    a: MarkerScopeSnapshot;
    b: MarkerScopeSnapshot;
  };
  seeds: DomainSeedSummary[];
  pairing: PairingSummary;
  observation: {
    startedAt: string;
    backfillTrigger: {
      converged: boolean;
      observedCount: number;
      elapsedMs: number;
      error?: string;
    };
    ticks: ObservationTick[];
    finalDomainStates: Record<DomainName, DomainObservation>;
    finishedEarly: boolean;
  };
  uiChecks: UiRouteCheck[];
  finalSnapshots: {
    a: MarkerScopeSnapshot;
    b: MarkerScopeSnapshot;
  };
  overallPassed: boolean;
};

const DEFAULT_OPTIONS: CliOptions = {
  host: '127.0.0.1',
  bridgePortA: undefined,
  bridgePortB: undefined,
  instanceNameA: 'full-sync-c',
  instanceNameB: 'full-sync-d',
  profileSlug: 'tmcp-fullsync-20260414',
  profilePassword: 'tmcp-123456',
  requestTimeoutMs: 20_000,
  observationMs: 120_000,
  pollIntervalMs: 1_000,
  seedCount: 120,
  outDir: path.join(process.cwd(), '.tmp', 'reports', 'tauri-full-domain-bulk-sync'),
  route: '/agents',
  runId: `TMCP-FULLSYNC-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}`,
};

function parseInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseOptionalInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseArgs(argv: string[]): CliOptions {
  const options = { ...DEFAULT_OPTIONS };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    if (!current.startsWith('--')) {
      continue;
    }

    switch (current) {
      case '--host':
        if (next) {
          options.host = next;
          index += 1;
        }
        break;
      case '--bridge-a':
        options.bridgePortA = parseOptionalInteger(next);
        index += 1;
        break;
      case '--bridge-b':
        options.bridgePortB = parseOptionalInteger(next);
        index += 1;
        break;
      case '--name-a':
        if (next) {
          options.instanceNameA = next;
          index += 1;
        }
        break;
      case '--name-b':
        if (next) {
          options.instanceNameB = next;
          index += 1;
        }
        break;
      case '--profile-slug':
        if (next) {
          options.profileSlug = next;
          index += 1;
        }
        break;
      case '--profile-password':
        if (next) {
          options.profilePassword = next;
          index += 1;
        }
        break;
      case '--request-timeout-ms':
        options.requestTimeoutMs = parseInteger(next, options.requestTimeoutMs);
        index += 1;
        break;
      case '--observation-ms':
        options.observationMs = parseInteger(next, options.observationMs);
        index += 1;
        break;
      case '--poll-interval-ms':
        options.pollIntervalMs = parseInteger(next, options.pollIntervalMs);
        index += 1;
        break;
      case '--seed-count':
        options.seedCount = Math.max(1, parseInteger(next, options.seedCount));
        index += 1;
        break;
      case '--out-dir':
        if (next) {
          options.outDir = path.resolve(next);
          index += 1;
        }
        break;
      case '--route':
        if (next) {
          options.route = next;
          index += 1;
        }
        break;
      case '--run-id':
        if (next) {
          options.runId = next;
          index += 1;
        }
        break;
      default:
        break;
    }
  }

  return options;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPidAlive(pid: number | undefined | null): boolean {
  if (!Number.isInteger(pid) || pid === null || pid === undefined || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readManagedInstanceRecords(projectRoot: string): Promise<ManagedTauriInstanceRecord[]> {
  const registryDir = path.join(projectRoot, '.tmp', 'tauri-dev-instances');
  let entries: string[] = [];

  try {
    entries = await readdir(registryDir);
  } catch {
    return [];
  }

  const records: ManagedTauriInstanceRecord[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) {
      continue;
    }

    try {
      const raw = await readFile(path.join(registryDir, entry), 'utf8');
      records.push(JSON.parse(raw) as ManagedTauriInstanceRecord);
    } catch {
      // Ignore malformed instance metadata.
    }
  }

  return records.sort((left, right) => left.name.localeCompare(right.name));
}

function recordToInstanceDescriptor(
  record: ManagedTauriInstanceRecord,
  bridgePortOverride?: number,
): ManagedInstanceDescriptor {
  return {
    name: record.name,
    webPort: record.webPort,
    hmrPort: record.hmrPort,
    bridgePort: bridgePortOverride ?? resolveManagedInstanceBridgePort(record.webPort),
    rootPid: record.rootPid,
    source: 'manager',
  };
}

async function resolveManagedInstances(
  options: CliOptions,
): Promise<{
  instances: { a: ManagedInstanceDescriptor; b: ManagedInstanceDescriptor };
  managerSnapshot: ManagedTauriInstanceRecord[];
}> {
  const records = await readManagedInstanceRecords(process.cwd());
  const liveRecords = records.filter((record) => isPidAlive(record.rootPid));

  const findByName = (name: string | undefined): ManagedTauriInstanceRecord | null => {
    if (!name) return null;
    return liveRecords.find((record) => record.name === name) ?? null;
  };

  const selectedA = findByName(options.instanceNameA);
  const selectedB = findByName(options.instanceNameB);

  if (options.instanceNameA && !selectedA) {
    throw new Error(`managed tauri instance not running: ${options.instanceNameA}`);
  }
  if (options.instanceNameB && !selectedB) {
    throw new Error(`managed tauri instance not running: ${options.instanceNameB}`);
  }

  if (selectedA && selectedB) {
    return {
      instances: {
        a: recordToInstanceDescriptor(selectedA, options.bridgePortA),
        b: recordToInstanceDescriptor(selectedB, options.bridgePortB),
      },
      managerSnapshot: records,
    };
  }

  if (options.bridgePortA !== undefined && options.bridgePortB !== undefined) {
    return {
      instances: {
        a: {
          name: options.instanceNameA ?? `direct-a-${options.bridgePortA}`,
          webPort: 0,
          bridgePort: options.bridgePortA,
          source: 'direct',
        },
        b: {
          name: options.instanceNameB ?? `direct-b-${options.bridgePortB}`,
          webPort: 0,
          bridgePort: options.bridgePortB,
          source: 'direct',
        },
      },
      managerSnapshot: records,
    };
  }

  if (liveRecords.length !== 2) {
    throw new Error(`expected exactly 2 running tauri:manager instances, found ${liveRecords.length}`);
  }

  return {
    instances: {
      a: recordToInstanceDescriptor(liveRecords[0], options.bridgePortA),
      b: recordToInstanceDescriptor(liveRecords[1], options.bridgePortB),
    },
    managerSnapshot: records,
  };
}

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
  private readonly opened: Promise<void>;
  private sequence = 0;
  private runtimeBaseUrl: string | null = null;
  private runtimeHostId: string | null = null;
  private runtimeHref: string | null = null;

  constructor(private readonly url: string) {
    this.ws = new WebSocket(url);
    this.opened = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`bridge connect timeout: ${url}`)), 10_000);
      this.ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      });
      this.ws.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error(`bridge connect failed: ${url}`));
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
        slot.reject(new Error(`bridge closed: ${url}`));
      }
      this.pending.clear();
    });
  }

  async ready(): Promise<void> {
    await this.opened;
  }

  async send<T>(
    command: string,
    args: Record<string, unknown> = {},
    timeoutMs = 15_000,
  ): Promise<T> {
    await this.ready();

    return await new Promise<T>((resolve, reject) => {
      const id = `req-${++this.sequence}`;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`bridge command timeout: ${command}`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (message) => {
          if (message.success === false) {
            reject(new Error(`bridge command failed: ${command}: ${JSON.stringify(message.error ?? null)}`));
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

  async executeJs<T>(script: string, timeoutMs = 15_000): Promise<T> {
    return await this.send<T>('execute_js', {
      script,
      windowLabel: 'main',
    }, timeoutMs);
  }

  bindRuntimeContext(context: Pick<BridgeRuntimeContext, 'rtBaseUrl' | 'runtimeStatus' | 'href'>): void {
    this.runtimeBaseUrl = context.rtBaseUrl;
    this.runtimeHostId = context.runtimeStatus.hostId ?? null;
    this.runtimeHref = context.href;
  }

  getBoundRuntimeContext(): { rtBaseUrl: string; hostId: string | null; href: string | null } | null {
    if (!this.runtimeBaseUrl) {
      return null;
    }
    return {
      rtBaseUrl: this.runtimeBaseUrl,
      hostId: this.runtimeHostId,
      href: this.runtimeHref,
    };
  }

  close(): void {
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close();
    }
  }
}

function buildPageFetchScript(input: {
  path?: string;
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs: number;
}): string {
  const method = input.method ?? 'GET';
  const headers = input.headers ?? {};
  const bodyLiteral = input.body === undefined ? 'undefined' : JSON.stringify(input.body);

  return `(async () => {
    const runtimeStatus = await window.__TAURI__.core.invoke('runtime_service_status').catch(() => null);
    const normalizeHost = (value) => value === '0.0.0.0' ? '127.0.0.1' : value;
    const runtimeHost = typeof runtimeStatus?.host === 'string' && runtimeStatus.host.length > 0
      ? normalizeHost(runtimeStatus.host)
      : '127.0.0.1';
    const runtimePort = typeof runtimeStatus?.port === 'number' && Number.isFinite(runtimeStatus.port)
      ? runtimeStatus.port
      : 9124;
    const rtBaseUrl = 'http://' + runtimeHost + ':' + String(runtimePort);
    const targetUrl = ${input.url ? JSON.stringify(input.url) : `rtBaseUrl + ${JSON.stringify(input.path ?? '')}`};
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ${input.timeoutMs});
    try {
      const response = await fetch(targetUrl, {
        method: ${JSON.stringify(method)},
        headers: ${JSON.stringify(headers)},
        body: ${bodyLiteral},
        signal: controller.signal,
      });
      const text = await response.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      return {
        ok: response.ok,
        status: response.status,
        text,
        json,
        rtBaseUrl,
        hostId: typeof runtimeStatus?.hostId === 'string' ? runtimeStatus.hostId : null,
        href: window.location.href,
        error: null,
      };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        text: '',
        json: null,
        rtBaseUrl,
        hostId: typeof runtimeStatus?.hostId === 'string' ? runtimeStatus.hostId : null,
        href: window.location.href,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(timer);
    }
  })()`;
}

async function fetchRuntimeResponse<T>(
  url: string,
  timeoutMs: number,
  init?: RequestInit,
): Promise<{
  ok: boolean;
  status: number;
  text: string;
  json: T | null;
  error: string | null;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = new Headers(init?.headers ?? {});
    if (!headers.has('Origin')) {
      headers.set('Origin', 'http://localhost');
    }
    if (!headers.has('Accept')) {
      headers.set('Accept', 'application/json');
    }

    const response = await fetch(url, {
      ...init,
      headers,
      signal: controller.signal,
    });
    const text = await response.text();
    let json: T | null = null;
    try {
      json = text ? JSON.parse(text) as T : null;
    } catch {
      json = null;
    }
    return {
      ok: response.ok,
      status: response.status,
      text,
      json,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      text: '',
      json: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function pageFetch<T>(
  client: RawBridgeClient,
  input: {
    path?: string;
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    timeoutMs: number;
  },
): Promise<PageFetchResponse<T>> {
  const boundRuntime = client.getBoundRuntimeContext();
  if (boundRuntime) {
    const targetUrl = input.url ?? `${boundRuntime.rtBaseUrl}${input.path ?? ''}`;
    const response = await fetchRuntimeResponse<T>(targetUrl, input.timeoutMs, {
      method: input.method ?? 'GET',
      headers: input.headers,
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
    });
    return {
      ...response,
      rtBaseUrl: boundRuntime.rtBaseUrl,
      hostId: boundRuntime.hostId,
      href: boundRuntime.href ?? targetUrl,
    };
  }

  const body = input.body === undefined ? undefined : JSON.stringify(input.body);
  const requestTimeoutMs = Math.max(1_500, Math.min(input.timeoutMs, 8_000));
  return await client.executeJs<PageFetchResponse<T>>(buildPageFetchScript({
    path: input.path,
    url: input.url,
    method: input.method,
    headers: input.headers,
    body,
    timeoutMs: requestTimeoutMs,
  }), Math.max(input.timeoutMs + 5_000, 20_000));
}

async function pollUntil<T>(
  producer: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<PollResult<T>> {
  const startedAt = Date.now();
  let attempts = 0;
  let lastValue: T | null = null;
  let lastError: string | null = null;

  while ((Date.now() - startedAt) < timeoutMs) {
    attempts += 1;
    try {
      const value = await producer();
      lastValue = value;
      if (predicate(value)) {
        return {
          ok: true,
          elapsedMs: Date.now() - startedAt,
          value,
          attempts,
          lastError,
        };
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(pollIntervalMs);
  }

  return {
    ok: false,
    elapsedMs: Date.now() - startedAt,
    value: lastValue,
    attempts,
    lastError,
  };
}

async function waitForJs<T>(
  client: RawBridgeClient,
  script: string,
  predicate: (value: T) => boolean,
  timeoutMs: number,
  label: string,
  pollIntervalMs = 250,
): Promise<T> {
  const result = await pollUntil(
    () => client.executeJs<T>(script),
    predicate,
    timeoutMs,
    pollIntervalMs,
  );

  if (!result.ok || result.value === null) {
    throw new Error(`${label} did not become ready within ${timeoutMs}ms`);
  }

  return result.value;
}

async function waitForPageReady(
  client: RawBridgeClient,
  route: string,
  instance?: ManagedInstanceDescriptor,
): Promise<BridgeRuntimeContext> {
  await client.executeJs(`(() => {
    if (window.location.pathname !== ${JSON.stringify(route)}) {
      window.location.assign(${JSON.stringify(route)});
    }
    return true;
  })()`);

  const snapshot = await waitForJs<BridgeRuntimeContext>(
    client,
    `(async () => {
      const runtimeStatus = await window.__TAURI__.core.invoke('runtime_service_status').catch(() => null);
      const normalizeHost = (value) => value === '0.0.0.0' ? '127.0.0.1' : value;
      const runtimeHost = typeof runtimeStatus?.host === 'string' && runtimeStatus.host.length > 0
        ? normalizeHost(runtimeStatus.host)
        : '127.0.0.1';
      const runtimePort = typeof runtimeStatus?.port === 'number' && Number.isFinite(runtimeStatus.port)
        ? runtimeStatus.port
        : 9124;
      return {
        runtimeStatus,
        rtBaseUrl: 'http://' + runtimeHost + ':' + String(runtimePort),
        href: window.location.href,
        pathname: window.location.pathname,
        title: document.title,
      };
    })()`,
    (value) => value.pathname === route && value.runtimeStatus?.running === true,
    15_000,
    `route ${route}`,
  );

  client.bindRuntimeContext(snapshot);
  return {
    ...snapshot,
    instance,
  };
}

async function ensureAgentsPageReady(client: RawBridgeClient, timeoutMs: number): Promise<void> {
  try {
    await waitForJs<{ ready: boolean }>(
      client,
      `(() => ({ ready: !!document.querySelector('[data-testid="agent-view-toggle-sessions"]') }))()`,
      (value) => value.ready,
      Math.min(timeoutMs, 4_000),
      'agents page initial ready state',
    );
    return;
  } catch {
    await client.executeJs(`(() => { window.location.reload(); return true; })()`);
  }

  await waitForJs<{ ready: boolean }>(
    client,
    `(() => ({ ready: !!document.querySelector('[data-testid="agent-view-toggle-sessions"]') }))()`,
    (value) => value.ready,
    timeoutMs,
    'agents page after reload',
  );
}

function normalizeRoutePath(route: string): string {
  try {
    return new URL(route, 'http://127.0.0.1').pathname;
  } catch {
    return route.split('?')[0] ?? route;
  }
}

async function waitForRoutePath(
  client: RawBridgeClient,
  route: string,
  timeoutMs: number,
  label = `navigate to ${route}`,
): Promise<void> {
  const expectedPath = normalizeRoutePath(route);
  await waitForJs<{ pathname: string }>(
    client,
    `(() => ({ pathname: window.location.pathname }))()`,
    (value) => value.pathname === expectedPath,
    timeoutMs,
    label,
  );
}

async function navigateToRoute(
  client: RawBridgeClient,
  route: string,
  timeoutMs: number,
): Promise<void> {
  await client.executeJs(
    `(() => { window.location.assign(${JSON.stringify(route)}); return true; })()`,
  );

  await waitForRoutePath(client, route, timeoutMs);
}

async function clickBySelector(
  client: RawBridgeClient,
  selector: string,
  label: string,
  timeoutMs = 4_000,
): Promise<void> {
  await waitForJs<{ ready: boolean }>(
    client,
    `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!(element instanceof HTMLElement)) {
        return { ready: false };
      }
      const style = window.getComputedStyle(element);
      return {
        ready: element.getClientRects().length > 0
          && style.display !== 'none'
          && style.visibility !== 'hidden'
          && !element.hasAttribute('disabled')
          && element.getAttribute('aria-disabled') !== 'true',
      };
    })()`,
    (value) => value.ready,
    timeoutMs,
    `${label} ready`,
  );

  const clicked = await client.executeJs<{ clicked: boolean; reason: string | null }>(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLElement)) {
      return { clicked: false, reason: 'not-found' };
    }
    element.scrollIntoView({ block: 'center', inline: 'center' });
    element.focus?.();

    const rect = element.getBoundingClientRect();
    const clientX = rect.left + (rect.width / 2);
    const clientY = rect.top + (rect.height / 2);
    const baseInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX,
      clientY,
      button: 0,
      buttons: 1,
    };

    const dispatch = (event) => element.dispatchEvent(event);
    if (typeof PointerEvent === 'function') {
      dispatch(new PointerEvent('pointerdown', {
        ...baseInit,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
      }));
    }
    dispatch(new MouseEvent('mousedown', baseInit));
    if (typeof PointerEvent === 'function') {
      dispatch(new PointerEvent('pointerup', {
        ...baseInit,
        buttons: 0,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
      }));
    }
    dispatch(new MouseEvent('mouseup', {
      ...baseInit,
      buttons: 0,
    }));
    dispatch(new MouseEvent('click', {
      ...baseInit,
      buttons: 0,
      detail: 1,
    }));
    return { clicked: true, reason: null };
  })()`);

  if (!clicked.clicked) {
    throw new Error(`failed to click ${label}: ${clicked.reason ?? 'unknown'}`);
  }
}

async function navigateToRouteViaUi(
  client: RawBridgeClient,
  route: string,
  timeoutMs: number,
): Promise<boolean> {
  switch (route) {
    case '/eventlog':
      await clickBySelector(client, '[data-testid="desktop-sidebar-item-now"]', 'sidebar eventlog', timeoutMs);
      await waitForRoutePath(client, route, timeoutMs, 'sidebar navigate to /eventlog');
      return true;
    case '/eventlog/record':
      await clickBySelector(client, '[data-testid="desktop-sidebar-item-now"]', 'sidebar eventlog', timeoutMs);
      await waitForRoutePath(client, '/eventlog', timeoutMs, 'sidebar navigate to /eventlog');
      await clickBySelector(client, '[data-testid="now-page-view-toggle-record"]', 'eventlog record tab', timeoutMs);
      await waitForRoutePath(client, route, timeoutMs, 'navigate to /eventlog/record');
      return true;
    case '/tasks':
    case '/tasks?main=1':
      await clickBySelector(client, '[data-testid="desktop-sidebar-item-tasks"]', 'sidebar tasks', timeoutMs);
      await waitForRoutePath(client, '/tasks', timeoutMs, 'sidebar navigate to /tasks');
      return true;
    case '/tasks/timeline':
      await clickBySelector(client, '[data-testid="desktop-sidebar-item-tasks"]', 'sidebar tasks', timeoutMs);
      await waitForRoutePath(client, '/tasks', timeoutMs, 'sidebar navigate to /tasks');
      await clickBySelector(client, '[data-testid="task-domain-tab-timeline"]', 'timeline tab', timeoutMs);
      await waitForRoutePath(client, route, timeoutMs, 'navigate to /tasks/timeline');
      return true;
    case '/proposals':
      await clickBySelector(client, '[data-testid="desktop-sidebar-item-tasks"]', 'sidebar tasks', timeoutMs);
      await waitForRoutePath(client, '/tasks', timeoutMs, 'sidebar navigate to /tasks');
      await clickBySelector(client, '[data-testid="task-domain-tab-proposals"]', 'proposal tab', timeoutMs);
      await waitForRoutePath(client, route, timeoutMs, 'navigate to /proposals');
      return true;
    default:
      return false;
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
  await clickBySelector(
    client,
    '[data-testid="agent-view-toggle-sessions"]',
    'sessions toggle',
  );
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

async function bootstrapProfile(
  client: RawBridgeClient,
  slug: string,
  password: string,
  timeoutMs: number,
): Promise<BootstrappedProfile> {
  // Compute expected profileId at TypeScript level (not inside the JS string).
  const expectedProfileId = `profile-${slug.replace(/^profile-/, '')}`;
  const jsExpectedProfileId = JSON.stringify(expectedProfileId);

  return await client.executeJs<BootstrappedProfile>(`(async () => {
    const [{ useSyncStore }, profileStorage] = await Promise.all([
      import('/src/ui/stores/sync-store.ts'),
      import('/src/lib/profile/profile-storage.ts'),
    ]);
    const state = useSyncStore.getState();
    let action = 'already_logged_in';

    if (state.isLoggedIn && state.activeProfileId === ${jsExpectedProfileId}) {
      // Already logged in with the correct profile — no-op, return current state.
      return {
        action,
        activeProfileId: state.activeProfileId,
        scopeKey: ${jsExpectedProfileId},
        currentUser: state.currentUser ?? null,
        isLoggedIn: true,
        sessionRaw: localStorage.getItem('exomind:profile-session'),
      };
    }

    // Profile mismatch or not logged in — reset first, then (re)login.
    if (state.isLoggedIn) {
      await state.logout();
    }

    try {
      await state.login(${JSON.stringify(slug)}, ${JSON.stringify(password)});
      action = 'login';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('用户不存在')) {
        await state.register(${JSON.stringify(slug)}, ${JSON.stringify(password)});
        await useSyncStore.getState().login(${JSON.stringify(slug)}, ${JSON.stringify(password)});
        action = 'register_then_login';
      } else {
        throw error;
      }
    }

    const nextState = useSyncStore.getState();
    return {
      action,
      activeProfileId: nextState.activeProfileId ?? null,
      scopeKey: profileStorage.getCurrentProfileOrLegacyId(),
      currentUser: nextState.currentUser ?? null,
      isLoggedIn: nextState.isLoggedIn,
      sessionRaw: localStorage.getItem('exomind:profile-session'),
    };
  })()`, timeoutMs);
}

async function collectRuntimeHosts(client: RawBridgeClient, timeoutMs: number): Promise<RuntimeHostRecord[]> {
  return await client.executeJs<RuntimeHostRecord[]>(`(async () => {
    const { getRuntimeHostService } = await import('/src/lib/services/runtime-host.service.ts');
    return await getRuntimeHostService().listHosts();
  })()`, timeoutMs);
}

async function fetchPeerList(
  client: RawBridgeClient,
  timeoutMs: number,
): Promise<PeerRecord[]> {
  const response = await pageFetch<PeerRecord[]>(client, {
    path: '/mesh/peers',
    timeoutMs,
  });
  return response.json ?? [];
}

async function clearAllPeers(
  client: RawBridgeClient,
  timeoutMs: number,
): Promise<PeerRecord[]> {
  const peers = await fetchPeerList(client, timeoutMs);
  for (const peer of peers) {
    await pageFetch(client, {
      path: `/mesh/peers/${encodeURIComponent(peer.id)}`,
      method: 'DELETE',
      timeoutMs,
    });
  }

  const cleared = await pollUntil(
    async () => await fetchPeerList(client, timeoutMs),
    (currentPeers) => currentPeers.length === 0,
    Math.min(timeoutMs, 10_000),
    250,
  );
  if (!cleared.ok) {
    throw new Error(`mesh peers did not clear within ${Math.min(timeoutMs, 10_000)}ms`);
  }
  return peers;
}

async function upsertPeer(
  client: RawBridgeClient,
  timeoutMs: number,
  payload: {
    id: string;
    base_url: string;
    enabled: boolean;
    capabilities: string[];
    auth_token?: string;
    inbound_secret?: string;
  },
): Promise<void> {
  const response = await pageFetch(client, {
    path: '/mesh/peers',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: payload,
    timeoutMs,
  });

  if (!response.ok) {
    throw new Error(`mesh peer upsert failed: status=${response.status} error=${response.error ?? 'unknown'}`);
  }
}

async function setPeerInterests(
  client: RawBridgeClient,
  timeoutMs: number,
  peerId: string,
): Promise<void> {
  const response = await pageFetch(client, {
    path: `/mesh/interests/${encodeURIComponent(peerId)}`,
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: { topics: ['*'] },
    timeoutMs,
  });

  if (!response.ok) {
    throw new Error(`mesh interest upsert failed: peer=${peerId} status=${response.status}`);
  }
}

async function seedMeshPair(
  clientA: RawBridgeClient,
  bridgeA: BridgeRuntimeContext,
  clientB: RawBridgeClient,
  bridgeB: BridgeRuntimeContext,
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<PairingSummary> {
  const responderInboundToken = crypto.randomUUID();
  const initiate = await pageFetch<{ session_id: string; pin: string }>(clientA, {
    path: '/mesh/pairing/initiate',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    timeoutMs,
  });

  if (!initiate.ok || !initiate.json?.session_id || !initiate.json?.pin) {
    throw new Error(`pairing initiate failed: status=${initiate.status} error=${initiate.error ?? 'unknown'}`);
  }

  const respond = await pageFetch<{ paired: boolean; initiator_inbound_token?: string }>(clientB, {
    url: `${bridgeA.rtBaseUrl}/mesh/pairing/respond`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: {
      session_id: initiate.json.session_id,
      pin: initiate.json.pin,
      responder_host_id: bridgeB.runtimeStatus.hostId,
      responder_base_url: bridgeB.rtBaseUrl,
      responder_inbound_token: responderInboundToken,
    },
    timeoutMs,
  });

  const initiatorInboundToken = respond.json?.initiator_inbound_token ?? null;
  if (!respond.ok || !respond.json?.paired || !initiatorInboundToken) {
    throw new Error(`pairing respond failed: status=${respond.status} error=${respond.error ?? 'unknown'}`);
  }

  const peerPayloadA = {
    id: String(bridgeB.runtimeStatus.hostId ?? ''),
    base_url: bridgeB.rtBaseUrl,
    enabled: true,
    capabilities: [],
    auth_token: responderInboundToken,
    inbound_secret: initiatorInboundToken,
  };
  const peerPayloadB = {
    id: String(bridgeA.runtimeStatus.hostId ?? ''),
    base_url: bridgeA.rtBaseUrl,
    enabled: true,
    capabilities: [],
    auth_token: initiatorInboundToken,
    inbound_secret: responderInboundToken,
  };

  await upsertPeer(clientA, timeoutMs, peerPayloadA);
  await upsertPeer(clientB, timeoutMs, peerPayloadB);
  await setPeerInterests(clientA, timeoutMs, peerPayloadA.id);
  await setPeerInterests(clientB, timeoutMs, peerPayloadB.id);

  const peerConvergence = await pollUntil(
    async () => {
      const [peersA, peersB] = await Promise.all([
        fetchPeerList(clientA, timeoutMs),
        fetchPeerList(clientB, timeoutMs),
      ]);
      return { peersA, peersB };
    },
    ({ peersA, peersB }) => {
      const peerA = peersA.find((peer) => peer.id === peerPayloadA.id);
      const peerB = peersB.find((peer) => peer.id === peerPayloadB.id);
      return peerA?.status === 'online' && peerB?.status === 'online';
    },
    timeoutMs,
    pollIntervalMs,
  );

  return {
    sessionId: initiate.json.session_id,
    pin: initiate.json.pin,
    responderInboundToken,
    initiatorInboundToken,
    peerConvergence,
  };
}

/**
 * Actively trigger backfill on B端 and wait for B端's EventLog count to
 * reach the expected seed count before the observation window starts.
 * This ensures the first polling tick in the observation loop already has data.
 */
async function triggerBackfillUntilConverged(
  clientB: RawBridgeClient,
  rtBaseUrlB: string,
  scopeKey: string,
  runId: string,
  expectedCount: number,
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<{ converged: boolean; observedCount: number; elapsedMs: number; error?: string }> {
  const startedMs = Date.now();
  const effectivePollIntervalMs = Math.max(250, Math.min(pollIntervalMs, 1_000));

  // Step 1: trigger backfill via B端's RtDomainBackfillCoordinator
  try {
    await clientB.executeJs<{ imported: number; peers: number }>(`(async () => {
      const { getRtDomainBackfillService } = await import('/src/lib/services/rt-domain-backfill.service.ts');
      const svc = getRtDomainBackfillService();
      const result = await svc.backfillConfirmedPeers();
      return { imported: result.eventlog.imported, peers: result.peers };
    })()`, Math.min(timeoutMs, 30_000));
    console.error(`[triggerBackfill] backfillConfirmedPeers triggered on B`);
  } catch (error) {
    console.error(`[triggerBackfill] trigger failed: ${error instanceof Error ? error.message : String(error)}`);
    // Continue polling anyway — backfill may still run via the 15s interval
  }

  // Step 2: poll B端's run-scoped eventlog snapshot until it reaches the seeded count.
  const deadline = startedMs + timeoutMs;
  let lastCount = 0;
  while (Date.now() < deadline) {
    try {
      const snapshot = await collectMarkerScopeSnapshotFromRuntime(
        rtBaseUrlB,
        scopeKey,
        runId,
        5_000,
      );
      lastCount = snapshot.eventlog.count;
      console.error(`[triggerBackfill] B run-scoped eventlog count=${lastCount} expected>=${expectedCount}`);
      if (lastCount >= expectedCount) {
        const elapsedMs = Date.now() - startedMs;
        console.error(`[triggerBackfill] converged in ${elapsedMs}ms`);
        return { converged: true, observedCount: lastCount, elapsedMs };
      }
    } catch (error) {
      console.error(`[triggerBackfill] poll error: ${error instanceof Error ? error.message : String(error)}`);
    }
    await sleep(effectivePollIntervalMs);
  }

  const elapsedMs = Date.now() - startedMs;
  return {
    converged: false,
    observedCount: lastCount,
    elapsedMs,
    error: `backfill did not converge within ${timeoutMs}ms`,
  };
}

function paddedOrdinal(value: number): string {
  return String(value).padStart(3, '0');
}

function buildEventMarker(runId: string, index: number): string {
  return `${runId}-EL-${paddedOrdinal(index + 1)}`;
}

function buildTaskMarker(runId: string, index: number): string {
  return `${runId}-T-${paddedOrdinal(index + 1)}`;
}

function buildTimeblockMarker(runId: string, index: number): string {
  return `${runId}-TB-${paddedOrdinal(index + 1)}`;
}

function buildProposalMarker(runId: string, index: number): string {
  return `${runId}-P-${paddedOrdinal(index + 1)}`;
}

function buildEventlogImportPayload(runId: string, count: number): {
  version: 1;
  exportedAt: string;
  events: Array<Record<string, unknown>>;
} {
  const now = Date.now();
  return {
    version: 1,
    exportedAt: new Date(now).toISOString(),
    events: Array.from({ length: count }, (_, index) => {
      const marker = buildEventMarker(runId, index);
      return {
        id: `event-${marker}`,
        timestamp: now - ((count - index) * 1_000),
        content: marker,
        tags: ['tmcp-fullsync', runId, 'eventlog'],
        metadata: {
          runId,
          marker,
          domain: 'eventlog',
          ordinal: index + 1,
        },
      };
    }),
  };
}

function buildTaskImportPayload(runId: string, count: number): {
  version: 1;
  tasks: Array<Record<string, unknown>>;
} {
  const baseTime = Date.now();
  return {
    version: 1,
    tasks: Array.from({ length: count }, (_, index) => {
      const marker = buildTaskMarker(runId, index);
      const previousMarker = index > 0 ? buildTaskMarker(runId, index - 1) : null;
      return {
        id: `task-${marker}`,
        title: marker,
        description: `bulk sync seed ${marker}`,
        done_condition: null,
        status: index % 4 === 0 ? 'in_progress' : 'pending',
        priority: index % 5 === 0 ? 'high' : 'medium',
        tags: ['tmcp-fullsync', runId, 'task'],
        source: null,
        parent_id: null,
        depends_on: previousMarker && index % 10 === 0
          ? [{ task_id: `task-${previousMarker}`, type: 'soft' }]
          : [],
        due_at: baseTime + ((index + 1) * 60_000),
        estimated_minutes: 15 + (index % 5) * 5,
        time_block_ids: [],
        created_at: baseTime + index,
        updated_at: baseTime + index + 10,
        completed_at: null,
      };
    }),
  };
}

function buildTimeblockImportPayload(runId: string, count: number): {
  version: 1;
  time_blocks: Array<Record<string, unknown>>;
  active_block: null;
} {
  const blockDurationMs = 25 * 60_000;
  const gapMs = 5 * 60_000;
  const endBase = Date.now() - (count * (blockDurationMs + gapMs));
  return {
    version: 1,
    time_blocks: Array.from({ length: count }, (_, index) => {
      const marker = buildTimeblockMarker(runId, index);
      const startTime = endBase + (index * (blockDurationMs + gapMs));
      const endTime = startTime + blockDurationMs;
      return {
        id: `timeblock-${marker}`,
        name: marker,
        startId: `timeblock-start-${marker}`,
        endId: `timeblock-end-${marker}`,
        note: `bulk sync seed ${marker}`,
        tags: ['tmcp-fullsync', runId, 'timeblock'],
        startTime,
        endTime,
        blockType: 'active',
        taskIds: [],
        taskStatusOutcomes: null,
        taskAssociationLog: [],
        sourcePlannedBlockId: null,
        transitions: [
          {
            type: 'start',
            at: startTime,
            actorId: null,
          },
          {
            type: 'end',
            at: endTime,
            actorId: null,
          },
        ],
      };
    }),
    active_block: null,
  };
}

function buildSampleIds(markers: string[], prefix: string): string[] {
  return markers.slice(0, 5).map((marker) => `${prefix}${marker}`);
}

async function seedEventlog(
  client: RawBridgeClient,
  scopeKey: string,
  runId: string,
  count: number,
  timeoutMs: number,
): Promise<DomainSeedSummary> {
  const response = await pageFetch<{ imported: number; skipped: number; total: number }>(client, {
    path: `/eventlog/import/json?strategy=merge&user_id=${encodeURIComponent(scopeKey)}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: buildEventlogImportPayload(runId, count),
    timeoutMs,
  });

  const markers = Array.from({ length: count }, (_, index) => buildEventMarker(runId, index));
  return {
    domain: 'eventlog',
    requested: count,
    imported: response.json?.imported ?? 0,
    skipped: response.json?.skipped ?? 0,
    total: response.json?.total ?? count,
    sampleIds: buildSampleIds(markers, 'event-'),
    sampleMarkers: markers.slice(0, 5),
    notes: response.ok ? [] : [`eventlog_import_status=${response.status}`, response.error ?? 'unknown_error'],
  };
}

async function seedTasks(
  client: RawBridgeClient,
  scopeKey: string,
  runId: string,
  count: number,
  timeoutMs: number,
): Promise<DomainSeedSummary> {
  const response = await pageFetch<{ imported: number; skipped: number; total: number }>(client, {
    path: `/tasks/import/json?strategy=merge&user_id=${encodeURIComponent(scopeKey)}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: buildTaskImportPayload(runId, count),
    timeoutMs,
  });

  const markers = Array.from({ length: count }, (_, index) => buildTaskMarker(runId, index));
  return {
    domain: 'task',
    requested: count,
    imported: response.json?.imported ?? 0,
    skipped: response.json?.skipped ?? 0,
    total: response.json?.total ?? count,
    sampleIds: buildSampleIds(markers, 'task-'),
    sampleMarkers: markers.slice(0, 5),
    notes: response.ok ? [] : [`task_import_status=${response.status}`, response.error ?? 'unknown_error'],
  };
}

async function seedTimeblocks(
  client: RawBridgeClient,
  scopeKey: string,
  runId: string,
  count: number,
  timeoutMs: number,
): Promise<DomainSeedSummary> {
  const response = await pageFetch<{ imported: number; skipped: number; total: number }>(client, {
    path: `/timeblocks/import/json?strategy=merge&user_id=${encodeURIComponent(scopeKey)}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: buildTimeblockImportPayload(runId, count),
    timeoutMs,
  });

  const markers = Array.from({ length: count }, (_, index) => buildTimeblockMarker(runId, index));
  return {
    domain: 'timeblock',
    requested: count,
    imported: response.json?.imported ?? 0,
    skipped: response.json?.skipped ?? 0,
    total: response.json?.total ?? count,
    sampleIds: buildSampleIds(markers, 'timeblock-'),
    sampleMarkers: markers.slice(0, 5),
    notes: response.ok ? [] : [`timeblock_import_status=${response.status}`, response.error ?? 'unknown_error'],
  };
}

async function runBatches<T>(
  items: T[],
  batchSize: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize);
    await Promise.all(batch.map((item, offset) => worker(item, index + offset)));
  }
}

async function seedProposals(
  client: RawBridgeClient,
  scopeKey: string,
  runId: string,
  count: number,
  timeoutMs: number,
): Promise<DomainSeedSummary> {
  const markers = Array.from({ length: count }, (_, index) => buildProposalMarker(runId, index));
  const createdIds: string[] = [];
  const notes: string[] = [];
  let created = 0;

  await runBatches(markers, 8, async (marker) => {
    const response = await pageFetch<{ id: string }>(client, {
      path: `/api/proposals?user_id=${encodeURIComponent(scopeKey)}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: {
        title: marker,
        body: `bulk sync seed ${marker}`,
        action_type: 'append_event',
        action_params: {
          content: marker,
          tags: ['tmcp-fullsync', runId, 'proposal'],
        },
        references: [],
        publisher: {
          publisher_type: 'human',
          id: 'tmcp-fullsync',
          name: 'TMCP Full Sync',
        },
      },
      timeoutMs,
    });

    if (response.ok && response.json?.id) {
      created += 1;
      createdIds.push(response.json.id);
      return;
    }

    notes.push(`proposal_create_failed=${marker}:status=${response.status}:error=${response.error ?? 'unknown'}`);
  });

  return {
    domain: 'proposal',
    requested: count,
    created,
    total: created,
    sampleIds: createdIds.slice(0, 5),
    sampleMarkers: markers.slice(0, 5),
    notes,
  };
}

async function fetchRuntimeJson<T>(
  url: string,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; json: T | null; error: string | null }> {
  const response = await fetchRuntimeResponse<T>(url, timeoutMs, { method: 'GET' });
  return {
    ok: response.ok,
    status: response.status,
    json: response.json,
    error: response.error,
  };
}

function includesRunTag(tags: unknown, runId: string): boolean {
  return Array.isArray(tags) && tags.includes(runId);
}

async function collectMarkerScopeSnapshotFromRuntime(
  rtBaseUrl: string,
  scopeKey: string,
  runId: string,
  timeoutMs: number,
): Promise<MarkerScopeSnapshot> {
  const scope = encodeURIComponent(scopeKey);
  const [eventlog, tasks, timeblocks, proposals, taskSummary] = await Promise.all([
    fetchRuntimeJson<Array<Record<string, unknown>>>(`${rtBaseUrl}/eventlog?user_id=${scope}&limit=5000`, timeoutMs),
    fetchRuntimeJson<Array<Record<string, unknown>>>(`${rtBaseUrl}/tasks?user_id=${scope}`, timeoutMs),
    fetchRuntimeJson<Array<Record<string, unknown>>>(`${rtBaseUrl}/timeblocks?user_id=${scope}`, timeoutMs),
    fetchRuntimeJson<Array<Record<string, unknown>>>(`${rtBaseUrl}/api/proposals?user_id=${scope}`, timeoutMs),
    fetchRuntimeJson<TaskReplicationSummary>(`${rtBaseUrl}/tasks/replication/summary?user_id=${scope}`, timeoutMs),
  ]);

  const eventItems = (eventlog.json ?? []).filter((item) => {
    const content = typeof item.content === 'string' ? item.content : '';
    const metadata = item.metadata as Record<string, unknown> | undefined;
    return content.startsWith(`${runId}-EL-`)
      || (typeof metadata?.runId === 'string' && metadata.runId === runId);
  });
  const taskItems = (tasks.json ?? []).filter((item) => {
    const title = typeof item.title === 'string' ? item.title : '';
    return title.startsWith(`${runId}-T-`) || includesRunTag(item.tags, runId);
  });
  const timeblockItems = (timeblocks.json ?? []).filter((item) => {
    const name = typeof item.name === 'string' ? item.name : '';
    return name.startsWith(`${runId}-TB-`) || includesRunTag(item.tags, runId);
  });
  const proposalItems = (proposals.json ?? []).filter((item) => {
    const title = typeof item.title === 'string' ? item.title : '';
    return title.startsWith(`${runId}-P-`);
  });

  return {
    eventlog: {
      count: eventItems.length,
      sampleIds: eventItems.map((item) => String(item.id ?? '')),
      sampleMarkers: eventItems.slice(0, 5).map((item) => String(item.content ?? '')),
    },
    task: {
      count: taskItems.length,
      sampleIds: taskItems.map((item) => String(item.id ?? '')),
      sampleMarkers: taskItems.slice(0, 5).map((item) => String(item.title ?? '')),
      replicationSummary: taskSummary.json,
    },
    timeblock: {
      count: timeblockItems.length,
      sampleIds: timeblockItems.map((item) => String(item.id ?? '')),
      sampleMarkers: timeblockItems.slice(0, 5).map((item) => String(item.name ?? '')),
    },
    proposal: {
      count: proposalItems.length,
      sampleIds: proposalItems.map((item) => String(item.id ?? '')),
      sampleMarkers: proposalItems.slice(0, 5).map((item) => String(item.title ?? '')),
    },
  };
}

function evaluateDomainObservation(
  seed: DomainSeedSummary,
  targetSnapshot: MarkerScopeSnapshot,
  latencyMs: number | null,
): DomainObservation {
  const snapshot = targetSnapshot[seed.domain];
  const missingSampleIds = seed.sampleIds.filter((id) => !snapshot.sampleIds.includes(id));
  const converged = snapshot.count >= seed.requested && missingSampleIds.length === 0;

  return {
    domain: seed.domain,
    converged,
    latencyMs,
    requiredCount: seed.requested,
    observedCount: snapshot.count,
    missingSampleIds,
    notes: [...seed.notes],
  };
}

function compactSnapshot(snapshot: MarkerScopeSnapshot): MarkerScopeSnapshot {
  return {
    eventlog: {
      ...snapshot.eventlog,
      sampleIds: snapshot.eventlog.sampleIds.slice(0, 12),
      sampleMarkers: snapshot.eventlog.sampleMarkers.slice(0, 5),
    },
    task: {
      ...snapshot.task,
      sampleIds: snapshot.task.sampleIds.slice(0, 12),
      sampleMarkers: snapshot.task.sampleMarkers.slice(0, 5),
    },
    timeblock: {
      ...snapshot.timeblock,
      sampleIds: snapshot.timeblock.sampleIds.slice(0, 12),
      sampleMarkers: snapshot.timeblock.sampleMarkers.slice(0, 5),
    },
    proposal: {
      ...snapshot.proposal,
      sampleIds: snapshot.proposal.sampleIds.slice(0, 12),
      sampleMarkers: snapshot.proposal.sampleMarkers.slice(0, 5),
    },
  };
}

async function runUiRouteCheck(
  client: RawBridgeClient,
  domain: DomainName,
  route: string,
  marker: string,
  timeoutMs: number,
): Promise<UiRouteCheck> {
  const expectedPath = normalizeRoutePath(route);
  const notes: string[] = [];
  let navigatedViaUi = false;
  try {
    navigatedViaUi = await navigateToRouteViaUi(client, route, timeoutMs);
  } catch (error) {
    notes.push(`ui_nav_failed=${error instanceof Error ? error.message : String(error)}`);
  }

  if (!navigatedViaUi) {
    try {
      await navigateToRoute(client, route, timeoutMs);
    } catch (error) {
      notes.push(error instanceof Error ? error.message : String(error));
    }
  }

  const poll = await pollUntil(
    async () => await client.executeJs<{ pathname: string; text: string }>(`(() => ({
      pathname: window.location.pathname,
      text: (document.body?.innerText ?? '').replace(/\\s+/g, ' ').trim()
    }))()`),
    (value) => (
      value.pathname === expectedPath
      && value.text.includes(marker)
    ),
    timeoutMs,
    500,
  );

  if (poll.lastError) {
    notes.push(`poll_error=${poll.lastError}`);
  }

  return {
    domain,
    route,
    passed: poll.ok,
    elapsedMs: poll.ok ? poll.elapsedMs : null,
    marker,
    snippet: poll.value?.text?.slice(0, 400) ?? null,
    notes,
  };
}

function buildMarkdownReport(summary: BulkSyncSummary): string {
  const lines: string[] = [];
  lines.push('# Tauri Full Domain Bulk Sync Report');
  lines.push('');
  lines.push(`- Started: \`${summary.startedAt}\``);
  lines.push(`- Finished: \`${summary.finishedAt}\``);
  lines.push(`- Run ID: \`${summary.runId}\``);
  lines.push(`- Profile slug: \`${summary.options.profileSlug}\``);
  lines.push(`- Overall: \`${summary.overallPassed ? 'PASS' : 'FAIL'}\``);
  lines.push('');
  lines.push('## Instances');
  lines.push('');
  lines.push(`- sync-a: \`${summary.instances.a.name}\`, web=\`${summary.instances.a.webPort || 'n/a'}\`, bridge=\`${summary.instances.a.bridgePort}\`, rt=\`${summary.bridge.a.rtBaseUrl}\`, hostId=\`${summary.bridge.a.runtimeStatus.hostId ?? 'n/a'}\``);
  lines.push(`- sync-b: \`${summary.instances.b.name}\`, web=\`${summary.instances.b.webPort || 'n/a'}\`, bridge=\`${summary.instances.b.bridgePort}\`, rt=\`${summary.bridge.b.rtBaseUrl}\`, hostId=\`${summary.bridge.b.runtimeStatus.hostId ?? 'n/a'}\``);
  lines.push('');
  lines.push('## Profile');
  lines.push('');
  lines.push(`- sync-a: action=\`${summary.profile.a.action}\`, scope=\`${summary.profile.a.scopeKey}\`, activeProfileId=\`${summary.profile.a.activeProfileId ?? 'n/a'}\``);
  lines.push(`- sync-b: action=\`${summary.profile.b.action}\`, scope=\`${summary.profile.b.scopeKey}\`, activeProfileId=\`${summary.profile.b.activeProfileId ?? 'n/a'}\``);
  lines.push('');
  lines.push('## Seeds');
  lines.push('');
  lines.push('| Domain | Requested | Imported/Created | Sample Markers | Notes |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const seed of summary.seeds) {
    const progress = seed.created ?? seed.imported ?? 0;
    lines.push(`| ${seed.domain} | ${seed.requested} | ${progress} | ${seed.sampleMarkers.join('<br>')} | ${(seed.notes.length > 0 ? seed.notes.join('<br>') : 'none')} |`);
  }
  lines.push('');
  lines.push('## Baseline');
  lines.push('');
  lines.push(`- sync-a: eventlog=\`${summary.baseline.a.eventlog.count}\`, timeblocks=\`${summary.baseline.a.timeblock.count}\`, tasks=\`${summary.baseline.a.task.count}\`, proposals=\`${summary.baseline.a.proposal.count}\``);
  lines.push(`- sync-b: eventlog=\`${summary.baseline.b.eventlog.count}\`, timeblocks=\`${summary.baseline.b.timeblock.count}\`, tasks=\`${summary.baseline.b.task.count}\`, proposals=\`${summary.baseline.b.proposal.count}\``);
  lines.push('');
  lines.push('## Pairing');
  lines.push('');
  lines.push(`- Session: \`${summary.pairing.sessionId}\``);
  lines.push(`- PIN: \`${summary.pairing.pin}\``);
  lines.push(`- Peer convergence: \`${summary.pairing.peerConvergence.ok ? 'PASS' : 'FAIL'}\` in \`${summary.pairing.peerConvergence.elapsedMs}ms\``);
  lines.push('');
  lines.push('## Backfill Trigger');
  lines.push('');
  const bt = summary.observation.backfillTrigger;
  lines.push(`- Converged: \`${bt.converged ? 'YES' : 'NO'}\``);
  lines.push(`- Observed count on B: \`${bt.observedCount}\``);
  lines.push(`- Elapsed: \`${bt.elapsedMs}ms\``);
  if (bt.error) lines.push(`- Error: \`${bt.error}\``);
  lines.push('');
  lines.push('## Domain Convergence');
  lines.push('');
  lines.push('| Domain | Converged | Latency | Observed Count | Required Count | Missing Sample IDs |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const state of Object.values(summary.observation.finalDomainStates)) {
    lines.push(`| ${state.domain} | ${state.converged ? 'PASS' : 'FAIL'} | ${state.latencyMs ?? 'n/a'}ms | ${state.observedCount} | ${state.requiredCount} | ${state.missingSampleIds.length > 0 ? state.missingSampleIds.join('<br>') : 'none'} |`);
  }
  lines.push('');
  lines.push('## UI Checks');
  lines.push('');
  lines.push('| Domain | Route | Passed | Marker | Latency |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const check of summary.uiChecks) {
    lines.push(`| ${check.domain} | ${check.route} | ${check.passed ? 'PASS' : 'FAIL'} | ${check.marker} | ${check.elapsedMs ?? 'n/a'}ms |`);
  }
  lines.push('');
  lines.push('## Final Snapshots');
  lines.push('');
  lines.push(`- sync-a: eventlog=\`${summary.finalSnapshots.a.eventlog.count}\`, timeblocks=\`${summary.finalSnapshots.a.timeblock.count}\`, tasks=\`${summary.finalSnapshots.a.task.count}\`, proposals=\`${summary.finalSnapshots.a.proposal.count}\``);
  lines.push(`- sync-b: eventlog=\`${summary.finalSnapshots.b.eventlog.count}\`, timeblocks=\`${summary.finalSnapshots.b.timeblock.count}\`, tasks=\`${summary.finalSnapshots.b.task.count}\`, proposals=\`${summary.finalSnapshots.b.proposal.count}\``);
  return `${lines.join('\n')}\n`;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  console.error('[tauri-full-domain-bulk-sync] resolving managed instances');
  const { instances } = await resolveManagedInstances(options);
  const bridgePortA = options.bridgePortA ?? instances.a.bridgePort;
  const bridgePortB = options.bridgePortB ?? instances.b.bridgePort;
  const effectiveInstances = {
    a: { ...instances.a, bridgePort: bridgePortA },
    b: { ...instances.b, bridgePort: bridgePortB },
  };

  const clientA = new RawBridgeClient(`ws://${options.host}:${bridgePortA}`);
  const clientB = new RawBridgeClient(`ws://${options.host}:${bridgePortB}`);

  try {
    console.error('[tauri-full-domain-bulk-sync] waiting for /agents routes');
    let [bridgeA, bridgeB] = await Promise.all([
      waitForPageReady(clientA, options.route, effectiveInstances.a),
      waitForPageReady(clientB, options.route, effectiveInstances.b),
    ]);
    await Promise.all([
      ensureAgentsPageReady(clientA, options.requestTimeoutMs),
      ensureAgentsPageReady(clientB, options.requestTimeoutMs),
    ]);

    console.error('[tauri-full-domain-bulk-sync] bootstrapping profile');
    const [profileA, profileB] = await Promise.all([
      bootstrapProfile(clientA, options.profileSlug, options.profilePassword, options.requestTimeoutMs),
      bootstrapProfile(clientB, options.profileSlug, options.profilePassword, options.requestTimeoutMs),
    ]);

    if (!profileA.scopeKey || !profileB.scopeKey || profileA.scopeKey !== profileB.scopeKey) {
      throw new Error(`profile scope mismatch: A=${profileA.scopeKey} B=${profileB.scopeKey}`);
    }

    if (profileA.action !== 'already_logged_in' || profileB.action !== 'already_logged_in') {
      console.error('[tauri-full-domain-bulk-sync] reloading pages after profile bootstrap');
      await Promise.all([
        clientA.executeJs(`(() => { window.location.reload(); return true; })()`),
        clientB.executeJs(`(() => { window.location.reload(); return true; })()`),
      ]);
      [bridgeA, bridgeB] = await Promise.all([
        waitForPageReady(clientA, options.route, effectiveInstances.a),
        waitForPageReady(clientB, options.route, effectiveInstances.b),
      ]);
    }

    await Promise.all([
      ensureAgentsPageReady(clientA, options.requestTimeoutMs),
      ensureAgentsPageReady(clientB, options.requestTimeoutMs),
    ]);
    await Promise.all([
      ensureSessionsView(clientA, options.requestTimeoutMs),
      ensureSessionsView(clientB, options.requestTimeoutMs),
    ]);

    console.error('[tauri-full-domain-bulk-sync] clearing existing mesh peers');
    await Promise.all([
      clearAllPeers(clientA, options.requestTimeoutMs),
      clearAllPeers(clientB, options.requestTimeoutMs),
    ]);

    console.error('[tauri-full-domain-bulk-sync] seeding sync-a');
    const seeds: DomainSeedSummary[] = [];
    seeds.push(await seedEventlog(clientA, profileA.scopeKey, options.runId, options.seedCount, options.requestTimeoutMs));
    seeds.push(await seedTimeblocks(clientA, profileA.scopeKey, options.runId, options.seedCount, options.requestTimeoutMs));
    seeds.push(await seedTasks(clientA, profileA.scopeKey, options.runId, options.seedCount, options.requestTimeoutMs));
    seeds.push(await seedProposals(clientA, profileA.scopeKey, options.runId, options.seedCount, options.requestTimeoutMs));

    console.error('[tauri-full-domain-bulk-sync] collecting seeded baseline');
    const baseline = {
      a: await collectMarkerScopeSnapshotFromRuntime(bridgeA.rtBaseUrl, profileA.scopeKey, options.runId, options.requestTimeoutMs),
      b: await collectMarkerScopeSnapshotFromRuntime(bridgeB.rtBaseUrl, profileB.scopeKey, options.runId, options.requestTimeoutMs),
    };

    console.error('[tauri-full-domain-bulk-sync] pairing peers');
    const pairing = await seedMeshPair(
      clientA,
      bridgeA,
      clientB,
      bridgeB,
      options.requestTimeoutMs,
      Math.min(options.pollIntervalMs, 1_000),
    );

    // Actively trigger backfill on B端 before starting the observation window.
    // This ensures the first polling tick already has seeded data, rather than
    // waiting for the 15s setInterval to fire naturally.
    console.error('[tauri-full-domain-bulk-sync] triggering backfill on sync-b and waiting for convergence');
    const backfillResult = await triggerBackfillUntilConverged(
      clientB,
      bridgeB.rtBaseUrl,
      profileB.scopeKey,
      options.runId,
      options.seedCount,
      Math.min(options.observationMs, 120_000), // max wait = observation window or 120s
      options.pollIntervalMs,
    );
    console.error(`[tauri-full-domain-bulk-sync] backfill trigger result: converged=${backfillResult.converged} count=${backfillResult.observedCount} elapsed=${backfillResult.elapsedMs}ms`);

    console.error('[tauri-full-domain-bulk-sync] observing convergence');
    const observationStartedAt = new Date().toISOString();
    const observationStartedMs = Date.now();
    const ticks: ObservationTick[] = [];
    const firstConvergenceTimes = new Map<DomainName, number>();
    let finishedEarly = false;
    let latestDomainStates: Record<DomainName, DomainObservation> = {
      eventlog: evaluateDomainObservation(seeds.find((seed) => seed.domain === 'eventlog')!, baseline.b, null),
      task: evaluateDomainObservation(seeds.find((seed) => seed.domain === 'task')!, baseline.b, null),
      timeblock: evaluateDomainObservation(seeds.find((seed) => seed.domain === 'timeblock')!, baseline.b, null),
      proposal: evaluateDomainObservation(seeds.find((seed) => seed.domain === 'proposal')!, baseline.b, null),
    };

    while ((Date.now() - observationStartedMs) <= options.observationMs) {
      const [sourceSnapshot, targetSnapshot, hostsB, peersA, peersB] = await Promise.all([
        collectMarkerScopeSnapshotFromRuntime(bridgeA.rtBaseUrl, profileA.scopeKey, options.runId, options.requestTimeoutMs),
        collectMarkerScopeSnapshotFromRuntime(bridgeB.rtBaseUrl, profileB.scopeKey, options.runId, options.requestTimeoutMs),
        collectRuntimeHosts(clientB, options.requestTimeoutMs),
        fetchPeerList(clientA, options.requestTimeoutMs),
        fetchPeerList(clientB, options.requestTimeoutMs),
      ]);

      const elapsedMs = Date.now() - observationStartedMs;
      latestDomainStates = seeds.reduce<Record<DomainName, DomainObservation>>((acc, seed) => {
        const existingLatency = firstConvergenceTimes.get(seed.domain) ?? null;
        const nextState = evaluateDomainObservation(seed, targetSnapshot, existingLatency);
        if (nextState.converged && !firstConvergenceTimes.has(seed.domain)) {
          firstConvergenceTimes.set(seed.domain, elapsedMs);
          nextState.latencyMs = elapsedMs;
          nextState.firstConvergedAt = new Date().toISOString();
        } else if (existingLatency !== null) {
          nextState.latencyMs = existingLatency;
        }
        acc[seed.domain] = nextState;
        return acc;
      }, {} as Record<DomainName, DomainObservation>);

      ticks.push({
        at: new Date().toISOString(),
        elapsedMs,
        sourceSnapshot: compactSnapshot(sourceSnapshot),
        targetSnapshot: compactSnapshot(targetSnapshot),
        hostsB,
        peersA,
        peersB,
        domainStates: latestDomainStates,
      });

      if (Object.values(latestDomainStates).every((state) => state.converged)) {
        finishedEarly = true;
        break;
      }

      await sleep(options.pollIntervalMs);
    }

    console.error('[tauri-full-domain-bulk-sync] collecting final snapshots');
    const finalSnapshots = {
      a: await collectMarkerScopeSnapshotFromRuntime(bridgeA.rtBaseUrl, profileA.scopeKey, options.runId, options.requestTimeoutMs),
      b: await collectMarkerScopeSnapshotFromRuntime(bridgeB.rtBaseUrl, profileB.scopeKey, options.runId, options.requestTimeoutMs),
    };

    console.error('[tauri-full-domain-bulk-sync] UI spot checks on sync-b');
    const latestEventlogMarker = finalSnapshots.b.eventlog.sampleMarkers[0]
      ?? seeds.find((seed) => seed.domain === 'eventlog')!.sampleMarkers.slice(-1)[0]
      ?? '';
    const latestTaskMarker = finalSnapshots.b.task.sampleMarkers[0]
      ?? seeds.find((seed) => seed.domain === 'task')!.sampleMarkers.slice(-1)[0]
      ?? '';
    const latestTimeblockMarker = finalSnapshots.b.timeblock.sampleMarkers[0]
      ?? seeds.find((seed) => seed.domain === 'timeblock')!.sampleMarkers.slice(-1)[0]
      ?? '';
    const latestTimeblockId = finalSnapshots.b.timeblock.sampleIds[0]
      ?? seeds.find((seed) => seed.domain === 'timeblock')!.sampleIds.slice(-1)[0]
      ?? '';
    const latestProposalMarker = finalSnapshots.b.proposal.sampleMarkers[0]
      ?? seeds.find((seed) => seed.domain === 'proposal')!.sampleMarkers.slice(-1)[0]
      ?? '';
    const uiCheckInputs: Array<{
      domain: DomainName;
      route: string;
      marker: string;
    }> = [
      {
        domain: 'eventlog',
        route: '/eventlog/record',
        marker: latestEventlogMarker,
      },
      {
        domain: 'task',
        route: '/tasks?main=1',
        marker: latestTaskMarker,
      },
      {
        domain: 'timeblock',
        route: `/eventlog/timeblocks/${encodeURIComponent(latestTimeblockId)}`,
        marker: latestTimeblockMarker,
      },
      {
        domain: 'proposal',
        route: '/proposals',
        marker: latestProposalMarker,
      },
    ];
    const uiChecks: UiRouteCheck[] = [];
    for (const input of uiCheckInputs) {
      uiChecks.push(await runUiRouteCheck(
        clientB,
        input.domain,
        input.route,
        input.marker,
        options.requestTimeoutMs,
      ));
    }

    const overallPassed = (
      pairing.peerConvergence.ok
      && Object.values(latestDomainStates).every((state) => state.converged)
      && uiChecks.every((check) => check.passed)
    );

    const summary: BulkSyncSummary = {
      startedAt,
      finishedAt: new Date().toISOString(),
      runId: options.runId,
      options,
      instances: effectiveInstances,
      bridge: { a: bridgeA, b: bridgeB },
      profile: { a: profileA, b: profileB },
      baseline,
      seeds,
      pairing,
      observation: {
        startedAt: observationStartedAt,
        backfillTrigger: backfillResult,
        ticks,
        finalDomainStates: latestDomainStates,
        finishedEarly,
      },
      uiChecks,
      finalSnapshots,
      overallPassed,
    };

    const reportDir = path.join(options.outDir, options.runId);
    await mkdir(reportDir, { recursive: true });
    const jsonReportPath = path.join(reportDir, 'summary.json');
    const markdownReportPath = path.join(reportDir, 'report.md');
    await writeFile(jsonReportPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    await writeFile(markdownReportPath, buildMarkdownReport(summary), 'utf8');

    console.log(JSON.stringify({
      reportDir,
      jsonReportPath,
      markdownReportPath,
      runId: options.runId,
      overallPassed,
      finalDomainStates: latestDomainStates,
      uiChecks,
    }, null, 2));

    if (!overallPassed) {
      process.exitCode = 1;
    }
  } finally {
    clientA.close();
    clientB.close();
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
} finally {
  await sleep(50);
  process.exit(process.exitCode ?? 0);
}
