import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const WORKER_PREFIX = '[Codex Worker]';
export const REVIEWER_PREFIX = '[Codex Reviewer]';
export const HUMAN_TEST_LABEL = '🙋needs-human-test';
export const HUMAN_TEST_LABEL_ALIASES = [HUMAN_TEST_LABEL, '🙋 needs-human-test'];
export const HUMAN_TEST_REVIEW_PREFIX = '[Codex Reviewer] ❤️ 需要人类测试';
export const AUTOMATION_LOGINS = ['cloudflare-workers-and-pages', 'github-actions[bot]'];

export type WaitingReason = 'reviewer' | 'human-comment' | 'human-test' | 'ci-failure';

export interface WorkerCursor {
  lastCommentIds: string[];
  lastReviewIds: string[];
  lastReviewThreadIds?: string[];
  lastSeenAt?: string;
}

export interface WorkerWaitingState {
  waiting: boolean;
  waitingOn: WaitingReason;
  since: string;
  lastHeartbeatAt?: string;
}

export interface WorkerLockContext {
  lockId: string;
  owner: string;
  acquiredAt: string;
}

export interface WorkerContext {
  prNumber: number;
  issueNumber: number | null;
  branch: string;
  baseBranch: string;
  worktree: string;
  headSha: string;
  cursor: WorkerCursor;
  waiting: WorkerWaitingState | null;
  lock: WorkerLockContext;
}

export interface ValidationIssue {
  code: 'missing-prefix' | 'missing-section' | 'escaped-newline' | 'question-noise';
  message: string;
}

export interface WorkerTempPaths {
  root: string;
  stateDir: string;
  draftsDir: string;
  watchDir: string;
  lockDir: string;
  currentStateFile: string;
  handledCursorFile: string;
  waitingStateFile: string;
  commentDraftFile: string;
  prBodyDraftFile: string;
  lastWakeFile: string;
  currentLockFile: string;
}

const QUESTION_NOISE_PATTERN = /[?？]{5,}/;
const LINKED_ISSUE_PATTERN = /(?:refs|closes|fixes)\s+#(\d+)/i;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeSectionContent(value: string): string {
  return value.trim();
}

export function extractLinkedIssueNumber(body: string): number | null {
  const match = body.match(LINKED_ISSUE_PATTERN);
  if (!match?.[1]) {
    return null;
  }

  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getWorkerTempPaths(tempRoot = 'temp/worker-agent'): WorkerTempPaths {
  const root = resolve(process.cwd(), tempRoot);
  const stateDir = resolve(root, 'state');
  const draftsDir = resolve(root, 'drafts');
  const watchDir = resolve(root, 'watch');
  const lockDir = resolve(root, 'lock');

  return {
    root,
    stateDir,
    draftsDir,
    watchDir,
    lockDir,
    currentStateFile: resolve(stateDir, 'current.json'),
    handledCursorFile: resolve(stateDir, 'handled-review-cursor.json'),
    waitingStateFile: resolve(stateDir, 'waiting.json'),
    commentDraftFile: resolve(draftsDir, 'comment.md'),
    prBodyDraftFile: resolve(draftsDir, 'pr-body.md'),
    lastWakeFile: resolve(watchDir, 'last-wake.json'),
    currentLockFile: resolve(lockDir, 'current-lock.json'),
  };
}

export function ensureWorkerTempDirs(paths: WorkerTempPaths): void {
  for (const directory of [paths.root, paths.stateDir, paths.draftsDir, paths.watchDir, paths.lockDir]) {
    mkdirSync(directory, { recursive: true });
  }
}

export function readJsonFileIfExists<T>(filePath: string): T | null {
  if (!existsSync(filePath)) {
    return null;
  }

  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

export function writeJsonFile(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function writeTextFile(filePath: string, value: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, value, 'utf8');
}

export function hasHumanTestLabel(labels: Iterable<string>): boolean {
  const known = new Set(HUMAN_TEST_LABEL_ALIASES);
  for (const label of labels) {
    if (known.has(label)) {
      return true;
    }
  }

  return false;
}

export function isAutomationActor(authorLogin: string): boolean {
  return AUTOMATION_LOGINS.includes(authorLogin) || authorLogin.endsWith('[bot]');
}

export function shouldIgnoreFeedbackItem(input: {
  authorLogin: string;
  body: string;
}): boolean {
  return input.body.startsWith(WORKER_PREFIX) || isAutomationActor(input.authorLogin);
}

export function buildHandledCursor(input: {
  commentIds: string[];
  reviewIds: string[];
  previous?: Partial<WorkerCursor>;
  seenAt?: string;
}): WorkerCursor {
  return {
    lastCommentIds: Array.from(new Set(input.commentIds)),
    lastReviewIds: Array.from(new Set(input.reviewIds)),
    lastReviewThreadIds: input.previous?.lastReviewThreadIds ?? [],
    lastSeenAt: input.seenAt ?? new Date().toISOString(),
  };
}

export function renderWorkerComment(input: {
  quote: string;
  change: string;
  verification: string;
  result: string;
}): string {
  const quote = normalizeSectionContent(input.quote);
  const change = normalizeSectionContent(input.change);
  const verification = normalizeSectionContent(input.verification);
  const result = normalizeSectionContent(input.result);

  return [
    WORKER_PREFIX,
    '',
    `> ${quote}`,
    '',
    'Change',
    change,
    '',
    'Verification',
    verification,
    '',
    'Result',
    result,
    '',
  ].join('\n');
}

export function renderWorkerDissentComment(input: {
  scriptConclusion: string;
  actualConclusion: string;
  reproducibleEvidence: string;
  traceProcess: string;
  impact: string;
  linkedIssue: string;
}): string {
  return [
    WORKER_PREFIX,
    '',
    'Conclusion',
    `Script: ${normalizeSectionContent(input.scriptConclusion)}`,
    `Actual: ${normalizeSectionContent(input.actualConclusion)}`,
    '',
    'Repro Evidence',
    normalizeSectionContent(input.reproducibleEvidence),
    '',
    'Trace Process',
    normalizeSectionContent(input.traceProcess),
    '',
    'Impact',
    normalizeSectionContent(input.impact),
    '',
    'Linked Issue',
    normalizeSectionContent(input.linkedIssue),
    '',
  ].join('\n');
}

export function renderWorkerBody(input: {
  summary: string;
  scope: string;
  verification: string;
  linksRefs: string;
}): string {
  return [
    WORKER_PREFIX,
    '',
    '## Summary',
    normalizeSectionContent(input.summary),
    '',
    '## Scope',
    normalizeSectionContent(input.scope),
    '',
    '## Verification',
    normalizeSectionContent(input.verification),
    '',
    '## Links/Refs',
    normalizeSectionContent(input.linksRefs),
    '',
  ].join('\n');
}

export function renderWorkerDissentIssueBody(input: {
  scriptConclusion: string;
  actualConclusion: string;
  reproducibleEvidence: string;
  traceProcess: string;
  impact: string;
  linkedPr: string;
  extraNotes?: string;
}): string {
  const extraNotes = normalizeSectionContent(input.extraNotes ?? '');

  return [
    WORKER_PREFIX,
    '',
    '## Script Conclusion',
    normalizeSectionContent(input.scriptConclusion),
    '',
    '## Actual Conclusion',
    normalizeSectionContent(input.actualConclusion),
    '',
    '## Repro Evidence',
    normalizeSectionContent(input.reproducibleEvidence),
    '',
    '## Trace Process',
    normalizeSectionContent(input.traceProcess),
    '',
    '## Impact',
    normalizeSectionContent(input.impact),
    '',
    '## Linked PR',
    normalizeSectionContent(input.linkedPr),
    extraNotes ? `\n---\n${extraNotes}\n` : '',
  ].join('\n');
}

export function validateWorkerText(
  body: string,
  options: { requiredSections?: string[] } = {},
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const requiredSections = options.requiredSections ?? [];

  if (!body.startsWith(WORKER_PREFIX)) {
    issues.push({
      code: 'missing-prefix',
      message: `Message must start with ${WORKER_PREFIX}.`,
    });
  }

  if (body.includes('\\n')) {
    issues.push({
      code: 'escaped-newline',
      message: 'Message contains a literal \\n sequence.',
    });
  }

  if (QUESTION_NOISE_PATTERN.test(body)) {
    issues.push({
      code: 'question-noise',
      message: 'Message contains a suspicious long question-mark sequence.',
    });
  }

  for (const section of requiredSections) {
    const pattern = new RegExp(`(^|\\n)${escapeRegExp(section)}\\s*(\\n|$)`);
    if (!pattern.test(body)) {
      issues.push({
        code: 'missing-section',
        message: `Message is missing required section: ${section}`,
      });
    }
  }

  return issues;
}

export function buildRestoredContext(input: {
  prNumber: number;
  issueNumber?: number | null;
  branch: string;
  baseBranch: string;
  worktree: string;
  headSha: string;
  cursor?: Partial<WorkerCursor>;
  waiting?: WorkerWaitingState | null;
  lock: WorkerLockContext;
}): WorkerContext {
  return {
    prNumber: input.prNumber,
    issueNumber: input.issueNumber ?? null,
    branch: input.branch,
    baseBranch: input.baseBranch,
    worktree: input.worktree,
    headSha: input.headSha,
    cursor: {
      lastCommentIds: input.cursor?.lastCommentIds ?? [],
      lastReviewIds: input.cursor?.lastReviewIds ?? [],
      lastReviewThreadIds: input.cursor?.lastReviewThreadIds ?? [],
      lastSeenAt: input.cursor?.lastSeenAt,
    },
    waiting: input.waiting ?? null,
    lock: input.lock,
  };
}
