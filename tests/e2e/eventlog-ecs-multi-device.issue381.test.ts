import { expect, test, devices } from '@playwright/test';
import { startFakeMeshRuntimePair } from './helpers/issue381-fake-mesh-runtime';
import {
  attachLegacySyncRequestCollector,
  seedIssue381Page,
} from './helpers/issue381-frontend';

test.describe('Issue #381: EventLog over ECS multi-device acceptance', () => {
  test('desktop and mobile exchange EventLog without touching :6984', async ({ browser }) => {
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

    await expect.poll(
      () => desktopPage.evaluate(() => localStorage.getItem('exomind:runtimeTargetMode')),
      { timeout: 5000 },
    ).toBe('external');
    await expect.poll(
      () => mobilePage.evaluate(() => localStorage.getItem('exomind:runtimeTargetMode')),
      { timeout: 5000 },
    ).toBe('external');
    await expect.poll(
      () => desktopPage.evaluate(() => localStorage.getItem('exomind:runtimeExternalAddress')),
      { timeout: 5000 },
    ).toBe(runtimeA.address);
    await expect.poll(
      () => mobilePage.evaluate(() => localStorage.getItem('exomind:runtimeExternalAddress')),
      { timeout: 5000 },
    ).toBe(runtimeB.address);
    await expect.poll(
      () => desktopPage.evaluate(async (targetAddress) => {
        const response = await fetch(`http://${targetAddress}/health`);
        return response.ok;
      }, runtimeA.address),
      { timeout: 5000 },
    ).toBe(true);
    await expect.poll(
      () => mobilePage.evaluate(async (targetAddress) => {
        const response = await fetch(`http://${targetAddress}/health`);
        return response.ok;
      }, runtimeB.address),
      { timeout: 5000 },
    ).toBe(true);

    await expect(desktopPage.getByTestId('new-now-input-textarea')).toBeVisible();
    await expect(mobilePage.getByTestId('new-now-input-textarea')).toBeVisible();
    await expect.poll(() => runtimeA.subscriberCount, { timeout: 15000 }).toBeGreaterThan(0);
    await expect.poll(() => runtimeB.subscriberCount, { timeout: 15000 }).toBeGreaterThan(0);

    const desktopMessage = `issue381-desktop-${Date.now()}`;
    await desktopPage.getByTestId('new-now-input-textarea').fill(desktopMessage);
    await desktopPage.getByTestId('new-now-input-textarea').press('Control+Enter');

    await expect(desktopPage.getByText(desktopMessage)).toBeVisible();
    await expect
      .poll(async () => await mobilePage.getByText(desktopMessage).isVisible(), {
        timeout: 15000,
        intervals: [250, 500, 1000],
      })
      .toBe(true);

    const mobileMessage = `issue381-mobile-${Date.now()}`;
    await mobilePage.getByTestId('new-now-input-textarea').fill(mobileMessage);
    await mobilePage.getByTestId('new-now-input-textarea').press('Control+Enter');

    await expect(mobilePage.getByText(mobileMessage)).toBeVisible();
    await expect
      .poll(async () => await desktopPage.getByText(mobileMessage).isVisible(), {
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
