import { expect, test } from '@playwright/test';

test.describe('Issue #243 command palette（命令面板）', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('exomind:uiMode', 'new');
      localStorage.setItem('exomind:developerMode', 'true');
      localStorage.setItem('exomind:commandPaletteEnabled', 'true');
      localStorage.setItem('exomind:agentPageEnabled', 'true');
    });
  });

  test('opens from more menu and hotkey, then navigates with availability states（菜单与快捷键闭环）', async ({ page }) => {
    await page.goto('/tasks');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: '更多菜单' }).click();
    await expect(page.getByTestId('page-more-menu-open-command-palette')).toBeVisible();
    await page.getByTestId('page-more-menu-open-command-palette').click();
    await expect(page.getByTestId('command-palette-overlay')).toBeVisible();

    await page.getByTestId('command-palette-input').fill('设置');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/settings$/);

    await page.keyboard.press('ControlOrMeta+K');
    await expect(page.getByTestId('command-palette-overlay')).toBeVisible();

    await page.getByTestId('command-palette-input').fill('目标');
    await expect(page.getByTestId('command-palette-item-navigate:goals-legacy')).toBeVisible();
    await expect(page.getByTestId('command-palette-item-navigate:goals-new')).toContainText('目标系统即将支持（v0.5）');
  });
});
