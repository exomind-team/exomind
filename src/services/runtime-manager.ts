import type { AgentEnergySnapshot, RuntimeHostRecord } from '@/lib/types/agent-hub';
import {
  normalizeRuntimeTopologyResponse,
  resolveTopologyDevice,
  resolveTopologyHostId,
  type RuntimeTopologyDeviceComponent,
  type RuntimeTopologyDeviceKind,
  type RuntimeTopologyDeviceLink,
  type RuntimeTopologyResponse,
} from '@/lib/types/runtime-topology';
import { DEFAULT_EXTERNAL_RUNTIME_PORT } from '@/config/runtime-target';
import { getSyncAutomationEnabled } from '@/config/sync-automation-enabled';
import {
  type AddRuntimeHostInput,
  type RuntimeHostMetadataPatch,
  type RuntimeHostService,
  getRuntimeHostService,
} from '@/lib/services/runtime-host.service';
import { getRuntimeMeshSyncService, type RuntimeMeshSyncService } from '@/lib/services/runtime-mesh-sync.service';
import {
  isMeshOnlyConfirmedPeer,
  resolveRuntimeHostDialAddress,
} from '@/lib/utils/runtime-host-address';
import { RuntimeClient, type RuntimeAgentSummary } from './runtime-client';

export type RuntimeHostConnectionState = 'online' | 'error' | 'offline';

export interface RuntimeAggregatedAgent extends RuntimeAgentSummary {
  sourceHostId: string;
  sourceHostName: string;
  sourceHostAddress: string;
  energy?: AgentEnergySnapshot;
}

export interface RuntimeHostSnapshot {
  host: RuntimeHostRecord;
  connectionState: RuntimeHostConnectionState;
  agents: RuntimeAggregatedAgent[];
  topology: RuntimeTopologyResponse | null;
  latencyMs?: number;
  error?: string;
}

export interface RuntimeDeviceSnapshot {
  id: string;
  name: string;
  kind: RuntimeTopologyDeviceKind;
  primaryRuntimeHostId?: string;
  connectionState: RuntimeHostConnectionState;
  hosts: RuntimeHostSnapshot[];
  components: RuntimeTopologyDeviceComponent[];
  links: RuntimeTopologyDeviceLink[];
}

export interface RuntimeManagerSnapshot {
  updatedAt: string;
  hosts: RuntimeHostSnapshot[];
  devices: RuntimeDeviceSnapshot[];
  agents: RuntimeAggregatedAgent[];
}

export interface RuntimeManagerOptions {
  hostService?: Pick<RuntimeHostService, 'listHosts' | 'addHost' | 'removeHost'>
    & Partial<Pick<RuntimeHostService, 'mergeHostMetadata'>>;
  runtimeClient?: Pick<RuntimeClient, 'getAgents' | 'getTopology'>
    & Partial<Pick<RuntimeClient, 'getAllEnergy'>>;
  runtimeMeshSyncService?: Pick<RuntimeMeshSyncService, 'ensurePeerPair'>;
  now?: () => Date;
}

export function shouldAutoPollRuntimeHost(host: RuntimeHostRecord): boolean {
  return !(host.trustState === 'discovered_candidate' && !host.authToken)
    && !isMeshOnlyConfirmedPeer(host);
}

export function findPreferredRuntimeHostForAgent(
  snapshots: RuntimeHostSnapshot[],
  agentId: string,
  preferredHostId?: string,
): RuntimeHostRecord | null {
  const exactHost = preferredHostId
    ? snapshots.find((snapshot) => (
      snapshot.host.id === preferredHostId
      && snapshot.agents.some((agent) => agent.id === agentId)
    ))
    : undefined;

  if (exactHost) {
    return exactHost.host;
  }

  const onlineHost = snapshots.find((snapshot) => (
    snapshot.connectionState === 'online'
    && snapshot.agents.some((agent) => agent.id === agentId)
  ));
  if (onlineHost) {
    return onlineHost.host;
  }

  const fallbackHost = snapshots.find((snapshot) => snapshot.agents.some((agent) => agent.id === agentId));
  return fallbackHost?.host ?? null;
}

function mapErrorToConnectionState(errorCode: 'timeout' | 'network' | 'http' | 'invalid_payload'): RuntimeHostConnectionState {
  if (errorCode === 'network') return 'offline';
  return 'error';
}

function toIso(now: () => Date): string {
  return now().toISOString();
}

function mergeConnectionState(
  current: RuntimeHostConnectionState,
  next: RuntimeHostConnectionState,
): RuntimeHostConnectionState {
  if (current === 'online' || next === 'online') {
    return 'online';
  }
  if (current === 'error' || next === 'error') {
    return 'error';
  }
  return 'offline';
}

function pushUniqueComponent(
  target: RuntimeTopologyDeviceComponent[],
  component: RuntimeTopologyDeviceComponent,
): void {
  if (!target.some((item) => item.id === component.id)) {
    target.push(component);
  }
}

function pushUniqueLink(
  target: RuntimeTopologyDeviceLink[],
  link: RuntimeTopologyDeviceLink,
): void {
  if (!target.some((item) => item.id === link.id)) {
    target.push(link);
  }
}

function buildRuntimeDeviceSnapshots(hosts: RuntimeHostSnapshot[]): RuntimeDeviceSnapshot[] {
  const devicesById = new Map<string, RuntimeDeviceSnapshot>();

  hosts.forEach((snapshot) => {
    const topologyDevice = resolveTopologyDevice(snapshot.topology);
    const deviceId = topologyDevice?.id ?? snapshot.host.deviceId ?? snapshot.host.hostId ?? snapshot.host.id;
    const deviceName = topologyDevice?.name ?? snapshot.host.name;
    const deviceKind = topologyDevice?.kind ?? 'unknown';
    const primaryRuntimeHostId = topologyDevice?.primary_runtime_host_id
      ?? resolveTopologyHostId(snapshot.topology)
      ?? snapshot.host.hostId;

    const existing = devicesById.get(deviceId);
    if (existing) {
      existing.hosts.push(snapshot);
      existing.connectionState = mergeConnectionState(existing.connectionState, snapshot.connectionState);
      existing.primaryRuntimeHostId = existing.primaryRuntimeHostId ?? primaryRuntimeHostId;
      const nextName = topologyDevice?.name?.trim();
      if (nextName) {
        existing.name = nextName;
      }
      existing.kind = topologyDevice?.kind ?? existing.kind;
      snapshot.topology?.device_components?.forEach((component) => {
        pushUniqueComponent(existing.components, component);
      });
      snapshot.topology?.device_links?.forEach((link) => {
        pushUniqueLink(existing.links, link);
      });
      return;
    }

    devicesById.set(deviceId, {
      id: deviceId,
      name: deviceName,
      kind: deviceKind,
      primaryRuntimeHostId,
      connectionState: snapshot.connectionState,
      hosts: [snapshot],
      components: [...(snapshot.topology?.device_components ?? [])],
      links: [...(snapshot.topology?.device_links ?? [])],
    });
  });

  return Array.from(devicesById.values()).sort((left, right) => left.name.localeCompare(right.name));
}

function buildUnpolledRuntimeHostSnapshot(host: RuntimeHostRecord): RuntimeHostSnapshot {
  const cachedTopology = host.lastTopology
    ? normalizeRuntimeTopologyResponse(host.lastTopology)
    : null;

  if (isMeshOnlyConfirmedPeer(host)) {
    const connectionState: RuntimeHostConnectionState = host.status === 'offline'
      ? 'offline'
      : host.status === 'warning' || host.verificationStatus === 'failed'
        ? 'error'
        : 'online';

    return {
      host,
      connectionState,
      agents: [],
      topology: cachedTopology,
      error: host.verificationStatus === 'failed' ? host.lastVerificationError : undefined,
    };
  }

    return {
      host,
      connectionState: 'error',
      agents: [],
      topology: cachedTopology,
      error: 'Awaiting verification before protected polling',
    };
  }

function parseHostAddress(hostAddress: string): { host: string; port: number } {
  const raw = hostAddress.trim();
  if (!raw) {
    throw new Error('host:port is required（必须输入 host:port）');
  }
  if (raw.includes('://') || raw.includes('/') || raw.includes('?') || raw.includes('#')) {
    throw new Error('invalid host:port format（host:port 格式错误）');
  }

  const splitIndex = raw.lastIndexOf(':');
  if (splitIndex <= 0 || splitIndex === raw.length - 1) {
    if (!raw.includes(':')) {
      return {
        host: raw,
        port: DEFAULT_EXTERNAL_RUNTIME_PORT,
      };
    }
    throw new Error('invalid host:port format（host:port 格式错误）');
  }

  const hostRaw = raw.slice(0, splitIndex).trim();
  const portRaw = raw.slice(splitIndex + 1).trim();
  const host = hostRaw.startsWith('[') && hostRaw.endsWith(']') ? hostRaw.slice(1, -1) : hostRaw;
  const port = Number.parseInt(portRaw, 10);

  if (!host) {
    throw new Error('host is required（host 不能为空）');
  }
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('port must be 1-65535（端口需在 1-65535）');
  }

  return { host, port };
}

export class RuntimeManager {
  private readonly hostService: Pick<RuntimeHostService, 'listHosts' | 'addHost' | 'removeHost'>
    & Partial<Pick<RuntimeHostService, 'mergeHostMetadata'>>;
  private readonly runtimeClient: Pick<RuntimeClient, 'getAgents' | 'getTopology'>
    & Partial<Pick<RuntimeClient, 'getAllEnergy'>>;
  private readonly runtimeMeshSyncService: Pick<RuntimeMeshSyncService, 'ensurePeerPair'>;
  private readonly now: () => Date;

  constructor(options: RuntimeManagerOptions = {}) {
    this.hostService = options.hostService ?? getRuntimeHostService();
    this.runtimeClient = options.runtimeClient ?? new RuntimeClient();
    this.runtimeMeshSyncService = options.runtimeMeshSyncService ?? getRuntimeMeshSyncService();
    this.now = options.now ?? (() => new Date());
  }

  async refreshSnapshot(): Promise<RuntimeManagerSnapshot> {
    const hosts = await this.hostService.listHosts();
    const hostSnapshots = await Promise.all(hosts.map((host) => this.buildHostSnapshot(host)));
    const agents = hostSnapshots.flatMap((item) => item.agents);

    return {
      updatedAt: toIso(this.now),
      hosts: hostSnapshots,
      devices: buildRuntimeDeviceSnapshots(hostSnapshots),
      agents,
    };
  }

  async retryHost(hostId: string): Promise<RuntimeHostSnapshot | null> {
    const hosts = await this.hostService.listHosts();
    const target = hosts.find((item) => item.id === hostId);
    if (!target) return null;
    return this.buildHostSnapshot(target);
  }

  async addHost(input: AddRuntimeHostInput): Promise<RuntimeHostRecord> {
    return this.hostService.addHost(input);
  }

  async addHostFromAddress(hostAddress: string, name?: string, authToken?: string): Promise<RuntimeHostRecord> {
    const parsed = parseHostAddress(hostAddress);
    return this.hostService.addHost({
      name: name?.trim(),
      host: parsed.host,
      port: parsed.port,
      authToken,
    });
  }

  async removeHost(hostId: string): Promise<void> {
    await this.hostService.removeHost(hostId);
  }

  private async buildHostSnapshot(host: RuntimeHostRecord): Promise<RuntimeHostSnapshot> {
    if (!shouldAutoPollRuntimeHost(host)) {
      return buildUnpolledRuntimeHostSnapshot(host);
    }

    const topologyStartedAtMs = Date.now();
    const energyRequest = this.runtimeClient.getAllEnergy
      ? this.runtimeClient.getAllEnergy(host).catch(() => ({
        ok: false as const,
        error: { code: 'network' as const, message: 'energy fetch failed' },
      }))
      : Promise.resolve({
        ok: false as const,
        error: { code: 'invalid_payload' as const, message: 'energy endpoint unavailable' },
      });
    const [agentsResult, topologyEnvelope, energyResult] = await Promise.all([
      this.runtimeClient.getAgents(host),
      this.runtimeClient.getTopology(host).then((result) => ({
        result,
        latencyMs: Math.max(1, Date.now() - topologyStartedAtMs),
      })),
      energyRequest,
    ]);
    const topologyResult = topologyEnvelope.result;
    const normalizedTopology = topologyResult.ok
      ? normalizeRuntimeTopologyResponse(topologyResult.data)
      : null;

    // Build energy lookup map by agent_id
    const energyMap = new Map<string, AgentEnergySnapshot>();
    if (energyResult.ok) {
      for (const snap of energyResult.data) {
        energyMap.set(snap.agent_id, snap);
      }
    }

    if (!agentsResult.ok) {
      return {
        host,
        connectionState: mapErrorToConnectionState(agentsResult.error.code),
        agents: [],
        topology: normalizedTopology,
        latencyMs: topologyEnvelope.latencyMs,
        error: agentsResult.error.message,
      };
    }

    const nextAgents: RuntimeAggregatedAgent[] = agentsResult.data.map((agent) => ({
      ...agent,
      sourceHostId: host.id,
      sourceHostName: host.name,
      sourceHostAddress: `${host.host}:${host.port}`,
      energy: energyMap.get(agent.id),
    }));

    if (!topologyResult.ok) {
      return {
        host,
        connectionState: mapErrorToConnectionState(topologyResult.error.code),
        agents: nextAgents,
        topology: null,
        latencyMs: topologyEnvelope.latencyMs,
        error: topologyResult.error.message,
      };
    }

    const resolvedHost = await this.persistSuccessfulDialMetadata(host, normalizedTopology!);

    return {
      host: resolvedHost,
      connectionState: 'online',
      agents: nextAgents,
      topology: normalizedTopology,
      latencyMs: topologyEnvelope.latencyMs,
    };
  }

  private async persistSuccessfulDialMetadata(
    host: RuntimeHostRecord,
    topology: RuntimeTopologyResponse,
  ): Promise<RuntimeHostRecord> {
    const liveHostId = resolveTopologyHostId(topology);
    const liveDeviceId = topology.device_is_inferred ? undefined : resolveTopologyDevice(topology)?.id;
    if ((!liveHostId && !liveDeviceId) || !this.hostService.mergeHostMetadata) {
      return host;
    }

    const patch: RuntimeHostMetadataPatch = {
      hostId: liveHostId,
      lastTopology: topology,
      lastSuccessfulDialAddress: resolveRuntimeHostDialAddress(host),
    };
    if (liveDeviceId) {
      patch.deviceId = liveDeviceId;
    }

    const currentTopologyJson = host.lastTopology
      ? JSON.stringify(normalizeRuntimeTopologyResponse(host.lastTopology))
      : '';
    const nextTopologyJson = JSON.stringify(topology);
    const nextDeviceId = liveDeviceId ?? host.deviceId;

    if (
      host.hostId === patch.hostId
      && host.deviceId === nextDeviceId
      && currentTopologyJson === nextTopologyJson
      && host.lastSuccessfulDialAddress === patch.lastSuccessfulDialAddress
    ) {
      await this.ensureConfirmedPeerPair(host);
      return host;
    }

    try {
      const mergedHost = await this.hostService.mergeHostMetadata(host.id, patch);
      await this.ensureConfirmedPeerPair(mergedHost);
      return mergedHost;
    } catch {
      return host;
    }
  }

  private async ensureConfirmedPeerPair(host: RuntimeHostRecord): Promise<void> {
    if (!getSyncAutomationEnabled()) {
      return;
    }

    if (host.trustState !== 'confirmed_peer' || !host.hostId) {
      return;
    }

    try {
      await this.runtimeMeshSyncService.ensurePeerPair(host);
    } catch {
      // Pairing sync is best-effort（自动配对失败不应阻塞主机刷新）。
    }
  }
}

let runtimeManagerInstance: RuntimeManager | null = null;

export function getRuntimeManager(): RuntimeManager {
  if (!runtimeManagerInstance) {
    runtimeManagerInstance = new RuntimeManager();
  }
  return runtimeManagerInstance;
}

export function resetRuntimeManagerForTests(): void {
  runtimeManagerInstance = null;
}
