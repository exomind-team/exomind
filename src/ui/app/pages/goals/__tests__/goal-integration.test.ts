import { beforeEach, describe, expect, it, vi } from 'vitest';

async function loadStoreModule() {
  vi.resetModules();
  return import('../goal-store');
}

describe('goal integration', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('creates goals, connects them, and derives completion from developer override', async () => {
    const { useGoalStore } = await loadStoreModule();
    const store = useGoalStore.getState();

    const firstGoal = store.createGoal({ fromNode: 'me', direction: 'downstream', title: 'Learn TS' });
    expect(firstGoal.ok).toBe(true);
    if (!firstGoal.ok) return;

    const secondGoal = useGoalStore.getState().createGoal({
      fromNode: firstGoal.value.goal.id,
      direction: 'downstream',
      title: 'Build App',
    });
    expect(secondGoal.ok).toBe(true);
    if (!secondGoal.ok) return;

    useGoalStore.getState().setEdgeStatusOverride(firstGoal.value.edge.id, 'completed');
    useGoalStore.getState().setEdgeStatusOverride(secondGoal.value.edge.id, 'completed');

    expect(useGoalStore.getState().deriveGoalDisplayStatus(firstGoal.value.goal.id)).toBe('completed');
    expect(useGoalStore.getState().deriveGoalDisplayStatus(secondGoal.value.goal.id)).toBe('completed');
  });

  it('cancels goals and auto-adds a Me edge when the last inbound edge is deleted', async () => {
    const { useGoalStore } = await loadStoreModule();
    const created = useGoalStore.getState().createGoal({ fromNode: 'me', direction: 'downstream', title: 'Goal A' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const deleteResult = useGoalStore.getState().deleteEdge({ edgeId: created.value.edge.id });
    expect(deleteResult.ok).toBe(true);
    expect(useGoalStore.getState().graph.edges).toHaveLength(1);
    expect(useGoalStore.getState().graph.edges[0].source).toBe('me');

    const cancelResult = useGoalStore.getState().cancelGoal({ goalId: created.value.goal.id });
    expect(cancelResult.ok).toBe(true);
    expect(useGoalStore.getState().graph.goals[0].cancelled).toBe(true);
  });
});
