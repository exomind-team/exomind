import { expect, test, type Page } from '@playwright/test';

const enableIssue27 = process.env.EXOMIND_E2E_ISSUE27 === '1';

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
    const syncStoreState = {
      state: {
        isLoggedIn: true,
        currentUser: user,
        credentials: {
          username: user,
          passwordHash: 'e2e-password-hash',
          deviceName: 'E2E Device',
          deviceType: 'desktop',
          platform: 'Windows',
        },
      },
      version: 0,
    };
    localStorage.setItem('exomind:sync-store', JSON.stringify(syncStoreState));
  }, username);
}

test.describe('Issue #27: EventLog multi-device sync (MVP)', () => {
  test.skip(!enableIssue27, 'Run with EXOMIND_E2E_ISSUE27=1 and issue27 config.');

  test('same user on two devices: A sends event, B receives eventlog update', async ({ browser }) => {
    const username = `issue27-user-${Date.now()}`;
    const message = `issue27-event-${Date.now()}`;

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

    await pageA.goto('/eventlog');
    const inputA = pageA.getByPlaceholder(/记录当下的事实|输入内容记录事件/);
    await expect(inputA).toBeVisible();
    await pageB.goto('/eventlog');
    const inputB = pageB.getByPlaceholder(/记录当下的事实|输入内容记录事件/);
    await expect(inputB).toBeVisible();

    await inputA.fill(message);
    await inputA.press('Control+Enter');
    await expect(pageA.getByText(message)).toBeVisible();

    await expect.poll(
      async () => await pageB.getByText(message).isVisible(),
      {
        timeout: 20000,
        intervals: [500, 1000, 1500, 2000],
      }
    ).toBe(true);

    await contextA.close();
    await contextB.close();
  });
});
