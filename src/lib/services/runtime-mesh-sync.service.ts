import { getRuntimeControlService, type RuntimeReachableAddress } from '@/lib/services/runtime-control.service';
import type { RuntimeHostRecord, RuntimeServiceStatus } from '@/lib/types/agent-hub';
import { formatHostForUrl } from '@/config/runtime-target';

type RuntimeFetch = typeof fetch;

async function readResponseBodySnippet(response: Response): Promise<string | null> {
  try {
    const text = (await response.text()).trim();
    if (!text) {
      return null;
    }
    return text.replace(/\s+/g, ' ').slice(0, 240);
  } catch {
    return null;
  }
}

async function buildHttpError(
  operation: string,
  method: string,
  url: string,
  response: Response,
  options: {
    authState?: 'present' | 'missing';
  } = {},
): Promise<Error> {
  const statusText = response.statusText?.trim();
  const body = await readResponseBodySnippet(response);
  const details = [
    `HTTP ${response.status}${statusText ? ` ${statusText}` : ''}`,
    options.authState ? `auth=${options.authState}` : null,
    body ? `body=${body}` : null,
  ].filter(Boolean).join(', ');

  return new Error(`${operation} failed: ${method} ${url} -> ${details}`);
}

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
    return `http://${formatHostForUrl(host.host)}:${host.port}`;
  }
  return null;
}

function resolveLocalRuntimeBaseUrl(status: RuntimeServiceStatus): string {
  const host = status.host === '0.0.0.0' ? '127.0.0.1' : status.host;
  return `http://${formatHostForUrl(host)}:${status.port}`;
}

/** Build headers with optional Bearer auth token for local runtime calls. */
function authHeaders(contentType: string, authToken?: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': contentType };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  return headers;
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
      base_url: `http://${formatHostForUrl(reachableAddress.host)}:${reachableAddress.port}`,
      enabled: true,
      capabilities: [],
    });
  }

  // ── Pairing API ───────────────────────────────────────────────

  /** Initiate pairing session on the LOCAL runtime (requires admin auth). */
  async initiatePairing(
    runtimeBaseUrl: string,
    localAuthToken?: string,
  ): Promise<{ session_id: string; pin: string }> {
    const url = `${runtimeBaseUrl}/mesh/pairing/initiate`;
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: authHeaders('application/json', localAuthToken),
    });
    if (!response.ok) {
      throw await buildHttpError('initiatePairing', 'POST', url, response as Response, {
        authState: localAuthToken ? 'present' : 'missing',
      });
    }
    return (await response.json()) as { session_id: string; pin: string };
  }

  /** Respond to pairing session on the REMOTE runtime (public endpoint, no auth needed). */
  async respondToPairing(
    initiatorBaseUrl: string,
    sessionId: string,
    pin: string,
    responderHostId: string,
    responderBaseUrl: string,
    responderInboundToken?: string,
  ): Promise<{ paired: boolean; peer_token: string; initiator_inbound_token?: string }> {
    const url = `${initiatorBaseUrl}/mesh/pairing/respond`;
    const response = await this.fetchImpl(url, {
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
      throw await buildHttpError('respondToPairing', 'POST', url, response as Response);
    }
    return (await response.json()) as { paired: boolean; peer_token: string; initiator_inbound_token?: string };
  }

  /** Register a peer on the LOCAL runtime (requires admin auth). */
  async registerPeerLocally(
    localRuntimeBaseUrl: string,
    peerId: string,
    peerBaseUrl: string,
    authToken?: string,
    inboundSecret?: string,
    localAuthToken?: string,
  ): Promise<void> {
    await this.upsertPeer(localRuntimeBaseUrl, {
      id: peerId,
      base_url: peerBaseUrl,
      enabled: true,
      capabilities: [],
      auth_token: authToken,
      inbound_secret: inboundSecret,
    }, localAuthToken);
  }

  // ── Discovery API ──────────────────────────────────────────────

  /** List peers discovered via mDNS (calls local runtime, requires auth). */
  async listDiscoveredPeers(
    runtimeBaseUrl: string,
    localAuthToken?: string,
  ): Promise<Array<{ host_id: string; host: string; port: number }>> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (localAuthToken) {
      headers['Authorization'] = `Bearer ${localAuthToken}`;
    }
    const url = `${runtimeBaseUrl}/mesh/discovered`;
    const response = await this.fetchImpl(url, {
      method: 'GET',
      headers,
    });
    if (!response.ok) {
      throw await buildHttpError('listDiscoveredPeers', 'GET', url, response as Response, {
        authState: localAuthToken ? 'present' : 'missing',
      });
    }
    return (await response.json()) as Array<{ host_id: string; host: string; port: number }>;
  }

  // ── Peer Upsert ────────────────────────────────────────────────

  private async upsertPeer(
    runtimeBaseUrl: string,
    request: MeshPeerUpsertRequest,
    localAuthToken?: string,
  ): Promise<void> {
    const response = await this.fetchImpl(`${runtimeBaseUrl}/mesh/peers`, {
      method: 'POST',
      headers: authHeaders('application/json', localAuthToken),
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
