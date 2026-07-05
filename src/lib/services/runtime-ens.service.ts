type RuntimeFetch = typeof fetch;

export type EnsInterfaceTopology = 'off' | 'passive' | 'active';
export type EnsGatewayKind = 'reticulum';
export type EnsInterfaceMedium =
  | 'udp'
  | 'tcp'
  | 'mdns'
  | 'bluetooth'
  | 'file'
  | 'jsonl'
  | 'queue'
  | 'local_dev'
  | 'unknown';

export interface EnsPeerIdentity {
  identity_hex: string;
  host_id?: string;
  display_name?: string;
}

export interface EnsEndpointAdvertisement {
  identity_hex: string;
  host_id?: string;
  gateway: EnsGatewayKind;
  via_interface?: string;
  via_medium?: EnsInterfaceMedium;
  runtime_base_url?: string;
  reticulum_destination?: string;
  interface_address?: string;
  discovery_source: string;
  capabilities: string[];
}

export interface EnsInterfaceSnapshot {
  name: string;
  type: string;
  online: boolean;
  outgoing: boolean;
  interface_address?: string;
  topology: EnsInterfaceTopology;
  effective_topology: EnsInterfaceTopology;
}

export interface EnsTransportHealth {
  status: 'disabled' | 'healthy' | 'degraded' | 'error';
  message?: string;
}

export interface EnsOperationSnapshot {
  id: string;
  kind: 'pairing_offer' | 'pairing_response' | 'pairing_complete' | 'pairing_cancel';
  status: 'pending' | 'completed' | 'cancelled' | 'failed' | 'timed_out';
  peer_identity?: EnsPeerIdentity;
  session_id?: string;
  error?: string;
  updated_at: string;
}

export type EnsDeliveryStatus = 'sent' | 'failed' | 'skipped';

export interface EnsDeliverySnapshot {
  event_id: string;
  route_id: string;
  peer_identity_hex: string;
  status: EnsDeliveryStatus;
  reason?: string;
  started_at: string;
  finished_at: string;
}

export interface EnsPeerSnapshot {
  identity: EnsPeerIdentity;
  endpoint?: EnsEndpointAdvertisement;
  authorized: boolean;
  pairing_pending: boolean;
  last_error?: string;
}

export interface EnsPairingOfferTicket {
  operation_id: string;
  session_id: string;
  pin: string;
  status: 'pending' | 'completed' | 'cancelled' | 'failed' | 'timed_out';
}

export interface EnsTransportSnapshot {
  enabled: boolean;
  provider_id: string;
  local_identity?: EnsPeerIdentity;
  local_endpoint?: EnsEndpointAdvertisement;
  global_topology: EnsInterfaceTopology;
  health: EnsTransportHealth;
  peers: EnsPeerSnapshot[];
  interfaces: EnsInterfaceSnapshot[];
  operations: EnsOperationSnapshot[];
  deliveries: EnsDeliverySnapshot[];
  updated_at: string;
}

export interface RuntimeEnsServiceOptions {
  fetchImpl?: RuntimeFetch;
}

function authHeaders(authToken?: string, headers?: HeadersInit): Headers {
  const nextHeaders = new Headers(headers);
  const token = authToken?.trim();
  if (token) {
    nextHeaders.set('Authorization', `Bearer ${token}`);
  }
  return nextHeaders;
}

async function readErrorSnippet(response: Response): Promise<string> {
  try {
    const body = (await response.text()).trim();
    return body.replace(/\s+/g, ' ').slice(0, 240);
  } catch {
    return '';
  }
}

async function assertOk(operation: string, method: string, url: string, response: Response): Promise<void> {
  if (response.ok) {
    return;
  }

  const statusText = response.statusText ? ` ${response.statusText}` : '';
  const body = await readErrorSnippet(response);
  throw new Error(`${operation} failed: ${method} ${url} -> HTTP ${response.status}${statusText}${body ? `, body=${body}` : ''}`);
}

export class RuntimeEnsService {
  private readonly fetchImpl: RuntimeFetch;

  constructor(options: RuntimeEnsServiceOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  }

  async getSnapshot(runtimeBaseUrl: string, authToken?: string): Promise<EnsTransportSnapshot> {
    const url = `${runtimeBaseUrl}/mesh/ens/snapshot`;
    const response = await this.fetchImpl(url, {
      method: 'GET',
      headers: authHeaders(authToken, { Accept: 'application/json' }),
    });
    await assertOk('getEnsSnapshot', 'GET', url, response as Response);
    return (await response.json()) as EnsTransportSnapshot;
  }

  async setInterfaceTopology(
    runtimeBaseUrl: string,
    name: string,
    topology: EnsInterfaceTopology,
    authToken?: string,
  ): Promise<EnsInterfaceSnapshot> {
    const url = `${runtimeBaseUrl}/mesh/ens/interfaces/${encodeURIComponent(name)}/topology`;
    const response = await this.fetchImpl(url, {
      method: 'PUT',
      headers: authHeaders(authToken, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ topology }),
    });
    await assertOk('setEnsInterfaceTopology', 'PUT', url, response as Response);
    return (await response.json()) as EnsInterfaceSnapshot;
  }

  async setGlobalTopology(
    runtimeBaseUrl: string,
    topology: EnsInterfaceTopology,
    authToken?: string,
  ): Promise<EnsTransportSnapshot> {
    const url = `${runtimeBaseUrl}/mesh/ens/topology`;
    const response = await this.fetchImpl(url, {
      method: 'PUT',
      headers: authHeaders(authToken, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ topology }),
    });
    await assertOk('setGlobalEnsTopology', 'PUT', url, response as Response);
    return (await response.json()) as EnsTransportSnapshot;
  }

  async setGlobalInterfaceTopology(
    runtimeBaseUrl: string,
    topology: EnsInterfaceTopology,
    authToken?: string,
  ): Promise<EnsTransportSnapshot> {
    return this.setGlobalTopology(runtimeBaseUrl, topology, authToken);
  }

  async initiatePairingWithDiscoveredPeer(
    runtimeBaseUrl: string,
    identityHex: string,
    authToken?: string,
  ): Promise<EnsPairingOfferTicket> {
    const url = `${runtimeBaseUrl}/mesh/ens/pairing/discovered/${encodeURIComponent(identityHex)}`;
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: authHeaders(authToken, { 'Content-Type': 'application/json' }),
    });
    await assertOk('initiateEnsPairingWithDiscoveredPeer', 'POST', url, response as Response);
    return (await response.json()) as EnsPairingOfferTicket;
  }
}

let runtimeEnsServiceInstance: RuntimeEnsService | null = null;

export function getRuntimeEnsService(): RuntimeEnsService {
  if (!runtimeEnsServiceInstance) {
    runtimeEnsServiceInstance = new RuntimeEnsService();
  }
  return runtimeEnsServiceInstance;
}

export function resetRuntimeEnsServiceForTests(): void {
  runtimeEnsServiceInstance = null;
}
