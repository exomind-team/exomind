import { expect, test, type Page } from '@playwright/test';

async function setupIssue198Flags(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('exomind:uiMode', 'new');
    localStorage.setItem('exomind:developerMode', 'true');
    localStorage.setItem('exomind:agentPageEnabled', 'true');
    localStorage.setItem('exomind:mePageEnabled', 'true');
    localStorage.setItem('exomind:desktopAdaptiveEnabled', 'true');
  });
}

async function getTestIdWidth(page: Page, testId: string): Promise<number> {
  return page.getByTestId(testId).evaluate((node) => Math.round(node.getBoundingClientRect().width));
}

async function setRangeValue(page: Page, testId: string, value: number): Promise<void> {
  await page.getByTestId(testId).evaluate((node, nextValue) => {
    const input = node as HTMLInputElement;
    const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    descriptor?.set?.call(input, String(nextValue));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

async function readLocalStorageValue(page: Page, key: string): Promise<string | null> {
  return page.evaluate((storageKey) => window.localStorage.getItem(storageKey), key);
}

async function seedLoggedInDesktopProfile(page: Page) {
  await page.addInitScript(() => {
    const profileId = 'profile-exomind';
    const linkId = 'link-exomind';
    const now = '2026-03-07T00:00:00.000Z';

    localStorage.setItem('exomind:profiles:index', JSON.stringify([profileId]));
    localStorage.setItem(`exomind:profiles:${profileId}:meta`, JSON.stringify({
      profileId,
      slug: 'exomind',
      displayName: 'Hailay',
      createdAt: now,
      updatedAt: now,
      authMode: 'password',
      state: 'active',
      defaultSyncPolicy: 'local-only',
    }));
    localStorage.setItem('exomind:profile-session', JSON.stringify({
      version: 1,
      activeProfileId: profileId,
      unlockedProfileIds: [profileId],
    }));
    localStorage.setItem('exomind:identity-links:index', JSON.stringify([linkId]));
    localStorage.setItem(`exomind:identity-links:meta:${linkId}`, JSON.stringify({
      linkId,
      profileId,
      providerId: 'pouchdb',
      remoteIdentityId: 'remote-exomind',
      remoteIdentityKey: 'user@example.com',
      authMode: 'basic',
      status: 'linked',
      syncMode: 'realtime',
      linkedAt: now,
    }));
    localStorage.setItem(`exomind:identity-links:secret:${linkId}`, JSON.stringify({
      linkId,
      authType: 'basic',
      authUsername: 'exomind',
      authSecret: 'issue198-secret',
      updatedAt: now,
    }));
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
    await expect(page.getByRole('button', { name: '外观主题', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '专注设置', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '输入', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '服务', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '数据', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '危险区域', exact: true })).toBeVisible();
    await expect(page.getByText('语音转写后')).toBeVisible();
    await expect(page.getByText('反馈内容')).toBeVisible();
    const aboutTab = page.getByRole('button', { name: '关于', exact: true });
    await expect(aboutTab).toBeVisible();
    await aboutTab.click();
    await expect(aboutTab).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('new-settings-desktop-vc-section-about')).toBeVisible();
    await expect(page.getByText('官网')).toBeVisible();
    await expect(page.getByText('赞助开发者（Starlin）')).toBeVisible();
    await expect(page.getByText('法律与支持')).toBeVisible();
    await expect(page.getByText('版本')).toBeVisible();
    await expect(page.getByText('构建')).toBeVisible();
    await expect(page.getByText('隐私政策')).toHaveCount(0);
    await expect(page.getByText('用户协议')).toHaveCount(0);
    await expect(page.getByText('开源软件使用声明')).toHaveCount(0);
    await page.getByRole('button', { name: '数据', exact: true }).click();
    await expect(page.getByTestId('new-settings-desktop-vc-section-data')).toBeVisible();
    await expect(page.getByRole('button', { name: '导出数据' })).toBeVisible();
    await expect(page.getByRole('button', { name: '导入数据' })).toBeVisible();
    await expect(page.getByTestId('desktop-sidebar-item-now')).toBeVisible();
    await expect(page.getByTestId('desktop-sidebar-item-tasks')).toBeVisible();
    await expect(page.getByTestId('desktop-sidebar-item-me')).toBeVisible();
    await expect(page.getByTestId('desktop-sidebar-item-agents')).toBeVisible();
    await expect(page.getByTestId('desktop-sidebar-item-workbench-test')).toHaveCount(0);
    await expect(page.getByTestId('desktop-sidebar-item-settings')).toBeVisible();
    await expect(page.getByTestId('desktop-sidebar-item-dashboard')).toHaveCount(0);
    await expect(page.locator('[data-testid^="desktop-sidebar-item-"]')).toHaveCount(5);
    await expect(page.getByTestId('mobile-bottom-tab')).toBeHidden();
  });

  test('desktop sidebar can collapse and expand with wider content（桌面侧栏可收起展开且内容区变宽）', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByTestId('desktop-sidebar')).toBeVisible();

    const sidebarWidthExpanded = await getTestIdWidth(page, 'desktop-sidebar');
    const contentWidthExpanded = await getTestIdWidth(page, 'desktop-settings-content');

    const toggle = page.getByTestId('desktop-sidebar-toggle');
    await expect(toggle).toHaveAttribute('aria-label', '收起侧边栏');
    await toggle.click();
    await expect(page.getByTestId('desktop-sidebar')).toHaveAttribute('data-state', 'collapsed');
    await expect(toggle).toHaveAttribute('aria-label', '展开侧边栏');
    await page.waitForTimeout(250);

    const sidebarWidthCollapsed = await getTestIdWidth(page, 'desktop-sidebar');
    const contentWidthCollapsed = await getTestIdWidth(page, 'desktop-settings-content');

    expect(sidebarWidthCollapsed).toBeLessThan(sidebarWidthExpanded);
    expect(contentWidthCollapsed).toBeGreaterThan(contentWidthExpanded + 100);

    await toggle.click();
    await expect(page.getByTestId('desktop-sidebar')).toHaveAttribute('data-state', 'expanded');
    await expect(toggle).toHaveAttribute('aria-label', '收起侧边栏');
  });

  test('desktop sidebar collapse persists across desktop routes（桌面侧栏收起状态在桌面路由切换间保持）', async ({ page }) => {
    await page.goto('/settings');
    await page.getByTestId('desktop-sidebar-toggle').click();
    await expect(page.getByTestId('desktop-sidebar')).toHaveAttribute('data-state', 'collapsed');

    await page.getByTestId('desktop-sidebar-item-now').click();
    await expect(page).toHaveURL(/\/eventlog$/);
    await expect(page.getByTestId('desktop-sidebar')).toHaveAttribute('data-state', 'collapsed');

    await page.getByTestId('desktop-sidebar-item-settings').click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByTestId('desktop-sidebar')).toHaveAttribute('data-state', 'collapsed');
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

  test('desktop input section can update overlay preferences（桌面输入分组可修改悬浮窗偏好）', async ({ page }) => {
    await page.goto('/settings');
    await page.getByRole('button', { name: '输入', exact: true }).click();

    await expect(page.getByTestId('new-settings-voice-overlay-opacity-row')).toBeVisible();
    await expect(page.getByTestId('new-settings-voice-overlay-diagnostics-row')).toBeVisible();
    await expect(page.getByTestId('new-settings-voice-overlay-transcript-lines-row')).toBeVisible();
    await expect(page.getByTestId('new-settings-voice-overlay-bottom-offset-row')).toBeVisible();
    await expect(page.getByTestId('new-settings-now-overlay-enabled-row')).toBeVisible();

    await setRangeValue(page, 'new-settings-voice-overlay-opacity-slider', 82);
    await page.getByTestId('new-settings-voice-overlay-diagnostics-switch').click();
    await page.getByTestId('new-settings-now-overlay-enabled-switch').click();

    await expect.poll(() => readLocalStorageValue(page, 'exomind:voiceOverlayOpacity')).toBe('82');
    await expect.poll(() => readLocalStorageValue(page, 'exomind:voiceOverlayShowDiagnostics')).toBe('true');
    await expect.poll(() => readLocalStorageValue(page, 'exomind:nowWorkbenchOverlayEnabled')).toBe('false');
  });

  test('mobile input section can update overlay preferences（移动端输入分组可修改悬浮窗偏好）', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/settings');

    const bottomOffsetRow = page.getByTestId('new-settings-voice-overlay-bottom-offset-row');
    await bottomOffsetRow.scrollIntoViewIfNeeded();
    await expect(page.getByTestId('new-settings-voice-overlay-opacity-row')).toBeVisible();
    await expect(page.getByTestId('new-settings-now-overlay-enabled-row')).toBeVisible();

    await setRangeValue(page, 'new-settings-voice-overlay-bottom-offset-slider', 96);
    await page.getByTestId('new-settings-now-overlay-enabled-switch').click();

    await expect.poll(() => readLocalStorageValue(page, 'exomind:voiceOverlayBottomOffset')).toBe('96');
    await expect.poll(() => readLocalStorageValue(page, 'exomind:nowWorkbenchOverlayEnabled')).toBe('false');
  });

  test('legal-support page contains only legal three items（法律与支持页仅法务三项）', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('button', { name: '关于', exact: true })).toBeVisible();

    const aboutTab = page.getByRole('button', { name: '关于', exact: true });
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

    await page.getByTestId('new-settings-desktop-adaptive-switch').click();

    await expect(page.getByTestId('desktop-sidebar')).toBeHidden();
    await expect(page.getByTestId('mobile-bottom-tab')).toBeVisible();
  });

  test('developer setting can expose the workbench test nav entry（开发者设置可直接暴露工作台测试入口）', async ({ page }) => {
    await page.goto('/settings');

    await expect(page.getByTestId('desktop-sidebar-item-workbench-test')).toHaveCount(0);

    await page.getByTestId('feature-toggle-workbench-test-switch').click();

    await expect(page.getByTestId('desktop-sidebar-item-workbench-test')).toBeVisible();
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

  test('desktop sidebar footer opens local profile sheet when logged out（未登录时桌面侧栏左下角打开本地档案）', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByTestId('desktop-sidebar')).toBeVisible();

    const footerEntry = page.getByTestId('desktop-sidebar-account-entry');
    await expect(footerEntry).toBeVisible();
    await footerEntry.click();

    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole('heading', { name: '打开本地档案' })).toBeVisible();
  });

  test('desktop sidebar footer opens switch sheet for active profile（已登录时桌面侧栏左下角打开切换档案）', async ({ page }) => {
    await seedLoggedInDesktopProfile(page);
    await page.goto('/settings');
    await expect(page.getByTestId('desktop-sidebar')).toBeVisible();

    const footerEntry = page.getByTestId('desktop-sidebar-account-entry');
    await expect(footerEntry).toBeVisible();
    await expect(footerEntry).toContainText('Hailay');
    await expect(footerEntry).toContainText('已连接远端同步身份');
    await expect(footerEntry).not.toContainText('user@example.com');

    await footerEntry.click();

    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole('heading', { name: '切换本地档案' })).toBeVisible();
    await expect(page.getByRole('button', { name: '退出当前档案' })).toBeVisible();
  });
});
