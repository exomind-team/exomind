import { expect, test, type Page } from '@playwright/test';

async function setupIssue777Flags(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('exomind:uiMode', 'new');
    localStorage.setItem('exomind:desktopAdaptiveEnabled', 'true');
    localStorage.setItem('exomind:agentPageEnabled', 'true');
    localStorage.setItem('exomind:workbench:phase1-flat:v1', JSON.stringify({
      version: 1,
      space: {
        id: 'space-review',
        name: 'Review Space',
        restoredAt: '2026-03-30T12:00:00.000Z',
      },
      surface: {
        id: 'surface-main',
        layoutPreset: 'flat-2up',
      },
      panes: [
        {
          id: 'pane-agent-review',
          title: 'Planner Agent',
          viewKind: 'session-view',
          bindingType: 'agent-session',
          status: 'running',
          description: 'Primary planner session',
        },
        {
          id: 'pane-ssh-review',
          title: 'SSH Runtime',
          viewKind: 'runtime-view',
          bindingType: 'ssh-runtime',
          status: 'attached',
          description: 'Remote shell attachment',
        },
      ],
    }));
  });
}

test.describe('Issue #777 flat workbench（平铺工作台最小可见功能）', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1680, height: 1050 });
    await setupIssue777Flags(page);
  });

  test('opens /workbench and restores the recent mixed panes（打开工作台并恢复最近的混合 pane）', async ({ page }) => {
    await page.goto('/workbench');

    await expect(page.getByTestId('workbench-page')).toBeVisible();
    await expect(page.getByTestId('workbench-space-name')).toHaveText('Review Space');
    await expect(page.getByTestId('workbench-pane-grid')).toBeVisible();
    await expect(page.getByTestId('workbench-pane-agent-session')).toBeVisible();
    await expect(page.getByTestId('workbench-pane-ssh-runtime')).toBeVisible();
    await expect(page.getByText('Planner Agent')).toBeVisible();
    await expect(page.getByText('Remote shell attachment')).toBeVisible();

    await page.reload();

    await expect(page.getByTestId('workbench-space-name')).toHaveText('Review Space');
    await expect(page.getByText('Planner Agent')).toBeVisible();
    await expect(page.getByText('Remote shell attachment')).toBeVisible();
  });
});
