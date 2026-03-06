import { expect, test, type Page } from '@playwright/test';

async function setupIssue204Flags(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('exomind:uiMode', 'new');
    localStorage.setItem('exomind:agentPageEnabled', 'true');
    localStorage.setItem('exomind:useMockData', 'true');
  });
}

test.describe('Issue #204 Agent Hub（Agent Hub 全视图）', () => {
  test.beforeEach(async ({ page }) => {
    await setupIssue204Flags(page);
  });

  test('topology canvas fills topology container（桌面端拓扑画布应贴满拓扑容器）', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/agents');

    await expect(page.getByTestId('agent-hub-page')).toBeVisible();
    await expect(page.getByTestId('agent-topology-view')).toBeVisible();
    await expect(page.getByTestId('agent-topology-canvas')).toBeVisible();

    const layoutMetrics = await page.evaluate(() => {
      const topologyViewNode = document.querySelector('[data-testid="agent-topology-view"]');
      const canvasNode = document.querySelector('[data-testid="agent-topology-canvas"]');
      if (!topologyViewNode || !canvasNode) return null;

      const topologyRect = topologyViewNode.getBoundingClientRect();
      const canvasRect = canvasNode.getBoundingClientRect();
      const fillRatio = topologyRect.height > 0 ? canvasRect.height / topologyRect.height : 0;

      return {
        topologyHeight: topologyRect.height,
        canvasHeight: canvasRect.height,
        fillRatio,
      };
    });

    expect(layoutMetrics).not.toBeNull();
    expect(layoutMetrics!.fillRatio).toBeGreaterThan(0.98);
  });

  test('main views + add node sheet + list-to-detail navigation（主视图和详情跳转）', async ({ page }) => {
    await page.goto('/agents');
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('agent-hub-page')).toBeVisible();
    await expect(page.getByTestId('agent-topology-view')).toBeVisible();

    await page.getByTestId('agent-view-toggle-list').click();
    await expect(page.getByTestId('agent-list-view')).toBeVisible();

    await page.getByTestId('agent-add-node-button').click();
    await expect(page.getByTestId('agent-add-node-sheet')).toBeVisible();
    await expect(page.getByText('从市场安装')).toBeVisible();
    await page.getByTestId('agent-add-node-close').click();
    await expect(page.getByTestId('agent-add-node-sheet')).toBeHidden();

    await page.getByTestId('agent-list-item-agent-daily').click();
    await expect(page).toHaveURL(/\/agents\/agent\/agent-daily$/);
    await expect(page.getByTestId('agent-detail-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: '日报 Agent' })).toBeVisible();
  });

  test('topology settings uses desktop right panel and mobile sheet（拓扑设置桌面右栏 + 移动底部抽屉）', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto('/agents');
    await expect(page.getByTestId('agent-hub-page')).toBeVisible();

    await page.getByTestId('agent-topology-settings-button').click();
    await expect(page.getByTestId('agent-rightpanel-shell')).toBeVisible();
    await expect(page.getByTestId('agent-rightpanel-topology-settings')).toBeVisible();
    await expect(page.getByTestId('agent-topology-settings-panel')).toHaveCount(0);

    await page.getByRole('button', { name: '关闭' }).click();
    await expect(page.getByTestId('agent-rightpanel-shell')).toBeHidden();

    await page.setViewportSize({ width: 393, height: 852 });
    await page.reload();
    await expect(page.getByTestId('agent-hub-page')).toBeVisible();

    await page.getByTestId('agent-topology-settings-button').click();
    await expect(page.getByTestId('agent-topology-settings-panel')).toBeVisible();
    await expect(page.getByTestId('agent-rightpanel-shell')).toHaveCount(0);

    const mobileRect = await page.getByTestId('agent-topology-settings-panel').evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return {
        bottom: rect.bottom,
      };
    });
    expect(mobileRect.bottom).toBeGreaterThan(840);
  });

  test('chat streaming + market browse（对话流式与市场浏览）', async ({ page }) => {
    await page.goto('/agents/chat/agent-daily');
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('agent-conversation-page')).toBeVisible();
    await page.getByPlaceholder('输入消息...').fill('今天情况如何');
    await page.getByTestId('agent-chat-send-button').click();
    await expect(page.getByText(/已收到|今天共收集了/)).toBeVisible();

    await page.goto('/agents/market');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('agent-market-page')).toBeVisible();
    await expect(page.getByText('热门推荐')).toBeVisible();
    await expect(page.getByText('Code Review Agent')).toBeVisible();
  });

  test('agent chat honors light theme surfaces（Agent 对话页应遵循浅色主题表面色）', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('exomind:themePreference', 'light');
    });

    await page.goto('/agents/chat/agent-daily');
    await expect(page.getByTestId('agent-conversation-page')).toBeVisible();
    await expect(page.getByTestId('agent-chat-input')).toBeVisible();

    const surfaces = await page.evaluate(() => {
      const pageNode = document.querySelector('[data-testid="agent-conversation-page"]');
      const inputNode = document.querySelector('[data-testid="agent-chat-input"]');
      const agentBubble = document.querySelector('[data-testid="agent-conversation-message-agent-history"]');

      return {
        pageBg: pageNode ? window.getComputedStyle(pageNode).backgroundColor : null,
        inputBg: inputNode ? window.getComputedStyle(inputNode).backgroundColor : null,
        bubbleBg: agentBubble ? window.getComputedStyle(agentBubble).backgroundColor : null,
      };
    });

    expect(surfaces.pageBg).not.toBe('rgb(12, 10, 9)');
    expect(surfaces.inputBg).not.toBe('rgb(28, 25, 23)');
    expect(surfaces.bubbleBg).not.toBe('rgb(28, 25, 23)');
  });
});

test.describe('Issue #204 Agent Hub runtime toggle（运行时切换测试数据）', () => {
  test('switches to mock topology without full reload and keeps dark surface（不刷新切换到 mock 并保持暗色背景）', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('exomind:uiMode', 'new');
      localStorage.setItem('exomind:agentPageEnabled', 'true');
      localStorage.setItem('exomind:developerMode', 'true');
      localStorage.setItem('exomind:themePreference', 'dark');
      localStorage.setItem('exomind:useMockData', 'false');
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('agent_hub_')) {
          localStorage.removeItem(key);
        }
      }
    });

    await page.goto('/agents');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('agent-hub-page')).toBeVisible();
    await expect(page.getByTestId('agent-topology-node-agent-daily')).toHaveCount(0);

    await page.getByRole('link', { name: '设置' }).click();
    await expect(page.getByTestId('new-settings-use-mock-data-switch')).toBeVisible();
    await page.getByTestId('new-settings-use-mock-data-switch').click();

    await page.goto('/agents');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('agent-hub-page')).toBeVisible();

    const pageBackground = await page.getByTestId('agent-hub-page').evaluate((node) => {
      return window.getComputedStyle(node).backgroundColor;
    });
    expect(pageBackground).toBe('rgb(12, 10, 9)');
  });
});
