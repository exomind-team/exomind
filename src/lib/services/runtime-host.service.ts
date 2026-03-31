import { ExoMindEnvironment } from '@/lib/environment/environment';
import type { IStoragePort } from '@/lib/environment/interfaces/storage.port';
import { DEFAULT_EXTERNAL_RUNTIME_PORT, formatHostForUrl } from '@/config/runtime-target';
import type {
  RuntimeHostRecord,
  RuntimeHostStatus,
  RuntimeHostTrustState,
  RuntimeHostVerificationStatus,
  RuntimeHostVerificationTrigger,
} from '@/lib/types/agent-hub';
import { createUuidV4 } from '@/lib/utils/uuid';

const RUNTIME_HOST_STORAGE_KEY = 'agent_runtime_hosts_v1';
const DEFAULT_PROBE_TIMEOUT_MS = 2500;

type RuntimeFetch = typeof fetch;

export interface AddRuntimeHostInput {
  name?: string;
  host: string;
  port?: number;
  isLocal?: boolean;
  hostId?: string;
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

function normalizeRuntimeHostRecord(record: RuntimeHostRecord): RuntimeHostRecord {
  const trustState = normalizeTrustState(record.trustState);
  return {
    ...record,
    trustState,
    hostId: normalizeOptionalText(record.hostId),
    advertisedListenAddress: normalizeOptionalText(record.advertisedListenAddress),
    lastSuccessfulDialAddress: normalizeOptionalText(record.lastSuccessfulDialAddress),
    manualOverride: normalizeOptionalText(record.manualOverride)
      ?? (trustState === 'manual_seed' ? formatDialAddress(record.host, record.port) : undefined),
    authToken: normalizeOptionalText(record.authToken),
    verificationStatus: normalizeVerificationStatus(record.verificationStatus),
    lastVerifiedAt: normalizeOptionalText(record.lastVerifiedAt),
    lastVerificationTrigger: normalizeVerificationTrigger(record.lastVerificationTrigger),
    localInitiatedRttMs: normalizeOptionalNumber(record.localInitiatedRttMs),
    peerInitiatedRttMs: normalizeOptionalNumber(record.peerInitiatedRttMs),
    lastVerificationError: normalizeOptionalText(record.lastVerificationError),
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

function lockConfirmedPeerHostId(
  current: RuntimeHostRecord,
  next: RuntimeHostRecord,
  patch: RuntimeHostMetadataPatch,
): RuntimeHostRecord {
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

    const existing = await this.readHosts();
    const next = [...existing, normalizeRuntimeHostRecord(nextRecord)];
    await this.writeHosts(next);
    return next[next.length - 1]!;
  }

  async mergeHostMetadata(hostId: string, patch: RuntimeHostMetadataPatch): Promise<RuntimeHostRecord> {
    const hosts = await this.readHosts();
    const targetIndex = hosts.findIndex((item) => item.id === hostId);
    if (targetIndex < 0) {
      throw new Error(`runtime host not found: ${hostId}`);
    }

    const current = hosts[targetIndex];
    const mergedBase = normalizeRuntimeHostRecord({
      ...current,
      name: mergeHostNamePatch(patch, current.name),
      host: mergeHostAddressPatch(patch, current.host),
      port: mergeHostPortPatch(patch, current.port),
      hostId: mergeOptionalTextPatch(patch, 'hostId', current.hostId),
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
    });
    const lockedBase = lockConfirmedPeerHostId(current, mergedBase, patch);

    const nextHost = shouldPromoteToConfirmedPeer(current, lockedBase, patch)
      ? {
          ...lockedBase,
          trustState: 'confirmed_peer' as const,
        }
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
    return payload.map((record) => normalizeRuntimeHostRecord(record));
  }

  private async writeHosts(hosts: RuntimeHostRecord[]): Promise<void> {
    await this.storage.write(
      RUNTIME_HOST_STORAGE_KEY,
      hosts.map((record) => normalizeRuntimeHostRecord(record)),
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
