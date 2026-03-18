import { expect, test, type Page } from '@playwright/test';

async function setupIssue551AgentDefaultFlags(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('exomind:uiMode', 'new');
  });
}

test.describe('Issue #551 agent page default enabled（网络页面默认开启）', () => {
  test.beforeEach(async ({ page }) => {
    await setupIssue551AgentDefaultFlags(page);
  });

  test('mobile bottom nav shows 网络 without explicit localStorage flag（未显式写入开关时底栏默认展示网络）', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/tasks');

    await expect(page.getByTestId('mobile-bottom-tab')).toBeVisible();
    await expect(page.getByRole('link', { name: '网络' })).toBeVisible();
  });
});
