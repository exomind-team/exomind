import { describe, expect, it } from 'vitest';
import type { SignalRoute } from '@/lib/types/signal-pool';
import type { RuntimeAggregatedAgent } from '@/services/runtime-manager';
import {
  buildSignalGraph,
  buildSignalRouteRows,
} from '@/ui/app/pages/agents-signal-topology';

const SAMPLE_ROUTES: SignalRoute[] = [
  {
    id: 'route-001',
    enabled: true,
    topic: 'user.input.text',
    target_type: 'agent',
    target_ref: 'classifier',
    created_at: '2026-03-04T00:00:00Z',
    updated_at: '2026-03-04T00:00:00Z',
  },
  {
    id: 'route-002',
    enabled: true,
    topic: 'user.input.text',
    target_type: 'actor',
    target_ref: 'eventlog',
    created_at: '2026-03-04T00:00:00Z',
    updated_at: '2026-03-04T00:00:00Z',
  },
  {
    id: 'route-003',
    enabled: true,
    topic: 'session.end',
    target_type: 'agent',
    target_ref: 'reviewer',
    created_at: '2026-03-04T00:00:00Z',
    updated_at: '2026-03-04T00:00:00Z',
  },
  {
    id: 'route-004',
    enabled: false,
    topic: 'input.classified',
    target_type: 'actor',
    target_ref: 'task',
    created_at: '2026-03-04T00:00:00Z',
    updated_at: '2026-03-04T00:00:00Z',
  },
  {
    id: 'route-005',
    enabled: true,
    topic: '*',
    target_type: 'frontend',
    target_ref: 'ui',
    created_at: '2026-03-04T00:00:00Z',
    updated_at: '2026-03-04T00:00:00Z',
  },
  {
    id: 'route-006',
    enabled: true,
    topic: 'timeblock.completed',
    target_type: 'agent',
    target_ref: 'reviewer',
    created_at: '2026-03-04T00:00:00Z',
    updated_at: '2026-03-04T00:00:00Z',
  },
];

const SAMPLE_AGENTS: RuntimeAggregatedAgent[] = [
  {
    id: 'classifier',
    name: 'Classifier Agent',
    description: 'classify user input',
    status: 'available',
    sourceHostId: 'host-a',
    sourceHostName: 'RT-A',
    sourceHostAddress: '127.0.0.1:1919',
  },
  {
    id: 'reviewer',
    name: 'Reviewer Agent',
    description: 'review session',
    status: 'busy',
    sourceHostId: 'host-a',
    sourceHostName: 'RT-A',
    sourceHostAddress: '127.0.0.1:1919',
  },
];

describe('agents signal topology builder issue-245f（信号拓扑构建）', () => {
  it('builds route rows with active/inactive status（构建路由列表行并区分状态）', () => {
    const rows = buildSignalRouteRows(SAMPLE_ROUTES, '127.0.0.1:1919');
    expect(rows.length).toBe(6);
    expect(rows[0]).toMatchObject({
      topic: '*',
      targetType: 'frontend',
      targetRef: 'ui',
      status: 'active',
    });
    expect(rows.find((row) => row.id === 'route-004')).toMatchObject({
      status: 'inactive',
    });
  });

  it('builds graph with key flow edges（构建关键信号流边）', () => {
    const graph = buildSignalGraph(SAMPLE_ROUTES, SAMPLE_AGENTS);
    expect(graph.nodes.length).toBeGreaterThanOrEqual(8);
    expect(graph.edges.length).toBeGreaterThanOrEqual(6);

    expect(graph.nodes.find((node) => node.id === 'topic:user.input.text')?.type).toBe('topic');
    expect(graph.nodes.find((node) => node.id === 'agent:classifier')?.type).toBe('agent');
    expect(graph.nodes.find((node) => node.id === 'actor:eventlog')?.type).toBe('actor');
    expect(graph.nodes.find((node) => node.id === 'frontend:ui')?.type).toBe('frontend');

    expect(
      graph.edges.some(
        (edge) => edge.topic === 'user.input.text' && edge.targetType === 'agent' && edge.targetRef === 'classifier'
      )
    ).toBe(true);
    expect(
      graph.edges.some(
        (edge) => edge.topic === 'user.input.text' && edge.targetType === 'actor' && edge.targetRef === 'eventlog'
      )
    ).toBe(true);
    expect(
      graph.edges.some((edge) => edge.topic === 'session.end' && edge.targetType === 'agent' && edge.targetRef === 'reviewer')
    ).toBe(true);

    const inactiveEdge = graph.edges.find((edge) => edge.id === 'route:route-004');
    expect(inactiveEdge?.active).toBe(false);
  });
});
