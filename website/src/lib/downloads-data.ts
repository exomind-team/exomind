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
}

export interface StaticVersionsIndex {
  channel: 'preview' | 'release';
  generated_at: string;
  latest: StaticReleaseMetadata | null;
  versions: StaticReleaseMetadata[];
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

export function buildHistoryEntries(index: StaticVersionsIndex): Array<{
  version: string;
  publishedAt: string;
  releaseUrl: string;
}> {
  return index.versions.map((version) => ({
    version: version.version,
    publishedAt: version.published_at,
    releaseUrl: version.release_url?.trim() || fallbackReleaseUrl(version.tag),
  }));
}
