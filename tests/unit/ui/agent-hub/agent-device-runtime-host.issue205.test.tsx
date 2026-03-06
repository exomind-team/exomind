import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AgentsPage } from '@/ui/app/pages/AgentsPage';
import { AGENT_HUB_MOCK_FIXTURE } from '@/lib/adapters/mock/fixtures/agent-hub';
import type { RuntimeHostRecord } from '@/lib/types/agent-hub';
import { DEFAULT_EMBEDDED_RUNTIME_PORT } from '@/config/runtime-target';

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

vi.mock('@/lib/services', () => ({
  getAgentHubService: () => ({
    getTopology: agentHubMocks.getTopology,
    getDeviceView: agentHubMocks.getDeviceView,
  }),
}));

vi.mock('@/services/runtime-manager', () => ({
  getRuntimeManager: () => runtimeManagerMocks,
  findPreferredRuntimeHostForAgent: vi.fn(() => null),
}));

vi.mock('@/lib/services/runtime-control.service', () => ({
  getRuntimeControlService: () => runtimeControlMocks,
}));

describe('agent device runtime host issue-205（设备页 RuntimeHost 管理）', () => {
  let hosts: RuntimeHostRecord[];
  let hostState: Record<string, 'online' | 'offline' | 'error'>;

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
            }
          : null,
      latencyMs: hostState[host.id] === 'online' ? 15 : undefined,
      error: hostState[host.id] === 'offline' ? 'ECONNREFUSED' : undefined,
    })),
  });

  beforeEach(() => {
    window.localStorage.clear();

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
      const port = Number.parseInt(portRaw ?? '0', 10);
      const added: RuntimeHostRecord = {
        id: 'runtime-host-2',
        name: name || `${host}:${port}`,
        host: host ?? '',
        port,
        status: 'unknown',
        createdAt: '2026-02-27T10:01:00.000Z',
        updatedAt: '2026-02-27T10:01:00.000Z',
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
  });

  it('opens manager sheet from device view and adds runtime host（设备页可打开主机管理并新增 RuntimeHost）', async () => {
    render(<AgentsPage />);
    fireEvent.click(await screen.findByRole('button', { name: '设备' }));

    await waitFor(() => {
      expect(screen.getByTestId('runtime-host-panel')).toBeInTheDocument();
      expect(screen.getByText('Hope Desktop')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('runtime-host-manage-button'));
    await waitFor(() => {
      expect(screen.getByTestId('agent-host-manager-sheet')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('runtime-host-name-input'), { target: { value: 'LAN Runner' } });
    fireEvent.change(screen.getByTestId('runtime-host-address-input'), { target: { value: '192.168.1.33:9001' } });
    fireEvent.click(screen.getByTestId('runtime-host-add-button'));

    await waitFor(() => {
      expect(runtimeManagerMocks.addHostFromAddress).toHaveBeenCalledWith('192.168.1.33:9001', 'LAN Runner');
      expect(screen.getAllByText('LAN Runner').length).toBeGreaterThan(0);
    });
  });

  it('probes runtime host and updates status badge（探测后更新状态徽标）', async () => {
    render(<AgentsPage />);
    fireEvent.click(await screen.findByRole('button', { name: '设备' }));

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
    fireEvent.click(await screen.findByRole('button', { name: '设备' }));

    await waitFor(() => {
      expect(screen.getByTestId('runtime-local-status')).toHaveTextContent('stopped');
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

  it('switches runtime target to external and saves host address（可切换外部 Runtime 并保存地址）', async () => {
    render(<AgentsPage />);
    fireEvent.click(await screen.findByRole('button', { name: '设备' }));

    await waitFor(() => {
      expect(screen.getByTestId('runtime-target-mode-embedded')).toHaveAttribute('aria-pressed', 'true');
    });

    fireEvent.click(screen.getByTestId('runtime-target-mode-external'));

    await waitFor(() => {
      expect(screen.getByTestId('runtime-target-mode-external')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByTestId('runtime-local-start-button')).toBeDisabled();
    });

    fireEvent.change(screen.getByTestId('runtime-target-external-address-input'), {
      target: { value: '10.9.0.8:2999' },
    });
    fireEvent.click(screen.getByTestId('runtime-target-external-apply-button'));

    await waitFor(() => {
      expect(window.localStorage.getItem('exomind:runtimeExternalAddress')).toBe('10.9.0.8:2999');
      expect(window.localStorage.getItem('exomind:runtimeTargetMode')).toBe('external');
    });
  });
});
