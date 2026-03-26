import { expect, test } from '@playwright/test';

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
