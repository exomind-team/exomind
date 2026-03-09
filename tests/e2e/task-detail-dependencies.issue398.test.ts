import { expect, test } from '@playwright/test';

test.describe('Issue #398 Task detail dependencies（任务详情依赖关系）', () => {
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

  test('can view, switch, remove and add dependencies in task detail', async ({ page }) => {
    await page.goto('/tasks/node-002');

    await expect(page.getByTestId('new-task-detail-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: '实现 CRUD 服务层' })).toBeVisible();
    await expect(page.getByText('依赖关系')).toBeVisible();

    const currentDependency = page.getByTestId('dependency-item-node-001');
    await expect(currentDependency).toBeVisible();
    await expect(currentDependency.getByText('完成 TaskNode 数据模型')).toBeVisible();
    await expect(currentDependency.getByText('已完成')).toBeVisible();

    const reverseDependency = page.getByTestId('reverse-dependency-item-node-003');
    await expect(reverseDependency).toBeVisible();
    await expect(reverseDependency.getByText('编写单元测试')).toBeVisible();
    await expect(reverseDependency.getByText('软依赖')).toBeVisible();

    const typeSelect = page.getByTestId('dependency-type-node-001');
    await typeSelect.selectOption('soft');
    await expect(typeSelect).toHaveValue('soft');

    await page.getByTestId('dependency-remove-node-001').click();
    await expect(page.getByTestId('dependency-current-empty')).toBeVisible();

    await page.getByTestId('dependency-add-task-select').selectOption('node-001');
    await page.getByTestId('dependency-add-type-select').selectOption('hard');
    await page.getByTestId('dependency-add-button').click();

    await expect(page.getByTestId('dependency-item-node-001')).toBeVisible();
    await expect(page.getByTestId('dependency-type-node-001')).toHaveValue('hard');
  });
});
