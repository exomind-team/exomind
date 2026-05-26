import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DeviceView } from '@/ui/app/pages/agents/DeviceView';
import type { RuntimeDeviceSnapshot, RuntimeHostSnapshot } from '@/services/runtime-manager';

function buildNestedSnapshot(): RuntimeHostSnapshot {
  return {
    host: {
      id: 'runtime-host-device-name',
      name: 'Stored Phone',
      host: '192.168.1.66',
      port: 9124,
      status: 'unknown',
      createdAt: '2026-03-30T10:00:00.000Z',
      updatedAt: '2026-03-30T10:00:00.000Z',
      trustState: 'discovered_candidate',
    },
    connectionState: 'online',
    agents: [],
    topology: {
      host_id: 'device-name-host',
      hostname: 'android-hostname',
      os: 'Android',
      arch: 'arm64',
      uptime_secs: 3600,
      version: '0.3.6',
      port: 9124,
      capabilities: {
        agent_kinds: ['api'],
        api_providers: ['openai'],
      },
      runtime_host: {
        host_id: 'device-name-host',
        hostname: 'android-hostname',
        os: 'Android',
        arch: 'arm64',
        uptime_secs: 3600,
        version: '0.3.6',
        port: 9124,
        capabilities: {
          agent_kinds: ['api'],
          api_providers: ['openai'],
        },
      },
      device: {
        id: 'device-name-host',
        name: 'Galaxy S24',
        kind: 'phone',
        primary_runtime_host_id: 'device-name-host',
      },
      device_components: [],
      device_links: [],
    },
    latencyMs: 18,
  };
}

function buildDeviceSnapshot(): RuntimeDeviceSnapshot {
  return {
    id: 'device-name-host',
    name: 'Galaxy S24',
    kind: 'phone',
    primaryRuntimeHostId: 'device-name-host',
    connectionState: 'online',
    hosts: [buildNestedSnapshot()],
    components: [{
      id: 'component-runtime-host',
      device_id: 'device-name-host',
      kind: 'runtime_host',
      name: 'ExoMind Runtime',
      status: 'online',
      runtime_host_id: 'device-name-host',
    }],
    links: [{
      id: 'device-link-runtime-host',
      source_kind: 'device',
      source_id: 'device-name-host',
      target_kind: 'device_component',
      target_id: 'component-runtime-host',
      transport: 'ownership',
      status: 'online',
    }],
  };
}

describe('DeviceView runtime topology selectors（设备页拓扑选择器）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('prefers topology.device.name over legacy hostname（优先显示 topology.device.name）', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const onSyncAutomationEnabledChange = vi.fn(async () => undefined);
    render(
      <DeviceView
        groups={[]}
        runtimeDeviceSnapshots={[buildDeviceSnapshot()]}
        runtimeHostSnapshots={[buildNestedSnapshot()]}
        runtimeServiceStatus={{
          running: true,
          host: '127.0.0.1',
          port: 1949,
          hostId: 'desktop-local-host',
        }}
        peerConnectivityDrafts={{}}
        peerConnectivityPendingHostIds={[]}
        syncAutomationEnabled
        runtimeHostError=""
        embeddedRuntimeNetworkMode="local"
        embeddedRuntimeBindAddress="127.0.0.1:1949"
        runtimeNeedsRebind={false}
        runtimeTargetMode="embedded"
        runtimeTargetAddress="127.0.0.1:1949"
        runtimeTargetError=""
        runtimeExternalAddressDraft=""
        runtimeExternalAuthTokenDraft=""
        onSyncAutomationEnabledChange={onSyncAutomationEnabledChange}
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

    expect(screen.getByText('设备网络视图')).toBeInTheDocument();
    expect(screen.getByTestId('device-sync-automation-switch')).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByTestId('device-sync-automation-switch'));
    expect(onSyncAutomationEnabledChange).toHaveBeenCalledWith(false);
    const discoveredSection = screen.getByTestId('runtime-peer-section-discovered');
    const deviceCard = within(discoveredSection).getByTestId('runtime-host-device-card-runtime-host-device-name');
    expect(within(deviceCard).getAllByText('Galaxy S24')).toHaveLength(2);
    expect(within(deviceCard).getByText('device_id: device-name-host')).toBeInTheDocument();
    expect(within(discoveredSection).getByText('host_id: device-name-host')).toBeInTheDocument();
    expect(within(discoveredSection).getByText('Android')).toBeInTheDocument();
    expect(within(deviceCard).getByText('1 / 1')).toBeInTheDocument();
    expect(within(deviceCard).getByText('links: 1')).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:1949/mesh/ret/peers');
    });
  });

  it('pairs a Reticulum discovered peer from the device view（从设备页配对 Reticulum peer）', async () => {
    const reticulumPeer = {
      host_id: 'ret-peer-host',
      node_name: 'ret-peer-node',
      port: 47388,
      online: true,
      last_seen_ms: Date.now(),
      trust_state: 'Discovered',
      identity_hex: 'ret-identity-0123456789abcdef',
      peer_id: 'ret-identity-0123456789abcdef',
      connection_state: 'connected_unauthorized',
      authorized: false,
      rtt_ms: 12,
    };
    const pairedPeer = {
      ...reticulumPeer,
      trust_state: 'Paired',
      connection_state: 'connected_authorized',
      authorized: true,
    };
    const unpairedPeer = {
      ...reticulumPeer,
      trust_state: 'Discovered',
      connection_state: 'connected_unauthorized',
      authorized: false,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/mesh/ret/peers')) {
        return new Response(JSON.stringify([reticulumPeer]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/initiate-pair')) {
        // Return a generated PIN (mimicking PairingManager.initiate)
        return new Response(JSON.stringify({
          session_id: 'test-session-123',
          pin: '654321',
          peer_id: 'ret-identity-0123456789abcdef',
          peer_host_id: 'ret-peer-host',
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/mesh/ret/peers/ret-identity-0123456789abcdef/pair') && init?.method === 'POST') {
        return new Response(JSON.stringify({
          paired: true,
          peer: pairedPeer,
          peer_state: pairedPeer,
          mesh_peer: {
            id: 'ret-identity-0123456789abcdef',
            host_id: 'ret-identity-0123456789abcdef',
            base_url: 'http://127.0.0.1:47388',
            enabled: true,
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/mesh/ret/peers/ret-identity-0123456789abcdef/pair') && init?.method === 'DELETE') {
        return new Response(JSON.stringify({
          paired: false,
          peer: unpairedPeer,
          peer_state: unpairedPeer,
          mesh_peer: {
            id: 'ret-identity-0123456789abcdef',
            host_id: 'ret-identity-0123456789abcdef',
            base_url: 'http://127.0.0.1:47388',
            enabled: false,
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <DeviceView
        groups={[]}
        runtimeDeviceSnapshots={[]}
        runtimeHostSnapshots={[]}
        runtimeServiceStatus={{
          running: true,
          host: '127.0.0.1',
          port: 1949,
          hostId: 'desktop-local-host',
        }}
        peerConnectivityDrafts={{}}
        peerConnectivityPendingHostIds={[]}
        syncAutomationEnabled
        runtimeHostError=""
        embeddedRuntimeNetworkMode="local"
        embeddedRuntimeBindAddress="127.0.0.1:1949"
        runtimeNeedsRebind={false}
        runtimeTargetMode="embedded"
        runtimeTargetAddress="127.0.0.1:1949"
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

    expect(await screen.findByText('ret-peer-host')).toBeInTheDocument();
    expect(screen.getByText('已连接未授权')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('reticulum-peer-pair-ret-identity-0123456789abcdef'));

    // PIN display dialog should appear (initiator flow — shows generated PIN)
    expect(await screen.findByText('配对码')).toBeInTheDocument();
    // Verify the PIN digits are rendered
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();

    // Click switch-to-input button to enter responder (PIN input) mode
    fireEvent.click(screen.getByText('我已在他方看到配对码 → 输入配对码'));

    // PIN input dialog should appear
    expect(await screen.findByText('输入 Reticulum PIN')).toBeInTheDocument();

    // Enter PIN digits
    const pinInputs = screen.getAllByDisplayValue('');
    expect(pinInputs.length).toBeGreaterThanOrEqual(6);
    const testPin = '123456';
    for (let i = 0; i < 6; i++) {
      fireEvent.change(pinInputs[i], { target: { value: testPin[i] } });
    }

    // Click confirm button
    fireEvent.click(screen.getByText('确认配对'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:1949/mesh/ret/peers/ret-identity-0123456789abcdef/pair',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    expect(await screen.findByText('已授权')).toBeInTheDocument();
    expect(screen.queryByTestId('reticulum-peer-pair-ret-identity-0123456789abcdef')).not.toBeInTheDocument();
  });
});
