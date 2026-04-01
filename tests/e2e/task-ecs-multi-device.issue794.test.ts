import { expect, test, devices } from '@playwright/test';
import {
  attachLegacySyncRequestCollector,
  seedIssue381Page,
} from './helpers/issue381-frontend';
import { startFakeMeshRuntimePair } from './helpers/issue381-fake-mesh-runtime';

async function safeClose(target: { close: () => Promise<void> | void }): Promise<void> {
  try {
    await target.close();
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('ENOENT')) {
      throw error;
    }
  }
}

async function expectRuntimeReady(page: import('@playwright/test').Page, runtimeAddress: string): Promise<void> {
  await expect.poll(
    () => page.evaluate(() => localStorage.getItem('exomind:runtimeTargetMode')),
    { timeout: 5000 },
  ).toBe('external');
  await expect.poll(
    () => page.evaluate(() => localStorage.getItem('exomind:runtimeExternalAddress')),
    { timeout: 5000 },
  ).toBe(runtimeAddress);
  await expect.poll(
    () => page.evaluate(async (targetAddress) => {
      const response = await fetch(`http://${targetAddress}/health`);
      return response.ok;
    }, runtimeAddress),
    { timeout: 5000 },
  ).toBe(true);
}

async function createTask(page: import('@playwright/test').Page, title: string): Promise<void> {
  await page.getByTestId('new-now-input-textarea').fill(title);
  await page.getByTestId('new-now-send-button').click();
  await expect(
    page.locator('[data-testid^="tasks-page-task-link-"]').filter({ hasText: title }).first(),
  ).toBeVisible();
}

test.describe('Issue #794: Task RT replication over fake multi-device runtime', () => {
  test('same profile scope syncs task between desktop and mobile without touching :6984', async ({ browser }) => {
    const { runtimeA, runtimeB } = await startFakeMeshRuntimePair();
    const legacySyncRequests: string[] = [];
    const profileId = 'profile-issue794-shared';
    const remoteIdentityKey = 'issue794-remote-shared';

    const desktopContext = await browser.newContext();
    const mobileContext = await browser.newContext({ ...devices['Pixel 7'] });

    try {
      attachLegacySyncRequestCollector(desktopContext, legacySyncRequests);
      attachLegacySyncRequestCollector(mobileContext, legacySyncRequests);

      const desktopPage = await desktopContext.newPage();
      const mobilePage = await mobileContext.newPage();

      await Promise.all([
        seedIssue381Page(desktopPage, {
          runtimeAddress: runtimeA.address,
          profileId,
          displayName: 'Issue794 Shared User',
          remoteIdentityKey,
        }),
        seedIssue381Page(mobilePage, {
          runtimeAddress: runtimeB.address,
          profileId,
          displayName: 'Issue794 Shared User',
          remoteIdentityKey,
        }),
      ]);

      await Promise.all([
        desktopPage.goto('/tasks', { waitUntil: 'domcontentloaded' }),
        mobilePage.goto('/tasks', { waitUntil: 'domcontentloaded' }),
      ]);

      await Promise.all([
        expectRuntimeReady(desktopPage, runtimeA.address),
        expectRuntimeReady(mobilePage, runtimeB.address),
      ]);
      await expect.poll(() => runtimeA.subscriberCount, { timeout: 15000 }).toBeGreaterThan(0);
      await expect.poll(() => runtimeB.subscriberCount, { timeout: 15000 }).toBeGreaterThan(0);
      await expect(desktopPage.getByTestId('new-now-input-textarea')).toBeVisible();
      await expect(mobilePage.getByTestId('new-now-input-textarea')).toBeVisible();

      const desktopTaskTitle = `issue794-desktop-task-${Date.now()}`;
      await createTask(desktopPage, desktopTaskTitle);

      await expect
        .poll(async () => await mobilePage.locator('[data-testid^="tasks-page-task-link-"]').filter({ hasText: desktopTaskTitle }).count(), {
          timeout: 15000,
          intervals: [250, 500, 1000],
        })
        .toBeGreaterThan(0);

      expect(legacySyncRequests).toEqual([]);
    } finally {
      await safeClose(desktopContext);
      await safeClose(mobileContext);
      await safeClose(runtimeA);
      await safeClose(runtimeB);
    }
  });

  test('different profile scopes stay isolated across paired devices', async ({ browser }) => {
    const { runtimeA, runtimeB } = await startFakeMeshRuntimePair();
    const desktopContext = await browser.newContext();
    const mobileContext = await browser.newContext({ ...devices['Pixel 7'] });

    try {
      const desktopPage = await desktopContext.newPage();
      const mobilePage = await mobileContext.newPage();

      await Promise.all([
        seedIssue381Page(desktopPage, {
          runtimeAddress: runtimeA.address,
          profileId: 'profile-issue794-a',
          displayName: 'Issue794 User A',
          remoteIdentityKey: 'issue794-remote-a',
        }),
        seedIssue381Page(mobilePage, {
          runtimeAddress: runtimeB.address,
          profileId: 'profile-issue794-b',
          displayName: 'Issue794 User B',
          remoteIdentityKey: 'issue794-remote-b',
        }),
      ]);

      await Promise.all([
        desktopPage.goto('/tasks', { waitUntil: 'domcontentloaded' }),
        mobilePage.goto('/tasks', { waitUntil: 'domcontentloaded' }),
      ]);

      await Promise.all([
        expectRuntimeReady(desktopPage, runtimeA.address),
        expectRuntimeReady(mobilePage, runtimeB.address),
      ]);

      const desktopTaskTitle = `issue794-isolated-task-${Date.now()}`;
      await createTask(desktopPage, desktopTaskTitle);

      await expect
        .poll(async () => await mobilePage.locator('[data-testid^="tasks-page-task-link-"]').filter({ hasText: desktopTaskTitle }).count(), {
          timeout: 5000,
          intervals: [250, 500, 1000],
        })
        .toBe(0);
    } finally {
      await safeClose(desktopContext);
      await safeClose(mobileContext);
      await safeClose(runtimeA);
      await safeClose(runtimeB);
    }
  });
});
