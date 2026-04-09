export type ReleaseHighlightKind =
  | 'added'
  | 'fixed'
  | 'changed'
  | 'docs'
  | 'maintenance';

export interface ReleaseHighlight {
  kind: ReleaseHighlightKind;
  text: string;
}

const HEADING_KIND_MAP: Record<string, ReleaseHighlightKind> = {
  added: 'added',
  fixed: 'fixed',
  changed: 'changed',
  docs: 'docs',
  maintenance: 'maintenance',
};

const ATTRIBUTION_SUFFIX_RE =
  /\s+\(\[(?:PR\s+#\d+|`?[0-9a-f]{6,}`?)\]\([^)]+\)\s+by\s+[^)]+\)\s*$/i;
const GITHUB_AUTO_ATTRIBUTION_RE =
  /\s+by\s+@[^ ]+\s+in\s+https:\/\/github\.com\/[^\s)]+/i;
const COMPARE_URL_RE =
  /https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/compare\/(.+?)\.\.\.([^\s)]+)/i;
const EXCLUDED_SECTION_RE =
  /^(release scope|change sources|downloads?|downloadable assets|asset naming|workflow|full changelog|new contributors|tag\b|tag semantics|tag 含义|安装包命名|可下载安装资产)/i;

function classifyLine(text: string): ReleaseHighlightKind {
  const normalized = text.trim().toLowerCase();

  if (
    normalized.startsWith('feat') ||
    normalized.startsWith('feature') ||
    normalized.startsWith('add') ||
    normalized.startsWith('新增')
  ) {
    return 'added';
  }
  if (
    normalized.startsWith('fix') ||
    normalized.startsWith('修复') ||
    normalized.startsWith('bug')
  ) {
    return 'fixed';
  }
  if (
    normalized.startsWith('docs') ||
    normalized.startsWith('文档')
  ) {
    return 'docs';
  }
  if (
    normalized.startsWith('chore') ||
    normalized.startsWith('ci') ||
    normalized.startsWith('build') ||
    normalized.startsWith('test') ||
    normalized.startsWith('maint') ||
    normalized.startsWith('维护')
  ) {
    return 'maintenance';
  }

  return 'changed';
}

function classifyHeading(heading: string | null): ReleaseHighlightKind | null {
  if (!heading) {
    return null;
  }

  const normalized = heading.trim().toLowerCase();
  if (normalized.startsWith('###')) {
    const sectionMatch = normalized.match(/^###\s+([a-z]+)/);
    if (sectionMatch) {
      return HEADING_KIND_MAP[sectionMatch[1]] ?? classifyLine(sectionMatch[1]);
    }
  }

  if (normalized.includes('fix') || normalized.includes('修复')) return 'fixed';
  if (normalized.includes('doc') || normalized.includes('文档')) return 'docs';
  if (normalized.includes('maint') || normalized.includes('维护')) return 'maintenance';
  if (normalized.includes('add') || normalized.includes('新增') || normalized.includes('feature')) return 'added';

  return null;
}

function isExcludedHeading(line: string): boolean {
  return EXCLUDED_SECTION_RE.test(line.trim().replace(/^#+\s*/, ''));
}

export function localizeReleaseHighlightKind(
  kind: ReleaseHighlightKind,
  lang: 'zh' | 'en',
): string {
  const zhLabels: Record<ReleaseHighlightKind, string> = {
    added: '新功能',
    fixed: '修复',
    changed: '优化',
    docs: '文档',
    maintenance: '维护',
  };

  const enLabels: Record<ReleaseHighlightKind, string> = {
    added: 'Feature',
    fixed: 'Fix',
    changed: 'Improvement',
    docs: 'Docs',
    maintenance: 'Maintenance',
  };

  return lang === 'zh' ? zhLabels[kind] : enLabels[kind];
}

function normalizeHighlightText(line: string): string {
  return line
    .replace(/^\s*[-*]\s+/, '')
    .replace(ATTRIBUTION_SUFFIX_RE, '')
    .replace(GITHUB_AUTO_ATTRIBUTION_RE, '')
    .replace(/\(\s*#\d+\s*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pushHighlight(
  highlights: ReleaseHighlight[],
  kind: ReleaseHighlightKind,
  rawLine: string,
): void {
  const text = normalizeHighlightText(rawLine);
  if (!text) {
    return;
  }

  if (highlights.some((item) => item.text === text)) {
    return;
  }

  highlights.push({ kind, text });
}

export function extractCompareRangeFromMarkdown(markdown: string | null | undefined): {
  repo: string;
  base: string;
  head: string;
} | null {
  if (!markdown?.trim()) {
    return null;
  }

  const match = markdown.match(COMPARE_URL_RE);
  if (!match) {
    return null;
  }

  return {
    repo: match[1],
    base: match[2],
    head: match[3],
  };
}

export function parseReleaseHighlights(markdown: string | null | undefined): ReleaseHighlight[] {
  if (!markdown?.trim()) {
    return [];
  }

  const highlights: ReleaseHighlight[] = [];
  const lines = markdown.split(/\r?\n/);
  let inWhatChanged = false;
  let currentKind: ReleaseHighlightKind | null = null;
  let currentHeading: string | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!inWhatChanged) {
      if (/^##\s+(?:What Changed|What's Changed|Changes)\b/i.test(line)) {
        inWhatChanged = true;
        currentHeading = line;
      }
      continue;
    }

    if (/^##\s+/.test(line)) {
      break;
    }

    const sectionMatch = line.match(/^###\s+([A-Za-z]+)\b/);
    if (sectionMatch) {
      currentKind = HEADING_KIND_MAP[sectionMatch[1].toLowerCase()] ?? null;
      currentHeading = line;
      continue;
    }

    if (!/^\s*[-*]\s+/.test(rawLine)) {
      continue;
    }

    pushHighlight(
      highlights,
      currentKind ?? classifyHeading(currentHeading) ?? classifyLine(rawLine),
      rawLine,
    );
  }

  if (highlights.length > 0) {
    return highlights;
  }

  currentHeading = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (/^#{1,6}\s+/.test(line)) {
      currentHeading = line;
      continue;
    }

    if (!/^\s*[-*]\s+/.test(rawLine)) {
      continue;
    }

    if (currentHeading && isExcludedHeading(currentHeading)) {
      continue;
    }

    pushHighlight(
      highlights,
      classifyHeading(currentHeading) ?? classifyLine(rawLine),
      rawLine,
    );
  }

  return highlights;
}
