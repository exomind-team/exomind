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
});
