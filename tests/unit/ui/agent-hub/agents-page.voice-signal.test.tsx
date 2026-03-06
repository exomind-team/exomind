import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AgentsPage } from '@/ui/app/pages/AgentsPage';
import { AGENT_HUB_MOCK_FIXTURE } from '@/lib/adapters/mock/fixtures/agent-hub';
import type { SignalRoute } from '@/lib/types/signal-pool';

const serviceMocks = vi.hoisted(() => ({
  getTopology: vi.fn(),
  getDeviceView: vi.fn(),
  getAgentDetail: vi.fn(),
}));

const runtimeManagerMocks = vi.hoisted(() => ({
  refreshSnapshot: vi.fn(),
}));

const runtimeControlMocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
}));

vi.mock('@xyflow/react', () => ({
  ReactFlow: ({
    nodes,
    edges,
    children,
    onNodeClick,
    nodeTypes,
  }: {
    nodes?: Array<{ id: string; type?: string; data?: { label?: string } }>;
    edges?: Array<{ id: string; label?: string; source?: string; target?: string }>;
    children?: unknown;
    onNodeClick?: (_event: unknown, node: { id: string; data?: { label?: string } }) => void;
    nodeTypes?: Record<string, (props: { data: { label?: string; subtitle?: string; nodeType?: string } }) => JSX.Element>;
  }) => (
    <div data-testid="mock-react-flow">
      {(nodes ?? []).map((node) => (
        <button
          key={node.id}
          type="button"
          data-testid={`mock-react-flow-node-${node.id}`}
          onClick={() => onNodeClick?.({}, node)}
        >
          {(() => {
            const NodeComponent = node.type ? nodeTypes?.[node.type] : undefined;
            if (!NodeComponent) {
              return node.data?.label ?? node.id;
            }
            return <NodeComponent data={{ ...node.data, nodeType: node.type }} />;
          })()}
        </button>
      ))}
      {(edges ?? []).map((edge) => (
        <div key={edge.id}>{edge.label ?? `${edge.source} -> ${edge.target}`}</div>
      ))}
      {children}
    </div>
  ),
  Background: () => <div data-testid="mock-react-flow-background" />,
  Controls: ({ className }: { className?: string }) => (
    <div data-testid="mock-react-flow-controls" className={className}>
      <button type="button" data-testid="mock-react-flow-control-zoom-in">+</button>
      <button type="button" data-testid="mock-react-flow-control-zoom-out">-</button>
      <button type="button" data-testid="mock-react-flow-control-lock">lock</button>
    </div>
  ),
  MiniMap: () => null,
  Handle: () => null,
  Position: { Left: 'left', Right: 'right' },
  useNodesState: <T,>(initialNodes: T[]) => [initialNodes, vi.fn(), vi.fn()] as const,
  MarkerType: { ArrowClosed: 'arrowclosed' },
}));

const signalRouteFetchMock = vi.hoisted(() => vi.fn());

const SAMPLE_SIGNAL_ROUTES: SignalRoute[] = [
  {
    id: 'route-000',
    enabled: true,
    topic: 'voice.input.transcript',
    target_type: 'agent',
    target_ref: 'classifier',
    created_at: '2026-03-04T00:00:00Z',
    updated_at: '2026-03-04T00:00:00Z',
  },
  {
    id: 'route-001',
    enabled: true,
    topic: 'user.input.text',
    target_type: 'agent',
    target_ref: 'classifier',
    created_at: '2026-03-04T00:00:00Z',
    updated_at: '2026-03-04T00:00:00Z',
  },
];

vi.mock('@/lib/services', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services')>();
  return {
    ...actual,
    getAgentHubService: () => ({
      getTopology: serviceMocks.getTopology,
      getDeviceView: serviceMocks.getDeviceView,
      getAgentDetail: serviceMocks.getAgentDetail,
    }),
  };
});

vi.mock('@/services/runtime-manager', () => ({
  getRuntimeManager: () => runtimeManagerMocks,
  findPreferredRuntimeHostForAgent: vi.fn(() => null),
}));

vi.mock('@/lib/services/runtime-control.service', () => ({
  getRuntimeControlService: () => runtimeControlMocks,
}));

describe('agents page voice signal topology（语音信号拓扑）', () => {
  beforeEach(() => {
    document.documentElement.classList.remove('dark');
    serviceMocks.getTopology.mockResolvedValue(AGENT_HUB_MOCK_FIXTURE.topology);
    serviceMocks.getDeviceView.mockResolvedValue(AGENT_HUB_MOCK_FIXTURE.deviceGroups);
    serviceMocks.getAgentDetail.mockResolvedValue(AGENT_HUB_MOCK_FIXTURE.agentDetails['agent-daily']);
    runtimeControlMocks.getStatus.mockResolvedValue({
      running: false,
      host: '127.0.0.1',
      port: 1949,
    });
    runtimeManagerMocks.refreshSnapshot.mockResolvedValue({
      updatedAt: '2026-02-28T10:00:00.000Z',
      agents: [
        {
          id: 'classifier',
          name: 'Classifier Agent',
          description: 'classifies input',
          status: 'available',
          sourceHostId: 'host-a',
          sourceHostName: '127.0.0.1:1919',
          sourceHostAddress: '127.0.0.1:1919',
        },
      ],
      hosts: [
        {
          host: {
            id: 'host-a',
            name: '127.0.0.1:1919',
            host: '127.0.0.1',
            port: 1919,
            status: 'unknown',
            createdAt: '2026-02-28T00:00:00.000Z',
            updatedAt: '2026-02-28T00:00:00.000Z',
          },
          connectionState: 'online',
          agents: [],
          topology: null,
        },
      ],
    });

    signalRouteFetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => SAMPLE_SIGNAL_ROUTES,
    } as Response);

    vi.stubGlobal('fetch', signalRouteFetchMock);
  });

  it('renders voice input node in topology（在拓扑图显示语音输入节点）', async () => {
    render(<AgentsPage />);

    await waitFor(() => {
      expect(screen.getByText('Voice Input（语音输入）')).toBeInTheDocument();
      expect(screen.getByText('voice.input.transcript')).toBeInTheDocument();
      expect(screen.getByText('Voice Input（语音输入） → voice.input.transcript')).toBeInTheDocument();
    });
  });

  it('uses light detail surface for voice input node in light mode（浅色模式下语音节点详情卡片不应为黑底）', async () => {
    render(<AgentsPage />);

    const voiceNode = await screen.findByTestId('mock-react-flow-node-input:voice');
    fireEvent.click(voiceNode);

    const detailCard = await screen.findByTestId('agent-topology-node-detail-card');
    expect(detailCard.className).toContain('bg-white');
    expect(detailCard.className).toContain('text-[#1C1917]');
    expect(detailCard.className).toContain('dark:bg-[#0C0A09]');
    expect(detailCard).toHaveTextContent('Voice Input（语音输入）');
  });

  it('uses semantic theme tokens for voice input node in dark mode（暗色模式下语音输入节点应接入全局主题 token）', async () => {
    document.documentElement.classList.add('dark');
    render(<AgentsPage />);

    const voiceNode = await screen.findByTestId('mock-react-flow-node-input:voice');
    expect(voiceNode.innerHTML).toContain('bg-card');
    expect(voiceNode.innerHTML).toContain('text-foreground');
    expect(voiceNode.innerHTML).toContain('text-muted-foreground');
  });

  it('uses themed control class for topology controls in dark mode（暗色模式下拓扑图控件按钮应走自定义主题类）', async () => {
    document.documentElement.classList.add('dark');
    render(<AgentsPage />);

    const controls = await screen.findByTestId('mock-react-flow-controls');
    expect(controls.className).toContain('agent-topology-controls');
  });

  it('uses semantic theme tokens for signal detail right panel in light mode（浅色模式下信号详情右栏应接入全局主题 token）', async () => {
    render(<AgentsPage />);

    const voiceNode = await screen.findByTestId('mock-react-flow-node-input:voice');
    fireEvent.click(voiceNode);

    const shell = await screen.findByTestId('agent-rightpanel-shell');
    const signalDetail = await screen.findByTestId('agent-rightpanel-signal-detail');

    expect(shell.className).toContain('bg-surface');
    expect(shell.className).toContain('text-foreground');
    expect(shell.className).toContain('border-border-card');
    expect(signalDetail.className).toContain('text-foreground');
  });

  it('uses semantic theme tokens for agent detail right panel in light mode（浅色模式下 Agent 详情右栏应接入全局主题 token）', async () => {
    render(<AgentsPage />);

    const agentNode = await screen.findByTestId('mock-react-flow-node-agent:classifier');
    fireEvent.click(agentNode);

    const shell = await screen.findByTestId('agent-rightpanel-shell');
    const agentDetail = await screen.findByTestId('agent-rightpanel-agent-detail');

    expect(shell.className).toContain('bg-surface');
    expect(shell.className).toContain('text-foreground');
    expect(agentDetail.className).toContain('text-foreground');
  });
});
