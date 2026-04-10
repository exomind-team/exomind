#!/usr/bin/env bun

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ManagedTauriInstanceRecord } from './tauri-dev-manager-lib';
import { resolveManagedInstanceBridgePort } from './tauri-mcp-issue806-charter-lib';

type SyncSide = 'sync-a' | 'sync-b';
type DomainName = 'eventlog' | 'task' | 'timeblock' | 'proposal';
type FlowDirection = 'a_to_b' | 'b_to_a' | 'bi_directional';

type CliOptions = {
  host: string;
  bridgePortA?: number;
  bridgePortB?: number;
  instanceNameA?: string;
  instanceNameB?: string;
  profileId: string;
  timeoutMs: number;
  pollIntervalMs: number;
  outDir: string;
  route: string;
  iterations: number;
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

type ScopeSnapshot = {
  eventlogCount: number;
  latestEventId: string | null;
  taskCount: number;
  taskStatusCounts: Record<string, number>;
  completedTimeblockCount: number;
  activeTimeblock: {
    startId: string | null;
    name: string | null;
    phase: string | null;
    paused: boolean | null;
    feedbackStartedAt: number | null;
  } | null;
  proposalCount: number;
  proposalStatusCounts: Record<string, number>;
};

type VerificationStep = {
  name: string;
  source: SyncSide;
  target: SyncSide;
  writeStatus: number;
  localConfirmed: boolean;
  peerConfirmed: boolean;
  latencyMs: number | null;
  attempts: number;
  notes: string[];
  artifact: Record<string, unknown>;
};

type DomainResult = {
  round: number;
  domain: DomainName;
  flow: FlowDirection;
  scopeKey: string;
  passed: boolean;
  localConfirmed: boolean;
  peerConfirmed: boolean;
  latencyMs: number | null;
  steps: VerificationStep[];
  artifact: Record<string, unknown>;
  notes: string[];
};

type PeerConvergence = {
  ok: boolean;
  elapsedMs: number | null;
  attempts: number;
  peersA: PeerRecord[] | null;
  peersB: PeerRecord[] | null;
  notes: string[];
};

type PairingSummary = {
  sessionId: string;
  pin: string;
  responderInboundToken: string;
  initiatorInboundToken: string;
  peerConvergence: PeerConvergence;
};

type AggregateStepStats = {
  step: string;
  attempts: number;
  passCount: number;
  failCount: number;
  minLatencyMs: number | null;
  maxLatencyMs: number | null;
  avgLatencyMs: number | null;
};

type AggregateDomainStats = {
  domain: DomainName;
  runs: number;
  passCount: number;
  failCount: number;
  minLatencyMs: number | null;
  maxLatencyMs: number | null;
  avgLatencyMs: number | null;
  stepStats: AggregateStepStats[];
};

type SmokeSummary = {
  startedAt: string;
  finishedAt: string;
  profileId: string;
  options: CliOptions;
  instances: {
    a: ManagedInstanceDescriptor;
    b: ManagedInstanceDescriptor;
  };
  managerSnapshot: ManagedTauriInstanceRecord[];
  bridge: {
    a: BridgeRuntimeContext;
    b: BridgeRuntimeContext;
  };
  mesh: {
    aDiscovered: unknown;
    bDiscovered: unknown;
    pairing: PairingSummary;
  };
  baseline: {
    a: ScopeSnapshot;
    b: ScopeSnapshot;
  };
  finalSnapshots: {
    a: ScopeSnapshot;
    b: ScopeSnapshot;
  };
  results: DomainResult[];
  aggregates: AggregateDomainStats[];
  overallPassed: boolean;
};

const DEFAULT_OPTIONS: CliOptions = {
  host: '127.0.0.1',
  bridgePortA: undefined,
  bridgePortB: undefined,
  instanceNameA: undefined,
  instanceNameB: undefined,
  profileId: `tauri-sync-smoke-${Date.now()}`,
  timeoutMs: 20_000,
  pollIntervalMs: 350,
  outDir: path.join(process.cwd(), '.tmp', 'reports', 'tauri-sync-smoke'),
  route: '/eventlog',
  iterations: 1,
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
      case '--profile-id':
        if (next) {
          options.profileId = next;
          index += 1;
        }
        break;
      case '--timeout-ms':
        options.timeoutMs = parseInteger(next, options.timeoutMs);
        index += 1;
        break;
      case '--poll-interval-ms':
        options.pollIntervalMs = parseInteger(next, options.pollIntervalMs);
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
      case '--iterations':
        options.iterations = Math.max(1, parseInteger(next, options.iterations));
        index += 1;
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
      const record = JSON.parse(raw) as ManagedTauriInstanceRecord;
      records.push(record);
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

  if (selectedA && !selectedB) {
    const candidate = liveRecords.find((record) => record.name !== selectedA.name);
    if (!candidate) {
      throw new Error('could not resolve second managed tauri instance');
    }
    return {
      instances: {
        a: recordToInstanceDescriptor(selectedA, options.bridgePortA),
        b: recordToInstanceDescriptor(candidate, options.bridgePortB),
      },
      managerSnapshot: records,
    };
  }

  if (!selectedA && selectedB) {
    const candidate = liveRecords.find((record) => record.name !== selectedB.name);
    if (!candidate) {
      throw new Error('could not resolve first managed tauri instance');
    }
    return {
      instances: {
        a: recordToInstanceDescriptor(candidate, options.bridgePortA),
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

  const startedAt = Date.now();
  while ((Date.now() - startedAt) < 15_000) {
    const snapshot = await client.executeJs<BridgeRuntimeContext>(`(async () => {
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
    })()`);
    if (snapshot.pathname === route && snapshot.runtimeStatus?.running === true) {
      client.bindRuntimeContext(snapshot);
      return {
        ...snapshot,
        instance,
      };
    }
    await sleep(250);
  }

  throw new Error(`page not ready for route ${route}`);
}

async function collectMeshDiscovered(client: RawBridgeClient, timeoutMs: number): Promise<unknown> {
  const response = await pageFetch<unknown>(client, {
    path: '/mesh/discovered',
    timeoutMs,
  });
  return response.json;
}

function countBy<T>(items: T[], getKey: (item: T) => string): Record<string, number> {
  const output: Record<string, number> = {};
  for (const item of items) {
    const key = getKey(item);
    output[key] = (output[key] ?? 0) + 1;
  }
  return output;
}

async function collectScopeSnapshot(
  client: RawBridgeClient,
  scopeKey: string,
  timeoutMs: number,
): Promise<ScopeSnapshot> {
  const scope = encodeURIComponent(scopeKey);
  const [eventlog, tasks, timeblocks, activeBlock, proposals] = await Promise.all([
    pageFetch<Array<{ id: string }>>(client, {
      path: `/eventlog?user_id=${scope}&limit=500`,
      timeoutMs,
    }),
    pageFetch<Array<{ status: string }>>(client, {
      path: `/tasks?user_id=${scope}`,
      timeoutMs,
    }),
    pageFetch<Array<Record<string, unknown>>>(client, {
      path: `/timeblocks?user_id=${scope}`,
      timeoutMs,
    }),
    pageFetch<Record<string, unknown>>(client, {
      path: `/timeblocks/active?user_id=${scope}`,
      timeoutMs,
    }),
    pageFetch<Array<{ status: string }>>(client, {
      path: `/api/proposals?user_id=${scope}`,
      timeoutMs,
    }),
  ]);

  const eventItems = eventlog.json ?? [];
  const taskItems = tasks.json ?? [];
  const timeblockItems = timeblocks.json ?? [];
  const proposalItems = proposals.json ?? [];
  const active = activeBlock.ok && activeBlock.json
    ? {
        startId: typeof activeBlock.json.startId === 'string' ? activeBlock.json.startId : null,
        name: typeof activeBlock.json.name === 'string' ? activeBlock.json.name : null,
        phase: typeof activeBlock.json.phase === 'string' ? activeBlock.json.phase : null,
        paused: typeof activeBlock.json.paused === 'boolean' ? activeBlock.json.paused : null,
        feedbackStartedAt: typeof activeBlock.json.feedbackStartedAt === 'number'
          ? activeBlock.json.feedbackStartedAt
          : null,
      }
    : null;

  return {
    eventlogCount: eventItems.length,
    latestEventId: eventItems[0]?.id ?? null,
    taskCount: taskItems.length,
    taskStatusCounts: countBy(taskItems, (item) => item.status ?? 'unknown'),
    completedTimeblockCount: timeblockItems.length,
    activeTimeblock: active,
    proposalCount: proposalItems.length,
    proposalStatusCounts: countBy(proposalItems, (item) => item.status ?? 'unknown'),
  };
}

async function fetchRuntimeJson<T>(url: string, timeoutMs: number): Promise<{ ok: boolean; status: number; json: T | null }> {
  const response = await fetchRuntimeResponse<T>(url, timeoutMs, {
    method: 'GET',
  });
  return {
    ok: response.ok,
    status: response.status,
    json: response.json,
  };
}

async function collectScopeSnapshotFromRuntime(
  rtBaseUrl: string,
  scopeKey: string,
  timeoutMs: number,
): Promise<ScopeSnapshot> {
  const scope = encodeURIComponent(scopeKey);
  const [eventlog, tasks, timeblocks, activeBlock, proposals] = await Promise.all([
    fetchRuntimeJson<Array<{ id: string }>>(`${rtBaseUrl}/eventlog?user_id=${scope}&limit=500`, timeoutMs),
    fetchRuntimeJson<Array<{ status: string }>>(`${rtBaseUrl}/tasks?user_id=${scope}`, timeoutMs),
    fetchRuntimeJson<Array<Record<string, unknown>>>(`${rtBaseUrl}/timeblocks?user_id=${scope}`, timeoutMs),
    fetchRuntimeJson<Record<string, unknown>>(`${rtBaseUrl}/timeblocks/active?user_id=${scope}`, timeoutMs),
    fetchRuntimeJson<Array<{ status: string }>>(`${rtBaseUrl}/api/proposals?user_id=${scope}`, timeoutMs),
  ]);

  const eventItems = eventlog.json ?? [];
  const taskItems = tasks.json ?? [];
  const timeblockItems = timeblocks.json ?? [];
  const proposalItems = proposals.json ?? [];
  const active = activeBlock.ok && activeBlock.json
    ? {
        startId: typeof activeBlock.json.startId === 'string' ? activeBlock.json.startId : null,
        name: typeof activeBlock.json.name === 'string' ? activeBlock.json.name : null,
        phase: typeof activeBlock.json.phase === 'string' ? activeBlock.json.phase : null,
        paused: typeof activeBlock.json.paused === 'boolean' ? activeBlock.json.paused : null,
        feedbackStartedAt: typeof activeBlock.json.feedbackStartedAt === 'number'
          ? activeBlock.json.feedbackStartedAt
          : null,
      }
    : null;

  return {
    eventlogCount: eventItems.length,
    latestEventId: eventItems[0]?.id ?? null,
    taskCount: taskItems.length,
    taskStatusCounts: countBy(taskItems, (item) => item.status ?? 'unknown'),
    completedTimeblockCount: timeblockItems.length,
    activeTimeblock: active,
    proposalCount: proposalItems.length,
    proposalStatusCounts: countBy(proposalItems, (item) => item.status ?? 'unknown'),
  };
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

  const convergence = await pollUntil(
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

  const peerConvergence: PeerConvergence = {
    ok: convergence.ok,
    elapsedMs: convergence.ok ? convergence.elapsedMs : null,
    attempts: convergence.attempts,
    peersA: convergence.value?.peersA ?? null,
    peersB: convergence.value?.peersB ?? null,
    notes: [
      ...(convergence.lastError ? [`poll_error=${convergence.lastError}`] : []),
      ...(!convergence.ok ? ['mesh_peers_failed_to_reach_online_state'] : []),
    ],
  };

  if (!peerConvergence.ok) {
    throw new Error(`mesh peer convergence failed: ${JSON.stringify(peerConvergence, null, 2)}`);
  }

  return {
    sessionId: initiate.json.session_id,
    pin: initiate.json.pin,
    responderInboundToken,
    initiatorInboundToken,
    peerConvergence,
  };
}

function buildStep(
  name: string,
  source: SyncSide,
  target: SyncSide,
  writeStatus: number,
  localConfirmed: boolean,
  poll: PollResult<unknown>,
  artifact: Record<string, unknown>,
  notes: string[] = [],
): VerificationStep {
  return {
    name,
    source,
    target,
    writeStatus,
    localConfirmed,
    peerConfirmed: poll.ok,
    latencyMs: poll.ok ? poll.elapsedMs : null,
    attempts: poll.attempts,
    notes: [
      ...notes,
      ...(poll.lastError ? [`poll_error=${poll.lastError}`] : []),
    ],
    artifact,
  };
}

function combineDomainResult(
  round: number,
  domain: DomainName,
  flow: FlowDirection,
  scopeKey: string,
  steps: VerificationStep[],
  artifact: Record<string, unknown>,
  notes: string[] = [],
): DomainResult {
  const passed = steps.every((step) => step.localConfirmed && step.peerConfirmed);
  const latencies = steps
    .map((step) => step.latencyMs)
    .filter((value): value is number => typeof value === 'number');

  return {
    round,
    domain,
    flow,
    scopeKey,
    passed,
    localConfirmed: steps.every((step) => step.localConfirmed),
    peerConfirmed: steps.every((step) => step.peerConfirmed),
    latencyMs: latencies.length > 0 ? Math.max(...latencies) : null,
    steps,
    artifact,
    notes,
  };
}

async function runEventlogTest(
  round: number,
  source: RawBridgeClient,
  target: RawBridgeClient,
  scopeKey: string,
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<DomainResult> {
  const marker = `tauri-sync-event-${round}-${Date.now()}`;
  const pathPrefix = `/eventlog?user_id=${encodeURIComponent(scopeKey)}`;
  const write = await pageFetch<{ id: string; timestamp: number; content: string }>(source, {
    path: pathPrefix,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: {
      timestamp: Date.now(),
      content: marker,
      tags: ['tauri-sync-smoke', 'eventlog'],
      metadata: { marker, source: 'tauri-sync-smoke', round },
    },
    timeoutMs,
  });

  const eventId = write.json?.id ?? null;
  const localPoll = await pollUntil(
    async () => {
      if (!eventId) return null;
      const response = await pageFetch<{ id: string; content: string; metadata?: Record<string, unknown> }>(source, {
        path: `/eventlog/${encodeURIComponent(eventId)}?user_id=${encodeURIComponent(scopeKey)}`,
        timeoutMs,
      });
      return response.ok ? response.json : null;
    },
    (event) => event?.id === eventId && event?.content === marker,
    timeoutMs,
    pollIntervalMs,
  );
  const peerPoll = await pollUntil(
    async () => {
      if (!eventId) return null;
      const response = await pageFetch<{ id: string; content: string; metadata?: Record<string, unknown> }>(target, {
        path: `/eventlog/${encodeURIComponent(eventId)}?user_id=${encodeURIComponent(scopeKey)}`,
        timeoutMs,
      });
      return response.ok ? response.json : null;
    },
    (event) => event?.id === eventId && event?.content === marker,
    timeoutMs,
    pollIntervalMs,
  );

  const step = buildStep(
    'append-event',
    'sync-a',
    'sync-b',
    write.status,
    localPoll.ok,
    peerPoll,
    {
      marker,
      eventId,
      localSample: localPoll.value,
      peerSample: peerPoll.value,
    },
    write.error ? [`write_error=${write.error}`] : [],
  );

  return combineDomainResult(
    round,
    'eventlog',
    'a_to_b',
    scopeKey,
    [step],
    {
      marker,
      eventId,
    },
  );
}

async function runTaskTest(
  round: number,
  source: RawBridgeClient,
  target: RawBridgeClient,
  scopeKey: string,
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<DomainResult> {
  const marker = `tauri-sync-task-${round}-${Date.now()}`;
  const pathPrefix = `/tasks?user_id=${encodeURIComponent(scopeKey)}`;
  const create = await pageFetch<{ id: string; title: string; status: string }>(source, {
    path: pathPrefix,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: {
      title: marker,
      description: 'tauri sync smoke',
      priority: 'medium',
      tags: ['tauri-sync-smoke', 'task'],
    },
    timeoutMs,
  });

  const taskId = create.json?.id ?? null;
  const createLocalPoll = await pollUntil(
    async () => {
      if (!taskId) return null;
      const response = await pageFetch<{ id: string; title: string; status: string }>(source, {
        path: `/tasks/${encodeURIComponent(taskId)}?user_id=${encodeURIComponent(scopeKey)}`,
        timeoutMs,
      });
      return response.ok ? response.json : null;
    },
    (task) => task?.id === taskId && task?.title === marker,
    timeoutMs,
    pollIntervalMs,
  );
  const createPeerPoll = await pollUntil(
    async () => {
      if (!taskId) return null;
      const response = await pageFetch<{ id: string; title: string; status: string }>(target, {
        path: `/tasks/${encodeURIComponent(taskId)}?user_id=${encodeURIComponent(scopeKey)}`,
        timeoutMs,
      });
      return response.ok ? response.json : null;
    },
    (task) => task?.id === taskId && task?.title === marker,
    timeoutMs,
    pollIntervalMs,
  );

  const createStep = buildStep(
    'create-task',
    'sync-b',
    'sync-a',
    create.status,
    createLocalPoll.ok,
    createPeerPoll,
    {
      marker,
      taskId,
      localSample: createLocalPoll.value,
      peerSample: createPeerPoll.value,
    },
    create.error ? [`write_error=${create.error}`] : [],
  );

  const transition = await pageFetch<{ id: string; title: string; status: string }>(source, {
    path: `/tasks/${encodeURIComponent(String(taskId ?? ''))}/transition?user_id=${encodeURIComponent(scopeKey)}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: {
      status: 'in_progress',
    },
    timeoutMs,
  });

  const transitionLocalPoll = await pollUntil(
    async () => {
      if (!taskId) return null;
      const response = await pageFetch<{ id: string; title: string; status: string }>(source, {
        path: `/tasks/${encodeURIComponent(taskId)}?user_id=${encodeURIComponent(scopeKey)}`,
        timeoutMs,
      });
      return response.ok ? response.json : null;
    },
    (task) => task?.id === taskId && task?.status === 'in_progress',
    timeoutMs,
    pollIntervalMs,
  );
  const transitionPeerPoll = await pollUntil(
    async () => {
      if (!taskId) return null;
      const response = await pageFetch<{ id: string; title: string; status: string }>(target, {
        path: `/tasks/${encodeURIComponent(taskId)}?user_id=${encodeURIComponent(scopeKey)}`,
        timeoutMs,
      });
      return response.ok ? response.json : null;
    },
    (task) => task?.id === taskId && task?.status === 'in_progress',
    timeoutMs,
    pollIntervalMs,
  );

  const transitionStep = buildStep(
    'transition-task-in-progress',
    'sync-b',
    'sync-a',
    transition.status,
    transitionLocalPoll.ok,
    transitionPeerPoll,
    {
      taskId,
      localSample: transitionLocalPoll.value,
      peerSample: transitionPeerPoll.value,
    },
    transition.error ? [`transition_error=${transition.error}`] : [],
  );

  return combineDomainResult(
    round,
    'task',
    'b_to_a',
    scopeKey,
    [createStep, transitionStep],
    {
      marker,
      taskId,
    },
  );
}

async function runTimeblockTest(
  round: number,
  source: RawBridgeClient,
  target: RawBridgeClient,
  scopeKey: string,
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<DomainResult> {
  const marker = `tauri-sync-block-${round}-${Date.now()}`;
  const query = `?user_id=${encodeURIComponent(scopeKey)}`;
  const steps: VerificationStep[] = [];

  const start = await pageFetch<{ active?: { startId?: string; name?: string } }>(source, {
    path: `/timeblocks/start${query}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: {
      name: marker,
      mode: 'countup',
      taskIds: [],
    },
    timeoutMs,
  });
  const startId = start.json?.active?.startId ?? null;
  const startLocalPoll = await pollUntil(
    async () => {
      const response = await pageFetch<Record<string, unknown>>(source, {
        path: `/timeblocks/active${query}`,
        timeoutMs,
      });
      return response.ok ? response.json : null;
    },
    (active) => active?.startId === startId && active?.name === marker && active?.phase === 'running',
    timeoutMs,
    pollIntervalMs,
  );
  const startPeerPoll = await pollUntil(
    async () => {
      const response = await pageFetch<Record<string, unknown>>(target, {
        path: `/timeblocks/active${query}`,
        timeoutMs,
      });
      return response.ok ? response.json : null;
    },
    (active) => active?.startId === startId && active?.name === marker && active?.phase === 'running',
    timeoutMs,
    pollIntervalMs,
  );
  steps.push(buildStep(
    'start-timeblock',
    'sync-a',
    'sync-b',
    start.status,
    startLocalPoll.ok,
    startPeerPoll,
    {
      marker,
      startId,
      localSample: startLocalPoll.value,
      peerSample: startPeerPoll.value,
    },
    start.error ? [`start_error=${start.error}`] : [],
  ));

  const pause = await pageFetch(source, {
    path: `/timeblocks/pause${query}`,
    method: 'POST',
    timeoutMs,
  });
  const pauseLocalPoll = await pollUntil(
    async () => {
      const response = await pageFetch<Record<string, unknown>>(source, {
        path: `/timeblocks/active${query}`,
        timeoutMs,
      });
      return response.ok ? response.json : null;
    },
    (active) => active?.startId === startId && active?.paused === true && active?.phase === 'paused',
    timeoutMs,
    pollIntervalMs,
  );
  const pausePeerPoll = await pollUntil(
    async () => {
      const response = await pageFetch<Record<string, unknown>>(target, {
        path: `/timeblocks/active${query}`,
        timeoutMs,
      });
      return response.ok ? response.json : null;
    },
    (active) => active?.startId === startId && active?.paused === true && active?.phase === 'paused',
    timeoutMs,
    pollIntervalMs,
  );
  steps.push(buildStep(
    'pause-timeblock',
    'sync-a',
    'sync-b',
    pause.status,
    pauseLocalPoll.ok,
    pausePeerPoll,
    {
      startId,
      localSample: pauseLocalPoll.value,
      peerSample: pausePeerPoll.value,
    },
    pause.error ? [`pause_error=${pause.error}`] : [],
  ));

  const resume = await pageFetch(source, {
    path: `/timeblocks/resume${query}`,
    method: 'POST',
    timeoutMs,
  });
  const resumeLocalPoll = await pollUntil(
    async () => {
      const response = await pageFetch<Record<string, unknown>>(source, {
        path: `/timeblocks/active${query}`,
        timeoutMs,
      });
      return response.ok ? response.json : null;
    },
    (active) => active?.startId === startId && active?.paused === false && active?.phase === 'running',
    timeoutMs,
    pollIntervalMs,
  );
  const resumePeerPoll = await pollUntil(
    async () => {
      const response = await pageFetch<Record<string, unknown>>(target, {
        path: `/timeblocks/active${query}`,
        timeoutMs,
      });
      return response.ok ? response.json : null;
    },
    (active) => active?.startId === startId && active?.paused === false && active?.phase === 'running',
    timeoutMs,
    pollIntervalMs,
  );
  steps.push(buildStep(
    'resume-timeblock',
    'sync-a',
    'sync-b',
    resume.status,
    resumeLocalPoll.ok,
    resumePeerPoll,
    {
      startId,
      localSample: resumeLocalPoll.value,
      peerSample: resumePeerPoll.value,
    },
    resume.error ? [`resume_error=${resume.error}`] : [],
  ));

  const stop = await pageFetch(source, {
    path: `/timeblocks/stop${query}`,
    method: 'POST',
    timeoutMs,
  });
  const stopLocalPoll = await pollUntil(
    async () => {
      const response = await pageFetch<Record<string, unknown>>(source, {
        path: `/timeblocks/active${query}`,
        timeoutMs,
      });
      return response.ok ? response.json : null;
    },
    (active) => (
      active?.startId === startId
      && active?.phase === 'feedback_in_progress'
      && typeof active?.feedbackStartedAt === 'number'
    ),
    timeoutMs,
    pollIntervalMs,
  );
  const stopPeerPoll = await pollUntil(
    async () => {
      const response = await pageFetch<Record<string, unknown>>(target, {
        path: `/timeblocks/active${query}`,
        timeoutMs,
      });
      return response.ok ? response.json : null;
    },
    (active) => (
      active?.startId === startId
      && active?.phase === 'feedback_in_progress'
      && typeof active?.feedbackStartedAt === 'number'
    ),
    timeoutMs,
    pollIntervalMs,
  );
  steps.push(buildStep(
    'stop-timeblock',
    'sync-a',
    'sync-b',
    stop.status,
    stopLocalPoll.ok,
    stopPeerPoll,
    {
      startId,
      localSample: stopLocalPoll.value,
      peerSample: stopPeerPoll.value,
    },
    stop.error ? [`stop_error=${stop.error}`] : [],
  ));

  const end = await pageFetch(source, {
    path: `/timeblocks/end${query}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: {
      feedback: 'tauri sync smoke feedback',
    },
    timeoutMs,
  });
  const endLocalPoll = await pollUntil(
    async () => {
      const response = await pageFetch<Array<Record<string, unknown>>>(source, {
        path: `/timeblocks${query}`,
        timeoutMs,
      });
      return response.ok ? response.json ?? [] : [];
    },
    (blocks) => blocks.some((block) => block.startId === startId && block.name === marker),
    timeoutMs,
    pollIntervalMs,
  );
  const endPeerPoll = await pollUntil(
    async () => {
      const response = await pageFetch<Array<Record<string, unknown>>>(target, {
        path: `/timeblocks${query}`,
        timeoutMs,
      });
      return response.ok ? response.json ?? [] : [];
    },
    (blocks) => blocks.some((block) => block.startId === startId && block.name === marker),
    timeoutMs,
    pollIntervalMs,
  );
  steps.push(buildStep(
    'end-timeblock',
    'sync-a',
    'sync-b',
    end.status,
    endLocalPoll.ok,
    endPeerPoll,
    {
      startId,
      localSample: endLocalPoll.value,
      peerSample: endPeerPoll.value,
    },
    end.error ? [`end_error=${end.error}`] : [],
  ));

  return combineDomainResult(
    round,
    'timeblock',
    'a_to_b',
    scopeKey,
    steps,
    {
      marker,
      startId,
    },
  );
}

async function runProposalTest(
  round: number,
  source: RawBridgeClient,
  target: RawBridgeClient,
  scopeKey: string,
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<DomainResult> {
  const marker = `tauri-sync-proposal-${round}-${Date.now()}`;
  const pathPrefix = `/api/proposals?user_id=${encodeURIComponent(scopeKey)}`;
  const steps: VerificationStep[] = [];

  const create = await pageFetch<{ id: string; title: string; status: string }>(source, {
    path: pathPrefix,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: {
      title: marker,
      body: 'tauri sync smoke proposal',
      action_type: 'append_event',
      action_params: {
        content: marker,
        tags: ['tauri-sync-smoke', 'proposal'],
      },
      references: [],
      publisher: {
        publisher_type: 'human',
        id: 'tauri-sync-smoke',
        name: 'Tauri Sync Smoke',
      },
    },
    timeoutMs,
  });

  const proposalId = create.json?.id ?? null;
  const createLocalPoll = await pollUntil(
    async () => {
      if (proposalId === null) return null;
      const response = await pageFetch<Record<string, unknown>>(source, {
        path: `/api/proposals/${proposalId}?user_id=${encodeURIComponent(scopeKey)}`,
        timeoutMs,
      });
      return response.ok ? response.json : null;
    },
    (proposal) => proposal?.id === proposalId && proposal?.title === marker,
    timeoutMs,
    pollIntervalMs,
  );
  const createPeerPoll = await pollUntil(
    async () => {
      if (proposalId === null) return null;
      const response = await pageFetch<Record<string, unknown>>(target, {
        path: `/api/proposals/${proposalId}?user_id=${encodeURIComponent(scopeKey)}`,
        timeoutMs,
      });
      return response.ok ? response.json : null;
    },
    (proposal) => proposal?.id === proposalId && proposal?.title === marker,
    timeoutMs,
    pollIntervalMs,
  );

  steps.push(buildStep(
    'create-proposal',
    'sync-b',
    'sync-a',
    create.status,
    createLocalPoll.ok,
    createPeerPoll,
    {
      marker,
      proposalId,
      localSample: createLocalPoll.value,
      peerSample: createPeerPoll.value,
    },
    create.error ? [`create_error=${create.error}`] : [],
  ));

  const commentBody = `comment-${marker}`;
  const comment = await pageFetch<Record<string, unknown>>(target, {
    path: `/api/proposals/${proposalId}/comments?user_id=${encodeURIComponent(scopeKey)}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: {
      author: {
        publisher_type: 'human',
        id: 'tauri-sync-smoke-reviewer',
        name: 'Tauri Sync Smoke Reviewer',
      },
      content: commentBody,
    },
    timeoutMs,
  });

  const commentLocalPoll = await pollUntil(
    async () => {
      if (proposalId === null) return null;
      const response = await pageFetch<Record<string, unknown>>(target, {
        path: `/api/proposals/${proposalId}?user_id=${encodeURIComponent(scopeKey)}`,
        timeoutMs,
      });
      return response.ok ? response.json : null;
    },
    (proposal) => Array.isArray(proposal?.comments)
      && proposal.comments.some((entry: Record<string, unknown>) => entry?.content === commentBody),
    timeoutMs,
    pollIntervalMs,
  );
  const commentPeerPoll = await pollUntil(
    async () => {
      if (proposalId === null) return null;
      const response = await pageFetch<Record<string, unknown>>(source, {
        path: `/api/proposals/${proposalId}?user_id=${encodeURIComponent(scopeKey)}`,
        timeoutMs,
      });
      return response.ok ? response.json : null;
    },
    (proposal) => Array.isArray(proposal?.comments)
      && proposal.comments.some((entry: Record<string, unknown>) => entry?.content === commentBody),
    timeoutMs,
    pollIntervalMs,
  );

  steps.push(buildStep(
    'comment-proposal',
    'sync-a',
    'sync-b',
    comment.status,
    commentLocalPoll.ok,
    commentPeerPoll,
    {
      proposalId,
      commentBody,
      localSample: commentLocalPoll.value,
      peerSample: commentPeerPoll.value,
    },
    comment.error ? [`comment_error=${comment.error}`] : [],
  ));

  const statusUpdate = await pageFetch<Record<string, unknown>>(source, {
    path: `/api/proposals/${proposalId}?user_id=${encodeURIComponent(scopeKey)}`,
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: {
      status: 'in_review',
    },
    timeoutMs,
  });

  const statusLocalPoll = await pollUntil(
    async () => {
      if (proposalId === null) return null;
      const response = await pageFetch<Record<string, unknown>>(source, {
        path: `/api/proposals/${proposalId}?user_id=${encodeURIComponent(scopeKey)}`,
        timeoutMs,
      });
      return response.ok ? response.json : null;
    },
    (proposal) => proposal?.status === 'in_review',
    timeoutMs,
    pollIntervalMs,
  );
  const statusPeerPoll = await pollUntil(
    async () => {
      if (proposalId === null) return null;
      const response = await pageFetch<Record<string, unknown>>(target, {
        path: `/api/proposals/${proposalId}?user_id=${encodeURIComponent(scopeKey)}`,
        timeoutMs,
      });
      return response.ok ? response.json : null;
    },
    (proposal) => proposal?.status === 'in_review',
    timeoutMs,
    pollIntervalMs,
  );

  steps.push(buildStep(
    'transition-proposal-in-review',
    'sync-b',
    'sync-a',
    statusUpdate.status,
    statusLocalPoll.ok,
    statusPeerPoll,
    {
      proposalId,
      localSample: statusLocalPoll.value,
      peerSample: statusPeerPoll.value,
    },
    statusUpdate.error ? [`status_error=${statusUpdate.error}`] : [],
  ));

  return combineDomainResult(
    round,
    'proposal',
    'bi_directional',
    scopeKey,
    steps,
    {
      marker,
      proposalId,
      commentBody,
    },
  );
}

function aggregateLatencies(values: Array<number | null>): {
  minLatencyMs: number | null;
  maxLatencyMs: number | null;
  avgLatencyMs: number | null;
} {
  const filtered = values.filter((value): value is number => typeof value === 'number');
  if (filtered.length === 0) {
    return {
      minLatencyMs: null,
      maxLatencyMs: null,
      avgLatencyMs: null,
    };
  }

  const total = filtered.reduce((sum, value) => sum + value, 0);
  return {
    minLatencyMs: Math.min(...filtered),
    maxLatencyMs: Math.max(...filtered),
    avgLatencyMs: Math.round(total / filtered.length),
  };
}

function buildAggregateDomainStats(results: DomainResult[]): AggregateDomainStats[] {
  const byDomain = new Map<DomainName, DomainResult[]>();
  for (const result of results) {
    const bucket = byDomain.get(result.domain) ?? [];
    bucket.push(result);
    byDomain.set(result.domain, bucket);
  }

  return [...byDomain.entries()].map(([domain, domainResults]) => {
    const stepBuckets = new Map<string, VerificationStep[]>();
    for (const result of domainResults) {
      for (const step of result.steps) {
        const bucket = stepBuckets.get(step.name) ?? [];
        bucket.push(step);
        stepBuckets.set(step.name, bucket);
      }
    }

    const stepStats = [...stepBuckets.entries()].map(([step, stepResults]) => {
      const latencyStats = aggregateLatencies(stepResults.map((entry) => entry.latencyMs));
      return {
        step,
        attempts: stepResults.length,
        passCount: stepResults.filter((entry) => entry.localConfirmed && entry.peerConfirmed).length,
        failCount: stepResults.filter((entry) => !(entry.localConfirmed && entry.peerConfirmed)).length,
        ...latencyStats,
      };
    });

    return {
      domain,
      runs: domainResults.length,
      passCount: domainResults.filter((entry) => entry.passed).length,
      failCount: domainResults.filter((entry) => !entry.passed).length,
      ...aggregateLatencies(domainResults.map((entry) => entry.latencyMs)),
      stepStats,
    };
  }).sort((left, right) => left.domain.localeCompare(right.domain));
}

function formatCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts);
  if (entries.length === 0) {
    return 'none';
  }
  return entries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join(', ');
}

function buildMarkdownReport(summary: SmokeSummary): string {
  const lines: string[] = [];
  lines.push('# Tauri Sync Smoke Report');
  lines.push('');
  lines.push(`- Started: \`${summary.startedAt}\``);
  lines.push(`- Finished: \`${summary.finishedAt}\``);
  lines.push(`- Scope: \`${summary.profileId}\``);
  lines.push(`- Iterations: \`${summary.options.iterations}\``);
  lines.push(`- Overall: \`${summary.overallPassed ? 'PASS' : 'FAIL'}\``);
  lines.push('');
  lines.push('## Instances');
  lines.push('');
  lines.push(`- sync-a: \`${summary.instances.a.name}\`, web=\`${summary.instances.a.webPort || 'n/a'}\`, bridge=\`${summary.instances.a.bridgePort}\`, rt=\`${summary.bridge.a.rtBaseUrl}\``);
  lines.push(`- sync-b: \`${summary.instances.b.name}\`, web=\`${summary.instances.b.webPort || 'n/a'}\`, bridge=\`${summary.instances.b.bridgePort}\`, rt=\`${summary.bridge.b.rtBaseUrl}\``);
  lines.push('');
  lines.push('## Mesh');
  lines.push('');
  lines.push(`- Pairing session: \`${summary.mesh.pairing.sessionId}\``);
  lines.push(`- Peer convergence: \`${summary.mesh.pairing.peerConvergence.ok ? 'PASS' : 'FAIL'}\``);
  lines.push(`- Peer convergence latency: \`${summary.mesh.pairing.peerConvergence.elapsedMs ?? 'n/a'}ms\``);
  lines.push('');
  lines.push('## Baseline');
  lines.push('');
  lines.push(`- sync-a: eventlog=\`${summary.baseline.a.eventlogCount}\`, tasks=\`${summary.baseline.a.taskCount}\`, taskStatus=\`${formatCounts(summary.baseline.a.taskStatusCounts)}\`, completedBlocks=\`${summary.baseline.a.completedTimeblockCount}\`, proposals=\`${summary.baseline.a.proposalCount}\``);
  lines.push(`- sync-b: eventlog=\`${summary.baseline.b.eventlogCount}\`, tasks=\`${summary.baseline.b.taskCount}\`, taskStatus=\`${formatCounts(summary.baseline.b.taskStatusCounts)}\`, completedBlocks=\`${summary.baseline.b.completedTimeblockCount}\`, proposals=\`${summary.baseline.b.proposalCount}\``);
  lines.push('');
  lines.push('## Results');
  lines.push('');
  lines.push('| Round | Domain | Flow | Passed | Latency | Steps |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const result of summary.results) {
    lines.push(`| ${result.round} | ${result.domain} | ${result.flow} | ${result.passed ? 'PASS' : 'FAIL'} | ${result.latencyMs ?? 'n/a'}ms | ${result.steps.map((step) => `${step.name}:${step.peerConfirmed ? 'ok' : 'fail'}`).join('<br>')} |`);
  }
  lines.push('');
  lines.push('## Aggregates');
  lines.push('');
  lines.push('| Domain | Runs | Pass | Fail | Min | Max | Avg |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const aggregate of summary.aggregates) {
    lines.push(`| ${aggregate.domain} | ${aggregate.runs} | ${aggregate.passCount} | ${aggregate.failCount} | ${aggregate.minLatencyMs ?? 'n/a'}ms | ${aggregate.maxLatencyMs ?? 'n/a'}ms | ${aggregate.avgLatencyMs ?? 'n/a'}ms |`);
  }
  lines.push('');
  lines.push('## Final Snapshots');
  lines.push('');
  lines.push(`- sync-a: eventlog=\`${summary.finalSnapshots.a.eventlogCount}\`, tasks=\`${summary.finalSnapshots.a.taskCount}\`, taskStatus=\`${formatCounts(summary.finalSnapshots.a.taskStatusCounts)}\`, completedBlocks=\`${summary.finalSnapshots.a.completedTimeblockCount}\`, proposals=\`${summary.finalSnapshots.a.proposalCount}\``);
  lines.push(`- sync-b: eventlog=\`${summary.finalSnapshots.b.eventlogCount}\`, tasks=\`${summary.finalSnapshots.b.taskCount}\`, taskStatus=\`${formatCounts(summary.finalSnapshots.b.taskStatusCounts)}\`, completedBlocks=\`${summary.finalSnapshots.b.completedTimeblockCount}\`, proposals=\`${summary.finalSnapshots.b.proposalCount}\``);

  return `${lines.join('\n')}\n`;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  console.error('[tauri-sync-smoke] resolving managed instances');
  const { instances, managerSnapshot } = await resolveManagedInstances(options);
  const bridgePortA = options.bridgePortA ?? instances.a.bridgePort;
  const bridgePortB = options.bridgePortB ?? instances.b.bridgePort;
  const effectiveInstances = {
    a: {
      ...instances.a,
      bridgePort: bridgePortA,
    },
    b: {
      ...instances.b,
      bridgePort: bridgePortB,
    },
  };
  const clientA = new RawBridgeClient(`ws://${options.host}:${bridgePortA}`);
  const clientB = new RawBridgeClient(`ws://${options.host}:${bridgePortB}`);

  try {
    console.error('[tauri-sync-smoke] waiting for pages');
    const [bridgeA, bridgeB] = await Promise.all([
      waitForPageReady(clientA, options.route, instances.a),
      waitForPageReady(clientB, options.route, instances.b),
    ]);

    console.error('[tauri-sync-smoke] collecting discovered peers');
    const [meshA, meshB] = await Promise.all([
      collectMeshDiscovered(clientA, options.timeoutMs),
      collectMeshDiscovered(clientB, options.timeoutMs),
    ]);

    console.error('[tauri-sync-smoke] pairing peers');
    const pairing = await seedMeshPair(
      clientA,
      bridgeA,
      clientB,
      bridgeB,
      options.timeoutMs,
      options.pollIntervalMs,
    );

    console.error('[tauri-sync-smoke] collecting baseline snapshots');
    const baseline = {
      a: await collectScopeSnapshotFromRuntime(bridgeA.rtBaseUrl, options.profileId, options.timeoutMs),
      b: await collectScopeSnapshotFromRuntime(bridgeB.rtBaseUrl, options.profileId, options.timeoutMs),
    };

    const results: DomainResult[] = [];
    for (let round = 1; round <= options.iterations; round += 1) {
      console.error(`[tauri-sync-smoke] round ${round}: eventlog`);
      results.push(await runEventlogTest(
        round,
        clientA,
        clientB,
        options.profileId,
        options.timeoutMs,
        options.pollIntervalMs,
      ));
      console.error(`[tauri-sync-smoke] round ${round}: task`);
      results.push(await runTaskTest(
        round,
        clientB,
        clientA,
        options.profileId,
        options.timeoutMs,
        options.pollIntervalMs,
      ));
      console.error(`[tauri-sync-smoke] round ${round}: timeblock`);
      results.push(await runTimeblockTest(
        round,
        clientA,
        clientB,
        options.profileId,
        options.timeoutMs,
        options.pollIntervalMs,
      ));
      console.error(`[tauri-sync-smoke] round ${round}: proposal`);
      results.push(await runProposalTest(
        round,
        clientB,
        clientA,
        options.profileId,
        options.timeoutMs,
        options.pollIntervalMs,
      ));
    }

    console.error('[tauri-sync-smoke] collecting final snapshots');
    const finalSnapshots = {
      a: await collectScopeSnapshotFromRuntime(bridgeA.rtBaseUrl, options.profileId, options.timeoutMs),
      b: await collectScopeSnapshotFromRuntime(bridgeB.rtBaseUrl, options.profileId, options.timeoutMs),
    };
    const aggregates = buildAggregateDomainStats(results);
    const overallPassed = (
      pairing.peerConvergence.ok
      && results.every((result) => result.passed)
      && finalSnapshots.a.eventlogCount === finalSnapshots.b.eventlogCount
      && finalSnapshots.a.taskCount === finalSnapshots.b.taskCount
      && finalSnapshots.a.completedTimeblockCount === finalSnapshots.b.completedTimeblockCount
      && finalSnapshots.a.proposalCount === finalSnapshots.b.proposalCount
    );

    const summary: SmokeSummary = {
      startedAt,
      finishedAt: new Date().toISOString(),
      profileId: options.profileId,
      options: {
        ...options,
        bridgePortA,
        bridgePortB,
      },
      instances: effectiveInstances,
      managerSnapshot,
      bridge: { a: bridgeA, b: bridgeB },
      mesh: {
        aDiscovered: meshA,
        bDiscovered: meshB,
        pairing,
      },
      baseline,
      finalSnapshots,
      results,
      aggregates,
      overallPassed,
    };

    await mkdir(options.outDir, { recursive: true });
    const reportStem = `${new Date().toISOString().replace(/[:.]/g, '-')}-${options.profileId}`;
    const jsonReportPath = path.join(options.outDir, `${reportStem}.json`);
    const markdownReportPath = path.join(options.outDir, `${reportStem}.md`);
    await writeFile(jsonReportPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    await writeFile(markdownReportPath, buildMarkdownReport(summary), 'utf8');

    console.log(JSON.stringify({
      reportPath: jsonReportPath,
      markdownReportPath,
      profileId: options.profileId,
      instances: effectiveInstances,
      bridgeA: bridgeA.rtBaseUrl,
      bridgeB: bridgeB.rtBaseUrl,
      overallPassed,
      aggregates,
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
