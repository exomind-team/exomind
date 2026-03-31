import type { PullRequestThreadReply } from './discovery-lib.ts';

export interface ReviewCommentInput {
  id?: number | string;
  body?: string | null;
  created_at?: string | null;
  in_reply_to_id?: number | string | null;
}

export function toThreadReplies(comments: ReviewCommentInput[]): PullRequestThreadReply[] {
  return comments
    .filter((comment) => comment.in_reply_to_id != null)
    .map((comment) => ({
      id: comment.id ? String(comment.id) : undefined,
      body: comment.body ?? undefined,
      createdAt: comment.created_at ?? null,
    }));
}
