import { expect, test, devices } from '@playwright/test';
import {
  attachLegacySyncRequestCollector,
  seedIssue381Page,
} from './helpers/issue381-frontend';
import { startFakeMeshRuntimePair } from './helpers/issue381-fake-mesh-runtime';

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

async function expandFocusConfig(page: import('@playwright/test').Page): Promise<void> {
  const idleCard = page.getByTestId('new-focus-idle-card');
  if (await idleCard.isVisible()) {
    await idleCard.click();
  }
  await expect(page.getByTestId('new-focus-task-input')).toBeVisible();
}

async function startFocusBlock(page: import('@playwright/test').Page, taskName: string): Promise<void> {
  await expandFocusConfig(page);
  await page.getByTestId('new-focus-task-input').fill(taskName);
  await page.getByTestId('new-focus-start-button').click();
  await expect(page.getByTestId('new-focus-state-running')).toBeVisible();
  await expect(page.getByTestId('new-focus-running-task-card')).toContainText(taskName);
}

async function endFocusBlock(page: import('@playwright/test').Page, feedback: string): Promise<void> {
  await page.getByTestId('new-focus-end-button').click();
  await expect(page.getByTestId('new-focus-feedback-textarea')).toBeVisible();
  await page.getByTestId('new-focus-feedback-textarea').fill(feedback);
  await page.getByTestId('new-focus-feedback-confirm').click();
  await expect(page.getByTestId('new-focus-state-idle')).toBeVisible();
}

test.describe('Issue #381: ActiveBlock over ECS multi-device acceptance', () => {
  test('desktop and mobile exchange current ActiveBlock without touching :6984', async ({ browser }) => {
    const { runtimeA, runtimeB } = await startFakeMeshRuntimePair();
    const legacySyncRequests: string[] = [];
    const profileId = 'profile-issue381-shared';
    const remoteIdentityKey = 'issue381-remote-shared';

    const desktopContext = await browser.newContext();
    const mobileContext = await browser.newContext({
      ...devices['Pixel 7'],
    });

    attachLegacySyncRequestCollector(desktopContext, legacySyncRequests);
    attachLegacySyncRequestCollector(mobileContext, legacySyncRequests);

    const desktopPage = await desktopContext.newPage();
    const mobilePage = await mobileContext.newPage();

    await Promise.all([
      seedIssue381Page(desktopPage, {
        runtimeAddress: runtimeA.address,
        profileId,
        displayName: 'Issue381 Shared User',
        remoteIdentityKey,
      }),
      seedIssue381Page(mobilePage, {
        runtimeAddress: runtimeB.address,
        profileId,
        displayName: 'Issue381 Shared User',
        remoteIdentityKey,
      }),
    ]);

    await Promise.all([
      desktopPage.goto('/eventlog', { waitUntil: 'domcontentloaded' }),
      mobilePage.goto('/eventlog', { waitUntil: 'domcontentloaded' }),
    ]);

    await Promise.all([
      expectRuntimeReady(desktopPage, runtimeA.address),
      expectRuntimeReady(mobilePage, runtimeB.address),
    ]);
    await expect.poll(() => runtimeA.subscriberCount, { timeout: 15000 }).toBeGreaterThan(0);
    await expect.poll(() => runtimeB.subscriberCount, { timeout: 15000 }).toBeGreaterThan(0);
    await expect(desktopPage.getByTestId('new-focus-state-idle')).toBeVisible();
    await expect(mobilePage.getByTestId('new-focus-state-idle')).toBeVisible();

    const desktopTaskName = `issue381-desktop-block-${Date.now()}`;
    await startFocusBlock(desktopPage, desktopTaskName);

    await expect
      .poll(async () => await mobilePage.getByTestId('new-focus-running-task-card').textContent(), {
        timeout: 15000,
        intervals: [250, 500, 1000],
      })
      .toContain(desktopTaskName);

    await endFocusBlock(desktopPage, 'desktop feedback');

    await expect
      .poll(async () => await mobilePage.getByTestId('new-focus-state-idle').isVisible(), {
        timeout: 15000,
        intervals: [250, 500, 1000],
      })
      .toBe(true);

    const mobileTaskName = `issue381-mobile-block-${Date.now()}`;
    await startFocusBlock(mobilePage, mobileTaskName);

    await expect
      .poll(async () => await desktopPage.getByTestId('new-focus-running-task-card').textContent(), {
        timeout: 15000,
        intervals: [250, 500, 1000],
      })
      .toContain(mobileTaskName);

    await endFocusBlock(mobilePage, 'mobile feedback');

    await expect
      .poll(async () => await desktopPage.getByTestId('new-focus-state-idle').isVisible(), {
        timeout: 15000,
        intervals: [250, 500, 1000],
      })
      .toBe(true);

    expect(legacySyncRequests).toEqual([]);

    await Promise.all([
      desktopContext.close(),
      mobileContext.close(),
      runtimeA.close(),
      runtimeB.close(),
    ]);
  });
});
