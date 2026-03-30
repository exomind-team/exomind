import { readFileSync } from 'node:fs';

const COMMENT_ID_PATTERNS = [
  /#issuecomment-(\d+)$/i,
  /issuecomment-(\d+)$/i,
  /^(\d+)$/,
];

const GITHUB_REF_PATTERN = /^https?:\/\/github\.com\/([^/]+\/[^/]+)\/(issues|pull)\/(\d+)(?:#issuecomment-(\d+))?\/?$/i;
const HTTPS_REMOTE_PATTERN = /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/i;
const SSH_REMOTE_PATTERN = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i;
const UTF8_BOM = '\uFEFF';
const SUSPICIOUS_QUESTION_SEQUENCE = /\?{8,}/;

export type RefType = 'issue' | 'pr';

export interface ParsedGithubRef {
  repo: string;
  type: RefType;
  number: number;
  commentId?: string;
}

export function parseCommentId(locator: string): string {
  if (!locator || typeof locator !== 'string') {
    throw new Error('Comment id locator is required.');
  }

  const trimmed = locator.trim();
  for (const pattern of COMMENT_ID_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  throw new Error(`Unable to parse comment id from locator: ${locator}`);
}

export function parseGithubRef(ref: string): ParsedGithubRef {
  if (!ref || typeof ref !== 'string') {
    throw new Error('GitHub ref is required.');
  }

  const match = ref.trim().match(GITHUB_REF_PATTERN);
  if (!match) {
    throw new Error(`Invalid GitHub issue/pr ref: ${ref}`);
  }

  return {
    repo: match[1],
    type: match[2].toLowerCase() === 'pull' ? 'pr' : 'issue',
    number: Number.parseInt(match[3], 10),
    commentId: match[4] || undefined,
  };
}

export function resolveMode(requestedMode: string | undefined, commentId: string | undefined): 'create' | 'append' | 'replace' {
  if (requestedMode) {
    const normalized = requestedMode.trim().toLowerCase();
    if (normalized !== 'create' && normalized !== 'append' && normalized !== 'replace') {
      throw new Error(`Invalid mode: ${requestedMode}. Expected create|append|replace.`);
    }
    return normalized;
  }

  return commentId ? 'append' : 'create';
}

export function normalizeBodyText(
  content: string,
  source: 'input' | 'existing' = 'input',
): string {
  const withoutBom = content.startsWith(UTF8_BOM) ? content.slice(1) : content;
  const sourceLabel = source === 'existing' ? 'Existing comment body' : 'Input body';

  if (withoutBom.includes('\u0000')) {
    throw new Error(`${sourceLabel} appears to contain NULL bytes. 可能是错误编码（encoding）文件。`);
  }
  if (withoutBom.includes('\uFFFD')) {
    throw new Error(`${sourceLabel} contains replacement characters (�), possible garbled text. 可能已乱码。`);
  }
  if (SUSPICIOUS_QUESTION_SEQUENCE.test(withoutBom)) {
    throw new Error(`${sourceLabel} contains suspicious long "?" sequence, possible garbled text. 检测到疑似乱码。`);
  }

  return withoutBom;
}

export function buildAppendedBody(existingBody: string, incomingBody: string): string {
  const current = normalizeBodyText(existingBody ?? '', 'existing');
  const next = normalizeBodyText(incomingBody ?? '', 'input');

  if (!current.trim()) {
    return next;
  }

  return `${current}\n\n${next}`;
}

export function readBodyInput(filePath: string | undefined, bodyText: string | undefined): string {
  if (filePath && bodyText) {
    throw new Error('Use either --file or --body, not both.');
  }
  if (!filePath && !bodyText) {
    throw new Error('One of --file or --body is required.');
  }

  if (filePath) {
    const raw = readFileSync(filePath);
    return normalizeBodyText(raw.toString('utf8'), 'input');
  }

  return normalizeBodyText(bodyText as string, 'input');
}

export function parseRepoFromRemoteUrl(remoteUrl: string): string {
  if (!remoteUrl) {
    throw new Error('Remote URL is empty.');
  }

  const trimmed = remoteUrl.trim();

  let match = trimmed.match(HTTPS_REMOTE_PATTERN);
  if (match?.[1] && match?.[2]) {
    return `${match[1]}/${match[2]}`;
  }

  match = trimmed.match(SSH_REMOTE_PATTERN);
  if (match?.[1] && match?.[2]) {
    return `${match[1]}/${match[2]}`;
  }

  throw new Error(`Unable to parse GitHub repo from remote URL: ${remoteUrl}`);
}
