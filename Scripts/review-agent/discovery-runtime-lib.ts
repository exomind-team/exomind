import type { PullRequestThreadReply } from './discovery-lib.ts';

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

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
