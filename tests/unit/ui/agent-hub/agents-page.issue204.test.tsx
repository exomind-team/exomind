import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AgentsPage } from '@/ui/new/pages/AgentsPage';
import { AGENT_HUB_MOCK_FIXTURE } from '@/lib/adapters/mock/fixtures/agent-hub';

const serviceMocks = vi.hoisted(() => ({
  getTopology: vi.fn(),
  getListView: vi.fn(),
  getDeviceView: vi.fn(),
  listAddNodeOptions: vi.fn(),
}));

vi.mock('@/lib/services', () => ({
  getAgentHubService: () => ({
    getTopology: serviceMocks.getTopology,
    getListView: serviceMocks.getListView,
    getDeviceView: serviceMocks.getDeviceView,
    listAddNodeOptions: serviceMocks.listAddNodeOptions,
  }),
}));

describe('agents page issue-204（主页面三视图与添加节点）', () => {
  beforeEach(() => {
    serviceMocks.getTopology.mockResolvedValue(AGENT_HUB_MOCK_FIXTURE.topology);
    serviceMocks.getListView.mockResolvedValue(AGENT_HUB_MOCK_FIXTURE.listSections);
    serviceMocks.getDeviceView.mockResolvedValue(AGENT_HUB_MOCK_FIXTURE.deviceGroups);
    serviceMocks.listAddNodeOptions.mockResolvedValue(AGENT_HUB_MOCK_FIXTURE.addNodeOptions);
  });

  it('switches topology/list/device views（支持拓扑/列表/设备切换）', async () => {
    render(<AgentsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('agent-hub-page')).toBeInTheDocument();
    });

    expect(screen.getByTestId('agent-topology-view')).toBeInTheDocument();
    expect(screen.getByTestId('agent-topology-canvas')).toBeInTheDocument();
    expect(screen.getByTestId('agent-topology-edge-e-rss-daily')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('agent-view-toggle-list'));
    expect(screen.getByTestId('agent-list-view')).toBeInTheDocument();
    expect(screen.getByTestId('agent-list-filter-all')).toBeInTheDocument();
    expect(screen.getByTestId('agent-list-item-agent-daily-chevron')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('agent-view-toggle-device'));
    expect(screen.getByTestId('agent-device-view')).toBeInTheDocument();
    expect(screen.getByTestId('agent-device-overview-card')).toBeInTheDocument();
  });

  it('supports selecting topology node and opening add node sheet（支持节点选中与添加节点弹窗）', async () => {
    render(<AgentsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('agent-topology-view')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('agent-topology-node-agent-daily'));
    expect(screen.getByTestId('agent-topology-node-detail-card')).toBeInTheDocument();
    expect(screen.getByTestId('agent-topology-node-agent-summary')).toHaveAttribute('data-muted', 'true');

    fireEvent.click(screen.getByTestId('agent-add-node-button'));
    expect(screen.getByTestId('agent-add-node-sheet')).toBeInTheDocument();
    expect(screen.getByText('从市场安装')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('agent-add-node-close'));
    expect(screen.queryByTestId('agent-add-node-sheet')).not.toBeInTheDocument();
  });
});
