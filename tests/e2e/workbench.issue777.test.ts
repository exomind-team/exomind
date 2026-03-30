import { expect, test, type Page } from '@playwright/test';

async function setupIssue777Flags(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('exomind:uiMode', 'new');
    localStorage.setItem('exomind:desktopAdaptiveEnabled', 'true');
    localStorage.setItem('exomind:agentPageEnabled', 'true');
    localStorage.setItem('exomind:workbenchLegacyShimEnabled', 'true');
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

  test('routes /agents to the workbench when shim is enabled（开启 shim 后 /agents 落到工作台）', async ({ page }) => {
    await page.goto('/agents');

    await expect(page).toHaveURL(/\/workbench\?legacySource=agents-hub$/);
    await expect(page.getByTestId('workbench-page')).toBeVisible();
    await expect(page.getByTestId('workbench-legacy-entry')).toContainText('/agents');
  });

  test('routes /agents/chat/$agentId to the workbench handoff view（旧聊天入口落到工作台接力视图）', async ({ page }) => {
    await page.goto('/agents/chat/agent-daily');

    await expect(page).toHaveURL(/\/workbench\?legacySource=agent-chat&agentId=agent-daily$/);
    await expect(page.getByTestId('workbench-page')).toBeVisible();
    await expect(page.getByTestId('workbench-legacy-entry')).toContainText('/agents/chat/agent-daily');
    await expect(page.getByText('Agent Chat / agent-daily')).toBeVisible();
  });
});

test.describe('Issue #777 workbench shim guard（工作台 shim 守卫）', () => {
  test('keeps legacy /agents behavior when shim is disabled（shim 关闭时仍保留旧 /agents 行为）', async ({ page }) => {
    await page.setViewportSize({ width: 1680, height: 1050 });
    await page.addInitScript(() => {
      localStorage.setItem('exomind:uiMode', 'new');
      localStorage.setItem('exomind:desktopAdaptiveEnabled', 'true');
      localStorage.setItem('exomind:agentPageEnabled', 'true');
      localStorage.setItem('exomind:useMockData', 'true');
      localStorage.removeItem('exomind:workbenchLegacyShimEnabled');
    });

    await page.goto('/agents');

    await expect(page).toHaveURL(/\/agents$/);
    await expect(page.getByTestId('agent-hub-page')).toBeVisible();
  });
});
