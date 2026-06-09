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

async function publishCompletedTimeblock(
  page: import('@playwright/test').Page,
  runtimeAddress: string,
  scopeKey: string,
  blockName: string,
) {
  await page.evaluate(async ({ runtimeAddress, scopeKey, blockName }) => {
    await fetch(`http://${runtimeAddress}/signals/publish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        topic: 'timeblock.replication.completed',
        source: 'e2e:desktop',
        payload: {
          schemaVersion: 1,
          scopeKey,
          cursor: {
            kind: 'timeblock_completed',
            blockId: `${blockName}-id`,
            completedAt: 1_700_000_060_000,
            originHostId: 'desktop-host',
          },
          block: {
            id: `${blockName}-id`,
            name: blockName,
            startId: `${blockName}-id`,
            endId: `${blockName}-end`,
            note: 'done',
            tags: ['block_feedback'],
            startTime: 1_700_000_000_000,
            endTime: 1_700_000_060_000,
            blockType: 'active',
            taskIds: [],
            taskAssociationLog: [],
            transitions: [],
          },
        },
      }),
    });
  }, { runtimeAddress, scopeKey, blockName });
}

test.describe('Issue #794: completed TimeBlock replication over fake multi-device runtime', () => {
  test('same profile scope projects completed timeblock into peer runtime without touching :6984', async ({ browser }) => {
    const { runtimeA, runtimeB } = await startFakeMeshRuntimePair();
    const legacySyncRequests: string[] = [];
    const profileId = 'profile-issue794-timeblock-shared';
    const remoteIdentityKey = 'issue794-timeblock-remote-shared';

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
          displayName: 'Issue794 TimeBlock Shared User',
          remoteIdentityKey,
        }),
        seedIssue381Page(mobilePage, {
          runtimeAddress: runtimeB.address,
          profileId,
          displayName: 'Issue794 TimeBlock Shared User',
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

      const blockName = `issue794-completed-block-${Date.now()}`;
      await publishCompletedTimeblock(desktopPage, runtimeA.address, profileId, blockName);

      await expect
        .poll(async () => await mobilePage.evaluate(async ({ runtimeAddress, profileId, blockName }) => {
          const response = await fetch(`http://${runtimeAddress}/timeblocks?user_id=${encodeURIComponent(profileId)}`);
          const payload = await response.json() as Array<{ name: string }>;
          return payload.some((item) => item.name === blockName);
        }, { runtimeAddress: runtimeB.address, profileId, blockName }), {
          timeout: 15000,
          intervals: [250, 500, 1000],
        })
        .toBe(true);

      expect(legacySyncRequests).toEqual([]);
    } finally {
      await safeClose(desktopContext);
      await safeClose(mobileContext);
      await safeClose(runtimeA);
      await safeClose(runtimeB);
    }
  });
});
