export type ReleaseChannel = 'preview' | 'release';

export interface ReleaseManifestAsset {
  name: string;
  size: number;
  sha256: string;
}

export interface ReleaseManifest {
  version: string;
  tag: string;
  commit: string;
  generated_at: string;
  assets: Record<string, ReleaseManifestAsset>;
}

export interface GithubReleaseAssetSummary {
  name: string;
  size: number;
  browserDownloadUrl: string;
}

export interface GithubReleaseSummary {
  tagName: string;
  prerelease: boolean;
  draft: boolean;
  publishedAt: string | null;
  htmlUrl: string;
  assets: GithubReleaseAssetSummary[];
  manifest?: ReleaseManifest | null;
}

export interface PagesReleaseAsset {
  name: string;
  url: string;
  size: number;
  sha256: string;
}

export interface PagesReleaseMetadata {
  version: string;
  tag: string;
  published_at: string;
  release_url: string;
  assets: Record<string, PagesReleaseAsset>;
}

export interface PagesReleaseVersionsIndex {
  channel: ReleaseChannel;
  generated_at: string;
  latest: PagesReleaseMetadata | null;
  versions: PagesReleaseMetadata[];
}

const CANONICAL_TAG_RE = /^v\d+\.\d+\.\d+$/;

function stripVersionPrefix(version: string): string {
  return version.trim().replace(/^v/, '');
}

export function compareReleaseVersions(a: string, b: string): number {
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

export function isCanonicalReleaseTag(tagName: string): boolean {
  return CANONICAL_TAG_RE.test(tagName.trim());
}

function buildReleaseMetadata(release: GithubReleaseSummary): PagesReleaseMetadata | null {
  if (release.draft || !isCanonicalReleaseTag(release.tagName) || !release.manifest) {
    return null;
  }

  const version = stripVersionPrefix(release.tagName);
  const manifestVersion = stripVersionPrefix(release.manifest.version);
  const manifestTag = release.manifest.tag.trim();
  if (manifestVersion !== version || manifestTag !== release.tagName) {
    return null;
  }

  const assetByName = new Map(release.assets.map((asset) => [asset.name, asset]));
  const assets: Record<string, PagesReleaseAsset> = {};

  for (const [assetKey, manifestAsset] of Object.entries(release.manifest.assets)) {
    const matchedAsset = assetByName.get(manifestAsset.name);
    if (!matchedAsset) {
      continue;
    }

    assets[assetKey] = {
      name: manifestAsset.name,
      url: matchedAsset.browserDownloadUrl,
      size: matchedAsset.size || manifestAsset.size,
      sha256: manifestAsset.sha256,
    };
  }

  return {
    version,
    tag: release.tagName,
    published_at: release.publishedAt ?? release.manifest.generated_at,
    release_url: release.htmlUrl,
    assets,
  };
}

function createVersionsIndex(
  channel: ReleaseChannel,
  versions: PagesReleaseMetadata[],
  generatedAt: string,
): PagesReleaseVersionsIndex {
  return {
    channel,
    generated_at: generatedAt,
    latest: versions[0] ?? null,
    versions,
  };
}

export function buildPagesReleaseMetadata(
  releases: GithubReleaseSummary[],
  generatedAt = new Date().toISOString(),
): {
  preview: PagesReleaseVersionsIndex;
  release: PagesReleaseVersionsIndex;
} {
  const previewVersions: PagesReleaseMetadata[] = [];
  const releaseVersions: PagesReleaseMetadata[] = [];

  for (const release of releases) {
    const metadata = buildReleaseMetadata(release);
    if (!metadata) {
      continue;
    }

    if (release.prerelease) {
      previewVersions.push(metadata);
      continue;
    }

    releaseVersions.push(metadata);
  }

  const sortByVersionDesc = (left: PagesReleaseMetadata, right: PagesReleaseMetadata) =>
    compareReleaseVersions(right.version, left.version);

  previewVersions.sort(sortByVersionDesc);
  releaseVersions.sort(sortByVersionDesc);

  return {
    preview: createVersionsIndex('preview', previewVersions, generatedAt),
    release: createVersionsIndex('release', releaseVersions, generatedAt),
  };
}
