import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AgentsPage } from '@/ui/app/pages/AgentsPage';
import { AGENT_HUB_MOCK_FIXTURE } from '@/lib/adapters/mock/fixtures/agent-hub';
import type { RuntimeHostRecord } from '@/lib/types/agent-hub';
import {
  DEFAULT_EMBEDDED_RUNTIME_PORT,
  DEFAULT_EXTERNAL_RUNTIME_PORT,
  EMBEDDED_RUNTIME_NETWORK_MODE_STORAGE_KEY,
} from '@/config/runtime-target';

const invokeMock = vi.hoisted(() => vi.fn());
const isTauriMock = vi.hoisted(() => vi.fn(async () => true));
const agentHubMocks = vi.hoisted(() => ({
  getTopology: vi.fn(),
  getDeviceView: vi.fn(),
}));

const runtimeManagerMocks = vi.hoisted(() => ({
  refreshSnapshot: vi.fn(),
  addHost: vi.fn(),
  addHostFromAddress: vi.fn(),
  retryHost: vi.fn(),
  removeHost: vi.fn(),
}));

const runtimeControlMocks = vi.hoisted(() => ({
  startRuntime: vi.fn(),
  stopRuntime: vi.fn(),
  getStatus: vi.fn(),
}));

const runtimeMeshSyncMocks = vi.hoisted(() => ({
  ensurePeerPair: vi.fn(),
  listDiscoveredPeers: vi.fn(),
  listMeshPeers: vi.fn(),
}));

const runtimeHostServiceMocks = vi.hoisted(() => ({
  listHosts: vi.fn(),
  addHost: vi.fn(),
  mergeHostMetadata: vi.fn(),
  removeHost: vi.fn(),
}));

const runtimeLinkProofMocks = vi.hoisted(() => ({
  runVerification: vi.fn(),
}));

const signalStreamMocks = vi.hoisted(() => {
  const listeners = new Set<(event: unknown) => void>();
  return {
    listeners,
    start: vi.fn(),
    stop: vi.fn(),
    history: vi.fn(),
    publish: vi.fn(),
    emit(event: unknown) {
      for (const listener of listeners) {
        listener(event);
      }
    },
  };
});

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: (...args: unknown[]) => isTauriMock(...args),
}));
vi.mock('@/lib/services', () => ({
  getAgentHubService: () => ({
    getTopology: agentHubMocks.getTopology,
    getDeviceView: agentHubMocks.getDeviceView,
  }),
}));

vi.mock('@/services/runtime-manager', () => ({
  getRuntimeManager: () => runtimeManagerMocks,
  findPreferredRuntimeHostForAgent: vi.fn(() => null),
  shouldAutoPollRuntimeHost: vi.fn(() => true),
}));

vi.mock('@/lib/services/runtime-control.service', () => ({
  getRuntimeControlService: () => runtimeControlMocks,
}));

vi.mock('@/lib/services/runtime-mesh-sync.service', () => ({
  getRuntimeMeshSyncService: () => runtimeMeshSyncMocks,
}));

vi.mock('@/lib/services/runtime-host.service', () => ({
  getRuntimeHostService: () => runtimeHostServiceMocks,
}));

vi.mock('@/lib/services/runtime-link-proof.service', () => ({
  createRuntimeLinkProofService: () => ({
    runVerification: runtimeLinkProofMocks.runVerification,
  }),
}));

vi.mock('@/lib/services/signal-stream.service', () => ({
  SignalStreamService: class MockSignalStreamService {
    onSignal(callback: (event: unknown) => void) {
      signalStreamMocks.listeners.add(callback);
      return () => {
        signalStreamMocks.listeners.delete(callback);
      };
    }

    start() {
      signalStreamMocks.start();
    }

    stop() {
      signalStreamMocks.stop();
    }

    async history(query?: unknown) {
      return signalStreamMocks.history(query);
    }

    async publish(request: unknown) {
      return signalStreamMocks.publish(request);
    }
  },
}));

describe('agent device runtime host issue-205（设备页 RuntimeHost 管理）', () => {
  let hosts: RuntimeHostRecord[];
  let hostState: Record<string, 'online' | 'offline' | 'error'>;
  let topologyByHostId: Record<string, Record<string, unknown> | null>;
  let fetchMock: ReturnType<typeof vi.fn>;

  const buildSnapshot = () => ({
    updatedAt: '2026-02-27T10:00:00.000Z',
    agents: hosts
      .filter((host) => hostState[host.id] === 'online')
      .map((host) => ({
        id: `agent-${host.id}`,
        name: `Agent@${host.name}`,
        description: 'Runtime Agent',
        status: 'available',
        sourceHostId: host.id,
        sourceHostName: host.name,
        sourceHostAddress: `${host.host}:${host.port}`,
      })),
    hosts: hosts.map((host) => ({
      host,
      connectionState: hostState[host.id] ?? 'offline',
      agents: [],
      topology:
        hostState[host.id] === 'online'
          ? {
              hostname: host.name,
              os: 'Windows 11',
              arch: 'x86_64',
              uptime_secs: 3600,
              version: '0.1.0',
              port: host.port,
              total_memory_mb: 16384,
              used_memory_mb: 8192,
              ...(topologyByHostId[host.id] ?? {}),
            }
          : null,
      latencyMs: hostState[host.id] === 'online' ? 15 : undefined,
      error: hostState[host.id] === 'offline' ? 'ECONNREFUSED' : undefined,
    })),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    vi.stubGlobal('__TAURI_INTERNALS__', {});
    vi.clearAllMocks();
    fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => [],
    }));
    vi.stubGlobal('fetch', fetchMock);
    isTauriMock.mockResolvedValue(true);
    invokeMock.mockImplementation(async (
      command: string,
      payload?: { mode?: string; address?: string },
    ) => {
      if (command === 'runtime_target_mode_set' || command === 'runtime_network_mode_set') {
        return payload?.mode ?? 'embedded';
      }
      if (command === 'runtime_external_address_set') {
        return payload?.address ?? '';
      }
      return null;
    });

    hosts = [
      {
        id: 'runtime-host-1',
        name: 'Hope Desktop',
        host: '127.0.0.1',
        port: 4077,
        status: 'unknown',
        createdAt: '2026-02-27T10:00:00.000Z',
        updatedAt: '2026-02-27T10:00:00.000Z',
      },
    ];
    hostState = {
      'runtime-host-1': 'offline',
    };
    topologyByHostId = {};

    agentHubMocks.getTopology.mockResolvedValue(AGENT_HUB_MOCK_FIXTURE.topology);
    agentHubMocks.getDeviceView.mockResolvedValue(AGENT_HUB_MOCK_FIXTURE.deviceGroups);

    runtimeManagerMocks.refreshSnapshot.mockImplementation(async () => buildSnapshot());
    runtimeManagerMocks.addHost.mockImplementation(async (input: { name: string; host: string; port: number }) => {
      const added: RuntimeHostRecord = {
        id: 'runtime-host-2',
        name: input.name,
        host: input.host,
        port: input.port,
        status: 'unknown',
        createdAt: '2026-02-27T10:01:00.000Z',
        updatedAt: '2026-02-27T10:01:00.000Z',
      };
      hosts = [...hosts, added];
      hostState[added.id] = 'offline';
      return added;
    });
    runtimeManagerMocks.addHostFromAddress.mockImplementation(async (address: string, name?: string) => {
      const [host, portRaw] = address.split(':');
      const port = Number.parseInt(portRaw ?? String(DEFAULT_EXTERNAL_RUNTIME_PORT), 10);
      const added: RuntimeHostRecord = {
        id: 'runtime-host-2',
        name: name || `${host}:${port}`,
        host: host ?? '',
        port,
        status: 'unknown',
        createdAt: '2026-02-27T10:01:00.000Z',
        updatedAt: '2026-02-27T10:01:00.000Z',
        trustState: 'manual_seed',
        manualOverride: `${host}:${port}`,
      };
      hosts = [...hosts, added];
      hostState[added.id] = 'offline';
      return added;
    });
    runtimeManagerMocks.retryHost.mockImplementation(async (hostId: string) => {
      hostState[hostId] = 'online';
      return buildSnapshot().hosts.find((item) => item.host.id === hostId) ?? null;
    });
    runtimeManagerMocks.removeHost.mockResolvedValue(undefined);

    runtimeControlMocks.getStatus.mockResolvedValue({
      running: false,
      host: '127.0.0.1',
      port: DEFAULT_EMBEDDED_RUNTIME_PORT,
    });
    runtimeControlMocks.startRuntime.mockResolvedValue({
      running: true,
      host: '127.0.0.1',
      port: DEFAULT_EMBEDDED_RUNTIME_PORT,
      pid: 9527,
    });
    runtimeControlMocks.stopRuntime.mockResolvedValue({
      running: false,
      host: '127.0.0.1',
      port: DEFAULT_EMBEDDED_RUNTIME_PORT,
    });
    runtimeMeshSyncMocks.ensurePeerPair.mockResolvedValue(undefined);
    runtimeMeshSyncMocks.listDiscoveredPeers.mockImplementation(async () => (
      hosts
        .filter((host) => host.trustState === 'discovered_candidate')
        .map((host) => ({
          host_id: (host.hostId ?? host.id) as string,
          host: host.host,
          port: host.port,
        }))
    ));
    runtimeMeshSyncMocks.listMeshPeers.mockImplementation(async () => (
      hosts
        .filter((host) => host.trustState === 'confirmed_peer' && host.hostId)
        .map((host) => ({
          id: host.hostId as string,
          base_url: `http://${host.host}:${host.port}`,
          enabled: true,
        }))
    ));
    runtimeHostServiceMocks.listHosts.mockImplementation(async () => hosts);
    runtimeHostServiceMocks.addHost.mockImplementation(async (input: Record<string, unknown>) => {
      const nextHost: RuntimeHostRecord = {
        id: `runtime-host-${hosts.length + 1}`,
        name: (input.name as string | undefined) ?? `${input.host as string}:${input.port as number}`,
        host: input.host as string,
        port: input.port as number,
        status: 'unknown',
        createdAt: '2026-03-30T10:58:00.000Z',
        updatedAt: '2026-03-30T10:58:00.000Z',
        hostId: input.hostId as string | undefined,
        trustState: input.trustState as RuntimeHostRecord['trustState'],
        advertisedListenAddress: input.advertisedListenAddress as string | undefined,
        manualOverride: input.manualOverride as string | undefined,
        authToken: input.authToken as string | undefined,
      };
      hosts = [...hosts, nextHost];
      return nextHost;
    });
    runtimeHostServiceMocks.mergeHostMetadata.mockImplementation(
      async (hostId: string, patch: Record<string, unknown>) => {
        const nextUpdatedAt = '2026-03-30T10:59:00.000Z';
        hosts = hosts.map((host) => {
          if (host.id !== hostId) {
            return host;
          }

          const nextHost = {
            ...host,
            updatedAt: nextUpdatedAt,
          } as RuntimeHostRecord & Record<string, unknown>;

          for (const [key, value] of Object.entries(patch)) {
            if (typeof value === 'undefined') {
              continue;
            }
            if (value === null) {
              delete nextHost[key];
              continue;
            }
            nextHost[key] = value;
          }

          return nextHost;
        });

        const updated = hosts.find((host) => host.id === hostId);
        if (!updated) {
          throw new Error(`runtime host not found: ${hostId}`);
        }
        return updated;
      },
    );
    runtimeHostServiceMocks.removeHost.mockImplementation(async (hostId: string) => {
      hosts = hosts.filter((host) => host.id !== hostId);
    });
    runtimeLinkProofMocks.runVerification.mockReset();
    signalStreamMocks.listeners.clear();
    signalStreamMocks.start.mockReset();
    signalStreamMocks.stop.mockReset();
    signalStreamMocks.history.mockReset();
    signalStreamMocks.publish.mockReset();
    signalStreamMocks.history.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens manager sheet from device view and adds runtime host with host-only input（设备页支持 host-only 手工地址）', async () => {
    render(<AgentsPage />);
    fireEvent.click(await screen.findByTestId('agent-view-toggle-device'));

    await waitFor(() => {
      expect(screen.getByTestId('runtime-host-panel')).toBeInTheDocument();
      expect(screen.getAllByText('Hope Desktop').length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByTestId('runtime-host-manage-button'));
    await waitFor(() => {
      expect(screen.getByTestId('agent-host-manager-sheet')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('runtime-host-name-input'), { target: { value: 'LAN Runner' } });
    fireEvent.change(screen.getByTestId('runtime-host-address-input'), { target: { value: '192.168.1.33' } });
    fireEvent.click(screen.getByTestId('runtime-host-add-button'));

    await waitFor(() => {
      expect(runtimeManagerMocks.addHostFromAddress).toHaveBeenCalledWith('192.168.1.33', 'LAN Runner', undefined);
      expect(screen.getAllByText('LAN Runner').length).toBeGreaterThan(0);
      expect(screen.getAllByText(`192.168.1.33:${DEFAULT_EXTERNAL_RUNTIME_PORT}`).length).toBeGreaterThan(0);
    });
  });

  it('reuses external runtime auth token when adding matching runtime host（新增同地址主机时复用 external token）', async () => {
    window.localStorage.setItem('exomind:runtimeTargetMode', 'external');
    window.localStorage.setItem('exomind:runtimeExternalAddress', '192.168.1.48:9124');
    window.localStorage.setItem('exomind:runtimeExternalAuthToken', 'external-admin-token');

    render(<AgentsPage />);
    fireEvent.click(await screen.findByTestId('agent-view-toggle-device'));

    await waitFor(() => {
      expect(screen.getByTestId('runtime-host-panel')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('runtime-host-manage-button'));
    await waitFor(() => {
      expect(screen.getByTestId('agent-host-manager-sheet')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('runtime-host-name-input'), { target: { value: 'Protected Runtime' } });
    fireEvent.change(screen.getByTestId('runtime-host-address-input'), { target: { value: '192.168.1.48:9124' } });
    fireEvent.click(screen.getByTestId('runtime-host-add-button'));

    await waitFor(() => {
      expect(runtimeManagerMocks.addHostFromAddress).toHaveBeenCalledWith(
        '192.168.1.48:9124',
        'Protected Runtime',
        'external-admin-token',
      );
    });
  });

  it('requires local embedded runtime before pairing（未启动本机 RT 时禁用配对入口）', async () => {
    render(<AgentsPage />);
    fireEvent.click(await screen.findByTestId('agent-view-toggle-device'));

    await waitFor(() => {
      expect(screen.getByTestId('runtime-local-status')).toHaveTextContent('stopped');
    });

    const pairingButton = screen.getByTestId('device-open-peer-pairing');
    expect(pairingButton).toBeDisabled();

    fireEvent.click(pairingButton);
    expect(screen.queryByRole('heading', { name: '设备配对' })).not.toBeInTheDocument();
  });

  it('uses equal-width overview cards when companion card exists（顶部概览多卡片时平分宽度）', async () => {
    render(<AgentsPage />);
    fireEvent.click(await screen.findByTestId('agent-view-toggle-device'));

    const overviewGrid = await screen.findByTestId('runtime-device-overview-grid');
    expect(screen.getByTestId('agent-device-overview-card')).toBeInTheDocument();
    expect(overviewGrid).toHaveClass('lg:grid-cols-2');
  });

  it('keeps local runtime card full width when no companion card exists（顶部概览单卡片时保持全宽）', async () => {
    agentHubMocks.getDeviceView.mockResolvedValue([]);

    render(<AgentsPage />);
    fireEvent.click(await screen.findByTestId('agent-view-toggle-device'));

    const overviewGrid = await screen.findByTestId('runtime-device-overview-grid');
    expect(screen.queryByTestId('agent-device-overview-card')).not.toBeInTheDocument();
    expect(screen.getByTestId('runtime-local-status')).toBeInTheDocument();
    expect(overviewGrid).not.toHaveClass('lg:grid-cols-2');
  });

  it('promotes node-first sections and pairing entry in device view（设备页主路径切到节点视角并上浮配对入口）', async () => {
    hosts = [
      {
        id: 'runtime-host-discovered',
        name: 'Candidate Phone',
        host: '192.168.1.23',
        port: 9124,
        status: 'unknown',
        createdAt: '2026-02-27T10:00:00.000Z',
        updatedAt: '2026-02-27T10:00:00.000Z',
        trustState: 'discovered_candidate',
      },
      {
        id: 'runtime-host-confirmed',
        name: 'Paired Laptop',
        host: '192.168.1.24',
        port: 9124,
        status: 'unknown',
        createdAt: '2026-02-27T10:01:00.000Z',
        updatedAt: '2026-02-27T10:01:00.000Z',
        trustState: 'confirmed_peer',
        hostId: 'paired-laptop-host',
        lastSuccessfulDialAddress: '192.168.1.24:9124',
      },
      {
        id: 'runtime-host-manual',
        name: 'Legacy Bridge',
        host: '10.9.0.8',
        port: 2999,
        status: 'unknown',
        createdAt: '2026-02-27T10:02:00.000Z',
        updatedAt: '2026-02-27T10:02:00.000Z',
        trustState: 'manual_seed',
        manualOverride: '10.9.0.8:2999',
      },
    ];
    hostState = {
      'runtime-host-discovered': 'online',
      'runtime-host-confirmed': 'online',
      'runtime-host-manual': 'offline',
    };

    runtimeControlMocks.getStatus.mockResolvedValueOnce({
      running: true,
      host: '127.0.0.1',
      port: DEFAULT_EMBEDDED_RUNTIME_PORT,
      hostId: 'desktop-local-host',
      authSecret: 'embedded-secret',
      pid: 9527,
    });

    render(<AgentsPage />);
    fireEvent.click(await screen.findByTestId('agent-view-toggle-device'));

    await waitFor(() => {
      expect(screen.getByText('我的节点')).toBeInTheDocument();
      expect(screen.getByText('已发现节点')).toBeInTheDocument();
      expect(screen.getByText('已确认节点')).toBeInTheDocument();
      expect(screen.getByText('高级 / 兼容模式')).toBeInTheDocument();
    });

    expect(
      within(screen.getByTestId('runtime-peer-section-discovered'))
        .getByTestId('runtime-host-device-card-runtime-host-discovered'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('runtime-peer-section-confirmed'))
        .getByTestId('runtime-host-device-card-runtime-host-confirmed'),
    ).toBeInTheDocument();
    expect(within(screen.getByTestId('runtime-peer-section-confirmed')).getByText('复制状态')).toBeInTheDocument();
    expect(within(screen.getByTestId('runtime-peer-section-confirmed')).getByText('已连接')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('runtime-peer-section-advanced'))
        .getByTestId('runtime-host-device-card-runtime-host-manual'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('device-open-peer-pairing'));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '设备配对' })).toBeInTheDocument();
    });
  });

  it('shows confirmed peer verification status and supports manual connectivity test（已确认节点展示验证状态并支持手动测试互联）', async () => {
    hosts = [
      {
        id: 'runtime-host-confirmed',
        name: 'Paired Laptop',
        host: '192.168.1.24',
        port: 9124,
        status: 'unknown',
        createdAt: '2026-03-30T10:00:00.000Z',
        updatedAt: '2026-03-30T10:00:00.000Z',
        trustState: 'confirmed_peer',
        hostId: 'paired-laptop-host',
        lastSuccessfulDialAddress: '192.168.1.24:9124',
      },
    ];
    hostState = {
      'runtime-host-confirmed': 'online',
    };
    runtimeControlMocks.getStatus.mockResolvedValue({
      running: true,
      host: '0.0.0.0',
      port: DEFAULT_EMBEDDED_RUNTIME_PORT,
      hostId: 'desktop-local-host',
      authSecret: 'embedded-secret',
      pid: 9527,
    });
    runtimeLinkProofMocks.runVerification.mockImplementation(async (input: Record<string, unknown>) => {
      await runtimeHostServiceMocks.mergeHostMetadata(input.runtimeHostRecordId as string, {
        verificationStatus: 'verified',
        lastVerifiedAt: '2026-03-30T10:03:00.000Z',
        lastVerificationTrigger: 'manual_retry',
        localInitiatedRttMs: 41,
        peerInitiatedRttMs: 56,
        lastVerificationError: null,
      });
      return {
        status: 'verified',
        proofSessionId: 'proof-session-1',
        localInitiatedRttMs: 41,
        peerInitiatedRttMs: 56,
        completedAt: '2026-03-30T10:03:00.000Z',
      };
    });

    const view = render(<AgentsPage />);
    fireEvent.click(await screen.findByTestId('agent-view-toggle-device'));

    await waitFor(() => {
      expect(screen.getByTestId('runtime-local-status')).toHaveTextContent('running');
    });
    expect(screen.getByTestId('runtime-local-host-id')).toHaveTextContent('desktop-local-host');
    expect(runtimeControlMocks.startRuntime).not.toHaveBeenCalled();

    const confirmedSection = await screen.findByTestId('runtime-peer-section-confirmed');
    expect(within(confirmedSection).getByText('未验证互通')).toBeInTheDocument();
    expect(within(confirmedSection).getByText('在线 ≠ 已验证')).toBeInTheDocument();

    fireEvent.click(within(confirmedSection).getByTestId('runtime-host-verify-runtime-host-confirmed'));

    await waitFor(() => {
      expect(runtimeLinkProofMocks.runVerification).toHaveBeenCalledWith({
        mode: 'owner',
        localPeerId: 'desktop-local-host',
        peerId: 'paired-laptop-host',
        runtimeHostRecordId: 'runtime-host-confirmed',
        trigger: 'manual_retry',
      });
    });

    await waitFor(() => {
      expect(within(confirmedSection).getByText('已验证互通')).toBeInTheDocument();
      expect(within(confirmedSection).getByText('本端 RTT 41 ms')).toBeInTheDocument();
      expect(within(confirmedSection).getByText('对端 RTT 56 ms')).toBeInTheDocument();
    });

    view.unmount();
    render(<AgentsPage />);
    fireEvent.click(await screen.findByTestId('agent-view-toggle-device'));

    const restoredSection = await screen.findByTestId('runtime-peer-section-confirmed');
    await waitFor(() => {
      expect(within(restoredSection).getByText('已验证互通')).toBeInTheDocument();
      expect(within(restoredSection).getByText('本端 RTT 41 ms')).toBeInTheDocument();
      expect(within(restoredSection).getByText('对端 RTT 56 ms')).toBeInTheDocument();
    });
  });

  it('prefers live topology host_id for manual connectivity test（手动测试互联优先使用 live topology host_id）', async () => {
    hosts = [
      {
        id: 'runtime-host-confirmed',
        name: 'Paired Laptop',
        host: '192.168.1.24',
        port: 9124,
        status: 'unknown',
        createdAt: '2026-03-30T10:00:00.000Z',
        updatedAt: '2026-03-30T10:00:00.000Z',
        trustState: 'confirmed_peer',
        hostId: 'paired-laptop-host-stale',
        lastSuccessfulDialAddress: '192.168.1.24:9124',
      },
    ];
    hostState = {
      'runtime-host-confirmed': 'online',
    };
    topologyByHostId = {
      'runtime-host-confirmed': {
        runtime_host: {
          host_id: 'paired-laptop-host-live',
          hostname: 'paired-laptop-runtime',
          os: 'Windows 11',
          arch: 'x86_64',
          uptime_secs: 3600,
          version: '0.1.0',
          port: 9124,
          capabilities: {
            agent_kinds: ['api'],
            api_providers: ['openai'],
          },
        },
        device: {
          id: 'paired-laptop-host-live',
          name: 'Paired Laptop',
          kind: 'laptop',
          primary_runtime_host_id: 'paired-laptop-host-live',
        },
        device_components: [],
        device_links: [],
      },
    };
    runtimeControlMocks.getStatus.mockResolvedValue({
      running: true,
      host: '0.0.0.0',
      port: DEFAULT_EMBEDDED_RUNTIME_PORT,
      hostId: 'desktop-local-host',
      authSecret: 'embedded-secret',
      pid: 9527,
    });
    runtimeLinkProofMocks.runVerification.mockResolvedValue({
      status: 'verified',
      proofSessionId: 'proof-session-live',
      localInitiatedRttMs: 19,
      peerInitiatedRttMs: 28,
      completedAt: '2026-03-30T10:03:00.000Z',
    });

    render(<AgentsPage />);
    fireEvent.click(await screen.findByTestId('agent-view-toggle-device'));

    const confirmedSection = await screen.findByTestId('runtime-peer-section-confirmed');
    fireEvent.click(within(confirmedSection).getByTestId('runtime-host-verify-runtime-host-confirmed'));

    await waitFor(() => {
      expect(runtimeLinkProofMocks.runVerification).toHaveBeenCalledWith({
        mode: 'owner',
        localPeerId: 'desktop-local-host',
        peerId: 'paired-laptop-host-live',
        runtimeHostRecordId: 'runtime-host-confirmed',
        trigger: 'manual_retry',
      });
    });
  });

  it('shows verification failure with connection state priority（在线与验证失败并存时优先展示互通失败）', async () => {
    hosts = [
      {
        id: 'runtime-host-confirmed',
        name: 'Paired Laptop',
        host: '192.168.1.24',
        port: 9124,
        status: 'unknown',
        createdAt: '2026-03-30T10:00:00.000Z',
        updatedAt: '2026-03-30T10:00:00.000Z',
        trustState: 'confirmed_peer',
        hostId: 'paired-laptop-host',
        lastSuccessfulDialAddress: '192.168.1.24:9124',
        verificationStatus: 'failed',
        lastVerificationTrigger: 'manual_retry',
        lastVerificationError: '等待对端验证结果超时',
      },
    ];
    hostState = {
      'runtime-host-confirmed': 'online',
    };
    runtimeControlMocks.getStatus.mockResolvedValue({
      running: true,
      host: '0.0.0.0',
      port: DEFAULT_EMBEDDED_RUNTIME_PORT,
      hostId: 'desktop-local-host',
      authSecret: 'embedded-secret',
      pid: 9527,
    });

    render(<AgentsPage />);
    fireEvent.click(await screen.findByTestId('agent-view-toggle-device'));

    const confirmedSection = await screen.findByTestId('runtime-peer-section-confirmed');
    expect(within(confirmedSection).getByText('online')).toBeInTheDocument();
    expect(within(confirmedSection).getByText('在线，但互通验证失败')).toBeInTheDocument();
    expect(within(confirmedSection).getByText('等待对端验证结果超时')).toBeInTheDocument();
  });

  it('shows manual connectivity failure result after retry（手动测试互联失败后展示最近错误）', async () => {
    hosts = [
      {
        id: 'runtime-host-confirmed',
        name: 'Paired Laptop',
        host: '192.168.1.24',
        port: 9124,
        status: 'unknown',
        createdAt: '2026-03-30T10:00:00.000Z',
        updatedAt: '2026-03-30T10:00:00.000Z',
        trustState: 'confirmed_peer',
        hostId: 'paired-laptop-host',
        lastSuccessfulDialAddress: '192.168.1.24:9124',
      },
    ];
    hostState = {
      'runtime-host-confirmed': 'online',
    };
    runtimeControlMocks.getStatus.mockResolvedValue({
      running: true,
      host: '0.0.0.0',
      port: DEFAULT_EMBEDDED_RUNTIME_PORT,
      hostId: 'desktop-local-host',
      authSecret: 'embedded-secret',
      pid: 9527,
    });
    runtimeLinkProofMocks.runVerification.mockImplementation(async (input: Record<string, unknown>) => {
      await runtimeHostServiceMocks.mergeHostMetadata(input.runtimeHostRecordId as string, {
        verificationStatus: 'failed',
        lastVerificationTrigger: 'manual_retry',
        lastVerificationError: '等待链路回执超时',
        localInitiatedRttMs: null,
        peerInitiatedRttMs: null,
      });
      return {
        status: 'failed',
        proofSessionId: 'proof-session-2',
        phase: 'waiting_receipt',
        errorMessage: '等待链路回执超时',
      };
    });

    render(<AgentsPage />);
    fireEvent.click(await screen.findByTestId('agent-view-toggle-device'));

    await waitFor(() => {
      expect(screen.getByTestId('runtime-local-status')).toHaveTextContent('running');
    });
    expect(screen.getByTestId('runtime-local-host-id')).toHaveTextContent('desktop-local-host');
    expect(runtimeControlMocks.startRuntime).not.toHaveBeenCalled();

    const confirmedSection = await screen.findByTestId('runtime-peer-section-confirmed');
    fireEvent.click(within(confirmedSection).getByTestId('runtime-host-verify-runtime-host-confirmed'));

    await waitFor(() => {
      expect(within(confirmedSection).getByText('在线，但互通验证失败')).toBeInTheDocument();
      expect(within(confirmedSection).getByText('等待链路回执超时')).toBeInTheDocument();
    });
  });

  it('auto-adopts incoming manual proof request for confirmed peers（收到手动互联请求时自动采用同一验证会话）', async () => {
    hosts = [
      {
        id: 'runtime-host-confirmed',
        name: 'Paired Laptop',
        host: '192.168.1.24',
        port: 9124,
        status: 'unknown',
        createdAt: '2026-03-30T10:00:00.000Z',
        updatedAt: '2026-03-30T10:00:00.000Z',
        trustState: 'confirmed_peer',
        hostId: 'paired-laptop-host',
        lastSuccessfulDialAddress: '192.168.1.24:9124',
      },
    ];
    hostState = {
      'runtime-host-confirmed': 'online',
    };
    runtimeControlMocks.getStatus.mockResolvedValue({
      running: true,
      host: '0.0.0.0',
      port: DEFAULT_EMBEDDED_RUNTIME_PORT,
      hostId: 'desktop-local-host',
      authSecret: 'embedded-secret',
      pid: 9527,
    });
    runtimeLinkProofMocks.runVerification.mockResolvedValue({
      status: 'verified',
      proofSessionId: 'proof-session-remote',
      localInitiatedRttMs: 21,
      peerInitiatedRttMs: 34,
      completedAt: '2026-03-30T10:05:00.000Z',
    });

    render(<AgentsPage />);
    fireEvent.click(await screen.findByTestId('agent-view-toggle-device'));

    await waitFor(() => {
      expect(screen.getByTestId('runtime-local-status')).toHaveTextContent('running');
      expect(signalStreamMocks.start).toHaveBeenCalled();
    });

    act(() => {
      signalStreamMocks.emit({
        schema_version: 1,
        id: 'evt-remote-manual-proof',
        topic: 'system.link_proof.request',
        ts: 1710000000000,
        source: 'ui:test',
        origin_host_id: 'paired-laptop-host',
        hop: 1,
        payload: {
          proof_session_id: 'proof-session-remote',
          attempt_id: 'attempt-remote',
          initiated_by_peer_id: 'paired-laptop-host',
          target_peer_id: 'desktop-local-host',
          trigger: 'manual_retry',
          sent_at_ms: 1710000000000,
        },
      });
      signalStreamMocks.emit({
        schema_version: 1,
        id: 'evt-remote-manual-proof',
        topic: 'system.link_proof.request',
        ts: 1710000000000,
        source: 'ui:test',
        origin_host_id: 'paired-laptop-host',
        hop: 1,
        payload: {
          proof_session_id: 'proof-session-remote',
          attempt_id: 'attempt-remote',
          initiated_by_peer_id: 'paired-laptop-host',
          target_peer_id: 'desktop-local-host',
          trigger: 'manual_retry',
          sent_at_ms: 1710000000000,
        },
      });
    });

    await waitFor(() => {
      expect(runtimeLinkProofMocks.runVerification).toHaveBeenCalledTimes(1);
      expect(runtimeLinkProofMocks.runVerification).toHaveBeenCalledWith({
        mode: 'joiner',
        localPeerId: 'desktop-local-host',
        peerId: 'paired-laptop-host',
        runtimeHostRecordId: 'runtime-host-confirmed',
        adoptedRequestEvent: expect.objectContaining({
          id: 'evt-remote-manual-proof',
          topic: 'system.link_proof.request',
        }),
        trigger: 'manual_retry',
      });
    });
  });

  it('auto-adopts by live topology host_id when stored peer id is stale（自动 adopt 应匹配 live topology host_id）', async () => {
    hosts = [
      {
        id: 'runtime-host-confirmed',
        name: 'Paired Laptop',
        host: '192.168.1.24',
        port: 9124,
        status: 'unknown',
        createdAt: '2026-03-30T10:00:00.000Z',
        updatedAt: '2026-03-30T10:00:00.000Z',
        trustState: 'confirmed_peer',
        hostId: 'paired-laptop-host-stale',
        lastSuccessfulDialAddress: '192.168.1.24:9124',
      },
    ];
    hostState = {
      'runtime-host-confirmed': 'online',
    };
    topologyByHostId = {
      'runtime-host-confirmed': {
        runtime_host: {
          host_id: 'paired-laptop-host-live',
          hostname: 'paired-laptop-runtime',
          os: 'Windows 11',
          arch: 'x86_64',
          uptime_secs: 3600,
          version: '0.1.0',
          port: 9124,
          capabilities: {
            agent_kinds: ['api'],
            api_providers: ['openai'],
          },
        },
        device: {
          id: 'paired-laptop-host-live',
          name: 'Paired Laptop',
          kind: 'laptop',
          primary_runtime_host_id: 'paired-laptop-host-live',
        },
        device_components: [],
        device_links: [],
      },
    };
    runtimeControlMocks.getStatus.mockResolvedValue({
      running: true,
      host: '0.0.0.0',
      port: DEFAULT_EMBEDDED_RUNTIME_PORT,
      hostId: 'desktop-local-host',
      authSecret: 'embedded-secret',
      pid: 9527,
    });
    runtimeLinkProofMocks.runVerification.mockResolvedValue({
      status: 'verified',
      proofSessionId: 'proof-session-live',
      localInitiatedRttMs: 21,
      peerInitiatedRttMs: 34,
      completedAt: '2026-03-30T10:05:00.000Z',
    });

    render(<AgentsPage />);
    fireEvent.click(await screen.findByTestId('agent-view-toggle-device'));

    await waitFor(() => {
      expect(screen.getByTestId('runtime-local-status')).toHaveTextContent('running');
    });

    act(() => {
      signalStreamMocks.emit({
        schema_version: 1,
        id: 'evt-remote-manual-proof-live-topology',
        topic: 'system.link_proof.request',
        ts: 1710000000000,
        source: 'ui:test',
        origin_host_id: 'paired-laptop-host-live',
        hop: 1,
        payload: {
          proof_session_id: 'proof-session-live',
          attempt_id: 'attempt-live',
          initiated_by_peer_id: 'paired-laptop-host-live',
          target_peer_id: 'desktop-local-host',
          trigger: 'manual_retry',
          sent_at_ms: 1710000000000,
        },
      });
    });

    await waitFor(() => {
      expect(runtimeLinkProofMocks.runVerification).toHaveBeenCalledTimes(1);
      expect(runtimeLinkProofMocks.runVerification).toHaveBeenCalledWith({
        mode: 'joiner',
        localPeerId: 'desktop-local-host',
        peerId: 'paired-laptop-host-live',
        runtimeHostRecordId: 'runtime-host-confirmed',
        adoptedRequestEvent: expect.objectContaining({
          id: 'evt-remote-manual-proof-live-topology',
          topic: 'system.link_proof.request',
        }),
        trigger: 'manual_retry',
      });
    });
  });

  it('does not auto-adopt when the same confirmed peer is already verifying（同一 peer 已在验证中时不应再次 adopt）', async () => {
    hosts = [
      {
        id: 'runtime-host-confirmed',
        name: 'Paired Laptop',
        host: '192.168.1.24',
        port: 9124,
        status: 'unknown',
        createdAt: '2026-03-30T10:00:00.000Z',
        updatedAt: '2026-03-30T10:00:00.000Z',
        trustState: 'confirmed_peer',
        hostId: 'paired-laptop-host',
        lastSuccessfulDialAddress: '192.168.1.24:9124',
        verificationStatus: 'running',
        lastVerificationTrigger: 'manual_retry',
      },
    ];
    hostState = {
      'runtime-host-confirmed': 'online',
    };
    runtimeControlMocks.getStatus.mockResolvedValue({
      running: true,
      host: '0.0.0.0',
      port: DEFAULT_EMBEDDED_RUNTIME_PORT,
      hostId: 'desktop-local-host',
      authSecret: 'embedded-secret',
      pid: 9527,
    });

    render(<AgentsPage />);
    fireEvent.click(await screen.findByTestId('agent-view-toggle-device'));

    await waitFor(() => {
      expect(screen.getByTestId('runtime-local-status')).toHaveTextContent('running');
    });

    act(() => {
      signalStreamMocks.emit({
        schema_version: 1,
        id: 'evt-remote-manual-proof-running',
        topic: 'system.link_proof.request',
        ts: 1710000000000,
        source: 'ui:test',
        origin_host_id: 'paired-laptop-host',
        hop: 1,
        payload: {
          proof_session_id: 'proof-session-running',
          attempt_id: 'attempt-running',
          initiated_by_peer_id: 'paired-laptop-host',
          target_peer_id: 'desktop-local-host',
          trigger: 'manual_retry',
          sent_at_ms: 1710000000000,
        },
      });
    });

    await waitFor(() => {
      expect(runtimeLinkProofMocks.runVerification).not.toHaveBeenCalled();
    });
  });

  it('does not auto-adopt a reflected manual proof request while local owner verification is in flight（本地 owner 进行中时不应被反向 request 重入）', async () => {
    hosts = [
      {
        id: 'runtime-host-confirmed',
        name: 'Paired Laptop',
        host: '192.168.1.24',
        port: 9124,
        status: 'unknown',
        createdAt: '2026-03-30T10:00:00.000Z',
        updatedAt: '2026-03-30T10:00:00.000Z',
        trustState: 'confirmed_peer',
        hostId: 'paired-laptop-host',
        lastSuccessfulDialAddress: '192.168.1.24:9124',
      },
    ];
    hostState = {
      'runtime-host-confirmed': 'online',
    };
    runtimeControlMocks.getStatus.mockResolvedValue({
      running: true,
      host: '0.0.0.0',
      port: DEFAULT_EMBEDDED_RUNTIME_PORT,
      hostId: 'desktop-local-host',
      authSecret: 'embedded-secret',
      pid: 9527,
    });

    let resolveOwnerVerification:
      | ((value: {
          status: 'verified';
          proofSessionId: string;
          localInitiatedRttMs: number;
          peerInitiatedRttMs: number;
          completedAt: string;
        }) => void)
      | null = null;

    runtimeLinkProofMocks.runVerification.mockImplementation((input: Record<string, unknown>) => {
      if (input.mode === 'owner') {
        return new Promise((resolve) => {
          resolveOwnerVerification = resolve;
        });
      }

      return Promise.resolve({
        status: 'verified',
        proofSessionId: 'proof-session-remote',
        localInitiatedRttMs: 21,
        peerInitiatedRttMs: 34,
        completedAt: '2026-03-30T10:05:00.000Z',
      });
    });

    render(<AgentsPage />);
    fireEvent.click(await screen.findByTestId('agent-view-toggle-device'));

    const confirmedSection = await screen.findByTestId('runtime-peer-section-confirmed');
    fireEvent.click(within(confirmedSection).getByTestId('runtime-host-verify-runtime-host-confirmed'));

    await waitFor(() => {
      expect(runtimeLinkProofMocks.runVerification).toHaveBeenCalledTimes(1);
      expect(runtimeLinkProofMocks.runVerification).toHaveBeenCalledWith({
        mode: 'owner',
        localPeerId: 'desktop-local-host',
        peerId: 'paired-laptop-host',
        runtimeHostRecordId: 'runtime-host-confirmed',
        trigger: 'manual_retry',
      });
    });

    act(() => {
      signalStreamMocks.emit({
        schema_version: 1,
        id: 'evt-reflected-manual-proof',
        topic: 'system.link_proof.request',
        ts: 1710000001000,
        source: 'ui:test',
        origin_host_id: 'paired-laptop-host',
        hop: 1,
        payload: {
          proof_session_id: 'proof-session-owner',
          attempt_id: 'attempt-reflected',
          initiated_by_peer_id: 'paired-laptop-host',
          target_peer_id: 'desktop-local-host',
          trigger: 'manual_retry',
          sent_at_ms: 1710000001000,
        },
      });
    });

    expect(runtimeLinkProofMocks.runVerification).toHaveBeenCalledTimes(1);
    expect(resolveOwnerVerification).not.toBeNull();

    await act(async () => {
      await runtimeHostServiceMocks.mergeHostMetadata('runtime-host-confirmed', {
        verificationStatus: 'verified',
        lastVerifiedAt: '2026-03-30T10:06:00.000Z',
        lastVerificationTrigger: 'manual_retry',
        localInitiatedRttMs: 18,
        peerInitiatedRttMs: 27,
        lastVerificationError: null,
      });
      resolveOwnerVerification?.({
        status: 'verified',
        proofSessionId: 'proof-session-owner',
        localInitiatedRttMs: 18,
        peerInitiatedRttMs: 27,
        completedAt: '2026-03-30T10:06:00.000Z',
      });
    });

    await waitFor(() => {
      expect(within(confirmedSection).getByText('已验证互通')).toBeInTheDocument();
    });
  });

  it('probes runtime host and updates status badge（探测后更新状态徽标）', async () => {
    render(<AgentsPage />);
    fireEvent.click(await screen.findByTestId('agent-view-toggle-device'));

    await waitFor(() => {
      expect(screen.getByTestId('runtime-host-status-runtime-host-1')).toHaveTextContent('offline');
    });

    fireEvent.click(screen.getByTestId('runtime-host-probe-runtime-host-1'));

    await waitFor(() => {
      expect(runtimeManagerMocks.retryHost).toHaveBeenCalledWith('runtime-host-1');
      expect(screen.getByTestId('runtime-host-status-runtime-host-1')).toHaveTextContent('online');
    });
  });

  it('starts and stops local runtime from device panel（设备页可启停本地 Runtime）', async () => {
    render(<AgentsPage />);
    fireEvent.click(await screen.findByTestId('agent-view-toggle-device'));

    await waitFor(() => {
      expect(screen.getByTestId('runtime-local-status')).toHaveTextContent('stopped');
      expect(screen.getByTestId('runtime-network-mode-local')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByTestId('runtime-local-bind-address')).toHaveTextContent(
        `127.0.0.1:${DEFAULT_EMBEDDED_RUNTIME_PORT}`,
      );
    });

    fireEvent.click(screen.getByTestId('runtime-local-start-button'));
    await waitFor(() => {
      expect(runtimeControlMocks.startRuntime).toHaveBeenCalledWith({
        host: '127.0.0.1',
        port: DEFAULT_EMBEDDED_RUNTIME_PORT,
      });
      expect(screen.getByTestId('runtime-local-status')).toHaveTextContent('running');
    });

    fireEvent.click(screen.getByTestId('runtime-local-stop-button'));
    await waitFor(() => {
      expect(runtimeControlMocks.stopRuntime).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('runtime-local-status')).toHaveTextContent('stopped');
    });
  });

  it('starts local runtime in lan bind mode（LAN 模式应监听 0.0.0.0 供手机连接）', async () => {
    runtimeControlMocks.startRuntime.mockResolvedValueOnce({
      running: true,
      host: '0.0.0.0',
      port: DEFAULT_EMBEDDED_RUNTIME_PORT,
      pid: 9527,
    });

    render(<AgentsPage />);
    fireEvent.click(await screen.findByTestId('agent-view-toggle-device'));

    await waitFor(() => {
      expect(screen.getByTestId('runtime-local-status')).toHaveTextContent('stopped');
    });

    fireEvent.click(screen.getByTestId('runtime-network-mode-lan'));

    await waitFor(() => {
      expect(screen.getByTestId('runtime-network-mode-lan')).toHaveAttribute('aria-pressed', 'true');
      expect(window.localStorage.getItem(EMBEDDED_RUNTIME_NETWORK_MODE_STORAGE_KEY)).toBe('lan');
      expect(screen.getByTestId('runtime-local-bind-address')).toHaveTextContent(
        `0.0.0.0:${DEFAULT_EMBEDDED_RUNTIME_PORT}`,
      );
      expect(screen.getByTestId('runtime-local-share-hint')).toHaveTextContent('局域网 IP');
    });

    fireEvent.click(screen.getByTestId('runtime-local-start-button'));

    await waitFor(() => {
      expect(runtimeControlMocks.startRuntime).toHaveBeenCalledWith({
        host: '0.0.0.0',
        port: DEFAULT_EMBEDDED_RUNTIME_PORT,
      });
      expect(screen.getByTestId('runtime-local-status')).toHaveTextContent('running');
    });
  });

  it('rebinds a running localhost runtime into lan mode（已运行的 localhost Runtime 可切换为 LAN 监听）', async () => {
    runtimeControlMocks.getStatus.mockResolvedValueOnce({
      running: true,
      host: '127.0.0.1',
      port: DEFAULT_EMBEDDED_RUNTIME_PORT,
      pid: 9527,
    });
    runtimeControlMocks.startRuntime.mockResolvedValueOnce({
      running: true,
      host: '0.0.0.0',
      port: DEFAULT_EMBEDDED_RUNTIME_PORT,
      pid: 9527,
    });

    render(<AgentsPage />);
    fireEvent.click(await screen.findByTestId('agent-view-toggle-device'));

    await waitFor(() => {
      expect(screen.getByTestId('runtime-local-status')).toHaveTextContent('running');
      expect(screen.getByTestId('runtime-local-bind-address')).toHaveTextContent(
        `127.0.0.1:${DEFAULT_EMBEDDED_RUNTIME_PORT}`,
      );
    });

    fireEvent.click(screen.getByTestId('runtime-network-mode-lan'));

    await waitFor(() => {
      expect(screen.getByTestId('runtime-local-bind-address')).toHaveTextContent(
        `0.0.0.0:${DEFAULT_EMBEDDED_RUNTIME_PORT}`,
      );
    });

    await waitFor(() => {
      expect(runtimeControlMocks.startRuntime).toHaveBeenCalledWith({
        host: '0.0.0.0',
        port: DEFAULT_EMBEDDED_RUNTIME_PORT,
      });
    });
  });

  it('falls back to default embedded port when stopped status has no cached runtime（停止态且无缓存时回退默认端口）', async () => {
    runtimeControlMocks.getStatus.mockResolvedValueOnce({
      running: false,
      host: '127.0.0.1',
      port: 1950,
    });

    render(<AgentsPage />);
    fireEvent.click(await screen.findByTestId('agent-view-toggle-device'));

    await waitFor(() => {
      expect(screen.getByTestId('runtime-local-status')).toHaveTextContent('stopped');
    });

    fireEvent.click(screen.getByTestId('runtime-local-start-button'));
    await waitFor(() => {
      expect(runtimeControlMocks.startRuntime).toHaveBeenCalledWith({
        host: '127.0.0.1',
        port: DEFAULT_EMBEDDED_RUNTIME_PORT,
      });
    });
  });

  it('auto-rebinds persisted lan mode on page load（页面加载时自动把已持久化的 LAN 模式重绑到运行中的 RT）', async () => {
    window.localStorage.setItem(EMBEDDED_RUNTIME_NETWORK_MODE_STORAGE_KEY, 'lan');

    runtimeControlMocks.getStatus.mockResolvedValueOnce({
      running: true,
      host: '127.0.0.1',
      port: DEFAULT_EMBEDDED_RUNTIME_PORT,
      pid: 9527,
    });
    runtimeControlMocks.startRuntime.mockResolvedValueOnce({
      running: true,
      host: '0.0.0.0',
      port: DEFAULT_EMBEDDED_RUNTIME_PORT,
      pid: 9527,
    });

    render(<AgentsPage />);
    fireEvent.click(await screen.findByTestId('agent-view-toggle-device'));

    await waitFor(() => {
      expect(runtimeControlMocks.startRuntime).toHaveBeenCalledWith({
        host: '0.0.0.0',
        port: DEFAULT_EMBEDDED_RUNTIME_PORT,
      });
    });
  });

  it('replays confirmed peers into fresh local mesh after refresh（页面刷新后会把 confirmed peer 回放进本地 mesh）', async () => {
    hosts = [
      {
        id: 'runtime-host-phone',
        name: 'Paired Phone',
        host: '10.0.2.15',
        port: 9124,
        status: 'unknown',
        createdAt: '2026-03-30T10:00:00.000Z',
        updatedAt: '2026-03-30T10:00:00.000Z',
        trustState: 'confirmed_peer',
        hostId: 'paired-phone-host',
        manualOverride: '127.0.0.1:39124',
        lastSuccessfulDialAddress: '127.0.0.1:39124',
      },
    ];
    hostState = {
      'runtime-host-phone': 'online',
    };

    runtimeControlMocks.getStatus.mockResolvedValueOnce({
      running: true,
      host: '0.0.0.0',
      port: DEFAULT_EMBEDDED_RUNTIME_PORT,
      hostId: 'desktop-local-host',
      authSecret: 'embedded-secret',
      pid: 9527,
    });

    render(<AgentsPage />);
    fireEvent.click(await screen.findByTestId('agent-view-toggle-device'));

    await waitFor(() => {
      expect(runtimeMeshSyncMocks.ensurePeerPair).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'runtime-host-phone',
          hostId: 'paired-phone-host',
          trustState: 'confirmed_peer',
          lastSuccessfulDialAddress: '127.0.0.1:39124',
        }),
      );
    });
  });

  it('switches runtime target to external and saves host address（可切换外部 Runtime 并保存地址）', async () => {
    hosts = [
      ...hosts,
      {
        id: 'runtime-host-remote-protected',
        name: 'Protected Runtime',
        host: '10.9.0.8',
        port: 2999,
        status: 'unknown',
        createdAt: '2026-02-27T10:05:00.000Z',
        updatedAt: '2026-02-27T10:05:00.000Z',
      },
    ];

    render(<AgentsPage />);
    fireEvent.click(await screen.findByTestId('agent-view-toggle-device'));

    await waitFor(() => {
      expect(screen.getByTestId('runtime-target-mode-embedded')).toHaveAttribute('aria-pressed', 'true');
    });

    fireEvent.click(screen.getByTestId('runtime-target-mode-external'));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('runtime_target_mode_set', { mode: 'external' });
      expect(runtimeControlMocks.stopRuntime).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('runtime-target-mode-external')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByTestId('runtime-local-start-button')).toBeDisabled();
    });

    fireEvent.change(screen.getByTestId('runtime-target-external-address-input'), {
      target: { value: '10.9.0.8:2999' },
    });
    fireEvent.change(screen.getByTestId('runtime-target-external-auth-token-input'), {
      target: { value: 'Bearer external-admin-token' },
    });
    fireEvent.click(screen.getByTestId('runtime-target-external-apply-button'));

    await waitFor(() => {
      expect(window.localStorage.getItem('exomind:runtimeExternalAddress')).toBe('10.9.0.8:2999');
      expect(window.localStorage.getItem('exomind:runtimeExternalAuthToken')).toBe('external-admin-token');
      expect(window.localStorage.getItem('exomind:runtimeTargetMode')).toBe('external');
      expect(runtimeHostServiceMocks.mergeHostMetadata).toHaveBeenCalledWith('runtime-host-remote-protected', {
        authToken: 'external-admin-token',
      });
    });
  });
});
