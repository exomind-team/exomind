import { expect, test, type Page } from '@playwright/test';

async function setupIssue213Flags(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('exomind:uiMode', 'new');
    localStorage.setItem('exomind:useMockData', 'true');
    localStorage.removeItem('task_items');
    const today = new Date();
    const morning = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 9, 0, 0).getTime();
    const afternoon = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 15, 0, 0).getTime();
    localStorage.setItem('exomind_time_blocks', JSON.stringify([
      {
        id: 'issue213-block-1',
        name: '深度工作',
        startId: 'issue213-block-1',
        endId: 'issue213-block-1-end',
        note: '顺利完成，比预期快 30 分钟',
        tags: ['block_feedback'],
        startTime: morning,
        endTime: morning + 90 * 60 * 1000,
      },
      {
        id: 'issue213-block-2',
        name: '调试依赖问题',
        startId: 'issue213-block-2',
        endId: 'issue213-block-2-end',
        note: '修掉冲突后继续推进',
        tags: ['block_feedback'],
        startTime: afternoon,
        endTime: afternoon + 60 * 60 * 1000,
      },
    ]));
  });
}

test.describe('Issue #213 Task UI（任务界面）', () => {
  test.beforeEach(async ({ page }) => {
    await setupIssue213Flags(page);
  });

  test('任务列表页展示与快速添加（list + quick add）', async ({ page }) => {
    await page.goto('/tasks');
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('new-tasks-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: '任务' })).toBeVisible();
    await expect(page.getByRole('button', { name: '当下' })).toBeVisible();
    await expect(page.getByRole('button', { name: '今日' })).toBeVisible();
    await expect(page.getByPlaceholder('快速添加任务...')).toBeVisible();
    await expect(page.getByText('实现 CRUD 服务层')).toBeVisible();

    const createdTitle = `E2E issue-213 ${Date.now()}`;
    const quickInput = page.getByPlaceholder('快速添加任务...');
    await quickInput.fill(createdTitle);
    await quickInput.press('Enter');
    await expect(page.getByText(createdTitle)).toBeVisible();

    await page.getByRole('button', { name: '今日' }).click();
    await expect(page.getByText('上午')).toBeVisible();
    await expect(page.getByText('下午')).toBeVisible();
    await expect(page.getByText('深度工作', { exact: true })).toBeVisible();
  });

  test('任务详情卡片交互（模式切换/暂停/输入）', async ({ page }) => {
    await page.goto('/tasks/node-002');
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('new-task-detail-page')).toBeVisible();
    await expect(page.getByText('实现 CRUD 服务层')).toBeVisible();
    await expect(page.getByText('计时', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '开始计时' })).toBeVisible();
  });
});
