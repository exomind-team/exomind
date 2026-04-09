import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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
  it('prefers topology.device.name over legacy hostname（优先显示 topology.device.name）', () => {
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
        runtimeHostError=""
        embeddedRuntimeNetworkMode="local"
        embeddedRuntimeBindAddress="127.0.0.1:1949"
        runtimeNeedsRebind={false}
        runtimeTargetMode="embedded"
        runtimeTargetAddress="127.0.0.1:1949"
        runtimeTargetError=""
        runtimeExternalAddressDraft=""
        runtimeExternalAuthTokenDraft=""
        onRuntimeHostProbe={vi.fn(async () => undefined)}
        onVerifyPeer={vi.fn(async () => undefined)}
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
    const discoveredSection = screen.getByTestId('runtime-peer-section-discovered');
    const deviceCard = within(discoveredSection).getByTestId('runtime-host-device-card-runtime-host-device-name');
    expect(within(deviceCard).getAllByText('Galaxy S24')).toHaveLength(2);
    expect(within(deviceCard).getByText('device_id: device-name-host')).toBeInTheDocument();
    expect(within(discoveredSection).getByText('host_id: device-name-host')).toBeInTheDocument();
    expect(within(discoveredSection).getByText('Android')).toBeInTheDocument();
    expect(within(deviceCard).getByText('1 / 1')).toBeInTheDocument();
    expect(within(deviceCard).getByText('links: 1')).toBeInTheDocument();
  });
});
