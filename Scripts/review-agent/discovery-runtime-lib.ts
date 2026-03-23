import type { PullRequestThreadReply } from './discovery-lib.ts';

const DISCOVERY_LOOP_REFERENCE = 'docs/agents/review-agent/discovery-loop.md';

export interface DiscoveryWarning {
  prNumber: number;
  signal: 'review-thread-replies';
  message: string;
}

export interface ThreadReplyLoadResult {
  threadReplies: PullRequestThreadReply[];
  warning?: DiscoveryWarning;
}

export function loadThreadRepliesWithFallback(
  prNumber: number,
  load: () => PullRequestThreadReply[],
): ThreadReplyLoadResult {
  try {
    return {
      threadReplies: load(),
    };
  } catch (error) {
    return {
      threadReplies: [],
      warning: {
        prNumber,
        signal: 'review-thread-replies',
        message: toErrorMessage(error),
      },
    };
  }
}

export function buildReviewThreadReplyApiArgs(
  repo: string,
  prNumber: number,
  page: number,
  perPage: number,
): string[] {
  return [
    'api',
    '--method',
    'GET',
    `repos/${repo}/pulls/${prNumber}/comments?per_page=${perPage}&page=${page}`,
  ];
}

export function buildDiscoveryReferencesMustRead(): string[] {
  return [DISCOVERY_LOOP_REFERENCE];
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
