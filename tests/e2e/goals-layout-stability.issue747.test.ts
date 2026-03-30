import { expect, test, type Page } from '@playwright/test';

const ISSUE747_FROZEN_RANDOM_SAMPLE_SEEDS = [
  1386297379,
  1410414701,
  1942749808,
  1380669409,
  2124903778,
  1237704268,
  1550436838,
  115713120,
  994620516,
  1561867595,
  286603475,
  363364812,
  1226997560,
  760290680,
  646038413,
  161413300,
  606232779,
  2002801733,
  402121570,
  1519728956,
] as const;
// Keep #747 browser coverage reproducible with a committed 20-sample random baseline.

interface GoalLayoutTestConfig {
  randomSeed?: number;
  fixedPolarSequence?: Array<{
    angle: number;
    distance: number;
  }>;
}

interface PersistedGoalGraph {
  me: { id: string; name: string };
  goals: Array<{
    id: string;
    title: string;
    description: string;
    cancelled: boolean;
    completionRule: string[][];
    createdAt: number;
    updatedAt: number;
  }>;
  edges: Array<{
    id: string;
    title: string;
    description: string;
    source: string;
    target: string;
    createdAt: number;
    updatedAt: number;
  }>;
}

interface LegacyPersistedGoalGraph {
  goals: Array<{
    id: string;
    name: string;
    status: 'pending' | 'completed' | 'cancelled';
    achieveMode: 'AND' | 'OR';
    isMe: boolean;
  }>;
  tasks: Array<{
    id: string;
    name: string;
    source: string;
    target: string;
    status: 'pending' | 'in_progress' | 'suspended' | 'completed' | 'cancelled';
  }>;
}

interface ThreeNodeGeometry {
  distMA: number;
  distMB: number;
  distAB: number;
  angle: number;
}

async function primeGoalsPage(page: Page, layoutTestConfig: GoalLayoutTestConfig | null = null) {
  await page.addInitScript(({ config, graph }) => {
    localStorage.setItem('exomind:goalsPageEnabled', 'true');
    localStorage.setItem('exomind:developerMode', 'true');
    if (graph) {
      localStorage.setItem('exomind:goal-graph', JSON.stringify(graph));
      localStorage.setItem('exomind:goal-oplog', '[]');
    } else {
      localStorage.removeItem('exomind:goal-graph');
      localStorage.removeItem('exomind:goal-oplog');
    }
    localStorage.removeItem('exomind:goals-guide-hidden');
    const windowWithConfig = window as typeof window & {
      __EXOMIND_GOAL_LAYOUT_TEST_CONFIG__?: GoalLayoutTestConfig;
    };
    if (config) {
      windowWithConfig.__EXOMIND_GOAL_LAYOUT_TEST_CONFIG__ = config;
      return;
    }
    delete windowWithConfig.__EXOMIND_GOAL_LAYOUT_TEST_CONFIG__;
  }, {
    config: layoutTestConfig,
    graph: null as PersistedGoalGraph | null,
  });
}

async function primeGoalsPageWithGraph(
  page: Page,
  graph: PersistedGoalGraph,
  layoutTestConfig: GoalLayoutTestConfig | null = null,
) {
  await page.addInitScript(({ config, persistedGraph }) => {
    localStorage.setItem('exomind:goalsPageEnabled', 'true');
    localStorage.setItem('exomind:developerMode', 'true');
    localStorage.setItem('exomind:goal-graph', JSON.stringify(persistedGraph));
    localStorage.setItem('exomind:goal-oplog', '[]');
    localStorage.removeItem('exomind:goals-guide-hidden');
    const windowWithConfig = window as typeof window & {
      __EXOMIND_GOAL_LAYOUT_TEST_CONFIG__?: GoalLayoutTestConfig;
    };
    if (config) {
      windowWithConfig.__EXOMIND_GOAL_LAYOUT_TEST_CONFIG__ = config;
      return;
    }
    delete windowWithConfig.__EXOMIND_GOAL_LAYOUT_TEST_CONFIG__;
  }, {
    config: layoutTestConfig,
    persistedGraph: graph,
  });
}

async function primeGoalsPageWithStoredGraph(
  page: Page,
  storedGraph: PersistedGoalGraph | LegacyPersistedGoalGraph,
  layoutTestConfig: GoalLayoutTestConfig | null = null,
) {
  await page.addInitScript(({ config, persistedGraph }) => {
    localStorage.setItem('exomind:goalsPageEnabled', 'true');
    localStorage.setItem('exomind:developerMode', 'true');
    localStorage.setItem('exomind:goal-graph', JSON.stringify(persistedGraph));
    localStorage.setItem('exomind:goal-oplog', '[]');
    localStorage.removeItem('exomind:goals-guide-hidden');
    const windowWithConfig = window as typeof window & {
      __EXOMIND_GOAL_LAYOUT_TEST_CONFIG__?: GoalLayoutTestConfig;
    };
    if (config) {
      windowWithConfig.__EXOMIND_GOAL_LAYOUT_TEST_CONFIG__ = config;
      return;
    }
    delete windowWithConfig.__EXOMIND_GOAL_LAYOUT_TEST_CONFIG__;
  }, {
    config: layoutTestConfig,
    persistedGraph: storedGraph,
  });
}

async function openNodeContextMenu(page: Page, testId: string, clientX: number, clientY: number) {
  const locator = page.getByTestId(testId);
  await locator.evaluate((element, point) => {
    element.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2,
      buttons: 2,
      clientX: point.clientX,
      clientY: point.clientY,
      screenX: point.clientX,
      screenY: point.clientY,
      view: window,
    }));
  }, {
    clientX,
    clientY,
  });
}

function trackGoalWarnings(page: Page): string[] {
  const { goalWarnings } = createGoalWarningTracker(page);
  return goalWarnings;
}

function createGoalWarningTracker(page: Page) {
  const goalWarnings: string[] = [];
  const handler = (message: any) => {
    if (message.type() !== 'warning') return;
    const text = message.text();
    if (!text.includes('[goals][#747]')) return;
    goalWarnings.push(text);
  };
  page.on('console', handler);
  return {
    goalWarnings,
    detach: () => page.off('console', handler),
  };
}

interface RenderVisibilitySnapshot {
  nodeCount: number;
  edgeCount: number;
  hiddenNodeIds: string[];
  hiddenEdgeIds: string[];
}

async function snapshotRenderVisibility(page: Page): Promise<RenderVisibilitySnapshot> {
  return page.evaluate(() => {
    const nodeElements = Array.from(document.querySelectorAll('[data-testid^="goal-flow-node-"]'))
      .filter((element) => !(element.getAttribute('data-testid') ?? '').startsWith('goal-flow-node-progress-pulse-')) as HTMLElement[];
    const edgeElements = Array.from(document.querySelectorAll('[data-testid^="task-flow-edge-visible-"]')) as SVGElement[];

    const hiddenNodeIds = nodeElements
      .filter((element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility === 'hidden'
          || style.display === 'none'
          || Number.parseFloat(style.opacity || '1') <= 0.01
          || rect.width <= 0
          || rect.height <= 0;
      })
      .map((element) => element.getAttribute('data-testid') ?? 'unknown-node');

    const hiddenEdgeIds = edgeElements
      .filter((element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility === 'hidden'
          || style.display === 'none'
          || Number.parseFloat(style.opacity || '1') <= 0.01
          || rect.width <= 0
          || rect.height <= 0;
      })
      .map((element) => element.getAttribute('data-testid') ?? 'unknown-edge');

    return {
      nodeCount: nodeElements.length,
      edgeCount: edgeElements.length,
      hiddenNodeIds,
      hiddenEdgeIds,
    };
  });
}

function expectVisibleGraphSnapshot(
  snapshot: RenderVisibilitySnapshot,
  expectedNodeCount: number,
  expectedEdgeCount: number,
  sampleLabel: string,
) {
  expect(
    snapshot.nodeCount,
    `${sampleLabel}: expected ${expectedNodeCount} nodes, got ${snapshot.nodeCount}`,
  ).toBe(expectedNodeCount);
  expect(
    snapshot.edgeCount,
    `${sampleLabel}: expected ${expectedEdgeCount} visible edges, got ${snapshot.edgeCount}`,
  ).toBe(expectedEdgeCount);
  expect(
    snapshot.hiddenNodeIds,
    `${sampleLabel}: expected all nodes to stay visible`,
  ).toEqual([]);
  expect(
    snapshot.hiddenEdgeIds,
    `${sampleLabel}: expected all edges to stay visible`,
  ).toEqual([]);
}

async function readViewportTransform(page: Page) {
  return page.evaluate(() => {
    const viewport = document.querySelector('.react-flow__viewport') as HTMLElement | SVGElement | null;
    if (!viewport) return null;
    return {
      transform: window.getComputedStyle(viewport).transform,
      attribute: viewport.getAttribute('transform'),
    };
  });
}

async function gotoGoalsPage(page: Page) {
  await page.goto('/goals', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('goals-page')).toBeVisible({ timeout: 20000 });
}

function makeSingleEdgeGraph(): PersistedGoalGraph {
  return {
    me: { id: 'me', name: 'Me' },
    goals: [
      {
        id: 'goal-a',
        title: 'A',
        description: '',
        cancelled: false,
        completionRule: [['edge-me-a']],
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    edges: [
      {
        id: 'edge-me-a',
        title: 'Edge A',
        description: '',
        source: 'me',
        target: 'goal-a',
        createdAt: 1,
        updatedAt: 1,
      },
    ],
  };
}

function makeDuplicateEdgeGraph(): PersistedGoalGraph {
  return {
    me: { id: 'me', name: 'Me' },
    goals: [
      {
        id: 'goal-a',
        title: 'A',
        description: '',
        cancelled: false,
        completionRule: [['edge-me-a-1'], ['edge-me-a-2']],
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    edges: [
      {
        id: 'edge-me-a-1',
        title: 'Edge A1',
        description: '',
        source: 'me',
        target: 'goal-a',
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'edge-me-a-2',
        title: 'Edge A2',
        description: '',
        source: 'me',
        target: 'goal-a',
        createdAt: 2,
        updatedAt: 2,
      },
    ],
  };
}

function makeStarGraph(): PersistedGoalGraph {
  return {
    me: { id: 'me', name: 'Me' },
    goals: [
      {
        id: 'goal-a',
        title: 'A',
        description: '',
        cancelled: false,
        completionRule: [['edge-me-a']],
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'goal-b',
        title: 'B',
        description: '',
        cancelled: false,
        completionRule: [['edge-me-b']],
        createdAt: 2,
        updatedAt: 2,
      },
    ],
    edges: [
      {
        id: 'edge-me-a',
        title: 'Edge A',
        description: '',
        source: 'me',
        target: 'goal-a',
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'edge-me-b',
        title: 'Edge B',
        description: '',
        source: 'me',
        target: 'goal-b',
        createdAt: 2,
        updatedAt: 2,
      },
    ],
  };
}

function makeHiddenCancelledSiblingGraph(): PersistedGoalGraph {
  return {
    me: { id: 'me', name: 'Me' },
    goals: [
      {
        id: 'goal-a',
        title: 'A',
        description: '',
        cancelled: false,
        completionRule: [['edge-me-a']],
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'goal-b',
        title: 'B',
        description: '',
        cancelled: true,
        completionRule: [['edge-me-b']],
        createdAt: 2,
        updatedAt: 2,
      },
    ],
    edges: [
      {
        id: 'edge-me-a',
        title: 'Edge A',
        description: '',
        source: 'me',
        target: 'goal-a',
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'edge-me-b',
        title: 'Edge B',
        description: '',
        source: 'me',
        target: 'goal-b',
        createdAt: 2,
        updatedAt: 2,
      },
    ],
  };
}

function makeShownCancelledGraph(): PersistedGoalGraph {
  return {
    me: { id: 'me', name: 'Me' },
    goals: [
      {
        id: 'goal-a',
        title: 'A',
        description: '',
        cancelled: false,
        completionRule: [['edge-me-a']],
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'goal-b',
        title: 'B',
        description: '',
        cancelled: true,
        completionRule: [['edge-me-b']],
        createdAt: 2,
        updatedAt: 2,
      },
    ],
    edges: [
      {
        id: 'edge-me-a',
        title: 'Edge A',
        description: '',
        source: 'me',
        target: 'goal-a',
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'edge-me-b',
        title: 'Edge B',
        description: '',
        source: 'me',
        target: 'goal-b',
        createdAt: 2,
        updatedAt: 2,
      },
    ],
  };
}

function makeLegacySemanticEdgeGraph(
  edgeStatus: 'in_progress' | 'suspended' | 'completed' | 'cancelled',
): LegacyPersistedGoalGraph {
  return {
    goals: [
      {
        id: 'me',
        name: 'Me',
        status: 'pending',
        achieveMode: 'OR',
        isMe: true,
      },
      {
        id: 'goal-a',
        name: 'A',
        status: 'pending',
        achieveMode: 'AND',
        isMe: false,
      },
    ],
    tasks: [
      {
        id: `edge-me-a-${edgeStatus}`,
        name: `Edge ${edgeStatus}`,
        source: 'me',
        target: 'goal-a',
        status: edgeStatus,
      },
    ],
  };
}

async function createThreeNodeChain(page: Page) {
  await gotoGoalsPage(page);
  await expect(page.getByTestId('goal-flow-node-me')).toBeVisible({ timeout: 10000 });

  await openNodeContextMenu(page, 'goal-flow-node-me', 120, 120);
  await expect(page.getByTestId('goal-context-menu')).toBeVisible();
  await page.getByTestId('goal-context-item-downstream').click();
  await expect(page.locator('[data-testid^="goal-flow-node-"]')).toHaveCount(2);

  const firstGoal = page.locator('[data-testid^="goal-flow-node-"]').nth(1);
  const firstGoalId = await firstGoal.getAttribute('data-testid');
  if (!firstGoalId) {
    throw new Error('expected first goal node test id');
  }

  await openNodeContextMenu(page, firstGoalId, 220, 180);
  await page.getByTestId('goal-context-item-downstream').click();
  await expect(page.locator('[data-testid^="goal-flow-node-"]')).toHaveCount(3);

  return { firstGoalId };
}

async function measureThreeNodeGeometry(page: Page, goalATestId: string) {
  return page.evaluate((resolvedGoalATestId) => {
    const me = document.querySelector('[data-testid="goal-flow-node-me"]') as HTMLElement | null;
    const goalA = document.querySelector(`[data-testid="${resolvedGoalATestId}"]`) as HTMLElement | null;
    const goalB = Array.from(document.querySelectorAll('[data-testid^="goal-flow-node-"]'))
      .find((node) => (
        node.getAttribute('data-testid') !== 'goal-flow-node-me'
        && node.getAttribute('data-testid') !== resolvedGoalATestId
      )) as HTMLElement | null;

    if (!me || !goalA || !goalB) {
      return null;
    }

    const getCenter = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      return {
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
      };
    };

    const meCenter = getCenter(me);
    const aCenter = getCenter(goalA);
    const bCenter = getCenter(goalB);

    const distMA = Math.hypot(aCenter.x - meCenter.x, aCenter.y - meCenter.y);
    const distMB = Math.hypot(bCenter.x - meCenter.x, bCenter.y - meCenter.y);
    const distAB = Math.hypot(bCenter.x - aCenter.x, bCenter.y - aCenter.y);
    const vectorAB = {
      x: bCenter.x - aCenter.x,
      y: bCenter.y - aCenter.y,
    };
    const vectorAMe = {
      x: meCenter.x - aCenter.x,
      y: meCenter.y - aCenter.y,
    };
    const dot = vectorAB.x * vectorAMe.x + vectorAB.y * vectorAMe.y;
    const magnitude = Math.hypot(vectorAB.x, vectorAB.y) * Math.hypot(vectorAMe.x, vectorAMe.y);
    const angle = magnitude === 0 ? 0 : Math.acos(Math.max(-1, Math.min(1, dot / magnitude))) * 180 / Math.PI;

    return {
      distMA,
      distMB,
      distAB,
      angle,
    };
  }, goalATestId);
}

async function measureSingleVisibleGoalDirection(page: Page, goalTestId: string) {
  return page.evaluate((resolvedGoalTestId) => {
    const me = document.querySelector('[data-testid="goal-flow-node-me"]') as HTMLElement | null;
    const goal = document.querySelector(`[data-testid="${resolvedGoalTestId}"]`) as HTMLElement | null;
    const edge = document.querySelector('[data-testid="task-flow-edge-visible-edge-me-a"]') as SVGPathElement | null;
    if (!me || !goal || !edge) {
      return null;
    }

    const getCenter = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      return {
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
      };
    };

    const meCenter = getCenter(me);
    const goalCenter = getCenter(goal);

    return {
      angleDeg: Math.atan2(goalCenter.y - meCenter.y, goalCenter.x - meCenter.x) * 180 / Math.PI,
      edgePath: edge.getAttribute('d') ?? '',
      meCenter,
      goalCenter,
    };
  }, goalTestId);
}

async function runThreeNodeSample(page: Page, layoutTestConfig: GoalLayoutTestConfig | null = null) {
  await primeGoalsPage(page, layoutTestConfig);
  const tracker = createGoalWarningTracker(page);
  try {
    const { goalWarnings } = tracker;
    const { firstGoalId } = await createThreeNodeChain(page);
    const settleStartAt = performance.now();

    await expect
      .poll(() => goalWarnings.some((entry) => entry.includes('simulation:end')), {
        timeout: 30000,
        message: 'expected simulation:end warn log for three-node chain within 30s',
      })
      .toBe(true);

    const settledInMs = Math.round(performance.now() - settleStartAt);
    await expect(page.locator('[data-testid^="goal-flow-node-"]')).toHaveCount(3);
    await expect
      .poll(() => measureThreeNodeGeometry(page, firstGoalId), {
        timeout: 2000,
        message: 'expected measurable three-node geometry after the final layout paint',
      })
      .not.toBeNull();
    const geometry = await measureThreeNodeGeometry(page, firstGoalId);
    return {
      geometry,
      goalWarnings,
      settledInMs,
    };
  } finally {
    tracker.detach();
  }
}

function expectThreeNodeConstraints(
  geometry: ThreeNodeGeometry | null,
  settledInMs: number,
  sampleLabel: string,
) {
  const edgeLengthBalanceMin = 4 / 5;
  const edgeLengthBalanceMax = 5 / 4;
  const hopDistanceSeparationMin = 8 / 5;
  const hopDistanceSeparationMax = 12 / 5;
  const edgeRatio = (geometry?.distAB ?? 0) / Math.max(geometry?.distMA ?? 1, 1);
  const hopRatio = (geometry?.distMB ?? 0) / Math.max(geometry?.distMA ?? 1, 1);
  const summary = geometry
    ? `MA=${geometry.distMA.toFixed(2)}, MB=${geometry.distMB.toFixed(2)}, AB=${geometry.distAB.toFixed(2)}, angle=${geometry.angle.toFixed(2)}, edgeRatio=${edgeRatio.toFixed(3)}, hopRatio=${hopRatio.toFixed(3)}`
    : 'geometry=null';
  expect(geometry, `${sampleLabel}: expected measurable three-node geometry (${summary})`).not.toBeNull();
  expect(settledInMs, `${sampleLabel}: expected layout to settle within 30s (${summary})`).toBeLessThanOrEqual(30000);
  expect(
    hopRatio,
    `${sampleLabel}: expected hop-distance-separation >= ${hopDistanceSeparationMin} (${summary})`,
  ).toBeGreaterThanOrEqual(hopDistanceSeparationMin);
  expect(
    hopRatio,
    `${sampleLabel}: expected hop-distance-separation <= ${hopDistanceSeparationMax} (${summary})`,
  ).toBeLessThanOrEqual(hopDistanceSeparationMax);
  expect(
    edgeRatio,
    `${sampleLabel}: expected edge-length-balance >= ${edgeLengthBalanceMin} (${summary})`,
  ).toBeGreaterThanOrEqual(edgeLengthBalanceMin);
  expect(
    edgeRatio,
    `${sampleLabel}: expected edge-length-balance <= ${edgeLengthBalanceMax} (${summary})`,
  ).toBeLessThanOrEqual(edgeLengthBalanceMax);
  expect(
    geometry?.angle ?? 0,
    `${sampleLabel}: expected chain-opening-angle to exceed 120deg (${summary})`,
  ).toBeGreaterThan(120);
}

test.describe('Issue #747 goal layout stability diagnostics', () => {
  test.setTimeout(720000);

  test.beforeEach(async ({ page }) => {
    await primeGoalsPage(page);
  });

  test('keeps nodes visible after simulation settles and emits traceable warn logs', async ({ page }) => {
    const goalWarnings = trackGoalWarnings(page);

    await gotoGoalsPage(page);

    const meNode = page.getByTestId('goal-flow-node-me');
    await expect(meNode).toBeVisible({ timeout: 10000 });
    await openNodeContextMenu(page, 'goal-flow-node-me', 120, 120);
    await expect(page.getByTestId('goal-context-menu')).toBeVisible();
    await page.getByTestId('goal-context-item-downstream').click();

    await expect(page.locator('[data-testid^="goal-flow-node-"]')).toHaveCount(2);
    await expect(page.locator('[data-testid^="task-flow-edge-hit-area-"]')).toHaveCount(1);
    await expect(page.locator('[data-testid^="task-flow-edge-label-"]')).toHaveCount(1);

    await expect
      .poll(() => goalWarnings.some((entry) => entry.includes('simulation:end')), {
        timeout: 15000,
        message: 'expected simulation:end warn log after force layout settles',
      })
      .toBe(true);

    await expect(page.locator('[data-testid^="goal-flow-node-"]')).toHaveCount(2);
    await expect(page.getByTestId('goal-flow-node-me')).toBeVisible();
    await expect(page.locator('[data-testid^="task-flow-edge-hit-area-"]')).toHaveCount(1);
    await expect(page.locator('[data-testid^="task-flow-edge-label-"]')).toHaveCount(1);

    const visibilityMetrics = await page.evaluate(() => (
      Array.from(document.querySelectorAll('[data-testid^="goal-flow-node-"]')).map((node) => {
        const element = node as HTMLElement;
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return {
          testId: element.getAttribute('data-testid'),
          visibility: style.visibility,
          display: style.display,
          opacity: Number.parseFloat(style.opacity || '1'),
          width: rect.width,
          height: rect.height,
        };
      })
    ));

    expect(visibilityMetrics).toHaveLength(2);
    for (const metric of visibilityMetrics) {
      expect(metric.visibility).not.toBe('hidden');
      expect(metric.display).not.toBe('none');
      expect(metric.opacity).toBeGreaterThan(0.01);
      expect(metric.width).toBeGreaterThan(0);
      expect(metric.height).toBeGreaterThan(0);
    }

    expect(goalWarnings.some((entry) => entry.includes('simulation:init'))).toBe(true);
    expect(goalWarnings.some((entry) => entry.includes('page:render-health'))).toBe(true);
    expect(goalWarnings.some((entry) => entry.includes('page:suspect-render-state'))).toBe(false);
  });

  test('keeps nodes and edges visible while the goal force simulation is still moving', async ({ page }) => {
    const goalWarnings = trackGoalWarnings(page);

    await gotoGoalsPage(page);
    await expect(page.getByTestId('goal-flow-node-me')).toBeVisible({ timeout: 10000 });

    await openNodeContextMenu(page, 'goal-flow-node-me', 120, 120);
    await expect(page.getByTestId('goal-context-menu')).toBeVisible();
    await page.getByTestId('goal-context-item-downstream').click();
    await expect(page.locator('[data-testid^="goal-flow-node-"]')).toHaveCount(2);

    const tickCountBeforeGrowth = goalWarnings.filter((entry) => entry.includes('simulation:tick')).length;
    const endCountBeforeGrowth = goalWarnings.filter((entry) => entry.includes('simulation:end')).length;

    const firstGoalTestId = await page.locator('[data-testid^="goal-flow-node-"]').nth(1).getAttribute('data-testid');
    if (!firstGoalTestId) {
      throw new Error('expected first goal node test id for moving-state coverage');
    }

    await openNodeContextMenu(page, firstGoalTestId, 220, 180);
    await page.getByTestId('goal-context-item-downstream').click();
    await expect(page.locator('[data-testid^="goal-flow-node-"]')).toHaveCount(3);
    await expect(page.locator('[data-testid^="task-flow-edge-hit-area-"]')).toHaveCount(2);

    await expect
      .poll(() => {
        const tickCount = goalWarnings.filter((entry) => entry.includes('simulation:tick')).length;
        const endCount = goalWarnings.filter((entry) => entry.includes('simulation:end')).length;
        return tickCount > tickCountBeforeGrowth && endCount === endCountBeforeGrowth;
      }, {
        timeout: 5000,
        message: 'expected a moving simulation window after graph growth before the next simulation:end',
      })
      .toBe(true);

    expectVisibleGraphSnapshot(
      await snapshotRenderVisibility(page),
      3,
      2,
      'moving-simulation-window',
    );

    await expect
      .poll(() => goalWarnings.filter((entry) => entry.includes('simulation:end')).length, {
        timeout: 15000,
        message: 'expected simulation:end warn log after moving-state visibility assertions',
      })
      .toBeGreaterThan(endCountBeforeGrowth);

    expectVisibleGraphSnapshot(
      await snapshotRenderVisibility(page),
      3,
      2,
      'moving-simulation-settled',
    );

    expect(goalWarnings.some((entry) => entry.includes('page:suspect-render-state'))).toBe(false);
  });

  test('keeps the graph stable when selecting a goal and opening detail before the simulation settles', async ({ page }) => {
    const goalWarnings = trackGoalWarnings(page);

    await gotoGoalsPage(page);
    await expect(page.getByTestId('goal-flow-node-me')).toBeVisible({ timeout: 10000 });

    await openNodeContextMenu(page, 'goal-flow-node-me', 120, 120);
    await expect(page.getByTestId('goal-context-menu')).toBeVisible();
    await page.getByTestId('goal-context-item-downstream').click();
    await expect(page.locator('[data-testid^="goal-flow-node-"]')).toHaveCount(2);

    const tickCountBeforeGrowth = goalWarnings.filter((entry) => entry.includes('simulation:tick')).length;
    const endCountBeforeGrowth = goalWarnings.filter((entry) => entry.includes('simulation:end')).length;

    const firstGoalTestId = await page.locator('[data-testid^="goal-flow-node-"]').nth(1).getAttribute('data-testid');
    if (!firstGoalTestId) {
      throw new Error('expected first goal node test id for moving-selection coverage');
    }

    await openNodeContextMenu(page, firstGoalTestId, 220, 180);
    await page.getByTestId('goal-context-item-downstream').click();
    await expect(page.locator('[data-testid^="goal-flow-node-"]')).toHaveCount(3);
    await expect(page.locator('[data-testid^="task-flow-edge-visible-"]')).toHaveCount(2);

    await expect
      .poll(() => {
        const tickCount = goalWarnings.filter((entry) => entry.includes('simulation:tick')).length;
        const endCount = goalWarnings.filter((entry) => entry.includes('simulation:end')).length;
        return tickCount > tickCountBeforeGrowth && endCount === endCountBeforeGrowth;
      }, {
        timeout: 5000,
        message: 'expected a moving simulation window before opening goal detail',
      })
      .toBe(true);

    await page.getByTestId(firstGoalTestId).click();
    const detailPanel = page.getByTestId('goals-page').getByRole('complementary');
    await expect(detailPanel).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('目标详情')).toBeVisible({ timeout: 10000 });

    expectVisibleGraphSnapshot(
      await snapshotRenderVisibility(page),
      3,
      2,
      'moving-selection:detail-open-before-settle',
    );

    await expect
      .poll(() => goalWarnings.filter((entry) => entry.includes('simulation:end')).length, {
        timeout: 15000,
        message: 'expected simulation:end warn log after opening detail during motion',
      })
      .toBeGreaterThan(endCountBeforeGrowth);

    await expect(detailPanel).toBeVisible();
    expectVisibleGraphSnapshot(
      await snapshotRenderVisibility(page),
      3,
      2,
      'moving-selection:detail-open-after-settle',
    );

    expect(goalWarnings.some((entry) => entry.includes('page:suspect-render-state'))).toBe(false);
  });

  test('keeps the graph stable when opening edge detail before the simulation settles', async ({ page }) => {
    const goalWarnings = trackGoalWarnings(page);

    await gotoGoalsPage(page);
    await expect(page.getByTestId('goal-flow-node-me')).toBeVisible({ timeout: 10000 });

    await openNodeContextMenu(page, 'goal-flow-node-me', 120, 120);
    await expect(page.getByTestId('goal-context-menu')).toBeVisible();
    await page.getByTestId('goal-context-item-downstream').click();
    await expect(page.locator('[data-testid^="goal-flow-node-"]')).toHaveCount(2);

    const tickCountBeforeGrowth = goalWarnings.filter((entry) => entry.includes('simulation:tick')).length;
    const endCountBeforeGrowth = goalWarnings.filter((entry) => entry.includes('simulation:end')).length;

    const firstGoalTestId = await page.locator('[data-testid^="goal-flow-node-"]').nth(1).getAttribute('data-testid');
    if (!firstGoalTestId) {
      throw new Error('expected first goal node test id for moving-edge-detail coverage');
    }

    await openNodeContextMenu(page, firstGoalTestId, 220, 180);
    await page.getByTestId('goal-context-item-downstream').click();
    await expect(page.locator('[data-testid^="goal-flow-node-"]')).toHaveCount(3);
    await expect(page.locator('[data-testid^="task-flow-edge-visible-"]')).toHaveCount(2);

    await expect
      .poll(() => {
        const tickCount = goalWarnings.filter((entry) => entry.includes('simulation:tick')).length;
        const endCount = goalWarnings.filter((entry) => entry.includes('simulation:end')).length;
        return tickCount > tickCountBeforeGrowth && endCount === endCountBeforeGrowth;
      }, {
        timeout: 5000,
        message: 'expected a moving simulation window before opening edge detail',
      })
      .toBe(true);

    const edgeHitArea = page.locator('[data-testid^="task-flow-edge-hit-area-"]').first();
    const edgeBox = await edgeHitArea.boundingBox();
    expect(edgeBox, 'moving-edge-detail: expected measurable edge hit area').not.toBeNull();
    if (!edgeBox) {
      throw new Error('expected edge hit area bounding box for moving-edge-detail coverage');
    }

    await page.mouse.click(edgeBox.x + edgeBox.width / 2, edgeBox.y + edgeBox.height / 2, { button: 'right' });
    const edgeDetailPanel = page.getByTestId('goals-page').getByRole('complementary');
    await expect(edgeDetailPanel).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('路径详情')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid^="task-flow-edge-visible-"]')).toHaveCount(2);
    await expect(page.locator('[data-testid^="task-flow-edge-label-"]')).toHaveCount(2);

    expectVisibleGraphSnapshot(
      await snapshotRenderVisibility(page),
      3,
      2,
      'moving-edge-detail:detail-open-before-settle',
    );

    await expect
      .poll(() => goalWarnings.filter((entry) => entry.includes('simulation:end')).length, {
        timeout: 15000,
        message: 'expected simulation:end warn log after opening edge detail during motion',
      })
      .toBeGreaterThan(endCountBeforeGrowth);

    await expect(edgeDetailPanel).toBeVisible();
    await expect(page.getByText('路径详情')).toBeVisible();
    expectVisibleGraphSnapshot(
      await snapshotRenderVisibility(page),
      3,
      2,
      'moving-edge-detail:detail-open-after-settle',
    );

    expect(goalWarnings.some((entry) => entry.includes('page:suspect-render-state'))).toBe(false);
  });

  test('keeps the graph stable when zooming and panning before the simulation settles', async ({ page }) => {
    const goalWarnings = trackGoalWarnings(page);

    await gotoGoalsPage(page);
    await expect(page.getByTestId('goal-flow-node-me')).toBeVisible({ timeout: 10000 });

    await openNodeContextMenu(page, 'goal-flow-node-me', 120, 120);
    await expect(page.getByTestId('goal-context-menu')).toBeVisible();
    await page.getByTestId('goal-context-item-downstream').click();
    await expect(page.locator('[data-testid^="goal-flow-node-"]')).toHaveCount(2);

    const tickCountBeforeGrowth = goalWarnings.filter((entry) => entry.includes('simulation:tick')).length;
    const endCountBeforeGrowth = goalWarnings.filter((entry) => entry.includes('simulation:end')).length;

    const firstGoalTestId = await page.locator('[data-testid^="goal-flow-node-"]').nth(1).getAttribute('data-testid');
    if (!firstGoalTestId) {
      throw new Error('expected first goal node test id for moving-viewport coverage');
    }

    await openNodeContextMenu(page, firstGoalTestId, 220, 180);
    await page.getByTestId('goal-context-item-downstream').click();
    await expect(page.locator('[data-testid^="goal-flow-node-"]')).toHaveCount(3);
    await expect(page.locator('[data-testid^="task-flow-edge-visible-"]')).toHaveCount(2);

    await expect
      .poll(() => {
        const tickCount = goalWarnings.filter((entry) => entry.includes('simulation:tick')).length;
        const endCount = goalWarnings.filter((entry) => entry.includes('simulation:end')).length;
        return tickCount > tickCountBeforeGrowth && endCount === endCountBeforeGrowth;
      }, {
        timeout: 5000,
        message: 'expected a moving simulation window before zooming and panning',
      })
      .toBe(true);

    const viewportBeforeZoom = await readViewportTransform(page);
    const renderer = page.locator('.react-flow__renderer');
    await renderer.hover();
    await page.mouse.wheel(0, -320);

    await expect
      .poll(async () => {
        const viewportAfterZoom = await readViewportTransform(page);
        const endCount = goalWarnings.filter((entry) => entry.includes('simulation:end')).length;
        return {
          viewportChanged: JSON.stringify(viewportAfterZoom) !== JSON.stringify(viewportBeforeZoom),
          stillMoving: endCount === endCountBeforeGrowth,
        };
      }, {
        timeout: 4000,
        message: 'expected viewport transform to change after zoom during the moving simulation window',
      })
      .toEqual({
        viewportChanged: true,
        stillMoving: true,
      });

    expectVisibleGraphSnapshot(
      await snapshotRenderVisibility(page),
      3,
      2,
      'moving-viewport:after-zoom-before-settle',
    );

    const viewportAfterZoom = await readViewportTransform(page);
    await page.keyboard.down('Space');
    await page.mouse.wheel(120, 96);
    await page.keyboard.up('Space');

    await expect
      .poll(async () => {
        const viewportAfterPan = await readViewportTransform(page);
        const endCount = goalWarnings.filter((entry) => entry.includes('simulation:end')).length;
        return {
          viewportChanged: JSON.stringify(viewportAfterPan) !== JSON.stringify(viewportAfterZoom),
          stillMoving: endCount === endCountBeforeGrowth,
        };
      }, {
        timeout: 4000,
        message: 'expected viewport transform to change after pan during the moving simulation window',
      })
      .toEqual({
        viewportChanged: true,
        stillMoving: true,
      });

    expectVisibleGraphSnapshot(
      await snapshotRenderVisibility(page),
      3,
      2,
      'moving-viewport:after-pan-before-settle',
    );

    await expect
      .poll(() => goalWarnings.filter((entry) => entry.includes('simulation:end')).length, {
        timeout: 15000,
        message: 'expected simulation:end warn log after moving viewport interactions',
      })
      .toBeGreaterThan(endCountBeforeGrowth);

    expectVisibleGraphSnapshot(
      await snapshotRenderVisibility(page),
      3,
      2,
      'moving-viewport:after-pan-after-settle',
    );

    expect(goalWarnings.some((entry) => entry.includes('page:suspect-render-state'))).toBe(false);
  });

  test('keeps the graph stable while dragging a goal node and releasing it', async ({ page }) => {
    const goalWarnings = trackGoalWarnings(page);
    const countSimulationEnds = () => goalWarnings.filter((entry) => entry.includes('simulation:end')).length;

    await gotoGoalsPage(page);
    await expect(page.getByTestId('goal-flow-node-me')).toBeVisible({ timeout: 10000 });

    await openNodeContextMenu(page, 'goal-flow-node-me', 120, 120);
    await expect(page.getByTestId('goal-context-menu')).toBeVisible();
    await page.getByTestId('goal-context-item-downstream').click();
    await expect(page.locator('[data-testid^="goal-flow-node-"]')).toHaveCount(2);

    const firstGoalTestId = await page.locator('[data-testid^="goal-flow-node-"]').nth(1).getAttribute('data-testid');
    if (!firstGoalTestId) {
      throw new Error('expected first goal node test id for node-drag coverage');
    }

    await openNodeContextMenu(page, firstGoalTestId, 220, 180);
    await page.getByTestId('goal-context-item-downstream').click();
    await expect(page.locator('[data-testid^="goal-flow-node-"]')).toHaveCount(3);
    await expect(page.locator('[data-testid^="task-flow-edge-visible-"]')).toHaveCount(2);
    await expect(page.getByTestId('goals-hop-rings')).toBeVisible({ timeout: 10000 });
    const openDetailPanel = page.getByTestId('goals-page').getByRole('complementary');
    if (await openDetailPanel.count()) {
      await openDetailPanel.getByRole('button').first().click();
      await expect(openDetailPanel).toHaveCount(0);
    }

    await expect
      .poll(() => countSimulationEnds(), {
        timeout: 15000,
        message: 'expected simulation:end warn log before node-drag stability assertions',
      })
      .toBeGreaterThanOrEqual(1);

    const secondGoalTestId = await page.locator('[data-testid^="goal-flow-node-"]').nth(2).getAttribute('data-testid');
    if (!secondGoalTestId) {
      throw new Error('expected second goal node test id for node-drag coverage');
    }

    const readDragMetrics = () => page.evaluate(({ draggedGoalTestId, siblingGoalTestId }) => {
      const me = document.querySelector('[data-testid="goal-flow-node-me"]') as HTMLElement | null;
      const draggedGoal = document.querySelector(`[data-testid="${draggedGoalTestId}"]`) as HTMLElement | null;
      const siblingGoal = document.querySelector(`[data-testid="${siblingGoalTestId}"]`) as HTMLElement | null;
      const ring1 = document.querySelector('[data-testid="goals-hop-ring-1"] circle') as SVGCircleElement | null;
      const ring2 = document.querySelector('[data-testid="goals-hop-ring-2"] circle') as SVGCircleElement | null;
      if (!me || !draggedGoal || !siblingGoal || !ring1 || !ring2) {
        return null;
      }

      const getCenter = (element: Element) => {
        const rect = (element as HTMLElement | SVGElement).getBoundingClientRect();
        return {
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
        };
      };

      return {
        meCenter: getCenter(me),
        draggedGoalCenter: getCenter(draggedGoal),
        siblingGoalCenter: getCenter(siblingGoal),
        ring1Center: getCenter(ring1),
        ring2Center: getCenter(ring2),
      };
    }, {
      draggedGoalTestId: firstGoalTestId,
      siblingGoalTestId: secondGoalTestId,
    });

    const baselineMetrics = await readDragMetrics();
    expect(baselineMetrics, 'node-drag: expected measurable baseline metrics').not.toBeNull();

    const draggedGoal = page.locator(`.react-flow__node:has([data-testid="${firstGoalTestId}"])`);
    const draggedGoalBox = await draggedGoal.boundingBox();
    expect(draggedGoalBox, 'node-drag: expected measurable dragged goal box').not.toBeNull();
    if (!draggedGoalBox) {
      throw new Error('expected dragged goal bounding box for node-drag coverage');
    }

    const dragStartX = draggedGoalBox.x + draggedGoalBox.width / 2;
    const dragStartY = draggedGoalBox.y + draggedGoalBox.height / 2;
    const dragEndX = dragStartX + 84;
    const dragEndY = dragStartY + 56;
    const simulationEndCountBeforeDrag = countSimulationEnds();

    await page.mouse.move(dragStartX, dragStartY);
    await page.mouse.down();
    await page.mouse.move(dragEndX, dragEndY, { steps: 12 });

    await expect
      .poll(async () => {
        const dragMetrics = await readDragMetrics();
        if (!dragMetrics || !baselineMetrics) return null;
        const movedDistance = Math.hypot(
          dragMetrics.draggedGoalCenter.x - baselineMetrics.draggedGoalCenter.x,
          dragMetrics.draggedGoalCenter.y - baselineMetrics.draggedGoalCenter.y,
        );
        return {
          movedEnough: movedDistance >= 24,
          pinLogged: goalWarnings.some((entry) => entry.includes('simulation:pin-node') && entry.includes(firstGoalTestId.replace('goal-flow-node-', ''))),
          meStable:
            Math.abs(dragMetrics.meCenter.x - baselineMetrics.meCenter.x) <= 2
            && Math.abs(dragMetrics.meCenter.y - baselineMetrics.meCenter.y) <= 2,
          ringsAligned:
            Math.abs(dragMetrics.ring1Center.x - dragMetrics.meCenter.x) <= 6
            && Math.abs(dragMetrics.ring1Center.y - dragMetrics.meCenter.y) <= 6
            && Math.abs(dragMetrics.ring2Center.x - dragMetrics.meCenter.x) <= 6
            && Math.abs(dragMetrics.ring2Center.y - dragMetrics.meCenter.y) <= 6,
        };
      }, {
        timeout: 5000,
        message: 'expected node drag to move the goal while keeping Me and hop rings stable',
      })
      .toEqual({
        movedEnough: true,
        pinLogged: true,
        meStable: true,
        ringsAligned: true,
      });

    expectVisibleGraphSnapshot(
      await snapshotRenderVisibility(page),
      3,
      2,
      'node-drag:during-drag',
    );

    await page.mouse.up();

    await expect
      .poll(() => goalWarnings.some((entry) => entry.includes('simulation:release-node') && entry.includes(firstGoalTestId.replace('goal-flow-node-', ''))), {
        timeout: 5000,
        message: 'expected simulation:release-node warn log after goal drag stops',
      })
      .toBe(true);

    await expect
      .poll(() => countSimulationEnds(), {
        timeout: 15000,
        message: 'expected a new simulation:end warn log after releasing the dragged goal node',
      })
      .toBeGreaterThan(simulationEndCountBeforeDrag);

    const settledMetrics = await readDragMetrics();
    expect(settledMetrics, 'node-drag: expected measurable settled metrics').not.toBeNull();
    const settledMovedDistance = Math.hypot(
      (settledMetrics?.draggedGoalCenter.x ?? 0) - (baselineMetrics?.draggedGoalCenter.x ?? 0),
      (settledMetrics?.draggedGoalCenter.y ?? 0) - (baselineMetrics?.draggedGoalCenter.y ?? 0),
    );
    expect(settledMovedDistance, 'node-drag: expected dragged goal to remain meaningfully displaced after release').toBeGreaterThanOrEqual(24);
    expect(Math.abs((settledMetrics?.meCenter.x ?? 0) - (baselineMetrics?.meCenter.x ?? 0))).toBeLessThanOrEqual(2);
    expect(Math.abs((settledMetrics?.meCenter.y ?? 0) - (baselineMetrics?.meCenter.y ?? 0))).toBeLessThanOrEqual(2);
    expect(Math.abs((settledMetrics?.ring1Center.x ?? 0) - (settledMetrics?.meCenter.x ?? 0))).toBeLessThanOrEqual(6);
    expect(Math.abs((settledMetrics?.ring1Center.y ?? 0) - (settledMetrics?.meCenter.y ?? 0))).toBeLessThanOrEqual(6);
    expect(Math.abs((settledMetrics?.ring2Center.x ?? 0) - (settledMetrics?.meCenter.x ?? 0))).toBeLessThanOrEqual(6);
    expect(Math.abs((settledMetrics?.ring2Center.y ?? 0) - (settledMetrics?.meCenter.y ?? 0))).toBeLessThanOrEqual(6);

    expectVisibleGraphSnapshot(
      await snapshotRenderVisibility(page),
      3,
      2,
      'node-drag:after-release',
    );

    expect(goalWarnings.some((entry) => entry.includes('page:suspect-render-state'))).toBe(false);
  });

  test('keeps the graph stable when creating a new edge before the simulation settles', async ({ page }) => {
    const goalWarnings = trackGoalWarnings(page);
    const countSimulationEnds = () => goalWarnings.filter((entry) => entry.includes('simulation:end')).length;
    const countSimulationTicks = () => goalWarnings.filter((entry) => entry.includes('simulation:tick')).length;

    await gotoGoalsPage(page);
    await expect(page.getByTestId('goal-flow-node-me')).toBeVisible({ timeout: 10000 });

    await openNodeContextMenu(page, 'goal-flow-node-me', 120, 120);
    await expect(page.getByTestId('goal-context-menu')).toBeVisible();
    await page.getByTestId('goal-context-item-downstream').click();
    await expect(page.locator('[data-testid^="goal-flow-node-"]')).toHaveCount(2);

    const tickCountBeforeGrowth = countSimulationTicks();
    const endCountBeforeGrowth = countSimulationEnds();

    await openNodeContextMenu(page, 'goal-flow-node-me', 180, 150);
    await page.getByTestId('goal-context-item-downstream').click();
    await expect(page.locator('[data-testid^="goal-flow-node-"]')).toHaveCount(3);
    await expect(page.locator('[data-testid^="task-flow-edge-visible-"]')).toHaveCount(2);
    await expect(page.getByTestId('goals-hop-rings')).toBeVisible({ timeout: 10000 });

    await expect
      .poll(() => {
        const tickCount = countSimulationTicks();
        const endCount = countSimulationEnds();
        return tickCount > tickCountBeforeGrowth && endCount === endCountBeforeGrowth;
      }, {
        timeout: 5000,
        message: 'expected a moving simulation window before reconnecting an edge',
      })
      .toBe(true);

    const firstGoalTestId = await page.locator('[data-testid^="goal-flow-node-"]').nth(1).getAttribute('data-testid');
    const secondGoalTestId = await page.locator('[data-testid^="goal-flow-node-"]').nth(2).getAttribute('data-testid');
    if (!firstGoalTestId || !secondGoalTestId) {
      throw new Error('expected goal node test ids for edge-creation coverage');
    }

    const readReconnectMetrics = () => page.evaluate(({ targetGoalTestId }) => {
      const me = document.querySelector('[data-testid="goal-flow-node-me"]') as HTMLElement | null;
      const targetGoal = document.querySelector(`[data-testid="${targetGoalTestId}"]`) as HTMLElement | null;
      const ring1 = document.querySelector('[data-testid="goals-hop-ring-1"] circle') as SVGCircleElement | null;
      const goalsPage = document.querySelector('[data-testid="goals-page"]') as HTMLElement | null;
      const meWrapper = me?.closest('.react-flow__node') as HTMLElement | null;
      const targetGoalWrapper = targetGoal?.closest('.react-flow__node') as HTMLElement | null;
      const nodesContainer = document.querySelector('.react-flow__nodes') as HTMLElement | null;
      const reactFlowWrapper = document.querySelector('[data-testid="rf__wrapper"]') as HTMLElement | null;
      if (!me || !targetGoal || !ring1) {
        return null;
      }
      const getCenter = (element: Element) => {
        const rect = (element as HTMLElement | SVGElement).getBoundingClientRect();
        return {
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
        };
      };
      return {
        meCenter: getCenter(me),
        targetGoalCenter: getCenter(targetGoal),
        ring1Center: getCenter(ring1),
        scrollY: window.scrollY,
        pageTop: goalsPage?.getBoundingClientRect().top ?? null,
        meTransform: meWrapper?.style.transform ?? null,
        targetGoalTransform: targetGoalWrapper?.style.transform ?? null,
        meWrapperCenter: meWrapper ? getCenter(meWrapper) : null,
        nodesContainerTop: nodesContainer?.getBoundingClientRect().top ?? null,
        reactFlowScrollTop: reactFlowWrapper?.scrollTop ?? null,
        reactFlowScrollLeft: reactFlowWrapper?.scrollLeft ?? null,
      };
    }, {
      targetGoalTestId: secondGoalTestId,
    });

    await page.getByTestId(firstGoalTestId).click();
    await expect(page.getByTestId('goals-page').getByRole('complementary')).toBeVisible({ timeout: 10000 });

    const baselineMetrics = await readReconnectMetrics();
    expect(baselineMetrics, 'edge-create: expected measurable baseline metrics').not.toBeNull();
    const baselineViewport = await readViewportTransform(page);

    await openNodeContextMenu(page, firstGoalTestId, 220, 180);
    await page.getByTestId('goal-context-item-connect').click();
    await page.mouse.move(260, 200);
    await expect(page.getByTestId('goals-connect-preview')).toBeVisible({ timeout: 5000 });

    const simulationEndCountBeforeConnect = countSimulationEnds();
    await page.getByTestId(secondGoalTestId).click();

    await expect
      .poll(async () => {
        const visibility = await snapshotRenderVisibility(page);
        return {
          edgeCount: visibility.edgeCount,
          connectPreviewCleared: await page.getByTestId('goals-connect-preview').count() === 0,
        };
      }, {
        timeout: 5000,
        message: 'expected a new visible edge and cleared connect preview after creating a new edge during motion',
      })
      .toEqual({
        edgeCount: 3,
        connectPreviewCleared: true,
      });

    await expect
      .poll(async () => {
        const reconnectMetrics = await readReconnectMetrics();
        if (!reconnectMetrics || !baselineMetrics) return null;
        const viewportAfterConnect = await readViewportTransform(page);
        return {
          meStable:
            Math.abs(reconnectMetrics.meCenter.x - baselineMetrics.meCenter.x) <= 2
            && Math.abs(reconnectMetrics.meCenter.y - baselineMetrics.meCenter.y) <= 2,
          meDeltaX: Number((reconnectMetrics.meCenter.x - baselineMetrics.meCenter.x).toFixed(2)),
          meDeltaY: Number((reconnectMetrics.meCenter.y - baselineMetrics.meCenter.y).toFixed(2)),
          targetGoalDeltaX: Number((reconnectMetrics.targetGoalCenter.x - baselineMetrics.targetGoalCenter.x).toFixed(2)),
          targetGoalDeltaY: Number((reconnectMetrics.targetGoalCenter.y - baselineMetrics.targetGoalCenter.y).toFixed(2)),
          meWrapperDeltaY: Number((((reconnectMetrics.meWrapperCenter?.y ?? 0) - (baselineMetrics.meWrapperCenter?.y ?? 0))).toFixed(2)),
          scrollDeltaY: Number(((reconnectMetrics.scrollY ?? 0) - (baselineMetrics.scrollY ?? 0)).toFixed(2)),
          pageTopDeltaY: Number((((reconnectMetrics.pageTop ?? 0) - (baselineMetrics.pageTop ?? 0))).toFixed(2)),
          nodesContainerTopDeltaY: Number((((reconnectMetrics.nodesContainerTop ?? 0) - (baselineMetrics.nodesContainerTop ?? 0))).toFixed(2)),
          reactFlowScrollTopDeltaY: Number((((reconnectMetrics.reactFlowScrollTop ?? 0) - (baselineMetrics.reactFlowScrollTop ?? 0))).toFixed(2)),
          reactFlowScrollLeftDeltaX: Number((((reconnectMetrics.reactFlowScrollLeft ?? 0) - (baselineMetrics.reactFlowScrollLeft ?? 0))).toFixed(2)),
          ringsAligned:
            Math.abs(reconnectMetrics.ring1Center.x - reconnectMetrics.meCenter.x) <= 6
            && Math.abs(reconnectMetrics.ring1Center.y - reconnectMetrics.meCenter.y) <= 6,
          viewportChanged: JSON.stringify(viewportAfterConnect) !== JSON.stringify(baselineViewport),
          meTransformChanged: reconnectMetrics.meTransform !== baselineMetrics.meTransform,
          targetGoalTransformChanged: reconnectMetrics.targetGoalTransform !== baselineMetrics.targetGoalTransform,
        };
      }, {
        timeout: 5000,
        message: 'expected Me screen position and hop rings to remain stable while creating a new edge',
      })
      .toMatchObject({
        meStable: true,
        meDeltaX: 0,
        meDeltaY: 0,
        meWrapperDeltaY: 0,
        scrollDeltaY: 0,
        pageTopDeltaY: 0,
        nodesContainerTopDeltaY: 0,
        reactFlowScrollTopDeltaY: 0,
        reactFlowScrollLeftDeltaX: 0,
        ringsAligned: true,
        viewportChanged: false,
        meTransformChanged: false,
      });

    await expect(page.locator('[data-testid^="task-flow-edge-visible-"]')).toHaveCount(3);
    expectVisibleGraphSnapshot(
      await snapshotRenderVisibility(page),
      3,
      3,
      'edge-create:after-connect-before-settle',
    );

    await expect
      .poll(() => countSimulationEnds(), {
        timeout: 15000,
        message: 'expected a new simulation:end warn log after creating a new edge during motion',
      })
      .toBeGreaterThan(simulationEndCountBeforeConnect);

    await expect(page.locator('[data-testid^="task-flow-edge-visible-"]')).toHaveCount(3);
    expectVisibleGraphSnapshot(
      await snapshotRenderVisibility(page),
      3,
      3,
      'edge-create:after-connect-after-settle',
    );

    expect(goalWarnings.some((entry) => entry.includes('page:suspect-render-state'))).toBe(false);
  });

  test('keeps the graph stable when reconnecting an edge through the real edge updater', async ({ page }) => {
    const goalWarnings = trackGoalWarnings(page);
    const countSimulationEnds = () => goalWarnings.filter((entry) => entry.includes('simulation:end')).length;
    await primeGoalsPageWithGraph(page, makeStarGraph());
    await gotoGoalsPage(page);

    await expect(page.locator('[data-testid^="goal-flow-node-"]')).toHaveCount(3);
    await expect(page.locator('[data-testid^="task-flow-edge-visible-"]')).toHaveCount(2);
    await expect
      .poll(() => goalWarnings.some((entry) => entry.includes('simulation:end')), {
        timeout: 15000,
        message: 'expected simulation:end before reconnecting an edge through the browser',
      })
      .toBe(true);

    await page.getByRole('button', { name: '编辑' }).click();

    const readReconnectMetrics = () => page.evaluate(() => {
      const me = document.querySelector('[data-testid="goal-flow-node-me"]') as HTMLElement | null;
      const goalA = document.querySelector('[data-testid="goal-flow-node-goal-a"]') as HTMLElement | null;
      const goalB = document.querySelector('[data-testid="goal-flow-node-goal-b"]') as HTMLElement | null;
      const ring1 = document.querySelector('[data-testid="goals-hop-ring-1"] circle') as SVGCircleElement | null;
      const goalsPage = document.querySelector('[data-testid="goals-page"]') as HTMLElement | null;
      const meWrapper = me?.closest('.react-flow__node') as HTMLElement | null;
      const goalAWrapper = goalA?.closest('.react-flow__node') as HTMLElement | null;
      const goalBWrapper = goalB?.closest('.react-flow__node') as HTMLElement | null;
      const nodesContainer = document.querySelector('.react-flow__nodes') as HTMLElement | null;
      const reactFlowWrapper = document.querySelector('[data-testid="rf__wrapper"]') as HTMLElement | null;
      if (!me || !goalA || !goalB || !ring1) {
        return null;
      }
      const getCenter = (element: Element) => {
        const rect = (element as HTMLElement | SVGElement).getBoundingClientRect();
        return {
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
        };
      };
      return {
        meCenter: getCenter(me),
        goalACenter: getCenter(goalA),
        goalBCenter: getCenter(goalB),
        ring1Center: getCenter(ring1),
        scrollY: window.scrollY,
        pageTop: goalsPage?.getBoundingClientRect().top ?? null,
        meTransform: meWrapper?.style.transform ?? null,
        goalATransform: goalAWrapper?.style.transform ?? null,
        goalBTransform: goalBWrapper?.style.transform ?? null,
        meWrapperCenter: meWrapper ? getCenter(meWrapper) : null,
        nodesContainerTop: nodesContainer?.getBoundingClientRect().top ?? null,
        reactFlowScrollTop: reactFlowWrapper?.scrollTop ?? null,
        reactFlowScrollLeft: reactFlowWrapper?.scrollLeft ?? null,
      };
    });

    const edgeHitArea = page.getByTestId('task-flow-edge-hit-area-edge-me-a');
    const edgeBBox = await edgeHitArea.boundingBox();
    if (!edgeBBox) {
      throw new Error('expected measurable edge hit area before reconnect coverage');
    }

    await page.mouse.click(
      edgeBBox.x + edgeBBox.width / 2,
      edgeBBox.y + edgeBBox.height / 2,
    );

    const targetUpdaters = page.locator('.react-flow__edgeupdater-target');
    await expect(targetUpdaters.first()).toBeVisible({ timeout: 5000 });
    const baselineMetrics = await readReconnectMetrics();
    expect(baselineMetrics, 'edge-reconnect: expected measurable baseline metrics').not.toBeNull();
    const baselineViewport = await readViewportTransform(page);

    const goalABox = await page.getByTestId('goal-flow-node-goal-a').boundingBox();
    const goalBBox = await page.getByTestId('goal-flow-node-goal-b').boundingBox();
    if (!goalABox || !goalBBox) {
      throw new Error('expected measurable goal node bounds for reconnect coverage');
    }

    const updaterCandidates = await targetUpdaters.evaluateAll((elements) => (
      elements.map((element) => {
        const rect = (element as HTMLElement | SVGElement).getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        };
      })
    ));
    const updaterMatch = updaterCandidates
      .map((candidate, index) => ({
        index,
        ...candidate,
        centerX: candidate.x + candidate.width / 2,
        centerY: candidate.y + candidate.height / 2,
      }))
      .sort((left, right) => {
        const leftDistance = Math.hypot(
          left.centerX - (goalABox.x + goalABox.width / 2),
          left.centerY - (goalABox.y + goalABox.height / 2),
        );
        const rightDistance = Math.hypot(
          right.centerX - (goalABox.x + goalABox.width / 2),
          right.centerY - (goalABox.y + goalABox.height / 2),
        );
        return leftDistance - rightDistance;
      })[0];

    if (!updaterMatch) {
      throw new Error('expected measurable edge updater bounds for reconnect coverage');
    }

    const simulationEndCountBeforeReconnect = countSimulationEnds();
    await page.mouse.move(
      updaterMatch.centerX,
      updaterMatch.centerY,
    );
    await page.mouse.down();
    await page.mouse.move(
      goalBBox.x + goalBBox.width / 2,
      goalBBox.y + goalBBox.height / 2,
      { steps: 12 },
    );
    const liveGoalBBox = await page.getByTestId('goal-flow-node-goal-b').boundingBox();
    if (!liveGoalBBox) {
      throw new Error('expected live goal-b bounds before releasing moving reconnect gesture');
    }
    await page.mouse.move(
      liveGoalBBox.x + liveGoalBBox.width / 2,
      liveGoalBBox.y + liveGoalBBox.height / 2,
      { steps: 4 },
    );
    await page.mouse.up();

    await expect
      .poll(() => goalWarnings.some((entry) => entry.includes('page:interaction-reconnect')), {
        timeout: 5000,
        message: 'expected page:interaction-reconnect warn log after real reconnect gesture',
      })
      .toBe(true);

    await expect
      .poll(async () => {
        const reconnectMetrics = await readReconnectMetrics();
        if (!reconnectMetrics || !baselineMetrics) return null;
        const viewportAfterReconnect = await readViewportTransform(page);
        return {
          meStable:
            Math.abs(reconnectMetrics.meCenter.x - baselineMetrics.meCenter.x) <= 2
            && Math.abs(reconnectMetrics.meCenter.y - baselineMetrics.meCenter.y) <= 2,
          meDeltaX: Number((reconnectMetrics.meCenter.x - baselineMetrics.meCenter.x).toFixed(2)),
          meDeltaY: Number((reconnectMetrics.meCenter.y - baselineMetrics.meCenter.y).toFixed(2)),
          goalADeltaX: Number((reconnectMetrics.goalACenter.x - baselineMetrics.goalACenter.x).toFixed(2)),
          goalADeltaY: Number((reconnectMetrics.goalACenter.y - baselineMetrics.goalACenter.y).toFixed(2)),
          goalBDeltaX: Number((reconnectMetrics.goalBCenter.x - baselineMetrics.goalBCenter.x).toFixed(2)),
          goalBDeltaY: Number((reconnectMetrics.goalBCenter.y - baselineMetrics.goalBCenter.y).toFixed(2)),
          meWrapperDeltaY: Number((((reconnectMetrics.meWrapperCenter?.y ?? 0) - (baselineMetrics.meWrapperCenter?.y ?? 0))).toFixed(2)),
          scrollDeltaY: Number(((reconnectMetrics.scrollY ?? 0) - (baselineMetrics.scrollY ?? 0)).toFixed(2)),
          pageTopDeltaY: Number((((reconnectMetrics.pageTop ?? 0) - (baselineMetrics.pageTop ?? 0))).toFixed(2)),
          nodesContainerTopDeltaY: Number((((reconnectMetrics.nodesContainerTop ?? 0) - (baselineMetrics.nodesContainerTop ?? 0))).toFixed(2)),
          reactFlowScrollTopDeltaY: Number((((reconnectMetrics.reactFlowScrollTop ?? 0) - (baselineMetrics.reactFlowScrollTop ?? 0))).toFixed(2)),
          reactFlowScrollLeftDeltaX: Number((((reconnectMetrics.reactFlowScrollLeft ?? 0) - (baselineMetrics.reactFlowScrollLeft ?? 0))).toFixed(2)),
          ringsAligned:
            Math.abs(reconnectMetrics.ring1Center.x - reconnectMetrics.meCenter.x) <= 6
            && Math.abs(reconnectMetrics.ring1Center.y - reconnectMetrics.meCenter.y) <= 6,
          viewportChanged: JSON.stringify(viewportAfterReconnect) !== JSON.stringify(baselineViewport),
          meTransformChanged: reconnectMetrics.meTransform !== baselineMetrics.meTransform,
          goalATransformChanged: reconnectMetrics.goalATransform !== baselineMetrics.goalATransform,
          goalBTransformChanged: reconnectMetrics.goalBTransform !== baselineMetrics.goalBTransform,
        };
      }, {
        timeout: 5000,
        message: 'expected Me screen position and hop rings to remain stable while reconnecting an edge',
      })
      .toMatchObject({
        meStable: true,
        meDeltaX: 0,
        meDeltaY: 0,
        meWrapperDeltaY: 0,
        scrollDeltaY: 0,
        pageTopDeltaY: 0,
        nodesContainerTopDeltaY: 0,
        reactFlowScrollTopDeltaY: 0,
        reactFlowScrollLeftDeltaX: 0,
        ringsAligned: true,
        viewportChanged: false,
        meTransformChanged: false,
      });

    await expect(page.locator('[data-testid="task-flow-edge-visible-edge-me-a"]')).toHaveCount(1);
    await expect(page.locator('[data-testid^="task-flow-edge-visible-"]')).toHaveCount(3);
    expectVisibleGraphSnapshot(
      await snapshotRenderVisibility(page),
      3,
      3,
      'edge-reconnect:after-reconnect-before-settle',
    );

    await expect
      .poll(() => countSimulationEnds(), {
        timeout: 15000,
        message: 'expected a new simulation:end warn log after reconnecting an edge',
      })
      .toBeGreaterThan(simulationEndCountBeforeReconnect);

    const settledMetrics = await readReconnectMetrics();
    expect(Math.abs(((settledMetrics?.meCenter.x ?? 0) - (baselineMetrics?.meCenter.x ?? 0)))).toBeLessThanOrEqual(2);
    expect(Math.abs(((settledMetrics?.meCenter.y ?? 0) - (baselineMetrics?.meCenter.y ?? 0)))).toBeLessThanOrEqual(2);
    expect(Math.abs(((settledMetrics?.ring1Center.x ?? 0) - (settledMetrics?.meCenter.x ?? 0)))).toBeLessThanOrEqual(6);
    expect(Math.abs(((settledMetrics?.ring1Center.y ?? 0) - (settledMetrics?.meCenter.y ?? 0)))).toBeLessThanOrEqual(6);

    expectVisibleGraphSnapshot(
      await snapshotRenderVisibility(page),
      3,
      3,
      'edge-reconnect:after-reconnect-after-settle',
    );
    expect(goalWarnings.some((entry) => entry.includes('page:suspect-render-state'))).toBe(false);
  });

  test('keeps the graph stable when reconnecting an edge before the simulation settles', async ({ page }) => {
    const goalWarnings = trackGoalWarnings(page);
    const countSimulationEnds = () => goalWarnings.filter((entry) => entry.includes('simulation:end')).length;
    const countSimulationTicks = () => goalWarnings.filter((entry) => entry.includes('simulation:tick')).length;

    await primeGoalsPageWithGraph(page, makeStarGraph());
    await gotoGoalsPage(page);

    await expect(page.locator('[data-testid^="goal-flow-node-"]')).toHaveCount(3);
    await expect(page.locator('[data-testid^="task-flow-edge-visible-"]')).toHaveCount(2);
    await expect
      .poll(() => goalWarnings.some((entry) => entry.includes('simulation:end')), {
        timeout: 15000,
        message: 'expected baseline simulation:end before moving reconnect coverage',
      })
      .toBe(true);

    const tickCountBeforeGrowth = countSimulationTicks();
    const endCountBeforeGrowth = countSimulationEnds();

    await openNodeContextMenu(page, 'goal-flow-node-me', 180, 150);
    await page.getByTestId('goal-context-item-downstream').click();
    await expect(page.locator('[data-testid^="goal-flow-node-"]')).toHaveCount(4);
    await expect(page.locator('[data-testid^="task-flow-edge-visible-"]')).toHaveCount(3);
    await expect(page.getByTestId('goals-hop-rings')).toBeVisible({ timeout: 10000 });

    await expect
      .poll(() => {
        const tickCount = countSimulationTicks();
        const endCount = countSimulationEnds();
        return tickCount > tickCountBeforeGrowth && endCount === endCountBeforeGrowth;
      }, {
        timeout: 5000,
        message: 'expected a moving simulation window before reconnecting an edge',
      })
      .toBe(true);

    await page.getByRole('button', { name: '编辑' }).click();

    const readReconnectMetrics = () => page.evaluate(() => {
      const me = document.querySelector('[data-testid="goal-flow-node-me"]') as HTMLElement | null;
      const goalA = document.querySelector('[data-testid="goal-flow-node-goal-a"]') as HTMLElement | null;
      const goalB = document.querySelector('[data-testid="goal-flow-node-goal-b"]') as HTMLElement | null;
      const ring1 = document.querySelector('[data-testid="goals-hop-ring-1"] circle') as SVGCircleElement | null;
      const goalsPage = document.querySelector('[data-testid="goals-page"]') as HTMLElement | null;
      const meWrapper = me?.closest('.react-flow__node') as HTMLElement | null;
      const goalAWrapper = goalA?.closest('.react-flow__node') as HTMLElement | null;
      const goalBWrapper = goalB?.closest('.react-flow__node') as HTMLElement | null;
      const nodesContainer = document.querySelector('.react-flow__nodes') as HTMLElement | null;
      const reactFlowWrapper = document.querySelector('[data-testid="rf__wrapper"]') as HTMLElement | null;
      if (!me || !goalA || !goalB || !ring1) {
        return null;
      }
      const getCenter = (element: Element) => {
        const rect = (element as HTMLElement | SVGElement).getBoundingClientRect();
        return {
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
        };
      };
      return {
        meCenter: getCenter(me),
        goalACenter: getCenter(goalA),
        goalBCenter: getCenter(goalB),
        ring1Center: getCenter(ring1),
        scrollY: window.scrollY,
        pageTop: goalsPage?.getBoundingClientRect().top ?? null,
        meTransform: meWrapper?.style.transform ?? null,
        goalATransform: goalAWrapper?.style.transform ?? null,
        goalBTransform: goalBWrapper?.style.transform ?? null,
        meWrapperCenter: meWrapper ? getCenter(meWrapper) : null,
        nodesContainerTop: nodesContainer?.getBoundingClientRect().top ?? null,
        reactFlowScrollTop: reactFlowWrapper?.scrollTop ?? null,
        reactFlowScrollLeft: reactFlowWrapper?.scrollLeft ?? null,
      };
    });

    const edgeHitArea = page.getByTestId('task-flow-edge-hit-area-edge-me-a');
    const edgeBBox = await edgeHitArea.boundingBox();
    if (!edgeBBox) {
      throw new Error('expected measurable edge hit area before moving reconnect coverage');
    }

    await page.mouse.click(
      edgeBBox.x + edgeBBox.width / 2,
      edgeBBox.y + edgeBBox.height / 2,
    );

    const sourceUpdaters = page.locator('.react-flow__edgeupdater-source');
    await expect(sourceUpdaters.first()).toBeVisible({ timeout: 5000 });
    const baselineMetrics = await readReconnectMetrics();
    expect(baselineMetrics, 'moving-edge-reconnect: expected measurable baseline metrics').not.toBeNull();
    const baselineViewport = await readViewportTransform(page);

    const meBox = await page.getByTestId('goal-flow-node-me').boundingBox();
    const goalBBox = await page.getByTestId('goal-flow-node-goal-b').boundingBox();
    if (!meBox || !goalBBox) {
      throw new Error('expected measurable goal node bounds for moving reconnect coverage');
    }

    const updaterCandidates = await sourceUpdaters.evaluateAll((elements) => (
      elements.map((element) => {
        const rect = (element as HTMLElement | SVGElement).getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        };
      })
    ));
    const updaterMatch = updaterCandidates
      .map((candidate, index) => ({
        index,
        ...candidate,
        centerX: candidate.x + candidate.width / 2,
        centerY: candidate.y + candidate.height / 2,
      }))
      .sort((left, right) => {
        const leftDistance = Math.hypot(
          left.centerX - (meBox.x + meBox.width / 2),
          left.centerY - (meBox.y + meBox.height / 2),
        );
        const rightDistance = Math.hypot(
          right.centerX - (meBox.x + meBox.width / 2),
          right.centerY - (meBox.y + meBox.height / 2),
        );
        return leftDistance - rightDistance;
      })[0];

    if (!updaterMatch) {
      throw new Error('expected measurable edge updater bounds for moving reconnect coverage');
    }

    const simulationEndCountBeforeReconnect = countSimulationEnds();
    const simulationTickCountBeforeReconnect = countSimulationTicks();
    await page.mouse.move(
      updaterMatch.centerX,
      updaterMatch.centerY,
    );
    await page.mouse.down();
    await page.mouse.move(
      goalBBox.x + goalBBox.width / 2,
      goalBBox.y + goalBBox.height / 2,
      { steps: 12 },
    );
    const liveGoalBBox = await page.getByTestId('goal-flow-node-goal-b').boundingBox();
    if (!liveGoalBBox) {
      throw new Error('expected live goal-b bounds before releasing moving reconnect gesture');
    }
    await page.mouse.move(
      liveGoalBBox.x + liveGoalBBox.width / 2,
      liveGoalBBox.y + liveGoalBBox.height / 2,
      { steps: 4 },
    );
    await page.mouse.up();

    await expect
      .poll(() => goalWarnings.some((entry) => entry.includes('page:interaction-reconnect')), {
        timeout: 5000,
        message: 'expected page:interaction-reconnect warn log after moving reconnect gesture',
      })
      .toBe(true);

    await expect
      .poll(() => {
        const tickCount = countSimulationTicks();
        const endCount = countSimulationEnds();
        return tickCount > simulationTickCountBeforeReconnect && endCount === simulationEndCountBeforeReconnect;
      }, {
        timeout: 5000,
        message: 'expected simulation ticks to continue before the next simulation:end after reconnecting during motion',
      })
      .toBe(true);

    await expect
      .poll(async () => {
        const reconnectMetrics = await readReconnectMetrics();
        if (!reconnectMetrics || !baselineMetrics) return null;
        const viewportAfterReconnect = await readViewportTransform(page);
        return {
          meStable:
            Math.abs(reconnectMetrics.meCenter.x - baselineMetrics.meCenter.x) <= 2
            && Math.abs(reconnectMetrics.meCenter.y - baselineMetrics.meCenter.y) <= 2,
          meDeltaX: Number((reconnectMetrics.meCenter.x - baselineMetrics.meCenter.x).toFixed(2)),
          meDeltaY: Number((reconnectMetrics.meCenter.y - baselineMetrics.meCenter.y).toFixed(2)),
          goalADeltaX: Number((reconnectMetrics.goalACenter.x - baselineMetrics.goalACenter.x).toFixed(2)),
          goalADeltaY: Number((reconnectMetrics.goalACenter.y - baselineMetrics.goalACenter.y).toFixed(2)),
          goalBDeltaX: Number((reconnectMetrics.goalBCenter.x - baselineMetrics.goalBCenter.x).toFixed(2)),
          goalBDeltaY: Number((reconnectMetrics.goalBCenter.y - baselineMetrics.goalBCenter.y).toFixed(2)),
          meWrapperDeltaY: Number((((reconnectMetrics.meWrapperCenter?.y ?? 0) - (baselineMetrics.meWrapperCenter?.y ?? 0))).toFixed(2)),
          scrollDeltaY: Number(((reconnectMetrics.scrollY ?? 0) - (baselineMetrics.scrollY ?? 0)).toFixed(2)),
          pageTopDeltaY: Number((((reconnectMetrics.pageTop ?? 0) - (baselineMetrics.pageTop ?? 0))).toFixed(2)),
          nodesContainerTopDeltaY: Number((((reconnectMetrics.nodesContainerTop ?? 0) - (baselineMetrics.nodesContainerTop ?? 0))).toFixed(2)),
          reactFlowScrollTopDeltaY: Number((((reconnectMetrics.reactFlowScrollTop ?? 0) - (baselineMetrics.reactFlowScrollTop ?? 0))).toFixed(2)),
          reactFlowScrollLeftDeltaX: Number((((reconnectMetrics.reactFlowScrollLeft ?? 0) - (baselineMetrics.reactFlowScrollLeft ?? 0))).toFixed(2)),
          ringsAligned:
            Math.abs(reconnectMetrics.ring1Center.x - reconnectMetrics.meCenter.x) <= 6
            && Math.abs(reconnectMetrics.ring1Center.y - reconnectMetrics.meCenter.y) <= 6,
          viewportChanged: JSON.stringify(viewportAfterReconnect) !== JSON.stringify(baselineViewport),
          meTransformChanged: reconnectMetrics.meTransform !== baselineMetrics.meTransform,
          goalATransformChanged: reconnectMetrics.goalATransform !== baselineMetrics.goalATransform,
          goalBTransformChanged: reconnectMetrics.goalBTransform !== baselineMetrics.goalBTransform,
        };
      }, {
        timeout: 5000,
        message: 'expected Me screen position and hop rings to remain stable while reconnecting during motion',
      })
      .toMatchObject({
        meStable: true,
        meDeltaX: 0,
        meDeltaY: 0,
        meWrapperDeltaY: 0,
        scrollDeltaY: 0,
        pageTopDeltaY: 0,
        nodesContainerTopDeltaY: 0,
        reactFlowScrollTopDeltaY: 0,
        reactFlowScrollLeftDeltaX: 0,
        ringsAligned: true,
        viewportChanged: false,
        meTransformChanged: false,
      });

    await expect(page.locator('[data-testid="task-flow-edge-visible-edge-me-a"]')).toHaveCount(1);
    await expect(page.locator('[data-testid^="task-flow-edge-visible-"]')).toHaveCount(3);
    expectVisibleGraphSnapshot(
      await snapshotRenderVisibility(page),
      4,
      3,
      'moving-edge-reconnect:after-reconnect-before-settle',
    );

    await expect
      .poll(() => countSimulationEnds(), {
        timeout: 15000,
        message: 'expected a new simulation:end warn log after reconnecting during motion',
      })
      .toBeGreaterThan(simulationEndCountBeforeReconnect);

    const settledMetrics = await readReconnectMetrics();
    expect(Math.abs(((settledMetrics?.meCenter.x ?? 0) - (baselineMetrics?.meCenter.x ?? 0)))).toBeLessThanOrEqual(2);
    expect(Math.abs(((settledMetrics?.meCenter.y ?? 0) - (baselineMetrics?.meCenter.y ?? 0)))).toBeLessThanOrEqual(2);
    expect(Math.abs(((settledMetrics?.ring1Center.x ?? 0) - (settledMetrics?.meCenter.x ?? 0)))).toBeLessThanOrEqual(6);
    expect(Math.abs(((settledMetrics?.ring1Center.y ?? 0) - (settledMetrics?.meCenter.y ?? 0)))).toBeLessThanOrEqual(6);

    expectVisibleGraphSnapshot(
      await snapshotRenderVisibility(page),
      4,
      3,
      'moving-edge-reconnect:after-reconnect-after-settle',
    );

    expect(goalWarnings.some((entry) => entry.includes('page:suspect-render-state'))).toBe(false);
  });

  test('keeps the graph stable when cancelling an edge reconnect through the real edge updater', async ({ page }) => {
    const goalWarnings = trackGoalWarnings(page);
    const countSimulationEnds = () => goalWarnings.filter((entry) => entry.includes('simulation:end')).length;
    const countReconnectStarts = () => goalWarnings.filter((entry) => entry.includes('page:interaction-reconnect-start')).length;
    const countReconnectEnds = () => goalWarnings.filter((entry) => entry.includes('page:interaction-reconnect-end')).length;
    const countReconnects = () => goalWarnings.filter((entry) => entry.includes('page:interaction-reconnect {')).length;

    await primeGoalsPageWithGraph(page, makeStarGraph());
    await gotoGoalsPage(page);

    await expect(page.locator('[data-testid^="goal-flow-node-"]')).toHaveCount(3);
    await expect(page.locator('[data-testid^="task-flow-edge-visible-"]')).toHaveCount(2);
    await expect
      .poll(() => goalWarnings.some((entry) => entry.includes('simulation:end')), {
        timeout: 15000,
        message: 'expected baseline simulation:end before reconnect-cancel coverage',
      })
      .toBe(true);

    await page.getByRole('button', { name: '编辑' }).click();

    const readReconnectMetrics = () => page.evaluate(() => {
      const me = document.querySelector('[data-testid="goal-flow-node-me"]') as HTMLElement | null;
      const ring1 = document.querySelector('[data-testid="goals-hop-ring-1"] circle') as SVGCircleElement | null;
      const goalsPage = document.querySelector('[data-testid="goals-page"]') as HTMLElement | null;
      const meWrapper = me?.closest('.react-flow__node') as HTMLElement | null;
      const nodesContainer = document.querySelector('.react-flow__nodes') as HTMLElement | null;
      const reactFlowWrapper = document.querySelector('[data-testid="rf__wrapper"]') as HTMLElement | null;
      if (!me || !ring1) {
        return null;
      }
      const getCenter = (element: Element) => {
        const rect = (element as HTMLElement | SVGElement).getBoundingClientRect();
        return {
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
        };
      };
      return {
        meCenter: getCenter(me),
        ring1Center: getCenter(ring1),
        scrollY: window.scrollY,
        pageTop: goalsPage?.getBoundingClientRect().top ?? null,
        meTransform: meWrapper?.style.transform ?? null,
        meWrapperCenter: meWrapper ? getCenter(meWrapper) : null,
        nodesContainerTop: nodesContainer?.getBoundingClientRect().top ?? null,
        reactFlowScrollTop: reactFlowWrapper?.scrollTop ?? null,
        reactFlowScrollLeft: reactFlowWrapper?.scrollLeft ?? null,
      };
    });

    const edgeHitArea = page.getByTestId('task-flow-edge-hit-area-edge-me-a');
    const edgeBBox = await edgeHitArea.boundingBox();
    if (!edgeBBox) {
      throw new Error('expected measurable edge hit area before reconnect-cancel coverage');
    }

    await page.mouse.click(
      edgeBBox.x + edgeBBox.width / 2,
      edgeBBox.y + edgeBBox.height / 2,
    );

    const targetUpdaters = page.locator('.react-flow__edgeupdater-target');
    await expect(targetUpdaters.first()).toBeVisible({ timeout: 5000 });
    const goalABox = await page.getByTestId('goal-flow-node-goal-a').boundingBox();
    if (!goalABox) {
      throw new Error('expected measurable goal-a bounds for reconnect-cancel coverage');
    }

    const updaterCandidates = await targetUpdaters.evaluateAll((elements) => (
      elements.map((element) => {
        const rect = (element as HTMLElement | SVGElement).getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          centerX: rect.x + rect.width / 2,
          centerY: rect.y + rect.height / 2,
        };
      })
    ));
    const updaterMatch = updaterCandidates
      .map((candidate, index) => ({
        index,
        ...candidate,
      }))
      .sort((left, right) => {
        const leftDistance = Math.hypot(
          left.centerX - (goalABox.x + goalABox.width / 2),
          left.centerY - (goalABox.y + goalABox.height / 2),
        );
        const rightDistance = Math.hypot(
          right.centerX - (goalABox.x + goalABox.width / 2),
          right.centerY - (goalABox.y + goalABox.height / 2),
        );
        return leftDistance - rightDistance;
      })[0];
    if (!updaterMatch) {
      throw new Error('expected measurable edge updater bounds for reconnect-cancel coverage');
    }

    const liveUpdaterBox = await targetUpdaters.nth(updaterMatch.index).boundingBox();
    if (!liveUpdaterBox) {
      throw new Error('expected live edge updater bounds for reconnect-cancel coverage');
    }

    const baselineMetrics = await readReconnectMetrics();
    expect(baselineMetrics, 'edge-reconnect-cancel: expected measurable baseline metrics').not.toBeNull();
    const baselineViewport = await readViewportTransform(page);
    const simulationEndCountBeforeReconnect = countSimulationEnds();
    const reconnectStartCountBefore = countReconnectStarts();
    const reconnectEndCountBefore = countReconnectEnds();
    const reconnectCountBefore = countReconnects();

    await page.mouse.move(
      liveUpdaterBox.x + liveUpdaterBox.width / 2,
      liveUpdaterBox.y + liveUpdaterBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(96, 220, { steps: 12 });

    await expect
      .poll(() => countReconnectStarts(), {
        timeout: 5000,
        message: 'expected reconnect-start warn log after beginning a cancelled reconnect gesture through the real edge updater',
      })
      .toBeGreaterThan(reconnectStartCountBefore);

    await expect(page.locator('[data-testid="task-flow-edge-visible-edge-me-a"]')).toHaveCount(1);
    await expect(page.locator('[data-testid^="task-flow-edge-visible-"]')).toHaveCount(2);
    expectVisibleGraphSnapshot(
      await snapshotRenderVisibility(page),
      3,
      2,
      'edge-reconnect-cancel:during-drag',
    );

    await page.mouse.up();

    await expect
      .poll(() => countReconnectEnds(), {
        timeout: 5000,
        message: 'expected reconnect-end warn log after cancelling a reconnect gesture',
      })
      .toBeGreaterThan(reconnectEndCountBefore);

    expect(
      countReconnects(),
      'expected cancelled reconnect gesture to avoid page:interaction-reconnect',
    ).toBe(reconnectCountBefore);

    await expect
      .poll(async () => {
        const reconnectMetrics = await readReconnectMetrics();
        if (!reconnectMetrics || !baselineMetrics) return null;
        const viewportAfterReconnect = await readViewportTransform(page);
        return {
          meStable:
            Math.abs(reconnectMetrics.meCenter.x - baselineMetrics.meCenter.x) <= 2
            && Math.abs(reconnectMetrics.meCenter.y - baselineMetrics.meCenter.y) <= 2,
          meDeltaX: Number((reconnectMetrics.meCenter.x - baselineMetrics.meCenter.x).toFixed(2)),
          meDeltaY: Number((reconnectMetrics.meCenter.y - baselineMetrics.meCenter.y).toFixed(2)),
          meWrapperDeltaY: Number((((reconnectMetrics.meWrapperCenter?.y ?? 0) - (baselineMetrics.meWrapperCenter?.y ?? 0))).toFixed(2)),
          scrollDeltaY: Number(((reconnectMetrics.scrollY ?? 0) - (baselineMetrics.scrollY ?? 0)).toFixed(2)),
          pageTopDeltaY: Number((((reconnectMetrics.pageTop ?? 0) - (baselineMetrics.pageTop ?? 0))).toFixed(2)),
          nodesContainerTopDeltaY: Number((((reconnectMetrics.nodesContainerTop ?? 0) - (baselineMetrics.nodesContainerTop ?? 0))).toFixed(2)),
          reactFlowScrollTopDeltaY: Number((((reconnectMetrics.reactFlowScrollTop ?? 0) - (baselineMetrics.reactFlowScrollTop ?? 0))).toFixed(2)),
          reactFlowScrollLeftDeltaX: Number((((reconnectMetrics.reactFlowScrollLeft ?? 0) - (baselineMetrics.reactFlowScrollLeft ?? 0))).toFixed(2)),
          ringsAligned:
            Math.abs(reconnectMetrics.ring1Center.x - reconnectMetrics.meCenter.x) <= 6
            && Math.abs(reconnectMetrics.ring1Center.y - reconnectMetrics.meCenter.y) <= 6,
          viewportChanged: JSON.stringify(viewportAfterReconnect) !== JSON.stringify(baselineViewport),
          meTransformChanged: reconnectMetrics.meTransform !== baselineMetrics.meTransform,
        };
      }, {
        timeout: 5000,
        message: 'expected Me screen position and hop rings to remain stable while cancelling reconnect',
      })
      .toMatchObject({
        meStable: true,
        meDeltaX: 0,
        meDeltaY: 0,
        meWrapperDeltaY: 0,
        scrollDeltaY: 0,
        pageTopDeltaY: 0,
        nodesContainerTopDeltaY: 0,
        reactFlowScrollTopDeltaY: 0,
        reactFlowScrollLeftDeltaX: 0,
        ringsAligned: true,
        viewportChanged: false,
        meTransformChanged: false,
      });

    await expect(page.locator('[data-testid="task-flow-edge-visible-edge-me-a"]')).toHaveCount(1);
    await expect(page.locator('[data-testid^="task-flow-edge-visible-"]')).toHaveCount(2);
    expectVisibleGraphSnapshot(
      await snapshotRenderVisibility(page),
      3,
      2,
      'edge-reconnect-cancel:after-cancel-before-settle',
    );

    await expect
      .poll(() => countSimulationEnds(), {
        timeout: 15000,
        message: 'expected cancelled reconnect gesture to preserve the existing settled graph',
      })
      .toBe(simulationEndCountBeforeReconnect);

    await expect(page.locator('[data-testid="task-flow-edge-visible-edge-me-a"]')).toHaveCount(1);
    await expect(page.locator('[data-testid^="task-flow-edge-visible-"]')).toHaveCount(2);
    expectVisibleGraphSnapshot(
      await snapshotRenderVisibility(page),
      3,
      2,
      'edge-reconnect-cancel:after-cancel-after-settle',
    );

    expect(goalWarnings.some((entry) => entry.includes('page:suspect-render-state'))).toBe(false);
  });

  test('keeps the graph stable when cancelling an edge reconnect before the simulation settles', async ({ page }) => {
    const goalWarnings = trackGoalWarnings(page);
    const countSimulationEnds = () => goalWarnings.filter((entry) => entry.includes('simulation:end')).length;
    const countSimulationTicks = () => goalWarnings.filter((entry) => entry.includes('simulation:tick')).length;
    const countReconnects = () => goalWarnings.filter((entry) => entry.includes('page:interaction-reconnect {')).length;

    await primeGoalsPageWithGraph(page, makeStarGraph());
    await gotoGoalsPage(page);

    await expect(page.locator('[data-testid^="goal-flow-node-"]')).toHaveCount(3);
    await expect(page.locator('[data-testid^="task-flow-edge-visible-"]')).toHaveCount(2);
    await expect
      .poll(() => goalWarnings.some((entry) => entry.includes('simulation:end')), {
        timeout: 15000,
        message: 'expected baseline simulation:end before moving reconnect-cancel coverage',
      })
      .toBe(true);

    const tickCountBeforeGrowth = countSimulationTicks();
    const endCountBeforeGrowth = countSimulationEnds();

    await openNodeContextMenu(page, 'goal-flow-node-me', 180, 150);
    await page.getByTestId('goal-context-item-downstream').click();
    await expect(page.locator('[data-testid^="goal-flow-node-"]')).toHaveCount(4);
    await expect(page.locator('[data-testid^="task-flow-edge-visible-"]')).toHaveCount(3);
    await expect(page.getByTestId('goals-hop-rings')).toBeVisible({ timeout: 10000 });

    await expect
      .poll(() => {
        const tickCount = countSimulationTicks();
        const endCount = countSimulationEnds();
        return tickCount > tickCountBeforeGrowth && endCount === endCountBeforeGrowth;
      }, {
        timeout: 5000,
        message: 'expected a moving simulation window before cancelling an edge reconnect',
      })
      .toBe(true);

    await page.getByRole('button', { name: '编辑' }).click();

    const readReconnectMetrics = () => page.evaluate(() => {
      const me = document.querySelector('[data-testid="goal-flow-node-me"]') as HTMLElement | null;
      const goalA = document.querySelector('[data-testid="goal-flow-node-goal-a"]') as HTMLElement | null;
      const goalB = document.querySelector('[data-testid="goal-flow-node-goal-b"]') as HTMLElement | null;
      const ring1 = document.querySelector('[data-testid="goals-hop-ring-1"] circle') as SVGCircleElement | null;
      const goalsPage = document.querySelector('[data-testid="goals-page"]') as HTMLElement | null;
      const meWrapper = me?.closest('.react-flow__node') as HTMLElement | null;
      const goalAWrapper = goalA?.closest('.react-flow__node') as HTMLElement | null;
      const goalBWrapper = goalB?.closest('.react-flow__node') as HTMLElement | null;
      const nodesContainer = document.querySelector('.react-flow__nodes') as HTMLElement | null;
      const reactFlowWrapper = document.querySelector('[data-testid="rf__wrapper"]') as HTMLElement | null;
      if (!me || !goalA || !goalB || !ring1) {
        return null;
      }
      const getCenter = (element: Element) => {
        const rect = (element as HTMLElement | SVGElement).getBoundingClientRect();
        return {
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
        };
      };
      return {
        meCenter: getCenter(me),
        goalACenter: getCenter(goalA),
        goalBCenter: getCenter(goalB),
        ring1Center: getCenter(ring1),
        scrollY: window.scrollY,
        pageTop: goalsPage?.getBoundingClientRect().top ?? null,
        meTransform: meWrapper?.style.transform ?? null,
        goalATransform: goalAWrapper?.style.transform ?? null,
        goalBTransform: goalBWrapper?.style.transform ?? null,
        meWrapperCenter: meWrapper ? getCenter(meWrapper) : null,
        nodesContainerTop: nodesContainer?.getBoundingClientRect().top ?? null,
        reactFlowScrollTop: reactFlowWrapper?.scrollTop ?? null,
        reactFlowScrollLeft: reactFlowWrapper?.scrollLeft ?? null,
      };
    });

    const edgeHitArea = page.getByTestId('task-flow-edge-hit-area-edge-me-a');
    const edgeBBox = await edgeHitArea.boundingBox();
    if (!edgeBBox) {
      throw new Error('expected measurable edge hit area before moving reconnect-cancel coverage');
    }

    await page.mouse.click(
      edgeBBox.x + edgeBBox.width / 2,
      edgeBBox.y + edgeBBox.height / 2,
    );

    const sourceUpdaters = page.locator('.react-flow__edgeupdater-source');
    await expect(sourceUpdaters.first()).toBeVisible({ timeout: 5000 });
    const meBox = await page.getByTestId('goal-flow-node-me').boundingBox();
    const goalBBox = await page.getByTestId('goal-flow-node-goal-b').boundingBox();
    if (!meBox || !goalBBox) {
      throw new Error('expected measurable node bounds for moving reconnect-cancel coverage');
    }

    const updaterCandidates = await sourceUpdaters.evaluateAll((elements) => (
      elements.map((element) => {
        const rect = (element as HTMLElement | SVGElement).getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          centerX: rect.x + rect.width / 2,
          centerY: rect.y + rect.height / 2,
        };
      })
    ));
    const updaterMatch = updaterCandidates
      .map((candidate, index) => ({
        index,
        ...candidate,
      }))
      .sort((left, right) => {
        const leftDistance = Math.hypot(
          left.centerX - (meBox.x + meBox.width / 2),
          left.centerY - (meBox.y + meBox.height / 2),
        );
        const rightDistance = Math.hypot(
          right.centerX - (meBox.x + meBox.width / 2),
          right.centerY - (meBox.y + meBox.height / 2),
        );
        return leftDistance - rightDistance;
      })[0];
    if (!updaterMatch) {
      throw new Error('expected measurable edge updater bounds for moving reconnect-cancel coverage');
    }

    const paneBox = await page.locator('.react-flow__pane').boundingBox();
    if (!paneBox) {
      throw new Error('expected measurable react-flow pane bounds for moving reconnect-cancel coverage');
    }
    const blankCanvasPoint = {
      x: paneBox.x + 48,
      y: paneBox.y + 48,
    };

    const baselineMetrics = await readReconnectMetrics();
    expect(baselineMetrics, 'moving-edge-reconnect-cancel: expected measurable baseline metrics').not.toBeNull();
    const baselineViewport = await readViewportTransform(page);
    const simulationEndCountBeforeReconnect = countSimulationEnds();
    const simulationTickCountBeforeReconnect = countSimulationTicks();
    const reconnectCountBefore = countReconnects();
    const reconnectPreview = page.locator('.react-flow__connection-path');

    await page.mouse.move(
      updaterMatch.centerX,
      updaterMatch.centerY,
    );
    await page.mouse.down();
    await page.mouse.move(
      goalBBox.x + goalBBox.width / 2,
      goalBBox.y + goalBBox.height / 2,
      { steps: 12 },
    );

    await expect(reconnectPreview).toHaveCount(1, {
      timeout: 5000,
    });

    const liveGoalBBox = await page.getByTestId('goal-flow-node-goal-b').boundingBox();
    if (!liveGoalBBox) {
      throw new Error('expected live goal-b bounds before cancelling moving reconnect gesture');
    }
    await page.mouse.move(
      liveGoalBBox.x + liveGoalBBox.width / 2,
      liveGoalBBox.y + liveGoalBBox.height / 2,
      { steps: 4 },
    );
    await page.mouse.move(blankCanvasPoint.x, blankCanvasPoint.y, { steps: 12 });

    await expect
      .poll(() => {
        const tickCount = countSimulationTicks();
        const endCount = countSimulationEnds();
        return tickCount > simulationTickCountBeforeReconnect && endCount === simulationEndCountBeforeReconnect;
      }, {
        timeout: 5000,
        message: 'expected simulation ticks to continue before the next simulation:end while cancelling reconnect during motion',
      })
      .toBe(true);

    await expect(page.locator('[data-testid="task-flow-edge-visible-edge-me-a"]')).toHaveCount(1);
    await expect(page.locator('[data-testid^="task-flow-edge-visible-"]')).toHaveCount(3);
    expectVisibleGraphSnapshot(
      await snapshotRenderVisibility(page),
      4,
      3,
      'moving-edge-reconnect-cancel:during-drag',
    );

    await page.mouse.up();

    await expect(reconnectPreview).toHaveCount(0, {
      timeout: 5000,
    });

    expect(
      countReconnects(),
      'expected cancelled reconnect gesture during motion to avoid page:interaction-reconnect',
    ).toBe(reconnectCountBefore);

    await expect
      .poll(async () => {
        const reconnectMetrics = await readReconnectMetrics();
        if (!reconnectMetrics || !baselineMetrics) return null;
        const viewportAfterReconnect = await readViewportTransform(page);
        return {
          meStable:
            Math.abs(reconnectMetrics.meCenter.x - baselineMetrics.meCenter.x) <= 2
            && Math.abs(reconnectMetrics.meCenter.y - baselineMetrics.meCenter.y) <= 2,
          meDeltaX: Number((reconnectMetrics.meCenter.x - baselineMetrics.meCenter.x).toFixed(2)),
          meDeltaY: Number((reconnectMetrics.meCenter.y - baselineMetrics.meCenter.y).toFixed(2)),
          goalADeltaX: Number((reconnectMetrics.goalACenter.x - baselineMetrics.goalACenter.x).toFixed(2)),
          goalADeltaY: Number((reconnectMetrics.goalACenter.y - baselineMetrics.goalACenter.y).toFixed(2)),
          goalBDeltaX: Number((reconnectMetrics.goalBCenter.x - baselineMetrics.goalBCenter.x).toFixed(2)),
          goalBDeltaY: Number((reconnectMetrics.goalBCenter.y - baselineMetrics.goalBCenter.y).toFixed(2)),
          meWrapperDeltaY: Number((((reconnectMetrics.meWrapperCenter?.y ?? 0) - (baselineMetrics.meWrapperCenter?.y ?? 0))).toFixed(2)),
          scrollDeltaY: Number(((reconnectMetrics.scrollY ?? 0) - (baselineMetrics.scrollY ?? 0)).toFixed(2)),
          pageTopDeltaY: Number((((reconnectMetrics.pageTop ?? 0) - (baselineMetrics.pageTop ?? 0))).toFixed(2)),
          nodesContainerTopDeltaY: Number((((reconnectMetrics.nodesContainerTop ?? 0) - (baselineMetrics.nodesContainerTop ?? 0))).toFixed(2)),
          reactFlowScrollTopDeltaY: Number((((reconnectMetrics.reactFlowScrollTop ?? 0) - (baselineMetrics.reactFlowScrollTop ?? 0))).toFixed(2)),
          reactFlowScrollLeftDeltaX: Number((((reconnectMetrics.reactFlowScrollLeft ?? 0) - (baselineMetrics.reactFlowScrollLeft ?? 0))).toFixed(2)),
          ringsAligned:
            Math.abs(reconnectMetrics.ring1Center.x - reconnectMetrics.meCenter.x) <= 6
            && Math.abs(reconnectMetrics.ring1Center.y - reconnectMetrics.meCenter.y) <= 6,
          viewportChanged: JSON.stringify(viewportAfterReconnect) !== JSON.stringify(baselineViewport),
          meTransformChanged: reconnectMetrics.meTransform !== baselineMetrics.meTransform,
          goalATransformChanged: reconnectMetrics.goalATransform !== baselineMetrics.goalATransform,
          goalBTransformChanged: reconnectMetrics.goalBTransform !== baselineMetrics.goalBTransform,
        };
      }, {
        timeout: 5000,
        message: 'expected Me screen position and hop rings to remain stable while cancelling reconnect during motion',
      })
      .toMatchObject({
        meStable: true,
        meDeltaX: 0,
        meDeltaY: 0,
        meWrapperDeltaY: 0,
        scrollDeltaY: 0,
        pageTopDeltaY: 0,
        nodesContainerTopDeltaY: 0,
        reactFlowScrollTopDeltaY: 0,
        reactFlowScrollLeftDeltaX: 0,
        ringsAligned: true,
        viewportChanged: false,
        meTransformChanged: false,
      });

    await expect(page.locator('[data-testid="task-flow-edge-visible-edge-me-a"]')).toHaveCount(1);
    await expect(page.locator('[data-testid^="task-flow-edge-visible-"]')).toHaveCount(3);
    expectVisibleGraphSnapshot(
      await snapshotRenderVisibility(page),
      4,
      3,
      'moving-edge-reconnect-cancel:after-cancel-before-settle',
    );

    await expect
      .poll(() => countSimulationEnds(), {
        timeout: 15000,
        message: 'expected the moving graph to settle after cancelling reconnect without losing visibility',
      })
      .toBeGreaterThan(simulationEndCountBeforeReconnect);

    await expect(page.locator('[data-testid="task-flow-edge-visible-edge-me-a"]')).toHaveCount(1);
    await expect(page.locator('[data-testid^="task-flow-edge-visible-"]')).toHaveCount(3);
    expectVisibleGraphSnapshot(
      await snapshotRenderVisibility(page),
      4,
      3,
      'moving-edge-reconnect-cancel:after-cancel-after-settle',
    );

    expect(goalWarnings.some((entry) => entry.includes('page:suspect-render-state'))).toBe(false);
  });

  test('keeps Me centered in the browser on first load and after the graph grows', async ({ page }) => {
    const goalWarnings = trackGoalWarnings(page);

    await gotoGoalsPage(page);
    await expect(page.getByTestId('goal-flow-node-me')).toBeVisible({ timeout: 10000 });

    const readMeViewportMetrics = () => page.evaluate(() => {
      const me = document.querySelector('[data-testid="goal-flow-node-me"]') as HTMLElement | null;
      const canvas = me?.closest('.react-flow') as HTMLElement | null;
      if (!me || !canvas) return null;
      const canvasRect = canvas.getBoundingClientRect();
      const rect = me.getBoundingClientRect();
      return {
        meCenterX: rect.x + rect.width / 2,
        meCenterY: rect.y + rect.height / 2,
        viewportCenterX: canvasRect.x + canvasRect.width / 2,
        viewportCenterY: canvasRect.y + canvasRect.height / 2,
      };
    });

    await expect
      .poll(async () => {
        const metrics = await readMeViewportMetrics();
        if (!metrics) return false;
        return Math.abs(metrics.meCenterX - metrics.viewportCenterX) <= 16
          && Math.abs(metrics.meCenterY - metrics.viewportCenterY) <= 16;
      }, {
        timeout: 15000,
        message: 'expected Me to initialize near the viewport center instead of the top-left corner',
      })
      .toBe(true);

    const simulationEndCountBeforeGrowth = goalWarnings.filter((entry) => entry.includes('simulation:end')).length;

    await openNodeContextMenu(page, 'goal-flow-node-me', 120, 120);
    await expect(page.getByTestId('goal-context-menu')).toBeVisible();
    await page.getByTestId('goal-context-item-downstream').click();

    await expect(page.locator('[data-testid^="goal-flow-node-"]')).toHaveCount(2);
    await expect(page.locator('[data-testid^="task-flow-edge-hit-area-"]')).toHaveCount(1);
    await expect(page.locator('[data-testid^="task-flow-edge-label-"]')).toHaveCount(1);

    await expect
      .poll(() => goalWarnings.filter((entry) => entry.includes('simulation:end')).length, {
        timeout: 15000,
        message: 'expected a new simulation:end warn log after the graph grows from Me',
      })
      .toBeGreaterThan(simulationEndCountBeforeGrowth);

    await expect
      .poll(async () => {
        const metrics = await readMeViewportMetrics();
        if (!metrics) return false;
        return Math.abs(metrics.meCenterX - metrics.viewportCenterX) <= 16
          && Math.abs(metrics.meCenterY - metrics.viewportCenterY) <= 16;
      }, {
        timeout: 15000,
        message: 'expected Me to remain centered after the graph grows',
      })
      .toBe(true);

    const visibilitySnapshot = await snapshotRenderVisibility(page);
    expectVisibleGraphSnapshot(visibilitySnapshot, 2, 1, 'me-centered-after-growth');
    expect(goalWarnings.some((entry) => entry.includes('page:suspect-render-state'))).toBe(false);
  });

  test('renders single-edge arrows and nearest-point anchors in the browser', async ({ page }) => {
    await primeGoalsPageWithGraph(page, makeSingleEdgeGraph());
    await gotoGoalsPage(page);
    await expect(page.getByTestId('goal-flow-node-me')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('goal-flow-node-goal-a')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('task-flow-edge-visible-edge-me-a')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('task-flow-edge-marker-edge-me-a')).toBeAttached();

    const geometry = await page.evaluate(() => {
      const edge = document.querySelector('[data-testid="task-flow-edge-visible-edge-me-a"]') as SVGPathElement | null;
      const marker = document.querySelector('[data-testid="task-flow-edge-marker-edge-me-a"]') as SVGMarkerElement | null;
      const me = document.querySelector('[data-testid="goal-flow-node-me"]') as HTMLElement | null;
      const goalA = document.querySelector('[data-testid="goal-flow-node-goal-a"]') as HTMLElement | null;
      if (!edge || !marker || !me || !goalA) return null;

      const edgePath = edge.getAttribute('d') ?? '';
      const match = edgePath.match(/^M\s*([-\d.]+)\s+([-\d.]+)\s+L\s+([-\d.]+)\s+([-\d.]+)/);
      if (!match) return null;

      const [, sx, sy, tx, ty] = match;
      const matrix = edge.getScreenCTM();
      if (!matrix) return null;
      const svg = edge.ownerSVGElement;
      if (!svg) return null;
      const startPoint = new DOMPoint(Number(sx), Number(sy)).matrixTransform(matrix);
      const endPoint = new DOMPoint(Number(tx), Number(ty)).matrixTransform(matrix);
      const getCenter = (element: HTMLElement) => {
        const rect = element.getBoundingClientRect();
        return {
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
          radius: rect.width / 2,
        };
      };

      const source = getCenter(me);
      const target = getCenter(goalA);
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.hypot(dx, dy) || 1;
      const normalX = dx / distance;
      const normalY = dy / distance;

      return {
        edgePath,
        markerEnd: edge.getAttribute('marker-end'),
        startX: startPoint.x,
        startY: startPoint.y,
        endX: endPoint.x,
        endY: endPoint.y,
        expectedStartX: source.x + normalX * source.radius,
        expectedStartY: source.y + normalY * source.radius,
        expectedEndX: target.x - normalX * target.radius,
        expectedEndY: target.y - normalY * target.radius,
      };
    });

    expect(geometry).not.toBeNull();
    expect(geometry?.edgePath.includes(' C ')).toBe(false);
    expect(geometry?.markerEnd).toContain('goal-task-arrow-edge-me-a');
    expect(Math.abs((geometry?.startX ?? 0) - (geometry?.expectedStartX ?? 0))).toBeLessThan(2);
    expect(Math.abs((geometry?.startY ?? 0) - (geometry?.expectedStartY ?? 0))).toBeLessThan(2);
    expect(Math.abs((geometry?.endX ?? 0) - (geometry?.expectedEndX ?? 0))).toBeLessThan(2);
    expect(Math.abs((geometry?.endY ?? 0) - (geometry?.expectedEndY ?? 0))).toBeLessThan(2);
  });

  test('keeps duplicate edges curved in the middle while sharing the same endpoints and arrows', async ({ page }) => {
    await primeGoalsPageWithGraph(page, makeDuplicateEdgeGraph());
    await gotoGoalsPage(page);
    await expect(page.getByTestId('task-flow-edge-visible-edge-me-a-1')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('task-flow-edge-visible-edge-me-a-2')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('task-flow-edge-marker-edge-me-a-1')).toBeAttached();
    await expect(page.getByTestId('task-flow-edge-marker-edge-me-a-2')).toBeAttached();

    const paths = await page.evaluate(() => {
      const first = document.querySelector('[data-testid="task-flow-edge-visible-edge-me-a-1"]') as SVGPathElement | null;
      const second = document.querySelector('[data-testid="task-flow-edge-visible-edge-me-a-2"]') as SVGPathElement | null;
      if (!first || !second) return null;

      const parse = (value: string) => {
        const match = value.match(/^M\s*([-\d.]+)\s+([-\d.]+)\s+C\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/);
        if (!match) return null;
        const [, sx, sy, c1x, c1y, c2x, c2y, tx, ty] = match;
        return {
          startX: Number(sx),
          startY: Number(sy),
          control1X: Number(c1x),
          control1Y: Number(c1y),
          control2X: Number(c2x),
          control2Y: Number(c2y),
          endX: Number(tx),
          endY: Number(ty),
        };
      };

      return {
        firstPath: first.getAttribute('d') ?? '',
        secondPath: second.getAttribute('d') ?? '',
        first: parse(first.getAttribute('d') ?? ''),
        second: parse(second.getAttribute('d') ?? ''),
        firstMarkerEnd: first.getAttribute('marker-end'),
        secondMarkerEnd: second.getAttribute('marker-end'),
      };
    });

    expect(paths).not.toBeNull();
    expect(paths?.firstPath.includes(' C ')).toBe(true);
    expect(paths?.secondPath.includes(' C ')).toBe(true);
    expect(paths?.firstMarkerEnd).toContain('goal-task-arrow-edge-me-a-1');
    expect(paths?.secondMarkerEnd).toContain('goal-task-arrow-edge-me-a-2');
    expect(paths?.firstPath).not.toBe(paths?.secondPath);
    expect(Math.abs((paths?.first?.startX ?? 0) - (paths?.second?.startX ?? 0))).toBeLessThan(1);
    expect(Math.abs((paths?.first?.startY ?? 0) - (paths?.second?.startY ?? 0))).toBeLessThan(1);
    expect(Math.abs((paths?.first?.endX ?? 0) - (paths?.second?.endX ?? 0))).toBeLessThan(1);
    expect(Math.abs((paths?.first?.endY ?? 0) - (paths?.second?.endY ?? 0))).toBeLessThan(1);
    expect(Math.abs((paths?.first?.control1Y ?? 0) - (paths?.second?.control1Y ?? 0))).toBeGreaterThan(1);
    expect(Math.abs((paths?.first?.control2Y ?? 0) - (paths?.second?.control2Y ?? 0))).toBeGreaterThan(1);
  });

  test('opens the shared-endpoint fan around Me in the browser when star edges start nearly collinear', async ({ page }) => {
    const goalWarnings = trackGoalWarnings(page);

    await primeGoalsPageWithGraph(page, makeStarGraph(), {
      fixedPolarSequence: [
        { angle: 0, distance: 192 },
        { angle: 0.03, distance: 194 },
      ],
    });
    await gotoGoalsPage(page);
    await expect(page.getByTestId('goal-flow-node-me')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('goal-flow-node-goal-a')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('goal-flow-node-goal-b')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('task-flow-edge-visible-edge-me-a')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('task-flow-edge-visible-edge-me-b')).toBeVisible({ timeout: 10000 });

    await expect
      .poll(() => goalWarnings.some((entry) => entry.includes('simulation:end')), {
        timeout: 15000,
        message: 'expected simulation:end warn log before shared-endpoint fan assertions',
      })
      .toBe(true);

    const snapshot = await snapshotRenderVisibility(page);
    expectVisibleGraphSnapshot(snapshot, 3, 2, 'shared-endpoint-fan:settled');

    const fanMetrics = await page.evaluate(() => {
      const me = document.querySelector('[data-testid="goal-flow-node-me"]') as HTMLElement | null;
      const goalA = document.querySelector('[data-testid="goal-flow-node-goal-a"]') as HTMLElement | null;
      const goalB = document.querySelector('[data-testid="goal-flow-node-goal-b"]') as HTMLElement | null;
      const canvas = me?.closest('.react-flow') as HTMLElement | null;
      const rings = document.querySelector('[data-testid="goals-hop-rings"]') as SVGSVGElement | null;
      const ring1 = rings?.querySelector('[data-testid="goals-hop-ring-1"]') as SVGCircleElement | null;
      if (!me || !goalA || !goalB || !canvas) return null;

      const getCenter = (element: HTMLElement) => {
        const rect = element.getBoundingClientRect();
        return {
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
        };
      };

      const meCenter = getCenter(me);
      const aCenter = getCenter(goalA);
      const bCenter = getCenter(goalB);
      const angleA = Math.atan2(aCenter.y - meCenter.y, aCenter.x - meCenter.x);
      const angleB = Math.atan2(bCenter.y - meCenter.y, bCenter.x - meCenter.x);
      const rawDelta = Math.abs(angleA - angleB);
      const angleDeltaDeg = Math.min(rawDelta, Math.PI * 2 - rawDelta) * 180 / Math.PI;
      const ring1Rect = ring1?.getBoundingClientRect() ?? null;
      const canvasRect = canvas.getBoundingClientRect();
      const viewportCenter = {
        x: canvasRect.x + canvasRect.width / 2,
        y: canvasRect.y + canvasRect.height / 2,
      };

      return {
        meCenter,
        aCenter,
        bCenter,
        angleDeltaDeg,
        viewportCenter,
        ring1Center: ring1Rect ? {
          x: ring1Rect.x + ring1Rect.width / 2,
          y: ring1Rect.y + ring1Rect.height / 2,
        } : null,
      };
    });

    expect(fanMetrics, 'shared-endpoint-fan: expected measurable star geometry').not.toBeNull();
    expect(
      fanMetrics?.angleDeltaDeg ?? 0,
      `shared-endpoint-fan: expected Me fan angle to open well beyond the initial ~1.7deg, got ${fanMetrics?.angleDeltaDeg ?? 0}deg`,
    ).toBeGreaterThan(20);
    expect(
      Math.abs((fanMetrics?.meCenter.x ?? 0) - (fanMetrics?.viewportCenter.x ?? 0)),
      `shared-endpoint-fan: expected Me to remain near viewport center on x-axis, got me=${fanMetrics?.meCenter.x ?? 0}, viewport=${fanMetrics?.viewportCenter.x ?? 0}`,
    ).toBeLessThanOrEqual(16);
    expect(
      Math.abs((fanMetrics?.meCenter.y ?? 0) - (fanMetrics?.viewportCenter.y ?? 0)),
      `shared-endpoint-fan: expected Me to remain near viewport center on y-axis, got me=${fanMetrics?.meCenter.y ?? 0}, viewport=${fanMetrics?.viewportCenter.y ?? 0}`,
    ).toBeLessThanOrEqual(16);
    if (fanMetrics?.ring1Center) {
      expect(
        Math.abs(fanMetrics.ring1Center.x - fanMetrics.meCenter.x),
        `shared-endpoint-fan: expected ring1 to remain concentric with Me on x-axis, got ring=${fanMetrics.ring1Center.x}, me=${fanMetrics.meCenter.x}`,
      ).toBeLessThanOrEqual(6);
      expect(
        Math.abs(fanMetrics.ring1Center.y - fanMetrics.meCenter.y),
        `shared-endpoint-fan: expected ring1 to remain concentric with Me on y-axis, got ring=${fanMetrics.ring1Center.y}, me=${fanMetrics.meCenter.y}`,
      ).toBeLessThanOrEqual(6);
    }
    expect(goalWarnings.some((entry) => entry.includes('page:suspect-render-state'))).toBe(false);
  });

  test('keeps hidden cancelled siblings from distorting the visible single-edge graph in the browser', async ({ page }) => {
    const baselinePage = await page.context().newPage();
    let baselineMetrics: Awaited<ReturnType<typeof measureSingleVisibleGoalDirection>> | null = null;

    try {
      await primeGoalsPageWithGraph(baselinePage, makeSingleEdgeGraph(), {
        fixedPolarSequence: [
          { angle: 0.2, distance: 192 },
        ],
      });
      const baselineWarnings = trackGoalWarnings(baselinePage);
      await baselinePage.goto('/goals', { waitUntil: 'domcontentloaded' });
      await expect(baselinePage.getByTestId('goals-page')).toBeVisible({ timeout: 20000 });
      await expect(baselinePage.getByTestId('goal-flow-node-goal-a')).toBeVisible({ timeout: 10000 });
      await expect
        .poll(() => baselineWarnings.some((entry) => entry.includes('simulation:end')), {
          timeout: 15000,
          message: 'expected baseline simulation:end warn log before hidden-sibling comparison',
        })
        .toBe(true);
      baselineMetrics = await measureSingleVisibleGoalDirection(baselinePage, 'goal-flow-node-goal-a');
    } finally {
      await baselinePage.close();
    }

    const hiddenSiblingPage = await page.context().newPage();
    try {
      await primeGoalsPageWithGraph(hiddenSiblingPage, makeHiddenCancelledSiblingGraph(), {
        fixedPolarSequence: [
          { angle: 0.2, distance: 192 },
          { angle: 0.23, distance: 194 },
        ],
      });
      const hiddenWarnings = trackGoalWarnings(hiddenSiblingPage);
      await hiddenSiblingPage.goto('/goals', { waitUntil: 'domcontentloaded' });
      await expect(hiddenSiblingPage.getByTestId('goals-page')).toBeVisible({ timeout: 20000 });
      await expect(hiddenSiblingPage.getByTestId('goal-flow-node-me')).toBeVisible({ timeout: 10000 });
      await expect(hiddenSiblingPage.getByTestId('goal-flow-node-goal-a')).toBeVisible({ timeout: 10000 });
      await expect(hiddenSiblingPage.getByTestId('task-flow-edge-visible-edge-me-a')).toBeVisible({ timeout: 10000 });
      await expect(hiddenSiblingPage.getByTestId('goal-flow-node-goal-b')).toHaveCount(0);
      await expect(hiddenSiblingPage.getByTestId('task-flow-edge-visible-edge-me-b')).toHaveCount(0);
      await expect
        .poll(() => hiddenWarnings.some((entry) => entry.includes('simulation:end')), {
          timeout: 15000,
          message: 'expected hidden-sibling simulation:end warn log before distortion assertions',
        })
        .toBe(true);

      expectVisibleGraphSnapshot(
        await snapshotRenderVisibility(hiddenSiblingPage),
        2,
        1,
        'hidden-cancelled-sibling:settled',
      );

      const hiddenMetrics = await measureSingleVisibleGoalDirection(hiddenSiblingPage, 'goal-flow-node-goal-a');

      expect(baselineMetrics, 'hidden-cancelled-sibling: expected measurable baseline geometry').not.toBeNull();
      expect(hiddenMetrics, 'hidden-cancelled-sibling: expected measurable visible geometry').not.toBeNull();
      expect(hiddenMetrics?.edgePath.includes(' C '), 'hidden-cancelled-sibling: expected visible edge to remain a straight single edge').toBe(false);
      expect(
        Math.abs((hiddenMetrics?.angleDeg ?? 0) - (baselineMetrics?.angleDeg ?? 0)),
        `hidden-cancelled-sibling: expected hidden cancelled sibling not to materially rotate visible goal A (baseline=${baselineMetrics?.angleDeg ?? 0}, hidden=${hiddenMetrics?.angleDeg ?? 0})`,
      ).toBeLessThan(8);
      expect(hiddenWarnings.some((entry) => entry.includes('page:suspect-render-state'))).toBe(false);
    } finally {
      await hiddenSiblingPage.close();
    }
  });

  test('keeps cancelled zombie nodes and edges visible when show-cancelled is enabled', async ({ page }) => {
    const goalWarnings = trackGoalWarnings(page);

    await primeGoalsPageWithGraph(page, makeShownCancelledGraph(), {
      fixedPolarSequence: [
        { angle: 0.2, distance: 192 },
        { angle: 0.85, distance: 226 },
      ],
    });
    await gotoGoalsPage(page);
    await expect(page.getByTestId('goal-flow-node-me')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('goal-flow-node-goal-a')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('task-flow-edge-visible-edge-me-a')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('goal-flow-node-goal-b')).toHaveCount(0);
    await expect(page.getByTestId('task-flow-edge-visible-edge-me-b')).toHaveCount(0);

    await page.getByRole('checkbox', { name: '显示已取消' }).check();

    await expect(page.getByTestId('goal-flow-node-goal-b')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('task-flow-edge-visible-edge-me-b')).toBeVisible({ timeout: 10000 });

    await expect
      .poll(() => goalWarnings.some((entry) => entry.includes('simulation:end')), {
        timeout: 15000,
        message: 'expected simulation:end warn log before zombie-visibility assertions',
      })
      .toBe(true);

    expectVisibleGraphSnapshot(
      await snapshotRenderVisibility(page),
      3,
      2,
      'show-cancelled-zombie:settled',
    );

    const zombieMetrics = await page.evaluate(() => {
      const goal = document.querySelector('[data-testid="goal-flow-node-goal-b"]') as HTMLElement | null;
      const edge = document.querySelector('[data-testid="task-flow-edge-visible-edge-me-b"]') as SVGPathElement | null;
      const label = document.querySelector('[data-testid="task-flow-edge-label-edge-me-b"]') as HTMLElement | null;
      if (!goal || !edge || !label) return null;
      const goalStyle = window.getComputedStyle(goal);
      const edgeStyle = window.getComputedStyle(edge);
      const labelStyle = window.getComputedStyle(label);
      const goalRect = goal.getBoundingClientRect();
      const edgeRect = edge.getBoundingClientRect();
      return {
        goalOpacity: Number.parseFloat(goalStyle.opacity || '1'),
        goalWidth: goalRect.width,
        goalHeight: goalRect.height,
        edgeOpacity: Number.parseFloat(edgeStyle.opacity || '1'),
        edgeStrokeDasharray: edgeStyle.strokeDasharray,
        edgeWidth: Math.max(edgeRect.width, edgeRect.height),
        labelOpacity: Number.parseFloat(labelStyle.opacity || '1'),
      };
    });

    expect(zombieMetrics, 'show-cancelled-zombie: expected measurable zombie metrics').not.toBeNull();
    expect(zombieMetrics?.goalOpacity ?? 0, 'show-cancelled-zombie: cancelled node should remain visible').toBeGreaterThan(0.01);
    expect(zombieMetrics?.goalWidth ?? 0).toBeGreaterThan(0);
    expect(zombieMetrics?.goalHeight ?? 0).toBeGreaterThan(0);
    expect(zombieMetrics?.edgeOpacity ?? 0, 'show-cancelled-zombie: zombie edge should remain visible').toBeGreaterThan(0.01);
    expect(zombieMetrics?.edgeWidth ?? 0, 'show-cancelled-zombie: zombie edge should keep a measurable path').toBeGreaterThan(0);
    expect(zombieMetrics?.labelOpacity ?? 0, 'show-cancelled-zombie: zombie label should remain visible').toBeGreaterThan(0.01);
    expect(zombieMetrics?.edgeStrokeDasharray).not.toBe('none');
    expect(goalWarnings.some((entry) => entry.includes('page:suspect-render-state'))).toBe(false);
  });

  test('keeps hidden-condition show-cancelled round-trips stable while the layout is still moving', async ({ page }) => {
    const goalWarnings = trackGoalWarnings(page);
    const countSimulationEnds = () => goalWarnings.filter((entry) => entry.includes('simulation:end')).length;
    const countSimulationTicks = () => goalWarnings.filter((entry) => entry.includes('simulation:tick')).length;

    await primeGoalsPageWithGraph(page, makeShownCancelledGraph(), {
      fixedPolarSequence: [
        { angle: 0.2, distance: 192 },
        { angle: 0.85, distance: 226 },
      ],
    });
    await gotoGoalsPage(page);
    await expect(page.getByTestId('goal-flow-node-me')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('goal-flow-node-goal-a')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('task-flow-edge-visible-edge-me-a')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('goal-flow-node-goal-b')).toHaveCount(0);
    await expect(page.getByTestId('task-flow-edge-visible-edge-me-b')).toHaveCount(0);

    await expect
      .poll(() => countSimulationEnds(), {
        timeout: 15000,
        message: 'expected initial simulation:end warn log before moving show-cancelled round-trip assertions',
      })
      .toBeGreaterThanOrEqual(1);

    expectVisibleGraphSnapshot(
      await snapshotRenderVisibility(page),
      2,
      1,
      'moving-show-cancelled:initial-hidden',
    );

    const simulationTickCountBeforeShow = countSimulationTicks();
    const simulationEndCountBeforeShow = countSimulationEnds();
    await page.getByRole('checkbox', { name: '显示已取消' }).check();
    await expect(page.getByTestId('goal-flow-node-goal-b')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('task-flow-edge-visible-edge-me-b')).toBeVisible({ timeout: 10000 });

    await expect
      .poll(() => {
        const tickCount = countSimulationTicks();
        const endCount = countSimulationEnds();
        return tickCount > simulationTickCountBeforeShow && endCount === simulationEndCountBeforeShow;
      }, {
        timeout: 5000,
        message: 'expected moving window after show-cancelled toggles on before the next simulation:end',
      })
      .toBe(true);

    expectVisibleGraphSnapshot(
      await snapshotRenderVisibility(page),
      3,
      2,
      'moving-show-cancelled:shown-before-settle',
    );

    const simulationTickCountBeforeHide = countSimulationTicks();
    await page.getByRole('checkbox', { name: '显示已取消' }).uncheck();
    await expect(page.getByTestId('goal-flow-node-goal-b')).toHaveCount(0);
    await expect(page.getByTestId('task-flow-edge-visible-edge-me-b')).toHaveCount(0);
    await expect(page.getByTestId('goal-flow-node-goal-a')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('task-flow-edge-visible-edge-me-a')).toBeVisible({ timeout: 10000 });

    await expect
      .poll(() => countSimulationTicks(), {
        timeout: 5000,
        message: 'expected simulation ticks to continue after show-cancelled toggles back off during motion',
      })
      .toBeGreaterThan(simulationTickCountBeforeHide);

    expectVisibleGraphSnapshot(
      await snapshotRenderVisibility(page),
      2,
      1,
      'moving-show-cancelled:hidden-before-settle',
    );

    await expect
      .poll(() => countSimulationEnds(), {
        timeout: 15000,
        message: 'expected a new simulation:end warn log after moving show-cancelled round-trip',
      })
      .toBeGreaterThan(simulationEndCountBeforeShow);

    expectVisibleGraphSnapshot(
      await snapshotRenderVisibility(page),
      2,
      1,
      'moving-show-cancelled:hidden-after-settle',
    );

    expect(goalWarnings.some((entry) => entry.includes('page:suspect-render-state'))).toBe(false);
  });

  test('keeps re-hidden cancelled structures from distorting the visible graph after show-cancelled toggles back off', async ({ page }) => {
    const goalWarnings = trackGoalWarnings(page);
    const countSimulationEnds = () => goalWarnings.filter((entry) => entry.includes('simulation:end')).length;

    await primeGoalsPageWithGraph(page, makeShownCancelledGraph(), {
      fixedPolarSequence: [
        { angle: 0.2, distance: 192 },
        { angle: 0.85, distance: 226 },
      ],
    });
    await gotoGoalsPage(page);
    await expect(page.getByTestId('goal-flow-node-me')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('goal-flow-node-goal-a')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('task-flow-edge-visible-edge-me-a')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('goal-flow-node-goal-b')).toHaveCount(0);
    await expect(page.getByTestId('task-flow-edge-visible-edge-me-b')).toHaveCount(0);

    await expect
      .poll(() => countSimulationEnds(), {
        timeout: 15000,
        message: 'expected initial simulation:end warn log before toggle-roundtrip baseline assertions',
      })
      .toBeGreaterThanOrEqual(1);

    expectVisibleGraphSnapshot(
      await snapshotRenderVisibility(page),
      2,
      1,
      'toggle-roundtrip:initial-hidden',
    );

    const baselineMetrics = await measureSingleVisibleGoalDirection(page, 'goal-flow-node-goal-a');
    expect(baselineMetrics, 'toggle-roundtrip: expected measurable baseline visible geometry').not.toBeNull();

    const simulationEndCountBeforeShow = countSimulationEnds();
    await page.getByRole('checkbox', { name: '显示已取消' }).check();
    await expect(page.getByTestId('goal-flow-node-goal-b')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('task-flow-edge-visible-edge-me-b')).toBeVisible({ timeout: 10000 });
    await expect
      .poll(() => countSimulationEnds(), {
        timeout: 15000,
        message: 'expected a new simulation:end warn log after show-cancelled toggles on',
      })
      .toBeGreaterThan(simulationEndCountBeforeShow);
    expectVisibleGraphSnapshot(
      await snapshotRenderVisibility(page),
      3,
      2,
      'toggle-roundtrip:shown',
    );

    const simulationEndCountBeforeHide = countSimulationEnds();
    await page.getByRole('checkbox', { name: '显示已取消' }).uncheck();
    await expect(page.getByTestId('goal-flow-node-goal-b')).toHaveCount(0);
    await expect(page.getByTestId('task-flow-edge-visible-edge-me-b')).toHaveCount(0);
    await expect(page.getByTestId('goal-flow-node-goal-a')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('task-flow-edge-visible-edge-me-a')).toBeVisible({ timeout: 10000 });
    await expect
      .poll(() => countSimulationEnds(), {
        timeout: 15000,
        message: 'expected a new simulation:end warn log after show-cancelled toggles back off',
      })
      .toBeGreaterThan(simulationEndCountBeforeHide);

    expectVisibleGraphSnapshot(
      await snapshotRenderVisibility(page),
      2,
      1,
      'toggle-roundtrip:rehidden',
    );

    const rehiddenMetrics = await measureSingleVisibleGoalDirection(page, 'goal-flow-node-goal-a');
    expect(rehiddenMetrics, 'toggle-roundtrip: expected measurable re-hidden visible geometry').not.toBeNull();
    expect(rehiddenMetrics?.edgePath.includes(' C '), 'toggle-roundtrip: expected visible single edge to remain straight after re-hide').toBe(false);
    expect(
      Math.abs((rehiddenMetrics?.angleDeg ?? 0) - (baselineMetrics?.angleDeg ?? 0)),
      `toggle-roundtrip: expected visible goal A direction to remain near the initial hidden baseline (baseline=${baselineMetrics?.angleDeg ?? 0}, rehidden=${rehiddenMetrics?.angleDeg ?? 0})`,
    ).toBeLessThan(8);
    expect(goalWarnings.some((entry) => entry.includes('page:suspect-render-state'))).toBe(false);
  });

  test('keeps semantic-status edges visible whenever both endpoint nodes stay visible', async ({ page }) => {
    for (const edgeStatus of ['in_progress', 'suspended', 'completed', 'cancelled'] as const) {
      await primeGoalsPageWithStoredGraph(page, makeLegacySemanticEdgeGraph(edgeStatus));
      const edgeId = `edge-me-a-${edgeStatus}`;
      await gotoGoalsPage(page);
      await expect(page.getByTestId('goal-flow-node-me')).toBeVisible({ timeout: 10000 });
      await expect(page.getByTestId('goal-flow-node-goal-a')).toBeVisible({ timeout: 10000 });
      await expect(page.getByTestId(`task-flow-edge-visible-${edgeId}`)).toBeVisible({ timeout: 10000 });
      await expect(page.getByTestId(`task-flow-edge-marker-${edgeId}`)).toBeAttached();

      const snapshot = await snapshotRenderVisibility(page);
      expectVisibleGraphSnapshot(snapshot, 2, 1, `semantic-edge-${edgeStatus}`);

      const edgeMetrics = await page.evaluate((currentEdgeId) => {
        const edge = document.querySelector(`[data-testid="task-flow-edge-visible-${currentEdgeId}"]`) as SVGPathElement | null;
        const label = document.querySelector(`[data-testid="task-flow-edge-label-${currentEdgeId}"]`) as HTMLElement | null;
        if (!edge || !label) return null;
        const edgeStyle = window.getComputedStyle(edge);
        const edgeRect = edge.getBoundingClientRect();
        const labelStyle = window.getComputedStyle(label);
        return {
          strokeDasharray: edgeStyle.strokeDasharray,
          strokeOpacity: Number.parseFloat(edgeStyle.opacity || '1'),
          edgeWidth: edgeRect.width,
          edgeHeight: edgeRect.height,
          labelOpacity: Number.parseFloat(labelStyle.opacity || '1'),
          labelTextDecoration: labelStyle.textDecorationLine,
        };
      }, edgeId);

      expect(edgeMetrics, `semantic-edge-${edgeStatus}: expected measurable edge metrics`).not.toBeNull();
      expect(edgeMetrics?.strokeOpacity ?? 0, `semantic-edge-${edgeStatus}: expected edge opacity to stay visible`).toBeGreaterThan(0.01);
      expect(
        Math.max(edgeMetrics?.edgeWidth ?? 0, edgeMetrics?.edgeHeight ?? 0),
        `semantic-edge-${edgeStatus}: expected edge path to keep a measurable box`,
      ).toBeGreaterThan(0);
      expect(edgeMetrics?.labelOpacity ?? 0, `semantic-edge-${edgeStatus}: expected label to stay visible`).toBeGreaterThan(0.01);

      if (edgeStatus === 'cancelled') {
        expect(
          edgeMetrics?.strokeDasharray,
          'semantic-edge-cancelled: expected cancelled edge to keep its cancelled visual style while remaining visible',
        ).not.toBe('none');
        expect(edgeMetrics?.labelTextDecoration).toContain('line-through');
      }
    }
  });

  test('keeps Me fixed at the concentric-ring center and renders complete independent rings', async ({ page }) => {
    await gotoGoalsPage(page);
    await expect(page.getByTestId('goal-flow-node-me')).toBeVisible({ timeout: 10000 });

    await openNodeContextMenu(page, 'goal-flow-node-me', 120, 120);
    await page.getByTestId('goal-context-item-downstream').click();
    await expect(page.locator('[data-testid^="goal-flow-node-"]')).toHaveCount(2);

    const firstGoal = page.locator('[data-testid^="goal-flow-node-"]').nth(1);
    const firstGoalId = await firstGoal.getAttribute('data-testid');
    if (!firstGoalId) {
      throw new Error('expected first goal node test id');
    }

    await openNodeContextMenu(page, firstGoalId, 220, 180);
    await page.getByTestId('goal-context-item-downstream').click();
    await expect(page.locator('[data-testid^="goal-flow-node-"]')).toHaveCount(3);

    const visibleNodeTestIds = await page.locator('[data-testid^="goal-flow-node-"]')
      .evaluateAll((elements) => elements
        .map((element) => element.getAttribute('data-testid'))
        .filter((value): value is string => Boolean(value)));

    await expect(page.getByTestId('goals-hop-rings')).toBeVisible();
    await expect(page.getByTestId('goals-hop-ring-1')).toBeVisible();
    await expect(page.getByTestId('goals-hop-ring-2')).toBeVisible();

    const initialMetrics = await page.evaluate((nodeTestIds: string[]) => {
      const pageEl = document.querySelector('[data-testid="goals-page"]') as HTMLElement | null;
      const flowSurfaceEl = pageEl?.querySelector('[role="application"]') as HTMLElement | null;
      const me = document.querySelector('[data-testid="goal-flow-node-me"]') as HTMLElement | null;
      const rings = document.querySelector('[data-testid="goals-hop-rings"]') as SVGSVGElement | null;
      const ring1 = document.querySelector('[data-testid="goals-hop-ring-1"] circle') as SVGCircleElement | null;
      const ring2 = document.querySelector('[data-testid="goals-hop-ring-2"] circle') as SVGCircleElement | null;
      const label1 = document.querySelector('[data-testid="goals-hop-ring-1"] text') as SVGTextElement | null;
      const label2 = document.querySelector('[data-testid="goals-hop-ring-2"] text') as SVGTextElement | null;

      if (!pageEl || !flowSurfaceEl || !me || !rings || !ring1 || !ring2 || !label1 || !label2) {
        return null;
      }

      const pageRect = pageEl.getBoundingClientRect();
      const flowSurfaceRect = flowSurfaceEl.getBoundingClientRect();
      const meRect = me.getBoundingClientRect();
      const ring1Rect = ring1.getBoundingClientRect();
      const ring2Rect = ring2.getBoundingClientRect();
      const label1Rect = label1.getBoundingClientRect();
      const label2Rect = label2.getBoundingClientRect();
      const topElementAtMeCenter = document.elementFromPoint(
        meRect.x + meRect.width / 2,
        meRect.y + meRect.height / 2,
      ) as HTMLElement | null;
      const nodeLayering = nodeTestIds.map((testId) => {
        const node = document.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
        if (!node) {
          return {
            testId,
            closestTestIdsAtCenter: [],
          };
        }
        const nodeRect = node.getBoundingClientRect();
        const elementsAtCenter = document.elementsFromPoint(
          nodeRect.x + nodeRect.width / 2,
          nodeRect.y + nodeRect.height / 2,
        ) as HTMLElement[];
        return {
          testId,
          closestTestIdsAtCenter: elementsAtCenter
            .map((element) => element.closest('[data-testid]')?.getAttribute('data-testid') ?? null)
            .filter((value, index, array): value is string => Boolean(value) && array.indexOf(value) === index),
        };
      });
      const overlap = !(
        label1Rect.right < label2Rect.left
        || label2Rect.right < label1Rect.left
        || label1Rect.bottom < label2Rect.top
        || label2Rect.bottom < label1Rect.top
      );

      return {
        glowCircleCount: rings.querySelectorAll('circle[fill^="url("]').length,
        ring1: {
          cx: ring1.getAttribute('cx'),
          cy: ring1.getAttribute('cy'),
          r: Number(ring1.getAttribute('r')),
          fill: ring1.getAttribute('fill'),
          centerX: ring1Rect.x + ring1Rect.width / 2,
          centerY: ring1Rect.y + ring1Rect.height / 2,
        },
        ring2: {
          cx: ring2.getAttribute('cx'),
          cy: ring2.getAttribute('cy'),
          r: Number(ring2.getAttribute('r')),
          fill: ring2.getAttribute('fill'),
          centerX: ring2Rect.x + ring2Rect.width / 2,
          centerY: ring2Rect.y + ring2Rect.height / 2,
        },
        meCenter: {
          x: meRect.x + meRect.width / 2,
          y: meRect.y + meRect.height / 2,
        },
        flowSurfaceCenter: {
          x: flowSurfaceRect.x + flowSurfaceRect.width / 2,
          y: flowSurfaceRect.y + flowSurfaceRect.height / 2,
        },
        pageRect: {
          left: pageRect.left,
          top: pageRect.top,
          right: pageRect.right,
          bottom: pageRect.bottom,
        },
        topElementAtMeCenter:
          topElementAtMeCenter?.closest('[data-testid]')?.getAttribute('data-testid')
          ?? topElementAtMeCenter?.tagName
          ?? null,
        nodeLayering,
        labelOverlap: overlap,
        ring2Rect: {
          left: ring2Rect.left,
          top: ring2Rect.top,
          right: ring2Rect.right,
          bottom: ring2Rect.bottom,
        },
      };
    }, visibleNodeTestIds);

    await page.waitForTimeout(1200);

    const settledMetrics = await page.evaluate(() => {
      const pageEl = document.querySelector('[data-testid="goals-page"]') as HTMLElement | null;
      const flowSurfaceEl = pageEl?.querySelector('[role="application"]') as HTMLElement | null;
      const me = document.querySelector('[data-testid="goal-flow-node-me"]') as HTMLElement | null;
      if (!pageEl || !flowSurfaceEl || !me) {
        return null;
      }
      const flowSurfaceRect = flowSurfaceEl.getBoundingClientRect();
      const meRect = me.getBoundingClientRect();
      return {
        meCenter: {
          x: meRect.x + meRect.width / 2,
          y: meRect.y + meRect.height / 2,
        },
        flowSurfaceCenter: {
          x: flowSurfaceRect.x + flowSurfaceRect.width / 2,
          y: flowSurfaceRect.y + flowSurfaceRect.height / 2,
        },
      };
    });

    expect(initialMetrics).not.toBeNull();
    expect(initialMetrics?.glowCircleCount).toBe(0);
    expect(initialMetrics?.ring1.fill).toBe('none');
    expect(initialMetrics?.ring2.fill).toBe('none');
    expect(initialMetrics?.ring1.cx).toBe(initialMetrics?.ring2.cx);
    expect(initialMetrics?.ring1.cy).toBe(initialMetrics?.ring2.cy);
    expect(initialMetrics?.ring2.r ?? 0).toBeGreaterThan(initialMetrics?.ring1.r ?? 0);
    expect(initialMetrics?.labelOverlap).toBe(false);
    expect(Math.abs((initialMetrics?.ring1.centerX ?? 0) - (initialMetrics?.meCenter.x ?? 0))).toBeLessThan(6);
    expect(Math.abs((initialMetrics?.ring1.centerY ?? 0) - (initialMetrics?.meCenter.y ?? 0))).toBeLessThan(6);
    expect(Math.abs((initialMetrics?.ring2.centerX ?? 0) - (initialMetrics?.meCenter.x ?? 0))).toBeLessThan(6);
    expect(Math.abs((initialMetrics?.ring2.centerY ?? 0) - (initialMetrics?.meCenter.y ?? 0))).toBeLessThan(6);
    expect(Math.abs((initialMetrics?.meCenter.x ?? 0) - (initialMetrics?.flowSurfaceCenter.x ?? 0))).toBeLessThan(24);
    expect(Math.abs((initialMetrics?.meCenter.y ?? 0) - (initialMetrics?.flowSurfaceCenter.y ?? 0))).toBeLessThan(24);
    expect(initialMetrics?.ring2Rect.left ?? 0).toBeGreaterThanOrEqual((initialMetrics?.pageRect.left ?? 0) - 2);
    expect(initialMetrics?.ring2Rect.top ?? 0).toBeGreaterThanOrEqual((initialMetrics?.pageRect.top ?? 0) - 2);
    expect(initialMetrics?.ring2Rect.right ?? 0).toBeLessThanOrEqual((initialMetrics?.pageRect.right ?? 0) + 2);
    expect(initialMetrics?.ring2Rect.bottom ?? 0).toBeLessThanOrEqual((initialMetrics?.pageRect.bottom ?? 0) + 2);
    expect(initialMetrics?.topElementAtMeCenter).toBe('goal-flow-node-me');
    expect(initialMetrics?.nodeLayering).toHaveLength(3);
    for (const nodeLayering of initialMetrics?.nodeLayering ?? []) {
      expect(
        nodeLayering.closestTestIdsAtCenter,
        `expected ${nodeLayering.testId} to remain in the hit-test stack at its center`,
      ).toContain(nodeLayering.testId);
      const nodeIndex = nodeLayering.closestTestIdsAtCenter.indexOf(nodeLayering.testId);
      const ringsIndex = nodeLayering.closestTestIdsAtCenter.indexOf('goals-hop-rings');
      if (ringsIndex !== -1) {
        expect(
          nodeIndex,
          `expected ${nodeLayering.testId} to stay above hop rings in the hit-test stack`,
        ).toBeLessThan(ringsIndex);
      }
    }
    expect(settledMetrics).not.toBeNull();
    expect(Math.abs((settledMetrics?.meCenter.x ?? 0) - (settledMetrics?.flowSurfaceCenter.x ?? 0))).toBeLessThan(24);
    expect(Math.abs((settledMetrics?.meCenter.y ?? 0) - (settledMetrics?.flowSurfaceCenter.y ?? 0))).toBeLessThan(24);
    expect(Math.abs((settledMetrics?.meCenter.x ?? 0) - (initialMetrics?.meCenter.x ?? 0))).toBeLessThan(2);
    expect(Math.abs((settledMetrics?.meCenter.y ?? 0) - (initialMetrics?.meCenter.y ?? 0))).toBeLessThan(2);
  });

  test('keeps hop rings aligned with the browser viewport transform during zoom and pan', async ({ page }) => {
    const goalWarnings = trackGoalWarnings(page);

    await gotoGoalsPage(page);
    await expect(page.getByTestId('goal-flow-node-me')).toBeVisible({ timeout: 10000 });

    await openNodeContextMenu(page, 'goal-flow-node-me', 120, 120);
    await page.getByTestId('goal-context-item-downstream').click();
    await expect(page.locator('[data-testid^="goal-flow-node-"]')).toHaveCount(2);

    const firstGoal = page.locator('[data-testid^="goal-flow-node-"]').nth(1);
    const firstGoalId = await firstGoal.getAttribute('data-testid');
    if (!firstGoalId) {
      throw new Error('expected first goal node test id');
    }

    await openNodeContextMenu(page, firstGoalId, 220, 180);
    await page.getByTestId('goal-context-item-downstream').click();
    await expect(page.locator('[data-testid^="goal-flow-node-"]')).toHaveCount(3);
    await expect(page.getByTestId('goals-hop-rings')).toBeVisible();
    const visibleNodeTestIds = await page.locator('[data-testid^="goal-flow-node-"]')
      .evaluateAll((elements) => elements
        .map((element) => element.getAttribute('data-testid'))
        .filter((value): value is string => Boolean(value)));

    const readRingViewportMetrics = () => page.evaluate(() => {
      const me = document.querySelector('[data-testid="goal-flow-node-me"]') as HTMLElement | null;
      const rings = document.querySelector('[data-testid="goals-hop-rings"]') as SVGSVGElement | null;
      const ring1 = document.querySelector('[data-testid="goals-hop-ring-1"] circle') as SVGCircleElement | null;
      const ring2 = document.querySelector('[data-testid="goals-hop-ring-2"] circle') as SVGCircleElement | null;
      if (!me || !rings || !ring1 || !ring2) {
        return null;
      }

      const meRect = me.getBoundingClientRect();
      const ring1Rect = ring1.getBoundingClientRect();
      const ring2Rect = ring2.getBoundingClientRect();
      return {
        ringsTransform: rings.style.transform,
        meCenter: {
          x: meRect.x + meRect.width / 2,
          y: meRect.y + meRect.height / 2,
        },
        ring1Center: {
          x: ring1Rect.x + ring1Rect.width / 2,
          y: ring1Rect.y + ring1Rect.height / 2,
        },
        ring2Center: {
          x: ring2Rect.x + ring2Rect.width / 2,
          y: ring2Rect.y + ring2Rect.height / 2,
        },
      };
    });

    const viewportBefore = await readViewportTransform(page);
    const metricsBefore = await readRingViewportMetrics();

    expect(viewportBefore).not.toBeNull();
    expect(metricsBefore).not.toBeNull();
    expect(metricsBefore?.ringsTransform).not.toBe('');
    expect(Math.abs((metricsBefore?.ring1Center.x ?? 0) - (metricsBefore?.meCenter.x ?? 0))).toBeLessThan(6);
    expect(Math.abs((metricsBefore?.ring1Center.y ?? 0) - (metricsBefore?.meCenter.y ?? 0))).toBeLessThan(6);
    expect(Math.abs((metricsBefore?.ring2Center.x ?? 0) - (metricsBefore?.meCenter.x ?? 0))).toBeLessThan(6);
    expect(Math.abs((metricsBefore?.ring2Center.y ?? 0) - (metricsBefore?.meCenter.y ?? 0))).toBeLessThan(6);

    const renderer = page.locator('.react-flow__renderer');
    await renderer.hover();
    await page.mouse.wheel(0, -320);

    await expect
      .poll(() => readViewportTransform(page), {
        timeout: 4000,
        message: 'expected viewport transform to change after zoom in hop-ring viewport test',
      })
      .not.toEqual(viewportBefore);

    const viewportAfterZoom = await readViewportTransform(page);

    const pane = page.locator('.react-flow__pane');
    const paneBox = await pane.boundingBox();
    expect(paneBox, 'hop-ring-viewport: expected pane box for pan gesture').not.toBeNull();
    if (!paneBox) {
      throw new Error('expected pane box for pan gesture');
    }

    const panStartX = paneBox.x + Math.min(72, paneBox.width * 0.15);
    const panStartY = paneBox.y + Math.min(72, paneBox.height * 0.15);
    await page.mouse.move(panStartX, panStartY);
    await page.mouse.down();
    await page.mouse.move(
      panStartX + 36,
      panStartY + 24,
      { steps: 12 },
    );
    await page.mouse.up();

    await expect
      .poll(() => readViewportTransform(page), {
        timeout: 4000,
        message: 'expected viewport transform to change after pan in hop-ring viewport test',
      })
      .not.toEqual(viewportAfterZoom);

    await expect
      .poll(async () => {
        const metricsAfter = await readRingViewportMetrics();
        if (!metricsAfter) return null;
        return {
          transformChanged: metricsAfter.ringsTransform !== metricsBefore?.ringsTransform,
          aligned:
            Math.abs(metricsAfter.ring1Center.x - metricsAfter.meCenter.x) <= 6
            && Math.abs(metricsAfter.ring1Center.y - metricsAfter.meCenter.y) <= 6
            && Math.abs(metricsAfter.ring2Center.x - metricsAfter.meCenter.x) <= 6
            && Math.abs(metricsAfter.ring2Center.y - metricsAfter.meCenter.y) <= 6,
        };
      }, {
        timeout: 4000,
        message: 'expected hop rings to settle back onto the Me-centered viewport-aligned position after zoom/pan',
      })
      .toEqual({
        transformChanged: true,
        aligned: true,
      });

    const nodeLayeringAfterViewportChange = await page.evaluate((nodeTestIds: string[]) => (
      nodeTestIds.map((testId) => {
        const node = document.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
        if (!node) {
          return {
            testId,
            inViewport: false,
            closestTestIdsAtCenter: [],
          };
        }
        const nodeRect = node.getBoundingClientRect();
        const centerX = nodeRect.x + nodeRect.width / 2;
        const centerY = nodeRect.y + nodeRect.height / 2;
        const inViewport = centerX >= 0
          && centerX <= window.innerWidth
          && centerY >= 0
          && centerY <= window.innerHeight;
        const elementsAtCenter = document.elementsFromPoint(
          centerX,
          centerY,
        ) as HTMLElement[];
        return {
          testId,
          inViewport,
          closestTestIdsAtCenter: elementsAtCenter
            .map((element) => element.closest('[data-testid]')?.getAttribute('data-testid') ?? null)
            .filter((value, index, array): value is string => Boolean(value) && array.indexOf(value) === index),
        };
      })
    ), visibleNodeTestIds);

    const inViewportNodeLayering = nodeLayeringAfterViewportChange.filter((nodeLayering) => nodeLayering.inViewport);
    expect(inViewportNodeLayering.length).toBeGreaterThanOrEqual(2);
    expect(inViewportNodeLayering.some((nodeLayering) => nodeLayering.testId === 'goal-flow-node-me')).toBe(true);
    for (const nodeLayering of inViewportNodeLayering) {
      expect(
        nodeLayering.closestTestIdsAtCenter,
        `expected ${nodeLayering.testId} to remain in the hit-test stack after viewport changes`,
      ).toContain(nodeLayering.testId);
      const nodeIndex = nodeLayering.closestTestIdsAtCenter.indexOf(nodeLayering.testId);
      const ringsIndex = nodeLayering.closestTestIdsAtCenter.indexOf('goals-hop-rings');
      if (ringsIndex !== -1) {
        expect(
          nodeIndex,
          `expected ${nodeLayering.testId} to stay above hop rings after viewport changes`,
        ).toBeLessThan(ringsIndex);
      }
    }

    expect(goalWarnings.some((entry) => entry.includes('page:suspect-render-state'))).toBe(false);
  });

  test('keeps nodes and edges visible through settled selection, detail-open, zoom, and pan interactions', async ({ page }) => {
    const goalWarnings = trackGoalWarnings(page);

    await gotoGoalsPage(page);
    await expect(page.getByTestId('goal-flow-node-me')).toBeVisible({ timeout: 10000 });

    await openNodeContextMenu(page, 'goal-flow-node-me', 120, 120);
    await expect(page.getByTestId('goal-context-menu')).toBeVisible();
    await page.getByTestId('goal-context-item-downstream').click();

    await expect
      .poll(() => goalWarnings.some((entry) => entry.includes('simulation:end')), {
        timeout: 15000,
        message: 'expected simulation:end warn log before interaction-stability assertions',
      })
      .toBe(true);

    await expect(page.locator('[data-testid^="goal-flow-node-"]')).toHaveCount(2);
    await expect(page.locator('[data-testid^="task-flow-edge-visible-"]')).toHaveCount(1);

    expectVisibleGraphSnapshot(
      await snapshotRenderVisibility(page),
      2,
      1,
      'interaction-stability:settled-idle',
    );

    const viewportBeforeZoom = await readViewportTransform(page);
    const renderer = page.locator('.react-flow__renderer');
    const rendererBox = await renderer.boundingBox();
    expect(rendererBox).not.toBeNull();
    if (!rendererBox) {
      throw new Error('expected react-flow renderer bounding box');
    }

    await renderer.hover();
    await page.mouse.wheel(0, -320);

    await expect
      .poll(() => readViewportTransform(page), {
        timeout: 4000,
        message: 'expected viewport transform to change after zoom interaction',
      })
      .not.toEqual(viewportBeforeZoom);

    const viewportAfterZoom = await readViewportTransform(page);
    expectVisibleGraphSnapshot(
      await snapshotRenderVisibility(page),
      2,
      1,
      'interaction-stability:after-zoom',
    );

    await page.keyboard.down('Space');
    await page.mouse.wheel(120, 96);
    await page.keyboard.up('Space');

    await expect
      .poll(() => readViewportTransform(page), {
        timeout: 4000,
        message: 'expected viewport transform to change after pan interaction',
      })
      .not.toEqual(viewportAfterZoom);

    expect(goalWarnings.some((entry) => entry.includes('page:viewport') && entry.includes('"source":"move"'))).toBe(true);
    expectVisibleGraphSnapshot(
      await snapshotRenderVisibility(page),
      2,
      1,
      'interaction-stability:after-pan',
    );

    const goalNode = page.locator('[data-testid^="goal-flow-node-"]').nth(1);
    await goalNode.click();
    const detailPanel = page.getByTestId('goals-page').getByRole('complementary');
    await expect(detailPanel).toBeVisible();
    await expect(page.getByText('目标详情')).toBeVisible();

    expectVisibleGraphSnapshot(
      await snapshotRenderVisibility(page),
      2,
      1,
      'interaction-stability:goal-selected',
    );

    await detailPanel.getByRole('button').first().click();
    await expect(detailPanel).toHaveCount(0);

    expectVisibleGraphSnapshot(
      await snapshotRenderVisibility(page),
      2,
      1,
      'interaction-stability:detail-closed',
    );

    expect(goalWarnings.some((entry) => entry.includes('page:suspect-render-state'))).toBe(false);
  });

  test('keeps edges visible through edge-detail open and close interactions', async ({ page }) => {
    const goalWarnings = trackGoalWarnings(page);

    await primeGoalsPageWithGraph(page, makeSingleEdgeGraph());
    await gotoGoalsPage(page);
    await expect(page.getByTestId('goal-flow-node-me')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('goal-flow-node-goal-a')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('task-flow-edge-visible-edge-me-a')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('task-flow-edge-label-edge-me-a')).toBeVisible({ timeout: 10000 });

    const edgeBox = await page.getByTestId('task-flow-edge-hit-area-edge-me-a').boundingBox();
    expect(edgeBox, 'edge-detail-stability: expected measurable edge hit area').not.toBeNull();
    if (!edgeBox) {
      throw new Error('expected edge hit area bounding box');
    }

    await page.mouse.click(edgeBox.x + edgeBox.width / 2, edgeBox.y + edgeBox.height / 2, { button: 'right' });
    await expect(page.getByTestId('goal-context-menu')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('goal-context-item-detail').click();

    const edgeDetailPanel = page.getByTestId('goals-page').getByRole('complementary');
    await expect(edgeDetailPanel).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('路径详情')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('task-flow-edge-visible-edge-me-a')).toBeVisible();
    await expect(page.getByTestId('task-flow-edge-marker-edge-me-a')).toBeAttached();
    await expect(page.getByTestId('task-flow-edge-label-edge-me-a')).toBeVisible();

    expectVisibleGraphSnapshot(
      await snapshotRenderVisibility(page),
      2,
      1,
      'edge-detail-stability:detail-open',
    );

    await edgeDetailPanel.getByRole('button').first().click();
    await expect(edgeDetailPanel).toHaveCount(0);
    await expect(page.getByTestId('task-flow-edge-visible-edge-me-a')).toBeVisible();
    await expect(page.getByTestId('task-flow-edge-label-edge-me-a')).toBeVisible();

    expectVisibleGraphSnapshot(
      await snapshotRenderVisibility(page),
      2,
      1,
      'edge-detail-stability:detail-closed',
    );

    expect(goalWarnings.some((entry) => entry.includes('page:suspect-render-state'))).toBe(false);
  });

test('keeps randomized three-node samples within the stable geometry constraints across 20 independent seeds', async ({ page }, testInfo) => {
    const overriddenSeeds = process.env.ISSUE747_RANDOM_SEEDS
      ?.split(',')
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter((value) => Number.isInteger(value) && value > 0) ?? [];
    const seeds = overriddenSeeds.length > 0
      ? overriddenSeeds
      : [...ISSUE747_FROZEN_RANDOM_SAMPLE_SEEDS];
    if (overriddenSeeds.length === 0) {
      expect(
        seeds,
        'expected issue 747 default randomized sample seeds to be frozen into a committed 20-sample baseline',
      ).toEqual(ISSUE747_FROZEN_RANDOM_SAMPLE_SEEDS);
    }
    testInfo.annotations.push({
      type: 'random-seeds',
      description: seeds.join(','),
    });

    for (const [index, seed] of seeds.entries()) {
      const samplePage = await page.context().newPage();
      try {
        const result = await runThreeNodeSample(samplePage, {
          randomSeed: seed,
        });
        expect(result.goalWarnings.some((entry) => entry.includes('simulation:init'))).toBe(true);
        expectThreeNodeConstraints(result.geometry, result.settledInMs, `random-sample-${index + 1}-seed-${seed}`);
      } finally {
        await samplePage.close();
      }
    }
  });

  test('keeps fixed-angle three-node samples within the stable geometry constraints across 20 fixed-angle samples', async ({ page }) => {
    const coverageAngles = Array.from({ length: 20 }, (_, index) => index * Math.PI / 10);

    for (const [index, angle] of coverageAngles.entries()) {
      const samplePage = await page.context().newPage();
      try {
        const result = await runThreeNodeSample(samplePage, {
          fixedPolarSequence: [
            { angle, distance: 192 },
            { angle: angle + 0.02, distance: 384 },
          ],
        });
        expect(result.goalWarnings.some((entry) => entry.includes('simulation:init'))).toBe(true);
        expectThreeNodeConstraints(result.geometry, result.settledInMs, `fixed-angle-${index + 1}`);
      } finally {
        await samplePage.close();
      }
    }
  });
});
