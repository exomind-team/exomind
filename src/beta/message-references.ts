import { summaryUuid } from './summary-validation';

export interface BetaMessageReferenceIdentity {
  profileId: string;
  eventId: string;
}

export interface BetaMessageReferenceSource extends BetaMessageReferenceIdentity {
  text: string;
}

export interface BetaMessageReference extends BetaMessageReferenceIdentity {
  uri: string;
  label: string;
  excerpt?: string;
  lineIndex: number;
  isQuoteLine: boolean;
  start: number;
  end: number;
  lineStart: number;
  lineEnd: number;
}

export interface BetaMessageReferenceInsertion {
  text: string;
  referenceLine: string;
  inserted: boolean;
  cursorOffsetDelta: number;
}

interface TextLine {
  text: string;
  index: number;
  start: number;
  contentEnd: number;
  end: number;
  nextStart: number;
}

interface LocatedReference extends BetaMessageReference {
  removeStart: number;
  removeEnd: number;
}

const URI_PATTERN = /^exomind-beta:\/\/event\/([^/?#]+)\/([^/?#]+)$/i;
const MARKDOWN_LINK_PATTERN = /\[([^\]]*)\]\(([^)\s]+)\)/gu;
const RAW_URI_PATTERN = /exomind-beta:\/\/event\/[^\s<>()\]]+/giu;
const DEFAULT_REFERENCE_LABEL = '消息引用';
const SUMMARY_MAX_LENGTH = 48;
const EXCERPT_MAX_LENGTH = 72;

function checkedIdentity(identity: BetaMessageReferenceIdentity): BetaMessageReferenceIdentity {
  return {
    profileId: summaryUuid(identity.profileId),
    eventId: summaryUuid(identity.eventId),
  };
}

function identityKey(identity: BetaMessageReferenceIdentity): string {
  return identity.profileId + '\u0000' + identity.eventId;
}

function normalizeInlineText(value: string): string {
  return value
    .replace(/\[([^\]]*)\]\(([^)\s]+)\)/gu, '$1')
    .replace(/^>\s?/u, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function truncate(value: string, maxLength: number): string {
  const characters = Array.from(value);
  return characters.length > maxLength
    ? characters.slice(0, Math.max(1, maxLength - 1)).join('').trimEnd() + '…'
    : value;
}

function summarizeSource(text: string): { label: string; excerpt?: string } {
  const lines = text
    .split(/\r?\n/u)
    .map(normalizeInlineText)
    .filter(line => line.length > 0);
  const label = truncate(lines[0] ?? DEFAULT_REFERENCE_LABEL, SUMMARY_MAX_LENGTH);
  const excerptText = lines.slice(1).map(normalizeInlineText).join(' ').trim();
  return {
    label: label || DEFAULT_REFERENCE_LABEL,
    ...(excerptText ? { excerpt: truncate(excerptText, EXCERPT_MAX_LENGTH) } : {}),
  };
}

function safeMarkdownLabel(value: string): string {
  return value
    .replace(/\\/gu, '／')
    .replace(/\[/gu, '［')
    .replace(/\]/gu, '］');
}

function textLines(value: string): TextLine[] {
  const lines: TextLine[] = [];
  let start = 0;
  let index = 0;
  while (start <= value.length) {
    const newline = value.indexOf('\n', start);
    const end = newline < 0 ? value.length : newline;
    const contentEnd = end > start && value[end - 1] === '\r' ? end - 1 : end;
    lines.push({
      text: value.slice(start, contentEnd),
      index,
      start,
      contentEnd,
      end,
      nextStart: newline < 0 ? value.length : newline + 1,
    });
    if (newline < 0) break;
    start = newline + 1;
    index += 1;
  }
  return lines;
}

export function buildBetaMessageReferenceUri(identity: BetaMessageReferenceIdentity): string {
  const checked = checkedIdentity(identity);
  return 'exomind-beta://event/' + encodeURIComponent(checked.profileId) + '/' + encodeURIComponent(checked.eventId);
}

export function parseBetaMessageReferenceUri(value: string): BetaMessageReferenceIdentity | null {
  const match = URI_PATTERN.exec(value);
  if (!match) return null;

  try {
    const identity = checkedIdentity({
      profileId: decodeURIComponent(match[1]),
      eventId: decodeURIComponent(match[2]),
    });
    return identity;
  } catch {
    return null;
  }
}

export function buildBetaMessageReferenceLine(source: BetaMessageReferenceSource): string {
  const identity = checkedIdentity(source);
  const summary = summarizeSource(source.text);
  const uri = buildBetaMessageReferenceUri(identity);
  const label = safeMarkdownLabel(summary.label);
  return '> 引用：[' + label + '](' + uri + ')' + (summary.excerpt ? ' | ' + summary.excerpt : '');
}

export function insertBetaMessageReference(
  draftText: string,
  source: BetaMessageReferenceSource,
): BetaMessageReferenceInsertion {
  const identity = checkedIdentity(source);
  const referenceLine = buildBetaMessageReferenceLine({ ...identity, text: source.text });
  const exists = extractBetaMessageReferences(draftText)
    .some(reference => identityKey(reference) === identityKey(identity));
  if (exists) {
    return { text: draftText, referenceLine, inserted: false, cursorOffsetDelta: 0 };
  }

  const prefix = referenceLine + '\n';
  return {
    text: prefix + draftText,
    referenceLine,
    inserted: true,
    cursorOffsetDelta: prefix.length,
  };
}

function locateReferencesOnLine(line: TextLine): LocatedReference[] {
  const references: LocatedReference[] = [];
  const matchedUris = new Set<string>();
  const isQuoteLine = line.text.startsWith('> 引用：');

  const markdownMatches = isQuoteLine
    ? Array.from(line.text.matchAll(/^> 引用：\[([^\]]*)\]\(([^)\s]+)\)/gu))
    : Array.from(line.text.matchAll(MARKDOWN_LINK_PATTERN));

  for (const match of markdownMatches) {
    const uri = match[2];
    const identity = parseBetaMessageReferenceUri(uri);
    if (!identity || match.index === undefined) continue;
    matchedUris.add(uri);
    const suffix = line.text.slice(match.index + match[0].length);
    const excerpt = isQuoteLine && suffix.startsWith(' | ') ? suffix.slice(3).trim() : undefined;
    const start = line.start + match.index;
    const end = start + match[0].length;
    references.push({
      ...identity,
      uri,
      label: match[1].trim() || DEFAULT_REFERENCE_LABEL,
      ...(excerpt ? { excerpt } : {}),
      lineIndex: line.index,
      isQuoteLine,
      start,
      end,
      lineStart: line.start,
      lineEnd: line.contentEnd,
      removeStart: isQuoteLine ? line.start : start,
      removeEnd: isQuoteLine ? (line.nextStart > line.end ? line.nextStart : line.end) : end,
    });
  }

  const rawMatches = isQuoteLine ? [] : Array.from(line.text.matchAll(RAW_URI_PATTERN));
  for (const match of rawMatches) {
    if (match.index === undefined) continue;
    let uri = match[0];
    let endIndex = match.index + uri.length;
    while (/[.,!?，。；;:]+$/u.test(uri)) {
      uri = uri.slice(0, -1);
      endIndex -= 1;
    }
    if (matchedUris.has(uri)) continue;
    const identity = parseBetaMessageReferenceUri(uri);
    if (!identity) continue;
    const start = line.start + match.index;
    const end = line.start + endIndex;
    references.push({
      ...identity,
      uri,
      label: DEFAULT_REFERENCE_LABEL,
      lineIndex: line.index,
      isQuoteLine: false,
      start,
      end,
      lineStart: line.start,
      lineEnd: line.contentEnd,
      removeStart: start,
      removeEnd: end,
    });
  }

  return references;
}

function scanReferences(value: string): LocatedReference[] {
  return textLines(value).flatMap(locateReferencesOnLine);
}

export function extractBetaMessageReferences(value: string): BetaMessageReference[] {
  const unique = new Map<string, LocatedReference>();
  for (const reference of scanReferences(value)) {
    const key = identityKey(reference);
    if (!unique.has(key)) unique.set(key, reference);
  }
  return Array.from(unique.values()).map((reference) => {
    const { removeStart: _removeStart, removeEnd: _removeEnd, ...publicReference } = reference;
    return publicReference;
  });
}

export function removeBetaMessageReference(
  draftText: string,
  identity: BetaMessageReferenceIdentity,
): string {
  let target: BetaMessageReferenceIdentity;
  try {
    target = checkedIdentity(identity);
  } catch {
    return draftText;
  }

  const ranges = scanReferences(draftText)
    .filter(reference => identityKey(reference) === identityKey(target))
    .map(reference => ({ start: reference.removeStart, end: reference.removeEnd }))
    .filter((range, index, all) => all.findIndex(item => item.start === range.start && item.end === range.end) === index)
    .sort((left, right) => right.start - left.start);

  let result = draftText;
  for (const range of ranges) {
    result = result.slice(0, range.start) + result.slice(range.end);
  }
  return result;
}

/** A display projection only; callers keep the captured source text unchanged. */
export function stripBetaMessageReferencesForDisplay(value: string): string {
  return extractBetaMessageReferences(value).reduce(
    (current, reference) => removeBetaMessageReference(current, reference),
    value,
  );
}
