import { expect, test, type Page } from '@playwright/test';

async function setupIssue354Flags(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('exomind:uiMode', 'new');
    localStorage.setItem('exomind:developerMode', 'true');
    localStorage.setItem('exomind:useMockData', 'true');
    localStorage.setItem('exomind:agentPageEnabled', 'true');
    localStorage.setItem('exomind:desktopAdaptiveEnabled', 'true');
  });
}

test.describe('Issue #354 desktop route regression（桌面路由回归）', () => {
  test.beforeEach(async ({ page }) => {
    await setupIssue354Flags(page);
  });

  test('desktop /agents/chat keeps shell and can send message（桌面对话页壳层与发送交互）', async ({ page }) => {
    await page.goto('/agents/chat/agent-daily');

    await expect(page.getByTestId('desktop-sidebar')).toBeVisible();
    await expect(page.getByTestId('mobile-bottom-tab')).toBeHidden();
    await expect(page.getByTestId('agent-conversation-page')).toBeVisible();
    await expect(page.getByTestId('agent-chat-input-bar')).toBeVisible();

    const inputBarBox = await page.getByTestId('agent-chat-input-bar').boundingBox();
    expect(inputBarBox?.width ?? 0).toBeGreaterThan(500);

    await page.getByPlaceholder('输入消息...').fill('桌面端回归测试消息');
    await page.getByTestId('agent-chat-send-button').evaluate((node) => {
      (node as HTMLButtonElement).click();
    });
    await expect(page.getByText(/已收到：桌面端回归测试消息/)).toBeVisible();
  });

  test('desktop /agents/market keeps shell and category filter works（桌面市场页壳层与分类筛选）', async ({ page }) => {
    await page.goto('/agents/market');

    await expect(page.getByTestId('desktop-sidebar')).toBeVisible();
    await expect(page.getByTestId('mobile-bottom-tab')).toBeHidden();
    await expect(page.getByTestId('agent-market-page')).toBeVisible();

    await page.getByRole('button', { name: '知识包' }).click();
    await expect(page.getByText('团队知识库')).toBeVisible();
    await expect(page.getByText('Code Review Agent')).toHaveCount(0);
    await expect(page.getByText('Google Calendar 数据源')).toHaveCount(0);
  });

  test('desktop /tasks/$taskId keeps shell and timer interactions work（桌面任务详情壳层与计时交互）', async ({ page }) => {
    await page.goto('/tasks/task-001');

    await expect(page.getByTestId('desktop-sidebar')).toBeVisible();
    await expect(page.getByTestId('mobile-bottom-tab')).toBeHidden();
    await expect(page.getByTestId('new-task-detail-page')).toBeVisible();
    await expect(page.getByTestId('task-timer-card')).toBeVisible();

    const countupButton = page.getByTestId('task-mode-countup');
    const countdownButton = page.getByTestId('task-mode-countdown');
    await expect(countdownButton).toHaveAttribute('aria-pressed', 'true');
    await countupButton.click();
    await expect(countupButton).toHaveAttribute('aria-pressed', 'true');

    await page.getByTestId('task-pause-button').click();
    await expect(page.getByPlaceholder('记录当下的事实...')).toBeVisible();
  });
});

