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

function parseAddress(address: string): { host: string; port: number } {
  const [host, rawPort] = address.split(':');
  return {
    host,
    port: Number.parseInt(rawPort, 10),
  };
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
}

test.describe('Issue #794: Task backfill over fake multi-device runtime', () => {
  test('mobile backfills tasks from confirmed peer after missing live creation signal', async ({ browser }) => {
    const { runtimeA, runtimeB } = await startFakeMeshRuntimePair();
    const legacySyncRequests: string[] = [];
    const profileId = 'profile-issue794-backfill-shared';
    const remoteIdentityKey = 'issue794-backfill-shared';
    const runtimeAAddress = parseAddress(runtimeA.address);

    const desktopContext = await browser.newContext();
    const mobileContext = await browser.newContext({ ...devices['Pixel 7'] });

    try {
      attachLegacySyncRequestCollector(desktopContext, legacySyncRequests);
      attachLegacySyncRequestCollector(mobileContext, legacySyncRequests);

      const desktopPage = await desktopContext.newPage();
      const mobilePage = await mobileContext.newPage();

      await seedIssue381Page(desktopPage, {
        runtimeAddress: runtimeA.address,
        profileId,
        displayName: 'Issue794 Backfill User',
        remoteIdentityKey,
      });

      await desktopPage.goto('/tasks', { waitUntil: 'domcontentloaded' });
      await expectRuntimeReady(desktopPage, runtimeA.address);

      const missingTaskTitle = `issue794-backfill-task-${Date.now()}`;
      await desktopPage.evaluate(async ({ runtimeAddress, title }) => {
        await fetch(`http://${runtimeAddress}/tasks?user_id=profile-issue794-backfill-shared`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ title }),
        });
      }, { runtimeAddress: runtimeA.address, title: missingTaskTitle });

      await seedIssue381Page(mobilePage, {
        runtimeAddress: runtimeB.address,
        profileId,
        displayName: 'Issue794 Backfill User',
        remoteIdentityKey,
        confirmedPeers: [
          {
            id: 'runtime-host-peer-a',
            name: 'Peer A',
            host: runtimeAAddress.host,
            port: runtimeAAddress.port,
            hostId: 'issue381-host-a',
            dialAddress: runtimeA.address,
          },
        ],
      });

      await mobilePage.goto('/tasks', { waitUntil: 'domcontentloaded' });
      await expectRuntimeReady(mobilePage, runtimeB.address);

      await expect
        .poll(async () => await mobilePage.locator('[data-testid^="tasks-page-task-link-"]').filter({ hasText: missingTaskTitle }).count(), {
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
});
