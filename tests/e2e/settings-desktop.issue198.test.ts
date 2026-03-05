import { expect, test, type Page } from '@playwright/test';

async function setupIssue198Flags(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('exomind:uiMode', 'new');
    localStorage.setItem('exomind:developerMode', 'true');
  });
}

test.describe('Issue #198 settings desktop shell（设置页桌面壳层）', () => {
  test.beforeEach(async ({ page }) => {
    await setupIssue198Flags(page);
  });

  test('desktop shows sidebar and VC settings content（桌面显示侧栏和VC设置内容）', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByTestId('new-settings-desktop-vc-root')).toBeVisible();

    await expect(page.getByTestId('desktop-sidebar')).toBeVisible();
    await expect(page.getByTestId('desktop-settings-content')).toBeVisible();
    await expect(page.getByTestId('new-settings-desktop-vc-root')).toBeVisible();
    await expect(page.getByTestId('new-settings-desktop-vc-tabs')).toBeVisible();
    await expect(page.getByTestId('new-settings-desktop-vc-scroll')).toBeVisible();
    await expect(page.getByTestId('new-settings-desktop-vc-section-theme')).toBeVisible();
    await expect(page.getByRole('button', { name: '外观主题' })).toBeVisible();
    await expect(page.getByRole('button', { name: '专注设置' })).toBeVisible();
    await expect(page.getByRole('button', { name: '通知' })).toBeVisible();
    await expect(page.getByRole('button', { name: '危险区域' })).toBeVisible();
    const aboutTab = page.getByRole('button', { name: '关于' });
    await expect(aboutTab).toBeVisible();
    await aboutTab.click();
    await expect(aboutTab).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('new-settings-desktop-vc-section-about')).toBeVisible();
    await expect(page.getByText('更新')).toBeVisible();
    await expect(page.getByText('法律与支持')).toBeVisible();
    await expect(page.getByText('帮助中心')).toBeVisible();
    await expect(page.getByText('反馈建议')).toBeVisible();
    await expect(page.getByText('隐私政策')).toHaveCount(0);
    await expect(page.getByText('用户协议')).toHaveCount(0);
    await expect(page.getByText('开源软件使用声明')).toHaveCount(0);
    await expect(page.getByText('工作模式')).toHaveCount(0);
    await expect(page.getByText('更新日志')).toHaveCount(0);
    await expect(page.getByTestId('desktop-sidebar-item-now')).toBeVisible();
    await expect(page.getByTestId('desktop-sidebar-item-tasks')).toBeVisible();
    await expect(page.getByTestId('desktop-sidebar-item-agents')).toBeVisible();
    await expect(page.getByTestId('desktop-sidebar-item-settings')).toBeVisible();
    await expect(page.getByTestId('desktop-sidebar-item-dashboard')).toHaveCount(0);
    await expect(page.locator('[data-testid^="desktop-sidebar-item-"]')).toHaveCount(4);
    await expect(page.getByTestId('mobile-bottom-tab')).toBeHidden();
  });

  test('desktop agents route uses desktop shell（桌面端 Agent 页面走桌面壳层）', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('exomind:agentPageEnabled', 'true');
      localStorage.setItem('exomind:desktopAdaptiveEnabled', 'true');
    });

    await page.goto('/agents');
    await expect(page.getByTestId('agent-hub-page')).toBeVisible();

    await expect(page.getByTestId('desktop-sidebar')).toBeVisible();
    await expect(page.getByTestId('desktop-settings-content')).toBeVisible();
    await expect(page.getByTestId('agent-hub-page')).toBeVisible();
    await expect(page.getByTestId('mobile-bottom-tab')).toBeHidden();
  });

  test('mobile keeps bottom tab nav on settings（移动端保留底部导航）', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/settings');
    await expect(page.getByRole('link', { name: '设置' })).toBeVisible();

    await expect(page.getByTestId('mobile-bottom-tab')).toBeVisible();
    await expect(page.getByRole('link', { name: '设置' })).toBeVisible();
    await expect(page.getByTestId('desktop-sidebar')).toBeHidden();
  });

  test('legal-support page contains only legal three items（法律与支持页仅法务三项）', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('button', { name: '关于' })).toBeVisible();

    const aboutTab = page.getByRole('button', { name: '关于' });
    await aboutTab.click();
    await page.getByText('法律与支持').click();

    await expect(page).toHaveURL(/\/settings\/legal-support$/);
    await expect(page.getByText('隐私政策')).toBeVisible();
    await expect(page.getByText('用户协议')).toBeVisible();
    await expect(page.getByText('开源软件使用声明')).toBeVisible();
    await expect(page.getByText('帮助中心')).toHaveCount(0);
    await expect(page.getByText('反馈建议')).toHaveCount(0);
    await expect(page.getByText('官网')).toHaveCount(0);
    await expect(page.getByText('赞助开发者')).toHaveCount(0);
  });

  test('desktop adaptive switch can fallback to mobile shell（桌面适配开关可回退移动壳层）', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByTestId('desktop-sidebar')).toBeVisible();

    await expect(page.getByTestId('desktop-sidebar')).toBeVisible();

    const featureTogglesRow = page.getByText('功能开关');
    await featureTogglesRow.scrollIntoViewIfNeeded();
    await featureTogglesRow.click();

    await page.getByTestId('new-settings-desktop-adaptive-switch').click();

    await expect(page.getByTestId('desktop-sidebar')).toBeHidden();
    await expect(page.getByTestId('mobile-bottom-tab')).toBeVisible();
  });

  test('desktop sidebar nav keeps desktop shell on non-settings route（桌面侧栏跳转非设置后保持桌面壳层）', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByTestId('desktop-sidebar')).toBeVisible();

    await expect(page.getByTestId('desktop-sidebar')).toBeVisible();
    await page.getByTestId('desktop-sidebar-item-now').click();

    await expect(page).toHaveURL(/\/eventlog$/);
    await expect(page.getByTestId('desktop-sidebar')).toBeVisible();
    await expect(page.getByTestId('mobile-bottom-tab')).toBeHidden();
  });

  test('desktop tasks and me routes use desktop shell（桌面端任务与Me页面走桌面壳层）', async ({ page }) => {
    await page.goto('/tasks');
    await expect(page.getByTestId('new-tasks-page')).toBeVisible();
    await expect(page.getByTestId('desktop-sidebar')).toBeVisible();
    await expect(page.getByTestId('mobile-bottom-tab')).toBeHidden();

    await page.goto('/me');
    await expect(page.getByTestId('new-me-page')).toBeVisible();
    await expect(page.getByTestId('desktop-sidebar')).toBeVisible();
    await expect(page.getByTestId('mobile-bottom-tab')).toBeHidden();
  });

  test('desktop update route uses desktop shell（桌面端更新页走桌面壳层）', async ({ page }) => {
    await page.goto('/update');
    await expect(page.getByRole('heading', { name: '更新', exact: true })).toBeVisible();
    await expect(page.getByTestId('desktop-sidebar')).toBeVisible();
    await expect(page.getByTestId('mobile-bottom-tab')).toBeHidden();
  });
});
