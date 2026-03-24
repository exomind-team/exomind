export interface VersionEntry {
  version: string;
  tag: string;
  published_at: string;
  version_dir?: string;
}

export interface LatestAssetEntry {
  url: string;
  size: number;
  sha256: string;
}

const VERSION_PARAM_RE = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const DEFAULT_PREVIEW_RETENTION = 15;
const PLATFORM_ASSET_CANDIDATES: Record<string, string[]> = {
  'windows-x64': ['windows-x64', 'windows-x64-setup'],
  'android-arm64': ['android-arm64'],
  'macos-aarch64': ['macos-aarch64', 'runtime-macos-aarch64'],
  'linux-x64-appimage': ['linux-x64-appimage', 'runtime-linux-x64'],
};

export function isValidVersionParam(version: string): boolean {
  if (!version || version.length > 80) return false;
  return VERSION_PARAM_RE.test(version);
}

export function resolveLatestAssetForPlatform(
  assets: Record<string, LatestAssetEntry> | null | undefined,
  platform: string,
): { assetKey: string; asset: LatestAssetEntry } | null {
  if (!assets || typeof assets !== 'object' || !platform) {
    return null;
  }

  const candidates = PLATFORM_ASSET_CANDIDATES[platform] ?? [platform];
  for (const key of candidates) {
    const asset = assets[key];
    if (!asset) continue;
    if (
      typeof asset.url !== 'string' ||
      typeof asset.size !== 'number' ||
      typeof asset.sha256 !== 'string'
    ) {
      continue;
    }
    return { assetKey: key, asset };
  }

  return null;
}

function toVersionEntry(value: unknown): VersionEntry | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;

  if (
    typeof record.version !== 'string' ||
    typeof record.published_at !== 'string'
  ) {
    return null;
  }

  return {
    version: record.version,
    tag: typeof record.tag === 'string' ? record.tag : '',
    published_at: record.published_at,
    version_dir: typeof record.version_dir === 'string' ? record.version_dir : undefined,
  };
}

/**
 * 支持两种格式：
 * 1) 新格式: { versions: [...], retention: number }
 * 2) 旧格式: [...]
 */
export function normalizePreviewVersionsPayload(payload: unknown): {
  versions: VersionEntry[];
  retention: number;
} {
  const sourceVersions = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { versions?: unknown })?.versions)
      ? ((payload as { versions: unknown[] }).versions ?? [])
      : [];

  const versions = sourceVersions
    .map(toVersionEntry)
    .filter((entry): entry is VersionEntry => entry !== null);

  const retentionRaw =
    payload && typeof payload === 'object' ? (payload as { retention?: unknown }).retention : undefined;
  const retention =
    typeof retentionRaw === 'number' && Number.isInteger(retentionRaw) && retentionRaw > 0
      ? retentionRaw
      : DEFAULT_PREVIEW_RETENTION;

  return { versions, retention };
}
