import { expect, test, type Page } from '@playwright/test';

async function setupIssue213Flags(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('exomind:uiMode', 'new');
    localStorage.setItem('exomind:useMockData', 'true');
    localStorage.removeItem('task_items');
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
    await expect(page.getByText('完成 Task List 视图设计')).toBeVisible();

    const createdTitle = `E2E issue-213 ${Date.now()}`;
    const quickInput = page.getByPlaceholder('快速添加任务...');
    await quickInput.fill(createdTitle);
    await quickInput.press('Enter');
    await page.getByRole('button', { name: '一周' }).click();
    await expect(page.getByText(createdTitle)).toBeVisible();

    await page.getByRole('button', { name: '长期' }).click();
    await expect(page.getByTestId('tasks-goals-content')).toBeVisible();
    await expect(page.getByText('商业项目')).toBeVisible();
    await expect(page.getByText('Exomind v0.3 发布')).toBeVisible();
  });

  test('任务详情卡片交互（模式切换/暂停/输入）', async ({ page }) => {
    await page.goto('/tasks/task-001');
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('new-task-detail-page')).toBeVisible();
    await expect(page.getByTestId('task-timer-card')).toBeVisible();

    const countdownButton = page.getByTestId('task-mode-countdown');
    const countupButton = page.getByTestId('task-mode-countup');
    await expect(countdownButton).toHaveAttribute('aria-pressed', 'true');
    await countupButton.click();
    await expect(countupButton).toHaveAttribute('aria-pressed', 'true');

    const pauseButton = page.getByTestId('task-pause-button');
    await expect(pauseButton).toBeVisible();
    await pauseButton.click();

    await expect(page.getByPlaceholder('记录当下的事实...')).toBeVisible();
  });
});
