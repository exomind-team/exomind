import { expect, test, type Page } from '@playwright/test';

const SERVER_URL = process.env.SYNC_SERVER_URL || 'http://localhost:6984';
const APP_URL = process.env.APP_URL || 'http://localhost:1420';
const enableSyncE2E = process.env.EXOMIND_ENABLE_SYNC_E2E === '1';

async function resetClientStorage(page: Page) {
  await page.addInitScript(() => {
    const localKeys = Object.keys(localStorage);
    for (const key of localKeys) {
      if (key.startsWith('exomind:') || key.startsWith('exomind_')) {
        localStorage.removeItem(key);
      }
    }
  });
}

async function seedLoggedInUser(page: Page, username: string) {
  await page.addInitScript((user) => {
    const normalized = user.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
    const profileId = `profile-${normalized || 'e2e'}`;
    const linkId = `link-${normalized || 'e2e'}`;
    const now = new Date().toISOString();

    localStorage.setItem('exomind:profiles:index', JSON.stringify([profileId]));
    localStorage.setItem(`exomind:profiles:${profileId}:meta`, JSON.stringify({
      profileId,
      slug: user,
      displayName: user,
      createdAt: now,
      updatedAt: now,
      authMode: 'password',
      state: 'active',
      defaultSyncPolicy: 'auto-sync-when-linked',
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
      providerId: 'e2e',
      remoteIdentityId: user,
      remoteIdentityKey: user,
      authMode: 'basic',
      status: 'linked',
      syncMode: 'realtime',
      linkedAt: now,
    }));
    localStorage.setItem(`exomind:identity-links:secret:${linkId}`, JSON.stringify({
      linkId,
      authType: 'basic',
      authUsername: user,
      authSecret: 'e2e-password-hash',
      updatedAt: now,
    }));

  }, username);
}

async function openSyncPage(page: Page, username: string) {
  await Promise.all([resetClientStorage(page), seedLoggedInUser(page, username)]);
  await page.goto(`${APP_URL}/sync-test`);
  await page.waitForLoadState('networkidle');
}

async function connectToServer(page: Page) {
  await page.fill('#serverUrl', SERVER_URL);
  await page.getByRole('button', { name: '连接服务器' }).click();
  await expect(page.getByText('连接成功')).toBeVisible({ timeout: 15000 });
}

test.describe('多设备同步 E2E', () => {
  test.skip(
    !enableSyncE2E,
    'Run with EXOMIND_ENABLE_SYNC_E2E=1 after preparing dedicated sync stack.'
  );

  test('sync page renders login seed state and connect entry', async ({ page }) => {
    await openSyncPage(page, `sync-page-user-${Date.now()}`);
    await expect(page.getByText('同步测试')).toBeVisible();
    await expect(page.getByText(/^已登录:/)).toBeVisible();
    await expect(page.getByRole('button', { name: '连接服务器' })).toBeVisible();
  });

  test('same user on two devices: A sends event, B receives update', async ({ browser }) => {
    const username = `sync-user-${Date.now()}`;
    const message = `sync-event-${Date.now()}`;
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await Promise.all([
      resetClientStorage(pageA),
      resetClientStorage(pageB),
      seedLoggedInUser(pageA, username),
      seedLoggedInUser(pageB, username),
    ]);

    await pageA.goto(`${APP_URL}/eventlog`);
    const inputA = pageA.getByPlaceholder(/记录当下的事实|输入内容记录事件/);
    await expect(inputA).toBeVisible();
    await pageB.goto(`${APP_URL}/eventlog`);
    const inputB = pageB.getByPlaceholder(/记录当下的事实|输入内容记录事件/);
    await expect(inputB).toBeVisible();

    await inputA.fill(message);
    await inputA.press('Control+Enter');
    await expect(pageA.getByText(message)).toBeVisible();

    await expect
      .poll(async () => await pageB.getByText(message).isVisible(), {
        timeout: 20000,
        intervals: [500, 1000, 1500, 2000],
      })
      .toBe(true);

    await contextA.close();
    await contextB.close();
  });

  test('two devices can connect and run manual sync actions', async ({ browser }) => {
    const username = `sync-actions-user-${Date.now()}`;
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await Promise.all([openSyncPage(pageA, username), openSyncPage(pageB, username)]);
    await Promise.all([connectToServer(pageA), connectToServer(pageB)]);

    await pageA.getByRole('button', { name: '同步事件' }).click();
    await expect(pageA.getByText(/事件同步(完成|失败)/)).toBeVisible({
      timeout: 15000,
    });

    await pageB.getByRole('button', { name: '同步配置' }).click();
    await expect(pageB.getByText(/配置同步(完成|失败)/)).toBeVisible({
      timeout: 15000,
    });

    await contextA.close();
    await contextB.close();
  });
});
