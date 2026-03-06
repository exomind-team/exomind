import { expect, test } from '@playwright/test';

test.describe('Issue #374: linked task status transition after ending time block', () => {
  test.beforeEach(async ({ page }) => {
    const userId = `e2e-issue374-${Date.now()}`;
    await page.addInitScript((nextUserId) => {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('exomind:') || key.startsWith('exomind_')) {
          localStorage.removeItem(key);
        }
      }
      localStorage.setItem('exomind:sync-store', JSON.stringify({
        state: {
          currentUser: nextUserId,
          isLoggedIn: true,
        },
        version: 0,
      }));
    }, userId);
  });

  test('selecting suspended in feedback should update linked task to 已挂起', async ({ page }) => {
    const taskTitle = `Issue374-${Date.now()}`;

    await page.goto('/tasks');
    await page.waitForLoadState('networkidle');

    const quickInput = page.getByPlaceholder('快速添加任务...');
    await expect(quickInput).toBeVisible();
    await quickInput.fill(taskTitle);
    await quickInput.press('Enter');

    const taskTitleInList = page.getByText(taskTitle, { exact: true }).first();
    await expect(taskTitleInList).toBeVisible();
    await taskTitleInList.click();

    await expect(page).toHaveURL(/\/tasks\/.+/);
    await expect(page.getByTestId('new-task-detail-page')).toBeVisible();

    await page.getByRole('button', { name: '开始计时' }).click();
    await expect(page).toHaveURL(/\/eventlog/);
    await expect(page.getByTestId('new-focus-state-running')).toBeVisible();

    await page.getByTestId('new-focus-end-button').click();
    await expect(page.getByTestId('feedback-task-status-section')).toBeVisible();
    await page.getByTestId('feedback-task-status-suspended').click();
    await page.getByTestId('new-focus-feedback-textarea').fill('e2e suspend');
    await page.getByTestId('new-focus-feedback-confirm').click();

    await expect(page.getByTestId('new-focus-feedback-textarea')).toHaveCount(0);
    await expect(page.getByTestId('new-focus-state-idle')).toBeVisible();

    await page.getByRole('link', { name: '任务' }).first().click();
    await expect(page).toHaveURL(/\/tasks/);

    const taskTitleAfterEnd = page.getByText(taskTitle, { exact: true }).first();
    await expect(taskTitleAfterEnd).toBeVisible();
    await taskTitleAfterEnd.click();

    await expect(page.getByTestId('new-task-detail-page')).toBeVisible();
    await expect(page.getByText('已挂起', { exact: true })).toBeVisible();
  });
});
