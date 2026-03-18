import { expect, test, type Page } from '@playwright/test';

function buildCompletedBlock() {
  const today = new Date();
  const startTime = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 9, 15, 0).getTime();
  const endTime = startTime + 50 * 60 * 1000;

  return {
    id: 'issue418516-block-1',
    startId: 'issue418516-block-1',
    endId: 'issue418516-block-1-end',
    name: 'Issue 418/516 联调时间块',
    note: '完成多任务收尾与详情验证',
    tags: ['block_feedback'],
    startTime,
    endTime,
    taskIds: ['node-001', 'node-002'],
    taskStatusOutcomes: {
      'node-001': 'completed',
      'node-002': 'continue',
    },
    taskAssociationLog: [
      {
        blockId: 'issue418516-block-1',
        taskId: 'node-001',
        action: 'associated',
        timestamp: startTime,
        source: 'block_start',
      },
      {
        blockId: 'issue418516-block-1',
        taskId: 'node-002',
        action: 'associated',
        timestamp: startTime + 60_000,
        source: 'block_start',
      },
      {
        blockId: 'issue418516-block-1',
        taskId: 'node-002',
        action: 'disassociated',
        timestamp: startTime + 20 * 60 * 1000,
        source: 'manual',
      },
    ],
  };
}

async function setupIssue418516State(page: Page) {
  const completedBlock = buildCompletedBlock();
  await page.addInitScript((seedBlock) => {
    const keysToDelete: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && (key.startsWith('exomind_') || key.startsWith('exomind:'))) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach((key) => localStorage.removeItem(key));

    localStorage.setItem('exomind:uiMode', 'new');
    localStorage.setItem('exomind:useMockData', 'true');
    localStorage.setItem('exomind_time_blocks', JSON.stringify([seedBlock]));
    localStorage.removeItem('exomind_active_block');
  }, completedBlock);
}

test.describe('Issue #418/#516 Now tabs + timeblock detail（当下三 Tab 与时间块详情）', () => {
  test.beforeEach(async ({ page }) => {
    await setupIssue418516State(page);
  });

  test('record tab hides timer widget and today/detail stay timeblock-first（记录页隐藏计时器，今日/详情按时间块展示）', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('tab', { name: '专注' })).toBeVisible();

    await expect(page.locator('[data-state="active"] [data-testid="new-focus-timer-widget"]')).toHaveCount(1);

    await page.getByRole('tab', { name: '记录' }).click();
    await expect(page.locator('[data-state="active"] [data-testid="event-list"]')).toHaveCount(1);
    await expect(page.locator('[data-state="active"] [data-testid="new-focus-timer-widget"]')).toHaveCount(0);

    await page.getByRole('tab', { name: '今日' }).click();
    await expect(page.getByText('Issue 418/516 联调时间块')).toBeVisible();
    await expect(page.getByText('完成 TaskNode 数据模型 · completed')).toBeVisible();
    await expect(page.getByText('实现 CRUD 服务层 · continue')).toBeVisible();

    await page.getByRole('link', { name: /Issue 418\/516 联调时间块/ }).click();
    await expect(page).toHaveURL(/\/tasks\/block\/issue418516-block-1$/);

    const linkedTasksSection = page.locator('section').filter({
      has: page.getByRole('heading', { name: '关联任务' }),
    });
    const associationSection = page.locator('section').filter({
      has: page.getByRole('heading', { name: '关联日志' }),
    });

    await expect(page.getByRole('heading', { name: 'Issue 418/516 联调时间块' })).toBeVisible();
    await expect(linkedTasksSection).toBeVisible();
    await expect(linkedTasksSection.getByText('完成 TaskNode 数据模型')).toBeVisible();
    await expect(linkedTasksSection.getByText('实现 CRUD 服务层')).toBeVisible();
    await expect(linkedTasksSection.getByText('completed')).toBeVisible();
    await expect(linkedTasksSection.getByText('continue')).toBeVisible();
    await expect(associationSection).toBeVisible();
    await expect(associationSection.getByText('associated · block_start').first()).toBeVisible();
    await expect(associationSection.getByText('disassociated · manual')).toBeVisible();
  });
});
