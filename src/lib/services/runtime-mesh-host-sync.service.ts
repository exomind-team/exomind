import { formatRuntimeTargetAddress } from '@/config/runtime-target';
import type { RuntimeHostRecord } from '@/lib/types/agent-hub';
import {
  getRuntimeControlService,
  type RuntimeControlService,
} from '@/lib/services/runtime-control.service';
import {
  getRuntimeHostService,
  type AddRuntimeHostInput,
  type RuntimeHostMetadataPatch,
  type RuntimeHostService,
} from '@/lib/services/runtime-host.service';
import {
  getRuntimeMeshSyncService,
  type RuntimeMeshSyncService,
  type RuntimeMeshPeerRecord,
} from '@/lib/services/runtime-mesh-sync.service';

type RuntimeDiscoveredPeer = {
  host_id: string;
  host: string;
  port: number;
};

type RuntimeMeshPeer = {
  id: string;
  base_url: string;
  enabled: boolean;
  status?: string;
  last_seen?: string | null;
  last_error?: string | null;
  created_at?: string;
  updated_at?: string;
};

export interface RuntimeMeshHostSyncServiceOptions {
  hostService?: Pick<RuntimeHostService, 'listHosts' | 'addHost' | 'mergeHostMetadata' | 'removeHost'>;
  meshService?: Pick<RuntimeMeshSyncService, 'listDiscoveredPeers' | 'listMeshPeers' | 'setPeerEnabled'>;
  runtimeControlService?: Pick<RuntimeControlService, 'getPeerDialAddress'>;
}

function buildPeerName(hostId: string, host: string, port: number): string {
  const shortHostId = hostId.trim().slice(0, 8);
  return shortHostId ? `Node ${shortHostId} (${host}:${port})` : `${host}:${port}`;
}

function shouldRefreshPeerName(existingHost: RuntimeHostRecord, nextHostId: string): boolean {
  if (existingHost.trustState === 'manual_seed') {
    return false;
  }

  const currentName = existingHost.name.trim();
  if (!currentName) {
    return true;
  }

  return currentName === `${existingHost.host}:${existingHost.port}`
    || (existingHost.hostId
      ? currentName === buildPeerName(existingHost.hostId, existingHost.host, existingHost.port)
      : false)
    || currentName === buildPeerName(nextHostId, existingHost.host, existingHost.port);
}

function replaceHost(hosts: RuntimeHostRecord[], nextHost: RuntimeHostRecord): RuntimeHostRecord[] {
  const index = hosts.findIndex((host) => host.id === nextHost.id);
  if (index < 0) {
    return [...hosts, nextHost];
  }

  const nextHosts = [...hosts];
  nextHosts[index] = nextHost;
  return nextHosts;
}

function findExistingHost(
  hosts: RuntimeHostRecord[],
  input: { hostId?: string; host: string; port: number; advertisedListenAddress: string },
): RuntimeHostRecord | undefined {
  if (input.hostId) {
    const exactHostIdMatch = hosts.find((host) => host.hostId === input.hostId);
    if (exactHostIdMatch) {
      return exactHostIdMatch;
    }
  }

  return hosts.find((host) => {
    const matchesEndpoint = host.host === input.host && host.port === input.port;
    const matchesAdvertisedAddress = host.advertisedListenAddress === input.advertisedListenAddress;

    if (!matchesEndpoint && !matchesAdvertisedAddress) {
      return false;
    }

    // Do not collapse a newly discovered / paired node into an older confirmed peer
    // when the endpoint is reused but the logical host_id has changed（同 endpoint 复用时，
    // 若逻辑 host_id 已变更，则保留为新节点，避免把发现结果吞进旧 confirmed peer）。
    if (input.hostId && host.hostId && host.hostId !== input.hostId) {
      return false;
    }

    return true;
  });
}

function parsePeerBaseUrl(baseUrl: string): { host: string; port: number } | null {
  try {
    const parsed = new URL(baseUrl);
    if (!parsed.hostname || !parsed.port) {
      return null;
    }
    return {
      host: parsed.hostname,
      port: Number.parseInt(parsed.port, 10),
    };
  } catch {
    return null;
  }
}

function normalizeHostForMatch(host: string): string {
  return host.trim().replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
}

function isAndroidEmulatorGuestHost(host: string): boolean {
  const normalized = normalizeHostForMatch(host);
  return /^10\.0\.(2|3)\.\d+$/.test(normalized)
    && normalized !== '10.0.2.2'
    && normalized !== '10.0.3.2';
}

function buildHostSyncKey(input: {
  hostId?: string;
  advertisedListenAddress?: string;
  host?: string;
  port?: number;
}): string {
  if (input.hostId) {
    return `host-id:${input.hostId}`;
  }
  if (input.advertisedListenAddress) {
    return `advertised:${input.advertisedListenAddress}`;
  }
  if (input.host && input.port) {
    return `endpoint:${input.host}:${input.port}`;
  }
  return 'unknown';
}

export class RuntimeMeshHostSyncService {
  private readonly hostService: Pick<RuntimeHostService, 'listHosts' | 'addHost' | 'mergeHostMetadata' | 'removeHost'>;
  private readonly meshService: Pick<RuntimeMeshSyncService, 'listDiscoveredPeers' | 'listMeshPeers' | 'setPeerEnabled'>;
  private readonly runtimeControlService: Pick<RuntimeControlService, 'getPeerDialAddress'>;
  private syncInFlight: Promise<RuntimeHostRecord[]> | null = null;

  constructor(options: RuntimeMeshHostSyncServiceOptions = {}) {
    this.hostService = options.hostService ?? getRuntimeHostService();
    this.meshService = options.meshService ?? getRuntimeMeshSyncService();
    this.runtimeControlService = options.runtimeControlService ?? getRuntimeControlService();
  }

  async syncLocalRuntimeMeshState(
    runtimeBaseUrl: string,
    localAuthToken?: string,
  ): Promise<RuntimeHostRecord[]> {
    if (this.syncInFlight) {
      return this.syncInFlight;
    }

    this.syncInFlight = this.performSyncLocalRuntimeMeshState(runtimeBaseUrl, localAuthToken);
    try {
      return await this.syncInFlight;
    } finally {
      this.syncInFlight = null;
    }
  }

  private async performSyncLocalRuntimeMeshState(
    runtimeBaseUrl: string,
    localAuthToken?: string,
  ): Promise<RuntimeHostRecord[]> {
    const [existingHosts, discoveredPeers, rawMeshPeers] = await Promise.all([
      this.hostService.listHosts(),
      this.meshService.listDiscoveredPeers(runtimeBaseUrl, localAuthToken).catch(() => [] as RuntimeDiscoveredPeer[]),
      this.meshService.listMeshPeers(runtimeBaseUrl, localAuthToken).catch(() => [] as RuntimeMeshPeer[]),
    ]);
    const { activePeers: meshPeers, replacedPeerIds } = await this.reconcileMeshPeers(
      runtimeBaseUrl,
      rawMeshPeers,
      localAuthToken,
    );

    let nextHosts = [...existingHosts];

    for (const peer of discoveredPeers) {
      nextHosts = await this.upsertDiscoveredPeer(nextHosts, peer, localAuthToken);
    }

    for (const peer of meshPeers.filter((item) => item.enabled)) {
      nextHosts = await this.upsertConfirmedPeer(nextHosts, peer, localAuthToken);
    }

    nextHosts = await this.transferCollapsedPeerMetadata(nextHosts, replacedPeerIds);

    nextHosts = await this.pruneStaleRuntimeHosts(
      nextHosts,
      discoveredPeers,
      meshPeers.filter((item) => item.enabled),
    );

    return nextHosts;
  }

  private async reconcileMeshPeers(
    runtimeBaseUrl: string,
    meshPeers: RuntimeMeshPeer[],
    localAuthToken?: string,
  ): Promise<{
    activePeers: RuntimeMeshPeer[];
    replacedPeerIds: Map<string, string>;
  }> {
    const enabledPeers = meshPeers.filter((peer) => peer.enabled);
    const stalePeerIds = new Set<string>();
    const replacedPeerIds = new Map<string, string>();

    const peersByBaseUrl = new Map<string, RuntimeMeshPeer[]>();
    for (const peer of enabledPeers) {
      const bucket = peersByBaseUrl.get(peer.base_url) ?? [];
      bucket.push(peer);
      peersByBaseUrl.set(peer.base_url, bucket);
    }

    for (const peers of peersByBaseUrl.values()) {
      if (peers.length <= 1) {
        continue;
      }

      const [preferredPeer, ...stalePeers] = [...peers].sort(compareMeshPeerFreshness);
      stalePeers.forEach((peer) => {
        stalePeerIds.add(peer.id);
        replacedPeerIds.set(peer.id, preferredPeer.id);
      });
      stalePeerIds.delete(preferredPeer.id);
    }

    const dedupedPeers = enabledPeers.filter((peer) => !stalePeerIds.has(peer.id));
    const bridgeAliasGroups = new Map<string, RuntimeMeshPeer[]>();
    for (const peer of dedupedPeers) {
      const baseUrlHost = parseMeshPeerBaseUrlHost(peer.base_url);
      if (!baseUrlHost || !isBridgeAliasHost(baseUrlHost)) {
        continue;
      }

      const bucket = bridgeAliasGroups.get(baseUrlHost) ?? [];
      bucket.push(peer);
      bridgeAliasGroups.set(baseUrlHost, bucket);
    }

    for (const peers of bridgeAliasGroups.values()) {
      const onlinePeers = peers.filter(isMeshPeerOnline);
      if (onlinePeers.length === 0) {
        continue;
      }

      for (const peer of peers) {
        if (!isMeshPeerOnline(peer)) {
          stalePeerIds.add(peer.id);
        }
      }
    }

    const stalePeers = enabledPeers.filter((peer) => stalePeerIds.has(peer.id));
    for (const peer of stalePeers) {
      await this.meshService.setPeerEnabled(
        runtimeBaseUrl,
        peer.id,
        peer.base_url,
        false,
        localAuthToken,
      );
    }

    return {
      activePeers: enabledPeers.filter((peer) => !stalePeerIds.has(peer.id)),
      replacedPeerIds,
    };
  }

  private async transferCollapsedPeerMetadata(
    hosts: RuntimeHostRecord[],
    replacedPeerIds: Map<string, string>,
  ): Promise<RuntimeHostRecord[]> {
    if (replacedPeerIds.size === 0) {
      return hosts;
    }

    let nextHosts = [...hosts];
    const pairsByPreferredPeerId = new Map<string, RuntimeHostRecord[]>();
    for (const [stalePeerId, preferredPeerId] of replacedPeerIds.entries()) {
      const sourceHost = nextHosts.find((host) => host.hostId === stalePeerId);
      if (!sourceHost) {
        continue;
      }
      const bucket = pairsByPreferredPeerId.get(preferredPeerId) ?? [];
      bucket.push(sourceHost);
      pairsByPreferredPeerId.set(preferredPeerId, bucket);
    }

    for (const [preferredPeerId, sourceHosts] of pairsByPreferredPeerId.entries()) {
      const targetHost = nextHosts.find((host) => host.hostId === preferredPeerId);
      if (!targetHost) {
        continue;
      }

      const verificationSourceHost = pickBestVerificationSourceHost(sourceHosts);
      if (!verificationSourceHost) {
        continue;
      }

      if (!shouldTransferVerificationMetadata(targetHost, verificationSourceHost)) {
        continue;
      }

      const mergedTargetHost = await this.hostService.mergeHostMetadata(targetHost.id, {
        verificationStatus: verificationSourceHost.verificationStatus,
        lastVerifiedAt: verificationSourceHost.lastVerifiedAt ?? null,
        lastVerificationTrigger: verificationSourceHost.lastVerificationTrigger ?? null,
        localInitiatedRttMs: verificationSourceHost.localInitiatedRttMs ?? null,
        peerInitiatedRttMs: verificationSourceHost.peerInitiatedRttMs ?? null,
        lastVerificationError: verificationSourceHost.lastVerificationError ?? null,
      });
      nextHosts = replaceHost(nextHosts, mergedTargetHost);
    }

    return nextHosts;
  }

  private async upsertDiscoveredPeer(
    hosts: RuntimeHostRecord[],
    peer: RuntimeDiscoveredPeer,
    localAuthToken?: string,
  ): Promise<RuntimeHostRecord[]> {
    const advertisedListenAddress = formatRuntimeTargetAddress({
      host: peer.host,
      port: peer.port,
    });
    const dialAddress = await this.resolvePeerDialAddress(peer.host, peer.port);
    const manualOverride = dialAddress !== advertisedListenAddress ? dialAddress : undefined;
    const existingHost = findExistingHost(hosts, {
      hostId: peer.host_id,
      host: peer.host,
      port: peer.port,
      advertisedListenAddress,
    });

    if (!existingHost) {
      const created = await this.hostService.addHost({
        name: buildPeerName(peer.host_id, peer.host, peer.port),
        host: peer.host,
        port: peer.port,
        hostId: peer.host_id,
        trustState: 'discovered_candidate',
        advertisedListenAddress,
        manualOverride,
        authToken: localAuthToken,
      } satisfies AddRuntimeHostInput);
      return [...hosts, created];
    }

    const refreshedName = shouldRefreshPeerName(existingHost, peer.host_id)
      ? buildPeerName(peer.host_id, peer.host, peer.port)
      : undefined;
    const patch: RuntimeHostMetadataPatch = {
      name: refreshedName,
      host: peer.host,
      port: peer.port,
      hostId: peer.host_id,
      trustState: existingHost.trustState === 'confirmed_peer'
        ? 'confirmed_peer'
        : 'discovered_candidate',
      advertisedListenAddress,
      manualOverride,
      authToken: localAuthToken,
    };
    const merged = await this.hostService.mergeHostMetadata(existingHost.id, patch);
    return replaceHost(hosts, merged);
  }

  private async upsertConfirmedPeer(
    hosts: RuntimeHostRecord[],
    peer: RuntimeMeshPeer,
    localAuthToken?: string,
  ): Promise<RuntimeHostRecord[]> {
    const parsed = parsePeerBaseUrl(peer.base_url);
    if (!parsed) {
      return hosts;
    }

    const existingHost = findExistingHost(hosts, {
      hostId: peer.id,
      host: parsed.host,
      port: parsed.port,
      advertisedListenAddress: formatRuntimeTargetAddress(parsed),
    });
    const shouldPreserveGuestEndpoint = Boolean(
      existingHost
      && isBridgeAliasHost(parsed.host)
      && isAndroidEmulatorGuestHost(existingHost.host),
    );
    const hostAddress = shouldPreserveGuestEndpoint
      ? {
          host: existingHost!.host,
          port: existingHost!.port,
        }
      : parsed;
    const advertisedListenAddress = shouldPreserveGuestEndpoint
      ? (
          existingHost!.advertisedListenAddress
          ?? formatRuntimeTargetAddress({
            host: existingHost!.host,
            port: existingHost!.port,
          })
        )
      : formatRuntimeTargetAddress(parsed);
    const dialAddress = await this.resolvePeerDialAddress(parsed.host, parsed.port);
    const manualOverride = dialAddress !== advertisedListenAddress ? dialAddress : undefined;

    if (!existingHost) {
      const created = await this.hostService.addHost({
        name: buildPeerName(peer.id, parsed.host, parsed.port),
        host: parsed.host,
        port: parsed.port,
        hostId: peer.id,
        trustState: 'confirmed_peer',
        advertisedListenAddress,
        manualOverride,
        authToken: localAuthToken,
      } satisfies AddRuntimeHostInput);
      return [...hosts, created];
    }

    const refreshedName = shouldRefreshPeerName(existingHost, peer.id)
      ? buildPeerName(peer.id, hostAddress.host, hostAddress.port)
      : undefined;
    const patch: RuntimeHostMetadataPatch = {
      name: refreshedName,
      host: hostAddress.host,
      port: hostAddress.port,
      hostId: peer.id,
      trustState: 'confirmed_peer',
      advertisedListenAddress,
      manualOverride,
      authToken: localAuthToken,
    };
    const merged = await this.hostService.mergeHostMetadata(existingHost.id, patch);
    return replaceHost(hosts, merged);
  }

  private async resolvePeerDialAddress(host: string, port: number): Promise<string> {
    try {
      const resolved = await this.runtimeControlService.getPeerDialAddress(host, port);
      return formatRuntimeTargetAddress({
        host: resolved.host,
        port: resolved.port,
      });
    } catch {
      return formatRuntimeTargetAddress({ host, port });
    }
  }

  private async pruneStaleRuntimeHosts(
    hosts: RuntimeHostRecord[],
    discoveredPeers: RuntimeDiscoveredPeer[],
    meshPeers: RuntimeMeshPeer[],
  ): Promise<RuntimeHostRecord[]> {
    const activeDiscoveredKeys = new Set(
      discoveredPeers.map((peer) => buildHostSyncKey({
        hostId: peer.host_id,
        advertisedListenAddress: formatRuntimeTargetAddress({
          host: peer.host,
          port: peer.port,
        }),
        host: peer.host,
        port: peer.port,
      })),
    );
    const activeConfirmedHostIds = new Set(
      meshPeers
        .map((peer) => peer.id)
        .filter((peerId): peerId is string => typeof peerId === 'string' && peerId.length > 0),
    );
    const removableHosts = hosts.filter((host) => {
      const hostKey = buildHostSyncKey({
        hostId: host.hostId,
        advertisedListenAddress: host.advertisedListenAddress,
        host: host.host,
        port: host.port,
      });
      if (host.trustState === 'discovered_candidate') {
        return !activeDiscoveredKeys.has(hostKey);
      }
      if (host.trustState === 'confirmed_peer') {
        // Confirmed peers are persistent user-trusted relationships（持久化的已确认设备关系）.
        // However, once the current runtime has reported a non-empty mesh peer set, any
        // confirmed host whose host_id is no longer present in that live mesh should be
        // retired to keep one device => one node in the product surface（拿到当前 mesh 后，
        // 应清掉不再属于当前 mesh 的旧 confirmed 记录，避免设备页堆积历史节点）.
        return activeConfirmedHostIds.size > 0
          && typeof host.hostId === 'string'
          && host.hostId.length > 0
          && !activeConfirmedHostIds.has(host.hostId);
      }
      return false;
    });

    for (const host of removableHosts) {
      await this.hostService.removeHost(host.id);
    }

    return hosts.filter((host) => !removableHosts.some((item) => item.id === host.id));
  }
}

function parseMeshPeerBaseUrlHost(baseUrl: string): string | null {
  try {
    return new URL(baseUrl).hostname.trim().toLowerCase();
  } catch {
    return null;
  }
}

function parseMeshPeerFreshness(peer: RuntimeMeshPeerRecord): number {
  const candidates = [
    peer.updated_at,
    peer.last_seen ?? undefined,
    peer.created_at,
  ];

  for (const value of candidates) {
    if (!value) {
      continue;
    }
    const ts = Date.parse(value);
    if (Number.isFinite(ts)) {
      return ts;
    }
  }

  return 0;
}

function compareMeshPeerFreshness(left: RuntimeMeshPeerRecord, right: RuntimeMeshPeerRecord): number {
  const leftRank = getMeshPeerStatusRank(left.status);
  const rightRank = getMeshPeerStatusRank(right.status);
  if (rightRank !== leftRank) {
    return rightRank - leftRank;
  }

  const freshnessDelta = parseMeshPeerFreshness(right) - parseMeshPeerFreshness(left);
  if (freshnessDelta !== 0) {
    return freshnessDelta;
  }

  return right.id.localeCompare(left.id);
}

function getMeshPeerStatusRank(status: string | undefined): number {
  if (status === 'online') {
    return 3;
  }
  if (status === 'connecting') {
    return 2;
  }
  if (status === 'error') {
    return 1;
  }
  return 0;
}

function isMeshPeerOnline(peer: RuntimeMeshPeerRecord): boolean {
  return peer.status === 'online';
}

function isBridgeAliasHost(host: string): boolean {
  return host === '127.0.0.1'
    || host === 'localhost'
    || host === '198.18.0.1'
    || host === '10.0.2.2'
    || host === '10.0.3.2';
}

function getVerificationStatusRank(status: RuntimeHostRecord['verificationStatus']): number {
  if (status === 'verified') {
    return 4;
  }
  if (status === 'running') {
    return 3;
  }
  if (status === 'failed') {
    return 2;
  }
  if (status === 'idle') {
    return 1;
  }
  return 0;
}

function parseVerificationTimestamp(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasVerificationMetadata(host: RuntimeHostRecord): boolean {
  return getVerificationStatusRank(host.verificationStatus) > 0
    || Boolean(host.lastVerifiedAt)
    || typeof host.localInitiatedRttMs === 'number'
    || typeof host.peerInitiatedRttMs === 'number'
    || Boolean(host.lastVerificationError);
}

function pickBestVerificationSourceHost(hosts: RuntimeHostRecord[]): RuntimeHostRecord | null {
  const rankedHosts = hosts
    .filter(hasVerificationMetadata)
    .sort((left, right) => {
      const rightRank = getVerificationStatusRank(right.verificationStatus);
      const leftRank = getVerificationStatusRank(left.verificationStatus);
      if (rightRank !== leftRank) {
        return rightRank - leftRank;
      }

      const freshnessDelta = parseVerificationTimestamp(right.lastVerifiedAt)
        - parseVerificationTimestamp(left.lastVerifiedAt);
      if (freshnessDelta !== 0) {
        return freshnessDelta;
      }

      return right.updatedAt.localeCompare(left.updatedAt);
    });

  return rankedHosts[0] ?? null;
}

function shouldTransferVerificationMetadata(
  targetHost: RuntimeHostRecord,
  sourceHost: RuntimeHostRecord,
): boolean {
  const targetRank = getVerificationStatusRank(targetHost.verificationStatus);
  const sourceRank = getVerificationStatusRank(sourceHost.verificationStatus);
  if (sourceRank > targetRank) {
    return true;
  }
  if (sourceRank < targetRank) {
    return false;
  }

  return parseVerificationTimestamp(sourceHost.lastVerifiedAt)
    > parseVerificationTimestamp(targetHost.lastVerifiedAt);
}

let runtimeMeshHostSyncServiceInstance: RuntimeMeshHostSyncService | null = null;

export function getRuntimeMeshHostSyncService(): RuntimeMeshHostSyncService {
  if (!runtimeMeshHostSyncServiceInstance) {
    runtimeMeshHostSyncServiceInstance = new RuntimeMeshHostSyncService();
  }
  return runtimeMeshHostSyncServiceInstance;
}

export function resetRuntimeMeshHostSyncServiceForTests(): void {
  runtimeMeshHostSyncServiceInstance = null;
}
