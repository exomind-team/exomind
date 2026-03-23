import { describe, expect, it, vi } from 'vitest';
import type { AgentEnergySnapshot } from '@/lib/types/agent-hub';
import type { RuntimeAggregatedAgent } from '@/services/runtime-manager';
import {
  buildListSectionsFromRuntimeAgents,
  ENERGY_PHASE_COLORS,
  mapRuntimeStatusToNodeStatus,
} from '@/ui/app/pages/agents/agents-utils';

vi.mock('@xyflow/react', () => ({
  ReactFlow: () => null,
  Background: () => null,
  Controls: () => null,
  Handle: () => null,
  Position: { Left: 'left', Right: 'right' },
  useNodesState: <T,>(initialNodes: T[]) => [initialNodes, vi.fn(), vi.fn()] as const,
  MarkerType: { ArrowClosed: 'arrowclosed' },
}));

function makeEnergy(overrides: Partial<AgentEnergySnapshot> = {}): AgentEnergySnapshot {
  return {
    agent_id: 'test-agent',
    current: 80,
    max: 100,
    ratio: 0.8,
    tick_cost: 1,
    phase: 'normal',
    is_dormant: false,
    ...overrides,
  };
}

function makeAgent(overrides: Partial<RuntimeAggregatedAgent> = {}): RuntimeAggregatedAgent {
  return {
    id: 'agent-1',
    name: 'Test Agent',
    description: 'A test agent',
    status: 'available',
    sourceHostId: 'host-1',
    sourceHostName: 'localhost',
    sourceHostAddress: '127.0.0.1:1949',
    ...overrides,
  };
}

describe('mapRuntimeStatusToNodeStatus', () => {
  it('returns running for available status without energy', () => {
    expect(mapRuntimeStatusToNodeStatus('available')).toBe('running');
  });

  it('returns running for running status without energy', () => {
    expect(mapRuntimeStatusToNodeStatus('running')).toBe('running');
  });

  it('returns warning for busy status', () => {
    expect(mapRuntimeStatusToNodeStatus('busy')).toBe('warning');
  });

  it('returns idle for unknown status', () => {
    expect(mapRuntimeStatusToNodeStatus('unknown')).toBe('idle');
  });

  it('returns dormant when energy.is_dormant is true', () => {
    expect(mapRuntimeStatusToNodeStatus('available', { phase: 'dormant', is_dormant: true })).toBe('dormant');
  });

  it('returns dying when energy.phase is dying', () => {
    expect(mapRuntimeStatusToNodeStatus('available', { phase: 'dying', is_dormant: false })).toBe('dying');
  });

  it('returns critical when energy.phase is critical', () => {
    expect(mapRuntimeStatusToNodeStatus('available', { phase: 'critical', is_dormant: false })).toBe('critical');
  });

  it('dormant takes priority over dying phase', () => {
    expect(mapRuntimeStatusToNodeStatus('available', { phase: 'dying', is_dormant: true })).toBe('dormant');
  });

  it('returns running when energy.phase is normal', () => {
    expect(mapRuntimeStatusToNodeStatus('available', { phase: 'normal', is_dormant: false })).toBe('running');
  });

  it('returns running when energy.phase is slowing', () => {
    expect(mapRuntimeStatusToNodeStatus('running', { phase: 'slowing', is_dormant: false })).toBe('running');
  });
});

describe('buildListSectionsFromRuntimeAgents', () => {
  it('returns empty array for no agents', () => {
    expect(buildListSectionsFromRuntimeAgents([])).toEqual([]);
  });

  it('merges energy data into list items', () => {
    const energy = makeEnergy({ agent_id: 'agent-1', ratio: 0.65, phase: 'slowing' });
    const agents = [makeAgent({ energy })];

    const sections = buildListSectionsFromRuntimeAgents(agents);
    expect(sections).toHaveLength(1);
    expect(sections[0].items).toHaveLength(1);

    const item = sections[0].items[0];
    expect(item.energy).toBeDefined();
    expect(item.energy?.ratio).toBe(0.65);
    expect(item.energy?.phase).toBe('slowing');
  });

  it('sets dormant status when energy.is_dormant is true', () => {
    const energy = makeEnergy({ is_dormant: true, phase: 'dormant', ratio: 0 });
    const agents = [makeAgent({ energy })];

    const sections = buildListSectionsFromRuntimeAgents(agents);
    expect(sections[0].items[0].status).toBe('dormant');
  });

  it('sets critical status when energy.phase is critical', () => {
    const energy = makeEnergy({ phase: 'critical', ratio: 0.1 });
    const agents = [makeAgent({ energy })];

    const sections = buildListSectionsFromRuntimeAgents(agents);
    expect(sections[0].items[0].status).toBe('critical');
  });

  it('sets dying status when energy.phase is dying', () => {
    const energy = makeEnergy({ phase: 'dying', ratio: 0.02 });
    const agents = [makeAgent({ energy })];

    const sections = buildListSectionsFromRuntimeAgents(agents);
    expect(sections[0].items[0].status).toBe('dying');
  });

  it('passes undefined energy when agent has no energy data', () => {
    const agents = [makeAgent()];
    const sections = buildListSectionsFromRuntimeAgents(agents);
    expect(sections[0].items[0].energy).toBeUndefined();
    expect(sections[0].items[0].status).toBe('running');
  });

  it('groups agents by host and preserves energy per agent', () => {
    const energy1 = makeEnergy({ agent_id: 'a1', ratio: 0.9, phase: 'normal' });
    const energy2 = makeEnergy({ agent_id: 'a2', ratio: 0.3, phase: 'critical' });
    const agents = [
      makeAgent({ id: 'a1', name: 'Agent One', energy: energy1 }),
      makeAgent({ id: 'a2', name: 'Agent Two', energy: energy2 }),
    ];

    const sections = buildListSectionsFromRuntimeAgents(agents);
    expect(sections).toHaveLength(1);
    expect(sections[0].items).toHaveLength(2);
    expect(sections[0].items[0].energy?.ratio).toBe(0.9);
    expect(sections[0].items[1].energy?.ratio).toBe(0.3);
    expect(sections[0].items[1].status).toBe('critical');
  });
});

describe('ENERGY_PHASE_COLORS', () => {
  it('has all expected phase colors', () => {
    expect(ENERGY_PHASE_COLORS.normal).toBe('#22C55E');
    expect(ENERGY_PHASE_COLORS.slowing).toBe('#EAB308');
    expect(ENERGY_PHASE_COLORS.critical).toBe('#F97316');
    expect(ENERGY_PHASE_COLORS.dying).toBe('#EF4444');
    expect(ENERGY_PHASE_COLORS.dormant).toBe('#6B7280');
  });
});
