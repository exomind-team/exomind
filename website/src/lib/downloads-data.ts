import { parseReleaseHighlights, type ReleaseHighlight } from './release-highlights';

export interface StaticReleaseAsset {
  name: string;
  url: string;
  size: number;
  sha256: string;
}

export interface StaticReleaseMetadata {
  version: string;
  tag: string;
  published_at: string;
  release_url: string;
  assets: Record<string, StaticReleaseAsset>;
  highlights: ReleaseHighlight[];
}

export interface StaticVersionsIndex {
  channel: 'preview' | 'release';
  generated_at: string;
  latest: StaticReleaseMetadata | null;
  versions: StaticReleaseMetadata[];
}

export interface StaticTimelineRelease {
  channel: 'preview' | 'release';
  tag: string;
  display_tag: string;
  published_at: string;
  release_url: string;
  highlights: ReleaseHighlight[];
}

export interface StaticReleaseTimeline {
  generated_at: string;
  latest: Record<'preview' | 'release', StaticTimelineRelease | null>;
  preview: StaticTimelineRelease[];
  release: StaticTimelineRelease[];
}

interface GithubApiReleaseAsset {
  name: string;
  size: number;
  browser_download_url: string;
}

interface GithubApiRelease {
  tag_name: string;
  prerelease: boolean;
  draft: boolean;
  published_at: string | null;
  html_url: string;
  body: string | null;
  assets: GithubApiReleaseAsset[];
}

type ExtraDownloadLink = {
  key: string;
  label: string;
  url: string;
  size: number;
};

type PlatformDownload = {
  version: string;
  publishedAt: string;
  primary: {
    url: string;
    size: number;
    name: string;
  };
  extras: ExtraDownloadLink[];
};

const EXTRA_DOWNLOADS: Record<string, Array<{ key: string; label: string }>> = {
  'windows-x64-setup': [{ key: 'windows-x64-installer', label: 'MSI 安装包' }],
  'android-arm64': [{ key: 'android-x86', label: 'x86 版本' }],
  'linux-x64-appimage': [{ key: 'linux-x64-deb', label: 'DEB 包' }],
};

const GITHUB_RELEASES_REPO = 'exomind-team/exomind';
const GITHUB_RELEASES_API = 'https://api.github.com/repos';
const CANONICAL_RELEASE_TAG_RE = /^v\d+\.\d+\.\d+$/;
const REMOTE_INDEX_CACHE = new Map<string, Promise<StaticVersionsIndex>>();
const REMOTE_TIMELINE_CACHE = new Map<string, Promise<StaticReleaseTimeline>>();

const ASSET_RESOLVERS: Record<string, (version: string) => string> = {
  'windows-x64-setup': (version) => `ExoMind-${version}-windows-x64-setup.exe`,
  'windows-x64-installer': (version) => `ExoMind-${version}-windows-x64-installer.msi`,
  'android-arm64': (version) => `ExoMind-${version}-android-arm64.apk`,
  'android-x86': (version) => `ExoMind-${version}-android-x86.apk`,
  'macos-aarch64': (version) => `ExoMind-${version}-macos-aarch64.dmg`,
  'macos-x64': (version) => `ExoMind-${version}-macos-x64.dmg`,
  'linux-x64-appimage': (version) => `ExoMind-${version}-linux-x64.AppImage`,
  'linux-x64-deb': (version) => `ExoMind-${version}-linux-x64.deb`,
  'runtime-windows-x64': (version) => `ExoMind-RT-${version}-windows-x64.exe`,
  'runtime-macos-aarch64': (version) => `ExoMind-RT-${version}-macos-aarch64.tar.gz`,
  'runtime-linux-x64': (version) => `ExoMind-RT-${version}-linux-x64.tar.gz`,
};

function stripVersionPrefix(version: string): string {
  return version.trim().replace(/^v/, '');
}

function compareReleaseVersions(a: string, b: string): number {
  const aParts = stripVersionPrefix(a).split('.').map((value) => Number.parseInt(value, 10) || 0);
  const bParts = stripVersionPrefix(b).split('.').map((value) => Number.parseInt(value, 10) || 0);

  for (let index = 0; index < Math.max(aParts.length, bParts.length); index += 1) {
    const left = aParts[index] ?? 0;
    const right = bParts[index] ?? 0;
    if (left > right) return 1;
    if (left < right) return -1;
  }

  return 0;
}

function isCanonicalReleaseTag(tagName: string): boolean {
  return CANONICAL_RELEASE_TAG_RE.test(tagName.trim());
}

function createEmptyIndex(channel: StaticVersionsIndex['channel']): StaticVersionsIndex {
  return {
    channel,
    generated_at: new Date().toISOString(),
    latest: null,
    versions: [],
  };
}

function createEmptyTimeline(): StaticReleaseTimeline {
  return {
    generated_at: new Date().toISOString(),
    latest: {
      preview: null,
      release: null,
    },
    preview: [],
    release: [],
  };
}

function hasIndexContent(index: StaticVersionsIndex | null | undefined): boolean {
  return Boolean(index?.latest || (index?.versions?.length ?? 0) > 0);
}

function hasTimelineContent(timeline: StaticReleaseTimeline | null | undefined): boolean {
  return Boolean(
    timeline?.latest?.preview ||
      timeline?.latest?.release ||
      (timeline?.preview?.length ?? 0) > 0 ||
      (timeline?.release?.length ?? 0) > 0,
  );
}

function mapReleaseAssets(version: string, assets: GithubApiReleaseAsset[]): Record<string, StaticReleaseAsset> {
  const assetsByName = new Map(assets.map((asset) => [asset.name, asset]));
  const mapped: Record<string, StaticReleaseAsset> = {};

  for (const [assetKey, resolveName] of Object.entries(ASSET_RESOLVERS)) {
    const assetName = resolveName(version);
    const asset = assetsByName.get(assetName);
    if (!asset) {
      continue;
    }

    mapped[assetKey] = {
      name: asset.name,
      url: asset.browser_download_url,
      size: asset.size,
      sha256: '',
    };
  }

  return mapped;
}

function buildStaticReleaseMetadata(release: GithubApiRelease): StaticReleaseMetadata | null {
  if (release.draft || !isCanonicalReleaseTag(release.tag_name)) {
    return null;
  }

  const version = stripVersionPrefix(release.tag_name);
  return {
    version,
    tag: release.tag_name,
    published_at: release.published_at ?? new Date().toISOString(),
    release_url: release.html_url,
    assets: mapReleaseAssets(version, release.assets),
    highlights: parseReleaseHighlights(release.body),
  };
}

function isTimelineReleaseTag(tagName: string): boolean {
  const normalized = tagName.trim();
  return isCanonicalReleaseTag(normalized) || normalized.startsWith('release/');
}

function toTimelineDisplayTag(tagName: string): string {
  const normalized = tagName.trim();
  const segments = normalized.split('/');
  return segments[segments.length - 1] ?? normalized;
}

function buildStaticTimelineRelease(release: GithubApiRelease): StaticTimelineRelease | null {
  if (release.draft || !isTimelineReleaseTag(release.tag_name)) {
    return null;
  }

  const channel: StaticVersionsIndex['channel'] = release.prerelease ? 'preview' : 'release';

  return {
    channel,
    tag: release.tag_name.trim(),
    display_tag: toTimelineDisplayTag(release.tag_name),
    published_at: release.published_at ?? new Date().toISOString(),
    release_url: release.html_url,
    highlights: parseReleaseHighlights(release.body).slice(0, 5),
  };
}

function buildStaticVersionsIndexFromGithubReleases(
  channel: StaticVersionsIndex['channel'],
  releases: GithubApiRelease[],
): StaticVersionsIndex {
  const versions = releases
    .filter((release) => release.prerelease === (channel === 'preview'))
    .map((release) => buildStaticReleaseMetadata(release))
    .filter((release): release is StaticReleaseMetadata => release !== null)
    .sort((left, right) => compareReleaseVersions(right.version, left.version));

  return {
    channel,
    generated_at: new Date().toISOString(),
    latest: versions[0] ?? null,
    versions,
  };
}

function buildStaticReleaseTimelineFromGithubReleases(
  releases: GithubApiRelease[],
): StaticReleaseTimeline {
  const preview = releases
    .filter((release) => release.prerelease)
    .map((release) => buildStaticTimelineRelease(release))
    .filter((release): release is StaticTimelineRelease => release !== null)
    .sort((left, right) => new Date(right.published_at).getTime() - new Date(left.published_at).getTime());

  const release = releases
    .filter((currentRelease) => !currentRelease.prerelease)
    .map((currentRelease) => buildStaticTimelineRelease(currentRelease))
    .filter((currentRelease): currentRelease is StaticTimelineRelease => currentRelease !== null)
    .sort(
      (left, right) => new Date(right.published_at).getTime() - new Date(left.published_at).getTime(),
    );

  return {
    generated_at: new Date().toISOString(),
    latest: {
      preview: preview[0] ?? null,
      release: release[0] ?? null,
    },
    preview,
    release,
  };
}

async function fetchGithubReleases(repo = GITHUB_RELEASES_REPO): Promise<GithubApiRelease[]> {
  const releases: GithubApiRelease[] = [];

  for (let page = 1; page <= 5; page += 1) {
    const response = await fetch(`${GITHUB_RELEASES_API}/${repo}/releases?per_page=100&page=${page}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub API request failed: ${response.status}`);
    }

    const batch = (await response.json()) as GithubApiRelease[];
    releases.push(...batch);

    if (batch.length < 100) {
      break;
    }
  }

  return releases;
}

async function loadRemoteReleaseIndex(
  channel: StaticVersionsIndex['channel'],
  repo = GITHUB_RELEASES_REPO,
): Promise<StaticVersionsIndex> {
  const cacheKey = `${repo}:${channel}`;
  const existing = REMOTE_INDEX_CACHE.get(cacheKey);
  if (existing) {
    return existing;
  }

  const promise = fetchGithubReleases(repo)
    .then((releases) => buildStaticVersionsIndexFromGithubReleases(channel, releases))
    .catch((error) => {
      console.error(`Failed to load ${channel} release metadata from GitHub:`, error);
      return createEmptyIndex(channel);
    });

  REMOTE_INDEX_CACHE.set(cacheKey, promise);
  return promise;
}

async function loadRemoteReleaseTimeline(repo = GITHUB_RELEASES_REPO): Promise<StaticReleaseTimeline> {
  const existing = REMOTE_TIMELINE_CACHE.get(repo);
  if (existing) {
    return existing;
  }

  const promise = fetchGithubReleases(repo)
    .then((releases) => buildStaticReleaseTimelineFromGithubReleases(releases))
    .catch((error) => {
      console.error('Failed to load release timeline metadata from GitHub:', error);
      return createEmptyTimeline();
    });

  REMOTE_TIMELINE_CACHE.set(repo, promise);
  return promise;
}

export async function loadReleaseIndexWithFallback({
  channel,
  localUrl,
  repo = GITHUB_RELEASES_REPO,
}: {
  channel: StaticVersionsIndex['channel'];
  localUrl: string;
  repo?: string;
}): Promise<StaticVersionsIndex> {
  try {
    const response = await fetch(localUrl);
    if (response.ok) {
      const localIndex = (await response.json()) as StaticVersionsIndex;
      if (hasIndexContent(localIndex)) {
        return localIndex;
      }
    }
  } catch (error) {
    console.warn(`Failed to load local ${channel} release metadata:`, error);
  }

  return loadRemoteReleaseIndex(channel, repo);
}

export async function loadReleaseTimelineWithFallback({
  localUrl,
  repo = GITHUB_RELEASES_REPO,
}: {
  localUrl: string;
  repo?: string;
}): Promise<StaticReleaseTimeline> {
  try {
    const response = await fetch(localUrl);
    if (response.ok) {
      const localTimeline = (await response.json()) as StaticReleaseTimeline;
      if (hasTimelineContent(localTimeline)) {
        return localTimeline;
      }
    }
  } catch (error) {
    console.warn('Failed to load local release timeline metadata:', error);
  }

  return loadRemoteReleaseTimeline(repo);
}

export function detectPlatformDownloadKey({
  userAgent,
  platform,
}: {
  userAgent?: string;
  platform?: string;
} = {}): string | null {
  const runtimeUserAgent = userAgent ?? '';
  const runtimePlatform = platform ?? '';

  if (/Android/i.test(runtimeUserAgent)) return 'android-arm64';
  if (/Win/i.test(runtimePlatform) || /Windows/i.test(runtimeUserAgent)) return 'windows-x64-setup';
  if (/Mac/i.test(runtimePlatform) || /Mac OS X/i.test(runtimeUserAgent)) return 'macos-aarch64';
  if (/Linux/i.test(runtimePlatform) || /Linux/i.test(runtimeUserAgent)) return 'linux-x64-appimage';

  return null;
}

export function fallbackReleaseUrl(tag: string): string {
  const normalizedTag = tag.trim() || 'latest';
  return `https://github.com/exomind-team/exomind/releases/tag/${encodeURIComponent(normalizedTag)}`;
}

export function resolvePlatformDownload(
  latest: StaticReleaseMetadata | null,
  platformKey: string,
): PlatformDownload | null {
  const primary = latest?.assets?.[platformKey];
  if (!latest || !primary) {
    return null;
  }

  const extras = (EXTRA_DOWNLOADS[platformKey] ?? [])
    .map((definition) => {
      const asset = latest.assets[definition.key];
      if (!asset) {
        return null;
      }

      return {
        key: definition.key,
        label: definition.label,
        url: asset.url,
        size: asset.size,
      };
    })
    .filter((item): item is ExtraDownloadLink => item !== null);

  return {
    version: latest.version,
    publishedAt: latest.published_at,
    primary: {
      url: primary.url,
      size: primary.size,
      name: primary.name,
    },
    extras,
  };
}

export function resolvePreferredPlatformDownload({
  release,
  preview,
  platformKey,
}: {
  release?: StaticReleaseMetadata | null;
  preview?: StaticReleaseMetadata | null;
  platformKey: string;
}): PlatformDownload | null {
  return (
    resolvePlatformDownload(release ?? null, platformKey) ??
    resolvePlatformDownload(preview ?? null, platformKey)
  );
}

export function buildHistoryEntries(
  index: StaticVersionsIndex,
  platformKey?: string | null,
): Array<{
  version: string;
  publishedAt: string;
  releaseUrl: string;
  downloadUrl: string | null;
}> {
  return index.versions.map((version) => ({
    version: version.version,
    publishedAt: version.published_at,
    releaseUrl: version.release_url?.trim() || fallbackReleaseUrl(version.tag),
    downloadUrl: platformKey ? (resolvePlatformDownload(version, platformKey)?.primary.url ?? null) : null,
  }));
}
