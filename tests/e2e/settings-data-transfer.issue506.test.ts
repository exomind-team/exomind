import { expect, test, type Page } from '@playwright/test';

async function setupSettingsState(
  page: Page,
  options: {
    developerMode?: boolean;
    taskBackendMode?: 'legacy' | 'rt-sqlite';
  } = {},
) {
  const {
    developerMode = true,
    taskBackendMode = 'rt-sqlite',
  } = options;

  await page.addInitScript(
    ({ developerModeValue, taskBackendModeValue }) => {
      localStorage.setItem('exomind:developerMode', String(developerModeValue));
      localStorage.setItem('exomind:desktopAdaptiveEnabled', 'true');
      localStorage.setItem('exomind:eventlogBackendMode', 'rt-sqlite');
      localStorage.setItem('exomind:taskBackendMode', taskBackendModeValue);
      localStorage.setItem('exomind:timeblockBackendMode', 'rt-sqlite');
    },
    {
      developerModeValue: developerMode,
      taskBackendModeValue: taskBackendMode,
    },
  );
}

test.describe('Issue #506 unified data transfer（统一导入导出）', () => {
  test('settings page shows unified import/export entry only（设置页只显示统一导入导出入口）', async ({ page }) => {
    await setupSettingsState(page);
    await page.goto('/settings');

    await expect(page.getByRole('button', { name: '导出数据' })).toBeVisible();
    await expect(page.getByRole('button', { name: '导入数据' })).toBeVisible();
    await expect(page.getByRole('button', { name: '导出任务 JSON' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '导出任务 SQLite' })).toHaveCount(0);
  });

  test('web runtime prefers environment guard over legacy guard（Web 环境优先命中运行时保护）', async ({ page }) => {
    await setupSettingsState(page, { taskBackendMode: 'legacy' });
    await page.goto('/settings');

    await page.getByRole('button', { name: '导出数据' }).click();
    await page.getByRole('button', { name: /任务 导入或导出任务与其 RT SQLite 快照/ }).click();

    await expect(page.getByText('当前环境不支持统一导入导出，请在桌面端使用。')).toBeVisible();
    await expect(page.getByRole('button', { name: '开始导出' })).toBeDisabled();
  });

  test('web runtime still disables unified export even when task backend is rt-sqlite（Web 环境下即使任务后端为 rt-sqlite 也禁用统一导出）', async ({ page }) => {
    await setupSettingsState(page, { taskBackendMode: 'rt-sqlite' });
    await page.goto('/settings');

    await page.getByRole('button', { name: '导出数据' }).click();
    await page.getByRole('button', { name: /任务 导入或导出任务与其 RT SQLite 快照/ }).click();

    await expect(page.getByText('当前环境不支持统一导入导出，请在桌面端使用。')).toBeVisible();
    await expect(page.getByRole('button', { name: '开始导出' })).toBeDisabled();
  });
});
