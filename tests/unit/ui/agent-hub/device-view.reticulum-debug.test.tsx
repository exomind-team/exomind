import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DeviceView } from '@/ui/app/pages/agents/DeviceView';
import type { EnsTransportSnapshot } from '@/lib/services/runtime-ens.service';

const runtimeEnsMocks = vi.hoisted(() => ({
  getSnapshot: vi.fn(),
  setInterfaceTopology: vi.fn(),
  setGlobalTopology: vi.fn(),
  initiatePairingWithDiscoveredPeer: vi.fn(),
}));

vi.mock('@/lib/services/runtime-ens.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/runtime-ens.service')>();
  return {
    ...actual,
    getRuntimeEnsService: () => runtimeEnsMocks,
  };
});

function renderDeviceView(runtimeRunning = true) {
  return render(
    <DeviceView
      groups={[]}
      runtimeDeviceSnapshots={[]}
      runtimeHostSnapshots={[]}
      runtimeServiceStatus={runtimeRunning
        ? {
            running: true,
            host: '0.0.0.0',
            port: 9124,
            hostId: 'local-host',
          }
        : {
            running: false,
            host: '127.0.0.1',
            port: 9124,
          }}
      peerConnectivityDrafts={{}}
      peerConnectivityPendingHostIds={[]}
      syncAutomationEnabled
      runtimeHostError=""
      embeddedRuntimeNetworkMode="lan"
      embeddedRuntimeBindAddress="0.0.0.0:9124"
      runtimeNeedsRebind={false}
      runtimeTargetMode="embedded"
      runtimeTargetAddress="127.0.0.1:9124"
      runtimeTargetError=""
      runtimeExternalAddressDraft=""
      runtimeExternalAuthTokenDraft=""
      onSyncAutomationEnabledChange={vi.fn(async () => undefined)}
      onRuntimeHostProbe={vi.fn(async () => undefined)}
      onVerifyPeer={vi.fn(async () => undefined)}
      onTogglePeerConnectivity={vi.fn(async () => undefined)}
      onEmbeddedRuntimeNetworkModeChange={vi.fn()}
      onRuntimeStart={vi.fn(async () => undefined)}
      onRuntimeStop={vi.fn(async () => undefined)}
      onRuntimeTargetModeChange={vi.fn()}
      onRuntimeExternalAddressDraftChange={vi.fn()}
      onRuntimeExternalAuthTokenDraftChange={vi.fn()}
      onApplyRuntimeExternalAddress={vi.fn()}
      onOpenHostManager={vi.fn()}
      onOpenPeerPairing={vi.fn()}
    />,
  );
}

function snapshotWithTopology(
  topology: 'off' | 'passive' | 'active',
  globalTopology: 'off' | 'passive' | 'active' = 'active',
  effectiveTopology: 'off' | 'passive' | 'active' = topology,
): EnsTransportSnapshot {
  return {
    enabled: true,
    provider_id: 'fake-ens',
    global_topology: globalTopology,
    health: { status: 'healthy' },
    interfaces: [{
      name: 'lan-udp',
      type: 'udp',
      online: true,
      outgoing: true,
      topology,
      effective_topology: effectiveTopology,
    }],
    peers: [{
      identity: {
        identity_hex: 'identity-b',
        host_id: 'rt-b',
      },
      endpoint: {
        identity_hex: 'identity-b',
        host_id: 'rt-b',
        gateway: 'reticulum',
        via_interface: 'lan-udp',
        via_medium: 'udp',
        runtime_base_url: 'http://192.168.1.20:9124',
        reticulum_destination: 'ret-destination-b',
        interface_address: 'udp://192.168.1.20:4242',
        discovery_source: 'fake-provider',
        capabilities: ['ens-control'],
      },
      authorized: false,
      pairing_pending: false,
    }],
    operations: [],
    updated_at: '2026-06-08T00:00:00Z',
  };
}

describe('DeviceView Reticulum debug panel（设备页 Reticulum 调试面板）', () => {
  it('shows ENS snapshot and updates interface topology（展示 ENS 快照并调整接口 topology）', async () => {
    let currentSnapshot = snapshotWithTopology('active');
    runtimeEnsMocks.getSnapshot.mockImplementation(async () => currentSnapshot);
    runtimeEnsMocks.setInterfaceTopology.mockImplementation(async () => {
      currentSnapshot = snapshotWithTopology('passive');
      return currentSnapshot.interfaces[0];
    });
    runtimeEnsMocks.setGlobalTopology.mockReset();
    runtimeEnsMocks.initiatePairingWithDiscoveredPeer.mockReset();

    renderDeviceView();

    const panel = await screen.findByTestId('reticulum-debug-panel');
    expect(within(panel).getByTestId('reticulum-provider-id')).toHaveTextContent('fake-ens');
    expect(within(panel).getByTestId('reticulum-health-status')).toHaveTextContent('健康');
    expect(within(panel).getByTestId('reticulum-global-topology-status')).toHaveTextContent('Active');
    expect(within(panel).getByTestId('reticulum-global-topology-active')).toHaveAttribute('aria-pressed', 'true');
    expect(within(panel).getByTestId('reticulum-interface-lan-udp-active')).toHaveAttribute('aria-pressed', 'true');
    expect(within(panel).getByTestId('reticulum-interface-lan-udp-configured')).toHaveTextContent('Active');
    expect(within(panel).getByTestId('reticulum-interface-lan-udp-effective')).toHaveTextContent('Active');
    expect(within(panel).getByTestId('reticulum-peer-identity-b')).toBeInTheDocument();
    expect(within(panel).getByTestId('reticulum-peer-identity-b-endpoint')).toHaveTextContent(
      'Reticulum via lan-udp / UDP',
    );

    fireEvent.click(within(panel).getByTestId('reticulum-interface-lan-udp-passive'));

    await waitFor(() => {
      expect(runtimeEnsMocks.setInterfaceTopology).toHaveBeenCalledWith(
        'http://127.0.0.1:9124',
        'lan-udp',
        'passive',
      );
      expect(within(panel).getByTestId('reticulum-interface-lan-udp-passive')).toHaveAttribute('aria-pressed', 'true');
      expect(within(panel).getByTestId('reticulum-interface-lan-udp-configured')).toHaveTextContent('Passive');
      expect(within(panel).getByTestId('reticulum-interface-lan-udp-effective')).toHaveTextContent('Passive');
    });
  });

  it('shows global topology as a limit and does not optimistically flip UI（展示全局上限且不做乐观呈现）', async () => {
    let currentSnapshot = snapshotWithTopology('active', 'active', 'active');
    let resolveSetGlobal: (() => void) | null = null;
    runtimeEnsMocks.getSnapshot.mockImplementation(async () => currentSnapshot);
    runtimeEnsMocks.setGlobalTopology.mockImplementation(
      async () =>
        new Promise((resolve) => {
          resolveSetGlobal = () => {
            currentSnapshot = snapshotWithTopology('active', 'passive', 'passive');
            resolve(currentSnapshot);
          };
        }),
    );
    runtimeEnsMocks.setInterfaceTopology.mockReset();
    runtimeEnsMocks.initiatePairingWithDiscoveredPeer.mockReset();

    renderDeviceView();

    const panel = await screen.findByTestId('reticulum-debug-panel');
    fireEvent.click(within(panel).getByTestId('reticulum-global-topology-passive'));

    expect(runtimeEnsMocks.setGlobalTopology).toHaveBeenCalledWith(
      'http://127.0.0.1:9124',
      'passive',
    );
    expect(within(panel).getByTestId('reticulum-global-topology-active')).toHaveAttribute('aria-pressed', 'true');
    expect(within(panel).getByTestId('reticulum-global-topology-passive')).toHaveAttribute('aria-pressed', 'false');
    expect(within(panel).getByTestId('reticulum-interface-lan-udp-configured')).toHaveTextContent('Active');
    expect(within(panel).getByTestId('reticulum-interface-lan-udp-effective')).toHaveTextContent('Active');

    resolveSetGlobal?.();

    await waitFor(() => {
      expect(within(panel).getByTestId('reticulum-global-topology-status')).toHaveTextContent('Passive');
      expect(within(panel).getByTestId('reticulum-global-topology-passive')).toHaveAttribute('aria-pressed', 'true');
      expect(within(panel).getByTestId('reticulum-interface-lan-udp-configured')).toHaveTextContent('Active');
      expect(within(panel).getByTestId('reticulum-interface-lan-udp-effective')).toHaveTextContent('Passive');
    });
  });

  it('starts pairing from discovered ENS peer（可从发现的 ENS peer 发起配对）', async () => {
    runtimeEnsMocks.getSnapshot.mockResolvedValue(snapshotWithTopology('active'));
    runtimeEnsMocks.initiatePairingWithDiscoveredPeer.mockResolvedValue({
      operation_id: 'op-1',
      session_id: 'session-1',
      pin: '123456',
      status: 'pending',
    });

    renderDeviceView();

    const panel = await screen.findByTestId('reticulum-debug-panel');
    fireEvent.click(within(panel).getByTestId('reticulum-peer-pair-identity-b'));

    await waitFor(() => {
      expect(runtimeEnsMocks.initiatePairingWithDiscoveredPeer).toHaveBeenCalledWith(
        'http://127.0.0.1:9124',
        'identity-b',
      );
    });
  });

  it('does not fetch ENS snapshot when local runtime is stopped（本地 RT 停止时不读取 ENS 快照）', async () => {
    runtimeEnsMocks.getSnapshot.mockReset();

    renderDeviceView(false);

    expect(await screen.findByTestId('reticulum-debug-panel')).toBeInTheDocument();
    expect(screen.getByText('启动本地 embedded RT 后，这里会显示 Reticulum/ENS 调试状态。')).toBeInTheDocument();
    expect(runtimeEnsMocks.getSnapshot).not.toHaveBeenCalled();
  });

  it('keeps device view stable when ENS snapshot is incomplete（ENS 快照不完整时设备页不崩溃）', async () => {
    runtimeEnsMocks.getSnapshot.mockResolvedValue([] as unknown as EnsTransportSnapshot);

    renderDeviceView();

    const panel = await screen.findByTestId('reticulum-debug-panel');
    expect(within(panel).getByTestId('reticulum-health-status')).toHaveTextContent('未启用');
    expect(within(panel).getByText('暂无 ENS interface snapshot。')).toBeInTheDocument();
    expect(within(panel).getByText('暂无 ENS discovered peers。')).toBeInTheDocument();
  });
});
