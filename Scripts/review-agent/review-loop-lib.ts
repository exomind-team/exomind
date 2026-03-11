import { REVIEWER_PREFIX } from './discovery-lib.ts';
import type { PersistedState, ReviewAgentStateValue } from './state-lib.ts';

export interface PullRequestFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
}

export interface ReviewModeInput {
  changedFiles: number;
  additions: number;
  deletions: number;
}

export interface ReviewSummaryInput extends ReviewModeInput {
  prNumber: number;
  title: string;
  body: string;
  files: PullRequestFile[];
}

export interface ReviewSummary {
  selectedPr: {
    number: number;
    title: string;
  };
  linkedIssues: number[];
  reviewMode: 'full-review' | 'priority-review';
  prioritizedFiles: PullRequestFile[];
}

export type ReviewCompletionResult =
  | 'review-posted'
  | 'needs-human-test'
  | 'approve-ready'
  | 'merge-ready'
  | 'merge-blocked';

export type ReviewActionMode =
  | 'comment'
  | 'needs-human-test'
  | 'request-changes'
  | 'approve'
  | 'merge';

export type ReviewActionFailureStage =
  | 'approve-blocked'
  | 'merge-gate-blocked'
  | 'merge-failed'
  | 'label'
  | 'comment-write'
  | 'comment-read'
  | 'review-decision';

export type ReviewCommentLanguage = 'zh-CN' | 'en';
export type VerificationStatus = 'passed' | 'failed' | 'missing' | 'inherited-failure';

export interface ReviewLanguageInput {
  title: string;
  body: string;
  commentBodies: string[];
}

export interface ReviewCommentValidationInput {
  body: string;
  expectedLanguage: ReviewCommentLanguage | null;
  mode: ReviewActionMode;
  approvalGate?: ReviewApprovalGate;
}

export interface ReviewCommentValidationResult {
  valid: boolean;
  detectedLanguage: ReviewCommentLanguage | null;
  errors: string[];
}

export interface ReviewApprovalGate {
  ciStatus: VerificationStatus;
  localVerificationStatus: VerificationStatus;
}

interface BuildCompletedReviewStateInput {
  completion: ReviewCompletionResult;
  selectedPrNumber: number;
  previousState: PersistedState | null;
  error?: string;
}

interface BuildRetryableReviewFailureStateInput {
  selectedPrNumber: number;
  previousState: PersistedState | null;
  error: string;
}

const ISSUE_REF_PATTERN = /\b(?:ref|refs|close|closes|fix|fixes)\s+(?:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)?#(\d+)\b/gi;
const TEST_FILE_PATTERN = /(^|\/)(test|tests|__tests__)\b|\.test\.[A-Za-z0-9]+$|\.spec\.[A-Za-z0-9]+$/i;
const CORE_FILE_PATTERN = /(service|controller|model)/i;
const NO_ISSUES_PATTERN = /(未发现问题|no new issues|no issues found|no blocking issues)/i;
const BLOCKING_REASON_PATTERN = /(阻塞点|阻塞原因|blocked by|blocking reason|blocking:|blocker|\bCI\b[^\n]*(red|fail|failed|failing|pending|running|in progress)|\bchecks?\b[^\n]*(failed|failing|red|pending)|\b(build|tests?)\b[^\n]*(failed|failing|red|pending)|CI\s*(失败|未通过|红|卡住|阻塞)|检查\s*(未通过|失败|红)|测试\s*(未通过|失败|红))/i;
const BLOCKING_VERIFICATION_PATTERN = /(核查方法|验证方法|复现方法|验证步骤|复现步骤|验证方式|复现方式|verification steps?|verify|verification|repro steps?|reproduce|how to verify|how to reproduce|运行命令|执行命令|run\s)/i;
const BLOCKING_RESPONSIBILITY_PATTERN = /(责任人|责任|负责人|负责|由.*(处理|推进|确认|复核|测试)|请.*(处理|推进|确认|复核|测试)|owner|responsibility|next owner|waiting on|needs human|needs owner|needs team)/i;
const PROGRESS_UPDATE_PATTERN = /(进展|当前进度|最新进展|状态同步|PR 进度|progress update|status update|current status|next step|next steps)/i;
const PROGRESS_ACTION_PATTERN = /(已(同步|更新|推进|移动|完成|合并|修复|提交)|同步了|更新了|推进了|完成了|moved|updated|synced|advanced|progressed|ready|prepared|promoted|rebased|merged)/i;
export const HUMAN_TEST_PREFIX = `${REVIEWER_PREFIX} ❤️ 需要人类测试`;
export const NEEDS_HUMAN_TEST_LABEL = '🙋needs-human-test';
const INHERITED_FAILURE_MARKER = '已忽略（inherited failure）';
const COMPLETION_STATE_MAP: Record<ReviewCompletionResult, Extract<ReviewAgentStateValue, 'REVIEW_POSTED' | 'NEEDS_HUMAN_TEST' | 'APPROVE_READY' | 'MERGE_READY' | 'MERGE_BLOCKED'>> = {
  'review-posted': 'REVIEW_POSTED',
  'needs-human-test': 'NEEDS_HUMAN_TEST',
  'approve-ready': 'APPROVE_READY',
  'merge-ready': 'MERGE_READY',
  'merge-blocked': 'MERGE_BLOCKED',
};

export function parseLinkedIssueNumbers(text: string): number[] {
  const issueNumbers: number[] = [];
  const seen = new Set<number>();

  for (const match of text.matchAll(ISSUE_REF_PATTERN)) {
    const issueNumber = Number.parseInt(match[1] ?? '', 10);
    if (!Number.isFinite(issueNumber) || seen.has(issueNumber)) {
      continue;
    }

    seen.add(issueNumber);
    issueNumbers.push(issueNumber);
  }

  return issueNumbers;
}

export function classifyReviewMode(input: ReviewModeInput): 'full-review' | 'priority-review' {
  if (input.changedFiles <= 5 && input.additions + input.deletions <= 100) {
    return 'full-review';
  }

  return 'priority-review';
}

export function prioritizeFiles(files: PullRequestFile[]): PullRequestFile[] {
  return [...files].sort((left, right) => {
    const scoreDelta = scoreFile(left) - scoreFile(right);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }

    return left.path.localeCompare(right.path);
  });
}

export function buildReviewSummary(input: ReviewSummaryInput): ReviewSummary {
  return {
    selectedPr: {
      number: input.prNumber,
      title: input.title,
    },
    linkedIssues: parseLinkedIssueNumbers(input.body),
    reviewMode: classifyReviewMode(input),
    prioritizedFiles: prioritizeFiles(input.files),
  };
}

export function resolveReviewCommentLanguage(input: ReviewLanguageInput): ReviewCommentLanguage | null {
  return detectLanguage([
    input.title,
    input.body,
    ...input.commentBodies,
  ].filter(Boolean).join('\n'));
}

export function validateReviewComment(
  input: ReviewCommentValidationInput,
): ReviewCommentValidationResult {
  const trimmed = input.body.trimStart();
  const errors: string[] = [];
  const gateLineRequirements = {
    conclusion: false,
    gate: false,
    evidence: false,
  };
  let gateLine = '';

  if (input.mode === 'needs-human-test') {
    if (!trimmed.startsWith(HUMAN_TEST_PREFIX)) {
      errors.push(`Comment must start with ${HUMAN_TEST_PREFIX}.`);
    }
    if (!input.body.includes(NEEDS_HUMAN_TEST_LABEL)) {
      errors.push(`Human-test comments must mention ${NEEDS_HUMAN_TEST_LABEL}.`);
    }
    if (!/(移除|remove)/i.test(input.body)) {
      errors.push('Human-test comments must tell humans to remove the label after testing.');
    }
  } else if (!trimmed.startsWith(REVIEWER_PREFIX)) {
    errors.push(`Comment must start with ${REVIEWER_PREFIX}.`);
  }

  if (input.mode === 'comment' && NO_ISSUES_PATTERN.test(input.body)) {
    const hasBlockingReason = BLOCKING_REASON_PATTERN.test(input.body);
    const hasProgressUpdate = PROGRESS_UPDATE_PATTERN.test(input.body);

    if (!hasBlockingReason && !hasProgressUpdate) {
      errors.push('No-issue comments must include an explicit blocking reason or progress update.');
    }

    if (hasBlockingReason) {
      if (!BLOCKING_VERIFICATION_PATTERN.test(input.body)) {
        errors.push('Blocking details must include verification steps.');
      }
      if (!BLOCKING_RESPONSIBILITY_PATTERN.test(input.body)) {
        errors.push('Blocking details must include responsibility or next owner.');
      }
    }

    if (!hasBlockingReason && hasProgressUpdate && !PROGRESS_ACTION_PATTERN.test(input.body)) {
      errors.push('Progress updates must include a PR state change.');
    }
  }

  if (input.mode === 'merge') {
    for (const line of input.body.split(/\r?\n/)) {
      const trimmedLine = line.trim();
      if (trimmedLine.startsWith('结论:')) {
        gateLineRequirements.conclusion = true;
        continue;
      }
      if (trimmedLine.startsWith('门禁:')) {
        gateLineRequirements.gate = true;
        gateLine = trimmedLine;
        continue;
      }
      if (trimmedLine.startsWith('证据:')) {
        gateLineRequirements.evidence = true;
      }
    }

    if (!gateLineRequirements.conclusion) {
      errors.push('Pass comments must include a 结论 line.');
    }
    if (!gateLineRequirements.gate) {
      errors.push('Pass comments must include a 门禁 line.');
    }
    if (!gateLineRequirements.evidence) {
      errors.push('Pass comments must include a 证据 line.');
    }
    if (gateLineRequirements.gate) {
      if (!gateLine.includes('CI=')) {
        errors.push('门禁行必须包含 CI=。');
      }
      if (!gateLine.includes('本地验证=')) {
        errors.push('门禁行必须包含 本地验证=。');
      }
    }
  }

  const expectsInheritedMarker = input.approvalGate?.ciStatus === 'inherited-failure'
    || /CI\s*=\s*inherited-failure/i.test(input.body);
  if (expectsInheritedMarker && !input.body.includes(INHERITED_FAILURE_MARKER)) {
    errors.push(`Inherited CI failures must be marked as ${INHERITED_FAILURE_MARKER}.`);
  }

  if (/[?？]{5,}/u.test(input.body)) {
    errors.push('Comment contains a suspicious sequence of 5+ question marks.');
  }

  if (/\\n/.test(input.body)) {
    errors.push('Comment contains a literal \\n sequence.');
  }

  const detectedLanguage = detectLanguage(input.body);
  const ignoreLanguageMismatch = input.mode === 'merge'
    && input.expectedLanguage === 'zh-CN'
    && gateLineRequirements.conclusion
    && gateLineRequirements.gate
    && gateLineRequirements.evidence;
  if (
    input.expectedLanguage
    && detectedLanguage
    && input.expectedLanguage !== detectedLanguage
    && !ignoreLanguageMismatch
  ) {
    errors.push(`Comment language ${detectedLanguage} does not match PR language ${input.expectedLanguage}.`);
  }

  return {
    valid: errors.length === 0,
    detectedLanguage,
    errors,
  };
}

export function mapActionModeToCompletion(
  mode: Exclude<ReviewActionMode, 'merge'>,
): Exclude<ReviewCompletionResult, 'merge-ready' | 'merge-blocked'> {
  if (mode === 'needs-human-test') {
    return 'needs-human-test';
  }

  if (mode === 'approve') {
    return 'approve-ready';
  }

  return 'review-posted';
}

export function buildPullRequestActionJsonFields(mode: ReviewActionMode): string[] {
  const fields = [
    'number',
    'title',
    'body',
    'url',
    'labels',
    'comments',
  ];

  if (mode === 'merge') {
    fields.push('viewerCanMerge');
  }

  return fields;
}

export function findApproveBlockingReason(input: {
  hasNeedsHumanTestLabel: boolean;
  approvalGate?: ReviewApprovalGate;
}): string | null {
  if (input.hasNeedsHumanTestLabel) {
    return `Cannot approve while ${NEEDS_HUMAN_TEST_LABEL} is still present.`;
  }

  if (!input.approvalGate) {
    return 'Cannot approve without explicit CI and local verification results.';
  }

  if (input.approvalGate.ciStatus !== 'passed' && input.approvalGate.ciStatus !== 'inherited-failure') {
    return `Cannot approve because CI status is ${input.approvalGate.ciStatus}.`;
  }

  if (input.approvalGate.localVerificationStatus !== 'passed') {
    return `Cannot approve because local verification status is ${input.approvalGate.localVerificationStatus}.`;
  }

  return null;
}

export function findMergeBlockingReason(input: {
  hasNeedsHumanTestLabel: boolean;
  approvalGate?: ReviewApprovalGate;
}): string | null {
  if (input.hasNeedsHumanTestLabel) {
    return `Cannot merge while ${NEEDS_HUMAN_TEST_LABEL} is still present.`;
  }

  if (!input.approvalGate) {
    return 'Cannot merge without explicit CI and local verification results.';
  }

  if (input.approvalGate.localVerificationStatus !== 'passed') {
    return `Cannot merge because local verification status is ${input.approvalGate.localVerificationStatus}.`;
  }

  if (input.approvalGate.ciStatus !== 'passed' && input.approvalGate.ciStatus !== 'inherited-failure') {
    return `Cannot merge because CI status is ${input.approvalGate.ciStatus}.`;
  }

  return null;
}

export function buildCompletedReviewState(input: BuildCompletedReviewStateInput): PersistedState {
  return {
    state: COMPLETION_STATE_MAP[input.completion],
    phase: 'REVIEW',
    lastPhase: 'REVIEW',
    nextAction: 'discovery',
    selectedPrNumber: input.selectedPrNumber,
    selectedReason: input.previousState?.selectedReason ?? null,
    inspectedPrCount: input.previousState?.inspectedPrCount ?? 0,
    skippedPrCount: input.previousState?.skippedPrCount ?? 0,
    actionableCount: input.previousState?.actionableCount ?? 1,
    failureStreak: 0,
    nextSleepSeconds: input.previousState?.nextSleepSeconds ?? 180,
    updatedAt: new Date().toISOString(),
    ...(input.error ? { error: input.error } : {}),
  };
}

export function resolveReviewFailureCompletion(input: {
  actionMode: ReviewActionMode;
  failedStage: ReviewActionFailureStage;
}): Extract<ReviewCompletionResult, 'merge-blocked'> | null {
  if (input.actionMode === 'merge' && input.failedStage === 'merge-gate-blocked') {
    return 'merge-blocked';
  }

  return null;
}

export function buildRetryableReviewFailureState(
  input: BuildRetryableReviewFailureStateInput,
): PersistedState {
  return {
    state: 'FAILED_RETRYABLE',
    phase: 'REVIEW',
    lastPhase: 'REVIEW',
    nextAction: 'review',
    selectedPrNumber: input.selectedPrNumber,
    selectedReason: input.previousState?.selectedReason ?? null,
    inspectedPrCount: input.previousState?.inspectedPrCount ?? 0,
    skippedPrCount: input.previousState?.skippedPrCount ?? 0,
    actionableCount: input.previousState?.actionableCount ?? 1,
    failureStreak: (input.previousState?.failureStreak ?? 0) + 1,
    nextSleepSeconds: input.previousState?.nextSleepSeconds ?? 180,
    updatedAt: new Date().toISOString(),
    error: input.error,
  };
}

function scoreFile(file: PullRequestFile): number {
  if (file.status.toLowerCase() === 'added') {
    return 0;
  }
  if (TEST_FILE_PATTERN.test(file.path)) {
    return 1;
  }
  if (CORE_FILE_PATTERN.test(file.path)) {
    return 2;
  }

  return 3;
}

function detectLanguage(text: string): ReviewCommentLanguage | null {
  const chineseCount = (text.match(/[\p{Script=Han}]/gu) ?? []).length;
  const latinCount = (text.match(/[A-Za-z]/g) ?? []).length;

  if (chineseCount >= 4 && chineseCount * 2 >= latinCount) {
    return 'zh-CN';
  }

  if (latinCount >= 20) {
    return 'en';
  }

  if (chineseCount > 0 && latinCount === 0) {
    return 'zh-CN';
  }

  if (latinCount > 0 && chineseCount === 0) {
    return 'en';
  }

  return null;
}
