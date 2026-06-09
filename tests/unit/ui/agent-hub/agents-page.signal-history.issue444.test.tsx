import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AgentsPage } from '@/ui/app/pages/AgentsPage';
import type { SignalEvent, SignalRoute } from '@/lib/types/signal-pool';

const serviceMocks = vi.hoisted(() => ({
  getDeviceView: vi.fn(),
  getAgentDetail: vi.fn(),
  getActorDetail: vi.fn(),
  getConversation: vi.fn(),
  streamConversation: vi.fn(),
}));

const runtimeManagerMocks = vi.hoisted(() => ({
  refreshSnapshot: vi.fn(),
  retryHost: vi.fn(),
  addHost: vi.fn(),
  addHostFromAddress: vi.fn(),
  removeHost: vi.fn(),
}));

const runtimeControlMocks = vi.hoisted(() => ({
  startRuntime: vi.fn(),
  stopRuntime: vi.fn(),
  getStatus: vi.fn(),
}));

vi.mock('@xyflow/react', () => ({
  ReactFlow: () => <div data-testid="mock-react-flow" />,
  Background: () => null,
  Controls: () => null,
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
      getDeviceView: serviceMocks.getDeviceView,
      getAgentDetail: serviceMocks.getAgentDetail,
      getActorDetail: serviceMocks.getActorDetail,
      getConversation: serviceMocks.getConversation,
      streamConversation: serviceMocks.streamConversation,
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

const SAMPLE_SIGNAL_ROUTES: SignalRoute[] = [
  {
    id: 'route-a',
    enabled: true,
    topic: 'user.input.text',
    target_type: 'agent',
    target_ref: 'echo',
    created_at: '2026-03-05T00:00:00Z',
    updated_at: '2026-03-05T00:00:00Z',
  },
  {
    id: 'route-b',
    enabled: true,
    topic: 'eventlog.appended',
    target_type: 'actor',
    target_ref: 'eventlog',
    created_at: '2026-03-05T00:00:00Z',
    updated_at: '2026-03-05T00:00:00Z',
  },
];

const SAMPLE_SIGNAL_HISTORY: SignalEvent[] = [
  {
    schema_version: 1,
    id: 'sig-001',
    topic: 'user.input.text',
    ts: 1741161600000,
    source: 'ui:test',
    origin_host_id: 'local-host',
    hop: 0,
    trace_id: 'trace-a',
    payload: { text: 'hello from signal history' },
  },
  {
    schema_version: 1,
    id: 'sig-002',
    topic: 'eventlog.appended',
    ts: 1741161601000,
    source: 'actor:eventlog',
    origin_host_id: 'local-host',
    hop: 1,
    trace_id: 'trace-b',
    payload: { text: 'saved to eventlog' },
  },
];

const SAMPLE_PROOF_HISTORY: SignalEvent[] = [
  {
    schema_version: 1,
    id: 'sig-003',
    topic: 'system.link_proof.request',
    ts: 1741161602000,
    source: 'ui:runtime_link_proof',
    origin_host_id: 'desktop-local-host',
    hop: 0,
    trace_id: 'trace-c',
    payload: {
      proof_session_id: 'proof-session-1',
      attempt_id: 'attempt-1',
      initiated_by_peer_id: 'desktop-local-host',
      target_peer_id: 'paired-phone-host',
      trigger: 'pairing_auto',
      sent_at_ms: 1741161602000,
    },
  },
  {
    schema_version: 1,
    id: 'sig-004',
    topic: 'system.link_proof.ack',
    ts: 1741161603000,
    source: 'actor:link_proof',
    origin_host_id: 'paired-phone-host',
    hop: 1,
    trace_id: 'trace-d',
    payload: {
      proof_session_id: 'proof-session-1',
      attempt_id: 'attempt-1',
      initiated_by_peer_id: 'desktop-local-host',
      target_peer_id: 'desktop-local-host',
      ack_kind: 'result',
      acked_by_peer_id: 'paired-phone-host',
      observed_rtt_ms: 56,
      completed_at_ms: 1741161603000,
    },
  },
];

describe('agents page signal history issue-444（信号历史独立交互）', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/agents');

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: true,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    runtimeControlMocks.getStatus.mockResolvedValue({
      running: true,
      host: '127.0.0.1',
      port: 1949,
    });

    runtimeManagerMocks.refreshSnapshot.mockResolvedValue({
      updatedAt: '2026-03-05T10:00:00.000Z',
      agents: [],
      hosts: [
        {
          host: {
            id: 'host-a',
            name: '127.0.0.1:1919',
            host: '127.0.0.1',
            port: 1919,
            status: 'unknown',
            createdAt: '2026-03-05T00:00:00.000Z',
            updatedAt: '2026-03-05T00:00:00.000Z',
          },
          connectionState: 'online',
          agents: [],
          topology: null,
        },
      ],
    });

    serviceMocks.getDeviceView.mockResolvedValue([]);
    serviceMocks.getAgentDetail.mockResolvedValue(null);
    serviceMocks.getActorDetail.mockResolvedValue(null);
    serviceMocks.getConversation.mockResolvedValue([]);
    serviceMocks.streamConversation.mockImplementation(async function* () {});

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/signal-routes')) {
        return {
          ok: true,
          status: 200,
          json: async () => SAMPLE_SIGNAL_ROUTES,
        } as Response;
      }
      if (url.includes('/signals/history') && url.includes('exclude_topic_prefix=system.link_proof.')) {
        return {
          ok: true,
          status: 200,
          json: async () => SAMPLE_SIGNAL_HISTORY,
        } as Response;
      }
      if (url.includes('/signals/history') && url.includes('topic_prefix=system.link_proof.')) {
        return {
          ok: true,
          status: 200,
          json: async () => SAMPLE_PROOF_HISTORY,
        } as Response;
      }

      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'not found' }),
      } as Response;
    });

    vi.stubGlobal('fetch', fetchMock);
  });

  it('filters history, expands payload, and opens signal detail（支持过滤、展开 payload、打开信号详情）', async () => {
    render(<AgentsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('agent-hub-page')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('agent-view-toggle-history'));

    await waitFor(() => {
      expect(screen.getByTestId('agent-signal-history-view')).toBeInTheDocument();
    });

    expect(screen.getByTestId('signal-history-filter-all')).toBeInTheDocument();
    expect(screen.getByTestId('signal-history-filter-link-proof')).toBeInTheDocument();
    expect(screen.getByTestId('signal-history-filter-user.input.text')).toBeInTheDocument();
    expect(screen.getByTestId('signal-history-filter-eventlog.appended')).toBeInTheDocument();
    expect(screen.queryByTestId('signal-history-filter-system.link_proof.request')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('signal-history-filter-user.input.text'));

    await waitFor(() => {
      expect(screen.getByTestId('signal-history-item-sig-001')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('signal-history-item-sig-002')).not.toBeInTheDocument();
    expect(screen.queryByTestId('signal-history-item-sig-003')).not.toBeInTheDocument();

    const payloadPanel = screen.getByTestId('signal-history-payload-sig-001');
    fireEvent.click(within(payloadPanel).getByText('展开 payload'));
    expect(screen.getByText(/Payload:/)).toBeInTheDocument();
    expect(within(payloadPanel).getByText(/hello from signal history/)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('signal-history-filter-link-proof'));

    await waitFor(() => {
      expect(screen.getByTestId('signal-history-item-sig-003')).toBeInTheDocument();
      expect(screen.getByTestId('signal-history-item-sig-004')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('signal-history-item-sig-001')).not.toBeInTheDocument();
    expect(screen.getByTestId('signal-history-system-badge-sig-003')).toHaveTextContent('系统信号');
    expect(screen.getByText(/链路验证请求 · desktop-local-host -> paired-phone-host · 自动配对 · session proof-session-1/)).toBeInTheDocument();
    expect(screen.getByText(/链路验证结果 · paired-phone-host -> desktop-local-host · RTT 56 ms · session proof-session-1/)).toBeInTheDocument();

    const proofPayloadPanel = screen.getByTestId('signal-history-payload-sig-003');
    fireEvent.click(within(proofPayloadPanel).getByText('展开 payload'));
    expect(within(proofPayloadPanel).getByText(/"proof_session_id": "proof-session-1"/)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('signal-history-open-sig-004'));

    await waitFor(() => {
      expect(screen.getByTestId('agent-rightpanel-signal-detail')).toBeInTheDocument();
    });

    const detail = screen.getByTestId('agent-rightpanel-signal-detail');
    expect(within(detail).getByText('sig-004')).toBeInTheDocument();
    expect(within(detail).getByText('actor:link_proof')).toBeInTheDocument();
    expect(within(detail).getByText('paired-phone-host')).toBeInTheDocument();
    expect(within(detail).getByText('1')).toBeInTheDocument();
    expect(within(detail).getByText(/"ack_kind": "result"/)).toBeInTheDocument();
  });
});
