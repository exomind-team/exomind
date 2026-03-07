import { getRuntimeControlService, type RuntimeReachableAddress } from '@/lib/services/runtime-control.service';
import type { RuntimeHostRecord, RuntimeServiceStatus } from '@/lib/types/agent-hub';

type RuntimeFetch = typeof fetch;

interface MeshPeerUpsertRequest {
  id: string;
  base_url: string;
  enabled: boolean;
  capabilities: string[];
  auth_token?: string;
  inbound_secret?: string;
}

export interface RuntimeMeshSyncServiceOptions {
  fetchImpl?: RuntimeFetch;
  getLocalRuntimeStatus?: () => Promise<RuntimeServiceStatus>;
  getReachableAddress?: (remoteHost: RuntimeHostRecord) => Promise<RuntimeReachableAddress | null>;
}

function isConfirmedPeer(host: RuntimeHostRecord): boolean {
  return host.trustState === 'confirmed_peer' && typeof host.hostId === 'string' && host.hostId.length > 0;
}

function toBaseUrl(address: string): string {
  return `http://${address}`;
}

function resolveRemotePeerBaseUrl(host: RuntimeHostRecord): string | null {
  if (host.lastSuccessfulDialAddress) {
    return toBaseUrl(host.lastSuccessfulDialAddress);
  }
  if (host.manualOverride) {
    return toBaseUrl(host.manualOverride);
  }
  if (host.host && host.port) {
    return `http://${host.host}:${host.port}`;
  }
  return null;
}

function resolveLocalRuntimeBaseUrl(status: RuntimeServiceStatus): string {
  const host = status.host === '0.0.0.0' ? '127.0.0.1' : status.host;
  return `http://${host}:${status.port}`;
}

async function ensureOk(response: Response): Promise<void> {
  if (!response.ok) {
    throw new Error(`mesh peer upsert failed: HTTP ${response.status}`);
  }
}

export class RuntimeMeshSyncService {
  private readonly fetchImpl: RuntimeFetch;
  private readonly getLocalRuntimeStatus: () => Promise<RuntimeServiceStatus>;
  private readonly getReachableAddress: (remoteHost: RuntimeHostRecord) => Promise<RuntimeReachableAddress | null>;

  constructor(options: RuntimeMeshSyncServiceOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.getLocalRuntimeStatus = options.getLocalRuntimeStatus
      ?? (() => getRuntimeControlService().getStatus());
    this.getReachableAddress = options.getReachableAddress
      ?? ((remoteHost) => getRuntimeControlService().getReachableAddress(remoteHost.host, remoteHost.port));
  }

  async ensurePeerPair(host: RuntimeHostRecord): Promise<void> {
    if (!isConfirmedPeer(host)) {
      return;
    }

    const localStatus = await this.getLocalRuntimeStatus();
    if (!localStatus.running || !localStatus.port) {
      return;
    }

    const remoteBaseUrl = resolveRemotePeerBaseUrl(host);
    if (!remoteBaseUrl) {
      return;
    }

    await this.upsertPeer(resolveLocalRuntimeBaseUrl(localStatus), {
      id: host.hostId!,
      base_url: remoteBaseUrl,
      enabled: true,
      capabilities: [],
    });

    let reachableAddress: RuntimeReachableAddress | null = null;
    try {
      reachableAddress = await this.getReachableAddress(host);
    } catch {
      reachableAddress = null;
    }

    if (!reachableAddress?.host || !reachableAddress.port || !reachableAddress.hostId) {
      return;
    }

    await this.upsertPeer(remoteBaseUrl, {
      id: reachableAddress.hostId,
      base_url: `http://${reachableAddress.host}:${reachableAddress.port}`,
      enabled: true,
      capabilities: [],
    });
  }

  // ── Pairing API ───────────────────────────────────────────────

  /** Initiate pairing session, returns session_id and 6-digit PIN */
  async initiatePairing(runtimeBaseUrl: string): Promise<{ session_id: string; pin: string }> {
    const response = await this.fetchImpl(`${runtimeBaseUrl}/mesh/pairing/initiate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`initiatePairing failed: HTTP ${response.status}`);
    }
    return (await response.json()) as { session_id: string; pin: string };
  }

  /** Respond to pairing session with PIN and per-peer inbound token */
  async respondToPairing(
    initiatorBaseUrl: string,
    sessionId: string,
    pin: string,
    responderHostId: string,
    responderBaseUrl: string,
    responderInboundToken?: string,
  ): Promise<{ paired: boolean; peer_token: string; initiator_inbound_token?: string }> {
    const response = await this.fetchImpl(`${initiatorBaseUrl}/mesh/pairing/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        pin,
        responder_host_id: responderHostId,
        responder_base_url: responderBaseUrl,
        responder_inbound_token: responderInboundToken,
      }),
    });
    if (!response.ok) {
      throw new Error(`respondToPairing failed: HTTP ${response.status}`);
    }
    return (await response.json()) as { paired: boolean; peer_token: string; initiator_inbound_token?: string };
  }

  /** Register a peer on the local runtime (used by responder after pairing) */
  async registerPeerLocally(
    localRuntimeBaseUrl: string,
    peerId: string,
    peerBaseUrl: string,
    authToken?: string,
    inboundSecret?: string,
  ): Promise<void> {
    await this.upsertPeer(localRuntimeBaseUrl, {
      id: peerId,
      base_url: peerBaseUrl,
      enabled: true,
      capabilities: [],
      auth_token: authToken,
      inbound_secret: inboundSecret,
    });
  }

  // ── Discovery API ──────────────────────────────────────────────

  /** List peers discovered via mDNS */
  async listDiscoveredPeers(
    runtimeBaseUrl: string,
  ): Promise<Array<{ host_id: string; host: string; port: number }>> {
    const response = await this.fetchImpl(`${runtimeBaseUrl}/mesh/discovered`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`listDiscoveredPeers failed: HTTP ${response.status}`);
    }
    return (await response.json()) as Array<{ host_id: string; host: string; port: number }>;
  }

  // ── Peer Upsert ────────────────────────────────────────────────

  private async upsertPeer(runtimeBaseUrl: string, request: MeshPeerUpsertRequest): Promise<void> {
    const response = await this.fetchImpl(`${runtimeBaseUrl}/mesh/peers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    await ensureOk(response as Response);
  }
}

let runtimeMeshSyncServiceInstance: RuntimeMeshSyncService | null = null;

export function getRuntimeMeshSyncService(): RuntimeMeshSyncService {
  if (!runtimeMeshSyncServiceInstance) {
    runtimeMeshSyncServiceInstance = new RuntimeMeshSyncService();
  }
  return runtimeMeshSyncServiceInstance;
}

export function resetRuntimeMeshSyncServiceForTests(): void {
  runtimeMeshSyncServiceInstance = null;
}
