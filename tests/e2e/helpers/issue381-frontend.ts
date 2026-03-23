import type { BrowserContext, Page } from '@playwright/test';

export type Issue381SeedOptions = {
  runtimeAddress: string;
  profileId: string;
  displayName: string;
  remoteIdentityKey: string;
};

export function attachLegacySyncRequestCollector(context: BrowserContext, sink: string[]): void {
  context.on('request', (request) => {
    const url = request.url();
    if (/:6984(?:\/|$)/.test(url)) {
      sink.push(url);
    }
  });
}

export async function seedIssue381Page(page: Page, options: Issue381SeedOptions): Promise<void> {
  await page.addInitScript((seed: Issue381SeedOptions) => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('exomind:') || key.startsWith('exomind_')) {
        localStorage.removeItem(key);
      }
    }

    localStorage.setItem('exomind:runtimeTargetMode', 'external');
    localStorage.setItem('exomind:runtimeExternalAddress', seed.runtimeAddress);
    localStorage.setItem('exomind:profiles:index', JSON.stringify([seed.profileId]));
    localStorage.setItem(
      `exomind:profiles:${seed.profileId}:meta`,
      JSON.stringify({
        profileId: seed.profileId,
        slug: seed.displayName.toLowerCase(),
        displayName: seed.displayName,
        createdAt: '2026-03-07T00:00:00.000Z',
        updatedAt: '2026-03-07T00:00:00.000Z',
        authMode: 'none',
        state: 'active',
        defaultSyncPolicy: 'local-only',
      }),
    );
    localStorage.setItem(
      'exomind:profile-session',
      JSON.stringify({
        version: 1,
        activeProfileId: seed.profileId,
        unlockedProfileIds: [seed.profileId],
      }),
    );
    localStorage.setItem(
      'exomind:sync-store',
      JSON.stringify({
        state: {
          isLoggedIn: true,
          currentUser: seed.displayName,
          activeProfileId: seed.profileId,
          credentials: {
            username: seed.displayName.toLowerCase(),
            passwordHash: 'issue381-password-hash',
            remoteIdentityKey: seed.remoteIdentityKey,
            deviceName: 'Issue381 Device',
            deviceType: 'desktop',
            platform: 'Windows',
          },
          status: {
            state: 'disconnected',
            lastSync: null,
            pendingChanges: 0,
            conflictCount: 0,
            syncMode: 'realtime',
            pollInterval: 5,
          },
        },
        version: 0,
      }),
    );
  }, options);
}
