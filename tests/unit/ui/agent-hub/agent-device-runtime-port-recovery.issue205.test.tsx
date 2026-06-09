import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AgentsPage } from '@/ui/app/pages/AgentsPage';
import { AGENT_HUB_MOCK_FIXTURE } from '@/lib/adapters/mock/fixtures/agent-hub';
import { EMBEDDED_RUNTIME_STATUS_STORAGE_KEY } from '@/config/runtime-target';

const agentHubMocks = vi.hoisted(() => ({
  getTopology: vi.fn(),
  getDeviceView: vi.fn(),
}));

const runtimeManagerMocks = vi.hoisted(() => ({
  refreshSnapshot: vi.fn(),
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
  shouldAutoPollRuntimeHost: vi.fn(() => true),
}));

vi.mock('@/lib/services/runtime-control.service', () => ({
  getRuntimeControlService: () => runtimeControlMocks,
}));

describe('agent device runtime port recovery issue-205（设备页端口恢复）', () => {
  beforeEach(() => {
    window.localStorage.clear();

    agentHubMocks.getTopology.mockResolvedValue(AGENT_HUB_MOCK_FIXTURE.topology);
    agentHubMocks.getDeviceView.mockResolvedValue(AGENT_HUB_MOCK_FIXTURE.deviceGroups);
    runtimeManagerMocks.refreshSnapshot.mockResolvedValue({
      updatedAt: '2026-03-07T15:00:00.000Z',
      agents: [],
      hosts: [],
    });
    runtimeControlMocks.startRuntime.mockResolvedValue({
      running: true,
      host: '127.0.0.1',
      port: 1950,
      pid: 9527,
    });
    runtimeControlMocks.stopRuntime.mockResolvedValue({
      running: false,
      host: '127.0.0.1',
      port: 1950,
    });
  });

  it('does not reuse a failed stopped port as the next embedded runtime target（失败停止态端口不应污染下一次启动目标）', async () => {
    window.localStorage.setItem(
      EMBEDDED_RUNTIME_STATUS_STORAGE_KEY,
      JSON.stringify({
        host: '127.0.0.1',
        port: 1950,
      }),
    );
    runtimeControlMocks.getStatus.mockResolvedValue({
      running: false,
      host: '127.0.0.1',
      port: 43637,
      error: 'failed to start embedded runtime: bind conflict',
    });

    render(<AgentsPage />);
    fireEvent.click(await screen.findByRole('button', { name: '设备' }));

    await waitFor(() => {
      expect(screen.getByTestId('runtime-current-address')).toHaveTextContent('not running');
      expect(screen.getByTestId('runtime-last-attempt-address')).toHaveTextContent('127.0.0.1:43637');
      expect(screen.getByTestId('runtime-local-bind-address')).toHaveTextContent('127.0.0.1:3000');
    });

    fireEvent.click(screen.getByTestId('runtime-local-start-button'));

    await waitFor(() => {
      expect(runtimeControlMocks.startRuntime).toHaveBeenCalledWith({
        host: '127.0.0.1',
        port: 3000,
      });
    });
  });
});
