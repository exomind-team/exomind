import type {
  Proposal,
  ProposalActionType,
  ProposalComment,
  ProposalPublisher,
  ProposalReference,
  ProposalStatus,
} from '@/lib/types/proposal';

export interface RuntimeProposalReferencePayload {
  ref_type: ProposalReference['refType'];
  id: string;
  display_text: string;
}

export interface RuntimeProposalPublisherPayload {
  publisher_type: ProposalPublisher['publisherType'];
  id: string;
  name: string;
}

export interface RuntimeProposalCommentPayload {
  author: RuntimeProposalPublisherPayload;
  content: string;
  created_at: string;
}

export interface RuntimeProposalPayload {
  id: string;
  title: string;
  body?: string | null;
  action_type: ProposalActionType;
  action_params?: Record<string, unknown> | null;
  references?: RuntimeProposalReferencePayload[] | null;
  status: ProposalStatus;
  publisher: RuntimeProposalPublisherPayload;
  comments?: RuntimeProposalCommentPayload[] | null;
  created_at: string;
  updated_at: string;
  snooze_until?: string | null;
}

export function toProposalReference(
  payload: RuntimeProposalReferencePayload,
): ProposalReference {
  return {
    refType: payload.ref_type,
    id: payload.id,
    displayText: payload.display_text,
  };
}

export function toProposalPublisher(
  payload: RuntimeProposalPublisherPayload,
): ProposalPublisher {
  return {
    publisherType: payload.publisher_type,
    id: payload.id,
    name: payload.name,
  };
}

export function toProposalComment(
  payload: RuntimeProposalCommentPayload,
): ProposalComment {
  return {
    author: toProposalPublisher(payload.author),
    content: payload.content,
    createdAt: payload.created_at,
  };
}

export function toProposal(payload: RuntimeProposalPayload): Proposal {
  return {
    id: payload.id,
    title: payload.title,
    body: payload.body ?? '',
    actionType: payload.action_type,
    actionParams: payload.action_params ?? {},
    references: (payload.references ?? []).map(toProposalReference),
    status: payload.status,
    publisher: toProposalPublisher(payload.publisher),
    comments: (payload.comments ?? []).map(toProposalComment),
    createdAt: payload.created_at,
    updatedAt: payload.updated_at,
    ...(payload.snooze_until ? { snoozeUntil: payload.snooze_until } : {}),
  };
}
