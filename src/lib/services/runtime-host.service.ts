import type { IStoragePort } from '@/lib/environment/interfaces/storage.port';
import { resolveLocalServiceHost } from '@/config/local-service-host';
import {
  DEFAULT_EXTERNAL_RUNTIME_PORT,
  formatHostForUrl,
  getRuntimeExternalAddress,
  getRuntimeExternalAuthToken,
  parseRuntimeAddress,
} from '@/config/runtime-target';
import type {
  RuntimeHostAuthTokenSource,
  RuntimeHostRecord,
  RuntimeHostStatus,
  RuntimeHostTrustState,
  RuntimeHostVerificationStatus,
  RuntimeHostVerificationTrigger,
} from '@/lib/types/agent-hub';
import {
  normalizeRuntimeTopologyResponse,
  resolveTopologyHostId,
  type RuntimeTopologyResponse,
} from '@/lib/types/runtime-topology';
import { createUuidV4 } from '@/lib/utils/uuid';
import {
  getRuntimeConfigValueSync,
  removeRuntimeConfigValue,
  setRuntimeConfigValue,
} from '@/config/runtime-config-cache';

const RUNTIME_HOST_STORAGE_KEY = 'agent_runtime_hosts_v1';
const RUNTIME_HOST_STORAGE_CHANGED_EVENT = 'exomind:runtime-host-storage-changed';
const DEFAULT_PROBE_TIMEOUT_MS = 2500;

type RuntimeFetch = typeof fetch;
type RuntimeExternalAuthContext = {
  host: string;
  port: number;
  authToken: string;
};

export interface AddRuntimeHostInput {
  name?: string;
  host: string;
  port?: number;
  isLocal?: boolean;
  hostId?: string;
  deviceId?: string;
  lastTopology?: RuntimeTopologyResponse;
  trustState?: RuntimeHostTrustState;
  advertisedListenAddress?: string;
  lastSuccessfulDialAddress?: string;
  manualOverride?: string;
  authToken?: string;
  verificationStatus?: RuntimeHostVerificationStatus;
  lastVerifiedAt?: string;
  lastVerificationTrigger?: RuntimeHostVerificationTrigger;
  localInitiatedRttMs?: number;
  peerInitiatedRttMs?: number;
  lastVerificationError?: string;
}

export interface RuntimeHostMetadataPatch {
  name?: string;
  host?: string;
  port?: number;
  hostId?: string;
  deviceId?: string;
  lastTopology?: RuntimeTopologyResponse | null;
  trustState?: RuntimeHostTrustState;
  advertisedListenAddress?: string;
  lastSuccessfulDialAddress?: string;
  manualOverride?: string;
  authToken?: string;
  verificationStatus?: RuntimeHostVerificationStatus;
  lastVerifiedAt?: string | null;
  lastVerificationTrigger?: RuntimeHostVerificationTrigger | null;
  localInitiatedRttMs?: number | null;
  peerInitiatedRttMs?: number | null;
  lastVerificationError?: string | null;
}

export interface RuntimeHostService {
  listHosts(): Promise<RuntimeHostRecord[]>;
  addHost(input: AddRuntimeHostInput): Promise<RuntimeHostRecord>;
  mergeHostMetadata(hostId: string, patch: RuntimeHostMetadataPatch): Promise<RuntimeHostRecord>;
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

function ensurePort(port?: number): number {
  if (typeof port === 'undefined') {
    return DEFAULT_EXTERNAL_RUNTIME_PORT;
  }
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

function normalizeProbeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();
  if (lowerMessage.includes('aborterror') || lowerMessage.includes('aborted without reason') || lowerMessage.includes('signal is aborted')) {
    return 'probe timeout（探测超时）';
  }
  return message;
}

function normalizeTrustState(value: RuntimeHostTrustState | undefined): RuntimeHostTrustState {
  if (value === 'discovered_candidate' || value === 'confirmed_peer') {
    return value;
  }
  return 'manual_seed';
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeVerificationStatus(
  value: RuntimeHostVerificationStatus | undefined,
): RuntimeHostVerificationStatus | undefined {
  if (value === 'idle' || value === 'running' || value === 'verified' || value === 'failed') {
    return value;
  }
  return undefined;
}

function normalizeVerificationTrigger(
  value: RuntimeHostVerificationTrigger | undefined,
): RuntimeHostVerificationTrigger | undefined {
  if (value === 'pairing_auto' || value === 'manual_retry') {
    return value;
  }
  return undefined;
}

function normalizeOptionalNumber(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return value;
}

function normalizeOptionalTopology(
  value: RuntimeTopologyResponse | undefined,
): RuntimeTopologyResponse | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  return normalizeRuntimeTopologyResponse(value);
}

function hasPatchField<T extends object>(patch: T, field: keyof T): boolean {
  return Object.prototype.hasOwnProperty.call(patch, field);
}

function mergeOptionalTextPatch<T extends object>(
  patch: T,
  field: keyof T,
  current: string | undefined,
): string | undefined {
  if (!hasPatchField(patch, field)) {
    return current;
  }
  return normalizeOptionalText((patch[field] ?? undefined) as string | undefined);
}

function mergeOptionalNumberPatch<T extends object>(
  patch: T,
  field: keyof T,
  current: number | undefined,
): number | undefined {
  if (!hasPatchField(patch, field)) {
    return current;
  }
  return normalizeOptionalNumber((patch[field] ?? undefined) as number | undefined);
}

function mergeOptionalTopologyPatch(
  patch: RuntimeHostMetadataPatch,
  current: RuntimeTopologyResponse | undefined,
): RuntimeTopologyResponse | undefined {
  if (!hasPatchField(patch, 'lastTopology')) {
    return current;
  }
  return normalizeOptionalTopology(patch.lastTopology ?? undefined);
}

function mergeHostNamePatch(
  patch: RuntimeHostMetadataPatch,
  current: string,
): string {
  if (!hasPatchField(patch, 'name')) {
    return current;
  }
  return normalizeOptionalText(patch.name) ?? current;
}

function mergeHostAddressPatch(
  patch: RuntimeHostMetadataPatch,
  current: string,
): string {
  if (!hasPatchField(patch, 'host')) {
    return current;
  }
  return ensureHost(patch.host ?? '');
}

function mergeHostPortPatch(
  patch: RuntimeHostMetadataPatch,
  current: number,
): number {
  if (!hasPatchField(patch, 'port')) {
    return current;
  }
  return ensurePort(patch.port);
}

function mergeVerificationTriggerPatch(
  patch: RuntimeHostMetadataPatch,
  current: RuntimeHostVerificationTrigger | undefined,
): RuntimeHostVerificationTrigger | undefined {
  if (!hasPatchField(patch, 'lastVerificationTrigger')) {
    return current;
  }
  return normalizeVerificationTrigger(patch.lastVerificationTrigger ?? undefined);
}

function formatDialAddress(host: string, port: number): string {
  const normalizedHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  return `${normalizedHost}:${port}`;
}

function normalizeAuthTokenSource(
  value: RuntimeHostAuthTokenSource | undefined,
): RuntimeHostAuthTokenSource | undefined {
  if (value === 'manual_seed' || value === 'external_target') {
    return value;
  }
  return undefined;
}

function readRuntimeExternalAuthContext(): RuntimeExternalAuthContext | null {
  const authToken = normalizeOptionalText(getRuntimeExternalAuthToken());
  if (!authToken) {
    return null;
  }

  try {
    const parsed = parseRuntimeAddress(getRuntimeExternalAddress());
    return {
      host: resolveLocalServiceHost(parsed.host),
      port: parsed.port,
      authToken,
    };
  } catch {
    return null;
  }
}

function normalizeRuntimeHostAuth(
  record: Pick<RuntimeHostRecord, 'host' | 'port'> & {
    trustState: RuntimeHostTrustState;
    authToken?: string;
    authTokenSource?: RuntimeHostAuthTokenSource;
  },
  externalAuthContext: RuntimeExternalAuthContext | null,
): Pick<RuntimeHostRecord, 'authToken' | 'authTokenSource'> {
  const authToken = normalizeOptionalText(record.authToken);
  const authTokenSource = normalizeAuthTokenSource(record.authTokenSource);

  if (!authToken) {
    return {};
  }

  if (authTokenSource === 'manual_seed' || authTokenSource === 'external_target') {
    return {
      authToken,
      authTokenSource,
    };
  }

  if (record.trustState === 'manual_seed') {
    return {
      authToken,
      authTokenSource: 'manual_seed',
    };
  }

  if (
    externalAuthContext
    && authToken === externalAuthContext.authToken
    && resolveLocalServiceHost(record.host) === externalAuthContext.host
    && record.port === externalAuthContext.port
  ) {
    return {
      authToken,
      authTokenSource: 'external_target',
    };
  }

  return {};
}

function normalizeRuntimeHostRecord(
  record: RuntimeHostRecord,
  externalAuthContext: RuntimeExternalAuthContext | null = readRuntimeExternalAuthContext(),
): RuntimeHostRecord {
  const trustState = normalizeTrustState(record.trustState);
  const normalizedAuth = normalizeRuntimeHostAuth(
    {
      host: record.host,
      port: record.port,
      trustState,
      authToken: record.authToken,
      authTokenSource: record.authTokenSource,
    },
    externalAuthContext,
  );
  return {
    ...record,
    trustState,
    hostId: normalizeOptionalText(record.hostId),
    deviceId: normalizeOptionalText(record.deviceId),
    lastTopology: normalizeOptionalTopology(record.lastTopology),
    advertisedListenAddress: normalizeOptionalText(record.advertisedListenAddress),
    lastSuccessfulDialAddress: normalizeOptionalText(record.lastSuccessfulDialAddress),
    manualOverride: normalizeOptionalText(record.manualOverride)
      ?? (trustState === 'manual_seed' ? formatDialAddress(record.host, record.port) : undefined),
    authToken: normalizedAuth.authToken,
    authTokenSource: normalizedAuth.authTokenSource,
    verificationStatus: normalizeVerificationStatus(record.verificationStatus),
    lastVerifiedAt: normalizeOptionalText(record.lastVerifiedAt),
    lastVerificationTrigger: normalizeVerificationTrigger(record.lastVerificationTrigger),
    localInitiatedRttMs: normalizeOptionalNumber(record.localInitiatedRttMs),
    peerInitiatedRttMs: normalizeOptionalNumber(record.peerInitiatedRttMs),
    lastVerificationError: normalizeOptionalText(record.lastVerificationError),
  };
}

function createRuntimeConfigStoragePort(): IStoragePort {
  return {
    async write<T>(key: string, data: T): Promise<void> {
      setRuntimeConfigValue(key, JSON.stringify(data), {
        source: RUNTIME_HOST_STORAGE_CHANGED_EVENT,
        sourceOrigin: typeof window !== 'undefined' ? window.location?.origin : undefined,
      });
    },
    async read<T>(key: string): Promise<T | null> {
      try {
        const raw = getRuntimeConfigValueSync(key);
        return raw ? JSON.parse(raw) as T : null;
      } catch {
        return null;
      }
    },
    async delete(key: string): Promise<void> {
      removeRuntimeConfigValue(key);
    },
    async readAll<T>(): Promise<Map<string, T>> {
      return new Map();
    },
    async clear(): Promise<void> {
      removeRuntimeConfigValue(RUNTIME_HOST_STORAGE_KEY);
    },
    async query<T>(): Promise<{ items: T[]; total: number; hasMore: boolean }> {
      return {
        items: [],
        total: 0,
        hasMore: false,
      };
    },
  };
}

function shouldPromoteToConfirmedPeer(
  current: RuntimeHostRecord,
  next: RuntimeHostRecord,
  patch: RuntimeHostMetadataPatch,
): boolean {
  if (patch.trustState) {
    return false;
  }
  if (current.trustState === 'confirmed_peer') {
    return false;
  }
  if (current.trustState !== 'manual_seed') {
    return false;
  }
  if (!next.hostId || !next.lastSuccessfulDialAddress) {
    return false;
  }
  return Boolean(next.manualOverride);
}

function lockTopologyHostIdentity(
  topology: RuntimeTopologyResponse | undefined,
  lockedHostId: string,
): RuntimeTopologyResponse | undefined {
  if (!topology) {
    return undefined;
  }

  const normalized = normalizeRuntimeTopologyResponse(topology);
  return {
    ...normalized,
    host_id: lockedHostId,
    runtime_host: normalized.runtime_host
      ? {
          ...normalized.runtime_host,
          host_id: lockedHostId,
        }
      : normalized.runtime_host,
    device: normalized.device
      ? {
          ...normalized.device,
          primary_runtime_host_id: lockedHostId,
        }
      : normalized.device,
    device_components: normalized.device_components?.map((component) => (
      component.runtime_host_id || component.kind === 'runtime_host'
        ? {
            ...component,
            runtime_host_id: lockedHostId,
          }
        : component
    )) ?? [],
  };
}

function lockConfirmedPeerHostId(
  current: RuntimeHostRecord,
  next: RuntimeHostRecord,
  patch: RuntimeHostMetadataPatch,
): RuntimeHostRecord {
  if (current.trustState === 'confirmed_peer' && current.hostId) {
    const nextTopologyHostId = next.lastTopology ? resolveTopologyHostId(next.lastTopology) : undefined;
    const shouldLockHostId = Boolean(patch.hostId && patch.hostId !== current.hostId);
    const shouldLockTopology = Boolean(nextTopologyHostId && nextTopologyHostId !== current.hostId);

    if (shouldLockHostId || shouldLockTopology) {
      return {
        ...next,
        hostId: current.hostId,
        lastTopology: lockTopologyHostIdentity(next.lastTopology, current.hostId),
      };
    }
  }

  if (
    current.trustState === 'confirmed_peer'
    && current.hostId
    && patch.hostId
    && patch.hostId !== current.hostId
  ) {
    return {
      ...next,
      hostId: current.hostId,
    };
  }

  return next;
}

export class RuntimeHostServiceImpl implements RuntimeHostService {
  private readonly storage: IStoragePort;
  private readonly fetchImpl: RuntimeFetch;
  private readonly now: () => Date;
  private readonly timeoutMs: number;

  constructor(options: RuntimeHostServiceOptions = {}) {
    this.storage = options.storage ?? createRuntimeConfigStoragePort();
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
    const trustState = normalizeTrustState(input.trustState);
    const nextRecord: RuntimeHostRecord = {
      id: `runtime-host-${createUuidV4()}`,
      name: input.name?.trim() || `${host}:${port}`,
      host,
      port,
      status: 'unknown',
      createdAt: nowIso,
      updatedAt: nowIso,
      isLocal: Boolean(input.isLocal),
      hostId: normalizeOptionalText(input.hostId),
      deviceId: normalizeOptionalText(input.deviceId),
      lastTopology: normalizeOptionalTopology(input.lastTopology),
      trustState,
      advertisedListenAddress: normalizeOptionalText(input.advertisedListenAddress),
      lastSuccessfulDialAddress: normalizeOptionalText(input.lastSuccessfulDialAddress),
      manualOverride: normalizeOptionalText(input.manualOverride)
        ?? (trustState === 'manual_seed' ? formatDialAddress(host, port) : undefined),
      authToken: normalizeOptionalText(input.authToken),
      verificationStatus: normalizeVerificationStatus(input.verificationStatus),
      lastVerifiedAt: normalizeOptionalText(input.lastVerifiedAt),
      lastVerificationTrigger: normalizeVerificationTrigger(input.lastVerificationTrigger),
      localInitiatedRttMs: normalizeOptionalNumber(input.localInitiatedRttMs),
      peerInitiatedRttMs: normalizeOptionalNumber(input.peerInitiatedRttMs),
      lastVerificationError: normalizeOptionalText(input.lastVerificationError),
    };

    const externalAuthContext = readRuntimeExternalAuthContext();
    const existing = await this.readHosts();
    const nextHost = normalizeRuntimeHostRecord(nextRecord, externalAuthContext);
    const next = [...existing, nextHost];
    await this.writeHosts(next);
    return nextHost;
  }

  async mergeHostMetadata(hostId: string, patch: RuntimeHostMetadataPatch): Promise<RuntimeHostRecord> {
    const hosts = await this.readHosts();
    const targetIndex = hosts.findIndex((item) => item.id === hostId);
    if (targetIndex < 0) {
      throw new Error(`runtime host not found: ${hostId}`);
    }

    const current = hosts[targetIndex];
    const externalAuthContext = readRuntimeExternalAuthContext();
    const mergedBase = normalizeRuntimeHostRecord({
      ...current,
      name: mergeHostNamePatch(patch, current.name),
      host: mergeHostAddressPatch(patch, current.host),
      port: mergeHostPortPatch(patch, current.port),
      hostId: mergeOptionalTextPatch(patch, 'hostId', current.hostId),
      deviceId: mergeOptionalTextPatch(patch, 'deviceId', current.deviceId),
      lastTopology: mergeOptionalTopologyPatch(patch, current.lastTopology),
      trustState: patch.trustState ?? current.trustState,
      advertisedListenAddress: mergeOptionalTextPatch(
        patch,
        'advertisedListenAddress',
        current.advertisedListenAddress,
      ),
      lastSuccessfulDialAddress: mergeOptionalTextPatch(
        patch,
        'lastSuccessfulDialAddress',
        current.lastSuccessfulDialAddress,
      ),
      manualOverride: mergeOptionalTextPatch(patch, 'manualOverride', current.manualOverride),
      authToken: mergeOptionalTextPatch(patch, 'authToken', current.authToken),
      verificationStatus: patch.verificationStatus ?? current.verificationStatus,
      lastVerifiedAt: mergeOptionalTextPatch(patch, 'lastVerifiedAt', current.lastVerifiedAt),
      lastVerificationTrigger: mergeVerificationTriggerPatch(
        patch,
        current.lastVerificationTrigger,
      ),
      localInitiatedRttMs: mergeOptionalNumberPatch(
        patch,
        'localInitiatedRttMs',
        current.localInitiatedRttMs,
      ),
      peerInitiatedRttMs: mergeOptionalNumberPatch(
        patch,
        'peerInitiatedRttMs',
        current.peerInitiatedRttMs,
      ),
      lastVerificationError: mergeOptionalTextPatch(
        patch,
        'lastVerificationError',
        current.lastVerificationError,
      ),
      updatedAt: toIso(this.now),
    }, externalAuthContext);
    const lockedBase = lockConfirmedPeerHostId(current, mergedBase, patch);

    const nextHost = shouldPromoteToConfirmedPeer(current, lockedBase, patch)
      ? normalizeRuntimeHostRecord({
          ...lockedBase,
          trustState: 'confirmed_peer' as const,
        }, externalAuthContext)
      : lockedBase;

    const nextHosts = [...hosts];
    nextHosts[targetIndex] = nextHost;
    await this.writeHosts(nextHosts);
    return nextHost;
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
    const externalAuthContext = readRuntimeExternalAuthContext();
    const normalizedHosts = payload.map((record) => normalizeRuntimeHostRecord(record, externalAuthContext));
    if (JSON.stringify(payload) !== JSON.stringify(normalizedHosts)) {
      await this.storage.write(RUNTIME_HOST_STORAGE_KEY, normalizedHosts);
    }
    return normalizedHosts;
  }

  private async writeHosts(hosts: RuntimeHostRecord[]): Promise<void> {
    const externalAuthContext = readRuntimeExternalAuthContext();
    await this.storage.write(
      RUNTIME_HOST_STORAGE_KEY,
      hosts.map((record) => normalizeRuntimeHostRecord(record, externalAuthContext)),
    );
  }

  private async probeEndpoint(host: string, port: number): Promise<{ status: RuntimeHostStatus; lastError?: string }> {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller
      ? setTimeout(() => {
          controller.abort();
        }, this.timeoutMs)
      : null;

    try {
      const response = await this.fetchImpl(`http://${formatHostForUrl(host)}:${port}/health`, {
        method: 'GET',
        signal: controller?.signal,
      });
      const status = normalizeStatusByHttp(response.ok);
      const lastError = response.ok ? undefined : `HTTP ${response.status}`;
      return { status, lastError };
    } catch (error) {
      return {
        status: 'offline',
        lastError: normalizeProbeError(error),
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
