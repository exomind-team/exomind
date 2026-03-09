import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const WORKER_PREFIX = '[Codex Worker]';
export const REVIEWER_PREFIX = '[Codex Reviewer]';
export const HUMAN_TEST_LABEL = '🙋needs-human-test';
export const HUMAN_TEST_LABEL_ALIASES = [HUMAN_TEST_LABEL, '🙋 needs-human-test'];
export const HUMAN_TEST_REVIEW_PREFIX = '[Codex Reviewer] ❤️ 需要人类测试';
export const AUTOMATION_LOGINS = ['cloudflare-workers-and-pages', 'github-actions[bot]'];
export const LOCK_METADATA_PREFIX = '<!-- LOCK_METADATA';

export type WaitingReason = 'reviewer' | 'human-comment' | 'human-test' | 'ci-failure';
export type WorkerMessageLanguage = 'zh' | 'en';

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

export interface WorkerLanguageSignalItem {
  authorLogin: string;
  body: string;
  createdAt?: string;
}

export interface WorkerContext {
  prNumber: number;
  issueNumber: number | null;
  targetLanguage: WorkerMessageLanguage;
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
const NON_BLOCKING_REVIEWER_COMMENT_PATTERNS = [
  /only state synchronization/i,
  /no issues found/i,
  /no new implementation delta/i,
  /does not change scope alignment/i,
  /已审阅最新变更，未发现问题/u,
  /未发现新问题/u,
  /没有新的实现增量/u,
  /没有新增提交、测试、需求或实现范围变化/u,
];

function normalizeSectionContent(value: string): string {
  return value.trim();
}

function countMatches(input: string, pattern: RegExp): number {
  return input.match(pattern)?.length ?? 0;
}

function inferLanguageFromText(input: string): WorkerMessageLanguage | null {
  const text = input.trim();
  if (!text) {
    return null;
  }

  const hanCount = countMatches(text, /[\p{Script=Han}]/gu);
  const latinCount = countMatches(text, /[A-Za-z]/g);
  if (hanCount === 0 && latinCount === 0) {
    return null;
  }

  if (hanCount > 0 && hanCount * 2 >= Math.max(latinCount, 1)) {
    return 'zh';
  }

  if (latinCount >= Math.max(hanCount * 2, 6)) {
    return 'en';
  }

  if (hanCount > latinCount) {
    return 'zh';
  }

  if (latinCount > hanCount) {
    return 'en';
  }

  return null;
}

function defaultWorkerLanguage(input: {
  issueTitle?: string;
  issueBody?: string;
  fallback?: WorkerMessageLanguage;
}): WorkerMessageLanguage {
  return inferLanguageFromText(`${input.issueTitle ?? ''}\n${input.issueBody ?? ''}`) ?? input.fallback ?? 'en';
}

function parseSignalTimestamp(value?: string): number {
  if (!value) {
    return 0;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function shouldIgnoreLanguageSignal(input: WorkerLanguageSignalItem): boolean {
  const body = input.body.trimStart();
  return (
    body.startsWith(WORKER_PREFIX) ||
    body.startsWith(REVIEWER_PREFIX) ||
    body.startsWith(LOCK_METADATA_PREFIX) ||
    isAutomationActor(input.authorLogin)
  );
}

function workerMessageLabels(language: WorkerMessageLanguage): {
  comment: {
    change: string;
    verification: string;
    result: string;
  };
  dissentComment: {
    conclusion: string;
    script: string;
    actual: string;
    reproEvidence: string;
    traceProcess: string;
    impact: string;
    linkedIssue: string;
  };
  body: {
    summary: string;
    scope: string;
    verification: string;
    linksRefs: string;
  };
  dissentIssue: {
    scriptConclusion: string;
    actualConclusion: string;
    reproEvidence: string;
    traceProcess: string;
    impact: string;
    linkedPr: string;
  };
} {
  if (language === 'zh') {
    return {
      comment: {
        change: '变更',
        verification: '验证',
        result: '结果',
      },
      dissentComment: {
        conclusion: '结论',
        script: '脚本',
        actual: '实际',
        reproEvidence: '复现证据',
        traceProcess: '追踪过程',
        impact: '影响',
        linkedIssue: '关联议题',
      },
      body: {
        summary: '摘要',
        scope: '范围',
        verification: '验证',
        linksRefs: '关联/引用',
      },
      dissentIssue: {
        scriptConclusion: '脚本结论',
        actualConclusion: '实际结论',
        reproEvidence: '复现证据',
        traceProcess: '追踪过程',
        impact: '影响',
        linkedPr: '关联 PR',
      },
    };
  }

  return {
    comment: {
      change: 'Change',
      verification: 'Verification',
      result: 'Result',
    },
    dissentComment: {
      conclusion: 'Conclusion',
      script: 'Script',
      actual: 'Actual',
      reproEvidence: 'Repro Evidence',
      traceProcess: 'Trace Process',
      impact: 'Impact',
      linkedIssue: 'Linked Issue',
    },
    body: {
      summary: 'Summary',
      scope: 'Scope',
      verification: 'Verification',
      linksRefs: 'Links/Refs',
    },
    dissentIssue: {
      scriptConclusion: 'Script Conclusion',
      actualConclusion: 'Actual Conclusion',
      reproEvidence: 'Repro Evidence',
      traceProcess: 'Trace Process',
      impact: 'Impact',
      linkedPr: 'Linked PR',
    },
  };
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

export function isLockMetadataComment(body: string): boolean {
  return body.trimStart().startsWith(LOCK_METADATA_PREFIX);
}

export function shouldIgnoreFeedbackItem(input: {
  authorLogin: string;
  body: string;
}): boolean {
  return input.body.startsWith(WORKER_PREFIX)
    || isAutomationActor(input.authorLogin)
    || isLockMetadataComment(input.body);
}

export function isNonBlockingReviewState(state: string): boolean {
  return state === 'APPROVED' || state === 'DISMISSED';
}

export function isNonBlockingReviewerComment(body: string): boolean {
  const normalized = body
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('>'))
    .join('\n')
    .replace(REVIEWER_PREFIX, '')
    .trim();

  if (!normalized) {
    return false;
  }

  return NON_BLOCKING_REVIEWER_COMMENT_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function resolveWorkerTargetLanguage(input: {
  issueTitle?: string;
  issueBody?: string;
  issueComments?: WorkerLanguageSignalItem[];
  prComments?: WorkerLanguageSignalItem[];
  fallback?: WorkerMessageLanguage;
}): WorkerMessageLanguage {
  const issueLanguage = inferLanguageFromText(`${input.issueTitle ?? ''}\n${input.issueBody ?? ''}`);
  if (issueLanguage) {
    return issueLanguage;
  }

  const issueSignals = (input.issueComments ?? [])
    .filter((item) => !shouldIgnoreLanguageSignal(item))
    .map((item) => ({
      language: inferLanguageFromText(item.body),
      createdAt: parseSignalTimestamp(item.createdAt),
    }))
    .filter((item): item is { language: WorkerMessageLanguage; createdAt: number } => Boolean(item.language))
    .sort((left, right) => right.createdAt - left.createdAt);

  return issueSignals[0]?.language ?? defaultWorkerLanguage(input);
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
  language?: WorkerMessageLanguage;
  quote: string;
  change: string;
  verification: string;
  result: string;
}): string {
  const labels = workerMessageLabels(input.language ?? 'en');
  const quote = normalizeSectionContent(input.quote);
  const change = normalizeSectionContent(input.change);
  const verification = normalizeSectionContent(input.verification);
  const result = normalizeSectionContent(input.result);

  return [
    WORKER_PREFIX,
    '',
    `> ${quote}`,
    '',
    labels.comment.change,
    change,
    '',
    labels.comment.verification,
    verification,
    '',
    labels.comment.result,
    result,
    '',
  ].join('\n');
}

export function renderWorkerDissentComment(input: {
  language?: WorkerMessageLanguage;
  scriptConclusion: string;
  actualConclusion: string;
  reproducibleEvidence: string;
  traceProcess: string;
  impact: string;
  linkedIssue: string;
}): string {
  const labels = workerMessageLabels(input.language ?? 'en');
  return [
    WORKER_PREFIX,
    '',
    labels.dissentComment.conclusion,
    `${labels.dissentComment.script}: ${normalizeSectionContent(input.scriptConclusion)}`,
    `${labels.dissentComment.actual}: ${normalizeSectionContent(input.actualConclusion)}`,
    '',
    labels.dissentComment.reproEvidence,
    normalizeSectionContent(input.reproducibleEvidence),
    '',
    labels.dissentComment.traceProcess,
    normalizeSectionContent(input.traceProcess),
    '',
    labels.dissentComment.impact,
    normalizeSectionContent(input.impact),
    '',
    labels.dissentComment.linkedIssue,
    normalizeSectionContent(input.linkedIssue),
    '',
  ].join('\n');
}

export function renderWorkerBody(input: {
  language?: WorkerMessageLanguage;
  summary: string;
  scope: string;
  verification: string;
  linksRefs: string;
}): string {
  const labels = workerMessageLabels(input.language ?? 'en');
  return [
    WORKER_PREFIX,
    '',
    `## ${labels.body.summary}`,
    normalizeSectionContent(input.summary),
    '',
    `## ${labels.body.scope}`,
    normalizeSectionContent(input.scope),
    '',
    `## ${labels.body.verification}`,
    normalizeSectionContent(input.verification),
    '',
    `## ${labels.body.linksRefs}`,
    normalizeSectionContent(input.linksRefs),
    '',
  ].join('\n');
}

export function renderWorkerDissentIssueBody(input: {
  language?: WorkerMessageLanguage;
  scriptConclusion: string;
  actualConclusion: string;
  reproducibleEvidence: string;
  traceProcess: string;
  impact: string;
  linkedPr: string;
  extraNotes?: string;
}): string {
  const labels = workerMessageLabels(input.language ?? 'en');
  const extraNotes = normalizeSectionContent(input.extraNotes ?? '');

  return [
    WORKER_PREFIX,
    '',
    `## ${labels.dissentIssue.scriptConclusion}`,
    normalizeSectionContent(input.scriptConclusion),
    '',
    `## ${labels.dissentIssue.actualConclusion}`,
    normalizeSectionContent(input.actualConclusion),
    '',
    `## ${labels.dissentIssue.reproEvidence}`,
    normalizeSectionContent(input.reproducibleEvidence),
    '',
    `## ${labels.dissentIssue.traceProcess}`,
    normalizeSectionContent(input.traceProcess),
    '',
    `## ${labels.dissentIssue.impact}`,
    normalizeSectionContent(input.impact),
    '',
    `## ${labels.dissentIssue.linkedPr}`,
    normalizeSectionContent(input.linkedPr),
    extraNotes ? `\n---\n${extraNotes}\n` : '',
  ].join('\n');
}

export function validateWorkerText(
  body: string,
  options: { requiredSections?: string[] } = {},
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  void options;

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

  return issues;
}

export function buildRestoredContext(input: {
  prNumber: number;
  issueNumber?: number | null;
  targetLanguage?: WorkerMessageLanguage;
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
    targetLanguage: input.targetLanguage ?? 'en',
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
