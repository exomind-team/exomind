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
  needsWorktree: boolean;
}

const ISSUE_REF_PATTERN = /\b(?:ref|refs|close|closes|fix|fixes)\s+(?:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)?#(\d+)\b/gi;
const TEST_FILE_PATTERN = /(^|\/)(test|tests|__tests__)\b|\.test\.[A-Za-z0-9]+$|\.spec\.[A-Za-z0-9]+$/i;
const CORE_FILE_PATTERN = /(service|controller|model)/i;

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
    needsWorktree: false,
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
