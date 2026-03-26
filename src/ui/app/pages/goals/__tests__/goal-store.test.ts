import { beforeEach, describe, expect, it, vi } from 'vitest';

const LEGACY_GRAPH = {
  goals: [
    { id: 'legacy-me', name: 'Me', status: 'pending', achieveMode: 'AND', isMe: true },
    { id: 'legacy-goal', name: 'Learn', status: 'completed', achieveMode: 'AND', isMe: false },
  ],
  tasks: [
    { id: 'legacy-edge', name: 'Legacy Task', source: 'legacy-me', target: 'legacy-goal', status: 'completed' },
  ],
};

async function loadStoreModule() {
  vi.resetModules();
  return import('../goal-store');
}

describe('goal-store', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('loads an empty Me-only graph by default', async () => {
    const { useGoalStore } = await loadStoreModule();
    const state = useGoalStore.getState();

    expect(state.graph.me.id).toBe('me');
    expect(state.graph.goals).toEqual([]);
    expect(state.graph.edges).toEqual([]);
  });

  it('persists graph and opLog when actions succeed', async () => {
    const {
      GOAL_GRAPH_STORAGE_KEY,
      GOAL_OPLOG_STORAGE_KEY,
      useGoalStore,
    } = await loadStoreModule();

    const result = useGoalStore.getState().createGoal({
      fromNode: 'me',
      direction: 'downstream',
      title: 'First goal',
    });

    expect(result.ok).toBe(true);
    expect(useGoalStore.getState().graph.goals).toHaveLength(1);
    const latestLog = useGoalStore.getState().opLog[useGoalStore.getState().opLog.length - 1];
    expect(latestLog?.action).toBe('createGoal');

    const storedGraph = JSON.parse(window.localStorage.getItem(GOAL_GRAPH_STORAGE_KEY) ?? 'null');
    const storedOpLog = JSON.parse(window.localStorage.getItem(GOAL_OPLOG_STORAGE_KEY) ?? 'null');
    expect(storedGraph.goals).toHaveLength(1);
    expect(storedOpLog[storedOpLog.length - 1].action).toBe('createGoal');
  });

  it('migrates legacy v0.2 storage and preserves status through overrides', async () => {
    window.localStorage.setItem('exomind:goal-graph', JSON.stringify(LEGACY_GRAPH));
    const { useGoalStore } = await loadStoreModule();

    const state = useGoalStore.getState();
    expect(state.graph.me.id).toBe('legacy-me');
    expect(state.graph.goals[0].title).toBe('Learn');
    expect(state.getEdgeStatus('legacy-edge')).toBe('completed');
    expect(state.deriveGoalDisplayStatus('legacy-goal')).toBe('completed');
  });

  it('re-hydrates persisted v0.3 data across module reloads', async () => {
    const first = await loadStoreModule();
    const createResult = first.useGoalStore.getState().createGoal({
      fromNode: 'me',
      direction: 'downstream',
      title: 'Round trip',
    });
    expect(createResult.ok).toBe(true);

    const second = await loadStoreModule();
    expect(second.useGoalStore.getState().graph.goals[0]?.title).toBe('Round trip');
  });

  it('keeps edge overrides in memory only', async () => {
    const module = await loadStoreModule();
    const state = module.useGoalStore.getState();
    const createResult = state.createGoal({
      fromNode: 'me',
      direction: 'downstream',
      title: 'Override Goal',
    });

    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    module.useGoalStore.getState().setEdgeStatusOverride(createResult.value.edge.id, 'completed');
    expect(module.useGoalStore.getState().getEdgeStatus(createResult.value.edge.id)).toBe('completed');

    const reloaded = await loadStoreModule();
    expect(reloaded.useGoalStore.getState().getEdgeStatus(createResult.value.edge.id)).toBe('pending');
  });
});
