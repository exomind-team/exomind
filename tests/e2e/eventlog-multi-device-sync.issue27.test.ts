import { expect, test, type Page } from '@playwright/test';

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
    await expect(pageA.locator('[data-testid="event-input-textarea"]')).toBeVisible();
    await pageB.goto('/eventlog');
    await expect(pageB.locator('[data-testid="event-input-textarea"]')).toBeVisible();

    await pageA.locator('[data-testid="event-input-textarea"]').fill(message);
    await pageA.locator('[data-testid="event-send-button"]').click();
    await expect(pageA.locator('[data-testid="event-list"]')).toContainText(message);

    await expect.poll(
      async () => (await pageB.locator('[data-testid="event-list"]').textContent()) ?? '',
      {
        timeout: 20000,
        intervals: [500, 1000, 1500, 2000],
      }
    ).toContain(message);

    await contextA.close();
    await contextB.close();
  });
});
