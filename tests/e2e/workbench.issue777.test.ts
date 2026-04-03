import { expect, test, type Page } from '@playwright/test';

async function setupIssue777Flags(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('exomind:uiMode', 'new');
    localStorage.setItem('exomind:desktopAdaptiveEnabled', 'true');
    localStorage.setItem('exomind:agentPageEnabled', 'true');
    localStorage.setItem('exomind:developerMode', 'true');
    localStorage.setItem('exomind:workbenchTestPageEnabled', 'true');
    localStorage.setItem('exomind:useMockData', 'true');
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
          openPath: '/agents/chat/agent-review?workbenchBypass=true',
        },
        {
          id: 'pane-ssh-review',
          title: 'SSH Runtime',
          viewKind: 'runtime-view',
          bindingType: 'ssh-runtime',
          status: 'attached',
          description: 'Remote shell attachment',
          openPath: '/agents?workbenchBypass=true&focusSession=session-terminal',
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
    await expect(page.getByTestId('workbench-pane-open-pane-agent-review')).toBeVisible();

    await page.reload();

    await expect(page.getByTestId('workbench-space-name')).toHaveText('Review Space');
    await expect(page.getByText('Planner Agent')).toBeVisible();
    await expect(page.getByText('Remote shell attachment')).toBeVisible();
  });

  test('clicking a pane reaches a meaningful legacy destination（点击 pane 会到达有意义的旧入口）', async ({ page }) => {
    await page.goto('/workbench');

    await expect(page.getByTestId('workbench-pane-open-pane-agent-review')).toBeVisible();
    await page.getByTestId('workbench-pane-open-pane-agent-review').click();

    await expect(page).toHaveURL(/\/agents\/chat\/agent-review\?workbenchBypass=true$/);
    await expect(page.getByTestId('workbench-page')).toHaveCount(0);
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

  test('exposes workbench in desktop sidebar as a test page（桌面侧栏暴露工作台测试入口）', async ({ page }) => {
    await page.goto('/settings');

    await expect(page.getByTestId('desktop-sidebar-item-workbench-test')).toBeVisible();
    await page.getByTestId('desktop-sidebar-item-workbench-test').click();

    await expect(page).toHaveURL(/\/workbench$/);
    await expect(page.getByTestId('workbench-page')).toBeVisible();
  });

  test('exposes workbench in mobile bottom nav as a test page（移动底栏暴露工作台测试入口）', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/tasks');

    await expect(page.getByTestId('mobile-bottom-tab')).toBeVisible();
    await expect(page.getByRole('link', { name: '工作台测试' })).toBeVisible();
    await page.getByRole('link', { name: '工作台测试' }).click();

    await expect(page).toHaveURL(/\/workbench$/);
    await expect(page.getByTestId('workbench-page')).toBeVisible();
  });

  test('keeps workbench test nav hidden until the flag is enabled（未开启开关前隐藏工作台测试入口）', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('exomind:uiMode', 'new');
      localStorage.setItem('exomind:desktopAdaptiveEnabled', 'true');
      localStorage.setItem('exomind:agentPageEnabled', 'true');
      localStorage.setItem('exomind:developerMode', 'true');
      localStorage.removeItem('exomind:workbenchTestPageEnabled');
    });

    await page.goto('/settings');

    await expect(page.getByTestId('desktop-sidebar-item-workbench-test')).toHaveCount(0);
    await page.getByTestId('feature-toggle-workbench-test-switch').click();
    await expect(page.getByTestId('desktop-sidebar-item-workbench-test')).toBeVisible();
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
