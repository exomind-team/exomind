export interface VersionEntry {
  version: string;
  tag: string;
  published_at: string;
  version_dir?: string;
}

const VERSION_PARAM_RE = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const DEFAULT_PREVIEW_RETENTION = 15;

export function isValidVersionParam(version: string): boolean {
  if (!version || version.length > 80) return false;
  return VERSION_PARAM_RE.test(version);
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
