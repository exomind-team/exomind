import { expect, test } from '@playwright/test';

const releaseVersions = {
  channel: 'release',
  generated_at: '2026-04-08T09:00:00Z',
  latest: {
    version: '0.4.0',
    tag: 'v0.4.0',
    published_at: '2026-04-07T08:00:00Z',
    release_url: 'https://github.com/exomind-team/exomind/releases/tag/v0.4.0',
    assets: {
      'windows-x64-setup': {
        name: 'ExoMind-0.4.0-windows-x64-setup.exe',
        url: 'https://github.com/exomind-team/exomind/releases/download/v0.4.0/ExoMind-0.4.0-windows-x64-setup.exe',
        size: 50_000_000,
        sha256: 'a'.repeat(64),
      },
      'android-arm64': {
        name: 'ExoMind-0.4.0-android-arm64.apk',
        url: 'https://github.com/exomind-team/exomind/releases/download/v0.4.0/ExoMind-0.4.0-android-arm64.apk',
        size: 30_000_000,
        sha256: 'b'.repeat(64),
      },
    },
  },
  versions: [
    {
      version: '0.4.0',
      tag: 'v0.4.0',
      published_at: '2026-04-07T08:00:00Z',
      release_url: 'https://github.com/exomind-team/exomind/releases/tag/v0.4.0',
      assets: {},
    },
    {
      version: '0.3.9',
      tag: 'v0.3.9',
      published_at: '2026-04-01T08:00:00Z',
      release_url: 'https://github.com/exomind-team/exomind/releases/tag/v0.3.9',
      assets: {},
    },
  ],
};

const previewVersions = {
  channel: 'preview',
  generated_at: '2026-04-08T09:00:00Z',
  latest: {
    version: '0.4.3',
    tag: 'v0.4.3',
    published_at: '2026-04-08T08:00:00Z',
    release_url: 'https://github.com/exomind-team/exomind/releases/tag/v0.4.3',
    assets: {
      'windows-x64-setup': {
        name: 'ExoMind-0.4.3-windows-x64-setup.exe',
        url: 'https://github.com/exomind-team/exomind/releases/download/v0.4.3/ExoMind-0.4.3-windows-x64-setup.exe',
        size: 52_000_000,
        sha256: 'c'.repeat(64),
      },
      'windows-x64-installer': {
        name: 'ExoMind-0.4.3-windows-x64-installer.msi',
        url: 'https://github.com/exomind-team/exomind/releases/download/v0.4.3/ExoMind-0.4.3-windows-x64-installer.msi',
        size: 53_000_000,
        sha256: 'd'.repeat(64),
      },
      'android-arm64': {
        name: 'ExoMind-0.4.3-android-arm64.apk',
        url: 'https://github.com/exomind-team/exomind/releases/download/v0.4.3/ExoMind-0.4.3-android-arm64.apk',
        size: 31_000_000,
        sha256: 'e'.repeat(64),
      },
    },
  },
  versions: [
    {
      version: '0.4.3',
      tag: 'v0.4.3',
      published_at: '2026-04-08T08:00:00Z',
      release_url: 'https://github.com/exomind-team/exomind/releases/tag/v0.4.3',
      assets: {},
    },
    {
      version: '0.4.1',
      tag: 'v0.4.1',
      published_at: '2026-04-07T08:00:00Z',
      release_url: 'https://github.com/exomind-team/exomind/releases/tag/v0.4.1',
      assets: {},
    },
  ],
};

test.describe('官网下载页版本通道 (Website download channels)', () => {
  test('同时展示稳定版与预览版最新版本，并带 Release 链接与平台下载 URL', async ({ page }) => {
    await page.route('**/releases/release/versions.json', async (route) => {
      await route.fulfill({ json: releaseVersions });
    });
    await page.route('**/releases/preview/versions.json', async (route) => {
      await route.fulfill({ json: previewVersions });
    });

    await page.goto('/download');

    const releaseChannel = page.getByTestId('download-channel-release');
    await expect(releaseChannel).toBeVisible();
    await expect(releaseChannel).toContainText('最新稳定版');
    await expect(releaseChannel).toContainText('v0.4.0');
    await expect(releaseChannel.getByTestId('download-channel-release-link')).toHaveAttribute(
      'href',
      'https://github.com/exomind-team/exomind/releases/tag/v0.4.0',
    );
    await expect(releaseChannel.getByTestId('download-release-windows-x64-setup')).toHaveAttribute(
      'href',
      'https://github.com/exomind-team/exomind/releases/download/v0.4.0/ExoMind-0.4.0-windows-x64-setup.exe',
    );

    const previewChannel = page.getByTestId('download-channel-preview');
    await expect(previewChannel).toBeVisible();
    await expect(previewChannel).toContainText('最新预览版');
    await expect(previewChannel).toContainText('v0.4.3');
    await expect(previewChannel.getByTestId('download-channel-preview-link')).toHaveAttribute(
      'href',
      'https://github.com/exomind-team/exomind/releases/tag/v0.4.3',
    );
    await expect(previewChannel.getByTestId('download-preview-windows-x64-setup')).toHaveAttribute(
      'href',
      'https://github.com/exomind-team/exomind/releases/download/v0.4.3/ExoMind-0.4.3-windows-x64-setup.exe',
    );
    await expect(previewChannel).toContainText('v0.4.1');
  });

  test('稳定版为空时明确提示暂无正式版，但预览版仍然展示', async ({ page }) => {
    await page.route('**/releases/release/versions.json', async (route) => {
      await route.fulfill({
        json: {
          channel: 'release',
          generated_at: '2026-04-08T09:00:00Z',
          latest: null,
          versions: [],
        },
      });
    });
    await page.route('**/releases/preview/versions.json', async (route) => {
      await route.fulfill({ json: previewVersions });
    });

    await page.goto('/download');

    const releaseChannel = page.getByTestId('download-channel-release');
    await expect(releaseChannel).toBeVisible();
    await expect(releaseChannel).toContainText('暂无正式版');
    await expect(releaseChannel.getByTestId('download-channel-release-fallback')).toHaveAttribute(
      'href',
      'https://github.com/exomind-team/exomind/releases',
    );

    const previewChannel = page.getByTestId('download-channel-preview');
    await expect(previewChannel).toContainText('v0.4.3');
  });
});
