import { readFileSync } from 'node:fs';

const COMMENT_ID_PATTERNS = [
  /#issuecomment-(\d+)$/i,
  /issuecomment-(\d+)$/i,
  /^(\d+)$/,
];

const GITHUB_REF_PATTERN = /^https?:\/\/github\.com\/([^/]+\/[^/]+)\/(issues|pull)\/(\d+)(?:#issuecomment-(\d+))?\/?$/i;
const HTTPS_REMOTE_PATTERN = /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/i;
const SSH_REMOTE_PATTERN = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i;

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

export function buildAppendedBody(existingBody: string, incomingBody: string): string {
  const current = existingBody ?? '';
  const next = incomingBody ?? '';

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
    return readFileSync(filePath, 'utf8');
  }

  return bodyText as string;
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
