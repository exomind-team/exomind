import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AGENT_HUB_MOCK_FIXTURE } from '@/lib/adapters/mock/fixtures/agent-hub';
import { AgentsPage } from '@/ui/app/pages/AgentsPage';

const serviceMocks = vi.hoisted(() => ({
  getTopology: vi.fn(),
  getDeviceView: vi.fn(),
}));

const runtimeManagerMocks = vi.hoisted(() => ({
  refreshSnapshot: vi.fn(),
}));

const runtimeControlMocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
}));

const apiAgentTabFlagState = vi.hoisted(() => ({
  enabled: false,
}));

vi.mock('@/config/api-agent-tab-enabled', () => ({
  getApiAgentTabEnabled: vi.fn(() => apiAgentTabFlagState.enabled),
  subscribeApiAgentTabEnabledChanges: vi.fn(() => () => {}),
}));

vi.mock('@xyflow/react', () => ({
  ReactFlow: () => <div data-testid="mock-react-flow" />,
  Background: () => <div data-testid="mock-react-flow-background" />,
  Controls: () => <div data-testid="mock-react-flow-controls" />,
  Handle: () => null,
  Position: { Left: 'left', Right: 'right' },
  useNodesState: <T,>(initialNodes: T[]) => [initialNodes, vi.fn(), vi.fn()] as const,
  MarkerType: { ArrowClosed: 'arrowclosed' },
}));

vi.mock('@/lib/services', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services')>();
  return {
    ...actual,
    getAgentHubService: () => ({
      getTopology: serviceMocks.getTopology,
      getDeviceView: serviceMocks.getDeviceView,
    }),
  };
});

vi.mock('@/services/runtime-manager', () => ({
  getRuntimeManager: () => runtimeManagerMocks,
  findPreferredRuntimeHostForAgent: vi.fn(() => null),
  shouldAutoPollRuntimeHost: vi.fn(() => true),
}));

vi.mock('@/lib/services/runtime-control.service', () => ({
  getRuntimeControlService: () => runtimeControlMocks,
}));

vi.mock('@/ui/app/pages/agents/ApiAgentTabView', () => ({
  ApiAgentTabView: () => <div data-testid="mock-api-agent-tab-view">API Agent View</div>,
}));

describe('agents page api agent tab（网络页 API Agent 页签）', () => {
  beforeEach(() => {
    apiAgentTabFlagState.enabled = false;
    serviceMocks.getTopology.mockResolvedValue(AGENT_HUB_MOCK_FIXTURE.topology);
    serviceMocks.getDeviceView.mockResolvedValue(AGENT_HUB_MOCK_FIXTURE.deviceGroups);
    runtimeControlMocks.getStatus.mockResolvedValue({
      running: false,
      host: '127.0.0.1',
      port: 1949,
    });
    runtimeManagerMocks.refreshSnapshot.mockResolvedValue({
      updatedAt: '2026-04-08T10:00:00.000Z',
      agents: [],
      hosts: [],
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [],
    } as Response)));
  });

  it('hides the API Agent tab when the developer flag is off（开关关闭时隐藏 API Agent 页签）', async () => {
    render(<AgentsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('agent-hub-page')).toBeInTheDocument();
    });

    expect(screen.queryByRole('tab', { name: 'API Agent' })).not.toBeInTheDocument();
  });

  it('shows the API Agent tab and opens the dedicated view when the flag is on（开关开启时显示 API Agent 页签并进入独立页面）', async () => {
    apiAgentTabFlagState.enabled = true;

    render(<AgentsPage />);
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'API Agent' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('tab', { name: 'API Agent' }));

    expect(await screen.findByTestId('mock-api-agent-tab-view')).toBeInTheDocument();
    expect(screen.getByText('API Agent View')).toBeInTheDocument();
  });
});
