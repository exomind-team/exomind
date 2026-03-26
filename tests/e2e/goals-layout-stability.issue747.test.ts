import { randomInt } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

interface GoalLayoutTestConfig {
  randomSeed?: number;
  fixedPolarSequence?: Array<{
    angle: number;
    distance: number;
  }>;
}

interface ThreeNodeGeometry {
  distMA: number;
  distMB: number;
  distAB: number;
  angle: number;
}

async function primeGoalsPage(page: Page, layoutTestConfig: GoalLayoutTestConfig | null = null) {
  await page.addInitScript((config) => {
    localStorage.setItem('exomind:goalsPageEnabled', 'true');
    localStorage.setItem('exomind:developerMode', 'true');
    localStorage.removeItem('exomind:goal-graph');
    localStorage.removeItem('exomind:goal-oplog');
    localStorage.removeItem('exomind:goals-guide-hidden');
    const windowWithConfig = window as typeof window & {
      __EXOMIND_GOAL_LAYOUT_TEST_CONFIG__?: GoalLayoutTestConfig;
    };
    if (config) {
      windowWithConfig.__EXOMIND_GOAL_LAYOUT_TEST_CONFIG__ = config;
      return;
    }
    delete windowWithConfig.__EXOMIND_GOAL_LAYOUT_TEST_CONFIG__;
  }, layoutTestConfig);
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
  const summary = geometry
    ? `MA=${geometry.distMA.toFixed(2)}, MB=${geometry.distMB.toFixed(2)}, AB=${geometry.distAB.toFixed(2)}, angle=${geometry.angle.toFixed(2)}, edgeRatio=${edgeRatio.toFixed(3)}`
    : 'geometry=null';
  expect(geometry, `${sampleLabel}: expected measurable three-node geometry (${summary})`).not.toBeNull();
  expect(settledInMs, `${sampleLabel}: expected layout to settle within 30s (${summary})`).toBeLessThanOrEqual(30000);
  expect(
    geometry?.distMB ?? 0,
    `${sampleLabel}: expected Me-B distance to stay at least 1.5x Me-A (${summary})`,
  ).toBeGreaterThanOrEqual((geometry?.distMA ?? 0) * 1.5);
  expect(edgeRatio, `${sampleLabel}: expected A-B / A-Me ratio to be >= 0.8 (${summary})`).toBeGreaterThanOrEqual(0.8);
  expect(edgeRatio, `${sampleLabel}: expected A-B / A-Me ratio to be <= 1.25 (${summary})`).toBeLessThanOrEqual(1.25);
  expect(geometry?.angle ?? 0, `${sampleLabel}: expected angle B-A-Me to exceed 120deg (${summary})`).toBeGreaterThan(120);
}

test.describe('Issue #747 goal layout stability diagnostics', () => {
  test.setTimeout(240000);

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

    expect(goalWarnings.some((entry) => entry.includes('simulation:init'))).toBe(true);
    expect(goalWarnings.some((entry) => entry.includes('page:render-health'))).toBe(true);
    expect(goalWarnings.some((entry) => entry.includes('page:suspect-render-state'))).toBe(false);
  });

  test('renders full concentric hop rings around Me without overlapping labels or glow rectangles', async ({ page }) => {
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

    const ringMetrics = await page.evaluate(() => {
      const me = document.querySelector('[data-testid="goal-flow-node-me"]') as HTMLElement | null;
      const rings = document.querySelector('[data-testid="goals-hop-rings"]') as SVGSVGElement | null;
      const ring1 = document.querySelector('[data-testid="goals-hop-ring-1"] circle') as SVGCircleElement | null;
      const ring2 = document.querySelector('[data-testid="goals-hop-ring-2"] circle') as SVGCircleElement | null;
      const label1 = document.querySelector('[data-testid="goals-hop-ring-1"] text') as SVGTextElement | null;
      const label2 = document.querySelector('[data-testid="goals-hop-ring-2"] text') as SVGTextElement | null;

      if (!me || !rings || !ring1 || !ring2 || !label1 || !label2) {
        return null;
      }

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
        topElementAtMeCenter:
          topElementAtMeCenter?.closest('[data-testid]')?.getAttribute('data-testid')
          ?? topElementAtMeCenter?.tagName
          ?? null,
        labelOverlap: overlap,
      };
    });

    expect(ringMetrics).not.toBeNull();
    expect(ringMetrics?.glowCircleCount).toBe(0);
    expect(ringMetrics?.ring1.fill).toBe('none');
    expect(ringMetrics?.ring2.fill).toBe('none');
    expect(ringMetrics?.ring1.cx).toBe(ringMetrics?.ring2.cx);
    expect(ringMetrics?.ring1.cy).toBe(ringMetrics?.ring2.cy);
    expect(ringMetrics?.ring2.r ?? 0).toBeGreaterThan(ringMetrics?.ring1.r ?? 0);
    expect(ringMetrics?.labelOverlap).toBe(false);
    expect(Math.abs((ringMetrics?.ring1.centerX ?? 0) - (ringMetrics?.meCenter.x ?? 0))).toBeLessThan(6);
    expect(Math.abs((ringMetrics?.ring1.centerY ?? 0) - (ringMetrics?.meCenter.y ?? 0))).toBeLessThan(6);
    expect(Math.abs((ringMetrics?.ring2.centerX ?? 0) - (ringMetrics?.meCenter.x ?? 0))).toBeLessThan(6);
    expect(Math.abs((ringMetrics?.ring2.centerY ?? 0) - (ringMetrics?.meCenter.y ?? 0))).toBeLessThan(6);
    expect(ringMetrics?.topElementAtMeCenter).toBe('goal-flow-node-me');
  });

  test('keeps randomized three-node samples within the stable geometry constraints across 10 independent seeds', async ({ page }, testInfo) => {
    const overriddenSeeds = process.env.ISSUE747_RANDOM_SEEDS
      ?.split(',')
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter((value) => Number.isInteger(value) && value > 0) ?? [];
    const seeds = overriddenSeeds.length > 0
      ? overriddenSeeds
      : Array.from({ length: 10 }, () => randomInt(1, 0x7fffffff));
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

  test('keeps fixed-angle three-node samples within the stable geometry constraints across full angle coverage', async ({ page }) => {
    const coverageAngles = Array.from({ length: 12 }, (_, index) => index * Math.PI / 6);

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
