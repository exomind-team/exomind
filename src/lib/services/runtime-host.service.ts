import { ExoMindEnvironment } from '@/lib/environment/environment';
import type { IStoragePort } from '@/lib/environment/interfaces/storage.port';
import type { RuntimeHostRecord, RuntimeHostStatus } from '@/lib/types/agent-hub';
import { createUuidV4 } from '@/lib/utils/uuid';

const RUNTIME_HOST_STORAGE_KEY = 'agent_runtime_hosts_v1';
const DEFAULT_PROBE_TIMEOUT_MS = 2500;

type RuntimeFetch = typeof fetch;

export interface AddRuntimeHostInput {
  name?: string;
  host: string;
  port: number;
  isLocal?: boolean;
}

export interface RuntimeHostService {
  listHosts(): Promise<RuntimeHostRecord[]>;
  addHost(input: AddRuntimeHostInput): Promise<RuntimeHostRecord>;
  removeHost(hostId: string): Promise<void>;
  probeHost(hostId: string): Promise<RuntimeHostRecord>;
  probeAllHosts(): Promise<RuntimeHostRecord[]>;
}

export interface RuntimeHostServiceOptions {
  storage?: IStoragePort;
  fetchImpl?: RuntimeFetch;
  now?: () => Date;
  timeoutMs?: number;
}

function toIso(now: () => Date): string {
  return now().toISOString();
}

function normalizeStatusByHttp(ok: boolean): RuntimeHostStatus {
  return ok ? 'online' : 'warning';
}

function ensurePort(port: number): number {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('port must be an integer between 1 and 65535');
  }
  return port;
}

function ensureHost(host: string): string {
  const value = host.trim();
  if (!value) {
    throw new Error('host is required');
  }
  return value;
}

export class RuntimeHostServiceImpl implements RuntimeHostService {
  private readonly storage: IStoragePort;
  private readonly fetchImpl: RuntimeFetch;
  private readonly now: () => Date;
  private readonly timeoutMs: number;

  constructor(options: RuntimeHostServiceOptions = {}) {
    this.storage = options.storage ?? ExoMindEnvironment.getInstance().storage;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.now = options.now ?? (() => new Date());
    this.timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  }

  async listHosts(): Promise<RuntimeHostRecord[]> {
    return this.readHosts();
  }

  async addHost(input: AddRuntimeHostInput): Promise<RuntimeHostRecord> {
    const host = ensureHost(input.host);
    const port = ensurePort(input.port);
    const nowIso = toIso(this.now);
    const nextRecord: RuntimeHostRecord = {
      id: `runtime-host-${createUuidV4()}`,
      name: input.name?.trim() || `${host}:${port}`,
      host,
      port,
      status: 'unknown',
      createdAt: nowIso,
      updatedAt: nowIso,
      isLocal: Boolean(input.isLocal),
    };

    const existing = await this.readHosts();
    const next = [...existing, nextRecord];
    await this.writeHosts(next);
    return nextRecord;
  }

  async removeHost(hostId: string): Promise<void> {
    const existing = await this.readHosts();
    const next = existing.filter((item) => item.id !== hostId);
    await this.writeHosts(next);
  }

  async probeHost(hostId: string): Promise<RuntimeHostRecord> {
    const hosts = await this.readHosts();
    const targetIndex = hosts.findIndex((item) => item.id === hostId);
    if (targetIndex < 0) {
      throw new Error(`runtime host not found: ${hostId}`);
    }

    const target = hosts[targetIndex];
    const { status, lastError } = await this.probeEndpoint(target.host, target.port);
    const checkedAt = toIso(this.now);
    const nextHost: RuntimeHostRecord = {
      ...target,
      status,
      lastCheckedAt: checkedAt,
      lastError,
      updatedAt: checkedAt,
    };

    const nextHosts = [...hosts];
    nextHosts[targetIndex] = nextHost;
    await this.writeHosts(nextHosts);
    return nextHost;
  }

  async probeAllHosts(): Promise<RuntimeHostRecord[]> {
    const hosts = await this.readHosts();
    const nextHosts: RuntimeHostRecord[] = [];

    for (const host of hosts) {
      const { status, lastError } = await this.probeEndpoint(host.host, host.port);
      const checkedAt = toIso(this.now);
      nextHosts.push({
        ...host,
        status,
        lastCheckedAt: checkedAt,
        lastError,
        updatedAt: checkedAt,
      });
    }

    await this.writeHosts(nextHosts);
    return nextHosts;
  }

  private async readHosts(): Promise<RuntimeHostRecord[]> {
    const payload = await this.storage.read<RuntimeHostRecord[]>(RUNTIME_HOST_STORAGE_KEY);
    if (!Array.isArray(payload)) return [];
    return payload;
  }

  private async writeHosts(hosts: RuntimeHostRecord[]): Promise<void> {
    await this.storage.write(RUNTIME_HOST_STORAGE_KEY, hosts);
  }

  private async probeEndpoint(host: string, port: number): Promise<{ status: RuntimeHostStatus; lastError?: string }> {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller
      ? setTimeout(() => {
          controller.abort();
        }, this.timeoutMs)
      : null;

    try {
      const response = await this.fetchImpl(`http://${host}:${port}/health`, {
        method: 'GET',
        signal: controller?.signal,
      });
      const status = normalizeStatusByHttp(response.ok);
      const lastError = response.ok ? undefined : `HTTP ${response.status}`;
      return { status, lastError };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        status: 'offline',
        lastError: message,
      };
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}

let runtimeHostServiceInstance: RuntimeHostService | null = null;

export function getRuntimeHostService(): RuntimeHostService {
  if (!runtimeHostServiceInstance) {
    runtimeHostServiceInstance = new RuntimeHostServiceImpl();
  }
  return runtimeHostServiceInstance;
}

export function resetRuntimeHostServiceForTests(): void {
  runtimeHostServiceInstance = null;
}
