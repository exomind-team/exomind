import { randomInt } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

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

async function openNodeContextMenu(page: Page, testId: string, clientX: number, clientY: number) {
  await page.getByTestId(testId).dispatchEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    button: 2,
    clientX,
    clientY,
  });
}

function trackGoalWarnings(page: Page): string[] {
  const goalWarnings: string[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'warning') return;
    const text = message.text();
    if (!text.includes('[goals][#747]')) return;
    goalWarnings.push(text);
  });
  return goalWarnings;
}

interface RenderVisibilitySnapshot {
  nodeCount: number;
  edgeCount: number;
  hiddenNodeIds: string[];
  hiddenEdgeIds: string[];
}

async function snapshotRenderVisibility(page: Page): Promise<RenderVisibilitySnapshot> {
  return page.evaluate(() => {
    const nodeElements = Array.from(document.querySelectorAll('[data-testid^="goal-flow-node-"]')) as HTMLElement[];
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

async function createThreeNodeChain(page: Page) {
  await page.goto('/goals', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('goals-page')).toBeVisible({ timeout: 10000 });
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

async function runThreeNodeSample(page: Page, layoutTestConfig: GoalLayoutTestConfig | null = null) {
  await primeGoalsPage(page, layoutTestConfig);
  const goalWarnings = trackGoalWarnings(page);
  const { firstGoalId } = await createThreeNodeChain(page);
  const settleStartAt = Date.now();

  await expect
    .poll(() => goalWarnings.some((entry) => entry.includes('simulation:end')), {
      timeout: 30000,
      message: 'expected simulation:end warn log for three-node chain within 30s',
    })
    .toBe(true);

  const settledInMs = Date.now() - settleStartAt;
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
}

function expectThreeNodeConstraints(
  geometry: ThreeNodeGeometry | null,
  settledInMs: number,
  sampleLabel: string,
) {
  const edgeRatio = (geometry?.distAB ?? 0) / Math.max(geometry?.distMA ?? 1, 1);
  const hopRatio = (geometry?.distMB ?? 0) / Math.max(geometry?.distMA ?? 1, 1);
  const summary = geometry
    ? `MA=${geometry.distMA.toFixed(2)}, MB=${geometry.distMB.toFixed(2)}, AB=${geometry.distAB.toFixed(2)}, angle=${geometry.angle.toFixed(2)}, edgeRatio=${edgeRatio.toFixed(3)}, hopRatio=${hopRatio.toFixed(3)}`
    : 'geometry=null';
  expect(geometry, `${sampleLabel}: expected measurable three-node geometry (${summary})`).not.toBeNull();
  expect(settledInMs, `${sampleLabel}: expected layout to settle within 30s (${summary})`).toBeLessThanOrEqual(30000);
  expect(hopRatio, `${sampleLabel}: expected Me-B / Me-A ratio to be >= 1 (${summary})`).toBeGreaterThanOrEqual(1);
  expect(hopRatio, `${sampleLabel}: expected Me-B / Me-A ratio to be <= 2.2 (${summary})`).toBeLessThanOrEqual(2.2);
  expect(edgeRatio, `${sampleLabel}: expected A-B / A-Me ratio to be >= 0.8 (${summary})`).toBeGreaterThanOrEqual(0.8);
  expect(edgeRatio, `${sampleLabel}: expected A-B / A-Me ratio to be <= 1.25 (${summary})`).toBeLessThanOrEqual(1.25);
  expect(geometry?.angle ?? 0, `${sampleLabel}: expected angle B-A-Me to exceed 120deg (${summary})`).toBeGreaterThan(120);
}

test.describe('Issue #747 goal layout stability diagnostics', () => {
  test.setTimeout(720000);

  test.beforeEach(async ({ page }) => {
    await primeGoalsPage(page);
  });

  test('keeps nodes visible after simulation settles and emits traceable warn logs', async ({ page }) => {
    const goalWarnings = trackGoalWarnings(page);

    await page.goto('/goals', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('goals-page')).toBeVisible({ timeout: 10000 });

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

  test('renders single-edge arrows and nearest-point anchors in the browser', async ({ page }) => {
    await primeGoalsPageWithGraph(page, makeSingleEdgeGraph());
    await page.goto('/goals', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('goals-page')).toBeVisible({ timeout: 10000 });
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
    await page.goto('/goals', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('goals-page')).toBeVisible({ timeout: 10000 });
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

  test('keeps Me fixed at the concentric-ring center and renders complete independent rings', async ({ page }) => {
    await page.goto('/goals', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('goals-page')).toBeVisible({ timeout: 10000 });
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

    await expect(page.getByTestId('goals-hop-rings')).toBeVisible();
    await expect(page.getByTestId('goals-hop-ring-1')).toBeVisible();
    await expect(page.getByTestId('goals-hop-ring-2')).toBeVisible();

    const initialMetrics = await page.evaluate(() => {
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
        labelOverlap: overlap,
        ring2Rect: {
          left: ring2Rect.left,
          top: ring2Rect.top,
          right: ring2Rect.right,
          bottom: ring2Rect.bottom,
        },
      };
    });

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
    expect(settledMetrics).not.toBeNull();
    expect(Math.abs((settledMetrics?.meCenter.x ?? 0) - (settledMetrics?.flowSurfaceCenter.x ?? 0))).toBeLessThan(24);
    expect(Math.abs((settledMetrics?.meCenter.y ?? 0) - (settledMetrics?.flowSurfaceCenter.y ?? 0))).toBeLessThan(24);
    expect(Math.abs((settledMetrics?.meCenter.x ?? 0) - (initialMetrics?.meCenter.x ?? 0))).toBeLessThan(2);
    expect(Math.abs((settledMetrics?.meCenter.y ?? 0) - (initialMetrics?.meCenter.y ?? 0))).toBeLessThan(2);
  });

  test('keeps nodes and edges visible through settled selection, detail-open, zoom, and pan interactions', async ({ page }) => {
    const goalWarnings = trackGoalWarnings(page);

    await page.goto('/goals', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('goals-page')).toBeVisible({ timeout: 10000 });
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

    expect(goalWarnings.some((entry) => entry.includes('page:suspect-render-state'))).toBe(false);
  });

test('keeps randomized three-node samples within the stable geometry constraints across 20 independent seeds', async ({ page }, testInfo) => {
    const overriddenSeeds = process.env.ISSUE747_RANDOM_SEEDS
      ?.split(',')
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter((value) => Number.isInteger(value) && value > 0) ?? [];
    const seeds = overriddenSeeds.length > 0
      ? overriddenSeeds
      : Array.from({ length: 20 }, () => randomInt(1, 0x7fffffff));
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
