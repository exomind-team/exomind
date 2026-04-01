import { expect, test, type Page, type Route } from '@playwright/test';

interface MockActiveBlock {
  startId: string;
  name: string;
  mode: 'countup' | 'countdown';
  targetMinutes?: number;
  blockType?: 'active' | 'gap';
  elapsed: number;
  updatedAt?: number;
  phase?: 'running' | 'paused' | 'feedback_in_progress' | 'feedback_submitted';
  version?: number;
  actorId?: string;
  lastTransitionAt?: number;
  lastResumedAt?: number;
  accumulatedRunMs?: number;
  startTime: number;
  actionEndedAt?: number;
  feedbackStartedAt?: number;
  feedbackSubmittedAt?: number;
  pauseAccumulatedMs?: number;
  paused: boolean;
  pausedAt?: number;
  taskIds: string[];
  taskAssociationLog: Array<{
    blockId: string;
    taskId: string;
    action: 'associated' | 'disassociated';
    timestamp: number;
    source: 'block_start' | 'manual';
  }>;
}

interface MockTimeBlock {
  id: string;
  name: string;
  startId: string;
  endId: string;
  note?: string;
  tags: string[];
  startTime: number;
  endTime: number;
  blockType?: 'active' | 'gap';
  taskIds: string[];
  taskStatusOutcomes?: Record<string, string>;
  taskAssociationLog: MockActiveBlock['taskAssociationLog'];
}

async function seedLoggedInProfile(page: Page) {
  await page.addInitScript(() => {
    const profileId = 'profile-e2e-timeblock';
    const now = '2026-04-01T00:00:00.000Z';

    localStorage.setItem('exomind:profiles:index', JSON.stringify([profileId]));
    localStorage.setItem(`exomind:profiles:${profileId}:meta`, JSON.stringify({
      profileId,
      slug: 'e2e-timeblock',
      displayName: 'E2E Timeblock',
      createdAt: now,
      updatedAt: now,
      authMode: 'none',
      state: 'active',
      defaultSyncPolicy: 'local-only',
    }));
    localStorage.setItem('exomind:profile-session', JSON.stringify({
      version: 1,
      activeProfileId: profileId,
      unlockedProfileIds: [profileId],
    }));
  });
}

async function fulfillJson(route: Route, status: number, body: unknown) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function installFakeTimeblockRt(page: Page) {
  let activeBlock: MockActiveBlock | null = null;
  const completedBlocks: MockTimeBlock[] = [];
  let blockCounter = 1;
  let endCounter = 1;
  const actorId = 'e2e-fake-rt';

  const nextId = (prefix: string) => `${prefix}-${String(blockCounter++).padStart(4, '0')}`;
  const nextEndId = () => `end-${String(endCounter++).padStart(4, '0')}`;

  const buildGapBlock = (timestamp: number): MockActiveBlock => ({
    startId: nextId('gap'),
    name: '',
    mode: 'countup',
    blockType: 'gap',
    elapsed: 0,
    updatedAt: timestamp,
    version: 1,
    actorId,
    lastTransitionAt: timestamp,
    startTime: timestamp,
    paused: false,
    taskIds: [],
    taskAssociationLog: [],
  });

  await page.route(/\/timeblocks(?:\/.*)?(?:\?.*)?$/, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    const method = request.method();

    if (pathname === '/timeblocks' && method === 'GET') {
      await fulfillJson(route, 200, completedBlocks);
      return;
    }

    if (pathname === '/timeblocks/active' && method === 'GET') {
      if (!activeBlock) {
        await fulfillJson(route, 404, { error: 'no active block' });
        return;
      }
      await fulfillJson(route, 200, activeBlock);
      return;
    }

    if (pathname === '/timeblocks/active' && method === 'PUT') {
      activeBlock = request.postDataJSON() as MockActiveBlock;
      await route.fulfill({ status: 204 });
      return;
    }

    if (pathname === '/timeblocks/start' && method === 'POST') {
      const payload = request.postDataJSON() as {
        name?: string;
        mode?: 'countup' | 'countdown';
        targetMinutes?: number;
        taskIds?: string[];
      };
      const now = Date.now();
      const mode = payload.mode === 'countdown' ? 'countdown' : 'countup';
      const taskIds = Array.isArray(payload.taskIds) ? payload.taskIds : [];

      activeBlock = {
        startId: nextId('tb'),
        name: payload.name?.trim() || '未命名时间块',
        mode,
        targetMinutes: mode === 'countdown' ? payload.targetMinutes ?? 25 : undefined,
        blockType: 'active',
        elapsed: mode === 'countdown' ? (payload.targetMinutes ?? 25) * 60 * 1000 : 0,
        updatedAt: now,
        phase: 'running',
        version: 1,
        actorId,
        lastTransitionAt: now,
        lastResumedAt: now,
        accumulatedRunMs: 0,
        startTime: now,
        pauseAccumulatedMs: 0,
        paused: false,
        taskIds,
        taskAssociationLog: [],
      };

      await fulfillJson(route, 200, { completed: null, active: activeBlock });
      return;
    }

    if (pathname === '/timeblocks/stop' && method === 'POST') {
      if (!activeBlock || activeBlock.blockType === 'gap') {
        await fulfillJson(route, 409, { error: 'cannot stop: no active block' });
        return;
      }

      const now = Date.now();
      activeBlock = {
        ...activeBlock,
        actionEndedAt: now,
        feedbackStartedAt: now,
        updatedAt: now,
        phase: 'feedback_in_progress',
        version: (activeBlock.version ?? 0) + 1,
        lastTransitionAt: now,
        paused: false,
        pausedAt: undefined,
      };

      await fulfillJson(route, 200, { status: 'stopped', phase: 'feedback_in_progress' });
      return;
    }

    if (pathname === '/timeblocks/end' && method === 'POST') {
      if (!activeBlock || activeBlock.blockType === 'gap') {
        await fulfillJson(route, 409, { error: 'cannot end: no active block' });
        return;
      }
      if (!activeBlock.actionEndedAt && !activeBlock.feedbackStartedAt) {
        await fulfillJson(route, 409, { error: 'cannot end: must stop first' });
        return;
      }

      const payload = request.postDataJSON() as {
        feedback?: string;
        taskStatusOutcomes?: Record<string, string>;
      };
      const now = Date.now();
      const completed: MockTimeBlock = {
        id: activeBlock.startId,
        name: activeBlock.name,
        startId: activeBlock.startId,
        endId: nextEndId(),
        note: payload.feedback,
        tags: ['block_feedback'],
        startTime: activeBlock.startTime,
        endTime: now,
        blockType: activeBlock.blockType,
        taskIds: [...activeBlock.taskIds],
        taskStatusOutcomes: payload.taskStatusOutcomes,
        taskAssociationLog: [...activeBlock.taskAssociationLog],
      };
      completedBlocks.push(completed);

      activeBlock = buildGapBlock(now);

      await fulfillJson(route, 200, { completed, active: activeBlock });
      return;
    }

    await fulfillJson(route, 404, { error: `unhandled fake RT route: ${method} ${pathname}` });
  });
}

test.describe('Issue #374 / #735: linked task status transition after ending time block', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('exomind:') || key.startsWith('exomind_')) {
          localStorage.removeItem(key);
        }
      }
      localStorage.setItem('exomind:uiMode', 'new');
      localStorage.setItem('exomind:useMockData', 'true');
    });
    await seedLoggedInProfile(page);
    await installFakeTimeblockRt(page);
  });

  test('default suspended outcome should update linked task to 已挂起 without extra clicks', async ({ page }) => {
    await page.goto('/tasks/node-002');
    await expect(page.getByTestId('new-task-detail-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: '实现 CRUD 服务层' })).toBeVisible();

    await page.getByRole('button', { name: '开始计时' }).click();
    await expect(page).toHaveURL(/\/eventlog/);
    await expect(page.getByTestId('new-focus-state-running')).toBeVisible();

    await page.getByTestId('new-focus-end-button').click();
    await expect(page.getByTestId('feedback-task-status-section')).toBeVisible();
    await expect(page.getByTestId('feedback-task-status-node-002-suspended')).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('new-focus-feedback-textarea').fill('e2e suspend');
    await page.getByTestId('new-focus-feedback-confirm').click();

    await expect(page.getByTestId('new-focus-feedback-textarea')).toHaveCount(0);
    await page.goBack();
    await expect(page.getByTestId('new-task-detail-page')).toBeVisible();
    await expect(page.getByTestId('new-task-detail-page').getByText('已挂起', { exact: true }).first()).toBeVisible();
  });
});
