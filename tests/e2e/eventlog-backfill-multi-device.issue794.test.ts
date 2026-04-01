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

test.describe('Issue #794: EventLog backfill over fake multi-device runtime', () => {
  test('mobile backfills eventlog from confirmed peer after missing live append signal', async ({ browser }) => {
    const { runtimeA, runtimeB } = await startFakeMeshRuntimePair();
    const legacySyncRequests: string[] = [];
    const profileId = 'profile-issue794-eventlog-backfill';
    const remoteIdentityKey = 'issue794-eventlog-backfill';
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
        displayName: 'Issue794 EventLog User',
        remoteIdentityKey,
      });

      await desktopPage.goto('/eventlog', { waitUntil: 'domcontentloaded' });
      await expectRuntimeReady(desktopPage, runtimeA.address);

      const eventText = `issue794-eventlog-backfill-${Date.now()}`;
      await desktopPage.evaluate(async ({ runtimeAddress, eventText }) => {
        await fetch(`http://${runtimeAddress}/eventlog?user_id=profile-issue794-eventlog-backfill`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            timestamp: Date.now(),
            content: eventText,
            tags: ['note'],
          }),
        });
      }, { runtimeAddress: runtimeA.address, eventText });

      await seedIssue381Page(mobilePage, {
        runtimeAddress: runtimeB.address,
        profileId,
        displayName: 'Issue794 EventLog User',
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

      await mobilePage.goto('/eventlog', { waitUntil: 'domcontentloaded' });
      await expectRuntimeReady(mobilePage, runtimeB.address);

      await expect
        .poll(async () => await mobilePage.evaluate(async ({ runtimeAddress, profileId, eventText }) => {
          const response = await fetch(`http://${runtimeAddress}/eventlog?user_id=${encodeURIComponent(profileId)}`);
          const payload = await response.json() as Array<{ content: string }>;
          return payload.some((item) => item.content === eventText);
        }, { runtimeAddress: runtimeB.address, profileId, eventText }), {
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
