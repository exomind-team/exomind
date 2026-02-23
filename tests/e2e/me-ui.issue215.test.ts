import { expect, test, type Page } from '@playwright/test';

async function setupIssue215Flags(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('exomind:uiMode', 'new');
    localStorage.setItem('exomind:useMockData', 'true');
  });
}

test.describe('Issue #215 Me UI（Me 三视图）', () => {
  test.beforeEach(async ({ page }) => {
    await setupIssue215Flags(page);
  });

  test('默认展示状态视图并可切换学习/内隐（status -> learn -> implicit）', async ({ page }) => {
    await page.goto('/me');
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('new-me-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Me' })).toBeVisible();
    await expect(page.getByRole('button', { name: '状态' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('me-status-summary-card')).toBeVisible();

    await page.getByRole('button', { name: '学习' }).click();
    await expect(page.getByRole('button', { name: '学习' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('me-learn-urgent-card')).toBeVisible();
    await expect(page.getByText('急需知识')).toBeVisible();

    await page.getByRole('button', { name: '内隐' }).click();
    await expect(page.getByRole('button', { name: '内隐' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('me-implicit-belief-card')).toBeVisible();
    await expect(page.getByText('信念网络')).toBeVisible();
  });

  test('底部导航可进入 Me（bottom nav to me）', async ({ page }) => {
    await page.goto('/tasks');
    await page.waitForLoadState('networkidle');

    await page.getByRole('link', { name: 'Me' }).click();
    await expect(page).toHaveURL(/\/me$/);
    await expect(page.getByTestId('new-me-page')).toBeVisible();
  });
});

